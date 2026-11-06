/**
 * Commander EDHREC ranks 17,501-18,125, round edh-c-18: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 701.9a, 701.17a, 119.3    "Target opponent discards two cards, mills two cards, and loses 2 life."
 *   CR 502.3, 611.2a, 611.2c     "Creatures and lands target opponent controls don't untap during their next untap step."
 *   CR 701.26b, 608.2d           "At the beginning of each player's upkeep, that player untaps a land they control."
 *   CR 614.10, 504.1, 500.11     "If you do, you skip your draw step this turn."
 *   CR 701.39a, 107.3            "Bolster X, where X is the number of tapped creatures you control."
 *   CR 205.3m, 608.2d, 613.1d    "When ~ is turned face up, it becomes the creature type of your choice."
 *   CR 105.2, 121.1, 608.2h      "Whenever you cast a spell, you may discard your hand. If you do, draw a card for each of that spell's colors."
 *   CR 402.1, 120.3, 608.2c      "At the beginning of each opponent's upkeep, ~ deals 2 damage to that player unless they have exactly three or exactly four cards in hand."
 *   CR 509.1h, 506.4, 510.1      "At end of combat, destroy each creature that blocked or was blocked this turn."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { attackWith, card, cast, counters, full, resolveAll, settle, type Picks } from '../cmd3/helpers';

const inHand = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const inYard = (s: GameState, p: string): number => s.zones.graveyard[p]!.length;
const inLib = (s: GameState, p: string): number => s.zones.library[p]!.length;
const OPP = [{ kind: 'player' as const, id: 'p2' }];

describe('CR 701.9a, 701.17a, 119.3: "Target opponent discards two cards, mills two cards, and loses 2 life."', () => {
  const CLUTCH = card('Test Grim Grasp', 'Sorcery', 'Target opponent discards two cards, mills two cards, and loses 2 life.');
  const start = (): GameState => scenario([], { defs: [CLUTCH], p1: { hand: ['Test Grim Grasp', 'Plains'] }, p2: { hand: ['Plains', 'Plains', 'Plains'], library: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
  it('is full', () => expect(full(CLUTCH)).toBe(true));
  it('the opponent discards two cards, mills two cards and loses 2 life, in that order of the sentence', () => {
    const s = resolveAll(cast(start(), 'Test Grim Grasp', { targets: OPP }), { targets: OPP });
    expect(inHand(s, 'p2')).toBe(1);
    expect(inYard(s, 'p2')).toBe(4); // two discarded and two milled
    expect(inLib(s, 'p2')).toBe(inLib(start(), 'p2') - 2);
    expect(life(s, 'p2')).toBe(18);
  });
  it('negative: the caster discards nothing, mills nothing and keeps their life', () => {
    const s = resolveAll(cast(start(), 'Test Grim Grasp', { targets: OPP }), { targets: OPP });
    expect(inHand(s, 'p1')).toBe(1);
    expect(life(s, 'p1')).toBe(20);
    expect(inYard(s, 'p1')).toBe(1); // only the spell itself
  });
  it('a hand of one card: discards what it has (CR 701.9b-like) and the mill and life loss still happen', () => {
    const s0 = tweak(start(), (t) => { t.zones.hand['p2'] = t.zones.hand['p2']!.slice(0, 1); });
    const s = resolveAll(cast(s0, 'Test Grim Grasp', { targets: OPP }), { targets: OPP });
    expect(inHand(s, 'p2')).toBe(0);
    expect(life(s, 'p2')).toBe(18);
    expect(inLib(s, 'p2')).toBe(inLib(start(), 'p2') - 2);
  });
});

describe('CR 502.3, 611.2a, 611.2c: "Creatures and lands target opponent controls don\'t untap during their next untap step."', () => {
  const FROST = card('Test Long Frost', 'Sorcery', "Creatures and lands target opponent controls don't untap during their next untap step.");
  const MOUSE = card('Test Frost Mouse', 'Creature — Mouse', '', ['1', '1']);
  const ROCK = card('Test Frost Rock', 'Artifact', '');
  const start = (): GameState => scenario([], {
    defs: [FROST, MOUSE, ROCK],
    p1: { hand: ['Test Long Frost'], battlefield: [{ name: 'Plains', tapped: true }, { name: 'Test Frost Mouse', tapped: true }] },
    p2: { battlefield: [{ name: 'Plains', tapped: true }, { name: 'Test Frost Mouse', tapped: true }, { name: 'Test Frost Rock', tapped: true }] },
  });
  const tapped = (s: GameState, p: string, name: string): boolean => findAll(s, name, 'battlefield', p).every((id) => s.objects[id]!.tapped);
  it('is full', () => expect(full(FROST)).toBe(true));
  it("the opponent's creatures and lands stay tapped through their next untap step and untap in the one after it", () => {
    let s = resolveAll(cast(start(), 'Test Long Frost', { targets: OPP }), { targets: OPP });
    s = advanceTo(s, 2, 'upkeep'); // the untap step of the opponent's turn has passed
    expect(tapped(s, 'p2', 'Plains')).toBe(true);
    expect(tapped(s, 'p2', 'Test Frost Mouse')).toBe(true);
    s = advanceTo(s, 4, 'upkeep'); // and their following untap step is a normal one
    expect(tapped(s, 'p2', 'Plains')).toBe(false);
    expect(tapped(s, 'p2', 'Test Frost Mouse')).toBe(false);
  });
  it('negative: an opponent permanent that is not a creature or land untaps, and so do my own permanents in my own untap step', () => {
    let s = resolveAll(cast(start(), 'Test Long Frost', { targets: OPP }), { targets: OPP });
    s = advanceTo(s, 2, 'upkeep');
    expect(tapped(s, 'p2', 'Test Frost Rock')).toBe(false);
    s = advanceTo(s, 3, 'upkeep');
    expect(tapped(s, 'p1', 'Plains')).toBe(false);
    expect(tapped(s, 'p1', 'Test Frost Mouse')).toBe(false);
  });
  it("a creature or land that comes under their control afterwards is held too (rules-modifying effect, CR 611.2c; ruling 2009-10-01)", () => {
    let s = resolveAll(cast(start(), 'Test Long Frost', { targets: OPP }), { targets: OPP });
    s = tweak(s, (t) => {
      const late = findAll(t, 'Test Frost Mouse', 'battlefield', 'p1')[0]!;
      t.objects[late]!.controller = 'p2'; // a tapped creature that came under their control after the spell resolved
    });
    s = advanceTo(s, 2, 'upkeep');
    const mice = findAll(s, 'Test Frost Mouse', 'battlefield').filter((id) => s.objects[id]!.controller === 'p2');
    expect(mice.length).toBe(2);
    expect(mice.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});

/** Like m3/scenario#advanceTo, but answers the ordinary decisions on the way (a choice of objects, a yes or no, a payment). */
function go(s0: GameState, turn: number, step: GameState['turn']['step'], picks: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 600; guard++) {
    if (s.turn.number === turn && s.turn.step === step && s.pending?.kind === 'priority') return s;
    if (s.result) throw new Error(`The game ended before turn ${turn} ${step}`);
    const d = s.pending;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d?.kind === 'priority') s = pass(s);
    else s = settle(s, picks);
  }
  throw new Error(`Could not reach turn ${turn} ${step}`);
}

