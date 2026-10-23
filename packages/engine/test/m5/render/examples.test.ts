/**
 * WP2 acceptance: the 53 worked examples of design section 13 render to exactly their Oracle text after normalization (design 15.2, WP2 tests).
 * The JSON and the Oracle lines are read from the design document when the test runs (examples.ts).
 *
 * Each ability of a card is gated against the Oracle line(s) it covers: lines are assigned in order, an ability taking the fewest lines that make
 * its render equal (a spell ability that merges lines takes several). Reminder-only lines produce no ability and are skipped.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { normalizeForGate, renderAbility, renderGate } from '../../../src/index';
import { examples } from './examples';

interface Example {
  name: string;
  oracle: string[];
  classification: string;
  card: { abilities?: AbilityDef[]; faces?: { name: string; abilities: AbilityDef[] }[] };
}

/** What the face is, as a caller of the gate would know it from the card (design 6.2 step 3, 5.3 `RenderContext.selfTypes`). */
const TYPES: Record<string, string[]> = {
  'Rancor': ['Enchantment', 'Aura'],
  'Bonesplitter': ['Artifact', 'Equipment'],
  'Sword of Fire and Ice': ['Artifact', 'Equipment'],
  'Blood Artist': ['Creature'],
  'Flametongue Kavu': ['Creature'],
  'Fiend Hunter': ['Creature'],
  'Mutavault': ['Land'],
  'Serra Angel': ['Creature'],
  'Vampire Nighthawk': ['Creature'],
  'Llanowar Elves': ['Creature'],
  'Thalia, Guardian of Thraben': ['Creature'],
  'Death-Rattle Oni': ['Creature'],
  'Kavu Titan': ['Creature'],
  'Clone': ['Creature'],
  'Paradise Plume': ['Artifact'],
  'Mana Vault': ['Artifact'],
  'Hallowed Fountain': ['Land'],
  'Glacial Fortress': ['Land'],
  'Cavern of Souls': ['Land'],
  'Rest in Peace': ['Enchantment'],
  'Humility': ['Enchantment'],
  'Opalescence': ['Enchantment'],
  'Glorious Anthem': ['Enchantment'],
  'Doubling Season': ['Enchantment'],
  'Leyline of the Void': ['Enchantment'],
  'Panharmonicon': ['Artifact'],
  'History of Benalia': ['Enchantment', 'Saga'],
  'Rhystic Study': ['Enchantment'],
  'Smothering Tithe': ['Enchantment'],
  'Sneak Attack': ['Enchantment'],
  'Chaos Orb': ['Artifact'],
};

const nameParts = (name: string): string[] => [name, ...(name.includes(',') ? [name.split(',')[0]!] : [])];

function facesOf(ex: Example): { names: string[]; abilities: AbilityDef[]; lines: string[] }[] {
  if (ex.card.faces) {
    return ex.card.faces.map((f) => ({
      names: [f.name, ...ex.name.split(' // ')],
      abilities: f.abilities,
      lines: ex.oracle.filter((l) => l.startsWith(`${f.name}: `)).map((l) => l.slice(f.name.length + 2)),
    }));
  }
  return [{ names: nameParts(ex.name), abilities: ex.card.abilities ?? [], lines: ex.oracle }];
}

describe('design 13 and CR 207.1: every worked example renders to its Oracle text', () => {
  it('there are 53 examples', () => {
    expect((examples as Example[]).length).toBe(53);
  });

  for (const ex of examples as Example[]) {
    it(`${ex.name}`, () => {
      for (const face of facesOf(ex)) {
        const ctx = { selfNames: face.names, selfTypes: TYPES[ex.name] };
        // lines that are only reminder text produce no ability
        const lines = face.lines.filter((l) => normalizeForGate(l, face.names) !== '');
        let pos = 0;
        for (const def of face.abilities) {
          let taken = 0;
          let last = '';
          for (let k = 1; pos + k <= lines.length; k++) {
            const r = renderGate(def, lines.slice(pos, pos + k), ctx);
            if (r.ok) {
              taken = k;
              break;
            }
            if (k === 1) last = `rendered: ${r.rendered}\nexpected: ${r.expected}\nfirstDiff: ${r.firstDiff}`;
          }
          expect(taken, `${ex.name}: ${def.kind} ability\n${last}\ndisplay: ${renderAbility(def, ctx).join(' | ')}`).toBeGreaterThan(0);
          pos += taken;
        }
        expect(pos, `${ex.name}: every Oracle line is covered by an ability`).toBe(lines.length);
      }
    });
  }
});
