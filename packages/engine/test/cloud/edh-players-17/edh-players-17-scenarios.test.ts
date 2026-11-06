/**
 * edh-players-17 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites checked against MagicCompRules 20260925.
 *
 *   CR 119.1, 119.3, 510.2, 506.3, 104.3   "... you and that player each gain that much life." / "..., each player this creature attacked this turn loses the game."
 *   CR 119.1, 102.3, 603.4, 508.1b         "Whenever a player attacks one of your opponents, if that opponent has more life than another of your opponents, that attacking player draws a card and you put ..."
 *   CR 701.38a, 701.38d, 108.3, 613.1b     "Starting with you, each player votes for time or money. For each time vote, take an extra turn ... For each money vote, choose a permanent owned by the voter and gain control of it."
 *   CR 105.2a, 608.2d, 613.1b, 406.2       "Each player chooses a color. Then exile each permanent unless it's colorless or it's only the color its controller chose."
 *   CR 303.4, 508.1, 506.3, 603.2c         "At the beginning of enchanted opponent's end step, you and that player each draw a card." / "When you attack enchanted opponent or a planeswalker they control or when they attack you ..."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, lifeOf, mpScenario, pass, passUntil, type MpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as unknown as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const handOf = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const named = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p));
const setLife = (x: GameState, life: Partial<Record<PlayerId, number>>): void => { for (const [p, n] of Object.entries(life)) x.players.find((y) => y.id === p)!.life = n!; };

/** Answer what comes up (yes to nothing, the first options) until someone has priority again; `script` picks the colors, options and objects in order. */
interface Script { colors?: string[]; options?: string[][]; objects?: (ObjectId[] | ((options: ObjectId[]) => ObjectId[]))[]; asked?: string[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 120 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.asked?.push(`${p.kind}:${p.player}`);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (script.colors?.shift() ?? p.options[0]) as never });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 120; guard++) s = drive(pass(s), script);
  return s;
}
/** The turn's declaration (the active player's), then the attackers declared and everything resolved. */
function attack(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId | ObjectId }[], script: Script = {}): GameState {
  const s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
  let t = settle(answer(s, { kind: 'declareAttackers', attacks }), script);
  // on through the damage of the combat
  for (let guard = 0; guard < 200 && !['endCombat', 'main2', 'end', 'cleanup'].includes(t.turn.step); guard++) t = t.pending?.kind === 'priority' ? drive(pass(t), script) : drive(t, script);
  return t;
}
/** Pass to the end step of the turn the state is in (the combat damage resolved on the way). */
const toEndStep = (s0: GameState, script: Script = {}): GameState => {
  let s = s0;
  for (let guard = 0; guard < 200 && !(s.turn.step === 'end' && s.pending?.kind === 'priority'); guard++) {
    s = s.pending?.kind === 'priority' ? drive(pass(s), script) : drive(s, script);
  }
  return settle(s, script); // the end step's triggers resolve
};
const game = (o: MpScenario): GameState => mpScenario({ options: { startingPlayer: 'p1' }, ...o });

// ---- Angel of Destiny: "you and that player each gain that much life" and "each player this creature attacked this turn loses the game" ---------------------------------------------

