/**
 * Rules every store keeps the same way (M13-4; design 8.1, 8.3, review 2 and 8), so the memory, file and PostgreSQL stores behave alike under the one
 * contract suite (test/m13-4/contract.ts).
 *
 * - **Ids** are 1-64 characters of `[0-9A-Za-z_-]` (ULIDs and the like): the file store uses them as file names, so every store refuses others.
 * - **Text** a database would refuse or change: PostgreSQL refuses NUL in text and turns an unpaired surrogate into U+FFFD when it encodes UTF-8, and
 *   jsonb refuses the JSON escapes of both. Every store refuses such text in every row it writes (`StoreError` 'value'), and the action log follows
 *   jsonb's rule: in PostgreSQL the database itself refuses it (the CHECK of migration 001), in the memory and file stores `jsonbProblem` does; either
 *   way only the offending game fails in a group commit.
 * - **Write-ahead order**: a game's records in a batch are consecutive and continue its last committed `seq`.
 */
import { REPORT_ATTACHMENT_KINDS, type SeatNumber } from '../api';
import type { GameRecord } from '../ledger/types';
import type { ClockReading, GameStatus, LogRecord, RetentionPolicy } from './api';

export type StoreErrorCode = 'notFound' | 'exists' | 'status' | 'order' | 'value' | 'closed' | 'corrupt';

/**
 * A refusal by a store: an unknown or existing id, a game in the wrong status, records out of order, a value it cannot store, a closed store, or
 * stored data that is damaged ('corrupt': a log that does not hold every committed record; never returned short).
 */
export class StoreError extends Error {
  constructor(readonly code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

export const STORE_ID = /^[0-9A-Za-z_-]{1,64}$/;

export function checkId(kind: string, id: unknown): string {
  if (typeof id !== 'string' || !STORE_ID.test(id)) throw new StoreError('value', `${kind} id is not 1-64 characters of [0-9A-Za-z_-]`);
  return id;
}

/** NUL, or an unpaired surrogate: text PostgreSQL would refuse (NUL) or silently change (a lone surrogate becomes U+FFFD); null when neither. */
export function textProblem(s: string): 'nul' | 'surrogate' | null {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) return 'nul';
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (d >= 0xdc00 && d <= 0xdfff) {
        i++;
        continue;
      }
      return 'surrogate';
    }
    if (c >= 0xdc00 && c <= 0xdfff) return 'surrogate';
  }
  return null;
}

/**
 * The first string or key of a value (objects, arrays, strings; Dates and byte arrays skipped) that `textProblem` refuses, as "path: problem"; null
 * when none. A jsonb column refuses exactly these (the JSON escapes `\u0000` and an unpaired `\udXXX`).
 */
export function jsonbProblem(v: unknown, path = '$', depth = 0): string | null {
  if (depth > 256) return `${path}: nested too deep`;
  if (typeof v === 'string') {
    const p = textProblem(v);
    return p ? `${path}: ${p === 'nul' ? 'a NUL character' : 'an unpaired surrogate'}` : null;
  }
  if (v === null || typeof v !== 'object' || v instanceof Date || v instanceof Uint8Array) return null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = jsonbProblem(v[i], `${path}[${i}]`, depth + 1);
      if (p) return p;
    }
    return null;
  }
  for (const [k, x] of Object.entries(v)) {
    const kp = textProblem(k);
    if (kp) return `${path}: a key with ${kp === 'nul' ? 'a NUL character' : 'an unpaired surrogate'}`;
    const p = jsonbProblem(x, `${path}.${k}`, depth + 1);
    if (p) return p;
  }
  return null;
}

/** Throws `StoreError` 'value' when `v` holds text the database would refuse or change. */
export function assertStorable(label: string, v: unknown): void {
  const p = jsonbProblem(v);
  if (p) throw new StoreError('value', `${label}: ${p.replace(/^\$\.?/, '')}`);
}

/** An ISO 8601 time in its canonical form (`Date.toISOString`); throws `StoreError` 'value' for a time that does not parse. */
export function isoOf(label: string, s: string): string {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new StoreError('value', `${label} is not an ISO 8601 time`);
  return new Date(t).toISOString();
}

/** Why a game's records in one batch cannot be appended in this order (null when they can): positive integer `seq`s, consecutive, ascending. */
export function batchOrderProblem(records: readonly LogRecord[]): string | null {
  for (let i = 0; i < records.length; i++) {
    const s = records[i]!.seq;
    if (!Number.isInteger(s) || s < 1) return `record seq ${String(s)} is not a positive integer`;
    if (i > 0 && s !== records[i - 1]!.seq + 1) return `records out of order: ${records[i - 1]!.seq} then ${s}`;
  }
  return null;
}