describe('CR 701.26b, 608.2d: "At the beginning of each player\'s upkeep, that player untaps a land they control."', () => {
  const WATERS = card('Test Rising Tide', 'Enchantment', "Lands don't untap during their controllers' untap steps.\nAt the beginning of each player's upkeep, that player untaps a land they control.");
  const start = (): GameState => scenario([], {
    defs: [WATERS],
    p1: { battlefield: ['Test Rising Tide', { name: 'Plains', tapped: true }, { name: 'Plains', tapped: true }, { name: 'Plains', tapped: true }] },
    p2: { battlefield: [{ name: 'Plains', tapped: true }, { name: 'Plains', tapped: true }] },
  });
  const untapped = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && getChars(s, id)!.types.includes('Land') && !s.objects[id]!.tapped).length;
  it('is full', () => expect(full(WATERS)).toBe(true));
  it("on its own upkeep each player untaps exactly one land they control (lands don't untap in the untap step)", () => {
    let s = resolveAll(go(start(), 2, 'upkeep'));
    expect(untapped(s, 'p2')).toBe(1);
    expect(untapped(s, 'p1')).toBe(0); // the game starts in p1's first main phase: no upkeep of p1 has passed yet
    s = resolveAll(go(s, 3, 'upkeep'));
    expect(untapped(s, 'p1')).toBe(1);
    expect(untapped(s, 'p2')).toBe(1);
  });
  it('negative: the upkeep of the other player untaps nothing of mine', () => {
    const s = resolveAll(go(start(), 2, 'upkeep'));
    expect(untapped(s, 'p1')).toBe(0);
  });
});

