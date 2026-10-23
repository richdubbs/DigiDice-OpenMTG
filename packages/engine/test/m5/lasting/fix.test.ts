/**
 * effects/handlers/lasting-fix.ts: what a resolved effect and a deferred (delayed or reflexive) ability remember of the resolution that made them (design 9.1,
 * 3.4; CR 611.2c-d, 608.2h, 603.7c). Pure functions over an execution context built on a real board.
 */
import { describe, expect, it } from 'vitest';
import { COND, FailsToDetermine, fixDuration, fixNode, lockSet, mentionsSubject, prepareDeferred, TOP, varsOf } from '../../../src/effects/handlers/lasting-fix';
import type { Condition, EffectProgram, EffectStep, Quantity, StaticEffect, TargetSpec } from '../../../src/index';
import { synth, spellAbility } from '../helpers';
import { bind, chosenObject, chosenPlayer, ctxOn, find, putOnStack, scenario } from '../eval/helpers';

const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const player: TargetSpec = { id: 't1', kind: 'player', min: 1, max: 1, text: 'target player' };
const poke = synth({ name: 'Test Poke', cost: '{R}', type: 'Instant', abilities: [spellAbility('x', [creature, player])] });
const prog: EffectProgram = { targets: [creature, player], steps: [] };

function board(x?: number) {
  const s = scenario(['Grizzly Bears', 'Hill Giant', 'Llanowar Elves'], { p1: { battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, p2: { battlefield: ['Hill Giant'] }, defs: [poke] });
  const bears = find(s, 'Grizzly Bears', 'battlefield');
  const elves = find(s, 'Llanowar Elves', 'battlefield');
  const giant = find(s, 'Hill Giant', 'battlefield');
  const spell = putOnStack(s, { name: 'Test Poke', targets: [[chosenObject(giant)], [chosenPlayer('p2')]], ...(x !== undefined ? { x } : {}) });
  return { s, bears, elves, giant, spell, cx: ctxOn(s, spell, prog) };
}

const creatures = { ref: 'each' as const, filter: { types: ['Creature'] } };

describe('fixNode (CR 611.2c-d)', () => {
  it('TOP: quantities become numbers, specific objects and players become fixed references, X its value', () => {
    const { cx, giant, spell } = board(4);
    const q: Quantity = { q: 'math', op: '+', args: [{ q: 'count', of: creatures }, { q: 'X' }] };
    expect(fixNode(cx, q, TOP)).toBe(7);
    expect(fixNode(cx, { ref: 'target', id: 't0' }, TOP)).toEqual({ ref: 'fixed', objects: [{ id: giant, zone: 'battlefield' }] });
    expect(fixNode(cx, { ref: 'target', id: 't1' }, TOP)).toEqual({ ref: 'fixed', players: ['p2'] });
    expect(fixNode(cx, { ref: 'you' }, TOP)).toEqual({ ref: 'fixed', players: ['p1'] });
    expect(fixNode(cx, { ref: 'self' }, TOP)).toEqual({ ref: 'fixed', objects: [{ id: spell, zone: 'stack' }] });
  });

  it('CR 611.2c: in a rule-modifying effect an `each` filter stays live; the numbers inside it are fixed', () => {
    const { cx } = board(2);
    const e: StaticEffect = { s: 'restrict', subject: { ref: 'each', filter: { types: ['Creature'], power: { op: '<=', value: { q: 'X' } } } }, mode: 'cant', action: 'block' };
    expect(fixNode(cx, e, TOP)).toEqual({ s: 'restrict', subject: { ref: 'each', filter: { types: ['Creature'], power: { op: '<=', value: 2 } } }, mode: 'cant', action: 'block' });
  });

  it('a live quantity keeps counting; only the identities inside it are fixed (a granted characteristic-defining value)', () => {
    const { cx, giant } = board();
    const q: Quantity = { q: 'live', value: { q: 'math', op: '+', args: [{ q: 'count', of: creatures }, { q: 'stat', stat: 'power', of: { ref: 'target', id: 't0' } }] } };
    expect(fixNode(cx, q, TOP)).toEqual({ q: 'live', value: { q: 'math', op: '+', args: [{ q: 'count', of: creatures }, { q: 'stat', stat: 'power', of: { ref: 'fixed', objects: [{ id: giant, zone: 'battlefield' }] } }] } });
  });

  it('conditions stay live (a "for as long as" is judged later), with their identities fixed; "if you do" about this resolution is a constant', () => {
    const { cx } = board();
    const c: Condition = { cond: 'compare', left: { q: 'life', of: { ref: 'you' } }, op: '>', right: 10 };
    expect(fixNode(cx, c, COND)).toEqual({ cond: 'compare', left: { q: 'life', of: { ref: 'fixed', players: ['p1'] } }, op: '>', right: 10 });
    cx.results.set('m', { performed: true, count: 1 });
    expect(fixNode(cx, { cond: 'did', step: 'm' }, TOP)).toEqual({ cond: 'all', of: [] });
    expect(fixNode(cx, { cond: 'did', step: 'm', not: true }, TOP)).toEqual({ cond: 'any', of: [] });
  });

  it('instructions inside an effect (a replacement\'s "instead") keep the event they will replace; targets and names of this resolution are fixed', () => {
    const { cx, giant } = board();
    const e: StaticEffect = {
      s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }, shield: { uses: 1 },
      body: { b: 'instead', do: [{ op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'exile' } }, { op: 'tap', what: { ref: 'target', id: 't0' } }] },
    };
    const fixed = fixNode(cx, e, TOP) as Extract<StaticEffect, { s: 'replace' }>;
    expect(fixed.body).toEqual({ b: 'instead', do: [{ op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'exile' } }, { op: 'tap', what: { ref: 'fixed', objects: [{ id: giant, zone: 'battlefield' }] } }] });
  });

  it('a nested ability is never entered ("self" there is the object that has it)', () => {
    const { cx } = board();
    const granted = { kind: 'triggered' as const, text: 'When this creature dies, draw a card.', trigger: { on: [{ ev: 'zoneChange' as const, subject: { self: true }, from: 'battlefield' as const }] }, effect: { targets: [], steps: [{ op: 'draw' as const, who: { ref: 'you' as const }, count: 1 }] } };
    const mods = [{ layer: 6 as const, add: [granted] }];
    expect(fixNode(cx, mods, TOP)).toEqual(mods);
  });

  it('CR 608.2b: a value that can\'t be determined throws FailsToDetermine (the part of the effect that needs it does nothing)', () => {
    const { cx } = board();
    expect(() => fixNode(cx, { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'none' } } as Quantity, TOP)).toThrow();
    cx.bindings.set('empty', { objects: [], players: [], snapshots: {} });
    expect(() => fixNode(cx, { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'empty' } } as Quantity, TOP)).toThrow(FailsToDetermine);
  });
});

