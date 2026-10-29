/**
 * RPL-1 (replays design 7.1, 4) with review 2026-10-26 F1: what the replay recorder (recorder.ts) reads of a local game, whether the engine runs on this
 * page (a `LocalConnection`) or in the game worker (connection/game.worker.ts, `WorkerConnection`). The recorder needs the config, the action log, the
 * checkpoint the rule takes after each action (design 4: each turn start, every 20th action) and, when the game is saved, the facts of its last state
 * (its turn, how it ended, the last action's checkpoint). It never needs a state itself: where the engine runs in the worker, the worker works these out
 * (`recordStepOf`, `recordEndOf`) and sends only them, so no `GameState` ever reaches the page (CR 400.2).
 *
 * Pure: no storage and no clock. The engine runs here only for `localRecordSource` (the game is on this page anyway) and in the worker.
 */
import {
  checkpointAfter, replayAction, startReplay, type Action, type GameConfig, type GameState, type PlayerId, type ReplayCheckpoint,
} from '@openmtg/engine';
import type { LocalConnection } from '../connection/LocalConnection';
import { endingOf, type GameEnding } from './file';

/** One applied action as the recorder keeps it: the action, its index in the log, the checkpoint the rule takes right after it (or null). */
export interface RecordedStep {
  readonly action: Action;
  readonly index: number;
  readonly checkpoint: ReplayCheckpoint | null;
  /** The action ended the game (CR 104): the recorder saves the replay. */
  readonly over: boolean;
}

/** The facts of the game's current state that a saved replay needs: the log's length, its turn, how it ended, and the last action's checkpoint. */
export interface RecordEnd {
  readonly length: number;
  readonly turns: number;
  readonly ending: GameEnding | null;
  /** The checkpoint of the last action of the log (design 4: always taken), or null for an empty log. */
  readonly checkpoint: ReplayCheckpoint | null;
}

/** Told of every change of the log (as `LogObserver` of LocalConnection.ts, with the facts in place of the states). */
export interface RecordObserver {
  step(step: RecordedStep): void;
  undone(length: number): void;
}

export interface RecordSource {
  readonly config: GameConfig;
  /** The players of the game in seat order (id and name). */
  readonly players: readonly { readonly id: PlayerId; readonly name: string }[];
  /** The players who sit at this screen (people); the others are computers. */
  seated(): readonly PlayerId[];
  /** The action log as far as the recorder can be told of it. */
  actions(): readonly Action[];
  /** The steps of the log from `from` on (the recorder's catch-up); stops at the first action the engine does not take. */
  steps(from: number): RecordedStep[];
  /** The facts of the game's state right now (`length` says which log they belong to). */
  end(): RecordEnd | null;
  /** Watch the log. Returns the function that stops watching. */
  observe(observer: RecordObserver): () => void;
}

/** The step of the action at `index`, applied to `before` and making `after`. */
export function recordStepOf(action: Action, index: number, before: GameState, after: GameState): RecordedStep {
  return { action, index, checkpoint: checkpointAfter(index, before.turn.number, after, false), over: Boolean(after.result) };
}

/** The facts of `state`, the state after a log of `length` actions. `known`: the step of that last action, whose checkpoint is reused when it has one. */
export function recordEndOf(state: GameState, length: number, known: RecordedStep | null = null): RecordEnd {
  const last = length - 1;
  const checkpoint = last < 0 ? null : known?.index === last && known.checkpoint ? known.checkpoint : checkpointAfter(last, state.turn.number, state, true);
  return { length, turns: state.turn.number, ending: endingOf(state), checkpoint };
}

/** The steps of `actions` from `from` on, by running the log from the config once (stops at the first action the engine does not take). */
export function recordStepsOf(config: GameConfig, actions: readonly Action[], from = 0): RecordedStep[] {
  const out: RecordedStep[] = [];
  if (actions.length <= from) return out;
  const start = startReplay(config);
  if (!start.ok) return out;
  let state = start.state;
  for (let i = 0; i < actions.length; i++) {
    const r = replayAction(state, actions[i]!, i);
    if (!r.ok) return out;
    if (i >= from) out.push(recordStepOf(actions[i]!, i, state, r.state));
    state = r.state;
  }
  return out;
}

/** The record source of a game on this page. */
export function localRecordSource(conn: LocalConnection): RecordSource {
  return {
    config: conn.session.config,
    players: conn.session.state.players.map((p) => ({ id: p.id, name: p.name })),
    seated: () => conn.seated(),
    actions: () => conn.session.actions,
    steps: (from) => recordStepsOf(conn.session.config, conn.session.actions, from),
    end: () => recordEndOf(conn.session.state, conn.session.actions.length),
    observe: (o) =>
      conn.observeLog({
        applied: (action, index, before, after) => o.step(recordStepOf(action, index, before, after)),
        undone: (length) => o.undone(length),
      }),
  };
}

/** A LocalConnection, or a record source as it is. */
export function recordSourceOf(conn: LocalConnection | RecordSource): RecordSource {
  return 'session' in conn ? localRecordSource(conn) : conn;
}
