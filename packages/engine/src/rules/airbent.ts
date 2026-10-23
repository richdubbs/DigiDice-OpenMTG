/**
 * FAST5X E10, CR 701.65a: the mark of a card exiled by airbending (`GameObject.chosen.airbent`). For as long as that card remains exiled, its owner may cast it
 * by paying {2} rather than paying its mana cost. Set by effects/handlers/airbend.ts on the card in exile; read by the cast option actions/cast-opt/airbend.ts.
 * A card that leaves exile is a new object without it (CR 400.7).
 */
import type { GameObject } from '../types/state';

export const AIRBENT = 'airbent';

/** Is this object a card in exile that its owner may cast for {2} because it was airbent (CR 701.65a)? */
export const isAirbent = (o: GameObject): boolean => o.zone === 'exile' && o.kind === 'card' && o.chosen?.[AIRBENT] === true;
