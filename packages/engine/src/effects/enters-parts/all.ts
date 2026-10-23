/**
 * The enters parts in their order (effects/registries.ts#ENTERS_PARTS re-exports this list). A leaf module: the parts' `hypothetical` builders are read by
 * effects/entering-state.ts, which effects/bodies/m5.ts imports (CMD3: sunburst's `countersIf`, CR 614.12), without an import cycle through the registries.
 */
import type { EntersPart } from '../registries';
import { COPY_ENTERS_PARTS } from './copy';
import { FACE_DOWN_ENTERS_PARTS } from './face-down';
import { TRANSFORMED_ENTERS_PARTS } from './transformed';
import { PREPARED_ENTERS_PARTS } from './prepared';

export const ALL_ENTERS_PARTS: readonly EntersPart[] = [...COPY_ENTERS_PARTS, ...FACE_DOWN_ENTERS_PARTS, ...TRANSFORMED_ENTERS_PARTS, ...PREPARED_ENTERS_PARTS];
