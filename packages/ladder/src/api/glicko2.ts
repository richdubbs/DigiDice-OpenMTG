/**
 * M15-2: the 1v1 rating, Glicko-2 (design 4, D3, 13.1), after Glickman, "Example of the Glicko-2 system" (2012). Browser-safe: no `node:` imports,
 * here or in anything this file imports. Exposed only through the named re-export in ../api.ts.
 * Imports: values only from ./constants (GLICKO2) or files of this part's own; from ../api types only (`import type`). ../api re-exports this file,
 * so a value taken from ../api would be undefined while the contract loads (a cycle; test/m15-1/load.test.ts refuses one).
 *
 * Each ranked game is its own rating period (4.3, 4.4). With one game per period step 5 hardly moves σ, so σ0 is the knob that sets how fast ratings
 * move; time away grows RD by its own constant, GLICKO2.idleVolPerDay, never by the player's σ. The server is authoritative (D21): stored results are
 * the doubles computed here, never recomputed in a browser.
 */
import type { Glicko2Opponent, Glicko2PeriodResult, Glicko2State } from '../api';
import { GLICKO2 } from './constants';

function finite(x: number, what: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new RangeError(`glicko2: ${what} is not a finite number (${String(x)})`);
  return x;
}

function positive(x: number, what: string): number {
  if (finite(x, what) <= 0) throw new RangeError(`glicko2: ${what} must be above 0 (${x})`);
  return x;
}

function score(s: number, what: string): 0 | 0.5 | 1 {
  if (s !== 0 && s !== 0.5 && s !== 1) throw new RangeError(`glicko2: ${what} must be 0, 0.5 or 1 (${String(s)})`);
  return s;
}

