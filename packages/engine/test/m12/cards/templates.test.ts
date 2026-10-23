/**
 * M12-3 (docs/design/m12-multiplayer.md 9): the multiplayer-card templates of parser/templates/zz-m12/*.json. Guard G9 (design 6.8 of the milestone 5 design):
 * every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are invented
 * wordings or printed ones (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import goad from '../../../src/parser/templates/zz-m12/goad.json';
import vote from '../../../src/parser/templates/zz-m12/vote.json';
import players from '../../../src/parser/templates/zz-m12/players.json';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';

const FILES: Record<string, Template[]> = { 'zz-m12/goad.json': goad as Template[], 'zz-m12/players.json': players as Template[], 'zz-m12/vote.json': vote as Template[] };
const M12 = Object.values(FILES).flat();
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
/** A permanent for an example that is a triggered or activated ability or names ~ (a trigger of an instant never functions, CR 113.6). */
const cardFor = (t: Template, text: string) => (/^(when|whenever|at) |~|^\{/i.test(text) ? { ...exampleCard(t, text), type_line: 'Artifact Creature — Golem' } : exampleCard(t, text));
const parsedWith = (t: Template, text: string) => parseCard(cardFor(t, text), OPTS).faces[0]!;

describe('M12-3 template files (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('are in the default compiler (zz-m12/, path order: after zz-m11/, before zz-m6/) and their ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    for (const f of Object.keys(FILES)) {
      expect(files).toContain(f);
      expect(files.indexOf(f)).toBeGreaterThan(files.indexOf('zz-m11/commander.json'));
      expect(files.indexOf(f)).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    }
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('design 6.9: every template cites rules, has two examples and two counter-examples, is namespaced m12 and of version 8', () => {
    for (const t of M12) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|kw)\.m12\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });

  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of M12) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'must', 'additional']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('M12-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of M12) {
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
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bgoad\b/i, 'tap'], [/\bStarting with you\b/, 'Starting with target opponent'], [/\bmore votes\b/, 'fewer votes'], [/\bthe most votes\b/, 'the fewest votes'],
    [/\badditional\b/, 'second'], [/\bto your left\b/, 'to your north'], [/\bloses the game\b/, 'wins the game'], [/\bcarnage or homage\b/, 'carnage or carnage'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by)}.`);
  return out;
}

describe('M12-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of M12) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('M12-3 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of M12) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual or different`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const f = parsedWith(t, mutated);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), mutated).toBe(false);
          expect(fullyAutomated(f), mutated).toBe(false);
        });
      }
    });
  }
});
