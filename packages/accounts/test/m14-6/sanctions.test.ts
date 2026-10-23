/**
 * M14-6: sanctions and their ends, forced renames and appeals (design 9.3-9.5, 3.8, 6.5, 6.7, 9.7; 13.2): each sanction kind and its end by tick,
 * recorded once (no repeated sanctionExpired, one `standing` change each way); overlapping ban and suspension; a warning until marked seen; a ban
 * revoking every session at once and `--now` in the change; a forced rename banning the old key, redacting it and granting a free rename; appeals
 * once per sanction, an appeal of another account's sanction answering notFound and leaving that sanction's appeal unused; the operator's answers.
 */
import { describe, expect, it } from 'vitest';
import { AccountsAdminError, newSanctionId, SANCTION_VIEW_KEYS, type AccountId, type NewSanction, type SanctionRow } from '@openmtg/accounts';
import { FORCED_RENAME_MESSAGE } from '../../src/admin/names';
import {
  addressFor, beforeNext, BIRTH, code, countCalls, ctxOf, DAY, events, failOnce, fixedRandom, HOUR, inRow, markDeleting, OP, PW, registerAs, setup,
  T0, value, wrappedStore, type Setup,
} from './support';

const at = (ms: number) => new Date(T0 + ms).toISOString();
const ban = (until: string | null): NewSanction => ({ kind: 'ban', reason: 'cheating', until, message: 'You are banned.' });
const suspend = (until: string): NewSanction => ({ kind: 'suspend', reason: 'harassment', until, message: 'You are suspended.' });

async function signInAgain(s: Setup, name: string) {
  return value(inRow('signIn', await s.service.signIn(ctxOf(s.clock, { addressKey: addressFor(`again ${name}`), connection: `again-${name}` }), { name, password: PW })));
}

describe('M14-6: each sanction kind and its end (9.3)', () => {
  it('warn, mute, unlist, suspend and ban: their standing, their ends at until without tick, each expiry recorded once by tick', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    const warn = await s.service.admin.sanction(OP, A, { kind: 'warn', reason: 'chat', until: at(DAY), message: 'Mind your words.' });
    expect(warn.until).toBeNull();
    expect(Object.keys(warn)).toEqual([...SANCTION_VIEW_KEYS]);
    const ends = { mute: DAY, unlist: 2 * DAY, suspend: 3 * DAY, ban: 4 * DAY } as const;
    const ids: Record<string, string> = {};
    for (const kind of ['mute', 'unlist', 'suspend', 'ban'] as const) {
      s.clock.advance(1);
      ids[kind] = (await s.service.admin.sanction(OP, A, { kind, reason: 'spam', until: at(ends[kind]), message: `${kind} message` })).id;
    }
    expect(await s.service.directory.standing(A)).toMatchObject({ status: 'banned', ranked: false, listed: false, chat: false, until: at(4 * DAY) });
    const changes = async () => (await s.service.changes(0, 1_000)).filter((c) => c.account === A).map((c) => c.kind);
    expect(await changes()).toEqual(['standing', 'standing', 'standing', 'standing', 'sessionsRevoked']);

    const expired = async () => (await events(s)).filter((e) => e.kind === 'sanctionExpired').map((e) => (e.details as { sanction: string }).sanction);
    // a tick before any end records nothing
    expect((await s.service.tick(s.clock.now())).sanctionsEnded).toBe(0);
    for (const kind of ['mute', 'unlist', 'suspend', 'ban'] as const) {
      s.clock.t = T0 + ends[kind];
      const r = await s.service.tick(s.clock.now());
      expect(r.sanctionsEnded, kind).toBe(1);
      expect((await s.service.tick(s.clock.now())).sanctionsEnded, `${kind} twice`).toBe(0);
    }
    expect(await expired()).toEqual([ids['mute'], ids['unlist'], ids['suspend'], ids['ban']]);
    expect(await s.service.directory.standing(A)).toMatchObject({ status: 'active', ranked: true, listed: true, chat: true, until: null });
    expect(await changes()).toEqual(['standing', 'standing', 'standing', 'standing', 'sessionsRevoked', 'standing', 'standing', 'standing', 'standing']);
    const rows = await s.store.sanctionsOf(A);
    for (const kind of ['mute', 'unlist', 'suspend', 'ban'] as const) {
      expect(rows.find((r) => r.id === ids[kind]), kind).toMatchObject({ endedAt: at(ends[kind]), endReason: 'expired', endedBy: 'system' });
    }
    // the warning has no end: never expired
    expect(rows.find((r) => r.id === warn.id)).toMatchObject({ until: null, endedAt: null });
    s.clock.advance(30 * DAY);
    expect((await s.service.tick(s.clock.now())).sanctionsEnded).toBe(0);
    expect(await expired()).toHaveLength(4);
  });

  it('the status changes at until without tick; one tick long after records every passed end once', async () => {
    const s = setup();
    const bob = await registerAs(s, 'Bob');
    const B = bob.auth.account;
    await s.service.admin.sanction(OP, B, suspend(at(HOUR)));
    await s.service.admin.sanction(OP, B, { kind: 'mute', reason: 'chat', until: at(2 * HOUR), message: 'Quiet, please.' });
    expect(code(inRow('setAvatar', await s.service.setAvatar(ctxOf(s.clock), bob.auth, 'd6-amber')))).toBe('suspended');
    s.clock.t = T0 + HOUR;
    expect(value(await s.service.setAvatar(ctxOf(s.clock), bob.auth, 'd6-amber')).status).toBe('active');
    expect((await s.service.directory.standing(B))!.chat).toBe(false);
    s.clock.t = T0 + 10 * DAY;
    expect((await s.service.directory.standing(B))!.chat).toBe(true);
    expect((await s.service.tick(s.clock.now())).sanctionsEnded).toBe(2);
    expect((await s.service.tick(s.clock.now())).sanctionsEnded).toBe(0);
    expect((await events(s)).filter((e) => e.kind === 'sanctionExpired')).toHaveLength(2);
    // each end is recorded at its own until, when it really ended, not at the tick's time
    const ends = (await s.store.sanctionsOf(B)).map((r) => [r.kind, r.endedAt, r.endReason]).sort();
    expect(ends).toEqual([['mute', at(2 * HOUR), 'expired'], ['suspend', at(HOUR), 'expired']]);
  });

  it('a sanction whose until has passed cannot be lifted, even before tick records its expiry', async () => {
    const s = setup();
    const bob = await registerAs(s, 'Bob');
    const sus = await s.service.admin.sanction(OP, bob.auth.account, suspend(at(HOUR)));
    s.clock.t = T0 + 2 * HOUR;
    await expect(s.service.admin.lift(OP, sus.id)).rejects.toMatchObject({ code: 'conflict' });
    expect((await s.store.sanctionsOf(bob.auth.account))[0]).toMatchObject({ endedAt: null, endReason: null });
    expect((await s.service.tick(s.clock.now())).sanctionsEnded).toBe(1);
    expect((await s.store.sanctionsOf(bob.auth.account))[0]).toMatchObject({ endedAt: at(HOUR), endReason: 'expired', endedBy: 'system' });
    expect((await events(s)).filter((e) => e.kind === 'sanctionLifted')).toEqual([]);
  });

  it('a mute takes chat, an unlist the leaderboards, nothing else', async () => {
    const s = setup();
    const carol = await registerAs(s, 'Carol');
    const dave = await registerAs(s, 'Dave');
    await s.service.admin.sanction(OP, carol.auth.account, { kind: 'mute', reason: 'chat', until: at(DAY), message: 'Muted.' });
    await s.service.admin.sanction(OP, dave.auth.account, { kind: 'unlist', reason: 'smurf', until: null, message: 'Unlisted.' });
    expect(await s.service.directory.standing(carol.auth.account)).toMatchObject({ status: 'active', ranked: true, listed: true, chat: false, until: at(DAY) });
    expect(await s.service.directory.standing(dave.auth.account)).toMatchObject({ status: 'active', ranked: true, listed: false, chat: true, until: null });
    // an active session works as before
    value(await s.service.setAvatar(ctxOf(s.clock), carol.auth, 'd8-blue'));
    value(await s.service.setAvatar(ctxOf(s.clock), dave.auth, 'd8-blue'));
  });
});