describe('CR 614.10, 504.1, 500.11: "If you do, you skip your draw step this turn." (after a search)', () => {
  const SANCTUARY = card('Test Quiet Grove', 'Enchantment', 'At the beginning of your upkeep, you may search your library for a basic land card, reveal that card, put it into your hand, then shuffle. If you do, you skip your draw step this turn.');
  const WATCHER = card('Test Draw Watcher', 'Creature — Owl', 'Whenever you draw a card, you gain 1 life.', ['1', '1']);
  const start = (): GameState => scenario([], { defs: [SANCTUARY, WATCHER], p1: { battlefield: ['Test Quiet Grove', 'Test Draw Watcher'], library: ['Plains', 'Plains', 'Plains'] } });
  const landInLibrary = (s: GameState): ObjectId => s.zones.library['p1']!.find((id) => s.objects[id]!.defId === 'Plains')!;
  it('is full', () => expect(full(SANCTUARY)).toBe(true));
  it('searching skips this turn\'s draw step: the watcher sees no draw, the land came from the search', () => {
    const s0 = start();
    let s = go(s0, 3, 'upkeep', { yes: true, objects: [landInLibrary(s0)] });
    s = resolveAll(s, { yes: true, objects: [landInLibrary(s)] });
    expect(inHand(s, 'p1')).toBe(inHand(s0, 'p1') + 1); // the searched land
    const before = life(s, 'p1');
    const handBefore = inHand(s, 'p1');
    s = go(s, 3, 'main1');
    expect(life(s, 'p1')).toBe(before); // no card was drawn in the draw step
    expect(inHand(s, 'p1')).toBe(handBefore);
  });
  it('negative: declining the search keeps the draw step (the watcher sees the draw)', () => {
    let s = resolveAll(go(start(), 3, 'upkeep'), { yes: false });
    const before = life(s, 'p1');
    s = go(s, 3, 'main1');
    expect(life(s, 'p1')).toBe(before + 1);
  });
  it("accepting the search but finding no land still skips the draw step (ruling 2004-10-04: \"if you do\" means if you search)", () => {
    const s0 = tweak(start(), (t) => { t.zones.library['p1'] = []; });
    let s = resolveAll(go(s0, 3, 'upkeep', { yes: true }), { yes: true });
    s = go(s, 3, 'main1');
    expect(s.result).toBeFalsy(); // drawing from the empty library would have lost the game
  });
  it('negative: the skip lasts this turn only (the next turn\'s draw step happens)', () => {
    const s0 = start();
    let s = resolveAll(go(s0, 3, 'upkeep', { yes: true, objects: [landInLibrary(s0)] }), { yes: true, objects: [landInLibrary(s0)] });
    s = go(s, 4, 'upkeep');
    const before = life(s, 'p1');
    s = go(s, 5, 'main1', { yes: false });
    expect(life(s, 'p1')).toBe(before + 1); // turn 5's draw step happens
  });
});

describe('CR 701.39a, 107.3: "Bolster X, where X is the number of tapped creatures you control."', () => {
  const GENERAL = card('Test Rally Marshal', 'Creature — Soldier', 'At the beginning of your end step, bolster X, where X is the number of tapped creatures you control.', ['2', '2']);
  const SMALL = card('Test Small Soldier', 'Creature — Soldier', '', ['1', '1']);
  const BIG = card('Test Big Soldier', 'Creature — Soldier', '', ['4', '4']);
  const start = (tappedMarshal: boolean): GameState => scenario([], {
    defs: [GENERAL, SMALL, BIG],
    p1: { battlefield: [{ name: 'Test Rally Marshal', tapped: tappedMarshal }, { name: 'Test Small Soldier', tapped: true }, { name: 'Test Big Soldier' }] },
    p2: { battlefield: [{ name: 'Test Small Soldier', tapped: true }] },
  });
  it('is full', () => expect(full(GENERAL)).toBe(true));
  it('puts as many +1/+1 counters as tapped creatures you control on the creature with the least toughness among your creatures', () => {
    const s0 = start(true);
    const s = resolveAll(go(s0, 1, 'end'));
    const small = findAll(s, 'Test Small Soldier', 'battlefield', 'p1')[0]!;
    const marshal = findAll(s, 'Test Rally Marshal', 'battlefield', 'p1')[0]!;
    expect(counters(s, small, '+1/+1')).toBe(0 + 2 - 0); // two tapped creatures of mine (the marshal and the small one) -> X = 2, the least toughness is 1 (the small soldier)
    expect(counters(s, marshal, '+1/+1')).toBe(0);
  });
  it("negative: an opponent's tapped creatures are not counted", () => {
    const s = resolveAll(go(start(false), 1, 'end'));
    const small = findAll(s, 'Test Small Soldier', 'battlefield', 'p1')[0]!;
    expect(counters(s, small, '+1/+1')).toBe(1); // only my tapped small soldier counts
  });
});

