/**
 * FAST4 T27: the template data of parser/templates/zz-fast4/t27.json (trigger clauses with a condition of the event, "while ..." and "during ... turn",
 * `TriggerDef.while`; "for the first time each turn", `TriggerDef.first`; "you gain or lose life", "an opponent is dealt noncombat damage", "a player discards
 * one or more cards", "a noncreature or <subtype> spell", "another <subtype> and/or artifact"), the intervening "if" clauses the package added to the hole
 * grammars ("you cast it", "another creature entered the battlefield under your control this turn", "there's a <card> in your graveyard", "a creature with a
 * counter on it"; CR 603.4) and the renderer readings they needed (design 6.8 G6).
 *
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or
 * parses to different JSON. Examples are synthetic wordings (design 6.10). Parsed with the default template set (parser/template-set.ts).
 */
import { describe, expect, it } from 'vitest';
import { PROMO2_PROMOTED } from '../../fast5/promo2/evidence';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t27 from '../../../src/parser/templates/zz-fast4/t27.json';
import { compileCard, type OracleCard } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';

const T27 = t27 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
type Ab = { kind: string; trigger?: Record<string, unknown>; interveningIf?: unknown; effect?: { steps: unknown[] } };
/** The one triggered ability of a face, fully automated and through the render gate. */
function trig(text: string, type = 'Creature — Example'): Ab {
  const f = face(type, text);
  expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics.filter((d) => d.level === 'manual'))} ${JSON.stringify(f.gate.filter((g) => !g.ok))}`).toBe(true);
  const t = (bare(f.abilities) as Ab[]).filter((a) => a.kind === 'triggered');
  expect(t.length, text).toBe(1);
  return t[0]!;
}
const notAutomated = (text: string, type = 'Creature — Example'): boolean => !fullyAutomated(face(type, text));

describe('T27 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t27.json, after t26) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t27.json');
    expect(files.indexOf('zz-fast4/t27.json')).toBeGreaterThan(files.indexOf('zz-fast4/t26.json'));
    expect(files.indexOf('zz-fast4/t27.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template is a trigger clause that cites rules, has two examples and two counter-examples, a status, and is of version 7', () => {
    expect(T27.length).toBe(12);
    for (const t of T27) {
      expect(t.kind, t.id).toBe('trigger');
      expect(t.id, t.id).toMatch(/^trg\.t27\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
    // stable only with at least three real cards verified by hand (test/m5/golden/cards/fast4-t27-review.json, design 6.9)
    expect(T27.filter((t) => t.status === 'stable').map((t) => t.id).sort()).toEqual([
      'trg.t27.attacks.while', 'trg.t27.cast.opponentsTurn', 'trg.t27.life.gain.firstEachTurn', 'trg.t27.opponent.dealtNoncombatDamage', 'trg.t27.targeted.youControl.firstEachTurn',
      ...Object.keys(PROMO2_PROMOTED).filter((id) => id.includes('.t27.')), // FAST5 PROMO2 (test/fast5/promo2/evidence.ts)
    ].sort());
  });
  it('a template whose output has a condition of the event or a first time names the capability it needs', () => {
    for (const t of T27) {
      const b = JSON.stringify(t.build);
      if (b.includes('"while"')) expect(t.needs, t.id).toContain('feature:trigger.while');
      if (b.includes('"first"')) expect(t.needs, t.id).toContain('feature:trigger.first');
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T27) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z'/]+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'while', 'during', 'first']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T27 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T27) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // FAST4 T28 merge: the filter hole now reads "<subtype> and/or <card type>" (CR 205.2a, 205.3), so the generic trg.when gives this template's very
        // trigger (checked by `expect` below); either may consume the clause
        if (t.id === 'trg.t27.anotherSubtypeAndOrArtifact.enters') expect([t.id, 'trg.when'].some((id) => f.templatesUsed.includes(id)), e.text).toBe(true);
        else expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect((bare(f.abilities) as Ab[]).find((a) => a.kind === 'triggered')!.trigger, e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('T27 trigger clauses: a condition of the event is no intervening "if" (CR 603.1, 603.2, 603.4)', () => {
  it('"while you control ..." is `trigger.while`, never `interveningIf`; "if you control ..." stays the intervening "if"', () => {
    const w = trig('Whenever ~ attacks while you control a creature with power 4 or greater, ~ gets +1/+0 until end of turn.');
    expect(w.interveningIf).toBeUndefined();
    expect(w.trigger).toEqual({ on: [{ ev: 'attacks', attacker: { self: true } }], while: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], power: { op: '>=', value: 4 }, controller: 'you' } } } });
    const i = trig('Whenever ~ attacks, if you control a creature with power 4 or greater, ~ gets +1/+0 until end of turn.');
    expect(i.trigger).toEqual({ on: [{ ev: 'attacks', attacker: { self: true } }] });
    expect(i.interveningIf).toEqual(w.trigger!['while']);
  });
  it('"during an opponent\'s turn", "during your turn" are a condition of the turn; "for the first time during each of your turns" is the first time with it', () => {
    expect(trig("Whenever you cast a spell during an opponent's turn, draw a card.").trigger).toEqual({ on: [{ ev: 'cast', player: 'you' }], while: { cond: 'turnOf', whose: 'opponent' } });
    expect(trig('Whenever you gain or lose life during your turn, draw a card.').trigger!['while']).toEqual({ cond: 'turnOf', whose: 'you' });
    expect(trig('Whenever you gain life for the first time during each of your turns, draw a card.').trigger).toEqual({ on: [{ ev: 'life', change: 'gain', player: 'you' }], first: 'turn', while: { cond: 'turnOf', whose: 'you' } });
  });
  it('the event hole alone does not read these clauses (trg.when keeps its counter-examples)', () => {
    // FAST5X E3: "attacks while saddled" is read by the event hole now (CR 702.171b, parser/holes/event.ts); another "while" is not
    expect(notAutomated('Whenever ~ attacks while tapped, draw two cards.')).toBe(true);
    // CLOUD std-fdn reads "Whenever ~ attacks for the first time each turn" (trg.stdfdn.attacks.firstEachTurn); another event of the object is still not read
    // std-rx19 (changed on purpose): any event of the event hole with "for the first time each turn" is read now (trg.stdrx19.event.firstEachTurn, `first: 'turn'`)
    expect(trig('Whenever ~ blocks for the first time each turn, draw two cards.').trigger).toEqual({ on: [{ ev: 'blocks', blocker: { self: true } }], first: 'turn' });
    expect(trig('Whenever you lose life for the first time each turn, draw a card.').trigger).toEqual({ on: [{ ev: 'life', change: 'loss', player: 'you' }], first: 'turn' });
  });
  it('valiant: "it" in "it gets +0/+2" is the object (CR 611.2c: the continuous effect of a resolving ability affects permanents only); the spell is never it', () => {
    const a = trig('Whenever ~ becomes the target of a spell or ability you control for the first time each turn, it gets +0/+2 until end of turn.');
    expect(a.trigger).toEqual({ on: [{ ev: 'becomes', what: 'targeted', object: { self: true }, by: { controller: 'you' } }], first: 'turn' });
    expect(JSON.stringify(a.effect)).toContain('"affects":{"ref":"event","role":"subject"}');
    // an effect that may concern the spell keeps the pronoun unresolved: never silently the creature
    expect(notAutomated('Whenever ~ becomes the target of a spell or ability you control for the first time each turn, counter it.')).toBe(true);
  });
  it('"a Mount or Vehicle you control" (one article for a list of subtypes) and "another Villain and/or artifact" pass the render gate', () => {
    expect(trig('Whenever a Mount or Vehicle you control attacks, put a +1/+1 counter on it.').trigger).toEqual({ on: [{ ev: 'attacks', attacker: { subtypes: ['Mount', 'Vehicle'], controller: 'you' } }] });
    expect(trig('Whenever another Villain and/or artifact you control enters, draw a card.').trigger).toEqual({ on: [{ ev: 'zoneChange', subject: { other: true, controller: 'you', anyOf: [{ subtypes: ['Villain'] }, { types: ['Artifact'] }] }, to: 'battlefield' }] });
  });
});

describe('T27 intervening "if" clauses (CR 603.4) added to the Cond hole', () => {
  it('"if you cast it": the cast record of the object itself, cast by the ability\'s controller (CR 601.2a)', () => {
    const a = trig('When ~ enters, if you cast it, draw a card.');
    expect(a.interveningIf).toEqual({ cond: 'wasCast', by: 'you' });
    // cloud std-tdm (CR 601.2a, 603.4): in an enters trigger about another creature, "it" is the creature that entered, whose own cast record is read (`wasCast.object`)
    expect(trig('Whenever another creature you control enters, if you cast it, draw a card.').interveningIf).toEqual({ cond: 'wasCast', by: 'you', object: { ref: 'event', role: 'subject' } });
    // anywhere else "it" is not an object that was cast as it entered, and the line stays manual
    expect(notAutomated('Whenever another creature you control dies, if you cast it, draw a card.')).toBe(true);
  });
  it('"if another creature entered the battlefield under your control this turn": not the object itself (history `other`)', () => {
    expect(trig('Whenever ~ attacks, if another creature entered the battlefield under your control this turn, draw a card.').interveningIf).toEqual({
      cond: 'happened', event: { ev: 'zoneChange', subject: { types: ['Creature'], other: true, controller: 'you' }, to: 'battlefield' }, scope: 'turn',
    });
  });
  it('"if there\'s a Lesson card in your graveyard" and "if you control a creature with a counter on it" (a counter of any kind, CR 122.1)', () => {
    expect(trig("When ~ dies, if there's a Lesson card in your graveyard, draw a card.").interveningIf).toEqual({ cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Lesson'], isCard: true, zone: 'graveyard', owner: 'you' } } });
    expect(trig('Whenever ~ attacks, if you control a creature with a counter on it, draw a card.').interveningIf).toEqual({ cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], counters: { kind: 'any' }, controller: 'you' } } });
  });
  it('"if you control at least five other Forests" in an enters trigger about a Forest: "other" there is the entering Forest, not the source (FAST5 T62 reads it so)', () => {
    // T27 left this manual; FAST5 T62 (parser/lower/ability.ts#otherThanEventSubject) reads "other" as "not the object of the event" when the source cannot itself be one
    // of the Forests (a land that is no Forest), and keeps leaving it as it was written before ("other than the source") when it could
    const f = trig('Whenever a Forest you control enters, if you control at least five other Forests, draw a card.', 'Land');
    expect(f.interveningIf).toEqual({ cond: 'exists', atLeast: 5, of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you', not: { is: { ref: 'event', role: 'subject' } } } } });
  });
});

describe('T27 capabilities (design 5.2)', () => {
  const def = (text: string) => compileCard({ name: 'Example Capable', layout: 'normal', mana_cost: '{1}', type_line: 'Creature — Example', oracle_text: text, power: '1', toughness: '1', colors: [] } as OracleCard);
  it('the compiled cards are automated in this build: trigger.while, trigger.first, wasCast.by are engine capabilities', () => {
    for (const text of [
      'Whenever ~ attacks while you control a token, draw a card.',
      'Whenever you gain life for the first time each turn, draw a card.',
      'When ~ enters, if you cast it, draw a card.',
    ]) expect(def(text).automation.level, text).not.toBe('manual');
  });
});
