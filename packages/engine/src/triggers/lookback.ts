/** Which CR 603.10 look-back applies to an event pattern, decided from the pattern and never stored in card data (design 3.5). Owner: WP8. Contract: triggers/api.ts#LookBackKinds. */
import type { EventPattern, ZoneName } from '../types/ability';
import type { LookBackKind, SemEvent } from '../types/state';
import type { LookBackKinds } from './api';

const list = (z: ZoneName | ZoneName[] | undefined): ZoneName[] | undefined => (z === undefined ? undefined : Array.isArray(z) ? z : [z]);

/** Zones whose objects every player can see: the objects that CR 603.10a lets a "put into a hand or library" ability look back at come from there. */
const VISIBLE_FROM: readonly ZoneName[] = ['battlefield', 'graveyard', 'exile', 'stack', 'command'];

/**
 * CR 603.10a-g, decided from the pattern:
 *  - a zone change that is said to start on the battlefield ("dies", "leaves the battlefield", "is put into a graveyard from the battlefield") looks back
 *    (603.10a, 603.6c); so does one that is said to start in a graveyard (603.10a) and one that ends in a hand or library (603.10a: the object must have been
 *    visible to all players; the matcher checks that, `lookBackApplies`). A pattern with NO stated origin ("is put into a graveyard from anywhere") is never
 *    treated as a leaves-the-battlefield ability, even when the object does come from the battlefield (603.6c), nor as a leaves-a-graveyard one;
 *  - sacrificing a permanent (603.10a); becoming unattached (603.10c); a spell being countered (603.10e).
 * Phasing out, losing control, losing the game and planeswalking away (603.10b, d, f, g) have no pattern in the model yet, so no pattern asks for them.
 */
export const lookBackKinds: LookBackKinds = (p: EventPattern): LookBackKind[] => {
  const out: LookBackKind[] = [];
  switch (p.ev) {
    case 'zoneChange': {
      const from = list(p.from);
      const to = list(p.to);
      const startsOnBattlefield = from !== undefined && from.includes('battlefield'); // CR 603.6c: "from anywhere" is not a leaves-the-battlefield ability
      // "enters the battlefield" (to: battlefield only) has no earlier existence worth looking at.
      const entersOnly = to !== undefined && to.every((z) => z === 'battlefield');
      if (startsOnBattlefield && !entersOnly) out.push('leavesBattlefield');
      if (from !== undefined && from.includes('graveyard')) out.push('leavesGraveyard');
      if (to === undefined || to.includes('hand') || to.includes('library')) out.push('visibleToHandOrLibrary');
      break;
    }
    case 'action':
      if (p.verb === 'sacrifice' || p.verb === 'exploit') out.push('sacrifice'); // std-rx17: exploiting is sacrificing (CR 702.110b, 603.10a)
      if (p.verb === 'counter') out.push('spellCountered');
      break;
    case 'becomes':
      if (p.what === 'unattached') out.push('unattach');
      break;
    default:
      break;
  }
  return out;
};

/**
 * Does this particular event of that pattern look back (so its objects are judged by their last known information)? The pattern says which kinds of leaving
 * look back; the event says which kind of leaving happened: a creature that went hand -> graveyard did not leave the battlefield.
 */
export function lookBackApplies(p: EventPattern, e: SemEvent): boolean {
  const kinds = lookBackKinds(p);
  if (kinds.length === 0) return false;
  switch (p.ev) {
    case 'zoneChange': {
      const from = e.data['from'] as ZoneName | undefined;
      const to = e.data['to'] as ZoneName | undefined;
      if (from === 'battlefield') return kinds.includes('leavesBattlefield');
      if (from === 'graveyard' && kinds.includes('leavesGraveyard')) return true;
      return kinds.includes('visibleToHandOrLibrary') && (to === 'hand' || to === 'library') && from !== undefined && VISIBLE_FROM.includes(from);
    }
    case 'action':
      return true; // sacrifice: the permanent as it was; counter: the spell as it was
    case 'becomes':
      return true;
    default:
      return false;
  }
}
