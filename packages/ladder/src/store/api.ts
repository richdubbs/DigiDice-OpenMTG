/**
 * `LadderStore`: the ladder's one storage interface (design 13.3, D20). Server only.
 *
 * Implementations: `MemoryLadderStore` (tests) and `FileLadderStore` (development: a sequenced journal with snapshots under a lock file) in
 * src/store/{memory,file}.ts, with the contract suite src/store/contract.ts (M15-3); `PostgresLadderStore` in src/store/postgres.ts (M15-7, schema
 * `ladder`, 13.7). Every method returns copies: no caller can change stored state by mutating a result.
 *
 * Every write that rates a game, skips one or closes a registry entry is ONE atomic step (applyGame, markSkipped), keyed by the game id, so a repeat
 * is a no-op ('duplicate') and a crash leaves either all of it or nothing (8.3).
 */
import type { AccountId } from '../accounts';
import type { CapKind, CapVerdict, LadderId, RatingRowLike, RatingState, SeasonId, SeatNo, TierId } from '../api';
import type { AbuseReport } from '../abuse/types';
import type { RankedStart, RatedSeat, SkipReason } from '../ledger';

export interface RatingRow extends RatingRowLike {
  account: AccountId;
  ladder: LadderId;
  /** Career rated games in the ladder (placement is the first 10). */
  games: number;
  /** Null during placement. */
  tier: TierId | null;
  // state, season (of the last update: the lazy reset, section 7) and lastRatedAt come from RatingRowLike.
  /** Optimistic concurrency (8.3): +1 on every write. */
  version: number;
}

export interface SeasonRecord {
  /** Null only in a closed season, after a deletion ("Deleted player"). */
  account: AccountId | null;
  ladder: LadderId;
  season: SeasonId;
  /**
   * The leaderboard's keyset tiebreak (10.1): the account id, or after a deletion in a closed season a 'deleted:' marker of 128 random bits in the
   * ULID shape (no time part, 2; newDeletedSortKey in src/ids.ts).
   */
  sortKey: string;
  /** Standing.listed as the ladder last saw it (10.1). */
  listed: boolean;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  places: [number, number, number, number] | null;
  /** After the last game of the season; null during placement. */
  display: number | null;
  /** Shown deviation after that game. */
  deviation: number | null;
  /** standingOf(display, deviation) after that game: the live leaderboard key; null during placement. */
  standing: number | null;
  /** provisionalFrom(...) after that game: the live leaderboard keeps the row while now < provisionalFrom; null during placement. */
  provisionalFrom: string | null;
  peak: number | null;
  tier: TierId | null;
  peakTier: TierId | null;
  /** Shown ratings after each post-placement game of the season, in order: the badge's median (7). */
  seasonRatings: number[];
  /** Career rated games in the ladder after the last game of the season. */
  careerGames: number;
  lastGameAt: string;
  /** Set when the season closes (7): standingOf(display, deviation at the season's end); null when not eligible then. */
  finalStanding: number | null;
  finalRank: number | null;
  badge: TierId | null;
}

export interface AppliedSeat extends RatedSeat {
  /** ratingNow(row or start snapshot, endedAt).state: after any season reset, BEFORE time away (13.1). Null for a deleted account (8.7). */
  before: RatingState | null;
  /**
   * The time away the computation added, in ms like every stored duration (days = awayMs / GLICKO2.periodMs; 0 for a first game): with `before` it
   * reproduces the deviation at game time. 0 for a deleted account.
   */
  awayMs: number;
  /** Null for a deleted account (nothing stored for it, 8.7). */
  after: RatingState | null;
  /** displayRating(before); null during placement. */
  displayBefore: number | null;
  displayAfter: number | null;
  tierAfter: TierId | null;
}

/** A ranked game that reached a per-game cap (8.5), rated or void: the capStall evidence. */
export interface CapEvent {
  game: string;
  ladder: LadderId;
  at: string;
  kind: CapKind;
  verdict: CapVerdict;
  seats: { seat: SeatNo; account: AccountId | null; initiated: number; chargedMs: number; share: number }[];
}

