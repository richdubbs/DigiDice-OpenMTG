/**
 * Layouts whose structure the engine implements (m6 design 2.6, 4.1). cards/pipeline.ts#LAYOUT_CAPS caps every layout of its list at `manual` UNLESS a
 * package lists it here, in its own file, in the commit whose tests show it works: meld (M6-4, cards/layout-support/dfc.ts), case, prototype and prepare (M6-6,
 * cards/layout-support/layouts.ts), mutate (M6-9, cards/layout-support/merge.ts). Owner of this index: M6-0. Empty in M6-0: every cap of milestone 5 stays.
 */
import type { Layout } from '../types/card';
import { DFC_LAYOUT_SUPPORT } from './layout-support/dfc';
import { LAYOUTS_LAYOUT_SUPPORT } from './layout-support/layouts';
import { MERGE_LAYOUT_SUPPORT } from './layout-support/merge';

/** Per layout: true when the engine implements its structure. */
export type LayoutSupport = Readonly<Partial<Record<Layout, boolean>>>;

export const LAYOUT_SUPPORT: LayoutSupport = { ...DFC_LAYOUT_SUPPORT, ...LAYOUTS_LAYOUT_SUPPORT, ...MERGE_LAYOUT_SUPPORT };
