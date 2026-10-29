/**
 * The runtime's contract (design 2.1-2.3, D3-D5, D15; package M13-5): the game workers that run the table actors, routing by game id, the main thread's
 * mailboxes, the group commit, snapshots, recovery, the watchdog and quarantine, drain, the deck pool, and the capacity signals for admission.
 *
 * Who calls what:
 * - **The gateway and tables (M13-6)** start games (`TableRouter.start`, after admission and the ready check; the tables layer has created the `games`
 *   row with `GameStore.createGame` and the runtime moves it to 'running' with `startGame`), pass every seated connection's message to its table
 *   (`TableRouter.submit`), receive the seats' payloads through `RuntimeEvents.deliver` (already committed: write-ahead), learn when a game ended
 *   (`RuntimeEvents.ended`: the ledger row is written; free the capacity units, keep the table for "good game" chat) and when it was unloaded, and
 *   check decks with `DeckPool.prepare`.
 * - **Admission (M13-10)** reads `SignalSource.read(now)` (admission/api.ts): running units, worker CPU, p95 action time, worker heap, outbound budget
 *   (the gateway's figure, passed in as `RuntimeOptions.outbound`).
 * - **The process (main.ts, M13-6)** builds one `GameRuntime` (runtime.ts) with the store, starts it (which recovers every running game), drains it on
 *   SIGTERM (`drain`) and closes it.
 *
 * Threads: the main thread keeps every table's mailbox, its in-flight message, the commit batch and the timer wheel; game workers (`src/worker.ts`) hold
 * the actors (one per table, a table pinned to one worker for its life) and handle one message at a time; deck workers (`src/deck-worker.ts`) run
 * `prepareDeck` with the server's card index.
 *
 * Write-ahead (D4): a step's records are committed (`GameStore.appendRecords`, group commit of many tables, each game isolated) before any of its sends is
 * delivered; a table's next message is not given to its worker before its previous step committed, so nothing outruns the log. A commit that fails (after
 * one retry) voids that table only (`void { reason: 'commit' }`). Snapshots are written after their record committed (review 8).
 */
import type { GameConfig } from '@openmtg/engine';
import type { DeckSubmission, PrepareResult, PreparedDeck } from '@openmtg/net/server-kit';
import type { ClockSettings, HostedFormatId, SeatNumber, TableSize, TableSource } from '../api';
import type { SignalSource, UnitWeights } from '../admission/api';
import type { LedgerSeat } from '../ledger/record';
import type { GameRecord, VoidReason } from '../ledger/types';
import type { Logger, LogLevel, LogValue, Metrics } from '../obs';
import type { GameStore, LogRecord } from '../store/api';
import type { TableLimits } from '../table/limits';
import type { OutagePolicy } from './outage';
import type { SeatSend, TableCommand, TableEnd, TableStep } from '../table/types';

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Seat input and game starts

type SeatCommand = Exclude<TableCommand, { t: 'tick' } | { t: 'void' }>;
type WithoutAt<T> = T extends unknown ? Omit<T, 'at'> & { at?: number } : never;

/**
 * A seated connection's message for its table (`act`, `vote`, `leave`, `chat`, `sync`, `connect`, `disconnect`): a `TableCommand` whose `at` is
 * optional (absent: the runtime's `now()` when it was submitted). `tick` and `void` are the runtime's own.
 */
export type SeatInput = WithoutAt<SeatCommand>;

/** One seat of a game to start: who sits there (for the ledger) and the deck the deck pool prepared. */
export interface StartSeat {
  seat: SeatNumber;
  /** The display name at the start (shown as "Name (guest)" by the client). */
  name: string;
  /** The guest session id (never the token). */
  session: string;
  /** Milestone 14; null in milestone 13. */
  account?: string | null;
  /** `DeckPool.prepare`'s deck. */
  deck: PreparedDeck;
  /** `deckFingerprint` of the deck (the HMAC with `LEDGER_SECRET`; `SeatRow.deckHash`). */
  deckHash: string;
}

