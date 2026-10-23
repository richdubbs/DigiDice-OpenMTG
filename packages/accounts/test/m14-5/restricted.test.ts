/**
 * M14-5: account statuses and restricted sessions (design 3.8, D23, D24; 13.2), and the parts' seams (11.3): suspended, banned and deleting accounts
 * sign in with the right password to a restricted session; RESTRICTED_CALLS work and every other call answers the status's code; the wrong password
 * answers badCredentials whatever the status; a deletion is cancelled from another device after a sign-in (through a fake rights part on the core's
 * ServiceGuard); a missing part's methods answer notYet after the session check; the guard's proofs for every sensitive action, its reauth tickets,
 * patch retries and resetAccess (an email reset's revocations).
 */
import { describe, expect, it } from 'vitest';
import {
  AccountsAdminError, RESTRICTED_CALLS, type Account, type AccountId, type AccountResult, type AccountStatus, type Auth, type CreateRightsPart,
  type PartDeps, type SanctionKind, type SelfView, type SensitiveAction, type ServiceMethod,
} from '@openmtg/accounts';
import type { CoreGuard } from '../../src/service/guard';
import { tokenHash } from '../../src/ids';
import { addressFor, code, ctxOf, DAY, inRow, MIN, PW, PW2, registerAs, setup, value, type Setup } from './support';

let sanctionSeq = 0;
async function sanction(s: Setup, account: AccountId, kind: SanctionKind, untilMs: number | null): Promise<string> {
  const id = `san_01J0000000000000000000${String(++sanctionSeq).padStart(4, '0')}`;
  const now = s.clock.now().toISOString();
  await s.store.putSanction({
    id, account, kind, reason: 'other', message: 'Please read the rules.', note: 'internal note', since: now,
    until: untilMs === null ? null : new Date(s.clock.t + untilMs).toISOString(), endedAt: null, endReason: null, endedBy: null, createdAt: now,
    createdBy: 'admin:op', reports: [], seenAt: null,
  });
  return id;
}

async function markDeleting(s: Setup, id: AccountId): Promise<void> {
  const a = (await s.store.account(id))!;
  await s.store.updateAccount(id, a.version, {
    deletion: { requestedAt: s.clock.now().toISOString(), purgeAt: new Date(s.clock.t + 7 * DAY).toISOString(), erasingAt: null, done: [] },
  });
}

const STATUS_CODE: Record<Exclude<AccountStatus, 'active'>, string> = { suspended: 'suspended', banned: 'banned', deleting: 'deletionPending' };
/** M14-13's methods (providers.ts) are left out: its stub answers notYet for everything until then. */
const PROVIDER_METHODS: readonly ServiceMethod[] = ['beginProvider', 'confirmProvider', 'unlinkProvider', 'registerWithProvider', 'providerCallback'];

describe('M14-5: the status answer\'s sanction (3.8)', () => {
  it('a banned answer carries the sanction with its appeal, exactly as SelfView shows it', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const ban = await sanction(s, reg.auth.account, 'ban', null);
    await s.store.putAppeal({
      sanction: ban, account: reg.auth.account, text: 'I disagree.', createdAt: s.clock.now().toISOString(), answer: null, answerMessage: null,
      answeredAt: null, answeredBy: null,
    });
    const own = value(await s.service.self(ctxOf(s.clock), reg.auth)).sanctions.find((x) => x.id === ban)!;
    expect(own.appeal).toEqual({ at: s.clock.now().toISOString(), answer: null, message: null });
    const r = inRow('rename', await s.service.rename(ctxOf(s.clock), reg.auth, 'Alicia', { password: PW }));
    expect(code(r)).toBe('banned');
    if (!r.ok) expect(r.error.sanction).toEqual(own);
  });
});

