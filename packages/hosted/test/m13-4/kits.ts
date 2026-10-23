/**
 * The three stores as the contract suite drives them (M13-4): each kit gives a fresh empty store, a way to open a second instance on the same data
 * (what a restart sees), and the test hook that writes a snapshot past the last commit. PostgreSQL runs on PGlite in process (no database server), or,
 * when OPENMTG_TEST_PG_URL names a disposable database, also on that server inside a schema of its own that is dropped afterwards.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { SnapshotRow } from '../../src/store/api';
import { createPgPool, FileStore, MemoryStore, migrate, pgClient, pgliteClient, PostgresStore, type HostedStore, type SqlClient } from '../../src/store';

export interface StoreKit {
  readonly name: string;
  store: HostedStore;
  /** Another store instance on the same data (a restart); the old one is not used afterwards. Memory: the same instance. */
  reopen(): Promise<HostedStore>;
  /** Writes a snapshot without the committed-seq check (review 8's case: recovery must ignore it). */
  forceSnapshot(s: SnapshotRow): Promise<void>;
  /** Removes one committed record behind the store's back (a damaged log): recovery must refuse it, never return the log short. */
  dropRecord(game: string, seq: number): Promise<void>;
  done(): Promise<void>;
}

export interface KitFactory {
  name: string;
  /** Called once per suite. */
  setup(): Promise<void>;
  make(now: () => Date): Promise<StoreKit>;
  teardown(): Promise<void>;
}

export const memoryKit: KitFactory = {
  name: 'memory',
  async setup() {},
  async make(now) {
    const store = new MemoryStore({ now });
    return {
      name: 'memory',
      store,
      reopen: async () => store,
      forceSnapshot: async (s) => store.forceSnapshot(s),
      dropRecord: async (game, seq) => store.dropRecord(game, seq),
      done: async () => store.close(),
    };
  },
  async teardown() {},
};

export const fileKit: KitFactory = {
  name: 'file',
  async setup() {},
  async make(now) {
    const dir = await mkdtemp(join(tmpdir(), 'openmtg-m13-4-'));
    let store = await FileStore.open(dir, { now });
    const kit: StoreKit = {
      name: 'file',
      store,
      async reopen() {
        await store.close();
        store = await FileStore.open(dir, { now });
        kit.store = store;
        return store;
      },
      forceSnapshot: (s) => store.forceSnapshot(s),
      async dropRecord(game, seq) {
        const path = store.logPath(game);
        const lines = (await readFile(path, 'utf8')).split('\n').filter((l) => l !== '' && (JSON.parse(l) as { seq: number }).seq !== seq);
        await writeFile(path, lines.map((l) => `${l}\n`).join(''));
      },
      async done() {
        await store.close();
        await rm(dir, { recursive: true, force: true, maxRetries: 5 });
      },
    };
    return kit;
  },
  async teardown() {},
};

const TABLES = ['placements', 'results', 'snapshots', 'actions', 'seats', 'games', 'sessions', 'bug_reports'];

/** PostgreSQL on a `SqlClient` shared by the suite: migrated once, emptied before each test. */
function sqlKit(name: string, connect: () => Promise<{ sql: SqlClient; end(): Promise<void> }>): KitFactory {
  let shared: { sql: SqlClient; end(): Promise<void> } | null = null;
  // the store must not close the shared client
  const view = (sql: SqlClient): SqlClient => ({ ...sql, close: async () => {} });
  return {
    name,
    async setup() {
      shared = await connect();
      await migrate(shared.sql);
    },
    async make(now) {
      const sql = shared!.sql;
      await sql.exec(`TRUNCATE ${TABLES.join(', ')}`);
      let store = await PostgresStore.open(view(sql), { now });
      const kit: StoreKit = {
        name,
        store,
        async reopen() {
          store = await PostgresStore.open(view(sql), { now });
          kit.store = store;
          return store;
        },
        forceSnapshot: (s) => store.forceSnapshot(s),
        async dropRecord(game, seq) {
          await sql.query('DELETE FROM actions WHERE game_id = $1 AND seq = $2', [game, seq]);
        },
        async done() {},
      };
      return kit;
    },
    async teardown() {
      await shared?.end();
      shared = null;
    },
  };
}

export const pgliteKit: KitFactory = sqlKit('postgres (PGlite)', async () => {
  const db = await PGlite.create();
  const sql = pgliteClient(db);
  return { sql, end: () => sql.close() };
});

/** A real server, only when OPENMTG_TEST_PG_URL is set (a disposable test database; the suite works in a schema of its own and drops it). */
export function realPgKit(url: string): KitFactory {
  const schema = `openmtg_test_${process.pid}_${Date.now()}`;
  return sqlKit('postgres (server)', async () => {
    const admin = await createPgPool(url, { max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const sql = pgClient(await createPgPool(url, { max: 4, options: `-c search_path=${schema}` }));
    return {
      sql,
      async end() {
        await sql.exec(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
        await sql.close();
      },
    };
  });
}

export const KITS: KitFactory[] = [memoryKit, fileKit, pgliteKit, ...(process.env['OPENMTG_TEST_PG_URL'] ? [realPgKit(process.env['OPENMTG_TEST_PG_URL'])] : [])];
