/**
 * Suspend (CR 702.62a, 116.2f): from hand, if you could begin to cast the card, pay the suspend cost and exile it with time counters. std-rx22: this stays the
 * keyword library's DECLARATION of the special action (as plot.ts); the action is listed and performed by core/special/suspend.ts, and the triggered abilities
 * of a suspended card and the cast creature's haste are the keyword's expansion (keywords/data/suspend.json).
 */
import { plannedSpecialAction } from './stub';

export const SUSPEND = plannedSpecialAction('suspend', 'CR 116.2f', ['hand'], 'priority', 'Suspending through the keyword stub (use core/special/suspend.ts)');
