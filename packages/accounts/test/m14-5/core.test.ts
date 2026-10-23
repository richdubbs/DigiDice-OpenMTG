/**
 * M14-5: the service as a whole (design 8.5, 9.7, 11.3, 6.3; 13.2): every flow writes its audit event with details of its AuditDetails shape and no
 * password, code, token, email or typed name (a search of the whole log and of every log line, a password typed into the name field included); the
 * change feed (entries, sessionsRevoked with except, onChange, changesHead); a lastSignInAt update racing another write still signs in; a store that
 * throws answers unavailable; every answer's code is in its ACCOUNT_METHOD_ERRORS row; the rekey (6.3) with two fixed data tables; the service
 * composed by composeAccounts with the built factories; close.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_METHOD_ERRORS, AccountsAdminError, composeAccounts, createMemoryAccountStore, createNameData, createNameRules, encodeNameTable, openFileAccountStore,
  type AccountChange, type AccountResult, type AccountStore, type GeneratedNameData,
} from '@openmtg/accounts';
import { auditDetailsProblem } from '../../src/audit/details';
import { createAccountService, createLocalProvider } from '../../src/service/index';
import { BIRTH, Clock, code, configOf, ctxOf, DAY, fastDerive, FakeGuests, HOUR, inRow, MIN, PW, PW2, registerAs, setup, value } from './support';
import { buildPasswordHasher } from '../../src/crypto/hasher';
import { fixedRandom } from '../m14-1/support';

describe('M14-5: the audit log (8.5)', () => {
  it('every flow writes its event, of its kind\'s shape, holding no password, code, token, email, typed name or address', async () => {
    const s = setup();
    s.guests.add('a'.repeat(64), 'gs_claimed');
    const ctx = (over = {}) => ctxOf(s.clock, { addressKey: '203.0.113.50', ...over });
    const reg = value(await s.service.register(ctx({ guestSession: 'gs_reg' }), { name: 'Alice', password: PW, birth: BIRTH, claimGuest: true }));
    const a = (await s.store.account(reg.auth.account))!;
    await s.store.updateAccount(a.id, a.version, { email: { address: 'alice.secret@example.org', verifiedAt: s.clock.now().toISOString() } });
    // a password typed into the name field, and a wrong one
    await s.service.signIn(ctx(), { name: PW, password: PW });
    await s.service.signIn(ctx(), { name: 'Alice', password: PW2 });
    const si = value(await s.service.signIn(ctx(), { name: 'Alice', password: PW }));
    s.clock.advance(25 * HOUR);
    const rot = value(await s.service.resume(ctx(), si.token));
    s.clock.advance(3 * MIN);
    await s.service.resume(ctx(), si.token);
    await s.service.newRecoveryCodes(ctx(), reg.auth, { password: PW2 });
    const codes = value(await s.service.newRecoveryCodes(ctx(), reg.auth, { password: PW }));
    await s.service.useRecoveryCode(ctx(), { name: 'Alice', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', newPassword: 'recovered passphrase one' });
    const rec = value(await s.service.useRecoveryCode(ctx(), { name: 'Alice', code: codes.codes[0]!, newPassword: 'recovered passphrase one' }));
    value(await s.service.changePassword(ctx(), rec.auth, 'recovered passphrase one', PW));
    s.clock.advance(1);
    value(await s.service.rename(ctx(), rec.auth, 'Alicia', { password: PW }));
    value(await s.service.claimGuest(ctx(), rec.auth, 'a'.repeat(64), { password: PW }));
    const second = value(await s.service.signIn(ctx({ connection: 'two' }), { name: 'Alicia', password: PW }));
    value(await s.service.revokeSession(ctx(), rec.auth, second.auth.session));
    value(await s.service.signOut(ctx(), rec.auth, true));
    s.clock.advance(2 * MIN);
    await s.service.tick(s.clock.now());

    const events = await s.store.audit({ limit: 1_000 });
    const kinds = new Set(events.map((e) => e.kind));
    for (const k of [
      'registered', 'guestClaimed', 'signInFailed', 'signedIn', 'sessionReuse', 'reauthFailed', 'reauthed', 'recoveryCodesRenewed', 'recoveryFailed',
      'recoveryUsed', 'passwordChanged', 'sessionsRevoked', 'renamed', 'sessionRevoked', 'signedOut',
    ] as const) expect(kinds.has(k), k).toBe(true);
    for (const e of events) {
      expect(auditDetailsProblem(e.kind, e.details, e.account), e.kind).toBeNull();
      if (e.addressTag !== null) expect(e.addressTag).toMatch(/^[0-9a-f]{16}$/);
    }
    // the failed sign-in with the password as its name: no account, a name tag only
    const unknown = events.filter((e) => e.kind === 'signInFailed' && e.account === null);
    expect(unknown).toHaveLength(1);
    expect((unknown[0]!.details as { nameTag: string }).nameTag).toMatch(/^[0-9a-f]{16}$/);
    const secrets = [
      PW, PW2, 'recovered passphrase one', 'alice.secret', 'example.org', '203.0.113.50', 'Alice', 'Alicia', reg.token, rot.token!, si.token, reg.device,
      si.device, ...reg.recoveryCodes!, ...reg.recoveryCodes!.map((c) => c.replace(/-/g, '')), ...codes.codes, ...codes.codes.map((c) => c.replace(/-/g, '')),
    ];
    const text = JSON.stringify(events);
    const logText = JSON.stringify(s.log);
    for (const secret of secrets) {
      expect(text.includes(secret), secret).toBe(false);
      expect(logText.includes(secret), secret).toBe(false);
    }
  });
});

describe('M14-5: the change feed (9.7)', () => {
  it('appends in order, tells onChange listeners, names the session that stays; changesHead', async () => {
    const s = setup();
    const seen: AccountChange[] = [];
    const off = s.service.onChange((c) => seen.push(c));
    s.service.onChange(() => {
      throw new Error('a listener that throws');
    });
    expect(await s.service.changesHead()).toBe(0);
    const reg = await registerAs(s, 'Alice');
    const other = value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.5' }), { name: 'Alice', password: PW }));
    value(await s.service.changePassword(ctxOf(s.clock), reg.auth, PW, PW2));
    value(await s.service.setAvatar(ctxOf(s.clock), reg.auth, 'd20-violet'));
    s.clock.advance(1);
    value(await s.service.rename(ctxOf(s.clock), reg.auth, 'Alicia', { password: PW2 }));
    value(await s.service.signOut(ctxOf(s.clock), reg.auth, false));
    off();
    const all = await s.service.changes(0, 100);
    expect(all.map((c) => [c.kind, c.session ?? null, c.detail ?? null])).toEqual([
      ['sessionsRevoked', null, { except: reg.auth.session }],
      ['avatar', null, null],
      ['renamed', null, null],
      ['sessionRevoked', reg.auth.session, null],
    ]);
    expect(all.map((c) => c.seq)).toEqual([1, 2, 3, 4]);
    expect(seen).toEqual(all.slice(0, 4));
    expect(await s.service.changesHead()).toBe(4);
    expect(await s.service.changes(2, 1)).toEqual([all[2]]);
    expect(s.log.some((l) => l.name === 'accounts.changes.listener')).toBe(true);
    void other;
  });
});

/** A store whose first `n` updateAccount calls first let another writer change the account. */
function racing(store: AccountStore, n: number): AccountStore {
  let left = n;
  const updateAccount = store.updateAccount.bind(store);
  store.updateAccount = async (id, version, patch) => {
    if (left > 0) {
      left--;
      const a = (await store.account(id))!;
      await updateAccount(id, a.version, { avatar: a.avatar === 'd4-blue' ? 'd6-blue' : 'd4-blue' });
    }
    return updateAccount(id, version, patch);
  };
  return store;
}

