/**
 * `enters.prepared` (CR 722.3a; m6 design 3.7). Owner: M6-6. "This creature enters prepared": the fact is carried by the move and applied as it enters
 * (effects/perform-events.ts#applyEnterFacts -> core/prepare.ts#becomePrepared: only a permanent with a prepare spell gains the designation, and its controller
 * then creates the exile copy of that spell, CR 722.3c). On the hypothetical permanent of CR 614.12 it is prepared already, so "a prepared creature" patterns
 * of other replacement effects see it.
 */
import type { EntersPart } from '../registries';
import { hasPrepareSpell } from '../../core/prepare';

export const PREPARED_ENTERS_PARTS: readonly EntersPart[] = [
  {
    field: 'prepared',
    capability: 'body:enters.prepared',
    apply: () => ({ prepared: true }),
    hypothetical: (alt, x) => {
      if (hasPrepareSpell(alt, x)) x.prepared = true; // CR 722.3a: only with a prepare spell
    },
  },
];
