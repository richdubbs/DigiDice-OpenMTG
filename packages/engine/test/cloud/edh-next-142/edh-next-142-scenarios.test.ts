/**
 * Must-finish round edh-next-142 (library, draw and search; code edhn142): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25
 * (MagicCompRules 20260925.txt).
 *
 *   CR 108.3, 608.2c, 608.2d, 110.2a, 305.2   "{2}, {T}: Draw a card, then you may put a land card from your hand onto the battlefield. This artifact's owner draws a card, then that
 *                                              player may put a land card from their hand onto the battlefield." (Pendant of Prosperity; rulings 2019-08-23)
 *   CR 701.20a, 608.2c, 608.2d, 107.4, 105.1, 106.5, 400.7   "At the beginning of your first main phase, look at the top card of your library. You may reveal that card if it has three or more
 *                                              colored mana symbols in its mana cost. If you do, add three mana in any combination of its colors and put it into your hand. If you
 *                                              don't reveal it, put it into your hand." (Omnath, Locus of All; rulings 2023-04-14)
 *   CR 606.4, 601.2f, 118.8, 107.7   "Planeswalkers' loyalty abilities you activate cost an additional [+1] to activate." (Carth the Lion; rulings 2021-06-18)
 *   CR 608.2d, 614.1b, 614.10, 500.11, 611.2a   "At the beginning of each opponent's upkeep, that player chooses draw step, main phase, or combat phase. The player skips each instance of the chosen
 *                                              step or phase this turn." (Fatespinner; rulings 2004-12-01)
 *   CR 611.3a, 613.1f, 702.29a, 702.29e, 402.1   "Each Sliver card in each player's hand has slivercycling {3}." (Homing Sliver; rulings 2021-03-19)
 *   CR 205.1b, 611.3a, 613.1d, 108.3, 109.4   "Other creatures you control are Assassins in addition to their other types. The same is true for creature spells you control and creature cards
 *                                              you own that aren't on the battlefield." (Roshan, Hidden Magister)
 *   CR 101.4, 608.2d, 701.23a, 110.2a, 701.24a   "When this creature enters, each opponent may search their library for up to three basic land cards. They each put one of those cards onto the
 *                                              battlefield tapped under your control and the rest onto the battlefield tapped under their control. Then each player who searched their
 *                                              library this way shuffles." (Rootweaver Druid; rulings 2020-11-10)
 *   CR 400.11b, 400.11a, 700.2   "Choose one — • Search your library for a card, put it into your hand, then shuffle. • Put a card you own from outside the game into your hand."
 *                                              (Mastermind's Acquisition; rulings 2018-01-19)
 *   CR 105.5, 105.2b, 608.2c, 608.2d, 701.20a   "When Niv-Mizzet enters, reveal the top ten cards of your library. For each color pair, choose a card that's exactly those colors from among them.
 *                                              Put the chosen cards into your hand and the rest on the bottom of your library in a random order." (Niv-Mizzet Reborn; rulings 2019-05-03)
 *   CR 401.4, 608.2d, 121.1   "Draw three cards, then put two cards from your hand both on top of your library or both on the bottom of your library." (Dream Cache)
 *   CR 608.2c, 608.2d, 701.20a, 110.2a   "Reveal the top six cards of your library. You may put up to one land card from among them onto the battlefield tapped and up to one Elf card from
 *                                              among them into your hand. Put the rest on the bottom of your library in a random order." (Bounty of Skemfar)
 */
import { describe, expect, it } from 'vitest';
import { card, drive, full, named, resolveAll, scenario } from '../r4-cost/support';
import { act, advanceTo, answer, pool } from '../r3-cost/support';
import { getChars, legalActions, type GameState, type ObjectId } from '../../../src/index';
import { synthetic } from '../../m6/costs/support';
import { mpScenario } from '../../m12/rules/helpers';

const hand = (s: GameState, p: string): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);
const landsOf = (s: GameState, p: string, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && s.objects[id]!.controller === p).length;

