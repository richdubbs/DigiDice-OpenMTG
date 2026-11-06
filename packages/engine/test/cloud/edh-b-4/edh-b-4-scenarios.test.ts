/**
 * Commander second pass, round edh-b-4 (EDHREC ranks 9,001 to 10,000): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 701.10a-c, 608.2h   "Double its power and toughness until end of turn." / "Double the toughness of each creature you control until end of turn." (each creature's own value as the effect begins)
 *   CR 101.2, 601.3, 107.3 "Noncreature spells with mana value 4 or greater can't be cast." / "... with {X} in their mana costs can't be cast." (every player)
 *   CR 508.1, 509.1, 402.1 "~ can't attack or block unless a player has no cards in hand."
 *   CR 701.36a, 608.2c     "Populate X times."
 *   CR 509.1b, 115.1d      "~ and up to one other target creature can't be blocked this turn."
 *   CR 122.1               "Put a +1/+1 counter on each creature you control that has a +1/+1 counter on it."
 *   CR 400.3, 110.2a       "Each player returns all black and all red creature cards from their graveyard to the battlefield."
 *   CR 107.3, 120.3, 400.7 "~ deals X plus 2 damage to each creature that didn't enter this turn."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { ruleDenial } from '../../../src/statics/hooks';
import { attackCandidates } from '../../../src/rules/combat-rules';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], o: { cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const ofName = (s: GameState, name: string, player?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && (player === undefined || s.objects[id]!.controller === player));

interface Picks { targets?: TargetChoice[]; x?: number; yes?: boolean; objects?: ObjectId[] }
/** Answer every decision until a player has priority (X as asked, objects: the minimum unless given). */
function settle(s0: GameState, p: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const d = s.pending as { kind: string; options?: unknown[]; min?: number };
    if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.objects ?? (d.options as ObjectId[]).slice(0, d.min ?? 0) });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: p.targets ?? [] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: p.yes ?? true });
    else if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.x ?? (d.min ?? 0) });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(d.options as { id: string }[])[0]!.id] });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, p: Picks = {}): GameState {
  let s = settle(s0, p);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(pass(s), p);
  return s;
}
const cast = (s: GameState, name: string, p: Picks = {}, player = 'p1'): GameState => resolveAll(settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), p), p);
const castable = (s: GameState, name: string, player = 'p1'): boolean => applyAction(s, { type: 'cast', player, card: find(s, name, 'hand', player) }).error === undefined;
const attackers = (s: GameState): string[] => attackCandidates(s, 'p1').map((c) => s.defs[s.objects[c.id]!.defId]!.name);
const obj = (id: string): TargetChoice => ({ kind: 'object', id });

const BEARS = card('Test Bears', 'Creature — Bear', '', ['2', '3']);
const CUB = card('Test Cub', 'Creature — Bear', '', ['1', '1']);
const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '5']);

describe('CR 701.10a-c, 608.2h: "Double its power and toughness until end of turn." (the creature that entered; its own values as the effect begins)', () => {
  const DOUBLER = card('Test Doubler', 'Creature — Wizard', 'Whenever another creature you control enters, double its power and toughness until end of turn.', ['1', '1']);
  it('is automated', () => expect(full(DOUBLER)).toBe(true));
  it('the entering creature gets +X/+Y of its own values; the Doubler and an opponent\'s creature do not change', () => {
    let s = scenario([], { p1: { battlefield: ['Test Doubler'], hand: ['Test Bears'] }, p2: { battlefield: ['Test Brute'] }, defs: [DOUBLER, BEARS, BRUTE] });
    s = cast(s, 'Test Bears');
    expect(pt(s, ofName(s, 'Test Bears')[0]!)).toBe('4/6');
    expect(pt(s, ofName(s, 'Test Doubler')[0]!)).toBe('1/1');
    expect(pt(s, ofName(s, 'Test Brute')[0]!)).toBe('3/5');
  });
});

describe('CR 701.10a, 608.2h: "Double the toughness of each creature you control until end of turn." (+0/+X per creature, X its own toughness)', () => {
  const GROW = card('Test Hardening', 'Sorcery', 'Double the toughness of each creature you control until end of turn.');
  it('is automated', () => expect(full(GROW)).toBe(true));
  it('each creature you control doubles its own toughness, power unchanged; an opponent\'s creature does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Bears', 'Test Cub'], hand: ['Test Hardening'] }, p2: { battlefield: ['Test Brute'] }, defs: [GROW, BEARS, CUB, BRUTE] });
    s = cast(s, 'Test Hardening');
    expect(pt(s, ofName(s, 'Test Bears')[0]!)).toBe('2/6');
    expect(pt(s, ofName(s, 'Test Cub')[0]!)).toBe('1/2');
    expect(pt(s, ofName(s, 'Test Brute')[0]!)).toBe('3/5');
  });
});

