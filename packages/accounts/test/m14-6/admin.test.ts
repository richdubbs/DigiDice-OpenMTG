/**
 * M14-6: the operator's moderation commands on AccountAdmin (design 9.6, 11.3, 8.5, D16; 13.2): find, show, the report queue and its closing,
 * reserving and releasing names, revoking sessions, appeals, the audit log; every command (reads included) audited once with the operator's name
 * and OS user; a bad operator refused before anything runs; the part wired in by the composition (src/compose.ts) with the built factory.
 */
import { describe, expect, it } from 'vitest';
import {
  builtFactories, composeAccounts, OPERATOR_AUDIT_KINDS, type AccountId, type AdminAccountView, type AuditEvent, type Operator,
} from '@openmtg/accounts';
import { createModerationPart } from '../../src/moderation/index';
import { buildPasswordHasher } from '../../src/crypto/hasher';
import {
  BIRTH, code, configOf, ctxOf, DAY, events, FakeGuests, fastDerive, HOUR, OP, PW, registerAs, setup, UNKNOWN_ID, value,
} from './support';

describe('M14-6: the operator\'s reads (9.6)', () => {
  it('find: by id, or by the start of a name\'s key (look-alikes and case alike); at most 50', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    await registerAs(s, 'Alicia');
    await registerAs(s, 'Bob');
    expect((await s.service.admin.find(OP, 'ali')).map((a) => a.name)).toEqual(['Alice', 'Alicia']);
    expect((await s.service.admin.find(OP, 'ALl')).map((a) => a.name)).toEqual(['Alice', 'Alicia']);
    expect((await s.service.admin.find(OP, 'Alice')).map((a) => a.name)).toEqual(['Alice']);
    expect((await s.service.admin.find(OP, alice.auth.account)).map((a) => a.id)).toEqual([alice.auth.account]);
    expect(await s.service.admin.find(OP, UNKNOWN_ID)).toEqual([]);
    expect(await s.service.admin.find(OP, 'zzz')).toEqual([]);
    await expect(s.service.admin.find(OP, '   ')).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.service.admin.find(OP, 'bidi‮')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('show: the status, names, providers, sessions, sanctions, appeals, reports about and by it, recent security events; null for no account', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const A = alice.auth.account;
    s.clock.advance(HOUR);
    value(await s.service.rename(ctxOf(s.clock), alice.auth, 'Alicia', { password: PW }));
    const byAlice = value(await s.service.report(ctxOf(s.clock), { kind: 'account', auth: alice.auth }, { target: { account: bob.auth.account }, reason: 'spam' }));
    const aboutAlice = value(await s.service.report(ctxOf(s.clock), { kind: 'account', auth: bob.auth }, { target: { account: A }, reason: 'chat' }));
    const sus = await s.service.admin.sanction(OP, A, { kind: 'suspend', reason: 'chat', until: new Date(s.clock.t + DAY).toISOString(), message: 'Paused.' });
    value(await s.service.appeal(ctxOf(s.clock), alice.auth, sus.id, 'Please.', { password: PW }));
    const view = (await s.service.admin.show(OP, A)) as AdminAccountView;
    expect(view.account.name).toBe('Alicia');
    expect(view.status).toBe('suspended');
    expect(view.nameHistory.map((h) => h.name)).toEqual(['Alice', 'Alicia']);
    expect(view.providers).toEqual(['local']);
    expect(view.sessions).toEqual({ live: 1, lastUsedAt: s.clock.now().toISOString() });
    expect(view.sanctions.map((x) => x.id)).toEqual([sus.id]);
    expect(view.appeals.map((x) => x.sanction)).toEqual([sus.id]);
    expect(view.reportsAbout.map((r) => r.id)).toEqual([aboutAlice.report]);
    expect(view.reportsBy.map((r) => r.id)).toEqual([byAlice.report]);
    expect(view.recentSecurity.map((e) => e.kind)).toEqual(expect.arrayContaining(['registered', 'reauthed', 'renamed']));
    // the security events are only the last 30 days'
    s.clock.advance(31 * DAY);
    expect((await s.service.admin.show(OP, A))!.recentSecurity).toEqual([]);
    expect((await s.service.admin.show(OP, A))!.sessions.live).toBe(0);
    expect(await s.service.admin.show(OP, UNKNOWN_ID)).toBeNull();
    await expect(s.service.admin.show(OP, 'nope' as AccountId)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('the report queue: by status, target and reporter, oldest first; one report; closing once, with the operator and a note', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const ids: string[] = [];
    for (const reason of ['spam', 'chat', 'name'] as const) {
      s.clock.advance(1);
      const session = `gs_${reason}`;
      ids.push(value(await s.service.report(ctxOf(s.clock, { guestSession: session }), { kind: 'guest', session }, { target: { account: bob.auth.account }, reason })).report);
    }
    s.clock.advance(1);
    ids.push(value(await s.service.report(ctxOf(s.clock), { kind: 'account', auth: bob.auth }, { target: { account: alice.auth.account }, reason: 'stalling' })).report);
    expect((await s.service.admin.reports(OP, { limit: 10 })).map((r) => r.id)).toEqual(ids);
    expect((await s.service.admin.reports(OP, { target: bob.auth.account, limit: 2 })).map((r) => r.id)).toEqual(ids.slice(0, 2));
    expect((await s.service.admin.reports(OP, { reporter: bob.auth.account, limit: 10 })).map((r) => r.id)).toEqual([ids[3]]);
    expect((await s.service.admin.reports(OP, { after: ids[1]!, limit: 10 })).map((r) => r.id)).toEqual(ids.slice(2));
    await s.service.admin.closeReport(OP, ids[0]!, 'dismissed', 'duplicate');
    expect((await s.service.admin.reports(OP, { status: 'new', limit: 10 })).map((r) => r.id)).toEqual(ids.slice(1));
    expect(await s.service.admin.showReport(OP, ids[0]!)).toMatchObject({ status: 'dismissed', closedBy: 'admin:Mod Alice', note: 'duplicate' });
    await expect(s.service.admin.closeReport(OP, ids[0]!, 'actioned')).rejects.toMatchObject({ code: 'conflict' });
    await expect(s.service.admin.closeReport(OP, 'rep_01J0000000000000000000ZZZZ', 'actioned')).rejects.toMatchObject({ code: 'notFound' });
    await expect(s.service.admin.closeReport(OP, ids[1]!, 'maybe' as never)).rejects.toMatchObject({ code: 'invalid' });
    expect(await s.service.admin.showReport(OP, 'rep_01J0000000000000000000ZZZZ')).toBeNull();
    for (const q of [{ limit: 0 }, { limit: 1_001 }, { status: 'open', limit: 5 }, { target: 'x', limit: 5 }] as never[]) {
      await expect(s.service.admin.reports(OP, q)).rejects.toMatchObject({ code: 'invalid' });
    }
  });

  it('the audit log of an account, from --since; appeals, open or all', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const w = await s.service.admin.sanction(OP, alice.auth.account, { kind: 'warn', reason: 'chat', until: null, message: 'Careful.' });
    value(await s.service.appeal(ctxOf(s.clock), alice.auth, w.id, 'Why?', { password: PW }));
    await events(s);
    s.clock.advance(DAY);
    const all = await s.service.admin.audit(OP, alice.auth.account);
    expect(all.map((e) => e.kind)).toEqual(expect.arrayContaining(['registered', 'sanctioned', 'appealed', 'adminViewed']));
    const since = await s.service.admin.audit(OP, alice.auth.account, s.clock.now().toISOString());
    expect(since.map((e) => e.kind)).toEqual(['adminViewed', 'adminViewed']);
    expect((await s.service.admin.appeals(OP, { limit: 5 })).map((a) => a.sanction)).toEqual([w.id]);
    expect((await s.service.admin.appeals(OP, { open: false, limit: 5 }))).toEqual([]);
    await expect(s.service.admin.audit(OP, alice.auth.account, 'last week')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('M14-6: reserved names and revocations (9.6, 6.5)', () => {
  it('reserve: nameTaken for everyone after; not over a current key, over a held one; release frees reserved, banned and held keys, never a current one', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    await s.service.admin.reserveName(OP, 'Tournament Desk', 'events');
    expect(await s.store.nameEntry(s.names.key('Tournament Desk'), 1)).toMatchObject({ kind: 'reserved', account: null, note: 'events', until: null });
    const reg = (name: string) =>
      s.service.register(ctxOf(s.clock, { addressKey: `192.0.2.${name.length + 40}`, guestSession: null }), { name, password: PW, birth: BIRTH, claimGuest: false });
    expect(code(await reg('tournament-desk'))).toBe('nameTaken');
    expect(await s.service.nameUnavailable('TOURNAMENT DESK')).toBe(true);
    await expect(s.service.admin.reserveName(OP, 'ALICE')).rejects.toMatchObject({ code: 'conflict' });
    await expect(s.service.admin.releaseName(OP, 'Alice')).rejects.toMatchObject({ code: 'conflict' });
    // a held key (after a rename) is reserved over (the operator blocks an offending old name for good); a reservation may be released
    s.clock.advance(HOUR);
    value(await s.service.rename(ctxOf(s.clock), alice.auth, 'Alicia', { password: PW }));
    expect(await s.store.nameEntry('allce', 1)).toMatchObject({ kind: 'held', account: alice.auth.account });
    await s.service.admin.reserveName(OP, 'Alice', 'blocked');
    expect(await s.store.nameEntry('allce', 1)).toMatchObject({ kind: 'reserved', account: null, until: null, note: 'blocked' });
    s.clock.advance(1);
    await s.service.admin.releaseName(OP, 'alice');
    value(await reg('Alice'));
    await s.service.admin.releaseName(OP, 'Tournament Desk');
    value(await reg('Tournament Desk'));
    await expect(s.service.admin.releaseName(OP, 'Nobody Here')).rejects.toMatchObject({ code: 'notFound' });
    await expect(s.service.admin.reserveName(OP, 'X')).rejects.toMatchObject({ code: 'invalid' });
    const ev = (await events(s)).filter((e) => e.kind === 'nameReserved' || e.kind === 'nameReleased');
    expect(ev.map((e) => [e.kind, e.account, e.details])).toEqual([
      ['nameReserved', null, {}], ['nameReserved', null, {}], ['nameReleased', null, {}], ['nameReleased', null, {}],
    ]);
  });

  it('revoke: every live session of the account, reason admin, one sessionsRevoked change; 0 the second time', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.77' }), { name: 'Alice', password: PW }));
    const before = await s.service.changesHead();
    expect(await s.service.admin.revokeSessions(OP, alice.auth.account)).toBe(2);
    expect(code(await s.service.self(ctxOf(s.clock), alice.auth))).toBe('sessionRevoked');
    expect((await s.store.sessionsOf(alice.auth.account)).map((r) => r.revokeReason)).toEqual(['admin', 'admin']);
    expect((await s.service.changes(before, 10)).map((c) => c.kind)).toEqual(['sessionsRevoked']);
    expect(await s.service.admin.revokeSessions(OP, alice.auth.account)).toBe(0);
    expect((await s.service.changes(before, 10)).map((c) => c.kind)).toEqual(['sessionsRevoked']);
    await expect(s.service.admin.revokeSessions(OP, UNKNOWN_ID)).rejects.toMatchObject({ code: 'notFound' });
  });
});

describe('M14-6: every command audited with the operator and the OS user (9.6, D16)', () => {
  it('each moderation command writes its events, reads included, as admin:<name> with actorOs; a bad operator is refused before anything', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const A = alice.auth.account;
    const rep = value(await s.service.report(ctxOf(s.clock), { kind: 'account', auth: bob.auth }, { target: { account: A }, reason: 'chat' }));
    const before = new Set((await events(s)).map((e) => e.id));
    const op: Operator = { name: 'Night Shift', osUser: 'mod-ops' };
    const step = () => s.clock.advance(1);
    const ran: [string, AuditEvent['kind'][]][] = [];
    const run = async (what: string, kinds: AuditEvent['kind'][], f: () => Promise<unknown>) => {
      step();
      await f();
      ran.push([what, kinds]);
    };
    await run('find', ['adminViewed'], () => s.service.admin.find(op, 'ali'));
    await run('show', ['adminViewed'], () => s.service.admin.show(op, A));
    await run('reports', ['adminViewed'], () => s.service.admin.reports(op, { limit: 5 }));
    await run('showReport', ['adminViewed'], () => s.service.admin.showReport(op, rep.report));
    await run('closeReport', ['reportClosed'], () => s.service.admin.closeReport(op, rep.report, 'actioned'));
    let sanction = '';
    await run('sanction', ['sanctioned'], async () => {
      sanction = (await s.service.admin.sanction(op, A, { kind: 'mute', reason: 'chat', until: new Date(s.clock.t + DAY).toISOString(), message: 'Hush.' })).id;
    });
    await run('appeal (the account)', [], () => s.service.appeal(ctxOf(s.clock), alice.auth, sanction, 'Sorry.', { password: PW }));
    await run('appeals', ['adminViewed'], () => s.service.admin.appeals(op, { open: true, limit: 5 }));
    await run('answerAppeal', ['appealAnswered', 'sanctionLifted'], () => s.service.admin.answerAppeal(op, sanction, 'lifted', 'Fine.'));
    let warn = '';
    await run('warn', ['sanctioned'], async () => {
      warn = (await s.service.admin.sanction(op, A, { kind: 'warn', reason: 'chat', until: null, message: 'Careful.' })).id;
    });
    await run('lift', ['sanctionLifted'], () => s.service.admin.lift(op, warn));
    await run('forceRename', ['forcedRename'], () => s.service.admin.forceRename(op, A, 'name'));
    await run('reserveName', ['nameReserved'], () => s.service.admin.reserveName(op, 'Help Desk'));
    await run('releaseName', ['nameReleased'], () => s.service.admin.releaseName(op, 'Help Desk'));
    await run('revokeSessions', ['sessionsRevoked'], () => s.service.admin.revokeSessions(op, A));
    await run('audit', ['adminViewed'], () => s.service.admin.audit(op, A));
    const fresh = (await events(s)).filter((e) => !before.has(e.id));
    const byOp = fresh.filter((e) => e.actor.startsWith('admin:'));
    expect(byOp.every((e) => e.actor === 'admin:Night Shift' && e.actorOs === 'mod-ops')).toBe(true);
    expect(byOp.map((e) => e.kind).sort()).toEqual(ran.flatMap(([, k]) => k).sort());
    // the reads say what was read, about whom
    expect(byOp.filter((e) => e.kind === 'adminViewed').map((e) => [(e.details as { what: string }).what, e.account])).toEqual([
      ['find', null], ['show', A], ['reports', null], ['report', A], ['appeals', null], ['audit', A],
    ]);
    // operator events are the operator kinds only (8.5): nothing of the operator's leaks into the account's security events
    expect(byOp.filter((e) => OPERATOR_AUDIT_KINDS.includes(e.kind)).every((e) => e.kind === 'adminViewed' || e.kind === 'nameReserved' || e.kind === 'nameReleased')).toBe(true);
    // a bad operator: refused ('invalid') before anything is read or written
    const n = (await events(s)).length;
    for (const bad of [{ name: '', osUser: 'u' }, { name: 'x'.repeat(65), osUser: 'u' }, { name: 'op', osUser: 'u'.repeat(65) }, { name: 'o\u0000p', osUser: 'u' }, null]) {
      await expect(s.service.admin.find(bad as never, 'ali')).rejects.toMatchObject({ code: 'invalid' });
      await expect(s.service.admin.revokeSessions(bad as never, A)).rejects.toMatchObject({ code: 'invalid' });
      await expect(s.service.admin.sanction(bad as never, A, { kind: 'warn', reason: 'chat', until: null, message: 'x' })).rejects.toMatchObject({ code: 'invalid' });
    }
    expect((await events(s)).length).toBe(n);
  });
});

describe('M14-6: the part in the composed service (13.3)', () => {
  it('createModerationPart is built; composeAccounts wires it in, with its own name rules and the system clock', async () => {
    expect(builtFactories().createModerationPart).toBe(createModerationPart);
    const factories = {
      createPasswordHasher: (o: Parameters<typeof buildPasswordHasher>[0]) => buildPasswordHasher(o, { derive: fastDerive, sleep: async () => undefined }),
      // M14-8's mailer may not be merged yet: a stand-in while its stub is undefined
      ...(builtFactories().createNoMailer === undefined ? { createNoMailer: () => ({ kind: 'none', send: async () => undefined }) } : {}),
    };
    const { service } = await composeAccounts(configOf(), { guests: new FakeGuests(), log: { event: () => undefined }, factories });
    const ctx = { now: new Date(), connection: 'c', addressKey: '192.0.2.1', guestSession: null, guestBusy: false, client: 'desktop' as const };
    const a = value(await service.register(ctx, { name: 'Composed', password: PW, birth: BIRTH, claimGuest: false }));
    const b = value(await service.register({ ...ctx, addressKey: '192.0.2.2' }, { name: 'Other', password: PW, birth: BIRTH, claimGuest: false }));
    value(await service.block(ctx, a.auth, b.auth.account, true));
    expect(await service.directory.blockedAmong([a.auth.account, b.auth.account])).toHaveLength(1);
    expect((await service.admin.find(OP, 'compo')).map((x) => x.name)).toEqual(['Composed']);
    const renamed = await service.admin.forceRename(OP, b.auth.account, 'name', 'Renamed One');
    expect(renamed.name).toBe('Renamed One');
    await service.close();
  });
});
