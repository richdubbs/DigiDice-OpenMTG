/**
 * std-ry3 (wave 2, Commander lane ry3): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 111.10h, 106.6      a Powerstone token's mana pays for an artifact spell, never for a nonartifact spell
 *   CR 702.113a-b, 601.2c  awaken: cast for its awaken cost, the land target gets the counters and becomes a 0/0 Elemental creature with haste that is still a land;
 *                          cast for its mana cost, no land is targeted and nothing happens to the lands
 *   CR 702.39a, 509.1c     provoke: the target untaps and must block the provoking creature; declined, nothing is required
 *   CR 614.10a, 502.1      "Whenever ~ deals combat damage to a player, that player skips their next untap step": the damaged player's untap step, not yours
 *   CR 614.10a, 500.11     "<player> skips their next combat phase": that player's next turn has no combat phase, the one after does
 *   CR 402.2, 514.1        "your maximum hand size is increased by two" / "reduced by three": the cleanup step discards down to 9 / 4
 *   CR 509.1b              "can't be blocked except by Walls and/or creatures with flying": a Wall or a flyer may block it, a Bear may not
 */
import { describe, expect, it } from 'vitest';
import { getChars, type CardDef, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { clone } from '../../../src/util/clone';
import { act, advanceTo, answer, find, labels, pass, scenario } from '../../m3/scenario';
import { declareBlockers, passUntil, toDeclareBlockers } from '../../m4/helpers';
import { attackWith, card, cast, counters, full, pt, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const rejected = (s: GameState, f: (s: GameState) => GameState): boolean => { try { f(s); return false; } catch (e) { return /rejected/i.test(String(e)); } };
const handSize = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const tapAll = (s0: GameState, p: string): GameState => {
  const s = clone(s0);
  for (const id of s.zones.battlefield) if (s.objects[id]!.controller === p) s.objects[id]!.tapped = true;
  return s;
};

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const TRINKET = card('Test Trinket', 'Artifact', '', undefined, '{2}');
const QUARRY = card('Test Quarry', 'Sorcery', 'Create two Powerstone tokens.');
const STIR = card('Test Stir', 'Sorcery', 'You gain 2 life.\nAwaken 2—{1}');
const GOADER = card('Test Goader', 'Creature — Beast', 'Provoke', ['3', '3']);
const HUNTER = card('Test Hunter', 'Creature — Snake', 'Whenever this creature deals combat damage to a player, that player skips their next untap step.', ['1', '1']);
const STALL = card('Test Stall', 'Sorcery', 'Target opponent skips their next combat phase.');
const SAGE = card('Test Sage', 'Creature — Human', 'Your maximum hand size is increased by two.', ['1', '1']);
const DOLT = card('Test Dolt', 'Creature — Human', 'Your maximum hand size is reduced by three.', ['1', '1']);
const RIDER = card('Test Rider', 'Creature — Elf', "This creature can't be blocked except by Walls and/or creatures with flying.", ['2', '2']);
const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['0', '4']);
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '1']);
const DEFS: CardDef[] = [BEAR, TRINKET, QUARRY, STIR, GOADER, HUNTER, STALL, SAGE, DOLT, RIDER, WALL, BIRD];

/** Pass priority (answering a cleanup discard with the first cards offered) until `done`. */
function passWhile(s0: GameState, done: (s: GameState) => boolean): GameState {
  let s = s0;
  for (let guard = 0; !done(s); guard++) {
    if (guard > 400) throw new Error('did not get there');
    const d = s.pending as { kind: string; options?: ObjectId[]; min?: number } | undefined;
    if (d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options!.slice(0, d.min) });
    else if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else s = pass(s);
  }
  return s;
}

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 111.10h, 106.6: a Powerstone token\'s mana can\'t be spent to cast a nonartifact spell', () => {
  it('two Powerstones pay for an artifact spell; a nonartifact spell is not offered', () => {
    let s = scenario([], { p1: { hand: ['Test Quarry', 'Test Bear', 'Test Trinket'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Quarry'));
    const stones = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(stones).toHaveLength(2);
    expect(labels(s, 'p1')).toContain('Cast Test Trinket');
    expect(labels(s, 'p1')).not.toContain('Cast Test Bear');
    s = resolveAll(cast(s, 'Test Trinket'));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Trinket')).toBe(true);
  });
});

describe('CR 702.113a-b, 601.2c: awaken', () => {
  it('cast for its awaken cost: the target land gets two +1/+1 counters and becomes a 0/0 Elemental creature with haste; it is still a land', () => {
    let s = scenario([], { p1: { hand: ['Test Stir'], battlefield: ['Plains', 'Plains'] }, defs: DEFS });
    const lands = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains');
    const life = s.players.find((p) => p.id === 'p1')!.life;
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Stir', 'hand'), method: 'awaken' }), { targets: [obj(lands[1]!)] });
    s = resolveAll(s, { targets: [obj(lands[1]!)] });
    const c = getChars(s, lands[1]!)!;
    expect(counters(s, lands[1]!, '+1/+1')).toBe(2);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Plains', 'Elemental']));
    expect(c.keywords.map((k) => k.keyword)).toContain('haste');
    expect(pt(s, lands[1]!)).toBe('2/2');
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life + 2);
    expect(getChars(s, lands[0]!)!.types).not.toContain('Creature');
  });
  it('cast for its mana cost: no land is targeted (CR 702.113b) and no land changes; the rest of the spell resolves', () => {
    let s = scenario([], { p1: { hand: ['Test Stir'], battlefield: ['Plains'] }, defs: DEFS });
    const land = find(s, 'Plains', 'battlefield');
    const life = s.players.find((p) => p.id === 'p1')!.life;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Stir', 'hand') });
    expect(s.pending?.kind).not.toBe('chooseTargets');
    s = resolveAll(s);
    expect(getChars(s, land)!.types).not.toContain('Creature');
    expect(counters(s, land, '+1/+1')).toBe(0);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life + 2);
  });
});

describe('CR 702.39a, 509.1c: provoke', () => {
  it('the tapped target untaps and must block the provoking creature (no block and another block are refused)', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Goader', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = tapAll(s, 'p2');
    const goader = find(s, 'Test Goader', 'battlefield');
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(attackWith(s, [goader, mine]), { targets: [obj(theirs)], yes: true });
    expect(s.objects[theirs]!.tapped).toBe(false);
    s = toDeclareBlockers(s);
    expect(rejected(s, (x) => declareBlockers(x, []))).toBe(true);
    expect(rejected(s, (x) => declareBlockers(x, [[theirs, mine]]))).toBe(true);
    expect(declareBlockers(s, [[theirs, goader]]).combat!.blockers.find((b) => b.id === theirs)!.blocking).toEqual([goader]);
  });
  it('declined ("you may"), the target stays tapped and nothing is required', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Goader'] }, p2: { battlefield: ['Test Bear', 'Test Wall'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    s = clone(s);
    s.objects[theirs]!.tapped = true;
    s = resolveAll(attackWith(s, [find(s, 'Test Goader', 'battlefield')]), { targets: [obj(theirs)], yes: false });
    expect(s.objects[theirs]!.tapped).toBe(true);
    s = toDeclareBlockers(s);
    expect(declareBlockers(s, []).combat!.blockers).toEqual([]);
  });
});

