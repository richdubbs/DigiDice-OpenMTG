/**
 * M14-15, security review pass A, finding A6: a forced rename (9.4) no longer strands an owner who is signed out everywhere. In process, the real
 * moderation and email parts, a recording mailer, a fake clock and fixed inputs (owner rule).
 *
 * - The notice: `forcedRename`, naming the new name (never the old one), to the account's verified address only.
 * - The ban keeps the account it was taken from, so the old name still signs in with the right password, and still works for a recovery code and
 *   the email reset, while the ban lasts; every other answer is as for any other name, a profile by the old name answers notFound, and a released
 *   ban (a free name) reaches nobody.
 */
import { describe, expect, it } from 'vitest';
import {
  code, codeOf, ctxFor, inRow, PW, PW2, recordingSetup, registerVerified, registerWith, value, type RecordingMailer,
} from '../m14-8/support';
import { OP } from '../m14-6/support';

const ALICE = 'alice.liddell@example.org';
const NEW_PW = 'a brand new passphrase';
const notices = (m: RecordingMailer, to: string) => m.sent.filter((x) => x.to === to && x.meta.kind === 'notice');

describe('M14-15 A6: a forced rename strands no owner (9.4)', () => {
  it('the notice names the new name to the verified address; the old name signs in, recovers and resets while the ban lasts', async () => {
    const s = recordingSetup({ moderation: true });
    const alice = await registerVerified(s, 'Alice', ALICE);
    value(await s.service.signOut(ctxFor(s, 'alice'), alice.auth, true));
    const renamed = await s.service.admin.forceRename(OP, alice.auth.account, 'name');
    await s.idle();
    const mail = notices(s.mailer, ALICE).filter((m) => m.subject === 'A moderator changed the name of your OpenMTG account');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.text).toContain(`"${renamed.name}"`);
    expect(mail[0]!.text).not.toContain('Alice');

    // the old name, the right password: back in, with the new name in view
    const signed = value(inRow('signIn', await s.service.signIn(ctxFor(s, 'alice'), { name: 'Alice', password: PW })));
    expect(signed.auth.account).toBe(alice.auth.account);
    expect(signed.account.name).toBe(renamed.name);
    // a wrong password answers as for any name; a profile by the old name shows nothing
    expect(code(inRow('signIn', await s.service.signIn(ctxFor(s, 'guesser'), { name: 'Alice', password: PW2 })))).toBe('badCredentials');
    expect(code(inRow('profile', await s.service.profile(ctxFor(s, 'viewer'), { name: 'Alice' })))).toBe('notFound');
    // a recovery code by the old name
    const recovered = value(inRow('useRecoveryCode', await s.service.useRecoveryCode(ctxFor(s, 'alice'), {
      name: 'Alice', code: alice.recoveryCodes![0]!, newPassword: NEW_PW,
    })));
    expect(recovered.auth.account).toBe(alice.auth.account);
    // the email reset by the old name: the mail names the account's name now, and the code works with the old one
    value(inRow('requestEmailReset', await s.service.requestEmailReset(ctxFor(s, 'alice'), 'Alice')));
    await s.idle();
    const reset = s.mailer.to(ALICE).filter((m) => m.meta.kind === 'reset').at(-1)!;
    expect(reset.text).toContain(`"${renamed.name}"`);
    const back = value(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'alice'), { name: 'Alice', code: codeOf(reset), newPassword: PW })));
    expect(back.auth.account).toBe(alice.auth.account);

    // once the operator releases the ban, the name is free and reaches nobody
    await s.service.admin.releaseName(OP, 'Alice');
    expect(code(inRow('signIn', await s.service.signIn(ctxFor(s, 'alice later'), { name: 'Alice', password: PW })))).toBe('badCredentials');
    value(await s.service.signIn(ctxFor(s, 'alice later'), { name: renamed.name, password: PW }));
  });

  it('no notice without a verified address; the old name still signs in', async () => {
    const s = recordingSetup({ moderation: true });
    const bob = await registerWith(s, 'Bobby', 'bobby@example.org');
    const before = s.mailer.sent.length;
    await s.service.admin.forceRename(OP, bob.auth.account, 'name');
    await s.idle();
    expect(s.mailer.sent.length).toBe(before);
    value(inRow('signIn', await s.service.signIn(ctxFor(s, 'bobby'), { name: 'Bobby', password: PW })));
  });
});
