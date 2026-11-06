/**
 * Commander lane edh-c, round edh-c-23 (EDHREC ranks 19,376 to 20,000, third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by
 * the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks and has its negative case. CR cites checked against the Comprehensive
 * Rules of 2026-09-25.
 *
 *   CR 611.3a, 604.1, 506.4        "Enchanted creature has first strike as long as it's blocking and you control a snow land."
 *   CR 702.11b-c, 115.1, 611.3a    "You and ~ have hexproof during your turn."
 *   CR 611.3a, 613.4c              "Enchanted creature gets +1/+1. If it's a Warrior, it gets +2/+1 instead."
 *   CR 614.15, 608.2c, 122.1       "Target creature gets +2/+2 until end of turn. If it's an artifact creature or legendary creature, instead put a +1/+1 counter on it and it gets +1/+1 ..."
 *   CR 615.1, 615.5, 122.1         "If damage would be dealt to ~ while it has a +1/+1 counter on it, prevent that damage and remove a +1/+1 counter from it."
 *   CR 606.3, 602.2                "Whenever you activate a loyalty ability of a Chandra planeswalker, ~ deals 1 damage to each opponent."
 *   CR 701.9a, 121.1, 608.2h       "Draw cards equal to the number of cards target opponent discarded this turn."
 *   CR 401.4, 400.3, 115.1         "Put up to three target cards from an opponent's graveyard on top of their library in any order."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, life, pass, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => charsOfObject(s, s.objects[id]!);
const power = (s: GameState, id: ObjectId): number => Number(chars(s, id).power);
const toughness = (s: GameState, id: ObjectId): number => Number(chars(s, id).toughness);
const hasKw = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: PlayerId): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;
const damage = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;

const orderedBy: PlayerId[] = [];
interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[]; picks?: ObjectId[][] }
/** Answer what comes up: targets in order, then the given answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  const answers = [...(o.answers ?? [])];
  const picks = [...(o.picks ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: picks.length > 0 ? picks.shift()! : p.options.slice(0, p.min) });
    else if (p.kind === 'yesNo') s = answer(s, answers.length > 0 ? answers.shift()! : { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') { orderedBy.push(p.player); s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) }); }
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (answers.length > 0) s = answer(s, answers.shift()!);
    else break;
  }
  return s;
}
function drain(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const rest: Opts = { targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])], picks: [...(o.picks ?? [])] };
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) {
    s = settle(pass(s), rest);
    if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = settle(s, rest);
  }
  return s;
}
const cast = (s0: GameState, name: string, o: Opts = {}, player: PlayerId = 'p1'): GameState => drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), o), o);
const activate = (s: GameState, name: string, ability: string, o: Opts = {}, player: PlayerId = 'p1'): GameState => drain(settle(act(s, { type: 'activate', player, source: find(s, name, 'battlefield', player), ability } as never), o), o);
const named = (s: GameState, name: string, zone: 'battlefield' | 'graveyard' | 'hand' | 'exile' | 'library', owner?: PlayerId): ObjectId[] => findAll(s, name, zone, owner);

/** Is `target` accepted when `caster` casts `name` (a spell with one target) at it? */
function targetable(s0: GameState, caster: PlayerId, name: string, target: TargetChoice): boolean {
  const s = act(s0, { type: 'cast', player: caster, card: find(s0, name, 'hand', caster) } as never);
  const d = s.pending;
  if (!d || d.kind !== 'chooseTargets') return false;
  return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseTargets', targets: [target] } }).error === undefined;
}