describe('M14-5: failures', () => {
  it('a lastSignInAt update racing another write (a sanction\'s, an avatar\'s) still signs in: the patch retries', async () => {
    const store = createMemoryAccountStore();
    const s = setup({ store });
    await registerAs(s, 'Alice');
    racing(store, 2);
    const r = value(inRow('signIn', await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.6' }), { name: 'Alice', password: PW })));
    expect((await store.account(r.auth.account))!.lastSignInAt).toBe(s.clock.now().toISOString());
    // a conflict that never ends still signs in (logged), never a refusal
    racing(store, 10);
    s.clock.advance(MIN);
    value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.7' }), { name: 'Alice', password: PW }));
    expect(s.log.some((l) => l.name === 'accounts.signIn.lastSignInAt' && l.fields['code'] === 'conflict')).toBe(true);
  });

  it('a store that throws answers unavailable (with retryAfterMs), logged by the error\'s name only', async () => {
    const store = createMemoryAccountStore();
    const s = setup({ store });
    const reg = await registerAs(s, 'Alice');
    const boom = async () => {
      throw new Error('disk on fire: secret detail');
    };
    store.sessionsOf = boom;
    store.nameEntry = boom;
    store.sessionByTokenHash = boom;
    const answers: AccountResult<unknown>[] = [
      inRow('self', await s.service.self(ctxOf(s.clock), reg.auth)),
      inRow('signIn', await s.service.signIn(ctxOf(s.clock), { name: 'Alice', password: PW })),
      inRow('resume', await s.service.resume(ctxOf(s.clock), reg.token)),
      inRow('register', await s.service.register(ctxOf(s.clock), { name: 'Bobby', password: PW, birth: BIRTH, claimGuest: false })),
    ];
    for (const r of answers) {
      expect(code(r)).toBe('unavailable');
      if (!r.ok) expect(r.error.retryAfterMs).toBeGreaterThan(0);
    }
    expect(await s.service.nameUnavailable('Bobby')).toBe(true);
    expect(JSON.stringify(s.log)).not.toContain('secret detail');
    expect(s.log.filter((l) => l.name === 'accounts.failed').map((l) => l.fields['error'])).toContain('Error');
  });

  it('every answer of a fixed list of odd calls is in its method\'s row', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const ctx = ctxOf(s.clock);
    const junk: unknown[] = [undefined, null, 42, 'x', {}, [], { account: 'acc_bad', session: 'as_bad' }];
    for (const j of junk) {
      inRow('signOut', await s.service.signOut(ctx, j as never, false));
      inRow('sessions', await s.service.sessions(ctx, j as never));
      inRow('self', await s.service.self(ctx, j as never));
      inRow('rename', await s.service.rename(ctx, reg.auth, j as never, { password: PW }));
      inRow('setAvatar', await s.service.setAvatar(ctx, reg.auth, j as never));
      inRow('setPrivacy', await s.service.setPrivacy(ctx, reg.auth, j as never));
      inRow('profile', await s.service.profile(ctx, j as never));
      inRow('markSeen', await s.service.markSeen(ctx, reg.auth, j as never));
      inRow('revokeSession', await s.service.revokeSession(ctx, reg.auth, j as never));
      inRow('claimGuest', await s.service.claimGuest(ctx, reg.auth, j as never, { password: PW }));
      inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctx, reg.auth, j as never));
      inRow('register', await s.service.register(ctx, j as never));
      inRow('signIn', await s.service.signIn(ctx, j as never));
      inRow('useRecoveryCode', await s.service.useRecoveryCode(ctx, j as never));
      inRow('resume', await s.service.resume(ctx, j as never));
      inRow('changePassword', await s.service.changePassword(ctx, reg.auth, j as never, PW2));
      inRow('signIn', await s.service.signIn(j as never, { name: 'Alice', password: PW }));
    }
    // the rows themselves: every method of the service has one
    for (const m of Object.keys(ACCOUNT_METHOD_ERRORS)) expect(typeof (s.service as unknown as Record<string, unknown>)[m], m).toBe('function');
  });
});

