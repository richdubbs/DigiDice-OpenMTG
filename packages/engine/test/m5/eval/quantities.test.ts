/**
 * WP4, effects/eval.ts: quantities (design 3.4). A quantity that depends on an illegal target or an empty binding is `undefined` ("fails to determine",
 * CR 608.2b); a step with an `undefined` quantity does nothing and a comparison with an `undefined` side is false.
 */
import { describe, expect, it } from 'vitest';
import { EngineBug, NeedDecision } from '../../../src/core/errors';
import { evalCond, evalCount, evalQty, QTY_EVALUATORS } from '../../../src/effects/eval';
import type { EffectProgram, Quantity, TargetSpec } from '../../../src/index';
import { synth, spellAbility } from '../helpers';
import { bind, chosenObject, ctxOn, find, handle, moveTo, putOnStack, scenario } from './helpers';

const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const prog: EffectProgram = { targets: [creature], steps: [] };
const star = synth({ name: 'Test Star', cost: '{2}', type: 'Creature — Construct', pt: ['*', '*'], abilities: [] });
const poke = synth({ name: 'Test Poke', cost: '{R}', type: 'Instant', abilities: [spellAbility('x', [creature])] });
const X = (q: Quantity) => q;

function board() {
  const s = scenario(['Grizzly Bears', 'Serra Angel', 'Hill Giant', 'Llanowar Elves', 'Jace Beleren', 'Plains', 'Island', 'Mountain', 'Fireball', 'Dismember', 'Wastes'], {
    p1: { battlefield: ['Grizzly Bears', 'Serra Angel', 'Llanowar Elves', 'Plains', 'Test Star', { name: 'Jace Beleren', counters: { loyalty: 3 } }], hand: ['Plains', 'Island', { name: 'Jace Beleren' }], graveyard: ['Grizzly Bears'] },
    p2: { battlefield: ['Hill Giant', 'Mountain', 'Island'], graveyard: ['Hill Giant', 'Hill Giant'] },
    defs: [star, poke],
  });
  const id = (name: string, zone: 'battlefield' | 'hand' | 'graveyard' = 'battlefield', owner = 'p1') => find(s, name, zone, owner);
  const spell = putOnStack(s, { name: 'Test Poke', targets: [[chosenObject(id('Hill Giant', 'battlefield', 'p2'))]] });
  return { s, id, spell, cx: ctxOn(s, spell, prog) };
}
const val = (b: ReturnType<typeof board>, q: Quantity) => evalQty(b.cx, q);

describe('capability table (design 5.2)', () => {
  it('lists every quantity this engine evaluates; dieResult reads the result the rollDie handler keeps (WP15)', () => {
    expect(Object.keys(QTY_EVALUATORS).sort()).toEqual([
      'X', 'age', 'ask', 'cardsDrawnThisTurn', 'count', 'countPlayers', 'counters', 'devotion', 'dieResult', 'distinct', 'eventAmount', 'happenedCount', 'level', 'life', 'lifeGainedThisTurn',
      'live', 'math', 'resultCount', 'spellManaSpent' /* FAST5X E9 */, 'spellsBefore', 'spellsCastThisTurn', 'spellTargetCount', 'speed', 'stat', 'targetCount', 'turnNumber', 'var', 'zoneSize',
      'kickCount', 'preventedAmount', 'faceUpX', // M6-0 (m6 design 5)
      'lifeLostThisTurn', 'colorsSpent', // FAST4 T34
      'commanderCasts', // M11-0 (CR 903.8): exact in every game, 0 outside Commander
      'partySize', // FAST5 T38 (CR 700.8)
      'basePower', // std-rx29 (CR 208.1, 613.4)
      'manaSymbols', // Standard round 5, r5-trig (CR 107.4, 202.1)
      'turnsBegun', // Standard round 9, std-r9 (CR 500.7)
      'mostSharingCreatureType', // r5-cost (CR 205.3m)
      'spellColorsSpent', // FAST5 T51 (CR 601.2h)
      'manaSpent', // FAST5 T42
      'excessDamage', // FAST5X E16
      'countersRemoved', // std-rx14
      'damageDealt', // std-rx20
      'unspentMana', // FAST5X E19 (CR 106.4)
      'startingLife', // FAST5 T60 (CR 103.4)
      'resolvedThisTurn', // FAST5X E17 (CR 608.2, 400.7)
      'descendedThisTurn', // FAST5X E22 (CR 700.11)
      'lifeLost', 'votes', 'opponentsAttacked', // M12-3 (CR 119.3, 701.38, 702.121a)
      'unlockedDoors', // cloud std-dsk (CR 709.5c, 709.5j)
      'happenedDistinct', // CLOUD std-tmt (CR 205.2a): the card types among the spells cast this turn
      'chosenNumber', // CLOUD std-misc (CR 608.2d, 607.2d): the number a linked "Choose a number ..." chose
      'modesChosen', // Standard round 3, r3-trig (CR 700.2, 601.2b): the modes chosen for the spell of a cast trigger
      'loyaltyRemoved', // Standard round 3, r3-trig (CR 606.4): the loyalty counters the cost of the triggering activation removed
      'spellTargetTotal', 'costCount', // std-costs-1 (CR 601.2f, 601.2b): the targets' total mana value, the number announced for an optional cost
    ].sort());
    const b = board();
    expect(evalQty(b.cx, { q: 'dieResult' })).toBeUndefined(); // no die rolled in this resolution: fails to determine (CR 608.2b)
  });
});

