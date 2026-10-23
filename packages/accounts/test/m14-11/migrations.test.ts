/**
 * M14-11: migration 001 on an empty database, and hosted's per-package runner with it (design 11.5, 13.2): the schema `accounts` with its own
 * `accounts.schema_migrations`, run before hosted's own migration on one database, each leaving the other alone; the store refusing a database that is
 * not at ACCOUNTS_SCHEMA_VERSION; the tables, the indexes the design names, the collation of the key columns, and no client address stored anywhere.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNTS_MIGRATIONS_DIR, ACCOUNTS_SCHEMA, ACCOUNTS_SCHEMA_VERSION, AccountStoreError, openPostgresAccountStore, PostgresAccountStore } from '@openmtg/accounts';
import { loadMigrations, MIGRATIONS_DIR, migrate, schemaVersion } from '../../../hosted/src/store/migrate';
import { pgliteClient, type SqlClient } from '../../../hosted/src/store/sql';

let db: PGlite;
let sql: SqlClient;
beforeEach(async () => {
  db = await PGlite.create();
  sql = pgliteClient(db);
});
afterEach(async () => {
  await sql.close();
});

const migrateAccounts = () => migrate(sql, { schema: ACCOUNTS_SCHEMA, dir: ACCOUNTS_MIGRATIONS_DIR });
const rows = async <R>(text: string, params: unknown[] = []): Promise<R[]> => (await sql.query<R>(text, params)).rows;

describe('M14-11 migration 001', () => {
  it('is the one migration of the package, 001_accounts, and ACCOUNTS_SCHEMA_VERSION is its number', async () => {
    const list = await loadMigrations(ACCOUNTS_MIGRATIONS_DIR);
    expect(list.map((m) => [m.version, m.name])).toEqual([[1, 'accounts']]);
    expect(ACCOUNTS_SCHEMA_VERSION).toBe(list[list.length - 1]!.version);
    expect(ACCOUNTS_SCHEMA).toBe('accounts');
    expect(readdirSync(ACCOUNTS_MIGRATIONS_DIR)).toEqual(['001_accounts.sql']);
  });

  it('on an empty database: applied once, recorded in accounts.schema_migrations, a second run applies nothing', async () => {
    expect(await schemaVersion(sql, ACCOUNTS_SCHEMA)).toBe(0);
    expect(await migrateAccounts()).toEqual([1]);
    expect(await migrateAccounts()).toEqual([]);
    expect(await schemaVersion(sql, ACCOUNTS_SCHEMA)).toBe(ACCOUNTS_SCHEMA_VERSION);
    expect(await rows('SELECT version, name FROM accounts.schema_migrations')).toEqual([{ version: 1, name: 'accounts' }]);
  });

  it('makes exactly the tables of design 11.5 (with the two single-row tables), all in the schema accounts and none in public', async () => {
    await migrateAccounts();
    const tables = (await rows<{ schemaname: string; tablename: string }>(`SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('accounts', 'public') ORDER BY tablename`));
    expect(tables.filter((t) => t.schemaname === 'public')).toEqual([]);
    expect(tables.map((t) => t.tablename)).toEqual([
      'accounts', 'appeals', 'audit', 'audit_kinds', 'change_head', 'changes', 'credentials', 'deletion_policy', 'devices', 'email_codes', 'guest_claims',
      'name_history', 'name_meta', 'names', 'purge_ledger', 'recovery_codes', 'relations', 'reports', 'sanctions', 'schema_migrations', 'sessions', 'tombstones',
      'write_pad',
    ]);
    // the two single rows the store reads: the name data version, and the newest change seq
    expect(await rows('SELECT current_version FROM accounts.name_meta')).toEqual([{ current_version: 1 }]);
    expect(await rows('SELECT last_seq FROM accounts.change_head')).toEqual([{ last_seq: 0 }]);
    await expect(sql.query('INSERT INTO accounts.name_meta (only_row, current_version) VALUES (false, 2)')).rejects.toThrow();
    await expect(sql.query('INSERT INTO accounts.change_head (last_seq) VALUES (5)')).rejects.toThrow();
    // the owner's deletion policy (an hour, five minutes), and the pad the store writes where it has no row to make
    expect(await rows('SELECT min_grace_ms, max_skew_ms FROM accounts.deletion_policy')).toEqual([{ min_grace_ms: 3_600_000, max_skew_ms: 300_000 }]);
    expect(await rows('SELECT n FROM accounts.write_pad')).toEqual([{ n: 0 }]);
    await expect(sql.query('INSERT INTO accounts.deletion_policy (min_grace_ms, max_skew_ms) VALUES (1, 1)')).rejects.toThrow();
    await expect(sql.query('INSERT INTO accounts.write_pad (n) VALUES (1)')).rejects.toThrow();
  });

  it('has the indexes the design names: (purge_at, id) and (coalesce(last_sign_in_at, created_at), id) for the rights part\'s cursors, and a unique name key', async () => {
    await migrateAccounts();
    const idx = Object.fromEntries((await rows<{ indexname: string; indexdef: string }>(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'accounts'`)).map((r) => [r.indexname, r.indexdef]));
    expect(idx['accounts_due']).toMatch(/\(purge_at, id\) WHERE \(purge_at IS NOT NULL\)/);
    expect(idx['accounts_inactive']).toMatch(/\(COALESCE\(last_sign_in_at, created_at\), id\) WHERE \(purge_at IS NULL\)/);
    expect(idx['accounts_name_key_key_version_key']).toMatch(/UNIQUE INDEX .*\(name_key, key_version\)/);
    expect(idx['names_pkey']).toMatch(/\(key, key_version\)/);
    for (const name of ['credentials_pkey', 'sessions_token_hash_key', 'sessions_previous_hash_key', 'recovery_codes_pkey', 'name_history_pkey', 'guest_claims_pkey',
      'relations_pkey', 'appeals_pkey', 'audit_account', 'audit_kind', 'changes_pkey', 'sanctions_running', 'sanctions_ending', 'reports_status', 'tombstones_pkey']) {
      expect(Object.keys(idx), name).toContain(name);
    }
  });

  it('keeps id and key columns in code-point order whatever the database\'s collation (COLLATE "C"), and no client address anywhere', async () => {
    await migrateAccounts();
    const cols = await rows<{ table_name: string; column_name: string; collation_name: string | null; data_type: string }>(
      `SELECT table_name, column_name, collation_name, data_type FROM information_schema.columns WHERE table_schema = 'accounts'`,
    );
    const key = (t: string, c: string) => cols.find((x) => x.table_name === t && x.column_name === c)?.collation_name;
    for (const [t, c] of [['accounts', 'id'], ['accounts', 'name_key'], ['names', 'key'], ['credentials', 'subject'], ['sessions', 'id'], ['sessions', 'token_hash'],
      ['reports', 'id'], ['sanctions', 'id'], ['appeals', 'sanction_id'], ['audit', 'id'], ['audit', 'kind'], ['devices', 'hash'], ['email_codes', 'id']] as const) {
      expect(key(t, c), `${t}.${c}`).toBe('C');
    }
    // every text column is either one that must be in code-point order (an id, a key, a hash, a subject: ordered, paged and compared by the store) or free text
    // that never is: a new column must be put in one list, and the first list holds COLLATE "C" for good (the database's own collation may already be C, as
    // PGlite's is, which would hide a column that lost it)
    const MUST_BE_C = [
      'accounts.id', 'accounts.name_key', 'appeals.sanction_id', 'appeals.account_id', 'audit.id', 'audit.kind', 'audit.account_id', 'audit.session_id',
      'audit_kinds.kind', 'changes.account_id', 'changes.session_id', 'credentials.provider', 'credentials.subject', 'credentials.account_id', 'devices.hash',
      'devices.account_id', 'email_codes.id', 'email_codes.account_id', 'email_codes.hash', 'guest_claims.session_id', 'guest_claims.account_id',
      'name_history.account_id', 'name_history.key', 'names.key', 'names.account_id', 'purge_ledger.account_id', 'recovery_codes.account_id',
      'recovery_codes.hash', 'relations.account_id', 'relations.other_id', 'reports.id', 'reports.reporter_account', 'reports.reporter_session',
      'reports.target_account', 'reports.target_session', 'reports.game_id', 'sanctions.id', 'sanctions.account_id', 'sessions.id', 'sessions.account_id',
      'sessions.token_hash', 'sessions.previous_hash', 'sessions.device_hash', 'tombstones.account_id',
    ];
    const FREE_TEXT = [
      'accounts.name', 'accounts.avatar', 'accounts.email', 'appeals.text', 'appeals.answer', 'appeals.answer_message', 'appeals.answered_by', 'audit.actor',
      'audit.actor_os', 'audit.address_tag', 'audit_kinds.category', 'changes.kind', 'credentials.secret', 'email_codes.purpose', 'name_history.name',
      'name_history.cause', 'names.kind', 'names.note', 'names.name', 'purge_ledger.called_by', 'relations.kind', 'reports.reporter_kind',
      'reports.reporter_source', 'reports.target_name', 'reports.reason', 'reports.text', 'reports.status', 'reports.closed_by', 'reports.note',
      'sanctions.kind', 'sanctions.reason', 'sanctions.message', 'sanctions.note', 'sanctions.created_by', 'sanctions.end_reason', 'sanctions.ended_by',
      'sessions.provider', 'sessions.client', 'sessions.revoke_reason', 'schema_migrations.name',
    ];
    const texts = cols.filter((c) => c.data_type === 'text');
    expect(texts.map((c) => `${c.table_name}.${c.column_name}`).sort()).toEqual([...MUST_BE_C, ...FREE_TEXT].sort());
    for (const name of MUST_BE_C) {
      const [t, c] = name.split('.') as [string, string];
      expect(key(t, c), name).toBe('C');
    }
    // D15: addresses are never stored; the only column named for one is the keyed tag of an address key
    expect(cols.filter((c) => /addr|(^|_)ip($|_)/i.test(c.column_name)).map((c) => `${c.table_name}.${c.column_name}`)).toEqual(['audit.address_tag']);
    // jsonb only for small server-built JSON; everything players type is text
    const jsonb = cols.filter((c) => c.data_type === 'jsonb').map((c) => `${c.table_name}.${c.column_name}`).sort();
    expect(jsonb).toEqual(['accounts.privacy', 'audit.details', 'changes.detail', 'credentials.meta', 'reports.evidence']);
    expect(cols.find((c) => c.table_name === 'reports' && c.column_name === 'text')?.data_type).toBe('text');
    expect(cols.find((c) => c.table_name === 'changes' && c.column_name === 'seq')?.data_type).toBe('bigint');
  });

  it('is plain SQL in the schema: it creates no role and grants nothing by itself (the operator runs accounts.grant_service)', async () => {
    const text = readFileSync(join(ACCOUNTS_MIGRATIONS_DIR, '001_accounts.sql'), 'utf8');
    const code = text.replace(/^--.*$/gm, '');
    expect(code).not.toMatch(/CREATE\s+(ROLE|USER)|ALTER\s+ROLE/i);
    expect(code).not.toMatch(/^\s*GRANT\b/im);
    // every statement names its schema: no object goes to whatever search_path says
    expect(code).not.toMatch(/CREATE\s+(TABLE|INDEX|FUNCTION)\s+(?!IF NOT EXISTS)(?!accounts\.)\w+\s*[(]/i);
  });
});

describe('M14-11 the runner with accounts, then hosted', () => {
  it('migrates accounts first and hosted second on one database; each keeps its own schema_migrations and neither touches the other', async () => {
    expect(await migrateAccounts()).toEqual([1]);
    expect(await migrate(sql, { dir: MIGRATIONS_DIR })).toEqual([1]);
    expect(await schemaVersion(sql, ACCOUNTS_SCHEMA)).toBe(1);
    expect(await schemaVersion(sql)).toBe(1);
    expect(await rows('SELECT name FROM accounts.schema_migrations')).toEqual([{ name: 'accounts' }]);
    expect(await rows('SELECT name FROM public.schema_migrations')).toEqual([{ name: 'initial' }]);
    // hosted's tables are in public, accounts' in accounts; a second round changes nothing
    expect((await rows<{ t: string | null }>(`SELECT to_regclass('public.games')::text AS t`))[0]!.t).toBe('games');
    expect((await rows<{ t: string | null }>(`SELECT to_regclass('accounts.games')::text AS t`))[0]!.t).toBeNull();
    expect(await migrateAccounts()).toEqual([]);
    expect(await migrate(sql, { dir: MIGRATIONS_DIR })).toEqual([]);
  });

  it('either order works on an empty database (hosted\'s erase_player needs accounts migrated first, which the operator\'s command orders)', async () => {
    expect(await migrate(sql, { dir: MIGRATIONS_DIR })).toEqual([1]);
    expect(await migrateAccounts()).toEqual([1]);
  });
});

describe('M14-11 the store at open', () => {
  it('refuses a database that is not migrated, and one at another version, with the code schema; opens one at the version', async () => {
    const refused = async (): Promise<unknown> => openPostgresAccountStore({ ...sql, close: async () => {} }).then(() => null, (e: unknown) => e);
    const none = await refused();
    expect(none).toBeInstanceOf(AccountStoreError);
    expect(none).toMatchObject({ code: 'schema' });
    expect((none as Error).message).toMatch(/version 0/);
    await migrateAccounts();
    const store = await openPostgresAccountStore({ ...sql, close: async () => {} });
    await store.close();
    await sql.query(`INSERT INTO accounts.schema_migrations (version, name) VALUES (2, 'future')`);
    expect(await refused()).toMatchObject({ code: 'schema' });
  });

  it('refuses a live-code cap that is not a whole number from 0 (RangeError) before it touches the database', async () => {
    for (const bad of [-1, 1.5, Number.NaN]) await expect(PostgresAccountStore.open({ ...sql, close: async () => {} }, { emailResetLiveCodes: bad }), String(bad)).rejects.toThrow(RangeError);
  });

  it('closing the store closes the AccountsSql once', async () => {
    await migrateAccounts();
    let closed = 0;
    const store = await openPostgresAccountStore({ ...sql, close: async () => void closed++ });
    await store.close();
    await store.close();
    expect(closed).toBe(1);
  });
});
