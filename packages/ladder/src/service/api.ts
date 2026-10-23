/**
 * `LadderService` and its ports (design 13.4, 8, 10, 11.3). Server only. M15-3 builds the service (`createLadderService`, src/service/create.ts);
 * the abuse port's types are in src/abuse/types.ts.
 *
 * The ladder reaches the outside only through these ports; tests pass fakes. Milestone 14's read-only directory (m14 11.1) is imported as a type
 * through src/accounts.ts (2). The ladder uses:
 *   standings(ids)          ranked (may queue), listed (may be on leaderboards; the ladder's mirror, 10.1), status, createdAt (the smurf rule)
 *   names(ids)              current names for leaderboards and profiles (absent: suspended, banned, deleting, erased)
 *   privacy(ids)            PrivacySettings.leaderboards (false: "Hidden player", the limited view of 10.3)
 *   historyVisible(id, v)   who may read a match history (false for others while the subject is not active)
 *   displayNameAt(id, n, v) history names with the viewer: the stored name at the time on the viewer's own seat (the current one after a forced
 *                           rename), the account's current name on every other seat (m14 6.7)
 *   blockedAmong(ids)       pairs the ranked matcher never matches (9.4)
 * Accounts never import the ladder; hosted hands the AccountService's directory to createLadderService.
 *
 * Wiring at sync (M15-8): `const ladder = createLadderService(ports); await ladder.open(); const ranked =
 * createRatedMatcher(ladder.matcherContext(sessionBusy)); ladder.attachQueue(ranked);` then the first `sweep()`.
 *
 * Errors: a store failure surfaces as a rejected promise from reads, and as `{ kind: 'failed' }` from `intake`, which the sweep takes again (8.3).
 * Reads never throw for bad input: hosted checks a cursor with M15-3's parser first and answers a bad one as `badMessage`.
 */
import type { AccountDirectory, AccountId } from '../accounts';
import type { LadderId, LadderProfile, LadderStatus, LeaderboardPage, HistoryPage, NotRatedReason, RatedNotice, SeasonId, SeatNo, Stakes } from '../api';
import type { AbuseChecker, ModerationSink } from '../abuse/types';
import type { IntakeResult, LedgerGameRecord } from '../ledger';
import type { RankedEntry, RankedMatcher, RankedMatcherContext } from '../match/api';
import type { AppliedSeat, ForgetReport, IntakeCursor, LadderStore, PenaltyRow, RatingRow, SeasonRecord } from '../store/api';

/** m13's GameStore reads (inclusive since, oldest first), and the reads M15-8 adds (8.3). */
export interface LedgerSource {
  results(since: Date, limit: number): Promise<LedgerGameRecord[]>;
  resultsAfter?(after: IntakeCursor, limit: number): Promise<LedgerGameRecord[]>;
  /** One game's ledger record by id, or null (hosted's games table). */
  result(game: string): Promise<LedgerGameRecord | null>;
  /** Which of these games hosted's games table still has as running: running through outages, recovery and a pending void, until finishGame or voidGame. */
  running(games: readonly string[]): Promise<Set<string>>;
}
/** Hosted's replay availability (12). */
export interface ReplayIndex { availability(games: readonly string[]): Promise<Map<string, { until: string; full: boolean }>> }

/** Ms since the epoch; tests pass a FakeClock (test/support/clock.ts). */
export interface LadderClock { now(): number }

export interface LadderConfig {
  offered: readonly LadderId[];
  firstSeason: SeasonId;
  /** Per-ladder tier floors, recorded per season, applied from the next season start (6.3). */
  tierFloors: Partial<Record<LadderId, readonly number[]>>;
  /** After a season's end, wait this long before closing it (7): 15 minutes. */
  closeGraceMs: number;
  /** Running registry entries older than this are reconciled with hosted by game id (8.3): 30 minutes. */
  reconcileAfterMs: number;
  /** The sweep re-reads the ledger from this long before its cursor (8.3): 10 minutes. */
  cursorOverlapMs: number;
  /** 60 s. */
  sweepEveryMs: number;
  /** Ms for the 2nd, 3rd, 4th+ miss within 24 h: [5 min, 15 min, 60 min]. */
  cooldowns: readonly number[];
  /** base64url of at least 32 random bytes: the HMAC key of report dedupe keys (11.2). Hosted keeps it with its other secrets; tests pass a fixed one. */
  secret: string;
}

export interface LadderPorts {
  store: LadderStore;
  clock: LadderClock;
  accounts: AccountDirectory;
  moderation: ModerationSink;
  /** M15-5's createAbuseChecker() once it lands; NO_ABUSE_CHECKS until then. */
  abuse: AbuseChecker;
  /** Null until hosted is wired; the sweep then closes seasons only (no starts exist). */
  ledger: LedgerSource | null;
  replays: ReplayIndex | null;
  config: LadderConfig;
  log: { info(event: string, fields?: Record<string, unknown>): void; warn(event: string, fields?: Record<string, unknown>): void };
}

export type Eligibility =
  | { ok: true }
  | { ok: false; reason: 'notSignedIn' | 'notAllowed' | 'notOffered' | 'inRankedGame' | 'inQueue' }
  | { ok: false; reason: 'cooldown'; until: string };

export interface RankedStartInput { game: string; match: string; ladder: LadderId; startedAt: string; seats: { seat: SeatNo; account: AccountId }[] }

