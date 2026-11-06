/**
 * Commander EDHREC ranks 8,751-10,000, round edh-next-46 (third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by
 * the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. Cites of the Comprehensive Rules
 * 2026-09-25 were checked against the text where the round's record says so.
 *
 *   CR 106.6, 603.2, 121.1      "{T}: Add {G}. When you spend this mana to cast a spell with mana value 6 or greater, draw a card." (Gilanra, Caller of Wirewood)
 *   CR 614.1a, 614.5, 111.10    "If you would create a Food token, instead create a Food token and a Treasure token." (Bilbo, Fellow Conspirator)
 *   CR 500.7, 502.1, 614.10     "Take an extra turn after this one. Skip the untap step of that turn." (Savor the Moment)
 *   CR 401.3, 400.3             "When ~ dies, you may put it into its owner's library fifth from the top." (Gandalf, White Rider)
 *   CR 601.2d, 122.1, 608.2h    "When ~ dies, distribute X +1/+1 counters among any number of target creatures you control, where X is the number of +1/+1 counters on ~." (Quirion Beastcaller)
 *   CR 701.20a, 406.1, 401.4    "Exile cards from the top of your library until you exile a land card. Put that card onto the battlefield and the rest on the bottom of your library in a random order." (Venture Forth)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { card, counters, full, settle } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
/** settle, also choosing the first replacement offered (CR 616.1) */
const settleR = (s0: GameState, p: Parameters<typeof settle>[1] = {}): GameState => {
  let s = settle(s0, p);
  for (let g = 0; g < 20 && s.pending?.kind === 'chooseReplacement'; g++) s = settle(answer(s, { kind: 'chooseReplacement', id: (s.pending as unknown as { options: { id: string }[] }).options[0]!.id } as never), p);
  return s;
};
const drain = (s0: GameState, p: Parameters<typeof settle>[1] = {}): GameState => { let s = settleR(s0, p); for (let i = 0; i < 30 && s.zones.stack.length > 0; i++) s = settleR(pass(s), p); return s; };
const castSpell = (s0: GameState, name: string, p: Parameters<typeof settle>[1] = {}): GameState => drain(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), p);
const hand = (s: GameState, player = 'p1'): number => s.zones.hand[player]!.length;

// ---- "When you spend this mana to cast a spell with mana value N or greater, draw a card" -------------------------------------------------------------------------
const ORB = card('Test Orb', 'Artifact', '{T}: Add {G}. When you spend this mana to cast a spell with mana value 6 or greater, draw a card.');
const STONE = card('Test Stone', 'Artifact', '{T}: Add {C}.');
const BIG = card('Test Colossus', 'Creature — Giant', '', ['6', '6'], '{6}');
const SMALL = card('Test Pebble', 'Creature — Giant', '', ['1', '1'], '{1}');
describe('CR 106.6, 603.2: "When you spend this mana to cast a spell with mana value 6 or greater, draw a card" (the mana carries a triggered ability)', () => {
  const tap = (s: GameState, name: string): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === find(s, name, 'battlefield', 'p1'));
    return act(s, a!.action);
  };
  const cast = (s0: GameState, name: string): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let g = 0; g < 40 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); g++) s = s.pending.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    return s;
  };
  const stones = (n: number): string[] => Array(n).fill('Test Stone') as string[];
  const defs = [ORB, STONE, BIG, SMALL];
  it('the synthetic card is fully automated', () => { expect(full(ORB)).toBe(true); });
  it('paying a mana value 6 spell with that mana draws a card', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Colossus'], battlefield: ['Test Orb', ...stones(5)] }, p2: {} });
    for (const n of ['Test Orb', ...Array(5).fill('Test Stone') as string[]]) { const id = s.zones.battlefield.find((x) => nameOf(s, x) === n && !s.objects[x]!.tapped)!; s = act(s, legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === id)!.action); }
    const before = hand(s) - 1; // the spell leaves the hand
    s = cast(s, 'Test Colossus');
    s = drain(s);
    expect(hand(s)).toBe(before + 1);
  });
  it('negative: a mana value 1 spell paid with that mana draws nothing', () => {
    let s = tap(scenario([], { defs, p1: { hand: ['Test Pebble'], battlefield: ['Test Orb'] } }), 'Test Orb');
    const before = hand(s) - 1;
    s = drain(cast(s, 'Test Pebble'));
    expect(hand(s)).toBe(before);
  });
  it('negative: a mana value 6 spell paid with other mana only draws nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Colossus'], battlefield: ['Test Orb', ...stones(6)] } });
    for (let i = 0; i < 6; i++) { const id = s.zones.battlefield.find((x) => nameOf(s, x) === 'Test Stone' && !s.objects[x]!.tapped)!; s = act(s, legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === id)!.action); }
    const before = hand(s) - 1;
    s = drain(cast(s, 'Test Colossus'));
    expect(hand(s)).toBe(before);
  });
});

