/**
 * WP20 review fixes, each pinned by a test named after the rule it protects.
 *
 *  1. Anaphora inside a counted filter (CR 608.2c, design 6.4). "Each opponent loses 1 life for each creature they control": "they" is each opponent in
 *     turn, so an enters trigger's event player (the controller of the entering permanent) is not the unique candidate. "Draw a card for each creature you
 *     control with toughness greater than its power": "its" is each counted creature, not the source. Both readings stay manual (WP17 INTERFACE CHANGE in
 *     parser/lower/anaphora.ts) instead of being automated with the wrong binding.
 *  2. "Other" in the recipient of a damage step whose source is another object (CR 608.2c): "Target creature you control deals damage equal to its power to
 *     each other creature" means other than that creature; rules/filter.ts reads `other` as "not this ability's source", so the reading stays manual
 *     (WP17 INTERFACE CHANGE in parser/lower/normalize.ts).
 *  3. Mana abilities the native path cannot run as written (CR 602.5b, 602.5d, 605.1a, 605.3a): activation restrictions and costs other than {T}, {Q} and
 *     sacrificing the source itself are not checked or paid by rules/mana.ts, so such an ability needs `feature:mana.activation` / `feature:mana.cost`
 *     (WP1 file model/cap-walk.ts, extending WP20's INTERFACE CHANGE 2) and is offered by hand instead of being automated and wrong (or unusable).
 *     FAST5X E5: rules/mana.ts now checks the restrictions (CR 605.1a, 602.5b, 602.5d) and pays the other costs (CR 605.3a, 118.3), so those abilities are full;
 *     the gaps left are an attested restriction (`ask`), another zone (CR 113.6) and a cost the build can't pay (an {X}, a loyalty cost, a manual part).
 *  4. A link no ability of the card produces (CR 607.1): "spend this mana only to cast a creature spell of the chosen type" reads link "type"; when the
 *     "choose a creature type" sentence is not understood, the consumer reads nothing and is tainted manual (WP1 file model/degrade-card.ts).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import { parseCard } from '../../../src/parser/parse';
import { ENGINE_CAPABILITIES, capabilitiesOf, missingCapabilities } from '../../../src/model/capabilities';
import { classifyAbility } from '../../../src/model/classify';
import { degradeAbilities } from '../../../src/model/degrade-card';
import { NEIGHBORS, WP20, automated, bare, options, parseExample } from './support';

const opts = options(NEIGHBORS);
const abilitiesOf = (typeLine: string, text: string): AbilityDef[] =>
  parseCard({ name: 'Example Warden', layout: 'normal', type_line: typeLine, oracle_text: text } as OracleCard, opts).faces[0]!.abilities;

/** Every object reference in a filter of the abilities (anywhere under a `filter` key). */
function filterRefs(v: unknown, inFilter = false, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => filterRefs(x, inFilter, out));
  else if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (inFilter && typeof o['ref'] === 'string') out.push(String(o['ref']));
    for (const [k, x] of Object.entries(o)) filterRefs(x, inFilter || k === 'filter', out);
  }
  return out;
}

describe('CR 608.2c, design 6.4: a pronoun inside a counted filter is never bound to the trigger event or to the source', () => {
  const creature = 'Creature — Human Soldier';
  for (const text of [
    'When ~ enters, each opponent loses 1 life for each creature they control.',
    'When ~ enters, each player gains 1 life for each creature they control.',
    'When ~ enters, each opponent loses 1 life for each artifact that player controls.',
  ]) {
    it(`CR 608.2c: "${text}" ("they" is each player in turn) is not automated with the event player`, () => {
      const defs = abilitiesOf(creature, text);
      expect(filterRefs(defs), JSON.stringify(bare(defs))).not.toContain('event');
      expect(automated(defs), JSON.stringify(bare(defs))).toBe(false);
    });
  }

  for (const text of [
    'When ~ enters, you gain 1 life for each creature you control with power greater than its toughness.',
    'When ~ enters, it deals 1 damage to any target for each creature you control with toughness greater than its power.',
  ]) {
    it(`CR 608.2c: "${text}" ("its" is each counted creature) is not automated with the source`, () => {
      const defs = abilitiesOf(creature, text);
      expect(filterRefs(defs), JSON.stringify(bare(defs))).not.toContain('self');
      expect(automated(defs), JSON.stringify(bare(defs))).toBe(false);
    });
  }
  // Standard round 4, r4-trig (CR 208.1): "with toughness greater than its power" is read as each counted creature's own comparison (the filter
  // toughnessGreaterThanPower, parser/holes/filter.ts), never with the source: automated now, and still no `self` in the filter
  for (const text of [
    'When ~ enters, draw a card for each creature you control with toughness greater than its power.',
  ]) {
    it(`CR 608.2c, 208.1: "${text}" ("its" is each counted creature) is automated with each creature's own statistics, never the source's`, () => {
      const defs = abilitiesOf(creature, text);
      expect(filterRefs(defs), JSON.stringify(bare(defs))).not.toContain('self');
      expect(JSON.stringify(bare(defs))).toContain('"toughnessGreaterThanPower":true');
      expect(automated(defs), JSON.stringify(bare(defs))).toBe(true);
    });
  }

  it('CR 608.2c: the readings that are right stay automated ("for each creature you control", "for each creature target player controls")', () => {
    expect(automated(abilitiesOf(creature, 'When ~ enters, each opponent loses 1 life for each creature you control.'))).toBe(true);
    expect(automated(abilitiesOf('Sorcery', 'Target player loses 1 life for each creature you control.'))).toBe(true);
  });
});

