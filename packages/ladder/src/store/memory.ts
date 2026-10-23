/**
 * `MemoryLadderStore` (M15-3; design 13.3, 8.3, 8.7, D20): the ladder store in plain maps, for tests, and the core the file store journals
 * (src/store/file.ts). Server only.
 *
 * How a write works (the shape of milestone 14's account store). Every write is a plan run against the committed tables through a `Tx`: the plan
 * reads through the transaction (it sees its own writes), checks everything it must refuse first, and records its changes as row mutations (put a
 * row, delete a row) without touching the tables. Only a plan that returns is committed, by applying its mutations in one synchronous step, so a
 * refused write changes nothing and no reader ever sees half of one: `applyGame` and `markSkipped` are each ONE atomic step (8.3). The memory store
 * applies at once; the file store writes the mutations to its journal first and applies them after the fsync, so the two answer every call alike, and
 * a replayed journal line reproduces exactly what the write did (the random 'deleted:' markers of an erasure are in its mutations, never drawn again).
 *
 * Rows are never changed in place (a plan builds a new row), inputs are copied on the way in and every answer is a deep copy: no caller can change
 * stored state through an argument or a result (13.3).
 *
 * Orders, so that every store (memory, file, PostgreSQL) answers alike: times compare as instants, then ids in code-point order ('C' collation);
 * leaderboards by (key desc, games desc, sortKey asc), history newest first by (endedAt, game), everything else oldest first.
 */
import { DEFAULT_TIER_FLOORS, DELETED_PLAYER_NAME, isLadderId, seasonBounds, type LadderId, type SeasonId, type TierId } from '../api';
import { isoMs } from '../api/season';
import type { AccountId } from '../accounts';
import type { AbuseReport } from '../abuse/types';
import { newDeletedSortKey, type RandomBytes } from '../ids';
import type { RankedStart, SkipReason, StartSeat } from '../ledger';
import type {
  AdjustmentRow, AppliedGame, AppliedSeat, CapEvent, ForgetReport, HistoryRow, IntakeCursor, LadderStore, LeaderboardQuery, PenaltyRow, RatingRow,
  SeasonRecord, SeasonRow, SkipWrite,
} from './api';

// ---- errors ----------------------------------------------------------------------------------------------------------------------------------

export type LadderStoreErrorCode = 'value' | 'closed' | 'locked' | 'corrupt' | 'notCompacted' | 'missing' | 'conflict';

/**
 * A store refusal: a bad argument ('value'), a closed or stopped store ('closed'), the file store's lock ('locked') or a damaged file ('corrupt').
 * Review of M15-3: 'notCompacted', the file store's answer to a forgetAccount that is committed (on disk and what every read answers) but whose
 * snapshot could not be written, so old journal lines still hold the id (call forgetAccount again to finish it: it is idempotent); 'missing', the
 * file store opened with `mustExist` on a directory that holds no store (the openmtg-ladder command, which never creates one); 'conflict', a
 * resetRating whose row is not there, or not as the caller read it (an erasure or a game since: 11.3, 8.7).
 */
export class LadderStoreError extends Error {
  constructor(readonly code: LadderStoreErrorCode, message: string) {
    super(message);
    this.name = 'LadderStoreError';
  }
}

const err = (code: LadderStoreErrorCode, message: string): LadderStoreError => new LadderStoreError(code, message);

function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw err('value', message);
}

// ---- tables ------------------------------------------------------------------------------------------------------------------------------------

/** The applied or skipped marker of a game (8.3): the idempotency key. */
export interface GameMarker { game: string; status: 'applied' | 'skipped'; at: string; reason: SkipReason | null }

/** A report as the store keeps it: the outbox row and, once sent, when (purgeReports counts 7 days from it). */
export interface StoredReport { report: AbuseReport; sentAt: string | null }

/** Every table of the store. */
export interface LadderTables {
  /** 'cursor': the sweep's IntakeCursor. */
  meta: Map<string, IntakeCursor>;
  /** By `${ladder}|${account}`. */
  ratings: Map<string, RatingRow>;
  /** By game: the registry of ranked starts (D8). */
  starts: Map<string, RankedStart>;
  /** By game. */
  games: Map<string, GameMarker>;
  /** By game: the rated games (10.2). */
  history: Map<string, HistoryRow>;
  /** By game. */
  caps: Map<string, CapEvent>;
  /** By `${ladder}|${season}`. */
  seasons: Map<string, SeasonRow>;
  /** By `${ladder}|${season}|${sortKey}`. */
  records: Map<string, SeasonRecord>;
  /** By account. */
  penalties: Map<string, PenaltyRow>;
  /** By report id. */
  reports: Map<string, StoredReport>;
  /** By dedupe key: the report id (11.2: one report per key). */
  reportKeys: Map<string, string>;
  /** By id. */
  adjustments: Map<string, AdjustmentRow>;
}
export type LadderTableName = keyof LadderTables;
export type LadderRowOf<T extends LadderTableName> = LadderTables[T] extends Map<string, infer R> ? R : never;
export const LADDER_TABLE_NAMES: readonly LadderTableName[] = Object.freeze([
  'meta', 'ratings', 'starts', 'games', 'history', 'caps', 'seasons', 'records', 'penalties', 'reports', 'reportKeys', 'adjustments',
] as const);

