/**
 * M14-15, security review pass A, finding A1: the work verifier's spent set, and register's allowance before the work (design 8.1, 8.4, 8.2 rule
 * 6). In process, a fake clock and fixed inputs (owner rule); the work is counted, never timed: the verifier tells how many entries of its spent
 * set it has looked at (`examined`) and how many it holds (`held`).
 *
 * - The set is bounded (SPENT_MAX, counterEntries) and kept in time order: with 100,000 live challenges held, a verification looks at one entry; a
 *   set full of live ones refuses a new solution ('unavailable': the service asks for work again) rather than forget one that could then be spent
 *   twice; once they expire they are dropped from the front, each once.
 * - A challenge verified after one issued later is kept until its own expiry at least: none is forgotten while it could still be spent.
 * - register: one address key past its 3 an hour has no solution checked (none added to the set), and a solution sent again is still refused.
 */
import { describe, expect, it } from 'vitest';
import { buildWorkVerifier, leadingZeroBits, SPENT_MAX, workHash, type BuiltWorkVerifier } from '../../src/abuse/work';
import { BIRTH, code, ctxOf, fixedRandom, MIN, PW, setup, T0, value } from '../m14-5/support';

const CHALLENGE_MS = 2 * MIN;
const at = (ms: number) => new Date(T0 + ms);
const ctx = { addressKey: '198.51.100.9', action: 'register' as const, scope: 'register', bits: 1 };

/** A solved 1-bit register challenge issued at `issued` (the nonce found by counting up: fixed inputs). */
function solved(v: BuiltWorkVerifier, issued: Date): string {
  const c = v.challenge({ action: 'register', scope: 'register', bits: 1 }, issued)!;
  for (let n = 0; ; n++) if (leadingZeroBits(workHash(c.challenge, String(n))) >= 1) return `${c.challenge}:${n}`;
}

describe('M14-15 A1: the spent set is bounded and pruned from the front (8.4, 8.2 rule 6)', () => {
  it('100,000 live challenges: each verification looks at one entry; a full set refuses a new one; expired ones go once, from the front', async () => {
    expect(SPENT_MAX).toBe(100_000);
    const v = buildWorkVerifier({ random: fixedRandom('m14-15 work'), challengeMs: CHALLENGE_MS });
    const first = solved(v, at(0));
    expect(await v.verify(first, ctx, at(0))).toEqual({ ok: true });
    for (let i = 1; i < SPENT_MAX; i++) {
      const t = at(Math.floor(i / 1_000));
      expect((await v.verify(solved(v, t), ctx, t)).ok).toBe(true);
    }
    expect(v.held).toBe(SPENT_MAX);
    // every verification so far looked at the front entry only (live): one each, never the whole set
    expect(v.examined).toBe(SPENT_MAX - 1);

    // full of live challenges: a new solution is refused without looking further, and nothing is forgotten
    const late = at(200);
    const before = v.examined;
    expect(await v.verify(solved(v, late), ctx, late)).toEqual({ ok: false, reason: 'unavailable' });
    expect(v.examined - before).toBe(1);
    expect(v.held).toBe(SPENT_MAX);
    // the first one is still spent
    expect(await v.verify(first, ctx, late)).toEqual({ ok: false, reason: 'invalid' });

    // all expired: the next verification drops them from the front, once each, and the one after looks at one entry
    const after = at(CHALLENGE_MS + 1_000);
    const one = solved(v, after);
    const e0 = v.examined;
    expect(await v.verify(one, ctx, after)).toEqual({ ok: true });
    expect(v.examined - e0).toBe(SPENT_MAX);
    expect(v.held).toBe(1);
    const e1 = v.examined;
    expect(await v.verify(solved(v, after), ctx, after)).toEqual({ ok: true });
    expect(v.examined - e1).toBe(1);
    expect(v.held).toBe(2);
    // and a spent one stays refused for its whole life
    expect(await v.verify(one, ctx, at(CHALLENGE_MS + 60_000))).toEqual({ ok: false, reason: 'invalid' });
  }, 60_000);

  it('a challenge verified after one issued later is never forgotten before its own expiry', async () => {
    const v = buildWorkVerifier({ random: fixedRandom('m14-15 order'), challengeMs: CHALLENGE_MS, spentMax: 10 });
    const early = solved(v, at(0));
    const later = solved(v, at(60_000));
    // the later one first, then the earlier one: the set's moments stay in order, the earlier one kept as long as the later
    expect((await v.verify(later, ctx, at(61_000))).ok).toBe(true);
    expect((await v.verify(early, ctx, at(62_000))).ok).toBe(true);
    for (const t of [62_500, 100_000, 119_999]) expect(await v.verify(early, ctx, at(t)), String(t)).toEqual({ ok: false, reason: 'invalid' });
    for (const t of [120_000, 179_999]) expect(await v.verify(later, ctx, at(t)), String(t)).toEqual({ ok: false, reason: 'invalid' });
    expect(v.held).toBe(2);
    await v.verify(solved(v, at(180_000)), ctx, at(180_000));
    expect(v.held).toBe(1);
  });

  it('a small bound: full of live challenges, new ones are refused until the first expire, then accepted again', async () => {
    const v = buildWorkVerifier({ random: fixedRandom('m14-15 small'), challengeMs: CHALLENGE_MS, spentMax: 3 });
    for (let i = 0; i < 3; i++) expect((await v.verify(solved(v, at(i)), ctx, at(i))).ok).toBe(true);
    expect(await v.verify(solved(v, at(10)), ctx, at(10))).toEqual({ ok: false, reason: 'unavailable' });
    expect(v.held).toBe(3);
    expect((await v.verify(solved(v, at(CHALLENGE_MS)), ctx, at(CHALLENGE_MS))).ok).toBe(true);
    expect(v.held).toBe(3);
  });
});

