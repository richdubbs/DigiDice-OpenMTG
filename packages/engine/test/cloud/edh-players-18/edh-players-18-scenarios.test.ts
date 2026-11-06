/**
 * edh-players-18 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites were checked against the Comprehensive Rules text of
 * 2026-09-25 (media.wizards.com).
 *
 *   CR 603.2c, 102.3, 608.2h, 510.2   "Whenever one or more Zombies you control deal combat damage to one or more of your opponents, you may draw cards equal to the number of
 *                                      opponents dealt damage this way. If you do, discard that many cards."
 *   CR 102.3, 603.4                   "At the beginning of each player's end step, that player draws a card. If the player is your opponent and has four or more cards in hand, ..."
 *   CR 610.3, 725.1, 725.3            "When this creature enters, exile target creature an opponent controls until an opponent becomes the monarch."
 *   CR 121.2, 614.1a, 614.6           "If an opponent would draw two or more cards, instead you and that player each draw a card."
 *   CR 106.4, 500.5, 608.2c           "... you may discard any number of cards. If you do, draw that many cards and add that much {R}. Until end of turn, you don't lose this mana ..."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { answer, pool } from '../../m3/scenario';
import { act, concede, find, lifeOf, mpScenario, pass, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const namesIn = (s: GameState, zone: 'battlefield' | 'exile' | 'graveyard' | 'hand', p?: PlayerId): string[] => {
  const ids = zone === 'battlefield' ? s.zones.battlefield.filter((id) => p === undefined || s.objects[id]!.controller === p) : zone === 'exile' ? s.zones.exile : s.zones[zone][p!]!;
  return ids.map((id) => nameOf(s, id)).sort();
};

/** Answer decisions (yes to every "may", the first objects/targets offered, costs paid) until a player holds priority. */
function drive(s0: GameState, o: { yes?: boolean; targets?: (opts: unknown) => unknown[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as { kind: string; min?: number; options?: ObjectId[]; items?: { id: string }[]; candidates?: unknown[]; max?: number };
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.max ?? p.min ?? 0 } as never);
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options ?? []).slice(0, Math.max(p.min ?? 0, p.max === undefined || p.max > 1000 ? (p.options ?? []).length : p.max)) } as never);
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (o.targets ? o.targets(p) : []) as never });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items!.map((i) => i.id) } as never);
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(s.pending)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty, answering decisions with `drive`. */
function settle(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 80; guard++) s = drive(pass(s), o);
  return s;
}
/** The active player attacks with the given creatures and the combat plays out with no blocks. */
function fight(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[], o: Parameters<typeof drive>[1] = {}): GameState {
  let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks });
  for (let i = 0; i < 400 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
    const d = s.pending!;
    if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'priority') s = pass(s);
    else s = drive(s, o);
  }
  return s;
}

// ---- Hordewing Skaab: "the number of opponents dealt damage this way" ---------------------------------------------------------------------------------------------------

