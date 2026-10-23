/**
 * FAST5 T72: a leading "until end of turn" with base power and toughness / "becomes an artifact (creature)", played through the engine with synthetic cards
 * compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 613.1d, 613.4b    types (layer 4) and base power and toughness (layer 7b) are set by a resolved effect; a granted keyword is layer 6
 *   CR 205.1b            "in addition to its other types": the object keeps its card types and subtypes
 *   CR 205.1a            without it, an object that becomes "a Construct artifact creature" gets exactly those types and subtypes
 *   CR 611.2a            the effect lasts until end of turn, then the object is as it was
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Cast the named spell from p1's hand at the given target and let it resolve. */
function castAt(s0: GameState, name: string, target: ObjectId): GameState {
  const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), [obj(target)]);
  return settle(pass(pass(s)));
}
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;

const BEAR = card('Test Bear', 'Creature — Bear', '', ['1', '1']);
const WAND = card('Test Wand', 'Artifact — Equipment', '');
const GOLEM = card('Test Golem', 'Artifact — Golem', '');
const TREASURE_TOKEN = card('Test Coin', 'Artifact — Treasure', '');

describe('CR 613.4b, 611.2a: "Until end of turn, target creature you control has base power and toughness 4/4 and gains flying and hexproof."', () => {
  const WINGS = card('Test Wings', 'Instant', 'Until end of turn, target creature you control has base power and toughness 4/4 and gains flying and hexproof.');
  it('is automated; the creature is a 4/4 with flying and hexproof until end of turn, then a 1/1 again', () => {
    expect(full(WINGS)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Wings'], battlefield: ['Test Bear'] }, defs: [WINGS, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castAt(s0, 'Test Wings', bear);
    const c = chars(s, bear);
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
    expect(hasKeyword(c, 'flying') && hasKeyword(c, 'hexproof')).toBe(true);
    const later = advanceTo(s, s.turn.number + 1, 'upkeep');
    const after = chars(later, bear);
    expect([Number(after.power), Number(after.toughness)]).toEqual([1, 1]);
    expect(hasKeyword(after, 'flying')).toBe(false);
  });
});

describe('CR 205.1b, 613.1d: "Until end of turn, target artifact or creature becomes a Dinosaur artifact creature with base power and toughness 4/3 in addition to its other types."', () => {
  const ROAR = card('Test Roar', 'Instant', 'Until end of turn, target artifact or creature becomes a Dinosaur artifact creature with base power and toughness 4/3 in addition to its other types.');
  it('an Equipment becomes a 4/3 Dinosaur artifact creature and stays an Equipment', () => {
    expect(full(ROAR)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Roar'], battlefield: ['Test Wand'] }, defs: [ROAR, WAND] });
    const wand = find(s0, 'Test Wand', 'battlefield', 'p1');
    const s = castAt(s0, 'Test Roar', wand);
    const c = chars(s, wand);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Equipment', 'Dinosaur']));
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 3]);
    const later = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(chars(later, wand).types).toEqual(['Artifact']);
  });
  it('a creature keeps its subtypes, gains Dinosaur and the artifact type, and is 4/3', () => {
    const s0 = scenario([], { p1: { hand: ['Test Roar'], battlefield: ['Test Bear'] }, defs: [ROAR, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const c = chars(castAt(s0, 'Test Roar', bear), bear);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Bear', 'Dinosaur']));
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 3]);
  });
});

describe('CR 205.1b, 613.1d: "Until end of turn, target creature becomes an artifact in addition to its other types and gains indestructible."', () => {
  const STONE = card('Test Stone', 'Instant', 'Until end of turn, target creature becomes an artifact in addition to its other types and gains indestructible.');
  it('the creature is also an artifact and indestructible until end of turn', () => {
    expect(full(STONE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Stone'], battlefield: ['Test Bear'] }, defs: [STONE, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castAt(s0, 'Test Stone', bear);
    const c = chars(s, bear);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(hasKeyword(c, 'indestructible')).toBe(true);
    expect([Number(c.power), Number(c.toughness)]).toEqual([1, 1]);
    const later = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(chars(later, bear).types).toEqual(['Creature']);
  });
});

describe('CR 613.1d, 613.4b: "Until end of turn, target noncreature artifact you control becomes a 4/4 artifact creature."', () => {
  const COOKIE = card('Test Cookie', 'Instant', 'Until end of turn, target noncreature artifact you control becomes a 4/4 artifact creature.');
  it('a noncreature artifact becomes a 4/4 artifact creature (it keeps its subtype, CR 205.1b)', () => {
    expect(full(COOKIE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Cookie'], battlefield: ['Test Wand'] }, defs: [COOKIE, WAND] });
    const wand = find(s0, 'Test Wand', 'battlefield', 'p1');
    const c = chars(castAt(s0, 'Test Cookie', wand), wand);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
  });
});

describe('CR 205.1a, 613.1d: "Until end of turn, target artifact token you control becomes a 3/1 Construct artifact creature with flying."', () => {
  const MECH = card('Test Mechanic', 'Instant', 'Until end of turn, target artifact token you control becomes a 3/1 Construct artifact creature with flying.');
  it('the artifact becomes exactly a Construct artifact creature 3/1 with flying (its old subtype is replaced)', () => {
    expect(full(MECH)).toBe(true);
    const s1 = scenario([], { p1: { hand: ['Test Mechanic'], battlefield: ['Test Golem'] }, defs: [MECH, GOLEM] });
    const golem = find(s1, 'Test Golem', 'battlefield', 'p1');
    const s0 = tweak(s1, (st) => { st.objects[golem]!.kind = 'token'; });
    const c = chars(castAt(s0, 'Test Mechanic', golem), golem);
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(c.subtypes).toEqual(['Construct']);
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 1]);
    expect(hasKeyword(c, 'flying')).toBe(true);
  });
});

describe('CR 613.1d, 613.4b: "Until end of turn, target artifact becomes an artifact creature with base power and toughness 2/6 and gains flying."', () => {
  const IRON = card('Test Iron', 'Instant', 'Until end of turn, target artifact becomes an artifact creature with base power and toughness 2/6 and gains flying.');
  it('the artifact is a 2/6 artifact creature with flying', () => {
    expect(full(IRON)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Iron'], battlefield: ['Test Coin'] }, defs: [IRON, TREASURE_TOKEN] });
    const coin = find(s0, 'Test Coin', 'battlefield', 'p1');
    const c = chars(castAt(s0, 'Test Iron', coin), coin);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect([Number(c.power), Number(c.toughness)]).toEqual([2, 6]);
    expect(hasKeyword(c, 'flying')).toBe(true);
  });
});
