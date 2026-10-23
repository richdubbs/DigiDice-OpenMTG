/**
 * Turning a face-down permanent face up (CR 116.2b, 702.37e morph and megamorph, 702.168d disguise, 701.40b manifest, 701.58b cloak): any time you have priority,
 * pay its cost. M6-3: this stays the keyword library's DECLARATION of the special action (keywords may import neither effects nor core values, m6 design 4.4);
 * the action itself is listed and performed by core/special/turn-face-up.ts (core/registries.ts#SPECIAL_ACTION_HANDLERS, ahead of this adapted stub, which
 * lists nothing). The keywords morph, megamorph and disguise are `native` (keywords/data): engine code acts on them.
 */
import { plannedSpecialAction } from './stub';

export const TURN_FACE_UP = plannedSpecialAction('turnFaceUp', 'CR 116.2b', ['battlefield'], 'priority', 'Turning a face-down permanent face up through the keyword stub (use core/special/turn-face-up.ts)');
