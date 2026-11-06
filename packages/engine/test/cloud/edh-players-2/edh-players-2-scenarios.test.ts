/**
 * edh-players-2 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 603.2, 603.6a              "Permanents entering don't cause abilities of permanents your opponents control to trigger": only those abilities are silenced
 *   CR 701.21a, 105.2, 608.2e     "Each player sacrifices all permanents they control that are one or more colors": colored permanents of every player, nothing colorless
 *   CR 702.11c, 702.11d           "You and permanents you control gain hexproof from blue and from black": only blue and black sources of your opponents are shut out
 *   CR 119.7, 119.8               "Until end of turn, your life total can't change, and permanents you control gain hexproof and indestructible"
 *   CR 702.16b, 702.16e           "You gain protection from everything until your next turn": not targeted, enchanted or dealt damage by anything
 *   CR 122.1, 119.3, 608.2h       "You lose 1 life for each burden counter on ~": counted when the ability resolves
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as unknown as OracleCard);
}
const manualOf = (d: CardDef): string[] => d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;

interface Script { yes?: boolean[]; targets?: TargetChoice[][] }
/** Answer the decisions of a cast or a resolution (payment automatic, "may" answered from the script); stop at the next priority decision. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function resolve(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = drive(s.pending?.kind === 'priority' ? pass(s) : s, script);
  return s;
}
const cast = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1', script?: Script): GameState => resolve(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
/** p1 passes so that p2 has priority (after a spell of p1 resolved). */
const toP2 = (s: GameState): GameState => {
  const t = act(s, { type: 'pass', player: 'p1' });
  expect(t.pending?.player).toBe('p2');
  return t;
};
/** The player p2's cast of the spell `name` at `target`, as far as choosing the target: a throw means the target is not legal. */
const castAt = (s: GameState, name: string, target: TargetChoice) => answer(act(s, { type: 'cast', player: 'p2', card: find(s, name, 'hand', 'p2') }), { kind: 'chooseTargets', targets: [target] });
const p = (id: 'p1' | 'p2'): TargetChoice => ({ kind: 'player', id }) as TargetChoice;

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const HUSH = card('Test Hush', 'Creature — Phyrexian Praetor', 'Permanents entering don\'t cause abilities of permanents your opponents control to trigger.', { pt: ['4', '4'] });
const WATCH_A = card('Test Watch Alpha', 'Enchantment', 'Whenever a creature enters, you gain 1 life.');
const WATCH_B = card('Test Watch Beta', 'Enchantment', 'Whenever a creature enters, you gain 1 life.');

describe('CR 603.2, 603.6a: "Permanents entering don\'t cause abilities of permanents your opponents control to trigger."', () => {
  it('is automated', () => expect(manualOf(HUSH)).toEqual([]));
  it('a creature entering causes your own permanents\' abilities to trigger but not an opponent\'s', () => {
    let s = scenario([], { defs: [HUSH, WATCH_A, WATCH_B, BEAR], p1: { battlefield: ['Test Hush', 'Test Watch Alpha'], hand: ['Test Bear'] }, p2: { battlefield: ['Test Watch Beta'] } });
    const before = [life(s, 'p1'), life(s, 'p2')];
    s = cast(s, 'Test Bear');
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([before[0]! + 1, before[1]]);
  });
  it('a creature entering under the opponent\'s control is judged the same way: who controls the permanent with the ability decides, not who controls the entering one', () => {
    let s = scenario([], { defs: [HUSH, WATCH_A, WATCH_B, BEAR], p1: { battlefield: ['Test Hush', 'Test Watch Alpha'] }, p2: { battlefield: ['Test Watch Beta'], hand: ['Test Bear'] } });
    s = advanceTo(s, 2, 'main1'); // (p2 casts a creature only on its own turn)
    const before = [life(s, 'p1'), life(s, 'p2')];
    s = cast(s, 'Test Bear', 'p2');
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([before[0]! + 1, before[1]]);
  });
  it('without it, both watchers trigger (the negative case)', () => {
    let s = scenario([], { defs: [WATCH_A, WATCH_B, BEAR], p1: { battlefield: ['Test Watch Alpha'], hand: ['Test Bear'] }, p2: { battlefield: ['Test Watch Beta'] } });
    const before = [life(s, 'p1'), life(s, 'p2')];
    s = cast(s, 'Test Bear');
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([before[0]! + 1, before[1]! + 1]);
  });
  it('the permanent entering with it (itself) causes no ability of the opponent\'s permanents to trigger', () => {
    let s = scenario([], { defs: [HUSH, WATCH_B], p1: { hand: ['Test Hush'] }, p2: { battlefield: ['Test Watch Beta'] } });
    const before = life(s, 'p2');
    s = cast(s, 'Test Hush');
    expect(life(s, 'p2')).toBe(before);
  });
});

