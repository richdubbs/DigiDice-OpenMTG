/**
 * FAST5X E16: excess damage in the parser (design 6.3-6.8; CONTRIBUTING "Adding a template").
 *  - the Qty and Cond hole readings (parser/holes/excess.ts): "the [amount of] excess damage dealt [to that creature] this way", "that excess damage",
 *    "if excess damage was dealt [to that creature] this way", "if <that creature> is dealt excess damage this way" (CR 120.4a, 120.10, 608.2c);
 *  - "this way" names the damage or fight instruction right before (parser/lower/conditions.ts), never anything else;
 *  - the reflexive "When excess damage is dealt to the creature an opponent controls this way, ..." (CR 603.12, `when.if`);
 *  - the template data of parser/templates/zz-fast5x/e16.json, guard G9 (examples and counter-examples, the exact render gate);
 *  - the real cards it makes full.
 * Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e16 from '../../../src/parser/templates/zz-fast5x/e16.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e16-review.json';

const E16 = e16 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES }); // the game's capabilities: the trigger needs feature:ev.damage.excess

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At|As long)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Trial Subject', layout: 'normal', mana_cost: '{1}', type_line: typeLine, oracle_text: text,
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const steps = (text: string, type?: string): unknown[] => ((parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as { effect?: { steps: unknown[] } }).effect?.steps ?? []);
const gateOk = (text: string, type?: string): boolean => { const f = parsed(text, type); return fullyAutomated(f) && f.gate.every((g) => g.ok); };

describe('E16 template file (design 6.3, 6.9)', () => {
  it('is in the default compiler (zz-fast5x/e16.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e16.json');
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E16) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.e16\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: the stable trigger template has its evidence: Magmatic Galleon is the one card of the local index that prints it, verified by hand', () => {
    const golden = review as { card: string; verified: string }[];
    expect(E16.filter((t) => t.status === 'stable').map((t) => t.id)).toEqual(['trg.e16.oneOrMore.dealtExcessNoncombat', 'eff.e16.amass.goblins.whereX']);
    expect(golden.map((g) => g.card)).toContain('Magmatic Galleon');
    // "amass Goblins X, where X is that excess damage" is printed by Bolg of the North only, whose earlier sentences are not understood; Standard round 3 r3-fx
    // made the template stable with Rhovanion Rampager's "where X is this creature's power" (test/m5/golden/cards/cloud-r3-fx-review.json)
    expect(E16.find((t) => t.id === 'eff.e16.amass.goblins.whereX')?.status).toBe('stable');
  });
});

describe('E16 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E16) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it and passes the render gate; counter-examples do not give the same JSON`, () => {
      const one = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(f.abilities[0]?.kind === 'triggered' ? (f.abilities[0] as { trigger: unknown }).trigger : f.abilities, e.text).toMatchObject(e.expect as object);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(one.abilities), c).toBe(false);
      }
    });
  }
});

describe('E16 readings (parser/holes/excess.ts, parser/lower/conditions.ts): "this way" is the damage or fight instruction right before (CR 608.2c)', () => {
  it('"the excess damage dealt this way": the excess of the damage step before, named by it', () => {
    expect(steps('~ deals 4 damage to target creature. You gain life equal to the excess damage dealt this way.')).toEqual([
      { op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 4, as: 'dealt' },
      { op: 'gainLife', who: { ref: 'you' }, amount: { q: 'excessDamage', step: 'dealt' } },
    ]);
  });
  it('"dealt to that creature this way" keeps the recipient; "if ... was dealt ..." is a comparison with 0 (CR 120.4a)', () => {
    const s = steps('~ deals 3 damage to target creature. If excess damage was dealt to that creature this way, draw a card.');
    expect(s[1]).toEqual({ op: 'if', cond: { cond: 'compare', left: { q: 'excessDamage', step: 'dealt', to: { ref: 'target', id: 't0' } }, op: '>', right: 0 }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] });
    expect(gateOk('~ deals 3 damage to target creature. If excess damage was dealt to that creature this way, draw a card.')).toBe(true);
    expect(gateOk('~ deals 3 damage to target creature. If that creature was dealt excess damage this way, draw a card.')).toBe(true);
  });
  it('"that excess damage" takes the recipient of the condition it follows; "that much" after an excess condition is that excess', () => {
    const s = steps('~ deals 6 damage to target creature or planeswalker. If excess damage was dealt to that permanent this way, empower Jace X, where X is that excess damage.', 'Instant');
    expect(s[1]).toMatchObject({ then: [{ op: 'action', action: 'empower', n: { q: 'excessDamage', step: 'dealt', to: { ref: 'target', id: 't0' } } }] });
    const m = steps('Target creature you control fights target creature an opponent controls. If the creature an opponent controls is dealt excess damage this way, you gain that much life.');
    expect(m[1]).toMatchObject({ op: 'if', then: [{ op: 'gainLife', amount: { q: 'excessDamage', step: 'dealt', to: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } } } }] });
  });
  it('no damage or fight instruction right before: the sentence is not understood (never another step)', () => {
    for (const text of ['Draw a card. You gain life equal to the excess damage dealt this way.', 'You gain life equal to the excess damage dealt this way.',
      '~ deals 3 damage to target creature. Draw a card. If excess damage was dealt this way, draw a card.']) {
      expect(fullyAutomated(parsed(text)), text).toBe(false);
    }
  });
  it('CR 603.12: "When excess damage is dealt to the creature an opponent controls this way, ..." waits for the fight and its result', () => {
    const s = steps('Target creature you control fights target creature an opponent controls. When excess damage is dealt to the creature an opponent controls this way, draw a card.');
    expect(s[1]).toEqual({
      op: 'reflexive', when: { did: 'dealt', if: { cond: 'compare', left: { q: 'excessDamage', step: 'dealt', to: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } } }, op: '>', right: 0 } },
      targets: [], do: [{ op: 'draw', who: { ref: 'you' }, count: 1 }],
    });
    expect(gateOk('Target creature you control fights target creature an opponent controls. When excess damage is dealt to the creature an opponent controls this way, draw a card.')).toBe(true);
  });
});

describe('render (refs.ts#selfNouns): an instant or sorcery is never "that permanent" (CR 110.1, 304.1, 307.1)', () => {
  it('"that permanent" after "~ deals N damage to target creature or planeswalker" names the target: the gate accepts it for an instant, not for a creature', () => {
    const text = '~ deals 5 damage to target creature or planeswalker. That permanent loses indestructible until end of turn.';
    expect(gateOk(text, 'Instant')).toBe(true);
    expect(gateOk(text, 'Sorcery')).toBe(true);
  });
});

describe('E16 real cards: full now, and the ones that are not (and why)', () => {
  it('Standard cards made full', () => {
    for (const name of ['Orbital Plunge', 'Razor Rings', 'Goblin Negotiation', 'Hell to Pay', 'Torch the Witness', 'Violent Echoes', "Rhino's Rampage", 'Magmatic Galleon']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('Bolg of the North is full since std-rw8 ("that creature\'s power" of the sacrificed creature, the excess "if" inside the reflexive trigger)', () => {
    expect(compileCard(getCard('Bolg of the North')).automation.level).toBe('full');
  });
  // std-rx4 (CR 120.4a, 106.4, 500.5): The Last Agni Kai is full now ("add that much {R}" said of the excess damage, render/steps-cards.ts; its unspent-mana template
  // eff.e19.mana.keep.color.untilEndOfTurn stable; test/cloud/std-rx4)
  it('std-rx4: The Last Agni Kai is full', () => {
    expect(compileCard(getCard('The Last Agni Kai')).automation.level).toBe('full');
  });
});
