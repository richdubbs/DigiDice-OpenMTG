/**
 * M15-2: the pod rating, Weng-Lin Plackett-Luce (design 5, 17.3): the vectors P0-P10 of 5.5 (tolerance 0.000001), openskill's published examples as
 * 5.5 states them (its README uses τ = 0: the rank example against P0; the tie example against Weng-Lin's own A_q rule, test/m15-2/aq.ts, with
 * ratePod differing on purpose), ratePod equal to A_q on bottom ties and different on middle and top ties, the properties of 5.5, 3-player pods,
 * plackettLuceTerms term by term against the paper's formulas, finite limits for ratings far apart (M15-2 review), the shown values at 19.302 per
 * μ, and the shapes (against established players; from a cold start). Fixed inputs only; the cold start uses a fixed byte source.
 */
import { describe, expect, it } from 'vitest';
import {
  displayDeviation, displayRating, glicko2RdAt, plackettLuceTerms, ratePod, ratingNow, validPlaces, WENGLIN, wenglinSigmaAt, type Place,
  type RatingRowLike, type WengLinState,
} from '@openmtg/ladder/api';
import { fixedRandom } from '../support/random';
import { aqRatePod } from './aq';
import { daysBefore, daysBetween, median, mixedPod, near, nearAll, nearPod, newPod, uniform, W } from './helpers';

const NONE4 = [0, 0, 0, 0];
const TAU = 25 / 300;

/** The strict-order core applied as ratePod applies it, but with no growth at all (τ = 0, no time away): openskill's README setting. */
function rateStrictTau0(players: readonly WengLinState[], ranks: readonly number[]): WengLinState[] {
  return plackettLuceTerms(players, ranks).map((t, i) => {
    const p = players[i]!;
    return W(p.mu + t.omega, Math.sqrt(p.sigma * p.sigma * Math.max(1 - t.delta, WENGLIN.kappa)));
  });
}

/** 5.3's formulas for one strict order, written out directly (no shift of the exponentials), for the term-by-term check. */
function paperTerms(players: readonly WengLinState[], ranks: readonly number[]): { omega: number; delta: number }[] {
  const c = Math.sqrt(players.reduce((s, p) => s + p.sigma ** 2 + WENGLIN.beta ** 2, 0));
  const cq = (q: number) => players.reduce((s, p, j) => (ranks[j]! >= ranks[q]! ? s + Math.exp(p.mu / c) : s), 0);
  return players.map((p, i) => {
    let o = 0;
    let d = 0;
    players.forEach((_, q) => {
      if (ranks[q]! > ranks[i]!) return;
      const piq = Math.exp(p.mu / c) / cq(q);
      o += (q === i ? 1 : 0) - piq;
      d += piq * (1 - piq);
    });
    return { omega: (p.sigma ** 2 / c) * o, delta: (p.sigma / c) * (p.sigma ** 2 / c ** 2) * d };
  });
}

/** Every place pattern of n players that passes the ledger's shared-place rule (3 for 2 players, 13 for 3, 75 for 4). */
function placePatterns(n: number): Place[][] {
  const all: Place[][] = [[]];
  for (let k = 0; k < n; k += 1) all.splice(0, all.length, ...all.flatMap((xs) => [1, 2, 3, 4].slice(0, n).map((p) => [...xs, p as Place])));
  return all.filter((xs) => validPlaces(xs));
}

/** Printed to 3 decimals, as openskill's README prints. */
const print3 = (xs: readonly number[]) => xs.map((x) => x.toFixed(3));

