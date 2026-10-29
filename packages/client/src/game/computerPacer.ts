/**
 * The game screen's pace for games against the computer (review 2026-10-26 F8), kept apart from game/computer.ts so the game screen can attach its pace
 * without loading the AI (packages/ai) for online games and replays. A game against the computer (`ComputerGame` in game/computer.ts, or a game in the
 * game worker, connection/WorkerConnection.ts) registers here under its connection; the game screen attaches its pace by that connection, sealed or not.
 */
import type { GameConnection } from '../connection/GameConnection';
import type { ComputerPacer, PacedComputers } from '@openmtg/play/computerPacer';
import { sealConnection } from './sealed';

// What the computer needs of the screen's pace, and a game that waits for it (types only; @openmtg/play, Godot plan phase 1).
export type { ComputerPacer, PacedComputers } from '@openmtg/play/computerPacer';

/** Each game against the computer by itself and by its sealed form (game/sealed.ts), for `attachComputerPacer`. Never handed out. */
const games = new WeakMap<object, PacedComputers>();

/** Register a game against the computer under its connection and the connection's sealed form, for `attachComputerPacer`. */
export function registerComputerPacing(connection: GameConnection, game: PacedComputers): void {
  games.set(connection, game);
  games.set(sealConnection(connection), game);
}

/**
 * F8: the game screen tells a game against the computer (by its connection, sealed or not) about its pace, so the computers act only once the board
 * has shown every change. Returns the function that detaches it; a connection that is not such a game is left alone.
 */
export function attachComputerPacer(connection: object, pacer: ComputerPacer): () => void {
  return games.get(connection)?.attachPacer(pacer) ?? (() => {});
}