describe('M14-15 A1: register looks at the address key\'s allowance before it checks any work (8.1)', () => {
  it('under registration pressure, one address key past its 3 an hour adds no solution to the set, and a solution sent again is still refused', async () => {
    const s = setup({ verifier: 'work', env: { ACCOUNTS_REGISTER_GLOBAL_PER_MINUTE: '0', ACCOUNTS_PRESSURE_WORK_BITS: '1' } });
    const v = s.verifier as BuiltWorkVerifier;
    const from = ctxOf(s.clock, { addressKey: '198.51.100.9', guestSession: null });
    // without work: asked for it
    expect(code(await s.service.register(from, { name: 'Nowork', password: PW, birth: BIRTH, claimGuest: false }))).toBe('captchaRequired');
    const answers: string[] = [];
    const refusedSolutions: string[] = [];
    for (let i = 0; i < 60; i++) {
      const captcha = solved(v, s.clock.now());
      const r = await s.service.register({ ...from, connection: `conn-${i}` }, { name: `Reg${'abcdefghjkpqstxyz'[i % 17]}${'abcdefghjkpqstxyz'[Math.floor(i / 17)]}`, password: PW, birth: BIRTH, claimGuest: false, captcha });
      answers.push(r.ok ? 'ok' : r.error.code);
      if (!r.ok) refusedSolutions.push(captcha);
    }
    expect(answers.filter((a) => a === 'ok')).toHaveLength(3);
    expect(answers.slice(3)).toEqual(Array(57).fill('rateLimited'));
    // only the three registrations that went ahead had their work checked
    expect(v.held).toBe(3);
    // the refused requests' solutions were never spent: sent again they are refused by the allowance, still unchecked
    const again = await s.service.register({ ...from, connection: 'conn-again' }, { name: 'Again', password: PW, birth: BIRTH, claimGuest: false, captcha: refusedSolutions[0]! });
    expect(code(again)).toBe('rateLimited');
    expect(v.held).toBe(3);
    // another address key's registration still goes through with its own work
    value(await s.service.register(ctxOf(s.clock, { addressKey: '198.51.100.10', guestSession: null }), {
      name: 'Other', password: PW, birth: BIRTH, claimGuest: false, captcha: solved(v, s.clock.now()),
    }));
    expect(v.held).toBe(4);
  });
});
