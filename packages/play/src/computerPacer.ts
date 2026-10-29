/**
 * What a game against the computer needs of the screen's pace (review 2026-10-26 F8), as types only: the screen (the client's PacedConnection, or the
 * local server's table channel, which goes by the `shown` acknowledgements of its table) says whether it is still showing earlier changes, and the
 * computers wait while it is. The client's registry of paced games (its game/computerPacer.ts) builds on these.
 */

/** What the computer needs of the game screen's pace (the client's PacedConnection has both). */
export interface ComputerPacer {
  /** True while the board is still showing earlier changes (animating one, or some waiting). */
  busy(): boolean;
  /** Called whenever that may have changed. Returns the function that stops listening. */
  subscribe(listener: () => void): () => void;
}

/** A game whose computers wait for the game screen's pace: a `ComputerGame`, or a game run elsewhere (the client's game worker, the server's table). */
export interface PacedComputers {
  attachPacer(pacer: ComputerPacer): () => void;
}