/** One change to one row: `v` the new row, or null to delete it. */
export type LadderMutation = { [T in LadderTableName]: { t: T; k: string; v: LadderRowOf<T> | null } }[LadderTableName];

export function emptyLadderTables(): LadderTables {
  return Object.fromEntries(LADDER_TABLE_NAMES.map((t) => [t, new Map()])) as unknown as LadderTables;
}

/** Applies mutations in order, synchronously (nothing can read in between). */
export function applyLadderMutations(tables: LadderTables, muts: readonly LadderMutation[]): void {
  for (const m of muts) {
    const table = tables[m.t] as Map<string, unknown>;
    if (m.v === null) table.delete(m.k);
    else table.set(m.k, m.v);
  }
}

/** The tables as JSON-safe entries (the file store's snapshot, and the memory store's dump). */
export function ladderTablesToJson(tables: LadderTables): Record<LadderTableName, [string, unknown][]> {
  return Object.fromEntries(LADDER_TABLE_NAMES.map((t) => [t, [...(tables[t] as Map<string, unknown>).entries()]])) as Record<
    LadderTableName,
    [string, unknown][]
  >;
}

/** The tables back from ladderTablesToJson's form; throws on a shape that is not one. */
export function ladderTablesFromJson(json: unknown): LadderTables {
  if (typeof json !== 'object' || json === null) throw new Error('the tables are not an object');
  const src = json as Record<string, unknown>;
  const out = emptyLadderTables();
  for (const t of LADDER_TABLE_NAMES) {
    const entries = src[t];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) throw new Error(`table ${t} is not a list`);
    const map = out[t] as Map<string, unknown>;
    for (const e of entries) {
      if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string') throw new Error(`table ${t} holds an entry that is not [key, row]`);
      map.set(e[0], e[1]);
    }
  }
  return out;
}

/** A plan's view of the tables: reads see the plan's own writes; writes are recorded as mutations and applied only when the plan commits. */
export class LadderTx {
  readonly muts: LadderMutation[] = [];
  private readonly over = new Map<LadderTableName, Map<string, unknown>>();
  constructor(private readonly base: LadderTables) {}

  get<T extends LadderTableName>(t: T, k: string): LadderRowOf<T> | undefined {
    const o = this.over.get(t);
    if (o?.has(k)) return (o.get(k) ?? undefined) as LadderRowOf<T> | undefined;
    return (this.base[t] as Map<string, LadderRowOf<T>>).get(k);
  }
  put<T extends LadderTableName>(t: T, k: string, v: LadderRowOf<T>): void {
    this.mark(t, k, v);
  }
  del<T extends LadderTableName>(t: T, k: string): void {
    if (this.get(t, k) !== undefined) this.mark(t, k, null);
  }
  /** Every live row of a table: the committed ones as this plan changed them, then the ones it added. */
  *entries<T extends LadderTableName>(t: T): IterableIterator<[string, LadderRowOf<T>]> {
    const o = this.over.get(t);
    const base = this.base[t] as Map<string, LadderRowOf<T>>;
    for (const [k, v] of base) {
      if (o?.has(k)) {
        const w = o.get(k);
        if (w !== null && w !== undefined) yield [k, w as LadderRowOf<T>];
      } else yield [k, v];
    }
    if (o) for (const [k, w] of o) if (w !== null && !base.has(k)) yield [k, w as LadderRowOf<T>];
  }
  rows<T extends LadderTableName>(t: T): LadderRowOf<T>[] {
    return [...this.entries(t)].map(([, v]) => v);
  }
  private mark(t: LadderTableName, k: string, v: unknown): void {
    let o = this.over.get(t);
    if (!o) this.over.set(t, (o = new Map()));
    o.set(k, v);
    this.muts.push({ t, k, v } as LadderMutation);
  }
}

// ---- helpers -------------------------------------------------------------------------------------------------------------------------------------

const clone = <T>(x: T): T => structuredClone(x);
const ratingKey = (ladder: string, account: string): string => `${ladder}|${account}`;
const seasonKey = (ladder: string, season: string): string => `${ladder}|${season}`;
const recordKey = (ladder: string, season: string, sortKey: string): string => `${ladder}|${season}|${sortKey}`;
const CURSOR = 'cursor';

/** Code-point order ('C' collation), the tiebreak of every list. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
/** (time, id) order of two keyset positions, times as instants. */
export function compareTimeId(aTime: string, aId: string, bTime: string, bId: string): number {
  return isoMs(aTime) - isoMs(bTime) || compareText(aId, bId);
}
function time(label: string, x: unknown): string {
  need(typeof x === 'string', `${label} is not an ISO time`);
  try {
    isoMs(x);
  } catch {
    throw err('value', `${label} is not an ISO-8601 UTC time (${x})`);
  }
  return x;
}
function id(label: string, x: unknown): string {
  need(typeof x === 'string' && x.length > 0 && x.length <= 128, `${label} is not an id`);
  return x;
}
function ladder(label: string, x: unknown): LadderId {
  need(isLadderId(x), `${label} is not a ladder id (${String(x)})`);
  return x;
}
function limitOf(label: string, x: unknown): number {
  need(typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 100_000, `${label} must be a whole number from 1 to 100000 (${String(x)})`);
  return x;
}
function seatsOf(row: HistoryRow): (AccountId | null)[] {
  return row.seats.map((s) => s.account);
}
const TIER_ORDER: readonly TierId[] = ['wire', 'circuit', 'pulse', 'arc', 'laser', 'prism'];

