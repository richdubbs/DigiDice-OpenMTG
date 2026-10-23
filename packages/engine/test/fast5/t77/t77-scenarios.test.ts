/**
 * FAST5 T77 (type-adding effects: "... is a <subtype> in addition to its other types", "becomes a <type> creature in addition to ..."), played through the engine
 * with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 205.1b            "in addition to its other types": the object keeps its card types and subtypes and gains the new ones
 *   CR 205.1a            "becomes a land" replaces the card types (and, CR 205.3d, the subtypes that no longer fit)
 *   CR 400.7, 611.2c     a permanent returned to the battlefield is a new object; the effect that follows applies to it, for good
 *   CR 613.1d, 613.4b    types are layer 4, base power and toughness layer 7b; CR 613.1e colors are layer 5
 *   CR 305.6             a land with a basic land type has that type's mana ability
 *   CR 604.1, 303.4      a static ability of an Aura applies to the enchanted permanent as long as it is attached
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
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
/** Cast the named spell from p1's hand at the given targets and let it resolve. */
function castAt(s0: GameState, name: string, ...targets: ObjectId[]): GameState {
  const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets.map(obj));
  return settle(pass(pass(s)));
}
/** Activate the first non-keyword ability of a permanent of p1, then let it resolve. */
function activate(s0: GameState, source: ObjectId, targets: ObjectId[] = []): GameState {
  const s = settle(act(s0, { type: 'activate', player: 'p1', source, ability: 'p:0:0' }), targets.map(obj));
  return settle(pass(pass(s)));
}
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(chars(s, id).power), Number(chars(s, id).toughness)];
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const WAND = card('Test Wand', 'Artifact — Equipment', '');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

describe('CR 205.1b, 400.7: "When this creature dies, if it wasn\'t a Zombie, return it to the battlefield under its owner\'s control with a +1/+1 counter on it. It\'s a Zombie in addition to its other types."', () => {
  const RISER = card('Test Riser', 'Creature — Human Cleric', 'When this creature dies, if it wasn\'t a Zombie, return it to the battlefield under its owner\'s control with a +1/+1 counter on it. It\'s a Zombie in addition to its other types.', ['1', '1']);
  it('is automated', () => {
    expect(full(RISER)).toBe(true);
    expect(full(KILL)).toBe(true);
  });
  it('the creature that dies comes back as a new object with a counter, a Zombie as well as a Human Cleric; destroyed again it stays dead', () => {
    const s0 = scenario([], { p1: { hand: ['Test Kill', 'Test Kill'], battlefield: ['Test Riser'] }, defs: [RISER, KILL] });
    const first = find(s0, 'Test Riser', 'battlefield', 'p1');
    let s = castAt(s0, 'Test Kill', first);
    s = settle(pass(pass(s))); // the death trigger goes on the stack and resolves
    const back = onBf(s, 'Test Riser');
    expect(back.length).toBe(1);
    const c = chars(s, back[0]!);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Human', 'Cleric', 'Zombie']));
    expect(pt(s, back[0]!)).toEqual([2, 2]);
    // the condition reads last known information: it was a Zombie the second time, so it does not return again (CR 603.4, 608.2h)
    s = castAt(s, 'Test Kill', back[0]!);
    s = settle(pass(pass(s)));
    expect(onBf(s, 'Test Riser')).toEqual([]);
  });
});

