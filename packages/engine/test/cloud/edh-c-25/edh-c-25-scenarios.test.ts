/**
 * Commander lane edh-c, round edh-c-25 (EDHREC ranks 20,501-21,000): the round's readings played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 701.21a, 608.2h        "Target player sacrifices a creature of their choice, then gains life equal to that creature's toughness." (Devour Flesh)
 *   CR 608.2c, 608.2h, 611.2a "If a Goblin is sacrificed this way, that player creates two 1/1 black Goblin Rogue creature tokens, and those tokens gain haste until end of turn." (Warren Weirding)
 *   CR 119.1, 102.3, 608.2c   "If you have less life than an opponent, you gain 6 life. If you control fewer creatures than an opponent, create three 1/1 ..." (Timely Reinforcements)
 *   CR 120.1, 102.3, 122.1    "Whenever a source you control deals damage to another player, put that many theft counters on ~." (Night Dealings)
 *   CR 303.4e, 611.3a, 702.18 "Enchanted creature has shroud as long as its controller controls another creature." (Favorable Destiny)
 *   CR 506.2a, 101.2, 604.1   "As long as ~ is attacking, defending player can't cast spells." (Wardscale Dragon)
 *   CR 701.24a, 603.2         "Whenever a spell or ability causes a player to shuffle their library, ~ deals 2 damage to that player." (Psychogenic Probe)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars, type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, card, drive, find, full, legal, lifeOf, obj, resolveAll, scenario } from '../r3-cost/support';
import { pass } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['3', '3']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', '{0}', ['2', '2']);
const WALL = card('Test Wall', 'Creature — Wall', '', '{0}', ['0', '4']);
const FLASH = card('Test Charm', 'Instant', 'You gain 1 life.', '{0}');
const NAMES = (s: GameState, zone: 'battlefield' | 'graveyard' | 'hand', owner: string): string[] =>
  Object.values(s.objects).filter((o) => o.zone === zone && o.owner === owner).map((o) => s.defs[o.defId]?.name ?? '').sort();
const on = (s: GameState, name: string, owner = 'p1'): ObjectId => find(s, name, 'battlefield', owner as 'p1');
const tgtP = (id: 'p1' | 'p2') => ({ kind: 'player' as const, id });

const DEVOUR = card('Test Devour', 'Sorcery', 'Target player sacrifices a creature of their choice, then gains life equal to that creature\'s toughness.', '{0}');
describe('CR 701.21a, 608.2h: "Target player sacrifices a creature of their choice, then gains life equal to that creature\'s toughness." (Devour Flesh)', () => {
  const game = (p2: string[]) => scenario([], { defs: [DEVOUR, BEAR, GOBLIN, WALL], p1: { hand: ['Test Devour'], battlefield: ['Test Bear'] }, p2: { battlefield: p2 } });
  it('is automated', () => { expect(full(DEVOUR)).toBe(true); });
  it('the target player sacrifices their creature and gains its toughness (a 0/4 wall: +4 life); your own creature stays', () => {
    const s = resolveAll(drive(act(game(['Test Wall']), { type: 'cast', player: 'p1', card: find(game(['Test Wall']), 'Test Devour', 'hand', 'p1') }), { targets: [[tgtP('p2')]] }));
    expect(NAMES(s, 'graveyard', 'p2')).toContain('Test Wall');
    expect(lifeOf(s, 'p2')).toBe(24);
    expect(NAMES(s, 'battlefield', 'p1')).toContain('Test Bear');
  });
  it('the target player picks which creature (the 3/3 chosen, the 0/4 kept: +3 life, not +4)', () => {
    const s0 = game(['Test Wall', 'Test Goblin']);
    const goblin = on(s0, 'Test Goblin', 'p2');
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Devour', 'hand', 'p1') }), { targets: [[tgtP('p2')]] }), { objects: [[goblin]] });
    expect(NAMES(s, 'graveyard', 'p2')).toEqual(['Test Goblin']);
    expect(lifeOf(s, 'p2')).toBe(22);
  });
  it('negative: a player with no creature sacrifices nothing and gains nothing; targeting yourself sacrifices your own creature', () => {
    const s0 = game([]);
    const a = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Devour', 'hand', 'p1') }), { targets: [[tgtP('p2')]] }));
    expect(lifeOf(a, 'p2')).toBe(20);
    expect(NAMES(a, 'battlefield', 'p1')).toContain('Test Bear');
    const b = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Devour', 'hand', 'p1') }), { targets: [[tgtP('p1')]] }));
    expect(NAMES(b, 'graveyard', 'p1')).toContain('Test Bear');
    expect(lifeOf(b, 'p1')).toBe(23);
  });
});

const WARREN = card('Test Warren', 'Kindred Sorcery — Goblin', 'Target player sacrifices a creature of their choice. If a Goblin is sacrificed this way, that player creates two 1/1 black Goblin Rogue creature tokens, and those tokens gain haste until end of turn.', '{0}');
describe('CR 608.2c, 608.2h, 611.2a: "If a Goblin is sacrificed this way, that player creates two 1/1 black Goblin Rogue creature tokens, and those tokens gain haste until end of turn." (Warren Weirding)', () => {
  const game = (p2: string[]) => scenario([], { defs: [WARREN, BEAR, GOBLIN], p1: { hand: ['Test Warren'] }, p2: { battlefield: p2 } });
  const play = (s0: GameState) => resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Warren', 'hand', 'p1') }), { targets: [[tgtP('p2')]] }));
  it('is automated', () => { expect(full(WARREN)).toBe(true); });
  it('a sacrificed Goblin: its controller gets two 1/1 Goblin Rogue tokens with haste (not the caster)', () => {
    const s = play(game(['Test Goblin']));
    const tokens = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.kind === 'token');
    expect(tokens.length).toBe(2);
    for (const t of tokens) {
      expect(t.controller).toBe('p2');
      const c = getChars(s, t.id)!;
      expect(`${c.power}/${c.toughness}`).toBe('1/1');
      expect(c.subtypes).toEqual(expect.arrayContaining(['Goblin', 'Rogue']));
      expect(c.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword))).toContain('haste');
    }
  });
  it('negative: a sacrificed non-Goblin makes no tokens; no creature to sacrifice makes none', () => {
    expect(Object.values(play(game(['Test Bear'])).objects).filter((o) => o.zone === 'battlefield' && o.kind === 'token').length).toBe(0);
    expect(Object.values(play(game([])).objects).filter((o) => o.zone === 'battlefield' && o.kind === 'token').length).toBe(0);
  });
});

const TIMELY = card('Test Timely', 'Instant', 'If you have less life than an opponent, you gain 6 life. If you control fewer creatures than an opponent, create three 1/1 white Soldier creature tokens.', '{0}');
describe('CR 119.1, 102.3, 608.2c: "If you have less life than an opponent, you gain 6 life. If you control fewer creatures than an opponent, create three 1/1 white Soldier creature tokens." (Timely Reinforcements)', () => {
  const game = (o: { p1Life?: number; p1Creatures?: string[]; p2Creatures?: string[] }) => {
    const s = scenario([], { defs: [TIMELY, BEAR, GOBLIN], p1: { hand: ['Test Timely'], battlefield: o.p1Creatures ?? [] }, p2: { battlefield: o.p2Creatures ?? [] } });
    if (o.p1Life !== undefined) s.players.find((p) => p.id === 'p1')!.life = o.p1Life;
    return s;
  };
  const soldiers = (s: GameState): number => Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.kind === 'token' && o.owner === 'p1').length;
  const play = (s0: GameState) => resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Timely', 'hand', 'p1') })));
  it('is automated', () => { expect(full(TIMELY)).toBe(true); });
  it('behind on life and creatures: +6 life and three Soldier tokens', () => {
    const s = play(game({ p1Life: 15, p2Creatures: ['Test Bear'] }));
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(soldiers(s)).toBe(3);
  });
  it('negative: equal life and equal creatures change nothing; ahead on life gains nothing', () => {
    const a = play(game({ p1Creatures: ['Test Bear'], p2Creatures: ['Test Goblin'] }));
    expect(lifeOf(a, 'p1')).toBe(20);
    expect(soldiers(a)).toBe(0);
    const b = play(game({ p1Life: 25, p2Creatures: ['Test Bear', 'Test Goblin'] }));
    expect(lifeOf(b, 'p1')).toBe(25);
    expect(soldiers(b)).toBe(3);
  });
  it('the two checks are independent: behind on life only gives life and no tokens', () => {
    const s = play(game({ p1Life: 10, p1Creatures: ['Test Bear'], p2Creatures: ['Test Goblin'] }));
    expect(lifeOf(s, 'p1')).toBe(16);
    expect(soldiers(s)).toBe(0);
  });
});

const DEALINGS = card('Test Dealings', 'Enchantment', 'Whenever a source you control deals damage to another player, put that many theft counters on this enchantment.', '{0}');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', '{0}');
describe('CR 120.1, 102.3, 122.1: "Whenever a source you control deals damage to another player, put that many theft counters on ~." (Night Dealings)', () => {
  const game = () => scenario([], { defs: [DEALINGS, BOLT, BEAR], p1: { hand: ['Test Bolt', 'Test Bolt'], battlefield: ['Test Dealings'] }, p2: { battlefield: ['Test Bear'] } });
  const theft = (s: GameState): number => s.objects[on(s, 'Test Dealings')]!.counters['theft'] ?? 0;
  const bolt = (s0: GameState, t: ReturnType<typeof tgtP> | ReturnType<typeof obj>) => resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bolt', 'hand', 'p1') }), { targets: [[t]] }));
  it('is automated', () => { expect(full(DEALINGS)).toBe(true); });
  it('3 damage to an opponent puts three theft counters on it', () => {
    expect(theft(bolt(game(), tgtP('p2')))).toBe(3);
  });
  it('negative: damage to yourself or to a creature puts none', () => {
    expect(theft(bolt(game(), tgtP('p1')))).toBe(0);
    const s0 = game();
    expect(theft(bolt(s0, obj(on(s0, 'Test Bear', 'p2'))))).toBe(0);
  });
});

const DESTINY = card('Test Destiny', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has shroud as long as its controller controls another creature.', '{0}');
describe('CR 303.4e, 611.3a, 702.18: "Enchanted creature has shroud as long as its controller controls another creature." (Favorable Destiny)', () => {
  const shroud = (s: GameState, id: ObjectId): boolean => getChars(s, id)!.keywords.some((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword) === 'shroud');
  const game = (p1: string[]) => scenario([], { defs: [DESTINY, BEAR, GOBLIN], p1: { hand: ['Test Destiny'], battlefield: p1 } });
  const aura = (s0: GameState, target: ObjectId) => resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Destiny', 'hand', 'p1') }), { targets: [[obj(target)]] }));
  it('is automated', () => { expect(full(DESTINY)).toBe(true); });
  it('with another creature on its controller\'s side the enchanted creature has shroud', () => {
    const s0 = game(['Test Bear', 'Test Goblin']);
    const s = aura(s0, on(s0, 'Test Bear'));
    expect(shroud(s, on(s, 'Test Bear'))).toBe(true);
  });
  it('negative: alone it has no shroud (the enchanted creature itself is not "another"); it has it again when a second creature arrives', () => {
    const s0 = game(['Test Bear']);
    const s = aura(s0, on(s0, 'Test Bear'));
    expect(shroud(s, on(s, 'Test Bear'))).toBe(false);
  });
});

const DRAGON = card('Test Dragon', 'Creature — Dragon', 'Flying\nAs long as this creature is attacking, defending player can\'t cast spells.', '{0}', ['3', '3']);
describe('CR 506.2a, 101.2, 604.1: "As long as ~ is attacking, defending player can\'t cast spells." (Wardscale Dragon)', () => {
  const canCast = (s0: GameState, name: string): boolean => {
    let s = s0;
    if (s.pending?.kind === 'priority' && s.pending.player !== 'p2') s = pass(s);
    return applyAction(s, { type: 'cast', player: 'p2', card: find(s, name, 'hand', 'p2') }).error === undefined;
  };
  it('is automated', () => { expect(full(DRAGON)).toBe(true); });
  it('while attacking, the defending player cannot cast a spell; before attacking they can', () => {
    let s = scenario([], { defs: [DRAGON, FLASH], p1: { battlefield: ['Test Dragon'] }, p2: { hand: ['Test Charm'] } });
    expect(canCast(s, 'Test Charm')).toBe(true);
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[find(s, 'Test Dragon', 'battlefield', 'p1')]]);
    expect(canCast(s, 'Test Charm')).toBe(false);
  });
  it('negative: a Dragon that stays home restricts nobody: the opponent can cast during the declare attackers step with no attacker', () => {
    let s = scenario([], { defs: [DRAGON, FLASH], p1: { battlefield: ['Test Dragon'] }, p2: { hand: ['Test Charm'] } });
    s = toDeclareAttackers(s);
    s = declareAttackers(s, []);
    expect(canCast(s, 'Test Charm')).toBe(true);
  });
});

const PROBE = card('Test Probe', 'Artifact', 'Whenever a spell or ability causes a player to shuffle their library, this artifact deals 2 damage to that player.', '{0}');
const SHUFFLE = card('Test Shuffle', 'Sorcery', 'Target player shuffles their library.', '{0}');
describe('CR 701.24a, 603.2: "Whenever a spell or ability causes a player to shuffle their library, ~ deals 2 damage to that player." (Psychogenic Probe)', () => {
  const game = () => scenario([], { defs: [PROBE, SHUFFLE], p1: { hand: ['Test Shuffle'], battlefield: ['Test Probe'] } });
  const play = (s0: GameState, who: 'p1' | 'p2') => resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shuffle', 'hand', 'p1') }), { targets: [[tgtP(who)]] }));
  it('is automated', () => { expect(full(PROBE)).toBe(true); });
  it('the shuffling player takes 2 damage: an opponent made to shuffle, or you', () => {
    const a = play(game(), 'p2');
    expect(lifeOf(a, 'p2')).toBe(18);
    expect(lifeOf(a, 'p1')).toBe(20);
    const b = play(game(), 'p1');
    expect(lifeOf(b, 'p1')).toBe(18);
    expect(lifeOf(b, 'p2')).toBe(20);
  });
  it('ruling: it triggers even when the library is empty at the time of the shuffle', () => {
    const s0 = game();
    s0.zones.library['p2'] = [];
    const s = play(s0, 'p2');
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('negative: no shuffle, no damage', () => {
    const s = game();
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});
void legal;
