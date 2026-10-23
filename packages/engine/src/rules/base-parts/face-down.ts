/**
 * M6-3's base part (m6 design 2.6, 3.4, D6). Owner: M6-3.
 *
 *  - A face-down permanent or spell (battlefield, stack) starts from its REAL face: being face down is layer 1b (CR 613.2b), applied after the copy effects of
 *    layer 1a (CR 708.10) by statics/face-down.ts (on the fast path by its intrinsic part), so the milestone 5 base 2/2 of rules/base-chars.ts is no longer
 *    what a face-down permanent starts from.
 *  - A card exiled face down (or face down in any other zone but a hand or a library) has no characteristics at all (CR 406.3a, 110.5d): no name, no types,
 *    mana value 0. It is not a creature card, so "creature cards in exile" does not count it.
 *  - A face-down card in a hand or a library is a hidden card: unchanged (not claimed).
 *
 * Imports only types (rules/base-chars.ts imports this module through rules/registries.ts: a value import back would be a cycle).
 */
import type { CardDef } from '../../types/card';
import type { GameObject } from '../../types/state';
import type { BasePart } from '../registries';

/** The face that supplies the characteristics of a permanent or spell (rules/base-chars.ts#faceIndexOf, repeated here: see the file comment). */
function realFace(def: CardDef, o: GameObject): number {
  const last = def.faces.length - 1;
  if (o.zone === 'stack') return Math.min(o.stack?.face ?? o.face, last);
  if (def.layout === 'flip') return o.flipped && last >= 1 ? 1 : 0;
  return Math.min(o.face, last);
}

export const FACE_DOWN_BASE_PARTS: readonly BasePart[] = [
  {
    source: (def, o) => {
      if (!o.faceDown || o.kind === 'ability' || o.zone === 'hand' || o.zone === 'library') return null;
      if (o.zone === 'battlefield' || o.zone === 'stack') return { kind: 'face', face: realFace(def, o) }; // CR 613.2b: the profile is layer 1b
      return { kind: 'faceDownExile' }; // CR 406.3a, 110.5d
    },
    // CR 406.3a: no characteristics (only a 'faceDownExile' source is built here: a 'face' source is built by rules/base-chars.ts itself)
    chars: () => ({ name: '', names: [], face: 0, combined: false, manaCost: null, manaValue: 0, colors: [], supertypes: [], types: [], subtypes: [], abilities: [], keywords: [] }),
  },
];
