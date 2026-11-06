/**
 * Commander EDHREC ranks 17,501-18,000, round edh-c-44 (fourth pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 611.2c, 613.4c, 107.3     "Whenever you gain life, each Advisor and Monk you control gains vigilance and gets +X/+0 until end of turn, where X is the amount of life you gained."
 *   CR 608.2c, 608.2h, 120.3     "Exile the top three cards of your library. For each red card exiled this way, ~ deals 1 damage to each opponent."
 *   CR 707.2, 707.9b, 608.2f     "Exile two target creature cards from your graveyard. For each card exiled this way, create a token that's a copy of that card, except it's a 4/4 black Zombie."
 *   CR 202.3, 601.2b, 608.2h     "As an additional cost to cast this spell, discard X cards. ~ deals damage equal to the total mana value of the discarded cards to each of up to X target creatures and/or planeswalkers."
 *   CR 602.1, 605.1a, 115.1      "Destroy target land with an activated ability that isn't a mana ability."
 *   CR 110.4, 205.2a             "the number of permanent types among cards in your graveyard."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars } from '../../../src/index';
import type { GameState, ObjectId } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, card, cast, drive, find, full, lifeOf, named, obj, resolveAll, scenario } from '../r4-cost/support';

const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const onBf = (s: GameState, defId: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));

describe('CR 611.2c, 613.4c, 107.3: "each <group> gains K and gets +X/+0 until end of turn, where X is the amount of life you gained"', () => {
  const MENTOR = card('Test Calm Mentor', 'Legendary Creature — Human Advisor', 'Whenever you gain life, each Advisor and Monk you control gains vigilance and gets +X/+0 until end of turn, where X is the amount of life you gained.', '{0}', ['1', '3']);
  const MONK = card('Test Monk', 'Creature — Human Monk', '', '{0}', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const FOE = card('Test Foe Advisor', 'Creature — Human Advisor', '', '{0}', ['2', '2']);
  const HEAL = card('Test Heal', 'Sorcery', 'You gain 3 life.');
  const FOEHEAL = card('Test Foe Heal', 'Sorcery', 'Target opponent gains 4 life.');
  const board = (): GameState => scenario([], { defs: [MENTOR, MONK, BEAR, FOE, HEAL, FOEHEAL], p1: { battlefield: ['Test Calm Mentor', 'Test Monk', 'Test Bear'], hand: ['Test Heal', 'Test Foe Heal'] }, p2: { battlefield: ['Test Foe Advisor'] } });
  it('is full', () => expect(full(MENTOR)).toBe(true));
  it('gaining 3 life gives +3/+0 and vigilance to the Advisor and the Monk you control (the Mentor is an Advisor itself)', () => {
    const s = resolveAll(cast(board(), 'Test Heal'));
    expect(lifeOf(s, 'p1')).toBe(23);
    const m = onBf(s, 'Test Calm Mentor')[0]!;
    const k = onBf(s, 'Test Monk')[0]!;
    expect(pt(s, m)).toBe('4/3');
    expect(pt(s, k)).toBe('5/2');
    expect(hasKeyword(getChars(s, m)!, 'vigilance')).toBe(true);
    expect(hasKeyword(getChars(s, k)!, 'vigilance')).toBe(true);
  });
  it('negative: a Bear you control and an Advisor an opponent controls are untouched', () => {
    const s = resolveAll(cast(board(), 'Test Heal'));
    const bear = onBf(s, 'Test Bear')[0]!;
    const foe = onBf(s, 'Test Foe Advisor')[0]!;
    expect(pt(s, bear)).toBe('2/2');
    expect(pt(s, foe)).toBe('2/2');
    expect(hasKeyword(getChars(s, bear)!, 'vigilance')).toBe(false);
    expect(hasKeyword(getChars(s, foe)!, 'vigilance')).toBe(false);
  });
  it('negative: the group is fixed when the effect resolves (CR 611.2c): a Monk that enters afterwards gets nothing', () => {
    const LATE = card('Test Late Monk', 'Creature — Human Monk', '', '{0}', ['2', '2']);
    const s0 = scenario([], { defs: [MENTOR, MONK, BEAR, FOE, HEAL, FOEHEAL, LATE], p1: { battlefield: ['Test Calm Mentor', 'Test Monk'], hand: ['Test Heal', 'Test Late Monk'] } });
    const s = resolveAll(cast(resolveAll(cast(s0, 'Test Heal')), 'Test Late Monk'));
    expect(pt(s, onBf(s, 'Test Late Monk')[0]!)).toBe('2/2');
    expect(pt(s, onBf(s, 'Test Monk')[0]!)).toBe('5/2');
  });
  it('negative: an opponent gaining life does not trigger it (the Monk stays 2/2)', () => {
    const s = resolveAll(cast(board(), 'Test Foe Heal', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(lifeOf(s, 'p2')).toBe(24);
    expect(pt(s, onBf(s, 'Test Monk')[0]!)).toBe('2/2');
  });
  it('the amount is the life gained each time (two gains of 3: +3 for each trigger, so +6/+0)', () => {
    let s = resolveAll(cast(board(), 'Test Heal'));
    s = tweak2(s);
    s = resolveAll(cast(s, 'Test Heal'));
    expect(pt(s, onBf(s, 'Test Monk')[0]!)).toBe('8/2');
  });
  /** a second Heal in hand for the same turn */
  function tweak2(s0: GameState): GameState {
    const s = structuredClone(s0);
    const id = `o${s.counters.object++}`;
    s.objects[id] = { ...s.objects[find(s0, 'Test Foe Heal', 'hand', 'p1')]!, id, defId: 'Test Heal', cardId: `c${s.counters.card++}` };
    s.zones.hand['p1']!.push(id);
    return s;
  }
});

