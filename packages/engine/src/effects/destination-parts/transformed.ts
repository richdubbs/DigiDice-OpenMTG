/**
 * `modify.destination.transformed` (CR 712.14a, 614.1a, 616.1d; m6 design 3.6). Owner: M6-4. "Return it to the battlefield transformed instead": a new
 * destination on the battlefield with the back face up, for a double-faced card or token that can transform (effects/enters-parts/transformed.ts says which);
 * anything else enters as it would have (CR 712.14a).
 */
import type { DestinationPart } from '../registries';
import { entersTransformed } from '../enters-parts/transformed';

export const TRANSFORMED_DESTINATION_PARTS: readonly DestinationPart[] = [
  {
    field: 'transformed',
    capability: 'body:modify.destination.transformed',
    fits: (e, d) => e.ev === 'zoneChange' && d.zone === 'battlefield',
    toFacts: (g, e) => {
      const o = e.ev === 'zoneChange' ? g.s.objects[e.object.id] : undefined;
      return o && entersTransformed(g.s, o) ? { transformed: true, face: 1 } : {};
    },
  },
];
