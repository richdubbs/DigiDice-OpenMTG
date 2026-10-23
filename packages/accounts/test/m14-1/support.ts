/** Shared helpers of the M14-1 tests: a fixed random source and type-level equality. */
import { createHash } from 'node:crypto';

/**
 * A fixed, reproducible byte source (SHA-256 of `seed:counter`, block after block): the same seed gives the same bytes on every run, so no test
 * depends on chance (fixed inputs only, owner rule).
 */
export function fixedRandom(seed: string): (n: number) => Uint8Array {
  let counter = 0;
  let pool = new Uint8Array(0);
  return (n: number) => {
    const out = new Uint8Array(n);
    let i = 0;
    while (i < n) {
      if (pool.length === 0) pool = new Uint8Array(createHash('sha256').update(`${seed}:${counter++}`).digest());
      const take = Math.min(n - i, pool.length);
      out.set(pool.subarray(0, take), i);
      pool = pool.subarray(take);
      i += take;
    }
    return out;
  };
}

/** A source that always gives `byte`. */
export function constantRandom(byte: number): (n: number) => Uint8Array {
  return (n: number) => new Uint8Array(n).fill(byte);
}

/** True when A and B are the same type (checked by the package typecheck: `const x: Equals<A, B> = true`). */
export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
