/**
 * std-combat-1 (lane std-combat): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 603.12, 608.2c, 701.3a  "When you put one or more Equipment onto the battlefield this way, you may attach one of them to a Samurai you control."
 *   CR 508.1a, 603.4, 508.5    "Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, ..."
 *   CR 603.2, 508.1c, 611.2a   "Whenever an opponent casts a creature spell during their turn, they can't attack you or planeswalkers you control this turn."
 *   CR 608.2c, 601.3, 611.3a   "Each opponent who attacked you or a planeswalker you control this turn can't cast creature spells."
 *   CR 603.2, 613.1b, 611.2b   "Whenever an Aura you control becomes attached to a nonland permanent an opponent controls with mana value less than or equal to that Aura's mana
 *                              value, gain control of that permanent for as long as that Aura is attached to it."
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { advanceTo, answer, find, life, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { card, full, resolveAll } from '../cmd3/helpers';
import { act } from '../../m3/scenario';

const SWORD = card('Test Gleaming Sword', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {2}');
const AXE = card('Test Dull Axe', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {3}');
const ROCK = card('Test Plain Rock', 'Artifact', '');
const RONIN = card('Test Wandering Ronin', 'Creature — Human Samurai', '', ['2', '2']);
const ARMORER = card('Test Samurai Armorer', 'Legendary Creature — Human Samurai', 'When this creature enters, look at the top four cards of your library. You may put any number of Equipment cards from among them onto the battlefield. Put the rest on the bottom of your library in a random order. When you put one or more Equipment onto the battlefield this way, you may attach one of them to a Samurai you control.', ['3', '3']);
const WARDEN = card('Test Law Warden', 'Creature — Human Advisor', 'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, that opponent loses 2 life and you draw a card.', ['1', '4']);
const RAIDER = card('Test Hill Raider', 'Creature — Goblin', '', ['1', '1']);
const WALKER = card('Test Oath Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
const SENTINEL = card('Test Glyph Sentinel', 'Artifact Creature — Golem', 'Whenever an opponent casts a creature spell during their turn, they can\'t attack you or planeswalkers you control this turn.', ['2', '2']);
const WARDGLYPH = card('Test Ward Glyph', 'Artifact', 'Each opponent who attacked you or a planeswalker you control this turn can\'t cast creature spells.');
const PUP = card('Test Eager Pup', 'Creature — Dog', '', ['1', '1']);
const SPARK = card('Test Little Spark', 'Instant', 'You gain 1 life.');
const CHARMER = card('Test Aura Charmer', 'Creature — Human Warlock', 'Whenever an Aura you control becomes attached to a nonland permanent an opponent controls with mana value less than or equal to that Aura\'s mana value, gain control of that permanent for as long as that Aura is attached to it.', ['2', '3']);
const HEX = card('Test Binding Hex', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -1/-0.', undefined, '{2}');
const CHEAP = card('Test Cheap Beast', 'Creature — Beast', '', ['3', '3'], '{1}');
const DEAR = card('Test Dear Beast', 'Creature — Beast', '', ['4', '4'], '{3}');
const UNBIND = card('Test Unbinding', 'Instant', 'Destroy target enchantment.');
const DEFS: CardDef[] = [SWORD, AXE, ROCK, RONIN, ARMORER, WARDEN, RAIDER, WALKER, SENTINEL, WARDGLYPH, PUP, SPARK, CHARMER, HEX, CHEAP, DEAR, UNBIND];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

/** Pass priority and say yes until a choice of objects is asked (or the stack is empty and nothing is asked). */
function toChoice(s0: GameState): GameState {
  let s = s0;
  for (let k = 0; k < 40; k++) {
    const d = s.pending;
    if (d?.kind === 'chooseObjects') return s;
    if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else return s;
  }
  return s;
}
const opts = (s: GameState): ObjectId[] => (s.pending as { options: ObjectId[] }).options;
const pick = (s: GameState, ids: ObjectId[]): GameState => answer(s, { kind: 'chooseObjects', ids });
const castIt = (s: GameState, name: string): GameState => act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });

const onBattlefield = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);

