/**
 * M14-8: the email address grammar (design 3.4, 11.1 emailProblem) on fixed lists: accepted addresses and their stored form (trimmed, the domain
 * lower-cased, the local part as typed); refused ones with their problem; the same answers through the contract's re-export and through the
 * service (emailInvalid with the problem, never the address). And the email codes' form (./codes.ts): 10 characters of Crockford base32, the
 * look-alikes mapped, the hash bound to the account and the address.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS, emailProblem as fromContract, type EmailProblem } from '@openmtg/accounts/api';
import { EMAIL_PROBLEM_MESSAGES, EMAIL_RAW_MAX, emailProblem } from '../../src/api/email';
import { emailCodeHash, emailCodeKeys, emailTargetKey, formatEmailCode, newEmailCode, normalizeEmailCode } from '../../src/email/codes';
import { code, ctxFor, fixedRandom, inRow, PW, recordingSetup, registerWith, value } from './support';

const LOCAL64 = 'l'.repeat(64);
const LABEL63 = 'd'.repeat(63);
/** 254 characters in all: a local part of 64, the "@", and a domain of 189 (labels of 63, 63 and 61 with their dots). */
const LONGEST = `${LOCAL64}@${LABEL63}.${LABEL63}.${'e'.repeat(254 - 64 - 1 - 63 - 1 - 63 - 1)}`;

/** Accepted: [typed, stored]. */
const ACCEPTED: readonly [string, string][] = [
  ['alice@example.org', 'alice@example.org'],
  ['  Alice.Smith@Example.ORG  ', 'Alice.Smith@example.org'],
  [' bob@example.org ', 'bob@example.org'],
  ['a@b.co', 'a@b.co'],
  ["o'brien+openmtg@mail.example.co.uk", "o'brien+openmtg@mail.example.co.uk"],
  ["x!#$%&'*+/=?^_`{|}~-y@example.org", "x!#$%&'*+/=?^_`{|}~-y@example.org"],
  ['first.last@sub-domain.example.com', 'first.last@sub-domain.example.com'],
  ['user@xn--bcher-kva.example', 'user@xn--bcher-kva.example'],
  ['digits@1.example', 'digits@1.example'],
  ['top@example.c0m', 'top@example.c0m'],
  ['UPPER@EXAMPLE.NET', 'UPPER@example.net'],
  [`${LOCAL64}@example.org`, `${LOCAL64}@example.org`],
  [`a@${LABEL63}.org`, `a@${LABEL63}.org`],
  [LONGEST, LONGEST],
];

/** Refused: [typed, problem]. */
const REFUSED: readonly [unknown, EmailProblem][] = [
  [42, 'type'], [null, 'type'], [undefined, 'type'], [{ address: 'a@b.co' }, 'type'], [['a@b.co'], 'type'],
  ['x'.repeat(EMAIL_RAW_MAX + 1), 'long'],
  [`${LONGEST}e`, 'long'],
  ['bob@exämple.org', 'nonAscii'], ['bób@example.org', 'nonAscii'], ['bob@例え.jp', 'nonAscii'], ['bob@example.org​', 'nonAscii'],
  ['Alice <alice@example.org>', 'syntax'], ['<alice@example.org>', 'syntax'], ['alice@example.org (Alice)', 'syntax'],
  ['"alice"@example.org', 'syntax'], ['"a b"@example.org', 'syntax'], ['a\\b@example.org', 'syntax'], ['alice@[192.0.2.1]', 'syntax'],
  ['alice@[IPv6:2001:db8::1]', 'syntax'], ['alice@example.org, bob@example.org', 'syntax'], ['alice@example.org;bob@example.org', 'syntax'],
  ['friends: alice@example.org;', 'syntax'], ['ali ce@example.org', 'syntax'], ['alice@exa mple.org', 'syntax'], ['alice\t@example.org', 'syntax'],
  ['alice@example.org\nbcc@example.org', 'syntax'], ['alice.example.org', 'syntax'], ['alice@@example.org', 'syntax'], ['a@b@example.org', 'syntax'],
  ['', 'syntax'], ['   ', 'syntax'], ['alice\u007f@example.org', 'syntax'],
  ['@example.org', 'local'], ['.alice@example.org', 'local'], ['alice.@example.org', 'local'], ['al..ice@example.org', 'local'],
  [`${LOCAL64}l@example.org`, 'local'],
  ['alice@', 'domain'], ['alice@localhost', 'domain'], ['alice@example..org', 'domain'], ['alice@.example.org', 'domain'],
  ['alice@example.org.', 'domain'], ['alice@-example.org', 'domain'], ['alice@example-.org', 'domain'], ['alice@192.0.2.1', 'domain'],
  ['alice@example.123', 'domain'], ['alice@exa_mple.org', 'domain'], ['alice@exa!mple.org', 'domain'], [`alice@${LABEL63}d.org`, 'domain'],
];

