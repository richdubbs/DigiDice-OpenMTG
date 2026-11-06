/**
 * Commander EDHREC ranks 21,501-22,000, round edh-c-103 (third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 118.12, 118.3, 608.2c     "Counter target black spell unless that spell's controller pays {B} or {3}." (a choice between two payments)
 *   CR 107.3a, 602.2b, 118.12    "{2}, Reveal X blue cards from your hand, Sacrifice ~: Counter target spell unless its controller pays {X}."
 *   CR 601.2c, 601.7, 503.1      "At the beginning of each player's upkeep, destroy target nonartifact creature that player controls of their choice. It can't be regenerated."
 *   CR 303.4, 508.1, 603.4       "Whenever ~ attacks, if it's enchanted, exile target permanent."
 *   CR 701.20a, 608.2c, 120.3    "... until you reveal an artifact card. ... ~ deals damage to you equal to the number of cards revealed this way."
 *   CR 608.2c, 608.2h, 400.7     "Return target card ... to your hand. If you return a nonland card to your hand this way, ~ deals damage equal to that card's mana value to any target. Exile ~."
 *   CR 701.21a, 608.2c, 101.4    "that player sacrifices a creature of their choice. If the player can't, sacrifice ~."
 *   CR 404.1, 406.1, 701.13a     "Exile all creatures and graveyards."
 */