describe('M14-6: an end is recorded once, whoever races for it (9.3, 11.2)', () => {
  it('two servers ticking at once on one store: each expiry recorded by one of them, one sanctionExpired and one standing change each', async () => {
    const one = setup();
    const two = setup({ store: one.store, clock: one.clock });
    const alice = await registerAs(one, 'Alice');
    const bob = await registerAs(one, 'Bob');
    await one.service.admin.sanction(OP, alice.auth.account, { kind: 'mute', reason: 'chat', until: at(HOUR), message: 'Hush.' });
    await one.service.admin.sanction(OP, bob.auth.account, suspend(at(HOUR)));
    const head = await one.service.changesHead();
    one.clock.t = T0 + HOUR;
    const [a, b] = await Promise.all([one.service.tick(one.clock.now()), two.service.tick(two.clock.now())]);
    expect(a.sanctionsEnded + b.sanctionsEnded).toBe(2);
    await two.partDeps.current!.audit.flush();
    expect((await events(one)).filter((e) => e.kind === 'sanctionExpired')).toHaveLength(2);
    expect((await one.service.changes(head, 100)).map((c) => c.kind)).toEqual(['standing', 'standing']);
  });

  for (const order of ['lift first', 'tick first'] as const) {
    it(`a lift racing the tick that would record the expiry (${order}): exactly one end, one event, one change`, async () => {
      const s = setup();
      const alice = await registerAs(s, 'Alice');
      const v = await s.service.admin.sanction(OP, alice.auth.account, suspend(at(HOUR)));
      const head = await s.service.changesHead();
      s.clock.t = T0 + HOUR - 1;
      const lift = () => s.service.admin.lift(OP, v.id).then(() => 'lifted', (e: unknown) => (e as AccountsAdminError).code);
      const tick = () => s.service.tick(new Date(T0 + HOUR)).then((r) => r.sanctionsEnded);
      const results = order === 'lift first' ? await Promise.all([lift(), tick()]) : (await Promise.all([tick(), lift()])).reverse();
      const row = (await s.store.sanctionsOf(alice.auth.account))[0]!;
      const ev = (await events(s)).filter((e) => e.kind === 'sanctionLifted' || e.kind === 'sanctionExpired');
      expect(ev).toHaveLength(1);
      if (row.endReason === 'lifted') expect(results).toEqual(['lifted', 0]);
      else {
        expect(row.endReason).toBe('expired');
        expect(results).toEqual(['conflict', 1]);
      }
      expect(ev[0]!.kind).toBe(row.endReason === 'lifted' ? 'sanctionLifted' : 'sanctionExpired');
      expect((await s.service.changes(head, 100)).map((c) => c.kind)).toEqual(['standing']);
    });
  }
});

