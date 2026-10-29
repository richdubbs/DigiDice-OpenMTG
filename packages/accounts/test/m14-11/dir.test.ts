/**
 * F26: the development store (ACCOUNTS_STORE=file): PostgresAccountStore on PGlite in ACCOUNTS_DATA_DIR (src/store/pglite.ts). The contract suite
 * runs on the same store on PGlite in memory (test/m14-11/contract.test.ts); this file covers what the directory adds: the migrations applied once
 * and recorded as hosted's runner records them, the relaxed minimum grace of a development database, every write kept across a close and a reopen,
 * the lock (test/m14-4/lock.test.ts covers its cases), a database at another version refused, a bad limit refused before the directory is touched,
 * and the directory's mode.
 */
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { ACCOUNTS_SCHEMA_VERSION, openFileAccountStore } from '@openmtg/accounts';
import { STORE_LOCK_FILE } from '../../src/store/lock';
import { PGLITE_DB_DIR } from '../../src/store/pglite';
import { accId, newAccount, refused, T0 } from '../m14-4/contract';

const root = mkdtempSync(join(tmpdir(), 'openmtg-f26-dir-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;
const freshDir = (): string => join(root, `data-${++dirs}`);

/** Runs `fn` on the store's database directly (the store closed: the lock is free). */
async function onDb<T>(dir: string, fn: (db: PGlite) => Promise<T>): Promise<T> {
  const db = await PGlite.create(join(dir, PGLITE_DB_DIR));
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

// PGlite makes a database in a few seconds (more on a loaded machine); later opens take well under one
describe('F26 the development store: PostgreSQL on PGlite in ACCOUNTS_DATA_DIR', { timeout: 60_000 }, () => {
  it('migrates a new directory once, keeps every write across a close and a reopen, and refuses a second opener meanwhile', async () => {
    const dir = freshDir();
    const first = await openFileAccountStore({ dir });
    if (process.platform !== 'win32') expect(statSync(dir).mode & 0o777).toBe(0o700);
    await first.createAccount(newAccount(1, 'Alice', 'allce'), T0);
    await refused(openFileAccountStore({ dir }), 'locked');
    await first.close();
    expect(existsSync(join(dir, STORE_LOCK_FILE))).toBe(false);

    const again = await openFileAccountStore({ dir });
    expect((await again.account(accId(1)))?.name).toBe('Alice');
    expect((await again.accountByKey('allce', 1))?.id).toBe(accId(1));
    await again.close();

    const db = await onDb(dir, async (db) => ({
      migrations: (await db.query('SELECT version, name FROM accounts.schema_migrations ORDER BY version')).rows,
      policy: (await db.query('SELECT min_grace_ms::int AS grace, max_skew_ms::int AS skew FROM accounts.deletion_policy')).rows,
    }));
    expect(db.migrations).toEqual([{ version: ACCOUNTS_SCHEMA_VERSION, name: 'accounts' }]);
    // no minimum grace (the operator's delete --now), the migration's clock skew limit
    expect(db.policy).toEqual([{ grace: 0, skew: 300_000 }]);
  });

  it('refuses a database at another schema version (schema) and releases the lock', async () => {
    const dir = freshDir();
    await (await openFileAccountStore({ dir })).close();
    await onDb(dir, (db) => db.query("INSERT INTO accounts.schema_migrations (version, name) VALUES (99, 'newer')"));
    await refused(openFileAccountStore({ dir }), 'schema');
    expect(existsSync(join(dir, STORE_LOCK_FILE))).toBe(false);
  });

  it('refuses a live-code cap that is not a whole number from 0 (RangeError) before it touches the directory', async () => {
    const dir = freshDir();
    await expect(openFileAccountStore({ dir, emailResetLiveCodes: -1 })).rejects.toThrow(RangeError);
    expect(existsSync(dir)).toBe(false);
  });
});
