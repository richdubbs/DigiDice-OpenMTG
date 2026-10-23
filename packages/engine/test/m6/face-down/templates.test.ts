/**
 * M6-3 (m6 design 4.2, 5): the template data of parser/templates/zz-m6/face.json. Guard G9 (design 6.8): every example lowers with its template, is automated
 * and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; a nonsense word in place of any word of an example
 * never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10). Parsed with the default template set (what the game compiles with).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import face from '../../../src/parser/templates/zz-m6/face.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const FACE = face as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** A synthetic card on which the example is an ability of the right kind: a creature for a static, triggered or activated ability, a sorcery otherwise. */
function exampleCard(t: Template, text: string): OracleCard {
  const type = t.kind === 'static' || /^(when|whenever|at|as) /i.test(text) || text.includes(':') ? 'Creature — Human Wizard' : 'Sorcery';
  return card('Example Veil', type, text, { mana_cost: '{2}{U}' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('M6-3 template file (design 6.3, 6.9)', () => {
  it('is loaded by the default compiler (zz-m6/face.json, path order: after zz-fast2/, before zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-m6/face.json');
    expect(files.indexOf('zz-m6/face.json')).toBeGreaterThan(files.indexOf('zz-fast2/t9.json'));
    expect(files.indexOf('zz-m6/face.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('design 6.9: every template cites rules, has two examples and two counter-examples, a status, is of version 3 and names the capabilities it needs', () => {
    for (const t of FACE) {
      expect(t.id, t.id).toMatch(/^(eff|static)\.m6\./);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(3);
      for (const n of t.needs ?? []) expect(ENGINE_CAPABILITIES.has(n), `${t.id}: ${n}`).toBe(true);
    }
  });
});

describe('M6-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of FACE) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('M6-3 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of FACE) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual or changes it`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // design 6.11: counter names are an open class
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const f = parsedWith(t, mutated);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), mutated).toBe(false);
        });
      }
    });
  }
});
