/** Vigilance (CR 702.20b): attacking doesn't cause this creature to tap (CR 508.1f). */
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';

export const vigilanceHooks: Pick<KeywordHooks, 'attackTaps'> = {
  attackTaps: (_g, _attacker, _player, c) => !hasKeyword(c, 'vigilance'),
};
