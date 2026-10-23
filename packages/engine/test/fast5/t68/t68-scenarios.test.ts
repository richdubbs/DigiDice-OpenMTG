/**
 * FAST5 T68 (static grants, conditional statics and characteristic-defining power and toughness): the shapes of parser/templates/zz-fast5/t68.json and the
 * engine and parser additions they need, played through applyAction with synthetic cards compiled by the game's default compiler (wordings are invented,
 * design 6.10; names and numbers of real cards are not used).
 *
 *   CR 205.1a, 613.1d, 301.7, 122.1      "As long as ~ has three or more fire counters on it, it's an artifact creature" (a Vehicle crewed by its own counters)
 *   CR 305.7, 613.1d                     "As long as ~ has a siege counter on ~, nonbasic lands are Mountains": the land loses its other land types and abilities
 *   CR 105.1, 613.4c                     "~ gets +1/+0 for each color among Allies you control"
 *   CR 303.4b, 613.4b, 613.1f, 109.4     "Other creatures you control that are enchanted by Auras you control have base power and toughness 4/4 and have flying"
 *   CR 500.1, 611.3a, 613.1f             "During your turn, ~ and enchantment creatures you control have ...", "~ and other Knights you control have ..."
 *   CR 701.21a, 513.1                    "During your end step, Warrior tokens you control have 'This token can't be sacrificed.'"
 *   CR 508.1b, 508.1c, 506.2             "Each creature that's enchanted by an Aura you control can't attack you or planeswalkers you control"
 *   CR 715.1, 406.1, 108.3               "~ has haste as long as you own a card in exile that has an Adventure"
 *   CR 606.3, 606.4, 605.1a              "Planeswalkers you control have '[+1]: Add {R}.'" and the other bracketed loyalty abilities a permanent grants
 *   CR 201.2, 602.2b                     "{2}, Sacrifice this artifact: It deals damage to any target equal to 1 plus the number of permanents named ... you control"
 *   CR 604.3, 406.1                      "~'s power is equal to the number of cards you own in exile and its toughness is equal to that number plus 1"
 */
import { describe, expect, it } from 'vitest';
import { applyAction, charsOfObject, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, pass, put, scenario } from '../../m3/scenario';
import { attackUnblocked, toDeclareAttackers, tweak } from '../../m4/helpers';
import { costUseDenial } from '../../../src/rules/cant';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"')).map((a) => a.text);
const pt = (s: GameState, id: ObjectId): string => { const c = charsOfObject(s, s.objects[id]!); return `${c.power}/${c.toughness}`; };
const chars = (s: GameState, id: ObjectId) => charsOfObject(s, s.objects[id]!);
const has = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const loyalty = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['loyalty'] ?? 0;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });

/** Answer the decisions that come up: costs automatically, targets from the queue; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const queue = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
    else if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty. */
function resolveAll(s0: GameState, targets: TargetChoice[][] = []): GameState {
  let s = settle(s0, targets);
  for (let guard = 0; guard < 40; guard++) {
    if (s.zones.stack.length === 0 && s.pending?.kind === 'priority') return s;
    s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
  }
  throw new Error(`the stack did not empty: ${JSON.stringify(s.pending)}`);
}
/** The key of the first ability of an object (granted or printed) whose rendered text contains `part`. */
const abilityKey = (s: GameState, id: ObjectId, part: string): string => {
  const a = chars(s, id).abilities.find((x) => x.def.text.includes(part));
  if (!a) throw new Error(`no ability with "${part}": ${chars(s, id).abilities.map((x) => x.def.text).join(' | ')}`);
  return a.key;
};
const BEAR = 'Grizzly Bears';
const fixtureAura = (s: GameState, name: string, owner: 'p1' | 'p2', host: ObjectId): ObjectId => {
  const id = put(s, owner, 'battlefield', name);
  s.objects[id]!.attachedTo = host;
  return id;
};

