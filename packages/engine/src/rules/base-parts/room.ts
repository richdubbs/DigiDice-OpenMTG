/**
 * FAST5X E8's base part: a permanent with a shared type line (a Room, CR 709.5). Owner: FAST5X E8.
 *
 * CR 709.5: the shared type line of a split permanent card represents two static abilities that function on the battlefield: "As long as this permanent doesn't
 * have the 'left half unlocked' designation, it doesn't have the name, mana cost, or rules text of this object's left half", and the same for the right half.
 * So on the battlefield (and not face down, CR 708.2) such a permanent has:
 *   - the types, subtypes and supertypes of the shared type line (CR 709.5a), whichever halves are unlocked;
 *   - the name, mana cost and rules text (abilities) of its UNLOCKED halves only (`GameObject.unlocked`, CR 709.5c); with both unlocked, both names and the
 *     combined mana cost (CR 709.4, 709.4a-b);
 *   - the colors of that mana cost (CR 105.2, 202.2) and its mana value (CR 202.3; rules/base-chars.ts#baseChars works it out from `manaCost`): a Room with no
 *     unlocked half has no name, no mana cost, is colorless and has mana value 0.
 * In every other zone a split card is both halves combined (CR 709.4) and on the stack the half cast (CR 709.3b): those stay with rules/base-chars.ts.
 *
 * Imports only types and the mana helpers (rules/base-chars.ts imports this module through rules/registries.ts: a value import back would be a cycle).
 */
import type { CardDef, FaceDef } from '../../types/card';
import { sortColors, type ManaCost } from '../../types/mana';
import type { GameObject } from '../../types/state';
import type { BaseChars } from '../characteristics';
import type { BasePart } from '../registries';

const PERMANENT_TYPES: readonly string[] = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];

const isPermanentFace = (f: FaceDef): boolean => f.types.some((t) => PERMANENT_TYPES.includes(t));

/**
 * CR 709.5: a split card whose halves are permanent halves with a single shared type line (every Room). Instant and sorcery split cards have a type line per
 * half; a split card with a permanent half and a nonpermanent half does not exist.
 */
export function hasSharedTypeLine(def: CardDef): boolean {
  if (def.layout !== 'split' || def.faces.length < 2) return false;
  const [a, ...rest] = def.faces;
  const line = (f: FaceDef): string => `${f.supertypes.join(' ')}|${f.types.join(' ')}|${f.subtypes.join(' ')}`;
  return def.faces.every(isPermanentFace) && rest.every((f) => line(f) === line(a!));
}

/** The unlocked halves of `o` (CR 709.5c), valid indices of `def` only, ascending. */
export function unlockedHalves(def: CardDef, o: Pick<GameObject, 'unlocked'>): number[] {
  return [...new Set(o.unlocked ?? [])].filter((i) => Number.isInteger(i) && i >= 0 && i < def.faces.length).sort((x, y) => x - y);
}

/** CR 709.5, 709.5a, 709.5c: the base characteristics of a Room permanent with the halves `open` unlocked (a fresh record, every array the caller's own). */
export function roomChars(def: CardDef, open: readonly number[]): BaseChars {
  const shared = def.faces[0]!;
  const halves = open.map((i) => ({ i, f: def.faces[i]! }));
  const cost: ManaCost = [];
  let hasCost = false;
  for (const { f } of halves) if (f.manaCost) { cost.push(...f.manaCost); hasCost = true; } // CR 709.4b
  const abilities = halves.flatMap(({ i, f }) => f.abilities.map((d, index) => ({ face: i, index, def: d })));
  return {
    name: halves.map(({ f }) => f.name).join(' // '),
    names: halves.map(({ f }) => f.name),
    face: halves[0]?.i ?? 0,
    combined: halves.length > 1,
    manaCost: hasCost ? cost : null,
    manaValue: 0,
    colors: sortColors(halves.flatMap(({ f }) => f.colors)), // CR 105.2: the colors of the mana cost it has
    supertypes: [...shared.supertypes], // CR 709.5a: the shared type line
    types: [...shared.types],
    subtypes: [...shared.subtypes],
    abilities,
    keywords: abilities.flatMap((a) => (a.def.kind === 'keyword' ? [a.def] : [])),
  };
}

export const ROOM_BASE_PARTS: readonly BasePart[] = [
  {
    source: (def, o) => {
      if (o.zone !== 'battlefield' || o.faceDown || o.kind === 'ability' || !hasSharedTypeLine(def)) return null;
      return { kind: 'room', unlocked: unlockedHalves(def, o) };
    },
    chars: (s, o, src) => {
      const def = s.defs[o.defId]!;
      return roomChars(def, src.kind === 'room' ? src.unlocked : unlockedHalves(def, o));
    },
  },
];
