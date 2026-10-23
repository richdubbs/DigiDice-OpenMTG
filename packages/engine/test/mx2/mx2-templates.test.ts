/**
 * MX2: the template data of parser/templates/zz-fast4/mx2.json (exchange of control, the meld instruction, copies "except it has this ability"). Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; a nonsense word in place of any word of an example never leaves an automated ability (G2). Their cards are played in test/mx2/ (the
 * templates are stable with those scenarios, as the milestone 6 gate templates are: zz-m6/gate.json).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../src/parser/parse';
import { validateTemplates } from '../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../src/parser/template-set';
import mx2 from '../../src/parser/templates/zz-fast4/mx2.json';
import { automated, exampleCard, fullyAutomated, jsonKey } from '../m5/templates/support';

const MX2 = mx2 as Template[];
const OPTS = defaultParseOptions();
/** A triggered or activated example is a creature's ability; everything else as the shared helper makes it. */
const cardOf = (t: Template, text: string) =>
  (/^(when|whenever|at)\b/i.test(text) || text.includes(':') ? { ...exampleCard(t, text), type_line: 'Creature — Shapeshifter', power: '2', toughness: '2' } : exampleCard(t, text));
const parsedWith = (t: Template, text: string) => parseCard(cardOf(t, text), OPTS).faces[0]!;

describe('MX2 template file (design 6.3, 6.9)', () => {
  it('is loaded by the default compiler (zz-fast4/mx2.json, after zz-fast3/, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/mx2.json');
    expect(files.indexOf('zz-fast4/mx2.json')).toBeGreaterThan(files.indexOf('zz-fast3/t18.json'));
    expect(files.indexOf('zz-fast4/mx2.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('every template cites rules, has two examples and two counter-examples, is stable, of version 6, and lists its critical words', () => {
    expect(MX2.map((t) => t.id).sort()).toEqual([
      'eff.mx2.copy.retainColor.thisAbility', 'eff.mx2.copy.thisAbility', 'eff.mx2.exchange.control.two', 'eff.mx2.may.copy.retainColor.thisAbility',
      'eff.mx2.may.copy.thisAbility', 'eff.mx2.meld.pair', 'sta.mx2.enters.copy.retainColor.has',
    ]);
    for (const t of MX2) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect([t.status, t.since], t.id).toEqual(['stable', 6]);
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('MX2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MX2) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('MX2 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of MX2) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});
