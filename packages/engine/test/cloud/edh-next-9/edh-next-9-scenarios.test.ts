/**
 * Commander lane edh-next, round edh-next-9: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked
 * against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 601.2d, 602.2b, 208.1   "~ deals X damage divided as you choose among any number of target creatures, where X is the greatest power among creatures you control as you cast ~." (Monstrous Onslaught, Lukka)
 *   CR 603.10a, 608.2h, 601.2d "When ~ dies, it deals damage equal to its power divided as you choose among any number of targets." (Orca, Siege Demon)
 *   CR 601.2f, 118.7, 119.3    "~ costs {1} less to cast for each opponent who was dealt damage this turn." (Gnoll War Band), "... for each 1 life you gained this turn." (Licia), "~ costs {G} less to cast for each green creature you control." (Khalni Hydra)
 *   CR 601.2i, 702.8a, 702.51a "Whenever you cast another spell that has flash / a spell that has convoke, ..." (Slitherwisp, Saint Traft and Rem Karolus, Kasla)
 *   CR 205.3m, 205.1a, 611.2a  "Choose a creature type other than Wall. Target creature becomes that type until end of turn." (Unnatural Selection, Imagecrafter)
 *   CR 105.3, 613.1e, 613.4c   "Target creature becomes green and gets +1/+0 until end of turn." (Viridescent Wisps)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: ('W' | 'U' | 'B' | 'R' | 'G')[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d).length === 0;
const pickT = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) });
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
/** Pass priority until the stack is empty again (paying costs automatically). */
const resolveAll = (s0: GameState): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 30 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = settle(pass(s));
  return s;
};
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const canCast = (s: GameState, name: string): boolean => {
  const id = find(s, name, 'hand', 'p1');
  return legal(s, 'p1', 'cast').some((a) => a.object === id);
};
const cast = (s: GameState, name: string): GameState => resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never)));

const WALL = card('Test Wall', 'Creature — Wall', '', { pt: ['0', '30'], cost: '{1}' });
const WALLB = card('Test Wall Twin', 'Creature — Wall', '', { pt: ['0', '30'], cost: '{1}' });
const BIG = card('Test Big', 'Creature — Giant', '', { pt: ['3', '3'], cost: '{1}' });
const SMALL = card('Test Small', 'Creature — Elf', '', { pt: ['1', '1'], cost: '{1}' });
const HUGE = card('Test Huge', 'Creature — Giant', '', { pt: ['5', '5'], cost: '{1}' });

// ---------------------------------------------------------------------------------------------------------------------------------
// "where X is the greatest power among creatures you control as you cast ~" (CR 601.2d, 208.1)
// ---------------------------------------------------------------------------------------------------------------------------------
const ONSLAUGHT = card('Test Onslaught', 'Sorcery', 'Test Onslaught deals X damage divided as you choose among any number of target creatures, where X is the greatest power among creatures you control as you cast this spell.', { cost: '{0}', colors: ['R'] });
const WALKER = card('Test Walker', 'Legendary Planeswalker — Test', '+1: You gain 1 life.\n−4: Test Walker deals X damage divided as you choose among any number of target creatures and/or planeswalkers, where X is the greatest power among creatures you control as you activate this ability.', { cost: '{0}', loyalty: '5' });