describe('M14-5: restricted sessions (3.8)', () => {
  for (const status of ['suspended', 'banned', 'deleting'] as const) {
    it(`${status}: the right password signs in to a restricted session; RESTRICTED_CALLS work, every other call answers ${STATUS_CODE[status]}`, async () => {
      const s = setup();
      const reg = await registerAs(s, 'Alice');
      const other = await registerAs(s, 'Bobby');
      const sid = await sanction(s, reg.auth.account, 'warn', null);
      if (status === 'suspended') await sanction(s, reg.auth.account, 'suspend', 30 * DAY);
      if (status === 'banned') await sanction(s, reg.auth.account, 'ban', null);
      if (status === 'deleting') await markDeleting(s, reg.auth.account);
      s.guests.add('b'.repeat(64), 'gs_claim1');
      const ctx = () => ctxOf(s.clock, { addressKey: '192.0.2.31' });
      const signedIn = value(inRow('signIn', await s.service.signIn(ctx(), { name: 'Alice', password: PW })));
      expect(signedIn.account.status).toBe(status);
      expect(signedIn.account.restricted).toBe(true);
      if (status !== 'deleting') expect(signedIn.account.sanctions.map((x) => x.kind)).toContain(status === 'banned' ? 'ban' : 'suspend');
      const auth = signedIn.auth;
      const otherSession = (await s.store.sessionsOf(reg.auth.account)).find((r) => r.id !== auth.session)!.id;
      const calls: [ServiceMethod, () => Promise<AccountResult<unknown>>][] = [
        ['self', () => s.service.self(ctx(), auth)],
        ['sessions', () => s.service.sessions(ctx(), auth)],
        ['revokeSession', () => s.service.revokeSession(ctx(), auth, otherSession)],
        ['markSeen', () => s.service.markSeen(ctx(), auth, sid)],
        ['newRecoveryCodes', () => s.service.newRecoveryCodes(ctx(), auth, { password: PW })],
        ['rename', () => s.service.rename(ctx(), auth, 'Alicia', { password: PW })],
        ['setAvatar', () => s.service.setAvatar(ctx(), auth, 'd6-blue')],
        ['setPrivacy', () => s.service.setPrivacy(ctx(), auth, { history: 'public' })],
        ['claimGuest', () => s.service.claimGuest(ctx(), auth, 'b'.repeat(64), { password: PW })],
        ['block', () => s.service.block(ctx(), auth, other.auth.account, true)],
        ['mute', () => s.service.mute(ctx(), auth, other.auth.account, true)],
        ['relations', () => s.service.relations(ctx(), auth)],
        ['report', () => s.service.report(ctx(), { kind: 'account', auth }, { target: { account: other.auth.account }, reason: 'spam' })],
        ['appeal', () => s.service.appeal(ctx(), auth, sid, 'I disagree.', { password: PW })],
        ['setEmail', () => s.service.setEmail(ctx(), auth, null, { password: PW })],
        ['verifyEmail', () => s.service.verifyEmail(ctx(), auth, 'ABCDEFGHJK')],
        ['exportData', () => s.service.exportData(ctx(), auth, { password: PW })],
        ['deleteAccount', () => s.service.deleteAccount(ctx(), auth, { password: PW })],
        ['cancelDeletion', () => s.service.cancelDeletion(ctx(), auth)],
        ['changePassword', () => s.service.changePassword(ctx(), auth, PW, PW2)],
        ['signOut', () => s.service.signOut(ctx(), auth, false)],
      ];
      const allowed = RESTRICTED_CALLS[status];
      for (const [method, call] of calls) {
        const r = inRow(method, await call());
        if (allowed.includes(method)) expect(r.ok ? 'ok' : r.error.code, method).not.toBe(STATUS_CODE[status]);
        else {
          expect(code(r), method).toBe(STATUS_CODE[status]);
          if (status !== 'deleting' && !r.ok) expect(r.error.sanction?.kind, method).toBe(status === 'banned' ? 'ban' : 'suspend');
        }
      }
      // every method with an Auth but the provider ones is covered
      const covered = new Set(calls.map(([m]) => m));
      for (const m of [...RESTRICTED_CALLS.suspended, ...RESTRICTED_CALLS.deleting]) if (!PROVIDER_METHODS.includes(m)) expect(covered.has(m), m).toBe(true);
    });
  }

  it('the wrong password answers badCredentials for every status, exactly as for an active account', async () => {
    const s = setup();
    const answers: unknown[] = [];
    for (const [name, status] of [['Active', 'active'], ['Suspend', 'suspended'], ['Banned', 'banned'], ['Deleting', 'deleting']] as const) {
      const reg = await registerAs(s, name);
      if (status === 'suspended') await sanction(s, reg.auth.account, 'suspend', 30 * DAY);
      if (status === 'banned') await sanction(s, reg.auth.account, 'ban', null);
      if (status === 'deleting') await markDeleting(s, reg.auth.account);
      answers.push(inRow('signIn', await s.service.signIn(ctxOf(s.clock, { addressKey: addressFor(name) }), { name, password: PW2 })));
    }
    expect(answers.every((a) => JSON.stringify(a) === JSON.stringify(answers[0]))).toBe(true);
    expect(code(answers[0] as AccountResult<unknown>)).toBe('badCredentials');
  });

  it('a sanction ends at its until without tick: the next call is unrestricted', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    await sanction(s, reg.auth.account, 'suspend', DAY);
    expect(code(await s.service.setAvatar(ctxOf(s.clock), reg.auth, 'd4-cyan'))).toBe('suspended');
    s.clock.advance(DAY);
    expect(value(await s.service.setAvatar(ctxOf(s.clock), reg.auth, 'd4-cyan')).avatar).toBe('d4-cyan');
  });
});

