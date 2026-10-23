/**
 * M14-8: setting and verifying an address (design 3.4, 5.2, 8.1): verification by the mailed code; the proof in the same request; verification
 * mails limited per account and per target address (taken only after a right proof); code expiry; tries per (code, address key), so wrong codes
 * from one address key never slow a valid code from another; security notices only to a verified address, an email change's and removal's to the
 * old one; NoMailer hides email (emailUnavailable for every name alike, nothing kept).
 */
import { describe, expect, it } from 'vitest';
import { createNoMailer } from '../../src/email/index';
import {
  BIRTH, code, codeOf, ctxFor, DAY, inRow, mailSetup, MIN, PW, PW2, recordingSetup, registerVerified, registerWith, value, type SentMail,
} from './support';

const ALICE = 'alice.liddell@example.org';

describe('M14-8: verification (3.4)', () => {
  it('a registration\'s address gets a code; the code verifies it once; a wrong or malformed code answers emailCodeInvalid', async () => {
    const s = recordingSetup();
    const reg = await registerWith(s, 'Alice', ALICE);
    expect(reg.account.email).toEqual({ address: ALICE, verified: false });
    expect(s.mailer.sent).toHaveLength(1);
    const mail = s.mailer.sent[0]!;
    expect([mail.to, mail.meta.kind, mail.meta.account]).toEqual([ALICE, 'verify', reg.auth.account]);
    // a verification mail names no account and carries nothing anyone typed but the code
    expect(mail.text).not.toContain('Alice');
    expect(mail.meta.expiresAt).toBe(new Date(s.clock.t + 15 * MIN).toISOString());
    const ctx = ctxFor(s, 'alice');
    expect(code(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, 'ZZZZZ-ZZZZZ')))).toBe('emailCodeInvalid');
    expect(code(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, 'not a code')))).toBe('emailCodeInvalid');
    expect(code(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, 'x'.repeat(33))))).toBe('badMessage');
    // typed in lower case with spaces: the look-alike mapping of recovery codes
    const typed = ` ${codeOf(mail).toLowerCase().replace(/(.{5})/, '$1 ')} `;
    const v = value(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, typed)));
    expect(v.email).toEqual({ address: ALICE, verified: true });
    // with when it was set (the registration's moment: review A5, M14-15), which verifying keeps
    const at = s.clock.now().toISOString();
    expect((await s.store.account(reg.auth.account))!.email).toEqual({ address: ALICE, verifiedAt: at, setAt: at });
    // used once; and no code is left for a verified address
    expect(code(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, codeOf(mail))))).toBe('emailCodeInvalid');
    expect(await s.store.liveEmailCodes(reg.auth.account, 'verify', s.clock.now().toISOString())).toEqual([]);
  });

  it('setEmail needs the proof in the same request, at any age of the session; the same verified address again changes nothing', async () => {
    const s = recordingSetup();
    const reg = await registerVerified(s, 'Alice', ALICE);
    const ctx = ctxFor(s, 'alice');
    const sent = s.mailer.sent.length;
    expect(code(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, 'new@example.org', undefined as never)))).toBe('reauthRequired');
    expect(code(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, null, undefined as never)))).toBe('reauthRequired');
    expect(code(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, 'new@example.org', { password: PW2 })))).toBe('badCredentials');
    expect((await s.store.account(reg.auth.account))!.email?.address).toBe(ALICE);
    const same = value(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, ` ${ALICE} `, { password: PW })));
    expect(same.email).toEqual({ address: ALICE, verified: true });
    expect(s.mailer.sent.length).toBe(sent);
  });

  it('an address changed before it is verified: the old address\'s code verifies nothing', async () => {
    const s = recordingSetup();
    const reg = await registerWith(s, 'Alice', ALICE);
    const first = s.mailer.sent[0]!;
    const ctx = ctxFor(s, 'alice');
    value(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, 'other@example.org', { password: PW })));
    await s.idle();
    expect(code(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, codeOf(first))))).toBe('emailCodeInvalid');
    const second = s.mailer.to('other@example.org')[0]!;
    expect(value(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, codeOf(second)))).email).toEqual({ address: 'other@example.org', verified: true });
  });

  it('a code expires after 15 minutes', async () => {
    const s = recordingSetup();
    const a = await registerWith(s, 'Alice', ALICE);
    const b = await registerWith(s, 'Bruno', 'bruno@example.org');
    s.clock.advance(15 * MIN - 1);
    value(inRow('verifyEmail', await s.service.verifyEmail(ctxFor(s, 'alice'), a.auth, codeOf(s.mailer.to(ALICE)[0]))));
    s.clock.advance(1);
    expect(code(inRow('verifyEmail', await s.service.verifyEmail(ctxFor(s, 'bruno'), b.auth, codeOf(s.mailer.to('bruno@example.org')[0]))))).toBe('emailCodeInvalid');
  });
});

