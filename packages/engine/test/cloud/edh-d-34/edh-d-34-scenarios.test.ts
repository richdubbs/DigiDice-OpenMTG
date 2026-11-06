/**
 * Commander lane turns-stack, round edh-d-34 (coordinator D): the behavior of what the round added, played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names, design 6.10). Each test has its negative case. CR cites from the real text of 2026-09-25 where marked "checked", else from memory.
 *
 *   CR 500.8, 508.1      "After this main phase, there is an additional combat phase. Only the chosen creatures can attack during that combat phase."
 *   CR 500.8, 511.1      "After this combat phase, there is an additional combat phase." and the emblem "At the end of the first combat phase on your turn, ..."
 *   CR 107.14, 608.2c    "You get {E}{E}, then you may pay eight {E}. If you pay, untap all creatures you control, and after this phase, there is an additional combat phase."
 *   CR 500.7             "Take an extra turn after this one if an opponent cast a blue spell this turn", "For each five counters removed this way, take an extra turn"
 *   CR 601.3, 101.2      "Cast this spell only during your turn."
 *   CR 603.12, 608.2c    "Then if this enchantment has no time counters on it, exile it. When you do, take an extra turn after this one."
 *   CR 118.3, 401.4      "Put this creature on the bottom of its owner's library" as a cost.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, life, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const energy = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;

interface Script { targets?: ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][]; objects?: ((options: readonly ObjectId[]) => ObjectId[])[]; yes?: boolean[] }
function drive(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers' && s.pending.kind !== 'declareBlockers'; guard++) {
    const p = s.pending;
    let a: DecisionAnswer;
    if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'chooseTargets') a = { kind: 'chooseTargets', targets: sc.targets?.shift() ?? [] };
    else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: sc.objects?.shift()?.(p.options) ?? p.options.slice(0, p.min) };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: sc.yes?.shift() ?? true };
    else if (p.kind === 'order') a = { kind: 'order', ids: p.items.map((x) => x.id) };
    else throw new Error(`unexpected decision ${p.kind}`);
    s = answer(s, a);
  }
  return s;
}
function resolveAll(s0: GameState, sc: Script = {}): GameState {
  let s = drive(s0, sc);
  for (let i = 0; i < 16 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = drive(pass(pass(s)), sc);
  return s;
}
const cast = (s: GameState, name: string, sc: Script = {}, player: PlayerId = 'p1'): GameState => resolveAll(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), sc);
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });

/** Plays the rest of turn 1 (resolving everything, attacking with `attackWith` in every combat); returns the candidates offered at each declare attackers decision. */
function playTurn(s0: GameState, attackWith: (candidates: ObjectId[]) => ObjectId[] = () => [], sc: Script = {}): { s: GameState; offered: ObjectId[][] } {
  let s = s0;
  const offered: ObjectId[][] = [];
  for (let guard = 0; guard < 600 && s.turn.number === 1 && !s.result; guard++) {
    const d = s.pending;
    if (d?.kind === 'declareAttackers') {
      const c = d.candidates.map((x) => x.id);
      offered.push([...c].sort());
      s = answer(s, { kind: 'declareAttackers', attacks: attackWith(c).map((id) => ({ attacker: id, defender: 'p2' })) } as unknown as DecisionAnswer);
    } else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d?.kind === 'priority') s = s.zones.stack.length > 0 ? resolveAll(s, sc) : pass(s);
    else if (d) s = drive(s, sc);
    else break;
  }
  return { s, offered };
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['2', '3'] });
const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['3', '1'] });

describe('CR 500.8, 508.1: "After this main phase, there is an additional combat phase. Only the chosen creatures can attack during that combat phase."', () => {
  const NIGHT = card('Test Night Raid', 'Sorcery', 'Choose two target creatures. Untap them. After this main phase, there is an additional combat phase. Only the chosen creatures can attack during that combat phase.');
  const DEFS = [NIGHT, BEAR, OX, WOLF];
  it('is automated', () => expect(full(NIGHT)).toBe(true));
  it('the added combat offers only the two chosen creatures; the regular combat after it offers all three', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Night Raid'], battlefield: ['Test Bear', 'Test Ox', 'Test Wolf'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const ox = find(s0, 'Test Ox', 'battlefield', 'p1');
    const wolf = find(s0, 'Test Wolf', 'battlefield', 'p1');
    const s1 = cast(s0, 'Test Night Raid', { targets: [[obj(bear), obj(ox)]] });
    const { offered } = playTurn(s1);
    expect(offered).toEqual([[bear, ox].sort(), [bear, ox, wolf].sort()]);
  });
  it('negative: a chosen creature that left the battlefield cannot attack, and the unchosen one still cannot', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Night Raid'], battlefield: ['Test Bear', 'Test Ox', 'Test Wolf'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const ox = find(s0, 'Test Ox', 'battlefield', 'p1');
    const wolf = find(s0, 'Test Wolf', 'battlefield', 'p1');
    const s1 = cast(s0, 'Test Night Raid', { targets: [[obj(bear), obj(wolf)]] });
    const { offered } = playTurn(s1);
    expect(offered[0]).toEqual([bear, wolf].sort());
    expect(offered[0]).not.toContain(ox);
  });
});

