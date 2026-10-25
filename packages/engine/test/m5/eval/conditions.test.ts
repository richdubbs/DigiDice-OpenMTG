/**
 * WP4, effects/eval.ts: conditions (design 3.4; CR 608.2c, 118.12, 603.4, 607.2i-j, 400.7d). A comparison with a side that fails to determine is false.
 */
import { describe, expect, it } from 'vitest';
import { EngineBug, NeedDecision } from '../../../src/core/errors';
import { COND_EVALUATORS, evalCond } from '../../../src/effects/eval';
import type { Condition, EffectProgram, TargetSpec } from '../../../src/index';
import { synth, spellAbility } from '../helpers';
import { bind, chosenObject, ctxOn, find, handle, moveTo, putOnStack, scenario } from './helpers';

const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const prog: EffectProgram = { targets: [creature], steps: [] };
const poke = synth({ name: 'Test Poke', cost: '{R}', type: 'Instant', abilities: [spellAbility('x', [creature])] });
const kickable = synth({ name: 'Test Kicker', cost: '{1}{G}', type: 'Creature — Beast', pt: ['2', '2'], abilities: [] });

function board() {
  const s = scenario(['Grizzly Bears', 'Serra Angel', 'Hill Giant', 'Llanowar Elves', 'Plains'], {
    p1: { battlefield: ['Grizzly Bears', 'Serra Angel', 'Llanowar Elves', 'Plains'] },
    p2: { battlefield: ['Hill Giant'] },
    defs: [poke, kickable],
  });
  const id = (name: string, owner = 'p1') => find(s, name, 'battlefield', owner);
  const spell = putOnStack(s, { name: 'Test Poke', targets: [[chosenObject(id('Hill Giant', 'p2'))]] });
  return { s, id, spell, cx: ctxOn(s, spell, prog) };
}
const yes = (b: ReturnType<typeof board>, c: Condition) => evalCond(b.cx, c);

describe('capability table (design 5.2)', () => {
  it('lists every condition this engine evaluates', () => {
    // M6-0 (m6 design 5): classLevel and eventFlag are evaluated and advertised at once (each fails closed outside its context)
    expect(Object.keys(COND_EVALUATORS).sort()).toEqual(['all', 'any', 'ask', 'beheld', 'chosen', 'classLevel', 'compare', 'completedDungeon', 'designation', 'did', 'eventFlag', 'exists', 'happened', 'matches', 'not', 'turnOf', 'wasCast', 'asCast' /* FAST5X E17, CR 601.2i */, 'firstNamedResolution' /* FAST5X E26, CR 702.192a */, 'controlledSinceUpkeep' /* CMD3, CR 702.30a */, 'firstCombat' /* Standard round 4, r4-trig, CR 500.8 */, 'firstTime', 'someMatch' /* Standard round 5, r5-trig, CR 603.4 */, 'prime' /* std-rx1, CR 107.1 */, 'share' /* std-cardcopy-1, CR 205.2a, 105.2 */, 'firstSpellCast' /* trek-2, CR 601.2i */].sort()); // MX4: completedDungeon (CR 309.7); FAST5X E11: beheld (CR 701.4b)
  });
});

describe('all, any, not, compare', () => {
  const T: Condition = { cond: 'compare', left: 1, op: '==', right: 1 };
  const F: Condition = { cond: 'compare', left: 1, op: '==', right: 2 };
  it('boolean structure; an empty "all" holds and an empty "any" does not', () => {
    const b = board();
    expect([yes(b, { cond: 'all', of: [T, T] }), yes(b, { cond: 'all', of: [T, F] }), yes(b, { cond: 'all', of: [] })]).toEqual([true, false, true]);
    expect([yes(b, { cond: 'any', of: [F, T] }), yes(b, { cond: 'any', of: [F, F] }), yes(b, { cond: 'any', of: [] })]).toEqual([true, false, false]);
    expect([yes(b, { cond: 'not', of: T }), yes(b, { cond: 'not', of: F })]).toEqual([false, true]);
  });
  it('compare: all six operators on quantities', () => {
    const b = board();
    const c = (op: '<=' | '>=' | '==' | '!=' | '<' | '>', l: number, r: number) => yes(b, { cond: 'compare', left: l, op, right: r });
    expect([c('<=', 2, 2), c('>=', 2, 3), c('==', 3, 3), c('!=', 3, 3), c('<', 1, 2), c('>', 1, 2)]).toEqual([true, false, true, false, true, false]);
  });
  it('a side that fails to determine makes it false, whatever the operator; "not" of that is true (design 3.4)', () => {
    const b = board();
    const gone = { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'empty' } } as const;
    bind(b.cx, 'empty', []);
    for (const op of ['<=', '>=', '==', '!=', '<', '>'] as const) {
      expect(yes(b, { cond: 'compare', left: gone, op, right: 3 }), op).toBe(false);
      expect(yes(b, { cond: 'compare', left: 3, op, right: gone }), op).toBe(false);
    }
    expect(yes(b, { cond: 'not', of: { cond: 'compare', left: gone, op: '==', right: 3 } })).toBe(true);
  });
  it('the type of Cmp is closed: an unknown condition kind is a program error', () => {
    const b = board();
    expect(() => yes(b, { cond: 'bogus' } as unknown as Condition)).toThrow(EngineBug);
  });
});

