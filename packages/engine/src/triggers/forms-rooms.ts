/**
 * Event forms of Rooms (FAST5X E8; CR 709.5h-i, 603.2). A door that is unlocked (the unlock special action, an effect, or a Room entering with the half that was
 * cast unlocked, CR 709.5d-f) emits `doorUnlocked` (core/rooms.ts), normalized to `becomes` with `what` 'unlocked' (and `face`), plus 'fullyUnlocked' when the
 * Room now has both unlocked designations (triggers/normalize.ts); `becomes` is emitted since milestone 5, so no event kind is added to `EMITS`.
 */
import type { EventFormsPart } from './forms';

export const ROOM_FORMS: EventFormsPart = { SUPPORTED: ['ev.becomes.unlocked', 'ev.becomes.fullyUnlocked'], EMITS: [] };
