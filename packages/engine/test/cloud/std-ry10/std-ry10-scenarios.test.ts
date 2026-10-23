/**
 * std-ry10 (wave 2, Commander lane ry10): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 700.8               "for each creature in your party", "the number of creatures in your party": one Cleric, Rogue, Warrior and Wizard at most, so a
 *                          second Wizard adds nothing and a creature of no party type counts nothing
 *   CR 700.4, 603.10a      "for each creature that died this turn": the creatures put into a graveyard from the battlefield this turn; one exiled does not count
 *   CR 615.1a, 510.1       "prevent all combat damage that would be dealt to and dealt by target creature this turn": the target neither takes nor deals combat
 *                          damage; another attacker still deals its damage, and noncombat damage to the target is not prevented
 *   CR 614.1a, 700.4       "If this creature would die, exile it instead.": destroyed, it goes to exile; another creature destroyed goes to the graveyard
 *   CR 202.3, 701.20a      "You choose a nonland card from it with mana value 2 or less": only the cards of that mana value are offered
 *   CR 402.3, 701.20e      "Look at target player's hand and choose a card from it. That player discards that card.": you choose, that player discards
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, answer, find, life, passBoth, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { card, full, pt, resolveAll } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage ?? 0;
const zoneOf = (s: GameState, name: string): string => {
  for (const id of s.zones.battlefield) if (s.defs[s.objects[id]!.defId]!.name === name) return 'battlefield';
  for (const p of ['p1', 'p2']) for (const z of ['graveyard', 'exile', 'hand'] as const) {
    const ids = z === 'exile' ? s.zones.exile : s.zones[z][p]!;
    if (ids.some((id) => s.defs[s.objects[id]!.defId]!.name === name)) return z;
  }
  return 'nowhere';
};

const HERALD = card('Test Herald', 'Creature — Human', 'When this creature enters, you gain 1 life for each creature in your party.', ['1', '1']);
const CAPTAIN = card('Test Captain', 'Creature — Human', 'When this creature enters, target creature gets +1/+1 until end of turn for each creature in your party.', ['1', '1']);
const PRIEST = card('Test Priest', 'Creature — Human Cleric', '', ['1', '1']);
const MAGE = card('Test Mage', 'Creature — Human Wizard', '', ['1', '1']);
const MAGE2 = card('Test Other Mage', 'Creature — Elf Wizard', '', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const BIG = card('Test Big Bear', 'Creature — Bear', '', ['4', '4']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const MOURNER = card('Test Mourner', 'Creature — Zombie', 'When this creature dies, you gain 1 life for each creature that died this turn.', ['1', '1']);
const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
const BANISH = card('Test Banish', 'Sorcery', 'Exile target creature.');
const MAZE = card('Test Maze', 'Artifact', '{0}: Prevent all combat damage that would be dealt to and dealt by target creature this turn.');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 2 damage to any target.');
const WISP = card('Test Wisp', 'Creature — Spirit', 'Flying\nIf this creature would die, exile it instead.', ['2', '2']);
const PROBE = card('Test Probe', 'Sorcery', 'Target player reveals their hand. You choose a nonland card from it with mana value 2 or less. That player discards that card.');
const PEEK = card('Test Peek', 'Sorcery', "Look at target player's hand and choose a card from it. That player discards that card.");
const CHEAP = card('Test Cheap', 'Instant', 'You gain 1 life.', undefined, '{1}');
const DEAR = card('Test Dear', 'Instant', 'You gain 3 life.', undefined, '{3}');
const DEFS: CardDef[] = [HERALD, CAPTAIN, PRIEST, MAGE, MAGE2, BEAR, BIG, OGRE, MOURNER, WRATH, SMITE, BANISH, MAZE, BOLT, WISP, PROBE, PEEK, CHEAP, DEAR];

/** Cast `name` from p1's hand with these targets, pay, and stop at the first decision of the resolution (or priority after it). */
function castAt(s0: GameState, name: string, targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return passBoth(s);
}
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[]): GameState {
  let s = act(s0, { type: 'activate', player: 'p1', source, ability: 'p:0:0' });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return passBoth(s);
}

describe('the synthetic cards are automated', () => {
  it('every synthetic card with rules text plays fully', () => {
    for (const d of [HERALD, CAPTAIN, MOURNER, MAZE, WISP, PROBE, PEEK]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 700.8: the size of your party', () => {
  it('"you gain 1 life for each creature in your party": a Cleric and two Wizards are a party of two', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Herald'], battlefield: ['Test Priest', 'Test Mage', 'Test Other Mage'] }, defs: DEFS });
    s = resolveAll(castAt(s, 'Test Herald'));
    expect(life(s, 'p1')).toBe(22);
  });
  it('a creature of no party type (the Human Herald itself, a Bear) counts nothing', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Herald'], battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(castAt(s, 'Test Herald'));
    expect(life(s, 'p1')).toBe(20);
  });
  it('"target creature gets +1/+1 until end of turn for each creature in your party", read as the trigger resolves', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Captain'], battlefield: ['Test Priest', 'Test Mage', 'Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(castAt(s, 'Test Captain'), { targets: [obj(bear)] });
    expect(pt(s, bear)).toBe('4/4');
  });
});