// ---- Pendant of Prosperity ------------------------------------------------------------------------------------------------------------------------------
describe("CR 108.3, 608.2c: \"This artifact's owner draws a card, then that player may put a land card from their hand onto the battlefield\" (the owner, not the controller)", () => {
  const PENDANT = card('Test Pendant', 'Artifact', "This artifact enters under the control of an opponent of your choice.\n{2}, {T}: Draw a card, then you may put a land card from your hand onto the battlefield. This artifact's owner draws a card, then that player may put a land card from their hand onto the battlefield.", '{3}');
  const ISLE = card('Test Isle', 'Land', '', '');
  const MOOR = card('Test Moor', 'Land', '', '');
  const defs = [PENDANT, ISLE, MOOR];
  /** p1 owns the Pendant, p2 controls it (it entered under p2's control); p2 has two Plains to pay {2}. */
  const board = (): GameState => {
    const s = scenario(['Plains'], { defs, p1: { battlefield: ['Test Pendant'], hand: ['Test Moor'] }, p2: { battlefield: ['Plains', 'Plains'], hand: ['Test Isle'] } });
    s.objects[named(s, 'Test Pendant')[0]!]!.controller = 'p2';
    return s;
  };
  const activate = (s0: GameState): GameState => { const s = act(s0, { type: 'pass', player: 'p1' }); return drive(act(s, { type: 'activate', player: 'p2', source: named(s, 'Test Pendant')[0]!, ability: 'p:0:1' } as never)); };
  it('is full', () => expect(full(PENDANT)).toBe(true));
  it('enters under the control of an opponent of your choice (owner stays the caster)', () => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Pendant'], battlefield: ['Plains', 'Plains', 'Plains'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: s0.zones.hand.p1!.find((id) => s0.objects[id]!.defId === 'Test Pendant')! })));
    const id = named(s, 'Test Pendant')[0]!;
    expect(s.objects[id]!.controller).toBe('p2');
    expect(s.objects[id]!.owner).toBe('p1');
  });
  it("the owner's land goes onto the battlefield under the owner's control (ruling: neither is a land play)", () => {
    const s0 = board();
    const p1Hand = s0.zones.hand.p1!.length;
    const p2Hand = s0.zones.hand.p2!.length;
    let s = activate(s0);
    s = act(s, { type: 'pass', player: s.pending!.player });
    s = act(s, { type: 'pass', player: s.pending!.player });
    // first choice is p2's (the controller), second p1's (the owner)
    const seen: string[] = [];
    for (let g = 0; g < 10 && s.pending && s.pending.kind === 'chooseObjects'; g++) {
      const p = s.pending;
      seen.push(p.player);
      const pick = p.options.find((id) => ['Test Isle', 'Test Moor'].includes(s.objects[id]!.defId));
      s = act(s, { type: 'answer', player: p.player, decisionId: p.id, answer: { kind: 'chooseObjects', ids: pick ? [pick] : [] } });
    }
    expect(seen).toEqual(['p2', 'p1']);
    expect(landsOf(s, 'p2', 'Test Isle')).toBe(1);
    expect(landsOf(s, 'p1', 'Test Moor')).toBe(1);
    expect(hand(s, 'p1')).not.toContain('Test Moor');
    expect(s.zones.hand.p1!.length).toBe(p1Hand); // drew one, put Test Moor
    expect(s.zones.hand.p2!.length).toBe(p2Hand); // drew one, put Test Isle
  });
  it('negative: under its owner\'s own control, the same player draws twice and is asked twice', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Pendant', 'Plains', 'Plains'], hand: ['Test Moor'] } });
    const before = s0.zones.hand.p1!.length;
    let s = drive(act(s0, { type: 'activate', player: 'p1', source: named(s0, 'Test Pendant')[0]!, ability: 'p:0:1' } as never));
    s = act(s, { type: 'pass', player: s.pending!.player });
    s = act(s, { type: 'pass', player: s.pending!.player });
    const seen: string[] = [];
    for (let g = 0; g < 10 && s.pending && s.pending.kind === 'chooseObjects'; g++) {
      const p = s.pending;
      seen.push(p.player);
      s = act(s, { type: 'answer', player: p.player, decisionId: p.id, answer: { kind: 'chooseObjects', ids: [] } });
    }
    expect(seen).toEqual(['p1', 'p1']);
    expect(s.zones.hand.p1!.length).toBe(before + 2);
  });
});

// ---- Omnath, Locus of All ----------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.20a, 608.2c, 107.4: "You may reveal that card if it has three or more colored mana symbols in its mana cost. If you do, add three mana in any combination of its colors and put it into your hand. If you don\'t reveal it, put it into your hand."', () => {
  const OMNATH = card('Test Omnath', 'Legendary Creature — Phyrexian Elemental', "If you would lose unspent mana, that mana becomes black instead.\nAt the beginning of your first main phase, look at the top card of your library. You may reveal that card if it has three or more colored mana symbols in its mana cost. If you do, add three mana in any combination of its colors and put it into your hand. If you don't reveal it, put it into your hand.", '{W}{U}{B}{R}{G}', ['4', '4']);
  const HYBRID = card('Test Hybrid Spell', 'Sorcery', '', '{R/G}{G}{G/W}', undefined, ['R', 'G', 'W']);
  const TWO = card('Test Two Red', 'Sorcery', '', '{3}{R}{R}', undefined, ['R']);
  const defs = [OMNATH, HYBRID, TWO];
  const board = (top: string): GameState => scenario([], { defs, p1: { battlefield: ['Test Omnath'], library: [top] } });
  const topOf = (s: GameState): string => s.objects[s.zones.library.p1![0]!]!.defId;
  it('is full', () => expect(full(OMNATH)).toBe(true));
  it('ruling 2023-04-14: {R/G}{G}{G/W} has three colored mana symbols: reveal, add three mana of its colors, the card goes to your hand', () => {
    const s0 = board('Test Hybrid Spell');
    expect(s0.zones.stack.length).toBe(1);
    const s = resolveAll(s0, { yes: [true], colors: ['R', 'G', 'W'] });
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Hybrid Spell');
    expect(pool(s, 'p1')).toBe('GRW');
  });
  it('the three mana may be any combination of its colors (all of one color too)', () => {
    const s = resolveAll(board('Test Hybrid Spell'), { yes: [true], colors: ['G', 'G', 'G'] });
    expect(pool(s, 'p1')).toBe('GGG');
  });
  it('declining to reveal: no mana, the card still goes to your hand', () => {
    const s = resolveAll(board('Test Hybrid Spell'), { yes: [false] });
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Hybrid Spell');
    expect(pool(s, 'p1')).toBe('');
  });
  it('negative (CR 107.4): two colored symbols ({3}{R}{R}): you are not asked, no mana, the card goes to your hand', () => {
    const s0 = board('Test Two Red');
    let asked = false;
    let s = s0;
    for (let g = 0; g < 20 && s.zones.stack.length > 0; g++) {
      s = act(s, { type: 'pass', player: s.pending!.player });
      if (s.pending?.kind === 'yesNo') asked = true;
      s = drive(s, {});
    }
    expect(asked).toBe(false);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Two Red');
    expect(pool(s, 'p1')).toBe('');
    expect(topOf(s)).toBe('Plains');
  });
});