describe('M14-8: verification mails are limited (8.1)', () => {
  it('3 a day per account (the registration\'s included); a wrong proof spends none; a day later again', async () => {
    const s = recordingSetup();
    const reg = await registerWith(s, 'Alice', 'one@example.org');
    const ctx = ctxFor(s, 'alice');
    expect(code(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, 'two@example.org', { password: PW2 })))).toBe('badCredentials');
    value(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, 'two@example.org', { password: PW })));
    // the unverified address again is one more mail
    value(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, 'two@example.org', { password: PW })));
    const r = inRow('setEmail', await s.service.setEmail(ctx, reg.auth, 'three@example.org', { password: PW }));
    expect(code(r)).toBe('limitReached');
    if (!r.ok) expect(r.error.retryAfterMs).toBeGreaterThan(0);
    await s.idle();
    expect(s.mailer.sent.map((m) => m.to)).toEqual(['one@example.org', 'two@example.org', 'two@example.org']);
    expect((await s.store.account(reg.auth.account))!.email?.address).toBe('two@example.org');
    // removing never needs a mail, and is never limited
    value(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, null, { password: PW })));
    s.clock.advance(DAY);
    value(inRow('setEmail', await s.service.setEmail(ctxFor(s, 'alice'), reg.auth, 'three@example.org', { password: PW })));
  });

  it('3 a day per target address, whatever its case or "+tag", from any accounts', async () => {
    const s = recordingSetup();
    const typed = ['victim@example.org', 'Victim@Example.org', 'victim+openmtg@example.org'];
    for (const [i, address] of typed.entries()) await registerWith(s, `Sender${'abc'[i]}`, address);
    const d = await registerWith(s, 'Senderd');
    const ctx = ctxFor(s, 'senderd');
    expect(code(inRow('setEmail', await s.service.setEmail(ctx, d.auth, 'VICTIM+again@example.org', { password: PW })))).toBe('limitReached');
    value(inRow('setEmail', await s.service.setEmail(ctx, d.auth, 'someone.else@example.org', { password: PW })));
    await s.idle();
    expect(s.mailer.sent.filter((m) => m.to.toLowerCase().startsWith('victim'))).toHaveLength(3);
  });

  it('Gmail\'s dot variants and googlemail.com are one target address; another domain\'s dots are not folded (review finding 4)', async () => {
    const s = recordingSetup();
    const typed = ['victim@gmail.com', 'v.ictim@gmail.com', 'Vic.Tim+x@googlemail.com'];
    for (const [i, address] of typed.entries()) await registerWith(s, `Sender${'abc'[i]}`, address);
    const d = await registerWith(s, 'Senderd');
    const ctx = ctxFor(s, 'senderd');
    expect(code(inRow('setEmail', await s.service.setEmail(ctx, d.auth, 'vi.ct.im@googlemail.com', { password: PW })))).toBe('limitReached');
    for (const [i, address] of ['first.last@example.org', 'firstlast@example.org', 'f.irstlast@example.org'].entries()) {
      await registerWith(s, `Other${'abc'[i]}`, address);
    }
    await s.idle();
    expect(s.mailer.sent.map((m) => m.to)).toEqual([...typed, 'first.last@example.org', 'firstlast@example.org', 'f.irstlast@example.org']);
  });

  it('3 live verification codes at most (the store\'s cap): a 4th resend before they expire answers limitReached; each live code works', async () => {
    const s = recordingSetup({ env: { ACCOUNTS_VERIFY_MAILS_PER_DAY: '10', ACCOUNTS_VERIFY_MAILS_PER_ADDRESS_PER_DAY: '10' } });
    expect(s.config.limits.emailResetLiveCodes).toBe(3);
    const reg = await registerWith(s, 'Alice', ALICE);
    const ctx = ctxFor(s, 'alice');
    value(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, ALICE, { password: PW })));
    value(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, ALICE, { password: PW })));
    expect(code(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, ALICE, { password: PW })))).toBe('limitReached');
    await s.idle();
    const codes = s.mailer.to(ALICE).map(codeOf);
    expect(codes).toHaveLength(3);
    expect(new Set(codes).size).toBe(3);
    // the oldest still works: a resend voids nothing
    value(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, codes[0]!)));
    // once they expire, the cap is free again (another account, the same moment of the day)
    const other = await registerWith(s, 'Bruno', 'bruno@example.org');
    const bctx = ctxFor(s, 'bruno');
    value(inRow('setEmail', await s.service.setEmail(bctx, other.auth, 'bruno@example.org', { password: PW })));
    value(inRow('setEmail', await s.service.setEmail(bctx, other.auth, 'bruno@example.org', { password: PW })));
    s.clock.advance(15 * MIN);
    value(inRow('setEmail', await s.service.setEmail(ctxFor(s, 'bruno'), other.auth, 'bruno@example.org', { password: PW })));
  });
});

