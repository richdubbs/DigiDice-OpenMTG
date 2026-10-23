/**
 * std-freecast-1 (lane std-freecast): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 118.9, 601.2b, 601.2i, 102.1  "The first spell each player casts during each of their turns may be cast without paying its mana cost.": the active
 *                                    player's first spell this turn is offered for nothing; the second is not, nor is a spell after a first one paid for; the
 *                                    other player on their own turn too; never a player who is not the active player
 *   CR 118.9, 611.2                  "The next red creature spell you cast this turn can be cast without paying its mana cost.": only a spell the filter
 *                                    describes; the next matching spell uses it up whether it was cast for nothing or not; an opponent's spell never; it ends
 *                                    with the turn
 *   CR 701.10, 608.2h, 613.4c        "Until end of turn, double its power and toughness and it gains trample.": +X/+Y where X and Y are its power and
 *                                    toughness as the effect begins (World War Hulk's chapter III)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { getChars, hasKeyword, ptNumbers } from '../../../src/rules/characteristics';
import { isGrantedAltMethod } from '../../../src/statics/play-permits';
import { act, advanceTo, card, drive, find, full, named, resolveAll, scenario } from '../r3-cost/support';

const FIELD = card('Test Loom Field', 'Enchantment', 'The first spell each player casts during each of their turns may be cast without paying its mana cost.', '{2}{U}');
const GIANT = card('Test Hill Giant', 'Creature — Giant', '', '{5}', ['5', '5']);
const NOTION = card('Test Notion', 'Sorcery', 'Draw a card.', '{4}');
const TRINKET = card('Test Trinket', 'Artifact', '', '{1}');
const QUICK = card('Test Quick Thought', 'Instant', 'Draw a card.', '{3}');
const BEACON = card('Test Red Beacon', 'Artifact', '{T}: The next red creature spell you cast this turn can be cast without paying its mana cost.', '{1}');
const DRAKE = card('Test Ember Drake', 'Creature — Drake', 'Flying', '{4}{R}', ['3', '3'], ['R']);
const OGRE = card('Test Ember Ogre', 'Creature — Ogre', '', '{3}{R}', ['4', '4'], ['R']);
const SPRITE = card('Test Tide Sprite', 'Creature — Faerie', '', '{4}{U}', ['2', '2'], ['U']);
const SPARK = card('Test Red Spark', 'Sorcery', 'Draw a card.', '{3}{R}', undefined, ['R']);
const RAGE = card('Test Doubling Rage', 'Sorcery', 'Choose target creature you control. Until end of turn, double its power and toughness and it gains trample.', '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['3', '2']);
const DEFS = [FIELD, GIANT, NOTION, TRINKET, QUICK, BEACON, DRAKE, OGRE, SPRITE, SPARK, RAGE, BEAR];

/** The cast methods `player` is offered for a card (undefined: the normal cost). */
const methods = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): (string | undefined)[] =>
  legalActions(s, player).filter((a) => a.kind === 'cast' && a.object === id).map((a) => (a.action as { method?: string }).method);
const granted = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): string | undefined => methods(s, id, player).find((m) => isGrantedAltMethod(m));
const castWith = (s: GameState, id: ObjectId, method: string | undefined, player: PlayerId = 'p1'): GameState =>
  drive(act(s, { type: 'cast', player, card: id, ...(method !== undefined ? { method } : {}) }));

describe('std-freecast-1: the synthetic cards are automated', () => {
  it('every synthetic card compiles fully automated', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 118.9, 601.2b, 601.2i: "The first spell each player casts during each of their turns may be cast without paying its mana cost."', () => {
  it('the active player\'s first spell is offered for nothing and resolves; the second spell that turn is not offered for nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Loom Field'], hand: ['Test Hill Giant', 'Test Notion'] } });
    const giant = find(s, 'Test Hill Giant', 'hand', 'p1');
    expect(methods(s, giant)).toEqual([granted(s, giant)]); // no land: only the free way
    s = resolveAll(castWith(s, giant, granted(s, giant)));
    expect(named(s, 'Test Hill Giant')).toHaveLength(1);
    expect(methods(s, find(s, 'Test Notion', 'hand', 'p1'))).toEqual([]);
  });
  it('a first spell cast for its mana cost uses the chance up: the next spell is not offered for nothing', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Test Loom Field', 'Island'], hand: ['Test Trinket', 'Test Hill Giant'] } });
    const trinket = find(s, 'Test Trinket', 'hand', 'p1');
    expect(granted(s, trinket)).toBeDefined();
    s = resolveAll(castWith(s, trinket, undefined)); // paid with the Island
    expect(named(s, 'Test Trinket')).toHaveLength(1);
    expect(granted(s, find(s, 'Test Hill Giant', 'hand', 'p1'))).toBeUndefined();
  });
  it('CR 102.1: each player on their own turn: the other player\'s first spell of their turn is free, while the player whose turn it is not gets nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Loom Field'], hand: ['Test Quick Thought'] }, p2: { hand: ['Test Hill Giant', 'Test Quick Thought'] } });
    s = advanceTo(s, 2, 'main1');
    const giant = find(s, 'Test Hill Giant', 'hand', 'p2');
    expect(granted(s, giant, 'p2')).toBeDefined();
    s = castWith(s, giant, granted(s, giant, 'p2'), 'p2');
    // p2 passes with the Giant on the stack: p1, not the active player, is offered no free instant (and has no mana for one)
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.player).toBe('p1');
    expect(methods(s, find(s, 'Test Quick Thought', 'hand', 'p1'), 'p1')).toEqual([]);
    s = act(s, { type: 'pass', player: 'p1' });
    expect(named(s, 'Test Hill Giant')).toHaveLength(1);
    expect(granted(s, find(s, 'Test Quick Thought', 'hand', 'p2'), 'p2')).toBeUndefined(); // p2's second spell of the turn
  });
  it('CR 113.6, 611.3a: without the enchantment on the battlefield nothing is offered', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Hill Giant'], graveyard: ['Test Loom Field'] } });
    expect(methods(s, find(s, 'Test Hill Giant', 'hand', 'p1'))).toEqual([]);
  });
});

