/**
 * M15-4: the rated matcher's entry points (design 9, 13.5), filled from M15-1's stub. src/index.ts re-exports this file with `export *`.
 * The matcher is src/match/rated.ts; its searches are ./one.ts (1v1) and ./pods.ts, on the pair rules of ./rules.ts; the window rule is ./window.ts,
 * the status numbers ./status.ts.
 */
import type { RankedMatcher, RankedMatcherContext } from './api';
import { RatedMatcher } from './rated';

export { rankedWindow } from './window';

/**
 * The rated matcher (9): a queue per ladder, mutual widening windows, pods by spread, no quick rematches; deterministic for the same input (9.6).
 * The policy is read once, here (a RangeError if a field is not a finite number ≥ 0); later changes to `ctx.policy` change nothing.
 * A successful `enter` drops the account's block notes from its previous time in the queue (9.4) and keeps the ones made since it was last matched,
 * so `entryFor`'s fresh pairs hold whether hosted hands them to `noteBlocks` before or after `enter`.
 */
export function createRatedMatcher(ctx: RankedMatcherContext): RankedMatcher {
  return new RatedMatcher(ctx);
}
