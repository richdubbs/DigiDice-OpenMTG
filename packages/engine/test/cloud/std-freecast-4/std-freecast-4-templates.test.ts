/**
 * std-freecast-4 (lane std-freecast): the template data of parser/templates/zz-cloud/std-freecast-4.json and the round's engine and renderer support: "Disguise {cost}.
 * This cost is reduced by {N} for each <filter>." (the keyword's own `costChange`, applied by core/special/turn-face-up.ts#turnFaceUpProcedures; render/kw.ts).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in std-freecast-4-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import freecast4 from '../../../src/parser/templates/zz-cloud/std-freecast-4.json';
import review from '../../m5/golden/cards/cloud-std-freecast-4-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const FC = freecast4 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const GOLDEN = [...(review as Golden)];
const goldenUsing = (id: string): string[] => GOLDEN.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on one golden card because Oracle prints the wording on that
 * card only in the whole index, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'kw.stdfreecast4.disguise.reducedPer': 'Fugitive Codebreaker',
};

/** The type line an example is an ability of: an activated ability on an artifact, a static ability on an enchantment or a creature, anything else a sorcery. */
const typeOf = (_text: string): string => 'Creature — Human';
const face = (text: string, type = typeOf(text)) => parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-freecast-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-freecast-4.json, after zz-cloud/std-fra.json, before zz-cloud/std-hob.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-freecast-4.json');
    expect(files.indexOf('zz-cloud/std-freecast-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-fra.json'));
    expect(files.indexOf('zz-cloud/std-freecast-4.json')).toBeLessThan(files.indexOf('zz-cloud/std-hob.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(FC.map((t) => t.id).sort()).toEqual(Object.keys(NARROW).sort());
    for (const t of FC) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
      expect(goldenUsing(t.id), t.id).toEqual([NARROW[t.id]]);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of FC) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'whenever', 'again']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-freecast-4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of FC) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
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
  const out = text.includes('\n') ? [] : [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [[/\bthis turn\b/, 'this game'], [/\byou cast\b/, 'an opponent casts'], [/\bfirst\b/, 'second'], [/\btheir turns\b/, 'your turns'],
    [/\breduced\b/, 'increased'], [/\bDisguise\b/, 'Morph'], [/\bfor each\b/, 'for every two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-freecast-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of FC) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-freecast-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of FC) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.pop()!;
        const words = last.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines, [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-freecast-4 lowering and renderer support', () => {
  it('CR 702.168a: the cost change is the disguise keyword\'s own `costChange` (reduce, floor zero)', () => {
    const f = face('Disguise {4}{U}. This cost is reduced by {1} for each artifact you control.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"keyword":"disguise"');
    expect(JSON.stringify(f.abilities)).toContain('"costChange":{"kind":"reduce"');
  });
  it('the equip wording "This ability costs {1} less to activate" after disguise is not this reading', () => {
    expect(understood(face('Disguise {4}{U}. This ability costs {1} less to activate for each artifact you control.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-freecast-4 design 6.10 (local index): synthetic examples', () => {
  it('no std-freecast-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = FC.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
