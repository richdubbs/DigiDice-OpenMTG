/**
 * FAST5X E19: the template data of parser/templates/zz-fast5x/e19.json and the parser and renderer readings E19 needed (design 6.8 G6):
 *  - conditions (parser/holes/cond.ts, render/cond.ts): "five or more mana was spent to cast that spell", "at least four mana was spent to cast it" (opus,
 *    CR 601.2h, 207.2c), "mana from a Treasure was spent to cast it" (CR 106.3), "you have six or more unspent mana" (CR 106.4);
 *  - "Y. If C, X instead." with another instruction X when C is the triggering spell's mana (render/self-replacement.ts#isFixedChoice, CR 614.15);
 *  - the anaphora: "~" of a permanent's triggered ability is never "that spell" or "that card" (CR 201.5), the caster of "Whenever you cast" is never "that
 *    player" (CR 109.5).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or
 * parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e19 from '../../../src/parser/templates/zz-fast5x/e19.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e19-review.json';

const E19 = e19 as Template[];
const OPTS = defaultParseOptions();

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(~|(When|Whenever|At|As long|You don't|If you would|Flying|Trample|Vigilance|Reach)\b)/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const first = (text: string, type?: string): Record<string, unknown> => parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as Record<string, unknown>;
const steps = (text: string, type?: string): unknown => (first(text, type) as { effect?: { steps: unknown[] } }).effect?.steps;
const gateOk = (text: string, type?: string): boolean => { const f = parsed(text, type); return fullyAutomated(f) && f.gate.every((g) => g.ok); };

describe('E19 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e19.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e19.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E19) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.e19\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E19 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    // the local index prints these sentences on these cards only (npm run cards -- snapshot, FAST5X E19)
    const WHOLE_CORPUS: Record<string, string[]> = {
      'eff.e19.token.forEach.manaFrom': ['Bat Colony', 'Marut'],
      'sta.e19.mana.becomes.color': ['Ozai, the Phoenix King', 'Omnath, Locus of All'],
      'sta.e19.pump.unspentMana.color': ['Omnath, Locus of Mana'],
      'sta.e19.pump.unspentMana': ['Omnath, Locus of the Void'],
      'eff.e19.mana.keep.color.untilEndOfTurn': ['The Last Agni Kai'], // std-rx4: promoted (its one card in the index, 2026-10-11)
    };
    for (const t of E19.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`${t.id})`) || g.verified.includes(`${t.id};`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E19) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'would']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('E19 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E19) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const one = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(one.abilities), c).toBe(false);
      }
    });
  }
});

describe('E19 conditions and riders: what the readings mean, and that they pass the render gate', () => {
  const OPUS = 'Whenever you cast an instant or sorcery spell, ~ gets +1/+1 until end of turn. If six or more mana was spent to cast that spell, put two +1/+1 counters on ~ instead.';
  it('CR 601.2h: "N or more mana was spent to cast that spell" is the triggering spell\'s mana, compared with N', () => {
    const s = steps(OPUS) as { op: string; cond?: unknown; then?: unknown[]; else?: unknown[] }[];
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ op: 'if', cond: { cond: 'compare', left: { q: 'spellManaSpent', of: { ref: 'event', role: 'spell' } }, op: '>=', right: 6 } });
    expect(s[0]!.then).toEqual([{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 2 }]);
    expect((s[0]!.else as { op: string }[])[0]!.op).toBe('effect');
    expect(gateOk(OPUS)).toBe(true);
  });
  it('CR 603.4: "if at least four mana was spent to cast it" is an intervening if about the triggering spell', () => {
    const text = 'Whenever you cast a noncreature spell, if at least four mana was spent to cast it, you gain 2 life.';
    expect(first(text)['interveningIf']).toEqual({ cond: 'compare', left: { q: 'spellManaSpent', of: { ref: 'event', role: 'spell' } }, op: '>=', right: 4 });
    expect(gateOk(text)).toBe(true);
  });
  it('CR 106.3: "if mana from a Treasure was spent to cast it" is at least one mana of a Treasure', () => {
    const text = 'Whenever you cast a spell, if mana from a Treasure was spent to cast it, you gain 2 life.';
    expect(first(text)['interveningIf']).toEqual({ cond: 'compare', left: { q: 'spellManaSpent', of: { ref: 'event', role: 'spell' }, from: { subtypes: ['Treasure'] } }, op: '>=', right: 1 });
    expect(gateOk(text)).toBe(true);
  });
  it('CR 106.4: "as long as you have six or more unspent mana"', () => {
    const text = '~ has flying as long as you have six or more unspent mana.';
    expect(first(text)['condition']).toEqual({ cond: 'compare', left: { q: 'unspentMana' }, op: '>=', right: 6 });
    expect(gateOk(text)).toBe(true);
  });
  it('a bare number is never "at least" (no "five mana was spent"), and the mana of an object that is no spell is not read ("target creature")', () => {
    expect(fullyAutomated(parsed('Whenever you cast an instant or sorcery spell, ~ gets +1/+1 until end of turn. If five mana was spent to cast that spell, ~ gets +2/+2 until end of turn instead.'))).toBe(false);
    expect(fullyAutomated(parsed('When ~ enters, if four or more mana was spent to cast target creature, draw a card.'))).toBe(false);
  });
  it('CR 614.15: "instead" with another instruction only for the triggering spell\'s mana; with any other condition it stays manual (CLOUD C9: unless it acts on the same objects)', () => {
    // CLOUD C9 (CR 608.2c, 614.15): another instruction on exactly the objects the replaced one acts on (~ both times) replaces it whatever the condition
    // (render/self-replacement.ts#notWideReplacement); an instruction on something else still does not
    expect(fullyAutomated(parsed('Whenever you cast an instant or sorcery spell, ~ gets +1/+1 until end of turn. If you control a Wizard, put two +1/+1 counters on ~ instead.'))).toBe(true);
    expect(fullyAutomated(parsed('Whenever you cast an instant or sorcery spell, ~ gets +1/+1 until end of turn. If you control a Wizard, draw a card instead.'))).toBe(false);
  });
  it('CR 201.5, 109.5: "that card" after "~ gets +1/+0" is the exiled card; "that player" after "target player" in a cast trigger is the target', () => {
    const tide = steps('Whenever you cast an instant or sorcery spell, target player mills two cards. If six or more mana was spent to cast that spell, that player mills eight cards instead.') as { then: { who: unknown }[] }[];
    expect(tide[0]!.then[0]!.who).toEqual({ ref: 'target', id: 't0' });
  });
});

describe('E19 real cards (npm run cards -- try): full now', () => {
  it('opus and "mana was spent to cast it" (Standard)', () => {
    for (const name of ['Tackle Artist', 'Muse Seeker', 'Deluge Virtuoso', 'Thunderdrum Soloist', 'Colorstorm Stallion', 'Molten-Core Maestro', 'Spectacular Skywhale', 'Exhibition Tidecaller',
      'Expressive Firedancer', 'Blazing Bomb', 'Ultros, Obnoxious Octopus', 'Prompto Argentum', 'The Prima Vista', 'Chart a Course']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('mana from a source of a subtype and unspent mana', () => {
    for (const name of ['Bat Colony', 'Marut', "Alchemist's Talent", 'Ozai, the Phoenix King', 'Kruphix, God of Horizons', 'Horizon Stone', 'Omnath, Locus of the Void', 'Omnath, Locus of Mana']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('FAST5 T76: "If five or more mana was spent to cast that spell, exile the top card of your library. You may play that card until the end of your next turn." (Elemental Mascot) is full: the permission joins the condition\'s branch and "that card" is the exiled card (anaphora.ts#impulseIdiom)', () => {
    expect(compileCard(getCard('Elemental Mascot')).automation.level).toBe('full');
  });
  // r5-cost: Electro is full now ("you may pay {X}" at resolution, played in test/cloud/r5-cost/pay-at-resolution.test.ts; its golden entry raised)
  // std-rx4: The Last Agni Kai is full too (the excess damage's "add that much {R}", render/steps-cards.ts; eff.e19.mana.keep.color.untilEndOfTurn stable)
  it('Smaug\'s "where X is" is full since r4-fxb; The Last Agni Kai since std-rx4', () => {
    expect(compileCard(getCard('Smaug, Wicked Worm')).automation.level).toBe('full');
    for (const name of ['The Last Agni Kai']) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
});