describe('CR 608.2c, 608.2h, 120.3: "Exile the top three cards of your library. For each red card exiled this way, ~ deals 1 damage to each opponent."', () => {
  const PYRE = card('Test Ember Study', 'Sorcery', 'Exile the top three cards of your library. For each red card exiled this way, Test Ember Study deals 1 damage to each opponent.', '{0}', undefined, ['R']);
  const RED = card('Test Red Card', 'Sorcery', 'You gain 1 life.', '{R}', undefined, ['R']);
  const BLUE = card('Test Blue Card', 'Sorcery', 'You gain 1 life.', '{U}', undefined, ['U']);
  const run = (top: string[]): GameState => resolveAll(cast(scenario([], { defs: [PYRE, RED, BLUE], p1: { hand: ['Test Ember Study'], library: top }, p2: {} }), 'Test Ember Study'));
  it('is full', () => expect(full(PYRE)).toBe(true));
  it('two red cards among the three exiled deal 2 to each opponent, and all three are exiled', () => {
    const s = run(['Test Red Card', 'Test Blue Card', 'Test Red Card']);
    expect(s.zones.exile).toHaveLength(3);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('negative: no red card among them deals no damage', () => {
    const s = run(['Test Blue Card', 'Test Blue Card', 'Test Blue Card']);
    expect(s.zones.exile).toHaveLength(3);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: a red card deeper in the library than the three exiled is not counted', () => {
    const s = run(['Test Blue Card', 'Test Blue Card', 'Test Blue Card', 'Test Red Card']);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 707.2, 707.9b, 608.2f: "Exile two target creature cards from your graveyard. For each card exiled this way, create a token that\'s a copy of that card, except it\'s a 4/4 black Zombie."', () => {
  const HOUR = card('Test Grave Hour', 'Sorcery', 'Exile two target creature cards from your graveyard. For each card exiled this way, create a token that\'s a copy of that card, except it\'s a 4/4 black Zombie.', '{0}', undefined, ['B']);
  const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', '{1}{W}', ['1', '1'], ['W']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2'], ['G']);
  const OTHER = card('Test Other Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2'], ['G']);
  const board = (): GameState => scenario([], { defs: [HOUR, BIRD, BEAR, OTHER], p1: { hand: ['Test Grave Hour'], graveyard: ['Test Bird', 'Test Bear', 'Test Other Bear'] } });
  const run = (s0: GameState, n: number): GameState => {
    const ids = ['Test Bird', 'Test Bear'].slice(0, n).map((nm) => find(s0, nm, 'graveyard', 'p1'));
    return resolveAll(cast(s0, 'Test Grave Hour', { targets: [ids.map(obj)] }));
  };
  it('is full', () => expect(full(HOUR)).toBe(true));
  it('each exiled card becomes a 4/4 black Zombie token that is a copy of it (the Bird keeps flying; its Bird type is replaced)', () => {
    const s = run(board(), 2);
    const toks = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(toks).toHaveLength(2);
    for (const t of toks) {
      const c = getChars(s, t)!;
      expect(`${c.power}/${c.toughness}`).toBe('4/4');
      expect(c.colors).toEqual(['B']);
      expect(c.subtypes).toEqual(['Zombie']);
      expect(c.types).toContain('Creature');
    }
    expect(toks.some((t) => hasKeyword(getChars(s, t)!, 'flying'))).toBe(true);
    expect(s.zones.exile).toHaveLength(2);
  });
  it('negative: the card not targeted stays in the graveyard and gets no token', () => {
    const s = run(board(), 2);
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toContain('Test Other Bear');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(2);
  });
  it('negative: exactly two targets are required (one is rejected),', () => {
    const s0 = board();
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Grave Hour', 'hand', 'p1') });
    const one = applyAction(s1, { type: 'answer', player: 'p1', decisionId: s1.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(find(s0, 'Test Bird', 'graveyard', 'p1'))] } });
    expect(one.error?.message).toMatch(/exactly 2/);
  });
});