describe('numbers, X and variables', () => {
  it('a plain number is that number', () => {
    expect(val(board(), 7)).toBe(7);
    expect(val(board(), 0)).toBe(0);
  });
  it('X: the value announced when the spell was cast (CR 107.3a); a permanent remembers it (CR 400.7d); otherwise 0 (CR 107.3b)', () => {
    const b = board();
    expect(val(b, { q: 'X' })).toBe(0);
    b.s.objects[b.spell]!.stack!.x = 5;
    expect(evalQty(ctxOn(b.s, b.spell, prog), { q: 'X' })).toBe(5);
    const bears = b.id('Grizzly Bears');
    b.s.objects[bears]!.cast = { costsPaid: {}, x: 3, from: 'hand', turn: 1 };
    expect(evalQty(ctxOn(b.s, bears), { q: 'X' })).toBe(3);
  });
  it('var: a value fixed by a `let`; a `let` that could not be determined (NaN) reads as undefined; a name never set is a program error', () => {
    const b = board();
    b.cx.vars.set('n', 4);
    b.cx.vars.set('nothing', Number.NaN);
    expect(val(b, { q: 'var', name: 'n' })).toBe(4);
    expect(val(b, { q: 'var', name: 'nothing' })).toBeUndefined();
    expect(() => val(b, { q: 'var', name: 'never' })).toThrow('never set');
  });
  it('live: evaluates the wrapped quantity (the wrapper only matters when a resolved effect fixes its values)', () => {
    const b = board();
    b.cx.vars.set('n', 2);
    expect(val(b, { q: 'live', value: { q: 'var', name: 'n' } })).toBe(2);
  });
});

describe('count, countPlayers, zoneSize, life', () => {
  it('count: the size of the set a reference stands for, also when members have moved since ("the number of cards returned this way"); exists asks whether they are still there', () => {
    const b = board();
    expect(val(b, { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } })).toBe(4); // bears, angel, elves, Test Star
    expect(val(b, { q: 'count', of: { ref: 'each', filter: { types: ['Land'] } } })).toBe(3);
    expect(val(b, { q: 'count', of: { ref: 'target', id: 't0' } })).toBe(1);
    moveTo(b.cx, b.id('Hill Giant', 'battlefield', 'p2'), 'graveyard');
    expect(val(b, { q: 'count', of: { ref: 'target', id: 't0' } })).toBe(1); // the target is still one of the targets...
    expect(evalCond(b.cx, { cond: 'exists', of: { ref: 'target', id: 't0' } })).toBe(false); // ... but the object is no longer there
  });
  it('countPlayers', () => {
    const b = board();
    expect(val(b, { q: 'countPlayers', of: { ref: 'each', who: 'player' } })).toBe(2);
    expect(val(b, { q: 'countPlayers', of: { ref: 'each', who: 'opponent' } })).toBe(1);
    expect(val(b, { q: 'countPlayers', of: { ref: 'target', id: 't0' } })).toBe(0);
  });
  it('zoneSize: cards in a library, hand or graveyard; permanents a player controls; objects exiled by a player', () => {
    const b = board();
    expect(val(b, { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } })).toBe(3);
    expect(val(b, { q: 'zoneSize', zone: 'graveyard', of: { ref: 'anOpponent' } })).toBe(2);
    expect(val(b, { q: 'zoneSize', zone: 'library', of: { ref: 'you' } })).toBe(b.s.zones.library['p1']!.length);
    expect(val(b, { q: 'zoneSize', zone: 'battlefield', of: { ref: 'anOpponent' } })).toBe(3);
    expect(val(b, { q: 'zoneSize', zone: 'battlefield', of: { ref: 'you' } })).toBe(6);
    expect(val(b, { q: 'zoneSize', zone: 'exile', of: { ref: 'you' } })).toBe(0);
    expect(val(b, { q: 'zoneSize', zone: 'hand', of: { ref: 'target', id: 'gone' } })).toBeUndefined(); // no such player: fails to determine
  });
  it('life: a life total; several players without a rule that sums them is a program error', () => {
    const b = board();
    b.s.players[1]!.life = 13;
    expect(val(b, { q: 'life', of: { ref: 'you' } })).toBe(20);
    expect(val(b, { q: 'life', of: { ref: 'anOpponent' } })).toBe(13);
    expect(val(b, { q: 'life', of: { ref: 'target', id: 'gone' } })).toBeUndefined();
    expect(() => val(b, { q: 'life', of: { ref: 'each', who: 'player' } })).toThrow(EngineBug);
  });
});

