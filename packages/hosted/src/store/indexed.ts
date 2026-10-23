/**
 * The memory and file stores' common core (M13-4): every row but the action log, the config and the snapshots lives in an in-memory index; a
 * `Persistence` writes each change first and the index changes only after the write succeeded, so a failed write leaves both as they were. All
 * changes and recovery loads run one at a time (one async queue): simple and consistent, enough for unit tests and development (production uses
 * PostgreSQL).
 */
import type { CommanderVariant } from '@openmtg/engine';
import type { HostedFormatId, SeatNumber, TableSize, TableSource } from '../api';
import type { GameRecord, VoidReason } from '../ledger/types';
import type {
  AppendResult, GameStatus, GameStore, LobbyPatch, LogRecord, NewGameRow, PurgeReport, RecoveryData, RecoveryOptions, ReportRow, RetentionPolicy, SeatRow,
  SessionResultsQuery, SessionRow, SnapshotRow, StartRow, TableRow,
} from './api';
import {
  assertStorable, attachmentsAfterRetention, batchOrderProblem, canonicalRecord, canonicalResult, checkId, continuationProblem, cutoff, groupBatch,
  checkCoverage, endStatus, purgeable, voidLedgerRow, recordProblem, sameRecord, stableJson, StoreError, voidRecord,
} from './rules';

/** A game's row as the index (and the file store's game.json) keeps it: JSON-friendly, times as ISO strings. Seed and config not included. */
export interface GameMeta {
  id: string;
  format: HostedFormatId;
  variant: CommanderVariant | null;
  seats: TableSize;
  source: TableSource;
  title: string;
  passwordHash: string | null;
  passwordSalt: string | null;
  status: GameStatus;
  createdAt: string;
  waitingSince: string | null;
  startedAt: string | null;
  endedAt: string | null;
  engineBuild: string | null;
  rulesPack: string | null;
  seating: SeatNumber[] | null;
  recoveries: number;
  engineErrors: number;
  voidReason: string | null;
  node: string | null;
  seatRows: SeatJson[];
}

export type SeatJson = Omit<SeatRow, 'joinedAt' | 'leftAt'> & { joinedAt: string | null; leftAt: string | null };

export type SessionJson = Omit<SessionRow, 'createdAt' | 'lastSeen'> & { createdAt: string; lastSeen: string };
export type ReportJson = Omit<ReportRow, 'createdAt'> & { createdAt: string };

export const sessionToJson = (s: SessionRow): SessionJson => ({ ...s, createdAt: s.createdAt.toISOString(), lastSeen: s.lastSeen.toISOString() });
export const sessionFromJson = (s: SessionJson): SessionRow => ({ ...s, createdAt: new Date(s.createdAt), lastSeen: new Date(s.lastSeen) });
export const reportToJson = (r: ReportRow): ReportJson => ({ ...r, attachments: r.attachments.map((a) => ({ kind: a.kind, json: a.json })), createdAt: r.createdAt.toISOString() });
export const reportFromJson = (r: ReportJson): ReportRow => ({ ...r, attachments: r.attachments.map((a) => ({ kind: a.kind, json: a.json })), createdAt: new Date(r.createdAt) });

const seatToJson = (s: SeatRow): SeatJson => ({
  seat: s.seat, player: s.player, session: s.session, name: s.name, deck: s.deck === null ? null : (JSON.parse(JSON.stringify(s.deck)) as SeatRow['deck']),
  deckHash: s.deckHash, inviteHash: s.inviteHash, joinedAt: s.joinedAt?.toISOString() ?? null, leftAt: s.leftAt?.toISOString() ?? null,
});

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const date = (s: string | null): Date | null => (s === null ? null : new Date(s));

const seatFromJson = (s: SeatJson): SeatRow => ({
  seat: s.seat, player: s.player, session: s.session, name: s.name, deck: s.deck === null ? null : (JSON.parse(JSON.stringify(s.deck)) as SeatRow['deck']),
  deckHash: s.deckHash, inviteHash: s.inviteHash, joinedAt: date(s.joinedAt), leftAt: date(s.leftAt),
});

