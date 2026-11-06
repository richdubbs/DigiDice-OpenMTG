/**
 * Must-finish round edh-next-143 (library, draw and search; code edhn143): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25
 * (MagicCompRules 20260925.txt).
 */
import { describe, expect, it } from 'vitest';
import { act, activations, advanceTo, card, cast, drive, find, full, legal, named, scenario, resolveAll } from '../r4-cost/support';
import type { CardDef, GameState } from '../../../src/index';
import { canSee } from '../../../src/core/view';
import { castOriginOf } from '../../../src/types/state';
import { spellActor } from '../../../src/statics/rule-match';
import { act as mpAct, answer, lifeOf as mpLife, mpScenario } from '../../m12/rules/helpers';

const libNames = (s: GameState, p: string): string[] => s.zones.library[p]!.map((id) => s.objects[id]!.defId);

// ---- Lonis, Cryptozoologist ------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.20a, 401.4, 110.2a, 107.3: "{T}, Sacrifice X Clues: Target opponent reveals the top X cards of their library. You may put a nonland permanent card with mana value X or less from among them onto the battlefield under your control. That player puts the rest on the bottom of their library in a random order."', () => {
  const LONIS = card('Test Lonis', 'Legendary Creature — Snake Elf', 'Whenever another nontoken creature you control enters, investigate.\n{T}, Sacrifice X Clues: Target opponent reveals the top X cards of their library. You may put a nonland permanent card with mana value X or less from among them onto the battlefield under your control. That player puts the rest on the bottom of their library in a random order.', '{G}{U}', ['3', '2']);
  const CLUE = card('Test Clue', 'Artifact — Clue', '{2}, Sacrifice this artifact: Draw a card.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}{R}', ['4', '4']);
  const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to any target.', '{R}');
  const defs = [LONIS, CLUE, BEAR, OGRE, BOLT];
  const board = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Lonis', 'Test Clue', 'Test Clue', 'Test Clue'] }, p2: { library: ['Test Bolt', 'Test Ogre', 'Test Bear', 'Plains', 'Test Bear'] } });
  const activate = (s0: GameState, x: number, yes: boolean, pick?: string): GameState => {
    const a = activations(s0, 'Test Lonis')[0]!;
    let s = act(s0, a.action);
    s = drive(s, { x: [x], targets: [[{ kind: 'player', id: 'p2' }]], objects: [named(s0, 'Test Clue').slice(0, x)] });
    return resolveAll(s, { yes: [yes], objects: pick === undefined ? [] : [s.zones.library.p2!.filter((id) => s.objects[id]!.defId === pick).slice(0, 1)] });
  };
  it('is full', () => expect(full(LONIS)).toBe(true));
  it('X = 3: a nonland permanent card of mana value 3 or less of the top three enters under your control; the other two go to the bottom of that library', () => {
    const s0 = board();
    const s = activate(s0, 3, true, 'Test Bear');
    expect(named(s, 'Test Clue')).toEqual([]);
    const bear = named(s, 'Test Bear');
    expect(bear.length).toBe(1);
    expect(s.objects[bear[0]!]!.controller).toBe('p1');
    expect(s.objects[bear[0]!]!.owner).toBe('p2');
    const lib = libNames(s, 'p2');
    expect(lib.length).toBe(s0.zones.library.p2!.length - 1);
    expect(lib.slice(0, 2)).toEqual(['Plains', 'Test Bear']); // the unrevealed cards stay on top
    expect(lib.slice(-2).sort()).toEqual(['Test Bolt', 'Test Ogre']);
  });
  it('negative (CR 202.3): a card of greater mana value and an instant are not offered; declining puts all X cards on the bottom', () => {
    const s0 = board();
    const a = activations(s0, 'Test Lonis')[0]!;
    let s = drive(act(s0, a.action), { x: [2], targets: [[{ kind: 'player', id: 'p2' }]], objects: [named(s0, 'Test Clue').slice(0, 2)] });
    s = resolveAll(s, { yes: [false] });
    expect(named(s, 'Test Ogre')).toEqual([]);
    expect(named(s, 'Test Clue').length).toBe(1);
    expect(libNames(s, 'p2').slice(-2).sort()).toEqual(['Test Bolt', 'Test Ogre']);
    expect(libNames(s, 'p2').slice(0, 1)).toEqual(['Test Bear']);
  });
});

