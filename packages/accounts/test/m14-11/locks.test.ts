/**
 * M14-11 (review): the lock statements of every write, pinned in their order. PGlite has one connection, so a lock that is missing cannot show as a wait; the
 * statements the store sends can. A spy on the `AccountsSql` records each statement of a method (the same on a real server, where the two-connection cases of
 * concurrency.test.ts then see the waits themselves), and the test asserts the lock statements and their order against the rule of the store:
 *   the name data version (shared), then the table of names, then the account's row; the account's row (KEY SHARE for a writer that attaches rows to it,
 *   FOR UPDATE for an erase, a rename and a rekey's updates) before the rows that hang on it; the change feed's advisory lock after the account's row; the
 *   erase lock first for an erase and for a purge.
 * Also here: a session id taken by another account between the check and the insert is never overwritten, and a block, mute or report of an id with no
 * account sends the statements of one that has (a write at the end of both).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHANGES_LOCK_KEY, DEFAULT_ACCOUNT_RETENTION, ERASE_LOCK_KEY, openPostgresAccountStore, type AccountsSql, type AccountsSqlQueryable, type AccountStore } from '@openmtg/accounts';
import {
  accId, at, auditOf, claimErasure, emailCodeOf, guestSession, historyOf, MINUTE, newAccount, refused, renameOpts, reportId, reportOf, sanctionOf, sanctionId, sessionOf, sha,
  T0,
  tombstoneOf,
} from '../m14-4/contract';
import { kits } from './harness';

interface Statement { text: string; params: readonly unknown[] | undefined }

/** An `AccountsSql` that records every statement sent through it (and its transactions' statements), and closes nothing. */
function spy(base: AccountsSql, log: Statement[], replace?: (s: Statement) => { rows: unknown[]; rowCount: number } | null): AccountsSql {
  const wrap = (q: AccountsSqlQueryable): AccountsSqlQueryable => ({
    query: ((text: string, params?: readonly unknown[]) => {
      const s = { text, params };
      log.push(s);
      const fake = replace?.(s) ?? null;
      return fake !== null ? Promise.resolve(fake) : q.query(text, params);
    }) as AccountsSqlQueryable['query'],
    exec: (text: string) => {
      log.push({ text, params: undefined });
      return q.exec(text);
    },
  });
  return { ...wrap(base), transaction: (fn) => base.transaction((tx) => fn(wrap(tx))), close: async () => {} };
}

const LOCK = /FOR (KEY SHARE|NO KEY UPDATE|SHARE|UPDATE)\b|LOCK TABLE|pg_advisory_xact_lock/;
/** A lock statement as a short label: `ks:accounts` (FOR KEY SHARE), `nku:`, `sh:` (FOR SHARE), `upd:`, `table:names:ROW EXCLUSIVE`, `adv:changes`, `adv:erase`, `adv:email`. */
function label(s: Statement): string {
  const t = s.text.replace(/\s+/g, ' ');
  const table = /FROM accounts\.(\w+)/.exec(t)?.[1] ?? '?';
  const lock = /LOCK TABLE accounts\.(\w+) IN ([A-Z ]+) MODE/.exec(t);
  if (lock) return `table:${lock[1]}:${lock[2]}`;
  if (/pg_advisory_xact_lock/.test(t)) {
    if (/hashtextextended/.test(t)) return 'adv:email';
    return s.params?.[0] === CHANGES_LOCK_KEY ? 'adv:changes' : s.params?.[0] === ERASE_LOCK_KEY ? 'adv:erase' : `adv:${String(s.params?.[0])}`;
  }
  if (/FOR KEY SHARE/.test(t)) return `ks:${table}`;
  if (/FOR NO KEY UPDATE/.test(t)) return `nku:${table}`;
  if (/FOR SHARE/.test(t)) return `sh:${table}`;
  return `upd:${table}`;
}
const locksOf = (log: readonly Statement[]): string[] => log.filter((s) => LOCK.test(s.text)).map(label);

