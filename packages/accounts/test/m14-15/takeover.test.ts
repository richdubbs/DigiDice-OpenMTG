/**
 * M14-15, security review pass A, finding A5: a recovery through one channel takes away what a password thief may have set up in the other (3.4,
 * 4.4). In process, the email part with a recording mailer, a fake clock and fixed inputs (owner rule).
 *
 * - The thief renews the recovery codes with the stolen password; the owner resets by email: the reset gives the owner ten new codes (once, in
 *   its answer), so the thief's codes stop working and cannot take the account back.
 * - The thief sets and verifies an address of its own; the owner signs in with one of her recovery codes: an address set in the 30 days before
 *   is removed (with the emailRemoved notice to it), so the thief cannot take the account back by an email reset. An address set longer ago
 *   stays, and so does the one the registration set.
 */
import { describe, expect, it } from 'vitest';
import { RECENT_EMAIL_MS } from '../../src/service/signin';
import {
  code, codeOf, ctxFor, DAY, HOUR, inRow, PW, recordingSetup, registerVerified, registerWith, value, type MailSetup, type RecordingMailer,
} from '../m14-8/support';

const ALICE = 'alice.liddell@example.org';
const THIEF = 'thief@example.net';
const NEW_PW = 'a brand new passphrase';
const resets = (m: RecordingMailer, to: string) => m.sent.filter((x) => x.to === to && x.meta.kind === 'reset');

/** The thief signs in with the stolen password from its own connection and address key. */
async function thiefSignsIn(s: MailSetup) {
  return value(inRow('signIn', await s.service.signIn(ctxFor(s, 'thief'), { name: 'Alice', password: PW })));
}

describe('M14-15 A5: a recovery takes away the thief\'s other channel (3.4, 4.4)', () => {
  it('codes the thief renewed die with the owner\'s email reset, which gives her ten new ones', async () => {
    const s = recordingSetup();
    const alice = await registerVerified(s, 'Alice', ALICE);
    const thief = await thiefSignsIn(s);
    const stolen = value(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctxFor(s, 'thief'), thief.auth, { password: PW }))).codes;

    // the owner resets by email
    value(await s.service.requestEmailReset(ctxFor(s, 'alice'), 'Alice', alice.device));
    await s.idle();
    const back = value(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'alice'), {
      name: 'Alice', code: codeOf(resets(s.mailer, ALICE).at(-1)), newPassword: NEW_PW, device: alice.device,
    })));
    expect(back.recoveryCodes).toHaveLength(10);
    expect(back.account.recoveryCodesLeft).toBe(10);
    expect(back.recoveryCodes!.some((c) => stolen.includes(c))).toBe(false);
    expect(code(await s.service.self(ctxFor(s, 'thief'), thief.auth))).toBe('sessionRevoked');

    // the thief's codes no longer sign in; the owner's new ones do
    const r = inRow('useRecoveryCode', await s.service.useRecoveryCode(ctxFor(s, 'thief again'), { name: 'Alice', code: stolen[0]!, newPassword: 'the thief is back again' }));
    expect(code(r)).toBe('badCredentials');
    value(await s.service.self(ctxFor(s, 'alice'), back.auth));
    expect(value(inRow('useRecoveryCode', await s.service.useRecoveryCode(ctxFor(s, 'alice'), { name: 'Alice', code: back.recoveryCodes![0]!, newPassword: PW }))).codesLeft).toBe(9);
    // the address her registration set is hers, and stays through her recovery
    expect((await s.store.account(alice.auth.account))!.email).toMatchObject({ address: ALICE });
    // audited, and the notice says the codes were made anew
    await s.idle();
    const notice = s.mailer.sent.filter((m) => m.to === ALICE && m.meta.kind === 'notice' && m.subject.includes('reset by email'));
    expect(notice.at(-1)!.text).toContain('new recovery codes were made');
  });

  it('an address the thief set and verified is removed by the owner\'s recovery-code sign-in, and gets the notice', async () => {
    const s = recordingSetup();
    const alice = await registerWith(s, 'Alice');
    // some time after the registration, the thief signs in with the stolen password
    s.clock.advance(HOUR);
    const thief = await thiefSignsIn(s);
    value(inRow('setEmail', await s.service.setEmail(ctxFor(s, 'thief'), thief.auth, THIEF, { password: PW })));
    await s.idle();
    value(inRow('verifyEmail', await s.service.verifyEmail(ctxFor(s, 'thief'), thief.auth, codeOf(s.mailer.to(THIEF).at(-1)))));

    // a day later the owner signs in with one of her codes
    s.clock.advance(DAY);
    const back = value(inRow('useRecoveryCode', await s.service.useRecoveryCode(ctxFor(s, 'alice'), {
      name: 'Alice', code: alice.recoveryCodes![0]!, newPassword: NEW_PW, device: alice.device,
    })));
    expect(back.account.email).toBeNull();
    expect((await s.store.account(alice.auth.account))!.email).toBeNull();
    await s.idle();
    expect(s.mailer.to(THIEF).filter((m) => m.meta.kind === 'notice').map((m) => m.subject)).toEqual([
      'The email address of your OpenMTG account was removed',
    ]);
    expect(code(await s.service.self(ctxFor(s, 'thief'), thief.auth))).toBe('sessionRevoked');

    // the thief's email reset sends nothing now: the owner keeps her session
    const before = s.mailer.to(THIEF).length;
    value(await s.service.requestEmailReset(ctxFor(s, 'thief again'), 'Alice'));
    await s.idle();
    expect(s.mailer.to(THIEF).length).toBe(before);
    value(await s.service.self(ctxFor(s, 'alice'), back.auth));
    const events = (await s.store.audit({ account: alice.auth.account, kinds: ['emailRemoved'], limit: 10 }));
    await s.service.tick(s.clock.now());
    expect((await s.store.audit({ account: alice.auth.account, kinds: ['emailRemoved'], limit: 10 })).length - events.length).toBe(1);
  });

  it('an address set longer than 30 days before stays; one set within them goes, verified or not', async () => {
    expect(RECENT_EMAIL_MS).toBe(30 * DAY);
    const s = recordingSetup();
    const alice = await registerVerified(s, 'Alice', ALICE);
    const bob = await registerWith(s, 'Bobby', 'bobby@example.org');
    s.clock.advance(31 * DAY);
    const a = value(inRow('useRecoveryCode', await s.service.useRecoveryCode(ctxFor(s, 'alice'), { name: 'Alice', code: alice.recoveryCodes![0]!, newPassword: NEW_PW })));
    expect(a.account.email).toEqual({ address: ALICE, verified: true });
    // Bobby's address, never verified, set again 10 days ago: removed, and no notice goes to an unverified address
    value(inRow('setEmail', await s.service.setEmail(ctxFor(s, 'bobby'), (await s.service.signIn(ctxFor(s, 'bobby'), { name: 'Bobby', password: PW }).then(value)).auth, 'bobby.new@example.org', { password: PW })));
    s.clock.advance(10 * DAY);
    const b = value(inRow('useRecoveryCode', await s.service.useRecoveryCode(ctxFor(s, 'bobby'), { name: 'Bobby', code: bob.recoveryCodes![0]!, newPassword: NEW_PW })));
    expect(b.account.email).toBeNull();
    await s.idle();
    expect(s.mailer.to('bobby.new@example.org').filter((m) => m.meta.kind === 'notice')).toEqual([]);
  });
});