// ---- Carth the Lion ------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 606.4, 601.2f: "Planeswalkers\' loyalty abilities you activate cost an additional [+1] to activate"', () => {
  const CARTH = card('Test Carth', 'Creature — Human Warrior', "Whenever Test Carth enters or a planeswalker you control dies, look at the top seven cards of your library. You may reveal a planeswalker card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.\nPlaneswalkers' loyalty abilities you activate cost an additional [+1] to activate.", '{2}{B}{G}', ['3', '5']);
  const WALKER = synthetic('Test Walker', 'Legendary Planeswalker — Sage', '{2}', '+1: You gain 1 life.\n0: You gain 2 life.\n\u22123: You gain 3 life.\n\u22126: You gain 6 life.', { loyalty: '5' });
  const defs = [CARTH, WALKER];
  const walkerOn = (s: GameState, p = 'p1'): ObjectId => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Walker' && s.objects[id]!.controller === p)!;
  const loyaltyAbilities = (s: GameState, p = 'p1') => legalActions(s, p as never).filter((a) => a.kind === 'activate' && !a.isMana && a.object === walkerOn(s, p));
  const activateNth = (s0: GameState, n: number, p = 'p1'): GameState => {
    const la = loyaltyAbilities(s0, p)[n];
    if (la === undefined) throw new Error(`no loyalty ability ${n}`);
    return drive(act(s0, la.action));
  };
  const board = (loyalty: number, carths = 1, p2Carth = false): GameState => scenario([], { defs, p1: { battlefield: [...Array(carths).fill('Test Carth'), { name: 'Test Walker', counters: { loyalty } }] }, p2: { battlefield: p2Carth ? ['Test Carth'] : [] } });
  it('is full', () => expect(full(CARTH)).toBe(true));
  it('ruling 2021-06-18: a [+1] costs [+2]', () => {
    const s = activateNth(board(5), 0);
    expect(s.objects[walkerOn(s)]!.counters['loyalty']).toBe(7);
  });
  it('ruling: a [0] costs [+1]', () => {
    const s = activateNth(board(5), 1);
    expect(s.objects[walkerOn(s)]!.counters['loyalty']).toBe(6);
  });
  it('ruling: a [\u22123] removes two counters at once', () => {
    const s = activateNth(board(5), 2);
    expect(s.objects[walkerOn(s)]!.counters['loyalty']).toBe(3);
  });
  it('ruling: a [\u22126] becomes [\u22125], payable with five loyalty', () => {
    const s0 = board(5);
    expect(loyaltyAbilities(s0).length).toBe(4);
    const s = activateNth(s0, 3);
    // five counters removed: with no loyalty left it is put into its owner's graveyard (CR 704.5i)
    expect(walkerOn(s)).toBeUndefined();
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Walker');
  });
  it('ruling: two copies are cumulative, an additional [+2] in total', () => {
    const s = activateNth(board(5, 2), 2);
    expect(s.objects[walkerOn(s)]!.counters['loyalty']).toBe(4);
  });
  it('negative ("you activate"): an opponent\'s copy does not change the cost of your loyalty abilities', () => {
    const s = activateNth(board(5, 0, true), 0);
    expect(s.objects[walkerOn(s)]!.counters['loyalty']).toBe(6);
  });
  it('negative (CR 606.4): without the modifier a [\u22126] is not offered with five loyalty', () => {
    expect(loyaltyAbilities(board(5, 0)).length).toBe(3);
  });
});

