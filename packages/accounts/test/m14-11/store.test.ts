/**
 * M14-11: what only the PostgreSQL store has to get right beyond the contract suite (design 11.5): text that is awkward in SQL and in array literals; listings in
 * code-point order whatever the database's collation (mixed-case ids and keys, a LIKE prefix with its own wildcards); a registration that fails at its
 * last step leaves nothing; retention by policy against the real clock (the contract's purge test runs on PGlite only). The store's connection has `search_path = pg_catalog`, so the whole file also runs with no schema the store did not name.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNT_RETENTION, openPostgresAccountStore, type AccountStore, type AppealRow } from '@openmtg/accounts';
import {
  accId, at, auditOf, claimErasure, DAY, emailCodeOf, historyOf, newAccount, refused, renameOpts, reportId, reportOf, sanctionId, sanctionOf, sessionOf, sha, T0,
  tombstoneOf,
} from '../m14-4/contract';
import { SCRUB_PAGE } from '../../src/store/postgres';
import { kits } from './harness';

const now = Date.now();
const ago = (days: number): string => new Date(now - days * DAY).toISOString();
const nowIso = new Date(now).toISOString();

for (const kit of kits()) {
  describe(`M14-11 the PostgreSQL store itself (${kit.name})`, { timeout: 60_000 }, () => {
    let store: AccountStore;
    beforeAll(() => kit.reset());
    afterAll(() => kit.end());
    beforeEach(async () => {
      await kit.reset();
      store = await openPostgresAccountStore(kit.service());
    });

    it('keeps any text as given: quotes, backslashes, braces, commas, new lines, NULL, the empty string and emoji, in free text and in arrays', async () => {
      const awkward = ['plain', 'a,b', 'c"d', '{x}', 'e\\f', 'NULL', ' spaced ', '', 'line\nbreak\ttab', "it's", '\\', '"', '🎉 ünï̈côdé 日本語', '$1', ';--'];
      await store.createAccount(newAccount(1, 'Ann', 'ann'), T0);
      await store.createAccount(newAccount(2, 'Ben', 'ben'), T0);
      const a = (await store.account(accId(1)))!;
      const requested = await store.updateAccount(a.id, a.version, { deletion: { requestedAt: ago(8), purgeAt: ago(1), erasingAt: null, done: [] } });
      const claimed = await store.updateAccount(a.id, requested.version, { deletion: { ...requested.deletion!, erasingAt: ago(0) } });
      const u = await store.updateAccount(a.id, claimed.version, { deletion: { ...claimed.deletion!, done: awkward } });
      expect(u.deletion!.done).toEqual(awkward);
      expect((await store.account(accId(1)))!.deletion!.done).toEqual(awkward);
      await store.erase(accId(1), { ...tombstoneOf(accId(1), nowIso), holdersDone: awkward }, new Date(now + 90 * DAY).toISOString());
      expect((await store.tombstone(accId(1)))!.holdersDone).toEqual(awkward);
      for (const [i, text] of awkward.entries()) {
        await store.putReport(reportOf(i + 1, { kind: 'account', account: accId(2) }, { guestSession: `gs_${i + 1}` }, 'Guest', { text, note: text }));
        const r = (await store.report(reportId(i + 1)))!;
        expect([r.text, r.note]).toEqual([text, text]);
      }
      await store.putSanction(sanctionOf(1, accId(2), 'warn', null, { message: awkward.join('|'), note: awkward.join('\n') }));
      expect(await store.sanction(sanctionId(1))).toMatchObject({ message: awkward.join('|'), note: awkward.join('\n') });
      const appeal: AppealRow = { sanction: sanctionId(1), account: accId(2), text: awkward.join(' '), createdAt: T0, answer: null, answerMessage: null, answeredAt: null, answeredBy: null };
      await store.putAppeal(appeal);
      expect((await store.appeals({ limit: 1 }))[0]).toEqual(appeal);
      const long = 'x'.repeat(200_000);
      await store.putReport(reportOf(90, { kind: 'account', account: accId(2) }, { guestSession: 'gs_90' }, 'Guest', { text: long }));
      expect((await store.report(reportId(90)))!.text).toBe(long);
    });

    it('lists in code-point order, not the database\'s collation: uppercase before lowercase, underscore among them, across every ordered listing', async () => {
      const ids = ['rep_B', 'rep_a', 'rep_Z', 'rep_b', 'rep__', 'rep_0', 'rep_A'];
      await store.createAccount(newAccount(1, 'Ann', 'ann'), T0);
      for (const id of ids) await store.putReport({ ...reportOf(1, { kind: 'account', account: accId(1) }, { guestSession: 'gs_1' }, 'Guest'), id });
      const sorted = [...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
      expect(sorted).toEqual(['rep_0', 'rep_A', 'rep_B', 'rep_Z', 'rep__', 'rep_a', 'rep_b']);
      expect((await store.reports({ limit: 100 })).map((r) => r.id)).toEqual(sorted);
      expect((await store.reports({ limit: 100, after: 'rep_B' })).map((r) => r.id)).toEqual(['rep_Z', 'rep__', 'rep_a', 'rep_b']);
      // names: keys (and the first account's current one), their order, their pages, and a prefix with the LIKE wildcards in it
      const keys = ['Beta', 'alpha', 'a_c', 'axc', 'a%c', 'abc', 'Zed', 'a\\c'];
      for (const key of keys) await store.putNameEntry({ key, keyVersion: 1, kind: 'reserved', account: null, until: null, note: null, createdAt: T0 });
      const expected = [...keys, 'ann'].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
      expect((await store.nameEntries(null, 100)).map((e) => e.key)).toEqual(expected);
      expect((await store.nameEntries('Zed', 100)).map((e) => e.key)).toEqual(expected.slice(expected.indexOf('Zed') + 1));
      expect((await store.nameEntries(null, 3)).map((e) => e.key)).toEqual(expected.slice(0, 3));
      for (const [i, key] of ['abc', 'a_c', 'axc', 'a%c', 'a\\c', 'Beta', 'zzz'].entries()) {
        await store.createAccount(newAccount(10 + i, `Acct${i}`, `${key}k`), T0);
      }
      expect((await store.findAccounts('a_', 100)).map((a) => a.nameKey)).toEqual(['a_ck']);
      expect((await store.findAccounts('a%', 100)).map((a) => a.nameKey)).toEqual(['a%ck']);
      expect((await store.findAccounts('a\\', 100)).map((a) => a.nameKey)).toEqual(['a\\ck']);
      expect((await store.findAccounts('a', 100)).map((a) => a.nameKey)).toEqual(['a%ck', 'a\\ck', 'a_ck', 'abck', 'ann', 'axck']);
      expect((await store.findAccounts('', 100)).map((a) => a.nameKey)).toEqual(['Betak', 'a%ck', 'a\\ck', 'a_ck', 'abck', 'ann', 'axck', 'zzzk']);
      // a credential's subject (a provider's `sub` is any text) and a relation's other account
      await store.putCredential({ account: accId(10), provider: 'shopify', subject: 'gid-b', secret: null, meta: {}, createdAt: T0, lastUsedAt: null });
      await store.putCredential({ account: accId(10), provider: 'shopify', subject: 'gid-B', secret: null, meta: {}, createdAt: T0, lastUsedAt: null });
      await store.putCredential({ account: accId(10), provider: 'passkey', subject: 'z', secret: 'k', meta: {}, createdAt: T0, lastUsedAt: null });
      expect((await store.credentials(accId(10))).map((c) => `${c.provider}:${c.subject}`)).toEqual([`local:${accId(10)}`, 'passkey:z', 'shopify:gid-B', 'shopify:gid-b']);
    });

    it('a registration that fails at its last step leaves nothing of the earlier ones: not the key, the account, the credential, the session nor the device', async () => {
      await store.createAccount(newAccount(1, 'Ann', 'ann'), T0);
      const taken = auditOf(5, 'signedIn', accId(1), { provider: 'local', device: false, restricted: false });
      await store.appendAudit([taken]);
      const second = { ...newAccount(2, 'Ben', 'ben'), audit: [{ ...auditOf(5, 'registered', accId(2), { provider: 'local', claimed: false }) }] };
      await refused(store.createAccount(second, T0), 'exists');
      expect(await store.account(accId(2))).toBeNull();
      expect(await store.nameEntry('ben', 1)).toBeNull();
      expect(await store.credentialBySubject('local', accId(2))).toBeNull();
      expect(await store.sessionByTokenHash(second.session.tokenHash)).toBeNull();
      expect(await store.device(second.device.hash)).toBeNull();
      expect(await store.recoveryCodes(accId(2))).toEqual([]);
      expect(await store.nameHistory(accId(2))).toEqual([]);
      // and the key is free for the next registration
      await store.createAccount(newAccount(3, 'Ben', 'ben'), T0);
      expect((await store.nameEntry('ben', 1))?.account).toBe(accId(3));
    });

    it('a rename that fails at its last step (a history row that does not follow) changes nothing: the key it claimed is free again', async () => {
      await store.createAccount(newAccount(1, 'Hal', 'hal'), T0);
      const a = (await store.account(accId(1)))!;
      await refused(store.rename(a.id, a.version, historyOf(1, 'Hank', 'hank', T0), renameOpts(T0)), 'conflict');
      expect(await store.nameEntry('hank', 1)).toBeNull();
      expect(await store.account(a.id)).toEqual(a);
      const b = await store.rename(a.id, a.version, historyOf(1, 'Hank', 'hank', at(1)), renameOpts(at(1)));
      expect(b.nameKey).toBe('hank');
    });

    it('purge by policy against the real clock, by category: what is past its retention goes, what is not stays, and a second run finds nothing', async () => {
      const far = { expiresAt: ago(-1000) };
      const old = { account: { createdAt: ago(500) } };
      await store.createAccount({ ...newAccount(1, 'Ada', 'ada', old), session: sessionOf(1, 0, far), audit: [] }, T0);
      await store.createAccount({ ...newAccount(2, 'Bea', 'bea', old), session: sessionOf(2, 0, far), audit: [] }, T0);
      await store.updateDevice(sha('device:1:0'), { lastUsedAt: ago(100) });
      await store.updateDevice(sha('device:2:0'), { lastUsedAt: ago(400) });
      // sessions: revoked 8 days ago (goes), revoked a day ago (stays), expired 8 days ago (goes), live (stays)
      await store.putSession(sessionOf(1, 1, { ...far, revokedAt: ago(8), revokeReason: 'signOut' }));
      await store.putSession(sessionOf(1, 2, { ...far, revokedAt: ago(1), revokeReason: 'signOut' }));
      await store.putSession(sessionOf(1, 3, { expiresAt: ago(8) }));
      // email codes: used (goes), expired (goes), live (stays)
      await store.putEmailCode(emailCodeOf(1, accId(1), 'verify', ago(2), { usedAt: ago(2), expiresAt: ago(-1) }), ago(2));
      await store.putEmailCode(emailCodeOf(2, accId(1), 'reset', ago(2), { expiresAt: ago(1) }), ago(2));
      await store.putEmailCode(emailCodeOf(3, accId(1), 'reset', ago(0), { expiresAt: ago(-1) }), ago(0));
      // names: a passed hold (goes), a running hold (stays), a reservation without an end (stays)
      const a = (await store.account(accId(1)))!;
      const a2 = await store.rename(a.id, a.version, historyOf(1, 'Adah', 'adah', ago(30)), renameOpts(ago(30), { holdUntil: ago(1) }));
      await store.rename(a2.id, a2.version, historyOf(1, 'Adele', 'adele', ago(20)), renameOpts(ago(20), { holdUntil: ago(-30) }));
      await store.putNameEntry({ key: 'staff', keyVersion: 1, kind: 'reserved', account: null, until: null, note: null, createdAt: T0 });
      // reports: closed 400 days ago (goes), closed 100 days ago (stays), open (stays)
      await store.putReport(reportOf(1, null, { account: accId(2) }, 'Bea', { status: 'dismissed', closedAt: ago(400), closedBy: 'op' }));
      await store.putReport(reportOf(2, null, { account: accId(2) }, 'Bea', { status: 'actioned', closedAt: ago(100), closedBy: 'op' }));
      await store.putReport(reportOf(3, null, { account: accId(2) }, 'Bea'));
      // tombstones: hold over (goes), hold running (stays)
      for (const [n, hold] of [[5, ago(1)], [6, ago(-30)]] as const) {
        await store.createAccount({ ...newAccount(n, `Gone${n}`, `gone${n}`), session: sessionOf(n, 0, far), audit: [] }, T0);
        await claimErasure(store, accId(n), ago(2));
        await store.erase(accId(n), tombstoneOf(accId(n), nowIso), hold);
      }
      // changes: 10 days old (goes), a day old (stays)
      await store.appendChange({ at: ago(10), account: accId(1), kind: 'avatar' });
      await store.appendChange({ at: ago(1), account: accId(1), kind: 'avatar' });
      const report = await store.purge(DEFAULT_ACCOUNT_RETENTION, nowIso);
      // names: Ada's first key (hold passed) and Gone5's (hold passed)
      expect(report).toEqual({ sessions: 2, devices: 1, emailCodes: 2, names: 2, reports: 1, audit: 0, changes: 1, tombstones: 1 });
      expect((await store.sessionsOf(accId(1))).map((s) => s.id)).toEqual([sessionOf(1, 0).id, sessionOf(1, 2).id]);
      expect(await store.device(sha('device:2:0'))).toBeNull();
      expect(await store.device(sha('device:1:0'))).not.toBeNull();
      expect((await store.liveEmailCodes(accId(1), 'reset', nowIso)).map((c) => c.id)).toHaveLength(1);
      expect(await store.nameEntry('ada', 1)).toBeNull();
      expect(await store.nameEntry('adah', 1)).toMatchObject({ kind: 'held' });
      expect(await store.nameEntry('staff', 1)).not.toBeNull();
      expect((await store.reports({ limit: 10 })).map((r) => r.id)).toEqual([reportId(2), reportId(3)]);
      expect(await store.tombstone(accId(5))).toBeNull();
      expect(await store.tombstone(accId(6))).not.toBeNull();
      expect((await store.changes(0, 10)).map((c) => c.seq)).toEqual([2]);
      expect(await store.purge(DEFAULT_ACCOUNT_RETENTION, nowIso)).toEqual({ sessions: 0, devices: 0, emailCodes: 0, names: 0, reports: 0, audit: 0, changes: 0, tombstones: 0 });
    });

    it('erase scrubs the name and the address of the account from every row of every table that holds typed text, past one page of its scan (SCRUB_PAGE rows): reports, sanctions, appeals and names', async () => {
      const rows = SCRUB_PAGE * 2 + 37;
      expect(SCRUB_PAGE).toBeGreaterThan(0);
      await store.createAccount(newAccount(1, 'Quillfeather', 'qulllfeather', { account: { email: { address: 'quill@example.org', verifiedAt: null } } }), T0);
      await store.createAccount(newAccount(2, 'Yarrow', 'yarrow'), T0);
      const Y = accId(2);
      const id = (prefix: string, n: number): string => `${prefix}_${String(n).padStart(8, '0')}`;
      // the rows of the other account, made in bulk by the owner: every one names the account in each field that holds typed text
      await kit.admin(async (sql) => {
        await sql.query(
          `INSERT INTO accounts.reports (id, reporter_kind, reporter_source, target_account, target_name, reason, text, note, status, created_at)
           SELECT 'rep_' || lpad(i::text, 8, '0'), 'system', 'ladder', $1::text, 'Yarrow', 'chat', 'QUILLFEATHER said ' || i, 'mail quill@example.org about quillfeather ' || i, 'new', now()
           FROM generate_series(1, $2::int) i`,
          [Y, rows],
        );
        await sql.query(
          `INSERT INTO accounts.sanctions (id, account_id, kind, reason, message, note, created_at, created_by, since)
           SELECT 'san_' || lpad(i::text, 8, '0'), $1::text, 'warn', 'chat', 'For what you said to Quillfeather ' || i, 'see the quill@example.org report ' || i, now(), 'op', now()
           FROM generate_series(1, $2::int) i`,
          [Y, rows],
        );
        await sql.query(
          `INSERT INTO accounts.appeals (sanction_id, account_id, text, created_at, answer, answer_message, answered_at, answered_by)
           SELECT 'san_' || lpad(i::text, 8, '0'), $1::text, 'quillfeather started it ' || i, now(), 'upheld', 'What Quillfeather did ' || i, now(), 'op'
           FROM generate_series(1, $2::int) i`,
          [Y, rows],
        );
        // reserved keys with a note that names the account, and, for every third, the name they were made from; every seventh key has a second version
        await sql.query(
          `INSERT INTO accounts.names (key, key_version, kind, account_id, until, note, created_at, name)
           SELECT 'k' || lpad(i::text, 8, '0'), v, 'reserved', NULL, NULL, 'too close to Quillfeather ' || i, now(), CASE WHEN i % 3 = 0 THEN 'Quillfeather' || i ELSE 'Other' || i END
           FROM generate_series(1, $1::int) i, generate_series(1, 2) v WHERE v = 1 OR i % 7 = 0`,
          [rows],
        );
      });
      await claimErasure(store, accId(1));
      await store.erase(accId(1), tombstoneOf(accId(1), at(DAY)), at(91 * DAY));
      const left = await kit.admin(async (sql) => {
        const count = async (table: string, cols: string[]): Promise<number> =>
          Number((await sql.query<{ n: unknown }>(`SELECT count(*) AS n FROM accounts.${table} WHERE ${cols.map((x) => `${x} ~* '(quillfeather|quill@example)'`).join(' OR ')}`)).rows[0]!.n);
        const total = async (table: string): Promise<number> => Number((await sql.query<{ n: unknown }>(`SELECT count(*) AS n FROM accounts.${table}`)).rows[0]!.n);
        return {
          reports: [await count('reports', ['text', 'note']), await total('reports')],
          sanctions: [await count('sanctions', ['message', 'note']), await total('sanctions')],
          appeals: [await count('appeals', ['text', 'answer_message']), await total('appeals')],
          names: [await count('names', ['note', 'name', 'key']), await total('names')],
        };
      });
      // no row keeps a word of it, and no row was lost (the names: every key, a second version of every seventh, and the two accounts' own)
      expect(left).toEqual({ reports: [0, rows], sanctions: [0, rows], appeals: [0, rows], names: [0, rows + Math.floor(rows / 7) + 2] });
      const r = (await store.report(id('rep', rows)))!;
      expect([r.text, r.note]).toEqual([`Deleted player said ${rows}`, `mail Deleted player about Deleted player ${rows}`]);
      expect((await store.sanction(id('san', rows)))!.message).toBe(`For what you said to Deleted player ${rows}`);
      expect((await store.appeals({ limit: 1, after: id('san', rows - 1) }))[0]).toMatchObject({ text: `Deleted player started it ${rows}`, answerMessage: `What Deleted player did ${rows}` });
      // a reserved key's name is dropped whole where it held the account's name, and kept where it did not; both versions of a key
      expect(await store.nameEntry(id('k', rows).replace('_', ''), 1)).toMatchObject({ note: `too close to Deleted player ${rows}` });
      expect(await store.nameEntry(id('k', 3).replace('_', ''), 1)).not.toHaveProperty('name');
      expect(await store.nameEntry(id('k', 4).replace('_', ''), 1)).toMatchObject({ name: 'Other4' });
      expect(await store.nameEntry(id('k', 21).replace('_', ''), 2)).not.toHaveProperty('name');
      expect(await store.nameEntry(id('k', 28).replace('_', ''), 2)).toMatchObject({ name: 'Other28' });
    });
  });
}
