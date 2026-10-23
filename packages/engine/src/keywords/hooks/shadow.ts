/** Shadow (CR 702.28b): a creature with shadow can block or be blocked by only creatures with shadow, so the rule works in both directions. */
import { deny, waivable } from '../../rules/denial';
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';
import { charsOfId, nm } from './common';

export const shadowHooks: Pick<KeywordHooks, 'canBeBlocked'> = {
  canBeBlocked(g, attacker, blocker) {
    const ac = charsOfId(g, attacker);
    const bc = charsOfId(g, blocker);
    if (ac === null || bc === null || hasKeyword(ac, 'shadow') === hasKeyword(bc, 'shadow')) return null;
    return waivable(
      deny(hasKeyword(ac, 'shadow') ? `${nm(ac)} has shadow: only creatures with shadow can block it.` : `${nm(bc)} has shadow: it can block only creatures with shadow.`, 'CR 702.28b'),
      'blockAsThough',
      'shadow',
    );
  },
};
