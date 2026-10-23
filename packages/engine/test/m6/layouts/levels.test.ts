/**
 * M6-6 (m6 design 3.7 "Class", "Leveler", 5 "M6-6"): Class levels (CR 716) and leveler brackets (CR 711, 702.87) as the abilities they stand for
 * (statics/levels.ts, keys `x:<face>:<index>:<n>`), driven by real actions on fixture cards (Student of Warfare, Bard Class) and synthetic cards compiled by
 * the game path.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, ptNumbers, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { advanceTo, find, scenario } from '../../m3/scenario';
import { tweak } from '../../m5/helpers';
import { activate, cast, drive, resolveTop, target } from '../../m5/cr-examples/helpers';

function card(name: string, layout: string, typeLine: string, manaCost: string, lines: string[], pt?: [string, string]): CardDef {
  return compileCard({ name, layout, type_line: typeLine, mana_cost: manaCost, oracle_text: lines.join('\n'), colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}

/** A Class (CR 716) whose level 2 gives creatures +1/+1 and level 3 trample. */
const GROVE = card('Test Grove Class', 'class', 'Enchantment — Class', '{G}', [
  '(Gain the next level as a sorcery to add its ability.)',
  'When this Class enters, you gain 1 life.',
  '{1}{G}: Level 2',
  'Creatures you control get +1/+1.',
  '{2}{G}: Level 3',
  'Creatures you control have trample.',
]);
const COPIER = card('Test Duplicate', 'normal', 'Sorcery', '{1}', ["Create a token that's a copy of target enchantment you control."]);
const forests = (n: number): string[] => Array<string>(n).fill('Forest');
const levelLabels = (s: GameState, id: string): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object === id).map((a) => a.label);
const bears = (s: GameState): [number | null, number | null] => {
  const n = ptNumbers(getChars(s, find(s, 'Grizzly Bears', 'battlefield')));
  return [n.power, n.toughness];
};

