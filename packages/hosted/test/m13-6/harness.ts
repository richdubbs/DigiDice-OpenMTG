/**
 * Test harness for the gateway and tables (package M13-6; in process, no sockets except the one loopback test): a fake runtime, a scripted capacity
 * admission, a fake password hook and a fake clock for the unit tests; a gateway factory; browsers on the in-process transport (and, for the loopback
 * test, on one real WebSocket) that speak the protocol; computer players (`@openmtg/ai`, choosing from the seat's own view) for the games through the
 * real runtime (`makeRig`: workers, deck pool, store, gateway wired as main.ts wires them); HTTP handlers called in process; and the whole-stack
 * hidden-information scan (design 6.4). Normal traffic only (the owner rule: no floods, fuzzing or forged traffic).
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { PassThrough, Readable, type Duplex } from 'node:stream';
import { chooseAction } from '@openmtg/ai';
import { DEFAULT_GUEST_LIMITS } from '@openmtg/net/server-kit';
import { applyAction, canSee, createGame, type GameConfig, type GameState, type GameView, type LegalAction, type PlayerId } from '@openmtg/engine';
import type { PreparedDeck } from '@openmtg/net/server-kit';
import { WebSocket, type RawData } from 'ws';
import { expect } from 'vitest';
import {
  HOSTED_PROTOCOL, nextView, type HostedClientMessage, type HostedDeck, type HostedServerMessage, type ReplyMessage, type SeatNumber, type ServerInfo,
} from '../../src/api';
import {
  ImmediateAdmission, type Admission, type AdmissionDecision, type AdmissionEvent, type AdmissionRefusal, type QueueStanding, type ReleaseCause,
  type StartRequest,
} from '../../src/admission/api';
import { clockFor, parseConfig, type HostedConfig } from '../../src/config';
import { Gateway, type GatewayOptions, type GatewayRuntime } from '../../src/gateway/gateway';
import type { PasswordHook } from '../../src/tables/hooks';
import { StoreTableDirectory } from '../../src/tables/directory';
import { ledgerSecret } from '../../src/ledger/fingerprint';
import { GameRuntime, type RecoveryReport, type RuntimeEvents, type RuntimeTuning } from '../../src/runtime';
import { InProcessClient, InProcessTransport, type InProcessConnectOptions } from '../../src/gateway/in-process';
import { MemoryLogger, MemoryMetrics, type Labels, type MetricName } from '../../src/obs';
import type { DeckResult, SeatInput, StartGameRequest, StartGameResult } from '../../src/runtime/api';
import type { GameStore } from '../../src/store/api';
import { MemoryStore } from '../../src/store';
import { compiledDefs } from '../../../engine/test/fixtures';
import { DECKS, expand, type DeckList } from '../../../ai/test/decks';

export { DECKS };
export const FIXTURE_CARDS = new URL('../m13-5/fixture-cards.ts', import.meta.url).href;

type Msg = HostedServerMessage;

export function testConfig(env: Record<string, string> = {}): HostedConfig {
  const r = parseConfig({ STORE: 'memory', WORKERS: '1', ...env }, { cpus: 2 });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.config;
}

/** A decklist by names, as a browser sends it. */
export function deckOf(d: DeckList): HostedDeck {
  return { main: d.map(([name, count]) => ({ name, count })), sideboard: [] };
}

/** A small legal-looking deck for the unit tests (the fake runtime prepares anything without the name "Bad Card"). */
export const TEST_DECK: HostedDeck = { main: [{ name: 'Forest', count: 60 }], sideboard: [] };

const DEF_CACHE = new Map<string, PreparedDeck['defs'][number]>();
export function preparedDeck(d: DeckList): PreparedDeck {
  const names = [...new Set(d.map(([n]) => n))];
  const missing = names.filter((n) => !DEF_CACHE.has(n));
  for (const def of compiledDefs(missing)) DEF_CACHE.set(def.id, def);
  return { main: expand(d), sideboard: [], commanders: [], defs: names.map((n) => DEF_CACHE.get(n)!), warnings: [] };
}