export interface SweepReport {
  applied: number;
  skipped: number;
  duplicates: number;
  failed: number;
  reconciled: number;
  lostStarts: number;
  caughtUp: boolean;
  seasonsClosed: SeasonId[];
  reports: number;
}

export interface NotRatedEvent { game: string; ladder: LadderId; reason: NotRatedReason; accounts: readonly AccountId[] }

export interface LadderService {
  /** Loads the running registry entries and the active cooldowns into memory, for the synchronous lookups below. Once, before anything else. */
  open(): Promise<void>;
  /** Whether the account may queue for the ladder now (signed-in check is hosted's: a guest never gets here). `inQueue` only once a queue is attached. */
  eligibility(account: AccountId, ladder: LadderId): Promise<Eligibility>;
  /** Synchronous, from memory: the account has a running ranked game. Kept by open, registerStart, intake, the sweep's closes and forgetAccount. */
  accountBusy(account: AccountId): boolean;
  /** Synchronous, from memory: the end of the account's ranked-queue cooldown in ms, or null. Kept by open and readyCheckMissed. */
  cooldownUntil(account: AccountId): number | null;
  /** The matcher's context (13.5) on accountBusy, cooldownUntil, the offered ladders, DEFAULT_RANKED_POLICY and the ladder's ULIDs as match ids. */
  matcherContext(sessionBusy: (session: string) => boolean): RankedMatcherContext;
  /** Hosted attaches the matcher it created from matcherContext; until then eligibility never answers inQueue and status reports an empty queue. */
  attachQueue(q: Pick<RankedMatcher, 'queued' | 'status' | 'window' | 'accounts'>): void;
  /** The matcher entry (9.1): rating now, placement, the last 3 games' opponents; and the blocks between it and `queued` (= matcher.accounts(ladder), 9.4). */
  entryFor(
    q: { account: AccountId; session: string; addressKey: string; ladder: LadderId; deck: string; enteredAt: number },
    queued: readonly AccountId[],
  ): Promise<{ entry: RankedEntry; blocks: [AccountId, AccountId][] }>;
  /** The blocks among a formed match's accounts (hosted asks before it creates the table, 9.4). */
  blockedAmong(accounts: readonly AccountId[]): Promise<[AccountId, AccountId][]>;
  /** A ranked ready check failed; these accounts did not confirm (8.6). Returns their cooldowns. */
  readyCheckMissed(match: string, accounts: readonly AccountId[]): Promise<{ account: AccountId; cooldownUntil: string | null }[]>;
  /** A ranked game started (after the ready check, after hosted wrote its game row): the registry entry with each seat's stored row (D8). Idempotent. */
  registerStart(s: RankedStartInput): Promise<void>;
  /** What each player can win or lose (6.4), for hosted's `start`: a preview from ratingNow at startedAt. */
  stakes(game: string): Promise<Map<AccountId, Stakes>>;
  /** Every ranked ledger record, void ones included. Idempotent (8.3). */
  intake(record: LedgerGameRecord): Promise<IntakeResult>;
  /** The ledger read, reconciling running starts, season closes, the daily abuse sweep and the report outbox (7, 8.3, 11). At start and every 60 s. */
  sweep(): Promise<SweepReport>;
  /** Milestone 14's change feed (standing, deleting, deleted) for these accounts: refreshes the ladder's listed mirror (10.1). Serial queue. */
  standingChanged(accounts: readonly AccountId[]): Promise<void>;
  // reads (any viewer, guests included; `viewer` is the signed-in account or null)
  status(viewer: AccountId | null): Promise<LadderStatus>;
  leaderboard(q: { ladder: LadderId; season: SeasonId | 'current'; cursor?: string; limit?: number }, viewer: AccountId | null): Promise<LeaderboardPage>;
  /** Null when the subject's history is private to this viewer (AccountDirectory.historyVisible), or the account does not exist. */
  history(q: { account: AccountId; ladder?: LadderId; cursor?: string; limit?: number }, viewer: AccountId | null): Promise<HistoryPage | null>;
  profile(account: AccountId, viewer: AccountId | null): Promise<LadderProfile | null>;
  // accounts (the ladder's AccountDataHolder, 8.7) and moderation; both on the serial queue
  exportAccount(account: AccountId): Promise<LadderExport>;
  forgetAccount(account: AccountId): Promise<ForgetReport>;
  resetRating(account: AccountId, ladder: LadderId, by: string, reason: string): Promise<void>;
  /** Rated games (hosted sends `ratedResult` to the seats). Returns the unsubscribe function. */
  onRated(listener: (notices: readonly RatedNotice[], game: string) => void): () => void;
  /** Ranked games that will not be rated, from intake and from the sweep (8.2's last column; lost starts): hosted sends `notRated` to the accounts. */
  onNotRated(listener: (e: NotRatedEvent) => void): () => void;
}

/** The ladder's part of milestone 14's AccountExport.holders['ladder']. JSON-safe; only this account's data. */
export interface LadderExport {
  ratings: RatingRow[];
  seasons: SeasonRecord[];
  /** The account's own seat of each rated game, with the game's ladder, season, end time and outcome. */
  games: { game: string; ladder: LadderId; season: SeasonId; endedAt: string; outcome: 'win' | 'draw'; seat: AppliedSeat }[];
  penalties: PenaltyRow | null;
}