describe('CR 716.2a: "[Cost]: Level N" is an activated ability that sets the level, only from level N-1 and only as a sorcery', () => {
  it('the generated abilities: level 1 is had at once (CR 716.3), the level up of each bar is keyed x:<face>:<index>:0', () => {
    const s = scenario(['Grizzly Bears', 'Forest'], { p1: { battlefield: ['Test Grove Class', 'Grizzly Bears', ...forests(6)] }, defs: [GROVE] });
    const id = find(s, 'Test Grove Class', 'battlefield');
    expect(getChars(s, id).abilities.filter((a) => a.key.startsWith('x:')).map((a) => [a.key, a.def.kind])).toEqual([
      ['x:0:0:0', 'static'], ['x:0:1:0', 'activated'], ['x:0:1:1', 'static'], ['x:0:2:0', 'activated'], ['x:0:2:1', 'static'],
    ]);
    expect(levelLabels(s, id)).toEqual(['Test Grove Class: {1}{G}: Level 2']); // not Level 3: the Class is level 1 (CR 716.2d)
    expect(bears(s)).toEqual([2, 2]);
  });

  it('level 2, then level 3: each level\'s abilities are had from then on; the level is a designation, not counters (CR 716.2b, 716.4)', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { battlefield: ['Test Grove Class', 'Grizzly Bears', ...forests(6)] }, defs: [GROVE] });
    const id = find(s, 'Test Grove Class', 'battlefield');
    s = resolveTop(activate(s, id, [], /Level 2/));
    expect(s.objects[id]!.classLevel).toBe(2);
    expect(s.objects[id]!.counters).toEqual({});
    expect(bears(s)).toEqual([3, 3]);
    expect(getChars(s, find(s, 'Grizzly Bears', 'battlefield')).keywords.map((k) => k.keyword)).not.toContain('trample');
    expect(levelLabels(s, id)).toEqual(['Test Grove Class: {2}{G}: Level 3']); // level 2 can't be gained again
    s = resolveTop(activate(s, id, [], /Level 3/));
    expect(s.objects[id]!.classLevel).toBe(3);
    expect(bears(s)).toEqual([3, 3]); // level 2's abilities stay ("level N or greater")
    expect(getChars(s, find(s, 'Grizzly Bears', 'battlefield')).keywords.map((k) => k.keyword)).toContain('trample');
    expect(levelLabels(s, id)).toEqual([]);
  });

  it('only as a sorcery: not while a spell is on the stack, nor in the opponent\'s turn', () => {
    let s = scenario(['Lightning Bolt', 'Forest', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Test Grove Class', 'Mountain', ...forests(4)] }, defs: [GROVE] });
    const id = find(s, 'Test Grove Class', 'battlefield');
    s = cast(s, 'Lightning Bolt', [target('p2')]);
    expect(levelLabels(s, id)).toEqual([]);
    s = resolveTop(s);
    expect(levelLabels(s, id)).toHaveLength(1);
    s = advanceTo(s, 2, 'main1');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.object === id)).toBe(false);
  });

  it('CR 716.2b: a token copy of a level 3 Class is level 1 (levels are not copiable): it has the level bars, only level 1\'s abilities apply', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Test Duplicate'], battlefield: ['Test Grove Class', 'Grizzly Bears', ...forests(7)] }, defs: [GROVE, COPIER] });
    const id = find(s, 'Test Grove Class', 'battlefield');
    s = tweak(s, (t) => { t.objects[id]!.classLevel = 3; });
    expect(bears(s)).toEqual([3, 3]);
    s = resolveTop(cast(s, 'Test Duplicate', [target(id)]));
    s = drive(s);
    expect(s.zones.stack).toHaveLength(1); // the copy's level 1 ability: "When this Class enters, you gain 1 life" (CR 716.3)
    s = resolveTop(s);
    const copy = s.zones.battlefield.find((x) => x !== id && s.objects[x]!.kind === 'token')!;
    expect(getChars(s, copy).name).toBe('Test Grove Class');
    expect(s.objects[copy]!.classLevel).toBeUndefined();
    expect(bears(s)).toEqual([3, 3]); // the copy's level 2 bar does not apply: one +1/+1, from the original
    expect(levelLabels(s, copy)).toEqual(['Test Grove Class: {1}{G}: Level 2']);
  });
});

describe('CR 716.2a: "When this Class becomes level N" (Bard Class level 3 is had once the level is gained)', () => {
  it('Bard Class: {R}{G}: Level 2 from level 1; {3}{R}{G}: Level 3 only from level 2', () => {
    let s = scenario(['Bard Class', 'Mountain', 'Forest'], { p1: { battlefield: ['Bard Class', 'Mountain', 'Mountain', 'Mountain', 'Forest', 'Forest', 'Forest', 'Forest'] } });
    const id = find(s, 'Bard Class', 'battlefield');
    expect(levelLabels(s, id).map((l) => l.replace('Bard Class: ', ''))).toEqual(['{R}{G}: Level 2']);
    s = resolveTop(activate(s, id, [], /Level 2/));
    expect(levelLabels(s, id).map((l) => l.replace('Bard Class: ', ''))).toEqual(['{3}{R}{G}: Level 3']);
  });
});

