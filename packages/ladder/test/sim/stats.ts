/** M15-6: small statistics over the simulation's samples. */

export function sorted(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

/** The q-quantile (0..1) by linear interpolation; NaN for no samples. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = sorted(xs);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return Number.NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** The share of `xs` for which `f` holds. */
export function share<T>(xs: readonly T[], f: (x: T) => boolean): number {
  return xs.length === 0 ? Number.NaN : xs.filter(f).length / xs.length;
}

/** Spearman's rank correlation (ties by average ranks). */
export function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (xs: readonly number[]) => {
    const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/** Formats a share as a percentage with one decimal ("4.5%"). */
export function pct(x: number, digits = 1): string {
  return Number.isNaN(x) ? 'n/a' : `${(100 * x).toFixed(digits)}%`;
}

/** Formats a number with fixed decimals ("n/a" for NaN). */
export function num(x: number, digits = 0): string {
  return Number.isFinite(x) ? x.toFixed(digits) : 'n/a';
}