describe('M14-6: a command is on record for what it did when the store fails half-way (8.5, D16, 9.3)', () => {
  const byKind = (e: { kind: string }, f: { kind: string }) => e.kind.localeCompare(f.kind);

  it('a ban whose standing change fails: stored, its sessions revoked, both on record; a later lift finds it and names its account', async () => {
    const store = wrappedStore();
    const s = setup({ store });
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    const head = await s.service.changesHead();
    failOnce(store, 'appendChange');
    await expect(s.service.admin.sanction(OP, A, ban(null))).rejects.toThrow(/the store failed/);
    const [row] = await s.store.sanctionsOf(A);
    expect(row).toMatchObject({ kind: 'ban', endedAt: null });
    expect(code(inRow('resume', await s.service.resume(ctxOf(s.clock), alice.token)))).toBe('sessionRevoked');
    expect((await s.store.sessionsOf(A)).map((r) => r.revokeReason)).toEqual(['sanction']);
    const byOp = (await events(s)).filter((e) => e.actor === 'admin:Mod Alice').sort(byKind);
    expect(byOp.map((e) => [e.kind, e.account, e.details])).toEqual([
      ['sanctioned', A, { sanction: row!.id, kind: 'ban', reason: 'cheating', now: false }], ['sessionsRevoked', A, { reason: 'sanction', count: 1 }],
    ]);
    expect(await s.service.changes(head, 10)).toEqual([]);
    s.clock.advance(HOUR);
    await s.service.admin.lift(OP, row!.id);
    expect((await events(s)).filter((e) => e.kind === 'sanctionLifted').map((e) => [e.account, e.details])).toEqual([[A, { sanction: row!.id }]]);
    expect((await s.service.changes(head, 10)).map((c) => [c.kind, c.account])).toEqual([['standing', A]]);
  });

  it('lift, answer and revoke whose change fails: each on record; a forced rename on record before its later steps', async () => {
    const store = wrappedStore();
    const s = setup({ store });
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    const mute = await s.service.admin.sanction(OP, A, { kind: 'mute', reason: 'chat', until: at(DAY), message: 'Hush.' });
    const sus = await s.service.admin.sanction(OP, A, suspend(at(DAY)));
    value(await s.service.appeal(ctxOf(s.clock), alice.auth, sus.id, 'Please.', { password: PW }));
    const kinds = async () => (await events(s)).filter((e) => e.actor === 'admin:Mod Alice' && e.kind !== 'sanctioned').map((e) => e.kind).sort();
    s.clock.advance(1);
    failOnce(store, 'appendChange');
    await expect(s.service.admin.lift(OP, mute.id)).rejects.toThrow(/the store failed/);
    expect(await kinds()).toEqual(['sanctionLifted']);
    failOnce(store, 'appendChange');
    await expect(s.service.admin.answerAppeal(OP, sus.id, 'lifted', 'Fair enough.')).rejects.toThrow(/the store failed/);
    expect(await kinds()).toEqual(['appealAnswered', 'sanctionLifted', 'sanctionLifted']);
    expect((await s.store.sanctionsOf(A)).map((r) => r.endReason).sort()).toEqual(['appeal', 'lifted']);
    failOnce(store, 'appendChange');
    await expect(s.service.admin.revokeSessions(OP, A)).rejects.toThrow(/the store failed/);
    expect(await kinds()).toEqual(['appealAnswered', 'sanctionLifted', 'sanctionLifted', 'sessionsRevoked']);
    // a forced rename whose redaction fails: renamed and on record
    s.clock.advance(1);
    failOnce(store, 'redactName');
    await expect(s.service.admin.forceRename(OP, A, 'name')).rejects.toThrow(/the store failed/);
    expect((await s.store.account(A))!.name).toMatch(/^Player [0-9]{6}$/);
    expect(await kinds()).toEqual(['appealAnswered', 'forcedRename', 'sanctionLifted', 'sanctionLifted', 'sessionsRevoked']);
  });

  it('a sanction is found by its id alone: lift and answer read nothing of the audit log, and name its account', async () => {
    const store = wrappedStore();
    const s = setup({ store });
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    // written straight into the store: no `sanctioned` event names them
    const random = fixedRandom('no event');
    const row = (kind: SanctionRow['kind']): SanctionRow => ({
      id: newSanctionId(s.clock.now(), random), account: A, kind, reason: 'chat', message: 'Quiet.', note: null, createdAt: at(0), createdBy: 'admin:Earlier',
      reports: [], since: at(0), until: at(DAY), endedAt: null, endReason: null, endedBy: null, seenAt: null,
    });
    const mute = row('mute');
    const sus = row('suspend');
    await store.putSanction(mute);
    await store.putSanction(sus);
    value(await s.service.appeal(ctxOf(s.clock), alice.auth, sus.id, 'Please.', { password: PW }));
    const head = await s.service.changesHead();
    await events(s);
    const reads = countCalls(store, 'audit');
    s.clock.advance(HOUR);
    await s.service.admin.lift(OP, mute.id);
    await s.service.admin.answerAppeal(OP, sus.id, 'lifted', 'Granted.');
    await expect(s.service.admin.lift(OP, newSanctionId(s.clock.now(), random))).rejects.toMatchObject({ code: 'notFound' });
    await expect(s.service.admin.answerAppeal(OP, newSanctionId(s.clock.now(), random), 'upheld', 'x')).rejects.toMatchObject({ code: 'notFound' });
    expect(reads.n).toBe(0);
    const ev = (await events(s)).filter((e) => e.kind === 'sanctionLifted' || e.kind === 'appealAnswered').sort(byKind);
    expect(ev.map((e) => [e.kind, e.account, e.details])).toEqual([
      ['appealAnswered', A, { sanction: sus.id, answer: 'lifted' }], ['sanctionLifted', A, { sanction: mute.id }], ['sanctionLifted', A, { sanction: sus.id }],
    ]);
    expect((await s.service.changes(head, 10)).map((c) => [c.kind, c.account])).toEqual([['standing', A], ['standing', A]]);
  });

  it('an expiry whose standing change fails is owed: the next tick appends it, once', async () => {
    const store = wrappedStore();
    const s = setup({ store });
    const bob = await registerAs(s, 'Bob');
    const B = bob.auth.account;
    await s.service.admin.sanction(OP, B, suspend(at(HOUR)));
    const head = await s.service.changesHead();
    s.clock.t = T0 + HOUR;
    failOnce(store, 'appendChange');
    await s.service.tick(s.clock.now());
    expect(s.log.map((l) => [l.name, l.fields['part']])).toContainEqual(['accounts.tick.failed', 'moderation']);
    expect((await s.store.sanctionsOf(B))[0]).toMatchObject({ endedAt: at(HOUR), endReason: 'expired' });
    expect(await s.service.changes(head, 10)).toEqual([]);
    s.clock.advance(1);
    expect((await s.service.tick(s.clock.now())).sanctionsEnded).toBe(0);
    expect((await s.service.changes(head, 10)).map((c) => [c.kind, c.account, c.at])).toEqual([['standing', B, at(HOUR)]]);
    await s.service.tick(s.clock.now());
    expect(await s.service.changes(head, 10)).toHaveLength(1);
    expect((await events(s)).filter((e) => e.kind === 'sanctionExpired')).toHaveLength(1);
  });

  it('a second tick of the same server while the first appends a standing change: the change is appended once', async () => {
    const store = wrappedStore();
    const s = setup({ store });
    const bob = await registerAs(s, 'Bob');
    await s.service.admin.sanction(OP, bob.auth.account, suspend(at(HOUR)));
    const head = await s.service.changesHead();
    s.clock.t = T0 + HOUR;
    let second = -1;
    beforeNext(store, 'appendChange', async () => {
      second = (await s.service.tick(s.clock.now())).sanctionsEnded;
    });
    expect((await s.service.tick(s.clock.now())).sanctionsEnded).toBe(1);
    expect(second).toBe(0);
    expect((await s.service.changes(head, 10)).map((c) => c.kind)).toEqual(['standing']);
  });
});

