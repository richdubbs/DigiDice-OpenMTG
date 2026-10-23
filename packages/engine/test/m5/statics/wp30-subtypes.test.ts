/**
 * WP30 (W1 follow-up c): one list of subtypes (CR 205.3g-q). statics/subtypes.ts is the only copy; rules/creature-types.ts and rules/filter.ts read it. Each class
 * is checked against the lexicon that scripts/gen-lexicon.ts generates from the Comprehensive Rules (itself checked for staleness against rules/cr), so this
 * runs offline and a new CR edition that adds a type fails here until the list is updated.
 */
import { describe, expect, it } from 'vitest';
import lexicon from '../../../src/parser/lexicon.generated.json';
import { ALL_CREATURE_TYPES } from '../../../src/rules/creature-types';
import type { Chars } from '../../../src/rules/characteristics';
import { creatureTypesOf, landTypesOf } from '../../../src/rules/filter';
import {
  ARTIFACT_TYPES, BASIC_LAND_TYPES, BATTLE_TYPES, CREATURE_TYPES, DUNGEON_TYPES, ENCHANTMENT_TYPES, isCreatureType, isLandType, isNonCreatureSubtype, LAND_TYPES,
  SPELL_TYPES, subtypeClass,
} from '../../../src/statics/subtypes';

const fromLexicon = (cls: string): string[] => lexicon.subtypes.filter((t) => t.class === cls).map((t) => t.singular).sort();
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

describe('CR 205.3: the subtype lists equal the ones generated from the Comprehensive Rules', () => {
  it.each([
    ['artifact (CR 205.3g)', 'artifact', ARTIFACT_TYPES],
    ['enchantment (CR 205.3h)', 'enchantment', ENCHANTMENT_TYPES],
    ['land (CR 205.3i)', 'land', LAND_TYPES],
    ['spell (CR 205.3k)', 'spell', SPELL_TYPES],
    ['creature (CR 205.3m)', 'creature', CREATURE_TYPES],
    ['battle (CR 205.3q)', 'battle', BATTLE_TYPES],
  ] as const)('%s', (_name, cls, list) => {
    expect(sorted(list)).toEqual(fromLexicon(cls));
    expect(new Set(list).size).toBe(list.length);
  });

  it('CR 205.3p: the one dungeon type; CR 205.3i: the five basic land types are land types', () => {
    expect(DUNGEON_TYPES).toEqual(['Undercity']);
    expect(BASIC_LAND_TYPES.every(isLandType)).toBe(true);
  });

  it('apostrophes are straight, as in the Oracle data ("Urza\'s", "C\'tan", "Shi\'ar"); "Time Lord" is the one two-word creature type', () => {
    const all = [...LAND_TYPES, ...CREATURE_TYPES];
    expect(all.filter((t) => t.includes('’'))).toEqual([]);
    expect(LAND_TYPES).toContain("Urza's");
    expect(CREATURE_TYPES.filter((t) => t.includes("'")).sort()).toEqual(["C'tan", "Shi'ar"]);
    expect(CREATURE_TYPES.filter((t) => t.includes(' '))).toEqual(['Time Lord']);
  });

  it('no subtype is in two classes', () => {
    const lists = [ARTIFACT_TYPES, ENCHANTMENT_TYPES, LAND_TYPES, SPELL_TYPES, CREATURE_TYPES, BATTLE_TYPES, DUNGEON_TYPES];
    const seen = lists.flat();
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('one list: every reader uses statics/subtypes.ts', () => {
  it('ALL_CREATURE_TYPES (rules/creature-types.ts, CR 702.73a changeling) is exactly the creature types', () => {
    expect(sorted([...ALL_CREATURE_TYPES])).toEqual(sorted(CREATURE_TYPES));
    expect(ALL_CREATURE_TYPES.size).toBe(324);
  });

  it('the class helpers agree with the lists; a subtype in no list is not a known non-creature type', () => {
    expect(isCreatureType('Goblin')).toBe(true);
    expect(isCreatureType('Forest')).toBe(false);
    expect(isNonCreatureSubtype('Equipment')).toBe(true);
    expect(isNonCreatureSubtype('Siege')).toBe(true);
    expect(isNonCreatureSubtype('Undercity')).toBe(true);
    expect(isNonCreatureSubtype('Goblin')).toBe(false);
    expect(isNonCreatureSubtype('Futurekin')).toBe(false); // a creature type newer than the list still counts as one
    expect(subtypeClass('Undercity')).toBe('dungeon');
  });

  const chars = (types: string[], subtypes: string[]): Chars => ({ types, subtypes, keywords: [] }) as unknown as Chars;

  it('CR 205.3i, 205.3m: an animated Urza\'s land has the land type Urza\'s and no creature type "Urza\'s" (the old copy in rules/filter.ts had a curly apostrophe)', () => {
    const tower = chars(['Land', 'Creature'], ["Urza's", 'Tower', 'Construct']);
    expect([...landTypesOf(tower)].sort()).toEqual(['Tower', "Urza's"]);
    expect([...creatureTypesOf(tower).set]).toEqual(['Construct']);
  });

  it('CR 205.3m: Dryad Arbor is a Forest (land type) and a Dryad (creature type); a dungeon type, a battle type and an artifact type are not creature types', () => {
    expect([...creatureTypesOf(chars(['Land', 'Creature'], ['Forest', 'Dryad'])).set]).toEqual(['Dryad']);
    expect([...landTypesOf(chars(['Land', 'Creature'], ['Forest', 'Dryad']))]).toEqual(['Forest']);
    expect([...creatureTypesOf(chars(['Kindred', 'Artifact'], ['Equipment', 'Goblin'])).set]).toEqual(['Goblin']);
    expect([...creatureTypesOf(chars(['Creature', 'Battle'], ['Siege', 'Undercity', 'Elf'])).set]).toEqual(['Elf']);
  });
});