/** Like helpers#resolveAll, but a "choose a creature type" decision is answered with this name. */
function resolveNaming(s0: GameState, name: string, picks: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 60; guard++) {
    if (s.pending?.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name });
    else if (s.pending && s.pending.kind !== 'priority') s = settle(s, picks);
    else if (s.zones.stack.length > 0) s = pass(s);
    else return s;
  }
  throw new Error('did not settle');
}

describe('CR 205.3m, 608.2d, 613.1d: "When ~ enters, it becomes the creature type of your choice." (no duration: for good, CR 611.2a)', () => {
  const MACHINE = card('Test Shape Engine', 'Artifact Creature — Shapeshifter', 'When this creature enters, it becomes the creature type of your choice.', ['2', '2']);
  it('is full', () => expect(full(MACHINE)).toBe(true));
  it('the creature has only the chosen creature type afterwards, and still has it in the next turn', () => {
    const s0 = scenario([], { defs: [MACHINE], p1: { hand: ['Test Shape Engine'] } });
    let s = resolveNaming(cast(s0, 'Test Shape Engine'), 'Wizard');
    const id = findAll(s, 'Test Shape Engine', 'battlefield', 'p1')[0]!;
    expect(getChars(s, id)!.subtypes).toEqual(['Wizard']);
    s = go(s, 3, 'main1');
    expect(getChars(s, id)!.subtypes).toEqual(['Wizard']);
  });
  it('negative: it does not change the creature types of another creature', () => {
    const other = card('Test Plain Owl', 'Creature — Bird', '', ['1', '1']);
    const s0 = scenario([], { defs: [MACHINE, other], p1: { hand: ['Test Shape Engine'], battlefield: ['Test Plain Owl'] } });
    const s = resolveNaming(cast(s0, 'Test Shape Engine'), 'Wizard');
    expect(getChars(s, findAll(s, 'Test Plain Owl', 'battlefield', 'p1')[0]!)!.subtypes).toEqual(['Bird']);
  });
});

