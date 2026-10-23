/**
 * M14-8: tries of email codes (design 3.4, 8.1, 12.1; review of M14-8, findings 1 and 2). Every try of a code counts per address key first, 10 an
 * hour with the IPv6 /56 and /48 aggregates, alike for every name and before any counter of a code is made; then per (code, address key), 5 with
 * the same aggregates. A code's counters are forgotten when it expires, and a map full of other codes' counters never refuses anyone's right code
 * (it fails open: the try was counted per address key already). In process, a fake clock and fixed inputs: the address keys are written out.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_RATE_LIMITS, type AccountRateLimits, type AccountResult, type HashPriority } from '@openmtg/accounts';
import { buildRateLimiter } from '../../src/abuse/limiter';
import {
  code, codeOf, ctxFor, HOUR, inRow, MIN, recordingSetup, recordLimits, registerVerified, registerWith, T0, value, type LimitCall, type MailSetup,
  type RecordingMailer,
} from './support';

const ALICE = 'alice.liddell@example.org';
const MALLORY = 'mallory@example.net';
const NEW_PW = 'a brand new passphrase';
const WRONG = 'ZZZZZ-ZZZZZ';

const resetsTo = (m: RecordingMailer, to: string) => m.sent.filter((x) => x.to === to && x.meta.kind === 'reset');
/** The IPv6 address key of /64 number `j` of /56 number `k` of the /48 2001:db8:<p48>::/48. */
const v6 = (p48: number, k: number, j = 0): string => `2001:db8:${p48.toString(16)}:${(k * 256 + j).toString(16)}::`;

/** Registers Alice with a verified address and asks for a reset from her own address key: the code mailed to her. */
async function aliceWithCode(s: MailSetup & { mailer: RecordingMailer }): Promise<string> {
  await registerVerified(s, 'Alice', ALICE);
  value(await s.service.requestEmailReset(ctxFor(s, 'alice asks'), 'Alice'));
  await s.idle();
  return codeOf(resetsTo(s.mailer, ALICE).at(-1));
}

describe('M14-8: every try of a code counts per address key first (8.1; review finding 1)', () => {
  it('10 an hour per address key, alike for every name and code, verifyEmail included; refused before any counter of a code is made', async () => {
    const calls: LimitCall[] = [];
    const s = recordingSetup({ deps: recordLimits(calls) });
    const right = await aliceWithCode(s);
    const bruno = await registerWith(s, 'Bruno', 'bruno@example.org');
    const fromA = ctxFor(s, 'place A');
    // ten tries from A of every kind: wrong codes for Alice, an unknown name, a malformed code, a wrong verification code of Bruno's own
    const tries: (() => Promise<AccountResult<unknown>>)[] = [
      () => s.service.useEmailReset(fromA, { name: 'Alice', code: WRONG, newPassword: NEW_PW }),
      () => s.service.useEmailReset(fromA, { name: 'Nobody Here', code: WRONG, newPassword: NEW_PW }),
      () => s.service.useEmailReset(fromA, { name: 'Alice', code: 'not a code', newPassword: NEW_PW }),
      () => s.service.verifyEmail(fromA, bruno.auth, WRONG),
    ];
    for (let i = 0; i < 10; i++) expect(code(await tries[i % tries.length]!())).toBe('emailCodeInvalid');
    calls.length = 0;
    // the 11th: refused, even with the right code; the same answer for an unknown name
    const refused = inRow('useEmailReset', await s.service.useEmailReset(fromA, { name: 'Alice', code: right, newPassword: NEW_PW }));
    expect(refused).toEqual({ ok: false, error: { code: 'rateLimited', message: expect.any(String), retryAfterMs: 6 * MIN } });
    const unknown = inRow('useEmailReset', await s.service.useEmailReset(fromA, { name: 'Nobody Here', code: right, newPassword: NEW_PW }));
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(refused));
    expect(code(inRow('verifyEmail', await s.service.verifyEmail(fromA, bruno.auth, WRONG)))).toBe('rateLimited');
    // nothing but the per-address take ran: no counter of a code was made for these tries
    expect(calls.map((c) => [c.rule, c.ok])).toEqual([['emailCodeFailure', false], ['emailCodeFailure', false], ['emailCodeFailure', false]]);
    // the same moment from B: the right code signs in, and its try was counted per address key before the code's counter
    calls.length = 0;
    const r = value(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'place B'), { name: 'Alice', code: right, newPassword: NEW_PW })));
    expect(r.account.name).toBe('Alice');
    expect(calls.map((c) => c.rule)).toEqual(['emailCodeFailure', 'emailCodeTry']);
    expect(calls[1]!.key['until']).toEqual(new Date(T0 + 15 * MIN));
    // an hour refills A's allowance
    s.clock.advance(HOUR);
    expect(code(inRow('verifyEmail', await s.service.verifyEmail(ctxFor(s, 'place A'), bruno.auth, WRONG)))).toBe('emailCodeInvalid');
  });

  it('IPv6: four times it per /56 and sixteen times it per /48', async () => {
    const s = recordingSetup({ env: { ACCOUNTS_EMAIL_CODE_FAILURES_PER_HOUR: '1' } });
    const at = (address: string) => s.service.useEmailReset(ctxFor(s, 'prober', { addressKey: address }), { name: 'Nobody Here', code: WRONG, newPassword: NEW_PW });
    // one /56: 4 /64s of one try each, then refused for a 5th /64 of it
    for (let j = 0; j < 4; j++) expect(code(await at(v6(5, 0, j)))).toBe('emailCodeInvalid');
    expect(code(await at(v6(5, 0, 4)))).toBe('rateLimited');
    // three more /56s of the /48: 16 in all, then refused for a fresh /56 of it
    for (let k = 1; k < 4; k++) for (let j = 0; j < 4; j++) expect(code(await at(v6(5, k, j)))).toBe('emailCodeInvalid');
    expect(code(await at(v6(5, 4)))).toBe('rateLimited');
    // another /48 is apart
    expect(code(await at(v6(6, 0)))).toBe('emailCodeInvalid');
  });
});