describe('M15-2: Weng-Lin, the vectors of 5.5', () => {
  it("P0: four new players 1, 2, 3, 4 with τ = 0 (openskill's README setting)", () => {
    nearPod(rateStrictTau0(newPod(), [1, 2, 3, 4]), [27.795085, 26.552825, 24.689435, 20.962655], [8.263161, 8.179214, 8.083731, 8.083731], 'P0');
    // the A_q rule on a strict order is the paper's algorithm itself
    nearPod(aqRatePod(newPod(), [1, 2, 3, 4], 0), [27.795085, 26.552825, 24.689435, 20.962655], [8.263161, 8.179214, 8.083731, 8.083731], 'P0 (A_q)');
  });

  it('P1: four new players 1, 2, 3, 4', () => {
    nearPod(ratePod(newPod(), [1, 2, 3, 4], NONE4), [27.795253, 26.552918, 24.689416, 20.962413], [8.263572, 8.179618, 8.084128, 8.084128], 'P1');
  });

  it('P2: new, 1, 2, 3, 3 (a tie at the bottom)', () => {
    nearPod(ratePod(newPod(), [1, 2, 3, 3], NONE4), [27.795253, 26.552918, 22.825915, 22.825915], [8.263572, 8.179618, 8.084128, 8.084128], 'P2');
  });

  it('P3: new, 1, 1, 3, 4 (a tie at the top)', () => {
    nearPod(ratePod(newPod(), [1, 1, 3, 4], NONE4), [27.174085, 27.174085, 24.689416, 20.962413], [8.221702, 8.221702, 8.084128, 8.084128], 'P3');
  });

  it('P4: three new players 1, 2, 3', () => {
    nearPod(ratePod(newPod(3), [1, 2, 3], [0, 0, 0]), [27.869049, 25.717262, 21.413689], [8.205243, 8.058224, 8.058224], 'P4');
  });

  it('P5: mixed, 1, 2, 3, 3', () => {
    nearPod(ratePod(mixedPod(), [1, 2, 3, 3], NONE4), [30.460124, 25.833038, 21.891667, 23.328474], [2.997154, 4.944876, 1.999643, 7.360176], 'P5');
  });

  it('P6: mixed, 3, 1, 2, 4', () => {
    nearPod(ratePod(mixedPod(), [3, 1, 2, 4], NONE4), [29.782802, 26.478147, 22.179962, 21.885366], [2.98825, 4.976278, 2.000571, 7.368684], 'P6');
  });

  it('P7: mixed, 1, 2, 3, 4, the second player last rated 30 days before (drift 0.2916 per day)', () => {
    nearPod(ratePod(mixedPod(), [1, 2, 3, 4], [0, 30, 0, 0]), [30.450216, 26.095113, 22.041974, 21.053515], [2.997454, 5.71518, 1.999786, 7.408055], 'P7');
  });

  it('P8: new, 1, 1, 1, 4', () => {
    nearPod(ratePod(newPod(), [1, 1, 1, 4], NONE4), [26.345862, 26.345862, 26.345862, 20.962413], [8.176101, 8.176101, 8.176101, 8.084128], 'P8');
  });

  it('P9: new, 1, 2, 2, 4 (a tie in the middle)', () => {
    nearPod(ratePod(newPod(), [1, 2, 2, 4], NONE4), [27.795253, 25.621167, 25.621167, 20.962413], [8.263572, 8.132013, 8.132013, 8.084128], 'P9');
  });

  it('P10: a season reset, time away and a game together', () => {
    const end = '2026-11-14T12:00:00.000Z';
    const rows: RatingRowLike[] = [
      { state: W(30, 2), season: '2026-10', lastRatedAt: daysBefore(end, 40) },
      { state: W(25, 3), season: '2026-11', lastRatedAt: daysBefore(end, 0) },
      { state: W(22, 2.5), season: '2026-11', lastRatedAt: daysBefore(end, 1) },
      { state: W(27, 4), season: '2026-11', lastRatedAt: daysBefore(end, 2) },
    ];
    const now = rows.map((r) => ratingNow(r, end));
    const before = now.map((n) => n.state as WengLinState);
    // seat 1's before: reset, no time away; its σ at game time before τ
    near(before[0]!.mu, 29.75, 0.000001, "seat 1's before μ");
    near(before[0]!.sigma, 3.69631, 0.000001, "seat 1's before σ");
    near(wenglinSigmaAt(before[0]!.sigma, 40), 5.032565, 0.000001, "seat 1's σ at game time before τ");
    near(now[0]!.deviation, WENGLIN.displayScale * 5.032565, 0.00002, "ratingNow's shown deviation at game time");
    for (const i of [1, 2, 3]) expect(before[i]).toEqual(rows[i]!.state);
    const days = rows.map((r) => daysBetween(r.lastRatedAt!, end));
    const out = ratePod(before, [2, 1, 3, 4], days);
    nearPod(out, [30.250689, 25.621218, 22.12698, 25.206185], [4.926547, 2.996238, 2.550733, 4.009204], 'P10');
    expect(out.map(displayRating), 'P10 shown').toEqual([1601, 1512, 1445, 1504]);
  });
});

