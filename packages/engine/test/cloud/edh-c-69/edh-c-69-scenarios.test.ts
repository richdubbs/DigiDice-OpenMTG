/**
 * Commander EDHREC ranks 28,001-28,500, round edh-c-69 (second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 108.3, 109.4, 115.1        "{6}, {T}: Return target permanent you both own and control to your hand." (Obelisk of Undoing)
 *   CR 506.4, 509.1, 608.2h       "Exile target white creature that's attacking or blocking. If it was a Gideon planeswalker, you gain 5 life." (Gideon's Defeat)
 *   CR 509.1b, 611.2a, 205.3m     "Until end of turn, target creature can't be blocked by creatures with power 2 or less and/or Walls." (Doorman)
 *   CR 401.4, 701.20e, 608.2d     "That player looks at the top three cards of your library, then puts them back in any order." (Tahngarth's Glare)
 *   CR 115.1, 603.2, 608.2d       "Whenever you become the target of a spell, you may untap this creature." (Dormant Gomazoa)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, tweak, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { card, full, named, resolveAll, settle } from '../cmd3/helpers';

/** A synthetic card with colors and an optional loyalty (the shared `card` helper makes colorless ones). */
function colored(name: string, type: string, text: string, colors: string[], pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const inHand = (s: GameState, defId: string, p: string): boolean => s.zones.hand[p]!.some((id) => s.objects[id]!.defId === defId);
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
/** Activate the first activated ability of an object that has one (by the legal actions), paying automatically. */
function activate(s: GameState, player: string, source: ObjectId, p: Parameters<typeof settle>[1] = {}): GameState {
  const a = legalActions(s, player).find((x) => x.action.type === 'activate' && (x.action as { source: ObjectId }).source === source);
  if (a === undefined) throw new Error('no activation is legal');
  return settle(act(s, a.action), p);
}
/** The same without answering the decisions: the activation is announced and waits for its targets. */
function begin(s: GameState, player: string, source: ObjectId): GameState {
  const a = legalActions(s, player).find((x) => x.action.type === 'activate' && (x.action as { source: ObjectId }).source === source);
  if (a === undefined) throw new Error('no activation is legal');
  return act(s, a.action);
}
const PLAINS6 = ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'];

describe('CR 108.3, 109.4, 115.1: "{6}, {T}: Return target permanent you both own and control to your hand."', () => {
  const OBELISK = card('Test Undo Stone', 'Artifact', '{6}, {T}: Return target permanent you both own and control to your hand.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const game = (): GameState => scenario([], { defs: [OBELISK, BEAR], p1: { battlefield: ['Test Undo Stone', 'Test Plain Bear', 'Test Plain Bear', ...PLAINS6] }, p2: { battlefield: ['Test Plain Bear'] } });
  it('is full', () => { expect(full(OBELISK)).toBe(true); });
  it('a permanent you own and control goes to your hand', () => {
    const s0 = game();
    const mine = named(s0, 'Test Plain Bear').find((id) => s0.objects[id]!.controller === 'p1')!;
    const s1 = resolveAll(activate(s0, 'p1', named(s0, 'Test Undo Stone')[0]!, { targets: [obj(mine)] }));
    expect(s1.zones.battlefield.includes(mine)).toBe(false);
    expect(inHand(s1, 'Test Plain Bear', 'p1')).toBe(true);
  });
  it('negative: a permanent you control but another player owns, and one another player controls, are no targets', () => {
    const s0 = game();
    const [a, b] = named(s0, 'Test Plain Bear').filter((id) => s0.objects[id]!.controller === 'p1') as [ObjectId, ObjectId];
    const stolen = tweak(s0, (t) => { t.objects[b]!.owner = 'p2'; });
    const s1 = begin(stolen, 'p1', named(stolen, 'Test Undo Stone')[0]!);
    expect(s1.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s1, { kind: 'chooseTargets', targets: [obj(b)] })).toThrow();
    const theirs = named(s0, 'Test Plain Bear').find((id) => s0.objects[id]!.controller === 'p2')!;
    expect(() => answer(s1, { kind: 'chooseTargets', targets: [obj(theirs)] })).toThrow();
    expect(() => answer(s1, { kind: 'chooseTargets', targets: [obj(a)] })).not.toThrow();
  });
});

describe('CR 506.4, 509.1, 608.2h: "Exile target white creature that\'s attacking or blocking. If it was a Gideon planeswalker, you gain 5 life."', () => {
  const DEFEAT = card('Test Lone Defeat', 'Instant', "Exile target white creature that's attacking or blocking. If it was a Gideon planeswalker, you gain 5 life.");
  const KNIGHT = colored('Test White Knight', 'Creature — Knight', '', ['W'], ['2', '2']);
  const OGRE = colored('Test Red Ogre', 'Creature — Ogre', '', ['R'], ['2', '2']);
  const GIDEON = colored('Test Lone Gideon', 'Legendary Planeswalker Creature — Gideon', '', ['W'], ['3', '3'], '{0}', '4');
  const game = (attacker: string): GameState => scenario([], { defs: [DEFEAT, KNIGHT, OGRE, GIDEON], p1: { hand: ['Test Lone Defeat'], battlefield: attacker === 'Test White Knight' ? ['Test White Knight', 'Test White Knight'] : [{ name: attacker, counters: { loyalty: 4 } }, 'Test White Knight'] }, p2: { battlefield: ['Test Red Ogre'] } });
  const attackAndCast = (s0: GameState, victim: ObjectId, attacker: ObjectId): GameState => {
    const s1 = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
    return resolveAll(settle(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Lone Defeat', 'hand', 'p1') }), { targets: [obj(victim)] }));
  };
  it('is full', () => { expect(full(DEFEAT)).toBe(true); });
  it('an attacking white creature is exiled and, being no Gideon, gains nothing', () => {
    const s0 = game('Test White Knight');
    const knight = named(s0, 'Test White Knight')[0]!;
    const s1 = attackAndCast(s0, knight, knight);
    expect(s1.zones.battlefield.includes(knight)).toBe(false);
    expect(s1.zones.exile.some((id) => s1.objects[id]!.defId === 'Test White Knight')).toBe(true);
    expect(lifeOf(s1, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
  it('a Gideon planeswalker creature (last known information) gains 5 life', () => {
    const s0 = game('Test Lone Gideon');
    const g = named(s0, 'Test Lone Gideon')[0]!;
    const s1 = attackAndCast(s0, g, g);
    expect(s1.zones.battlefield.includes(g)).toBe(false);
    expect(lifeOf(s1, 'p1')).toBe(lifeOf(s0, 'p1') + 5);
  });
  it('negative: a white creature that is neither attacking nor blocking, and a red creature, are no targets', () => {
    const s0 = game('Test White Knight');
    const knights = named(s0, 'Test White Knight');
    const s1 = declareAttackers(toDeclareAttackers(s0), [[knights[0]!]]);
    const c = act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Lone Defeat', 'hand', 'p1') });
    expect(() => answer(c, { kind: 'chooseTargets', targets: [obj(knights[1]!)] })).toThrow(); // white, but not attacking
    expect(() => answer(c, { kind: 'chooseTargets', targets: [obj(named(s0, 'Test Red Ogre')[0]!)] })).toThrow(); // not white
    expect(() => answer(c, { kind: 'chooseTargets', targets: [obj(knights[0]!)] })).not.toThrow();
  });
});

describe('CR 509.1b, 611.2a, 205.3m: "Until end of turn, target creature can\'t be blocked by creatures with power 2 or less and/or Walls."', () => {
  const DOORMAN = card('Test Gate Keeper', 'Creature — Human', "{T}: Until end of turn, target creature can't be blocked by creatures with power 2 or less and/or Walls.", ['1', '1']);
  const RUNNER = card('Test Quick Runner', 'Creature — Human', '', ['2', '2']);
  const SMALL = card('Test Small Ogre', 'Creature — Ogre', '', ['2', '2']);
  const BIG = card('Test Big Ogre', 'Creature — Ogre', '', ['3', '3']);
  const WALL = card('Test Stone Wall', 'Creature — Wall', 'Defender', ['3', '5']);
  const game = (): GameState => scenario([], { defs: [DOORMAN, RUNNER, SMALL, BIG, WALL], p1: { battlefield: ['Test Gate Keeper', 'Test Quick Runner'] }, p2: { battlefield: ['Test Small Ogre', 'Test Big Ogre', 'Test Stone Wall'] } });
  it('is full', () => { expect(full(DOORMAN)).toBe(true); });
  it('power 2 or less and Walls cannot block it; a bigger non-Wall can', () => {
    const s0 = game();
    const runner = named(s0, 'Test Quick Runner')[0]!;
    const s1 = resolveAll(activate(s0, 'p1', named(s0, 'Test Gate Keeper')[0]!, { targets: [obj(runner)] }));
    const blockers = declareAttackers(toDeclareAttackers(s1), [[runner]]);
    const s2 = toDeclareBlockers(blockers);
    const by = (n: string): ObjectId => named(s2, n)[0]!;
    expect(() => declareBlockers(s2, [[by('Test Small Ogre'), runner]])).toThrow();
    expect(() => declareBlockers(s2, [[by('Test Stone Wall'), runner]])).toThrow();
    expect(() => declareBlockers(s2, [[by('Test Big Ogre'), runner]])).not.toThrow();
  });
  it('negative: without the activation the small creature and the Wall can block', () => {
    const s0 = game();
    const runner = named(s0, 'Test Quick Runner')[0]!;
    const s2 = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[runner]]));
    expect(() => declareBlockers(s2, [[named(s2, 'Test Small Ogre')[0]!, runner]])).not.toThrow();
    expect(() => declareBlockers(s2, [[named(s2, 'Test Stone Wall')[0]!, runner]])).not.toThrow();
  });
});

describe('CR 401.4, 701.20e, 608.2d: "Look at the top three cards of target opponent\'s library, then put them back in any order. That player looks at the top three cards of your library, then puts them back in any order."', () => {
  const GLARE = card('Test Glare Spell', 'Instant', "Look at the top three cards of target opponent's library, then put them back in any order. That player looks at the top three cards of your library, then puts them back in any order.");
  const LIB1 = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  const game = (): GameState => scenario(['Island', 'Swamp', 'Mountain', 'Forest'], { defs: [GLARE], p1: { hand: ['Test Glare Spell'], library: LIB1 }, p2: { library: ['Forest', 'Mountain', 'Swamp', 'Island', 'Plains'] } });
  it('is full', () => { expect(full(GLARE)).toBe(true); });
  it('the opponent is asked to put the top three cards of YOUR library back, and they stay on top as chosen', () => {
    const s0 = game();
    const names = (st: GameState): string[] => st.zones.library['p1']!.slice(0, 3).map((id) => st.objects[id]!.defId);
    const top3 = names(s0);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Glare Spell', 'hand', 'p1') });
    s = settle(s, { targets: [{ kind: 'player', id: 'p2' }] });
    const askers: string[] = [];
    for (let i = 0; i < 40 && (s.pending !== null) && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); i++) {
      const d = s.pending!;
      if (d.kind === 'order') { askers.push(d.player); s = answer(s, { kind: 'order', ids: (d as { items: { id: string }[] }).items.map((x) => x.id).reverse() }); }
      else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else s = settle(s, { targets: [{ kind: 'player', id: 'p2' }] });
    }
    expect(askers).toContain('p2');
    const after = names(s);
    expect([...after].sort()).toEqual([...top3].sort());
    expect(after).toEqual([...top3].reverse()); // arranged by the opponent (reversed), not left as it was
  });
});

describe('CR 115.1, 603.2, 608.2d: "Whenever you become the target of a spell, you may untap this creature."', () => {
  const GOMAZOA = card('Test Dozing Drone', 'Creature — Jellyfish', "Whenever you become the target of a spell, you may untap this creature.", ['1', '3']);
  const PING = card('Test Ping Spell', 'Instant', 'Test Ping Spell deals 1 damage to any target.');
  const game = (): GameState => scenario([], { defs: [GOMAZOA, PING], p1: { hand: ['Test Ping Spell'] }, p2: { battlefield: [{ name: 'Test Dozing Drone', tapped: true }] } });
  const cast = (s0: GameState, target: { kind: 'player'; id: string } | { kind: 'object'; id: ObjectId }, yes = true): GameState =>
    resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ping Spell', 'hand', 'p1') }), { targets: [target], yes }), { yes });
  it('is full', () => { expect(full(GOMAZOA)).toBe(true); });
  it('a spell that targets its controller lets them untap it (if they choose to)', () => {
    const s0 = game();
    const drone = named(s0, 'Test Dozing Drone')[0]!;
    expect(cast(s0, { kind: 'player', id: 'p2' }).objects[drone]!.tapped).toBe(false);
    expect(cast(s0, { kind: 'player', id: 'p2' }, false).objects[drone]!.tapped).toBe(true); // "may": declined
  });
  it('negative: an ability that targets its controller does not trigger it (the ruling: a spell only)', () => {
    const WAND = card('Test Poke Wand', 'Artifact', '{T}: Test Poke Wand deals 1 damage to any target.');
    const s0 = scenario([], { defs: [GOMAZOA, WAND], p1: { battlefield: ['Test Poke Wand'] }, p2: { battlefield: [{ name: 'Test Dozing Drone', tapped: true }] } });
    const drone = named(s0, 'Test Dozing Drone')[0]!;
    const wand = named(s0, 'Test Poke Wand')[0]!;
    const s1 = resolveAll(activate(s0, 'p1', wand, { targets: [{ kind: 'player', id: 'p2' }] }), { yes: true });
    expect(s1.objects[drone]!.tapped).toBe(true);
  });
  it('negative: a spell that targets the creature, or the other player, does not trigger it', () => {
    const s0 = game();
    const drone = named(s0, 'Test Dozing Drone')[0]!;
    expect(cast(s0, { kind: 'object', id: drone }).objects[drone]!.tapped).toBe(true);
    expect(cast(s0, { kind: 'player', id: 'p1' }).objects[drone]!.tapped).toBe(true);
  });
});
