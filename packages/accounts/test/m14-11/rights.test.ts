/**
 * M14-11: the audit kinds and the rights of design 11.5 (13.2): `audit_kinds` equal to AUDIT_CATEGORY, the closed sets of the CHECKs pinned against the
 * code's own lists, and the service's role: what `accounts.grant_service` gives it, and above all that it cannot UPDATE or DELETE an audit event (nor
 * TRUNCATE, nor change `audit_kinds` or `schema_migrations`, nor run any DDL, nor call grant_service), while an unprivileged role reaches nothing.
 * On PGlite, and on a real server when OPENMTG_TEST_PG_URL is set (each statement is tried in a transaction of the owner's connection under
 * `SET LOCAL ROLE` and rolled back).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIT_CATEGORY, AUDIT_KINDS, REPORT_REASONS, ACCOUNTS_SCHEMA, openPostgresAccountStore } from '@openmtg/accounts';
import { EMAIL_PURPOSES, NAME_KINDS, PROVIDERS, RELATION_KINDS, REVOKE_REASONS, SANCTION_ENDS } from '../../src/store/rules';
import { accId, auditOf, newAccount, T0 } from '../m14-4/contract';
import { attempt, kits, SERVICE_ROLE } from './harness';

const NOBODY = 'openmtg_accounts_test_nobody';

/** A column of each table to UPDATE to itself in the privilege check. */
const firstColumn: Record<string, string> = {
  accounts: 'id', names: 'key', name_meta: 'current_version', name_history: 'name', credentials: 'subject', recovery_codes: 'slot', devices: 'hash', sessions: 'id',
  guest_claims: 'session_id', relations: 'kind', email_codes: 'id', reports: 'id', sanctions: 'id', appeals: 'text', changes: 'seq', change_head: 'last_seq', tombstones: 'account_id',
};

