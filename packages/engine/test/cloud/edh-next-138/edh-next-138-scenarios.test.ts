/**
 * Round edh-next-138 (must-finish round "tokens"): the behaviour it added, played through the engine with synthetic cards (invented names, the printed wordings of the
 * real cards), compiled by the game's default compiler, in multiplayer games, with the negative cases.
 *
 *   CR 115.1, 601.2c, 608.2f, 611.2b,       Welcome to . . . (chapter I): "For each opponent, up to one target noncreature artifact they control becomes a 0/4 Wall artifact
 *   613.1d, 613.4b                          creature with defender for as long as you control this Saga." (ruling 2023-11-10: if the Saga left before the ability resolves, the
 *                                           artifacts never become Walls)
 *   CR 113.6k, 601.2h, 603.4, 106.1b        Drowner of Truth: "When you cast this spell, if {C} was spent to cast it, create two 0/1 colorless Eldrazi Spawn creature tokens with
 *                                           "Sacrifice this token: Add {C}."" (the trigger works on the stack; the colorless mana is read from the spell's own payment)
 *   CR 601.2i, 603.2, 608.2c, 608.2g,       Baral and Kari Zev: "Whenever you cast your first instant or sorcery spell each turn, you may cast a spell with lesser mana value that
 *   111.1, 611.2a                           shares a card type with it from your hand without paying its mana cost. If you don't, create First Mate Ragavan, a legendary 2/1 red
 *                                           Monkey Pirate creature token. It gains haste until end of turn." (rulings 2023-04-14: the free spell resolves first)
 *   CR 701.21a, 400.3, 603.7, 400.7,        Desert Warfare: "Whenever you sacrifice a Desert and whenever a Desert card is put into your graveyard from your hand or library, put that
 *   603.4, 608.2h, 611.2a                   card onto the battlefield under your control at the beginning of your next end step. At the beginning of combat on your turn, if you
 *                                           control five or more Deserts, create that many 1/1 red, green, and white Sand Warrior creature tokens. They gain haste." (rulings
 *                                           2024-06-07: a Desert that left the graveyard first is not returned)
 *   CR 614.12a, 119.4, 107.1b, 607.2d,      Phyrexian Processor: "As this artifact enters, pay any amount of life. {4}, {T}: Create an X/X black Phyrexian Minion creature token, where X
 *   608.2h                                  is the life paid as this artifact entered." (ruling 2004-10-04: you can pay 0 life)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities } from '../../../src/rules/abilities';
import { compileCard, getChars, legalActions, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, mpScenario, pass } from '../../m12/rules/helpers';
import { full } from '../r3-cost/support';
import { castWith, synthetic } from '../../m6/costs/support';
import { commanderRec, commanderScenario, forests, legend } from '../../m11/rules/helpers';
import { tweak } from '../../m4/helpers';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const idOf = (s: GameState, name: string, controller: PlayerId): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name && s.objects[id]!.controller === controller)!;
const targetsOf = (...ids: string[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) });
/** Passes priority until the stack is empty, answering anything else with the defaults. */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 200; i++) {
    const p = s.pending;
    if (p === null || p === undefined || s.result) break;
    if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); continue; }
    if (p.kind === 'payCost') { s = answer(s, { kind: 'payCost', auto: true }); continue; }
    if (p.kind === 'order') { s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) }); continue; }
    throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
  }
  return s;
}
interface Script { number?: number; targets?: ObjectId[]; option?: (options: { id: string; label: string }[], prompt: string) => string | string[]; yes?: (prompt: string) => boolean; objects?: (options: ObjectId[], s: GameState, prompt: string) => ObjectId[]; asked?: string[] }
/** settle(), answering the yes/no and object choices from the script (default: yes, and the minimum). */
function play(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined || s.result) break;
    const d = p as unknown as { min?: number; max?: number; prompt: string; options?: ObjectId[] };
    if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); continue; }
    if (p.kind === 'payCost') { s = answer(s, { kind: 'payCost', auto: true }); continue; }
    if (p.kind === 'order') { s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) }); continue; }
    if (p.kind === 'yesNo') { sc.asked?.push(d.prompt); s = answer(s, { kind: 'yesNo', yes: sc.yes ? sc.yes(d.prompt) : true }); continue; }
    if (p.kind === 'chooseObjects') { sc.asked?.push(d.prompt); s = answer(s, { kind: 'chooseObjects', ids: sc.objects ? sc.objects(d.options ?? [], s, d.prompt) : (d.options ?? []).slice(0, d.min ?? 0) }); continue; }
    if (p.kind === 'chooseNumber') { sc.asked?.push(d.prompt); s = answer(s, { kind: 'chooseNumber', n: sc.number ?? d.min ?? 0 } as DecisionAnswer); continue; }
    if (p.kind === 'chooseOption') {
      const o = (p as unknown as { options: { id: string; label: string }[] }).options;
      sc.asked?.push(d.prompt);
      const pick = sc.option ? sc.option(o, d.prompt) : o[0]!.id;
      s = answer(s, { kind: 'chooseOption', ids: Array.isArray(pick) ? pick : [pick] } as DecisionAnswer); continue;
    }
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      const ids = sc.targets !== undefined && sc.targets.length > 0 ? [sc.targets.shift()!] : (t.objects ?? []).slice(0, t.min ?? 0);
      s = answer(s, { kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer); continue;
    }
    throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
  }
  return s;
}
/** Plays on (default answers, no attacks) until the turn is at `step` of turn `turn` (or later) with an empty stack (`withStack`: whatever is on the stack, at the first priority there). */
function toStep(s0: GameState, step: string, turn: number, withStack = false): GameState {
  let s = s0;
  for (let i = 0; i < 2000; i++) {
    const p = s.pending;
    if (p === null || p === undefined || s.result) break;
    if (p.kind === 'priority' && (withStack || s.zones.stack.length === 0) && (s.turn.number > turn || (s.turn.number === turn && s.turn.step === step))) break;
    if (p.kind === 'priority') { s = pass(s); continue; }
    if (p.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: [] } as DecisionAnswer); continue; }
    if (p.kind === 'declareBlockers') { s = answer(s, { kind: 'declareBlockers', blocks: [] } as DecisionAnswer); continue; }
    s = play(s, {});
    if (s.pending?.kind !== 'priority' && s.pending?.kind !== 'declareAttackers' && s.pending?.kind !== 'declareBlockers') {
      const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number };
      if (d?.kind === 'discard' || d?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.options ?? []).slice(0, d.min ?? 0) } as DecisionAnswer);
      else if (s.pending) throw new Error(`unexpected ${s.pending.kind}: ${s.pending.prompt}`);
    }
  }
  return s;
}
const activate = (s: GameState, source: ObjectId, index = 0, player: PlayerId = 'p1'): GameState => act(s, { type: 'activate', player, source, ability: activatedAbilities(s, s.objects[source]!)[index]!.key } as never);

