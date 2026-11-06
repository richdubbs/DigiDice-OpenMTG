/**
 * Commander lane edh-c, round edh-c-97 (EDHREC ranks 20,001-20,500, third pass): the round's readings played through the engine with synthetic cards (invented names,
 * design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 * CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 205.2a, 608.2c            "... you lose 4 life unless there are four or more card types among cards in your graveyard." (Mindwrack Demon)
 *   CR 608.2d, 613.4c            "Choose a creature type. Target creature gets -1/-1 until end of turn for each permanent of the chosen type you control." (Pack's Disdain)
 *   CR 107.3, 120.3, 608.2h      "Create an X/X token, where X is half your life total, rounded up. It deals X damage to you." (Chainer's Torment)
 *   CR 608.2c, 111.2             "Destroy up to N other target nonland permanents. For each of those permanents, its controller creates a 3/3 Angel." (Soul of Emancipation)
 *   CR 701.20a, 701.24a          "Reveal cards ... until you reveal a creature card. Put that card onto the battlefield and shuffle all other cards revealed this way into your library." (Thicket Elemental)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { answer, find, findAll, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil } from '../../m4/helpers';
import { card, cast, full, pt, resolveAll, tokens } from '../cmd3/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const ROCK = card('Test Rock', 'Creature — Golem', 'Indestructible', ['2', '2']);
const TRINKET = card('Test Trinket', 'Artifact', '');
const DEMON = card('Test Demon', 'Creature — Demon', 'At the beginning of your upkeep, you lose 4 life unless there are four or more card types among cards in your graveyard.', ['2', '2']);
const DISDAIN = card('Test Disdain', 'Instant', 'Choose a creature type. Target creature gets -1/-1 until end of turn for each permanent of the chosen type you control.');
const TORMENT = card('Test Torment', 'Sorcery', 'Create an X/X black Nightmare Horror creature token, where X is half your life total, rounded up. It deals X damage to you.');
const SOUL = card('Test Soul', 'Creature — Avatar', 'When this creature enters, destroy up to two other target nonland permanents. For each of those permanents, its controller creates a 3/3 white Angel creature token with flying.', ['4', '4']);
const THICKET = card('Test Thicket', 'Sorcery', 'You may reveal cards from the top of your library until you reveal a creature card. If you do, put that card onto the battlefield and shuffle all other cards revealed this way into your library.');
const DEFS = [BEAR, GOBLIN, ROCK, TRINKET, DEMON, DISDAIN, TORMENT, SOUL, THICKET];
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 205.2a, 608.2c: "you lose 4 life unless there are four or more card types among cards in your graveyard" (Mindwrack Demon)', () => {
  const upkeep = (graveyard: string[]): GameState => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Demon'], graveyard } } as never);
    let s = s0;
    for (let i = 0; i < 6 && !(s.turn.number > 1 && s.turn.activePlayer === 'p1' && s.turn.step === 'upkeep' && s.zones.stack.length > 0); i++) {
      s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' || (x.turn.number > 1 && x.turn.activePlayer === 'p1' && x.turn.step === 'upkeep' && x.zones.stack.length > 0), 'p1 upkeep with the trigger');
      if (s.pending?.kind === 'declareAttackers') s = declareAttackers(s, []);
    }
    return resolveAll(s);
  };
  it('with only one card type in the graveyard you lose 4 life', () => {
    expect(life(upkeep(['Test Bear']), 'p1')).toBe(16);
  });
  it('with four card types in the graveyard you lose nothing; with three you still lose 4', () => {
    const land = 'Plains';
    const sorcery = 'Test Torment';
    const instant = 'Test Disdain';
    expect(life(upkeep(['Test Bear', 'Test Trinket', land, sorcery]), 'p1')).toBe(20);
    expect(life(upkeep(['Test Bear', 'Test Trinket', land, 'Test Goblin']), 'p1')).toBe(16);
    expect(life(upkeep(['Test Bear', 'Test Trinket', instant, sorcery]), 'p1')).toBe(20);
  });
});

/** Both players pass; the spell resolves and asks its controller for a creature type. */
const chooseType = (s0: GameState, name: string): GameState => {
  let s = s0;
  for (let i = 0; i < 4 && s.pending?.kind !== 'chooseName'; i++) s = pass(s);
  return answer(s, { kind: 'chooseName', name });
};