describe('M14-6: overlapping sanctions (9.3, 3.8)', () => {
  it('a permanent ban over a 30-day suspension: lifting the ban leaves the suspension, lifting that leaves the account active', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    const sus = await s.service.admin.sanction(OP, A, suspend(at(30 * DAY)));
    s.clock.advance(1);
    const b = await s.service.admin.sanction(OP, A, ban(null));
    expect((await s.service.directory.standing(A))!.status).toBe('banned');
    expect((await s.service.directory.standing(A))!.until).toBeNull();
    s.clock.advance(HOUR);
    // the store keeps no note for an end: a note is refused, never dropped
    await expect(s.service.admin.lift(OP, b.id, 'second thoughts')).rejects.toMatchObject({ code: 'invalid' });
    await s.service.admin.lift(OP, b.id);
    expect(await s.service.directory.standing(A)).toMatchObject({ status: 'suspended', until: at(30 * DAY) });
    await expect(s.service.admin.lift(OP, b.id)).rejects.toMatchObject({ code: 'conflict' });
    s.clock.advance(1);
    await s.service.admin.lift(OP, sus.id);
    expect((await s.service.directory.standing(A))!.status).toBe('active');
    const rows = await s.store.sanctionsOf(A);
    expect(rows.map((r) => [r.kind, r.endReason, r.endedBy])).toEqual([['suspend', 'lifted', 'admin:Mod Alice'], ['ban', 'lifted', 'admin:Mod Alice']]);
    // each lift: one sanctionLifted, one standing change
    const lifted = (await events(s)).filter((e) => e.kind === 'sanctionLifted');
    expect(lifted.map((e) => [e.account, (e.details as { sanction: string }).sanction])).toEqual([[A, b.id], [A, sus.id]]);
    expect((await s.service.changes(0, 100)).filter((c) => c.kind === 'standing')).toHaveLength(4);
  });

  it('a ban ending before an overlapping suspension leaves the account suspended until the suspension ends', async () => {
    const s = setup();
    const bob = await registerAs(s, 'Bob');
    const B = bob.auth.account;
    await s.service.admin.sanction(OP, B, ban(at(DAY)));
    await s.service.admin.sanction(OP, B, suspend(at(3 * DAY)));
    expect(await s.service.directory.standing(B)).toMatchObject({ status: 'banned', until: at(3 * DAY) });
    s.clock.t = T0 + DAY;
    expect((await s.service.directory.standing(B))!.status).toBe('suspended');
    await s.service.tick(s.clock.now());
    expect((await s.service.directory.standing(B))!.status).toBe('suspended');
    // an expired sanction is not lifted again
    const banRow = (await s.store.sanctionsOf(B)).find((r) => r.kind === 'ban')!;
    await expect(s.service.admin.lift(OP, banRow.id)).rejects.toMatchObject({ code: 'conflict' });
    s.clock.t = T0 + 3 * DAY;
    expect((await s.service.directory.standing(B))!.status).toBe('active');
    await expect(s.service.admin.lift(OP, 'san_01J0000000000000000000ZZZZ')).rejects.toMatchObject({ code: 'notFound' });
    await expect(s.service.admin.lift(OP, 'not-a-sanction')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('M14-6: a ban\'s sessions and --now (3.8, 9.3, 9.7)', () => {
  it('a ban revokes every session at once; the right password signs in again to a restricted session; --now rides on the standing change', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const second = await signInAgain(s, 'Alice');
    const A = alice.auth.account;
    const before = await s.service.changesHead();
    const view = await s.service.admin.sanction(OP, A, { ...ban(null), now: true });
    expect(code(inRow('resume', await s.service.resume(ctxOf(s.clock), alice.token)))).toBe('sessionRevoked');
    expect(code(inRow('resume', await s.service.resume(ctxOf(s.clock), second.token)))).toBe('sessionRevoked');
    const feed = (await s.service.changes(before, 100)).map((c) => [c.kind, c.detail ?? null]);
    expect(feed).toEqual([['standing', { now: true }], ['sessionsRevoked', null]]);
    expect((await s.store.sessionsOf(A)).every((r) => r.revokeReason === 'sanction')).toBe(true);
    const back = await signInAgain(s, 'Alice');
    expect(back.account.restricted).toBe(true);
    expect(back.account.status).toBe('banned');
    expect(back.account.sanctions.map((x) => x.id)).toEqual([view.id]);
    // one command's events share its time: in kind order
    const ev = (await events(s)).filter((e) => e.kind === 'sanctioned' || (e.kind === 'sessionsRevoked' && e.actor !== 'system'));
    expect(ev.map((e) => [e.kind, e.actor, e.actorOs, e.details]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))).toEqual([
      ['sanctioned', 'admin:Mod Alice', 'tester', { sanction: view.id, kind: 'ban', reason: 'cheating', now: true }],
      ['sessionsRevoked', 'admin:Mod Alice', 'tester', { reason: 'sanction', count: 2 }],
    ]);
  });

  it('a suspension keeps the sessions, restricted from the next call on; --now only for a suspension or a ban', async () => {
    const s = setup();
    const bob = await registerAs(s, 'Bob');
    const before = await s.service.changesHead();
    await s.service.admin.sanction(OP, bob.auth.account, { ...suspend(at(DAY)), now: true });
    expect((await s.service.changes(before, 100)).map((c) => [c.kind, c.detail ?? null])).toEqual([['standing', { now: true }]]);
    expect(value(await s.service.self(ctxOf(s.clock), bob.auth)).restricted).toBe(true);
    expect(code(await s.service.setPrivacy(ctxOf(s.clock), bob.auth, { history: 'public' }))).toBe('suspended');
    for (const kind of ['warn', 'mute', 'unlist'] as const) {
      await expect(s.service.admin.sanction(OP, bob.auth.account, { kind, reason: 'spam', until: at(HOUR), message: 'x', now: true })).rejects.toMatchObject({ code: 'invalid' });
    }
  });
});

describe('M14-6: a warning until it is marked seen (9.3)', () => {
  it('SelfView lists a warning (never its note) until the account marks it seen; only its own', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const w = await s.service.admin.sanction(OP, alice.auth.account, { kind: 'warn', reason: 'chat', until: null, message: 'Please be kind.', note: 'internal: third time' });
    const seen = value(await s.service.self(ctxOf(s.clock), alice.auth));
    expect(seen.status).toBe('active');
    expect(seen.sanctions).toEqual([{ id: w.id, kind: 'warn', reason: 'chat', message: 'Please be kind.', since: s.clock.now().toISOString(), until: null, ended: null, appeal: null }]);
    expect(JSON.stringify(seen)).not.toContain('internal');
    // another account cannot mark it
    expect(code(inRow('markSeen', await s.service.markSeen(ctxOf(s.clock), bob.auth, w.id)))).toBe('notFound');
    s.clock.advance(DAY);
    expect(value(await s.service.self(ctxOf(s.clock), alice.auth)).sanctions.map((x) => x.id)).toEqual([w.id]);
    expect(value(inRow('markSeen', await s.service.markSeen(ctxOf(s.clock), alice.auth, w.id))).sanctions).toEqual([]);
    expect((await s.store.sanctionsOf(alice.auth.account))[0]).toMatchObject({ seenAt: s.clock.now().toISOString(), note: 'internal: third time', endedAt: null });
    // it stays on record for the operator
    expect((await s.service.admin.show(OP, alice.auth.account))!.sanctions.map((x) => x.id)).toEqual([w.id]);
  });
});

describe('M14-6: the forced rename (9.4, 6.5, 6.7)', () => {
  it('bans the old key, redacts it, grants one free rename, and leaves a notice until it is seen', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    s.clock.advance(HOUR);
    const renamed = await s.service.admin.forceRename(OP, A, 'name');
    expect(renamed.name).toMatch(/^Player [0-9]{6}$/);
    expect(renamed.freeRename).toBe(true);
    // the old key: banned, keeping the account it was taken from (M14-15, review A6: its owner still signs in by it); registering it or a
    // look-alike answers nameTaken
    expect(await s.store.nameEntry('allce', 1)).toMatchObject({ kind: 'banned', account: A, until: null });
    for (const name of ['Alice', 'ALICE', 'Allce']) {
      expect(code(await s.service.register(ctxOf(s.clock, { addressKey: addressFor(name), guestSession: null }), { name, password: PW, birth: { year: 1990, month: 5 }, claimGuest: false }))).toBe('nameTaken');
    }
    // the old name is redacted: even the account sees its current name in its history (6.7)
    expect((await s.store.nameHistory(A)).map((h) => [h.name, h.cause, h.redacted])).toEqual([['Alice', 'register', true], [renamed.name, 'forced', false]]);
    expect(await s.service.directory.displayNameAt(A, 'Alice', A)).toBe(renamed.name);
    // the notice: a 'rename' sanction in SelfView until seen
    const me = value(await s.service.self(ctxOf(s.clock), alice.auth));
    expect(me.name).toBe(renamed.name);
    expect(me.renameAt).toBeNull();
    const notice = me.sanctions.find((x) => x.kind === 'rename')!;
    expect(notice).toMatchObject({ reason: 'name', message: FORCED_RENAME_MESSAGE, until: null });
    // the free rename: at once, then the cooldown again
    s.clock.advance(1);
    expect(value(inRow('rename', await s.service.rename(ctxOf(s.clock), alice.auth, 'Alicia', { password: PW }))).name).toBe('Alicia');
    expect(code(await s.service.rename(ctxOf(s.clock), alice.auth, 'Alyssa', { password: PW }))).toBe('renameCooldown');
    value(await s.service.markSeen(ctxOf(s.clock), alice.auth, notice.id));
    expect(value(await s.service.self(ctxOf(s.clock), alice.auth)).sanctions).toEqual([]);
    // the feed and the log
    expect((await s.service.changes(0, 100)).filter((c) => c.kind === 'renamed').map((c) => c.account)).toEqual([A, A]);
    const ev = (await events(s)).filter((e) => e.kind === 'forcedRename');
    expect(ev.map((e) => [e.account, e.actor, e.actorOs, e.details])).toEqual([[A, 'admin:Mod Alice', 'tester', { sanction: notice.id }]]);
    // the operator frees the banned key: then it can be registered again
    await s.service.admin.releaseName(OP, 'Alice');
    value(await s.service.register(ctxOf(s.clock, { addressKey: addressFor('Alice 2'), guestSession: null }), { name: 'Alice', password: PW, birth: { year: 1990, month: 5 }, claimGuest: false }));
  });

  it('--to: a reserved name is the operator\'s to give; a taken key, an invalid name or the same name is refused', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const A = alice.auth.account;
    // a name of 6.2's static rules
    s.clock.advance(1);
    expect((await s.service.admin.forceRename(OP, A, 'other', 'Moderator')).name).toBe('Moderator');
    // an operator's reservation
    await s.service.admin.reserveName(OP, 'Captain Ann', 'for the owner');
    expect(code(await s.service.rename(ctxOf(s.clock), bob.auth, 'captainann', { password: PW }))).toBe('nameTaken');
    s.clock.advance(1);
    expect((await s.service.admin.forceRename(OP, A, 'other', 'Captain Ann')).name).toBe('Captain Ann');
    // taken by another account, held, banned: conflict; nothing changes
    await expect(s.service.admin.forceRename(OP, A, 'name', 'BOB')).rejects.toMatchObject({ code: 'conflict' });
    await expect(s.service.admin.forceRename(OP, A, 'name', 'Moderator')).rejects.toMatchObject({ code: 'conflict' });
    await expect(s.service.admin.forceRename(OP, A, 'name', 'X')).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.service.admin.forceRename(OP, A, 'name', 'captain ann')).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.service.admin.forceRename(OP, A, 'nonsense' as never)).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.service.admin.forceRename(OP, 'acc_7ZZZZZZZZZZZZZZZZZZZZZZZZZ' as AccountId, 'name')).rejects.toMatchObject({ code: 'notFound' });
    expect((await s.store.account(A))!.name).toBe('Captain Ann');
    expect((await s.store.sanctionsOf(A)).filter((r) => r.kind === 'rename')).toHaveLength(2);
  });

  it('the names it renamed away from: held for nobody until their own end, never taken back with the free rename; reserve blocks one for good', async () => {
    const s = setup();
    const acc = await registerAs(s, 'Slurname');
    const A = acc.auth.account;
    const rename = (name: string) => s.service.rename(ctxOf(s.clock), acc.auth, name, { password: PW });
    let n = 0;
    const register = (name: string) =>
      s.service.register(ctxOf(s.clock, { addressKey: addressFor(`register ${name} ${++n}`), guestSession: null }), { name, password: PW, birth: BIRTH, claimGuest: false });
    const entry = (name: string) => s.store.nameEntry(s.names.key(name), 1);
    // it renames away from two names before a report lands; going back answers the cooldown
    s.clock.advance(HOUR);
    value(await rename('Rudeword'));
    // past the cooldown (the session used in between, so it stays live)
    s.clock.advance(16 * DAY);
    value(await s.service.self(ctxOf(s.clock), acc.auth));
    s.clock.advance(15 * DAY);
    value(await rename('Innocent'));
    s.clock.advance(DAY);
    expect(code(inRow('rename', await rename('Rudeword')))).toBe('renameCooldown');
    expect(await entry('Rudeword')).toMatchObject({ kind: 'held', account: A });
    const slurUntil = (await entry('Slurname'))!.until!;
    const rudeUntil = (await entry('Rudeword'))!.until!;
    // the operator acts on the name it sees: banned and redacted; the others held for nobody until their own end, not redacted
    const renamed = await s.service.admin.forceRename(OP, A, 'name');
    expect(await entry('Innocent')).toMatchObject({ kind: 'banned', account: A, until: null });
    expect(await entry('Slurname')).toMatchObject({ kind: 'held', account: null, until: slurUntil });
    expect(await entry('Rudeword')).toMatchObject({ kind: 'held', account: null, until: rudeUntil });
    expect((await s.store.nameHistory(A)).map((h) => [h.name, h.redacted])).toEqual([
      ['Slurname', false], ['Rudeword', false], ['Innocent', true], [renamed.name, false],
    ]);
    // the free rename takes none of them back, and nobody else takes one
    s.clock.advance(1);
    for (const name of ['Rudeword', 'Slurname', 'Innocent']) {
      expect(code(inRow('rename', await rename(name))), name).toBe('nameTaken');
      expect(code(inRow('register', await register(name))), name).toBe('nameTaken');
    }
    // the operator blocks one for good: reserved over its hold
    await s.service.admin.reserveName(OP, 'Rudeword', 'offensive');
    expect(await entry('Rudeword')).toMatchObject({ kind: 'reserved', account: null, until: null, note: 'offensive' });
    // the free rename is still there, for a fine name
    expect(value(await rename('Fine Name')).name).toBe('Fine Name');
    // a hold ends at its own end; the reservation does not
    s.clock.t = Date.parse(rudeUntil);
    expect(code(await register('Rudeword'))).toBe('nameTaken');
    value(await register('Slurname'));
  });

  it('renamed between the operator\'s read and the forced rename: conflict, the newer name not banned; run again, it bans that one and holds the old', async () => {
    const store = wrappedStore();
    const s = setup({ store });
    const acc = await registerAs(s, 'Badname');
    const A = acc.auth.account;
    const entry = (name: string) => s.store.nameEntry(s.names.key(name), 1);
    s.clock.advance(HOUR);
    // the account renames itself just before the operator's rename reaches the store
    beforeNext(store, 'rename', async () => {
      value(await s.service.rename(ctxOf(s.clock), acc.auth, 'Innocent', { password: PW }));
    });
    const refused = await s.service.admin.forceRename(OP, A, 'name').then(() => null, (e: unknown) => e as AccountsAdminError);
    expect(refused).toMatchObject({ code: 'conflict', message: expect.stringMatching(/renamed meanwhile \(now "Innocent"\)/) });
    expect(await entry('Innocent')).toMatchObject({ kind: 'current', account: A });
    expect(await entry('Badname')).toMatchObject({ kind: 'held', account: A });
    expect(await s.store.sanctionsOf(A)).toEqual([]);
    expect((await events(s)).filter((e) => e.kind === 'forcedRename')).toEqual([]);
    // the operator looks again and acts on the name it sees now
    s.clock.advance(1);
    await s.service.admin.forceRename(OP, A, 'name');
    expect(await entry('Innocent')).toMatchObject({ kind: 'banned', account: A });
    expect(await entry('Badname')).toMatchObject({ kind: 'held', account: null });
    s.clock.advance(1);
    expect(code(inRow('rename', await s.service.rename(ctxOf(s.clock), acc.auth, 'Badname', { password: PW })))).toBe('nameTaken');
    expect(code(await s.service.rename(ctxOf(s.clock), acc.auth, 'Innocent', { password: PW }))).toBe('nameTaken');
  });
});

