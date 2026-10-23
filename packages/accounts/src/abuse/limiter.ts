/**
 * M14-5: the rate limits of design 8.1, in memory, on the token buckets of ./bucket.ts (the copy of net's). Every number is a key of
 * ACCOUNT_RATE_LIMITS (AccountsConfig.limits). A per-address limit holds for the /32 (IPv4) or /64 (IPv6) key, and for IPv6 also for its /56 and /48
 * with prefix56Factor and prefix48Factor times as much (./address.ts); `take` takes one token from every bucket of the rule or from none.
 *
 * | rule                | buckets                                                                                           |
 * |---------------------|---------------------------------------------------------------------------------------------------|
 * | register            | address: registerPerHour an hour, registerPerDay a day                                            |
 * | signIn              | address: signInPerMinute a minute, burst signInBurst (the sign-in guard takes it, ./signin.ts)     |
 * | recoveryFailure     | address: recoveryFailuresPerHour an hour (one token per attempt the guard lets through, 8.2 rule 4) |
 * | emailResetRequest   | address: emailResetRequestsPerHour an hour; account: emailResetRequestsPerDay a day                |
 * | emailResetDevice    | other (a valid device proof's hash): emailResetRequestsPerDay a day (M14-15, review A4)            |
 * | emailCodeFailure    | address: emailCodeFailuresPerHour an hour (one token per try of an email code, before the code)    |
 * | emailCodeTry        | (other = the code, address): emailCodeTriesPerAddress a day, until the code expires (5 in all)     |
 * | verifyMail          | account: verifyMailsPerDay a day                                                                  |
 * | verifyMailAddress   | other (the target address): verifyMailsPerAddressPerDay a day                                     |
 * | guestReport         | other (the guest session): guestReportsPerDay a day; address: guestReportsPerDay a day             |
 * | report              | account: reportsPerDay a day                                                                      |
 * | reportTarget        | (account, other = the target): reportsPerTargetPerDay a day                                       |
 * | avatar, privacy     | account: avatarPerHour, privacyPerHour an hour                                                    |
 * | relation            | account: relationChangesPerHour an hour                                                           |
 * | export              | account: exportsPerDay a day                                                                      |
 * | providerBegin       | address: providerBeginsPerHour an hour (M14-13)                                                   |
 * | providerCallback    | address (the browser that brings the callback): providerCallbacksPerHour an hour (M14-13)          |
 *
 * `other` keys are kept only as a keyed hash under a random key made at start (so a target email address is never a map key in clear, 3.4).
 * The (other, address) scope has the /56 and /48 levels too, like every per-address number of 8.1 (emailCodeTry is its only rule).
 * Each bucket map holds at most counterEntries keys; a full map forgets full buckets first, and if none is full it does not track the new key and
 * answers it rateLimited for counterFullRetryMs (fail closed: a flood of keys never resets anyone's limit). A bucket made by a take with `until`
 * (an email code's expiry) is forgotten at that moment, full or not, by the sweep and by a map that needs room, so it cannot outlive its code.
 *
 * INTERFACE CHANGE (M14-8): emailCodeFailure, the /56 and /48 levels of (other, address), `until`, and **emailCodeTry fails open**: a key its full
 * map cannot track is let through (that bucket only; the other levels still count). The email part takes emailCodeFailure for the address key
 * first, fail closed, and emailCodeTry only after it, once per live code: a try that passes untracked is still one of the 10 an hour of its address
 * key (with the /56 and /48 aggregates), and a map full of other codes' counters never refuses anyone's right code (review of M14-8: with fail
 * closed, a few wrong tries from each of many address keys, one entry per live code each, refused every owner's first try for hours).
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { AccountId, AccountRateLimits } from '../api';
import type { CreateRateLimiter, LimitRule, RateLimiter } from './api';
import { addressKeys } from './address';
import { TokenBucket, type RateConfig } from './bucket';
import { createSignInGuard, type ServiceSignInGuard } from './signin';

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

type Scope = 'address' | 'account' | 'other' | 'otherAddress' | 'accountOther';
interface BucketSpec {
  scope: Scope; count: (l: AccountRateLimits) => number; perMs: number; burst?: (l: AccountRateLimits) => number;
  /** A key a full map cannot track is let through instead of refused (see the header: only for a rule another rule bounds first). */
  open?: true;
}

