/**
 * edh-d-93 (Commander coordinator D, EDHREC ranks 5,001-10,000, group counters; code edhd93): the round's readings played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. Scryfall rulings were fetched
 * in the cloud session; CR cites checked against the 2026-09-25 text unless the record lists them as unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
export const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
export const obj = (id: string): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const onBf = (s: GameState, name: string): string[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name);

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; options?: (string[] | 'all')[]; objects?: (string[] | ((options: string[], s: GameState) => string[]))[]; division?: number[][]; log?: string[] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.log?.push(p.kind);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: ((o) => o === 'all' ? p.options.map((x) => x.id) : o ?? p.options.slice(0, p.min).map((x) => x.id))(script.options?.shift()) });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options as string[], s) : pick ?? (p.options as string[]).slice(0, p.min) }); }
    else if (p.kind === 'chooseDivision') s = answer(s, { kind: 'chooseDivision', amounts: script.division?.shift() ?? p.targets.map((_, i) => (i === 0 ? p.total - p.targets.length + 1 : 1)) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);

// ---- Expand the Sphere: up to N lands put tapped, then proliferate the difference -------------------------------------------------------------------------------------------------

const SPHERE = card('Test Widening', 'Sorcery', 'Look at the top six cards of your library. Put up to two land cards from among them onto the battlefield tapped and the rest on the bottom of your library in a random order. If you put fewer than two lands onto the battlefield this way, proliferate a number of times equal to the difference.');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
describe('CR 608.2c, 608.2d, 701.34a: "Put up to two land cards from among them onto the battlefield tapped ... If you put fewer than two lands onto the battlefield this way, proliferate a number of times equal to the difference."', () => {
  const setup = (): GameState => mpScenario({ defs: [SPHERE, BEAR], zones: { p1: { hand: ['Test Widening'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }] } } });
  const counters = (s: GameState): number => s.objects[onBf(s, 'Test Bear')[0]!]!.counters['+1/+1'] ?? 0;
  it('is automated', () => expect(full(SPHERE)).toBe(true));
  it('two lands put: both enter tapped under your control and nothing is proliferated (the negative case)', () => {
    const before = setup();
    const lands = onBf(before, 'Plains').length;
    const s = cast(before, 'Test Widening', { objects: [(o) => o.slice(0, 2)], options: ['all', 'all', 'all'] });
    const now = onBf(s, 'Plains');
    expect(now.length).toBe(lands + 2);
    expect(now.slice(lands).every((id) => s.objects[id]!.tapped && s.objects[id]!.controller === 'p1')).toBe(true);
    expect(counters(s)).toBe(1);
  });
  it('one land put: proliferate once', () => {
    const s = cast(setup(), 'Test Widening', { objects: [(o) => o.slice(0, 1)], options: ['all', 'all', 'all'] });
    expect(counters(s)).toBe(2);
  });
  it('no land put (up to includes none): proliferate twice, and the six cards go to the bottom', () => {
    const before = setup();
    const top = before.zones.library.p1!.length;
    const s = cast(before, 'Test Widening', { objects: [[]], options: ['all', 'all', 'all'] });
    expect(counters(s)).toBe(3);
    expect(s.zones.library.p1!.length).toBe(top);
  });
});

// ---- Auntie Ool, Cursewretch: "draw a card if you control that creature. If you don't control it, its controller loses 1 life." --------------------------------------------------

const CURSE = card('Test Hagwife', 'Creature — Faerie', 'Whenever one or more -1/-1 counters are put on a creature, draw a card if you control that creature. If you don\'t control it, its controller loses 1 life.', { pt: ['3', '3'] });
const WITHER = card('Test Wilting', 'Instant', 'Put a -1/-1 counter on target creature.');
const WITHER_ALL = card('Test Blight Wave', 'Sorcery', 'Put a -1/-1 counter on each creature.');
const BEAR_P = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SPROUT = card('Test Sprout', 'Creature — Plant', '', { pt: ['1', '1'] });
describe('CR 608.2c, 608.2h, 603.2c: "Whenever one or more -1/-1 counters are put on a creature, draw a card if you control that creature. If you don\'t control it, its controller loses 1 life."', () => {
  const setup = (): GameState => mpScenario({
    defs: [CURSE, WITHER, WITHER_ALL, BEAR_P, SPROUT],
    zones: { p1: { hand: ['Test Wilting', 'Test Blight Wave'], battlefield: ['Test Hagwife', 'Test Bear', 'Test Sprout'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } },
  });
  const bearOf = (s: GameState, p: PlayerId): string => onBf(s, 'Test Bear').find((id) => s.objects[id]!.controller === p)!;
  const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  it('is automated', () => expect(full(CURSE)).toBe(true));
  it('a counter on your own creature: you draw a card and nobody loses life', () => {
    const before = setup();
    const s = cast(before, 'Test Wilting', { targets: [[obj(bearOf(before, 'p1'))]] });
    expect(s.zones.hand.p1!.length).toBe(before.zones.hand.p1!.length); // Test Wilting left (-1), one card drawn (+1)
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => life(s, p as PlayerId))).toEqual([20, 20, 20, 20]);
  });
  it("a counter on an opponent's creature: that opponent loses 1 life and you draw nothing (the negative case)", () => {
    const before = setup();
    const s = cast(before, 'Test Wilting', { targets: [[obj(bearOf(before, 'p2'))]] });
    expect(s.zones.hand.p1!.length).toBe(before.zones.hand.p1!.length - 1);
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => life(s, p as PlayerId))).toEqual([20, 19, 20, 20]);
  });
  it('counters on several creatures at once trigger once for each creature (CR 603.2c); your 1/1 that died is still yours by last known information (CR 608.2h)', () => {
    const before = setup();
    const s = cast(before, 'Test Blight Wave');
    expect(onBf(s, 'Test Sprout').length).toBe(0);
    // your Hagwife, Bear and Sprout: three draws; the opponents' Bears: p2 and p3 lose 1 each
    expect(s.zones.hand.p1!.length).toBe(before.zones.hand.p1!.length - 1 + 3);
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => life(s, p as PlayerId))).toEqual([20, 19, 19, 20]);
  });
});

// ---- Krang, the All-Powerful: a player drawing a card makes your permanents' triggered abilities trigger an additional time ------------------------------------------------------

const KRANG = card('Test Shellmind', 'Creature — Mutant', 'If a player drawing a card causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\nWhenever a player draws their second card each turn, put a +1/+1 counter on Test Shellmind.', { pt: ['2', '2'] });
const SCRIBE = card('Test Ledger', 'Enchantment', 'Whenever a player draws a card, you gain 1 life.');
const DRAW1 = card('Test Insight', 'Instant', 'Target player draws a card.');
const DRAW2 = card('Test Deep Insight', 'Instant', 'Target player draws two cards.');
const GROWTH = card('Test Grove', 'Enchantment', 'Whenever a creature enters, you gain 1 life.');
const SAPLING = card('Test Sapling', 'Creature — Plant', '', { pt: ['1', '1'] });
describe('CR 603.2d, 121.1: "If a player drawing a card causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time."', () => {
  const setup = (): GameState => mpScenario({
    defs: [KRANG, SCRIBE, DRAW1, DRAW2, GROWTH, SAPLING],
    zones: { p1: { hand: ['Test Insight', 'Test Deep Insight', 'Test Sapling'], battlefield: ['Test Shellmind', 'Test Ledger', 'Test Grove'] }, p2: { battlefield: ['Test Ledger'] } },
  });
  const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  it('is automated', () => expect(full(KRANG)).toBe(true));
  it("an opponent drawing a card: your ability triggers twice, the opponent's own copy of it only once (the negative case)", () => {
    const before = setup(); // (Alice's own draw of turn 1 already gained her 2 life: her Ledger triggered twice)
    const s = cast(before, 'Test Insight', { targets: [[pl('p3')]] });
    expect(life(s, 'p1') - life(before, 'p1')).toBe(2);
    expect(life(s, 'p2') - life(before, 'p2')).toBe(1);
  });
  it('a second card drawn in a turn: the second-card ability triggers twice (two counters), each draw doubles the life trigger', () => {
    const before = setup();
    const s = cast(before, 'Test Deep Insight', { targets: [[pl('p2')]] });
    expect(life(s, 'p1') - life(before, 'p1')).toBe(4);
    expect(s.objects[onBf(s, 'Test Shellmind')[0]!]!.counters['+1/+1'] ?? 0).toBe(2);
  });
  it('an ability another event triggers is not doubled (a creature entering)', () => {
    const before = setup();
    const s = settle(drive(act(before, { type: 'cast', player: 'p1', card: find(before, 'Test Sapling', 'hand', 'p1') })));
    expect(life(s, 'p1') - life(before, 'p1')).toBe(1);
  });
});

// ---- Feast of the Victorious Dead: "that much" / "that many" is the number of creatures that died this turn --------------------------------------------------------------------

const FEAST = card('Test Wake Feast', 'Enchantment', 'At the beginning of your end step, if one or more creatures died this turn, you gain that much life and distribute that many +1/+1 counters among any number of creatures you control.');
const SLAY = card('Test Slaying', 'Instant', 'Destroy target creature.');
describe('CR 603.4, 608.2h, 608.2d: "At the beginning of your end step, if one or more creatures died this turn, you gain that much life and distribute that many +1/+1 counters among any number of creatures you control."', () => {
  const setup = (): GameState => mpScenario({
    defs: [FEAST, SLAY, BEAR_P, SPROUT],
    zones: { p1: { hand: ['Test Slaying', 'Test Slaying'], battlefield: ['Test Wake Feast', 'Test Bear', 'Test Sprout'] }, p2: { battlefield: ['Test Bear', 'Test Sprout'] } },
  });
  const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const toEnd = (s0: GameState, script: Script): GameState => {
    let s = passUntil(s0, (t) => t.turn.step === 'end' && t.zones.stack.length > 0, 'the end step trigger');
    s = settle(s, script);
    return s;
  };
  const plus = (s: GameState, name: string, p: PlayerId): number => s.objects[onBf(s, name).find((id) => s.objects[id]!.controller === p)!]!.counters['+1/+1'] ?? 0;
  it('is automated', () => expect(full(FEAST)).toBe(true));
  it("two creatures died (an opponent's included): gain 2 life and two counters, split as you choose among your creatures", () => {
    let s = setup();
    const theirs = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    s = cast(s, 'Test Slaying', { targets: [[obj(theirs[0]!)]] });
    s = cast(s, 'Test Slaying', { targets: [[obj(theirs[1]!)]] });
    const before = life(s, 'p1');
    const log: string[] = [];
    s = toEnd(s, { objects: [(o) => o.filter((id) => nameOf(s, id) === 'Test Bear' || nameOf(s, id) === 'Test Sprout')], log });
    expect(life(s, 'p1') - before).toBe(2);
    expect(plus(s, 'Test Bear', 'p1') + plus(s, 'Test Sprout', 'p1')).toBe(2);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.controller === 'p2')).toBe(false);
  });
  it('no creature died this turn: the ability does not trigger (the negative case)', () => {
    const s0 = setup();
    const s = passUntil(s0, (t) => t.turn.step === 'cleanup' || t.turn.number > 1, 'the end of the turn');
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
    expect(plus(s, 'Test Bear', 'p1')).toBe(0);
  });
});

// ---- The Red Terror: one trigger for each red source you control, however many permanents and players it dealt damage to at once -------------------------------------------------

const TERROR = card('Test Crimson Dread', 'Creature — Turtle', 'Whenever a red source you control deals damage to one or more permanents and/or players, put a +1/+1 counter on Test Crimson Dread.', { pt: ['2', '2'] });
const SPARKS = card('Test Spark Spray', 'Instant', 'Test Spark Spray deals 1 damage to each opponent and each creature your opponents control.', { colors: ['R'] });
const HOUND = card('Test Ember Hound', 'Creature — Dog', '', { pt: ['2', '2'], colors: ['R'] });
const GREEN_SPARKS = card('Test Moss Spray', 'Instant', 'Test Moss Spray deals 1 damage to each opponent.', { colors: ['G'] });
describe('CR 120.1, 603.2c: "Whenever a red source you control deals damage to one or more permanents and/or players, put a +1/+1 counter on ~."', () => {
  const setup = (): GameState => mpScenario({
    defs: [TERROR, SPARKS, GREEN_SPARKS, BEAR_P],
    zones: { p1: { hand: ['Test Spark Spray', 'Test Moss Spray'], battlefield: ['Test Crimson Dread'] }, p2: { hand: ['Test Spark Spray'], battlefield: ['Test Bear'] } },
  });
  const plus = (s: GameState): number => s.objects[onBf(s, 'Test Crimson Dread')[0]!]!.counters['+1/+1'] ?? 0;
  it('is automated', () => expect(full(TERROR)).toBe(true));
  it('a red spell dealing damage to three players and a creature at once: one counter (one source)', () => {
    const s = cast(setup(), 'Test Spark Spray');
    expect(s.players.filter((p) => p.id !== 'p1').every((p) => p.life === 19)).toBe(true);
    expect(plus(s)).toBe(1);
  });
  it('two red creatures dealing combat damage at once to two players: two counters, one for each source (CR 603.2c, 510.2)', () => {
    const s0 = mpScenario({ defs: [TERROR, HOUND], zones: { p1: { battlefield: ['Test Crimson Dread', { name: 'Test Ember Hound', since: -1 }, { name: 'Test Ember Hound', since: -1 }] } } });
    let s = passUntil(s0, (t) => t.pending?.kind === 'declareAttackers', 'declare attackers');
    const [a, b] = onBf(s, 'Test Ember Hound');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p3' }] });
    s = passUntil(s, (t) => t.pending?.kind === 'order' || (t.turn.step === 'combatDamage' && t.zones.stack.length > 0), 'the damage trigger');
    s = settle(s);
    expect(plus(s)).toBe(2);
  });
  it("a green source of yours, and a red source an opponent controls: no counter (the negative cases)", () => {
    let s = cast(setup(), 'Test Moss Spray');
    expect(plus(s)).toBe(0);
    s = settle(drive(act(s, { type: 'pass', player: 'p1' })));
    // the opponent casts its red spell at instant speed on the next priority it holds
    const q = passUntil(s, (t) => t.pending?.kind === 'priority' && t.pending.player === 'p2' && t.zones.stack.length === 0, 'p2 priority');
    const r = cast(q, 'Test Spark Spray', {}, 'p2');
    expect(plus(r)).toBe(0);
  });
});

// ---- Ferrafor, Young Yew: "the number of counters among creatures target player controls" -----------------------------------------------------------------------------------------

const YEW = card('Test Young Elm', 'Creature — Treefolk', 'When Test Young Elm enters, create a number of 1/1 green Saproling creature tokens equal to the number of counters among creatures target player controls.', { pt: ['2', '2'] });
const RELIC_C = card('Test Charged Relic', 'Artifact', '');
describe('CR 122.1, 115.1, 608.2h: "create a number of 1/1 green Saproling creature tokens equal to the number of counters among creatures target player controls"', () => {
  const setup = (): GameState => mpScenario({
    defs: [YEW, BEAR_P, SPROUT, RELIC_C],
    zones: {
      p1: { hand: ['Test Young Elm'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 5 } }] },
      p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 2, stun: 1 } }, { name: 'Test Sprout', counters: { '-1/-1': 0, shield: 1 } }, { name: 'Test Charged Relic', counters: { charge: 4 } }] },
    },
  });
  const saprolings = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
  it('is automated', () => expect(full(YEW)).toBe(true));
  it("the target player's creatures carry four counters of three kinds: four Saprolings; that player's artifact and your own creature's counters are not counted (the negative case)", () => {
    const before = setup();
    const s = cast(before, 'Test Young Elm', { targets: [[pl('p2')]] });
    expect(saprolings(s)).toBe(4);
  });
  it('a target player with no counters on creatures: no token', () => {
    const s = cast(setup(), 'Test Young Elm', { targets: [[pl('p3')]] });
    expect(saprolings(s)).toBe(0);
  });
});

// ---- Black Panther, Wakandan King: "If one or more +1/+1 counters are moved this way, you gain that much life and draw a card." ------------------------------------------------------

const SCALES = card('Test Scales', 'Enchantment', 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.');
const PANTHER = card('Test Vibranium King', 'Creature — Cat Noble', '{3}: Move all +1/+1 counters from target land you control onto target creature. If one or more +1/+1 counters are moved this way, you gain that much life and draw a card.', { pt: ['3', '3'] });
describe('CR 122.5, 608.2c, 608.2h: "Move all +1/+1 counters from target land you control onto target creature. If one or more +1/+1 counters are moved this way, you gain that much life and draw a card."', () => {
  const setup = (landCounters: number): GameState => mpScenario({
    defs: [PANTHER, BEAR_P],
    zones: { p1: { battlefield: ['Test Vibranium King', 'Plains', 'Plains', 'Plains', { name: 'Plains', counters: landCounters > 0 ? { '+1/+1': landCounters } : {} }] }, p2: { battlefield: ['Test Bear'] } },
  });
  const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  const activate = (s0: GameState): GameState => {
    const land = s0.zones.battlefield.find((id) => nameOf(s0, id) === 'Plains' && (s0.objects[id]!.counters['+1/+1'] !== undefined))
      ?? s0.zones.battlefield.filter((id) => nameOf(s0, id) === 'Plains').at(-1)!;
    const bear = onBf(s0, 'Test Bear')[0]!;
    return settle(drive(act(s0, { type: 'activate', player: 'p1', source: onBf(s0, 'Test Vibranium King')[0]!, ability: 'p:0:0' }), { targets: [[obj(land)], [obj(bear)]] }), {});
  };
  it('is automated', () => expect(full(PANTHER)).toBe(true));
  it("three counters moved onto an opponent's creature: it gets them, you gain 3 life and draw a card", () => {
    const before = setup(3);
    const s = activate(before);
    expect(s.objects[onBf(s, 'Test Bear')[0]!]!.counters['+1/+1']).toBe(3);
    expect(life(s, 'p1') - life(before, 'p1')).toBe(3);
    expect(s.zones.hand.p1!.length - before.zones.hand.p1!.length).toBe(1);
  });
  it('CR 122.5, 614.1a: a replacement that adds a counter to the put (Hardened Scales-like) gives the creature 4, but only the 3 counters taken from the land were moved: you gain 3', () => {
    const before = mpScenario({
      defs: [PANTHER, BEAR_P, SCALES],
      zones: { p1: { battlefield: ['Test Vibranium King', 'Test Scales', 'Test Bear', 'Plains', 'Plains', 'Plains', { name: 'Plains', counters: { '+1/+1': 3 } }] } },
    });
    const s = activate(before);
    expect(s.objects[onBf(s, 'Test Bear')[0]!]!.counters['+1/+1']).toBe(4);
    expect(life(s, 'p1') - life(before, 'p1')).toBe(3);
  });
  it('a land with no +1/+1 counter: nothing is moved, no life and no card (the negative case)', () => {
    const before = setup(0);
    const s = activate(before);
    expect(s.objects[onBf(s, 'Test Bear')[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(life(s, 'p1')).toBe(life(before, 'p1'));
    expect(s.zones.hand.p1!.length).toBe(before.zones.hand.p1!.length);
  });
});

// ---- Jason Bright, Glowing Prophet: "if its power was different from its base power" of a creature that died (last known information) -----------------------------------------

const PROPHET = card('Test Glowing Seer', 'Creature — Zombie Mutant Advisor', 'Whenever a Zombie or Mutant you control dies, if its power was different from its base power, draw a card.', { pt: ['3', '3'] });
const GHOUL = card('Test Ghoul', 'Creature — Zombie', '', { pt: ['2', '2'] });
const PUMP = card('Test Surge', 'Instant', 'Target creature gets +2/+0 until end of turn.');
const BASE_SET = card('Test Shrinking', 'Instant', 'Target creature has base power and toughness 2/2 until end of turn.');
const GIANT_GHOUL = card('Test Giant Ghoul', 'Creature — Zombie', '', { pt: ['5', '5'] });
describe('CR 208.1, 613.4, 603.4, 603.10a: "Whenever a Zombie or Mutant you control dies, if its power was different from its base power, draw a card."', () => {
  const setup = (bf: (string | { name: string; counters?: Record<string, number> })[]): GameState => mpScenario({
    defs: [PROPHET, GHOUL, BEAR_P, SLAY, PUMP, BASE_SET, GIANT_GHOUL],
    zones: { p1: { hand: ['Test Slaying', 'Test Surge', 'Test Shrinking'], battlefield: ['Test Glowing Seer', ...bf] } },
  });
  const hand = (s: GameState): number => s.zones.hand.p1!.length;
  const kill = (s: GameState, name: string): GameState => cast(s, 'Test Slaying', { targets: [[obj(onBf(s, name)[0]!)]] });
  it('is automated', () => expect(full(PROPHET)).toBe(true));
  it('a Zombie with a +1/+1 counter dies (power 3, base power 2): draw a card', () => {
    const before = setup([{ name: 'Test Ghoul', counters: { '+1/+1': 1 } }]);
    const s = kill(before, 'Test Ghoul');
    expect(hand(s) - hand(before)).toBe(0); // Slaying left (-1), one card drawn (+1)
  });
  it('a pumped Zombie dies (power 4 until end of turn): draw a card', () => {
    let s = setup(['Test Ghoul']);
    s = cast(s, 'Test Surge', { targets: [[obj(onBf(s, 'Test Ghoul')[0]!)]] });
    const before = hand(s);
    s = kill(s, 'Test Ghoul');
    expect(hand(s) - before).toBe(0);
  });
  it('a plain 2/2 Zombie dies: no card (the negative case); nor a non-Zombie with a counter', () => {
    let s = setup(['Test Ghoul', { name: 'Test Bear', counters: { '+1/+1': 1 } }]);
    const before = hand(s);
    s = kill(s, 'Test Ghoul');
    expect(hand(s) - before).toBe(-1);
  });
  it("a Zombie whose base power an effect set to 2 (printed 5) dies at power 2: no card (base power is the set value, the ruling)", () => {
    let s = setup(['Test Giant Ghoul']);
    s = cast(s, 'Test Shrinking', { targets: [[obj(onBf(s, 'Test Giant Ghoul')[0]!)]] });
    const before = hand(s);
    s = kill(s, 'Test Giant Ghoul');
    expect(hand(s) - before).toBe(-1);
  });
});

// ---- Reality Acid: "When this Aura leaves the battlefield, enchanted permanent's controller sacrifices it." ---------------------------------------------------------------------------

const ACID = card('Test Unreal Acid', 'Enchantment — Aura', 'Enchant permanent\nVanishing 3\nWhen this Aura leaves the battlefield, enchanted permanent\'s controller sacrifices it.');
const UNMAKE = card('Test Unmaking', 'Instant', 'Destroy target enchantment.');
describe('CR 608.2c, 701.21a, 303.4, 603.10a: "When this Aura leaves the battlefield, enchanted permanent\'s controller sacrifices it."', () => {
  const setup = (): GameState => mpScenario({
    defs: [ACID, UNMAKE, BEAR_P, SLAY],
    zones: { p1: { hand: ['Test Unreal Acid', 'Test Unmaking', 'Test Slaying'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } },
  });
  const enchant = (s0: GameState): { s: GameState; bear: string } => {
    const bear = onBf(s0, 'Test Bear')[0]!;
    return { s: cast(s0, 'Test Unreal Acid', { targets: [[obj(bear)]] }), bear };
  };
  it('is automated', () => expect(full(ACID)).toBe(true));
  it("the Aura is destroyed: the enchanted creature's controller sacrifices that creature, and only it", () => {
    const { s: s1, bear } = enchant(setup());
    expect(s1.objects[onBf(s1, 'Test Unreal Acid')[0]!]!.attachedTo).toBe(bear);
    const s = cast(s1, 'Test Unmaking', { targets: [[obj(onBf(s1, 'Test Unreal Acid')[0]!)]] });
    expect(onBf(s, 'Test Bear')).toEqual(onBf(s1, 'Test Bear').filter((id) => id !== bear));
    expect(s.zones.graveyard.p2!.some((id) => nameOf(s, id) === 'Test Bear')).toBe(true);
  });
  it('the enchanted creature dies first: the Aura goes to the graveyard and nothing else is sacrificed (the negative case)', () => {
    const { s: s1, bear } = enchant(setup());
    const s = cast(s1, 'Test Slaying', { targets: [[obj(bear)]] });
    expect(onBf(s, 'Test Unreal Acid').length).toBe(0);
    expect(onBf(s, 'Test Bear').length).toBe(1);
  });
});
