/**
 * What happens to a match after the matcher forms it (design 4.5, 4.6; package M13-9): capacity admission is asked for its start, then one ready check
 * (15 s) runs, and a check that fails sends the players back to their queue. The gateway (M13-6) owns the table, the sockets and the timers; this file
 * is the pure part, driven by `now`, so the rules are in one place:
 *
 * - `matchStartRequest`: the `StartRequest` for admission (units from the seats, the sessions and their address keys).
 * - `MatchReadyCheck`: who has confirmed, the deadline, and the outcome. Everyone confirms before the deadline: the game starts. The deadline passes:
 *   the confirmers go back to the front of their queue, the others leave it with a miss (`reason: 'timeout'`). A seat leaves during the check (`unqueue`,
 *   `leave`, a closed session): the check fails at once, the leaver gets the miss and everyone else, confirmed or not, goes back (`reason: 'left'`:
 *   nobody is blamed for another player's leaving).
 * - `settleReadyCheck`: applies a failed outcome to the matcher (`missed`, then `requeueFront`). It does not count the failure: capacity admission owns the
 *   `readyCheckFailures` metric (M13-10 review: counted twice before); the gateway calls `admission.released(table, now, cause)` with cause 'readyCheck'
 *   for a failed outcome of reason 'timeout' and 'left' for one of reason 'left'.
 *
 * Not here: a match admission refuses (`serverBusy`, draining), a start that waited too long for capacity, or a player who leaves while it waits for
 * capacity (no ready check has been shown, so no miss): the gateway calls `requeueFront` with the entries that stay.
 *
 * Same-instant rule (as the clocks): a `ready` or leave stamped at the deadline counts if it is handled before the tick of that instant; `poll(now)`
 * at or past the deadline decides the check, and a late `confirm` after it is refused.
 */
import { capacityUnits, type StartRequest, type UnitWeights } from '../admission/api';
import { HOSTED_TIMING } from '../api';
import type { Metrics } from '../obs';
import type { Match, MatchEntry, Matcher } from './api';

/** The start request admission is asked for a match: `table` is the matched table's id, `now` when the start became waiting. */
export function matchStartRequest(match: Match, table: string, now: number, weights?: Readonly<UnitWeights>): StartRequest {
  return {
    table,
    source: 'matched',
    seats: match.seats,
    units: capacityUnits(match.seats, weights),
    sessions: match.entries.map((e) => e.session),
    addressKeys: match.entries.map((e) => e.addressKey),
    since: now,
  };
}

/** How a ready check ended: the game starts, or it failed (who goes back to the queue, who missed). */
export type ReadyOutcome =
  | { kind: 'start' }
  | { kind: 'failed'; reason: 'timeout' | 'left'; requeue: MatchEntry[]; missed: MatchEntry[] };

export class MatchReadyCheck {
  readonly deadlineAt: number;
  private readonly confirmed = new Set<string>();
  private readonly left = new Set<string>();
  private done: ReadyOutcome | null = null;

  /** `startedAt`: when the check began (after admission); `durationMs`: 15 s for a match (`HOSTED_TIMING.readyCheckMatchMs`). */
  constructor(readonly match: Match, startedAt: number, durationMs: number = HOSTED_TIMING.readyCheckMatchMs) {
    this.deadlineAt = startedAt + durationMs;
  }

  /** The seats' sessions in match order and whether each has confirmed (the gateway adds the seat numbers and names for `readyCheck`). */
  players(): { session: string; ready: boolean }[] {
    return this.match.entries.map((e) => ({ session: e.session, ready: this.confirmed.has(e.session) }));
  }

  /** A seat confirmed (`ready`). False when it did not count: not a seat of this match, the check is decided, or the deadline has passed. */
  confirm(session: string, now: number): boolean {
    if (this.done !== null || !this.isSeat(session)) return false;
    if (now > this.deadlineAt) {
      this.poll(now);
      return false;
    }
    this.confirmed.add(session);
    if (this.match.entries.every((e) => this.confirmed.has(e.session))) this.done = { kind: 'start' };
    return true;
  }

  /** A seat left during the check: it fails at once. False when it did not count (not a seat, decided already, or past the deadline: then it timed out). */
  leave(session: string, now: number): boolean {
    if (this.done !== null || !this.isSeat(session)) return false;
    if (now > this.deadlineAt) {
      this.poll(now);
      return false;
    }
    this.left.add(session);
    this.done = {
      kind: 'failed',
      reason: 'left',
      requeue: this.match.entries.filter((e) => !this.left.has(e.session)),
      missed: this.match.entries.filter((e) => this.left.has(e.session)),
    };
    return true;
  }

  /** The outcome, or null while the check is open; at or past the deadline an open check fails (the confirmers go back, the others missed). */
  poll(now: number): ReadyOutcome | null {
    if (this.done === null && now >= this.deadlineAt) {
      this.done = {
        kind: 'failed',
        reason: 'timeout',
        requeue: this.match.entries.filter((e) => this.confirmed.has(e.session)),
        missed: this.match.entries.filter((e) => !this.confirmed.has(e.session)),
      };
    }
    return this.done;
  }

  private isSeat(session: string): boolean {
    return this.match.entries.some((e) => e.session === session);
  }
}

/**
 * Applies a failed ready check to the matcher (design 4.5): the sessions that missed it leave the queue and the miss is recorded (two within 10
 * minutes: a cooldown), the others go back to the front with their waiting time kept. A check that started changes nothing here. `_metrics` is ignored (kept
 * so callers that still pass it compile): the failure is counted by `Admission.released`.
 */
export function settleReadyCheck(matcher: Matcher, outcome: ReadyOutcome, now: number, _metrics?: Metrics): void {
  if (outcome.kind !== 'failed') return;
  for (const e of outcome.missed) matcher.missed(e.session, now);
  matcher.requeueFront(outcome.requeue, now);
}