describe('CR 105.2, 121.1, 608.2h: "Whenever you cast a spell, you may discard your hand. If you do, draw a card for each of that spell\'s colors."', () => {
  const REGENT = card('Test Color Drake', 'Creature — Drake', "Whenever you cast a spell, you may discard your hand. If you do, draw a card for each of that spell's colors.", ['3', '3']);
  const spell = (name: string, colors: string[]) => compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Instant', oracle_text: 'You gain 1 life.', colors } as OracleCard);
  const TWO = spell('Test Twin Spark', ['U', 'R']);
  const ONE = spell('Test Lone Spark', ['U']);
  const NONE = spell('Test Pale Spark', []);
  const start = (name: string): GameState => scenario([], { defs: [REGENT, TWO, ONE, NONE], p1: { battlefield: ['Test Color Drake'], hand: [name, 'Plains', 'Plains', 'Plains'], library: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
  it('is full', () => expect(full(REGENT)).toBe(true));
  it('discarding the hand draws one card per color of the spell: two for a two-colored spell', () => {
    const s = resolveAll(cast(start('Test Twin Spark'), 'Test Twin Spark', { yes: true }), { yes: true });
    expect(inHand(s, 'p1')).toBe(2);
    expect(inYard(s, 'p1')).toBe(4); // the three discarded Plains and the spell
  });
  it('one card for a one-colored spell, none for a colorless one', () => {
    expect(inHand(resolveAll(cast(start('Test Lone Spark'), 'Test Lone Spark', { yes: true }), { yes: true }), 'p1')).toBe(1);
    expect(inHand(resolveAll(cast(start('Test Pale Spark'), 'Test Pale Spark', { yes: true }), { yes: true }), 'p1')).toBe(0);
  });
  it('negative: declining keeps the hand and draws nothing', () => {
    const s = resolveAll(cast(start('Test Twin Spark'), 'Test Twin Spark', { yes: false }), { yes: false });
    expect(inHand(s, 'p1')).toBe(3);
  });
});

describe('CR 402.1, 120.3, 608.2c: "At the beginning of each opponent\'s upkeep, ~ deals 2 damage to that player unless they have exactly three or exactly four cards in hand."', () => {
  const CAGE = card('Test Bone Box', 'Artifact', "At the beginning of each opponent's upkeep, this artifact deals 2 damage to that player unless they have exactly three or exactly four cards in hand.");
  const start = (cards: number): GameState => scenario([], { defs: [CAGE], p1: { battlefield: ['Test Bone Box'] }, p2: { hand: Array.from({ length: cards }, () => 'Plains') } });
  const lifeAfterUpkeep = (cards: number): number => life(resolveAll(go(start(cards), 2, 'upkeep')), 'p2');
  it('is full', () => expect(full(CAGE)).toBe(true));
  it('deals 2 damage to an opponent with two, five or no cards in hand', () => {
    expect(lifeAfterUpkeep(2)).toBe(18);
    expect(lifeAfterUpkeep(5)).toBe(18);
    expect(lifeAfterUpkeep(0)).toBe(18);
  });
  it('deals nothing to an opponent with exactly three or exactly four cards in hand', () => {
    expect(lifeAfterUpkeep(3)).toBe(20);
    expect(lifeAfterUpkeep(4)).toBe(20);
  });
  it('negative: my own upkeep deals nothing to me, whatever my hand', () => {
    const s = resolveAll(go(tweak(start(3), (t) => { t.zones.hand['p1'] = []; }), 3, 'upkeep'));
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 509.1h, 506.4, 510.1: "At end of combat, destroy each creature that blocked or was blocked this turn."', () => {
  const STROKE = card('Test Heat Wave', 'Enchantment', 'At end of combat, destroy each creature that blocked or was blocked this turn.');
  const BEAR = card('Test Combat Bear', 'Creature — Bear', '', ['1', '4']); // survives combat damage, so only the trigger can destroy it
  const start = (): GameState => scenario([], {
    defs: [STROKE, BEAR],
    p1: { battlefield: ['Test Heat Wave', 'Test Combat Bear', 'Test Combat Bear'] },
    p2: { battlefield: ['Test Combat Bear', 'Test Combat Bear'] },
  });
  const survivors = (s: GameState, p: string): number => findAll(s, 'Test Combat Bear', 'battlefield', p).length;
  /** p1 attacks with both bears; p2's first bear blocks p1's first bear (if `block`). */
  function play(block: boolean): GameState {
    let s = start();
    const mine = findAll(s, 'Test Combat Bear', 'battlefield', 'p1');
    const theirs = findAll(s, 'Test Combat Bear', 'battlefield', 'p2');
    s = attackWith(s, mine);
    for (let guard = 0; guard < 40 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; guard++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: block ? [{ blocker: theirs[0]!, attacker: mine[0]! }] : [] });
      else if (s.pending?.kind === 'assignDamage' || s.pending?.kind === 'chooseObjects' || s.pending?.kind === 'order') s = settle(s);
      else s = pass(s);
    }
    return resolveAll(s);
  }
  it('is full', () => expect(full(STROKE)).toBe(true));
  it('destroys the blocker and the blocked attacker, not the unblocked attacker or the creature that did not block', () => {
    const s = play(true);
    expect(survivors(s, 'p1')).toBe(1); // the unblocked attacker
    expect(survivors(s, 'p2')).toBe(1); // the bear that did not block
  });
  it('negative: with no block, nothing is destroyed (an attacker that was never blocked, a creature that never blocked)', () => {
    const s = play(false);
    expect(survivors(s, 'p1')).toBe(2);
    expect(survivors(s, 'p2')).toBe(2);
  });
});
