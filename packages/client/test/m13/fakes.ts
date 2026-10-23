/**
 * Fakes for the hosted client tests (M13-11): a fake WebSocket the test drives as the hosted server would (it answers `hello` with `welcome`, then the
 * test pushes what the server would send), builders for the server's messages, and real views of a small game for `view` and `patch` messages.
 * Normal traffic only: nothing malformed, no network, no sockets.
 */
import { GameSession, legalActions, viewFor, type GameEvent, type GameState, type GameView, type PlayerId } from '@openmtg/engine';
import {
  diffViews, HOSTED_PROTOCOL, type ClockView, type HostedServerMessage, type SeatNumber, type SeatView, type TableView, type WelcomeMessage,
} from '@openmtg/hosted/api';
import { HostedLink, type HostedLinkOptions, type SocketLike } from '../../src/hosted/HostedLink';
import { MemoryHostedStorage } from '../../src/hosted/storage';
import { smallConfig } from '../helpers';

export const SERVER = 'ws://127.0.0.1:47700';
export const TOKEN = 'cd'.repeat(32);
export const OTHER_TOKEN = 'ef'.repeat(32);
export const flush = () => new Promise((r) => setTimeout(r, 0));

export class FakeHostedSocket implements SocketLike {
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closedWith = { ...(code !== undefined ? { code } : {}), ...(reason !== undefined ? { reason } : {}) };
  }

  // ---- the server's side

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  push(m: HostedServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(m) });
  }

  raw(data: unknown): void {
    this.onmessage?.({ data });
  }

  drop(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  /** The commands sent of type `t`, oldest first. */
  all(t: string): (Record<string, unknown> & { id: number })[] {
    return this.sent.filter((x) => x['t'] === t) as (Record<string, unknown> & { id: number })[];
  }

  /** The last command sent of type `t`. */
  last(t: string): Record<string, unknown> & { id: number } {
    const m = this.all(t).pop();
    if (!m) throw new Error(`no ${t} command was sent (sent: ${this.sent.map((x) => String(x['t'])).join(', ')})`);
    return m;
  }

  /** Answers the last command of type `t`: ok (with extra fields), or an error. */
  reply(t: string, answer: { ok: true; [k: string]: unknown } | { error: { code: string; message: string; [k: string]: unknown } } = { ok: true }): void {
    const id = this.last(t).id;
    this.push(('error' in answer ? { t: 'reply', id, ok: false, error: answer.error } : { t: 'reply', id, ...answer }) as HostedServerMessage);
  }
}

export const welcomeMsg = (o: Partial<WelcomeMessage> = {}): WelcomeMessage => ({
  t: 'welcome', token: TOKEN, session: 'S1', name: 'Alice', resumed: false,
  server: {
    protocol: HOSTED_PROTOCOL, engineBuild: 'build-test', capacity: 'open',
    formats: [
      { id: 'casual', seats: [2], clock: { bankMs: 900_000, delayMs: 5000, dropMs: 300_000 } },
      { id: 'standard', seats: [2], clock: { bankMs: 900_000, delayMs: 5000, dropMs: 300_000 } },
      { id: 'commander', seats: [2], clock: { bankMs: 900_000, delayMs: 5000, dropMs: 300_000 } },
    ],
  },
  ...o,
});

export const CLOCK = { bankMs: 900_000, delayMs: 5000, dropMs: 300_000 };

export function seatView(seat: SeatNumber, name: string | null, o: Partial<SeatView> = {}): SeatView {
  return { seat, name, connected: name !== null, deckAccepted: name !== null, ready: false, left: false, ...o };
}

/** A table of two seats; `you` is the seat of the session the message goes to. */
export function tableMsg(o: Partial<TableView> = {}): Extract<HostedServerMessage, { t: 'table' }> {
  return {
    t: 'table',
    table: {
      table: 'T1', title: "Alice's table", format: 'casual', variant: null, source: 'private', status: 'lobby',
      seats: [seatView(1, 'Alice'), seatView(2, null)], locked: false, clock: CLOCK, you: 1, creator: 1, createdAt: 1_800_000_000_000, ...o,
    },
  };
}

export const CODE = 'K7Q2-M9XD-4TPA-HW3N';

/**
 * A link on fake sockets. Each socket opens at once and, when `welcome` is given (default: a fresh guest), the "server" answers `hello` with it, as the
 * real one does; `welcomes` overrides the answer for one socket in turn (a reconnect that finds the seat again).
 */
