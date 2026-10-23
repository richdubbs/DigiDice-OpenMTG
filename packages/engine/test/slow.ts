/**
 * The slow suites (package QT): soak games, game marathons, whole-index corpus tests over the local Scryfall cache, timing measurements and the
 * release-gate CLI run. `npm test` skips them so the default suite stays fast for everyday work; `npm run test:all` sets OPENMTG_SLOW=1 and runs
 * everything (merge-time verification, CONTRIBUTING.md). Rules tests are never gated here: only tests whose cost is volume (many games, every card of
 * the index), not a rule of their own.
 *
 * A gated test keeps its title when OPENMTG_SLOW=1; without it the title carries the skip reason, so a skipped run says why and how to run it.
 * Work a gated suite does while it is collected (module scope, describe bodies) must also check SLOW, or move into a hook: Vitest runs the body of a
 * skipped describe to list its tests.
 */
import process from 'node:process';
import { describe, it } from 'vitest';

/** True when the slow suites run (OPENMTG_SLOW=1, set by `npm run test:all`). */
export const SLOW = process.env['OPENMTG_SLOW'] === '1';

export const SLOW_SKIP_REASON = 'slow suite, skipped by npm test: run npm run test:all (OPENMTG_SLOW=1)';

/** The title of a gated test or suite: unchanged when the slow suites run, else with the skip reason appended. */
export function slowTitle(title: string): string {
  return SLOW ? title : `${title} [${SLOW_SKIP_REASON}]`;
}

/** `describe` for a slow suite: skipped with the reason unless OPENMTG_SLOW=1. */
export function describeSlow(title: string, fn: () => void, timeout?: number): void {
  describe.skipIf(!SLOW)(slowTitle(title), fn, timeout);
}

/** `it` for a slow test: skipped with the reason unless OPENMTG_SLOW=1. */
export function itSlow(title: string, fn: () => unknown, timeout?: number): void {
  it.skipIf(!SLOW)(slowTitle(title), fn as () => Promise<void>, timeout);
}
