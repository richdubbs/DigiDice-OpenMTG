/**
 * M14-5: the sign-in back-off through the service (design 8.2, 8.3, 8.4, 4.1; 13.2), as fixed sequences of calls in process (owner rule: no
 * traffic, no randomized inputs): an attacker failing once every 10 s from rotating address keys does not stop the owner on a fresh address key
 * (the owner pays the work and signs in); a device-proof holder behind the attacker's own /32 is not slowed; IPv6 /64s of one /48 share the /48's
 * allowance; no password check during back-off; a hidden account's name, a held key and a banned key answer alike over 6 wrong sign-ins; under
 * pressure only free names skip the dummy hash; the hashing class of each kind of attempt; a device proof deleted after 10 failures; the
 * registration pressure's work.
 */
import { describe, expect, it } from 'vitest';
import { WORK_ANSWER, type AccountResult, type NameEntry, type SignedIn } from '@openmtg/accounts';
import { tokenHash } from '../../src/ids';
import { addressFor, BIRTH, code, ctxOf, HOUR, inRow, MIN, PW, PW2, registerAs, setup, solve, value, type Setup } from './support';

/** Low work for tests (the difficulty rule itself is tested at the guard with the real numbers). */
const LOW_WORK = { ACCOUNTS_WORK_BASE_BITS: '4', ACCOUNTS_WORK_MAX_BITS: '8', ACCOUNTS_PRESSURE_WORK_BITS: '4' };

/** A sign-in that pays any work asked for, once (as the client does). */
async function signInPaying(s: Setup, name: string, password: string, addressKey: string, device?: string): Promise<AccountResult<SignedIn>> {
  const ctx = ctxOf(s.clock, { addressKey, connection: `c-${addressKey}`, guestSession: null });
  const req = { name, password, ...(device !== undefined ? { device } : {}) };
  const first = inRow('signIn', await s.service.signIn(ctx, req));
  if (first.ok || first.error.code !== 'captchaRequired') return first;
  const ch = first.error.challenge!;
  expect(ch.kind).toBe('work');
  const captcha = solve(ch.challenge, ch.bits);
  expect(WORK_ANSWER.test(captcha)).toBe(true);
  return inRow('signIn', await s.service.signIn(ctx, { ...req, captcha }));
}

