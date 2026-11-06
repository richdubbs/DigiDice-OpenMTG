/**
 * Must-finish round edh-next-141 (mana and costs, EDHREC ranks 5,001-10,000; code edhn141): the round's readings played through the engine with synthetic cards compiled
 * by the game's default compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites checked against the
 * Comprehensive Rules text of 2026-09-25 (MagicCompRules 20260925.txt).
 *
 *   CR 601.2f, 118.7, 202.3        "Noncreature spells your opponents cast with mana value 4 or greater cost {2} more to cast." (Reidane, God of the Worthy)
 *   CR 615.1, 615.7, 120.1         "If a source an opponent controls would deal damage to you or a permanent you control, prevent 1 of that damage." (Valkmira, Protector's Shield)
 *   CR 115.1, 603.2, 118.12        "Whenever you or another permanent you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless
 *                                  its controller pays {1}." (Valkmira, Protector's Shield)
 *   CR 614.15, 608.2c, 608.2d      "target creature gains your choice of first strike or vigilance until end of turn. If that creature is equipped, it gains first strike and vigilance
 *                                  until end of turn instead." (Éowyn, Lady of Rohan)
 *   CR 207.2d, 701.3d, 601.2b,     "Throw ... -- {3}, Unattach an Equipment from ~: He deals damage equal to that Equipment's mana value divided as you choose among one, two, or three
 *   601.2d, 608.2h                 targets." / "... Catch -- At the beginning of combat on your turn, attach up to one target Equipment you control to ~." (Captain America, First Avenger)
 *   CR 106.4, 500.5, 119.3         "A player losing unspent mana causes that player to lose that much life." (Yurlok of Scorch Thrash)
 *   CR 613.1f, 608.2h, 611.2c,     "each Horror you control gains all activated abilities of target artifact an opponent controls until end of turn. You may spend blue mana as though
 *   609.4b                         it were mana of any color to activate those abilities." (Grell Philosopher)
 *   CR 613.1f, 702.85a, 202.3,     "During your turn, spells you cast from your hand with mana value X or less have cascade, where X is the total amount of life your opponents have
 *   119.3                          lost this turn." (Abaddon the Despoiler)
 *   CR 601.2f, 702.37c, 708.4,     "{T}: The next face-down creature spell you cast this turn costs {3} less to cast." / "If turning a face-down permanent face up causes a triggered
 *   603.2d, 702.37e                ability of a permanent you control to trigger, that ability triggers an additional time." (Panoptic Projektor)
 */
import { describe, expect, it } from 'vitest';
import type { DecisionAnswer, GameState, TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, legal, pass, passBoth } from '../../m3/scenario';
import { activations, card, cast, drive, find, full, lifeOf, resolveAll, scenario } from '../r3-cost/support';
import { putFaceDown, turnUp } from '../../m6/face-down/support';

const at = (id: string): TargetChoice => ({ kind: 'object', id });
const player = (id: 'p1' | 'p2'): TargetChoice => ({ kind: 'player', id });
const yard = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => s.objects[id]!.defId);
const castable = (s: GameState, p: 'p1' | 'p2', name: string): boolean => legal(s, p, 'cast').some((a) => (a as { object?: string }).object === find(s, name, 'hand', p));

