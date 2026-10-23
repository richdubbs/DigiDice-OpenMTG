/**
 * `FifoMatcher`, the unranked quick match (design 4.5; package M13-9): a queue per format and table size (1v1, or a pod), in memory, first come first
 * matched. Synchronous; it takes `now` (ms) everywhere and keeps no timers: the gateway's timer wheel calls `tick(now)` (once a second), and may call
 * it at once after `enter` or `requeueFront` for a quicker start. After a restart it is empty: `drain()` hands the gateway the queued entries, so each
 * session gets its `queueLost` notice and queues again (its deck checked again).
 *
 * - `enter` checks, in this order: already queued in any queue (`inQueue`); `ctx.sessionBusy` (`atTable`); `perAddress` entries from the address key
 *   queued already (`address`); a missed-ready-check cooldown (`cooldown`); the queue not offered (`notOffered`: a key that is not a queue, a pod queue
 *   of a 1v1 format, `ctx.offered` false, a drain). The ranked matcher (packages/ladder, `RatedMatcher`) checks the same, in the same order.
 * - A queue is ordered by `enteredAt` (arrival order among equal times); an anchor is the oldest waiting entry, and it is matched with the oldest
 *   entries it may play: the first allowed partner (1v1), or the first allowed set of 3 (a pod of 4) or 2 (a pod of 3) after it. Entries are searched
 *   after the anchor only: an older entry that found nobody would not be in a later anchor's match either (every rule is symmetric). A tick forms every match
 *   due and returns them oldest first (the order they enter capacity admission's FIFO).
 * - **No immediate rematch**: two entries are a recent pair when either one's `recentOpponents` names the other's session. A recent pair is not
 *   matched while the anchor has anybody else it may play; when it has nobody, the pair (1v1) or the set (pod) is allowed once either one of the two
 *   has waited MORE than `rematchAfterMs`. In a pod every pair of its members counts.
 * - **Pods** fill to 4. An anchor that has waited `podThreeAfterMs` or more (`>=`: at 90 s a pod of 3 may start) forms a pod of 3 when no pod of 4 is
 *   possible for it. Tried in this order: 4 without a recent pair, 3 without one (once old enough), then 4 and 3 under the rematch relaxation. Never
 *   2 players: a pod queue only exists for the Free-for-All formats, and its smallest match is 3.
 * - **Limits**: `perAddress` queue entries per address key (two sessions of one address key may be matched with each other: the unranked queue has no
 *   rating to protect, and the ranked matcher's address rule is its own). A session that missed `missedChecks` ready checks within `missedWindowMs`
 *   cannot queue for `cooldownMs` (`missed`, `cooldownLeftMs`); every further miss within the window starts another cooldown.
 * - `requeueFront` puts confirmers of a failed ready check (or of a match capacity admission refused) back with their own `enteredAt`: they keep
 *   their waiting time, and so their place (ahead of everyone who came later, behind everyone older). It skips a session that is queued again, and
 *   checks no limit and not `sessionBusy` (the session was in the match; nobody loses their place).
 * - `status`: the rounded count, and an estimate from the players matched in the last 10 minutes (admission's `estimateWaitMs`); a match whose ready
 *   check fails still counts as matched (as in the ranked matcher). Never who waits.
 *
 * Disconnected sessions: `options.matchable` (the gateway's "this session has a connection") skips an entry that is not matchable for now; it keeps
 * its place, so a short drop loses nothing and nobody is matched with a player who cannot confirm. The gateway removes entries (`leave`) that stay
 * gone.
 */
import { estimateWaitMs } from '../admission/api';
import type { TableSize } from '../api';
import { METRICS, NULL_METRICS, type Metrics } from '../obs';
import {
  queueKeyString, roundedWaiting, type EnterRefusal, type Match, type MatchEntry, type MatchPolicy, type Matcher, type MatcherContext, type QueueKey,
} from './api';
import { isQueueKey } from './policy';

/** The window the match rate of `status` is taken over (design 4.6's 10 minutes). */
export const MATCH_RATE_WINDOW_MS = 10 * 60_000;

/** The most entries after an anchor that a pod is searched among (a bound on the search; the nearest allowed ones in the queue's order). */
const POD_CANDIDATES = 12;

