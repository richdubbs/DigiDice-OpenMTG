/**
 * M14-15, security review pass A, finding A11: a configured breach check (4.2) is a request to a third party, so register asks it only once its
 * limits (8.1) let the request through. In process, a fake breach check that counts its calls; fixed inputs (owner rule).
 *
 * - Past the address key's allowance, a registration with a free name and a strong password answers rateLimited without asking the check.
 * - The local policy still answers first: a weak password costs neither the check nor one of the allowance's registrations.
 * - A password the check finds answers passwordWeak ('common'), after the limits (it has spent one of the hour's registrations).
 */
import { describe, expect, it } from 'vitest';
import type { BreachedPasswordCheck } from '@openmtg/accounts';
import { BIRTH, code, ctxOf, inRow, PW, setup, value } from '../m14-5/support';

const BREACHED = 'this passphrase was in a breach';

/** A breach check that finds BREACHED only, and counts every password it is asked about. */
function countingCheck(): BreachedPasswordCheck & { asked: string[] } {
  const asked: string[] = [];
  return { asked, breached: async (pw) => (asked.push(pw), pw === BREACHED) };
}

describe('M14-15 A11: register asks a configured breach check only behind its limits (4.2, 8.1)', () => {
  it('past the allowance the check is never asked; a weak password is answered before both; a breached one after the limits', async () => {
    const check = countingCheck();
    const s = setup({ breachCheck: check });
    const from = (n: string) => ctxOf(s.clock, { addressKey: '198.51.100.20', guestSession: null, connection: `conn-${n}` });
    const reg = (n: string, password = PW) => s.service.register(from(n), { name: n, password, birth: BIRTH, claimGuest: false });

    // a weak password: the local policy answers, before the check and before the limits
    expect(code(inRow('register', await reg('Weakling', 'short')))).toBe('passwordWeak');
    expect(check.asked).toEqual([]);
    // a breached one: after the limits, so it is the first of the hour's three
    const r = inRow('register', await reg('Breached', BREACHED));
    expect(r.ok ? 'ok' : [r.error.code, r.error.details]).toEqual(['passwordWeak', ['common']]);
    expect(check.asked).toEqual([BREACHED]);
    value(inRow('register', await reg('Second')));
    value(inRow('register', await reg('Third')));
    expect(check.asked).toHaveLength(3);
    // the allowance is spent: a free name and a strong password are refused without a request to the third party
    for (const n of ['Fourth', 'Fifth', 'Sixth']) expect(code(inRow('register', await reg(n)))).toBe('rateLimited');
    expect(check.asked).toHaveLength(3);
  });
});
