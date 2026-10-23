/**
 * The migration runner for several packages (M14-11, accounts design 11.5): each package's migrations in a folder of its own, applied in a schema of its own
 * with its own qualified `schema_migrations`, under one advisory lock key; hosted's own call, with no schema, is what it was (m13). On PGlite, with
 * small migration folders made here (the accounts package's own migration is test/m14-11's).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, MIGRATION_LOCK_KEY, migrate, schemaVersion } from '../../src/store/migrate';
import { MIGRATIONS_DIR, pgliteClient, type SqlClient } from '../../src/store';

let db: PGlite;
let sql: SqlClient;
let dir: string;
beforeEach(async () => {
  db = await PGlite.create();
  sql = pgliteClient(db);
  dir = await mkdtemp(join(tmpdir(), 'openmtg-m14-11-'));
});
afterEach(async () => {
  await sql.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** A migration folder under `dir` with these files. */
async function folder(name: string, files: Record<string, string>): Promise<string> {
  const d = join(dir, name);
  await mkdir(d, { recursive: true });
  for (const [f, body] of Object.entries(files)) await writeFile(join(d, f), body);
  return d;
}

const versions = async (schema: string): Promise<[number, string][]> =>
  (await sql.query<{ version: number; name: string }>(`SELECT version, name FROM ${schema}.schema_migrations ORDER BY version`)).rows.map((r) => [r.version, r.name]);

