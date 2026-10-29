/**
 * A replay of the library played back as a table (the Godot app's replay viewer). The replay is @openmtg/play's replay connection (replay/connection.ts),
 * the code the browser client plays replays with: the game run again on this engine (checked against its digests first when another build made it), its
 * recording where the game cannot be run, the views the reveal policy allows (CR 400.2), and a clock that waits for the screen to have shown each change.
 * The table sends its controller's state as `replayState` (`replayStateOf`) after every change; `replay` messages drive it.
 */
import type { ReplayFile } from '@openmtg/engine';
import type { GameConnection } from '@openmtg/play';
import { createReplayConnection, ReplayUnplayable, type ReplayConnection, type ReplayControllerState } from '@openmtg/play/replay/connection';
import { OPEN, perspectiveKey, perspectiveLabel, PUBLIC, seat, type ReplayPerspective } from '@openmtg/play/replay/policy';
import { engineBuild } from '../engineBuild';
import type { ReplayStateMessage } from './api';

export { ReplayUnplayable };
export type { ReplayConnection };

/** The file each watched replay plays (its bug report carries it). */
const files = new WeakMap<ReplayConnection, ReplayFile>();

export function replayFileOf(game: ReplayConnection): ReplayFile | null {
  return files.get(game) ?? null;
}

/** The statuses of a replay that does not play here as it was recorded. */
const DIFFERS = new Set(['recordingFrom', 'watchingUpTo', 'unplayable']);

/**
 * Whether a watched replay offers "Report this bug" by itself (client bugs/capture.ts `replayOffersReport`): a game replay made on this very engine build
 * that plays differently here is an engine bug (nondeterminism).
 */
export function offersReport(game: ReplayConnection, badge: string): boolean {
  const file = files.get(game);
  const build = engineBuild();
  return file !== undefined && file.kind === 'game' && build !== null && file.engine.build === build && DIFFERS.has(badge);
}

/** A view by its key ("seat:p1", "public", "open"), or null. */
export function perspectiveOf(key: unknown): ReplayPerspective | null {
  if (key === 'public') return PUBLIC;
  if (key === 'open') return OPEN;
  if (typeof key === 'string' && key.startsWith('seat:') && key.length > 5) return seat(key.slice(5));
  return null;
}

/** A replay connection for a file of the library (throws `ReplayUnplayable` when nothing of it can be shown here). */
export function openReplay(file: ReplayFile, perspective?: unknown): ReplayConnection {
  const p = perspectiveOf(perspective);
  const game = createReplayConnection(file, { engineBuild: engineBuild(), ...(p ? { perspective: p } : {}) });
  files.set(game, file);
  return game;
}

export function isReplay(game: GameConnection): game is ReplayConnection {
  return game.kind === 'replay' && 'controller' in game;
}

/** The controller's state as the table channel sends it: views by key and label, everything else as it is. */
export function replayStateOf(table: string, s: ReplayControllerState, offers = false): ReplayStateMessage {
  const view = (p: ReplayPerspective) => ({ key: perspectiveKey(p), label: perspectiveLabel(p, s.players) });
  return {
    t: 'replayState',
    table,
    position: s.position,
    last: s.last,
    playing: s.playing,
    speed: s.speed,
    muteFast: s.muteFast,
    muted: s.muted,
    perspective: view(s.perspective),
    perspectives: s.perspectives.map(view),
    perspectiveFixed: s.perspectiveFixed,
    badge: s.badge,
    statusText: s.statusText,
    notice: s.notice,
    progress: s.progress,
    playable: s.playable,
    turn: s.turn,
    step: s.step,
    activePlayer: s.activePlayer,
    label: s.label,
    valueText: s.valueText,
    ticks: s.ticks.map((t) => ({ position: t.position, turn: t.turn, player: t.player, seat: t.seat })),
    markers: s.markers.map((m) => ({ position: m.position, kinds: [...m.kinds] })),
    caption: s.caption,
    jumps: s.jumps,
    players: s.players.map((p) => ({ id: p.id, name: p.name })),
    offersReport: offers,
  };
}
