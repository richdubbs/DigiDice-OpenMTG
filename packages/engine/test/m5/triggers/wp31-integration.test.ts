/**
 * WP31: the integration placeholders of test/m5/triggers/integration.test.ts, turned into tests now that the packages they waited for (WP4, WP7, WP9, WP10,
 * WP14) have merged. Real games through `applyAction`: triggers collected by WP8, announced by WP7, resolved by WP10's spine with WP11's pipeline. Nothing is
 * faked. (The triggered mana ability placeholder, CR 605.1b, was deleted: see integration.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, Condition, ContinuousEffectRec, EventPattern, GameState, ObjectId } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { evalCond } from '../../../src/effects/eval';
import { localCondition, triggerCtx, type CondEnv } from '../../../src/triggers/cond';
import { SUPPORTED } from '../../../src/triggers/forms';
import { answer, castAuto, find, lifeOf, passBoth, scenario, synth, tweak } from '../helpers';
import { objectTarget, playerTarget } from '../announce/support';
import { trig, entersSelf } from './cards';
import { gameOf } from './helpers';

const you = { ref: 'you' } as const;
const each = (filter: object) => ({ ref: 'each', filter }) as const;
const LANDS = ['Plains', 'Plains', 'Forest', 'Forest', 'Mountain', 'Mountain', 'Swamp', 'Swamp'];
const creature = (name: string, pt: [string, string], abilities: CardDef['faces'][0]['abilities'] = []): CardDef => synth({ name, cost: '{1}', type: 'Creature — Test', pt, abilities });
const BEARS = creature('Test Bears', ['2', '2']);
const DOOM = synth({ name: 'Test Doom', cost: '{1}', type: 'Instant', abilities: [{ kind: 'spell', text: 'Destroy target creature.', effect: { targets: [{ id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' }], steps: [{ op: 'destroy', what: { ref: 'target', id: 't0' } }] } }] });
const PING = synth({ name: 'Test Ping', cost: '{1}', type: 'Sorcery', abilities: [{ kind: 'spell', text: 'Draw a card.', effect: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } }] });

function board(defs: CardDef[], p1: { battlefield?: (string | { name: string; tapped?: boolean; counters?: Record<string, number> })[]; hand?: string[] } = {}, p2: { battlefield?: string[] } = {}): GameState {
  return scenario([...new Set(LANDS)], { defs, p1: { battlefield: [...LANDS, ...(p1.battlefield ?? [])], hand: p1.hand ?? [] }, p2: { battlefield: [...LANDS, ...(p2.battlefield ?? [])] } });
}

/** p1 casts `name` (with object targets) and both players pass until the stack is empty, answering nothing else. */
function resolveAll(s0: GameState, name: string, targets: ObjectId[] = []): GameState {
  let s = castAuto(s0, name, targets.length ? { answers: [{ kind: 'chooseTargets', targets: targets.map(objectTarget) }] } : {});
  for (let i = 0; i < 10 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = passBoth(s);
  return s;
}

describe('CR 603.4 (WP10): the intervening "if" is checked again as the triggered ability resolves', () => {
  const watcher = synth({
    name: 'Test Tapped Watcher', cost: '{1}', type: 'Artifact',
    abilities: [trig('Whenever you cast a spell, if ~ is tapped, you gain 1 life.', [{ ev: 'cast', player: 'you' }], { steps: [{ op: 'gainLife', who: you, amount: 1 }] }, { interveningIf: { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } } })],
  });

  it.each([[true, 21], [false, 20]] as const)('still tapped as it resolves: %s, life %i', (stillTapped, life) => {
    const s0 = board([watcher, PING], { battlefield: [{ name: 'Test Tapped Watcher', tapped: true }], hand: ['Test Ping'] });
    let s = castAuto(s0, 'Test Ping');
    expect(s.zones.stack).toHaveLength(2); // the spell and, above it, the trigger (the condition held as the spell was cast)
    if (!stillTapped) s = tweak(s, (t) => { t.objects[find(t, 'Test Tapped Watcher', 'battlefield')]!.tapped = false; });
    s = passBoth(s);
    expect(lifeOf(s, 'p1')).toBe(life);
  });
});

describe('CR 603.6b (WP9): an enters trigger is looked for in the permanent as it enters', () => {
  const etb = creature('Test Arrival', ['2', '2'], [trig('When ~ enters, you gain 3 life.', [entersSelf], { steps: [{ op: 'gainLife', who: you, amount: 3 }] })]);
  const humility = synth({
    name: 'Test Humility', cost: '{2}{W}{W}', type: 'Enchantment',
    abilities: [{ kind: 'static', text: 'All creatures lose all abilities.', effects: [{ s: 'continuous', affects: each({ types: ['Creature'] }), mods: [{ layer: 6, removeAll: true }] }] }],
  });

  it('with a Humility-style effect the creature enters without its ability: nothing triggers; without it, it triggers', () => {
    expect(lifeOf(resolveAll(board([etb, humility], { battlefield: ['Test Humility'], hand: ['Test Arrival'] }), 'Test Arrival'), 'p1')).toBe(20);
    expect(lifeOf(resolveAll(board([etb], { hand: ['Test Arrival'] }), 'Test Arrival'), 'p1')).toBe(23);
  });
});

