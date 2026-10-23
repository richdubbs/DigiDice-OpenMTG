/**
 * M15-5: the abuse heuristics (design 11.1-11.2, 13.4, D18) as an `AbuseChecker`. Server only. src/index.ts re-exports this file with `export *`,
 * so the package root exposes `createAbuseChecker`, the thresholds `ABUSE_RULES` and `resolveAbuseRules` (M15-6 sweeps thresholds with it).
 *
 * The rules (src/abuse/checks.ts) and when they run (src/abuse/checker.ts):
 *   repeatedPairing, oneSided            per pair of a game's accounts, and daily
 *   earlyConcessions, smurf,
 *   ratingTransfer, sandbagging          per account of a game, and daily
 *   capStall                             per account of a game (its cap events, rated and void), and daily
 *   dodging                              after each missed ranked ready check
 *   parkedHigh                           daily, over the seasons closed since the last run
 * Reports only: nothing here writes the store, or bans, mutes, resets or changes a rating, a queue or a leaderboard.
 */
import { afterGame, afterMiss, daily } from './checker';
import { resolveAbuseRules } from './rules';
import type { AbuseChecker, AbuseRules } from './types';

export { ABUSE_RULES, resolveAbuseRules, type AbuseRuleName, type ResolvedAbuseRules } from './rules';

/**
 * The heuristics of 11.1 as an AbuseChecker (afterGame, afterMiss, daily); `rules` defaults to ABUSE_RULES, and a partial set overrides only the
 * thresholds it names (resolveAbuseRules: an unknown name or a value that is not a finite number of at least 0 throws a RangeError here, at wiring).
 * Reports only, never an action (D18). The checker keeps no state between calls: the same store and time give the same drafts.
 */
export function createAbuseChecker(rules?: Readonly<AbuseRules>): AbuseChecker {
  const resolved = resolveAbuseRules(rules);
  return Object.freeze({
    afterGame: (g, ctx) => afterGame(g, ctx, resolved),
    afterMiss: (account, misses, ctx) => afterMiss(account, misses, ctx, resolved),
    daily: (closedSeasons, ctx) => daily(closedSeasons, ctx, resolved),
  } satisfies AbuseChecker);
}