/** A fake rights part on the core's seams: deletion with its proof, cancel from a restricted session. */
const fakeRights: CreateRightsPart = (deps: PartDeps) => ({
  async exportData() {
    return { ok: false, error: { code: 'notYet', message: 'fake' } };
  },
  async deleteAccount(ctx, auth, proof) {
    const s = await deps.guard.session(ctx, auth, 'deleteAccount');
    if (!s.ok) return s;
    const p = await deps.guard.proof(ctx, auth, proof, 'delete');
    if (!p.ok) return p;
    const purgeAt = new Date(ctx.now.getTime() + deps.config.timing.deleteGraceMs).toISOString();
    const r = await deps.guard.patch(auth.account, () => ({ deletion: { requestedAt: ctx.now.toISOString(), purgeAt, erasingAt: null, done: [] } }));
    if (!r.ok) return r;
    await deps.guard.resetAccess(auth.account, 'deletion', auth.session, s.value.row.device, ctx.now);
    return { ok: true, value: { purgeAt } };
  },
  async cancelDeletion(ctx, auth) {
    const s = await deps.guard.session(ctx, auth, 'cancelDeletion');
    if (!s.ok) return s;
    const r = await deps.guard.patch(auth.account, (a: Account) => (a.deletion !== null && a.deletion.erasingAt === null ? { deletion: null } : null));
    if (!r.ok) return r;
    return { ok: true, value: {} as SelfView };
  },
  addHolder() {},
  admin: {
    exportAccount: async () => {
      throw new AccountsAdminError('incomplete', 'fake');
    },
    deleteAccount: async () => ({ purgeAt: '' }),
    purge: async () => ({ sessions: 0, devices: 0, emailCodes: 0, names: 0, reports: 0, audit: 0, changes: 0, tombstones: 0 }),
  },
  async tick() {
    return { erased: 0, erasureRetries: 0, erasureBlocked: 0, inactiveNotified: 0, purged: null };
  },
});

