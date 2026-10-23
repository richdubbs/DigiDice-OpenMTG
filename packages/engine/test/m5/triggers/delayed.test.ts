/**
 * WP8: delayed triggered abilities (CR 603.7) and reflexive triggered abilities (CR 603.12), and state triggers (CR 603.8).
 */
import { describe, expect, it } from 'vitest';
import type { EffectStep, GameState } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { collectPendingTriggers, putPendingTriggersOnStack } from '../../../src/core/triggers';
import { bakeSteps, createDelayedTrigger, expireDelayed } from '../../../src/triggers/delayed';
import { putReflexiveTrigger } from '../../../src/triggers/stack';
import { creatureDies, stateTrigger, trig, vanilla } from './cards';
import { find, gameOf, move, passTo, put, scenario, settle, stackAbilities, synth, tweak } from './helpers';

const defs = [vanilla(), vanilla('Test Other'), stateTrigger()];
const start = (): GameState => scenario(['Plains'], { defs, p1: { battlefield: ['Test Vanilla'] }, p2: { battlefield: ['Test Other'] } });
const sacrifice = (name: string): EffectStep[] => [{ op: 'sacrifice', what: { ref: 'bound', name } }];
const endStep = (g: Game, turn = g.s.turn.number): void => { g.s.turn.number = turn; g.s.turn.step = 'end'; g.emit({ type: 'stepBegan', step: 'end', activePlayer: g.s.turn.activePlayer }); };

