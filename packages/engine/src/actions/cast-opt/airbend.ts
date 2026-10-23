/**
 * FAST5X E10, CR 701.65a: a card exiled by airbending may be cast by its OWNER, for as long as it remains exiled, by paying {2} rather than paying its mana
 * cost. The exiled card carries the mark effects/handlers/airbend.ts gave it (rules/airbent.ts; a new object after any zone change has none, CR 400.7).
 *
 * The cast is the method `airbend`: an alternative cost (CR 118.9: {2}; additional costs such as kicker are still paid, CR 118.9d; cost changes apply to the
 * total, CR 601.2f) with the card's normal timing and every other check of casting (CR 601.3: lands can't be cast, CR 305.9). The permission is not limited
 * to one turn or one cast attempt: it lasts while the card stays exiled. The spell keeps nothing else from it (no characteristics change, nothing on the stack).
 */
import type { CastOptionProvider } from '../cast-options';
import { isAirbent } from '../../rules/airbent';

export const AIRBEND_CAST_OPTIONS: readonly CastOptionProvider[] = [
  {
    name: 'airbend',
    offers: (_g, o, player) => o.owner === player && isAirbent(o),
    cost: () => ({ mana: [{ kind: 'generic', amount: 2 }] }),
    onStack: () => {},
  },
];
