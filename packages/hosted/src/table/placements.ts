/**
 * Places at the end of a won or drawn game (design 7; review 11): the seat the placement rule sees and the rule's type. The table's default rule is the
 * ledger's (`ledgerPlacements`, ledger/placements.ts; M13-7), which a table may still replace through the actor's `placements` option. The winner is
 * 1st; then the players by when they left the game, latest first; players out in the same change share one order and one place (`sharedPlaces`). A
 * draw (CR 104.4a): the players who were still in share the best remaining place, `loss: 'draw'`.
 *
 * How a player lost: the table's own cause when the server applied the concession (time-out, disconnect, Leave: design D11), else the engine's
 * citations of the loss (`playerLost.rules`, which the actor collects per seat as `lossRules`), else its reason (`PlayerState.lostReason`).
 */
import type { GameState, PlayerId } from '@openmtg/engine';
import type { SeatNumber } from '../api';
import { ledgerPlacements } from '../ledger/placements';
import type { SeatOutcome, TableCause } from './types';

export { lossOf } from '../ledger/losses';

/** A seat as the placement rule sees it. */
export interface PlacementSeat {
  seat: SeatNumber;
  player: PlayerId;
  name: string;
  cause: TableCause | null;
  /** 1 = first out; equal for players out in the same change; null while in. */
  outOrder: number | null;
  outTurn: number | null;
  /** M13-7: the engine's CR citations of the seat's loss (its `playerLost` event's `rules`); null or absent while in, or when no event was seen. */
  lossRules?: readonly string[] | null;
  timeUsedMs: number;
  timeouts: number;
  disconnectedMs: number;
}

export type PlacementRule = (state: GameState, seats: readonly PlacementSeat[]) => SeatOutcome[];

/** The table's default placement rule: the ledger's (see the file comment). */
export const defaultPlacements: PlacementRule = ledgerPlacements;