describe('CR 115.1, 601.2c, 611.2b, 613.4b: "For each opponent, up to one target noncreature artifact they control becomes a 0/4 Wall artifact creature with defender for as long as you control ~." (Welcome to . . .)', () => {
  const PARK = synthetic('Test Park Gate', 'Artifact', '{0}', '{0}: For each opponent, up to one target noncreature artifact they control becomes a 0/4 Wall artifact creature with defender for as long as you control Test Park Gate.\n{0}, Sacrifice Test Park Gate: You gain 1 life.');
  const ROCK = synthetic('Test Rock', 'Artifact', '{1}', '{T}: Add {C}.');
  const COG = synthetic('Test Cog', 'Artifact', '{1}', '');
  const GOLEM = synthetic('Test Golem', 'Artifact Creature — Golem', '{1}', '', { power: '3', toughness: '3' });
  const defs = [PARK, ROCK, COG, GOLEM];
  const board = (): GameState => mpScenario({ players: 4, defs, zones: { p1: { battlefield: ['Test Park Gate', 'Test Cog'] }, p2: { battlefield: ['Test Rock', 'Test Golem'] }, p3: { battlefield: ['Test Cog'] }, p4: { battlefield: ['Test Rock'] } } });
  const wall = (s: GameState, id: ObjectId) => { const c = getChars(s, id); return { types: [...c.types].sort(), subtypes: [...c.subtypes], power: c.power === undefined ? undefined : Number(c.power), toughness: c.toughness === undefined ? undefined : Number(c.toughness), defender: JSON.stringify(c.abilities).includes('"defender"') }; };

  it('is full: one target spec, at most one target for each opponent, controlled by that opponent', () => {
    expect(full(PARK), JSON.stringify(PARK.automation)).toBe(true);
    const t = (PARK.faces[0]!.abilities[0] as unknown as { effect: { targets: { perOpponent?: boolean; min: number; max: number; filter: { controller?: string } }[] } }).effect.targets;
    expect([t.length, t[0]!.perOpponent, t[0]!.min, t[0]!.max, t[0]!.filter.controller]).toEqual([1, true, 0, 1, 'opponent']);
  });
  it('each opponent\'s chosen noncreature artifact becomes a 0/4 Wall artifact creature with defender (and stays an artifact)', () => {
    const s0 = board();
    const rock2 = idOf(s0, 'Test Rock', 'p2'); const cog3 = idOf(s0, 'Test Cog', 'p3');
    const s = settle(answer(activate(s0, idOf(s0, 'Test Park Gate', 'p1')), targetsOf(rock2, cog3)));
    for (const id of [rock2, cog3]) expect(wall(s, id)).toEqual({ types: ['Artifact', 'Creature'], subtypes: ['Wall'], power: 0, toughness: 4, defender: true });
    // p4 had no target chosen ("up to one"): its artifact is unchanged; my own artifact was never a legal target
    expect(getChars(s, idOf(s, 'Test Rock', 'p4')).types).toEqual(['Artifact']);
    expect(getChars(s, idOf(s, 'Test Cog', 'p1')).types).toEqual(['Artifact']);
  });
  it('negative: two targets controlled by the same opponent, a creature artifact, or an artifact I control are refused', () => {
    const s0 = board();
    const gate = idOf(s0, 'Test Park Gate', 'p1');
    const s1 = activate(s0, gate);
    expect(() => answer(s1, targetsOf(idOf(s0, 'Test Golem', 'p2')))).toThrow();
    expect(() => answer(s1, targetsOf(idOf(s0, 'Test Cog', 'p1')))).toThrow();
    // two of p2's artifacts: p2 owns one Rock only, so use p2's Rock and the Golem (a creature) - refused; one for p2 and one for p4 is fine
    expect(() => answer(s1, targetsOf(idOf(s0, 'Test Rock', 'p2'), idOf(s0, 'Test Golem', 'p2')))).toThrow();
    expect(() => answer(s1, targetsOf(idOf(s0, 'Test Rock', 'p2'), idOf(s0, 'Test Rock', 'p4')))).not.toThrow();
  });
  it('the change ends once I no longer control the source (CR 611.2b)', () => {
    const s0 = board();
    const gate = idOf(s0, 'Test Park Gate', 'p1'); const rock2 = idOf(s0, 'Test Rock', 'p2');
    let s = settle(answer(activate(s0, gate), targetsOf(rock2)));
    expect(wall(s, rock2).subtypes).toEqual(['Wall']);
    s = settle(activate(s, gate, 1));
    expect(s.zones.battlefield).not.toContain(gate);
    expect(wall(s, rock2)).toEqual({ types: ['Artifact'], subtypes: [], power: undefined, toughness: undefined, defender: false });
  });
  it('negative (ruling): the source left before the ability resolves: the artifact never becomes a Wall', () => {
    const s0 = board();
    const gate = idOf(s0, 'Test Park Gate', 'p1'); const rock2 = idOf(s0, 'Test Rock', 'p2');
    let s = answer(activate(s0, gate), targetsOf(rock2));
    s = settle(activate(s, gate, 1)); // the sacrifice ability resolves first, then the Wall ability
    expect(s.zones.battlefield).not.toContain(gate);
    expect(getChars(s, rock2).types).toEqual(['Artifact']);
    expect(getChars(s, rock2).subtypes).toEqual([]);
  });
});

