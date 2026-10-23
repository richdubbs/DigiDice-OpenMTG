/**
 * MX3: the template data of parser/templates/zz-fast5/mx3.json ("the Ring tempts you", "as long as C, ~ must be blocked if able") and the hole grammar it
 * relies on ("your Ring-bearer", "a Ring-bearer", "~ is your Ring-bearer", "you chose a creature other than ~ as your Ring-bearer", the trigger events "the
 * Ring tempts you" and "you choose a creature as your Ring-bearer"). Guard G9 (design 6.8): every example lowers with its template, is automated and passes
 * the exact render gate (G6); every counter-example does not parse or parses to different JSON; a nonsense word in place of any word of an example never
 * leaves an automated ability (G2). Their cards are played in test/mx3/ring.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../src/parser/parse';
import { validateTemplates } from '../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../src/parser/template-set';
import { compileCard, ENGINE_CAPABILITIES, type OracleCard } from '../../src/index';
import mx3 from '../../src/parser/templates/zz-fast5/mx3.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../m5/templates/support';

const MX3 = mx3 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES }); // the templates that name an engine capability (`needs`) apply
/** A triggered example or a static ability is a creature's; everything else as the shared helper makes it. */
const cardOf = (t: Template, text: string) =>
  (/^(when|whenever|at)\b/i.test(text) || t.kind === 'static' ? { ...exampleCard(t, text), type_line: 'Creature — Halfling', power: '2', toughness: '2' } : exampleCard(t, text));
const parsedWith = (t: Template, text: string) => parseCard(cardOf(t, text), OPTS).faces[0]!;

describe('MX3 template file (design 6.3, 6.9)', () => {
  it('is loaded by the default compiler (zz-fast5/mx3.json, after zz-fast4/, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/mx3.json');
    expect(files.indexOf('zz-fast5/mx3.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/mx3.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('every template cites rules, has two examples and two counter-examples, is stable, of version 7, and lists its critical words', () => {
    expect(MX3.map((t) => t.id).sort()).toEqual(['abl.mx3.aslong.mustBeBlocked', 'eff.mx3.ring.tempts']);
    for (const t of MX3) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect([t.status, t.since], t.id).toEqual(['stable', 7]);
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'must']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w === 'if' && t.pattern.includes('if able') ? 'if able' : w);
      }
    }
  });
});

describe('MX3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MX3) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
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

describe('MX3 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of MX3) {
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

/** Synthetic Oracle-style wordings through the default compiler (design 6.10: invented, never a card's line). */
const compile = (type: string, text: string, pt?: [string, string]) =>
  compileCard({ name: 'Test Card', layout: 'normal', type_line: type, oracle_text: text, mana_cost: '{0}', colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const abilities = (type: string, text: string, pt?: [string, string]) => compile(type, text, pt).faces[0]!.abilities as unknown[];
const isFull = (type: string, text: string, pt?: [string, string]) => compile(type, text, pt).automation.level === 'full';
/** No manual node in the abilities (a card may still be capped at partial by an experimental template it also uses, design 6.9). */
const understood = (type: string, text: string, pt?: [string, string]) => !JSON.stringify(compile(type, text, pt).faces[0]!.abilities).includes('"manual"');
const ELF = 'Creature — Elf';
const ONE: [string, string] = ['1', '1'];

describe('MX3 hole grammar: the Ring-bearer and the Ring tempting you', () => {
  it('trigger events (parser/holes/event.ts): "whenever the Ring tempts you" and "whenever you choose a creature as your Ring-bearer"', () => {
    expect(abilities('Enchantment', 'Whenever the Ring tempts you, you gain 3 life.')[0]).toMatchObject({ trigger: { on: [{ ev: 'action', verb: 'ringTempts', actor: 'you' }] } });
    expect(abilities('Enchantment', 'Whenever you choose a creature as your Ring-bearer, you gain 3 life.')[0]).toMatchObject({
      trigger: { on: [{ ev: 'action', verb: 'ringTempts', actor: 'you', object: { types: ['Creature'] } }] },
    });
    expect(isFull('Enchantment', 'Whenever the Ring tempts you, you gain 3 life.')).toBe(true);
    expect(isFull('Enchantment', 'Whenever you choose a creature as your Ring-bearer, you gain 3 life.')).toBe(true);
    expect(isFull('Enchantment', 'Whenever an opponent chooses a creature as their Ring-bearer, you gain 3 life.')).toBe(false);
    expect(isFull('Enchantment', 'Whenever the Ring tempts an opponent, you gain 3 life.')).toBe(false);
  });

  it('"if you chose a creature other than ~ as your Ring-bearer" is the event\'s chosen creature, other than the source (CR 603.4)', () => {
    const text = 'Whenever the Ring tempts you, if you chose a creature other than ~ as your Ring-bearer, you gain 3 life.';
    expect(abilities(ELF, text, ONE)[0]).toMatchObject({ interveningIf: { cond: 'matches', object: { ref: 'event', role: 'subject' }, filter: { other: true } } });
    expect(isFull(ELF, text, ONE)).toBe(true);
    // only under a trigger on the Ring tempting you: elsewhere there is no chosen creature to name, and the render gate refuses it
    expect(isFull(ELF, 'Whenever you scry, if you chose a creature other than ~ as your Ring-bearer, you gain 3 life.', ONE)).toBe(false);
  });

  it('"your Ring-bearer" is one permanent (CR 701.54e): a reference, its power, "~ is your Ring-bearer" and "you don\'t control a Ring-bearer"', () => {
    expect(abilities('Sorcery', 'Put two +1/+1 counters on your Ring-bearer.')[0]).toMatchObject({ effect: { steps: [{ op: 'putCounters', on: { ref: 'each', filter: { ringBearer: 'you' } } }] } });
    expect(isFull('Sorcery', 'Put two +1/+1 counters on your Ring-bearer.')).toBe(true);
    expect(understood('Sorcery', 'Target player mills cards equal to your Ring-bearer\'s power.')).toBe(true);
    expect(abilities(ELF, 'As long as ~ is your Ring-bearer, it has flying.', ONE)[0]).toMatchObject({ condition: { cond: 'matches', object: { ref: 'self' }, filter: { ringBearer: 'you' } } });
    expect(isFull(ELF, 'As long as ~ is your Ring-bearer, it has flying.', ONE)).toBe(true);
    const enters = 'When ~ enters, if you don\'t control a Ring-bearer, you gain 3 life.';
    expect(abilities(ELF, enters, ONE)[0]).toMatchObject({ interveningIf: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { ringBearer: 'any', controller: 'you' } } } } });
    expect(isFull(ELF, enters, ONE)).toBe(true);
  });
});