/** A batch grouped by game, games in the order of their first record. A record whose game id is malformed groups under that id and fails there. */
export function groupBatch(batch: readonly LogRecord[]): Map<string, LogRecord[]> {
  const groups = new Map<string, LogRecord[]>();
  for (const r of batch) {
    const g = typeof r.game === 'string' ? r.game : String(r.game);
    let list = groups.get(g);
    if (!list) groups.set(g, (list = []));
    list.push(r);
  }
  return groups;
}

/** The message of a game whose records cannot continue its log: not running, or not starting at `lastSeq + 1`. */
export function continuationProblem(status: GameStatus | null, lastSeq: number, first: number): string | null {
  if (status === null) return 'no such game';
  if (status !== 'running') return `the game is ${status}, not running`;
  if (first !== lastSeq + 1) return `expected record ${lastSeq + 1}, got ${first}`;
  return null;
}

/** The record as the stores keep it: only the contract's fields, optional ones only when present (what a JSON round trip gives). */
export function canonicalRecord(r: LogRecord): LogRecord {
  return {
    game: r.game,
    seq: r.seq,
    seat: r.seat,
    action: r.action,
    ...(r.cause !== undefined ? { cause: r.cause } : {}),
    ...(r.approvedBy !== undefined ? { approvedBy: r.approvedBy } : {}),
    clocks: r.clocks,
    elapsedMs: r.elapsedMs,
    at: r.at,
    ...(r.check !== undefined ? { check: r.check } : {}),
  };
}

/** The checks of one record before it is written (memory and file stores; PostgreSQL's columns and CHECKs refuse the same). Null: it can be stored. */
export function recordProblem(r: LogRecord): string | null {
  if (!STORE_ID.test(String(r.game))) return 'the game id is malformed';
  const jp = jsonbProblem(r);
  if (jp) return `record ${r.seq}: ${jp.replace(/^\$\.?/, '')}`;
  if (!Number.isFinite(Date.parse(r.at))) return `record ${r.seq}: at is not an ISO 8601 time`;
  if (r.cause !== undefined && !['timeout', 'disconnect', 'left', 'approved'].includes(r.cause)) return `record ${r.seq}: unknown cause`;
  return null;
}

const DAY_MS = 86_400_000;

/** The time before which rows of an age of `days` are purged. */
export function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Which games `purge` deletes (design 8.3): finished games after `logsDays`, void and quarantined after `voidDays`, unstarted tables after `lobbyDays`. */
export function purgeable(
  g: { status: GameStatus; createdAt: Date; startedAt: Date | null; endedAt: Date | null },
  policy: RetentionPolicy,
  now: Date,
): boolean {
  if (g.status === 'running') return false;
  // a table that never started (open, waiting, or closed before its start) goes by the lobby rule, whatever its status (review minor 3)
  if (g.startedAt === null) return g.createdAt < cutoff(now, policy.lobbyDays);
  if (g.status === 'finished') return g.endedAt !== null && g.endedAt < cutoff(now, policy.logsDays);
  if (g.status === 'void' || g.status === 'quarantined') return (g.endedAt ?? g.createdAt) < cutoff(now, policy.voidDays);
  return false;
}

/**
 * The attachments a report keeps after `logsDays` (design 8.3: bug reports' game logs 90 days): the client's own ones (`REPORT_ATTACHMENT_KINDS`);
 * any other kind is one the server attached (the game's log and config, M13-13) and is dropped. Null when nothing changes.
 */
export function attachmentsAfterRetention(atts: readonly { kind: string; json: string }[]): { kind: string; json: string }[] | null {
  const kept = atts.filter((a) => (REPORT_ATTACHMENT_KINDS as readonly string[]).includes(a.kind));
  return kept.length === atts.length ? null : kept;
}

/**
 * Every seat's logged actions at the end of a game (M13-7's `GameRecord.seatActions`, an additive optional field): the stores keep it when the
 * record has it. Typed here structurally so the store builds on either side of that change.
 */
export type StoredSeatActions = { seat: SeatNumber; actions: number }[];
export type LedgerRow = GameRecord & { seatActions?: StoredSeatActions };

/** The seats' actions from the last record's clock readings, as M13-7's `seatActionsOf` (0 for a seat without a reading, or before any record). */
export function seatActionsFromClocks(seats: number, clocks: readonly ClockReading[] | null): StoredSeatActions {
  const byClock = new Map((clocks ?? []).map((c) => [c.seat, c.actions ?? 0] as const));
  return Array.from({ length: seats }, (_, i) => ({ seat: (i + 1) as SeatNumber, actions: byClock.get(i + 1) ?? 0 }));
}

