/**
 * STUB (M15-1): M15-7 fills this file (design 13.7, D20) and owns it from then on: `PostgresLadderStore`, the LadderStore on PostgreSQL in a schema
 * of its own (`ladder`, migration packages/ladder/migrations/001_ladder.sql, its own `ladder.schema_migrations`), run by hosted's migration command
 * through M14-11's per-schema runner after accounts' and hosted's (M15-8 adds the entry). The service role never runs DDL.
 *
 * src/index.ts re-exports this file with `export *` and is never edited after M15-1, so whatever else of M15-7's hosted needs from the package root
 * (the class itself, the migrations folder) M15-7 exports from here.
 */
import type { LadderStore } from './api';

// ---- The seam (13.7): the shape of m14's AccountsSql, which hosted's SqlClient (m13 store/sql.ts) satisfies; the ladder imports nothing of hosted (D1)
export interface LadderSqlResult<R> {
  rows: R[];
  /** Rows changed by an INSERT, UPDATE or DELETE. */
  rowCount: number;
}
export interface LadderSqlQueryable {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<LadderSqlResult<R>>;
  /** Several statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
}
export interface LadderSql extends LadderSqlQueryable {
  /** Runs `fn` in one transaction on one connection: committed when it resolves, rolled back when it throws. */
  transaction<T>(fn: (tx: LadderSqlQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The version of schema `ladder` this build needs (`ladder.schema_migrations`; migration 001_ladder.sql). */
export const LADDER_SCHEMA_VERSION = 1;

/**
 * Opens the PostgreSQL store on a migrated database: refuses a schema `ladder` at another version than LADDER_SCHEMA_VERSION (run the migrate command
 * first). One transaction per applyGame and markSkipped (13.7).
 */
export async function openPostgresLadderStore(sql: LadderSql): Promise<LadderStore> {
  void sql;
  throw new Error('not built yet (M15-7): openPostgresLadderStore');
}
