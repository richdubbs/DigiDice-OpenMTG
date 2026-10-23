/**
 * M15-4: `RatedMatcher`, the ranked queue (design 9, 13.5, D14), created by `createRatedMatcher` (./index.ts). A queue per ladder, keyed by account,
 * in memory: after a restart it is empty and hosted sends m13's `queueLost` notice. Synchronous; it takes `now` (ms) everywhere and keeps no timers
 * (hosted's timer wheel calls `tick(now)` once a second).
 *
 * - `enter` checks, in this order: already queued in any ranked queue, by account or session (`inQueue`); `ctx.sessionBusy` (`atTable`: seated,
 *   waiting for capacity, or queued unranked, 9.7); `ctx.accountBusy` (`inRankedGame`); `perAddress` (2) entries from the address key in the ranked
 *   queues already (`address`); `ctx.cooldown` (`cooldown`, 8.6); the ladder unknown or not `ctx.offered` (`notOffered`). An entry that is not an
 *   entry (a missing field, a rating that is not a finite number) is a TypeError: `LadderService.entryFor` makes them, so that is a bug.
 * - `tick` goes through the ladders in LADDER_IDS order and, in each, through the waiting entries oldest first (enteredAt, then account id) as
 *   anchors: 1v1 by ./one.ts, pods by ./pods.ts. Matched entries leave the queue. Match ids come from `ctx.newMatchId()`, one per match in the
 *   order returned, after every match of the tick is chosen and before any entry leaves, so a throwing id source changes nothing.
 * - Block notes (9.4) are kept apart from the queues: matching or `requeueFront` does not drop them, so hosted may call `requeueFront` and
 *   `noteBlocks` in either order after a block found at match formation. `leave` and `missed` drop every note of that account, whether it was
 *   queued or not (a ready check's players are out of the queue). A successful `enter` drops the account's notes made up to the tick that last
 *   matched it (its previous time in the queue) and keeps those made since, so `entryFor`'s fresh pairs hold whether hosted notes them before or
 *   after `enter`; for this every note carries a sequence number, and a matched account that has notes keeps the number of its match.
 * - An entry put back by `requeueFront` was not checked against the entries that came in while it was out (`accounts(ladder)` lists the waiting
 *   entries only, 13.5): hosted's `blockedAmong` check of each formed match (9.4) catches such a pair. Hosted may also ask `blockedAmong` for
 *   the requeued accounts with `accounts(ladder)` and note the pairs; they hold whether it calls `noteBlocks` before or after `requeueFront`.
 * - `requeueFront` puts entries back with their own `enteredAt`, so they keep their place (oldest first) and their windows. It skips an account
 *   that is queued again already, and checks no limit: nobody loses their place (9.4, 9.5).
 * - `status`: m13's rounded count and an estimated wait from the players matched in the last 10 minutes (./status.ts). A match whose ready check
 *   fails still counts as matched.
 * - `tick` forms matches in every ladder that has entries; whether a ladder is offered is checked at `enter`.
 */
import type { AccountId } from '../accounts';
import { isLadderId, LADDER_IDS, LADDERS, type LadderId } from '../api';
import type { RankedEnterRefusal, RankedEntry, RankedMatch, RankedMatcher, RankedMatcherContext, RankedMatchPolicy } from './api';
import { pickPartner } from './one';
import { pickPod } from './pods';
import { byAge, byRating, live, type Live, type PairBase, type Slot } from './rules';
import { estimateQueueWaitMs, MATCH_RATE_WINDOW_MS, roundedWaiting } from './status';
import { cappedWindow, checkPolicy } from './window';

/** A ladder's pod sizes, largest first (pod-commander: 4, 3); empty for 1v1. */
function podSizes(ladder: LadderId): readonly number[] {
  return [...LADDERS[ladder].seats].filter((s) => s > 2).sort((a, b) => b - a);
}

function isPodLadder(ladder: LadderId): boolean {
  return podSizes(ladder).length > 0;
}