describe('M14-11 migrate: one runner for every package', () => {
  it('a package migrates in its own schema, which the runner creates, and records itself in that schema\'s schema_migrations', async () => {
    const a = await folder('a', { '001_first.sql': 'CREATE TABLE alpha.t1 (id integer);', '002_second.sql': 'CREATE TABLE alpha.t2 (id integer);' });
    expect(await schemaVersion(sql, 'alpha')).toBe(0);
    expect(await migrate(sql, { schema: 'alpha', dir: a })).toEqual([1, 2]);
    expect(await migrate(sql, { schema: 'alpha', dir: a })).toEqual([]);
    expect(await schemaVersion(sql, 'alpha')).toBe(2);
    expect(await versions('alpha')).toEqual([[1, 'first'], [2, 'second']]);
    // nothing in public: the package's table lives in its schema
    expect((await sql.query(`SELECT to_regclass('public.schema_migrations') AS t`)).rows[0]).toEqual({ t: null });
    expect((await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM alpha.t1`)).rows[0]!.n).toBe(0);
  });

  it('two packages keep two schema_migrations, each with its own versions; a later migration of one applies alone', async () => {
    const a = await folder('a', { '001_first.sql': 'CREATE TABLE alpha.t1 (id integer);' });
    const b = await folder('b', { '001_first.sql': 'CREATE TABLE beta.t1 (id integer);', '002_more.sql': 'CREATE TABLE beta.t2 (id integer);' });
    expect(await migrate(sql, { schema: 'alpha', dir: a })).toEqual([1]);
    expect(await migrate(sql, { schema: 'beta', dir: b })).toEqual([1, 2]);
    expect(await versions('alpha')).toEqual([[1, 'first']]);
    expect(await versions('beta')).toEqual([[1, 'first'], [2, 'more']]);
    await writeFile(join(a, '002_added.sql'), 'CREATE TABLE alpha.t2 (id integer);');
    expect(await migrate(sql, { schema: 'alpha', dir: a })).toEqual([2]);
    expect(await migrate(sql, { schema: 'beta', dir: b })).toEqual([]);
    expect([await schemaVersion(sql, 'alpha'), await schemaVersion(sql, 'beta'), await schemaVersion(sql, 'gamma')]).toEqual([2, 2, 0]);
  });

  it('in order: another package, then hosted\'s own (no schema: found through the search_path, as in m13), each recorded where it belongs', async () => {
    const a = await folder('a', { '001_first.sql': 'CREATE TABLE alpha.parent (id integer PRIMARY KEY);' });
    expect(await migrate(sql, { schema: 'alpha', dir: a })).toEqual([1]);
    expect(await migrate(sql)).toEqual([1]);
    expect(await migrate(sql, { dir: MIGRATIONS_DIR })).toEqual([]);
    expect(await schemaVersion(sql)).toBe(1);
    expect(await schemaVersion(sql, 'alpha')).toBe(1);
    expect(await schemaVersion(sql, 'public')).toBe(1);
    expect(await versions('public')).toEqual([[1, 'initial']]);
    expect(await versions('alpha')).toEqual([[1, 'first']]);
    expect((await sql.query(`SELECT to_regclass('public.games') AS t`)).rows[0]).toEqual({ t: 'games' });
  });

  it('naming public is the same as naming nothing for a database whose search_path is public', async () => {
    expect(await migrate(sql, { schema: 'public', dir: MIGRATIONS_DIR })).toEqual([1]);
    expect(await migrate(sql)).toEqual([]);
    expect(await schemaVersion(sql)).toBe(1);
  });

  it('every migrator of every package takes the one advisory lock key, in the migration\'s own transaction', async () => {
    const a = await folder('a', { '001_first.sql': 'CREATE TABLE alpha.t1 (id integer);' });
    const calls: { text: string; params: readonly unknown[] | undefined }[] = [];
    const spy: SqlClient = {
      ...sql,
      transaction: (fn) =>
        sql.transaction((tx) =>
          fn({
            query: (text, params) => {
              calls.push({ text, params });
              return tx.query(text, params);
            },
            exec: (text) => tx.exec(text),
          }),
        ),
    };
    await migrate(spy, { schema: 'alpha', dir: a });
    await migrate(spy);
    const locks = calls.filter((c) => /pg_advisory_xact_lock/.test(c.text));
    // one per migration file of each package, every one with the same key
    expect(locks.map((l) => l.params)).toEqual([[MIGRATION_LOCK_KEY], [MIGRATION_LOCK_KEY]]);
    // and it is the first statement of each transaction: nothing is checked or written before the lock is held
    expect(calls[0]!.text).toMatch(/pg_advisory_xact_lock/);
  });

  it('a migration that fails leaves nothing of itself, nor its record; the next run applies it', async () => {
    const a = await folder('a', { '001_first.sql': 'CREATE TABLE alpha.t1 (id integer);', '002_bad.sql': 'CREATE TABLE alpha.t2 (id integer); SELECT 1/0;' });
    await expect(migrate(sql, { schema: 'alpha', dir: a })).rejects.toThrow(/division by zero/);
    expect(await versions('alpha')).toEqual([[1, 'first']]);
    expect((await sql.query(`SELECT to_regclass('alpha.t2') AS t`)).rows[0]).toEqual({ t: null });
    await writeFile(join(a, '002_bad.sql'), 'CREATE TABLE alpha.t2 (id integer);');
    expect(await migrate(sql, { schema: 'alpha', dir: a })).toEqual([2]);
  });

  it('a schema name is refused unless it is a plain lower-case name: it goes into DDL', async () => {
    const a = await folder('a', { '001_first.sql': 'SELECT 1;' });
    for (const bad of ['Alpha', 'a b', 'a;DROP TABLE x', 'a"b', '1a', '', 'a'.repeat(64), 'a.b']) {
      await expect(migrate(sql, { schema: bad, dir: a }), bad).rejects.toThrow(/not a schema name/);
      await expect(schemaVersion(sql, bad), bad).rejects.toThrow(/not a schema name/);
    }
    expect(await migrate(sql, { schema: 'a'.repeat(63), dir: a })).toEqual([1]);
  });

  it('refuses a database whose server encoding is not UTF8, for any package and with or without a schema, before it makes a schema, takes the lock or runs a migration', async () => {
    const a = await folder('a', { '001_first.sql': 'CREATE TABLE alpha.t1 (id integer);' });
    const calls: string[] = [];
    const encoded = (enc: string): SqlClient => ({
      ...sql,
      query: (async (text: string, params?: readonly unknown[]) => {
        calls.push(text);
        return /server_encoding/i.test(text) ? { rows: [{ server_encoding: enc }], rowCount: 0 } : sql.query(text, params);
      }) as SqlClient['query'],
      transaction: (fn) => {
        calls.push('transaction');
        return sql.transaction(fn);
      },
    });
    for (const enc of ['LATIN1', 'SQL_ASCII', 'WIN1252', 'UTF-8', 'utf8', '']) {
      await expect(migrate(encoded(enc), { schema: 'alpha', dir: a }), enc).rejects.toThrow(/UTF8/);
      await expect(migrate(encoded(enc)), enc).rejects.toThrow(/UTF8/);
    }
    expect(calls.filter((c) => c === 'transaction')).toEqual([]);
    expect((await sql.query<{ t: string | null }>(`SELECT to_regnamespace('alpha')::text AS t`)).rows[0]).toEqual({ t: null });
    expect(await schemaVersion(sql, 'alpha')).toBe(0);
    // the same database, as it is (UTF8 on PGlite), migrates
    expect(await migrate(sql, { schema: 'alpha', dir: a })).toEqual([1]);
  });

  it('loadMigrations reads any package\'s folder: sorted by version, malformed names and repeated versions refused', async () => {
    const a = await folder('a', { '002_second.sql': 'SELECT 2;', '001_first.sql': 'SELECT 1;', 'notes.txt': 'not a migration' });
    expect((await loadMigrations(a)).map((m) => [m.version, m.name, m.sql])).toEqual([[1, 'first', 'SELECT 1;'], [2, 'second', 'SELECT 2;']]);
    const bad = await folder('bad', { '1_x.sql': 'SELECT 1;' });
    await expect(loadMigrations(bad)).rejects.toThrow(/NNN_name\.sql/);
    const twice = await folder('twice', { '001_a.sql': 'SELECT 1;', '001_b.sql': 'SELECT 1;' });
    await expect(loadMigrations(twice)).rejects.toThrow(/given twice/);
  });
});
