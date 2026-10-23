/**
 * The state a `readingStable` scope holds still (rules/characteristics.ts), shared with statics/rule-sources.ts so that the rule hooks' view of a layered
 * state is checked once per scope instead of once per hook call (W3b performance: with the whole template set, decklist cards have layer sources, and the
 * per-call fingerprint of the state was half the time of a game). Synchronous and scoped exactly like `readingStable`: nothing outlives the call.
 *
 * P1 (performance): the scope itself lives here (`holdStill`), so that read-only questions below rules/characteristics.ts in the import graph (the rule
 * hookpoints, rules/filter.ts, rules/combat-rules.ts) can hold their state still too; `readingStable` is the same function. Each reader memoizes what it
 * checked for the scope in `memo` (rules/characteristics.ts: the layered characteristics; statics/rule-sources.ts: the layered entry). `holdStill` is the
 * only way to open a scope (it applies the nesting rule and the test-only verifier); the W3b setter `swapStableScope` was removed in P1.
 */
import type { GameState } from '../types/state';

export interface StableScope {
  s: GameState;
  /** What a reader memoized for this state during the scope (statics/rule-sources.ts: the layered entry). */
  memo: Map<string, unknown>;
}

let current: StableScope | null = null;

/** The active scope, if it holds `s` still. */
export const stableScopeFor = (s: GameState): StableScope | null => (current !== null && current.s === s ? current : null);

/**
 * Installed by rules/characteristics.ts for its `STABLE_READS.verify` switch (tests only): called when a scope opens, returns the check made when it closes
 * normally (it throws an EngineBug if the read changed what the layers read), or null when verification is off.
 */
let verifier: ((s: GameState) => (() => void) | null) | null = null;
export function installScopeVerifier(v: ((s: GameState) => (() => void) | null) | null): void {
  verifier = v;
}

/**
 * Run `read`, which reads `s` and DOES NOT CHANGE IT, with `s` held still: every characteristics or rule-hook question about `s` inside checks the caches
 * once for the whole scope. Nested calls for the same state share the scope; a read of another state (a clone, an overlay) takes the normal path.
 */
export function holdStill<T>(s: GameState, read: () => T): T {
  if (current !== null && current.s === s) return read();
  const outer = current;
  current = { s, memo: new Map() };
  const check = verifier !== null ? verifier(s) : null;
  try {
    const out = read();
    check?.();
    return out;
  } finally {
    current = outer;
  }
}
