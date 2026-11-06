/**
 * edh-cast-13 scenarios (Commander lane edh-cast): each new reading played through the engine with synthetic cards (invented names, design 6.10), with its negative case.
 * Rules (Comprehensive Rules 2026-09-25; cites from memory unless the record says otherwise):
 *   CR 707.10, 707.10c, 614.1a, 616.1  "If you would copy a spell one or more times, instead copy it that many times plus an additional time. You may choose new targets for the
 *                                      additional copy." (Twinning Staff)
 *   CR 601.2f, 500.1                   "Spells your opponents cast during your turn cost {1} more to cast." (Paladin Class)
 *   CR 109.2, 115.3, 608.2c            "target attacking creature gets +1/+1 for each other attacking creature" (Paladin Class)
 *   CR 115.1, 510.2, 601.3, 611.2a     "target player who was dealt combat damage by ~ this turn can't cast noncreature spells until your next turn" (Hope of Ghirapur)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, charsOfObject, type GameState } from '../../../src/index';
import { act, advanceTo, card, drive, find, full, legal, lifeOf, obj, resolveAll, scenario } from '../r3-cost/support';
import { pass } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';

const PLAINS = (n: number): string[] => Array(n).fill('Plains') as string[];
/** Can `player` start casting the card now (when they have priority: the other player passes first)? */
const canCast = (s0: GameState, player: 'p1' | 'p2', name: string): boolean => {
  let s = s0;
  if (s.pending?.kind === 'priority' && s.pending.player !== player) s = pass(s);
  return applyAction(s, { type: 'cast', player, card: find(s, name, 'hand', player) }).error === undefined;
};
const activate = (s: GameState, name: string) => legal(s, 'p1', 'activate').find((a) => a.object === find(s, name, 'battlefield', 'p1') && !a.isMana)?.action;

describe('CR 707.10, 614.1a, 616.1: "If you would copy a spell one or more times, instead copy it that many times plus an additional time." (Twinning Staff)', () => {
  const ROD = card('Test Duplicating Rod', 'Artifact', 'If you would copy a spell one or more times, instead copy it that many times plus an additional time. You may choose new targets for the additional copy.', '{1}');
  const ECHO = card('Test Echo Charm', 'Instant', 'Copy target instant or sorcery spell you control. You may choose new targets for the copy.', '{1}');
  const TWICE = card('Test Twice Charm', 'Instant', 'Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead.\nFlashback {1}', '{1}');
  const ZAP = card('Test Zap Bolt', 'Instant', 'Test Zap Bolt deals 1 damage to any target.', '{1}');
  const PINGER = card('Test Pinger', 'Artifact', '{0}: Test Pinger deals 1 damage to any target.', '{0}');
  const MIRROR = card('Test Ability Mirror', 'Instant', 'Copy target activated or triggered ability you control. You may choose new targets for the copy.', '{0}');
  const DEFS = [ROD, ECHO, TWICE, ZAP, PINGER, MIRROR];
  const zapAndEcho = (battlefield: string[], echo = 'Test Echo Charm', script: Parameters<typeof drive>[1] = {}, echoZone: 'hand' | 'graveyard' = 'hand') => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [...PLAINS(8), ...battlefield], hand: echoZone === 'hand' ? ['Test Zap Bolt', echo] : ['Test Zap Bolt'], graveyard: echoZone === 'graveyard' ? [echo] : [] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap Bolt', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    const zap = s.zones.stack[s.zones.stack.length - 1]!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, echo, echoZone, 'p1'), ...(echoZone === 'graveyard' ? { method: 'flashback' } : {}) }), { targets: [[obj(zap)]] });
    return resolveAll(s, script);
  };
  it('is automated', () => { expect(full(ROD)).toBe(true); });
  it('without the rod: the bolt and one copy deal 2 damage', () => {
    expect(lifeOf(zapAndEcho([]), 'p2')).toBe(18);
  });
  it('CR 616.1: with the rod: the bolt, the copy and the additional copy deal 3 damage', () => {
    expect(lifeOf(zapAndEcho(['Test Duplicating Rod']), 'p2')).toBe(17);
  });
  it('a second rod: one more additional copy (the bolt, the copy and two additional copies: 4 damage)', () => {
    expect(lifeOf(zapAndEcho(['Test Duplicating Rod', 'Test Duplicating Rod']), 'p2')).toBe(16);
  });
  it('"that many times plus an additional time": a spell copied twice becomes three copies (the bolt and three copies: 4 damage); without the rod it is 3', () => {
    expect(lifeOf(zapAndEcho([], 'Test Twice Charm', {}, 'graveyard'), 'p2')).toBe(17);
    expect(lifeOf(zapAndEcho(['Test Duplicating Rod'], 'Test Twice Charm', {}, 'graveyard'), 'p2')).toBe(16);
  });
  it('CR 707.10c: the additional copy may get a new target (you), the other copy keeps its target: 2 damage to the opponent, 1 to you', () => {
    const s = zapAndEcho(['Test Duplicating Rod'], 'Test Echo Charm', { yes: [false, true], targets: [[{ kind: 'player', id: 'p1' }]] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(19);
  });
  it('CR 707.10: an ability is no spell: copying an ability makes no additional copy (a pinger activation and its copy: 2 damage, not 3)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [...PLAINS(2), 'Test Duplicating Rod', 'Test Pinger'], hand: ['Test Ability Mirror'] } });
    const ping = activate(s, 'Test Pinger');
    expect(ping).toBeDefined();
    s = drive(act(s, ping!), { targets: [[{ kind: 'player', id: 'p2' }]] });
    const ability = s.zones.stack[s.zones.stack.length - 1]!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ability Mirror', 'hand', 'p1') }), { targets: [[obj(ability)]] });
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it("the rod's controller only: an opponent's rod does not add a copy to your copies", () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: PLAINS(8), hand: ['Test Zap Bolt', 'Test Echo Charm'] }, p2: { battlefield: ['Test Duplicating Rod'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap Bolt', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    const zap = s.zones.stack[s.zones.stack.length - 1]!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Echo Charm', 'hand', 'p1') }), { targets: [[obj(zap)]] });
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
});

