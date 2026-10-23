/**
 * `PostgresStore` (M13-4, design 8.1-8.3): the production store, on a `SqlClient` (a `pg` pool, or PGlite in the tests). Parameterized queries only.
 *
 * - **Group commit, isolated per game** (design 2.3, review 2): `appendRecords` is one transaction with a SAVEPOINT per game. A game whose rows the
 *   database refuses (a \u0000 or unpaired-surrogate escape the jsonb CHECK of migration 001 refuses, a seq that does not continue its log, a game
 *   not running) is rolled back to its savepoint and reported in `failed`; the other games commit. The records are deliberately not pre-checked for
 *   text here: the database's own refusal is the case the savepoints exist for, and the contract suite drives it.
 * - **Exact text**: the action and the config are `json` columns read back as text (`::text`) and parsed, so key order survives (the checkpoint
 *   hash of a replayed state depends on it; jsonb would reorder keys).
 * - **Snapshots** only for a committed seq (an INSERT guarded by the game's `last_seq`); recovery reads the newest snapshot not past `last_seq`
 *   (review 8), in one REPEATABLE READ transaction.
 * - Other rows are checked with the stores' common text rules (store/rules.ts) before they are written, so a lone surrogate is refused rather than
 *   silently stored as U+FFFD.
 */
import type { SeatNumber } from '../api';
import type { GameRecord, Placement, VoidReason } from '../ledger/types';
import type {
  AppendResult, GameStatus, GameStore, LobbyPatch, LogRecord, NewGameRow, PurgeReport, RecoveryData, RecoveryOptions, ReportRow, RetentionPolicy, SeatRow,
  SessionResultsQuery, SessionRow, SnapshotRow, StartRow, TableRow,
} from './api';
import { schemaVersion, SCHEMA_VERSION } from './migrate';
import {
  assertStorable, attachmentsAfterRetention, batchOrderProblem, canonicalResult, checkId, continuationProblem, cutoff, groupBatch, STORE_ID,
  checkCoverage, endStatus, isoOf, sameRecord, stableJson, StoreError, voidLedgerRow, voidRecord, type LedgerRow,
} from './rules';
import type { SqlClient, SqlQueryable } from './sql';

export interface PostgresStoreOptions {
  /** The store's clock for `voidGame`'s end time (default: the system clock). */
  now?: () => Date;
}

const pgCode = (e: unknown): string | undefined => (typeof e === 'object' && e !== null ? ((e as { code?: unknown }).code as string | undefined) : undefined);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function checkDate(label: string, d: unknown): void {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) throw new StoreError('value', `${label} is not a valid Date`);
}

/** Rows of one multi-row INSERT at most (PostgreSQL allows 65,535 parameters). */
const INSERT_ROWS = 500;

async function insertRecords(tx: SqlQueryable, game: string, recs: readonly LogRecord[]): Promise<void> {
  for (let i = 0; i < recs.length; i += INSERT_ROWS) {
    const chunk = recs.slice(i, i + INSERT_ROWS);
    const params: unknown[] = [game];
    const values = chunk.map((r) => {
      const b = params.length;
      params.push(r.seq, r.seat, JSON.stringify(r.action), r.cause ?? null, r.approvedBy ?? null, JSON.stringify(r.clocks), r.elapsedMs, r.at, r.check ?? null);
      return `($1, $${b + 1}, $${b + 2}, $${b + 3}::json, $${b + 4}, $${b + 5}::smallint[], $${b + 6}::jsonb, $${b + 7}, $${b + 8}::timestamptz, $${b + 9})`;
    });
    await tx.query(
      `INSERT INTO actions (game_id, seq, seat, action, cause, approved_by, clocks, elapsed_ms, at, check_hash) VALUES ${values.join(', ')}`,
      params,
    );
  }
}

/** Moves the game's `last_seq` from `first - 1` to `last`; throws `StoreError` 'order' or 'status' (or 'notFound') when it cannot. */
/**
 * Moves the game's `last_seq` from `first - 1` to the last of `recs` and returns true. Returns false when every one of `recs` is committed already
 * exactly as given (review minor 2: a batch retried after an ambiguous COMMIT; nothing is written twice). Throws `StoreError` 'order', 'status' or
 * 'notFound' otherwise.
 */