describe('CR 601.2d, 208.1: "~ deals X damage divided as you choose among any number of target creatures, where X is the greatest power among creatures you control as you cast this spell."', () => {
  const board = (): GameState => scenario([], {
    defs: [ONSLAUGHT, WALL, WALLB, BIG, SMALL, HUGE],
    p1: { hand: ['Test Onslaught'], battlefield: ['Test Big', 'Test Small'] },
    p2: { battlefield: ['Test Wall', 'Test Wall Twin', 'Test Huge'] },
  });
  it('is automated', () => expect(noManual(ONSLAUGHT)).toEqual([]));
  it('X is the greatest power among YOUR creatures (3, not the opponent\'s 5): the division asked is of 3 and the damage is dealt as divided', () => {
    let s = act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Onslaught', 'hand', 'p1') } as never);
    s = settle(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    const walls = [find(s, 'Test Wall', 'battlefield', 'p2'), find(s, 'Test Wall Twin', 'battlefield', 'p2')];
    s = answer(s, pickT(...walls));
    expect(s.pending?.kind).toBe('chooseDivision');
    expect((s.pending as unknown as { total: number }).total).toBe(3);
    s = resolveAll(answer(s, { kind: 'chooseDivision', amounts: [2, 1] } as DecisionAnswer));
    expect(walls.map((id) => s.objects[id]!.damage)).toEqual([2, 1]);
  });
  it('negative: a division of 4 (more than the greatest power) is not accepted; the opponent\'s Test Huge is not counted', () => {
    let s = settle(act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Onslaught', 'hand', 'p1') } as never));
    s = answer(s, pickT(find(s, 'Test Wall', 'battlefield', 'p2'), find(s, 'Test Wall Twin', 'battlefield', 'p2')));
    expect(s.pending?.kind).toBe('chooseDivision');
    expect(() => answer(s, { kind: 'chooseDivision', amounts: [2, 2] } as DecisionAnswer)).toThrow();
  });
  it('X is fixed as the division is announced: the damage on the stack does not change when the creature with the greatest power leaves in response (ruling 2020-11-10)', () => {
    let s = settle(act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Onslaught', 'hand', 'p1') } as never));
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    s = answer(s, pickT(wall));
    expect(s.pending?.kind === 'chooseDivision' ? 'asked' : 'not asked').toBe('not asked'); // one target: it gets everything, no question
    const big = find(s, 'Test Big', 'battlefield', 'p1');
    // the greatest power drops from 3 to 1 before the spell resolves: the total was fixed when it was cast
    s = { ...s, objects: { ...s.objects, [big]: { ...s.objects[big]!, zone: 'graveyard' } } } as GameState;
    s = resolveAll(s);
    expect(s.objects[wall]!.damage).toBe(3);
  });
  it('a planeswalker\'s loyalty ability reads the greatest power as it is activated (Lukka): -4 deals X divided among creatures and planeswalkers', () => {
    expect(noManual(WALKER)).toEqual([]);
    const s0 = scenario([], { defs: [WALKER, WALL, WALLB, BIG, SMALL], p1: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 5 } }, 'Test Big', 'Test Small'] }, p2: { battlefield: ['Test Wall', 'Test Wall Twin'] } });
    const walker = find(s0, 'Test Walker', 'battlefield', 'p1');
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: walker, ability: 'p:0:1' } as never));
    const walls = [find(s, 'Test Wall', 'battlefield', 'p2'), find(s, 'Test Wall Twin', 'battlefield', 'p2')];
    expect(s.pending?.kind).toBe('chooseTargets');
    s = answer(s, pickT(...walls));
    expect((s.pending as unknown as { total: number }).total).toBe(3);
    s = resolveAll(answer(s, { kind: 'chooseDivision', amounts: [1, 2] } as DecisionAnswer));
    expect(walls.map((id) => s.objects[id]!.damage)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "When ~ dies, it deals damage equal to its power divided as you choose among any number of targets." (CR 603.10a)
// ---------------------------------------------------------------------------------------------------------------------------------
const ORCA = card('Test Orca', 'Creature — Demon', 'Trample\nWhen this creature dies, it deals damage equal to its power divided as you choose among any number of targets.', { pt: ['2', '2'], cost: '{0}' });
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.', { cost: '{0}', colors: ['B'] });

describe('CR 603.10a, 608.2h, 601.2d: "When ~ dies, it deals damage equal to its power divided as you choose among any number of targets."', () => {
  const board = (counters = 2): GameState => scenario([], {
    defs: [ORCA, DOOM, WALL, WALLB],
    p1: { hand: ['Test Doom'], battlefield: [{ name: 'Test Orca', counters: { '+1/+1': counters } }] },
    p2: { battlefield: ['Test Wall', 'Test Wall Twin'] },
  });
  it('is automated', () => expect(noManual(ORCA)).toEqual([]));
  it('the power it had on the battlefield counts (2 + two counters = 4): the division asked is of 4', () => {
    let s = settle(act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Doom', 'hand', 'p1') } as never));
    s = answer(s, pickT(find(s, 'Test Orca', 'battlefield', 'p1')));
    for (let g = 0; g < 10 && s.pending?.kind === 'priority' && s.pending.player !== 'p1'; g++) s = pass(s);
    s = settle(pass(s));
    for (let g = 0; g < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; g++) {
      if (s.pending.kind === 'priority' && s.zones.stack.length > 0) s = settle(pass(s));
    }
    expect(s.pending?.kind).toBe('chooseTargets');
    const walls = [find(s, 'Test Wall', 'battlefield', 'p2'), find(s, 'Test Wall Twin', 'battlefield', 'p2')];
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: walls[0]! }, { kind: 'object', id: walls[1]! }] } as DecisionAnswer);
    expect(s.pending?.kind).toBe('chooseDivision');
    expect((s.pending as unknown as { total: number }).total).toBe(4);
    s = resolveAll(answer(s, { kind: 'chooseDivision', amounts: [3, 1] } as DecisionAnswer));
    expect(walls.map((id) => s.objects[id]!.damage)).toEqual([3, 1]);
  });
  it('negative: with no counters the power is 2, so a division of 3 is not accepted', () => {
    let s = settle(act(board(0), { type: 'cast', player: 'p1', card: find(board(0), 'Test Doom', 'hand', 'p1') } as never));
    s = answer(s, pickT(find(s, 'Test Orca', 'battlefield', 'p1')));
    for (let g = 0; g < 10 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; g++) s = settle(pass(s));
    expect(s.pending?.kind).toBe('chooseTargets');
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Wall', 'battlefield', 'p2') }, { kind: 'object', id: find(s, 'Test Wall Twin', 'battlefield', 'p2') }] } as DecisionAnswer);
    expect((s.pending as unknown as { total: number }).total).toBe(2);
    expect(() => answer(s, { kind: 'chooseDivision', amounts: [2, 1] } as DecisionAnswer)).toThrow();
  });
});