describe('M14-8: a code\'s counters never refuse anyone else\'s right code (3.4, 12.1; review finding 1)', () => {
  it('a map full of other codes\' counters: the owner\'s right code from a key it cannot track is still compared, and signs in', async () => {
    const s = recordingSetup({ env: { ACCOUNTS_COUNTER_ENTRIES: '12' } });
    await registerVerified(s, 'Mallory', MALLORY);
    const right = await aliceWithCode(s);
    for (let i = 0; i < 3; i++) value(await s.service.requestEmailReset(ctxFor(s, `mallory asks ${i}`), 'Mallory'));
    await s.idle();
    expect(resetsTo(s.mailer, MALLORY)).toHaveLength(3);
    // Mallory's wrong tries of her own 3 live codes from 4 /64s: one counter per live code each, 12 in all, every one in use
    for (let j = 0; j < 4; j++) {
      const ctx = ctxFor(s, 'mallory', { addressKey: `2001:db8:77:${j}::` });
      expect(code(await s.service.useEmailReset(ctx, { name: 'Mallory', code: WRONG, newPassword: NEW_PW }))).toBe('emailCodeInvalid');
    }
    // ten minutes later, while every one of those codes is live: Alice from her own address key
    s.clock.advance(10 * MIN);
    const r = value(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'alice at home'), { name: 'Alice', code: right, newPassword: NEW_PW })));
    expect(r.account.name).toBe('Alice');
  });

  it('a code\'s counters are forgotten when it expires: an hour-long counter would keep the map full, and the 5 tries of a new code untracked', async () => {
    const s = recordingSetup({ env: { ACCOUNTS_COUNTER_ENTRIES: '12' } });
    await registerVerified(s, 'Mallory', MALLORY);
    await registerVerified(s, 'Alice', ALICE);
    for (let i = 0; i < 3; i++) value(await s.service.requestEmailReset(ctxFor(s, `mallory asks ${i}`), 'Mallory'));
    await s.idle();
    for (let j = 0; j < 4; j++) {
      const ctx = ctxFor(s, 'mallory', { addressKey: `2001:db8:77:${j}::` });
      expect(code(await s.service.useEmailReset(ctx, { name: 'Mallory', code: WRONG, newPassword: NEW_PW }))).toBe('emailCodeInvalid');
    }
    // every code so far has expired: their counters go with them
    s.clock.advance(15 * MIN);
    value(await s.service.requestEmailReset(ctxFor(s, 'alice asks'), 'Alice'));
    await s.idle();
    const right = codeOf(resetsTo(s.mailer, ALICE)[0]);
    // E's 5 tries of Alice's new code are counted (there is room again), so the right code from E is no longer compared there
    const fromE = ctxFor(s, 'place E');
    for (let i = 0; i < 5; i++) expect(code(await s.service.useEmailReset(fromE, { name: 'Alice', code: WRONG, newPassword: NEW_PW }))).toBe('emailCodeInvalid');
    expect(code(await s.service.useEmailReset(fromE, { name: 'Alice', code: right, newPassword: NEW_PW }))).toBe('emailCodeInvalid');
    value(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'place F'), { name: 'Alice', code: right, newPassword: NEW_PW })));
  });
});

describe('M14-8: tries per (code, address key) have the /56 and /48 aggregates (8.1; review finding 2)', () => {
  it('a code\'s tries hold four times per /56 and sixteen times per /48: the right code is then no longer compared from there', async () => {
    // one try per (code, /64), so 4 per (code, /56) and 16 per (code, /48); the per-address limit far above it
    const s = recordingSetup({ env: { ACCOUNTS_EMAIL_CODE_TRIES_PER_ADDRESS: '1', ACCOUNTS_EMAIL_CODE_FAILURES_PER_HOUR: '100' } });
    const right = await aliceWithCode(s);
    const at = (address: string, typed: string) =>
      s.service.useEmailReset(ctxFor(s, 'someone', { addressKey: address }), { name: 'Alice', code: typed, newPassword: NEW_PW });
    for (let j = 0; j < 4; j++) expect(code(await at(v6(9, 0, j), WRONG))).toBe('emailCodeInvalid');
    // a fifth /64 of that /56: its own counter is fresh, the /56's is spent
    expect(code(await at(v6(9, 0, 4), right))).toBe('emailCodeInvalid');
    for (let k = 1; k < 4; k++) for (let j = 0; j < 4; j++) expect(code(await at(v6(9, k, j), WRONG))).toBe('emailCodeInvalid');
    // a fresh /56 of that /48: the /48's 16 are spent
    expect(code(await at(v6(9, 4), right))).toBe('emailCodeInvalid');
    // another /48 is apart: signed in
    expect(value(inRow('useEmailReset', await at(v6(10, 0), right))).account.name).toBe('Alice');
  });
});

