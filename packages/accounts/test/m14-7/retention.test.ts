/**
 * M14-7: retention (design 10.3; 13.2): inactive accounts (the notice to a verified address sent once, `inactiveNoticeAt`, 30 days before; the
 * deletion 30 days later, as if the account had asked, with its grace; a sign-in clears the notice; a notice that went out late still gets its 30
 * days; a full page of waiting accounts never hides the next one; a sign-in that lands between the listing and the notice or the deletion wins);
 * the operator's export file written 0600 in a 0700 folder and purged after a day by the time in its name; the daily purge from tick.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { adminExportPath, ADMIN_EXPORTS_DIR, type AccountId } from '@openmtg/accounts';
import { INACTIVE_BATCH } from '../../src/rights/retention';
import { addressFor, ctxOf, DAY, playerName, PW, registerAs, rightsSetup, setEmail, T0, value, type RightsSetup } from './support';

const root = mkdtempSync(join(tmpdir(), 'openmtg-m14-7-retention-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;
const freshDir = (): string => join(root, `data-${++dirs}`);
const OP = { name: 'Operator Olga', osUser: 'olga' };
const INACTIVE = 1_095 * DAY;
const LEAD = 30 * DAY;

/** The next inactive listing answers as the store read it, but only after `name` has signed in (a fixed interleaving: the sign-in lands after it). */
function signInWhileListed(s: RightsSetup, name: string): void {
  const inactiveSince = s.store.inactiveSince.bind(s.store);
  let once = true;
  s.store.inactiveSince = async (...args) => {
    const page = await inactiveSince(...args);
    if (once) {
      once = false;
      expect(page.map((a) => a.name)).toEqual([name]);
      value(await s.service.signIn(ctxOf(s.clock, { addressKey: addressFor(`${name} back`) }), { name, password: PW }));
    }
    return page;
  };
}

