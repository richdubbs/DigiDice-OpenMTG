/**
 * std-ry8 (wave 2, Commander lane ry8): the round's engine changes played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 701.43a, 508.1, 603.12  "You may exert ~ as it attacks. When you do, ...": the choice is made as attackers are declared; the reflexive trigger
 *   CR 701.43a                 "Whenever you exert a creature": the exert as it attacks and the exert cost both trigger it
 *   CR 702.154a                enlist: tap a nonattacking creature without summoning sickness; the attacker gets +X/+0, X the tapped creature's power
 *   CR 702.112a-b              renown N: combat damage to a player, if it isn't renowned: N +1/+1 counters and it becomes renowned (once)
 *   CR 702.117a-b              surge: the alternative cost only after you cast another spell this turn; "if its surge cost was paid"
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, life, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { card, counters, full, pt, resolveAll, settle } from '../cmd3/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const BRAWLER = card('Test Exert Brawler', 'Creature — Human Warrior', 'You may exert this creature as it attacks. When you do, it gets +2/+2 until end of turn.', ['2', '2']);
const CAPTAIN = card('Test Exert Captain', 'Creature — Jackal Warrior', 'You may exert this creature as it attacks.\nWhenever you exert a creature, you gain 2 life.', ['1', '1']);
const HEALER = card('Test Exert Healer', 'Creature — Human Cleric', '{T}, Exert this creature: You gain 1 life.', ['1', '1']);
const KNIGHT = card('Test Enlist Knight', 'Creature — Human Knight', 'Enlist (As this creature attacks, you may tap a nonattacking creature you control without summoning sickness. When you do, add its power to this creature\'s until end of turn.)', ['2', '2']);
const SQUIRE = card('Test Renown Squire', 'Creature — Human Soldier', 'Renown 2 (When this creature deals combat damage to a player, if it isn\'t renowned, put two +1/+1 counters on it and it becomes renowned.)\nAs long as this creature is renowned, it has flying.', ['1', '1']);
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
const BRUTE = card('Test Surge Brute', 'Creature — Ogre', 'Surge {1} (You may cast this spell for its surge cost if you or a teammate has cast another spell this turn.)\nWhen this creature enters, if its surge cost was paid, you gain 4 life.', ['3', '3'], '{5}');
const BLAZE = card('Test Surge Blaze', 'Instant', 'Surge {X}{R} (You may cast this spell for its surge cost if you or a teammate has cast another spell this turn.)\nTest Surge Blaze deals X damage to any target.', undefined, '{X}{R}{R}{R}');
const ZENDIKON = card('Test Mire Zendikon', 'Enchantment — Aura', 'Enchant land\nEnchanted land is a 3/3 black Ooze creature with deathtouch. It\'s still a land.');
const BANNER = card('Test Renown Banner', 'Enchantment', 'Attacking creatures you control have renown 1.');
const DEFS: CardDef[] = [BEAR, BRAWLER, CAPTAIN, HEALER, KNIGHT, SQUIRE, SPARK, BRUTE, BLAZE, ZENDIKON, BANNER];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

/** Declare these attackers (p1 attacks p2) and return the state right after the declaration (the attack options asked, if any). */
const attack = (s: GameState, names: string[]): GameState => declareAttackers(toDeclareAttackers(s), names.map((n) => [find(s, n, 'battlefield', 'p1')] as [ObjectId]));
const choose = (s: GameState, ids: ObjectId[]): GameState => answer(s, { kind: 'chooseObjects', ids });