describe('CR 113.6k, 601.2h, 603.4: "When you cast this spell, if {C} was spent to cast it, create two 0/1 colorless Eldrazi Spawn creature tokens ..." (Drowner of Truth)', () => {
  const DROWNER = synthetic('Test Drowner', 'Creature — Eldrazi Horror', '{2}{G}', 'Devoid\nWhen you cast this spell, if {C} was spent to cast it, create two 0/1 colorless Eldrazi Spawn creature tokens with "Sacrifice this token: Add {C}."', { power: '4', toughness: '3' });
  const WASTE = synthetic('Test Waste', 'Land', '', '{T}: Add {C}.');
  const GROVE = synthetic('Test Grove', 'Land', '', '{T}: Add {G}.');
  const CANCEL = synthetic('Test Cancel', 'Instant', '{0}', 'Counter target spell.');
  const board = (lands: string[]): GameState => mpScenario({ players: 4, defs: [DROWNER, WASTE, GROVE, CANCEL], zones: { p1: { hand: ['Test Drowner', 'Test Cancel'], battlefield: lands } } });
  const spawns = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1' && getChars(s, id).subtypes.includes('Spawn'));
  it('is full: a cast trigger on the stack whose intervening "if" reads the spell\'s own colorless mana', () => {
    expect(full(DROWNER), JSON.stringify(DROWNER.automation)).toBe(true);
    const t = DROWNER.faces[0]!.abilities[1] as unknown as { zone: string[]; interveningIf: unknown };
    expect(t.zone).toEqual(['stack']);
    expect(t.interveningIf).toEqual({ cond: 'wasCast', spent: { color: 'C', atLeast: 1 } });
  });
  it('{C} was spent: two 0/1 Spawn tokens, each with its mana ability, while the spell is still on the stack', () => {
    let s = castWith(board(['Test Waste', 'Test Grove', 'Test Grove']), 'Test Drowner');
    expect(s.zones.stack.length).toBe(2); // the spell and its trigger above it
    s = pass(s); for (let i = 0; i < 3 && s.zones.stack.length === 2; i++) s = pass(s);
    const toks = spawns(s);
    expect(toks.length).toBe(2);
    for (const id of toks) { const c = getChars(s, id); expect([Number(c.power), Number(c.toughness), c.colors.length]).toEqual([0, 1, 0]); }
    expect(activatedAbilities(s, s.objects[toks[0]!]!).length).toBe(1);
    s = settle(s);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Drowner')).toBe(true);
  });
  it('ruling 2024-06-07: the spell is countered in response, the trigger still resolves (the payment is the spell\'s, read as it was cast)', () => {
    let s = castWith(board(['Test Waste', 'Test Grove', 'Test Grove']), 'Test Drowner');
    const drowner = s.zones.stack[0]!;
    s = castWith(s, 'Test Cancel', [targetsOf(drowner)]);
    s = settle(s);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Drowner')).toBe(false);
    expect(spawns(s).length).toBe(2);
  });
  it('negative: no colorless mana spent (green only): no trigger tokens', () => {
    const s = settle(castWith(board(['Test Grove', 'Test Grove', 'Test Grove']), 'Test Drowner'));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Drowner')).toBe(true);
    expect(spawns(s).length).toBe(0);
  });
});

describe('CR 601.2i, 608.2c, 111.1: "... you may cast a spell with lesser mana value that shares a card type with it ... If you don\'t, create First Mate Ragavan ... It gains haste until end of turn." (Baral and Kari Zev)', () => {
  const BARAL = synthetic('Test Baral Pair', 'Legendary Creature — Human Pirate', '{1}{U}{R}', 'First strike, menace\nWhenever you cast your first instant or sorcery spell each turn, you may cast a spell with lesser mana value that shares a card type with it from your hand without paying its mana cost. If you don\'t, create First Mate Ragavan, a legendary 2/1 red Monkey Pirate creature token. It gains haste until end of turn.', { power: '1', toughness: '4' });
  const BIG = synthetic('Test Big Idea', 'Instant', '{3}', 'You gain 3 life.');
  const SMALL = synthetic('Test Small Idea', 'Instant', '{1}', 'You gain 1 life.');
  const PLAN = synthetic('Test Small Plan', 'Sorcery', '{1}', 'You gain 2 life.');
  const SAME = synthetic('Test Same Idea', 'Instant', '{3}', 'You gain 4 life.');
  const WASTE = synthetic('Test Waste', 'Land', '', '{T}: Add {C}.');
  const board = (hand: string[]): GameState => mpScenario({ players: 4, defs: [BARAL, BIG, SMALL, PLAN, SAME, WASTE], zones: { p1: { hand, battlefield: ['Test Baral Pair', 'Test Waste', 'Test Waste', 'Test Waste', 'Test Waste'] } } });
  const life = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  const monkeys = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && nameOf(s, id) === 'First Mate Ragavan');
  it('is full', () => expect(full(BARAL), JSON.stringify(BARAL.automation)).toBe(true));
  it('casts the cheaper instant from the hand for free (offered: lesser mana value and a shared card type only); no token', () => {
    let offered: string[] = [];
    const s = play(castWith(board(['Test Big Idea', 'Test Small Idea', 'Test Small Plan', 'Test Same Idea']), 'Test Big Idea'), { objects: (o, st) => { offered = o.map((id) => nameOf(st, id)).sort(); return o.filter((id) => nameOf(st, id) === 'Test Small Idea'); } });
    expect(offered).toEqual(['Test Small Idea']);
    expect(life(s)).toBe(20 + 3 + 1);
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id)).sort()).toEqual(['Test Big Idea', 'Test Small Idea']);
    expect(monkeys(s).length).toBe(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.tapped).length).toBe(3); // only the Big Idea was paid for
  });
  it('negative: declined (or nothing to cast): First Mate Ragavan, a legendary 2/1 red Monkey Pirate with haste this turn', () => {
    for (const hand of [['Test Big Idea', 'Test Small Idea'], ['Test Big Idea', 'Test Same Idea']]) {
      const s = play(castWith(board(hand), 'Test Big Idea'), { objects: () => [], yes: () => false });
      const m = monkeys(s);
      expect(m.length, hand.join()).toBe(1);
      const c = getChars(s, m[0]!);
      expect([Number(c.power), Number(c.toughness), [...c.colors], [...c.supertypes], [...c.subtypes].sort()]).toEqual([2, 1, ['R'], ['Legendary'], ['Monkey', 'Pirate']]);
      expect(JSON.stringify(c.abilities)).toContain('"haste"');
      expect(life(s)).toBe(23);
    }
  });
  it('negative: the second instant or sorcery spell of the turn does not trigger', () => {
    let s = play(castWith(board(['Test Small Idea', 'Test Small Plan', 'Test Big Idea']), 'Test Small Idea'), { objects: () => [] });
    expect(monkeys(s).length).toBe(1); // nothing cheaper than 1 shares a type: the token
    const asked: string[] = [];
    s = play(castWith(s, 'Test Big Idea'), { asked });
    expect(asked.length).toBe(0);
    expect(monkeys(s).length).toBe(1);
  });
});

