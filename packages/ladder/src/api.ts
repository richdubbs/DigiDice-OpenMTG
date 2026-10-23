/**
 * `@openmtg/ladder/api`: the browser-safe contract of the ladder (milestone 15; docs/design/m15-ladder.md, private archive, section 13.1). Types,
 * constants and pure functions only; no `node:` imports (checked by tsconfig.api.json, which compiles it without Node's types, and
 * test/m15-1/browser-safe.test.ts). The server is authoritative: browsers use these functions to explain and preview, never to decide (D21).
 *
 * Layout (M15-1). This file declares the TYPES. The values live in files of their own and are exposed ONLY through the named re-exports below
 * (never `export *`, never declared here as well):
 *   ./api/constants   M15-1   every constant of 13.1 (INTERFACE CHANGE, layout only: a leaf, so the parts can read them at load time; see there)
 *   ./api/ladders     M15-2   isLadderId
 *   ./api/places      M15-2   validPlaces
 *   ./api/display     M15-2   initialState, displayRating, displayDeviation, isProvisional, provisionalFrom, standingOf
 *   ./api/glicko2     M15-2   glicko2Period, glicko2RdAt, glicko2Expected, rateOneVsOne
 *   ./api/wenglin     M15-2   wenglinSigmaAt, ratePod, plackettLuceTerms
 *   ./api/tiers       M15-2   tierOf, tierAfter, badgeTier
 *   ./api/season      M15-2   isSeasonId, seasonOf, seasonBounds, nextSeason, seasonReset, ratingNow
 *   ./api/cap         M15-2   capShareThreshold, capVerdict
 *   ./api/stakes      M15-2   stakesOneVsOne, stakesPod
 * M15-1 lands each part as a stub (the final signature, a body that throws "not built yet (M15-2)"); M15-2 fills them. A part takes values only from
 * ./api/constants or files of the part's own, and from this file types only (`import type`): this file re-exports the parts, so a value a part read
 * from it at load time would be undefined (test/m15-1/load.test.ts).
 *
 * Imported by @openmtg/client (screens, M15-10) and @openmtg/hosted (M15-8). An additive change later is marked here as an INTERFACE CHANGE.
 */
import type { AccountId } from './accounts'; // type-only re-export of @openmtg/accounts/api (2)
import type { LADDER_IDS, LOSS_CODES, TIER_IDS } from './api/constants';

// ---- Ladders (section 3) --------------------------------------------------------------------------------------------------------------------
export { LADDER_IDS, LADDERS } from './api/constants';
export type LadderId = (typeof LADDER_IDS)[number];
export type RatingModel = 'glicko2' | 'wenglin';

export interface LadderDef {
  id: LadderId;
  /** The hosted format id (m13 HOSTED_FORMATS). */
  format: 'standard' | 'pioneer' | 'pauper' | 'commander';
  /** Table sizes a match may have, preferred first: [2] for 1v1; [4, 3] for pods (3 only after a wait, 9.3). */
  seats: readonly (2 | 3 | 4)[];
  bestOf: 1;
  model: RatingModel;
  placementGames: number;
  /** A placed rating whose shown deviation NOW is above this is provisional (6.2). One scale for both models (5.2). */
  provisionalDeviation: number;
  /** Season games needed for the leaderboard (10.1). */
  leaderboardGames: number;
}

//   isLadderId(x: unknown): x is LadderId
export { isLadderId } from './api/ladders';

/** ACCOUNT_ID_SHAPE: the account id's shape (m14 11.1 `ACCOUNT_ID`, pinned against accounts' own). DELETED_PLAYER_NAME: m14's text (8.7). */
export { ACCOUNT_ID_SHAPE, DELETED_PLAYER_NAME } from './api/constants';

// ---- Seats, places, loss codes (the ledger's, m13 7, plus 'limit', 8.5) ---------------------------------------------------------------------
export type SeatNo = 1 | 2 | 3 | 4;
export type Place = 1 | 2 | 3 | 4;
export { LOSS_CODES } from './api/constants';
export type LossCode = (typeof LOSS_CODES)[number];

