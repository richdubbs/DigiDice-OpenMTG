/**
 * RPL-0 (replays design 4, 5): running a game replay's log, and its checkpoints. The recorder takes a checkpoint after each action the rule
 * (`checkpointDue`) names; a reader on another engine build runs the log again, takes them the same way and compares. Both sides use the functions
 * here, so they agree on where.
 *
 * A replay's config and log come from a file. The validator (validate.ts) checks their shape, but only the engine can tell whether it can build the
 * config and carry out each action, and an engine of another build may fail where the one that recorded the game did not. So a replay is run through
 * `startReplay` and `replayAction`, which never throw: an action the engine rejects (CR 733), one whose shape it cannot read, and anything the engine
 * throws (a config it refuses, an engine error) is a `ReplayRejection`, and playback stops there (design 5.3: it plays up to the last matching
 * checkpoint, and the recording takes over).
 */
import type { Action } from '../types/actions';
import type { GameEvent } from '../types/events';
import type { GameState } from '../types/state';
import { applyAction, type ActionError } from '../core/apply';
import { actionShapeProblem } from '../core/action-shape';
import { createGame, type GameConfig } from '../core/create';
import { checkpointDue, gameDigest } from '../core/digest';
import type { ReplayCheckpoint } from './format';

/**
 * Why a replay's game stopped: `'config'`, the engine could not build the game from the config (index -1); `'shape'`, the action is not one the engine
 * can read (core/action-shape.ts); `'illegal'`, the engine rejected it (CR 733: the state is unchanged); `'threw'`, the engine threw while carrying it
 * out (under the build that recorded the game, an engine bug).
 */
export type ReplayRejectionCause = 'config' | 'shape' | 'illegal' | 'threw';

export interface ReplayRejection {
  /** The index of the action in the log; -1 for the config. */
  index: number;
  error: ActionError;
  cause: ReplayRejectionCause;
}

const messageOf = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** The game a replay's config makes, or why the engine cannot make it (never throws). */
export function startReplay(config: GameConfig): { ok: true; state: GameState } | { ok: false; rejection: ReplayRejection } {
  try {
    return { ok: true, state: createGame(config) };
  } catch (e) {
    return { ok: false, rejection: { index: -1, cause: 'config', error: { message: `The game could not be set up: ${messageOf(e)}`, rules: [] } } };
  }
}

/**
 * Apply the action at `index` of a replay's log (never throws): the next state and its events, or why the engine did not take it. The action's shape is
 * checked first, so a caller may hand it actions that were never validated.
 */
export function replayAction(state: GameState, action: Action, index: number): { ok: true; state: GameState; events: GameEvent[] } | { ok: false; rejection: ReplayRejection } {
  const problem = actionShapeProblem(action);
  if (problem !== null) return { ok: false, rejection: { index, cause: 'shape', error: { message: `Action ${index + 1} cannot be read: ${problem}.`, rules: [] } } };
  try {
    const r = applyAction(state, action);
    if (r.error) return { ok: false, rejection: { index, cause: 'illegal', error: r.error } };
    return { ok: true, state: r.state, events: r.events };
  } catch (e) {
    return { ok: false, rejection: { index, cause: 'threw', error: { message: `The engine failed on action ${index + 1}: ${messageOf(e)}`, rules: [] } } };
  }
}

/** The checkpoint of the state right after the action at `index`, if the rule takes one there (`turnBefore`: the turn number before that action). */
export function checkpointAfter(index: number, turnBefore: number, after: GameState, last: boolean): ReplayCheckpoint | null {
  if (!checkpointDue({ index, turnBefore, turnAfter: after.turn.number, last })) return null;
  return { action: index, turn: after.turn.number, digest: gameDigest(after) };
}

export interface CheckpointRun {
  checkpoints: ReplayCheckpoint[];
  /** Where the run stopped (the config, or the first action the engine did not take), or null when it played the whole log. */
  rejected: ReplayRejection | null;
}

/**
 * Play `actions` from `config` and take every checkpoint (design 4: each turn start, every 20th action, the last action). Stops at the first action the
 * engine does not take, and never throws (see the file comment).
 */
export function checkpointsOf(config: GameConfig, actions: readonly Action[]): CheckpointRun {
  const start = startReplay(config);
  if (!start.ok) return { checkpoints: [], rejected: start.rejection };
  let state = start.state;
  const checkpoints: ReplayCheckpoint[] = [];
  for (let i = 0; i < actions.length; i++) {
    const r = replayAction(state, actions[i]!, i);
    if (!r.ok) return { checkpoints, rejected: r.rejection };
    let c: ReplayCheckpoint | null;
    try {
      c = checkpointAfter(i, state.turn.number, r.state, i === actions.length - 1);
    } catch (e) {
      return { checkpoints, rejected: { index: i, cause: 'threw', error: { message: `The engine failed on action ${i + 1}: ${messageOf(e)}`, rules: [] } } };
    }
    if (c) checkpoints.push(c);
    state = r.state;
  }
  return { checkpoints, rejected: null };
}

/**
 * Where two lists of checkpoints of the same log first disagree (design 5.3): the index in `recorded` of the first checkpoint whose action `computed` has
 * with another turn or digest, or does not have; null when every recorded checkpoint matches.
 */
export function firstDivergence(recorded: readonly ReplayCheckpoint[], computed: readonly ReplayCheckpoint[]): number | null {
  const byAction = new Map(computed.map((c) => [c.action, c] as const));
  for (let i = 0; i < recorded.length; i++) {
    const r = recorded[i]!;
    const c = byAction.get(r.action);
    if (!c || c.turn !== r.turn || c.digest !== r.digest) return i;
  }
  return null;
}
