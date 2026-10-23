/**
 * The ledger shapes the ladder consumes and the shapes of intake (design 13.2, D2, D8, 8.2). Server only.
 *
 * `LedgerGameRecord` and `LedgerPlacement` are the ladder's own structural copy of m13's `GameRecord` and `Placement` (hosted/src/ledger/types.ts)
 * with the three sync additions (`ranked: boolean`, `ladder`, `cap`). m13's types are assignable to these (m13's `ranked: false` is a `boolean`; its
 * extra fields are ignored); M15-8 adds the type test when hosted is synced (13.8). The ladder never imports packages/hosted (D1).
 *
 * The adapter that turns a record into a RatedGame or a skip is `toRatedGame` in src/intake/adapter.ts (M15-3).
 */
import type { AccountId } from './accounts';
import type { CapKind, CapSeat, CapVerdict, LadderId, LossCode, Place, RatedNotice, RatingRowLike, SeasonId, SeatNo } from './api';

export interface LedgerPlacement {
  seat: SeatNo;
  place: Place;
  loss: LossCode | null;
  lossRule: string | null;
  outTurn: number | null;
  /** Milestone 14 fills it for signed-in players; null for a deleted account. Not authoritative for the ladder: the registry seat is (8.2). */
  account: string | null;
  /** The display name at the time ("Deleted player" after a deletion, m14 2.4). */
  name: string;
  timeouts: number;
  disconnectedMs: number;
  timeUsedMs: number;
}

export interface LedgerGameRecord {
  /** ULID. */
  game: string;
  format: string;
  seats: 2 | 3 | 4;
  source: 'listed' | 'private' | 'matched';
  /** SYNC: m13 has the literal false. */
  ranked: boolean;
  /** SYNC: new; required when ranked. */
  ladder?: string | null;
  outcome: 'win' | 'draw' | 'void';
  reason: string;
  turns: number;
  actions: number;
  startedAt: string;
  endedAt: string;
  engineBuild: string;
  /** Empty for void. */
  placements: LedgerPlacement[];
  seatActions?: { seat: SeatNo; actions: number }[];
  /** SYNC: new. On a ranked record whose game reached a per-game cap, void ones included (8.5). */
  cap?: { kind: CapKind; verdict: CapVerdict; seats: CapSeat[] };
}

/** One seat of a registry entry. */
export interface StartSeat {
  seat: SeatNo;
  /** Null after the account was deleted while the game ran (8.7). Authoritative for which account the seat is (8.2). */
  account: AccountId | null;
  /**
   * The account's stored rating row as it was at the start (state, season, lastRatedAt; the initial state, seasonOf(startedAt) and null for a first
   * game). NOT reset: ratingNow(row, endedAt) is applied at intake exactly as for a live row, so a game across a season boundary resets it once (G10b).
   * Null only once the start is closed and the seat's account was deleted (8.7).
   */
  row: RatingRowLike | null;
  games: number;
}

/** The ladder's registry entry for a ranked game (D8), written at the start. */
export interface RankedStart {
  game: string;
  match: string;
  ladder: LadderId;
  startedAt: string;
  seats: StartSeat[];
  status: 'running' | 'applied' | 'void' | 'skipped' | 'lost';
  closedAt: string | null;
}

/** `account` comes from the registry seat, never from the ledger placement (8.2). */
export interface RatedSeat {
  seat: SeatNo;
  account: AccountId | null;
  name: string;
  place: Place;
  loss: LossCode | null;
  lossRule: string | null;
  outTurn: number | null;
}
export interface RatedGame {
  game: string;
  ladder: LadderId;
  season: SeasonId;
  endedAt: string;
  outcome: 'win' | 'draw';
  turns: number;
  seats: RatedSeat[];
  cap: LedgerGameRecord['cap'] | null;
}
/** 8.2's table: what each reason stores and how it closes the registry entry. */
export type SkipReason = 'unranked' | 'unregistered' | 'lost' | 'closed' | 'void' | 'mismatch' | 'malformed' | 'ladderOff';
export interface IntakeSkip { skip: SkipReason; game: string; detail: string; closeStartAs: 'void' | 'skipped' | null; notRated: boolean }

export type IntakeResult =
  | { kind: 'applied'; game: string; notices: RatedNotice[] }
  | { kind: 'duplicate'; game: string }
  | { kind: 'skipped'; game: string; reason: SkipReason }
  /** A store failure, or 3 conflicts (8.3). Nothing was written; the sweep's cursor stops before this game and takes it again. */
  | { kind: 'failed'; game: string; error: string };