/** The runtime as the unit tests need it: decks prepared at once (any deck but one naming "Bad Card"), starts and submissions recorded. */
export class FakeRuntime implements GatewayRuntime {
  readonly starts: StartGameRequest[] = [];
  readonly inputs: { game: string; input: SeatInput }[] = [];
  readonly games = new Set<string>();
  draining = false;
  startResult: ((r: StartGameRequest) => StartGameResult) | null = null;
  prepareDelayMs = 0;
  prepared = 0;

  async start(req: StartGameRequest): Promise<StartGameResult> {
    this.starts.push(req);
    const r = this.startResult?.(req) ?? { ok: true as const, game: req.game, worker: 0, seating: req.seats.map((s) => s.seat) };
    if (r.ok) this.games.add(req.game);
    return r;
  }
  submit(game: string, input: SeatInput): boolean {
    this.inputs.push({ game, input });
    return this.games.has(game);
  }
  /** F32: the session each deck check was asked for (undefined: the server's own). */
  readonly deckSessions: (string | undefined)[] = [];
  async prepare(deck: { main: { name: string }[] }, _format?: string, session?: string): Promise<DeckResult> {
    this.prepared++;
    this.deckSessions.push(session);
    if (this.prepareDelayMs) await new Promise((r) => setTimeout(r, this.prepareDelayMs));
    if (deck.main.some((e) => e.name === 'Bad Card')) return { ok: false, errors: ['Unknown card: Bad Card'], warnings: [] };
    return { ok: true, deck: { main: Array<string>(60).fill('Forest'), sideboard: [], commanders: [], defs: [], warnings: [] } };
  }
  ready(): { ok: boolean; reasons: ('workers' | 'store' | 'draining' | 'closed')[] } {
    return { ok: true, reasons: [] };
  }
}

/** A manual clock. */
export class FakeClock {
  constructor(public t = 1_800_000_000_000) {}
  now = (): number => this.t;
  advance(ms: number): number {
    this.t += ms;
    return this.t;
  }
}

export interface TestGateway {
  gateway: Gateway;
  transport: InProcessTransport;
  runtime: FakeRuntime;
  store: GameStore;
  clock: FakeClock;
  logger: MemoryLogger;
  metrics: MemoryMetrics;
  admission: Admission;
}

/** A gateway on a fake runtime, a memory store and a fake clock. */
export function makeGateway(o: Partial<GatewayOptions> & { env?: Record<string, string> } = {}): TestGateway {
  const clock = new FakeClock();
  const runtime = new FakeRuntime();
  const store = o.store ?? new MemoryStore({ now: () => new Date(clock.now()) });
  const logger = new MemoryLogger();
  const metrics = new MemoryMetrics();
  const admission = o.admission ?? new ImmediateAdmission();
  const gateway = new Gateway({
    config: testConfig(o.env), store, runtime, admission, ledgerSecret: 'a'.repeat(64), engineBuild: 'build-test', now: clock.now, logger, metrics, ...o,
  });
  return { gateway, transport: new InProcessTransport(gateway), runtime, store, clock, logger, metrics, admission };
}