// ---- Shadow the Hedgehog ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.61a, 601.2h, 106.3, 613.1f: "Each spell you cast has split second if mana from an artifact was spent to cast it."', () => {
  const SHADOW = card('Test Shadow', 'Legendary Creature — Hedgehog', 'Haste\nEach spell you cast has split second if mana from an artifact was spent to cast it.', '{1}{U}{B}', ['3', '1']);
  const ROCK = card('Test Rock', 'Artifact', '{T}: Add {C}{C}.', '{1}');
  const GOLD = card('Test Gold', 'Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.');
  const SPELL = card('Test Ponder', 'Sorcery', 'Draw a card.', '{2}');
  const SMALL = card('Test Peek', 'Sorcery', 'Draw a card.', '{1}');
  const ZAP = card('Test Zap', 'Instant', '~ deals 1 damage to any target.', '{W}');
  const QUICK = card('Test Quick', 'Instant', 'Draw a card.', '{2}');
  const defs = [SHADOW, ROCK, GOLD, SPELL, SMALL, ZAP];
  const canRespond = (s: GameState): boolean => legal(s, 'p2', 'cast').length > 0;
  /** Cast a spell and give p2 priority with it on the stack. */
  const castAndPass = (s0: GameState, name: string): GameState => act(cast(s0, name), { type: 'pass', player: 'p1' });
  it('is full', () => expect(full(SHADOW)).toBe(true));
  it('mana from an artifact (a mana rock) spent on the spell: the opponent can\'t cast an instant in response', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Ponder'], battlefield: ['Test Shadow', 'Test Rock'] }, p2: { hand: ['Test Zap'], battlefield: ['Plains'] } });
    const s = castAndPass(s0, 'Test Ponder');
    expect(s.pending?.player).toBe('p2');
    expect(canRespond(s)).toBe(false);
  });
  it('mana from an artifact that was sacrificed to pay (a Treasure, last known information, CR 106.3) counts too', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Peek'], battlefield: ['Test Shadow', 'Test Gold'] }, p2: { hand: ['Test Zap'], battlefield: ['Plains'] } });
    const s = castAndPass(s0, 'Test Peek');
    expect(named(s, 'Test Gold')).toEqual([]);
    expect(canRespond(s)).toBe(false);
  });
  it('negative: mana from lands only gives no split second; the opponent may respond', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Ponder'], battlefield: ['Test Shadow', 'Plains', 'Plains'] }, p2: { hand: ['Test Zap'], battlefield: ['Plains'] } });
    const s = castAndPass(s0, 'Test Ponder');
    expect(canRespond(s)).toBe(true);
  });
  it('negative: an opponent\'s spell paid with an artifact\'s mana gets no split second ("each spell you cast"): you may still respond to it', () => {
    const s0 = scenario([], { defs: [...defs, QUICK], p1: { hand: ['Test Ponder', 'Test Zap'], battlefield: ['Test Shadow', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Quick'], battlefield: ['Test Rock'] } });
    let s = castAndPass(s0, 'Test Ponder');
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Quick', 'hand', 'p2') }));
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.player).toBe('p1');
    expect(legal(s, 'p1', 'cast').length).toBeGreaterThan(0);
  });
});

// ---- friend or foe (Pir's Whim, Khorvath's Fury) --------------------------------------------------------------------------------------------------------------
/** Resolve a four-player stack: each "choose friend or foe" prompt (it names the player it is for) is answered from `roles`; other decisions take their first options. */
function resolveFriendOrFoe(s0: GameState, roles: Record<string, 'friend' | 'foe'>): GameState {
  let s = s0;
  for (let i = 0; i < 300 && (s.zones.stack.length > 0 || (s.pending != null && s.pending.kind !== 'priority')); i++) {
    const p = s.pending!;
    if (p.kind === 'priority') { s = mpAct(s, { type: 'pass', player: p.player }); continue; }
    if (p.kind === 'chooseOption') {
      const who = Object.keys(roles).find((n) => p.prompt.includes(`(for ${n})`));
      const want = who === undefined ? undefined : roles[who];
      const opt = p.options.find((o) => o.label === want) ?? p.options[0]!;
      s = answer(s, { kind: 'chooseOption', ids: [opt.id] });
      continue;
    }
    if (p.kind === 'chooseObjects') { s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, Math.min(1, p.max))) }); continue; }
    if (p.kind === 'yesNo') { s = answer(s, { kind: 'yesNo', yes: true }); continue; }
    if (p.kind === 'payCost') { s = answer(s, { kind: 'payCost', auto: true }); continue; }
    if (p.kind === 'order') { s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) }); continue; }
    throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const onBf = (s: GameState, p: string, name: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === p);

