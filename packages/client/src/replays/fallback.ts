/**
 * RPL-1 (replays design 3, 4, 5): completing a game replay after the game, run in a Web Worker (recording.worker.ts) so the page never waits for it.
 * The game is run again under this engine build from its config and log (the engine's `startReplay` and `replayAction`, which never throw), and:
 *  - its checkpoints are taken again and compared with the recorded ones (`firstDivergence`): a game that does not play the same here (another
 *    build, an engine bug) gets nothing, since a recording of a different game would be wrong (design 5: a replay never plays wrong);
 *  - the fallback recording of the default perspective is made (design 3): the views the perspective is shown (`viewFor`, the definitions kept
 *    once), a full view at the start, at every 5th turn and after `RECORDING_MAX_PATCH_RUN` patches, a view patch (`diffJson` between views without
 *    their definitions) for every other action, and each action's events as the perspective is shown them (the shared redaction `eventsFor`, minus
 *    the events an answer's re-run reports again, `replayedEventsFor`, as LocalConnection does);
 *  - the facts a record left unfinished could not know are read from the final state: the last checkpoint, the turn, and the result when the game had
 *    in fact ended (the tab closed on the end screen before the replay was saved).
 *
 * The recording has one frame per action: frame 0 is the view before the first action (`seq` 0, time 0), and frame i + 1 (`seq` i + 1) the change the
 * action at index i of the log made, at its time. So a player of the recording (RPL-2) finds the frame of any action of the log, and where a game
 * replay stops matching at a checkpoint, the recording takes over at that action's frame (design 5.3).
 *
 * The default perspective (design 6): the public view in hot-seat (several people at the screen), the person's own seat against the computer. A
 * recording holds exactly what its viewer was shown, nothing more (design 6, "What enforces it").
 *
 * Pure and browser-safe: engine functions only; no storage, no clock.
 */
import {
  RECORDING_MAX_PATCH_RUN, checkpointAfter, diffJson, eventsFor, firstDivergence, replayAction, replayedEventsFor, startReplay, viewFor, type CardDef,
  type GameEvent, type GameResult, type GameState, type PlayerId, type RecordingFrame, type RecordingKeyView, type ReplayCheckpoint, type ReplayEnd,
  type ReplayFile, type ReplayRecording,
} from '@openmtg/engine';
import { endingOf } from './file';

/** A full view is kept at the start of every 5th turn (design 4: turns 1, 6, 11, ...), so a jump applies few patches. */
export const KEY_FRAME_TURNS = 5;

/** The perspective a game replay's fallback recording shows (design 6): the saver's seat, or the public view (null) when several people played. */
export function defaultPerspective(file: Pick<ReplayFile, 'game'>): PlayerId | null {
  return file.game.savedBy;
}

/** What running the game again found. */
export interface CompletedGame {
  /** The fallback recording; absent when the game does not play here as it was recorded (`problem` says why). */
  recording?: ReplayRecording;
  /** Every checkpoint of the log as this build takes them (the last action's included). */
  checkpoints: ReplayCheckpoint[];
  /** The final state's facts: its turn, and its result and how it ended (null while the game was not over). */
  final: { turns: number; result: GameResult | null; ended: Exclude<ReplayEnd, 'abandoned'> | null };
  /** Why there is no recording, in plain words. */
  problem?: string;
}

/** The view without its definitions (a recording keeps each definition once, design 4). */
function keyless(view: ReturnType<typeof viewFor>): { key: RecordingKeyView; defs: Record<string, CardDef> } {
  const { defs, ...rest } = view;
  return { key: rest, defs };
}

