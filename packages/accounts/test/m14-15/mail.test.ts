/**
 * M14-15, security review pass A, finding A4: a reset request that carries a valid device proof of the account has an allowance of its own
 * (3 a day per device proof), so whoever spends the account's 3 requests a day by its public name cannot keep the owner from a code (8.2: no
 * bucket an attacker and the owner share; 8.3: device proofs are kept after a sign-out). In process, the email part with a recording mailer, a
 * fake clock and fixed inputs (owner rule). Each batch of requests waits out the codes of the one before (15 minutes), so the store's cap of 3
 * live codes never decides. The per-target verification-mail limit is left as it is (an owner trade-off, see the report).
 */
import { describe, expect, it } from 'vitest';
import { code, codeOf, ctxFor, DAY, HOUR, inRow, MIN, recordingSetup, registerVerified, value, type RecordingMailer } from '../m14-8/support';

const ALICE = 'alice.liddell@example.org';
const resetsTo = (m: RecordingMailer, to: string) => m.sent.filter((x) => x.to === to && x.meta.kind === 'reset');

describe('M14-15 A4: the owner\'s reset request with a device proof has its own allowance (3.4, 8.2, 8.3)', () => {
  it('an attacker spends the account\'s three; the owner, signed out everywhere, still gets codes from her browser\'s device proof', async () => {
    const s = recordingSetup();
    const alice = await registerVerified(s, 'Alice', ALICE);
    // her browser keeps its device proof after signing out everywhere (8.3)
    value(await s.service.signOut(ctxFor(s, 'alice at home'), alice.auth, true));
    const sent = () => resetsTo(s.mailer, ALICE).length;
    const before = sent();
    const ask = async (who: string, device?: string) => {
      value(inRow('requestEmailReset', await s.service.requestEmailReset(ctxFor(s, who), 'Alice', ...(device !== undefined ? [device] : []))));
      await s.idle();
    };

    // a stranger who knows the public name spends the account's 3 a day from one address key
    for (let i = 0; i < 3; i++) await ask('attacker');
    expect(sent() - before).toBe(3);
    s.clock.advance(20 * MIN);
    // without her device proof the owner's request is answered alike and mails nothing: the account's day is spent
    await ask('alice at home');
    expect(sent() - before).toBe(3);
    // with it, a code: its own allowance
    await ask('alice at home', alice.device);
    expect(sent() - before).toBe(4);
    // and again eight hours later, when the account's bucket gives one back and the attacker takes it
    s.clock.advance(8 * HOUR);
    await ask('attacker');
    expect(sent() - before).toBe(5);
    s.clock.advance(20 * MIN);
    await ask('alice later', alice.device);
    expect(sent() - before).toBe(6);
    // her code works: she is back in
    const signed = value(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'alice later'), {
      name: 'Alice', code: codeOf(resetsTo(s.mailer, ALICE).at(-1)), newPassword: 'a brand new passphrase', device: alice.device,
    })));
    expect(signed.auth.account).toBe(alice.auth.account);
  });

  it('three a day per device proof; another account\'s proof counts as none; a malformed one answers badMessage', async () => {
    const s = recordingSetup();
    const alice = await registerVerified(s, 'Alice', ALICE);
    const mallory = await registerVerified(s, 'Mallory', 'mallory@example.org');
    const sent = () => resetsTo(s.mailer, ALICE).length;
    const before = sent();
    const ask = async (who: string, device: string) => {
      value(inRow('requestEmailReset', await s.service.requestEmailReset(ctxFor(s, who), 'Alice', device)));
      await s.idle();
      s.clock.advance(16 * MIN);
    };
    // the device proof's three (and no more), each from an address key of its own
    for (let i = 0; i < 4; i++) await ask(`alice ${i}`, alice.device);
    expect(sent() - before).toBe(3);
    // Mallory's proof with Alice's name is no proof of Alice: it takes the account's allowance, still whole
    for (let i = 0; i < 4; i++) await ask(`mallory ${i}`, mallory.device);
    expect(sent() - before).toBe(6);
    // the shape is checked before the answer
    expect(code(inRow('requestEmailReset', await s.service.requestEmailReset(ctxFor(s, 'bad'), 'Alice', 'not a proof')))).toBe('badMessage');
    // a day later the device proof's allowance is whole again
    s.clock.advance(DAY);
    await ask('alice next day', alice.device);
    expect(sent() - before).toBe(7);
  });
});