describe('CR 608.2d, 101.4, 701.23a, 701.21a: "For each player, choose friend or foe. Each friend searches their library for a land card, puts it onto the battlefield tapped, then shuffles. Each foe sacrifices an artifact or enchantment of their choice." (Pir\'s Whim; rulings 2018-06-08)', () => {
  const WHIM = card("Test Whim", 'Sorcery', 'For each player, choose friend or foe. Each friend searches their library for a land card, puts it onto the battlefield tapped, then shuffles. Each foe sacrifices an artifact or enchantment of their choice.', '{0}');
  const WOOD = card('Test Wood', 'Land', '');
  const RELIC = card('Test Relic', 'Artifact', '');
  const AURA = card('Test Glow', 'Enchantment', '');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [WHIM, WOOD, RELIC, AURA, BEAR];
  const board = (): GameState => mpScenario({ defs, zones: {
    p1: { hand: ['Test Whim'], library: ['Plains', 'Test Wood'], battlefield: ['Test Relic'] }, // (the starting player draws its top card, CR 103.8c)
    p2: { library: ['Test Wood'], battlefield: ['Test Relic'] },
    p3: { library: ['Test Wood'], battlefield: ['Test Glow', 'Test Bear'] },
    p4: { library: ['Test Wood'], battlefield: ['Test Bear'] },
  } });
  const play = (roles: Record<string, 'friend' | 'foe'>): GameState => {
    const s0 = board();
    return resolveFriendOrFoe(mpAct(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Whim', 'hand', 'p1') }), roles);
  };
  it('is full', () => expect(full(WHIM)).toBe(true));
  it('each friend (you included) puts a land of their own library onto the battlefield tapped under their control; each foe sacrifices one of their artifacts or enchantments', () => {
    const s = play({ Alice: 'friend', Bob: 'foe', Carol: 'foe', Dan: 'friend' });
    for (const p of ['p1', 'p4']) {
      const woods = onBf(s, p, 'Test Wood');
      expect(woods.length, p).toBe(1);
      expect(s.objects[woods[0]!]!.tapped, p).toBe(true);
      expect(s.objects[woods[0]!]!.owner, p).toBe(p);
    }
    expect(onBf(s, 'p2', 'Test Wood')).toEqual([]);
    expect(onBf(s, 'p2', 'Test Relic')).toEqual([]); // Bob, a foe, sacrificed his artifact
    expect(onBf(s, 'p3', 'Test Glow')).toEqual([]); // Carol sacrificed her enchantment (not the creature)
    expect(onBf(s, 'p3', 'Test Bear').length).toBe(1);
    expect(onBf(s, 'p1', 'Test Relic').length).toBe(1); // a friend sacrifices nothing
  });
  it('ruling 2018-06-08: you may call yourself a foe; a foe with no artifact or enchantment sacrifices nothing; a friend never sacrifices', () => {
    const s = play({ Alice: 'foe', Bob: 'friend', Carol: 'friend', Dan: 'foe' });
    expect(onBf(s, 'p1', 'Test Relic')).toEqual([]);
    expect(onBf(s, 'p1', 'Test Wood')).toEqual([]);
    expect(onBf(s, 'p4', 'Test Bear').length).toBe(1);
    expect(onBf(s, 'p2', 'Test Wood').length).toBe(1);
    expect(onBf(s, 'p3', 'Test Wood').length).toBe(1);
    expect(onBf(s, 'p3', 'Test Glow').length).toBe(1);
  });
});

describe('CR 608.2d, 608.2e, 701.9a, 121.1, 120.3: "For each player, choose friend or foe. Each friend discards all cards from their hand, then draws that many cards plus one. ~ deals damage to each foe equal to the number of cards in their hand." (Khorvath\'s Fury; rulings 2018-06-08)', () => {
  const FURY = card("Test Fury", 'Sorcery', 'For each player, choose friend or foe. Each friend discards all cards from their hand, then draws that many cards plus one. ~ deals damage to each foe equal to the number of cards in their hand.', '{0}');
  const defs = [FURY];
  const board = (): GameState => mpScenario({ defs, zones: {
    p1: { hand: ['Test Fury', 'Plains', 'Plains'] },
    p2: { hand: ['Plains', 'Plains', 'Plains'] },
    p3: { hand: ['Plains'] },
    p4: { hand: [] },
  } });
  const play = (roles: Record<string, 'friend' | 'foe'>): GameState => {
    const s0 = board();
    return resolveFriendOrFoe(mpAct(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fury', 'hand', 'p1') }), roles);
  };
  it('is full', () => expect(full(FURY)).toBe(true));
  it('each friend draws the number of cards THEY discarded plus one; each foe is dealt damage equal to their own hand size', () => {
    const s = play({ Alice: 'friend', Bob: 'friend', Carol: 'foe', Dan: 'foe' });
    expect(s.zones.hand.p1!.length).toBe(4); // three Plains (the starting player draws in a multiplayer game, CR 103.8c): discarded 3, drew 4
    expect(s.zones.hand.p2!.length).toBe(4); // discarded 3, drew 4
    expect(s.zones.graveyard.p1!.filter((id) => s.objects[id]!.defId === 'Plains').length).toBe(3);
    expect(mpLife(s, 'p3')).toBe(19);
    expect(mpLife(s, 'p4')).toBe(20);
    expect(mpLife(s, 'p1')).toBe(20);
  });
  it('ruling 2018-06-08: a friend with no cards in hand discards nothing and draws one card; a foe is not dealt damage for a friend\'s hand', () => {
    const s = play({ Alice: 'foe', Bob: 'foe', Carol: 'friend', Dan: 'friend' });
    expect(s.zones.hand.p4!.length).toBe(1);
    expect(s.zones.hand.p3!.length).toBe(2);
    expect(mpLife(s, 'p2')).toBe(17);
    expect(mpLife(s, 'p1')).toBe(17); // three cards in hand
    expect(mpLife(s, 'p3')).toBe(20);
  });
});

// ---- Xanathar, Guild Kingpin ------------------------------------------------------------------------------------------------------------------------------------
describe('CR 611.2a, 401.5, 601.3, 305.1, 609.4b: "Choose target opponent. Until end of turn, that player can\'t cast spells, you may look at the top card of their library any time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way." (Xanathar, Guild Kingpin)', () => {
  const EYE = card('Test Eye Tyrant', 'Legendary Creature — Beholder', '{0}: Choose target opponent. Until end of turn, that player can\'t cast spells, you may look at the top card of their library any time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way.', '{4}{U}{B}', ['5', '6']);
  const XAN = card('Test Upkeep Eye', 'Legendary Creature — Beholder', 'At the beginning of your upkeep, choose target opponent. Until end of turn, that player can\'t cast spells, you may look at the top card of their library any time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way.', '{4}{U}{B}', ['5', '6']);
  const FLARE = card('Test Flare', 'Instant', '~ deals 2 damage to any target.', '{R}');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{1}{R}', ['3', '3']);
  const WOOD = card('Test Wood', 'Land', '');
  const defs = [EYE, XAN, FLARE, OGRE, WOOD];
  const board = (p2lib: string[]): GameState => scenario([], { defs, p1: { battlefield: ['Test Eye Tyrant', 'Plains', 'Plains'] }, p2: { hand: ['Test Flare'], library: p2lib, battlefield: ['Plains'] } });
  const use = (s0: GameState): GameState => resolveAll(drive(act(s0, activations(s0, 'Test Eye Tyrant')[0]!.action), { targets: [[{ kind: 'player', id: 'p2' }]] }));
  const topOf = (s: GameState, p: string): string => s.zones.library[p]![0]!;
  it('is full (the activated and the upkeep wording)', () => { expect(full(EYE)).toBe(true); expect(full(XAN)).toBe(true); });
  it('you may cast the top card of that player\'s library, paying with mana of any color (white mana for {1}{R}); it enters under your control', () => {
    const s0 = board(['Test Ogre', 'Test Wood']);
    const s1 = use(s0);
    expect(canSee(s1, s1.objects[topOf(s1, 'p2')]!, 'p1')).toBe(true);
    expect(canSee(s0, s0.objects[topOf(s0, 'p2')]!, 'p1')).toBe(false); // negative: not before the ability resolved
    const s = resolveAll(drive(act(s1, { type: 'cast', player: 'p1', card: topOf(s1, 'p2') })));
    const ogre = named(s, 'Test Ogre');
    expect(ogre.length).toBe(1);
    expect(s.objects[ogre[0]!]!.controller).toBe('p1');
    expect(s.objects[ogre[0]!]!.owner).toBe('p2');
    expect(s.objects[topOf(s, 'p2')]!.defId).toBe('Test Wood');
  });
  it('you may play a land from the top of that player\'s library (CR 305.1), under your control', () => {
    const s1 = use(board(['Test Wood', 'Test Ogre']));
    const s = act(s1, { type: 'playLand', player: 'p1', card: topOf(s1, 'p2') });
    const wood = named(s, 'Test Wood');
    expect(wood.length).toBe(1);
    expect(s.objects[wood[0]!]!.controller).toBe('p1');
  });
  it('negative (CR 101.2): that player can\'t cast spells this turn', () => {
    const s1 = use(board(['Test Ogre']));
    const s = act(s1, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    expect(legal(s, 'p2', 'cast')).toEqual([]);
  });
  it('negative (CR 611.2a, 514.2): the effects end with the turn; your own library\'s top card gets no permission', () => {
    const s1 = use(board(['Test Ogre']));
    expect(legal(s1, 'p1', 'cast').some((a) => (a.action as { card?: string }).card === s1.zones.library.p1![0])).toBe(false);
    const s = advanceTo(s1, s1.turn.number + 1, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
    expect(canSee(s, s.objects[topOf(s, 'p2')]!, 'p1')).toBe(false);
    expect(legal(s, 'p1', 'cast').some((a) => (a.action as { card?: string }).card === topOf(s, 'p2'))).toBe(false);
  });
});

// ---- Sen Triplets -------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 611.2a, 101.2, 402.3, 601.3, 305.1, 108.3: "Choose target opponent. This turn, that player can\'t cast spells or activate abilities and plays with their hand revealed. You may play lands and cast spells from that player\'s hand this turn." (Sen Triplets; rulings 2020-08-07)', () => {
  const TRIO = card('Test Trio', 'Legendary Artifact Creature — Human Wizard', '{0}: Choose target opponent. This turn, that player can\'t cast spells or activate abilities and plays with their hand revealed. You may play lands and cast spells from that player\'s hand this turn.', '{2}{W}{U}{B}', ['3', '3']);
  const SEN = card('Test Upkeep Trio', 'Legendary Artifact Creature — Human Wizard', 'At the beginning of your upkeep, choose target opponent. This turn, that player can\'t cast spells or activate abilities and plays with their hand revealed. You may play lands and cast spells from that player\'s hand this turn.', '{2}{W}{U}{B}', ['3', '3']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{W}', ['2', '2']);
  const WOOD = card('Test Wood', 'Land', '');
  const FLARE = card('Test Flare', 'Instant', '~ deals 2 damage to any target.', '{R}');
  const ROCK = card('Test Rock', 'Artifact', '{T}: Add {C}{C}.', '{1}');
  const defs = [TRIO, SEN, BEAR, WOOD, FLARE, ROCK];
  const board = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Trio', 'Plains', 'Plains'] }, p2: { hand: ['Test Bear', 'Test Wood', 'Test Flare'], battlefield: ['Test Rock', 'Plains'] } });
  const use = (s0: GameState): GameState => resolveAll(drive(act(s0, activations(s0, 'Test Trio')[0]!.action), { targets: [[{ kind: 'player', id: 'p2' }]] }));
  const inHand = (s: GameState, p: string, name: string): string => s.zones.hand[p]!.find((id) => s.objects[id]!.defId === name)!;
  it('is full (the activated and the upkeep wording)', () => { expect(full(TRIO)).toBe(true); expect(full(SEN)).toBe(true); });
  it('that player\'s hand is revealed (CR 402.3); you may cast a spell from it (under your control) and play a land from it', () => {
    const s0 = board();
    expect(canSee(s0, s0.objects[inHand(s0, 'p2', 'Test Bear')]!, 'p1')).toBe(false); // negative: not before
    const s1 = use(s0);
    expect(canSee(s1, s1.objects[inHand(s1, 'p2', 'Test Bear')]!, 'p1')).toBe(true);
    let s = resolveAll(drive(act(s1, { type: 'cast', player: 'p1', card: inHand(s1, 'p2', 'Test Bear') })));
    const bear = named(s, 'Test Bear');
    expect(bear.length).toBe(1);
    expect(s.objects[bear[0]!]!.controller).toBe('p1');
    s = act(s, { type: 'playLand', player: 'p1', card: inHand(s, 'p2', 'Test Wood') });
    expect(s.objects[named(s, 'Test Wood')[0]!]!.controller).toBe('p1');
  });
  it('ruling 2020-08-07: the opponent can\'t cast spells or activate abilities, mana abilities included', () => {
    const s1 = use(board());
    const s = act(s1, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    expect(legal(s, 'p2', 'cast')).toEqual([]);
    expect(legal(s, 'p2', 'activate')).toEqual([]);
  });
  it('review of edh-next-143 (CR 601.2a): a spell cast from that player\'s hand was not cast from YOUR hand ("if you cast it from your hand" is false)', () => {
    const IDOL = card('Test Idol', 'Creature — Spirit', 'This creature enters with a divinity counter on it if you cast it from your hand.', '{0}', ['2', '2']);
    const s0 = scenario([], { defs: [...defs, IDOL], p1: { battlefield: ['Test Trio'], hand: ['Test Idol'] }, p2: { hand: ['Test Idol'] } });
    let s = use(s0);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: inHand(s, 'p2', 'Test Idol') })));
    s = resolveAll(cast(s, 'Test Idol'));
    const idols = named(s, 'Test Idol');
    const theirs = idols.find((id) => s.objects[id]!.owner === 'p2')!;
    const mine = idols.find((id) => s.objects[id]!.owner === 'p1')!;
    expect(s.objects[theirs]!.controller).toBe('p1');
    expect(s.objects[theirs]!.counters?.divinity ?? 0).toBe(0);
    expect(s.objects[mine]!.counters?.divinity).toBe(1);
  });
  it('review of edh-next-143 (CR 601.2a, 305.1): before it is cast and as a land played, a card of that player\'s hand is from "another player\'s hand" (castOriginOf with the caster)', () => {
    const s1 = use(board());
    const bear = s1.objects[inHand(s1, 'p2', 'Test Bear')]!;
    expect(castOriginOf(bear, 'p1')).toBe('otherHand');
    expect(castOriginOf(bear, 'p2')).toBe('hand');
    expect(spellActor(bear, 'p1')).toEqual({ kind: 'spell', castFrom: 'otherHand' });
  });
  it('negative (CR 611.2a, 514.2): next turn the permission and the bans are gone', () => {
    const s1 = use(board());
    const s = advanceTo(s1, s1.turn.number + 1, 'main1');
    expect(legal(s, 'p1', 'cast').some((a) => s.zones.hand.p2!.includes((a.action as { card?: string }).card ?? ''))).toBe(false);
    expect(legal(s, 'p2', 'activate').length).toBeGreaterThan(0);
  });
});

// ---- Warp World ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 101.4, 701.24a, 701.20a, 608.2c, 303.4f, 111.7: "Each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. Each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed this way that weren\'t put onto the battlefield on the bottom of their library." (Warp World; rulings 2009-10-01)', () => {
  const WARP = card('Test Warp', 'Sorcery', 'Each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. Each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed this way that weren\'t put onto the battlefield on the bottom of their library.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
  const GLOW = card('Test Glow', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', '{W}');
  const RELIC = card('Test Relic', 'Artifact', '', '{1}');
  const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to any target.', '{R}');
  const MAKER = card('Test Maker', 'Sorcery', 'Create a 1/1 white Soldier creature token.', '{0}');
  const defs = [WARP, BEAR, GLOW, RELIC, BOLT, MAKER];
  const names = (s: GameState, z: 'library' | 'graveyard', p: string): string[] => s.zones[z][p]!.map((id) => s.objects[id]!.defId).sort();
  const bfOf = (s: GameState, p: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.owner === p).map((id) => s.objects[id]!.defId).sort();
  it('is full', () => expect(full(WARP)).toBe(true));
  it('each player reveals as many cards as permanents they owned (a token counts, CR 111.7, ruling 2009-10-01); permanents come back, an Aura after the creature it may enchant, the rest goes to the bottom', () => {
    // p1 owns three permanents and a token; p2 two. Libraries hold only what the rulings test: p1 an instant and an Aura, p2 an artifact.
    let s0 = scenario([], { defs, p1: { hand: ['Test Maker', 'Test Warp'], battlefield: ['Plains', 'Test Bear', 'Plains'], library: ['Test Glow', 'Test Bolt'] }, p2: { battlefield: ['Plains', 'Plains'], library: ['Test Relic'] } });
    for (const p of ['p1', 'p2']) { // only the cards named above in each library (the scenario adds Plains)
      const keep = s0.zones.library[p]!.filter((id) => s0.objects[id]!.defId !== 'Plains');
      for (const id of s0.zones.library[p]!) if (!keep.includes(id)) delete s0.objects[id];
      s0.zones.library[p] = keep;
    }
    s0 = resolveAll(cast(s0, 'Test Maker'));
    expect(s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p1').length).toBe(4);
    const s = resolveAll(cast(s0, 'Test Warp'));
    const revealed = (who: string): number => (s.log.find((l) => l.text.startsWith(`${who} reveals `))?.text.split(',').length ?? 0);
    expect(revealed('Alice')).toBe(4); // three cards and the token she owned
    expect(revealed('Bob')).toBe(2);
    // p1: four permanents counted, five cards in the library after the shuffle (the token is no card): four of {Plains, Plains, Bear, Glow, Bolt} revealed
    const p1bf = bfOf(s, 'p1');
    const p1lib = names(s, 'library', 'p1');
    expect([...p1bf, ...p1lib].sort()).toEqual(['Plains', 'Plains', 'Test Bear', 'Test Bolt', 'Test Glow']);
    expect(p1bf.every((n) => n !== 'Test Bolt')).toBe(true); // an instant never enters
    expect(p1lib.length).toBe(5 - p1bf.length); // four revealed (the bolt, if revealed, at the bottom), one never revealed
    expect(p1bf.length).toBeGreaterThanOrEqual(3);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token')).toBe(false); // the token is gone (CR 111.7)
    // p2: two permanents counted, three cards: two revealed; every revealed land and artifact entered
    expect([...bfOf(s, 'p2'), ...names(s, 'library', 'p2')].sort()).toEqual(['Plains', 'Plains', 'Test Relic']);
    expect(bfOf(s, 'p2').length).toBe(2);
    // an Aura that entered is attached to a creature (it entered after the creatures, ruling 2009-10-01), or stayed in the library when no creature came back
    const glow = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Glow');
    if (glow !== undefined) expect(s.objects[s.objects[glow]!.attachedTo!]!.defId).toBe('Test Bear');
  });
});

// ---- Leonin Arbiter -------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 116.2d, 701.23a, 101.2: "Players can\'t search libraries. Any player may pay {2} for that player to ignore this effect until end of turn." (Leonin Arbiter; rulings 2011-01-01)', () => {
  const ARBITER = card('Test Arbiter', 'Creature — Cat Cleric', 'Players can\'t search libraries. Any player may pay {2} for that player to ignore this effect until end of turn.', '{1}{W}', ['2', '2']);
  const TUTOR = card('Test Tutor', 'Sorcery', 'Search your library for a land card, reveal it, put it into your hand, then shuffle.', '{0}');
  const WOOD = card('Test Wood', 'Land', '');
  const defs = [ARBITER, TUTOR, WOOD];
  const board = (arbiters = 1): GameState => scenario([], { defs, p1: { hand: ['Test Tutor'], battlefield: [...Array(arbiters).fill('Test Arbiter'), 'Plains', 'Plains', 'Plains', 'Plains'], library: ['Plains', 'Test Wood'] }, p2: { battlefield: ['Plains', 'Plains'] } });
  const ignoreActions = (s: GameState, p: string) => legal(s, p, 'special').filter((a) => (a.action as { kind?: string }).kind === 'ignoreEffect');
  const woodInHand = (s: GameState): boolean => s.zones.hand.p1!.some((id) => s.objects[id]!.defId === 'Test Wood');
  const tutor = (s0: GameState): GameState => resolveAll(cast(s0, 'Test Tutor'), { objects: [s0.zones.library.p1!.filter((id) => s0.objects[id]!.defId === 'Test Wood')] });
  it('is full', () => expect(full(ARBITER)).toBe(true));
  it('ruling 2011-01-01: a player who has not paid finds nothing (the search is not done) but still shuffles', () => {
    const s = tutor(board());
    expect(woodInHand(s)).toBe(false);
    expect(s.log.some((l) => /shuffles/.test(l.text))).toBe(true);
  });
  it('CR 116.2d: paying {2} is a special action; that player then searches as usual for the rest of the turn', () => {
    const s0 = board();
    const acts = ignoreActions(s0, 'p1');
    expect(acts.length).toBe(1);
    const s1 = drive(act(s0, acts[0]!.action));
    expect(s1.zones.stack.length).toBe(0); // no stack (CR 116.1)
    expect(ignoreActions(s1, 'p1')).toEqual([]); // already paid this turn
    expect((s1.ignoredEffects ?? []).map((x) => x.player)).toEqual(['p1']); // ruling: paying enables only the player who paid
    expect(woodInHand(tutor(s1))).toBe(true);
  });
  it('ruling 2011-01-01: with two Arbiters a player must pay for each one before searching', () => {
    const s0 = board(2);
    expect(ignoreActions(s0, 'p1').length).toBe(2);
    const s1 = drive(act(s0, ignoreActions(s0, 'p1')[0]!.action));
    expect(woodInHand(tutor(s1))).toBe(false);
    const s2 = drive(act(s1, ignoreActions(s1, 'p1')[0]!.action));
    expect(woodInHand(tutor(s2))).toBe(true);
  });
  it('negative (CR 116.2d "until end of turn"): the payment does not last into the next turn', () => {
    const s1 = drive(act(board(), ignoreActions(board(), 'p1')[0]!.action));
    const s = advanceTo(s1, s1.turn.number + 2, 'main1');
    expect(ignoreActions(s, 'p1').length).toBe(1);
  });
});

// ---- Voracious Bibliophile ------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 115.9a, 603.2, 608.2h: "Whenever you cast a spell with one or more targets, draw that many cards." (Voracious Bibliophile)', () => {
  const BOOK = card('Test Bookworm', 'Creature — Dragon', 'Flying, vigilance\nWhenever you cast a spell with one or more targets, draw that many cards.', '{3}{U}{U}', ['4', '4']);
  const TWIN = card('Test Twin Boost', 'Instant', 'Two target creatures each get +1/+1 until end of turn.', '{0}');
  const ONE = card('Test Boost', 'Instant', 'Target creature gets +1/+1 until end of turn.', '{0}');
  const NONE = card('Test Peek', 'Instant', 'Draw a card.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [BOOK, TWIN, ONE, NONE, BEAR];
  const board = (spell: string): GameState => scenario([], { defs, p1: { hand: [spell], battlefield: ['Test Bookworm', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  const hand = (s: GameState): number => s.zones.hand.p1!.length;
  it('is full', () => expect(full(BOOK)).toBe(true));
  it('a spell with two targets draws two cards; with one target, one', () => {
    const s0 = board('Test Twin Boost');
    const bears = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Bear');
    const s = resolveAll(cast(s0, 'Test Twin Boost', { targets: [[{ kind: 'object', id: bears[0]! }, { kind: 'object', id: bears[1]! }]] }));
    expect(hand(s)).toBe(2);
    const t0 = board('Test Boost');
    const t = resolveAll(cast(t0, 'Test Boost', { targets: [[{ kind: 'object', id: t0.zones.battlefield.find((id) => t0.objects[id]!.defId === 'Test Bear')! }]] }));
    expect(hand(t)).toBe(1);
  });
  it('negative (CR 603.2): a spell with no targets does not trigger', () => {
    const s = resolveAll(cast(board('Test Peek'), 'Test Peek'));
    expect(hand(s)).toBe(1); // the spell's own draw only
  });
});

// ---- Once Upon a Time -------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 118.9, 601.2b, 601.2i: "If this spell is the first spell you\'ve cast this game, you may cast it without paying its mana cost." (Once Upon a Time; ruling 2019-10-04)', () => {
  const ONCE = card('Test Fable', 'Instant', 'If this spell is the first spell you\'ve cast this game, you may cast it without paying its mana cost.\nLook at the top five cards of your library. You may reveal a creature or land card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', '{1}{G}');
  const PEEK = card('Test Peek', 'Instant', 'Draw a card.', '{0}');
  const defs = [ONCE, PEEK];
  const altOf = (s: GameState): string[] => legal(s, 'p1', 'cast').filter((a) => (a.action as { method?: string }).method !== undefined).map((a) => (a.action as { method: string }).method);
  it('is full', () => expect(full(ONCE)).toBe(true));
  it('as the first spell of the game it may be cast for nothing (no lands needed)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Fable', 'Test Peek'] } });
    expect(altOf(s0).length).toBeGreaterThan(0);
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fable', 'hand', 'p1'), method: altOf(s0)[0]! })));
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Fable')).toBe(true);
  });
  it('negative (CR 601.2i): after another spell was cast this game, the free cast is not offered', () => {
    const s0 = resolveAll(cast(scenario([], { defs, p1: { hand: ['Test Fable', 'Test Peek'] } }), 'Test Peek'));
    expect(altOf(s0)).toEqual([]);
    expect(() => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fable', 'hand', 'p1'), method: 'alternative' })).toThrow();
  });
  it('negative: an opponent\'s earlier spell does not count ("you\'ve cast")', () => {
    let s0 = scenario([], { defs, p1: { hand: ['Test Fable'] }, p2: { hand: ['Test Peek'] } });
    s0 = act(s0, { type: 'pass', player: 'p1' });
    s0 = resolveAll(drive(act(s0, { type: 'cast', player: 'p2', card: find(s0, 'Test Peek', 'hand', 'p2') })));
    expect(s0.pending?.player).toBe('p1');
    expect(altOf(s0).length).toBeGreaterThan(0);
  });
});

