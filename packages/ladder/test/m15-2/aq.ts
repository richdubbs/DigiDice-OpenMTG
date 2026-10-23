/**
 * Test-only (M15-2, design 5.4, 5.5): Weng and Lin's OWN tie rule, which divides each likelihood term by A_q, the size of q's tie group, written
 * from the paper's Plackett-Luce algorithm (one-player teams) independently of src/api/wenglin.ts. The ladder does NOT use it: `ratePod` averages
 * over the strict orders a tie allows. It is here to pin openskill's published tie example (which is this rule with τ = 0) and to show where the
 * two rules agree (ties at the bottom) and where they differ on purpose (in the middle and at the top).
 *
 *   σi² ← σi² + τ²;  c = sqrt(Σ (σi² + β²));  C_q = Σ{s : place(s) ≥ place(q)} exp(μs / c);  A_q = #{s : place(s) = place(q)}
 *   Ω_i = (σi² / c) Σ{q : place(q) ≤ place(i)} ([q = i] − p_iq) / A_q          p_iq = exp(μi / c) / C_q
 *   Δ_i = (σi / c)(σi² / c²) Σ{q : place(q) ≤ place(i)} p_iq (1 − p_iq) / A_q
 *   μi' = μi + Ω_i;  σi' = sqrt(σi² max(1 − Δ_i, κ))
 * No time away (the cases that use it have none). On a strict order (every A_q = 1) it is the paper's algorithm itself.
 */
import type { WengLinState } from '@openmtg/ladder/api';

const BETA = 25 / 6;
const KAPPA = 0.0001;

export function aqRatePod(players: readonly WengLinState[], places: readonly number[], tau: number): WengLinState[] {
  const grown = players.map((p) => ({ mu: p.mu, s2: p.sigma * p.sigma + tau * tau }));
  const c = Math.sqrt(grown.reduce((sum, p) => sum + p.s2 + BETA * BETA, 0));
  const e = grown.map((p) => Math.exp(p.mu / c));
  const cq = places.map((pq) => e.reduce((sum, x, s) => (places[s]! >= pq ? sum + x : sum), 0));
  const aq = places.map((pq) => places.filter((p) => p === pq).length);
  return grown.map((p, i) => {
    let omega = 0;
    let delta = 0;
    for (let q = 0; q < grown.length; q += 1) {
      if (places[q]! > places[i]!) continue;
      const piq = e[i]! / cq[q]!;
      omega += ((q === i ? 1 : 0) - piq) / aq[q]!;
      delta += (piq * (1 - piq)) / aq[q]!;
    }
    const sigma = Math.sqrt(p.s2);
    omega *= p.s2 / c;
    delta *= (sigma / c) * (p.s2 / (c * c));
    return { model: 'wenglin', mu: p.mu + omega, sigma: Math.sqrt(p.s2 * Math.max(1 - delta, KAPPA)) };
  });
}
