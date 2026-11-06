/**
 * Concept round edh-next-104 (double-winlose, code edhn104): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from the Comprehensive Rules of 2026-09-25 as I remember them (no rules text in a
 * cloud session): unverified.
 *
 *   CR 601.2b, 608.2h, 107.1      "~ deals damage to any target equal to three times the number of creatures tapped this way." (Burn at the Stake)
 *   CR 614.1a, 120.3               "Double all damage ~ would deal." (Wolverine, Best There Is)
 *   CR 120.1, 603.4                "if ~ dealt damage to another creature this turn" (Wolverine, Best There Is)
 *   CR 106.4, 107.1, 508.1         "add twice that much {G}" (Fangorn, Tree Shepherd)
 *   CR 120.2b, 603.12, 701.9a      "When you discard one or more cards this way, ~ deals twice that much damage to target creature." (Borborygmos and Fblthp)
 *   CR 601.2b-c, 107.3             "Exile up to twice X target cards from graveyards." (Erebos's Intervention)
 */
import { describe, expect, it } from 'vitest';
import { activations, advanceTo, answer, card, cast, drive, find, full, lifeOf, named, obj, passBoth, resolveAll, scenario, act } from '../r4-cost/support';
import type { GameState } from '../../../src/index';
import { getChars } from '../../../src/index';

const P2 = { kind: 'player' as const, id: 'p2' as const };

// ---- Burn at the Stake ----------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2b, 608.2h: "three times the number of creatures tapped this way" counts what the additional tap cost tapped', () => {
  const PYRE = card('Test Pyre', 'Sorcery', 'As an additional cost to cast Test Pyre, tap any number of untapped creatures you control.\nTest Pyre deals damage to any target equal to three times the number of creatures tapped this way.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [PYRE, BEAR];
  const board = (): GameState => scenario([], { defs, p1: { hand: ['Test Pyre'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] } });
  it('is full', () => expect(full(PYRE)).toBe(true));
  it('tapping two of three creatures deals 6 damage', () => {
    const s0 = board();
    const bears = named(s0, 'Test Bear');
    const s = resolveAll(cast(s0, 'Test Pyre', { x: [2], objects: [[bears[0]!, bears[1]!]], targets: [[P2]] }));
    expect(lifeOf(s, 'p2')).toBe(14);
    expect(bears.filter((id) => s.objects[id]!.tapped).length).toBe(2);
  });
  it('negative: tapping none deals no damage', () => {
    const s = resolveAll(cast(board(), 'Test Pyre', { x: [0], objects: [[]], targets: [[P2]] }));
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: creatures tapped by an effect (not the cost) are not counted by the cost reading', () => {
    const BAD = card('Test Bad Pyre', 'Sorcery', 'Tap any number of untapped creatures you control.\nTest Bad Pyre deals damage to any target equal to three times the number of creatures tapped this way.');
    expect(full(BAD)).toBe(false);
  });
});

// ---- Wolverine, Best There Is ---------------------------------------------------------------------------------------------------------------------------
describe('CR 614.1a, 120.3, 120.1: "Double all damage ~ would deal." and "if ~ dealt damage to another creature this turn"', () => {
  const WOLF = card('Test Wolf', 'Legendary Creature — Mutant', 'Double all damage Test Wolf would deal.\nAt the beginning of each end step, if Test Wolf dealt damage to another creature this turn, put a +1/+1 counter on it.\n{0}: Test Wolf deals 1 damage to any target.', '{0}', ['3', '3']);
  const WALL = card('Test Wall', 'Creature — Wall', '', '{0}', ['0', '6']);
  const defs = [WOLF, WALL];
  const board = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Wolf'] }, p2: { battlefield: ['Test Wall'] } });
  const ping = (s0: GameState, target: ReturnType<typeof obj> | typeof P2): GameState => {
    const a = activations(s0, 'Test Wolf')[0]!;
    return resolveAll(drive(act(s0, a.action), { targets: [[target]] }));
  };
  const toEnd = (s: GameState): GameState => advanceTo(s, s.turn.number, 'end');
  const power = (s: GameState, id: string): number => Number(getChars(s, id)!.power);
  it('is full', () => expect(full(WOLF)).toBe(true));
  it('doubles the damage it deals: 1 damage becomes 2 (to a player)', () => {
    const s = ping(board(), P2);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('dealing damage to another creature puts a +1/+1 counter on it at the end step', () => {
    const s0 = board();
    const wall = named(s0, 'Test Wall')[0]!;
    const wolf = named(s0, 'Test Wolf')[0]!;
    const s = toEnd(ping(s0, obj(wall)));
    expect(s.objects[wall]!.damage).toBe(2);
    expect(power(resolveAll(s), wolf)).toBe(4);
  });
  it('negative: damage to a player only gives no counter', () => {
    const s0 = board();
    const wolf = named(s0, 'Test Wolf')[0]!;
    const s = resolveAll(toEnd(ping(s0, P2)));
    expect(power(s, wolf)).toBe(3);
  });
  it('negative: damage to itself is not damage to ANOTHER creature', () => {
    const s0 = board();
    const wolf = named(s0, 'Test Wolf')[0]!;
    const s = resolveAll(toEnd(ping(s0, obj(wolf))));
    expect(power(s, wolf)).toBe(3);
  });
});

// ---- Fangorn, Tree Shepherd -----------------------------------------------------------------------------------------------------------------------------
describe('CR 106.4, 107.1: "Whenever one or more Treefolk you control attack, add twice that much {G}."', () => {
  const FORT = card('Test Treewarden', 'Legendary Creature — Treefolk', 'Whenever one or more Treefolk you control attack, add twice that much {G}.', '{0}', ['2', '2']);
  const ENT = card('Test Ent', 'Creature — Treefolk', '', '{0}', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['1', '1']);
  const defs = [FORT, ENT, BEAR];
  it('is full', () => expect(full(FORT)).toBe(true));
  it('two attacking Treefolk and a Bear: the pool holds the mana of twice the Treefolk that attacked', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Treewarden', 'Test Ent', 'Test Bear'] } });
    const ids = ['Test Treewarden', 'Test Ent', 'Test Bear'].map((n) => named(s, n)[0]!);
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = passBoth(s);
    expect(s.pending?.kind).toBe('declareAttackers');
    s = drive(answer(s, { kind: 'declareAttackers', attacks: ids.map((attacker) => ({ attacker, defender: 'p2' as const })) }));
    s = resolveAll(s);
    const g = s.players.find((p) => p.id === 'p1')!.manaPool.filter((u) => u.type === 'G').length;
    expect(g).toBe(4);
  });
  it('negative: no Treefolk attacking adds nothing', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Treewarden', 'Test Ent', 'Test Bear'] } });
    const bear = named(s, 'Test Bear')[0]!;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = passBoth(s);
    s = resolveAll(drive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' as const }] })));
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.filter((u) => u.type === 'G').length).toBe(0);
  });
});