describe('M14-8: the limiter\'s until and fail-open (review findings 1 and 2)', () => {
  const limits = (over: Partial<AccountRateLimits> = {}): AccountRateLimits => ({ ...ACCOUNT_RATE_LIMITS, ...over });
  const idleLoad = () => ({ running: 0, queued: { high: 0, normal: 0, low: 0 } as Record<HashPriority, number>, capacity: 64 });
  const at = (ms: number) => new Date(T0 + ms);
  const until = at(15 * MIN);

  it('a bucket made with until holds until then and is forgotten at that moment, full or not; an until that is no time is ignored', () => {
    const r = buildRateLimiter({ limits: limits(), verifier: 'none', hashLoad: idleLoad });
    const k = { other: 'ec_A', addressKey: '192.0.2.1', until };
    for (let i = 0; i < 5; i++) expect(r.take('emailCodeTry', k, at(0)).ok).toBe(true);
    expect(r.take('emailCodeTry', k, at(0)).ok).toBe(false);
    expect(r.take('emailCodeTry', k, at(15 * MIN - 1)).ok).toBe(false);
    expect(r.take('emailCodeTry', k, at(15 * MIN)).ok).toBe(true);
    const bad = { other: 'ec_B', addressKey: '192.0.2.1', until: new Date(Number.NaN) };
    for (let i = 0; i < 5; i++) expect(r.take('emailCodeTry', bad, at(0)).ok).toBe(true);
    expect(r.take('emailCodeTry', bad, at(MIN)).ok).toBe(false);
  });

  it('emailCodeTry fails open on a full map, every other rule closed; buckets past until make room again (the sweep and a new key)', () => {
    const r = buildRateLimiter({ limits: limits({ counterEntries: 2 }), verifier: 'none', hashLoad: idleLoad });
    for (const a of ['192.0.2.1', '192.0.2.2']) expect(r.take('emailCodeTry', { other: 'ec_A', addressKey: a, until }, at(0)).ok).toBe(true);
    // full of buckets in use: a third key is not tracked and is let through, every time
    const third = { other: 'ec_B', addressKey: '192.0.2.3', until: at(30 * MIN) };
    for (let i = 0; i < 8; i++) expect(r.take('emailCodeTry', third, at(MIN)).ok).toBe(true);
    // a fail-closed rule on a full map refuses
    for (const a of ['192.0.2.1', '192.0.2.2']) expect(r.take('emailCodeFailure', { addressKey: a }, at(0)).ok).toBe(true);
    expect(r.take('emailCodeFailure', { addressKey: '192.0.2.3' }, at(0))).toEqual({ ok: false, retryAfterMs: ACCOUNT_RATE_LIMITS.counterFullRetryMs });
    // once ec_A expired its counters go (here by the sweep): the third key is tracked, 5 tries and no more
    r.sweep(at(15 * MIN));
    for (let i = 0; i < 5; i++) expect(r.take('emailCodeTry', third, at(16 * MIN)).ok).toBe(true);
    expect(r.take('emailCodeTry', third, at(16 * MIN)).ok).toBe(false);
    // and without a sweep: a map that needs room forgets what is past its until first
    const fourth = { other: 'ec_C', addressKey: '192.0.2.4', until: at(60 * MIN) };
    for (let i = 0; i < 5; i++) expect(r.take('emailCodeTry', fourth, at(31 * MIN)).ok).toBe(true);
    expect(r.take('emailCodeTry', fourth, at(31 * MIN)).ok).toBe(false);
  });

  it('(code, address) holds four times per /56 and sixteen times per /48 at the limiter too', () => {
    const r = buildRateLimiter({ limits: limits({ emailCodeTriesPerAddress: 1 }), verifier: 'none', hashLoad: idleLoad });
    let ok = 0;
    for (let k = 0; k < 8; k++) for (let j = 0; j < 8; j++) if (r.take('emailCodeTry', { other: 'ec_A', addressKey: v6(7, k, j), until }, at(0)).ok) ok++;
    // 4 per /56 for 4 /56s, then the /48's 16 are spent
    expect(ok).toBe(16);
    expect(r.take('emailCodeTry', { other: 'ec_B', addressKey: v6(7, 0, 0), until }, at(0)).ok).toBe(true);
  });
});