describe('CR 205.1a, 613.1d, 301.7, 122.1: "As long as ~ has three or more fire counters on it, it\'s an artifact creature."', () => {
  const BALLOON = card('Test Balloon', 'Artifact — Vehicle', 'Flying\n{1}: Put a fire counter on ~.\nAs long as ~ has three or more fire counters on it, it\'s an artifact creature.\nCrew 3', '{3}', ['4', '4']);
  it('is automated; with two counters the Vehicle is no creature, with three it is an artifact creature (its printed 4/4 and subtype stay)', () => {
    expect(manualParts(BALLOON)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Balloon', counters: { fire: 2 } }] }, defs: [BALLOON] });
    const id = find(s0, 'Test Balloon', 'battlefield', 'p1');
    expect(chars(s0, id).types).toEqual(['Artifact']);
    const s = tweak(s0, (t) => { t.objects[id]!.counters['fire'] = 3; });
    expect(chars(s, id).types.slice().sort()).toEqual(['Artifact', 'Creature']);
    expect(chars(s, id).subtypes).toContain('Vehicle');
    expect(pt(s, id)).toBe('4/4');
  });
  it('the counter is put by its own activated ability ({1}): the third one turns it into a creature', () => {
    const s0 = scenario([], { p1: { battlefield: ['Plains', { name: 'Test Balloon', counters: { fire: 2 } }] }, defs: [BALLOON] });
    const id = find(s0, 'Test Balloon', 'battlefield', 'p1');
    expect(chars(s0, id).types).toEqual(['Artifact']);
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:1' })));
    expect(s.objects[id]!.counters['fire']).toBe(3);
    expect(chars(s, id).types).toContain('Creature');
  });
});

describe('CR 305.7, 613.1d: "As long as ~ has a siege counter on ~, nonbasic lands are Mountains."', () => {
  const ZHAO = card('Test Conqueror', 'Legendary Creature — Human Soldier', 'As long as ~ has a siege counter on ~, nonbasic lands are Mountains.', '{1}{R}', ['2', '2']);
  it('is automated; without the counter nothing changes, with it a nonbasic land is only a Mountain with the Mountain mana ability (CR 305.7) and basic lands are untouched', () => {
    expect(manualParts(ZHAO)).toEqual([]);
    const base = scenario(['Taiga', 'Mutavault', 'Watery Grave'], { p1: { battlefield: ['Test Conqueror', 'Taiga', 'Mutavault', 'Plains'] }, p2: { battlefield: ['Watery Grave'] }, defs: [ZHAO], });
    const [taiga, vault, plains] = [find(base, 'Taiga', 'battlefield', 'p1'), find(base, 'Mutavault', 'battlefield', 'p1'), find(base, 'Plains', 'battlefield', 'p1')];
    const grave = find(base, 'Watery Grave', 'battlefield', 'p2');
    expect(chars(base, taiga).subtypes.slice().sort()).toEqual(['Forest', 'Mountain']);
    const keys = (s: GameState, id: ObjectId): string[] => chars(s, id).abilities.map((a) => a.def.text);
    const vaultBefore = keys(base, vault).length;
    expect(vaultBefore).toBeGreaterThan(1);
    const s = tweak(base, (t) => { t.objects[find(t, 'Test Conqueror', 'battlefield', 'p1')]!.counters['siege'] = 1; });
    for (const id of [taiga, vault, grave]) {
      expect(chars(s, id).subtypes, s.defs[s.objects[id]!.defId]!.name).toEqual(['Mountain']);
      expect(chars(s, id).types).toContain('Land');
    }
    // Mutavault loses its own abilities (animation); what is left is the Mountain's intrinsic mana ability
    expect(keys(s, vault).some((t) => /becomes a 2\/2/i.test(t))).toBe(false);
    expect(chars(s, plains).subtypes).toEqual(['Plains']);
  });
});

describe('CR 105.1, 613.4c: "~ gets +1/+0 for each color among Allies you control."', () => {
  const ALLY = card('Test Rallier', 'Creature — Human Ally', '~ gets +1/+0 for each color among Allies you control.', '{1}', ['1', '1']);
  const WHITE = card('Test White Ally', 'Creature — Kor Ally', '', '{W}', ['1', '1'], ['W']);
  const GOLD = card('Test Gold Ally', 'Creature — Kor Ally', '', '{B}{R}', ['1', '1'], ['B', 'R']);
  const RED_ALLY = card('Test Red Ally', 'Creature — Kor Ally', '', '{R}', ['1', '1'], ['R']);
  it('is automated; it counts each different color once among the Allies its controller controls (itself colorless, a second white Ally adds nothing, a non-Ally and an opponent\'s Ally are not counted)', () => {
    expect(manualParts(ALLY)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { battlefield: ['Test Rallier'] }, p2: { battlefield: ['Test Red Ally'] }, defs: [ALLY, WHITE, GOLD, RED_ALLY] });
    const me = find(s0, 'Test Rallier', 'battlefield', 'p1');
    expect(pt(s0, me)).toBe('1/1');
    let s = tweak(s0, (t) => { put(t, 'p1', 'battlefield', 'Test White Ally'); put(t, 'p1', 'battlefield', BEAR); });
    expect(pt(s, me)).toBe('2/1');
    s = tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test White Ally'); });
    expect(pt(s, me)).toBe('2/1');
    s = tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test Gold Ally'); });
    expect(pt(s, me)).toBe('4/1');
  });
});