describe('CR 711, 702.87: leveler cards (Student of Warfare)', () => {
  const student = (s: GameState): { pt: [number | null, number | null]; kw: string[] } => {
    const c = getChars(s, find(s, 'Student of Warfare', 'battlefield'));
    const n = ptNumbers(c);
    return { pt: [n.power, n.toughness], kw: c.keywords.map((k) => k.keyword).filter((k) => k !== 'level up') };
  };

  it('CR 702.87a: level up puts a level counter on it, as a sorcery; CR 711.5: below the first bracket it has its printed P/T', () => {
    let s = scenario(['Student of Warfare', 'Plains'], { p1: { battlefield: ['Student of Warfare', 'Plains', 'Plains'] } });
    const id = find(s, 'Student of Warfare', 'battlefield');
    expect(student(s)).toEqual({ pt: [1, 1], kw: [] });
    s = resolveTop(activate(s, id, [], /Level up/));
    expect(s.objects[id]!.counters['level']).toBe(1);
    expect(student(s)).toEqual({ pt: [1, 1], kw: [] });
    s = resolveTop(activate(s, id, [], /Level up/));
    expect(student(s)).toEqual({ pt: [3, 3], kw: ['first strike'] }); // LEVEL 2-6: base 3/3 (layer 7b), first strike (layer 6)
  });

  it('CR 711.2a-b: in range 2-6 a 3/3 first strike, from 7 a 4/4 double strike; base P/T is changed in layer 7b, so +1/+1 counters still add (CR 613.4b-c)', () => {
    const at = (n: number, extra: Record<string, number> = {}): GameState =>
      scenario(['Student of Warfare'], { p1: { battlefield: [{ name: 'Student of Warfare', counters: { level: n, ...extra } }] } });
    expect(student(at(6))).toEqual({ pt: [3, 3], kw: ['first strike'] });
    expect(student(at(7))).toEqual({ pt: [4, 4], kw: ['double strike'] });
    expect(student(at(12))).toEqual({ pt: [4, 4], kw: ['double strike'] });
    expect(student(at(7, { '+1/+1': 1 }))).toEqual({ pt: [5, 5], kw: ['double strike'] });
  });

  it('CR 711.6: in every zone other than the battlefield it has its uppermost P/T (a card in the graveyard with no counters, CR 400.7)', () => {
    const s = scenario(['Student of Warfare'], { p1: { graveyard: ['Student of Warfare'] } });
    const c = getChars(s, find(s, 'Student of Warfare', 'graveyard'));
    expect([c.power, c.toughness]).toEqual(['1', '1']);
  });

  it('a bracket whose keywords share a line ("Flying, trample") renders as printed (the render gate) and gives both, with an activated ability (CR 711.2b)', () => {
    const DRAGON = card('Test Dragon Adept', 'leveler', 'Creature — Human Warrior', '{R}{R}', ['Level up {R}', 'LEVEL 4-7', '4/4', 'Flying', 'LEVEL 8+', '8/8', 'Flying, trample', '{R}: This creature gets +1/+0 until end of turn.'], ['2', '2']);
    expect(DRAGON.automation.level).toBe('full');
    let s = scenario(['Mountain'], { p1: { battlefield: [{ name: 'Test Dragon Adept', counters: { level: 8 } }, 'Mountain'] }, defs: [DRAGON] });
    const id = find(s, 'Test Dragon Adept', 'battlefield');
    expect(getChars(s, id).keywords.map((k) => k.keyword).filter((k) => k !== 'level up').sort()).toEqual(['flying', 'trample']);
    s = resolveTop(activate(s, id, [], /gets \+1\/\+0/));
    expect([getChars(s, id).power, getChars(s, id).toughness]).toEqual(['9', '8']);
  });

  it('a card whose bracket is lost with all its abilities ("loses all abilities", layer 6) has its printed P/T again', () => {
    let s = scenario(['Student of Warfare'], { p1: { battlefield: [{ name: 'Student of Warfare', counters: { level: 7 } }] } });
    const id = find(s, 'Student of Warfare', 'battlefield');
    s = tweak(s, (t) => {
      t.continuousEffects.push({
        id: 'e-test', source: null, sourceName: 'Test', controller: 'p2', timestamp: t.counters.timestamp++, startedTurn: t.turn.number, duration: { d: 'permanent' },
        effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] }, mods: [{ layer: 6, removeAll: true }] },
      });
    });
    expect(student(s)).toEqual({ pt: [1, 1], kw: [] });
  });
});

