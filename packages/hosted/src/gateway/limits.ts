/**
 * The gateway's abuse limits (design 3.2, 3.6, 11; review 5, 12), all on a clock passed in (milliseconds), so tests drive them with a fake clock and
 * fixed inputs (no floods: the owner rule).
 *
 * - `KeyBuckets`: one token bucket per key (an address key, a session), and NO bucket shared by every key: a few addresses can never use up a limit for
 *   everyone (review 5). The map is bounded: buckets that are full again are forgotten first.
 * - `JoinGuard`: join attempts (invite codes and passwords) per session AND per address key, 1/s with a burst of 5; 10 failed attempts within 10
 *   minutes lock joining for that session and that address key for 10 minutes.
 * - `SessionGuard`: new sessions per address key (5 a minute, burst 10); the global session rate (`SESSION_RATE`) is backpressure only: past it, new
 *   sessions are refused only for address keys that created more than 2 in the last 10 minutes; everyone else still gets one.
 * - `SocketGuard`: open sockets per address key (8), new sockets per address key (1/s, burst 10), and `MAX_CONNECTIONS` in all.
 * - **IPv6 aggregates** (config.ts `ADDRESS_AGGREGATE`): the sockets, new sockets, new sessions and join attempts of a /48 are limited too, at 16 times a /64's.
 */
import { TokenBucket, type RateConfig } from '@openmtg/net/server-kit';
import { ADDRESS_AGGREGATE, ADDRESS_LIMITS } from '../config';
import { aggregateKey } from './address';

