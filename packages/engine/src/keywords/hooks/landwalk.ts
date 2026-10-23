/** Landwalk (CR 702.14c): the creature can't be blocked as long as the defending player controls a land that matches the landwalk words. */
import { deny, waivable } from '../../rules/denial';
import { charsOfObject } from '../../rules/characteristics';
import type { GameObject, GameState } from '../../types/state';
import type { PlayerId } from '../../types/ids';
import type { KeywordHooks } from '../types';
import { charsOfId, objectOf, nm } from './common';

/** CR 702.14c: the defending player controls a land that matches the landwalk words ("swamp", "snow forest", "nonbasic", "legendary"). */
export function landwalkApplies(s: GameState, defending: PlayerId, quality: string): boolean {
  const words = quality.split(' ');
  return s.zones.battlefield.map((id) => s.objects[id]).filter((o): o is GameObject => o !== undefined).some((o) => {
    if (o.controller !== defending || o.phasedOut) return false; // CR 702.26b: a phased-out permanent is treated as though it doesn't exist
    const c = charsOfObject(s, o);
    if (!c.types.includes('Land')) return false;
    return words.every((w) => {
      switch (w) {
        case 'nonbasic': return !c.supertypes.includes('Basic');
        case 'snow': case 'legendary': case 'basic': return c.supertypes.some((t) => t.toLowerCase() === w);
        case 'artifact': return c.types.includes('Artifact');
        default: return c.subtypes.some((t) => t.toLowerCase() === w);
      }
    });
  });
}

export const landwalkHooks: Pick<KeywordHooks, 'canBeBlocked'> = {
  canBeBlocked(g, attacker, blocker) {
    const b = objectOf(g, blocker);
    const ac = charsOfId(g, attacker);
    if (b === undefined || ac === null) return null;
    for (const k of ac.keywords) {
      // The defending player is the blocker's controller (a blocker can only be declared by the defending player).
      if (k.keyword === 'landwalk' && k.quality !== undefined && landwalkApplies(g.s, b.controller, k.quality)) {
        return waivable(deny(`${nm(ac)} has ${k.text.toLowerCase()}: it can't be blocked because the defending player controls a matching land.`, 'CR 702.14c'), 'blockAsThough', k.text.toLowerCase().replace(/\s*\(.*$/s, '')); // p2-attack-block-1: the landwalk by its words ("islandwalk"), which a permission names (CR 609.4)
      }
    }
    return null;
  },
};
