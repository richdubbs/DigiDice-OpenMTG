/**
 * Layouts M6-9 lifts from the layout caps: mutate (CR 702.140, 730; m6 design 3.7): casting a mutating creature spell (actions/cast-opt/mutate.ts), merging as
 * it resolves (core/resolve-parts/mutate.ts), the merged permanent's characteristics (statics/merge.ts) and its leaving the battlefield as one permanent
 * (core/move-parts/components.ts) work.
 */
import type { LayoutSupport } from '../layout-support';

export const MERGE_LAYOUT_SUPPORT: LayoutSupport = { mutate: true };
