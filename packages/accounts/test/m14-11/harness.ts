/**
 * M14-11: the PostgreSQL test harness. PostgreSQL runs on PGlite in process (no database server), or, when OPENMTG_TEST_PG_URL names a disposable
 * database, also on that server. Both are migrated by hosted's own runner (`migrate` of packages/hosted/src/store/migrate.ts: accounts accounts
 * first, as the operator's command runs it), and the store under test runs as the **service's role**: a role made here, given its rights by
 * `accounts.grant_service` and nothing else, so every test also shows that the rights of design 11.5 are enough to run the store.
 *
 * - The service's connection has `search_path = pg_catalog`, so any name the store left unqualified (`public`'s, or the `accounts` schema's) would fail:
 *   the store names every table by its schema.
 * - PGlite has one connection: the service's role is set once on it (`SET ROLE`), and the harness's own work (emptying the tables, the byte search,
 *   the checks of a role's rights) steps out of it for the moment (`admin`). Its clock is JavaScript's `Date.now`, which `withClock` replaces for one
 *   `purge` call, so purge_audit (which counts by the database's clock, never by an argument) meets the contract suite's fixed times.
 * - A real server cannot be given another clock: its harness says so (`dbClock: 'real'`), and the one contract test that needs it is skipped there;
 *   test/m14-11/audit.test.ts covers purge_audit on both with times relative to the database's own clock.
 * - A real server needs a database with no schema `accounts` in it (the test makes one and drops it); an existing one is refused, not dropped.
 */
import { PGlite } from '@electric-sql/pglite';
import { ACCOUNTS_MIGRATIONS_DIR, ACCOUNTS_SCHEMA, openPostgresAccountStore, type AccountStore, type AccountStoreLimits } from '@openmtg/accounts';
import { migrate } from '../../../hosted/src/store/migrate';
import { createPgPool, pgClient, pgliteClient, type SqlClient } from '../../../hosted/src/store/sql';
import { placeOf, type StoreHarness } from '../m14-4/contract';

/** The role the store runs as in the tests. */
export const SERVICE_ROLE = 'openmtg_accounts_test_service';

/** The tables whose rows tests empty between runs (everything but the tables the migration fills and the single rows: two are reset below, the policy is the file's). */
const KEPT = ['audit_kinds', 'schema_migrations', 'name_meta', 'change_head', 'deletion_policy', 'write_pad'];