//   validPlaces(places: readonly number[]): boolean       the ledger's shared-place rule: each place is 1 + the number of players strictly ahead
export { validPlaces } from './api/places';

// ---- Rating states and constants (sections 4, 5) ---------------------------------------------------------------------------------------------
export interface Glicko2State { model: 'glicko2'; r: number; rd: number; vol: number }
export interface WengLinState { model: 'wenglin'; mu: number; sigma: number }
export type RatingState = Glicko2State | WengLinState;

export { GLICKO2, WENGLIN } from './api/constants';

// ---- Glicko-2 (./api/glicko2) ------------------------------------------------------------------------------------------------------------
export interface Glicko2Opponent { r: number; rd: number; score: 0 | 0.5 | 1 }
export interface Glicko2PeriodResult extends Glicko2State { v: number; delta: number; volRaw: number; iterations: number }
//   glicko2Period(p: Glicko2State, games: readonly Glicko2Opponent[], o?: { tau?: number; volMax?: number }): Glicko2PeriodResult
//   glicko2RdAt(rd: number, days: number): number
//   glicko2Expected(a: Glicko2State, b: Glicko2State): number
//   rateOneVsOne(a: Glicko2State, b: Glicko2State, scoreA: 0 | 0.5 | 1, daysA: number, daysB: number,
//     onVolatility?: (player: 'a' | 'b', iterations: number, converged: boolean) => void): [Glicko2State, Glicko2State]
//                                     INTERFACE CHANGE (M15-2 review, additive): the optional hook, for 4.1's log of a step 5 that kept the old σ
export { glicko2Period, glicko2RdAt, glicko2Expected, rateOneVsOne } from './api/glicko2';

// ---- Weng-Lin Plackett-Luce (./api/wenglin) -------------------------------------------------------------------------------------------------
//   wenglinSigmaAt(sigma: number, days: number): number
//   ratePod(players: readonly WengLinState[], places: readonly Place[], days: readonly number[]): WengLinState[]
//   plackettLuceTerms(players: readonly WengLinState[], ranks: readonly number[]): { omega: number; delta: number }[]
export { wenglinSigmaAt, ratePod, plackettLuceTerms } from './api/wenglin';

// ---- What players see (./api/display, ./api/tiers) ------------------------------------------------------------------------------------------
//   initialState(model: RatingModel): RatingState
//   displayRating(s: RatingState): number                 Math.round(r) | Math.round(1500 + WENGLIN.displayScale (mu - 25))
//   displayDeviation(s: RatingState): number              rd | WENGLIN.displayScale sigma, of the state as given (not rounded)
//   isProvisional(def: LadderDef, deviationNow: number, games: number): boolean
//   provisionalFrom(def: LadderDef, s: RatingState, lastGameAt: string): string
//   standingOf(display: number, deviation: number): number                        Math.round(display − LEADERBOARD_K × deviation)
export { initialState, displayRating, displayDeviation, isProvisional, provisionalFrom, standingOf } from './api/display';
export { LEADERBOARD_K } from './api/constants';

export { TIER_IDS, TIER_NAMES, DEFAULT_TIER_FLOORS, TIER_DEMOTION_BUFFER } from './api/constants';
export type TierId = (typeof TIER_IDS)[number];
//   tierOf(display: number, floors?: readonly number[]): TierId
//   tierAfter(prev: TierId | null, display: number, floors?: readonly number[]): TierId
//   badgeTier(seasonRatings: readonly number[], careerGames: number, floors?: readonly number[]): TierId | null
export { tierOf, tierAfter, badgeTier } from './api/tiers';

