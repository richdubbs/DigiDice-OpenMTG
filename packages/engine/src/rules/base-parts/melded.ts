/**
 * M6-4's base part (m6 design 2.6, 3.6): a melded permanent has only the characteristics of the combined back face, the meld result's definition, and its mana
 * value is the sum of the mana values of its cards' front faces (CR 712.8g; it has no mana cost). Imports only types (rules/base-chars.ts imports this module
 * through rules/registries.ts: a value import back would be a cycle), so the face is read here as rules/base-chars.ts#fromFace reads one.
 */
import type { KeywordAbilityDef } from '../../types/ability';
import { manaValue } from '../../types/mana';
import type { BasePart } from '../registries';

export const MELDED_BASE_PARTS: readonly BasePart[] = [
  {
    source: (def, o) => (o.components !== undefined && o.components.length > 1 && def.layout === 'meld' && def.meld?.isResult === true ? { kind: 'melded' } : null),
    chars: (s, o) => {
      const f = s.defs[o.defId]!.faces[0]!;
      const abilities = f.abilities.map((def, index) => ({ face: 0, index, def }));
      return {
        name: f.name, names: [f.name], face: 0, combined: false, manaCost: f.manaCost,
        manaValue: (o.components ?? []).reduce((sum, part) => sum + manaValue(s.defs[part.defId]?.faces[0]?.manaCost ?? null, 0), 0), // CR 712.8g
        colors: [...f.colors], supertypes: [...f.supertypes], types: [...f.types], subtypes: [...f.subtypes],
        abilities, keywords: abilities.map((a) => a.def).filter((d): d is KeywordAbilityDef => d.kind === 'keyword'),
        ...(f.power !== undefined ? { power: f.power } : {}), ...(f.toughness !== undefined ? { toughness: f.toughness } : {}),
      };
    },
  },
];
