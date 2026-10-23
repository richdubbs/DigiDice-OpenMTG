/**
 * M14-4: the account store contract suite (design 11.2, 13.2). One suite for every AccountStore: test/m14-4/memory.test.ts and file.test.ts run it
 * on the memory and file stores; M14-11 runs it on PostgresAccountStore (PGlite, and a real server when OPENMTG_TEST_PG_URL is set) with a harness of
 * its own. Fixed inputs and a fixed clock only (owner rule); the races are fixed interleavings of calls on one in-process store, never load.
 *
 * A harness names, for the erase test's byte search, every place a string occurs in everything the store keeps (`places`), each place named by
 * `placeOf` from the table the row is in. The table names are the memory store's (src/store/memory.ts StoreTables): accounts, names, history,
 * credentials, recovery, devices, sessions, claims, relations, emailCodes, reports, sanctions, appeals, audit, changes, tombstones, meta; a
 * PostgreSQL harness maps its tables onto them. A harness finds the string in raw bytes it cannot place under a table as `file:<name>`.
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_STORE_METHODS, AccountStoreError, DEFAULT_ACCOUNT_RETENTION, DEFAULT_PRIVACY, DELETED_PLAYER_NAME,
  type Account, type AccountChange, type AccountId, type AccountPatch, type AccountRetention, type AccountSessionRow, type AccountStore, type AccountStoreLimits,
  type AppealRow, type AuditEvent,
  type AuditKind, type CredentialRow, type EmailCodeRow, type NameHistoryRow, type NewAccount, type RenameOptions, type ReportQuery, type ReportRow,
  type SanctionRow, type StoreErrorCode, type TombstoneRow,
} from '@openmtg/accounts';

// ---- the harness -------------------------------------------------------------------------------------------------------------------------------

export interface StoreHarness {
  readonly name: string;
  /** A fresh, empty store, with these configured limits when given (AccountStoreLimits). */
  open(limits?: AccountStoreLimits): Promise<AccountStore>;
  /** Every place `needle` occurs in everything the store keeps (a byte search), each named by placeOf; [] when nowhere. */
  places(store: AccountStore, needle: string): Promise<string[]>;
  /**
   * INTERFACE CHANGE (M14-11): 'real' for a store whose audit purge counts by a clock the suite cannot move (PostgreSQL's purge_audit uses the database's own, never an
   * argument): the one purge test that runs the audit log against the suite's fixed times is skipped there (test/m14-11/audit.test.ts covers it with
   * times relative to that clock). Absent or 'fake': the clock follows the `now` that purge is given.
   */
  readonly dbClock?: 'fake' | 'real';
  /**
   * INTERFACE CHANGE (M14-11): places besides the tombstone, the `deleted` event and change and the open reports about it where the erased account's id
   * may stay (placeOf's names): PostgreSQL's purge_ledger, the record every account purge leaves of what it removed (11.5).
   */
  readonly erasedIdPlaces?: readonly string[];
}

/**
 * The name of a place a string was found: the table, made finer where the erase test needs it (which audit or change kind, an open or closed report
 * the string is the target of, a names entry of an account or of nobody).
 */
export function placeOf(table: string, row: unknown, needle: string): string {
  const r = (row ?? {}) as Record<string, unknown>;
  switch (table) {
    case 'tombstones':
      return 'tombstone';
    case 'audit':
      return `audit:${String(r['kind'])}`;
    case 'changes':
      return `change:${String(r['kind'])}`;
    case 'names':
      return r['account'] === null ? 'name-for-nobody' : 'name';
    case 'reports': {
      const target = r['target'] as { account?: unknown } | undefined;
      if (target?.account === needle && !JSON.stringify({ ...r, target: null }).includes(needle)) {
        return `report-target:${r['status'] === 'new' ? 'open' : 'closed'}`;
      }
      return 'report';
    }
    default:
      return table;
  }
}

/** The places of `needle` in a store dump of [key, row] entries by table (the memory store's dump, the file store's snapshot). */
export function placesInTables(tables: Record<string, [string, unknown][]>, needle: string): string[] {
  const out: string[] = [];
  for (const [t, entries] of Object.entries(tables)) {
    for (const [k, row] of entries) if (JSON.stringify([k, row]).includes(needle)) out.push(placeOf(t, row, needle));
  }
  return out;
}

// ---- fixtures ----------------------------------------------------------------------------------------------------------------------------------

export const T0 = '2026-10-21T12:00:00.000Z';
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** T0 + ms, canonical. */
export const at = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString();
export const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const pad = (prefix: string, n: number) => `${prefix}${String(n).padStart(26, '0')}`;
export const accId = (n: number): AccountId => pad('acc_', n) as AccountId;
export const sessionId = (n: number): string => pad('as_', n);
export const reportId = (n: number): string => pad('rep_', n);
export const sanctionId = (n: number): string => pad('san_', n);
export const auditId = (n: number): string => pad('aud_', n);
export const emailCodeId = (n: number): string => pad('ec_', n);
export const guestSession = (n: number): string => pad('gs_', n);

export function accountOf(n: number, name: string, key: string, over: Partial<Account> = {}): Account {
  return {
    id: accId(n), name, nameKey: key, keyVersion: 1, avatar: 'd6-blue', privacy: { ...DEFAULT_PRIVACY }, email: null,
    ageGate: { minAge: 13, passedAt: T0 }, createdAt: T0, lastSignInAt: null, renamedAt: null, freeRename: false, deletion: null,
    inactiveNoticeAt: null, version: 1, ...over,
  };
}

/** Account n's session i (its registration session is i = 0). */
export function sessionOf(n: number, i: number, over: Partial<AccountSessionRow> = {}): AccountSessionRow {
  return {
    id: sessionId(n * 100 + i), account: accId(n), provider: 'local', client: 'web', createdAt: T0, lastUsedAt: T0, authAt: T0, rotatedAt: T0,
    expiresAt: at(180 * DAY), revokedAt: null, revokeReason: null, tokenHash: sha(`token:${n}:${i}:0`), previousHash: null, rotation: 0, device: null,
    proofFailures: 0, ...over,
  };
}

export function auditOf<K extends AuditKind>(n: number, kind: K, account: AccountId | null, details: AuditEvent<K>['details'], over: Partial<AuditEvent> = {}): AuditEvent {
  return { id: auditId(n), at: T0, kind, account, actor: 'self', actorOs: null, session: null, addressTag: null, details, ...over } as AuditEvent;
}

export function historyOf(n: number, name: string, key: string, from: string, cause: NameHistoryRow['cause'] = 'rename', keyVersion = 1): NameHistoryRow {
  return { account: accId(n), name, key, keyVersion, from, to: null, cause, redacted: false };
}

export function localSecret(n: number, generation = 0): string {
  return `$scrypt$ln=17,r=8,p=1$c2FsdA$${sha(`pw:${n}:${generation}`).slice(0, 43)}`;
}

/** A registration of account n: a local credential, 10 recovery codes, its first session and device proof, a `registered` event. */
export function newAccount(n: number, name: string, key: string, over: { account?: Partial<Account>; claim?: string; now?: string } = {}): NewAccount {
  const id = accId(n);
  const a = accountOf(n, name, key, over.account);
  return {
    account: a,
    credential: { account: id, provider: 'local', subject: id, secret: localSecret(n), meta: {}, createdAt: a.createdAt, lastUsedAt: null },
    recovery: Array.from({ length: 10 }, (_, slot) => ({ account: id, slot, hash: sha(`rc:${n}:${slot}:1`), generation: 1, createdAt: a.createdAt, usedAt: null })),
    history: historyOf(n, name, key, a.createdAt, 'register', a.keyVersion),
    claim: over.claim !== undefined ? { session: over.claim, account: id, claimedAt: a.createdAt } : null,
    session: sessionOf(n, 0, { createdAt: a.createdAt, lastUsedAt: a.createdAt, authAt: a.createdAt, rotatedAt: a.createdAt }),
    device: { hash: sha(`device:${n}:0`), account: id, createdAt: a.createdAt, lastUsedAt: a.createdAt, failures: 0 },
    audit: [auditOf(n * 1000, 'registered', id, { provider: 'local', claimed: over.claim !== undefined }, { at: a.createdAt })],
  };
}

export const renameOpts = (now: string, over: Partial<RenameOptions> = {}): RenameOptions => ({
  oldKind: 'held', holdUntil: new Date(Date.parse(now) + 60 * DAY).toISOString(), allow: [], now, ...over,
});

export function reportOf(n: number, reporter: ReportRow['reporter'], target: ReportRow['target'], targetName: string, over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: reportId(n), reporter, target, targetName, reason: 'chat', game: null, text: null, related: [], evidence: null, status: 'new', createdAt: T0,
    closedAt: null, closedBy: null, note: null, ...over,
  };
}

export function sanctionOf(n: number, account: AccountId, kind: SanctionRow['kind'], until: string | null, over: Partial<SanctionRow> = {}): SanctionRow {
  return {
    id: sanctionId(n), account, kind, reason: 'chat', message: 'Please keep the chat friendly.', note: 'internal', createdAt: T0, createdBy: 'op',
    reports: [], since: T0, until, endedAt: null, endReason: null, endedBy: null, seenAt: null, ...over,
  };
}

export function emailCodeOf(n: number, account: AccountId, purpose: EmailCodeRow['purpose'], createdAt = T0, over: Partial<EmailCodeRow> = {}): EmailCodeRow {
  return {
    id: emailCodeId(n), account, purpose, hash: sha(`email:${n}`), createdAt, expiresAt: new Date(Date.parse(createdAt) + 15 * MINUTE).toISOString(),
    usedAt: null, ...over,
  };
}

export function tombstoneOf(account: AccountId, deletedAt = T0, sanctionUntil: string | null = null): TombstoneRow {
  return { account, deletedAt, sanctionUntil, holdersDone: [] };
}

/** Puts account `id` into a claimed erasure (10.2 step 3), as the rights part does before any holder runs. */
export async function claimErasure(store: AccountStore, id: AccountId, now = T0): Promise<Account> {
  const a = (await store.account(id))!;
  const requested = await store.updateAccount(id, a.version, { deletion: { requestedAt: now, purgeAt: now, erasingAt: null, done: [] } });
  return store.updateAccount(id, requested.version, { deletion: { ...requested.deletion!, erasingAt: now } });
}

/** Rejects with an AccountStoreError of this code (and with nothing else). */
export async function refused(p: Promise<unknown>, code: StoreErrorCode): Promise<void> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e, `expected '${code}'`).toBeInstanceOf(AccountStoreError);
  expect((e as AccountStoreError).code).toBe(code);
}

function settledOne<T>(results: PromiseSettledResult<T>[], code: StoreErrorCode): { won: number; value: T } {
  const won = results.findIndex((r) => r.status === 'fulfilled');
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  for (const r of results) {
    if (r.status === 'rejected') {
      expect(r.reason).toBeInstanceOf(AccountStoreError);
      expect((r.reason as AccountStoreError).code).toBe(code);
    }
  }
  return { won, value: (results[won] as PromiseFulfilledResult<T>).value };
}

/** Lets the event loop run (I/O included): a reader that spins on microtasks alone would starve a file store's writes. */
const tick = () => new Promise<void>((r) => setImmediate(r));

// ---- the suite ---------------------------------------------------------------------------------------------------------------------------------