describe("CR 101.2, 601.3, 107.3: noncreature spells with mana value 4 or greater, or with {X} in their mana costs, can't be cast", () => {
  const TEEG = card('Test Teeg', 'Legendary Creature — Kithkin', "Noncreature spells with mana value 4 or greater can't be cast.\nNoncreature spells with {X} in their mana costs can't be cast.", ['2', '2']);
  const BIG = card('Test Big Sorcery', 'Sorcery', 'You gain 1 life.', undefined, { cost: '{4}' });
  const SMALL = card('Test Small Sorcery', 'Sorcery', 'You gain 1 life.', undefined, { cost: '{3}' });
  const XSPELL = card('Test X Sorcery', 'Sorcery', 'You gain X life.', undefined, { cost: '{X}' });
  const BIGCREATURE = card('Test Big Brute', 'Creature — Ogre', '', ['6', '6'], { cost: '{6}' });
  const XCREATURE = card('Test X Hydra', 'Creature — Hydra', '', ['0', '0'], { cost: '{X}' });
  const defs = [TEEG, BIG, SMALL, XSPELL, BIGCREATURE, XCREATURE];
  const lands = ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'];
  const hand = ['Test Big Sorcery', 'Test Small Sorcery', 'Test X Sorcery', 'Test Big Brute', 'Test X Hydra'];
  it('is automated', () => expect(full(TEEG)).toBe(true));
  it('with it out (an opponent\'s too): mana value 4 or more noncreature and {X} noncreature spells can\'t be cast, for every player; creature spells and a cheaper spell can', () => {
    for (const owner of ['p1', 'p2'] as const) {
      const s = scenario([], { p1: { hand, battlefield: owner === 'p1' ? ['Test Teeg', ...lands] : lands }, p2: { battlefield: owner === 'p2' ? ['Test Teeg'] : [] }, defs });
      expect(castable(s, 'Test Big Sorcery'), owner).toBe(false);
      expect(castable(s, 'Test X Sorcery'), owner).toBe(false);
      expect(castable(s, 'Test Small Sorcery'), owner).toBe(true);
      expect(castable(s, 'Test Big Brute'), owner).toBe(true); // a creature spell of mana value 6
      expect(castable(s, 'Test X Hydra'), owner).toBe(true); // a creature spell with {X}
    }
  });
  it('negative: without it every one of them can be cast', () => {
    const s = scenario([], { p1: { hand, battlefield: lands }, defs });
    for (const n of hand) expect(castable(s, n), n).toBe(true);
  });
});

describe('CR 508.1, 509.1, 402.1: "~ can\'t attack or block unless a player has no cards in hand."', () => {
  const LUPINE = card('Test Lupine', 'Creature — Wolf', "Test Lupine can't attack or block unless a player has no cards in hand.", ['3', '3']);
  it('is automated', () => expect(full(LUPINE)).toBe(true));
  it('cannot attack while every player holds a card; can once any one player (an opponent too) has an empty hand', () => {
    const s = scenario([], { p1: { battlefield: ['Test Lupine'], hand: ['Test Bears'] }, p2: { hand: ['Test Cub'] }, defs: [LUPINE, BEARS, CUB] });
    expect(attackers(s)).toEqual([]);
    const noOpp = scenario([], { p1: { battlefield: ['Test Lupine'], hand: ['Test Bears'] }, p2: { hand: [] }, defs: [LUPINE, BEARS, CUB] });
    expect(attackers(noOpp)).toEqual(['Test Lupine']);
    const noMine = scenario([], { p1: { battlefield: ['Test Lupine'], hand: [] }, p2: { hand: ['Test Cub'] }, defs: [LUPINE, BEARS, CUB] });
    expect(attackers(noMine)).toEqual(['Test Lupine']);
  });
  it('cannot block while every player holds a card; can with an empty hand somewhere', () => {
    const blk = (p1hand: string[], p2hand: string[]): boolean => {
      const s = scenario([], { p1: { hand: p1hand, battlefield: ['Test Bears'] }, p2: { battlefield: ['Test Lupine'], hand: p2hand }, defs: [LUPINE, BEARS, CUB] });
      return ruleDenial(s, { action: 'block', subject: find(s, 'Test Lupine', 'battlefield'), other: find(s, 'Test Bears', 'battlefield') }) === null;
    };
    expect(blk(['Test Cub'], ['Test Cub'])).toBe(false);
    expect(blk([], ['Test Cub'])).toBe(true);
  });
});

