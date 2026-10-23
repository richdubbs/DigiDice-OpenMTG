/**
 * WP23 golden cards (design 15.2 WP23: "golden: Mana Leak, Rhystic Study, Smothering Tithe, Sneak Attack, Fiend Hunter, Memory Lapse, Pact of Negation,
 * Magma Spray"; plus Counterspell and Raise the Alarm). The expected JSON is read from the design document itself (test/m5/model/examples.ts: section 13,
 * no second copy); each card's text is the `text` of its abilities there (with "~"), on a face with the card's type line. Triggers come from the WP19
 * stand-in of support.ts. When the local Oracle index exists the real cards are parsed too, with the other cards that verify the WP23 templates whose
 * corpus count is low (design 6.9: three independently verified golden cards, or every corpus match verified).
 *
 * Two deviations from the design JSON, both in the shape and not in the meaning, are asserted explicitly:
 *   - Raise the Alarm: the token has no `name` (the TokenDesc hole of WP6 does not write one; CR 111.4 names a token after its subtypes, so it is the same token).
 *   - Sneak Attack: the hand filter also says `isCard` and the granted keyword's text is "haste" (both written by the WP6 holes); the chosen card is bound as `put` (the name the template writes) instead of `c`, and the haste grant and the delayed sacrifice carry no
 *     `guard: did`: with no card chosen the binding is empty and both act on nothing (design 3.1: an empty binding), which is what the guard said.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import { EXAMPLES } from '../model/examples';
import { automated, bare, card, face, localIndex, options, unit } from './support';

const TYPE_LINES: Record<string, string> = {
  Counterspell: 'Instant',
  'Mana Leak': 'Instant',
  'Memory Lapse': 'Instant',
  'Raise the Alarm': 'Instant',
  'Magma Spray': 'Instant',
  'Pact of Negation': 'Instant',
  'Fiend Hunter': 'Creature — Human Cleric',
  'Rhystic Study': 'Enchantment',
  'Smothering Tithe': 'Enchantment',
  'Sneak Attack': 'Enchantment',
};

/** The rules each golden card pins (test names, design 15.1.4). */
const RULES: Record<string, string> = {
  Counterspell: 'CR 701.6a: counter target spell',
  'Mana Leak': 'CR 118.12a: "X unless its controller pays" is one pay step with X as its else branch; the payer is the spell\'s controller',
  'Memory Lapse': 'CR 608.2c, 614.15: the "countered this way" rider folds into counter.to',
  'Raise the Alarm': 'CR 111.1, 111.2: create two tokens; you are their controller',
  'Magma Spray': 'design 6.7 E1: the damage is automated, the one-shot replacement is a manual step with a chip until end of turn',
  'Pact of Negation': 'CR 603.7, 118.12: a delayed trigger whose payment has an else branch',
  'Fiend Hunter': 'CR 607.2a: the exile and "the exiled card" are linked abilities',
  'Rhystic Study': 'CR 118.12a, design D3: the payer decides first, the "you may" is inside the else branch',
  'Smothering Tithe': 'CR 118.12: "that player may pay {2}. If the player doesn\'t, ..." is one pay step',
  'Sneak Attack': 'CR 603.7c, 400.7j: put a card onto the battlefield, grant haste, sacrifice it at the next end step (the delayed trigger captures it)',
};

const opts = options();
const designAbilities = (name: string): AbilityDef[] => EXAMPLES.find((e) => e.name === name)!.faces[0]!.abilities;
const designCard = (name: string): OracleCard => card(name, TYPE_LINES[name]!, designAbilities(name).map((a) => a.text).join('\n'));

/** The design JSON with the two documented deviations applied. */
function expected(name: string): unknown[] {
  let json = JSON.stringify(designAbilities(name));
  if (name === 'Raise the Alarm') json = json.replace('"name":"Soldier",', '');
  if (name === 'Sneak Attack') {
    // the Filter hole of WP6 states that the chosen object is a card (CR 400.7a: an object in a hand is a card); the Abilities hole writes keyword text lower case
    json = json.replace('"filter":{"zone":"hand","owner":"you","types":["Creature"]}', '"filter":{"zone":"hand","owner":"you","types":["Creature"],"isCard":true}').replace('"text":"Haste"', '"text":"haste"');
    const v = JSON.parse(json.replace(/"name":"c"/g, '"name":"put"').replace(/"as":"c"/g, '"as":"put"').replace(/"capture":\["c"\]/g, '"capture":["put"]')) as AbilityDef[];
    const strip = (x: unknown): unknown => (Array.isArray(x) ? x.map(strip) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'guard').map(([k, y]) => [k, strip(y)])) : x);
    return strip(v) as unknown[];
  }
  return JSON.parse(json) as unknown[];
}

/** Key order is not meaning: compare as canonical values. */
const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sorted(x)])) : v);