describe('exists and matches', () => {
  it('exists: "if you control a creature" (at least one by default, or at least N)', () => {
    const b = board();
    const mine = { ref: 'each' as const, filter: { types: ['Creature'], controller: 'you' as const } };
    const none = { ref: 'each' as const, filter: { types: ['Artifact'], controller: 'you' as const } };
    expect(yes(b, { cond: 'exists', of: mine })).toBe(true);
    expect(yes(b, { cond: 'exists', of: none })).toBe(false);
    expect(yes(b, { cond: 'exists', of: mine, atLeast: 3 })).toBe(true);
    expect(yes(b, { cond: 'exists', of: mine, atLeast: 4 })).toBe(false);
    bind(b.cx, 'nothing', []);
    expect(yes(b, { cond: 'exists', of: mine, atLeast: { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'nothing' } } })).toBe(false); // the bound is unknown
  });
  it('exists on a target: the target must still be there (a moved object is a new one, CR 400.7)', () => {
    const b = board();
    expect(yes(b, { cond: 'exists', of: { ref: 'target', id: 't0' } })).toBe(true);
    moveTo(b.cx, b.id('Hill Giant', 'p2'), 'graveyard');
    expect(yes(b, { cond: 'exists', of: { ref: 'target', id: 't0' } })).toBe(false);
  });
  it('matches: "if it\'s a creature card", "if that creature has flying", "if enchanted creature is red"', () => {
    const b = board();
    const angel = { ref: 'fixed' as const, objects: [{ id: b.id('Serra Angel'), zone: 'battlefield' as const }] };
    expect(yes(b, { cond: 'matches', object: angel, filter: { keyword: 'flying' } })).toBe(true);
    expect(yes(b, { cond: 'matches', object: angel, filter: { colors: ['R'] } })).toBe(false);
    expect(yes(b, { cond: 'matches', object: { ref: 'target', id: 't0' }, filter: { colors: ['R'], types: ['Creature'] } })).toBe(true);
  });
  it('matches: nothing to test (an illegal target, an empty binding) is false; all of several must match', () => {
    const b = board();
    bind(b.cx, 'none', []);
    expect(yes(b, { cond: 'matches', object: { ref: 'bound', name: 'none' }, filter: {} })).toBe(false);
    b.cx.targets.get('t0')![0]!.legal = false;
    expect(yes(b, { cond: 'matches', object: { ref: 'target', id: 't0' }, filter: {} })).toBe(false);
    const two = { ref: 'each' as const, filter: { types: ['Creature'], controller: 'you' as const } };
    expect(yes(b, { cond: 'matches', object: two, filter: { colors: ['G', 'W'] } })).toBe(true);
    expect(yes(b, { cond: 'matches', object: two, filter: { colors: ['G'] } })).toBe(false);
  });
  it('matches reads last known information once the object left ("if it had a +1/+1 counter on it", CR 608.2h)', () => {
    const b = board();
    const giant = b.id('Hill Giant', 'p2');
    b.s.objects[giant]!.counters = { '+1/+1': 1 };
    bind(b.cx, 'it', [handle(b.s, giant)]);
    moveTo(b.cx, giant, 'exile');
    expect(yes(b, { cond: 'matches', object: { ref: 'bound', name: 'it' }, filter: { counters: { kind: '+1/+1' } } })).toBe(true); // as it was on the battlefield
    expect(yes(b, { cond: 'matches', object: { ref: 'bound', name: 'it' }, filter: { zone: 'battlefield', types: ['Creature'] } })).toBe(true);
    expect(yes(b, { cond: 'matches', object: { ref: 'bound', name: 'it' }, filter: { zone: 'exile' } })).toBe(false);
  });
});

