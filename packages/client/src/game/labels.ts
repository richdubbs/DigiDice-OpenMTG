/** Display text for steps, players and results (shared by the game screens and Settings). */
import type { GameResult, GameView, PlayerId } from '@openmtg/engine';

export { STEP_LABELS } from '@openmtg/play/stepLabels';

export function playerName(view: Pick<GameView, 'players'>, id: PlayerId | null | undefined): string {
  if (!id) return 'nobody';
  return view.players.find((p) => p.id === id)?.name ?? id;
}

/** "Alice wins" or "The game is a draw" (CR 104.4a). */
export function resultHeadline(view: Pick<GameView, 'players'>, result: GameResult): string {
  return result.winner === null ? 'The game is a draw' : `${playerName(view, result.winner)} wins`;
}