/** One rated game, written atomically by applyGame. */
export interface AppliedGame {
  game: string;
  ladder: LadderId;
  season: SeasonId;
  endedAt: string;
  appliedAt: string;
  outcome: 'win' | 'draw';
  turns: number;
  seats: AppliedSeat[];
  /** The new rows, each with the version it was computed from; null: the row did not exist. */
  ratings: { row: RatingRow; expectVersion: number | null }[];
  seasonRecords: SeasonRecord[];
  cap: CapEvent | null;
}

/** One stored skip (8.2), written atomically by markSkipped together with the registry close and the cap event. */
export interface SkipWrite { game: string; reason: SkipReason; at: string; closeStartAs: 'void' | 'skipped' | null; cap: CapEvent | null }

export interface HistoryRow { game: string; ladder: LadderId; season: SeasonId; endedAt: string; outcome: 'win' | 'draw'; turns: number; seats: AppliedSeat[] }
export interface PenaltyRow { account: AccountId; misses: string[]; cooldownUntil: string | null }
export interface IntakeCursor { endedAt: string; game: string }
export interface SeasonRow {
  ladder: LadderId; season: SeasonId; status: 'open' | 'closed'; floors: readonly number[]; closedAt: string | null; eligible: number | null;
  /**
   * When the daily abuse sweep (11.1) was handed this closed season for `parkedHigh`; absent or null until then. Kept with the season, not in the
   * service's memory, so a restart neither misses a close nor hands it over twice. INTERFACE CHANGE (M15-3 review, additive and optional; M15-7
   * stores it as `ladder_seasons.daily_at`).
   */
  dailyAt?: string | null;
}
/** The moderators' audit (11.3). After the account's deletion: account null, before and after null (8.7). */
export interface AdjustmentRow {
  id: string;
  account: AccountId | null;
  ladder: LadderId;
  by: string;
  reason: string;
  before: RatingRow | null;
  after: RatingRow | null;
  at: string;
}
export interface ForgetReport {
  ratings: number;
  seasonRecords: number;
  historySeats: number;
  reports: number;
  starts: number;
  penalties: number;
  capSeats: number;
  adjustments: number;
}
export interface LeaderboardQuery {
  ladder: LadderId;
  season: SeasonId;
  /**
   * false (an open season): eligible = display not null, games ≥ minGames, listed, now < provisionalFrom; ordered by standing desc, games desc,
   * sortKey. true (closed): finalRank not null; ordered by finalStanding desc, games desc, sortKey.
   */
  closed: boolean;
  minGames: number;
  now: string;
  /** The keyset cursor (10.1): the last row's key (standing, or finalStanding when closed), games and sortKey. */
  after?: { key: number; games: number; sortKey: string };
  limit: number;
}

