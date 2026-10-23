/**
 * A face-down permanent spell resolves face down (CR 708.4; m6 design 3.4). Owner: M6-3. The move keeps the face-down status; core/move-parts/face-down.ts
 * carries `faceDownInfo` over to the permanent. It enters with no enters-the-battlefield abilities and no "as enters" effects of the real card (CR 708.3: it has
 * none as it would exist on the battlefield; effects/replacements.ts#involved, core/zones.ts#enterWithPrintedCounters).
 */
import type { ResolvePermanentPart } from '../registries';

export const FACE_DOWN_RESOLVE_PARTS: readonly ResolvePermanentPart[] = [
  { options: (_g, spell, opts) => (spell.faceDown ? { ...opts, faceDown: true } : opts) },
];