describe('CR 701.21a, 603.7, 400.7, 603.4, 608.2h: Desert Warfare', () => {
  const WARFARE = synthetic('Test Warfare', 'Enchantment', '{3}{R}{G}{W}', 'Whenever you sacrifice a Desert and whenever a Desert card is put into your graveyard from your hand or library, put that card onto the battlefield under your control at the beginning of your next end step.\nAt the beginning of combat on your turn, if you control five or more Deserts, create that many 1/1 red, green, and white Sand Warrior creature tokens. They gain haste.');
  const DUNE = synthetic('Test Dune', 'Land — Desert', '', '{T}: Add {C}.\n{T}, Sacrifice this land: You gain 1 life.');
  const MILL = synthetic('Test Mill', 'Sorcery', '{0}', 'Mill two cards.');
  const RAZE = synthetic('Test Raze', 'Sorcery', '{0}', 'Destroy target land.');
  const SCOUR = synthetic('Test Scour', 'Instant', '{0}', 'Exile target card from a graveyard.');
  const defs = [WARFARE, DUNE, MILL, RAZE, SCOUR];
  const board = (dunes: number, extra: { hand?: string[]; library?: string[] } = {}): GameState => mpScenario({ players: 4, defs, zones: { p1: { battlefield: ['Test Warfare', ...Array.from({ length: dunes }, () => 'Test Dune')], hand: extra.hand ?? [], library: extra.library ?? [] } } });
  const dunes = (s: GameState, zone: 'battlefield' | 'graveyard' | 'exile' = 'battlefield'): number => (zone === 'battlefield' ? s.zones.battlefield : zone === 'exile' ? s.zones.exile : s.zones.graveyard.p1!).filter((id) => nameOf(s, id) === 'Test Dune' && (zone !== 'battlefield' || s.objects[id]!.controller === 'p1')).length;
  const warriors = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id).subtypes.includes('Warrior'));
  it('is full', () => expect(full(WARFARE), JSON.stringify(WARFARE.automation)).toBe(true));
  it('a sacrificed Desert returns under my control at the beginning of my next end step (not before)', () => {
    let s = board(2);
    const dune = idOf(s, 'Test Dune', 'p1');
    s = play(activate(s, dune, 1));
    expect([dunes(s), dunes(s, 'graveyard')]).toEqual([1, 1]);
    s = toStep(s, 'end', 1);
    s = play(s);
    expect([dunes(s), dunes(s, 'graveyard')]).toEqual([2, 0]);
  });
  it('a Desert card milled from my library returns too; one destroyed (not sacrificed, not from hand or library) does not', () => {
    let s = board(1, { hand: ['Test Mill', 'Test Raze'], library: ['Test Dune', 'Test Dune', 'Test Dune'] });
    s = play(castWith(s, 'Test Mill'));
    expect(dunes(s, 'graveyard')).toBe(2); // (the first Dune was drawn in the draw step)
    s = play(castWith(s, 'Test Raze', [targetsOf(idOf(s, 'Test Dune', 'p1'))]));
    expect(dunes(s, 'graveyard')).toBe(3);
    s = play(toStep(s, 'end', 1));
    expect([dunes(s), dunes(s, 'graveyard')]).toEqual([2, 1]);
  });
  it('negative (ruling 2024-06-07): the Desert left the graveyard before the delayed ability resolves: it stays where it went', () => {
    let s = board(1, { hand: ['Test Scour'] });
    s = play(activate(s, idOf(s, 'Test Dune', 'p1'), 1));
    const card = s.zones.graveyard.p1!.find((id) => nameOf(s, id) === 'Test Dune')!;
    s = play(castWith(s, 'Test Scour', [targetsOf(card)]));
    expect(dunes(s, 'exile')).toBe(1);
    s = play(toStep(s, 'end', 1));
    expect([dunes(s), dunes(s, 'exile')]).toEqual([0, 1]);
  });
  it('combat: five Deserts make five 1/1 red, green, and white Sand Warriors with haste; that many is the count as the ability resolves', () => {
    const s = toStep(board(6), 'beginCombat', 1);
    const w = warriors(s);
    expect(w.length).toBe(6);
    const c = getChars(s, w[0]!);
    expect([Number(c.power), Number(c.toughness), [...c.colors].sort(), [...c.subtypes].sort()]).toEqual([1, 1, ['G', 'R', 'W'], ['Sand', 'Warrior']]);
    expect(JSON.stringify(c.abilities)).toContain('"haste"');
  });
  it('negative: four Deserts make no token', () => {
    const s = toStep(board(4), 'declareAttackers', 1);
    expect(warriors(s).length).toBe(0);
  });
});