describe('stat: power, toughness, mana value, loyalty, defense (CR 208, 202.3, 209, 310)', () => {
  it('power and toughness through the characteristics function; a noncreature or an unevaluated "*" has none (fails to determine)', () => {
    const b = board();
    const of = (name: string) => ({ ref: 'fixed' as const, objects: [{ id: b.id(name), zone: 'battlefield' as const }] });
    expect(val(b, { q: 'stat', stat: 'power', of: of('Serra Angel') })).toBe(4);
    expect(val(b, { q: 'stat', stat: 'toughness', of: of('Serra Angel') })).toBe(4);
    b.s.objects[b.id('Serra Angel')]!.counters = { '+1/+1': 2 };
    expect(val(b, { q: 'stat', stat: 'power', of: of('Serra Angel') })).toBe(6);
    expect(val(b, { q: 'stat', stat: 'power', of: of('Plains') })).toBeUndefined();
    expect(val(b, { q: 'stat', stat: 'power', of: of('Test Star') })).toBeUndefined(); // "*" is evaluated in milestone 6
  });
  it('manaValue, including X on the stack (CR 202.3e)', () => {
    const b = board();
    const angel = { ref: 'fixed' as const, objects: [{ id: b.id('Serra Angel'), zone: 'battlefield' as const }] };
    expect(val(b, { q: 'stat', stat: 'manaValue', of: angel })).toBe(5);
    const fb = putOnStack(b.s, { name: 'Fireball', x: 4 });
    expect(val(b, { q: 'stat', stat: 'manaValue', of: { ref: 'fixed', objects: [{ id: fb, zone: 'stack' }] } })).toBe(5);
  });
  it('loyalty and defense: counters on the battlefield, the printed value elsewhere', () => {
    const b = board();
    const jace = { ref: 'fixed' as const, objects: [{ id: b.id('Jace Beleren'), zone: 'battlefield' as const }] };
    expect(val(b, { q: 'stat', stat: 'loyalty', of: jace })).toBe(3);
    b.s.objects[b.id('Jace Beleren')]!.counters = { loyalty: 5 };
    expect(val(b, { q: 'stat', stat: 'loyalty', of: jace })).toBe(5);
    expect(val(b, { q: 'stat', stat: 'loyalty', of: { ref: 'fixed', objects: [{ id: b.id('Jace Beleren', 'hand'), zone: 'hand' }] } })).toBe(3); // printed
    expect(val(b, { q: 'stat', stat: 'defense', of: jace })).toBe(0);
  });
  it('sum adds them up; without sum several objects are a program error; none at all fails to determine', () => {
    const b = board();
    const mine = { ref: 'each' as const, filter: { types: ['Creature'], controller: 'you' as const, notName: 'Test Star' } };
    bind(b.cx, 'empty', []);
    expect(val(b, { q: 'stat', stat: 'power', of: mine, sum: true })).toBe(2 + 4 + 1);
    expect(() => val(b, { q: 'stat', stat: 'power', of: mine })).toThrow(EngineBug);
    expect(val(b, { q: 'stat', stat: 'power', of: { ref: 'each', filter: { name: 'Nothing' } }, sum: true })).toBe(0); // the total of no creatures (CR 608.2h)
    expect(val(b, { q: 'stat', stat: 'power', of: { ref: 'each', filter: { name: 'Nothing' } } })).toBeUndefined(); // "the power of it" with nothing to point at
    expect(val(b, { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'empty' } })).toBeUndefined();
  });
  it('a target that stopped being legal is not read: undefined (CR 608.2b), and a part of the effect needing it does not happen', () => {
    const b = board();
    expect(val(b, { q: 'stat', stat: 'power', of: { ref: 'target', id: 't0' } })).toBe(3);
    b.cx.targets.get('t0')![0]!.legal = false;
    expect(val(b, { q: 'stat', stat: 'power', of: { ref: 'target', id: 't0' } })).toBeUndefined();
    expect(val(b, { q: 'math', op: '+', args: [1, { q: 'stat', stat: 'power', of: { ref: 'target', id: 't0' } }] })).toBeUndefined(); // undefined propagates
  });
  it('Swords to Plowshares: after the exile "its power" is the battlefield value (CR 608.2h; design 3.1 rule 3)', () => {
    const b = board();
    const giant = b.id('Hill Giant', 'battlefield', 'p2');
    b.s.objects[giant]!.counters = { '+1/+1': 1 };
    b.cx.bindings.clear();
    bind(b.cx, 'it', [handle(b.s, giant)]);
    moveTo(b.cx, giant, 'exile');
    expect(val(b, { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'it' } })).toBe(4); // as it last existed on the battlefield
  });
});

