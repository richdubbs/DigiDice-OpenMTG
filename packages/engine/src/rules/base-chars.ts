/**
 * The characteristics an object has BEFORE any continuous effect (CR 109.3, 613.1): its face, the copiable values, a face-down 2/2,
 * a combined split card. Moved out of rules/characteristics.ts in milestone 5 (WP0) to break an import cycle: `getChars` will call
 * `statics/layers#computeAll` (WP9), and the layer system starts from this base, so the base cannot live in the module that imports the layers.
 *
 * Which face supplies the characteristics:
 *  - tokens and ordinary cards: face 0;
 *  - a split card outside the stack: both halves combined (CR 709.4); on the stack: the cast half (CR 709.3b);
 *  - an adventurer card: its normal characteristics everywhere except as an Adventure spell on the stack (CR 715.3b, 715.4);
 *  - a double-faced card: front face outside the battlefield and stack (CR 712.8a), the face that is up
 *    on the stack or battlefield (CR 712.8c-f);
 *  - a flip card: the normal half unless the permanent is flipped (CR 710.2); color and mana cost never change (CR 710.1c,
 *    already handled by the card compiler);
 *  - a face-down object: a 2/2 nameless creature (CR 708.2a).
 */
import type { CardDef, FaceDef } from '../types/card';
import { manaValue, sortColors, type ManaCost } from '../types/mana';
import type { GameObject, GameState } from '../types/state';
import { EngineBug } from '../core/errors';
import type { BaseChars as Chars, PrintedAbility } from './characteristics'; // WP9: `Chars` (with controller, keyed abilities, cantHave) is what the layers produce from this
import { BASE_PARTS } from './registries'; // M6-0 (m6 design 2.6): the parts import only types and base-chars helpers (no cycle through statics/layers)
// FAST5X E8 (CR 709.5): re-exported so statics (which may value-import rules/base-chars only, design 5.4) can tell a Room (statics/copy.ts)
export { hasSharedTypeLine, unlockedHalves } from './base-parts/room'; // r4-static: also the unlocked doors a static ability counts (statics/match.ts)
export { prototypeChars } from './base-parts/prototype'; // wave 3 merge: statics/copy.ts copies a prototyped object's prototype characteristics (CR 718.3d)

export const keywordsOf = (abilities: PrintedAbility[]): Chars['keywords'] => abilities.flatMap((a) => (a.def.kind === 'keyword' ? [a.def] : []));

/** The face of `def` that supplies characteristics for `o` (see the file comment). */
export function faceIndexOf(def: CardDef, o: GameObject): number {
  const last = def.faces.length - 1;
  switch (o.zone) {
    case 'stack':
      return Math.min(o.stack?.face ?? o.face, last);
    case 'battlefield':
      if (def.layout === 'flip') return o.flipped && last >= 1 ? 1 : 0;
      return Math.min(o.face, last);
    default:
      return 0;
  }
}

export function fromFace(f: FaceDef, faceIdx: number): Chars {
  const c: Chars = {
    name: f.name,
    names: [f.name],
    face: faceIdx,
    combined: false,
    manaCost: f.manaCost,
    manaValue: 0,
    colors: [...f.colors],
    supertypes: [...f.supertypes],
    types: [...f.types],
    subtypes: [...f.subtypes],
    abilities: [],
    keywords: [],
  };
  c.abilities = f.abilities.map((def, index) => ({ face: faceIdx, index, def }));
  c.keywords = keywordsOf(c.abilities);
  if (f.power !== undefined) c.power = f.power;
  if (f.toughness !== undefined) c.toughness = f.toughness;
  if (f.loyalty !== undefined) c.loyalty = f.loyalty;
  if (f.defense !== undefined) c.defense = f.defense;
  return c;
}

/** CR 709.4: in every zone except the stack a split card has the characteristics of both halves combined. */
export function combineSplit(def: CardDef): Chars {
  const parts = def.faces.map((f, i) => fromFace(f, i));
  const cost: ManaCost = [];
  let hasCost = false;
  for (const p of parts) if (p.manaCost) { cost.push(...p.manaCost); hasCost = true; } // CR 709.4b
  const c: Chars = {
    name: def.faces.map((f) => f.name).join(' // '),
    names: def.faces.map((f) => f.name),
    face: 0,
    combined: true,
    manaCost: hasCost ? cost : null,
    manaValue: 0,
    colors: sortColors(parts.flatMap((p) => p.colors)),
    supertypes: [...new Set(parts.flatMap((p) => p.supertypes))],
    types: [...new Set(parts.flatMap((p) => p.types))], // CR 709.4c
    subtypes: [...new Set(parts.flatMap((p) => p.subtypes))],
    abilities: parts.flatMap((p) => p.abilities),
    keywords: [],
  };
  c.keywords = keywordsOf(c.abilities);
  return c;
}

/**
 * The face-down 2/2 (CR 708.2a). Deeply frozen: `baseChars` copies it into fresh arrays on every call (`faceDownChars`), because `charsOfObject` results
 * are stored in `GameState.lki` (shared between states and games) and the layers of WP9 edit a `Chars` in place (`types.push`, subtype grants); an alias of this
 * constant's arrays would let one face-down creature's edit corrupt every later face-down 2/2 in the process (design 4.3, hazards 2-3).
 */
export const FACE_DOWN: Readonly<Omit<Chars, 'manaValue'>> = Object.freeze({
  name: '',
  names: Object.freeze([]) as unknown as string[],
  face: 0,
  combined: false,
  manaCost: null,
  colors: Object.freeze([]) as unknown as Chars['colors'],
  supertypes: Object.freeze([]) as unknown as Chars['supertypes'],
  types: Object.freeze(['Creature']) as unknown as Chars['types'],
  subtypes: Object.freeze([]) as unknown as string[],
  power: '2',
  toughness: '2',
  abilities: Object.freeze([]) as unknown as Chars['abilities'],
  keywords: Object.freeze([]) as unknown as Chars['keywords'],
});

