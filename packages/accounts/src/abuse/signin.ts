/**
 * M14-5: the sign-in guard of design 8.2 (rules 1, 2, 3, 5 and 6, and rule 4 for recovery codes), the registration pressure of 8.1, and the hashing
 * classes of 4.1. In memory: a restart resets every counter here (rule 2's own counter is DeviceRow.failures, in the store, which the service keeps).
 *
 * `before(attempt)` runs before any hash and takes nothing unless it answers `go`; `after(attempt, ok)` records the outcome. In order:
 *
 * - **Recovery codes** (kind 'recover'): only the per-address limit (rule 4: recoveryFailuresPerHour an hour per address key, with the IPv6
 *   aggregates), whether or not the attempt carries a device proof; never a per-name, per-account or per-device rule. The attempt takes its token
 *   when it is let through, before the code is checked, so concurrent attempts cannot all pass one check; a success leaves it spent (the copied
 *   bucket has no refund), so the limit counts the attempts that got as far as the code. A valid device proof gives the class `high`, else rule 5.
 * - **Rule 2** (a sign-in with a valid device proof for the account): instead of rules 1 and 3 and the per-address sign-in buckets, the back-off on
 *   the proof's own failures (DeviceRow.failures: after backoffAfter in a row, each further attempt waits backoffBaseMs * 2^(failures -
 *   backoffAfter), at most backoffMaxMs, from the proof's last failure, which is kept here); class `high`. The service deletes the proof after
 *   deviceFailures.
 * - **The per-address sign-in bucket** of 8.1 (signInPerMinute, burst signInBurst, with the IPv6 aggregates).
 * - **Rule 1**, for a name with an entry in `names` (`known`; free names are not counted, rule 6): per (name key, address key), after backoffAfter
 *   failures in a row each further attempt waits backoffBaseMs * 2^(failures - backoffAfter), at most backoffMaxMs; for IPv6 the (name key, /48)
 *   too, after backoffAfter48. A success clears both.
 * - **Rule 3**, for a known name: when attempts without a valid device proof failed more than workAfterFailures times in the last hour for the name
 *   key (every address together), each such attempt must carry solved work of `workBitsFor(failures)` bits. With CAPTCHA=none there is no work:
 *   each wide key (the /48 for IPv6, else the address key) with no failure for this name in the last hour gets its own noVerifierAllowancePerHour
 *   attempts an hour, and the others are refused.
 * - **Rule 5**: the class is `normal` when none of the address key's prefixes (/32; /64, /56 and /48) failed in the last hour, else `low`; while the
 *   hashing queue is fuller than pressureQueuePercent, a `low` attempt must also carry pressureWorkBits of work (CAPTCHA=none: it only waits in
 *   `low`).
 * - **Rule 6**: every counter map holds at most counterEntries entries (./counters.ts); a key that cannot be tracked is answered rateLimited for
 *   counterFullRetryMs.
 */
import type { AccountRateLimits } from '../api';
import type { HashPriority, PasswordHasher } from '../crypto/api';
import type { HumanVerifier, SignInAttempt, SignInGuard } from './api';
import { addressKeys } from './address';
import { CounterMap, HourCount } from './counters';
import type { Buckets } from './limiter';

const HOUR = 3_600_000;

/** Which rule answered (for the audit's signInThrottled and captchaRequired, and the log). 'address': the per-address bucket of 8.1; 6: a full map. */
export type GuardRule = 1 | 2 | 3 | 4 | 5 | 6 | 'address';
export type GuardDecision = ReturnType<SignInGuard['before']>;

/** 8.2 rule 3: min(workMaxBits, workBaseBits + max(0, ceil(log2(failures / (2 * workAfterFailures))))): 16 bits up to 40 failures, one more per doubling. */
export function workBitsFor(failures: number, limits: Pick<AccountRateLimits, 'workBaseBits' | 'workMaxBits' | 'workAfterFailures'>): number {
  const base = 2 * Math.max(1, limits.workAfterFailures);
  const extra = failures > base ? Math.ceil(Math.log2(failures / base)) : 0;
  return Math.min(limits.workMaxBits, limits.workBaseBits + Math.max(0, extra));
}

