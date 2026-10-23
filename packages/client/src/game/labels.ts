/** Display text for steps, players and results (shared by the game screens and Settings). */
import type { GameResult, GameView, PlayerId, Step } from '@openmtg/engine';

/** Step names as CR 500.1 calls them (the main phases are steps in the engine's model). */
export const STEP_LABELS: Record<Step, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Precombat main',
  beginCombat: 'Beginning of combat',
  declareAttackers: 'Declare attackers',
  declareBlockers: 'Declare blockers',
  combatDamage: 'Combat damage',
  endCombat: 'End of combat',
  main2: 'Postcombat main',
  end: 'End step',
  cleanup: 'Cleanup',
};

export function playerName(view: Pick<GameView, 'players'>, id: PlayerId | null | undefined): string {
  if (!id) return 'nobody';
  return view.players.find((p) => p.id === id)?.name ?? id;
}

/** "Alice wins" or "The game is a draw" (CR 104.4a). */
export function resultHeadline(view: Pick<GameView, 'players'>, result: GameResult): string {
  return result.winner === null ? 'The game is a draw' : `${playerName(view, result.winner)} wins`;
}
