/** Haste (CR 702.10b): the creature is not subject to the summoning sickness rule (CR 302.6). */
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';

export const hasteHooks: Pick<KeywordHooks, 'summoningSick'> = {
  summoningSick: (_g, _object, _player, c) => !hasKeyword(c, 'haste'),
};
