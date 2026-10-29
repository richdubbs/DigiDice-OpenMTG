/**
 * Playing against the computer (milestone 10's AI, packages/ai). The game itself (`ComputerGame`, `runComputer`, the fallbacks) moved to @openmtg/play
 * (Godot plan phase 1: the local server's table channel runs the same games); see its computer.ts for how the computer plays and waits for the board.
 * Here: the screen's side of it. Each `ComputerGame` made in the page (or in the game worker) registers for the game screen's pace
 * (`attachComputerPacer`, game/computerPacer.ts), and makes its human seats' LocalConnection through this client's own module path.
 */
import type { GameConfig, GameSession, PlayerId } from '@openmtg/engine';
import { ComputerGame as PlayComputerGame, type ComputerOptions } from '@openmtg/play/computer';
import { LocalConnection, type LocalConnectionOptions } from '../connection/LocalConnection';
import { registerComputerPacing } from './computerPacer';
// The game screen's pace registry lives in game/computerPacer.ts (no AI import), so the game screen does not load the AI for online games and replays.
export { attachComputerPacer, registerComputerPacing, type ComputerPacer, type PacedComputers } from './computerPacer';
export {
  COMPUTER_MAX_BOARD_WAIT_MS, computerDelayMs, fallback, fallbacks, runComputer, withComputerStops, type Chooser, type ComputerOptions,
} from '@openmtg/play/computer';

/** The computer player's default name on the New game screen. */
export const COMPUTER_NAME = 'Computer';

/** A game against the computer (@openmtg/play's), registered for the game screen's pace (F8, `attachComputerPacer`). */
export class ComputerGame extends PlayComputerGame {
  constructor(source: GameConfig | GameSession, humans: PlayerId | readonly PlayerId[], computers: PlayerId | readonly PlayerId[], opts: ComputerOptions) {
    super(source, humans, computers, opts);
    registerComputerPacing(this, this);
  }

  protected override makeLocal(source: GameConfig | GameSession, opts: LocalConnectionOptions): LocalConnection {
    return new LocalConnection(source, opts);
  }
}
