/**
 * WP11: the proposal pipeline and the performers (design 8.5, CR 614-616): every proposed event is performed through the milestone 3/4 primitives and emits
 * the engine events (including `tokenCreated` and `attached` of design 4.1); last known information keeps the layered characteristics; CR 614.5 (once per
 * event), 616.2 (newly applicable effects), "you may" replacements, stack-time `modify.destination`; the three traces of design 8.5 (the foreign replacements
 * are milestone 6: asserted partial and unapplied here).
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ReplacementDef } from '../../../src/index';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model';
import { classifyAbility } from '../../../src/model/classify';
import { playerRestricted } from '../../../src/rules/restrictions';
import { addPlayerRestriction } from '../../../src/rules/restrictions';
import { propose, proposeResult } from '../../../src/effects/propose';
import { moveObject } from '../../../src/core/zones';
import { destroy } from '../../../src/rules/destroy';
import { act, answer, find, inGraveyard, lifeOf, passBoth, scenario, synth, tweak } from '../helpers';
import { drive } from '../announce/support';
import { eventsOf, permanent, run, staticAbility, withAbilities } from './support';

const soldier: CardDef = { ...synth({ name: 'Soldier', type: 'Token Creature — Soldier', pt: ['1', '1'], abilities: [] }), isToken: true };

describe('design 8.5: the performers call the milestone 3/4 primitives and emit the engine events', () => {
  const s0 = (): GameState => scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, defs: [soldier] });

  it('CR 119.3: life gained and lost (rules/life.ts)', () => {
    const r = run(s0(), (g) => [propose(g, { ev: 'life', change: 'gain', player: 'p1', amount: 3 }), propose(g, { ev: 'life', change: 'loss', player: 'p2', amount: 2 })]);
    expect(r.result).toEqual([true, true]);
    expect([lifeOf(r.g.s, 'p1'), lifeOf(r.g.s, 'p2')]).toEqual([23, 18]);
    expect(eventsOf(r.g, 'lifeChanged').map((e) => [e.player, e.delta])).toEqual([['p1', 3], ['p2', -2]]);
  });

  it('CR 121.2: a draw proposal draws one card (core/zones.ts#drawCard)', () => {
    const s = s0();
    const r = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }));
    expect(r.result?.newIds).toHaveLength(1);
    expect(r.g.s.zones.hand.p1).toHaveLength(s.zones.hand.p1!.length + 1);
    expect(eventsOf(r.g, 'drew')).toHaveLength(1);
  });

  it('CR 122.1, 122.6: counters put on and removed from a permanent and a player (poison, CR 122.1f)', () => {
    const s = s0();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = run(s, (g) => {
      propose(g, { ev: 'counters', change: 'put', on: { id: bears, zone: 'battlefield' }, kind: '+1/+1', count: 2 });
      propose(g, { ev: 'counters', change: 'removed', on: { id: bears, zone: 'battlefield' }, kind: '+1/+1', count: 1 });
      propose(g, { ev: 'counters', change: 'put', on: 'p2', kind: 'poison', count: 3 });
      propose(g, { ev: 'counters', change: 'put', on: 'p1', kind: 'energy', count: 2 });
    });
    expect(r.g.s.objects[bears]!.counters['+1/+1']).toBe(1);
    expect(r.g.s.players[1]!.poison).toBe(3);
    expect(r.g.s.players[0]!.counters['energy']).toBe(2);
    expect(eventsOf(r.g, 'countersChanged').map((e) => [e.target, e.counter, e.delta])).toEqual([[bears, '+1/+1', 2], [bears, '+1/+1', -1], ['p2', 'poison', 3], ['p1', 'energy', 2]]);
  });

  it('CR 111.1, 701.7a: createToken makes each token, with tokenCreated and zoneChanged events and the entering facts', () => {
    const r = run(s0(), (g) => proposeResult(g, { ev: 'createToken', player: 'p1', count: 2, token: 'Soldier', enter: { tapped: true, counters: [{ kind: '+1/+1', count: 1 }] } }));
    const ids = r.result!.newIds;
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(r.g.s.objects[id]).toMatchObject({ kind: 'token', tapped: true, counters: { '+1/+1': 1 }, controller: 'p1' });
    expect(eventsOf(r.g, 'tokenCreated').map((e) => e.objectId)).toEqual(ids);
    expect(eventsOf(r.g, 'zoneChanged').filter((e) => e.to === 'battlefield')).toHaveLength(2);
  });

  it('CR 400.7, 608.2h: a zone change performs moveObject; last known information has the layered characteristics (`LastKnown.chars`)', () => {
    const s = tweak(s0(), (t) => { t.objects[find(t, 'Grizzly Bears', 'battlefield')]!.counters['+1/+1'] = 1; });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = run(s, (g) => proposeResult(g, { ev: 'zoneChange', object: { id: bears, zone: 'battlefield' }, from: 'battlefield', to: 'graveyard', destination: { cause: 'test' } }));
    const lki = r.g.s.lki[bears]!;
    expect(lki.chars).toMatchObject({ power: '3', toughness: '3', name: 'Grizzly Bears' });
    expect(lki.newId).toBe(r.result!.newIds[0]);
    expect(eventsOf(r.g, 'zoneChanged')).toMatchObject([{ oldId: bears, from: 'battlefield', to: 'graveyard', cause: 'test' }]);
  });

  it('CR 400.7: a handle whose object has moved is a new object: nothing happens to it', () => {
    const s = s0();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = run(s, (g) => propose(g, { ev: 'counters', change: 'put', on: { id: bears, zone: 'graveyard' }, kind: '+1/+1', count: 1 }));
    expect(r.g.s.objects[bears]!.counters).toEqual({});
  });
});

describe('CR 614.17, 101.2: "can\'t" before any replacement', () => {
  it('a player who can\'t gain life: the life gain is not performed (propose answers false, nothing is emitted)', () => {
    const s = run(scenario([]), (g) => addPlayerRestriction(g, 'p1', 'cantGainLife')).g.s;
    expect(playerRestricted(s, 'p1', 'cantGainLife')).toBe(true);
    const r = run(s, (g) => propose(g, { ev: 'life', change: 'gain', player: 'p1', amount: 5 }));
    expect(r.result).toBe(false);
    expect(lifeOf(r.g.s, 'p1')).toBe(20);
    expect(eventsOf(r.g, 'lifeChanged')).toEqual([]);
  });
});

/** Two self replacements that would send the card back and forth (CR 614.5). */
const pingPong: ReplacementDef[] = [
  { s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } },
  { s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'exile' }, body: { b: 'modify', destination: { zone: 'graveyard' } } },
];

