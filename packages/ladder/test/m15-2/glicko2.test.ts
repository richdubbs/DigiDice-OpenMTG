/**
 * M15-2: the 1v1 rating, Glicko-2 (design 4, 17.2): the vectors G1-G10b of 4.5 (0.0001 on r and RD, 0.000001 on σ unless a row says otherwise),
 * the properties listed under them, the frozen-volatility facts of 4.4, time away added once, the Illinois loop's step limit (and a step 5 that
 * keeps the old σ, reported to rateOneVsOne's optional hook for 4.1's log; M15-2 review), and glicko2RdAt
 * (monotone in days, capped, independent of the player's σ). Fixed inputs only; the population checks of G9 use a fixed byte source.
 */
import { describe, expect, it } from 'vitest';
import {
  displayRating, GLICKO2, glicko2Expected, glicko2Period, glicko2RdAt, rateOneVsOne, ratingNow, stakesOneVsOne, type Glicko2Opponent,
  type Glicko2State, type RatingRowLike,
} from '@openmtg/ladder/api';
import { glicko2Volatility } from '../../src/api/glicko2';
import { fixedRandom } from '../support/random';
import { DAY_MS, daysBefore, daysBetween, G, median, near, nearAll, nearGlicko, uniform } from './helpers';

const PAPER_GAMES: Glicko2Opponent[] = [{ r: 1400, rd: 30, score: 1 }, { r: 1550, rd: 100, score: 0 }, { r: 1700, rd: 300, score: 0 }];
const NEW = G(1500, 350, 0.06);

/** The state rateOneVsOne would store for A, by hand from 4.3: RD at game time, one period with the ladder's τ and cap, RD clamped. */
function byHand(a: Glicko2State, b: Glicko2State, scoreA: 0 | 0.5 | 1, daysA: number, daysB: number): Glicko2State {
  const x = glicko2Period(G(a.r, glicko2RdAt(a.rd, daysA), a.vol), [{ r: b.r, rd: glicko2RdAt(b.rd, daysB), score: scoreA }], { tau: 0.5, volMax: 0.1 });
  return G(x.r, Math.min(350, Math.max(50, x.rd)), x.vol);
}

