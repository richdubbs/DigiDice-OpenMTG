/**
 * p2-zone-moves-2 (Phase 2 lane p2-zone-moves): the template data of parser/templates/zz-cloud/p2-zone-moves-2.json and the round's other changes: the Rest hole reads
 * "all other cards revealed this way" (parser/holes/object.ts#rest; render family rest-all-other-revealed, a reading added to the existing group of render/refs.ts);
 * render/fold.ts#putThatAndRest says "and exile <the rest>" (before, it printed no verb for an exile and the gate refused it). Guard G9 and G2 as the earlier rounds
 * run them; examples are synthetic (design 6.10). The behavior is in p2-zone-moves-2-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2ZoneMoves2 from '../../../src/parser/templates/zz-cloud/p2-zone-moves-2.json';
import review from '../../m5/golden/cards/cloud-p2-zone-moves-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const ZM2 = p2ZoneMoves2 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|this creature|^\{/m.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);

const IDS = ['eff.p2zm2.putThat.hand.rest.graveyard', 'eff.p2zm2.putThat.hand.exileRest'];

describe('p2-zone-moves-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-zone-moves-2.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-zone-moves-2.json');
    expect(files.indexOf('zz-cloud/p2-zone-moves-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json')); // after every other 'p2-' file
    expect(files.indexOf('zz-cloud/p2-zone-moves-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(ZM2.map((t) => t.id)).toEqual(IDS);
    for (const t of ZM2) {
      expect(t.id, t.id).toMatch(/^eff\.p2zm2\./);
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
    // narrow wordings (one card of the index prints them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named
    // in the round record
    expect(goldenUsing('eff.p2zm2.putThat.hand.rest.graveyard')).toEqual(['Hermit Druid']);
    expect(goldenUsing('eff.p2zm2.putThat.hand.exileRest')).toEqual(['Demonic Consultation']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of ZM2) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-zone-moves-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of ZM2) {
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
    [/\binto your hand\b/, 'into your library'], [/\binto your graveyard\b/, 'into exile'], [/\bexile all other\b/, 'exile all'], [/\bexile the rest\b/, 'exile it'],
    [/\ball other cards revealed this way\b/, 'all cards revealed this way'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-zone-moves-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of ZM2) {
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

describe('p2-zone-moves-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of ZM2) {
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
    });
  }
});

describe('p2-zone-moves-2 Rest (parser/holes/object.ts#rest; CR 608.2c, 701.20a): "all other cards revealed this way"', () => {
  it('is "the rest" of the reveal: the same JSON', () => {
    const a = json('Sorcery', 'Reveal cards from the top of your library until you reveal an artifact card. Put that card into your hand and the rest into your graveyard.');
    const b = json('Sorcery', 'Reveal cards from the top of your library until you reveal an artifact card. Put that card into your hand and all other cards revealed this way into your graveyard.');
    const steps = (j: string): string => JSON.stringify((JSON.parse(j) as { abilities: { effect?: unknown }[] }[]).map((f) => f.abilities.map((x) => x.effect)));
    expect(steps(b)).toBe(steps(a));
    expect(a).toContain('"filter":{"is":{"ref":"bound","name":"revealed"},"not":{"is":{"ref":"bound","name":"hit"}},"zone":"library"}');
  });
});

describe('p2-zone-moves-2 renderer (render/fold.ts#putThatAndRest; CR 406.1)', () => {
  it('"... and exile the rest": the exile said with its own verb; face down is not read', () => {
    expect(level('Sorcery', 'Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and exile the rest.')).toBe('full');
    expect(level('Sorcery', 'Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and exile the rest face down.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-zone-moves-2 design 6.10 (local index): synthetic examples', () => {
  it('no p2-zone-moves-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = ZM2.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