describe('CR 603.10a (WP9, WP4): a look-back trigger judges the creature as it last existed on the battlefield (LastKnown.chars)', () => {
  const bigDies: EventPattern = { ev: 'zoneChange', subject: { types: ['Creature'], power: { op: '>=', value: 5 } }, from: 'battlefield', to: 'graveyard' };
  const watcher = synth({ name: 'Test Big Mourner', cost: '{1}', type: 'Enchantment', abilities: [trig('Whenever a creature with power 5 or greater dies, you gain 5 life.', [bigDies], { steps: [{ op: 'gainLife', who: you, amount: 5 }] })] });
  const anthem = synth({ name: 'Test Anthem', cost: '{1}', type: 'Enchantment', abilities: [{ kind: 'static', text: 'Creatures you control get +3/+3.', effects: [{ s: 'continuous', affects: each({ types: ['Creature'], controller: 'you' }), mods: [{ layer: '7c', power: 3, toughness: 3 }] }] }] });

  it('a 2/2 that is 5/5 under an anthem when it dies is matched; without the anthem it is not', () => {
    const s = board([watcher, anthem, BEARS, DOOM], { battlefield: ['Test Big Mourner', 'Test Anthem', 'Test Bears'], hand: ['Test Doom'] });
    expect(lifeOf(resolveAll(s, 'Test Doom', [find(s, 'Test Bears', 'battlefield')]), 'p1')).toBe(25);
    const plain = board([watcher, BEARS, DOOM], { battlefield: ['Test Big Mourner', 'Test Bears'], hand: ['Test Doom'] });
    expect(lifeOf(resolveAll(plain, 'Test Doom', [find(plain, 'Test Bears', 'battlefield')]), 'p1')).toBe(20);
  });

  it('a 2/2 with a +1/+1 counter and a Giant Growth effect (+3/+3 until end of turn) dies as the 6/6 it was', () => {
    let s = board([watcher, BEARS, DOOM], { battlefield: ['Test Big Mourner', { name: 'Test Bears', counters: { '+1/+1': 1 } }], hand: ['Test Doom'] });
    const bears = find(s, 'Test Bears', 'battlefield');
    const growth: ContinuousEffectRec = {
      id: 'e-growth', source: null, sourceName: 'Giant Growth', controller: 'p1', timestamp: 900, startedTurn: 1, duration: { d: 'endOfTurn' },
      effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mods: [{ layer: '7c', power: 3, toughness: 3 }] },
    };
    s = tweak(s, (t) => { t.continuousEffects.push(growth); });
    expect(lifeOf(resolveAll(s, 'Test Doom', [bears]), 'p1')).toBe(25);
  });
});

describe('CR 603.4, 603.8 (WP4): effects/eval.ts#evalCond agrees with triggers/cond.ts#localCondition on every condition both know', () => {
  const watcher = synth({ name: 'Test Source', cost: '{1}', type: 'Artifact', abilities: [] });
  const creatureDied: EventPattern = { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' };
  const conditions: Condition[] = [
    { cond: 'compare', left: { q: 'life', of: you }, op: '>=', right: 20 },
    { cond: 'compare', left: { q: 'count', of: each({ types: ['Creature'] }) }, op: '==', right: 1 },
    { cond: 'exists', of: each({ types: ['Creature'], controller: 'you' }) },
    { cond: 'exists', of: each({ types: ['Land'], controller: 'you' }), atLeast: 9 },
    { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } },
    { cond: 'matches', object: { ref: 'self' }, filter: { types: ['Artifact'] } },
    { cond: 'turnOf', whose: 'you' },
    { cond: 'turnOf', whose: 'opponent' },
    { cond: 'turnOf', whose: 'you', step: 'main1' },
    { cond: 'wasCast' },
    { cond: 'happened', event: creatureDied, scope: 'turn' },
    { cond: 'happened', event: creatureDied, scope: 'turn', times: { op: '>=', value: 2 } },
    { cond: 'designation', who: you, what: 'monarch' },
    { cond: 'all', of: [{ cond: 'turnOf', whose: 'you' }, { cond: 'exists', of: each({ types: ['Creature'] }) }] },
    { cond: 'any', of: [{ cond: 'turnOf', whose: 'opponent' }, { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } }] },
    { cond: 'not', of: { cond: 'turnOf', whose: 'you' } },
  ];

  /** A few states: the start, after a creature died this turn, with p1 the monarch and the source tapped, and on p2's turn. */
  function states(): GameState[] {
    const s0 = board([watcher, BEARS, DOOM], { battlefield: ['Test Source', 'Test Bears'], hand: ['Test Doom'] }, { battlefield: [] });
    const died = resolveAll(s0, 'Test Doom', [find(s0, 'Test Bears', 'battlefield')]);
    const monarch = tweak(died, (t) => { t.designations.monarch = 'p1'; t.objects[find(t, 'Test Source', 'battlefield')]!.tapped = true; });
    const p2Turn = tweak(s0, (t) => { t.turn.activePlayer = 'p2'; });
    return [s0, died, monarch, p2Turn];
  }

  it('the same answer whenever the trigger-time evaluator can tell (and it can for every condition of the table)', () => {
    let compared = 0;
    for (const s of states()) {
      const g = gameOf(s);
      const env: CondEnv = { source: { id: find(s, 'Test Source', 'battlefield'), zone: 'battlefield' }, controller: 'p1', event: null };
      for (const c of conditions) {
        const local = localCondition(g, c, env);
        expect(local, JSON.stringify(c)).not.toBeUndefined();
        expect(evalCond(triggerCtx(g, env), c), JSON.stringify(c)).toBe(local);
        compared++;
      }
    }
    expect(compared).toBe(4 * conditions.length);
  });
});