describe('CR 614.10a, 502.1: "Whenever ~ deals combat damage to a player, that player skips their next untap step"', () => {
  it('the damaged player\'s permanents stay tapped in their next untap step and untap in the one after; the attacker\'s controller untaps as usual', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Hunter', 'Plains'] }, p2: { battlefield: ['Plains'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = tapAll(tapAll(s, 'p2'), 'p1');
    const hunter = find(s, 'Test Hunter', 'battlefield');
    s = clone(s);
    s.objects[hunter]!.tapped = false;
    const theirs = find(s, 'Plains', 'battlefield', 'p2');
    const mine = find(s, 'Plains', 'battlefield', 'p1');
    s = passUntil(attackWith(s, [hunter]), (x) => x.turn.step === 'endCombat' || x.pending?.kind === 'declareBlockers', 'combat');
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    s = resolveAll(passUntil(s, (x) => x.zones.stack.length > 0 || x.turn.step === 'endCombat', 'the trigger'));
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
    s = advanceTo(s, 4, 'main1');
    expect(s.objects[theirs]!.tapped).toBe(true);
    s = advanceTo(s, 5, 'main1');
    expect(s.objects[mine]!.tapped).toBe(false);
    s = advanceTo(s, 6, 'main1');
    expect(s.objects[theirs]!.tapped).toBe(false);
  });
});

describe('CR 614.10a, 500.11: "Target opponent skips their next combat phase"', () => {
  it('the opponent\'s next turn has no combat phase; the turn after has one', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Stall'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Stall', { targets: [player('p2')] }), { targets: [player('p2')] });
    s = advanceTo(s, 2, 'upkeep');
    const seen = new Set<string>();
    s = passWhile(s, (x) => { if (x.turn.number === 2) seen.add(x.turn.step); return x.turn.number === 3; });
    expect(seen.has('main2')).toBe(true);
    expect(seen.has('declareAttackers')).toBe(false);
    expect(seen.has('beginCombat')).toBe(false);
    const later = new Set<string>();
    s = passWhile(s, (x) => { if (x.turn.number === 4) later.add(x.turn.step); return x.turn.number === 5; });
    expect(later.has('beginCombat')).toBe(true);
  });
});

describe('CR 402.2, 514.1: "your maximum hand size is increased by two" / "is reduced by three"', () => {
  const cleanupTo = (creature: string, cards: number, who = 'p1'): number => {
    let s = scenario([], { [who]: { hand: Array(cards).fill('Plains'), battlefield: [creature] }, defs: DEFS });
    s = passWhile(s, (x) => x.turn.number === 2);
    return handSize(s, who);
  };
  it('increased by two: with ten cards, the cleanup step discards down to nine; with nine, nothing', () => {
    expect(cleanupTo('Test Sage', 10)).toBe(9);
    expect(cleanupTo('Test Sage', 9)).toBe(9);
  });
  it('reduced by three: with six cards, down to four; the opponent keeps seven', () => {
    expect(cleanupTo('Test Dolt', 6)).toBe(4);
    let s = scenario([], { p1: { battlefield: ['Test Dolt'] }, p2: { hand: Array(7).fill('Plains') }, defs: DEFS });
    s = passWhile(s, (x) => x.turn.number === 3);
    expect(handSize(s, 'p2')).toBe(7); // drew one in turn 2 (eight cards), discarded down to seven
  });
});

describe('CR 509.1b: "can\'t be blocked except by Walls and/or creatures with flying"', () => {
  it('a Wall or a flyer may block it; a Bear may not', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Rider'] }, p2: { battlefield: ['Test Bear', 'Test Wall', 'Test Bird'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const rider = find(s, 'Test Rider', 'battlefield');
    s = toDeclareBlockers(attackWith(s, [rider]));
    expect(rejected(s, (x) => declareBlockers(x, [[find(x, 'Test Bear', 'battlefield'), rider]]))).toBe(true);
    expect(declareBlockers(s, [[find(s, 'Test Wall', 'battlefield'), rider]]).combat!.blockers).toHaveLength(1);
    expect(declareBlockers(s, [[find(s, 'Test Bird', 'battlefield'), rider]]).combat!.blockers).toHaveLength(1);
  });
});