/** Lets queued microtasks and the gateway's async work run. */
export async function settle(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

/** What a browser needs of its end of a connection: the in-process client, or the one loopback WebSocket of the real-socket test. */
export interface Link {
  readonly frames: string[];
  readonly closed: { code: number; reason: string } | null;
  /** Called with each text frame received (after it was recorded). */
  onFrame: ((text: string) => void) | null;
  send(m: object | string): void;
  close(): void;
  until(test: () => boolean, ms?: number): Promise<void>;
  messages<T = { t: string } & Record<string, unknown>>(): T[];
}

/** A browser on the in-process transport: hello, numbered commands with replies. */
export class Browser<L extends Link = Link> {
  nextId = 1;
  token = '';
  session = '';
  constructor(readonly client: L) {}

  static connect(t: Pick<TestGateway, 'transport'> | InProcessTransport, o: InProcessConnectOptions = {}): Browser<InProcessClient> {
    const transport = t instanceof InProcessTransport ? t : t.transport;
    const c = transport.connect(o);
    if ('refused' in c) throw new Error(`refused: ${c.refused.why}`);
    return new Browser<InProcessClient>(c);
  }

  messages(): Msg[] {
    return this.client.messages<Msg>();
  }

  of<T extends Msg['t']>(t: T): Extract<Msg, { t: T }>[] {
    return this.messages().filter((m): m is Extract<Msg, { t: T }> => m.t === t);
  }

  last<T extends Msg['t']>(t: T): Extract<Msg, { t: T }> | undefined {
    const xs = this.of(t);
    return xs[xs.length - 1];
  }

  async hello(name = 'Alice', token?: string): Promise<Extract<Msg, { t: 'welcome' }>> {
    this.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name, ...(token ? { token } : {}) });
    await this.client.until(() => this.of('welcome').length > 0 || this.client.closed !== null);
    const w = this.last('welcome');
    if (!w) throw new Error(`no welcome: ${JSON.stringify(this.client.closed)} ${this.client.frames.join(' ')}`);
    this.token = w.token ?? token ?? '';
    this.session = w.session;
    return w;
  }

  /** Sends a command with the next id; resolves with its reply. */
  async cmd(m: Record<string, unknown> & { t: Exclude<HostedClientMessage['t'], 'hello' | 'ping'> }): Promise<ReplyMessage> {
    const id = this.nextId++;
    this.client.send({ ...m, id });
    await this.client.until(() => this.replyTo(id) !== undefined || this.client.closed !== null);
    const r = this.replyTo(id);
    if (!r) throw new Error(`no reply to ${m.t} ${id}: closed ${JSON.stringify(this.client.closed)}`);
    return r;
  }

  replyTo(id: number): ReplyMessage | undefined {
    return this.of('reply').find((r) => r.id === id);
  }
}

// -----------------------------------------------------------------------------------------------------------------------------------------------------
// HTTP handlers called in process (no socket)

export interface Answer {
  status: number;
  headers: Record<string, string | number>;
  body: string;
  destroyed: boolean;
}

/** A request as the `http` server's 'request' event gets it, answered by a recorder. */
export function callRequest(server: Server, o: { method?: string; url: string; headers?: Record<string, string>; peer?: string }): Answer {
  const req = Object.assign(new Readable({ read() {} }), { method: o.method ?? 'GET', url: o.url, headers: o.headers ?? {}, socket: { remoteAddress: o.peer ?? '127.0.0.1' } });
  const answer: Answer = { status: 0, headers: {}, body: '', destroyed: false };
  const res = {
    writeHead: (status: number, headers: Record<string, string | number> = {}) => {
      answer.status = status;
      answer.headers = headers;
    },
    end: (body = '') => {
      answer.body = String(body);
    },
    destroy: () => {
      answer.destroyed = true;
    },
  };
  server.emit('request', req as unknown as IncomingMessage, res as unknown as ServerResponse);
  return answer;
}

/** An upgrade as the 'upgrade' event gets it: what the server wrote to the socket and whether it destroyed it. */
export function callUpgrade(server: Server, o: { url?: string; headers?: Record<string, string>; peer?: string }): { written: string; destroyed: boolean } {
  const socket = new PassThrough();
  const out = { written: '', get destroyed(): boolean { return socket.destroyed; } };
  socket.on('data', (c: Buffer) => (out.written += c.toString('utf8')));
  const req = { url: o.url ?? '/ws', headers: o.headers ?? {}, socket: { remoteAddress: o.peer ?? '127.0.0.1' } };
  server.emit('upgrade', req as unknown as IncomingMessage, socket as unknown as Duplex, Buffer.alloc(0));
  return out;
}