describe('M14-7: inactive accounts (10.3, adopted default 15)', () => {
  it('the notice to a verified address once, 30 days before; then the deletion, as if the account had asked; then the erasure after the grace', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bobby');
    const carol = await registerAs(s, 'Carol');
    await setEmail(s, alice.auth.account, 'alice@example.com');
    await setEmail(s, bob.auth.account, 'bob@example.com', false);
    // Carol signs in two years later, so she is not inactive
    s.clock.t = T0 + 730 * DAY;
    value(await s.service.signIn(ctxOf(s.clock, { addressKey: addressFor('carol later') }), { name: 'Carol', password: PW }));

    // inactive for three years less 30 days, to the millisecond: not yet more than that
    s.clock.t = T0 + INACTIVE - LEAD;
    expect((await s.service.tick(s.clock.now())).inactiveNotified).toBe(0);
    s.clock.t = T0 + INACTIVE - LEAD + 1;
    expect((await s.service.tick(s.clock.now())).inactiveNotified).toBe(1);
    expect(s.notices).toEqual([{ account: alice.auth.account, kind: 'inactive' }]);
    expect((await s.store.account(alice.auth.account))!.inactiveNoticeAt).toBe(s.clock.now().toISOString());
    // sent once (Bob's address is not verified: no notice)
    s.clock.advance(60_000);
    expect((await s.service.tick(s.clock.now())).inactiveNotified).toBe(0);
    expect(s.notices).toHaveLength(1);

    // three years to the millisecond is not yet more than three years
    s.clock.t = T0 + INACTIVE;
    await s.service.tick(s.clock.now());
    expect((await s.store.account(bob.auth.account))!.deletion).toBeNull();
    s.clock.t = T0 + INACTIVE + 1;
    const head = await s.service.changesHead();
    await s.service.tick(s.clock.now());
    const purgeAt = new Date(s.clock.t + 7 * DAY).toISOString();
    for (const id of [alice.auth.account, bob.auth.account]) {
      expect((await s.store.account(id))!.deletion).toEqual({ requestedAt: s.clock.now().toISOString(), purgeAt, erasingAt: null, done: [] });
    }
    expect((await s.store.account(carol.auth.account))!.deletion).toBeNull();
    expect((await s.service.changes(head, 100)).filter((c) => c.kind === 'deleting').map((c) => c.account).sort()).toEqual([alice.auth.account, bob.auth.account].sort());
    expect(s.notices.slice(1).map((n) => n.kind)).toEqual(['deletionRequested', 'deletionRequested']);
    const events = await s.store.audit({ kinds: ['deletionRequested'], limit: 10 });
    expect(events.map((e) => [e.actor, e.details])).toEqual([['system', { purgeAt }], ['system', { purgeAt }]]);

    // the owner can still sign in and cancel during the grace; nobody does here
    s.clock.t = Date.parse(purgeAt);
    expect((await s.service.tick(s.clock.now())).erased).toBe(2);
    expect(await s.store.account(carol.auth.account)).not.toBeNull();
  });

  it('a sign-in after the notice clears it and stops the deletion', async () => {
    const s = rightsSetup();
    const dave = await registerAs(s, 'Davey');
    await setEmail(s, dave.auth.account, 'dave@example.com');
    s.clock.t = T0 + INACTIVE - LEAD + 1;
    expect((await s.service.tick(s.clock.now())).inactiveNotified).toBe(1);
    s.clock.advance(DAY);
    value(await s.service.signIn(ctxOf(s.clock, { addressKey: addressFor('dave back') }), { name: 'Davey', password: PW }));
    expect((await s.store.account(dave.auth.account))!.inactiveNoticeAt).toBeNull();
    s.clock.t = T0 + INACTIVE + DAY;
    await s.service.tick(s.clock.now());
    expect((await s.store.account(dave.auth.account))!.deletion).toBeNull();
  });

  it('a notice that went out late (the address verified 10 days before the three years) still gets its 30 days', async () => {
    const s = rightsSetup();
    const erin = await registerAs(s, 'Erinn');
    s.clock.t = T0 + INACTIVE - LEAD;
    expect((await s.service.tick(s.clock.now())).inactiveNotified).toBe(0);
    s.clock.t = T0 + INACTIVE - 10 * DAY;
    await setEmail(s, erin.auth.account, 'erin@example.com');
    expect((await s.service.tick(s.clock.now())).inactiveNotified).toBe(1);
    const noticed = s.clock.t;
    s.clock.t = T0 + INACTIVE + DAY;
    await s.service.tick(s.clock.now());
    expect((await s.store.account(erin.auth.account))!.deletion).toBeNull();
    s.clock.t = noticed + LEAD - 1;
    await s.service.tick(s.clock.now());
    expect((await s.store.account(erin.auth.account))!.deletion).toBeNull();
    s.clock.t = noticed + LEAD;
    await s.service.tick(s.clock.now());
    expect((await s.store.account(erin.auth.account))!.deletion).not.toBeNull();
  });

  it('a full page of accounts that wait out their notice never hides the next one: the next tick goes on after it (contract 2, security 2)', async () => {
    const s = rightsSetup();
    const ids: AccountId[] = [];
    for (let i = 0; i <= INACTIVE_BATCH; i++) {
      const r = await registerAs(s, playerName(i));
      await setEmail(s, r.auth.account, `player${i}@example.com`);
      ids.push(r.auth.account);
    }
    s.clock.t = T0 + INACTIVE - LEAD + 1;
    expect((await s.service.tick(s.clock.now())).inactiveNotified).toBe(INACTIVE_BATCH);
    s.clock.advance(60_000);
    expect((await s.service.tick(s.clock.now())).inactiveNotified).toBe(1);
    for (const id of ids) expect((await s.store.account(id))!.inactiveNoticeAt, id).not.toBeNull();
    // 30 days after each notice, each deletion: the one noticed a tick later a tick later
    s.clock.t = T0 + INACTIVE + 1 + 60_000;
    await s.service.tick(s.clock.now());
    s.clock.advance(60_000);
    await s.service.tick(s.clock.now());
    for (const id of ids) expect((await s.store.account(id))!.deletion, id).not.toBeNull();
  });

  it('a sign-in that lands between the store\'s listing and the deletion wins: no deletion (contract 10)', async () => {
    const s = rightsSetup();
    const frank = await registerAs(s, 'Frank');
    s.clock.t = T0 + INACTIVE + 1;
    signInWhileListed(s, 'Frank');
    await s.service.tick(s.clock.now());
    expect((await s.store.account(frank.auth.account))!).toMatchObject({ deletion: null, lastSignInAt: s.clock.now().toISOString() });
    expect(s.notices).toEqual([]);
  });

  it('a sign-in that lands between the store\'s listing and the notice wins: no notice (contract 10)', async () => {
    const s = rightsSetup();
    const dave = await registerAs(s, 'Davey');
    await setEmail(s, dave.auth.account, 'dave@example.com');
    s.clock.t = T0 + INACTIVE - LEAD + 1;
    signInWhileListed(s, 'Davey');
    expect((await s.service.tick(s.clock.now())).inactiveNotified).toBe(0);
    expect((await s.store.account(dave.auth.account))!.inactiveNoticeAt).toBeNull();
    expect(s.notices).toEqual([]);
  });

  it('a pending deletion is left as it is, and an account deleted because inactive can still cancel during its grace', async () => {
    const s = rightsSetup();
    const frank = await registerAs(s, 'Frank');
    s.clock.t = T0 + INACTIVE + 1;
    await s.service.tick(s.clock.now());
    const d = (await s.store.account(frank.auth.account))!.deletion!;
    s.clock.advance(DAY);
    await s.service.tick(s.clock.now());
    expect((await s.store.account(frank.auth.account))!.deletion).toEqual(d);
    const back = value(await s.service.signIn(ctxOf(s.clock, { addressKey: addressFor('frank back') }), { name: 'Frank', password: PW }));
    expect(back.account.status).toBe('deleting');
    expect(value(await s.service.cancelDeletion(ctxOf(s.clock), back.auth)).status).toBe('active');
    s.clock.advance(7 * DAY);
    expect((await s.service.tick(s.clock.now())).erased).toBe(0);
  });
});