describe("M15-2: Weng-Lin, openskill's published examples and the A_q rule (5.4, 5.5)", () => {
  it("the README's rank example (four new players ranked 4, 1, 3, 2) equals P0 in that seat order at the printed precision; P1 would not", () => {
    const tau0 = rateStrictTau0(newPod(), [4, 1, 3, 2]);
    expect(print3(tau0.map((p) => p.mu))).toEqual(['20.963', '27.795', '24.689', '26.553']);
    expect(print3(tau0.map((p) => p.sigma))).toEqual(['8.084', '8.263', '8.084', '8.179']);
    const ours = ratePod(newPod(), [4, 1, 3, 2], NONE4);
    expect(print3(ours.map((p) => p.mu))).toEqual(['20.962', '27.795', '24.689', '26.553']);
    expect(print3(ours.map((p) => p.sigma))).toEqual(['8.084', '8.264', '8.084', '8.180']);
  });

  it("the README's tie example (scores 37, 19, 37, 42: places 2, 4, 2, 1, a tie in the middle) is the A_q rule with τ = 0; ratePod differs on purpose", () => {
    const aq = aqRatePod(newPod(), [2, 4, 2, 1], 0);
    nearPod(aq, [24.689435, 22.826045, 24.689435, 27.795085], [8.179214, 8.179214, 8.179214, 8.263161], 'A_q τ = 0');
    expect(print3(aq.map((p) => p.mu))).toEqual(['24.689', '22.826', '24.689', '27.795']);
    expect(print3(aq.map((p) => p.sigma))).toEqual(['8.179', '8.179', '8.179', '8.263']);
    // ratePod on the same places (τ = 25/300): P9 in another seat order
    nearPod(ratePod(newPod(), [2, 4, 2, 1], NONE4), [25.621167, 20.962413, 25.621167, 27.795253], [8.132013, 8.084128, 8.132013, 8.263572], 'ratePod');
  });

  it('the A_q rule for P3 gives 25.931751 to the first three; ratePod gives the drawers 27.174085 and the third player 24.689416', () => {
    const aq = aqRatePod(newPod(), [1, 1, 3, 4], TAU);
    nearAll(aq.slice(0, 3).map((p) => p.mu), [25.931751, 25.931751, 25.931751], 0.000001, 'A_q');
    const ours = ratePod(newPod(), [1, 1, 3, 4], NONE4);
    expect(ours[0]!.mu - aq[0]!.mu).toBeGreaterThan(1);
    expect(ours[2]!.mu - aq[2]!.mu).toBeLessThan(-1);
  });

  it('ratePod equals the A_q rule on a tie of two at the bottom (P2, P5) and on strict orders, and differs in the middle (P9) and at the top (P3, P8)', () => {
    const same = (a: readonly WengLinState[], b: readonly WengLinState[]) => a.every((p, i) => Math.abs(p.mu - b[i]!.mu) < 1e-9 && Math.abs(p.sigma - b[i]!.sigma) < 1e-9);
    for (const [players, places] of [[newPod(), [1, 2, 3, 3]], [mixedPod(), [1, 2, 3, 3]], [mixedPod(), [3, 3, 1, 2]], [newPod(), [1, 2, 3, 4]], [mixedPod(), [3, 1, 2, 4]], [newPod(3), [1, 2, 2]]] as const) {
      expect(same(ratePod(players, places as readonly Place[], players.map(() => 0)), aqRatePod(players, places, TAU)), `${places.join(',')}`).toBe(true);
    }
    for (const [players, places] of [[newPod(), [1, 2, 2, 4]], [newPod(), [1, 1, 3, 4]], [newPod(), [1, 1, 1, 4]], [mixedPod(), [1, 1, 3, 4]], [newPod(3), [1, 1, 3]]] as const) {
      expect(same(ratePod(players, places as readonly Place[], players.map(() => 0)), aqRatePod(players, places, TAU)), `${places.join(',')}`).toBe(false);
    }
    // Three tied at the bottom (1, 2, 2, 2) is not a P2 case: for new players the μ agree, but averaging also learns from the orders inside the
    // tie, so its σ shrinks more (8.116083 against the A_q rule's 8.179618).
    const three = ratePod(newPod(), [1, 2, 2, 2], NONE4);
    const threeAq = aqRatePod(newPod(), [1, 2, 2, 2], TAU);
    nearAll(three.map((p) => p.mu), threeAq.map((p) => p.mu), 1e-9, 'μ, three tied at the bottom');
    nearPod(three, [27.795253, 24.068249, 24.068249, 24.068249], [8.263572, 8.116083, 8.116083, 8.116083], 'ratePod 1, 2, 2, 2');
    nearAll(threeAq.slice(1).map((p) => p.sigma), [8.179618, 8.179618, 8.179618], 0.000001, 'A_q σ, three tied at the bottom');
    // 5.4's middle example: A_q gives the pair a third place's value (24.6894) and the last player 22.8259; averaging 25.6212 and 20.9624
    const aqMiddle = aqRatePod(newPod(), [1, 2, 2, 4], TAU);
    nearAll(aqMiddle.slice(1).map((p) => p.mu), [24.689416, 24.689416, 22.825915], 0.000001, 'A_q middle tie');
  });
});

