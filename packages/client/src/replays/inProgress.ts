/**
 * RPL-1 (replays design 7.1): the record of a game being played, in the `inProgress` store (db.ts), so a closed tab or a crash keeps the game. A head
 * row (the game's facts and config, written once) and one small row per action (the action, its time and, at a checkpoint, its digest), so an action
 * costs one short write, not a rewrite of the whole game. An undo deletes the rows it takes back.
 *
 * The rows of a game are keyed by its replay id: the head by the id itself, the action at index i by "<id>#<i, six digits>".
 */
import type { Action, ReplayCheckpoint } from '@openmtg/engine';
import type { DbOp, DbRow, ReplayDb } from './db';
import type { RecordedGameInfo, RecordedLog } from './file';

/** The version of these rows' shape, for a later change. */
export const RECORD_VERSION = 1;

export interface InProgressHead extends DbRow, RecordedGameInfo {
  type: 'head';
  version: number;
  /** Epoch milliseconds of the start: an action's time is milliseconds since then. */
  startMs: number;
  /** The people who agreed to show their cards so far (the end screen's toggles, design 6). */
  agreed: string[];
}

export interface InProgressAction extends DbRow {
  type: 'action';
  /** The replay id of the game. */
  id: string;
  index: number;
  action: Action;
  /** Milliseconds since the start. */
  t: number;
  /** The checkpoint taken right after this action (design 4), if the rule takes one there. */
  checkpoint?: ReplayCheckpoint;
}

/** A game's record as read back: its head and its log in order. */
export interface InProgressRecord {
  head: InProgressHead;
  log: RecordedLog;
  /** How many action rows the store may hold for it (its log, and rows past a gap), for removing them all. */
  stored: number;
}

export const actionKey = (id: string, index: number): string => `${id}#${String(index).padStart(6, '0')}`;

export const headOp = (head: InProgressHead): DbOp => ({ store: 'inProgress', put: head });

export function actionOp(id: string, index: number, action: Action, t: number, checkpoint: ReplayCheckpoint | null): DbOp {
  const row: InProgressAction = { key: actionKey(id, index), type: 'action', id, index, action, t, ...(checkpoint ? { checkpoint } : {}) };
  return { store: 'inProgress', put: row };
}

/** The deletes that take a record's log from `from` actions back to `to`. */
export function truncateOps(id: string, from: number, to: number): DbOp[] {
  const ops: DbOp[] = [];
  for (let i = to; i < from; i++) ops.push({ store: 'inProgress', delete: actionKey(id, i) });
  return ops;
}

/** The deletes that remove a record: its head and its `length` action rows. */
export function removeOps(id: string, length: number): DbOp[] {
  return [{ store: 'inProgress', delete: id }, ...truncateOps(id, length, 0)];
}

const isHead = (r: DbRow): r is InProgressHead => (r as Partial<InProgressHead>).type === 'head' && typeof (r as Partial<InProgressHead>).id === 'string';
const isAction = (r: DbRow): r is InProgressAction =>
  (r as Partial<InProgressAction>).type === 'action' && typeof (r as Partial<InProgressAction>).id === 'string' && Number.isInteger((r as Partial<InProgressAction>).index);

/**
 * Every record in the store, each log in order up to its first missing action (a row lost to a failed write ends the log there). Rows of a game whose
 * head is missing are returned as `orphans` (their keys), for removal.
 */
export async function readInProgress(db: ReplayDb): Promise<{ records: InProgressRecord[]; orphans: string[] }> {
  const rows = await db.getAll<DbRow>('inProgress');
  const heads = new Map<string, InProgressHead>();
  const actions = new Map<string, InProgressAction[]>();
  const orphans: string[] = [];
  for (const r of rows) {
    // RPL-3: an online guest's recording keeps its rows here too (online/recording.ts, types "onlineHead" and "onlineFrame"); its own sweep reads them.
    const type = (r as { type?: unknown }).type;
    if (typeof type === 'string' && type.startsWith('online')) continue;
    if (isHead(r) && r.key === r.id) heads.set(r.id, r);
    else if (isAction(r)) {
      const list = actions.get(r.id) ?? [];
      list.push(r);
      actions.set(r.id, list);
    } else orphans.push(r.key);
  }
  for (const [id, list] of actions) if (!heads.has(id)) orphans.push(...list.map((r) => r.key));
  const records = [...heads.values()].map((head) => {
    const list = (actions.get(head.id) ?? []).sort((a, b) => a.index - b.index);
    const log: { actions: Action[]; times: number[]; checkpoints: ReplayCheckpoint[] } = { actions: [], times: [], checkpoints: [] };
    for (const r of list) {
      if (r.index !== log.actions.length) break;
      log.actions.push(r.action);
      log.times.push(Math.max(r.t, log.times[log.times.length - 1] ?? 0));
      if (r.checkpoint) log.checkpoints.push(r.checkpoint);
    }
    // Rows past a gap are not part of the log; they are removed with the record.
    const stored = list.reduce((n, r) => Math.max(n, r.index + 1), 0);
    return { head, log, stored };
  });
  return { records, orphans };
}
