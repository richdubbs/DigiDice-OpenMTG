/**
 * M15-2: the pod rating, Weng and Lin's Bayesian approximation with the Plackett-Luce model (JMLR 12, 2011; design 5, D4, 13.1), one-player teams,
 * written here from the paper (no dependency). Browser-safe: no `node:` imports, here or in anything this file imports. Exposed only through the
 * named re-export in ../api.ts.
 * Imports: values only from ./constants (WENGLIN) or files of this part's own (./places); from ../api types only (`import type`). ../api re-exports
 * this file, so a value taken from ../api would be undefined while the contract loads (a cycle; test/m15-1/load.test.ts refuses one).
 *
 * Ties are rated as the mean over every strict order that breaks them (5.4), not by the paper's division by the tie group's size (A_q), which credits
 * players sharing a place at the top or in the middle as if they had finished at the worse end of their tie. The strict-order core is the paper's.
 */
import type { Place, WengLinState } from '../api';
import { WENGLIN } from './constants';
import { validPlaces } from './places';

function finite(x: number, what: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new RangeError(`wenglin: ${what} is not a finite number (${String(x)})`);
  return x;
}

function checkState(p: WengLinState, what: string): void {
  finite(p.mu, `${what}.mu`);
  if (finite(p.sigma, `${what}.sigma`) <= 0) throw new RangeError(`wenglin: ${what}.sigma must be above 0 (${p.sigma})`);
}

/** σ² after `days` without games (5.2, 5.3): min(sigma0², σ² + days · driftPerDay); days below 0 count as 0. */
function varianceAt(sigma: number, days: number): number {
  const d = Math.max(0, finite(days, 'days'));
  return Math.min(WENGLIN.sigma0 * WENGLIN.sigma0, finite(sigma, 'sigma') * sigma + d * WENGLIN.driftPerDay);
}

/** σ after `days` without games: sqrt(min(sigma0², sigma² + days · driftPerDay)). Days below 0 count as 0. */
export function wenglinSigmaAt(sigma: number, days: number): number {
  return Math.sqrt(varianceAt(sigma, days));
}

/**
 * The strict-order core (the paper's Algorithm, one-player teams) for tests and the details panel: Ω and Δ per player.
 *
 * `players` as they enter the update (any growth of σ, time away and τ, already applied: ratePod does that); `ranks` all different (a strict order,
 * 1 = first; only their order matters). With c = sqrt(Σ (σi² + β²)), C_q = Σ{s : rank(s) ≥ rank(q)} exp(μs / c) and p_iq = exp(μi / c) / C_q:
 *   Ω_i = (σi² / c) · Σ{q : rank(q) ≤ rank(i)} ([q = i] − p_iq)
 *   Δ_i = γ_i · (σi² / c²) · Σ{q : rank(q) ≤ rank(i)} p_iq (1 − p_iq),   γ_i = σi / c
 * Each C_q is taken relative to the largest μ of its own tail (the same p_iq, finite whatever the gaps: that tail's top adds exp(0) = 1, so the
 * sum is at least 1, and a strength that underflows gives p_iq 0, its limit). Relative to the overall top instead, a whole tail more than about
 * 745·c below it underflows to 0 and p_iq is 0 / 0. Throws a RangeError on fewer than 2 players, lengths that differ, a value that is not finite,
 * a σ not above 0 or so large that c is not a finite number, or a repeated rank.
 */
