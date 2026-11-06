/**
 * Commander lane counters, third pass, round edh-d-48 (coordinator D): the round's readings played through the engine with synthetic cards (invented names,
 * design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its
 * negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 702.51a, 400.7d, 122.1b  "When ~ enters, put a flying counter on each creature that convoked it." (Zephyr Singer)
 *   CR 702.51a, 614.1c, 122.6   "~ enters with two +1/+1 counters on it for each creature that convoked it." (Ancient Imperiosaur)
 *   CR 701.40a, 701.40e, 608.2h "When ~ dies, manifest a number of cards from the top of your library equal to the number of counters on it." (Omarthis)
 *   CR 122.1, 608.2c            "Then if it has exactly four +1/+1 counters on it, draw a card." (Ayara's Oathsworn)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, card, cast, drive, find, full, obj, resolveAll, scenario } from '../r3-cost/support';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const idsOn = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name);
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters[kind] ?? 0;
const handSize = (s: GameState, p: PlayerId = 'p1'): number => s.zones.hand[p]!.length;
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);

/** Cast `name` from p1's hand, convoking with `convoke`; every other decision at its first option. */
function castConvoking(s0: GameState, name: string, convoke: ObjectId[]): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  let convoked = false;
  for (let k = 0; k < 40 && s.pending && s.pending.kind !== 'priority'; k++) {
    const d = s.pending as unknown as { kind: string; prompt?: string };
    if (d.kind === 'chooseObjects' && !convoked && /pay part of/.test(d.prompt ?? '')) { s = answer(s, { kind: 'chooseObjects', ids: convoke }); convoked = true; }
    else s = drive(s);
  }
  return resolveAll(s);
}

