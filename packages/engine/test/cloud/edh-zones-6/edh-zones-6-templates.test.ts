/**
 * edh-zones-6 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-6.json and the round's other changes: a quote inside a quote
 * (parser/front/quotes.ts, lower/quoted.ts), the filter field `manaCostIs` (parser/holes/filter.ts, rules/filter.ts, render/np.ts), the sentence that ends inside a closing
 * quote (render/steps.ts#quoteEnds), the spell line "If ~ would be put into a graveyard from anywhere" (parser/front/spellforms.ts). Guard G9 and G2 as the earlier rounds
 * run them; examples are synthetic (design 6.10). The behavior is in edh-zones-6-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones6 from '../../../src/parser/templates/zz-cloud/edh-zones-6.json';
import review from '../../m5/golden/cards/edh-zones-6-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ6 = edhZones6 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|^At the beginning|this creature|^\{/m.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);

const IDS = ['eff.edhz6.return.toHand.lead.target', 'eff.edhz6.put.bf.additionalCounters'];

describe('edh-zones-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-6.json, after zz-cloud/edh-zones-4.json, before zz-cloud/look3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-6.json');
    expect(files.indexOf('zz-cloud/edh-zones-6.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-4.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-6.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ6.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ6) {
      expect(t.id, t.id).toMatch(/^eff\.edhz6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
    // narrow wordings (one card of the index prints them as a whole line), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz6.return.toHand.lead.target')).toEqual(['Scrap Trawler']);
    expect(goldenUsing('eff.edhz6.put.bf.additionalCounters')).toEqual(['Neoform']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ6) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-6 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ6) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bonto the battlefield\b/, 'into their hand'], [/\bto your hand\b/, 'to your library'], [/\bin your graveyard\b/, 'in an opponent\'s graveyard'], [/\badditional\b/, 'fewer'], [/\+1\/\+1 counter/, '-1/-1 counter'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ6) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ6) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});


describe('edh-zones-6 a quote inside a quote (parser/front/quotes.ts, lower/quoted.ts; CR 113.1c, 201.5a)', () => {
  const saga = (ch2: string): string => `(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI — Draw a card.\nII — ${ch2}`;
  const inner = "This Saga gains \"{2}, {T}: Create a 0/0 colorless Golem artifact creature token with 'This token gets +1/+1 for each artifact you control.'\"";
  it('the opener of the inner quote may be followed by the blanks of a self reference ("This token"): the grant is full and its inner ability is the token\'s', () => {
    expect(level('Enchantment — Saga', saga(inner))).toBe('full');
    const j = json('Enchantment — Saga', saga(inner));
    expect(j).toContain('"text":"{2}, {T}: Create a 0/0 colorless Golem artifact creature token with \'This token gets +1/+1 for each artifact you control.\'"'); // the display text names it
    expect(j).toContain('"layer":"7c"');
  });
  it('near misses: an unclosed inner quote, an apostrophe and a quote that opens with no self reference stay what they were', () => {
    expect(level('Enchantment — Saga', saga(inner.replace(".'\"", ".\""))), 'unclosed inner quote').not.toBe('full');
    expect(level('Enchantment — Saga', saga("This Saga gains \"{2}, {T}: Create a 0/0 colorless Golem artifact creature token with 'Creatures you control get +1/+1.'\""))).toBe('full'); // no self reference: already read before this round
    expect(level('Enchantment — Saga', saga("This Saga gains \"{2}, {T}: Create a 0/0 colorless Golem artifact creature token with 'This token gets +1/+1 for each artifact you control\""))).not.toBe('full');
  });
});

describe('edh-zones-6 filter field manaCostIs (parser/holes/filter.ts#featureAt, rules/filter.ts, render/np.ts; CR 202.1, 202.1b)', () => {
  const s = (cost: string): string => `Search your library for an artifact card with mana cost ${cost}, put it onto the battlefield, then shuffle.`;
  it('"with mana cost {0} or {1}", one cost and a colored cost: a search filter of the printed cost, read back the same', () => {
    for (const c of ['{0} or {1}', '{1}', '{1}{G}', '{2} or {X}']) expect(level('Sorcery', s(c)), c).toBe('full');
    expect(json('Sorcery', s('{0} or {1}'))).toContain('"manaCostIs":["{0}","{1}"]');
    expect(json('Sorcery', s('{1}{G}'))).toContain('"manaCostIs":["{1}{G}"]');
  });
  it('near misses: "without", three costs, "or less", a word for a cost and "and" are not this reading', () => {
    for (const c of ['{0}, {1} or {2}', '{1} and {2}', '{1} or less', 'one', '{0} or']) expect(level('Sorcery', s(c)), c).not.toBe('full');
    expect(level('Sorcery', 'Search your library for an artifact card without mana cost {1}, put it onto the battlefield, then shuffle.')).not.toBe('full');
  });
});

describe('edh-zones-6 a sentence that ends inside the closing quote of an emblem (render/steps.ts#quoteEnds; CR 114.2)', () => {
  it('another sentence after it follows after a space: the emblem followed by one, two or a search is full', () => {
    expect(level('Sorcery', 'You get an emblem with "Lands you control have haste." You gain 1 life.')).toBe('full');
    expect(level('Sorcery', 'You gain 1 life. You get an emblem with "Lands you control have haste." You gain 1 life.')).toBe('full');
    expect(level('Sorcery', 'You get an emblem with "Creatures you control get +1/+1." Draw a card.')).toBe('full');
  });
  it('near misses: a following sentence that is not read is not full; the emblem for another player is read since edh-players-19 (its own template, the emblem owned by that player)', () => {
    // edh-players-19 (eff.edhp19.emblem.player; CR 114.2): "Target opponent gets an emblem with ..." creates the emblem for the target, whose "you" is that player
    expect(level('Sorcery', 'Target opponent gets an emblem with "Lands you control have haste." You gain 1 life.')).toBe('full');
    expect(level('Sorcery', 'You get an emblem with "Lands you control have haste." Blorfty the card.')).not.toBe('full');
  });
});

describe('edh-zones-6 the spell line "If ~ would be put into a graveyard from anywhere" (parser/front/spellforms.ts; CR 614.1a, 113.6b)', () => {
  const line = "If this spell would be put into a graveyard from anywhere, reveal this spell and shuffle it into its owner's library instead.";
  it('on an instant or a sorcery it is a static ability of its own, beside the spell ability', () => {
    expect(level('Sorcery', `Draw a card.\n${line}`)).toBe('full');
    expect(level('Instant', `Draw a card.\n${line}`)).toBe('full');
    expect(json('Sorcery', `Draw a card.\n${line}`)).toContain('"zone":["battlefield","stack","hand","library","exile"]');
  });
  it('near misses: another zone ("from the stack") and a destination other than the library are not this line', () => {
    expect(level('Sorcery', `Draw a card.\n${line.replace('from anywhere', 'from the stack')}`)).not.toBe('full');
    expect(level('Sorcery', `Draw a card.\n${line.replace("its owner's library", "its owner's hand")}`)).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-6 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = EZ6.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