describe('M15-2: Glicko-2, the vectors of 4.5', () => {
  it("G1: the paper's example, one period of three games (volMax off)", () => {
    const p = G(1500, 200, 0.06);
    const x = glicko2Period(p, PAPER_GAMES, { tau: 0.5, volMax: Infinity });
    nearGlicko(x, 1464.0507, 151.5165, 0.059996, 'G1');
    // within 0.01 of the paper's printed values (it rounds μ' to −0.2069 before converting)
    near(x.r, 1464.06, 0.01, 'paper r');
    near(x.rd, 151.52, 0.01, 'paper RD');
    near(x.vol, 0.05999, 0.00001, 'paper σ');
    // intermediates: E per game, v, Δ, and the Illinois loop's steps
    nearAll(PAPER_GAMES.map((o) => glicko2Expected(p, G(o.r, o.rd, 0.06))), [0.639468, 0.431842, 0.302841], 0.000001, 'E');
    near(x.v, 1.778977, 0.000001, 'v');
    near(x.delta, -0.483933, 0.000001, 'Δ');
    expect(x.iterations).toBe(2);
    expect(x.volRaw).toBe(x.vol);
  });

  it('G1b: the same three games as three one-game periods in order (bounds on, no time between them)', () => {
    const want: [number, number, number][] = [[1563.5642, 175.4027, 0.059999], [1492.2587, 158.3026, 0.059998], [1463.7884, 151.8732, 0.059998]];
    let p = G(1500, 200, 0.06);
    PAPER_GAMES.forEach((o, i) => {
      p = rateOneVsOne(p, G(o.r, o.rd, 0.06), o.score, 0, 0)[0];
      const [r, rd, vol] = want[i]!;
      nearGlicko(p, r, rd, vol, `game ${i + 1}`);
    });
    // close to the batch of G1, and the order matters only slightly (4.4)
    near(p.r, 1464.0507, 0.5, 'per-game vs batch r');
    near(p.rd, 151.5165, 0.5, 'per-game vs batch RD');
  });

  it('G2: two new players, first game each; A wins', () => {
    const [a, b] = rateOneVsOne(NEW, NEW, 1, 0, 0);
    nearGlicko(a, 1662.3109, 290.319, 0.06, 'A');
    nearGlicko(b, 1337.6891, 290.319, 0.06, 'B');
  });

  it('G3: two new players; a draw', () => {
    const [a, b] = rateOneVsOne(NEW, NEW, 0.5, 0, 0);
    nearGlicko(a, 1500, 290.319, 0.059999, 'A');
    nearGlicko(b, 1500, 290.319, 0.059999, 'B');
  });

  it('G4: A 1600/60 (2 days away) beats B 1650/80 (10 days away), same season', () => {
    near(glicko2RdAt(60, 2), 61.7841, 0.0001, 'A RD at game time');
    near(glicko2RdAt(80, 10), 86.524, 0.0001, 'B RD at game time');
    near(glicko2Expected(G(1600, glicko2RdAt(60, 2), 0.06), G(1650, glicko2RdAt(80, 10), 0.06)), 0.431055, 0.000001, 'E_A');
    const [a, b] = rateOneVsOne(G(1600, 60, 0.06), G(1650, 80, 0.06), 1, 2, 10);
    nearGlicko(a, 1612.0416, 61.7479, 0.060001, 'A');
    nearGlicko(b, 1626.9102, 84.6712, 0.060001, 'B');
  });

  it('G5: G4, but A loses', () => {
    const [a, b] = rateOneVsOne(G(1600, 60, 0.06), G(1650, 80, 0.06), 0, 2, 10);
    nearGlicko(a, 1590.8768, 61.7479, 0.059999, 'A');
    nearGlicko(b, 1667.4083, 84.6712, 0.059999, 'B');
  });

  it('G6: the RD floor: 1500/50/0.04 beats 1500/50/0.04, no time between', () => {
    const raw = glicko2Period(G(1500, 50, 0.04), [{ r: 1500, rd: 50, score: 1 }], { tau: 0.5, volMax: 0.1 });
    near(raw.rd, 49.9687, 0.0001, 'RD before the clamp');
    const [a, b] = rateOneVsOne(G(1500, 50, 0.04), G(1500, 50, 0.04), 1, 0, 0);
    expect(a.rd).toBe(50);
    expect(b.rd).toBe(50);
    near(a.r, 1507.0978, 0.0001, 'A r');
    near(b.r, 1492.9022, 0.0001, 'B r');
  });

  it('G7: the volatility cap: 1500/50/0.1 beats 2300/50/0.06', () => {
    const raw = glicko2Period(G(1500, 50, 0.1), [{ r: 2300, rd: 50, score: 1 }], { tau: 0.5, volMax: 0.1 });
    near(raw.volRaw, 0.100059, 0.000001, "σ' before the cap");
    expect(raw.vol).toBe(0.1);
    const [a, b] = rateOneVsOne(G(1500, 50, 0.1), G(2300, 50, 0.06), 1, 0, 0);
    nearGlicko(a, 1515.7474, 52.907, 0.1, 'A');
    expect(a.vol).toBe(0.1);
    nearGlicko(b, 2285.3369, 51.053, 0.060013, 'B');
  });

  it("G8: time away, glicko2RdAt(50, days): idleVolPerDay 0.06, the player's own σ plays no part", () => {
    near(glicko2RdAt(50, 30), 75.8895, 0.0001, '30 days');
    near(glicko2RdAt(50, 365), 205.3137, 0.0001, '365 days');
    expect(glicko2RdAt(50, 2000)).toBe(350);
  });

  it('G9 (shape): a new player alternating win and loss against established 1500/60 opponents, one game an hour', () => {
    const want = [248.8, 211.1, 181.5, 162.7, 148.0, 137.1, 128.2, 121.0, 114.9, 109.7];
    let p = NEW;
    const rds: number[] = [];
    for (let game = 0; game < 200; game += 1) {
      p = rateOneVsOne(p, G(1500, 60, 0.06), game % 2 === 0 ? 1 : 0, game === 0 ? 0 : 1 / 24, 0)[0];
      rds.push(p.rd);
    }
    nearAll(rds.slice(0, 10), want, 0.05, 'RD after games 1-10');
    expect(rds[9]!, 'placement ends below the provisional limit of 120').toBeLessThan(120);
    near(rds[199]!, 60.9, 0.05, 'RD after 200 games');
  });

  it('G9 (shape): from a cold start, 2,000 new players paired by rating, every opponent new too', () => {
    // A fixed population: skills spread around 1500 (sd about 200), outcomes by the logistic of the skill gap, pairs of neighbours by rating each round.
    const u = uniform(fixedRandom('m15-2 G9 cold start'));
    const n = 2000;
    const skill = Array.from({ length: n }, () => 1500 + 200 * Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()));
    let players = skill.map(() => NEW);
    const medians: number[] = [];
    for (let game = 0; game < 11; game += 1) {
      const order = players.map((_, i) => i).sort((a, b) => players[a]!.r - players[b]!.r || a - b);
      const next = [...players];
      for (let k = 0; k < n; k += 2) {
        const i = order[k]!;
        const j = order[k + 1]!;
        const aWins = u() < 1 / (1 + 10 ** ((skill[j]! - skill[i]!) / 400));
        const days = game === 0 ? 0 : 1 / 24;
        [next[i], next[j]] = rateOneVsOne(players[i]!, players[j]!, aWins ? 1 : 0, days, days);
      }
      players = next;
      medians.push(median(players.map((p) => p.rd)));
    }
    nearAll(medians.slice(0, 10), [290.3, 247.5, 216.0, 192.4, 174.2, 159.7, 148.1, 138.4, 130.4, 123.5], 0.3, 'median RD after games 1-10');
    expect(medians[9]!, 'still above 120 after the 10th (6.2)').toBeGreaterThan(120);
    expect(medians[10]!, 'under 120 after the 11th (6.2)').toBeLessThan(120);
  });

  it('G10: a season reset, time away and a game together', () => {
    const end = '2026-11-14T12:00:00.000Z';
    const rowA: RatingRowLike = { state: G(1700, 70, 0.06), season: '2026-10', lastRatedAt: daysBefore(end, 40) };
    const rowB: RatingRowLike = { state: G(1600, 80, 0.06), season: '2026-11', lastRatedAt: daysBefore(end, 1) };
    const nowA = ratingNow(rowA, end);
    const nowB = ratingNow(rowB, end);
    const a = nowA.state as Glicko2State;
    const b = nowB.state as Glicko2State;
    // `before`: the reset applied, no time away
    nearGlicko(a, 1690, 92.1954, 0.06, "A's before");
    expect(nowA.season).toBe('2026-11');
    expect(b).toEqual(rowB.state);
    expect(nowB.season).toBe('2026-11');
    // RD at game time: ratingNow's deviation, the same as rateOneVsOne's own time away
    near(nowA.deviation, 113.3385, 0.0001, 'A RD at game time');
    near(nowB.deviation, 80.6761, 0.0001, 'B RD at game time');
    near(glicko2RdAt(a.rd, 40), nowA.deviation, 1e-9, 'A deviation is glicko2RdAt of the state');
    near(glicko2Expected(G(a.r, nowA.deviation, a.vol), G(b.r, nowB.deviation, b.vol)), 0.622904, 0.000001, 'E_A');
    const [aLoses, bWins] = rateOneVsOne(a, b, 0, daysBetween(rowA.lastRatedAt!, end), daysBetween(rowB.lastRatedAt!, end));
    nearGlicko(aLoses, 1648.8913, 108.786, 0.060001, 'A loses');
    nearGlicko(bWins, 1621.2341, 79.5468, 0.060002, 'B wins');
    const [aWins, bLoses] = rateOneVsOne(a, b, 1, 40, 1);
    nearGlicko(aWins, 1714.8866, 108.786, 0.059999, 'A wins');
    nearGlicko(bLoses, 1586.9589, 79.5468, 0.059999, 'B loses');
    // ratingNow(...).state never includes time away: adding it twice would give A an RD at game time of 131.1
    near(glicko2RdAt(nowA.deviation, 40), 131.1, 0.05, 'time away counted twice');
  });

  it('G10b: a game across midnight; then the same game with A deleted while it ran (8.7)', () => {
    const startedAt = '2026-10-31T23:40:00.000Z';
    const endedAt = '2026-11-01T00:20:00.000Z';
    const rowA: RatingRowLike = { state: G(1700, 70, 0.06), season: '2026-09', lastRatedAt: daysBefore(endedAt, 40) };
    const rowB: RatingRowLike = { state: G(1600, 80, 0.06), season: '2026-10', lastRatedAt: daysBefore(endedAt, 1) };
    const nowA = ratingNow(rowA, endedAt);
    const nowB = ratingNow(rowB, endedAt);
    // both reset once (A two seasons behind, once all the same), the game counts for the month it ended in
    nearGlicko(nowA.state as Glicko2State, 1690, 92.1954, 0.06, "A's before");
    nearGlicko(nowB.state as Glicko2State, 1595, 100, 0.06, "B's before");
    expect([nowA.season, nowB.season]).toEqual(['2026-11', '2026-11']);
    near(nowA.deviation, 113.3385, 0.0001, 'A RD at game time');
    near(nowB.deviation, 100.5417, 0.0001, 'B RD at game time');
    const daysA = daysBetween(rowA.lastRatedAt!, endedAt);
    const daysB = daysBetween(rowB.lastRatedAt!, endedAt);
    const [a, b] = rateOneVsOne(nowA.state as Glicko2State, nowB.state as Glicko2State, 0, daysA, daysB);
    nearGlicko(a, 1649.1505, 108.9629, 0.060001, 'A');
    nearGlicko(b, 1627.3667, 97.7094, 0.060001, 'B');
    const bBefore = nowB.state as Glicko2State;
    near(b.r - bBefore.r, 32.37, 0.005, "B's rated change");
    expect(displayRating(b) - displayRating(bBefore), "B's shown change").toBe(32);

    // The stakes sent at the start (season 2026-10, before B's reset): B +21.23 for a win, shown as +21.
    const startA = ratingNow(rowA, startedAt);
    const startB = ratingNow(rowB, startedAt);
    expect(startB.season).toBe('2026-10');
    expect(startB.state).toEqual(rowB.state);
    const startDaysA = daysBetween(rowA.lastRatedAt!, startedAt);
    const startDaysB = daysBetween(rowB.lastRatedAt!, startedAt);
    const preview = rateOneVsOne(startB.state as Glicko2State, startA.state as Glicko2State, 1, startDaysB, startDaysA)[0];
    near(preview.r - (startB.state as Glicko2State).r, 21.23, 0.005, "B's previewed win");
    expect(stakesOneVsOne(startB.state as Glicko2State, startA.state as Glicko2State, startDaysB, startDaysA).win).toBe(21);

    // A deleted while the game ran: its start snapshot is its stored row as it was (not reset), read like a live row; B's result is identical.
    const snapshotA: RatingRowLike = structuredClone(rowA);
    const fromSnapshot = ratingNow(snapshotA, endedAt);
    expect(fromSnapshot).toEqual(nowA);
    const [, bAgainstDeleted] = rateOneVsOne(fromSnapshot.state as Glicko2State, nowB.state as Glicko2State, 0, daysA, daysB);
    expect(bAgainstDeleted).toEqual(b);
  });
});

