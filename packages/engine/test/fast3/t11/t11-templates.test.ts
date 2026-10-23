/**
 * FAST3 T11 (template family: cost modifiers and mana abilities with computed amounts): the template data of parser/templates/zz-fast3/t11.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T11 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t11 from '../../../src/parser/templates/zz-fast3/t11.json';
import review from '../../m5/golden/cards/fast3-t11-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T11 = t11 as Template[];
const OPTS = defaultParseOptions();

/** A synthetic card in which a T11 example is an ability of the right kind (an Aura for "Enchant", a sorcery for a spell's own cost). */
function exampleCard(t: Template, text: string): OracleCard {
  if (/enchant/i.test(text)) return card('Example Charm', 'Enchantment — Aura', text);
  if (t.id.startsWith('cm.t11.self.more')) return card('Example Volley', 'Sorcery', text);
  if (t.id.startsWith('eff.')) return card('Example Totem', 'Artifact Creature — Golem', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence that only two real cards print, both of them (every
 * corpus match reviewed; the index check below proves there is no third).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'cm.t11.self.more.beyondFirst': { cards: ['Fireball', 'Launch the Fleet'], line: /costs \{\d+\} more to cast for each target beyond the first/i },
  'cm.t11.spells.less.otherTurns': { cards: ['Geyser Drake', 'Naiad of Hidden Coves'], line: /^during turns other than yours, .*cost \{\d+\} less to cast/im },
  'eff.t11.mana.additional.chosen.player': { cards: ['Utopia Sprawl', 'Shimmerwilds Growth'], line: /adds? an additional \w+ mana of the chosen color/i },
};

describe('T11 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast3/t11.json, path order: after zz-fast2/, before zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast3/t11.json');
    expect(files.indexOf('zz-fast3/t11.json')).toBeGreaterThan(files.indexOf('zz-fast2/t9.json'));
    expect(files.indexOf('zz-fast3/t11.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 5', () => {
    expect(T11.length).toBeGreaterThan(0);
    for (const t of T11) {
      expect(t.id, t.id).toMatch(/^(eff|cm)\.t11\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(5);
    }
  });
  it('design 6.9: a stable T11 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T11.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T11) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T11 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T11) {
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
    [/\bless\b/, 'more'], [/\bmore\b/, 'less'], [/\byou cast\b/, 'your opponents cast'], [/\bany one color\b/, 'any color'], [/\bfor each\b/, 'for every'],
    [/\bsecond\b/, 'third'], [/\bbeyond the first\b/, 'beyond the second'], [/\bother than yours\b/, 'of your opponents'], [/\byour graveyard\b/, 'a graveyard'],
    [/\bbasic land type\b/, 'land type'], [/\bchosen color\b/, 'chosen type'], [/\byou control\b/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => `${head}${rest === '' ? m : `${m} ${rest}`}`);
}

describe('T11 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T11) {
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

describe('T11 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T11) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T11 design 6.9, 6.10 (local index): synthetic examples; the whole-corpus evidence is the whole corpus', () => {
  // lines that only set the card up for another file's template (the linked "choose a color", CR 607.2d; the Aura's enchant keyword) are not the T11 sentence
  const SETUP = new Set(['Enchant land', 'As ~ enters, choose a color.', 'As ~ enters, choose a creature type.']);
  // the one template whose sentence has no word to vary: "{1} more ... for each target beyond the first" is fixed by its pattern (a rules phrase, CR 601.2f)
  const FIXED_WORDING = new Set(['cm.t11.self.more.beyondFirst']);
  it('no line of an example or counter-example (except setup lines) is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T11.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
});
