/**
 * Event forms of merged permanents (mutates, CR 702.140d; m6 design 2.6). Owner: M6-9. A mutating creature spell that merges with a creature as it resolves
 * emits `mutated` for the merged permanent (core/resolve-parts/mutate.ts; normalized to `becomes mutated`, triggers/normalize.ts).
 */
import type { EventFormsPart } from './forms';

export const MERGE_FORMS: EventFormsPart = { SUPPORTED: ['ev.becomes.mutated'], EMITS: [] };