describe('CR 608.2c: "other" in the recipient of damage dealt by another object is not "other than this spell"', () => {
  it('CR 608.2c: "Target creature you control deals damage equal to its power to each other creature." is not automated (the creature would damage itself)', () => {
    const defs = abilitiesOf('Sorcery', 'Target creature you control deals damage equal to its power to each other creature.');
    expect(automated(defs), JSON.stringify(bare(defs))).toBe(false);
  });

  it('CR 608.2c: "Target creature you control deals 2 damage to each other creature you control." (the bootstrap subject-led template) is not automated either', () => {
    const defs = abilitiesOf('Sorcery', 'Target creature you control deals 2 damage to each other creature you control.');
    expect(automated(defs), JSON.stringify(bare(defs))).toBe(false);
  });

  it('CR 120.3: with ~ as the source, "each other creature" keeps its meaning (other than ~) and stays automated', () => {
    const defs = abilitiesOf('Creature — Elemental', 'When ~ enters, it deals 1 damage to each other creature.');
    expect(automated(defs), JSON.stringify(bare(defs))).toBe(true);
  });
});

describe('CR 602.5b, 602.5d, 605.1a, 605.3a: a mana ability is automated only when rules/mana.ts runs it as written', () => {
  const manaAbility = (typeLine: string, text: string): AbilityDef => {
    const a = abilitiesOf(typeLine, text).find((x) => x.kind === 'activated' && x.isMana === true);
    expect(a, `${text}: ${JSON.stringify(bare(abilitiesOf(typeLine, text)))}`).toBeDefined();
    return a!;
  };

  for (const [text, extra] of [
    ['{T}: Add {W}. Activate only if you control an Island.', 'onlyIf'],
    ['{T}: Add one mana of any color. Activate only once each turn.', 'limit'],
    ['{T}: Add {C}{C}. Activate only as a sorcery.', 'sorcerySpeed'],
  ] as const) {
    it(`CR 602.5b, 602.5d, 605.1a: "${text}" (${extra}) is checked by the native path (FAST5X E5) and classifies full`, () => {
      const a = manaAbility('Land', text);
      expect(a).toHaveProperty(extra);
      expect(missingCapabilities(a, ENGINE_CAPABILITIES)).toEqual([]);
      expect(classifyAbility(a, ENGINE_CAPABILITIES).level).toBe('full');
    });
  }

  for (const text of [
    '{1}, {T}: Add {C}{C}.',
    '{T}, Pay 2 life: Add one mana of any color.',
    'Sacrifice an artifact: Add {C}{C}{C}.',
    '{2}{R}: Add {B}.',
  ]) {
    it(`CR 605.3a, 118.3: "${text}" (a cost the native path pays since FAST5X E5) classifies full`, () => {
      const a = manaAbility('Artifact', text);
      expect(missingCapabilities(a, ENGINE_CAPABILITIES)).toEqual([]);
      expect(classifyAbility(a, ENGINE_CAPABILITIES).level).toBe('full');
    });
  }

  const units = { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['G']] }] };
  for (const [what, a, gap] of [
    ['an attested restriction (CR 602.5b: nobody is asked while mana abilities pay a cost)', { kind: 'activated', text: '{T}: Add {G}. Activate only if a test holds.', cost: { tap: true }, isMana: true, onlyIf: { cond: 'ask', text: 'a test holds' }, effect: units }, 'feature:mana.activation'],
    ['an {X} in the cost (CR 107.3a)', { kind: 'activated', text: '{X}, {T}: Add {G}.', cost: { tap: true, mana: [{ kind: 'variable' }] }, isMana: true, effect: units }, 'feature:mana.cost'],
    ['a cost part the build can\'t pay (a manual part, CR 118.3)', { kind: 'activated', text: '{T}, Do a thing: Add {G}.', cost: { tap: true, other: [{ kind: 'manual', text: 'Do a thing' }] }, isMana: true, effect: units }, 'feature:mana.cost'],
  ] as const) {
    it(`FAST5X E5: ${what} still needs ${gap} and is not automated`, () => {
      expect(missingCapabilities(a as unknown as AbilityDef, ENGINE_CAPABILITIES)).toContain(gap);
      expect(classifyAbility(a as unknown as AbilityDef, ENGINE_CAPABILITIES).level).not.toBe('full');
    });
  }

  it('CR 605.3b: {T} and sacrificing the source itself are paid natively: "{T}, Sacrifice ~: Add one mana of any color." stays full', () => {
    const a = manaAbility('Artifact', '{T}, Sacrifice ~: Add one mana of any color.');
    expect(missingCapabilities(a, ENGINE_CAPABILITIES)).toEqual([]);
    expect(classifyAbility(a, ENGINE_CAPABILITIES).level).toBe('full');
  });

  it('CR 113.6: a mana ability that functions from another zone (a hand-exiling cost) is not run natively', () => {
    const a: AbilityDef = {
      kind: 'activated', text: 'Exile ~ from your hand: Add {R}.', cost: { other: [{ kind: 'exileFrom', zone: 'hand', count: 1, self: true }] }, isMana: true, zone: ['hand'],
      effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['R']] }] },
    } as AbilityDef;
    expect(missingCapabilities(a, ENGINE_CAPABILITIES)).toEqual(expect.arrayContaining(['feature:mana.activation'])); // FAST5X E5: the exile cost itself is paid
  });
});