const SERAPH = card('Test Seraph', 'Creature — Angel', 'Whenever a creature you control deals combat damage to a player, you and that player each gain that much life.\nAt the beginning of your end step, if you have at least 15 life more than your starting life total, each player this creature attacked this turn loses the game.', { pt: ['4', '4'] });
const WALKER = card('Test Oath Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
const DEFS_SERAPH = [SERAPH, WALKER, card('Test Hill Raider', 'Creature — Goblin', '', { pt: ['2', '2'] })];

describe('CR 119.1, 119.3, 510.2: "Whenever a creature you control deals combat damage to a player, you and that player each gain that much life."', () => {
  const setup = (zones: NonNullable<MpScenario['zones']> = { p1: { battlefield: ['Test Seraph'] } }): GameState => game({ defs: DEFS_SERAPH, zones });
  it('is automated', () => expect(full(SERAPH)).toBe(true));
  it('you and the player who was dealt the damage each gain as much life as was dealt (the damage first, then both gains), nobody else does', () => {
    const s0 = setup();
    const s = attack(s0, [{ attacker: find(s0, 'Test Seraph', 'battlefield', 'p1'), defender: 'p3' }]);
    expect(lifeOf(s, 'p3')).toBe(20 - 4 + 4);
    expect(lifeOf(s, 'p1')).toBe(24);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p4')).toBe(20);
  });
  it('another creature you control triggers it too, with its own damage (the amount is of the damage event)', () => {
    const s0 = setup({ p1: { battlefield: ['Test Seraph', 'Test Hill Raider'] } });
    const s = attack(s0, [{ attacker: find(s0, 'Test Hill Raider', 'battlefield', 'p1'), defender: 'p2' }]);
    expect(lifeOf(s, 'p2')).toBe(20 - 2 + 2);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
  it('no combat damage to a player (the attacker is blocked or attacks nobody) and damage to a planeswalker gain nothing (the negative cases)', () => {
    const s0 = setup({ p1: { battlefield: ['Test Seraph'] }, p2: { battlefield: [{ name: 'Test Oath Walker', counters: { loyalty: 6 } }] } });
    const walker = find(s0, 'Test Oath Walker', 'battlefield', 'p2');
    const s = attack(s0, [{ attacker: find(s0, 'Test Seraph', 'battlefield', 'p1'), defender: walker }]);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.objects[walker]!.counters['loyalty']).toBe(2);
  });
});

describe('CR 506.3, 508.1, 104.3: "At the beginning of your end step, if you have at least 15 life more than your starting life total, each player this creature attacked this turn loses the game."', () => {
  const rich = (zones: NonNullable<MpScenario['zones']>, life = 40): GameState => game({ defs: DEFS_SERAPH, zones, setup: (x) => setLife(x, { p1: life }) });
  it('the player it attacked this turn loses the game at your end step; the others, and you, do not', () => {
    const s0 = rich({ p1: { battlefield: ['Test Seraph'] } });
    const s1 = attack(s0, [{ attacker: find(s0, 'Test Seraph', 'battlefield', 'p1'), defender: 'p3' }]);
    const s = toEndStep(s1);
    const lost = (p: PlayerId): boolean => s.players.find((x) => x.id === p)!.hasLost === true;
    expect([lost('p1'), lost('p2'), lost('p3'), lost('p4')]).toEqual([false, false, true, false]);
  });
  it('with less than 15 life above the starting life total (35 or more is needed), or with no attack, nobody loses the game (the negative cases)', () => {
    const poor = rich({ p1: { battlefield: ['Test Seraph'] } }, 30); // 30 + 4 gained = 34: one short
    const s = toEndStep(attack(poor, [{ attacker: find(poor, 'Test Seraph', 'battlefield', 'p1'), defender: 'p3' }]));
    expect(lifeOf(s, 'p1')).toBe(34);
    expect(s.players.some((x) => x.hasLost === true)).toBe(false);
    const peaceful = rich({ p1: { battlefield: ['Test Seraph'] } });
    expect(toEndStep(peaceful).players.some((x) => x.hasLost === true)).toBe(false);
  });
  it('a planeswalker it attacked does not make that planeswalker\'s controller a player it attacked', () => {
    const s0 = rich({ p1: { battlefield: ['Test Seraph'] }, p2: { battlefield: [{ name: 'Test Oath Walker', counters: { loyalty: 6 } }] } });
    const s = toEndStep(attack(s0, [{ attacker: find(s0, 'Test Seraph', 'battlefield', 'p1'), defender: find(s0, 'Test Oath Walker', 'battlefield', 'p2') }]));
    expect(s.players.some((x) => x.hasLost === true)).toBe(false);
  });
  it('only the creature itself counts: another creature of yours that attacked a player does not make that player lose', () => {
    const s0 = rich({ p1: { battlefield: ['Test Seraph', 'Test Hill Raider'] } });
    const s = toEndStep(attack(s0, [{ attacker: find(s0, 'Test Hill Raider', 'battlefield', 'p1'), defender: 'p4' }]));
    expect(s.players.some((x) => x.hasLost === true)).toBe(false);
  });
});

describe('CR 119.3, 608.2c: "You and target player each gain 3 life." is one life-gaining event for a player named twice (the ruling of Angel of Destiny)', () => {
  const MEAL = card('Test Shared Meal', 'Sorcery', 'You and target player each gain 3 life.');
  const WATCHER = card('Test Gladdened', 'Creature — Cleric', 'Whenever you gain life, draw a card.', { pt: ['1', '1'] });
  const setup = (): GameState => game({ defs: [MEAL, WATCHER], zones: { p1: { hand: ['Test Shared Meal'], battlefield: ['Test Gladdened'] }, p2: { battlefield: ['Test Gladdened'] } } });
  const cast = (s: GameState, target: PlayerId): GameState => settle(drive(answer(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shared Meal', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [{ kind: 'player', id: target } as TargetChoice] })));
  it('targeting another player: each gains 3 life, one event each, so each of their watchers draws once', () => {
    const s0 = setup();
    const [h1, h2] = [handOf(s0, 'p1') - 1, handOf(s0, 'p2')];
    const s = cast(s0, 'p2');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2')]).toEqual([23, 23]);
    expect([handOf(s, 'p1'), handOf(s, 'p2')]).toEqual([h1 + 1, h2 + 1]);
  });
  it('targeting yourself: you gain 6 life as ONE event (one draw, not two)', () => {
    const s0 = setup();
    const h1 = handOf(s0, 'p1') - 1;
    const s = cast(s0, 'p1');
    expect(lifeOf(s, 'p1')).toBe(26);
    expect(handOf(s, 'p1')).toBe(h1 + 1);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

// ---- Breena: "if that opponent has more life than another of your opponents" ----------------------------------------------------------------------------------------------------

const DEMAGOGUE = card('Test Demagogue', 'Creature — Bird', 'Whenever a player attacks one of your opponents, if that opponent has more life than another of your opponents, that attacking player draws a card and you put two +1/+1 counters on a creature you control.', { pt: ['2', '2'] });
const DEFS_BREENA = [DEMAGOGUE, card('Test Hill Raider', 'Creature — Goblin', '', { pt: ['1', '1'] }), card('Test Wall', 'Creature — Wall', '', { pt: ['0', '4'] })];

describe('CR 119.1, 102.3, 603.4: "Whenever a player attacks one of your opponents, if that opponent has more life than another of your opponents, that attacking player draws a card and you put two +1/+1 counters on a creature you control."', () => {
  const setup = (life: Partial<Record<PlayerId, number>>, zones: NonNullable<MpScenario['zones']> = {}, startingPlayer: PlayerId = 'p1'): GameState => mpScenario({
    defs: DEFS_BREENA, options: { startingPlayer },
    zones: { p1: { battlefield: ['Test Demagogue', 'Test Wall'] }, p2: { battlefield: ['Test Hill Raider'] }, p3: { battlefield: ['Test Hill Raider'] }, ...zones },
    setup: (x) => setLife(x, life),
  });
  const counters = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).reduce((n, id) => n + (s.objects[id]!.counters['+1/+1'] ?? 0), 0);
  it('is automated', () => expect(full(DEMAGOGUE)).toBe(true));
  it('you attack an opponent with more life than another opponent: you draw a card and put two +1/+1 counters on a creature you control', () => {
    const s0 = setup({ p2: 25, p3: 20, p4: 15 });
    const hand0 = handOf(s0, 'p1');
    const s = attack(s0, [{ attacker: find(s0, 'Test Demagogue', 'battlefield', 'p1'), defender: 'p2' }], { objects: [(o) => [o[0]!]] });
    expect(handOf(s, 'p1')).toBe(hand0 + 1);
    expect(counters(s, 'p1')).toBe(2);
  });
  it('another player attacking one of your opponents draws (that attacking player), and you still get the counters', () => {
    const s0 = setup({ p3: 25, p4: 15 }, {}, 'p2');
    const [h1, h2] = [handOf(s0, 'p1'), handOf(s0, 'p2')];
    const s = attack(s0, [{ attacker: find(s0, 'Test Hill Raider', 'battlefield', 'p2'), defender: 'p3' }], { objects: [(o) => [o[0]!]] });
    expect(handOf(s, 'p2')).toBe(h2 + 1);
    expect(handOf(s, 'p1')).toBe(h1);
    expect(counters(s, 'p1')).toBe(2);
  });
  it('the lowest-life opponent, an opponent tied with every other opponent, and a player attacking you do nothing (the negative cases)', () => {
    const lowest = setup({ p2: 25, p3: 20, p4: 15 });
    let s = attack(lowest, [{ attacker: find(lowest, 'Test Demagogue', 'battlefield', 'p1'), defender: 'p4' }]);
    expect([handOf(s, 'p1'), counters(s, 'p1')]).toEqual([handOf(lowest, 'p1'), 0]);
    const tied = setup({ p2: 20, p3: 20, p4: 20 });
    s = attack(tied, [{ attacker: find(tied, 'Test Demagogue', 'battlefield', 'p1'), defender: 'p2' }]);
    expect([handOf(s, 'p1'), counters(s, 'p1')]).toEqual([handOf(tied, 'p1'), 0]);
    const toYou = setup({ p1: 30, p3: 20, p4: 10 }, {}, 'p2');
    s = attack(toYou, [{ attacker: find(toYou, 'Test Hill Raider', 'battlefield', 'p2'), defender: 'p1' }]);
    expect(counters(s, 'p1')).toBe(0); // you are not one of your opponents
  });
  it('one declaration at two opponents is one trigger for each opponent with more life than another opponent (not for the lowest)', () => {
    const s0 = setup({ p2: 30, p3: 25, p4: 20 }, { p1: { battlefield: ['Test Demagogue', 'Test Wall', 'Test Hill Raider', 'Test Hill Raider'] } });
    const raiders = named(s0, 'Test Hill Raider', 'p1');
    const s = attack(s0, [{ attacker: raiders[0]!, defender: 'p2' }, { attacker: raiders[1]!, defender: 'p3' }, { attacker: find(s0, 'Test Demagogue', 'battlefield', 'p1'), defender: 'p4' }], { objects: [(o) => [o[0]!], (o) => [o[0]!]] });
    expect(handOf(s, 'p1')).toBe(handOf(s0, 'p1') + 2); // p2 and p3 each, p4 (lowest) none
    expect(counters(s, 'p1')).toBe(4);
  });
  it('the life totals are compared as the trigger goes on the stack and again as it resolves (CR 603.4)', () => {
    const s0 = setup({ p2: 25, p3: 24, p4: 15 });
    const s1 = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
    let s = answer(s1, { kind: 'declareAttackers', attacks: [{ attacker: find(s1, 'Test Demagogue', 'battlefield', 'p1'), defender: 'p2' }] });
    expect(s.zones.stack.length).toBe(1); // the trigger is on the stack: p2 (25) has more life than p3 (24)
    s.players.find((x) => x.id === 'p2')!.life = 10; // an effect in response drops p2 below everyone
    const hand0 = handOf(s, 'p1');
    s = settle(s);
    expect(handOf(s, 'p1')).toBe(hand0); // no longer true as it resolves: nothing happens
    expect(counters(s, 'p1')).toBe(0);
  });
});


// ---- Expropriate: "For each time vote, take an extra turn after this one. For each money vote, choose a permanent owned by the voter and gain control of it." -------------------------

const RECKONING = card('Test Reckoning', 'Sorcery', 'Starting with you, each player votes for time or money. For each time vote, take an extra turn after this one. For each money vote, choose a permanent owned by the voter and gain control of it. Exile Test Reckoning.');
const IDOL = (n: string): CardDef => card(`Test Idol ${n}`, 'Artifact', '');

describe('CR 701.38a, 701.38d, 108.3, 613.1b: "For each time vote, take an extra turn after this one. For each money vote, choose a permanent owned by the voter and gain control of it."', () => {
  const defs = [RECKONING, IDOL('A'), IDOL('B'), IDOL('C'), IDOL('D')];
  const setup = (zones: NonNullable<MpScenario['zones']> = {}, setupFn?: (x: GameState) => void): GameState => game({
    defs, zones: { ...zones, p1: { hand: ['Test Reckoning'], ...(zones.p1 ?? {}) } }, ...(setupFn !== undefined ? { setup: setupFn } : {}),
  });
  const cast = (s: GameState, script: Script): GameState => settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Reckoning', 'hand', 'p1') }), script), script);
  const idols = (s: GameState, p: PlayerId): string[] => named(s, 'Test Idol A', p).concat(named(s, 'Test Idol B', p), named(s, 'Test Idol C', p), named(s, 'Test Idol D', p)).map((id) => s.defs[s.objects[id]!.defId]!.name.slice(-1)).sort();
  it('is automated', () => expect(full(RECKONING)).toBe(true));
  it('each time vote is one extra turn (queued after this one); each money vote lets you choose a permanent its voter owns and gain control of it for good', () => {
    const s0 = setup({ p2: { battlefield: ['Test Idol A'] }, p3: { battlefield: ['Test Idol B'] }, p4: { battlefield: ['Test Idol C'] } });
    // p1 time, p2 money, p3 money, p4 time
    const s = cast(s0, { options: [['time'], ['money'], ['money'], ['time']] });
    expect(idols(s, 'p1')).toEqual(['A', 'B']); // p2's and p3's, taken
    expect(idols(s, 'p4')).toEqual(['C']); // p4 voted for time: untouched
    expect(idols(s, 'p2')).toEqual([]);
    expect(s.turn.extraTurns.length).toBe(2); // two time votes: two extra turns
    expect(s.turn.extraTurns.every((p) => p === 'p1')).toBe(true);
    expect(find(s, 'Test Reckoning', 'exile', 'p1')).toBeDefined(); // exiled as the last instruction
  });
  it('"owned by" is ownership, not control: a permanent the voter owns but another player controls is a choice, one the voter controls but does not own is not', () => {
    // idol B is owned by p2 and controlled by p4; idol C is owned by p3 and controlled by p2
    const s0 = setup({ p2: { battlefield: ['Test Idol A'] }, p3: { battlefield: ['Test Idol C'] }, p4: { battlefield: ['Test Idol B'] } }, (x) => {
      const b = x.zones.battlefield.find((id) => x.defs[x.objects[id]!.defId]!.name === 'Test Idol B')!;
      x.objects[b]!.owner = 'p2';
      const c = x.zones.battlefield.find((id) => x.defs[x.objects[id]!.defId]!.name === 'Test Idol C')!;
      x.objects[c]!.controller = 'p2';
    });
    let offered: ObjectId[] = [];
    const s = cast(s0, { options: [['time'], ['money'], ['time'], ['time']], objects: [(o) => { offered = o; return [o[o.length - 1]!]; }] });
    expect(offered.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Test Idol A', 'Test Idol B']);
    expect(s.objects[offered[offered.length - 1]!]!.controller).toBe('p1');
    expect(s.objects[offered[offered.length - 1]!]!.owner).toBe('p2');
    expect(idols(s, 'p2')).toEqual(['A', 'C']); // the one p2 controls but does not own stays with p2, and so does the one not chosen
  });
  it('no money vote: nothing changes hands; a money voter who owns nothing gives nothing (the negative cases)', () => {
    const s0 = setup({ p3: { battlefield: ['Test Idol A'] } });
    let s = cast(s0, { options: [['time'], ['time'], ['time'], ['time']] });
    expect(idols(s, 'p3')).toEqual(['A']);
    expect(s.turn.extraTurns.length).toBe(4);
    s = cast(s0, { options: [['money'], ['money'], ['time'], ['time']] }); // p1 and p2 vote money and own no permanent
    expect(idols(s, 'p3')).toEqual(['A']);
    expect(s.turn.extraTurns.length).toBe(2);
  });
  it('a voter with an additional vote (CR 701.38d) who votes money twice is chosen from twice: two permanents of theirs change hands, without an order question', () => {
    const DELEGATE = card('Test Delegate', 'Creature — Advisor', 'While voting, you get an additional vote.', { pt: ['1', '1'] });
    const s0 = game({ defs: [...defs, DELEGATE], zones: { p1: { hand: ['Test Reckoning'] }, p2: { battlefield: ['Test Delegate', 'Test Idol A', 'Test Idol B'] } } });
    const asked: string[] = [];
    const s = cast(s0, { options: [['time'], ['money', 'money'], ['time'], ['time']], objects: [[find(s0, 'Test Idol A', 'battlefield', 'p2')], [find(s0, 'Test Idol B', 'battlefield', 'p2')]], asked });
    expect(idols(s, 'p1')).toEqual(['A', 'B']);
    expect(asked.filter((x) => x.startsWith('order')).length).toBe(0);
    expect(s.turn.extraTurns.length).toBe(3);
  });
  it('a vote for yourself: your own money vote lets you choose among your own permanents (and nothing else changes)', () => {
    const s0 = setup({ p1: { battlefield: ['Test Idol D'] }, p2: { battlefield: ['Test Idol A'] } });
    const s = cast(s0, { options: [['money'], ['time'], ['time'], ['time']] });
    expect(idols(s, 'p1')).toEqual(['D']);
    expect(idols(s, 'p2')).toEqual(['A']);
  });
});

// ---- Selective Obliteration: "Each player chooses a color. Then exile each permanent unless it's colorless or it's only the color its controller chose." -----------------------------

const OBLITERATION = card('Test Obliteration', 'Sorcery', 'Each player chooses a color. Then exile each permanent unless it\'s colorless or it\'s only the color its controller chose.');
const mono = (n: string, c: string, type = 'Creature — Bear'): CardDef => card(n, type, '', { pt: ['2', '2'], colors: [c] });
const DEFS_OBLIT = [OBLITERATION, mono('Test Red Bear', 'R'), mono('Test Blue Bear', 'U'), mono('Test Green Bear', 'G'), mono('Test White Bear', 'W'), mono('Test Black Bear', 'B'),
  card('Test Gold Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['R', 'U'] }), card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['2', '2'] }), card('Test Idol A', 'Artifact', '')];

describe("CR 105.2a, 105.2c, 608.2d, 613.1b: 'Each player chooses a color. Then exile each permanent unless it's colorless or it's only the color its controller chose.'", () => {
  const setup = (zones: NonNullable<MpScenario['zones']>, fn?: (x: GameState) => void): GameState => game({ defs: DEFS_OBLIT, zones: { ...zones, p1: { hand: ['Test Obliteration'], ...(zones.p1 ?? {}) } }, ...(fn !== undefined ? { setup: fn } : {}) });
  const cast = (s: GameState, colors: string[]): GameState => settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Obliteration', 'hand', 'p1') }), { colors }), { colors });
  const left = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
  it('is automated', () => expect(full(OBLITERATION)).toBe(true));
  it('each permanent is judged by its own controller\'s choice: colorless and mono-colored in that color stay; other colors, and gold permanents, are exiled', () => {
    const s0 = setup({
      p1: { battlefield: ['Test Red Bear', 'Test Blue Bear', 'Test Gold Bear', 'Test Golem', 'Plains'] },
      p2: { battlefield: ['Test Blue Bear', 'Test Red Bear', 'Test Idol A'] },
      p3: { battlefield: ['Test Green Bear', 'Test White Bear'] },
      p4: { battlefield: ['Test Black Bear'] },
    });
    const s = cast(s0, ['R', 'U', 'G', 'W']); // p1 red, p2 blue, p3 green, p4 white
    expect(left(s, 'p1')).toEqual(['Plains', 'Test Golem', 'Test Red Bear']);
    expect(left(s, 'p2')).toEqual(['Test Blue Bear', 'Test Idol A']);
    expect(left(s, 'p3')).toEqual(['Test Green Bear']);
    expect(left(s, 'p4')).toEqual([]); // black while white was chosen
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Test Black Bear', 'Test Blue Bear', 'Test Gold Bear', 'Test Red Bear', 'Test White Bear']);
  });
  it('it is the controller\'s choice, not the owner\'s: a creature p1 owns but p3 controls, and one p3 owns but p1 controls', () => {
    const s0 = setup({ p1: { battlefield: ['Test Red Bear'] }, p3: { battlefield: ['Test Green Bear'] } }, (x) => {
      const swap = (name: string, to: PlayerId): void => { const id = x.zones.battlefield.find((o) => x.defs[x.objects[o]!.defId]!.name === name)!; x.objects[id]!.controller = to; };
      swap('Test Red Bear', 'p3'); // p1 owns it, p3 controls it (p3 chose green): exiled
      swap('Test Green Bear', 'p1'); // p3 owns it, p1 controls it (p1 chose red): exiled
    });
    const s = cast(s0, ['R', 'U', 'G', 'W']);
    expect(left(s, 'p1')).toEqual([]);
    expect(left(s, 'p3')).toEqual([]);
  });
  it('a player whose chosen color matches nothing of theirs loses only the other colors; colorless permanents and lands are never exiled (the negative case)', () => {
    const s0 = setup({ p1: { battlefield: ['Plains', 'Test Golem', 'Test Idol A'] } });
    const s = cast(s0, ['R', 'U', 'G', 'W']);
    expect(left(s, 'p1')).toEqual(['Plains', 'Test Golem', 'Test Idol A']);
    expect(s.zones.exile.length).toBe(0);
  });
});

// ---- Tenuous Truce: "enchanted opponent" ---------------------------------------------------------------------------------------------------------------------------------------------

const TRUCE = card('Test Truce', 'Enchantment — Aura', 'Enchant opponent\nAt the beginning of enchanted opponent\'s end step, you and that player each draw a card.\nWhen you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control, sacrifice this Aura.');
const DEFS_TRUCE = [TRUCE, WALKER, card('Test Hill Raider', 'Creature — Goblin', '', { pt: ['1', '1'] })];

describe('CR 303.4, 508.1, 506.3, 603.2c: "At the beginning of enchanted opponent\'s end step, you and that player each draw a card." / "When you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control, sacrifice this Aura."', () => {
  const setup = (starting: PlayerId, zones: NonNullable<MpScenario['zones']> = {}): GameState => mpScenario({
    defs: DEFS_TRUCE, options: { startingPlayer: starting },
    zones: { ...zones, p1: { battlefield: ['Test Truce', 'Test Hill Raider'], ...(zones.p1 ?? {}) }, p2: { battlefield: ['Test Hill Raider'], ...(zones.p2 ?? {}) }, p3: { battlefield: ['Test Hill Raider'], ...(zones.p3 ?? {}) } },
    setup: (x) => { x.objects[x.zones.battlefield.find((id) => x.defs[x.objects[id]!.defId]!.name === 'Test Truce')!]!.attachedTo = 'p3'; },
  });
  const truce = (s: GameState): number => named(s, 'Test Truce').length;
  it('is automated', () => expect(full(TRUCE)).toBe(true));
  it('at the end step of the enchanted opponent (p3), you and that player each draw a card; nobody else does', () => {
    const s0 = setup('p3');
    const before = ['p1', 'p2', 'p3', 'p4'].map((p) => handOf(s0, p as PlayerId));
    const s = toEndStep(s0);
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => handOf(s, p as PlayerId) - before[['p1', 'p2', 'p3', 'p4'].indexOf(p)]!)).toEqual([1, 0, 1, 0]);
  });
  it('at another opponent\'s end step, or your own, nothing is drawn (the negative cases)', () => {
    for (const starting of ['p2', 'p1'] as const) {
      const s0 = setup(starting);
      const before = ['p1', 'p2', 'p3', 'p4'].map((p) => handOf(s0, p as PlayerId));
      const s = toEndStep(s0);
      expect(['p1', 'p2', 'p3', 'p4'].map((p, i) => handOf(s, p as PlayerId) - before[i]!), starting).toEqual([0, 0, 0, 0]);
    }
  });
  it('you attacking the enchanted opponent, or a planeswalker they control, sacrifices the Aura', () => {
    const s0 = setup('p1');
    expect(truce(attack(s0, [{ attacker: find(s0, 'Test Hill Raider', 'battlefield', 'p1'), defender: 'p3' }]))).toBe(0);
    const w0 = setup('p1', { p3: { battlefield: ['Test Hill Raider', { name: 'Test Oath Walker', counters: { loyalty: 5 } }] } });
    expect(truce(attack(w0, [{ attacker: find(w0, 'Test Hill Raider', 'battlefield', 'p1'), defender: find(w0, 'Test Oath Walker', 'battlefield', 'p3') }]))).toBe(0);
  });
  it('the enchanted opponent attacking you, or a planeswalker you control, sacrifices the Aura', () => {
    const s0 = setup('p3');
    expect(truce(attack(s0, [{ attacker: find(s0, 'Test Hill Raider', 'battlefield', 'p3'), defender: 'p1' }]))).toBe(0);
    const w0 = setup('p3', { p1: { battlefield: ['Test Truce', 'Test Hill Raider', { name: 'Test Oath Walker', counters: { loyalty: 5 } }] } });
    expect(truce(attack(w0, [{ attacker: find(w0, 'Test Hill Raider', 'battlefield', 'p3'), defender: find(w0, 'Test Oath Walker', 'battlefield', 'p1') }]))).toBe(0);
  });
  it('you attacking someone else, the enchanted opponent attacking someone else, and a third player attacking you leave the Aura (the negative cases)', () => {
    const a = setup('p1');
    expect(truce(attack(a, [{ attacker: find(a, 'Test Hill Raider', 'battlefield', 'p1'), defender: 'p2' }]))).toBe(1);
    const b = setup('p3');
    expect(truce(attack(b, [{ attacker: find(b, 'Test Hill Raider', 'battlefield', 'p3'), defender: 'p2' }]))).toBe(1);
    const c = setup('p2');
    expect(truce(attack(c, [{ attacker: find(c, 'Test Hill Raider', 'battlefield', 'p2'), defender: 'p1' }]))).toBe(1);
  });
});