const RED_BEAR = card('Test Red Bear', 'Creature — Bear', '', { cost: '{R}', colors: ['R'], pt: ['2', '2'] });
const GREEN_BEAR = card('Test Green Bear', 'Creature — Bear', '', { cost: '{G}', colors: ['G'], pt: ['2', '2'] });
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { cost: '{3}', pt: ['3', '3'] });
const FIELD = card('Test Field', 'Land', '{T}: Add {C}.');
const DUST = card('Test Dust', 'Sorcery', 'Each player sacrifices all permanents they control that are one or more colors.');

describe('CR 701.21a, 105.2, 608.2e: "Each player sacrifices all permanents they control that are one or more colors."', () => {
  it('is automated', () => expect(manualOf(DUST)).toEqual([]));
  it('sacrifices the colored permanents of every player and leaves colorless ones and lands', () => {
    let s = scenario([], { defs: [DUST, RED_BEAR, GREEN_BEAR, GOLEM, FIELD], p1: { hand: ['Test Dust'], battlefield: ['Test Red Bear', 'Test Golem', 'Test Field'] }, p2: { battlefield: ['Test Green Bear', 'Test Golem', 'Test Field'] } });
    s = cast(s, 'Test Dust');
    expect(battlefieldNames(s, 'p1').sort()).toEqual(['Test Field', 'Test Golem']);
    expect(battlefieldNames(s, 'p2').sort()).toEqual(['Test Field', 'Test Golem']);
  });
  it('with only colorless permanents nothing is sacrificed (the negative case)', () => {
    let s = scenario([], { defs: [DUST, GOLEM, FIELD], p1: { hand: ['Test Dust'], battlefield: ['Test Golem', 'Test Field'] }, p2: { battlefield: ['Test Golem'] } });
    s = cast(s, 'Test Dust');
    expect(battlefieldNames(s, 'p1').sort()).toEqual(['Test Field', 'Test Golem']);
    expect(battlefieldNames(s, 'p2')).toEqual(['Test Golem']);
  });
});

const BLUE_SHOCK = card('Test Blue Shock', 'Instant', 'Test Blue Shock deals 2 damage to any target.', { colors: ['U'] });
const BLACK_SHOCK = card('Test Black Shock', 'Instant', 'Test Black Shock deals 2 damage to any target.', { colors: ['B'] });
const RED_SHOCK = card('Test Red Shock', 'Instant', 'Test Red Shock deals 2 damage to any target.', { colors: ['R'] });
const VEIL = card('Test Veil', 'Instant', 'You and permanents you control gain hexproof from blue and from black until end of turn.');