describe('CR 614.12a, 119.4, 607.2d: "As this artifact enters, pay any amount of life. {4}, {T}: Create an X/X ... token, where X is the life paid as this artifact entered." (Phyrexian Processor)', () => {
  const PROCESSOR = synthetic('Test Processor', 'Artifact', '{0}', 'As this artifact enters, pay any amount of life.\n{0}, {T}: Create an X/X black Phyrexian Minion creature token, where X is the life paid as this artifact entered.');
  const SHATTER = synthetic('Test Shatter', 'Instant', '{0}', 'Destroy target artifact.');
  const board = (): GameState => mpScenario({ players: 4, defs: [PROCESSOR, SHATTER], zones: { p1: { hand: ['Test Processor', 'Test Shatter'] } } });
  const life = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  /** Casts the Processor and answers the life payment with `n` (the prompt's range is checked). */
  const enter = (n: number, seen: { min?: number; max?: number }[] = []): GameState => {
    let s = castWith(board(), 'Test Processor');
    for (let i = 0; i < 50; i++) {
      const p = s.pending as unknown as { kind: string; min: number; max: number } | null;
      if (p?.kind === 'chooseNumber') { seen.push({ min: p.min, max: p.max }); s = answer(s, { kind: 'chooseNumber', n } as DecisionAnswer); continue; }
      if (p?.kind === 'priority' && s.zones.stack.length === 0) break;
      s = p?.kind === 'priority' ? pass(s) : play(s);
    }
    return s;
  };
  const minions = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id).subtypes.includes('Minion'));
  it('is full: the enters payment keeps its amount, the ability reads it', () => expect(full(PROCESSOR), JSON.stringify(PROCESSOR.automation)).toBe(true));
  it('pays 7 life as it enters (offered 0 to my life total), then makes a 7/7 black Phyrexian Minion', () => {
    const seen: { min?: number; max?: number }[] = [];
    let s = enter(7, seen);
    expect(seen).toEqual([{ min: 0, max: 20 }]);
    expect(life(s)).toBe(13);
    s = play(activate(s, idOf(s, 'Test Processor', 'p1')));
    const m = minions(s);
    expect(m.length).toBe(1);
    const c = getChars(s, m[0]!);
    expect([Number(c.power), Number(c.toughness), [...c.colors], [...c.subtypes].sort()]).toEqual([7, 7, ['B'], ['Minion', 'Phyrexian']]);
  });
  it('ruling 2004-10-04: paying 0 life is allowed (a 0/0 that dies at once)', () => {
    let s = enter(0);
    expect(life(s)).toBe(20);
    s = play(activate(s, idOf(s, 'Test Processor', 'p1')));
    expect(minions(s).length).toBe(0);
  });
  it('the amount is the one paid as it entered, even when the Processor is gone when the ability resolves (last known information)', () => {
    let s = enter(5);
    const proc = idOf(s, 'Test Processor', 'p1');
    s = activate(s, proc);
    s = castWith(s, 'Test Shatter', [targetsOf(proc)]);
    s = play(s);
    expect(s.zones.battlefield).not.toContain(proc);
    const m = minions(s);
    expect(m.length).toBe(1);
    expect(Number(getChars(s, m[0]!).power)).toBe(5);
  });
  it('negative (CR 119.8): a player whose life total can\'t change is offered 0 only', () => {
    const STILL = synthetic('Test Stillness', 'Enchantment', '{0}', 'Your life total can\'t change.');
    let s = castWith(mpScenario({ players: 4, defs: [PROCESSOR, STILL], zones: { p1: { hand: ['Test Processor'], battlefield: ['Test Stillness'] } } }), 'Test Processor');
    const seen: { min: number; max: number }[] = [];
    for (let i = 0; i < 50; i++) {
      const p = s.pending as unknown as { kind: string; min: number; max: number } | null;
      if (p?.kind === 'chooseNumber') { seen.push({ min: p.min, max: p.max }); s = answer(s, { kind: 'chooseNumber', n: 0 } as DecisionAnswer); continue; }
      if (p?.kind === 'priority' && s.zones.stack.length === 0) break;
      s = p?.kind === 'priority' ? pass(s) : play(s);
    }
    expect(seen.every((x) => x.max === 0)).toBe(true);
    expect(life(s)).toBe(20);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Processor')).toBe(true);
  });
  it('negative: more life than I have cannot be paid (the choice stops at my life total)', () => {
    expect(() => enter(21)).toThrow();
  });
});

describe('CR 607.2a, 611.2a, 118.9, 614.1a: Quintorius, Loremaster', () => {
  const QUIN = synthetic('Test Quintorius', 'Legendary Creature — Giant Spirit', '{3}{R}{W}', 'Vigilance\nAt the beginning of your end step, exile target noncreature, nonland card from your graveyard. Create a 3/2 red and white Spirit creature token.\n{0}, {T}, Sacrifice a Spirit: Choose target card exiled with Test Quintorius. You may cast that card this turn without paying its mana cost. If that spell would be put into a graveyard, put it on the bottom of its owner\'s library instead.', { power: '5', toughness: '4' });
  const INSIGHT = synthetic('Test Insight', 'Instant', '{4}{U}', 'You gain 5 life.');
  const OTHER = synthetic('Test Other Insight', 'Instant', '{1}', 'You gain 1 life.');
  const defs = [QUIN, INSIGHT, OTHER];
  const board = (): GameState => mpScenario({ players: 4, defs, zones: { p1: { battlefield: ['Test Quintorius'], graveyard: ['Test Insight'], exile: ['Test Other Insight'] } } });
  const life = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  it('is full: the exile is linked (CR 607.2a), the permission is free for this turn with its library rider', () => {
    expect(full(QUIN), JSON.stringify(QUIN.automation)).toBe(true);
    const act = QUIN.faces[0]!.abilities[2] as unknown as { effect: { targets: { filter: { is?: unknown } }[]; steps: { effects: { graveyardInstead?: unknown }[] }[] } };
    expect(act.effect.targets[0]!.filter.is).toEqual({ ref: 'linked', link: 'exiled' });
    expect(act.effect.steps[0]!.effects[0]!.graveyardInstead).toEqual({ to: { zone: 'library', position: 'bottom' } });
  });
  it('end step: the card is exiled with it and a 3/2 Spirit is made; then the Spirit pays for a free cast, and the spell goes to the bottom of my library', () => {
    let s = board();
    const insight = s.zones.graveyard.p1!.find((id) => nameOf(s, id) === 'Test Insight')!;
    s = toStep(s, 'end', 1);
    s = play(s, { targets: [insight] });
    const exiled = s.zones.exile.find((id) => nameOf(s, id) === 'Test Insight')!;
    expect(exiled).toBeDefined();
    const spirit = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect([Number(getChars(s, spirit).power), Number(getChars(s, spirit).toughness)]).toEqual([3, 2]);
    // the other exiled card is no legal target (not exiled with it)
    const s1 = activate(s, idOf(s, 'Test Quintorius', 'p1'), 0);
    const tgt = s1.pending as unknown as { kind: string; objects?: ObjectId[] };
    if (tgt.kind === 'chooseTargets') expect((tgt.objects ?? []).map((id) => nameOf(s1, id))).toEqual(['Test Insight']);
    s = play(s1, { targets: [exiled], objects: (o) => o.filter((id) => id === spirit) }); // (Quintorius is a Spirit too: the token is sacrificed)
    expect(s.zones.battlefield).not.toContain(spirit);
    const before = life(s);
    const offer = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === exiled);
    expect(offer.length).toBe(1); // only the free way (CR 118.9)
    s = play(act(s, offer[0]!.action as never));
    expect(life(s)).toBe(before + 5);
    const lib = s.zones.library.p1!;
    expect(nameOf(s, lib[lib.length - 1]!)).toBe('Test Insight');
    expect(s.zones.graveyard.p1!.some((id) => nameOf(s, id) === 'Test Insight')).toBe(false);
  });
  it('negative: the permission lasts this turn only', () => {
    let s = board();
    const insight = s.zones.graveyard.p1!.find((id) => nameOf(s, id) === 'Test Insight')!;
    s = play(toStep(s, 'end', 1), { targets: [insight] });
    const exiled = s.zones.exile.find((id) => nameOf(s, id) === 'Test Insight')!;
    s = play(activate(s, idOf(s, 'Test Quintorius', 'p1'), 0), { targets: [exiled], objects: (o) => o.slice(0, 1) });
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === exiled)).toBe(true);
    s = toStep(s, 'main1', 5); // my next turn, with priority in my main phase
    expect(s.turn.activePlayer).toBe('p1');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === exiled)).toBe(false);
  });
});

