/**
 * Event forms of face-down permanents (m6 design 2.6). Owner: M6-3. A permanent turned face up (CR 708.8: the special action, CR 116.2b, or an effect) emits
 * `turnedFaceUp`; a face-up permanent turned face down (CR 708.2a) emits `turnedFaceDown` (rules/face-down.ts). Both are normalized to `becomes` (already
 * emitted in milestone 5, so no event kind is added to `EMITS`).
 */
import type { EventFormsPart } from './forms';

// FAST5X E25 (CR 701.62b): effects/handlers/face-ops.ts#manifestDread reports the `manifestDread` action of the player after the whole process, with the card it
// put into the graveyard as the event's subject ("whenever you manifest dread, put a card you put into your graveyard this way into your hand")
export const FACE_FORMS: EventFormsPart = { SUPPORTED: ['ev.becomes.turnedFaceUp', 'ev.becomes.turnedFaceDown', 'ev.action.manifestDread', 'ev.becomes.turnedFaceUp.player' /* cloud std-dsk */], EMITS: [] };
