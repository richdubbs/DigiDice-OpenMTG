/**
 * M15-2: monthly seasons, the soft reset and `ratingNow` (design 4.3, 7, D7, 13.1). Browser-safe: no `node:` imports, here or in anything this file
 * imports. Exposed only through the named re-export in ../api.ts.
 * Imports: values only from ./constants (SEASON_ID, SEASON_RESET, GLICKO2, WENGLIN) or files of this part's own (./glicko2, ./wenglin); from ../api
 * types only (`import type`). ../api re-exports this file, so a value taken from ../api would be undefined while the contract loads (a cycle;
 * test/m15-1/load.test.ts refuses one).
 *
 * A season is a UTC calendar month, 'YYYY-MM'. A game belongs to the season in which it ENDED. The reset is lazy and applied once: a stored row
 * keeps the season of its last update, and the first read or game in a later season resets it, however many seasons were skipped (time away is
 * counted by the deviation's growth, not by the reset).
 */
import type { RatingRowLike, RatingState, SeasonId } from '../api';
import { GLICKO2, SEASON_ID, SEASON_RESET, WENGLIN } from './constants';
import { glicko2RdAt } from './glicko2';
import { wenglinSigmaAt } from './wenglin';

/** An ISO-8601 UTC time as the server writes it (toISOString, m13's isoTime): the fraction may have 0-3 digits; the zone must be Z. */
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

/**
 * The epoch milliseconds of an ISO-8601 UTC time, refusing anything else with a RangeError: another shape (a date alone, an offset other than Z,
 * more than 3 digits of a second, a sign or a 5-digit year), or a date or time that does not exist (30 February, 24:00, a leap second 23:59:60).
 * Not part of `@openmtg/ladder/api`: the parser seasonOf, ratingNow and provisionalFrom share.
 */
export function isoMs(isoTime: string, what = 'time'): number {
  const m = typeof isoTime === 'string' ? ISO_UTC.exec(isoTime) : null;
  if (m === null) throw new RangeError(`season: ${what} is not an ISO-8601 UTC time (${String(isoTime)})`);
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const ms = Number((m[7] ?? '').padEnd(3, '0'));
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day); // setUTCFullYear, not Date.UTC: Date.UTC reads years 0-99 as 1900-1999
  d.setUTCHours(hour, minute, second, ms);
  const t = d.getTime();
  const same = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day && d.getUTCHours() === hour
    && d.getUTCMinutes() === minute && d.getUTCSeconds() === second;
  if (!Number.isFinite(t) || !same) throw new RangeError(`season: ${what} is not a time that exists (${isoTime})`);
  return t;
}

/** True for a 'YYYY-MM' string (SEASON_ID). */
export function isSeasonId(x: unknown): x is SeasonId {
  return typeof x === 'string' && SEASON_ID.test(x);
}

function checkSeason(s: SeasonId, what = 'season'): SeasonId {
  if (!isSeasonId(s)) throw new RangeError(`season: ${what} is not a season id 'YYYY-MM' (${String(s)})`);
  return s;
}

/** The season of an ISO-8601 UTC time: its UTC year and month. Throws a RangeError on a malformed time (isoMs). */
export function seasonOf(isoTime: string): SeasonId {
  isoMs(isoTime);
  return isoTime.slice(0, 7);
}

/** The season after `s`: the next month, or January of the next year. Throws a RangeError on a malformed id and after 9999-12 (no 'YYYY-MM' then). */
export function nextSeason(s: SeasonId): SeasonId {
  checkSeason(s);
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  if (month < 12) return `${s.slice(0, 4)}-${String(month + 1).padStart(2, '0')}`;
  if (year >= 9999) throw new RangeError(`season: no season after ${s}`);
  return `${String(year + 1).padStart(4, '0')}-01`;
}

/**
 * startsAt inclusive, endsAt exclusive (the next season's start), both ISO-8601 UTC: 00:00:00.000Z on the first day of the month. Throws a
 * RangeError on a malformed id, and for 9999-12 (its end has no 4-digit year, and would not sort as a string beside the others).
 */
export function seasonBounds(s: SeasonId): { startsAt: string; endsAt: string } {
  return { startsAt: `${checkSeason(s)}-01T00:00:00.000Z`, endsAt: `${nextSeason(s)}-01T00:00:00.000Z` };
}