describe('CR 500.8, 511.1: "After this combat phase, there is an additional combat phase." (first time each turn)', () => {
  const RUNNER = card('Test Raph Runner', 'Creature — Turtle', 'Whenever ~ deals combat damage to a player for the first time each turn, untap all attacking creatures. After this combat phase, there is an additional combat phase.', { pt: ['2', '2'] });
  it('is automated', () => expect(full(RUNNER)).toBe(true));
  it('combat damage to a player: one more combat phase follows (two declare attackers decisions); the first-time limit stops a third', () => {
    const s0 = scenario([], { defs: [RUNNER], p1: { battlefield: ['Test Raph Runner'] } });
    const { offered } = playTurn(s0, (c) => c);
    expect(offered.length).toBe(2);
  });
  it('negative: no combat damage to a player, no extra combat', () => {
    const s0 = scenario([], { defs: [RUNNER], p1: { battlefield: ['Test Raph Runner'] } });
    const { offered } = playTurn(s0, () => []);
    expect(offered.length).toBe(1);
  });
});

describe('CR 107.14, 608.2c: "You get {E}{E}, then you may pay eight {E}. If you pay, untap all creatures you control, and after this phase, there is an additional combat phase."', () => {
  const STORM = card('Test Storm Runner', 'Creature — Human Warrior', 'Whenever ~ attacks, you get {E}{E}, then you may pay eight {E}. If you pay, untap all creatures you control, and after this phase, there is an additional combat phase.', { pt: ['2', '2'] });
  const start = (n: number): GameState => {
    const s = scenario([], { defs: [STORM], p1: { battlefield: ['Test Storm Runner'] } });
    s.players.find((p) => p.id === 'p1')!.counters['energy'] = n;
    return s;
  };
  it('is automated', () => expect(full(STORM)).toBe(true));
  it('with six energy: gets two, pays eight, the creature untaps and one more combat phase follows', () => {
    const { s, offered } = playTurn(start(6), (c) => c, { yes: [true, false, false, false] });
    expect(offered.length).toBe(2); // the added combat: the creature attacks again, gets two more, and cannot pay again
    expect(energy(s, 'p1')).toBe(2);
  });
  it('negative: with fewer than eight after the gain, it cannot pay and there is no extra combat', () => {
    const { s, offered } = playTurn(start(5), (c) => c);
    expect(offered.length).toBe(1);
    expect(energy(s, 'p1')).toBe(7);
  });
  it('negative: declining the payment keeps the energy and adds no combat', () => {
    const { s, offered } = playTurn(start(6), (c) => c, { yes: [false] });
    expect(offered.length).toBe(1);
    expect(energy(s, 'p1')).toBe(8);
  });
});

describe('CR 500.7, 601.3: "Cast this spell only during your turn. Take an extra turn after this one if an opponent cast a blue spell this turn."', () => {
  const SEED = card('Test Seedling', 'Instant', 'Cast this spell only during your turn.\nTake an extra turn after this one if an opponent cast a blue spell this turn.');
  const BLUE = card('Test Blue Zap', 'Instant', 'You gain 1 life.', { colors: ['U'], cost: '{U}' });
  const RED = card('Test Red Zap', 'Instant', 'You gain 1 life.', { colors: ['R'], cost: '{R}' });
  const DEFS = [SEED, BLUE, RED];
  it('is automated', () => expect(full(SEED)).toBe(true));
  it('an opponent cast a blue spell this turn: you take an extra turn', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Seedling'] }, p2: { hand: ['Test Blue Zap'], battlefield: ['Island'] } });
    s = cast(act(s, { type: 'pass', player: 'p1' }), 'Test Blue Zap', {}, 'p2');
    s = cast(s, 'Test Seedling');
    expect(s.turn.extraTurns).toEqual(['p1']);
  });
  it('negative: the opponent cast a red spell only, or none: no extra turn', () => {
    let s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Seedling'] }, p2: { hand: ['Test Red Zap'], battlefield: ['Mountain'] } });
    s = cast(act(s, { type: 'pass', player: 'p1' }), 'Test Red Zap', {}, 'p2');
    s = cast(s, 'Test Seedling');
    expect(s.turn.extraTurns).toEqual([]);
    const s2 = cast(scenario([], { defs: DEFS, p1: { hand: ['Test Seedling'] } }), 'Test Seedling');
    expect(s2.turn.extraTurns).toEqual([]);
  });
  it('negative: it cannot be cast during an opponent\'s turn', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Seedling'] } });
    const s = { ...s0, turn: { ...s0.turn, activePlayer: 'p2' as PlayerId } } as GameState;
    const r = reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Seedling', 'hand', 'p1') });
    expect(r.message).toMatch(/restriction/i);
  });
});

