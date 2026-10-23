/**
 * p2-modal-1 (lane p2-modal): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 700.2, 115.3        "Choose one or both. Each mode must target a different player.": the modes' player targets differ; a set of modes with too few players is refused
 *   CR 700.2, 601.2b       "Choose one. If this spell was kicked, choose any number instead.": one mode unkicked, any number (one up to all) kicked
 *   CR 700.2, 119.1        "Choose one. If you have exactly 13 life, you may choose both instead.": both only at exactly that life total
 *   CR 702.62b, 115.1      "target permanent or suspended card", "each suspended card": a card in exile with suspend and a time counter, nothing else in exile
 *   CR 208.1, 608.2d       "choose any number of creatures with different powers": no two chosen creatures share a power
 *   CR 109.2               "each other creature target player controls": other than this object, the player target is no candidate
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, DecisionAnswer, GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/index';
import { act, answer } from '../../m5/helpers';
import { castWith, drive, find, no, resolveAll, resolveTop, scenario, synthetic, target, yes } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const modes = (...ids: number[]): DecisionAnswer => ({ kind: 'chooseOption', ids: ids.map(String) });
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const handOf = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters?.[kind] ?? 0;

const PAIR = synthetic('Test Twin Envoys', 'Creature — Human', '{2}{G}', 'When ~ enters, choose one or both. Each mode must target a different player.\n• Target player draws a card.\n• Target player gains 3 life.', { power: '2', toughness: '2' });
const RIVALS = synthetic('Test Rival Hexer', 'Creature — Human', '{2}{B}', 'When ~ enters, choose one or both. Each mode must target a different player.\n• Target opponent loses 2 life.\n• Target opponent mills two cards.', { power: '2', toughness: '2' });
const KICKED = synthetic('Test Kicked Choice', 'Sorcery', '{1}{U}', 'Kicker {2}\nChoose one. If this spell was kicked, choose any number instead.\n• Draw a card.\n• You gain 2 life.\n• Target player loses 1 life.');
const EXACT = synthetic('Test Thirteen Ward', 'Sorcery', '{1}{B}', 'Choose one. If you have exactly 13 life, you may choose both instead.\n• Draw a card.\n• You gain 2 life.');
const SANDS = synthetic('Test Sand Turner', 'Instant', '{R}', 'Remove two time counters from target permanent or suspended card.');
const DUSTS = synthetic('Test Dust Turner', 'Sorcery', '{2}{W}', 'Put two time counters on each permanent with a time counter on it and each suspended card.');
const SLOW = synthetic('Test Slow Comet', 'Sorcery', '{5}{R}', 'Draw a card.\nSuspend 3—{R}');
const PLAIN = synthetic('Test Plain Comet', 'Sorcery', '{5}{R}', 'Draw a card.');
const CLOCK = synthetic('Test Ticking Clock', 'Artifact', '{2}', '{T}: You gain 1 life.');
const RALLY = synthetic('Test Varied Rally', 'Sorcery', '{1}{W}', 'Choose any number of creatures with different powers. Those creatures gain flying until end of turn.');
const BEAR = synthetic('Test Bear Two', 'Creature — Bear', '{1}{G}', '', { power: '2', toughness: '2' });
const CUB = synthetic('Test Cub Two', 'Creature — Bear', '{1}{G}', '', { power: '2', toughness: '1' });
const OX = synthetic('Test Ox Three', 'Creature — Ox', '{2}{G}', '', { power: '3', toughness: '3' });
const MENTOR = synthetic('Test Kin Mentor', 'Creature — Rat', '{2}{G}', 'When ~ enters, put a +1/+1 counter on each other creature target player controls.', { power: '1', toughness: '1' });
const DEFS = [PAIR, RIVALS, KICKED, EXACT, SANDS, DUSTS, SLOW, PLAIN, CLOCK, RALLY, BEAR, CUB, OX, MENTOR];

describe('the synthetic cards are automated', () => {
  it('every synthetic card with a reading of this round plays fully', () => {
    for (const d of [PAIR, RIVALS, KICKED, EXACT, SANDS, DUSTS, RALLY, MENTOR]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 700.2, 115.3: "Choose one or both. Each mode must target a different player."', () => {
  const board = (name: string): GameState => scenario(['Forest', 'Swamp'], { defs: DEFS, p1: { hand: [name], battlefield: [...lands('Forest', 3), ...lands('Swamp', 3)] } });
  const enter = (name: string): GameState => {
    let s = castWith(board(name), name);
    s = drive(act(s, { type: 'pass', player: 'p1' }));
    return drive(act(s, { type: 'pass', player: s.pending!.player })); // the creature resolves; its enters trigger is put on the stack (modes are chosen now, CR 603.3c)
  };
  it('CR 115.3: with both modes, the second mode\'s target can only be the other player (you draw, the opponent gains 3 life)', () => {
    let s = enter('Test Twin Envoys');
    expect(s.pending?.kind).toBe('chooseOption');
    s = answer(s, modes(0, 1));
    expect(s.pending?.kind).toBe('chooseTargets');
    s = answer(s, target('p1'));
    expect(s.pending?.kind).toBe('chooseTargets');
    expect((s.pending as unknown as { players: string[] }).players).toEqual(['p2']);
    const before = { hand: handOf(s, 'p1'), life: lifeOf(s, 'p2') };
    s = resolveAll(answer(s, target('p2')));
    expect(handOf(s, 'p1')).toBe(before.hand + 1);
    expect(lifeOf(s, 'p2')).toBe(before.life + 3);
  });
  it('CR 115.3: the same player for both modes is refused', () => {
    let s = enter('Test Twin Envoys');
    s = answer(s, modes(0, 1));
    s = answer(s, target('p2'));
    expect(() => answer(s, target('p2'))).toThrow();
  });
  it('CR 700.2: one mode alone may target either player', () => {
    let s = enter('Test Twin Envoys');
    s = answer(s, modes(1));
    const before = lifeOf(s, 'p1');
    s = resolveAll(answer(s, target('p1')));
    expect(lifeOf(s, 'p1')).toBe(before + 3);
  });
  it('CR 700.2, 115.3: in a two-player game, both "target opponent" modes can\'t be chosen together (one opponent); one of them can', () => {
    const s = enter('Test Rival Hexer');
    expect(s.pending?.kind).toBe('chooseOption');
    expect(() => answer(s, modes(0, 1))).toThrow();
    const before = lifeOf(s, 'p2');
    const t = resolveAll(answer(answer(s, modes(0)), target('p2')));
    expect(lifeOf(t, 'p2')).toBe(before - 2);
  });
});

describe('CR 700.2, 601.2b: "Choose one. If this spell was kicked, choose any number instead."', () => {
  const board = (): GameState => scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Kicked Choice'], battlefield: lands('Island', 5) } });
  it('CR 601.2b: kicked, all three modes may be chosen', () => {
    const s0 = board();
    let s = castWith(s0, 'Test Kicked Choice', [yes, modes(0, 1, 2), target('p2')]);
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 2);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 1);
    expect(handOf(s, 'p1')).toBe(handOf(s0, 'p1')); // the spell left the hand, the mode drew one
  });
  it('CR 700.2: not kicked, only one mode', () => {
    const s = castWith(board(), 'Test Kicked Choice', [no]);
    expect(s.pending?.kind).toBe('chooseOption');
    expect((s.pending as unknown as { max: number }).max).toBe(1);
    expect(() => answer(s, modes(0, 1))).toThrow();
  });
});

describe('CR 700.2, 119.1: "If you have exactly 13 life, you may choose both instead."', () => {
  const board = (life: number): GameState => { const s = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Thirteen Ward'], battlefield: lands('Swamp', 2) } }); s.players.find((p) => p.id === 'p1')!.life = life; return s; };
  it('CR 119.1: at exactly 13 life both modes may be chosen', () => {
    const s = castWith(board(13), 'Test Thirteen Ward');
    expect((s.pending as unknown as { max: number }).max).toBe(2);
    const t = resolveAll(drive(answer(s, modes(0, 1))));
    expect(lifeOf(t, 'p1')).toBe(15);
  });
  it('CR 119.1: at 12 or 14 life, only one', () => {
    for (const life of [12, 14]) {
      const s = castWith(board(life), 'Test Thirteen Ward');
      expect((s.pending as unknown as { max: number }).max, String(life)).toBe(1);
    }
  });
});

describe('CR 702.62b, 115.1: "target permanent or suspended card"', () => {
  const board = (): { s: GameState; slow: ObjectId; plain: ObjectId; bare: ObjectId; clock: ObjectId } => {
    const s = scenario(['Mountain'], {
      defs: DEFS,
      p1: { hand: ['Test Sand Turner'], battlefield: [...lands('Mountain', 1), { name: 'Test Ticking Clock', counters: { time: 1 } }] },
      p2: { exile: [{ name: 'Test Slow Comet', counters: { time: 3 } }, { name: 'Test Plain Comet', counters: { time: 3 } }, { name: 'Test Slow Comet' }] },
    });
    const exiled = s.zones.exile;
    const slow = exiled.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Slow Comet' && counters(s, id, 'time') === 3)!;
    const bare = exiled.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Slow Comet' && counters(s, id, 'time') === 0)!;
    return { s, slow, plain: find(s, 'Test Plain Comet', 'exile'), bare, clock: find(s, 'Test Ticking Clock', 'battlefield') };
  };
  it('CR 702.62b: a card in exile with suspend and a time counter is a legal target; one without suspend, or with no time counter, is not', () => {
    const { s, slow, plain, bare, clock } = board();
    const t = castWith(s, 'Test Sand Turner');
    expect(t.pending?.kind).toBe('chooseTargets');
    const objects = (t.pending as unknown as { objects: string[] }).objects;
    expect(objects).toContain(slow);
    expect(objects).toContain(clock);
    expect(objects).not.toContain(plain);
    expect(objects).not.toContain(bare);
  });
  it('CR 122.1: two time counters are removed from the suspended card', () => {
    const { s, slow } = board();
    const t = resolveAll(castWith(s, 'Test Sand Turner', [target(slow)]));
    expect(counters(t, slow, 'time')).toBe(1);
  });
});

describe('CR 702.62b: "each permanent with a time counter on it and each suspended card"', () => {
  it('CR 702.62b: the suspended card and the permanent with a time counter get two more; a card in exile without suspend gets none', () => {
    let s = scenario(['Plains'], {
      defs: DEFS,
      p1: { hand: ['Test Dust Turner'], battlefield: [...lands('Plains', 3), { name: 'Test Ticking Clock', counters: { time: 1 } }] },
      p2: { exile: [{ name: 'Test Slow Comet', counters: { time: 3 } }, { name: 'Test Plain Comet', counters: { time: 3 } }] },
    });
    const slow = find(s, 'Test Slow Comet', 'exile');
    const plain = find(s, 'Test Plain Comet', 'exile');
    const clock = find(s, 'Test Ticking Clock', 'battlefield');
    s = resolveAll(castWith(s, 'Test Dust Turner'));
    expect(counters(s, slow, 'time')).toBe(5);
    expect(counters(s, clock, 'time')).toBe(3);
    expect(counters(s, plain, 'time')).toBe(3);
  });
});

describe('CR 208.1, 608.2d: "Choose any number of creatures with different powers."', () => {
  const board = (): GameState => scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Varied Rally'], battlefield: [...lands('Plains', 2), 'Test Bear Two', 'Test Cub Two', 'Test Ox Three'] } });
  const flying = (s: GameState, id: ObjectId): boolean => getChars(s, id).keywords.some((k) => k.keyword === 'flying');
  it('CR 208.1: two creatures of power 2 are never chosen together; a power 2 and a power 3 creature are', () => {
    let s = resolveTop(castWith(board(), 'Test Varied Rally'));
    const bear = find(s, 'Test Bear Two', 'battlefield');
    const cub = find(s, 'Test Cub Two', 'battlefield');
    const ox = find(s, 'Test Ox Three', 'battlefield');
    const picks: string[] = [];
    // the chooser takes them one at a time (std-library-1's `distinct`): after the bear, the cub (power 2 too) is no longer offered
    while (s.pending && s.pending.kind !== 'priority') {
      expect(s.pending.kind).toBe('chooseObjects');
      const ids = (s.pending as unknown as { options: string[] }).options;
      if (picks.length === 1) expect(ids).not.toContain(cub);
      const next = picks.length === 0 ? bear : picks.length === 1 ? ox : undefined;
      if (next !== undefined && ids.includes(next)) { picks.push(next); s = answer(s, { kind: 'chooseObjects', ids: [next] }); continue; }
      s = answer(s, { kind: 'chooseObjects', ids: [] });
    }
    expect(picks).toEqual([bear, ox]);
    expect(flying(s, bear)).toBe(true);
    expect(flying(s, ox)).toBe(true);
    expect(flying(s, cub)).toBe(false);
  });
});

describe('CR 109.2: "put a +1/+1 counter on each other creature target player controls"', () => {
  it('CR 109.2: targeting its controller, the other creatures get a counter and this creature does not; targeting the opponent, the opponent\'s creatures do', () => {
    const board = (): GameState => scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Kin Mentor'], battlefield: [...lands('Forest', 3), 'Test Bear Two'] }, p2: { battlefield: ['Test Ox Three'] } });
    const enterWith = (who: 'p1' | 'p2'): GameState => {
      let s = castWith(board(), 'Test Kin Mentor');
      s = drive(act(s, { type: 'pass', player: 'p1' }));
      s = drive(act(s, { type: 'pass', player: s.pending!.player }), [target(who)]);
      return resolveAll(s);
    };
    let s = enterWith('p1');
    expect(counters(s, find(s, 'Test Kin Mentor', 'battlefield'), '+1/+1')).toBe(0);
    expect(counters(s, find(s, 'Test Bear Two', 'battlefield'), '+1/+1')).toBe(1);
    expect(counters(s, find(s, 'Test Ox Three', 'battlefield'), '+1/+1')).toBe(0);
    s = enterWith('p2');
    expect(counters(s, find(s, 'Test Ox Three', 'battlefield'), '+1/+1')).toBe(1);
    expect(counters(s, find(s, 'Test Bear Two', 'battlefield'), '+1/+1')).toBe(0);
  });
});
