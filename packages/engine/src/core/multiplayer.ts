/**
 * M12-1 (docs/design/m12-multiplayer.md 4.2): pure readers of a multiplayer game (CR 800-806). Nothing here writes state; every function is defined for a
 * two-player game too, where it gives the two-player answer (that game has no `options.multiplayer` and no `PlayerState.left`).
 *
 * Seating (m12 design D2): the order of `GameState.players` is the seating order, clockwise, rotated so the starting player is first; it is the turn order
 * (CR 101.4, 103.1). "Still in the game" is `!hasLost` (CR 104.5, 800.4a), the flag every reader uses; `left` records the leaving (CR 800.4i).
 */
import type { PlayerId } from '../types/ids';
import type { GameState } from '../types/state';

/** m12 design D6: "the player to [player]'s left / right" (statics/seats.ts: the statics layer reads it too and may not import core, design 5.4). */
export { seatNeighbor } from '../statics/seats';

/** Is this a multiplayer game (CR 800.1: it began with more than two players; m12 design D1)? A multiplayer game reduced to two players still is. */
export const isMultiplayer = (s: GameState): boolean => s.options.multiplayer !== undefined;

/**
 * The players still in the game, in turn order from the active player (CR 101.4, APNAP order); when the active player has left the game, from the next
 * player in turn order (CR 800.4j: the turn goes on without an active player).
 */
export function playersInGame(s: GameState): PlayerId[] {
  const ids = s.players.map((p) => p.id);
  const i = Math.max(0, ids.indexOf(s.turn.activePlayer));
  return [...ids.slice(i), ...ids.slice(0, i)].filter((id) => !s.players.find((p) => p.id === id)!.hasLost);
}

/** One player's place at the end of the game (m12 design D10: the finishing order on the end screen). */
export interface Placement {
  player: PlayerId;
  /** 1 for the best; players who are tied (lost at the same moment the game ended, or a draw, CR 104.4a) share a place. */
  place: number;
  /** How the player lost (their `left.reason`, else `lostReason`); absent for the winner and for a player still in the game. */
  reason?: string;
}

/**
 * m12 design D10, 4.2: the finishing order. The winner first (CR 104.2a); then the players who did not leave before the end (the last to lose, together, or
 * every remaining player in a draw, CR 104.4a: they share a place); then the players who left, the last set to leave first (`left.order` descending, CR
 * 104.5, 800.4a); players who left in the same elimination share `left.order` and so share their place. While the game goes on, every player still in it shares the first place. In a two-player game: the winner 1st, the other player 2nd.
 */
export function placements(s: GameState): Placement[] {
  const winner = s.result?.winner ?? null;
  const rank = (id: PlayerId): number => {
    if (id === winner) return 0;
    const p = s.players.find((x) => x.id === id)!;
    return p.left === undefined ? 1 : 1 + (s.players.length - p.left.order + 1);
  };
  const ranks = new Map(s.players.map((p) => [p.id, rank(p.id)] as const));
  const out: Placement[] = s.players.map((p) => {
    const r = ranks.get(p.id)!;
    const place = 1 + [...ranks.values()].filter((x) => x < r).length;
    const reason = p.left?.reason ?? (p.hasLost ? p.lostReason : undefined);
    return { player: p.id, place, ...(reason !== undefined ? { reason } : {}) };
  });
  // stable sort: ties stay in turn order (CR 101.4)
  return out.map((x, i) => [x, i] as const).sort((a, b) => a[0].place - b[0].place || a[1] - b[1]).map(([x]) => x);
}
