/**
 * std-rw9 (card wave 2, slice s9): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.8a, 614.6, 608.2c  "Destroy target creature. If a creature card is put into a graveyard this way, return it ...": only what the destroy really put into a
 *                             graveyard (not an indestructible creature, not one a replacement exiled instead); the delayed sacrifice of the returned permanent
 *   CR 701.21a, 115.4         "Target creature you control deals damage equal to its power to any other target. Then sacrifice it.": the creature, never the other target
 *   CR 701.20e, 608.2c        "... You may put one of them into your hand. Then put any number of land cards from among them onto the battlefield tapped and the rest
 *                             into your graveyard." (eff.stdrw9.dig.anyNumber.bf.tapped.rest.graveyard): the rest is every looked-at card still in the library
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import type { DecisionAnswer } from '../../../src/types/decisions';
import { act, advanceTo, answer, find, life, pass, scenario } from '../../m3/scenario';
import { card, full, inYard, named } from '../cmd3/helpers';

const HEX = card('Test Hex', 'Sorcery', 'Destroy target creature. If a creature card is put into a graveyard this way, return it to the battlefield under your control. Sacrifice it at the beginning of your next end step.');
const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '3']);
const STATUE = card('Test Statue', 'Creature — Golem', 'Indestructible', ['1', '4']);
const VOID = card('Test Void', 'Enchantment', 'If a card or token would be put into a graveyard from anywhere, exile it instead.');
const DUEL = card('Test Duel', 'Sorcery', 'Target creature you control deals damage equal to its power to any other target. Then sacrifice it.');
const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['0', '4']);
const DIVINER = card('Test Diviner', 'Sorcery', 'Look at the top four cards of your library. You may put one of them into your hand. Then put any number of land cards from among them onto the battlefield tapped and the rest into your graveyard.');
const TWIN = card('Test Twin', 'Creature — Human', '', ['1', '1']);
const DEFS = [HEX, BRUTE, STATUE, VOID, DUEL, WALL, DIVINER, TWIN];

type Target = { kind: 'player'; id: string } | { kind: 'object'; id: ObjectId };
const obj = (id: ObjectId): Target => ({ kind: 'object', id });

/** Cast a card from p1's hand, answer each decision with the next of `answers` (targets, yes/no, objects; cost payments are automatic), and resolve the stack. */
function play(s0: GameState, name: string, answers: (DecisionAnswer | Target[])[]): GameState {
  const queue = [...answers];
  let s = stepAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand') }), queue);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 20; guard++) s = stepAll(pass(s), queue);
  expect(queue, 'every answer was used').toEqual([]);
  return s;
}
function stepAll(s0: GameState, queue: (DecisionAnswer | Target[])[]): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') { s = answer(s, { kind: 'payCost', auto: true }); continue; }
    const next = queue.shift();
    if (next === undefined) throw new Error(`no answer for the decision ${d.kind}`);
    s = answer(s, (d.kind === 'chooseTargets' ? { kind: 'chooseTargets', targets: next } : next) as DecisionAnswer);
  }
  return s;
}
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const inYardNamed = (s: GameState, name: string, player = 'p1'): boolean => (s.zones.graveyard[player] ?? []).some((id) => nameOf(s, id) === name);
const controllerOf = (s: GameState, id: ObjectId): string => s.objects[id]!.controller;

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.8a, 608.2c: "If a creature card is put into a graveyard this way" after a destroy', () => {
  it('the destroyed creature card comes back under your control, and is sacrificed at the beginning of your next end step', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Hex'] }, p2: { battlefield: ['Test Brute'] } });
    let s = play(s0, 'Test Hex', [[obj(find(s0, 'Test Brute', 'battlefield', 'p2'))]]);
    const back = named(s, 'Test Brute');
    expect(back).toHaveLength(1);
    expect(controllerOf(s, back[0]!)).toBe('p1');
    s = advanceTo(s, 1, 'end');
    for (let guard = 0; s.zones.stack.length > 0 && guard < 10; guard++) s = pass(s);
    expect(named(s, 'Test Brute')).toEqual([]);
    expect(inYard(s, 'Test Brute', 'p2')).toBe(true); // CR 400.3: its owner's graveyard
  });
  it('an indestructible creature is not destroyed: nothing is put into a graveyard, it stays under its controller', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Hex'] }, p2: { battlefield: ['Test Statue'] } });
    const statue = find(s0, 'Test Statue', 'battlefield', 'p2');
    const s = play(s0, 'Test Hex', [[obj(statue)]]);
    expect(named(s, 'Test Statue')).toEqual([statue]);
    expect(controllerOf(s, statue)).toBe('p2');
  });
  it('CR 614.6: a creature a replacement exiles instead was not put into a graveyard, so it stays in exile', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Hex'], battlefield: ['Test Void'] }, p2: { battlefield: ['Test Brute'] } });
    const s = play(s0, 'Test Hex', [[obj(find(s0, 'Test Brute', 'battlefield', 'p2'))]]);
    expect(named(s, 'Test Brute')).toEqual([]);
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Brute')).toBe(true);
  });
});