describe('M14-8: tries per (code, address key) (3.4, 8.1)', () => {
  it('wrong codes from address key A do not slow a valid code from address key B; A\'s tries of that code are spent', async () => {
    const s = recordingSetup();
    const reg = await registerWith(s, 'Alice', ALICE);
    const right = codeOf(s.mailer.to(ALICE)[0]);
    const fromA = ctxFor(s, 'place A');
    for (let i = 0; i < 6; i++) {
      const r = inRow('verifyEmail', await s.service.verifyEmail(fromA, reg.auth, `ZZZZZZZZZ${'0123456789'[i]}`));
      expect(r).toEqual({ ok: false, error: { code: 'emailCodeInvalid', message: expect.any(String) } });
    }
    expect(code(inRow('verifyEmail', await s.service.verifyEmail(fromA, reg.auth, right)))).toBe('emailCodeInvalid');
    // the same moment, another address key: the right code works at once
    const fromB = ctxFor(s, 'place B');
    expect(fromB.addressKey).not.toBe(fromA.addressKey);
    expect(value(inRow('verifyEmail', await s.service.verifyEmail(fromB, reg.auth, right))).email?.verified).toBe(true);
  });

  it('a right code counts as a try too: 5 tries in all from one address key', async () => {
    const s = recordingSetup();
    const reg = await registerWith(s, 'Alice', ALICE);
    const right = codeOf(s.mailer.to(ALICE)[0]);
    const ctx = ctxFor(s, 'one place');
    for (let i = 0; i < 4; i++) expect(code(await s.service.verifyEmail(ctx, reg.auth, 'ZZZZZZZZZZ'))).toBe('emailCodeInvalid');
    value(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, right)));
  });
});

