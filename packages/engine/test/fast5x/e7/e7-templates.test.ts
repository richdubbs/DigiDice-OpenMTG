/**
 * FAST5X E7: the template data of parser/templates/zz-fast5x/e7.json and the parser and renderer readings sneak and web-slinging needed (design 6.8 G6):
 *  - the conditions "~'s sneak cost was paid" / "his sneak cost was paid" and "~ was cast using web-slinging" / "they were cast using web-slinging"
 *    (parser/holes/cond.ts#altCostPaid): the spell, or the spell the permanent was, was cast for that alternative cost (`wasCast.via`, CR 607.2i-j, 400.7d,
 *    702.190b, 702.188a); a pronoun reads only when it names the object itself (`$self`, as "it was kicked");
 *  - the rider "If C, they enter tapped and attacking." after a token creation (CR 614.15, 508.4; render/steps-flow.ts#tokensEnterAttacking).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse
 * or parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e7 from '../../../src/parser/templates/zz-fast5x/e7.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e7-review.json';

const E7 = e7 as Template[];
const OPTS = defaultParseOptions();

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Instant');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const ability = (text: string, type?: string): Record<string, unknown> => parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as Record<string, unknown>;

describe('E7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e7.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e7.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E7) {
      expect(t.id, t.id).toMatch(/^(eff|rid|sta)\.e7\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E7 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    // The Last Ronin's Technique is the only card of the local index that prints "If ..., they enter tapped and attacking." after a token creation
    const WHOLE_CORPUS: Record<string, string[]> = { 'rid.e7.tokens.enter.attacking': ["The Last Ronin's Technique"] };
    for (const t of E7.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E7) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('E7 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E7) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('E7 lowering: what the shapes mean', () => {
  const SNEAK = { cond: 'wasCast', via: 'sneak' };
  const WEB = { cond: 'wasCast', via: 'web-slinging' };
  const ENTERS = { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] };

  it('CR 702.190b, 603.4: "if his / her / its / their sneak cost was paid" is the intervening "if" of the object\'s own enters trigger', () => {
    for (const p of ['his', 'her', 'its', 'their']) {
      const a = ability(`When ~ enters, if ${p} sneak cost was paid, draw a card.`);
      expect(a['trigger'], p).toEqual(ENTERS);
      expect(a['interveningIf'], p).toEqual(SNEAK);
      expect(fullyAutomated(parsed(`When ~ enters, if ${p} sneak cost was paid, draw a card.`)), p).toBe(true);
    }
  });
  it('CR 702.188a, 603.4: "if they were cast using web-slinging" and "if ~ was cast using web-slinging"', () => {
    expect(ability('When ~ enters, if they were cast using web-slinging, draw a card.')['interveningIf']).toEqual(WEB);
    expect(ability('When ~ enters, if it was cast using web-slinging, draw a card.')['interveningIf']).toEqual(WEB);
    expect(ability('When ~ enters, if ~ was cast using web-slinging, draw a card.')['interveningIf']).toEqual(WEB);
    // the verb must agree: "they was" / "it were" are no reading
    expect(fullyAutomated(parsed('When ~ enters, if it were cast using web-slinging, draw a card.'))).toBe(false);
  });
  it('CR 702.190b: "If ~\'s sneak cost was paid, ..." in a spell reads the spell\'s own cast record', () => {
    const a = ability("Draw a card. If ~'s sneak cost was paid, draw two cards instead.") as { effect?: { steps: unknown[] } };
    expect(a.effect?.steps).toEqual([{ op: 'if', cond: SNEAK, then: [{ op: 'draw', who: { ref: 'you' }, count: 2 }], else: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }]);
  });
  it('a pronoun that names something else than the object is no reading (design 6.4): it stays manual', () => {
    expect(fullyAutomated(parsed('Whenever another creature you control enters, if its sneak cost was paid, draw a card.'))).toBe(false);
  });
  it('CR 614.15, 508.4: "If C, they enter tapped and attacking." is the same token creation, tapped and attacking when C holds', () => {
    const token = { types: ['Creature'], subtypes: ['Warrior'], colors: ['R'], power: 2, toughness: 2 };
    const create = { op: 'createToken', who: { ref: 'you' }, token, count: 2 };
    const a = ability("Create two 2/2 red Warrior creature tokens. If ~'s sneak cost was paid, they enter tapped and attacking.") as { effect?: { steps: unknown[] } };
    expect(a.effect?.steps).toEqual([{ op: 'if', cond: SNEAK, then: [{ ...create, tapped: true, attacking: true }], else: [create] }]);
  });
});

describe('E7 real cards (npm run cards -- try)', () => {
  it('the cards whose only blockers were sneak, web-slinging and their conditions compile full', () => {
    for (const name of ['Leonardo, Leader in Blue', 'Spiders-Man, Heroic Horde', "The Last Ronin's Technique", 'Foot Ninjas', 'Spider-Man, Web-Slinger']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
});
