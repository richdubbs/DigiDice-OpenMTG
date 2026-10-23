/**
 * p2-combat-flow-1 (Phase 2 lane p2-combat-flow): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 510.1a, 613.11   "Each creature you control assigns combat damage equal to its toughness rather than its power." (and "... this turn" of one target)
 *   CR 509.1g, 611.2c   "Whenever ~ becomes blocked, each creature blocking it gets -1/-1 until end of turn."
 *   CR 506.4, 603.10a   "sacrifice it. If you do, it deals 2 damage to each creature blocking it"; "Whenever a creature blocking ~ dies, ..."
 *   CR 506.2, 508.1b    "~ deals 1 damage to the player or planeswalker that creature is attacking."
 *   CR 506.3, 115.1     "target creature without flying that's attacking you" (the player, not a planeswalker you control); "Exile ~ and <target>"
 *   CR 601.3, 506.1     "Cast ~ only during combat on your turn.", "Cast ~ only during the declare blockers step."
 *   CR 509.1g-h         "creatures blocked by ~", "creatures blocking or blocked by ~" (resolved and static)
 *   CR 509.1c           "All creatures block each combat if able."
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { advanceTo, act, answer, find, life, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers, toStep } from '../../m4/helpers';
import { card, full, pt, resolveAll, settle } from '../cmd3/helpers';
import { getChars } from '../../../src/rules/characteristics';

const WALL = card('Test Living Bulwark', 'Creature — Wall', '', ['1', '4']);
const BRUTE = card('Test Hill Brute', 'Creature — Giant', '', ['3', '1']);
const BEAR = card('Test Mild Bear', 'Creature — Bear', '', ['2', '2']);
const BIRD = card('Test Sky Finch', 'Creature — Bird', 'Flying', ['1', '1']);
const SAGE = card('Test Stout Sage', 'Legendary Creature — Human Monk', 'Each creature you control assigns combat damage equal to its toughness rather than its power.', ['1', '3']);
const SHAPER = card('Test Tide Shaper', 'Creature — Merfolk', '{1}: Target creature you control assigns combat damage equal to its toughness rather than its power this turn.', ['1', '1']);
const WIGHT = card('Test Rotting Wight', 'Creature — Zombie', 'Whenever this creature becomes blocked, each creature blocking it gets -1/-1 until end of turn.', ['2', '1']);
const CHIEF = card('Test Goblin Chief', 'Creature — Goblin', 'Whenever another Goblin you control becomes blocked, sacrifice it. If you do, it deals 2 damage to each creature blocking it.', ['1', '1']);
const GOBLIN = card('Test Goblin Runt', 'Creature — Goblin', '', ['1', '1']);
const MARAUDER = card('Test Bane Marauder', 'Creature — Wolf', 'Whenever a creature blocking this creature dies, that creature\'s controller loses 1 life.', ['3', '3']);
const BOMBARD = card('Test Ember Bombard', 'Enchantment', 'Whenever a creature you control with power 2 or less attacks, this enchantment deals 1 damage to the player or planeswalker that creature is attacking.');
const WALKER = card('Test Oath Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
const SPIDER = card('Test Pit Spider', 'Creature — Spider', '{T}: Exile this creature and target creature without flying that\'s attacking you.', ['2', '3']);
const RALLY = card('Test War Rally', 'Instant', 'Cast this spell only during combat on your turn.\nCreatures you control get +1/+0 until end of turn.');
const SNARE = card('Test Sudden Snare', 'Instant', 'Cast this spell only during the declare blockers step.\nTarget blocking creature gets -2/-2 until end of turn.');
const FROST = card('Test Frost Beast', 'Creature — Elemental Beast', 'At end of combat, destroy all creatures blocking or blocked by this creature.', ['2', '5']);
const ALMS = card('Test Alms Ox', 'Creature — Ox', 'Creatures blocking or blocked by this creature have lifelink.', ['2', '6']);
const NETS = card('Test Net Wall', 'Creature — Wall', 'Defender\n{0}: Exile all creatures blocked by this creature.', ['0', '6']);
const MARTYR = card('Test Vengeful Martyr', 'Creature — Human Cleric', 'When this creature dies, destroy all creatures blocking or blocked by it.', ['1', '1']);
const MELEE = card('Test Grand Brawl', 'Enchantment', 'All creatures block each combat if able.');
const DEFS: CardDef[] = [WALL, BRUTE, BEAR, BIRD, SAGE, SHAPER, WIGHT, CHIEF, GOBLIN, MARAUDER, BOMBARD, WALKER, SPIDER, RALLY, SNARE, FROST, ALMS, NETS, MELEE, MARTYR];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const on = (s: GameState, name: string, player?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && (player === undefined || s.objects[id]!.controller === player));
const one = (s: GameState, name: string, player?: string): ObjectId => on(s, name, player)[0]!;
/** Planeswalkers enter with three loyalty counters. */
const spec = (n: string) => (n === 'Test Oath Walker' ? { name: n, counters: { loyalty: 3 } } : n);
const setup = (p1: string[], p2: string[], hand: string[] = []): GameState => scenario(['Plains'], { p1: { battlefield: p1.map(spec), hand }, p2: { battlefield: p2.map(spec) }, defs: DEFS });

