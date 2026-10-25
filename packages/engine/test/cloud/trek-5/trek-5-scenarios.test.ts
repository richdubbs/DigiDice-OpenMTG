/**
 * Lane trek, round trek-5 (Star Trek: differently named lands, hand size, life, Treasure, returned to hand), played through the engine with synthetic cards
 * compiled by the game's default compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 402.2, 514.1, 611.2a  "You have no maximum hand size until your next turn.": no discard in the cleanup step of that turn, none in the opponent's turn
 *                            for you either; the maximum is back once your next turn begins; the opponent keeps seven throughout
 *   CR 119.5, 701.10         "Double your life total.": the life total is set to twice itself, a life gain (a life loss, twice as far below 0, when it is negative)
 *   CR 701.21a, 101.2        "You can't sacrifice Treasure tokens.": a Treasure's own mana ability, an effect that sacrifices; the opponent's Treasures are free
 *   CR 201.2, 608.2c, 602.5b "N or more differently named lands you control": the different names among the lands, once each; "unless" and "activate only if"
 *   CR 118.9, 601.2, 400.7   Commander Spock: reveal, cast free if its mana value is low enough, a land tapped onto the battlefield, draw if still on top
 *   CR 406.1, 611.2b, 305.1  Ensign Pavel Chekov: exile the top X cards of each opponent's library, choose a land card for each, play it while it stays exiled
 *   CR 603.4, 400.3          Miles O'Brien: at each end step, if a permanent was returned to your hand from the battlefield this turn, draw a card
 *   CR 704.5a, 104.3b, 119.3  Georgiou, Terran Emperor: no loss for 0 or less life, the end step's loss of 3 life, the draw, the ten Officers at 0 or less life
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, ptNumbers, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { maxHandSize } from '../../../src/statics/hooks';
import { cast, drive, resolveAll, target } from '../../m5/cr-examples/helpers';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const FILLER = (n: number): string[] => Array(n).fill('Plains') as string[];

/**
 * Pass until the active player's cleanup step asks for a discard to hand size (CR 514.1), answering it with the first cards offered, or until the next turn
 * begins. Returns the state and how many cards the cleanup asked to discard (0 when it asked nothing).
 */
function throughCleanup(s0: GameState): { s: GameState; discarded: number } {
  let s = s0;
  const turn = s.turn.number;
  let discarded = 0;
  for (let guard = 0; s.turn.number === turn && guard < 200; guard++) {
    const d = s.pending;
    if (d?.kind === 'chooseObjects' && d.rules?.includes('CR 514.1') === true) {
      discarded = d.min;
      s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    } else if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d !== null && d !== undefined && d.kind !== 'priority') s = drive(s);
    else s = pass(s);
  }
  return { s, discarded };
}

// ---- CR 402.2, 514.1, 611.2a: "You have no maximum hand size until your next turn." -----------------------------------------------------------------------

describe('CR 402.2, 514.1, 611.2a: "Draw two cards. You have no maximum hand size until your next turn."', () => {
  const SIGHT = card('Test Far Sight', 'Sorcery', 'Draw two cards. You have no maximum hand size until your next turn.');
  const BRIEF = card('Test Brief Sight', 'Sorcery', 'Draw two cards. You have no maximum hand size this turn.');
  const base = (name: string) => scenario([], { defs: [SIGHT, BRIEF], p1: { hand: [name, ...FILLER(8)] }, p2: { hand: FILLER(9) } });
  it('is fully automated', () => {
    expect(full(SIGHT)).toBe(true);
    expect(full(BRIEF)).toBe(true);
  });
  it('without it the cleanup step of the turn discards down to seven', () => {
    const s0 = scenario([], { defs: [SIGHT], p1: { hand: FILLER(9) } });
    expect(maxHandSize(s0, 'p1')).toBe(7);
    expect(throughCleanup(s0).discarded).toBe(2);
  });
  it('after it resolves its caster discards nothing in that cleanup step and in the opponent\'s turn the opponent still discards down to seven', () => {
    let s = cast(base('Test Far Sight'), 'Test Far Sight');
    s = resolveAll(s);
    expect(handSize(s, 'p1')).toBe(10);
    expect(maxHandSize(s, 'p1')).toBeNull();
    expect(maxHandSize(s, 'p2')).toBe(7);
    const t1 = throughCleanup(s);
    expect(t1.discarded).toBe(0);
    expect(handSize(t1.s, 'p1')).toBe(10);
    expect(maxHandSize(t1.s, 'p1')).toBeNull(); // still, on the opponent's turn 2
    const t2 = throughCleanup(t1.s);
    expect(t2.discarded).toBeGreaterThan(0); // p2 draws a card in turn 2 and holds more than seven
    expect(handSize(t2.s, 'p2')).toBe(7);
  });
  it('CR 611.2a: it ends as the caster\'s next turn begins: that turn\'s cleanup step discards down to seven again', () => {
    let s = resolveAll(cast(base('Test Far Sight'), 'Test Far Sight'));
    s = throughCleanup(throughCleanup(s).s).s;
    expect(s.turn.number).toBe(3);
    expect(maxHandSize(s, 'p1')).toBe(7);
    const t3 = throughCleanup(s);
    expect(t3.discarded).toBeGreaterThan(0);
    expect(handSize(t3.s, 'p1')).toBe(7);
  });
  it('"this turn": no discard in this cleanup step, and the maximum is seven again the turn after', () => {
    let s = resolveAll(cast(base('Test Brief Sight'), 'Test Brief Sight'));
    expect(maxHandSize(s, 'p1')).toBeNull();
    const t1 = throughCleanup(s);
    expect(t1.discarded).toBe(0);
    s = t1.s;
    expect(maxHandSize(s, 'p1')).toBe(7);
  });
});

// ---- CR 119.5, 701.10: "Double your life total." ---------------------------------------------------------------------------------------------------------

