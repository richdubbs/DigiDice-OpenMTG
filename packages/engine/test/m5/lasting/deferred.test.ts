/**
 * What a delayed (CR 603.7) or reflexive (CR 603.12) triggered ability, or an `until` duration (CR 610.3, 611.2a), keeps of the resolution that created it:
 *   - the players it names are fixed, and WP8's matcher matches a fixed player set (`triggers/filters.ts#refPlayers`), so "that player's next end step",
 *     "target player's upkeep" and "until target player casts a spell" fire or end at all;
 *   - information about this resolution's targets and bound objects that only last known information still has (CR 608.2h, 603.7c) is read at creation:
 *     "its controller" of a countered spell, "that spell's mana value", "that creature's power" of a sacrificed creature.
 * Spine, pipeline and the ops of other families are the fakes of neighbors.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContinuousEffectRec, EffectStep, GameState, TargetSpec } from '../../../src/index';
import { advanceTo, answer, find, passBoth, scenario } from '../helpers';
import { activate, activated, cast, castAndResolve, creatureTarget, instant, objectTarget, permanent, playerTarget, programOf, pt, setup, targets } from './support';

vi.mock('../../../src/effects/propose', async (o) => (await import('./neighbors')).proposeMock(await o()));
vi.mock('../../../src/effects/manual', async (o) => (await import('./neighbors')).manualMock(await o()));
vi.mock('../../../src/effects/run', async (o) => (await import('./neighbors')).runMock(await o()));
vi.mock('../../../src/core/resolve', async (o) => (await import('./neighbors')).resolveMock(await o()));

beforeEach(setup);

const playerSpec: TargetSpec = { id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' };
const records = (s: GameState): ContinuousEffectRec[] => s.continuousEffects;
const hand = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const draw = (count: EffectStep extends never ? never : Extract<EffectStep, { op: 'draw' }>['count'], who: Extract<EffectStep, { op: 'draw' }>['who'] = { ref: 'you' }): EffectStep => ({ op: 'draw', who, count });

describe('CR 603.7, 610.3: player references of delayed triggers and "until" durations are fixed and matched', () => {
  it('CR 603.7: "return that card at the beginning of that player\'s next end step" fires at the end step of the exiled card\'s owner (The Eternal Wanderer +1)', () => {
    const WANDER = instant('Wander Test', [
      { op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, as: 'ex' },
      { op: 'delay', when: { at: 'step', step: 'end', whose: { ref: 'ownerOf', object: { ref: 'target', id: 't0' } }, next: true }, do: [{ op: 'move', what: { ref: 'bound', name: 'ex' }, to: { zone: 'battlefield', controller: 'owner' } }] },
    ], [creatureTarget()], 'Sorcery');
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Wander Test'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [WANDER] });
    let s = castAndResolve(s0, 'Wander Test', [targets(objectTarget(find(s0, 'Grizzly Bears', 'battlefield')))]);
    expect(s.delayedTriggers[0]!.when).toEqual({ at: 'step', step: 'end', whose: { ref: 'fixed', players: ['p2'] }, next: true });
    s = advanceTo(s, 1, 'end');
    expect(s.zones.stack).toEqual([]); // not at the caster's end step
    s = advanceTo(s, 2, 'end');
    expect(s.zones.stack).toHaveLength(1); // at the owner's
    s = passBoth(s);
    expect(s.objects[find(s, 'Grizzly Bears', 'battlefield', 'p2')]!.controller).toBe('p2');
  });

  it('CR 603.7: "at the beginning of target player\'s next upkeep" fires at that player\'s upkeep', () => {
    const LATER = instant('Later Draw', [{ op: 'delay', when: { at: 'step', step: 'upkeep', whose: { ref: 'target', id: 't0' }, next: true }, do: [draw(1)] }], [playerSpec]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Later Draw'] }, defs: [LATER] }), 'Later Draw', [targets(playerTarget('p2'))]);
    const t = advanceTo(s, 2, 'upkeep');
    expect(t.turn.activePlayer).toBe('p2');
    expect(t.zones.stack).toHaveLength(1);
  });

  it('CR 603.7: "when target player next casts a spell this turn" triggers when that player casts one', () => {
    const WATCH = instant('Watch Test', [{ op: 'delay', when: { at: 'event', event: { ev: 'cast', player: { ref: 'target', id: 't0' } } }, duration: { d: 'endOfTurn' }, do: [draw(1)] }], [playerSpec]);
    const DUMMY = instant('Dummy Spell', []);
    let s = castAndResolve(scenario([], { p1: { hand: ['Watch Test', 'Dummy Spell'] }, defs: [WATCH, DUMMY] }), 'Watch Test', [targets(playerTarget('p1'))]);
    expect(s.delayedTriggers[0]!.when).toEqual({ at: 'event', event: { ev: 'cast', player: { ref: 'fixed', players: ['p1'] } } });
    s = cast(s, 'Dummy Spell');
    expect(s.zones.stack).toHaveLength(2); // the spell and the delayed trigger above it
  });

  it('CR 610.3, 611.2a: an effect "until target player casts a spell" ends when that player casts one', () => {
    const BANNER = permanent('Until Banner', 'Artifact', [activated('Banner', {
      targets: [playerSpec],
      steps: [{ op: 'effect', duration: { d: 'until', event: { ev: 'cast', player: { ref: 'target', id: 't0' } } }, effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] }],
    })]);
    const DUMMY = instant('Dummy Spell', []);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Dummy Spell'], battlefield: ['Until Banner', 'Grizzly Bears'] }, defs: [BANNER, DUMMY] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = passBoth(activate(s0, find(s0, 'Until Banner', 'battlefield'), 0, [targets(playerTarget('p1'))]));
    expect(pt(s, bears)).toEqual([3, 3]);
    expect(records(s)[0]!.duration).toEqual({ d: 'until', event: { ev: 'cast', player: { ref: 'fixed', players: ['p1'] } } });
    s = cast(s, 'Dummy Spell');
    expect(records(s)).toEqual([]);
    expect(pt(s, bears)).toEqual([2, 2]);
  });
});

describe('CR 608.2h, 603.7c: deferred abilities read what only last known information still knows at creation', () => {
  const DENY_SPEC = programOf('Pact of Negation').targets;

  it('CR 608.2h: "Counter target spell. Its controller draws two cards at the beginning of the next upkeep" (Arcane Denial): the countered spell\'s controller draws', () => {
    const DENIAL = instant('Denial Test', [
      { op: 'counter', what: { ref: 'target', id: 't0' } },
      { op: 'delay', when: { at: 'step', step: 'upkeep', next: true }, do: [draw(2, { ref: 'controllerOf', object: { ref: 'target', id: 't0' } })] },
    ], DENY_SPEC);
    const DUMMY = instant('Dummy Spell', []);
    const s0 = cast(scenario([], { p1: { hand: ['Denial Test', 'Dummy Spell'] }, defs: [DENIAL, DUMMY] }), 'Dummy Spell');
    let s = passBoth(cast(s0, 'Denial Test', [targets(objectTarget(s0.zones.stack[0]!))]));
    expect(s.delayedTriggers[0]!.do).toEqual([draw(2, { ref: 'fixed', players: ['p1'] })]);
    s = advanceTo(s, 2, 'upkeep');
    const before = hand(s);
    s = passBoth(s);
    expect(hand(s)).toBe(before + 2);
  });

  it('CR 608.2h: a quantity about a countered target ("that spell\'s mana value", Mana Drain) is read from its last known information', () => {
    const DRAIN = instant('Drain Test', [
      { op: 'counter', what: { ref: 'target', id: 't0' } },
      { op: 'delay', when: { at: 'step', step: 'main1', whose: 'you', next: true }, do: [draw({ q: 'stat', stat: 'manaValue', of: { ref: 'target', id: 't0' } })] },
    ], DENY_SPEC);
    const TWO = instant('Two Drops', [], [], 'Instant', '{2}');
    const s0 = cast(scenario(['Plains'], { p1: { hand: ['Drain Test', 'Two Drops'], battlefield: ['Plains', 'Plains'] }, defs: [DRAIN, TWO] }), 'Two Drops');
    const s = passBoth(cast(s0, 'Drain Test', [targets(objectTarget(s0.zones.stack[0]!))]));
    expect(s.delayedTriggers[0]!.do).toEqual([draw(2)]);
  });

  it('CR 608.2h, 603.12: "you may sacrifice another creature. When you do, draw cards equal to that creature\'s power" reads the power it had on the battlefield', () => {
    const MANTICORE = permanent('Manticore Test', 'Artifact', [activated('Sac', {
      targets: [],
      steps: [
        { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, min: 0, max: 1, as: 'c' },
        { op: 'sacrifice', what: { ref: 'bound', name: 'c' }, as: 'sac' },
        { op: 'reflexive', when: { did: 'sac' }, targets: [], do: [draw({ q: 'stat', stat: 'power', of: { ref: 'bound', name: 'c' } })] },
      ],
    })]);
    let s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Manticore Test', 'Grizzly Bears'] }, defs: [MANTICORE] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    s0 = structuredClone(s0);
    s0.objects[bears]!.counters['+1/+1'] = 2; // a 4/4 on the battlefield, a 2/2 card in the graveyard
    let s = answer(passBoth(activate(s0, find(s0, 'Manticore Test', 'battlefield'))), { kind: 'chooseObjects', ids: [bears] });
    expect(s.zones.stack).toHaveLength(1); // the reflexive trigger
    const before = hand(s);
    s = passBoth(s);
    expect(hand(s)).toBe(before + 4);
  });

  it('CR 603.7c: a target still where it is expected is NOT read early: the delayed ability reads it when it resolves', () => {
    const LATER = instant('Later Count', [
      { op: 'delay', when: { at: 'step', step: 'end', next: true }, do: [draw({ q: 'stat', stat: 'power', of: { ref: 'target', id: 't0' } })] },
    ], [creatureTarget()]);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Later Count'], battlefield: ['Grizzly Bears'] }, defs: [LATER] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = castAndResolve(s0, 'Later Count', [targets(objectTarget(bears))]);
    expect(s.delayedTriggers[0]!.do).toEqual([draw({ q: 'stat', stat: 'power', of: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] } })]);
  });
});