export function fakeHosted(o: { welcome?: WelcomeMessage | null; welcomes?: (WelcomeMessage | null)[]; opts?: Partial<HostedLinkOptions>; storage?: MemoryHostedStorage; manual?: boolean } = {}) {
  const sockets: FakeHostedSocket[] = [];
  const storage = o.storage ?? new MemoryHostedStorage();
  let n = 0;
  const link = new HostedLink({
    server: SERVER,
    name: 'Alice',
    storage,
    pingEveryMs: 0,
    socket: (url) => {
      const s = new FakeHostedSocket(url);
      sockets.push(s);
      const w = o.welcomes?.[n] !== undefined ? o.welcomes[n] : o.welcome !== undefined ? o.welcome : welcomeMsg();
      n++;
      if (!o.manual) {
        queueMicrotask(() => s.open());
        // the server answers the hello
        const send = s.send.bind(s);
        s.send = (data: string) => {
          send(data);
          if ((JSON.parse(data) as { t: string }).t === 'hello' && w) queueMicrotask(() => s.push(w));
        };
      }
      return s;
    },
    ...o.opts,
  });
  return { link, sockets, storage, socket: () => sockets[sockets.length - 1]! };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Views of a small real game

/** Views for `view` and `patch` messages from a real two-player game: seat 1 plays p1, seat 2 plays p2. */
export function gameViews(seed = 'hosted-views') {
  const session = new GameSession(smallConfig(seed));
  const ids = session.state.players.map((p) => p.id);
  let seq = 1;
  let last: Record<string, GameView> = {};
  const viewOf = (state: GameState, me: PlayerId): GameView => viewFor(state, me);
  return {
    session,
    ids,
    get seq() {
      return seq;
    },
    /** The full-view message for `me` at the current state. */
    full(me: PlayerId, events: GameEvent[] = []): Extract<HostedServerMessage, { t: 'view' }> {
      const view = JSON.parse(JSON.stringify(viewOf(session.state, me))) as GameView;
      last[me] = view;
      return { t: 'view', seq, view, events, legal: legalActions(session.state, me) };
    },
    /** The patch message for `me` from the last view `full`/`patch` gave them to the current one. */
    patch(me: PlayerId, base: number, events: GameEvent[] = []): Extract<HostedServerMessage, { t: 'patch' }> {
      const prev = last[me];
      if (!prev) throw new Error('gameViews.patch: no earlier view for this player');
      const view = JSON.parse(JSON.stringify(viewOf(session.state, me))) as GameView;
      last[me] = view;
      return { t: 'patch', seq, base, ops: diffViews(prev, view), events, legal: legalActions(session.state, me) };
    },
    /** Applies the pending player's first sensible answer (a pass, keep, play first) and moves `seq` on; returns the events. */
    step(): GameEvent[] {
      const d = session.state.pending!;
      const action =
        d.kind === 'priority'
          ? { type: 'pass' as const, player: d.player }
          : d.kind === 'playFirst'
            ? { type: 'answer' as const, player: d.player, decisionId: d.id, answer: { kind: 'playFirst' as const, player: d.player } }
            : d.kind === 'mulligan'
              ? { type: 'answer' as const, player: d.player, decisionId: d.id, answer: { kind: 'mulligan' as const, keep: true } }
              : null;
      if (!action) throw new Error(`gameViews.step: no answer for ${d.kind}`);
      const r = session.apply(action);
      if (!r.ok) throw new Error(r.error.message);
      seq++;
      return r.events;
    },
  };
}

export function clockMsg(at: number, seats: { seat: SeatNumber; bankMs?: number; running?: boolean; delayMs?: number; dropMs?: number; dropRunning?: boolean }[], abandonMs?: number): Extract<HostedServerMessage, { t: 'clock' }> {
  const view: ClockView = {
    at,
    seats: seats.map((s) => ({ seat: s.seat, bankMs: s.bankMs ?? 900_000, running: s.running ?? false, delayMs: s.delayMs ?? 0, dropMs: s.dropMs ?? 300_000, dropRunning: s.dropRunning ?? false })),
    ...(abandonMs !== undefined ? { abandonMs } : {}),
  };
  return { t: 'clock', ...view };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Browser storage and Web Locks

/** A `Storage` in memory; `failing` makes every call throw, like a browser that blocks storage. */
export function fakeStorage(failing = false) {
  const data = new Map<string, string>();
  const guard = () => {
    if (failing) throw new Error('storage blocked');
  };
  return {
    data,
    getItem: (k: string) => (guard(), data.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void data.set(k, String(v))),
    removeItem: (k: string) => (guard(), void data.delete(k)),
  };
}

/** `navigator.locks` for several tabs of one browser: a lock is held until `release`; `ifAvailable` answers null when it is taken; waiting requests queue. */
export class FakeLocks {
  private readonly held = new Set<string>();
  private readonly queues = new Map<string, { grant: () => void }[]>();

  request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown> {
    const run = () => {
      this.held.add(name);
      return Promise.resolve(callback({ name }));
    };
    if (!this.held.has(name)) return run();
    if (options.ifAvailable) return Promise.resolve(callback(null));
    return new Promise((resolve, reject) => {
      const entry = { grant: () => void run().then(resolve, reject) };
      this.queues.set(name, [...(this.queues.get(name) ?? []), entry]);
      options.signal?.addEventListener('abort', () => {
        this.queues.set(name, (this.queues.get(name) ?? []).filter((e) => e !== entry));
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  }

  /** The tab that held `name` is gone: the next waiter (if any) gets it. */
  release(name: string): void {
    this.held.delete(name);
    const next = (this.queues.get(name) ?? []).shift();
    next?.grant();
  }

  isHeld(name: string): boolean {
    return this.held.has(name);
  }
}
