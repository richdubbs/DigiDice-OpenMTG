/**
 * Test harness for the runtime (package M13-5; in process, worker threads, no sockets): a `Driver` plays the gateway and the browsers. It receives each
 * table's deliveries (`RuntimeEvents.deliver`), keeps every seat's view as a browser does (full views and patches), and plays computer players
 * (`@openmtg/ai`, choosing from the seat's own view) by submitting their actions to the runtime, each with its table's own server time (so a table's
 * commands, and so its records and messages, are the same whatever else runs). By-hand proposals are approved by the other seats.
 */
import { createHash } from 'node:crypto';
import { chooseAction } from '@openmtg/ai';
import type { GameView, LegalAction, PlayerId } from '@openmtg/engine';
import type { PreparedDeck } from '@openmtg/net/server-kit';
import { nextView, type HostedServerMessage, type ResultMessage, type SeatNumber } from '../../src/api';
import { GameRuntime, type RuntimeEvents, type RuntimeOptions, type SeatInput, type StartGameRequest, type StartSeat, type TableEnded } from '../../src/runtime';
import { TableActor, tableConfig, type TableCommand } from '../../src/table';
import type { GameRecord } from '../../src/ledger/types';
import type { GameStore, LogRecord, NewGameRow } from '../../src/store/api';
import { compiledDefs } from '../../../engine/test/fixtures';
import { DECKS, expand, type DeckList } from '../../../ai/test/decks';

export { DECKS };
/**
 * The tables' start time: the real time when the tests load (whole seconds). A table's own time runs ahead of it (700 ms a move), so its clock's
 * deadlines are never due by the real clock unless a test makes them so; two runs of the same table in one test run use the same times.
 */
export const T0 = Math.floor(Date.now() / 1000) * 1000;
export const FIXTURE_CARDS = new URL('./fixture-cards.ts', import.meta.url).href;

type Msg = HostedServerMessage;

export function hex64(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const DEF_CACHE = new Map<string, PreparedDeck['defs'][number]>();
/** A deck as the deck pool prepares it (def ids are Oracle names), from an AI test deck. */
export function preparedDeck(d: DeckList): PreparedDeck {
  const names = [...new Set(d.map(([n]) => n))];
  const missing = names.filter((n) => !DEF_CACHE.has(n));
  for (const def of compiledDefs(missing)) DEF_CACHE.set(def.id, def);
  return { main: expand(d), sideboard: [], commanders: [], defs: names.map((n) => DEF_CACHE.get(n)!), warnings: [] };
}

export function startSeats(game: string, d1: DeckList, d2: DeckList): StartSeat[] {
  return [
    { seat: 1, name: 'One', session: `s-${game}-1`, deck: preparedDeck(d1), deckHash: hex64(`${game}|1`) },
    { seat: 2, name: 'Two', session: `s-${game}-2`, deck: preparedDeck(d2), deckHash: hex64(`${game}|2`) },
  ];
}

/** The `games` row the tables layer (M13-6) creates before a start. */
export function lobbyRow(game: string, at = T0): NewGameRow {
  const seat = (n: 1 | 2) => ({
    seat: n, player: null, session: `s-${game}-${n}`, name: n === 1 ? 'One' : 'Two', deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [] },
    deckHash: hex64(`${game}|${n}`), inviteHash: null, joinedAt: new Date(at), leftAt: null,
  });
  return { id: game, format: 'casual', variant: null, seats: 2, source: 'listed', title: `Table ${game}`, passwordHash: null, passwordSalt: null, createdAt: new Date(at), seatRows: [seat(1), seat(2)] };
}

export interface Browser {
  seat: SeatNumber;
  player: PlayerId | null;
  seq: number;
  view: GameView | null;
  legal: LegalAction[];
  nextId: number;
  /** The id of the act waiting for its reply. */
  waiting: number | null;
}

/** What an `AiTable` submits to: the runtime, or the in-process actor of `playLocal`. */
export interface Submitter {
  runtime: { submit(game: string, input: SeatInput): boolean };
}

export class AiTable {
  readonly seats = new Map<SeatNumber, Browser>();
  /** Every message delivered, as `seat:json` (determinism). */
  readonly transcript: string[] = [];
  readonly refusals: string[] = [];
  result: ResultMessage | null = null;
  ended: TableEnded | null = null;
  moves = 0;
  /** Stop choosing after this many moves (null: play to the end). 0 until `play`: a table does nothing until told. */
  limit: number | null = 0;
  private waiters: (() => void)[] = [];

