/**
 * Coordinator D, round edh-d-26 (lane name-hand): the round's readings and engine changes played through the engine with synthetic cards (invented names and wordings,
 * design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case.
 * CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text).
 *
 *   CR 402.1, 102.3, 608.2c     "If an opponent has more cards in hand than you, ... Draw N cards instead if an opponent has at least four more cards in hand than you." (Teachings of the Archaics)
 *   CR 402.1, 121.1, 101.4      "Each player with fewer cards in hand than the player with the most cards in hand draws cards equal to the difference." (Tales of the Ancestors)
 *   CR 121.1, 508.1, 608.2c     "Draw cards equal to the number of cards in defending player's hand minus the number of cards in your hand. If you didn't draw cards this way, you may put a creature card from your hand onto the battlefield." (Mr. Foxglove)
 *   CR 701.20a, 401.4, 121.1    "When ~ enters, look at target player's hand. You may choose a nonland card from it. If you do, that player reveals the chosen card, puts it on the bottom of their library, then draws a card." (Vendilion Clique)
 *   CR 402.1, 119.3, 608.2c     "Each opponent with no cards in hand loses 10 life." (Tinybones, Trinket Thief)
 *   CR 701.9a, 608.2d, 107.3    "Draw four cards, then choose X cards in your hand and discard the rest." (Breakthrough)
 *   CR 603.3a, 701.37, 120.3    "When ~ becomes monstrous, it deals damage to each opponent equal to the number of cards in that player's hand." (Stormbreath Dragon)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { cast as castX, card as cardX, resolveAll } from '../r3-cost/support';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: opts.cost ?? '{0}', colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const handOf = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

/** Cast p1's card, pay automatically, and let the stack resolve. */
function cast(s0: GameState, name: string): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never);
  for (let g = 0; s.pending && s.pending.kind === 'payCost' && g < 5; g++) s = answer(s, { kind: 'payCost', auto: true });
  for (let g = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && g < 20; g++) s = pass(s);
  return s;
}
const filler = (n: number, name = 'Plains'): string[] => Array(n).fill(name) as string[];

// ---- Teachings of the Archaics -----------------------------------------------------------------------------------------------------------------------------------------
const LESSON = card('Test Lesson', 'Sorcery', 'If an opponent has more cards in hand than you, draw two cards. Draw three cards instead if an opponent has at least four more cards in hand than you.');
describe('CR 402.1, 102.3, 608.2c: "an opponent has at least four more cards in hand than you" (Teachings of the Archaics)', () => {
  it('is automated', () => { expect(full(LESSON)).toBe(true); });
  // p1 holds the lesson (hand size 1 while it is cast: the spell is on the stack, so 0 other cards)
  const game = (mine: number, theirs: number) => scenario([], { p1: { hand: ['Test Lesson', ...filler(mine)] }, p2: { hand: filler(theirs) }, defs: [LESSON] });
  it('four more cards (opponent 4, you 0 after casting): draws three', () => {
    const s = cast(game(0, 4), 'Test Lesson');
    expect(handOf(s, 'p1')).toBe(3);
  });
  it('three more cards: draws two (the margin is four)', () => {
    const s = cast(game(0, 3), 'Test Lesson');
    expect(handOf(s, 'p1')).toBe(2);
  });
  it('one more card: draws two', () => {
    const s = cast(game(1, 2), 'Test Lesson');
    expect(handOf(s, 'p1')).toBe(3);
  });
  it('negative: the same number of cards, or fewer: draws nothing', () => {
    expect(handOf(cast(game(2, 2), 'Test Lesson'), 'p1')).toBe(2);
    expect(handOf(cast(game(3, 1), 'Test Lesson'), 'p1')).toBe(3);
  });
});

// ---- Tales of the Ancestors --------------------------------------------------------------------------------------------------------------------------------------------
const TALES = card('Test Tales', 'Sorcery', 'Each player with fewer cards in hand than the player with the most cards in hand draws cards equal to the difference.');
describe('CR 402.1, 121.1, 101.4: "each player with fewer cards in hand than the player with the most cards in hand draws cards equal to the difference" (Tales of the Ancestors)', () => {
  it('is automated', () => { expect(full(TALES)).toBe(true); });
  it('the player with the smaller hand draws up to the larger hand; the player with the most draws nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tales', ...filler(1)] }, p2: { hand: filler(5) }, defs: [TALES] });
    const s = cast(s0, 'Test Tales');
    expect(handOf(s, 'p1')).toBe(5); // 1 card left after casting, draws 4
    expect(handOf(s, 'p2')).toBe(5);
  });
  it('negative: equal hands draw nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tales', ...filler(2)] }, p2: { hand: filler(2) }, defs: [TALES] });
    const s = cast(s0, 'Test Tales');
    expect(handOf(s, 'p1')).toBe(2);
    expect(handOf(s, 'p2')).toBe(2);
  });
  it('the bigger hand sets the amount (two players); counts are read before anyone draws (CR 608.2h)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tales'] }, p2: { hand: filler(3) }, defs: [TALES] });
    const s = cast(s0, 'Test Tales');
    expect(handOf(s, 'p1')).toBe(3);
    expect(handOf(s, 'p2')).toBe(3);
  });
});

