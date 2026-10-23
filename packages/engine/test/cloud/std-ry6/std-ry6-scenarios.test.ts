/**
 * std-ry6 (wave 2, Commander lane ry6): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 115.1, 701.6a-b   "Whenever ~ becomes the target of a spell or ability for the first time each turn, counter that spell or ability": a spell and an activated
 *                        ability that target it are countered the first time; the second targeting in the turn is not
 *   CR 115.1, 109.5      "that spell or ability's controller sacrifices a land": the controller of what targeted it (the opponent), not the permanent's controller
 *   CR 303.4b, 115.1     "destroy target enchanted creature": only a creature with an Aura attached is a legal target
 *   CR 506.5             "~ can't attack alone" / "~ can't block alone": refused alone, allowed together with another creature
 *   CR 701.17a, 608.2h   "Mill a card, then draw cards equal to the milled card's mana value": the mana value of the card the mill put into the graveyard
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, DecisionAnswer, GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, answer, find, legal, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { card, full, inYard, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const hand = (s: GameState, player: string): number => s.zones.hand[player]!.length;
const lands = (s: GameState, player: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player && s.objects[id]!.defId === 'Plains').length;

const KEEPER = card('Test Keeper', 'Creature — Sphinx', 'Whenever this creature becomes the target of a spell or ability for the first time each turn, counter that spell or ability.', ['2', '2']);
const RUNNER = card('Test Runner', 'Creature — Lizard', "Whenever this creature becomes the target of a spell or ability, that spell or ability's controller sacrifices a land of their choice.", ['2', '2']);
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const PINGER = card('Test Pinger', 'Artifact', '{T}: Put a +1/+1 counter on target creature.');
const HUNTER = card('Test Hunter', 'Creature — Human', '{T}: Destroy target enchanted creature.', ['1', '1']);
const WARD = card('Test Ward', 'Enchantment — Aura', 'Enchant creature');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const LONER = card('Test Loner', 'Creature — Beast', "This creature can't attack alone.", ['4', '4']);
const SHIRKER = card('Test Shirker', 'Creature — Giant', "This creature can't block alone.", ['4', '4']);
const MISTS = card('Test Mists', 'Sorcery', "Mill a card, then draw cards equal to the milled card's mana value.");
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{2}{R}');
const PEBBLE = card('Test Pebble', 'Artifact', '');
const DEFS: CardDef[] = [KEEPER, RUNNER, SMITE, PINGER, HUNTER, WARD, BEAR, LONER, SHIRKER, MISTS, OGRE, PEBBLE];

/** Activate the first ability of `object` with these targets and resolve the stack. */
function activate(s: GameState, object: ObjectId, targets: TargetChoice[], player = 'p1'): GameState {
  const a = legal(s, player, 'activate').find((x) => (x.action as { source?: ObjectId }).source === object);
  if (a === undefined) throw new Error(`no activation of ${object}`);
  return settle(act(s, a.action), { targets });
}

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 115.1, 701.6a-b: "counter that spell or ability" (what targeted the object, the first time each turn)', () => {
  it('a spell that targets it is countered; the second spell that targets it this turn is not', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Smite', 'Test Smite'], battlefield: ['Test Keeper'] }, defs: DEFS });
    const keeper = find(s, 'Test Keeper', 'battlefield');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1![0]! }), { targets: [obj(keeper)] }));
    expect(s.zones.battlefield).toContain(keeper);
    expect(inYard(s, 'Test Smite')).toBe(true);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1![0]! }), { targets: [obj(keeper)] }));
    expect(s.zones.battlefield).not.toContain(keeper);
  });
  it('an activated ability that targets it is countered (CR 701.6b): no counter is put on it', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Keeper', 'Test Pinger'] }, defs: DEFS });
    const keeper = find(s, 'Test Keeper', 'battlefield');
    s = resolveAll(activate(s, find(s, 'Test Pinger', 'battlefield'), [obj(keeper)]));
    expect(s.objects[keeper]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(s.zones.stack).toEqual([]);
  });
});

describe('CR 115.1, 109.5: "that spell or ability\'s controller sacrifices a land of their choice"', () => {
  it('the opponent who targeted the creature sacrifices a land; its controller keeps theirs', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Runner', 'Plains', 'Plains'] }, p2: { hand: ['Test Smite'], battlefield: ['Plains', 'Plains'] }, defs: DEFS });
    const runner = find(s, 'Test Runner', 'battlefield');
    s = pass(s); // p2 gets priority in p1's main phase
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Smite', 'hand', 'p2') }), { targets: [obj(runner)] });
    const p1Lands = lands(s, 'p1');
    const p2Lands = lands(s, 'p2');
    s = resolveAll(s);
    expect(lands(s, 'p2')).toBe(p2Lands - 1);
    expect(lands(s, 'p1')).toBe(p1Lands);
  });
});