// ---- Fatespinner ---------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 614.10, 500.11: "that player chooses draw step, main phase, or combat phase. The player skips each instance of the chosen step or phase this turn"', () => {
  const SPINNER = card('Test Spinner', 'Creature — Human Wizard', "At the beginning of each opponent's upkeep, that player chooses draw step, main phase, or combat phase. The player skips each instance of the chosen step or phase this turn.", '{1}{U}', ['1', '2']);
  const defs = [SPINNER];
  /** Turn 2 (p2's) with the choice `pick` (null: never asked); the steps of that turn, in order, and who chose. */
  const playTurn2 = (pick: string | null, spinnerFor: 'p1' | 'p2' = 'p1'): { steps: string[]; chooser: string | null; s: GameState; asked: boolean } => {
    let s = scenario([], { defs, [spinnerFor]: { battlefield: ['Test Spinner'] } });
    s = advanceTo(s, 2, 'upkeep');
    const steps: string[] = ['upkeep'];
    let chooser: string | null = null;
    let asked = false;
    for (let g = 0; g < 400 && s.turn.number === 2; g++) {
      const d = s.pending;
      if (d?.kind === 'chooseOption') {
        asked = true;
        chooser = d.player;
        const opt = d.options.find((o) => o.label.toLowerCase().includes(pick ?? '###') || o.id.toLowerCase().includes(pick ?? '###'));
        s = answer(s, { kind: 'chooseOption', ids: [opt!.id] });
        continue;
      }
      if (d?.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: [] }); continue; }
      s = act(s, { type: 'pass', player: d!.player });
      if (s.turn.number === 2 && steps[steps.length - 1] !== s.turn.step) steps.push(s.turn.step);
    }
    return { steps, chooser, s, asked };
  };
  it('is full', () => expect(full(SPINNER)).toBe(true));
  it('the opponent (not the controller) chooses; "combat phase": no step of the combat phase happens that turn', () => {
    const r = playTurn2('combat');
    expect(r.chooser).toBe('p2');
    expect(r.steps).toContain('main1');
    expect(r.steps).toContain('draw');
    expect(r.steps.some((x) => ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'].includes(x))).toBe(false);
  });
  it('"draw step": the opponent skips the draw step (no card drawn)', () => {
    const r = playTurn2('draw');
    expect(r.steps).not.toContain('draw');
    expect(r.steps).toContain('main1');
  });
  it('ruling 2004-12-01: "main phase": both main phases of the turn are skipped', () => {
    const r = playTurn2('main');
    expect(r.steps).not.toContain('main1');
    expect(r.steps).not.toContain('main2');
    expect(r.steps).toContain('draw');
  });
  it('ruling 2004-12-01: a combat phase added later in the turn is skipped too (the main phase added after it still happens)', () => {
    const EXTRA = card('Test Extra Combat', 'Sorcery', 'After this main phase, there is an additional combat phase followed by an additional main phase.', '{0}');
    let s = scenario([], { defs: [SPINNER, EXTRA], p1: { battlefield: ['Test Spinner'] }, p2: { hand: ['Test Extra Combat'] } });
    s = advanceTo(s, 2, 'upkeep');
    for (let g = 0; g < 50 && s.turn.step !== 'main1'; g++) {
      const d = s.pending!;
      if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [d.options.find((o) => o.label.toLowerCase().includes('combat') || o.id.toLowerCase().includes('combat'))!.id] });
      else s = act(s, { type: 'pass', player: d.player });
    }
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: s.zones.hand.p2!.find((id) => s.objects[id]!.defId === 'Test Extra Combat')! })));
    const steps: string[] = [];
    let mains = 0;
    for (let g = 0; g < 200 && s.turn.number === 2; g++) {
      const before = s.turn.step;
      mains = Math.max(mains, s.turn.mains ?? 0);
      s = act(s, { type: 'pass', player: s.pending!.player });
      if (s.turn.step !== before) steps.push(s.turn.step);
    }
    expect(steps.some((x) => ['beginCombat', 'declareAttackers', 'endCombat'].includes(x))).toBe(false);
    expect(mains).toBe(3); // the first main phase, the added main phase, then the turn's own postcombat main phase (CR 505.1)
  });
  it('negative ("this turn"): the next turn is not affected', () => {
    let { s } = playTurn2('combat');
    expect(s.turn.number).toBe(3);
    s = advanceTo(s, 3, 'main2');
    expect(s.turn.step).toBe('main2');
  });
  it('negative ("each opponent\'s upkeep"): its controller\'s own upkeep does not trigger it', () => {
    const r = playTurn2(null, 'p2');
    expect(r.asked).toBe(false);
    expect(r.steps).toContain('beginCombat');
  });
});

