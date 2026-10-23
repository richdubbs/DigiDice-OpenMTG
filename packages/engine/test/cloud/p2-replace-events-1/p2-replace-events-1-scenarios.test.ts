/**
 * Phase 2 lane p2-replace-events, round p2-replace-events-1: the event replacements of parser/templates/zz-cloud/p2-replace-events-1.json played through the
 * engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks,
 * with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 614.1a, 122.6          counters: "that many plus N of each of those kinds", on ~, on you, "minus N"
 *   CR 614.1a, 111.1, 614.5   tokens: "those tokens plus an additional <token> are created instead" (any tokens; artifact tokens)
 *   CR 614.1a, 119.3          "If a player would gain life, that player gains no life instead."; "you gain twice that much life instead" while a condition holds
 *   CR 614.1a, 701.17a        "If an opponent would mill one or more cards, they mill twice that many cards instead."
 *   CR 614.1a, 121.1          "If you would draw a card while <condition>, draw two cards instead."
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
const poison = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.poison;
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
const cast = (s: GameState, name: string, targets: TargetChoice[][] = [], who = 'p1'): GameState => resolveAll(drive(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), targets));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GROW = card('Test Grow', 'Instant', 'Put a +1/+1 counter on target creature.');
const BLIGHT = card('Test Blight', 'Instant', 'Put two -1/-1 counters on target creature.');

describe('p2-replace-events-1: "If one or more counters would be put on an artifact or creature you control, that many plus one of each of those kinds of counters are put on that permanent instead." (CR 614.1a, 122.6)', () => {
  const COIL = card('Test Coil', 'Creature — Snake', 'If one or more counters would be put on an artifact or creature you control, that many plus one of each of those kinds of counters are put on that permanent instead.', { pt: ['2', '3'] });
  it('is automated', () => expect(full(COIL)).toBe(true));
  it('CR 614.1a, 122.6: one +1/+1 counter on your creature is two; on an opponent\'s creature it stays one', () => {
    let s = scenario([], { defs: [COIL, GROW, BEAR], p1: { hand: ['Test Grow', 'Test Grow'], battlefield: ['Test Coil', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Grow', [[obj(mine)]]);
    s = cast(s, 'Test Grow', [[obj(theirs)]]);
    expect([counters(s, mine), counters(s, theirs)]).toEqual([2, 1]);
  });
  it('CR 122.6: counters of another kind get one more too (two -1/-1 counters are three)', () => {
    let s = scenario([], { defs: [COIL, BLIGHT, card('Test Giant', 'Creature — Giant', '', { pt: ['5', '5'] })], p1: { hand: ['Test Blight'], battlefield: ['Test Coil', 'Test Giant'] } });
    const giant = find(s, 'Test Giant', 'battlefield', 'p1');
    s = cast(s, 'Test Blight', [[obj(giant)]]);
    expect(counters(s, giant, '-1/-1')).toBe(3);
  });
});

describe('p2-replace-events-1: "If one or more +1/+1 counters would be put on ~, that many plus one +1/+1 counters are put on it instead." (CR 614.1a, 122.6)', () => {
  const PUP = card('Test Pup', 'Creature — Dog', 'If one or more +1/+1 counters would be put on this creature, that many plus one +1/+1 counters are put on it instead.', { pt: ['3', '3'] });
  it('is automated', () => expect(full(PUP)).toBe(true));
  it('CR 614.1a: one counter on it is two; one on another creature you control stays one', () => {
    let s = scenario([], { defs: [PUP, GROW, BEAR], p1: { hand: ['Test Grow', 'Test Grow'], battlefield: ['Test Pup', 'Test Bear'] } });
    const pup = find(s, 'Test Pup', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Grow', [[obj(pup)]]);
    s = cast(s, 'Test Grow', [[obj(bear)]]);
    expect([counters(s, pup), counters(s, bear)]).toEqual([2, 1]);
  });
});

describe('p2-replace-events-1: "If one or more -1/-1 counters would be put on a creature you control, that many -1/-1 counters minus one are put on it instead." (CR 614.1a, 122.6)', () => {
  const HEALER = card('Test Healer', 'Creature — Human Cleric', 'If one or more -1/-1 counters would be put on a creature you control, that many -1/-1 counters minus one are put on it instead.', { pt: ['2', '1'] });
  it('is automated', () => expect(full(HEALER)).toBe(true));
  it('CR 614.1a: two -1/-1 counters on your creature are one; on an opponent\'s creature two', () => {
    const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['5', '5'] });
    let s = scenario([], { defs: [HEALER, BLIGHT, GIANT], p1: { hand: ['Test Blight', 'Test Blight'], battlefield: ['Test Healer', 'Test Giant'] }, p2: { battlefield: ['Test Giant'] } });
    const mine = find(s, 'Test Giant', 'battlefield', 'p1');
    const theirs = find(s, 'Test Giant', 'battlefield', 'p2');
    s = cast(s, 'Test Blight', [[obj(mine)]]);
    s = cast(s, 'Test Blight', [[obj(theirs)]]);
    expect([counters(s, mine, '-1/-1'), counters(s, theirs, '-1/-1')]).toEqual([1, 2]);
  });
  it('CR 614.1a: one -1/-1 counter becomes none', () => {
    const NICK = card('Test Nick', 'Instant', 'Put a -1/-1 counter on target creature.');
    let s = scenario([], { defs: [HEALER, NICK, BEAR], p1: { hand: ['Test Nick'], battlefield: ['Test Healer', 'Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Nick', [[obj(bear)]]);
    expect(counters(s, bear, '-1/-1')).toBe(0);
  });
});

describe('p2-replace-events-1: "If you would get one or more counters, you get that many plus one of each of those kinds of counters instead." (CR 614.1a, 122.1)', () => {
  const COIL = card('Test Coil', 'Creature — Snake', 'If you would get one or more counters, you get that many plus one of each of those kinds of counters instead.', { pt: ['2', '3'] });
  const VENOM = card('Test Venom', 'Sorcery', 'Target player gets two poison counters.');
  it('is automated', () => expect(full(COIL)).toBe(true));
  it('CR 122.1: you get three poison counters instead of two; an opponent gets two', () => {
    let s = scenario([], { defs: [COIL, VENOM], p1: { hand: ['Test Venom', 'Test Venom'], battlefield: ['Test Coil'] } });
    s = cast(s, 'Test Venom', [[player('p1')]]);
    s = cast(s, 'Test Venom', [[player('p2')]]);
    expect([poison(s, 'p1'), poison(s, 'p2')]).toEqual([3, 2]);
  });
});

describe('p2-replace-events-1: "If you would put one or more counters on a creature you control or on yourself, put that many plus one of each of those kinds of counters on that permanent or player instead." (CR 614.1a, 122.6)', () => {
  const CHAMP = card('Test Champion', 'Creature — Gith Warrior', 'If you would put one or more counters on a creature you control or on yourself, put that many plus one of each of those kinds of counters on that permanent or player instead.', { pt: ['3', '3'] });
  const VENOM = card('Test Venom', 'Sorcery', 'Target player gets two poison counters.');
  it('is automated', () => expect(full(CHAMP)).toBe(true));
  it('CR 614.1a: your creature gets one more counter; you get one more; an opponent\'s creature does not', () => {
    let s = scenario([], { defs: [CHAMP, GROW, BEAR, VENOM], p1: { hand: ['Test Grow', 'Test Grow', 'Test Venom'], battlefield: ['Test Champion', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Grow', [[obj(mine)]]);
    s = cast(s, 'Test Grow', [[obj(theirs)]]);
    s = cast(s, 'Test Venom', [[player('p1')]]);
    expect([counters(s, mine), counters(s, theirs), poison(s, 'p1')]).toEqual([2, 1, 3]);
  });
});

describe('p2-replace-events-1: "those tokens plus an additional <token> are created instead" (CR 614.1a, 614.5, 111.1)', () => {
  const HOBBIT = card('Test Hobbit', 'Creature — Halfling', 'If one or more tokens would be created under your control, those tokens plus an additional Food token are created instead.', { pt: ['1', '2'] });
  const WORKS = card('Test Works', 'Artifact Creature — Construct', 'If one or more artifact tokens would be created under your control, those tokens plus an additional 1/1 colorless Servo artifact creature token are created instead.', { pt: ['2', '1'] });
  const TREASURE = card('Test Loot', 'Sorcery', 'Create a Treasure token.');
  const SPIRIT = card('Test Spirits', 'Sorcery', 'Create two 1/1 white Spirit creature tokens with flying.');
  it('is automated', () => { expect(full(HOBBIT)).toBe(true); expect(full(WORKS)).toBe(true); });
  it('CR 614.1a, 614.5: two Spirits come with one Food; an opponent\'s tokens do not', () => {
    let s = scenario([], { defs: [HOBBIT, SPIRIT], p1: { hand: ['Test Spirits'], battlefield: ['Test Hobbit'] }, p2: { hand: ['Test Spirits'] } });
    s = cast(s, 'Test Spirits');
    expect(tokensOf(s, 'p1')).toHaveLength(3);
    expect(tokensOf(s, 'p1').filter((id) => /food/i.test(s.objects[id]!.defId))).toHaveLength(1);
  });
  it('CR 614.1a: an artifact token brings a Servo; creature tokens that are not artifacts bring nothing', () => {
    let s = scenario([], { defs: [WORKS, TREASURE, SPIRIT], p1: { hand: ['Test Loot', 'Test Spirits'], battlefield: ['Test Works'] } });
    s = cast(s, 'Test Loot');
    expect(tokensOf(s, 'p1')).toHaveLength(2);
    s = cast(s, 'Test Spirits');
    expect(tokensOf(s, 'p1')).toHaveLength(4);
  });
});

describe('p2-replace-events-1: life gain replaced (CR 614.1a, 119.3)', () => {
  const VORTEX = card('Test Vortex', 'Enchantment', 'If a player would gain life, that player gains no life instead.');
  const SALVE = card('Test Salve', 'Instant', 'Target player gains 4 life.');
  const PHIAL = card('Test Phial', 'Artifact', 'If you would gain life while you have 5 or less life, you gain twice that much life instead.');
  it('is automated', () => { expect(full(VORTEX)).toBe(true); expect(full(PHIAL)).toBe(true); });
  it('CR 614.1a: no player gains life', () => {
    let s = scenario([], { defs: [VORTEX, SALVE], p1: { hand: ['Test Salve', 'Test Salve'], battlefield: ['Test Vortex'] } });
    s = cast(s, 'Test Salve', [[player('p1')]]);
    s = cast(s, 'Test Salve', [[player('p2')]]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 20]);
  });
  it('CR 614.1a: at 5 life you gain 8; at 6 life you gain 4', () => {
    let s = scenario([], { life: 5, defs: [PHIAL, SALVE], p1: { hand: ['Test Salve'], battlefield: ['Test Phial'] } });
    s = cast(s, 'Test Salve', [[player('p1')]]);
    expect(life(s, 'p1')).toBe(13);
    let t = scenario([], { life: 6, defs: [PHIAL, SALVE], p1: { hand: ['Test Salve'], battlefield: ['Test Phial'] } });
    t = cast(t, 'Test Salve', [[player('p1')]]);
    expect(life(t, 'p1')).toBe(10);
  });
});

describe('p2-replace-events-1: "If an opponent would mill one or more cards, they mill twice that many cards instead." (CR 614.1a, 701.17a)', () => {
  const SAGE = card('Test Sage', 'Creature — Human Advisor', 'If an opponent would mill one or more cards, they mill twice that many cards instead.', { pt: ['1', '4'] });
  const GLIMPSE = card('Test Glimpse', 'Sorcery', 'Target player mills two cards.');
  it('is automated', () => expect(full(SAGE)).toBe(true));
  it('CR 701.17a: an opponent mills four; you mill two', () => {
    let s = scenario([], { defs: [SAGE, GLIMPSE], p1: { hand: ['Test Glimpse', 'Test Glimpse'], battlefield: ['Test Sage'], library: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { library: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    s = cast(s, 'Test Glimpse', [[player('p2')]]);
    s = cast(s, 'Test Glimpse', [[player('p1')]]);
    expect([s.zones.graveyard.p2!.length, s.zones.graveyard.p1!.filter((id) => s.objects[id]!.defId === 'Plains').length]).toEqual([4, 2]);
  });
});

describe('p2-replace-events-1: "If you would draw a card while you have no cards in hand, draw two cards instead." (CR 614.1a, 121.1)', () => {
  const PHIAL = card('Test Phial', 'Artifact', 'If you would draw a card while you have no cards in hand, draw two cards instead.');
  const PEEK = card('Test Peek', 'Instant', 'Draw a card.');
  it('is automated', () => expect(full(PHIAL)).toBe(true));
  it('CR 614.1a: with an empty hand one draw is two; with a card in hand it is one', () => {
    let s = scenario([], { defs: [PHIAL, PEEK], p1: { hand: ['Test Peek'], battlefield: ['Test Phial'], library: ['Plains', 'Plains', 'Plains', 'Plains'] } });
    s = cast(s, 'Test Peek');
    expect(s.zones.hand.p1).toHaveLength(2);
    let t = scenario([], { defs: [PHIAL, PEEK], p1: { hand: ['Test Peek', 'Plains'], battlefield: ['Test Phial'], library: ['Plains', 'Plains', 'Plains', 'Plains'] } });
    t = cast(t, 'Test Peek');
    expect(t.zones.hand.p1).toHaveLength(2);
  });
});

describe('p2-replace-events-1: "If ~ would enter, sacrifice a Swamp instead. If you do, put ~ onto the battlefield. If you don\'t, put it into its owner\'s graveyard." (CR 614.1a, 614.6, 305.1)', () => {
  const LAKE = card('Test Lake', 'Land', 'If this land would enter, sacrifice a Swamp instead. If you do, put this land onto the battlefield. If you don\'t, put it into its owner\'s graveyard.\n{T}: Add {B}.');
  const playLand = (s: GameState): GameState => drive(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Lake', 'hand', 'p1') }));
  const lands = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn;
  it('is automated', () => expect(full(LAKE)).toBe(true));
  it('CR 614.1a: with a Swamp, the Swamp is sacrificed and the land enters; the land drop is used', () => {
    let s = scenario(['Swamp'], { defs: [LAKE], p1: { hand: ['Test Lake'], battlefield: ['Swamp', 'Plains'] } });
    s = playLand(s);
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId).sort()).toEqual(['Plains', 'Test Lake']);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Swamp']);
    expect(lands(s)).toBe(1);
  });
  it('CR 614.6, 305.1: with no Swamp, the land goes to its owner\'s graveyard and the land drop is still used', () => {
    let s = scenario(['Swamp'], { defs: [LAKE], p1: { hand: ['Test Lake'], battlefield: ['Plains'] } });
    s = playLand(s);
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId)).toEqual(['Plains']);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Lake']);
    expect(lands(s)).toBe(1);
  });
});

describe('p2-replace-events-1: "If ~ would enter, you may discard a land card instead. If you do, put ~ onto the battlefield. If you don\'t, put it into its owner\'s graveyard." (CR 614.1a, 614.6, 118.12)', () => {
  const GEM = card('Test Gem', 'Artifact', 'If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don\'t, put it into its owner\'s graveyard.\n{T}: Add one mana of any color.');
  const castGem = (s: GameState, yes: boolean): GameState => drive(pass(pass(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gem', 'hand', 'p1') })))), [], [yes]);
  it('is automated', () => expect(full(GEM)).toBe(true));
  it('CR 118.12: discarding a land card, the artifact enters', () => {
    let s = scenario(['Forest'], { defs: [GEM], p1: { hand: ['Test Gem', 'Forest'] } });
    s = castGem(s, true);
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId)).toEqual(['Test Gem']);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Forest']);
  });
  it('CR 614.6: declining, the artifact goes to its owner\'s graveyard and the land card stays in hand', () => {
    let s = scenario(['Forest'], { defs: [GEM], p1: { hand: ['Test Gem', 'Forest'] } });
    s = castGem(s, false);
    expect(s.zones.battlefield).toEqual([]);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Gem']);
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Forest']);
  });
  it('CR 118.3: with no land card in hand it can\'t be paid, and the artifact goes to the graveyard', () => {
    let s = scenario(['Forest'], { defs: [GEM], p1: { hand: ['Test Gem'] } });
    s = castGem(s, true);
    expect(s.zones.battlefield).toEqual([]);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Gem']);
  });
});