describe('M14-7: the operator\'s export files and the daily purge (9.6, 10.3)', () => {
  it('written 0600 in a 0700 folder, purged after a day by the time in its name; other files are left alone', async () => {
    const dir = freshDir();
    const s = rightsSetup({ env: { ACCOUNTS_DATA_DIR: dir } });
    const alice = await registerAs(s, 'Alice');
    const exp = await s.service.admin.exportAccount(OP, alice.auth.account, false);
    const path = adminExportPath(dir, alice.auth.account, exp.exportedAt);
    expect(path).toBe(join(dir, ADMIN_EXPORTS_DIR, `${alice.auth.account}-2026-10-22T12-00-00-000Z.json`));
    // the modes where the system has them (Windows has no such bits)
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, ADMIN_EXPORTS_DIR)).mode & 0o777).toBe(0o700);
    }
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(exp);
    const other = join(dir, ADMIN_EXPORTS_DIR, 'notes.txt');
    writeFileSync(other, 'not an export');
    await s.service.tick(new Date(T0 + DAY - 1));
    expect(existsSync(path)).toBe(true);
    await s.service.tick(new Date(T0 + DAY));
    expect(existsSync(path)).toBe(false);
    expect(existsSync(other)).toBe(true);
    expect(s.log.filter((l) => l.name === 'accounts.purge.exports').map((l) => l.fields)).toEqual([{ removed: 1 }]);
  });

  it('the purge runs from tick once a day and reports its counts; the operator\'s purge runs it now', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    value(await s.service.signOut(ctxOf(s.clock), alice.auth, false));
    const first = await s.service.tick(new Date(T0));
    expect(first.purged).toEqual({ sessions: 0, devices: 0, emailCodes: 0, names: 0, reports: 0, audit: 0, changes: 0, tombstones: 0 });
    expect((await s.service.tick(new Date(T0 + 3_600_000))).purged).toBeNull();
    const later = await s.service.tick(new Date(T0 + 8 * DAY));
    // the revoked session after its 7 days, and the changes older than 7 days
    expect(later.purged).toMatchObject({ sessions: 1, changes: 1 });
    expect(await s.store.sessionsOf(alice.auth.account)).toEqual([]);
    s.clock.t = T0 + 8 * DAY + 60_000;
    expect(await s.service.admin.purge(OP)).toEqual({ sessions: 0, devices: 0, emailCodes: 0, names: 0, reports: 0, audit: 0, changes: 0, tombstones: 0 });
    await expect(s.service.admin.purge({ name: '', osUser: 'olga' })).rejects.toMatchObject({ code: 'invalid' });
  });
});