describe('M15-2: Glicko-2, the properties of 4.5', () => {
  // A fixed grid: ratings far apart and close, new and settled deviations, low and capped volatilities, with and without time away.
  const STATES: { s: Glicko2State; days: number }[] = [];
  for (const r of [1100, 1500, 1520, 2300]) {
    for (const rd of [50, 120, 350]) for (const vol of [0.04, 0.1]) for (const days of [0, 45]) STATES.push({ s: G(r, rd, vol), days });
  }
  const SCORES = [0, 0.5, 1] as const;
  const pairs = STATES.flatMap((a) => STATES.map((b) => [a, b] as const));

  /** The cases in which `ok` fails, by name; one assertion per property, so a failure lists every case at once. */
  function failing<T>(cases: readonly T[], name: (c: T) => string, ok: (c: T) => boolean): string[] {
    return cases.filter((c) => !ok(c)).map(name);
  }
  const label = ([a, b]: readonly [{ s: Glicko2State; days: number }, { s: Glicko2State; days: number }]) =>
    `${a.s.r}/${a.s.rd}/${a.s.vol} +${a.days}d vs ${b.s.r}/${b.s.rd}/${b.s.vol} +${b.days}d`;

  it('a win never lowers r and a loss never raises it, for both players', () => {
    expect(failing(pairs, label, ([a, b]) => {
      const [aWins, bLoses] = rateOneVsOne(a.s, b.s, 1, a.days, b.days);
      const [aLoses, bWins] = rateOneVsOne(a.s, b.s, 0, a.days, b.days);
      return aWins.r >= a.s.r && bWins.r >= b.s.r && aLoses.r <= a.s.r && bLoses.r <= b.s.r;
    })).toEqual([]);
  });

  it("RD after a game is never above step 6's φ* (scale · sqrt(φ_at² + σ'²)), though it can end above RD at game time (G7)", () => {
    expect(failing(pairs, label, ([a, b]) => SCORES.every((score) => {
      const [x] = rateOneVsOne(a.s, b.s, score, a.days, b.days);
      const phiAt = glicko2RdAt(a.s.rd, a.days) / GLICKO2.scale;
      const phiStar = GLICKO2.scale * Math.sqrt(phiAt * phiAt + x.vol * x.vol);
      return x.rd <= Math.max(GLICKO2.rdMin, phiStar) + 1e-9;
    }))).toEqual([]);
    const [g7] = rateOneVsOne(G(1500, 50, 0.1), G(2300, 50, 0.06), 1, 0, 0);
    expect(g7.rd).toBeGreaterThan(50);
  });

  it('swapping A and B swaps the results', () => {
    expect(failing(pairs, label, ([a, b]) => SCORES.every((score) => {
      const [x, y] = rateOneVsOne(a.s, b.s, score, a.days, b.days);
      const [y2, x2] = rateOneVsOne(b.s, a.s, (1 - score) as 0 | 0.5 | 1, b.days, a.days);
      return JSON.stringify([x2, y2]) === JSON.stringify([x, y]);
    }))).toEqual([]);
  });

  it("σ' stays above 0 and at most 0.1, RD within [50, 350], every output finite, and step 5 converges in a few steps", () => {
    expect(failing(pairs, label, ([a, b]) => SCORES.every((score) => {
      const out = rateOneVsOne(a.s, b.s, score, a.days, b.days);
      const one = glicko2Period(G(a.s.r, glicko2RdAt(a.s.rd, a.days), a.s.vol), [{ r: b.s.r, rd: glicko2RdAt(b.s.rd, b.days), score }], { volMax: 0.1 });
      return one.iterations <= 10 && out.every((x) => x.model === 'glicko2' && [x.r, x.rd, x.vol].every(Number.isFinite)
        && x.vol > 0 && x.vol <= 0.1 && x.rd >= 50 && x.rd <= 350);
    }))).toEqual([]);
  });

  it('rateOneVsOne is 4.3 exactly: each player one period against the other\'s values from before the game, then the bounds', () => {
    for (const [a, b] of pairs.filter((_, i) => i % 7 === 0)) {
      for (const score of SCORES) {
        const [x, y] = rateOneVsOne(a.s, b.s, score, a.days, b.days);
        expect(x).toEqual(byHand(a.s, b.s, score, a.days, b.days));
        expect(y).toEqual(byHand(b.s, a.s, (1 - score) as 0 | 0.5 | 1, b.days, a.days));
      }
    }
  });
});