describe('CR 603.12, 608.2c, 701.3a: "When you put one or more Equipment onto the battlefield this way, you may attach one of them to a Samurai you control"', () => {
  it('CR 603.12, 701.3a: the Equipment put onto the battlefield; the reflexive trigger attaches the one chosen to the Samurai chosen', () => {
    let s = scenario(['Plains'], { p1: { library: ['Test Gleaming Sword', 'Test Dull Axe', 'Test Plain Rock', 'Plains'], hand: ['Test Samurai Armorer'], battlefield: ['Test Wandering Ronin'] }, defs: DEFS });
    s = toChoice(castIt(s, 'Test Samurai Armorer'));
    // the creature spell resolved; its enters trigger: choose any number of the Equipment cards among the top four
    const sword = find(s, 'Test Gleaming Sword', 'library', 'p1');
    const axe = find(s, 'Test Dull Axe', 'library', 'p1');
    expect([...opts(s)].sort()).toEqual([sword, axe].sort());
    s = toChoice(pick(s, [sword, axe]));
    expect(onBattlefield(s, 'Test Gleaming Sword')).toHaveLength(1);
    expect(onBattlefield(s, 'Test Dull Axe')).toHaveLength(1);
    expect(s.zones.library.p1!.some((id) => s.objects[id]!.defId === 'Test Plain Rock')).toBe(true);
    // the reflexive trigger resolved: one of the two Equipment (as they are now, on the battlefield), then a Samurai you control
    const newSword = onBattlefield(s, 'Test Gleaming Sword')[0]!;
    const newAxe = onBattlefield(s, 'Test Dull Axe')[0]!;
    const ronin = onBattlefield(s, 'Test Wandering Ronin')[0]!;
    const armorer = onBattlefield(s, 'Test Samurai Armorer')[0]!;
    expect([...opts(s)].sort()).toEqual([newSword, newAxe].sort());
    s = toChoice(pick(s, [newSword]));
    expect([...opts(s)].sort()).toEqual([ronin, armorer].sort());
    s = resolveAll(pick(s, [ronin]));
    expect(s.objects[newSword]!.attachedTo).toBe(ronin);
    expect(s.objects[newAxe]!.attachedTo).toBeUndefined();
  });

  it('CR 603.12: nothing put onto the battlefield this way: no reflexive trigger, nothing attached', () => {
    let s = scenario(['Plains'], { p1: { library: ['Test Gleaming Sword', 'Test Plain Rock', 'Plains', 'Plains'], hand: ['Test Samurai Armorer'], battlefield: ['Test Wandering Ronin'] }, defs: DEFS });
    s = toChoice(castIt(s, 'Test Samurai Armorer'));
    s = toChoice(pick(s, []));
    expect(s.pending?.kind).not.toBe('chooseObjects');
    expect(onBattlefield(s, 'Test Gleaming Sword')).toHaveLength(0);
    expect(s.zones.stack).toHaveLength(0);
  });
});

describe('CR 508.1a, 603.4, 508.5: "Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, ..."', () => {
  const setup = (): GameState => advanceTo(scenario(['Plains'], {
    p1: { battlefield: ['Test Law Warden', { name: 'Test Oath Walker', counters: { loyalty: 3 } }] },
    p2: { battlefield: ['Test Hill Raider', 'Test Hill Raider', 'Test Hill Raider'] }, defs: DEFS,
  }), 2, 'main1');
  const raiders = (s: GameState): ObjectId[] => onBattlefield(s, 'Test Hill Raider');
  const hand = (s: GameState): number => s.zones.hand.p1!.length;

  it('CR 508.1a, 603.4: two creatures attack you: the attacking opponent loses 2 life and you draw a card', () => {
    let s = toDeclareAttackers(setup());
    const before = hand(s);
    const [a, b] = raiders(s);
    s = resolveAll(declareAttackers(s, [[a!, 'p1'], [b!, 'p1']]));
    expect(life(s, 'p2')).toBe(18);
    expect(hand(s)).toBe(before + 1);
  });

  it('CR 506.3, 508.5: one attacking you and one attacking a planeswalker you control are two', () => {
    let s = toDeclareAttackers(setup());
    const walker = onBattlefield(s, 'Test Oath Walker')[0]!;
    const [a, b] = raiders(s);
    s = resolveAll(declareAttackers(s, [[a!, 'p1'], [b!, walker]]));
    expect(life(s, 'p2')).toBe(18);
  });

  it('CR 603.4: only one creature attacks: the intervening "if" is false, nothing happens', () => {
    let s = toDeclareAttackers(setup());
    const before = hand(s);
    const [a] = raiders(s);
    s = resolveAll(declareAttackers(s, [[a!, 'p1']]));
    expect(life(s, 'p2')).toBe(20);
    expect(hand(s)).toBe(before);
  });
});

