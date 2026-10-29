/**
 * M14-5: sign-up, sign-in and account sessions (design 3.2, 4.4, 5.1, 5.2, 8.3; 13.2): register, sign in, resume; rotation after 24 hours with the
 * counter; the two-tab case in both orders (a fake storage that keeps the higher counter ends with the current token and nothing counts as reuse);
 * the previous token after the grace revokes; idle and absolute expiry; a 21st session revokes the least recently used; sign-out and the sessions
 * list; revokeSession of another account's session; proofs (no session, however fresh, passes a sensitive change without the password; wrong
 * proofs count and 5 revoke); the password change; recovery-code sign-ins (a weak new password burns no code; the others revoked; the F7 case).
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_LIMITS, ACCOUNT_RATE_LIMITS, ACCOUNT_STORE_METHODS, createMemoryAccountStore, isAccountToken, type AccountStore, type SignedIn,
} from '@openmtg/accounts';
import { tokenHash } from '../../src/ids';
import { addressFor, BIRTH, code, ctxOf, DAY, HOUR, inRow, MIN, PW, PW2, registerAs, setup, value, type Setup } from './support';

async function signIn(s: Setup, name: string, over: Parameters<typeof ctxOf>[1] = {}, password = PW, device?: string): Promise<SignedIn> {
  const ctx = ctxOf(s.clock, { addressKey: addressFor(`signin ${name} ${over.connection ?? ''}`), guestSession: null, ...over });
  return value(inRow('signIn', await s.service.signIn(ctx, { name, password, ...(device !== undefined ? { device } : {}) })));
}

describe('M14-5: register, sign in, resume', () => {
  it('registration answers a session token, a device proof and 10 recovery codes once; the store keeps only hashes', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    expect(isAccountToken(reg.token)).toBe(true);
    expect(isAccountToken(reg.device)).toBe(true);
    expect(reg.rotation).toBe(0);
    expect(reg.recoveryCodes).toHaveLength(10);
    expect(new Set(reg.recoveryCodes).size).toBe(10);
    for (const c of reg.recoveryCodes!) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(reg.account).toMatchObject({ name: 'Alice', status: 'active', restricted: false, hasPassword: true, recoveryCodesLeft: 10, providers: ['local'] });
    expect(reg.account.privacy).toEqual({ history: 'private', leaderboards: true, guestsAtMyTables: true });
    const rows = await s.store.sessionsOf(reg.auth.account);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(tokenHash(reg.token));
    expect(rows[0]!.device).toBe(tokenHash(reg.device));
    const dump = JSON.stringify(await s.store.recoveryCodes(reg.auth.account));
    for (const c of reg.recoveryCodes!) expect(dump).not.toContain(c.replace(/-/g, ''));
    const cred = (await s.store.credentials(reg.auth.account))[0]!;
    expect(cred.secret).toMatch(/^\$scrypt\$ln=17,r=8,p=1\$/);
    expect(cred.secret).not.toContain(PW);
  });

  it('sign-in finds the name by its key ("alice", "ALICE", "Alice"), answers badCredentials for a wrong password and an unknown name alike', async () => {
    const s = setup();
    await registerAs(s, 'Alice');
    for (const n of ['alice', 'ALICE', 'Alice']) expect((await signIn(s, n, { connection: n })).account.name).toBe('Alice');
    const ctx = ctxOf(s.clock, { addressKey: '192.0.2.200' });
    const wrong = inRow('signIn', await s.service.signIn(ctx, { name: 'Alice', password: PW2 }));
    const unknown = inRow('signIn', await s.service.signIn(ctx, { name: 'Nobody', password: PW }));
    expect(wrong).toEqual(unknown);
    expect(code(wrong)).toBe('badCredentials');
  });

  it('resume: the session, no new token before 24 hours; after, a rotated token with the counter', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const r1 = value(inRow('resume', await s.service.resume(ctxOf(s.clock), reg.token)));
    expect(r1.auth).toEqual(reg.auth);
    expect(r1.token).toBeUndefined();
    s.clock.advance(24 * HOUR);
    const r2 = value(inRow('resume', await s.service.resume(ctxOf(s.clock), reg.token)));
    expect(r2.rotation).toBe(1);
    expect(isAccountToken(r2.token!)).toBe(true);
    s.clock.advance(24 * HOUR);
    const r3 = value(inRow('resume', await s.service.resume(ctxOf(s.clock), r2.token!)));
    expect(r3.rotation).toBe(2);
  });

  it('the two-tab case, in both orders: storage keeps the higher counter, ends with the current token, and nothing is reuse', async () => {
    for (const order of ['A first', 'B first'] as const) {
      const s = setup();
      const reg = await registerAs(s, 'Alice');
      s.clock.advance(25 * HOUR);
      // both tabs send T0; tab A's hello lands first on the server, tab B's inside the grace
      const a = value(inRow('resume', await s.service.resume(ctxOf(s.clock, { connection: 'tab-a' }), reg.token)));
      s.clock.advance(5_000);
      const b = value(inRow('resume', await s.service.resume(ctxOf(s.clock, { connection: 'tab-b' }), reg.token)));
      expect([a.rotation, b.rotation]).toEqual([1, 2]);
      const storage = { token: reg.token, rotation: 0 };
      const apply = (r: typeof a) => {
        if (r.rotation! > storage.rotation) Object.assign(storage, { token: r.token!, rotation: r.rotation! });
      };
      if (order === 'A first') {
        apply(a);
        apply(b);
      } else {
        apply(b);
        apply(a);
      }
      expect(storage.rotation).toBe(2);
      const row = (await s.store.sessionsOf(reg.auth.account))[0]!;
      expect(row.tokenHash).toBe(tokenHash(storage.token));
      // the grace was not extended: previous is still T0, rotatedAt the first rotation's
      expect(row.previousHash).toBe(tokenHash(reg.token));
      // the stored token works; tab A's intermediate token is merely unknown (not reuse)
      expect(value(await s.service.resume(ctxOf(s.clock), storage.token)).auth).toEqual(reg.auth);
      expect(code(await s.service.resume(ctxOf(s.clock), a.token!))).toBe('sessionExpired');
      const events = await (async () => {
        await s.service.tick(s.clock.now());
        return s.store.audit({ account: reg.auth.account, limit: 100 });
      })();
      expect(events.some((e) => e.kind === 'sessionReuse')).toBe(false);
      expect(row.revokedAt).toBeNull();
    }
  });

  it('two concurrent resumes of one due token: one rotates, the other re-rotates inside the grace', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    s.clock.advance(25 * HOUR);
    const [x, y] = await Promise.all([s.service.resume(ctxOf(s.clock), reg.token), s.service.resume(ctxOf(s.clock), reg.token)]);
    expect([value(x).rotation, value(y).rotation].sort()).toEqual([1, 2]);
  });

  it('the previous token after the 2-minute grace is reuse: the session is revoked and audited; both holders must sign in again', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    s.clock.advance(25 * HOUR);
    const rotated = value(await s.service.resume(ctxOf(s.clock), reg.token));
    s.clock.advance(2 * MIN + 1);
    expect(code(inRow('resume', await s.service.resume(ctxOf(s.clock), reg.token)))).toBe('sessionRevoked');
    expect(code(await s.service.resume(ctxOf(s.clock), rotated.token!))).toBe('sessionRevoked');
    await s.service.tick(s.clock.now());
    const events = await s.store.audit({ account: reg.auth.account, kinds: ['sessionReuse'], limit: 10 });
    expect(events).toHaveLength(1);
    const changes = await s.service.changes(0, 100);
    expect(changes.filter((c) => c.kind === 'sessionRevoked' && c.session === reg.auth.session)).toHaveLength(1);
  });

  it('idle (30 days) and absolute (180 days) expiry', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    s.clock.advance(30 * DAY);
    expect(code(inRow('resume', await s.service.resume(ctxOf(s.clock), reg.token)))).toBe('sessionExpired');
    expect(code(await s.service.self(ctxOf(s.clock), reg.auth))).toBe('sessionRevoked');
    const t = setup();
    const r2 = await registerAs(t, 'Bob');
    let token = r2.token;
    for (let i = 0; i < 6; i++) {
      t.clock.advance(29 * DAY);
      const r = value(await t.service.resume(ctxOf(t.clock), token));
      token = r.token ?? token;
    }
    // 174 days: still live; at 180 days the session ends however recently used
    t.clock.advance(6 * DAY);
    expect(code(await t.service.resume(ctxOf(t.clock), token))).toBe('sessionExpired');
  });

  it('every call with the Auth ends an idle (30 days) or old (180 days) session, without resume', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    s.clock.advance(30 * DAY);
    expect(code(inRow('self', await s.service.self(ctxOf(s.clock), reg.auth)))).toBe('sessionExpired');
    expect(code(inRow('sessions', await s.service.sessions(ctxOf(s.clock), reg.auth)))).toBe('sessionExpired');
    const t = setup();
    const bob = await registerAs(t, 'Bob');
    for (let i = 0; i < 6; i++) {
      t.clock.advance(29 * DAY);
      value(await t.service.self(ctxOf(t.clock), bob.auth));
    }
    // 174 days, used 29 days ago at most: at 180 days it ends however recently it was used
    t.clock.advance(6 * DAY);
    expect(code(inRow('self', await t.service.self(ctxOf(t.clock), bob.auth)))).toBe('sessionExpired');
    expect(code(inRow('sessions', await t.service.sessions(ctxOf(t.clock), bob.auth)))).toBe('sessionExpired');
  });

  it('a sign-in\'s device cap reads the account\'s proofs in one call, however many session rows it gathered; at most 10 proofs stay valid', async () => {
    const inner = createMemoryAccountStore();
    let proofReads = 0;
    const store = Object.fromEntries(
      ACCOUNT_STORE_METHODS.map((m) => [m, (...args: unknown[]) => (inner[m] as (...a: unknown[]) => unknown).apply(inner, args)]),
    ) as unknown as AccountStore;
    store.device = (hash) => {
      proofReads++;
      return inner.device(hash);
    };
    store.devicesOf = (account) => {
      proofReads += 100;
      return inner.devicesOf(account);
    };
    const s = setup({ store });
    const reg = await registerAs(s, 'Alice');
    const devices = [reg.device];
    const reads: number[] = [];
    for (let i = 0; i < 60; i++) {
      s.clock.advance(MIN);
      proofReads = 0;
      devices.push((await signIn(s, 'Alice', { connection: `c${i}` })).device);
      reads.push(proofReads);
    }
    expect((await inner.sessionsOf(reg.auth.account)).length).toBe(61);
    // one devicesOf per sign-in, and no proof read one by one
    expect(new Set(reads)).toEqual(new Set([100]));
    const valid: string[] = [];
    for (const d of devices) {
      const row = await inner.device(tokenHash(d));
      if (row !== null && row.failures < ACCOUNT_RATE_LIMITS.deviceFailures) valid.push(d);
    }
    expect(valid).toEqual(devices.slice(-ACCOUNT_LIMITS.devicesMax));
  });

  it('a 21st live session revokes the one used least recently, not the oldest', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const sessions: SignedIn[] = [];
    for (let i = 0; i < 19; i++) {
      s.clock.advance(MIN);
      sessions.push(await signIn(s, 'Alice', { connection: `c${i}` }));
    }
    // the first (the registration's) is used again now: the least recently used is now sessions[0]
    s.clock.advance(MIN);
    value(await s.service.resume(ctxOf(s.clock), reg.token));
    s.clock.advance(MIN);
    await signIn(s, 'Alice', { connection: 'c-21' });
    const rows = await s.store.sessionsOf(reg.auth.account);
    const revoked = rows.filter((r) => r.revokedAt !== null);
    expect(revoked.map((r) => [r.id, r.revokeReason])).toEqual([[sessions[0]!.auth.session, 'tooMany']]);
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(ACCOUNT_LIMITS.sessionsMax);
  });

  it('sign-out ends this session; everywhere ends all; the sessions list shows live ones only, the current marked', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const other = await signIn(s, 'Alice', { connection: 'other' });
    const list = value(inRow('sessions', await s.service.sessions(ctxOf(s.clock), reg.auth)));
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.current)!.id).toBe(reg.auth.session);
    for (const v of list) expect(Object.keys(v).sort()).toEqual(['client', 'createdAt', 'current', 'id', 'lastUsedAt', 'provider']);
    value(inRow('signOut', await s.service.signOut(ctxOf(s.clock), other.auth, false)));
    expect(code(await s.service.self(ctxOf(s.clock), other.auth))).toBe('sessionRevoked');
    expect(value(await s.service.sessions(ctxOf(s.clock), reg.auth))).toHaveLength(1);
    const third = await signIn(s, 'Alice', { connection: 'third' });
    value(inRow('signOut', await s.service.signOut(ctxOf(s.clock), third.auth, true)));
    expect(code(await s.service.self(ctxOf(s.clock), reg.auth))).toBe('sessionRevoked');
    expect(code(inRow('signOut', await s.service.signOut(ctxOf(s.clock), reg.auth, 'yes' as never)))).toBe('badMessage');
  });

  it('revokeSession: only the account\'s own sessions; another account\'s answers notFound and stays live', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    expect(code(inRow('revokeSession', await s.service.revokeSession(ctxOf(s.clock), alice.auth, bob.auth.session)))).toBe('notFound');
    expect(value(await s.service.self(ctxOf(s.clock), bob.auth)).name).toBe('Bob');
    const second = await signIn(s, 'Alice', { connection: 'second' });
    value(inRow('revokeSession', await s.service.revokeSession(ctxOf(s.clock), alice.auth, second.auth.session)));
    expect(code(await s.service.self(ctxOf(s.clock), second.auth))).toBe('sessionRevoked');
    expect(code(await s.service.revokeSession(ctxOf(s.clock), alice.auth, 'not-a-session'))).toBe('badMessage');
  });

  it('revoking a session that is already revoked answers ok and writes no change and no audit event', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const second = await signIn(s, 'Alice', { connection: 'second' });
    for (let i = 0; i < 5; i++) value(inRow('revokeSession', await s.service.revokeSession(ctxOf(s.clock), reg.auth, second.auth.session)));
    await s.service.tick(s.clock.now());
    expect((await s.service.changes(0, 100)).filter((c) => c.kind === 'sessionRevoked')).toHaveLength(1);
    expect(await s.store.audit({ account: reg.auth.account, kinds: ['sessionRevoked'], limit: 100 })).toHaveLength(1);
  });
});

describe('M14-5: proofs in the request (5.2)', () => {
  it('a session at any age, its first 10 minutes included, cannot renew the codes or rename without the password', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    for (const age of [0, 5 * MIN, 9 * MIN, 2 * HOUR]) {
      s.clock.advance(age);
      expect(code(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctxOf(s.clock), reg.auth, undefined as never)))).toBe('reauthRequired');
      expect(code(inRow('rename', await s.service.rename(ctxOf(s.clock), reg.auth, 'Alicia', undefined as never)))).toBe('reauthRequired');
    }
    const codes = value(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctxOf(s.clock), reg.auth, { password: PW })));
    expect(codes.codes).toHaveLength(10);
    expect(codes.codes.some((c) => reg.recoveryCodes!.includes(c))).toBe(false);
  });

  it('a wrong proof counts on the session (badCredentials) and the 5th in a row revokes it; a right one resets the count', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    for (let i = 0; i < 4; i++) expect(code(await s.service.newRecoveryCodes(ctxOf(s.clock), reg.auth, { password: PW2 }))).toBe('badCredentials');
    value(await s.service.newRecoveryCodes(ctxOf(s.clock), reg.auth, { password: PW }));
    expect((await s.store.sessionsOf(reg.auth.account))[0]!.proofFailures).toBe(0);
    for (let i = 0; i < 5; i++) expect(code(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctxOf(s.clock), reg.auth, { password: PW2 })))).toBe('badCredentials');
    expect(code(await s.service.self(ctxOf(s.clock), reg.auth))).toBe('sessionRevoked');
    expect((await s.store.sessionsOf(reg.auth.account))[0]!.revokeReason).toBe('proofFailed');
    // a malformed proof is badMessage and does not count
    const t = setup();
    const r2 = await registerAs(t, 'Bob');
    expect(code(await t.service.newRecoveryCodes(ctxOf(t.clock), r2.auth, { password: PW, ticket: 'x' } as never))).toBe('badMessage');
    expect((await t.store.sessionsOf(r2.auth.account))[0]!.proofFailures).toBe(0);
  });

  it('a wrong current password in changePassword counts like any wrong proof', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    for (let i = 0; i < 5; i++) expect(code(inRow('changePassword', await s.service.changePassword(ctxOf(s.clock), reg.auth, PW2, 'another fine passphrase')))).toBe('badCredentials');
    expect(code(await s.service.self(ctxOf(s.clock), reg.auth))).toBe('sessionRevoked');
  });

  it('a password change keeps this session and its device proof, revokes the others and deletes their proofs', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const other = await signIn(s, 'Alice', { connection: 'other' });
    value(inRow('changePassword', await s.service.changePassword(ctxOf(s.clock), reg.auth, PW, PW2)));
    expect(value(await s.service.self(ctxOf(s.clock), reg.auth)).name).toBe('Alice');
    expect(code(await s.service.self(ctxOf(s.clock), other.auth))).toBe('sessionRevoked');
    expect(await s.store.device(tokenHash(reg.device))).not.toBeNull();
    expect(await s.store.device(tokenHash(other.device))).toBeNull();
    expect(code(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.10' }), { name: 'Alice', password: PW }))).toBe('badCredentials');
    await signIn(s, 'Alice', { connection: 'new' }, PW2);
    const changes = await s.service.changes(0, 100);
    expect(changes.filter((c) => c.kind === 'sessionsRevoked').map((c) => c.detail)).toEqual([{ except: reg.auth.session }]);
    // a weak new password answers passwordWeak before the proof
    expect(code(inRow('changePassword', await s.service.changePassword(ctxOf(s.clock), reg.auth, PW2, 'aaaaaaaaaaaaaaa')))).toBe('passwordWeak');
  });
});

describe('M14-5: recovery codes (4.4)', () => {
  const recover = (s: Setup, name: string, codeText: string, newPassword: string, over: Parameters<typeof ctxOf>[1] = {}) =>
    s.service.useRecoveryCode(ctxOf(s.clock, { addressKey: '192.0.2.44', guestSession: null, ...over }), { name, code: codeText, newPassword });

  it('a recovery sign-in sets the new password, revokes every other session and every device proof but the one used, and counts the codes left', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const other = await signIn(s, 'Alice', { connection: 'other' });
    const r = value(inRow('useRecoveryCode', await recover(s, 'alice', reg.recoveryCodes![3]!.toLowerCase(), PW2)));
    expect(r.codesLeft).toBe(9);
    expect(r.account.recoveryCodesLeft).toBe(9);
    for (const old of [reg, other]) expect(code(await s.service.self(ctxOf(s.clock), old.auth))).toBe('sessionRevoked');
    expect(await s.store.device(tokenHash(reg.device))).toBeNull();
    expect(await s.store.device(tokenHash(r.device))).not.toBeNull();
    await signIn(s, 'Alice', { connection: 'after' }, PW2);
    // the same code again: spent
    expect(code(inRow('useRecoveryCode', await recover(s, 'Alice', reg.recoveryCodes![3]!, 'yet another passphrase')))).toBe('badCredentials');
  });

  it('with the device proof it sent, that proof is the one kept', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const r = value(await s.service.useRecoveryCode(ctxOf(s.clock, { addressKey: '192.0.2.44' }), { name: 'Alice', code: reg.recoveryCodes![0]!, newPassword: PW2, device: reg.device }));
    expect(r.device).toBe(reg.device);
    expect(await s.store.device(tokenHash(reg.device))).not.toBeNull();
  });

  it('a weak new password answers passwordWeak before any code is looked at, and the code still works afterwards', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    expect(code(inRow('useRecoveryCode', await recover(s, 'Alice', reg.recoveryCodes![0]!, 'password1234')))).toBe('passwordWeak');
    expect(code(await recover(s, 'Alice', 'XXXX-XXXX-XXXX-XXXX', 'password1234'))).toBe('passwordWeak');
    value(await recover(s, 'Alice', reg.recoveryCodes![0]!, PW2));
  });

  it('F7: with a wrong code, a new password holding the email\'s local part answers badCredentials, as any other password; with the right code, passwordWeak and the code is not spent', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const a = (await s.store.account(reg.auth.account))!;
    await s.store.updateAccount(a.id, a.version, { email: { address: 'wonderland.rabbit@example.org', verifiedAt: null } });
    const emailPassword = 'wonderland.rabbit forever';
    const wrong = await recover(s, 'Alice', 'XXXX-XXXX-XXXX-XXXX', emailPassword);
    const wrongOther = await recover(s, 'Alice', 'XXXX-XXXX-XXXX-XXXX', 'a perfectly fine passphrase');
    expect(code(wrong)).toBe('badCredentials');
    expect(wrong).toEqual(wrongOther);
    const right = await recover(s, 'Alice', reg.recoveryCodes![1]!, emailPassword);
    expect(code(right)).toBe('passwordWeak');
    if (!right.ok) expect(right.error.details).toEqual(['containsEmail']);
    expect((await s.store.recoveryCodes(a.id)).filter((r) => r.usedAt === null)).toHaveLength(10);
    value(await recover(s, 'Alice', reg.recoveryCodes![1]!, PW2));
  });

  it('a code of a replaced generation spends nothing of the new one; a wrong code answers like an unknown name', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const fresh = value(await s.service.newRecoveryCodes(ctxOf(s.clock), reg.auth, { password: PW }));
    const oldCode = await recover(s, 'Alice', reg.recoveryCodes![0]!, PW2);
    const unknown = await recover(s, 'Nobody', reg.recoveryCodes![0]!, PW2);
    expect(code(oldCode)).toBe('badCredentials');
    expect(oldCode).toEqual(unknown);
    expect((await s.store.recoveryCodes(reg.auth.account)).filter((r) => r.usedAt === null)).toHaveLength(10);
    value(await recover(s, 'Alice', fresh.codes[0]!, PW2));
  });

  it('every unused slot is compared with the injected comparison, no early exit, padded to ten; an unknown name compares as many', async () => {
    let calls = 0;
    const s = setup({ equal: (a, b) => (calls++, a.length === b.length && Buffer.compare(a, b) === 0) });
    const reg = await registerAs(s, 'Alice');
    // the matching code is the first slot: all 10 are still compared
    calls = 0;
    value(await recover(s, 'Alice', reg.recoveryCodes![0]!, PW2));
    expect(calls).toBe(10);
    // nine unused slots and one dummy hash: ten again (review A10, M14-15: the count never follows the codes left)
    calls = 0;
    value(await recover(s, 'Alice', reg.recoveryCodes![9]!, 'yet another passphrase'));
    expect(calls).toBe(10);
    calls = 0;
    expect(code(await recover(s, 'Nobody', 'XXXX-XXXX-XXXX-XXXX', PW2))).toBe('badCredentials');
    expect(calls).toBe(10);
  });
});

describe('M14-5: the request\'s fields', () => {
  it('malformed fields answer badMessage, before any lookup', async () => {
    const s = setup();
    const ctx = ctxOf(s.clock);
    const bad = [
      { name: 42, password: PW, birth: BIRTH, claimGuest: false },
      { name: 'Alice', password: 'x\u0000y', birth: BIRTH, claimGuest: false },
      { name: 'Alice', password: PW, birth: { year: 1800, month: 1 }, claimGuest: false },
      { name: 'Alice', password: PW, birth: { year: 1990, month: 13 }, claimGuest: false },
      { name: 'Alice', password: PW, birth: BIRTH, claimGuest: 'yes' },
      { name: 'Alice', password: PW, birth: BIRTH, claimGuest: false, device: 'short' },
      { name: 'x'.repeat(300), password: PW, birth: BIRTH, claimGuest: false },
    ];
    for (const b of bad) expect(code(inRow('register', await s.service.register(ctx, b as never))), JSON.stringify(b).slice(0, 60)).toBe('badMessage');
    expect(code(await s.service.signIn(ctx, { name: 'Alice', password: 'p'.repeat(600) }))).toBe('badMessage');
    expect(code(await s.service.signIn({ ...ctx, now: 'now' as never }, { name: 'Alice', password: PW }))).toBe('badMessage');
    expect(code(await s.service.resume(ctx, 'not a token'))).toBe('badMessage');
    expect(s.hasher.calls).toEqual([]);
  });
});