/** A store whose `method` answers only after `ms` (a database that takes its time: the awaits of the tables layer become real interleavings). */
export function slowStore(base: GameStore, method: keyof GameStore, ms: number): GameStore {
  return new Proxy(base, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv) as unknown;
      if (typeof v !== 'function') return v;
      if (prop === method) return async (...a: unknown[]) => (await new Promise((r) => setTimeout(r, ms)), (v as (...x: unknown[]) => unknown).apply(target, a));
      return (v as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

let peers = 0;
/** A distinct IPv4 peer for each call: its own address key, so one browser never uses another's per-address limits. */
export function freshPeer(): string {
  peers++;
  return `10.${(peers >> 8) & 255}.${peers & 255}.7`;
}

/** A browser from its own address with its hello done (on a test gateway, or any server with an in-process transport). */
export async function guest(t: Pick<TestGateway, 'transport'>, name: string, o: InProcessConnectOptions = {}, token?: string): Promise<Browser<InProcessClient>> {
  const b = Browser.connect(t, { peer: freshPeer(), ...o });
  await b.hello(name, token);
  return b;
}

/** Creates a table and returns its id (the reply must be ok). */
export async function createTable(b: Browser, o: Record<string, unknown> = {}): Promise<{ table: string; codes: string[] }> {
  const r = await b.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK, ...o });
  if (!r.ok) throw new Error(`create: ${JSON.stringify(r.error)}`);
  return { table: r.table!, codes: r.codes ?? [] };
}

/** Confirms the browser's ready check. */
export async function ready(b: Browser): Promise<ReplyMessage> {
  await b.client.until(() => b.last('readyCheck') !== undefined);
  return b.cmd({ t: 'ready', start: b.last('readyCheck')!.start });
}

/** Two guests at a listed table whose game is running on the fake runtime (both confirmed the ready check). */
export async function startTable(t: TestGateway, names: [string, string] = ['Alice', 'Bob']): Promise<{ a: Browser<InProcessClient>; b: Browser<InProcessClient>; table: string }> {
  const a = await guest(t, names[0]);
  const b = await guest(t, names[1]);
  const { table } = await createTable(a);
  const j = await b.cmd({ t: 'join', table, deck: TEST_DECK });
  if (!j.ok) throw new Error(`join: ${JSON.stringify(j.error)}`);
  await ready(a);
  await ready(b);
  await a.client.until(() => a.last('table')?.table.status === 'playing');
  return { a, b, table };
}

/** The counter of a metric (0 when it was never counted). */
export function counted(m: MemoryMetrics, name: MetricName, labels: Labels = {}): number {
  return m.values.get(MemoryMetrics.key(name, labels)) ?? 0;
}

/** Password hooks for the table tests (the real scrypt hook is M13-8's): a salted SHA-256, and the passwords it was given. */
export class FakePasswords implements PasswordHook {
  readonly given: string[] = [];
  async hash(password: string): Promise<{ hash: string; salt: string }> {
    this.given.push(password);
    const salt = createHash('sha256').update(`salt|${this.given.length}`).digest('hex').slice(0, 32);
    return { hash: createHash('sha256').update(`${salt}|${password}`).digest('hex'), salt };
  }
  async verify(password: string, hash: string, salt: string): Promise<boolean> {
    return createHash('sha256').update(`${salt}|${password}`).digest('hex') === hash;
  }
}

/**
 * Capacity admission as the table tests script it (M13-10 builds the real queue): `mode` decides the next `request`; `push` queues events for the next
 * `tick` or `freed`; every call is recorded.
 */
export class ScriptedAdmission implements Admission {
  mode: 'admit' | 'wait' | { refuse: AdmissionRefusal } = 'admit';
  readonly requests: StartRequest[] = [];
  readonly withdrawn: string[] = [];
  readonly begins: string[] = [];
  readonly releases: string[] = [];
  readonly freedUnits: number[] = [];
  draining = false;
  private readonly events: AdmissionEvent[] = [];

