/**
 * The definitions of the components of melded and merged permanents (CR 712.4a, 730.2; m6 design 3.4, 3.7). Owner: M6-9. A viewer computes a merged
 * permanent's abilities from every component's definition (statics/merge.ts#applyMerged, CR 702.140e) and a melded permanent's mana value from its cards'
 * (rules/base-parts/melded.ts, CR 712.8g); no visible object carries those definitions. A face-down component's definition is sent only to its controller (CR
 * 708.5); the others see the face-down pseudo-definition core/view.ts puts in its place.
 */
import type { DefId } from '../../types/ids';
import { FACE_DOWN_DEF_IDS } from '../../types/card';
import type { ViewPart } from '../registries';

export const COMPONENTS_VIEW_PARTS: readonly ViewPart[] = [
  {
    usedDefs: (state, viewer) => {
      const out = new Set<DefId>();
      for (const id of state.zones.battlefield) {
        const o = state.objects[id];
        for (const c of o?.components ?? []) out.add(c.faceDown && viewer !== o!.controller ? FACE_DOWN_DEF_IDS.plain : c.defId);
      }
      return out;
    },
  },
];
