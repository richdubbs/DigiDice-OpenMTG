/**
 * M11-4 (docs/design/m11-commander.md 8): the commander-card templates of parser/templates/zz-m11/commander.json. Guard G9 (design 6.8 of the milestone 5
 * design): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are
 * invented wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts, what the game compiles with) and no capability filter: the parser reads these shapes now;
 * the compile pipeline's degrade pass keeps every card that needs a capability of M11-1 manual until M11-1 registers it (test/m11/cards/gating.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import m11 from '../../../src/parser/templates/zz-m11/commander.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';

const M11 = m11 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('M11-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-m11/commander.json, path order: after zz-fast4/, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-m11/commander.json');
    expect(files.indexOf('zz-m11/commander.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-m11/commander.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('design 6.9: every template cites rules, has two examples and two counter-examples, is namespaced m11 and of version 8 (M11-4)', () => {
    expect(M11.map((t) => t.id)).toEqual([
      'eff.m11.mana.commanderIdentity', 'sta.m11.anthem.commanderCasts', 'eff.m11.commander.toHand.fromCommandZone', 'kw.m11.partnerWith', 'sta.m11.eminence.costLess',
    ]);
    for (const t of M11) {
      expect(t.id, t.id).toMatch(/^(eff|sta|kw)\.m11\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });

  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of M11) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'must', 'additional']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('M11-4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of M11) {
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
    [/\byour commander\b/, "an opponent's commander"], [/\byour commander\b/, 'target commander'], [/\bthe command zone\b/, 'your graveyard'], [/\bcolor identity\b/, 'colors'],
    [/\bone mana\b/, 'two mana'], [/\byou've cast\b/, 'an opponent has cast'], [/\bthis game\b/, 'this turn'], [/\bless\b/, 'more'], [/\byou cast\b/, 'your opponents cast'],
    [/\bon the battlefield\b/, 'in your graveyard'], [/\binto your hand\b/, 'onto the battlefield'], [/^Partner with\b/, 'Partner for'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by)}.`);
  return out;
}

describe('M11-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of M11) {
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

describe('M11-4 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of M11) {
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
