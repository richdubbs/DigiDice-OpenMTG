/** A fixed random source for the ladder's tests (M15-1; shared): no test depends on chance (fixed inputs only, owner rule). */
import { createHash } from 'node:crypto';
import type { RandomBytes } from '../../src/ids';

/** SHA-256 of `seed:counter`, block after block: the same seed gives the same bytes on every run. */
export function fixedRandom(seed: string): RandomBytes {
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
export function constantRandom(byte: number): RandomBytes {
  return (n: number) => new Uint8Array(n).fill(byte);
}

/** A counter of ids for RankedMatcherContext.newMatchId (9.6): "m1", "m2", ... */
export function counterIds(prefix = 'm'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}
