/**
 * FAST5X E5: the activation restrictions of the Standard mana lands, read by the activation lowering (parser/lower/activation.ts) and the Cond hole.
 *
 *   CR 602.5b   "Activate only if you control a Plains or a Swamp" (the Verges): one permanent of either description
 *   CR 602.5b   "Activate only if this land entered this turn or if you control a basic land" (Gathering Place, Dark Fortress, Hidden Lair, ...): either
 *               condition; "this land entered this turn" is the object itself (CR 400.7), read when the ability is activated
 *   CR 605.1a   such a mana ability is automated (full) only because rules/mana.ts now checks the restriction
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type ActivatedAbilityDef, type CardDef, type OracleCard } from '../../../src/index';

function card(name: string, type: string, text: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '', type_line: type, oracle_text: text, colors: [] } as unknown as OracleCard);
}
const mana = (c: CardDef, i: number): ActivatedAbilityDef => c.faces[0]!.abilities[i] as ActivatedAbilityDef;
const levelOf = (c: CardDef): string => c.automation.level;
// FAST5 batch 2 merge: "this land entered this turn" is the history reading E9 shares (parser/holes/cond.ts#enteredSelf), read at announcement too
const SELF_ENTERED = { cond: 'happened', event: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, scope: 'turn' };

describe('CR 602.5b: "Activate only if you control a <x> or a <y>"', () => {
  it('two subtypes are one list of subtypes (as "enters tapped unless you control a Desert or a Cave"); the card is full', () => {
    const c = card('Test Verge', 'Land', '{T}: Add {B}.\n{T}: Add {W}. Activate only if you control a Plains or a Swamp.');
    expect(mana(c, 1).onlyIf).toEqual({ cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Plains', 'Swamp'], controller: 'you' } } });
    expect(levelOf(c)).toBe('full');
  });

  it('other descriptions are the filter\'s anyOf (render family either-exists)', () => {
    const c = card('Test Either', 'Land', '{T}: Add {W}. Activate only if you control an artifact or an enchantment.');
    expect(mana(c, 0).onlyIf).toEqual({ cond: 'exists', of: { ref: 'each', filter: { controller: 'you', anyOf: [{ types: ['Artifact'] }, { types: ['Enchantment'] }] } } });
    expect(levelOf(c)).toBe('full');
  });

  it('counter-example: a count is not this shape and stays the controller\'s attestation (not automated)', () => {
    const text = '{T}: Add {W}. Activate only if you control a Plains or two Swamps.';
    expect(levelOf(card('Test Not Verge', 'Land', text)), text).not.toBe('full');
  });

  it('a second subject keeps its own reading: two existence conditions, either of which allows it (the Cond chain)', () => {
    const c = card('Test Two Subjects', 'Land', '{T}: Add {W}. Activate only if you control a Plains or an opponent controls a Swamp.');
    expect(mana(c, 0).onlyIf).toEqual({
      cond: 'any', of: [
        { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Plains'], controller: 'you' } } },
        { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Swamp'], controller: 'opponent' } } },
      ],
    });
  });
});

describe('CR 602.5b, 400.7: "Activate only if this land entered this turn or if you control a basic land"', () => {
  it('reads as either condition: the land itself entered this turn, or you control a basic land; the card is full', () => {
    const c = card('Test Gathering', 'Land', '{T}: Add {C}.\n{T}: Add {G} or {W}. Activate only if this land entered this turn or if you control a basic land.');
    expect(mana(c, 1).onlyIf).toEqual({
      cond: 'any', of: [
        SELF_ENTERED,
        { cond: 'exists', of: { ref: 'each', filter: { supertypes: ['Basic'], types: ['Land'], controller: 'you' } } },
      ],
    });
    expect(levelOf(c)).toBe('full');
  });

  it('"Activate only if this land entered this turn" alone is the object itself', () => {
    const c = card('Test Fresh', 'Land', '{T}: Add {G}. Activate only if this land entered this turn.');
    expect(mana(c, 0).onlyIf).toEqual(SELF_ENTERED);
    expect(levelOf(c)).toBe('full');
  });

  it('counter-example: "if X and if Y" is not "or if" and stays the controller\'s attestation', () => {
    const c = card('Test Both', 'Land', '{T}: Add {G}. Activate only if this land entered this turn and if you control a basic land.');
    expect(levelOf(c)).not.toBe('full');
  });
});

describe('CR 107.3a, 608.2h: a mana ability whose effect reads what its cost paid stays manual (no stack object keeps the paid cost)', () => {
  for (const text of [
    "{T}, Sacrifice an artifact: Add an amount of {B} equal to the sacrificed artifact's mana value.",
  ]) {
    it(text, () => {
      const c = card('Test Reader', 'Artifact Creature — Golem', text);
      expect(c.automation.level).not.toBe('full');
    });
  }
  // p2-mana-1 (CR 107.3a, 601.2b, 602.2b): an X that is only the number of counters ONE part removes from ~ is announced as the mana ability is activated and kept for
  // its production (rules/mana.ts#counterXPart, effects/mana-ability.ts `manaX`; played in test/cloud/p2-mana-1/p2-mana-1-scenarios.test.ts)
  it('{T}, Remove X +1/+1 counters from this creature: Add X mana of any one color. (automated since p2-mana-1: X is announced)', () => {
    expect(card('Test Reader', 'Artifact Creature — Golem', '{T}, Remove X +1/+1 counters from this creature: Add X mana of any one color.').automation.level).toBe('full');
  });
});