import { describe, expect, it } from 'vitest';
import { act, advanceTo, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/index';
import type { GameState, ObjectId } from '../../../src/index';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';
import { compileCard, type OracleCard } from '../../../src/index';
import { card, cast, full, pt, resolveAll, settle } from '../cmd3/helpers';

/** A card with printed colors (the helper `card` makes colorless cards). */
const colored = (name: string, mana: string, type: string, text: string, colors: string[], ptv?: [string, string]) =>
  compileCard({ name, layout: 'normal', mana_cost: mana, type_line: type, oracle_text: text, colors, ...(ptv ? { power: ptv[0], toughness: ptv[1] } : {}) } as OracleCard);

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const onBf = (s: GameState, defId: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const inGy = (s: GameState, defId: string, p: string): boolean => s.zones.graveyard[p]!.some((id) => s.objects[id]!.defId === defId);
/** Declare `id` as an attacker and resolve what its attack trigger does, choosing `target` for it. */
const declareAttack = (s0: GameState, id: ObjectId, target: ObjectId): GameState => {
  const s = settle(declareAttackers(toDeclareAttackers(s0), [[id]]), { targets: [{ kind: 'object', id: target }] });
  return resolveAll(s, { targets: [{ kind: 'object', id: target }] });
};
const inExile = (s: GameState, defId: string): boolean => s.zones.exile.some((id) => s.objects[id]!.defId === defId);

describe('CR 118.12, 118.3: "Counter target black spell unless that spell\'s controller pays {B} or {3}."', () => {
  const WIZ = card('Test Hexing Thrull', 'Creature — Thrull Wizard', "{1}{B}: Counter target black spell unless that spell's controller pays {B} or {3}.", ['2', '2']);
  const DARK = colored('Test Dark Bolt', '{B}', 'Instant', 'Test Dark Bolt deals 2 damage to any target.', ['B']);
  const RED = colored('Test Red Bolt', '{R}', 'Instant', 'Test Red Bolt deals 2 damage to any target.', ['R']);
  /** p1 casts the spell (paying with one of `lands`), p2 holds the Thrull and answers with its ability. */
  const respond = (spell: string, lands: string[]): GameState => {
    const s0 = scenario(['Swamp', 'Mountain'], { defs: [WIZ, DARK, RED], p1: { hand: [spell], battlefield: lands }, p2: { battlefield: ['Test Hexing Thrull', 'Swamp', 'Swamp'] } });
    const s1 = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, spell, 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] });
    return pass(s1);
  };
  const activate = (s: GameState): GameState => settle(act(s, { type: 'activate', player: 'p2', source: find(s, 'Test Hexing Thrull', 'battlefield', 'p2'), ability: 'p:0:0' }), { targets: [{ kind: 'object', id: s.zones.stack[0]! }] });
  it('is full', () => expect(full(WIZ)).toBe(true));
  it('the spell\'s controller may pay {B}: the spell resolves', () => {
    const s = resolveAll(activate(respond('Test Dark Bolt', ['Swamp', 'Swamp'])), { yes: true });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(inGy(s, 'Test Dark Bolt', 'p1')).toBe(true);
  });
  it('the spell\'s controller may pay {3} instead: three other lands let it resolve', () => {
    const s = resolveAll(activate(respond('Test Dark Bolt', ['Swamp', 'Mountain', 'Mountain', 'Mountain'])), { yes: true });
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('declining the payment counters the spell: no damage', () => {
    const s = resolveAll(activate(respond('Test Dark Bolt', ['Swamp', 'Swamp'])), { yes: false });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(inGy(s, 'Test Dark Bolt', 'p1')).toBe(true); // countered: into the graveyard
  });
  it('negative: a controller who cannot pay either cost (no mana left) loses the spell', () => {
    const s = resolveAll(activate(respond('Test Dark Bolt', ['Swamp'])), { yes: true });
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: a spell that is not black cannot be targeted', () => {
    const s0 = respond('Test Red Bolt', ['Mountain', 'Mountain']);
    expect(() => activate(s0)).toThrow();
  });
});

describe('CR 107.3a, 602.2b, 118.12: "{2}, Reveal X blue cards from your hand, Sacrifice ~: Counter target spell unless its controller pays {X}."', () => {
  const MAR = colored('Test Frost Martyr', '{U}', 'Creature — Human Wizard', '{2}, Reveal X blue cards from your hand, Sacrifice this creature: Counter target spell unless its controller pays {X}.', ['U'], ['1', '1']);
  const BLUE = colored('Test Blue Card', '{U}', 'Sorcery', 'You gain 1 life.', ['U']);
  const RED_CARD = colored('Test Red Card', '{R}', 'Sorcery', 'You gain 1 life.', ['R']);
  const RED = colored('Test Red Bolt', '{R}', 'Instant', 'Test Red Bolt deals 2 damage to any target.', ['R']);
  /** p2 casts the bolt at p1; p1 holds the Martyr and `hand` in hand. Returns the state with p1's activation asking for X. */
  const started = (hand: string[], opponentLands = 4): GameState => {
    const s0 = scenario(['Island', 'Mountain'], { defs: [MAR, BLUE, RED_CARD, RED], p2: { hand: ['Test Red Bolt'], battlefield: Array(opponentLands).fill('Mountain') as string[] }, p1: { hand, battlefield: ['Test Frost Martyr', 'Island', 'Island'] } });
    let s = pass(s0);
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Red Bolt', 'hand', 'p2') }), { targets: [{ kind: 'player', id: 'p1' }] });
    s = pass(s);
    return act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Frost Martyr', 'battlefield', 'p1'), ability: 'p:0:0' });
  };
  const withX = (s: GameState, x: number): GameState => settle(answer(s, { kind: 'chooseNumber', n: x }), { targets: [{ kind: 'object', id: s.zones.stack[0]! }] });
  it('is full', () => expect(full(MAR)).toBe(true));
  it('X is chosen as the ability is activated: up to the blue cards in hand (negative: red cards do not count)', () => {
    const s = started(['Test Blue Card', 'Test Blue Card', 'Test Red Card']);
    expect(s.pending?.kind).toBe('chooseNumber');
    expect((s.pending as unknown as { max: number }).max).toBe(2);
  });
  it('the controller of the countered spell may pay {X} (X = 2) and the spell resolves', () => {
    const s = resolveAll(withX(started(['Test Blue Card', 'Test Blue Card']), 2), { yes: true });
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(onBf(s, 'Test Frost Martyr').length).toBe(0); // sacrificed as a cost
  });
  it('declining to pay counters the spell', () => {
    const s = resolveAll(withX(started(['Test Blue Card', 'Test Blue Card']), 2), { yes: false });
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('negative: a controller without {X} available cannot keep the spell (X = 2, only one land left)', () => {
    const s = resolveAll(withX(started(['Test Blue Card', 'Test Blue Card'], 2), 2), { yes: true });
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 601.2c, 601.7, 503.1: "At the beginning of each player\'s upkeep, destroy target nonartifact creature that player controls of their choice. It can\'t be regenerated."', () => {
  const ABYSS = card('Test Cruel Abyss', 'World Enchantment', "At the beginning of each player's upkeep, destroy target nonartifact creature that player controls of their choice. It can't be regenerated.");
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  const OGRE2 = card('Test Ogre Two', 'Creature — Ogre', '', ['3', '3']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['3', '3']);
  const board = (): GameState => scenario([], { defs: [ABYSS, OGRE, OGRE2, GOLEM], p1: { battlefield: ['Test Cruel Abyss', 'Test Ogre'] }, p2: { battlefield: ['Test Ogre', 'Test Ogre Two', 'Test Golem'] } });
  it('is full', () => expect(full(ABYSS)).toBe(true));
  it('the player whose upkeep it is chooses (not the Abyss\'s controller), among their own nonartifact creatures only', () => {
    const s = advanceTo(board(), 2, 'upkeep');
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(s.pending?.player).toBe('p2');
    const d = s.pending as unknown as { objects: ObjectId[] };
    expect(d.objects.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Ogre', 'Test Ogre Two']); // not the Golem (an artifact), not p1\'s Ogre
    expect(d.objects.every((id) => s.objects[id]!.controller === 'p2')).toBe(true);
  });
  it('destroys the creature that player picked; the others stay', () => {
    const s0 = advanceTo(board(), 2, 'upkeep');
    const pick = (s0.pending as unknown as { objects: ObjectId[] }).objects.find((id) => s0.objects[id]!.defId === 'Test Ogre Two')!;
    const s = resolveAll(s0, { targets: [{ kind: 'object', id: pick }] });
    expect(inGy(s, 'Test Ogre Two', 'p2')).toBe(true);
    expect(onBf(s, 'Test Ogre', 'p2').length).toBe(1);
    expect(onBf(s, 'Test Golem', 'p2').length).toBe(1);
    expect(onBf(s, 'Test Ogre', 'p1').length).toBe(1);
  });
  it('on the Abyss controller\'s own upkeep, the controller chooses among their creatures', () => {
    const first = advanceTo(board(), 2, 'upkeep');
    const s0 = advanceTo(resolveAll(first, { targets: [{ kind: 'object', id: (first.pending as unknown as { objects: ObjectId[] }).objects[0]! }] }), 3, 'upkeep'); // (p2's upkeep first)
    expect(s0.pending?.kind).toBe('chooseTargets');
    expect(s0.pending?.player).toBe('p1');
  });
  it('negative: a player with only an artifact creature loses nothing (no legal target)', () => {
    const s0 = scenario([], { defs: [ABYSS, GOLEM], p1: { battlefield: ['Test Cruel Abyss'] }, p2: { battlefield: ['Test Golem'] } });
    const s = resolveAll(advanceTo(s0, 2, 'upkeep'));
    expect(onBf(s, 'Test Golem', 'p2').length).toBe(1);
  });
});

describe('CR 303.4, 508.1, 603.4: "Whenever ~ attacks, if it\'s enchanted, exile target permanent."', () => {
  const ARCH = card('Test Winged Archon', 'Legendary Creature — Archon', "Flying, vigilance\nWhenever Test Winged Archon attacks, if it's enchanted, exile target permanent.", ['5', '5']);
  const AURA = card('Test Mild Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
  const TARGET = card('Test Wall', 'Creature — Wall', '', ['0', '4']);
  const attack = (aura: boolean): GameState => {
    const s0 = scenario([], { defs: [ARCH, AURA, TARGET], p1: { battlefield: ['Test Winged Archon'], hand: aura ? ['Test Mild Aura'] : [] }, p2: { battlefield: ['Test Wall'] } });
    let s = s0;
    if (aura) s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mild Aura', 'hand', 'p1') }), { targets: [{ kind: 'object', id: find(s, 'Test Winged Archon', 'battlefield', 'p1') }] }));
    const id = find(s, 'Test Winged Archon', 'battlefield', 'p1');
    return declareAttack(s, id, find(s, 'Test Wall', 'battlefield', 'p2'));
  };
  it('is full', () => expect(full(ARCH)).toBe(true));
  it('enchanted: the trigger exiles the target permanent', () => {
    const s = attack(true);
    expect(inExile(s, 'Test Wall')).toBe(true);
  });
  it('negative: not enchanted, nothing is exiled', () => {
    const s = attack(false);
    expect(inExile(s, 'Test Wall')).toBe(false);
    expect(onBf(s, 'Test Wall').length).toBe(1);
  });
});

describe('CR 701.20a, 608.2c, 120.3: "Reveal cards from the top of your library until you reveal an artifact card. Put that card onto the battlefield and the rest on the bottom of your library in a random order. ~ deals damage to you equal to the number of cards revealed this way."', () => {
  const EXPERIMENT = card('Test Wild Experiment', 'Sorcery', 'Reveal cards from the top of your library until you reveal an artifact card. Put that card onto the battlefield and the rest on the bottom of your library in a random order. Test Wild Experiment deals damage to you equal to the number of cards revealed this way.');
  const GEM = card('Test Gem', 'Artifact', '');
  const DUD = card('Test Dud', 'Sorcery', 'You gain 1 life.');
  const start = (library: string[]): GameState => scenario([], { defs: [EXPERIMENT, GEM, DUD], p1: { hand: ['Test Wild Experiment'], library } });
  it('is full', () => expect(full(EXPERIMENT)).toBe(true));
  it('reveals until the artifact (here the 4th card), puts it onto the battlefield, the three others at the bottom, and deals damage equal to ALL the revealed cards (4)', () => {
    const s0 = start(['Test Dud', 'Test Dud', 'Test Dud', 'Test Gem', 'Test Dud']);
    const s = resolveAll(cast(s0, 'Test Wild Experiment'));
    expect(onBf(s, 'Test Gem', 'p1').length).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(16);
    const lib = s.zones.library['p1']!.map((id) => s.objects[id]!.defId);
    expect(lib.slice(-3)).toEqual(['Test Dud', 'Test Dud', 'Test Dud']); // the revealed cards that were not put onto the battlefield are at the bottom
    expect(lib[0]).toBe('Test Dud'); // the fifth card is now the top card
    expect(lib.length).toBe(s0.zones.library['p1']!.length - 1);
  });
  it('the count is of the cards revealed: an artifact on top means 1 damage', () => {
    const s = resolveAll(cast(start(['Test Gem', 'Test Dud']), 'Test Wild Experiment'));
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(onBf(s, 'Test Gem', 'p1').length).toBe(1);
  });
  it('negative: an opponent is not hurt, and a library with no artifact is revealed whole with damage equal to its size', () => {
    const s = resolveAll(cast(start([]), 'Test Wild Experiment'));
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(onBf(s, 'Test Gem').length).toBe(0);
    expect(lifeOf(s, 'p1')).toBe(0); // 20 Plains revealed: 20 damage
  });
});

describe('CR 608.2c, 608.2h, 400.7: "Return target card from your graveyard to your hand. If you return a nonland card to your hand this way, ~ deals damage equal to that card\'s mana value to any target. Exile ~."', () => {
  const REBIRTH = card('Test Fiery Return', 'Sorcery', "Return target card from your graveyard to your hand. If you return a nonland card to your hand this way, Test Fiery Return deals damage equal to that card's mana value to any target. Exile Test Fiery Return.");
  const BIG = card('Test Big Thing', 'Creature — Giant', '', ['4', '4'], '{3}{R}');
  const cast2 = (target: string): GameState => {
    const s0 = scenario([], { defs: [REBIRTH, BIG], p1: { hand: ['Test Fiery Return'], graveyard: [target] } });
    const t0 = find(s0, target, 'graveyard', 'p1');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fiery Return', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: t0 }] }); // the first target: the card of the graveyard
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }); // the second target: any target
    return resolveAll(s);
  };
  it('is full', () => expect(full(REBIRTH)).toBe(true));
  it('a nonland card returned: damage equal to its mana value (4) to the chosen target', () => {
    const s = cast2('Test Big Thing');
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Big Thing')).toBe(true);
    expect(lifeOf(s, 'p2')).toBe(16);
  });
  it('the spell is exiled, not put into the graveyard', () => {
    const s = cast2('Test Big Thing');
    expect(inExile(s, 'Test Fiery Return')).toBe(true);
    expect(inGy(s, 'Test Fiery Return', 'p1')).toBe(false);
  });
  it('negative: a land card returned deals no damage', () => {
    const s = cast2('Plains');
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Plains')).toBe(true);
  });
});

describe('CR 701.21a, 608.2c, 101.4: "At the beginning of each player\'s upkeep, that player sacrifices a creature of their choice. If the player can\'t, sacrifice ~."', () => {
  const DEMON = card('Test Woe Demon', 'Creature — Demon', "Flying\nAt the beginning of each player's upkeep, that player sacrifices a creature of their choice. If the player can't, sacrifice Test Woe Demon.", ['6', '6']);
  const IMP = card('Test Imp', 'Creature — Imp', '', ['1', '1']);
  it('is full', () => expect(full(DEMON)).toBe(true));
  it('a player with a creature sacrifices it (their choice) and the Demon stays', () => {
    const s0 = scenario([], { defs: [DEMON, IMP], p1: { battlefield: ['Test Woe Demon'] }, p2: { battlefield: ['Test Imp'] } });
    const s = resolveAll(advanceTo(s0, 2, 'upkeep'));
    expect(inGy(s, 'Test Imp', 'p2')).toBe(true);
    expect(onBf(s, 'Test Woe Demon').length).toBe(1);
  });
  it('a player who controls no creature cannot: the Demon is sacrificed', () => {
    const s0 = scenario([], { defs: [DEMON, IMP], p1: { battlefield: ['Test Woe Demon'] }, p2: { battlefield: [] } });
    const s = resolveAll(advanceTo(s0, 2, 'upkeep'));
    expect(onBf(s, 'Test Woe Demon').length).toBe(0);
    expect(inGy(s, 'Test Woe Demon', 'p1')).toBe(true);
  });
  it('on its controller\'s own upkeep the Demon\'s controller is the one asked: the Demon or the Imp may be chosen', () => {
    const s0 = scenario([], { defs: [DEMON, IMP], p1: { battlefield: ['Test Woe Demon', 'Test Imp'] }, p2: { battlefield: ['Test Imp'] } });
    const p2up = resolveAll(advanceTo(s0, 2, 'upkeep')); // p2 sacrifices its Imp
    const s = pass(pass(advanceTo(p2up, 3, 'upkeep'))); // both players pass: the trigger resolves
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending?.player).toBe('p1');
    const options = (s.pending as unknown as { options: ObjectId[] }).options.map((id) => s.objects[id]!.defId).sort();
    expect(options).toEqual(['Test Imp', 'Test Woe Demon']);
  });
});

describe('CR 404.1, 406.1, 701.13a: "Exile all creatures and graveyards. Put ~ on the bottom of its owner\'s library."', () => {
  const NULL = card('Test Great Nullifier', 'Sorcery', 'As an additional cost to cast this spell, sacrifice a legendary creature.\nExile all creatures and graveyards. Put Test Great Nullifier on the bottom of its owner\'s library.');
  const KING = card('Test King', 'Legendary Creature — Human', '', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const ROCK = card('Test Rock', 'Artifact', '');
  const board = (): GameState => scenario([], {
    defs: [NULL, KING, BEAR, ROCK],
    p1: { hand: ['Test Great Nullifier', 'Test Bear'], battlefield: ['Test King', 'Test Bear', 'Test Rock'], graveyard: ['Test Bear', 'Test Rock'], library: ['Test Bear'] },
    p2: { battlefield: ['Test Bear', 'Test Rock'], graveyard: ['Test Rock'], hand: ['Test Bear'] },
  });
  it('is full', () => expect(full(NULL)).toBe(true));
  it('exiles every creature on the battlefield and every card in every graveyard (the cost creature was already sacrificed)', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Great Nullifier', { objects: [find(s0, 'Test King', 'battlefield', 'p1')] }));
    expect(onBf(s, 'Test Bear').length).toBe(0);
    expect(s.zones.graveyard['p1']!.length).toBe(0);
    expect(s.zones.graveyard['p2']!.length).toBe(0);
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Bear').length).toBe(3); // the two on the battlefield and the one in a graveyard
    expect(inExile(s, 'Test King')).toBe(true); // the sacrificed legendary creature went to the graveyard as a cost, then was exiled with the graveyards
  });
  it('negative: noncreature permanents, cards in hands and libraries stay', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Great Nullifier', { objects: [find(s0, 'Test King', 'battlefield', 'p1')] }));
    expect(onBf(s, 'Test Rock').length).toBe(2);
    expect(s.zones.hand['p2']!.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
  });
  it('the spell itself ends on the bottom of its owner\'s library, not in a graveyard or exile', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Great Nullifier', { objects: [find(s0, 'Test King', 'battlefield', 'p1')] }));
    expect(s.zones.library['p1']!.map((id) => s.objects[id]!.defId).pop()).toBe('Test Great Nullifier');
    expect(inExile(s, 'Test Great Nullifier')).toBe(false);
  });
});

describe('CR 602.2, 602.2a, 602.5d: "{3}: Destroy this Aura. Only your opponents may activate this ability and only as a sorcery."', () => {
  const VORTEX = card('Test Binding Vortex', 'Enchantment — Aura', "Enchant nonland permanent\nEnchanted permanent can't attack or block, and its activated abilities can't be activated.\n{3}: Destroy this Aura. Only your opponents may activate this ability and only as a sorcery.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const start = (): GameState => {
    const s0 = scenario([], { defs: [VORTEX, BEAR], p1: { hand: ['Test Binding Vortex'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Bear', 'Plains', 'Plains', 'Plains'] } });
    return resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Binding Vortex', 'hand', 'p1') }), { targets: [{ kind: 'object', id: find(s0, 'Test Bear', 'battlefield', 'p2') }] }));
  };
  const abilityOf = (s: GameState): ObjectId => find(s, 'Test Binding Vortex', 'battlefield', 'p1');
  it('is full', () => expect(full(VORTEX)).toBe(true));
  it('its controller cannot activate it (negative)', () => {
    const s = start();
    expect(() => act(s, { type: 'activate', player: 'p1', source: abilityOf(s), ability: 'p:0:2' })).toThrow();
  });
  it('an opponent of its controller can, at sorcery speed (their own main phase with an empty stack), and the Aura is destroyed', () => {
    const s0 = advanceTo(start(), 2, 'main1'); // p2's turn
    const s1 = settle(act(s0, { type: 'activate', player: 'p2', source: abilityOf(s0), ability: 'p:0:2' }));
    const s = resolveAll(s1);
    expect(inGy(s, 'Test Binding Vortex', 'p1')).toBe(true);
    expect(onBf(s, 'Test Binding Vortex').length).toBe(0);
  });
  it('negative: an opponent cannot activate it at instant speed (during their own upkeep, or on the controller\'s turn)', () => {
    const s = start(); // p1's turn, main phase: p2 holds no priority at sorcery speed
    expect(() => act(s, { type: 'activate', player: 'p2', source: abilityOf(s), ability: 'p:0:2' })).toThrow();
  });
});

describe('CR 303.4, 604.1, 611.3a: "This creature has flying as long as it\'s enchanted."', () => {
  const OSPREY = card('Test Fledgling', 'Creature — Bird', "This creature has flying as long as it's enchanted.", ['1', '1']);
  const AURA = card('Test Mild Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
  it('is full', () => expect(full(OSPREY)).toBe(true));
  it('has flying only while an Aura is attached', () => {
    const s0 = scenario([], { defs: [OSPREY, AURA], p1: { battlefield: ['Test Fledgling'], hand: ['Test Mild Aura'] } });
    const bird = find(s0, 'Test Fledgling', 'battlefield', 'p1');
    const kw = (s: GameState): boolean => (getChars(s, bird)!.keywords ?? []).some((k: unknown) => JSON.stringify(k).includes('flying'));
    expect(kw(s0)).toBe(false);
    const s = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mild Aura', 'hand', 'p1') }), { targets: [{ kind: 'object', id: bird }] }));
    expect(kw(s)).toBe(true);
  });
});