describe('CR 119.5, 701.10: "Double your life total." and "Double target player\'s life total."', () => {
  const DOUBLE = card('Test Doubling', 'Sorcery', 'Double your life total.');
  const PROSPER = card('Test Long Prosperity', 'Sorcery', "This spell can't be countered.\nDouble your life total. Draw cards equal to the number of cards in your hand. You have no maximum hand size until your next turn.");
  const BEACON = card('Test Twin Beacon', 'Instant', "Double target player's life total. Shuffle ~ into its owner's library.");
  const LIGHT = card('Test Lifelight', 'Enchantment', 'Whenever you gain life, draw a card.');
  const DIM = card('Test Dimlight', 'Enchantment', 'Whenever you lose life, draw a card.');
  const UNLIFE = card('Test Unlife', 'Enchantment', "You have no maximum hand size and don't lose the game for having 0 or less life.");
  const WARD = card('Test Life Ward', 'Enchantment', "Players can't gain life.");
  const defs = [DOUBLE, PROSPER, BEACON, LIGHT, DIM, UNLIFE, WARD];
  it('is fully automated', () => {
    for (const d of [DOUBLE, PROSPER, BEACON]) expect(full(d), d.name).toBe(true);
  });
  it('a life total of 20 becomes 40 and one of 7 becomes 14; the opponent\'s is untouched', () => {
    for (const [start, end] of [[20, 40], [7, 14]] as const) {
      const s0 = scenario([], { defs, life: start, p1: { hand: ['Test Doubling'] } });
      const s = resolveAll(cast(s0, 'Test Doubling'));
      expect(life(s, 'p1')).toBe(end);
      expect(life(s, 'p2')).toBe(start);
    }
  });
  it('it is a life gain of the whole amount: "Whenever you gain life" triggers once', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Doubling'], battlefield: ['Test Lifelight'] } });
    const s = resolveAll(cast(s0, 'Test Doubling'));
    expect(life(s, 'p1')).toBe(40);
    expect(handSize(s, 'p1')).toBe(1); // the spell left the hand, one card drawn
  });
  it('a negative life total goes twice as far below 0: it is a life loss (-10 becomes -20), not a gain', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Doubling'], battlefield: ['Test Unlife', 'Test Dimlight'] } });
    const t = structuredClone(s0);
    t.players.find((p) => p.id === 'p1')!.life = -10;
    const s = resolveAll(cast(t, 'Test Doubling'));
    expect(life(s, 'p1')).toBe(-20);
    expect(handSize(s, 'p1')).toBe(1); // "Whenever you lose life" drew a card
    expect(s.result).toBeNull(); // the game goes on: CR 704.5a does not apply while the effect does
  });
  it('a life total of 0 stays 0 (nothing to gain)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Doubling'], battlefield: ['Test Unlife', 'Test Lifelight', 'Test Dimlight'] } });
    const t = structuredClone(s0);
    t.players.find((p) => p.id === 'p1')!.life = 0;
    const s = resolveAll(cast(t, 'Test Doubling'));
    expect(life(s, 'p1')).toBe(0);
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('CR 119.7: with "Players can\'t gain life" the total does not change', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Doubling'] }, p2: { battlefield: ['Test Life Ward'] } });
    const s = resolveAll(cast(s0, 'Test Doubling'));
    expect(life(s, 'p1')).toBe(20);
  });
  it('the whole card: double, then draw as many cards as are in the hand, then no maximum hand size', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Long Prosperity', ...FILLER(3)] } });
    const s = resolveAll(cast(s0, 'Test Long Prosperity'));
    expect(life(s, 'p1')).toBe(40);
    expect(handSize(s, 'p1')).toBe(6); // 3 cards in hand after the spell was cast, 3 drawn
    expect(maxHandSize(s, 'p1')).toBeNull();
  });
  it('"Double target player\'s life total": the opponent\'s 20 becomes 40, and the spell is shuffled into its owner\'s library', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Twin Beacon'] } });
    const s = resolveAll(cast(s0, 'Test Twin Beacon', [target('p2')]));
    expect(life(s, 'p2')).toBe(40);
    expect(life(s, 'p1')).toBe(20);
    expect(s.zones.graveyard.p1!.length).toBe(0);
    expect(s.zones.library.p1!.some((id) => s.objects[id]!.defId === 'Test Twin Beacon')).toBe(true);
  });
  it('the target may be yourself: your own 20 becomes 40', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Twin Beacon'] } });
    const s = resolveAll(cast(s0, 'Test Twin Beacon', [target('p1')]));
    expect(life(s, 'p1')).toBe(40);
  });
});

// ---- CR 701.21a, 101.2: "You can't sacrifice Treasure tokens." ----------------------------------------------------------------------------------------------