// ---- Bilbo: Food token -> Food token and Treasure token ------------------------------------------------------------------------------------------------------------
const BILBO = card('Test Hobbit', 'Creature — Halfling', 'If you would create a Food token, instead create a Food token and a Treasure token.', ['1', '1']);
const FEAST = card('Test Feast', 'Sorcery', 'Create a Food token.');
const TWOFEAST = card('Test Banquet', 'Sorcery', 'Create two Food tokens.');
const CLUE = card('Test Clue Maker', 'Sorcery', 'Create a Clue token.');
const OPPFEAST = card('Test Gift', 'Sorcery', 'Target opponent creates a Food token.');
describe('CR 614.1a, 614.5, 111.10: "If you would create a Food token, instead create a Food token and a Treasure token."', () => {
  const kinds = (s: GameState, player: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player).map((id) => nameOf(s, id).replace(/ Token$/, '')).sort();
  const defs = [BILBO, FEAST, TWOFEAST, CLUE, OPPFEAST];
  it('is understood', () => { expect(full(BILBO)).toBe(true); });
  it('one Food becomes a Food and a Treasure', () => {
    expect(kinds(castSpell(scenario([], { defs, p1: { hand: ['Test Feast'], battlefield: ['Test Hobbit'] } }), 'Test Feast'), 'p1')).toEqual(['Food', 'Treasure']);
  });
  it('two Food tokens become two Foods and two Treasures (one Treasure for each Food, the Foods not replaced again)', () => {
    expect(kinds(castSpell(scenario([], { defs, p1: { hand: ['Test Banquet'], battlefield: ['Test Hobbit'] } }), 'Test Banquet'), 'p1')).toEqual(['Food', 'Food', 'Treasure', 'Treasure']);
  });
  it('negative: without the Hobbit a Food is only a Food', () => {
    expect(kinds(castSpell(scenario([], { defs, p1: { hand: ['Test Feast'] } }), 'Test Feast'), 'p1')).toEqual(['Food']);
  });
  it('negative: a Clue is not changed', () => {
    expect(kinds(castSpell(scenario([], { defs, p1: { hand: ['Test Clue Maker'], battlefield: ['Test Hobbit'] } }), 'Test Clue Maker'), 'p1')).toEqual(['Clue']);
  });
  it('review finding: a token copy of a Food becomes that copy and a Treasure (the predefined Food is not made as well)', () => {
    const COPY = card('Test Mirror', 'Sorcery', "Create a token that's a copy of target artifact you control.");
    const SNACK = card('Test Snack', 'Artifact — Food', '');
    const s0 = scenario([], { defs: [...defs, COPY, SNACK], p1: { hand: ['Test Mirror'], battlefield: ['Test Hobbit', 'Test Snack'] } });
    const snack = find(s0, 'Test Snack', 'battlefield', 'p1');
    const s = castSpell(s0, 'Test Mirror', { targets: [{ kind: 'object', id: snack } as unknown as TargetChoice] });
    const toks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').map((id) => nameOf(s, id).replace(/ Token$/, '')).sort();
    expect(toks).toEqual(['Test Snack', 'Treasure']);
  });
  it("negative: a Food an opponent creates (\"you\" is the controller of the Hobbit) is not changed", () => {
    const s = castSpell(scenario([], { defs, p1: { hand: ['Test Gift'], battlefield: ['Test Hobbit'] } }), 'Test Gift', { targets: [{ kind: 'player', id: 'p2' } as unknown as TargetChoice] });
    expect(kinds(s, 'p2')).toEqual(['Food']);
    expect(kinds(s, 'p1')).toEqual([]);
  });
});

