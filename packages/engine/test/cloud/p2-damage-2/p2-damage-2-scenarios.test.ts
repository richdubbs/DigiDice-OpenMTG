/**
 * p2-damage-2 (Phase 2 lane p2-damage): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 303.4, 702.5d       "the number of Curses attached to them": the Curses attached to that player, not those attached to another player
 *   CR 508.1a              "the number of creatures that player controls that didn't attack this turn": a creature that attacked this turn is not counted
 *   CR 121.1, 608.2h       "the number of cards they've drawn this turn": the draws of that player this turn, the spell's own draws included
 *   CR 118.12, 701.21a     "... deals damage equal to its mana value to its controller unless that player sacrifices it": the controller chooses; sacrificed, no damage
 *   CR 601.2c, 603.3d      "target creature an opponent controls chosen at random": nobody is asked; the game picks one legal target
 *   CR 701.14a, 608.2d     "Each of those tokens fights a different one of those creatures.": one token for each creature, each fighting a different one
 *   CR 701.14a, 701.14c    "Target creature you control fights that creature." after "Choose target creature an opponent controls.": the chosen creature, not itself
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, answer, find, life, put, scenario } from '../../m3/scenario';
import { attackWith, card, full, resolveAll, settle, tokens } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const onField = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
const damageOn = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;

const THIRST = card('Test Thirst', 'Sorcery', 'This spell deals damage to target player equal to the number of Curses attached to them.');
const HEX = card('Test Hex', 'Enchantment — Aura Curse', 'Enchant player');
const IDLERS = card('Test Idlers', 'Instant', "This spell deals damage to target player equal to the number of creatures that player controls that didn't attack this turn.");
const VORTEX = card('Test Vortex', 'Sorcery', "Target player draws two cards, then this spell deals damage to that player equal to the number of cards they've drawn this turn.");
const BANE = card('Test Bane', 'Sorcery', 'Target enchantment deals damage equal to its mana value to its controller unless that player sacrifices it.');
const IDOL = card('Test Idol', 'Enchantment', '', undefined, '{3}');
const BRUTE = card('Test Brute', 'Creature — Giant', 'When this creature enters, it fights target creature an opponent controls chosen at random.', ['4', '4']);
const PREDATION = card('Test Predation', 'Sorcery', 'For each creature your opponents control, create a 4/4 green Phyrexian Beast creature token. Each of those tokens fights a different one of those creatures.');
const FEED = card('Test Feed', 'Sorcery', 'Choose target creature an opponent controls. When that creature dies this turn, you gain 3 life. Target creature you control fights that creature.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const DEFS: CardDef[] = [THIRST, HEX, IDLERS, VORTEX, BANE, IDOL, BRUTE, PREDATION, FEED, BEAR, OGRE];

const cast = (s0: GameState, name: string, targets: TargetChoice[] = []): GameState => resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), { targets }), { targets });

describe('the synthetic cards are automated', () => {
  it('every synthetic card with rules text plays fully', () => {
    for (const d of [THIRST, IDLERS, VORTEX, BANE, BRUTE, PREDATION, FEED]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 303.4, 702.5d: "the number of Curses attached to them"', () => {
  it('two Curses attached to Bob and one to Alice: Bob is dealt 2', () => {
    let s = structuredClone(scenario([], { p1: { hand: ['Test Thirst'] }, defs: DEFS }));
    for (const who of ['p2', 'p2', 'p1']) s.objects[put(s, 'p1', 'battlefield', 'Test Hex')]!.attachedTo = who;
    s = cast(s, 'Test Thirst', [player('p2')]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 18]);
  });
  it('a Curse attached to no one (or to another player) is not counted: Bob with none is dealt nothing', () => {
    const s0 = structuredClone(scenario([], { p1: { hand: ['Test Thirst'] }, defs: DEFS }));
    s0.objects[put(s0, 'p1', 'battlefield', 'Test Hex')]!.attachedTo = 'p1';
    let s = s0;
    s = cast(s, 'Test Thirst', [player('p2')]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 20]);
  });
});

describe('CR 508.1a: "the number of creatures that player controls that didn\'t attack this turn"', () => {
  it('Alice attacked with her Ogre and kept her Bear home: she is dealt 1 (the Bear only)', () => {
    let s = scenario([], { p1: { hand: ['Test Idlers'], battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    s = structuredClone(s);
    for (const id of s.zones.battlefield) s.objects[id]!.controlledSinceTurn = 0;
    s = attackWith(s, [find(s, 'Test Ogre', 'battlefield', 'p1')]);
    s = cast(s, 'Test Idlers', [player('p1')]);
    expect(life(s, 'p1')).toBe(19);
  });
  it('with no attack this turn every creature counts: she is dealt 2', () => {
    let s = scenario([], { p1: { hand: ['Test Idlers'], battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    s = cast(s, 'Test Idlers', [player('p1')]);
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('CR 121.1, 608.2h: "the number of cards they\'ve drawn this turn"', () => {
  it('Bob draws two cards: he is dealt 2, Alice nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Vortex'] }, p2: { library: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs: DEFS });
    s = cast(s, 'Test Vortex', [player('p2')]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 18]);
  });
  it('only that player\'s own draws: Alice\'s earlier draws this turn are not counted', () => {
    let s = scenario([], { p1: { hand: ['Test Vortex', 'Test Vortex'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: { library: ['Test Bear', 'Test Bear'] }, defs: DEFS });
    s = cast(s, 'Test Vortex', [player('p1')]);
    expect(life(s, 'p1')).toBe(18);
    s = cast(s, 'Test Vortex', [player('p2')]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([18, 18]);
  });
});

describe('CR 118.12, 701.21a: "... to its controller unless that player sacrifices it"', () => {
  const bane = (yes: boolean): GameState => {
    let s = scenario([], { p1: { hand: ['Test Bane'] }, p2: { battlefield: ['Test Idol'] }, defs: DEFS });
    const idol = find(s, 'Test Idol', 'battlefield', 'p2');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bane', 'hand', 'p1') }), { targets: [obj(idol)], yes }), { targets: [obj(idol)], yes });
    return s;
  };
  it('Bob sacrifices the Idol: it is gone and he is dealt nothing', () => {
    const s = bane(true);
    expect(onField(s, 'Test Idol')).toBe(false);
    expect(life(s, 'p2')).toBe(20);
  });
  it('Bob keeps it: the Idol deals 3 (its mana value) to him', () => {
    const s = bane(false);
    expect(onField(s, 'Test Idol')).toBe(true);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 17]);
  });
});

describe('CR 601.2c, 603.3d: "target creature an opponent controls chosen at random"', () => {
  it('nobody chooses: the Brute fights exactly one of Bob\'s two creatures, picked by the game', () => {
    let s = scenario([], { p1: { hand: ['Test Brute'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Brute', 'hand', 'p1') }));
    for (let guard = 0; s.zones.stack.length > 0 && guard < 10; guard++) {
      expect(s.pending?.kind).not.toBe('chooseTargets');
      s = settle(act(s, { type: 'pass', player: s.pending!.player }));
    }
    const brute = find(s, 'Test Brute', 'battlefield', 'p1');
    const left = [onField(s, 'Test Bear'), onField(s, 'Test Ogre')];
    expect(left.filter((x) => x).length).toBe(1); // one of them fought the 4/4 and died
    expect([2, 3]).toContain(damageOn(s, brute));
  });
  it('with no creature an opponent controls the ability has no target and does nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Brute'], battlefield: ['Test Bear'] }, defs: DEFS });
    s = cast(s, 'Test Brute');
    expect(damageOn(s, find(s, 'Test Brute', 'battlefield', 'p1'))).toBe(0);
    expect(onField(s, 'Test Bear')).toBe(true);
  });
});

describe('CR 701.14a, 608.2d: "Each of those tokens fights a different one of those creatures."', () => {
  it('Bob has a 2/2 and a 3/3: two 4/4 tokens, each fights a different one; both of Bob\'s creatures die', () => {
    let s = scenario([], { p1: { hand: ['Test Predation'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    s = cast(s, 'Test Predation');
    const made = tokens(s, 'p1');
    expect(made.length).toBe(2);
    expect(made.map((id) => damageOn(s, id)).sort()).toEqual([2, 3]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2')).toEqual([]);
    expect(onField(s, 'Test Bear')).toBe(true); // Alice's own Bear was not counted and fought nothing
  });
  it('with no creature an opponent controls: no token, no fight', () => {
    let s = scenario([], { p1: { hand: ['Test Predation'], battlefield: ['Test Bear'] }, defs: DEFS });
    s = cast(s, 'Test Predation');
    expect(tokens(s, 'p1')).toEqual([]);
  });
});

describe('CR 701.14a, 701.14c: "Target creature you control fights that creature." (the chosen creature, not itself)', () => {
  const feed = (mine: string): GameState => {
    let s = scenario([], { p1: { hand: ['Test Feed'], battlefield: [mine] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    const own = find(s, mine, 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Feed', 'hand', 'p1') });
    const picks = [obj(theirs), obj(own)];
    for (let guard = 0; s.pending?.kind === 'chooseTargets' && guard < 3; guard++) s = answer(s, { kind: 'chooseTargets', targets: [picks.shift()!] });
    return resolveAll(s);
  };
  it('Alice\'s Ogre fights Bob\'s Bear: the Bear dies and she gains 3', () => {
    const s = feed('Test Ogre');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2')).toEqual([]);
    expect(life(s, 'p1')).toBe(23);
    expect(damageOn(s, find(s, 'Test Ogre', 'battlefield', 'p1'))).toBe(2);
  });
  it('Alice\'s Bear trades with Bob\'s Bear: she still gains 3 (the chosen creature died this turn)', () => {
    const s = feed('Test Bear');
    expect(s.zones.battlefield.length).toBe(0);
    expect(life(s, 'p1')).toBe(23);
  });
});
