/** Skulk (CR 702.118b): can't be blocked by creatures with greater power. A power that is not a number (milestone 6 "*") counts as 0, as milestone 4 did. */
import { deny, waivable } from '../../rules/denial';
import { hasKeyword, ptNumbers } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';
import { charsOfId, nm } from './common';

export const skulkHooks: Pick<KeywordHooks, 'canBeBlocked'> = {
  canBeBlocked(g, attacker, blocker) {
    const ac = charsOfId(g, attacker);
    const bc = charsOfId(g, blocker);
    if (ac === null || bc === null || !hasKeyword(ac, 'skulk')) return null;
    const ap = ptNumbers(ac).power ?? 0;
    const bp = ptNumbers(bc).power ?? 0;
    if (bp > ap) return waivable(deny(`${nm(ac)} has skulk: it can't be blocked by creatures with greater power.`, 'CR 702.118b'), 'blockAsThough', 'skulk');
    return null;
  },
};
