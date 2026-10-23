/**
 * M15-6: the simulation's random source. Seeded and deterministic (fixed inputs only, owner rule): the same seed gives the same run on every machine,
 * so every number of docs/perf/m15-ladder-sim.md can be reproduced with scripts/simulate.ts. Never Math.random.
 *
 * xoshiro128** (Blackman and Vigna, public domain) seeded from a string by the cyrb128 hash; `fork(label)` derives an independent stream, so adding a
 * draw in one part of a run does not shift the draws of another (players, arrivals and outcomes each have their own stream).
 */

/** cyrb128: four 32-bit words from a string (a seed hash, not a cryptographic one). */
function cyrb128(s: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class Rng {
  readonly seed: string;
  #a: number;
  #b: number;
  #c: number;
  #d: number;
  #spare: number | null = null;

  constructor(seed: string) {
    this.seed = seed;
    [this.#a, this.#b, this.#c, this.#d] = cyrb128(seed);
    if ((this.#a | this.#b | this.#c | this.#d) === 0) this.#a = 1;
  }

  /** A 32-bit unsigned integer (xoshiro128**). */
  u32(): number {
    const result = Math.imul(rotl(Math.imul(this.#b, 5), 7), 9) >>> 0;
    const t = this.#b << 9;
    this.#c ^= this.#a;
    this.#d ^= this.#b;
    this.#b ^= this.#c;
    this.#a ^= this.#d;
    this.#c ^= t;
    this.#d = rotl(this.#d, 11);
    return result;
  }

  /** Uniform in [0, 1), 53 bits. */
  next(): number {
    const hi = this.u32() >>> 5;
    const lo = this.u32() >>> 6;
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform in (0, 1): never 0, for logarithms. */
  open(): number {
    let x = this.next();
    while (x === 0) x = this.next();
    return x;
  }

  /** A whole number in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Uniform in [lo, hi). */
  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** A normal deviate (Box-Muller, the spare kept). */
  normal(mean = 0, sd = 1): number {
    if (this.#spare !== null) {
      const z = this.#spare;
      this.#spare = null;
      return mean + sd * z;
    }
    const u = this.open();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.#spare = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  }

  /** A standard Gumbel deviate: −ln(−ln U). Sorting θ_i + Gumbel_i descending draws a Plackett-Luce order with strengths exp(θ_i). */
  gumbel(): number {
    return -Math.log(-Math.log(this.open()));
  }

  /** An exponential deviate with this mean. */
  exponential(mean: number): number {
    return -mean * Math.log(this.open());
  }

  /** A Poisson deviate (Knuth's method; the means here are small). */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean > 30) return Math.max(0, Math.round(this.normal(mean, Math.sqrt(mean))));
    const limit = Math.exp(-mean);
    let k = 0;
    let p = this.next();
    while (p > limit) {
      k++;
      p *= this.next();
    }
    return k;
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new RangeError('Rng.pick: an empty list');
    return xs[this.int(xs.length)]!;
  }

  /** An independent stream for one part of a run. */
  fork(label: string): Rng {
    return new Rng(`${this.seed}/${label}`);
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}