describe('CR 303.4b, 613.4b, 613.1f, 109.4: "Other creatures you control that are enchanted by Auras you control have base power and toughness 4/4 and have flying."', () => {
  const ARCHON = card('Test Archon', 'Creature — Archon', 'Flying\nOther creatures you control that are enchanted by Auras you control have base power and toughness 4/4 and have flying.', '{2}{W}{W}', ['3', '3']);
  it('is automated; a creature of its controller enchanted by that player\'s Aura is a flying 4/4 (counters still add), not one enchanted only by an opponent\'s Aura, nor an opponent\'s creature, nor the Archon itself', () => {
    expect(manualParts(ARCHON)).toEqual([]);
    const s0 = scenario([BEAR, 'Pacifism', 'Flight'], { p1: { battlefield: ['Test Archon', BEAR, BEAR, BEAR] }, p2: { battlefield: [BEAR] }, defs: [ARCHON] });
    const [mine, theirAura, plain] = findAll(s0, BEAR, 'battlefield', 'p1') as [ObjectId, ObjectId, ObjectId];
    const foe = find(s0, BEAR, 'battlefield', 'p2');
    const archon = find(s0, 'Test Archon', 'battlefield', 'p1');
    expect(pt(s0, mine)).toBe('2/2');
    const s = tweak(s0, (t) => {
      fixtureAura(t, 'Pacifism', 'p1', mine); // my Aura on my creature
      fixtureAura(t, 'Flight', 'p2', theirAura); // an opponent's Aura on my creature
      fixtureAura(t, 'Pacifism', 'p1', foe); // my Aura on an opponent's creature
      fixtureAura(t, 'Pacifism', 'p1', archon); // my Aura on the Archon (it says "other")
      t.objects[mine]!.counters['+1/+1'] = 1;
    });
    expect(pt(s, mine)).toBe('5/5');
    expect(has(s, mine, 'flying')).toBe(true);
    expect(pt(s, theirAura)).toBe('2/2');
    expect(has(s, theirAura, 'flying')).toBe(true); // Flight itself grants flying
    expect(pt(s, plain)).toBe('2/2');
    expect(has(s, plain, 'flying')).toBe(false);
    expect(pt(s, foe)).toBe('2/2');
    expect(has(s, foe, 'flying')).toBe(false);
    expect(pt(s, archon)).toBe('3/3');
  });
});

