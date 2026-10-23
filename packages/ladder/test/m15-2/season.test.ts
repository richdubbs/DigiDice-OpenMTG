/**
 * M15-2: seasons (design 7, 4.3, 17.4): ids, seasonOf at month boundaries (31 December 23:59:59.999Z, 1 January 00:00:00.000Z, 29 February 2028)
 * and malformed times refused, bounds and the next season, the soft reset's examples, and ratingNow's pinned semantics: the reset applied once
 * however many seasons passed, its `state` never with time away while its `deviation` has it.
 */
import { describe, expect, it } from 'vitest';
import {
  GLICKO2, glicko2RdAt, isSeasonId, nextSeason, ratingNow, SEASON_RESET, seasonBounds, seasonOf, seasonReset, WENGLIN, wenglinSigmaAt,
  type Glicko2State, type RatingRowLike, type WengLinState,
} from '@openmtg/ladder/api';
import { isoMs } from '../../src/api/season';
import { daysBefore, G, near, nearGlicko, W } from './helpers';

describe('M15-2: season ids (7)', () => {
  it("isSeasonId: 'YYYY-MM' with a month 01-12, nothing else", () => {
    for (const ok of ['2026-10', '2026-01', '2026-12', '2028-02', '0001-01', '9999-12']) expect(isSeasonId(ok), ok).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-10', '2026/10', '2026-10-01', ' 2026-10', '2026-10 ', '', 202610, null, undefined, {}]) {
      expect(isSeasonId(bad), String(bad)).toBe(false);
    }
  });

  it('seasonOf: the UTC month of the time, at its boundaries', () => {
    expect(seasonOf('2026-12-31T23:59:59.999Z')).toBe('2026-12');
    expect(seasonOf('2027-01-01T00:00:00.000Z')).toBe('2027-01');
    expect(seasonOf('2028-02-29T12:00:00.000Z')).toBe('2028-02');
    expect(seasonOf('2028-02-29T23:59:59.999Z')).toBe('2028-02');
    expect(seasonOf('2028-03-01T00:00:00.000Z')).toBe('2028-03');
    expect(seasonOf('2026-03-31T23:50:00.000Z')).toBe('2026-03');
    // a game that starts at 23:50 on 31 March and ends at 00:20 on 1 April counts for April: the season of its END
    expect(seasonOf('2026-04-01T00:20:00.000Z')).toBe('2026-04');
    // the shorter ISO forms the server can write: no fraction, or fewer digits of it
    expect(seasonOf('2026-10-15T12:00:00Z')).toBe('2026-10');
    expect(seasonOf('2026-10-15T12:00:00.5Z')).toBe('2026-10');
  });

  it('seasonOf refuses malformed times with a RangeError', () => {
    const bad = [
      '', 'garbage', '2026-10-15', '2026-10-15T12:00', '2026-10-15 12:00:00.000Z', '2026-10-15T12:00:00.000', '2026-10-15T12:00:00.000+00:00',
      '2026-10-15T12:00:00.000z', '2026-10-15T12:00:00.0000Z', '+002026-10-15T12:00:00.000Z', '20261-10-15T12:00:00.000Z',
      '2027-02-29T12:00:00.000Z', '2026-04-31T00:00:00.000Z', '2026-13-01T00:00:00.000Z', '2026-00-10T00:00:00.000Z', '2026-10-00T00:00:00.000Z',
      '2026-10-15T24:00:00.000Z', '2026-10-15T12:60:00.000Z', '2026-12-31T23:59:60.000Z',
    ];
    for (const t of bad) expect(() => seasonOf(t), t).toThrow(RangeError);
    for (const t of [undefined, null, 1_700_000_000_000, new Date()]) expect(() => seasonOf(t as unknown as string)).toThrow(RangeError);
  });

  it('isoMs reads the epoch time exactly, years before 100 included (setUTCFullYear, not Date.UTC)', () => {
    expect(isoMs('2026-10-15T12:34:56.789Z')).toBe(Date.parse('2026-10-15T12:34:56.789Z'));
    expect(isoMs('2026-10-15T12:34:56Z')).toBe(Date.parse('2026-10-15T12:34:56.000Z'));
    expect(isoMs('2026-10-15T12:34:56.7Z')).toBe(Date.parse('2026-10-15T12:34:56.700Z'));
    expect(new Date(isoMs('0050-06-01T00:00:00.000Z')).toISOString()).toBe('0050-06-01T00:00:00.000Z');
  });

  it('seasonBounds: from 00:00:00.000Z on the 1st (inclusive) to the next season\'s start (exclusive)', () => {
    expect(seasonBounds('2026-10')).toEqual({ startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' });
    expect(seasonBounds('2026-12')).toEqual({ startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' });
    expect(seasonBounds('2028-02')).toEqual({ startsAt: '2028-02-01T00:00:00.000Z', endsAt: '2028-03-01T00:00:00.000Z' });
    for (const s of ['2026-01', '2026-02', '2026-06', '2026-12', '2027-02', '2028-02', '2099-12']) {
      const { startsAt, endsAt } = seasonBounds(s);
      expect(seasonOf(startsAt)).toBe(s);
      expect(seasonOf(new Date(Date.parse(endsAt) - 1).toISOString())).toBe(s);
      expect(seasonOf(endsAt)).toBe(nextSeason(s));
      expect(seasonBounds(nextSeason(s)).startsAt).toBe(endsAt);
    }
  });

  it('nextSeason: the next month, across a year; refused after 9999-12 and on a malformed id', () => {
    expect(nextSeason('2026-09')).toBe('2026-10');
    expect(nextSeason('2026-10')).toBe('2026-11');
    expect(nextSeason('2026-12')).toBe('2027-01');
    expect(nextSeason('0999-12')).toBe('1000-01');
    expect(() => nextSeason('9999-12')).toThrow(RangeError);
    expect(() => seasonBounds('9999-12')).toThrow(RangeError);
    for (const bad of ['2026-13', '2026-1', '']) {
      expect(() => nextSeason(bad)).toThrow(RangeError);
      expect(() => seasonBounds(bad)).toThrow(RangeError);
    }
  });
});

describe('M15-2: the soft reset (7)', () => {
  it('the examples: 1900/60 → 1880/84.8528; 1300/110 → 1310/125.2996; pods (30, 2) → (29.75, 3.696310); volatility kept', () => {
    nearGlicko(seasonReset(G(1900, 60, 0.06)) as Glicko2State, 1880, 84.8528, 0.06, '1900/60');
    nearGlicko(seasonReset(G(1300, 110, 0.07)) as Glicko2State, 1310, 125.2996, 0.07, '1300/110');
    const pod = seasonReset(W(30, 2)) as WengLinState;
    expect(pod.model).toBe('wenglin');
    near(pod.mu, 29.75, 1e-12, 'μ');
    near(pod.sigma, 3.69631, 0.000001, 'σ');
    // 60 shown points are 3.108490 μ
    near(SEASON_RESET.deviationBump / WENGLIN.displayScale, 3.10849, 0.000001, 'the bump in μ');
  });

  it('pulls 5% toward 1500 (pods 25) and adds 60 shown points in quadrature, capped at the initial deviation', () => {
    nearGlicko(seasonReset(G(1100, 50, 0.06)) as Glicko2State, 1120, Math.sqrt(50 ** 2 + 60 ** 2), 0.06, 'below 1500');
    expect(seasonReset(G(1500, 345, 0.06))).toEqual(G(1500, GLICKO2.rdMax, 0.06));
    expect(seasonReset(W(25, 8))).toEqual(W(25, WENGLIN.sigma0));
    near((seasonReset(W(15, 1)) as WengLinState).mu, 15.5, 1e-12, 'pods below 25');
  });

  it('returns a new state and leaves its argument alone; refuses an unknown model', () => {
    const s = G(1900, 60, 0.06);
    const copy = structuredClone(s);
    expect(seasonReset(s)).not.toBe(s);
    expect(s).toEqual(copy);
    expect(() => seasonReset({ model: 'elo', r: 1 } as unknown as Glicko2State)).toThrow(RangeError);
  });
});

describe('M15-2: ratingNow, pinned (4.3, 13.1)', () => {
  const at = '2026-11-14T12:00:00.000Z';

  it('the same season: the state as stored, the season kept, time away only in the deviation', () => {
    const row: RatingRowLike = { state: G(1600, 80, 0.06), season: '2026-11', lastRatedAt: daysBefore(at, 10) };
    const now = ratingNow(row, at);
    expect(now.state).toEqual(row.state);
    expect(now.season).toBe('2026-11');
    near(now.deviation, glicko2RdAt(80, 10), 1e-9, 'deviation');
    expect(now.deviation).toBeGreaterThan(80);
  });

  it('a later season: the reset applied ONCE however many seasons passed, the season moved to seasonOf(at)', () => {
    for (const season of ['2026-10', '2026-01', '2024-03']) {
      const row: RatingRowLike = { state: G(1900, 60, 0.06), season, lastRatedAt: daysBefore(at, 1) };
      const now = ratingNow(row, at);
      expect(now.state, season).toEqual(seasonReset(row.state));
      expect(now.season).toBe('2026-11');
    }
  });

  it('its state never includes time away; its deviation is the state at `at` with the time away since lastRatedAt', () => {
    const row: RatingRowLike = { state: G(1700, 70, 0.06), season: '2026-10', lastRatedAt: daysBefore(at, 40) };
    const now = ratingNow(row, at);
    nearGlicko(now.state as Glicko2State, 1690, 92.1954, 0.06, 'state');
    near(now.deviation, 113.3385, 0.0001, 'deviation');
    // reading again gives the same: nothing is stored or accumulated
    expect(ratingNow(row, at)).toEqual(now);
  });

  it('pods: the shown deviation, 19.302 × wenglinSigmaAt', () => {
    const row: RatingRowLike = { state: W(30, 2), season: '2026-10', lastRatedAt: daysBefore(at, 40) };
    const now = ratingNow(row, at);
    near((now.state as WengLinState).mu, 29.75, 1e-12, 'μ');
    near(now.deviation, WENGLIN.displayScale * wenglinSigmaAt(3.69631, 40), 0.0001, 'deviation');
    near(now.deviation, WENGLIN.displayScale * 5.032565, 0.0001, 'P10');
  });

  it('a first game (lastRatedAt null) has no time away; a read before lastRatedAt counts 0 days; a row from a later season is not reset', () => {
    const fresh: RatingRowLike = { state: G(1500, 350, 0.06), season: '2026-11', lastRatedAt: null };
    expect(ratingNow(fresh, at)).toEqual({ state: fresh.state, season: '2026-11', deviation: 350 });
    const future: RatingRowLike = { state: G(1600, 80, 0.06), season: '2026-11', lastRatedAt: '2026-11-20T00:00:00.000Z' };
    expect(ratingNow(future, at).deviation).toBe(80);
    const later: RatingRowLike = { state: G(1600, 80, 0.06), season: '2026-12', lastRatedAt: '2026-12-02T00:00:00.000Z' };
    expect(ratingNow(later, at)).toEqual({ state: later.state, season: '2026-12', deviation: 80 });
  });

  it('a game across midnight counts for the new month: the row read at its end is reset (G10b)', () => {
    const row: RatingRowLike = { state: G(1600, 80, 0.06), season: '2026-10', lastRatedAt: '2026-10-31T00:20:00.000Z' };
    expect(ratingNow(row, '2026-10-31T23:40:00.000Z').season).toBe('2026-10');
    const atEnd = ratingNow(row, '2026-11-01T00:20:00.000Z');
    expect(atEnd.season).toBe('2026-11');
    nearGlicko(atEnd.state as Glicko2State, 1595, 100, 0.06, 'reset at the end');
  });

  it('the 1300/110 example of 6.2: at its first read in the new season it shows 1310 with a deviation of 125.3', () => {
    const row: RatingRowLike = { state: G(1300, 110, 0.06), season: '2026-10', lastRatedAt: '2026-10-31T23:00:00.000Z' };
    const now = ratingNow(row, '2026-11-01T00:00:00.000Z');
    near((now.state as Glicko2State).r, 1310, 1e-9, 'r');
    near(now.deviation, 125.3, 0.05, 'deviation now');
  });

  it('refuses a malformed time, season or model with a RangeError', () => {
    const row: RatingRowLike = { state: G(1600, 80, 0.06), season: '2026-11', lastRatedAt: daysBefore(at, 1) };
    expect(() => ratingNow(row, '2026-11-14')).toThrow(RangeError);
    expect(() => ratingNow({ ...row, season: '2026-13' }, at)).toThrow(RangeError);
    expect(() => ratingNow({ ...row, lastRatedAt: 'yesterday' }, at)).toThrow(RangeError);
    expect(() => ratingNow({ ...row, state: { model: 'elo' } as unknown as Glicko2State }, at)).toThrow(RangeError);
  });
});