/** The smallest pod (design 4.5: 3 after the wait); the biggest is `policy.podFill`. */
const POD_MIN = 3;

export interface FifoMatcherOptions {
  /** Where the matcher reports (`matchQueue`, `matchWaitSeconds`); default: nowhere. */
  metrics?: Metrics;
  /** Whether a queued session can be matched now (it has a connection). Default: every one can. */
  matchable?: (session: string) => boolean;
}

/** An entry as the queue keeps it: the matcher's own frozen copy, its recent opponents as a set, and its arrival number (below 0: put back to the front). */
interface Slot {
  entry: MatchEntry;
  recent: ReadonlySet<string>;
  seq: number;
}

interface Queue {
  key: QueueKey;
  /** By `enteredAt`, then `seq`. */
  slots: Slot[];
  /** The players matched, by instant, over the last MATCH_RATE_WINDOW_MS. */
  rate: RateWindow;
}

/** Players matched per instant, over the last MATCH_RATE_WINDOW_MS (`at` only goes up: the tick's `now`). */
class RateWindow {
  private log: { at: number; players: number }[] = [];
  private head = 0;
  private total = 0;

  add(at: number, players: number): void {
    this.log.push({ at, players });
    this.total += players;
  }

  /** The players matched in the window that ends at `now`. */
  sum(now: number): number {
    while (this.head < this.log.length && this.log[this.head]!.at <= now - MATCH_RATE_WINDOW_MS) this.total -= this.log[this.head++]!.players;
    if (this.head > 1024 && this.head > this.log.length / 2) {
      this.log = this.log.slice(this.head);
      this.head = 0;
    }
    return this.total;
  }
}

/** A session's missed ready checks: the instants within the window, and when its cooldown ends. */
interface Misses {
  at: number[];
  until: number;
}

/** `a` comes before `b` in a queue (older, or the same time and earlier). Total: `seq` is unique. */
function before(a: Slot, b: Slot): boolean {
  return a.entry.enteredAt < b.entry.enteredAt || (a.entry.enteredAt === b.entry.enteredAt && a.seq < b.seq);
}

/** The pair is a recent one: either one's last opponents name the other. */
function recent(a: Slot, b: Slot): boolean {
  return a.recent.has(b.entry.session) || b.recent.has(a.entry.session);
}

/** The matcher's own frozen copy of an entry; a TypeError if it is not one (the gateway builds them, so that is a bug). */
function slotOf(e: MatchEntry, seq: number): Slot {
  if (typeof e !== 'object' || e === null) throw new TypeError('matcher: an entry is not an object');
  for (const k of ['session', 'addressKey', 'deck'] as const) {
    if (typeof e[k] !== 'string' || e[k] === '') throw new TypeError(`matcher: entry.${k} must be a non-empty string (${String(e[k])})`);
  }
  if (typeof e.enteredAt !== 'number' || !Number.isFinite(e.enteredAt)) throw new TypeError(`matcher: entry.enteredAt must be a finite number (${String(e.enteredAt)})`);
  if (typeof e.key !== 'object' || e.key === null) throw new TypeError('matcher: entry.key is not an object');
  if (!Array.isArray(e.recentOpponents) || !e.recentOpponents.every((s: unknown) => typeof s === 'string')) {
    throw new TypeError('matcher: entry.recentOpponents must be a list of session ids');
  }
  const entry: MatchEntry = Object.freeze({
    session: e.session,
    addressKey: e.addressKey,
    key: Object.freeze({ format: e.key.format, size: e.key.size }),
    deck: e.deck,
    enteredAt: e.enteredAt,
    recentOpponents: Object.freeze([...e.recentOpponents]),
  });
  return { entry, recent: new Set(entry.recentOpponents), seq };
}

