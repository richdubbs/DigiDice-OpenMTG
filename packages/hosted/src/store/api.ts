/**
 * Storage behind one interface (design 8, D4, D5, D14). Three implementations by M13-4: `MemoryStore` (unit tests), `FileStore` (a directory: one
 * JSON-lines log per game appended with fsync per batch, a torn last line ignored on load) and `PostgresStore` (`pg`; parameterized queries only; a
 * savepoint per game in each batch; a `SqlClient` seam so the same code runs on PGlite in tests). One contract test suite runs against all three.
 *
 * Rules every implementation keeps:
 * - **Write-ahead, isolated per game** (design 2.3, review 2): `appendRecords` commits a group of records of many games; a game whose rows fail (a value
 *   the database refuses) is reported in `failed` and nothing of it is committed, while the other games commit. The table sends nothing derived from a
 *   record before it is committed.
 * - **Snapshots only for committed records** (review 8): `putSnapshot` is called only after the record of its `seq` committed, and `loadForRecovery`
 *   ignores any snapshot whose `seq` is past the last committed record.
 * - **Secrets**: tokens, invite codes and passwords are stored as hashes only (`tokenHash`, `inviteHash`, `passwordHash` + salt; M13-6: the password hash and
 *   salt are deleted with the table, design 4.3: `startGame` and `voidGame` clear them); the seed only in
 *   `StartRow.seed`, never inside `config`. Client addresses are never stored.
 * - The ledger (`finishGame`'s record) is append-only and written in the same transaction as the final record and the game's status.
 */
import type { Action, CommanderVariant, GameConfig, PlayerId } from '@openmtg/engine';
import type { HostedDeck, HostedFormatId, SeatNumber, TableSize, TableSource } from '../api';
import type { GameRecord, VoidReason } from '../ledger/types';

/** A game's status (the `games.status` column, design 8.2). */
export type GameStatus = 'lobby' | 'waitingCapacity' | 'running' | 'finished' | 'void' | 'quarantined';

export interface SessionRow {
  /** A ULID; public to its own connection, stored with placements. */
  id: string;
  /** SHA-256 of the token, lowercase hex (the token itself is never stored). */
  tokenHash: string;
  name: string;
  createdAt: Date;
  lastSeen: Date;
}

export interface SeatRow {
  seat: SeatNumber;
  /** p1-p4 once the game has started (seating order); null before. */
  player: PlayerId | null;
  /** Null for an open seat. */
  session: string | null;
  name: string | null;
  /** The decklist as sent (names only; private: never shown to another player, never logged). */
  deck: HostedDeck | null;
  /** `deckFingerprint` of the prepared deck. */
  deckHash: string | null;
  /** SHA-256 of this seat's invite code (private tables), until it is spent. */
  inviteHash: string | null;
  joinedAt: Date | null;
  leftAt: Date | null;
}

/** A new table (status 'lobby'). */
export interface NewGameRow {
  id: string;
  format: HostedFormatId;
  variant: CommanderVariant | null;
  seats: TableSize;
  source: TableSource;
  title: string;
  /** scrypt hash and its per-table random salt (hex); both null without a password. */
  passwordHash: string | null;
  passwordSalt: string | null;
  createdAt: Date;
  seatRows: SeatRow[];
}

/**
 * M13-6 INTERFACE CHANGE (additive): a table's `games` row and its `seats` rows as the tables layer reads them back (`tableRow`, `openTables`): the
 * runtime's `TableDirectory` after a restart (each seat's session and deck fingerprint for the ledger) and the lobby tables an earlier process left.
 * Never the seed or the config.
 */
export interface TableRow extends NewGameRow {
  status: GameStatus;
  waitingSince: Date | null;
  startedAt: Date | null;
  /** Seats in seating order once started (`StartRow.seating`); null before. */
  seating: SeatNumber[] | null;
}

/** A change of an unstarted table: its seats, title, password, invite hashes, status and when it began to wait for capacity. */
export interface LobbyPatch {
  title?: string;
  passwordHash?: string | null;
  passwordSalt?: string | null;
  seatRows?: SeatRow[];
  status?: 'lobby' | 'waitingCapacity';
  waitingSince?: Date | null;
}

/** The game's configuration as stored: players, decks, compiled defs and options; never the seed (design 2.4, 8.2). */
export type StoredConfig = Omit<GameConfig, 'seed'>;

/** The start of a game (status 'running'). */
export interface StartRow {
  /** The config with every card definition (a card-data update never changes a running or replayed game), without the seed. */
  config: StoredConfig;
  /** 128 random bits (hex); its own column, never sent to anyone, never in `config`. */
  seed: string;
  /** Seats in seating order (`seating[0]` is p1). */
  seating: SeatNumber[];
  engineBuild: string;
  rulesPack: string | null;
  startedAt: Date;
  /** The game process that owns the table (milestone 16's scale-out lease); null with one process. */
  node: string | null;
}

