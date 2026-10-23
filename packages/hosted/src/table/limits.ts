/**
 * The table's size limits and per-game caps (design 2.2 steps 3-4, D9, D15): checked after every apply, an action whose result exceeds a limit is
 * refused (`limitReached`; the state stays the one before it). The serialized size is measured at each checkpoint (every 100 records), where the
 * checkpoint hash (`LogRecord.check`) is taken from the same JSON text.
 */
import { createHash } from 'node:crypto';
import type { Action, GameState } from '@openmtg/engine';
import { GAME_LIMITS } from '../config';

export interface TableLimits {
  /** Logged actions per game (setStops and the stranded-player cancels not counted): 4,000 1v1, 8,000 in a pod. At the cap the game is void. */
  actions: number;
  /** `limitWarning` at this share of the action cap. */
  warnAt: number;
  maxObjects: number;
  maxLogEntries: number;
  maxHistoryEntries: number;
  /** The state's JSON without `defs`, in bytes (UTF-8), measured at each checkpoint. */
  maxStateBytes: number;
  /** A checkpoint (hash, size, snapshot) every this many records. */
  checkpointEvery: number;
  /**
   * One by-hand answer may add at most this many `state.log` / `state.history` entries (M13-2 review CRITICAL 1). Other actions are not budgeted
   * (re-review C: another player's huge effect resolves inside the victim's pass); the absolute limits bound them.
   */
  maxLogGrowth: number;
  maxHistoryGrowth: number;
  /** By-hand answers: ops and notes in one answer, notes per seat per game, and no notes once the log is past this share of its cap. */
  manualOpsPerAnswer: number;
  manualNotesPerAnswer: number;
  manualNotesPerGame: number;
  notesHeadroom: number;
  /** Every cancel of one control period, stranded-player cancels included (the clock allows 3 others). */
  cancelsPerPeriodMax: number;
}

/** The table's own bounds of M13-2 review CRITICAL 1 and minor (a) (not environment settings). */
export const TABLE_BOUNDS = {
  maxLogGrowth: 500,
  maxHistoryGrowth: 1_000,
  manualOpsPerAnswer: 32,
  manualNotesPerAnswer: 8,
  manualNotesPerGame: 400,
  notesHeadroom: 0.8,
  cancelsPerPeriodMax: 10,
} as const;

/** The design's limits for a table of `seats` (config.ts `GAME_LIMITS`). */
export function defaultTableLimits(seats: number): TableLimits {
  return {
    actions: seats > 2 ? GAME_LIMITS.actionsPod : GAME_LIMITS.actions1v1,
    warnAt: GAME_LIMITS.warnAt,
    maxObjects: GAME_LIMITS.maxObjects,
    maxLogEntries: GAME_LIMITS.maxLogEntries,
    maxHistoryEntries: GAME_LIMITS.maxHistoryEntries,
    maxStateBytes: GAME_LIMITS.maxSnapshotBytes,
    checkpointEvery: GAME_LIMITS.snapshotEvery,
    ...TABLE_BOUNDS,
  };
}

/** Which size limit a state exceeds (objects, `state.log`, `state.history`), as a player-facing sentence; null within them. */
export function sizeProblem(state: GameState, limits: TableLimits): string | null {
  let objects = 0;
  for (const _ in state.objects) objects++;
  if (objects > limits.maxObjects) return `The game would hold more than ${limits.maxObjects} objects; the action is refused.`;
  if (state.log.length > limits.maxLogEntries) return `The game log would pass ${limits.maxLogEntries} entries; the action is refused.`;
  if (state.history.length > limits.maxHistoryEntries) return `The game history would pass ${limits.maxHistoryEntries} entries; the action is refused.`;
  return null;
}

/** The state's JSON without `defs` (what a snapshot stores, design 2.3), its UTF-8 size and its SHA-256 (the checkpoint hash). */
export function checkpointOf(state: GameState): { json: string; bytes: number; hash: string } {
  const { defs: _defs, ...rest } = state;
  const json = JSON.stringify(rest);
  return { json, bytes: Buffer.byteLength(json, 'utf8'), hash: createHash('sha256').update(json, 'utf8').digest('hex') };
}

/** How much one action grew the log or the history past the per-action budget, as a sentence; null within it. */
export function growthProblem(before: GameState, after: GameState, limits: TableLimits): string | null {
  if (after.log.length - before.log.length > limits.maxLogGrowth) return `This action would add more than ${limits.maxLogGrowth} log entries; it is refused.`;
  if (after.history.length - before.history.length > limits.maxHistoryGrowth) return `This action would add more than ${limits.maxHistoryGrowth} history entries; it is refused.`;
  return null;
}

/** The `note` ops of a by-hand answer (each one is a log entry: core/manual.ts). */
export function noteCount(action: Action): number {
  if (action.type !== 'answer' || action.answer.kind !== 'manualResolve') return 0;
  const ops = (action.answer as { ops?: unknown }).ops;
  return Array.isArray(ops) ? ops.filter((o) => (o as { op?: unknown } | null)?.op === 'note').length : 0;
}