describe('M14-6: appeals (9.5)', () => {
  it('one appeal per sanction; an appeal of another account\'s sanction answers notFound and leaves that sanction\'s one appeal unused', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const w = await s.service.admin.sanction(OP, alice.auth.account, { kind: 'warn', reason: 'chat', until: null, message: 'Careful.' });
    // Bob names Alice's sanction: notFound, as for an id that never existed
    expect(code(inRow('appeal', await s.service.appeal(ctxOf(s.clock), bob.auth, w.id, 'Not mine, but still.', { password: PW })))).toBe('notFound');
    expect(code(inRow('appeal', await s.service.appeal(ctxOf(s.clock), bob.auth, 'san_01J0000000000000000000ZZZZ', 'Nothing here.', { password: PW })))).toBe('notFound');
    expect(await s.store.appeals({ limit: 10 })).toEqual([]);
    // Alice's one appeal is still there to use
    value(inRow('appeal', await s.service.appeal(ctxOf(s.clock), alice.auth, w.id, '  I was quoting someone.  ', { password: PW })));
    expect(code(inRow('appeal', await s.service.appeal(ctxOf(s.clock), alice.auth, w.id, 'Again.', { password: PW })))).toBe('conflict');
    expect(await s.store.appeals({ limit: 10 })).toMatchObject([{ sanction: w.id, account: alice.auth.account, text: 'I was quoting someone.', answer: null }]);
    expect((await events(s)).filter((e) => e.kind === 'appealed').map((e) => [e.account, e.actor, e.details])).toEqual([[alice.auth.account, 'self', { sanction: w.id }]]);
    // malformed
    for (const [id, text] of [['nope', 'x'], [w.id, ''], [w.id, '   '], [w.id, 'z'.repeat(2_001)], [w.id, 42]] as const) {
      expect(code(inRow('appeal', await s.service.appeal(ctxOf(s.clock), bob.auth, id, text as string, { password: PW })))).toBe('badMessage');
    }
  });

  it('the operator answers once: upheld keeps the sanction, lifted ends it (endReason appeal); the account sees the answer', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    const w = await s.service.admin.sanction(OP, A, { kind: 'warn', reason: 'chat', until: null, message: 'Careful.' });
    const sus = await s.service.admin.sanction(OP, A, suspend(at(7 * DAY)));
    // a suspended account may appeal (RESTRICTED_CALLS)
    value(await s.service.appeal(ctxOf(s.clock), alice.auth, w.id, 'Please reconsider the warning.', { password: PW }));
    value(await s.service.appeal(ctxOf(s.clock), alice.auth, sus.id, 'Please reconsider the suspension.', { password: PW }));
    expect((await s.service.admin.appeals(OP, { open: true, limit: 10 })).map((a) => a.sanction)).toEqual([w.id, sus.id]);
    s.clock.advance(HOUR);
    await s.service.admin.answerAppeal(OP, w.id, 'upheld', 'The warning stands.');
    await expect(s.service.admin.answerAppeal(OP, w.id, 'lifted', 'Changed my mind.')).rejects.toMatchObject({ code: 'conflict' });
    await s.service.admin.answerAppeal(OP, sus.id, 'lifted', 'You are right, sorry.');
    expect((await s.service.directory.standing(A))!.status).toBe('active');
    const rows = await s.store.sanctionsOf(A);
    expect(rows.find((r) => r.id === sus.id)).toMatchObject({ endReason: 'appeal', endedAt: s.clock.now().toISOString(), endedBy: 'admin:Mod Alice' });
    expect(rows.find((r) => r.id === w.id)).toMatchObject({ endedAt: null });
    const me = value(await s.service.self(ctxOf(s.clock), alice.auth));
    expect(me.sanctions.find((x) => x.id === w.id)!.appeal).toEqual({ at: at(0), answer: 'upheld', message: 'The warning stands.' });
    expect(await s.service.admin.appeals(OP, { open: true, limit: 10 })).toEqual([]);
    const ev = (await events(s)).filter((e) => e.kind === 'appealAnswered' || e.kind === 'sanctionLifted');
    expect(ev.map((e) => JSON.stringify([e.kind, e.details])).sort()).toEqual([
      ['appealAnswered', { sanction: w.id, answer: 'upheld' }], ['appealAnswered', { sanction: sus.id, answer: 'lifted' }], ['sanctionLifted', { sanction: sus.id }],
    ].map((x) => JSON.stringify(x)).sort());
    await expect(s.service.admin.answerAppeal(OP, 'san_01J0000000000000000000ZZZZ', 'upheld', 'x')).rejects.toMatchObject({ code: 'notFound' });
    await expect(s.service.admin.answerAppeal(OP, w.id, 'maybe' as never, 'x')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('a deleting account cannot appeal (deletionPending); a banned one can, from a restricted session', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const b = await s.service.admin.sanction(OP, bob.auth.account, ban(null));
    const back = await signInAgain(s, 'Bob');
    value(inRow('appeal', await s.service.appeal(ctxOf(s.clock), back.auth, b.id, 'I did not cheat.', { password: PW })));
    const w = await s.service.admin.sanction(OP, alice.auth.account, { kind: 'warn', reason: 'chat', until: null, message: 'Careful.' });
    await markDeleting(s, alice.auth.account);
    expect(code(inRow('appeal', await s.service.appeal(ctxOf(s.clock), alice.auth, w.id, 'x', { password: PW })))).toBe('deletionPending');
  });
});

