/**
 * M14-7: the erasure (design 10.2 steps 3-8; 13.2): at purgeAt with two fake required holders, one failing once and one answering `pending` once
 * (both retried, the account hidden meanwhile, the tombstone written only after both); a holder that is done is never called again; a missing
 * required holder blocks the tombstone until it is registered; a rerun changes nothing; the tombstone and the 90-day hold; an erase whose
 * snapshot failed finished at the next tick; and on the file store a byte search of ACCOUNTS_DATA_DIR after the erasure, with FileMailer's files
 * (a fake that files them as FileMailer does) and the operator's export files deleted with the account. The review of M14-7's fixes, each as a
 * fixed interleaving: two services ticking at once on one store, and a pass that outlasted its lease (one erasure); a full page of held-up
 * erasures and the one after it; a sign-in and a wrong password during the store's erase, and an audit flush the store refused (nothing of the
 * account left); a deleted change that failed, an erase that failed before and after its commit (one deleted event, one deleted change); a short
 * name and the other accounts' export files.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AccountStoreError, adminExportPath, DELETED_PLAYER_NAME, MemoryAccountStore, openFileAccountStore, type AccountId, type AccountStore,
} from '@openmtg/accounts';
import { ERASE_BATCH, ERASURE_LEASE_MS, PERMANENT_SANCTION_UNTIL, runningSanctionEnd } from '../../src/rights/deletion';
import { placesInTables } from '../m14-4/contract';
import {
  addressFor, BIRTH, Clock, code, ctxOf, DAY, dumpOf, FakeHolder, FakeMailer, inRow, placesInDir, playerName, PW, PW2, registerAs, rightsSetup,
  sanctionOn, setEmail, T0, until, value, type RightsSetup,
} from './support';

const root = mkdtempSync(join(tmpdir(), 'openmtg-m14-7-erasure-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;
const freshDir = (): string => join(root, `data-${++dirs}`);
const OP = { name: 'Operator Olga', osUser: 'olga' };

async function deleted(s: RightsSetup, name: string): Promise<{ id: AccountId; purgeAt: number; token: string }> {
  const r = await registerAs(s, name);
  const del = value(await s.service.deleteAccount(ctxOf(s.clock), r.auth, { password: PW }));
  return { id: r.auth.account, purgeAt: Date.parse(del.purgeAt), token: r.token };
}

/**
 * Holds the first two claims (account writes that set `erasingAt` before any holder is done) until both are waiting, so both read the same version,
 * then lets them through one after the other.
 */
function holdClaims(store: AccountStore): { held: number } {
  const update = store.updateAccount.bind(store);
  const out = { held: 0 };
  const waiting: (() => Promise<void>)[] = [];
  store.updateAccount = (id, version, patch) => {
    const d = patch.deletion;
    if (out.held >= 2 || d === undefined || d === null || d.erasingAt === null || d.done.length > 0) return update(id, version, patch);
    out.held++;
    return new Promise((resolve, reject) => {
      waiting.push(() => update(id, version, patch).then(resolve, reject));
      if (waiting.length === 2) void waiting[0]!().then(() => waiting[1]!());
    });
  };
  return out;
}

