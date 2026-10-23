/**
 * Matchmaking's contract (design 4.5). Milestone 13 builds the unranked quick match (`FifoMatcher`, M13-9); the rated matcher of milestone 15 implements
 * the same interface. The queues live in memory (after a restart they are empty; queued clients get a `queueLost` notice and re-queue).
 *
 * - Queues per format and table size: 1v1 for every hosted format; pods (`'pod'`) for Commander, Brawl and Standard Brawl with `PODS_ENABLED`.
 * - A session is in at most one queue and not at a table at the same time (D6); at most 2 queue entries per address key.
 * - First come, first matched; no immediate rematch (unless one has waited more than 60 s and nobody else fits); pods fill to 4 and start with 3 after
 *   90 s; never a 2-player match from a pod queue.
 * - A match goes through capacity admission, then one ready check (15 s): confirmers go back to the **front** with their waiting time kept; those who did
 *   not confirm leave the queue (two missed ready checks within 10 minutes: no queuing for 2 minutes).
 * - `queueStatus` shows how many wait (rounded: `roundedWaiting`) and an estimate, never who.
 */
import type { HostedFormatId, QueueSize, TableSize } from '../api';

export interface QueueKey {
  format: HostedFormatId;
  size: QueueSize;
}

/** A queue's key as a string ("commander/pod", "pauper/2"). */
export function queueKeyString(k: QueueKey): string {
  return `${k.format}/${k.size}`;
}

export interface MatchEntry {
  session: string;
  addressKey: string;
  key: QueueKey;
  /** The deck pool's result for this entry (an opaque handle of the prepared, checked deck). */
  deck: string;
  /** When it entered (server time, ms). A confirmer sent back to the front keeps its original time. */
  enteredAt: number;
  /** The sessions it played last (no immediate rematch). */
  recentOpponents: readonly string[];
}

export interface Match {
  key: QueueKey;
  seats: TableSize;
  /** In the order they were matched (the table shuffles the seating with its seed for 3-4 seats: M12 D2). */
  entries: MatchEntry[];
  formedAt: number;
}

/**
 * Why `enter` refused: already queued; seated at a table or waiting for capacity ('atTable': the matcher asks `MatcherContext.sessionBusy`, so it
 * never holds a session that takes part in a game, D6); the address key's 2 entries are used; a missed-ready-check cooldown; the queue is not offered
 * (a pod queue with pods off, a format this server does not host).
 */
export type EnterRefusal = 'inQueue' | 'atTable' | 'address' | 'cooldown' | 'notOffered';

/**
 * What a matcher implementation is given at construction (M13-9): the session lookup it cannot know itself. The gateway (M13-6) also checks table
 * membership before it calls `enter`; the lookup makes the matcher safe on its own (a session that sat down between the two checks).
 */
export interface MatcherContext {
  /** True while the session is seated at a table or has a start waiting for capacity. */
  sessionBusy(session: string): boolean;
  /** Whether this server offers the queue (its formats, `PODS_ENABLED`). */
  offered(key: QueueKey): boolean;
  policy: Readonly<MatchPolicy>;
}

export interface MatchPolicy {
  /** Pods fill to 4 and start with 3 after this wait (90 s; configurable). */
  podFill: 4;
  podThreeAfterMs: number;
  /** Two sessions that just played each other are matched again only when one has waited longer than this (60 s) and nobody else fits. */
  rematchAfterMs: number;
  perAddress: number;
  /** Two missed ready checks within 10 minutes: no queuing for 2 minutes. */
  missedChecks: number;
  missedWindowMs: number;
  cooldownMs: number;
}

export const DEFAULT_MATCH_POLICY: Readonly<MatchPolicy> = {
  podFill: 4,
  podThreeAfterMs: 90_000,
  rematchAfterMs: 60_000,
  perAddress: 2,
  missedChecks: 2,
  missedWindowMs: 10 * 60_000,
  cooldownMs: 2 * 60_000,
};

export interface Matcher {
  /** Enter a queue (the deck checked already); null when entered, else why not. */
  enter(e: MatchEntry, now: number): EnterRefusal | null;
  /** Leave the queue (`unqueue`, a closed session). False when the session was not queued. */
  leave(session: string): boolean;
  /** Form the matches due now (the timer wheel calls it). The matched entries leave the queue. */
  tick(now: number): Match[];
  /** Put confirmers of a failed ready check (or of a match refused by admission) back at the front, their waiting time kept. */
  requeueFront(entries: readonly MatchEntry[], now: number): void;
  /** A session missed a ready check (two within the window: a cooldown). */
  missed(session: string, now: number): void;
  /** How many wait in a queue (rounded) and the estimated wait from the recent match rate. */
  status(key: QueueKey, now: number): { waiting: number; estimatedWaitMs: number | null };
  queued(session: string): QueueKey | null;
}

/** The count shown to players (never exact past a few, never who): 0-5 as they are, then to the nearest 5 up to 50, then to the nearest 10. */
export function roundedWaiting(n: number): number {
  if (n <= 5) return Math.max(0, n);
  if (n <= 50) return Math.round(n / 5) * 5;
  return Math.round(n / 10) * 10;
}