/** A deleted account's history seat (8.7): no account, "Deleted player", no rating values. */
export function deletedSeat(s: AppliedSeat): AppliedSeat {
  return {
    ...s, account: null, name: DELETED_PLAYER_NAME, before: null, awayMs: 0, after: null, displayBefore: null, displayAfter: null, tierAfter: null,
  };
}

/**
 * A closed start's seats: wherever the account is gone (8.7), the snapshot cleared and the career count with it (`games` of one start and the next
 * would chain a deleted player's starts together, as its rating values would).
 */
function closedSeats(seats: readonly StartSeat[]): StartSeat[] {
  return seats.map((s) => (s.account === null ? { ...s, row: null, games: 0 } : s));
}

/**
 * A cap event as stored (8.5, 8.7): each seat's account from the registry entry being closed, never the caller's (the registry seat is
 * authoritative, 8.2), so a cap computed before an erasure and written after it holds no id; null where the registry seat is null, or where there is
 * no registry entry or no such seat (review of M15-3).
 */
function capOfRegistry(cap: CapEvent, start: RankedStart | undefined): CapEvent {
  const accountOf = new Map((start?.seats ?? []).map((s) => [s.seat, s.account]));
  return { ...cap, seats: cap.seats.map((s) => ({ ...s, account: accountOf.get(s.seat) ?? null })) };
}

/** The leaderboard key of a record: its standing (open season) or final standing (closed). */
function keyOf(r: SeasonRecord, closed: boolean): number {
  return (closed ? r.finalStanding : r.standing) ?? Number.NEGATIVE_INFINITY;
}

function eligible(r: SeasonRecord, q: Pick<LeaderboardQuery, 'ladder' | 'season' | 'closed' | 'minGames' | 'now'>, nowMs: number): boolean {
  if (r.ladder !== q.ladder || r.season !== q.season) return false;
  if (q.closed) return r.finalRank !== null && r.finalStanding !== null;
  return r.display !== null && r.standing !== null && r.games >= q.minGames && r.listed && r.provisionalFrom !== null
    && nowMs < isoMs(r.provisionalFrom);
}

/** 10.1's order: key desc, games desc, sortKey asc. */
function leaderboardOrder(closed: boolean): (a: SeasonRecord, b: SeasonRecord) => number {
  return (a, b) => keyOf(b, closed) - keyOf(a, closed) || b.games - a.games || compareText(a.sortKey, b.sortKey);
}

function afterCursor(r: SeasonRecord, closed: boolean, after: { key: number; games: number; sortKey: string }): boolean {
  const k = keyOf(r, closed);
  return k < after.key || (k === after.key && (r.games < after.games || (r.games === after.games && compareText(r.sortKey, after.sortKey) > 0)));
}

function checkQuery(q: Omit<LeaderboardQuery, 'after' | 'limit'>): number {
  ladder('q.ladder', q.ladder);
  need(typeof q.season === 'string', 'q.season is not a season id');
  need(typeof q.minGames === 'number' && Number.isInteger(q.minGames) && q.minGames >= 0, 'q.minGames is not a count');
  return isoMs(time('q.now', q.now));
}

export interface MemoryLadderStoreOptions {
  /** The random source of the 'deleted:' markers (8.7); node:crypto by default, a fixed source in tests. */
  random?: RandomBytes;
}

// ---- the store -------------------------------------------------------------------------------------------------------------------------------------

/** The memory store (13.3). `createMemoryLadderStore()` makes one; the file store extends it. */
export class MemoryLadderStore implements LadderStore {
  protected readonly t: LadderTables;
  protected closed = false;
  protected readonly random: RandomBytes | undefined;

  constructor(tables: LadderTables = emptyLadderTables(), options: MemoryLadderStoreOptions = {}) {
    this.t = tables;
    this.random = options.random;
  }

  /** Every table as JSON-safe entries: what the store holds, for tests that compare stores or search them for an id (17.5, 17.10). */
  dump(): Record<LadderTableName, [string, unknown][]> {
    return clone(ladderTablesToJson(this.t));
  }

  protected live(): void {
    if (this.closed) throw err('closed', 'the ladder store is closed');
  }
  protected async read<R>(f: (tx: LadderTx) => R): Promise<R> {
    this.live();
    return clone(f(new LadderTx(this.t)));
  }
  /** Runs a plan and commits it. The file store overrides this to serialize and journal. `op` names the method (the journal records it). */
  protected async write<R>(op: string, plan: (tx: LadderTx) => R): Promise<R> {
    void op;
    this.live();
    const tx = new LadderTx(this.t);
    const out = plan(tx);
    applyLadderMutations(this.t, tx.muts);
    return clone(out);
  }

