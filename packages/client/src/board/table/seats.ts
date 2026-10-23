/**
 * M12-4a (docs/design/m12-multiplayer.md 5.1): where each player sits at the shared table. Pure, from the `GameView` only.
 *
 * The order of `GameView.players` is the seating order, clockwise (m12 design D2, CR 101.4, 103.1, 806.3). Seen from above with the viewer's side at the
 * bottom, turn order runs clockwise round the table:
 *
 * - **4 players**, two and two: the viewer near-left (beside their HUD, bottom-left), the next player across-left ("the player to your left", CR 101.4),
 *   the player after across-right, the previous player near-right beside the viewer ("the player to your right").
 * - **3 players**: the viewer has the whole near side; the next player sits across-left, the previous player across-right.
 * - **2 players**: the viewer near, the opponent across, both full width (today's arena board).
 *
 * A seat view (looking from another player's seat, 5.1 "Switching seat views") is a viewpoint only: the table turns half round when that seat is across
 * (`turned`: every seat moves to the diagonally opposite place, so the turn order still runs clockwise), and the data is still the viewer's own view.
 * A player who left keeps their place (the seat empties: their objects are gone, D9) so nobody moves round the table when someone is eliminated.
 */
import { placements, type GameView, type PlayerId, type PlayerState } from '@openmtg/engine';
import { stateOfView } from '../model';

export type SeatPos = 'near' | 'far' | 'nearLeft' | 'nearRight' | 'farLeft' | 'farRight';

/** Who a seat's player is to the viewer, in turn order (CR 101.4): the next player is "the player to your left", the previous one "to your right". */
export type SeatRelation = 'you' | 'next' | 'previous' | 'across';

export interface SeatPlace {
  player: PlayerState;
  pos: SeatPos;
  row: 'near' | 'far';
  /** The seat's column on its side of the table (0 left, 1 right); a seat that has its side to itself spans both. */
  col: 0 | 1;
  span: 1 | 2;
  relation: SeatRelation;
  /** 1-4: the seat's number in turn order from the viewer (keys 1-4 look from that seat). */
  key: number;
}

export interface TableSeating {
  far: SeatPlace[];
  near: SeatPlace[];
  /** Every seat in turn order from the viewer. */
  all: SeatPlace[];
  turned: boolean;
}

/** The players in seating order starting with `from` (the viewer); `from` missing from the game: the order as it is. */
export function seatOrder(players: readonly PlayerState[], from: PlayerId | null): PlayerState[] {
  const i = Math.max(0, players.findIndex((p) => p.id === from));
  return [...players.slice(i), ...players.slice(0, i)];
}

export function relationOf(index: number, count: number): SeatRelation {
  if (index === 0) return 'you';
  if (index === 1) return 'next';
  if (index === count - 1) return 'previous';
  return 'across';
}

const TURN: Record<SeatPos, SeatPos> = { near: 'far', far: 'near', nearLeft: 'farRight', nearRight: 'farLeft', farLeft: 'nearRight', farRight: 'nearLeft' };

/** The places in turn order from the viewer, before any turn of the table. */
function placesFor(count: number): SeatPos[] {
  if (count >= 4) return ['nearLeft', 'farLeft', 'farRight', 'nearRight'];
  if (count === 3) return ['near', 'farLeft', 'farRight'];
  return ['near', 'far'];
}

function place(pos: SeatPos): { row: 'near' | 'far'; col: 0 | 1; span: 1 | 2 } {
  switch (pos) {
    case 'near':
      return { row: 'near', col: 0, span: 2 };
    case 'far':
      return { row: 'far', col: 0, span: 2 };
    case 'nearLeft':
      return { row: 'near', col: 0, span: 1 };
    case 'nearRight':
      return { row: 'near', col: 1, span: 1 };
    case 'farLeft':
      return { row: 'far', col: 0, span: 1 };
    case 'farRight':
      return { row: 'far', col: 1, span: 1 };
  }
}

/**
 * The seats of the table for `viewer` (the player whose view this is; null for a spectator view: the active player's side, as `model.seating` does).
 * `turned`: the table turned half round (looking from a seat across the table).
 */
export function tableSeating(view: GameView, viewer: PlayerId | null, turned = false): TableSeating {
  const order = seatOrder(view.players, viewer ?? view.turn.activePlayer);
  const places = placesFor(order.length);
  const all = order.map((player, i): SeatPlace => {
    const base = places[Math.min(i, places.length - 1)]!;
    const pos = turned ? TURN[base] : base;
    return { player, pos, ...place(pos), relation: relationOf(i, order.length), key: i + 1 };
  });
  const byCol = (a: SeatPlace, b: SeatPlace) => a.col - b.col;
  return { far: all.filter((s) => s.row === 'far').sort(byCol), near: all.filter((s) => s.row === 'near').sort(byCol), all, turned };
}

/** Whether looking from `seat` turns the table half round (that seat is across the table from the viewer). */
export function isAcross(view: GameView, viewer: PlayerId | null, seat: PlayerId | null): boolean {
  if (seat === null) return false;
  return tableSeating(view, viewer).far.some((s) => s.player.id === seat);
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
export function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

/**
 * A player who is out of the game (CR 104.5, 800.4a): their place in the finishing order and how they lost ("3rd: 21 combat damage from Isamaru"),
 * from the engine's `placements` (m12 design D10); null while they are still in the game.
 */
export function placementLabel(view: GameView, player: PlayerId): string | null {
  const p = view.players.find((x) => x.id === player);
  if (!p || !p.hasLost) return null;
  const pl = placements(stateOfView(view)).find((x) => x.player === player);
  if (!pl) return 'Out';
  const reason = p.left?.reason ?? p.lostReason ?? pl.reason;
  return `${ordinal(pl.place)}${reason ? `: ${reason}` : ''}`;
}

/** The words on a seat's name plate for its relation to the viewer (left and right at a rectangular table are not obvious). */
export const RELATION_LABEL: Record<SeatRelation, string> = { you: 'you', next: 'next', previous: 'previous', across: 'after next' };

/** The tooltip that says what the relation means in the rules' words (CR 101.4). */
export const RELATION_TITLE: Record<SeatRelation, string> = {
  you: 'Your seat',
  next: 'Next in turn order: the player to your left (CR 101.4)',
  previous: 'Previous in turn order: the player to your right (CR 101.4)',
  across: 'Two seats on in turn order',
};
