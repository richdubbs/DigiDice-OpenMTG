/**
 * Commander effort (coordinator C), round edh-c-17: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 613.4c, 205.1               "Each land gets +2/+2 as long as it's a creature"
 *   CR 122.1, 608.2c, 121.1        "Remove all +1/+1 counters from target creature you control. Draw that many cards."
 *   CR 102.3, 119.3, 603.4         "At the beginning of each end step, if your team gained life this turn, create two 1/1 ... tokens" (no team of several players: your team is you)
 *   CR 119.3, 122.1f, 701.17a      "Target opponent loses 2 life, gets a poison counter, then mills six cards"
 *   CR 119.3, 701.9a, 614.10       "that player loses 1 life and discards a card" at each upkeep; "Skip your upkeep step if you have no cards in hand"
 *   CR 205.4a, 608.2h, 701.8a      "Destroy target land. If that land was nonbasic, ~ deals 2 damage to the land's controller"
 *   CR 508.1b-c, 509.1b, 303.4     "Enchanted creature can't attack you or planeswalkers you control"
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { find, put, scenario } from '../../m3/scenario';
import { passUntil, tweak } from '../../m4/helpers';
import { advanceTo as advanceToStep, answer } from '../../m5/helpers';
import { synthetic } from '../../m6/costs/support';
import { cast, full, pt, resolveAll } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onField = (s: GameState, name: string, player?: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name && (player === undefined || s.objects[id]!.controller === player));
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;

const GRUNT = synthetic('Test Grunt', 'Creature — Goblin', '{0}', '', { power: '2', toughness: '2' });

// ---- Earth Surge: "Each land gets +2/+2 as long as it's a creature" ------------------------------------------------------------------------------------------------
const SURGE = synthetic('Test Surge', 'Enchantment', '{0}', "Each land gets +2/+2 as long as it's a creature.");
const MANLAND = synthetic('Test Manland', 'Land Creature — Elemental', '', '', { power: '1', toughness: '1' });

describe('CR 613.4c, 205.1: "Each land gets +2/+2 as long as it\'s a creature"', () => {
  it('is automated; a land that is also a creature gets the bonus, a plain land (no power) and a creature that is no land get nothing', () => {
    expect(full(SURGE)).toBe(true);
    const s = scenario(['Forest'], { defs: [SURGE, MANLAND, GRUNT], p1: { battlefield: ['Test Surge', 'Test Manland', 'Test Grunt', 'Forest'] } });
    expect(pt(s, onField(s, 'Test Manland')!)).toBe('3/3');
    expect(pt(s, onField(s, 'Test Grunt')!)).toBe('2/2');
    expect(getChars(s, onField(s, 'Forest')!)!.power).toBeUndefined();
  });
  it('the bonus goes away with the enchantment (the negative case: without Test Surge the manland is 1/1)', () => {
    const s = scenario([], { defs: [SURGE, MANLAND], p1: { battlefield: ['Test Manland'] } });
    expect(pt(s, onField(s, 'Test Manland')!)).toBe('1/1');
  });
});

// ---- Give // Take: remove all counters, draw that many ---------------------------------------------------------------------------------------------------------------
const TAKE = synthetic('Test Take', 'Sorcery', '{0}', 'Remove all +1/+1 counters from target creature you control. Draw that many cards.');

describe('CR 122.1, 608.2c, 121.1: "Remove all +1/+1 counters from target creature you control. Draw that many cards."', () => {
  const play = (counters: number): GameState => {
    const s = scenario([], { defs: [TAKE, GRUNT], p1: { hand: ['Test Take'], battlefield: [{ name: 'Test Grunt', counters: { '+1/+1': counters } }] } });
    return resolveAll(cast(s, 'Test Take', { targets: [{ kind: 'object', id: onField(s, 'Test Grunt')! }] }));
  };
  it('is automated; with three +1/+1 counters it removes them all and draws three cards', () => {
    expect(full(TAKE)).toBe(true);
    const s = play(3);
    expect(s.objects[onField(s, 'Test Grunt')!]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(handSize(s, 'p1')).toBe(3);
  });
  it('the negative case: a creature without counters is a legal target and draws no card', () => {
    const s = play(0);
    expect(handSize(s, 'p1')).toBe(0);
  });
  it('counters of another kind are not removed and not counted', () => {
    const s = scenario([], { defs: [TAKE, GRUNT], p1: { hand: ['Test Take'], battlefield: [{ name: 'Test Grunt', counters: { '+1/+1': 1, charge: 2 } }] } });
    const t = resolveAll(cast(s, 'Test Take', { targets: [{ kind: 'object', id: onField(s, 'Test Grunt')! }] }));
    expect(t.objects[onField(t, 'Test Grunt')!]!.counters['charge'] ?? 0).toBe(2);
    expect(handSize(t, 'p1')).toBe(1);
  });
});

// ---- Regna: "your team gained life this turn" -----------------------------------------------------------------------------------------------------------------------
const REGNAL = synthetic('Test Regna', 'Creature — Angel', '{0}', 'At the beginning of each end step, if your team gained life this turn, create two 1/1 white Warrior creature tokens.', { power: '1', toughness: '1' });
const TONIC = synthetic('Test Tonic', 'Instant', '{0}', 'You gain 2 life.');

describe('CR 102.3, 119.3, 603.4: "At the beginning of each end step, if your team gained life this turn, create two 1/1 white Warrior creature tokens"', () => {
  const toEnd = (gain: boolean): GameState => {
    let s = scenario([], { defs: [REGNAL, TONIC], p1: { hand: ['Test Tonic'], battlefield: ['Test Regna'] } });
    if (gain) s = resolveAll(cast(s, 'Test Tonic'));
    s = advanceToStep(s, 1, 'end');
    return resolveAll(s);
  };
  const warriors = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
  it('is automated; life gained this turn makes the end step trigger create two tokens', () => {
    expect(full(REGNAL)).toBe(true);
    expect(warriors(toEnd(true))).toBe(2);
  });
  it('the negative case: no life gained this turn, no trigger and no token', () => {
    expect(warriors(toEnd(false))).toBe(0);
  });
});

// ---- Decimator Web: lose life, get a poison counter, then mill ---------------------------------------------------------------------------------------------------
const WEB = synthetic('Test Web', 'Artifact', '{0}', '{0}: Target opponent loses 2 life, gets a poison counter, then mills six cards.');

describe('CR 119.3, 122.1f, 701.17a: "Target opponent loses 2 life, gets a poison counter, then mills six cards"', () => {
  it('is automated; the opponent loses 2 life, gets one poison counter and mills six cards, in that order; the controller is untouched', async () => {
    expect(full(WEB)).toBe(true);
    const { act } = await import('../../m3/scenario');
    let s = scenario([], { defs: [WEB], p1: { battlefield: ['Test Web'] } });
    const lib = s.zones.library['p2']!.length;
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: onField(s, 'Test Web')!, ability: 'p:0:0' } as never), { targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBe(18);
    expect(s.players.find((p) => p.id === 'p2')!.poison).toBe(1);
    expect(s.zones.library['p2']!.length).toBe(lib - 6);
    expect(life(s, 'p1')).toBe(20);
    expect(s.players.find((p) => p.id === 'p1')!.poison).toBe(0);
  });
});

// ---- Molten Rain: "If that land was nonbasic" -------------------------------------------------------------------------------------------------------------------------
const NONBASIC = synthetic('Test Nonbasic', 'Land', '', '');
const RAIN = synthetic('Test Rain', 'Sorcery', '{0}', "Destroy target land. If that land was nonbasic, ~ deals 2 damage to the land's controller.");

describe('CR 205.4a, 608.2h, 701.8a: "Destroy target land. If that land was nonbasic, ~ deals 2 damage to the land\'s controller"', () => {
  const strike = (land: string): GameState => {
    const s = scenario(['Forest'], { defs: [RAIN, NONBASIC], p1: { hand: ['Test Rain'] }, p2: { battlefield: [land] } });
    return resolveAll(cast(s, 'Test Rain', { targets: [{ kind: 'object', id: find(s, land, 'battlefield', 'p2') }] }));
  };
  it('is automated; destroying a nonbasic land deals 2 damage to its controller (not to the caster)', () => {
    expect(full(RAIN)).toBe(true);
    const s = strike('Test Nonbasic');
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(20);
  });
  it('the negative case: a basic land is destroyed and its controller is not damaged', () => {
    const s = strike('Forest');
    expect(life(s, 'p2')).toBe(20);
    expect(onField(s, 'Forest')).toBeUndefined();
  });
});

// ---- Gibbering Descent: upkeep drain and the conditional skip -----------------------------------------------------------------------------------------------------
const DESCENT = synthetic('Test Descent', 'Enchantment', '{0}', "At the beginning of each player's upkeep, that player loses 1 life and discards a card.\nSkip your upkeep step if you have no cards in hand.");

describe('CR 119.3, 701.9a, 614.10, 503.1: Gibbering Descent', () => {
  it('is automated; at the opponent\'s upkeep that player loses 1 life and discards a card', () => {
    expect(full(DESCENT)).toBe(true);
    let s = scenario(['Forest'], { defs: [DESCENT, GRUNT], p1: { battlefield: ['Test Descent'] }, p2: { hand: ['Test Grunt', 'Test Grunt'] } });
    s = advanceToStep(s, 2, 'upkeep');
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(19);
    expect(handSize(s, 'p2')).toBe(1);
  });
  it('your own upkeep is skipped with no cards in hand (no trigger, no life lost) and not skipped with one', () => {
    const empty = scenario(['Forest'], { defs: [DESCENT, GRUNT], p1: { battlefield: ['Test Descent'] } });
    const a = advanceToStep(empty, 3, 'draw');
    expect(life(a, 'p1')).toBe(20);
    const held = tweak(scenario(['Forest'], { defs: [DESCENT, GRUNT], p1: { battlefield: ['Test Descent'], hand: ['Test Grunt', 'Test Grunt'] } }), () => undefined);
    const b = resolveAll(advanceToStep(held, 3, 'upkeep'));
    expect(life(b, 'p1')).toBe(19);
  });
});

// ---- Spectral Grasp: an Aura that bans attacking you --------------------------------------------------------------------------------------------------------------
const GRASP = synthetic('Test Grasp', 'Enchantment — Aura', '{0}', "Enchant creature\nEnchanted creature can't attack you or planeswalkers you control.\nEnchanted creature can't block creatures you control.");

describe('CR 508.1b-c, 509.1b, 303.4: "Enchanted creature can\'t attack you or planeswalkers you control" / "can\'t block creatures you control"', () => {
  const game = (): GameState => {
    const s = scenario([], { defs: [GRASP, GRUNT], p1: { battlefield: ['Test Grunt'] }, p2: { battlefield: [{ name: 'Test Grunt', since: 0 }, { name: 'Test Grunt', since: 0 }] } });
    const theirs = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Grunt' && s.objects[id]!.controller === 'p2');
    return tweak(s, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Grasp')]!.attachedTo = theirs[0]!; });
  };
  it('is automated; the enchanted creature of the opponent can\'t attack the Aura\'s controller, an unenchanted one can', () => {
    expect(full(GRASP)).toBe(true);
    const s0 = game();
    const theirs = s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Test Grunt' && s0.objects[id]!.controller === 'p2');
    const s = advanceToStep(s0, 2, 'declareAttackers');
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [{ attacker: theirs[0]!, defender: 'p1' }] })).toThrow();
    const ok = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: theirs[1]!, defender: 'p1' }] });
    expect(ok.turn.step).toBe('declareAttackers');
  });
  it('the enchanted creature can\'t block a creature its Aura\'s controller controls; the other creature can', () => {
    const s = game();
    const mine = onField(s, 'Test Grunt', 'p1')!;
    const theirs = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Grunt' && s.objects[id]!.controller === 'p2');
    let t = advanceToStep(s, 1, 'declareAttackers');
    t = answer(t, { kind: 'declareAttackers', attacks: [{ attacker: mine, defender: 'p2' }] });
    t = passUntil(t, (x) => x.pending?.kind === 'declareBlockers', 'declare blockers', 40);
    expect(() => answer(t, { kind: 'declareBlockers', blocks: [{ blocker: theirs[0]!, attacker: mine }] })).toThrow();
    const ok = answer(t, { kind: 'declareBlockers', blocks: [{ blocker: theirs[1]!, attacker: mine }] });
    expect(ok.pending?.kind).not.toBe('declareBlockers');
  });
});