/** A clock reading of one seat, written with every record (design 5.1: for recovery and the ledger). */
export interface ClockReading {
  seat: number;
  bankMs: number;
  dropMs: number;
  delayMs: number;
  /** The control period's number (design 5.1). */
  period: number;
  /**
   * The seat's logged actions so far (answered decisions and accepted cancels; M13-3). When a game reaches a per-game cap, milestone 15's ranked rules
   * can see who drove it there. Absent in records written before M13-3.
   */
  actions?: number;
}

/** One applied action (design 2.2 step 5, 8.1). */
export interface LogRecord {
  game: string;
  seq: number;
  seat: number;
  action: Action;
  /** Server-applied concessions (design D11) and approved by-hand changes (D12). */
  cause?: 'timeout' | 'disconnect' | 'left' | 'approved';
  approvedBy?: number[];
  clocks: ClockReading[];
  /** Wall-clock game time used so far in milliseconds, outages not counted (M13-3: a recovery resumes the per-game time cap from it, design 2.2, 2.3). */
  elapsedMs: number;
  /** ISO 8601 time of the apply. */
  at: string;
  /** The checkpoint hash (SHA-256 of the canonical state JSON) at every 100th record. */
  check?: string;
}

/** `appendRecords`: the games whose records committed, and the games that failed (none of their records committed; the others are not affected). */
export type AppendResult = { committed: string[]; failed: { game: string; error: string }[] };

export interface SnapshotRow {
  game: string;
  seq: number;
  engineBuild: string;
  /** The checkpoint hash of the state at `seq`. */
  hash: string;
  /**
   * The state JSON without `defs`, gzip. M13-5: the runtime writes its own format (runtime/snapshot.ts): a header line with the card definitions the
   * game added (tokens), then that state JSON; the store keeps the bytes as they are.
   */
  state: Uint8Array;
  createdAt: Date;
}

/** What a recovery needs (design 2.3): the config and seed, the newest valid snapshot, the committed records after it. */
export interface RecoveryData {
  game: string;
  status: GameStatus;
  config: StoredConfig;
  seed: string;
  seating: SeatNumber[];
  engineBuild: string;
  /** The newest snapshot whose `seq` is at most `lastSeq`; null for none. */
  snapshot: SnapshotRow | null;
  /** The committed records after the snapshot (all of them without one), in `seq` order. */
  records: LogRecord[];
  /** The last committed record's `seq` (0 before the first). */
  lastSeq: number;
  /** Recoveries so far (a table recovered twice is quarantined: design D5). */
  recoveries: number;
  engineErrors: number;
}

export interface ReportRow {
  id: string;
  kind: 'bug' | 'title';
  session: string;
  game: string | null;
  seat: number | null;
  /** The player's words (at most 10 KB). */
  text: string;
  /**
   * The client's attachments (view, settings, client details; at most 64 KB in all), as sent. Stored as TEXT, never jsonb: JSON escapes of NUL or a
   * lone surrogate inside the text are refused by jsonb (see `ReportAttachment` in api.ts; M13-13, M13-4).
   */
  attachments: { kind: string; json: string }[];
  createdAt: Date;
  status: 'new' | 'read' | 'closed';
}

/** Retention (owner answer 11, design 8.3), in days. Results and placements are kept. */
export interface RetentionPolicy {
  /** Action logs, seats' decklists and bug reports' game logs of finished games: 90. */
  logsDays: number;
  /** Lobby tables that never started: 7. */
  lobbyDays: number;
  /** Void and quarantined games (for the developer): 90. */
  voidDays: number;
  /** Guest sessions after their last use: 30 (placements keep the orphaned session id). */
  sessionDays: number;
}

export interface PurgeReport {
  sessions: number;
  games: number;
  records: number;
  snapshots: number;
  reports: number;
}