/** One migrated database, and the ways to work on it as the owner and as the service. */
export interface PgKit {
  readonly name: string;
  /** 'fake': the database's clock follows `withClock`; 'real': it cannot be moved. */
  readonly dbClock: 'fake' | 'real';
  /** The owner's role: runs `fn` on a client that is not the service (queries, DDL). */
  admin<T>(fn: (sql: SqlClient) => Promise<T>): Promise<T>;
  /** A client as the service's role; closing it closes nothing (the kit owns the database). */
  service(): SqlClient;
  /** Another client as the service's role, on a connection of its own where the database has more than one (a real server); PGlite: the same one. */
  serviceTwo(): SqlClient;
  /** Empties every table the store writes, and the two counters. */
  reset(): Promise<void>;
  /** Runs `fn` with the database's clock at `iso` where it can be moved (PGlite), as it is otherwise. */
  withClock<T>(iso: string, fn: () => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

const noClose = (sql: SqlClient): SqlClient => ({ ...sql, close: async () => {} });

async function tablesOf(sql: SqlClient): Promise<string[]> {
  const r = await sql.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = '${ACCOUNTS_SCHEMA}' ORDER BY tablename`);
  return r.rows.map((x) => x.tablename);
}

async function resetTables(sql: SqlClient): Promise<void> {
  const tables = (await tablesOf(sql)).filter((t) => !KEPT.includes(t));
  await sql.exec(`TRUNCATE ${tables.map((t) => `${ACCOUNTS_SCHEMA}.${t}`).join(', ')}`);
  await sql.exec(`UPDATE ${ACCOUNTS_SCHEMA}.name_meta SET current_version = 1; UPDATE ${ACCOUNTS_SCHEMA}.change_head SET last_seq = 0`);
}

/**
 * The owner's deletion policy (accounts.deletion_policy) with no floor and no limit on how far a request's time may be from the database's: the contract suite
 * and most tests run on fixed times of their own, which a policy of the database's own clock would refuse. test/m14-11/deletion.test.ts sets the migration's
 * defaults (an hour, five minutes) and shows what they guard.
 */
export const RELAXED_POLICY = { minGraceMs: 0, maxSkewMs: Number.MAX_SAFE_INTEGER };
export const DEFAULT_POLICY = { minGraceMs: 3_600_000, maxSkewMs: 300_000 };
export async function setPolicy(sql: SqlClient, p: { minGraceMs: number; maxSkewMs: number }): Promise<void> {
  await sql.query(`UPDATE ${ACCOUNTS_SCHEMA}.deletion_policy SET min_grace_ms = $1, max_skew_ms = $2`, [p.minGraceMs, p.maxSkewMs]);
}

/** Migrates accounts, relaxes the deletion policy, makes the service's role and gives it its rights. */
async function prepare(sql: SqlClient): Promise<void> {
  await migrate(sql, { schema: ACCOUNTS_SCHEMA, dir: ACCOUNTS_MIGRATIONS_DIR });
  await setPolicy(sql, RELAXED_POLICY);
  await sql.exec(`CREATE ROLE ${SERVICE_ROLE}`);
  await sql.query('SELECT accounts.grant_service($1)', [SERVICE_ROLE]);
}

/** PostgreSQL on PGlite, in process: one connection, the service's role set on it. */
export function pgliteKit(): PgKit {
  let db: PGlite | null = null;
  let sql: SqlClient;
  const ready = async (): Promise<SqlClient> => {
    if (db === null) {
      db = await PGlite.create();
      sql = pgliteClient(db);
      await prepare(sql);
      await sql.exec(`SET ROLE ${SERVICE_ROLE}; SET search_path = pg_catalog`);
    }
    return sql;
  };
  const kit: PgKit = {
    name: 'postgres (PGlite)',
    dbClock: 'fake',
    async admin(fn) {
      const c = await ready();
      await c.exec('RESET ROLE');
      try {
        return await fn(noClose(c));
      } finally {
        await c.exec(`SET ROLE ${SERVICE_ROLE}`);
      }
    },
    service: () => noClose(sql),
    serviceTwo: () => noClose(sql),
    async reset() {
      await ready();
      await kit.admin(resetTables);
    },
    async withClock(iso, fn) {
      const real = Date.now;
      const fixed = Date.parse(iso);
      Date.now = () => fixed;
      try {
        return await fn();
      } finally {
        Date.now = real;
      }
    },
    async end() {
      if (db !== null) await sql.close();
      db = null;
    },
  };
  return kit;
}

/**
 * A real server, only when OPENMTG_TEST_PG_URL is set (a disposable test database): the admin pool migrates and checks, two pools of the service's
 * role (`-c role=`) are two connections for the tests of the change feed and of concurrent writers. The schema `accounts` and the role are dropped at the end.
 */
export function realKit(url: string): PgKit {
  let admin: SqlClient | null = null;
  const services: SqlClient[] = [];
  const kit: PgKit = {
    name: 'postgres (server)',
    dbClock: 'real',
    async admin(fn) {
      if (admin === null) {
        const pool = pgClient(await createPgPool(url, { max: 4 }));
        try {
          const exists = await pool.query(`SELECT 1 FROM pg_namespace WHERE nspname = '${ACCOUNTS_SCHEMA}'`);
          if (exists.rows.length > 0) throw new Error(`OPENMTG_TEST_PG_URL: the database already has a schema "${ACCOUNTS_SCHEMA}"; the tests need a disposable database (they drop it)`);
          await pool.exec(`DROP ROLE IF EXISTS ${SERVICE_ROLE}`);
          await prepare(pool);
          for (let i = 0; i < 2; i++) services.push(pgClient(await createPgPool(url, { max: 4, options: `-c role=${SERVICE_ROLE} -c search_path=pg_catalog` })));
        } catch (e) {
          for (const x of services.splice(0)) await x.close().catch(() => undefined);
          await pool.close().catch(() => undefined);
          throw e;
        }
        admin = pool;
      }
      return fn(noClose(admin));
    },
    service: () => noClose(services[0]!),
    serviceTwo: () => noClose(services[1]!),
    async reset() {
      await kit.admin(resetTables);
    },
    withClock: (_iso, fn) => fn(),
    async end() {
      for (const s of services.splice(0)) await s.close();
      if (admin !== null) {
        await admin.exec(`DROP SCHEMA IF EXISTS ${ACCOUNTS_SCHEMA} CASCADE`).catch(() => undefined);
        await admin.exec(`DROP ROLE IF EXISTS ${SERVICE_ROLE}`).catch(() => undefined);
        await admin.close();
      }
      admin = null;
    },
  };
  return kit;
}

/** Every kit this run uses: PGlite, and a real server when OPENMTG_TEST_PG_URL is set. */
export function kits(): PgKit[] {
  const url = process.env['OPENMTG_TEST_PG_URL'];
  return [pgliteKit(), ...(url ? [realKit(url)] : [])];
}

/**
 * What one statement does as `role` (SET LOCAL ROLE in a transaction of the owner's connection, always rolled back): 'allowed', or the database's refusal
 * (its message, and its SQLSTATE in `code` when it has one).
 */
export async function attempt(kit: PgKit, role: string, statement: string, params: unknown[] = []): Promise<string> {
  const stop = new Error('rolled back');
  try {
    await kit.admin((sql) =>
      sql.transaction(async (tx) => {
        await tx.exec(`SET LOCAL ROLE ${role}`);
        await tx.query(statement, params);
        throw stop;
      }),
    );
  } catch (e) {
    return e === stop ? 'allowed' : (e as Error).message;
  }
  return 'allowed';
}

/** The SQLSTATE of the refusal a promise ends in, or 'ok'. */
export async function sqlState(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return String((e as { code?: unknown }).code ?? `other: ${(e as Error).message}`);
  }
}

// ---- the contract suite's harness ------------------------------------------------------------------------------------------------------------------

/** The memory store's table names (src/store/memory.ts StoreTables) for the tables of the schema, for the erase test's byte search. */
const MEMORY_TABLE: Readonly<Record<string, string>> = {
  name_history: 'history', recovery_codes: 'recovery', guest_claims: 'claims', email_codes: 'emailCodes',
};

/** A row of the database as `placeOf` reads the memory store's rows (what it looks at: the audit and change kind, a name's account, a report's target). */
function placeRow(table: string, j: Record<string, unknown>): unknown {
  switch (table) {
    case 'audit':
    case 'changes':
      return { kind: j['kind'] };
    case 'names':
      return { account: j['account_id'] };
    case 'reports': {
      const { target_account: account, target_session: _guest, ...rest } = j;
      return { ...rest, target: { account } };
    }
    default:
      return j;
  }
}

/** Every place `needle` occurs in the rows of every table of the schema (the byte search of the erase test), each named by placeOf. */
export async function placesIn(kit: PgKit, needle: string): Promise<string[]> {
  return kit.admin(async (sql) => {
    const out: string[] = [];
    for (const t of await tablesOf(sql)) {
      const rows = await sql.query<{ j: string }>(`SELECT row_to_json(t)::text AS j FROM ${ACCOUNTS_SCHEMA}.${t} t`);
      for (const r of rows.rows) {
        if (!r.j.includes(needle)) continue;
        out.push(placeOf(MEMORY_TABLE[t] ?? t, placeRow(t, JSON.parse(r.j) as Record<string, unknown>), needle));
      }
    }
    return out;
  });
}

/** The store as the contract suite meets it: purge runs with the database's clock at the `now` it is given (where the kit can move it). */
export function withClockedPurge(kit: PgKit, store: AccountStore): AccountStore {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'purge') return (policy: Parameters<AccountStore['purge']>[0], now: string) => kit.withClock(now, () => target.purge(policy, now));
      const v = Reflect.get(target, prop) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** The harness of test/m14-4/contract.ts for a kit. */
export function contractHarness(kit: PgKit): StoreHarness {
  return {
    name: kit.name,
    dbClock: kit.dbClock,
    // the id of an erased account stays in the ledger of account purges (migration 001): the table is placed under its own name
    erasedIdPlaces: ['purge_ledger'],
    async open(limits?: AccountStoreLimits) {
      await kit.reset();
      return withClockedPurge(kit, await openPostgresAccountStore(kit.service(), limits));
    },
    places: (_store, needle) => placesIn(kit, needle),
  };
}