describe('CR 611.3a, 604.1, 506.4: "Enchanted creature has first strike as long as it\'s blocking and you control a snow land."', () => {
  const DEVIL = card('Test Frost Veil', 'Enchantment — Aura', "Enchant creature\nEnchanted creature has flying.\nEnchanted creature has first strike as long as it's blocking and you control a snow land.");
  const WALL = card('Test Wall', 'Creature — Wall', 'Defender', { pt: ['0', '4'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const SNOW = card('Test Snow Plain', 'Basic Snow Land — Island', '');
  const PLAIN = card('Test Plain', 'Basic Land — Island', '');
  const defs = [DEVIL, WALL, BEAR, SNOW, PLAIN];
  /** p1 enchants its own wall in turn 1; in turn 2 p2's bear attacks and the wall blocks; the wall's first strike while blocking is read. */
  function blocked(land: string): boolean {
    let s = scenario([], { defs, p1: { hand: ['Test Frost Veil'], battlefield: ['Test Wall', land] }, p2: { battlefield: ['Test Bear'] } });
    const wall = find(s, 'Test Wall', 'battlefield', 'p1');
    s = cast(s, 'Test Frost Veil', { targets: [[obj(wall)]] });
    expect(hasKw(s, wall, 'flying')).toBe(true);
    expect(hasKw(s, wall, 'first strike')).toBe(false); // not blocking yet
    s = advanceTo(s, 2, 'main1');
    s = pass(s);
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Bear', 'battlefield', 'p2'), defender: 'p1' as PlayerId }] });
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareBlockers'; guard++) s = pass(s);
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: wall, attacker: find(s, 'Test Bear', 'battlefield', 'p2') }] });
    return hasKw(s, wall, 'first strike');
  }
  it('is automated', () => { expect(full(DEVIL)).toBe(true); });
  it('blocking with a snow land: first strike; blocking without one: none; not blocking: none', () => {
    expect(blocked('Test Snow Plain')).toBe(true);
    expect(blocked('Test Plain')).toBe(false);
  });
});

describe('CR 702.11b-c, 115.1, 611.3a: "During your turn, you and ~ have hexproof."', () => {
  const BREAKER = card('Test Gate Warden', 'Creature — Ogre', 'During your turn, you and this creature have hexproof.', { pt: ['3', '3'] });
  const BOLT = card('Test Spark', 'Instant', '~ deals 1 damage to any target.');
  const defs = [BREAKER, BOLT];
  it('is automated', () => { expect(full(BREAKER)).toBe(true); });
  it('your turn: an opponent cannot target you or the creature; on their turn they can', () => {
    const mine = scenario([], { defs, p1: { battlefield: ['Test Gate Warden'] }, p2: { hand: ['Test Spark'] } });
    const warden = find(mine, 'Test Gate Warden', 'battlefield', 'p1');
    expect(hasKw(mine, warden, 'hexproof')).toBe(true);
    // p2 casts at instant speed during p1's turn
    const s1 = pass(mine);
    expect(s1.turn.number).toBe(1);
    expect(targetable(s1, 'p2', 'Test Spark', plr('p1'))).toBe(false);
    expect(targetable(s1, 'p2', 'Test Spark', obj(warden))).toBe(false);
    const theirs = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Gate Warden'] }, p2: { hand: ['Test Spark'] } }), 2, 'main1');
    expect(hasKw(theirs, find(theirs, 'Test Gate Warden', 'battlefield', 'p1'), 'hexproof')).toBe(false);
    expect(targetable(theirs, 'p2', 'Test Spark', plr('p1'))).toBe(true);
    expect(targetable(theirs, 'p2', 'Test Spark', obj(find(theirs, 'Test Gate Warden', 'battlefield', 'p1')))).toBe(true);
  });
});