describe('M14-6: the operator\'s sanction refusals (9.3, 9.6)', () => {
  it('ends by kind, the account, the reports, the message, the operator: refused before anything is stored', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    const refused: [NewSanction, string][] = [
      [{ kind: 'mute', reason: 'chat', until: null, message: 'm' }, 'invalid'],
      [{ kind: 'mute', reason: 'chat', until: at(91 * DAY), message: 'm' }, 'invalid'],
      [{ kind: 'suspend', reason: 'chat', until: null, message: 'm' }, 'invalid'],
      [{ kind: 'suspend', reason: 'chat', until: at(366 * DAY), message: 'm' }, 'invalid'],
      [{ kind: 'ban', reason: 'chat', until: at(-1), message: 'm' }, 'invalid'],
      [{ kind: 'ban', reason: 'chat', until: 'tomorrow', message: 'm' }, 'invalid'],
      [{ kind: 'rename' as never, reason: 'chat', until: null, message: 'm' }, 'invalid'],
      [{ kind: 'warn', reason: 'rude' as never, until: null, message: 'm' }, 'invalid'],
      [{ kind: 'warn', reason: 'chat', until: null, message: '  ' }, 'invalid'],
      [{ kind: 'warn', reason: 'chat', until: null, message: 'm'.repeat(2_001) }, 'invalid'],
      [{ kind: 'warn', reason: 'chat', until: null, message: 'm', note: 'nul \u0000' }, 'invalid'],
      [{ kind: 'warn', reason: 'chat', until: null, message: 'm', reports: ['rep_01J0000000000000000000ZZZZ'] }, 'notFound'],
      [{ kind: 'warn', reason: 'chat', until: null, message: 'm', reports: ['bad'] }, 'invalid'],
    ];
    for (const [sn, expected] of refused) {
      const e = await s.service.admin.sanction(OP, A, sn).then(() => null, (x: unknown) => x);
      expect(e, JSON.stringify(sn).slice(0, 80)).toBeInstanceOf(AccountsAdminError);
      expect((e as AccountsAdminError).code, JSON.stringify(sn).slice(0, 80)).toBe(expected);
    }
    await expect(s.service.admin.sanction(OP, 'acc_7ZZZZZZZZZZZZZZZZZZZZZZZZZ' as AccountId, ban(null))).rejects.toMatchObject({ code: 'notFound' });
    await expect(s.service.admin.sanction({ name: '', osUser: 'tester' }, A, ban(null))).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.service.admin.sanction({ name: 'x'.repeat(65), osUser: 'tester' }, A, ban(null))).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.service.admin.sanction({ name: 'op', osUser: 'bad‮user' }, A, ban(null))).rejects.toMatchObject({ code: 'invalid' });
    expect(await s.store.sanctionsOf(A)).toEqual([]);
    expect((await s.service.changes(0, 100)).filter((c) => c.kind === 'standing')).toEqual([]);
    // the longest allowed ends pass
    await s.service.admin.sanction(OP, A, { kind: 'mute', reason: 'chat', until: at(90 * DAY), message: 'm' });
    await s.service.admin.sanction(OP, A, { kind: 'suspend', reason: 'chat', until: at(365 * DAY), message: 'm' });
  });

  it('the reports a sanction settles are closed as actioned (those still open), each audited', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const r1 = value(await s.service.report(ctxOf(s.clock), { kind: 'account', auth: alice.auth }, { target: { account: bob.auth.account }, reason: 'cheating' }));
    const r2 = value(await s.service.report(ctxOf(s.clock, { guestSession: 'gs_x' }), { kind: 'guest', session: 'gs_x' }, { target: { account: bob.auth.account }, reason: 'cheating' }));
    await s.service.admin.closeReport(OP, r2.report, 'dismissed');
    s.clock.advance(1);
    await s.service.admin.sanction(OP, bob.auth.account, { ...ban(null), reports: [r1.report, r2.report] });
    expect((await s.store.sanctionsOf(bob.auth.account))[0]!.reports).toEqual([r1.report, r2.report]);
    expect((await s.store.report(r1.report))).toMatchObject({ status: 'actioned', closedBy: 'admin:Mod Alice', closedAt: s.clock.now().toISOString() });
    expect((await s.store.report(r2.report))!.status).toBe('dismissed');
    const closed = (await events(s)).filter((e) => e.kind === 'reportClosed');
    expect(closed.map((e) => [e.account, e.details])).toEqual([
      [bob.auth.account, { report: r2.report, outcome: 'dismissed' }], [bob.auth.account, { report: r1.report, outcome: 'actioned' }],
    ]);
  });
});
