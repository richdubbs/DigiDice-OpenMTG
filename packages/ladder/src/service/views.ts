/**
 * M15-3: the views the reads send to browsers (design 6.1, 6.2, 6.4, 10.3, 13.1), as pure functions of stored rows and the time. "Limited" is the
 * projection another viewer gets of an account with PrivacySettings.leaderboards false (10.3): every field the table there lists is null.
 */
import {
  displayRating, GLICKO2, initialState, isProvisional, provisionalFrom, ratingNow, seasonBounds, tierOf, WENGLIN, glicko2RdAt, wenglinSigmaAt,
  type LadderDef, type RatingDetails, type RatingModel, type RatingView, type SeasonId, type SeasonView,
} from '../api';
import { isoMs } from '../api/season';
import type { RatingRow, SeasonRecord } from '../store/api';

/** The median of the season's ratings (7: the badge statistic); the mean of the two middle values for an even count; null when there are none. */
export function medianOf(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The shown deviation `days` after a game whose shown deviation was `deviation`, by time away only, no reset (7: the deviation at the season's end):
 * glicko2RdAt for 1v1, the drift of 5.2 for pods (σ = deviation / 19.302).
 */
export function deviationAfter(model: RatingModel, deviation: number, days: number): number {
  return model === 'glicko2' ? glicko2RdAt(deviation, days) : WENGLIN.displayScale * wenglinSigmaAt(deviation / WENGLIN.displayScale, days);
}

/** Days from `from` to `to` (ISO times), at least 0. */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, isoMs(to) - isoMs(from)) / GLICKO2.periodMs;
}

/**
 * Whether a record is on its season's live leaderboard at `now` (10.1): placement done, `leaderboardGames` season games, listed, and not provisional
 * now (now < provisionalFrom).
 */
export function liveEligible(def: LadderDef, r: SeasonRecord | null, now: string): r is SeasonRecord & { standing: number } {
  return r !== null && r.display !== null && r.standing !== null && r.games >= def.leaderboardGames && r.listed && r.provisionalFrom !== null
    && isoMs(now) < isoMs(r.provisionalFrom);
}

/** The account's rating as of `now` (6.1, 6.2), with its details (own account only, 6.4). `rank` is the live rank, computed by the caller. */
export function ratingViewOf(
  def: LadderDef,
  row: RatingRow | null,
  now: string,
  floors: readonly number[],
  rank: number | null,
  limited: boolean,
): { rating: RatingView; details: RatingDetails } {
  const games = row?.games ?? 0;
  const current = now.slice(0, 7);
  const rn = ratingNow(row ?? { state: initialState(def.model), season: current, lastRatedAt: null }, now);
  const placed = games >= def.placementGames;
  const reset = row !== null && row.season < current;
  const display = placed ? displayRating(rn.state) : null;
  // the stored tier keeps the buffer within its season; after a reset (lazily, at this read) it is computed fresh (6.3, 7)
  const tier = display === null ? null : reset || row?.tier == null ? tierOf(display, floors) : row.tier;
  return {
    rating: {
      ladder: def.id,
      display: limited ? null : display,
      tier,
      provisional: isProvisional(def, rn.deviation, games),
      placementLeft: Math.max(0, def.placementGames - games),
      games,
      rank: limited ? null : rank,
    },
    details: {
      state: rn.state,
      deviationNow: rn.deviation,
      lastRatedAt: row?.lastRatedAt ?? null,
      provisionalFrom: placed && row?.lastRatedAt ? provisionalFrom(def, rn.state, row.lastRatedAt) : null,
      floors: [...floors],
    },
  };
}

/** A season's record as players see it (13.1); an empty one when the account has no record of the season. */
export function seasonViewOf(def: LadderDef, season: SeasonId, r: SeasonRecord | null, rank: number | null, limited: boolean): SeasonView {
  const { startsAt, endsAt } = seasonBounds(season);
  if (r === null) {
    return {
      season, startsAt, endsAt, games: 0, wins: 0, draws: 0, losses: 0, places: def.model === 'wenglin' ? [0, 0, 0, 0] : null,
      display: null, peak: null, median: null, tier: null, rank: null,
    };
  }
  return {
    season, startsAt, endsAt, games: r.games, wins: r.wins, draws: r.draws, losses: r.losses, places: r.places ? [...r.places] : null,
    display: limited ? null : r.display,
    peak: limited || r.display === null ? null : r.peak,
    median: limited || r.display === null ? null : medianOf(r.seasonRatings),
    tier: r.tier,
    rank: limited ? null : rank,
  };
}
