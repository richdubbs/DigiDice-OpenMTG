/**
 * RPL-4 (replays design 11): the bug report file. Its rules and its making moved to @openmtg/play bugs/report.ts (the local server makes reports for
 * the Godot app too); the one-frame replay of what this screen shows (`seatReplay`) stays here, with the client's replay file helpers.
 */
import {
  REPLAY_FORMAT, REPLAY_FORMAT_VERSION, cleanText, type GameEvent, type GameState, type GameView, type PlayerId, type ReplayApp, type ReplayEngine,
  type ReplayFile, type ReplayMode, type ReplayPlayer,
} from '@openmtg/engine';
import { defaultTitle, endingOf } from '../replays/file';

export * from '@openmtg/play/bugs/report';

/** A shown name: no control characters (util/shown-text.ts), within the validator's 64, never empty. */
function seatName(name: string, id: string): string {
  return cleanText(name).trim().slice(0, 64) || id;
}

export interface SeatReplayArgs {
  /** The view on screen (the reporter's seat; a spectator's view has viewer null). */
  view: GameView;
  /** The events of the last change shown, as the screen got them (redacted for the view's viewer). */
  events: readonly GameEvent[];
  /** How many changes the screen was shown (its event batches' `seq`). */
  changes: number;
  mode: ReplayMode;
  /** The format played ('' when not known). */
  format: string;
  /** The seats the computer plays (a local game); every other seat is a person. */
  computers?: readonly PlayerId[];
  /** The replay's id ("r-..."). */
  id: string;
  /** ISO 8601: now. */
  now: string;
  app: ReplayApp;
  engine: ReplayEngine;
}

/**
 * The replay of what this screen shows (see the file comment, `'view'`): a recording of the view's viewer with one key frame, the view on screen
 * without its definitions (the recording keeps them once) and the events of the last change. It holds exactly that view and those events.
 */
export function seatReplay(a: SeatReplayArgs): ReplayFile {
  const { defs, ...key } = a.view;
  const computers = new Set(a.computers ?? []);
  const players: ReplayPlayer[] = a.view.players.map((p) => ({ id: p.id, name: seatName(p.name, p.id), kind: computers.has(p.id) ? 'computer' : 'person' }));
  const ending = endingOf(a.view as unknown as GameState);
  return {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_FORMAT_VERSION,
    kind: 'recording',
    id: a.id,
    title: defaultTitle(players, a.format),
    createdAt: a.now,
    app: { ...a.app },
    engine: { ...a.engine },
    game: {
      mode: a.mode,
      format: cleanText(a.format).slice(0, 40),
      players,
      savedBy: a.view.viewer,
      ended: ending?.ended ?? 'abandoned',
      result: ending?.result ?? null,
      turns: a.view.turn.number,
      actions: Math.max(0, Math.floor(a.changes)),
      startedAt: a.now,
      endedAt: a.now,
    },
    reveal: { policy: 'own', agreed: [] },
    recording: { viewer: a.view.viewer, defs: { ...defs }, frames: [{ seq: 0, t: 0, key, events: [...a.events] }] },
  };
}