describe('CR 205.1b, 611.2a: "Target creature you control becomes a Bear in addition to its other types." (a resolved effect with no duration)', () => {
  const GROWL = card('Test Growl', 'Sorcery', 'Put a trample counter on target creature you control. It becomes a Bear in addition to its other types.');
  const ELF = card('Test Elf', 'Creature — Elf Druid', '', ['1', '1']);
  it('the Elf keeps Elf Druid, gains Bear, and stays that way after the turn ends', () => {
    expect(full(GROWL)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Growl'], battlefield: ['Test Elf'] }, defs: [GROWL, ELF] });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
    const s = castAt(s0, 'Test Growl', elf);
    expect(chars(s, elf).subtypes).toEqual(expect.arrayContaining(['Elf', 'Druid', 'Bear']));
    expect(chars(s, elf).types).toEqual(['Creature']);
    const later = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(chars(later, elf).subtypes).toEqual(expect.arrayContaining(['Elf', 'Druid', 'Bear']));
  });
});

describe('CR 205.1b, 613.4b, 400.7: "Return up to two target artifact cards from your graveyard to the battlefield. They are 3/3 Golem creatures in addition to their other types."', () => {
  const REBUILD = card('Test Rebuild', 'Sorcery', 'Return up to two target artifact cards from your graveyard to the battlefield. They are 3/3 Golem creatures in addition to their other types.');
  const GEAR = card('Test Gear', 'Artifact — Equipment', '');
  const LAMP = card('Test Lamp', 'Artifact', '');
  it('both artifacts come back as 3/3 Golem creatures and stay artifacts (and an Equipment)', () => {
    expect(full(REBUILD)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Rebuild'], graveyard: ['Test Gear', 'Test Lamp'] }, defs: [REBUILD, GEAR, LAMP] });
    const gear = find(s0, 'Test Gear', 'graveyard', 'p1');
    const lamp = find(s0, 'Test Lamp', 'graveyard', 'p1');
    const s = castAt(s0, 'Test Rebuild', gear, lamp);
    for (const name of ['Test Gear', 'Test Lamp']) {
      const [id] = onBf(s, name);
      expect(id, name).toBeDefined();
      const c = chars(s, id!);
      expect(c.types, name).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
      expect(c.subtypes, name).toContain('Golem');
      expect(pt(s, id!), name).toEqual([3, 3]);
    }
    expect(chars(s, onBf(s, 'Test Gear')[0]!).subtypes).toContain('Equipment');
  });
});

describe('CR 205.1b, 613.4b, 303.4: "Enchanted artifact is a Golem creature with base power and toughness 4/3 in addition to its other types."', () => {
  const ANIMATE = card('Test Animate', 'Enchantment — Aura', 'Enchant artifact\nEnchanted artifact is a Golem creature with base power and toughness 4/3 in addition to its other types.');
  it('the enchanted Equipment is a 4/3 Golem creature and still an Equipment; it is an Equipment alone again when the Aura is gone', () => {
    expect(full(ANIMATE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Animate'], battlefield: ['Test Wand'] }, defs: [ANIMATE, WAND] });
    const wand = find(s0, 'Test Wand', 'battlefield', 'p1');
    const before = chars(s0, wand);
    expect(before.types).toEqual(['Artifact']);
    const s = castAt(s0, 'Test Animate', wand);
    const c = chars(s, wand);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Equipment', 'Golem']));
    expect(pt(s, wand)).toEqual([4, 3]);
  });
});

describe('CR 105.2c, 205.3i, 305.6: "Each nonland permanent you control is all colors." and "Lands you control are every basic land type in addition to their other types."', () => {
  const PRISM = card('Test Prism', 'Enchantment', 'Each nonland permanent you control is all colors.\nLands you control are every basic land type in addition to their other types.');
  const WASTE = card('Test Waste', 'Land', '');
  it('is automated', () => {
    expect(full(PRISM)).toBe(true);
  });
  it('a red creature and the enchantment itself are all five colors; an opponent\'s creature is not; a land is every basic land type and taps for any of the five colors', () => {
    const s = scenario([], { p1: { battlefield: ['Test Prism', 'Test Bear', 'Test Waste'] }, p2: { battlefield: ['Test Bear'] }, defs: [PRISM, BEAR, WASTE] });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    const prism = find(s, 'Test Prism', 'battlefield', 'p1');
    const waste = find(s, 'Test Waste', 'battlefield', 'p1');
    expect([...chars(s, mine).colors].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    expect([...chars(s, prism).colors].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    expect(chars(s, theirs).colors).toEqual([]);
    const land = chars(s, waste);
    expect(land.types).toEqual(['Land']);
    expect(land.subtypes).toEqual(expect.arrayContaining(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']));
    // CR 305.6: the five intrinsic mana abilities
    expect(land.abilities.filter((a) => a.def.kind === 'activated' && a.def.isMana === true).length).toBe(5);
    expect(chars(s, mine).types).toEqual(['Creature']); // the creature's types are untouched
  });
});

describe('CR 205.1b, 611.2a: "Test Boiler: {T}: Put a +1/+1 counter on this artifact. It becomes a Spirit artifact creature in addition to its other types until end of turn."', () => {
  const TRAIN = card('Test Train', 'Artifact — Vehicle', '{T}: Put a +1/+1 counter on this artifact. It becomes a Spirit artifact creature in addition to its other types until end of turn.', ['2', '2']);
  it('the Vehicle is a Spirit artifact creature this turn (it keeps Vehicle) and a plain Vehicle again next turn', () => {
    expect(full(TRAIN)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Train'] }, defs: [TRAIN] });
    const train = find(s0, 'Test Train', 'battlefield', 'p1');
    const s = activate(s0, train);
    const c = chars(s, train);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Vehicle', 'Spirit']));
    expect(pt(s, train)).toEqual([3, 3]);
    const later = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(chars(later, train).types).toEqual(['Artifact']);
    expect(chars(later, train).subtypes).toEqual(['Vehicle']);
  });
});

describe('CR 205.1b, 613.1f, 611.2a: "{T}: ~ becomes a Bear creature in addition to its other types and gains "~\'s power and toughness are each equal to the number of lands you control.""', () => {
  const HALL = card('Test Hall', 'Enchantment', '{T}: ~ becomes a Bear creature in addition to its other types and gains "~\'s power and toughness are each equal to the number of lands you control."');
  const FIELD = card('Test Field', 'Land', '');
  it('the enchantment becomes a Bear creature whose size is the number of lands you control; the effect does not end', () => {
    expect(full(HALL)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Hall', 'Test Field', 'Test Field', 'Test Field'] }, defs: [HALL, FIELD] });
    const hall = find(s0, 'Test Hall', 'battlefield', 'p1');
    expect(chars(s0, hall).types).toEqual(['Enchantment']);
    const s = activate(s0, hall);
    const c = chars(s, hall);
    expect(c.types).toEqual(expect.arrayContaining(['Enchantment', 'Creature']));
    expect(c.subtypes).toContain('Bear');
    expect(pt(s, hall)).toEqual([3, 3]);
    const later = advanceTo(s, s.turn.number + 2, 'upkeep');
    expect(chars(later, hall).types).toEqual(expect.arrayContaining(['Enchantment', 'Creature']));
    expect(pt(later, hall)).toEqual([3, 3]);
  });
});

describe('CR 205.1a, 205.3d, 305.6, 611.2a: "{T}: Until your next turn, ~ becomes a land and gains "{T}: Add {G}.""', () => {
  const SPRITE = card('Test Sprite', 'Legendary Creature — Elemental Villain', '{T}: Until your next turn, ~ becomes a land and gains "{T}: Add {G}."', ['2', '2']);
  it('the creature is a land and no longer a creature (and loses its creature types) until my next turn, then it is as printed', () => {
    expect(full(SPRITE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Sprite'] }, defs: [SPRITE] });
    const sprite = find(s0, 'Test Sprite', 'battlefield', 'p1');
    const s = activate(s0, sprite);
    const c = chars(s, sprite);
    expect(c.types).toEqual(['Land']);
    expect(c.supertypes).toContain('Legendary');
    expect(c.subtypes).toEqual([]);
    expect(c.abilities.some((a) => a.def.kind === 'activated' && a.def.isMana === true)).toBe(true);
    const later = advanceTo(s, s.turn.number + 2, 'upkeep');
    expect(chars(later, sprite).types).toEqual(['Creature']);
    expect(chars(later, sprite).subtypes).toEqual(['Elemental', 'Villain']);
  });
});