describe('CR 700.4, 603.10a: "for each creature that died this turn"', () => {
  it('a board wipe of three creatures: the dying creature itself is one of them', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Wrath'], battlefield: ['Test Mourner', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = resolveAll(castAt(s, 'Test Wrath'));
    expect(life(s, 'p1')).toBe(23);
  });
  it('a creature exiled this turn did not die and is not counted', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Banish', 'Test Smite'], battlefield: ['Test Mourner', 'Test Bear'] }, defs: DEFS });
    s = resolveAll(castAt(s, 'Test Banish', [obj(find(s, 'Test Bear', 'battlefield'))]));
    s = resolveAll(castAt(s, 'Test Smite', [obj(find(s, 'Test Mourner', 'battlefield'))]));
    expect(life(s, 'p1')).toBe(21);
  });
});

describe('CR 615.1a, 510.1: "Prevent all combat damage that would be dealt to and dealt by target creature this turn."', () => {
  const board = (): GameState => scenario([], { p1: { battlefield: ['Test Maze', 'Test Big Bear', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
  it('the target attacks and is blocked: neither it nor its blocker is dealt combat damage; the other attacker still deals its damage', () => {
    let s = board();
    const big = find(s, 'Test Big Bear', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = activate(s, find(s, 'Test Maze', 'battlefield'), [obj(big)]);
    s = declareAttackers(toDeclareAttackers(s), [[big], [bear]]);
    s = declareBlockers(toDeclareBlockers(s), [[ogre, big]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 12);
    expect(dmg(s, big)).toBe(0);
    expect(dmg(s, ogre)).toBe(0);
    expect(life(s, 'p2')).toBe(18);
  });
  it('noncombat damage to the target is not prevented', () => {
    let s = scenario([], { p1: { hand: ['Test Bolt'], battlefield: ['Test Maze', 'Test Big Bear'] }, defs: DEFS });
    const big = find(s, 'Test Big Bear', 'battlefield');
    s = activate(s, find(s, 'Test Maze', 'battlefield'), [obj(big)]);
    s = resolveAll(castAt(s, 'Test Bolt', [obj(big)]));
    expect(dmg(s, big)).toBe(2);
  });
});

describe('CR 614.1a, 700.4: "If this creature would die, exile it instead."', () => {
  it('destroyed, it is exiled; another creature destroyed goes to its owner\'s graveyard', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Wrath'], battlefield: ['Test Wisp', 'Test Bear'] }, defs: DEFS });
    s = resolveAll(castAt(s, 'Test Wrath'));
    expect(zoneOf(s, 'Test Wisp')).toBe('exile');
    expect(zoneOf(s, 'Test Bear')).toBe('graveyard');
  });
});

describe('CR 202.3, 701.20a: "You choose a nonland card from it with mana value 2 or less."', () => {
  it('only the nonland cards of that mana value are offered; the chosen one is discarded', () => {
    let s = scenario([], { p1: { hand: ['Test Probe'] }, p2: { hand: ['Test Cheap', 'Test Bear', 'Test Dear', 'Plains'] }, defs: DEFS });
    s = castAt(s, 'Test Probe', [{ kind: 'player', id: 'p2' }]);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(names(s, (s.pending as unknown as { options: string[] }).options).sort()).toEqual(['Test Bear', 'Test Cheap']);
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Cheap', 'hand', 'p2')] });
    expect(zoneOf(s, 'Test Cheap')).toBe('graveyard');
    expect(zoneOf(s, 'Test Dear')).toBe('hand');
  });
});

describe('CR 402.3, 701.20e: "Look at target player\'s hand and choose a card from it. That player discards that card."', () => {
  it('you choose any card of that hand (a land too) and that player discards it', () => {
    let s = scenario([], { p1: { hand: ['Test Peek'] }, p2: { hand: ['Test Dear', 'Plains'] }, defs: DEFS });
    s = castAt(s, 'Test Peek', [{ kind: 'player', id: 'p2' }]);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending!.player).toBe('p1');
    expect(names(s, (s.pending as unknown as { options: string[] }).options).sort()).toEqual(['Plains', 'Test Dear']);
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Plains', 'hand', 'p2')] });
    expect(names(s, s.zones.graveyard.p2!)).toEqual(['Plains']);
    expect(names(s, s.zones.hand.p2!)).toEqual(['Test Dear']);
  });
});