/** Two fixed data tables (as M14-2's tests): the second maps "q" to "g", so "Qwen" and "Gwen" become one name. */
function fixedData(version: number, extra: [string, string][] = []): GeneratedNameData {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return {
    version, unicodeVersion: `test-${version}`, sources: 'fixed test tables', supplement: encodeNameTable([['i', 'l']]),
    caseFolding: encodeNameTable(Array.from(upper, (c) => [c, c.toLowerCase()] as [string, string])),
    confusables: encodeNameTable([['I', 'l'], ['1', 'l'], ['0', 'O'], ['m', 'rn'], ...extra]),
  };
}

describe('M14-5: rekey (6.3)', () => {
  it('during the switch sign-in and registration use the store\'s version and check both; the check lists collisions; rekey switches once they are settled', async () => {
    const v1 = createNameData(fixedData(1));
    const v2 = createNameData(fixedData(2, [['q', 'g']]));
    const store = createMemoryAccountStore();
    const clock = new Clock();
    const old = setup({ store, clock, names: createNameRules({ reservedNamesText: '', data: v1 }) });
    const qwen = await registerAs(old, 'Qwen');
    await registerAs(old, 'Gwen');
    await registerAs(old, 'Alice');
    // the new server: new data, the old as previous; the store still at version 1
    const s = setup({ store, clock, names: createNameRules({ reservedNamesText: '', data: v2, previous: v1 }) });
    const op = { name: 'op', osUser: 'root' };
    value(await s.service.signIn(ctxOf(clock, { addressKey: '192.0.2.60' }), { name: 'Qwen', password: PW }));
    // "Gwenn" is fine under both; "Qwenn" under v2 is "gwenn": taken
    value(await s.service.register(ctxOf(clock, { addressKey: '192.0.2.61', guestSession: null }), { name: 'Gwenn', password: PW, birth: BIRTH, claimGuest: false }));
    expect(code(await s.service.register(ctxOf(clock, { addressKey: '192.0.2.62', guestSession: null }), { name: 'Qwenn', password: PW, birth: BIRTH, claimGuest: false }))).toBe('nameTaken');
    const check = await s.service.admin.rekeyCheck(op);
    expect([check.from, check.to]).toEqual([1, 2]);
    expect(check.collisions.map((c) => [c.key, c.names.map((n) => n.name).sort()])).toEqual([['gwen', ['Gwen', 'Qwen']]]);
    await expect(s.service.admin.rekey(op)).rejects.toBeInstanceOf(AccountsAdminError);
    // the operator settles it: Qwen renamed (as a forced rename would), its old key released
    const q = (await store.account(qwen.auth.account))!;
    clock.advance(1);
    await store.rename(q.id, q.version, { account: q.id, name: 'Quinn', key: 'qulnn', keyVersion: 1, from: clock.now().toISOString(), to: null, cause: 'forced', redacted: true }, {
      oldKind: 'banned', holdUntil: null, allow: [], now: clock.now().toISOString(),
    });
    expect((await s.service.admin.rekeyCheck(op)).collisions.map((c) => c.key)).toEqual(['gwen']);
    await store.deleteNameEntry('qwen', 1);
    const clean = await s.service.admin.rekeyCheck(op);
    expect(clean.collisions).toEqual([]);
    expect(clean.changed).toBe(1);
    expect(await s.service.admin.rekey(op)).toEqual({ changed: 1 });
    expect(await store.nameKeyVersion()).toBe(2);
    expect((await store.account(qwen.auth.account))!.nameKey).toBe('gulnn');
    for (const n of ['Quinn', 'Gwen', 'Alice', 'Gwenn']) value(await s.service.signIn(ctxOf(clock, { addressKey: `192.0.2.${70 + n.length}`, connection: n }), { name: n, password: PW }));
    expect(await s.service.admin.rekeyCheck(op)).toEqual({ from: 2, to: 2, changed: 0, collisions: [], unnamed: [] });
    const ev = await store.audit({ kinds: ['nameRekeyed'], limit: 5 });
    expect(ev.map((e) => [e.actor, e.actorOs, e.details])).toEqual([['admin:op', 'root', { from: 1, to: 2, changed: 1 }]]);
    // a server that does not load the store's version as its previous data refuses to plan
    const other = setup({ store, clock, names: createNameRules({ reservedNamesText: '', data: createNameData(fixedData(3)) }) });
    await expect(other.service.admin.rekeyCheck(op)).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.service.admin.rekey({ name: '', osUser: 'x' })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('M14-5: the operator of a rekey (9.6, D16)', () => {
  it('an operator the audit log would refuse (too long, not plain text) is refused before anything changes; a valid one is audited', async () => {
    const v1 = createNameData(fixedData(1));
    const v2 = createNameData(fixedData(2, [['q', 'g']]));
    const store = createMemoryAccountStore();
    const clock = new Clock();
    await registerAs(setup({ store, clock, names: createNameRules({ reservedNamesText: '', data: v1 }) }), 'Alice');
    const s = setup({ store, clock, names: createNameRules({ reservedNamesText: '', data: v2, previous: v1 }) });
    const bad = [
      { name: 'x'.repeat(65), osUser: 'root' }, { name: 'op', osUser: 'u'.repeat(65) }, { name: 'o\u0000p', osUser: 'root' }, { name: 'op', osUser: 'ro\u0000ot' },
      { name: '   ', osUser: 'root' },
    ];
    for (const op of bad) {
      await expect(s.service.admin.rekey(op), JSON.stringify(op).slice(0, 40)).rejects.toMatchObject({ code: 'invalid' });
      await expect(s.service.admin.rekeyCheck(op)).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(await store.nameKeyVersion()).toBe(1);
    expect(await store.audit({ kinds: ['nameRekeyed'], limit: 5 })).toEqual([]);
    const op = { name: 'x'.repeat(64), osUser: 'root' };
    expect(await s.service.admin.rekey(op)).toEqual({ changed: 0 });
    expect(await store.nameKeyVersion()).toBe(2);
    const ev = await store.audit({ kinds: ['nameRekeyed'], limit: 5 });
    expect(ev.map((e) => [e.actor, e.actorOs, e.details])).toEqual([[`admin:${op.name}`, 'root', { from: 1, to: 2, changed: 0 }]]);
  });
});

describe('M14-5: on the file store', () => {
  it('every row the core writes passes the file store\'s checks and survives a reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openmtg-m14-5-'));
    try {
      const clock = new Clock();
      const first = await openFileAccountStore({ dir });
      const s = setup({ store: first, clock });
      const reg = await registerAs(s, 'Alice');
      clock.advance(25 * HOUR);
      const rot = value(await s.service.resume(ctxOf(clock), reg.token));
      value(await s.service.changePassword(ctxOf(clock), reg.auth, PW, PW2));
      value(await s.service.rename(ctxOf(clock), reg.auth, 'Alicia', { password: PW2 }));
      value(await s.service.useRecoveryCode(ctxOf(clock, { addressKey: '192.0.2.8' }), { name: 'Alicia', code: reg.recoveryCodes![0]!, newPassword: PW }));
      await s.service.close();
      const again = await openFileAccountStore({ dir });
      const t = setup({ store: again, clock });
      value(await t.service.signIn(ctxOf(clock, { addressKey: '192.0.2.9' }), { name: 'alicia', password: PW }));
      expect(code(await t.service.resume(ctxOf(clock), rot.token!))).toBe('sessionRevoked');
      expect((await again.audit({ account: reg.auth.account, limit: 100 })).length).toBeGreaterThan(5);
      await t.service.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('M14-5: the factories and the composition', () => {
  it('createAccountService and createLocalProvider are built; composeAccounts makes a working service from the configuration', async () => {
    expect(typeof createAccountService).toBe('function');
    expect(typeof createLocalProvider).toBe('function');
    const random = fixedRandom('compose m14-5');
    const config = configOf({ PASSWORD_PEPPERS: `k1:${'p'.repeat(40)}` });
    const guests = new FakeGuests();
    const { service, store } = await composeAccounts(config, {
      guests, log: { event: () => undefined }, random,
      factories: {
        // the stubs of other packages (M14-8's mailer) and a fast hasher in place of scrypt for the test
        createNoMailer: () => ({ kind: 'none', send: async () => undefined }),
        createPasswordHasher: (o) => buildPasswordHasher(o, { derive: fastDerive, sleep: async () => undefined }),
      },
    });
    const now = new Date();
    const ctx = { now, connection: 'c', addressKey: '192.0.2.1', guestSession: null, guestBusy: false, client: 'desktop' as const };
    const r = value(await service.register(ctx, { name: 'Composed', password: PW, birth: BIRTH, claimGuest: false }));
    expect((await store.credentials(r.auth.account))[0]!.secret).toContain(',k=k1$');
    value(await service.signIn(ctx, { name: 'composed', password: PW }));
    await service.close();
    expect(code(await service.self(ctx, r.auth))).toBe('unavailable');
    await expect(store.account(r.auth.account)).rejects.toMatchObject({ code: 'closed' });
    void DAY;
  });
});
