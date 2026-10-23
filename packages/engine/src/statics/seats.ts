/**
 * M12-1 (docs/design/m12-multiplayer.md D6, 4.2): seats. A pure reader of the seating order, here so that every layer that reads player references (statics,
 * triggers, rules, effects) can import it (design 5.4: statics import types, keywords and rules/base-chars only). core/multiplayer.ts re-exports it with the
 * other multiplayer readers. The order of `GameState.players` is the seating order, clockwise, and the turn order (CR 101.4, 103.1; m12 design D2).
 */
import type { PlayerId } from '../types/ids';
import type { GameState } from '../types/state';

/**
 * m12 design D6: "the player to [player]'s left / right": the next (`left`) or the previous (`right`) player in turn order who is still in the game, counted
 * from `player`'s seat (CR 101.4: the next player in turn order is usually the player seated to the left; CR 103.1: clockwise). `player` may have left the
 * game: their seat is still where the count starts. Undefined when `player` is not a player of the game or no other player is in the game. In a two-player
 * game both neighbors are the opponent.
 */
export function seatNeighbor(s: GameState, player: PlayerId, side: 'left' | 'right'): PlayerId | undefined {
  const n = s.players.length;
  const at = s.players.findIndex((p) => p.id === player);
  if (at < 0) return undefined;
  const step = side === 'left' ? 1 : n - 1;
  for (let k = 1, i = (at + step) % n; k < n; k++, i = (i + step) % n) {
    const p = s.players[i]!;
    if (!p.hasLost) return p.id;
  }
  return undefined;
}