describe('M14-8: the address grammar (3.4) on fixed lists', () => {
  it('accepts one plain addr-spec and gives its stored form', () => {
    expect(LONGEST.length).toBe(ACCOUNT_LIMITS.emailMax);
    for (const [typed, stored] of ACCEPTED) expect(emailProblem(typed), JSON.stringify(typed)).toEqual({ ok: true, address: stored });
  });

  it('refuses everything else with its problem', () => {
    for (const [typed, problem] of REFUSED) expect(emailProblem(typed), JSON.stringify(typed)?.slice(0, 80)).toEqual({ ok: false, problem });
  });

  it('the contract re-exports the same function, and every problem has a message that repeats nothing typed', () => {
    expect(fromContract).toBe(emailProblem);
    const problems = new Set(REFUSED.map(([, p]) => p));
    expect([...problems].sort()).toEqual(Object.keys(EMAIL_PROBLEM_MESSAGES).sort());
    for (const m of Object.values(EMAIL_PROBLEM_MESSAGES)) expect(m).not.toMatch(/alice|bob/i);
  });

  it('the service refuses the same list with emailInvalid and the problem (never the address), and stores the stored form', async () => {
    const s = recordingSetup();
    const reg = await registerWith(s, 'Alice');
    const ctx = ctxFor(s, 'alice');
    for (const [typed, problem] of REFUSED.filter(([t]) => typeof t === 'string' && t.length <= EMAIL_RAW_MAX && !/[\t\n\u007f]/.test(t))) {
      const r = inRow('setEmail', await s.service.setEmail(ctx, reg.auth, typed as string, { password: PW }));
      expect(code(r), String(typed)).toBe('emailInvalid');
      if (!r.ok) {
        expect(r.error.details).toEqual([problem]);
        if ((typed as string).length > 0) expect(r.error.message).not.toContain(typed as string);
      }
    }
    // a control character is refused by the text rules first (badMessage), as everywhere in the service
    expect(code(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, 'alice\t@example.org', { password: PW })))).toBe('badMessage');
    const set = value(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, '  Alice.Smith@Example.ORG ', { password: PW })));
    expect(set.email).toEqual({ address: 'Alice.Smith@example.org', verified: false });
    // register refuses alike
    const bad = await s.service.register(ctxFor(s, 'register Bob'), { name: 'Bob', password: PW, birth: { year: 1990, month: 5 }, claimGuest: false, email: 'Bob <bob@example.org>' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'emailInvalid', details: ['syntax'] } });
  });
});

describe('M14-8: the email codes (3.4)', () => {
  it('10 Crockford base32 characters from 50 random bits, mailed in two groups, typed with look-alikes mapped', () => {
    const random = fixedRandom('codes');
    const codes = Array.from({ length: 50 }, () => newEmailCode(random));
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(new Set(codes).size).toBe(50);
    // the top 50 bits of 7 bytes: all ones gives ten Z, all zeros ten 0
    expect(newEmailCode((n) => new Uint8Array(n).fill(0xff))).toBe('ZZZZZZZZZZ');
    expect(newEmailCode((n) => new Uint8Array(n))).toBe('0000000000');
    expect(formatEmailCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
    expect(normalizeEmailCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizeEmailCode(' ab cde-fgh jk ')).toBe('ABCDEFGHJK');
    expect(normalizeEmailCode('OOOOO-IIILL')).toBe('0000011111');
    for (const bad of ['ABCDEFGHJ', 'ABCDEFGHJKM', 'ABCDEFGHJU', 'ABCDE_FGHJK', 'x'.repeat(33), 12, null]) expect(normalizeEmailCode(bad), String(bad)).toBeNull();
  });

  it('the stored hash is bound to the purpose, the account and the address; the target key folds case and "+tags"', () => {
    const a = 'acc_00000000000000000000000001';
    const b = 'acc_00000000000000000000000002';
    const h = emailCodeHash('verify', a, 'alice@example.org', 'ABCDEFGHJK');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(emailCodeHash('verify', a, 'alice@example.org', 'ABCDEFGHJK')).toBe(h);
    for (const other of [
      emailCodeHash('reset', a, 'alice@example.org', 'ABCDEFGHJK'), emailCodeHash('verify', b, 'alice@example.org', 'ABCDEFGHJK'),
      emailCodeHash('verify', a, 'alice@example.net', 'ABCDEFGHJK'), emailCodeHash('verify', a, 'alice@example.org', 'ABCDEFGHJM'),
    ]) expect(other).not.toBe(h);
    expect(emailTargetKey('Victim+openmtg@Example.ORG')).toBe('victim@example.org');
    expect(emailTargetKey('victim@example.org')).toBe('victim@example.org');
    expect(emailTargetKey('+x@example.org')).toBe('+x@example.org');
  });

  it('under a pepper: one key per pepper, newest first; an HMAC per key, none of them the plain hash (review finding 5)', () => {
    const a = 'acc_00000000000000000000000001';
    expect(emailCodeKeys([])).toEqual([]);
    const keys = emailCodeKeys([{ id: 'k1', secret: 'test-pepper-one-never-a-real-secret-0001' }, { id: 'k2', secret: 'test-pepper-two-never-a-real-secret-0002' }]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual(emailCodeKeys([{ id: 'k2', secret: 'test-pepper-two-never-a-real-secret-0002' }])[0]);
    const plain = emailCodeHash('reset', a, 'alice@example.org', 'ABCDEFGHJK');
    const under = keys.map((k) => emailCodeHash('reset', a, 'alice@example.org', 'ABCDEFGHJK', k));
    for (const h of under) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([plain, ...under]).size).toBe(3);
    expect(emailCodeHash('reset', a, 'alice@example.org', 'ABCDEFGHJK', keys[0]!)).toBe(under[0]);
  });

  it('the target key of gmail.com and googlemail.com drops the dots of the local part, which Gmail ignores; other domains keep them (review finding 4)', () => {
    for (const a of ['victim@gmail.com', 'v.ictim@gmail.com', 'Vic.Tim+x@GoogleMail.com', 'v.i.c.t.i.m@googlemail.com']) {
      expect(emailTargetKey(a), a).toBe('victim@gmail.com');
    }
    expect(emailTargetKey('first.last@example.org')).toBe('first.last@example.org');
    expect(emailTargetKey('first.last@mail.gmail.com')).toBe('first.last@mail.gmail.com');
    expect(emailTargetKey('first.last@gmail.co')).toBe('first.last@gmail.co');
  });
});