describe('CR 701.36a, 608.2c: "Populate X times." (each time choose a creature token you control then)', () => {
  const MAKER = card('Test Soldier Maker', 'Creature — Soldier', 'When ~ enters, create a 1/1 white Soldier creature token.', ['1', '1']);
  const FLOWER = card('Test Flowering', 'Sorcery', 'Populate X times.', undefined, { cost: '{X}' });
  const base = (): GameState => cast(scenario([], { p1: { hand: ['Test Soldier Maker', 'Test Flowering'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: {}, defs: [MAKER, FLOWER] }), 'Test Soldier Maker');
  const tokenCount = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p).length;
  it('is automated', () => expect(full(FLOWER)).toBe(true));
  it('X = 3 with one token makes three more (a token copied the second time may be one made the first time)', () => {
    const s0 = base();
    expect(tokenCount(s0, 'p1')).toBe(1);
    expect(tokenCount(cast(s0, 'Test Flowering', { x: 3 }), 'p1')).toBe(4);
  });
  it('each time a token is chosen again: with two kinds of token, choosing the new copy the second time grows that kind (the old one-token-X-copies reading cannot)', () => {
    const TWO = card('Test Twin Maker', 'Creature — Soldier', 'When ~ enters, create a 1/1 white Soldier creature token and a 2/2 black Zombie creature token.', ['1', '1']);
    const s0 = cast(scenario([], { p1: { hand: ['Test Twin Maker', 'Test Flowering'], battlefield: ['Plains', 'Plains'] }, p2: {}, defs: [TWO, FLOWER] }), 'Test Twin Maker');
    const kinds = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => pt(s, id)).sort();
    expect(kinds(s0)).toEqual(['1/1', '2/2']);
    // answer each populate choice with the LAST offered token: the first time the 2/2 (or 1/1), the second time a different one
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Flowering', 'hand', 'p1') });
    const offered: number[] = [];
    for (let g = 0; g < 40 && (s.pending !== null && (s.pending.kind !== 'priority' || s.zones.stack.length > 0)); g++) {
      if (s.pending.kind === 'priority') { s = pass(s); continue; }
      const d = s.pending as { kind: string; options?: ObjectId[]; min?: number };
      if (d.kind === 'chooseObjects') { offered.push(d.options!.length); s = answer(s, { kind: 'chooseObjects', ids: [d.options![d.options!.length - 1]!] }); } else s = settle(s, { x: 2 });
    }
    s = resolveAll(s, { x: 2 });
    expect(offered).toEqual([2, 3]); // the copy made the first time is offered the second time
    expect(kinds(s)).toHaveLength(4);
  });
  it('negative: X = 0 populates not at all, and with no creature token nothing happens', () => {
    expect(tokenCount(cast(base(), 'Test Flowering', { x: 0 }), 'p1')).toBe(1);
    const none = scenario([], { p1: { hand: ['Test Flowering'], battlefield: ['Plains', 'Plains'] }, p2: {}, defs: [FLOWER] });
    expect(tokenCount(cast(none, 'Test Flowering', { x: 2 }), 'p1')).toBe(0);
  });
});

describe('CR 509.1b, 115.1d: "~ and up to one other target creature can\'t be blocked this turn."', () => {
  const MARTHA = card('Test Martha', 'Legendary Creature — Human', "When ~ enters, ~ and up to one other target creature can't be blocked this turn.", ['2', '2']);
  const blocked = (s: GameState, a: ObjectId): boolean => ruleDenial(s, { action: 'beBlocked', subject: a, other: find(s, 'Test Brute', 'battlefield') }) !== null;
  it('is automated', () => expect(full(MARTHA)).toBe(true));
  it('~ and the one chosen creature can\'t be blocked; another creature you control can', () => {
    let s = scenario([], { p1: { hand: ['Test Martha'], battlefield: ['Test Bears', 'Test Cub'] }, p2: { battlefield: ['Test Brute'] }, defs: [MARTHA, BEARS, CUB, BRUTE] });
    const bears = find(s, 'Test Bears', 'battlefield');
    s = cast(s, 'Test Martha', { targets: [obj(bears)] });
    expect(blocked(s, ofName(s, 'Test Martha')[0]!)).toBe(true);
    expect(blocked(s, bears)).toBe(true);
    expect(blocked(s, find(s, 'Test Cub', 'battlefield'))).toBe(false);
  });
  it('"up to one": with no other target only ~ can\'t be blocked', () => {
    let s = scenario([], { p1: { hand: ['Test Martha'], battlefield: ['Test Bears'] }, p2: { battlefield: ['Test Brute'] }, defs: [MARTHA, BEARS, BRUTE] });
    s = cast(s, 'Test Martha', { targets: [] });
    expect(blocked(s, ofName(s, 'Test Martha')[0]!)).toBe(true);
    expect(blocked(s, find(s, 'Test Bears', 'battlefield'))).toBe(false);
  });
});