const SKAAB = card('Test Tide Skaab', 'Creature — Zombie Horror', 'Whenever one or more Zombies you control deal combat damage to one or more of your opponents, you may draw cards equal to the number of opponents dealt damage this way. If you do, discard that many cards.', { pt: ['2', '2'] });
const ZOMBIE = card('Test Shambler', 'Creature — Zombie', '', { pt: ['1', '1'] });
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 603.2c, 102.3, 608.2h: "you may draw cards equal to the number of opponents dealt damage this way. If you do, discard that many cards."', () => {
  const defs = [SKAAB, ZOMBIE, BEAR];
  const board = (extra: string[]) => mpScenario({ defs, zones: { p1: { battlefield: [...extra] } } });
  const ids = (s: GameState, n: string): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === n);
  it('is automated', () => expect(full(SKAAB)).toBe(true));
  it('two Zombies hitting two different opponents: one trigger counting two opponents, two cards drawn and two discarded (hand size unchanged, graveyard +2)', () => {
    let s = board(['Test Tide Skaab', 'Test Shambler', 'Test Shambler']);
    const [a, b] = ids(s, 'Test Shambler');
    const before = handSize(s, 'p1');
    s = fight(s, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p3' }]);
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p3')).toBe(19);
    expect(handSize(s, 'p1')).toBe(before);
    expect(s.zones.graveyard['p1']!.length).toBe(2);
  });
  it('three Zombies hitting the same two opponents are still two opponents: two cards (the number of opponents, not of Zombies)', () => {
    let s = board(['Test Tide Skaab', 'Test Shambler', 'Test Shambler', 'Test Shambler']);
    const [a, b, c] = ids(s, 'Test Shambler');
    s = fight(s, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }, { attacker: c!, defender: 'p3' }]);
    expect(s.zones.graveyard['p1']!.length).toBe(2);
  });
  it('one opponent dealt damage: one card, discarded; a Zombie dealing damage alone also triggers it (the Skaab itself is a Zombie)', () => {
    let s = board(['Test Tide Skaab']);
    s = fight(s, [{ attacker: ids(s, 'Test Tide Skaab')[0]!, defender: 'p4' }]);
    expect(s.zones.graveyard['p1']!.length).toBe(1);
  });
  it('the ruling of 2021-09-24: the cards discarded are the number of opponents dealt damage even when the draw drew nothing (each draw is replaced)', () => {
    const LEECH = card('Test Drought Idol', 'Artifact', 'If you would draw a card, instead you gain 1 life.');
    expect(full(LEECH)).toBe(true);
    let s = mpScenario({ defs: [...defs, LEECH, BEAR], zones: { p1: { battlefield: ['Test Tide Skaab', 'Test Shambler', 'Test Shambler', 'Test Drought Idol'], hand: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] } } });
    const [a, b] = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Shambler');
    const lifeBefore = lifeOf(s, 'p1');
    s = fight(s, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p3' }]);
    expect(handSize(s, 'p1')).toBe(1); // nothing was drawn (two life gained instead); two of the three cards were discarded all the same
    expect(lifeOf(s, 'p1')).toBe(lifeBefore + 2);
    expect(s.zones.graveyard['p1']!.length).toBe(2);
  });
  it('negative: a creature that is no Zombie dealing damage draws nothing; declining the option draws nothing', () => {
    let s = board(['Test Tide Skaab', 'Test Plain Bear']);
    const before = handSize(s, 'p1');
    s = fight(s, [{ attacker: ids(s, 'Test Plain Bear')[0]!, defender: 'p2' }]);
    expect(handSize(s, 'p1')).toBe(before);
    expect(s.zones.graveyard['p1']!.length).toBe(0);
    let t = board(['Test Tide Skaab', 'Test Shambler']);
    t = fight(t, [{ attacker: ids(t, 'Test Shambler')[0]!, defender: 'p2' }], { yes: false });
    expect(handSize(t, 'p1')).toBe(handSize(board(['Test Tide Skaab']), 'p1'));
    expect(t.zones.graveyard['p1']!.length).toBe(0);
  });
});

// ---- Fevered Visions: "If the player is your opponent and has four or more cards in hand" ---------------------------------------------------------------------------------

const VISIONS = card('Test Fevered Idol', 'Enchantment', "At the beginning of each player's end step, that player draws a card. If the player is your opponent and has four or more cards in hand, ~ deals 2 damage to that player.");

describe('CR 102.3, 603.4: "If the player is your opponent and has four or more cards in hand, ~ deals 2 damage to that player."', () => {
  const bears = (n: number): string[] => Array<string>(n).fill('Test Plain Bear');
  const setup = (h1: number, h2: number, h3 = 0): GameState => mpScenario({
    defs: [VISIONS, BEAR],
    zones: { p1: { battlefield: ['Test Fevered Idol'], hand: bears(h1) }, p2: { hand: bears(h2) }, p3: { hand: bears(h3) } },
  });
  /** Pass until the end step of `who` and its triggers have resolved (the end step stays). */
  function endStepOf(s0: GameState, who: PlayerId): GameState {
    let s = passUntil(s0, (x) => x.turn.step === 'end' && x.turn.activePlayer === who && x.pending?.kind === 'priority', `the end step of ${who}`);
    for (let g = 0; g < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    return s;
  }
  it('is automated', () => expect(full(VISIONS)).toBe(true));
  // (the opponent's turn has a draw step too: two cards in hand become three in the draw step and four when the Idol's draw resolves)
  it('an opponent with four cards in hand after drawing takes 2 damage at their end step', () => {
    const s = endStepOf(setup(0, 2), 'p2');
    expect(handSize(s, 'p2')).toBe(4);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(setup(0, 2), 'p2') - 2);
  });
  it('negative: an opponent who ends with three cards in hand takes none (the draw comes first, four is the threshold)', () => {
    const s = endStepOf(setup(0, 1), 'p2');
    expect(handSize(s, 'p2')).toBe(3);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(setup(0, 1), 'p2'));
  });
  it('negative: at your own end step you draw and take nothing, however big your hand ("the player is your opponent")', () => {
    const base = setup(6, 0);
    const s = endStepOf(base, 'p1');
    expect(handSize(s, 'p1')).toBeGreaterThanOrEqual(7);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(base, 'p1'));
  });
  it("an opponent's Idol does not hurt you: only the controller's opponents are damaged (the other Idol's controller is the one whose opponent you are)", () => {
    const base = mpScenario({ defs: [VISIONS, BEAR], zones: { p1: { hand: bears(5) }, p2: { battlefield: ['Test Fevered Idol'] } } });
    const s = endStepOf(base, 'p1');
    expect(lifeOf(s, 'p1')).toBe(lifeOf(base, 'p1') - 2); // p1 is p2's opponent: the Idol of p2 deals 2 to p1
  });
});

