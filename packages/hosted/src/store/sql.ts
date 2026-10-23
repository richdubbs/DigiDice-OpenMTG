/**
 * The `SqlClient` seam (M13-4, design 8.1): the PostgreSQL store's only way to the database, so the same code runs on a `pg` pool (production) and on
 * PGlite (PostgreSQL compiled to WebAssembly, in process: the tests and, if wanted, a database-free development run). Parameterized queries only.
 */
import type { Pool, PoolClient, PoolConfig } from 'pg';

export interface SqlResult<R> {
  rows: R[];
  /** Rows changed by an INSERT, UPDATE or DELETE. */
  rowCount: number;
}

export interface SqlQueryable {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<SqlResult<R>>;
  /** Several statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface SqlClient extends SqlQueryable {
  /** Runs `fn` in one transaction on one connection: committed when it resolves, rolled back when it throws. */
  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ---- pg -----------------------------------------------------------------------------------------------------------------------------------------

const pgParam = (v: unknown): unknown => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v);

function pgQueryable(c: Pick<PoolClient, 'query'>): SqlQueryable {
  return {
    async query<R>(text: string, params: readonly unknown[] = []): Promise<SqlResult<R>> {
      const r = await c.query(text, params.map(pgParam));
      return { rows: r.rows as R[], rowCount: r.rowCount ?? 0 };
    },
    async exec(sql: string): Promise<void> {
      await c.query(sql);
    },
  };
}

/** A `SqlClient` on a `pg` pool (it owns the pool: `close` ends it). */
export function pgClient(pool: Pool): SqlClient {
  const q = pgQueryable(pool);
  return {
    ...q,
    async transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T> {
      const c = await pool.connect();
      let broken: Error | undefined;
      try {
        await c.query('BEGIN');
        try {
          const out = await fn(pgQueryable(c));
          await c.query('COMMIT');
          return out;
        } catch (e) {
          await c.query('ROLLBACK').catch((re: unknown) => {
            broken = re instanceof Error ? re : new Error(String(re));
          });
          throw e;
        }
      } finally {
        c.release(broken);
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

/** A pool for `DATABASE_URL` (the `pg` driver; `max` connections, 10 by default). */
export async function createPgPool(connectionString: string, opts: Omit<PoolConfig, 'connectionString'> = {}): Promise<Pool> {
  const pg = (await import('pg')).default;
  return new pg.Pool({ connectionString, max: 10, ...opts });
}

// ---- PGlite (structural: no import, so the server does not depend on it) ------------------------------------------------------------------------

interface PgliteResult {
  rows: unknown[];
  affectedRows?: number;
}
interface PgliteQueryable {
  query(text: string, params?: unknown[]): Promise<PgliteResult>;
  exec(sql: string): Promise<unknown>;
}
export interface PgliteLike extends PgliteQueryable {
  transaction<T>(fn: (tx: PgliteQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function pgliteQueryable(db: PgliteQueryable): SqlQueryable {
  return {
    async query<R>(text: string, params: readonly unknown[] = []): Promise<SqlResult<R>> {
      const r = await db.query(text, [...params]);
      return { rows: r.rows as R[], rowCount: r.affectedRows ?? 0 };
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
  };
}

/** A `SqlClient` on a PGlite database (`new PGlite()` from `@electric-sql/pglite`; it owns it: `close` closes it). */
export function pgliteClient(db: PgliteLike, opts: { closeDb?: boolean } = {}): SqlClient {
  return {
    ...pgliteQueryable(db),
    transaction: <T>(fn: (tx: SqlQueryable) => Promise<T>) => db.transaction((tx) => fn(pgliteQueryable(tx))),
    async close(): Promise<void> {
      if (opts.closeDb !== false) await db.close();
    },
  };
}