describe('CR 614.5, 616.1, 616.2: the replacement loop', () => {
  it('CR 614.5 + 616.2: each effect applies once; the second becomes applicable to the modified event (graveyard -> exile -> graveyard)', () => {
    const card = permanent('Test Pendulum', 'Creature — Test', [staticAbility('If ~ would be put into a graveyard, exile it instead. If ~ would be exiled, put it into its owner\'s graveyard instead.', pingPong)], { pt: ['1', '1'] });
    const s = scenario([], { p1: { battlefield: ['Test Pendulum'] }, defs: [card] });
    const id = find(s, 'Test Pendulum', 'battlefield');
    const r = run(s, (g) => destroy(g, id));
    expect(r.result).toBe('destroyed');
    expect(inGraveyard(r.g.s, 'Test Pendulum', 'p1')).toBe(true);
    expect(eventsOf(r.g, 'zoneChanged')).toMatchObject([{ from: 'battlefield', to: 'graveyard', cause: 'destroy' }]); // ONE event: the same event went elsewhere (design 3.8)
  });

  it('"you may" (an optional replacement): the affected player is asked; declining leaves the event as it was', () => {
    const optional: ReplacementDef = { ...pingPong[0]!, optional: true };
    const card = permanent('Test Phoenix', 'Creature — Test', [staticAbility('If ~ would be put into a graveyard, you may exile it instead.', [optional])], { pt: ['1', '1'] });
    const s = scenario([], { p1: { battlefield: ['Test Phoenix'] }, defs: [card] });
    const id = find(s, 'Test Phoenix', 'battlefield');
    expect(run(s, (g) => destroy(g, id)).need).toMatchObject({ kind: 'yesNo', player: 'p1' });
    expect(inGraveyard(run(s, (g) => destroy(g, id), [{ kind: 'yesNo', yes: false }]).g.s, 'Test Phoenix', 'p1')).toBe(true);
    expect(run(s, (g) => destroy(g, id), [{ kind: 'yesNo', yes: true }]).g.s.zones.exile).toHaveLength(1);
  });

  it('a self replacement whose ability does not function in the object\'s zone does not apply (CR 113.6)', () => {
    const card = permanent('Test Pendulum', 'Creature — Test', [staticAbility('x', [pingPong[0]!])], { pt: ['1', '1'] }); // functions on the battlefield only
    const s = scenario([], { p1: { hand: ['Test Pendulum'] }, defs: [card] });
    const r = run(s, (g) => moveObject(g, find(s, 'Test Pendulum', 'hand'), 'graveyard', { cause: 'discard' }));
    expect(inGraveyard(r.g.s, 'Test Pendulum', 'p1')).toBe(true);
  });
});

