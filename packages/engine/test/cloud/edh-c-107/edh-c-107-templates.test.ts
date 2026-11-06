/**
 * edh-c-107 (Commander effort, lane edh-c, EDHREC ranks 18,001-18,500, later pass): the template data of parser/templates/zz-cloud/edh-c-107.json and the round's other changes:
 * "put <a card> on your choice of the top or bottom of its owner's library" (move `to.endChosenBy`, effects/handlers/zones-move.ts, render/steps-zones.ts#move). Guard G9 and G2 as the earlier rounds run them; examples are synthetic
 * (design 6.10). The behavior is in edh-c-107-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC107 from '../../../src/parser/templates/zz-cloud/edh-c-107.json';
import review from '../../m5/golden/cards/edh-c-107-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EC107 = edhC107 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on. */
const TYPE: Record<string, string> = {};
const typeOf = (_text: string, id?: string): string => (id !== undefined ? TYPE[id] ?? 'Sorcery' : 'Sorcery');
const face = (text: string, typeLine: string) =>
  parseCard(card('Example Relic', typeLine, text, typeLine.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

const IDS = ['eff.edhv107.put.yourChoiceTopOrBottom'];

describe('edh-c-107 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-107.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-107.json');
    expect(files.indexOf('zz-cloud/edh-c-107.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-10.json')); // path order
    expect(files.indexOf('zz-cloud/edh-c-107.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-11.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EC107.map((t) => t.id)).toEqual(IDS);
    for (const t of EC107) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta)\.edhv107\./);
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
    // a narrow wording (one card of the index prints it), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhv107.put.yourChoiceTopOrBottom')).toEqual(['Not Forgotten']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EC107) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-c-107 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EC107) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text, typeOf(t.examples[0]!.text, t.id));
      for (const e of t.examples) {
        const f = face(e.text, typeOf(e.text, t.id));
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text, t.id));
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
    [/\bgraveyard\b/, 'library'], [/\bgraveyard\b/, 'hand'], [/\bto your hand\b/, 'to your graveyard'], [/\bon top\b/, 'on the bottom'], [/\bany number\b/, 'one'], [/\bface down\b/, 'face up'],
    [/\bthe top\b/, 'the bottom'], [/\bopponent\b/, 'player'], [/\bsearch\b/, 'draw'], [/\bfrom your hand\b/, 'from your graveyard'], [/\bbottom\b/, 'top'], [/\bowner\b/, 'controller'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-107 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EC107) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text, typeOf(e.text, t.id));
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text, t.id));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-c-107 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EC107) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text, t.id))), mutated).toBe(false);
        });
      }
    }, 240_000); // one parse per word of every example
  }
});



describe('edh-c-107 move `to.endChosenBy` (effects/handlers/zones-move.ts, render/steps-zones.ts; CR 401.4, 400.3)', () => {
  it('"on your choice of the top or bottom of its owner\'s library" is the move with you choosing the end', () => {
    const j = json('Sorcery', "Put target card from a graveyard on your choice of the top or bottom of its owner's library.");
    expect(j).toContain('"endChosenBy":{"ref":"you"}');
    expect(level('Sorcery', "Put target card from a graveyard on your choice of the top or bottom of its owner's library.")).toBe('full');
  });
  it('near misses: the owner choosing, another player choosing and a plain end are other readings (or manual)', () => {
    const base = "Put target card from a graveyard on your choice of the top or bottom of its owner's library.";
    expect(level('Sorcery', base.replace('your choice', 'their choice'))).not.toBe('full');
    expect(level('Sorcery', base.replace('its owner\'s library', 'your library'))).not.toBe('full');
    expect(same(json('Sorcery', base), json('Sorcery', "Put target card from a graveyard on top of its owner's library."))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-c-107 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-107 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EC107.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