  // ---- ratings ----

  async ratings(l: LadderId, accounts: readonly AccountId[]): Promise<Map<AccountId, RatingRow>> {
    ladder('ladder', l);
    need(Array.isArray(accounts), 'accounts is not a list');
    return this.read((tx) => {
      const out = new Map<AccountId, RatingRow>();
      for (const a of accounts) {
        const r = tx.get('ratings', ratingKey(l, a));
        if (r) out.set(a, r);
      }
      return out;
    });
  }

  // ---- the registry (D8) ----

  async putStart(s: RankedStart): Promise<void> {
    const start = clone(s);
    id('start.game', start.game);
    id('start.match', start.match);
    ladder('start.ladder', start.ladder);
    time('start.startedAt', start.startedAt);
    need(Array.isArray(start.seats) && start.seats.length >= 2 && start.seats.length <= 4, 'start.seats must hold 2-4 seats');
    need(['running', 'applied', 'void', 'skipped', 'lost'].includes(start.status), 'start.status is not a registry status');
    return this.write('putStart', (tx) => {
      if (tx.get('starts', start.game)) return; // idempotent by game id: the first write stands
      tx.put('starts', start.game, start);
    });
  }

  async start(game: string): Promise<RankedStart | null> {
    return this.read((tx) => tx.get('starts', game) ?? null);
  }

  async runningStarts(o: { account?: AccountId; startedBefore?: string; limit?: number } = {}): Promise<RankedStart[]> {
    const before = o.startedBefore === undefined ? null : isoMs(time('startedBefore', o.startedBefore));
    const limit = o.limit === undefined ? Number.POSITIVE_INFINITY : limitOf('limit', o.limit);
    return this.read((tx) =>
      tx
        .rows('starts')
        .filter((s) => s.status === 'running')
        .filter((s) => o.account === undefined || s.seats.some((x) => x.account === o.account))
        .filter((s) => before === null || isoMs(s.startedAt) < before)
        .sort((a, b) => compareTimeId(a.startedAt, a.game, b.startedAt, b.game))
        .slice(0, limit),
    );
  }

  async closeStart(game: string, status: 'lost', at: string): Promise<void> {
    need(status === 'lost', "closeStart only closes as 'lost' (every other close is inside applyGame or markSkipped)");
    time('at', at);
    return this.write('closeStart', (tx) => {
      const s = tx.get('starts', game);
      if (!s || s.status !== 'running') return;
      tx.put('starts', game, { ...s, status: 'lost', closedAt: at, seats: closedSeats(s.seats) });
    });
  }

  // ---- results (8.3) ----

  async applyGame(input: AppliedGame): Promise<'applied' | 'duplicate' | 'conflict'> {
    const a = clone(input);
    id('game', a.game);
    ladder('ladder', a.ladder);
    time('endedAt', a.endedAt);
    time('appliedAt', a.appliedAt);
    need(Array.isArray(a.seats) && Array.isArray(a.ratings) && Array.isArray(a.seasonRecords), 'seats, ratings and seasonRecords must be lists');
    need(a.cap === null || a.cap === undefined || (typeof a.cap === 'object' && Array.isArray(a.cap.seats)), 'cap is not a cap event');
    return this.write('applyGame', (tx) => {
      if (tx.get('games', a.game)) return 'duplicate';
      const start = tx.get('starts', a.game);
      if (!start || start.status !== 'running' || start.ladder !== a.ladder) return 'conflict';
      const seatOf = new Map(start.seats.map((s) => [s.seat, s]));
      const live = new Set(start.seats.flatMap((s) => (s.account === null ? [] : [s.account])));
      // every account written must still be the registry seat's (8.3, 8.7): an erasure since the computation is a conflict
      for (const s of a.seats) {
        const ss = seatOf.get(s.seat);
        if (!ss) return 'conflict';
        if (s.account !== null && ss.account !== s.account) return 'conflict';
      }
      for (const { row, expectVersion } of a.ratings) {
        if (row.ladder !== a.ladder || !live.has(row.account)) return 'conflict';
        const cur = tx.get('ratings', ratingKey(row.ladder, row.account));
        if (expectVersion === null ? cur !== undefined : cur?.version !== expectVersion) return 'conflict';
      }
      for (const r of a.seasonRecords) if (r.account === null || !live.has(r.account) || r.ladder !== a.ladder) return 'conflict';

      for (const { row, expectVersion } of a.ratings) {
        tx.put('ratings', ratingKey(row.ladder, row.account), { ...row, version: (expectVersion ?? 0) + 1 });
      }
      const seats = a.seats.map((s) => (s.account === null || seatOf.get(s.seat)!.account === null ? deletedSeat(s) : s));
      tx.put('history', a.game, { game: a.game, ladder: a.ladder, season: a.season, endedAt: a.endedAt, outcome: a.outcome, turns: a.turns, seats });
      for (const r of a.seasonRecords) {
        const k = recordKey(r.ladder, r.season, r.sortKey);
        const row = tx.get('seasons', seasonKey(r.ladder, r.season));
        if (row?.status === 'closed') continue; // a closed season never changes again (7)
        tx.put('records', k, r);
      }
      if (a.cap) tx.put('caps', a.game, capOfRegistry(a.cap, start));
      tx.put('starts', a.game, { ...start, status: 'applied', closedAt: a.appliedAt, seats: closedSeats(start.seats) });
      tx.put('games', a.game, { game: a.game, status: 'applied', at: a.appliedAt, reason: null });
      return 'applied';
    });
  }

