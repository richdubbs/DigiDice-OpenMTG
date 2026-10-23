/** M6-4's filter part (m6 design 2.6): `flipped` (CR 710), set by flipping (effects/handlers/dfc-ops.ts, rules/status.ts#flipPermanent). */
import type { FilterStatusField } from '../registries';

export const DFC_FILTER_PARTS: readonly FilterStatusField[] = ['flipped'];