// ---- Reidane, God of the Worthy ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2f, 118.7, 202.3: "Noncreature spells your opponents cast with mana value 4 or greater cost {2} more to cast."', () => {
  const GOD = card('Test Worthy God', 'Legendary Creature — God', 'Flying, vigilance\nNoncreature spells your opponents cast with mana value 4 or greater cost {2} more to cast.', '{2}{W}', ['3', '2']);
  const BIG = card('Test Big Blast', 'Instant', 'Test Big Blast deals 4 damage to any target.', '{3}{R}');
  const SMALL = card('Test Small Blast', 'Instant', 'Test Small Blast deals 3 damage to any target.', '{2}{R}');
  const BEAST = card('Test Flash Beast', 'Creature — Beast', 'Flash', '{3}{R}', ['4', '4']);
  const defs = [GOD, BIG, SMALL, BEAST];
  const game = (lands: number, godFor: 'p1' | 'p2' = 'p1'): GameState => {
    const s0 = scenario(['Mountain'], { defs, [godFor]: { battlefield: ['Test Worthy God'] }, ...(godFor === 'p1' ? { p2: { hand: ['Test Big Blast', 'Test Small Blast', 'Test Flash Beast'], battlefield: Array<string>(lands).fill('Mountain') } } : {}) } as never);
    return pass(s0); // p2 gets priority in p1's main phase
  };
  it('is full', () => expect(full(GOD), JSON.stringify(GOD.automation)).toBe(true));
  it('an opponent\'s noncreature spell of mana value 4 costs {2} more: four lands are not enough, six are', () => {
    expect(castable(game(4), 'p2', 'Test Big Blast')).toBe(false);
    expect(castable(game(5), 'p2', 'Test Big Blast')).toBe(false);
    expect(castable(game(6), 'p2', 'Test Big Blast')).toBe(true);
  });
  it('negative: a noncreature spell of mana value 3 and a creature spell of mana value 4 cost what they cost', () => {
    const s = game(4);
    expect(castable(s, 'p2', 'Test Small Blast')).toBe(true);
    expect(castable(s, 'p2', 'Test Flash Beast')).toBe(true);
  });
  it('negative: the controller\'s own spells are not taxed ("your opponents")', () => {
    const s0 = scenario(['Mountain'], { defs, p1: { battlefield: ['Test Worthy God', 'Mountain', 'Mountain', 'Mountain', 'Mountain'], hand: ['Test Big Blast'] } });
    expect(castable(s0, 'p1', 'Test Big Blast')).toBe(true);
  });
});

// ---- Valkmira, Protector's Shield ------------------------------------------------------------------------------------------------------------------------------
describe('CR 615.1, 615.7, 120.1: "If a source an opponent controls would deal damage to you or a permanent you control, prevent 1 of that damage."', () => {
  const SHIELD = card('Test Ward Shield', 'Legendary Artifact', 'If a source an opponent controls would deal damage to you or a permanent you control, prevent 1 of that damage.', '{3}{W}');
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to any target.', '{R}');
  const BEAR = card('Test Guard Bear', 'Creature — Bear', '', '{1}{G}', ['2', '3']);
  const defs = [SHIELD, BOLT, BEAR];
  const game = (): GameState => scenario(['Mountain'], { defs, p1: { battlefield: ['Test Ward Shield', 'Test Guard Bear', 'Mountain'], hand: ['Test Spark'] }, p2: { battlefield: ['Mountain', 'Mountain'], hand: ['Test Spark'] } });
  it('is full', () => expect(full(SHIELD), JSON.stringify(SHIELD.automation)).toBe(true));
  it('an opponent\'s spell deals 3 to you: 1 is prevented (you lose 2); to your creature: it is dealt 2 and survives', () => {
    let s = resolveAll(cast(pass(game()), 'Test Spark', { targets: [[player('p1')]] }, 'p2'));
    expect(lifeOf(s, 'p1')).toBe(18);
    const s1 = game();
    const bear = find(s1, 'Test Guard Bear', 'battlefield', 'p1');
    s = resolveAll(cast(pass(s1), 'Test Spark', { targets: [[at(bear)]] }, 'p2'));
    expect(s.objects[bear]!.zone).toBe('battlefield');
    expect(s.objects[bear]!.damage).toBe(2);
  });
  it('negative: your own source is not an opponent\'s: your spell deals all 3 to you; the opponent is not protected', () => {
    let s = resolveAll(cast(game(), 'Test Spark', { targets: [[player('p1')]] }));
    expect(lifeOf(s, 'p1')).toBe(17);
    s = resolveAll(cast(game(), 'Test Spark', { targets: [[player('p2')]] }));
    expect(lifeOf(s, 'p2')).toBe(17);
  });
});

