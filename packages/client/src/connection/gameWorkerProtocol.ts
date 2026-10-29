/**
 * Review 2026-10-26 F1: the messages between the page (connection/WorkerConnection.ts) and the game worker (connection/game.worker.ts, whose logic is
 * connection/gameHost.ts). The worker owns the game (a hot-seat `LocalConnection` or a `ComputerGame`, engine and AI); the page gets only what
 * `LocalConnection` gives a screen: the shown player's `viewFor` (a spectator view while a hand-off is pending), that player's legal actions and the
 * events redacted for that view (CR 400.2). No `GameState` is ever posted. Types only.
 *
 * Page -> worker (`ToWorker`):
 * - `start` (a new game from its config) or `restore` (a saved game, `SavedGame`); then the worker answers with a `change`.
 * - `act { id, action }`: answered with `reply { id, result }` after the `change` the action made.
 * - `undo { id }`: answered with `undone { id, ok, length }` after the `change`.
 * - `acceptHandoff`: the next player clicked through the pass cover (a `change` follows).
 * - `watch { on }`: a screen is subscribed (the computers play only while one is, as `ComputerGame` in the page).
 * - `pacer { on }`: the game screen's pace is attached (game/computer.ts `attachComputerPacer`); `shown { seq }`: the board has shown every change up to
 *   `seq` (its PacedConnection is idle). The computers wait while the last `change` posted has not been shown (at most COMPUTER_MAX_BOARD_WAIT_MS).
 * - `sync`: a view patch did not fit; the worker sends the whole view at once.
 * - `save { id }`: answered with `saved { id, game }`.
 *
 * Worker -> page (`FromWorker`): `change` (a full snapshot of what the screen reads; the view whole or as a patch of the last one, core/view-patch.ts;
 * the other members only when they changed), `reply`, `undone`, `saved`, and `error` (a message the worker could not handle).
 */
import type { Action, GameConfig, GameView, LegalAction, PatchOp, PlayerId } from '@openmtg/engine';
import type { RecordEnd, RecordedStep } from '../replays/recordSource';
import type { ActResult, EventBatch } from './GameConnection';

/** What runs in the worker: a hot-seat game (every player, or `seats`, at this screen) or a game against the computer (game/computer.ts). */
export type GameSpec =
  | { readonly kind: 'hotseat'; readonly seats?: readonly PlayerId[] }
  | {
      readonly kind: 'computer';
      readonly humans: readonly PlayerId[];
      readonly computers: readonly PlayerId[];
      /** game/computer.ts ComputerOptions (the AI itself is the worker's: a function cannot be posted). */
      readonly delayMs: number;
      readonly seed: string;
      readonly maxBoardWaitMs?: number;
    };

/** A saved game: the config and the action log (GameSession.toJSON). */
export interface SavedGame {
  config: GameConfig;
  actions: Action[];
}

export type ToWorker =
  | { t: 'start'; game: GameSpec; config: GameConfig }
  | { t: 'restore'; game: GameSpec; saved: SavedGame }
  | { t: 'act'; id: number; action: Action }
  | { t: 'undo'; id: number }
  | { t: 'acceptHandoff' }
  | { t: 'watch'; on: boolean }
  | { t: 'pacer'; on: boolean }
  | { t: 'shown'; seq: number }
  | { t: 'sync' }
  | { t: 'save'; id: number };

/** A change of the game's log, for the replay recorder (replays/recordSource.ts): the facts, never the states. */
export type LogChange = { kind: 'applied'; step: RecordedStep } | { kind: 'undone'; length: number };

export interface ChangeMessage {
  t: 'change';
  /** Grows by one with every change posted (the pacer's `shown` names it). */
  seq: number;
  /** The whole view (the first change, a new viewer, after `sync`) ... */
  view?: GameView;
  /** ... or the patch that turns the last view into this one (core/view-patch.ts diffViews); neither: the view did not change. */
  patch?: PatchOp[];
  /** Absent: unchanged. */
  legal?: readonly LegalAction[];
  /** Absent: unchanged. */
  events?: EventBatch;
  handoff: PlayerId | null;
  canUndo: boolean;
  status: string | null;
  seated: readonly PlayerId[];
  /** What happened to the log since the last change, in order (with `end`, the facts of the state after it; null for an empty log). */
  log?: LogChange[];
  end?: RecordEnd | null;
}

export type FromWorker =
  | ChangeMessage
  | { t: 'reply'; id: number; result: ActResult }
  | { t: 'undone'; id: number; ok: boolean; length: number }
  | { t: 'saved'; id: number; game: SavedGame }
  | { t: 'error'; message: string };