  async markSkipped(input: SkipWrite): Promise<'stored' | 'duplicate'> {
    const s = clone(input);
    id('game', s.game);
    time('at', s.at);
    need(s.closeStartAs === null || s.closeStartAs === 'void' || s.closeStartAs === 'skipped', "closeStartAs is not 'void', 'skipped' or null");
    need(s.cap === null || s.cap === undefined || (typeof s.cap === 'object' && Array.isArray(s.cap.seats)), 'cap is not a cap event');
    return this.write('markSkipped', (tx) => {
      if (tx.get('games', s.game)) return 'duplicate';
      const start = tx.get('starts', s.game);
      tx.put('games', s.game, { game: s.game, status: 'skipped', at: s.at, reason: s.reason });
      if (s.cap) tx.put('caps', s.game, capOfRegistry(s.cap, start));
      if (s.closeStartAs !== null && start?.status === 'running') {
        tx.put('starts', s.game, { ...start, status: s.closeStartAs, closedAt: s.at, seats: closedSeats(start.seats) });
      }
      return 'stored';
    });
  }

  async applied(game: string): Promise<{ status: 'applied' | 'skipped'; at: string } | null> {
    return this.read((tx) => {
      const m = tx.get('games', game);
      return m ? { status: m.status, at: m.at } : null;
    });
  }

  async intakeCursor(): Promise<IntakeCursor | null> {
    return this.read((tx) => tx.get('meta', CURSOR) ?? null);
  }

  async setIntakeCursor(c: IntakeCursor): Promise<void> {
    const cursor = { endedAt: time('cursor.endedAt', c?.endedAt), game: typeof c?.game === 'string' ? c.game : '' };
    return this.write('setIntakeCursor', (tx) => tx.put('meta', CURSOR, cursor));
  }

  // ---- seasons (7, 10.1) ----

  async seasonRow(l: LadderId, season: SeasonId): Promise<SeasonRow | null> {
    return this.read((tx) => tx.get('seasons', seasonKey(l, season)) ?? null);
  }

  async putSeasonRow(r: SeasonRow): Promise<void> {
    const row = clone(r);
    ladder('row.ladder', row.ladder);
    seasonBounds(row.season);
    if (row.dailyAt !== undefined && row.dailyAt !== null) time('row.dailyAt', row.dailyAt);
    return this.write('putSeasonRow', (tx) => tx.put('seasons', seasonKey(row.ladder, row.season), { ...row, floors: [...row.floors] }));
  }

  async seasonRecord(account: AccountId, l: LadderId, season: SeasonId): Promise<SeasonRecord | null> {
    return this.read((tx) => {
      const r = tx.get('records', recordKey(l, season, account));
      return r && r.account === account ? r : null;
    });
  }

  async seasonRecords(account: AccountId): Promise<SeasonRecord[]> {
    return this.read((tx) =>
      tx
        .rows('records')
        .filter((r) => r.account === account)
        .sort((a, b) => compareText(b.season, a.season) || compareText(a.ladder, b.ladder)),
    );
  }

  async seasonRecordsOf(l: LadderId, season: SeasonId, after: string | null, limit: number): Promise<SeasonRecord[]> {
    limitOf('limit', limit);
    return this.read((tx) =>
      tx
        .rows('records')
        .filter((r) => r.ladder === l && r.season === season && (after === null || compareText(r.sortKey, after) > 0))
        .sort((a, b) => compareText(a.sortKey, b.sortKey))
        .slice(0, limit),
    );
  }

  async setListed(account: AccountId, listed: boolean): Promise<number> {
    need(typeof listed === 'boolean', 'listed is not a boolean');
    return this.write('setListed', (tx) => {
      let n = 0;
      for (const [k, r] of [...tx.entries('records')]) {
        if (r.account !== account || r.listed === listed) continue;
        if (tx.get('seasons', seasonKey(r.ladder, r.season))?.status === 'closed') continue;
        tx.put('records', k, { ...r, listed });
        n++;
      }
      return n;
    });
  }

  async leaderboard(q: LeaderboardQuery): Promise<SeasonRecord[]> {
    const nowMs = checkQuery(q);
    const limit = limitOf('q.limit', q.limit);
    return this.read((tx) =>
      tx
        .rows('records')
        .filter((r) => eligible(r, q, nowMs))
        .filter((r) => q.after === undefined || afterCursor(r, q.closed, q.after))
        .sort(leaderboardOrder(q.closed))
        .slice(0, limit),
    );
  }

  async leaderboardCount(q: Omit<LeaderboardQuery, 'after' | 'limit'>): Promise<number> {
    const nowMs = checkQuery(q);
    return this.read((tx) => tx.rows('records').filter((r) => eligible(r, q, nowMs)).length);
  }

