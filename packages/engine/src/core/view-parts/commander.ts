/**
 * M11-0 (m11 design 4.2, 6): the definitions of every player's commanders. Who a player's commander is, is public (it begins face up in the command zone,
 * CR 903.6), so the client's command zone panel and the commander damage on a life disc can name it and show it while the card is in a hidden zone (a
 * library or a hand after its owner let it go there, CR 903.9b), where the object itself is a blank card to other players (core/view.ts#hiddenObject).
 */
import type { DefId } from '../../types/ids';
import type { ViewPart } from '../registries';

export const COMMANDER_VIEW_PARTS: readonly ViewPart[] = [
  { usedDefs: (state) => state.players.flatMap((p) => (p.commanders ?? []).map((c): DefId => c.defId)) },
];