describe('counters', () => {
  it('counters of a kind on an object, "any" kind, on several; counter names are data', () => {
    const b = board();
    const bears = b.id('Grizzly Bears');
    b.s.objects[bears]!.counters = { '+1/+1': 2, charge: 1 };
    const on = { ref: 'fixed' as const, objects: [{ id: bears, zone: 'battlefield' as const }] };
    expect(val(b, { q: 'counters', on, kind: '+1/+1' })).toBe(2);
    expect(val(b, { q: 'counters', on, kind: 'any' })).toBe(3);
    expect(val(b, { q: 'counters', on, kind: 'toString' })).toBe(0);
    expect(val(b, { q: 'counters', on: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, kind: '+1/+1' })).toBe(2);
  });
  it('counters on a player: poison, energy; nothing referenced fails to determine', () => {
    const b = board();
    b.s.players[1]!.poison = 3;
    b.s.players[1]!.counters = { energy: 2 };
    bind(b.cx, 'empty', []);
    expect(val(b, { q: 'counters', on: { ref: 'anOpponent' }, kind: 'poison' })).toBe(3);
    expect(val(b, { q: 'counters', on: { ref: 'anOpponent' }, kind: 'energy' })).toBe(2);
    expect(val(b, { q: 'counters', on: { ref: 'anOpponent' }, kind: 'any' })).toBe(5);
    expect(val(b, { q: 'counters', on: { ref: 'bound', name: 'empty' }, kind: 'any' })).toBeUndefined();
  });
  it('counters on an object that left: last known information', () => {
    const b = board();
    const bears = b.id('Grizzly Bears');
    b.s.objects[bears]!.counters = { '+1/+1': 2 };
    bind(b.cx, 'it', [handle(b.s, bears)]);
    moveTo(b.cx, bears, 'graveyard');
    expect(val(b, { q: 'counters', on: { ref: 'bound', name: 'it' }, kind: '+1/+1' })).toBe(2);
  });
});