// ---- Savor the Moment: an extra turn without its untap step --------------------------------------------------------------------------------------------------------
const SAVOR = card('Test Moment', 'Sorcery', 'Take an extra turn after this one. Skip the untap step of that turn.');
const PLAIN = card('Test Second Wind', 'Sorcery', 'Take an extra turn after this one.');
const ROCK = card('Test Boulder', 'Artifact', '');
describe('CR 500.7, 502.1, 614.10: "Take an extra turn after this one. Skip the untap step of that turn."', () => {
  const defs = [SAVOR, PLAIN, ROCK];
  const run = (spell: string): { extraTapped: boolean; extra: boolean; nextTurnUntapped: boolean } => {
    let s = scenario([], { defs, p1: { hand: [spell], battlefield: [{ name: 'Test Boulder', tapped: true }] } });
    s = castSpell(s, spell);
    s = advanceTo(s, 2, 'upkeep');
    const rock = (): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Boulder')!;
    const out = { extraTapped: s.objects[rock()]!.tapped, extra: s.turn.extra === true && s.turn.activePlayer === 'p1', nextTurnUntapped: false };
    s = advanceTo(s, 3, 'upkeep');
    out.nextTurnUntapped = !s.objects[rock()]!.tapped || s.turn.activePlayer === 'p2';
    return out;
  };
  it('is understood', () => { expect(full(SAVOR)).toBe(true); });
  it('the extra turn is Alice\'s and her tapped artifact stays tapped (no untap step)', () => {
    const r = run('Test Moment');
    expect(r.extra).toBe(true);
    expect(r.extraTapped).toBe(true);
  });
  it('negative: an extra turn without the rider untaps it', () => {
    const r = run('Test Second Wind');
    expect(r.extra).toBe(true);
    expect(r.extraTapped).toBe(false);
  });
});

// ---- Gandalf: "When ~ dies, you may put it into its owner's library fifth from the top" ----------------------------------------------------------------------------
const WIZARD = card('Test Grey Rider', 'Creature — Wizard', "When this creature dies, you may put it into its owner's library fifth from the top.", ['3', '3']);
const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
describe("CR 401.3, 400.3: \"When ~ dies, you may put it into its owner's library fifth from the top.\"", () => {
  const defs = [WIZARD, SMITE];
  const dies = (yes: boolean): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Grey Rider'] } });
    const id = find(s0, 'Test Grey Rider', 'battlefield', 'p1');
    return castSpell(s0, 'Test Smite', { yes, targets: [{ kind: 'object', id } as unknown as TargetChoice] });
  };
  it('is understood', () => { expect(full(WIZARD)).toBe(true); });
  it('it goes into its owner\'s library with four cards above it', () => {
    const s = dies(true);
    const lib = s.zones.library.p1!;
    expect(nameOf(s, lib[4]!)).toBe('Test Grey Rider');
    expect(lib.filter((id) => nameOf(s, id) === 'Test Grey Rider').length).toBe(1);
    expect((s.zones.graveyard.p1 ?? []).some((id) => nameOf(s, id) === 'Test Grey Rider')).toBe(false);
  });
  it('ruling: with only two other cards in the library it becomes the bottom card', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Grey Rider'] } });
    s0.zones.library.p1 = s0.zones.library.p1!.slice(0, 2);
    const id = find(s0, 'Test Grey Rider', 'battlefield', 'p1');
    const s = castSpell(s0, 'Test Smite', { yes: true, targets: [{ kind: 'object', id } as unknown as TargetChoice] });
    const lib = s.zones.library.p1!;
    expect(lib.length).toBe(3);
    expect(nameOf(s, lib[2]!)).toBe('Test Grey Rider');
  });
  it('negative: declining the "may" leaves it in the graveyard', () => {
    const s = dies(false);
    expect((s.zones.graveyard.p1 ?? []).some((id) => nameOf(s, id) === 'Test Grey Rider')).toBe(true);
    expect(s.zones.library.p1!.some((id) => nameOf(s, id) === 'Test Grey Rider')).toBe(false);
  });
});