const RULES: Readonly<Record<LimitRule, readonly BucketSpec[]>> = {
  register: [
    { scope: 'address', count: (l) => l.registerPerHour, perMs: HOUR },
    { scope: 'address', count: (l) => l.registerPerDay, perMs: DAY },
  ],
  signIn: [{ scope: 'address', count: (l) => l.signInPerMinute, perMs: MINUTE, burst: (l) => l.signInBurst }],
  recoveryFailure: [{ scope: 'address', count: (l) => l.recoveryFailuresPerHour, perMs: HOUR }],
  emailResetRequest: [
    { scope: 'address', count: (l) => l.emailResetRequestsPerHour, perMs: HOUR },
    { scope: 'account', count: (l) => l.emailResetRequestsPerDay, perMs: DAY },
  ],
  // INTERFACE CHANGE (M14-15, review A4): a reset request with a valid device proof of the account takes this instead of the account's day
  emailResetDevice: [{ scope: 'other', count: (l) => l.emailResetRequestsPerDay, perMs: DAY }],
  emailCodeFailure: [{ scope: 'address', count: (l) => l.emailCodeFailuresPerHour, perMs: HOUR }],
  emailCodeTry: [{ scope: 'otherAddress', count: (l) => l.emailCodeTriesPerAddress, perMs: DAY, open: true }],
  verifyMail: [{ scope: 'account', count: (l) => l.verifyMailsPerDay, perMs: DAY }],
  verifyMailAddress: [{ scope: 'other', count: (l) => l.verifyMailsPerAddressPerDay, perMs: DAY }],
  guestReport: [
    { scope: 'other', count: (l) => l.guestReportsPerDay, perMs: DAY },
    { scope: 'address', count: (l) => l.guestReportsPerDay, perMs: DAY },
  ],
  report: [{ scope: 'account', count: (l) => l.reportsPerDay, perMs: DAY }],
  reportTarget: [{ scope: 'accountOther', count: (l) => l.reportsPerTargetPerDay, perMs: DAY }],
  avatar: [{ scope: 'account', count: (l) => l.avatarPerHour, perMs: HOUR }],
  privacy: [{ scope: 'account', count: (l) => l.privacyPerHour, perMs: HOUR }],
  relation: [{ scope: 'account', count: (l) => l.relationChangesPerHour, perMs: HOUR }],
  export: [{ scope: 'account', count: (l) => l.exportsPerDay, perMs: DAY }],
  // INTERFACE CHANGE (M14-13, review of M14-13): the provider flows' rules, as LimitRule and ACCOUNT_RATE_LIMITS name them
  providerBegin: [{ scope: 'address', count: (l) => l.providerBeginsPerHour, perMs: HOUR }],
  providerCallback: [{ scope: 'address', count: (l) => l.providerCallbacksPerHour, perMs: HOUR }],
};

export const LIMIT_RULES: readonly LimitRule[] = Object.freeze(Object.keys(RULES) as LimitRule[]);

/** `until`: the moment the buckets a take makes are forgotten, full or not (RateLimiter.take). */
export type LimitKey = { addressKey?: string; account?: AccountId; other?: string; until?: Date };
export type TakeResult = { ok: true } | { ok: false; retryAfterMs: number };

/** A bounded map of token buckets (one per rule, spec and key level), each with the moment it is forgotten at the latest (Infinity: never). */
class BucketMap {
  private readonly buckets = new Map<string, { b: TokenBucket; until: number }>();
  constructor(private readonly config: RateConfig, private readonly max: number) {}

  /** The bucket of `key`, made (to be forgotten at `until`) when there is room; null when the map is full of buckets in use. */
  bucket(key: string, now: number, until: number): TokenBucket | null {
    const e = this.buckets.get(key);
    if (e && e.until > now) return e.b;
    if (e) this.buckets.delete(key);
    if (this.buckets.size >= this.max) {
      this.sweep(now);
      if (this.buckets.size >= this.max) return null;
    }
    const made = new TokenBucket(this.config, now);
    this.buckets.set(key, { b: made, until });
    return made;
  }

  /** Forgets buckets that are full again (nothing taken recently) or past their `until`. */
  sweep(now: number): void {
    for (const [k, x] of this.buckets) if (x.until <= now || x.b.full(now)) this.buckets.delete(k);
  }
}

export interface Buckets {
  /** Milliseconds until `take` would succeed (0: now), without taking anything. */
  wait(rule: LimitRule, key: LimitKey, now: number): number;
  /** One token from each bucket of the rule, or none. */
  take(rule: LimitRule, key: LimitKey, now: number): TakeResult;
  sweep(now: number): void;
}