// ---- Stormbreath Dragon ------------------------------------------------------------------------------------------------------------------------------------------------
const DRAGON = card('Test Dragon', 'Creature — Dragon', 'Flying\n{W}: Monstrosity 3.\nWhen this creature becomes monstrous, it deals damage to each opponent equal to the number of cards in that player\'s hand.', { pt: ['4', '4'] });
describe('CR 603.3a, 701.37, 120.3: "it deals damage to each opponent equal to the number of cards in that player\'s hand" (Stormbreath Dragon)', () => {
  it('is automated', () => { expect(full(DRAGON)).toBe(true); });
  it('becoming monstrous deals damage equal to the opponent\'s hand size', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dragon', 'Plains'] }, p2: { hand: filler(4) }, defs: [DRAGON] });
    const id = find(s0, 'Test Dragon', 'battlefield', 'p1');
    const idx = s0.defs[s0.objects[id]!.defId]!.faces[0]!.abilities.findIndex((a: { kind: string }) => a.kind === 'activated');
    let s = act(s0, { type: 'activate', player: 'p1', source: id, ability: `p:0:${idx}` } as never);
    for (let g = 0; s.pending && s.pending.kind === 'payCost' && g < 5; g++) s = answer(s, { kind: 'payCost', auto: true });
    for (let g = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && g < 20; g++) s = pass(s);
    expect(lifeOf(s, 'p2')).toBe(16);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('negative: an empty hand takes no damage', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dragon', 'Plains'] }, p2: { hand: [] }, defs: [DRAGON] });
    const id = find(s0, 'Test Dragon', 'battlefield', 'p1');
    const idx = s0.defs[s0.objects[id]!.defId]!.faces[0]!.abilities.findIndex((a: { kind: string }) => a.kind === 'activated');
    let s = act(s0, { type: 'activate', player: 'p1', source: id, ability: `p:0:${idx}` } as never);
    for (let g = 0; s.pending && s.pending.kind === 'payCost' && g < 5; g++) s = answer(s, { kind: 'payCost', auto: true });
    for (let g = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && g < 20; g++) s = pass(s);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

// ---- Mr. Foxglove ------------------------------------------------------------------------------------------------------------------------------------------------------
const FOX = card('Test Fox', 'Creature — Fox', "Whenever ~ attacks, draw cards equal to the number of cards in defending player's hand minus the number of cards in your hand. If you didn't draw cards this way, you may put a creature card from your hand onto the battlefield.", { pt: ['2', '2'] });
const CUB = card('Test Cub', 'Creature — Fox', '', { pt: ['1', '1'] });
describe('CR 121.1, 508.1, 608.2c: "draw cards equal to ... minus ...; if you didn\'t draw cards this way" (Mr. Foxglove)', () => {
  it('is automated', () => { expect(full(FOX)).toBe(true); });
  const attack = (mine: string[], theirs: number) => {
    const s0 = scenario([], { p1: { hand: mine, battlefield: ['Test Fox'] }, p2: { hand: filler(theirs) }, defs: [FOX, CUB] });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Fox', 'battlefield', 'p1')]]);
    for (let g = 0; g < 8 && s.pending?.kind !== 'priority'; g++) s = answer(s, { kind: 'yesNo', yes: true } as never);
    for (let g = 0; g < 10 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = pass(s);
    return s;
  };
  it('draws the difference when the defending player has more cards: no creature is put onto the battlefield', () => {
    const s = attack(['Test Cub'], 4);
    expect(handOf(s, 'p1')).toBe(4); // 1 card + 3 drawn
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Cub')).toHaveLength(0);
  });
  it('draws nothing when your hand is as big or bigger (the amount is never negative), then may put a creature card from the hand onto the battlefield', () => {
    let s = attack(['Test Cub', 'Plains', 'Plains'], 1);
    for (let g = 0; g < 6 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending as { kind: string };
      s = p.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Cub', 'hand', 'p1')] } as never) : answer(s, { kind: 'yesNo', yes: true } as never);
    }
    for (let g = 0; g < 10 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = pass(s);
    expect(handOf(s, 'p1')).toBe(2); // nothing drawn
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Cub')).toHaveLength(1);
  });
});

// ---- Vendilion Clique --------------------------------------------------------------------------------------------------------------------------------------------------
const FAERIE = card('Test Faerie', 'Creature — Faerie', "When ~ enters, look at target player's hand. You may choose a nonland card from it. If you do, that player reveals the chosen card, puts it on the bottom of their library, then draws a card.", { pt: ['3', '1'] });
const ORB = card('Test Orb', 'Artifact', '');
describe('CR 701.20a, 401.4, 121.1: "that player reveals the chosen card, puts it on the bottom of their library, then draws a card" (Vendilion Clique)', () => {
  it('is automated', () => { expect(full(FAERIE)).toBe(true); });
  const play = (theirHand: string[], choose: boolean) => {
    const s0 = scenario([], { p1: { hand: ['Test Faerie'] }, p2: { hand: theirHand }, defs: [FAERIE, ORB] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Faerie', 'hand', 'p1') } as never);
    for (let g = 0; g < 12 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      const p = s.pending as { kind: string };
      if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as never);
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: choose ? [find(s, 'Test Orb', 'hand', 'p2')] : [] } as never);
      else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: choose } as never);
      else s = pass(s);
    }
    return s;
  };
  it('the chosen nonland card goes to the bottom of its owner\'s library and that player draws a card', () => {
    const s = play(['Test Orb', 'Plains'], true);
    expect(s.zones.hand.p2!.map((id) => s.objects[id]!.defId)).not.toContain('Test Orb');
    const lib = s.zones.library.p2!;
    expect(s.objects[lib[lib.length - 1]!]!.defId).toBe('Test Orb');
    expect(handOf(s, 'p2')).toBe(2); // Plains kept, one card drawn
  });
  it('negative: choosing nothing changes nothing (no card put away, no draw)', () => {
    const s = play(['Test Orb', 'Plains'], false);
    expect(handOf(s, 'p2')).toBe(2);
    expect(s.zones.hand.p2!.map((id) => s.objects[id]!.defId)).toContain('Test Orb');
  });
  it('negative: only lands in hand: nothing can be chosen', () => {
    const s = play(['Plains', 'Plains'], false);
    expect(handOf(s, 'p2')).toBe(2);
  });
});

// ---- Tinybones, Trinket Thief ------------------------------------------------------------------------------------------------------------------------------------------
const BONES = card('Test Bones', 'Artifact', '{0}: Each opponent with no cards in hand loses 10 life.');
describe('CR 402.1, 119.3, 608.2c: "each opponent with no cards in hand loses 10 life" (Tinybones, Trinket Thief)', () => {
  it('is automated', () => { expect(full(BONES)).toBe(true); });
  const run = (theirs: string[]) => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bones'] }, p2: { hand: theirs }, defs: [BONES] });
    const id = find(s0, 'Test Bones', 'battlefield', 'p1');
    const idx = s0.defs[s0.objects[id]!.defId]!.faces[0]!.abilities.findIndex((a: { kind: string }) => a.kind === 'activated');
    let s = act(s0, { type: 'activate', player: 'p1', source: id, ability: `p:0:${idx}` } as never);
    for (let g = 0; s.pending && s.pending.kind === 'payCost' && g < 5; g++) s = answer(s, { kind: 'payCost', auto: true });
    for (let g = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && g < 20; g++) s = pass(s);
    return s;
  };
  it('an opponent with an empty hand loses 10 life', () => { expect(lifeOf(run([]), 'p2')).toBe(10); });
  it('negative: an opponent holding a card loses nothing; you lose nothing either way', () => {
    const s = run(['Plains']);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

// ---- Breakthrough ------------------------------------------------------------------------------------------------------------------------------------------------------
const BREAK = cardX('Test Breakthrough', 'Sorcery', 'Draw four cards, then choose X cards in your hand and discard the rest.', '{X}');
describe('CR 701.9a, 608.2d, 107.3: "Draw four cards, then choose X cards in your hand and discard the rest" (Breakthrough)', () => {
  it('is automated', () => { expect(full(BREAK)).toBe(true); });
  const start = () => scenario([], { p1: { hand: ['Test Breakthrough'], battlefield: filler(3) }, p2: {}, defs: [BREAK] });
  it('X = 2: you keep two cards of the five-card hand you drew into (one more is Plains): three discarded', () => {
    const s0 = start();
    // the hand after casting is empty; four cards are drawn from the 20-card library of Plains; two chosen are kept
    const s = resolveAll(castX(s0, 'Test Breakthrough', { x: [2] }), {});
    expect(handOf(s, 'p1')).toBe(2);
    expect(s.zones.graveyard.p1!.length).toBe(3); // the spell + two discarded cards
  });
  it('negative: X = 0 discards the whole hand drawn; X larger than the hand keeps all of it', () => {
    const none = resolveAll(castX(start(), 'Test Breakthrough', { x: [0] }), {});
    expect(handOf(none, 'p1')).toBe(0);
    const big = scenario([], { p1: { hand: ['Test Breakthrough'], battlefield: filler(6) }, p2: {}, defs: [BREAK] });
    const all = resolveAll(castX(big, 'Test Breakthrough', { x: [6] }), {});
    expect(handOf(all, 'p1')).toBe(4); // X larger than the 4-card hand keeps all of it
  });
});
