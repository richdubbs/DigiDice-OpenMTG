/** Horsemanship (CR 702.31b): can't be blocked except by creatures with horsemanship. */
import { deny, waivable } from '../../rules/denial';
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';
import { charsOfId, nm } from './common';

export const horsemanshipHooks: Pick<KeywordHooks, 'canBeBlocked'> = {
  canBeBlocked(g, attacker, blocker) {
    const ac = charsOfId(g, attacker);
    const bc = charsOfId(g, blocker);
    if (ac === null || bc === null) return null;
    if (hasKeyword(ac, 'horsemanship') && !hasKeyword(bc, 'horsemanship')) return waivable(deny(`${nm(ac)} has horsemanship: only creatures with horsemanship can block it.`, 'CR 702.31b'), 'blockAsThough', 'horsemanship');
    return null;
  },
};