describe('CR 701.21a, 101.2: "You can\'t sacrifice Treasure tokens."', () => {
  const MERCHANT = card('Test Barkeep', 'Legendary Creature — Ferengi Rogue', "You can't sacrifice Treasure tokens.\nAt the beginning of each upkeep, create a Treasure token.", { pt: ['1', '2'] });
  const EDICT = card('Test Tithe', 'Sorcery', 'Sacrifice a Treasure token.');
  const FOOD = card('Test Pantry', 'Sorcery', 'Create a Food token.');
  const defs = [MERCHANT, EDICT, FOOD];
  const treasures = (s: GameState, who: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === who && getChars(s, id).subtypes.includes('Treasure'));
  /** The legal activations (mana abilities included) of one object. */
  const manaOf = (s: GameState, who: PlayerId, id: ObjectId) => legalActions(s, who).filter((a) => a.kind === 'activate' && a.object === id);
  /** A game at p1's first main phase with a Treasure token for each player (made by a first Test Pantry-less setup: the tokens come from the Barkeep's trigger). */
  const withTreasures = (barkeepFor: PlayerId[]) => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Tithe'], battlefield: barkeepFor.includes('p1') ? ['Test Barkeep'] : [] }, p2: { battlefield: barkeepFor.includes('p2') ? ['Test Barkeep'] : [] } });
    return s0;
  };
  it('is fully automated', () => {
    for (const d of [MERCHANT, EDICT, FOOD]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('"At the beginning of each upkeep, create a Treasure token": on the opponent\'s upkeep too, and the Barkeep\'s controller gets it', () => {
    let s = advanceTo(withTreasures(['p1']), 2, 'upkeep');
    s = resolveAll(s);
    expect(treasures(s, 'p1')).toHaveLength(1);
    expect(treasures(s, 'p2')).toHaveLength(0);
  });
  it('its controller can\'t sacrifice a Treasure for mana (the token\'s own sacrifice cost), though the token is untapped and in play', () => {
    let s = advanceTo(withTreasures(['p1']), 2, 'upkeep');
    s = resolveAll(s);
    s = advanceTo(s, 3, 'main1');
    const t = treasures(s, 'p1')[0]!;
    expect(s.objects[t]!.tapped).toBe(false);
    expect(manaOf(s, 'p1', t)).toHaveLength(0);
  });
  it('the same Treasure can be sacrificed for mana once the Barkeep is gone', () => {
    let s = advanceTo(withTreasures(['p1']), 2, 'upkeep');
    s = resolveAll(s);
    s = advanceTo(s, 3, 'main1');
    const t = treasures(s, 'p1')[0]!;
    const t2 = structuredClone(s);
    const barkeep = find(t2, 'Test Barkeep', 'battlefield', 'p1');
    t2.zones.battlefield = t2.zones.battlefield.filter((id) => id !== barkeep);
    delete t2.objects[barkeep];
    expect(manaOf(t2, 'p1', t).length).toBeGreaterThan(0);
  });
  it('an opponent\'s Treasure is not affected: "you" is the Barkeep\'s controller', () => {
    // p1 has the Barkeep; the opponent gets a Treasure on its own... through its own Barkeep, which cannot sacrifice its own Treasure but p1's Barkeep does not stop p2
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Barkeep'] }, p2: { battlefield: ['Test Barkeep'] } });
    let s = advanceTo(s0, 2, 'upkeep');
    s = resolveAll(s);
    // p1's Barkeep made one for p1, p2's Barkeep one for p2: each player can't sacrifice their own, whoever's Barkeep it is
    expect(treasures(s, 'p1')).toHaveLength(1);
    expect(treasures(s, 'p2')).toHaveLength(1);
    s = advanceTo(s, 2, 'main1');
    const mine = treasures(s, 'p2')[0]!;
    expect(manaOf(s, 'p2', mine)).toHaveLength(0);
    // remove p2's Barkeep only: p2 can sacrifice again though p1's Barkeep is still in play
    const t2 = structuredClone(s);
    const bk = find(t2, 'Test Barkeep', 'battlefield', 'p2');
    t2.zones.battlefield = t2.zones.battlefield.filter((id) => id !== bk);
    delete t2.objects[bk];
    expect(manaOf(t2, 'p2', mine).length).toBeGreaterThan(0);
  });
  it('the mana solver does not count it either: a {1} spell can be cast with a Treasure alone, but not while the Barkeep is in play', () => {
    const WHIM = card('Test Costly Whim', 'Sorcery', 'You gain 1 life.', { cost: '{1}' });
    const start = scenario([], { defs: [...defs, WHIM], p1: { hand: ['Test Costly Whim'], battlefield: ['Test Barkeep'] } });
    const castable = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.label.includes('Test Costly Whim'));
    let s = advanceTo(start, 3, 'main1');
    s = resolveAll(s);
    expect(treasures(s, 'p1').length).toBeGreaterThan(0);
    expect(castable(s)).toBe(false); // only Treasures to pay with, and the Barkeep forbids sacrificing them
    const free = structuredClone(s);
    const bk = find(free, 'Test Barkeep', 'battlefield', 'p1');
    free.zones.battlefield = free.zones.battlefield.filter((x) => x !== bk);
    delete free.objects[bk];
    expect(castable(free)).toBe(true);
  });
  it('"Your opponents can\'t sacrifice creatures." is the same restriction on the other players: an edict does nothing to them, and works on you', () => {
    const HUSH = card('Test Hushed Court', 'Enchantment', "Your opponents can't sacrifice creatures.");
    const EDICT2 = card('Test Each Edict', 'Sorcery', 'Each player sacrifices a creature.');
    const CUB = card('Test Plain Cub', 'Creature — Bear', '', { pt: ['2', '2'] });
    const d2 = [HUSH, EDICT2, CUB];
    const mk = (hush: boolean) => scenario([], { defs: d2, p1: { hand: ['Test Each Edict'], battlefield: [...(hush ? ['Test Hushed Court'] : []), 'Test Plain Cub'] }, p2: { battlefield: ['Test Plain Cub'] } });
    const cubs = (s: GameState, who: PlayerId): number => findAll(s, 'Test Plain Cub', 'battlefield', who).length;
    const a = resolveAll(cast(mk(true), 'Test Each Edict'));
    expect(cubs(a, 'p1')).toBe(0); // you can still sacrifice
    expect(cubs(a, 'p2')).toBe(1); // your opponent can't
    const b = resolveAll(cast(mk(false), 'Test Each Edict'));
    expect(cubs(b, 'p2')).toBe(0);
  });
  it('an effect that sacrifices a Treasure does nothing to a Treasure its controller can\'t sacrifice', () => {
    let s = advanceTo(withTreasures(['p1']), 2, 'upkeep');
    s = resolveAll(s);
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(s); // the Barkeep's trigger of turn 3's upkeep
    expect(treasures(s, 'p1')).toHaveLength(2);
    const after = resolveAll(cast(s, 'Test Tithe'));
    expect(treasures(after, 'p1')).toHaveLength(2); // both still there
    // without the Barkeep one would be sacrificed (a negative case for the test itself)
    const free = structuredClone(s);
    const bk = find(free, 'Test Barkeep', 'battlefield', 'p1');
    free.zones.battlefield = free.zones.battlefield.filter((x) => x !== bk);
    delete free.objects[bk];
    const pick = treasures(free, 'p1')[0]!;
    expect(treasures(resolveAll(cast(free, 'Test Tithe'), [{ kind: 'chooseObjects', ids: [pick] }]), 'p1')).toHaveLength(1);
  });
});

// ---- CR 201.2, 608.2c, 602.5b: "N or more differently named lands you control" --------------------------------------------------------------------------

describe('CR 201.2, 608.2c, 602.5b: "Then discard a card unless you control five or more differently named lands." and "Activate only if you control seven or more differently named lands."', () => {
  const DRONE = card('Test Collective Drone', 'Legendary Artifact Creature — Human Officer',
    "At the beginning of your first main phase, draw a card. Then discard a card unless you control five or more differently named lands.\n{6}{U}: This creature's base power and toughness become 7/9. Activate only if you control seven or more differently named lands.",
    { pt: ['0', '4'] });
  const MOOR = card('Test Moor', 'Land', '{T}: Add {C}.');
  const FEN = card('Test Fen', 'Land', '{T}: Add {C}.');
  const defs = [DRONE, MOOR, FEN];
  const board = (lands: string[], opp: string[] = []) => scenario(['Island', 'Swamp', 'Mountain', 'Forest'], {
    defs, p1: { hand: ['Plains'], battlefield: ['Test Collective Drone', ...lands] }, p2: { battlefield: opp },
  });
  /**
   * To p1's next precombat main phase (turn 3), answering the discard (the first card offered). The cards are placed directly on the first main phase of turn 1
   * (the scenario helper), so the trigger's first run is at the turn-1 step the helper skipped; what is counted starts at turn 3's upkeep.
   */
  function toMain3(s0: GameState): { s: GameState; asked: boolean; hand0: number; grave0: number } {
    let s = s0;
    let asked = false;
    let hand0 = -1;
    let grave0 = -1;
    for (let guard = 0; guard < 80 && !(s.turn.number === 3 && s.turn.step === 'main1' && s.pending?.kind === 'priority' && s.zones.stack.length === 0); guard++) {
      if (hand0 < 0 && s.turn.number === 3 && s.turn.step === 'upkeep' && s.pending?.kind === 'priority') { hand0 = handSize(s, 'p1'); grave0 = s.zones.graveyard.p1!.length; }
      const d = s.pending;
      if (d?.kind === 'chooseObjects') { if (s.turn.number === 3 && d.rules?.includes('CR 514.1') !== true) asked = true; s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) }); }
      else if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d !== null && d !== undefined && d.kind !== 'priority') s = drive(s);
      else s = pass(s);
    }
    return { s, asked, hand0, grave0 };
  }
  it('is fully automated', () => expect(full(DRONE), JSON.stringify(DRONE.automation)).toBe(true));
  it('four differently named lands (two Plains are one name): a card is discarded', () => {
    const { s, asked, hand0, grave0 } = toMain3(board(['Plains', 'Plains', 'Island', 'Swamp', 'Mountain']));
    expect(asked).toBe(true);
    expect(handSize(s, 'p1')).toBe(hand0 + 1); // the draw step's card and the trigger's card, less the one discarded
    expect(s.zones.graveyard.p1!.length).toBe(grave0 + 1);
  });
  it('five differently named lands: nothing is discarded', () => {
    const { s, asked, hand0, grave0 } = toMain3(board(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']));
    expect(asked).toBe(false);
    expect(handSize(s, 'p1')).toBe(hand0 + 2); // the draw step's card and the trigger's card
    expect(s.zones.graveyard.p1!.length).toBe(grave0);
  });
  it('five lands of one name, or an opponent\'s differently named lands, do not count: the card is discarded', () => {
    expect(toMain3(board(['Plains', 'Plains', 'Plains', 'Plains', 'Plains'])).asked).toBe(true);
    expect(toMain3(board(['Plains', 'Island', 'Swamp', 'Mountain'], ['Forest', 'Test Moor', 'Test Fen'])).asked).toBe(true);
  });
  const SEVEN = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Test Moor', 'Test Fen'];
  const activations = (s: GameState) => legalActions(s, 'p1').filter((a) => a.kind === 'activate' && !a.isMana && a.object === find(s, 'Test Collective Drone', 'battlefield', 'p1'));
  it('seven differently named lands (and the mana): the ability can be activated and the base power and toughness become 7/9 for good', () => {
    let s = toMain3(board(SEVEN)).s;
    const drone = find(s, 'Test Collective Drone', 'battlefield', 'p1');
    expect(ptNumbers(getChars(s, drone))).toMatchObject({ power: 0, toughness: 4 });
    expect(activations(s)).toHaveLength(1);
    s = resolveAll(drive(act(s, activations(s)[0]!.action)));
    expect(ptNumbers(getChars(s, drone))).toMatchObject({ power: 7, toughness: 9 });
    s = advanceTo(s, 4, 'main1');
    expect(ptNumbers(getChars(s, drone))).toMatchObject({ power: 7, toughness: 9 }); // no duration
  });
  it('six differently named lands among seven (two Plains) with all the mana: the ability can\'t be activated', () => {
    const s = toMain3(board(['Plains', 'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Test Moor'])).s;
    expect(activations(s)).toHaveLength(0);
  });
});

