/**
 * FAST4 T23: the template data of parser/templates/zz-fast4/t23.json (trigger clauses: "you cast a <color> spell or <a permanent> enters", "a spell that's
 * both <color> and <color>", "a spell of the chosen color"; and "~ has base power and toughness X/Y until end of turn and gains <keyword> until end of turn"),
 * the intervening "if" clauses the package added to the `Cond` hole (parser/holes/cond.ts: zoneHistory, t23Misc, CR 603.4), the trigger events added to the
 * `Event` hole (parser/holes/event.ts: "one or more creature cards leave your graveyard", CR 603.10a) and the filter "a spell that targets a creature"
 * (parser/holes/filter.ts, CR 115.9b), with the renderer readings they needed (design 6.8 G6: render/cond.ts, render/evt.ts, render/np.ts, render/mods.ts).
 *
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or
 * parses to different JSON. Examples are synthetic wordings (design 6.10). Parsed with the default template set (parser/template-set.ts).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t23 from '../../../src/parser/templates/zz-fast4/t23.json';
import { compileCard } from '../../../src/index';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';

const T23 = t23 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
type Ab = { kind: string; trigger?: { on: unknown[]; batch?: boolean }; interveningIf?: unknown; effect?: { steps: unknown[] } };
/** The one triggered ability of a face, fully automated and through the render gate. */
function trig(text: string, type = 'Creature — Example'): Ab {
  const f = face(type, text);
  expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics.filter((d) => d.level === 'manual'))} ${JSON.stringify(f.gate.filter((g) => !g.ok))}`).toBe(true);
  const abs = bare(f.abilities) as Ab[];
  const t = abs.filter((a) => a.kind === 'triggered');
  expect(t.length, text).toBe(1);
  return t[0]!;
}
const notAutomated = (text: string, type = 'Creature — Example'): boolean => !fullyAutomated(face(type, text));

describe('T23 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t23.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t23.json');
    expect(files.indexOf('zz-fast4/t23.json')).toBeGreaterThan(files.indexOf('zz-fast4/t22.json'));
    expect(files.indexOf('zz-fast4/t23.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T23.length).toBe(4);
    for (const t of T23) {
      expect(['trigger', 'effect'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(trg|eff)\.t23\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T23) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't"]) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T23 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T23) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('T23 trigger clauses (CR 603.2, 601.2i, 105.2, 607.2a)', () => {
  it('"you cast a green spell or a Forest you control enters" is either event: a cast of a green spell by you, or a Forest you control entering', () => {
    const a = trig('Whenever you cast a green spell or a Forest you control enters, you gain 1 life.', 'Artifact');
    expect(a.trigger!.on).toEqual([
      { ev: 'cast', player: 'you', spell: { colors: ['G'] } },
      { ev: 'zoneChange', subject: { subtypes: ['Forest'], controller: 'you' }, to: 'battlefield' },
    ]);
  });
  it('"a spell that\'s both green and blue" is a spell of each color (one color AND the other, not either)', () => {
    const a = trig("Whenever you cast a spell that's both green and blue, ~ has base power and toughness 5/3 until end of turn and gains trample until end of turn.");
    expect(a.trigger!.on).toEqual([{ ev: 'cast', player: 'you', spell: { colors: ['G'], anyOf: [{ colors: ['U'] }] } }]);
    // CR 613.4b (layer 7b) and 613.1f (layer 6), one effect until end of turn (CR 514.2)
    expect(a.effect!.steps).toEqual([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7b', power: 5, toughness: 3 }, { layer: 6, add: [{ kind: 'keyword', keyword: 'trample', text: 'trample' }] }] }] }]);
  });
  it('"a spell of the chosen color" reads the color chosen as ~ entered (the link "color", CR 607.2a); without the choice it is not automated', () => {
    const f = face('Creature — Horse', 'As ~ enters, choose a color.\nWhenever you cast a spell of the chosen color, you gain 1 life.');
    expect(fullyAutomated(f)).toBe(true);
    const a = (bare(f.abilities) as Ab[]).find((x) => x.kind === 'triggered')!;
    expect(a.trigger!.on).toEqual([{ ev: 'cast', player: 'you', spell: { chosen: { link: 'color', quality: 'color' } } }]);
    // the card lint (model/lint-card.ts, CR 607.1) finds no producer of the link: the compiled card is not automated
    const lone = compileCard({ name: 'Example Lone', layout: 'normal', mana_cost: '{1}', type_line: 'Creature — Horse', oracle_text: 'Whenever you cast a spell of the chosen color, you gain 1 life.', colors: [] } as never);
    expect(lone.automation.level).toBe('manual');
  });
  it('"one or more creature cards leave your graveyard" is one batch of cards you own leaving a graveyard (CR 400.3, 603.2c, 603.10a)', () => {
    const a = trig('Whenever one or more creature cards leave your graveyard, each opponent loses 1 life and you gain 1 life.', 'Enchantment');
    expect(a.trigger).toEqual({ on: [{ ev: 'zoneChange', subject: { types: ['Creature'], isCard: true, owner: 'you' }, from: 'graveyard' }], batch: true });
    // only cards: "~ leaves your graveyard" and a permanent's description are not read this way
    expect(notAutomated('Whenever one or more creatures leave your graveyard, you gain 1 life.', 'Enchantment')).toBe(true);
  });
  it('"~ or another nontoken Cat you control enters" is two events: ~ entering (a token copy of it too) and another nontoken Cat you control entering', () => {
    const a = trig('Whenever ~ or another nontoken Cat you control enters, create a 1/1 white Cat creature token.', 'Legendary Creature — Cat');
    expect(a.trigger!.on).toEqual([
      { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' },
      { ev: 'zoneChange', subject: { other: true, token: false, subtypes: ['Cat'], controller: 'you' }, to: 'battlefield' },
    ]);
  });
  it('"an instant or sorcery spell that targets a creature": one of the spell\'s targets is a creature (CR 115.9b)', () => {
    const a = trig('Whenever you cast an instant or sorcery spell that targets a creature, put a +1/+1 counter on ~.');
    expect(a.trigger!.on).toEqual([{ ev: 'cast', player: 'you', spell: { types: ['Instant', 'Sorcery'], targets: { ref: 'each', filter: { types: ['Creature'] } } } }]);
  });
});

describe('T23 intervening "if" clauses (CR 603.4)', () => {
  const at = (cond: string, effect = 'draw a card.', step = 'At the beginning of your end step'): Ab => trig(`${step}, if ${cond}, ${effect}`);
  it('"that player has two or fewer cards in hand": the hand of the player of the trigger event (each opponent\'s upkeep: that opponent)', () => {
    const a = trig("At the beginning of each opponent's upkeep, if that player has two or fewer cards in hand, ~ deals 3 damage to that player.");
    expect(a.interveningIf).toEqual({ cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: { ref: 'event', role: 'player' } }, op: '<=', right: 2 });
  });
  it('"a creature died under your control this turn": its controller as it last existed on the battlefield (CR 603.10a)', () => {
    expect(at('a creature died under your control this turn').interveningIf).toEqual({ cond: 'happened', event: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'graveyard' }, scope: 'turn' });
  });
  it('"three or more creatures died this turn" counts the creatures that died (each one event)', () => {
    expect(at('three or more creatures died this turn', 'draw a card.', 'At the beginning of each end step').interveningIf)
      .toEqual({ cond: 'happened', event: { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }, scope: 'turn', times: { op: '>=', value: 3 } });
  });
  it('"two or more nonland permanents entered the battlefield under your control this turn"', () => {
    expect(at('two or more nonland permanents entered the battlefield under your control this turn').interveningIf)
      .toEqual({ cond: 'happened', event: { ev: 'zoneChange', subject: { notTypes: ['Land'], controller: 'you' }, to: 'battlefield' }, scope: 'turn', times: { op: '>=', value: 2 } });
  });
  it('"a permanent left the battlefield under your control this turn"', () => {
    expect(at('a permanent left the battlefield under your control this turn', 'scry 1.').interveningIf)
      .toEqual({ cond: 'happened', event: { ev: 'zoneChange', subject: { controller: 'you' }, from: 'battlefield' }, scope: 'turn' });
  });
  it('"an opponent lost life this turn"', () => {
    expect(at('an opponent lost life this turn').interveningIf).toEqual({ cond: 'happened', event: { ev: 'life', change: 'loss', player: 'opponent' }, scope: 'turn' });
  });
  it('"you haven\'t cast a spell from your hand this turn": no spell you cast from your hand', () => {
    expect(at("you haven't cast a spell from your hand this turn", 'draw a card, then discard a card.').interveningIf)
      .toEqual({ cond: 'not', of: { cond: 'happened', event: { ev: 'cast', player: 'you', from: 'hand' }, scope: 'turn' } });
  });
  it('"~ didn\'t enter the battlefield this turn": the object itself (CR 400.7)', () => {
    expect(at("~ didn't enter the battlefield this turn", "return it to its owner's hand.").interveningIf).toEqual({ cond: 'matches', object: { ref: 'self' }, filter: { enteredThisTurn: false } });
  });
  it('"creatures you control have total power 8 or greater" (CR 208.1)', () => {
    expect(at('creatures you control have total power 8 or greater', 'target creature you control gains haste until end of turn.', 'At the beginning of combat on your turn').interveningIf)
      .toEqual({ cond: 'compare', left: { q: 'stat', stat: 'power', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, sum: true }, op: '>=', right: 8 });
  });
  it('"you control one or more Eggs" is printed back as written (an explicit minimum of one)', () => {
    expect(at('you control one or more Eggs', 'sacrifice an Egg, then create a 3/3 green Dinosaur creature token.', 'At the beginning of combat on your turn').interveningIf)
      .toEqual({ cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Egg'], controller: 'you' } }, atLeast: 1 });
  });
  it('near misses stay manual: no controller wording other than "under your control", no other count than "N or more", a cast from another zone', () => {
    // FAST5 T53 reads "a creature died under an opponent's control this turn" (CR 603.10a); a past turn stays manual.
    expect(notAutomated('At the beginning of your end step, if a creature died under an opponent\'s control last turn, draw a card.')).toBe(true);
    expect(notAutomated('At the beginning of your end step, if two or fewer creatures died this turn, draw a card.')).toBe(true);
    expect(notAutomated("At the beginning of your end step, if you haven't cast a spell from your graveyard this turn, draw a card.")).toBe(true);
    // Standard round 4, r4-trig (CR 208.1; Betor, Kin to All): the total toughness is read too now (parser/holes/cond.ts#t23Misc), so it is no near miss any more
    expect(notAutomated('At the beginning of your end step, if creatures you control have total toughness 8 or greater, draw a card.')).toBe(false);
  });
});