describe('M15-2: Weng-Lin, the strict-order core and the scale', () => {
  it("plackettLuceTerms on strict orders equals the paper's formulas term by term (only the order of the ranks matters)", () => {
    const cases: [WengLinState[], number[]][] = [
      [newPod(), [1, 2, 3, 4]], [mixedPod(), [3, 1, 2, 4]], [mixedPod(), [4, 3, 2, 1]], [newPod(3), [2, 3, 1]],
      [[W(30, 3), W(22, 2), W(27, 8)], [1, 3, 2]], [[W(25, 25 / 3), W(31, 1.6)], [2, 1]], [[W(40, 1.6), W(10, 5), W(25, 2), W(25, 8)], [4, 1, 2, 3]],
    ];
    for (const [players, ranks] of cases) {
      const ours = plackettLuceTerms(players, ranks);
      const paper = paperTerms(players, ranks);
      ours.forEach((t, i) => {
        near(t.omega, paper[i]!.omega, 1e-12, `Ω ${ranks.join(',')} [${i}]`);
        near(t.delta, paper[i]!.delta, 1e-12, `Δ ${ranks.join(',')} [${i}]`);
      });
      expect(plackettLuceTerms(players, ranks.map((r) => 10 * r + 7))).toEqual(ours);
    }
  });

  it('ratePod on a strict order is the core after the growth: σ² + time away (capped at σ0²) + τ², then the mean over the one order', () => {
    const players = mixedPod();
    const days = [3, 0, 120, 1];
    const grown = players.map((p, i) => W(p.mu, Math.sqrt(Math.min(WENGLIN.sigma0 ** 2, p.sigma ** 2 + WENGLIN.driftPerDay * days[i]!) + TAU ** 2)));
    const terms = plackettLuceTerms(grown, [2, 4, 1, 3]);
    const out = ratePod(players, [2, 4, 1, 3], days);
    out.forEach((p, i) => {
      near(p.mu, grown[i]!.mu + terms[i]!.omega, 1e-12, `μ[${i}]`);
      near(p.sigma, Math.sqrt(grown[i]!.sigma ** 2 * Math.max(1 - terms[i]!.delta, WENGLIN.kappa)), 1e-12, `σ[${i}]`);
    });
  });

  it('shown values at 19.302 per μ: P1 as 1554, 1530, 1494, 1422; a new pod player shows 1500 and a deviation of about 161', () => {
    expect(ratePod(newPod(), [1, 2, 3, 4], NONE4).map(displayRating)).toEqual([1554, 1530, 1494, 1422]);
    expect(displayRating(W(25, 25 / 3))).toBe(1500);
    near(displayDeviation(W(25, 25 / 3)), 160.85, 0.01, 'σ0 shown');
    near(displayDeviation(W(25, 1.6)), 30.88, 0.01, 'σ 1.6 shown');
  });

  it('time away: wenglinSigmaAt grows σ² by 0.2916 a day, capped at σ0, the same growth in shown points as 1v1', () => {
    near(wenglinSigmaAt(2, 10), Math.sqrt(4 + 2.916), 1e-12, '10 days');
    expect(wenglinSigmaAt(8, 1000)).toBe(WENGLIN.sigma0);
    expect(wenglinSigmaAt(3, -4)).toBe(3);
    expect(wenglinSigmaAt(3, 0)).toBe(3);
    for (const [sigma, days] of [[1.6, 30], [2, 5], [3.5, 60]] as const) {
      near(WENGLIN.displayScale * wenglinSigmaAt(sigma, days), glicko2RdAt(WENGLIN.displayScale * sigma, days), 1e-9, `σ ${sigma}, ${days} days`);
    }
    // an active pod player at σ 1.6 reaches 120 shown points after about 124 days (6.2)
    expect(WENGLIN.displayScale * wenglinSigmaAt(1.6, 123.7)).toBeLessThan(120);
    expect(WENGLIN.displayScale * wenglinSigmaAt(1.6, 123.8)).toBeGreaterThan(120);
  });
});