describe('"When ~ enters, put a flying counter on each creature that convoked it." (CR 702.51a, 400.7d, 122.1b; Zephyr Singer)', () => {
  const SINGER = card('Test Songbird', 'Creature — Bird', 'Convoke\nWhen this creature enters, put a flying counter on each creature that convoked it.', '{4}{W}', ['2', '2'], ['W']);
  const defs = [SINGER, BEAR];
  const game = () => scenario([], { p1: { hand: ['Test Songbird'], battlefield: ['Plains', 'Plains', 'Plains', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SINGER)).toBe(true));
  it('only the creatures tapped to convoke get a flying counter; the others and the Songbird get none', () => {
    const s0 = game();
    const [a, b, c] = idsOn(s0, 'Test Bear') as [ObjectId, ObjectId, ObjectId];
    const s = castConvoking(s0, 'Test Songbird', [a, b, c]);
    expect([counters(s, a, 'flying'), counters(s, b, 'flying'), counters(s, c, 'flying')]).toEqual([1, 1, 1]);
    expect(counters(s, idsOn(s, 'Test Songbird')[0]!, 'flying')).toBe(0);
    const t = castConvoking(game(), 'Test Songbird', [a, b]);
    expect([counters(t, a, 'flying'), counters(t, b, 'flying'), counters(t, c, 'flying')]).toEqual([1, 1, 0]);
  });
  it('the negative case: with nobody convoking (paid with mana), no creature gets a counter, and no +1/+1 counter is put', () => {
    const rich = scenario([], { p1: { hand: ['Test Songbird'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Test Bear'] }, p2: {}, defs });
    const s = castConvoking(rich, 'Test Songbird', []);
    const bear = idsOn(s, 'Test Bear')[0]!;
    expect(counters(s, bear, 'flying')).toBe(0);
    expect(counters(s, bear)).toBe(0);
  });
});

describe('"~ enters with two +1/+1 counters on it for each creature that convoked it." (CR 702.51a, 614.1c, 122.6; Ancient Imperiosaur)', () => {
  const SAUR = card('Test Saurian', 'Creature — Dinosaur', 'Convoke\nThis creature enters with two +1/+1 counters on it for each creature that convoked it.', '{4}{W}', ['2', '2'], ['W']);
  const defs = [SAUR, BEAR];
  const game = () => scenario([], { p1: { hand: ['Test Saurian'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(SAUR)).toBe(true));
  it('three convokers give six counters, one gives two', () => {
    const s0 = game();
    const bears = idsOn(s0, 'Test Bear');
    expect(counters(castConvoking(s0, 'Test Saurian', bears), idsOn(castConvoking(s0, 'Test Saurian', bears), 'Test Saurian')[0]!)).toBe(6);
    const one = castConvoking(game(), 'Test Saurian', [bears[0]!]);
    expect(counters(one, idsOn(one, 'Test Saurian')[0]!)).toBe(2);
  });
  it('the negative case: cast without convoking it enters with no counters', () => {
    const s = castConvoking(game(), 'Test Saurian', []);
    expect(counters(s, idsOn(s, 'Test Saurian')[0]!)).toBe(0);
  });
});

describe('"When ~ dies, manifest a number of cards from the top of your library equal to the number of counters on it." (CR 701.40a, 701.40e, 608.2h; Omarthis)', () => {
  const GHOST = card('Test Spectre', 'Creature — Spirit', 'When this creature dies, manifest a number of cards from the top of your library equal to the number of counters on it.', '{0}', ['1', '1']);
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.', '{0}');
  const defs = [GHOST, DOOM, BEAR];
  const game = (n: number) => scenario([], { p1: { hand: ['Test Doom'], battlefield: [{ name: 'Test Spectre', counters: n > 0 ? { '+1/+1': n } : {} }], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: {}, defs });
  const kill = (s: GameState): GameState => resolveAll(cast(s, 'Test Doom', { targets: [[obj(idsOn(s, 'Test Spectre')[0]!)]] }));
  it('has no manual part', () => expect(full(GHOST)).toBe(true));
  it('with three counters on it, three cards are manifested from the top of the library', () => {
    const s0 = game(3);
    const lib0 = s0.zones.library.p1!.length;
    const s = kill(s0);
    expect(s.zones.library.p1!.length).toBe(lib0 - 3);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.faceDown && s.objects[id]!.controller === 'p1').length).toBe(3);
  });
  it('the negative case: with no counters on it, nothing is manifested', () => {
    const s0 = game(0);
    const lib0 = s0.zones.library.p1!.length;
    const s = kill(s0);
    expect(s.zones.library.p1!.length).toBe(lib0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.faceDown).length).toBe(0);
  });
});

describe('"Then if it has exactly four +1/+1 counters on it, draw a card." (CR 122.1, 608.2c; Ayara\'s Oathsworn)', () => {
  const OATH = card('Test Oathkeeper', 'Creature — Human Knight', 'At the beginning of your upkeep, put a +1/+1 counter on this creature. Then if it has exactly four +1/+1 counters on it, draw a card.', '{0}', ['1', '1']);
  const defs = [OATH];
  const game = (n: number) => scenario([], { p1: { battlefield: [{ name: 'Test Oathkeeper', counters: { '+1/+1': n } }], library: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: {}, defs });
  const upkeep = (s: GameState): GameState => resolveAll(advanceTo(s, 3, 'upkeep'));
  it('has no manual part', () => expect(full(OATH)).toBe(true));
  it('three counters become four and a card is drawn', () => {
    const s0 = game(3);
    const h = handSize(advanceTo(s0, 3, 'upkeep'));
    const s = upkeep(s0);
    expect(counters(s, idsOn(s, 'Test Oathkeeper')[0]!)).toBe(4);
    expect(handSize(s)).toBe(h + 1);
  });
  it('the negative cases: one counter becomes two (no card), and four become five (not exactly four)', () => {
    for (const n of [1, 4]) {
      const s0 = game(n);
      const h = handSize(advanceTo(s0, 3, 'upkeep'));
      const s = upkeep(s0);
      expect(counters(s, idsOn(s, 'Test Oathkeeper')[0]!)).toBe(n + 1);
      expect(handSize(s)).toBe(h);
    }
  });
});
