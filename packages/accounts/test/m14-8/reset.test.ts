/**
 * M14-8: the email reset (design 3.4, 4.4, 8.1): the same answer for every name, returned before the mailer resolves (the work runs after the
 * answer); 3 requests a day per account and at most 3 live codes, a new request never voiding one; code expiry; tries per (code, address key);
 * an attacker's requests and wrong codes never void the owner's code; a used reset acts as a recovery-code sign-in (the other sessions revoked,
 * the device proofs but the one sent deleted, the notice sent); design 17's F7 case: the email rule only after the code matched. From the review of
 * M14-8: nothing of the name is looked up, limited or written before the answer; two uses of one code at once sign in once; every try makes the
 * same comparisons with the core's one comparison; codes hashed under the pepper when one is set, across a restart that rotates it.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryAccountStore, parsePeppers, tokenHash, type AccountId, type AccountResult, type SanctionKind } from '@openmtg/accounts';
import { emailCodeHash, emailCodeKeys } from '../../src/email/codes';
import {
  auditOf, Clock, code, codeOf, ctxFor, DAY, equal, HOUR, inRow, MIN, PW, recordingSetup, recordLimits, registerVerified, registerWith, spyStore,
  until, value, type LimitCall, type MailSetup, type RecordingMailer,
} from './support';

const ALICE = 'alice.liddell@example.org';
const NEW_PW = 'a brand new passphrase';

const resetsTo = (m: RecordingMailer, to: string) => m.sent.filter((x) => x.to === to && x.meta.kind === 'reset');

async function sanction(s: MailSetup, account: AccountId, kind: SanctionKind): Promise<void> {
  const now = s.clock.now().toISOString();
  await s.store.putSanction({
    id: 'san_01J00000000000000000000001', account, kind, reason: 'other', message: 'Please read the rules.', note: null, since: now, until: null,
    endedAt: null, endReason: null, endedBy: null, createdAt: now, createdBy: 'admin:op', reports: [], seenAt: null,
  });
}

describe('M14-8: a reset request answers alike for every name (3.4)', () => {
  it('the same answer for every name, returned before the fake mailer resolves; mails only to verified addresses', async () => {
    const s = recordingSetup();
    const alice = await registerVerified(s, 'Alice', ALICE);
    await registerWith(s, 'Bruno', 'bruno@example.org');
    await registerWith(s, 'Carol');
    const dave = await registerVerified(s, 'Dave', 'dave@example.org');
    await sanction(s, dave.auth.account, 'ban');
    s.mailer.sent.length = 0;
    s.mailer.calls = 0;
    s.mailer.resolved = 0;
    s.mailer.hold = true;
    const answers: AccountResult<void>[] = [];
    for (const name of ['Alice', 'Bruno', 'Carol', 'Dave', 'Nobody Here', 'ALICE', 'ad']) {
      answers.push(inRow('requestEmailReset', await s.service.requestEmailReset(ctxFor(s, `reset ${name}`), name)));
      // answered before anything was mailed: the lookup, the code and the mail come after the answer
      expect(s.mailer.calls).toBe(0);
    }
    for (const a of answers) expect(JSON.stringify(a)).toBe(JSON.stringify({ ok: true, value: undefined }));
    // the first mail is now being sent and held: the answers came long before it resolved
    await until(() => s.mailer.calls === 1);
    expect(s.mailer.resolved).toBe(0);
    s.mailer.release();
    await s.idle();
    expect(s.mailer.sent.map((m) => [m.to, m.meta.kind])).toEqual([[ALICE, 'reset'], ['dave@example.org', 'reset'], [ALICE, 'reset']]);
    expect(resetsTo(s.mailer, ALICE)[0]!.text).toContain('"Alice"');
    const events = (await auditOf(s)).filter((e) => e.kind === 'emailResetRequested');
    expect(events.map((e) => [e.account, e.details])).toEqual(
      expect.arrayContaining([
        [alice.auth.account, { sent: true }], [dave.auth.account, { sent: true }], [alice.auth.account, { sent: true }],
      ]),
    );
    expect(events).toHaveLength(5);
    // a banned account's owner gets back in with the code, to a restricted session (3.8)
    const r = value(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'dave'), { name: 'Dave', code: codeOf(resetsTo(s.mailer, 'dave@example.org')[0]), newPassword: NEW_PW })));
    expect(r.account).toMatchObject({ status: 'banned', restricted: true });
  });

  it('3 an hour per address key (rateLimited, for every name alike); malformed requests answer badMessage', async () => {
    const s = recordingSetup();
    await registerVerified(s, 'Alice', ALICE);
    const ctx = ctxFor(s, 'one place');
    for (const name of ['Alice', 'Nobody', 'Alice']) value(inRow('requestEmailReset', await s.service.requestEmailReset(ctx, name)));
    const a = inRow('requestEmailReset', await s.service.requestEmailReset(ctx, 'Alice'));
    const b = inRow('requestEmailReset', await s.service.requestEmailReset(ctx, 'Nobody'));
    expect(code(a)).toBe('rateLimited');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(code(inRow('requestEmailReset', await s.service.requestEmailReset(ctx, 42 as never)))).toBe('badMessage');
    expect(code(inRow('requestEmailReset', await s.service.requestEmailReset(ctx, 'x'.repeat(257))))).toBe('badMessage');
    s.clock.advance(HOUR);
    value(inRow('requestEmailReset', await s.service.requestEmailReset(ctxFor(s, 'one place'), 'Alice')));
  });
});

describe('M14-8: nothing of the name before the answer (3.4; review finding 6)', () => {
  it('a store and rate limits that record every call: at the answer, only the per-address limit ran; the lookup, the per-account limit and the code after it', async () => {
    const storeCalls: string[] = [];
    const limitCalls: LimitCall[] = [];
    const store = spyStore(createMemoryAccountStore({ emailResetLiveCodes: 3 }), storeCalls);
    const s = recordingSetup({ store, deps: recordLimits(limitCalls) });
    await registerVerified(s, 'Alice', ALICE);
    for (const name of ['Alice', 'Nobody Here']) {
      storeCalls.length = 0;
      limitCalls.length = 0;
      value(inRow('requestEmailReset', await s.service.requestEmailReset(ctxFor(s, `asks for ${name}`), name)));
      expect(storeCalls).toEqual([]);
      expect(limitCalls.map((c) => [c.rule, Object.keys(c.key)])).toEqual([['emailResetRequest', ['addressKey']]]);
      await s.idle();
      // after the answer: the account looked up by the name's key, and for Alice her limit and her new code
      expect(storeCalls.length).toBeGreaterThan(0);
      expect(storeCalls.includes('putEmailCode')).toBe(name === 'Alice');
      expect(limitCalls.slice(1).map((c) => [c.rule, Object.keys(c.key)])).toEqual(name === 'Alice' ? [['emailResetRequest', ['account']]] : []);
    }
    expect(resetsTo(s.mailer, ALICE)).toHaveLength(1);
  });
});

describe('M14-8: live reset codes (3.4)', () => {
  it('3 live codes; a new request never voids one; the caps stop new mails, never a code already sent; a day later again', async () => {
    const s = recordingSetup();
    const alice = await registerVerified(s, 'Alice', ALICE);
    for (let i = 0; i < 3; i++) value(await s.service.requestEmailReset(ctxFor(s, `asker ${i}`), 'Alice'));
    await s.idle();
    const codes = resetsTo(s.mailer, ALICE).map(codeOf);
    expect(new Set(codes).size).toBe(3);
    expect(await s.store.liveEmailCodes(alice.auth.account, 'reset', s.clock.now().toISOString())).toHaveLength(3);
    // a 4th request: answered alike, no mail
    value(await s.service.requestEmailReset(ctxFor(s, 'asker 3'), 'Alice'));
    // and once the codes expired, the day's 3 requests are spent: still no mail
    s.clock.advance(20 * MIN);
    value(await s.service.requestEmailReset(ctxFor(s, 'asker 4'), 'Alice'));
    await s.idle();
    expect(resetsTo(s.mailer, ALICE)).toHaveLength(3);
    const sentFalse = (await auditOf(s, alice.auth.account)).filter((e) => e.kind === 'emailResetRequested' && !(e.details as { sent: boolean }).sent);
    expect(sentFalse).toHaveLength(2);
    // a day later the account gets mail again, and the first code of the day before has expired
    s.clock.advance(DAY);
    value(await s.service.requestEmailReset(ctxFor(s, 'asker 5'), 'Alice'));
    await s.idle();
    expect(resetsTo(s.mailer, ALICE)).toHaveLength(4);
    expect(code(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'alice'), { name: 'Alice', code: codes[0]!, newPassword: NEW_PW })))).toBe('emailCodeInvalid');
  });

  it('the first of 3 live codes still works after the other two requests; using one voids the rest', async () => {
    const s = recordingSetup();
    await registerVerified(s, 'Alice', ALICE);
    for (let i = 0; i < 3; i++) value(await s.service.requestEmailReset(ctxFor(s, `asker ${i}`), 'Alice'));
    await s.idle();
    const codes = resetsTo(s.mailer, ALICE).map(codeOf);
    const ctx = ctxFor(s, 'alice');
    value(inRow('useEmailReset', await s.service.useEmailReset(ctx, { name: 'alice', code: codes[0]!, newPassword: NEW_PW })));
    expect(code(inRow('useEmailReset', await s.service.useEmailReset(ctx, { name: 'Alice', code: codes[0]!, newPassword: 'yet another passphrase' })))).toBe('emailCodeInvalid');
    expect(code(inRow('useEmailReset', await s.service.useEmailReset(ctx, { name: 'Alice', code: codes[2]!, newPassword: 'yet another passphrase' })))).toBe('emailCodeInvalid');
  });

  it('a code expires after 15 minutes', async () => {
    const s = recordingSetup();
    await registerVerified(s, 'Alice', ALICE);
    await registerVerified(s, 'Bruno', 'bruno@example.org');
    value(await s.service.requestEmailReset(ctxFor(s, 'asker a'), 'Alice'));
    value(await s.service.requestEmailReset(ctxFor(s, 'asker b'), 'Bruno'));
    await s.idle();
    s.clock.advance(15 * MIN - 1);
    value(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'alice'), { name: 'Alice', code: codeOf(resetsTo(s.mailer, ALICE)[0]), newPassword: NEW_PW })));
    s.clock.advance(1);
    const late = inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'bruno'), { name: 'Bruno', code: codeOf(resetsTo(s.mailer, 'bruno@example.org')[0]), newPassword: NEW_PW }));
    expect(code(late)).toBe('emailCodeInvalid');
    // the old password still signs in: nothing changed
    value(inRow('signIn', await s.service.signIn(ctxFor(s, 'bruno'), { name: 'Bruno', password: PW })));
  });
});

describe('M14-8: nobody else can slow or void the owner\'s code (3.4, 12.1)', () => {
  it('wrong codes from address key A do not slow a valid code from address key B', async () => {
    const s = recordingSetup();
    await registerVerified(s, 'Alice', ALICE);
    value(await s.service.requestEmailReset(ctxFor(s, 'asker'), 'Alice'));
    await s.idle();
    const right = codeOf(resetsTo(s.mailer, ALICE)[0]);
    const fromA = ctxFor(s, 'place A');
    for (let i = 0; i < 6; i++) {
      expect(code(inRow('useEmailReset', await s.service.useEmailReset(fromA, { name: 'Alice', code: `ZZZZZZZZZ${i}`, newPassword: NEW_PW })))).toBe('emailCodeInvalid');
    }
    // A's 5 tries of the code are spent: even the right one fails from A
    expect(code(inRow('useEmailReset', await s.service.useEmailReset(fromA, { name: 'Alice', code: right, newPassword: NEW_PW })))).toBe('emailCodeInvalid');
    // the same moment, from B: signed in at once
    const fromB = ctxFor(s, 'place B');
    expect(fromB.addressKey).not.toBe(fromA.addressKey);
    const r = value(inRow('useEmailReset', await s.service.useEmailReset(fromB, { name: 'Alice', code: right, newPassword: NEW_PW })));
    expect(r.account.name).toBe('Alice');
  });

  it('an attacker\'s reset requests and wrong codes do not void the owner\'s code, and only mail the owner\'s own inbox', async () => {
    const s = recordingSetup();
    const alice = await registerVerified(s, 'Alice', ALICE);
    const owner = ctxFor(s, 'the owner at home');
    value(await s.service.requestEmailReset(owner, 'Alice'));
    await s.idle();
    const mine = codeOf(resetsTo(s.mailer, ALICE)[0]);
    // the attacker: more requests from other address keys, and 5 wrong codes from each of 20 address keys
    for (let i = 0; i < 4; i++) value(await s.service.requestEmailReset(ctxFor(s, `attacker request ${i}`), 'alice'));
    for (let k = 0; k < 20; k++) {
      const ctx = ctxFor(s, `attacker ${k}`);
      for (let i = 0; i < 5; i++) {
        const guess = `${'0123456789ABCDEFGHJK'[k]}${'ZZZZZZZZ'}${i}`;
        expect(code(await s.service.useEmailReset(ctx, { name: 'Alice', code: guess, newPassword: NEW_PW }))).toBe('emailCodeInvalid');
      }
    }
    await s.idle();
    // every mail went to the owner's address, and no more than the 3 live codes allow
    expect(s.mailer.sent.filter((m) => m.meta.kind === 'reset').every((m) => m.to === ALICE)).toBe(true);
    expect(resetsTo(s.mailer, ALICE)).toHaveLength(3);
    const r = value(inRow('useEmailReset', await s.service.useEmailReset(owner, { name: 'Alice', code: mine, newPassword: NEW_PW })));
    expect(r.auth.account).toBe(alice.auth.account);
  });
});

describe('M14-8: a used reset is a recovery-code sign-in (3.4, 4.4)', () => {
  it('sets the password, signs in, revokes every other session and deletes every device proof but the one sent; audited; the notice sent', async () => {
    const s = recordingSetup();
    const alice = await registerVerified(s, 'Alice', ALICE);
    const laptop = value(inRow('signIn', await s.service.signIn(ctxFor(s, 'laptop'), { name: 'Alice', password: PW })));
    expect(laptop.device).not.toBe(alice.device);
    value(await s.service.requestEmailReset(ctxFor(s, 'phone'), 'Alice'));
    await s.idle();
    const before = s.mailer.sent.length;
    const changes = await s.service.changesHead();
    const r = value(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'phone'), {
      name: 'Alice', code: codeOf(resetsTo(s.mailer, ALICE)[0]), newPassword: NEW_PW, device: alice.device,
    })));
    expect(r.device).toBe(alice.device);
    expect(r.rotation).toBe(0);
    expect(r.account).toMatchObject({ name: 'Alice', status: 'active', restricted: false, email: { address: ALICE, verified: true } });
    // the others are revoked; the new session works
    expect(code(await s.service.self(ctxFor(s, 'register Alice'), alice.auth))).toBe('sessionRevoked');
    expect(code(await s.service.self(ctxFor(s, 'laptop'), laptop.auth))).toBe('sessionRevoked');
    value(await s.service.self(ctxFor(s, 'phone'), r.auth));
    // the device proof sent stays; the laptop's is gone
    expect(await s.store.device(tokenHash(alice.device))).not.toBeNull();
    expect(await s.store.device(tokenHash(laptop.device))).toBeNull();
    // the password changed
    expect(code(await s.service.signIn(ctxFor(s, 'laptop again'), { name: 'Alice', password: PW }))).toBe('badCredentials');
    value(await s.service.signIn(ctxFor(s, 'laptop again'), { name: 'Alice', password: NEW_PW }));
    // the change feed names the session that stays
    const feed = await s.service.changes(changes, 10);
    expect(feed.find((c) => c.kind === 'sessionsRevoked')).toMatchObject({ account: alice.auth.account, detail: { except: r.auth.session } });
    // the notice, to the verified address
    await s.idle();
    expect(s.mailer.sent.slice(before).map((m) => [m.to, m.meta.kind, m.subject])).toEqual([[ALICE, 'notice', 'Your OpenMTG password was reset by email']]);
    const events = await auditOf(s, alice.auth.account);
    const of = (kind: string) => events.filter((e) => e.kind === kind && e.session === r.auth.session).map((e) => e.details);
    expect(of('emailResetUsed')).toEqual([{}]);
    expect(of('passwordChanged')).toEqual([{ via: 'emailReset' }]);
    expect(of('signedIn')).toEqual([{ provider: 'local', device: true, restricted: false }]);
    expect(events.filter((e) => e.kind === 'sessionsRevoked').map((e) => e.details)).toContainEqual({ reason: 'emailReset', count: 2 });
  });

  it('busy while the guest session is seated; bad fields answer badMessage; an unknown name answers as a wrong code', async () => {
    const s = recordingSetup();
    await registerVerified(s, 'Alice', ALICE);
    const ctx = ctxFor(s, 'someone');
    expect(code(inRow('useEmailReset', await s.service.useEmailReset({ ...ctx, guestBusy: true }, { name: 'Alice', code: 'ABCDE-FGHJK', newPassword: NEW_PW })))).toBe('busy');
    for (const bad of [
      { name: 1, code: 'ABCDE-FGHJK', newPassword: NEW_PW }, { name: 'Alice', code: 'x'.repeat(33), newPassword: NEW_PW },
      { name: 'Alice', code: 'ABCDE-FGHJK', newPassword: 'x'.repeat(513) }, { name: 'Alice', code: 'ABCDE-FGHJK', newPassword: NEW_PW, device: 'nope' },
    ]) expect(code(inRow('useEmailReset', await s.service.useEmailReset(ctx, bad as never)))).toBe('badMessage');
    const unknown = inRow('useEmailReset', await s.service.useEmailReset(ctx, { name: 'Nobody Here', code: 'ABCDE-FGHJK', newPassword: NEW_PW }));
    const wrong = inRow('useEmailReset', await s.service.useEmailReset(ctx, { name: 'Alice', code: 'ABCDE-FGHJK', newPassword: NEW_PW }));
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(wrong));
    expect(code(wrong)).toBe('emailCodeInvalid');
  });
});

describe('M14-8: the email rule only after the code matched (design 17, F7)', () => {
  it('a wrong code with a password holding the email\'s local part answers emailCodeInvalid, exactly as any other; a valid one passwordWeak, the code kept', async () => {
    const s = recordingSetup();
    await registerVerified(s, 'Alice', 'wonderlandrabbit@example.org');
    value(await s.service.requestEmailReset(ctxFor(s, 'asker'), 'Alice'));
    await s.idle();
    const right = codeOf(resetsTo(s.mailer, 'wonderlandrabbit@example.org')[0]);
    const withLocal = 'my wonderlandrabbit secret';
    const ctx = ctxFor(s, 'alice');
    const a = inRow('useEmailReset', await s.service.useEmailReset(ctx, { name: 'Alice', code: 'ZZZZZ-ZZZZZ', newPassword: withLocal }));
    const b = inRow('useEmailReset', await s.service.useEmailReset(ctx, { name: 'Alice', code: 'ZZZZZ-ZZZZZ', newPassword: NEW_PW }));
    expect(code(a)).toBe('emailCodeInvalid');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // the same for a name nobody holds
    const c = inRow('useEmailReset', await s.service.useEmailReset(ctx, { name: 'Nobody Here', code: 'ZZZZZ-ZZZZZ', newPassword: withLocal }));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    // a password weak by the request's own name answers passwordWeak for every name, before any code is looked at
    for (const name of ['Alice', 'Nobody Here']) {
      const w = inRow('useEmailReset', await s.service.useEmailReset(ctx, { name, code: right, newPassword: `${name} ${name} ${name}` }));
      expect(w).toMatchObject({ ok: false, error: { code: 'passwordWeak', details: ['containsName'] } });
    }
    // the valid code with the local part: passwordWeak, and the code is not used
    const weak = inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'alice 2'), { name: 'Alice', code: right, newPassword: withLocal }));
    expect(weak).toMatchObject({ ok: false, error: { code: 'passwordWeak', details: ['containsEmail'] } });
    value(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'alice 3'), { name: 'Alice', code: right, newPassword: NEW_PW })));
  });
});

describe('M14-8: codes under the pepper (12.1; review finding 5)', () => {
  const K1 = 'k1:test-pepper-one-never-a-real-secret-0001';
  const K2 = 'k2:test-pepper-two-never-a-real-secret-0002';
  const keysOf = (env: string) => {
    const p = parsePeppers(env);
    if (!p.ok) throw new Error(p.problem);
    return emailCodeKeys(p.peppers);
  };

  it('an HMAC under the newest pepper, never the plain SHA-256; a restart that keeps the old pepper keeps a live code, one that drops it voids it', async () => {
    const clock = new Clock();
    const store = createMemoryAccountStore({ emailResetLiveCodes: 3 });
    const first = recordingSetup({ clock, store, env: { PASSWORD_PEPPERS: K1 } });
    const alice = await registerVerified(first, 'Alice', ALICE);
    const bruno = await registerVerified(first, 'Bruno', 'bruno@example.org');
    for (const name of ['Alice', 'Bruno']) value(await first.service.requestEmailReset(ctxFor(first, `asks for ${name}`), name));
    await first.idle();
    const aliceCode = codeOf(resetsTo(first.mailer, ALICE)[0]);
    const brunoCode = codeOf(resetsTo(first.mailer, 'bruno@example.org')[0]);
    const [row] = await store.liveEmailCodes(alice.auth.account, 'reset', clock.now().toISOString());
    // a copy of the store alone: the plain hash of the right code is not what is stored
    expect(row!.hash).not.toBe(emailCodeHash('reset', alice.auth.account, ALICE, aliceCode));
    expect(row!.hash).toBe(emailCodeHash('reset', alice.auth.account, ALICE, aliceCode, keysOf(K1)[0]!));

    // a restart with a new pepper, the old one kept: Alice's live code still works, and a new code is made under the new pepper
    const rotated = recordingSetup({ clock, store, seed: 'rotated', env: { PASSWORD_PEPPERS: `${K1},${K2}` } });
    value(inRow('useEmailReset', await rotated.service.useEmailReset(ctxFor(rotated, 'alice'), { name: 'Alice', code: aliceCode, newPassword: NEW_PW })));
    value(await rotated.service.requestEmailReset(ctxFor(rotated, 'asks again'), 'Alice'));
    await rotated.idle();
    const [next] = await store.liveEmailCodes(alice.auth.account, 'reset', clock.now().toISOString());
    expect(next!.hash).toBe(emailCodeHash('reset', alice.auth.account, ALICE, codeOf(resetsTo(rotated.mailer, ALICE)[0]), keysOf(`${K1},${K2}`)[0]!));

    // a restart without the pepper Bruno's code was made under: it matches nothing
    const dropped = recordingSetup({ clock, store, seed: 'dropped', env: { PASSWORD_PEPPERS: K2 } });
    const r = inRow('useEmailReset', await dropped.service.useEmailReset(ctxFor(dropped, 'bruno'), { name: 'Bruno', code: brunoCode, newPassword: NEW_PW }));
    expect(code(r)).toBe('emailCodeInvalid');
    expect(await store.liveEmailCodes(bruno.auth.account, 'reset', clock.now().toISOString())).toHaveLength(1);
  });
});

describe('M14-8: a code is used once, compared with the core\'s one comparison (3.4, 11.3, 12.1; review finding 6)', () => {
  it('two uses of one code at once, both past the comparison: exactly one signs in (compare-and-set); only its password is set', async () => {
    const calls: string[] = [];
    let holding = false;
    let arrived = 0;
    // while holding, each use of a code waits until both requests are there, so both have matched the code before either uses it
    const store = spyStore(createMemoryAccountStore({ emailResetLiveCodes: 3 }), calls, {
      useEmailCode: async (own, ...args) => {
        if (holding) {
          arrived++;
          await until(() => arrived >= 2);
        }
        return own(...args);
      },
    });
    const s = recordingSetup({ store });
    await registerVerified(s, 'Alice', ALICE);
    value(await s.service.requestEmailReset(ctxFor(s, 'asker'), 'Alice'));
    await s.idle();
    const right = codeOf(resetsTo(s.mailer, ALICE)[0]);
    holding = true;
    const passwords = ['the phone passphrase here', 'the laptop passphrase here'] as const;
    const answers = await Promise.all([
      s.service.useEmailReset(ctxFor(s, 'phone'), { name: 'Alice', code: right, newPassword: passwords[0] }),
      s.service.useEmailReset(ctxFor(s, 'laptop'), { name: 'Alice', code: right, newPassword: passwords[1] }),
    ]);
    holding = false;
    expect(arrived).toBe(2);
    expect(answers.filter((r) => r.ok)).toHaveLength(1);
    const lost = answers.findIndex((r) => !r.ok);
    expect(code(inRow('useEmailReset', answers[lost]!))).toBe('emailCodeInvalid');
    value(inRow('signIn', await s.service.signIn(ctxFor(s, 'check'), { name: 'Alice', password: passwords[1 - lost]! })));
    expect(code(inRow('signIn', await s.service.signIn(ctxFor(s, 'check'), { name: 'Alice', password: passwords[lost]! })))).toBe('badCredentials');
  });

  it('every try makes the same comparisons with the injected one: slots each, whatever is live, matched or named; times the peppers', async () => {
    let n = 0;
    const counting = (a: Uint8Array, b: Uint8Array): boolean => {
      n++;
      return equal(a, b);
    };
    const s = recordingSetup({ equal: counting });
    const slots = s.config.limits.emailResetLiveCodes;
    await registerVerified(s, 'Alice', ALICE);
    const bruno = await registerWith(s, 'Bruno', 'bruno@example.org');
    const counts: number[] = [];
    const counted = async <T>(f: () => Promise<AccountResult<T>>): Promise<AccountResult<T>> => {
      const before = n;
      const r = await f();
      counts.push(n - before);
      return r;
    };
    const reset = (who: string, name: string, typed: string) =>
      counted(() => s.service.useEmailReset(ctxFor(s, who), { name, code: typed, newPassword: NEW_PW }));
    // no live code, then 1, 2 and 3 of them; an unknown name; a malformed code
    expect(code(await reset('try 0', 'Alice', 'ZZZZZ-ZZZZZ'))).toBe('emailCodeInvalid');
    for (let i = 1; i <= 3; i++) {
      value(await s.service.requestEmailReset(ctxFor(s, `asker ${i}`), 'Alice'));
      await s.idle();
      expect(code(await reset(`try ${i}`, 'Alice', 'ZZZZZ-ZZZZZ'))).toBe('emailCodeInvalid');
    }
    expect(code(await reset('try 4', 'Nobody Here', 'ZZZZZ-ZZZZZ'))).toBe('emailCodeInvalid');
    expect(code(await reset('try 5', 'Alice', 'not a code'))).toBe('emailCodeInvalid');
    // the right code: the first of Alice's three, and the last of Bruno's three verification codes
    value(inRow('useEmailReset', await reset('try 6', 'Alice', codeOf(resetsTo(s.mailer, ALICE)[0]))));
    for (let i = 0; i < 2; i++) value(inRow('setEmail', await s.service.setEmail(ctxFor(s, 'bruno'), bruno.auth, 'bruno@example.org', { password: PW })));
    await s.idle();
    const verifies = s.mailer.to('bruno@example.org').filter((m) => m.meta.kind === 'verify');
    expect(verifies).toHaveLength(3);
    expect(code(await counted(() => s.service.verifyEmail(ctxFor(s, 'bruno'), bruno.auth, 'ZZZZZ-ZZZZZ')))).toBe('emailCodeInvalid');
    value(inRow('verifyEmail', await counted(() => s.service.verifyEmail(ctxFor(s, 'bruno'), bruno.auth, codeOf(verifies[2])))));
    expect(counts).toEqual(Array.from({ length: 9 }, () => slots));

    // with two peppers every try is compared under both
    let m = 0;
    const p = recordingSetup({
      equal: (a, b) => (m++, equal(a, b)),
      env: { PASSWORD_PEPPERS: 'k1:test-pepper-one-never-a-real-secret-0001,k2:test-pepper-two-never-a-real-secret-0002' },
    });
    const before = m;
    expect(code(await p.service.useEmailReset(ctxFor(p, 'someone'), { name: 'Nobody Here', code: 'ZZZZZ-ZZZZZ', newPassword: NEW_PW }))).toBe('emailCodeInvalid');
    expect(m - before).toBe(2 * slots);
  });
});