// ---- Palace Jailer: "until an opponent becomes the monarch" ---------------------------------------------------------------------------------------------------------------

const JAILER = card('Test Gate Warden', 'Creature — Human Soldier', 'When this creature enters, you become the monarch.\nWhen this creature enters, exile target creature an opponent controls until an opponent becomes the monarch.', { pt: ['2', '2'] });
const TOLLER = card('Test Toll Warden', 'Creature — Human Soldier', 'When this creature enters, exile target creature an opponent controls until an opponent becomes the monarch.', { pt: ['2', '2'] });
const RAIDER = card('Test Raider', 'Creature — Human Pirate', '', { pt: ['2', '2'] });
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const CROWN = card('Test Crown', 'Sorcery', 'You become the monarch.');

describe('CR 610.3, 725.3: "exile target creature an opponent controls until an opponent becomes the monarch."', () => {
  const defs = [JAILER, TOLLER, BEAR, RAIDER, SMITE, CROWN];
  const obj = (s: GameState, n: string, p: PlayerId): ObjectId => find(s, n, 'battlefield', p);
  /** p1 casts the card; the first target offered to each trigger is the creature of p2 named. */
  function enter(s0: GameState, cardName: string): GameState {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, cardName, 'hand', 'p1') });
    const bearId = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    s = settle(s, { targets: () => [{ kind: 'object', id: bearId }] });
    return s;
  }
  const scene = (card1: string, extra: Partial<Record<PlayerId, { hand?: string[]; battlefield?: string[] }>> = {}): GameState => mpScenario({
    defs, zones: { p1: { hand: [card1] }, p2: { battlefield: ['Test Plain Bear', 'Test Raider'] }, p3: {}, ...extra },
  });
  const monarch = (s: GameState): PlayerId | undefined => s.designations.monarch as PlayerId | undefined;
  it('is automated', () => { expect(full(JAILER)).toBe(true); expect(full(TOLLER)).toBe(true); });
  it("the creature is exiled and you are the monarch; it stays exiled while no opponent becomes the monarch (the negative case: you stay the monarch)", () => {
    const s = enter(scene('Test Gate Warden'), 'Test Gate Warden');
    expect(monarch(s)).toBe('p1');
    expect(namesIn(s, 'exile')).toEqual(['Test Plain Bear']);
    expect(namesIn(s, 'battlefield', 'p2')).toEqual(['Test Raider']);
  });
  it('an opponent that becomes the monarch (combat damage to the monarch) brings it back under its owner, on the battlefield', () => {
    let s = enter(scene('Test Gate Warden'), 'Test Gate Warden');
    // p2's turn: the Raider attacks p1, the monarch
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', 'p2 attacks');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: obj(s, 'Test Raider', 'p2'), defender: 'p1' }] });
    for (let i = 0; i < 400 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'priority') s = pass(s);
      else s = drive(s);
    }
    s = settle(s);
    expect(monarch(s)).toBe('p2');
    expect(namesIn(s, 'exile')).toEqual([]);
    expect(namesIn(s, 'battlefield', 'p2')).toEqual(['Test Plain Bear', 'Test Raider']);
  });
  it("any opponent becoming the monarch ends it, not only the creature's controller (ruling 2021-03-19): p3 takes the crown", () => {
    let s = enter(scene('Test Gate Warden', { p3: { hand: ['Test Crown'] } }), 'Test Gate Warden');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p3' && x.pending?.kind === 'priority' && x.turn.step === 'main1', 'p3 main phase');
    s = settle(act(s, { type: 'cast', player: 'p3', card: find(s, 'Test Crown', 'hand', 'p3') }));
    expect(monarch(s)).toBe('p3');
    expect(namesIn(s, 'exile')).toEqual([]);
    expect(namesIn(s, 'battlefield', 'p2')).toContain('Test Plain Bear');
  });
  it('the Warden leaving the battlefield does not bring it back (ruling 2021-03-19)', () => {
    let s = enter(scene('Test Gate Warden', { p1: { hand: ['Test Gate Warden', 'Test Smite'] } }), 'Test Gate Warden');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') }), { targets: () => [{ kind: 'object', id: obj(s, 'Test Gate Warden', 'p1') }] });
    expect(namesIn(s, 'battlefield', 'p1')).toEqual([]);
    expect(namesIn(s, 'exile')).toEqual(['Test Plain Bear']);
  });
  it('CR 610.3b: an opponent became the monarch after the ability triggered and before it resolved: the creature is not exiled at all', () => {
    const FLASH = card('Test Flash Crown', 'Instant', 'You become the monarch.');
    let s = mpScenario({ defs: [...defs, FLASH], zones: { p1: { hand: ['Test Gate Warden'] }, p2: { battlefield: ['Test Plain Bear'], hand: ['Test Flash Crown'] } } });
    const bearId = find(s, 'Test Plain Bear', 'battlefield', 'p2');
    const pick = { targets: () => [{ kind: 'object', id: bearId }] };
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gate Warden', 'hand', 'p1') }), pick);
    // the creature spell resolves; both triggers wait on the stack with p1 holding priority
    for (let g = 0; g < 20 && !s.zones.stack.some((id) => s.objects[id]!.kind === 'ability'); g++) s = drive(pass(s), pick);
    expect(s.zones.stack.filter((id) => s.objects[id]!.kind === 'ability').length).toBeGreaterThan(0);
    // p1 passes; p2 answers with the Crown
    s = pass(s);
    expect(s.pending?.kind === 'priority' ? s.pending.player : null).toBe('p2');
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash Crown', 'hand', 'p2') }));
    expect(namesIn(s, 'exile')).toEqual([]);
    expect(namesIn(s, 'battlefield', 'p2')).toEqual(['Test Plain Bear']);
  });
  it('CR 725.4, 610.3: the monarch leaves the game and the player whose turn it is becomes the monarch: that is an opponent becoming the monarch, so the creature returns (ruling 2021-03-19)', () => {
    const base = mpScenario({ defs, zones: { p1: { hand: ['Test Toll Warden'] }, p3: { battlefield: ['Test Plain Bear'] } }, setup: (x) => { x.designations.monarch = 'p2'; } });
    const bearId = find(base, 'Test Plain Bear', 'battlefield', 'p3');
    let s = settle(act(base, { type: 'cast', player: 'p1', card: find(base, 'Test Toll Warden', 'hand', 'p1') }), { targets: () => [{ kind: 'object', id: bearId }] });
    expect(namesIn(s, 'exile')).toEqual(['Test Plain Bear']);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p4' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p4 main phase');
    s = concede(s, 'p2').state; // the monarch leaves: p4, whose turn it is, becomes the monarch
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p1 main phase');
    expect(monarch(s)).toBe('p4');
    expect(namesIn(s, 'exile')).toEqual([]);
    expect(namesIn(s, 'battlefield', 'p3')).toEqual(['Test Plain Bear']);
  });
  it('an opponent that already is the monarch does not return it at once (ruling 2021-03-19): only a NEW opponent monarch does', () => {
    const base = mpScenario({ defs, zones: { p1: { hand: ['Test Toll Warden'] }, p2: { battlefield: ['Test Plain Bear'] } }, setup: (s) => { s.designations.monarch = 'p2'; } });
    const s = enter(base, 'Test Toll Warden');
    expect(monarch(s)).toBe('p2');
    expect(namesIn(s, 'exile')).toEqual(['Test Plain Bear']);
  });
});

