/**
 * FAST5X E26: the template data of parser/templates/zz-fast5x/e26.json: "<spells> you cast have improvise" (CR 702.126a, 613.1f) and hideaway's "you may play
 * the exiled card without paying its mana cost" with its condition (CR 702.75a, 607.2a, 608.2c). The keyword lines themselves ("Impending 4--{1}{U}{U}",
 * "Paradigm", "Miracle {2}", "Hideaway 4", "Improvise") are the generic keyword line (kw.line) with the keyword library's data. Guard G9 (design 6.8): every
 * example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON;
 * a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, EXILED_LINK, EXILED_LINK_KEYWORDS, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e26 from '../../../src/parser/templates/zz-fast5x/e26.json';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { keywordRegistry } from '../../../src/keywords/registry';
import { automated, bare, fullyAutomated, jsonKey } from '../../m5/templates/support';

const E26 = e26 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const card = (type: string, text: string) => ({ name: 'Example Engine', layout: 'normal', type_line: type, oracle_text: text, power: '3', toughness: '4' }) as never;
const face = (text: string, type = 'Artifact') => parseCard(card(type, text), OPTS).faces[0]!;

describe('E26 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e26.json, path order: after e24.json, before e3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files.indexOf('zz-fast5x/e26.json')).toBeGreaterThan(files.indexOf('zz-fast5x/e24.json'));
    expect(files.indexOf('zz-fast5x/e26.json')).toBeLessThan(files.indexOf('zz-fast5x/e3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites its keyword rule, has at least two examples and two counter-examples, is stable and of version 8', () => {
    expect(E26.length).toBe(3);
    for (const t of E26) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.e26\./);
      expect(t.cr.some((c) => /^CR 702\.(126a|75a)$/.test(c)), t.id).toBe(true);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E26) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'first', 'rather', 'though', 'additional']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
  it('CR 607.2a: the hideaway expansion records the card it exiles under the link "the exiled card" reads (parser/parse.ts#EXILED_LINK_KEYWORDS)', () => {
    for (const name of EXILED_LINK_KEYWORDS) {
      const data = JSON.stringify(keywordRegistry.get(name)!.expand);
      expect(data, name).toContain(`"link":"${EXILED_LINK}"`);
    }
  });
});

describe('E26 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E26) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, `${e.text}: ${JSON.stringify(f.diagnostics)}`).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('E26 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of E26) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1;
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          if (/^~/.test(w) || /^\{/.test(w)) return;
          const bad = w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), bad, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(fullyAutomated(face(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});