for (const kit of kits()) {
  describe(`M14-11 the lock statements of every write (${kit.name})`, { timeout: 60_000 }, () => {
    let store: AccountStore;
    let log: Statement[];
    let spied: AccountStore;
    beforeAll(() => kit.reset());
    afterAll(() => kit.end());
    beforeEach(async () => {
      await kit.reset();
      store = await openPostgresAccountStore(kit.service());
      log = [];
      spied = await openPostgresAccountStore(spy(kit.service(), log));
      // the store's own check of the schema version is not under test
      log.length = 0;
    });

    /** The lock statements one call sends. */
    const locks = async (f: (s: AccountStore) => Promise<unknown>): Promise<string[]> => {
      log.length = 0;
      await f(spied);
      return locksOf(log);
    };
    const account = (n: number) => store.createAccount(newAccount(n, `Acct${n}`, `acct${n}`), T0);

    it('a registration reads the name data version shared, first; a rename takes it, then the table of names, then its account\'s row', async () => {
      expect(await locks((s) => s.createAccount(newAccount(1, 'Ann', 'ann'), T0))).toEqual(['sh:name_meta']);
      const a = (await store.account(accId(1)))!;
      expect(await locks((s) => s.rename(a.id, a.version, historyOf(1, 'Anna', 'anna', at(MINUTE)), renameOpts(at(MINUTE))))).toEqual([
        'sh:name_meta', 'table:names:ROW EXCLUSIVE', 'upd:accounts',
      ]);
    });

    it('a rekey takes the name data version exclusively, then the table of names in SHARE ROW EXCLUSIVE mode: the order the writers above keep', async () => {
      await account(1);
      expect(await locks((s) => s.rekey(1, 2, new Map([['acct1', 'acct1b']])))).toEqual(['upd:name_meta', 'table:names:SHARE ROW EXCLUSIVE']);
    });

    it('an update of an account locks its row FOR NO KEY UPDATE (not the stronger lock that would hold up the writers attaching rows to it)', async () => {
      await account(1);
      const a = (await store.account(accId(1)))!;
      expect(await locks((s) => s.updateAccount(a.id, a.version, { avatar: 'd20-amber' }))).toEqual(['nku:accounts']);
    });

    it('a writer that attaches a row to an account takes the account\'s row FOR KEY SHARE first (an erase of it waits, and then removes what the writer wrote)', async () => {
      await account(1);
      await account(2);
      const s0 = sessionOf(1, 5);
      await store.putSession(s0);
      const ks = ['ks:accounts'];
      expect(await locks((s) => s.putSession(sessionOf(1, 6)))).toEqual([...ks, 'upd:sessions']);
      expect(await locks((s) => s.putCredential({ account: accId(1), provider: 'shopify', subject: 'g1', secret: null, meta: {}, createdAt: T0, lastUsedAt: null }))).toEqual(ks);
      const c = (await store.credentialBySubject('local', accId(1)))!;
      expect(await locks((s) => s.putCredential({ ...c, lastUsedAt: at(MINUTE) }, c.secret))).toEqual(ks);
      expect(await locks((s) => s.putDevice({ hash: sha('d'), account: accId(1), createdAt: T0, lastUsedAt: T0, failures: 0 }))).toEqual(ks);
      expect(await locks((s) => s.claimGuest({ session: guestSession(1), account: accId(1), claimedAt: T0 }))).toEqual(ks);
      expect(await locks((s) => s.putSanction(sanctionOf(1, accId(1), 'warn', null)))).toEqual(ks);
      const appeal = { sanction: sanctionId(1), account: accId(1), text: 't', createdAt: T0, answer: null, answerMessage: null, answeredAt: null, answeredBy: null };
      expect(await locks((s) => s.putAppeal(appeal))).toEqual(ks);
      expect(await locks((s) => s.replaceRecoveryCodes(accId(1), []))).toEqual(ks);
      expect(await locks((s) => s.redactName(accId(1), 'acct1'))).toEqual(ks);
      expect(await locks((s) => s.putReport(reportOf(1, null, { account: accId(1) }, 'Acct1')))).toEqual(ks);
      expect(await locks((s) => s.setRelation({ account: accId(1), other: accId(2), kind: 'block', createdAt: T0 }))).toEqual(['ks:accounts', 'ks:accounts']);
    });

    it('an email code takes the account\'s row, then the advisory lock of its account and purpose (the cap is checked under it)', async () => {
      await account(1);
      expect(await locks((s) => s.putEmailCode(emailCodeOf(1, accId(1), 'reset'), T0))).toEqual(['ks:accounts', 'adv:email']);
    });

    it('an audit write about accounts takes the table of names, then their rows FOR KEY SHARE; one about nobody takes no lock', async () => {
      await account(1);
      const event = (n: number, account: ReturnType<typeof accId> | null) => auditOf(n, 'signedIn', account, { provider: 'local', device: false, restricted: false });
      expect(await locks((s) => s.appendAudit([event(1, accId(1)), event(2, accId(2))]))).toEqual(['table:names:ROW EXCLUSIVE', 'ks:accounts']);
      expect(await locks((s) => s.appendAudit([event(3, null)]))).toEqual([]);
      expect(await locks((s) => s.appendAudit([auditOf(4, 'deleted', accId(1), { holders: [] }, { actor: 'system' })]))).toEqual([]);
    });

    it('a change takes its account\'s row BEFORE the feed\'s advisory lock (a writer held up by an erase must not hold the feed meanwhile); a `deleted` change has no account row to take', async () => {
      await account(1);
      expect(await locks((s) => s.appendChange({ at: T0, account: accId(1), kind: 'avatar' }))).toEqual(['ks:accounts', 'adv:changes']);
      expect(await locks((s) => s.appendChange({ at: T0, account: accId(1), kind: 'deleted' }))).toEqual(['adv:changes']);
    });

    it('an erase takes the erase lock, the table of names, then the account\'s row FOR UPDATE; a purge takes the erase lock first', async () => {
      await account(1);
      await claimErasure(store, accId(1), at(-MINUTE));
      expect(await locks((s) => s.erase(accId(1), tombstoneOf(accId(1), at(MINUTE)), at(90 * 24 * 60 * MINUTE)))).toEqual(['adv:erase', 'table:names:ROW EXCLUSIVE', 'upd:accounts']);
      expect(await locks((s) => s.purge(DEFAULT_ACCOUNT_RETENTION, at(MINUTE)))).toEqual(['adv:erase']);
    });

    it('the compare-and-set writes that read before they write lock the row they read FOR UPDATE: a session\'s rotations, the credentials of an account, a name entry, a sanction', async () => {
      await account(1);
      const s0 = sessionOf(1, 0);
      expect(await locks((s) => s.rotateSession(s0.id, s0.tokenHash, sha('t1'), at(MINUTE)))).toEqual(['upd:sessions']);
      expect(await locks((s) => s.rerotateInGrace(s0.id, s0.tokenHash, sha('t2')))).toEqual(['upd:sessions']);
      expect(await locks((s) => s.revokeSession(accId(1), s0.id, 'signOut', at(MINUTE)))).toEqual(['upd:sessions']);
      await store.putCredential({ account: accId(1), provider: 'shopify', subject: 'g1', secret: null, meta: {}, createdAt: T0, lastUsedAt: null });
      expect(await locks((s) => s.deleteCredential(accId(1), 'shopify', 'g1'))).toEqual(['upd:credentials']);
      await store.putNameEntry({ key: 'staff', keyVersion: 1, kind: 'reserved', account: null, until: null, note: null, createdAt: T0 });
      expect(await locks((s) => s.deleteNameEntry('staff', 1))).toEqual(['upd:names']);
      await store.putSanction(sanctionOf(1, accId(1), 'warn', null));
      expect(await locks((s) => s.markSeen(accId(1), sanctionId(1), at(MINUTE)))).toEqual(['upd:sanctions']);
    });

    describe('a session id another account took between the check and the insert', () => {
      it('is never overwritten: the upsert keeps the account guard, and the loser answers exists', async () => {
        await account(1);
        await account(2);
        const mine = sessionOf(1, 0);
        // the race: the other account's check finds no session of that id (the first insert is not visible yet), and its insert meets the first one's row
        const blind = spy(kit.service(), [], (s) => (/FROM accounts\.sessions WHERE id = \$1 FOR UPDATE/.test(s.text.replace(/\s+/g, ' ')) ? { rows: [], rowCount: 0 } : null));
        const other = await openPostgresAccountStore(blind);
        const intruder = { ...sessionOf(2, 7), id: mine.id };
        await refused(other.putSession(intruder), 'exists');
        expect((await store.sessionByTokenHash(mine.tokenHash))?.row).toEqual(mine);
        expect(await store.sessionByTokenHash(intruder.tokenHash)).toBeNull();
        expect((await store.sessionsOf(accId(2))).map((x) => x.id)).toEqual([sessionOf(2, 0).id]);
        // the same account's own session of that id is still an upsert
        await other.putSession({ ...mine, lastUsedAt: at(MINUTE) });
        expect((await store.sessionsOf(accId(1)))[0]!.lastUsedAt).toBe(at(MINUTE));
      });
    });

    describe('a block, mute or report of an id with no account', () => {
      const shape = (l: readonly Statement[]): string[] => l.map((s) => s.text.replace(/\s+/g, ' ').replace(/\$\d+/g, '$').slice(0, 60));
      const pad = async (): Promise<number> => (await kit.admin(async (sql) => Number((await sql.query<{ n: unknown }>('SELECT n FROM accounts.write_pad')).rows[0]!.n)));

      it('sends the statements of one that has an account, and ends in a write as that one does (the pad row, where the stored path writes its row)', async () => {
        await account(1);
        await account(2);
        log.length = 0;
        await spied.setRelation({ account: accId(1), other: accId(2), kind: 'block', createdAt: T0 });
        const stored = shape(log);
        const padBefore = await pad();
        log.length = 0;
        await spied.setRelation({ account: accId(1), other: accId(9), kind: 'block', createdAt: T0 });
        const dropped = shape(log);
        expect(dropped).toHaveLength(stored.length);
        expect(dropped.slice(0, -1)).toEqual(stored.slice(0, -1));
        expect(stored[stored.length - 1]).toMatch(/^INSERT INTO accounts\.relations/);
        expect(dropped[dropped.length - 1]).toMatch(/^UPDATE accounts\.write_pad SET n = n \+ 1/);
        expect(await pad()).toBe(padBefore + 1);
        expect(await store.relationsOf(accId(1))).toHaveLength(1);

        log.length = 0;
        await spied.putReport(reportOf(1, null, { account: accId(2) }, 'Acct2'));
        const storedReport = shape(log);
        log.length = 0;
        await spied.putReport(reportOf(2, null, { account: accId(9) }, 'Nobody'));
        const droppedReport = shape(log);
        expect(droppedReport).toHaveLength(storedReport.length);
        expect(droppedReport.slice(0, -1)).toEqual(storedReport.slice(0, -1));
        expect(storedReport[storedReport.length - 1]).toMatch(/^INSERT INTO accounts\.reports/);
        expect(droppedReport[droppedReport.length - 1]).toMatch(/^UPDATE accounts\.write_pad SET n = n \+ 1/);
        expect(await pad()).toBe(padBefore + 2);
        expect(await store.report(reportId(2))).toBeNull();
      });
    });
  });
}