describe('turnOf (CR 102.1, 500)', () => {
  it('whose turn it is, relative to the controller; optionally in which step', () => {
    const b = board();
    expect(b.s.turn.activePlayer).toBe('p1');
    expect([yes(b, { cond: 'turnOf', whose: 'you' }), yes(b, { cond: 'turnOf', whose: 'opponent' }), yes(b, { cond: 'turnOf', whose: 'any' })]).toEqual([true, false, true]);
    expect(yes(b, { cond: 'turnOf', whose: 'you', step: 'main1' })).toBe(true);
    expect(yes(b, { cond: 'turnOf', whose: 'you', step: ['upkeep', 'main1'] })).toBe(true);
    expect(yes(b, { cond: 'turnOf', whose: 'you', step: 'upkeep' })).toBe(false);
    expect(yes(b, { cond: 'turnOf', whose: 'opponent', step: 'main1' })).toBe(false);
    expect(yes(b, { cond: 'turnOf', whose: { ref: 'each', who: 'opponent' } })).toBe(false);
    expect(yes(b, { cond: 'turnOf', whose: { ref: 'active' } })).toBe(true);
    b.s.turn.activePlayer = 'p2';
    expect(yes(b, { cond: 'turnOf', whose: 'opponent' })).toBe(true);
  });
});

describe('wasCast: the cast history of THIS object (CR 607.2i-j, 400.7d)', () => {
  it('a spell that is becoming a permanent: the choices made as it was cast (kicked, an alternative cost, X, the zone it was cast from)', () => {
    const s = scenario([], { defs: [kickable] });
    const spell = putOnStack(s, { name: 'Test Kicker', x: 3, castFrom: 'hand', costsPaid: { kicked: 1, additional: ['kicker'], alternative: 'evoke' } });
    const cx = ctxOn(s, spell);
    const w = (c: Omit<Extract<Condition, { cond: 'wasCast' }>, 'cond'>) => evalCond(cx, { cond: 'wasCast', ...c });
    expect([w({ kicked: true }), w({ kicked: false }), w({ kicked: 'kicker' }), w({ kicked: 'buyback' })]).toEqual([true, false, true, false]);
    expect([w({ via: 'evoke' }), w({ via: 'flashback' }), w({ from: 'hand' }), w({ from: 'graveyard' }), w({ xAtLeast: 3 }), w({ xAtLeast: 4 })]).toEqual([true, false, true, false, true, false]);
    expect(w({ kicked: true, from: 'hand', xAtLeast: 1 })).toBe(true);
    expect(w({})).toBe(true); // it was cast
  });
  it('a permanent remembers how it was cast (GameObject.cast, copied from the spell), also after the ability that asks is on the stack', () => {
    const s = scenario([], { p1: { battlefield: ['Test Kicker'] }, defs: [kickable] });
    const perm = find(s, 'Test Kicker', 'battlefield');
    s.objects[perm]!.cast = { costsPaid: { kicked: 2 }, x: 2, from: 'graveyard', via: 'flashback', turn: 1 };
    const cx = ctxOn(s, perm);
    expect([evalCond(cx, { cond: 'wasCast', kicked: true }), evalCond(cx, { cond: 'wasCast', via: 'flashback', from: 'graveyard' }), evalCond(cx, { cond: 'wasCast', xAtLeast: 3 })]).toEqual([true, true, false]);
    const trig = putOnStack(s, { name: 'Test Kicker', kind: 'triggered' });
    expect(evalCond(ctxOn(s, trig), { cond: 'wasCast', kicked: true })).toBe(true);
    moveTo(cx, perm, 'graveyard'); // a leaves-the-battlefield ability still sees it (last known information)
    expect(evalCond(cx, { cond: 'wasCast', kicked: true })).toBe(true);
  });
  it('an object that was not cast (put onto the battlefield) fails every part except "not kicked" (CR 702.33d); an alternative cost recorded only in costsPaid counts as via', () => {
    const s = scenario([], { p1: { battlefield: ['Test Kicker'] }, defs: [kickable] });
    const cx = ctxOn(s, find(s, 'Test Kicker', 'battlefield'));
    expect([evalCond(cx, { cond: 'wasCast' }), evalCond(cx, { cond: 'wasCast', kicked: false }), evalCond(cx, { cond: 'wasCast', from: 'hand' })]).toEqual([false, true, false]);
    const perm = find(s, 'Test Kicker', 'battlefield');
    s.objects[perm]!.cast = { costsPaid: { alternative: 'evoke' }, from: 'hand', turn: 1 };
    expect([evalCond(cx, { cond: 'wasCast', via: 'evoke' }), evalCond(cx, { cond: 'wasCast', kicked: false })]).toEqual([true, true]);
  });
});