/** M13-6: the row as `tableRow` returns it (copies). */
function tableRowOf(m: GameMeta): TableRow {
  return {
    id: m.id, format: m.format, variant: m.variant, seats: m.seats, source: m.source, title: m.title, passwordHash: m.passwordHash,
    passwordSalt: m.passwordSalt, createdAt: new Date(m.createdAt), seatRows: m.seatRows.map(seatFromJson), status: m.status,
    waitingSince: date(m.waitingSince), startedAt: date(m.startedAt), seating: m.seating ? [...m.seating] : null,
  };
}

function checkDate(label: string, d: unknown): void {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) throw new StoreError('value', `${label} is not a valid Date`);
}

function checkSeatRows(rows: readonly SeatRow[]): void {
  assertStorable('seats', rows);
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.seat)) throw new StoreError('value', `seat ${r.seat} given twice`);
    seen.add(r.seat);
  }
}

/** The writes a store makes durable. Each throws to refuse; the index is changed only after it resolved. */
export interface Persistence {
  putSession(s: SessionRow): Promise<void>;
  deleteSession(id: string): Promise<void>;
  putGame(meta: GameMeta): Promise<void>;
  /** The config JSON (without the seed) and the seed, written once at the start, before the game's meta says 'running'. */
  putStart(id: string, configJson: string, seed: string): Promise<void>;
  readStart(id: string): Promise<{ configJson: string; seed: string }>;
  /** Appends one game's record lines durably; on failure nothing of them is kept. */
  appendLog(id: string, lines: string[]): Promise<void>;
  /** The game's committed record lines, in order. */
  readLog(id: string): Promise<string[]>;
  putSnapshot(s: SnapshotRow): Promise<void>;
  snapshotSeqs(id: string): Promise<number[]>;
  readSnapshot(id: string, seq: number): Promise<SnapshotRow>;
  deleteSnapshots(id: string): Promise<number>;
  /** Deletes the game, its seats, log and snapshots; returns how many records and snapshots went. */
  deleteGame(id: string): Promise<{ records: number; snapshots: number }>;
  putResult(r: GameRecord): Promise<void>;
  putReport(r: ReportRow): Promise<void>;
  close(): Promise<void>;
}

/** The index a store starts from (empty for the memory store; read from disk by the file store). */
export interface StoreIndex {
  sessions: Map<string, SessionRow>;
  games: Map<string, { meta: GameMeta; lastSeq: number }>;
  results: Map<string, GameRecord>;
  reports: Map<string, ReportRow>;
}

export const emptyIndex = (): StoreIndex => ({ sessions: new Map(), games: new Map(), results: new Map(), reports: new Map() });

export interface IndexedStoreOptions {
  /** The store's clock for `voidGame`'s end time (default: the system clock). */
  now?: () => Date;
}

export class IndexedStore implements GameStore {
  private readonly tokens = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly now: () => Date;

  constructor(
    private readonly io: Persistence,
    private readonly ix: StoreIndex,
    opts: IndexedStoreOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    for (const s of ix.sessions.values()) this.tokens.set(s.tokenHash, s.id);
  }

