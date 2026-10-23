/**
 * Foretell (CR 702.143a, 116.2h): any time you have priority during your turn, pay {2} and exile the card from your hand face down. Cloud r3-mech: this stays the
 * keyword library's DECLARATION of the special action (as plot.ts); the action is listed and performed by core/special/foretell.ts and a foretold card is cast
 * by actions/cast-opt/foretell.ts. The keyword foretell is `native` (keywords/data/foretell.json).
 */
import { plannedSpecialAction } from './stub';

export const FORETELL = plannedSpecialAction('foretell', 'CR 116.2h', ['hand'], 'priority', 'Foretell');
