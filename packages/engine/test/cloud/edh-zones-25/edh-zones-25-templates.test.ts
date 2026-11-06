/**
 * edh-zones-25 (Commander lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-25.json and the round's other changes: the rider that names a sentence two back
 * (`"@unit": -2`, parser/lower/riders.ts: "Then shuffle." between the search and "If C, search ... instead of two"), the replacement of a choice-and-move by "return all ... instead"
 * (render/self-replacement.ts#everyChosenInstead), the folds of render/fold-edhzones25.ts and the promotion of ch.maypay.discard. Guard G9 and G2 as the earlier rounds run them; examples are
 * synthetic (design 6.10). The behavior is in edh-zones-25-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones25 from '../../../src/parser/templates/zz-cloud/edh-zones-25.json';
import review from '../../m5/golden/cards/edh-zones-25-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ25 = edhZones25 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

const IDS = [
  'eff.edhz25.return.upTo.bf',
  'eff.edhz25.search.reveal.oneTapped.restHand',
  'rid.edhz25.search.upToInstead',
  'trg.edhz25.you.discard.batch.filtered',
  'eff.edhz25.exile.oneOfThem.fromYourGraveyard',
];
/** The type line an example is printed on. */
const typeOf = (text: string): string => (/^Whenever you discard/.test(text) ? 'Creature — Human' : 'Sorcery');
const face = (text: string, typeLine: string) =>
  parseCard(card('Example Relic', typeLine, text, { ...(typeLine.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...(/\bX\b/.test(text) ? { mana_cost: '{X}' } : {}) }), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic', extra: Record<string, unknown> = {}) =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...extra } as OracleCard);
const withX = (text: string): Record<string, unknown> => (/\bX\b/.test(text) ? { mana_cost: '{X}' } : {});
const level = (type: string, text: string, name?: string): string => compiled(type, text, name, withX(text)).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name, withX(text)).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

describe('edh-zones-25 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-25.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-25.json');
    expect(files.indexOf('zz-cloud/edh-zones-25.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-22.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-25.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ25.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ25) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta|trg|rid)\.edhz25\./);
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
    // narrow wordings (one or two cards of the index print them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz25.return.upTo.bf')).toEqual(['Haunting Voyage']);
    expect(goldenUsing('eff.edhz25.search.reveal.oneTapped.restHand')).toEqual(["Nissa's Pilgrimage"]);
    expect(goldenUsing('rid.edhz25.search.upToInstead')).toEqual(["Nissa's Pilgrimage"]);
    expect(goldenUsing('trg.edhz25.you.discard.batch.filtered')).toEqual(['Conspiracy Theorist']);
    expect(goldenUsing('eff.edhz25.exile.oneOfThem.fromYourGraveyard')).toEqual(['Conspiracy Theorist']);
    expect(goldenUsing('ch.maypay.discard')).toEqual(['Conspiracy Theorist']); // promoted from experimental on one hand-verified golden card plus the scenarios (three cards print it; Wolf of Devil's Breach, outside the top 5,000, opened for verification only)
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ25) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'random']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-25 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ25) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text, typeOf(t.examples[0]!.text));
      for (const e of t.examples) {
        const f = face(e.text, typeOf(e.text));
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
    [/\bor less\b/, 'or greater'], [/\bmana value\b/, 'power'], [/\bgraveyard\b/, 'hand'], [/\bbottom\b/, 'top'], [/\bthe rest\b/, 'a card'], [/\bone of them\b/, 'two of them'], [/\bat random\b/, 'of your choice'], [/\bplaneswalker\b/, 'creature'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-25 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ25) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text, typeOf(e.text));
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-25 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ25) {
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
    }, 600_000); // one parse per word of every example
  }
});

describe('edh-zones-25 "If C, search ... instead of two" over "Then shuffle." (parser/lower/riders.ts `@unit`; render/fold-edhzones25.ts#searchUpToInstead; CR 608.2c, 614.15)', () => {
  const base = 'Search your library for up to two basic Island cards, reveal those cards, and put one onto the battlefield tapped and the rest into your hand. Then shuffle.';
  const rider = (c: string, n = 'three', of = 'two'): string => `If ${c}, search your library for up to ${n} basic Island cards instead of ${of}.`;
  it('is the search of the first sentence, the other instructions of the sentence stay', () => {
    const text = `${base} ${rider('you control a creature')}`;
    expect(level('Sorcery', text)).toBe('full');
    const j = json('Sorcery', text);
    expect(j).toContain('"op":"if"');
    expect(j).toContain('"max":3');
    expect(j).toContain('"max":2');
    expect(j).toContain('"op":"shuffle"');
  });
  it('near misses: no "instead of", another number word for the old count, another kind of card and a first sentence without the rest are not read', () => {
    expect(level('Sorcery', `${base} If you control a creature, search your library for up to three basic Island cards.`)).not.toBe('full');
    expect(level('Sorcery', `${base} If you control a creature, search your library for up to three basic Swamp cards instead of two.`)).not.toBe('full');
    expect(level('Sorcery', 'Draw a card. Then shuffle. If you control a creature, search your library for up to three basic Island cards instead of two.')).not.toBe('full');
    expect(level('Sorcery', `${base} Draw a card. ${rider('you control a creature')}`)).not.toBe('full');
  });
});

describe('edh-zones-25 "return all ... instead" replaces a choice and its move (render/self-replacement.ts#everyChosenInstead; CR 614.15, 608.2c)', () => {
  const t = (all: string): string => `Return up to two artifact cards from your graveyard to the battlefield. If you control a creature, ${all} instead.`;
  it('replaces both steps when the instead sentence moves every card of the very description to the same place', () => {
    expect(level('Sorcery', t('return all artifact cards from your graveyard to the battlefield'))).toBe('full');
  });
  it('near misses: another description, another place and "up to" with all are other readings or manual', () => {
    expect(level('Sorcery', t('return all creature cards from your graveyard to the battlefield'))).not.toBe('full');
    expect(level('Sorcery', t('return all artifact cards from your graveyard to your hand'))).not.toBe('full');
    expect(level('Sorcery', t('return all artifact cards from a graveyard to the battlefield'))).not.toBe('full');
  });
});

describe('edh-zones-25 ch.maypay.discard is stable (promoted; CR 118.12, 701.9a)', () => {
  const t = 'Whenever ~ attacks, you may pay {1} and discard a card. If you do, draw a card.';
  it('a creature with it is fully automated; two cards or "or" are not the reading', () => {
    expect(level('Creature — Human', t)).toBe('full');
    expect(level('Creature — Human', t.replace('and discard a card', 'or discard a card'))).not.toBe('full');
    expect(level('Creature — Human', t.replace('discard a card', 'discard two cards'))).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-25 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-25 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ25.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