  async rankOf(q: Omit<LeaderboardQuery, 'after' | 'limit' | 'closed'>, standing: number): Promise<number> {
    const query = { ...q, closed: false };
    const nowMs = checkQuery(query);
    need(typeof standing === 'number' && Number.isFinite(standing), 'standing is not a number');
    return this.read((tx) => 1 + tx.rows('records').filter((r) => eligible(r, query, nowMs) && r.standing! > standing).length);
  }

  async closeSeason(
    l: LadderId,
    season: SeasonId,
    finals: { sortKey: string; finalStanding: number | null; finalRank: number | null; badge: TierId | null }[],
    at: string,
  ): Promise<'closed' | 'already'> {
    ladder('ladder', l);
    seasonBounds(season);
    time('at', at);
    const list = clone(finals);
    need(Array.isArray(list), 'finals is not a list');
    return this.write('closeSeason', (tx) => {
      const sk = seasonKey(l, season);
      const row = tx.get('seasons', sk);
      if (row?.status === 'closed') return 'already';
      let eligibleCount = 0;
      for (const f of list) {
        const k = recordKey(l, season, f.sortKey);
        const r = tx.get('records', k);
        if (!r) continue;
        tx.put('records', k, { ...r, finalStanding: f.finalStanding, finalRank: f.finalRank, badge: f.badge });
        if (f.finalRank !== null) eligibleCount++;
      }
      tx.put('seasons', sk, {
        ladder: l, season, status: 'closed', floors: row ? [...row.floors] : [...DEFAULT_TIER_FLOORS], closedAt: at, eligible: eligibleCount,
      });
      return 'closed';
    });
  }

  // ---- history (10.2), rematches (9.4), abuse inputs (11) ----

  async history(q: { account: AccountId; ladder?: LadderId; before?: IntakeCursor; limit: number }): Promise<HistoryRow[]> {
    const limit = limitOf('q.limit', q.limit);
    if (q.ladder !== undefined) ladder('q.ladder', q.ladder);
    if (q.before !== undefined) time('q.before.endedAt', q.before.endedAt);
    return this.read((tx) =>
      tx
        .rows('history')
        .filter((h) => (q.ladder === undefined || h.ladder === q.ladder) && seatsOf(h).includes(q.account))
        .filter((h) => q.before === undefined || compareTimeId(h.endedAt, h.game, q.before.endedAt, q.before.game) < 0)
        .sort((a, b) => compareTimeId(b.endedAt, b.game, a.endedAt, a.game))
        .slice(0, limit),
    );
  }

  async recentOpponents(account: AccountId, l: LadderId, games: number): Promise<AccountId[][]> {
    need(typeof games === 'number' && Number.isInteger(games) && games >= 0, 'games is not a count');
    return this.read((tx) =>
      tx
        .rows('history')
        .filter((h) => h.ladder === l && seatsOf(h).includes(account))
        .sort((a, b) => compareTimeId(b.endedAt, b.game, a.endedAt, a.game))
        .slice(0, games)
        .map((h) => h.seats.flatMap((s) => (s.account === null || s.account === account ? [] : [s.account]))),
    );
  }

  async pairGames(a: AccountId, b: AccountId, l: LadderId, since: string): Promise<HistoryRow[]> {
    const sinceMs = isoMs(time('since', since));
    return this.read((tx) =>
      tx
        .rows('history')
        .filter((h) => h.ladder === l && isoMs(h.endedAt) >= sinceMs && seatsOf(h).includes(a) && seatsOf(h).includes(b) && a !== b)
        .sort((x, y) => compareTimeId(x.endedAt, x.game, y.endedAt, y.game)),
    );
  }

  async gamesSince(q: { ladder?: LadderId; since: string; after?: IntakeCursor; limit: number }): Promise<HistoryRow[]> {
    const sinceMs = isoMs(time('q.since', q.since));
    const limit = limitOf('q.limit', q.limit);
    if (q.after !== undefined) time('q.after.endedAt', q.after.endedAt);
    return this.read((tx) =>
      tx
        .rows('history')
        .filter((h) => (q.ladder === undefined || h.ladder === q.ladder) && isoMs(h.endedAt) >= sinceMs)
        .filter((h) => q.after === undefined || compareTimeId(h.endedAt, h.game, q.after.endedAt, q.after.game) > 0)
        .sort((x, y) => compareTimeId(x.endedAt, x.game, y.endedAt, y.game))
        .slice(0, limit),
    );
  }

  async capEvents(account: AccountId, since: string): Promise<CapEvent[]> {
    const sinceMs = isoMs(time('since', since));
    return this.read((tx) =>
      tx
        .rows('caps')
        .filter((c) => isoMs(c.at) >= sinceMs && c.seats.some((s) => s.account === account))
        .sort((x, y) => compareTimeId(x.at, x.game, y.at, y.game)),
    );
  }

  // ---- penalties (8.6) ----

  async penalties(account: AccountId): Promise<PenaltyRow | null> {
    return this.read((tx) => tx.get('penalties', account) ?? null);
  }

