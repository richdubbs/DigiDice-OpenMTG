/**
 * Commander lane edh-c, round edh-c-82 (EDHREC ranks 24,501-25,000, third pass): the round's readings played through the engine with synthetic cards (design 6.10).
 *
 *   CR 702.16g, 702.16a        "Protection from A, from B, and from C." (three protection abilities on one line)
 *   CR 613.4d, 611.2a          "{1}{R}: Switch each creature's power and toughness until end of turn."
 *   CR 510.1a, 613.11          "~ assigns combat damage equal to its toughness rather than its power."
 *   CR 615.1a, 120.1, 611.2a   "Prevent all damage one or two target creatures would deal this turn."
 */
import { describe, expect, it } from 'vitest';
import { act, legal, scenario } from '../../m3/scenario';
import { getChars, type GameState } from '../../../src/index';

import { card, cast, full, named, pt, resolveAll, settle } from '../cmd3/helpers';
import { tweak, attackUnblocked, lifeOf, declareAttackers, toDeclareAttackers, passUntil } from '../../m4/helpers';

describe('CR 702.16g: three protection abilities on one line', () => {
  const OVER = card('Test Triple Ward', 'Creature — Spirit', 'Protection from blue, from black, and from red', ['5', '5']);
  it('is automated, and renders as printed', () => expect(full(OVER)).toBe(true));
  it('has three protection abilities: from blue, black and red, in that order', () => {
    const abs = OVER.faces[0]!.abilities.filter((x) => x.kind === 'keyword') as { keyword: string; quality: string }[];
    expect(abs.map((x) => `${x.keyword} ${x.quality}`)).toEqual(['protection color:U', 'protection color:B', 'protection color:R']);
  });
  it('negative: the two-color line stays two abilities', () => {
    const TWO = card('Test Pair Ward', 'Creature — Spirit', 'Protection from black and from red', ['2', '2']);
    expect(TWO.faces[0]!.abilities.filter((x) => x.kind === 'keyword').length).toBe(2);
  });
});

describe('CR 613.4d: "{1}{R}: Switch each creature\'s power and toughness until end of turn."', () => {
  const FLIP = card('Test Flipper', 'Creature — Dream', '{0}: Switch each creature\'s power and toughness until end of turn.', ['1', '3']);
  const OTHER = card('Test Wall', 'Creature — Wall', '', ['1', '4']);
  it('is automated', () => expect(full(FLIP)).toBe(true));
  it('switches every creature, yours and the opponent\'s, until end of turn', () => {
    const s0 = scenario([], { defs: [FLIP, OTHER], p1: { battlefield: ['Test Flipper'] }, p2: { battlefield: ['Test Wall'] } });
    const f = named(s0, 'Test Flipper')[0]!;
    const w = named(s0, 'Test Wall')[0]!;
    let s = act(s0, (legal(s0, 'p1', 'activate')[0] as unknown as { action: never }).action);
    s = resolveAll(s);
    expect(pt(s, f)).toBe('3/1');
    expect(pt(s, w)).toBe('4/1');
  });
});

