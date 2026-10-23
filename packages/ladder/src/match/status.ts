/**
 * M15-4: what `status(ladder)` tells a player (design 9.5): how many wait, rounded, and an estimated wait from the ladder's recent match rate. Never
 * who waits. Pure.
 *
 * `roundedWaiting` is a copy of m13's (`hosted/src/match/api.ts`), because the ladder never imports packages/hosted (D1); the estimate follows m13's
 * capacity estimate (`estimateWaitMs`, m13 4.6): the people waiting over the people the ladder matched in the last 10 minutes, times 10 minutes.
 */

/** The window the match rate is taken over (m13 4.6's 10 minutes). */
export const MATCH_RATE_WINDOW_MS = 10 * 60_000;

/** The count shown to players (never exact past a few, never who): 0-5 as they are, then to the nearest 5 up to 50, then to the nearest 10 (m13). */
export function roundedWaiting(n: number): number {
  if (n <= 5) return Math.max(0, n);
  if (n <= 50) return Math.round(n / 5) * 5;
  return Math.round(n / 10) * 10;
}

/**
 * The estimated wait in ms (Little's law on the recent rate): ceil(max(1, waiting) / matchedPlayers · windowMs), where `matchedPlayers` is the
 * number of entries the ladder put into matches in the last `windowMs`; null when it put none there (no estimate). `waiting` counts at least 1: a
 * player asking about an empty queue waits for one more player too.
 */
export function estimateQueueWaitMs(waiting: number, matchedPlayers: number, windowMs = MATCH_RATE_WINDOW_MS): number | null {
  if (!(matchedPlayers > 0)) return null;
  return Math.ceil((Math.max(1, waiting) / matchedPlayers) * windowMs);
}