// ---- CR 603.4, 400.3: "At the beginning of each end step, if a permanent was returned to your hand from the battlefield this turn, draw a card." -------------

describe('CR 603.4, 400.3: "At the beginning of each end step, if a permanent was returned to your hand from the battlefield this turn, draw a card."', () => {
  const OPERATOR = card('Test Transport Chief', 'Legendary Creature — Human Artificer', 'At the beginning of each end step, if a permanent was returned to your hand from the battlefield this turn, draw a card.', { pt: ['3', '3'] });
  const RECALL = card('Test Beam Home', 'Instant', "Return target creature to its owner's hand.");
  const BEAR = card('Test Plain Cub', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [OPERATOR, RECALL, BEAR];
  const board = () => scenario([], { defs, p1: { hand: ['Test Beam Home'], battlefield: ['Test Transport Chief', 'Test Plain Cub'] }, p2: { hand: ['Test Beam Home'], battlefield: ['Test Plain Cub'] } });
  const toEnd = (s0: GameState, turn: number): GameState => {
    let s = s0;
    for (let guard = 0; guard < 80 && !(s.turn.number === turn && s.turn.step === 'end' && s.pending?.kind === 'priority' && s.zones.stack.length === 0); guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d !== null && d !== undefined && d.kind !== 'priority') s = drive(s);
      else if (s.zones.stack.length > 0) s = pass(s);
      else s = pass(s);
    }
    return s;
  };
  it('is fully automated', () => expect(full(OPERATOR), JSON.stringify(OPERATOR.automation)).toBe(true));
  it('your own permanent returned to your hand: you draw a card at the end step (the intervening "if" holds as the trigger is put on the stack and as it resolves)', () => {
    let s = board();
    const cub = find(s, 'Test Plain Cub', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Beam Home', [target(cub)]));
    const before = handSize(s, 'p1'); // the Cub is in hand, the spell is gone
    expect(before).toBe(1);
    s = toEnd(s, 1);
    s = resolveAll(s);
    expect(handSize(s, 'p1')).toBe(2);
  });
  it('the opponent\'s permanent returned to the opponent\'s hand is not returned to YOUR hand: no card', () => {
    let s = board();
    const theirs = find(s, 'Test Plain Cub', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Beam Home', [target(theirs)]));
    s = toEnd(s, 1);
    s = resolveAll(s);
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('nothing returned this turn: no card', () => {
    const s = resolveAll(toEnd(board(), 1));
    expect(handSize(s, 'p1')).toBe(1);
  });
  it('"each end step": on the opponent\'s turn too, when the opponent sends your permanent back to your hand; and not a turn later', () => {
    let s = board();
    s = advanceTo(s, 2, 'main1');
    const cub = find(s, 'Test Plain Cub', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Beam Home', [target(cub)], 'p2'));
    expect(handSize(s, 'p1')).toBe(2); // the Beam Home it started with and the Cub
    s = resolveAll(toEnd(s, 2));
    expect(handSize(s, 'p1')).toBe(3); // drew at the opponent's end step
    s = resolveAll(toEnd(s, 3));
    expect(handSize(s, 'p1')).toBe(4); // (its own draw step of turn 3) only: nothing returned in turn 3
  });
});

// ---- CR 704.5a, 104.3b, 119.3: Georgiou, Terran Emperor (the template sta.r3static.noLossForZeroLife, promoted on this card: owner decision 2026-10-24) ---------------

describe('CR 704.5a, 104.3b, 119.3: "You don\'t lose the game for having 0 or less life. At the beginning of your end step, you lose 3 life and draw a card. Then if your life total is 0 or less, create ten 1/1 red Officer creature tokens."', () => {
  const EMPEROR = card('Test Terran Sovereign', 'Legendary Creature — Human Rogue Noble',
    "You don't lose the game for having 0 or less life.\nAt the beginning of your end step, you lose 3 life and draw a card. Then if your life total is 0 or less, create ten 1/1 red Officer creature tokens.", { pt: ['4', '6'] });
  const DRAIN = card('Test Drain', 'Sorcery', 'Target player loses 5 life.');
  const board = (lifeTotal: number, withEmperor = true) => scenario([], { defs: [EMPEROR, DRAIN], life: lifeTotal, p1: { hand: ['Test Drain'], battlefield: withEmperor ? ['Test Terran Sovereign'] : [], library: FILLER(6) }, p2: { library: FILLER(6) } });
  const toEndStep = (s0: GameState): GameState => {
    let s = s0;
    // (a game that is over has no decision pending: it stops there)
    for (let guard = 0; guard < 80 && s.pending !== null && !(s.turn.number === 1 && s.turn.step === 'end' && s.pending.kind === 'priority'); guard++) {
      const d = s.pending;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind !== 'priority') s = drive(s);
      else s = pass(s);
    }
    return s;
  };
  const officers = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && getChars(s, id).subtypes.includes('Officer'));
  const lost = (s: GameState, p: PlayerId): boolean => s.players.find((x) => x.id === p)!.hasLost === true;
  it('is fully automated', () => expect(full(EMPEROR), JSON.stringify(EMPEROR.automation)).toBe(true));
  it('life 10: at your end step you lose 3 (7) and draw a card; the life total is above 0, so no Officer is created', () => {
    const s0 = board(10);
    const hand0 = handSize(s0, 'p1');
    const s = resolveAll(toEndStep(s0));
    expect(life(s, 'p1')).toBe(7);
    expect(handSize(s, 'p1')).toBe(hand0 + 1);
    expect(officers(s)).toHaveLength(0);
  });
  it('life 3: the loss takes it to 0 and "then if your life total is 0 or less" (read after the loss) creates ten red 1/1 Officers; you have not lost the game', () => {
    const s = resolveAll(toEndStep(board(3)));
    expect(life(s, 'p1')).toBe(0);
    expect(officers(s)).toHaveLength(10);
    for (const id of officers(s)) expect(ptNumbers(getChars(s, id))).toMatchObject({ power: 1, toughness: 1 });
    expect(getChars(s, officers(s)[0]!).colors).toEqual(['R']);
    expect(lost(s, 'p1')).toBe(false);
  });
  it('life 2: below 0 (-1) and still in the game, with ten Officers', () => {
    const s = resolveAll(toEndStep(board(2)));
    expect(life(s, 'p1')).toBe(-1);
    expect(officers(s)).toHaveLength(10);
    expect(lost(s, 'p1')).toBe(false);
  });
  it('with it, a player brought to 0 life is still in the game (state-based action 704.5a does not apply to you); a player is not, without it', () => {
    const withIt = resolveAll(cast(board(5), 'Test Drain', [target('p1')]));
    expect(life(withIt, 'p1')).toBe(0);
    expect(lost(withIt, 'p1')).toBe(false);
    expect(withIt.pending).not.toBeNull();
    const without = resolveAll(cast(board(5, false), 'Test Drain', [target('p1')]));
    expect(life(without, 'p1')).toBe(0);
    expect(lost(without, 'p1')).toBe(true);
  });
  it('the opponent at 0 life still loses: "you" is its controller only', () => {
    const s = resolveAll(cast(board(5), 'Test Drain', [target('p2')]));
    expect(lost(s, 'p2')).toBe(true);
    expect(lost(s, 'p1')).toBe(false);
  });
});

// ---- CR 118.9, 601.2, 400.7: Commander Spock's reveal, free cast, land, draw -------------------------------------------------------------------------------------

describe('CR 701.20a, 118.9, 601.2, 400.7: "reveal the top card of your library. You may cast that card without paying its mana cost if that spell\'s mana value is equal to or less than the number of differently named lands you control. If it\'s a land card, you may put it onto the battlefield tapped. If that card is still on top of your library, draw a card."', () => {
  const SCHOLAR = card('Test Vulcan Scholar', 'Legendary Creature — Vulcan Human Scientist',
    "Whenever this creature enters or attacks, reveal the top card of your library. You may cast that card without paying its mana cost if that spell's mana value is equal to or less than the number of differently named lands you control. If it's a land card, you may put it onto the battlefield tapped. If that card is still on top of your library, draw a card.",
    { pt: ['3', '5'], cost: '{0}' });
  const CHEAP = card('Test Quick Mend', 'Instant', 'You gain 3 life.', { cost: '{1}{R}' }); // mana value 2
  const DEAR = card('Test Grand Mend', 'Instant', 'You gain 5 life.', { cost: '{3}{R}' }); // mana value 4
  const MOOR = card('Test Moor', 'Land', '{T}: Add {C}.');
  // review of 2026-10-24 (CR 601.2, 202.3, 708.4, 712.8, 715.3): "that spell's mana value" is the mana value of the spell the cast makes, the half or face cast, not the
  // mana value the card has in the library (a split card: both halves together; a modal double-faced card or an adventurer: its front face)
  const faces = (name: string, layout: string, types: [string, string], costs: [string, string], texts: [string, string], pt?: [string, string]) => compileCard({
    name, layout, mana_cost: `${costs[0]} // ${costs[1]}`, type_line: `${types[0]} // ${types[1]}`, colors: [], oracle_text: '',
    card_faces: [
      { name: name.split(' // ')[0], mana_cost: costs[0], type_line: types[0], oracle_text: texts[0], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) },
      { name: name.split(' // ')[1], mana_cost: costs[1], type_line: types[1], oracle_text: texts[1] },
    ],
  } as OracleCard);
  const SPLIT = faces('Test Mend // Test Rend', 'split', ['Instant', 'Instant'], ['{1}{W}', '{3}{R}'], ['You gain 3 life.', 'You gain 5 life.']); // halves 2 and 4, in the library 6
  const MODAL = faces('Test Esika // Test Prism', 'modal_dfc', ['Sorcery', 'Sorcery'], ['{1}{G}', '{W}{U}{B}{R}{G}'], ['You gain 3 life.', 'You gain 5 life.']); // faces 2 and 5, in the library 2
  const TALE = faces('Test Giant // Test Stomp', 'adventure', ['Creature — Giant', 'Instant — Adventure'], ['{2}{R}', '{1}{R}'], ['', 'You gain 2 life.'], ['4', '3']); // 3 and 2, in the library 3
  const defs = [SCHOLAR, CHEAP, DEAR, MOOR, SPLIT, MODAL, TALE];
  /** Three differently named lands (Plains twice), the Scholar in hand; `top` is the top card of the library. */
  const start = (top: string, lands = ['Plains', 'Plains', 'Island', 'Swamp']) => scenario(['Island', 'Swamp', 'Mountain', 'Forest'], { defs, p1: { hand: ['Test Vulcan Scholar'], battlefield: lands, library: [top] } });
  const yesNo = (yes: boolean): DecisionAnswer => ({ kind: 'yesNo', yes });
  /** Cast the Scholar and answer every yes/no with `yes` (the free cast, then the land), resolving all. */
  const play = (top: string, answers: boolean[], lands?: string[]): GameState => resolveAll(cast(start(top, lands), 'Test Vulcan Scholar'), answers.map(yesNo));
  const names = (s: GameState, zone: 'hand' | 'library', who: PlayerId): string[] => s.zones[zone][who]!.map((id) => s.objects[id]!.defId);
  it('is fully automated', () => expect(full(SCHOLAR), JSON.stringify(SCHOLAR.automation)).toBe(true));
  it('a spell with mana value 2 and three differently named lands: you may cast it for free; cast, it is no longer on top, so no card is drawn', () => {
    const s = play('Test Quick Mend', [true]);
    expect(life(s, 'p1')).toBe(23);
    expect(names(s, 'hand', 'p1')).not.toContain('Test Quick Mend');
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Quick Mend')).toBe(true);
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('declining the cast: it stays on top, so it is drawn', () => {
    const s = play('Test Quick Mend', [false]);
    expect(life(s, 'p1')).toBe(20);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Quick Mend']);
  });
  it('a spell with mana value 4 (more than the three names): no cast is offered, and it is drawn', () => {
    const s = play('Test Grand Mend', []);
    expect(s.pending?.kind).not.toBe('yesNo');
    expect(life(s, 'p1')).toBe(20);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Grand Mend']);
  });
  it('the same spell with a fourth differently named land (mana value 4 is at most 4): it can be cast', () => {
    const s = play('Test Grand Mend', [true], ['Plains', 'Island', 'Swamp', 'Test Moor']);
    expect(life(s, 'p1')).toBe(25);
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('lands of one name count once: four Plains are one name, so the mana value 2 spell is not offered', () => {
    const s = play('Test Quick Mend', [], ['Plains', 'Plains', 'Plains', 'Plains']);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Quick Mend']);
    expect(life(s, 'p1')).toBe(20);
  });
  const chooseFace = (face: number): DecisionAnswer => ({ kind: 'chooseOption', ids: [String(face)] });
  const gy = (s: GameState): string[] => s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId);
  it('review 2026-10-24, split card: the cap is read on the half cast, not on the two halves together (halves 2 and 4, 6 in the library; with three names only the 2 half is offered)', () => {
    expect(full(SPLIT), JSON.stringify(SPLIT.automation)).toBe(true);
    const asked = play('Test Mend // Test Rend', [true]);
    expect(asked.pending?.kind, 'one half only is within 3: no choice of half').not.toBe('chooseOption');
    expect(life(asked, 'p1')).toBe(23); // Test Mend, not Test Rend
    expect(handSize(asked, 'p1')).toBe(0);
    expect(gy(asked)).toContain('Test Mend // Test Rend');
  });
  it('review 2026-10-24, split card: with five names both halves are within the cap and you choose the half (the 4 half: 5 life)', () => {
    const lands = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
    const s = resolveAll(cast(start('Test Mend // Test Rend', lands), 'Test Vulcan Scholar'), [yesNo(true), chooseFace(1)]);
    expect(life(s, 'p1')).toBe(25);
  });
  it('review 2026-10-24, split card: with one name (cap 1) neither half is within the cap: no cast is offered, and the card is drawn', () => {
    const s = play('Test Mend // Test Rend', [], ['Plains', 'Plains']);
    expect(s.pending?.kind).not.toBe('yesNo');
    expect(life(s, 'p1')).toBe(20);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Mend // Test Rend']);
  });
  it('review 2026-10-24, modal double-faced card: the front face (2) is within the cap of three names and the back face (5) is not, so only the front can be cast (never the back by the front\'s mana value)', () => {
    expect(full(MODAL), JSON.stringify(MODAL.automation)).toBe(true);
    const s = play('Test Esika // Test Prism', [true]);
    expect(s.pending?.kind, 'one face only is within 3: no choice of face').not.toBe('chooseOption');
    expect(life(s, 'p1')).toBe(23);
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('review 2026-10-24, modal double-faced card: with five names the back face (5) may be cast too, chosen by you', () => {
    const lands = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
    const s = resolveAll(cast(start('Test Esika // Test Prism', lands), 'Test Vulcan Scholar'), [yesNo(true), chooseFace(1)]);
    expect(life(s, 'p1')).toBe(25);
  });
  it('review 2026-10-24, adventurer: the adventure half (2) is within the cap of two names, the creature (3, the card\'s own mana value in the library) is not: the adventure is cast and the card is on an adventure in exile', () => {
    expect(full(TALE), JSON.stringify(TALE.automation)).toBe(true);
    const s = play('Test Giant // Test Stomp', [true], ['Plains', 'Plains', 'Island']);
    expect(s.pending?.kind, 'one half only is within 2: no choice of half').not.toBe('chooseOption');
    expect(life(s, 'p1')).toBe(22);
    expect(handSize(s, 'p1')).toBe(0);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Giant // Test Stomp')).toBe(true); // CR 715.4: exiled "on an adventure"
  });
  it('review 2026-10-24, adventurer: with three names both halves are within the cap and you choose; the creature (face 0) is then cast onto the stack and resolves onto the battlefield', () => {
    const s = resolveAll(cast(start('Test Giant // Test Stomp'), 'Test Vulcan Scholar'), [yesNo(true), chooseFace(0)]);
    expect(findAll(s, 'Test Giant // Test Stomp', 'battlefield', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(20);
  });
  it('a land card on top: you may put it onto the battlefield tapped; it is a new object, so no card is drawn; a land is not cast', () => {
    const s = play('Test Moor', [true]);
    const moor = findAll(s, 'Test Moor', 'battlefield', 'p1');
    expect(moor).toHaveLength(1);
    expect(s.objects[moor[0]!]!.tapped).toBe(true);
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('a land card on top and you decline: it stays on top and is drawn', () => {
    const s = play('Test Moor', [false]);
    expect(findAll(s, 'Test Moor', 'battlefield', 'p1')).toHaveLength(0);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Moor']);
  });
  it('whenever it attacks too', () => {
    const s0 = scenario(['Island', 'Swamp'], { defs, p1: { battlefield: ['Test Vulcan Scholar', 'Plains', 'Island', 'Swamp'], library: ['Test Grand Mend'] } });
    let s = s0;
    for (let guard = 0; guard < 40 && handSize(s, 'p1') === 0; guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Vulcan Scholar', 'battlefield', 'p1'), defender: 'p2' }] });
      else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d !== null && d !== undefined && d.kind !== 'priority') s = drive(s);
      else s = pass(s);
    }
    expect(names(s, 'hand', 'p1')).toEqual(['Test Grand Mend']);
  });
});

// ---- CR 406.1, 611.2b, 305.1: Ensign Pavel Chekov's exile, choice and permission ---------------------------------------------------------------------------------

describe('CR 406.1, 608.2d, 611.2b, 305.1: "each opponent exiles the top X cards of their library, where X is the number of differently named lands you control. For each opponent, choose a land card that player owns exiled this way. You may play the chosen cards for as long as they remain exiled."', () => {
  const PILOT = card('Ensign Pavel Tester', 'Legendary Creature — Human Pilot',
    'When Ensign Tester enters, each opponent exiles the top X cards of their library, where X is the number of differently named lands you control. For each opponent, choose a land card that player owns exiled this way. You may play the chosen cards for as long as they remain exiled.',
    { pt: ['1', '5'] });
  const MOOR = card('Test Moor', 'Land', '{T}: Add {C}.');
  const FEN = card('Test Fen', 'Land', '{T}: Add {C}.');
  const BOG = card('Test Bog', 'Land', '{T}: Add {C}.');
  const SPELL = card('Test Quick Mend', 'Instant', 'You gain 3 life.', { cost: '{1}{R}' });
  const defs = [PILOT, MOOR, FEN, BOG, SPELL];
  const start = (lib: string[], lands = ['Plains', 'Plains', 'Island', 'Swamp'], oppLands: string[] = []) =>
    scenario(['Island', 'Swamp'], { defs, p1: { hand: ['Ensign Pavel Tester'], battlefield: lands }, p2: { library: lib, battlefield: oppLands } });
  /** Cast the Pilot; the choice of a land card takes the one named `pickName` when offered. */
  const play = (s0: GameState, pickName: string): { s: GameState; offered: string[] } => {
    let s = cast(s0, 'Ensign Pavel Tester');
    let offered: string[] = [];
    for (let guard = 0; guard < 30 && (s.zones.stack.length > 0 || (s.pending !== null && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending;
      if (d?.kind === 'chooseObjects') {
        offered = d.options.map((id) => s.objects[id]!.defId);
        s = answer(s, { kind: 'chooseObjects', ids: [d.options.find((id) => s.objects[id]!.defId === pickName) ?? d.options[0]!] });
      } else if (d !== null && d !== undefined && d.kind !== 'priority') s = drive(s);
      else s = pass(s);
    }
    return { s, offered };
  };
  const exiledNames = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);
  const landPlays = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'playLand').map((a) => s.objects[(a.action as { card: ObjectId }).card]!.defId);
  it('is fully automated (with the title "Ensign" in the short name)', () => expect(full(PILOT), JSON.stringify(PILOT.automation)).toBe(true));
  it('X is 3 here (Plains twice is one name): the top three cards of the opponent\'s library are exiled; you choose the land among them and may play it', () => {
    const { s, offered } = play(start(['Test Quick Mend', 'Test Moor', 'Test Quick Mend', 'Test Bog']), 'Test Moor');
    expect(exiledNames(s)).toEqual(['Test Quick Mend', 'Test Moor', 'Test Quick Mend']);
    expect(offered).toEqual([]); // one land card among the exiled: nothing to decide, it is the chosen one
    expect(landPlays(s)).toEqual(['Test Moor']);
    expect(s.zones.library.p2![0] !== undefined && s.objects[s.zones.library.p2![0]!]!.defId).toBe('Test Bog');
  });
  it('two lands exiled, one chosen: only the chosen card may be played; the other stays in exile and cannot be', () => {
    const { s, offered } = play(start(['Test Moor', 'Test Fen', 'Test Quick Mend', 'Test Bog']), 'Test Fen');
    expect(exiledNames(s)).toEqual(['Test Moor', 'Test Fen', 'Test Quick Mend']);
    expect(offered.sort()).toEqual(['Test Fen', 'Test Moor']);
    expect(landPlays(s)).toEqual(['Test Fen']);
  });
  it('the chosen land is played from exile as a land drop: it is then on the battlefield under your control (its owner is the opponent)', () => {
    let { s } = play(start(['Test Moor', 'Test Quick Mend', 'Test Bog']), 'Test Moor');
    const card0 = legalActions(s, 'p1').find((a) => a.kind === 'playLand')!;
    s = act(s, card0.action);
    const moor = findAll(s, 'Test Moor', 'battlefield', 'p2');
    expect(moor).toHaveLength(1);
    expect(s.objects[moor[0]!]!.controller).toBe('p1');
    expect(exiledNames(s)).toEqual(['Test Quick Mend', 'Test Bog']); // the other two of the three exiled cards stay in exile
    expect(landPlays(s)).toEqual([]);
  });
  it('"for as long as they remain exiled": it can be played on a later turn too', () => {
    const { s: s1 } = play(start(['Test Moor', 'Test Quick Mend', 'Test Bog']), 'Test Moor');
    let s = s1;
    for (let guard = 0; guard < 80 && !(s.turn.number === 3 && s.turn.step === 'main1' && s.pending?.kind === 'priority' && s.zones.stack.length === 0); guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d !== null && d !== undefined && d.kind !== 'priority') s = drive(s);
      else s = pass(s);
    }
    expect(landPlays(s).filter((n) => n.startsWith('Test '))).toEqual(['Test Moor']); // (and the Plains of the hand)
  });
  it('no land card among the exiled cards: nothing to choose, nothing to play', () => {
    const { s, offered } = play(start(['Test Quick Mend', 'Test Quick Mend', 'Test Quick Mend', 'Test Moor']), 'Test Moor');
    expect(offered).toEqual([]);
    expect(landPlays(s)).toEqual([]);
  });
  it('the opponent\'s differently named lands do not raise X: with one land of your own, one card is exiled', () => {
    const { s } = play(start(['Test Fen', 'Test Moor', 'Test Bog'], ['Plains'], ['Island', 'Swamp', 'Test Moor']), 'Test Fen');
    expect(exiledNames(s)).toEqual(['Test Fen']);
  });
});
