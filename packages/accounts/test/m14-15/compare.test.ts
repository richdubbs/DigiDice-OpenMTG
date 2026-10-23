/**
 * M14-15, security review pass A, finding A10: a recovery-code sign-in compares the code with ten hashes whatever the account (4.4, 7.4: how many
 * codes an account has left is never public), as the email part pads its codes to a fixed count. Counted through the injected comparison
 * (CredentialTools.equal), never timed; a fake clock and fixed inputs (owner rule).
 */
import { describe, expect, it } from 'vitest';
import { addressFor, ctxOf, equal, inRow, registerAs, setup, value } from '../m14-5/support';

const NEW = 'a brand new passphrase';

describe('M14-15 A10: ten comparisons for every recovery attempt (4.4, 7.4)', () => {
  it('an unknown name, an account with ten codes left and one with seven: ten comparisons each; the right code still matches', async () => {
    let compared = 0;
    const s = setup({ equal: (a, b) => (compared++, equal(a, b)) });
    const alice = await registerAs(s, 'Alice');
    const codes = alice.recoveryCodes!;
    const attempt = async (name: string, code: string, who: string) => {
      const before = compared;
      const r = await s.service.useRecoveryCode(ctxOf(s.clock, { addressKey: addressFor(who), guestSession: null }), { name, code, newPassword: NEW });
      return { r: inRow('useRecoveryCode', r), comparisons: compared - before };
    };
    const wrong = 'AAAA-BBBB-CCCC-DDDD';
    expect((await attempt('Nobody', wrong, 'w1')).comparisons).toBe(10);
    expect((await attempt('Alice', wrong, 'w2')).comparisons).toBe(10);
    // three codes used: seven left, still ten comparisons
    for (let i = 0; i < 3; i++) {
      const used = await attempt('Alice', codes[i]!, `use ${i}`);
      expect(used.comparisons).toBe(10);
      expect(value(used.r).codesLeft).toBe(9 - i);
    }
    expect((await attempt('Alice', wrong, 'w3')).comparisons).toBe(10);
    // a spent code is wrong now, and costs the same
    const spent = await attempt('Alice', codes[0]!, 'w4');
    expect(spent.comparisons).toBe(10);
    expect(spent.r.ok ? 'ok' : spent.r.error.code).toBe('badCredentials');
    // the last unused code still matches among the padding
    expect(value((await attempt('Alice', codes[9]!, 'last')).r).codesLeft).toBe(6);
  });
});
