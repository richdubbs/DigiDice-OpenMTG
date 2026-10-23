/**
 * Event forms of the plotted designation (FAST5X E6; CR 702.170a, 603.2). A card that becomes plotted (the plot special action, core/special/plot.ts) emits
 * `objectDesignation` with `what` 'plotted' (effects/handlers/plot-ops.ts), normalized to `becomes` with `what` 'plotted' (triggers/normalize.ts); `becomes` is
 * emitted since milestone 5, so no event kind is added to `EMITS`. The card is in exile then, so "When this card becomes plotted" functions there (CR 113.6k;
 * parser/lower/trigger-zone.ts#homeZone).
 */
import type { EventFormsPart } from './forms';

export const PLOT_FORMS: EventFormsPart = { SUPPORTED: ['ev.becomes.plotted'], EMITS: [] };