  constructor(readonly driver: Submitter, readonly game: string, public at: number, readonly stepMs = 700) {
    for (const seat of [1, 2] as SeatNumber[]) this.seats.set(seat, { seat, player: null, seq: -1, view: null, legal: [], nextId: 1, waiting: null });
  }

  get over(): boolean {
    return this.result !== null || this.ended !== null;
  }

  /** Resolves when the game is over, or the move limit is reached and nothing is waiting. */
  idle(): Promise<void> {
    if (this.quiet()) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  private quiet(): boolean {
    if (this.over) return true;
    return this.limit !== null && this.moves >= this.limit && [...this.seats.values()].every((b) => b.waiting === null);
  }

  private wake(): void {
    if (!this.quiet()) return;
    for (const w of this.waiters.splice(0)) w();
  }

  /** Plays (or goes on playing) until `moves` moves in all, or to the end with null. */
  play(moves: number | null): Promise<void> {
    this.limit = moves;
    this.act();
    return this.idle();
  }

  /** Every seat (re)connects: a full view each (after a restart). */
  connectAll(): void {
    for (const b of this.seats.values()) {
      b.waiting = null;
      this.driver.runtime.submit(this.game, { t: 'connect', seat: b.seat, at: this.at });
    }
  }

  receive(sends: readonly { seat: SeatNumber; t: string; json: string }[]): void {
    for (const s of sends) {
      this.transcript.push(`${s.seat}:${s.json}`);
      const b = this.seats.get(s.seat)!;
      const m = JSON.parse(s.json) as Msg;
      switch (m.t) {
        case 'start':
          for (const p of m.players) this.seats.get(p.seat)!.player = p.id;
          break;
        case 'view':
          b.view = m.view;
          b.seq = m.seq;
          b.legal = m.legal;
          b.player = m.view.viewer;
          break;
        case 'patch': {
          const next = nextView(b.view ? { seq: b.seq, view: b.view } : null, m);
          if (!next) throw new Error(`${this.game} seat ${b.seat}: a patch ${m.base}->${m.seq} that does not fit ${b.seq}`);
          b.view = next.view;
          b.seq = next.seq;
          b.legal = m.legal;
          break;
        }
        case 'reply':
          if (b.waiting === m.id) b.waiting = null;
          if (!m.ok) this.refusals.push(`${b.seat}:${m.error.code}`);
          break;
        case 'proposal':
          this.driver.runtime.submit(this.game, { t: 'vote', seat: b.seat, id: b.nextId++, proposal: m.proposal.id, accept: true, at: this.at });
          break;
        case 'result':
          this.result = m;
          break;
        default:
          break;
      }
    }
    this.act();
    this.wake();
  }

  onEnded(e: TableEnded): void {
    this.ended = e;
    this.wake();
  }

  private act(): void {
    if (this.over || (this.limit !== null && this.moves >= this.limit)) return;
    for (const b of this.seats.values()) {
      if (b.waiting !== null || !b.view || !b.player) continue;
      const d = b.view.pending;
      if (!d || d.player !== b.player) continue;
      const action = chooseAction(b.view, d, `${this.game}-${b.player}`);
      this.at += this.stepMs;
      const id = b.nextId++;
      b.waiting = id;
      this.moves++;
      if (!this.driver.runtime.submit(this.game, { t: 'act', seat: b.seat, id, seq: b.seq, action, at: this.at })) b.waiting = null;
      return;
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A store wrapper for the write-ahead checks: it notes every record the store has committed (`game:seq`; group commits and `finishGame`'s last record),
 * can delay each group commit, and can refuse the records `fail` picks (as a store refuses a value: that game fails, the others commit).
 */
export function spyStore(base: GameStore, o: { delayMs?: number; fail?: (r: LogRecord) => boolean } = {}) {
  const committed = new Set<string>();
  const finished = new Set<string>();
  const counts = { appends: 0, records: 0 };
  const store = new Proxy(base, {
    get(target, prop, recv) {
      if (prop === 'appendRecords') {
        return async (batch: LogRecord[]) => {
          counts.appends++;
          counts.records += batch.length;
          if (o.delayMs) await sleep(o.delayMs);
          const bad = new Set(o.fail ? batch.filter(o.fail).map((r) => r.game) : []);
          const good = batch.filter((r) => !bad.has(r.game));
          const r = good.length ? await target.appendRecords(good) : { committed: [], failed: [] };
          for (const rec of good) if (r.committed.includes(rec.game)) committed.add(`${rec.game}:${rec.seq}`);
          return { committed: r.committed, failed: [...r.failed, ...[...bad].map((game) => ({ game, error: 'StoreError: value refused' }))] };
        };
      }
      if (prop === 'finishGame') {
        return async (id: string, record: GameRecord, last?: LogRecord) => {
          await target.finishGame(id, record, last);
          if (last) committed.add(`${id}:${last.seq}`);
          finished.add(id);
        };
      }
      const v = Reflect.get(target, prop, recv) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  return { store, committed, finished, counts };
}

/** The gateway's side for tests: routes deliveries to `AiTable`s and keeps an event log. */
export class Driver {
  readonly tables = new Map<string, AiTable>();
  readonly ended = new Map<string, TableEnded>();
  readonly recovered: { game: string; cause: string; fromSnapshot: number | null }[] = [];
  readonly unloaded: string[] = [];
  /** Hooks for the write-ahead check: each delivery, in order. */
  onDeliver: ((game: string, sends: readonly { seat: SeatNumber; t: string; json: string }[]) => void) | null = null;
  runtime!: GameRuntime;

  readonly events: RuntimeEvents = {
    deliver: (game, sends) => {
      this.onDeliver?.(game, sends);
      this.tables.get(game)?.receive(sends);
    },
    ended: (e) => {
      this.ended.set(e.game, e);
      this.tables.get(e.game)?.onEnded(e);
    },
    recovered: (game, o) => {
      this.recovered.push({ game, cause: o.cause, fromSnapshot: o.fromSnapshot });
    },
    unloaded: (game) => {
      this.unloaded.push(game);
    },
  };

  /** A runtime with this driver's events. */
  make(o: Omit<RuntimeOptions, 'events'>): GameRuntime {
    this.runtime = new GameRuntime({ engineBuild: 'build-test', deckWorkers: 0, ...o, events: this.events });
    return this.runtime;
  }

  table(game: string, at = T0): AiTable {
    const t = new AiTable(this, game, at);
    this.tables.set(game, t);
    return t;
  }

  /** Creates the lobby row and starts an AI game of two decks. */
  async start(store: GameStore, game: string, d1: DeckList, d2: DeckList, o: Partial<StartGameRequest> = {}): Promise<AiTable> {
    await store.createGame(lobbyRow(game));
    const t = this.table(game);
    const r = await this.runtime.start({ game, format: 'casual', source: 'listed', seats: startSeats(game, d1, d2), seed: `seed-${game}`, at: T0, ...o });
    if (!r.ok) throw new Error(`start ${game}: ${r.message}`);
    return t;
  }
}

/**
 * The same table without workers, store or runtime: `TableActor` in process, commands handled one at a time in submission order (each in a later macrotask,
 * as the runtime's are). The transcript of a table played here and through the runtime must be the same, byte for byte.
 */
export async function playLocal(game: string, d1: DeckList, d2: DeckList, moves: number | null = null): Promise<AiTable> {
  const { config, seating } = tableConfig('casual', startSeats(game, d1, d2).map((s) => ({ seat: s.seat, name: s.name, deck: s.deck })), `seed-${game}`);
  const queue: TableCommand[] = [];
  let actor: TableActor | null = null;
  let running = false;
  const pump = () => {
    if (running || !actor) return;
    running = true;
    setImmediate(() => {
      running = false;
      const cmd = queue.shift();
      if (!cmd) return;
      const step = actor!.handle(cmd);
      if (step.sends.length) table.receive(step.sends);
      pump();
    });
  };
  const host: Submitter = {
    runtime: {
      submit(_game, input) {
        queue.push({ ...input, at: input.at ?? T0 } as TableCommand);
        pump();
        return true;
      },
    },
  };
  const table = new AiTable(host, game, T0);
  table.limit = moves;
  const started = TableActor.start({ game, config, seating, at: T0 });
  actor = started.actor;
  table.receive(started.step.sends);
  await table.play(moves);
  while (queue.length || running) await new Promise((r) => setTimeout(r, 5));
  return table;
}