  async putPenalties(p: PenaltyRow): Promise<void> {
    const row = clone(p);
    id('account', row.account);
    need(Array.isArray(row.misses), 'misses is not a list');
    row.misses.forEach((m, i) => time(`misses[${i}]`, m));
    if (row.cooldownUntil !== null) time('cooldownUntil', row.cooldownUntil);
    return this.write('putPenalties', (tx) => tx.put('penalties', row.account, row));
  }

  async activeCooldowns(now: string): Promise<PenaltyRow[]> {
    const nowMs = isoMs(time('now', now));
    return this.read((tx) =>
      tx
        .rows('penalties')
        .filter((p) => p.cooldownUntil !== null && isoMs(p.cooldownUntil) > nowMs)
        .sort((a, b) => compareText(a.account, b.account)),
    );
  }

  // ---- reports: the outbox (11.2) ----

  async putReport(r: AbuseReport): Promise<'stored' | 'duplicate'> {
    const report = clone(r);
    id('report.id', report.id);
    id('report.dedupeKey', report.dedupeKey);
    time('report.createdAt', report.createdAt);
    return this.write('putReport', (tx) => {
      if (tx.get('reportKeys', report.dedupeKey) !== undefined || tx.get('reports', report.id)) return 'duplicate';
      tx.put('reports', report.id, { report: { ...report, status: 'pending' }, sentAt: null });
      tx.put('reportKeys', report.dedupeKey, report.id);
      return 'stored';
    });
  }

  async pendingReports(limit: number): Promise<AbuseReport[]> {
    limitOf('limit', limit);
    return this.read((tx) =>
      tx
        .rows('reports')
        .filter((s) => s.report.status === 'pending')
        .map((s) => s.report)
        .sort((a, b) => compareTimeId(a.createdAt, a.id, b.createdAt, b.id))
        .slice(0, limit),
    );
  }

  async markReportSent(reportId: string, at: string): Promise<void> {
    time('at', at);
    return this.write('markReportSent', (tx) => {
      const s = tx.get('reports', reportId);
      if (!s || s.report.status !== 'pending') return;
      const { id: rid, kind, createdAt, dedupeKey } = s.report;
      // stripped to its key, kind and time (11.2): no account, ladder or evidence survives a send
      tx.put('reports', reportId, {
        report: { id: rid, kind, ladder: null, accounts: [], evidence: { games: [], stats: {} }, createdAt, dedupeKey, status: 'sent' },
        sentAt: at,
      });
    });
  }

  async purgeReports(sentBefore: string): Promise<number> {
    const beforeMs = isoMs(time('sentBefore', sentBefore));
    return this.write('purgeReports', (tx) => {
      let n = 0;
      for (const [k, s] of [...tx.entries('reports')]) {
        if (s.report.status !== 'sent' || s.sentAt === null || isoMs(s.sentAt) >= beforeMs) continue;
        tx.del('reports', k);
        if (tx.get('reportKeys', s.report.dedupeKey) === k) tx.del('reportKeys', s.report.dedupeKey);
        n++;
      }
      return n;
    });
  }

  async reports(since: string, limit: number): Promise<AbuseReport[]> {
    const sinceMs = isoMs(time('since', since));
    limitOf('limit', limit);
    return this.read((tx) =>
      tx
        .rows('reports')
        .map((s) => s.report)
        .filter((r) => isoMs(r.createdAt) >= sinceMs)
        .sort((a, b) => compareTimeId(a.createdAt, a.id, b.createdAt, b.id))
        .slice(0, limit),
    );
  }

  // ---- moderation (11.3) and accounts (8.7) ----

  /**
   * The rating row and its audit in one write. The account's record of the row's season, if that season is open, keeps its games, results, places
   * and listed flag and loses its rating until placement is done again (11.3): display, deviation, standing, provisionalFrom, tier, peak, peakTier
   * and the season's ratings (the badge's median) are cleared, and careerGames follows the reset row.
   *
   * Only a row that is there, as the caller read it (review of M15-3): the stored row's version must be the audit's `before` version, and the new
   * row's one more; otherwise 'conflict' and nothing is written. So a reset never writes back an id that an erasure removed since it read the row
   * (across processes on PostgreSQL as well, 8.3), and a reset of an account with no rating writes nothing.
   */
  async resetRating(r: RatingRow, audit: AdjustmentRow): Promise<void> {
    const row = clone(r);
    const a = clone(audit);
    id('row.account', row.account);
    ladder('row.ladder', row.ladder);
    id('audit.id', a.id);
    need(a.account === row.account && a.ladder === row.ladder, 'the audit row is not about this rating');
    time('audit.at', a.at);
    return this.write('resetRating', (tx) => {
      const cur = tx.get('ratings', ratingKey(row.ladder, row.account));
      if (cur === undefined || a.before === null || a.before.version !== cur.version || row.version !== cur.version + 1) {
        throw err('conflict', cur === undefined ? `no rating in ${row.ladder} to reset for this account` : `the rating in ${row.ladder} changed since it was read`);
      }
      tx.put('ratings', ratingKey(row.ladder, row.account), row);
      tx.put('adjustments', a.id, a);
      const rk = recordKey(row.ladder, row.season, row.account);
      const rec = tx.get('records', rk);
      if (rec && tx.get('seasons', seasonKey(row.ladder, row.season))?.status !== 'closed') {
        tx.put('records', rk, {
          ...rec, display: null, deviation: null, standing: null, provisionalFrom: null, tier: null, peak: null, peakTier: null, seasonRatings: [],
          careerGames: row.games,
        });
      }
    });
  }

