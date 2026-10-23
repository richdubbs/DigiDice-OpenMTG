/**
 * M15-2: what players see (design 6.1, 6.2, 10.1, D5, 13.1): the initial states, the one shown number, the shown deviation, provisional NOW and the
 * instant a rating turns provisional, and the leaderboard's standing. Browser-safe: no `node:` imports, here or in anything this file imports.
 * Exposed only through the named re-export in ../api.ts.
 * Imports: values only from ./constants (GLICKO2, WENGLIN, LEADERBOARD_K, ...) or files of this part's own (./glicko2, ./wenglin, ./season); from
 * ../api types only (`import type`). ../api re-exports this file, so a value taken from ../api would be undefined while the contract loads (a cycle;
 * test/m15-1/load.test.ts refuses one).
 *
 * Both ladders use one scale in strength terms (5.2): Glicko-2's r and RD as they are, Weng-Lin's μ and σ at WENGLIN.displayScale (≈ 19.302) shown
 * points per μ around 1500. So tiers, matcher windows and the provisional limit read the same in 1v1 and in pods.
 */
import type { LadderDef, RatingModel, RatingState } from '../api';
import { GLICKO2, LEADERBOARD_K, WENGLIN } from './constants';
import { glicko2RdAt } from './glicko2';
import { isoMs } from './season';
import { wenglinSigmaAt } from './wenglin';

function finite(x: number, what: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new RangeError(`display: ${what} is not a finite number (${String(x)})`);
  return x;
}

function unknownModel(model: unknown): never {
  throw new RangeError(`display: unknown rating model (${String(model)})`);
}

/** The state of an account's first game in a ladder: GLICKO2 r0, rd0, vol0, or WENGLIN mu0, sigma0. A new object on every call. */
export function initialState(model: RatingModel): RatingState {
  if (model === 'glicko2') return { model: 'glicko2', r: GLICKO2.r0, rd: GLICKO2.rd0, vol: GLICKO2.vol0 };
  if (model === 'wenglin') return { model: 'wenglin', mu: WENGLIN.mu0, sigma: WENGLIN.sigma0 };
  return unknownModel(model);
}

/** The one shown number (D5, 6.1): Math.round(r) | Math.round(1500 + WENGLIN.displayScale (mu - 25)). */
export function displayRating(s: RatingState): number {
  if (s.model === 'glicko2') return Math.round(finite(s.r, 'r'));
  if (s.model === 'wenglin') return Math.round(GLICKO2.r0 + WENGLIN.displayScale * (finite(s.mu, 'mu') - WENGLIN.mu0));
  return unknownModel((s as { model?: unknown }).model);
}

/** rd | WENGLIN.displayScale sigma, of the state as given (not rounded; no time away: ratingNow's `deviation` adds that). */
export function displayDeviation(s: RatingState): number {
  if (s.model === 'glicko2') return finite(s.rd, 'rd');
  if (s.model === 'wenglin') return WENGLIN.displayScale * finite(s.sigma, 'sigma');
  return unknownModel((s as { model?: unknown }).model);
}

/**
 * Provisional NOW (6.2): `games` ≥ def.placementGames and `deviationNow` > def.provisionalDeviation. The caller passes ratingNow(row, now).deviation
 * (the stored state after the season reset, plus time away until now), never the stored RD. RatingView.provisional, the "?" mark and leaderboard
 * eligibility all use this one meaning; the store filters with the precomputed instant of provisionalFrom.
 * During placement (fewer games) it is false: the rating is hidden then, not marked. Throws a RangeError on a deviation that is not a finite number
 * or a games count that is not a whole number of at least 0.
 */
export function isProvisional(def: LadderDef, deviationNow: number, games: number): boolean {
  finite(deviationNow, 'deviationNow');
  if (!Number.isInteger(games) || games < 0) throw new RangeError(`display: games must be a whole number of at least 0 (${String(games)})`);
  return games >= def.placementGames && deviationNow > def.provisionalDeviation;
}

