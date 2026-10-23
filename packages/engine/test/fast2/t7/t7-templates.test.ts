/**
 * FAST2 T7 (template family: mana abilities, cost modifiers, keyword lines and conditional statics): the template data of
 * parser/templates/zz-fast2/t7.json. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations (an appended "unless", "instead", "at random" or "twice", a
 * swapped key word) fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic
 * wordings (design 6.10): no example is a line of a real card (checked against the local index when it is present).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T7 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { runHole } from '../../../src/parser/holes';
import { adaptTokens } from '../../../src/parser/holes/tok';
import { tokenize } from '../../../src/parser/tokenize';
import { GENERATED_LEXICON } from '../../../src/parser/front/lexicon-index';
import t7 from '../../../src/parser/templates/zz-fast2/t7.json';
import review from '../../m5/golden/cards/fast2-t7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T7 = t7 as Template[];
const OPTS = defaultParseOptions();

/** A synthetic card in which a T7 example is an ability of the right kind (the type line matters for "Enchant", "Equip" and the self noun). */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.id.startsWith('kw.t7.equip')) return card('Example Blade', 'Artifact — Equipment', text);
  if (/enchant/i.test(text)) return card('Example Charm', 'Enchantment — Aura', text);
  if (t.kind === 'rider' && !/^When/.test(text)) return card('Example Call', 'Sorcery', text);
  if (t.id.startsWith('eff.')) return card('Example Totem', 'Artifact Creature — Golem', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast2/t7.json, path order: after zz-fast1/, before zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast2/t7.json');
    expect(files.indexOf('zz-fast2/t7.json')).toBeGreaterThan(files.indexOf('zz-fast1/t6.json'));
    expect(files.indexOf('zz-fast2/t7.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 4', () => {
    expect(T7.length).toBeGreaterThan(0);
    for (const t of T7) {
      expect(t.id, t.id).toMatch(/^(eff|sta|kw|cm|rid)\.t7\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(4);
    }
  });
  it('design 6.9: a stable T7 template has the evidence for it: at least three hand-verified golden cards (test/m5/golden/cards/fast2-t7-review.json)', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T7.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`) || g.verified.includes(`(${t.id};`) || g.verified.includes(`; ${t.id})`)).map((g) => g.card);
      expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T7) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T7 hole ManaSym (INTERFACE CHANGE, parser/holes/misc.ts)', () => {
  const read = (text: string): unknown[] => {
    const toks = adaptTokens(tokenize(text, { lexicon: GENERATED_LEXICON }));
    return runHole('ManaSym', toks, 0, { lexicon: GENERATED_LEXICON, keywords: OPTS.keywords }).filter((a) => a.end === toks.length).map((a) => a.value);
  };
  it('CR 106.1: one colored or colorless symbol alone is its mana type; a run, generic or hybrid mana is not', () => {
    expect(read('{G}')).toEqual(['G']);
    expect(read('{C}')).toEqual(['C']);
    expect(read('{G}{G}')).toEqual([]);
    expect(read('{2}')).toEqual([]);
    expect(read('{W/U}')).toEqual([]);
  });
});

describe('T7 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T7) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const lines = text.split('\n');
  const last = lines[lines.length - 1]!;
  const head = lines.slice(0, -1).map((l) => `${l}\n`).join('');
  const sentences = last.split(/(?<=\.)\s+/);
  const body = sentences[0]!.replace(/\.$/, '');
  const rest = sentences.slice(1).join(' ');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bless\b/, 'more'], [/\byou cast\b/, 'your opponents cast'], [/\bcan't\b/, 'can'], [/\bisn't\b/, 'is'], [/\bany one color\b/, 'any color'],
    [/\bfor each\b/, 'for every'], [/\bactivated\b/, 'triggered'], [/\bor\b/, 'and'], [/\bother\b/, 'nontoken'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => `${head}${rest === '' ? m : `${m} ${rest}`}`);
}

describe('T7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T7) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T7 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T7) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T7 design 6.10: examples are synthetic', () => {
  // the LAST line is the one the template reads; an earlier line only sets the card up with another file's template ("As ~ enters, choose a color.")
  it('no example or counter-example ends with a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura)\b/g, '~').trim());
        }
      }
    }
    const verbatim = T7.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.split('\n').pop()!.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