describe('design 8.5: stack-time `modify.destination` (a spell\'s own replacement while it is on the stack)', () => {
  const spellDef = (text: string, effect: ReplacementDef, extra: { kicker?: boolean } = {}): CardDef => synth({
    name: 'Test Rebound', cost: '{R}', type: 'Sorcery',
    abilities: [
      ...(extra.kicker ? [staticAbility('Buyback {1}', [{ s: 'additionalCost', cost: { mana: [{ kind: 'generic', amount: 1 }] }, optional: true, name: 'buyback' }], { zone: ['stack'] })] : []),
      staticAbility(text, [effect], { zone: ['stack'] }),
      { kind: 'spell', text: 'Nothing.', effect: { targets: [], steps: [] } },
    ],
  });
  const exileIt: ReplacementDef = { s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, from: 'stack', to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } };

  it('CR 614.1a: "if this spell would be put into a graveyard from the stack, exile it instead" (resolving)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Rebound'], battlefield: ['Mountain'] }, defs: [spellDef('If ~ would be put into a graveyard from the stack, exile it instead.', exileIt)] });
    const s = passBoth(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rebound', 'hand') }), []));
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Rebound']);
    expect(inGraveyard(s, 'Test Rebound', 'p1')).toBe(false);
  });

  it('buyback (CR 702.27a): "as it resolves" is a move with the cause "resolve"; with the cost paid it goes to the hand', () => {
    const back: ReplacementDef = {
      s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, from: 'stack', to: 'graveyard', cause: 'resolve' },
      condition: { cond: 'wasCast', kicked: 'buyback' }, body: { b: 'modify', destination: { zone: 'hand' } },
    };
    const def = spellDef('If the buyback cost was paid, put this spell into its owner\'s hand instead of into its owner\'s graveyard as it resolves.', back, { kicker: true });
    const board = scenario(['Mountain'], { p1: { hand: ['Test Rebound'], battlefield: ['Mountain', 'Mountain'] }, defs: [def] });
    const cast = (pay: boolean): GameState => passBoth(drive(act(board, { type: 'cast', player: 'p1', card: find(board, 'Test Rebound', 'hand') }), [{ kind: 'yesNo', yes: pay }]));
    const paid = cast(true);
    expect(paid.zones.hand.p1!.map((id) => paid.objects[id]!.defId)).toContain('Test Rebound');
    expect(inGraveyard(cast(false), 'Test Rebound', 'p1')).toBe(true);
    // A move with another cause is not "as it resolves": the replacement does not apply (a countered spell goes to the graveyard, CR 701.6a).
    const onStack = act(board, { type: 'cast', player: 'p1', card: find(board, 'Test Rebound', 'hand') });
    const stackState = drive(onStack, [{ kind: 'yesNo', yes: true }]);
    const spell = stackState.zones.stack[0]!;
    const r = run(stackState, (g) => moveObject(g, spell, 'graveyard', { cause: 'counter' }));
    expect(inGraveyard(r.g.s, 'Test Rebound', 'p1')).toBe(true);
  });
});

/** The replacement statics of design 13.6 (exactly as written there). */
const DOUBLING_SEASON = withAbilities('Doubling Season', [
  staticAbility('If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.', [{ s: 'replace', replaces: { ev: 'createToken', player: 'you' }, body: { b: 'modify', count: { mul: 2 } } }]),
  staticAbility('If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.', [{ s: 'replace', replaces: { ev: 'counters', change: 'put', on: { controller: 'you' } }, body: { b: 'modify', count: { mul: 2 } } }]),
]);
const LEYLINE = withAbilities('Leyline of the Void', [
  staticAbility('If a card would be put into an opponent\'s graveyard from anywhere, exile it instead.', [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { isCard: true, owner: 'opponent' }, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } }]),
]);
const REST_IN_PEACE = withAbilities('Rest in Peace', [
  staticAbility('If a card or token would be put into a graveyard from anywhere, exile it instead.', [{ s: 'replace', replaces: { ev: 'zoneChange', subject: {}, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } }]),
]);

// M6-0 (m6 design 4.3): the three traces moved to test/m6/skeleton/absent-m6-1.test.ts, replaced by M6-1 with the full behavior in test/m6/replace/ (M6-1 turns them into the full scenarios)

describe('the funnels: milestone 3/4 call-sites go through the pipeline', () => {
  it('a creature spell resolving and a land played both enter through it (the replacement applies whatever the route)', () => {
    const enters = staticAbility('~ enters tapped.', [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', tapped: true } }]);
    const land = permanent('Test Tapland', 'Land', [enters]);
    const bear = permanent('Test Sleepy Bear', 'Creature — Bear', [enters], { cost: '{G}', pt: ['2', '2'] });
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Tapland', 'Test Sleepy Bear'], battlefield: ['Forest'] }, defs: [land, bear] });
    const played = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Tapland', 'hand') });
    expect(played.objects[find(played, 'Test Tapland', 'battlefield')]!.tapped).toBe(true);
    let s = act(played, { type: 'cast', player: 'p1', card: find(played, 'Test Sleepy Bear', 'hand') });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    expect(s.objects[find(s, 'Test Sleepy Bear', 'battlefield')]!.tapped).toBe(true);
  });
});