export interface GameStore {
  // sessions
  putSession(s: SessionRow): Promise<void>;
  sessionByTokenHash(hash: string): Promise<SessionRow | null>;
  touchSession(id: string, at: Date): Promise<void>;
  // tables and games
  /** Status 'lobby'. */
  createGame(g: NewGameRow): Promise<void>;
  /** Seats, title, password hash, invite hashes, status, waiting_since. */
  updateLobby(id: string, patch: LobbyPatch): Promise<void>;
  /** Config with defs, seed, seating, engine build; status 'running'. */
  startGame(id: string, start: StartRow): Promise<void>;
  /**
   * Group commit; isolated per game (a failing game is reported, the rest commit). A game's records that are already committed exactly as given (a
   * batch retried after an ambiguous commit) are reported committed again, and nothing is written twice.
   */
  appendRecords(batch: LogRecord[]): Promise<AppendResult>;
  /** Only for a committed `seq`. */
  putSnapshot(s: SnapshotRow): Promise<void>;
  /**
   * Config, seed, the newest snapshot not past the last committed record, the records after it: exactly `snapshot.seq + 1 .. lastSeq` (else
   * `StoreError` 'corrupt', never a short log). M13-4 INTERFACE CHANGE (additive): `ignoreSnapshots` gives no snapshot and every record (a
   * recovery under another engine build replays from the start).
   */
  loadForRecovery(id: string, o?: RecoveryOptions): Promise<RecoveryData>;
  /** Count one more recovery of the game (and return the new count). */
  countRecovery(id: string): Promise<number>;
  /** M13-4 INTERFACE CHANGE (additive): count one more engine error of the game (`games.engine_errors`, design 2.2 step 2) and return the new count. */
  countEngineError(id: string): Promise<number>;
  runningGames(node?: string): Promise<string[]>;
  /** Full lobby and matched tables waiting for capacity, in their old order after a restart (design 4.6). */
  waitingTables(): Promise<{ id: string; waitingSince: Date }[]>;
  /** M13-6 INTERFACE CHANGE (additive): a game's row and its seats (no seed, no config); null for an unknown game. */
  tableRow(id: string): Promise<TableRow | null>;
  /** M13-6 INTERFACE CHANGE (additive): every unstarted table ('lobby' or 'waitingCapacity'), oldest first (created, then id). */
  openTables(): Promise<TableRow[]>;
  /**
   * M13-6 INTERFACE CHANGE (additive): the seat left the game (a concession by Leave, CR 104.3a): `seats.left_at`. The time of the first call stays (a call may be
   * repeated); `notFound` for an unknown game or seat. After a restart the tables layer reads it back (`tableRow`) so that a seat that left is not seated again.
   */
  markSeatLeft(id: string, seat: SeatNumber, at: Date): Promise<void>;
  /**
   * The result, its placements, the final record and the status, in one transaction: 'finished' for a won or drawn game; a void record gives 'void'
   * ('quarantined' for that reason). Refused for a game not running or with a result already (append-only).
   */
  finishGame(id: string, record: GameRecord, last?: LogRecord): Promise<void>;
  /**
   * Ends a game as void or quarantined (its snapshots go). A started game also gets its ledger row (design 7: no placements): `record` when given
   * (M13-4 INTERFACE CHANGE, additive: the void `GameRecord` the table built, with its turns, actions and `seatActions`; its `game` and `reason` must
   * match), else one the store builds (turns 0, actions = the committed records, `seatActions` from the last record's clocks). A table that never
   * started gets no row. A game already over is left as it is.
   */
  voidGame(id: string, reason: VoidReason, status?: 'void' | 'quarantined', record?: GameRecord): Promise<void>;
  // ledger (milestone 15 reads)
  /** Results ending at or after `since` (inclusive), oldest first (end time, then game id), at most `limit`. */
  results(since: Date, limit: number): Promise<GameRecord[]>;
  /**
   * M13-4 INTERFACE CHANGE (additive): the results with a placement of `session` (won and drawn games; void ones have none), ending at or after
   * `since`, newest first (end time, then game id, both descending), at most `limit`; `before` continues a page after its last row (keyset paging:
   * exactly the rows that sort after it).
   */
  sessionResults(session: string, o: SessionResultsQuery): Promise<GameRecord[]>;
  // bug inbox
  putReport(r: ReportRow): Promise<void>;
  /** Reports created at or after `since` (inclusive), oldest first (time, then id), at most `limit`. */
  reports(since: Date, limit: number): Promise<ReportRow[]>;
  /** M13-4 INTERFACE CHANGE (additive): sets a report's status (the owner's inbox command, M13-13). */
  setReportStatus(id: string, status: ReportRow['status']): Promise<void>;
  // retention
  purge(policy: RetentionPolicy, now: Date): Promise<PurgeReport>;
  close(): Promise<void>;
}

/** `GameStore.loadForRecovery`'s options. */
export interface RecoveryOptions {
  /** No snapshot: every committed record from the first. */
  ignoreSnapshots?: boolean;
}

/** `GameStore.sessionResults`'s query. */
export interface SessionResultsQuery {
  since: Date;
  limit: number;
  /** The last row of the previous page: rows strictly after it in the newest-first order. */
  before?: { endedAt: string; game: string };
}

/** The methods of `GameStore` (pinned against the interface by test/m13-1/store.test.ts; the contract suite of M13-4 covers each). */
export const GAME_STORE_METHODS = [
  'putSession', 'sessionByTokenHash', 'touchSession', 'createGame', 'updateLobby', 'startGame', 'appendRecords', 'putSnapshot', 'loadForRecovery',
  'countRecovery', 'countEngineError', 'runningGames', 'waitingTables', 'tableRow', 'openTables', 'markSeatLeft', 'finishGame', 'voidGame', 'results', 'sessionResults', 'putReport', 'reports',
  'setReportStatus', 'purge', 'close',
] as const satisfies readonly (keyof GameStore)[];