describe('CR 118.9, 611.2: "The next red creature spell you cast this turn can be cast without paying its mana cost."', () => {
  it('after the ability resolves, a red creature spell is offered for nothing and resolves; a second red creature spell is not', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Red Beacon'], hand: ['Test Ember Drake', 'Test Ember Ogre'] } });
    const drake = find(s, 'Test Ember Drake', 'hand', 'p1');
    expect(methods(s, drake)).toEqual([]);
    const beacon = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === find(s, 'Test Red Beacon', 'battlefield', 'p1'))!;
    s = resolveAll(drive(act(s, beacon.action)));
    expect(s.turn.nextSpell?.map((r) => r.rider)).toEqual(['free']);
    expect(methods(s, drake)).toEqual([granted(s, drake)]);
    s = resolveAll(castWith(s, drake, granted(s, drake)));
    expect(named(s, 'Test Ember Drake')).toHaveLength(1);
    expect(s.turn.nextSpell ?? []).toEqual([]);
    expect(methods(s, find(s, 'Test Ember Ogre', 'hand', 'p1'))).toEqual([]);
  });
  it('the filter: a blue creature spell and a red sorcery are not offered for nothing, and casting the sorcery leaves the rider waiting', () => {
    let s = scenario(['Mountain'], { defs: DEFS, p1: { battlefield: ['Test Red Beacon', ...Array(4).fill('Mountain')], hand: ['Test Tide Sprite', 'Test Red Spark', 'Test Ember Ogre'] } });
    const beacon = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === find(s, 'Test Red Beacon', 'battlefield', 'p1'))!;
    s = resolveAll(drive(act(s, beacon.action)));
    expect(granted(s, find(s, 'Test Tide Sprite', 'hand', 'p1'))).toBeUndefined();
    const spark = find(s, 'Test Red Spark', 'hand', 'p1');
    expect(granted(s, spark)).toBeUndefined();
    s = resolveAll(castWith(s, spark, undefined)); // paid with the four Mountains
    expect(s.turn.nextSpell?.map((r) => r.rider)).toEqual(['free']);
    expect(granted(s, find(s, 'Test Ember Ogre', 'hand', 'p1'))).toBeDefined();
  });
  it('the next matching spell uses the rider up even when it is paid for: the second red creature spell is full price', () => {
    let s = scenario(['Mountain'], { defs: DEFS, p1: { battlefield: ['Test Red Beacon', ...Array(4).fill('Mountain')], hand: ['Test Ember Ogre', 'Test Ember Drake'] } });
    const beacon = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === find(s, 'Test Red Beacon', 'battlefield', 'p1'))!;
    s = resolveAll(drive(act(s, beacon.action)));
    s = resolveAll(castWith(s, find(s, 'Test Ember Ogre', 'hand', 'p1'), undefined));
    expect(named(s, 'Test Ember Ogre')).toHaveLength(1);
    expect(s.turn.nextSpell ?? []).toEqual([]);
    expect(granted(s, find(s, 'Test Ember Drake', 'hand', 'p1'))).toBeUndefined();
  });
  it('only the player who activated it ("you"): the opponent\'s red creature spell is not offered for nothing; and the rider ends with the turn', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Red Beacon'] }, p2: { hand: ['Test Ember Drake'] } });
    const beacon = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === find(s, 'Test Red Beacon', 'battlefield', 'p1'))!;
    s = resolveAll(drive(act(s, beacon.action)));
    expect(s.turn.nextSpell?.[0]?.player).toBe('p1');
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.nextSpell).toBeUndefined();
    expect(methods(s, find(s, 'Test Ember Drake', 'hand', 'p2'), 'p2')).toEqual([]);
  });
});

describe('CR 701.10, 608.2h, 613.4c: "Until end of turn, double its power and toughness and it gains trample."', () => {
  it('a 3/2 becomes 6/4 with trample until end of turn (the amounts are its power and toughness as the effect begins); another creature is unchanged', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear', 'Test Bear'], hand: ['Test Doubling Rage'] } });
    const [bear, other] = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doubling Rage', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: bear! }]] });
    s = resolveAll(s);
    const pt = (id: ObjectId): [number | null, number | null] => { const n = ptNumbers(getChars(s, id)); return [n.power, n.toughness]; };
    expect(pt(bear!)).toEqual([6, 4]);
    expect(hasKeyword(getChars(s, bear!), 'trample')).toBe(true);
    expect(pt(other!)).toEqual([3, 2]);
    expect(hasKeyword(getChars(s, other!), 'trample')).toBe(false);
    s = advanceTo(s, 2, 'upkeep');
    expect(pt(bear!)).toEqual([3, 2]);
  });
});