  /**
   * Test fixture only, not a LadderStore method (the service sees only LadderStore, so it never calls this): writes a rating row as given, with no
   * audit, so a test can give an account an established rating without playing its history first. resetRating cannot: it resets only a row that is
   * there (review of M15-3).
   */
  async seedRating(r: RatingRow): Promise<void> {
    const row = clone(r);
    id('row.account', row.account);
    ladder('row.ladder', row.ladder);
    return this.write('seedRating', (tx) => tx.put('ratings', ratingKey(row.ladder, row.account), row));
  }

  /**
   * 8.7: deletes the account's rating rows, penalties and records of open seasons; keeps the records of closed seasons on whose final leaderboard
   * it stood, without the id, under a fresh 'deleted:' marker each, with only a closed leaderboard's fields; anonymises its history seats (no rating
   * values), registry seats (a closed start's snapshot cleared), cap events, pending reports and audit rows. Run again it finds nothing more.
   */
  async forgetAccount(account: AccountId): Promise<ForgetReport> {
    id('account', account);
    const random = this.random;
    return this.write('forgetAccount', (tx) => {
      const out: ForgetReport = { ratings: 0, seasonRecords: 0, historySeats: 0, reports: 0, starts: 0, penalties: 0, capSeats: 0, adjustments: 0 };
      for (const [k, r] of [...tx.entries('ratings')]) {
        if (r.account !== account) continue;
        tx.del('ratings', k);
        out.ratings++;
      }
      if (tx.get('penalties', account)) {
        tx.del('penalties', account);
        out.penalties++;
      }
      for (const [k, r] of [...tx.entries('records')]) {
        if (r.account !== account) continue;
        tx.del('records', k);
        out.seasonRecords++;
        if (tx.get('seasons', seasonKey(r.ladder, r.season))?.status !== 'closed' || r.finalRank === null) continue;
        const sortKey = newDeletedSortKey(random);
        tx.put('records', recordKey(r.ladder, r.season, sortKey), {
          account: null, ladder: r.ladder, season: r.season, sortKey, listed: r.listed,
          games: r.games, wins: r.wins, draws: r.draws, losses: r.losses, places: null,
          display: r.display, deviation: r.deviation, standing: r.standing, provisionalFrom: null, peak: null, tier: r.tier, peakTier: null,
          seasonRatings: [], careerGames: r.games, lastGameAt: seasonBounds(r.season).endsAt,
          finalStanding: r.finalStanding, finalRank: r.finalRank, badge: null,
        });
      }
      for (const [k, h] of [...tx.entries('history')]) {
        if (!h.seats.some((s) => s.account === account)) continue;
        tx.put('history', k, { ...h, seats: h.seats.map((s) => (s.account === account ? (out.historySeats++, deletedSeat(s)) : s)) });
      }
      for (const [k, s] of [...tx.entries('starts')]) {
        if (!s.seats.some((x) => x.account === account)) continue;
        const seats = s.seats.map((x) => (x.account === account ? { ...x, account: null } : x));
        tx.put('starts', k, { ...s, seats: s.status === 'running' ? seats : closedSeats(seats) });
        out.starts++;
      }
      for (const [k, c] of [...tx.entries('caps')]) {
        if (!c.seats.some((x) => x.account === account)) continue;
        tx.put('caps', k, { ...c, seats: c.seats.map((x) => (x.account === account ? (out.capSeats++, { ...x, account: null }) : x)) });
      }
      for (const [k, s] of [...tx.entries('reports')]) {
        if (!s.report.accounts.includes(account)) continue;
        const accounts = s.report.accounts.map((x) => (x === account ? null : x));
        tx.put('reports', k, { ...s, report: { ...s.report, accounts: sortAccounts(accounts) } });
        out.reports++;
      }
      for (const [k, a] of [...tx.entries('adjustments')]) {
        if (a.account !== account) continue;
        tx.put('adjustments', k, { ...a, account: null, before: null, after: null });
        out.adjustments++;
      }
      return out;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** A report's accounts in their stored order (11.2): sorted in code-point order, null (deleted) ones last. */
export function sortAccounts(accounts: readonly (AccountId | null)[]): (AccountId | null)[] {
  return [...accounts].sort((a, b) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : compareText(a, b)));
}

/** The higher of two tiers (a season's peak tier); null counts lowest. */
export function higherTier(a: TierId | null, b: TierId | null): TierId | null {
  if (a === null) return b;
  if (b === null) return a;
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

/** A new memory store (tests). */
export function createMemoryLadderStore(options: MemoryLadderStoreOptions = {}): MemoryLadderStore {
  return new MemoryLadderStore(emptyLadderTables(), options);
}
