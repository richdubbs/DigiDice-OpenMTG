/**
 * FAST5X E24: the template data of parser/templates/zz-fast5x/e24.json, the shapes a character card's own pronoun takes once the front end has read it as
 * "~" (parser/front/selfref.ts#pronounRefs; CR 201.5, design 6.4): "~ enters with a shield counter on ~", "return ~ to the battlefield under ~'s owner's
 * control with a +1/+1 counter on ~", "~'s owner shuffles ~ into their library and draws three cards", ... Guard G9 (design 6.8): every example lowers with
 * its template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON; a nonsense word in
 * place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e24 from '../../../src/parser/templates/zz-fast5x/e24.json';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { automated, bare, fullyAutomated, jsonKey } from '../../m5/templates/support';

const E24 = e24 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const card = (type: string, text: string) => ({ name: 'Example Hero', layout: 'normal', type_line: type, oracle_text: text, power: '2', toughness: '2' }) as never;
const TYPE = 'Legendary Creature — Human Hero';
const face = (text: string, type = TYPE) => parseCard(card(type, text), OPTS).faces[0]!;

describe('E24 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e24.json, path order: after e2.json, before e3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e24.json');
    expect(files.indexOf('zz-fast5x/e24.json')).toBeGreaterThan(files.indexOf('zz-fast5x/e2.json'));
    expect(files.indexOf('zz-fast5x/e24.json')).toBeLessThan(files.indexOf('zz-fast5x/e3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites CR 201.5 and its own rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(E24.length).toBeGreaterThanOrEqual(9);
    for (const t of E24) {
      expect(t.id, t.id).toMatch(/^(abl|sta|eff)\.e24\./);
      expect(t.cr, t.id).toContain('CR 201.5');
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E24) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'first', 'rather', 'though', 'additional']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('E24 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E24) {
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

describe('E24 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of E24) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?$/.test(words[i + 1] ?? '')) return; // CR 122.1: any word can name a kind of counter
          const bad = w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty';
          const mutated = [...words.slice(0, i), bad, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(face(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});
