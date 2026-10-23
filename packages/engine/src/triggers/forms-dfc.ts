/**
 * Event forms of double-faced cards, flip, day and night, meld (CR 701.27-701.28, 710, 731, 701.42; m6 design 2.6). Owner: M6-4.
 *
 * Converting emits `transformed` with `convert` (rules/status.ts#transformPermanent; normalized to `becomes converted`, CR 701.28, and `becomes transformed`,
 * CR 701.27e), flipping emits `flipped` (rules/status.ts#flipPermanent, CR 710), and day becoming night or night becoming day emits `dayNight`
 * (core/designations.ts#setDayNight, CR 731.1a); melding emits `melded` for the melded permanent (core/move-parts/components.ts, CR 701.42a).
 */
import type { EventFormsPart } from './forms';

export const DFC_FORMS: EventFormsPart = { SUPPORTED: ['ev.becomes.converted', 'ev.becomes.flipped', 'ev.becomes.melded'], EMITS: ['dayNight'] };