describe('CR 122.1: "Put a +1/+1 counter on each creature you control that has a +1/+1 counter on it."', () => {
  const FEED = card('Test Feeding', 'Sorcery', 'Put a +1/+1 counter on each creature you control that has a +1/+1 counter on it.');
  it('is automated', () => expect(full(FEED)).toBe(true));
  it('only your creatures that already have one get another; one without, a creature with another kind of counter and an opponent\'s do not', () => {
    let s = scenario([], { p1: { hand: ['Test Feeding'], battlefield: [{ name: 'Test Bears', counters: { '+1/+1': 1 } }, { name: 'Test Cub' }, { name: 'Test Brute', counters: { '-1/-1': 1 } }] }, p2: { battlefield: [{ name: 'Test Bears', counters: { '+1/+1': 2 } }] }, defs: [FEED, BEARS, CUB, BRUTE] });
    s = cast(s, 'Test Feeding');
    const c = (name: string, p: string, kind: string): number => s.objects[ofName(s, name, p)[0]!]!.counters[kind] ?? 0;
    expect(c('Test Bears', 'p1', '+1/+1')).toBe(2);
    expect(c('Test Cub', 'p1', '+1/+1')).toBe(0);
    expect(c('Test Brute', 'p1', '+1/+1')).toBe(0);
    expect(c('Test Bears', 'p2', '+1/+1')).toBe(2);
  });
});

describe('CR 400.3, 110.2a: "Each player returns all black and all red creature cards from their graveyard to the battlefield."', () => {
  const DEFILED = card('Test Defiled', 'Creature — Minion', '{0}, Exile ~: Each player returns all black and all red creature cards from their graveyard to the battlefield.', ['1', '1'], { colors: ['B'] });
  const mk = (name: string, color: string): CardDef => card(name, 'Creature — Ogre', '', ['1', '1'], { colors: [color] });
  const defs = [DEFILED, mk('Test Black One', 'B'), mk('Test Red One', 'R'), mk('Test Green One', 'G'), mk('Test Black Two', 'B'), card('Test Black Spell', 'Sorcery', '', undefined, { colors: ['B'] })];
  it('is automated', () => expect(full(DEFILED)).toBe(true));
  it('black and red creature cards in every graveyard return under their owners; green creatures and a black sorcery stay', () => {
    let s = scenario([], { p1: { battlefield: ['Test Defiled'], graveyard: ['Test Black One', 'Test Green One', 'Test Black Spell'] }, p2: { graveyard: ['Test Red One', 'Test Black Two'] }, defs });
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Defiled', 'battlefield'), ability: 'p:0:0' })));
    expect(ofName(s, 'Test Black One', 'p1')).toHaveLength(1);
    expect(ofName(s, 'Test Red One', 'p2')).toHaveLength(1);
    expect(ofName(s, 'Test Black Two', 'p2')).toHaveLength(1);
    expect(ofName(s, 'Test Green One')).toHaveLength(0);
    expect(ofName(s, 'Test Black Spell')).toHaveLength(0);
    expect(ofName(s, 'Test Defiled')).toHaveLength(0); // exiled as a cost
  });
});

describe('CR 107.3, 120.3, 400.7: "~ deals X plus 2 damage to each creature that didn\'t enter this turn."', () => {
  const BURN = card('Test Galaxy', 'Sorcery', "~ deals X plus 2 damage to each creature that didn't enter this turn.", undefined, { cost: '{X}' });
  const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '9']);
  it('is automated', () => expect(full(BURN)).toBe(true));
  it('X = 1 deals 3 to every creature that was there at the start of the turn, none to one cast this turn', () => {
    let s = scenario([], { p1: { hand: ['Test Galaxy', 'Test Wall'], battlefield: ['Plains', 'Test Brute'] }, p2: { battlefield: ['Test Wall'] }, defs: [BURN, WALL, BRUTE] });
    s = cast(s, 'Test Wall'); // enters this turn
    s = cast(s, 'Test Galaxy', { x: 1 });
    expect(s.objects[find(s, 'Test Brute', 'battlefield')]!.damage).toBe(3);
    expect(s.objects[ofName(s, 'Test Wall', 'p2')[0]!]!.damage).toBe(3);
    expect(s.objects[ofName(s, 'Test Wall', 'p1')[0]!]!.damage).toBe(0);
  });
});