describe('M14-5: back-off without lock-out griefing (8.2)', () => {
  it('an attacker failing every 10 s from rotating address keys does not stop the owner on a fresh address key (who pays the work)', async () => {
    const s = setup({ verifier: 'work', env: LOW_WORK });
    await registerAs(s, 'Alice');
    let paid = 0;
    for (let i = 0; i < 400; i++) {
      s.clock.advance(10_000);
      const r = await signInPaying(s, 'Alice', `guess number ${i} of many`, addressFor(`attacker ${i}`));
      expect(code(r)).toBe('badCredentials');
      if (i >= 20) paid++;
    }
    expect(paid).toBe(380);
    s.clock.advance(10_000);
    const owner = await signInPaying(s, 'Alice', PW, '192.0.2.250');
    expect(value(owner).account.name).toBe('Alice');
    // without paying, the owner's fresh key is asked for work (never refused outright)
    const asked = inRow('signIn', await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.251' }), { name: 'Alice', password: PW }));
    expect(code(asked)).toBe('captchaRequired');
    if (!asked.ok) expect(asked.error.challenge!.bits).toBeGreaterThanOrEqual(4);
  });

  it('a wrong solution answers captchaFailed with a new challenge', async () => {
    const s = setup({ verifier: 'work', env: LOW_WORK });
    await registerAs(s, 'Alice');
    for (let i = 0; i < 21; i++) await signInPaying(s, 'Alice', PW2, addressFor(`a ${i}`));
    const ctx = ctxOf(s.clock, { addressKey: '192.0.2.9' });
    const first = await s.service.signIn(ctx, { name: 'Alice', password: PW });
    expect(code(first)).toBe('captchaRequired');
    const ch = !first.ok ? first.error.challenge! : null;
    const r = inRow('signIn', await s.service.signIn(ctx, { name: 'Alice', password: PW, captcha: `${ch!.challenge}:x1` }));
    expect(code(r)).toBe('captchaFailed');
    // a well-formed but wrong one: find a nonce that fails
    let bad = '';
    for (let n = 0; n < 1_000; n++) {
      const t = `${ch!.challenge}:${n}`;
      if (t !== solve(ch!.challenge, ch!.bits)) {
        bad = t;
        break;
      }
    }
    const failed = inRow('signIn', await s.service.signIn(ctx, { name: 'Alice', password: PW, captcha: bad }));
    expect(code(failed)).toBe('captchaFailed');
    if (!failed.ok) expect(failed.error.challenge!.challenge).not.toBe(ch!.challenge);
  });

  it('a device-proof holder behind the attacker\'s own /32 is not slowed', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const shared = '203.0.113.99';
    let refusals = 0;
    for (let i = 0; i < 40; i++) {
      const r = await s.service.signIn(ctxOf(s.clock, { addressKey: shared }), { name: 'Alice', password: `wrong guess ${i}` });
      if (!r.ok && r.error.code === 'rateLimited') refusals++;
    }
    expect(refusals).toBeGreaterThan(0);
    s.hasher.reset();
    const owner = value(inRow('signIn', await s.service.signIn(ctxOf(s.clock, { addressKey: shared }), { name: 'Alice', password: PW, device: reg.device })));
    expect(owner.device).toBe(reg.device);
    expect(s.hasher.calls).toEqual([{ op: 'verify', priority: 'high' }]);
  });

  it('IPv6 /64s of one /48 share the /48\'s sign-in allowance (16 times a /64\'s)', async () => {
    const s = setup();
    // 20 /64s, each in a /56 of its own (the /56's allowance, 4 times a /64's, is not the limit here), all in one /48
    let ok = 0;
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 10; j++) {
        const r = await s.service.signIn(ctxOf(s.clock, { addressKey: `2001:db8:42:${(i + 1).toString(16)}00::` }), { name: `Free${i}x${j}`, password: PW });
        if (!r.ok && r.error.code === 'badCredentials') ok++;
      }
    }
    expect(ok).toBe(160);
    // and the /64s of one /56 share its 40
    let ok56 = 0;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 10; j++) {
        const r = await s.service.signIn(ctxOf(s.clock, { addressKey: `2001:db8:44:${i + 1}::` }), { name: `Free${i}y${j}`, password: PW });
        if (!r.ok && r.error.code === 'badCredentials') ok56++;
      }
    }
    expect(ok56).toBe(40);
    const fresh = await s.service.signIn(ctxOf(s.clock, { addressKey: '2001:db8:42:ff::' }), { name: 'Someone', password: PW });
    expect(code(fresh)).toBe('rateLimited');
    // another /48 is untouched
    expect(code(await s.service.signIn(ctxOf(s.clock, { addressKey: '2001:db8:43:1::' }), { name: 'Someone', password: PW }))).toBe('badCredentials');
  });

  it('no password check during back-off: the 6th attempt of a pair is refused without a hash', async () => {
    const s = setup();
    await registerAs(s, 'Alice');
    const ctx = () => ctxOf(s.clock, { addressKey: '198.51.100.20' });
    for (let i = 0; i < 5; i++) expect(code(await s.service.signIn(ctx(), { name: 'Alice', password: PW2 }))).toBe('badCredentials');
    s.hasher.reset();
    const r = inRow('signIn', await s.service.signIn(ctx(), { name: 'Alice', password: PW }));
    expect(code(r)).toBe('rateLimited');
    if (!r.ok) expect(r.error.retryAfterMs).toBe(1_000);
    expect(s.hasher.calls).toEqual([]);
    // after the wait, the right password signs in and clears the count
    s.clock.advance(1_000);
    value(await s.service.signIn(ctx(), { name: 'Alice', password: PW }));
    expect(code(await s.service.signIn(ctx(), { name: 'Alice', password: PW2 }))).toBe('badCredentials');
  });

  it('a hidden account\'s name, a held key and a banned key give the same answers and counters over 6 wrong sign-ins', async () => {
    const s = setup();
    const hidden = await registerAs(s, 'Hidden');
    await s.store.putSanction({
      id: 'san_01J00000000000000000000000', account: hidden.auth.account, kind: 'suspend', reason: 'other', message: 'm', note: null,
      since: s.clock.now().toISOString(), until: new Date(s.clock.t + 30 * 24 * HOUR).toISOString(), endedAt: null, endReason: null, endedBy: null,
      createdAt: s.clock.now().toISOString(), createdBy: 'admin:op', reports: [], seenAt: null,
    });
    const held = await registerAs(s, 'Heldname');
    value(await s.service.rename(ctxOf(s.clock), held.auth, 'Newname', { password: PW }));
    const bannedKey = s.names.key('Bannedname');
    const entry: NameEntry = { key: bannedKey, keyVersion: 1, kind: 'banned', account: null, until: null, note: null, createdAt: s.clock.now().toISOString() };
    await s.store.putNameEntry(entry);
    const answers: Record<string, unknown[]> = {};
    const hashes: Record<string, number> = {};
    for (const name of ['Hidden', 'Heldname', 'Bannedname']) {
      s.hasher.reset();
      answers[name] = [];
      // each from an address key of its own (the per-address bucket is not what is compared)
      for (let i = 0; i < 6; i++) {
        const r = inRow('signIn', await s.service.signIn(ctxOf(s.clock, { addressKey: addressFor(`alike ${name}`) }), { name, password: PW2 }));
        answers[name]!.push(r);
      }
      hashes[name] = s.hasher.calls.length;
    }
    expect(answers['Heldname']).toEqual(answers['Hidden']);
    expect(answers['Bannedname']).toEqual(answers['Hidden']);
    expect(answers['Hidden']!.map((r) => code(r as AccountResult<unknown>))).toEqual([...Array(5).fill('badCredentials'), 'rateLimited']);
    expect(hashes).toEqual({ Hidden: 5, Heldname: 5, Bannedname: 5 });
    // a free name is not counted: 6 wrong sign-ins all hash and answer badCredentials
    s.hasher.reset();
    for (let i = 0; i < 6; i++) expect(code(await s.service.signIn(ctxOf(s.clock, { addressKey: '198.51.100.78' }), { name: 'Freename', password: PW2 }))).toBe('badCredentials');
    expect(s.hasher.calls).toHaveLength(6);
  });

  it('under pressure a free name is answered without the dummy hash; held, banned and reserved keys still get it', async () => {
    const s = setup();
    const held = await registerAs(s, 'Heldname');
    value(await s.service.rename(ctxOf(s.clock), held.auth, 'Newname', { password: PW }));
    const now = s.clock.now().toISOString();
    await s.store.putNameEntry({ key: s.names.key('Bannedname'), keyVersion: 1, kind: 'banned', account: null, until: null, note: null, createdAt: now });
    await s.store.putNameEntry({ key: s.names.key('Reservedname'), keyVersion: 1, kind: 'reserved', account: null, until: null, note: 'x', createdAt: now });
    s.hasher.pressure = true;
    for (const [name, hashed] of [['Freename', false], ['Heldname', true], ['Bannedname', true], ['Reservedname', true]] as const) {
      s.hasher.reset();
      expect(code(await s.service.signIn(ctxOf(s.clock, { addressKey: addressFor(name) }), { name, password: PW2 })), name).toBe('badCredentials');
      expect(s.hasher.calls.map((c) => c.op), name).toEqual(hashed ? ['dummy'] : []);
    }
  });

  it('the hashing class of each kind of attempt: high with a device proof, normal from a clean address key, low after a failure', async () => {
    const s = setup();
    s.hasher.reset();
    const reg = await registerAs(s, 'Alice');
    expect(s.hasher.calls).toEqual([{ op: 'hash', priority: 'normal' }]);
    const addr = '198.51.100.30';
    s.hasher.reset();
    await s.service.signIn(ctxOf(s.clock, { addressKey: addr }), { name: 'Alice', password: PW });
    await s.service.signIn(ctxOf(s.clock, { addressKey: addr }), { name: 'Alice', password: PW2 });
    await s.service.signIn(ctxOf(s.clock, { addressKey: addr }), { name: 'Alice', password: PW });
    await s.service.signIn(ctxOf(s.clock, { addressKey: addr }), { name: 'Alice', password: PW, device: reg.device });
    await s.service.useRecoveryCode(ctxOf(s.clock, { addressKey: addr }), { name: 'Alice', code: 'XXXX-XXXX-XXXX-XXXX', newPassword: PW2 });
    expect(s.hasher.calls.map((c) => c.priority)).toEqual(['normal', 'normal', 'low', 'high']);
    s.clock.advance(HOUR);
    s.hasher.reset();
    await s.service.signIn(ctxOf(s.clock, { addressKey: addr }), { name: 'Alice', password: PW });
    expect(s.hasher.calls.map((c) => c.priority)).toEqual(['normal']);
  });

  it('a device proof with 10 failures in a row is deleted: it no longer counts as known', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    for (let i = 0; i < 10; i++) {
      s.clock.advance(20 * MIN);
      expect(code(await s.service.signIn(ctxOf(s.clock, { addressKey: '198.51.100.40' }), { name: 'Alice', password: PW2, device: reg.device }))).toBe('badCredentials');
    }
    s.hasher.reset();
    s.clock.advance(HOUR);
    const r = value(await s.service.signIn(ctxOf(s.clock, { addressKey: '198.51.100.41' }), { name: 'Alice', password: PW, device: reg.device }));
    expect(r.device).not.toBe(reg.device);
    expect(s.hasher.calls.map((c) => c.priority)).toEqual(['normal']);
  });

  it('recovery codes: rule 4 counts the attempts that carry a valid device proof too, and a wrong code never counts on the proof', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const ctx = () => ctxOf(s.clock, { addressKey: '198.51.100.50', guestSession: null });
    const wrong = { name: 'Alice', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', newPassword: PW2 };
    for (let i = 0; i < 10; i++) expect(code(inRow('useRecoveryCode', await s.service.useRecoveryCode(ctx(), { ...wrong, device: reg.device })))).toBe('badCredentials');
    expect(code(inRow('useRecoveryCode', await s.service.useRecoveryCode(ctx(), wrong)))).toBe('rateLimited');
    expect(code(inRow('useRecoveryCode', await s.service.useRecoveryCode(ctx(), { ...wrong, device: reg.device })))).toBe('rateLimited');
    expect((await s.store.device(tokenHash(reg.device)))!.failures).toBe(0);
    // another address key is not held back, and the right code with the proof keeps the proof
    const r = value(await s.service.useRecoveryCode(ctxOf(s.clock, { addressKey: '198.51.100.51', guestSession: null }), {
      name: 'Alice', code: reg.recoveryCodes![0]!, newPassword: PW2, device: reg.device,
    }));
    expect(r.device).toBe(reg.device);
  });

  it('the registration pressure: above 60 registrations a minute, every registration pays work', async () => {
    const s = setup({ verifier: 'work', env: { ...LOW_WORK, ACCOUNTS_REGISTER_GLOBAL_PER_MINUTE: '3' } });
    for (const n of ['Anna', 'Bert', 'Cora']) await registerAs(s, n);
    const ctx = ctxOf(s.clock, { addressKey: '192.0.2.123', guestSession: null });
    const req = { name: 'Dora', password: PW, birth: BIRTH, claimGuest: false };
    const first = inRow('register', await s.service.register(ctx, req));
    expect(code(first)).toBe('captchaRequired');
    const ch = !first.ok ? first.error.challenge! : null;
    const done = value(inRow('register', await s.service.register(ctx, { ...req, captcha: solve(ch!.challenge, ch!.bits) })));
    expect(done.account.name).toBe('Dora');
    s.clock.advance(MIN);
    value(await s.service.register(ctxOf(s.clock, { addressKey: '192.0.2.124', guestSession: null }), { ...req, name: 'Edda' }));
  });
});
