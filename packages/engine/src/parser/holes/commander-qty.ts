/**
 * CMD2 (commander batch): quantities that read the commanders of a player (CR 903.3, 903.3d-e). Atoms of the `Qty` grammar (holes/qty.ts#atoms calls this).
 *
 *   "the greatest mana value of a commander you own on the battlefield or in the command zone" (Cloudkill, the Visions flashback cycle, Majestic Genesis):
 *   the greatest mana value among the commanders that player owns that are on the battlefield or in the command zone, 0 when there is none (a commander in
 *   a hand, a library, a graveyard or exile does not count; CR 903.3d: "you own" names the commanders of the player, either one of two partners,
 *   CR 702.124e). Outside a Commander game no object is a commander: 0.
 */
import type { ObjectFilter, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';

const W_GREATEST_COMMANDER_MV = P('the greatest mana value of a commander you own on the battlefield or in the command zone');

/** The commanders "you own on the battlefield or in the command zone" (the zones are an array: both are searched, CR 400.1). A new object each time. */
const commandersOwnedBattlefieldOrCommand = (): ObjectFilter => ({ commander: true, owner: 'you', zone: ['battlefield', 'command'] });

export function commanderQtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_GREATEST_COMMANDER_MV);
  if (e >= 0) {
    const value: Quantity = { q: 'stat', stat: 'manaValue', agg: 'max', of: { ref: 'each', filter: commandersOwnedBattlefieldOrCommand() } };
    out.push({ end: e, value });
  }
  return out;
}
