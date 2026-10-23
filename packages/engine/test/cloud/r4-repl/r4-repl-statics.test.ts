/**
 * Cloud r4-repl (Standard round 4: replacement and prevention effects): the static and resolved replacement and prevention effects this slice reads, played
 * through the engine with synthetic cards compiled by the game's default compiler (invented names, numbers and wordings, design 6.10). Each test is named after
 * the rule it checks.
 *
 *   CR 614.1a, 120.3          damage doubled ("double that damage", "twice that much damage") and raised by a computed amount
 *   CR 615.1a, 615.5          "If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards."
 *   CR 614.1a, 122.6          "If you would put one or more counters on a permanent you control, put that many plus one of each of those kinds ... instead."
 *   CR 614.1a, 611.2a         "{2}: Until end of turn, if you would put one or more +1/+1 counters on a creature you control, put that many plus one ..."
 *   CR 614.1a, 121.2          the `drawMany` proposal: "As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many plus one"
 *   CR 614.10, 121.3          "If you would draw a card while your library has no cards in it, skip that draw instead."
 *   CR 614.1a, 614.5          "those tokens plus a Food token are created instead"; "that many 4/4 Dragon tokens are created instead"
 *   CR 701.44a, 614.5         the `explore` proposal: "If a creature you control would explore, instead you scry 1, then that creature explores."
 *   CR 615.1a, 611.2a         "Prevent all damage that would be dealt to you and creatures you control this turn by creatures."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters?.[kind] ?? 0;

function drive(s0: GameState, targets: TargetChoice[][] = [], yes: boolean[] = []): GameState {
  let s = s0;
  const t = [...targets];
  const y = [...yes];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: t.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: y.shift() ?? false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: p.options[0]!.id });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[][] = [], player = 'p1'): GameState => resolveAll(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), targets));
const activate = (s: GameState, source: ObjectId, targets: TargetChoice[][] = [], ability = 'p:0:0'): GameState => resolveAll(drive(act(s, { type: 'activate', player: 'p1', source, ability }), targets));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '7'] });
const SHOCK = card('Test Shock', 'Instant', '~ deals 2 damage to any target.');

describe('Cloud r4-repl: "If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals double that damage instead." (CR 614.1a, 120.3)', () => {
  const TYRANT = card('Test Tyrant', 'Creature — Dragon', 'If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals double that damage instead.', { pt: ['4', '4'] });
  it('is automated', () => expect(full(TYRANT)).toBe(true));
  it('CR 614.1a: 2 damage to an opponent is 4; to their creature 4', () => {
    let s = scenario([], { defs: [TYRANT, SHOCK, OGRE], p1: { hand: ['Test Shock', 'Test Shock'], battlefield: ['Test Tyrant'] }, p2: { battlefield: ['Test Ogre'] } });
    s = cast(s, 'Test Shock', [[player('p2')]]);
    expect(life(s, 'p2')).toBe(16);
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Shock', [[obj(ogre)]]);
    expect(s.objects[ogre]!.damage).toBe(4);
  });
  it('CR 614.1a: damage to yourself is not doubled', () => {
    let s = scenario([], { defs: [TYRANT, SHOCK], p1: { hand: ['Test Shock'], battlefield: ['Test Tyrant'] } });
    s = cast(s, 'Test Shock', [[player('p1')]]);
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('Cloud r4-repl: "If a creature you control that entered this turn would deal damage, it deals twice that much damage instead." (CR 614.1a, 400.7)', () => {
  const STORM = card('Test Storm', 'Creature — Dragon', 'If a creature you control that entered this turn would deal damage, it deals twice that much damage instead.', { pt: ['4', '4'] });
  const PINGER = card('Test Pinger', 'Creature — Wizard', '{1}: ~ deals 1 damage to any target.', { pt: ['1', '1'] });
  it('is automated', () => expect(full(STORM)).toBe(true));
  it('CR 614.1a: a creature that was on the battlefield before this turn deals its damage as it is', () => {
    let s = scenario([], { defs: [STORM, PINGER], p1: { battlefield: ['Test Storm', 'Test Pinger', 'Plains'] } });
    s = activate(s, find(s, 'Test Pinger', 'battlefield'), [[player('p2')]]);
    expect(life(s, 'p2')).toBe(19);
  });
  it('CR 614.1a, 400.7: a creature that entered this turn deals twice that much damage', () => {
    let s = scenario([], { defs: [STORM, PINGER], p1: { hand: ['Test Pinger'], battlefield: ['Test Storm', 'Plains'] } });
    s = cast(s, 'Test Pinger');
    s = activate(s, find(s, 'Test Pinger', 'battlefield'), [[player('p2')]]);
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('Cloud r4-repl: "... it deals that much damage plus an amount of damage equal to the number of charge counters on ~ instead." (CR 614.1a, 107.3)', () => {
  const FIRE = card('Test Firepower', 'Enchantment', 'If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus an amount of damage equal to the number of charge counters on this enchantment instead.');
  it('is automated', () => expect(full(FIRE)).toBe(true));
  it('CR 614.1a, 107.3: with two charge counters, 2 damage is 4', () => {
    let s = scenario([], { defs: [FIRE, SHOCK], p1: { hand: ['Test Shock'], battlefield: [{ name: 'Test Firepower', counters: { charge: 2 } }] } });
    s = cast(s, 'Test Shock', [[player('p2')]]);
    expect(life(s, 'p2')).toBe(16);
  });
});

describe('Cloud r4-repl: "If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards." (CR 615.1a, 615.5)', () => {
  const SKINNER = card('Test Skinner', 'Enchantment Creature — Nightmare', 'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards.', { pt: ['10', '1'] });
  it('is automated', () => expect(full(SKINNER)).toBe(true));
  it('CR 615.5: the damage is prevented and the opponent mills two cards', () => {
    let s = scenario([], { defs: [SKINNER, SHOCK], p1: { hand: ['Test Shock'], battlefield: ['Test Skinner'] } });
    s = cast(s, 'Test Shock', [[player('p2')]]);
    expect(life(s, 'p2')).toBe(20);
    expect(s.zones.graveyard.p2).toHaveLength(2);
  });
});

describe('Cloud r4-repl: "If you would put one or more counters on a permanent you control, put that many plus one of each of those kinds of counters on that permanent instead." (CR 614.1a, 122.6)', () => {
  const DOC = card('Test Doc', 'Creature — Human Doctor', 'If you would put one or more counters on a permanent you control, put that many plus one of each of those kinds of counters on that permanent instead.', { pt: ['2', '2'] });
  const GROW = card('Test Grow', 'Instant', 'Put a +1/+1 counter on target creature.');
  it('is automated', () => expect(full(DOC)).toBe(true));
  it('CR 614.1a, 122.6: one +1/+1 counter becomes two on your creature, one on an opponent\'s', () => {
    let s = scenario([], { defs: [DOC, GROW, BEAR], p1: { hand: ['Test Grow', 'Test Grow'], battlefield: ['Test Doc', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Grow', [[obj(mine)]]);
    s = cast(s, 'Test Grow', [[obj(theirs)]]);
    expect([counters(s, mine), counters(s, theirs)]).toEqual([2, 1]);
  });
});

describe('Cloud r4-repl: "{2}: Until end of turn, if you would put one or more +1/+1 counters on a creature you control, put that many plus one +1/+1 counters on it instead." (CR 614.1a, 611.2a)', () => {
  const DOG = card('Test Dog', 'Creature — Dog', '{0}: Until end of turn, if you would put one or more +1/+1 counters on a creature you control, put that many plus one +1/+1 counters on it instead.', { pt: ['1', '1'] });
  const GROW = card('Test Grow', 'Instant', 'Put a +1/+1 counter on target creature.');
  it('is automated', () => expect(full(DOG)).toBe(true));
  it('CR 611.2a: after the activation one counter is two; before it one', () => {
    let s = scenario([], { defs: [DOG, GROW, BEAR], p1: { hand: ['Test Grow', 'Test Grow'], battlefield: ['Test Dog', 'Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Grow', [[obj(bear)]]);
    expect(counters(s, bear)).toBe(1);
    s = activate(s, find(s, 'Test Dog', 'battlefield'));
    s = cast(s, 'Test Grow', [[obj(bear)]]);
    expect(counters(s, bear)).toBe(3);
  });
});

describe('Cloud r4-repl: "As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead." (CR 614.1a, 121.2)', () => {
  const RIDDLER = card('Test Riddler', 'Creature — Sphinx', 'As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead.', { pt: ['4', '4'] });
  const DIVE = card('Test Dive', 'Instant', 'Draw two cards.');
  const REFLECT = card('Test Reflection', 'Enchantment', 'If you would draw a card, draw two cards instead.');
  it('is automated', () => expect(full(RIDDLER)).toBe(true));
  it('CR 121.2, 614.1a: with no other card in hand, "draw two cards" draws three', () => {
    let s = scenario([], { defs: [RIDDLER, DIVE], p1: { hand: ['Test Dive'], battlefield: ['Test Riddler'] } });
    s = cast(s, 'Test Dive');
    expect(s.zones.hand.p1).toHaveLength(3);
  });
  it('CR 604.1: with two other cards in hand, the condition is false: two', () => {
    let s = scenario([], { defs: [RIDDLER, DIVE, BEAR], p1: { hand: ['Test Dive', 'Test Bear', 'Test Bear'], battlefield: ['Test Riddler'] } });
    s = cast(s, 'Test Dive');
    expect(s.zones.hand.p1).toHaveLength(4);
  });
  it('CR 121.2: each card of the draw is still drawn on its own (a card-by-card replacement sees every one): two cards with "draw two instead" each are four', () => {
    let s = scenario([], { defs: [DIVE, REFLECT, BEAR], p1: { hand: ['Test Dive', 'Test Bear', 'Test Bear'], battlefield: ['Test Reflection'] } });
    s = cast(s, 'Test Dive');
    expect(s.zones.hand.p1).toHaveLength(6);
  });
});

describe('Cloud r4-repl: "If you would draw a card while your library has no cards in it, skip that draw instead." (CR 614.10, 121.3, 704.5b)', () => {
  const CONUNDRUM = card('Test Conundrum', 'Creature — Elemental', 'If you would draw a card while your library has no cards in it, skip that draw instead.', { pt: ['2', '2'] });
  const DIVE = card('Test Dive', 'Instant', 'Draw two cards.');
  it('is automated', () => expect(full(CONUNDRUM)).toBe(true));
  it('CR 614.10: with an empty library the draws are skipped, so no draw from an empty library is attempted and the player does not lose (CR 704.5b)', () => {
    let s = scenario([], { defs: [CONUNDRUM, DIVE], p1: { hand: ['Test Dive'], battlefield: ['Test Conundrum'] } });
    for (const id of s.zones.library.p1!) delete s.objects[id];
    s.zones.library.p1 = [];
    s = cast(s, 'Test Dive');
    s = pass(s); // a player receives priority: state-based actions are checked (CR 704.3)
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(false);
  });
});

describe('Cloud r4-repl: "If one or more tokens would be created under your control, those tokens plus a Food token are created instead." (CR 614.1a, 614.5)', () => {
  const PLUS = card('Test Larder', 'Enchantment', 'If one or more tokens would be created under your control, those tokens plus a Food token are created instead.');
  const MAKER = card('Test Maker', 'Instant', 'Create two 1/1 white Spirit creature tokens.');
  it('is automated', () => expect(full(PLUS)).toBe(true));
  it('CR 614.1a, 614.5: two Spirits and one Food (the Food does not make another one)', () => {
    let s = scenario([], { defs: [PLUS, MAKER], p1: { hand: ['Test Maker'], battlefield: ['Test Larder'] } });
    s = cast(s, 'Test Maker');
    expect(tokensOf(s, 'p1')).toHaveLength(3);
  });
});

describe('Cloud r4-repl: "If one or more artifact tokens would be created under your control, that many 4/4 red Dragon creature tokens with flying are created instead." (CR 614.1a, 614.6)', () => {
  const VISITOR = card('Test Visitor', 'Creature — Dragon', 'If one or more artifact tokens would be created under your control, that many 4/4 red Dragon creature tokens with flying are created instead.', { pt: ['5', '5'] });
  const TREASURE = card('Test Hoard', 'Instant', 'Create two Treasure tokens.');
  const SPIRITS = card('Test Spirits', 'Instant', 'Create a 1/1 white Spirit creature token.');
  it('is automated', () => expect(full(VISITOR)).toBe(true));
  it('CR 614.6: two Treasures become two Dragons, and no Treasure is created', () => {
    let s = scenario([], { defs: [VISITOR, TREASURE], p1: { hand: ['Test Hoard'], battlefield: ['Test Visitor'] } });
    s = cast(s, 'Test Hoard');
    const tokens = tokensOf(s, 'p1');
    expect(tokens).toHaveLength(2);
    expect(tokens.every((id) => s.defs[s.objects[id]!.defId]!.faces[0]!.subtypes?.includes('Dragon'))).toBe(true);
  });
  it('CR 614.1a: a creature token that is not an artifact is created as it is', () => {
    let s = scenario([], { defs: [VISITOR, SPIRITS], p1: { hand: ['Test Spirits'], battlefield: ['Test Visitor'] } });
    s = cast(s, 'Test Spirits');
    expect(tokensOf(s, 'p1').map((id) => s.defs[s.objects[id]!.defId]!.faces[0]!.subtypes)).toEqual([['Spirit']]);
  });
});

describe('Cloud r4-repl: "If a creature you control would explore, instead you scry 1, then that creature explores." (CR 701.44a, 614.5)', () => {
  const TWISTS = card('Test Twists', 'Enchantment', 'If a creature you control would explore, instead you scry 1, then that creature explores.');
  const SCOUT = card('Test Scout', 'Creature — Merfolk', '{T}: ~ explores.', { pt: ['1', '1'] });
  it('is automated', () => expect(full(TWISTS)).toBe(true));
  it('CR 701.44a, 614.5: the creature explores once, after the scry (a land on top goes to the hand)', () => {
    let s = scenario([], { defs: [TWISTS, SCOUT], p1: { battlefield: ['Test Twists', 'Test Scout'] } });
    s = activate(s, find(s, 'Test Scout', 'battlefield'));
    expect(s.zones.hand.p1).toHaveLength(1); // the top card (a Plains) is revealed and put into the hand: one explore, not two
    expect(counters(s, find(s, 'Test Scout', 'battlefield'))).toBe(0);
  });
});

describe('Cloud r4-repl: "Prevent all damage that would be dealt to you and creatures you control this turn by creatures." (CR 615.1a, 611.2a)', () => {
  const EERIE = card('Test Eerie', 'Instant', 'Prevent all damage that would be dealt to you and creatures you control this turn by creatures.');
  const BITER = card('Test Biter', 'Creature — Wizard', '{T}: ~ deals 1 damage to any target.', { pt: ['1', '1'] });
  it('is automated', () => expect(full(EERIE)).toBe(true));
  it('CR 615.1a: a creature\'s damage to you and to your creature is prevented; a spell\'s is not', () => {
    let s = scenario([], { defs: [EERIE, BITER, BEAR, SHOCK], p1: { hand: ['Test Eerie', 'Test Shock'], battlefield: ['Test Bear', 'Test Biter'] } });
    s = cast(s, 'Test Eerie');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = activate(s, find(s, 'Test Biter', 'battlefield', 'p1'), [[player('p1')]]);
    expect(life(s, 'p1')).toBe(20);
    s = cast(s, 'Test Shock', [[obj(bear)]]);
    expect(s.objects[bear]?.zone === 'battlefield').toBe(false);
  });
});