/** p1 attacks with `attacks`; p2 blocks with `blocks` ([blocker, attacker]); stop when the blocks are declared and the triggers settled (priority). */
function attackAndBlock(s0: GameState, attacks: [ObjectId, string?][], blocks: [ObjectId, ObjectId][]): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), attacks as [ObjectId, string][]);
  s = resolveAll(s);
  s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers or damage', 10);
  return s.pending?.kind === 'declareBlockers' ? resolveAll(declareBlockers(s, blocks)) : s;
}
/** Pass priority to the end of combat step (priority there), resolving what triggers. */
function toEndOfCombat(s0: GameState): GameState {
  let s = s0;
  for (let k = 0; k < 60 && !(s.turn.step === 'endCombat' && s.pending?.kind === 'priority' && s.zones.stack.length === 0); k++) {
    s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
  }
  return s;
}

describe('CR 510.1a, 613.11: "Each creature you control assigns combat damage equal to its toughness rather than its power."', () => {
  it('CR 510.1a: a 1/4 creature you control deals 4 combat damage; an opponent\'s 3/1 still deals damage equal to its power', () => {
    let s = setup(['Test Stout Sage', 'Test Living Bulwark'], ['Test Hill Brute']);
    s = attackAndBlock(s, [[one(s, 'Test Living Bulwark')]], []);
    s = toEndOfCombat(s);
    expect(life(s, 'p2')).toBe(16);
    // p2's turn: the opponent's 3/1 deals 3 (its power)
    s = advanceTo(s, 2, 'main1');
    s = declareAttackers(toDeclareAttackers(s), [[one(s, 'Test Hill Brute')]]);
    s = toDeclareBlockers(s);
    s = toEndOfCombat(declareBlockers(s, []));
    expect(life(s, 'p1')).toBe(17);
  });
  it('CR 510.1a, 611.2a: "{1}: Target creature you control assigns combat damage equal to its toughness rather than its power this turn." lasts the turn only', () => {
    let s = setup(['Test Tide Shaper', 'Test Living Bulwark', 'Plains'], []);
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: one(s, 'Test Tide Shaper'), ability: 'p:0:0' }), { targets: [{ kind: 'object', id: one(s, 'Test Living Bulwark') }] });
    s = attackAndBlock(s, [[one(s, 'Test Living Bulwark')]], []);
    s = toEndOfCombat(s);
    expect(life(s, 'p2')).toBe(16);
    s = advanceTo(s, 3, 'main1');
    s = attackAndBlock(s, [[one(s, 'Test Living Bulwark')]], []);
    s = toEndOfCombat(s);
    expect(life(s, 'p2')).toBe(15); // the next turn: its power, 1
  });
});

