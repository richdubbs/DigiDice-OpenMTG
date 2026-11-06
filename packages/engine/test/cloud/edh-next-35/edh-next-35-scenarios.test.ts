/**
 * Commander lane edh-next, round edh-next-35: the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory and unverified (cloud session, no rules/cr).
 *
 *   CR 607.2a, 110.2a, 400.7                "When ~ dies, put all cards exiled with it onto the battlefield." (Underworld Sentinel)
 *   CR 607.2a, 603.4, 701.21a               "At the beginning of each end step, if you control no creatures, sacrifice this enchantment and return all cards exiled with it to the battlefield under your control." (Promise of Tomorrow)
 *   CR 102.3, 810.1, 603.2                  "Whenever ~ or another Warrior your team controls enters, ..." and "Knights your team controls have flying and haste." (Thrasher Brute, Khorvath Brightflame)
 *   CR 508.1h, 122.1                        "~ can't attack unless you pay {1} for each +1/+1 counter on it." (Phyrexian Marauder)
 *   CR 702.33a, 120.3, 608.2b               "If ~ was kicked, it deals damage equal to that permanent's mana value to target creature." (Orim's Thunder)
 *   CR 601.2b, 608.2h, 119.3                "Target player loses 2 life plus 2 life for each Spirit sacrificed this way. You gain that much life." (Devouring Greed)
 *   CR 106.4, 601.2h, 502.3                 "If {S} was spent to cast this spell, that permanent doesn't untap during its controller's next untap step." (Berg Strider)
 *   CR 608.2c, 701.21a                      "Target player sacrifices a land of their choice. Each player sacrifices all lands they control instead if C." (Epicenter)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/index';
import { attackTaxes } from '../../../src/statics/combat-tax';
import { advanceTo, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { activate, cast, drive, resolveAll, target } from '../../m5/cr-examples/helpers';
import { card, full } from '../cmd3/helpers';
import { act, cast as cast2, lifeOf, named, obj, resolveAll as resolveAll2 } from '../r4-cost/support';

const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onBf = (s: GameState, name: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p));
const inYard = (s: GameState, name: string, p = 'p1'): ObjectId[] => (s.zones.graveyard[p] ?? []).filter((id) => nameOf(s, id) === name);
const inExile = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => nameOf(s, id) === name);

const act2 = (s: GameState, name: string): GameState => act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const WOLF = card('Test Wolf', 'Creature — Wolf', '', ['3', '3']);

// ---- "When ~ dies, put all cards exiled with it onto the battlefield." ------------------------------------------------------------------------------------------------------
const WARDEN = card('Test Warden', 'Creature — Spirit', '{0}: Exile target creature card from your graveyard.\nWhen ~ dies, put all cards exiled with it onto the battlefield.', ['2', '2']);
describe('CR 607.2a, 110.2a, 400.7: "When ~ dies, put all cards exiled with it onto the battlefield."', () => {
  it('is automated', () => expect(full(WARDEN)).toBe(true));
  it('every card it exiled comes back under its controller\'s control when it dies; nothing else in exile does', () => {
    let s = scenario([], { defs: [WARDEN, DOOM, BEAR, WOLF], p1: { battlefield: ['Test Warden'], graveyard: ['Test Bear', 'Test Wolf'], hand: ['Test Doom'] }, p2: { exile: ['Test Bear'] } });
    const warden = onBf(s, 'Test Warden')[0]!;
    s = resolveAll(activate(s, warden, [target(inYard(s, 'Test Bear')[0]!)]));
    s = resolveAll(activate(s, warden, [target(inYard(s, 'Test Wolf')[0]!)]));
    expect(inExile(s, 'Test Bear').length).toBe(2);
    expect(inExile(s, 'Test Wolf').length).toBe(1);
    s = resolveAll(cast(s, 'Test Doom', [target(warden)]));
    expect(onBf(s, 'Test Warden').length).toBe(0);
    expect(onBf(s, 'Test Bear', 'p1').length).toBe(1);
    expect(onBf(s, 'Test Wolf', 'p1').length).toBe(1);
    expect(inExile(s, 'Test Bear').length).toBe(1); // the card the opponent owns that was never exiled with it
  });
  it('negative: a card another Warden exiled stays in exile', () => {
    let s = scenario([], { defs: [WARDEN, DOOM, BEAR, WOLF], p1: { battlefield: ['Test Warden', 'Test Warden'], graveyard: ['Test Bear', 'Test Wolf'], hand: ['Test Doom'] } });
    const [a, b] = onBf(s, 'Test Warden') as [ObjectId, ObjectId];
    s = resolveAll(activate(s, a, [target(inYard(s, 'Test Bear')[0]!)]));
    s = resolveAll(activate(s, b, [target(inYard(s, 'Test Wolf')[0]!)]));
    s = resolveAll(cast(s, 'Test Doom', [target(a)]));
    expect(onBf(s, 'Test Bear', 'p1').length).toBe(1);
    expect(inExile(s, 'Test Wolf').length).toBe(1);
    expect(onBf(s, 'Test Wolf').length).toBe(0);
  });
});

// ---- Promise of Tomorrow: exile what dies, return it when you control no creatures ------------------------------------------------------------------------------------------
const PROMISE = card('Test Vow', 'Enchantment', 'Whenever a creature you control dies, exile it.\nAt the beginning of each end step, if you control no creatures, sacrifice this enchantment and return all cards exiled with it to the battlefield under your control.');
describe('CR 607.2a, 603.4, 701.21a: "... if you control no creatures, sacrifice this enchantment and return all cards exiled with it to the battlefield under your control."', () => {
  it('is automated', () => expect(full(PROMISE)).toBe(true));
  it('creatures that died are exiled, and at the end step with no creature the Vow is sacrificed and they all return under your control', () => {
    let s = scenario([], { defs: [PROMISE, DOOM, BEAR, WOLF], p1: { battlefield: ['Test Vow', 'Test Bear', 'Test Wolf'], hand: ['Test Doom', 'Test Doom'] } });
    s = resolveAll(cast(s, 'Test Doom', [target(onBf(s, 'Test Bear')[0]!)]));
    expect(inExile(s, 'Test Bear').length).toBe(1);
    s = resolveAll(cast(s, 'Test Doom', [target(onBf(s, 'Test Wolf')[0]!)]));
    expect(inExile(s, 'Test Wolf').length).toBe(1);
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s);
    expect(onBf(s, 'Test Vow').length).toBe(0);
    expect(onBf(s, 'Test Bear', 'p1').length).toBe(1);
    expect(onBf(s, 'Test Wolf', 'p1').length).toBe(1);
  });
  it('negative: with a creature still under your control at the end step nothing is sacrificed or returned (intervening if)', () => {
    let s = scenario([], { defs: [PROMISE, DOOM, BEAR, WOLF], p1: { battlefield: ['Test Vow', 'Test Bear', 'Test Wolf'], hand: ['Test Doom'] } });
    s = resolveAll(cast(s, 'Test Doom', [target(onBf(s, 'Test Bear')[0]!)]));
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s);
    expect(onBf(s, 'Test Vow').length).toBe(1);
    expect(inExile(s, 'Test Bear').length).toBe(1);
  });
  it('negative: an opponent\'s creature that dies is not exiled (only creatures you control)', () => {
    let s = scenario([], { defs: [PROMISE, DOOM, BEAR], p1: { battlefield: ['Test Vow'], hand: ['Test Doom'] }, p2: { battlefield: ['Test Bear'] } });
    s = resolveAll(cast(s, 'Test Doom', [target(onBf(s, 'Test Bear')[0]!)]));
    expect(inExile(s, 'Test Bear').length).toBe(0);
    expect(inYard(s, 'Test Bear', 'p2').length).toBe(1);
  });
});

// ---- "your team" is you: Thrasher Brute, Khorvath Brightflame --------------------------------------------------------------------------------------------------------------
const TASKMASTER = card('Test Taskmaster', 'Creature — Orc Warrior', 'Whenever ~ or another Warrior your team controls enters, target opponent loses 1 life and you gain 1 life.', ['2', '2']);
const RECRUIT = card('Test Recruit', 'Creature — Human Warrior', '', ['1', '1']);
const GRUNT = card('Test Grunt', 'Creature — Goblin', '', ['1', '1']);
describe('CR 102.3, 810.1, 603.2: "Whenever ~ or another Warrior your team controls enters, target opponent loses 1 life and you gain 1 life." (no teams: your team is you)', () => {
  it('is automated', () => expect(full(TASKMASTER)).toBe(true));
  it('another Warrior entering under your control drains the opponent; the Taskmaster itself entering does too', () => {
    let s = scenario([], { defs: [TASKMASTER, RECRUIT, GRUNT], p1: { hand: ['Test Recruit', 'Test Taskmaster'] } });
    s = resolveAll2(cast2(s, 'Test Taskmaster'), { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([21, 19]);
    s = resolveAll2(cast2(s, 'Test Recruit'), { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([22, 18]);
  });
  it('negative: a creature that is not a Warrior, and a Warrior an opponent controls, do not trigger it', () => {
    let s = scenario([], { defs: [TASKMASTER, RECRUIT, GRUNT], p1: { hand: ['Test Grunt'], battlefield: ['Test Taskmaster'] }, p2: { hand: ['Test Recruit'] } });
    s = resolveAll2(cast2(s, 'Test Grunt'), { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([20, 20]);
    s = advanceTo(s, 2, 'main1');
    s = resolveAll2(cast2(s, 'Test Recruit', {}, 'p2'), { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([20, 20]);
  });
});
const BANNER = card('Test Banner', 'Enchantment', 'Knights your team controls have flying and haste.');
const KNIGHT = card('Test Knight', 'Creature — Human Knight', '', ['2', '2']);
describe('CR 102.3, 810.1, 613.1f: "Knights your team controls have flying and haste."', () => {
  it('is automated', () => expect(full(BANNER)).toBe(true));
  it('your Knights have flying and haste; an opponent\'s Knight and your non-Knight do not', () => {
    const s = scenario([], { defs: [BANNER, KNIGHT, GRUNT], p1: { battlefield: ['Test Banner', 'Test Knight', 'Test Grunt'] }, p2: { battlefield: ['Test Knight'] } });
    const mine = onBf(s, 'Test Knight', 'p1')[0]!;
    expect(hasKeyword(getChars(s, mine)!, 'flying')).toBe(true);
    expect(hasKeyword(getChars(s, mine)!, 'haste')).toBe(true);
    expect(hasKeyword(getChars(s, onBf(s, 'Test Knight', 'p2')[0]!)!, 'flying')).toBe(false);
    expect(hasKeyword(getChars(s, onBf(s, 'Test Grunt')[0]!)!, 'flying')).toBe(false);
  });
});

// ---- Phyrexian Marauder: "can't attack unless you pay {1} for each +1/+1 counter on it" -------------------------------------------------------------------------------------
const MARAUDER = card('Test Raider', 'Artifact Creature — Construct', 'This creature can\'t block.\nThis creature can\'t attack unless you pay {1} for each +1/+1 counter on it.', ['2', '2']);
describe('CR 508.1h, 122.1: "~ can\'t attack unless you pay {1} for each +1/+1 counter on it."', () => {
  it('is automated', () => expect(full(MARAUDER)).toBe(true));
  it('with three +1/+1 counters attacking costs {3}; with none it costs {0}; other kinds of counters count nothing', () => {
    const mk = (counters: Record<string, number>) => scenario([], { defs: [MARAUDER, BEAR], p1: { battlefield: [{ name: 'Test Raider', counters }, 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const s3 = mk({ '+1/+1': 3 });
    expect(attackTaxes(s3, [{ attacker: onBf(s3, 'Test Raider')[0]!, defender: 'p2' }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 3 }] }]);
    const s0 = mk({ charge: 2 });
    expect(attackTaxes(s0, [{ attacker: onBf(s0, 'Test Raider')[0]!, defender: 'p2' }]).map((x) => x.cost)).toEqual([{ mana: [{ kind: 'generic', amount: 0 }] }]);
  });
  it('negative: another creature, yours or the opponent\'s, attacks free', () => {
    const s = scenario([], { defs: [MARAUDER, BEAR], p1: { battlefield: [{ name: 'Test Raider', counters: { '+1/+1': 2 } }, 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    expect(attackTaxes(s, [{ attacker: onBf(s, 'Test Bear', 'p1')[0]!, defender: 'p2' }])).toEqual([]);
  });
});

// ---- Orim's Thunder: the kicked spell deals damage equal to the destroyed permanent's mana value ---------------------------------------------------------------------------------
const REND = card('Test Rend', 'Instant', 'Kicker {0}\nDestroy target artifact or enchantment. If this spell was kicked, it deals damage equal to that permanent\'s mana value to target creature.');
const IDOL = card('Test Idol', 'Artifact', '', undefined, '{3}');
const SMASH = card('Test Smash', 'Instant', 'Destroy target artifact.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['5', '5']);
describe('CR 702.33a, 120.3, 608.2b: "Destroy target artifact or enchantment. If this spell was kicked, it deals damage equal to that permanent\'s mana value to target creature."', () => {
  it('is automated', () => expect(full(REND)).toBe(true));
  it('kicked: the artifact is destroyed and the creature is dealt damage equal to its mana value (3)', () => {
    const s0 = scenario([], { defs: [REND, IDOL, OGRE], p1: { hand: ['Test Rend'] }, p2: { battlefield: ['Test Idol', 'Test Ogre'] } });
    const s = resolveAll2(cast2(s0, 'Test Rend', { yes: [true], targets: [[obj(named(s0, 'Test Idol')[0]!)], [obj(named(s0, 'Test Ogre')[0]!)]] }));
    expect(named(s, 'Test Idol')).toEqual([]);
    expect(s.objects[named(s, 'Test Ogre')[0]!]!.damage).toBe(3);
  });
  it('negative: not kicked, only the artifact is destroyed and nothing is damaged', () => {
    const s0 = scenario([], { defs: [REND, IDOL, OGRE], p1: { hand: ['Test Rend'] }, p2: { battlefield: ['Test Idol', 'Test Ogre'] } });
    const s = resolveAll2(cast2(s0, 'Test Rend', { yes: [false], targets: [[obj(named(s0, 'Test Idol')[0]!)]] }));
    expect(named(s, 'Test Idol')).toEqual([]);
    expect(s.objects[named(s, 'Test Ogre')[0]!]!.damage ?? 0).toBe(0);
  });
  it('negative (ruling 2022-12-08): kicked, but the artifact is an illegal target as the spell resolves: its mana value is not determined and no damage is dealt, although the creature is still a legal target', () => {
    const s0 = scenario([], { defs: [REND, IDOL, OGRE, SMASH], p1: { hand: ['Test Rend'] }, p2: { hand: ['Test Smash'], battlefield: ['Test Idol', 'Test Ogre'] } });
    let s = cast2(s0, 'Test Rend', { yes: [true], targets: [[obj(named(s0, 'Test Idol')[0]!)], [obj(named(s0, 'Test Ogre')[0]!)]] });
    s = pass(s);
    s = cast2(s, 'Test Smash', { targets: [[obj(named(s0, 'Test Idol')[0]!)]] }, 'p2');
    s = resolveAll2(s);
    expect(named(s, 'Test Idol')).toEqual([]);
    expect(s.objects[named(s, 'Test Ogre')[0]!]!.damage ?? 0).toBe(0);
  });
});

// ---- Devouring Greed: N life plus N for each Spirit sacrificed as the additional cost -----------------------------------------------------------------------------------------
const GREED = card('Test Greed', 'Sorcery — Arcane', 'As an additional cost to cast this spell, you may sacrifice any number of Spirits.\nTarget player loses 2 life plus 2 life for each Spirit sacrificed this way. You gain that much life.');
const SPIRIT = card('Test Spirit', 'Creature — Spirit', '', ['1', '1']);
describe('CR 601.2b, 608.2h, 119.3: "Target player loses 2 life plus 2 life for each Spirit sacrificed this way. You gain that much life."', () => {
  it('is automated', () => expect(full(GREED)).toBe(true));
  it('sacrificing two Spirits: the target loses 2 + 2 x 2 = 6 life and you gain 6', () => {
    const s0 = scenario([], { defs: [GREED, SPIRIT, BEAR], p1: { hand: ['Test Greed'], battlefield: ['Test Spirit', 'Test Spirit', 'Test Bear'] } });
    const spirits = onBf(s0, 'Test Spirit');
    const s = resolveAll2(cast2(s0, 'Test Greed', { yes: [true], x: [2], objects: [spirits], targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(onBf(s, 'Test Spirit').length).toBe(0);
    expect(onBf(s, 'Test Bear').length).toBe(1);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([26, 14]);
  });
  it('negative: sacrificing none (declining the optional cost), the target loses just 2 and you gain 2', () => {
    const s0 = scenario([], { defs: [GREED, SPIRIT, BEAR], p1: { hand: ['Test Greed'], battlefield: ['Test Spirit', 'Test Bear'] } });
    const s = resolveAll2(cast2(s0, 'Test Greed', { yes: [false], targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(onBf(s, 'Test Spirit').length).toBe(1);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([22, 18]);
  });
  it('sacrificing one of two Spirits (the one chosen): 2 + 2 = 4, and the other Spirit stays', () => {
    const s0 = scenario([], { defs: [GREED, SPIRIT, BEAR], p1: { hand: ['Test Greed'], battlefield: ['Test Spirit', 'Test Spirit'] } });
    const [a, b] = onBf(s0, 'Test Spirit') as [ObjectId, ObjectId];
    const s = resolveAll2(cast2(s0, 'Test Greed', { yes: [true], x: [1], objects: [[a]], targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(onBf(s, 'Test Spirit')).toEqual([b]);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([24, 16]);
  });
  it('negative: only Spirits may be sacrificed to it (the Bear is not counted: at most one with one Spirit and one Bear)', () => {
    const s0 = scenario([], { defs: [GREED, SPIRIT, BEAR], p1: { hand: ['Test Greed'], battlefield: ['Test Spirit', 'Test Bear'] } });
    let s = act2(s0, 'Test Greed');
    s = answer(s, { kind: 'yesNo', yes: true });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    expect(s.pending?.kind).toBe('chooseNumber');
    expect((s.pending as unknown as { max: number }).max).toBe(1);
  });
});

// ---- Berg Strider: "If {S} was spent to cast this spell" ------------------------------------------------------------------------------------------------------------------
const GIANT = card('Test Giant', 'Snow Creature — Giant', 'When this creature enters, tap target creature an opponent controls. If {S} was spent to cast this spell, that creature doesn\'t untap during its controller\'s next untap step.', ['3', '3'], '{1}');
describe('CR 106.4, 601.2h, 502.3: "If {S} was spent to cast this spell, that creature doesn\'t untap during its controller\'s next untap step."', () => {
  it('is automated', () => expect(full(GIANT)).toBe(true));
  const game = (land: string) => scenario(['Snow-Covered Forest', 'Forest'], { defs: [GIANT, BEAR], p1: { hand: ['Test Giant'], battlefield: [land] }, p2: { battlefield: ['Test Bear'] } });
  it('snow mana spent: the tapped creature stays tapped through its controller\'s next untap step, and untaps in the one after', () => {
    const s0 = game('Snow-Covered Forest');
    const bear = onBf(s0, 'Test Bear')[0]!;
    let s = resolveAll2(cast2(s0, 'Test Giant', { targets: [[obj(bear)]] }), { targets: [[obj(bear)]] });
    expect(s.objects[bear]!.tapped).toBe(true);
    s = advanceTo(s, 2, 'upkeep');
    expect(s.objects[bear]!.tapped).toBe(true);
    s = advanceTo(s, 4, 'upkeep');
    expect(s.objects[bear]!.tapped).toBe(false);
  });
  it('negative: mana from a land that is not snow was spent: the creature is tapped but untaps normally', () => {
    const s0 = game('Forest');
    const bear = onBf(s0, 'Test Bear')[0]!;
    let s = resolveAll2(cast2(s0, 'Test Giant', { targets: [[obj(bear)]] }), { targets: [[obj(bear)]] });
    expect(s.objects[bear]!.tapped).toBe(true);
    s = advanceTo(s, 2, 'upkeep');
    expect(s.objects[bear]!.tapped).toBe(false);
  });
});

// ---- Epicenter: the sacrifice of every player's lands replaces the target player's sacrifice ----------------------------------------------------------------------------------
const QUAKE = card('Test Quake', 'Sorcery', 'Target player sacrifices a land of their choice.\nThreshold \u2014 Each player sacrifices all lands they control instead if there are seven or more cards in your graveyard.');
describe('CR 608.2c, 701.21a: "Target player sacrifices a land of their choice. Each player sacrifices all lands they control instead if there are seven or more cards in your graveyard."', () => {
  it('is automated', () => expect(full(QUAKE)).toBe(true));
  const game = (yard: number) => scenario(['Plains', 'Swamp'], { defs: [QUAKE], p1: { hand: ['Test Quake'], battlefield: ['Plains', 'Plains'], graveyard: Array(yard).fill('Plains') }, p2: { battlefield: ['Swamp', 'Swamp', 'Swamp'] } });
  it('fewer than seven cards in your graveyard: only the target player sacrifices one land of their choice', () => {
    const s0 = game(6);
    const s = resolveAll2(cast2(s0, 'Test Quake', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(onBf(s, 'Swamp').length).toBe(2);
    expect(onBf(s, 'Plains').length).toBe(2);
  });
  it('seven or more cards in your graveyard: every player sacrifices all their lands (the target\'s choice does not matter)', () => {
    const s0 = game(7);
    const s = resolveAll2(cast2(s0, 'Test Quake', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(onBf(s, 'Swamp').length).toBe(0);
    expect(onBf(s, 'Plains').length).toBe(0);
  });
});