const ORCA_SELF = card('Test Orca Self', 'Creature — Demon', 'When this creature dies, it deals damage equal to this creature\'s power divided as you choose among any number of targets.', { pt: ['2', '2'], cost: '{0}' });

describe('CR 603.10a: a dies trigger that names its own source ("equal to this creature\'s power") reads the power it last had', () => {
  it('the division asked is of 4 (2 + two counters), not an unreadable amount that drops the trigger', () => {
    const s0 = scenario([], { defs: [ORCA_SELF, DOOM, WALL, WALLB], p1: { hand: ['Test Doom'], battlefield: [{ name: 'Test Orca Self', counters: { '+1/+1': 2 } }] }, p2: { battlefield: ['Test Wall', 'Test Wall Twin'] } });
    expect(noManual(ORCA_SELF)).toEqual([]);
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Doom', 'hand', 'p1') } as never));
    s = answer(s, pickT(find(s, 'Test Orca Self', 'battlefield', 'p1')));
    for (let g = 0; g < 10 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; g++) s = settle(pass(s));
    expect(s.pending?.kind).toBe('chooseTargets');
    s = answer(s, pickT(find(s, 'Test Wall', 'battlefield', 'p2'), find(s, 'Test Wall Twin', 'battlefield', 'p2')));
    expect((s.pending as unknown as { total: number }).total).toBe(4);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// cost reductions (CR 601.2f, 118.7, 119.3)
// ---------------------------------------------------------------------------------------------------------------------------------
const BAND = card('Test Band', 'Creature — Gnoll', 'Test Band costs {1} less to cast for each opponent who was dealt damage this turn.', { pt: ['2', '2'], cost: '{2}{R}', colors: ['R'] });
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to target player.', { cost: '{0}', colors: ['R'] });
const GALE = card('Test Gale', 'Creature — Vampire', 'This spell costs {1} less to cast for each 1 life you gained this turn.', { pt: ['2', '2'], cost: '{2}{W}', colors: ['W'] });
const HEAL = card('Test Heal', 'Instant', 'You gain 2 life.', { cost: '{0}', colors: ['W'] });
const HYDRA = card('Test Hydra', 'Creature — Hydra', 'This spell costs {G} less to cast for each green creature you control.', { pt: ['4', '4'], cost: '{2}{G}{G}', colors: ['G'] });
const GREEN = card('Test Sprout', 'Creature — Plant', '', { pt: ['1', '1'], cost: '{G}', colors: ['G'] });
const RED = card('Test Ember', 'Creature — Elemental', '', { pt: ['1', '1'], cost: '{R}', colors: ['R'] });

describe('CR 601.2f, 119.3, 120.2a: "~ costs {1} less to cast for each opponent who was dealt damage this turn."', () => {
  const board = (): GameState => scenario(['Mountain'], { defs: [BAND, ZAP], p1: { hand: ['Test Band', 'Test Zap'], battlefield: ['Mountain', 'Mountain'] } });
  it('is automated', () => expect(noManual(BAND)).toEqual([]));
  it('before any damage {2}{R} needs three mana: two lands are not enough; after the opponent is dealt damage it costs {1}{R}', () => {
    const s0 = board();
    expect(canCast(s0, 'Test Band')).toBe(false);
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') } as never));
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer);
    s = resolveAll(s);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
    expect(canCast(s, 'Test Band')).toBe(true);
  });
  it('negative: damage dealt to yourself does not count', () => {
    const s0 = board();
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') } as never));
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] } as DecisionAnswer);
    s = resolveAll(s);
    expect(canCast(s, 'Test Band')).toBe(false);
  });
});

