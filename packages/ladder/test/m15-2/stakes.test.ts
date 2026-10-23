/**
 * M15-2: stakes (design 6.4): what one ranked game can do to a player's shown rating, as whole shown points (displayRating after − before, the same
 * difference the end screen shows), in 1v1 for a win, a draw and a loss and in a pod for each place with the others in rating order. Also the
 * accepted inversion of 6.4 in its pure form (M15-3 pins it through the service, 17.6): from one's own +w / −l, E ≈ l / (w + l) and the gap.
 */
import { describe, expect, it } from 'vitest';
import {
  displayRating, GLICKO2, glicko2Expected, glicko2RdAt, rateOneVsOne, ratePod, stakesOneVsOne, stakesPod, type Place,
} from '@openmtg/ladder/api';
import { G, mixedPod, near, newPod, W } from './helpers';

describe('M15-2: stakes in 1v1 (6.4)', () => {
  it('a 1600/60 player against a hidden 1650/80 sees +12 / −9 (G4, G5)', () => {
    const me = G(1600, 60, 0.06);
    const them = G(1650, 80, 0.06);
    const s = stakesOneVsOne(me, them, 2, 10);
    expect([s.win, s.loss]).toEqual([12, -9]);
    expect(s.draw).toBe(displayRating(rateOneVsOne(me, them, 0.5, 2, 10)[0]) - 1600);
  });

  it('each change is the shown rating after the game less the shown rating before it, whole points', () => {
    const cases = [[G(1500, 350, 0.06), G(1500, 350, 0.06), 0, 0], [G(1712.4, 110, 0.06), G(1500, 60, 0.07), 3, 0.5], [G(1300.5, 125, 0.06), G(1900, 50, 0.06), 40, 1]] as const;
    for (const [me, them, dMe, dThem] of cases) {
      const s = stakesOneVsOne(me, them, dMe, dThem);
      for (const [key, score] of [['win', 1], ['draw', 0.5], ['loss', 0]] as const) {
        expect(s[key]).toBe(displayRating(rateOneVsOne(me, them, score, dMe, dThem)[0]) - displayRating(me));
        expect(Number.isInteger(s[key])).toBe(true);
      }
      expect(s.win).toBeGreaterThanOrEqual(s.draw);
      expect(s.draw).toBeGreaterThanOrEqual(s.loss);
    }
    // two new players: a first win is worth +162 (risk 7)
    expect(stakesOneVsOne(G(1500, 350, 0.06), G(1500, 350, 0.06), 0, 0)).toEqual({ win: 162, draw: 0, loss: -162 });
  });

  it('what the stakes reveal (accepted, 6.4): E ≈ l / (w + l) and from it the gap to the opponent, within a few points', () => {
    const me = G(1600, 60, 0.06);
    const them = G(1650, 80, 0.06);
    const { win: w, loss } = stakesOneVsOne(me, them, 2, 10);
    const l = -loss;
    const e = l / (w + l);
    near(e, glicko2Expected(G(1600, glicko2RdAt(60, 2), 0.06), G(1650, glicko2RdAt(80, 10), 0.06)), 0.01, 'E from the stakes');
    // with the opponent's g near 1, the gap is −ln(1/E − 1) · scale
    const gap = -Math.log(1 / e - 1) * GLICKO2.scale;
    near(gap, -50, 6, 'gap read from the stakes');
  });
});

describe('M15-2: stakes in a pod (6.4)', () => {
  it('four new players: each place is P1 for the seat (+54, +30, −6, −78)', () => {
    expect(stakesPod(newPod(), 0, [0, 0, 0, 0])).toEqual([54, 30, -6, -78]);
    expect(stakesPod(newPod(), 3, [0, 0, 0, 0])).toEqual([54, 30, -6, -78]);
  });

  it('for place k the seat finishes k-th and the others take the other places in rating order (the higher μ ahead)', () => {
    const players = mixedPod();
    const days = [0, 30, 1, 2];
    const me = 1;
    // the others by μ: seat 0 (30), seat 3 (27), seat 2 (22)
    const orders: Place[][] = [[2, 1, 4, 3], [1, 2, 4, 3], [1, 3, 4, 2], [1, 4, 3, 2]];
    const want = orders.map((places) => displayRating(ratePod(players, places, days)[me]!) - displayRating(players[me]!));
    const got = stakesPod(players, me, days);
    expect(got).toEqual(want);
    for (let k = 1; k < got.length; k += 1) expect(got[k]!).toBeLessThanOrEqual(got[k - 1]!);
  });

  it('3-player pods; equal ratings keep seat order; a `me` that is not a seat index is refused', () => {
    expect(stakesPod(newPod(3), 1, [0, 0, 0])).toHaveLength(3);
    expect(stakesPod([W(25, 2), W(25, 2), W(25, 2), W(25, 2)], 2, [0, 0, 0, 0])).toEqual(stakesPod([W(25, 2), W(25, 2), W(25, 2), W(25, 2)], 0, [0, 0, 0, 0]));
    for (const bad of [-1, 4, 1.5, Number.NaN]) expect(() => stakesPod(newPod(), bad, [0, 0, 0, 0]), String(bad)).toThrow(RangeError);
    expect(() => stakesPod(newPod(), 0, [0, 0, 0])).toThrow(RangeError);
  });
});
