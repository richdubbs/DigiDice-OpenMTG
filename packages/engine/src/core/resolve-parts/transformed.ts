/**
 * A spell cast transformed or converted enters transformed (CR 712.11a, 712.13, 702.146b; m6 design 3.6). Owner: M6-4. A double-faced spell on the stack with
 * its back face up (actions/cast-opt/back-face.ts, the `cast` op's `transformed`) becomes a permanent with its back face up: the face it had on the stack.
 */
import type { ResolvePermanentPart } from '../registries';

export const TRANSFORMED_RESOLVE_PARTS: readonly ResolvePermanentPart[] = [
  {
    options: (g, spell, opts) => {
      const def = g.s.defs[spell.defId];
      const back = def !== undefined && def.layout === 'transform' && (spell.stack?.face ?? spell.face) === 1;
      return back ? { ...opts, face: 1 } : opts; // CR 712.13
    },
  },
];