describe('CR 509.1g, 611.2c: "Whenever ~ becomes blocked, each creature blocking it gets -1/-1 until end of turn."', () => {
  it('CR 509.1g: the creatures blocking it get -1/-1; a creature blocking another attacker does not', () => {
    let s = setup(['Test Rotting Wight', 'Test Mild Bear'], ['Test Mild Bear', 'Test Hill Brute']);
    const wight = one(s, 'Test Rotting Wight');
    const bear = one(s, 'Test Mild Bear', 'p1');
    const theirBear = one(s, 'Test Mild Bear', 'p2');
    const brute = one(s, 'Test Hill Brute');
    s = attackAndBlock(s, [[wight], [bear]], [[theirBear, wight], [brute, bear]]);
    expect(pt(s, theirBear)).toBe('1/1');
    expect(pt(s, brute)).toBe('3/1');
  });
});

describe('CR 506.4, 603.10a: the creatures blocking an attacker that left, and a blocker that died', () => {
  it('CR 506.4: "sacrifice it. If you do, it deals 2 damage to each creature blocking it": the blockers of the sacrificed Goblin are still blocking it', () => {
    let s = setup(['Test Goblin Chief', 'Test Goblin Runt'], ['Test Mild Bear', 'Test Living Bulwark']);
    const runt = one(s, 'Test Goblin Runt');
    const chief = one(s, 'Test Goblin Chief');
    const bear = one(s, 'Test Mild Bear');
    const wall = one(s, 'Test Living Bulwark');
    s = attackAndBlock(s, [[runt], [chief]], [[bear, runt], [wall, chief]]);
    expect(on(s, 'Test Goblin Runt')).toEqual([]);
    expect(on(s, 'Test Mild Bear')).toEqual([]); // 2 damage to the 2/2 that blocked the Runt
    expect(s.objects[wall]!.damage ?? 0).toBe(0); // the wall blocked the Chief, not the Runt
  });
  it('CR 603.10a: "Whenever a creature blocking this creature dies, that creature\'s controller loses 1 life"; a creature blocking another attacker does not count', () => {
    let s = setup(['Test Bane Marauder', 'Test Mild Bear'], ['Test Mild Bear', 'Test Hill Brute']);
    const marauder = one(s, 'Test Bane Marauder');
    const bear = one(s, 'Test Mild Bear', 'p1');
    s = attackAndBlock(s, [[marauder], [bear]], [[one(s, 'Test Mild Bear', 'p2'), marauder], [one(s, 'Test Hill Brute'), bear]]);
    s = toEndOfCombat(s);
    expect(on(s, 'Test Mild Bear', 'p2')).toEqual([]);
    expect(on(s, 'Test Hill Brute')).toEqual([]);
    expect(life(s, 'p2')).toBe(19); // the bear that blocked the Marauder died; the Brute (blocking the other attacker) died too, without a trigger
  });
});

describe('CR 506.2, 508.1b: "~ deals 1 damage to the player or planeswalker that creature is attacking."', () => {
  it('CR 508.1b: the player attacked loses 1 life; a creature attacking a planeswalker damages the planeswalker; a 3/1 does not trigger', () => {
    let s = setup(['Test Ember Bombard', 'Test Mild Bear', 'Test Goblin Runt', 'Test Hill Brute'], ['Test Oath Walker']);
    const walker = one(s, 'Test Oath Walker');
    const loyalty = s.objects[walker]!.counters['loyalty'] ?? 0;
    s = declareAttackers(toDeclareAttackers(s), [[one(s, 'Test Mild Bear'), 'p2'], [one(s, 'Test Goblin Runt'), walker], [one(s, 'Test Hill Brute'), 'p2']]);
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(19);
    expect(s.objects[walker]!.counters['loyalty'] ?? 0).toBe(loyalty - 1);
  });
});

