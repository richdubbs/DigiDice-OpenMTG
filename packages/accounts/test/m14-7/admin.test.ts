/**
 * M14-7: the operator's rights commands (design 9.6, 10.1, 10.2; 11.3 AccountAdmin's exportAccount, deleteAccount, purge), through the service's
 * admin as the command line calls it: the export refused ('incomplete') without every required holder and marked with `--partial`; the file and its
 * audit event (`adminExported` with the operator and the OS user); `delete` with the grace, and `--now`, which only sets purgeAt (the server's tick
 * then erases with every holder); a command that cannot be audited is refused before anything runs; bad arguments answer 'invalid'; an account
 * erased while its export is made leaves no file and no event.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AccountsAdminError, adminExportPath, ADMIN_EXPORTS_DIR, type AccountId } from '@openmtg/accounts';
import { code, ctxOf, DAY, FakeHolder, PW, registerAs, rightsSetup, T0, until, value } from './support';

const root = mkdtempSync(join(tmpdir(), 'openmtg-m14-7-admin-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;
const freshDir = (): string => join(root, `data-${++dirs}`);
const OP = { name: 'Operator Olga', osUser: 'olga' };
const UNKNOWN = 'acc_00000000000000000000000000' as AccountId;

describe('M14-7: the operator\'s export (9.6)', () => {
  it('is refused without every required holder, written marked with --partial, complete once the holder is there; each audited with the operator', async () => {
    const dir = freshDir();
    const s = rightsSetup({ env: { ACCOUNTS_DATA_DIR: dir, ACCOUNTS_REQUIRED_HOLDERS: 'hosted' } });
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    await expect(s.service.admin.exportAccount(OP, A, false)).rejects.toMatchObject({ code: 'incomplete' });
    expect(existsSync(join(dir, ADMIN_EXPORTS_DIR))).toBe(false);

    const partial = await s.service.admin.exportAccount(OP, A, true);
    expect(partial.missing).toEqual(['hosted']);
    expect(partial.holders).toEqual({});
    expect(partial.account.sessions.every((x) => !x.current)).toBe(true);
    expect(existsSync(adminExportPath(dir, A, partial.exportedAt))).toBe(true);

    s.service.addHolder(new FakeHolder('hosted', [], { games: [] }));
    s.clock.advance(60_000);
    const full = await s.service.admin.exportAccount(OP, A, false);
    expect([full.missing, full.holders]).toEqual([[], { hosted: { games: [] } }]);
    expect(readdirSync(join(dir, ADMIN_EXPORTS_DIR))).toHaveLength(2);

    const events = await s.store.audit({ account: A, kinds: ['adminExported'], limit: 10 });
    expect(events.map((e) => [e.actor, e.actorOs, e.details])).toEqual([
      ['admin:Operator Olga', 'olga', { partial: true }],
      ['admin:Operator Olga', 'olga', { partial: false }],
    ]);
    // the operator's events are never in the account's own export
    const own = value(await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW }));
    expect(JSON.stringify(own)).not.toContain('Operator Olga');
  });

  it('answers notFound for an unknown or erased account, invalid for a bad id or operator, and writes nothing then', async () => {
    const dir = freshDir();
    const s = rightsSetup({ env: { ACCOUNTS_DATA_DIR: dir } });
    const alice = await registerAs(s, 'Alice');
    await expect(s.service.admin.exportAccount(OP, UNKNOWN, false)).rejects.toMatchObject({ code: 'notFound' });
    await expect(s.service.admin.exportAccount(OP, 'alice' as AccountId, false)).rejects.toMatchObject({ code: 'invalid' });
    for (const op of [{ name: '', osUser: 'olga' }, { name: 'x'.repeat(65), osUser: 'olga' }, { name: 'Olga\u0007', osUser: 'olga' }, { name: 'Olga', osUser: 'o\u0000' }]) {
      await expect(s.service.admin.exportAccount(op, alice.auth.account, false)).rejects.toBeInstanceOf(AccountsAdminError);
    }
    expect(existsSync(join(dir, ADMIN_EXPORTS_DIR))).toBe(false);
    expect(await s.store.audit({ kinds: ['adminExported'], limit: 10 })).toEqual([]);
  });

  for (const files of [true, false]) {
    it(`an account erased while its export is built: notFound, no file, no event (security 1; ${files ? 'with' : 'without'} ACCOUNTS_DATA_DIR)`, async () => {
      const dir = freshDir();
      const s = rightsSetup({ env: files ? { ACCOUNTS_DATA_DIR: dir } : {} });
      let entered = false;
      let open!: () => void;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      s.service.addHolder({
        name: 'hosted', exportFor: async () => {
          entered = true;
          await gate;
          return { games: [] };
        },
        erase: async () => ({ removed: 0, anonymised: 0 }),
      });
      const alice = await registerAs(s, 'Alice');
      const A = alice.auth.account;
      await s.service.admin.deleteAccount(OP, A, 'asked by letter', true);
      const exporting = s.service.admin.exportAccount(OP, A, false);
      await until(() => entered);
      expect((await s.service.tick(s.clock.now())).erased).toBe(1);
      open();
      await expect(exporting).rejects.toMatchObject({ code: 'notFound' });
      expect(existsSync(join(dir, ADMIN_EXPORTS_DIR))).toBe(false);
      expect(await s.store.audit({ kinds: ['adminExported'], limit: 10 })).toEqual([]);
    });
  }

  it('an account erased after the export\'s check and before its file is written: the file is deleted again, notFound (security 1)', async () => {
    const dir = freshDir();
    const s = rightsSetup({ env: { ACCOUNTS_DATA_DIR: dir } });
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    await s.service.admin.deleteAccount(OP, A, 'asked by letter', true);
    // the export's first look finds the account there; the erasure then runs to its end (its files forgotten) before the file is written
    const tombstone = s.store.tombstone.bind(s.store);
    let looks = 0;
    s.store.tombstone = async (id) => {
      const answer = await tombstone(id);
      if (++looks === 1) expect((await s.service.tick(s.clock.now())).erased).toBe(1);
      return answer;
    };
    await expect(s.service.admin.exportAccount(OP, A, false)).rejects.toMatchObject({ code: 'notFound' });
    expect(looks).toBe(2);
    expect(readdirSync(join(dir, ADMIN_EXPORTS_DIR))).toEqual([]);
    expect(await s.store.audit({ kinds: ['adminExported'], limit: 10 })).toEqual([]);
  });

  it('without ACCOUNTS_DATA_DIR the export is returned and no file is written', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const exp = await s.service.admin.exportAccount(OP, alice.auth.account, false);
    expect(exp.account.self.name).toBe('Alice');
  });
});

describe('M14-7: the operator\'s delete (9.6, 10.2)', () => {
  it('as if the account had asked: the grace, every session revoked, the changes, audited with the operator; again changes nothing', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    const head = await s.service.changesHead();
    const r = await s.service.admin.deleteAccount(OP, A, 'asked by letter', false);
    expect(r.purgeAt).toBe(new Date(T0 + 7 * DAY).toISOString());
    expect(code(await s.service.self(ctxOf(s.clock), alice.auth))).toBe('sessionRevoked');
    expect((await s.service.changes(head, 10)).map((c) => [c.kind, c.detail ?? null])).toEqual([['sessionsRevoked', null], ['deleting', null]]);
    expect(s.notices).toEqual([{ account: A, kind: 'deletionRequested' }]);
    s.clock.advance(60_000);
    expect(await s.service.admin.deleteAccount(OP, A, 'asked twice', false)).toEqual(r);
    await s.service.tick(s.clock.now());
    const events = await s.store.audit({ account: A, kinds: ['deletionRequested', 'sessionsRevoked'], limit: 10 });
    expect(events.map((e) => [e.kind, e.actor, e.actorOs]).sort()).toEqual([
      ['deletionRequested', 'admin:Operator Olga', 'olga'],
      ['sessionsRevoked', 'admin:Operator Olga', 'olga'],
    ]);
    // the reason is checked, never stored: no record has a field for it
    expect(JSON.stringify(events)).not.toContain('asked by letter');
  });

  it('--now only sets purgeAt to now (on a pending deletion too); the server\'s next tick erases it with every holder', async () => {
    const s = rightsSetup({ env: { ACCOUNTS_REQUIRED_HOLDERS: 'hosted' } });
    const hosted = new FakeHolder('hosted');
    s.service.addHolder(hosted);
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    s.clock.advance(DAY);
    const r = await s.service.admin.deleteAccount(OP, A, 'the owner asked by email for it to go at once', true);
    expect(r.purgeAt).toBe(s.clock.now().toISOString());
    // nothing erased by the command itself
    expect(await s.store.account(A)).not.toBeNull();
    expect(hosted.erases).toHaveLength(0);
    expect((await s.store.account(A))!.deletion).toMatchObject({ requestedAt: new Date(T0).toISOString(), purgeAt: r.purgeAt, erasingAt: null });
    expect((await s.service.tick(s.clock.now())).erased).toBe(1);
    expect(hosted.erases).toHaveLength(1);
    await expect(s.service.admin.deleteAccount(OP, A, 'gone already', true)).rejects.toMatchObject({ code: 'notFound' });
  });

  it('--now on an erasure already claimed changes nothing', async () => {
    const s = rightsSetup();
    s.service.addHolder(new FakeHolder('hosted', ['pending']));
    const alice = await registerAs(s, 'Alice');
    const del = value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    await s.service.tick(new Date(del.purgeAt));
    const before = (await s.store.account(alice.auth.account))!.deletion;
    s.clock.t = Date.parse(del.purgeAt) + 60_000;
    expect(await s.service.admin.deleteAccount(OP, alice.auth.account, 'again', true)).toEqual({ purgeAt: del.purgeAt });
    expect((await s.store.account(alice.auth.account))!.deletion).toEqual(before);
  });

  it('refuses a bad reason, a bad flag, an unknown account and an operator it cannot audit, before anything runs', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    for (const reason of ['', '   ', 'a\u0000b', 'x'.repeat(501)]) {
      await expect(s.service.admin.deleteAccount(OP, A, reason, false), JSON.stringify(reason)).rejects.toMatchObject({ code: 'invalid' });
    }
    await expect(s.service.admin.deleteAccount(OP, A, 'why', 'yes' as never)).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.service.admin.deleteAccount(OP, UNKNOWN, 'why', false)).rejects.toMatchObject({ code: 'notFound' });
    await expect(s.service.admin.deleteAccount({ name: 'x'.repeat(65), osUser: 'olga' }, A, 'why', false)).rejects.toMatchObject({ code: 'invalid' });
    expect((await s.store.account(A))!.deletion).toBeNull();
    expect(value(await s.service.self(ctxOf(s.clock), alice.auth)).status).toBe('active');
  });
});
