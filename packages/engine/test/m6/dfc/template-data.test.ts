/**
 * M6-4 (m6 design 4.2, 5): the template data of parser/templates/zz-m6/dfc.json. Guard G9 (design 6.8): every example lowers with its template, is automated
 * and passes the exact render gate (G6); an example's stated JSON is what it lowers to; every counter-example does not parse or parses to different JSON; a
 * nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import dfcTemplates from '../../../src/parser/templates/zz-m6/dfc.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const DFC = dfcTemplates as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** A synthetic card on which the example is an ability: a creature for an ability with a trigger or a cost, a sorcery otherwise. */
function exampleCard(text: string): OracleCard {
  const type = /^(when|whenever|at|as) /i.test(text) || text.includes(':') ? 'Creature — Human Werewolf' : 'Sorcery';
  return card('Example Moonward', type, text, { mana_cost: '{2}{G}', power: '2', toughness: '2' });
}
const parsed = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

/** The part of the first ability an example's stated JSON describes: a trigger template's trigger, an effect template's program, or the abilities. */
function stated(t: Template, abilities: readonly AbilityDef[], expectJson: unknown): unknown {
  const a = bare(abilities) as Record<string, unknown>[];
  if (Array.isArray(expectJson)) return a;
  if (t.kind === 'trigger') return a[0]?.['trigger'];
  return a[0]?.['effect'];
}

describe('M6-4 template file (design 6.3, 6.9)', () => {
  it('is loaded by the default compiler (zz-m6/dfc.json, after zz-fast*/, before zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-m6/dfc.json');
    expect(files.indexOf('zz-m6/dfc.json')).toBeGreaterThan(files.indexOf('zz-fast3/t13.json'));
    expect(files.indexOf('zz-m6/dfc.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('design 6.9: every template cites rules, has two examples and two counter-examples, a status, is of version 6', () => {
    for (const t of DFC) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.m6\./);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(6);
      expect(['stable', 'experimental']).toContain(t.status);
    }
  });
});

describe('M6-4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of DFC) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        if (e.expect !== undefined) expect(stated(t, f.abilities, e.expect), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('M6-4 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of DFC) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual or changes it`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const f = parsed(mutated);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), mutated).toBe(false);
        });
      }
    });
  }
});