describe('CR 506.3, 115.1: "Exile this creature and target creature without flying that\'s attacking you."', () => {
  it('CR 506.3: only a creature attacking you (the player) without flying is a legal target (not one attacking your planeswalker, not a flier); both are exiled', () => {
    let s = setup(['Test Oath Walker', 'Test Pit Spider'], ['Test Mild Bear', 'Test Hill Brute', 'Test Sky Finch']);
    s = advanceTo(s, 2, 'main1');
    const bear = one(s, 'Test Mild Bear');
    const brute = one(s, 'Test Hill Brute');
    const finch = one(s, 'Test Sky Finch');
    s = declareAttackers(toDeclareAttackers(s), [[bear, 'p1'], [brute, one(s, 'Test Oath Walker')], [finch, 'p1']]);
    s = resolveAll(s);
    for (let k = 0; k < 10 && s.pending?.player !== 'p1'; k++) s = pass(s);
    const spider = one(s, 'Test Pit Spider');
    s = act(s, { type: 'activate', player: 'p1', source: spider, ability: 'p:0:0' });
    expect(s.pending?.kind).toBe('chooseTargets');
    expect((s.pending as { objects: ObjectId[] }).objects).toEqual([bear]);
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] }));
    expect(on(s, 'Test Pit Spider')).toEqual([]);
    expect(on(s, 'Test Mild Bear')).toEqual([]);
    expect(on(s, 'Test Hill Brute')).toHaveLength(1);
    expect(s.zones.exile.length).toBe(2);
  });
});

describe('CR 601.3, 506.1: casting only during combat on your turn, only during the declare blockers step', () => {
  it('CR 601.3: "Cast this spell only during combat on your turn." can\'t be cast in your main phase or in an opponent\'s combat; it can in your combat', () => {
    let s = setup(['Test Mild Bear'], ['Test Mild Bear'], ['Test War Rally']);
    const rally = find(s, 'Test War Rally', 'hand', 'p1');
    expect(reject(s, { type: 'cast', player: 'p1', card: rally }).rules.join(' ')).toMatch(/601/);
    s = toStep(s, 'beginCombat');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: rally }));
    expect(pt(s, one(s, 'Test Mild Bear', 'p1'))).toBe('3/2');
  });
  it('CR 601.3: "Cast this spell only during the declare blockers step." can\'t be cast while attackers are declared; it can once blockers are', () => {
    let s = setup(['Test Mild Bear'], ['Test Hill Brute'], ['Test Sudden Snare']);
    const snare = find(s, 'Test Sudden Snare', 'hand', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[one(s, 'Test Mild Bear')]]);
    expect(s.turn.step).toBe('declareAttackers');
    expect(() => act(s, { type: 'cast', player: 'p1', card: snare })).toThrow();
    s = toDeclareBlockers(s);
    s = declareBlockers(s, [[one(s, 'Test Hill Brute'), one(s, 'Test Mild Bear')]]);
    for (let k = 0; k < 5 && s.pending?.player !== 'p1'; k++) s = pass(s);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: snare }), { targets: [{ kind: 'object', id: one(s, 'Test Hill Brute') }] });
    expect(on(s, 'Test Hill Brute')).toEqual([]);
  });
});