describe('CR 601.2f, 500.1: "Spells your opponents cast during your turn cost {1} more to cast." (Paladin Class)', () => {
  const RULE = card('Test Toll Banner', 'Enchantment', 'Spells your opponents cast during your turn cost {1} more to cast.', '{1}');
  const CHARM = card('Test Cheap Charm', 'Instant', 'You gain 1 life.', '{1}');
  const DEFS = [RULE, CHARM];
  const setup = (rule: 'p1' | 'p2' | null) => scenario([], { defs: DEFS, p1: { battlefield: rule === 'p1' ? ['Test Toll Banner'] : [] }, p2: { battlefield: [...PLAINS(1), ...(rule === 'p2' ? ['Test Toll Banner'] : [])], hand: ['Test Cheap Charm'] } });
  it('is automated', () => { expect(full(RULE)).toBe(true); });
  it("during the turn of the banner's controller an opponent with one land can't cast a {1} instant; during their own turn they can", () => {
    expect(canCast(setup('p1'), 'p2', 'Test Cheap Charm')).toBe(false); // turn 1 is p1's
    const s = advanceTo(setup('p1'), 2, 'main1');
    expect(canCast(s, 'p2', 'Test Cheap Charm')).toBe(true);
  });
  it('without the banner the opponent can cast it during your turn; the banner of the opponent does not tax their own spells in your turn', () => {
    expect(canCast(setup(null), 'p2', 'Test Cheap Charm')).toBe(true);
    expect(canCast(setup('p2'), 'p2', 'Test Cheap Charm')).toBe(true); // p2's own banner taxes p1's spells during p2's turn only
  });
});

describe('CR 109.2, 115.3, 608.2c: "target attacking creature gets +1/+1 for each other attacking creature and gains double strike" (Paladin Class)', () => {
  const RALLY = card('Test Rally Banner', 'Enchantment', 'Whenever you attack, until end of turn, target attacking creature gets +1/+1 for each other attacking creature and gains double strike.', '{1}');
  const A = card('Test Rally Fox', 'Creature — Fox', '', '{1}', ['1', '1']);
  const B = card('Test Rally Owl', 'Creature — Bird', '', '{1}', ['1', '1']);
  const C = card('Test Rally Bat', 'Creature — Bat', '', '{1}', ['1', '1']);
  const DEFS = [RALLY, A, B, C];
  const keywords = (s: GameState, id: string): string[] => charsOfObject(s, s.objects[id]!).keywords.map((k) => k.keyword);
  const attackWith = (names: string[], target: string) => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Rally Banner', ...names] } });
    s = toDeclareAttackers(s);
    s = declareAttackers(s, names.map((n) => [find(s, n, 'battlefield', 'p1')] as [string]));
    s = drive(s, { targets: [[obj(find(s, target, 'battlefield', 'p1'))]] });
    s = passUntil(s, (x) => x.zones.stack.length === 0 || x.pending?.kind !== 'priority', 'the trigger resolving', 5);
    return resolveAll(s);
  };
  it('is automated', () => { expect(full(RALLY)).toBe(true); });
  it('three attackers: the target gets +1/+1 for each of the two others (3/3) and double strike; the others are untouched', () => {
    const s = attackWith(['Test Rally Fox', 'Test Rally Owl', 'Test Rally Bat'], 'Test Rally Fox');
    const fox = find(s, 'Test Rally Fox', 'battlefield', 'p1');
    const c = charsOfObject(s, s.objects[fox]!);
    expect([c.power, c.toughness]).toEqual(['3', '3']);
    expect(keywords(s, fox)).toContain('double strike');
    const owl = charsOfObject(s, s.objects[find(s, 'Test Rally Owl', 'battlefield', 'p1')]!);
    expect([owl.power, owl.toughness]).toEqual(['1', '1']);
  });
  it('alone: no other attacking creature, so +0/+0 (the target itself is not counted) but double strike', () => {
    const s = attackWith(['Test Rally Fox'], 'Test Rally Fox');
    const fox = find(s, 'Test Rally Fox', 'battlefield', 'p1');
    const c = charsOfObject(s, s.objects[fox]!);
    expect([c.power, c.toughness]).toEqual(['1', '1']);
    expect(keywords(s, fox)).toContain('double strike');
  });
  it('a creature that stays home is not an attacking creature: two attack, one stays: +1/+1', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Rally Banner', 'Test Rally Fox', 'Test Rally Owl', 'Test Rally Bat'] } });
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[find(s, 'Test Rally Fox', 'battlefield', 'p1')], [find(s, 'Test Rally Owl', 'battlefield', 'p1')]]);
    s = drive(s, { targets: [[obj(find(s, 'Test Rally Owl', 'battlefield', 'p1'))]] });
    s = resolveAll(s);
    const c = charsOfObject(s, s.objects[find(s, 'Test Rally Owl', 'battlefield', 'p1')]!);
    expect([c.power, c.toughness]).toEqual(['2', '2']);
  });
});