describe('M15-2: Glicko-2, volatility is frozen with one game per period (4.4)', () => {
  it('2,000 fair games leave σ within 0.001 of σ0 at every game', () => {
    // A player against opponents at its own rating (RD 60), the results from a fixed byte source, one game an hour.
    const bytes = fixedRandom('m15-2 fair games');
    let p = G(1500, 60, 0.06);
    for (let game = 0; game < 2000; game += 1) {
      p = rateOneVsOne(p, G(p.r, 60, 0.06), (bytes(1)[0]! & 1) === 1 ? 1 : 0, 1 / 24, 0)[0];
      expect(Math.abs(p.vol - GLICKO2.vol0)).toBeLessThan(0.001);
    }
    near(p.vol, 0.0598, 0.0001, 'σ after 2,000 fair games');
  });

  it('one upset (1500 losing to 1100, both RD 60) moves σ from 0.06 to 0.060009; twenty in a row by less than 0.002 at τ 0.5', () => {
    const upset: Glicko2Opponent[] = [{ r: 1100, rd: 60, score: 0 }];
    near(glicko2Period(G(1500, 60, 0.06), upset, { tau: 0.5 }).vol, 0.060009, 0.000001, 'one upset');
    // The same upset twenty times (the rating held at 1500, RD and σ carried): 0.060067, 0.060188, 0.061107 for τ 0.3, 0.5, 1.2.
    const twenty = (tau: number): number => {
      let p = G(1500, 60, 0.06);
      for (let i = 0; i < 20; i += 1) {
        const x = glicko2Period(p, upset, { tau });
        p = G(1500, Math.min(350, Math.max(50, x.rd)), x.vol);
      }
      return p.vol;
    };
    near(twenty(0.3), 0.060067, 0.000001, 'τ 0.3');
    near(twenty(0.5), 0.060188, 0.000001, 'τ 0.5');
    near(twenty(1.2), 0.061107, 0.000001, 'τ 1.2');
    expect(twenty(0.5) - 0.06).toBeLessThan(0.002);
    // and played out on the ladder (the rating falls with each loss), σ moves even less
    let p = G(1500, 60, 0.06);
    for (let i = 0; i < 20; i += 1) p = rateOneVsOne(p, G(1100, 60, 0.06), 0, 0, 0)[0];
    expect(p.vol - 0.06).toBeGreaterThan(0);
    expect(p.vol - 0.06).toBeLessThan(0.002);
  });
});

