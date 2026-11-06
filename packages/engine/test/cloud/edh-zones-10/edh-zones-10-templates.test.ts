/**
 * edh-zones-10 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-10.json and the round's other changes: the search for any number of
 * cards with a total mana value (`search.groupLimit`, effects/handlers/cards-library.ts, render/steps-cards.ts), "repeat this process until C" (`repeat.until` and `gather`,
 * effects/handlers/control.ts, parser/lower/repeat-process.ts, render/fold-edhzones10.ts), `sharesWith` with the quality `permanentType` (parser/holes/filter.ts, rules/filter.ts,
 * render/np.ts) and the condition "if it's a nonland card" (render/cond.ts). Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is
 * in edh-zones-10-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones10 from '../../../src/parser/templates/zz-cloud/edh-zones-10.json';
import review from '../../m5/golden/cards/edh-zones-10-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ10 = edhZones10 as Template[];
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

const IDS = [
  'eff.edhz10.search.desc.reveal.shuffleTop', 'eff.edhz10.shuffle.rest.intoLibrary', 'eff.edhz10.search.anyNumber.totalMv', 'eff.edhz10.search.nCards',
  'eff.edhz10.put.anyNumber.bf.underYourControl', 'eff.edhz10.may.putHand.unlessSameNameExiled', 'eff.edhz10.repeatProcess.untilHandOrSameName',
];

describe('edh-zones-10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-10.json, after zz-cloud/edh-zones-1.json, before zz-cloud/edh-zones-2.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-10.json');
    expect(files.indexOf('zz-cloud/edh-zones-10.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-1.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-10.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ10.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ10) {
      expect(t.id, t.id).toMatch(/^eff\.edhz10\./);
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
    // narrow wordings (a handful of cards of the index print them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz10.search.desc.reveal.shuffleTop')).toEqual(['Conduit of Ruin']);
    expect(goldenUsing('eff.edhz10.shuffle.rest.intoLibrary')).toEqual(['Genesis Hydra']);
    expect(goldenUsing('eff.edhz10.search.anyNumber.totalMv')).toEqual(['Protean Hulk']);
    expect(goldenUsing('eff.edhz10.search.nCards')).toEqual(['Final Parting']);
    expect(goldenUsing('eff.edhz10.put.anyNumber.bf.underYourControl')).toEqual(['Oblivion Sower']);
    expect(goldenUsing('eff.edhz10.may.putHand.unlessSameNameExiled')).toEqual(['Tainted Pact']);
    expect(goldenUsing('eff.edhz10.repeatProcess.untilHandOrSameName')).toEqual(['Tainted Pact']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ10) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-10 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ10) {
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
    [/\bonto the battlefield\b/, 'into their hand'], [/\bon top\b/, 'on the bottom'], [/\binto your hand\b/, 'into your graveyard'], [/\bor less\b/, 'or greater'], [/\bor greater\b/, 'or less'],
    [/\bany number\b/, 'two'], [/\bunder your control\b/, 'tapped'], [/\bshuffle\b/, 'draw a card'], [/\bthe rest\b/, 'a card'], [/\buntil\b/, 'once'], [/\bsame name\b/, 'same color'],
    [/\bface down\b/, 'face up'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ10) {
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

describe('edh-zones-10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ10) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    }, 240_000); // one parse per word of every example
  }
});

describe('edh-zones-10 "if it\'s a nonland card" (render/cond.ts; CR 108.1, 111.1, 608.2c)', () => {
  const t = (cond: string): string => `Exile the top card of your library. If it's ${cond}, you may cast it without paying its mana cost.`;
  it('full for a nonland card; the card flag is kept (a token is no card), and the JSON is a `matches` of the exiled card', () => {
    expect(level('Sorcery', t('a nonland card'))).toBe('full');
    expect(json('Sorcery', t('a nonland card'))).toContain('"filter":{"notTypes":["Land"],"isCard":true}');
  });
  it('near misses: a creature card (the old reading), a nonland permanent (no card flag) and a noncreature, nonland card are other filters', () => {
    expect(json('Sorcery', t('a creature card'))).not.toContain('"notTypes"');
    expect(json('Sorcery', t('a nonland permanent'))).not.toContain('"isCard":true'); // a permanent, not a card: its own filter
    expect(json('Sorcery', t('a noncreature, nonland card'))).not.toBe(json('Sorcery', t('a nonland card')));
  });
});

describe('edh-zones-10 "shares a permanent type with it" (parser/holes/filter.ts, rules/filter.ts#sharesQuality, render/np.ts; CR 110.4, 205.2a)', () => {
  const trigger = (what: string): string => `Whenever a nonartifact permanent you control enters, you may return ${what} that shares a permanent type with it to its owner's hand.`;
  it('"another permanent you control" is full; the permanent that entered is left out of the set compared with (sharesWith.other)', () => {
    expect(level('Artifact', trigger('another permanent you control'))).toBe('full');
    expect(json('Artifact', trigger('another permanent you control'))).toContain('"quality":"permanentType"');
    expect(json('Artifact', trigger('another permanent you control'))).toContain('"other":true');
  });
  it('near misses: without "another" there is no reading (the word is part of what the filter says), and "card type" is the old quality', () => {
    expect(level('Artifact', trigger('a permanent you control'))).not.toBe('full');
    expect(level('Artifact', trigger('another permanent you control').replace('permanent type', 'creature type'))).toBe('full'); // another quality: its own reading
    expect(json('Artifact', trigger('another permanent you control').replace('permanent type', 'card type'))).toContain('"quality":"cardType"');
  });
});

describe('edh-zones-10 search with a total mana value (effects/handlers/cards-library.ts, render/steps-cards.ts; CR 701.23a, 202.3)', () => {
  const s = (limit: string): string => `Search your library for any number of creature cards with total mana value ${limit}, put them onto the battlefield, then shuffle.`;
  it('"N or less" is full and keeps the limit; "N or greater", a total power and a count are not read', () => {
    expect(level('Sorcery', s('5 or less'))).toBe('full');
    expect(json('Sorcery', s('5 or less'))).toContain('"groupLimit"');
    expect(level('Sorcery', s('5 or greater'))).not.toBe('full');
    expect(level('Sorcery', s('5 or less').replace('total mana value', 'total power'))).not.toBe('full');
    expect(level('Sorcery', s('5 or less').replace('any number of', 'up to two'))).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-10 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ10.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
