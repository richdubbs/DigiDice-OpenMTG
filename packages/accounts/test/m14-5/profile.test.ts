/**
 * M14-5: names, the age gate, the profile, privacy, the directory and guest claims (design 5.5, 6.5-6.7, 7, 9.1; 13.2): the rename cooldown, the
 * 60-day hold, the take-back after the cooldown and the free rename; nameTaken for held, banned and operator-reserved keys, nameReserved only for
 * 6.2's static rules, nameUnavailable alike; the age gate and its 24-hour mark; privacy defaults and changes; the public profile (only of an active
 * account); displayNameAt (the name at the time to the account, the current name to others); standing, names, historyVisible, blockedAmong,
 * silenced; claims through a fake GuestSessions (busy by ctx.guestBusy and by busy(), an unknown token, already claimed, the limit of 20, retire
 * called once).
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS, accountsEnvName, DELETED_PLAYER_NAME, PUBLIC_PROFILE_KEYS, type AccountId } from '@openmtg/accounts';
import { createAgeMarks } from '../../src/service/core';
import { BIRTH, code, ctxOf, DAY, HOUR, inRow, PW, registerAs, setup, value, type Setup } from './support';

const proof = { password: PW };

async function reg(s: Setup, name: string, over: Parameters<typeof ctxOf>[1] = {}) {
  return s.service.register(ctxOf(s.clock, { connection: `c-${name}`, guestSession: null, addressKey: `192.0.2.${name.length + 100}`, ...over }), {
    name, password: PW, birth: BIRTH, claimGuest: false,
  });
}

describe('M14-5: renames (6.5)', () => {
  it('cooldown, the 60-day hold, the take-back after the cooldown, and the free rename', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    s.clock.advance(HOUR);
    const v1 = value(inRow('rename', await s.service.rename(ctxOf(s.clock), alice.auth, 'Alicia', proof)));
    expect(v1.name).toBe('Alicia');
    expect(v1.renameAt).toBe(new Date(s.clock.t + 30 * DAY).toISOString());
    // the cooldown
    const cool = inRow('rename', await s.service.rename(ctxOf(s.clock), alice.auth, 'Alissa', proof));
    expect(code(cool)).toBe('renameCooldown');
    if (!cool.ok) expect(cool.error.retryAfterMs).toBe(30 * DAY);
    // the old name is held: nobody else may take it, at registration or by renaming
    const bob = await registerAs(s, 'Bobby');
    expect(code(inRow('register', await reg(s, 'Alice')))).toBe('nameTaken');
    expect(code(inRow('rename', await s.service.rename(ctxOf(s.clock), bob.auth, 'ALICE', proof)))).toBe('nameTaken');
    // after the cooldown the account takes its old name back (signing in again: the old session went idle)
    s.clock.advance(30 * DAY);
    const again = async (name: string) => value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.90' }), { name, password: PW })).auth;
    let auth = await again('Alicia');
    expect(value(await s.service.rename(ctxOf(s.clock), auth, 'Alice', proof)).name).toBe('Alice');
    // "Alicia" is now held for 60 days; after them it is free
    expect(code(await reg(s, 'Alicia'))).toBe('nameTaken');
    s.clock.advance(60 * DAY);
    expect(value(await reg(s, 'Alicia')).account.name).toBe('Alicia');
    // the free rename (after a forced one) skips the cooldown once
    auth = await again('Alice');
    s.clock.advance(HOUR);
    value(await s.service.rename(ctxOf(s.clock), auth, 'Alina', proof));
    expect(code(await s.service.rename(ctxOf(s.clock), auth, 'Aline', proof))).toBe('renameCooldown');
    const a = (await s.store.account(alice.auth.account))!;
    await s.store.updateAccount(a.id, a.version, { freeRename: true });
    s.clock.advance(HOUR);
    expect(value(await s.service.rename(ctxOf(s.clock), auth, 'Alyx', proof)).renameAt).toBe(new Date(s.clock.t + 30 * DAY).toISOString());
    expect((await s.store.account(alice.auth.account))!.freeRename).toBe(false);
    expect(code(await s.service.rename(ctxOf(s.clock), auth, 'Alyxa', proof))).toBe('renameCooldown');
    await s.service.tick(s.clock.now());
    const renamed = await s.store.audit({ account: alice.auth.account, kinds: ['renamed'], limit: 10 });
    expect(renamed.map((e) => e.details)).toEqual([{ free: false }, { free: false }, { free: false }, { free: true }]);
    expect((await s.service.changes(0, 100)).filter((c) => c.kind === 'renamed')).toHaveLength(4);
    // the name history: each name, from and to, with its cause
    expect((await s.store.nameHistory(alice.auth.account)).map((h) => [h.name, h.cause, h.to !== null])).toEqual([
      ['Alice', 'register', true], ['Alicia', 'rename', true], ['Alice', 'rename', true], ['Alina', 'rename', true], ['Alyx', 'rename', false],
    ]);
  });

  it('a rename\'s own refusals: the rules of 6.1, the reserved names, the word filter, the same key, the proof', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const ctx = ctxOf(s.clock);
    expect(code(inRow('rename', await s.service.rename(ctx, alice.auth, 'A', proof)))).toBe('nameInvalid');
    expect(code(inRow('rename', await s.service.rename(ctx, alice.auth, 'Admin', proof)))).toBe('nameReserved');
    expect(code(inRow('rename', await s.service.rename(ctx, alice.auth, 'Sh1t', proof)))).toBe('nameFiltered');
    expect(code(inRow('rename', await s.service.rename(ctx, alice.auth, 'ALICE', proof)))).toBe('nameTaken');
    expect(code(inRow('rename', await s.service.rename(ctx, alice.auth, 'Alicia', { password: 'not the password at all' })))).toBe('badCredentials');
    expect((await s.store.account(alice.auth.account))!.name).toBe('Alice');
  });
});

describe('M14-5: unavailable names (6.2, 6.5, 6.6)', () => {
  it('nameTaken for a current name, a hidden account\'s, a held, a banned and an operator-reserved key; nameReserved only for the static rules', async () => {
    const s = setup();
    const hidden = await registerAs(s, 'Hidden');
    const now = s.clock.now().toISOString();
    await s.store.putSanction({
      id: 'san_01J00000000000000000000001', account: hidden.auth.account, kind: 'ban', reason: 'other', message: 'm', note: null, since: now, until: null,
      endedAt: null, endReason: null, endedBy: null, createdAt: now, createdBy: 'admin:op', reports: [], seenAt: null,
    });
    const held = await registerAs(s, 'Heldname');
    s.clock.advance(1);
    value(await s.service.rename(ctxOf(s.clock), held.auth, 'Newname', proof));
    await s.store.putNameEntry({ key: s.names.key('Bannedname'), keyVersion: 1, kind: 'banned', account: null, until: null, note: null, createdAt: now });
    await s.store.putNameEntry({ key: s.names.key('Opreserved'), keyVersion: 1, kind: 'reserved', account: null, until: null, note: 'owner', createdAt: now });
    const taken = ['Newname', 'Hidden', 'Heldname', 'Bannedname', 'Opreserved'];
    const reserved = ['Admin', 'Moderator', 'Mod', 'OpenMTG', 'System', 'Anonymous', 'Player 101010', 'Player-101010', 'P1ayer 42', 'Bobguest'];
    const answers: unknown[] = [];
    for (const n of taken) {
      const r = inRow('register', await reg(s, n));
      expect(code(r), n).toBe('nameTaken');
      answers.push(r);
      expect(await s.service.nameUnavailable(n), n).toBe(true);
    }
    // every unavailable key answers exactly alike
    expect(answers.every((a) => JSON.stringify(a) === JSON.stringify(answers[0]))).toBe(true);
    for (const n of reserved) {
      expect(code(inRow('register', await reg(s, n))), n).toBe('nameReserved');
      expect(await s.service.nameUnavailable(n), n).toBe(true);
    }
    expect(await s.service.nameUnavailable('Freshname')).toBe(false);
    expect(await s.service.nameUnavailable('Badminton')).toBe(false);
    expect(value(await reg(s, 'Badminton')).account.name).toBe('Badminton');
    // an expired hold is free
    s.clock.advance(61 * DAY);
    expect(await s.service.nameUnavailable('Heldname')).toBe(false);
  });
});

describe('M14-5: registration\'s other rules', () => {
  it('the age gate: refused under MIN_AGE (only the outcome kept); the connection and guest session are marked for 24 hours', async () => {
    const s = setup();
    const now = s.clock.now();
    const young = { year: now.getUTCFullYear() - 13, month: now.getUTCMonth() + 1 };
    const ctx = ctxOf(s.clock, { connection: 'kid', guestSession: 'gs_kid' });
    const r = inRow('register', await s.service.register(ctx, { name: 'Kiddo', password: PW, birth: young, claimGuest: false }));
    expect(code(r)).toBe('ageGate');
    // changing the answer at once does not help, on this connection or from this guest session
    expect(code(await s.service.register(ctx, { name: 'Kiddo', password: PW, birth: BIRTH, claimGuest: false }))).toBe('ageGate');
    expect(code(await s.service.register({ ...ctx, connection: 'other' }, { name: 'Kiddo', password: PW, birth: BIRTH, claimGuest: false }))).toBe('ageGate');
    s.clock.advance(24 * HOUR);
    const ok = value(await s.service.register(ctxOf(s.clock, { connection: 'kid', guestSession: 'gs_kid' }), { name: 'Kiddo', password: PW, birth: BIRTH, claimGuest: false }));
    const row = (await s.store.account(ok.auth.account))!;
    expect(row.ageGate).toEqual({ minAge: 13, passedAt: s.clock.now().toISOString() });
    expect(JSON.stringify(row)).not.toContain('1990');
  });

  it('the age-gate marks hold at most counterEntries keys: a full map drops its oldest marks first', async () => {
    const s = setup({ env: { [accountsEnvName('counterEntries')]: '50' } });
    const now = s.clock.now();
    const young = { year: now.getUTCFullYear() - 5, month: 1 };
    const at = (connection: string, n: number) => ctxOf(s.clock, { connection, guestSession: null, addressKey: `192.0.2.${n}` });
    for (let i = 0; i < 60; i++) {
      expect(code(await s.service.register(at(`c${i}`, 1), { name: 'Kiddo', password: PW, birth: young, claimGuest: false }))).toBe('ageGate');
    }
    // the 10 oldest marks went; the 50 newest stay
    expect(value(await s.service.register(at('c0', 2), { name: 'Adulta', password: PW, birth: BIRTH, claimGuest: false })).account.name).toBe('Adulta');
    for (const c of ['c10', 'c59']) expect(code(await s.service.register(at(c, 3), { name: 'Adultb', password: PW, birth: BIRTH, claimGuest: false })), c).toBe('ageGate');
    // in isolation: never more than its bound, oldest first, and the tick drops the expired ones
    const marks = createAgeMarks(DAY, 3);
    for (const k of ['a', 'b', 'c', 'd']) marks.mark([k], now);
    expect(marks.size).toBe(3);
    expect(['a', 'b', 'c', 'd'].map((k) => marks.marked([k], now))).toEqual([false, true, true, true]);
    marks.sweep(new Date(now.getTime() + DAY));
    expect(marks.size).toBe(0);
  });

  it('busy while the guest session is seated; a weak password; email with NoMailer is unavailable', async () => {
    const s = setup();
    const base = { name: 'Carol', password: PW, birth: BIRTH, claimGuest: false };
    expect(code(inRow('register', await s.service.register(ctxOf(s.clock, { guestBusy: true }), base)))).toBe('busy');
    expect(code(inRow('register', await s.service.register(ctxOf(s.clock), { ...base, password: 'carolcarolcarol' })))).toBe('passwordWeak');
    expect(code(inRow('register', await s.service.register(ctxOf(s.clock), { ...base, email: 'carol@example.org' })))).toBe('emailUnavailable');
    const t = setup({ mailerKind: 'file' });
    expect(code(inRow('register', await t.service.register(ctxOf(t.clock), { ...base, email: 'carol@example.org' })))).toBe('notYet');
  });

  it('3 registrations an hour per address key', async () => {
    const s = setup();
    for (const n of ['Anna', 'Bert', 'Cora']) value(await reg(s, n, { addressKey: '198.51.100.9' }));
    expect(code(inRow('register', await reg(s, 'Dora', { addressKey: '198.51.100.9' })))).toBe('rateLimited');
    // a weak password or a taken name did not use one
    const t = setup();
    expect(code(await reg(t, 'Anna', { addressKey: '198.51.100.9', connection: 'x' }).then(() => reg(t, 'Anna', { addressKey: '198.51.100.9' })))).toBe('nameTaken');
    for (const n of ['Bert', 'Cora']) value(await reg(t, n, { addressKey: '198.51.100.9' }));
  });
});

describe('M14-5: profile and privacy (7)', () => {
  it('privacy defaults, changes (a closed set of keys), the avatar (only the 48 ids), and the public profile of exactly five keys', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    expect(alice.account.privacy).toEqual({ history: 'private', leaderboards: true, guestsAtMyTables: true });
    expect(value(inRow('setPrivacy', await s.service.setPrivacy(ctxOf(s.clock), alice.auth, { history: 'public' }))).privacy).toEqual({
      history: 'public', leaderboards: true, guestsAtMyTables: true,
    });
    for (const bad of [{}, { history: 'friends' }, { leaderboards: 'no' }, { color: 'red' }]) {
      expect(code(inRow('setPrivacy', await s.service.setPrivacy(ctxOf(s.clock), alice.auth, bad as never)))).toBe('badMessage');
    }
    expect(code(inRow('setAvatar', await s.service.setAvatar(ctxOf(s.clock), alice.auth, 'card-art' as never)))).toBe('badMessage');
    expect(value(inRow('setAvatar', await s.service.setAvatar(ctxOf(s.clock), alice.auth, 'comet-amber'))).avatar).toBe('comet-amber');
    const p = value(inRow('profile', await s.service.profile(ctxOf(s.clock), { name: 'ALICE' })));
    expect(Object.keys(p)).toEqual([...PUBLIC_PROFILE_KEYS]);
    expect(p).toEqual({ id: alice.auth.account, name: 'Alice', avatar: 'comet-amber', memberSince: '2026-10', historyPublic: true });
    expect(value(await s.service.profile(ctxOf(s.clock), { account: alice.auth.account }))).toEqual(p);
    expect((await s.service.changes(0, 10)).map((c) => c.kind)).toEqual(['avatar']);
    // 10 avatar changes an hour
    for (let i = 0; i < 9; i++) await s.service.setAvatar(ctxOf(s.clock), alice.auth, i % 2 ? 'd4-blue' : 'd6-blue');
    expect(code(await s.service.setAvatar(ctxOf(s.clock), alice.auth, 'd8-blue'))).toBe('rateLimited');
  });

  it('a hidden, an erased and an unknown account have no profile, alike', async () => {
    const s = setup();
    const hidden = await registerAs(s, 'Hidden');
    const a = (await s.store.account(hidden.auth.account))!;
    await s.store.updateAccount(a.id, a.version, { deletion: { requestedAt: a.createdAt, purgeAt: a.createdAt, erasingAt: null, done: [] } });
    const answers = [
      await s.service.profile(ctxOf(s.clock), { account: hidden.auth.account }),
      await s.service.profile(ctxOf(s.clock), { name: 'Hidden' }),
      await s.service.profile(ctxOf(s.clock), { account: 'acc_7ZZZZZZZZZZZZZZZZZZZZZZZZZ' }),
      await s.service.profile(ctxOf(s.clock), { name: 'Nobody' }),
    ];
    for (const r of answers) expect(inRow('profile', r)).toEqual(answers[0]);
    expect(code(answers[0]!)).toBe('notFound');
    expect(code(await s.service.profile(ctxOf(s.clock), { account: 'nope' } as never))).toBe('badMessage');
  });
});

describe('M14-5: the directory (2.4, 6.7)', () => {
  it('displayNameAt: the name at the time to the account itself (the current one if redacted), the current name to others; erased: Deleted player', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bobby');
    s.clock.advance(1);
    value(await s.service.rename(ctxOf(s.clock), alice.auth, 'Alicia', proof));
    const d = s.service.directory;
    expect(await d.displayNameAt(alice.auth.account, 'Alice', alice.auth.account)).toBe('Alice');
    expect(await d.displayNameAt(alice.auth.account, 'Alice', bob.auth.account)).toBe('Alicia');
    expect(await d.displayNameAt(alice.auth.account, 'Alice', null)).toBe('Alicia');
    expect(await d.displayNameAt(alice.auth.account, 'Alice')).toBe('Alicia');
    await s.store.redactName(alice.auth.account, s.names.key('Alice'));
    expect(await d.displayNameAt(alice.auth.account, 'Alice', alice.auth.account)).toBe('Alicia');
    expect(await d.displayNameAt('acc_7ZZZZZZZZZZZZZZZZZZZZZZZZZ', 'Someone', null)).toBe(DELETED_PLAYER_NAME);
  });

  it('standing, names, privacy and historyVisible follow the status; blockedAmong and silenced', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bobby');
    const carol = await registerAs(s, 'Carol');
    const d = s.service.directory;
    const st = (await d.standing(alice.auth.account))!;
    expect(st).toEqual({ account: alice.auth.account, status: 'active', ranked: true, listed: true, chat: true, until: null, createdAt: st.createdAt });
    expect(await d.historyVisible(alice.auth.account, alice.auth.account)).toBe(true);
    expect(await d.historyVisible(alice.auth.account, bob.auth.account)).toBe(false);
    value(await s.service.setPrivacy(ctxOf(s.clock), alice.auth, { history: 'public', leaderboards: false }));
    expect(await d.historyVisible(alice.auth.account, null)).toBe(true);
    expect((await d.privacy([alice.auth.account])).get(alice.auth.account)).toEqual({ history: 'public', leaderboards: false, guestsAtMyTables: true });
    const now = s.clock.now().toISOString();
    await s.store.putSanction({
      id: 'san_01J00000000000000000000002', account: alice.auth.account, kind: 'suspend', reason: 'other', message: 'm', note: null, since: now,
      until: new Date(s.clock.t + DAY).toISOString(), endedAt: null, endReason: null, endedBy: null, createdAt: now, createdBy: 'admin:op', reports: [],
      seenAt: null,
    });
    expect(await d.standing(alice.auth.account)).toMatchObject({ status: 'suspended', ranked: false, listed: false, chat: false });
    expect(await d.historyVisible(alice.auth.account, bob.auth.account)).toBe(false);
    expect(await d.historyVisible(alice.auth.account, alice.auth.account)).toBe(true);
    expect([...(await d.names([alice.auth.account, bob.auth.account, 'junk' as AccountId])).entries()]).toEqual([[bob.auth.account, 'Bobby']]);
    expect([...(await d.standings([alice.auth.account, bob.auth.account])).keys()].sort()).toEqual([alice.auth.account, bob.auth.account].sort());
    s.clock.advance(DAY);
    expect((await d.standing(alice.auth.account))!.status).toBe('active');
    expect(await d.standing('acc_7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull();
    // relations straight in the store (the moderation part is M14-6's)
    await s.store.setRelation({ account: alice.auth.account, other: bob.auth.account, kind: 'block', createdAt: now });
    await s.store.setRelation({ account: carol.auth.account, other: alice.auth.account, kind: 'mute', createdAt: now });
    const pair = [alice.auth.account, bob.auth.account].sort() as [AccountId, AccountId];
    expect(await d.blockedAmong([alice.auth.account, bob.auth.account, carol.auth.account])).toEqual([pair]);
    expect(await d.silenced(bob.auth.account, alice.auth.account)).toBe(true);
    expect(await d.silenced(alice.auth.account, bob.auth.account)).toBe(true);
    expect(await d.silenced(carol.auth.account, alice.auth.account)).toBe(true);
    expect(await d.silenced(alice.auth.account, carol.auth.account)).toBe(false);
  });
});

describe('M14-5: claiming a guest\'s history (5.5)', () => {
  it('at registration, only when ticked: the connection\'s own guest session, retired once; busy refused', async () => {
    const s = setup();
    const ctx = ctxOf(s.clock, { guestSession: 'gs_mine', connection: 'c-claim' });
    const r = value(await s.service.register(ctx, { name: 'Claimer', password: PW, birth: BIRTH, claimGuest: true }));
    expect(await s.store.claimsOf(r.auth.account)).toEqual([{ session: 'gs_mine', account: r.auth.account, claimedAt: s.clock.now().toISOString() }]);
    expect(s.guests.retired).toEqual(['gs_mine']);
    const u = value(await s.service.register(ctxOf(s.clock, { guestSession: 'gs_other', connection: 'c-2', addressKey: '192.0.2.2' }), { name: 'Unticked', password: PW, birth: BIRTH, claimGuest: false }));
    expect(await s.store.claimsOf(u.auth.account)).toEqual([]);
    s.guests.busySessions.add('gs_busy');
    expect(code(inRow('register', await s.service.register(ctxOf(s.clock, { guestSession: 'gs_busy', addressKey: '192.0.2.3' }), { name: 'Busybee', password: PW, birth: BIRTH, claimGuest: true })))).toBe('busy');
    // the same guest session again
    expect(code(inRow('register', await s.service.register(ctxOf(s.clock, { guestSession: 'gs_mine', connection: 'c-3', addressKey: '192.0.2.4' }), { name: 'Again', password: PW, birth: BIRTH, claimGuest: true })))).toBe('alreadyClaimed');
    await s.service.tick(s.clock.now());
    const ev = await s.store.audit({ account: r.auth.account, kinds: ['registered', 'guestClaimed'], limit: 10 });
    expect(ev.map((e) => [e.kind, e.details])).toEqual([['registered', { provider: 'local', claimed: true }], ['guestClaimed', { guestSession: 'gs_mine', games: 0 }]]);
  });

  it('later, with the guest token: busy by ctx.guestBusy and by busy(), unknown token, already claimed, the limit of 20, retire called once', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const tok = (i: number) => i.toString(16).padStart(64, '0');
    for (let i = 1; i <= 25; i++) s.guests.add(tok(i), `gs_${i}`);
    s.guests.add(tok(99), 'gs_seated', true);
    const ctx = () => ctxOf(s.clock, { guestSession: null });
    expect(code(inRow('claimGuest', await s.service.claimGuest({ ...ctx(), guestBusy: true }, alice.auth, tok(1), { password: PW })))).toBe('busy');
    expect(code(inRow('claimGuest', await s.service.claimGuest(ctx(), alice.auth, tok(99), { password: PW })))).toBe('busy');
    s.guests.busySessions.add('gs_2');
    expect(code(inRow('claimGuest', await s.service.claimGuest(ctx(), alice.auth, tok(2), { password: PW })))).toBe('busy');
    s.guests.busySessions.delete('gs_2');
    expect(code(inRow('claimGuest', await s.service.claimGuest(ctx(), alice.auth, 'f'.repeat(64), { password: PW })))).toBe('notFound');
    expect(code(inRow('claimGuest', await s.service.claimGuest(ctx(), alice.auth, 'short', { password: PW })))).toBe('badMessage');
    expect(value(inRow('claimGuest', await s.service.claimGuest(ctx(), alice.auth, tok(1), { password: PW })))).toEqual({ session: 'gs_1' });
    expect(s.guests.retired).toEqual(['gs_1']);
    // the retired session's token proves nothing any more; the claim row stays one
    expect(code(await s.service.claimGuest(ctx(), alice.auth, tok(1), { password: PW }))).toBe('notFound');
    for (let i = 2; i <= ACCOUNT_LIMITS.claimsMax; i++) value(await s.service.claimGuest(ctx(), alice.auth, tok(i), { password: PW }));
    expect(code(inRow('claimGuest', await s.service.claimGuest(ctx(), alice.auth, tok(21), { password: PW })))).toBe('limitReached');
    expect(s.guests.retired).toHaveLength(20);
    // another account cannot claim a claimed session (hosted retired it; the store refuses it anyway)
    const bob = await registerAs(s, 'Bobby');
    s.guests.retired.splice(0, 1);
    expect(code(inRow('claimGuest', await s.service.claimGuest(ctx(), bob.auth, tok(1), { password: PW })))).toBe('alreadyClaimed');
  });
});