export function plackettLuceTerms(players: readonly WengLinState[], ranks: readonly number[]): { omega: number; delta: number }[] {
  const n = players.length;
  if (n < 2) throw new RangeError(`wenglin: a game needs at least 2 players (${n})`);
  if (ranks.length !== n) throw new RangeError(`wenglin: ${ranks.length} ranks for ${n} players`);
  players.forEach((p, i) => checkState(p, `players[${i}]`));
  ranks.forEach((r, i) => finite(r, `ranks[${i}]`));
  if (new Set(ranks).size !== n) throw new RangeError(`wenglin: ranks must be all different, a strict order (${ranks.join(', ')})`);

  const c = Math.sqrt(players.reduce((sum, p) => sum + p.sigma * p.sigma + WENGLIN.beta * WENGLIN.beta, 0));
  if (!Number.isFinite(c)) throw new RangeError(`wenglin: the players' σ are too large to rate (c = ${c})`);
  // q's tail: q and everyone ranked after it. C_q relative to the tail's own top μ.
  const tails = ranks.map((rq) => players.flatMap((_, s) => (ranks[s]! >= rq ? [s] : [])));
  const tailTop = tails.map((tail) => Math.max(...tail.map((s) => players[s]!.mu)));
  const sumFrom = tails.map((tail, q) => tail.reduce((sum, s) => sum + Math.exp((players[s]!.mu - tailTop[q]!) / c), 0));

  return players.map((p, i) => {
    let omega = 0;
    let delta = 0;
    for (let q = 0; q < n; q += 1) {
      if (ranks[q]! > ranks[i]!) continue;
      const piq = Math.exp((p.mu - tailTop[q]!) / c) / sumFrom[q]!;
      omega += (q === i ? 1 : 0) - piq;
      delta += piq * (1 - piq);
    }
    const sigma2 = p.sigma * p.sigma;
    const gamma = p.sigma / c;
    return { omega: (sigma2 / c) * omega, delta: gamma * (sigma2 / (c * c)) * delta };
  });
}

/** Every permutation of `xs` (at most 4! = 24), in a fixed order. */
function permutations(xs: readonly number[]): number[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/**
 * The strict orders a finishing order with shared places allows (5.3's O): the players of each shared place take the ranks from that place on in
 * every possible order (2 for one pair, 6 for three players, at most 24). `places` must pass validPlaces.
 */
function strictOrders(places: readonly number[]): number[][] {
  const groups = new Map<number, number[]>();
  places.forEach((p, i) => groups.set(p, [...(groups.get(p) ?? []), i]));
  let orders: number[][] = [places.map(() => 0)];
  for (const [place, seats] of [...groups].sort((x, y) => x[0] - y[0])) {
    const ways = permutations(seats);
    orders = orders.flatMap((o) => ways.map((way) => {
      const ranks = [...o];
      way.forEach((seat, k) => { ranks[seat] = place + k; });
      return ranks;
    }));
  }
  return orders;
}

/**
 * One ranked pod game (5.3): new states in input order. `players` as ratingNow(...).state (no time away); `places` must pass validPlaces; `days[i]`
 * as for 1v1. Ties are rated as the average over every strict order the tie allows (D4, 5.4).
 *
 * For each player, σi² ← min(sigma0², σi² + driftPerDay · days[i]) + τ² (time away, capped at the initial σ, then the per-game dynamics); then Ω̄
 * and Δ̄, the means of plackettLuceTerms over the strict orders, and μi' = μi + Ω̄i, σi' = sqrt(σi² · max(1 − Δ̄i, κ)). Everyone's update uses
 * everyone's values from before the game. A player who left early is rated at the place the ledger gave them (CR 104.3a, 800.4a). Throws a
 * RangeError on lengths that differ, places that fail validPlaces, a value that is not finite or a σ not above 0.
 */
export function ratePod(players: readonly WengLinState[], places: readonly Place[], days: readonly number[]): WengLinState[] {
  const n = players.length;
  if (places.length !== n || days.length !== n) throw new RangeError(`wenglin: ${n} players, ${places.length} places and ${days.length} days`);
  if (!validPlaces(places)) throw new RangeError(`wenglin: places ${places.join(', ')} break the shared-place rule`);
  players.forEach((p, i) => checkState(p, `players[${i}]`));

  const tau2 = WENGLIN.tau * WENGLIN.tau;
  const grown = players.map((p, i): WengLinState => ({ model: 'wenglin', mu: p.mu, sigma: Math.sqrt(varianceAt(p.sigma, days[i]!) + tau2) }));
  const orders = strictOrders(places);
  const omega = new Array<number>(n).fill(0);
  const delta = new Array<number>(n).fill(0);
  for (const ranks of orders) {
    plackettLuceTerms(grown, ranks).forEach((t, i) => {
      omega[i]! += t.omega;
      delta[i]! += t.delta;
    });
  }
  return grown.map((p, i) => {
    const sigma2 = p.sigma * p.sigma;
    return {
      model: 'wenglin',
      mu: p.mu + omega[i]! / orders.length,
      sigma: Math.sqrt(sigma2 * Math.max(1 - delta[i]! / orders.length, WENGLIN.kappa)),
    };
  });
}
