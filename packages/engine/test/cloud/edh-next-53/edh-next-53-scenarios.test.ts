/**
 * Commander EDHREC ranks 8,751-10,000, round edh-next-53 (fourth pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by
 * the game's default compiler. Each test is named after the rule it checks, with its negative case. Cites of the Comprehensive Rules 2026-09-25 were checked against the text where the
 * round's record says so.
 *
 *   CR 508.1b, 506.3, 603.2c, 603.4   "Whenever an opponent attacks, if they attacked you and/or a planeswalker you control, draw a card." (Ever-Watching Threshold)
 *   CR 506.2, 508.1b, 603.4, 615.1    "Whenever a player attacks you, if that player has another opponent who isn't being attacked, prevent all combat damage that would be dealt to you this combat." (Suppressor Skyguard)
 *   CR 614.15, 608.2c, 615.1          "Prevent all combat damage that would be dealt this turn. Ferocious - If ..., instead prevent all combat damage ... by creatures your opponents control." (Winds of Qal Sisma)
 *   CR 614.15, 701.17a, 601.2b        "Target player mills X cards. If this spell was cast from a graveyard, that player mills twice that many cards instead." (Increasing Confusion)
 *   CR 614.15, 701.23a, 702.34a       "Search your library for a card and put that card into your hand. If this spell was cast from a graveyard, instead search ... two cards ..." (Increasing Ambition)
 *   CR 400.7, 603.4, 601.2a, 614.15   "When ~ enters, draw a card. If it entered from your library or was cast from your library, draw two cards instead." (Fblthp, the Lost)
 *   CR 614.15, 700.8, 120.3           "~ deals 1 damage to each opponent. If you have a full party, it deals 3 damage to each opponent instead." (The Destined Black Mage)
 *   CR 120.2b, 608.2h, 602.2          "{4}, Sacrifice ~: It deals damage equal to the number of charge counters on it to target player and that much damage to up to one target creature." (Dragonspark Reactor)
 *   CR 603.2c, 701.9a                 "Whenever you discard one or more nonland cards for the first time each turn, create a Junk token." (Veronica, Dissident Scribe)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

/** Answer the decisions that come up until priority (payments automatic; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: ObjectId[]; yes?: boolean; x?: number; players?: PlayerId[] } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      // (the targets are chosen one requirement at a time)
      const d = p as unknown as { players: PlayerId[]; objects: ObjectId[]; min: number };
      const pl = (o.players ?? []).find((x) => d.players.includes(x));
      const ob = targets.find((x) => d.objects.includes(x));
      if (pl !== undefined) { (o.players ?? []).splice((o.players ?? []).indexOf(pl), 1); s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: pl }] }); }
      else if (ob !== undefined) { targets.splice(targets.indexOf(ob), 1); s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: ob }] }); }
      else s = answer(s, { kind: 'chooseTargets', targets: d.min === 0 ? [] : d.players.length > 0 ? [{ kind: 'player', id: d.players[0]! }] : [{ kind: 'object', id: d.objects[0]! }] });
    }
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'assignDamage') s = answer(s, { kind: 'assignDamage', amounts: p.recipients.map((r, i) => ({ id: r.id, amount: i === 0 ? p.amount : 0 })) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const lib = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
const gy = (s: GameState, p: PlayerId): number => s.zones.graveyard[p]!.length;
const byName = (s: GameState, name: string, p?: PlayerId): ObjectId[] => (p ? findAll(s, name, 'battlefield', p) : s.zones.battlefield.filter((id) => chars(s, id).name === name));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;

/** Pass priority (answering decisions) until the next declare-attackers decision. */
function toAttackers(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 120 && s.pending?.kind !== 'declareAttackers'; i++) {
    if (s.result) throw new Error('The game ended');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  }
  expect(s.pending?.kind).toBe('declareAttackers');
  return s;
}
const declare = (s: GameState, attacks: [ObjectId, PlayerId | ObjectId][]): GameState => answer(s, { kind: 'declareAttackers', attacks: attacks.map(([attacker, defender]) => ({ attacker, defender })) });
/** Pass until `done`, declaring no blocks and no attackers when asked. */
function runUntil(s0: GameState, done: (s: GameState) => boolean, what: string, max = 400, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`The game ended while waiting for ${what}`);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  }
  throw new Error(`Never reached ${what}`);
}
const afterCombatDamage = (s: GameState): GameState => runUntil(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'the end of combat');

const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const WALKER = card('Test Quiet Walker', 'Planeswalker — Test', '', { loyalty: '5' });
const bears = (n: number): { name: string; since: number }[] => Array.from({ length: n }, () => ({ name: 'Test Plain Bear', since: -1 }));