/** A game start (admitted, the ready check passed). The `games` row exists (`createGame`); the runtime calls `startGame` with the config. */
export interface StartGameRequest {
  /** The table's game id (a ULID). */
  game: string;
  format: HostedFormatId;
  source: TableSource;
  /** 2-4 seats (pods need milestone 12's engine: the engine of this base refuses more than two players). */
  seats: StartSeat[];
  /** 128 random bits as hex (default: `newTableSeed()`). Tests pass one. */
  seed?: string;
  /** The table's clocks (default: the design's for the table size; tables pass `clockFor(config.clocks, format, seats)`). */
  clock?: ClockSettings;
  /** Overrides of the table's size limits and caps (tests). */
  limits?: Partial<TableLimits>;
  /** Seats connected at the start (default: all). */
  connected?: SeatNumber[];
  rulesPack?: string | null;
  /** The start's server time (default `now()`). */
  at?: number;
}

export type StartGameResult =
  | { ok: true; game: string; worker: number; seating: SeatNumber[] }
  /** 'busy': the store is failing now (an outage: starts wait until it answers again; admission sees it as the 'store' signal). */
  | { ok: false; reason: 'draining' | 'exists' | 'closed' | 'failed' | 'busy'; message: string };

/**
 * What the runtime needs of a table besides its log to finish or recover it: the ledger's game and seats (session ids, deck fingerprints) and the
 * table's settings. Kept in memory for games started in this process; after a restart the runtime asks `TableDirectory.meta`.
 */
export interface TableMeta {
  game: string;
  format: HostedFormatId;
  source: TableSource;
  seats: TableSize;
  /** The game's start (server time, ms). */
  startedAt: number;
  /** Every seat: session, account, deck fingerprint (`LedgerSeat`). */
  ledgerSeats: LedgerSeat[];
  clock?: ClockSettings;
  limits?: Partial<TableLimits>;
}

/**
 * Where a restarted runtime finds the `TableMeta` of a game it recovers (M13-6 implements it from the `games` and `seats` rows). Null: unknown (the game
 * is void, reason 'recovery').
 */