describe('M14-7: erasure through the holders (10.2 step 4)', () => {
  it('two required holders, one failing once and one answering pending once: both retried, hidden meanwhile, the tombstone only after both', async () => {
    const s = rightsSetup({ env: { ACCOUNTS_REQUIRED_HOLDERS: 'hosted,ladder' } });
    const hosted = new FakeHolder('hosted', ['fail']);
    const ladder = new FakeHolder('ladder', ['pending']);
    s.service.addHolder(hosted);
    s.service.addHolder(ladder);
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    s.guests.add('d'.repeat(64), 'gs_aliceguest');
    value(await s.service.claimGuest(ctxOf(s.clock, { guestSession: null }), alice.auth, 'd'.repeat(64), { password: PW }));
    s.clock.advance(DAY);
    value(await s.service.rename(ctxOf(s.clock), alice.auth, 'Alicia', { password: PW }));
    const del = value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    const at = Date.parse(del.purgeAt);

    expect(await s.service.tick(new Date(at))).toMatchObject({ erased: 0, erasureRetries: 2, erasureBlocked: 0 });
    expect([hosted.erases.length, ladder.erases.length]).toEqual([1, 1]);
    expect(hosted.erases[0]).toEqual({ account: A, claims: [{ session: 'gs_aliceguest', claimedAt: new Date(T0).toISOString() }], names: ['Alice', 'Alicia'] });
    expect(await s.store.tombstone(A)).toBeNull();
    expect((await s.store.account(A))!.deletion).toMatchObject({ erasingAt: new Date(at).toISOString(), done: [] });
    // hidden meanwhile: no profile, no name, no history, a deleting standing; and the cancel is refused
    expect(code(await s.service.profile(ctxOf(s.clock), { name: 'Alicia' }))).toBe('notFound');
    expect((await s.service.directory.names([A])).size).toBe(0);
    expect(await s.service.directory.historyVisible(A, null)).toBe(false);
    expect((await s.service.directory.standing(A))!.status).toBe('deleting');
    expect(code(inRow('cancelDeletion', await s.service.cancelDeletion(ctxOf(s.clock, { now: new Date(at) }), alice.auth)))).toBe('notAllowed');
    expect(s.log.filter((l) => l.name === 'accounts.erasure.holder').map((l) => [l.fields['holder'], l.fields['outcome']])).toEqual([
      ['hosted', 'failed'], ['ladder', 'pending'],
    ]);

    const head = await s.service.changesHead();
    expect(await s.service.tick(new Date(at + 60_000))).toMatchObject({ erased: 1, erasureRetries: 0, erasureBlocked: 0 });
    expect([hosted.erases.length, ladder.erases.length]).toEqual([2, 2]);
    expect(await s.store.account(A)).toBeNull();
    expect(await s.store.tombstone(A)).toEqual({ account: A, deletedAt: new Date(at + 60_000).toISOString(), sanctionUntil: null, holdersDone: ['hosted', 'ladder'] });
    expect((await s.service.changes(head, 10)).map((c) => [c.kind, c.account])).toEqual([['deleted', A]]);
    const events = await s.store.audit({ account: A, limit: 100 });
    expect(events.map((e) => [e.kind, e.actor, e.addressTag, e.details])).toEqual([['deleted', 'system', null, { holders: ['hosted', 'ladder'] }]]);
    // its tokens find nothing; its name signs in to nothing
    expect(code(await s.service.resume(ctxOf(s.clock), alice.token))).toBe('sessionExpired');
    expect(code(await s.service.signIn(ctxOf(s.clock, { addressKey: addressFor('again') }), { name: 'Alicia', password: PW }))).toBe('badCredentials');
    expect(await s.service.directory.displayNameAt(A, 'Alicia', A)).toBe(DELETED_PLAYER_NAME);

    // a rerun changes nothing and calls nobody (the failed sign-in above is counted first: the audit writer's own queue)
    await s.partDeps.current!.audit.flush();
    const before = JSON.stringify(dumpOf(s.store));
    expect(await s.service.tick(new Date(at + 2 * 60_000))).toMatchObject({ erased: 0, erasureRetries: 0, erasureBlocked: 0 });
    expect([hosted.erases.length, ladder.erases.length]).toEqual([2, 2]);
    expect(JSON.stringify(dumpOf(s.store))).toBe(before);
  });

  it('a holder that is done is never called again while another one still answers pending', async () => {
    const s = rightsSetup({ env: { ACCOUNTS_REQUIRED_HOLDERS: 'hosted,ladder' } });
    const hosted = new FakeHolder('hosted');
    const ladder = new FakeHolder('ladder', ['pending', 'pending']);
    s.service.addHolder(hosted);
    s.service.addHolder(ladder);
    const a = await deleted(s, 'Alice');
    expect((await s.service.tick(new Date(a.purgeAt))).erasureRetries).toBe(1);
    expect((await s.store.account(a.id))!.deletion!.done).toEqual(['hosted']);
    expect((await s.service.tick(new Date(a.purgeAt + 60_000))).erasureRetries).toBe(1);
    expect((await s.service.tick(new Date(a.purgeAt + 120_000))).erased).toBe(1);
    expect([hosted.erases.length, ladder.erases.length]).toEqual([1, 3]);
  });

  it('a missing required holder blocks the tombstone (logged by name); the erasure resumes once it is registered', async () => {
    const s = rightsSetup({ env: { ACCOUNTS_REQUIRED_HOLDERS: 'hosted' } });
    const extra = new FakeHolder('extra');
    s.service.addHolder(extra);
    const a = await deleted(s, 'Alice');
    for (const t of [a.purgeAt, a.purgeAt + 60_000]) {
      expect(await s.service.tick(new Date(t))).toMatchObject({ erased: 0, erasureBlocked: 1 });
      expect(await s.store.tombstone(a.id)).toBeNull();
      expect(await s.store.account(a.id)).not.toBeNull();
    }
    // the holders that are there did their part once
    expect(extra.erases).toHaveLength(1);
    expect(s.log.filter((l) => l.name === 'accounts.erasure.blocked').map((l) => l.fields)).toEqual([{ holders: 'hosted' }, { holders: 'hosted' }]);
    const hosted = new FakeHolder('hosted');
    s.service.addHolder(hosted);
    expect(await s.service.tick(new Date(a.purgeAt + 120_000))).toMatchObject({ erased: 1, erasureBlocked: 0 });
    expect([extra.erases.length, hosted.erases.length]).toEqual([1, 1]);
    expect((await s.store.tombstone(a.id))!.holdersDone).toEqual(['extra', 'hosted']);
  });

  it('a holder that answers something that is not a result is retried, never counted as done', async () => {
    const s = rightsSetup();
    let calls = 0;
    s.service.addHolder({ name: 'odd', exportFor: async () => null, erase: async () => (++calls === 1 ? (undefined as never) : { removed: 0, anonymised: 0 }) });
    const a = await deleted(s, 'Alice');
    expect(await s.service.tick(new Date(a.purgeAt))).toMatchObject({ erased: 0, erasureRetries: 1 });
    expect(await s.service.tick(new Date(a.purgeAt + 60_000))).toMatchObject({ erased: 1 });
  });
});