describe('devotion (CR 700.5) and distinct', () => {
  it('devotion counts the mana symbols of the color(s) among the permanents the player controls; a hybrid symbol counts once', () => {
    const s = scenario(['Gallant Citizen', 'Serra Angel', 'Grizzly Bears', 'Dismember'], { p1: { battlefield: ['Gallant Citizen', 'Serra Angel', 'Grizzly Bears'] }, defs: [poke] });
    const cx = ctxOn(s, putOnStack(s, { name: 'Test Poke' }));
    // Gallant Citizen {G/W}{G/W}, Serra Angel {3}{W}{W}, Grizzly Bears {1}{G}
    expect(evalQty(cx, { q: 'devotion', to: ['W'], of: { ref: 'you' } })).toBe(2 + 2);
    expect(evalQty(cx, { q: 'devotion', to: ['G'], of: { ref: 'you' } })).toBe(2 + 1);
    expect(evalQty(cx, { q: 'devotion', to: ['W', 'G'], of: { ref: 'you' } })).toBe(2 + 2 + 1); // the hybrid symbols count once each
    expect(evalQty(cx, { q: 'devotion', to: ['W'], of: { ref: 'anOpponent' } })).toBe(0);
    s.objects[find(s, 'Serra Angel', 'battlefield')]!.phasedOut = true; // a phased-out permanent doesn't count (CR 702.26b)
    expect(evalQty(cx, { q: 'devotion', to: ['W'], of: { ref: 'you' } })).toBe(2);
  });
  it('distinct colors, card types, names, mana values and land types among a set', () => {
    const b = board();
    const mine = { ref: 'each' as const, filter: { controller: 'you' as const } };
    expect(val(b, { q: 'distinct', what: 'colors', among: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } })).toBe(2); // green and white
    expect(val(b, { q: 'distinct', what: 'cardTypes', among: mine })).toBe(3); // creature, land, planeswalker
    expect(val(b, { q: 'distinct', what: 'names', among: mine })).toBe(6);
    expect(val(b, { q: 'distinct', what: 'manaValues', among: { ref: 'each', filter: { types: ['Creature'] } } })).toBe(4); // bears 2, angel 5, elves 1, Test Star 2, Hill Giant 4: {1, 2, 4, 5}
  });
  it('distinct land types; creature types (a changeling has them all: test/m5/eval/review.test.ts)', () => {
    const s = scenario(['Plains', 'Island', 'Grizzly Bears', 'Llanowar Elves'], { p1: { battlefield: ['Plains', 'Island', 'Grizzly Bears', 'Llanowar Elves'] }, defs: [poke] });
    const cx = ctxOn(s, putOnStack(s, { name: 'Test Poke' }));
    expect(evalQty(cx, { q: 'distinct', what: 'landTypes', among: { ref: 'each', filter: { types: ['Land'] } } })).toBe(2);
    expect(evalQty(cx, { q: 'distinct', what: 'creatureTypes', among: { ref: 'each', filter: { types: ['Creature'] } } })).toBe(3); // Bear, Elf, Druid
  });
});

describe('results, targets and the event', () => {
  it('resultCount: how many objects a step affected; a step that did not run affected none', () => {
    const b = board();
    b.cx.results.set('discarded', { performed: true, count: 3 });
    expect(val(b, { q: 'resultCount', step: 'discarded' })).toBe(3);
    expect(val(b, { q: 'resultCount', step: 'other' })).toBe(0);
  });
  it('spellsBefore (storm, CR 702.40a): the count carried by the cast event; no cast event, no value', () => {
    const b = board();
    b.cx.event = { ev: 'cast', roles: {}, before: {}, spellsBefore: 3 };
    expect(val(b, { q: 'spellsBefore' })).toBe(3);
    b.cx.event = { ev: 'zoneChange', roles: {}, before: {} };
    expect(val(b, { q: 'spellsBefore' })).toBeUndefined();
  });
  it('targetCount: the number of targets announced for a spec (illegal ones included, CR 115.9a); spellTargetCount: all targets of the spell', () => {
    const b = board();
    expect(val(b, { q: 'targetCount', id: 't0' })).toBe(1);
    expect(val(b, { q: 'targetCount', id: 'nope' })).toBe(0);
    b.cx.targets.get('t0')![0]!.legal = false;
    expect(val(b, { q: 'targetCount', id: 't0' })).toBe(1);
    expect(val(b, { q: 'spellTargetCount' })).toBe(1);
  });
  it('eventAmount: "that much" from the trigger event; none when there is no event or no amount', () => {
    const b = board();
    expect(val(b, { q: 'eventAmount' })).toBeUndefined();
    const bears = b.id('Grizzly Bears');
    const trig = putOnStack(b.s, { name: 'Grizzly Bears', kind: 'triggered', event: { ev: 'damage', roles: {}, amount: 3, before: {} } });
    expect(evalQty(ctxOn(b.s, trig), { q: 'eventAmount' })).toBe(3);
    const trig2 = putOnStack(b.s, { name: 'Grizzly Bears', kind: 'triggered', event: { ev: 'damage', roles: {}, before: {} } });
    expect(evalQty(ctxOn(b.s, trig2), { q: 'eventAmount' })).toBeUndefined();
    expect(bears).toBeTruthy();
  });
});