describe('WP23 golden cards: the JSON of design section 13 (with the documented deviations)', () => {
  for (const name of Object.keys(TYPE_LINES)) {
    it(`${RULES[name]} (${name})`, () => {
      const f = face(designCard(name), opts);
      expect(sorted(bare(f.abilities)), name).toEqual(sorted(expected(name)));
      expect(f.gate.every((g) => g.ok), `${name}: ${JSON.stringify(f.gate)}`).toBe(true);
      if (name !== 'Magma Spray') expect(automated(f.abilities), name).toBe(true);
    });
  }

  it('Magma Spray (design 14): the shield sentence is recognized as the milestone 6 shape, which this engine build lacks (needs-engine), and keeps its chip', () => {
    const f = face(designCard('Magma Spray'), opts);
    expect(f.diagnostics.some((d) => d.code === 'needs-engine' && d.message.includes('feature:shield.modify'))).toBe(true);
    expect(f.templatesUsed).toEqual(['eff.damage']);
  });

  it('Rhystic Study: the "pay" node is outside the "may" node (CR 118.12a, design D3), and no other nesting is offered', () => {
    const steps = (face(designCard('Rhystic Study'), opts).abilities[0] as { effect: { steps: unknown[] } }).effect.steps;
    expect(steps).toEqual([{ op: 'pay', who: { ref: 'event', role: 'player' }, cost: { mana: [{ kind: 'generic', amount: 1 }] }, else: [{ op: 'may', who: { ref: 'you' }, do: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] }]);
  });
});

describe('design D3: "you may X unless P pays C" never composes the choice of the controller first', () => {
  it('CR 118.12a: the one reading has the pay outside (bootstrap wrap.mayunless); the reading with the "may" outside is never built (chart.ts#mayAroundUnless)', () => {
    const r = unit('You may draw a card unless target opponent pays {1}.', 'effects');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect((r.derivation.value as { op: string }[])[0]!.op).toBe('pay');
    expect(r.derivation.templatesUsed).toContain('wrap.mayunless');
    expect(r.outranked.some((d) => (d.value as { op: string }[])[0]!.op === 'may')).toBe(false);
  });
});

/** Real cards that verify the WP23 templates (design 6.9), by the template they verify. */
const VERIFY: Record<string, string[]> = {
  'ch.pay': ['Pact of Negation', 'Slaughter Pact', 'Pact of the Titan', "Summoner's Pact"],
  'dl.yourNextUpkeep.lead': ['Pact of Negation', 'Slaughter Pact', 'Pact of the Titan'],
  'rid.countered.top': ['Memory Lapse', 'Lapse of Certainty'],
  'rid.countered.exile': ['Dissipate', 'Assert Authority', 'Deny the Divine'],
  'fl.linked.returnBattlefield': ['Fiend Hunter', 'Journey to Nowhere', 'Oblivion Ring'],
  'fl.loseGame': ['Pact of Negation', 'Slaughter Pact', 'Pact of the Titan'],
};

const index = localIndex();

describe.skipIf(index === null)('WP23 golden cards from the local Oracle index', () => {
  it('the real Oracle text of each design golden card parses to the same JSON as its design text', () => {
    for (const name of Object.keys(TYPE_LINES)) {
      const c = index!.find((x) => x.name === name);
      expect(c, name).toBeDefined();
      expect(sorted(bare(face(c!, opts).abilities, false)), name).toEqual(sorted(bare(face(designCard(name), opts).abilities, false)));
    }
  });

  for (const [id, names] of Object.entries(VERIFY)) {
    it(`design 6.9: ${id} is verified by ${names.join(', ')} (fully automated, gate passed, the template used)`, () => {
      for (const name of names) {
        const c = index!.find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const f = face(c!, opts);
        expect(f.templatesUsed, name).toContain(id);
        const used = f.abilities.filter((a, i) => f.gate[i]!.ok && automated([a]));
        expect(used.length, `${name}: ${JSON.stringify(f.abilities)}`).toBeGreaterThan(0);
      }
    });
  }

  it('Pact of the Titan, Slaughter Pact: the same delayed payment as Pact of Negation, with their own cost', () => {
    const delayOf = (n: string): unknown => (face(index!.find((x) => x.name === n)!, opts).abilities[0] as { effect: { steps: { op: string }[] } }).effect.steps.find((s) => s.op === 'delay');
    expect(delayOf('Slaughter Pact')).toEqual({ op: 'delay', when: { at: 'step', step: 'upkeep', whose: 'you', next: true }, do: [{ op: 'pay', who: { ref: 'you' }, cost: { mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'B' }] }, else: [{ op: 'loseGame', who: { ref: 'you' } }] }] });
    expect(delayOf('Pact of the Titan')).toMatchObject({ op: 'delay', do: [{ op: 'pay', cost: { mana: [{ kind: 'generic', amount: 4 }, { kind: 'colored', color: 'R' }] } }] });
  });
});