async function advance(tx: SqlQueryable, game: string, recs: readonly LogRecord[]): Promise<boolean> {
  const first = recs[0]!.seq;
  const last = recs[recs.length - 1]!.seq;
  const u = await tx.query(`UPDATE games SET last_seq = $3 WHERE id = $1 AND status = 'running' AND last_seq = $2`, [game, first - 1, last]);
  if (u.rowCount === 1) return true;
  const g = await tx.query<{ status: GameStatus; last_seq: number }>('SELECT status, last_seq FROM games WHERE id = $1', [game]);
  const row = g.rows[0];
  if (row && last <= row.last_seq) {
    const stored = await tx.query<RecordRow>(
      `SELECT seq, seat, action::text AS action, cause, approved_by, clocks::text AS clocks, elapsed_ms, at, check_hash
       FROM actions WHERE game_id = $1 AND seq BETWEEN $2 AND $3 ORDER BY seq`,
      [game, first, last],
    );
    if (stored.rows.length === recs.length && stored.rows.every((s, i) => sameRecord(recordOf(game, s), recs[i]!))) return false;
    throw new StoreError('order', `records ${first}..${last} differ from the committed log (last ${row.last_seq})`);
  }
  const problem = continuationProblem(row?.status ?? null, row?.last_seq ?? 0, first) ?? 'the game changed';
  throw new StoreError(!row ? 'notFound' : row.status !== 'running' ? 'status' : 'order', problem);
}

interface RecordRow {
  seq: number;
  seat: number;
  action: string;
  cause: LogRecord['cause'] | null;
  approved_by: number[] | null;
  clocks: string;
  elapsed_ms: number;
  at: Date;
  check_hash: string | null;
}

function recordOf(game: string, r: RecordRow): LogRecord {
  return {
    game, seq: r.seq, seat: r.seat, action: JSON.parse(r.action) as LogRecord['action'],
    ...(r.cause !== null ? { cause: r.cause } : {}), ...(r.approved_by !== null ? { approvedBy: r.approved_by.map(Number) } : {}),
    clocks: JSON.parse(r.clocks) as LogRecord['clocks'], elapsedMs: Number(r.elapsed_ms), at: new Date(r.at).toISOString(),
    ...(r.check_hash !== null ? { check: r.check_hash } : {}),
  };
}

