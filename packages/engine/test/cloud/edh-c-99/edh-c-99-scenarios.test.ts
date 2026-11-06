/**
 * Commander EDHREC ranks 29,501-30,000, round edh-c-99 (fourth pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 702.33d, 614.1c, 609.4     "If ~ was kicked, it enters with a +1/+1 counter on it and with "~ can attack as though it didn't have defender.""
 *   CR 509.1b, 506.2              "Each creature you control can't be blocked as long as defending player controls an artifact land."
 *   CR 205.1a, 611.2a, 613.1d     "Whenever you play a land, if ~ is a creature, it becomes an enchantment."
 *   CR 702.33d, 115.1, 120.3      "Return target creature to its owner's hand. If ~ was kicked, it deals 2 damage to another target creature."
 *   CR 701.21a, 608.2c            "... that player may sacrifice a creature of their choice. If that player doesn't, they lose 5 life and you sacrifice ~."
 *   CR 701.20e, 404.1             "Look at the top two cards of target player's library. Put one of them into their graveyard."
 *   CR 701.8a, 701.19c            "If you don't, destroy target Knight and it can't be regenerated."
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import type { GameState, ObjectId } from '../../../src/index';
import { act, advanceTo, answer, card, cast, drive, find, full, lifeOf, named, obj, resolveAll, scenario } from '../r4-cost/support';
import { pass } from '../../m3/scenario';

const types = (s: GameState, id: ObjectId): string[] => [...(getChars(s, id)!.types as string[])].sort();
const subtypes = (s: GameState, id: ObjectId): string[] => [...(getChars(s, id)!.subtypes as string[])].sort();
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hasDefenderRule = (s: GameState, id: ObjectId): boolean => (getChars(s, id)!.keywords as unknown[]).some((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword) === 'defender');

/** Pass priority until p1 declares attackers; the candidates (ids) that may attack. */
function attackCandidates(s0: GameState): ObjectId[] {
  let s = s0;
  for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
  if (s.pending?.kind !== 'declareAttackers') return [];
  return s.pending.candidates.map((c) => c.id);
}

describe('CR 702.33d, 614.1c, 609.4: "If ~ was kicked, it enters with a +1/+1 counter on it and with "~ can attack as though it didn\'t have defender.""', () => {
  const WALL = card('Test Gate Wall', 'Creature — Wall', 'Defender\nKicker {0}\nIf this creature was kicked, it enters with a +1/+1 counter on it and with "This creature can attack as though it didn\'t have defender."', '{0}', ['0', '3']);
  const game = () => scenario([], { defs: [WALL], p1: { hand: ['Test Gate Wall'] } });
  it('is full', () => expect(full(WALL)).toBe(true));
  it('kicked: a 1/4 that is offered as an attacker although it has defender', () => {
    const s = resolveAll(drive(cast(game(), 'Test Gate Wall', { yes: [true] }), { yes: [true] }), { yes: [true] });
    const id = named(s, 'Test Gate Wall')[0]!;
    expect(pt(s, id)).toBe('1/4');
    expect(hasDefenderRule(s, id)).toBe(true);
    const moved = structuredClone(s);
    moved.objects[id]!.controlledSinceTurn = 0;
    expect(attackCandidates(moved)).toContain(id);
  });
  it('negative: the permission is the kicked wall\'s own: another creature with defender that you control still cannot attack', () => {
    const OTHER = card('Test Other Wall', 'Creature — Wall', 'Defender', '{0}', ['0', '3']);
    const s0 = scenario([], { defs: [WALL, OTHER], p1: { hand: ['Test Gate Wall'], battlefield: ['Test Other Wall'] } });
    const s = resolveAll(drive(cast(s0, 'Test Gate Wall', { yes: [true] }), { yes: [true] }), { yes: [true] });
    const mine = named(s, 'Test Gate Wall')[0]!;
    const other = named(s, 'Test Other Wall')[0]!;
    const moved = structuredClone(s);
    moved.objects[mine]!.controlledSinceTurn = 0;
    const c = attackCandidates(moved);
    expect(c).toContain(mine);
    expect(c).not.toContain(other);
  });
  it('negative: not kicked, a 0/3 that cannot attack', () => {
    const s = resolveAll(cast(game(), 'Test Gate Wall', { yes: [false] }), { yes: [false] });
    const id = named(s, 'Test Gate Wall')[0]!;
    expect(pt(s, id)).toBe('0/3');
    const moved = structuredClone(s);
    moved.objects[id]!.controlledSinceTurn = 0;
    expect(attackCandidates(moved)).not.toContain(id);
  });
});