describe('CR 510.1a: "~ assigns combat damage equal to its toughness rather than its power."', () => {
  const TURTLE = card('Test Shell Cat', 'Creature — Cat', 'This creature assigns combat damage equal to its toughness rather than its power.', ['1', '4']);
  const MATE = card('Test Plain Cat', 'Creature — Cat', '', ['1', '4']);
  it('is automated', () => expect(full(TURTLE)).toBe(true));
  const hit = (name: string): number => {
    const s0 = scenario([], { defs: [TURTLE, MATE], p1: { battlefield: [name] }, p2: { battlefield: [] } });
    const id = named(s0, name)[0]!;
    let s = declareAttackers(toDeclareAttackers(s0), [[id]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'end', 'combat damage');
    return 20 - lifeOf(s, 'p2');
  };
  it('deals damage equal to its toughness (4)', () => expect(hit('Test Shell Cat')).toBe(4));
  it('negative: another creature with the same stats still deals its power (1)', () => expect(hit('Test Plain Cat')).toBe(1));
});

describe('CR 615.1a: "Prevent all damage one or two target creatures would deal this turn."', () => {
  const PARRY = card('Test Soft Parry', 'Instant', 'Prevent all damage one or two target creatures would deal this turn.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
  it('is automated', () => expect(full(PARRY)).toBe(true));
  const play = (n: number): number => {
    const s0 = scenario([], { defs: [PARRY, BEAR], p1: { hand: ['Test Soft Parry'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    const bears = named(s0, 'Test Bear');
    const tg = bears.slice(0, n).map((id) => ({ kind: 'object', id }) as never);
    const s1 = resolveAll(cast(s0, 'Test Soft Parry', { targets: tg }), { targets: tg });
    const s2 = attackUnblocked(s1, bears);
    return 20 - lifeOf(s2, 'p2');
  };
  it('two targets: only the third bear deals damage (3 of 9)', () => expect(play(2)).toBe(3));
  it('one target (the spell says one or two): two bears deal damage (6)', () => expect(play(1)).toBe(6));
});

describe('CR 700.8, 613.4c: "Equipped creature gets +1/+0 for each creature in your party and has menace."', () => {
  const MACE = card('Test Party Mace', 'Artifact — Equipment', 'Equipped creature gets +1/+0 for each creature in your party and has menace.');
  const CLERIC = card('Test Healer', 'Creature — Human Cleric', '', ['1', '1']);
  const ROGUE = card('Test Thief', 'Creature — Human Rogue', '', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const board = (names: string[]): GameState => {
    const s0 = scenario([], { defs: [MACE, CLERIC, ROGUE, BEAR], p1: { battlefield: ['Test Party Mace', ...names] } });
    const mace = named(s0, 'Test Party Mace')[0]!;
    const bear = named(s0, 'Test Bear')[0]!;
    return tweak(s0, (x) => { x.objects[mace]!.attachedTo = bear; });
  };
  it('is automated', () => expect(full(MACE)).toBe(true));
  it('counts a Cleric and a Rogue (one creature per role): the Bear becomes 4/2', () => {
    const s = board(['Test Bear', 'Test Healer', 'Test Thief']);
    expect(pt(s, named(s, 'Test Bear')[0]!)).toBe('4/2');
  });
  it('negative: a Bear has no party role, so with no Cleric or Rogue nothing is added', () => {
    const s = board(['Test Bear']);
    expect(pt(s, named(s, 'Test Bear')[0]!)).toBe('2/2');
  });
});

describe('CR 205.1b, 613.4b: "Up to two target Swamps each become 3/5 Treefolk Warrior creatures in addition to their other types until end of turn."', () => {
  const SUMMONER = card('Test Bog Caller', 'Creature — Treefolk', '{0}: Up to two target Swamps each become 3/5 Treefolk Warrior creatures in addition to their other types until end of turn.', ['1', '1']);
  it('is automated', () => expect(full(SUMMONER)).toBe(true));
  it('turns the targeted Swamps (and only them) into 3/5 creatures that are still Swamps', () => {
    const s0 = scenario([], { defs: [SUMMONER, card('Swamp', 'Basic Land — Swamp', '')], p1: { battlefield: ['Test Bog Caller', 'Swamp', 'Swamp', 'Swamp'] } });
    const swamps = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Swamp');
    const tg = swamps.slice(0, 2).map((id) => ({ kind: 'object', id }) as never);
    let s = act(s0, (legal(s0, 'p1', 'activate')[0] as unknown as { action: never }).action);
    s = resolveAll(s, { targets: tg });
    expect(pt(s, swamps[0]!)).toBe('3/5');
    expect(pt(s, swamps[1]!)).toBe('3/5');
    expect(s.objects[swamps[2]!]!.defId).toBe('Swamp');
    expect(getChars(s, swamps[2]!)!.types).not.toContain('Creature');
    expect(getChars(s, swamps[0]!)!.subtypes).toEqual(expect.arrayContaining(['Swamp', 'Treefolk', 'Warrior']));
  });
});