describe('M15-2: time away (4.3 step 2, glicko2RdAt)', () => {
  it('is added once, by rateOneVsOne from its days arguments, with idleVolPerDay and never the player\'s σ', () => {
    for (const vol of [0.03, 0.06, 0.1]) {
      const a = G(1500, 60, vol);
      const b = G(1550, 90, 0.06);
      const [x] = rateOneVsOne(a, b, 1, 30, 3);
      const rdAt = GLICKO2.scale * Math.sqrt((60 / GLICKO2.scale) ** 2 + 30 * GLICKO2.idleVolPerDay ** 2);
      near(glicko2RdAt(60, 30), rdAt, 1e-9, 'RD at game time');
      const once = glicko2Period(G(1500, rdAt, vol), [{ r: 1550, rd: glicko2RdAt(90, 3), score: 1 }], { tau: 0.5, volMax: 0.1 });
      near(x.r, once.r, 1e-9, `σ ${vol}: r`);
      near(x.rd, once.rd, 1e-9, `σ ${vol}: RD`);
    }
  });

  it('glicko2RdAt is monotone in days, capped at 350, 0 days for negative ones, and the identity at 0 days', () => {
    const days = [0, 0.001, 0.5, 1, 2, 10, 30, 99, 100, 365, 1000, 2000, 5000, 1e6];
    for (const rd of [50, 60, 120, 349, 350]) {
      const out = days.map((d) => glicko2RdAt(rd, d));
      for (let i = 1; i < out.length; i += 1) expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]!);
      for (const v of out) expect(v).toBeLessThanOrEqual(350);
      expect(out[out.length - 1]).toBe(350);
      expect(glicko2RdAt(rd, 0), "no time away: rd itself").toBe(rd);
      expect(glicko2RdAt(rd, -5)).toBe(glicko2RdAt(rd, 0));
    }
  });

  it('an active player at RD 60 reaches the provisional limit of 120 after about 99.4 days (6.2)', () => {
    expect(glicko2RdAt(60, 99.4)).toBeLessThan(120);
    expect(glicko2RdAt(60, 99.42)).toBeGreaterThan(120);
    near((120 ** 2 - 60 ** 2) / (GLICKO2.scale * GLICKO2.idleVolPerDay) ** 2, 99.41, 0.005, 'days');
  });
});

