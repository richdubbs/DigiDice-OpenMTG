/**
 * RPL-0 (replays design 3, 4, 11): the replay file and the bug report file, as types. A replay is gzipped JSON (`.openmtg-replay`); its contents are
 * data, never code (design 4: actions are checked by the engine as they are applied, views pass a shape check, text is shown as text).
 *
 * Two kinds (design 3):
 *  - `'game'`: the game itself (the `GameConfig` with its card definitions, the action log, a time per action and checkpoint digests), made where the
 *    engine ran (hot-seat, against the computer, the online host). Playback runs the engine again; every perspective the reveal policy allows.
 *  - `'recording'`: what one player was shown (views and redacted events), made by an online guest; every game replay also carries one as its fallback
 *    for an engine that plays the game differently (design 5).
 *
 * Browser-safe: types and constants only, nothing from Node.
 */
import type { Action } from '../types/actions';
import type { CardDef } from '../types/card';
import type { GameEvent } from '../types/events';
import type { DefId, PlayerId } from '../types/ids';
import type { GameResult } from '../types/state';
import type { GameConfig } from '../core/create';
import { ENGINE_VIEW_SCHEMA, type GameView } from '../core/view';
import type { PatchOp } from '../core/view-patch';
import { COMPILER_VERSION } from '../cards/compile';
import { ABILITY_MODEL_VERSION } from '../types/ability';

export const REPLAY_FORMAT = 'openmtg-replay';
/** The replay format this engine writes and reads; older files are brought up to it by the upgrade chain (upgrade.ts). */
export const REPLAY_FORMAT_VERSION = 1;
export const BUG_REPORT_FORMAT = 'openmtg-bug-report';
export const BUG_REPORT_FORMAT_VERSION = 1;
/** The file name extension of an exported replay (design D9). */
export const REPLAY_EXTENSION = '.openmtg-replay';

/** The version of `GameState`'s shape (`GameState.schema`). */
export const ENGINE_STATE_SCHEMA = 1;

export type ReplayKind = 'game' | 'recording';
/** Where the game was played (design 4). */
export type ReplayMode = 'hotseat' | 'computer' | 'onlineHost' | 'onlineGuest' | 'hosted';
/** How the game ended for the saver: played out, conceded by someone (CR 104.3a), or left unfinished (a closed tab, a crash, a lost link). */
export type ReplayEnd = 'finished' | 'conceded' | 'abandoned';

/**
 * The app that saved the replay: its version (as the local server reports it) and the short commit of its build, null when the build was not made from
 * a git checkout. The browser has both from its build (packages/client src/engine-build.ts `APP`).
 */
export interface ReplayApp {
  version: string;
  commit: string | null;
}

/** The engine that played the game (design 5): its build fingerprint and the version constants a reader compares. */
export interface ReplayEngine {
  /** The engine build (the SHA-256 fingerprint of the engine's sources, packages/net `protocol/versions.ts`); null when it was not known. */
  build: string | null;
  /** `COMPILER_VERSION`. */
  compiler: string;
  /** `ABILITY_MODEL_VERSION`. */
  model: number;
  /** `GameState.schema`. */
  stateSchema: number;
  /** `ENGINE_VIEW_SCHEMA`: what a recording's views are. */
  viewSchema: number;
}

/** A seat of the game, in seating order (CR 101.4). */
export interface ReplayPlayer {
  id: PlayerId;
  name: string;
  kind: 'person' | 'computer';
}

/** What the replay library lists (design 10). */
export interface ReplayGameInfo {
  mode: ReplayMode;
  /** The format played ("standard", "commander", ...). */
  format: string;
  players: ReplayPlayer[];
  /** The seat of the player who saved it; null in hot-seat (every seat sat at the screen). */
  savedBy: PlayerId | null;
  ended: ReplayEnd;
  /** The result (CR 104); null when the game was abandoned. */
  result: GameResult | null;
  turns: number;
  actions: number;
  /** ISO 8601 times. */
  startedAt: string;
  endedAt: string;
}

/**
 * The reveal policy (design 6, D4): `'own'`, only the perspectives the saver may see without agreement; `'all'`, every seat and the open view, because
 * every person in `agreed` agreed (computer seats need no agreement, so a game against the computer has the person alone).
 */