/** The back-off wait after `failures` failures in a row, from the last one: base * 2^(failures - after), at most max; 0 below `after`. */
export function backoffMs(failures: number, after: number, limits: Pick<AccountRateLimits, 'backoffBaseMs' | 'backoffMaxMs'>): number {
  if (failures < after) return 0;
  const exp = failures - after;
  if (exp >= 40) return limits.backoffMaxMs;
  return Math.min(limits.backoffMaxMs, limits.backoffBaseMs * 2 ** exp);
}

interface PairEntry { lastFailureAt: number; failures: number }
interface NameEntry { lastFailureAt: number; hour: HourCount }
interface AllowanceEntry { lastFailureAt: number; used: number[] }
interface TimeEntry { lastFailureAt: number }

/** The sign-in guard with what the service needs besides SignInGuard (the classes, the pressure, the registration rules). */
export interface ServiceSignInGuard extends SignInGuard {
  /** `before` with the rule that decided (for the audit). */
  decide(a: SignInAttempt, now: Date): { decision: GuardDecision; rule: GuardRule | null };
  /** Rule 5's class for an attempt without a device proof from `addressKey`. */
  priorityOf(addressKey: string, now: Date): HashPriority;
  /** The hashing queue is fuller than pressureQueuePercent. */
  pressure(): boolean;
  /** Records a failure for rule 5 only (an address key that failed something else that hashed, such as a wrong proof). */
  addressFailed(addressKey: string, now: Date): void;
  /**
   * 8.1's registration pressure: above registerGlobalPerMinute registrations a minute in all, every registration pays pressureWorkBits of work; with
   * CAPTCHA=none, wide keys with registerShedAfter registrations in the last hour are shed instead.
   */
  registration(addressKey: string, workBits: number, now: Date): GuardDecision;
  /** A registration was made. */
  registered(addressKey: string, now: Date): void;
  /** Drops idle entries. */
  sweep(now: Date): void;
}