describe('M14-5: the parts\' seams (11.3)', () => {
  it('a deletion is cancelled from another device after a sign-in; a running suspension is still running afterwards', async () => {
    const s = setup({ parts: { rights: fakeRights } });
    const reg = await registerAs(s, 'Alice');
    await sanction(s, reg.auth.account, 'suspend', 30 * DAY);
    expect(code(inRow('deleteAccount', await s.service.deleteAccount(ctxOf(s.clock), reg.auth, undefined as never)))).toBe('reauthRequired');
    const del = value(inRow('deleteAccount', await s.service.deleteAccount(ctxOf(s.clock), reg.auth, { password: PW })));
    expect(del.purgeAt).toBe(new Date(s.clock.t + 7 * DAY).toISOString());
    s.clock.advance(2 * DAY);
    const other = value(await s.service.signIn(ctxOf(s.clock, { connection: 'device-b', addressKey: '192.0.2.70' }), { name: 'Alice', password: PW }));
    expect(other.account).toMatchObject({ status: 'deleting', restricted: true });
    expect(other.account.deletion).toEqual({ purgeAt: del.purgeAt, cancellable: true });
    value(inRow('cancelDeletion', await s.service.cancelDeletion(ctxOf(s.clock), other.auth)));
    const after = value(await s.service.self(ctxOf(s.clock), other.auth));
    expect([after.status, after.deletion]).toEqual(['suspended', null]);
  });

  it('a missing part\'s methods answer notYet after the session check; its admin commands throw incomplete', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    const ctx = ctxOf(s.clock);
    expect(code(inRow('exportData', await s.service.exportData(ctx, reg.auth, { password: PW })))).toBe('notYet');
    expect(code(inRow('block', await s.service.block(ctx, reg.auth, reg.auth.account, true)))).toBe('notYet');
    expect(code(inRow('requestEmailReset', await s.service.requestEmailReset(ctx, 'Alice')))).toBe('notYet');
    expect(code(inRow('report', await s.service.report(ctx, { kind: 'guest', session: 'gs_1' }, { target: { account: reg.auth.account }, reason: 'spam' })))).toBe('notYet');
    const stale: Auth = { account: reg.auth.account, session: 'as_01J00000000000000000000000' };
    expect(code(inRow('exportData', await s.service.exportData(ctx, stale, { password: PW })))).toBe('sessionExpired');
    expect(code(inRow('beginProvider', await s.service.beginProvider(ctx, 'shopify', 'signIn', null)))).toBe('notYet');
    const op = { name: 'op', osUser: 'root' };
    await expect(s.service.admin.find(op, 'alice')).rejects.toMatchObject({ code: 'incomplete' });
    await expect(s.service.admin.exportAccount(op, reg.auth.account, false)).rejects.toBeInstanceOf(AccountsAdminError);
    expect(() => s.service.addHolder({ name: 'hosted', exportFor: async () => null, erase: async () => ({ removed: 0, anonymised: 0 }) })).not.toThrow();
    // with every part missing, tick reports zeros
    expect(await s.service.tick(s.clock.now())).toEqual({ erased: 0, erasureRetries: 0, erasureBlocked: 0, sanctionsEnded: 0, inactiveNotified: 0, mailFilesRemoved: 0, purged: null });
  });

  it('the guard\'s proof for every sensitive action: none answers reauthRequired, the password passes, a one-use ticket of this session passes', async () => {
    const s = setup({ parts: { rights: fakeRights } });
    const reg = await registerAs(s, 'Alice');
    const guard = s.partDeps.current!.guard as CoreGuard;
    const ctx = ctxOf(s.clock);
    const actions: SensitiveAction[] = ['password', 'recoveryCodes', 'email', 'link', 'unlink', 'rename', 'export', 'delete'];
    for (const action of actions) {
      expect(code(await guard.proof(ctx, reg.auth, undefined, action)), action).toBe('reauthRequired');
      expect((await guard.proof(ctx, reg.auth, { password: PW }, action)).ok, action).toBe(true);
    }
    const ticket = guard.issueTicket(reg.auth, ctx.now);
    expect((await guard.proof(ctx, reg.auth, { ticket }, 'export')).ok).toBe(true);
    expect(code(await guard.proof(ctx, reg.auth, { ticket }, 'export'))).toBe('badCredentials');
    // another session's ticket, an expired ticket
    const other = value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.71' }), { name: 'Alice', password: PW }));
    const t2 = guard.issueTicket(other.auth, ctx.now);
    expect(code(await guard.proof(ctx, reg.auth, { ticket: t2 }, 'export'))).toBe('badCredentials');
    const t3 = guard.issueTicket(reg.auth, ctx.now);
    s.clock.advance(2 * MIN);
    expect(code(await guard.proof(ctxOf(s.clock), reg.auth, { ticket: t3 }, 'export'))).toBe('badCredentials');
    // the events: reauthed and reauthFailed with the action and how, never the password
    await s.service.tick(s.clock.now());
    const events = await s.store.audit({ account: reg.auth.account, kinds: ['reauthed', 'reauthFailed'], limit: 100 });
    expect(events.filter((e) => e.kind === 'reauthed').map((e) => e.details)).toContainEqual({ action: 'export', via: 'ticket' });
    expect(JSON.stringify(events)).not.toContain(PW);
  });

  it('guard.text: m13\'s text rules, trimmed, bounded in code points; guard.patch retries a version conflict 3 times, then conflict', async () => {
    const s = setup({ parts: { rights: fakeRights } });
    const reg = await registerAs(s, 'Alice');
    const guard = s.partDeps.current!.guard;
    expect(guard.text('  hello  ', 10)).toBe('hello');
    expect(guard.text('a\u0000b', 10)).toBeNull();
    expect(guard.text('a‮b', 10)).toBeNull();
    expect(guard.text('😀😀😀', 3)).toBe('😀😀😀');
    expect(guard.text('😀😀😀😀', 3)).toBeNull();
    expect(guard.text(42, 10)).toBeNull();
    // another writer changes the account between each read and write of the patch: 4 times (the first try and 3 retries), then once
    const inner = s.store;
    let races = 4;
    const updateAccount = inner.updateAccount.bind(inner);
    inner.updateAccount = async (id, version, p) => {
      if (races > 0) {
        races--;
        const a = (await inner.account(id))!;
        await updateAccount(id, a.version, { avatar: 'd4-blue' });
      }
      return updateAccount(id, version, p);
    };
    const r = await guard.patch(reg.auth.account, () => ({ avatar: 'd8-amber' }));
    expect(r.ok ? 'ok' : r.error.code).toBe('conflict');
    races = 1;
    expect(value(await guard.patch(reg.auth.account, () => ({ avatar: 'd8-amber' }))).avatar).toBe('d8-amber');
    // a patch of nothing writes nothing
    races = 0;
    expect(value(await guard.patch(reg.auth.account, () => null)).avatar).toBe('d8-amber');
  });

  it('guard.resetAccess (an email reset, 3.4): every other session revoked, every device proof but the one kept deleted, sessionsRevoked with except', async () => {
    const s = setup({ parts: { rights: fakeRights } });
    const reg = await registerAs(s, 'Alice');
    const a = value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.81', connection: 'a' }), { name: 'Alice', password: PW }));
    const b = value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.82', connection: 'b' }), { name: 'Alice', password: PW }));
    await s.partDeps.current!.guard.resetAccess(reg.auth.account, 'emailReset', b.auth.session, tokenHash(b.device), s.clock.now());
    expect(code(await s.service.self(ctxOf(s.clock), reg.auth))).toBe('sessionRevoked');
    expect(code(await s.service.self(ctxOf(s.clock), a.auth))).toBe('sessionRevoked');
    expect(value(await s.service.self(ctxOf(s.clock), b.auth)).name).toBe('Alice');
    expect(await s.store.device(tokenHash(a.device))).toBeNull();
    expect(await s.store.device(tokenHash(b.device))).not.toBeNull();
    const changes = await s.service.changes(0, 100);
    expect(changes.at(-1)).toMatchObject({ kind: 'sessionsRevoked', account: reg.auth.account, detail: { except: b.auth.session } });
  });
});