describe('M15-2: glicko2Period edges (4.2)', () => {
  it("with no games, r and σ stay and RD' = scale · sqrt(φ² + σ²) (the paper's rule for a player who did not compete)", () => {
    const x = glicko2Period(G(1500, 200, 0.06), []);
    expect([x.r, x.vol, x.iterations]).toEqual([1500, 0.06, 0]);
    near(x.rd, GLICKO2.scale * Math.sqrt((200 / GLICKO2.scale) ** 2 + 0.06 ** 2), 1e-9, 'RD');
  });

  it('volMax defaults to Infinity (the paper); the ladder passes 0.1; τ defaults to 0.5', () => {
    const raw = glicko2Period(G(1500, 50, 0.1), [{ r: 2300, rd: 50, score: 1 }]);
    expect(raw.vol).toBe(raw.volRaw);
    expect(raw.vol).toBeGreaterThan(0.1);
    expect(glicko2Period(G(1500, 200, 0.06), PAPER_GAMES)).toEqual(glicko2Period(G(1500, 200, 0.06), PAPER_GAMES, { tau: 0.5, volMax: Infinity }));
  });

  it("the Illinois loop stops at its step limit and keeps the old σ (4.1); within it, it converges to G1's σ'", () => {
    const p = G(1500, 200, 0.06);
    const x = glicko2Period(p, PAPER_GAMES, { tau: 0.5 });
    const phi = 200 / GLICKO2.scale;
    expect(glicko2Volatility(phi, x.v, x.delta, 0.06, 0.5)).toEqual({ vol: x.volRaw, iterations: 2, converged: true });
    expect(glicko2Volatility(phi, x.v, x.delta, 0.06, 0.5, { epsilon: GLICKO2.epsilon, maxIterations: 2 }).converged).toBe(true);
    const stopped = glicko2Volatility(phi, x.v, x.delta, 0.06, 0.5, { epsilon: GLICKO2.epsilon, maxIterations: 1 });
    expect(stopped).toEqual({ vol: 0.06, iterations: 1, converged: false });
    // a tolerance it can never meet: the full 100 steps, then the old σ
    const never = glicko2Volatility(phi, x.v, x.delta, 0.06, 0.5, { epsilon: -1, maxIterations: GLICKO2.maxIterations });
    expect(never).toEqual({ vol: 0.06, iterations: 100, converged: false });
    // f is not a number when E rounds to 0 or 1 (v = Infinity): no root is searched for, the old σ is kept and step 5 says so
    expect(glicko2Volatility(phi, Infinity, -Infinity, 0.06, 0.5)).toEqual({ vol: 0.06, iterations: 0, converged: false });
    expect(glicko2Volatility(phi, Infinity, 0, 0.06, 0.5)).toEqual({ vol: 0.06, iterations: 0, converged: false });
  });

  it("rateOneVsOne tells its optional 6th argument each player's step 5, so the service can log one that kept the old σ (4.1)", () => {
    type Heard = [player: 'a' | 'b', iterations: number, converged: boolean];
    const rate = (a: Glicko2State, b: Glicko2State, scoreA: 0 | 0.5 | 1, daysA: number, daysB: number) => {
      const heard: Heard[] = [];
      const out = rateOneVsOne(a, b, scoreA, daysA, daysB, (player, iterations, converged) => { heard.push([player, iterations, converged]); });
      // the hook only listens: the states are those of a call without it
      expect(out).toEqual(rateOneVsOne(a, b, scoreA, daysA, daysB));
      return { out, heard };
    };
    // an ordinary game (G4): both converge, in as many steps as glicko2Period takes
    const g4 = rate(G(1600, 60, 0.06), G(1650, 80, 0.06), 1, 2, 10);
    const stepsA = glicko2Period(G(1600, glicko2RdAt(60, 2), 0.06), [{ r: 1650, rd: glicko2RdAt(80, 10), score: 1 }], { volMax: 0.1 }).iterations;
    const stepsB = glicko2Period(G(1650, glicko2RdAt(80, 10), 0.06), [{ r: 1600, rd: glicko2RdAt(60, 2), score: 0 }], { volMax: 0.1 }).iterations;
    expect(g4.heard).toEqual([['a', stepsA, true], ['b', stepsB, true]]);
    expect(stepsA).toBeGreaterThan(0);
    // an expected result 18,000 points apart: A's loop passes its 100-step limit; B's E rounds to 1 (v = Infinity). Both keep the old σ.
    const far = rate(G(1500, 50, 0.06), G(19500, 50, 0.06), 0, 0, 0);
    expect(far.heard).toEqual([['a', GLICKO2.maxIterations, false], ['b', 0, false]]);
    expect(far.out.map((x) => x.vol)).toEqual([0.06, 0.06]);
    // 16,700 points apart A's loop meets ε on its 100th step: converged, though `iterations` alone equals the limit
    expect(rate(G(1500, 50, 0.06), G(18200, 50, 0.06), 0, 0, 0).heard).toEqual([['a', GLICKO2.maxIterations, true], ['b', 0, false]]);
    // an upset 16,700 points apart: A's E rounds to 1, so step 5 finds no root and keeps the old σ; B's step 5 converges
    const upset = rate(G(1500, 50, 0.06), G(-15200, 50, 0.06), 0, 0, 0);
    expect(upset.heard).toEqual([['a', 0, false], ['b', 3, true]]);
    expect(upset.out[0].vol).toBe(0.06);
    expect(upset.out[1].vol).toBeGreaterThan(0.06);
    for (const x of [...far.out, ...upset.out]) expect([x.r, x.rd, x.vol].every(Number.isFinite)).toBe(true);
  });

  it('refuses malformed input with a RangeError', () => {
    const ok = G(1500, 200, 0.06);
    expect(() => glicko2Period(G(Number.NaN, 200, 0.06), PAPER_GAMES)).toThrow(RangeError);
    expect(() => glicko2Period(G(1500, 0, 0.06), PAPER_GAMES)).toThrow(RangeError);
    expect(() => glicko2Period(G(1500, 200, 0), PAPER_GAMES)).toThrow(RangeError);
    expect(() => glicko2Period(ok, [{ r: 1500, rd: -1, score: 1 }])).toThrow(RangeError);
    expect(() => glicko2Period(ok, [{ r: Infinity, rd: 30, score: 1 }])).toThrow(RangeError);
    expect(() => glicko2Period(ok, [{ r: 1500, rd: 30, score: 0.7 as 1 }])).toThrow(RangeError);
    expect(() => glicko2Period(ok, PAPER_GAMES, { tau: 0 })).toThrow(RangeError);
    expect(() => glicko2Period(ok, PAPER_GAMES, { volMax: 0 })).toThrow(RangeError);
    expect(() => rateOneVsOne(ok, ok, 2 as 1, 0, 0)).toThrow(RangeError);
    expect(() => rateOneVsOne(ok, ok, 1, Number.NaN, 0)).toThrow(RangeError);
    expect(() => glicko2RdAt(Number.NaN, 1)).toThrow(RangeError);
  });

  it('periodMs is a day: the unit of time away', () => {
    expect(GLICKO2.periodMs).toBe(DAY_MS);
  });
});