const STRING_FIELDS = ['account', 'session', 'addressKey', 'ladder', 'deck'] as const;
const NUMBER_FIELDS = ['enteredAt', 'rating', 'deviation'] as const;

/** The matcher's own copy of an entry (so a caller's later change reaches nothing), with its recent opponents as a set; a TypeError if malformed. */
function slotOf(e: RankedEntry, rematchGames: number): Slot {
  if (typeof e !== 'object' || e === null) throw new TypeError('rated matcher: an entry is not an object');
  for (const k of STRING_FIELDS) {
    if (typeof e[k] !== 'string' || e[k] === '') throw new TypeError(`rated matcher: entry.${k} must be a non-empty string (${String(e[k])})`);
  }
  for (const k of NUMBER_FIELDS) {
    if (typeof e[k] !== 'number' || !Number.isFinite(e[k])) throw new TypeError(`rated matcher: entry.${k} must be a finite number (${String(e[k])})`);
  }
  if (typeof e.placement !== 'boolean') throw new TypeError('rated matcher: entry.placement must be a boolean');
  const accounts = (g: unknown): boolean => Array.isArray(g) && g.every((a: unknown) => typeof a === 'string' && a !== '');
  if (!Array.isArray(e.recent) || !e.recent.every(accounts)) {
    throw new TypeError('rated matcher: entry.recent must be a list of account lists');
  }
  const entry: RankedEntry = {
    account: e.account,
    session: e.session,
    addressKey: e.addressKey,
    ladder: e.ladder,
    deck: e.deck,
    enteredAt: e.enteredAt,
    rating: e.rating,
    deviation: e.deviation,
    placement: e.placement,
    recent: e.recent.map((g) => [...g]),
  };
  return { entry, recent: new Set(entry.recent.slice(0, rematchGames).flat()) };
}

interface Formed {
  ladder: LadderId;
  members: Live[];
  spread: number;
  relaxed: boolean;
}

export class RatedMatcher implements RankedMatcher {
  readonly #ctx: RankedMatcherContext;
  readonly #p: Readonly<RankedMatchPolicy>;
  readonly #queues = new Map<LadderId, Map<AccountId, Slot>>();
  readonly #ladderOf = new Map<AccountId, LadderId>();
  readonly #sessions = new Map<string, AccountId>();
  readonly #perAddress = new Map<string, number>();
  /** Block notes, both ways: account → the other account → the sequence number of the pair's latest note. */
  readonly #blocks = new Map<AccountId, Map<AccountId, number>>();
  #noteSeq = 0;
  /** A matched account that had notes then: the last note sequence number at its match (a successful `enter` drops its notes up to it). */
  readonly #matchedAt = new Map<AccountId, number>();
  /** Per ladder: when matches formed and how many players they took, over the last MATCH_RATE_WINDOW_MS (status). */
  readonly #formed = new Map<LadderId, { at: number; players: number }[]>();

  constructor(ctx: RankedMatcherContext) {
    if (typeof ctx !== 'object' || ctx === null) throw new TypeError('rated matcher: the context is not an object');
    for (const k of ['sessionBusy', 'accountBusy', 'cooldown', 'offered', 'newMatchId'] as const) {
      if (typeof ctx[k] !== 'function') throw new TypeError(`rated matcher: context.${k} is not a function`);
    }
    this.#ctx = ctx;
    this.#p = checkPolicy(ctx.policy);
  }