// ---- Atemsis, All-Seeing ------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.20a, 202.3, 104.3e, 608.2c: "Whenever ~ deals damage to an opponent, you may reveal your hand. If cards with at least six different mana values are revealed this way, that player loses the game." (Atemsis, All-Seeing; rulings 2019-07-12)', () => {
  const SEER = card('Test Seer', 'Legendary Creature — Sphinx', '{0}: ~ deals 1 damage to target player.\nWhenever ~ deals damage to an opponent, you may reveal your hand. If cards with at least six different mana values are revealed this way, that player loses the game.', '{3}{U}{U}{U}', ['4', '5']);
  const mv = (n: number): CardDef => card(`Test Card ${n}`, 'Sorcery', 'Draw a card.', n === 0 ? '' : `{${n}}`);
  const XSPELL = card('Test Card X', 'Sorcery', 'Draw X cards.', '{X}'); // mana value 0 in a hand (X is 0)
  const CARDS = [0, 1, 2, 3, 4, 5].map(mv);
  const defs = [SEER, XSPELL, ...CARDS];
  const hit = (hand: string[], yes: boolean): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Seer'], hand } });
    const a = activations(s0, 'Test Seer')[0]!;
    return resolveAll(drive(act(s0, a.action), { targets: [[{ kind: 'player', id: 'p2' }]] }), { yes: [yes] });
  };
  it('is full', () => expect(full(SEER)).toBe(true));
  it('six different mana values (0 to 5, a card with no mana cost counts as 0) revealed: the damaged opponent loses the game', () => {
    const s = hit(CARDS.map((c) => c.name), true);
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(true);
  });
  it('negative: only five different mana values (X is 0 in the hand, ruling 2019-07-12; a duplicate counts once) do not make them lose', () => {
    const s = hit(['Test Card 0', 'Test Card 1', 'Test Card 2', 'Test Card 3', 'Test Card 4', 'Test Card X'], true);
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(false);
  });
  it('negative: declining to reveal reveals nothing; nobody loses', () => {
    const s = hit(CARDS.map((c) => c.name), false);
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(false);
  });
});

describe('CR 608.2d, 119.3: "For each player, choose friend or foe. Each friend gains 3 life. Each foe loses 2 life." (the life changes of the template examples, each player of the group)', () => {
  const PACT = card('Test Pact', 'Sorcery', 'For each player, choose friend or foe. Each friend gains 3 life. Each foe loses 2 life.', '{0}');
  it('each friend gains, each foe loses; nobody else', () => {
    const s0 = mpScenario({ defs: [PACT], zones: { p1: { hand: ['Test Pact'] } } });
    const s = resolveFriendOrFoe(mpAct(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pact', 'hand', 'p1') }), { Alice: 'friend', Bob: 'foe', Carol: 'friend', Dan: 'foe' });
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => mpLife(s, p))).toEqual([23, 18, 23, 18]);
  });
});
