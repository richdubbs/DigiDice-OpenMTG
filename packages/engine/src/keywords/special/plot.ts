/**
 * Plot (CR 702.170a-b, 116.2k): during your own main phase with an empty stack, exile the card from your hand and pay the plot cost. FAST5X E6: this stays the
 * keyword library's DECLARATION of the special action (keywords may import neither effects nor core values, m6 design 4.4); the action itself is listed and
 * performed by core/special/plot.ts (core/registries.ts#SPECIAL_ACTION_HANDLERS, ahead of this adapted stub, which lists nothing), and a plotted card is cast by
 * actions/cast-opt/plot.ts (CR 702.170d). The keyword plot is `native` (keywords/data/plot.json).
 */
import { plannedSpecialAction } from './stub';

export const PLOT = plannedSpecialAction('plot', 'CR 116.2k', ['hand'], 'sorceryTiming', 'Plotting through the keyword stub (use core/special/plot.ts)');