describe('WP20 templates name the wrong readings above as counter-examples, and none of them is automated (design 6.8 G9)', () => {
  const shapes: Record<string, string[]> = {
    'eff.loselife.foreach': ['When ~ enters, each opponent loses 1 life for each creature they control.'],
    'eff.gainlife.foreach': [
      'When ~ enters, each player gains 1 life for each creature they control.',
      'When ~ enters, you gain 1 life for each creature you control with power greater than its toughness.',
    ],
    'eff.draw.foreach.you': ['When ~ enters, draw a card for each creature you control with power greater than its toughness.'], // Standard round 4, r4-trig: the toughness form is read now (CR 208.1)
    'eff.damage.foreach': ['When ~ enters, it deals 1 damage to any target for each creature you control with toughness greater than its power.'],
    'eff.damage.equal': ['Target creature you control deals damage equal to its power to each other creature.'],
  };
  for (const [id, texts] of Object.entries(shapes)) {
    it(`CR 608.2c: ${id} lists ${texts.length} wrong-binding shape(s) as counter-examples, and they parse to no automated reading`, () => {
      const t = WP20.find((x) => x.id === id)!;
      for (const text of texts) {
        expect(t.counterExamples, id).toContain(text);
        const f = parseExample(text);
        expect(automated(f.abilities), `${text}: ${JSON.stringify(bare(f.abilities))}`).toBe(false);
      }
    });
  }
});


describe('CR 607.1: a mana spending restriction that reads a link no understood ability produces is not automated', () => {
  const pillar = 'As ~ enters, choose a creature type.\n{T}, Sacrifice ~: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.';
  const parsed = (o: ReturnType<typeof options>): AbilityDef[] =>
    parseCard({ name: 'Example Pillar', layout: 'normal', type_line: 'Artifact', oracle_text: pillar } as OracleCard, o).faces[0]!.abilities;
  /** Every capability the abilities need: only the links can degrade them. */
  const allOf = (defs: readonly AbilityDef[]): Set<string> => new Set(defs.flatMap((d) => capabilitiesOf(d)));
  const NO_LINES = { lines: [], sentences: [] };

  it('CR 607.1, 607.2d: without its "choose a creature type" producer, "spend this mana only to cast a creature spell of the chosen type" is tainted manual', () => {
    const abilities = parsed(options());
    const mana = abilities.find((a) => a.kind === 'activated');
    expect(mana, JSON.stringify(bare(abilities))).toBeDefined(); // the WP20 rider reads the link ...
    expect(abilities.some((a) => a.kind === 'manual'), JSON.stringify(bare(abilities))).toBe(true); // ... whose producer (WP22) is not understood here
    const degraded = degradeAbilities(abilities, allOf(abilities), NO_LINES).abilities;
    expect(automated(degraded.filter((a) => a.text === mana!.text)), JSON.stringify(bare(degraded))).toBe(false);
  });

  it('CR 607.2d: with its producer the same mana ability stays automated (the link is produced)', () => {
    const abilities = parsed(opts);
    const degraded = degradeAbilities(abilities, allOf(abilities), NO_LINES).abilities;
    expect(automated(degraded), JSON.stringify(bare(degraded))).toBe(true);
  });
});