// ---- Homing Sliver -------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 613.1f, 702.29e: "Each Sliver card in each player\'s hand has slivercycling {3}."', () => {
  const HOMING = card('Test Homing', 'Creature — Sliver', "Each Sliver card in each player's hand has slivercycling {3}.\nSlivercycling {3}", '{2}{R}', ['2', '2']);
  const SLIVER = card('Test Plain Sliver', 'Creature — Sliver', '', '{1}', ['1', '1']);
  const OTHER = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [HOMING, SLIVER, OTHER];
  const cyclesOf = (s: GameState, p: string, name: string) => legalActions(s, p as never).filter((a) => a.kind === 'activate' && s.objects[a.object!]?.defId === name && s.objects[a.object!]?.zone === 'hand');
  const board = (homing: boolean): GameState => scenario(['Plains'], { defs, p1: { battlefield: homing ? ['Test Homing'] : [] }, p2: { hand: ['Test Plain Sliver', 'Test Bear'], battlefield: ['Plains', 'Plains', 'Plains'], library: ['Test Bear', 'Test Plain Sliver'] } });
  it('is full', () => expect(full(HOMING)).toBe(true));
  it("an opponent's Sliver card in hand has slivercycling {3}: discard it, search for a Sliver card, put it into their hand", () => {
    const s0 = act(board(true), { type: 'pass', player: 'p1' });
    const cyc = cyclesOf(s0, 'p2', 'Test Plain Sliver');
    expect(cyc.length).toBe(1);
    const s1 = drive(act(s0, cyc[0]!.action));
    const s = resolveAll(s1, { objects: [[Object.values(s1.objects).find((o) => o.defId === 'Test Plain Sliver' && o.zone === 'library')!.id]] });
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toEqual(['Test Plain Sliver']);
    expect(s.zones.hand.p2!.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Plain Sliver']);
    expect(s.zones.library.p2!.map((id) => s.objects[id]!.defId)).not.toContain('Test Plain Sliver');
  });
  it('negative: a non-Sliver card in hand gets nothing', () => {
    const s0 = act(board(true), { type: 'pass', player: 'p1' });
    expect(cyclesOf(s0, 'p2', 'Test Bear').length).toBe(0);
  });
  it('negative (CR 611.3a): without the Homing Sliver on the battlefield, the Sliver card has no slivercycling', () => {
    const s0 = act(board(false), { type: 'pass', player: 'p1' });
    expect(cyclesOf(s0, 'p2', 'Test Plain Sliver').length).toBe(0);
  });
});

// ---- Roshan, Hidden Magister ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 205.1b, 613.1d: "Other creatures you control are Assassins in addition to their other types. The same is true for creature spells you control and creature cards you own that aren\'t on the battlefield."', () => {
  const ROSHAN = card('Test Roshan', 'Legendary Creature — Human Rogue', "Other creatures you control are Assassins in addition to their other types. The same is true for creature spells you control and creature cards you own that aren't on the battlefield.\nFace-down creatures you control have menace.\nWhenever a permanent you control is turned face up, you draw a card and you lose 1 life.", '{2}{U}{B}', ['3', '3']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.', '{0}');
  const defs = [ROSHAN, BEAR, BOLT];
  const subs = (s: GameState, id: ObjectId): string[] => getChars(s, id).subtypes;
  const board = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Roshan', 'Test Bear'], hand: ['Test Bear', 'Test Spark'], graveyard: ['Test Bear'] }, p2: { battlefield: ['Test Bear'], hand: ['Test Bear'] } });
  const of = (s: GameState, zone: 'hand' | 'graveyard', p: string, name: string): ObjectId => s.zones[zone][p]!.find((id) => s.objects[id]!.defId === name)!;
  it('is full', () => expect(full(ROSHAN)).toBe(true));
  it('your other creatures, your creature cards in hand and graveyard are Assassins in addition to their other types', () => {
    const s = board();
    const mine = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Bear' && s.objects[id]!.controller === 'p1')!;
    expect(subs(s, mine)).toEqual(expect.arrayContaining(['Bear', 'Assassin']));
    expect(subs(s, of(s, 'hand', 'p1', 'Test Bear'))).toEqual(expect.arrayContaining(['Bear', 'Assassin']));
    expect(subs(s, of(s, 'graveyard', 'p1', 'Test Bear'))).toEqual(expect.arrayContaining(['Bear', 'Assassin']));
  });
  it('a creature spell you control on the stack is an Assassin', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Roshan', 'Plains'], hand: ['Test Bear'] } });
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: of(s0, 'hand', 'p1', 'Test Bear') }));
    expect(subs(s, s.zones.stack[0]!)).toEqual(expect.arrayContaining(['Bear', 'Assassin']));
  });
  it('negative ("other"): the source itself is not made an Assassin', () => {
    const s = board();
    const me = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Roshan')!;
    expect(subs(s, me)).not.toContain('Assassin');
  });
  it("negative: an opponent's creatures and cards, and your noncreature cards, are not Assassins", () => {
    const s = board();
    const theirs = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Bear' && s.objects[id]!.controller === 'p2')!;
    expect(subs(s, theirs)).not.toContain('Assassin');
    expect(subs(s, of(s, 'hand', 'p2', 'Test Bear'))).not.toContain('Assassin');
    expect(subs(s, of(s, 'hand', 'p1', 'Test Spark'))).not.toContain('Assassin');
  });
});

