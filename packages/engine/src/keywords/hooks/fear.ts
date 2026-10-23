/** Fear (CR 702.36b): can't be blocked except by artifact creatures and/or black creatures. */
import { deny, waivable } from '../../rules/denial';
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';
import { charsOfId, nm } from './common';

export const fearHooks: Pick<KeywordHooks, 'canBeBlocked'> = {
  canBeBlocked(g, attacker, blocker) {
    const ac = charsOfId(g, attacker);
    const bc = charsOfId(g, blocker);
    if (ac === null || bc === null) return null;
    if (hasKeyword(ac, 'fear') && !bc.types.includes('Artifact') && !bc.colors.includes('B')) {
      return waivable(deny(`${nm(ac)} has fear: only artifact creatures and black creatures can block it.`, 'CR 702.36b'), 'blockAsThough', 'fear');
    }
    return null;
  },
};