describe('M14-8: security notices (3.4)', () => {
  const notices = (sent: SentMail[], to: string) => sent.filter((m) => m.to === to && m.meta.kind === 'notice').map((m) => m.subject);

  it('only to a verified address; an email change\'s to the old address; a removal\'s to the removed address when it was verified', async () => {
    const s = recordingSetup();
    const reg = await registerWith(s, 'Alice', ALICE);
    const ctx = ctxFor(s, 'alice');
    // unverified: no notice for a password change or new codes
    value(inRow('changePassword', await s.service.changePassword(ctx, reg.auth, PW, PW2)));
    value(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctx, reg.auth, { password: PW2 })));
    await s.idle();
    expect(notices(s.mailer.sent, ALICE)).toEqual([]);
    // verified: the notices come
    value(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, codeOf(s.mailer.to(ALICE)[0]))));
    value(inRow('changePassword', await s.service.changePassword(ctx, reg.auth, PW2, PW)));
    const codes = value(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctx, reg.auth, { password: PW })));
    await s.idle();
    expect(notices(s.mailer.sent, ALICE)).toEqual(['Your OpenMTG password was changed', 'New recovery codes for your OpenMTG account']);
    // a recovery-code sign-in
    const rec = value(inRow('useRecoveryCode', await s.service.useRecoveryCode(ctxFor(s, 'alice again'), { name: 'Alice', code: codes.codes[0]!, newPassword: PW2 })));
    await s.idle();
    expect(notices(s.mailer.sent, ALICE).at(-1)).toBe('A recovery code was used on your OpenMTG account');
    // a change: the old, verified address gets the notice; the new one only its code
    const before = s.mailer.sent.length;
    value(inRow('setEmail', await s.service.setEmail(ctx, rec.auth, 'new.home@example.org', { password: PW2 })));
    await s.idle();
    expect(s.mailer.sent.slice(before).map((m) => [m.to, m.meta.kind])).toEqual([['new.home@example.org', 'verify'], [ALICE, 'notice']]);
    expect(notices(s.mailer.sent, ALICE).at(-1)).toBe('The email address of your OpenMTG account was changed');
    // the new address is not verified: nothing for a password change, and nothing for its removal
    const mid = s.mailer.sent.length;
    value(inRow('changePassword', await s.service.changePassword(ctx, rec.auth, PW2, PW)));
    value(inRow('setEmail', await s.service.setEmail(ctx, rec.auth, null, { password: PW })));
    await s.idle();
    expect(s.mailer.sent.length).toBe(mid);
    // a verified address removed gets the removal notice
    value(inRow('setEmail', await s.service.setEmail(ctx, rec.auth, 'third@example.org', { password: PW })));
    await s.idle();
    value(inRow('verifyEmail', await s.service.verifyEmail(ctx, rec.auth, codeOf(s.mailer.to('third@example.org')[0]))));
    const self = value(inRow('setEmail', await s.service.setEmail(ctx, rec.auth, null, { password: PW })));
    expect(self.email).toBeNull();
    await s.idle();
    expect(notices(s.mailer.sent, 'third@example.org')).toEqual(['The email address of your OpenMTG account was removed']);
    // notify itself: the account's verified address only; `to` only for a change's or removal's old address
    await s.part.notify(reg.auth.account, 'passwordChanged', 'someone@example.org');
    await s.idle();
    expect(s.mailer.to('someone@example.org')).toEqual([]);
  });

  it('each notice names the account and gives advice; none holds a code, a password or a link', async () => {
    const s = recordingSetup();
    const reg = await registerVerified(s, 'Alice', ALICE);
    for (const kind of ['passwordChanged', 'recoveryUsed', 'recoveryCodesRenewed', 'emailChanged', 'emailRemoved', 'providerLinked', 'providerUnlinked', 'deletionRequested', 'emailResetUsed', 'inactive'] as const) {
      await s.part.notify(reg.auth.account, kind);
    }
    await s.idle();
    const sent = s.mailer.to(ALICE).filter((m) => m.meta.kind === 'notice');
    expect(sent).toHaveLength(10);
    expect(new Set(sent.map((m) => m.subject)).size).toBe(10);
    for (const m of sent) {
      expect(m.text).toContain('"Alice"');
      expect(m.text).not.toMatch(/https?:|[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}|correct horse/);
      expect(m.meta.expiresAt).toBeNull();
    }
    // an unknown account, and a removed address: nothing, and no throw
    await s.part.notify('acc_00000000000000000000000009', 'passwordChanged');
  });
});

describe('M14-8: NoMailer hides email (3.4)', () => {
  it('setEmail and requestEmailReset answer emailUnavailable for every name alike; register refuses an address; nothing is kept or sent', async () => {
    const s = mailSetup({ mailer: createNoMailer() });
    expect(s.mailer.kind).toBe('none');
    const bad = await s.service.register(ctxFor(s, 'register Carol'), { name: 'Carol', password: PW, birth: BIRTH, claimGuest: false, email: 'carol@example.org' });
    expect(code(inRow('register', bad))).toBe('emailUnavailable');
    const reg = await registerWith(s, 'Alice');
    const ctx = ctxFor(s, 'alice');
    const calls = s.hasher.calls.length;
    expect(code(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, ALICE, { password: PW })))).toBe('emailUnavailable');
    // refused before the proof: no hash ran
    expect(s.hasher.calls.length).toBe(calls);
    const answers = [];
    for (const name of ['Alice', 'alice', 'Nobody', 'Carol']) answers.push(inRow('requestEmailReset', await s.service.requestEmailReset(ctxFor(s, `reset ${name}`), name)));
    for (const a of answers) expect(a).toEqual(answers[0]);
    expect(code(answers[0]!)).toBe('emailUnavailable');
    // an address stored earlier (another mailer then) can still be removed
    const a = (await s.store.account(reg.auth.account))!;
    await s.store.updateAccount(a.id, a.version, { email: { address: ALICE, verifiedAt: s.clock.now().toISOString() } });
    expect(value(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, null, { password: PW }))).email).toBeNull();
    expect(await s.mailer.forget!(null, s.clock.now())).toBe(0);
    await s.idle();
    expect(await s.service.tick(s.clock.now())).toMatchObject({ mailFilesRemoved: 0 });
    // a reset with NoMailer: no code exists, the same answer as any wrong code
    expect(code(inRow('useEmailReset', await s.service.useEmailReset(ctx, { name: 'Alice', code: 'ABCDE-FGHJK', newPassword: PW2 })))).toBe('emailCodeInvalid');
  });
});