describe('CR 603.3d (WP7): a triggered ability with divided damage announces its division (chooseDivision)', () => {
  const thrower = creature('Test Thrower', ['1', '1'], [trig('When ~ enters, it deals 3 damage divided as you choose among one or two targets.', [entersSelf], {
    targets: [{ id: 't0', kind: 'anyTarget', min: 1, max: 2, text: 'one or two targets', divide: { what: 'damage', total: 3 } }],
    steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3, divided: 'announced' }],
  })]);

  it('feature:target.divide is registered; the trigger asks for targets, then the division, and deals it', () => {
    expect(ENGINE_CAPABILITIES.has('feature:target.divide')).toBe(true);
    const s0 = board([thrower, creature('Test Wall', ['0', '4'])], { hand: ['Test Thrower'] }, { battlefield: ['Test Wall'] });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    let s = passBoth(castAuto(s0, 'Test Thrower')); // the creature resolves; its trigger is announced (CR 603.3d)
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 'p1' });
    s = answer(s, { kind: 'chooseTargets', targets: [playerTarget('p2'), objectTarget(wall)] });
    expect(s.pending).toMatchObject({ kind: 'chooseDivision', what: 'damage', total: 3 });
    s = answer(s, { kind: 'chooseDivision', amounts: [1, 2] });
    s = passBoth(s);
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(s.objects[wall]!.damage).toBe(2);
  });
});

describe('CR 701.3a, 701.6a, 701.27 (WP14): the events WP14 emits are advertised and seen by triggers', () => {
  it('attached, transformed, countered and (WP32) "becomes the target" are in SUPPORTED; the keyword-action verbs scry, surveil and (Standard round 4, r4-trig) search too', () => {
    for (const f of ['ev.becomes.attached', 'ev.becomes.transformed', 'ev.action.counter', 'ev.cast.orCopy', 'ev.becomes.targeted']) {
      expect(SUPPORTED, f).toContain(f);
      expect(ENGINE_CAPABILITIES.has(`feature:${f}`), f).toBe(true);
    }
    // WP32 emits `becameTarget` when a triggered ability targets too (CR 702.21a, ward), so `ev.becomes.targeted` is advertised (wp32-ward.test.ts).
    // Not advertised (fail closed): the verbs of WP13's `actionPerformed` (scry, surveil, search, reveal) are normalized but not yet added to SUPPORTED by
    // the owner of triggers/forms.ts.
    // Standard round 4, r4-trig (CR 701.23a): every search of a zone emits `actionPerformed` 'search' with that zone and its owner (effects/handlers/cards-library.ts), so it is advertised
    for (const f of ['ev.action.search']) expect(ENGINE_CAPABILITIES.has(`feature:${f}`), f).toBe(true);
    for (const f of ['ev.action.scry', 'ev.action.surveil']) expect(ENGINE_CAPABILITIES.has(`feature:${f}`), f).toBe(true); // FAST5X E9 (CR 701.22d, 701.25d)
  });

  it('"Whenever a permanent becomes attached to a creature" triggers when an Aura spell resolves attached (core/resolve.ts emits `attached`)', () => {
    const watcher = synth({ name: 'Test Attach Watcher', cost: '{1}', type: 'Enchantment', abilities: [trig('Whenever a permanent becomes attached, you gain 1 life.', [{ ev: 'becomes', what: 'attached', object: {} }], { steps: [{ op: 'gainLife', who: you, amount: 1 }] })] });
    const aura = synth({
      name: 'Test Aura', cost: '{1}', type: 'Enchantment — Aura',
      abilities: [{ kind: 'keyword', text: 'Enchant creature', keyword: 'enchant', filter: { types: ['Creature'] } } as never],
    });
    const s0 = board([watcher, aura, BEARS], { battlefield: ['Test Attach Watcher', 'Test Bears'], hand: ['Test Aura'] });
    const s = resolveAll(s0, 'Test Aura', [find(s0, 'Test Bears', 'battlefield')]);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Aura' && s.objects[id]!.attachedTo === find(s0, 'Test Bears', 'battlefield'))).toBe(true);
    expect(lifeOf(s, 'p1')).toBe(21);
  });
});