describe('lockSet and the per-object values (CR 611.2c-d)', () => {
  it('the set of an `each` is evaluated once; an empty set is reported', () => {
    const { cx, bears, elves, giant } = board();
    expect(lockSet(cx, creatures)).toEqual({ ref: { ref: 'fixed', objects: [bears, elves, giant].map((id) => ({ id, zone: 'battlefield' })) }, empty: false });
    expect(lockSet(cx, { ref: 'each', filter: { types: ['Planeswalker'] } }).empty).toBe(true);
    expect(lockSet(cx, { ref: 'each', who: 'opponent' })).toEqual({ ref: { ref: 'fixed', players: ['p2'] }, empty: false });
  });

  it('mentionsSubject: "its power" is evaluated per object, a live value is not', () => {
    expect(mentionsSubject([{ layer: '7c', power: { q: 'stat', stat: 'power', of: { ref: 'subject' } } }])).toBe(true);
    expect(mentionsSubject([{ layer: '7c', power: { q: 'live', value: { q: 'stat', stat: 'power', of: { ref: 'subject' } } } }])).toBe(false);
  });

  it('durations: the player of "until your next turn" is fixed, the condition of "for as long as" stays live', () => {
    const { cx } = board();
    expect(fixDuration(cx, { d: 'untilNextTurn', whose: { ref: 'target', id: 't1' } })).toEqual({ d: 'untilNextTurn', whose: { ref: 'fixed', players: ['p2'] } });
    const cond: Condition = { cond: 'exists', of: creatures };
    expect(fixDuration(cx, { d: 'asLongAs', cond })).toEqual({ d: 'asLongAs', cond });
    expect(fixDuration(cx, { d: 'endOfTurn' })).toEqual({ d: 'endOfTurn' });
  });
});