describe('CR 500.1, 611.3a, 613.1f: "During your turn, ~ and enchantment creatures you control have trample, lifelink, and ward {2}." / "~ and other Knights you control have flying."', () => {
  const YUNA = card('Test Cleric', 'Legendary Creature — Human Cleric', 'During your turn, ~ and enchantment creatures you control have trample, lifelink, and ward {2}.', '{3}{G}{W}', ['3', '5']);
  const SPIRIT = card('Test Spirit', 'Enchantment Creature — Spirit', '', '{1}', ['1', '1']);
  const DION = card('Test Paladin', 'Legendary Creature — Human Knight', 'During your turn, ~ and other Knights you control have flying.', '{2}{W}', ['3', '3']);
  const KNIGHT = card('Test Knight', 'Creature — Human Knight', '', '{1}{W}', ['2', '2']);
  it('is automated; on its controller\'s turn the source and each enchantment creature have the keywords, a plain creature and an opponent\'s enchantment creature do not, and on the opponent\'s turn nobody does', () => {
    expect(manualParts(YUNA)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { battlefield: ['Test Cleric', 'Test Spirit', BEAR] }, p2: { battlefield: ['Test Spirit'] }, defs: [YUNA, SPIRIT] });
    const yuna = find(s0, 'Test Cleric', 'battlefield', 'p1');
    const mySpirit = find(s0, 'Test Spirit', 'battlefield', 'p1');
    const theirSpirit = find(s0, 'Test Spirit', 'battlefield', 'p2');
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    for (const kw of ['trample', 'lifelink', 'ward']) {
      expect(has(s0, yuna, kw), kw).toBe(true);
      expect(has(s0, mySpirit, kw), kw).toBe(true);
      expect(has(s0, theirSpirit, kw), kw).toBe(false);
      expect(has(s0, bears, kw), kw).toBe(false);
    }
    const night = advanceTo(s0, 2, 'main1');
    for (const id of [yuna, mySpirit, theirSpirit, bears]) expect(has(night, id, 'lifelink')).toBe(false);
  });
  it('"~ and other Knights you control": the source itself (a Knight too) and every other Knight of its controller, on its controller\'s turn only', () => {
    expect(manualParts(DION)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { battlefield: ['Test Paladin', 'Test Knight', BEAR] }, p2: { battlefield: ['Test Knight'] }, defs: [DION, KNIGHT] });
    const dion = find(s0, 'Test Paladin', 'battlefield', 'p1');
    const mine = find(s0, 'Test Knight', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Knight', 'battlefield', 'p2');
    expect([has(s0, dion, 'flying'), has(s0, mine, 'flying'), has(s0, theirs, 'flying'), has(s0, find(s0, BEAR, 'battlefield', 'p1'), 'flying')]).toEqual([true, true, false, false]);
    const night = advanceTo(s0, 2, 'main1');
    expect([has(night, dion, 'flying'), has(night, mine, 'flying')]).toEqual([false, false]);
  });
});

describe("CR 701.21a, 513.1: during your end step, Warrior tokens you control cannot be sacrificed (a granted \"This token can't be sacrificed.\")", () => {
  const ZURGO = card('Test Chieftain', 'Legendary Creature — Orc Warrior', "During your end step, Warrior tokens you control have \"This token can't be sacrificed.\"", '{R}{W}{B}', ['2', '4']);
  const WARRIOR = card('Test Warrior', 'Creature — Orc Warrior', '', '{0}', ['1', '1']);
  it("is automated; a Warrior token of its controller cannot be sacrificed in that player's end step (CR 614.17b: not as a cost either), but can at any other time; a Warrior card and the opponent's tokens always can", () => {
    expect(manualParts(ZURGO)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Chieftain', 'Test Warrior', 'Test Warrior'] }, p2: { battlefield: ['Test Warrior'] }, defs: [ZURGO, WARRIOR] });
    const [token, hand] = findAll(s0, 'Test Warrior', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const theirs = find(s0, 'Test Warrior', 'battlefield', 'p2');
    const s1 = tweak(s0, (t) => { t.objects[token]!.kind = 'token'; t.objects[theirs]!.kind = 'token'; });
    const denied = (s: GameState, id: ObjectId): boolean => costUseDenial(s, 'p1', id, 'sacrifice') !== null;
    expect([denied(s1, token), denied(s1, hand), denied(s1, theirs)]).toEqual([false, false, false]); // main phase: nothing is denied
    const end = advanceTo(s1, 1, 'end');
    expect(end.turn.step).toBe('end');
    expect([denied(end, token), denied(end, hand), denied(end, theirs)]).toEqual([true, false, false]);
    const theirEnd = advanceTo(end, 2, 'end'); // the opponent's end step is not "your end step"
    expect(denied(theirEnd, token)).toBe(false);
  });
});

describe('CR 508.1b, 508.1c, 506.2: "Each creature that\'s enchanted by an Aura you control can\'t attack you or planeswalkers you control."', () => {
  const ERIETTE = card('Test Warlock', 'Legendary Creature — Human Warlock', 'Each creature that\'s enchanted by an Aura you control can\'t attack you or planeswalkers you control.', '{1}{W}{B}', ['2', '4']);
  it('is automated; a creature enchanted by its controller\'s Aura (even an opponent\'s creature) cannot attack that player or their planeswalker, an unenchanted creature can', () => {
    expect(manualParts(ERIETTE)).toEqual([]);
    const s0 = scenario([BEAR, 'Pacifism', 'Flight', 'Jace Beleren'], { p1: { battlefield: ['Test Warlock', { name: 'Jace Beleren', counters: { loyalty: 3 } }] }, p2: { battlefield: [BEAR, BEAR] }, defs: [ERIETTE] });
    const [a, b] = findAll(s0, BEAR, 'battlefield', 'p2') as [ObjectId, ObjectId];
    const jace = find(s0, 'Jace Beleren', 'battlefield', 'p1');
    const s1 = tweak(s0, (t) => { fixtureAura(t, 'Flight', 'p1', a); });
    // p2's turn: the declare attackers decision
    const t2 = toDeclareAttackers(advanceTo(s1, 2, 'main1'));
    const attackFrom = (st: GameState, target: string, who: ObjectId) => applyAction(st, { type: 'answer', player: 'p2', decisionId: st.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: who, defender: target }] } });
    const attack = (target: string, who: ObjectId) => attackFrom(t2, target, who);
    expect(attack('p1', a).error, 'enchanted by my Aura: cannot attack me').toBeDefined();
    expect(attack(jace, a).error, 'enchanted by my Aura: cannot attack my planeswalker').toBeDefined();
    expect(attack('p1', b).error?.message, 'unenchanted: can attack me').toBeUndefined();
    expect(attack(jace, b).error, 'unenchanted: can attack my planeswalker').toBeUndefined();
    // an Aura of the OPPONENT's own does not stop its creature
    const s2 = tweak(s0, (t) => { fixtureAura(t, 'Flight', 'p2', a); });
    const t3 = toDeclareAttackers(advanceTo(s2, 2, 'main1'));
    expect(attackFrom(t3, 'p1', a).error?.message).toBeUndefined();
  });
});

