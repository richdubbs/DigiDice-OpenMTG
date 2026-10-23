/**
 * The stores (M13-4, design 8): `MemoryStore` (unit tests), `FileStore` (development), `PostgresStore` (production; PGlite in tests), the migrations
 * and the `SqlClient` seam. Every store implements `GameStore` (store/api.ts).
 */
import type { StoreKind } from '../config';
import type { GameStore } from './api';
import { FileStore } from './file';
import { MemoryStore } from './memory';
import { migrate } from './migrate';
import { PostgresStore } from './postgres';
import { createPgPool, pgClient } from './sql';

export { FileStore, scanLog, writeAtomic, type FileStoreOptions } from './file';
export { MemoryStore, type MemoryStoreOptions } from './memory';
export { PostgresStore, type PostgresStoreOptions } from './postgres';
export { loadMigrations, migrate, MIGRATIONS_DIR, SCHEMA_VERSION, schemaVersion, type Migration } from './migrate';
export { createPgPool, pgClient, pgliteClient, type PgliteLike, type SqlClient, type SqlQueryable, type SqlResult } from './sql';
export { jsonbProblem, STORE_ID, StoreError, textProblem, type StoreErrorCode } from './rules';

/** Every store's type (M13-1's `GameStore`, with M13-4's additive methods). */
export type HostedStore = GameStore;

export interface OpenStoreOptions {
  kind: StoreKind;
  /** The file store's directory (`DATA_DIR`). */
  dataDir?: string;
  /** PostgreSQL (`DATABASE_URL`). */
  databaseUrl?: string | null;
  /** Apply pending migrations first (development only: in production the operator migrates with the owner's role). */
  migrate?: boolean;
  now?: () => Date;
}

/** Opens the configured store (config.ts `store`, `dataDir`, `databaseUrl`). */
export async function openStore(o: OpenStoreOptions): Promise<HostedStore> {
  const now = o.now ? { now: o.now } : {};
  switch (o.kind) {
    case 'memory':
      return new MemoryStore(now);
    case 'file':
      if (!o.dataDir) throw new Error('openStore: the file store needs a data directory');
      return FileStore.open(o.dataDir, now);
    case 'postgres': {
      if (!o.databaseUrl) throw new Error('openStore: the postgres store needs DATABASE_URL');
      const sql = pgClient(await createPgPool(o.databaseUrl));
      try {
        if (o.migrate) await migrate(sql);
        return await PostgresStore.open(sql, now);
      } catch (e) {
        await sql.close().catch(() => undefined);
        throw e;
      }
    }
  }
}