describe('M14-7: the tombstone and the name hold (10.2 steps 5-8)', () => {
  it('the tombstone keeps the end of a running suspension; the current key is held 90 days for nobody, then free', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    s.clock.advance(DAY);
    value(await s.service.rename(ctxOf(s.clock), alice.auth, 'Alicia', { password: PW }));
    await sanctionOn(s, A, 1, 'suspend', 30 * DAY);
    const del = value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    const at = Date.parse(del.purgeAt);
    expect((await s.service.tick(new Date(at))).erased).toBe(1);
    expect(await s.store.tombstone(A)).toEqual({
      account: A, deletedAt: new Date(at).toISOString(), sanctionUntil: new Date(T0 + 31 * DAY).toISOString(), holdersDone: [],
    });
    // both keys are holds for nobody: the current one for 90 days, the one renamed away from until its own 60 days
    const key = (n: string) => s.names.key(n);
    expect(await s.store.nameEntry(key('Alicia'), s.names.current.version)).toMatchObject({ kind: 'held', account: null, until: new Date(at + 90 * DAY).toISOString() });
    expect(await s.store.nameEntry(key('Alice'), s.names.current.version)).toMatchObject({ kind: 'held', account: null, until: new Date(T0 + 61 * DAY).toISOString() });
    const register = (t: number) =>
      s.service.register(ctxOf(s.clock, { now: new Date(t), connection: `c${t}`, guestSession: null, addressKey: addressFor(`r${t}`) }), {
        name: 'Alicia', password: PW, birth: BIRTH, claimGuest: false,
      });
    s.clock.t = at + 90 * DAY - 60_000;
    expect(code(inRow('register', await register(s.clock.t)))).toBe('nameTaken');
    expect(await s.service.nameUnavailable('Alicia')).toBe(true);
    // the tombstone stays while the hold runs, then goes with the daily purge
    expect((await s.service.tick(s.clock.now())).purged!.tombstones).toBe(0);
    s.clock.t = at + 90 * DAY;
    expect(await s.service.nameUnavailable('Alicia')).toBe(false);
    const again = value(inRow('register', await register(s.clock.t)));
    expect(again.auth.account).not.toBe(A);
    s.clock.advance(DAY);
    expect((await s.service.tick(s.clock.now())).purged!.tombstones).toBe(1);
    expect(await s.store.tombstone(A)).toBeNull();
  });

  it('a tombstone\'s sanction end: the latest running ban or suspension, a permanent ban as the far end, nothing for warnings and mutes', () => {
    const now = new Date(T0);
    const row = (kind: 'warn' | 'mute' | 'suspend' | 'ban', until: number | null, over: Record<string, unknown> = {}) => ({
      id: 'san_x', account: 'acc_x' as AccountId, kind, reason: 'chat' as const, message: '', note: null, since: new Date(T0 - DAY).toISOString(),
      until: until === null ? null : new Date(T0 + until).toISOString(), endedAt: null, endReason: null, endedBy: null, createdAt: new Date(T0).toISOString(),
      createdBy: 'admin:x', reports: [], seenAt: null, ...over,
    });
    expect(runningSanctionEnd([], now)).toBeNull();
    expect(runningSanctionEnd([row('warn', null), row('mute', DAY)], now)).toBeNull();
    expect(runningSanctionEnd([row('suspend', 2 * DAY), row('ban', 5 * DAY)], now)).toBe(new Date(T0 + 5 * DAY).toISOString());
    expect(runningSanctionEnd([row('suspend', 2 * DAY), row('ban', null)], now)).toBe(PERMANENT_SANCTION_UNTIL);
    expect(runningSanctionEnd([row('ban', null, { endedAt: new Date(T0 - 1).toISOString() }), row('suspend', -1)], now)).toBeNull();
  });

  it('an erase whose snapshot could not be written (notCompacted) counts as done and is finished at the next tick', async () => {
    const store = new MemoryAccountStore();
    const erase = store.erase.bind(store);
    const calls: AccountId[] = [];
    store.erase = async (id, ts, hold) => {
      calls.push(id);
      await erase(id, ts, hold);
      if (calls.length === 1) throw new AccountStoreError('notCompacted', 'the snapshot could not be written');
    };
    const s = rightsSetup({ store });
    const a = await deleted(s, 'Alice');
    const head = await s.service.changesHead();
    expect((await s.service.tick(new Date(a.purgeAt))).erased).toBe(1);
    expect((await s.service.changes(head, 10)).map((c) => c.kind)).toEqual(['deleted']);
    expect(s.log.some((l) => l.name === 'accounts.erasure.notCompacted')).toBe(true);
    await s.service.tick(new Date(a.purgeAt + 60_000));
    await s.service.tick(new Date(a.purgeAt + 120_000));
    expect(calls).toEqual([a.id, a.id]);
  });
});