// ---- Ever-Watching Threshold ----------------------------------------------------------------------------------------------------------------------------------------
const THRESHOLD = card('Test Threshold', 'Enchantment', 'Whenever an opponent attacks, if they attacked you and/or a planeswalker you control, draw a card.');
describe('CR 508.1b, 506.3, 603.4: "Whenever an opponent attacks, if they attacked you and/or a planeswalker you control, draw a card."', () => {
  it('is fully automated', () => { expect(noManual(THRESHOLD) && THRESHOLD.automation.level === 'full').toBe(true); });
  const start = (active: PlayerId): GameState => mpScenario({
    players: 3, defs: [BEAR, WALKER, THRESHOLD], options: { startingPlayer: active },
    zones: { p1: { battlefield: ['Test Threshold', { name: 'Test Quiet Walker', counters: { loyalty: 5 } } as never, ...bears(2)] }, p2: { battlefield: bears(3) }, p3: { battlefield: bears(3) } },
  });
  const attackAs = (active: PlayerId, attacks: [number, PlayerId | 'walker'][]): { before: GameState; after: GameState } => {
    const before = start(active);
    const s0 = toAttackers(before);
    const mine = byName(s0, 'Test Plain Bear', active);
    const walker = byName(s0, 'Test Quiet Walker', 'p1')[0]!;
    return { before: s0, after: resolveAll(declare(s0, attacks.map(([i, d]) => [mine[i]!, d === 'walker' ? walker : d] as [ObjectId, PlayerId | ObjectId]))) };
  };
  it('an opponent attacks you with two creatures: one card, not two (one occurrence for the declaration)', () => {
    const { before, after } = attackAs('p2', [[0, 'p1'], [1, 'p1']]);
    expect(hand(after, 'p1') - hand(before, 'p1')).toBe(1);
  });
  it('an opponent attacks a planeswalker you control: a card (ruling: "you or your planeswalkers")', () => {
    const { before, after } = attackAs('p2', [[0, 'walker']]);
    expect(hand(after, 'p1') - hand(before, 'p1')).toBe(1);
  });
  it('negative: an opponent attacks the third player only: no card', () => {
    const { before, after } = attackAs('p2', [[0, 'p3'], [1, 'p3']]);
    expect(hand(after, 'p1')).toBe(hand(before, 'p1'));
  });
  it('an opponent attacks you and the third player: one card (they attacked you)', () => {
    const { before, after } = attackAs('p2', [[0, 'p1'], [1, 'p3']]);
    expect(hand(after, 'p1') - hand(before, 'p1')).toBe(1);
  });
  it('negative: you attack (the attacker is not an opponent): no card', () => {
    const { before, after } = attackAs('p1', [[0, 'p2']]);
    expect(hand(after, 'p1') - hand(before, 'p1')).toBe(0);
  });
});

// ---- Suppressor Skyguard ---------------------------------------------------------------------------------------------------------------------------------------------
const SKYGUARD = card('Test Skyguard', 'Creature — Human Knight', "Whenever a player attacks you, if that player has another opponent who isn't being attacked, prevent all combat damage that would be dealt to you this combat.", { pt: ['2', '2'] });
describe("CR 506.2, 508.1b, 603.4: \"Whenever a player attacks you, if that player has another opponent who isn't being attacked, prevent all combat damage that would be dealt to you this combat.\"", () => {
  it('is fully automated', () => { expect(noManual(SKYGUARD) && SKYGUARD.automation.level === 'full').toBe(true); });
  const start = (players = 3): GameState => mpScenario({
    players, defs: [BEAR, WALKER, SKYGUARD], options: { startingPlayer: 'p2' },
    zones: { p1: { battlefield: ['Test Skyguard'] }, p2: { battlefield: bears(3) }, p3: { battlefield: [{ name: 'Test Quiet Walker', counters: { loyalty: 5 } } as never] }, p4: {} },
  });
  const attack = (attacks: [number, PlayerId | 'walker'][], players = 3): { before: GameState; after: GameState } => {
    const s0 = toAttackers(start(players));
    const mine = byName(s0, 'Test Plain Bear', 'p2');
    const walker = byName(s0, 'Test Quiet Walker', 'p3')[0]!;
    const before = s0;
    const s = resolveAll(declare(s0, attacks.map(([i, d]) => [mine[i]!, d === 'walker' ? walker : d] as [ObjectId, PlayerId | ObjectId])));
    return { before, after: afterCombatDamage(s) };
  };
  it('the attacker has another opponent (the third player) who is not being attacked: no combat damage is dealt to you this combat', () => {
    const { before, after } = attack([[0, 'p1'], [1, 'p1']]);
    expect(life(after, 'p1')).toBe(life(before, 'p1'));
  });
  it("ruling: a planeswalker of the third player being attacked does not make that player \"being attacked\": still prevented", () => {
    const { before, after } = attack([[0, 'p1'], [1, 'walker']]);
    expect(life(after, 'p1')).toBe(life(before, 'p1'));
  });
  it('negative: the attacker attacks the third player too: every other opponent is attacked, the ability does nothing and you take the damage', () => {
    const { before, after } = attack([[0, 'p1'], [1, 'p3']]);
    expect(life(after, 'p1')).toBe(life(before, 'p1') - 2);
  });
});

