/** Hexproof (CR 702.11b): can't be the target of spells or abilities the permanent's controller's opponents control; "hexproof from X" (CR 702.11d) only for sources with the quality. */
import type { KeywordHooks } from '../types';
import { targetingDenial } from './targeting';

export const hexproofHooks: Pick<KeywordHooks, 'canBeTargetedBy'> = {
  canBeTargetedBy: (g, target, source, controller) => targetingDenial(g, target, source, controller, 'hexproof', 'it has hexproof', 'CR 702.11b'),
};