  request(r: StartRequest): AdmissionDecision {
    this.requests.push(r);
    if (this.mode === 'admit') return { kind: 'admitted' };
    if (this.mode === 'wait') return { kind: 'waiting', position: 1, unitsAhead: r.units, estimatedWaitMs: null };
    return { kind: 'refused', reason: this.mode.refuse, retryAfterMs: 60_000 };
  }
  withdraw(table: string): boolean {
    this.withdrawn.push(table);
    return true;
  }
  begun(table: string): void {
    this.begins.push(table);
  }
  readonly releaseCauses: (ReleaseCause | undefined)[] = [];
  released(table: string, _now?: number, cause?: ReleaseCause): AdmissionEvent[] {
    this.releases.push(table);
    this.releaseCauses.push(cause);
    return this.take();
  }
  freed(units: number): AdmissionEvent[] {
    this.freedUnits.push(units);
    return this.take();
  }
  tick(): AdmissionEvent[] {
    return this.take();
  }
  size(): { starts: number; units: number; reserved: number } {
    return { starts: 0, units: 0, reserved: 0 };
  }
  drain(): void {
    this.draining = true;
  }
  /** What `capacityState` answers when set; otherwise full while draining, else open. */
  capacity: ServerInfo['capacity'] | null = null;
  capacityState(): ServerInfo['capacity'] {
    return this.capacity ?? (this.draining ? 'full' : 'open');
  }
  lookup(): QueueStanding | null {
    return null;
  }
  isWaiting(): boolean {
    return false;
  }
  hasWaitingSession(): boolean {
    return false;
  }
  restore(starts: readonly StartRequest[]): { table: string; decision: AdmissionDecision }[] {
    return starts.map((r) => ({ table: r.table, decision: this.request(r) }));
  }
  /** Events for the next tick. */
  push(...e: AdmissionEvent[]): void {
    this.events.push(...e);
  }
  private take(): AdmissionEvent[] {
    return this.events.splice(0);
  }
}

// -----------------------------------------------------------------------------------------------------------------------------------------------------
// Computer players through the gateway

/** One seat's player: keeps its view as a browser does (full views and patches) and plays its decisions with the AI. */
export class AiSeat {
  view: GameView | null = null;
  seq = -1;
  legal: LegalAction[] = [];
  player: PlayerId | null = null;
  seat: SeatNumber | null = null;
  waiting: number | null = null;
  nextId = 1000;
  result: Extract<Msg, { t: 'result' }> | null = null;
  refusals: string[] = [];
  moves = 0;
  /** Stop choosing after this many moves (null: to the end). */
  limit: number | null = null;
  readonly frames: string[] = [];
  private readonly readied = new Set<string>();

  constructor(readonly tag: string, private readonly send: (m: object) => void) {}

  receive(text: string): void {
    this.frames.push(text);
    const m = JSON.parse(text) as Msg;
    switch (m.t) {
      case 'readyCheck':
        if (!this.readied.has(m.start)) {
          this.readied.add(m.start);
          this.send({ t: 'ready', id: this.nextId++, start: m.start });
        }
        break;
      case 'start':
        break;
      case 'welcome':
        if (m.seat) this.seat = m.seat;
        break;
      case 'table':
        if (m.table.you) this.seat = m.table.you;
        break;
      case 'view':
        this.view = m.view;
        this.seq = m.seq;
        this.legal = m.legal;
        this.player = m.view.viewer;
        break;
      case 'patch': {
        const next = nextView(this.view ? { seq: this.seq, view: this.view } : null, m);
        if (!next) {
          this.send({ t: 'sync', id: this.nextId++ });
          break;
        }
        this.view = next.view;
        this.seq = next.seq;
        this.legal = m.legal;
        break;
      }
      case 'reply':
        if (this.waiting === m.id) this.waiting = null;
        if (!m.ok) this.refusals.push(m.error.code);
        break;
      case 'proposal':
        this.send({ t: 'vote', id: this.nextId++, proposal: m.proposal.id, accept: true });
        break;
      case 'result':
        this.result = m;
        break;
      default:
        break;
    }
    this.act();
  }

  act(): void {
    if (this.result || this.waiting !== null || !this.view || !this.player) return;
    if (this.limit !== null && this.moves >= this.limit) return;
    const d = this.view.pending;
    if (!d || d.player !== this.player) return;
    const action = chooseAction(this.view, d, `${this.tag}-${this.player}`);
    const id = this.nextId++;
    this.waiting = id;
    this.moves++;
    this.send({ t: 'act', id, seq: this.seq, action });
  }
}