describe('CR 115.1, 603.2, 118.12: "Whenever you or another permanent you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {1}."', () => {
  const SHIELD = card('Test Tax Shield', 'Legendary Artifact', 'Whenever you or another permanent you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {1}.', '{3}{W}');
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to any target.', '{R}');
  const SMASH = card('Test Smash', 'Instant', 'Destroy target artifact.', '{R}');
  const BEAR = card('Test Guard Bear', 'Creature — Bear', '', '{1}{G}', ['2', '3']);
  const defs = [SHIELD, BOLT, SMASH, BEAR];
  const game = (p2lands: number): GameState => scenario(['Mountain'], { defs, p1: { battlefield: ['Test Tax Shield', 'Test Guard Bear', 'Mountain'], hand: ['Test Spark'] }, p2: { battlefield: Array<string>(p2lands).fill('Mountain'), hand: ['Test Spark', 'Test Smash'] } });
  it('is full', () => expect(full(SHIELD), JSON.stringify(SHIELD.automation)).toBe(true));
  it('an opponent targets you and cannot pay {1}: the spell is countered; targeting your creature, paying {1} lets it resolve', () => {
    let s = resolveAll(cast(pass(game(1)), 'Test Spark', { targets: [[player('p1')]] }, 'p2'));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toContain('Test Spark');
    const s1 = game(2);
    const bear = find(s1, 'Test Guard Bear', 'battlefield', 'p1');
    s = resolveAll(cast(pass(s1), 'Test Spark', { targets: [[at(bear)]] }, 'p2'), { yes: [true, true, true] });
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Guard Bear');
  });
  it('negative: targeting the shield itself ("another") and your own spell targeting you do not trigger', () => {
    const s1 = game(1);
    const shield = find(s1, 'Test Tax Shield', 'battlefield', 'p1');
    let s = cast(pass(s1), 'Test Smash', { targets: [[at(shield)]] }, 'p2');
    expect(s.zones.stack.length).toBe(1);
    s = resolveAll(s);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Tax Shield');
    const t = cast(game(1), 'Test Spark', { targets: [[player('p1')]] });
    expect(t.zones.stack.length).toBe(1);
    expect(lifeOf(resolveAll(t), 'p1')).toBe(17);
  });
});

// ---- Éowyn, Lady of Rohan --------------------------------------------------------------------------------------------------------------------------------------
describe('CR 614.15, 608.2c, 608.2d: "target creature gains your choice of first strike or vigilance until end of turn. If that creature is equipped, it gains first strike and vigilance until end of turn instead."', () => {
  const LADY = card('Test Shield Lady', 'Legendary Creature — Human Noble', 'At the beginning of combat on your turn, target creature gains your choice of first strike or vigilance until end of turn. If that creature is equipped, it gains first strike and vigilance until end of turn instead.', '{1}{R}{W}', ['3', '3']);
  const BLADE = card('Test Plain Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {1}', '{1}');
  const BEAR = card('Test Guard Bear', 'Creature — Bear', '', '{1}{G}', ['2', '3']);
  const defs = [LADY, BLADE, BEAR];
  const kw = (s: GameState, id: string): string[] => ['first strike', 'vigilance'].filter((k) => hasKeyword(getChars(s, id)!, k));
  const combat = (equipped: boolean, pick?: string): { s: GameState; bear: string } => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Shield Lady', 'Test Guard Bear', 'Test Plain Blade'] } });
    const bear = find(s0, 'Test Guard Bear', 'battlefield', 'p1');
    if (equipped) s0.objects[find(s0, 'Test Plain Blade', 'battlefield', 'p1')]!.attachedTo = bear;
    let s = advanceTo(s0, 1, 'beginCombat');
    s = drive(s, { targets: [[at(bear)]] });
    s = resolveAll(s, { targets: [[at(bear)]], ...(pick !== undefined ? { options: [[pick]] } : {}) });
    return { s, bear };
  };
  it('is full', () => expect(full(LADY), JSON.stringify(LADY.automation)).toBe(true));
  it('the targeted creature is equipped: it gains both first strike and vigilance, no choice is asked', () => {
    const { s, bear } = combat(true);
    expect(kw(s, bear)).toEqual(['first strike', 'vigilance']);
  });
  it('negative: an unequipped creature gains only the keyword you choose', () => {
    const r = combat(false);
    expect(kw(r.s, r.bear).length).toBe(1);
  });
});

