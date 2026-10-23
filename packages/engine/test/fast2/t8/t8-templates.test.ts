/**
 * T8 (FAST2 wave, one-shot effects: damage, life, draws, counters and keyword actions): the template data of parser/templates/zz-fast2/t8.json. Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations (an appended "unless", "instead", "at random" or "twice", a swapped key word) fail or differ; a nonsense word in
 * place of any word of an example never leaves an automated ability (G2); a stable template has three hand-verified golden cards (design 6.9). Examples
 * are synthetic wordings (design 6.10): no example is a line of a real
 * card (checked against the local index when it is present).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T8 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t8 from '../../../src/parser/templates/zz-fast2/t8.json';
import review from '../../m5/golden/cards/fast2-t8-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T8 = t8 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2)
/**
 * A synthetic card on which the example is an ability of the right kind: an Aura or an Equipment when the text names what it is attached to, a permanent for a
 * static, triggered or activated ability, a sorcery otherwise; X in the text is X in the mana cost (CR 107.3).
 */
function t8Card(t: Template, text: string): OracleCard {
  const type = /enchanted creature/i.test(text) ? 'Enchantment — Aura'
    : /equipped creature/i.test(text) ? 'Artifact — Equipment'
      : t.kind === 'static' || /^(when|whenever|at) /i.test(text) || text.includes(':') ? 'Creature — Human Wizard' : 'Sorcery';
  return card('Example Ember', type, text, text.split(/[^A-Za-z]+/).includes('X') ? { mana_cost: '{X}{R}' } : { mana_cost: '{1}{R}' });
}
const parsedWith = (t: Template, text: string) => parseCard(t8Card(t, text), OPTS).faces[0]!;

describe('T8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast2/t8.json, path order: after zz-fast1/, before zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast2/t8.json');
    expect(files.indexOf('zz-fast2/t8.json')).toBeGreaterThan(files.indexOf('zz-fast1/t6.json'));
    expect(files.indexOf('zz-fast2/t8.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 3', () => {
    expect(T8.length).toBeGreaterThan(0);
    for (const t of T8) {
      expect(t.id, t.id).toMatch(/^(eff|rep|cond)\.t8\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(3);
    }
  });
  it('design 6.9: a stable T8 template has the evidence for it: at least three hand-verified golden cards (test/m5/golden/cards/fast2-t8-review.json)', () => {
    const golden = review as { card: string; expect?: string; verified: string }[];
    for (const t of T8.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.endsWith(`(${t.id})`)).map((g) => g.card);
      expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T8) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'extra', 'additional']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T8 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T8) {
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
  const sentences = text.split(/(?<=\.)\s+/);
  const body = sentences[0]!.replace(/\.$/, '');
  const rest = sentences.slice(1).join(' ');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\beach player\b/, 'each other player'], [/\bto you\b/, 'to target player'], [/\bgain(s?)\b/, 'lose$1'], [/\bitself\b/, 'each creature'],
    [/\bpower\b/, 'toughness'], [/\bmay have\b/, 'must have'], [/\bthe monarch\b/, 'the initiative'], [/\bextra turn\b/, 'extra combat'],
    [/\badditional card\b/, 'additional land'], [/\bif you attacked\b/, 'unless you attacked'], [/\btarget\b/, 'each'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => (rest === '' ? m : `${m} ${rest}`));
}

describe('T8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T8) {
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

describe('T8 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T8) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          // design 6.11: counter names are an open class ("N <word> counter(s)"), so the word before "counter" is not a closed-vocabulary word
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T8 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|Vehicle)\b/g, '~').trim());
        }
      }
    }
    const verbatim = T8.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
