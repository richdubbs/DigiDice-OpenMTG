/**
 * Event forms of the saddled designation (FAST5X E3; CR 702.171b, 603.2). A permanent that becomes saddled (the saddle ability resolving, CR 702.171a, or an
 * effect that says so) emits `objectDesignation` with `what` 'saddled' (effects/handlers/levels.ts), normalized to `becomes` with `what` 'saddled'
 * (triggers/normalize.ts); `becomes` is emitted since milestone 5, so no event kind is added to `EMITS`.
 */
import type { EventFormsPart } from './forms';

// Standard round 5, r5-trig (CR 702.122b, 702.171c): a creature tapped for a crew or saddle cost (`crewTapped`, actions/activate.ts) is `becomes` 'crewCostPaid' /
// 'saddleCostPaid' of the Vehicle or Mount, with the creature as `by` ("Whenever ~ crews a Vehicle", "saddles a Mount")
export const SADDLE_FORMS: EventFormsPart = { SUPPORTED: ['ev.becomes.saddled', 'ev.becomes.crewCostPaid', 'ev.becomes.saddleCostPaid', 'ev.becomes.teamworkCostPaid' /* std-rq: actions/cast.ts */, 'ev.becomes.untapStep' /* r5-trig: core/steps.ts marks the untap step's untaps */], EMITS: [] };
