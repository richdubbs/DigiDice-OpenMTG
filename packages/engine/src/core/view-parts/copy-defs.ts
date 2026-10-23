/**
 * The definitions copy snapshots refer to (CR 707.2; m6 design 3.4, R39). Owner: M6-2. A viewer computes a copy's characteristics from the copied definition
 * (statics/copy.ts#applyCopiable), which no visible object may carry (the original left, or is a hidden card): every snapshot's definition is sent. A snapshot
 * of a face-down object names only the public pseudo-definition (CR 708.2, statics/copy.ts#copiableOrWhy), never the hidden card.
 */
import type { ViewPart } from '../registries';
import { snapshotDefs } from '../../statics/copy';

export const COPY_DEFS_VIEW_PARTS: readonly ViewPart[] = [{ usedDefs: (state) => snapshotDefs(state) }];