/**
 * The browser's end of one real WebSocket (the `ws` client) with the same surface as the in-process client: every text frame received, the close, `until`.
 * Used by the one loopback test (answer 12): a normal game, normal traffic.
 */
export class WsLink implements Link {
  readonly frames: string[] = [];
  closed: { code: number; reason: string } | null = null;
  onFrame: ((text: string) => void) | null = null;
  /** Frames that were not text (there must be none), and the extensions the handshake agreed (none: no compression). */
  binary = 0;
  extensions = '';
  private waiters: { test: () => boolean; resolve: () => void }[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) this.binary++;
      const text = (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer)).toString('utf8');
      this.frames.push(text);
      this.onFrame?.(text);
      this.wake();
    });
    ws.on('close', (code: number, reason: Buffer) => {
      this.closed = { code, reason: reason.toString('utf8') };
      this.wake();
    });
    ws.on('error', () => undefined);
  }

  static connect(port: number, origin: string | null = 'http://127.0.0.1:5173'): Promise<WsLink> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { ...(origin !== null ? { origin } : {}), perMessageDeflate: false });
      ws.once('open', () => {
        const link = new WsLink(ws);
        link.extensions = ws.extensions;
        resolve(link);
      });
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`refused: ${res.statusCode}`)));
    });
  }

  send(m: object | string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }

  close(): void {
    this.ws.close();
  }

  messages<T = { t: string } & Record<string, unknown>>(): T[] {
    return this.frames.map((f) => JSON.parse(f) as T);
  }

  until(test: () => boolean, ms = 30_000): Promise<void> {
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = { test, resolve: () => undefined as void };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`websocket: condition not met in ${ms} ms`));
      }, ms);
      w.resolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push(w);
    });
  }

  private wake(): void {
    for (const w of [...this.waiters]) {
      if (w.test()) {
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve();
      }
    }
  }
}

/** A computer player on a browser's connection: it hears every frame (before and after the game starts) and plays what it is asked. */
export class AiPlayer {
  readonly seat: AiSeat;
  constructor(readonly browser: Browser<Link>, tag: string) {
    this.seat = new AiSeat(tag, (m) => browser.client.send(m));
    browser.client.onFrame = (text) => this.seat.receive(text);
  }

  get frames(): string[] {
    return this.browser.client.frames;
  }

  /** Resolves when the game's result has come. */
  done(ms = 180_000): Promise<void> {
    return this.browser.client.until(() => this.seat.result !== null, ms);
  }
}

/** Resolves when nothing arrives for `quietMs` on any of the players' connections (a paused game: every seat has answered what it was asked). */
export async function quiet(players: AiPlayer[], quietMs = 400): Promise<void> {
  const total = () => players.reduce((n, p) => n + p.frames.length, 0);
  let last = -1;
  for (let still = 0; still < 2; ) {
    const now = total();
    still = now === last ? still + 1 : 0;
    last = now;
    await new Promise((r) => setTimeout(r, quietMs / 2));
  }
}

/** A computer player's browser: connected (from its own address) and said hello, listening before the hello answers. */
export async function aiPlayer(rig: Pick<Rig, 'transport'>, name: string, tag: string, o: { token?: string; peer?: string; after?: AiPlayer } = {}): Promise<AiPlayer> {
  return aiPlayerOn(Browser.connect(rig.transport, { peer: o.peer ?? freshPeer() }), name, tag, o);
}

/** The same on a browser already connected (the loopback WebSocket of the real-socket test). */
export async function aiPlayerOn(b: Browser<Link>, name: string, tag: string, o: { token?: string; after?: AiPlayer } = {}): Promise<AiPlayer> {
  const p = new AiPlayer(b, tag);
  // A seat's command ids go up for the whole game, whichever connection sends them (the table answers a resend of the last one and calls an older one stale):
  // a browser that comes back goes on counting where its earlier connection stopped.
  if (o.after) p.seat.nextId = o.after.seat.nextId + 1;
  await b.hello(name, o.token);
  return p;
}

