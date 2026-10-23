/**
 * FAST5X E11: the template data of parser/templates/zz-fast5x/e11.json and the parser changes of the package (the "behold" cost part and step, "if a [quality]
 * was beheld", "cast using teamwork", "choose both instead", named and tiered modes). Guard G9 (design 6.8): every example lowers with its template, is
 * automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; a nonsense word in place of any word of an
 * example never leaves an automated ability (G2). The cards are played in e11-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { compileCard, ENGINE_CAPABILITIES, type OracleCard } from '../../../src/index';
import e11 from '../../../src/parser/templates/zz-fast5x/e11.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';

const E11 = e11 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES });
const cardOf = (t: Template, text: string) => (t.kind === 'static' && /^as ~ enters/i.test(text) ? { ...exampleCard(t, text), type_line: 'Land' } : exampleCard(t, text));
const parsedWith = (t: Template, text: string) => parseCard(cardOf(t, text), OPTS).faces[0]!;

describe('FAST5X E11 template file (design 6.3, 6.9)', () => {
  it('is loaded by the default compiler (zz-fast5x/e11.json in path order, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e11.json');
    expect(files.indexOf('zz-fast5x/e11.json')).toBeGreaterThan(files.indexOf('zz-fast5x/e1.json'));
    expect(files.indexOf('zz-fast5x/e11.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });

  it('every template cites rules, has two examples and two counter-examples, is stable, of version 8, and lists its critical words', () => {
    for (const t of E11) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect([t.status, t.since], t.id).toEqual(['stable', 8]);
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'must', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('FAST5X E11 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E11) {
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

describe('FAST5X E11 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of E11) {
    it(`${t.id}: replacing any one word of an example by an invented word changes or refuses the reading`, () => {
      for (const e of t.examples) {
        const base = parsedWith(t, e.text);
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const f = parsedWith(t, mutated);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(base.abilities), mutated).toBe(false);
          expect(fullyAutomated(f) && f.templatesUsed.includes(t.id), mutated).toBe(false);
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
const BEAR: [string, string] = ['2', '2'];

describe('FAST5X E11 hole grammar and modal headers', () => {
  it('the Cost hole: "behold a <quality>" and "behold a <quality> and exile it" (CR 701.4a); a quality that is not a type stays manual', () => {
    expect(abilities('Instant', 'As an additional cost to cast this spell, behold a Goblin.\nDraw a card.')[0]).toMatchObject({
      kind: 'static', effects: [{ s: 'additionalCost', cost: { other: [{ kind: 'behold', filter: { subtypes: ['Goblin'] }, count: 1 }] } }],
    });
    expect(abilities('Creature — Elf', 'As an additional cost to cast this spell, behold an Elf and exile it.\nWhen this creature leaves the battlefield, return the exiled card to its owner\'s hand.', BEAR)[0]).toMatchObject({
      kind: 'static', effects: [{ s: 'additionalCost', cost: { other: [{ kind: 'behold', filter: { subtypes: ['Elf'] }, exile: true, link: 'exiled' }] } }],
    });
    expect(isFull('Creature — Elf', 'As an additional cost to cast this spell, behold an Elf and exile it.\nWhen this creature leaves the battlefield, return the exiled card to its owner\'s hand.', BEAR)).toBe(true);
    expect(isFull('Instant', 'As an additional cost to cast this spell, behold a tapped Goblin.\nDraw a card.')).toBe(false);
    // CLOUD std-ecl (CR 701.4a): "behold two Goblins" is two beholds of that quality (Kindle the Inner Flame's flashback); "and exile it" stays the cost of one
    expect(abilities('Instant', 'As an additional cost to cast this spell, behold two Goblins.\nDraw a card.')[0]).toMatchObject({
      kind: 'static', effects: [{ s: 'additionalCost', cost: { other: [{ kind: 'behold', filter: { subtypes: ['Goblin'] }, count: 2 }] } }],
    });
    expect(isFull('Instant', 'As an additional cost to cast this spell, behold two Goblins and exile them.\nDraw a card.')).toBe(false);
  });

  it('the Cond hole: "if a Dragon was beheld" (CR 701.4b) and "if this spell was cast using teamwork" (CR 702.194b)', () => {
    expect(abilities('Instant', 'As an additional cost to cast this spell, you may behold a Dragon.\nDraw a card. If a Dragon was beheld, you gain 2 life.')[1]).toMatchObject({
      effect: { steps: [{ op: 'draw' }, { op: 'if', cond: { cond: 'beheld', quality: { subtypes: ['Dragon'] } } }] },
    });
    expect(abilities('Instant', 'Teamwork 2\nDraw a card. If this spell was cast using teamwork, you gain 2 life.')[1]).toMatchObject({
      effect: { steps: [{ op: 'draw' }, { op: 'if', cond: { cond: 'wasCast', kicked: 'teamwork' } }] },
    });
  });

  it('CR 700.2, 702.194b: "Choose one. If this spell was cast using teamwork, choose both instead." only over two modes and only with that condition', () => {
    const ok = 'Teamwork 2\nChoose one. If this spell was cast using teamwork, choose both instead.\n• Draw a card.\n• You gain 2 life.';
    expect(isFull('Sorcery', ok)).toBe(true);
    // FAST5X E22 (CR 700.2, 601.2b): any condition readable while the modes are chosen may change the count (parser/lower/ability.ts#conditionalModeCount)
    expect(isFull('Sorcery', 'Teamwork 2\nChoose one. If you control a Wizard, choose both instead.\n• Draw a card.\n• You gain 2 life.')).toBe(true);
    expect(isFull('Sorcery', 'Teamwork 2\nChoose one. If the moon is full, choose both instead.\n• Draw a card.\n• You gain 2 life.')).toBe(false);
    expect(isFull('Sorcery', 'Teamwork 2\nChoose one. If this spell was cast using teamwork, choose both instead.\n• Draw a card.\n• You gain 2 life.\n• Scry 1.')).toBe(false);
  });

  it('CR 207.2d: a mode\'s printed name is display data (Street Justice-style named modes); CR 702.183a: tiered modes need the keyword', () => {
    const named = 'Choose one —\n• Kind Word — You gain 2 life.\n• Sharp Word — Draw a card.';
    expect(isFull('Sorcery', named)).toBe(true);
    expect(abilities('Sorcery', named)[0]).toMatchObject({ effect: { modes: { options: [{ label: 'Kind Word' }, { label: 'Sharp Word' }] } } });
    expect(isFull('Instant', 'Tiered\n• Small — {0} — You gain 1 life.\n• Big — {2} — You gain 5 life.')).toBe(true);
    expect(isFull('Instant', '• Small — {0} — You gain 1 life.\n• Big — {2} — You gain 5 life.')).toBe(false);
  });
});
