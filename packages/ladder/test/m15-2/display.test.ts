/**
 * M15-2: what players see (design 6.1, 6.2, 10.1, 17.4): the initial states, displayRating and displayDeviation for both models, isProvisional given
 * ratingNow(...).deviation (the 99.4-day and 1310/125.3 examples of 6.2), provisionalFrom (1v1 and pods, exact to the millisecond, and `lastGameAt`
 * itself when already above) and standingOf; a season's end, which ratingNow already reads as the next season (reset), against the deviation
 * at the end that the close uses (time away only; M15-2 review).
 */
import { describe, expect, it } from 'vitest';
import {
  displayDeviation, displayRating, glicko2RdAt, initialState, isProvisional, LADDERS, LEADERBOARD_K, provisionalFrom, rateOneVsOne, ratingNow,
  seasonBounds, seasonReset, standingOf, WENGLIN, wenglinSigmaAt, type Glicko2State, type LadderDef, type RatingRowLike, type RatingState,
} from '@openmtg/ladder/api';
import { DAY_MS, daysBetween, G, near, nearGlicko, W } from './helpers';

const ONE = LADDERS['1v1-standard'];
const POD = LADDERS['pod-commander'];
const NEVER = '9999-12-31T23:59:59.999Z';

/** Provisional at `at` for a placed rating stored at `lastGameAt`, as the service reads it: isProvisional(def, ratingNow(row, at).deviation, games). */
function provisionalAt(def: LadderDef, state: RatingState, lastGameAt: string, at: string): boolean {
  const row: RatingRowLike = { state, season: lastGameAt.slice(0, 7), lastRatedAt: lastGameAt };
  return isProvisional(def, ratingNow(row, at).deviation, def.placementGames);
}

const plusMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

describe('M15-2: initial states and the shown numbers (6.1)', () => {
  it("initialState: Glicko-2's 1500/350/0.06 and Weng-Lin's (25, 25/3), a new object each call", () => {
    expect(initialState('glicko2')).toEqual({ model: 'glicko2', r: 1500, rd: 350, vol: 0.06 });
    expect(initialState('wenglin')).toEqual({ model: 'wenglin', mu: 25, sigma: 25 / 3 });
    expect(initialState('glicko2')).not.toBe(initialState('glicko2'));
    expect(() => initialState('elo' as 'glicko2')).toThrow(RangeError);
  });

  it('displayRating: Math.round(r) | Math.round(1500 + 19.302 (μ − 25)); a new player shows 1500 in both models', () => {
    expect(displayRating(G(1612.0416, 61, 0.06))).toBe(1612);
    expect(displayRating(G(1612.5, 61, 0.06))).toBe(1613);
    expect(displayRating(G(1590.4999, 61, 0.06))).toBe(1590);
    expect(displayRating(initialState('glicko2'))).toBe(1500);
    expect(displayRating(initialState('wenglin'))).toBe(1500);
    expect(displayRating(W(27.795253, 8.26))).toBe(1554);
    expect(displayRating(W(20.962413, 8.08))).toBe(1422);
    expect(displayRating(W(25 + 400 / WENGLIN.displayScale, 2))).toBe(1900);
    expect(() => displayRating(G(Number.NaN, 60, 0.06))).toThrow(RangeError);
    expect(() => displayRating({ model: 'elo' } as unknown as RatingState)).toThrow(RangeError);
  });

  it('displayDeviation: RD | 19.302 σ, of the state as given (not rounded, no time away)', () => {
    expect(displayDeviation(G(1500, 61.7479, 0.06))).toBe(61.7479);
    near(displayDeviation(W(25, 25 / 3)), 160.85, 0.01, 'σ0');
    near(displayDeviation(W(25, 1.6)), 30.88, 0.01, 'an active pod player');
    expect(displayDeviation(W(25, 2))).toBe(WENGLIN.displayScale * 2);
  });

  it('standingOf: Math.round(display − 2 × deviation); a settled 1700 stands above an uncertain 1712', () => {
    expect(LEADERBOARD_K).toBe(2);
    expect(standingOf(1600, 80)).toBe(1440);
    expect(standingOf(1700, 60)).toBe(1580);
    expect(standingOf(1712, 110)).toBe(1492);
    expect(standingOf(1700, 60)).toBeGreaterThan(standingOf(1712, 110));
    expect(standingOf(1500, 60.25)).toBe(1380);
    expect(standingOf(1500, 60.2)).toBe(1380);
    expect(standingOf(1500, 60.3)).toBe(1379);
    expect(() => standingOf(1500, Number.NaN)).toThrow(RangeError);
  });
});