export function createSignInGuard(opts: {
  limits: AccountRateLimits;
  verifier: HumanVerifier['kind'];
  hashLoad: PasswordHasher['load'];
  buckets: Buckets;
}): ServiceSignInGuard {
  const { limits, buckets } = opts;
  const work = opts.verifier !== 'none';
  const max = limits.counterEntries;
  const pairInBackoff = (after: number) => (v: PairEntry, now: number) => v.failures >= after && now - v.lastFailureAt < limits.backoffMaxMs;
  /** Rule 1: (name key, address key) and (name key, /48). */
  const pairs = new CounterMap<PairEntry>(max, HOUR, pairInBackoff(limits.backoffAfter));
  const pairs48 = new CounterMap<PairEntry>(max, HOUR, pairInBackoff(limits.backoffAfter48));
  /** Rule 3: failures per name key in the last hour. */
  const names = new CounterMap<NameEntry>(max, HOUR, (v, now) => v.hour.count(now) > limits.workAfterFailures);
  /** Rule 3 with CAPTCHA=none: per (name key, wide key), the last failure and the attempts of the hour. */
  const allowances = new CounterMap<AllowanceEntry>(max, HOUR, (v, now) => now - v.lastFailureAt < HOUR);
  /** Rule 5: the last failure of each address prefix. */
  const addresses = new CounterMap<TimeEntry>(max, HOUR, () => false);
  /** Rule 2: each device proof's last failure (its count is in the store). */
  const devices = new CounterMap<TimeEntry>(max, HOUR, (v, now) => now - v.lastFailureAt < limits.backoffMaxMs);
  /** 8.1: registrations in the last minute (times), and per wide key in the last hour. */
  const recent: number[] = [];
  const registrations = new CounterMap<{ lastFailureAt: number; hour: HourCount }>(max, HOUR, () => false);

  const rateLimited = (ms: number): GuardDecision => ({ go: false, code: 'rateLimited', retryAfterMs: Math.max(1, Math.ceil(ms)) });
  const captcha = (bits: number): GuardDecision => ({ go: false, code: 'captchaRequired', bits });

  function pressure(): boolean {
    const l = opts.hashLoad();
    const queued = l.queued.high + l.queued.normal + l.queued.low;
    return l.capacity > 0 ? queued * 100 > limits.pressureQueuePercent * l.capacity : false;
  }

  function priorityOf(addressKey: string, now: Date): HashPriority {
    const t = now.getTime();
    for (const k of addressKeys(addressKey).all) {
      const e = addresses.get(k);
      if (e && t - e.lastFailureAt < HOUR) return 'low';
    }
    return 'normal';
  }

  function addressFailed(addressKey: string, now: Date): void {
    const t = now.getTime();
    for (const k of addressKeys(addressKey).all) addresses.set(k, { lastFailureAt: t }, t);
  }

  /** The (name, wide) allowance's attempts of the last hour. */
  function allowanceUsed(e: AllowanceEntry | undefined, t: number): number {
    if (!e) return 0;
    while (e.used.length > 0 && t - e.used[0]! >= HOUR) e.used.shift();
    return e.used.length;
  }

  function decide(a: SignInAttempt, now: Date): { decision: GuardDecision; rule: GuardRule | null } {
    const t = now.getTime();
    const addr = addressKeys(a.addressKey);
    const press = pressure();

    if (a.kind === 'recover') {
      // rule 4: the per-address limit only, with or without a device proof (which gives only the class)
      const w = buckets.wait('recoveryFailure', { addressKey: a.addressKey }, t);
      if (w > 0) return { decision: rateLimited(w), rule: 4 };
      const p: HashPriority = a.device !== null ? 'high' : priorityOf(a.addressKey, now);
      if (p === 'low' && press && work && a.workBits < limits.pressureWorkBits) return { decision: captcha(limits.pressureWorkBits), rule: 5 };
      // taken now, before the code is checked: attempts in flight at once each use a token of the hour
      const took = buckets.take('recoveryFailure', { addressKey: a.addressKey }, t);
      if (!took.ok) return { decision: rateLimited(took.retryAfterMs), rule: 4 };
      return { decision: { go: true, priority: p }, rule: null };
    }

    // rule 2: a valid device proof for the account
    if (a.device !== null) {
      const last = devices.get(a.device.hash);
      const wait = last ? last.lastFailureAt + backoffMs(a.device.failures, limits.backoffAfter, limits) - t : 0;
      if (wait > 0) return { decision: rateLimited(wait), rule: 2 };
      return { decision: { go: true, priority: 'high' }, rule: null };
    }

    const priority = priorityOf(a.addressKey, now);

    // the per-address sign-in bucket of 8.1
    const bw = buckets.wait('signIn', { addressKey: a.addressKey }, t);
    if (bw > 0) return { decision: rateLimited(bw), rule: 'address' };

    let allowanceKey: string | null = null;
    if (a.known) {
      const pairKey = `${a.nameKey}\n${addr.key}`;
      const pair48Key = addr.p48 !== null ? `${a.nameKey}\n${addr.p48}` : null;
      // rule 6: the counters this attempt may need must have room
      const tracked =
        pairs.room(pairKey, t) && (pair48Key === null || pairs48.room(pair48Key, t)) && names.room(a.nameKey, t) &&
        (work || allowances.room(`${a.nameKey}\n${addr.wide}`, t));
      if (!tracked) return { decision: rateLimited(limits.counterFullRetryMs), rule: 6 };
      // rule 1
      const p = pairs.get(pairKey);
      if (p) {
        const wait = p.lastFailureAt + backoffMs(p.failures, limits.backoffAfter, limits) - t;
        if (wait > 0) return { decision: rateLimited(wait), rule: 1 };
      }
      if (pair48Key !== null) {
        const p48 = pairs48.get(pair48Key);
        if (p48) {
          const wait = p48.lastFailureAt + backoffMs(p48.failures, limits.backoffAfter48, limits) - t;
          if (wait > 0) return { decision: rateLimited(wait), rule: 1 };
        }
      }
      // rule 3
      const failures = names.get(a.nameKey)?.hour.count(t) ?? 0;
      if (failures > limits.workAfterFailures) {
        if (work) {
          const bits = workBitsFor(failures, limits);
          if (a.workBits < bits) return { decision: captcha(bits), rule: 3 };
        } else {
          allowanceKey = `${a.nameKey}\n${addr.wide}`;
          const e = allowances.get(allowanceKey);
          if (e && t - e.lastFailureAt < HOUR) return { decision: rateLimited(e.lastFailureAt + HOUR - t), rule: 3 };
          if (allowanceUsed(e, t) >= limits.noVerifierAllowancePerHour) {
            return { decision: rateLimited(e!.used[0]! + HOUR - t), rule: 3 };
          }
        }
      }
    }

    // rule 5
    if (priority === 'low' && press && work && a.workBits < limits.pressureWorkBits) return { decision: captcha(limits.pressureWorkBits), rule: 5 };

    // go: take what the attempt uses
    const took = buckets.take('signIn', { addressKey: a.addressKey }, t);
    if (!took.ok) return { decision: rateLimited(took.retryAfterMs), rule: 'address' };
    if (allowanceKey !== null) {
      const e = allowances.get(allowanceKey) ?? { lastFailureAt: 0, used: [] };
      e.used.push(t);
      allowances.set(allowanceKey, e, t);
    }
    return { decision: { go: true, priority }, rule: null };
  }

  function after(a: SignInAttempt, ok: boolean, now: Date): void {
    const t = now.getTime();
    const addr = addressKeys(a.addressKey);
    if (ok) {
      if (a.device !== null) devices.delete(a.device.hash);
      else if (a.kind === 'signIn') {
        pairs.delete(`${a.nameKey}\n${addr.key}`);
        if (addr.p48 !== null) pairs48.delete(`${a.nameKey}\n${addr.p48}`);
      }
      return;
    }
    addressFailed(a.addressKey, now);
    // a recovery attempt took its rule 4 token when it was let through, and never counts on the device proof
    if (a.kind === 'recover') return;
    if (a.device !== null) {
      devices.set(a.device.hash, { lastFailureAt: t }, t);
      return;
    }
    if (!a.known) return;
    const bump = (m: CounterMap<PairEntry>, key: string) => {
      const e = m.get(key);
      m.set(key, { lastFailureAt: t, failures: (e?.failures ?? 0) + 1 }, t);
    };
    bump(pairs, `${a.nameKey}\n${addr.key}`);
    if (addr.p48 !== null) bump(pairs48, `${a.nameKey}\n${addr.p48}`);
    const n = names.get(a.nameKey) ?? { lastFailureAt: t, hour: new HourCount() };
    n.hour.add(t);
    n.lastFailureAt = t;
    names.set(a.nameKey, n, t);
    if (!work) {
      const key = `${a.nameKey}\n${addr.wide}`;
      const e = allowances.get(key) ?? { lastFailureAt: t, used: [] };
      e.lastFailureAt = t;
      allowances.set(key, e, t);
    }
  }

  function registration(addressKey: string, workBits: number, now: Date): GuardDecision {
    const t = now.getTime();
    while (recent.length > 0 && t - recent[0]! >= 60_000) recent.shift();
    if (recent.length < limits.registerGlobalPerMinute) return { go: true, priority: priorityOf(addressKey, now) };
    if (work) {
      if (workBits < limits.pressureWorkBits) return captcha(limits.pressureWorkBits);
      return { go: true, priority: priorityOf(addressKey, now) };
    }
    const wide = addressKeys(addressKey).wide;
    const e = registrations.get(wide);
    if (e && e.hour.count(t) >= limits.registerShedAfter) return rateLimited(60_000);
    return { go: true, priority: priorityOf(addressKey, now) };
  }

  function registered(addressKey: string, now: Date): void {
    const t = now.getTime();
    recent.push(t);
    // the list never needs more than the threshold and one
    while (recent.length > limits.registerGlobalPerMinute + 1) recent.shift();
    const wide = addressKeys(addressKey).wide;
    const e = registrations.get(wide) ?? { lastFailureAt: t, hour: new HourCount() };
    e.hour.add(t);
    e.lastFailureAt = t;
    registrations.set(wide, e, t);
  }

  return {
    before: (a, now) => decide(a, now).decision,
    decide,
    after,
    priorityOf,
    pressure,
    addressFailed,
    registration,
    registered,
    sweep(now) {
      const t = now.getTime();
      for (const m of [pairs, pairs48, names, allowances, addresses, devices, registrations] as CounterMap<{ lastFailureAt: number }>[]) m.sweep(t);
    },
  };
}
