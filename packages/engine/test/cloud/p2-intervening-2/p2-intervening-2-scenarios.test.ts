/**
 * p2-intervening-2 (lane p2-intervening): the intervening "if" readings of parser/holes/p2iv2.ts played through the engine with synthetic cards compiled by the
 * game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 *
 *   CR 603.10a, 120.1  "When this creature dies, if 3 or more damage was dealt to it this turn": the source's own damage this turn, added up, as it last existed
 *   CR 603.10a, 510.2  "When this creature dies, if it dealt combat damage to a player this turn"
 *   CR 303.4           "if this creature is enchanted"
 *   CR 508.1           "if you didn't attack with a creature this turn"
 *   CR 601.2i          "if that player didn't cast a spell this turn"
 *   CR 208.1           "if that creature's power is greater than this creature's"
 *   CR 105.2           "if all nonland permanents you control are white"
 *   CR 402.1           "if you control no permanents other than this enchantment and have no cards in hand"
 *   CR 122.6           "if a +1/+1 counter was put on a permanent under your control this turn"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, find, life, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const castAt = (s: GameState, name: string, target?: ObjectId, player = 'p1'): GameState =>
  resolveAll(settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), target ? { targets: [{ kind: 'object', id: target }] } : {}));
const reach = (s: GameState, turn: number, step: GameState['turn']['step']): GameState => resolveAll(advanceTo(s, turn, step));

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SCORCH = card('Test Scorch', 'Instant', 'Test Scorch deals 3 damage to target creature.');
const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to target creature.');
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
const BRITTLE = card('Test Brittle Spirit', 'Creature — Spirit', 'When this creature dies, if 3 or more damage was dealt to it this turn, you gain 3 life.', { pt: ['1', '3'] });
const RAIDER = card('Test Grave Raider', 'Creature — Rat', 'When this creature dies, if it dealt combat damage to a player this turn, you gain 3 life.', { pt: ['2', '2'] });
const POD = card('Test Pod Keeper', 'Creature — Elf', 'At the beginning of your upkeep, if this creature is enchanted, you gain 2 life.', { pt: ['1', '1'] });
const CHARM = card('Test Small Charm', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
const IDLE = card('Test Idle Banner', 'Enchantment', "At the beginning of your end step, if you didn't attack with a creature this turn, you gain 2 life.");
const HASTE = card('Test Restless Mark', 'Enchantment', "At the beginning of each player's end step, if that player didn't cast a spell this turn, you gain 2 life.");
const TRINKET = card('Test Trinket', 'Instant', 'You gain 1 life.');
const RUNT = card('Test Runt Collector', 'Creature — Elf', "Whenever another creature you control enters, if that creature's power is greater than this creature's, you gain 2 life.", { pt: ['1', '1'] });
const WEE = card('Test Wee Mouse', 'Creature — Mouse', '', { pt: ['1', '1'] });
const PURE = card('Test Pure Altar', 'Enchantment', 'At the beginning of your upkeep, if all nonland permanents you control are white, you gain 2 life.', { colors: ['W'], cost: '{W}' });
const GREY = card('Test Grey Idol', 'Artifact', '');
const LONE = card('Test Lone Throne', 'Enchantment', 'At the beginning of your upkeep, if you control no permanents other than this enchantment and have no cards in hand, you gain 5 life.');
const FEED = card('Test Feeding Song', 'Instant', 'Put a +1/+1 counter on target creature.');
const GROWTH = card('Test Growth Herald', 'Enchantment', 'At the beginning of each end step, if a +1/+1 counter was put on a permanent under your control this turn, you gain 2 life.');
const DEFS: CardDef[] = [BEAR, SCORCH, SPARK, DOOM, BRITTLE, RAIDER, POD, CHARM, IDLE, HASTE, TRINKET, RUNT, WEE, PURE, GREY, LONE, FEED, GROWTH];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 603.10a, 120.1: "When this creature dies, if 3 or more damage was dealt to it this turn, ..."', () => {
  it('3 damage kills it: you gain 3 life', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Brittle Spirit'], hand: ['Test Scorch'] } });
    s = castAt(s, 'Test Scorch', find(s, 'Test Brittle Spirit', 'battlefield', 'p1'));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Brittle Spirit')).toBe(false);
    expect(life(s, 'p1')).toBe(23);
  });
  it('1 damage, then destroyed: nothing; CR 120.1: damage is added up, 1 + ... is still less than 3', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Brittle Spirit'], hand: ['Test Spark', 'Test Doom'] } });
    const id = find(s, 'Test Brittle Spirit', 'battlefield', 'p1');
    s = castAt(s, 'Test Spark', id);
    s = castAt(s, 'Test Doom', id);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 603.10a, 510.2: "When this creature dies, if it dealt combat damage to a player this turn, ..."', () => {
  it('it attacked unblocked and was destroyed after combat: you gain 3 life; destroyed without attacking: nothing', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Grave Raider'], hand: ['Test Doom'] } });
    let s = toDeclareAttackers(advanceTo(s0, 3, 'main1'));
    s = declareAttackers(s, [[find(s, 'Test Grave Raider', 'battlefield', 'p1'), 'p2']]);
    s = passUntil(s, (x) => x.turn.step === 'main2', 'main2');
    expect(life(s, 'p2')).toBe(18);
    s = castAt(s, 'Test Doom', find(s, 'Test Grave Raider', 'battlefield', 'p1'));
    expect(life(s, 'p1')).toBe(23);
    let t = scenario([], { defs: DEFS, p1: { battlefield: ['Test Grave Raider'], hand: ['Test Doom'] } });
    t = castAt(t, 'Test Doom', find(t, 'Test Grave Raider', 'battlefield', 'p1'));
    expect(life(t, 'p1')).toBe(20);
  });
});

describe('CR 303.4: "At the beginning of your upkeep, if this creature is enchanted, ..."', () => {
  it('with an Aura attached: you gain 2 life at your upkeep; without: nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pod Keeper'], hand: ['Test Small Charm'] } });
    s = castAt(s, 'Test Small Charm', find(s, 'Test Pod Keeper', 'battlefield', 'p1'));
    expect(life(reach(s, 3, 'draw'), 'p1')).toBe(22);
    expect(life(reach(scenario([], { defs: DEFS, p1: { battlefield: ['Test Pod Keeper'] } }), 3, 'draw'), 'p1')).toBe(20);
  });
});

describe('CR 508.1: "At the beginning of your end step, if you didn\'t attack with a creature this turn, ..."', () => {
  it('no attack: you gain 2 life; an attack with a creature: nothing', () => {
    const quiet = reach(scenario([], { defs: DEFS, p1: { battlefield: ['Test Idle Banner', 'Test Bear'] } }), 3, 'main1');
    const before = life(quiet, 'p1'); // turn 1's end step gave 2 already
    expect(life(reach(quiet, 3, 'end'), 'p1')).toBe(before + 2);
    let s = toDeclareAttackers(quiet);
    s = declareAttackers(s, [[find(s, 'Test Bear', 'battlefield', 'p1'), 'p2']]);
    expect(life(reach(s, 3, 'end'), 'p1')).toBe(before);
  });
});

describe('CR 601.2i: "At the beginning of each player\'s end step, if that player didn\'t cast a spell this turn, ..."', () => {
  it('you cast a spell on turn 1: nothing at your end step; your opponent casts none on turn 2: you gain 2 life at theirs', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Restless Mark'], hand: ['Test Trinket'] } });
    s = castAt(s, 'Test Trinket');
    expect(life(s, 'p1')).toBe(21);
    s = reach(s, 1, 'end');
    expect(life(s, 'p1')).toBe(21);
    s = reach(s, 2, 'end');
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 208.1: "Whenever another creature you control enters, if that creature\'s power is greater than this creature\'s, ..."', () => {
  it('a 2/2 enters (2 > 1): you gain 2 life; a 1/1 enters (1 is not greater than 1): nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Runt Collector'], hand: ['Test Bear', 'Test Wee Mouse'] } });
    s = castAt(s, 'Test Bear');
    expect(life(s, 'p1')).toBe(22);
    s = castAt(s, 'Test Wee Mouse');
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 105.2: "At the beginning of your upkeep, if all nonland permanents you control are white, ..."', () => {
  it('only the white enchantment: you gain 2 life; a colorless artifact too: nothing', () => {
    expect(life(reach(scenario([], { defs: DEFS, p1: { battlefield: ['Test Pure Altar'] } }), 3, 'draw'), 'p1')).toBe(22);
    expect(life(reach(scenario([], { defs: DEFS, p1: { battlefield: ['Test Pure Altar', 'Test Grey Idol'] } }), 3, 'draw'), 'p1')).toBe(20);
  });
});

describe('CR 402.1: "if you control no permanents other than this enchantment and have no cards in hand, ..."', () => {
  it('nothing else and an empty hand at your upkeep (the draw comes after): you gain 5 life; another permanent: nothing', () => {
    expect(life(reach(scenario([], { defs: DEFS, p1: { battlefield: ['Test Lone Throne'] } }), 3, 'draw'), 'p1')).toBe(25);
    expect(life(reach(scenario([], { defs: DEFS, p1: { battlefield: ['Test Lone Throne', 'Test Grey Idol'] } }), 3, 'draw'), 'p1')).toBe(20);
  });
});

describe('CR 122.6: "At the beginning of each end step, if a +1/+1 counter was put on a permanent under your control this turn, ..."', () => {
  it('a counter on your creature: you gain 2 life at the end step; a counter on the opponent\'s creature only: nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Growth Herald', 'Test Bear'], hand: ['Test Feeding Song'] } });
    s = castAt(s, 'Test Feeding Song', find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(life(reach(s, 1, 'end'), 'p1')).toBe(22);
    let t = scenario([], { defs: DEFS, p1: { battlefield: ['Test Growth Herald'], hand: ['Test Feeding Song'] }, p2: { battlefield: ['Test Bear'] } });
    t = castAt(t, 'Test Feeding Song', find(t, 'Test Bear', 'battlefield', 'p2'));
    expect(life(reach(t, 1, 'end'), 'p1')).toBe(20);
  });
});