describe('CR 603.7: delayed triggered abilities', () => {
  it('"at the beginning of the next end step" fires at the end step, once, and is then gone (CR 603.7b)', () => {
    const s0 = start();
    const g = gameOf(s0);
    const hand = find(s0, 'Test Vanilla', 'battlefield');
    createDelayedTrigger(g, { source: { id: hand, zone: 'battlefield' }, controller: 'p1', when: { at: 'step', step: 'end', next: true }, do: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] });
    expect(g.s.delayedTriggers).toHaveLength(1);
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toEqual([]); // nothing yet
    endStep(g);
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toHaveLength(1);
    expect(g.s.pendingTriggers[0]).toMatchObject({ controller: 'p1', sourceId: hand, abilityRef: { source: 'delayed' } });
    expect(g.s.delayedTriggers).toEqual([]);
    endStep(g, g.s.turn.number + 1);
    g.s.pendingTriggers = [];
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toEqual([]); // a delayed triggered ability triggers only once
  });

  it('created during the end step, "the next end step" is the next turn\'s (CR 603.7)', () => {
    const g = gameOf(start());
    g.s.turn.step = 'end';
    createDelayedTrigger(g, { source: { id: find(g.s, 'Test Vanilla', 'battlefield'), zone: 'battlefield' }, controller: 'p1', when: { at: 'step', step: 'end', next: true }, do: [] });
    endStep(g); // the same end step: its stepBegan event came earlier, but a second one in the same turn must not fire it either
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toEqual([]);
    endStep(g, g.s.turn.number + 1);
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toHaveLength(1);
  });

  it('"at the beginning of your next upkeep" waits for its controller\'s upkeep', () => {
    const g = gameOf(start());
    createDelayedTrigger(g, { source: { id: find(g.s, 'Test Vanilla', 'battlefield'), zone: 'battlefield' }, controller: 'p1', when: { at: 'step', step: 'upkeep', whose: 'you', next: true }, do: [] });
    g.s.turn.number = 2;
    g.emit({ type: 'stepBegan', step: 'upkeep', activePlayer: 'p2' });
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toEqual([]);
    g.s.turn.number = 3;
    g.emit({ type: 'stepBegan', step: 'upkeep', activePlayer: 'p1' });
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toHaveLength(1);
  });

  it('"at end of combat" fires at the end of combat step', () => {
    const g = gameOf(start());
    createDelayedTrigger(g, { source: { id: find(g.s, 'Test Vanilla', 'battlefield'), zone: 'battlefield' }, controller: 'p1', when: { at: 'endOfCombat' }, do: [] });
    g.s.turn.step = 'endCombat';
    g.emit({ type: 'stepBegan', step: 'endCombat', activePlayer: 'p1' });
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toHaveLength(1);
  });

  it('an event trigger fires on the next matching event after it was created, never on one that happened just before (CR 603.7a)', () => {
    const s0 = start();
    const g = gameOf(s0);
    const mine = find(s0, 'Test Vanilla', 'battlefield');
    const theirs = find(s0, 'Test Other', 'battlefield', 'p2');
    move(g, mine, 'graveyard'); // the event comes first ...
    createDelayedTrigger(g, { source: { id: theirs, zone: 'battlefield' }, controller: 'p2', when: { at: 'event', event: creatureDies }, do: [] }); // ... then the record exists
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toEqual([]);
    const h = gameOf(s0);
    createDelayedTrigger(h, { source: { id: theirs, zone: 'battlefield' }, controller: 'p2', when: { at: 'event', event: creatureDies }, do: [] });
    move(h, mine, 'graveyard');
    collectPendingTriggers(h);
    expect(h.s.pendingTriggers).toHaveLength(1);
    expect(h.s.pendingTriggers[0]!.controller).toBe('p2'); // CR 603.7d-e: the controller of the effect that created it
  });

  it('with a stated duration it fires every time until the duration ends (CR 603.7b)', () => {
    const s0 = start();
    const g = gameOf(s0);
    const mine = find(s0, 'Test Vanilla', 'battlefield');
    createDelayedTrigger(g, { source: { id: mine, zone: 'battlefield' }, controller: 'p1', when: { at: 'event', event: { ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' } }, do: [], duration: { d: 'endOfTurn' } });
    for (let i = 0; i < 2; i++) {
      g.emit({ type: 'zoneChanged', oldId: `x${i}`, newId: mine, from: 'hand', to: 'battlefield', owner: 'p1', controller: 'p1', name: 'x' });
      g.emit({ type: 'resolved', objectId: `y${i}` });
    }
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toHaveLength(2);
    expect(g.s.delayedTriggers).toHaveLength(1);
    g.s.turn.number++; // the cleanup step of that turn is over
    expireDelayed(g);
    expect(g.s.delayedTriggers).toEqual([]);
  });

  it('CR 603.7c: it remembers what it captured with the zone it was in, so a new object is not affected', () => {
    const s0 = start();
    const mine = find(s0, 'Test Vanilla', 'battlefield');
    const baked = bakeSteps(sacrifice('c'), { c: [{ id: mine, zone: 'battlefield' }] }, {});
    expect(baked).toEqual([{ op: 'sacrifice', what: { ref: 'fixed', objects: [{ id: mine, zone: 'battlefield' }] } }]);
    // other names stay names; variables fixed at creation become numbers (CR 608.2h)
    expect(bakeSteps([{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'var', name: 'n' } }, { op: 'tap', what: { ref: 'bound', name: 'other' } }], { c: [] }, { n: 4 })).toEqual([
      { op: 'gainLife', who: { ref: 'you' }, amount: 4 }, { op: 'tap', what: { ref: 'bound', name: 'other' } },
    ]);
    // end to end: Sneak Attack's sacrifice at the next end step, carrying the creature it put onto the battlefield
    const g = gameOf(s0);
    createDelayedTrigger(g, { source: { id: mine, zone: 'battlefield' }, controller: 'p1', when: { at: 'step', step: 'end', next: true }, do: sacrifice('c'), captured: { c: [{ id: mine, zone: 'battlefield' }] } });
    endStep(g);
    const s = settle(g);
    const [a] = stackAbilities(s);
    const ability = s.objects[a!.id]!.stack!;
    expect(ability.abilityRef!.source).toBe('delayed');
    expect(ability.inline!.kind === 'triggered' && ability.inline!.effect.steps).toEqual(baked);
    expect(s.objects[a!.id]!.controller).toBe('p1');
  });

  it('a delayed trigger of the real game goes on the stack at the end step of the turn, above nothing else, and the active player gets priority', () => {
    const s0 = start();
    const g = gameOf(s0);
    createDelayedTrigger(g, { source: { id: find(s0, 'Test Vanilla', 'battlefield'), zone: 'battlefield' }, controller: 'p1', when: { at: 'step', step: 'end', next: true }, do: [] });
    const s = passTo(g.s, 1, 'end');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(stackAbilities(s)).toHaveLength(1);
    expect(s.delayedTriggers).toEqual([]);
  });
});

describe('CR 603.12, 603.3: reflexive triggered abilities', () => {
  const kill: EffectStep[] = [{ op: 'destroy', what: { ref: 'target', id: 'r0' } }];
  const spec = { id: 'r0', kind: 'object' as const, filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
  const reflexive = (g: Game, extra: Partial<Parameters<typeof putReflexiveTrigger>[1]> = {}) =>
    putReflexiveTrigger(g, { source: { id: find(g.s, 'Test Vanilla', 'battlefield'), zone: 'battlefield' }, controller: 'p1', text: 'When you do, destroy target creature.', targets: [spec], steps: kill, ...extra });

  it('"When you do, ..." is checked immediately but waits for the next time a player would receive priority: nothing is chosen and nothing is on the stack yet', () => {
    const g = gameOf(start()); // no answers: choosing a target now would throw NeedDecision
    const t = reflexive(g);
    expect(g.s.zones.stack).toEqual([]);
    expect(g.s.pendingTriggers).toEqual([t]);
    expect(t).toMatchObject({ controller: 'p1', abilityRef: { source: 'reflexive' }, targetSpecs: [spec] });
    expect(t.inline).toMatchObject({ kind: 'triggered', text: 'When you do, destroy target creature.' });
  });

  it('then it goes on the stack with its own target, chosen as it is put on the stack (CR 603.3d)', () => {
    const s0 = start();
    const them = find(s0, 'Test Other', 'battlefield', 'p2');
    const g = gameOf(s0, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: them }] }]);
    const t = reflexive(g);
    settle(g);
    const [a] = stackAbilities(g.s);
    expect(a).toMatchObject({ source: 'Test Vanilla', controller: 'p1', targets: [them] });
    expect(g.s.objects[a!.id]!.stack).toMatchObject({ kind: 'triggered', abilityRef: { source: 'reflexive' } });
    expect(g.events.some((e) => e.type === 'abilityTriggered' && e.objectId === a!.id)).toBe(true);
    expect(g.s.pendingTriggers.some((x) => x.id === t.id)).toBe(false);
  });

  it('CR 603.3b: it takes its place in APNAP order among the triggers that triggered together: the trigger of the active player goes on first even though the reflexive one was checked first', () => {
    const watcher = synth({
      name: 'Test Death Gainer', cost: '{1}', type: 'Enchantment',
      abilities: [trig('Whenever a creature dies, you gain 1 life.', [creatureDies], { steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] })],
    });
    const s0 = scenario(['Plains'], { defs: [...defs, vanilla('Test Fodder'), watcher], p1: { battlefield: ['Test Vanilla', 'Test Fodder', 'Test Death Gainer'] }, p2: { battlefield: ['Test Other'] } });
    const mine = find(s0, 'Test Vanilla', 'battlefield', 'p1');
    const g = gameOf(s0, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: mine }] }]);
    // the parent resolution of the opponent spell sacrifices a creature (the watcher of the active player triggers) and then "when you do" is checked
    move(g, find(s0, 'Test Fodder', 'battlefield'), 'graveyard', { cause: 'sacrifice' });
    reflexive(g, { source: { id: find(s0, 'Test Other', 'battlefield', 'p2'), zone: 'battlefield' }, controller: 'p2' });
    settle(g);
    expect(stackAbilities(g.s).map((a) => [a.controller, a.source])).toEqual([['p1', 'Test Death Gainer'], ['p2', 'Test Other']]);
  });

  it('with no legal target it is removed from the stack when it would be put there (CR 603.3d)', () => {
    const s0 = tweak(start(), (t) => { t.zones.battlefield = t.zones.battlefield.filter((x) => t.objects[x]!.controller === 'p1'); });
    const g = gameOf(s0);
    const t = reflexive(g, { targets: [{ ...spec, filter: { types: ['Artifact'] } }] });
    settle(g);
    expect(g.s.zones.stack).toEqual([]);
    expect(g.s.pendingTriggers).toEqual([]);
    expect(g.s.log.some((l) => /removed from the stack/.test(l.text) && l.rules?.includes('CR 603.3d'))).toBe(true);
    void t;
  });

  it('what the parent resolution bound is carried along (names become fixed handles)', () => {
    const s0 = start();
    const mine = find(s0, 'Test Vanilla', 'battlefield');
    const g = gameOf(s0);
    const t = putReflexiveTrigger(g, { source: { id: mine, zone: 'battlefield' }, controller: 'p1', text: 'When you do, sacrifice it.', targets: [], steps: sacrifice('c'), bound: { c: [{ id: mine, zone: 'battlefield' }] } });
    expect(t.inline!.kind === 'triggered' && t.inline!.effect.steps).toEqual([{ op: 'sacrifice', what: { ref: 'fixed', objects: [{ id: mine, zone: 'battlefield' }] } }]);
    settle(g);
    const stack = g.s.objects[g.s.zones.stack[0]!]!.stack!;
    expect(stack.inline!.kind === 'triggered' && stack.inline!.effect.steps).toEqual([{ op: 'sacrifice', what: { ref: 'fixed', objects: [{ id: mine, zone: 'battlefield' }] } }]);
  });
});

