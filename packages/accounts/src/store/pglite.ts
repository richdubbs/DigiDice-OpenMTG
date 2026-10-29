/**
 * The development store (ACCOUNTS_STORE=file, under ACCOUNTS_DATA_DIR; F26, replacing M14-4's journal-and-snapshot file store): the production
 * PostgreSQL store (src/store/postgres.ts) on PGlite, PostgreSQL compiled to WebAssembly and run in process, so development runs the same SQL as
 * production with no database server. In `<dir>`:
 *
 *   <dir>/lock    the lock (src/store/lock.ts): PGlite has none of its own, and two processes on one database corrupt it
 *   <dir>/db/     the PGlite database (PostgreSQL's own files)
 * (mail/ and exports/ beside them are FileMailer's and the operator's export files, M14-8 and M14-7.)
 *
 * - Opening makes the directory (0700: the store holds personal data; one that was there is narrowed to that), takes the lock, opens the database
 *   (made at the first open, a few seconds; later opens take well under a second) and applies the package's migrations it has not applied yet,
 *   recorded in `accounts.schema_migrations` as hosted's migration runner records them, so the database has the shape the production one has.
 * - A database made here gets the owner's deletion policy (`accounts.deletion_policy`) with no minimum grace, as the old file store had: the
 *   operator's `delete --now` works without the owner's step that migration 001 asks of a production database. The clock skew limit stays.
 * - The store runs as the database's owner (a development database has no service role). Closing the store closes the database and releases the lock.
 * - An erasure removes the rows (the contract suite's check), but PostgreSQL leaves the bytes of deleted rows in its files until it reuses the
 *   space, as a production database does; the old file store rewrote its files at every erase.
 * - `@electric-sql/pglite` is a development dependency of this package (installed with it in development; never in a production image), imported
 *   only when this store is opened.
 */
import { chmod, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountsSql, AccountsSqlQueryable, AccountStoreLimits } from './api';
import { takeLock } from './lock';
import { liveCodesLimit } from './memory';
import { ACCOUNTS_MIGRATIONS_DIR, ACCOUNTS_SCHEMA, PostgresAccountStore } from './postgres';

/** The database's folder in the store's directory (the lock file beside it is src/store/lock.ts's STORE_LOCK_FILE). */
export const PGLITE_DB_DIR = 'db';

export interface PgliteAccountStoreOptions extends AccountStoreLimits {
  /** ACCOUNTS_DATA_DIR. */
  dir: string;
  /** Told when a stale lock is taken over (default: process.emitWarning). */
  onWarning?: (message: string) => void;
}

/** What this file uses of a PGlite database (structural, so the type of the package is needed only where it is imported). */
interface PgliteQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
}
interface PgliteDb extends PgliteQueryable {
  transaction<T>(fn: (tx: PgliteQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function queryable(db: PgliteQueryable): AccountsSqlQueryable {
  return {
    async query<R>(text: string, params: readonly unknown[] = []) {
      const r = await db.query(text, [...params]);
      return { rows: r.rows as R[], rowCount: r.affectedRows ?? 0 };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
  };
}

/**
 * The package's migrations not yet applied, each in its own transaction, recorded in `<schema>.schema_migrations` with the table hosted's runner
 * makes (packages/hosted/src/store/migrate.ts: the schema made first, version and name). With the first one, a new database's deletion policy (the header).
 */
async function migrate(sql: AccountsSql): Promise<void> {
  const table = `${ACCOUNTS_SCHEMA}.schema_migrations`;
  const files = (await readdir(ACCOUNTS_MIGRATIONS_DIR)).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  for (const file of files) {
    const version = Number(file.slice(0, 3));
    const text = await readFile(join(ACCOUNTS_MIGRATIONS_DIR, file), 'utf8');
    await sql.transaction(async (tx) => {
      await tx.exec(
        `CREATE SCHEMA IF NOT EXISTS ${ACCOUNTS_SCHEMA};
         CREATE TABLE IF NOT EXISTS ${table} (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
      );
      if ((await tx.query(`SELECT 1 FROM ${table} WHERE version = $1`, [version])).rows.length > 0) return;
      await tx.exec(text);
      await tx.query(`INSERT INTO ${table} (version, name) VALUES ($1, $2)`, [version, file.slice(4, -'.sql'.length)]);
      if (version === 1) await tx.exec(`UPDATE ${ACCOUNTS_SCHEMA}.deletion_policy SET min_grace_ms = 0`);
    });
  }
}

/**
 * Opens the development store in `opts.dir` (the header). 'locked' while another opener holds it; 'schema' for a database newer than this build;
 * RangeError for a live-code cap that is not a whole number from 0.
 */
export async function openPgliteAccountStore(opts: PgliteAccountStoreOptions): Promise<PostgresAccountStore> {
  const { dir, onWarning, ...limits } = opts;
  liveCodesLimit(limits); // a bad limit is refused (RangeError) before the directory is touched
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode counts only for a directory it makes: one that was there (made by another part, restored from a backup) is narrowed too
  if (process.platform !== 'win32') await chmod(dir, 0o700);
  const lock = await takeLock(dir, onWarning ?? ((m: string) => process.emitWarning(m)));
  let db: PgliteDb | null = null;
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    const opened: PgliteDb = (db = await PGlite.create(join(dir, PGLITE_DB_DIR)));
    const sql: AccountsSql = {
      ...queryable(opened),
      transaction: (fn) => opened.transaction((tx) => fn(queryable(tx))),
      async close() {
        try {
          await opened.close();
        } finally {
          await lock.release();
        }
      },
    };
    await migrate(sql);
    return await PostgresAccountStore.open(sql, limits);
  } catch (e) {
    await db?.close().catch(() => undefined);
    await lock.release().catch(() => undefined);
    throw e;
  }
}