describe('CR 702.11c, 702.11d: "You and permanents you control gain hexproof from blue and from black until end of turn."', () => {
  const setup = () => {
    let s = scenario([], { defs: [VEIL, BEAR, BLUE_SHOCK, BLACK_SHOCK, RED_SHOCK], p1: { hand: ['Test Veil'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Blue Shock', 'Test Black Shock', 'Test Red Shock'] } });
    s = toP2(resolve(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Veil', 'hand', 'p1') }))));
    return s;
  };
  it('is automated', () => expect(manualOf(VEIL)).toEqual([]));
  it('blue and black spells of an opponent can\'t target you or your permanents', () => {
    const s = setup();
    for (const name of ['Test Blue Shock', 'Test Black Shock']) {
      expect(() => castAt(s, name, p('p1')), `${name} at the player`).toThrow();
      expect(() => castAt(s, name, obj(find(s, 'Test Bear', 'battlefield', 'p1'))), `${name} at the creature`).toThrow();
      expect(castAt(s, name, p('p2')).zones.stack, `${name} at its own controller`).toHaveLength(1);
    }
  });
  it('a red spell of an opponent can still target you and your permanents (the negative case)', () => {
    const s = setup();
    expect(castAt(s, 'Test Red Shock', p('p1')).zones.stack).toHaveLength(1);
    expect(castAt(s, 'Test Red Shock', obj(find(s, 'Test Bear', 'battlefield', 'p1'))).zones.stack).toHaveLength(1);
  });
});

const FLARE = card('Test Flare', 'Instant', 'Until end of turn, your life total can\'t change, and permanents you control gain hexproof and indestructible.');
const RAIN = card('Test Rain', 'Instant', 'Test Rain deals 3 damage to each player.');
const SIPHON = card('Test Siphon', 'Instant', 'Each opponent loses 2 life.');
const TONIC = card('Test Tonic', 'Instant', 'You gain 4 life.');

describe('CR 119.7, 119.8: "Until end of turn, your life total can\'t change, and permanents you control gain hexproof and indestructible."', () => {
  const setup = () => {
    let s = scenario([], { defs: [FLARE, RAIN, SIPHON, TONIC, BEAR, RED_SHOCK], p1: { hand: ['Test Flare', 'Test Tonic'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Rain', 'Test Siphon', 'Test Red Shock'] } });
    return s;
  };
  it('is automated', () => expect(manualOf(FLARE)).toEqual([]));
  it('your life total doesn\'t change from damage, life loss or life gain this turn, the opponent\'s does', () => {
    let s = cast(setup(), 'Test Flare');
    s = cast(s, 'Test Tonic');
    expect(life(s, 'p1')).toBe(20);
    s = toP2(s);
    s = resolve(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Rain', 'hand', 'p2') })));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 17]);
    s = toP2(s);
    s = resolve(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Siphon', 'hand', 'p2') })));
    expect(life(s, 'p1')).toBe(20);
  });
  it('your permanents have hexproof: an opponent\'s spell can\'t target them', () => {
    const s = toP2(cast(setup(), 'Test Flare'));
    expect(() => castAt(s, 'Test Red Shock', obj(find(s, 'Test Bear', 'battlefield', 'p1')))).toThrow();
    expect(castAt(s, 'Test Red Shock', p('p1')).zones.stack).toHaveLength(1); // (hexproof for the permanents only: the player is not made hexproof)
  });
  it('a cost of paying life can\'t be paid while it holds (CR 119.8), and can before and after (the negative case)', () => {
    const PAYER = card('Test Payer', 'Artifact', '{T}, Pay 2 life: Draw a card.');
    let s = scenario([], { defs: [FLARE, PAYER], p1: { hand: ['Test Flare'], battlefield: ['Test Payer'] } });
    const activations = (g: GameState): number => legalActions(g, 'p1').filter((a) => a.kind === 'activate').length;
    expect(activations(s)).toBe(1);
    s = cast(s, 'Test Flare');
    expect(activations(s)).toBe(0);
  });
  it('after the turn your life total changes again (the negative case)', () => {
    let s = cast(setup(), 'Test Flare');
    s = advanceTo(s, 2, 'main1');
    s = advanceTo(s, 3, 'main1');
    s = cast(s, 'Test Tonic');
    expect(life(s, 'p1')).toBe(24);
  });
});

const RING = card('Test Ring', 'Artifact', 'Indestructible\nWhen ~ enters, if you cast it, you gain protection from everything until your next turn.\nAt the beginning of your upkeep, you lose 1 life for each burden counter on ~.');

describe('CR 702.16b, 702.16e: "You gain protection from everything until your next turn."', () => {
  it('is automated', () => expect(manualOf(RING)).toEqual([]));
  it('you can\'t be targeted or dealt damage until your next turn, and can be again from it on', () => {
    let s = scenario([], { defs: [RING, RAIN, RED_SHOCK], p1: { hand: ['Test Ring'] }, p2: { hand: ['Test Rain', 'Test Red Shock'] } });
    s = cast(s, 'Test Ring');
    s = toP2(s);
    expect(() => castAt(s, 'Test Red Shock', p('p1'))).toThrow();
    s = resolve(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Rain', 'hand', 'p2') })));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 17]);
    s = advanceTo(s, 3, 'main1');
    expect(castAt(act(s, { type: 'pass', player: 'p1' }), 'Test Red Shock', p('p1')).zones.stack).toHaveLength(1);
  });
});

describe('CR 702.16e, 615.12: protection from everything prevents damage, so damage that can\'t be prevented still happens', () => {
  const FURY = card('Test Fury', 'Instant', "Damage can't be prevented this turn. Test Fury deals 3 damage to each player.");
  it('the player takes unpreventable damage as normal (and none of the preventable kind)', () => {
    let s = scenario([], { defs: [RING, RAIN, FURY], p1: { hand: ['Test Ring'] }, p2: { hand: ['Test Fury'] } });
    s = toP2(cast(s, 'Test Ring'));
    s = resolve(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Fury', 'hand', 'p2') })));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([17, 17]);
  });
});

describe('CR 122.1, 119.3, 608.2h: "At the beginning of your upkeep, you lose 1 life for each burden counter on ~."', () => {
  it('loses as much life as there are counters, and none with no counters (the negative case)', () => {
    let s = scenario([], { defs: [RING], p1: { battlefield: [{ name: 'Test Ring', counters: { burden: 3 } }] } });
    s = advanceTo(s, 3, 'main1');
    expect(life(s, 'p1')).toBe(17);
    let n = scenario([], { defs: [RING], p1: { battlefield: ['Test Ring'] } });
    n = advanceTo(n, 3, 'main1');
    expect(life(n, 'p1')).toBe(20);
  });
});
