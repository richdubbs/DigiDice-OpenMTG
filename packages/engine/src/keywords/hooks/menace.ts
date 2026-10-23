/** Menace (CR 702.111b): can't be blocked except by two or more creatures. A single blocker is not enough (checked on the whole declaration). */
import { deny } from '../../rules/denial';
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';
import { charsOfId, nm } from './common';

export const menaceHooks: Pick<KeywordHooks, 'blockSetValid'> = {
  blockSetValid(g, attacker, blockers) {
    if (blockers.length !== 1) return null;
    const ac = charsOfId(g, attacker);
    if (ac !== null && hasKeyword(ac, 'menace')) return deny(`${nm(ac)} has menace: it can't be blocked except by two or more creatures.`, 'CR 702.111b');
    return null;
  },
};