describe('CR 611.3a, 613.4c: "Enchanted creature gets +1/+1. If it\'s a Warrior, it gets +2/+1 instead."', () => {
  const AXE = card('Test Whet Blade', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +1/+1. If it's a Warrior, it gets +2/+1 instead.");
  const WARRIOR = card('Test Fighter', 'Creature — Human Warrior', '', { pt: ['2', '2'] });
  const CLERK = card('Test Clerk', 'Creature — Human Cleric', '', { pt: ['2', '2'] });
  const defs = [AXE, WARRIOR, CLERK];
  it('is automated', () => { expect(full(AXE)).toBe(true); });
  it('a Warrior gets +2/+1 and not +1/+1 besides; another creature gets +1/+1', () => {
    for (const [name, p, t] of [['Test Fighter', 4, 3], ['Test Clerk', 3, 3]] as const) {
      let s = scenario([], { defs, p1: { hand: ['Test Whet Blade'], battlefield: [name] } });
      const c = find(s, name, 'battlefield', 'p1');
      s = cast(s, 'Test Whet Blade', { targets: [[obj(c)]] });
      expect([power(s, c), toughness(s, c)]).toEqual([p, t]);
    }
  });
});

describe('CR 614.15, 608.2c, 122.1: "Target creature gets +2/+2 until end of turn. If it\'s an artifact creature or legendary creature, instead put a +1/+1 counter on it and it gets +1/+1 until end of turn."', () => {
  const AUTH = card('Test Decree', 'Instant', "Target creature gets +2/+2 until end of turn. If it's an artifact creature or legendary creature, instead put a +1/+1 counter on it and it gets +1/+1 until end of turn.");
  const PLAIN = card('Test Peasant', 'Creature — Human', '', { pt: ['1', '1'] });
  const KING = card('Test King', 'Legendary Creature — Human', '', { pt: ['1', '1'] });
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['1', '1'] });
  const KINGGOLEM = card('Test Iron King', 'Legendary Artifact Creature — Golem', '', { pt: ['1', '1'] });
  const defs = [AUTH, PLAIN, KING, GOLEM, KINGGOLEM];
  it('is automated', () => { expect(full(AUTH)).toBe(true); });
  it('an ordinary creature: +2/+2 and no counter; a legendary or an artifact creature: one counter and +1/+1 (also when both)', () => {
    for (const [name, p, c] of [['Test Peasant', 3, 0], ['Test King', 3, 1], ['Test Golem', 3, 1], ['Test Iron King', 3, 1]] as const) {
      let s = scenario([], { defs, p1: { hand: ['Test Decree'], battlefield: [name] } });
      const id = find(s, name, 'battlefield', 'p1');
      s = cast(s, 'Test Decree', { targets: [[obj(id)]] });
      expect([name, power(s, id), counters(s, id)]).toEqual([name, p, c]);
    }
  });
});

describe('CR 615.1, 615.5, 122.1: "If damage would be dealt to ~ while it has a +1/+1 counter on it, prevent that damage and remove a +1/+1 counter from it."', () => {
  const KNIGHT = card('Test Ward Knight', 'Creature — Knight', 'If damage would be dealt to ~ while it has a +1/+1 counter on it, prevent that damage and remove a +1/+1 counter from it.', { pt: ['2', '2'] });
  const SHOCK = card('Test Shock', 'Instant', '~ deals 3 damage to target creature.');
  const defs = [KNIGHT, SHOCK];
  const setup = (n: number): GameState => scenario([], { defs, p1: { hand: ['Test Shock'], battlefield: [n > 0 ? { name: 'Test Ward Knight', counters: { '+1/+1': n } } : 'Test Ward Knight'] } });
  it('is automated', () => { expect(full(KNIGHT)).toBe(true); });
  it('with two counters: three damage is prevented as a whole and only one counter is removed; with none: the damage is dealt', () => {
    let s = setup(2);
    const k = find(s, 'Test Ward Knight', 'battlefield', 'p1');
    s = cast(s, 'Test Shock', { targets: [[obj(k)]] });
    expect([damage(s, k), counters(s, k)]).toEqual([0, 1]);
    const bare = setup(0);
    const b = find(bare, 'Test Ward Knight', 'battlefield', 'p1');
    const after = cast(bare, 'Test Shock', { targets: [[obj(b)]] });
    expect(named(after, 'Test Ward Knight', 'graveyard', 'p1').length).toBe(1); // 2/2 with 3 damage
  });
});