// ---- Seasons (./api/season) -----------------------------------------------------------------------------------------------------------------
/** 'YYYY-MM' (a UTC calendar month). */
export type SeasonId = string;
export { SEASON_ID, SEASON_RESET, SEASON_BADGE_GAMES, BADGE_CAREER_GAMES } from './api/constants';
/** What ratingNow reads: a stored rating row (13.3), or a registry seat's start snapshot (13.2). */
export interface RatingRowLike { state: RatingState; season: SeasonId; lastRatedAt: string | null }
//   isSeasonId(x: unknown): x is SeasonId
//   seasonOf(isoTime: string): SeasonId                                 throws on a malformed time
//   seasonBounds(s: SeasonId): { startsAt: string; endsAt: string }      startsAt inclusive, endsAt exclusive
//   nextSeason(s: SeasonId): SeasonId
//   seasonReset(s: RatingState): RatingState
//   ratingNow(row: RatingRowLike, at: string): { state: RatingState; season: SeasonId; deviation: number }     pinned semantics: see ./api/season
export { isSeasonId, seasonOf, seasonBounds, nextSeason, seasonReset, ratingNow } from './api/season';

// ---- The cap rule (./api/cap, 8.5) --------------------------------------------------------------------------------------------------------------
export type CapKind = 'actions' | 'time';
/**
 * One in-game seat at a per-game cap, counted by the hosted table clock (13.8). An "answer" is a decision the seat must make because of another seat
 * (a pass or response while another seat's object is on top of the stack, a choice another seat's spell or ability asks of it, blockers in another
 * seat's attack); everything else is the seat's own.
 * - `initiated`: casts, activated abilities, special actions and accepted cancels the seat made on its own; never passes, never answers.
 * - `chargedMs`: the seat's own decisions' time (free delay and bank, not the animation allowance) plus every answer other seats made to its objects,
 *   up to the free delay per answer. Bank an answering seat uses beyond its free delay stays its own.
 */
export interface CapSeat { seat: SeatNo; initiated: number; chargedMs: number }
export type CapVerdict = { kind: 'void' } | { kind: 'driver'; seat: SeatNo; share: number };
//   capShareThreshold(seatsInGame: number): number                       1/n + 0.25
//   capVerdict(cap: CapKind, inGame: readonly CapSeat[]): CapVerdict      by the cap's own measure only; a total of 0 or a tied top share is void
export { capShareThreshold, capVerdict } from './api/cap';