describe('CR 603.2, 508.1c, 611.2a: "Whenever an opponent casts a creature spell during their turn, they can\'t attack you or planeswalkers you control this turn"', () => {
  const setup = (hand: string): GameState => advanceTo(scenario(['Plains'], {
    p1: { battlefield: ['Test Glyph Sentinel'] }, p2: { battlefield: ['Test Hill Raider'], hand: [hand] }, defs: DEFS,
  }), 2, 'main1');
  const castBy2 = (s: GameState, name: string): GameState => resolveAll(act(s, { type: 'cast', player: 'p2', card: find(s, name, 'hand', 'p2') }));

  it('CR 603.2, 611.2a: the opponent cast a creature spell during their turn: their creatures can\'t attack you this turn', () => {
    let s = castBy2(setup('Test Eager Pup'), 'Test Eager Pup');
    s = toDeclareAttackers(s);
    const raider = onBattlefield(s, 'Test Hill Raider')[0]!;
    expect(() => declareAttackers(s, [[raider, 'p1']])).toThrow();
    // the attack restriction ends with the turn: on their next turn the creature can attack again
    s = advanceTo(answer(s, { kind: 'declareAttackers', attacks: [] }), 4, 'main1');
    s = advanceTo(declareAttackers(toDeclareAttackers(s), [[raider, 'p1']]), 4, 'main2');
    expect(life(s, 'p1')).toBe(19);
  });

  it('CR 603.2: a spell that is not a creature spell triggers nothing: the creature attacks', () => {
    let s = castBy2(setup('Test Little Spark'), 'Test Little Spark');
    s = toDeclareAttackers(s);
    const raider = onBattlefield(s, 'Test Hill Raider')[0]!;
    s = advanceTo(declareAttackers(s, [[raider, 'p1']]), 2, 'main2');
    expect(life(s, 'p1')).toBe(19);
  });
});

describe('CR 608.2c, 601.3, 611.3a: "Each opponent who attacked you or a planeswalker you control this turn can\'t cast creature spells"', () => {
  const setup = (): GameState => advanceTo(scenario(['Plains'], {
    p1: { battlefield: ['Test Ward Glyph'] }, p2: { battlefield: ['Test Hill Raider'], hand: ['Test Eager Pup'] }, defs: DEFS,
  }), 2, 'main1');

  it('CR 601.3, 611.3a: before attacking the opponent may cast a creature spell; after attacking you they may not', () => {
    let s = setup();
    const raider = onBattlefield(s, 'Test Hill Raider')[0]!;
    s = resolveAll(declareAttackers(toDeclareAttackers(s), [[raider, 'p1']]));
    s = advanceTo(s, 2, 'main2');
    reject(s, { type: 'cast', player: 'p2', card: find(s, 'Test Eager Pup', 'hand', 'p2') });
  });

  it('CR 608.2c: an opponent who did not attack this turn may cast creature spells', () => {
    let s = setup();
    s = advanceTo(answer(toDeclareAttackers(s), { kind: 'declareAttackers', attacks: [] }), 2, 'main2');
    s = resolveAll(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Eager Pup', 'hand', 'p2') }));
    expect(onBattlefield(s, 'Test Eager Pup')).toHaveLength(1);
  });
});

describe('CR 603.2, 613.1b, 611.2b: "Whenever an Aura you control becomes attached to a nonland permanent an opponent controls with mana value less than or equal to that Aura\'s mana value, gain control of that permanent for as long as that Aura is attached to it"', () => {
  const setup = (): GameState => scenario(['Plains'], {
    p1: { battlefield: ['Test Aura Charmer', 'Plains', 'Plains'], hand: ['Test Binding Hex', 'Test Unbinding'] },
    p2: { battlefield: ['Test Cheap Beast', 'Test Dear Beast'] }, defs: DEFS,
  });
  const castOn = (s: GameState, name: string, target: ObjectId): GameState =>
    resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), { targets: [{ kind: 'object', id: target }] });

  it('CR 603.2, 613.1b: the Aura (mana value 2) attached to a creature of mana value 1: you control it; CR 611.2b: the Aura leaves and control returns', () => {
    let s = setup();
    const beast = onBattlefield(s, 'Test Cheap Beast')[0]!;
    s = castOn(s, 'Test Binding Hex', beast);
    const hex = onBattlefield(s, 'Test Binding Hex')[0]!;
    expect(s.objects[hex]!.attachedTo).toBe(beast);
    expect(s.objects[beast]!.controller).toBe('p1');
    s = castOn(s, 'Test Unbinding', hex);
    expect(onBattlefield(s, 'Test Binding Hex')).toHaveLength(0);
    expect(s.objects[beast]!.controller).toBe('p2');
  });

  it('CR 202.3: a creature of greater mana value (3) than the Aura (2): no trigger, its controller keeps it', () => {
    let s = setup();
    const dear = onBattlefield(s, 'Test Dear Beast')[0]!;
    s = castOn(s, 'Test Binding Hex', dear);
    expect(s.objects[onBattlefield(s, 'Test Binding Hex')[0]!]!.attachedTo).toBe(dear);
    expect(s.objects[dear]!.controller).toBe('p2');
  });
});