describe('CR 606.3, 602.2: "Whenever you activate a loyalty ability of a Chandra planeswalker, ~ deals 1 damage to each opponent."', () => {
  const DISCIPLE = card('Test Flame Acolyte', 'Creature — Human Monk', 'Whenever you activate a loyalty ability of a Chandra planeswalker, ~ deals 1 damage to each opponent.', { pt: ['2', '2'] });
  const CHANDRA = card('Test Chandra', 'Legendary Planeswalker — Chandra', '+1: You gain 1 life.');
  const JACE = card('Test Jace', 'Legendary Planeswalker — Jace', '+1: You gain 1 life.');
  const defs = [DISCIPLE, CHANDRA, JACE];
  const withWalker = (s: GameState, name: string): GameState => tweak(s, (x) => { x.objects[put(x, 'p1', 'battlefield', name)]!.counters['loyalty'] = 5; });
  it('is automated', () => { expect(full(DISCIPLE)).toBe(true); });
  it('a Chandra planeswalker\'s loyalty ability: every opponent takes 1; another planeswalker\'s: nobody does', () => {
    let s = withWalker(scenario([], { defs, p1: { battlefield: ['Test Flame Acolyte'] } }), 'Test Chandra');
    s = activate(s, 'Test Chandra', 'p:0:0');
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([21, 19]);
    let j = withWalker(scenario([], { defs, p1: { battlefield: ['Test Flame Acolyte'] } }), 'Test Jace');
    j = activate(j, 'Test Jace', 'p:0:0');
    expect([life(j, 'p1'), life(j, 'p2')]).toEqual([21, 20]);
  });
});

describe('CR 701.9a, 121.1, 608.2h: "Draw cards equal to the number of cards target opponent discarded this turn."', () => {
  const SALVAGE = card('Test Mind Harvest', 'Instant', 'Draw cards equal to the number of cards target opponent discarded this turn.');
  const MAKER = card('Test Mind Rot', 'Sorcery', 'Target opponent discards two cards.');
  const FILL = card('Test Filler', 'Sorcery', 'You gain 1 life.');
  const defs = [SALVAGE, MAKER, FILL];
  const setup = (): GameState => scenario(['Island', 'Island', 'Island', 'Island'], { defs, p1: { hand: ['Test Mind Harvest', 'Test Mind Rot'] }, p2: { hand: ['Test Filler', 'Test Filler', 'Test Filler'] } });
  it('is automated', () => { expect(full(SALVAGE)).toBe(true); });
  it('after the opponent discarded two cards you draw two; if nobody discarded you draw none', () => {
    let s = setup();
    const hand0 = s.zones.hand['p1']!.length;
    s = cast(s, 'Test Mind Rot', { targets: [[plr('p2')]] });
    s = cast(s, 'Test Mind Harvest', { targets: [[plr('p2')]] });
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 2 + 2);
    const none = cast(setup(), 'Test Mind Harvest', { targets: [[plr('p2')]] });
    expect(none.zones.hand['p1']!.length).toBe(hand0 - 1);
  });
});

describe('CR 401.4, 400.3, 115.1: "Put up to three target cards from an opponent\'s graveyard on top of their library in any order."', () => {
  const MIS = card('Test Cruel Return', 'Instant', "Put up to three target cards from an opponent's graveyard on top of their library in any order.");
  const A = card('Test Card A', 'Sorcery', 'You gain 1 life.');
  const defs = [MIS, A];
  it('is automated', () => { expect(full(MIS)).toBe(true); });
  it('the chosen cards leave that opponent\'s graveyard for the top of their library; your own graveyard cannot be targeted', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Cruel Return'], graveyard: ['Test Card A'] }, p2: { graveyard: ['Test Card A', 'Test Card A'] } });
    const ids = named(s, 'Test Card A', 'graveyard', 'p2');
    s = cast(s, 'Test Cruel Return', { targets: [ids.map(obj)] });
    expect(named(s, 'Test Card A', 'graveyard', 'p2').length).toBe(0);
    expect(s.zones.library['p2']!.slice(0, 2).map((id) => s.objects[id]!.defId)).toEqual(['Test Card A', 'Test Card A']);
    expect(named(s, 'Test Card A', 'graveyard', 'p1').length).toBe(1);
    expect(orderedBy).toEqual(['p1']); // the caster puts them in order, not the opponent whose library it is (ruling 2008-10-01)
  });
});

