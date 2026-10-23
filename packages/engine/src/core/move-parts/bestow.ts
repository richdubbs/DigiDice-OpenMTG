/**
 * The bestow move part (CR 702.103b, 702.103d; std-ry7, cites from memory, unverified). A bestowed Aura spell that resolves becomes a bestowed Aura permanent:
 * the new object on the battlefield keeps the status (rules/base-parts/bestow.ts gives it the Aura's characteristics from the moment it exists, so its "as it
 * enters" replacements and its enters-the-battlefield abilities see an Aura, not a creature). Any other move makes an object that is not bestowed (CR 400.7).
 */
import type { MovePart } from '../registries';

export const BESTOW_MOVE_PARTS: readonly MovePart[] = [
  {
    afterLeave: (g, old, newId) => {
      const now = newId ? g.s.objects[newId] : undefined;
      if (now && old.bestowed === true && old.zone === 'stack' && now.zone === 'battlefield') now.bestowed = true;
    },
  },
];