describe('CR 509.1b, 506.2: "Each creature you control can\'t be blocked as long as defending player controls an artifact land."', () => {
  const WALKER = card('Test Land Walker', 'Creature — Dryad', "Each creature you control can't be blocked as long as defending player controls an artifact land.", '{0}', ['2', '2']);
  const RAIDER = card('Test Raider', 'Creature — Goblin', '', '{0}', ['2', '2']);
  const BLOCKER = card('Test Guard', 'Creature — Soldier', '', '{0}', ['2', '2']);
  const FORGE = card('Test Forge Land', 'Artifact Land', '');
  const PLAIN = card('Test Plain Land', 'Land', '');
  const board = (land: string | null) => scenario([], { defs: [WALKER, RAIDER, BLOCKER, FORGE, PLAIN], p1: { battlefield: ['Test Land Walker', 'Test Raider'] }, p2: { battlefield: land === null ? ['Test Guard'] : ['Test Guard', land] } });
  const blockers = (s0: GameState): ObjectId[] => {
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    const atk = s.pending!.kind === 'declareAttackers' ? s.pending.candidates.map((c) => c.id) : [];
    s = answer(s, { kind: 'declareAttackers', attacks: atk.map((attacker) => ({ attacker, defender: 'p2' as const })) });
    for (let i = 0; i < 10 && s.pending?.kind !== 'declareBlockers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    return s.pending?.kind === 'declareBlockers' ? s.pending.candidates.filter((c) => c.attackers.length > 0).map((c) => c.id) : [];
  };
  it('is full', () => expect(full(WALKER)).toBe(true));
  it('the defending player controls an artifact land: no creature of ours can be blocked', () => {
    expect(blockers(board('Test Forge Land'))).toEqual([]);
  });
  it('negative: a plain land (or no land) leaves the creatures blockable', () => {
    expect(blockers(board('Test Plain Land')).length).toBeGreaterThan(0);
    expect(blockers(board(null)).length).toBeGreaterThan(0);
  });
});

describe('CR 205.1a, 611.2a, 613.1d: "Whenever you play a land, if ~ is a creature, it becomes an enchantment."', () => {
  const STAG = card('Test Shifting Stag', 'Enchantment', 'Whenever an opponent plays a land, if ~ is an enchantment, it becomes a 3/2 Elk Beast creature.\nWhenever you play a land, if ~ is a creature, it becomes an enchantment.', '{0}');
  const LAND = card('Test Spare Land', 'Land', '');
  it('is full', () => expect(full(STAG)).toBe(true));
  it('an opponent playing a land makes it a 3/2 Elk Beast creature (no longer an enchantment); then its controller playing a land makes it an enchantment again, with no creature types', () => {
    const s0 = scenario([], { defs: [STAG, LAND], p1: { battlefield: ['Test Shifting Stag'], hand: ['Test Spare Land'] }, p2: { hand: ['Plains'] } });
    const id = named(s0, 'Test Shifting Stag')[0]!;
    expect(types(s0, id)).toEqual(['Enchantment']);
    const s1 = advanceTo(s0, 2, 'main1');
    const s2 = resolveAll(act(s1, { type: 'playLand', player: 'p2', card: find(s1, 'Plains', 'hand', 'p2') } as never));
    expect(types(s2, id)).toEqual(['Creature']);
    expect(pt(s2, id)).toBe('3/2');
    expect(subtypes(s2, id)).toEqual(['Beast', 'Elk']);
    const s3 = advanceTo(s2, 3, 'main1');
    const s4 = resolveAll(act(s3, { type: 'playLand', player: 'p1', card: find(s3, 'Test Spare Land', 'hand', 'p1') } as never));
    expect(types(s4, id)).toEqual(['Enchantment']);
    expect(subtypes(s4, id)).toEqual([]);
  });
  it('negative: while it is an enchantment, the controller playing a land changes nothing (intervening if, CR 603.4)', () => {
    const s0 = scenario([], { defs: [STAG, LAND], p1: { battlefield: ['Test Shifting Stag'], hand: ['Test Spare Land'] } });
    const id = named(s0, 'Test Shifting Stag')[0]!;
    const s = resolveAll(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Spare Land', 'hand', 'p1') } as never));
    expect(types(s, id)).toEqual(['Enchantment']);
    expect(subtypes(s, id)).toEqual([]);
  });
});

describe('CR 702.33d, 115.1, 120.3: "Return target creature to its owner\'s hand. If ~ was kicked, it deals 2 damage to another target creature."', () => {
  const JILT = card('Test Jolt', 'Instant', "Kicker {0}\nReturn target creature to its owner's hand. If this spell was kicked, it deals 2 damage to another target creature.", '{0}');
  const A = card('Test Ox', 'Creature — Ox', '', '{0}', ['2', '5']);
  const B = card('Test Hare', 'Creature — Rabbit', '', '{0}', ['1', '2']);
  const game = () => scenario([], { defs: [JILT, A, B], p1: { hand: ['Test Jolt'] }, p2: { battlefield: ['Test Ox', 'Test Hare'] } });
  it('is full', () => expect(full(JILT)).toBe(true));
  it('kicked: the Ox goes back to hand and the SPELL deals the damage to the Hare (it dies), not the returned creature', () => {
    const s0 = game();
    const ox = named(s0, 'Test Ox')[0]!;
    const hare = named(s0, 'Test Hare')[0]!;
    const s = resolveAll(cast(s0, 'Test Jolt', { yes: [true], targets: [[obj(ox)], [obj(hare)]] }));
    expect(named(s, 'Test Ox')).toEqual([]);
    expect(s.zones.hand['p2']!.some((id) => s.objects[id]!.defId === 'Test Ox')).toBe(true);
    expect(named(s, 'Test Hare')).toEqual([]);
  });
  it('negative: not kicked, only one target is asked for and the Hare is untouched', () => {
    const s0 = game();
    const ox = named(s0, 'Test Ox')[0]!;
    const s = resolveAll(cast(s0, 'Test Jolt', { yes: [false], targets: [[obj(ox)]] }));
    expect(named(s, 'Test Ox')).toEqual([]);
    expect(named(s, 'Test Hare').length).toBe(1);
    expect(s.objects[named(s, 'Test Hare')[0]!]!.damage ?? 0).toBe(0);
  });
});

describe('CR 701.21a, 608.2c: "that player may sacrifice a creature of their choice. If that player doesn\'t, they lose 5 life and you sacrifice ~."', () => {
  const TOMB = card('Test Tomb', 'Enchantment', "At the beginning of each player's upkeep, that player may sacrifice a creature of their choice. If that player doesn't, they lose 5 life and you sacrifice this enchantment.", '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const game = (bf2: string[]) => scenario([], { defs: [TOMB, BEAR], p1: { battlefield: ['Test Tomb'] }, p2: { battlefield: bf2 } });
  const toP2Upkeep = (s: GameState, yes: boolean): GameState => {
    const t = advanceTo(s, 2, 'upkeep');
    return resolveAll(t, { yes: [yes] });
  };
  it('is full', () => expect(full(TOMB)).toBe(true));
  it('the player declines: they lose 5 life and the Tomb is sacrificed', () => {
    const s = toP2Upkeep(game(['Test Bear']), false);
    expect(lifeOf(s, 'p2')).toBe(15);
    expect(named(s, 'Test Tomb')).toEqual([]);
    expect(named(s, 'Test Bear').length).toBe(1);
  });
  it('the player sacrifices: no life lost and the Tomb stays', () => {
    const s = toP2Upkeep(game(['Test Bear']), true);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(named(s, 'Test Tomb').length).toBe(1);
    expect(named(s, 'Test Bear')).toEqual([]);
  });
  it('negative: a player with no creature cannot sacrifice, so they lose 5 life and the Tomb is sacrificed', () => {
    const s = toP2Upkeep(game([]), true);
    expect(lifeOf(s, 'p2')).toBe(15);
    expect(named(s, 'Test Tomb')).toEqual([]);
  });
});

describe('CR 701.20e, 404.1: "Look at the top two cards of target player\'s library. Put one of them into their graveyard."', () => {
  const SPY = card('Test Peeker', 'Creature — Human Rogue', "When this creature enters, look at the top two cards of target player's library. Put one of them into their graveyard.", '{0}', ['1', '1']);
  const A = card('Test Top A', 'Sorcery', '');
  const B = card('Test Top B', 'Sorcery', '');
  const game = () => scenario([], { defs: [SPY, A, B], p1: { hand: ['Test Peeker'] }, p2: { library: ['Test Top A', 'Test Top B'] } });
  it('is full', () => expect(full(SPY)).toBe(true));
  it('exactly one of the two top cards of the target player goes to THEIR graveyard and the other stays on top', () => {
    const s = resolveAll(cast(game(), 'Test Peeker'), { targets: [[{ kind: 'player', id: 'p2' }]] });
    const gy = s.zones.graveyard['p2']!.map((id) => s.objects[id]!.defId);
    expect(gy.length).toBe(1);
    expect(['Test Top A', 'Test Top B']).toContain(gy[0]);
    const top = s.objects[s.zones.library['p2']![0]!]!.defId;
    expect(['Test Top A', 'Test Top B'].filter((n) => n !== gy[0])).toEqual([top]);
    expect(s.zones.graveyard['p1']!.length).toBe(0);
  });
  it('negative: the caster\'s own library is not touched', () => {
    const s = resolveAll(cast(game(), 'Test Peeker'), { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(s.zones.library['p1']!.length).toBe(20);
  });
});

describe('CR 701.8a, 701.19c: "you may pay {U}. If you don\'t, destroy target Knight and it can\'t be regenerated."', () => {
  const KNIGHT = card('Test Pale Knight', 'Creature — Human Knight', "When this creature enters, you may pay {0}. If you don't, destroy target Knight and it can't be regenerated.", '{0}', ['2', '2']);
  const FOE = card('Test Foe Knight', 'Creature — Human Knight', '', '{0}', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const game = () => scenario([], { defs: [KNIGHT, FOE, BEAR], p1: { hand: ['Test Pale Knight'] }, p2: { battlefield: ['Test Foe Knight', 'Test Bear'] } });
  it('is full', () => expect(full(KNIGHT)).toBe(true));
  it('not paying: the chosen Knight is destroyed (the Bear is not a Knight and cannot be chosen)', () => {
    const s0 = game();
    const foe = named(s0, 'Test Foe Knight')[0]!;
    const s = resolveAll(cast(s0, 'Test Pale Knight', { yes: [false], targets: [[obj(foe)]] }), { yes: [false], targets: [[obj(foe)]] });
    expect(named(s, 'Test Foe Knight')).toEqual([]);
    expect(named(s, 'Test Bear').length).toBe(1);
    expect(named(s, 'Test Pale Knight').length).toBe(1);
  });
  it('negative: paying keeps every Knight', () => {
    const s0 = game();
    const foe = named(s0, 'Test Foe Knight')[0]!;
    const s = resolveAll(cast(s0, 'Test Pale Knight', { yes: [true], targets: [[obj(foe)]] }), { yes: [true], targets: [[obj(foe)]] });
    expect(named(s, 'Test Foe Knight').length).toBe(1);
    expect(named(s, 'Test Pale Knight').length).toBe(1);
  });
});