describe('game facts: speed, age, level, turn number, this-turn statistics', () => {
  it('each reads the state', () => {
    const b = board();
    b.s.turn.number = 7;
    b.s.designations.speed = { p1: 3 };
    b.s.objects[b.id('Grizzly Bears')]!.counters = { age: 2, level: 4 };
    const bears = ctxOn(b.s, b.id('Grizzly Bears'));
    expect(evalQty(bears, { q: 'turnNumber' })).toBe(7);
    expect(evalQty(bears, { q: 'speed' })).toBe(3);
    expect(evalQty(bears, { q: 'age' })).toBe(2);
    expect(evalQty(bears, { q: 'level' })).toBe(4);
    expect(evalQty(ctxOn(b.s, b.id('Serra Angel')), { q: 'age' })).toBe(0);
    b.s.designations.speed = {};
    expect(evalQty(bears, { q: 'speed' })).toBe(0);
    b.s.players[0]!.turnStats = { lifeGained: 4, lifeLost: 1, spellsCast: 2, cardsDrawn: 3 };
    expect([evalQty(bears, { q: 'cardsDrawnThisTurn' }), evalQty(bears, { q: 'spellsCastThisTurn' }), evalQty(bears, { q: 'lifeGainedThisTurn' })]).toEqual([3, 2, 4]);
  });
});

describe('math', () => {
  const b = board();
  const m = (op: 'min' | 'max' | '+' | '-' | '*' | 'floorDiv' | 'ceilDiv', ...args: Quantity[]) => val(b, { q: 'math', op, args });
  it('+, -, *, min, max', () => {
    expect([m('+', 1, 2, 3), m('-', 10, 3, 2), m('*', 2, 3), m('*', 2, { q: 'math', op: '+', args: [1, 1] }), m('min', 4, 2, 9), m('max', 4, 2, 9)]).toEqual([6, 5, 6, 4, 2, 9]);
  });
  it('"half, rounded down / up" (CR 107.1a); division by zero fails to determine', () => {
    expect([m('floorDiv', 7, 2), m('ceilDiv', 7, 2), m('floorDiv', 8, 2), m('ceilDiv', 8, 2)]).toEqual([3, 4, 4, 4]);
    expect(m('floorDiv', 7, 0)).toBeUndefined();
    expect(m('ceilDiv', 7)).toBeUndefined();
  });
  it('an undefined argument makes the result undefined; so does no argument', () => {
    const gone = { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'empty' } } as const;
    b.cx.bindings.set('empty', { objects: [], players: [], snapshots: {} });
    expect([m('+', 1, gone), m('max', gone, 3), m('*', gone)]).toEqual([undefined, undefined, undefined]);
    expect(val(b, { q: 'math', op: '+', args: [] })).toBeUndefined();
  });
});

describe('ask: the controller types the number (MANUAL)', () => {
  it('raises a chooseNumber decision for the controller; the answer is the value; the same node is asked once per resolution', () => {
    const b = board();
    const ask = X({ q: 'ask', text: 'How many cards did you discard?' });
    try {
      evalQty(b.cx, ask);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NeedDecision);
      expect((e as NeedDecision).decision).toMatchObject({ kind: 'chooseNumber', player: 'p1', prompt: 'How many cards did you discard?' });
    }
    const cx = ctxOn(b.s, b.spell, prog, [{ kind: 'chooseNumber', n: 4 }]);
    expect(evalQty(cx, ask)).toBe(4);
    expect(evalQty(cx, ask)).toBe(4); // not asked again (the second call would need a second answer)
    let asked = false;
    try {
      evalQty(cx, { q: 'ask', text: 'Another question' }); // a different node asks again (and there is no second answer)
    } catch (e) {
      asked = e instanceof NeedDecision;
    }
    expect(asked).toBe(true);
  });
});

describe('evalCount: a Count as a number', () => {
  it('numbers, "any number" and the announced X as before; a computed quantity needs the resolution context', () => {
    const b = board();
    expect(evalCount(3)).toBe(3);
    expect(evalCount('any')).toBe(Number.POSITIVE_INFINITY);
    expect(evalCount({ q: 'X' }, { x: 2 })).toBe(2);
    expect(() => evalCount({ q: 'X' })).toThrow(EngineBug);
    expect(() => evalCount({ q: 'count', of: { ref: 'self' } })).toThrow(EngineBug);
    expect(evalCount({ q: 'count', of: { ref: 'each', filter: { types: ['Land'] } } }, { cx: b.cx })).toBe(3);
    expect(evalCount({ q: 'X' }, { cx: b.cx })).toBe(0); // with a context X is read from the stack
    expect(evalCount({ q: 'stat', stat: 'power', of: { ref: 'bound', name: 'nothing' } }, { cx: (bind(b.cx, 'nothing', []), b.cx) })).toBe(0); // fails to determine: nothing
  });
});