describe('CR 601.2f, 119.3: "This spell costs {1} less to cast for each 1 life you gained this turn."', () => {
  const board = (): GameState => scenario([], { defs: [GALE, HEAL], p1: { hand: ['Test Gale', 'Test Heal'], battlefield: ['Plains', 'Plains'] } });
  it('is automated', () => expect(noManual(GALE)).toEqual([]));
  it('after gaining 2 life this turn {2}{W} costs {W}: castable with one Plains left; without the life gain two Plains are not enough', () => {
    const s0 = board();
    expect(canCast(s0, 'Test Gale')).toBe(false);
    const s = cast(s0, 'Test Heal');
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
    expect(canCast(s, 'Test Gale')).toBe(true);
  });
});

describe('CR 601.2f, 118.7b, 118.7c: "~ costs {G} less to cast for each green creature you control."', () => {
  const board = (green: number, red: number, plains: number): GameState => scenario(['Forest'], {
    defs: [HYDRA, GREEN, RED],
    p1: { hand: ['Test Hydra'], battlefield: [...Array<string>(green).fill('Test Sprout'), ...Array<string>(red).fill('Test Ember'), ...Array<string>(plains).fill('Forest')] },
  });
  it('is automated', () => expect(noManual(HYDRA)).toEqual([]));
  it('two green creatures take {G}{G} off {2}{G}{G}: two Forests pay the {2}', () => {
    expect(canCast(board(2, 0, 2), 'Test Hydra')).toBe(true);
  });
  it('negative: one green creature leaves {2}{G}: two Forests are not enough; red creatures are not counted', () => {
    expect(canCast(board(1, 0, 2), 'Test Hydra')).toBe(false);
    expect(canCast(board(0, 3, 2), 'Test Hydra')).toBe(false);
  });
  it('a reduction beyond the green in the cost reduces the generic part (CR 118.7c): three green creatures leave {1}', () => {
    expect(canCast(board(3, 0, 1), 'Test Hydra')).toBe(true);
    expect(canCast(board(3, 0, 0), 'Test Hydra')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Whenever you cast another spell that has flash / a spell that has convoke" (CR 601.2i, 702.8a, 702.51a)
// ---------------------------------------------------------------------------------------------------------------------------------
const WISP = card('Test Wisp', 'Creature — Faerie', 'Flash\nWhenever you cast another spell that has flash, you draw a card and each opponent loses 1 life.', { pt: ['1', '1'], cost: '{0}', colors: ['U'] });
const FLASHER = card('Test Flasher', 'Creature — Faerie', 'Flash', { pt: ['1', '1'], cost: '{0}', colors: ['U'] });
const PLAIN = card('Test Plain', 'Sorcery', 'You gain 1 life.', { cost: '{0}', colors: ['U'] });
const FILLER = card('Test Filler', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{1}' });
const KNIGHT = card('Test Knight', 'Creature — Human', 'Whenever you cast a spell that has convoke, untap this creature.', { pt: ['2', '2'], cost: '{0}' });
const CONVOKER = card('Test Convoker', 'Sorcery', 'Convoke\nYou gain 1 life.', { cost: '{0}', colors: ['W'] });

describe('CR 601.2i, 702.8a: "Whenever you cast another spell that has flash, you draw a card and each opponent loses 1 life."', () => {
  const board = (): GameState => scenario([], { defs: [WISP, FLASHER, PLAIN, FILLER], p1: { hand: ['Test Flasher', 'Test Plain'], battlefield: ['Test Wisp'], library: ['Test Filler', 'Test Filler', 'Test Filler'] } });
  it('is automated', () => expect(noManual(WISP)).toEqual([]));
  it('casting another spell with flash draws a card and each opponent loses 1 life', () => {
    const s0 = board();
    const handBefore = s0.zones.hand['p1']!.length;
    const s = cast(s0, 'Test Flasher');
    expect(s.zones.hand['p1']!.length).toBe(handBefore - 1 + 1);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
  });
  it('negative: a spell without flash does not trigger it', () => {
    const s = cast(board(), 'Test Plain');
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20);
  });
  it('negative: the Wisp itself is not "another spell": casting it from hand triggers nothing for itself', () => {
    const s0 = scenario([], { defs: [WISP, FILLER], p1: { hand: ['Test Wisp'], library: ['Test Filler', 'Test Filler'] } });
    const s = cast(s0, 'Test Wisp');
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(20);
  });
});

describe('CR 601.2i, 702.51a: "Whenever you cast a spell that has convoke, untap this creature."', () => {
  const board = (): GameState => scenario([], { defs: [KNIGHT, CONVOKER, PLAIN], p1: { hand: ['Test Convoker', 'Test Plain'], battlefield: [{ name: 'Test Knight', tapped: true }] } });
  it('is automated', () => expect(noManual(KNIGHT)).toEqual([]));
  it('casting a spell with convoke untaps it (whether or not a creature was tapped for convoke)', () => {
    const s0 = board();
    const knight = find(s0, 'Test Knight', 'battlefield', 'p1');
    expect(s0.objects[knight]!.tapped).toBe(true);
    const s = cast(s0, 'Test Convoker');
    expect(s.objects[knight]!.tapped).toBe(false);
  });
  it('negative: a spell without convoke leaves it tapped', () => {
    const s0 = board();
    const knight = find(s0, 'Test Knight', 'battlefield', 'p1');
    const s = cast(s0, 'Test Plain');
    expect(s.objects[knight]!.tapped).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Choose a creature type other than Wall. Target creature becomes that type until end of turn." (CR 205.3m, 205.1a)
// ---------------------------------------------------------------------------------------------------------------------------------
const SELECTION = card('Test Selection', 'Enchantment', '{1}: Choose a creature type other than Wall. Target creature becomes that type until end of turn.', { cost: '{0}', colors: ['U'] });
const BEAR = card('Test Bear', 'Creature — Bear Warrior', '', { pt: ['2', '2'], cost: '{1}' });

describe('CR 205.3m, 205.1a, 608.2d: "Choose a creature type other than Wall. Target creature becomes that type until end of turn."', () => {
  const board = (): GameState => scenario([], { defs: [SELECTION, BEAR], p1: { battlefield: ['Test Selection', 'Test Bear', 'Plains'] } });
  it('is automated', () => expect(noManual(SELECTION)).toEqual([]));
  it('the chosen type replaces the creature types for the turn; Wall is not offered; at the end of turn it is a Bear Warrior again', () => {
    const s0 = board();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Selection', 'battlefield', 'p1'), ability: 'p:0:0' } as never);
    for (let g = 0; g < 12 && s.pending?.kind !== 'chooseName' && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      s = s.pending?.kind === 'chooseTargets' ? answer(s, pickT(bear)) : s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    }
    expect(s.pending?.kind).toBe('chooseName');
    const offered = (s.pending as unknown as { options: string[] }).options;
    expect(offered).not.toContain('Wall');
    expect(offered).toContain('Goblin');
    s = resolveAll(answer(s, { kind: 'chooseName', name: 'Goblin' } as DecisionAnswer));
    expect(getChars(s, bear)!.subtypes).toEqual(['Goblin']);
    // negative: it is only until end of turn, the creature types come back in the next turn
    for (let g = 0; g < 300 && s.turn.number < 2; g++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    }
    expect(s.turn.number).toBe(2);
    expect(getChars(s, bear)!.subtypes).toEqual(['Bear', 'Warrior']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Target creature becomes green and gets +1/+0 until end of turn." (CR 105.3, 613.1e, 613.4c)
// ---------------------------------------------------------------------------------------------------------------------------------
const WISPS = card('Test Wisps', 'Instant', 'Target creature becomes green and gets +1/+0 until end of turn.\nDraw a card.', { cost: '{0}', colors: ['U'] });
const REDBEAR = card('Test Red Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}', colors: ['R', 'W'] });

describe('CR 105.3, 613.1e, 613.4c: "Target creature becomes green and gets +1/+0 until end of turn."', () => {
  it('is automated', () => expect(noManual(WISPS)).toEqual([]));
  it('the creature is green only (its old colors are overwritten) and 3/2; you draw a card', () => {
    const s0 = scenario([], { defs: [WISPS, REDBEAR, FILLER], p1: { hand: ['Test Wisps'], battlefield: ['Test Red Bear'], library: ['Test Filler', 'Test Filler'] } });
    const bear = find(s0, 'Test Red Bear', 'battlefield', 'p1');
    expect(getChars(s0, bear)!.colors).toEqual(['W', 'R']);
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Wisps', 'hand', 'p1') } as never));
    s = resolveAll(answer(s, pickT(bear)));
    expect(getChars(s, bear)!.colors).toEqual(['G']);
    expect(stat(s, bear)).toBe('3/2');
    expect(s.zones.hand['p1']!.length).toBe(1);
  });
});

describe('the round\'s cards\' synthetic wordings are fully automated (the templates and readings of edh-next-9)', () => {
  it('every card of this file but the plain bodies compiles without a manual ability', () => {
    for (const d of [ONSLAUGHT, WALKER, ORCA, BAND, GALE, HYDRA, WISP, KNIGHT, SELECTION, WISPS]) expect(full(d), d.name).toBe(true);
  });
});