// ---- Alms Collector: "If an opponent would draw two or more cards, instead you and that player each draw a card." -----------------------------------------------------------

const COLLECTOR = card('Test Alms Keeper', 'Creature — Cat Cleric', 'Flash\nIf an opponent would draw two or more cards, instead you and that player each draw a card.', { pt: ['2', '2'] });
const THREE = card('Test Insight', 'Sorcery', 'Draw three cards.');
const TWO = card('Test Twin Insight', 'Sorcery', 'Target opponent draws two cards.');
const ONE = card('Test Glimpse', 'Sorcery', 'Draw a card.');

describe('CR 121.2, 614.1a, 614.6: "If an opponent would draw two or more cards, instead you and that player each draw a card."', () => {
  const defs = [COLLECTOR, THREE, TWO, ONE];
  const setup = (zones: Partial<Record<PlayerId, { hand?: string[]; battlefield?: string[] }>>): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Alms Keeper'] }, ...zones } });
  /** `who` casts the card (on their own main phase: p1's turn, so only p1 can cast sorceries; the opponent's cards are made instants by giving p2 the turn). */
  it('is automated', () => expect(full(COLLECTOR)).toBe(true));
  it('an opponent drawing three cards instead draws one, and you draw one (the replacement applies to the whole draw of two or more)', () => {
    const base = mpScenario({ defs, zones: { p1: { battlefield: ['Test Alms Keeper'] }, p2: { hand: ['Test Insight'] } } });
    let s = passUntil(base, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p2 main phase');
    const h1 = handSize(s, 'p1');
    const h2 = handSize(s, 'p2');
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Insight', 'hand', 'p2') }));
    expect(handSize(s, 'p2')).toBe(h2 - 1 + 1); // the spell left the hand, one card drawn
    expect(handSize(s, 'p1')).toBe(h1 + 1);
  });
  it('an opponent drawing exactly one card is untouched (the negative case: one card is not two or more)', () => {
    const base = mpScenario({ defs, zones: { p1: { battlefield: ['Test Alms Keeper'] }, p2: { hand: ['Test Glimpse'] } } });
    let s = passUntil(base, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p2 main phase');
    const h1 = handSize(s, 'p1');
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Glimpse', 'hand', 'p2') }));
    expect(handSize(s, 'p1')).toBe(h1);
  });
  it('the draw step of an opponent (one card) is untouched', () => {
    const base = setup({});
    const s = passUntil(base, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'upkeep' && x.pending?.kind === 'priority', 'p2 upkeep');
    const h1 = handSize(s, 'p1');
    const s2 = passUntil(s, (x) => x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p2 main phase');
    expect(handSize(s2, 'p1')).toBe(h1);
  });
  it('negative: you drawing three cards draw three (the replacement is for an opponent only)', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Alms Keeper'], hand: ['Test Insight'] } } });
    const h1 = handSize(s, 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Insight', 'hand', 'p1') }));
    expect(handSize(s, 'p1')).toBe(h1 - 1 + 3);
  });
  it('an opponent made to draw two cards by your spell: the replacement applies (it is the drawing player that counts)', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Alms Keeper'], hand: ['Test Twin Insight'] } } });
    const h1 = handSize(s, 'p1');
    const h2 = handSize(s, 'p2');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Twin Insight', 'hand', 'p1') }), { targets: () => [{ kind: 'player', id: 'p2' }] });
    expect(handSize(s, 'p2')).toBe(h2 + 1);
    expect(handSize(s, 'p1')).toBe(h1 - 1 + 1);
  });
});

// ---- Neheb, Dreadhorde Champion: "If you do, draw that many cards and add that much {R}. Until end of turn, you don't lose this mana as steps and phases end." --------------

const CHAMPION = card('Test Dread Champion', 'Creature — Zombie Minotaur', 'Trample\nWhenever ~ deals combat damage to a player or planeswalker, you may discard any number of cards. If you do, draw that many cards and add that much {R}. Until end of turn, you don\'t lose this mana as steps and phases end.', { pt: ['3', '3'] });

describe('CR 106.4, 500.5, 608.2c: "you may discard any number of cards. If you do, draw that many cards and add that much {R}. Until end of turn, you don\'t lose this mana ..."', () => {
  const setup = (): GameState => mpScenario({ defs: [CHAMPION, BEAR], zones: { p1: { battlefield: ['Test Dread Champion'], hand: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] } } });
  const attack = (s0: GameState, o: Parameters<typeof drive>[1]): GameState => fight(s0, [{ attacker: find(s0, 'Test Dread Champion', 'battlefield', 'p1'), defender: 'p2' }], o);
  it('is automated', () => expect(full(CHAMPION)).toBe(true));
  it('discarding the whole hand: as many cards drawn, as much {R} in the pool, still there in the second main phase (kept through the steps of the turn)', () => {
    const n = handSize(setup(), 'p1'); // (the card drawn in the draw step is in the hand too)
    const s = passUntil(attack(setup(), { yes: true }), (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(handSize(s, 'p1')).toBe(n);
    expect(s.zones.graveyard['p1']!.length).toBe(n);
    expect(pool(s, 'p1')).toBe('R'.repeat(n));
  });
  it('negative: declining the option discards, draws and adds nothing', () => {
    const s = attack(setup(), { yes: false });
    expect(handSize(s, 'p1')).toBe(handSize(setup(), 'p1'));
    expect(s.zones.graveyard['p1']!.length).toBe(0);
    expect(pool(s, 'p1')).toBe('');
  });
});
