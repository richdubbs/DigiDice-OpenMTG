/** Flash (CR 702.8a): "You may cast this card any time you could cast an instant." It functions in any zone the card could be cast from. */
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks } from '../types';

export const flashHooks: Pick<KeywordHooks, 'castTiming'> = {
  castTiming: (_g, _spell, _player, c) => (hasKeyword(c, 'flash') ? 'instant' : null),
};