describe('CR 701.20a, 608.2c, 614.1a, 614.5, 616.1: Fisher\'s Talent', () => {
  const TALENT = compileCard({ name: 'Test Angler Talent', layout: 'class', type_line: 'Enchantment — Class', mana_cost: '{2}{G}{U}', colors: [], oracle_text: "(Gain the next level as a sorcery to add its ability.)\nAt the beginning of your upkeep, look at the top card of your library. You may reveal it if it's a land card. Create a 1/1 blue Fish creature token if you revealed it this way. Then draw a card.\n{0}: Level 2\nIf you would create a Fish token, create a 3/3 blue Shark creature token instead.\n{0}: Level 3\nIf you would create a Shark token, create an 8/8 blue Octopus creature token instead." } as OracleCard);
  const SCHOOL = synthetic('Test School', 'Artifact', '{0}', '{0}: Create a tapped 1/1 blue Fish creature token. It gains haste until end of turn.\n{0}: Create two 3/3 blue Shark creature tokens.');
  const GROVE = synthetic('Test Grove Land', 'Land', '', '{T}: Add {G}.');
  /** `top` is the top card of my library at my next upkeep (turn 5; the card above it is drawn on turn 1). */
  const board = (top: string): GameState => mpScenario({ players: 4, defs: [TALENT, SCHOOL, GROVE], zones: { p1: { battlefield: ['Test Angler Talent', 'Test School'], library: ['Plains', top] } } });
  const tokens = (s: GameState): { name: string; p: number; t: number; tapped: boolean; haste: boolean }[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => { const c = getChars(s, id); return { name: [...c.subtypes].join(' '), p: Number(c.power), t: Number(c.toughness), tapped: s.objects[id]!.tapped === true, haste: JSON.stringify(c.abilities).includes('"haste"') }; });
  const level = (s: GameState, n: number): GameState => { let t = s; for (let k = 1; k < n; k++) t = play(activate(t, idOf(t, 'Test Angler Talent', 'p1'), k - 1)); return t; };
  it('is full at every level', () => expect(full(TALENT), JSON.stringify(TALENT.automation)).toBe(true));
  it('level 1: a land on top may be revealed for a Fish, then a card is drawn; declined: no Fish, still the draw (ruling: revealing is optional)', () => {
    for (const reveal of [true, false]) {
      const s0 = board('Test Grove Land');
      const hand0 = s0.zones.hand.p1!.length;
      const asked: string[] = [];
      const s = play(toStep(s0, 'upkeep', 5, true), { yes: () => reveal, asked });
      expect(asked.length, 'one offer to reveal').toBe(1);
      expect(tokens(s).map((x) => x.name)).toEqual(reveal ? ['Fish'] : []);
      expect(s.zones.hand.p1!.length).toBeGreaterThan(hand0);
    }
  });
  it('negative: a nonland card on top is never offered for reveal, and no Fish is made', () => {
    const asked: string[] = [];
    const s = play(toStep(board('Test School'), 'upkeep', 5, true), { asked });
    expect(asked.length).toBe(0);
    expect(tokens(s).length).toBe(0);
  });
  it('level 2: any Fish I create is a 3/3 blue Shark instead; "tapped" and "it gains haste" still apply', () => {
    let s = level(board('Plains'), 2);
    s = play(activate(s, idOf(s, 'Test School', 'p1'), 0));
    expect(tokens(s)).toEqual([{ name: 'Shark', p: 3, t: 3, tapped: true, haste: true }]);
  });
  it('level 3: a Fish becomes a Shark becomes an 8/8 Octopus (each replacement once, CR 614.5, 616.1); two Sharks are two Octopuses', () => {
    let s = level(board('Plains'), 3);
    s = play(activate(s, idOf(s, 'Test School', 'p1'), 0));
    expect(tokens(s)).toEqual([{ name: 'Octopus', p: 8, t: 8, tapped: true, haste: true }]);
    s = play(activate(s, idOf(s, 'Test School', 'p1'), 1));
    expect(tokens(s).filter((x) => x.name === 'Octopus').length).toBe(3);
  });
  it('negative: at level 1 a Fish stays a Fish', () => {
    const s0 = board('Plains');
    const s = play(activate(s0, idOf(s0, 'Test School', 'p1'), 0));
    expect(tokens(s)).toEqual([{ name: 'Fish', p: 1, t: 1, tapped: true, haste: true }]);
  });
});