describe('M15-2: Weng-Lin, the properties of 5.5', () => {
  const SETS: WengLinState[][] = [
    newPod(), mixedPod(), [W(40, 1.6), W(10, 5), W(25, 2), W(25, 8)], [W(25, 1.6), W(25, 1.6), W(25, 1.6), W(25, 1.6)],
    [W(26, 1.7), W(24, 3), W(25, 25 / 3), W(28, 2.2)], newPod(3), [W(30, 3), W(22, 2), W(27, 8)], [W(35, 1.6), W(15, 1.6), W(25, 6)],
    // far apart (7,000 μ, about 135,000 shown points): a tail of exponentials that underflows next to the top's
    [W(7025, 1), W(25, 1), W(25, 1), W(25, 1)], [W(25, 1), W(25, 1), W(25, 1), W(-6975, 1)],
  ];
  const DAYS = (n: number): number[][] => [Array(n).fill(0), [0, 30, 1, 200].slice(0, n)];
  const cases = SETS.flatMap((players) => placePatterns(players.length).flatMap((places) => DAYS(players.length).map((days) => ({ players, places, days }))));
  const label = (c: (typeof cases)[number]) => `${c.players.map((p) => `${p.mu}/${p.sigma}`).join(' ')} @ ${c.places.join(',')} +${c.days.join(',')}`;
  const failing = (ok: (c: (typeof cases)[number], out: WengLinState[]) => boolean) => cases.filter((c) => !ok(c, ratePod(c.players, c.places, c.days))).map(label);

  it('the place patterns of 3 and 4 players are the 13 and 75 weak orders', () => {
    expect([placePatterns(2).length, placePatterns(3).length, placePatterns(4).length]).toEqual([3, 13, 75]);
  });

  it("a sole winner's μ never falls and a sole last player's never rises", () => {
    expect(failing((c, out) => c.places.every((p, i) => {
      const alone = c.places.filter((q) => q === p).length === 1;
      if (alone && p === 1) return out[i]!.mu >= c.players[i]!.mu;
      if (alone && p === Math.max(...c.places)) return out[i]!.mu <= c.players[i]!.mu;
      return true;
    }))).toEqual([]);
  });

  it('players tied with equal ratings and equal time away get equal results', () => {
    expect(failing((c, out) => c.places.every((p, i) => c.places.every((q, j) => {
      const twins = p === q && c.players[i]!.mu === c.players[j]!.mu && c.players[i]!.sigma === c.players[j]!.sigma && c.days[i] === c.days[j];
      return !twins || (Math.abs(out[i]!.mu - out[j]!.mu) < 1e-12 && Math.abs(out[i]!.sigma - out[j]!.sigma) < 1e-12);
    })))).toEqual([]);
  });

  it("σ' never exceeds σ after the prior growth (time away capped at σ0, then τ)", () => {
    expect(failing((c, out) => out.every((p, i) => {
      const s = c.players[i]!.sigma;
      return p.sigma <= Math.sqrt(Math.min(WENGLIN.sigma0 ** 2, s * s + WENGLIN.driftPerDay * c.days[i]!) + TAU ** 2);
    }))).toEqual([]);
  });

  it('renaming seats permutes the results', () => {
    const perms = [[1, 0, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]];
    expect(failing((c, out) => perms.every((perm) => {
      const order = perm.filter((k) => k < c.players.length);
      const again = ratePod(order.map((k) => c.players[k]!), order.map((k) => c.places[k]!), order.map((k) => c.days[k]!));
      return order.every((k, at) => Math.abs(again[at]!.mu - out[k]!.mu) < 1e-12 && Math.abs(again[at]!.sigma - out[k]!.sigma) < 1e-12);
    }))).toEqual([]);
  });

  it('every output is finite, a Weng-Lin state, with σ above 0', () => {
    expect(failing((_, out) => out.every((p) => p.model === 'wenglin' && Number.isFinite(p.mu) && Number.isFinite(p.sigma) && p.sigma > 0))).toEqual([]);
  });

  it('ratings far apart give the limit, not 0 / 0: a player far above or below the rest changes nothing for them, and learns nothing itself', () => {
    const strict: Place[] = [1, 2, 3, 4];
    // a top player 1,000 μ up already has a share of exp(−1000 / c) ≈ 1e-51 of the tail below it; further up, the result must stay the same
    const nearTop = ratePod([W(1025, 1), W(25, 1), W(25, 1), W(25, 1)], strict, NONE4);
    for (const gap of [7000, 1e6]) {
      const out = ratePod([W(25 + gap, 1), W(25, 1), W(25, 1), W(25, 1)], strict, NONE4);
      expect(out[0]!.mu, `top +${gap}: μ`).toBe(25 + gap);
      near(out[0]!.sigma, Math.sqrt(1 + TAU ** 2), 1e-12, `top +${gap}: σ`);
      nearAll(out.slice(1).map((p) => p.mu), nearTop.slice(1).map((p) => p.mu), 1e-12, `top +${gap}: the others' μ`);
      nearAll(out.slice(1).map((p) => p.sigma), nearTop.slice(1).map((p) => p.sigma), 1e-12, `top +${gap}: the others' σ`);
    }
    const nearBottom = ratePod([W(25, 1), W(25, 1), W(25, 1), W(-975, 1)], strict, NONE4);
    for (const gap of [7000, 1e6]) {
      const out = ratePod([W(25, 1), W(25, 1), W(25, 1), W(25 - gap, 1)], strict, NONE4);
      expect(out[3]!.mu, `bottom −${gap}: μ`).toBe(25 - gap);
      near(out[3]!.sigma, Math.sqrt(1 + TAU ** 2), 1e-12, `bottom −${gap}: σ`);
      nearAll(out.slice(0, 3).map((p) => p.mu), nearBottom.slice(0, 3).map((p) => p.mu), 1e-12, `bottom −${gap}: the others' μ`);
      nearAll(out.slice(0, 3).map((p) => p.sigma), nearBottom.slice(0, 3).map((p) => p.sigma), 1e-12, `bottom −${gap}: the others' σ`);
    }
    // the core itself, every strict order of four players spread over 2·10^6 μ: finite terms
    const spread = [W(1e6, 1), W(7025, 2), W(25, 25 / 3), W(-1e6, 1.6)];
    const orders = [[1, 2, 3, 4], [4, 3, 2, 1], [2, 4, 1, 3], [3, 1, 4, 2]];
    for (const ranks of orders) {
      for (const t of plackettLuceTerms(spread, ranks)) expect([t.omega, t.delta].every(Number.isFinite), ranks.join(',')).toBe(true);
    }
    // a σ whose square is not a finite number cannot be rated: refused, as every other input that is not finite
    expect(() => plackettLuceTerms([W(25, 1e200), W(25, 1)], [1, 2])).toThrow(RangeError);
  });

  it('refuses malformed input with a RangeError', () => {
    expect(() => ratePod(newPod(), [1, 2, 2, 3], NONE4)).toThrow(RangeError);
    expect(() => ratePod(newPod(), [1, 2, 3], NONE4)).toThrow(RangeError);
    expect(() => ratePod(newPod(), [1, 2, 3, 4], [0, 0, 0])).toThrow(RangeError);
    expect(() => ratePod([W(25, 0), W(25, 1), W(25, 1)], [1, 2, 3], [0, 0, 0])).toThrow(RangeError);
    expect(() => ratePod([W(Number.NaN, 1), W(25, 1), W(25, 1)], [1, 2, 3], [0, 0, 0])).toThrow(RangeError);
    expect(() => ratePod(newPod(3), [1, 2, 3], [0, Number.NaN, 0])).toThrow(RangeError);
    expect(() => plackettLuceTerms(newPod(), [1, 1, 3, 4])).toThrow(RangeError);
    expect(() => plackettLuceTerms([W(25, 1)], [1])).toThrow(RangeError);
    expect(() => wenglinSigmaAt(Number.NaN, 1)).toThrow(RangeError);
  });
});

