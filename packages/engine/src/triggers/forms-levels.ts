/**
 * Event forms of Cases, prepared permanents and Classes (CR 719.3b, 722.3a, 716.2a; m6 design 2.6). Owner: M6-6. A Class whose level becomes N and a Case that
 * becomes solved, and a permanent that becomes prepared (core/prepare.ts), emit `objectDesignation`, normalized to `becomes` with `what` 'classLevel' (and `level`),
 * 'solved' or 'prepared'
 * (triggers/normalize.ts); `becomes` is emitted since milestone 5, so no event kind is added to `EMITS`.
 */
import type { EventFormsPart } from './forms';

export const LEVELS_FORMS: EventFormsPart = { SUPPORTED: ['ev.becomes.classLevel', 'ev.becomes.solved', 'ev.becomes.prepared'], EMITS: [] };