describe('CR 715.1, 406.1, 108.3: "~ has haste as long as you own a card in exile that has an Adventure."', () => {
  const FANG = card('Test Fang', 'Creature — Wolf', '~ has haste as long as you own a card in exile that has an Adventure.', '{2}{G}', ['3', '3']);
  it('is automated; it has haste while its controller owns an adventurer card in exile (not a card they control that someone else owns, not an ordinary exiled card)', () => {
    expect(manualParts(FANG)).toEqual([]);
    const base = scenario([BEAR, 'Bonecrusher Giant // Stomp'], { p1: { battlefield: ['Test Fang'] }, defs: [FANG] });
    const fang = find(base, 'Test Fang', 'battlefield', 'p1');
    expect(has(base, fang, 'haste')).toBe(false);
    const ordinary = tweak(base, (t) => { put(t, 'p1', 'exile', BEAR); });
    expect(has(ordinary, fang, 'haste')).toBe(false);
    const theirs = tweak(base, (t) => { put(t, 'p2', 'exile', 'Bonecrusher Giant // Stomp'); });
    expect(has(theirs, fang, 'haste')).toBe(false);
    const mine = tweak(base, (t) => { put(t, 'p1', 'exile', 'Bonecrusher Giant // Stomp'); });
    expect(has(mine, fang, 'haste')).toBe(true);
  });
});