// ---- Quirion Beastcaller: distribute X counters, X the counters it had ----------------------------------------------------------------------------------------------
const DRYAD = card('Test Sproutling', 'Creature — Dryad', 'When this creature dies, distribute X +1/+1 counters among any number of target creatures you control, where X is the number of +1/+1 counters on this creature.', ['1', '1']);
const BEAR = card('Test Cub', 'Creature — Bear', '', ['2', '2']);
describe('CR 601.2d, 122.1, 608.2h: "When ~ dies, distribute X +1/+1 counters among any number of target creatures you control, where X is the number of +1/+1 counters on ~."', () => {
  const defs = [DRYAD, BEAR, SMITE];
  const total = (counts: number): number => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: [{ name: 'Test Sproutling', counters: { '+1/+1': counts } }, 'Test Cub'] } });
    const dryad = find(s0, 'Test Sproutling', 'battlefield', 'p1');
    const cub = find(s0, 'Test Cub', 'battlefield', 'p1');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Smite', 'hand', 'p1') });
    s = settle(s, { targets: [{ kind: 'object', id: dryad } as unknown as TargetChoice] });
    // the dies trigger's target: the cub (answers the trigger's target choice as the pending decision asks)
    for (let g = 0; g < 40 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      const d = s.pending;
      if (d?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: cub } as unknown as TargetChoice] });
      else if (d?.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    return counters(s, cub, '+1/+1');
  };
  it('is understood', () => { expect(full(DRYAD)).toBe(true); });
  it('three counters on it when it dies: the one chosen creature gets all three', () => { expect(total(3)).toBe(3); });
  it('negative: with no counters on it nothing is put', () => { expect(total(0)).toBe(0); });
});

// ---- Venture Forth: exile until a land, onto the battlefield, the rest to the bottom in a random order --------------------------------------------------------------------
const FORTH = card('Test Journey', 'Sorcery', 'Exile cards from the top of your library until you exile a land card. Put that card onto the battlefield and the rest on the bottom of your library in a random order. Exile ~ with three time counters on it.');
const TREE = card('Test Oak', 'Creature — Treefolk', '', ['1', '1'], '{1}');
describe('CR 701.20a, 406.1, 401.4: "Exile cards from the top of your library until you exile a land card. Put that card onto the battlefield and the rest on the bottom of your library in a random order."', () => {
  const defs = [FORTH, TREE];
  it('is understood', () => { expect(full(FORTH)).toBe(true); });
  it('the first land goes onto the battlefield; the cards exiled before it go to the bottom of the library; the spell is exiled with three time counters', () => {
    const s0 = scenario(['Island'], { defs, p1: { hand: ['Test Journey'], library: ['Test Oak', 'Test Oak', 'Island', 'Test Oak'] } });
    const s = castSpell(s0, 'Test Journey');
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Island').length).toBe(1);
    const lib = s.zones.library.p1!.map((id) => nameOf(s, id));
    expect(lib.slice(-2)).toEqual(['Test Oak', 'Test Oak']); // the two exiled before the land are on the bottom
    expect(s.zones.library.p1!.length).toBe(s0.zones.library.p1!.length - 1); // only the land left the library
    const journey = s.zones.exile.find((id) => nameOf(s, id) === 'Test Journey');
    expect(journey).toBeDefined();
    expect(s.objects[journey!]!.counters['time']).toBe(3);
    expect(s.zones.exile.filter((id) => nameOf(s, id) === 'Test Oak').length).toBe(0);
  });
  it('negative: a library with no land is exiled whole and nothing enters the battlefield except the cards already there', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Journey'], library: ['Test Oak', 'Test Oak'] } });
    s0.zones.library.p1 = s0.zones.library.p1!.filter((id) => nameOf(s0, id) === 'Test Oak');
    const before = s0.zones.battlefield.length;
    const s = castSpell(s0, 'Test Journey');
    expect(s.zones.battlefield.length).toBe(before);
  });
});