describe('CR 115.1, 510.2, 601.3, 611.2a: "Until your next turn, target player who was dealt combat damage by ~ this turn can\'t cast noncreature spells." (Hope of Ghirapur)', () => {
  const HAWK = card('Test Spark Hawk', 'Artifact Creature — Bird', 'Sacrifice Test Spark Hawk: Until your next turn, target player who was dealt combat damage by Test Spark Hawk this turn can\'t cast noncreature spells.', '{1}', ['1', '1']);
  const CHARM = card('Test Cheap Charm', 'Instant', 'You gain 1 life.', '{0}');
  const WOLF = card('Test Cheap Wolf', 'Creature — Wolf', 'Flash', '{0}', ['1', '1']);
  const DEFS = [HAWK, CHARM, WOLF];
  const sacrifice = (s: GameState) => activate(s, 'Test Spark Hawk');
  const afterCombat = () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Spark Hawk'] }, p2: { hand: ['Test Cheap Charm', 'Test Cheap Wolf'] } });
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[find(s, 'Test Spark Hawk', 'battlefield', 'p1')]]);
    return passUntil(s, (x) => x.turn.step === 'endCombat' && x.pending?.kind === 'priority', 'the end of combat', 80);
  };
  it('is automated', () => { expect(full(HAWK)).toBe(true); });
  it('CR 115.1: before it dealt combat damage there is no legal target, so the sacrifice cannot be activated', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Spark Hawk'] }, p2: { hand: ['Test Cheap Charm', 'Test Cheap Wolf'] } });
    expect(sacrifice(s)).toBeUndefined();
  });
  it('after it dealt combat damage to the opponent: the opponent is a legal target; they then cannot cast the noncreature spell but can cast the creature spell', () => {
    let s = afterCombat();
    expect(lifeOf(s, 'p2')).toBe(19);
    const a = sacrifice(s);
    expect(a).toBeDefined();
    s = resolveAll(drive(act(s, a!), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Spark Hawk')).toBe(false);
    expect(canCast(s, 'p2', 'Test Cheap Charm')).toBe(false);
    expect(canCast(s, 'p2', 'Test Cheap Wolf')).toBe(true);
  });
  it('CR 611.2a: "until your next turn": the ban holds through the rest of this turn and the opponent\'s turn, and ends as your next turn begins', () => {
    let s = afterCombat();
    s = resolveAll(drive(act(s, sacrifice(s)!), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    s = advanceTo(s, 2, 'main1');
    expect(canCast(s, 'p2', 'Test Cheap Charm')).toBe(false);
    s = advanceTo(s, 3, 'upkeep');
    expect(canCast(s, 'p2', 'Test Cheap Charm')).toBe(true);
  });
  it('a blocked hawk dealt no combat damage to a player: the opponent is no legal target', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Spark Hawk'] }, p2: { battlefield: ['Test Cheap Wolf'] } });
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[find(s, 'Test Spark Hawk', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision', 20);
    s = declareBlockers(s, [[find(s, 'Test Cheap Wolf', 'battlefield', 'p2'), find(s, 'Test Spark Hawk', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat' && x.pending?.kind === 'priority', 'the end of combat', 80);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(sacrifice(s)).toBeUndefined();
  });
});