for (const kit of kits()) {
  describe(`M14-11 audit kinds and rights (${kit.name})`, { timeout: 60_000 }, () => {
    beforeAll(async () => {
      await kit.reset();
      await kit.admin(async (sql) => {
        await sql.exec(`DROP ROLE IF EXISTS ${NOBODY}`);
        await sql.exec(`CREATE ROLE ${NOBODY}`);
      });
    });
    afterAll(async () => {
      await kit.admin((sql) => sql.exec(`DROP ROLE IF EXISTS ${NOBODY}`)).catch(() => undefined);
      await kit.end();
    });

    const rows = <R>(text: string, params: unknown[] = []) => kit.admin(async (sql) => (await sql.query<R>(text, params)).rows);

    describe('audit_kinds', () => {
      it('equals AUDIT_CATEGORY: every kind with its category, and nothing else', async () => {
        const r = await rows<{ kind: string; category: string }>('SELECT kind, category FROM accounts.audit_kinds');
        expect(Object.fromEntries(r.map((x) => [x.kind, x.category]))).toEqual({ ...AUDIT_CATEGORY });
        expect(r).toHaveLength(AUDIT_KINDS.length);
      });

      it('an event of a kind it does not list is refused by the database itself, whoever writes it', async () => {
        expect(await attempt(kit, 'NONE', `INSERT INTO accounts.audit (id, at, kind, actor, details) VALUES ('x', now(), 'hacked', 'self', '{}')`)).toMatch(/foreign key|violates/i);
        expect(await attempt(kit, 'NONE', `INSERT INTO accounts.audit (id, at, kind, actor, details) VALUES ('x', now(), 'signedIn', 'root', '{}')`)).toMatch(/check|violates/i);
        expect(await attempt(kit, 'NONE', `INSERT INTO accounts.audit (id, at, kind, actor, details) VALUES ('x', now(), 'signedIn', 'admin:', '{}')`)).toMatch(/check|violates/i);
        expect(await attempt(kit, 'NONE', `INSERT INTO accounts.audit (id, at, kind, actor, details) VALUES ('x', now(), 'signedIn', 'admin:op', '{}')`)).toBe('allowed');
      });
    });

    describe('the closed sets of the CHECKs follow the code\'s own lists', () => {
      /** The quoted values of the CHECK on `table`.`column` that reads `column = ANY (ARRAY[...])`. */
      async function checkValues(table: string, column: string): Promise<string[]> {
        const r = await rows<{ def: string }>(
          `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.contype = 'c' AND c.conrelid = $1::regclass`,
          [`accounts.${table}`],
        );
        const def = r.map((x) => x.def).find((d) => d.startsWith(`CHECK (((${column}) = ANY`) || d.startsWith(`CHECK ((${column} = ANY`));
        expect(def, `${table}.${column}`).toBeDefined();
        return [...def!.matchAll(/'([^']*)'::text/g)].map((m) => m[1]!).sort();
      }
      const sorted = (l: readonly string[]) => [...l].sort();

      it.each([
        ['names', 'kind', NAME_KINDS],
        ['credentials', 'provider', PROVIDERS],
        ['sessions', 'provider', PROVIDERS],
        ['sessions', 'client', ['desktop', 'web']],
        ['sessions', 'revoke_reason', REVOKE_REASONS],
        ['relations', 'kind', RELATION_KINDS],
        ['email_codes', 'purpose', EMAIL_PURPOSES],
        ['reports', 'reason', REPORT_REASONS],
        ['reports', 'status', ['new', 'actioned', 'dismissed']],
        ['reports', 'reporter_kind', ['account', 'guest', 'system']],
        ['sanctions', 'kind', ['warn', 'mute', 'rename', 'unlist', 'suspend', 'ban']],
        ['sanctions', 'reason', [...REPORT_REASONS, 'evasion']],
        ['sanctions', 'end_reason', SANCTION_ENDS],
        ['appeals', 'answer', ['upheld', 'lifted']],
        ['name_history', 'cause', ['register', 'rename', 'forced']],
        ['changes', 'kind', ['sessionRevoked', 'sessionsRevoked', 'standing', 'renamed', 'avatar', 'deleting', 'deleted']],
        ['audit_kinds', 'category', ['security', 'moderation', 'operator']],
      ] as const)('%s.%s', async (table, column, expected) => {
        expect(await checkValues(table, column)).toEqual(sorted(expected));
      });
    });

    describe('the service\'s role', () => {
      it('has exactly the privileges of design 11.5 on every table: all four, but SELECT and INSERT on audit, SELECT on audit_kinds, schema_migrations, deletion_policy and purge_ledger, and SELECT and DELETE on accounts', async () => {
        const r = await rows<{ t: string; s: boolean; i: boolean; u: boolean; d: boolean; trunc: boolean; refs: boolean; trig: boolean }>(
          `SELECT c.relname AS t,
                  has_table_privilege($1, c.oid, 'SELECT') AS s, has_table_privilege($1, c.oid, 'INSERT') AS i,
                  has_table_privilege($1, c.oid, 'UPDATE') AS u, has_table_privilege($1, c.oid, 'DELETE') AS d,
                  has_table_privilege($1, c.oid, 'TRUNCATE') AS trunc, has_table_privilege($1, c.oid, 'REFERENCES') AS refs,
                  has_table_privilege($1, c.oid, 'TRIGGER') AS trig
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'accounts' AND c.relkind = 'r' ORDER BY c.relname`,
          [SERVICE_ROLE],
        );
        expect(r.length).toBe(23);
        const priv = (x: (typeof r)[number]) => `${x.s ? 'S' : ''}${x.i ? 'I' : ''}${x.u ? 'U' : ''}${x.d ? 'D' : ''}`;
        const expected = (t: string) =>
          t === 'audit' ? 'SI' : ['audit_kinds', 'schema_migrations', 'deletion_policy', 'purge_ledger'].includes(t) ? 'S' : t === 'accounts' ? 'SD' : 'SIUD';
        for (const x of r) {
          expect(priv(x), x.t).toBe(expected(x.t));
          expect([x.trunc, x.refs, x.trig], `${x.t}: TRUNCATE, REFERENCES, TRIGGER`).toEqual([false, false, false]);
        }
      });

      it('writes the accounts table on every column but the erasure claim\'s three (deletion_requested_at, purge_at, erasing_at): it reads all, inserts and updates the rest', async () => {
        const r = await rows<{ c: string; s: boolean; i: boolean; u: boolean }>(
          `SELECT a.attname AS c, has_column_privilege($1, a.attrelid, a.attnum, 'SELECT') AS s, has_column_privilege($1, a.attrelid, a.attnum, 'INSERT') AS i,
                  has_column_privilege($1, a.attrelid, a.attnum, 'UPDATE') AS u
           FROM pg_attribute a WHERE a.attrelid = 'accounts.accounts'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
          [SERVICE_ROLE],
        );
        expect(r.length).toBe(21);
        const claim = ['deletion_requested_at', 'purge_at', 'erasing_at'];
        for (const x of r) expect([x.c, x.s, x.i, x.u], x.c).toEqual([x.c, true, !claim.includes(x.c), !claim.includes(x.c)]);
      });

      it('may use the schema and run the functions of the migration but grant_service, and nothing else: no CREATE', async () => {
        const r = await rows<Record<string, boolean>>(
          `SELECT has_schema_privilege($1, 'accounts', 'USAGE') AS usage, has_schema_privilege($1, 'accounts', 'CREATE') AS create,
                  has_function_privilege($1, 'accounts.purge_audit(text, bigint, bigint)', 'EXECUTE') AS purge,
                  has_function_privilege($1, 'accounts.erasure_claimed(text)', 'EXECUTE') AS claimed,
                  has_function_privilege($1, 'accounts.request_deletion(text, timestamptz, timestamptz)', 'EXECUTE') AS request,
                  has_function_privilege($1, 'accounts.move_deletion(text, timestamptz)', 'EXECUTE') AS move,
                  has_function_privilege($1, 'accounts.cancel_deletion(text)', 'EXECUTE') AS cancel,
                  has_function_privilege($1, 'accounts.claim_erasure(text, timestamptz)', 'EXECUTE') AS claim,
                  has_function_privilege($1, 'accounts.grant_service(name)', 'EXECUTE') AS grant_service`,
          [SERVICE_ROLE],
        );
        expect(r[0]).toEqual({ usage: true, create: false, purge: true, claimed: true, request: true, move: true, cancel: true, claim: true, grant_service: false });
      });

      it('has no EXECUTE on any function of the schema for PUBLIC: a role with USAGE on the schema still cannot run them (the REVOKE of the migration, not the missing USAGE, is what says so)', async () => {
        const signatures = [
          'accounts.purge_audit(text, bigint, bigint)', 'accounts.erasure_claimed(text)', 'accounts.request_deletion(text, timestamptz, timestamptz)',
          'accounts.move_deletion(text, timestamptz)', 'accounts.cancel_deletion(text)', 'accounts.claim_erasure(text, timestamptz)', 'accounts.grant_service(name)',
        ];
        // every function the schema has is one of them
        const all = await rows<{ n: string }>(`SELECT p.oid::regprocedure::text AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'accounts'`);
        expect(all.map((x) => x.n).sort()).toEqual([...signatures].map((x) => x.replace(/timestamptz/g, 'timestamp with time zone').replace(/, /g, ',')).sort());
        await kit.admin((sql) => sql.exec(`GRANT USAGE ON SCHEMA accounts TO ${NOBODY}`));
        try {
          for (const sig of signatures) {
            const r = await rows<{ ok: boolean }>('SELECT has_function_privilege($1, $2, $3) AS ok', [NOBODY, sig, 'EXECUTE']);
            expect(r[0]!.ok, sig).toBe(false);
          }
          expect(await attempt(kit, NOBODY, `SELECT accounts.purge_audit('x')`)).toMatch(/permission denied for function purge_audit/);
          expect(await attempt(kit, NOBODY, `SELECT accounts.claim_erasure('x', now())`)).toMatch(/permission denied for function claim_erasure/);
          expect(await attempt(kit, NOBODY, 'SELECT 1 FROM accounts.accounts')).toMatch(/permission denied for table accounts/);
        } finally {
          await kit.admin((sql) => sql.exec(`REVOKE USAGE ON SCHEMA accounts FROM ${NOBODY}`));
        }
      });

      it('cannot UPDATE or DELETE an audit event, nor TRUNCATE the log, but writes and reads it; the database says so itself', async () => {
        await kit.reset();
        const store = await openPostgresAccountStore(kit.service());
        await store.createAccount(newAccount(1, 'Ada', 'ada'), T0);
        await store.appendAudit([auditOf(7, 'signedIn', accId(1), { provider: 'local', device: false, restricted: false })]);
        const denied = /permission denied for table audit/;
        expect(await attempt(kit, SERVICE_ROLE, `UPDATE accounts.audit SET kind = 'signedOut'`)).toMatch(denied);
        expect(await attempt(kit, SERVICE_ROLE, `UPDATE accounts.audit SET account_id = NULL WHERE id = 'aud_00000000000000000000000007'`)).toMatch(denied);
        expect(await attempt(kit, SERVICE_ROLE, `DELETE FROM accounts.audit`)).toMatch(denied);
        expect(await attempt(kit, SERVICE_ROLE, `DELETE FROM accounts.audit WHERE false`)).toMatch(denied);
        expect(await attempt(kit, SERVICE_ROLE, `TRUNCATE accounts.audit`)).toMatch(/permission denied/);
        expect(await attempt(kit, SERVICE_ROLE, `SELECT count(*) FROM accounts.audit`)).toBe('allowed');
        expect(await attempt(kit, SERVICE_ROLE, `INSERT INTO accounts.audit (id, at, kind, actor, details) VALUES ('x', now(), 'signedIn', 'self', '{}')`)).toBe('allowed');
        expect((await store.audit({ limit: 10 })).map((e) => e.kind).sort()).toEqual(['registered', 'signedIn']);
      });

      it('cannot change audit_kinds, schema_migrations, deletion_policy or purge_ledger, write the erasure claim, run DDL, or call grant_service', async () => {
        for (const s of [
          `UPDATE accounts.deletion_policy SET min_grace_ms = 0`,
          `INSERT INTO accounts.deletion_policy (min_grace_ms, max_skew_ms) VALUES (0, 0)`,
          `DELETE FROM accounts.deletion_policy`,
          `INSERT INTO accounts.purge_ledger (account_id, removed, anonymised, called_by) VALUES ('x', 0, 0, 'me')`,
          `UPDATE accounts.purge_ledger SET removed = 0`,
          `DELETE FROM accounts.purge_ledger`,
          `TRUNCATE accounts.purge_ledger`,
          `UPDATE accounts.accounts SET purge_at = now() WHERE false`,
          `UPDATE accounts.accounts SET erasing_at = now() WHERE false`,
          `UPDATE accounts.accounts SET deletion_requested_at = now() WHERE false`,
          `UPDATE accounts.accounts SET purge_at = NULL, erasing_at = NULL, deletion_requested_at = NULL`,
          `INSERT INTO accounts.accounts (id, name, name_key, key_version, avatar, privacy, age_min, age_passed_at, created_at, free_rename, version, purge_at)
             VALUES ('x', 'x', 'x', 1, 'd6-blue', '{}', 13, now(), now(), false, 1, now())`,
          `INSERT INTO accounts.accounts (id, name, name_key, key_version, avatar, privacy, age_min, age_passed_at, created_at, free_rename, version, erasing_at)
             VALUES ('x', 'x', 'x', 1, 'd6-blue', '{}', 13, now(), now(), false, 1, now())`,

          `INSERT INTO accounts.audit_kinds (kind, category) VALUES ('mine', 'operator')`,
          `UPDATE accounts.audit_kinds SET category = 'operator' WHERE kind = 'signedIn'`,
          `DELETE FROM accounts.audit_kinds WHERE kind = 'signedIn'`,
          `INSERT INTO accounts.schema_migrations (version, name) VALUES (9, 'x')`,
          `UPDATE accounts.schema_migrations SET version = 9`,
          `DELETE FROM accounts.schema_migrations`,
          `CREATE TABLE accounts.mine (id integer)`,
          `DROP TABLE accounts.accounts`,
          `ALTER TABLE accounts.accounts ADD COLUMN mine integer`,
          `DROP INDEX accounts.accounts_due`,
          `CREATE TRIGGER mine BEFORE INSERT ON accounts.sessions FOR EACH ROW EXECUTE FUNCTION pg_catalog.suppress_redundant_updates_trigger()`,
          `CREATE OR REPLACE FUNCTION accounts.purge_audit(account text DEFAULT NULL, a bigint DEFAULT NULL, b bigint DEFAULT NULL) RETURNS bigint LANGUAGE sql AS 'SELECT 0::bigint'`,
          `DROP FUNCTION accounts.purge_audit(text, bigint, bigint)`,
          `ALTER FUNCTION accounts.purge_audit(text, bigint, bigint) SECURITY INVOKER`,
          `SELECT accounts.grant_service('${NOBODY}')`,
        ]) {
          expect(await attempt(kit, SERVICE_ROLE, s), s).toMatch(/permission denied|must be owner/);
        }
      });

      it('may do everything else the store does to the other tables (a row is changed, deleted, inserted)', async () => {
        for (const t of ['accounts', 'names', 'name_meta', 'name_history', 'credentials', 'recovery_codes', 'devices', 'sessions', 'guest_claims', 'relations', 'email_codes',
          'reports', 'sanctions', 'appeals', 'changes', 'change_head', 'tombstones']) {
          expect(await attempt(kit, SERVICE_ROLE, `UPDATE accounts.${t} SET ${firstColumn[t]} = ${firstColumn[t]} WHERE false`), `UPDATE ${t}`).toBe('allowed');
          expect(await attempt(kit, SERVICE_ROLE, `DELETE FROM accounts.${t} WHERE false`), `DELETE ${t}`).toBe('allowed');
        }
      });
    });

    describe('a role that was never granted anything', () => {
      it('reaches nothing: not the schema, not a table, not a function', async () => {
        for (const s of [
          'SELECT 1 FROM accounts.accounts',
          'SELECT 1 FROM accounts.audit',
          'SELECT 1 FROM accounts.audit_kinds',
          `INSERT INTO accounts.audit (id, at, kind, actor, details) VALUES ('x', now(), 'signedIn', 'self', '{}')`,
          `SELECT accounts.purge_audit('x')`,
          `SELECT accounts.erasure_claimed('x')`,
          `SELECT accounts.grant_service('${NOBODY}')`,
          'CREATE TABLE accounts.mine (id integer)',
        ]) {
          expect(await attempt(kit, NOBODY, s), s).toMatch(/permission denied/);
        }
      });
    });

    describe('accounts.grant_service', () => {
      it('is run by the owner for a role, again after a migration adds a table, and is not callable by the service itself', async () => {
        await kit.admin(async (sql) => {
          await sql.exec(`CREATE TABLE accounts.later (id integer)`);
        });
        try {
          expect(await attempt(kit, SERVICE_ROLE, 'SELECT 1 FROM accounts.later')).toMatch(/permission denied/);
          await kit.admin((sql) => sql.query('SELECT accounts.grant_service($1)', [SERVICE_ROLE]));
          for (const s of ['SELECT 1 FROM accounts.later', 'INSERT INTO accounts.later VALUES (1)', 'UPDATE accounts.later SET id = 2', 'DELETE FROM accounts.later']) {
            expect(await attempt(kit, SERVICE_ROLE, s), s).toBe('allowed');
          }
          // and still not what audit and audit_kinds never had
          expect(await attempt(kit, SERVICE_ROLE, 'DELETE FROM accounts.audit')).toMatch(/permission denied/);
          expect(await attempt(kit, SERVICE_ROLE, `INSERT INTO accounts.audit_kinds (kind, category) VALUES ('mine', 'operator')`)).toMatch(/permission denied/);
        } finally {
          await kit.admin((sql) => sql.exec('DROP TABLE accounts.later'));
        }
      });

      it('names the role as an identifier: a role that does not exist is an error, and a name with a quote or a semicolon is only a name', async () => {
        await expect(kit.admin((sql) => sql.query('SELECT accounts.grant_service($1)', ['no_such_role_here']))).rejects.toThrow(/does not exist/);
        await expect(kit.admin((sql) => sql.query('SELECT accounts.grant_service($1)', ['x"; DROP SCHEMA accounts CASCADE; --']))).rejects.toThrow(/does not exist/);
        expect((await rows<{ n: number }>(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'accounts'`))[0]!.n).toBe(1);
      });
    });

    describe('the functions', () => {
      it('are owned by the migrating role; purge_audit and the four deletion functions are the SECURITY DEFINER ones, and every one pins its search_path', async () => {
        const r = await rows<{ proname: string; definer: boolean; owner: string; me: string; config: string[] | null }>(
          `SELECT p.proname, p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS owner, current_user AS me, p.proconfig AS config
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'accounts' ORDER BY p.proname`,
        );
        expect(r.map((x) => [x.proname, x.definer])).toEqual([
          ['cancel_deletion', true], ['claim_erasure', true], ['erasure_claimed', false], ['grant_service', false], ['move_deletion', true], ['purge_audit', true],
          ['request_deletion', true],
        ]);
        for (const x of r) {
          expect(x.owner, x.proname).toBe(x.me);
          expect(x.config, x.proname).toEqual(['search_path=pg_catalog, pg_temp']);
        }
        // and the tables belong to the same role, not to the service
        const owners = await rows<{ owner: string; me: string }>(
          `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner, current_user AS me FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'accounts' AND c.relkind IN ('r', 'i')`,
        );
        expect(owners).toEqual([{ owner: owners[0]!.me, me: owners[0]!.me }]);
      });
    });
  });
}

