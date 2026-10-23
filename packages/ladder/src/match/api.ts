/**
 * The ranked queue's contract (design 9, 13.5, D14). Server only. M15-4 builds `RatedMatcher` (src/match/rated.ts, created by `createRatedMatcher`
 * in src/match/index.ts). It is its own interface beside m13's `Matcher`, driven by its own gateway path (9.7): only the timer wheel's tick is
 * shared. The matcher takes `now` (ms) as an argument everywhere, keeps no timers, and with the same entries, the same `now` and the same id source
 * returns deeply equal matches in the same order (9.6).
 */
import type { AccountId } from '../accounts';
import type { LadderId } from '../api';

export interface RankedEntry {
  account: AccountId;
  session: string;
  addressKey: string;
  ladder: LadderId;
  /** The deck pool's handle of the checked deck (m13). */
  deck: string;
  enteredAt: number;
  /** Shown points (6.1), from ratingNow at entry. */
  rating: number;
  deviation: number;
  placement: boolean;
  /** Opponents of the last 3 rated games in the ladder, newest first (9.4). */
  recent: readonly (readonly AccountId[])[];
}

export interface RankedMatch {
  /** From RankedMatcherContext.newMatchId() (9.6). */
  match: string;
  ladder: LadderId;
  seats: 2 | 3 | 4;
  /** The anchor first, then by rating. The table shuffles the seating with its seed (m13 2.4). */
  entries: RankedEntry[];
  formedAt: number;
  spread: number;
  /** Formed under the rematch relaxation or the everyone window (9.2, 9.4). */
  relaxed: boolean;
}

export type RankedEnterRefusal = 'inQueue' | 'atTable' | 'inRankedGame' | 'address' | 'cooldown' | 'notOffered';

export interface RankedMatchPolicy {
  windowStart: number;
  windowStep: number;
  windowEveryMs: number;
  windowCap1v1: number;
  windowCapPod: number;
  everyoneAfterMs: number;
  rematchGames: number;
  rematchRelaxMs: number;
  placementMixCost: number;
  repeatedPairCost: number;
  podThreeAfterMs: number;
  podCandidates: number;
  perAddress: number;
}

/** Landed with its values by M15-1 (9.2-9.5, 19.9). Frozen: a test or a server passes its own policy object instead of editing this one. */
export const DEFAULT_RANKED_POLICY: Readonly<RankedMatchPolicy> = Object.freeze({
  windowStart: 100,
  windowStep: 50,
  windowEveryMs: 15_000,
  windowCap1v1: 400,
  windowCapPod: 500,
  everyoneAfterMs: 300_000,
  rematchGames: 3,
  rematchRelaxMs: 600_000,
  placementMixCost: 50,
  repeatedPairCost: 100,
  podThreeAfterMs: 120_000,
  podCandidates: 12,
  perAddress: 2,
});

export interface RankedMatcherContext {
  /** Seated, waiting for capacity, or queued in EITHER matcher (hosted's, 9.7). */
  sessionBusy(session: string): boolean;
  /** A running ranked registry entry (D9): LadderService.accountBusy. */
  accountBusy(account: AccountId): boolean;
  /** A ranked-queue cooldown at `now`: LadderService.cooldownUntil. */
  cooldown(account: AccountId, now: number): boolean;
  offered(ladder: LadderId): boolean;
  /** The id of the next RankedMatch; tests pass a counter, so tick's output is deterministic (9.6). */
  newMatchId(): string;
  policy: Readonly<RankedMatchPolicy>;
}

export interface RankedMatcher {
  enter(e: RankedEntry, now: number): RankedEnterRefusal | null;
  leave(account: AccountId): boolean;
  /** The matches due now, in a deterministic order; matched entries leave the queue. */
  tick(now: number): RankedMatch[];
  requeueFront(entries: readonly RankedEntry[], now: number): void;
  /** Drops the entry; cooldowns are the service's (8.6). */
  missed(account: AccountId, now: number): void;
  status(ladder: LadderId, now: number): { waiting: number; estimatedWaitMs: number | null };
  queued(account: AccountId): LadderId | null;
  /** The accounts waiting in a ladder's queue, oldest first (for entryFor's block check, 9.4). */
  accounts(ladder: LadderId): AccountId[];
  /** The entry's current window in shown points; 'everyone' after 5 minutes; null when not queued. */
  window(account: AccountId, now: number): number | 'everyone' | null;
  /** Blocked pairs (m14 9.1): never matched; kept until either account leaves, misses or enters again (9.4). */
  noteBlocks(pairs: readonly (readonly [AccountId, AccountId])[]): void;
}