describe('CR 303.4b, 115.1: "destroy target enchanted creature"', () => {
  it('only the creature with an Aura attached is offered as a target; it is destroyed', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Ward'], battlefield: ['Test Hunter', 'Test Bear', 'Test Ogre'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ward', 'hand') }), { targets: [obj(bear)] }));
    const a = legal(s, 'p1', 'activate').find((x) => (x.action as { source?: ObjectId }).source === find(s, 'Test Hunter', 'battlefield'))!;
    const d = act(s, a.action).pending;
    if (d?.kind !== 'chooseTargets') throw new Error(`no target choice: ${d?.kind}`);
    expect(d.objects).toEqual([bear]);
    expect(d.objects).not.toContain(ogre);
    s = resolveAll(activate(s, find(s, 'Test Hunter', 'battlefield'), [obj(bear)]));
    expect(s.zones.battlefield).not.toContain(bear);
    expect(s.zones.battlefield).toContain(ogre);
  });
});

describe('CR 506.5: "~ can\'t attack alone" and "~ can\'t block alone"', () => {
  const attackAnswer = (ids: ObjectId[]): DecisionAnswer => ({ kind: 'declareAttackers', attacks: ids.map((attacker) => ({ attacker, defender: 'p2' })) });
  it('attacking alone is refused; attacking together with another creature is allowed', () => {
    const s0 = toDeclareAttackers(scenario([], { p1: { battlefield: ['Test Loner', 'Test Bear'] }, defs: DEFS }));
    const loner = find(s0, 'Test Loner', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const d = s0.pending;
    if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
    expect(d.candidates.find((c) => c.id === loner)!.onlyWithOthers).toBe(true);
    const err = reject(s0, { type: 'answer', player: 'p1', decisionId: d.id, answer: attackAnswer([loner]) });
    expect(err.rules).toContain('CR 506.5');
    const s = answer(s0, attackAnswer([loner, bear]));
    expect(s.combat!.attackers.map((a) => a.id).sort()).toEqual([loner, bear].sort());
  });
  it('it may still block alone (only attacking is restricted)', () => {
    const base = scenario([], { p1: { battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Loner'] }, defs: DEFS });
    const ogre = find(base, 'Test Ogre', 'battlefield');
    let s = passUntil(declareAttackers(toDeclareAttackers(base), [[ogre]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    s = declareBlockers(s, [[find(s, 'Test Loner', 'battlefield'), ogre]]);
    expect(s.combat!.attackers[0]!.blockedBy).toEqual([find(s, 'Test Loner', 'battlefield')]);
  });
  it('blocking alone is refused; blocking together with another creature is allowed; it may attack alone', () => {
    const base = scenario([], { p1: { battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Shirker', 'Test Bear'] }, defs: DEFS });
    const ogre = find(base, 'Test Ogre', 'battlefield');
    let s = passUntil(declareAttackers(toDeclareAttackers(base), [[ogre]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    const shirker = find(s, 'Test Shirker', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    const d = s.pending;
    if (d?.kind !== 'declareBlockers') throw new Error('no declareBlockers');
    const err = reject(s, { type: 'answer', player: 'p2', decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: shirker, attacker: ogre }] } });
    expect(err.rules).toContain('CR 506.5');
    s = declareBlockers(s, [[shirker, ogre], [bear, ogre]]);
    expect(s.combat!.attackers[0]!.blockedBy.sort()).toEqual([shirker, bear].sort());
    const t0 = toDeclareAttackers(scenario([], { p1: { battlefield: ['Test Shirker'] }, defs: DEFS }));
    const t = answer(t0, attackAnswer([find(t0, 'Test Shirker', 'battlefield')]));
    expect(t.combat!.attackers.length).toBe(1);
  });
});

describe('CR 701.17a, 608.2h: "draw cards equal to the milled card\'s mana value"', () => {
  it('the card milled has mana value 3: three cards are drawn', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Mists'], library: ['Test Ogre'] }, defs: DEFS });
    const before = hand(s, 'p1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mists', 'hand') })));
    expect(inYard(s, 'Test Ogre')).toBe(true);
    expect(hand(s, 'p1')).toBe(before - 1 + 3);
  });
  it('the card milled has mana value 0: nothing is drawn', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Mists'], library: ['Test Pebble'] }, defs: DEFS });
    const before = hand(s, 'p1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mists', 'hand') })));
    expect(inYard(s, 'Test Pebble')).toBe(true);
    expect(hand(s, 'p1')).toBe(before - 1);
  });
});