// ---- Rootweaver Druid ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 101.4, 608.2d, 701.23a: "each opponent may search their library for up to three basic land cards. They each put one of those cards onto the battlefield tapped under your control and the rest ... under their control"', () => {
  const DRUID = card('Test Druid', 'Creature — Elf Druid', 'When this creature enters, each opponent may search their library for up to three basic land cards. They each put one of those cards onto the battlefield tapped under your control and the rest onto the battlefield tapped under their control. Then each player who searched their library this way shuffles.', '{0}', ['2', '1']);
  const defs = [DRUID];
  type Pick = (s: GameState, player: string, options: readonly string[], search: boolean) => string[];
  /** Cast the Druid as p1 in a three-player game and resolve everything; `yes` per opponent, `pick` answers each object choice. */
  const run = (yes: Record<string, boolean>, pick: Pick): { s: GameState; asked: string[] } => {
    let s = mpScenario({ players: 3, cards: ['Forest', 'Island'], defs, zones: { p1: { hand: ['Test Druid'] }, p2: { library: ['Forest', 'Island'] }, p3: { library: ['Forest'] } } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => s.objects[id]!.defId === 'Test Druid')! }));
    const asked: string[] = [];
    for (let g = 0; g < 80 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      const d = s.pending!;
      if (d.kind === 'priority') { s = act(s, { type: 'pass', player: d.player }); continue; }
      if (d.kind === 'yesNo') { asked.push(`yes:${d.player}`); s = answer(s, { kind: 'yesNo', yes: yes[d.player] ?? false }); continue; }
      if (d.kind === 'chooseObjects') { asked.push(`objects:${d.player}`); s = answer(s, { kind: 'chooseObjects', ids: pick(s, d.player, d.options, d.max > 1) }); continue; }
      if (d.kind === 'order') { s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) }); continue; }
      throw new Error(`unexpected ${d.kind}`);
    }
    return { s, asked };
  };
  const ofName = (s: GameState, opts: readonly string[], name: string): string[] => opts.filter((id) => s.objects[id]!.defId === name).slice(0, 1);
  const lands = (s: GameState, controller: string, owner: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && s.objects[id]!.owner === owner).map((id) => `${s.objects[id]!.defId}${s.objects[id]!.tapped ? ' (tapped)' : ''}`).sort();
  it('is full', () => expect(full(DRUID)).toBe(true));
  it('ruling 2020-11-10: the opponents decide in turn order; each gives you one land they found (tapped) and keeps the rest (tapped)', () => {
    const { s, asked } = run({ p2: true, p3: true }, (st, p, opts, search) => {
      if (search) return p === 'p2' ? [...ofName(st, opts, 'Forest'), ...ofName(st, opts, 'Island'), ...ofName(st, opts, 'Plains')] : ofName(st, opts, 'Forest');
      return p === 'p2' ? ofName(st, opts, 'Forest') : opts.slice(0, 1);
    });
    expect(asked.filter((x) => x.startsWith('yes:'))).toEqual(['yes:p2', 'yes:p3']);
    expect(lands(s, 'p1', 'p2')).toEqual(['Forest (tapped)']);
    expect(lands(s, 'p2', 'p2')).toEqual(['Island (tapped)', 'Plains (tapped)']);
    expect(lands(s, 'p1', 'p3')).toEqual(['Forest (tapped)']); // ruling: finding only one, it goes to you
    expect(lands(s, 'p3', 'p3')).toEqual([]);
  });
  it('negative (CR 608.2d): an opponent who declines searches nothing and gives nothing; the other one still may', () => {
    const { s } = run({ p2: false, p3: true }, (st, _p, opts, search) => (search ? ofName(st, opts, 'Forest') : opts.slice(0, 1)));
    expect(lands(s, 'p1', 'p2')).toEqual([]);
    expect(lands(s, 'p2', 'p2')).toEqual([]);
    expect(lands(s, 'p1', 'p3')).toEqual(['Forest (tapped)']);
  });
  it('negative: you (the controller) are not asked to search', () => {
    const { asked } = run({ p2: false, p3: false }, () => []);
    expect(asked.some((x) => x.endsWith(':p1'))).toBe(false);
  });
});