/** Run a game replay again and make its fallback recording (see the file comment). `build`: this engine's build. Never throws. */
export function completeGame(file: ReplayFile, build: string | null): CompletedGame {
  const none = (problem: string, checkpoints: ReplayCheckpoint[] = [], state: GameState | null = null): CompletedGame => ({
    checkpoints,
    final: finalOf(state),
    problem,
  });
  if (file.kind !== 'game' || !file.play) return none('This replay is not a game.');
  // Design 7.1: a record from before the client was updated is kept without a recording; it plays as far as its digests check out (design 5).
  if (file.engine.build !== build) return none('This replay was saved by another version of OpenMTG.');
  const { config, actions, times } = file.play;
  const start = startReplay(config);
  if (!start.ok) return none(start.rejection.error.message);
  const viewer = defaultPerspective(file);
  const defs: Record<string, CardDef> = {};
  const keep = (d: Record<string, CardDef>) => {
    for (const [id, def] of Object.entries(d)) if (!Object.hasOwn(defs, id)) defs[id] = def;
  };
  let state = start.state;
  const first = keyless(viewFor(state, viewer));
  keep(first.defs);
  const frames: RecordingFrame[] = [{ seq: 0, t: 0, key: first.key, events: [] }];
  let prevView: RecordingKeyView = first.key;
  let run = 0;
  const checkpoints: ReplayCheckpoint[] = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    const r = replayAction(state, action, i);
    if (!r.ok) return none(`It stops at action ${i + 1} here: ${r.rejection.error.message}`, checkpoints, state);
    let events: GameEvent[];
    let next: ReturnType<typeof keyless>;
    try {
      const c = checkpointAfter(i, state.turn.number, r.state, i === actions.length - 1);
      if (c) checkpoints.push(c);
      const replayed = replayedEventsFor(state, action, viewer);
      events = eventsFor(r.state, replayed > 0 ? r.events.slice(replayed) : r.events, viewer, { before: state });
      next = keyless(viewFor(r.state, viewer));
    } catch (e) {
      return none(`The engine failed on action ${i + 1}: ${e instanceof Error ? e.message : String(e)}`, checkpoints, r.state);
    }
    keep(next.defs);
    const turnStarted = r.state.turn.number !== state.turn.number && (r.state.turn.number - 1) % KEY_FRAME_TURNS === 0;
    const t = Math.max(times[i] ?? 0, frames[frames.length - 1]!.t);
    if (turnStarted || run >= RECORDING_MAX_PATCH_RUN) {
      frames.push({ seq: i + 1, t, key: next.key, events });
      run = 0;
    } else {
      frames.push({ seq: i + 1, t, patch: diffJson(prevView, next.key), events });
      run++;
    }
    prevView = next.key;
    state = r.state;
  }
  // The recording is made only of the game as it was played: every recorded checkpoint must be one this build takes too.
  if (firstDivergence(file.play.checkpoints, checkpoints) !== null) return none('This version of OpenMTG plays the game differently than it was recorded.', checkpoints, state);
  return { recording: { viewer, defs, frames }, checkpoints, final: finalOf(state) };
}

function finalOf(state: GameState | null): CompletedGame['final'] {
  if (!state) return { turns: 0, result: null, ended: null };
  const ending = endingOf(state);
  return { turns: state.turn.number, result: ending?.result ?? null, ended: ending?.ended ?? null };
}

/**
 * The file with what running it again found (`completeGame`): the recording when there is one, and for a game that played the same here the last
 * checkpoint if the record lacked it, and the result if the record was left before it was saved. Unchanged when the game does not play the same.
 */
export function withCompleted(file: ReplayFile, done: CompletedGame): ReplayFile {
  if (!done.recording || !file.play) return file;
  const play = file.play;
  const lastIndex = play.actions.length - 1;
  const last = done.checkpoints.find((c) => c.action === lastIndex);
  const checkpoints = lastIndex >= 0 && last && !play.checkpoints.some((c) => c.action === lastIndex) ? [...play.checkpoints, last] : play.checkpoints;
  const game =
    file.game.ended === 'abandoned' && done.final.result !== null && done.final.ended !== null
      ? { ...file.game, ended: done.final.ended, result: done.final.result, turns: done.final.turns }
      : { ...file.game, turns: Math.max(file.game.turns, done.final.turns) };
  return { ...file, game, play: { ...play, checkpoints }, recording: done.recording };
}