describe('CR 509.1g-h: "blocked by ~" and "blocking or blocked by ~"', () => {
  it('CR 509.1g-h: "At end of combat, destroy all creatures blocking or blocked by this creature.": the blocker of it dies, another blocker does not', () => {
    let s = setup(['Test Frost Beast', 'Test Hill Brute'], ['Test Mild Bear', 'Test Living Bulwark']);
    const beast = one(s, 'Test Frost Beast');
    const brute = one(s, 'Test Hill Brute');
    s = attackAndBlock(s, [[beast], [brute]], [[one(s, 'Test Mild Bear'), beast], [one(s, 'Test Living Bulwark'), brute]]);
    s = toEndOfCombat(s);
    s = resolveAll(s);
    expect(on(s, 'Test Mild Bear')).toEqual([]);
    expect(on(s, 'Test Living Bulwark')).toHaveLength(1);
    expect(on(s, 'Test Frost Beast')).toHaveLength(1);
  });
  it('CR 509.1g-h, 702.15: "Creatures blocking or blocked by this creature have lifelink.": its blocker has lifelink while blocking it, not before', () => {
    let s = setup(['Test Mild Bear'], ['Test Alms Ox']);
    const ox = one(s, 'Test Alms Ox');
    const bear = one(s, 'Test Mild Bear');
    expect(getChars(s, bear)!.keywords.some((k) => k.keyword === 'lifelink')).toBe(false);
    s = attackAndBlock(s, [[bear]], [[ox, bear]]);
    expect(getChars(s, bear)!.keywords.some((k) => k.keyword === 'lifelink')).toBe(true);
    s = toEndOfCombat(s);
    expect(life(s, 'p1')).toBe(22);
  });
  it('CR 506.4, 603.10a: "When this creature dies, destroy all creatures blocking or blocked by it.": its blocker (still a blocking creature) is destroyed after it left; a blocker of another attacker is not', () => {
    let s = setup(['Test Vengeful Martyr', 'Test Hill Brute'], ['Test Mild Bear', 'Test Living Bulwark']);
    const martyr = one(s, 'Test Vengeful Martyr');
    s = attackAndBlock(s, [[martyr], [one(s, 'Test Hill Brute')]], [[one(s, 'Test Mild Bear'), martyr], [one(s, 'Test Living Bulwark'), one(s, 'Test Hill Brute')]]);
    s = resolveAll(toEndOfCombat(s));
    expect(on(s, 'Test Vengeful Martyr')).toEqual([]);
    expect(on(s, 'Test Mild Bear')).toEqual([]); // 1 combat damage to a 2/2: destroyed by the trigger
    expect(on(s, 'Test Living Bulwark')).toHaveLength(1);
  });
  it('CR 506.4, 603.10a: a blocker that dies first: "destroy all creatures blocking or blocked by it" destroys the attacker it blocked', () => {
    let s = setup(['Test Living Bulwark'], ['Test Vengeful Martyr']);
    const wall = one(s, 'Test Living Bulwark');
    s = attackAndBlock(s, [[wall]], [[one(s, 'Test Vengeful Martyr'), wall]]);
    s = resolveAll(toEndOfCombat(s));
    expect(on(s, 'Test Vengeful Martyr')).toEqual([]);
    expect(on(s, 'Test Living Bulwark')).toEqual([]);
  });
  it('CR 509.1h: "{0}: Exile all creatures blocked by this creature.": the attacker it blocks, not another attacker', () => {
    let s = setup(['Test Mild Bear', 'Test Hill Brute'], ['Test Net Wall']);
    const bear = one(s, 'Test Mild Bear');
    s = attackAndBlock(s, [[bear], [one(s, 'Test Hill Brute')]], [[one(s, 'Test Net Wall'), bear]]);
    for (let k = 0; k < 5 && s.pending?.player !== 'p2'; k++) s = pass(s);
    s = resolveAll(act(s, { type: 'activate', player: 'p2', source: one(s, 'Test Net Wall'), ability: 'p:0:1' }));
    expect(on(s, 'Test Mild Bear')).toEqual([]);
    expect(on(s, 'Test Hill Brute')).toHaveLength(1);
  });
});

describe('CR 509.1c: "All creatures block each combat if able."', () => {
  it('CR 509.1c: a creature that could block must; declaring no blockers is refused', () => {
    let s = setup(['Test Mild Bear'], ['Test Hill Brute', 'Test Grand Brawl']);
    s = declareAttackers(toDeclareAttackers(s), [[one(s, 'Test Mild Bear')]]);
    s = toDeclareBlockers(s);
    expect(() => declareBlockers(s, [])).toThrow(/509\.1c/);
    s = declareBlockers(s, [[one(s, 'Test Hill Brute'), one(s, 'Test Mild Bear')]]);
    expect(s.combat?.blockers.length).toBe(1);
  });
});