describe('did: the result of an earlier step (CR 118.12, 603.12, 608.2c)', () => {
  const did = (b: ReturnType<typeof board>, step: string, not = false) => yes(b, { cond: 'did', step, ...(not ? { not: true } : {}) });
  it('for "may" and "pay": whether the player CHOSE to (CR 118.12), regardless of what happened', () => {
    const b = board();
    b.cx.results.set('mayDraw', { performed: true, count: 0 }); // chose to, nothing could be drawn
    b.cx.results.set('mayNot', { performed: false, count: 0 });
    b.cx.results.set('paid', { performed: true, count: 1 });
    expect([did(b, 'mayDraw'), did(b, 'mayNot'), did(b, 'paid'), did(b, 'mayNot', true), did(b, 'paid', true)]).toEqual([true, false, true, true, false]);
  });
  it('for object steps: whether at least one object or player was affected', () => {
    const b = board();
    b.cx.results.set('destroyed', { performed: true, count: 2 });
    b.cx.results.set('moved', { performed: false, count: 0 });
    expect([did(b, 'destroyed'), did(b, 'moved'), did(b, 'moved', true)]).toEqual([true, false, true]);
  });
  it('a step that never ran did nothing: "if you do" is false and "if you don\'t" is true', () => {
    const b = board();
    expect([did(b, 'never'), did(b, 'never', true)]).toEqual([false, true]);
  });
});

describe('designation (CR 724-726)', () => {
  it('monarch, initiative: held by one of the players; day and night: the game\'s state', () => {
    const b = board();
    b.s.designations.monarch = 'p1';
    b.s.designations.initiative = 'p2';
    b.s.designations.dayNight = 'night';
    const d = (what: 'monarch' | 'initiative' | 'day' | 'night', who: 'you' | 'opp') => yes(b, { cond: 'designation', who: who === 'you' ? { ref: 'you' } : { ref: 'anOpponent' }, what });
    expect([d('monarch', 'you'), d('monarch', 'opp'), d('initiative', 'you'), d('initiative', 'opp')]).toEqual([true, false, false, true]);
    expect([d('day', 'you'), d('night', 'you')]).toEqual([false, true]);
    delete b.s.designations.dayNight;
    expect([d('day', 'you'), d('night', 'you')]).toEqual([false, false]);
  });
  it('the city blessing (CR 702.131c) belongs to the players listed in the designations (more in test/m5/eval/review.test.ts)', () => {
    const b = board();
    expect(yes(b, { cond: 'designation', who: { ref: 'you' }, what: 'citysBlessing' })).toBe(false);
    b.s.designations.citysBlessing = ['p1'];
    expect(yes(b, { cond: 'designation', who: { ref: 'you' }, what: 'citysBlessing' })).toBe(true);
  });
});

describe('chosen: the value a linked ability of the source chose (CR 607.2d)', () => {
  it('equal (ignoring case) to the given value; an undefined choice equals nothing (CR 607.5a)', () => {
    const b = board();
    const src = b.id('Grizzly Bears');
    const cx = ctxOn(b.s, src);
    expect(evalCond(cx, { cond: 'chosen', link: 'color', equals: 'red' })).toBe(false);
    b.s.objects[src]!.links = { color: { values: ['Red'] } };
    expect(evalCond(cx, { cond: 'chosen', link: 'color', equals: 'red' })).toBe(true);
    expect(evalCond(cx, { cond: 'chosen', link: 'color', equals: 'blue' })).toBe(false);
    expect(evalCond(cx, { cond: 'chosen', link: 'other', equals: 'red' })).toBe(false);
    moveTo(cx, src, 'graveyard'); // read from last known information
    expect(evalCond(cx, { cond: 'chosen', link: 'color', equals: 'red' })).toBe(true);
  });
});

describe('ask: the named player (the controller by default) is asked yes / no (MANUAL)', () => {
  it('raises a yesNo decision for the controller; the answer is the value; asked once per resolution', () => {
    const b = board();
    const q: Condition = { cond: 'ask', text: 'Does it have flying?' };
    try {
      yes(b, q);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NeedDecision);
      expect((e as NeedDecision).decision).toMatchObject({ kind: 'yesNo', player: 'p1', prompt: 'Does it have flying?' });
    }
    const cx = ctxOn(b.s, b.spell, prog, [{ kind: 'yesNo', yes: true }]);
    expect(evalCond(cx, q)).toBe(true);
    expect(evalCond(cx, q)).toBe(true); // the same node is not asked again
    const no = ctxOn(b.s, b.spell, prog, [{ kind: 'yesNo', yes: false }]);
    expect(evalCond(no, q)).toBe(false);
  });
  it('who: another player is asked', () => {
    const b = board();
    try {
      yes(b, { cond: 'ask', text: 'Did you pay?', who: { ref: 'anOpponent' } });
      expect.unreachable();
    } catch (e) {
      expect((e as NeedDecision).decision).toMatchObject({ kind: 'yesNo', player: 'p2' });
    }
  });
});
