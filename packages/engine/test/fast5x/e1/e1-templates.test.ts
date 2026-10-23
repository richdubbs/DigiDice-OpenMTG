/**
 * FAST5X E1: the template data of parser/templates/zz-fast5x/e1.json (gift keyword lines, the gift and bargain riders "also" and "instead", the bargain
 * cost reduction, "whenever you give a gift", and the shapes of the gift, bargain and spree cards of the package) and the parser and renderer readings
 * they needed: the gift and bargain conditions (parser/holes/cond.ts, render/cond.ts), the Spree modes (parser/lower/ability.ts#withModes,
 * render/program.ts), "outlaw" (CR 700.12), the "also" reading (render/steps-flow.ts#withAlso) and the announcement-time "instead" fold
 * (render/self-replacement.ts#isCastChoice, parser/lower/riders.ts). Guard G9 (design 6.8): every example lowers with its template, is fully automated and
 * passes the exact render gate; every counter-example does not parse or parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e1 from '../../../src/parser/templates/zz-fast5x/e1.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';

const E1 = e1 as Template[];
const OPTS = defaultParseOptions();

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At)\b/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const effectOf = (text: string, type?: string): { targets: unknown[]; steps: unknown[]; modes?: unknown } => {
  const a = parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as { effect: { targets: unknown[]; steps: unknown[]; modes?: unknown } };
  return a.effect;
};

describe('E1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e1.json, path order: after zz-fast4/, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e1.json');
    expect(files.indexOf('zz-fast5x/e1.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5x/e1.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    expect(E1.length).toBe(17);
    for (const t of E1) {
      expect(t.id, t.id).toMatch(/^(kw|eff|rid|cm|trg)\.fast5x\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'also', 'extra', "can't"]) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('E1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E1) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('E1 lowering: what the shapes mean', () => {
  const gift = { cond: 'wasCast', kicked: 'gift' };
  const bargain = { cond: 'wasCast', kicked: 'bargain' };
  it('CR 702.174a, 702.174d-i: "Gift a card", "Gift a tapped Fish", "Gift an extra turn" are the gift keyword with the gift as its quality', () => {
    for (const [line, quality] of [['Gift a card', 'a card'], ['Gift a Food', 'a Food'], ['Gift a Treasure', 'a Treasure'], ['Gift a tapped Fish', 'a tapped Fish'], ['Gift an Octopus', 'an Octopus'], ['Gift an extra turn', 'an extra turn']] as const) {
      expect(parsed(line).abilities[0], line).toMatchObject({ kind: 'keyword', keyword: 'gift', quality });
    }
  });
  it('CR 702.174k, 702.166b: "the gift was promised", "the gift wasn\'t promised", "this spell was bargained" read the cast record by the cost\'s name', () => {
    expect(effectOf('Destroy target creature. If the gift wasn\'t promised, you lose 2 life.').steps[1]).toMatchObject({ op: 'if', cond: { cond: 'not', of: gift } });
    expect(effectOf('Draw a card. If this spell was bargained, draw two cards instead.').steps[0]).toMatchObject({ op: 'if', cond: bargain });
    const trig = parsed('When ~ enters, if it was bargained, you gain 3 life.').abilities[0] as unknown as { interveningIf: unknown };
    expect(trig.interveningIf).toEqual(bargain);
  });
  it('CR 601.2f, 702.166b: "~ costs {2} less to cast if it\'s bargained" is a self cost reduction whose condition is the bargain', () => {
    expect(parsed("~ costs {2} less to cast if it's bargained.").abilities[0]).toMatchObject({
      kind: 'static', zone: ['stack'], condition: bargain, effects: [{ s: 'costMod', applies: { self: true }, change: { kind: 'reduce', generic: 2 } }],
    });
  });
  it('CR 614.15, 601.2c, 702.174m: "Y. If the gift was promised, instead X." chooses at announcement: Y\'s target only without the gift, X\'s only with it', () => {
    const e = effectOf('Tap target creature. If the gift was promised, instead tap up to two target creatures.');
    expect(e.targets).toMatchObject([{ id: 't0', onlyIf: { cond: 'not', of: gift } }, { id: 't1', min: 0, max: 2, onlyIf: gift }]);
    expect(e.steps).toEqual([{ op: 'if', cond: gift, then: [{ op: 'tap', what: { ref: 'target', id: 't1' } }], else: [{ op: 'tap', what: { ref: 'target', id: 't0' } }] }]);
  });
  it('CR 614.15: a condition read while the spell resolves still folds only a same-instruction replacement (the announcement-time relaxation is for cast-record conditions)', () => {
    const f = parsed('Tap target creature. If you control an Elf, instead tap up to two target creatures.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('CR 608.2c: "that creature also gains ..." is the grant under the condition; "also" adds nothing else', () => {
    expect(effectOf('Target creature gets +1/+1 until end of turn. If ~ was bargained, that creature also gains trample until end of turn.').steps[1]).toEqual({
      op: 'if', cond: bargain, then: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'trample', text: 'trample' }] }] }] }],
    });
  });
  it('CR 702.172a, 700.2h: the "+ {cost} -- effect" lines of a Spree spell are its modes: one or more, each with its cost', () => {
    const card = exampleCard('Spree\n+ {1} — Target player draws a card.\n+ {2}{R} — Example Subject deals 2 damage to any target.', 'Instant');
    const face = parseCard(card, OPTS).faces[0]!;
    expect(face.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'spree' });
    const spell = face.abilities[1] as unknown as { effect: { modes: { min: number; max: number; options: { cost: unknown }[] } } };
    expect(spell.effect.modes).toMatchObject({ min: 1, max: 2 });
    expect(spell.effect.modes.options.map((o) => o.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 1 }] }, { mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'R' }] }]);
    expect(face.gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 700.12: "outlaw creature" is a creature with any of the five outlaw creature types; "non-outlaw" is none of them', () => {
    const outlaws = ['Assassin', 'Mercenary', 'Pirate', 'Rogue', 'Warlock'];
    expect(effectOf('~ deals 1 damage to each outlaw creature.').steps[0]).toMatchObject({ to: { ref: 'each', filter: { types: ['Creature'], subtypes: outlaws } } });
    expect(effectOf('~ deals 1 damage to each non-outlaw creature.').steps[0]).toMatchObject({ to: { ref: 'each', filter: { types: ['Creature'], notSubtypes: outlaws } } });
    expect(fullyAutomated(parsed('~ deals 1 damage to each non-outlaw creature.'))).toBe(true);
  });
});