describe('CR 701.21a, 115.4: "Then sacrifice it" after a damage dealt to any other target', () => {
  it('the creature you control deals damage equal to its power to the player, then is sacrificed', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Duel'], battlefield: ['Test Brute'] } });
    const before = life(s0, 'p2');
    const s = play(s0, 'Test Duel', [[obj(find(s0, 'Test Brute', 'battlefield'))], [{ kind: 'player', id: 'p2' }]]);
    expect(life(s, 'p2')).toBe(before - 3);
    expect(named(s, 'Test Brute')).toEqual([]);
    expect(inYard(s, 'Test Brute')).toBe(true);
  });
  it('the other target, a creature an opponent controls, is dealt the damage and is not sacrificed', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Duel'], battlefield: ['Test Brute'] }, p2: { battlefield: ['Test Wall'] } });
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    const s = play(s0, 'Test Duel', [[obj(find(s0, 'Test Brute', 'battlefield'))], [obj(wall)]]);
    expect(named(s, 'Test Wall')).toEqual([wall]);
    expect(s.objects[wall]!.damage).toBe(3);
    expect(named(s, 'Test Brute')).toEqual([]);
  });
});

describe('CR 701.20e, 608.2c: one card into your hand, then any number of lands onto the battlefield tapped and the rest into your graveyard', () => {
  const start = (): GameState => scenario(['Island', 'Forest'], { defs: DEFS, p1: { hand: ['Test Diviner'], library: ['Test Brute', 'Island', 'Forest', 'Test Twin'] } });
  it('the chosen card goes to the hand, the chosen lands enter tapped, the rest (the other creature card) goes to the graveyard', () => {
    const s0 = start();
    const brute = find(s0, 'Test Brute', 'library');
    const island = find(s0, 'Island', 'library');
    const forest = find(s0, 'Forest', 'library');
    const s = play(s0, 'Test Diviner', [{ kind: 'yesNo', yes: true }, { kind: 'chooseObjects', ids: [brute] }, { kind: 'chooseObjects', ids: [island, forest] }]);
    expect(s.zones.hand.p1!.some((id) => nameOf(s, id) === 'Test Brute')).toBe(true);
    const lands = s.zones.battlefield.filter((id) => ['Island', 'Forest'].includes(nameOf(s, id)));
    expect(lands).toHaveLength(2);
    expect(lands.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(inYard(s, 'Test Twin')).toBe(true);
    expect(inYard(s, 'Test Brute')).toBe(false);
  });
  it('declining the card and choosing one land: the other three cards go to the graveyard, no other library card moves', () => {
    const s0 = start();
    const island = find(s0, 'Island', 'library');
    const libSize = s0.zones.library.p1!.length;
    const s = play(s0, 'Test Diviner', [{ kind: 'yesNo', yes: false }, { kind: 'chooseObjects', ids: [island] }]);
    expect(inYard(s, 'Test Brute')).toBe(true);
    expect(inYard(s, 'Test Twin')).toBe(true);
    expect(inYardNamed(s, 'Forest')).toBe(true);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Island')).toHaveLength(1);
    expect(s.zones.library.p1!.length).toBe(libSize - 4);
  });
});