  /** Runs `fn` after every earlier operation (one at a time). */
  protected run<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.closed) return Promise.reject(new StoreError('closed', 'the store is closed'));
    const p = this.queue.then(fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private game(id: string): { meta: GameMeta; lastSeq: number } {
    const g = this.ix.games.get(id);
    if (!g) throw new StoreError('notFound', `no game ${id}`);
    return g;
  }

  // ---- sessions -----------------------------------------------------------------------------------------------------------------------------

  putSession(s: SessionRow): Promise<void> {
    return this.run(async () => {
      checkId('session', s.id);
      assertStorable('session', s);
      checkDate('createdAt', s.createdAt);
      checkDate('lastSeen', s.lastSeen);
      const holder = this.tokens.get(s.tokenHash);
      if (holder !== undefined && holder !== s.id) throw new StoreError('exists', 'another session has this token hash');
      const row: SessionRow = { id: s.id, tokenHash: s.tokenHash, name: s.name, createdAt: new Date(s.createdAt), lastSeen: new Date(s.lastSeen) };
      await this.io.putSession(row);
      const old = this.ix.sessions.get(s.id);
      if (old) this.tokens.delete(old.tokenHash);
      this.ix.sessions.set(s.id, row);
      this.tokens.set(row.tokenHash, row.id);
    });
  }

  sessionByTokenHash(hash: string): Promise<SessionRow | null> {
    return this.run(() => {
      const id = this.tokens.get(hash);
      const s = id === undefined ? undefined : this.ix.sessions.get(id);
      return s ? { ...s, createdAt: new Date(s.createdAt), lastSeen: new Date(s.lastSeen) } : null;
    });
  }

  touchSession(id: string, at: Date): Promise<void> {
    return this.run(async () => {
      checkDate('at', at);
      const s = this.ix.sessions.get(id);
      if (!s) return; // purged or never stored: nothing to touch
      const row = { ...s, lastSeen: new Date(at) };
      await this.io.putSession(row);
      this.ix.sessions.set(id, row);
    });
  }

  // ---- tables and games ---------------------------------------------------------------------------------------------------------------------

  createGame(g: NewGameRow): Promise<void> {
    return this.run(async () => {
      checkId('game', g.id);
      if (this.ix.games.has(g.id)) throw new StoreError('exists', `game ${g.id} exists`);
      const { seatRows, createdAt, ...rest } = g;
      assertStorable('game', rest);
      checkDate('createdAt', createdAt);
      checkSeatRows(seatRows);
      const meta: GameMeta = {
        id: g.id, format: g.format, variant: g.variant, seats: g.seats, source: g.source, title: g.title, passwordHash: g.passwordHash,
        passwordSalt: g.passwordSalt, status: 'lobby', createdAt: createdAt.toISOString(), waitingSince: null, startedAt: null, endedAt: null,
        engineBuild: null, rulesPack: null, seating: null, recoveries: 0, engineErrors: 0, voidReason: null, node: null,
        seatRows: seatRows.map(seatToJson),
      };
      await this.io.putGame(meta);
      this.ix.games.set(g.id, { meta, lastSeq: 0 });
    });
  }

  updateLobby(id: string, patch: LobbyPatch): Promise<void> {
    return this.run(async () => {
      const g = this.game(id);
      if (g.meta.status !== 'lobby' && g.meta.status !== 'waitingCapacity') throw new StoreError('status', `game ${id} is ${g.meta.status}`);
      const { seatRows, waitingSince, ...rest } = patch;
      assertStorable('lobby', rest);
      if (seatRows) checkSeatRows(seatRows);
      if (waitingSince) checkDate('waitingSince', waitingSince);
      const meta: GameMeta = {
        ...g.meta,
        ...(rest.title !== undefined ? { title: rest.title } : {}),
        ...(rest.passwordHash !== undefined ? { passwordHash: rest.passwordHash } : {}),
        ...(rest.passwordSalt !== undefined ? { passwordSalt: rest.passwordSalt } : {}),
        ...(rest.status !== undefined ? { status: rest.status } : {}),
        ...(waitingSince !== undefined ? { waitingSince: iso(waitingSince) } : {}),
        ...(seatRows ? { seatRows: seatRows.map(seatToJson) } : {}),
      };
      await this.io.putGame(meta);
      g.meta = meta;
    });
  }

  startGame(id: string, start: StartRow): Promise<void> {
    return this.run(async () => {
      const g = this.game(id);
      if (g.meta.status !== 'lobby' && g.meta.status !== 'waitingCapacity') throw new StoreError('status', `game ${id} is ${g.meta.status}`);
      if ('seed' in (start.config as object)) throw new StoreError('value', 'the config must not hold the seed');
      assertStorable('start', start);
      checkDate('startedAt', start.startedAt);
      const configJson = JSON.stringify(start.config);
      await this.io.putStart(id, configJson, start.seed);
      const players = new Map(start.seating.map((seat, i) => [seat, `p${i + 1}` as const]));
      const meta: GameMeta = {
        ...g.meta, status: 'running', startedAt: start.startedAt.toISOString(), engineBuild: start.engineBuild, rulesPack: start.rulesPack,
        seating: [...start.seating], node: start.node, waitingSince: null,
        // design 4.3: the password is deleted with the table (a started game has no door to lock)
        passwordHash: null, passwordSalt: null,
        seatRows: g.meta.seatRows.map((s) => ({ ...s, player: players.get(s.seat) ?? null })),
      };
      await this.io.putGame(meta);
      g.meta = meta;
      g.lastSeq = 0;
    });
  }

  appendRecords(batch: LogRecord[]): Promise<AppendResult> {
    return this.run(async () => {
      const groups = groupBatch(batch);
      const errors = new Map<string, string>();
      const writes: { game: string; last: number; lines: string[] }[] = [];
      for (const [game, recs] of groups) {
        const g = this.ix.games.get(game);
        const order = batchOrderProblem(recs);
        if (order) {
          errors.set(game, order);
          continue;
        }
        if (g && recs[0]!.seq <= g.lastSeq) {
          // A retried batch (review minor 2): committed already when every record is stored exactly as given; anything else fails.
          if (recs[recs.length - 1]!.seq > g.lastSeq || !(await this.storedSame(game, recs))) {
            errors.set(game, `records ${recs[0]!.seq}..${recs[recs.length - 1]!.seq} differ from the committed log (last ${g.lastSeq})`);
          }
          continue;
        }
        const problem =
          continuationProblem(g?.meta.status ?? null, g?.lastSeq ?? 0, recs[0]!.seq) ?? recs.reduce<string | null>((p, r) => p ?? recordProblem(r), null);
        if (problem) errors.set(game, problem);
        else writes.push({ game, last: recs[recs.length - 1]!.seq, lines: recs.map((r) => JSON.stringify(canonicalRecord(r))) });
      }
      // Each game's log separately (the file store: each its own file, fsync'd), so one failure is that game's only.
      const settled = await Promise.allSettled(writes.map((w) => this.io.appendLog(w.game, w.lines)));
      settled.forEach((s, i) => {
        const w = writes[i]!;
        if (s.status === 'fulfilled') this.ix.games.get(w.game)!.lastSeq = w.last;
        else errors.set(w.game, s.reason instanceof Error ? s.reason.message : String(s.reason));
      });
      const result: AppendResult = { committed: [], failed: [] };
      for (const game of groups.keys()) {
        const e = errors.get(game);
        if (e === undefined) result.committed.push(game);
        else result.failed.push({ game, error: e });
      }
      return result;
    });
  }

  /** Whether each of `recs` (all at most the game's last seq) is stored exactly as given. */
  private async storedSame(game: string, recs: readonly LogRecord[]): Promise<boolean> {
    const bySeq = new Map((await this.io.readLog(game)).map((l) => {
      const r = JSON.parse(l) as LogRecord;
      return [r.seq, r] as const;
    }));
    return recs.every((r) => {
      const s = bySeq.get(r.seq);
      return s !== undefined && sameRecord(s, r);
    });
  }

  putSnapshot(s: SnapshotRow): Promise<void> {
    return this.run(async () => {
      const g = this.game(s.game);
      if (g.meta.status !== 'running') throw new StoreError('status', `game ${s.game} is ${g.meta.status}`);
      if (!Number.isInteger(s.seq) || s.seq < 1 || s.seq > g.lastSeq) {
        throw new StoreError('order', `snapshot ${s.seq} is past the last committed record ${g.lastSeq} (review 8: snapshot only after the commit)`);
      }
      assertStorable('snapshot', { engineBuild: s.engineBuild, hash: s.hash });
      checkDate('createdAt', s.createdAt);
      await this.io.putSnapshot({ ...s, state: new Uint8Array(s.state), createdAt: new Date(s.createdAt) });
    });
  }

  loadForRecovery(id: string, o: RecoveryOptions = {}): Promise<RecoveryData> {
    return this.run(async () => {
      const g = this.game(id);
      if (g.meta.startedAt === null || g.meta.seating === null || g.meta.engineBuild === null) throw new StoreError('status', `game ${id} never started`);
      const { configJson, seed } = await this.io.readStart(id);
      const lastSeq = g.lastSeq;
      // Review 8: the newest snapshot not past the last committed record (none when asked to ignore them).
      const seqs = o.ignoreSnapshots ? [] : (await this.io.snapshotSeqs(id)).filter((s) => s <= lastSeq).sort((a, b) => b - a);
      const snapshot = seqs.length > 0 ? await this.io.readSnapshot(id, seqs[0]!) : null;
      const from = snapshot?.seq ?? 0;
      const records = (await this.io.readLog(id))
        .map((l) => JSON.parse(l) as LogRecord)
        .filter((r) => r.seq > from && r.seq <= lastSeq);
      checkCoverage(id, records, from, lastSeq); // review MAJOR: never a short log
      return {
        game: id, status: g.meta.status, config: JSON.parse(configJson) as RecoveryData['config'], seed, seating: [...g.meta.seating],
        engineBuild: g.meta.engineBuild, snapshot, records, lastSeq, recoveries: g.meta.recoveries, engineErrors: g.meta.engineErrors,
      };
    });
  }

  countRecovery(id: string): Promise<number> {
    return this.bump(id, 'recoveries');
  }

  /** One more engine error of the game (design 2.2 step 2: flagged for the developer); returns the new count. */
  countEngineError(id: string): Promise<number> {
    return this.bump(id, 'engineErrors');
  }

  private bump(id: string, field: 'recoveries' | 'engineErrors'): Promise<number> {
    return this.run(async () => {
      const g = this.game(id);
      const meta = { ...g.meta, [field]: g.meta[field] + 1 };
      await this.io.putGame(meta);
      g.meta = meta;
      return meta[field];
    });
  }

  runningGames(node?: string): Promise<string[]> {
    return this.run(() =>
      [...this.ix.games.values()]
        .filter((g) => g.meta.status === 'running' && (node === undefined || g.meta.node === node))
        .sort((a, b) => (a.meta.startedAt! < b.meta.startedAt! ? -1 : a.meta.startedAt! > b.meta.startedAt! ? 1 : a.meta.id < b.meta.id ? -1 : 1))
        .map((g) => g.meta.id),
    );
  }

  waitingTables(): Promise<{ id: string; waitingSince: Date }[]> {
    return this.run(() =>
      [...this.ix.games.values()]
        .filter((g) => g.meta.status === 'waitingCapacity')
        .map((g) => ({ id: g.meta.id, waitingSince: new Date(g.meta.waitingSince ?? g.meta.createdAt) }))
        .sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime() || (a.id < b.id ? -1 : 1)),
    );
  }

  /** M13-6: a game's row and seats (no seed, no config). */
  tableRow(id: string): Promise<TableRow | null> {
    return this.run(() => {
      const g = this.ix.games.get(id);
      return g ? tableRowOf(g.meta) : null;
    });
  }

  /** M13-6: the seat left the game; the first time stays. */
  markSeatLeft(id: string, seat: SeatNumber, at: Date): Promise<void> {
    return this.run(async () => {
      const g = this.game(id);
      checkDate('leftAt', at);
      const i = g.meta.seatRows.findIndex((r) => r.seat === seat);
      if (i < 0) throw new StoreError('notFound', `game ${id} has no seat ${seat}`);
      if (g.meta.seatRows[i]!.leftAt !== null) return;
      const meta: GameMeta = { ...g.meta, seatRows: g.meta.seatRows.map((r, j) => (j === i ? { ...r, leftAt: iso(at) } : r)) };
      await this.io.putGame(meta);
      g.meta = meta;
    });
  }

  /** M13-6: the unstarted tables, oldest first. */
  openTables(): Promise<TableRow[]> {
    return this.run(() =>
      [...this.ix.games.values()]
        .filter((g) => g.meta.status === 'lobby' || g.meta.status === 'waitingCapacity')
        .sort((a, b) => (a.meta.createdAt < b.meta.createdAt ? -1 : a.meta.createdAt > b.meta.createdAt ? 1 : a.meta.id < b.meta.id ? -1 : 1))
        .map((g) => tableRowOf(g.meta)),
    );
  }

  /** An earlier finish or void stopped after writing its result (review minor 1): the ledger row decides the game's status. */
  private async rollForward(g: { meta: GameMeta }, result: GameRecord): Promise<void> {
    if (g.meta.status === 'finished' || g.meta.status === 'void' || g.meta.status === 'quarantined') return;
    const meta: GameMeta = { ...g.meta, status: endStatus(result), endedAt: result.endedAt, voidReason: result.outcome === 'void' ? result.reason : null };
    await this.io.putGame(meta);
    g.meta = meta;
    await this.io.deleteSnapshots(g.meta.id);
  }

  finishGame(id: string, record: GameRecord, last?: LogRecord): Promise<void> {
    return this.run(async () => {
      const g = this.game(id);
      if (record.game !== id) throw new StoreError('value', `the result is of game ${record.game}, not ${id}`);
      if (last && last.game !== id) throw new StoreError('value', 'the last record is of another game');
      const result = canonicalResult(record);
      const existing = this.ix.results.get(id);
      if (existing) {
        // Append-only. A retry of the same finish (its result and final record stored as given) succeeds; the status follows the stored result.
        await this.rollForward(g, existing);
        if (stableJson(existing) === stableJson(result) && (!last || (last.seq <= g.lastSeq && (await this.storedSame(id, [last]))))) return;
        throw new StoreError('exists', `game ${id} has a result`);
      }
      if (g.meta.status !== 'running') throw new StoreError('status', `game ${id} is ${g.meta.status}`);
      let line: string | null = null;
      if (last && !(last.seq === g.lastSeq && (await this.storedSame(id, [last])))) {
        // (a final record committed already exactly as given is not appended again)
        const problem = continuationProblem('running', g.lastSeq, last.seq) ?? recordProblem(last);
        if (problem) throw new StoreError(problem.startsWith('expected') ? 'order' : 'value', problem);
        line = JSON.stringify(canonicalRecord(last));
      }
      // The file store's "transaction": the record, then the result, then the status (a result found beside a running game is rolled forward, at
      // open and by a later finishGame or voidGame).
      if (line !== null) {
        await this.io.appendLog(id, [line]);
        g.lastSeq = last!.seq;
      }
      await this.io.putResult(result);
      this.ix.results.set(id, result);
      await this.rollForward(g, result);
    });
  }

  voidGame(id: string, reason: VoidReason, status: 'void' | 'quarantined' = 'void', record?: GameRecord): Promise<void> {
    return this.run(async () => {
      const g = this.game(id);
      if (g.meta.status === 'finished' || g.meta.status === 'void' || g.meta.status === 'quarantined') return; // already over: nothing changes
      const existing = this.ix.results.get(id);
      if (existing) {
        // a finish stopped after its result: the game ends as its ledger row says, never void beside a win (review minor 1)
        await this.rollForward(g, existing);
        return;
      }
      assertStorable('reason', reason);
      const now = this.now();
      if (g.meta.status === 'running') {
        const m = g.meta;
        // the table's record is checked only when it is written (review minor 8)
        const given = record ? voidLedgerRow(id, reason, record) : null;
        const lines = given || g.lastSeq === 0 ? [] : await this.io.readLog(id);
        const lastClocks = lines.length > 0 ? (JSON.parse(lines[lines.length - 1]!) as LogRecord).clocks : null;
        const result = given ?? voidRecord(
          { id, format: m.format, variant: m.variant, seats: m.seats, source: m.source, startedAt: new Date(m.startedAt!), engineBuild: m.engineBuild! },
          reason, now, g.lastSeq, lastClocks,
        );
        await this.io.putResult(result);
        this.ix.results.set(id, result);
      }
      const meta: GameMeta = { ...g.meta, status, endedAt: now.toISOString(), voidReason: reason, passwordHash: null, passwordSalt: null }; // 4.3: gone with the table
      await this.io.putGame(meta);
      g.meta = meta;
      await this.io.deleteSnapshots(id);
    });
  }

  // ---- ledger and inbox ---------------------------------------------------------------------------------------------------------------------

  results(since: Date, limit: number): Promise<GameRecord[]> {
    return this.run(() =>
      [...this.ix.results.values()]
        .filter((r) => Date.parse(r.endedAt) >= since.getTime())
        .sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt) || (a.game < b.game ? -1 : 1))
        .slice(0, Math.max(0, limit))
        .map((r) => JSON.parse(JSON.stringify(r)) as GameRecord),
    );
  }

  sessionResults(session: string, o: SessionResultsQuery): Promise<GameRecord[]> {
    return this.run(() => {
      const since = o.since.getTime();
      const after = o.before ? { t: Date.parse(o.before.endedAt), game: o.before.game } : null;
      return [...this.ix.results.values()]
        .filter((r) => r.placements.some((p) => p.session === session) && Date.parse(r.endedAt) >= since)
        .filter((r) => !after || Date.parse(r.endedAt) < after.t || (Date.parse(r.endedAt) === after.t && r.game < after.game))
        .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt) || (a.game < b.game ? 1 : -1))
        .slice(0, Math.max(0, o.limit))
        .map((r) => JSON.parse(JSON.stringify(r)) as GameRecord);
    });
  }

  putReport(r: ReportRow): Promise<void> {
    return this.run(async () => {
      checkId('report', r.id);
      if (this.ix.reports.has(r.id)) throw new StoreError('exists', `report ${r.id} exists`);
      assertStorable('report', r);
      checkDate('createdAt', r.createdAt);
      const row = reportFromJson(reportToJson(r));
      await this.io.putReport(row);
      this.ix.reports.set(r.id, row);
    });
  }

  reports(since: Date, limit: number): Promise<ReportRow[]> {
    return this.run(() =>
      [...this.ix.reports.values()]
        .filter((r) => r.createdAt.getTime() >= since.getTime())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
        .slice(0, Math.max(0, limit))
        .map((r) => reportFromJson(reportToJson(r))),
    );
  }

  /** Sets a report's status (the owner's inbox command, M13-13). */
  setReportStatus(id: string, status: ReportRow['status']): Promise<void> {
    return this.run(async () => {
      const r = this.ix.reports.get(id);
      if (!r) throw new StoreError('notFound', `no report ${id}`);
      const row = { ...r, status };
      await this.io.putReport(row);
      this.ix.reports.set(id, row);
    });
  }

  // ---- retention ----------------------------------------------------------------------------------------------------------------------------

  purge(policy: RetentionPolicy, now: Date): Promise<PurgeReport> {
    return this.run(async () => {
      const report: PurgeReport = { sessions: 0, games: 0, records: 0, snapshots: 0, reports: 0 };
      const sessionCut = cutoff(now, policy.sessionDays);
      for (const s of [...this.ix.sessions.values()]) {
        if (s.lastSeen < sessionCut) {
          await this.io.deleteSession(s.id);
          this.ix.sessions.delete(s.id);
          this.tokens.delete(s.tokenHash);
          report.sessions++;
        }
      }
      for (const g of [...this.ix.games.values()]) {
        const m = g.meta;
        if (!purgeable({ status: m.status, createdAt: new Date(m.createdAt), startedAt: date(m.startedAt), endedAt: date(m.endedAt) }, policy, now)) continue;
        const n = await this.io.deleteGame(m.id);
        this.ix.games.delete(m.id);
        report.games++;
        report.records += n.records;
        report.snapshots += n.snapshots;
      }
      const logCut = cutoff(now, policy.logsDays);
      for (const r of [...this.ix.reports.values()]) {
        if (r.createdAt >= logCut) continue;
        const kept = attachmentsAfterRetention(r.attachments);
        if (!kept) continue;
        const row = { ...r, attachments: kept };
        await this.io.putReport(row);
        this.ix.reports.set(r.id, row);
        report.reports++;
      }
      return report;
    });
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    const p = this.run(() => this.io.close());
    this.closed = true;
    return p;
  }
}
