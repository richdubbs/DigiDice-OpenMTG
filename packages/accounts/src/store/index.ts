/**
 * The account stores (M14-4; design 11.2): the memory store (unit tests), the file store under ACCOUNTS_DATA_DIR (development) and, at the sync (M14-11,
 * 11.5), the PostgreSQL store (production), all kept by one contract suite (test/m14-4/contract.ts). src/compose.ts imports the first two factories by
 * these names and src/index.ts re-exports this file (`export *`), so only these names leave it: the factories, the classes (tests reach `dump()` and
 * the file store's `dir` through them), the file store's options and file names, and the PostgreSQL store's schema, version and migrations folder
 * (hosted's migration runner takes them: `migrate(sql, { schema: ACCOUNTS_SCHEMA, dir: ACCOUNTS_MIGRATIONS_DIR })`, before its own).
 */
import type { CreateMemoryAccountStore, OpenFileAccountStore, OpenPostgresAccountStore } from './api';
import { FileAccountStore } from './file';
import { MemoryAccountStore } from './memory';
import { PostgresAccountStore } from './postgres';

export { MemoryAccountStore } from './memory';
export { FileAccountStore, FILE_STORE_FILES, type FileAccountStoreOptions } from './file';
export { PostgresAccountStore, ACCOUNTS_SCHEMA, ACCOUNTS_SCHEMA_VERSION, ACCOUNTS_MIGRATIONS_DIR, CHANGES_LOCK_KEY, ERASE_LOCK_KEY } from './postgres';

/** The memory store (unit tests): a new, empty store each call, with the configured limits (AccountStoreLimits) when given. */
export const createMemoryAccountStore: CreateMemoryAccountStore = (opts) =>
  new MemoryAccountStore(undefined, { emailResetLiveCodes: opts?.emailResetLiveCodes });
/**
 * The file store under `dir` (ACCOUNTS_DATA_DIR, development): takes the lock ('locked' while another process holds it), cuts a torn last journal
 * line, replays the journal after the snapshot's lastSeq, and writes a fresh snapshot. With the configured limits (AccountStoreLimits) when given.
 */
export const openFileAccountStore: OpenFileAccountStore = (opts) =>
  FileAccountStore.open({ dir: opts.dir, emailResetLiveCodes: opts.emailResetLiveCodes });
/**
 * The PostgreSQL store on a migrated database (design 11.5), with the configured limits (AccountStoreLimits) when given. Refuses ('schema') a database
 * whose `accounts` schema is not at ACCOUNTS_SCHEMA_VERSION. Closing the store closes the `AccountsSql`. Hosted passes it to composeAccounts as `host.store`.
 */
export const openPostgresAccountStore: OpenPostgresAccountStore = (sql, opts) => PostgresAccountStore.open(sql, opts);
