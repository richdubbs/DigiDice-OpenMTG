/**
 * M6-8 (m6 design 4.2, 5 "M6-8"): the template data of parser/templates/zz-m6/text.json ("Change the text of target spell or permanent by replacing all
 * instances of one color word / basic land type / creature type with another", and Artificial Evolution's rider "The new creature type can't be Wall."), with
 * the readings it needed: the Obj hole's "target spell or permanent" (parser/holes/object.ts), the rider directive "@step" (parser/lower/riders.ts) and the
 * renderer's fold (render/fold.ts#textChange). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate
 * (G6); every counter-example does not parse or parses to different JSON; a nonsense word in place of any word of an example never leaves an automated
 * ability (G2). Examples are synthetic wordings (design 6.10). Parsed with the default template set (what the game compiles with).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import text from '../../../src/parser/templates/zz-m6/text.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const TEXT = text as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** Every example is a spell: an instant. */
const exampleCard = (t: string): OracleCard => card('Example Glamer', 'Instant', t, { mana_cost: '{U}' });
const parsed = (t: string) => parseCard(exampleCard(t), OPTS).faces[0]!;

describe('M6-8 template file (design 6.3, 6.9)', () => {
  it('is loaded by the default compiler (zz-m6/text.json, path order: after zz-fast*/, before zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-m6/text.json');
    expect(files.indexOf('zz-m6/text.json')).toBeGreaterThan(files.indexOf('zz-fast3/t13.json'));
    expect(files.indexOf('zz-m6/text.json')).toBeLessThan(files.indexOf('zz-push/k1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('design 6.9: every template cites rules, has two examples and two counter-examples, a status, is of version 6, and needs nothing the engine lacks', () => {
    expect(TEXT.map((t) => t.id)).toEqual(['eff.m6.text.color', 'eff.m6.text.landType', 'eff.m6.text.creatureType', 'rid.m6.text.newCreatureType.not']);
    for (const t of TEXT) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.m6\.text\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(6);
      for (const n of t.needs ?? []) expect(ENGINE_CAPABILITIES.has(n), `${t.id}: ${n}`).toBe(true);
    }
  });

  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of TEXT) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't"]) if (words.includes(w)) expect((t.consumes ?? []).includes(w), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('M6-8: what the templates build (CR 612.2, 608.2d)', () => {
  it('"target spell or permanent" is one target: an object on the stack or the battlefield (not an ability: the target kind "object")', () => {
    const f = parsed('Change the text of target spell or permanent by replacing all instances of one color word with another.');
    expect(bare(f.abilities)).toEqual([{
      kind: 'spell', text: 'Change the text of target spell or permanent by replacing all instances of one color word with another.',
      effect: {
        targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target spell or permanent', filter: { zone: ['stack', 'battlefield'] } }],
        steps: [
          { op: 'chooseValue', who: { ref: 'you' }, what: 'color', as: 'textWordFrom', link: 'textWordFrom' },
          { op: 'chooseValue', who: { ref: 'you' }, what: 'color', as: 'textWordTo', link: 'textWordTo', exclude: [{ chosen: 'textWordFrom' }] },
          { op: 'effect', effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: 3, changeWord: { kind: 'color', from: { chosen: 'textWordFrom' }, to: { chosen: 'textWordTo' } } }] }], duration: { d: 'permanent' } },
        ],
      },
    }]);
  });

  it('a basic land type is chosen among the five (CR 305.6); the rider adds Wall to the creature type choice it names with "@step"', () => {
    const land = parsed('Change the text of target permanent by replacing all instances of one basic land type with another.');
    const steps = (land.abilities[0] as unknown as { effect: { steps: { options?: string[] }[] } }).effect.steps;
    expect(steps[0]!.options).toEqual(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
    expect(steps[1]!.options).toEqual(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
    const wall = parsed('Change the text of target permanent by replacing all instances of one creature type with another. The new creature type can\'t be Wall.');
    expect(fullyAutomated(wall)).toBe(true);
    const ws = (wall.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(ws.map((x) => x['op'])).toEqual(['chooseValue', 'chooseValue', 'effect']);
    expect(ws[1]!['exclude']).toEqual([{ chosen: 'textWordFrom' }, 'Wall']);
    expect(ws[0]!['exclude']).toBeUndefined();
  });

  it('the rider alone, or after a sentence that is not a choice of creature types, stays manual', () => {
    for (const t of ["The new creature type can't be Wall.", 'Draw a card. The new creature type can\'t be Wall.', 'Change the text of target permanent by replacing all instances of one color word with another. The new creature type can\'t be Wall.']) {
      expect(fullyAutomated(parsed(t)), t).toBe(false);
    }
  });
});

describe('M6-8 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of TEXT) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('M6-8 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of TEXT) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual or changes it`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const f = parsed(mutated);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), mutated).toBe(false);
        });
      }
    });
  }
});
