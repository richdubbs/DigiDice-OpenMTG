/** Shroud (CR 702.18a): "can't be the target of spells or abilities", its controller's included. */
import type { KeywordHooks } from '../types';
import { targetingDenial } from './targeting';

export const shroudHooks: Pick<KeywordHooks, 'canBeTargetedBy'> = {
  canBeTargetedBy: (g, target, source, controller) => targetingDenial(g, target, source, controller, 'shroud', 'it has shroud', 'CR 702.18a'),
};
