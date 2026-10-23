/**
 * p2-counters-move-3 (lane p2-counters-move): the template data of parser/templates/zz-cloud/p2-counters-move-3.json ("For each <qty>, <obj> gets <pt> <dur>": the
 * count said before a resolved pump, the same JSON as std-ry10's "<obj> gets <pt> <dur> for each <qty>") and the renderer reading of render/mods.ts (family
 * count-before-pump). Guard G9 (design 6.8), G2 and 6.10 as the other rounds of the lane. CR cites from memory, unverified.
 *
 * Status (design 6.9): stable on one hand-verified golden card (Hex Parasite, tuning half) plus these tests and the scenario: the wording is printed on three cards of
 * the whole index, so three golden cards of the tuning half are out of reach (guide section 5, "Narrow wordings"; named in the round's record).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2cm3 from '../../../src/parser/templates/zz-cloud/p2-counters-move-3.json';
import review from '../../m5/golden/cards/p2-counters-move-3-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2cm3 as Template[];
const MECH_COUNT = 1;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Codex', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const typeOf = (text: string): [string, [string, string] | undefined] => (/^(When|Whenever|At)\b|^\{/.test(text) ? ['Creature — Beast', ['2', '2']] : ['Sorcery', undefined]);
const parsed = (text: string) => { const [type, pt] = typeOf(text); return face(type, text, pt); };
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const abilitiesJson = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('p2-counters-move-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-counters-move-3.json, after zz-cloud/look3.json, before zz-cloud/p2-counters-state-1.json) and its ids are unique', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-counters-move-3.json');
    expect(files.indexOf('zz-cloud/p2-counters-move-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-counters-move-3.json')).toBeLessThan(files.indexOf('zz-cloud/p2-counters-state-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.p2cm3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.p2cm3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (narrow wordings, guide section 5): a stable template has at least one hand-verified golden card (tuning half) naming it', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`) || g.verified.includes(`(${t.id};`) || g.verified.includes(`(${t.id},`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'second', 'again', 'then', 'additional', 'except']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-counters-move-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} if able.`, `${body} for each Elf you control.`];
  const swaps: [RegExp, string][] = [[/a counter/, 'a +1/+1 counter'], [/two counters/, 'three counters'], [/all counters/, 'all +1/+1 counters'], [/any number of counters/, 'up to one counter'],
    [/a second target/, 'a third target'], [/proliferate X times/, 'proliferate X cards'], [/proliferate three times/, 'proliferate four times'], [/proliferate again/, 'investigate again'], [/^Move/, 'Remove']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-counters-move-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/if able/for each" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsed(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('p2-counters-move-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsed(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-counters-move-3 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment|permanent)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- the reading ---------------------------------------------------------------------------------------------------------------------------------------

describe('p2-counters-move-3 (CR 613.4c, 608.2h): the count before the pump', () => {
  it('"For each counter removed this way, ~ gets +1/+0 until end of turn." is the same JSON as the count said after the pump', () => {
    const first = face('Creature — Insect', '{X}{B}: Remove up to X counters from target artifact. For each counter removed this way, ~ gets +1/+0 until end of turn.', ['1', '1']);
    const last = face('Creature — Insect', '{X}{B}: Remove up to X counters from target artifact. ~ gets +1/+0 until end of turn for each counter removed this way.', ['1', '1']);
    expect(fullFace(first), JSON.stringify(first.diagnostics)).toBe(true);
    expect(fullFace(last), JSON.stringify(last.diagnostics)).toBe(true);
    expect(jsonKey(first.abilities)).toBe(jsonKey(last.abilities));
  });
  it('fail closed: a static ability (no duration) with the count first is not this reading', () => {
    expect(fullFace(face('Creature — Insect', 'For each artifact you control, ~ gets +1/+0.', ['1', '1']))).toBe(false);
  });
});
