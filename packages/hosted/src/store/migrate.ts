/**
 * PostgreSQL migrations (M13-4, design 8.2): versioned SQL files in `packages/hosted/migrations/NNN_name.sql`, applied in order, each in its own
 * transaction under an advisory lock (two migrators never interleave), recorded in `schema_migrations`. Run by the operator's migrate command with the
 * owner's role (M13-14 wires the command); the service checks the version at start (`PostgresStore.open`) and never runs DDL itself.
 *
 * One runner for every package (M14-11, accounts design 11.5): each package keeps its migration folder and its tables in a schema of its own, with
 * its own `<schema>.schema_migrations`, and the command runs the packages in order, **accounts, then hosted, then ladder** (hosted's `erase_player`
 * reads `accounts.accounts`, which must exist first): `migrate(sql, { schema: 'accounts', dir: ACCOUNTS_MIGRATIONS_DIR })`, then hosted's own. The
 * schema is created when it is missing. One advisory lock key serves every package (`MIGRATION_LOCK_KEY`), so two migrators of any packages never
 * interleave. Each package states the version it needs (`SCHEMA_VERSION` here, `ACCOUNTS_SCHEMA_VERSION` in @openmtg/accounts, the ladder's) and checks
 * it with `schemaVersion(sql, schema)` when it opens.
 *
 * Hosted's own call names no schema: its `schema_migrations` and tables are found through the `search_path` as they always were (the migrating role
 * and the service's role share one; `public` by default). INTERFACE CHANGE (M14-11): the design writes `{ schema: 'public', dir: MIGRATIONS_DIR }`;
 * both options are optional here instead, so m13's calls and tests that pass neither are unchanged, and a test database that keeps hosted's tables in
 * a schema of its own through `search_path` (m13's real-server kit) still finds them.
 *
 * Least privilege (review minor 6; for M13-14's operator notes and the database setup):
 * - The service's role: SELECT on `schema_migrations` (the version check at open); SELECT, INSERT, UPDATE, DELETE on sessions, games, seats,
 *   actions, snapshots and bug_reports; only INSERT and SELECT on results and placements (the ledger is append-only and kept: no UPDATE, no DELETE).
 *   No DDL, no ownership of the tables. Accounts' rights are `accounts.grant_service` (accounts migration 001).
 * - `schemaVersion` without a schema finds `schema_migrations` through `to_regclass`, which follows the role's `search_path`: give the migrating role
 *   and the service's role the same search_path (or put both in the schema that holds the tables).
 * - The database must use UTF8 (`migrate` refuses another server encoding): the text rules (store/rules.ts) and the jsonb CHECKs assume it.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { SqlClient } from './sql';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Which package's migrations, and where (M14-11). */
export interface MigrateOptions {
  /** The package's schema, whose `schema_migrations` records them (created when missing). Omitted: hosted's own, through the `search_path`. */
  schema?: string;
  /** The package's migration folder (default: hosted's `MIGRATIONS_DIR`). */
  dir?: string;
}

/** The directory of hosted's migration files. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/** The schema version hosted needs (the newest migration's number). */
export const SCHEMA_VERSION = 1;

/** Arbitrary key of the migrators' advisory lock: one for every package (M14-11). */
export const MIGRATION_LOCK_KEY = 0x4f4d5447; // "OMTG"

/** The migrations in `dir`, by version; throws for a malformed name or a repeated version. */
export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const out: Migration[] = [];
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith('.sql')) continue;
    const m = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!m) throw new Error(`migrations: ${file} is not named NNN_name.sql`);
    const version = Number(m[1]);
    if (out.some((x) => x.version === version)) throw new Error(`migrations: version ${version} given twice`);
    out.push({ version, name: m[2]!, sql: await readFile(`${dir}/${file}`, 'utf8') });
  }
  return out.sort((a, b) => a.version - b.version);
}

/** A schema name safe to put in DDL: lower-case letters, digits and underscores, not starting with a digit (the names of the packages' schemas). */
function schemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error(`migrate: ${JSON.stringify(schema)} is not a schema name (lower-case letters, digits and underscores)`);
  return schema;
}

/** `schema_migrations` of a schema (qualified), or unqualified (through the `search_path`) when no schema is named. */
const migrationsTable = (schema: string | undefined): string => (schema === undefined ? 'schema_migrations' : `${schemaName(schema)}.schema_migrations`);

/** The applied version (0 before the first migration) of the package whose schema is `schema` (omitted: hosted's own, through the `search_path`). */
export async function schemaVersion(sql: SqlClient, schema?: string): Promise<number> {
  const table = migrationsTable(schema);
  const t = await sql.query<{ t: string | null }>('SELECT to_regclass($1)::text AS t', [table]);
  if (t.rows[0]?.t == null) return 0;
  const r = await sql.query<{ v: number | null }>(`SELECT max(version) AS v FROM ${table}`);
  return r.rows[0]?.v ?? 0;
}

/**
 * Applies every migration of the package that is newer than its database's version; returns the versions applied. Refuses a database whose encoding
 * is not UTF8.
 */
export async function migrate(sql: SqlClient, opts: MigrateOptions = {}): Promise<number[]> {
  const table = migrationsTable(opts.schema);
  const enc = (await sql.query<{ server_encoding: string }>('SHOW server_encoding')).rows[0]?.server_encoding;
  if (enc !== 'UTF8') throw new Error(`migrate: the database's server encoding is ${String(enc)}; OpenMTG needs UTF8 (create the database with ENCODING 'UTF8')`);
  const list = await loadMigrations(opts.dir);
  const applied: number[] = [];
  for (const m of list) {
    const done = await sql.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      // the schema is made here, not by the migration: `schema_migrations` goes in it first (and public exists already)
      if (opts.schema !== undefined) {
        const missing = await tx.query<{ missing: boolean }>('SELECT to_regnamespace($1) IS NULL AS missing', [opts.schema]);
        if (missing.rows[0]?.missing) await tx.exec(`CREATE SCHEMA ${schemaName(opts.schema)}`);
      }
      await tx.exec(`CREATE TABLE IF NOT EXISTS ${table} (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
      const has = await tx.query(`SELECT 1 FROM ${table} WHERE version = $1`, [m.version]);
      if (has.rows.length > 0) return false;
      await tx.exec(m.sql);
      await tx.query(`INSERT INTO ${table} (version, name) VALUES ($1, $2)`, [m.version, m.name]);
      return true;
    });
    if (done) applied.push(m.version);
  }
  return applied;
}