describe('CR 608.2d, 613.4c: "Choose a creature type. Target creature gets -1/-1 until end of turn for each permanent of the chosen type you control." (Pack\'s Disdain)', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Disdain'], battlefield: ['Test Goblin', 'Test Goblin', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } } as never);
  it('with two Goblins and Goblin chosen, the target gets -2/-2', () => {
    const s0 = board();
    const target = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = resolveAll(chooseType(cast(s0, 'Test Disdain', { targets: [obj(target)] }), 'Goblin'));
    expect(pt(s, target)).toBe('1/1');
  });
  it('choosing Bear counts only the Bears you control (one), not the opponent\'s', () => {
    const s0 = board();
    const target = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = resolveAll(chooseType(cast(s0, 'Test Disdain', { targets: [obj(target)] }), 'Bear'));
    expect(pt(s, target)).toBe('2/2'); // your own Bear is one permanent of the chosen type
  });
});

describe('CR 107.3, 120.3, 608.2h: "Create an X/X token, where X is half your life total, rounded up. It deals X damage to you." (Chainer\'s Torment)', () => {
  it('at 20 life: a 10/10 token that deals 10 damage to you', () => {
    const s = resolveAll(cast(scenario([], { defs: DEFS, p1: { hand: ['Test Torment'] } } as never), 'Test Torment'));
    expect(pt(s, tokens(s)[0]!)).toBe('10/10');
    expect(life(s, 'p1')).toBe(10);
  });
  it('at 7 life, half rounded up is 4: a 4/4 token and you are at 3', () => {
    const s = resolveAll(cast(scenario([], { defs: DEFS, life: 7, p1: { hand: ['Test Torment'] } } as never), 'Test Torment'));
    expect(pt(s, tokens(s)[0]!)).toBe('4/4');
    expect(life(s, 'p1')).toBe(3);
    expect(life(s, 'p2')).toBe(7); // the token damages only you
  });
});

describe('CR 608.2c, 111.2: "For each of those permanents, its controller creates a 3/3 white Angel creature token with flying." (Soul of Emancipation)', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Soul'], battlefield: ['Test Goblin'] }, p2: { battlefield: ['Test Bear', 'Test Rock'] } } as never);
  it('each target is destroyed and its controller (not you) gets an Angel', () => {
    const s0 = board();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const goblin = find(s0, 'Test Goblin', 'battlefield', 'p1');
    const s = resolveAll(cast(s0, 'Test Soul'), { targets: [obj(bear), obj(goblin)] });
    expect(s.zones.battlefield.includes(bear)).toBe(false);
    expect(s.zones.battlefield.includes(goblin)).toBe(false);
    expect(tokens(s, 'p2')).toHaveLength(1);
    expect(tokens(s, 'p1')).toHaveLength(1);
    expect(pt(s, tokens(s, 'p2')[0]!)).toBe('3/3');
  });
  it('a target that is not destroyed (indestructible) is still a legal target, so its controller still gets an Angel (ruling 2022-04-29)', () => {
    const s0 = board();
    const rock = find(s0, 'Test Rock', 'battlefield', 'p2');
    const s = resolveAll(cast(s0, 'Test Soul'), { targets: [obj(rock)] });
    expect(s.zones.battlefield.includes(rock)).toBe(true);
    expect(tokens(s, 'p2')).toHaveLength(1);
  });
  it('no targets at all (up to two) makes no Angel', () => {
    const s = resolveAll(cast(board(), 'Test Soul'), { targets: [] });
    expect(tokens(s, 'p1')).toHaveLength(0);
    expect(tokens(s, 'p2')).toHaveLength(0);
  });
});

describe('CR 701.20a, 701.24a: "reveal ... until you reveal a creature card. Put that card onto the battlefield and shuffle all other cards revealed this way into your library." (Thicket Elemental)', () => {
  it('the creature is put onto the battlefield, the non-creature cards revealed before it stay in the library', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Thicket'], library: ['Test Trinket', 'Test Trinket', 'Test Bear'] } } as never);
    const before = s0.zones.library['p1']!.length;
    const s = resolveAll(cast(s0, 'Test Thicket'));
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1);
    expect(s.zones.library['p1']!.length).toBe(before - 1);
    expect(s.zones.library['p1']!.filter((id) => s.objects[id]!.defId === 'Test Trinket').length).toBe(2);
  });
  it('declining the optional reveal does nothing', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Thicket'], library: ['Test Trinket', 'Test Bear'] } } as never);
    const s = resolveAll(cast(s0, 'Test Thicket', { yes: false }), { yes: false });
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(0);
  });
});
