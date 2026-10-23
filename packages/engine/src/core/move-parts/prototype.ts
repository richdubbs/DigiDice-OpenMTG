/**
 * The prototype move part (CR 718.3b-c; m6 design 3.7). Owner: M6-6. A prototyped spell that resolves becomes a prototyped permanent: the new object on the
 * battlefield keeps the status (rules/base-parts/prototype.ts gives it the prototype's characteristics from the moment it exists, so its "as it enters"
 * replacements and its enters-the-battlefield abilities see them, CR 614.12). Any other move makes an object that was not cast prototyped (CR 400.7, 718.4).
 */
import type { MovePart } from '../registries';

export const PROTOTYPE_MOVE_PARTS: readonly MovePart[] = [
  {
    afterLeave: (g, old, newId) => {
      const now = newId ? g.s.objects[newId] : undefined;
      if (now && old.prototyped === true && old.zone === 'stack' && now.zone === 'battlefield') now.prototyped = true;
    },
  },
];