describe('M14-7: what an erasure still owes, and one tick at a time', () => {
  it('a deleted change whose append failed keeps the erasure for the next tick, which appends it once, before the erase', async () => {
    const store = new MemoryAccountStore();
    const appendChange = store.appendChange.bind(store);
    let failOnce = true;
    store.appendChange = async (c) => {
      if (c.kind === 'deleted' && failOnce) {
        failOnce = false;
        throw new AccountStoreError('closed', 'the store is restarting');
      }
      return appendChange(c);
    };
    const s = rightsSetup({ store });
    const a = await deleted(s, 'Alice');
    const head = await s.service.changesHead();
    expect(await s.service.tick(new Date(a.purgeAt))).toMatchObject({ erased: 0, erasureRetries: 1 });
    expect(await s.store.account(a.id)).not.toBeNull();
    expect(await s.service.changes(head, 10)).toEqual([]);
    expect((await s.service.tick(new Date(a.purgeAt + 60_000))).erased).toBe(1);
    await s.service.tick(new Date(a.purgeAt + 120_000));
    expect((await s.service.changes(head, 10)).map((c) => [c.kind, c.account, c.at])).toEqual([['deleted', a.id, new Date(a.purgeAt + 60_000).toISOString()]]);
    expect((await s.store.audit({ account: a.id, limit: 10 })).map((e) => e.kind)).toEqual(['deleted']);
  });

  it('an erase that commits and then fails loses no deleted change (contract 5): the change goes in before the erase', async () => {
    const store = new MemoryAccountStore();
    const erase = store.erase.bind(store);
    let failOnce = true;
    store.erase = async (id, ts, hold) => {
      await erase(id, ts, hold);
      if (failOnce) {
        failOnce = false;
        throw new Error('the connection dropped after the commit');
      }
    };
    const s = rightsSetup({ store });
    const a = await deleted(s, 'Alice');
    const head = await s.service.changesHead();
    expect(await s.service.tick(new Date(a.purgeAt))).toMatchObject({ erased: 0, erasureRetries: 1 });
    for (const t of [60_000, 120_000]) await s.service.tick(new Date(a.purgeAt + t));
    expect(await s.store.tombstone(a.id)).not.toBeNull();
    expect((await s.service.changes(head, 10)).map((c) => [c.kind, c.account])).toEqual([['deleted', a.id]]);
    expect((await s.store.audit({ account: a.id, limit: 10 })).map((e) => e.kind)).toEqual(['deleted']);
  });

  it('an erase that fails before it commits is tried again at the next tick, with one deleted event and one deleted change (contract 10)', async () => {
    const store = new MemoryAccountStore();
    const erase = store.erase.bind(store);
    let failOnce = true;
    store.erase = async (id, ts, hold) => {
      if (failOnce) {
        failOnce = false;
        throw new AccountStoreError('closed', 'the store is restarting');
      }
      return erase(id, ts, hold);
    };
    const s = rightsSetup({ store });
    const a = await deleted(s, 'Alice');
    const head = await s.service.changesHead();
    expect(await s.service.tick(new Date(a.purgeAt))).toMatchObject({ erased: 0, erasureRetries: 1 });
    expect(await s.store.account(a.id)).not.toBeNull();
    expect((await s.service.tick(new Date(a.purgeAt + 60_000))).erased).toBe(1);
    expect((await s.store.audit({ account: a.id, limit: 10 })).map((e) => [e.kind, e.at])).toEqual([['deleted', new Date(a.purgeAt).toISOString()]]);
    expect((await s.service.changes(head, 10)).map((c) => c.kind)).toEqual(['deleted']);
  });

  it('two services on one store ticking at once: one claim wins, one erasure, each holder once, one deleted event and change (contract 1)', async () => {
    const store = new MemoryAccountStore();
    const clock = new Clock();
    const one = rightsSetup({ store, clock });
    const two = rightsSetup({ store, clock, seed: 'm14-7 second process' });
    const holders = [new FakeHolder('hosted'), new FakeHolder('hosted')];
    one.service.addHolder(holders[0]!);
    two.service.addHolder(holders[1]!);
    const a = await deleted(one, 'Alice');
    const head = await store.changesHead();
    const race = holdClaims(store);
    const [r1, r2] = await Promise.all([one.service.tick(new Date(a.purgeAt)), two.service.tick(new Date(a.purgeAt))]);
    // both claims read the same version before either was written: a real race, settled by the version check and the lease
    expect(race.held).toBe(2);
    expect([r1.erased + r2.erased, holders[0]!.erases.length + holders[1]!.erases.length]).toEqual([1, 1]);
    expect(await store.tombstone(a.id)).not.toBeNull();
    expect((await store.audit({ account: a.id, limit: 10 })).map((e) => e.kind)).toEqual(['deleted']);
    expect((await store.changes(head, 10)).filter((c) => c.kind === 'deleted')).toHaveLength(1);
  });

  it('a pass that outlasted its lease leaves the rest to the pass that claimed it again: one erasure (contract 1)', async () => {
    const store = new MemoryAccountStore();
    const clock = new Clock();
    const one = rightsSetup({ store, clock });
    const two = rightsSetup({ store, clock, seed: 'm14-7 second process' });
    const slow = new FakeHolder('hosted');
    const quick = new FakeHolder('hosted');
    one.service.addHolder(slow);
    two.service.addHolder(quick);
    const a = await deleted(one, 'Alice');
    const head = await store.changesHead();
    const openSlow = slow.hold();
    const openQuick = quick.hold();
    const first = one.service.tick(new Date(a.purgeAt));
    await until(() => slow.erases.length === 1);
    // the other process's tick a lease later claims it again while the first pass still waits in its holder
    const second = two.service.tick(new Date(a.purgeAt + ERASURE_LEASE_MS));
    await until(() => quick.erases.length === 1);
    expect((await store.account(a.id))!.deletion!.erasingAt).toBe(new Date(a.purgeAt + ERASURE_LEASE_MS).toISOString());
    openSlow();
    openQuick();
    const [r1, r2] = await Promise.all([first, second]);
    expect([r1.erased, r2.erased]).toEqual([0, 1]);
    expect((await store.tombstone(a.id))!.deletedAt).toBe(new Date(a.purgeAt + ERASURE_LEASE_MS).toISOString());
    expect((await store.audit({ account: a.id, limit: 10 })).map((e) => e.kind)).toEqual(['deleted']);
    expect((await store.changes(head, 10)).filter((c) => c.kind === 'deleted')).toHaveLength(1);
    expect(one.log.some((l) => l.name === 'accounts.erasure.lease')).toBe(true);
  });

  it('a full page of erasures a holder holds up never hides the next one: the next tick goes on after it (contract 3, security 3)', async () => {
    const s = rightsSetup();
    for (let i = 0; i <= ERASE_BATCH; i++) await deleted(s, playerName(i));
    const purgeAt = T0 + 7 * DAY;
    const due = await s.store.dueDeletions(new Date(purgeAt).toISOString(), 2 * ERASE_BATCH);
    expect(due).toHaveLength(ERASE_BATCH + 1);
    // the holder still needs the first page's accounts (running games); the one after them it can erase
    const last = due[ERASE_BATCH]!;
    const calls: AccountId[] = [];
    s.service.addHolder({
      name: 'hosted', exportFor: async () => null,
      erase: async (ref) => {
        calls.push(ref.account);
        return { removed: 0, anonymised: 0, ...(ref.account === last ? {} : { pending: true }) };
      },
    });
    expect(await s.service.tick(new Date(purgeAt))).toMatchObject({ erased: 0, erasureRetries: ERASE_BATCH });
    expect(await s.service.tick(new Date(purgeAt + 60_000))).toMatchObject({ erased: 1, erasureRetries: 0 });
    expect(await s.store.tombstone(last)).not.toBeNull();
    // then from the start again: the held-up ones are tried once more
    expect(await s.service.tick(new Date(purgeAt + 120_000))).toMatchObject({ erased: 0, erasureRetries: ERASE_BATCH });
    expect(calls.filter((x) => x === last)).toHaveLength(1);
    expect(new Set(calls).size).toBe(ERASE_BATCH + 1);
  });

  it('what a request running at the erasure writes of the account afterwards is kept out: a sign-in, a wrong password (contract 4, security 1)', async () => {
    const store = new MemoryAccountStore();
    const erase = store.erase.bind(store);
    let entered = false;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    store.erase = async (id, ts, hold) => {
      entered = true;
      await gate;
      return erase(id, ts, hold);
    };
    const s = rightsSetup({ store });
    const a = await deleted(s, 'Alice');
    s.clock.t = a.purgeAt;
    const ticking = s.service.tick(new Date(a.purgeAt));
    await until(() => entered);
    // while the store's erase runs: the owner signs in from another device (a restricted session), and someone types a wrong password for her
    value(await s.service.signIn(ctxOf(s.clock, { connection: 'phone', addressKey: addressFor('phone') }), { name: 'Alice', password: PW }));
    expect(code(await s.service.signIn(ctxOf(s.clock, { connection: 'guess', addressKey: addressFor('guess') }), { name: 'Alice', password: PW2 }))).toBe(
      'badCredentials',
    );
    open();
    expect((await ticking).erased).toBe(1);
    await s.partDeps.current!.audit.flush();
    expect((await s.store.audit({ account: a.id, limit: 100 })).map((e) => e.kind)).toEqual(['deleted']);
    for (const p of placesInTables(dumpOf(store), a.id)) expect(['tombstone', 'audit:deleted', 'change:deleted']).toContain(p);
  });

  it('an audit flush the store refused keeps the erasure for the next tick, so the account\'s queued events go with it (security 1)', async () => {
    const store = new MemoryAccountStore();
    const appendAudit = store.appendAudit.bind(store);
    let refuseOnce = false;
    store.appendAudit = async (events) => {
      if (refuseOnce && events.some((e) => e.kind === 'signedIn')) {
        refuseOnce = false;
        throw new AccountStoreError('closed', 'the store is restarting');
      }
      return appendAudit(events);
    };
    const s = rightsSetup({ store });
    const a = await deleted(s, 'Alice');
    await s.partDeps.current!.audit.flush();
    // a sign-in a moment before the erasure: its event is still queued when the erasure flushes, and that flush fails
    s.clock.t = a.purgeAt;
    value(await s.service.signIn(ctxOf(s.clock, { connection: 'phone', addressKey: addressFor('phone') }), { name: 'Alice', password: PW }));
    refuseOnce = true;
    expect(await s.service.tick(new Date(a.purgeAt))).toMatchObject({ erased: 0, erasureRetries: 1 });
    expect(s.log.filter((l) => l.name === 'accounts.erasure.audit').map((l) => l.fields)).toEqual([{ queued: 1 }]);
    expect(await s.store.account(a.id)).not.toBeNull();
    expect((await s.service.tick(new Date(a.purgeAt + 60_000))).erased).toBe(1);
    expect((await s.store.audit({ account: a.id, limit: 100 })).map((e) => e.kind)).toEqual(['deleted']);
  });

  it('a tick while another is still running does nothing; the first one finishes the erasure', async () => {
    const s = rightsSetup();
    const holder = new FakeHolder('hosted');
    s.service.addHolder(holder);
    const a = await deleted(s, 'Alice');
    const open = holder.hold();
    const first = s.service.tick(new Date(a.purgeAt));
    // the first tick waits inside the holder: wait until it is there (a fixed handshake, not a timer)
    while (holder.erases.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await s.service.tick(new Date(a.purgeAt))).toMatchObject({ erased: 0, erasureRetries: 0, erasureBlocked: 0, purged: null });
    open();
    expect((await first).erased).toBe(1);
    expect(holder.erases).toHaveLength(1);
  });
});