describe('CR 701.8a, 608.2h, 205.2a: Convert to Slime', () => {
  const SLIME = synthetic('Test Slime Spell', 'Sorcery', '{0}', 'Destroy up to one target artifact, up to one target creature, and up to one target enchantment.\nDelirium — Then if there are four or more card types among cards in your graveyard, create an X/X green Ooze creature token, where X is the total mana value of permanents destroyed this way.');
  const RELIC = synthetic('Test Relic', 'Artifact', '{4}', '');
  const OGRE = synthetic('Test Big Ogre', 'Creature — Ogre', '{3}{R}', '', { power: '4', toughness: '4' });
  const WARD = synthetic('Test Ward Aura', 'Enchantment', '{2}', '');
  const STONE = synthetic('Test Stone Ogre', 'Creature — Ogre', '{5}', 'Indestructible', { power: '5', toughness: '5' });
  const INSTANT = synthetic('Test Old Instant', 'Instant', '{1}', 'You gain 1 life.');
  const SORC = synthetic('Test Old Sorcery', 'Sorcery', '{1}', 'You gain 1 life.');
  const LAND = synthetic('Test Old Land', 'Land', '', '');
  const defs = [SLIME, RELIC, OGRE, WARD, STONE, INSTANT, SORC, LAND];
  const board = (graveyard: string[]): GameState => mpScenario({ players: 4, defs, zones: { p1: { hand: ['Test Slime Spell'], battlefield: ['Test Relic'], graveyard }, p2: { battlefield: ['Test Big Ogre', 'Test Ward Aura', 'Test Stone Ogre'] } } });
  const oozes = (s: GameState): number[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id).subtypes.includes('Ooze')).map((id) => Number(getChars(s, id).power));
  it('is full', () => expect(full(SLIME), JSON.stringify(SLIME.automation)).toBe(true));
  it('delirium from my own destroyed artifact (ruling): an Ooze whose size is the total mana value of the destroyed permanents, as they last existed (4 + 4 + 2)', () => {
    const s0 = board(['Test Old Instant', 'Test Old Sorcery', 'Test Old Land']);
    const s = play(castWith(s0, 'Test Slime Spell', [targetsOf(idOf(s0, 'Test Relic', 'p1')), targetsOf(idOf(s0, 'Test Big Ogre', 'p2')), targetsOf(idOf(s0, 'Test Ward Aura', 'p2'))]));
    expect(oozes(s)).toEqual([10]);
  });
  it('negative: an indestructible creature is not destroyed and does not count; three card types are no delirium', () => {
    const s0 = board(['Test Old Instant', 'Test Old Sorcery', 'Test Old Land']);
    const s = play(castWith(s0, 'Test Slime Spell', [targetsOf(idOf(s0, 'Test Relic', 'p1')), targetsOf(idOf(s0, 'Test Stone Ogre', 'p2')), targetsOf()]));
    expect(oozes(s)).toEqual([4]);
    const t0 = board(['Test Old Instant', 'Test Old Land']);
    const t = play(castWith(t0, 'Test Slime Spell', [targetsOf(), targetsOf(idOf(t0, 'Test Big Ogre', 'p2')), targetsOf()]));
    expect(oozes(t)).toEqual([]); // instant, land and the Ogre's creature: three types (the spell itself is not yet in the graveyard)
  });
});

describe('CR 701.21a, 701.23a, 608.2h: The Hunger Tide Rises (IV)', () => {
  const TIDE = synthetic('Test Tide Spell', 'Sorcery', '{0}', 'Sacrifice any number of creatures. Search your library and/or graveyard for a creature card with mana value less than or equal to the number of creatures sacrificed this way and put it onto the battlefield. If you search your library this way, shuffle.');
  const BUG = synthetic('Test Bug', 'Creature — Insect', '{1}', '', { power: '1', toughness: '1' });
  const THREE = synthetic('Test Three Drop', 'Creature — Beast', '{2}{G}', '', { power: '3', toughness: '3' });
  const FOUR = synthetic('Test Four Drop', 'Creature — Beast', '{3}{G}', '', { power: '4', toughness: '4' });
  const GRAVE3 = synthetic('Test Grave Three', 'Creature — Zombie', '{3}', '', { power: '3', toughness: '3' });
  const defs = [TIDE, BUG, THREE, FOUR, GRAVE3];
  const board = (): GameState => mpScenario({ players: 4, defs, zones: { p1: { hand: ['Test Tide Spell'], battlefield: ['Test Bug', 'Test Bug', 'Test Bug', 'Test Bug'], library: ['Plains', 'Test Four Drop', 'Test Three Drop'], graveyard: ['Test Grave Three'] } } });
  it('is full', () => expect(full(TIDE), JSON.stringify(TIDE.automation)).toBe(true));
  for (const n of [3, 2]) {
    it(`sacrifices ${n} creatures: only creature cards of mana value ${n} or less are found, in the library or the graveyard`, () => {
      let offered: string[] = [];
      const asked: string[] = [];
      let calls = 0;
      const s = play(castWith(board(), 'Test Tide Spell'), {
        asked,
        option: (o) => o.map((x) => x.id), // search both the library and the graveyard
        objects: (o, st) => {
          if (calls++ === 0) return o.slice(0, n); // what to sacrifice
          offered = o.map((id) => nameOf(st, id)).sort();
          return o.filter((id) => nameOf(st, id) === 'Test Grave Three' || nameOf(st, id) === 'Test Three Drop').slice(0, 1);
        },
      });
      expect(s.zones.battlefield.filter((id) => nameOf(s, id) === "Test Bug").length, asked.join(" / ")).toBe(4 - n);
      if (n === 3) {
        expect(offered.filter((x) => x !== 'Test Bug')).not.toContain('Test Four Drop');
        expect(s.zones.battlefield.some((id) => ['Test Grave Three', 'Test Three Drop'].includes(nameOf(s, id)))).toBe(true);
      } else {
        expect(offered.filter((x) => x === 'Test Three Drop' || x === 'Test Four Drop' || x === 'Test Grave Three')).toEqual([]);
        expect(offered).toEqual(['Test Bug', 'Test Bug']); // the two sacrificed Insects (mana value 1) are in the graveyard now
        expect(s.zones.battlefield.some((id) => ['Test Grave Three', 'Test Three Drop'].includes(nameOf(s, id)))).toBe(false);
      }
    });
  }
});