async function insertSeats(tx: SqlQueryable, game: string, rows: readonly SeatRow[]): Promise<void> {
  for (const s of rows) {
    await tx.query(
      `INSERT INTO seats (game_id, seat, player, session_id, name, deck, deck_hash, invite_hash, joined_at, left_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [game, s.seat, s.player, s.session, s.name, s.deck === null ? null : JSON.stringify(s.deck), s.deckHash, s.inviteHash, s.joinedAt, s.leftAt],
    );
  }
}

function checkSeatRows(rows: readonly SeatRow[]): void {
  assertStorable('seats', rows);
  for (const r of rows) {
    if (r.joinedAt !== null) checkDate('joinedAt', r.joinedAt);
    if (r.leftAt !== null) checkDate('leftAt', r.leftAt);
  }
}

async function lockGame(tx: SqlQueryable, id: string): Promise<{ status: GameStatus; last_seq: number }> {
  const r = await tx.query<{ status: GameStatus; last_seq: number }>('SELECT status, last_seq FROM games WHERE id = $1 FOR UPDATE', [id]);
  const row = r.rows[0];
  if (!row) throw new StoreError('notFound', `no game ${id}`);
  return row;
}

export class PostgresStore implements GameStore {
  private closed = false;
  private readonly now: () => Date;

  private constructor(
    private readonly sql: SqlClient,
    opts: PostgresStoreOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /** Opens the store on a migrated database; throws when the schema is not this build's version (run the migrate command first). */
  static async open(sql: SqlClient, opts: PostgresStoreOptions = {}): Promise<PostgresStore> {
    const v = await schemaVersion(sql);
    if (v !== SCHEMA_VERSION) throw new StoreError('status', `the database schema is version ${v}; this build needs ${SCHEMA_VERSION} (run the migrate command)`);
    return new PostgresStore(sql, opts);
  }

  private db(): SqlClient {
    if (this.closed) throw new StoreError('closed', 'the store is closed');
    return this.sql;
  }

  // ---- sessions -----------------------------------------------------------------------------------------------------------------------------

  async putSession(s: SessionRow): Promise<void> {
    checkId('session', s.id);
    assertStorable('session', s);
    checkDate('createdAt', s.createdAt);
    checkDate('lastSeen', s.lastSeen);
    try {
      await this.db().query(
        `INSERT INTO sessions (id, token_hash, name, created_at, last_seen) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash, name = EXCLUDED.name, created_at = EXCLUDED.created_at, last_seen = EXCLUDED.last_seen`,
        [s.id, s.tokenHash, s.name, s.createdAt, s.lastSeen],
      );
    } catch (e) {
      if (pgCode(e) === '23505') throw new StoreError('exists', 'another session has this token hash');
      throw e;
    }
  }

  async sessionByTokenHash(hash: string): Promise<SessionRow | null> {
    const r = await this.db().query<{ id: string; token_hash: string; name: string; created_at: Date; last_seen: Date }>(
      'SELECT id, token_hash, name, created_at, last_seen FROM sessions WHERE token_hash = $1',
      [hash],
    );
    const x = r.rows[0];
    return x ? { id: x.id, tokenHash: x.token_hash, name: x.name, createdAt: new Date(x.created_at), lastSeen: new Date(x.last_seen) } : null;
  }

  async touchSession(id: string, at: Date): Promise<void> {
    checkDate('at', at);
    await this.db().query('UPDATE sessions SET last_seen = $2 WHERE id = $1', [id, at]);
  }

  // ---- tables and games ---------------------------------------------------------------------------------------------------------------------

  async createGame(g: NewGameRow): Promise<void> {
    checkId('game', g.id);
    const { seatRows, createdAt, ...rest } = g;
    assertStorable('game', rest);
    checkDate('createdAt', createdAt);
    checkSeatRows(seatRows);
    try {
      await this.db().transaction(async (tx) => {
        await tx.query(
          `INSERT INTO games (id, format, variant, seats, source, title, password_hash, password_salt, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'lobby', $9)`,
          [g.id, g.format, g.variant, g.seats, g.source, g.title, g.passwordHash, g.passwordSalt, createdAt],
        );
        await insertSeats(tx, g.id, seatRows);
      });
    } catch (e) {
      if (pgCode(e) === '23505') throw new StoreError('exists', `game ${g.id} exists`);
      throw e;
    }
  }

  async updateLobby(id: string, patch: LobbyPatch): Promise<void> {
    const { seatRows, waitingSince, ...rest } = patch;
    assertStorable('lobby', rest);
    if (seatRows) checkSeatRows(seatRows);
    if (waitingSince) checkDate('waitingSince', waitingSince);
    await this.db().transaction(async (tx) => {
      const g = await lockGame(tx, id);
      if (g.status !== 'lobby' && g.status !== 'waitingCapacity') throw new StoreError('status', `game ${id} is ${g.status}`);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (rest.title !== undefined) set('title', rest.title);
      if (rest.passwordHash !== undefined) set('password_hash', rest.passwordHash);
      if (rest.passwordSalt !== undefined) set('password_salt', rest.passwordSalt);
      if (rest.status !== undefined) set('status', rest.status);
      if (waitingSince !== undefined) set('waiting_since', waitingSince);
      if (sets.length > 0) await tx.query(`UPDATE games SET ${sets.join(', ')} WHERE id = $1`, params);
      if (seatRows) {
        await tx.query('DELETE FROM seats WHERE game_id = $1', [id]);
        await insertSeats(tx, id, seatRows);
      }
    });
  }

  async startGame(id: string, start: StartRow): Promise<void> {
    if ('seed' in (start.config as object)) throw new StoreError('value', 'the config must not hold the seed');
    const { config, ...rest } = start;
    assertStorable('start', rest);
    // the config too: a NUL or a lone surrogate is a StoreError 'value' here as in the other stores, not the database's raw refusal (review minor 4)
    assertStorable('config', config);
    checkDate('startedAt', start.startedAt);
    await this.db().transaction(async (tx) => {
      const g = await lockGame(tx, id);
      if (g.status !== 'lobby' && g.status !== 'waitingCapacity') throw new StoreError('status', `game ${id} is ${g.status}`);
      await tx.query(
        `UPDATE games SET status = 'running', config = $2::json, seed = $3, seating = $4::smallint[], engine_build = $5, rules_pack = $6,
           started_at = $7, node = $8, waiting_since = NULL, last_seq = 0, password_hash = NULL, password_salt = NULL WHERE id = $1`,
        [id, JSON.stringify(config), start.seed, start.seating, start.engineBuild, start.rulesPack, start.startedAt, start.node],
      );
      for (let i = 0; i < start.seating.length; i++) {
        await tx.query('UPDATE seats SET player = $3 WHERE game_id = $1 AND seat = $2', [id, start.seating[i], `p${i + 1}`]);
      }
    });
  }

  async appendRecords(batch: LogRecord[]): Promise<AppendResult> {
    const groups = groupBatch(batch);
    const errors = new Map<string, string>();
    const todo: [string, LogRecord[]][] = [];
    for (const [game, recs] of groups) {
      const p = !STORE_ID.test(game) ? 'the game id is malformed' : batchOrderProblem(recs);
      if (p) errors.set(game, p);
      else todo.push([game, recs]);
    }
    if (todo.length > 0) {
      try {
        await this.db().transaction(async (tx) => {
          for (const [game, recs] of todo) {
            await tx.query('SAVEPOINT game');
            try {
              if (await advance(tx, game, recs)) await insertRecords(tx, game, recs);
              await tx.query('RELEASE SAVEPOINT game');
            } catch (e) {
              // only this game: back to its savepoint, the batch goes on (design 2.3, review 2)
              await tx.query('ROLLBACK TO SAVEPOINT game');
              await tx.query('RELEASE SAVEPOINT game');
              errors.set(game, message(e));
            }
          }
        });
      } catch (e) {
        // the transaction itself failed (the connection, the COMMIT): nothing of the batch committed
        for (const [game] of todo) if (!errors.has(game)) errors.set(game, message(e));
      }
    }
    const result: AppendResult = { committed: [], failed: [] };
    for (const game of groups.keys()) {
      const e = errors.get(game);
      if (e === undefined) result.committed.push(game);
      else result.failed.push({ game, error: e });
    }
    return result;
  }

  async putSnapshot(s: SnapshotRow): Promise<void> {
    assertStorable('snapshot', { engineBuild: s.engineBuild, hash: s.hash });
    checkDate('createdAt', s.createdAt);
    if (!Number.isInteger(s.seq) || s.seq < 1) throw new StoreError('order', `snapshot seq ${s.seq} is not a positive integer`);
    const r = await this.db().query(
      `INSERT INTO snapshots (game_id, seq, engine_build, hash, state, created_at)
       SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM games WHERE id = $1 AND status = 'running' AND last_seq >= $2)
       ON CONFLICT (game_id, seq) DO UPDATE SET engine_build = EXCLUDED.engine_build, hash = EXCLUDED.hash, state = EXCLUDED.state, created_at = EXCLUDED.created_at`,
      [s.game, s.seq, s.engineBuild, s.hash, s.state, s.createdAt],
    );
    if (r.rowCount === 1) return;
    const g = await this.db().query<{ status: GameStatus; last_seq: number }>('SELECT status, last_seq FROM games WHERE id = $1', [s.game]);
    const row = g.rows[0];
    if (!row) throw new StoreError('notFound', `no game ${s.game}`);
    if (row.status !== 'running') throw new StoreError('status', `game ${s.game} is ${row.status}`);
    throw new StoreError('order', `snapshot ${s.seq} is past the last committed record ${row.last_seq} (review 8: snapshot only after the commit)`);
  }

  /** Test hook (the contract suite, review 8): a snapshot row without the committed-seq guard, as a crash could leave one. */
  async forceSnapshot(s: SnapshotRow): Promise<void> {
    await this.db().query(
      'INSERT INTO snapshots (game_id, seq, engine_build, hash, state, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [s.game, s.seq, s.engineBuild, s.hash, s.state, s.createdAt],
    );
  }

  async loadForRecovery(id: string, o: RecoveryOptions = {}): Promise<RecoveryData> {
    return this.db().transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const g = await tx.query<{
        status: GameStatus; config: string | null; seed: string | null; seating: number[] | null; engine_build: string | null; last_seq: number;
        recoveries: number; engine_errors: number;
      }>('SELECT status, config::text AS config, seed, seating, engine_build, last_seq, recoveries, engine_errors FROM games WHERE id = $1', [id]);
      const row = g.rows[0];
      if (!row) throw new StoreError('notFound', `no game ${id}`);
      if (row.config === null || row.seed === null || row.seating === null || row.engine_build === null) throw new StoreError('status', `game ${id} never started`);
      const lastSeq = row.last_seq;
      // review 8: the newest snapshot not past the last committed record (none when asked to ignore them)
      const sn = o.ignoreSnapshots ? { rows: [] } : await tx.query<{ seq: number; engine_build: string; hash: string; state: Uint8Array; created_at: Date }>(
        'SELECT seq, engine_build, hash, state, created_at FROM snapshots WHERE game_id = $1 AND seq <= $2 ORDER BY seq DESC LIMIT 1',
        [id, lastSeq],
      );
      const s = sn.rows[0];
      const snapshot: SnapshotRow | null = s
        ? { game: id, seq: s.seq, engineBuild: s.engine_build, hash: s.hash, state: new Uint8Array(s.state), createdAt: new Date(s.created_at) }
        : null;
      const recs = await tx.query<RecordRow>(
        `SELECT seq, seat, action::text AS action, cause, approved_by, clocks::text AS clocks, elapsed_ms, at, check_hash
         FROM actions WHERE game_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq`,
        [id, snapshot?.seq ?? 0, lastSeq],
      );
      const records = recs.rows.map((r) => recordOf(id, r));
      checkCoverage(id, records, snapshot?.seq ?? 0, lastSeq); // review MAJOR: never a short log
      return {
        game: id, status: row.status, config: JSON.parse(row.config) as RecoveryData['config'], seed: row.seed,
        seating: row.seating.map(Number) as SeatNumber[], engineBuild: row.engine_build, snapshot, records,
        lastSeq, recoveries: row.recoveries, engineErrors: row.engine_errors,
      };
    });
  }

  async countRecovery(id: string): Promise<number> {
    return this.bump(id, 'recoveries');
  }

  /** One more engine error of the game (design 2.2 step 2: flagged for the developer); returns the new count. */
  async countEngineError(id: string): Promise<number> {
    return this.bump(id, 'engine_errors');
  }

  private async bump(id: string, col: 'recoveries' | 'engine_errors'): Promise<number> {
    const r = await this.db().query<{ n: number }>(`UPDATE games SET ${col} = ${col} + 1 WHERE id = $1 RETURNING ${col} AS n`, [id]);
    const row = r.rows[0];
    if (!row) throw new StoreError('notFound', `no game ${id}`);
    return row.n;
  }

  async runningGames(node?: string): Promise<string[]> {
    const r =
      node === undefined
        ? await this.db().query<{ id: string }>(`SELECT id FROM games WHERE status = 'running' ORDER BY started_at, id`)
        : await this.db().query<{ id: string }>(`SELECT id FROM games WHERE status = 'running' AND node = $1 ORDER BY started_at, id`, [node]);
    return r.rows.map((x) => x.id);
  }

  async waitingTables(): Promise<{ id: string; waitingSince: Date }[]> {
    const r = await this.db().query<{ id: string; w: Date }>(
      `SELECT id, COALESCE(waiting_since, created_at) AS w FROM games WHERE status = 'waitingCapacity' ORDER BY w, id`,
    );
    return r.rows.map((x) => ({ id: x.id, waitingSince: new Date(x.w) }));
  }

  /** M13-6: a game's row and seats (no seed, no config). */
  async tableRow(id: string): Promise<TableRow | null> {
    return (await this.readTables('id = $1', [id]))[0] ?? null;
  }

  /** M13-6: the unstarted tables, oldest first. */
  async openTables(): Promise<TableRow[]> {
    return this.readTables(`status IN ('lobby', 'waitingCapacity')`, []);
  }

  private async readTables(where: string, params: unknown[]): Promise<TableRow[]> {
    return this.db().transaction(async (tx) => {
      const g = await tx.query<{
        id: string; format: TableRow['format']; variant: TableRow['variant']; seats: number; source: TableRow['source']; title: string;
        password_hash: string | null; password_salt: string | null; status: GameStatus; created_at: Date; waiting_since: Date | null;
        started_at: Date | null; seating: number[] | null;
      }>(
        `SELECT id, format, variant, seats, source, title, password_hash, password_salt, status, created_at, waiting_since, started_at, seating
         FROM games WHERE ${where} ORDER BY created_at, id`,
        params,
      );
      if (g.rows.length === 0) return [];
      const s = await tx.query<{
        game_id: string; seat: number; player: SeatRow['player']; session_id: string | null; name: string | null; deck: unknown; deck_hash: string | null;
        invite_hash: string | null; joined_at: Date | null; left_at: Date | null;
      }>(
        `SELECT game_id, seat, player, session_id, name, deck::text AS deck, deck_hash, invite_hash, joined_at, left_at
         FROM seats WHERE game_id = ANY($1::text[]) ORDER BY game_id, seat`,
        [g.rows.map((x) => x.id)],
      );
      return g.rows.map((x) => ({
        id: x.id, format: x.format, variant: x.variant, seats: Number(x.seats) as TableRow['seats'], source: x.source, title: x.title,
        passwordHash: x.password_hash, passwordSalt: x.password_salt, createdAt: new Date(x.created_at), status: x.status,
        waitingSince: x.waiting_since ? new Date(x.waiting_since) : null, startedAt: x.started_at ? new Date(x.started_at) : null,
        seating: x.seating ? (x.seating.map(Number) as SeatNumber[]) : null,
        seatRows: s.rows.filter((r) => r.game_id === x.id).map((r) => ({
          seat: Number(r.seat) as SeatNumber, player: r.player, session: r.session_id, name: r.name,
          deck: r.deck === null ? null : (JSON.parse(String(r.deck)) as SeatRow['deck']), deckHash: r.deck_hash, inviteHash: r.invite_hash,
          joinedAt: r.joined_at ? new Date(r.joined_at) : null, leftAt: r.left_at ? new Date(r.left_at) : null,
        })),
      }));
    });
  }

  async finishGame(id: string, record: GameRecord, last?: LogRecord): Promise<void> {
    if (record.game !== id) throw new StoreError('value', `the result is of game ${record.game}, not ${id}`);
    const result = canonicalResult(record);
    if (last && last.game !== id) throw new StoreError('value', 'the last record is of another game');
    try {
      await this.db().transaction(async (tx) => {
        const g = await lockGame(tx, id);
        if (g.status !== 'running') {
          // a retry of a finish that committed (an ambiguous COMMIT): the same result and final record stored already is success
          const [stored] = await this.readResults('game_id = $1', [id], 'game_id', 1, tx);
          if (!stored) throw new StoreError('status', `game ${id} is ${g.status}`);
          if (stableJson(stored) !== stableJson(result)) throw new StoreError('exists', `game ${id} has a result`);
          if (last && (last.seq > g.last_seq || (await advance(tx, id, [last]).catch(() => true)))) throw new StoreError('exists', `game ${id} has a result`);
          return;
        }
        // (a final record committed already exactly as given is not inserted again)
        if (last && (await advance(tx, id, [last]))) await insertRecords(tx, id, [last]);
        await insertResult(tx, result);
        const status = endStatus(result);
        await tx.query('UPDATE games SET status = $2, ended_at = $3, void_reason = $4 WHERE id = $1', [
          id, status, result.endedAt, result.outcome === 'void' ? result.reason : null,
        ]);
        await tx.query('DELETE FROM snapshots WHERE game_id = $1', [id]);
      });
    } catch (e) {
      if (pgCode(e) === '23505') throw new StoreError('exists', `game ${id} has a result`);
      throw e;
    }
  }

  async voidGame(id: string, reason: VoidReason, status: 'void' | 'quarantined' = 'void', record?: GameRecord): Promise<void> {
    assertStorable('reason', reason);
    const now = this.now();
    await this.db().transaction(async (tx) => {
      const r = await tx.query<{
        status: GameStatus; last_seq: number; format: GameRecord['format']; variant: GameRecord['variant']; seats: GameRecord['seats'];
        source: GameRecord['source']; started_at: Date | null; engine_build: string | null;
      }>('SELECT status, last_seq, format, variant, seats, source, started_at, engine_build FROM games WHERE id = $1 FOR UPDATE', [id]);
      const g = r.rows[0];
      if (!g) throw new StoreError('notFound', `no game ${id}`);
      if (g.status === 'finished' || g.status === 'void' || g.status === 'quarantined') return; // already over: nothing changes
      if (g.status === 'running' && g.started_at !== null && g.engine_build !== null) {
        const has = await tx.query('SELECT 1 FROM results WHERE game_id = $1', [id]);
        if (has.rows.length === 0) {
          // the table's record is checked only when it is written (review minor 8)
          const given = record ? voidLedgerRow(id, reason, record) : null;
          if (given) await insertResult(tx, given);
          else {
            const lc = await tx.query<{ clocks: string }>('SELECT clocks::text AS clocks FROM actions WHERE game_id = $1 AND seq = $2', [id, g.last_seq]);
            const lastClocks = lc.rows[0] ? (JSON.parse(lc.rows[0].clocks) as LogRecord['clocks']) : null;
            await insertResult(tx, voidRecord(
              { id, format: g.format, variant: g.variant, seats: g.seats, source: g.source, startedAt: new Date(g.started_at), engineBuild: g.engine_build },
              reason, now, g.last_seq, lastClocks,
            ));
          }
        }
      }
      // design 4.3: the password is deleted with the table
      await tx.query('UPDATE games SET status = $2, ended_at = $3, void_reason = $4, password_hash = NULL, password_salt = NULL WHERE id = $1', [id, status, now, reason]);
      await tx.query('DELETE FROM snapshots WHERE game_id = $1', [id]);
    });
  }

  // ---- ledger -------------------------------------------------------------------------------------------------------------------------------

  async results(since: Date, limit: number): Promise<GameRecord[]> {
    return this.readResults('ended_at >= $1', [since], 'ended_at, game_id', limit);
  }

  async sessionResults(session: string, o: SessionResultsQuery): Promise<GameRecord[]> {
    const where = ['ended_at >= $1', 'EXISTS (SELECT 1 FROM placements p WHERE p.game_id = results.game_id AND p.session_id = $2)'];
    const params: unknown[] = [o.since, session];
    if (o.before) {
      params.push(new Date(isoOf('before.endedAt', o.before.endedAt)), o.before.game);
      where.push(`(ended_at, game_id) < ($3, $4)`);
    }
    return this.readResults(where.join(' AND '), params, 'ended_at DESC, game_id DESC', o.limit);
  }

  /** Ledger rows matching `where` (parameters $1..), in `order`, at most `limit`, with their placements in seat order. */
  private async readResults(where: string, params: unknown[], order: string, limit: number, q?: SqlQueryable): Promise<GameRecord[]> {
    const db = q ?? this.db();
    const r = await db.query<{
      game_id: string; format: string; variant: GameRecord['variant']; seats: GameRecord['seats']; source: GameRecord['source']; outcome: GameRecord['outcome'];
      reason: string; turns: number; actions: number; started_at: Date; ended_at: Date; engine_build: string; seat_actions: string | null;
    }>(
      `SELECT game_id, format, variant, seats, source, outcome, reason, turns, actions, started_at, ended_at, engine_build,
         seat_actions::text AS seat_actions FROM results WHERE ${where} ORDER BY ${order} LIMIT $${params.length + 1}`,
      [...params, Math.max(0, Math.floor(limit))],
    );
    if (r.rows.length === 0) return [];
    const p = await db.query<{
      game_id: string; seat: number; player: Placement['player']; session_id: string; account_id: string | null; name: string; deck_hash: string;
      place: number; loss: Placement['loss']; loss_rule: string | null; out_turn: number | null; out_order: number | null; time_used_ms: number;
      timeouts: number; disconnected_ms: number;
    }>('SELECT * FROM placements WHERE game_id = ANY($1::text[]) ORDER BY game_id, seat', [r.rows.map((x) => x.game_id)]);
    const byGame = new Map<string, Placement[]>();
    for (const x of p.rows) {
      const list = byGame.get(x.game_id) ?? [];
      list.push({
        seat: x.seat as Placement['seat'], player: x.player, session: x.session_id, account: x.account_id, name: x.name, deckHash: x.deck_hash,
        place: x.place as Placement['place'], loss: x.loss, lossRule: x.loss_rule, outTurn: x.out_turn, outOrder: x.out_order,
        timeUsedMs: Number(x.time_used_ms), timeouts: x.timeouts, disconnectedMs: Number(x.disconnected_ms),
      });
      byGame.set(x.game_id, list);
    }
    return r.rows.map((x) => ({
      game: x.game_id, format: x.format, variant: x.variant, seats: x.seats, source: x.source, ranked: false, outcome: x.outcome, reason: x.reason,
      turns: x.turns, actions: x.actions, startedAt: new Date(x.started_at).toISOString(), endedAt: new Date(x.ended_at).toISOString(),
      engineBuild: x.engine_build, placements: byGame.get(x.game_id) ?? [],
      ...(x.seat_actions !== null ? { seatActions: JSON.parse(x.seat_actions) as LedgerRow['seatActions'] } : {}),
    }) as LedgerRow);
  }

  // ---- bug inbox ----------------------------------------------------------------------------------------------------------------------------

  async putReport(r: ReportRow): Promise<void> {
    checkId('report', r.id);
    assertStorable('report', r);
    checkDate('createdAt', r.createdAt);
    try {
      await this.db().query(
        `INSERT INTO bug_reports (id, kind, session_id, game_id, seat, text, attachments, created_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [r.id, r.kind, r.session, r.game, r.seat, r.text, JSON.stringify(r.attachments.map((a) => ({ kind: a.kind, json: a.json }))), r.createdAt, r.status],
      );
    } catch (e) {
      if (pgCode(e) === '23505') throw new StoreError('exists', `report ${r.id} exists`);
      throw e;
    }
  }

  async reports(since: Date, limit: number): Promise<ReportRow[]> {
    const r = await this.db().query<{
      id: string; kind: ReportRow['kind']; session_id: string; game_id: string | null; seat: number | null; text: string; attachments: string;
      created_at: Date; status: ReportRow['status'];
    }>(
      `SELECT id, kind, session_id, game_id, seat, text, attachments, created_at, status FROM bug_reports
       WHERE created_at >= $1 ORDER BY created_at, id LIMIT $2`,
      [since, Math.max(0, Math.floor(limit))],
    );
    return r.rows.map((x) => ({
      id: x.id, kind: x.kind, session: x.session_id, game: x.game_id, seat: x.seat, text: x.text,
      attachments: JSON.parse(x.attachments) as ReportRow['attachments'], createdAt: new Date(x.created_at), status: x.status,
    }));
  }

  /** The seat left the game (M13-6); the first time stays. */
  async markSeatLeft(id: string, seat: SeatNumber, at: Date): Promise<void> {
    checkDate('leftAt', at);
    const r = await this.db().query('UPDATE seats SET left_at = COALESCE(left_at, $3) WHERE game_id = $1 AND seat = $2', [id, seat, at]);
    if (r.rowCount !== 1) throw new StoreError('notFound', `game ${id} has no seat ${seat}`);
  }

  /** Sets a report's status (the owner's inbox command, M13-13). */
  async setReportStatus(id: string, status: ReportRow['status']): Promise<void> {
    const r = await this.db().query('UPDATE bug_reports SET status = $2 WHERE id = $1', [id, status]);
    if (r.rowCount !== 1) throw new StoreError('notFound', `no report ${id}`);
  }

  // ---- retention ----------------------------------------------------------------------------------------------------------------------------

  async purge(policy: RetentionPolicy, now: Date): Promise<PurgeReport> {
    return this.db().transaction(async (tx) => {
      const sessions = (await tx.query('DELETE FROM sessions WHERE last_seen < $1', [cutoff(now, policy.sessionDays)])).rowCount;
      const ids = (
        await tx.query<{ id: string }>(
          `SELECT id FROM games WHERE (status = 'finished' AND ended_at < $1)
             OR (status IN ('void', 'quarantined') AND started_at IS NOT NULL AND COALESCE(ended_at, created_at) < $2)
             OR (status <> 'running' AND started_at IS NULL AND created_at < $3)`,
          [cutoff(now, policy.logsDays), cutoff(now, policy.voidDays), cutoff(now, policy.lobbyDays)],
        )
      ).rows.map((x) => x.id);
      let records = 0;
      let snapshots = 0;
      let games = 0;
      if (ids.length > 0) {
        records = (await tx.query('DELETE FROM actions WHERE game_id = ANY($1::text[])', [ids])).rowCount;
        snapshots = (await tx.query('DELETE FROM snapshots WHERE game_id = ANY($1::text[])', [ids])).rowCount;
        games = (await tx.query('DELETE FROM games WHERE id = ANY($1::text[])', [ids])).rowCount; // seats go with them
      }
      let reports = 0;
      const old = await tx.query<{ id: string; attachments: string }>('SELECT id, attachments FROM bug_reports WHERE created_at < $1', [
        cutoff(now, policy.logsDays),
      ]);
      for (const r of old.rows) {
        const kept = attachmentsAfterRetention(JSON.parse(r.attachments) as ReportRow['attachments']);
        if (!kept) continue;
        await tx.query('UPDATE bug_reports SET attachments = $2 WHERE id = $1', [r.id, JSON.stringify(kept)]);
        reports++;
      }
      return { sessions, games, records, snapshots, reports };
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sql.close();
  }
}

async function insertResult(tx: SqlQueryable, r: LedgerRow): Promise<void> {
  await tx.query(
    `INSERT INTO results (game_id, format, variant, seats, source, ranked, outcome, reason, turns, actions, started_at, ended_at, engine_build, seat_actions)
     VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [r.game, r.format, r.variant, r.seats, r.source, r.outcome, r.reason, r.turns, r.actions, r.startedAt, r.endedAt, r.engineBuild,
      r.seatActions === undefined ? null : JSON.stringify(r.seatActions)],
  );
  for (const p of r.placements) {
    await tx.query(
      `INSERT INTO placements (game_id, seat, player, session_id, account_id, name, deck_hash, place, loss, loss_rule, out_turn, out_order, time_used_ms,
         timeouts, disconnected_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [r.game, p.seat, p.player, p.session, p.account, p.name, p.deckHash, p.place, p.loss, p.lossRule, p.outTurn, p.outOrder, p.timeUsedMs, p.timeouts, p.disconnectedMs],
    );
  }
}