  enter(e: RankedEntry, now: number): RankedEnterRefusal | null {
    const slot = slotOf(e, this.#p.rematchGames);
    const { account, session, addressKey, ladder } = slot.entry;
    if (this.#ladderOf.has(account) || this.#sessions.has(session)) return 'inQueue';
    if (this.#ctx.sessionBusy(session)) return 'atTable';
    if (this.#ctx.accountBusy(account)) return 'inRankedGame';
    if ((this.#perAddress.get(addressKey) ?? 0) >= this.#p.perAddress) return 'address';
    if (this.#ctx.cooldown(account, now)) return 'cooldown';
    if (!isLadderId(ladder) || !this.#ctx.offered(ladder)) return 'notOffered';
    // the notes of its previous time in the queue go; the ones since its last match (entryFor's, noted before enter) stay
    this.#dropBlocks(account, this.#matchedAt.get(account) ?? 0);
    this.#matchedAt.delete(account);
    this.#insert(slot);
    return null;
  }

  leave(account: AccountId): boolean {
    const had = this.#remove(account);
    this.#dropBlocks(account, Number.POSITIVE_INFINITY);
    this.#matchedAt.delete(account);
    return had;
  }

  tick(now: number): RankedMatch[] {
    for (const [ladder, log] of this.#formed) {
      const kept = log.filter((f) => f.at > now - MATCH_RATE_WINDOW_MS);
      if (kept.length === 0) this.#formed.delete(ladder);
      else this.#formed.set(ladder, kept);
    }
    const formed: Formed[] = [];
    for (const ladder of LADDER_IDS) {
      const q = this.#queues.get(ladder);
      if (q !== undefined && q.size >= 2) formed.push(...this.#form(ladder, q, now));
    }
    // ids first: a throwing id source leaves every entry queued
    const ids = formed.map(() => this.#ctx.newMatchId());
    return formed.map((f, i) => {
      for (const m of f.members) {
        this.#remove(m.account);
        if (this.#blocks.has(m.account)) this.#matchedAt.set(m.account, this.#noteSeq);
      }
      const log = this.#formed.get(f.ladder) ?? [];
      log.push({ at: now, players: f.members.length });
      this.#formed.set(f.ladder, log);
      return {
        match: ids[i]!,
        ladder: f.ladder,
        seats: f.members.length as 2 | 3 | 4,
        entries: f.members.map((m) => m.slot.entry),
        formedAt: now,
        spread: f.spread,
        relaxed: f.relaxed,
      };
    });
  }

  requeueFront(entries: readonly RankedEntry[], now: number): void {
    void now;
    const slots = entries.map((e) => {
      const s = slotOf(e, this.#p.rematchGames);
      if (!isLadderId(s.entry.ladder)) throw new TypeError(`rated matcher: requeueFront of an entry for no ladder (${s.entry.ladder})`);
      return s;
    });
    for (const s of slots) {
      if (this.#ladderOf.has(s.entry.account) || this.#sessions.has(s.entry.session)) continue;
      this.#insert(s);
    }
  }

  missed(account: AccountId, now: number): void {
    void now;
    this.#remove(account);
    this.#dropBlocks(account, Number.POSITIVE_INFINITY);
    this.#matchedAt.delete(account);
  }

  status(ladder: LadderId, now: number): { waiting: number; estimatedWaitMs: number | null } {
    if (!isLadderId(ladder)) return { waiting: 0, estimatedWaitMs: null };
    const waiting = this.#queues.get(ladder)?.size ?? 0;
    let matched = 0;
    for (const f of this.#formed.get(ladder) ?? []) if (f.at > now - MATCH_RATE_WINDOW_MS && f.at <= now) matched += f.players;
    return { waiting: roundedWaiting(waiting), estimatedWaitMs: estimateQueueWaitMs(waiting, matched) };
  }

  queued(account: AccountId): LadderId | null {
    return this.#ladderOf.get(account) ?? null;
  }

  accounts(ladder: LadderId): AccountId[] {
    const q = this.#queues.get(ladder);
    if (q === undefined) return [];
    return [...q.values()].map((s) => s.entry).sort(byAge).map((e) => e.account);
  }

  window(account: AccountId, now: number): number | 'everyone' | null {
    const ladder = this.#ladderOf.get(account);
    if (ladder === undefined) return null;
    const wait = now - this.#queues.get(ladder)!.get(account)!.entry.enteredAt;
    return wait >= this.#p.everyoneAfterMs ? 'everyone' : cappedWindow(wait, isPodLadder(ladder), this.#p);
  }

  noteBlocks(pairs: readonly (readonly [AccountId, AccountId])[]): void {
    for (const pair of pairs) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
        throw new TypeError('rated matcher: noteBlocks takes pairs of account ids');
      }
    }
    for (const [a, b] of pairs) {
      if (a === b) continue;
      const seq = ++this.#noteSeq;
      this.#note(a, b, seq);
      this.#note(b, a, seq);
    }
  }

  /** The matches one ladder's queue gives at `now`, without changing anything. */
  #form(ladder: LadderId, q: ReadonlyMap<AccountId, Slot>, now: number): Formed[] {
    const sizes = podSizes(ladder);
    const pod = sizes.length > 0;
    const all = [...q.values()].map((s) => live(s, now, pod, this.#p));
    const sorted = [...all].sort(byRating);
    const pos = new Map(sorted.map((l, i) => [l.account, i] as const));
    const base: PairBase = (a, b) => a.slot.entry.addressKey !== b.slot.entry.addressKey && !this.#blocked(a.account, b.account);
    const anyRelaxable = all.some((l) => l.relaxable);
    const taken = new Set<AccountId>();
    const out: Formed[] = [];
    for (const anchor of [...all].sort(byAge)) {
      if (taken.has(anchor.account)) continue;
      const at = pos.get(anchor.account)!;
      let f: Formed | null = null;
      if (pod) {
        const pick = pickPod(anchor, sorted, at, taken, base, this.#p, sizes, anyRelaxable);
        if (pick !== null) f = { ladder, members: pick.members, spread: pick.spread, relaxed: pick.relaxed };
      } else {
        const pick = pickPartner(anchor, sorted, at, taken, base, this.#p);
        if (pick !== null) f = { ladder, members: [anchor, pick.partner], spread: pick.distance, relaxed: pick.relaxed };
      }
      if (f === null) continue;
      for (const m of f.members) taken.add(m.account);
      out.push(f);
    }
    return out;
  }

  #insert(s: Slot): void {
    const { account, session, addressKey } = s.entry;
    const ladder = s.entry.ladder;
    let q = this.#queues.get(ladder);
    if (q === undefined) this.#queues.set(ladder, (q = new Map()));
    q.set(account, s);
    this.#ladderOf.set(account, ladder);
    this.#sessions.set(session, account);
    this.#perAddress.set(addressKey, (this.#perAddress.get(addressKey) ?? 0) + 1);
  }

  /** Takes the account's entry out of its queue; false when it had none. Its block notes stay. */
  #remove(account: AccountId): boolean {
    const ladder = this.#ladderOf.get(account);
    if (ladder === undefined) return false;
    const q = this.#queues.get(ladder)!;
    const s = q.get(account)!;
    q.delete(account);
    if (q.size === 0) this.#queues.delete(ladder);
    this.#ladderOf.delete(account);
    if (this.#sessions.get(s.entry.session) === account) this.#sessions.delete(s.entry.session);
    const n = (this.#perAddress.get(s.entry.addressKey) ?? 1) - 1;
    if (n > 0) this.#perAddress.set(s.entry.addressKey, n);
    else this.#perAddress.delete(s.entry.addressKey);
    return true;
  }

  #note(a: AccountId, b: AccountId, seq: number): void {
    let notes = this.#blocks.get(a);
    if (notes === undefined) this.#blocks.set(a, (notes = new Map()));
    notes.set(b, seq);
  }

  #blocked(a: AccountId, b: AccountId): boolean {
    return this.#blocks.get(a)?.has(b) ?? false;
  }

  /** Drops the account's notes whose sequence number is at most `upTo`, both ways. */
  #dropBlocks(account: AccountId, upTo: number): void {
    const partners = this.#blocks.get(account);
    if (partners === undefined) return;
    for (const [other, seq] of [...partners]) {
      if (seq > upTo) continue;
      partners.delete(other);
      const theirs = this.#blocks.get(other);
      if (theirs === undefined) continue;
      theirs.delete(account);
      if (theirs.size === 0) {
        this.#blocks.delete(other);
        this.#matchedAt.delete(other); // nothing left to drop at its next enter: every later note is newer than its match
      }
    }
    if (partners.size === 0) this.#blocks.delete(account);
  }
}