export interface TableDirectory {
  meta(game: string): Promise<TableMeta | null>;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Events to the gateway

/**
 * How a game ended, once the store has it: its ledger row was written (`record`), or the runtime voided it itself (`record` null: the store built the
 * void row from the committed records). The runtime retries the store first (through an outage too, up to `voidRetryMs`), so `ended` reports a game the
 * store still has as running only with `pending: true` (the void is kept in the pending-voids file and applied by the next `open()`); if the process
 * stops first, nothing is reported and the next `open()` applies it.
 */
export interface TableEnded {
  game: string;
  end: TableEnd;
  /** The ledger's record (`writeResult`); null when it could not be written (logged for the developer). */
  record: GameRecord | null;
  status: 'finished' | 'void' | 'quarantined';
  /** The capacity units the game held (admission's `freed`). */
  units: number;
  /**
   * M13-5 re-review: the runtime's void could not be saved (the store refused it for good, or stayed unreachable past `voidRetryMs`). It is kept in the
   * pending-voids file and applied by the next `open()`; the table is quarantined in this process (never placed again) and its players were told.
   */
  pending?: boolean;
}

export interface RuntimeEvents {
  /**
   * Messages for a table's seats, in order, each a JSON text ready for the socket (`SeatSend`). Called only after the records they derive from have
   * committed. Seats that are not connected are the gateway's to skip.
   */
  deliver(game: string, sends: readonly SeatSend[]): void;
  /** The game ended (won, drawn or void, quarantine included); its ledger row is written. The table stays loaded for chat until `unloaded`. */
  ended?(e: TableEnded): void;
  /** The table was rebuilt by recovery (a replaced worker, or a restart); seats the runtime knew as connected get a `connect` (a full view). */
  recovered?(game: string, o: { cause: RecoveryCause; seq: number; fromSnapshot: number | null }): void;
  /** The table left memory (10 minutes after its end, every seat left, a quarantine, or close). Messages for it are refused from now on. */
  unloaded?(game: string): void;
}

export type RecoveryCause = 'restart' | 'worker';

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The router (M13-6's view of the runtime)

/** Server-only diagnostics of one table (tests, the developer): never sent to a player. */
export interface TableInspection {
  game: string;
  worker: number;
  /** Records applied (the last record's seq). */
  seq: number;
  /** The checkpoint hash of the live state (SHA-256 of the state JSON without defs). */
  hash: string;
  ended: boolean;
  engineErrors: number;
}

export interface DrainReport {
  /** Games that ended by themselves while draining. */
  finished: number;
  /** Games still running at `DRAIN_MAX_MINUTES`, voided ('updated'). */
  voided: string[];
}

export interface TableRouter {
  /** Starts an admitted game on the least-loaded game worker (capacity units); the first views go to the connected seats. Refused while draining. */
  start(req: StartGameRequest): Promise<StartGameResult>;
  /**
   * Queues a seated connection's message for its table (mailbox order: the table's messages are handled one at a time, in order). False when the
   * table is not loaded here (unknown, unloaded or quarantined): the gateway answers `noTable`.
   */
  submit(game: string, input: SeatInput): boolean;
  /** The game worker a table is placed on (fixed for its life, until a recovery re-places it), or null. */
  locate(game: string): number | null;
  /** Tables loaded here (running or ended and still kept for chat). */
  has(game: string): boolean;
  /** The table's live state digest (after its queued messages). Null when it is not loaded. */
  inspect(game: string): Promise<TableInspection | null>;
  /** Draining (design 2.3): no new starts; running games go on until they end, at most `drainMaxMinutes`. */
  readonly draining: boolean;
  drain(): Promise<DrainReport>;
}

/** The deck pool (design 2.1): `prepareDeck` with the server's card index, off the main thread; a bounded queue and a deadline per deck. */
export interface DeckPool {
  /**
   * Resolves, validates for `format` and compiles a decklist (never throws for bad input). `busy` when the queue is full (the gateway answers `busy`).
   * F32 (INTERFACE CHANGE, additive): `session`, the session asking (create, join, queue): its deck checks are paced (`rateLimited` past its bucket);
   * none for the server's own checks (a restart's lobby decks). A list already checked for the format within a few minutes is answered from a cache,
   * without a worker and without a token.
   */
  prepare(deck: DeckSubmission, format: string, session?: string): Promise<DeckResult>;
}

export type DeckResult =
  | PrepareResult
  | { ok: false; errors: string[]; warnings: string[]; busy: true }
  | { ok: false; errors: string[]; warnings: string[]; timeout: true }
  | { ok: false; errors: string[]; warnings: string[]; rateLimited: true; retryAfterMs: number };

/** The runtime as the process sees it. */
export interface Runtime extends TableRouter, DeckPool, SignalSource {
  /**
   * Spawns the workers (and waits until they are ready), applies the voids an earlier process decided but could not save (`pendingVoidsFile`), and
   * recovers every game the store has as running. Call once, before anything else. Throws when the store stays unreachable past the outage bound.
   */
  open(): Promise<RecoveryReport>;
  /** Readiness (`/readyz`): workers answering, the store reachable, not draining. */
  ready(): { ok: boolean; reasons: ('workers' | 'store' | 'draining' | 'closed')[] };
  /** Stops timers and workers. Pending commits finish first; running games stay 'running' in the store (the next start recovers them). */
  close(): Promise<void>;
}

export interface RecoveryReport {
  recovered: string[];
  /** Voided or quarantined instead (with the reason). */
  voided: { game: string; reason: VoidReason }[];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Options

/** A module that makes the deck workers' card source (`export async function createCardSource(options)`: a net `CardSource`). */
export interface CardSourceSpec {
  /** A file URL or a package specifier, imported inside each deck worker. */
  module: string;
  /** Structured-cloneable options for the factory (the default module reads `{ cacheDir }`). */
  options?: unknown;
}

/** The runtime's tunables: RUNTIME_LIMITS (config.ts) and the design's figures by default; tests shorten them. */
export interface RuntimeTuning {
  /** The watchdog (D15): a worker message past this terminates the worker. Default 5,000 ms. */
  watchdogMs: number;
  /** Group commit: every this many ms or `commitMaxRecords` records. Default 10 ms and 64. */
  commitEveryMs: number;
  commitMaxRecords: number;
  /** Deck pool: per-deck deadline and queue bound. Default 10 s and 64. */
  deckDeadlineMs: number;
  deckQueue: number;
  /** Game workers' heap (`resourceLimits.maxOldGenerationSizeMb`). Default 1,280. */
  workerHeapMb: number;
  /** A table needing this many recoveries is quarantined instead (D5). Default 2. */
  maxRecoveries: number;
  /** An ended table stays loaded this long for chat (design 2.2 step 7). Default 10 minutes. */
  unloadAfterMs: number;
  /** Drain's limit (`DRAIN_MAX_MINUTES`, default 250). */
  drainMaxMinutes: number;
  /** A game recorded under another engine build: replay comparing checkpoint hashes ('verify', default) or void it at once ('void'). */
  otherBuild: 'verify' | 'void';
  /** Samples before the p95 action time is reported (admission's signal). Default 20. */
  p95MinSamples: number;
  /** Store outages (owner, 2026-10-15): pause and retry up to 60 s (0.25 s doubling to 5 s), a notice to waiting seats after 3 s. */
  outage: OutagePolicy;
  /** How long the runtime's own void is retried through an outage before it is left pending for the next start (default 5 minutes). */
  voidRetryMs: number;
  /** A recovery's replay in all, besides the per-record watchdog (default 60 s): past it the worker is terminated, the table quarantined. */
  recoveryBudgetMs: number;
  /** A table that used more worker time than this in a minute is logged (`tableHot`; default 20 s). */
  hotTableMs: number;
  /** A worker that dies before it is ready is replaced after this backoff (1 s doubling to 30 s). */
  respawnFirstMs: number;
  respawnCapMs: number;
}

export interface RuntimeOptions {
  store: GameStore;
  events: RuntimeEvents;
  /** After a restart: where the tables' ledger seats and settings come from. Without it a recovered game that ends cannot be written: void. */
  directory?: TableDirectory;
  /** Game workers (`WORKERS`; default vCPUs - 1, at least 1). */
  workers?: number;
  /** Deck workers (`DECK_WORKERS`; default 1). 0: no deck pool (prepare answers busy). */
  deckWorkers?: number;
  /** The deck workers' card source (default: the cards package's index at `cardDataDir`). */
  cards?: CardSourceSpec;
  /** `CARD_DATA_DIR` for the default card source. */
  cardDataDir?: string | null;
  /** This process's engine build (default net's `localVersions().build`). */
  engineBuild?: string;
  /** Server time in ms (default Date.now). The watchdog and CPU figures use the real monotonic clock whatever this is. */
  now?: () => number;
  logger?: Logger;
  metrics?: Metrics;
  tuning?: Partial<RuntimeTuning>;
  /** The gateway's outbound budget in use, 0..1 (admission's signal; default 0). */
  outbound?: () => number;
  /**
   * The capacity units per table size, `HostedConfig.units` (`UNITS_1V1`, `UNITS_POD3`, `UNITS_POD4`; default 1, 4, 5). Running units (admission's signal), a
   * game's units in `TableEnded.units` and recovered games all count with these, so running, reserved and freed units are one system (M13-10 review).
   */
  units?: Readonly<UnitWeights>;
  /** `StartRow.node` (milestone 16's lease); null with one process. */
  node?: string | null;
  /** Test-only worker operations (`hang`, `exit`, `poison`); never set in production. */
  testHooks?: boolean;
  /** Where pending voids are kept across a restart (a JSON file in `DATA_DIR`); absent: in memory only (tests, the memory store). */
  pendingVoidsFile?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Worker messages (main thread <-> src/worker.ts, src/deck-worker.ts)

/** A checkpoint as it crosses the thread boundary: the state JSON gzipped in the worker (a snapshot's `state`). */
export interface WireCheckpoint {
  seq: number;
  hash: string;
  gz: Uint8Array;
}

/** `TableStep` with its checkpoint compressed. */
export type WireStep = Omit<TableStep, 'checkpoint'> & { checkpoint: WireCheckpoint | null };

/** A worker's heap after a message (`v8.getHeapStatistics`). */
export interface HeapReading {
  used: number;
  limit: number;
}

export interface WorkerTableSettings {
  clock?: ClockSettings;
  limits?: Partial<TableLimits>;
}

export type GameWorkerRequest =
  | ({ kind: 'start'; id: number; game: string; config: GameConfig; seating: SeatNumber[]; at: number; connected?: SeatNumber[] } & WorkerTableSettings)
  | { kind: 'command'; id: number; game: string; cmd: TableCommand }
  | ({
      kind: 'recover'; id: number; game: string; config: GameConfig; seating: SeatNumber[]; at: number;
      /** Every committed record from the first. */
      records: LogRecord[];
      /** The newest snapshot (same engine build only); the replay starts there when it checks out. */
      snapshot: { seq: number; hash: string; state: Uint8Array } | null;
    } & WorkerTableSettings)
  | { kind: 'inspect'; id: number; game: string }
  | { kind: 'unload'; id: number; game: string }
  /**
   * Test hooks (`RuntimeOptions.testHooks`): block the worker for `ms` as a stuck action would; end the worker thread right after answering (a crash
   * between messages: no suspect); make the table's next command end the thread (a crash while handling it, as a poison action's out-of-memory exit).
   */
  | { kind: 'hang'; id: number; game: string; ms: number }
  | { kind: 'exit'; id: number; game: string; code: number }
  | { kind: 'poison'; id: number; game: string };

export type GameWorkerReply =
  | { kind: 'ready' }
  | { kind: 'step'; id: number; game: string; step: WireStep; seq: number; engineErrors: number; heap: HeapReading }
  | {
      kind: 'recovered'; id: number; game: string; step: WireStep; seq: number; engineErrors: number; heap: HeapReading;
      /** Records whose checkpoint hash differs from the replayed state's. */
      mismatches: number[];
      /** The snapshot the replay started from, or null (from the first record). */
      fromSnapshot: number | null;
    }
  /** A start or recovery threw (the table is not loaded in the worker). */
  | { kind: 'failed'; id: number; game: string; error: string }
  /** One replayed record (each has the watchdog's deadline). */
  | { kind: 'progress'; id: number; game: string; seq: number }
  | { kind: 'inspected'; id: number; game: string; info: Omit<TableInspection, 'worker'> | null }
  | { kind: 'done'; id: number; game: string }
  | { kind: 'log'; level: LogLevel; event: string; fields: Record<string, LogValue> };

/** The game worker's `workerData`. */
export interface GameWorkerData {
  index: number;
  testHooks: boolean;
}

export type DeckWorkerRequest = { kind: 'prepare'; id: number; deck: DeckSubmission; format: string };
export type DeckWorkerReply =
  | { kind: 'ready' }
  | { kind: 'prepared'; id: number; result: PrepareResult }
  | { kind: 'failed'; id: number; error: string }
  /** The card source could not be made: the pool answers every deck with an error. */
  | { kind: 'broken'; error: string };

export interface DeckWorkerData {
  cards: CardSourceSpec;
}

/** Both workers are started through `runtime/boot.mjs` with this `workerData` (it registers the TypeScript loader, then imports `entry`). */
export interface BootData<T> {
  entry: string;
  data: T;
}