/**
 * What provisionalFrom answers for a rating that time away alone never makes provisional (a limit at or above the deviation's cap: 350 in 1v1,
 * 19.302 × 25/3 ≈ 160.9 in pods; never with the default limit of 120), and for an instant past the 4-digit years. Later than every server time, as
 * an ISO string and as a Date, so `now < provisionalFrom` stays true.
 */
const NEVER_PROVISIONAL = '9999-12-31T23:59:59.999Z';
const NEVER_MS = Date.parse(NEVER_PROVISIONAL);

/**
 * The first instant at which a rating last updated at `lastGameAt` (state `s`, after that game) becomes provisional by time away alone, within its
 * season: `lastGameAt` itself when it already is. Stored on the season record (13.3) for the leaderboard's filter.
 *
 * "Within its season": no later season's reset is counted, only the growth of the deviation by time away (glicko2RdAt, wenglinSigmaAt), so the
 * instant may lie past the season's end (an active 1v1 player at RD 60 turns provisional 99.4 days after its last game; a pod player at σ 1.6 after
 * about 124 days). The instant is exact to the millisecond: for every time t from `lastGameAt` on, in the same season,
 * `t >= provisionalFrom(def, s, lastGameAt)` exactly when isProvisional(def, ratingNow({ state: s, season, lastRatedAt: lastGameAt }, t).deviation,
 * games) for a placed rating, because it is found with the same expression ratingNow uses. When time away never gets there, the last instant of the
 * 4-digit years, '9999-12-31T23:59:59.999Z' (later than every server time, as a string and as a Date).
 * A season's close (7) asks provisionalFrom > endsAt, not isProvisional(ratingNow(row, endsAt).deviation): endsAt already belongs to the next
 * season, whose reset that read would count (see ratingNow).
 * Throws a RangeError when `s` is not of the ladder's model, or on a malformed time.
 */
export function provisionalFrom(def: LadderDef, s: RatingState, lastGameAt: string): string {
  if (s.model !== def.model) throw new RangeError(`display: a ${String(s.model)} rating on the ${def.id} ladder (${def.model})`);
  const t0 = isoMs(lastGameAt, 'lastGameAt');
  const limit = finite(def.provisionalDeviation, 'def.provisionalDeviation');
  // the shown deviation `ms` milliseconds after the game, exactly as ratingNow computes it (days = ms / periodMs)
  const deviationAfter = s.model === 'glicko2'
    ? (ms: number) => glicko2RdAt(s.rd, ms / GLICKO2.periodMs)
    : (ms: number) => WENGLIN.displayScale * wenglinSigmaAt(s.sigma, ms / GLICKO2.periodMs);
  if (deviationAfter(0) > limit) return lastGameAt;
  // The deviation never falls with time (every step of it rounds monotonically), so: find a bound by doubling, then the first millisecond.
  const room = NEVER_MS - t0;
  let hi = 1;
  while (deviationAfter(hi) <= limit) {
    if (hi >= room) return NEVER_PROVISIONAL;
    hi = Math.min(hi * 2, room);
  }
  let lo = 0; // deviationAfter(lo) <= limit < deviationAfter(hi)
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (deviationAfter(mid) > limit) hi = mid;
    else lo = mid;
  }
  return t0 + hi > NEVER_MS ? NEVER_PROVISIONAL : new Date(t0 + hi).toISOString();
}

/**
 * The leaderboard key (6.1, 10.1), never shown as a rating: Math.round(display − LEADERBOARD_K × deviation). An uncertain or parked rating stands
 * lower than a settled one of the same display.
 * A season's final standing (7) takes the stored rating and its deviation at the season's end with time away only, not ratingNow(row, endsAt):
 * endsAt already belongs to the next season and would apply its reset (see ratingNow).
 */
export function standingOf(display: number, deviation: number): number {
  return Math.round(finite(display, 'display') - LEADERBOARD_K * finite(deviation, 'deviation'));
}