/** A copy of `p` once it makes sense; a RangeError naming the field otherwise. The matcher keeps the copy: a policy object changed later changes nothing. */
function checkPolicy(p: Readonly<MatchPolicy>): Readonly<MatchPolicy> {
  if (typeof p !== 'object' || p === null) throw new TypeError('matcher: the policy is not an object');
  if (p.podFill !== 4) throw new RangeError(`matcher: policy.podFill must be 4 (${String(p.podFill)})`);
  for (const k of ['podThreeAfterMs', 'rematchAfterMs', 'missedWindowMs', 'cooldownMs'] as const) {
    if (typeof p[k] !== 'number' || !Number.isFinite(p[k]) || p[k] < 0) throw new RangeError(`matcher: policy.${k} must be a finite number >= 0 (${String(p[k])})`);
  }
  for (const k of ['perAddress', 'missedChecks'] as const) {
    if (typeof p[k] !== 'number' || !Number.isInteger(p[k]) || p[k] < 1) throw new RangeError(`matcher: policy.${k} must be a whole number >= 1 (${String(p[k])})`);
  }
  return Object.freeze({ ...p });
}

/** The first set of `k` candidates (oldest first) in which every two are allowed together; null when there is none. Depth-first, so the oldest wins. */
function firstSet(cands: readonly Slot[], k: number, allowed: (a: Slot, b: Slot) => boolean): Slot[] | null {
  const chosen: Slot[] = [];
  const extend = (from: number): boolean => {
    if (chosen.length === k) return true;
    for (let i = from; i <= cands.length - (k - chosen.length); i++) {
      const c = cands[i]!;
      if (!chosen.every((x) => allowed(x, c))) continue;
      chosen.push(c);
      if (extend(i + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return extend(0) ? chosen : null;
}

export class FifoMatcher implements Matcher {
  private readonly ctx: MatcherContext;
  private readonly p: Readonly<MatchPolicy>;
  private readonly metrics: Metrics;
  private readonly matchable: (session: string) => boolean;
  private readonly queues = new Map<string, Queue>();
  /** Every queued session: its slot and queue (a session is in one queue at most). */
  private readonly bySession = new Map<string, { slot: Slot; queue: Queue }>();
  private readonly perAddress = new Map<string, number>();
  private readonly misses = new Map<string, Misses>();
  private arrivals = 0;
  private fronts = 0;
  private draining = false;

  constructor(ctx: MatcherContext, options: FifoMatcherOptions = {}) {
    if (typeof ctx !== 'object' || ctx === null) throw new TypeError('matcher: the context is not an object');
    for (const k of ['sessionBusy', 'offered'] as const) {
      if (typeof ctx[k] !== 'function') throw new TypeError(`matcher: context.${k} is not a function`);
    }
    this.ctx = ctx;
    this.p = checkPolicy(ctx.policy);
    this.metrics = options.metrics ?? NULL_METRICS;
    this.matchable = options.matchable ?? (() => true);
  }

  enter(e: MatchEntry, now: number): EnterRefusal | null {
    const slot = slotOf(e, ++this.arrivals);
    const { session, addressKey, key } = slot.entry;
    if (this.bySession.has(session)) return 'inQueue';
    if (this.ctx.sessionBusy(session)) return 'atTable';
    if ((this.perAddress.get(addressKey) ?? 0) >= this.p.perAddress) return 'address';
    if (this.cooldownLeftMs(session, now) > 0) return 'cooldown';
    if (this.draining || !isQueueKey(key) || !this.ctx.offered(key)) return 'notOffered';
    this.insert(slot);
    return null;
  }

  leave(session: string): boolean {
    const at = this.bySession.get(session);
    if (at === undefined) return false;
    this.take(at.queue, new Set([at.slot]));
    return true;
  }

  tick(now: number): Match[] {
    this.pruneMisses(now);
    if (this.draining) return [];
    const formed: { queue: Queue; members: Slot[] }[] = [];
    for (const queue of this.queues.values()) {
      const pod = queue.key.size !== 2;
      if (queue.slots.length < (pod ? POD_MIN : 2)) continue;
      // a session that sat down since it queued, or that has no connection now, waits (the first is a gateway fault, the second a short drop)
      const live = queue.slots.filter((s) => !this.ctx.sessionBusy(s.entry.session) && this.matchable(s.entry.session));
      for (const members of pod ? this.pods(live, now) : this.pairs(live, now)) formed.push({ queue, members });
    }
    formed.sort((a, b) => (before(a.members[0]!, b.members[0]!) ? -1 : 1));
    const gone = new Map<Queue, Set<Slot>>();
    const out = formed.map(({ queue, members }): Match => {
      let slots = gone.get(queue);
      if (slots === undefined) gone.set(queue, (slots = new Set()));
      for (const m of members) slots.add(m);
      queue.rate.add(now, members.length);
      const labels = { format: queue.key.format, size: String(queue.key.size) };
      for (const m of members) this.metrics.observe(METRICS.matchWaitSeconds, Math.max(0, now - m.entry.enteredAt) / 1_000, labels);
      return { key: { ...queue.key }, seats: members.length as TableSize, entries: members.map((m) => m.entry), formedAt: now };
    });
    for (const [queue, slots] of gone) this.take(queue, slots);
    return out;
  }

  requeueFront(entries: readonly MatchEntry[], now: number): void {
    void now;
    // the last of the batch first, so the batch keeps its order among equal times; every entry is checked before one goes in
    const slots = [...entries].reverse().map((e) => {
      const slot = slotOf(e, --this.fronts);
      if (!isQueueKey(slot.entry.key)) throw new TypeError(`matcher: requeueFront of an entry for no queue (${JSON.stringify(slot.entry.key)})`);
      return slot;
    });
    if (this.draining) return;
    for (const slot of slots) if (!this.bySession.has(slot.entry.session)) this.insert(slot);
  }

  missed(session: string, now: number): void {
    const at = this.bySession.get(session);
    if (at !== undefined) this.take(at.queue, new Set([at.slot]));
    const rec = this.misses.get(session) ?? { at: [], until: 0 };
    rec.at = rec.at.filter((t) => now - t <= this.p.missedWindowMs);
    rec.at.push(now);
    if (rec.at.length > this.p.missedChecks) rec.at.splice(0, rec.at.length - this.p.missedChecks);
    if (rec.at.length >= this.p.missedChecks) rec.until = Math.max(rec.until, now + this.p.cooldownMs);
    this.misses.set(session, rec);
  }

  status(key: QueueKey, now: number): { waiting: number; estimatedWaitMs: number | null } {
    const queue = isQueueKey(key) ? this.queues.get(queueKeyString(key)) : undefined;
    if (queue === undefined) return { waiting: 0, estimatedWaitMs: null };
    const waiting = queue.slots.length;
    // a player asking about an empty queue waits for one more player too
    return { waiting: roundedWaiting(waiting), estimatedWaitMs: estimateWaitMs(Math.max(1, waiting), queue.rate.sum(now), MATCH_RATE_WINDOW_MS) };
  }

  queued(session: string): QueueKey | null {
    const at = this.bySession.get(session);
    return at === undefined ? null : { ...at.queue.key };
  }

  /** How long the session may not queue yet (0: it may); the gateway sends it as the refusal's `retryAfterMs`. */
  cooldownLeftMs(session: string, now: number): number {
    return Math.max(0, (this.misses.get(session)?.until ?? 0) - now);
  }

  /**
   * Stops matching and empties every queue (a drain, design 2.3: no new queue entries): the entries that were queued, oldest first, so the gateway
   * sends each session a `queueLost` notice. From then on `enter` says `notOffered` and `tick` forms nothing.
   */
  drain(): MatchEntry[] {
    this.draining = true;
    const lost = [...this.bySession.values()].map((s) => s.slot).sort((a, b) => (before(a, b) ? -1 : 1));
    for (const queue of this.queues.values()) this.take(queue, new Set(queue.slots));
    return lost.map((s) => s.entry);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------
  // Matching

  /** The 1v1 matches of `live` (oldest first) at `now`: each anchor and its first allowed partner after it. */
  private pairs(live: readonly Slot[], now: number): Slot[][] {
    const out: Slot[][] = [];
    const taken = new Set<Slot>();
    for (let i = 0; i < live.length; i++) {
      const a = live[i]!;
      if (taken.has(a)) continue;
      let fresh: Slot | null = null;
      let rematch: Slot | null = null;
      for (let j = i + 1; j < live.length && fresh === null; j++) {
        const b = live[j]!;
        if (taken.has(b)) continue;
        if (!recent(a, b)) fresh = b;
        else if (rematch === null && this.mayRematch(a, b, now)) rematch = b;
      }
      const partner = fresh ?? rematch;
      if (partner === null) continue;
      taken.add(a);
      taken.add(partner);
      out.push([a, partner]);
    }
    return out;
  }

  /** The pods of `live` (oldest first) at `now`. */
  private pods(live: readonly Slot[], now: number): Slot[][] {
    const out: Slot[][] = [];
    const taken = new Set<Slot>();
    // the relaxation matters only once somebody has waited past the rematch wait; the queue's oldest entry is the first
    const relaxable = live.length > 0 && now - live[0]!.entry.enteredAt > this.p.rematchAfterMs;
    for (let i = 0; i < live.length; i++) {
      const anchor = live[i]!;
      if (taken.has(anchor)) continue;
      const members = this.podOf(anchor, live, i + 1, taken, now, relaxable);
      if (members === null) continue;
      for (const m of members) taken.add(m);
      out.push(members);
    }
    return out;
  }

  /**
   * The pod of `anchor` among the entries of `live` from `from` on that are not `taken`, or null: 4 without a recent pair, 3 without one (when the
   * anchor has waited `podThreeAfterMs`), then 4 and 3 under the rematch relaxation (only `relaxable`).
   */
  private podOf(anchor: Slot, live: readonly Slot[], from: number, taken: ReadonlySet<Slot>, now: number, relaxable: boolean): Slot[] | null {
    const sizes = now - anchor.entry.enteredAt >= this.p.podThreeAfterMs ? [this.p.podFill, POD_MIN] : [this.p.podFill];
    for (const relax of relaxable ? [false, true] : [false]) {
      const allowed = (a: Slot, b: Slot): boolean => !recent(a, b) || (relax && this.mayRematch(a, b, now));
      const cands: Slot[] = [];
      for (let j = from; j < live.length && cands.length < POD_CANDIDATES; j++) {
        const c = live[j]!;
        if (!taken.has(c) && allowed(anchor, c)) cands.push(c);
      }
      for (const size of sizes) {
        const rest = firstSet(cands, size - 1, allowed);
        if (rest !== null) return [anchor, ...rest];
      }
    }
    return null;
  }

  /** A recent pair may be matched again once either one has waited more than `rematchAfterMs`. */
  private mayRematch(a: Slot, b: Slot, now: number): boolean {
    return now - a.entry.enteredAt > this.p.rematchAfterMs || now - b.entry.enteredAt > this.p.rematchAfterMs;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------
  // The queues

  private insert(slot: Slot): void {
    const { session, addressKey, key } = slot.entry;
    const ks = queueKeyString(key);
    let queue = this.queues.get(ks);
    if (queue === undefined) this.queues.set(ks, (queue = { key: { ...key }, slots: [], rate: new RateWindow() }));
    // new entries come last in nearly every case; one put back to the front is found from the end
    let i = queue.slots.length;
    while (i > 0 && before(slot, queue.slots[i - 1]!)) i--;
    queue.slots.splice(i, 0, slot);
    this.bySession.set(session, { slot, queue });
    this.perAddress.set(addressKey, (this.perAddress.get(addressKey) ?? 0) + 1);
    this.gauge(queue);
  }

  /** Takes these slots out of the queue and out of the indexes. */
  private take(queue: Queue, gone: ReadonlySet<Slot>): void {
    if (gone.size === 0) return;
    queue.slots = queue.slots.filter((s) => !gone.has(s));
    for (const s of gone) {
      this.bySession.delete(s.entry.session);
      const n = (this.perAddress.get(s.entry.addressKey) ?? 1) - 1;
      if (n > 0) this.perAddress.set(s.entry.addressKey, n);
      else this.perAddress.delete(s.entry.addressKey);
    }
    this.gauge(queue);
  }

  private gauge(queue: Queue): void {
    this.metrics.set(METRICS.matchQueue, queue.slots.length, { format: queue.key.format, size: String(queue.key.size) });
  }

  /** Forgets the sessions whose misses are all outside the window and whose cooldown has ended (the map stays as small as the trouble). */
  private pruneMisses(now: number): void {
    for (const [session, rec] of this.misses) {
      rec.at = rec.at.filter((t) => now - t <= this.p.missedWindowMs);
      if (rec.at.length === 0 && rec.until <= now) this.misses.delete(session);
    }
  }
}
