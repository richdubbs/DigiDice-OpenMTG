/**
 * WP21 (design 15.2): the template data of parser/templates/effect/{move,destroy,tokens,counters,attach}.json. Guard G9 (design 6.8): every example lowers
 * with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations (an appended "unless", "instead" or "at random", a swapped determiner, an inserted "up to", a negation) fail or differ; a nonsense word in place
 * of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { BOOTSTRAP_TEMPLATES } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { automated, bare, exampleCard, face, fullyAutomated, jsonKey, localIndex, options, WP21_FILES, WP21_TEMPLATES } from './support';

const OPTS = options();
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const parsedWith = (t: Template, text: string) => face(exampleCard(t, text), OPTS);

describe('WP21 template files are well formed (design 6.3, 6.9)', () => {
  it('they compile with the bootstrap templates, cite rules, have examples and counter-examples, and every id is unique', () => {
    expect(validateTemplates([...BOOTSTRAP_TEMPLATES, ...WP21_TEMPLATES])).toEqual([]);
  });
  it('about 50 templates (design 15.2 WP21), each file non-empty', () => {
    for (const [file, list] of Object.entries(WP21_FILES)) expect(list.length, file).toBeGreaterThan(0);
    expect(WP21_TEMPLATES.length).toBeGreaterThanOrEqual(40);
  });
  it('design 6.9: every template has at least two examples, two counter-examples and CR citations of the form "CR n"', () => {
    for (const t of WP21_TEMPLATES) {
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
    }
  });
  it('ids are namespaced by kind (eff., sta., kw.) and no WP21 id shadows a bootstrap id', () => {
    const boot = new Set(BOOTSTRAP_TEMPLATES.map((t) => t.id));
    for (const t of WP21_TEMPLATES) {
      expect(boot.has(t.id), t.id).toBe(false);
      expect(t.id, t.id).toMatch(t.kind === 'effect' ? /^eff\./ : t.kind === 'static' ? /^sta\./ : /^kw\./);
    }
  });
  it('a word of the critical list that a pattern spells out is listed in `consumes` (guard G3)', () => {
    for (const t of WP21_TEMPLATES) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('WP21 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of WP21_TEMPLATES) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
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
        const same = fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities);
        expect(same, c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `Don't ${body.charAt(0).toLowerCase()}${body.slice(1)}.`];
  const swaps: [RegExp, string][] = [[/\btarget\b/, 'each'], [/\beach\b/, 'target'], [/\ball\b/, 'target'], [/\btarget\b/, 'up to one target'], [/\byour\b/, "an opponent's"]];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by)}.`);
  return out;
}

describe('WP21 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of WP21_TEMPLATES.filter((x) => x.kind === 'effect')) {
    it(`${t.id}: an appended "unless/instead/at random/twice", a negation, a swapped determiner or an inserted "up to" never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('WP21 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of WP21_TEMPLATES) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          // counter names are an open class (design 6.11, CR 122.1): "N <word> counters" accepts any word as the kind
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const f = parsedWith(t, mutated);
          expect(fullyAutomated(f), mutated).toBe(false);
        });
      }
    });
  }
});

/** Every line (and whole text) of the Oracle texts of the local index, with the card's own name also written "~". */
function oracleLines(): Set<string> {
  const lines = new Set<string>();
  for (const c of localIndex() ?? []) {
    for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
      if (typeof text !== 'string') continue;
      lines.add(text.trim());
      for (const l of text.split('\n')) { lines.add(l.trim()); lines.add(l.replaceAll(c.name, '~').trim()); }
    }
  }
  return lines;
}

/**
 * Is `text` (or one of its sentence lines) a line of some card, with "~" read as the object's own name or as "this <type>"? A bare keyword line ("Enchant
 * creature", "Equip {2}") is a rules term, not card text, and is not counted.
 */
const verbatim = (lines: Set<string>, text: string): boolean =>
  text.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.')).some((l) => ['~', 'this creature', 'this artifact', 'this enchantment', 'this Aura'].some((w) => lines.has(l.replaceAll('~', w))));

/** The string literals of a test file that look like rules text (a sentence with a period). */
function sentenceLiterals(file: string): string[] {
  const src = readFileSync(join(TEST_DIR, file), 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`$\\]*)`/g)) {
    const s = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\n/g, '\n').replace(/\\(.)/g, '$1');
    if (/\s/.test(s) && /[.]$|[.]\n/.test(s) && /^[A-Z{~]/.test(s)) out.push(s);
  }
  return out;
}

describe('WP21 test data hygiene (design 6.10)', () => {
  it.skipIf(localIndex() === null)('no example is the Oracle text, or a line of the Oracle text, of any card in the local index', () => {
    const lines = oracleLines();
    for (const t of WP21_TEMPLATES) for (const e of t.examples) expect(verbatim(lines, e.text), `${t.id}: ${e.text}`).toBe(false);
  });
  it.skipIf(localIndex() === null)('no sentence written in a test of this folder is a line of the Oracle text of a card (WP21 review)', () => {
    const lines = oracleLines();
    const files = readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(3);
    const found = files.flatMap((f) => sentenceLiterals(f).filter((s) => verbatim(lines, s)).map((s) => `${f}: ${s}`));
    expect(found).toEqual([]);
  });
});