/** Step 3's g(φ) = 1 / sqrt(1 + 3φ² / π²). */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** Step 3's E(μ, μj, φj) = 1 / (1 + exp(−g(φj)(μ − μj))). */
function expected(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/** What step 5 found: σ' before any cap, the Illinois steps it took, and whether it found σ' (false: the old σ, kept). */
export interface Glicko2Volatility { vol: number; iterations: number; converged: boolean }

/**
 * Step 5 of the paper, the Illinois algorithm (4.2): σ' before any cap, from φ, v, Δ, σ and τ. At most `limits.maxIterations` steps (GLICKO2's
 * 100): past that it stops, keeps the old σ and answers `converged: false` (4.1: the old σ is kept and the game is logged). It also keeps the old
 * σ and answers `converged: false`, with no search, when f is not a finite number: when E rounds to exactly 1 (v = Infinity; the favourite of a
 * gap of about 6,500 points or more), where the loop would otherwise run on NaN.
 * Computed for the M15-2 review: for ratings 0-3500, RDs 50-350 and σ 0.03-0.1 it takes 1-13 steps (4.1 says 2-10). It reaches the limit only for
 * an expected result about 16,500 points apart or more, unreachable in play.
 * Not part of `@openmtg/ladder/api`: glicko2Period's step 5, exported for the tests of the step limit.
 */
export function glicko2Volatility(
  phi: number, v: number, delta: number, vol: number, tau: number,
  limits: { epsilon: number; maxIterations: number } = GLICKO2,
): Glicko2Volatility {
  const a = Math.log(vol * vol);
  const phi2 = phi * phi;
  const delta2 = delta * delta;
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const d = phi2 + v + ex;
    return (ex * (delta2 - phi2 - v - ex)) / (2 * d * d) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v);
  } else {
    // Here the first term of f lies in (−1/2, 0), so f(a − kτ) > k/τ − 1/2 and the search ends by k = ⌈τ/2⌉ + 1.
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  let iterations = 0;
  if (!Number.isFinite(fA) || !Number.isFinite(fB)) return { vol, iterations, converged: false };
  while (Math.abs(B - A) > limits.epsilon) {
    if (iterations >= limits.maxIterations) return { vol, iterations, converged: false };
    iterations += 1;
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (!Number.isFinite(fC)) return { vol, iterations, converged: false };
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return { vol: Math.exp(A / 2), iterations, converged: true };
}

/**
 * One rating period exactly as Glickman's paper (4.2); `volMax` defaults to Infinity (the paper), the ladder passes 0.1. No RD bounds.
 * - `volRaw` is step 5's σ' before the cap; `vol` is min(volRaw, volMax), the σ' that step 6 uses.
 * - `iterations` counts the Illinois steps. When step 5 finds no σ' (the loop does not meet ε within GLICKO2.maxIterations steps, or f is not a
 *   finite number because E rounded to 1: see glicko2Volatility), the old σ is kept and volRaw is the old σ; `iterations` is then
 *   GLICKO2.maxIterations, or the steps taken before f stopped being a number. The ladder's games go through rateOneVsOne, whose optional
 *   `onVolatility` hears whether step 5 converged, so the service can log the game (4.1).
 * - With no games: r and σ stay and RD' = scale · sqrt(φ² + σ²) (the paper's rule for a player who did not compete); v is Infinity, Δ 0, no steps.
 * Throws a RangeError on a value that is not a finite number, an RD, σ or τ that is not above 0, a negative opponent RD, a volMax that is not above
 * 0, or a score other than 0, 0.5 and 1.
 */
export function glicko2Period(p: Glicko2State, games: readonly Glicko2Opponent[], o?: { tau?: number; volMax?: number }): Glicko2PeriodResult {
  return period(p, games, o).result;
}

/** glicko2Period, and whether its step 5 found σ' (rateOneVsOne reports it). */
function period(
  p: Glicko2State, games: readonly Glicko2Opponent[], o?: { tau?: number; volMax?: number },
): { result: Glicko2PeriodResult; converged: boolean } {
  const tau = positive(o?.tau ?? GLICKO2.tau, 'tau');
  const volMax = o?.volMax ?? Infinity;
  if (typeof volMax !== 'number' || Number.isNaN(volMax) || volMax <= 0) throw new RangeError(`glicko2: volMax must be above 0 (${String(volMax)})`);
  const mu = (finite(p.r, 'r') - GLICKO2.r0) / GLICKO2.scale;
  const phi = positive(p.rd, 'rd') / GLICKO2.scale;
  const vol = positive(p.vol, 'vol');

  if (games.length === 0) {
    const rd = GLICKO2.scale * Math.sqrt(phi * phi + vol * vol);
    return { result: { model: 'glicko2', r: p.r, rd, vol, v: Infinity, delta: 0, volRaw: vol, iterations: 0 }, converged: true };
  }

  // steps 3 and 4
  let vInv = 0;
  let sum = 0;
  for (const [i, j] of games.entries()) {
    const muJ = (finite(j.r, `games[${i}].r`) - GLICKO2.r0) / GLICKO2.scale;
    const rdJ = finite(j.rd, `games[${i}].rd`);
    if (rdJ < 0) throw new RangeError(`glicko2: games[${i}].rd must not be negative (${rdJ})`);
    const phiJ = rdJ / GLICKO2.scale;
    const s = score(j.score, `games[${i}].score`);
    const gJ = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    vInv += gJ * gJ * e * (1 - e);
    sum += gJ * (s - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  // step 5, and the cap (ours, 4.1)
  const step5 = glicko2Volatility(phi, v, delta, vol, tau);
  const volNew = Math.min(step5.vol, volMax);

  // steps 6-8
  const phiStar = Math.sqrt(phi * phi + volNew * volNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;
  const result: Glicko2PeriodResult = {
    model: 'glicko2', r: GLICKO2.scale * muNew + GLICKO2.r0, rd: GLICKO2.scale * phiNew, vol: volNew,
    v, delta, volRaw: step5.vol, iterations: step5.iterations,
  };
  return { result, converged: step5.converged };
}

/** (scale · idleVolPerDay)²: the RD² that a day away adds (about 108.64). */
const IDLE_RD2_PER_DAY = (GLICKO2.scale * GLICKO2.idleVolPerDay) ** 2;

/**
 * RD after `days` without games: min(rdMax, scale · sqrt((rd / scale)² + days · idleVolPerDay²)), the paper's empty-period rule for `days` periods
 * with GLICKO2.idleVolPerDay in place of σ (4.3 step 2; the player's own σ plays no part, 4.4). Days below 0 count as 0.
 * Computed as min(rdMax, sqrt(rd² + days · (scale · idleVolPerDay)²)), the same number, so that 0 days gives `rd` itself (capped) to the last bit:
 * a stored RD of exactly 120 is not provisional (6.2) until time away has grown it. It never falls as `days` grows.
 */
export function glicko2RdAt(rd: number, days: number): number {
  finite(rd, 'rd');
  const d = Math.max(0, finite(days, 'days'));
  return Math.min(GLICKO2.rdMax, Math.sqrt(rd * rd + d * IDLE_RD2_PER_DAY));
}

/** E of step 3: A's expected score against B, both at game time (B's RD enters through g). */
export function glicko2Expected(a: Glicko2State, b: Glicko2State): number {
  const mu = (finite(a.r, 'a.r') - GLICKO2.r0) / GLICKO2.scale;
  const muB = (finite(b.r, 'b.r') - GLICKO2.r0) / GLICKO2.scale;
  const rdB = finite(b.rd, 'b.rd');
  if (rdB < 0) throw new RangeError(`glicko2: b.rd must not be negative (${rdB})`);
  return expected(mu, muB, rdB / GLICKO2.scale);
}

/** 4.3 step 5: RD' clamped to [rdMin, rdMax]; only the state is kept. */
function bounded(x: Glicko2PeriodResult): Glicko2State {
  return { model: 'glicko2', r: x.r, rd: Math.min(GLICKO2.rdMax, Math.max(GLICKO2.rdMin, x.rd)), vol: x.vol };
}

/**
 * One ranked 1v1 game (4.3 steps 2-5): both new states, bounded. `a` and `b` are ratingNow(...).state (season reset applied, NO time away);
 * `daysA`, `daysB` are the days since each one's last rated game (0 for a first game), which this function adds.
 *
 * Step 2 grows each RD by its time away (glicko2RdAt, the only place time away enters); step 4 rates each player as one period with one opponent,
 * each with the other's values from before the game (τ = GLICKO2.tau, σ' at most GLICKO2.volMax), so step 6 adds one period's σ'² on top of the time
 * away; step 5 clamps RD' to [rdMin, rdMax]. `scoreA` is A's score: 1 for a win, 0 for a loss, 0.5 for a draw (places 1, 1; CR 104.4a).
 *
 * INTERFACE CHANGE (M15-2 review, additive and optional): `onVolatility`, when given, hears each player's step 5 once, A then B, after both are
 * rated: the Illinois steps it took and whether it found σ'. `converged` false means the old σ was kept (the step limit, or E rounded to 1: see
 * glicko2Volatility), and the service logs the game (4.1). It changes nothing in the result; an exception it throws reaches the caller.
 */
export function rateOneVsOne(
  a: Glicko2State, b: Glicko2State, scoreA: 0 | 0.5 | 1, daysA: number, daysB: number,
  onVolatility?: (player: 'a' | 'b', iterations: number, converged: boolean) => void,
): [Glicko2State, Glicko2State] {
  const sA = score(scoreA, 'scoreA');
  const sB: 0 | 0.5 | 1 = sA === 1 ? 0 : sA === 0 ? 1 : 0.5;
  const rdA = glicko2RdAt(positive(a.rd, 'a.rd'), daysA);
  const rdB = glicko2RdAt(positive(b.rd, 'b.rd'), daysB);
  const o = { tau: GLICKO2.tau, volMax: GLICKO2.volMax };
  const nextA = period({ model: 'glicko2', r: a.r, rd: rdA, vol: a.vol }, [{ r: b.r, rd: rdB, score: sA }], o);
  const nextB = period({ model: 'glicko2', r: b.r, rd: rdB, vol: b.vol }, [{ r: a.r, rd: rdA, score: sB }], o);
  if (onVolatility !== undefined) {
    onVolatility('a', nextA.result.iterations, nextA.converged);
    onVolatility('b', nextB.result.iterations, nextB.converged);
  }
  return [bounded(nextA.result), bounded(nextB.result)];
}