describe('FAST5 T68: a list of eighteen creature types, "Other Spiders, Boars, ... and Wolves you control get +1/+1."', () => {
  const LIST = 'Spiders, Boars, Bats, Bears, Birds, Cats, Dogs, Frogs, Jackals, Lizards, Mice, Otters, Rabbits, Raccoons, Rats, Squirrels, Turtles, and Wolves';
  const HAM = card('Test Hero Pig', 'Legendary Creature — Spider Boar Hero', `Other ${LIST} you control get +1/+1.`, '{1}{G}', ['2', '2']);
  it('is automated; each of the eighteen types gets +1/+1, the source itself and other creature types do not, and an opponent\'s creature does not', () => {
    expect(manualParts(HAM)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { battlefield: ['Test Hero Pig', BEAR, 'Test Elf'] }, p2: { battlefield: [BEAR] }, defs: [HAM, card('Test Elf', 'Creature — Elf', '', '{G}', ['1', '1'])] });
    expect(pt(s0, find(s0, 'Test Hero Pig', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s0, find(s0, BEAR, 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s0, find(s0, 'Test Elf', 'battlefield', 'p1'))).toBe('1/1');
    expect(pt(s0, find(s0, BEAR, 'battlefield', 'p2'))).toBe('2/2');
  });
});

describe('CR 604.3, 406.1: "~\'s power is equal to the number of cards you own in exile and its toughness is equal to that number plus 1."', () => {
  const GOYF = card('Test Goyf', 'Creature — Elemental Lhurgoyf', '~\'s power is equal to the number of cards you own in exile and its toughness is equal to that number plus 1.', '{1}{G}', ['*', '1+*']);
  it('is automated; it counts the cards its controller owns in exile (an opponent\'s exiled card is not counted)', () => {
    expect(manualParts(GOYF)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { battlefield: ['Test Goyf'] }, defs: [GOYF] });
    const goyf = find(s0, 'Test Goyf', 'battlefield', 'p1');
    expect(pt(s0, goyf)).toBe('0/1');
    const s = tweak(s0, (t) => { put(t, 'p1', 'exile', BEAR); put(t, 'p1', 'exile', BEAR); put(t, 'p2', 'exile', BEAR); });
    expect(pt(s, goyf)).toBe('2/3');
  });
});

describe('CR 606.3, 606.4, 605.1a: a permanent that gives planeswalkers a bracketed loyalty ability', () => {
  const PYRO = card('Test Pyre Way', 'Legendary Enchantment', 'Planeswalkers you control have "[+1]: Add {R}."', '{1}{R}');
  const WARLORD = card('Test War Way', 'Legendary Enchantment', 'Planeswalkers you control have "[-4]: This planeswalker deals 2 damage to up to one target creature or planeswalker and 2 damage to target player."', '{2}{R}');
  const LEVIATHAN = card('Test Sea Way', 'Enchantment', 'Planeswalkers you control have "[-8]: Create an 8/8 blue Leviathan creature token with hexproof."', '{2}{U}');
  it('is automated; the granted ability is a loyalty ability (not a mana ability, CR 605.1a): activating it adds {R} to the pool on resolution and loyalty +1, only once per turn per planeswalker', () => {
    expect(manualParts(PYRO)).toEqual([]);
    const s0 = scenario(['Jace Beleren'], { p1: { battlefield: ['Test Pyre Way', { name: 'Jace Beleren', counters: { loyalty: 3 } }] }, defs: [PYRO] });
    const jace = find(s0, 'Jace Beleren', 'battlefield', 'p1');
    const granted = chars(s0, jace).abilities.find((a) => a.origin === 'granted')!;
    expect(granted).toBeDefined();
    expect(granted.def.kind).toBe('activated');
    expect((granted.def as { isMana?: boolean }).isMana).toBeUndefined();
    expect((granted.def as { isLoyalty?: boolean }).isLoyalty).toBe(true);
    const before = loyalty(s0, jace);
    let s = act(s0, { type: 'activate', player: 'p1', source: jace, ability: granted.key });
    expect(s.zones.stack.length).toBe(1); // a loyalty ability uses the stack
    s = resolveAll(settle(s));
    expect(loyalty(s, jace)).toBe(before + 1);
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.map((u) => u.type)).toEqual(['R']);
    // CR 606.3: no second loyalty ability this turn
    const again = applyAction(s, { type: 'activate', player: 'p1', source: jace, ability: granted.key });
    expect(again.error).toBeDefined();
  });
  it('"[-4]: This planeswalker deals 2 damage to up to one target creature or planeswalker and 2 damage to target player": cost -4 loyalty, both damages dealt', () => {
    expect(manualParts(WARLORD)).toEqual([]);
    const s0 = scenario([BEAR, 'Jace Beleren'], { p1: { battlefield: ['Test War Way', { name: 'Jace Beleren', counters: { loyalty: 5 } }] }, p2: { battlefield: [BEAR] }, defs: [WARLORD] });
    const jace = find(s0, 'Jace Beleren', 'battlefield', 'p1');
    const bear = find(s0, BEAR, 'battlefield', 'p2');
    const key = abilityKey(s0, jace, 'deals 2 damage');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: jace, ability: key }), [[obj(bear)], [player('p2')]]));
    expect(loyalty(s, jace)).toBe(1);
    expect(s.zones.battlefield.includes(bear)).toBe(false);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('"[-8]: Create an 8/8 blue Leviathan creature token with hexproof": needs eight loyalty counters; the token is created', () => {
    expect(manualParts(LEVIATHAN)).toEqual([]);
    const s0 = scenario(['Jace Beleren'], { p1: { battlefield: ['Test Sea Way', { name: 'Jace Beleren', counters: { loyalty: 8 } }] }, defs: [LEVIATHAN] });
    const jace = find(s0, 'Jace Beleren', 'battlefield', 'p1');
    const key = abilityKey(s0, jace, 'Leviathan');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: jace, ability: key })));
    expect(s.zones.battlefield.includes(jace)).toBe(false); // 0 loyalty: state-based action (CR 704.5i)
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    expect(pt(s, token)).toBe('8/8');
    expect(has(s, token, 'hexproof')).toBe(true);
  });
});