describe('M15-2: provisional NOW (6.2)', () => {
  it('isProvisional: after placement, a deviation now strictly above the limit (120); never during placement', () => {
    expect(isProvisional(ONE, 350, 9)).toBe(false);
    expect(isProvisional(ONE, 350, 0)).toBe(false);
    expect(isProvisional(ONE, 120, 10)).toBe(false);
    expect(isProvisional(ONE, 120.0001, 10)).toBe(true);
    expect(isProvisional(ONE, 125.3, 300)).toBe(true);
    expect(isProvisional(POD, 121, 10)).toBe(true);
    expect(() => isProvisional(ONE, Number.NaN, 10)).toThrow(RangeError);
    expect(() => isProvisional(ONE, 100, 1.5)).toThrow(RangeError);
    expect(() => isProvisional(ONE, 100, -1)).toThrow(RangeError);
  });

  it('an active 1v1 player at RD 60 becomes provisional after 99 days without a game (99.4); a pod player at σ 1.6 after about 124', () => {
    const last = '2026-10-01T00:00:00.000Z';
    const at = (days: number) => plusMs(last, days * DAY_MS);
    // within the season no reset applies, so read the growth by time away alone through the same functions ratingNow uses
    expect(isProvisional(ONE, glicko2RdAt(60, 99), 10)).toBe(false);
    expect(isProvisional(ONE, glicko2RdAt(60, 100), 10)).toBe(true);
    expect(isProvisional(POD, WENGLIN.displayScale * wenglinSigmaAt(1.6, 123), 10)).toBe(false);
    expect(isProvisional(POD, WENGLIN.displayScale * wenglinSigmaAt(1.6, 125), 10)).toBe(true);
    // and the same rating read through ratingNow a few days on, in its season, is not provisional
    expect(provisionalAt(ONE, G(1600, 60, 0.06), last, at(20))).toBe(false);
  });

  it('1300/110 becomes 1310/125.3 at its first read in the new season and is provisional until its next game brings it to about 118.5', () => {
    const row: RatingRowLike = { state: G(1300, 110, 0.06), season: '2026-10', lastRatedAt: '2026-10-31T22:00:00.000Z' };
    const first = ratingNow(row, '2026-11-01T00:00:00.000Z');
    expect(displayRating(first.state)).toBe(1310);
    near(first.deviation, 125.3, 0.05, 'deviation now');
    expect(isProvisional(ONE, first.deviation, 40)).toBe(true);
    // before the season turned, the same row was not provisional
    expect(isProvisional(ONE, ratingNow(row, '2026-10-31T23:59:59.999Z').deviation, 40)).toBe(false);
    // its next game, against an established opponent at its rating
    const [after] = rateOneVsOne(first.state as Glicko2State, G(1310, 60, 0.06), 1, 0, 0);
    near(after.rd, 118.5, 0.05, 'RD after the next game');
    expect(isProvisional(ONE, after.rd, 41)).toBe(false);
  });
});