/**
 * The whole server without a network: the real game runtime (game workers and the deck pool on the engine's fixture cards, a store), the gateway and its
 * tables wired as main.ts wires them, driven through the in-process transport. Housekeeping runs on real timers (once a second).
 */
export interface Rig {
  gateway: Gateway;
  runtime: GameRuntime;
  store: GameStore;
  transport: InProcessTransport;
  logger: MemoryLogger;
  metrics: MemoryMetrics;
  recovery: RecoveryReport;
  secret: string;
  close(): Promise<void>;
}

export const RIG_SECRET = 'ab'.repeat(32);

export async function makeRig(o: {
  store?: GameStore; workers?: number; env?: Record<string, string>; tuning?: Partial<RuntimeTuning>; guestLimits?: GatewayOptions['guestLimits']; now?: () => number; passwords?: PasswordHook;
} = {}): Promise<Rig> {
  const config = testConfig({ LEDGER_SECRET: RIG_SECRET, ...o.env });
  const store = o.store ?? new MemoryStore();
  const logger = new MemoryLogger();
  const metrics = new MemoryMetrics(o.workers ?? 2);
  let gateway: Gateway | null = null;
  const events: RuntimeEvents = {
    deliver: (game, sends) => gateway?.events.deliver(game, sends),
    ended: (e) => gateway?.events.ended?.(e),
    unloaded: (game) => gateway?.events.unloaded?.(game),
  };
  const runtime = new GameRuntime({
    store, events, directory: new StoreTableDirectory(store, { clock: (f, n) => clockFor(config.clocks, f, n) }), workers: o.workers ?? 2, deckWorkers: 1,
    cards: { module: FIXTURE_CARDS }, engineBuild: 'build-test', logger, metrics, outbound: () => gateway?.outbound() ?? 0, tuning: o.tuning ?? {},
    ...(o.now ? { now: o.now } : {}),
  });
  const recovery = await runtime.open();
  const gw = new Gateway({
    config, store, runtime, admission: new ImmediateAdmission(), ledgerSecret: ledgerSecret(config.ledgerSecret).secret, engineBuild: 'build-test', logger, metrics,
    // the computer players answer as fast as their replies come: a human's pace is within the default limit
    guestLimits: o.guestLimits ?? { ...DEFAULT_GUEST_LIMITS, actions: { rate: 500, burst: 500 } },
    ...(o.passwords ? { passwords: o.passwords } : {}),
  });
  gateway = gw;
  for (const game of recovery.recovered) await gw.tables.adopt(game);
  await gw.tables.restore();
  gw.start();
  let closed = false;
  return {
    gateway: gw, runtime, store, transport: new InProcessTransport(gw), logger, metrics, recovery, secret: ledgerSecret(config.ledgerSecret).secret,
    close: async () => {
      if (closed) return;
      closed = true;
      gw.close();
      await runtime.close();
      if (!o.store) await store.close();
    },
  };
}

// -----------------------------------------------------------------------------------------------------------------------------------------------------
// The whole-stack hidden-information scan (design 6.4)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What the other seats hold at the end of a game that this seat's frames never showed: the ids of the cards in their hands and the names of the cards in
 * their libraries. Test material for the scan itself (a frame that carried one of them must fail it).
 */
export function unseenOf(o: { config: GameConfig; records: { action: Parameters<typeof applyAction>[1] }[]; frames: readonly string[]; player: PlayerId }): { handIds: string[]; libraryNames: string[] } {
  let state = createGame(o.config);
  for (const r of o.records) state = applyAction(state, r.action).state;
  const text = o.frames.join('\n');
  const handIds: string[] = [];
  const names = new Set<string>();
  for (const p of state.players) {
    if (p.id === o.player) continue;
    for (const id of state.zones.hand[p.id] ?? []) if (!text.includes(`"${id}"`)) handIds.push(id);
    for (const id of state.zones.library[p.id] ?? []) {
      const name = state.defs[state.objects[id]!.defId]?.name;
      if (name && !text.includes(name)) names.add(name);
    }
  }
  return { handIds, libraryNames: [...names] };
}