/**
 * The soft reset (7): the rating pulled SEASON_RESET.pull toward 1500 (pods: μ toward 25) and SEASON_RESET.deviationBump shown points of deviation
 * added in quadrature, capped at the initial deviation; volatility unchanged.
 *   Glicko-2:  r' = 1500 + 0.95 (r − 1500)    RD' = min(350, sqrt(RD² + 60²))                 σ' = σ
 *   Weng-Lin:  μ' = 25 + 0.95 (μ − 25)        σ'  = min(25/3, sqrt(σ² + (60 / 19.302)²))      (60 shown points = 3.108490 μ)
 * A new state; the argument is not changed.
 */
export function seasonReset(s: RatingState): RatingState {
  const keep = 1 - SEASON_RESET.pull;
  if (s.model === 'glicko2') {
    return {
      model: 'glicko2',
      r: GLICKO2.r0 + keep * (s.r - GLICKO2.r0),
      rd: Math.min(GLICKO2.rdMax, Math.sqrt(s.rd * s.rd + SEASON_RESET.deviationBump * SEASON_RESET.deviationBump)),
      vol: s.vol,
    };
  }
  if (s.model === 'wenglin') {
    const bump = SEASON_RESET.deviationBump / WENGLIN.displayScale;
    return { model: 'wenglin', mu: WENGLIN.mu0 + keep * (s.mu - WENGLIN.mu0), sigma: Math.min(WENGLIN.sigma0, Math.sqrt(s.sigma * s.sigma + bump * bump)) };
  }
  throw new RangeError(`season: unknown rating model (${String((s as { model?: unknown }).model)})`);
}

/**
 * A stored rating as of `at` (nothing stored). Pinned semantics (4.3):
 * - `state`: row.state with seasonReset applied once if row.season is older than seasonOf(at), and NOTHING for time away. It is the state
 *   rateOneVsOne and ratePod start from (they add time away from their `days`), and AppliedSeat.before (13.3).
 * - `season`: seasonOf(at) when the reset applied, else row.season.
 * - `deviation`: the shown deviation of `state` at `at`, with the time away since row.lastRatedAt added (glicko2RdAt / wenglinSigmaAt). For
 *   display, isProvisional and the matcher only.
 * Time away is (at − lastRatedAt) / GLICKO2.periodMs days, at least 0, and 0 when lastRatedAt is null. A row from a later season than `at` (a read
 * of the past) is not reset. Throws a RangeError on a malformed time or season id.
 *
 * A season's end is not a time of that season: `seasonBounds(s).endsAt` is exclusive and already belongs to the next season, so ratingNow(row,
 * endsAt) applies the NEXT season's reset (a 1700/60 row last rated 12 days before reads 1690 with a deviation of 92.2). What section 7's close
 * calls the deviation at the season's end (the final standing, eligibility) is the stored row's state with time away only, no reset:
 * glicko2RdAt(row.state.rd, days) | WENGLIN.displayScale × wenglinSigmaAt(row.state.sigma, days), days = (endsAt − lastRatedAt) / periodMs (that
 * row: 70.0, standing 1560 rather than 1506); a record is not provisional at the close when provisionalFrom > endsAt (display.ts).
 */
export function ratingNow(row: RatingRowLike, at: string): { state: RatingState; season: SeasonId; deviation: number } {
  const atMs = isoMs(at, 'at');
  const atSeason = at.slice(0, 7);
  checkSeason(row.season, 'row.season');
  if (row.state?.model !== 'glicko2' && row.state?.model !== 'wenglin') {
    throw new RangeError(`season: unknown rating model (${String((row.state as { model?: unknown } | undefined)?.model)})`);
  }
  const reset = row.season < atSeason; // 'YYYY-MM' strings order as their months do
  const state = reset ? seasonReset(row.state) : row.state;
  const days = row.lastRatedAt === null ? 0 : Math.max(0, (atMs - isoMs(row.lastRatedAt, 'row.lastRatedAt')) / GLICKO2.periodMs);
  const deviation = state.model === 'glicko2' ? glicko2RdAt(state.rd, days) : WENGLIN.displayScale * wenglinSigmaAt(state.sigma, days);
  return { state, season: reset ? atSeason : row.season, deviation };
}
