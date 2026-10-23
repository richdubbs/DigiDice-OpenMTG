/** Intimidate (CR 702.13b): can't be blocked except by artifact creatures and/or creatures that share a color with it. */
import { deny, waivable } from '../../rules/denial';
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';
import { charsOfId, nm, shares } from './common';

export const intimidateHooks: Pick<KeywordHooks, 'canBeBlocked'> = {
  canBeBlocked(g, attacker, blocker) {
    const ac = charsOfId(g, attacker);
    const bc = charsOfId(g, blocker);
    if (ac === null || bc === null) return null;
    if (hasKeyword(ac, 'intimidate') && !bc.types.includes('Artifact') && !shares(ac.colors, bc.colors)) {
      return waivable(deny(`${nm(ac)} has intimidate: only artifact creatures and creatures that share a color with it can block it.`, 'CR 702.13b'), 'blockAsThough', 'intimidate');
    }
    return null;
  },
};
