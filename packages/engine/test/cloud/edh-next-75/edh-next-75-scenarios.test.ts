/**
 * Commander lane commander, round edh-next-75: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the default compiler,
 * each with its negative case. CR cites are from memory (unverified) unless the record says otherwise.
 *
 *   CR 903.8, 601.2f     "Your commander costs {1} less to cast for each time it's been cast from the command zone this game." (Myth Unbound)
 *   CR 113.6b, 903.3     "At the beginning of your upkeep, if ~ is in the command zone, you gain 2 life." (Oloro)
 *   CR 408.1, 903.9a     "Put all commanders you own from the command zone and from your graveyard into your hand." (Campfire)
 *   CR 903.3d, 121.1     "Each player may discard their hand and draw cards equal to the greatest mana value of a commander they own on the battlefield or in the command zone." (Imposing Grandeur)
 *   CR 508.1b, 725.1     "Whenever equipped creature attacks the monarch, destroy target tapped nonland permanent that player controls." (The Spear of Bashenga)
 *   CR 309.7, 608.2c     "... if you've completed a dungeon" (Barrowin of Clan Undurr, Rilsa Rael)
 *   CR 725.1, 608.2c     "... get +1/+1 until end of turn if you're the monarch. Otherwise, you become the monarch." (Regal Sliver)
 *   CR 309.4c, 603.2d    "Room abilities of dungeons you own trigger an additional time." (Hama Pashar, Dungeon Delver)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { commanderOnBattlefield, commanderScenario, forests, legend } from '../../m11/rules/helpers';
import { cast, drive, resolveAll, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const castable = (s: GameState, p: 'p1' | 'p2', name: string): boolean => legalActions(s, p).some((l) => l.kind === 'cast' && nameOf(s, l.object!) === name);
const commanderRecOf = (s: GameState, p: 'p1' | 'p2', name: string) => s.players.find((x) => x.id === p)!.commanders!.find((c) => s.defs[c.defId]!.name === name)!;
const YES2: DecisionAnswer[] = [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: true }];
const NO_CMD: DecisionAnswer[] = [{ kind: 'commanderZone', command: false }, { kind: 'commanderZone', command: false }, { kind: 'commanderZone', command: false }]; // CR 903.9b: a commander moving to the hand may go to the command zone instead: not here
const settle = (s0: GameState): GameState => { let s = s0; for (let g = 0; g < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s); return s; };

describe('Myth Unbound (CR 903.8, 601.2f; ruling 2018-07-13: applies after the commander tax): "Your commander costs {1} less to cast for each time it\'s been cast from the command zone this game."', () => {
  const UNBOUND = card('Test Unbinder', 'Enchantment', "Your commander costs {1} less to cast for each time it's been cast from the command zone this game.");
  const CMDR = legend('Test Cmdr', '{2}', ['2', '2'], ['G']);
  const OPP = legend('Test Opp Cmdr', '{2}', ['2', '2'], ['G']);
  const game = (casts: number, forestCount: number, withReducer = true): GameState => tweak(
    commanderScenario({ p1Commanders: [CMDR], p2Commanders: [OPP], defs: [UNBOUND], p1: { battlefield: [...(withReducer ? ['Test Unbinder'] : []), ...forests(forestCount)] } }),
    (t) => { commanderRecOf(t, 'p1', 'Test Cmdr').casts = casts; });
  it('is automated with no manual part', () => expect(noManual(UNBOUND)).toBe(true));
  it('after two casts the tax is {4} on top of {2}; the reduction takes {2} of it: castable with four Forests, not with three', () => {
    expect(castable(game(2, 4), 'p1', 'Test Cmdr')).toBe(true);
    expect(castable(game(2, 3), 'p1', 'Test Cmdr')).toBe(false);
  });
  it('negative: without the reducer the same commander needs all six', () => {
    expect(castable(game(2, 4, false), 'p1', 'Test Cmdr')).toBe(false);
    expect(castable(game(2, 6, false), 'p1', 'Test Cmdr')).toBe(true);
  });
  it('one earlier cast: {2} + {2} tax - {1} = {3}; no earlier cast: {2}, nothing reduced (the cast in progress is not counted)', () => {
    expect(castable(game(1, 3), 'p1', 'Test Cmdr')).toBe(true);
    expect(castable(game(1, 2), 'p1', 'Test Cmdr')).toBe(false);
    expect(castable(game(0, 2), 'p1', 'Test Cmdr')).toBe(true);
    expect(castable(game(0, 1), 'p1', 'Test Cmdr')).toBe(false);
  });
  it("negative: the opponent's commander is not \"your commander\": it costs full price", () => {
    const s = tweak(commanderScenario({ p1Commanders: [CMDR], p2Commanders: [OPP], defs: [UNBOUND], p1: { battlefield: ['Test Unbinder'] }, p2: { battlefield: forests(3) } }), (t) => { commanderRecOf(t, 'p2', 'Test Opp Cmdr').casts = 2; t.turn.activePlayer = 'p2'; });
    expect(legalActions(s, 'p2').some((l) => l.kind === 'cast' && nameOf(s, l.object!) === 'Test Opp Cmdr')).toBe(false);
  });
});

describe('Oloro (CR 113.6b, 603.4): "At the beginning of your upkeep, if ~ is in the command zone, you gain 2 life."', () => {
  const OLORO = legend('Test Ascetic', '{3}', ['3', '3'], ['W'], 'At the beginning of your upkeep, if ~ is in the command zone, you gain 2 life.');
  const OPP = legend('Test Opp Cmdr', '{2}', ['2', '2'], ['G']);
  const atUpkeep = (s: GameState): GameState => settle(advanceTo(s, 3, 'upkeep'));
  it('is automated with no manual part and functions in the command zone only', () => {
    expect(noManual(OLORO)).toBe(true);
    const t = JSON.stringify(OLORO.faces[0]!.abilities);
    expect(t).toContain('"zone":["command"]');
  });
  it('in the command zone it triggers at your upkeep: +2 life', () => {
    const base = commanderScenario({ p1Commanders: [OLORO], p2Commanders: [OPP] });
    expect(life(atUpkeep(base), 'p1') - life(base, 'p1')).toBe(2); // (the scenario already passed the first upkeep, which gained 2 too)
  });
  it('negative: on the battlefield it does not trigger (the ability functions only in the command zone)', () => {
    const s0 = commanderScenario({ p1Commanders: [OLORO], p2Commanders: [OPP], p1: { battlefield: ['Test Ascetic'] } });
    expect(life(atUpkeep(commanderOnBattlefield(s0, 'Test Ascetic')), 'p1')).toBe(life(s0, 'p1'));
  });
  it("negative: the opponent's upkeep does not count (\"your upkeep\")", () => {
    const base = commanderScenario({ p1Commanders: [OLORO], p2Commanders: [OPP] });
    const s = settle(advanceTo(base, 2, 'upkeep'));
    expect(life(s, 'p1')).toBe(life(base, 'p1'));
  });
});

describe('Campfire (CR 408.1, 903.9a): "Put all commanders you own from the command zone and from your graveyard into your hand."', () => {
  const SWEEP = card('Test Recall', 'Instant', 'Put all commanders you own from the command zone and from your graveyard into your hand.');
  const A = legend('Test Cmdr A', '{2}', ['2', '2'], ['G'], 'Partner');
  const B = legend('Test Cmdr B', '{2}', ['2', '2'], ['G'], 'Partner');
  const OPP = legend('Test Opp Cmdr', '{2}', ['2', '2'], ['G']);
  const base = (): GameState => commanderScenario({ p1Commanders: [A, B], p2Commanders: [OPP], defs: [SWEEP], p1: { hand: ['Test Recall'] } });
  const toGraveyard = (s: GameState, name: string): GameState => tweak(s, (t) => {
    const id = t.zones.command.find((x) => nameOf(t, x) === name)!;
    t.zones.command = t.zones.command.filter((x) => x !== id);
    t.objects[id]!.zone = 'graveyard';
    t.zones.graveyard['p1']!.push(id);
  });
  it('is automated with no manual part', () => expect(noManual(SWEEP)).toBe(true));
  it("both of your commanders (one in the command zone, one in the graveyard) go to your hand; the opponent's commander stays in the command zone", () => {
    const s0 = toGraveyard(base(), 'Test Cmdr B');
    const s = resolveAll(cast(s0, 'Test Recall'), NO_CMD);
    const hand = s.zones.hand['p1']!.map((id) => nameOf(s, id));
    expect(hand).toContain('Test Cmdr A');
    expect(hand).toContain('Test Cmdr B');
    expect(s.zones.command.map((id) => nameOf(s, id))).toEqual(['Test Opp Cmdr']);
  });
  it('negative: a commander on the battlefield is not moved', () => {
    const s0 = commanderOnBattlefield(commanderScenario({ p1Commanders: [A, B], p2Commanders: [OPP], defs: [SWEEP], p1: { hand: ['Test Recall'], battlefield: ['Test Cmdr A'] } }), 'Test Cmdr A');
    const s = resolveAll(cast(s0, 'Test Recall'), NO_CMD);
    expect(s.zones.battlefield.map((id) => nameOf(s, id))).toContain('Test Cmdr A');
    expect(s.zones.hand['p1']!.map((id) => nameOf(s, id))).toContain('Test Cmdr B');
  });
});

describe('Imposing Grandeur (CR 903.3d, 121.1): "Each player may discard their hand and draw cards equal to the greatest mana value of a commander they own on the battlefield or in the command zone."', () => {
  const WHEEL = card('Test Grand Wheel', 'Sorcery', 'Each player may discard their hand and draw cards equal to the greatest mana value of a commander they own on the battlefield or in the command zone.');
  const MINE = legend('Test Cmdr Three', '{3}', ['2', '2'], ['G']);
  const THEIRS = legend('Test Cmdr Five', '{5}', ['2', '2'], ['G']);
  it('is automated with no manual part', () => expect(noManual(WHEEL)).toBe(true));
  it('each player draws as many cards as the mana value of their own commander (3 and 5), after discarding their hand', () => {
    const s0 = commanderScenario({ p1Commanders: [MINE], p2Commanders: [THEIRS], defs: [WHEEL], p1: { hand: ['Test Grand Wheel', 'Forest'] }, p2: { hand: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'] } });
    const s = resolveAll(cast(s0, 'Test Grand Wheel'), YES2);
    expect(handSize(s, 'p1')).toBe(3);
    expect(handSize(s, 'p2')).toBe(5);
  });
  it('negative: a player with no commander (a commander in the graveyard counts nothing) draws none', () => {
    const s0 = commanderScenario({ p1Commanders: [MINE], p2Commanders: [THEIRS], defs: [WHEEL], p1: { hand: ['Test Grand Wheel'] }, p2: { hand: ['Forest', 'Forest'] } });
    const t = tweak(s0, (x) => { const id = x.zones.command.find((c) => nameOf(x, c) === 'Test Cmdr Five')!; x.zones.command = x.zones.command.filter((c) => c !== id); x.objects[id]!.zone = 'graveyard'; x.zones.graveyard['p2']!.push(id); });
    const s = resolveAll(cast(t, 'Test Grand Wheel'), YES2);
    expect(handSize(s, 'p2')).toBe(0);
    expect(handSize(s, 'p1')).toBe(3);
  });
  it('negative: outside a Commander game nobody has a commander: both draw nothing', () => {
    const s0 = scenario([], { defs: [WHEEL], p1: { hand: ['Test Grand Wheel', 'Plains'] }, p2: { hand: ['Plains', 'Plains'] } });
    const s = resolveAll(cast(s0, 'Test Grand Wheel'), YES2);
    expect(handSize(s, 'p1')).toBe(0);
    expect(handSize(s, 'p2')).toBe(0);
  });
});

describe('The Spear of Bashenga (CR 508.1b, 725.1): "Whenever ~ attacks the monarch, destroy target tapped nonland permanent that player controls."', () => {
  const RAIDER = card('Test Raider', 'Creature — Soldier', 'Whenever ~ attacks the monarch, destroy target tapped nonland permanent that player controls.', { pt: ['2', '2'] });
  const BEAR = card('Test Tapped Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const setup = (monarch: 'p2' | undefined): GameState => tweak(scenario([], { defs: [RAIDER, BEAR], p1: { battlefield: ['Test Raider'] }, p2: { battlefield: ['Test Tapped Bear'] } }), (t) => {
    if (monarch) t.designations.monarch = monarch;
    t.zones.battlefield.forEach((id) => { if (nameOf(t, id) === 'Test Tapped Bear') t.objects[id]!.tapped = true; });
  });
  const attack = (s0: GameState): GameState => {
    let s = toDeclareAttackers(s0);
    const raider = find(s, 'Test Raider', 'battlefield', 'p1');
    s = declareAttackers(s, [[raider, 'p2']]);
    return s;
  };
  it('is automated with no manual part', () => expect(noManual(RAIDER)).toBe(true));
  it('attacking the monarch: the trigger destroys the tapped nonland permanent of the player attacked', () => {
    let s = attack(setup('p2'));
    expect(s.zones.stack.length + (s.pending ? 1 : 0)).toBeGreaterThan(0);
    expect(s.pending?.kind).toBe('chooseTargets');
    const legalTargets = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(legalTargets.map((id) => nameOf(s, id))).toEqual(['Test Tapped Bear']); // the tapped nonland permanent of the monarch attacked, nothing of the attacker's
    s = settle(drive(s, [target(legalTargets[0]!)]));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Tapped Bear')).toBe(false);
  });
  it('negative: with no monarch nothing triggers and the Bear lives', () => {
    const s = settle(attack(setup(undefined)));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Tapped Bear')).toBe(true);
  });
});

const completed = (s: GameState): GameState => tweak(s, (t) => { t.designations.completedDungeons = { p1: ['Lost Mine of Phandelver'] }; });
const pickFirst = (s: GameState): GameState => { let t = s; for (let g = 0; g < 20 && t.pending && t.pending.kind !== 'priority'; g++) { const p = t.pending as unknown as { kind: string; options: ({ id: string } | string)[]; min?: number }; t = drive(t, [p.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: [p.options[0] as string] } : { kind: 'chooseOption', ids: [(p.options[0] as { id: string }).id] }]); } return t; };

describe('Barrowin (CR 309.7, 608.2c; trailing "if" checked as the ability resolves): "..., return up to one creature card with mana value 3 or less from your graveyard to the battlefield if you\'ve completed a dungeon."', () => {
  const BARROWIN = card('Test Venturer', 'Creature — Human', "Whenever ~ attacks, return up to one creature card with mana value 3 or less from your graveyard to the battlefield if you've completed a dungeon.", { pt: ['2', '2'] });
  const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{2}' });
  const BIG = card('Test Giant', 'Creature — Giant', '', { pt: ['5', '5'], cost: '{5}' });
  const run = (done: boolean): GameState => {
    const s0 = tweak(scenario([], { defs: [BARROWIN, CUB, BIG], p1: { battlefield: ['Test Venturer'], graveyard: ['Test Cub', 'Test Giant'] } }), () => undefined);
    let s = declareAttackers(toDeclareAttackers(done ? completed(s0) : s0), [[find(s0, 'Test Venturer', 'battlefield', 'p1'), 'p2']]);
    s = pickFirst(s);
    return pickFirst(settle(s));
  };
  const onBf = (s: GameState, n: string): boolean => s.zones.battlefield.some((id) => nameOf(s, id) === n);
  it('is automated with no manual part', () => expect(noManual(BARROWIN)).toBe(true));
  it('with a dungeon completed, a creature card of mana value 3 or less returns (the Giant of mana value 5 is not offered)', () => {
    const s = run(true);
    expect(onBf(s, 'Test Cub')).toBe(true);
    expect(onBf(s, 'Test Giant')).toBe(false);
  });
  it('negative: with no dungeon completed nothing returns', () => {
    const s = run(false);
    expect(onBf(s, 'Test Cub')).toBe(false);
  });
});

describe('Rilsa Rael (CR 309.7, 613.4c, 613.1f): "..., target attacking creature gains deathtouch until end of turn. If you\'ve completed a dungeon, that creature also gets +5/+0 and gains first strike and menace until end of turn."', () => {
  const RILSA = card('Test Kingpin', 'Creature — Human', "Whenever you attack, target attacking creature gains deathtouch until end of turn. If you've completed a dungeon, that creature also gets +5/+0 and gains first strike and menace until end of turn.", { pt: ['2', '2'] });
  const run = (done: boolean): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs: [RILSA], p1: { battlefield: ['Test Kingpin'] } });
    const id = find(s0, 'Test Kingpin', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(done ? completed(s0) : s0), [[id, 'p2']]);
    s = settle(drive(s, [target(id)]));
    return { s, id };
  };
  const kw = (s: GameState, id: ObjectId, k: string): boolean => getChars(s, id).keywords.some((x) => x.keyword === k);
  it('is automated with no manual part', () => expect(noManual(RILSA)).toBe(true));
  it('with a dungeon completed: +5/+0, first strike and menace besides deathtouch', () => {
    const { s, id } = run(true);
    expect(getChars(s, id).power).toBe('7');
    expect(['deathtouch', 'first strike', 'menace'].map((k) => kw(s, id, k))).toEqual([true, true, true]);
  });
  it('negative: without a completed dungeon only deathtouch', () => {
    const { s, id } = run(false);
    expect(getChars(s, id).power).toBe('2');
    expect(['deathtouch', 'first strike', 'menace'].map((k) => kw(s, id, k))).toEqual([true, false, false]);
  });
});

describe('Regal Sliver (CR 725.1, 608.2c, 113.6): "Sliver creatures you control have \'When this creature enters, Slivers you control get +1/+1 until end of turn if you\'re the monarch. Otherwise, you become the monarch.\'"', () => {
  const REGAL = card('Test Regal', 'Creature — Sliver', "Sliver creatures you control have \"When this creature enters, Slivers you control get +1/+1 until end of turn if you're the monarch. Otherwise, you become the monarch.\"", { pt: ['2', '2'] });
  const PLAIN = card('Test Sliver Cub', 'Creature — Sliver', '', { pt: ['1', '1'] });
  const play = (monarch: 'p1' | 'p2' | undefined): GameState => {
    const s0 = tweak(scenario([], { defs: [REGAL, PLAIN], p1: { battlefield: ['Test Regal'], hand: ['Test Sliver Cub'] } }), (t) => { if (monarch) t.designations.monarch = monarch; });
    return settle(cast(s0, 'Test Sliver Cub'));
  };
  it('is automated with no manual part', () => expect(noManual(REGAL)).toBe(true));
  it('not the monarch: you become the monarch and nothing is pumped', () => {
    const s = play(undefined);
    expect(s.designations.monarch).toBe('p1');
    const cub = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Sliver Cub')!;
    expect(getChars(s, cub).power).toBe('1');
  });
  it("another player is the monarch: you take it (Otherwise), still no pump; you being the monarch pumps every Sliver you control and keeps the crown", () => {
    expect(play('p2').designations.monarch).toBe('p1');
    const s = play('p1');
    expect(s.designations.monarch).toBe('p1');
    const cub = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Sliver Cub')!;
    const regal = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Regal')!;
    expect([getChars(s, cub).power, getChars(s, regal).power]).toEqual(['2', '3']);
  });
});

describe('Hama Pashar / Dungeon Delver (CR 309.4c, 603.2d, 701.49): "Room abilities of dungeons you own trigger an additional time."', () => {
  const HAMA = card('Test Ruin Seeker', 'Creature — Human', 'Room abilities of dungeons you own trigger an additional time.', { pt: ['2', '2'] });
  const DELVER = card('Test Delver', 'Creature — Human', 'Commander creatures you own have "Room abilities of dungeons you own trigger an additional time."', { pt: ['2', '2'] });
  const VENTURE = card('Test Venture', 'Sorcery', 'Venture into the dungeon.');
  const CMDR = legend('Test Cmdr', '{2}', ['2', '2'], ['G']);
  const OPP = legend('Test Opp Cmdr', '{2}', ['2', '2'], ['G']);
  const triggersAfterVenture = (s0: GameState): number => {
    const s = pickFirst(resolveAll(cast(s0, 'Test Venture')));
    return s.zones.stack.length;
  };
  it('is automated with no manual part', () => { expect(noManual(HAMA)).toBe(true); expect(noManual(DELVER)).toBe(true); });
  it('one room ability triggers once without the rule, twice with it', () => {
    expect(triggersAfterVenture(scenario([], { defs: [VENTURE], p1: { hand: ['Test Venture'] } }))).toBe(1);
    expect(triggersAfterVenture(scenario([], { defs: [VENTURE, HAMA], p1: { hand: ['Test Venture'], battlefield: ['Test Ruin Seeker'] } }))).toBe(2);
  });
  it("negative: the opponent's rule does not double your dungeon", () => {
    expect(triggersAfterVenture(scenario([], { defs: [VENTURE, HAMA], p1: { hand: ['Test Venture'] }, p2: { battlefield: ['Test Ruin Seeker'] } }))).toBe(1);
  });
  it('granted to commander creatures you own: only while a commander you own is a creature on the battlefield', () => {
    const base = (onBf: boolean): GameState => {
      const s0 = commanderScenario({ p1Commanders: [CMDR], p2Commanders: [OPP], defs: [VENTURE, DELVER], p1: { hand: ['Test Venture'], battlefield: ['Test Delver', ...(onBf ? ['Test Cmdr'] : [])] } });
      return onBf ? commanderOnBattlefield(s0, 'Test Cmdr') : s0;
    };
    expect(triggersAfterVenture(base(true))).toBe(2);
    expect(triggersAfterVenture(base(false))).toBe(1);
  });
});