export class KeyBuckets {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly config: RateConfig, private readonly maxKeys = 65_536) {}

  take(key: string, now: number): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.prune(now);
      b = new TokenBucket(this.config, now);
      this.buckets.set(key, b);
    }
    return b.take(now);
  }

  /** Milliseconds until `key` has a token again (0: now). */
  wait(key: string, now: number): number {
    return this.buckets.get(key)?.wait(now) ?? 0;
  }

  prune(now: number): void {
    for (const [k, b] of this.buckets) if (b.full(now)) this.buckets.delete(k);
    // Still full of active keys: the oldest half goes (a key forgotten early only gets a fresh burst; no key is ever refused for others' use).
    if (this.buckets.size >= this.maxKeys) {
      let n = Math.floor(this.buckets.size / 2);
      for (const k of this.buckets.keys()) {
        if (n-- <= 0) break;
        this.buckets.delete(k);
      }
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Timestamps within a sliding window, per key (bounded). */
class Window {
  private readonly times = new Map<string, number[]>();
  constructor(private readonly windowMs: number, private readonly maxKeys = 65_536) {}

  add(key: string, now: number): number {
    const list = this.recent(key, now);
    list.push(now);
    this.times.set(key, list);
    if (this.times.size > this.maxKeys) this.prune(now);
    return list.length;
  }

  count(key: string, now: number): number {
    const list = this.recent(key, now);
    if (list.length === 0) this.times.delete(key);
    else this.times.set(key, list);
    return list.length;
  }

  private recent(key: string, now: number): number[] {
    return (this.times.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }

  prune(now: number): void {
    for (const k of [...this.times.keys()]) this.count(k, now);
  }
}

export type JoinRefusal = 'locked' | 'rate';

/** Locks kept before the ended ones are swept out. */
const MAX_LOCKS = 4_096;

export class JoinGuard {
  private readonly attempts = new KeyBuckets(ADDRESS_LIMITS.joinAttempts);
  private readonly aggregateAttempts = new KeyBuckets(ADDRESS_AGGREGATE.joinAttempts);
  private readonly failures = new Window(ADDRESS_LIMITS.joinFailureWindowMs);
  private readonly locked = new Map<string, number>();

  /** Before a join attempt by code or password: refused while the session or the address key is locked, or past the attempt rate. */
  check(session: string, key: string, now: number): JoinRefusal | null {
    const agg = aggregateKey(key);
    for (const k of agg ? [`s:${session}`, `a:${key}`, `g:${agg}`] : [`s:${session}`, `a:${key}`]) {
      const until = this.locked.get(k);
      if (until !== undefined) {
        if (now < until) return 'locked';
        this.locked.delete(k);
      }
    }
    const a = this.attempts.take(`s:${session}`, now);
    const b = this.attempts.take(`a:${key}`, now);
    const c = agg ? this.aggregateAttempts.take(agg, now) : true;
    return a && b && c ? null : 'rate';
  }

  /** A failed attempt (a wrong code or password): the 10th within 10 minutes locks the session and the address key for 10 minutes. */
  fail(session: string, key: string, now: number): boolean {
    let lockedNow = false;
    for (const k of [`s:${session}`, `a:${key}`]) {
      if (this.failures.add(k, now) >= ADDRESS_LIMITS.joinFailures) {
        this.locked.set(k, now + ADDRESS_LIMITS.joinLockMs);
        lockedNow = true;
      }
    }
    const agg = aggregateKey(key);
    if (agg && this.failures.add(`g:${agg}`, now) >= ADDRESS_AGGREGATE.joinFailures) {
      this.locked.set(`g:${agg}`, now + ADDRESS_LIMITS.joinLockMs);
      lockedNow = true;
    }
    if (lockedNow && this.locked.size > MAX_LOCKS) this.pruneLocks(now);
    return lockedNow;
  }

  /** Locks in force (tests). */
  get locks(): number {
    return this.locked.size;
  }

  /** Locks that ended are forgotten (a lock is otherwise dropped only when its key tries again, and a session may never come back). */
  private pruneLocks(now: number): void {
    for (const [k, until] of this.locked) if (until <= now) this.locked.delete(k);
  }

  /** Milliseconds until the session or the address key may join again (0: now). */
  lockedFor(session: string, key: string, now: number): number {
    let ms = 0;
    const agg = aggregateKey(key);
    for (const k of agg ? [`s:${session}`, `a:${key}`, `g:${agg}`] : [`s:${session}`, `a:${key}`]) {
      const until = this.locked.get(k);
      if (until !== undefined && until > now) ms = Math.max(ms, until - now);
    }
    return ms;
  }
}

export class SessionGuard {
  private readonly perKey = new KeyBuckets(ADDRESS_LIMITS.newSessions);
  private readonly perAggregate = new KeyBuckets(ADDRESS_AGGREGATE.newSessions);
  private readonly heavy = new Window(ADDRESS_LIMITS.heavyWindowMs);
  private readonly global = new Window(60_000, 1);

  constructor(private readonly sessionRate: number) {}

  /** May `key` create a new session now? Records it when yes. */
  allow(key: string, now: number): boolean {
    if (!this.perKey.take(key, now)) return false;
    const agg = aggregateKey(key);
    if (agg && !this.perAggregate.take(agg, now)) return false;
    const busy = this.global.count('*', now) >= this.sessionRate;
    if (busy && this.heavy.count(key, now) > ADDRESS_LIMITS.heavySessions) return false;
    this.global.add('*', now);
    this.heavy.add(key, now);
    return true;
  }
}

export type SocketRefusal = 'connections' | 'sockets';

export class SocketGuard {
  private readonly open = new Map<string, number>();
  private readonly fresh = new KeyBuckets(ADDRESS_LIMITS.newSockets);
  private readonly freshAggregate = new KeyBuckets(ADDRESS_AGGREGATE.newSockets);
  private total = 0;

  constructor(private readonly maxConnections: number) {}

  /** A new socket from `key`: refused past MAX_CONNECTIONS, 8 open sockets of the key, or the key's new-socket rate. Counts it when admitted. */
  admit(key: string, now: number): SocketRefusal | null {
    if (this.total >= this.maxConnections) return 'connections';
    if ((this.open.get(key) ?? 0) >= ADDRESS_LIMITS.openSockets) return 'sockets';
    const agg = aggregateKey(key);
    if (agg && (this.open.get(agg) ?? 0) >= ADDRESS_AGGREGATE.openSockets) return 'sockets';
    if (!this.fresh.take(key, now)) return 'sockets';
    if (agg && !this.freshAggregate.take(agg, now)) return 'sockets';
    this.open.set(key, (this.open.get(key) ?? 0) + 1);
    if (agg) this.open.set(agg, (this.open.get(agg) ?? 0) + 1);
    this.total++;
    return null;
  }

  /** The socket closed. */
  release(key: string): void {
    for (const k of [key, aggregateKey(key)]) {
      if (k === null) continue;
      const n = (this.open.get(k) ?? 0) - 1;
      if (n <= 0) this.open.delete(k);
      else this.open.set(k, n);
    }
    this.total = Math.max(0, this.total - 1);
  }

  get connections(): number {
    return this.total;
  }
}