describe('M14-7: nothing left behind (10.2, 13.2)', () => {
  it('the file store: a byte search of ACCOUNTS_DATA_DIR finds the id only in the tombstone, the deleted event and change, and open reports; no name or email', async () => {
    const dir = freshDir();
    const store = await openFileAccountStore({ dir });
    const mailer = new FakeMailer(join(dir, 'mail'));
    const s = rightsSetup({ store, mailer, env: { ACCOUNTS_DATA_DIR: dir, MAILER: 'file' } });
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bobby');
    const carol = await registerAs(s, 'Carol');
    // the holder's section of Bob's export names her (a game they played: hosted shows her name to him, 10.1)
    const hosted = new FakeHolder('hosted');
    hosted.exportFor = async (ref) => ({ games: ref.account === bob.auth.account ? [{ seat: 1, name: 'Alicia' }] : [] });
    s.service.addHolder(hosted);
    const A = alice.auth.account;
    await setEmail(s, A, 'alice.smith@example.com');
    await setEmail(s, bob.auth.account, 'bob@example.com');
    s.clock.advance(DAY);
    value(await s.service.rename(ctxOf(s.clock), alice.auth, 'Alicia', { password: PW }));
    // Bob's open report about her names her and her address in its text; Bob blocks her
    await s.store.putReport({
      id: 'rep_01J00000000000000000000001', reporter: { kind: 'account', account: bob.auth.account }, target: { account: A }, targetName: 'Alicia',
      reason: 'harassment', game: null, text: 'Alicia (alice.smith@example.com) was rude, and as Alice before', related: [], evidence: null, status: 'new',
      createdAt: s.clock.now().toISOString(), closedAt: null, closedBy: null, note: null,
    });
    await s.store.setRelation({ account: bob.auth.account, other: A, kind: 'block', createdAt: s.clock.now().toISOString() });
    const del = value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    // an hour before the erasure: mail FileMailer filed for both of them, and an operator's export of each (younger than their day)
    s.clock.t = Date.parse(del.purgeAt) - 3_600_000;
    await mailer.send('alice.smith@example.com', { subject: 'Your account', text: 'Hello Alicia' }, { account: A, kind: 'notice', expiresAt: null });
    await mailer.send('bob@example.com', { subject: 'Your account', text: 'Hello Bobby' }, { account: bob.auth.account, kind: 'notice', expiresAt: null });
    await s.service.admin.exportAccount(OP, A, false);
    await s.service.admin.exportAccount(OP, bob.auth.account, false);
    await s.service.admin.exportAccount(OP, carol.auth.account, false);
    expect(placesInDir(dir, 'Alicia').length).toBeGreaterThan(0);

    expect((await s.service.tick(new Date(del.purgeAt))).erased).toBe(1);

    expect(mailer.forgot.filter((x) => x === A).length).toBeGreaterThanOrEqual(1);
    expect(readdirSync(join(dir, 'mail'))).toEqual([bob.auth.account]);
    expect(readdirSync(join(dir, 'exports')).filter((f) => f.startsWith(A))).toEqual([]);
    for (const p of placesInDir(dir, A)) expect(['tombstone', 'audit:deleted', 'change:deleted', 'report-target:open']).toContain(p);
    expect(placesInDir(dir, A)).toEqual(expect.arrayContaining(['tombstone', 'audit:deleted', 'change:deleted']));
    for (const needle of ['Alicia', 'Alice', 'alice.smith@example.com', 'alice.smith']) expect(placesInDir(dir, needle), needle).toEqual([]);
    for (const k of [s.names.key('Alicia'), s.names.key('Alice')]) {
      for (const p of placesInDir(dir, `"${k}"`)) expect(p, k).toBe('name-for-nobody');
    }
    // Bob's data stays, but not his export file, which named her (the game in its holder's section): made again, it names nobody erased (his
    // block went with her, and his report about her is not listed while its target is not active: security review of M14-7, finding 4)
    expect(placesInDir(dir, 'Bobby').length).toBeGreaterThan(0);
    expect(readdirSync(join(dir, 'exports')).filter((f) => f.startsWith(bob.auth.account))).toEqual([]);
    expect(readdirSync(join(dir, 'exports')).filter((f) => f.startsWith(carol.auth.account))).toHaveLength(1);
    expect(s.log.filter((l) => l.name === 'accounts.erasure.exports').map((l) => l.fields)).toEqual([{ dropped: 1 }]);
    hosted.exportFor = async () => ({ games: [] });
    const again = await s.service.admin.exportAccount(OP, bob.auth.account, false);
    expect([again.account.relations, again.account.reportsFiled]).toEqual([[], []]);
    expect((await s.store.report('rep_01J00000000000000000000001'))!.text).toBe(
      `${DELETED_PLAYER_NAME} (${DELETED_PLAYER_NAME}) was rude, and as ${DELETED_PLAYER_NAME} before`,
    );
    if (process.platform !== 'win32') {
      const file = adminExportPath(dir, bob.auth.account, again.exportedAt);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(again);
    }
    await s.service.close();
  });

  it('a short erased name drops only the export files that hold it as a whole value, never one that holds it inside a word (contract 8)', async () => {
    const dir = freshDir();
    const s = rightsSetup({ env: { ACCOUNTS_DATA_DIR: dir } });
    const ion = await registerAs(s, 'Ion');
    const bob = await registerAs(s, 'Bobby');
    const carol = await registerAs(s, 'Carol');
    await s.store.setRelation({ account: carol.auth.account, other: ion.auth.account, kind: 'block', createdAt: s.clock.now().toISOString() });
    await s.service.admin.exportAccount(OP, bob.auth.account, false);
    await s.service.admin.exportAccount(OP, carol.auth.account, false);
    const files = () => readdirSync(join(dir, 'exports'));
    const bobFile = files().find((f) => f.startsWith(bob.auth.account))!;
    // "version", "sessions", "deletion": a search for the name inside any text would drop Bob's file too
    expect(readFileSync(join(dir, 'exports', bobFile), 'utf8').toLowerCase()).toContain('ion');
    await s.service.admin.deleteAccount(OP, ion.auth.account, 'asked by letter', true);
    expect((await s.service.tick(s.clock.now())).erased).toBe(1);
    expect(files()).toEqual([bobFile]);
    expect(s.log.filter((l) => l.name === 'accounts.erasure.exports').map((l) => l.fields)).toEqual([{ dropped: 1 }]);
  });

  it('the memory store: FileMailer is told to forget the account, before and after the store\'s erase', async () => {
    const mailer = new FakeMailer();
    const s = rightsSetup({ mailer });
    const a = await deleted(s, 'Alice');
    await s.service.tick(new Date(a.purgeAt));
    expect(mailer.forgot).toEqual([a.id, a.id]);
  });

  it('a mailer that cannot forget keeps the account (hidden) and its erasure is tried again at the next tick', async () => {
    const mailer = new FakeMailer();
    let fail = true;
    const forget = mailer.forget.bind(mailer);
    mailer.forget = async (account) => {
      if (fail) throw new Error('disk full');
      return forget(account);
    };
    const s = rightsSetup({ mailer });
    const a = await deleted(s, 'Alice');
    expect(await s.service.tick(new Date(a.purgeAt))).toMatchObject({ erased: 0, erasureRetries: 1 });
    expect(await s.store.account(a.id)).not.toBeNull();
    fail = false;
    expect((await s.service.tick(new Date(a.purgeAt + 60_000))).erased).toBe(1);
  });
});
