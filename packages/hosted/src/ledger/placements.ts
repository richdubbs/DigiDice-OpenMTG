/**
 * Places at the end of a won or drawn game (design 7, review 11; package M13-7): the ledger's placement rule, the table's default (`TableOptions.placements`).
 *
 * - The winner is 1st. Then the players by when they left the game, the latest first. Players out in the same change (one set of simultaneous
 *   losers: the table gives them one `outOrder`; M12's `PlayerState.left.order` in pods, M13-16) share one place (`sharedPlaces`): four players, two
 *   out together first, give 1, 2, 3, 3.
 * - A draw (CR 104.4): every player still in shares the best remaining place with `loss: 'draw'`. When nobody is left because the last players all
 *   lost at once (CR 104.4a), those last losers are the ones who drew; a player out before the draw keeps the loss that put them out.
 * - How each player lost: `lossOf` (losses.ts): the table's cause, then the engine's `playerLost.rules`, then its reason text.
 */
import type { GameState } from '@openmtg/engine';
import type { PlacementSeat } from '../table/placements';
import type { SeatOutcome } from '../table/types';
import { lossOf, type LossOf } from './losses';
import { asPlace, sharedPlaces } from './types';

/** The draw citation of a player who drew: CR 104.4a when the players remaining lost at once (by the state-based actions or an effect), else 104.4c. */
function drawRule(state: GameState, allOut: boolean): string {
  // core/sba.ts and effects/handlers/game.ts: "all players lost simultaneously", "every player loses the game at once (...)" are CR 104.4a.
  return allOut || /^every player loses the game at once/.test(state.result?.reason ?? '') ? 'CR 104.4a' : 'CR 104.4c';
}

/** The ledger's placement rule (see the file comment). Throws for a game without a result (a void game has no placements). */
export function ledgerPlacements(state: GameState, seats: readonly PlacementSeat[]): SeatOutcome[] {
  const result = state.result;
  if (!result) throw new Error('ledgerPlacements: the game has no result (a void game has no placements).');
  const winner = result.winner;
  const draw = winner === null;
  const lastOrder = Math.max(0, ...seats.map((s) => s.outOrder ?? 0));
  const allOut = seats.length > 0 && seats.every((s) => s.outOrder !== null);
  const playerOf = (s: PlacementSeat) => state.players.find((x) => x.id === s.player);
  const drew = (s: PlacementSeat): boolean => {
    if (!draw || s.cause !== null || playerOf(s)?.conceded === true) return false;
    return s.outOrder === null || (allOut && s.outOrder === lastOrder);
  };
  // Lower rank is better: the winner 0, the players who drew or were still in 1, then the latest out first.
  const rank = (s: PlacementSeat): number => (s.player === winner ? 0 : drew(s) || s.outOrder === null ? 1 : 2 + (lastOrder - s.outOrder));
  const places = sharedPlaces(seats.map(rank));
  const rule = drawRule(state, allOut);
  return seats.map((s, i) => {
    const won = s.player === winner;
    const d = !won && drew(s);
    const l: LossOf | { loss: null; lossRule: null } = won
      ? { loss: null, lossRule: null }
      : d
        ? { loss: 'draw', lossRule: rule }
        : lossOf(playerOf(s)?.lostReason, s.cause, s.lossRules);
    return {
      seat: s.seat, name: s.name, place: asPlace(places[i]!), loss: l.loss, lossRule: l.lossRule, outTurn: won ? null : s.outTurn, player: s.player,
      outOrder: won ? null : s.outOrder, timeUsedMs: s.timeUsedMs, timeouts: s.timeouts, disconnectedMs: s.disconnectedMs,
    };
  });
}