/**
 * The ledger row of a started game voided by `voidGame` (design 7: no placements, never rated). The store knows neither the turn count nor the
 * capped-action count: `turns` 0, `actions` the committed records; `seatActions` from the last record. A table that knows them ends with `finishGame`
 * and a void `GameRecord` instead (status 'void', or 'quarantined' for that reason).
 */
export function voidRecord(
  g: { id: string; format: string; variant: GameRecord['variant']; seats: GameRecord['seats']; source: GameRecord['source']; startedAt: Date; engineBuild: string },
  reason: string,
  endedAt: Date,
  lastSeq: number,
  lastClocks: readonly ClockReading[] | null,
): LedgerRow {
  return {
    game: g.id, format: g.format, variant: g.variant, seats: g.seats, source: g.source, ranked: false, outcome: 'void', reason,
    turns: 0, actions: lastSeq, startedAt: g.startedAt.toISOString(), endedAt: endedAt.toISOString(), engineBuild: g.engineBuild, placements: [],
    seatActions: seatActionsFromClocks(g.seats, lastClocks),
  };
}

/** The status a game ends in by its ledger row: 'finished' for a win or a draw; a void row 'void', or 'quarantined' for that reason (design D5). */
export function endStatus(r: GameRecord): 'finished' | 'void' | 'quarantined' {
  return r.outcome !== 'void' ? 'finished' : r.reason === 'quarantined' ? 'quarantined' : 'void';
}

/**
 * A ledger row as every store keeps and returns it: exactly the contract's fields (`seatActions` only when given), times canonical, placements in
 * seat order with exactly `Placement`'s fields. Throws `StoreError` 'value' for bad text or times.
 */
export function canonicalResult(r: LedgerRow): LedgerRow {
  assertStorable('result', r);
  if (r.outcome !== 'win' && r.outcome !== 'draw' && r.outcome !== 'void') throw new StoreError('value', `unknown outcome ${String(r.outcome)}`);
  return {
    game: r.game, format: r.format, variant: r.variant, seats: r.seats, source: r.source, ranked: false, outcome: r.outcome, reason: r.reason,
    turns: r.turns, actions: r.actions, startedAt: isoOf('startedAt', r.startedAt), endedAt: isoOf('endedAt', r.endedAt), engineBuild: r.engineBuild,
    placements: [...r.placements]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        seat: p.seat, player: p.player, session: p.session, account: p.account, name: p.name, deckHash: p.deckHash, place: p.place, loss: p.loss,
        lossRule: p.lossRule, outTurn: p.outTurn, outOrder: p.outOrder, timeUsedMs: p.timeUsedMs, timeouts: p.timeouts, disconnectedMs: p.disconnectedMs,
      })),
    ...(r.seatActions !== undefined ? { seatActions: r.seatActions.map((x) => ({ seat: x.seat, actions: x.actions })) } : {}),
  };
}

/** The ledger row `voidGame` writes from the table's own void record: of this game, void, for this reason, without placements. */
export function voidLedgerRow(id: string, reason: string, r: LedgerRow): LedgerRow {
  if (r.game !== id) throw new StoreError('value', `the result is of game ${r.game}, not ${id}`);
  if (r.outcome !== 'void' || r.reason !== reason) throw new StoreError('value', `voidGame's record must be void for the reason ${reason}`);
  if (r.placements.length !== 0) throw new StoreError('value', 'a void game has no placements');
  return canonicalResult(r);
}

/**
 * Review MAJOR: the records a recovery returns must be exactly `from + 1 .. lastSeq`, in order. A log that holds fewer (a damaged file, a lost row) is
 * refused as corrupt: a short log would replay to an earlier state while the players were sent later ones.
 */
export function checkCoverage(game: string, records: readonly LogRecord[], from: number, lastSeq: number): void {
  if (records.length !== lastSeq - from || records.some((r, i) => r.seq !== from + 1 + i)) {
    const got = records.length === 0 ? 'none' : `${records[0]!.seq}..${records[records.length - 1]!.seq} (${records.length})`;
    throw new StoreError('corrupt', `game ${game}: the log holds records ${got}, not ${from + 1}..${lastSeq}: it is damaged`);
  }
}

/** JSON with object keys sorted (a comparison that ignores key order, as jsonb columns lose it). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * Whether a stored record is the given one (review minor 2: a retried batch after an ambiguous commit is recognized as committed). The action must be
 * the same JSON text (its key order is part of the log); the other fields the same values, the time the same instant.
 */
export function sameRecord(stored: LogRecord, r: LogRecord): boolean {
  if (JSON.stringify(stored.action) !== JSON.stringify(r.action)) return false;
  const norm = (x: LogRecord) => ({ ...canonicalRecord(x), action: null, at: Number.isFinite(Date.parse(x.at)) ? new Date(x.at).toISOString() : x.at });
  return stableJson(norm(stored)) === stableJson(norm(r));
}