export interface LadderStore {
  // ratings
  ratings(ladder: LadderId, accounts: readonly AccountId[]): Promise<Map<AccountId, RatingRow>>;
  // the registry of ranked starts (D8)
  /** Idempotent by game id. */
  putStart(s: RankedStart): Promise<void>;
  start(game: string): Promise<RankedStart | null>;
  /** Oldest first. */
  runningStarts(o?: { account?: AccountId; startedBefore?: string; limit?: number }): Promise<RankedStart[]>;
  /** Only for 'lost' (8.3); every other close happens inside applyGame or markSkipped. */
  closeStart(game: string, status: 'lost', at: string): Promise<void>;
  // results (8.3)
  /**
   * 'conflict' on a stale version, or when an account it writes no longer matches the registry entry's non-null seat (8.3, 8.7). Closing the start,
   * it clears the snapshot (`row` null) of every seat whose account is null; such a seat's AppliedSeat carries no rating values (8.7).
   */
  applyGame(a: AppliedGame): Promise<'applied' | 'duplicate' | 'conflict'>;
  /** The skip marker, the cap event and the registry close (closeStartAs, clearing null seats' snapshots, 8.7) in one atomic write. */
  markSkipped(s: SkipWrite): Promise<'stored' | 'duplicate'>;
  applied(game: string): Promise<{ status: 'applied' | 'skipped'; at: string } | null>;
  intakeCursor(): Promise<IntakeCursor | null>;
  setIntakeCursor(c: IntakeCursor): Promise<void>;
  // seasons (7, 10.1)
  seasonRow(ladder: LadderId, season: SeasonId): Promise<SeasonRow | null>;
  putSeasonRow(r: SeasonRow): Promise<void>;
  seasonRecord(account: AccountId, ladder: LadderId, season: SeasonId): Promise<SeasonRecord | null>;
  /** The profile, newest season first. */
  seasonRecords(account: AccountId): Promise<SeasonRecord[]>;
  /** Every record of a season, by sortKey, paged (closing a season, 7; parkedHigh, 11.1). */
  seasonRecordsOf(ladder: LadderId, season: SeasonId, after: string | null, limit: number): Promise<SeasonRecord[]>;
  /** The ladder's listed mirror (10.1): sets `listed` on the account's records of open seasons; returns how many changed. */
  setListed(account: AccountId, listed: boolean): Promise<number>;
  /** Eligible rows in 10.1's order. */
  leaderboard(q: LeaderboardQuery): Promise<SeasonRecord[]>;
  leaderboardCount(q: Omit<LeaderboardQuery, 'after' | 'limit'>): Promise<number>;
  /** 1 + the eligible rows with a higher standing (open season). */
  rankOf(q: Omit<LeaderboardQuery, 'after' | 'limit' | 'closed'>, standing: number): Promise<number>;
  closeSeason(
    ladder: LadderId,
    season: SeasonId,
    finals: { sortKey: string; finalStanding: number | null; finalRank: number | null; badge: TierId | null }[],
    at: string,
  ): Promise<'closed' | 'already'>;
  // history (10.2), the matcher's rematch rule (9.4) and the abuse rules (11)
  history(q: { account: AccountId; ladder?: LadderId; before?: IntakeCursor; limit: number }): Promise<HistoryRow[]>;
  recentOpponents(account: AccountId, ladder: LadderId, games: number): Promise<AccountId[][]>;
  pairGames(a: AccountId, b: AccountId, ladder: LadderId, since: string): Promise<HistoryRow[]>;
  /** Applied games in (endedAt, game) order from `since`, keyset after `after` (the daily abuse sweep, 11.1). */
  gamesSince(q: { ladder?: LadderId; since: string; after?: IntakeCursor; limit: number }): Promise<HistoryRow[]>;
  capEvents(account: AccountId, since: string): Promise<CapEvent[]>;
  // penalties (8.6)
  penalties(account: AccountId): Promise<PenaltyRow | null>;
  putPenalties(p: PenaltyRow): Promise<void>;
  /** Rows whose cooldown ends after `now` (the service's memory, loaded by open, 13.4). */
  activeCooldowns(now: string): Promise<PenaltyRow[]>;
  // reports (11.2): the outbox
  /** By dedupeKey; stored 'pending'. */
  putReport(r: AbuseReport): Promise<'stored' | 'duplicate'>;
  /** Oldest first. */
  pendingReports(limit: number): Promise<AbuseReport[]>;
  /** Strips it to dedupeKey, kind, createdAt. */
  markReportSent(id: string, at: string): Promise<void>;
  purgeReports(sentBefore: string): Promise<number>;
  /** The owner's `openmtg-ladder reports`. */
  reports(since: string, limit: number): Promise<AbuseReport[]>;
  // moderation (11.3) and accounts (8.7)
  resetRating(row: RatingRow, audit: AdjustmentRow): Promise<void>;
  forgetAccount(account: AccountId): Promise<ForgetReport>;
  close(): Promise<void>;
}

/** Every method of LadderStore, once (the contract suite and the PostgreSQL store walk it; test/m15-1/contracts.test.ts pins it both ways). */
export const LADDER_STORE_METHODS = Object.freeze([
  'ratings', 'putStart', 'start', 'runningStarts', 'closeStart', 'applyGame', 'markSkipped', 'applied', 'intakeCursor', 'setIntakeCursor',
  'seasonRow', 'putSeasonRow', 'seasonRecord', 'seasonRecords', 'seasonRecordsOf', 'setListed', 'leaderboard', 'leaderboardCount', 'rankOf',
  'closeSeason', 'history', 'recentOpponents', 'pairGames', 'gamesSince', 'capEvents', 'penalties', 'putPenalties', 'activeCooldowns', 'putReport',
  'pendingReports', 'markReportSent', 'purgeReports', 'reports', 'resetRating', 'forgetAccount', 'close',
] as const satisfies readonly (keyof LadderStore)[]);
