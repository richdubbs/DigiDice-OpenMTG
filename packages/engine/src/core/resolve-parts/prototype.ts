/**
 * A prototyped spell becomes a prototyped permanent (CR 718.3b-c; m6 design 3.7). Owner: M6-6. Nothing changes how it resolves: the move keeps the status
 * (core/move-parts/prototype.ts, so the permanent has the prototype's characteristics from the moment it exists, CR 614.12), so no part is needed here.
 */
import type { ResolvePermanentPart } from '../registries';

export const PROTOTYPE_RESOLVE_PARTS: readonly ResolvePermanentPart[] = [];