export function accountStoreContract(h: StoreHarness): void {
  describe(`M14-4 contract (${h.name})`, () => {
    let store: AccountStore;
    beforeEach(async () => {
      store = await h.open();
    });
    afterEach(async () => {
      await store.close();
    });

    // ---- accounts and names ----

    describe('accounts and names (6.5)', () => {
      it('has every method of ACCOUNT_STORE_METHODS', () => {
        for (const m of ACCOUNT_STORE_METHODS) expect(typeof (store as unknown as Record<string, unknown>)[m], m).toBe('function');
      });

      it('registers in one step and reads back exactly what it stored, canonical times included', async () => {
        const n = newAccount(1, 'Alice', 'allce', { account: { createdAt: '2026-10-21T12:00:00Z' } });
        await store.createAccount(n, T0);
        expect(await store.account(accId(1))).toEqual({ ...n.account, createdAt: T0 });
        expect(await store.accountByKey('allce', 1)).toEqual({ ...n.account, createdAt: T0 });
        expect(await store.accountByKey('allce', 2)).toBeNull();
        expect(await store.nameEntry('allce', 1)).toEqual({ key: 'allce', keyVersion: 1, kind: 'current', account: accId(1), until: null, note: null, createdAt: T0 });
        expect(await store.nameHistory(accId(1))).toEqual([{ ...n.history, from: T0 }]);
        expect(await store.credentialBySubject('local', accId(1))).toEqual({ ...n.credential, createdAt: T0 });
        expect((await store.recoveryCodes(accId(1))).map((r) => r.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(await store.sessionByTokenHash(n.session.tokenHash)).toEqual({ row: { ...n.session, createdAt: T0, lastUsedAt: T0, authAt: T0, rotatedAt: T0 }, match: 'current' });
        expect(await store.device(n.device.hash)).toEqual({ ...n.device, createdAt: T0, lastUsedAt: T0 });
        expect(await store.audit({ account: accId(1), limit: 10 })).toEqual(n.audit.map((e) => ({ ...e, at: T0 })));
        expect(await store.account(accId(2))).toBeNull();
        expect([...(await store.accounts([accId(1), accId(2)])).keys()]).toEqual([accId(1)]);
      });

      it('a new account has no deletion: a registration that brings one is refused (value) (INTERFACE CHANGE, M14-11)', async () => {
        const deleting = { account: { deletion: { requestedAt: T0, purgeAt: at(DAY), erasingAt: null, done: [] } } };
        await refused(store.createAccount(newAccount(1, 'Del', 'del', deleting), T0), 'value');
        expect(await store.account(accId(1))).toBeNull();
        expect(await store.nameEntry('del', 1)).toBeNull();
      });

      it('two registrations of one key at once: exactly one wins, and the other leaves nothing behind', async () => {
        const a = newAccount(1, 'Alice', 'allce');
        const b = newAccount(2, 'ALICE', 'allce');
        const { won } = settledOne(await Promise.allSettled([store.createAccount(a, T0), store.createAccount(b, T0)]), 'exists');
        const [winner, loser] = won === 0 ? [a, b] : [b, a];
        expect((await store.nameEntry('allce', 1))?.account).toBe(winner.account.id);
        expect(await store.account(loser.account.id)).toBeNull();
        expect(await store.sessionByTokenHash(loser.session.tokenHash)).toBeNull();
        expect(await store.credentialBySubject('local', loser.account.id)).toBeNull();
        expect(await store.device(loser.device.hash)).toBeNull();
        expect(await store.audit({ account: loser.account.id, limit: 10 })).toEqual([]);
      });

      it('refuses a registration whose id, credential, session, device or claim is taken', async () => {
        await store.createAccount(newAccount(1, 'Alice', 'allce', { claim: guestSession(1) }), T0);
        await refused(store.createAccount(newAccount(1, 'Bob', 'bob'), T0), 'exists');
        const sameSession = newAccount(2, 'Bob', 'bob');
        sameSession.session = { ...sameSession.session, tokenHash: sessionOf(1, 0).tokenHash };
        await refused(store.createAccount(sameSession, T0), 'exists');
        await refused(store.createAccount(newAccount(3, 'Carol', 'carol', { claim: guestSession(1) }), T0), 'exists');
        const sameDevice = newAccount(4, 'Dave', 'dave');
        sameDevice.device = { ...sameDevice.device, hash: sha('device:1:0') };
        await refused(store.createAccount(sameDevice, T0), 'exists');
        const foreign = newAccount(5, 'Erin', 'erln');
        foreign.credential = { ...foreign.credential, account: accId(6) };
        await refused(store.createAccount(foreign, T0), 'value');
        for (const n of [2, 3, 4, 5]) expect(await store.account(accId(n))).toBeNull();
        await store.createAccount(newAccount(2, 'Bob', 'bob'), T0);
      });

      it('rename racing a registration on one key: one wins, the other answers exists', async () => {
        await store.createAccount(newAccount(1, 'Bob', 'bob'), T0);
        const a = (await store.account(accId(1)))!;
        const t1 = at(DAY);
        const { won } = settledOne(
          await Promise.allSettled([
            store.rename(a.id, a.version, historyOf(1, 'Carol', 'carol', t1), renameOpts(t1)),
            store.createAccount(newAccount(2, 'Carol', 'carol', { account: { createdAt: t1 } }), t1),
          ]),
          'exists',
        );
        const entry = (await store.nameEntry('carol', 1))!;
        if (won === 0) {
          expect(entry.account).toBe(accId(1));
          expect(await store.account(accId(2))).toBeNull();
          expect((await store.nameEntry('bob', 1))?.kind).toBe('held');
        } else {
          expect(entry.account).toBe(accId(2));
          expect(await store.account(accId(1))).toEqual(a);
          expect((await store.nameEntry('bob', 1))?.kind).toBe('current');
        }
      });

      it('two renames on one key: one wins, the other answers exists and keeps its name', async () => {
        await store.createAccount(newAccount(1, 'Bob', 'bob'), T0);
        await store.createAccount(newAccount(2, 'Carol', 'carol'), T0);
        const a = (await store.account(accId(1)))!;
        const b = (await store.account(accId(2)))!;
        const t1 = at(DAY);
        const { won } = settledOne(
          await Promise.allSettled([
            store.rename(a.id, a.version, historyOf(1, 'Dave', 'dave', t1), renameOpts(t1)),
            store.rename(b.id, b.version, historyOf(2, 'DAVE', 'dave', t1), renameOpts(t1)),
          ]),
          'exists',
        );
        const [winner, loser] = won === 0 ? [a, b] : [b, a];
        expect((await store.nameEntry('dave', 1))?.account).toBe(winner.id);
        expect(await store.account(loser.id)).toEqual(loser);
        expect((await store.nameEntry(loser.nameKey, 1))?.kind).toBe('current');
        expect(await store.nameHistory(loser.id)).toHaveLength(1);
      });

      it('rename with a hold: the old key is held for the account, which alone can take it back with ownHeld', async () => {
        await store.createAccount(newAccount(1, 'Frank', 'frank'), T0);
        await store.createAccount(newAccount(2, 'Gina', 'glna'), T0);
        const t1 = at(DAY);
        const a0 = (await store.account(accId(1)))!;
        const a1 = await store.rename(accId(1), a0.version, historyOf(1, 'Franky', 'franky', t1), renameOpts(t1));
        expect(a1).toEqual({ ...a0, name: 'Franky', nameKey: 'franky', keyVersion: 1, renamedAt: t1, version: a0.version + 1 });
        expect(await store.account(accId(1))).toEqual(a1);
        expect(await store.nameEntry('frank', 1)).toEqual({ key: 'frank', keyVersion: 1, kind: 'held', account: accId(1), until: at(61 * DAY), note: null, createdAt: t1 });
        expect((await store.nameEntry('franky', 1))?.kind).toBe('current');
        expect(await store.nameHistory(accId(1))).toEqual([
          { ...historyOf(1, 'Frank', 'frank', T0, 'register'), to: t1 },
          historyOf(1, 'Franky', 'franky', t1),
        ]);
        const t2 = at(2 * DAY);
        await refused(store.createAccount(newAccount(3, 'Frank', 'frank', { account: { createdAt: t2 } }), t2), 'exists');
        const g = (await store.account(accId(2)))!;
        await refused(store.rename(g.id, g.version, historyOf(2, 'Frank', 'frank', t2), renameOpts(t2, { allow: ['ownHeld', 'reserved'] })), 'exists');
        await refused(store.rename(a1.id, a1.version, historyOf(1, 'Frank', 'frank', t2), renameOpts(t2)), 'exists');
        const back = await store.rename(a1.id, a1.version, historyOf(1, 'Frank', 'frank', t2), renameOpts(t2, { allow: ['ownHeld'] }));
        expect(back.nameKey).toBe('frank');
        expect((await store.nameEntry('frank', 1))?.kind).toBe('current');
        expect(await store.nameEntry('franky', 1)).toMatchObject({ kind: 'held', account: accId(1) });
        await refused(store.rename(back.id, back.version, historyOf(1, 'FRANK', 'frank', t2), renameOpts(t2, { allow: ['ownHeld'] })), 'exists');
      });

      it('rename with a ban: the old key is banned for everyone, the account itself included; the ban keeps its account until erase', async () => {
        await store.createAccount(newAccount(1, 'Rude', 'rude'), T0);
        const t1 = at(DAY);
        const a0 = (await store.account(accId(1)))!;
        const a1 = await store.rename(accId(1), a0.version, historyOf(1, 'Player 123456', 'player l23456', t1, 'forced'), renameOpts(t1, { oldKind: 'banned', holdUntil: null, allow: ['reserved'] }));
        // the account it was taken from (INTERFACE CHANGE, M14-15 review A6: sign-in still reaches the owner by the old name)
        expect(await store.nameEntry('rude', 1)).toEqual({ key: 'rude', keyVersion: 1, kind: 'banned', account: accId(1), until: null, note: null, createdAt: t1 });
        const t2 = at(400 * DAY);
        await refused(store.rename(a1.id, a1.version, historyOf(1, 'Rude', 'rude', t2), renameOpts(t2, { allow: ['ownHeld', 'reserved'] })), 'exists');
        await refused(store.createAccount(newAccount(2, 'Rude', 'rude', { account: { createdAt: t2 } }), t2), 'exists');
      });

      it('a reserved key: refused to registrations and renames, claimed by a rename that allows reserved', async () => {
        await store.putNameEntry({ key: 'openrntg', keyVersion: 1, kind: 'reserved', account: null, until: null, note: 'the project', createdAt: T0 });
        await refused(store.createAccount(newAccount(1, 'OpenMTG', 'openrntg'), T0), 'exists');
        await store.createAccount(newAccount(1, 'Owner', 'owner'), T0);
        const a = (await store.account(accId(1)))!;
        const t1 = at(HOUR);
        await refused(store.rename(a.id, a.version, historyOf(1, 'OpenMTG', 'openrntg', t1), renameOpts(t1, { allow: ['ownHeld'] })), 'exists');
        const b = await store.rename(a.id, a.version, historyOf(1, 'OpenMTG', 'openrntg', t1), renameOpts(t1, { allow: ['reserved'] }));
        expect(b.nameKey).toBe('openrntg');
        expect(await store.nameEntry('openrntg', 1)).toMatchObject({ kind: 'current', account: accId(1), until: null, note: null });
      });

      it('an expired hold is free: from its until on, to registrations and renames alike', async () => {
        await store.createAccount(newAccount(1, 'Hal', 'hal'), T0);
        await store.createAccount(newAccount(2, 'Ivy', 'lvy'), T0);
        const a = (await store.account(accId(1)))!;
        await store.rename(a.id, a.version, historyOf(1, 'Hank', 'hank', at(MINUTE)), renameOpts(at(MINUTE), { holdUntil: at(60 * DAY) }));
        const before = at(60 * DAY - 1);
        await refused(store.createAccount(newAccount(3, 'Hal', 'hal', { account: { createdAt: before } }), before), 'exists');
        const until = at(60 * DAY);
        await store.createAccount(newAccount(3, 'Hal', 'hal', { account: { createdAt: until } }), until);
        expect((await store.nameEntry('hal', 1))?.account).toBe(accId(3));
        const b = (await store.account(accId(1)))!;
        await store.rename(b.id, b.version, historyOf(1, 'Hugo', 'hugo', until), renameOpts(until, { holdUntil: at(61 * DAY) }));
        const later = at(61 * DAY);
        const ivy = (await store.account(accId(2)))!;
        const out = await store.rename(ivy.id, ivy.version, historyOf(2, 'Hank', 'hank', later), renameOpts(later));
        expect(out.nameKey).toBe('hank');
      });

      it('putNameEntry and deleteNameEntry refuse a current key; deleteNameEntry frees reserved, banned and held keys', async () => {
        await store.createAccount(newAccount(1, 'Jo', 'jo'), T0);
        const reserved = { key: 'jo', keyVersion: 1, kind: 'reserved' as const, account: null, until: null, note: null, createdAt: T0 };
        await refused(store.putNameEntry(reserved), 'conflict');
        expect((await store.nameEntry('jo', 1))?.kind).toBe('current');
        await refused(store.deleteNameEntry('jo', 1), 'conflict');
        await refused(store.putNameEntry({ ...reserved, key: 'x', kind: 'current' }), 'value');
        await refused(store.putNameEntry({ ...reserved, key: 'x', kind: 'held' }), 'value');
        await refused(store.putNameEntry({ ...reserved, key: 'x', account: accId(1) }), 'value');
        await store.putNameEntry({ ...reserved, key: 'staff' });
        await store.putNameEntry({ ...reserved, key: 'slur', kind: 'banned', note: 'forced rename' });
        const a = (await store.account(accId(1)))!;
        await store.rename(a.id, a.version, historyOf(1, 'Joe', 'joe', at(MINUTE)), renameOpts(at(MINUTE)));
        for (const k of ['staff', 'slur', 'jo']) {
          await store.deleteNameEntry(k, 1);
          expect(await store.nameEntry(k, 1)).toBeNull();
        }
        await refused(store.deleteNameEntry('nobody', 1), 'notFound');
        await store.createAccount(newAccount(2, 'Jo', 'jo'), T0);
      });

      it('putNameEntry puts a hold for nobody (with an end), over an account\'s hold too: nobody claims it until the end', async () => {
        await store.createAccount(newAccount(1, 'Jo', 'jo'), T0);
        const a = (await store.account(accId(1)))!;
        await store.rename(a.id, a.version, historyOf(1, 'Joe', 'joe', at(MINUTE)), renameOpts(at(MINUTE)));
        const held = (await store.nameEntry('jo', 1))!;
        expect(held).toMatchObject({ kind: 'held', account: accId(1), until: at(MINUTE + 60 * DAY) });
        const hold = { ...held, account: null };
        await refused(store.putNameEntry({ ...hold, until: null }), 'value');
        await refused(store.putNameEntry({ ...hold, account: accId(2) }), 'value');
        await store.putNameEntry(hold);
        expect(await store.nameEntry('jo', 1)).toEqual(hold);
        // the account's take-back and anyone's registration meet it until its end
        const b = (await store.account(accId(1)))!;
        await refused(store.rename(b.id, b.version, historyOf(1, 'Jo', 'jo', at(HOUR)), renameOpts(at(HOUR), { allow: ['ownHeld'] })), 'exists');
        await refused(store.createAccount(newAccount(2, 'Jo', 'jo'), at(DAY)), 'exists');
        await store.createAccount(newAccount(2, 'Jo', 'jo'), at(MINUTE + 60 * DAY));
        // a fresh key too, and never over a current one
        await store.putNameEntry({ ...hold, key: 'fresh' });
        expect((await store.nameEntry('fresh', 1))?.account).toBeNull();
        await refused(store.putNameEntry({ ...hold, key: 'joe' }), 'conflict');
      });

      it('version conflicts: a stale update or rename answers conflict and changes nothing; each write bumps the version', async () => {
        await store.createAccount(newAccount(1, 'Kim', 'klrn'), T0);
        const a = (await store.account(accId(1)))!;
        const b = await store.updateAccount(a.id, a.version, { avatar: 'd20-amber', lastSignInAt: at(MINUTE) });
        expect(b).toEqual({ ...a, avatar: 'd20-amber', lastSignInAt: at(MINUTE), version: a.version + 1 });
        await refused(store.updateAccount(a.id, a.version, { avatar: 'd4-white' }), 'conflict');
        await refused(store.rename(a.id, a.version, historyOf(1, 'Kip', 'klp', at(HOUR)), renameOpts(at(HOUR))), 'conflict');
        expect(await store.nameEntry('klp', 1)).toBeNull();
        expect(await store.account(a.id)).toEqual(b);
        await refused(store.updateAccount(accId(9), 1, { avatar: 'd4-white' }), 'notFound');
        await refused(store.updateAccount(a.id, b.version, { name: 'Sneaky' } as never), 'value');
        await refused(store.updateAccount(a.id, b.version, { avatar: 'not-an-avatar' } as never), 'value');
        const c = await store.updateAccount(a.id, b.version, { email: { address: 'kim@example.org', verifiedAt: null }, freeRename: true });
        expect(c.version).toBe(b.version + 1);
        expect(c.email).toEqual({ address: 'kim@example.org', verifiedAt: null });
        // when the address was set, kept as given (INTERFACE CHANGE, M14-15 review A5); a time it is not is refused
        const d = await store.updateAccount(a.id, c.version, { email: { address: 'kim@example.org', verifiedAt: at(HOUR), setAt: at(MINUTE) } });
        expect((await store.account(a.id))!.email).toEqual({ address: 'kim@example.org', verifiedAt: at(HOUR), setAt: at(MINUTE) });
        await refused(store.updateAccount(a.id, d.version, { email: { address: 'kim@example.org', verifiedAt: null, setAt: 'yesterday' } }), 'value');
      });

      it('rename refuses a name history row that does not start after the last one (conflict), and changes nothing', async () => {
        // name_history's key is (account_id, from_at) in PostgreSQL (11.5): every store keeps the rows' starts rising (review of M14-4)
        await store.createAccount(newAccount(1, 'Hal', 'hal'), T0);
        const a = (await store.account(accId(1)))!;
        await refused(store.rename(a.id, a.version, historyOf(1, 'Hank', 'hank', T0), renameOpts(T0)), 'conflict');
        await refused(store.rename(a.id, a.version, historyOf(1, 'Hank', 'hank', at(-MINUTE)), renameOpts(at(MINUTE))), 'conflict');
        expect(await store.account(a.id)).toEqual(a);
        expect(await store.nameEntry('hank', 1)).toBeNull();
        expect((await store.nameEntry('hal', 1))?.kind).toBe('current');
        expect(await store.nameHistory(a.id)).toHaveLength(1);
        // a taken key still answers exists first
        await store.createAccount(newAccount(2, 'Ivy', 'lvy'), T0);
        await refused(store.rename(a.id, a.version, historyOf(1, 'Ivy', 'lvy', T0), renameOpts(T0)), 'exists');
        const b = await store.rename(a.id, a.version, historyOf(1, 'Hank', 'hank', at(1)), renameOpts(at(1)));
        await refused(store.rename(b.id, b.version, historyOf(1, 'Hugo', 'hugo', at(1)), renameOpts(at(1))), 'conflict');
        expect((await store.nameHistory(a.id)).map((r) => [r.name, r.from, r.to])).toEqual([['Hal', T0, at(1)], ['Hank', at(1), null]]);
      });

      it('findAccounts by key prefix in key order, inactiveSince oldest first without pending deletions, accounts by ids', async () => {
        await store.createAccount(newAccount(1, 'Abby', 'abby'), T0);
        await store.createAccount(newAccount(2, 'Abe', 'abe', { account: { createdAt: at(DAY) } }), at(DAY));
        await store.createAccount(newAccount(3, 'Zed', 'zed', { account: { lastSignInAt: at(3 * DAY) } }), T0);
        await store.createAccount(newAccount(4, 'Abner', 'abner'), T0);
        expect((await store.findAccounts('ab', 10)).map((a) => a.nameKey)).toEqual(['abby', 'abe', 'abner']);
        expect((await store.findAccounts('ab', 2)).map((a) => a.nameKey)).toEqual(['abby', 'abe']);
        expect(await store.findAccounts('q', 10)).toEqual([]);
        await claimErasure(store, accId(4));
        expect((await store.inactiveSince(at(10 * DAY), 10)).map((a) => a.id)).toEqual([accId(1), accId(2), accId(3)]);
        expect((await store.inactiveSince(at(2 * DAY), 10)).map((a) => a.id)).toEqual([accId(1), accId(2)]);
        expect((await store.inactiveSince(at(10 * DAY), 1)).map((a) => a.id)).toEqual([accId(1)]);
        const map = await store.accounts([accId(3), accId(9), accId(1)]);
        expect([...map.keys()].sort()).toEqual([accId(1), accId(3)]);
      });

      it('inactiveSince pages on after a cursor (the last row\'s time and id), ties at one time by id (INTERFACE CHANGE, M14-7)', async () => {
        for (const n of [3, 1, 2]) await store.createAccount(newAccount(n, `Pat${n}`, `pat${n}`), T0);
        await store.createAccount(newAccount(4, 'Pia', 'pla', { account: { lastSignInAt: at(DAY) } }), T0);
        await store.createAccount(newAccount(5, 'Pim', 'plm', { account: { lastSignInAt: at(9 * DAY) } }), T0);
        const page = async (after?: { at: string; account: AccountId }) => (await store.inactiveSince(at(5 * DAY), 2, after)).map((a) => a.id);
        expect(await page()).toEqual([accId(1), accId(2)]);
        expect(await page({ at: T0, account: accId(2) })).toEqual([accId(3), accId(4)]);
        expect(await page({ at: at(DAY), account: accId(4) })).toEqual([]);
        // a cursor whose row is gone still places the page by its time and id
        expect(await page({ at: T0, account: accId(0) })).toEqual([accId(1), accId(2)]);
        expect(await page({ at: at(-1), account: accId(9) })).toEqual([accId(1), accId(2)]);
        await refused(store.inactiveSince(at(5 * DAY), 2, { at: 'later', account: accId(1) }), 'value');
        await refused(store.inactiveSince(at(5 * DAY), 2, { at: T0, account: 'acc/x' as AccountId }), 'value');
      });

      it('redactName marks the name history rows of a key', async () => {
        await store.createAccount(newAccount(1, 'Lou', 'lou'), T0);
        const a = (await store.account(accId(1)))!;
        await store.rename(a.id, a.version, historyOf(1, 'Lux', 'lux', at(DAY), 'forced'), renameOpts(at(DAY), { oldKind: 'banned', holdUntil: null }));
        await store.redactName(a.id, 'lou');
        expect((await store.nameHistory(a.id)).map((r) => [r.key, r.redacted])).toEqual([['lou', true], ['lux', false]]);
        await refused(store.redactName(accId(9), 'lou'), 'notFound');
      });
    });

    // ---- name data versions ----

    describe('name data versions (6.3)', () => {
      async function setup() {
        await store.createAccount(newAccount(1, 'Alice', 'allce'), T0);
        await store.createAccount(newAccount(2, 'Bob', 'bob'), T0);
        const b = (await store.account(accId(2)))!;
        await store.rename(b.id, b.version, historyOf(2, 'Bobby', 'bobby', at(DAY)), renameOpts(at(DAY)));
        await store.putNameEntry({ key: 'adrnln', keyVersion: 1, kind: 'reserved', account: null, until: null, note: null, createdAt: T0, name: 'Admin' });
        await store.putNameEntry({ key: 'badword', keyVersion: 1, kind: 'banned', account: null, until: null, note: null, createdAt: T0 });
      }
      const all = new Map([['adrnln', 'adrnln2'], ['allce', 'allce2'], ['badword', 'badword2'], ['bob', 'bob2'], ['bobby', 'bobby2']]);

      it('starts at version 1; nameEntries lists every entry in key order, paged by key', async () => {
        expect(await store.nameKeyVersion()).toBe(1);
        await setup();
        expect((await store.nameEntries(null, 100)).map((e) => e.key)).toEqual(['adrnln', 'allce', 'badword', 'bob', 'bobby']);
        expect((await store.nameEntries(null, 2)).map((e) => e.key)).toEqual(['adrnln', 'allce']);
        expect((await store.nameEntries('allce', 2)).map((e) => e.key)).toEqual(['badword', 'bob']);
        expect((await store.nameEntries('bobby', 2)).map((e) => e.key)).toEqual([]);
        // one key under two versions is never split across pages
        await store.putNameEntry({ key: 'allce', keyVersion: 2, kind: 'reserved', account: null, until: null, note: null, createdAt: T0 });
        expect((await store.nameEntries(null, 2)).map((e) => [e.key, e.keyVersion])).toEqual([['adrnln', 1], ['allce', 1], ['allce', 2]]);
      });

      it('rekey rewrites every key and the current version in one step', async () => {
        await setup();
        const before = (await store.account(accId(1)))!;
        await store.rekey(1, 2, all);
        expect(await store.nameKeyVersion()).toBe(2);
        expect((await store.nameEntries(null, 100)).map((e) => [e.key, e.keyVersion, e.kind])).toEqual([
          ['adrnln2', 2, 'reserved'], ['allce2', 2, 'current'], ['badword2', 2, 'banned'], ['bob2', 2, 'held'], ['bobby2', 2, 'current'],
        ]);
        expect(await store.nameEntry('allce', 1)).toBeNull();
        expect(await store.accountByKey('allce', 1)).toBeNull();
        expect(await store.accountByKey('allce2', 2)).toEqual({ ...before, nameKey: 'allce2', keyVersion: 2, version: before.version + 1 });
        expect((await store.nameEntry('bob2', 2))?.account).toBe(accId(2));
        // a reserved key keeps the name it was made from (INTERFACE CHANGE, M14-15 review A7)
        expect((await store.nameEntry('adrnln2', 2))?.name).toBe('Admin');
        expect((await store.nameHistory(accId(2))).map((r) => [r.key, r.keyVersion])).toEqual([['bob2', 2], ['bobby2', 2]]);
        await refused(store.createAccount(newAccount(3, 'ALICE', 'allce2', { account: { keyVersion: 2 } }), T0), 'exists');
      });

      it('a key made under the version a rekey replaced is refused (conflict), for a registration and a rename: no straggler is left under the old version (INTERFACE CHANGE, M14-11)', async () => {
        await setup();
        await store.rekey(1, 2, all);
        await refused(store.createAccount(newAccount(3, 'Cy', 'cy'), T0), 'conflict');
        expect(await store.account(accId(3))).toBeNull();
        expect(await store.nameEntry('cy', 1)).toBeNull();
        const b = (await store.account(accId(2)))!;
        await refused(store.rename(b.id, b.version, historyOf(2, 'Bobbo', 'bobbo', at(2 * DAY), 'rename', 1), renameOpts(at(2 * DAY))), 'conflict');
        expect(await store.nameEntry('bobbo', 1)).toBeNull();
        expect(await store.account(b.id)).toEqual(b);
        // under the current version both go through
        await store.createAccount(newAccount(3, 'Cy', 'cy2', { account: { keyVersion: 2 } }), T0);
        const c = await store.rename(b.id, b.version, historyOf(2, 'Bobbo', 'bobbo2', at(2 * DAY), 'rename', 2), renameOpts(at(2 * DAY)));
        expect([c.nameKey, c.keyVersion]).toEqual(['bobbo2', 2]);
      });

      it('rekey is refused on a collision, an incomplete map or a stale version, and then changes nothing', async () => {
        await setup();
        const snapshot = async () => ({ v: await store.nameKeyVersion(), e: await store.nameEntries(null, 100), a: await store.account(accId(1)) });
        const before = await snapshot();
        await refused(store.rekey(1, 2, new Map([...all, ['bob', 'same'], ['bobby', 'same']])), 'conflict');
        await refused(store.rekey(1, 2, new Map([...all].filter(([k]) => k !== 'badword'))), 'conflict');
        await refused(store.rekey(1, 2, new Map([...all].filter(([k]) => k !== 'allce'))), 'conflict');
        await refused(store.rekey(2, 3, all), 'conflict');
        await store.putNameEntry({ key: 'allce2', keyVersion: 2, kind: 'reserved', account: null, until: null, note: null, createdAt: T0 });
        await refused(store.rekey(1, 2, all), 'conflict');
        await store.deleteNameEntry('allce2', 2);
        await refused(store.rekey(1, 1, all), 'value');
        expect(await snapshot()).toEqual(before);
        await store.rekey(1, 2, all);
      });
    });

    // ---- credentials, recovery codes, devices ----

    describe('credentials, recovery codes and device proofs (4)', () => {
      beforeEach(async () => {
        await store.createAccount(newAccount(1, 'Mia', 'rnla'), T0);
        await store.createAccount(newAccount(2, 'Ned', 'ned'), T0);
      });

      it('a rehash racing a password change: exactly one compare-and-set wins; after the change the rehash fails', async () => {
        const c0 = (await store.credentialBySubject('local', accId(1)))!;
        const rehash: CredentialRow = { ...c0, secret: `${localSecret(1)}-rehashed` };
        const changed: CredentialRow = { ...c0, secret: localSecret(1, 1) };
        settledOne(await Promise.allSettled([store.putCredential(rehash, c0.secret), store.putCredential(changed, c0.secret)]), 'conflict');
        const c1 = (await store.credentialBySubject('local', accId(1)))!;
        expect([rehash.secret, changed.secret]).toContain(c1.secret);
        // the ordered case: the password change first, then the rehash of the old string
        const c2: CredentialRow = { ...c1, secret: localSecret(1, 2) };
        await store.putCredential(c2, c1.secret);
        await refused(store.putCredential({ ...c1, secret: `${c1.secret}-rehashed` }, c1.secret), 'conflict');
        expect((await store.credentialBySubject('local', accId(1)))?.secret).toBe(c2.secret);
      });

      it('putCredential without expectSecret is a same-account upsert; another account\'s subject answers exists', async () => {
        const c0 = (await store.credentialBySubject('local', accId(1)))!;
        await store.putCredential({ ...c0, lastUsedAt: at(MINUTE) });
        expect((await store.credentialBySubject('local', accId(1)))?.lastUsedAt).toBe(at(MINUTE));
        const shopify: CredentialRow = { account: accId(1), provider: 'shopify', subject: 'gid-42', secret: null, meta: { linked: true }, createdAt: T0, lastUsedAt: null };
        await store.putCredential(shopify);
        await refused(store.putCredential({ ...shopify, account: accId(2) }), 'exists');
        await refused(store.putCredential({ ...shopify, account: accId(2) }, null), 'exists');
        await store.putCredential({ ...shopify, lastUsedAt: at(HOUR) }, null);
        await refused(store.putCredential({ ...shopify, lastUsedAt: at(HOUR) }, 'something'), 'conflict');
        await refused(store.putCredential({ ...shopify, subject: 'gid-43' }, null), 'conflict');
        await refused(store.putCredential({ ...shopify, account: accId(9), subject: 'gid-44' }), 'notFound');
        await refused(store.putCredential({ ...shopify, subject: 'gid-45', meta: { nested: { x: 1 } } as never }), 'value');
        expect((await store.credentials(accId(1))).map((c) => c.provider)).toEqual(['local', 'shopify']);
        expect(await store.credentials(accId(2))).toHaveLength(1);
      });

      it('deleteCredential of the last credential answers conflict; another account\'s answers notFound', async () => {
        await refused(store.deleteCredential(accId(1), 'local', accId(1)), 'conflict');
        await refused(store.deleteCredential(accId(2), 'local', accId(1)), 'notFound');
        await store.putCredential({ account: accId(1), provider: 'shopify', subject: 'gid-1', secret: null, meta: {}, createdAt: T0, lastUsedAt: null });
        await store.deleteCredential(accId(1), 'local', accId(1));
        expect((await store.credentials(accId(1))).map((c) => c.provider)).toEqual(['shopify']);
        await refused(store.deleteCredential(accId(1), 'shopify', 'gid-1'), 'conflict');
      });

      it('spendRecoveryCode is true exactly once under concurrent calls, and false after the codes were replaced', async () => {
        const hash3 = sha('rc:1:3:1');
        const spent = await Promise.all([1, 2, 3].map(() => store.spendRecoveryCode(accId(1), 3, hash3, at(MINUTE))));
        expect(spent.filter(Boolean)).toHaveLength(1);
        expect((await store.recoveryCodes(accId(1)))[3]).toMatchObject({ slot: 3, usedAt: at(MINUTE) });
        expect(await store.spendRecoveryCode(accId(1), 4, sha('wrong'), at(MINUTE))).toBe(false);
        expect(await store.spendRecoveryCode(accId(1), 12, hash3, at(MINUTE))).toBe(false);
        expect(await store.spendRecoveryCode(accId(2), 3, hash3, at(MINUTE))).toBe(false);
        const fresh = Array.from({ length: 10 }, (_, slot) => ({ account: accId(1), slot, hash: sha(`rc:1:${slot}:2`), generation: 2, createdAt: at(HOUR), usedAt: null }));
        await store.replaceRecoveryCodes(accId(1), fresh);
        expect(await store.spendRecoveryCode(accId(1), 4, sha('rc:1:4:1'), at(2 * HOUR))).toBe(false);
        expect(await store.spendRecoveryCode(accId(1), 4, sha('rc:1:4:2'), at(2 * HOUR))).toBe(true);
        expect((await store.recoveryCodes(accId(1))).map((r) => r.generation)).toEqual(Array(10).fill(2));
        await refused(store.replaceRecoveryCodes(accId(1), [{ ...fresh[0]!, account: accId(2) }]), 'value');
        await refused(store.replaceRecoveryCodes(accId(1), [fresh[0]!, fresh[0]!]), 'value');
        await refused(store.replaceRecoveryCodes(accId(9), []), 'notFound');
      });

      it('device proofs: put, read, update, delete all but one; another account\'s hash answers exists', async () => {
        const d = { hash: sha('device:1:1'), account: accId(1), createdAt: at(HOUR), lastUsedAt: at(HOUR), failures: 0 };
        await store.putDevice(d);
        await refused(store.putDevice({ ...d, account: accId(2) }), 'exists');
        await store.updateDevice(d.hash, { failures: 3, lastUsedAt: at(2 * HOUR) });
        expect(await store.device(d.hash)).toEqual({ ...d, failures: 3, lastUsedAt: at(2 * HOUR) });
        await refused(store.updateDevice(sha('none'), { failures: 1 }), 'notFound');
        await refused(store.updateDevice(d.hash, { account: accId(2) } as never), 'value');
        expect(await store.deleteDevices(accId(1), d.hash)).toBe(1);
        expect(await store.device(sha('device:1:0'))).toBeNull();
        expect(await store.device(d.hash)).not.toBeNull();
        expect(await store.device(sha('device:2:0'))).not.toBeNull();
        expect(await store.deleteDevices(accId(1))).toBe(1);
      });

      it('devicesOf lists every device proof of the account, by createdAt and then hash, sessions or not (INTERFACE CHANGE, M14-7)', async () => {
        const d = (i: number, createdAt: string) => ({ hash: sha(`device:1:${i}`), account: accId(1), createdAt, lastUsedAt: at(DAY), failures: i });
        for (const row of [d(1, at(HOUR)), d(2, T0), d(3, at(-HOUR))]) await store.putDevice(row);
        const byHash = [sha('device:1:0'), sha('device:1:2')].sort();
        expect((await store.devicesOf(accId(1))).map((x) => x.hash)).toEqual([sha('device:1:3'), ...byHash, sha('device:1:1')]);
        expect(await store.devicesOf(accId(2))).toEqual([{ hash: sha('device:2:0'), account: accId(2), createdAt: T0, lastUsedAt: T0, failures: 0 }]);
        expect(await store.devicesOf(accId(9))).toEqual([]);
        await refused(store.devicesOf('acc_\u0000' as AccountId), 'value');
      });
    });

    // ---- sessions ----

    describe('sessions (5.2)', () => {
      beforeEach(async () => {
        await store.createAccount(newAccount(1, 'Oli', 'oll'), T0);
        await store.createAccount(newAccount(2, 'Pat', 'pat'), T0);
      });
      const s = sessionOf(1, 0);
      const h = (i: number) => sha(`token:1:0:${i}`);

      it('rotateSession: a compare-and-set on the current hash; the previous hash is found as previous', async () => {
        const t1 = at(DAY);
        expect(await store.rotateSession(s.id, s.tokenHash, h(1), t1)).toBe(1);
        const row = (await store.sessionByTokenHash(h(1)))!;
        expect(row).toEqual({ row: { ...s, tokenHash: h(1), previousHash: s.tokenHash, rotatedAt: t1, rotation: 1 }, match: 'current' });
        expect(await store.sessionByTokenHash(s.tokenHash)).toEqual({ row: row.row, match: 'previous' });
        expect(await store.sessionByTokenHash(sha('unknown'))).toBeNull();
        expect(await store.rotateSession(s.id, s.tokenHash, h(2), t1)).toBeNull();
        expect(await store.rotateSession(sessionId(999), h(1), h(2), t1)).toBeNull();
        await refused(store.rotateSession(s.id, h(1), sessionOf(2, 0).tokenHash, t1), 'exists');
        const both = await Promise.all([store.rotateSession(s.id, h(1), h(3), at(2 * DAY)), store.rotateSession(s.id, h(1), h(4), at(2 * DAY))]);
        expect(both.filter((x) => x !== null)).toEqual([2]);
      });

      it('a rotation onto a hash the session itself holds, its previous or its current one, answers exists like one onto another session\'s (M14-11)', async () => {
        const t1 = at(DAY);
        await store.rotateSession(s.id, s.tokenHash, h(1), t1);
        await refused(store.rotateSession(s.id, h(1), s.tokenHash, at(2 * DAY)), 'exists');
        await refused(store.rotateSession(s.id, h(1), h(1), at(2 * DAY)), 'exists');
        await refused(store.rerotateInGrace(s.id, s.tokenHash, h(1)), 'exists');
        await refused(store.rerotateInGrace(s.id, s.tokenHash, s.tokenHash), 'exists');
        expect((await store.sessionByTokenHash(h(1)))?.row).toMatchObject({ tokenHash: h(1), previousHash: s.tokenHash, rotation: 1 });
      });

      it('rerotateInGrace: a compare-and-set on the previous hash; previousHash and rotatedAt stay, the counter rises', async () => {
        const t1 = at(DAY);
        await store.rotateSession(s.id, s.tokenHash, h(1), t1);
        // two tabs sent T0: the second gets T2 inside the grace, and a third tab with T0 gets T3; T1 is just unknown afterwards
        expect(await store.rerotateInGrace(s.id, s.tokenHash, h(2))).toBe(2);
        expect((await store.sessionByTokenHash(h(2)))?.row).toEqual({ ...s, tokenHash: h(2), previousHash: s.tokenHash, rotatedAt: t1, rotation: 2 });
        expect(await store.sessionByTokenHash(h(1))).toBeNull();
        expect(await store.rerotateInGrace(s.id, s.tokenHash, h(3))).toBe(3);
        expect(await store.rerotateInGrace(s.id, h(1), h(4))).toBeNull();
        expect(await store.rerotateInGrace(s.id, h(3), h(4))).toBeNull();
        const fresh = sessionOf(1, 1);
        await store.putSession(fresh);
        expect(await store.rerotateInGrace(fresh.id, fresh.tokenHash, h(5))).toBeNull();
        await store.revokeSession(accId(1), s.id, 'signOut', at(2 * DAY));
        expect(await store.rerotateInGrace(s.id, s.tokenHash, h(6))).toBeNull();
        expect(await store.rotateSession(s.id, h(3), h(6), at(2 * DAY))).toBeNull();
      });

      it('revokeSession of another account\'s session answers notFound and leaves it live; the first revocation is kept', async () => {
        await refused(store.revokeSession(accId(2), s.id, 'revoked', at(MINUTE)), 'notFound');
        expect((await store.sessionByTokenHash(s.tokenHash))?.row.revokedAt).toBeNull();
        await refused(store.revokeSession(accId(1), sessionId(999), 'revoked', at(MINUTE)), 'notFound');
        await store.revokeSession(accId(1), s.id, 'signOut', at(MINUTE));
        await store.revokeSession(accId(1), s.id, 'admin', at(HOUR));
        expect((await store.sessionByTokenHash(s.tokenHash))?.row).toMatchObject({ revokedAt: at(MINUTE), revokeReason: 'signOut' });
      });

      it('revokeSessions revokes every live session but one, of that account only', async () => {
        const b = sessionOf(1, 1);
        const c = sessionOf(1, 2, { createdAt: at(MINUTE) });
        await store.putSession(b);
        await store.putSession(c);
        expect(await store.revokeSessions(accId(1), 'passwordChanged', at(HOUR), b.id)).toEqual([s.id, c.id].sort());
        const rows = await store.sessionsOf(accId(1));
        expect(rows.map((r) => [r.id, r.revokedAt, r.revokeReason])).toEqual([
          [s.id, at(HOUR), 'passwordChanged'], [b.id, null, null], [c.id, at(HOUR), 'passwordChanged'],
        ]);
        expect((await store.sessionsOf(accId(2)))[0]?.revokedAt).toBeNull();
        expect(await store.revokeSessions(accId(1), 'signOutEverywhere', at(2 * HOUR))).toEqual([b.id]);
      });

      it('putSession refuses another session\'s token hash or id; updateSession changes only its fields', async () => {
        await refused(store.putSession({ ...sessionOf(1, 1), tokenHash: sessionOf(2, 0).tokenHash }), 'exists');
        await refused(store.putSession({ ...sessionOf(2, 5), id: s.id }), 'exists');
        await refused(store.putSession(sessionOf(9, 0)), 'notFound');
        await store.updateSession(s.id, { lastUsedAt: at(HOUR), authAt: at(HOUR), proofFailures: 2 });
        expect((await store.sessionsOf(accId(1)))[0]).toEqual({ ...s, lastUsedAt: at(HOUR), authAt: at(HOUR), proofFailures: 2 });
        await refused(store.updateSession(s.id, { tokenHash: sha('x') } as never), 'value');
        await refused(store.updateSession(sessionId(999), { proofFailures: 1 }), 'notFound');
      });
    });

    // ---- claims and relations ----

    describe('guest claims (5.5) and relations (9.1)', () => {
      beforeEach(async () => {
        await store.createAccount(newAccount(1, 'Quinn', 'qulnn'), T0);
        await store.createAccount(newAccount(2, 'Rae', 'rae'), T0);
        await store.createAccount(newAccount(3, 'Sam', 'sarn'), T0);
      });

      it('one claim per guest session', async () => {
        await store.claimGuest({ session: guestSession(1), account: accId(1), claimedAt: at(DAY) });
        await refused(store.claimGuest({ session: guestSession(1), account: accId(2), claimedAt: at(DAY) }), 'exists');
        await refused(store.claimGuest({ session: guestSession(1), account: accId(1), claimedAt: at(DAY) }), 'exists');
        await store.claimGuest({ session: guestSession(2), account: accId(1), claimedAt: at(HOUR) });
        await refused(store.claimGuest({ session: guestSession(3), account: accId(9), claimedAt: at(DAY) }), 'notFound');
        expect(await store.claimsOf(accId(1))).toEqual([
          { session: guestSession(2), account: accId(1), claimedAt: at(HOUR) },
          { session: guestSession(1), account: accId(1), claimedAt: at(DAY) },
        ]);
        expect(await store.claimsOf(accId(2))).toEqual([]);
      });

      it('relations in both directions: each account lists its own, relationsAmong finds both', async () => {
        await store.setRelation({ account: accId(1), other: accId(2), kind: 'block', createdAt: T0 });
        await store.setRelation({ account: accId(2), other: accId(1), kind: 'mute', createdAt: at(MINUTE) });
        await store.setRelation({ account: accId(1), other: accId(3), kind: 'mute', createdAt: at(HOUR) });
        expect((await store.relationsOf(accId(1))).map((r) => [r.other, r.kind])).toEqual([[accId(2), 'block'], [accId(3), 'mute']]);
        expect((await store.relationsOf(accId(2))).map((r) => [r.other, r.kind])).toEqual([[accId(1), 'mute']]);
        expect((await store.relationsAmong([accId(1), accId(2)])).map((r) => [r.account, r.other, r.kind])).toEqual([
          [accId(1), accId(2), 'block'], [accId(2), accId(1), 'mute'],
        ]);
        expect(await store.relationsAmong([accId(2), accId(3)])).toEqual([]);
        await store.deleteRelation(accId(1), accId(2), 'block');
        await store.deleteRelation(accId(1), accId(2), 'block');
        expect((await store.relationsOf(accId(1))).map((r) => r.other)).toEqual([accId(3)]);
        await refused(store.setRelation({ account: accId(1), other: accId(1), kind: 'block', createdAt: T0 }), 'value');
        await refused(store.setRelation({ account: accId(9), other: accId(1), kind: 'block', createdAt: T0 }), 'notFound');
      });

      it('a relation to an id with no account is dropped, not refused (INTERFACE CHANGE, M14-15 review A2)', async () => {
        await store.setRelation({ account: accId(1), other: accId(9), kind: 'block', createdAt: T0 });
        expect(await store.relationsOf(accId(1))).toEqual([]);
        // an entry already there is replaced
        await store.setRelation({ account: accId(1), other: accId(2), kind: 'block', createdAt: T0 });
        await store.setRelation({ account: accId(1), other: accId(2), kind: 'block', createdAt: at(DAY) });
        expect(await store.relationsOf(accId(1))).toEqual([{ account: accId(1), other: accId(2), kind: 'block', createdAt: at(DAY) }]);
      });
    });

    // ---- email codes ----

    describe('email codes (3.4)', () => {
      beforeEach(async () => {
        await store.createAccount(newAccount(1, 'Tess', 'tess'), T0);
      });

      it('three live codes of a purpose, a fourth answers conflict until one is used or expires', async () => {
        for (const n of [1, 2, 3]) await store.putEmailCode(emailCodeOf(n, accId(1), 'reset', at(n * MINUTE)), at(n * MINUTE));
        await refused(store.putEmailCode(emailCodeOf(4, accId(1), 'reset', at(4 * MINUTE)), at(4 * MINUTE)), 'conflict');
        await store.putEmailCode(emailCodeOf(5, accId(1), 'verify', at(4 * MINUTE)), at(4 * MINUTE));
        expect((await store.liveEmailCodes(accId(1), 'reset', at(4 * MINUTE))).map((c) => c.id)).toEqual([1, 2, 3].map(emailCodeId));
        // code 1 expires at 16 minutes
        await store.putEmailCode(emailCodeOf(4, accId(1), 'reset', at(16 * MINUTE)), at(16 * MINUTE));
        expect((await store.liveEmailCodes(accId(1), 'reset', at(16 * MINUTE))).map((c) => c.id)).toEqual([2, 3, 4].map(emailCodeId));
        await refused(store.putEmailCode(emailCodeOf(4, accId(1), 'reset', at(17 * MINUTE)), at(17 * MINUTE)), 'exists');
        await refused(store.putEmailCode(emailCodeOf(6, accId(9), 'reset'), T0), 'notFound');
      });

      it('the cap is the configured emailResetLiveCodes: five live codes of a purpose with 5, none with 0', async () => {
        // the configuration may override the limit (ACCOUNTS_EMAIL_RESET_LIVE_CODES, 11.7): the store keeps the same cap as the service (review of M14-4)
        const five = await h.open({ emailResetLiveCodes: 5 });
        try {
          await five.createAccount(newAccount(1, 'Tess', 'tess'), T0);
          for (const n of [1, 2, 3, 4, 5]) await five.putEmailCode(emailCodeOf(n, accId(1), 'reset', at(n * MINUTE)), at(n * MINUTE));
          await refused(five.putEmailCode(emailCodeOf(6, accId(1), 'reset', at(6 * MINUTE)), at(6 * MINUTE)), 'conflict');
          await five.putEmailCode(emailCodeOf(7, accId(1), 'verify', at(6 * MINUTE)), at(6 * MINUTE));
          expect(await five.liveEmailCodes(accId(1), 'reset', at(6 * MINUTE))).toHaveLength(5);
        } finally {
          await five.close();
        }
        const none = await h.open({ emailResetLiveCodes: 0 });
        try {
          await none.createAccount(newAccount(1, 'Tess', 'tess'), T0);
          await refused(none.putEmailCode(emailCodeOf(1, accId(1), 'verify'), T0), 'conflict');
        } finally {
          await none.close();
        }
      });

      it('useEmailCode is true exactly once, never after the expiry; deleteEmailCodes by purpose', async () => {
        await store.putEmailCode(emailCodeOf(1, accId(1), 'reset'), T0);
        await store.putEmailCode(emailCodeOf(2, accId(1), 'reset'), T0);
        await store.putEmailCode(emailCodeOf(3, accId(1), 'verify'), T0);
        const used = await Promise.all([store.useEmailCode(emailCodeId(1), at(MINUTE)), store.useEmailCode(emailCodeId(1), at(MINUTE))]);
        expect(used.filter(Boolean)).toHaveLength(1);
        expect(await store.useEmailCode(emailCodeId(1), at(2 * MINUTE))).toBe(false);
        expect(await store.useEmailCode(emailCodeId(2), at(15 * MINUTE))).toBe(false);
        expect(await store.useEmailCode(emailCodeId(9), at(MINUTE))).toBe(false);
        expect((await store.liveEmailCodes(accId(1), 'reset', at(MINUTE))).map((c) => c.id)).toEqual([emailCodeId(2)]);
        await store.deleteEmailCodes(accId(1), 'reset');
        expect(await store.liveEmailCodes(accId(1), 'reset', T0)).toEqual([]);
        expect(await store.liveEmailCodes(accId(1), 'verify', T0)).toHaveLength(1);
      });
    });

    // ---- moderation ----

    describe('reports, sanctions and appeals (9)', () => {
      beforeEach(async () => {
        await store.createAccount(newAccount(1, 'Uma', 'urna'), T0);
        await store.createAccount(newAccount(2, 'Vic', 'vlc'), T0);
      });

      it('reports: kept as given, queried by status, target and reporter in id order, closed once', async () => {
        const r1 = reportOf(1, { kind: 'account', account: accId(1) }, { account: accId(2) }, 'Vic', { text: 'rude in chat', game: 'g_1' });
        const r2 = reportOf(2, { kind: 'guest', session: guestSession(7) }, { account: accId(1) }, 'Uma', { reason: 'name' });
        const r3 = reportOf(3, { kind: 'system', source: 'ladder' }, { guestSession: guestSession(8) }, 'Wolf (guest)', {
          reason: 'collusion', related: [accId(1), accId(2)], evidence: { games: ['g_2', 'g_3'], stats: { wins: 9, share: 0.9 } },
        });
        for (const r of [r3, r1, r2]) await store.putReport(r);
        await refused(store.putReport(r1), 'exists');
        expect(await store.report(reportId(3))).toEqual(r3);
        expect(await store.report(reportId(9))).toBeNull();
        expect((await store.reports({ limit: 10 })).map((r) => r.id)).toEqual([1, 2, 3].map(reportId));
        expect((await store.reports({ limit: 10, target: accId(1) })).map((r) => r.id)).toEqual([reportId(2)]);
        expect((await store.reports({ limit: 10, reporter: accId(1) })).map((r) => r.id)).toEqual([reportId(1)]);
        expect((await store.reports({ limit: 1, after: reportId(1) })).map((r) => r.id)).toEqual([reportId(2)]);
        await store.closeReport(reportId(1), 'actioned', 'op', at(DAY), 'warned');
        await refused(store.closeReport(reportId(1), 'dismissed', 'op', at(DAY), null), 'conflict');
        await refused(store.closeReport(reportId(9), 'dismissed', 'op', at(DAY), null), 'notFound');
        await refused(store.closeReport(reportId(2), 'new' as never, 'op', at(DAY), null), 'value');
        // related accounts and evidence come only from a system reporter (9.2)
        await refused(store.putReport(reportOf(4, { kind: 'account', account: accId(1) }, { account: accId(2) }, 'Vic', { related: [accId(1)] })), 'value');
        await refused(store.putReport(reportOf(4, { kind: 'guest', session: guestSession(7) }, { account: accId(2) }, 'Vic', { evidence: { games: [], stats: {} } })), 'value');
        expect(await store.report(reportId(4))).toBeNull();
        expect(await store.report(reportId(1))).toEqual({ ...r1, status: 'actioned', closedAt: at(DAY), closedBy: 'op', note: 'warned' });
        expect((await store.reports({ limit: 10, status: 'new' })).map((r) => r.id)).toEqual([reportId(2), reportId(3)]);
      });

      it('a report about an account that has none is dropped, not refused (INTERFACE CHANGE, M14-15 review A2)', async () => {
        await store.putReport(reportOf(1, { kind: 'account', account: accId(1) }, { account: accId(9) }, 'Nobody'));
        expect(await store.report(reportId(1))).toBeNull();
        expect(await store.reports({ limit: 10 })).toEqual([]);
        // a guest target has no account to look for
        await store.putReport(reportOf(2, { kind: 'account', account: accId(1) }, { guestSession: guestSession(7) }, 'Gus (guest)'));
        expect((await store.reports({ limit: 10 })).map((r) => r.id)).toEqual([reportId(2)]);
      });

      it('reports by guestSession: those filed by that guest session and those about it, in id order (INTERFACE CHANGE, M14-7)', async () => {
        await store.putReport(reportOf(1, { kind: 'guest', session: guestSession(7) }, { account: accId(1) }, 'Uma'));
        await store.putReport(reportOf(2, { kind: 'account', account: accId(2) }, { guestSession: guestSession(7) }, 'Gus (guest)'));
        await store.putReport(reportOf(3, { kind: 'guest', session: guestSession(8) }, { guestSession: guestSession(9) }, 'Hal (guest)'));
        await store.putReport(reportOf(4, { kind: 'account', account: accId(1) }, { account: accId(2) }, 'Vic', { status: 'dismissed', closedAt: T0 }));
        await store.putReport(reportOf(5, { kind: 'system', source: 'ladder' }, { guestSession: guestSession(7) }, 'Gus (guest)', {
          status: 'actioned', closedAt: T0,
        }));
        const ids = async (q: Omit<ReportQuery, 'limit'>, limit = 10) => (await store.reports({ ...q, limit })).map((r) => r.id);
        expect(await ids({ guestSession: guestSession(7) })).toEqual([1, 2, 5].map(reportId));
        expect(await ids({ guestSession: guestSession(7) }, 2)).toEqual([1, 2].map(reportId));
        expect(await ids({ guestSession: guestSession(7), after: reportId(2) })).toEqual([reportId(5)]);
        expect(await ids({ guestSession: guestSession(7), status: 'new' })).toEqual([1, 2].map(reportId));
        expect(await ids({ guestSession: guestSession(9) })).toEqual([reportId(3)]);
        expect(await ids({ guestSession: guestSession(6) })).toEqual([]);
        // with the account fields, both hold
        expect(await ids({ guestSession: guestSession(7), target: accId(1) })).toEqual([reportId(1)]);
        await refused(store.reports({ guestSession: 'gs_\u0000', limit: 10 }), 'value');
      });

      it('endSanction records the end once; sanctionsEndingBy returns only sanctions not ended', async () => {
        await store.putSanction(sanctionOf(1, accId(1), 'mute', at(DAY)));
        await store.putSanction(sanctionOf(2, accId(1), 'suspend', at(2 * DAY)));
        await store.putSanction(sanctionOf(3, accId(1), 'ban', null));
        await store.putSanction(sanctionOf(4, accId(2), 'mute', at(3 * DAY)));
        await refused(store.putSanction(sanctionOf(1, accId(1), 'warn', null)), 'exists');
        await refused(store.putSanction(sanctionOf(5, accId(9), 'warn', null)), 'notFound');
        await store.endSanction(sanctionId(2), at(HOUR), 'lifted', 'op');
        await refused(store.endSanction(sanctionId(2), at(2 * HOUR), 'expired', 'system'), 'conflict');
        await refused(store.endSanction(sanctionId(9), at(2 * HOUR), 'expired', 'system'), 'notFound');
        expect((await store.sanctionsOf(accId(1))).find((x) => x.id === sanctionId(2))).toMatchObject({ endedAt: at(HOUR), endReason: 'lifted', endedBy: 'op' });
        expect((await store.sanctionsEndingBy(at(4 * DAY), 10)).map((x) => x.id)).toEqual([sanctionId(1), sanctionId(4)]);
        expect((await store.sanctionsEndingBy(at(4 * DAY), 1)).map((x) => x.id)).toEqual([sanctionId(1)]);
        expect(await store.sanctionsEndingBy(at(12 * HOUR), 10)).toEqual([]);
        await store.endSanction(sanctionId(1), at(DAY), 'expired', 'system');
        expect((await store.sanctionsEndingBy(at(4 * DAY), 10)).map((x) => x.id)).toEqual([sanctionId(4)]);
        const running = await store.runningSanctions([accId(1), accId(2)], at(12 * HOUR));
        expect(running.get(accId(1))?.map((x) => x.id)).toEqual([sanctionId(1), sanctionId(3)]);
        expect(running.get(accId(2))?.map((x) => x.id)).toEqual([sanctionId(4)]);
        expect((await store.runningSanctions([accId(1), accId(2)], at(5 * DAY))).get(accId(2))).toBeUndefined();
      });

      it('sanction(id) reads one sanction by its id, running or ended, whoever\'s; null for an id with none', async () => {
        const mute = sanctionOf(1, accId(1), 'mute', at(DAY));
        const warn = sanctionOf(2, accId(2), 'warn', null, { note: null });
        await store.putSanction(mute);
        await store.putSanction(warn);
        expect(await store.sanction(sanctionId(1))).toEqual(mute);
        expect(await store.sanction(sanctionId(2))).toEqual(warn);
        await store.endSanction(sanctionId(1), at(HOUR), 'lifted', 'op');
        expect(await store.sanction(sanctionId(1))).toEqual({ ...mute, endedAt: at(HOUR), endReason: 'lifted', endedBy: 'op' });
        expect(await store.sanction(sanctionId(9))).toBeNull();
        await refused(store.sanction(42 as never), 'value');
      });

      it('markSeen and putAppeal touch only the account\'s own sanctions; one appeal per sanction, answered once', async () => {
        await store.putSanction(sanctionOf(1, accId(1), 'warn', null));
        await refused(store.markSeen(accId(2), sanctionId(1), at(MINUTE)), 'notFound');
        await refused(store.markSeen(accId(1), sanctionId(9), at(MINUTE)), 'notFound');
        await store.markSeen(accId(1), sanctionId(1), at(MINUTE));
        await store.markSeen(accId(1), sanctionId(1), at(HOUR));
        expect((await store.sanctionsOf(accId(1)))[0]?.seenAt).toBe(at(MINUTE));
        const appeal: AppealRow = { sanction: sanctionId(1), account: accId(2), text: 'Not me.', createdAt: at(HOUR), answer: null, answerMessage: null, answeredAt: null, answeredBy: null };
        await refused(store.putAppeal(appeal), 'notFound');
        expect(await store.appeals({ limit: 10 })).toEqual([]);
        await store.putAppeal({ ...appeal, account: accId(1), text: 'It was a joke.' });
        await refused(store.putAppeal({ ...appeal, account: accId(1) }), 'exists');
        expect((await store.appeals({ open: true, limit: 10 })).map((a) => a.text)).toEqual(['It was a joke.']);
        await store.answerAppeal(sanctionId(1), 'upheld', 'It stands.', 'op', at(DAY));
        await refused(store.answerAppeal(sanctionId(1), 'lifted', 'Changed my mind.', 'op', at(DAY)), 'conflict');
        await refused(store.answerAppeal(sanctionId(9), 'lifted', 'x', 'op', at(DAY)), 'notFound');
        expect(await store.appeals({ open: true, limit: 10 })).toEqual([]);
        expect(await store.appeals({ open: false, account: accId(1), limit: 10 })).toEqual([
          { ...appeal, account: accId(1), text: 'It was a joke.', answer: 'upheld', answerMessage: 'It stands.', answeredAt: at(DAY), answeredBy: 'op' },
        ]);
      });

      it('appeals page oldest first (createdAt, then the sanction id) from `after`, a sanction\'s appeal; none after a sanction with no appeal', async () => {
        // sanctions 1-4; appeals made at HOUR (4, then 2: one millisecond, the ids decide), 2 * HOUR (1) and 3 * HOUR (3)
        for (const n of [1, 2, 3, 4]) await store.putSanction(sanctionOf(n, accId(n % 2 === 0 ? 2 : 1), 'warn', null));
        const appealOf = (n: number, createdAt: string): AppealRow => ({
          sanction: sanctionId(n), account: accId(n % 2 === 0 ? 2 : 1), text: `appeal ${n}`, createdAt, answer: null, answerMessage: null, answeredAt: null,
          answeredBy: null,
        });
        for (const [n, t] of [[1, 2 * HOUR], [3, 3 * HOUR], [4, HOUR], [2, HOUR]] as const) await store.putAppeal(appealOf(n, at(t)));
        const ids = async (q: Parameters<AccountStore['appeals']>[0]) => (await store.appeals(q)).map((a) => a.sanction);
        expect(await ids({ limit: 10 })).toEqual([2, 4, 1, 3].map(sanctionId));
        expect(await ids({ limit: 2 })).toEqual([2, 4].map(sanctionId));
        expect(await ids({ limit: 2, after: sanctionId(4) })).toEqual([1, 3].map(sanctionId));
        expect(await ids({ limit: 10, after: sanctionId(2) })).toEqual([4, 1, 3].map(sanctionId));
        expect(await ids({ limit: 10, after: sanctionId(3) })).toEqual([]);
        expect(await ids({ limit: 10, account: accId(2), after: sanctionId(2) })).toEqual([sanctionId(4)]);
        await store.answerAppeal(sanctionId(1), 'upheld', 'It stands.', 'op', at(DAY));
        expect(await ids({ open: true, limit: 10, after: sanctionId(4) })).toEqual([sanctionId(3)]);
        // a sanction with no appeal, or none at all: nothing after it
        expect(await ids({ limit: 10, after: sanctionId(9) })).toEqual([]);
        await refused(store.appeals({ limit: 10, after: 42 as never }), 'value');
      });
    });

    // ---- the audit log and the change feed ----

    describe('the audit log and the change feed (8.5, 9.7)', () => {
      it('the audit log is append-only: an id is never replaced, a batch goes in whole or not at all', async () => {
        const e1 = auditOf(1, 'signedIn', accId(1), { provider: 'local', device: false, restricted: false }, { at: at(MINUTE) });
        const e2 = auditOf(2, 'signInFailed', null, { count: 1, nameTag: 'tag' }, { at: at(HOUR), addressTag: 'addr' });
        const e3 = auditOf(3, 'adminViewed', accId(1), { what: 'show' }, { at: at(DAY), actor: 'admin:op', actorOs: 'root' });
        await store.appendAudit([e1, e2]);
        await refused(store.appendAudit([{ ...e1, details: { provider: 'local', device: true, restricted: false } }]), 'exists');
        await refused(store.appendAudit([e3, e3]), 'exists');
        await refused(store.appendAudit([e3, e2]), 'exists');
        expect(await store.audit({ limit: 10 })).toEqual([e1, e2]);
        await store.appendAudit([e3]);
        expect(await store.audit({ account: accId(1), limit: 10 })).toEqual([e1, e3]);
        expect(await store.audit({ kinds: ['signInFailed', 'adminViewed'], limit: 10 })).toEqual([e2, e3]);
        expect(await store.audit({ since: at(HOUR), before: at(DAY), limit: 10 })).toEqual([e2]);
        expect(await store.audit({ limit: 1 })).toEqual([e1]);
        expect(ACCOUNT_STORE_METHODS.filter((m) => /audit/i.test(m))).toEqual(['appendAudit', 'audit']);
      });

      it('the change feed with two writers interleaved: a reader never sees seq n + 1 before n; changesHead', async () => {
        expect(await store.changesHead()).toBe(0);
        const writer = async (account: AccountId, kind: AccountChange['kind'], n: number) => {
          for (let i = 0; i < n; i++) await store.appendChange({ at: at(i * MINUTE), account, kind });
        };
        let seen = 0;
        let done = false;
        const order: number[] = [];
        const reader = (async () => {
          while (!done || seen < 40) {
            const page = await store.changes(seen, 7);
            page.forEach((c, i) => expect(c.seq).toBe(seen + 1 + i));
            for (const c of page) order.push(c.seq);
            seen = page.length > 0 ? page[page.length - 1]!.seq : seen;
            await tick();
          }
        })();
        await Promise.all([writer(accId(1), 'avatar', 20), writer(accId(2), 'renamed', 20)]);
        done = true;
        await reader;
        expect(order).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
        expect(await store.changesHead()).toBe(40);
        const mine = (await store.changes(0, 100)).filter((c) => c.account === accId(1));
        expect(mine).toHaveLength(20);
        expect(mine.map((c) => c.at)).toEqual(Array.from({ length: 20 }, (_, i) => at(i * MINUTE)));
      });

      it('changes keep session and detail exactly; the head never goes back, not even after a purge removed them all', async () => {
        const s1 = await store.appendChange({ at: T0, account: accId(1), kind: 'sessionRevoked', session: sessionId(100) });
        const s2 = await store.appendChange({ at: T0, account: accId(1), kind: 'sessionsRevoked', detail: { except: sessionId(101) } });
        const s3 = await store.appendChange({ at: T0, account: accId(1), kind: 'standing', detail: { now: true } });
        expect([s1, s2, s3]).toEqual([1, 2, 3]);
        expect(await store.changes(0, 10)).toEqual([
          { seq: 1, at: T0, account: accId(1), kind: 'sessionRevoked', session: sessionId(100) },
          { seq: 2, at: T0, account: accId(1), kind: 'sessionsRevoked', detail: { except: sessionId(101) } },
          { seq: 3, at: T0, account: accId(1), kind: 'standing', detail: { now: true } },
        ]);
        expect(await store.changes(1, 1)).toHaveLength(1);
        await refused(store.appendChange({ at: T0, account: accId(1), kind: 'standing', detail: { why: 'x' } as never }), 'value');
        const report = await store.purge({ ...DEFAULT_ACCOUNT_RETENTION, changesMs: 0 }, at(DAY));
        expect(report.changes).toBe(3);
        expect(await store.changes(0, 10)).toEqual([]);
        expect(await store.changesHead()).toBe(3);
        expect(await store.appendChange({ at: at(DAY), account: accId(1), kind: 'avatar' })).toBe(4);
      });
    });

    // ---- deletion ----

    describe('deletion (10.2)', () => {
      it('a deletion moves by request, move and cancel, and by request, claim and done, as the service makes them (the steps PostgreSQL\'s functions take; INTERFACE CHANGE, M14-11)', async () => {
        await store.createAccount(newAccount(1, 'Ann', 'ann'), T0);
        await store.createAccount(newAccount(2, 'Ben', 'ben'), T0);
        // far ahead: a cancel is before purgeAt by any clock
        const far = at(36_500 * DAY);
        const a = (await store.account(accId(1)))!;
        const d = { requestedAt: T0, purgeAt: far, erasingAt: null, done: [] as string[] };
        const requested = await store.updateAccount(a.id, a.version, { deletion: d });
        expect(requested.deletion).toEqual(d);
        const moved = await store.updateAccount(a.id, requested.version, { deletion: { ...d, purgeAt: at(36_000 * DAY) } });
        expect(moved.deletion).toEqual({ ...d, purgeAt: at(36_000 * DAY) });
        expect((await store.account(a.id))!.deletion).toEqual(moved.deletion);
        const cancelled = await store.updateAccount(a.id, moved.version, { deletion: null });
        expect(cancelled.deletion).toBeNull();
        expect((await store.account(a.id))!.deletion).toBeNull();
        // due: requested with a purgeAt that has passed, claimed, holders marked done one by one
        const b = (await store.account(accId(2)))!;
        const due = { requestedAt: T0, purgeAt: T0, erasingAt: null, done: [] as string[] };
        const r = await store.updateAccount(b.id, b.version, { deletion: due });
        const c = await store.updateAccount(b.id, r.version, { deletion: { ...due, erasingAt: T0 } });
        expect(c.deletion).toEqual({ ...due, erasingAt: T0 });
        const one = await store.updateAccount(b.id, c.version, { deletion: { ...c.deletion!, done: ['hosted'] } });
        const two = await store.updateAccount(b.id, one.version, { deletion: { ...one.deletion!, done: ['hosted', 'ladder'] } });
        expect((await store.account(b.id))!.deletion).toEqual({ ...due, erasingAt: T0, done: ['hosted', 'ladder'] });
        expect(two.version).toBe(b.version + 4);
        expect(await store.dueDeletions(at(DAY), 10)).toEqual([b.id]);
      });

      it('dueDeletions: accounts whose purgeAt has come, oldest first', async () => {
        await store.createAccount(newAccount(1, 'Ann', 'ann'), T0);
        await store.createAccount(newAccount(2, 'Ben', 'ben'), T0);
        await store.createAccount(newAccount(3, 'Cy', 'cy'), T0);
        for (const [n, purge] of [[1, at(7 * DAY)], [2, at(3 * DAY)]] as const) {
          const a = (await store.account(accId(n)))!;
          await store.updateAccount(a.id, a.version, { deletion: { requestedAt: T0, purgeAt: purge, erasingAt: null, done: [] } });
        }
        expect(await store.dueDeletions(at(DAY), 10)).toEqual([]);
        expect(await store.dueDeletions(at(3 * DAY), 10)).toEqual([accId(2)]);
        expect(await store.dueDeletions(at(8 * DAY), 10)).toEqual([accId(2), accId(1)]);
        expect(await store.dueDeletions(at(8 * DAY), 1)).toEqual([accId(2)]);
      });

      it('dueDeletions pages on after a cursor (the last row\'s purgeAt and id), ties at one purgeAt by id (INTERFACE CHANGE, M14-7)', async () => {
        for (const [n, purge] of [[4, at(2 * DAY)], [1, at(DAY)], [3, at(DAY)], [2, at(DAY)], [5, at(9 * DAY)]] as const) {
          await store.createAccount(newAccount(n, `Del${n}`, `del${n}`), T0);
          const a = (await store.account(accId(n)))!;
          await store.updateAccount(a.id, a.version, { deletion: { requestedAt: T0, purgeAt: purge, erasingAt: null, done: [] } });
        }
        expect(await store.dueDeletions(at(3 * DAY), 2)).toEqual([accId(1), accId(2)]);
        expect(await store.dueDeletions(at(3 * DAY), 2, { at: at(DAY), account: accId(2) })).toEqual([accId(3), accId(4)]);
        expect(await store.dueDeletions(at(3 * DAY), 2, { at: at(2 * DAY), account: accId(4) })).toEqual([]);
        // a cursor whose row is gone (erased) still places the page
        expect(await store.dueDeletions(at(3 * DAY), 10, { at: at(DAY), account: accId(0) })).toEqual([1, 2, 3, 4].map(accId));
        expect(await store.dueDeletions(at(3 * DAY), 10, { at: at(DAY + 1), account: accId(0) })).toEqual([accId(4)]);
        await refused(store.dueDeletions(at(3 * DAY), 2, { at: at(DAY) } as never), 'value');
      });

      it('erase leaves the id only in the tombstone, the deleted event and change, and open reports about it; no name or email anywhere', async () => {
        const X = accId(1);
        const Y = accId(2);
        const Z = accId(3);
        await store.createAccount(newAccount(1, 'Quillfeather', 'qulllfeather', { claim: guestSession(1) }), T0);
        await store.createAccount(newAccount(2, 'Yarrow', 'yarrow'), T0);
        await store.createAccount(newAccount(3, 'Wren', 'wren'), T0);
        let x = (await store.account(X))!;
        x = await store.updateAccount(X, x.version, { email: { address: 'quill@example.org', verifiedAt: T0 } });
        x = await store.rename(X, x.version, historyOf(1, 'Zephyrine', 'zephyrlne', at(HOUR)), renameOpts(at(HOUR), { holdUntil: at(60 * DAY) }));
        await store.putSession(sessionOf(1, 1));
        await store.putDevice({ hash: sha('device:1:1'), account: X, createdAt: T0, lastUsedAt: T0, failures: 2 });
        await store.setRelation({ account: X, other: Y, kind: 'block', createdAt: T0 });
        await store.setRelation({ account: Y, other: X, kind: 'mute', createdAt: T0 });
        await store.setRelation({ account: Z, other: X, kind: 'block', createdAt: T0 });
        await store.setRelation({ account: Y, other: Z, kind: 'mute', createdAt: T0 });
        await store.putEmailCode(emailCodeOf(1, X, 'verify'), T0);
        await store.putSanction(sanctionOf(1, X, 'mute', at(DAY)));
        await store.putAppeal({ sanction: sanctionId(1), account: X, text: 'Sorry, Zephyrine here.', createdAt: T0, answer: null, answerMessage: null, answeredAt: null, answeredBy: null });
        // another account's sanction and appeal that name X and give its address (review of M14-4: free text anywhere is scrubbed)
        await store.putSanction(sanctionOf(2, Y, 'warn', null, { message: 'For what you said to Quillfeather.', note: 'see the quill@example.org report' }));
        await store.putAppeal({ sanction: sanctionId(2), account: Y, text: 'Quillfeather started it', createdAt: T0, answer: null, answerMessage: null, answeredAt: null, answeredBy: null });
        await store.answerAppeal(sanctionId(2), 'upheld', 'What Zephyrine did is not the point.', 'op', at(MINUTE));
        await store.putReport(reportOf(1, { kind: 'account', account: X }, { account: Y }, 'Yarrow', { text: 'Zephyrine says: rude' }));
        await store.putReport(reportOf(2, { kind: 'account', account: X }, { account: Y }, 'Yarrow', { status: 'dismissed', closedAt: T0, closedBy: 'op' }));
        await store.putReport(reportOf(3, { kind: 'account', account: Y }, { account: X }, 'Zephyrine', { text: 'QUILLFEATHER, now zephyrine, wrote from quill@example.org' }));
        await store.putReport(reportOf(4, { kind: 'account', account: Y }, { account: X }, 'Quillfeather', { status: 'actioned', closedAt: T0, closedBy: 'op' }));
        await store.putReport(reportOf(5, { kind: 'system', source: 'ladder' }, { account: Y }, 'Yarrow', { reason: 'collusion', related: [X, Z] }));
        // reports between other accounts that name X, open and closed
        await store.putReport(reportOf(6, { kind: 'account', account: Z }, { account: Y }, 'Yarrow', { text: 'Yarrow and Quillfeather team up', note: 'also zephyrine?' }));
        await store.putReport(reportOf(7, { kind: 'account', account: Y }, { account: Z }, 'Wren', { text: 'Wren and Quillfeather teamed up' }));
        await store.closeReport(reportId(7), 'dismissed', 'op', at(MINUTE), 'asked quill@example.org');
        // X's claimed guest session: reports about it and by it are X's (open: kept without the name or the reporter; closed: removed)
        await store.putReport(reportOf(8, { kind: 'account', account: Y }, { guestSession: guestSession(1) }, 'Quillfeather', { text: 'the guest Quillfeather' }));
        await store.putReport(reportOf(9, { kind: 'account', account: Z }, { guestSession: guestSession(1) }, 'Quillfeather', { status: 'dismissed', closedAt: T0, closedBy: 'op' }));
        await store.putReport(reportOf(10, { kind: 'guest', session: guestSession(1) }, { account: Y }, 'Yarrow', { text: 'Quillfeather here, as a guest' }));
        await store.putReport(reportOf(11, { kind: 'guest', session: guestSession(1) }, { account: Z }, 'Wren', { status: 'actioned', closedAt: T0, closedBy: 'op' }));
        // a reported guest who is not X keeps its name
        await store.putReport(reportOf(12, { kind: 'account', account: Y }, { guestSession: guestSession(2) }, 'Wolf (guest)'));
        // the operator's note on a reserved key
        await store.putNameEntry({ key: 'qulll', keyVersion: 1, kind: 'reserved', account: null, until: null, note: 'too close to Quillfeather', createdAt: T0 });
        await store.appendAudit([
          auditOf(11, 'reported', X, { report: reportId(1), reason: 'chat' }),
          auditOf(12, 'adminViewed', X, { what: 'show' }, { actor: 'admin:op', actorOs: 'root' }),
          auditOf(13, 'renamed', X, { free: false }),
          auditOf(14, 'signedIn', Y, { provider: 'local', device: false, restricted: false }),
          auditOf(15, 'deleted', X, { holders: [] }, { actor: 'system', at: at(DAY) }),
        ]);
        await store.appendChange({ at: T0, account: X, kind: 'renamed' });
        await store.appendChange({ at: T0, account: Y, kind: 'avatar' });
        await store.appendChange({ at: T0, account: X, kind: 'deleting' });
        await claimErasure(store, X);
        await refused(store.erase(Y, tombstoneOf(Y), at(90 * DAY)), 'conflict');
        await refused(store.erase(X, tombstoneOf(Y), at(90 * DAY)), 'value');
        await refused(store.erase(accId(9), tombstoneOf(accId(9)), at(90 * DAY)), 'notFound');
        await refused(store.erase(X, tombstoneOf(X, at(-MINUTE)), at(90 * DAY)), 'conflict'); // before purgeAt

        const ts = tombstoneOf(X, at(DAY), at(DAY));
        await store.erase(X, ts, at(91 * DAY));
        await store.appendChange({ at: at(DAY), account: X, kind: 'deleted' });

        expect(await store.account(X)).toBeNull();
        expect(await store.tombstone(X)).toEqual(ts);
        expect(await store.accountByKey('zephyrlne', 1)).toBeNull();
        expect(await store.nameHistory(X)).toEqual([]);
        expect(await store.credentials(X)).toEqual([]);
        expect(await store.credentialBySubject('local', X)).toBeNull();
        expect(await store.recoveryCodes(X)).toEqual([]);
        expect(await store.sessionsOf(X)).toEqual([]);
        expect(await store.sessionByTokenHash(sessionOf(1, 1).tokenHash)).toBeNull();
        expect(await store.device(sha('device:1:1'))).toBeNull();
        expect(await store.claimsOf(X)).toEqual([]);
        expect(await store.relationsOf(X)).toEqual([]);
        expect((await store.relationsOf(Y)).map((r) => r.other)).toEqual([Z]);
        expect(await store.relationsOf(Z)).toEqual([]);
        expect(await store.liveEmailCodes(X, 'verify', T0)).toEqual([]);
        expect(await store.sanctionsOf(X)).toEqual([]);
        expect((await store.sanctionsOf(Y)).map((s) => [s.id, s.message, s.note])).toEqual([
          [sanctionId(2), 'For what you said to Deleted player.', 'see the Deleted player report'],
        ]);
        expect((await store.appeals({ limit: 10 })).map((ap) => [ap.sanction, ap.account, ap.text, ap.answerMessage])).toEqual([
          [sanctionId(2), Y, 'Deleted player started it', 'What Deleted player did is not the point.'],
        ]);
        expect(await store.report(reportId(1))).toMatchObject({ reporter: null, target: { account: Y }, targetName: 'Yarrow', text: 'Deleted player says: rude' });
        expect(await store.report(reportId(2))).toBeNull();
        expect(await store.report(reportId(3))).toMatchObject({
          reporter: { kind: 'account', account: Y }, target: { account: X }, targetName: DELETED_PLAYER_NAME,
          text: 'Deleted player, now Deleted player, wrote from Deleted player',
        });
        expect(await store.report(reportId(4))).toBeNull();
        expect((await store.report(reportId(5)))?.related).toEqual([Z]);
        expect(await store.report(reportId(6))).toMatchObject({
          reporter: { kind: 'account', account: Z }, targetName: 'Yarrow', text: 'Yarrow and Deleted player team up', note: 'also Deleted player?',
        });
        expect(await store.report(reportId(7))).toMatchObject({ status: 'dismissed', targetName: 'Wren', text: 'Wren and Deleted player teamed up', note: 'asked Deleted player' });
        expect(await store.report(reportId(8))).toMatchObject({
          reporter: { kind: 'account', account: Y }, target: { guestSession: guestSession(1) }, targetName: DELETED_PLAYER_NAME, text: 'the guest Deleted player',
        });
        expect(await store.report(reportId(9))).toBeNull();
        expect(await store.report(reportId(10))).toMatchObject({ reporter: null, target: { account: Y }, targetName: 'Yarrow', text: 'Deleted player here, as a guest' });
        expect(await store.report(reportId(11))).toBeNull();
        expect(await store.report(reportId(12))).toMatchObject({ targetName: 'Wolf (guest)' });
        expect(await store.nameEntry('qulll', 1)).toMatchObject({ kind: 'reserved', note: 'too close to Deleted player' });
        expect((await store.audit({ account: X, limit: 10 })).map((e) => e.kind)).toEqual(['deleted']);
        expect((await store.audit({ kinds: ['adminViewed'], limit: 10 }))[0]).toMatchObject({ id: auditId(12), account: null, actor: 'admin:op' });
        expect((await store.audit({ account: Y, limit: 10 })).map((e) => e.id)).toEqual([auditId(14), auditId(2000)]);
        expect((await store.changes(0, 10)).map((c) => [c.account, c.kind])).toEqual([[Y, 'avatar'], [X, 'deleted']]);
        expect(await store.nameEntry('zephyrlne', 1)).toEqual({ key: 'zephyrlne', keyVersion: 1, kind: 'held', account: null, until: at(91 * DAY), note: null, createdAt: at(HOUR) });
        expect(await store.nameEntry('qulllfeather', 1)).toMatchObject({ kind: 'held', account: null, until: at(60 * DAY) });
        await refused(store.createAccount(newAccount(4, 'Zephyrine', 'zephyrlne', { account: { createdAt: at(2 * DAY) } }), at(2 * DAY)), 'exists');
        await refused(store.createAccount(newAccount(1, 'Again', 'agaln'), T0), 'exists');

        // the byte search: everything the store keeps
        const idPlaces = await h.places(store, X);
        expect(idPlaces).toContain('tombstone');
        for (const p of idPlaces) expect(['tombstone', 'audit:deleted', 'change:deleted', 'report-target:open', ...(h.erasedIdPlaces ?? [])]).toContain(p);
        for (const key of ['qulllfeather', 'zephyrlne']) {
          const places = await h.places(store, key);
          expect(places.length, key).toBeGreaterThan(0);
          for (const p of places) expect(p, key).toBe('name-for-nobody');
        }
        for (const s of ['Quillfeather', 'Zephyrine', 'quill@example.org']) expect(await h.places(store, s), s).toEqual([]);

        // again: nothing more to do, nothing changes
        await store.erase(X, ts, at(91 * DAY));
        expect(await store.tombstone(X)).toEqual(ts);
        for (const p of await h.places(store, X)) expect(['tombstone', 'audit:deleted', 'change:deleted', 'report-target:open', ...(h.erasedIdPlaces ?? [])]).toContain(p);
      });

      it('a reserved key keeps its name; erase drops a name that holds the account\'s, and a forced rename\'s ban loses its account (M14-15)', async () => {
        const X = accId(1);
        await store.createAccount(newAccount(1, 'Rudename', 'rudename'), T0);
        let x = (await store.account(X))!;
        x = await store.rename(X, x.version, historyOf(1, 'Nicer', 'nlcer', at(HOUR)), renameOpts(at(HOUR)));
        x = await store.rename(X, x.version, historyOf(1, 'Player 123456', 'player l23456', at(2 * HOUR), 'forced'), renameOpts(at(2 * HOUR), { oldKind: 'banned', holdUntil: null }));
        // the operator reserves the earlier name over its hold, and an unrelated one; each with the name it was made from (review A7)
        const reserved = { keyVersion: 1, kind: 'reserved' as const, account: null, until: null, note: null, createdAt: T0 };
        await store.putNameEntry({ ...reserved, key: 'rudename', name: 'Rudename', note: 'Rudename was offensive' });
        await store.putNameEntry({ ...reserved, key: 'staff', name: 'Staff' });
        expect(await store.nameEntry('rudename', 1)).toEqual({ ...reserved, key: 'rudename', name: 'Rudename', note: 'Rudename was offensive' });
        expect(await store.nameEntry('nlcer', 1)).toMatchObject({ kind: 'banned', account: X });
        await refused(store.putNameEntry({ ...reserved, key: 'bad', name: 'x\u0000' }), 'value');
        await claimErasure(store, X);
        await store.erase(X, tombstoneOf(X, at(DAY), at(DAY)), at(91 * DAY));
        // the key stays reserved; the name that was the account's goes whole, the note is scrubbed
        expect(await store.nameEntry('rudename', 1)).toEqual({ ...reserved, key: 'rudename', note: 'Deleted player was offensive' });
        expect(await store.nameEntry('staff', 1)).toEqual({ ...reserved, key: 'staff', name: 'Staff' });
        expect(await store.nameEntry('nlcer', 1)).toMatchObject({ kind: 'banned', account: null, until: null });
        void x;
      });

      it('after the erase, the account\'s events and changes are kept as erase leaves them, in the same write (INTERFACE CHANGE, M14-7)', async () => {
        const X = accId(1);
        const Y = accId(2);
        await store.createAccount(newAccount(1, 'Xena', 'xena'), T0);
        await store.createAccount(newAccount(2, 'Yuri', 'yurl'), T0);
        await claimErasure(store, X);
        await store.erase(X, tombstoneOf(X, at(DAY)), at(91 * DAY));
        const head = await store.changesHead();
        // what requests that were running at the erasure write afterwards (a sign-in, an export, the operator's export), with another account's event
        const late = { at: at(DAY), session: sessionId(100), addressTag: 'late-address-tag' };
        await store.appendAudit([
          auditOf(1, 'signedIn', X, { provider: 'local', device: false, restricted: true }, late),
          auditOf(2, 'exported', X, {}, late),
          auditOf(3, 'adminExported', X, { partial: false }, { at: at(DAY), actor: 'admin:op', actorOs: 'root' }),
          auditOf(4, 'deleted', X, { holders: [] }, { at: at(DAY), actor: 'system' }),
          auditOf(5, 'signedIn', Y, { provider: 'local', device: false, restricted: false }, { at: at(DAY) }),
        ]);
        // its deleted event as it is; the operator's event without its account; nothing else of it
        expect((await store.audit({ account: X, limit: 10 })).map((e) => e.id)).toEqual([auditId(4)]);
        expect(await store.audit({ kinds: ['adminExported'], limit: 10 })).toEqual([
          auditOf(3, 'adminExported', null, { partial: false }, { at: at(DAY), actor: 'admin:op', actorOs: 'root' }),
        ]);
        expect((await store.audit({ since: at(DAY), limit: 10 })).map((e) => e.id).sort()).toEqual([3, 4, 5].map(auditId));
        for (const s of [sessionId(100), 'late-address-tag']) expect(await h.places(store, s), s).toEqual([]);
        // a change of it other than deleted is refused and appends nothing; deleted, and other accounts' changes, go in
        await refused(store.appendChange({ at: at(DAY), account: X, kind: 'sessionsRevoked' }), 'notFound');
        await refused(store.appendChange({ at: at(DAY), account: X, kind: 'standing' }), 'notFound');
        expect(await store.changesHead()).toBe(head);
        expect(await store.appendChange({ at: at(DAY), account: X, kind: 'deleted' })).toBe(head + 1);
        expect(await store.appendChange({ at: at(DAY), account: Y, kind: 'avatar' })).toBe(head + 2);
        expect((await store.changes(head, 10)).map((c) => [c.account, c.kind])).toEqual([[X, 'deleted'], [Y, 'avatar']]);
        for (const p of await h.places(store, X)) expect(['tombstone', 'audit:deleted', 'change:deleted', ...(h.erasedIdPlaces ?? [])]).toContain(p);
      });
    });

    // ---- retention ----

    describe('purge (10.3)', () => {
      (h.dbClock === 'real' ? it.skip : it)('removes by policy and by category, never below purge_audit\'s floors, and a second run finds nothing', async () => {
        const N = at(400 * DAY);
        const far = { expiresAt: at(1000 * DAY) };
        await store.createAccount({ ...newAccount(1, 'Ada', 'ada'), session: sessionOf(1, 0, far) }, T0);
        const d1 = (await store.device(sha('device:1:0')))!;
        await store.updateDevice(d1.hash, { lastUsedAt: at(100 * DAY) });
        await store.createAccount({ ...newAccount(2, 'Bea', 'bea'), session: sessionOf(2, 0, far) }, T0); // its device, last used at T0, goes
        // sessions: revoked long ago (goes), revoked lately (stays), expired long ago (goes)
        await store.putSession(sessionOf(1, 1, { ...far, revokedAt: at(DAY), revokeReason: 'signOut' }));
        await store.putSession(sessionOf(1, 2, { ...far, revokedAt: at(395 * DAY), revokeReason: 'signOut' }));
        await store.putSession(sessionOf(1, 3, { expiresAt: at(200 * DAY) }));
        // email codes: used (goes), expired (goes), live (stays)
        await store.putEmailCode(emailCodeOf(1, accId(1), 'verify', at(399 * DAY), { usedAt: at(399 * DAY) }), at(399 * DAY));
        await store.putEmailCode(emailCodeOf(2, accId(1), 'reset', at(300 * DAY)), at(300 * DAY));
        await store.putEmailCode(emailCodeOf(3, accId(1), 'reset', at(400 * DAY - MINUTE)), at(400 * DAY - MINUTE));
        // names: a passed hold (goes), a running hold (stays), a reservation without an end (stays)
        const a = (await store.account(accId(1)))!;
        const a2 = await store.rename(a.id, a.version, historyOf(1, 'Adah', 'adah', at(MINUTE)), renameOpts(at(MINUTE), { holdUntil: at(300 * DAY) }));
        await store.rename(a2.id, a2.version, historyOf(1, 'Adele', 'adele', at(2 * MINUTE)), renameOpts(at(2 * MINUTE), { holdUntil: at(500 * DAY) }));
        await store.putNameEntry({ key: 'staff', keyVersion: 1, kind: 'reserved', account: null, until: null, note: null, createdAt: T0 });
        // reports: closed 390 days ago (goes), closed 300 days ago (stays), open (stays)
        await store.putReport(reportOf(1, null, { account: accId(2) }, 'Bea', { status: 'dismissed', closedAt: at(10 * DAY), closedBy: 'op' }));
        await store.putReport(reportOf(2, null, { account: accId(2) }, 'Bea', { status: 'actioned', closedAt: at(100 * DAY), closedBy: 'op' }));
        await store.putReport(reportOf(3, null, { account: accId(2) }, 'Bea'));
        // tombstones: hold and sanction over (goes), hold running (stays), sanction running (stays)
        for (const [n, hold, until] of [[5, at(90 * DAY), null], [6, at(500 * DAY), null], [7, at(90 * DAY), at(1000 * DAY)]] as const) {
          await store.createAccount({ ...newAccount(n, `Gone${n}`, `gone${n}`), session: sessionOf(n, 0, far) }, T0);
          await store.appendAudit([auditOf(n, 'deleted', accId(n), { holders: [] }, { actor: 'system' })]);
          await claimErasure(store, accId(n));
          await store.erase(accId(n), tombstoneOf(accId(n), T0, until), hold);
        }
        // audit (accounts 1 and 2 hold their `registered` events at T0, 400 days old: security, they go)
        await store.appendAudit([
          auditOf(21, 'signedIn', accId(1), { provider: 'local', device: true, restricted: false }, { at: at(300 * DAY) }), // 100 days: stays
          auditOf(22, 'sanctioned', accId(1), { sanction: sanctionId(1), kind: 'warn', reason: 'chat', now: false }), // moderation: stays
          auditOf(23, 'adminViewed', accId(1), { what: 'show' }, { actor: 'admin:op', actorOs: 'root' }), // operator, 400 days: stays
          auditOf(24, 'adminViewed', accId(1), { what: 'find' }, { actor: 'admin:op', actorOs: 'root', at: at(-400 * DAY) }), // 800 days: goes
        ]);
        // changes: 400 days old (go), a day old (stays)
        await store.appendChange({ at: T0, account: accId(1), kind: 'avatar' });
        await store.appendChange({ at: at(399 * DAY), account: accId(1), kind: 'avatar' });

        // floors: a policy shorter than purge_audit's keeps changes nothing for the audit log
        const short: AccountRetention = { ...DEFAULT_ACCOUNT_RETENTION, securityAuditMs: DAY, operatorAuditMs: DAY };
        const report = await store.purge(short, N);
        // names: Ada's passed hold, and the holds for nobody of Gone5 and Gone7 (90 days); Gone6's (500 days) stays
        expect(report).toEqual({ sessions: 2, devices: 1, emailCodes: 2, names: 3, reports: 1, audit: 4, changes: 1, tombstones: 1 });
        expect((await store.sessionsOf(accId(1))).map((s) => s.id)).toEqual([sessionOf(1, 0).id, sessionOf(1, 2).id]);
        expect(await store.device(sha('device:1:0'))).not.toBeNull();
        expect(await store.device(sha('device:2:0'))).toBeNull();
        expect((await store.liveEmailCodes(accId(1), 'reset', at(400 * DAY - MINUTE))).map((c) => c.id)).toEqual([emailCodeId(3)]);
        expect(await store.nameEntry('ada', 1)).toBeNull();
        expect(await store.nameEntry('adah', 1)).toMatchObject({ kind: 'held' });
        expect(await store.nameEntry('staff', 1)).not.toBeNull();
        expect(await store.nameEntry('gone5', 1)).toBeNull();
        expect(await store.nameEntry('gone6', 1)).toMatchObject({ kind: 'held', account: null, until: at(500 * DAY) });
        expect(await store.nameEntry('gone7', 1)).toBeNull();
        expect((await store.reports({ limit: 10 })).map((r) => r.id)).toEqual([reportId(2), reportId(3)]);
        expect(await store.tombstone(accId(5))).toBeNull();
        expect(await store.tombstone(accId(6))).not.toBeNull();
        expect(await store.tombstone(accId(7))).not.toBeNull();
        expect((await store.audit({ limit: 100 })).map((e) => e.id).sort()).toEqual([auditId(6), auditId(7), auditId(21), auditId(22), auditId(23)].sort());
        expect((await store.changes(0, 10)).map((c) => c.seq)).toEqual([2]);
        expect(await store.purge(short, N)).toEqual({ sessions: 0, devices: 0, emailCodes: 0, names: 0, reports: 0, audit: 0, changes: 0, tombstones: 0 });
        // with the default policy, a year later: the operator event of 400 + 365 days and the security event of 465 days go too, and Gone6's
        // tombstone (its hold ended at 500 days) with its `deleted` event; Gone7's stays while its sanction runs, and so does its event
        const later = await store.purge(DEFAULT_ACCOUNT_RETENTION, at(765 * DAY));
        expect(later).toMatchObject({ audit: 3, tombstones: 1, names: 2 });
        expect(await store.tombstone(accId(6))).toBeNull();
        expect(await store.tombstone(accId(7))).not.toBeNull();
        expect((await store.audit({ limit: 100 })).map((e) => e.id).sort()).toEqual([auditId(7), auditId(22)].sort());
      });
    });

    // ---- the store rules ----

    describe('the store rules', () => {
      it('refuses NUL and unpaired surrogates (value), in rows and lookups alike, and stores nothing', async () => {
        await refused(store.createAccount(newAccount(1, 'Bad\u0000name', 'badname'), T0), 'value');
        await refused(store.createAccount(newAccount(1, 'Fine', 'flne', { account: { email: { address: 'x\ud800@example.org', verifiedAt: null } } }), T0), 'value');
        await refused(store.createAccount(newAccount(1, 'Fine', 'fl\udc00ne'), T0), 'value');
        expect(await store.account(accId(1))).toBeNull();
        expect(await store.nameEntry('badname', 1)).toBeNull();
        await store.createAccount(newAccount(1, 'Fine', 'flne'), T0);
        await refused(store.putReport(reportOf(1, null, { account: accId(1) }, 'Fine', { text: 'lone \udc00 surrogate' })), 'value');
        expect(await store.report(reportId(1))).toBeNull();
        await refused(store.appendAudit([auditOf(1, 'signedIn', accId(1), { ['k\u0000']: 1 } as never)]), 'value');
        await refused(store.appendChange({ at: T0, account: accId(1), kind: 'sessionRevoked', session: 'as\u0000x' }), 'value');
        await refused(store.putNameEntry({ key: 'x', keyVersion: 1, kind: 'reserved', account: null, until: null, note: 'a\u0000b', createdAt: T0 }), 'value');
        await refused(store.account('acc_\u0000' as AccountId), 'value');
        await refused(store.nameEntry('\ud83d', 1), 'value');
        await refused(store.sessionByTokenHash('\u0000'), 'value');
        expect(await store.audit({ limit: 10 })).toHaveLength(1);
        expect(await store.changesHead()).toBe(0);
        // a well-formed pair is text like any other
        await store.putReport(reportOf(2, null, { account: accId(1) }, 'Fine', { text: 'nice game 🎉' }));
        expect((await store.report(reportId(2)))?.text).toBe('nice game 🎉');
      });

      it('keeps any safe integer (versions, counters, slots, generations: past 2^31) and refuses a time outside the years 1000 to 9999 (value) (INTERFACE CHANGE, M14-11)', async () => {
        const big = 3_000_000_000;
        const n = newAccount(1, 'Big', 'blg', { account: { version: big } });
        n.recovery = n.recovery.map((r, i) => (i === 0 ? { ...r, slot: 5_000_000_000, generation: big } : r));
        n.session = { ...n.session, rotation: big, proofFailures: big };
        n.device = { ...n.device, failures: big };
        await store.createAccount(n, T0);
        expect((await store.account(accId(1)))!.version).toBe(big);
        expect((await store.updateAccount(accId(1), big, { avatar: 'd20-amber' })).version).toBe(big + 1);
        expect((await store.recoveryCodes(accId(1))).map((r) => r.slot).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 5_000_000_000]);
        expect((await store.recoveryCodes(accId(1))).find((r) => r.slot === 5_000_000_000)!.generation).toBe(big);
        expect(await store.rotateSession(n.session.id, n.session.tokenHash, sha('big:next'), at(DAY))).toBe(big + 1);
        expect((await store.sessionsOf(accId(1)))[0]).toMatchObject({ rotation: big + 1, proofFailures: big });
        expect((await store.device(n.device.hash))!.failures).toBe(big);
        // the largest and the smallest time an ISO string of four year digits holds are kept; one past either is refused, whatever the store
        const lo = '1000-01-01T00:00:00.000Z';
        const hi = '9999-12-31T23:59:59.999Z';
        await store.createAccount(newAccount(2, 'Old', 'old', { account: { createdAt: lo } }), lo);
        await store.createAccount(newAccount(3, 'Far', 'far', { account: { createdAt: hi } }), hi);
        expect([(await store.account(accId(2)))!.createdAt, (await store.account(accId(3)))!.createdAt]).toEqual([lo, hi]);
        for (const bad of ['+010000-01-01T00:00:00.000Z', '-000001-12-31T23:59:59.999Z', '+275760-09-13T00:00:00.000Z', '0999-12-31T23:59:59.999Z', '0001-01-01T00:00:00.000Z']) {
          await refused(store.createAccount(newAccount(4, 'Bad', 'bad', { account: { createdAt: bad } }), T0), 'value');
          await refused(store.audit({ since: bad, limit: 1 }), 'value');
        }
        expect(await store.account(accId(4))).toBeNull();
      });

      it('refuses times that do not parse, ids outside the id rule, and unknown kinds (value)', async () => {
        await refused(store.createAccount(newAccount(1, 'Tim', 'tlrn', { account: { createdAt: 'yesterday' } }), T0), 'value');
        await refused(store.createAccount(newAccount(1, 'Tim', 'tlrn'), 'now'), 'value');
        await refused(store.createAccount(newAccount(1, 'Tim', 'tlrn', { account: { id: 'acc/../../x' as AccountId } }), T0), 'value');
        await store.createAccount(newAccount(1, 'Tim', 'tlrn'), T0);
        await refused(store.putSanction(sanctionOf(1, accId(1), 'jail' as never, null)), 'value');
        await refused(store.appendAudit([auditOf(1, 'hacked' as never, null, {} as never)]), 'value');
        await refused(store.appendAudit([auditOf(1, 'signedIn', null, { provider: 'local', device: false, restricted: false }, { actor: 'root' as never })]), 'value');
        await refused(store.revokeSession(accId(1), sessionOf(1, 0).id, 'because' as never, T0), 'value');
      });

      it('answers copies: changing an argument or a result afterwards changes nothing stored', async () => {
        const n = newAccount(1, 'Uli', 'ull');
        await store.createAccount(n, T0);
        n.account.privacy.history = 'public';
        n.recovery[0]!.hash = 'changed';
        const a = (await store.account(accId(1)))!;
        expect(a.privacy.history).toBe('private');
        a.privacy.leaderboards = false;
        (a as { name: string }).name = 'Changed';
        expect(await store.account(accId(1))).toMatchObject({ name: 'Uli', privacy: { leaderboards: true } });
        expect((await store.recoveryCodes(accId(1)))[0]?.hash).toBe(sha('rc:1:0:1'));
        const extra = { ...newAccount(2, 'Vin', 'vln'), sneaky: true };
        await store.createAccount({ ...extra, account: { ...extra.account, status: 'active' } as Account }, T0);
        expect(Object.keys((await store.account(accId(2)))!).sort()).toEqual(Object.keys(accountOf(2, 'Vin', 'vln')).sort());
      });

      it('copies its arguments when called: changing one before the write is awaited changes nothing', async () => {
        // the file store runs a write later, in turn; it reads the copy made at the call, as the memory store does (review of M14-4)
        const n1 = newAccount(1, 'Carol', 'carol');
        const p1 = store.createAccount(n1, T0);
        n1.account.name = 'Mallory';
        n1.history.name = 'Mallory';
        await p1;
        expect((await store.account(accId(1)))?.name).toBe('Carol');
        expect((await store.nameHistory(accId(1))).map((r) => r.name)).toEqual(['Carol']);
        const n2 = newAccount(2, 'Dan', 'dan');
        const p2 = store.createAccount(n2, T0);
        n2.account.name = 'Mallory'; // read late, the registration would be refused: its history row would no longer match
        await p2;
        expect((await store.account(accId(2)))?.name).toBe('Dan');
        const a = (await store.account(accId(1)))!;
        const patch: AccountPatch = { avatar: 'd20-amber' };
        const p3 = store.updateAccount(a.id, a.version, patch);
        patch.avatar = 'd4-white';
        expect((await p3).avatar).toBe('d20-amber');
        const keys = new Map([['carol', 'carol2'], ['dan', 'dan2']]);
        const p4 = store.rekey(1, 2, keys);
        keys.set('carol', 'mallory2');
        await p4;
        expect((await store.account(accId(1)))?.nameKey).toBe('carol2');
        // what cannot be copied is refused
        await refused(store.appendAudit([auditOf(1, 'signedIn', null, { provider: 'local', device: false, restricted: (() => true) as never })]), 'value');
      });

      it('after close, every call answers closed', async () => {
        await store.createAccount(newAccount(1, 'Wes', 'wes'), T0);
        await store.close();
        await refused(store.account(accId(1)), 'closed');
        await refused(store.createAccount(newAccount(2, 'Xia', 'xla'), T0), 'closed');
        await refused(store.changesHead(), 'closed');
        await store.close();
      });
    });
  });
}