// ---- Borborygmos and Fblthp -----------------------------------------------------------------------------------------------------------------------------
describe('CR 120.2b, 603.12, 701.9a: "When you discard one or more cards this way, ~ deals twice that much damage to target creature."', () => {
  const BORB = card('Test Cyclops', 'Creature — Cyclops', 'When Test Cyclops enters, draw a card, then you may discard any number of land cards. When you discard one or more cards this way, Test Cyclops deals twice that much damage to target creature.', '{0}', ['3', '3']);
  const WALL = card('Test Wall', 'Creature — Wall', '', '{0}', ['0', '4']);
  const defs = [BORB, WALL];
  it('is full', () => expect(full(BORB)).toBe(true));
  it('discarding two lands deals 4 damage to the target creature (it dies)', () => {
    const s0 = scenario(['Forest', 'Forest', 'Forest'], { defs, p1: { hand: ['Test Cyclops', 'Forest', 'Forest'] }, p2: { battlefield: ['Test Wall'] } });
    const wall = named(s0, 'Test Wall')[0]!;
    const lands = s0.zones.hand.p1!.filter((id) => s0.objects[id]!.defId === 'Forest');
    const s = resolveAll(cast(s0, 'Test Cyclops', { yes: [true], objects: [lands], targets: [[obj(wall)]] }), { yes: [true], objects: [lands], targets: [[obj(wall)]] });
    expect(s.zones.battlefield.includes(wall)).toBe(false);
  });
  it('negative: discarding nothing deals no damage', () => {
    const s0 = scenario(['Forest', 'Forest', 'Forest'], { defs, p1: { hand: ['Test Cyclops', 'Forest'] }, p2: { battlefield: ['Test Wall'] } });
    const wall = named(s0, 'Test Wall')[0]!;
    const s = resolveAll(cast(s0, 'Test Cyclops', { yes: [true], objects: [[]], targets: [[obj(wall)]] }), { yes: [true], objects: [[]], targets: [[obj(wall)]] });
    expect(s.zones.battlefield.includes(wall)).toBe(true);
    expect(s.objects[wall]!.damage ?? 0).toBe(0);
  });
});

// ---- Erebos's Intervention -----------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2b-c, 107.3: "Exile up to twice X target cards from graveyards."', () => {
  const INT = card("Test Intervention", 'Instant', 'Choose one —\n• Target creature gets -X/-X until end of turn. You gain X life.\n• Exile up to twice X target cards from graveyards.', '{X}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [INT, BEAR];
  it('is full', () => expect(full(INT)).toBe(true));
  it('X = 1 exiles up to two cards: two are exiled, a third is not a legal choice', () => {
    const s0 = scenario(['Forest'], { defs, p1: { hand: ['Test Intervention'], battlefield: ['Forest', 'Forest'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    const gy = s0.zones.graveyard.p1!;
    expect(gy.length).toBe(3);
    const run = (picks: string[]): GameState => resolveAll(cast(s0, 'Test Intervention', { x: [1], options: [['1']], targets: [picks.map(obj)] }), { targets: [picks.map(obj)] });
    const two = run([gy[0]!, gy[1]!]);
    expect(two.zones.exile.length).toBe(2);
    expect(() => run([gy[0]!, gy[1]!, gy[2]!])).toThrow();
  });
});

void find;
