/** Defender (CR 702.3b): "This creature can't attack." A permission may waive it ("attack as though it didn't have defender", CR 609.4). */
import { deny, waivable } from '../../rules/denial';
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';
import { charsOfId, nm } from './common';

export const defenderHooks: Pick<KeywordHooks, 'canAttack'> = {
  canAttack(g, attacker) {
    const c = charsOfId(g, attacker);
    if (c === null || !hasKeyword(c, 'defender')) return null;
    return waivable(deny(`${nm(c)} has defender, so it can't attack.`, 'CR 702.3b'), 'attackAsThoughNoDefender');
  },
};