// ---- Winds of Qal Sisma ----------------------------------------------------------------------------------------------------------------------------------------------
const WINDS = card('Test Winds', 'Instant', 'Prevent all combat damage that would be dealt this turn.\nFerocious — If you control a creature with power 4 or greater, instead prevent all combat damage that would be dealt this turn by creatures your opponents control.');
const TITAN = card('Test Titan', 'Creature — Giant', '', { pt: ['4', '4'] });
describe('CR 614.15, 608.2c, 615.1: "Prevent all combat damage that would be dealt this turn. Ferocious — If ..., instead prevent all combat damage ... by creatures your opponents control."', () => {
  it('is fully automated', () => { expect(noManual(WINDS) && WINDS.automation.level === 'full').toBe(true); });
  const run = (mine: string[]): GameState => {
    let s = scenario([], { defs: [BEAR, TITAN, WINDS], p1: { hand: ['Test Winds'], battlefield: mine.map((name) => ({ name, since: -1 })) }, p2: { battlefield: [{ name: 'Test Plain Bear', since: -1 }] } });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Winds', 'hand', 'p1') }));
    s = toAttackers(s);
    const attackers = mine.map((_, i) => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1')[i]!);
    return afterCombatDamage(declare(s, attackers.map((a) => [a, 'p2'] as [ObjectId, PlayerId])));
  };
  it('without a creature of power 4 or greater: all combat damage is prevented, your creature deals none either', () => {
    expect(life(run(['Test Plain Bear']), 'p2')).toBe(20);
  });
  it('with a creature of power 4 or greater: only the damage of creatures your opponents control is prevented, your creatures still deal damage', () => {
    expect(life(run(['Test Plain Bear', 'Test Titan']), 'p2')).toBe(20 - 2 - 4);
  });
});

// ---- Increasing Confusion --------------------------------------------------------------------------------------------------------------------------------------------
const CONFUSION = card('Test Confusion', 'Sorcery', 'Target player mills X cards. If this spell was cast from a graveyard, that player mills twice that many cards instead.\nFlashback {X}{U}', { cost: '{X}{U}' });
describe('CR 614.15, 701.17a, 601.2b: "Target player mills X cards. If this spell was cast from a graveyard, that player mills twice that many cards instead."', () => {
  it('is fully automated', () => { expect(noManual(CONFUSION) && CONFUSION.automation.level === 'full').toBe(true); });
  const SWAMP = card('Test Island', 'Basic Land — Island', '{T}: Add {U}.');
  const fromHand = (x: number): GameState => {
    let s = scenario([], { defs: [CONFUSION, SWAMP], p1: { hand: ['Test Confusion'], battlefield: Array.from({ length: 8 }, () => 'Test Island') } });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Confusion', 'hand', 'p1') }), { x, players: ['p2'] });
    return s;
  };
  const fromYard = (x: number): GameState => {
    let s = scenario([], { defs: [CONFUSION, SWAMP], p1: { graveyard: ['Test Confusion'], battlefield: Array.from({ length: 8 }, () => 'Test Island') } });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Confusion', 'graveyard', 'p1'), method: 'flashback' } as never), { x, players: ['p2'] });
    return s;
  };
  it('cast from the hand with X = 3: the player mills 3 cards', () => {
    const before = scenario([], { defs: [CONFUSION, SWAMP], p1: { hand: ['Test Confusion'] } });
    expect(gy(fromHand(3), 'p2') - gy(before, 'p2')).toBe(3);
  });
  it('cast from the graveyard (flashback) with X = 3: twice that many, 6 cards', () => {
    const before = scenario([], { defs: [CONFUSION, SWAMP], p1: { hand: [] } });
    expect(gy(fromYard(3), 'p2') - gy(before, 'p2')).toBe(6);
  });
});

// ---- Increasing Ambition ---------------------------------------------------------------------------------------------------------------------------------------------
const AMBITION = card('Test Ambition', 'Sorcery', 'Search your library for a card and put that card into your hand. If this spell was cast from a graveyard, instead search your library for two cards and put those cards into your hand. Then shuffle.\nFlashback {1}', { cost: '{1}' });
describe('CR 614.15, 701.23a, 702.34a: "Search your library for a card and put that card into your hand. If this spell was cast from a graveyard, instead search your library for two cards ..."', () => {
  it('is fully automated', () => { expect(noManual(AMBITION) && AMBITION.automation.level === 'full').toBe(true); });
  const ROCK = card('Test Boulder', 'Artifact', '{T}: Add {C}.');
  const cast = (zone: 'hand' | 'graveyard'): { before: GameState; after: GameState } => {
    const s0 = scenario([], { defs: [AMBITION, ROCK], p1: { ...(zone === 'hand' ? { hand: ['Test Ambition'] } : { graveyard: ['Test Ambition'] }), battlefield: ['Test Boulder'] } });
    const act0 = { type: 'cast', player: 'p1', card: find(s0, 'Test Ambition', zone, 'p1'), ...(zone === 'graveyard' ? { method: 'flashback' } : {}) } as never;
    return { before: s0, after: resolveAll(act(s0, act0)) };
  };
  it('cast from the hand: one card into your hand', () => {
    const { before, after } = cast('hand');
    expect(hand(after, 'p1') - (hand(before, 'p1') - 1)).toBe(1);
    expect(lib(before, 'p1') - lib(after, 'p1')).toBe(1);
  });
  it('cast from the graveyard (flashback): two cards into your hand', () => {
    const { before, after } = cast('graveyard');
    expect(hand(after, 'p1') - hand(before, 'p1')).toBe(2);
    expect(lib(before, 'p1') - lib(after, 'p1')).toBe(2);
  });
});

// ---- Fblthp, the Lost ------------------------------------------------------------------------------------------------------------------------------------------------
const FBLTHP = card('Test Homunculus', 'Legendary Creature — Homunculus', 'When this creature enters, draw a card. If it entered from your library or was cast from your library, draw two cards instead.', { pt: ['1', '1'] });
const TUTOR = card('Test Summons', 'Sorcery', 'Search your library for a creature card, put it onto the battlefield, then shuffle.');
const PUT = card('Test Reanimation', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
describe('CR 400.7, 603.4, 601.2a, 614.15: "When ~ enters, draw a card. If it entered from your library or was cast from your library, draw two cards instead."', () => {
  it('is fully automated', () => { expect(noManual(FBLTHP) && FBLTHP.automation.level === 'full').toBe(true); });
  it('cast from the hand: one card', () => {
    let s = scenario([], { defs: [FBLTHP], p1: { hand: ['Test Homunculus'] } });
    const h = hand(s, 'p1');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Homunculus', 'hand', 'p1') }));
    expect(hand(s, 'p1') - (h - 1)).toBe(1);
  });
  it('put onto the battlefield from your library: two cards', () => {
    let s = scenario([], { defs: [FBLTHP, TUTOR], p1: { hand: ['Test Summons'], library: ['Test Homunculus'] } });
    const h = hand(s, 'p1');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Summons', 'hand', 'p1') }));
    expect(byName(s, 'Test Homunculus', 'p1').length).toBe(1);
    expect(hand(s, 'p1') - (h - 1)).toBe(2);
  });
  it('negative: returned from the graveyard (not from the library): one card', () => {
    let s = scenario([], { defs: [FBLTHP, PUT], p1: { hand: ['Test Reanimation'], graveyard: ['Test Homunculus'] } });
    const h = hand(s, 'p1');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Reanimation', 'hand', 'p1') }), { targets: [find(s, 'Test Homunculus', 'graveyard', 'p1')] });
    expect(byName(s, 'Test Homunculus', 'p1').length).toBe(1);
    expect(hand(s, 'p1') - (h - 1)).toBe(1);
  });
});

// ---- The Destined Black Mage -----------------------------------------------------------------------------------------------------------------------------------------
const MAGE = card('Test Black Mage', 'Legendary Creature — Human Wizard', 'Whenever you cast a noncreature spell, ~ deals 1 damage to each opponent. If you have a full party, it deals 3 damage to each opponent instead.', { pt: ['2', '2'] });
const CLERIC = card('Test Cleric', 'Creature — Human Cleric', '', { pt: ['1', '1'] });
const ROGUE = card('Test Rogue', 'Creature — Human Rogue', '', { pt: ['1', '1'] });
const WARRIOR = card('Test Warrior', 'Creature — Human Warrior', '', { pt: ['1', '1'] });
const SPELL = card('Test Cantrip', 'Instant', 'Draw a card.');
describe('CR 614.15, 700.8: "Whenever you cast a noncreature spell, ~ deals 1 damage to each opponent. If you have a full party, it deals 3 damage to each opponent instead."', () => {
  it('is fully automated', () => { expect(noManual(MAGE) && MAGE.automation.level === 'full').toBe(true); });
  const run = (others: string[]): GameState => {
    let s = scenario([], { defs: [MAGE, CLERIC, ROGUE, WARRIOR, SPELL], p1: { hand: ['Test Cantrip'], battlefield: ['Test Black Mage', ...others] } });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cantrip', 'hand', 'p1') }));
    return s;
  };
  it('a full party (Cleric, Rogue, Warrior and the Wizard): 3 damage', () => { expect(life(run(['Test Cleric', 'Test Rogue', 'Test Warrior']), 'p2')).toBe(17); });
  it('negative: three of the four party members: 1 damage', () => { expect(life(run(['Test Cleric', 'Test Rogue']), 'p2')).toBe(19); });
  it('negative: the damage is dealt by the Mage, not the spell (the source is the creature)', () => {
    const s = run([]);
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(20);
  });
});

// ---- Dragonspark Reactor ---------------------------------------------------------------------------------------------------------------------------------------------
const REACTOR = card('Test Reactor', 'Artifact', 'Whenever this artifact or another artifact you control enters, put a charge counter on this artifact.\n{4}, Sacrifice this artifact: It deals damage equal to the number of charge counters on it to target player and that much damage to up to one target creature.');
const GADGET = card('Test Gadget', 'Artifact', '');
describe('CR 120.2b, 608.2h, 602.2: "{4}, Sacrifice ~: It deals damage equal to the number of charge counters on it to target player and that much damage to up to one target creature."', () => {
  it('is fully automated', () => { expect(noManual(REACTOR) && REACTOR.automation.level === 'full').toBe(true); });
  it("the counters it had when it was sacrificed are the damage to the player and to the creature (last known information)", () => {
    let s = scenario([], { defs: [REACTOR, GADGET, BEAR, card('Test Wasteland', 'Land', '{T}: Add {C}.')], p1: { battlefield: [{ name: 'Test Reactor', counters: { charge: 3 } }, ...Array.from({ length: 4 }, () => 'Test Wasteland')] }, p2: { battlefield: [{ name: 'Test Plain Bear', since: -1 }] } });
    const reactor = find(s, 'Test Reactor', 'battlefield', 'p1');
    const bear = byName(s, 'Test Plain Bear', 'p2')[0]!;
    const sacrifice = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === reactor && l.isMana !== true);
    expect(sacrifice, 'the ability can be activated').toBeDefined();
    s = act(s, sacrifice!.action);
    s = resolveAll(s, { targets: [bear], players: ['p2'] });
    expect(life(s, 'p2')).toBe(17);
    expect(s.zones.battlefield.includes(bear)).toBe(false); // 3 damage killed the 2/2
  });
});

// ---- Veronica, Dissident Scribe ---------------------------------------------------------------------------------------------------------------------------------------
const VERONICA = card('Test Scribe', 'Creature — Human Rogue', 'Whenever you discard one or more nonland cards for the first time each turn, create a Junk token.', { pt: ['2', '2'] });
const DISCARD = card('Test Rummage', 'Sorcery', 'Discard a card.');
const LAND = card('Test Meadow', 'Land', '');
describe('CR 603.2c, 701.9a: "Whenever you discard one or more nonland cards for the first time each turn, create a Junk token."', () => {
  it('is fully automated', () => { expect(noManual(VERONICA) && VERONICA.automation.level === 'full').toBe(true); });
  const junk = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && /Junk/.test(nameOf(s, id))).length;
  const run = (hands: string[], casts: number): GameState => {
    let s = scenario([], { defs: [VERONICA, DISCARD, LAND, BEAR], p1: { hand: [...hands, ...Array(casts).fill('Test Rummage') as string[]], battlefield: ['Test Scribe'] } });
    for (let i = 0; i < casts; i++) s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rummage', 'hand', 'p1') }));
    return s;
  };
  it('the first nonland discard of the turn makes a Junk token; the second does not', () => {
    expect(junk(run(['Test Plain Bear', 'Test Plain Bear'], 2))).toBe(1);
  });
  it('negative: a land discarded is not a nonland card: no token (and it is not "the first time" used up)', () => {
    expect(junk(run(['Test Meadow'], 1))).toBe(0);
  });
});
