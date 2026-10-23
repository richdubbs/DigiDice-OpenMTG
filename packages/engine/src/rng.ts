/**
 * Seeded, serializable pseudo-random number generator (sfc32).
 * The RNG state lives inside GameState so games are deterministic and replayable:
 * the same seed + the same action log always produce the same game.
 */
export type RngState = [number, number, number, number];

/**
 * cyrb128: a 128-bit non-cryptographic hash of a string, as four 32-bit words. It seeds the RNG (`seedRng`) and makes a replay's checkpoint digests
 * (core/digest.ts), so it is fixed: changing it would change every seeded game and every recorded digest.
 */
export function cyrb128(seed: string): RngState {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** Hash a string seed into four 32-bit words (cyrb128) and warm the generator up. */
export function seedRng(seed: string): RngState {
  const st = cyrb128(seed);
  // Warm up so similar seeds diverge.
  for (let i = 0; i < 15; i++) nextUint32(st);
  return st;
}

/** Advance the state in place and return a uniformly distributed uint32. */
export function nextUint32(st: RngState): number {
  let [a, b, c, d] = st;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) >>> 0;
  st[0] = a >>> 0; st[1] = b; st[2] = c; st[3] = d;
  return t;
}

/** Uniform integer in [0, n) without modulo bias. */
export function randomInt(st: RngState, n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`randomInt: bad bound ${n}`);
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    const x = nextUint32(st);
    if (x < limit) return x % n;
  }
}

/** Fisher-Yates shuffle in place (CR 701.24 "shuffle": a random order). */
export function shuffleInPlace<T>(st: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(st, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