// ---- Captain America, First Avenger -----------------------------------------------------------------------------------------------------------------------------
describe('CR 207.2d, 701.3d, 601.2b, 601.2d: "Throw ... -- {3}, Unattach an Equipment from ~: He deals damage equal to that Equipment\'s mana value divided as you choose among one, two, or three targets."', () => {
  const CAP = card('Test Star Captain', 'Legendary Creature — Human Soldier Hero', 'Throw ... — {3}, Unattach an Equipment from Test Star Captain: He deals damage equal to that Equipment\'s mana value divided as you choose among one, two, or three targets.\n... Catch — At the beginning of combat on your turn, attach up to one target Equipment you control to Test Star Captain.', '{2}{W}', ['4', '4']);
  const HEAVY = card('Test Heavy Shield', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {2}', '{3}');
  const LIGHT = card('Test Light Dagger', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {1}', '{1}');
  const OX = card('Test Field Ox', 'Creature — Ox', '', '{1}{G}', ['2', '4']);
  const defs = [CAP, HEAVY, LIGHT, OX];
  const board = (equip: ('Test Heavy Shield' | 'Test Light Dagger')[]): { s: GameState; cap: string } => {
    const s = scenario(['Mountain'], { defs, p1: { battlefield: ['Test Star Captain', 'Test Heavy Shield', 'Test Light Dagger', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Field Ox', 'Test Field Ox'] } });
    const cap = find(s, 'Test Star Captain', 'battlefield', 'p1');
    for (const e of equip) s.objects[find(s, e, 'battlefield', 'p1')]!.attachedTo = cap;
    return { s, cap };
  };
  const oxen = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Field Ox');
  it('is full', () => expect(full(CAP), JSON.stringify(CAP.automation)).toBe(true));
  it('one Equipment of mana value 3 attached: 3 damage divided among two targets as chosen; the Equipment is unattached and stays on the battlefield', () => {
    const { s: s0 } = board(['Test Heavy Shield']);
    const [a, b] = oxen(s0);
    let s = act(s0, activations(s0, 'Test Star Captain')[0]!.action as never);
    expect(s.pending?.kind).toBe('chooseTargets');
    s = answer(s, { kind: 'chooseTargets', targets: [at(a!), at(b!)] });
    expect(s.pending?.kind).toBe('chooseDivision');
    expect((s.pending as unknown as { total: number }).total).toBe(3);
    s = drive(answer(s, { kind: 'chooseDivision', amounts: [2, 1] } as DecisionAnswer));
    s = resolveAll(s);
    expect(s.objects[a!]!.damage).toBe(2);
    expect(s.objects[b!]!.damage).toBe(1);
    const shield = find(s, 'Test Heavy Shield', 'battlefield', 'p1');
    expect(s.objects[shield]!.attachedTo).toBeUndefined();
  });
  it('two Equipment attached: the one chosen as the ability is announced (CR 601.2b) is the one unattached, and its mana value is the damage; the other stays attached', () => {
    const { s: s0, cap } = board(['Test Heavy Shield', 'Test Light Dagger']);
    const dagger = find(s0, 'Test Light Dagger', 'battlefield', 'p1');
    const [a] = oxen(s0);
    let s = act(s0, activations(s0, 'Test Star Captain')[0]!.action as never);
    expect(s.pending?.kind).toBe('chooseObjects');
    s = drive(s, { objects: [[dagger]], targets: [[at(a!)]] });
    s = resolveAll(s);
    expect(s.objects[a!]!.damage).toBe(1);
    expect(s.objects[dagger]!.attachedTo).toBeUndefined();
    expect(s.objects[find(s, 'Test Heavy Shield', 'battlefield', 'p1')]!.attachedTo).toBe(cap);
  });
  it('negative: with no Equipment attached to it, the ability cannot be activated (the cost cannot be paid)', () => {
    const { s } = board([]);
    expect(() => act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Star Captain', 'battlefield', 'p1'), ability: CAP.faces[0]!.abilities.findIndex((x) => x.kind === 'activated') } as never)).toThrow();
  });
  it('"... Catch": at the beginning of combat on your turn, the targeted Equipment you control is attached to it', () => {
    const { s: s0, cap } = board([]);
    const shield = find(s0, 'Test Heavy Shield', 'battlefield', 'p1');
    let s = advanceTo(s0, 1, 'beginCombat');
    s = resolveAll(drive(s, { targets: [[at(shield)]] }), { targets: [[at(shield)]] });
    expect(s.objects[shield]!.attachedTo).toBe(cap);
  });
});

// ---- Yurlok of Scorch Thrash ------------------------------------------------------------------------------------------------------------------------------------
describe('CR 106.4, 500.5, 119.3: "A player losing unspent mana causes that player to lose that much life."', () => {
  const BURN = card('Test Burn Shaman', 'Legendary Creature — Lizard Shaman', 'Vigilance\nA player losing unspent mana causes that player to lose that much life.\n{1}, {T}: Each player adds {B}{R}{G}.', '{B}{R}{G}', ['4', '4']);
  const KEEP = card('Test Still Pool', 'Enchantment', "Players don't lose unspent mana as steps and phases end.", '{2}{G}');
  const BURN2 = card('Test Burn Acolyte', 'Creature — Lizard Shaman', 'A player losing unspent mana causes that player to lose that much life.', '{2}{R}', ['2', '2']);
  const defs = [BURN, KEEP, BURN2];
  const tapIt = (s0: GameState): GameState => {
    const a = [...activations(s0, 'Test Burn Shaman', true), ...activations(s0, 'Test Burn Shaman')][0]!;
    return resolveAll(drive(act(s0, a.action as never)));
  };
  it('is full', () => expect(full(BURN), JSON.stringify(BURN.automation)).toBe(true));
  it('as the step ends, each player loses 1 life for each unspent mana they lose, at once and without the stack', () => {
    let s = tapIt(scenario(['Mountain'], { defs, p1: { battlefield: ['Test Burn Shaman', 'Mountain'] } }));
    expect(s.players.map((p) => p.manaPool.length)).toEqual([3, 3]);
    s = passBoth(s); // the first main phase ends
    expect(s.turn.step).not.toBe('main1');
    expect(lifeOf(s, 'p1')).toBe(17);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(s.zones.stack.length).toBe(0);
  });
  it('negative: mana spent is not lost; two such rules lose no more life (ruling 2020-11-10)', () => {
    let s = tapIt(scenario(['Mountain'], { defs, p1: { battlefield: ['Test Burn Shaman', 'Test Burn Acolyte', 'Mountain'] } }));
    s = passBoth(s);
    expect(lifeOf(s, 'p1')).toBe(17);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('negative: mana that is kept ("Players don\'t lose unspent mana") is not lost, so no life is lost; without the rule nothing happens', () => {
    let s = tapIt(scenario(['Mountain'], { defs, p1: { battlefield: ['Test Burn Shaman', 'Test Still Pool', 'Mountain'] } }));
    s = passBoth(s);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.players.find((p) => p.id === 'p2')!.manaPool.length).toBe(3);
  });
});

// ---- Grell Philosopher -----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 613.1f, 608.2h, 609.4b: "each Horror you control gains all activated abilities of target artifact an opponent controls until end of turn. You may spend blue mana as though it were mana of any color to activate those abilities."', () => {
  const GRELL = card('Test Grell Thinker', 'Creature — Horror Wizard', 'When this creature enters and at the beginning of your upkeep, each Horror you control gains all activated abilities of target artifact an opponent controls until end of turn. You may spend blue mana as though it were mana of any color to activate those abilities.', '{0}', ['1', '3']);
  const OLD = card('Test Old Horror', 'Creature — Horror', '', '{1}{B}', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
  const RELIC = card('Test Spark Relic', 'Artifact', '{R}, {T}: This artifact deals 1 damage to any target.', '{2}');
  const SMASH = card('Test Smash', 'Instant', 'Destroy target artifact.', '{0}');
  const defs = [GRELL, OLD, BEAR, RELIC, SMASH];
  const game = (lands: string[]): GameState => {
    const s0 = scenario(['Island', 'Plains'], { defs, p1: { hand: ['Test Grell Thinker', 'Test Smash'], battlefield: ['Test Old Horror', 'Test Plain Bear', ...lands] }, p2: { battlefield: ['Test Spark Relic'] } });
    const relic = find(s0, 'Test Spark Relic', 'battlefield', 'p2');
    return resolveAll(cast(s0, 'Test Grell Thinker'), { targets: [[at(relic)]] });
  };
  const usable = (s: GameState, name: string): boolean => activations(s, name).length > 0;
  it('is full', () => expect(full(GRELL), JSON.stringify(GRELL.automation)).toBe(true));
  it('each Horror you control gains the artifact\'s ability (its "this artifact" is the Horror); blue mana pays its {R}', () => {
    const s0 = game(['Island']);
    expect(usable(s0, 'Test Old Horror')).toBe(true);
    let s = act(s0, activations(s0, 'Test Old Horror')[0]!.action as never);
    s = resolveAll(drive(s, { targets: [[player('p2')]] }));
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(s.objects[find(s, 'Test Old Horror', 'battlefield', 'p1')]!.tapped).toBe(true);
    expect(s.objects[find(s, 'Test Spark Relic', 'battlefield', 'p2')]!.tapped).toBe(false);
  });
  it('negative: white mana is not blue (it cannot pay {R}); a creature that is not a Horror gains nothing', () => {
    const s = game(['Plains']);
    expect(usable(s, 'Test Old Horror')).toBe(false);
    expect(usable(s, 'Test Plain Bear')).toBe(false);
  });
  it('the abilities are fixed as the effect begins (CR 608.2h): the artifact leaving afterwards does not take them away; they end with the turn', () => {
    let s = game(['Island']);
    s = resolveAll(cast(s, 'Test Smash', { targets: [[at(find(s, 'Test Spark Relic', 'battlefield', 'p2'))]] }));
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toContain('Test Spark Relic');
    expect(usable(s, 'Test Old Horror')).toBe(true);
    const hasIt = (t: GameState): boolean => getChars(t, find(t, 'Test Old Horror', 'battlefield', 'p1'))!.abilities.some((a) => a.def.kind === 'activated');
    expect(hasIt(s)).toBe(true);
    s = advanceTo(s, 2, 'main1');
    expect(hasIt(s)).toBe(false);
  });
});

// ---- Abaddon the Despoiler -------------------------------------------------------------------------------------------------------------------------------------
describe('CR 613.1f, 702.85a, 202.3: "During your turn, spells you cast from your hand with mana value X or less have cascade, where X is the total amount of life your opponents have lost this turn."', () => {
  const LORD = card('Test Despoiler Lord', 'Legendary Creature — Astartes Warrior', 'Trample\nDuring your turn, spells you cast from your hand with mana value X or less have cascade, where X is the total amount of life your opponents have lost this turn.', '{2}{B}{R}', ['5', '5']);
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to any target.', '{R}');
  const OGRE = card('Test Three Ogre', 'Creature — Ogre', '', '{2}{R}', ['3', '3']);
  const GIANT = card('Test Four Giant', 'Creature — Giant', '', '{3}{R}', ['4', '4']);
  const defs = [LORD, BOLT, OGRE, GIANT];
  const hasCascade = (s: GameState, name: string): boolean => {
    const id = s.zones.stack.find((x) => s.objects[x]!.defId === name);
    return id !== undefined && hasKeyword(getChars(s, id)!, 'cascade');
  };
  const hit = (cardName: string): GameState => {
    const s0 = scenario(['Mountain'], { defs, p1: { battlefield: ['Test Despoiler Lord', ...Array<string>(8).fill('Mountain')], hand: ['Test Spark', cardName] } });
    const s1 = resolveAll(cast(s0, 'Test Spark', { targets: [[player('p2')]] }));
    expect(lifeOf(s1, 'p2')).toBe(17);
    return drive(act(s1, { type: 'cast', player: 'p1', card: find(s1, cardName, 'hand', 'p1') }));
  };
  it('is full', () => expect(full(LORD), JSON.stringify(LORD.automation)).toBe(true));
  it('your opponents lost 3 life this turn: a spell of mana value 3 cast from your hand has cascade', () => {
    const s = hit('Test Three Ogre');
    expect(hasCascade(s, 'Test Three Ogre')).toBe(true);
    expect(s.zones.stack.length).toBe(2); // the spell and its cascade trigger (CR 702.85a)
  });
  it('negative: mana value 4 is more than 3; with no life lost (X = 0) a spell of mana value 3 has no cascade', () => {
    expect(hasCascade(hit('Test Four Giant'), 'Test Four Giant')).toBe(false);
    const s0 = scenario(['Mountain'], { defs, p1: { battlefield: ['Test Despoiler Lord', 'Mountain', 'Mountain', 'Mountain'], hand: ['Test Three Ogre'] } });
    expect(hasCascade(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Three Ogre', 'hand', 'p1') })), 'Test Three Ogre')).toBe(false);
  });
  it('negative: only during your turn ("During your turn"): in an opponent\'s turn, after they lost 3 life, your spell of mana value 1 has no cascade', () => {
    const s0 = scenario(['Mountain'], { defs, p1: { battlefield: ['Test Despoiler Lord', 'Mountain', 'Mountain'], hand: ['Test Spark', 'Test Spark'] } });
    let s = advanceTo(s0, 2, 'main1');
    expect(s.pending?.player).toBe('p2');
    s = resolveAll(cast(pass(s), 'Test Spark', { targets: [[player('p2')]] }));
    expect(lifeOf(s, 'p2')).toBe(17);
    s = drive(act(pass(s), { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') }), { targets: [[player('p2')]] });
    expect(s.zones.stack.length).toBe(1);
    expect(hasCascade(s, 'Test Spark')).toBe(false);
  });
});

// ---- Panoptic Projektor ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2f, 702.37c, 603.2d, 702.37e: "The next face-down creature spell you cast this turn costs {3} less" / "If turning a face-down permanent face up causes a triggered ability ... triggers an additional time"', () => {
  const PROJ = card('Test Mask Lantern', 'Artifact', '{T}: The next face-down creature spell you cast this turn costs {3} less to cast.\nIf turning a face-down permanent face up causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', '{3}');
  const SEER = card('Test Masked Seer', 'Creature — Human Wizard', 'Morph {0}\nWhen this creature is turned face up, draw a card.', '{3}{U}', ['2', '2']);
  const OGRE = card('Test Three Ogre', 'Creature — Ogre', '', '{3}', ['3', '3']);
  const defs = [PROJ, SEER, OGRE];
  const hand = (s: GameState, p: 'p1' | 'p2' = 'p1'): number => s.zones.hand[p]!.length;
  const faceDownCastable = (s: GameState): boolean => legal(s, 'p1', 'cast').some((a) => (a as { object?: string }).object === find(s, 'Test Masked Seer', 'hand', 'p1') && (a as { action?: { method?: string } }).action?.method === 'morph');
  const tap = (s0: GameState): GameState => resolveAll(drive(act(s0, activations(s0, 'Test Mask Lantern')[0]!.action as never)));
  it('is full', () => expect(full(PROJ), JSON.stringify(PROJ.automation)).toBe(true));
  it('after {T}, the next face-down creature spell costs {3} less: with no land it can be cast face down; before, it cannot', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Mask Lantern'], hand: ['Test Masked Seer', 'Test Three Ogre'] } });
    expect(faceDownCastable(s0)).toBe(false);
    const s = tap(s0);
    expect(faceDownCastable(s)).toBe(true);
    expect(castable(s, 'p1', 'Test Three Ogre')).toBe(false); // negative: a face-up creature spell is not the face-down one
    const t = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Masked Seer', 'hand', 'p1'), method: 'morph' } as never));
    expect(t.zones.stack.length).toBe(1);
  });
  it('turning your face-down permanent face up: its "when turned face up" ability triggers twice (you draw two cards)', () => {
    const [s0, id] = putFaceDown(scenario([], { defs, p1: { battlefield: ['Test Mask Lantern'], hand: [] }, p2: {} }), 'p1', 'Test Masked Seer');
    let s = turnUp(s0, id, 'morph');
    expect(s.zones.stack.length).toBe(2);
    s = resolveAll(s);
    expect(hand(s)).toBe(2);
  });
  it('negative: without the artifact it triggers once; an opponent\'s permanent turned face up is not doubled ("a permanent you control")', () => {
    const [s0, id] = putFaceDown(scenario([], { defs, p1: { hand: [] } }), 'p1', 'Test Masked Seer');
    expect(hand(resolveAll(turnUp(s0, id, 'morph')))).toBe(1);
    const [t0, oid] = putFaceDown(scenario([], { defs, p1: { battlefield: ['Test Mask Lantern'] }, p2: { hand: [] } }), 'p2', 'Test Masked Seer');
    const t = turnUp(pass(t0), oid, 'morph', [], 'p2');
    expect(t.zones.stack.length).toBe(1);
    expect(hand(resolveAll(t), 'p2')).toBe(1);
  });
});