describe('CR 702.35a-b, 107.3a, 614.15: the madness X of a control spell (Welcome to the Fold, held-out, full through the same madness {X} reading)', () => {
  const FOLD = synthetic('Test Fold Spell', 'Sorcery', '{2}{U}{U}', "Madness {X}{U}{U}\nGain control of target creature if its toughness is 2 or less. If this spell's madness cost was paid, instead gain control of that creature if its toughness is X or less.");
  const OUT = synthetic('Test Outlet', 'Artifact', '{0}', '{0}, Discard a card: Draw a card.');
  const ISLE = synthetic('Test Isle', 'Land', '', '{T}: Add {U}.');
  const OX = synthetic('Test Ox', 'Creature — Ox', '{3}', '', { power: '3', toughness: '3' });
  const board = (): GameState => mpScenario({ players: 4, defs: [FOLD, OUT, ISLE, OX], zones: { p1: { hand: ['Test Fold Spell'], battlefield: ['Test Outlet', 'Test Isle', 'Test Isle', 'Test Isle', 'Test Isle', 'Test Isle'] }, p2: { battlefield: ['Test Ox'] } } });
  const madness = (x: number): GameState => {
    const s0 = board();
    const fold = s0.zones.hand.p1!.find((id) => nameOf(s0, id) === 'Test Fold Spell')!;
    return play(activate(s0, idOf(s0, 'Test Outlet', 'p1')), { number: x, targets: [idOf(s0, 'Test Ox', 'p2')], objects: (o) => (o.includes(fold) ? [fold] : o.slice(0, 1)) });
  };
  it('is full', () => expect(full(FOLD), JSON.stringify(FOLD.automation)).toBe(true));
  it('madness with X = 3 takes a 3/3; X = 2 does not', () => {
    const t = madness(3);
    expect(idOf(t, 'Test Ox', 'p1')).toBeDefined();
    const s = madness(2);
    expect(idOf(s, 'Test Ox', 'p2')).toBeDefined();
    expect(idOf(s, 'Test Ox', 'p1')).toBeUndefined();
  });
  it('negative: cast normally, a 3/3 is not taken (toughness 2 or less only)', () => {
    const s0 = board();
    const s = play(castWith(s0, 'Test Fold Spell', [targetsOf(idOf(s0, 'Test Ox', 'p2'))]));
    expect(idOf(s, 'Test Ox', 'p2')).toBeDefined();
  });
});

describe('CR 702.35a-b, 107.3a, 614.15: From Under the Floorboards', () => {
  const FLOOR = synthetic('Test Floorboards', 'Sorcery', '{3}{B}{B}', 'Madness {X}{B}{B} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)\nCreate three tapped 2/2 black Zombie creature tokens and you gain 3 life. If this spell\'s madness cost was paid, instead create X of those tokens and you gain X life.');
  const OUTLET = synthetic('Test Outlet', 'Artifact', '{0}', '{0}, Discard a card: Draw a card.');
  const BOG = synthetic('Test Bog', 'Land', '', '{T}: Add {B}.');
  const board = (): GameState => mpScenario({ players: 4, defs: [FLOOR, OUTLET, BOG], zones: { p1: { hand: ['Test Floorboards'], battlefield: ['Test Outlet', 'Test Bog', 'Test Bog', 'Test Bog', 'Test Bog', 'Test Bog', 'Test Bog'] } } });
  const life = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  const zombies = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id).subtypes.includes('Zombie'));
  it('is full', () => expect(full(FLOOR), JSON.stringify(FLOOR.automation)).toBe(true));
  it('discarded and cast for its madness cost with X = 4: four tapped 2/2 Zombies and 4 life', () => {
    const s0 = board();
    const floor = s0.zones.hand.p1!.find((id) => nameOf(s0, id) === 'Test Floorboards')!;
    const s = play(activate(s0, idOf(s0, 'Test Outlet', 'p1')), { number: 4, objects: (o) => (o.includes(floor) ? [floor] : o.slice(0, 1)) });
    const z = zombies(s);
    expect(z.length).toBe(4);
    expect(z.every((id) => s.objects[id]!.tapped === true && Number(getChars(s, id).power) === 2)).toBe(true);
    expect(life(s)).toBe(24);
  });
  it('negative: cast from the hand for its mana cost: three tapped Zombies and 3 life (X is 0 there, CR 107.3b)', () => {
    const s = play(castWith(board(), 'Test Floorboards'));
    expect(zombies(s).length).toBe(3);
    expect(life(s)).toBe(23);
  });
});

describe('CR 113.6k, 601.2h, 903.8: "When you cast this spell, create X 0/1 red Kobold creature tokens named Kobolds of Kher Keep, where X is the amount of mana spent to cast it." (Prossh)', () => {
  const TEXT = 'When you cast this spell, create X 0/1 red Kobold creature tokens named Kobolds of Kher Keep, where X is the amount of mana spent to cast it.\nFlying\nSacrifice another creature: Test Prossh gets +1/+0 until end of turn.';
  const PROSSH = legend('Test Prossh', '{3}{G}', ['5', '5'], ['G'], TEXT, 'Legendary Creature — Dragon');
  const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
  const kobolds = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id).name === 'Kobolds of Kher Keep');
  const game = (casts: number, n: number): GameState => tweak(commanderScenario({ p1Commanders: [PROSSH], p2Commanders: [BOB], p1: { battlefield: forests(n) } }), (t) => { commanderRec(t, 'p1', 'Test Prossh').casts = casts; });
  const castCommander = (s: GameState): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'cast' && nameOf(s, x.object as string) === 'Test Prossh');
    if (a === undefined) throw new Error('Prossh cannot be cast');
    return play(act(s, a.action as never));
  };
  it('is full', () => expect(full(PROSSH), JSON.stringify(PROSSH.automation)).toBe(true));
  it('cast from the command zone for 4 mana: four 0/1 red Kobolds named Kobolds of Kher Keep, made before Prossh enters', () => {
    const s = castCommander(game(0, 4));
    const k = kobolds(s);
    expect(k.length).toBe(4);
    const c = getChars(s, k[0]!);
    expect([Number(c.power), Number(c.toughness), [...c.colors], [...c.subtypes]]).toEqual([0, 1, ['R'], ['Kobold']]);
    const prossh = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Prossh')!;
    expect(k.every((id) => s.objects[id]!.timestamp < s.objects[prossh]!.timestamp)).toBe(true);
  });
  it('ruling: the commander tax is mana spent too (second cast: 4 + 2 = six Kobolds)', () => {
    const s = castCommander(game(1, 6));
    expect(kobolds(s).length).toBe(6);
  });
  it('negative: put onto the battlefield without being cast, no Kobolds', () => {
    const PUT = synthetic('Test Put Prossh', 'Sorcery', '{0}', 'Return target creature card from your graveyard to the battlefield.');
    const s0 = mpScenario({ players: 4, defs: [PROSSH, PUT], zones: { p1: { hand: ['Test Put Prossh'], graveyard: ['Test Prossh'] } } });
    const s = play(castWith(s0, 'Test Put Prossh', [targetsOf(s0.zones.graveyard.p1![0]!)]));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Prossh')).toBe(true);
    expect(kobolds(s).length).toBe(0);
  });
});
