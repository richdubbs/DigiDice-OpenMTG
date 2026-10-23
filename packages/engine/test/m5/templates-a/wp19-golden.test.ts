/**
 * WP19 golden cards (design 15.2 WP19: "golden: Blood Artist, FTK, Mana Vault, Rhystic Study triggers"; design 13.3).
 *
 * The expected JSON is read from the design document itself (test/m5/model/examples.ts: section 13, no second copy). Each card's text is the `text` of its
 * abilities there (with "~"), on a face with the card's type line; when the local Oracle index exists the real card is parsed too and must give the same.
 * The trigger of every triggered ability (and its intervening "if", CR 603.4) must equal the design exactly. Where the effect needs templates of other
 * packages (WP20 life, WP21 untap, WP23 "may pay"), they are test stand-ins (support.ts#STANDINS) and the whole ability must equal the design.
 *
 * Known gap (not WP19's): Mana Vault's draw-step trigger "if ~ is tapped, it deals 1 damage to you" keeps a manual effect, because the lowering pass
 * does not offer the intervening "if"'s mention of ~ as an antecedent of "it" (WP17, lower/scope.ts); its trigger and intervening "if" are checked here.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, TriggeredAbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import { EXAMPLES } from '../model/examples';
import { automated, bare, card, face, localIndex, options, STANDINS } from './support';

const TYPE_LINES: Record<string, string> = {
  'Blood Artist': 'Creature — Vampire',
  'Flametongue Kavu': 'Creature — Kavu',
  'Mana Vault': 'Artifact',
  'Rhystic Study': 'Enchantment',
};

/** The rules each golden card pins (test names, design 15.1.4). */
const RULES: Record<string, string> = {
  'Blood Artist': 'CR 603.6c, 603.10a, 700.4: "~ or another creature dies" is one leaves-the-battlefield trigger that looks back in time',
  'Flametongue Kavu': 'CR 603.6a: an enters trigger; "it" is the object with the ability',
  'Mana Vault': 'CR 603.2b, 603.4: beginning-of-step triggers and an intervening "if"',
  'Rhystic Study': 'CR 601.2i, 118.12a: a cast trigger; the payer decides before the "may"',
};

const designAbilities = (name: string): AbilityDef[] => EXAMPLES.find((e) => e.name === name)!.faces[0]!.abilities;
const designCard = (name: string): OracleCard => card(name, TYPE_LINES[name]!, designAbilities(name).map((a) => a.text).join('\n'));
const opts = options(STANDINS);
const triggered = (defs: readonly AbilityDef[]): TriggeredAbilityDef[] => defs.filter((a): a is TriggeredAbilityDef => a.kind === 'triggered');
/**
 * Index of the design's abilities that must equal the design as a whole: those whose effect the bootstrap, WP19 and the stand-ins cover. Not Mana Vault's draw-step
 * trigger (see above), and not Blood Artist: its target spec gets `players: {who: 'any'}` from the Player hole (WP6), which the design JSON does not
 * write; its steps are compared below.
 */
const WHOLE: Record<string, number[]> = { 'Blood Artist': [], 'Flametongue Kavu': [0], 'Mana Vault': [1], 'Rhystic Study': [0] };

const index = localIndex();

describe('WP19 golden cards: the triggers of design section 13.3', () => {
  for (const name of Object.keys(TYPE_LINES)) {
    it(`${RULES[name]} (${name})`, () => {
      const design = designAbilities(name);
      const f = face(designCard(name), opts);
      expect(f.abilities).toHaveLength(design.length);
      const want = design.map((a, i) => ({ a, i })).filter((x) => x.a.kind === 'triggered');
      expect(want.length).toBeGreaterThan(0);
      for (const { a, i } of want) {
        const got = f.abilities[i]!;
        expect(got.kind, `${name} #${i}: ${JSON.stringify(got)}`).toBe('triggered');
        const g = got as TriggeredAbilityDef;
        const d = a as TriggeredAbilityDef;
        expect(g.trigger, `${name} #${i}`).toEqual(d.trigger);
        expect(g.interveningIf, `${name} #${i}`).toEqual(d.interveningIf);
      }
      for (const i of WHOLE[name]!) {
        expect(bare([f.abilities[i]!])[0], `${name} #${i}`).toEqual(design[i]);
        expect(automated([f.abilities[i]!]), `${name} #${i}`).toBe(true);
        expect(f.gate[i]!.ok, `${name} #${i}: ${JSON.stringify(f.gate[i])}`).toBe(true);
      }
    });
  }

  it('Blood Artist: the steps are those of the design (CR 119.3, 608.2c)', () => {
    const t = triggered(face(designCard('Blood Artist'), opts).abilities)[0]!;
    expect(t.effect.steps).toEqual((designAbilities('Blood Artist')[0] as TriggeredAbilityDef).effect.steps);
    expect(t.effect.targets.map((x) => x.kind)).toEqual(['player']);
  });

  it('Blood Artist: the merged subject is printed only for a creature (the render gate refuses it on a noncreature face, CR 700.4)', () => {
    const f = face(card('Example Totem', 'Artifact', 'Whenever ~ or another creature dies, draw a card.'), opts);
    expect(automated(f.abilities) && f.gate.every((g) => g.ok)).toBe(false);
  });

  it('Rhystic Study: the "pay" node is outside the "may" node (CR 118.12a, design D3)', () => {
    const t = triggered(face(designCard('Rhystic Study'), opts).abilities)[0]!;
    expect(t.effect.steps[0]).toMatchObject({ op: 'pay', who: { ref: 'event', role: 'player' }, else: [{ op: 'may', who: { ref: 'you' } }] });
  });

  it('Mana Vault: "you may pay {4}. If you do, untap ~." folds into one pay step through the lead-in "if" template (CR 118.12, cond.if)', () => {
    const f = face(designCard('Mana Vault'), opts);
    expect(f.templatesUsed).toContain('cond.if');
    expect(triggered(f.abilities)[0]!.effect.steps).toEqual([{ op: 'pay', who: { ref: 'you' }, cost: { mana: [{ kind: 'generic', amount: 4 }] }, then: [{ op: 'untap', what: { ref: 'self' } }] }]);
  });
});

describe.skipIf(index === null)('WP19 golden cards from the local Oracle index give the same triggers', () => {
  it('the real Oracle text of each golden card parses to the triggers of the design', () => {
    for (const name of Object.keys(TYPE_LINES)) {
      const c = index!.find((x) => x.name === name);
      expect(c, name).toBeDefined();
      const got = triggered(face(c!, opts).abilities).map((a) => ({ trigger: a.trigger, interveningIf: a.interveningIf }));
      const want = triggered(designAbilities(name)).map((a) => ({ trigger: a.trigger, interveningIf: a.interveningIf }));
      expect(got, name).toEqual(want);
    }
  });
});