describe('CR 701.43a, 508.1, 603.12: "You may exert ~ as it attacks. When you do, ..."', () => {
  it('CR 701.43a, 603.12: exerted as it attacks, the reflexive trigger pumps it; it does not untap during its controller\'s next untap step', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Exert Brawler'] }, defs: DEFS });
    const brawler = find(s, 'Test Exert Brawler', 'battlefield', 'p1');
    s = attack(s, ['Test Exert Brawler']);
    expect(s.pending?.kind).toBe('chooseObjects');
    s = choose(s, [brawler]);
    s = resolveAll(s);
    expect(pt(s, brawler)).toBe('4/4');
    s = advanceTo(s, 3, 'upkeep'); // p1's next turn: its untap step is over
    expect(s.objects[brawler]!.tapped).toBe(true);
    s = advanceTo(s, 5, 'upkeep');
    expect(s.objects[brawler]!.tapped).toBe(false);
  });
  it('CR 701.43a: not exerted, there is no trigger and it untaps as usual', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Exert Brawler'] }, defs: DEFS });
    const brawler = find(s, 'Test Exert Brawler', 'battlefield', 'p1');
    s = choose(attack(s, ['Test Exert Brawler']), []);
    expect(s.zones.stack).toHaveLength(0);
    expect(pt(s, brawler)).toBe('2/2');
    s = advanceTo(s, 3, 'upkeep');
    expect(s.objects[brawler]!.tapped).toBe(false);
  });
  it('CR 508.1: only creatures that attack are offered (a creature with the ability that stays home is not)', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Exert Brawler', 'Test Bear'] }, defs: DEFS });
    s = attack(s, ['Test Bear']);
    expect(s.pending?.kind).not.toBe('chooseObjects');
  });
});

describe('CR 701.43a: "Whenever you exert a creature"', () => {
  it('CR 701.43a, 603.2: exerting as it attacks triggers it', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Exert Captain'] }, defs: DEFS });
    const l0 = life(s, 'p1');
    s = choose(attack(s, ['Test Exert Captain']), [find(s, 'Test Exert Captain', 'battlefield', 'p1')]);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(l0 + 2);
  });
  it('CR 701.43a: declining to exert does not trigger it', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Exert Captain'] }, defs: DEFS });
    const l0 = life(s, 'p1');
    s = resolveAll(choose(attack(s, ['Test Exert Captain']), []));
    expect(life(s, 'p1')).toBe(l0);
  });
  it('CR 701.43a, 118.3: an exert paid as a cost ("{T}, Exert ~:") triggers it too', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Exert Captain', 'Test Exert Healer'] }, defs: DEFS });
    const l0 = life(s, 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Exert Healer', 'battlefield', 'p1'), ability: 'p:0:0' }));
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(l0 + 3);
  });
});

describe('CR 702.154a: enlist', () => {
  it('CR 702.154a: tapping a nonattacking creature without summoning sickness adds its power to the attacker\'s until end of turn', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Enlist Knight', 'Test Bear'] }, defs: DEFS });
    const knight = find(s, 'Test Enlist Knight', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = attack(s, ['Test Enlist Knight']);
    expect((s.pending as { options?: ObjectId[] }).options).toEqual([bear]);
    s = resolveAll(choose(s, [bear]));
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(pt(s, knight)).toBe('5/2');
  });
  it('CR 702.154a, 302.6: a summoning-sick creature and an attacking creature are not offered', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Enlist Knight', { name: 'Test Bear', since: 1 }, 'Test Exert Healer'] }, defs: DEFS });
    s = attack(s, ['Test Enlist Knight', 'Test Exert Healer']);
    expect(s.pending?.kind).not.toBe('chooseObjects'); // the sick Bear and the attacking Healer are the only other creatures
  });
  it('CR 702.154a: declining taps nothing and adds nothing', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Enlist Knight', 'Test Bear'] }, defs: DEFS });
    const knight = find(s, 'Test Enlist Knight', 'battlefield', 'p1');
    s = resolveAll(choose(attack(s, ['Test Enlist Knight']), []));
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.tapped).toBe(false);
    expect(pt(s, knight)).toBe('2/2');
  });
});