export interface SeatSecrets {
  /** The seat's session id, token and deck fingerprint, and its decklist as sent. */
  session: string;
  token: string;
  deckHash: string;
  deck: HostedDeck;
}

/**
 * Scans every frame one seat received over the transport (design 6.4, whole stack): the states of the game come from replaying its stored log; a frame
 * received while the seat held the view of seq k is checked against the state at k. No frame may carry the real id of another seat's hidden hand card
 * (now or before, unless the seat was shown it), the name of a hidden card of another seat it was never shown, the seed, the RNG state, a suspended
 * action, another seat's session id, token, deck fingerprint or decklist. Returns how many frames were scanned.
 */
export function scanSeatFrames(o: { config: GameConfig; records: { action: Parameters<typeof applyAction>[1] }[]; frames: readonly string[]; player: PlayerId; others: SeatSecrets[] }): number {
  const states: GameState[] = [createGame(o.config)];
  for (const r of o.records) {
    const out = applyAction(states[states.length - 1]!, r.action);
    expect(out.error, 'the stored log replays').toBeFalsy();
    states.push(out.state);
  }
  const known = new Set<string>();
  const seen = new Set<string>();
  const everHidden = new Set<string>();
  let seq = 0;
  let view: GameView | null = null;
  let viewSeq = -1;
  let hiddenUpTo = -1;
  const noteHidden = (k: number) => {
    for (let i = hiddenUpTo + 1; i <= k && i < states.length; i++) {
      const s = states[i]!;
      for (const p of s.players) {
        if (p.id === o.player) continue;
        for (const id of s.zones.hand[p.id] ?? []) {
          const obj = s.objects[id];
          if (obj && !canSee(s, obj, o.player)) everHidden.add(id);
        }
      }
    }
    hiddenUpTo = Math.max(hiddenUpTo, k);
  };
  for (const text of o.frames) {
    const m = JSON.parse(text) as Msg;
    if (m.t === 'view' || m.t === 'patch') {
      const next: { seq: number; view: GameView } | null = m.t === 'view' ? { seq: m.seq, view: m.view } : nextView(view ? { seq: viewSeq, view } : null, m);
      if (next) {
        view = next.view;
        viewSeq = next.seq;
        seq = Math.min(next.seq, states.length - 1);
        for (const d of Object.values(view.defs)) known.add(d.name);
        for (const [id, ob] of Object.entries(view.objects)) if (ob.zone !== 'library' && (ob.zone !== 'hand' || ob.owner === o.player)) seen.add(id);
      }
    }
    const state = states[seq]!;
    noteHidden(seq);
    expect(text.includes(state.seed), 'the seed never leaves the server').toBe(false);
    expect(text.includes('"suspended"'), 'no suspended action').toBe(false);
    expect(text.includes('"rng"'), 'no RNG state').toBe(false);
    for (const other of o.others) {
      expect(text.includes(other.session), "another seat's session id").toBe(false);
      expect(text.includes(other.token), "another seat's token").toBe(false);
      expect(text.includes(other.deckHash), "another seat's deck fingerprint").toBe(false);
      expect(text.includes(JSON.stringify(other.deck.main)), "another seat's decklist").toBe(false);
    }
    for (const id of everHidden) if (!seen.has(id)) expect(text.includes(`"${id}"`), `the real id ${id} of another seat's hidden hand card`).toBe(false);
    const names = new Set<string>();
    for (const p of state.players) {
      if (p.id === o.player) continue;
      for (const zone of ['hand', 'library'] as const) {
        for (const id of state.zones[zone][p.id] ?? []) {
          const ob = state.objects[id];
          if (!ob || canSee(state, ob, o.player)) continue;
          const name = state.defs[ob.defId]?.name;
          if (name && !known.has(name)) names.add(name);
        }
      }
    }
    if (names.size) {
      const hit = new RegExp(String.raw`\b(?:${[...names].map(escapeRe).join('|')})\b`).exec(text);
      expect(hit?.[0], 'the name of a hidden card of another seat this seat was never shown').toBeUndefined();
    }
  }
  return o.frames.length;
}