export function createBuckets(limits: AccountRateLimits): Buckets {
  const secret = randomBytes(32);
  const hashed = (s: string): string => createHmac('sha256', secret).update(s, 'utf8').digest('hex').slice(0, 32);
  const maps = new Map<string, BucketMap>();
  const max = limits.counterEntries;
  const fullRetry = limits.counterFullRetryMs;

  function mapFor(id: string, count: number, perMs: number, burst: number): BucketMap {
    let m = maps.get(id);
    if (!m) {
      m = new BucketMap({ rate: (count * 1000) / perMs, burst }, max);
      maps.set(id, m);
    }
    return m;
  }

  /**
   * The buckets of a rule for a key; a null entry is a map with no room for the key, or a limit set to 0 (both refuse). A rule that fails open has
   * no entry for a key its map cannot track.
   */
  function bucketsOf(rule: LimitRule, key: LimitKey, now: number): (TokenBucket | null)[] {
    const out: (TokenBucket | null)[] = [];
    // an until that is no time (a caller's bug) keeps the buckets as long as any: it must never make a limit forget itself at once
    const u = key.until?.getTime();
    const until = u !== undefined && Number.isFinite(u) ? u : Infinity;
    RULES[rule].forEach((spec, i) => {
      const count = spec.count(limits);
      const burst = spec.burst ? spec.burst(limits) : count;
      const id = `${rule}#${i}`;
      const keys: { level: string; key: string; factor: number }[] = [];
      const addr = key.addressKey !== undefined ? addressKeys(key.addressKey) : null;
      const other = key.other !== undefined ? hashed(`${rule}\n${key.other}`) : null;
      switch (spec.scope) {
        case 'address':
          if (addr) {
            keys.push({ level: 'a', key: addr.key, factor: 1 });
            if (addr.p56) keys.push({ level: '56', key: addr.p56, factor: limits.prefix56Factor });
            if (addr.p48) keys.push({ level: '48', key: addr.p48, factor: limits.prefix48Factor });
          }
          break;
        case 'account':
          if (key.account !== undefined) keys.push({ level: 'acc', key: key.account, factor: 1 });
          break;
        case 'other':
          if (other !== null) keys.push({ level: 'o', key: other, factor: 1 });
          break;
        case 'otherAddress':
          if (other !== null && addr) {
            keys.push({ level: 'oa', key: `${other}|${addr.key}`, factor: 1 });
            if (addr.p56) keys.push({ level: 'o56', key: `${other}|${addr.p56}`, factor: limits.prefix56Factor });
            if (addr.p48) keys.push({ level: 'o48', key: `${other}|${addr.p48}`, factor: limits.prefix48Factor });
          }
          break;
        case 'accountOther':
          if (other !== null && key.account !== undefined) keys.push({ level: 'ao', key: `${key.account}|${other}`, factor: 1 });
          break;
      }
      for (const k of keys) {
        if (count * k.factor <= 0 || burst * k.factor <= 0) {
          out.push(null);
          continue;
        }
        const b = mapFor(`${id}/${k.level}`, count * k.factor, spec.perMs, burst * k.factor).bucket(k.key, now, until);
        if (b !== null || !spec.open) out.push(b);
      }
    });
    return out;
  }

  function waitOf(list: (TokenBucket | null)[], now: number): number {
    let w = 0;
    for (const b of list) w = Math.max(w, b === null ? fullRetry : b.wait(now));
    return w;
  }

  return {
    wait(rule, key, now) {
      return waitOf(bucketsOf(rule, key, now), now);
    },
    take(rule, key, now) {
      const list = bucketsOf(rule, key, now);
      const w = waitOf(list, now);
      if (w > 0) return { ok: false, retryAfterMs: w };
      for (const b of list) b!.take(now);
      return { ok: true };
    },
    sweep(now) {
      for (const m of maps.values()) m.sweep(now);
    },
  };
}

// ---- the RateLimiter of src/abuse/api.ts ----------------------------------------------------------------------------------------------------

/** The rate limiter as the service core uses it: RateLimiter, with the guard's extras and the buckets' waits. */
export interface ServiceRateLimiter extends RateLimiter {
  readonly signIn: ServiceSignInGuard;
  /** Milliseconds until `take` would succeed, taking nothing. */
  wait(rule: LimitRule, key: LimitKey, now: Date): number;
  /** Drops idle counters and full buckets (the service's tick). */
  sweep(now: Date): void;
}

/** `createRateLimiter` (src/abuse/index.ts): the buckets of 8.1 and the sign-in guard of 8.2 on them. */
export function buildRateLimiter(opts: Parameters<CreateRateLimiter>[0]): ServiceRateLimiter {
  const buckets = createBuckets(opts.limits);
  const signIn = createSignInGuard({ limits: opts.limits, verifier: opts.verifier, hashLoad: opts.hashLoad, buckets });
  return {
    take: (rule, key, now) => buckets.take(rule, key, now.getTime()),
    wait: (rule, key, now) => buckets.wait(rule, key, now.getTime()),
    signIn,
    sweep(now) {
      buckets.sweep(now.getTime());
      signIn.sweep(now);
    },
  };
}
