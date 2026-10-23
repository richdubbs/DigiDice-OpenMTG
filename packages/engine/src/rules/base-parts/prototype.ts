/**
 * M6-6's base part (m6 design 2.6, 3.7): a prototyped spell, and the permanent it becomes, have only the prototype's mana cost, power and toughness, and the
 * colors of that mana cost (CR 718.3b, 105.2); every other characteristic is the card's (CR 718.5). In every other zone, and on the stack or the battlefield
 * when not cast prototyped, a prototype card has its normal characteristics (CR 718.4): only an object with `prototyped` (set by actions/cast-opt/prototype.ts
 * on the stack, and by rules/stack-objects.ts#putCopyOnStack on a copy of a prototyped spell, CR 718.3c; carried to the permanent by core/move-parts/prototype.ts) on the stack or the battlefield is claimed. A face-down object is not (CR 708.2).
 *
 * Imports only types (rules/base-chars.ts imports this module through rules/registries.ts: a value import back would be a cycle), so the face is read here
 * the way rules/base-chars.ts#fromFace reads it.
 */
import type { CardDef } from '../../types/card';
import { costColors, manaValue, sortColors } from '../../types/mana';
import type { GameObject } from '../../types/state';
import type { BaseChars } from '../characteristics';
import type { BasePart } from '../registries';

/** CR 718.3b: the characteristics of the prototyped face `face` of `def` (a fresh record), or null when that face has no prototype (CR 718.2). */
export function prototypeChars(def: CardDef, face: number): BaseChars | null {
  const f = def.faces[face];
  const p = f?.prototype;
  if (!f || !p) return null;
  const abilities = f.abilities.map((d, index) => ({ face, index, def: d }));
  const c: BaseChars = {
    name: f.name,
    names: [f.name],
    face,
    combined: false,
    manaCost: [...p.manaCost],
    manaValue: manaValue(p.manaCost),
    colors: sortColors([...costColors(p.manaCost), ...(f.colorIndicator ?? [])]), // CR 718.3b, 105.2
    supertypes: [...f.supertypes],
    types: [...f.types],
    subtypes: [...f.subtypes],
    abilities,
    keywords: abilities.flatMap((a) => (a.def.kind === 'keyword' ? [a.def] : [])),
    power: p.power,
    toughness: p.toughness,
  };
  if (f.loyalty !== undefined) c.loyalty = f.loyalty;
  if (f.defense !== undefined) c.defense = f.defense;
  return c;
}

/** The face of a prototyped spell or permanent (prototype cards have one face). */
const faceOf = (def: CardDef, o: GameObject): number => Math.min(o.zone === 'stack' ? o.stack?.face ?? o.face : o.face, def.faces.length - 1);

export const PROTOTYPE_BASE_PARTS: readonly BasePart[] = [
  {
    source: (def, o) => {
      if (o.prototyped !== true || o.faceDown || o.kind === 'ability' || (o.zone !== 'stack' && o.zone !== 'battlefield')) return null;
      const face = faceOf(def, o);
      return def.faces[face]?.prototype ? { kind: 'prototype', face } : null;
    },
    chars: (s, o, src) => {
      const def = s.defs[o.defId]!;
      return prototypeChars(def, src.kind === 'prototype' ? src.face : faceOf(def, o))!;
    },
  },
];
