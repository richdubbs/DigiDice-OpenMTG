/** Helpers of M15-2's tests (the rating core, design 4-7, 8.5): state builders, times and a tolerance check. Test-only. */
import { expect } from 'vitest';
import type { Glicko2State, WengLinState } from '@openmtg/ladder/api';

export const DAY_MS = 86_400_000;

export function G(r: number, rd: number, vol: number): Glicko2State {
  return { model: 'glicko2', r, rd, vol };
}

export function W(mu: number, sigma: number): WengLinState {
  return { model: 'wenglin', mu, sigma };
}

/** Four new pod players, (25, 25/3) each. */
export function newPod(n = 4): WengLinState[] {
  return Array.from({ length: n }, () => W(25, 25 / 3));
}

/** "Mixed" of 5.5, in seat order. */
export function mixedPod(): WengLinState[] {
  return [W(30, 3), W(25, 5), W(22, 2), W(27, 8)];
}

/** The ISO time `days` days before `iso` (fractional days allowed). */
export function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(iso) - Math.round(days * DAY_MS)).toISOString();
}

/** The days between two ISO times, as the ladder counts time away. */
export function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / DAY_MS;
}

/** |actual − expected| ≤ tol, with a message that shows both. */
export function near(actual: number, expected: number, tol: number, what = 'value'): void {
  expect(Number.isFinite(actual), `${what} is finite (${actual})`).toBe(true);
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected} (tolerance ${tol})`).toBeLessThanOrEqual(tol);
}

/** Each element near its expected value. */
export function nearAll(actual: readonly number[], expected: readonly number[], tol: number, what = 'values'): void {
  expect(actual.length, `${what}: length`).toBe(expected.length);
  actual.forEach((a, i) => near(a, expected[i]!, tol, `${what}[${i}]`));
}

/** The 1v1 vector tolerances of 4.5: 0.0001 on r and RD, 0.000001 on σ. */
export function nearGlicko(actual: Glicko2State, r: number, rd: number, vol: number, what = 'state'): void {
  expect(actual.model).toBe('glicko2');
  near(actual.r, r, 0.0001, `${what}.r`);
  near(actual.rd, rd, 0.0001, `${what}.rd`);
  near(actual.vol, vol, 0.000001, `${what}.vol`);
}

/** The pod vector tolerance of 5.5: 0.000001 on μ and σ. */
export function nearPod(actual: readonly WengLinState[], mu: readonly number[], sigma: readonly number[], what = 'pod'): void {
  for (const p of actual) expect(p.model).toBe('wenglin');
  nearAll(actual.map((p) => p.mu), mu, 0.000001, `${what} μ`);
  nearAll(actual.map((p) => p.sigma), sigma, 0.000001, `${what} σ`);
}

/** The median of a list (the mean of the two middle values for an even count). */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A uniform number in [0, 1) from a fixed byte source (test/support/random.ts): fixed inputs, no chance. */
export function uniform(bytes: (n: number) => Uint8Array): () => number {
  return () => {
    const b = bytes(6);
    let x = 0;
    for (const v of b) x = x * 256 + v;
    return x / 2 ** 48;
  };
}