// ---- Views sent to browsers (13.6). "Limited": another viewer of an account with PrivacySettings.leaderboards false (10.3). ------------------
export interface RatingView {
  ladder: LadderId;
  /** Null during placement, and in a limited view. */
  display: number | null;
  tier: TierId | null;
  /** isProvisional now (6.2). */
  provisional: boolean;
  placementLeft: number;
  games: number;
  /** The current season's leaderboard rank, if eligible; null in a limited view. */
  rank: number | null;
}
/** Only for the account itself (6.1, 6.4). */
export interface RatingDetails {
  state: RatingState;
  deviationNow: number;
  lastRatedAt: string | null;
  /** When the rating turns provisional if no game is played; null during placement. */
  provisionalFrom: string | null;
  floors: readonly number[];
}
export interface SeasonView {
  season: SeasonId;
  startsAt: string;
  endsAt: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Pods: games finished 1st, 2nd, 3rd, 4th (a shared place counts at that place). */
  places: [number, number, number, number] | null;
  /** display, peak, median and rank: null during placement and in a limited view. `median`: the badge statistic so far (7). */
  display: number | null;
  peak: number | null;
  median: number | null;
  tier: TierId | null;
  rank: number | null;
}
export interface LadderStatusEntry {
  ladder: LadderId;
  offered: boolean;
  /** From the attached matcher (13.4 attachQueue); { waiting: 0, estimatedWaitMs: null } before it is attached. */
  queue: { waiting: number; estimatedWaitMs: number | null };
  /** Null for a guest. */
  me: { rating: RatingView; details: RatingDetails; season: SeasonView } | null;
}
export interface LadderStatus {
  season: { id: SeasonId; endsAt: string };
  signedIn: boolean;
  /** A ranked-queue cooldown (8.6), ISO time, or null. */
  cooldownUntil: string | null;
  ladders: LadderStatusEntry[];
}
export interface LeaderboardEntry {
  rank: number;
  display: number;
  tier: TierId;
  /** Season games; null on a "Hidden player" row (10.1). */
  games: number | null;
  /**
   * Both null for an account not listed by its own choice, or without a current name ("Hidden player"), or deleted in a closed season ("Deleted
   * player": `deleted` true).
   */
  account: AccountId | null;
  name: string | null;
  deleted: boolean;
  you: boolean;
}
export interface LeaderboardPage { ladder: LadderId; season: SeasonId; closed: boolean; total: number; entries: LeaderboardEntry[]; next: string | null }
export interface HistoryPlayer {
  seat: SeatNo;
  place: Place;
  loss: LossCode | null;
  lossRule: string | null;
  outTurn: number | null;
  /**
   * The name at the time (stored; shown through m14 displayNameAt with the viewer: current names on others' seats, 10.2). account, name and tier are
   * null for an unlisted ("Hidden player") or deleted ("Deleted player", `deleted` true) account.
   */
  account: AccountId | null;
  name: string | null;
  deleted: boolean;
  tier: TierId | null;
}
export interface HistoryEntry {
  game: string;
  ladder: LadderId;
  season: SeasonId;
  endedAt: string;
  turns: number;
  outcome: 'win' | 'draw';
  players: HistoryPlayer[];
  /** The history's subject: its seat and shown rating before (after any season reset) and after; null during placement and in a limited view. */
  subject: { seat: SeatNo; place: Place; before: number | null; after: number | null; tierAfter: TierId | null };
  /** Whether a replay can still be fetched (12): until when, and whether the whole game is available. */
  replay: { until: string; full: boolean } | null;
}
export interface HistoryPage { account: AccountId; entries: HistoryEntry[]; next: string | null }
/** `rank`: the final rank; null when not on the final leaderboard, and in a limited view. */
export interface SeasonBadge { ladder: LadderId; season: SeasonId; tier: TierId; rank: number | null }
/** `limited`: the projection of 10.3 applies (every field it lists is null). */
export interface LadderProfile { account: AccountId; limited: boolean; ratings: RatingView[]; seasons: SeasonView[]; badges: SeasonBadge[] }
/**
 * What one ranked game can do to a player's shown rating (6.4); during placement the deltas are null. A preview from ratingNow at startedAt: a game
 * that ends in the next season is rated after that season's reset, so the change can differ (G10b).
 */
export type Stakes =
  | { ladder: LadderId; kind: '1v1'; win: number | null; draw: number | null; loss: number | null }
  | { ladder: LadderId; kind: 'pod'; byPlace: (number | null)[] };
//   stakesOneVsOne(me: Glicko2State, opponent: Glicko2State, daysMe: number, daysOpponent: number): { win: number; draw: number; loss: number }
//   stakesPod(players: readonly WengLinState[], me: number, days: readonly number[]): number[]
export { stakesOneVsOne, stakesPod } from './api/stakes';
/** After a rated game, to each seat (13.6). `before`: AppliedSeat.displayBefore (after any season reset), so the reset is never shown as the game's change. */
export interface RatedNotice {
  game: string;
  ladder: LadderId;
  season: SeasonId;
  seat: SeatNo;
  place: Place;
  before: number | null;
  after: number | null;
  tierBefore: TierId | null;
  tierAfter: TierId | null;
  placementLeft: number;
  provisional: boolean;
}
/** Why a ranked game was not rated, for the end screen (8.2, 8.3). */
export type NotRatedReason = 'void' | 'mismatch' | 'malformed' | 'ladderOff' | 'lost';

// ---- Page sizes and other limits (13.6) ---------------------------------------------------------------------------------------------------
export { LADDER_LIMITS } from './api/constants';
