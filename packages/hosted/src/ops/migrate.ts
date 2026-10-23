/**
 * The operator's migrate command (design 8.2, 10.1; package M13-14): applies every package's pending migrations in order, **accounts, then hosted**
 * (the ladder after them when it has migrations: add its line to `MIGRATION_PACKAGES`), with the database OWNER's role, and then gives the SERVICE's role its
 * rights. The service never runs DDL (design 11): `PostgresStore.open` only checks the version; this command is the only thing that changes the schema.
 *
 * The service role's rights are the ones store/migrate.ts's header states: SELECT, INSERT, UPDATE and DELETE on the game tables; only SELECT and INSERT on
 * `results` and `placements` (the ledger is append-only and kept); SELECT on `schema_migrations`; for the accounts schema, `accounts.grant_service(role)`.
 * `SERVICE_RIGHTS` names every table of hosted's schema once; a table that no rule names stops the command ("the rights do not name table X") instead of
 * leaving the service without access in production, and test/m13-14 fails until the rule is added.
 */
import { ACCOUNTS_MIGRATIONS_DIR, ACCOUNTS_SCHEMA } from '@openmtg/accounts';
import { MIGRATIONS_DIR, migrate, schemaVersion } from '../store/migrate';
import type { SqlClient } from '../store/sql';

/** A package's migrations: the schema that holds its tables and `schema_migrations` (undefined: hosted's, through the `search_path`) and its folder. */
export interface MigrationPackage {
  name: string;
  schema?: string;
  dir: string;
}

/** In the order they run: accounts first (hosted's `erase_player` reads `accounts.accounts`), then hosted; the ladder's goes after them. */
export const MIGRATION_PACKAGES: readonly MigrationPackage[] = [
  { name: 'accounts', schema: ACCOUNTS_SCHEMA, dir: ACCOUNTS_MIGRATIONS_DIR },
  { name: 'hosted', dir: MIGRATIONS_DIR },
];

/** What the service's role may do with each of hosted's tables (store/migrate.ts's header; design 8.2). */
export const SERVICE_RIGHTS = {
  /** SELECT, INSERT, UPDATE, DELETE. */
  readWrite: ['sessions', 'games', 'seats', 'actions', 'snapshots', 'bug_reports'],
  /** SELECT, INSERT: the results ledger is append-only and kept. */
  appendOnly: ['results', 'placements'],
  /** SELECT: the version check at start. */
  readOnly: ['schema_migrations'],
} as const;

/** Every table the rules name. */
export const RIGHTS_TABLES: readonly string[] = [...SERVICE_RIGHTS.readWrite, ...SERVICE_RIGHTS.appendOnly, ...SERVICE_RIGHTS.readOnly];

/** A name safe to put in DDL: lower-case letters, digits and underscores, not starting with a digit (a role or a schema). */
export function sqlName(name: string, what: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new MigrateError(`${what} ${JSON.stringify(name)} is not a name this command uses (lower-case letters, digits and underscores)`);
  return `"${name}"`;
}

/** The GRANT statements that give `role` the rights of `SERVICE_RIGHTS` on the tables of `schema`. */
export function grantStatements(role: string, schema: string): string[] {
  const to = sqlName(role, 'the service role');
  const s = sqlName(schema, 'the schema');
  const on = (tables: readonly string[]) => tables.map((t) => `${s}."${t}"`).join(', ');
  return [
    `GRANT USAGE ON SCHEMA ${s} TO ${to}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${on(SERVICE_RIGHTS.readWrite)} TO ${to}`,
    `GRANT SELECT, INSERT ON ${on(SERVICE_RIGHTS.appendOnly)} TO ${to}`,
    `GRANT SELECT ON ${on(SERVICE_RIGHTS.readOnly)} TO ${to}`,
  ];
}

/** A refusal the operator can act on (not a bug): the message says what to do. */
export class MigrateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrateError';
  }
}

export interface MigrateReport {
  /** The versions applied per package (empty: already current), and the version each is at now. */
  packages: { name: string; applied: number[]; version: number }[];
  /** The role that was given its rights, if one was named. */
  granted: string | null;
}

/** Hosted's tables as the database has them, in the schema the `search_path` puts them in. */
async function hostedTables(sql: SqlClient): Promise<{ schema: string; tables: string[] }> {
  const schema = (await sql.query<{ s: string | null }>('SELECT current_schema() AS s')).rows[0]?.s;
  if (!schema) throw new MigrateError('the connection has no current schema (check the role\'s search_path)');
  const rows = await sql.query<{ t: string }>(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name", [schema],
  );
  return { schema, tables: rows.rows.map((r) => r.t) };
}

/** Gives `role` its rights on hosted's tables and, when the accounts schema is there, on accounts'. Throws `MigrateError` for a role that does not exist or a table no rule names. */
export async function grantServiceRole(sql: SqlClient, role: string): Promise<void> {
  sqlName(role, 'the service role');
  const exists = await sql.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (exists.rows.length === 0) {
    throw new MigrateError(`the role ${JSON.stringify(role)} does not exist: create it first (docs/ops/hosted.md, "The database roles"), then run migrate again`);
  }
  const { schema, tables } = await hostedTables(sql);
  const unnamed = tables.filter((t) => !RIGHTS_TABLES.includes(t));
  if (unnamed.length > 0) throw new MigrateError(`the rights do not name table ${unnamed.join(', ')} (src/ops/migrate.ts SERVICE_RIGHTS): not granted`);
  const missing = RIGHTS_TABLES.filter((t) => !tables.includes(t));
  if (missing.length > 0) throw new MigrateError(`the rights name table ${missing.join(', ')}, which the database does not have: migrate first`);
  await sql.transaction(async (tx) => {
    for (const statement of grantStatements(role, schema)) await tx.exec(statement);
    const accounts = await tx.query<{ t: string | null }>('SELECT to_regnamespace($1)::text AS t', [ACCOUNTS_SCHEMA]);
    if (accounts.rows[0]?.t != null) await tx.query(`SELECT ${sqlName(ACCOUNTS_SCHEMA, 'the schema')}.grant_service($1)`, [role]);
  });
}

/** Applies the pending migrations of every package, in order; then, with `grantTo`, gives that role its rights. */
export async function migrateAll(sql: SqlClient, o: { grantTo?: string | null; packages?: readonly MigrationPackage[] } = {}): Promise<MigrateReport> {
  if (o.grantTo) sqlName(o.grantTo, 'the service role');
  const report: MigrateReport = { packages: [], granted: null };
  for (const p of o.packages ?? MIGRATION_PACKAGES) {
    const applied = await migrate(sql, { ...(p.schema !== undefined ? { schema: p.schema } : {}), dir: p.dir });
    report.packages.push({ name: p.name, applied, version: await schemaVersion(sql, p.schema) });
  }
  if (o.grantTo) {
    await grantServiceRole(sql, o.grantTo);
    report.granted = o.grantTo;
  }
  return report;
}