describe('CR 202.3, 601.2b, 608.2h: "discard X cards ... damage equal to the total mana value of the discarded cards to each of up to X target creatures and/or planeswalkers"', () => {
  const WRATH = card('Test Mind Fire', 'Sorcery', 'As an additional cost to cast this spell, discard X cards.\nTest Mind Fire deals damage equal to the total mana value of the discarded cards to each of up to X target creatures and/or planeswalkers.', '{X}{R}', undefined, ['R']);
  const TWO = card('Test Two Drop', 'Sorcery', 'You gain 1 life.', '{1}{G}', undefined, ['G']);
  const THREE = card('Test Three Drop', 'Sorcery', 'You gain 1 life.', '{2}{G}', undefined, ['G']);
  const WALL = card('Test Wall', 'Creature — Wall', '', '{2}', ['0', '5']);
  const GIANT = card('Test Giant', 'Creature — Giant', '', '{4}', ['3', '6']);
  const board = (): GameState => scenario(['Mountain', 'Plains'], { defs: [WRATH, TWO, THREE, WALL, GIANT], p1: { hand: ['Test Mind Fire', 'Test Two Drop', 'Test Three Drop'], battlefield: ['Mountain', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Wall', 'Test Giant'] } });
  const dmg = (s: GameState, nm: string): number => s.objects[onBf(s, nm)[0] ?? '']?.damage ?? -1;
  it('is full', () => expect(full(WRATH)).toBe(true));
  it('X = 2 discarding mana values 2 and 3: 5 damage to each of the two chosen creatures (the 5-toughness Wall dies, the 6-toughness Giant survives)', () => {
    const s0 = board();
    const wall = onBf(s0, 'Test Wall')[0]!;
    const giant = onBf(s0, 'Test Giant')[0]!;
    const s = resolveAll(cast(s0, 'Test Mind Fire', { x: [2], targets: [[obj(wall), obj(giant)]] }));
    expect(s.zones.battlefield).not.toContain(wall);
    expect(dmg(s, 'Test Giant')).toBe(5);
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Mind Fire', 'Test Three Drop', 'Test Two Drop']);
  });
  it('X = 1 discarding the 3-mana-value card: only 3 damage to the one target (the Wall survives)', () => {
    const s0 = board();
    const wall = onBf(s0, 'Test Wall')[0]!;
    const s = resolveAll(cast(s0, 'Test Mind Fire', { x: [1], objects: [[find(s0, 'Test Three Drop', 'hand', 'p1')]], targets: [[obj(wall)]] }));
    expect(s.zones.battlefield).toContain(wall);
    expect(dmg(s, 'Test Wall')).toBe(3);
  });
  it('negative: a card that was not discarded (the Two Drop stays in hand) adds nothing', () => {
    const s0 = board();
    const wall = onBf(s0, 'Test Wall')[0]!;
    const s = resolveAll(cast(s0, 'Test Mind Fire', { x: [1], objects: [[find(s0, 'Test Three Drop', 'hand', 'p1')]], targets: [[obj(wall)]] }));
    expect(s.zones.hand['p1']!.map((id) => s.objects[id]!.defId)).toEqual(['Test Two Drop']);
    expect(dmg(s, 'Test Wall')).toBe(3);
  });
});

describe('CR 602.1, 605.1a, 115.1: "Destroy target land with an activated ability that isn\'t a mana ability."', () => {
  const RAZE = card('Test Raze', 'Sorcery', 'Destroy target land with an activated ability that isn\'t a mana ability.');
  const UTILITY = card('Test Utility Land', 'Land', '{T}: Add {C}.\n{2}, {T}: You gain 1 life.');
  const MANAONLY = card('Test Mana Land', 'Land', '{T}: Add {G}.');
  const BARE = card('Test Bare Land', 'Land', '');
  const AUTO = card('Test Auto Land', 'Land', '{2}, {T}: You gain 1 life.');
  const board = (): GameState => scenario([], { defs: [RAZE, UTILITY, MANAONLY, BARE, AUTO], p1: { hand: ['Test Raze'], battlefield: ['Plains'] }, p2: { battlefield: ['Test Utility Land', 'Test Mana Land', 'Test Bare Land', 'Plains', 'Test Auto Land'] } });
  const tryTarget = (nm: string): { s: GameState; error?: string } => {
    const s0 = board();
    const target = onBf(s0, nm)[0]!;
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Raze', 'hand', 'p1') });
    if (s1.pending?.kind !== 'chooseTargets') return { s: s1, error: 'no target decision' };
    const r = applyAction(s1, { type: 'answer', player: 'p1', decisionId: s1.pending.id, answer: { kind: 'chooseTargets', targets: [obj(target)] } });
    return r.error ? { s: s1, error: r.error.message } : { s: resolveAll(answer(s1, { kind: 'chooseTargets', targets: [obj(target)] })) };
  };
  it('is full', () => expect(full(RAZE)).toBe(true));
  it('a land with a non-mana activated ability is a legal target and is destroyed (also one with only a non-mana ability)', () => {
    for (const nm of ['Test Utility Land', 'Test Auto Land']) {
      const r = tryTarget(nm);
      expect(r.error, nm).toBeUndefined();
      expect(onBf(r.s, nm), nm).toHaveLength(0);
    }
  });
  it('negative: a land whose only activated ability is a mana ability, a basic Plains and a land with no ability are not legal targets', () => {
    for (const nm of ['Test Mana Land', 'Plains', 'Test Bare Land']) expect(tryTarget(nm).error, nm).toBeDefined();
  });
});

describe('CR 110.4, 205.2a: "the number of permanent types among cards in your graveyard"', () => {
  const SPIRE = card('Test Hoard Drake', 'Creature — Drake', 'Whenever this creature deals combat damage to a player, you gain X life, where X is the number of permanent types among cards in your graveyard.', '{0}', ['2', '2']);
  const spire = (): GameState => scenario([], { defs: [SPIRE, card('Test Rod', 'Artifact', ''), card('Test Bear', 'Creature — Bear', '', '{0}', ['1', '1']), card('Test Rite', 'Sorcery', 'You gain 1 life.'), card('Test Bolt', 'Instant', 'You gain 1 life.')], p1: { battlefield: ['Test Hoard Drake'], graveyard: ['Test Rod', 'Test Bear', 'Test Bear', 'Test Rite', 'Test Bolt'] } });
  it('is full', () => expect(full(card('Test Hoard Drake', 'Creature — Drake', 'Whenever this creature deals combat damage to a player, you gain X life, where X is the number of permanent types among cards in your graveyard.', '{0}', ['2', '2']))).toBe(true));
  it('counts artifact and creature once each (Bear twice is one type) and no instant or sorcery: gain 2', () => {
    const s0 = spire();
    const id = onBf(s0, 'Test Hoard Drake')[0]!;
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: id, defender: 'p2' }] });
    for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.zones.stack.length > 0) s = resolveAll(s);
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});

export { named };
