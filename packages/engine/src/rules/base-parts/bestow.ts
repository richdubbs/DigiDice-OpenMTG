/**
 * std-ry7's base part (m6 design 2.6): a bestowed Aura spell, and the bestowed Aura permanent it becomes (CR 702.103b, 702.103d-f; cites written from memory in
 * a cloud session, unverified). Cast for its bestow cost, the spell is an Aura enchantment spell with enchant creature instead of a creature spell: it loses the
 * card type creature and every creature type, gains the subtype Aura and the keyword ability "Enchant creature" (CR 303.4a: so an Aura spell, it targets the
 * creature it will enchant; rules/attachment.ts#auraTargetProgram), and has no power or toughness (CR 208.3). Every other characteristic is the card's: its
 * name, mana cost and mana value (CR 202.3), colors, other types and its printed abilities ("Enchanted creature gets +2/+2."). It stays so on the battlefield
 * while it is bestowed: once it becomes unattached it stops being bestowed and is the enchantment creature the card is (CR 702.103f; core/sba-objects.ts), and
 * a bestowed spell whose target is illegal as it resolves stops being bestowed and resolves as a creature spell (CR 702.103e; core/resolve.ts).
 *
 * Only an object with `bestowed` (set by actions/cast-opt/bestow.ts on the stack, carried to the permanent by core/move-parts/bestow.ts) on the stack or the
 * battlefield is claimed. A face-down object is not (CR 708.2). Imports only types and the subtype table (rules/base-chars.ts imports this module through
 * rules/registries.ts: a value import of it back would be a cycle), so the face is read here the way rules/base-chars.ts#fromFace reads it.
 */
import type { KeywordAbilityDef } from '../../types/ability';
import type { CardDef } from '../../types/card';
import type { GameObject } from '../../types/state';
import { isCreatureType } from '../../statics/subtypes';
import type { BaseChars } from '../characteristics';
import type { BasePart } from '../registries';

/** CR 702.103b: the ability a bestowed Aura has besides its printed ones, as the compile pipeline writes the keyword line "Enchant creature". */
export const BESTOW_ENCHANT: KeywordAbilityDef = { kind: 'keyword', keyword: 'enchant', filter: { types: ['Creature'] }, text: 'Enchant creature' };

/** CR 702.103b: the characteristics of face `face` of `def` cast bestowed (a fresh record), or null when that face is not a creature. */
export function bestowedChars(def: CardDef, face: number): BaseChars | null {
  const f = def.faces[face];
  if (!f || !f.types.includes('Creature')) return null;
  const printed = f.abilities.map((d, index) => ({ face, index, def: d }));
  // the enchant ability is keyed after the printed ones (statics/abilities.ts#printedKey): it is no printed ability, so nothing looks it up by its index
  const abilities = [...printed, { face, index: f.abilities.length, def: BESTOW_ENCHANT }];
  const c: BaseChars = {
    name: f.name,
    names: [f.name],
    face,
    combined: false,
    manaCost: f.manaCost,
    manaValue: 0,
    colors: [...f.colors],
    supertypes: [...f.supertypes],
    types: f.types.filter((t) => t !== 'Creature'),
    subtypes: [...f.subtypes.filter((t) => !isCreatureType(t)), ...(f.subtypes.includes('Aura') ? [] : ['Aura'])],
    abilities,
    keywords: abilities.flatMap((a) => (a.def.kind === 'keyword' ? [a.def] : [])),
  };
  if (f.loyalty !== undefined) c.loyalty = f.loyalty;
  if (f.defense !== undefined) c.defense = f.defense;
  return c;
}

/** The face of a bestowed spell or permanent (bestow cards have one face). */
const faceOf = (def: CardDef, o: GameObject): number => Math.min(o.zone === 'stack' ? o.stack?.face ?? o.face : o.face, def.faces.length - 1);

export const BESTOW_BASE_PARTS: readonly BasePart[] = [
  {
    source: (def, o) => {
      if (o.bestowed !== true || o.faceDown || o.kind === 'ability' || (o.zone !== 'stack' && o.zone !== 'battlefield')) return null;
      const face = faceOf(def, o);
      return def.faces[face]?.types.includes('Creature') === true ? { kind: 'bestow', face } : null;
    },
    chars: (s, o, src) => {
      const def = s.defs[o.defId]!;
      return bestowedChars(def, src.kind === 'bestow' ? src.face : faceOf(def, o))!;
    },
  },
];