describe('M15-2: provisionalFrom (6.2, 13.3)', () => {
  it('1v1 at RD 60: the last game plus 99.4 days, exact to the millisecond against the time-away growth', () => {
    const last = '2026-10-15T12:00:00.000Z';
    const from = provisionalFrom(ONE, G(1600, 60, 0.06), last);
    const ms = Date.parse(from) - Date.parse(last);
    near(ms / DAY_MS, 99.41, 0.005, 'days');
    expect(glicko2RdAt(60, (ms - 1) / DAY_MS)).toBeLessThanOrEqual(120);
    expect(glicko2RdAt(60, ms / DAY_MS)).toBeGreaterThan(120);
    // the analytic instant (L² − RD²) / (scale · idleVolPerDay)² days, rounded up to the next millisecond
    expect(Math.abs(ms - ((120 ** 2 - 60 ** 2) / (173.7178 * 0.06) ** 2) * DAY_MS)).toBeLessThanOrEqual(1);
  });

  it('pods at σ 1.6: the last game plus about 123.8 days', () => {
    const last = '2026-10-15T12:00:00.000Z';
    const from = provisionalFrom(POD, W(28, 1.6), last);
    const ms = Date.parse(from) - Date.parse(last);
    near(ms / DAY_MS, 123.77, 0.01, 'days');
    expect(WENGLIN.displayScale * wenglinSigmaAt(1.6, (ms - 1) / DAY_MS)).toBeLessThanOrEqual(120);
    expect(WENGLIN.displayScale * wenglinSigmaAt(1.6, ms / DAY_MS)).toBeGreaterThan(120);
  });

  it('within its season, `at >= provisionalFrom` is exactly isProvisional(ratingNow(row, at).deviation), to the millisecond (1v1 and pods)', () => {
    const last = '2026-10-01T06:00:00.000Z';
    for (const [def, s] of [[ONE, G(1600, 115, 0.06)], [ONE, G(1600, 119.99, 0.06)], [POD, W(25, 6.1)], [POD, W(30, 6.2)]] as const) {
      const from = provisionalFrom(def, s, last);
      expect(from.slice(0, 7), 'the instant lies in the season').toBe('2026-10');
      expect(provisionalAt(def, s, last, plusMs(from, -1))).toBe(false);
      expect(provisionalAt(def, s, last, from)).toBe(true);
      expect(provisionalAt(def, s, last, plusMs(from, 1))).toBe(true);
      expect(provisionalAt(def, s, last, last)).toBe(false);
    }
  });

  it('`lastGameAt` itself when the rating already is provisional after its game', () => {
    expect(provisionalFrom(ONE, G(1400, 125, 0.06), '2026-10-15T12:00:00.000Z')).toBe('2026-10-15T12:00:00.000Z');
    expect(provisionalFrom(POD, W(25, 25 / 3), '2026-10-15T12:00:00.000Z')).toBe('2026-10-15T12:00:00.000Z');
    // at the limit exactly it is not provisional yet: the next millisecond of time away makes it so
    expect(provisionalFrom(ONE, G(1400, 120, 0.06), '2026-10-15T12:00:00.000Z')).toBe('2026-10-15T12:00:00.001Z');
  });

  it('never by time away alone when the limit is at or above the cap (350 in 1v1, about 160.9 in pods): the last instant of the 4-digit years', () => {
    const high: LadderDef = { ...ONE, provisionalDeviation: 350 };
    expect(provisionalFrom(high, G(1500, 60, 0.06), '2026-10-15T12:00:00.000Z')).toBe(NEVER);
    const podHigh: LadderDef = { ...POD, provisionalDeviation: 161 };
    expect(provisionalFrom(podHigh, W(25, 1.6), '2026-10-15T12:00:00.000Z')).toBe(NEVER);
    expect(Date.parse(NEVER)).toBeGreaterThan(Date.parse('2999-01-01T00:00:00.000Z'));
    expect(provisionalFrom(ONE, G(1600, 60, 0.06), '9999-12-01T00:00:00.000Z')).toBe(NEVER);
  });

  it("a season's end (7, the close): endsAt is already the next season, so ratingNow there is reset; the close uses time away alone", () => {
    const { endsAt } = seasonBounds('2026-10');
    const last = '2026-10-20T00:00:00.000Z';
    const days = daysBetween(last, endsAt);
    expect(days).toBe(12);
    const row: RatingRowLike = { state: G(1700, 60, 0.06), season: '2026-10', lastRatedAt: last };
    // ratingNow(row, endsAt): the next season's first read, reset (1690, RD 84.8528, then 12 days away)
    const next = ratingNow(row, endsAt);
    expect(next.season).toBe('2026-11');
    nearGlicko(next.state as Glicko2State, 1690, 84.8528, 0.06, 'reset');
    near(next.deviation, 92.2154, 0.0001, 'deviation after the reset');
    expect(standingOf(displayRating(next.state), next.deviation)).toBe(1506);
    // the deviation AT the season's end, for the final standing: the stored state's growth by time away, no reset
    const atEnd = glicko2RdAt((row.state as Glicko2State).rd, days);
    near(atEnd, 70.0263, 0.0001, 'deviation at the end');
    expect(standingOf(displayRating(row.state), atEnd)).toBe(1560);
    // the season's last millisecond agrees with it (one millisecond less of time away), and is not reset
    const lastMs = ratingNow(row, plusMs(endsAt, -1));
    expect(lastMs.season).toBe('2026-10');
    expect(lastMs.state).toEqual(row.state);
    near(lastMs.deviation, atEnd, 1e-6, 'deviation at the last millisecond');
    // eligibility at the close is provisionalFrom > endsAt: a 1700/112 row is eligible, though ratingNow(row, endsAt) reads it as provisional
    const edge: RatingRowLike = { ...row, state: G(1700, 112, 0.06) };
    expect(provisionalFrom(ONE, edge.state, last)).toBe('2026-11-06T02:00:48.311Z');
    expect(provisionalFrom(ONE, edge.state, last) > endsAt).toBe(true);
    expect(isProvisional(ONE, glicko2RdAt(112, days), 40)).toBe(false);
    expect(isProvisional(ONE, ratingNow(edge, endsAt).deviation, 40)).toBe(true);
    // pods: 19.302 × wenglinSigmaAt of the stored σ, against the reset one
    const pod: RatingRowLike = { state: W(30, 2), season: '2026-10', lastRatedAt: last };
    const podAtEnd = WENGLIN.displayScale * wenglinSigmaAt(2, days);
    near(ratingNow(pod, plusMs(endsAt, -1)).deviation, podAtEnd, 1e-6, 'pod deviation at the last millisecond');
    const podNext = ratingNow(pod, endsAt);
    expect(podNext.state).toEqual(seasonReset(pod.state));
    near(podNext.deviation, WENGLIN.displayScale * wenglinSigmaAt(3.69631, days), 0.0001, 'pod deviation after the reset');
    expect(podNext.deviation).toBeGreaterThan(podAtEnd + 25);
  });

  it('refuses a rating of the other model, or a malformed time, with a RangeError', () => {
    expect(() => provisionalFrom(ONE, W(25, 2), '2026-10-15T12:00:00.000Z')).toThrow(RangeError);
    expect(() => provisionalFrom(POD, G(1500, 60, 0.06), '2026-10-15T12:00:00.000Z')).toThrow(RangeError);
    expect(() => provisionalFrom(ONE, G(1500, 60, 0.06), '2026-10-15')).toThrow(RangeError);
  });
});
