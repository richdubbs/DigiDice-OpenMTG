/**
 * Event forms of phasing (edh-d-39; CR 702.26b-c, 603.2). A permanent that phases out (rules/phasing.ts#phaseOutPermanent) emits `phasedOut`, one that phases in
 * (#phaseInPermanent, #phaseInForUntapStep) emits `phasedIn`; triggers/normalize.ts reads both as `becomes` with `what` 'phasedOut' / 'phasedIn' (`becomes` is emitted since
 * milestone 5, so no event kind is added to `EMITS`).
 */
import type { EventFormsPart } from './forms';

export const PHASE_FORMS: EventFormsPart = { SUPPORTED: ['ev.becomes.phasedOut', 'ev.becomes.phasedIn'], EMITS: [] };
