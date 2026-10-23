/**
 * std-rx4 (card wave 2, slice s23): the round's readings and render folds played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 119.3, 608.2c     "choose target opponent. If they lost life this turn, they reveal their hand, you choose a <card> from it, and they discard that card.
 *                         Otherwise, ..." (the condition reads the chosen opponent's life lost this turn; the hand revealed inside the branch is "it")
 *   CR 406.1, 608.2g     "You may exile a nonland card from among them. ... You may cast the exiled card without paying its mana cost." (the exiled card is cast)
 *   CR 701.21a, 608.2h   "You may sacrifice a creature. If you do, draw cards equal to the sacrificed creature's power." (its last known power)
 *   CR 120.4a, 106.4     "If the creature an opponent controls is dealt excess damage this way, add that much {R}." (the excess of the fight only)
 *   CR 500.5, 611.2a     "Until end of turn, you don't lose unspent red mana as steps and phases end." (red mana stays, other mana empties)
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario, zoneNames } from '../../m3/scenario';
import { card, full } from '../cmd3/helpers';

const hand = (s: GameState, p: string): string[] => zoneNames(s, 'hand', p);
const yard = (s: GameState, p: string): string[] => zoneNames(s, 'graveyard', p);
const pool = (s: GameState): string => s.players[0]!.manaPool.map((u) => u.type).sort().join('');
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
interface Run { targets?: TargetChoice[][]; yes?: boolean; objects?: 'stop' | 'first' }
/**
 * Let the game go on until the stack is empty, answering targets (in order; else the first legal one), payments and "you may" choices; a choice of objects
 * stops the run (`objects: 'stop'`, the default, so the test answers it) or takes the first `min` options.
 */
function run(s0: GameState, o: Run = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; s.pending && guard < 60; guard++) {
    const d = s.pending;
    if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') {
      const first: TargetChoice[] = d.objects.length > 0 ? [{ kind: 'object', id: d.objects[0]! }] : [{ kind: 'player', id: d.players[0]! }];
      s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? first.slice(0, Math.max(d.min, 1)) });
    } else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (d.kind === 'chooseObjects' && o.objects === 'first') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    else break;
  }
  return s;
}
const castCard = (s: GameState, name: string, o: Run = {}): GameState => run(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o);