/** The state trigger is placed after the scenario reached its first main phase: a state trigger would otherwise go on the stack at the first opportunity. */
const withStateTrigger = (s: GameState): GameState => tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test State Trigger'); });

describe('CR 603.8: state triggers', () => {
  it('trigger as soon as the state is true, once, and again only after the ability left the stack', () => {
    const g = gameOf(withStateTrigger(scenario(['Plains'], { defs, p1: { battlefield: [] } })));
    expect(putPendingTriggersOnStack(g)).toBe(true);
    expect(stackAbilities(g.s)).toHaveLength(1);
    expect(putPendingTriggersOnStack(g)).toBe(false); // a copy is on the stack: it does not trigger again
    expect(stackAbilities(g.s)).toHaveLength(1);
    // the ability resolves (or is countered): it leaves the stack, and the state is still true
    const ab = g.s.zones.stack[0]!;
    g.s.zones.stack = [];
    delete g.s.objects[ab];
    expect(putPendingTriggersOnStack(g)).toBe(true);
    expect(stackAbilities(g.s)).toHaveLength(1);
  });

  it('does not trigger while the state is false', () => {
    const s0 = withStateTrigger(scenario(['Plains'], { defs, p1: { battlefield: ['Test Vanilla'] } }));
    const g = gameOf(s0);
    expect(putPendingTriggersOnStack(g)).toBe(false);
    expect(g.s.zones.stack).toEqual([]);
    // the creature leaves: the state becomes true and the ability triggers at the next opportunity
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    expect(putPendingTriggersOnStack(g)).toBe(true);
    expect(stackAbilities(g.s).map((a) => a.source)).toEqual(['Test State Trigger']);
  });

  it('a state trigger is not an event: it does not appear among the triggers collected from a batch', () => {
    const s0 = withStateTrigger(scenario(['Plains'], { defs, p1: { battlefield: [], hand: ['Test Vanilla'] } }));
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    collectPendingTriggers(g);
    // the creature entered, so the state "you control no creatures" is false and nothing triggered
    expect(g.s.pendingTriggers).toEqual([]);
  });
});