export interface ReplayReveal {
  policy: 'own' | 'all';
  agreed: PlayerId[];
}

/** A checkpoint (design 4): the digest (`gameDigest`) of the state right after the action at index `action` of the log, in turn `turn`. */
export interface ReplayCheckpoint {
  action: number;
  turn: number;
  digest: string;
}

/** The game itself (kind `'game'`). */
export interface ReplayPlay {
  /** The game's config; its `defs` hold only the cards of the decks, sideboards, commanders and companions. */
  config: GameConfig;
  /** The action log as it was finally played (undone hot-seat actions are not in it, design D8). */
  actions: Action[];
  /** Milliseconds since the start, one per action. */
  times: number[];
  checkpoints: ReplayCheckpoint[];
}

/** A full view in a recording: the view without its definitions (the recording keeps each definition once). */
export type RecordingKeyView = Omit<GameView, 'defs'>;

/**
 * At most this many patch frames follow a key frame (RPL-0 review): a recorder writes a key frame at every 5th turn (design 4) and also after this many
 * patches in a row, so going to any frame applies at most this many patches (each bounded by `PATCH_MAX_WORK`, core/view-patch.ts). A recording with a
 * longer run is refused. Real games have tens of frames in five turns.
 */
export const RECORDING_MAX_PATCH_RUN = 1000;

/**
 * One change a player was shown. A key frame carries the full view (`key`); the others a patch against the previous frame's view (`patch`,
 * core/view-patch.ts `diffJson`, between views without `defs` as `key` is), at most `RECORDING_MAX_PATCH_RUN` of them after a key frame. Each view is
 * checked as the board reads it before it is shown (replay/validate.ts `recordingFrameView`). `events`: the change's events, redacted for the
 * recording's viewer (core/view-events.ts).
 */
export interface RecordingFrame {
  seq: number;
  /** Milliseconds since the start. */
  t: number;
  key?: RecordingKeyView;
  patch?: PatchOp[];
  events: GameEvent[];
}

/** What one player was shown (kind `'recording'`, and the fallback of a game replay). */
export interface ReplayRecording {
  /** The player shown; null for the public view. */
  viewer: PlayerId | null;
  /** Every definition the views use, each once. */
  defs: Record<DefId, CardDef>;
  frames: RecordingFrame[];
}

/** A replay file (design 4). `play` is present exactly for kind `'game'`; `recording` always for kind `'recording'`, optional for a game. */
export interface ReplayFile {
  format: typeof REPLAY_FORMAT;
  formatVersion: typeof REPLAY_FORMAT_VERSION;
  kind: ReplayKind;
  /** Random, for the library ("r-..."). */
  id: string;
  /** The player may rename it. */
  title: string;
  /** ISO 8601. */
  createdAt: string;
  app: ReplayApp;
  engine: ReplayEngine;
  game: ReplayGameInfo;
  reveal: ReplayReveal;
  play?: ReplayPlay;
  recording?: ReplayRecording;
}

/** A bug report (design 11): a replay of the game, the moment reported and the reporter's own words. */
export interface BugReportFile {
  format: typeof BUG_REPORT_FORMAT;
  formatVersion: typeof BUG_REPORT_FORMAT_VERSION;
  /** The game; a guest's report carries only its recording (a report never shows the reporter anything they could not see). */
  replay: ReplayFile;
  /** The reported moment: the index of the action the report is about (a game), or of the frame (a recording). */
  at: { action: number };
  /** What the reporter wrote. */
  words: string;
  /** The card the report is about, by name. */
  card?: string;
  app: ReplayApp;
  /** The browser, as the reporter's own browser describes itself. */
  browser: { userAgent: string; language?: string; screen?: string };
  /** The reporter's settings that change what the screen shows (animation speed, layout, ...), as plain values. */
  settings: Record<string, string | number | boolean | null>;
  /** Errors the page caught before the report. */
  errors: { message: string; stack?: string; time?: string }[];
}

/** This engine's own `ReplayEngine` record, for a replay saved now; `build` is the engine build the client was built with (or null). */
export function currentEngine(build: string | null): ReplayEngine {
  return { build, compiler: COMPILER_VERSION, model: ABILITY_MODEL_VERSION, stateSchema: ENGINE_STATE_SCHEMA, viewSchema: ENGINE_VIEW_SCHEMA };
}
