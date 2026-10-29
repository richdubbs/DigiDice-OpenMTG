/**
 * @openmtg/play: a local game without a screen (Godot plan phase 1). The hot-seat connection (`LocalConnection`), the game against the computer
 * (`ComputerGame`, `runComputer`), the `GameConnection` interface every screen talks to, the redaction of events and the undo floor, and how a view
 * change travels to another thread or process (`viewDelta`). No React and no DOM: the browser client (packages/client) and the local server's table
 * channel (packages/server/src/table) both use it. Browser code imports the files by their own paths (`@openmtg/play/LocalConnection`), so a chunk that
 * needs no computer does not load the AI.
 */
export type { ActResult, EventBatch, GameConnection } from './GameConnection';
export { LocalConnection, type LocalConnectionOptions, type LogObserver } from './LocalConnection';
export { eventsForViewer } from './redactEvents';
export { irreversibleReason } from './undoFloor';
export {
  COMPUTER_MAX_BOARD_WAIT_MS, ComputerGame, computerDelayMs, fallback, fallbacks, runComputer, withComputerStops, type Chooser, type ComputerOptions,
  type ComputerSpeed,
} from './computer';
export type { ComputerPacer, PacedComputers } from './computerPacer';
export { STACK_PACE_FLOOR, STACK_PACE_THRESHOLD, stackPace } from './stackPace';
export { MAX_PATCH_OPS, viewDelta, type ViewDelta } from './viewDelta';
