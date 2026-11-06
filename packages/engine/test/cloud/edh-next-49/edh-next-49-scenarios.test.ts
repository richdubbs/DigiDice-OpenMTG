/**
 * Commander worker, round edh-next-49 (EDHREC ranks 6,251-7,500, third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10).
 * Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 120.3a, 614.1a, 725.1   "As long as you're the monarch, damage doesn't cause you to lose life."
 *   CR 120.3b, 122.1b          "As long as you have 0 or less life, all damage is dealt to you as though its source had infect."
 *   CR 615.1, 615.5            "If a source would deal damage to you, prevent that damage and put an incarnation counter on this enchantment."
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { find, life, scenario } from '../../m3/scenario';
import { card, cast, counters, full, resolveAll } from '../cmd3/helpers';

const poison = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.poison;
const QUAKE = card('Test Quake', 'Sorcery', 'Test Quake deals 2 damage to each player.');
const DRAIN = card('Test Drain', 'Sorcery', 'Each player loses 2 life.');
const CROWN = card('Test Crown', 'Sorcery', 'You become the monarch.');

describe('CR 120.3a, 614.1a, 725.1: "As long as you\'re the monarch, damage doesn\'t cause you to lose life."', () => {
  const WARDEN = card('Test Crowned Warden', 'Creature — Archon', "Flying\nAs long as you're the monarch, damage doesn't cause you to lose life.", ['2', '2']);
  const game = (): GameState => scenario([], { defs: [WARDEN, QUAKE, DRAIN, CROWN], p1: { hand: ['Test Quake', 'Test Drain', 'Test Crown'], battlefield: ['Test Crowned Warden'] } });
  it('is full', () => expect(full(WARDEN)).toBe(true));
  it('the monarch loses no life to damage, the other player does', () => {
    let s = resolveAll(cast(game(), 'Test Crown'));
    s = resolveAll(cast(s, 'Test Quake'));
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(18);
  });
  it('negative: without the monarchy damage costs life as usual', () => {
    const s = resolveAll(cast(game(), 'Test Quake'));
    expect(life(s, 'p1')).toBe(18);
  });
  it('negative: losing life without damage still costs life while monarch', () => {
    let s = resolveAll(cast(game(), 'Test Crown'));
    s = resolveAll(cast(s, 'Test Drain'));
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('CR 120.3b, 122.1b: "As long as you have 0 or less life, all damage is dealt to you as though its source had infect."', () => {
  const UNLIFE = card('Test Unlife', 'Enchantment', "You don't lose the game for having 0 or less life.\nAs long as you have 0 or less life, all damage is dealt to you as though its source had infect.");
  const BLEED = card('Test Bleed', 'Sorcery', 'You lose 18 life.');
  const game = (lifeTotal: number): GameState => scenario([], { life: lifeTotal, defs: [UNLIFE, QUAKE, BLEED], p1: { hand: ['Test Bleed', 'Test Quake'], battlefield: ['Test Unlife'] } });
  it('is full', () => expect(full(UNLIFE)).toBe(true));
  it('at 0 or less life damage gives poison counters and costs no life', () => {
    let s = resolveAll(cast(game(18), 'Test Bleed'));
    expect(life(s, 'p1')).toBe(0);
    s = resolveAll(cast(s, 'Test Quake'));
    expect(life(s, 'p1')).toBe(0);
    expect(poison(s, 'p1')).toBe(2);
    expect(life(s, 'p2')).toBe(16); // the other player (18 to start) takes it as life
    expect(poison(s, 'p2')).toBe(0);
  });
  it('negative: with more than 0 life damage is ordinary', () => {
    const s = resolveAll(cast(game(20), 'Test Quake'));
    expect(life(s, 'p1')).toBe(18);
    expect(poison(s, 'p1')).toBe(0);
  });
});

describe('CR 615.1, 615.5: "If a source would deal damage to you, prevent that damage and put an incarnation counter on this enchantment."', () => {
  const LIVES = card('Test Nine Lives', 'Enchantment', 'If a source would deal damage to you, prevent that damage and put an incarnation counter on this enchantment.');
  it('is full', () => expect(full(LIVES)).toBe(true));
  it('prevents damage to you and adds a counter; the opponent is hurt', () => {
    const s0 = scenario([], { defs: [LIVES, QUAKE], p1: { hand: ['Test Quake'], battlefield: ['Test Nine Lives'] } });
    const s = resolveAll(cast(s0, 'Test Quake'));
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(18);
    expect(counters(s, find(s, 'Test Nine Lives', 'battlefield', 'p1'), 'incarnation')).toBe(1);
  });
  it('negative: loss of life without damage is not prevented and gives no counter', () => {
    const s0 = scenario([], { defs: [LIVES, DRAIN], p1: { hand: ['Test Drain'], battlefield: ['Test Nine Lives'] } });
    const s = resolveAll(cast(s0, 'Test Drain'));
    expect(life(s, 'p1')).toBe(18);
    expect(counters(s, find(s, 'Test Nine Lives', 'battlefield', 'p1'), 'incarnation')).toBe(0);
  });
});

// ---- second batch: Lock and Load, Artifact landcycling, Belt of Giant Strength, cast for life ----
import { attackWith, passBoth, act as act2, activations, card as card2, drive, find as find2, full as full2, legal, named, obj, resolveAll as resolveAll2, scenario as scenario2, cast as cast2, lifeOf } from '../r4-cost/support';

const handSize = (s: GameState, p = 'p1'): number => (s.zones.hand[p] ?? []).length;

describe('CR 121.1, 601.2i, 608.2h: "Draw a card, then draw a card for each other instant and sorcery spell you\'ve cast this turn."', () => {
  const LOAD = card2('Test Load Up', 'Sorcery', "Draw a card, then draw a card for each other instant and sorcery spell you've cast this turn.");
  const ZAP = card2('Test Zap', 'Instant', 'You gain 1 life.');
  const BEAR = card2('Test Bear Cub', 'Creature — Bear', '', '{0}', ['2', '2']);
  const lib = ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'];
  it('is full', () => expect(full2(LOAD)).toBe(true));
  it('draws one, plus one for each other instant or sorcery spell cast this turn (two Zaps: three cards), not for the spell itself', () => {
    let s = scenario2([], { defs: [LOAD, ZAP, BEAR], p1: { hand: ['Test Load Up', 'Test Zap', 'Test Zap', 'Test Bear Cub'], library: lib } });
    s = resolveAll2(cast2(s, 'Test Zap'));
    s = resolveAll2(cast2(s, 'Test Zap'));
    s = resolveAll2(cast2(s, 'Test Bear Cub')); // a creature spell is not counted
    const before = handSize(s);
    s = resolveAll2(cast2(s, 'Test Load Up'));
    expect(handSize(s) - before + 1).toBe(3); // the Load Up card left the hand: net +2 cards drawn after it, i.e. 3 drawn - 1 cast
  });
  it('negative: with no other instant or sorcery spell cast this turn it draws exactly one card', () => {
    let s = scenario2([], { defs: [LOAD, ZAP, BEAR], p1: { hand: ['Test Load Up', 'Test Bear Cub'], library: lib } });
    s = resolveAll2(cast2(s, 'Test Bear Cub'));
    const before = handSize(s);
    s = resolveAll2(cast2(s, 'Test Load Up'));
    expect(handSize(s) - before + 1).toBe(1);
  });
});

describe('CR 702.29e-f: "Artifact landcycling {1}" searches for an artifact land card', () => {
  const CYC = card2('Test Hoard Beast', 'Artifact Creature — Beast', 'Artifact landcycling {1}', '{3}', ['2', '2']);
  const VAULT = card2('Test Vault Tunnel', 'Artifact Land', '{T}: Add {C}.');
  const TRINKET = card2('Test Plain Trinket', 'Artifact', '');
  it('is full', () => expect(full2(CYC)).toBe(true));
  it('fetches the artifact land, not the plain land or the plain artifact', () => {
    const s = scenario2([], { defs: [CYC, VAULT, TRINKET], p1: { hand: ['Test Hoard Beast'], battlefield: ['Plains'], library: ['Plains', 'Test Plain Trinket', 'Test Vault Tunnel'] } });
    const cyc = legal(s, 'p1', 'activate').find((a) => /landcycling/i.test(a.label));
    expect(cyc).toBeDefined();
    const vault = find2(s, 'Test Vault Tunnel', 'library', 'p1');
    const trinket = find2(s, 'Test Plain Trinket', 'library', 'p1');
    const plains = s.zones.library['p1']!.find((id) => s.objects[id]!.defId === 'Plains')!;
    // the plain land and the plain artifact are not among the cards it may find
    let d = drive(act2(s, cyc!.action));
    d = passBoth(d);
    const opts = d.pending && 'options' in d.pending ? (d.pending as { options: string[] }).options : [];
    expect(opts).toContain(vault);
    expect(opts).not.toContain(trinket);
    expect(opts).not.toContain(plains);
    const done = resolveAll2(drive(d, { objects: [[vault]] }));
    expect((done.zones.hand['p1'] ?? []).map((id) => done.objects[id]!.defId)).toContain('Test Vault Tunnel');
  });
});

describe('CR 702.6a, 601.2f, 208.1: "Equip {10}. This ability costs {X} less to activate, where X is the power of the creature it targets."', () => {
  const BELT = card2('Test Giant Belt', 'Artifact — Equipment', 'Equipped creature has base power and toughness 10/10.\nEquip {10}. This ability costs {X} less to activate, where X is the power of the creature it targets.', '{1}');
  const OGRE = card2('Test Big Ogre', 'Creature — Ogre', '', '{3}', ['6', '6']);
  const MOUSE = card2('Test Tiny Mouse', 'Creature — Mouse', '', '{0}', ['1', '1']);
  const lands = (n: number): string[] => Array.from({ length: n }, () => 'Plains');
  const equipOf = (s: GameState) => activations(s, 'Test Giant Belt').find((a) => /Equip|Attach/i.test(a.label));
  it('is full', () => expect(full2(BELT)).toBe(true));
  it('equip onto a 6-power creature costs {4}', () => {
    const s = scenario2([], { defs: [BELT, OGRE, MOUSE], p1: { battlefield: [...lands(4), 'Test Giant Belt', 'Test Big Ogre'] } });
    const eq = equipOf(s);
    expect(eq).toBeDefined();
    const ogre = find2(s, 'Test Big Ogre', 'battlefield', 'p1');
    const done = resolveAll2(drive(act2(s, eq!.action), { targets: [[obj(ogre)]] }));
    expect(done.objects[find2(done, 'Test Giant Belt', 'battlefield', 'p1')]!.attachedTo).toBe(ogre);
    expect(done.zones.battlefield.filter((id) => done.objects[id]!.defId === 'Plains' && done.objects[id]!.tapped)).toHaveLength(4);
  });
  it('negative: onto a 1-power creature it still costs {9}, which four lands cannot pay', () => {
    const s = scenario2([], { defs: [BELT, OGRE, MOUSE], p1: { battlefield: [...lands(4), 'Test Giant Belt', 'Test Tiny Mouse'] } });
    expect(equipOf(s)).toBeUndefined();
  });
});

describe('CR 118.9, 202.3, 119.4: "You may cast that card by paying life equal to that spell\'s mana value rather than paying its mana cost."', () => {
  const MIND = card2('Test Mind Drill', 'Creature — Horror', 'When this creature enters, target opponent exiles cards from the top of their library until they exile a nonland card. You may cast that card by paying life equal to that spell\'s mana value rather than paying its mana cost.', '{0}', ['2', '2']);
  const RARE = card2('Test Pricey Thing', 'Artifact', '', '{3}');
  it('is full', () => expect(full2(MIND)).toBe(true));
  it('casting the exiled card costs life equal to its mana value (3) and no mana', () => {
    const s = scenario2([], { defs: [MIND, RARE], p1: { hand: ['Test Mind Drill'] }, p2: { library: ['Plains', 'Test Pricey Thing', 'Plains', 'Plains'] } });
    const done = resolveAll2(cast2(s, 'Test Mind Drill'), { targets: [[{ kind: 'player', id: 'p2' }]], yes: [true] });
    expect(named(done, 'Test Pricey Thing')).toHaveLength(1);
    expect(lifeOf(done)).toBe(17); // 20 - 3
  });
  it('negative: declining the cast pays nothing and the card stays in exile', () => {
    const s = scenario2([], { defs: [MIND, RARE], p1: { hand: ['Test Mind Drill'] }, p2: { library: ['Plains', 'Test Pricey Thing', 'Plains', 'Plains'] } });
    const done = resolveAll2(cast2(s, 'Test Mind Drill'), { targets: [[{ kind: 'player', id: 'p2' }]], yes: [false] });
    expect(named(done, 'Test Pricey Thing')).toHaveLength(0);
    expect(lifeOf(done)).toBe(20);
  });
});

describe('CR 510.2, 120.3b (ruling 2011-06-01): Phyrexian Unlife decides once for simultaneous damage', () => {
  const UNLIFE = card2('Test Unlife Two', 'Enchantment', "You don't lose the game for having 0 or less life.\nAs long as you have 0 or less life, all damage is dealt to you as though its source had infect.");
  const ORC = card2('Test Orc Raider', 'Creature — Orc', '', '{0}', ['3', '3']);
  it('two 3/3 attackers hitting a player with 2 life at once: life goes to -4 and no poison (life was positive when the damage was dealt)', () => {
    const s = scenario2([], { life: 2, defs: [UNLIFE, ORC], p1: { battlefield: ['Test Orc Raider', 'Test Orc Raider'] }, p2: { battlefield: ['Test Unlife Two'] } });
    const orcs = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Orc Raider');
    const done = attackWith(s, orcs);
    expect(done.players.find((x) => x.id === 'p2')!.life).toBe(-4);
    expect(done.players.find((x) => x.id === 'p2')!.poison).toBe(0);
  });
});

describe('CR 118.9: Bismuth Mindrender wording "the spell\'s mana value"', () => {
  it('is understood by the same template as "that spell\'s"', () => {
    const MIND = card2('Test Mind Drill Two', 'Creature — Horror', "When this creature enters, target opponent exiles cards from the top of their library until they exile a nonland card. You may cast that card by paying life equal to the spell's mana value rather than paying its mana cost.", '{0}', ['2', '2']);
    expect(full2(MIND)).toBe(true);
  });
});