describe('CR 500.7, 107.1c: "Remove all +1/+1 counters from this creature: For each five counters removed this way, take an extra turn after this one."', () => {
  const SAGE = card('Test Hour Sage', 'Creature — Wizard', 'Remove all +1/+1 counters from this creature: For each five counters removed this way, take an extra turn after this one.', { pt: ['1', '1'] });
  const run = (n: number): GameState => {
    const s0 = scenario([], { defs: [SAGE], p1: { battlefield: [{ name: 'Test Hour Sage', counters: { '+1/+1': n } }] } });
    const id = find(s0, 'Test Hour Sage', 'battlefield', 'p1');
    return resolveAll(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' } as never));
  };
  it('is automated', () => expect(full(SAGE)).toBe(true));
  it('eleven counters removed: two extra turns', () => expect(run(11).turn.extraTurns).toEqual(['p1', 'p1']));
  it('negative: four counters removed: none', () => expect(run(4).turn.extraTurns).toEqual([]));
});

describe('CR 603.12, 608.2c: "Then if this enchantment has no time counters on it, exile it. When you do, take an extra turn after this one."', () => {
  const REST = card('Test Restorer', 'Enchantment', 'Whenever you gain life, scry 1. Then if this enchantment has no time counters on it, exile it. When you do, take an extra turn after this one.');
  const GAIN = card('Test Gain', 'Instant', 'You gain 1 life.');
  const run = (counters: Record<string, number>): GameState => {
    const s0 = scenario([], { defs: [REST, GAIN], p1: { hand: ['Test Gain'], battlefield: [{ name: 'Test Restorer', counters }] } });
    return cast(s0, 'Test Gain');
  };
  it('is automated', () => expect(full(REST)).toBe(true));
  it('no time counters: it is exiled and you take an extra turn', () => {
    const s = run({});
    expect(findAll(s, 'Test Restorer', 'exile')).toHaveLength(1);
    expect(s.turn.extraTurns).toEqual(['p1']);
  });
  it('negative: a time counter on it: it stays and there is no extra turn', () => {
    const s = run({ time: 1 });
    expect(findAll(s, 'Test Restorer', 'battlefield')).toHaveLength(1);
    expect(s.turn.extraTurns).toEqual([]);
  });
});

describe('CR 118.3, 401.4: "Put this creature on the bottom of its owner\'s library" as a cost', () => {
  const NAV = card('Test Navigator', 'Creature — Human Pirate', '{T}, Put this creature on the bottom of its owner\'s library: You gain 3 life.', { pt: ['1', '1'] });
  it('is automated', () => expect(full(NAV)).toBe(true));
  it('paying it moves the creature to the bottom of the library and the effect happens', () => {
    const s0 = scenario([], { defs: [NAV], p1: { battlefield: ['Test Navigator'] } });
    const id = find(s0, 'Test Navigator', 'battlefield', 'p1');
    const s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' } as never));
    expect(findAll(s, 'Test Navigator', 'battlefield')).toHaveLength(0);
    const lib = s.zones.library['p1']!;
    expect(s.defs[s.objects[lib[lib.length - 1]!]!.defId]!.name).toBe('Test Navigator');
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 500.8, 511.1: the emblem "At the end of the first combat phase on your turn, untap target creature you control. After this phase, there is an additional combat phase."', () => {
  const EMBLEM = card('Test Archduke', 'Instant', 'You get an emblem with "At the end of the first combat phase on your turn, untap target creature you control. After this phase, there is an additional combat phase."');
  it('is automated', () => expect(full(EMBLEM)).toBe(true));
  it('the first combat of your turn is followed by exactly one more; the second one does not trigger it again', () => {
    const s0 = scenario([], { defs: [EMBLEM, BEAR], p1: { hand: ['Test Archduke'], battlefield: ['Test Bear'] } });
    const s1 = cast(s0, 'Test Archduke');
    const { offered } = playTurn(s1, () => [], { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]] });
    expect(offered.length).toBe(2);
  });
});