// ---- Mastermind's Acquisition -------------------------------------------------------------------------------------------------------------------------------
describe('CR 400.11b, 700.2: "Put a card you own from outside the game into your hand." (a mode of a modal spell, not optional)', () => {
  const ACQ = card('Test Acquisition', 'Sorcery', 'Choose one —\n• Search your library for a card, put it into your hand, then shuffle.\n• Put a card you own from outside the game into your hand.', '{0}');
  const BEAR = card('Test Wish Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const BOLT = card('Test Wish Bolt', 'Instant', 'Test Wish Bolt deals 3 damage to any target.', '{R}');
  const defs = [ACQ, BEAR, BOLT];
  const board = (outside: string[]): GameState => ({ ...scenario([], { defs, p1: { hand: ['Test Acquisition'] } }), outside: { p1: outside.map((n) => defs.find((d) => d.name === n)!.id) } });
  /** Cast it choosing the second mode, answer the card choice with `name`; the decisions asked on the way. */
  const castSecond = (s0: GameState, name: string | null): { s: GameState; kinds: string[] } => {
    const kinds: string[] = [];
    let s = act(s0, { type: 'cast', player: 'p1', card: s0.zones.hand.p1![0]! });
    for (let g = 0; g < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); g++) {
      const d = s.pending!;
      kinds.push(d.kind);
      if (d.kind === 'priority') { s = act(s, { type: 'pass', player: d.player }); continue; }
      if (d.kind === 'payCost') { s = answer(s, { kind: 'payCost', auto: true }); continue; }
      if (d.kind === 'chooseOption') {
        const card = d.options.find((o) => o.label === name);
        s = answer(s, { kind: 'chooseOption', ids: [card ? card.id : d.options[d.options.length - 1]!.id] });
        continue;
      }
      throw new Error(`unexpected ${d.kind}`);
    }
    return { s, kinds };
  };
  it('is full', () => expect(full(ACQ)).toBe(true));
  it('the second mode puts the chosen card from outside the game into your hand; you are not asked whether to', () => {
    const { s, kinds } = castSecond(board(['Test Wish Bear', 'Test Wish Bolt']), 'Test Wish Bolt');
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Wish Bolt']);
    expect(kinds).not.toContain('yesNo');
  });
  it('negative (CR 400.11b): with no card outside the game, nothing is put into your hand', () => {
    const { s } = castSecond(board([]), null);
    expect(s.zones.hand.p1!.length).toBe(0);
  });
});

// ---- Niv-Mizzet Reborn ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 105.5, 608.2d: "For each color pair, choose a card that\'s exactly those colors from among them. Put the chosen cards into your hand and the rest on the bottom ..."', () => {
  const NIV = card('Test Niv', 'Legendary Creature — Dragon Avatar', 'Flying\nWhen Test Niv enters, reveal the top ten cards of your library. For each color pair, choose a card that\'s exactly those colors from among them. Put the chosen cards into your hand and the rest on the bottom of your library in a random order.', '{0}', ['6', '6']);
  const WU1 = card('Test Azorius One', 'Sorcery', '', '{W}{U}', undefined, ['W', 'U']);
  const WU2 = card('Test Azorius Two', 'Sorcery', '', '{W}{U}', undefined, ['W', 'U']);
  const UB = card('Test Dimir', 'Sorcery', '', '{U}{B}', undefined, ['U', 'B']);
  const RG = card('Test Gruul', 'Sorcery', '', '{R}{G}', undefined, ['R', 'G']);
  const MONO = card('Test White', 'Sorcery', '', '{W}', undefined, ['W']);
  const THREE = card('Test Esper', 'Sorcery', '', '{W}{U}{B}', undefined, ['W', 'U', 'B']);
  const DEEP = card('Test Deep Gruul', 'Sorcery', '', '{R}{G}', undefined, ['R', 'G']);
  const defs = [NIV, WU1, WU2, UB, RG, MONO, THREE, DEEP];
  // the top ten: the five cards above with five Plains between; the eleventh card (a Gruul card) is not revealed
  const LIB = ['Test Azorius One', 'Test Azorius Two', 'Test Dimir', 'Test White', 'Test Esper', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Test Deep Gruul'];
  const board = (): GameState => scenario(['Plains'], { defs, p1: { hand: ['Test Niv'], library: LIB } });
  const handNames = (s: GameState): string[] => s.zones.hand.p1!.map((id) => s.objects[id]!.defId).sort();
  it('is full', () => expect(full(NIV)).toBe(true));
  it('one card of each pair present (you pick which Azorius card); a mono-colored or three-color card is never taken; the rest go to the bottom', () => {
    const s0 = board();
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: s0.zones.hand.p1![0]! }));
    const prompts: string[] = [];
    for (let g = 0; g < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); g++) {
      const d = s.pending!;
      if (d.kind === 'priority') { s = act(s, { type: 'pass', player: d.player }); continue; }
      if (d.kind === 'chooseObjects') {
        prompts.push(d.options.map((id) => s.objects[id]!.defId).sort().join('+'));
        const pick = d.options.find((id) => s.objects[id]!.defId === 'Test Azorius Two') ?? d.options[0]!;
        s = answer(s, { kind: 'chooseObjects', ids: [pick] });
        continue;
      }
      if (d.kind === 'order') { s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) }); continue; }
      throw new Error(`unexpected ${d.kind}`);
    }
    expect(prompts).toEqual(['Test Azorius One+Test Azorius Two', 'Test Dimir']); // no Gruul card among the ten revealed
    expect(handNames(s)).toEqual(['Test Azorius Two', 'Test Dimir']);
    const lib = s.zones.library.p1!.map((id) => s.objects[id]!.defId);
    expect(lib[0]).toBe('Test Deep Gruul'); // the eleventh card is now on top
    expect(new Set(lib.slice(-8))).toEqual(new Set(['Test Azorius One', 'Test White', 'Test Esper', 'Plains'])); // the rest at the bottom
  });
});