describe('CR 702.112a-b: renown', () => {
  const hit = (s0: GameState, block: boolean): GameState => {
    let s = attack(s0, ['Test Renown Squire']);
    if (block) {
      s = toDeclareBlockers(s);
      s = declareBlockers(s, [[find(s, 'Test Bear', 'battlefield', 'p2'), find(s, 'Test Renown Squire', 'battlefield', 'p1')]]);
    }
    for (let i = 0; i < 20 && s.turn.step !== 'endCombat'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    return resolveAll(s);
  };
  it('CR 702.112a-b: combat damage to a player puts N +1/+1 counters on it and it becomes renowned ("as long as ~ is renowned")', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Renown Squire'] }, defs: DEFS });
    const squire = find(s, 'Test Renown Squire', 'battlefield', 'p1');
    s = hit(s, false);
    expect(counters(s, squire, '+1/+1')).toBe(2);
    expect(s.objects[squire]!.renowned).toBe(true);
    expect(hasKeyword(getChars(s, squire)!, 'flying')).toBe(true);
  });
  it('CR 702.112a, 603.4: a renowned creature dealing combat damage to a player again gets no more counters', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Renown Squire'] }, defs: DEFS });
    const squire = find(s, 'Test Renown Squire', 'battlefield', 'p1');
    s.objects[squire]!.renowned = true;
    s = hit(s, false);
    expect(counters(s, squire, '+1/+1')).toBe(0);
  });
  it('CR 702.112a, 613.1f: renown granted to attacking creatures works like a printed one (Aragorn, Hornburg Hero\'s grant)', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Bear', 'Test Renown Banner'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[bear]]);
    for (let i = 0; i < 20 && s.turn.step !== 'endCombat'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    s = resolveAll(s);
    expect(counters(s, bear, '+1/+1')).toBe(1);
    expect(s.objects[bear]!.renowned).toBe(true);
  });
  it('CR 702.112a: combat damage to a blocking creature only is not renown', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Renown Squire'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = hit(s, true);
    expect(findAll(s, 'Test Renown Squire', 'battlefield')).toHaveLength(0); // it died to the 3/3
    expect(findAll(s, 'Test Renown Squire', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 702.117a-b: surge', () => {
  it('CR 702.117a: with no other spell cast this turn, the surge cost is not offered', () => {
    const s = scenario(['Plains'], { p1: { battlefield: ['Plains'], hand: ['Test Surge Brute'] }, defs: DEFS });
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Surge Brute', 'hand', 'p1'), method: 'surge' });
  });
  it('CR 702.117a-b: after another spell, it is cast for its surge cost, and "if its surge cost was paid" holds', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Plains'], hand: ['Test Surge Brute', 'Test Spark'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') })));
    const l0 = life(s, 'p1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Surge Brute', 'hand', 'p1'), method: 'surge' })));
    expect(findAll(s, 'Test Surge Brute', 'battlefield', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(l0 + 4);
  });
  it('CR 702.117b: cast for its mana cost, "if its surge cost was paid" does not hold', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Surge Brute', 'Test Spark'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') })));
    const l0 = life(s, 'p1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Surge Brute', 'hand', 'p1') })));
    expect(findAll(s, 'Test Surge Brute', 'battlefield', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(l0);
  });
  it('CR 702.117a, 107.3: a surge cost with {X}: X is announced and paid with the surge cost', () => {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Mountain', 'Mountain', 'Mountain'], hand: ['Test Surge Blaze', 'Test Spark'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') })));
    const l0 = life(s, 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Surge Blaze', 'hand', 'p1'), method: 'surge' });
    for (let g = 0; g < 10 && s.pending?.kind !== 'priority'; g++) {
      const d = s.pending!;
      if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 2 });
      else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      else s = settle(s);
    }
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(l0 - 2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length).toBe(3);
  });
});

describe('CR 303.4, 205.1b, 613.1d-f: "Enchanted land is a 3/3 black Ooze creature with deathtouch. It\'s still a land."', () => {
  it('CR 205.1b, 613.1d: the enchanted land becomes a 3/3 black Ooze creature with deathtouch and keeps its land type, subtypes and mana ability', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Forest'], hand: ['Test Mire Zendikon'] }, defs: DEFS });
    const forest = find(s, 'Forest', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mire Zendikon', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending?.kind !== 'priority'; g++) s = s.pending?.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: forest }] }) : settle(s);
    s = resolveAll(s);
    const c = getChars(s, forest)!;
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Forest', 'Ooze']));
    expect(c.colors).toEqual(['B']);
    expect(hasKeyword(c, 'deathtouch')).toBe(true);
    expect(pt(s, forest)).toBe('3/3');
  });
  it('CR 303.4: an Aura that does not enchant the land changes nothing (another land stays a land only)', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Forest', 'Forest'], hand: ['Test Mire Zendikon'] }, defs: DEFS });
    const [a, b] = findAll(s, 'Forest', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mire Zendikon', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending?.kind !== 'priority'; g++) s = s.pending?.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: a! }] }) : settle(s);
    s = resolveAll(s);
    expect(getChars(s, b!)!.types).toEqual(['Land']);
  });
});
