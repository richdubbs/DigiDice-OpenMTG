/**
 * Top-rank round edh-next-93 (code edhn93, second pass 1): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from the 2026-09-25 text unless marked unverified.
 *
 *   CR 205.2a, 205.4a, 608.2d, 701.20a   "Look at the top X cards of your library. You may put any number of land and/or legendary permanent cards with mana value X or less from among them onto the battlefield. Put the rest into your graveyard." (Kamahl's Druidic Vow)
 *   CR 728.1, 119.3, 614.1a              "You gain life rather than lose life from radiation." (Strong, the Brutish Thespian)
 *   CR 115.1, 601.2c, 608.2f, 707.2      "For each opponent, you create a token that's a copy of up to one target creature that player controls." (Elminster's Simulacrum)
 *   CR 115.9b, 614.15, 701.6a            "Counter target spell. If that spell targets a commander you control, instead counter that spell, scry 2, then draw a card." (Bane's Contingency)
 *   CR 120.10, 603.2, 701.47a            "Whenever a creature an opponent controls is dealt excess noncombat damage, amass Orcs X, where X is that excess damage." (Fall of Cair Andros)
 *   CR 120.10, 120.4a, 608.2c            "Whenever this creature attacks, it deals damage equal to its power to up to one other target creature. Excess damage is dealt to that creature's controller instead." (Ravenous Tyrannosaurus)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { advanceTo, answer, card, cast, drive, find, full, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';
import { declareAttackers, lifeOf, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { resolveAll as resolveAllMp } from '../../m5/cr-examples/helpers';
import { castWith, synthetic } from '../../m6/costs/support';
import { mpScenario } from '../../m12/rules/helpers';
import type { DecisionAnswer } from '../../../src/index';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
const bf = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const idIn = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId, name: string): ObjectId => s.zones[zone][p]!.find((id) => nameOf(s, id) === name)!;
const offered = (s: GameState): string[] => {
  const p = s.pending as unknown as { kind: string; options: ObjectId[] };
  expect(p.kind).toBe('chooseObjects');
  return p.options.map((id) => nameOf(s, id)).sort();
};

describe('CR 205.4a, 202.3, 608.2d: "land and/or legendary permanent cards with mana value X or less" (Kamahl\'s Druidic Vow)', () => {
  const VOW = card('Test Vow', 'Legendary Sorcery', 'Look at the top X cards of your library. You may put any number of land and/or legendary permanent cards with mana value X or less from among them onto the battlefield. Put the rest into your graveyard.', '{X}');
  const FIELD = card('Test Field', 'Land', '');
  const KING = card('Test King', 'Legendary Creature — Elf', '', '{1}', ['1', '1']);
  const GIANT = card('Test Giant King', 'Legendary Creature — Giant', '', '{5}', ['5', '5']);
  const SAGE = card('Test Sage Sorcery', 'Legendary Sorcery', '', '{1}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const BIGLAND = card('Test Big Field', 'Land', '', '{4}');
  const LORD = card('Test Lord', 'Legendary Creature — Elf', '', '{1}', ['1', '1']);
  const defs = [VOW, FIELD, KING, GIANT, SAGE, BEAR, BIGLAND, LORD];
  const start = (x: number) => scenario([], { defs, p1: { hand: ['Test Vow'], battlefield: ['Test Lord', ...Array.from({ length: x }, () => 'Plains')], library: ['Test Field', 'Test Bear', 'Test King', 'Test Giant King', 'Test Sage Sorcery', 'Test Field'] }, p2: {} });
  it('is full', () => expect(full(VOW), JSON.stringify(VOW.automation)).toBe(true));
  it('X = 5: lands and legendary permanent cards among the top five with mana value 5 or less are offered; the legendary sorcery and the plain creature are not; the rest go to the graveyard', () => {
    let s = cast(start(5), 'Test Vow', { x: [5] });
    s = answer(passBoth(s), { kind: 'yesNo', yes: true });
    expect(offered(s)).toEqual(['Test Field', 'Test Giant King', 'Test King']);
    const pick = ['Test Field', 'Test King'].map((n) => idIn(s, 'library', 'p1', n));
    s = drive(s, { objects: [pick] });
    expect(bf(s, 'p1').filter((n) => n !== 'Plains' && n !== 'Test Lord')).toEqual(['Test Field', 'Test King']);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Giant King', 'Test Sage Sorcery', 'Test Vow']);
    expect(names(s, 'library', 'p1')[0]).toBe('Test Field'); // the sixth card was never looked at
  });
  it('negative: X = 3 offers neither the Giant (mana value 5) nor the sixth card; "any number" allows none', () => {
    let s = cast(start(3), 'Test Vow', { x: [3] });
    s = answer(passBoth(s), { kind: 'yesNo', yes: true });
    expect(offered(s)).toEqual(['Test Field', 'Test King']);
    s = drive(s, { objects: [[]] });
    expect(bf(s, 'p1').filter((n) => n !== 'Plains' && n !== 'Test Lord')).toEqual([]);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Field', 'Test King', 'Test Vow']);
  });
  it('negative: declining the "may" puts nothing onto the battlefield; all five cards go to the graveyard', () => {
    let s = cast(start(5), 'Test Vow', { x: [5] });
    s = drive(passBoth(s), { yes: [false] });
    expect(bf(s, 'p1').filter((n) => n !== 'Plains' && n !== 'Test Lord')).toEqual([]);
    expect(names(s, 'graveyard', 'p1')).toHaveLength(6);
  });
  it('negative: the mana value limit holds for the land half too (a land with mana value 4 is not offered at X = 3)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Vow'], battlefield: ['Test Lord', 'Plains', 'Plains', 'Plains'], library: ['Test Big Field', 'Test King', 'Test Bear'] }, p2: {} });
    let s = cast(s0, 'Test Vow', { x: [3] });
    s = answer(passBoth(s), { kind: 'yesNo', yes: true });
    expect(offered(s)).toEqual(['Test King']);
  });
});

describe('CR 120.10, 120.4a, 608.2c: "it deals damage equal to its power to up to one other target creature. Excess damage is dealt to that creature\'s controller instead." (Ravenous Tyrannosaurus)', () => {
  const REX = card('Test Rex', 'Creature — Dinosaur', 'Whenever this creature attacks, it deals damage equal to its power to up to one other target creature. Excess damage is dealt to that creature\'s controller instead.', '{1}', ['5', '5']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const WALL = card('Test Wall', 'Creature — Wall', '', '{1}', ['0', '6']);
  const defs = [REX, BEAR, WALL];
  const attack = (s0: GameState, rex: ObjectId, target: ObjectId | null): GameState => {
    const s = declareAttackers(toDeclareAttackers(s0), [[rex]]);
    const t = drive(s, { targets: target === null ? [[]] : [[obj(target)]] });
    return resolveAll(passUntil(t, (x) => x.zones.stack.length > 0 || x.pending?.kind === 'declareBlockers', 'the attack trigger'));
  };
  it('is full', () => expect(full(REX), JSON.stringify(REX.automation)).toBe(true));
  it('5 damage to a 2/2: it dies and its controller takes the 3 excess damage', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rex'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = attack(s0, find(s0, 'Test Rex', 'battlefield', 'p1'), bear);
    expect(s.zones.battlefield.includes(bear)).toBe(false);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('negative: damage not beyond lethal is all dealt to the creature (5 to a 0/6: it survives, the controller loses nothing)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rex'] }, p2: { battlefield: ['Test Wall'] } });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    const s = attack(s0, find(s0, 'Test Rex', 'battlefield', 'p1'), wall);
    expect(s.zones.battlefield.includes(wall)).toBe(true);
    expect(s.objects[wall]!.damage).toBe(5);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: "other" - the Dinosaur itself is no legal target', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rex'] }, p2: { battlefield: ['Test Bear'] } });
    const rex = find(s0, 'Test Rex', 'battlefield', 'p1');
    const s = declareAttackers(toDeclareAttackers(s0), [[rex]]);
    const p = s.pending as unknown as { kind: string; options?: unknown };
    expect(JSON.stringify(p)).not.toContain(rex);
  });
  it('negative: "up to one" - with no target nobody takes damage', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rex'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = attack(s0, find(s0, 'Test Rex', 'battlefield', 'p1'), null);
    expect(s.zones.battlefield.includes(bear)).toBe(true);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 728.1, 119.3, 614.1a: "You gain life rather than lose life from radiation." (Strong, the Brutish Thespian)', () => {
  const STRONG = card('Test Strong', 'Legendary Creature — Human', 'You gain life rather than lose life from radiation.', '{1}', ['2', '2']);
  const SPELL = card('Test Rad Spell', 'Sorcery', '');
  const defs = [STRONG, SPELL];
  const radGame = (n: number, strongOwner: 'p1' | 'p2' | null): GameState => {
    const s = scenario(['Plains'], { defs, p1: { library: ['Test Rad Spell', 'Test Rad Spell'], ...(strongOwner === 'p1' ? { battlefield: ['Test Strong'] } : {}) }, ...(strongOwner === 'p2' ? { p2: { battlefield: ['Test Strong'] } } : {}) });
    const lib = s.zones.library['p1']!;
    const named = lib.filter((id) => s.objects[id]!.defId !== 'Plains');
    s.zones.library['p1'] = [lib.find((id) => !named.includes(id))!, ...named, ...lib.filter((id) => !named.includes(id)).slice(1)];
    s.players.find((p) => p.id === 'p1')!.counters['rad'] = n;
    return s;
  };
  const toMain = (s: GameState): GameState => resolveAll(advanceTo(s, 3, 'main1'));
  const rad = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.counters['rad'] ?? 0;
  it('is full', () => expect(full(STRONG), JSON.stringify(STRONG.automation)).toBe(true));
  it('with Strong: each nonland card milled by the rad trigger gains 1 life instead of costing 1, and the rad counters are still removed', () => {
    const s0 = radGame(3, 'p1');
    const l0 = lifeOf(s0, 'p1');
    const s = toMain(s0);
    expect(lifeOf(s, 'p1')).toBe(l0 + 2);
    expect(rad(s)).toBe(1);
  });
  it('negative: without Strong the same trigger costs 1 life per nonland card', () => {
    const s0 = radGame(3, null);
    const l0 = lifeOf(s0, 'p1');
    const s = toMain(s0);
    expect(lifeOf(s, 'p1')).toBe(l0 - 2);
    expect(rad(s)).toBe(1);
  });
  it('negative: a Strong an opponent controls does not change my life loss from radiation', () => {
    const s0 = radGame(3, 'p2');
    const l0 = lifeOf(s0, 'p1');
    expect(lifeOf(toMain(s0), 'p1')).toBe(l0 - 2);
  });
});

describe('CR 115.1, 601.2c, 608.2f, 707.2: "For each opponent, you create a token that\'s a copy of up to one target creature that player controls." (Elminster\'s Simulacrum)', () => {
  const MIRROR = synthetic('Test Mirror Image', 'Sorcery', '{1}', "For each opponent, you create a token that's a copy of up to one target creature that player controls.");
  const BEAR = synthetic('Test Mirror Bear', 'Creature — Bear', '{1}', '', { power: '2', toughness: '2' });
  const OGRE = synthetic('Test Mirror Ogre', 'Creature — Ogre', '{1}', '', { power: '3', toughness: '3' });
  const MINE = synthetic('Test Mirror Mine', 'Creature — Elf', '{1}', '', { power: '1', toughness: '1' });
  const board = (): GameState => mpScenario({ players: 3, defs: [MIRROR, BEAR, OGRE, MINE], cards: ['Plains'], zones: { p1: { hand: ['Test Mirror Image'], battlefield: ['Plains', 'Test Mirror Mine'] }, p2: { battlefield: ['Test Mirror Bear'] }, p3: { battlefield: ['Test Mirror Ogre'] } } });
  const targetsOf = (...ids: string[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) });
  const idOf = (s: GameState, name: string, controller: PlayerId): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name && s.objects[id]!.controller === controller)!;
  const count = (s: GameState, name: string, controller: PlayerId): number => s.zones.battlefield.filter((id) => nameOf(s, id) === name && s.objects[id]!.controller === controller).length;
  it('is full, with one target spec for the opponents', () => {
    expect(full(MIRROR), JSON.stringify(MIRROR.automation)).toBe(true);
    const t = (MIRROR.faces[0]!.abilities[0] as unknown as { effect: { targets: { perOpponent?: boolean; min: number; max: number }[] } }).effect.targets;
    expect([t.length, t[0]!.perOpponent, t[0]!.min, t[0]!.max]).toEqual([1, true, 0, 1]);
  });
  it('one token copy for each opponent\'s creature chosen, under my control; the originals stay where they are', () => {
    const s0 = board();
    let s = castWith(s0, 'Test Mirror Image', [targetsOf(idOf(s0, 'Test Mirror Bear', 'p2'), idOf(s0, 'Test Mirror Ogre', 'p3'))]);
    s = resolveAllMp(s);
    expect(count(s, 'Test Mirror Bear', 'p1')).toBe(1);
    expect(count(s, 'Test Mirror Ogre', 'p1')).toBe(1);
    expect(count(s, 'Test Mirror Bear', 'p2')).toBe(1);
    expect(count(s, 'Test Mirror Ogre', 'p3')).toBe(1);
    expect(s.objects[idOf(s, 'Test Mirror Bear', 'p1')]!.kind).toBe('token');
  });
  it('negative: "up to one" for each opponent - a single target copies only that creature', () => {
    const s0 = board();
    let s = castWith(s0, 'Test Mirror Image', [targetsOf(idOf(s0, 'Test Mirror Ogre', 'p3'))]);
    s = resolveAllMp(s);
    expect(count(s, 'Test Mirror Ogre', 'p1')).toBe(1);
    expect(count(s, 'Test Mirror Bear', 'p1')).toBe(0);
  });
  it('negative: my own creature is no legal target (it is not one an opponent controls)', () => {
    const s0 = board();
    expect(() => castWith(s0, 'Test Mirror Image', [targetsOf(idOf(s0, 'Test Mirror Mine', 'p1'))])).toThrow();
  });
});

describe('CR 115.9b, 614.15, 701.6a: "Counter target spell. If that spell targets a creature you control, instead counter that spell, scry 1, then draw a card." (Bane\'s Contingency, with a creature for the commander)', () => {
  const DENIAL = card('Test Denial', 'Instant', 'Counter target spell. If that spell targets a creature you control, instead counter that spell, scry 1, then draw a card.');
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['3', '3']);
  const defs = [DENIAL, ZAP, BEAR];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Denial', 'Test Zap'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  const run = (target: 'mine' | 'theirs'): { s: GameState; hand0: number } => {
    const s0 = board();
    const bear = find(s0, 'Test Bear', 'battlefield', target === 'mine' ? 'p1' : 'p2');
    let s = cast(s0, 'Test Zap', { targets: [[obj(bear)]] });
    const zap = s.zones.stack[s.zones.stack.length - 1]!;
    const hand0 = s.zones.hand.p1!.length - 1; // the hand after the Denial leaves it
    s = cast(s, 'Test Denial', { targets: [[obj(zap)]] });
    return { s: resolveAll(s), hand0 };
  };
  it('is full', () => expect(full(DENIAL), JSON.stringify(DENIAL.automation)).toBe(true));
  it('the countered spell targeted a creature I control: countered, and I draw a card', () => {
    const { s, hand0 } = run('mine');
    expect(names(s, 'graveyard', 'p1')).toContain('Test Zap');
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.damage).toBe(0);
    expect(s.zones.hand.p1!.length).toBe(hand0 + 1);
  });
  it('negative: the spell targeted a creature an opponent controls: still countered, but no card is drawn', () => {
    const { s, hand0 } = run('theirs');
    expect(names(s, 'graveyard', 'p1')).toContain('Test Zap');
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.damage).toBe(0);
    expect(s.zones.hand.p1!.length).toBe(hand0);
  });
});

describe('CR 120.10, 603.2, 701.47a: "Whenever a creature an opponent controls is dealt excess noncombat damage, amass Orcs X, where X is that excess damage." (Fall of Cair Andros)', () => {
  const FALL = card('Test Fall', 'Enchantment', 'Whenever a creature an opponent controls is dealt excess noncombat damage, amass Orcs X, where X is that excess damage.', '{1}');
  const BOLT = card('Test Fall Bolt', 'Instant', 'Test Fall Bolt deals 5 damage to target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [FALL, BOLT, BEAR];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Fall Bolt'], battlefield: ['Test Fall', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  const armyCounters = (s: GameState): number[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => s.objects[id]!.counters['+1/+1'] ?? 0);
  it('is full', () => expect(full(FALL), JSON.stringify(FALL.automation)).toBe(true));
  it('5 damage to an opponent\'s 2/2: the excess is 3, so the Army gets three +1/+1 counters', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Fall Bolt', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] }));
    expect(armyCounters(s)).toEqual([3]);
  });
  it('negative: exactly lethal damage is no excess damage (a 5-toughness creature dealt 5): no Army', () => {
    const WALL = card('Test Fall Wall', 'Creature — Wall', '', '{0}', ['0', '5']);
    const s0 = scenario([], { defs: [...defs, WALL], p1: { hand: ['Test Fall Bolt'], battlefield: ['Test Fall'] }, p2: { battlefield: ['Test Fall Wall'] } });
    const s = resolveAll(cast(s0, 'Test Fall Bolt', { targets: [[obj(find(s0, 'Test Fall Wall', 'battlefield', 'p2'))]] }));
    expect(armyCounters(s)).toEqual([]);
  });
  it('negative: my own creature dealt excess damage does not trigger it', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Fall Bolt', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]] }));
    expect(armyCounters(s)).toEqual([]);
  });
});