// ---- Dream Cache ---------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 401.4, 608.2d: "Draw three cards, then put two cards from your hand both on top of your library or both on the bottom of your library."', () => {
  const CACHE = card('Test Cache', 'Sorcery', 'Draw three cards, then put two cards from your hand both on top of your library or both on the bottom of your library.', '{0}');
  const ONE = card('Test Keep One', 'Sorcery', '', '{1}');
  const TWO = card('Test Keep Two', 'Sorcery', '', '{1}');
  const defs = [CACHE, ONE, TWO];
  const run = (side: 'top' | 'bottom'): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Cache', 'Test Keep One', 'Test Keep Two'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: s0.zones.hand.p1!.find((id) => s0.objects[id]!.defId === 'Test Cache')! }));
    for (let g = 0; g < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); g++) {
      const d = s.pending!;
      if (d.kind === 'priority') { s = act(s, { type: 'pass', player: d.player }); continue; }
      if (d.kind === 'chooseObjects') { s = answer(s, { kind: 'chooseObjects', ids: d.options.filter((id) => s.objects[id]!.defId.startsWith('Test Keep')) }); continue; }
      if (d.kind === 'chooseOption') { s = answer(s, { kind: 'chooseOption', ids: [d.options.find((o) => o.id.includes(side) || o.label.toLowerCase().includes(side))!.id] }); continue; }
      if (d.kind === 'order') { s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) }); continue; }
      throw new Error(`unexpected ${d.kind}`);
    }
    return s;
  };
  const lib = (s: GameState): string[] => s.zones.library.p1!.map((id) => s.objects[id]!.defId);
  it('is full', () => expect(full(CACHE)).toBe(true));
  it('both on top: the two chosen cards are the top two of the library; three were drawn', () => {
    const s = run('top');
    expect(new Set(lib(s).slice(0, 2))).toEqual(new Set(['Test Keep One', 'Test Keep Two']));
    expect(s.zones.hand.p1!.length).toBe(3);
  });
  it('both on the bottom: the two chosen cards are the bottom two', () => {
    const s = run('bottom');
    expect(new Set(lib(s).slice(-2))).toEqual(new Set(['Test Keep One', 'Test Keep Two']));
    expect(lib(s).slice(0, 2)).not.toContain('Test Keep One');
  });
  it('negative ("both"): one card is never put on top and the other on the bottom', () => {
    for (const side of ['top', 'bottom'] as const) {
      const l = lib(run(side));
      const where = ['Test Keep One', 'Test Keep Two'].map((n) => l.indexOf(n) < 2 ? 'top' : 'bottom');
      expect(where[0]).toBe(where[1]);
    }
  });
});

// ---- Bounty of Skemfar ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2d, 701.20a: "You may put up to one land card from among them onto the battlefield tapped and up to one Elf card from among them into your hand. Put the rest on the bottom ..."', () => {
  const BOUNTY = card('Test Bounty', 'Sorcery', 'Reveal the top six cards of your library. You may put up to one land card from among them onto the battlefield tapped and up to one Elf card from among them into your hand. Put the rest on the bottom of your library in a random order.', '{0}');
  const ELF = card('Test Elf', 'Creature — Elf Druid', '', '{G}', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [BOUNTY, ELF, BEAR];
  const LIB = ['Forest', 'Test Elf', 'Test Bear', 'Test Elf', 'Test Bear', 'Test Bear', 'Test Elf'];
  const run = (take: boolean): GameState => {
    const s0 = scenario(['Forest'], { defs, p1: { hand: ['Test Bounty'], library: LIB } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: s0.zones.hand.p1![0]! }));
    for (let g = 0; g < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); g++) {
      const d = s.pending!;
      if (d.kind === 'priority') { s = act(s, { type: 'pass', player: d.player }); continue; }
      if (d.kind === 'chooseObjects') { s = answer(s, { kind: 'chooseObjects', ids: take ? d.options.slice(0, 1) : [] }); continue; }
      if (d.kind === 'order') { s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) }); continue; }
      throw new Error(`unexpected ${d.kind}`);
    }
    return s;
  };
  const lib = (s: GameState): string[] => s.zones.library.p1!.map((id) => s.objects[id]!.defId);
  it('is full', () => expect(full(BOUNTY)).toBe(true));
  it('one land onto the battlefield tapped, one Elf into your hand, the other four revealed cards to the bottom', () => {
    const s = run(true);
    const forest = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Forest')!;
    expect(s.objects[forest]!.tapped).toBe(true);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Elf']);
    expect(lib(s)[0]).toBe('Test Elf'); // the seventh card was not revealed: now on top
    expect(lib(s).slice(-4).sort()).toEqual(['Test Bear', 'Test Bear', 'Test Bear', 'Test Elf']);
  });
  it('negative ("up to"): choosing nothing puts all six revealed cards on the bottom', () => {
    const s = run(false);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Forest')).toBe(false);
    expect(s.zones.hand.p1!.length).toBe(0);
    expect(lib(s).slice(-6).sort()).toEqual(['Forest', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Elf', 'Test Elf']);
  });
});