describe('M15-2: Weng-Lin, shapes (5.5, 6.2)', () => {
  it('a new player against three established (25, 2) players, finishing 2nd, 3rd, 1st, 4th in turn: shown deviation about 96 after 10 games, 83 after 16', () => {
    let me = W(25, 25 / 3);
    const shown: number[] = [];
    for (let game = 0; game < 16; game += 1) {
      const place = ([2, 3, 1, 4] as const)[game % 4]!;
      const others = ([1, 2, 3, 4] as const).filter((p) => p !== place);
      me = ratePod([me, W(25, 2), W(25, 2), W(25, 2)], [place, ...others], [game === 0 ? 0 : 1 / 24, 0, 0, 0])[0]!;
      shown.push(displayDeviation(me));
    }
    near(shown[9]!, 96, 0.5, 'after 10 games');
    near(shown[15]!, 83.6, 0.5, 'after 16 games');
    expect(shown[9]!, 'under the provisional limit of 120 after placement').toBeLessThan(120);
  });

  it('from a cold start (2,000 new players in pods of 4 by rating, Plackett-Luce outcomes): about 131 after 10 pods, under 120 after about 15', () => {
    const u = uniform(fixedRandom('m15-2 pod cold start'));
    const n = 2000;
    const skill = Array.from({ length: n }, () => WENGLIN.mu0 + (200 / WENGLIN.displayScale) * Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()));
    let players = skill.map(() => W(25, 25 / 3));
    const medians: number[] = [];
    for (let pod = 0; pod < 16; pod += 1) {
      const order = players.map((_, i) => i).sort((a, b) => players[a]!.mu - players[b]!.mu || a - b);
      const next = [...players];
      for (let k = 0; k < n; k += 4) {
        const seats = order.slice(k, k + 4);
        // Plackett-Luce at c_ref by the Gumbel-max rule: the order of skill / 9 plus Gumbel noise
        const perf = seats.map((i) => skill[i]! / WENGLIN.cRef - Math.log(-Math.log(1 - u())));
        const places = perf.map((x) => (1 + perf.filter((y) => y > x).length) as Place);
        const out = ratePod(seats.map((i) => players[i]!), places, seats.map(() => (pod === 0 ? 0 : 1 / 24)));
        seats.forEach((i, at) => { next[i] = out[at]!; });
      }
      players = next;
      medians.push(median(players.map(displayDeviation)));
    }
    near(medians[9]!, 131, 2, 'median shown deviation after 10 pods');
    expect(medians[9]!).toBeGreaterThan(120);
    expect(medians.findIndex((d) => d < 120) + 1, 'the pod after which the median is under 120').toBeGreaterThanOrEqual(14);
    expect(medians.findIndex((d) => d < 120) + 1).toBeLessThanOrEqual(16);
  });
});