describe('CR 201.2, 602.2b, 118.1: "Artifacts you control have \\"{2}, Sacrifice this artifact: It deals damage to any target equal to 1 plus the number of permanents named ... you control.\\""', () => {
  const FIGHT = card('Test Feast Brawl', 'Enchantment', 'Artifacts you control have "{2}, Sacrifice this artifact: It deals damage to any target equal to 1 plus the number of permanents named Test Feast Brawl you control."', '{1}{R}');
  const GADGET = card('Test Gadget', 'Artifact', '', '{0}');
  it('is automated; sacrificing a granted artifact deals 1 plus the number of permanents with that name its controller controls (two copies: 3 damage)', () => {
    expect(manualParts(FIGHT)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Feast Brawl', 'Test Feast Brawl', 'Test Gadget', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Feast Brawl'] }, defs: [FIGHT, GADGET] });
    const gadget = find(s0, 'Test Gadget', 'battlefield', 'p1');
    const key = abilityKey(s0, gadget, 'Sacrifice');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: gadget, ability: key }), [[player('p2')]]));
    expect(s.zones.battlefield.includes(gadget)).toBe(false);
    expect(lifeOf(s, 'p2')).toBe(17); // 1 + two permanents named Test Feast Brawl that p1 controls (the opponent's does not count)
  });
});

describe('CR 510.2, 400.7, 611.3a: "~ has hexproof as long as they haven\'t dealt combat damage yet."', () => {
  const RURIC = card('Test Magecrusher', 'Legendary Creature — Ogre Warrior', '~ has hexproof as long as they haven\'t dealt combat damage yet.', '{0}', ['4', '4']);
  const RECALL = card('Test Recall', 'Instant', 'Return target creature to its owner\'s hand.', '{0}');
  it('is automated; it has hexproof until it deals combat damage, then never again as that permanent, and a new object after leaving the battlefield has it again (CR 400.7)', () => {
    expect(manualParts(RURIC)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Magecrusher'], hand: ['Test Recall'] }, defs: [RURIC, RECALL] });
    const id = find(s0, 'Test Magecrusher', 'battlefield', 'p1');
    expect(has(s0, id, 'hexproof')).toBe(true);
    // it attacks and deals combat damage to the opponent: hexproof ends
    let s = attackUnblocked(s0, [id]);
    expect(lifeOf(s, 'p2')).toBe(16);
    expect(has(s, id, 'hexproof')).toBe(false);
    // it stays gone in later turns
    s = advanceTo(s, 3, 'main1');
    expect(has(s, id, 'hexproof')).toBe(false);
    // returned to its owner's hand and cast again, it is a new object that has dealt no combat damage
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Recall', 'hand', 'p1') }), [[obj(id)]]));
    expect(s.zones.battlefield.includes(id)).toBe(false);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Magecrusher', 'hand', 'p1') })));
    const again = find(s, 'Test Magecrusher', 'battlefield', 'p1');
    expect(again).not.toBe(id);
    expect(has(s, again, 'hexproof')).toBe(true);
  });
});