describe('CR 119.3, 608.2c: "choose target opponent. If they lost life this turn, they reveal their hand, you choose ... from it, and they discard that card"', () => {
  const SEER = card('Test Seer', 'Creature — Lizard', 'When this creature enters, choose target opponent. If they lost life this turn, they reveal their hand, you choose a creature card from it, and they discard that card. Otherwise, they discard a card.', ['2', '2']);
  const SAP = card('Test Sap', 'Instant', 'Target opponent loses 1 life.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const CUB = card('Test Cub', 'Creature — Bear', '', ['1', '1']);
  const DEFS = [SEER, SAP, BEAR, CUB];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Seer', 'Test Sap'] }, p2: { hand: ['Test Bear', 'Test Cub', 'Plains'] }, defs: DEFS });
  it('the synthetic cards are fully automated', () => {
    for (const d of DEFS) expect(full(d), d.name).toBe(true);
  });
  it('the opponent lost life this turn: their hand is revealed, you choose a creature card from it and they discard it', () => {
    let s = castCard(start(), 'Test Sap');
    expect(s.players[1]!.life).toBe(19);
    // the enters trigger: its target is the one opponent; then your choice among the creature cards of the revealed hand
    s = castCard(s, 'Test Seer');
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending!.player).toBe('p1');
    const options = (s.pending as { options: ObjectId[] }).options;
    expect(options.map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear', 'Test Cub']); // the land is no creature card
    s = run(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Cub', 'hand', 'p2')] }));
    expect(yard(s, 'p2')).toEqual(['Test Cub']);
    expect(hand(s, 'p2').sort()).toEqual(['Plains', 'Test Bear']);
  });
  it('the opponent lost no life this turn: they discard a card of their own choice instead (CR 701.9a)', () => {
    let s = castCard(start(), 'Test Seer');
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending!.player).toBe('p2'); // the discarding player chooses, not you
    const plains = find(s, 'Plains', 'hand', 'p2');
    s = run(answer(s, { kind: 'chooseObjects', ids: [plains] }));
    expect(yard(s, 'p2')).toEqual(['Plains']);
    expect(hand(s, 'p2').sort()).toEqual(['Test Bear', 'Test Cub']);
  });
});

describe('CR 406.1, 608.2g: "You may exile a nonland card from among them. ... You may cast the exiled card without paying its mana cost."', () => {
  const PEEK = card('Test Peek', 'Sorcery', 'Look at the top three cards of your library. You may exile a nonland card from among them. Put the rest into your graveyard. You may cast the exiled card without paying its mana cost.');
  const GIFT = card('Test Gift', 'Sorcery', 'You gain 4 life.', undefined, '{7}');
  const DEFS = [PEEK, GIFT];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Peek'], library: ['Plains', 'Test Gift', 'Plains'] }, defs: DEFS });
  const toChoice = (s0: GameState): GameState => castCard(s0, 'Test Peek');
  it('the synthetic cards are fully automated', () => {
    expect(full(PEEK)).toBe(true);
  });
  it('the exiled card is the one cast, for free; the rest of the cards looked at go to the graveyard', () => {
    let s = toChoice(start());
    const options = (s.pending as { options: ObjectId[] }).options;
    expect(options.map((id) => nameOf(s, id))).toEqual(['Test Gift']); // nonland only
    const before = s.players[0]!.life;
    s = run(answer(s, { kind: 'chooseObjects', ids: options }), { yes: true });
    expect(s.players[0]!.life).toBe(before + 4); // cast without its {7} and resolved
    expect(yard(s, 'p1').sort()).toEqual(['Plains', 'Plains', 'Test Gift', 'Test Peek'].sort());
  });
  it('nothing exiled: nothing is cast, all three cards go to the graveyard', () => {
    let s = toChoice(start());
    const before = s.players[0]!.life;
    s = run(answer(s, { kind: 'chooseObjects', ids: [] }), { yes: true });
    expect(s.players[0]!.life).toBe(before);
    expect(yard(s, 'p1').sort()).toEqual(['Plains', 'Plains', 'Test Gift', 'Test Peek'].sort());
  });
});

describe('CR 701.21a, 608.2h: "You may sacrifice a creature. If you do, draw cards equal to the sacrificed creature\'s power."', () => {
  const OFFER = card('Test Offer', 'Sorcery', "You may sacrifice a creature. If you do, draw cards equal to the sacrificed creature's power.");
  const BANNER = card('Test Banner', 'Enchantment', 'Creatures you control get +1/+0.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [OFFER, BANNER, BEAR];
  const start = (): GameState => scenario([], { p1: { hand: ['Test Offer'], battlefield: ['Test Bear', 'Test Banner'] }, defs: DEFS });
  it('the synthetic cards are fully automated', () => {
    expect(full(OFFER)).toBe(true);
  });
  it('the power the creature had as it was sacrificed counts (its last known information: 2 base, +1 from the anthem), not the card in the graveyard', () => {
    const s0 = start();
    const cards = hand(s0, 'p1').length;
    const s = castCard(s0, 'Test Offer', { yes: true, objects: 'first' });
    expect(yard(s, 'p1')).toContain('Test Bear');
    expect(hand(s, 'p1').length).toBe(cards - 1 + 3);
  });
  it('no sacrifice: no card is drawn', () => {
    const s0 = start();
    const cards = hand(s0, 'p1').length;
    const s = castCard(s0, 'Test Offer', { yes: false, objects: 'first' });
    expect(yard(s, 'p1')).toEqual(['Test Offer']);
    expect(hand(s, 'p1').length).toBe(cards - 1);
  });
});

describe('CR 120.4a, 106.4, 500.5: "If the creature an opponent controls is dealt excess damage this way, add that much {R}. Until end of turn, you don\'t lose unspent red mana ..."', () => {
  const DUEL = card('Test Duel', 'Instant', "Target creature you control fights target creature an opponent controls. If the creature an opponent controls is dealt excess damage this way, add that much {R}.\nUntil end of turn, you don't lose unspent red mana as steps and phases end.");
  const GIANT = card('Test Giant', 'Creature — Giant', '', ['5', '5']);
  const PUP = card('Test Pup', 'Creature — Dog', '', ['2', '2']);
  const HULK = card('Test Hulk', 'Creature — Golem', '', ['5', '7']);
  const DEFS = [DUEL, GIANT, PUP, HULK];
  const fight = (theirs: string): GameState => {
    let s = scenario([], { p1: { hand: ['Test Duel'], battlefield: ['Test Giant'] }, p2: { battlefield: [theirs] }, defs: DEFS });
    const mine = find(s, 'Test Giant', 'battlefield');
    const other = find(s, theirs, 'battlefield');
    return castCard(s, 'Test Duel', { targets: [[{ kind: 'object', id: mine }], [{ kind: 'object', id: other }]] });
  };
  it('the synthetic cards are fully automated', () => {
    expect(full(DUEL)).toBe(true);
  });
  it('5 damage to a 2/2: 3 excess, so {R}{R}{R}; the red mana stays as the step ends (CR 500.5 does not empty it this turn)', () => {
    let s = fight('Test Pup');
    expect(yard(s, 'p2')).toEqual(['Test Pup']);
    expect(pool(s)).toBe('RRR');
    s = advanceTo(s, 1, 'end');
    expect(pool(s)).toBe('RRR');
  });
  it('5 damage to a 5/7: no excess, no mana', () => {
    const s = fight('Test Hulk');
    expect(pool(s)).toBe('');
  });
});