describe('prepareDeferred (CR 603.7c, 603.12, 608.2h)', () => {
  it('objects bound here are captured for bakeSteps; players bound here, targets, X and step results are fixed now; the deferred steps\' own names are left alone', () => {
    const { cx, bears, giant } = board(3);
    bind(cx, 'c', [{ id: bears, zone: 'battlefield' }]);
    bind(cx, 'who', [], ['p2']);
    cx.results.set('n', { performed: true, count: 2 });
    const steps: EffectStep[] = [
      { op: 'sacrifice', what: { ref: 'bound', name: 'c' } },
      { op: 'draw', who: { ref: 'bound', name: 'who' }, count: { q: 'resultCount', step: 'n' } },
      { op: 'tap', what: { ref: 'target', id: 't0' }, guard: { cond: 'did', step: 'n' } },
      { op: 'chooseObjects', who: { ref: 'you' }, from: creatures, min: 0, max: { q: 'X' }, as: 'own' },
      { op: 'tap', what: { ref: 'bound', name: 'own' }, guard: { cond: 'did', step: 'own' } },
    ];
    const d = prepareDeferred(cx, steps, { keepEvent: false });
    expect(d.captured).toEqual({ c: [{ id: bears, zone: 'battlefield' }] });
    expect(d.node).toEqual([
      { op: 'sacrifice', what: { ref: 'bound', name: 'c' } },
      { op: 'draw', who: { ref: 'fixed', players: ['p2'] }, count: 2 },
      { op: 'tap', what: { ref: 'fixed', objects: [{ id: giant, zone: 'battlefield' }] }, guard: { cond: 'all', of: [] } },
      { op: 'chooseObjects', who: { ref: 'you' }, from: creatures, min: 0, max: 3, as: 'own' },
      { op: 'tap', what: { ref: 'bound', name: 'own' }, guard: { cond: 'did', step: 'own' } },
    ]);
  });

  it('own target ids (a reflexive ability\'s) are kept; with bakeBound the bound objects are fixed too (target specs are not baked by triggers/delayed.ts)', () => {
    const { cx, bears } = board();
    bind(cx, 'c', [{ id: bears, zone: 'battlefield' }]);
    const spec: TargetSpec = { id: 't9', kind: 'object', min: 1, max: 1, text: 'target creature with power less than that creature\'s', filter: { types: ['Creature'], power: { op: '<', value: { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'c' } } } } };
    const d = prepareDeferred(cx, [spec], { keepEvent: true, own: new Set(['t9']), bakeBound: true });
    expect(d.node[0]!.filter!.power).toEqual({ op: '<', value: { q: 'stat', stat: 'power', of: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] } } });
    expect(prepareDeferred(cx, [{ op: 'tap', what: { ref: 'target', id: 't9' } }] as EffectStep[], { keepEvent: true, own: new Set(['t9']) }).node).toEqual([{ op: 'tap', what: { ref: 'target', id: 't9' } }]);
  });

  it('varsOf: the variables of this resolution, without the interpreter\'s own `$` names', () => {
    const { cx } = board();
    cx.vars.set('n', 4);
    cx.vars.set('$dieResult', 6);
    cx.vars.set('bad', Number.NaN);
    expect(varsOf(cx)).toEqual({ n: 4 });
  });
});
