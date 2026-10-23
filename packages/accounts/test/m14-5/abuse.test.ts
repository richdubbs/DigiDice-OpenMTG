/**
 * M14-5: the abuse controls in isolation (design 8.1-8.4), with a fake clock and fixed inputs: address keys and their IPv6 aggregates, the rate
 * limits of 8.1 (one token from every bucket or none, /64s of one /48 sharing the /48's allowance), each rule of the sign-in guard of 8.2 (back-off
 * per name and address and per /48, a device proof's own back-off and its class, the work demand with its difficulty, CAPTCHA=none's allowances,
 * rule 5's classes and pressure, rule 6's fixed-size maps that never drop an entry in back-off), the registration pressure, and the proof-of-work
 * verifier (a round trip, a wrong nonce, an expired, a replayed and a misdirected challenge refused).
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_RATE_LIMITS, WORK_ANSWER, type AccountRateLimits, type HashPriority } from '@openmtg/accounts';
import { addressKeys } from '../../src/abuse/address';
import { KeyedLimiter, TokenBucket } from '../../src/abuse/bucket';
import { CounterMap, HourCount } from '../../src/abuse/counters';
import { buildRateLimiter } from '../../src/abuse/limiter';
import { backoffMs, workBitsFor } from '../../src/abuse/signin';
import { buildNoVerifier, buildWorkVerifier, leadingZeroBits, workHash } from '../../src/abuse/work';
import { createNoVerifier, createRateLimiter, createWorkVerifier } from '../../src/abuse/index';
import type { SignInAttempt } from '../../src/abuse/api';
import { fixedRandom, HOUR, MIN, solve, T0 } from './support';

const limits = (over: Partial<AccountRateLimits> = {}): AccountRateLimits => ({ ...ACCOUNT_RATE_LIMITS, ...over });
const idleLoad = () => ({ running: 0, queued: { high: 0, normal: 0, low: 0 } as Record<HashPriority, number>, capacity: 64 });
const at = (ms: number) => new Date(T0 + ms);

function attempt(over: Partial<SignInAttempt> = {}): SignInAttempt {
  return { kind: 'signIn', nameKey: 'allce', known: true, addressKey: '203.0.113.7', device: null, workBits: 0, ...over };
}

describe('M14-5: address keys (8.1)', () => {
  it('IPv4 is its own /32; IPv6 keys by /64 with /56 and /48 aggregates; IPv4-mapped counts as IPv4', () => {
    expect(addressKeys('203.0.113.7')).toEqual({ key: 'v4:203.0.113.7', p56: null, p48: null, wide: 'v4:203.0.113.7', all: ['v4:203.0.113.7'] });
    expect(addressKeys('203.0.113.7/32').key).toBe('v4:203.0.113.7');
    const v6 = addressKeys('2001:db8:aa:bb12::/64');
    expect(v6).toEqual({
      key: 'v6/64:20010db800aabb12', p56: 'v6/56:20010db800aabb', p48: 'v6/48:20010db800aa', wide: 'v6/48:20010db800aa',
      all: ['v6/64:20010db800aabb12', 'v6/56:20010db800aabb', 'v6/48:20010db800aa'],
    });
    // other spellings of the same /64
    for (const s of ['2001:DB8:AA:BB12::', '2001:0db8:00aa:bb12:0:0:0:0', '[2001:db8:aa:bb12::1]', '2001:db8:aa:bb12:ffff::1%eth0']) {
      expect(addressKeys(s).key, s).toBe('v6/64:20010db800aabb12');
    }
    expect(addressKeys('::ffff:198.51.100.4').key).toBe('v4:198.51.100.4');
    expect(addressKeys('::ffff:c633:6404').key).toBe('v4:198.51.100.4');
    // not an address: an opaque key, no aggregates
    for (const s of ['system', 'a1', '999.1.1.1', '1:2:3', '1::2::3', 'g::1']) expect(addressKeys(s).p48, s).toBeNull();
    expect(addressKeys('system').key).toBe('k:system');
  });
});

describe('M14-5: the token bucket is net\'s (the named copy, 11.8)', () => {
  it('TokenBucket and KeyedLimiter keep net\'s behaviour on a fixed sequence', () => {
    const b = new TokenBucket({ rate: 1, burst: 2 }, 0);
    expect([b.take(0), b.take(0), b.take(0)]).toEqual([true, true, false]);
    expect(b.wait(0)).toBe(1000);
    expect(b.take(1000)).toBe(true);
    expect(b.full(3000)).toBe(true);
    const k = new KeyedLimiter({ rate: 1, burst: 1 }, { rate: 1, burst: 2 }, 0, 2);
    expect([k.take('a', 0), k.take('a', 0), k.take('b', 0), k.take('c', 0)]).toEqual([true, false, true, false]);
    // a full map with no full bucket is cleared (net's policy), then holds the new key
    expect(k.size).toBe(1);
  });
});

describe('M14-5: the rate limits (8.1)', () => {
  it('register: 3 an hour per address key, refills over the hour; a refusal takes nothing', () => {
    const r = buildRateLimiter({ limits: limits(), verifier: 'none', hashLoad: idleLoad });
    const k = { addressKey: '203.0.113.7' };
    for (let i = 0; i < 3; i++) expect(r.take('register', k, at(0)).ok).toBe(true);
    const no = r.take('register', k, at(0));
    expect(no.ok).toBe(false);
    if (!no.ok) expect(no.retryAfterMs).toBe(20 * MIN);
    expect(r.take('register', { addressKey: '203.0.113.8' }, at(0)).ok).toBe(true);
    expect(r.take('register', k, at(20 * MIN)).ok).toBe(true);
    // and 10 a day: after 10 in all, the day's bucket refuses even when the hour's has refilled
    for (let h = 1; h <= 3; h++) for (let i = 0; i < 3; i++) r.take('register', k, at(h * HOUR + i));
    expect(r.wait('register', k, at(4 * HOUR))).toBeGreaterThan(0);
  });

  it('IPv6 /64s of one /48 share the /48 allowance (16 times the /64\'s), and a /56 four times', () => {
    const r = buildRateLimiter({ limits: limits(), verifier: 'none', hashLoad: idleLoad });
    let ok = 0;
    for (let i = 0; i < 30; i++) {
      const sub = `2001:db8:77:${(i * 256 + 1).toString(16)}::`;
      for (let j = 0; j < 3; j++) if (r.take('register', { addressKey: sub }, at(0)).ok) ok++;
    }
    expect(ok).toBe(48);
    // one /56: 4 /64s of 3 each, then refused
    const r2 = buildRateLimiter({ limits: limits(), verifier: 'none', hashLoad: idleLoad });
    let ok56 = 0;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) if (r2.take('register', { addressKey: `2001:db8:88:${i + 1}::` }, at(0)).ok) ok56++;
    expect(ok56).toBe(12);
  });

  it('account rules, other keys (hashed) and combined keys', () => {
    const r = buildRateLimiter({ limits: limits(), verifier: 'none', hashLoad: idleLoad });
    const acc = { account: 'acc_00000000000000000000000001' as const };
    for (let i = 0; i < 10; i++) expect(r.take('avatar', acc, at(0)).ok).toBe(true);
    expect(r.take('avatar', acc, at(0)).ok).toBe(false);
    expect(r.take('privacy', acc, at(0)).ok).toBe(true);
    expect(r.take('export', acc, at(0)).ok).toBe(true);
    expect(r.take('export', acc, at(HOUR)).ok).toBe(false);
    // reportTarget: one a day per (account, target)
    expect(r.take('reportTarget', { ...acc, other: 'acc_X' }, at(0)).ok).toBe(true);
    expect(r.take('reportTarget', { ...acc, other: 'acc_X' }, at(0)).ok).toBe(false);
    expect(r.take('reportTarget', { ...acc, other: 'acc_Y' }, at(0)).ok).toBe(true);
    // guestReport: per session AND per address key
    for (let i = 0; i < 3; i++) expect(r.take('guestReport', { other: `gs_${i}`, addressKey: '192.0.2.9' }, at(0)).ok).toBe(true);
    expect(r.take('guestReport', { other: 'gs_9', addressKey: '192.0.2.9' }, at(0)).ok).toBe(false);
    // a limit set to 0 refuses
    const zero = buildRateLimiter({ limits: limits({ exportsPerDay: 0 }), verifier: 'none', hashLoad: idleLoad });
    expect(zero.take('export', acc, at(0)).ok).toBe(false);
  });

  it('a full bucket map forgets full buckets, and refuses a new key while every bucket is in use', () => {
    const r = buildRateLimiter({ limits: limits({ counterEntries: 2 }), verifier: 'none', hashLoad: idleLoad });
    expect(r.take('export', { account: 'acc_00000000000000000000000001' }, at(0)).ok).toBe(true);
    expect(r.take('export', { account: 'acc_00000000000000000000000002' }, at(0)).ok).toBe(true);
    const third = r.take('export', { account: 'acc_00000000000000000000000003' }, at(0));
    expect(third).toEqual({ ok: false, retryAfterMs: ACCOUNT_RATE_LIMITS.counterFullRetryMs });
    // a day later both buckets are full again and can go
    expect(r.take('export', { account: 'acc_00000000000000000000000003' }, at(25 * HOUR)).ok).toBe(true);
  });

  it('the factories are built (createRateLimiter, createWorkVerifier, createNoVerifier)', () => {
    expect(createRateLimiter({ limits: limits(), verifier: 'work', hashLoad: idleLoad }).signIn).toBeDefined();
    expect(createWorkVerifier({ random: fixedRandom('w'), challengeMs: 120_000 }).kind).toBe('work');
    expect(createNoVerifier().kind).toBe('none');
  });
});

describe('M14-5: the sign-in guard (8.2)', () => {
  const guard = (over: Partial<AccountRateLimits> = {}, verifier: 'work' | 'none' = 'work', load = idleLoad) =>
    buildRateLimiter({ limits: limits(over), verifier, hashLoad: load }).signIn;
  const fail = (g: ReturnType<typeof guard>, a: SignInAttempt, ms: number) => g.after(a, false, at(ms));

  it('rule 1: after 5 failures in a row, each further attempt waits 2^(failures - 5) s, at most 15 minutes; a success clears it', () => {
    const g = guard();
    const a = attempt();
    for (let i = 0; i < 5; i++) {
      expect(g.before(a, at(i * 100)).go).toBe(true);
      fail(g, a, i * 100);
    }
    expect(g.before(a, at(400))).toEqual({ go: false, code: 'rateLimited', retryAfterMs: 1_000 });
    expect(g.before(a, at(1_400)).go).toBe(true);
    fail(g, a, 1_400);
    expect(g.before(a, at(1_400))).toEqual({ go: false, code: 'rateLimited', retryAfterMs: 2_000 });
    expect(backoffMs(5, 5, limits())).toBe(1_000);
    expect(backoffMs(15, 5, limits())).toBe(900_000);
    expect(backoffMs(99, 5, limits())).toBe(900_000);
    expect(backoffMs(4, 5, limits())).toBe(0);
    // another address key is not slowed by this pair's failures
    expect(g.before({ ...a, addressKey: '203.0.113.8' }, at(1_400)).go).toBe(true);
    // a success from this pair clears it
    g.after(a, true, at(5_000));
    expect(g.before(a, at(5_000)).go).toBe(true);
  });

  it('rule 1 for IPv6: the /48 counts too, after 20 failures in a row', () => {
    const g = guard({ workAfterFailures: 1_000 });
    for (let i = 0; i < 20; i++) {
      const a = attempt({ addressKey: `2001:db8:5:${i + 1}::` });
      expect(g.before(a, at(i)).go).toBe(true);
      fail(g, a, i);
    }
    const fresh = attempt({ addressKey: '2001:db8:5:ff::' });
    expect(g.before(fresh, at(30))).toEqual({ go: false, code: 'rateLimited', retryAfterMs: 1_000 - 11 });
  });

  it('rule 3: above 20 failures an hour on the name, attempts without a device proof pay work, harder with every doubling', () => {
    expect([21, 40, 41, 80, 81, 160, 161, 1_280, 1_281, 100_000].map((f) => workBitsFor(f, limits()))).toEqual([16, 16, 17, 17, 18, 18, 19, 21, 22, 22]);
    const g = guard();
    for (let i = 0; i < 21; i++) fail(g, attempt({ addressKey: `198.51.100.${i}` }), i);
    expect(g.before(attempt({ addressKey: '192.0.2.200' }), at(100))).toEqual({ go: false, code: 'captchaRequired', bits: 16 });
    expect(g.before(attempt({ addressKey: '192.0.2.200', workBits: 16 }), at(100)).go).toBe(true);
    // a free name (no entry in names) is never counted
    for (let i = 0; i < 30; i++) fail(g, attempt({ nameKey: 'nobody', known: false, addressKey: `198.51.100.${i}` }), i);
    expect(g.before(attempt({ nameKey: 'nobody', known: false, addressKey: '192.0.2.201' }), at(100)).go).toBe(true);
    // an hour later the count has gone
    expect(g.before(attempt({ addressKey: '192.0.2.202' }), at(HOUR + MIN)).go).toBe(true);
  });

  it('rule 3 with CAPTCHA=none: a clean address key (its /48 for IPv6) gets 3 attempts an hour; one that failed on the name is refused', () => {
    const g = guard({}, 'none');
    for (let i = 0; i < 21; i++) fail(g, attempt({ addressKey: `198.51.100.${i}` }), i);
    const owner = attempt({ addressKey: '192.0.2.50' });
    for (let i = 0; i < 3; i++) expect(g.before(owner, at(100 + i)).go).toBe(true);
    expect(g.before(owner, at(200)).go).toBe(false);
    // an attacker's key that failed on this name is refused for the hour
    const attacker = attempt({ addressKey: '198.51.100.3' });
    const d = g.before(attacker, at(300));
    expect(d.go).toBe(false);
    if (!d.go) expect(d.code).toBe('rateLimited');
    // /64s of one /48 share it
    const v6 = guard({}, 'none');
    for (let i = 0; i < 21; i++) fail(v6, attempt({ addressKey: `198.51.100.${i}` }), i);
    let ok = 0;
    for (let i = 0; i < 6; i++) if (v6.before(attempt({ addressKey: `2001:db8:99:${i + 1}::` }), at(100)).go) ok++;
    expect(ok).toBe(3);
  });

  it('rule 2: a valid device proof skips rules 1 and 3 and the per-address bucket, hashes high, and has a back-off of its own', () => {
    const g = guard();
    const a = attempt();
    // the attacker exhausts the per-address bucket and rule 1 on the owner's own /32, and pushes the name into rule 3
    for (let i = 0; i < 12; i++) if (g.before(a, at(i)).go) fail(g, a, i);
    for (let i = 0; i < 25; i++) fail(g, attempt({ addressKey: `198.51.100.${i}` }), 20 + i);
    expect(g.before(a, at(100)).go).toBe(false);
    const owner = attempt({ device: { account: 'acc_00000000000000000000000001', hash: 'd'.repeat(64), failures: 0 } });
    expect(g.before(owner, at(100))).toEqual({ go: true, priority: 'high' });
    // the proof's own failures: after 5 in a row the next waits
    for (let f = 0; f < 5; f++) {
      const o = { ...owner, device: { ...owner.device!, failures: f } };
      expect(g.before(o, at(1_000 + f)).go).toBe(true);
      g.after(o, false, at(1_000 + f));
    }
    const o5 = { ...owner, device: { ...owner.device!, failures: 5 } };
    expect(g.before(o5, at(1_004))).toEqual({ go: false, code: 'rateLimited', retryAfterMs: 1_000 });
    expect(g.before(o5, at(2_004)).go).toBe(true);
  });

  it('rule 5: the class is normal from a clean address key, low after a failure at any prefix; under pressure a low attempt pays work', () => {
    let full = false;
    const load = () => ({ running: 2, queued: { high: 0, normal: 0, low: full ? 40 : 0 } as Record<HashPriority, number>, capacity: 64 });
    const g = guard({}, 'work', load);
    expect(g.before(attempt({ addressKey: '2001:db8:1:1::' }), at(0))).toEqual({ go: true, priority: 'normal' });
    g.after(attempt({ addressKey: '2001:db8:1:1::', nameKey: 'other', known: false }), false, at(0));
    // another /64 of the same /48: low for an hour
    expect(g.priorityOf('2001:db8:1:2::', at(10))).toBe('low');
    expect(g.priorityOf('2001:db8:2:1::', at(10))).toBe('normal');
    expect(g.priorityOf('2001:db8:1:2::', at(HOUR + 10))).toBe('normal');
    full = true;
    expect(g.pressure()).toBe(true);
    expect(g.before(attempt({ addressKey: '2001:db8:1:2::' }), at(20))).toEqual({ go: false, code: 'captchaRequired', bits: 16 });
    expect(g.before(attempt({ addressKey: '2001:db8:1:2::', workBits: 16 }), at(20))).toEqual({ go: true, priority: 'low' });
    expect(g.before(attempt({ addressKey: '2001:db8:9:1::' }), at(20))).toEqual({ go: true, priority: 'normal' });
    // CAPTCHA=none: a low attempt only waits in its class
    const none = guard({}, 'none', load);
    none.after(attempt({ addressKey: '192.0.2.1', known: false, nameKey: 'x' }), false, at(0));
    expect(none.before(attempt({ addressKey: '192.0.2.1' }), at(1))).toEqual({ go: true, priority: 'low' });
  });

  it('recovery codes: only the per-address limit (10 failures an hour), never a per-name rule', () => {
    const g = guard();
    for (let i = 0; i < 40; i++) fail(g, attempt({ addressKey: `198.51.100.${i}` }), i);
    const r = attempt({ kind: 'recover', addressKey: '192.0.2.77' });
    for (let i = 0; i < 10; i++) {
      expect(g.before(r, at(100 + i)).go).toBe(true);
      g.after(r, false, at(100 + i));
    }
    const d = g.before(r, at(200));
    expect(d.go).toBe(false);
    expect(g.before(attempt({ kind: 'recover', addressKey: '192.0.2.78' }), at(200)).go).toBe(true);
  });

  it('recovery codes with a valid device proof: the class high, rule 4 still holds, and a wrong code never counts on the device', () => {
    const g = guard();
    const device = { account: 'acc_00000000000000000000000001' as const, hash: 'e'.repeat(64), failures: 7 };
    const r = attempt({ kind: 'recover', addressKey: '192.0.2.79', device });
    for (let i = 0; i < 10; i++) {
      expect(g.before(r, at(i))).toEqual({ go: true, priority: 'high' });
      g.after(r, false, at(i));
    }
    expect(g.before(r, at(20))).toMatchObject({ go: false, code: 'rateLimited' });
    expect(g.before({ ...r, device: null }, at(20))).toMatchObject({ go: false, code: 'rateLimited' });
    // no back-off of the device from the wrong codes: a sign-in with it (7 failures of its own) is not held back
    expect(g.before(attempt({ device }), at(21))).toEqual({ go: true, priority: 'high' });
  });

  it('recovery codes: the token is taken when the attempt is let through, so attempts in flight at once cannot all pass', () => {
    const g = guard();
    const r = attempt({ kind: 'recover', addressKey: '192.0.2.80' });
    for (let i = 0; i < 10; i++) expect(g.before(r, at(0)).go).toBe(true);
    expect(g.before(r, at(0))).toMatchObject({ go: false, code: 'rateLimited' });
  });

  it('rule 6: a full map frees idle entries, then entries not in back-off, never one in back-off; else the key is not tracked', () => {
    const g = guard({ counterEntries: 3 });
    // three pairs in back-off (5 failures each)
    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) for (let i = 0; i < 5; i++) fail(g, attempt({ addressKey: ip }), i);
    const d = g.before(attempt({ addressKey: '198.51.100.4' }), at(10));
    expect(d).toEqual({ go: false, code: 'rateLimited', retryAfterMs: ACCOUNT_RATE_LIMITS.counterFullRetryMs });
    // the three entries are still there: each pair still waits
    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) expect(g.before(attempt({ addressKey: ip }), at(20)).go, ip).toBe(false);
    // the map's own rules
    const m = new CounterMap<{ lastFailureAt: number; hot: boolean }>(2, HOUR, (v) => v.hot);
    expect(m.set('a', { lastFailureAt: 0, hot: true }, 0)).toBe(true);
    expect(m.set('b', { lastFailureAt: 10, hot: false }, 10)).toBe(true);
    expect(m.set('c', { lastFailureAt: 20, hot: false }, 20)).toBe(true);
    expect([m.has('a'), m.has('b'), m.has('c')]).toEqual([true, false, true]);
    expect(m.set('d', { lastFailureAt: HOUR + 30, hot: false }, HOUR + 30)).toBe(true);
    expect(m.has('a')).toBe(true);
    const h = new HourCount();
    h.add(0);
    h.add(1);
    h.add(30 * MIN);
    expect(h.count(30 * MIN)).toBe(3);
    expect(h.count(HOUR + MIN)).toBe(1);
  });

  it('the registration pressure: above 60 a minute every registration pays 16 bits; with CAPTCHA=none busy wide keys are shed', () => {
    const g = guard();
    for (let i = 0; i < 60; i++) {
      expect(g.registration(`198.51.100.${i}`, 0, at(i)).go).toBe(true);
      g.registered(`198.51.100.${i}`, at(i));
    }
    expect(g.registration('192.0.2.1', 0, at(100))).toEqual({ go: false, code: 'captchaRequired', bits: 16 });
    expect(g.registration('192.0.2.1', 16, at(100)).go).toBe(true);
    expect(g.registration('192.0.2.1', 0, at(MIN + 100)).go).toBe(true);
    const n = guard({}, 'none');
    for (let i = 0; i < 60; i++) n.registered(i < 2 ? '2001:db8:4:1::' : `198.51.100.${i}`, at(i));
    expect(n.registration('2001:db8:4:9::', 0, at(100)).go).toBe(false);
    expect(n.registration('192.0.2.1', 0, at(100)).go).toBe(true);
  });
});

describe('M14-5: the proof-of-work verifier (8.4)', () => {
  const v = () => buildWorkVerifier({ random: fixedRandom('work'), challengeMs: 120_000 });
  const ctx = { addressKey: '203.0.113.7', action: 'signIn' as const, scope: 'scope-1', bits: 6 };

  it('a round trip: the challenge fits WORK_ANSWER, a solution verifies once; a replay is refused', async () => {
    const w = v();
    const c = w.challenge({ action: 'signIn', scope: 'scope-1', bits: 6 }, at(0))!;
    expect(c.kind).toBe('work');
    expect(c.bits).toBe(6);
    expect(c.expiresAt).toBe(at(120_000).toISOString());
    const token = solve(c.challenge, 6);
    expect(WORK_ANSWER.test(token)).toBe(true);
    expect(await w.verify(token, ctx, at(1_000))).toEqual({ ok: true });
    expect(await w.verify(token, ctx, at(2_000))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a wrong nonce, an expired challenge, another action or scope, fewer bits than needed, a forged tag, junk', async () => {
    const w = v();
    const c = w.challenge({ action: 'signIn', scope: 'scope-1', bits: 6 }, at(0))!;
    const good = solve(c.challenge, 6);
    let wrong = '';
    for (let n = 0; ; n++) if (leadingZeroBits(workHash(c.challenge, String(n))) < 6) {
      wrong = `${c.challenge}:${n}`;
      break;
    }
    expect((await w.verify(wrong, ctx, at(1))).ok).toBe(false);
    expect((await w.verify(good, ctx, at(120_000))).ok).toBe(false);
    expect((await w.verify(good, { ...ctx, action: 'recover' }, at(1))).ok).toBe(false);
    expect((await w.verify(good, { ...ctx, scope: 'scope-2' }, at(1))).ok).toBe(false);
    expect((await w.verify(good, { ...ctx, bits: 7 }, at(1))).ok).toBe(false);
    const forged = `${c.challenge.slice(0, -1)}${c.challenge.endsWith('A') ? 'B' : 'A'}:${good.split(':')[1]}`;
    expect((await w.verify(forged, ctx, at(1))).ok).toBe(false);
    // another server's (another key's) challenge
    const other = buildWorkVerifier({ random: fixedRandom('other'), challengeMs: 120_000 });
    const oc = other.challenge({ action: 'signIn', scope: 'scope-1', bits: 6 }, at(0))!;
    expect((await w.verify(solve(oc.challenge, 6), ctx, at(1))).ok).toBe(false);
    for (const junk of ['', 'x', 'abc:1', `${c.challenge}:`, `${c.challenge}:12345678901234567`, 42 as unknown as string]) {
      expect((await w.verify(junk, ctx, at(1))).ok, String(junk)).toBe(false);
    }
    // the good one still works (none of the refusals spent it)
    expect((await w.verify(good, ctx, at(1))).ok).toBe(true);
  });

  it('NoVerifier: kind none, no challenge, accepts', async () => {
    const n = buildNoVerifier();
    expect([n.kind, n.siteKey, n.challenge({ action: 'register', scope: 'register', bits: 16 }, at(0))]).toEqual(['none', null, null]);
    expect(await n.verify('anything', ctx, at(0))).toEqual({ ok: true });
  });
});
