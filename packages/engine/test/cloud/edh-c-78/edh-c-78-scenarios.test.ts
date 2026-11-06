/**
 * Commander EDHREC ranks 18,001-18,500, round edh-c-78 (later pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 603.2c, 122.1, 201.5      "Whenever one or more +1/+1 counters are put on this creature, it gains menace until end of turn."
 *   CR 205.1a, 105.3, 611.2b     "Put a charge counter on target creature. It's a green Dinosaur with base power and toughness 5/5 for as long as it has a charge counter on it."
 *   CR 614.9, 616.1              "Until end of turn, if damage would be dealt to any creature, you may have that damage dealt to you instead."
 *   CR 120.4a, 120.10, 608.2c    "... If excess damage was dealt to a creature this way, draw a card."
 *   CR 608.2c, 202.3             "Put target creature card from an opponent's graveyard onto the battlefield under your control if its mana value is less than or equal to the number of Allies you control."
 *   CR 702.11b-c, 115.1          "Your opponents and permanents your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof."
 *   CR 614.1c, 202.3             "Each creature without mana value of the chosen quality enters tapped."
 *   CR 702                       "Target creature without first strike, double strike, or vigilance can't attack or block until your next turn."
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import type { GameState, ObjectId } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import { act, activations, answer, passBoth, card, cast, drive, find, full, lifeOf, named, obj, resolveAll, scenario } from '../r4-cost/support';

const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const pl = (id: string) => ({ kind: 'player', id }) as never;

describe('CR 603.2c, 122.1, 201.5: "Whenever one or more +1/+1 counters are put on this creature, it gains menace until end of turn."', () => {
  const VAMP = card('Test Pale Drinker', 'Creature — Vampire', 'Whenever one or more +1/+1 counters are put on this creature, it gains menace until end of turn.', '{0}', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const GROW = card('Test Grow', 'Sorcery', 'Put a +1/+1 counter on target creature.');
  const WITHER = card('Test Wither', 'Sorcery', 'Put a -1/-1 counter on target creature.');
  const board = (): GameState => scenario([], { defs: [VAMP, BEAR, GROW, WITHER], p1: { battlefield: ['Test Pale Drinker', 'Test Bear'], hand: ['Test Grow', 'Test Wither'] } });
  it('is full', () => expect(full(VAMP)).toBe(true));
  it('a +1/+1 counter on it gives it menace', () => {
    const s0 = board();
    const v = named(s0, 'Test Pale Drinker')[0]!;
    expect(hasKeyword(getChars(s0, v)!, 'menace')).toBe(false);
    const s = resolveAll(cast(s0, 'Test Grow', { targets: [[obj(v)]] }));
    expect(pt(s, v)).toBe('3/3');
    expect(hasKeyword(getChars(s, v)!, 'menace')).toBe(true);
  });
  it('negative: a counter on another creature gives it nothing, and nothing gives the Bear menace', () => {
    const s0 = board();
    const v = named(s0, 'Test Pale Drinker')[0]!;
    const b = named(s0, 'Test Bear')[0]!;
    const s = resolveAll(cast(s0, 'Test Grow', { targets: [[obj(b)]] }));
    expect(hasKeyword(getChars(s, v)!, 'menace')).toBe(false);
    expect(hasKeyword(getChars(s, b)!, 'menace')).toBe(false);
  });
  it('negative: a -1/-1 counter on it is not a +1/+1 counter', () => {
    const s0 = board();
    const v = named(s0, 'Test Pale Drinker')[0]!;
    const s = resolveAll(cast(s0, 'Test Wither', { targets: [[obj(v)]] }));
    expect(hasKeyword(getChars(s, v)!, 'menace')).toBe(false);
  });
});

describe('CR 205.1a, 105.3, 611.2b: "It\'s a green Dinosaur with base power and toughness 5/5 for as long as it has a charge counter on it."', () => {
  const MARK = card('Test Mark', 'Sorcery', "Put a charge counter on target creature. It's a green Dinosaur with base power and toughness 5/5 for as long as it has a charge counter on it.");
  const UNMARK = card('Test Unmark', 'Sorcery', 'Remove a charge counter from target creature.');
  const MOUSE = card('Test Mouse', 'Creature — Mouse', '', '{0}', ['1', '1'], ['W']);
  const board = (): GameState => scenario([], { defs: [MARK, UNMARK, MOUSE], p1: { battlefield: ['Test Mouse'], hand: ['Test Mark', 'Test Unmark'] } });
  it('is full', () => expect(full(MARK)).toBe(true));
  it('the creature is a green 5/5 Dinosaur (not a Mouse, not white) while it has the counter, and a 1/1 white Mouse again after the counter is removed', () => {
    const s0 = board();
    const m = named(s0, 'Test Mouse')[0]!;
    const s1 = resolveAll(cast(s0, 'Test Mark', { targets: [[obj(m)]] }));
    const c1 = getChars(s1, m)!;
    expect(pt(s1, m)).toBe('5/5');
    expect(c1.subtypes).toEqual(['Dinosaur']);
    expect(c1.colors).toEqual(['G']);
    const s2 = resolveAll(cast(s1, 'Test Unmark', { targets: [[obj(m)]] }));
    const c2 = getChars(s2, m)!;
    expect(pt(s2, m)).toBe('1/1');
    expect(c2.subtypes).toEqual(['Mouse']);
    expect(c2.colors).toEqual(['W']);
  });
  it('negative: another creature without the counter is unchanged', () => {
    const MOUSE2 = card('Test Mouse Two', 'Creature — Mouse', '', '{0}', ['1', '1']);
    const s0 = scenario([], { defs: [MARK, MOUSE, MOUSE2], p1: { battlefield: ['Test Mouse', 'Test Mouse Two'], hand: ['Test Mark'] } });
    const s = resolveAll(cast(s0, 'Test Mark', { targets: [[obj(named(s0, 'Test Mouse')[0]!)]] }));
    expect(pt(s, named(s0, 'Test Mouse Two')[0]!)).toBe('1/1');
  });
});

describe('CR 614.9, 616.1: "Until end of turn, if damage would be dealt to any creature, you may have that damage dealt to you instead."', () => {
  const SHIELD = card('Test Martyr Prayer', 'Instant', 'Until end of turn, if damage would be dealt to any creature, you may have that damage dealt to you instead.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 2 damage to any target.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const board = (): GameState => scenario([], { defs: [SHIELD, BOLT, BEAR], p1: { battlefield: ['Test Bear'], hand: ['Test Martyr Prayer', 'Test Bolt'] } });
  const setup = (): GameState => resolveAll(cast(board(), 'Test Martyr Prayer'));
  it('is full', () => expect(full(SHIELD)).toBe(true));
  it('answering yes: you take the 2 damage and the Bear lives', () => {
    const s0 = setup();
    const bear = named(s0, 'Test Bear')[0]!;
    const s = resolveAll(cast(s0, 'Test Bolt', { targets: [[obj(bear)]] }), { yes: [true] });
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(named(s, 'Test Bear')).toHaveLength(1);
  });
  it('answering no (it is a "may"): the Bear takes the damage and dies, your life is untouched', () => {
    const s0 = setup();
    const bear = named(s0, 'Test Bear')[0]!;
    const s = resolveAll(cast(s0, 'Test Bolt', { targets: [[obj(bear)]] }), { yes: [false] });
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(named(s, 'Test Bear')).toHaveLength(0);
  });
  it('negative: damage to a player is not redirected and you are not asked', () => {
    const s0 = setup();
    const s = resolveAll(cast(s0, 'Test Bolt', { targets: [[pl('p1')]] }), { yes: [true] });
    expect(lifeOf(s, 'p1')).toBe(18);
    const t = resolveAll(cast(setup(), 'Test Bolt', { targets: [[pl('p2')]] }), { yes: [true] });
    expect(lifeOf(t, 'p2')).toBe(18);
    expect(lifeOf(t, 'p1')).toBe(20);
  });
});

describe('CR 120.4a, 120.10, 608.2c: "~ deals damage equal to its power to any target. If excess damage was dealt to a creature this way, draw a card."', () => {
  const ARCHER = card('Test Spark Archer', 'Creature — Human Warrior', '{T}: Test Spark Archer deals damage equal to its power to any target. If excess damage was dealt to a creature this way, draw a card.', '{0}', ['3', '3']);
  const SMALL = card('Test Small', 'Creature — Mouse', '', '{0}', ['1', '1']);
  const BIG = card('Test Big', 'Creature — Ox', '', '{0}', ['3', '3']);
  const LIB = ['Test Small', 'Test Small', 'Test Small'];
  const board = (): GameState => scenario([], { defs: [ARCHER, SMALL, BIG], p1: { battlefield: ['Test Spark Archer'], library: LIB }, p2: { battlefield: ['Test Small', 'Test Big'] } });
  const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
  const shoot = (s0: GameState, t: unknown): GameState => {
    const a = activations(s0, 'Test Spark Archer')[0]!;
    return resolveAll(drive(act(s0, (a as unknown as { action: never }).action), { targets: [[t as never]] }));
  };
  it('is full', () => expect(full(ARCHER)).toBe(true));
  it('excess damage to a creature draws a card (3 damage to a 1/1)', () => {
    const s0 = board();
    const s = shoot(s0, obj(named(s0, 'Test Small')[0]!));
    expect(named(s, 'Test Small')).toHaveLength(0);
    expect(handSize(s)).toBe(handSize(s0) + 1);
  });
  it('negative: exactly lethal damage is no excess (3 damage to a 3/3 draws nothing)', () => {
    const s0 = board();
    const s = shoot(s0, obj(named(s0, 'Test Big')[0]!));
    expect(named(s, 'Test Big')).toHaveLength(0);
    expect(handSize(s)).toBe(handSize(s0));
  });
  it('negative: damage to a player draws nothing', () => {
    const s0 = board();
    const s = shoot(s0, pl('p2'));
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(handSize(s)).toBe(handSize(s0));
  });
});

describe('CR 608.2c, 202.3: "{T}: Put target creature card from an opponent\'s graveyard onto the battlefield under your control if its mana value is less than or equal to the number of Allies you control."', () => {
  const OCC = card('Test Grave Ally', 'Creature — Human Shaman Ally', "{T}: Put target creature card from an opponent's graveyard onto the battlefield under your control if its mana value is less than or equal to the number of Allies you control.", '{0}', ['1', '1']);
  const ONE = card('Test Dead One', 'Creature — Zombie', '', '{1}', ['1', '1']);
  const THREE = card('Test Dead Three', 'Creature — Zombie', '', '{3}', ['3', '3']);
  const ALLY = card('Test Other Ally', 'Creature — Human Ally', '', '{0}', ['1', '1']);
  const run = (extraAllies: string[], target: string): GameState => {
    const s0 = scenario([], { defs: [OCC, ONE, THREE, ALLY], p1: { battlefield: ['Test Grave Ally', ...extraAllies] }, p2: { graveyard: ['Test Dead One', 'Test Dead Three'] } });
    const a = activations(s0, 'Test Grave Ally')[0]!;
    const t = s0.zones.graveyard['p2']!.find((id) => s0.objects[id]!.defId === target)!;
    return resolveAll(drive(act(s0, (a as unknown as { action: never }).action), { targets: [[obj(t)]] }));
  };
  it('is full', () => expect(full(OCC)).toBe(true));
  it('one Ally (itself): a mana value 1 creature card comes back under your control', () => {
    const s = run([], 'Test Dead One');
    const id = named(s, 'Test Dead One')[0]!;
    expect(s.objects[id]!.controller).toBe('p1');
  });
  it('negative: one Ally and a mana value 3 card: it stays in the graveyard', () => {
    const s = run([], 'Test Dead Three');
    expect(named(s, 'Test Dead Three')).toHaveLength(0);
    expect(s.zones.graveyard['p2']!.some((id) => s.objects[id]!.defId === 'Test Dead Three')).toBe(true);
  });
  it('three Allies: the mana value 3 card comes back', () => {
    const s = run(['Test Other Ally', 'Test Other Ally'], 'Test Dead Three');
    expect(named(s, 'Test Dead Three')).toHaveLength(1);
  });
});

describe('CR 702.11b-c, 115.1: "Your opponents and permanents your opponents control with hexproof can be the targets of spells and abilities you control as though they didn\'t have hexproof."', () => {
  const WALKER = card('Test Hex Breaker', 'Artifact', "Your opponents and permanents your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.");
  const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  const SHY = card('Test Shy Elf', 'Creature — Elf', 'Hexproof', '{0}', ['1', '1']);
  const mk = (withBreaker: boolean): GameState => scenario([], { defs: [WALKER, SMITE, SHY], p1: { battlefield: withBreaker ? ['Test Hex Breaker'] : [], hand: ['Test Smite'] }, p2: { battlefield: ['Test Shy Elf'] } });
  it('is full', () => expect(full(WALKER)).toBe(true));
  it('with it you can destroy the opponent\'s hexproof creature', () => {
    const s0 = mk(true);
    const s = resolveAll(cast(s0, 'Test Smite', { targets: [[obj(named(s0, 'Test Shy Elf')[0]!)]] }));
    expect(named(s, 'Test Shy Elf')).toHaveLength(0);
  });
  it('negative: without it the hexproof creature is not a legal target', () => {
    const s0 = mk(false);
    expect(() => cast(s0, 'Test Smite', { targets: [[obj(named(s0, 'Test Shy Elf')[0]!)]] })).toThrow();
  });
  it('negative: it does not let the opponent target your hexproof creature', () => {
    const MINE = card('Test My Shy Elf', 'Creature — Elf', 'Hexproof', '{0}', ['1', '1']);
    const SMITE2 = card('Test Opp Smite', 'Sorcery', 'Destroy target creature.');
    const s0 = scenario([], { defs: [WALKER, MINE, SMITE2], p1: { battlefield: ['Test Hex Breaker', 'Test My Shy Elf'] }, p2: { hand: ['Test Opp Smite'] } });
    expect(() => cast(s0, 'Test Opp Smite', { targets: [[obj(named(s0, 'Test My Shy Elf')[0]!)]] }, 'p2')).toThrow();
  });
});

describe('CR 614.1c, 202.3: "As this enters, choose odd or even. Each creature without mana value of the chosen quality enters tapped."', () => {
  const ENCH = card('Test Parity Law', 'Enchantment', 'As this enchantment enters, choose odd or even.\nEach creature without mana value of the chosen quality enters tapped.');
  const ONE = card('Test One Drop', 'Creature — Mouse', '', '{1}', ['1', '1']);
  const TWO = card('Test Two Drop', 'Creature — Mouse', '', '{2}', ['2', '2']);
  const play = (word: string, who: string): GameState => {
    const s0 = scenario([], { defs: [ENCH, ONE, TWO], p1: { hand: ['Test Parity Law', 'Test One Drop', 'Test Two Drop'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] } });
    let s1 = cast(s0, 'Test Parity Law');
    for (let i = 0; i < 6 && s1.zones.stack.length > 0; i++) { s1 = passBoth(s1); const pd = s1.pending as { kind: string; options?: { id: string; label?: string }[] } | undefined; if (pd?.kind === 'chooseOption') { const o = pd.options!.find((x) => (x.label ?? x.id).toLowerCase() === word || x.id.toLowerCase() === word)!; s1 = answer(s1, { kind: 'chooseOption', ids: [o.id] } as never); } }
    return resolveAll(cast(s1, who));
  };
  it('is full', () => expect(full(ENCH)).toBe(true));
  it('odd: the mana value 2 creature enters tapped', () => {
    const s = play('odd', 'Test Two Drop');
    expect(s.objects[named(s, 'Test Two Drop')[0]!]!.tapped).toBe(true);
  });
  it('negative: odd: the mana value 1 creature enters untapped', () => {
    const s = play('odd', 'Test One Drop');
    expect(s.objects[named(s, 'Test One Drop')[0]!]!.tapped).toBeFalsy();
  });
  it('even: the mana value 1 creature enters tapped, the 2 does not', () => {
    const a = play('even', 'Test One Drop');
    expect(a.objects[named(a, 'Test One Drop')[0]!]!.tapped).toBe(true);
    const b = play('even', 'Test Two Drop');
    expect(b.objects[named(b, 'Test Two Drop')[0]!]!.tapped).toBeFalsy();
  });
});

describe('CR 702: "Target creature without first strike, double strike, or vigilance can\'t attack or block until your next turn." (a list of three after "without")', () => {
  const TOUCH = card('Test Gentle Touch', 'Sorcery', "Target creature without first strike, double strike, or vigilance can't attack or block until your next turn.");
  const PLAIN = card('Test Plain Ox', 'Creature — Ox', '', '{0}', ['2', '2']);
  const VIG = card('Test Vigil Ox', 'Creature — Ox', 'Vigilance', '{0}', ['2', '2']);
  it('is full', () => expect(full(TOUCH)).toBe(true));
  it('a creature without any of the three is a legal target; one with vigilance is not', () => {
    const s0 = scenario([], { defs: [TOUCH, PLAIN, VIG], p1: { hand: ['Test Gentle Touch'] }, p2: { battlefield: ['Test Plain Ox', 'Test Vigil Ox'] } });
    expect(() => cast(s0, 'Test Gentle Touch', { targets: [[obj(named(s0, 'Test Vigil Ox')[0]!)]] })).toThrow();
    const s = cast(s0, 'Test Gentle Touch', { targets: [[obj(named(s0, 'Test Plain Ox')[0]!)]] });
    expect(s.zones.stack.length).toBeGreaterThan(0);
    void find;
  });
});
