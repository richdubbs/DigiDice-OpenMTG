/**
 * Flying (CR 702.9b) and its blocker side, reach (CR 702.17b): a creature with flying can't be blocked except by creatures with flying and/or reach.
 * Reach has no hook of its own: it only changes what a flying attacker's rule lets through, so this module reads it (the `readers` of reach point here).
 */
import { deny, waivable } from '../../rules/denial';
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';
import { charsOfId, nm } from './common';

export const flyingHooks: Pick<KeywordHooks, 'canBeBlocked'> = {
  canBeBlocked(g, attacker, blocker) {
    const ac = charsOfId(g, attacker);
    const bc = charsOfId(g, blocker);
    if (ac === null || bc === null) return null;
    if (hasKeyword(ac, 'flying') && !hasKeyword(bc, 'flying') && !hasKeyword(bc, 'reach')) {
      return waivable(deny(`${nm(ac)} has flying: only creatures with flying or reach can block it.`, 'CR 702.9b', 'CR 702.17b'), 'blockAsThough', 'flying');
    }
    return null;
  },
};
