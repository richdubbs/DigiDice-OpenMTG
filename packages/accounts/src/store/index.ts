/**
 * The account stores (M14-4, M14-11; design 11.2, 11.5): the memory store (unit tests), the PostgreSQL store (production) and the development store
 * under ACCOUNTS_DATA_DIR, which is the PostgreSQL store on PGlite in that directory (src/store/pglite.ts; F26: it replaced the journal-and-snapshot
 * file store). The two kinds of store are kept by one contract suite (test/m14-4/contract.ts, run on the memory store and on PostgreSQL). src/compose.ts
 * imports the first two factories by these names and src/index.ts re-exports this file (`export *`), so only these names leave it: the factories,
 * the classes (tests reach the memory store's `dump()` through it), and the PostgreSQL store's schema, version and migrations folder (hosted's
 * migration runner takes them: `migrate(sql, { schema: ACCOUNTS_SCHEMA, dir: ACCOUNTS_MIGRATIONS_DIR })`, before its own).
 */
import type { CreateMemoryAccountStore, OpenFileAccountStore, OpenPostgresAccountStore } from './api';
import { MemoryAccountStore } from './memory';
import { openPgliteAccountStore } from './pglite';
import { PostgresAccountStore } from './postgres';

export { MemoryAccountStore } from './memory';
export { PostgresAccountStore, ACCOUNTS_SCHEMA, ACCOUNTS_SCHEMA_VERSION, ACCOUNTS_MIGRATIONS_DIR, CHANGES_LOCK_KEY, ERASE_LOCK_KEY } from './postgres';

/** The memory store (unit tests): a new, empty store each call, with the configured limits (AccountStoreLimits) when given. */
export const createMemoryAccountStore: CreateMemoryAccountStore = (opts) =>
  new MemoryAccountStore({ emailResetLiveCodes: opts?.emailResetLiveCodes });
/**
 * The development store under `dir` (ACCOUNTS_STORE=file, ACCOUNTS_DATA_DIR): takes the lock ('locked' while another opener holds it), opens the
 * PGlite database in `<dir>/db` and applies the migrations it lacks, then opens the PostgreSQL store on it, with the configured limits when given.
 */
export const openFileAccountStore: OpenFileAccountStore = (opts) => openPgliteAccountStore({ dir: opts.dir, emailResetLiveCodes: opts.emailResetLiveCodes });
/**
 * The PostgreSQL store on a migrated database (design 11.5), with the configured limits (AccountStoreLimits) when given. Refuses ('schema') a database
 * whose `accounts` schema is not at ACCOUNTS_SCHEMA_VERSION. Closing the store closes the `AccountsSql`. Hosted passes it to composeAccounts as `host.store`.
 */
export const openPostgresAccountStore: OpenPostgresAccountStore = (sql, opts) => PostgresAccountStore.open(sql, opts);