/** A new face-down characteristics record: every array is the caller's own (see FACE_DOWN). */
const faceDownChars = (): Chars => ({
  ...FACE_DOWN,
  names: [],
  colors: [],
  supertypes: [],
  types: [...FACE_DOWN.types],
  subtypes: [],
  abilities: [],
  keywords: [],
  manaValue: 0,
});

/**
 * The mana cost a face's mana value is calculated from. The back face of a transforming double-faced card has no mana cost,
 * but its mana value is calculated as though it had the mana cost of its front face (CR 202.3a, 202.3b). The back face of a
 * modal double-faced card is not covered ("nonmodal"): it uses its own cost. The `manaCost` characteristic itself stays null
 * (CR 202.1b), so colors and castability are unaffected.
 */
export function costForManaValue(def: CardDef, face: number, own: ManaCost | null): ManaCost | null {
  return def.layout === 'transform' && face >= 1 ? def.faces[0]!.manaCost : own;
}

/**
 * Where the base characteristics of an object come from (see the file comment): a face-down 2/2, an ability on the stack, both halves of a split card combined,
 * or one face of the definition. Only the last two depend on the definition alone, so they are what statics/layers.ts may compute once per definition.
 */
export type BaseSource =
  | { kind: 'faceDown' } | { kind: 'ability' } | { kind: 'combined' } | { kind: 'face'; face: number }
  // M6-0 (m6 design 2.6): the sources a base part claims (rules/registries.ts#BASE_PARTS): a card exiled face down (no characteristics, CR 406.3a; M6-3),
  // a melded permanent (CR 712.8g; M6-4), a prototyped spell or permanent (CR 718.3b; M6-6). None is claimed before its owner lands.
  | { kind: 'faceDownExile' } | { kind: 'melded' } | { kind: 'prototype'; face: number }
  // std-ry7 INTERFACE CHANGE (additive): a bestowed Aura spell or permanent (CR 702.103b; rules/base-parts/bestow.ts)
  | { kind: 'bestow'; face: number }
  // FAST5X E8 INTERFACE CHANGE (additive): a Room permanent, with the halves that are unlocked (CR 709.5, 709.5c; rules/base-parts/room.ts)
  | { kind: 'room'; unlocked: number[] };

export function baseSource(def: CardDef, o: GameObject): BaseSource {
  for (const p of BASE_PARTS) {
    const claimed = p.source(def, o); // M6-0: a base part claims the object first (empty in M6-0: the milestone 5 rules below)
    if (claimed) return claimed;
  }
  if (o.faceDown && o.zone !== 'hand' && o.zone !== 'library') return { kind: 'faceDown' }; // CR 708.2a
  if (o.kind === 'ability') return { kind: 'ability' }; // CR 113.7a / 602.2a
  if (def.layout === 'split' && def.faces.length > 1 && (o.zone !== 'stack' || o.stack?.fused === true)) return { kind: 'combined' }; // CR 709.4, 702.102b, 709.4d
  return { kind: 'face', face: faceIndexOf(def, o) };
}

/** The characteristics of a definition-only source (`combined` or `face`): a fresh record. Its mana value is not worked out yet (see `baseManaValue`). */
export function sourceChars(def: CardDef, src: { kind: 'combined' } | { kind: 'face'; face: number }): Chars {
  return src.kind === 'combined' ? combineSplit(def) : fromFace(def.faces[src.face]!, src.face);
}

/** CR 202.3b, 202.3e: the mana value of an object with these base characteristics (X is the announced value on the stack, 0 everywhere else). */
export const baseManaValue = (def: CardDef, c: Pick<Chars, 'face' | 'manaCost'>, o: GameObject): number =>
  manaValue(costForManaValue(def, c.face, c.manaCost), o.zone === 'stack' ? o.stack?.x ?? 0 : 0);

/** Characteristics of an object before any continuous effect (CR 109.3): printed values of the face that applies, with the mana value worked out. */
export function baseChars(s: GameState, o: GameObject): Chars {
  const def = s.defs[o.defId];
  if (!def) throw new EngineBug(`No definition "${o.defId}" for object ${o.id}`);
  const src = baseSource(def, o);
  let c: Chars;
  if (src.kind === 'faceDown') {
    c = faceDownChars(); // CR 708.2a
  } else if (src.kind === 'ability') {
    // CR 113.7a / 602.2a: an ability on the stack has no characteristics other than its text.
    c = { name: o.stack?.sourceName ?? '', names: [], face: 0, combined: false, manaCost: null, manaValue: 0, colors: [], supertypes: [], types: [], subtypes: [], abilities: [], keywords: [] };
  } else if (src.kind === 'combined' || src.kind === 'face') {
    c = sourceChars(def, src);
  } else {
    // M6-0: a source a base part claimed is built by that part (m6 design 2.6)
    const part = BASE_PARTS.find((p) => p.chars !== undefined && p.source(def, o) !== null);
    if (!part) throw new EngineBug(`No base part builds the "${src.kind}" characteristics of object ${o.id}`);
    c = part.chars!(s, o, src);
  }
  // M6-4 (INTERFACE CHANGE): a melded permanent's mana value is the sum of its cards' (CR 712.8g), which its base part works out; it has no mana cost of its own
  if (src.kind !== 'melded') c.manaValue = baseManaValue(def, c, o);
  return c;
}
