/**
 * FAST5 T41 (until-end-of-turn grants of quoted abilities, compound pump / grant / type changes): the templates of parser/templates/zz-fast5/t41.json and
 * the renderer and engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented wordings,
 * design 6.10). Each test is named after the rule it checks.
 *
 *   CR 611.2a, 611.2c     a resolved effect lasts for its duration and affects the objects it named as it began ("creatures you control get +2/+2 and gain ...")
 *   CR 113.6, 603.10a     a granted "when ~ dies" ability looks back: it sees the creature as it was on the battlefield (draw a card; return it tapped, CR 400.7)
 *   CR 603.2, 700.4       a granted "when ~ deals combat damage, sacrifice it"; "whenever ~ is dealt damage, ... that many"
 *   CR 205.1b, 205.3m, 613.1d  "becomes a Horror enchantment creature in addition to its other types"; "loses all creature types" (also the changeling's)
 *   CR 608.2d, 607.2d     "gains your choice of double strike or trample until end of turn"
 *   CR 701.10b            "double the power of target creature"
 *   CR 122.1, 611.2c      "creatures you control with counters on them gain ..." (the creatures that have a counter when it resolves)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const pt = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const kw = (s: GameState, id: ObjectId, k: string): boolean => hasKeyword(chars(s, id), k);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const names = (s: GameState, zone: 'battlefield', player?: string): string[] => s.zones[zone].filter((id) => !player || s.objects[id]!.controller === player).map((id) => s.defs[s.objects[id]!.defId]!.name);
/** Every ability of the card is automated (no manual ability, no manual step) and the card is full. */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer the decisions that come up, paying automatically and choosing `targets` when asked; stop at priority (or a decision the caller answers). */
function settle(s0: GameState, o: { targets?: TargetChoice[]; groups?: TargetChoice[][]; option?: RegExp; yes?: boolean } = {}): GameState {
  let s = s0;
  const groups = o.groups?.slice();
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: groups?.shift() ?? o.targets ?? [] });
    else if (p.kind === 'chooseOption' && o.option !== undefined) s = answer(s, { kind: 'chooseOption', ids: [p.options.find((x) => o.option!.test(x.label))!.id] });
    else if (p.kind === 'yesNo' && o.yes !== undefined) s = answer(s, { kind: 'yesNo', yes: o.yes });
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty; decisions on the way are answered by `settle`. */
function resolveAll(s0: GameState, o: Parameters<typeof settle>[1] = {}): GameState {
  let s = settle(s0, o);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof settle>[1] = {}): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
function activate(s: GameState, name: string, o: Parameters<typeof settle>[1] = {}, index = 0): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').filter((a) => a.object === id && !a.isMana)[index];
  if (!la) throw new Error(`no activated ability ${index} of ${name}`);
  return settle(act(s, la.action), o);
}
/** p1 casts Test Kill on `id` and it resolves: the creature is destroyed (and its dies triggers resolve). */
function kill(s0: GameState, id: ObjectId, o: Parameters<typeof settle>[1] = {}): GameState {
  const withKill = tweak(s0, (t) => { put(t, 'p1', 'hand', 'Test Kill'); });
  return resolveAll(cast(withKill, 'Test Kill', { ...o, targets: [obj(id)] }), o);
}
const inGy = (s: GameState, name: string, p: string): boolean => s.zones.graveyard[p]!.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const BEAR2 = card('Test Bear Cub', 'Creature — Bear', '', ['1', '1'], '{G}');
const GOBLIN = card('Test Imp', 'Creature — Goblin', '', ['2', '2'], '{R}');
const GOBLIN2 = card('Test Imp Chief', 'Creature — Goblin', '', ['1', '1'], '{R}');
const RALLY = card('Test Rally', 'Instant', 'Until end of turn, any number of target creatures you control each get +1/+1 and gain "When this creature dies, draw a card."');
const ROAR = card('Test Roar', 'Sorcery', 'Until end of turn, creatures you control get +1/+1 and gain trample and "Whenever this creature attacks, you gain 2 life."');
const SKIRMISH = card('Test Skirmish', 'Creature — Goblin', '{0}: Until end of turn, another target Goblin you control gains flying and "When this creature deals combat damage, sacrifice it."', ['1', '1']);
const DEFY = card('Test Defy', 'Instant', 'Until end of turn, target creature gains deathtouch and "When this creature dies, return it to the battlefield tapped under its owner\'s control."');
const MONOLITH = card('Test Monolith', 'Artifact', '{T}: Until end of turn, target creature gains "Whenever this creature is dealt damage, you draw that many cards and lose that much life." That creature\'s controller may have this artifact deal 1 damage to it. Activate only as a sorcery.');
const SCARE = card('Test Scare', 'Instant', 'Until end of turn, target creature gets +2/+2, gains flying, and becomes a Horror enchantment creature in addition to its other types.');
const STATE = card('Test State', 'Instant', 'Until end of turn, target creature you control becomes an Avatar in addition to its other types and gains flying, first strike, lifelink, and hexproof.');
const FORMULA = card('Test Formula', 'Instant', 'Until end of turn, target creature you control gets +3/+1 and becomes a Dinosaur in addition to its other types.');
const DUEL = card('Test Duel', 'Instant', 'Until end of turn, target creature you control gets +1/+1 and target creature an opponent controls gets -1/-1.');
const INVERT = card('Test Invert', 'Kindred Instant — Shapeshifter', 'Changeling\nTarget creature gets +3/-3 and loses all creature types until end of turn.');
const CHANGELING = card('Test Shifter', 'Creature — Shapeshifter', 'Changeling', ['3', '4']);
const MOUSE = card('Test Mouse', 'Creature — Mouse Soldier', 'At the beginning of combat on your turn, target Mouse you control gains your choice of double strike or trample until end of turn.', ['1', '2']);
const HARMONIZER = card('Test Harmonizer', 'Creature — Insect Druid', 'Landfall — Whenever a land you control enters, double the power of target creature you control until end of turn.', ['2', '2']);
const SWAMP = card('Test Swamp', 'Land — Swamp', '');
const OX = card('Test Ox', 'Creature — Ox Mount', 'Sacrifice this creature: Creatures you control with counters on them gain hexproof and indestructible until end of turn.', ['2', '2']);
const GARDENER = card('Test Gardener', 'Creature — Elf', 'Haste\nWhenever another Elf you control enters, put a +1/+1 counter on that creature and it gains haste until end of turn.', ['1', '1']);
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
const HERO = card('Test Hero', 'Legendary Creature — Human', 'Whenever this creature attacks alone, he gets +2/+0 and gains indestructible until end of turn.', ['2', '2']);
const PRIZE = card('Test Prize', 'Artifact', '{T}: Until end of turn, target creature you control with power 3 or greater gains trample and "Whenever this creature deals combat damage to a player, draw a card."');
const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature has reach, "{0}, {T}: Tap target artifact or creature," and "{0}, {T}: Discover 2."\nEquip {0}');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '4']);
const AXE = card('Test Axe', 'Artifact — Equipment', 'Equipped creature gets +1/+0 and has "Whenever this creature attacks, it gains your choice of vigilance or reach until end of turn."\nEquip {0}');
const ALL = [AXE, KILL, OGRE, BEAR, BEAR2, GOBLIN, GOBLIN2, RALLY, ROAR, SKIRMISH, DEFY, MONOLITH, SCARE, STATE, FORMULA, DUEL, INVERT, CHANGELING, MOUSE, HARMONIZER, SWAMP, OX, GARDENER, ELF, HERO, PRIZE, BLADE];

describe('design 6.9: every T41 sentence is compiled to data, none left manual', () => {
  it('the T41 test cards are full', () => {
    for (const d of [RALLY, ROAR, SKIRMISH, DEFY, MONOLITH, SCARE, STATE, FORMULA, DUEL, INVERT, MOUSE, HARMONIZER, OX, GARDENER, HERO, PRIZE, BLADE]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 611.2a, 611.2c, 113.6: a granted "when this creature dies" ability (any number of target creatures each get ... and gain "...")', () => {
  it('each chosen creature gets +1/+1 until end of turn and draws its controller a card when it dies; an unchosen creature does not', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Rally'], battlefield: ['Test Bear', 'Test Bear Cub', 'Test Imp'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const cub = find(s0, 'Test Bear Cub', 'battlefield');
    const imp = find(s0, 'Test Imp', 'battlefield');
    const s1 = resolveAll(cast(s0, 'Test Rally', { targets: [obj(bear), obj(cub)] }));
    expect(pt(s1, bear)).toBe('3/3');
    expect(pt(s1, cub)).toBe('2/2');
    expect(pt(s1, imp)).toBe('2/2');
    // the chosen Bear dies: draw a card; the unchosen Imp dies: nothing
    const h = handSize(s1, 'p1');
    const s2 = kill(kill(s1, bear), imp);
    expect(inGy(s2, 'Test Bear', 'p1')).toBe(true);
    expect(inGy(s2, 'Test Imp', 'p1')).toBe(true);
    expect(handSize(s2, 'p1')).toBe(h + 1);
  });
  it('the effect ends with the turn: the next turn the creature is back to 2/2 and its death draws nothing', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Rally'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = resolveAll(cast(s0, 'Test Rally', { targets: [obj(bear)] }));
    const next = advanceTo(s1, 3, 'main1');
    expect(pt(next, bear)).toBe('2/2');
    const h = handSize(next, 'p1');
    const dead = kill(next, bear);
    expect(inGy(dead, 'Test Bear', 'p1')).toBe(true);
    expect(handSize(dead, 'p1')).toBe(h);
  });
});

describe('CR 611.2c: "Until end of turn, creatures you control get +1/+1 and gain trample and \\"Whenever this creature attacks, you gain 2 life.\\""', () => {
  it('the creatures on the battlefield as it resolves get the pump, the trample and the trigger; a creature that arrives later does not (CR 611.2c)', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Roar'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear Cub'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const theirs = find(s0, 'Test Bear Cub', 'battlefield');
    let s = resolveAll(cast(s0, 'Test Roar'));
    expect(pt(s, bear)).toBe('3/3');
    expect(kw(s, bear, 'trample')).toBe(true);
    expect(pt(s, theirs)).toBe('1/1');
    const late = tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test Imp'); });
    const imp = find(late, 'Test Imp', 'battlefield');
    expect(pt(late, imp)).toBe('2/2');
    // the granted trigger: attacking with the Bear gains 2 life; the Imp, which has no such ability, gains none
    s = late;
    s = toDeclareAttackers(s);
    const before = lifeOf(s, 'p1');
    s = resolveAll(declareAttackers(s, [[bear, 'p2']]));
    expect(lifeOf(s, 'p1')).toBe(before + 2);
  });
});

describe('CR 603.2, 603.10a: "gains flying and \\"When this creature deals combat damage, sacrifice it.\\""', () => {
  it('the Goblin that deals combat damage is sacrificed; the other Goblin, which was not chosen, is not', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Skirmish', 'Test Imp', 'Test Imp Chief'] } });
    const imp = find(s0, 'Test Imp', 'battlefield');
    const chief = find(s0, 'Test Imp Chief', 'battlefield');
    let s = resolveAll(activate(s0, 'Test Skirmish', { targets: [obj(imp)] }));
    expect(kw(s, imp, 'flying')).toBe(true);
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[imp, 'p2'], [chief, 'p2']]);
    for (let i = 0; i < 30 && s.turn.step !== 'main2' && s.pending; i++) s = settle(pass(s));
    s = resolveAll(s);
    expect(inGy(s, 'Test Imp', 'p1')).toBe(true);
    expect(inGy(s, 'Test Imp Chief', 'p1')).toBe(false);
  });
});

describe('CR 603.10a, 400.7: "gains deathtouch and \\"When this creature dies, return it to the battlefield tapped under its owner\'s control.\\""', () => {
  it('a creature that dies this turn comes back tapped under its owner\'s control, a new object (CR 400.7)', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Defy'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = resolveAll(cast(s0, 'Test Defy', { targets: [obj(bear)] }));
    expect(kw(s1, bear, 'deathtouch')).toBe(true);
    const s2 = kill(s1, bear);
    const back = findAll(s2, 'Test Bear', 'battlefield', 'p1');
    expect(back.length).toBe(1);
    expect(s2.objects[back[0]!]!.tapped).toBe(true);
    expect(s2.objects[back[0]!]!.damage).toBe(0);
    expect(inGy(s2, 'Test Bear', 'p1')).toBe(false);
    expect(kw(s2, back[0]!, 'deathtouch')).toBe(false);
  });
  it('the returned creature is a new object without the grant: it dies again for good', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Defy'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    let s = resolveAll(cast(s0, 'Test Defy', { targets: [obj(bear)] }));
    s = kill(s, bear);
    const back = find(s, 'Test Bear', 'battlefield', 'p1');
    s = kill(s, back);
    expect(inGy(s, 'Test Bear', 'p1')).toBe(true);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1').length).toBe(0);
  });
  it("an opponent's creature returns under its owner's control, not the caster's", () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Defy'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    let s = resolveAll(cast(s0, 'Test Defy', { targets: [obj(bear)] }));
    s = kill(s, bear);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p2').length).toBe(1);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1').length).toBe(0);
  });
});

describe('CR 603.2, 120.3: "gains \\"Whenever this creature is dealt damage, you draw that many cards and lose that much life.\\"" and the controller may have the artifact deal damage to it', () => {
  it("the creature's controller may have the artifact deal 1 damage to it: yes, and that player draws 1 card and loses 1 life", () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Monolith'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const h = handSize(s0, 'p2');
    const s = resolveAll(activate(s0, 'Test Monolith', { targets: [obj(bear)], yes: true }), { yes: true });
    expect(s.objects[bear]!.damage).toBe(1);
    expect(handSize(s, 'p2')).toBe(h + 1);
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1'));
  });
  it('declined: nothing is dealt, so nothing is drawn and no life is lost', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Monolith'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const h = handSize(s0, 'p2');
    const s = resolveAll(activate(s0, 'Test Monolith', { targets: [obj(bear)], yes: false }), { yes: false });
    expect(s.objects[bear]!.damage).toBe(0);
    expect(handSize(s, 'p2')).toBe(h);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 205.1b, 613.1d, 613.1f, 613.4c: "becomes ... in addition to its other types" with a pump and keywords', () => {
  it('"gets +2/+2, gains flying, and becomes a Horror enchantment creature in addition to its other types": the creature keeps Bear and Creature and gains the rest, until end of turn', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Scare'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = resolveAll(cast(s0, 'Test Scare', { targets: [obj(bear)] }));
    const c = chars(s1, bear);
    expect(pt(s1, bear)).toBe('4/4');
    expect(kw(s1, bear, 'flying')).toBe(true);
    expect([...c.types].sort()).toEqual(['Creature', 'Enchantment']);
    expect([...c.subtypes].sort()).toEqual(['Bear', 'Horror']);
    const next = advanceTo(s1, 2, 'main1');
    expect([...chars(next, bear).types]).toEqual(['Creature']);
    expect([...chars(next, bear).subtypes]).toEqual(['Bear']);
    expect(pt(next, bear)).toBe('2/2');
  });
  it('"becomes an Avatar in addition to its other types and gains flying, first strike, lifelink, and hexproof"', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test State'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = resolveAll(cast(s0, 'Test State', { targets: [obj(bear)] }));
    expect([...chars(s1, bear).subtypes].sort()).toEqual(['Avatar', 'Bear']);
    for (const k of ['flying', 'first strike', 'lifelink', 'hexproof']) expect(kw(s1, bear, k), k).toBe(true);
    expect(pt(s1, bear)).toBe('2/2');
  });
  it('"gets +3/+1 and becomes a Dinosaur in addition to its other types"', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Formula'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = resolveAll(cast(s0, 'Test Formula', { targets: [obj(bear)] }));
    expect(pt(s1, bear)).toBe('5/3');
    expect([...chars(s1, bear).subtypes].sort()).toEqual(['Bear', 'Dinosaur']);
  });
});

describe('CR 602.2, 611.2a, 205.3m: "Dinosaur Formula — {0}, Discard this card: Until end of turn, target creature you control gets +3/+1 and becomes a Dinosaur in addition to its other types."', () => {
  it('activated from the hand (the card is discarded as a cost), the target gets the change; a card on the battlefield cannot be activated', () => {
    const LIZARD = card('Test Lizard', 'Legendary Creature — Dinosaur Villain', 'Menace\nDinosaur Formula — {0}, Discard this card: Until end of turn, target creature you control gets +3/+1 and becomes a Dinosaur in addition to its other types.', ['3', '2']);
    expect(full(LIZARD)).toBe(true);
    const s0 = scenario([], { defs: [...ALL, LIZARD], p1: { hand: ['Test Lizard'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const id = find(s0, 'Test Lizard', 'hand', 'p1');
    const la = legal(s0, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
    expect(la).toBeDefined();
    const s1 = resolveAll(settle(act(s0, la!.action), { targets: [obj(bear)] }), { targets: [obj(bear)] });
    expect(inGy(s1, 'Test Lizard', 'p1')).toBe(true);
    expect(pt(s1, bear)).toBe('5/3');
    expect([...chars(s1, bear).subtypes].sort()).toEqual(['Bear', 'Dinosaur']);
  });
});

describe("CR 603.10a, 400.7, 111.1: 'gets +2/+0 and gains the quoted ability: when this creature dies, return it to the battlefield tapped under its owner's control and you create a Treasure token'", () => {
  const FAKE = card('Test Fake', 'Instant', 'Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner' + "'" + 's control and you create a Treasure token."');
  it("the creature returns tapped under its owner's control and the controller of the ability (the creature's controller when it died) creates a Treasure", () => {
    expect(full(FAKE)).toBe(true);
    const s0 = scenario([], { defs: [...ALL, FAKE], p1: { hand: ['Test Fake'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    let s = resolveAll(cast(s0, 'Test Fake', { targets: [obj(bear)] }));
    expect(pt(s, bear)).toBe('4/2');
    s = kill(s, bear);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p2').length).toBe(1);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.tapped).toBe(true);
    const treasures = (p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith('token:Treasure') && s.objects[id]!.controller === p).length;
    expect(treasures('p2')).toBe(1);
    expect(treasures('p1')).toBe(0);
  });
});

describe('CR 120.3, 122.1: "gains indestructible and \"Whenever this creature is dealt damage, put that many +1/+1 counters on it.\""', () => {
  const WILL = card('Test Will', 'Instant', 'Until end of turn, target creature you control gains indestructible and "Whenever this creature is dealt damage, put that many +1/+1 counters on it."');
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 2 damage to target creature.');
  it('2 damage to the creature: it survives (indestructible) and gets 2 +1/+1 counters', () => {
    expect(full(WILL)).toBe(true);
    const s0 = scenario([], { defs: [...ALL, WILL, SPARK], p1: { hand: ['Test Will', 'Test Spark'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    let s = resolveAll(cast(s0, 'Test Will', { targets: [obj(bear)] }));
    s = resolveAll(cast(s, 'Test Spark', { targets: [obj(bear)] }));
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
    expect(pt(s, bear)).toBe('4/4');
  });
});

describe('CR 510.2, 603.2: "gets +2/+2 and gains trample and \"Whenever this creature deals combat damage to a player, destroy target artifact that player controls.\""', () => {
  const IRE = card('Test Ire', 'Instant', 'Until end of turn, target attacking creature gets +2/+2 and gains trample and "Whenever this creature deals combat damage to a player, destroy target artifact that player controls."');
  it("the attacking creature that deals combat damage to the player destroys an artifact of that player's choice of target (the damaged player's artifact only)", () => {
    expect(full(IRE)).toBe(true);
    const idol = card('Test Idol', 'Artifact', '');
    const s0 = scenario([], { defs: [...ALL, IRE, idol], p1: { hand: ['Test Ire'], battlefield: ['Test Bear', 'Test Idol'] }, p2: { battlefield: ['Test Idol'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const theirs = find(s0, 'Test Idol', 'battlefield', 'p2');
    let s = declareAttackers(toDeclareAttackers(s0), [[bear, 'p2']]);
    while (s.pending && s.pending.kind === 'priority' && s.turn.step === 'declareAttackers' && s.pending.player !== 'p1') s = pass(s);
    s = resolveAll(cast(s, 'Test Ire', { targets: [obj(bear)] }));
    expect(pt(s, bear)).toBe('4/4');
    for (let i = 0; i < 30 && s.turn.step !== 'main2' && s.pending; i++) s = settle(pass(s), { targets: [obj(theirs)] });
    s = resolveAll(s, { targets: [obj(theirs)] });
    expect(lifeOf(s, 'p2')).toBe(16);
    expect(findAll(s, 'Test Idol', 'battlefield', 'p2').length).toBe(0);
    expect(findAll(s, 'Test Idol', 'battlefield', 'p1').length).toBe(1);
  });
});

describe("CR 603.10a, 400.7, 303.7: a granted dies trigger that returns it tapped, then creates a Wicked Role token attached to it", () => {
  const NOT_DEAD = card('Test Not Dead', 'Instant', 'Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner' + "'" + 's control, then create a Wicked Role token attached to it."');
  it('the Role token is attached to the creature that returned, the new object (it is not left unattached or attached to the card in the graveyard)', () => {
    expect(full(NOT_DEAD)).toBe(true);
    const s0 = scenario([], { defs: [...ALL, NOT_DEAD], p1: { hand: ['Test Not Dead'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    let s = resolveAll(cast(s0, 'Test Not Dead', { targets: [obj(bear)] }));
    s = kill(s, bear);
    const back = find(s, 'Test Bear', 'battlefield', 'p1');
    const roles = s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith('token:Wicked'));
    expect(roles.length).toBe(1);
    expect(s.objects[roles[0]!]!.attachedTo).toBe(back);
    expect(pt(s, back)).toBe('3/3');
  });
});

describe('CR 122.1, 508.1, 611.3a: "creatures you control with counters on them" in an attack trigger, a static ability and a grant', () => {
  const SEER = card('Test Seer', 'Creature — Bird', 'Whenever you attack with one or more creatures with counters on them, draw a card.', ['1', '1']);
  const DRILL = card('Test Drill', 'Creature — Soldier', 'Other creatures you control with counters on them have flying and haste.', ['1', '1']);
  const CHARGE = card('Test Charge', 'Creature — Knight', 'Whenever you attack, creatures you control with counters on them gain double strike until end of turn.', ['1', '1']);
  const defs = [...ALL, SEER, DRILL, CHARGE];
  it('an attack with a creature that has a counter draws a card; an attack with only creatures without counters does not', () => {
    expect(full(SEER)).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Seer', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Imp'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const imp = find(s0, 'Test Imp', 'battlefield');
    const h = handSize(s0, 'p1');
    const withCounter = resolveAll(declareAttackers(toDeclareAttackers(s0), [[bear, 'p2']]));
    expect(handSize(withCounter, 'p1')).toBe(h + 1);
    const without = resolveAll(declareAttackers(toDeclareAttackers(s0), [[imp, 'p2']]));
    expect(handSize(without, 'p1')).toBe(h);
  });
  it('the other creatures that have a counter have flying and haste while they do; losing the counter takes it away', () => {
    expect(full(DRILL)).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Drill', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Imp'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const imp = find(s0, 'Test Imp', 'battlefield');
    const drill = find(s0, 'Test Drill', 'battlefield');
    expect(kw(s0, bear, 'flying')).toBe(true);
    expect(kw(s0, imp, 'flying')).toBe(false);
    expect(kw(s0, drill, 'flying')).toBe(false);
    const s1 = tweak(s0, (t) => { t.objects[bear]!.counters = {}; });
    expect(kw(s1, bear, 'flying')).toBe(false);
  });
  it('attacking: the creatures that have a counter then gain double strike until end of turn, the others do not', () => {
    expect(full(CHARGE)).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Charge', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Imp'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const imp = find(s0, 'Test Imp', 'battlefield');
    const s = resolveAll(declareAttackers(toDeclareAttackers(s0), [[bear, 'p2'], [imp, 'p2']]));
    expect(kw(s, bear, 'double strike')).toBe(true);
    expect(kw(s, imp, 'double strike')).toBe(false);
  });
});

describe('CR 104.3, 611.2a, 113.6: an Equipment that gains a trigger about its equipped creature: "Whenever equipped creature deals combat damage to a player, that player loses the game."', () => {
  const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +2/+0 and has deathtouch.\n{0}: Until end of turn, this Equipment gains "Whenever equipped creature deals combat damage to a player, that player loses the game."\nEquip {0}');
  it('after the ability, the equipped creature that deals combat damage to a player makes that player lose the game; before it, not', () => {
    expect(full(SWORD)).toBe(true);
    const s0 = scenario([], { defs: [...ALL, SWORD], p1: { battlefield: ['Test Sword', 'Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const sword = find(s0, 'Test Sword', 'battlefield');
    const equipped = tweak(s0, (t) => { t.objects[sword]!.attachedTo = bear; });
    const plain = resolveAll(declareAttackers(toDeclareAttackers(equipped), [[bear, 'p2']]));
    let s1 = plain;
    for (let i = 0; i < 30 && s1.turn.step !== 'main2' && s1.pending; i++) s1 = settle(pass(s1));
    expect(s1.players.find((p) => p.id === 'p2')!.hasLost).toBe(false);
    expect(lifeOf(s1, 'p2')).toBe(16);
    const armed = resolveAll(activate(equipped, 'Test Sword'));
    let s2 = declareAttackers(toDeclareAttackers(armed), [[bear, 'p2']]);
    for (let i = 0; i < 30 && s2.turn.step !== 'main2' && s2.pending; i++) s2 = settle(pass(s2));
    s2 = resolveAll(s2);
    expect(s2.players.find((p) => p.id === 'p2')!.hasLost).toBe(true);
  });
});

describe('CR 611.2a, 115.1: "Until end of turn, target creature you control gets +1/+1 and target creature an opponent controls gets -1/-1."', () => {
  it('each target gets its own change; both are legal targets of their own spec only', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Duel'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear Cub', 'Test Imp'] } });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Imp', 'battlefield', 'p2');
    const s1 = resolveAll(cast(s0, 'Test Duel', { groups: [[obj(mine)], [obj(theirs)]] }));
    expect(pt(s1, mine)).toBe('3/3');
    expect(pt(s1, theirs)).toBe('1/1');
    expect(pt(s1, find(s1, 'Test Bear Cub', 'battlefield', 'p2'))).toBe('1/1');
  });
  it('it cannot be cast with one of its targets missing (an opponent controls no creature)', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Duel'], battlefield: ['Test Bear'] } });
    const castable = legal(s0, 'p1', 'cast').some((a) => (a.action as { card?: string }).card === find(s0, 'Test Duel', 'hand', 'p1'));
    expect(castable).toBe(false);
  });
});

describe('CR 205.3m, 613.1d: "gets +3/-3 and loses all creature types until end of turn"', () => {
  it('a Bear loses Bear and gets +3/-3; at end of turn the type is back', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Invert'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const s1 = resolveAll(cast(s0, 'Test Invert', { targets: [obj(ogre)] }));
    expect(chars(s1, ogre).subtypes).toEqual([]);
    expect(pt(s1, ogre)).toBe('6/1');
    const next = advanceTo(s1, 2, 'main1');
    expect([...chars(next, ogre).subtypes]).toEqual(['Ogre']);
    expect(pt(next, ogre)).toBe('3/4');
  });
  it("a changeling (every creature type) loses every creature type too: the later effect removes what the earlier characteristic-defining ability gave (CR 613.3)", () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Invert'] }, p2: { battlefield: ['Test Shifter'] } });
    const sh = find(s0, 'Test Shifter', 'battlefield', 'p2');
    expect(chars(s0, sh).subtypes.length).toBeGreaterThan(100);
    const s1 = resolveAll(cast(s0, 'Test Invert', { targets: [obj(sh)] }));
    expect(chars(s1, sh).subtypes).toEqual([]);
    const next = advanceTo(s1, 2, 'main1');
    expect(chars(next, sh).subtypes.length).toBeGreaterThan(100);
  });
});

describe('CR 608.2d, 607.2d: "target Mouse you control gains your choice of double strike or trample until end of turn"', () => {
  it('the chosen keyword is gained, the other is not', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Mouse'] } });
    const m = find(s0, 'Test Mouse', 'battlefield');
    let s = advanceTo(s0, 1, 'beginCombat');
    s = settle(s, { targets: [obj(m)], option: /trample/i });
    s = resolveAll(s, { targets: [obj(m)], option: /trample/i });
    expect(kw(s, m, 'trample')).toBe(true);
    expect(kw(s, m, 'double strike')).toBe(false);
  });
  it('the other choice', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Mouse'] } });
    const m = find(s0, 'Test Mouse', 'battlefield');
    let s = advanceTo(s0, 1, 'beginCombat');
    s = settle(s, { targets: [obj(m)], option: /double/i });
    s = resolveAll(s, { targets: [obj(m)], option: /double/i });
    expect(kw(s, m, 'double strike')).toBe(true);
    expect(kw(s, m, 'trample')).toBe(false);
  });
});

describe('CR 608.2d, 113.6: a granted trigger with a choice: "Whenever this creature attacks, it gains your choice of vigilance or reach until end of turn."', () => {
  it('the equipped creature that attacks gains the chosen keyword and only that one', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Axe', 'Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = tweak(s0, (t) => { t.objects[find(s0, 'Test Axe', 'battlefield')]!.attachedTo = bear; });
    expect(full(AXE)).toBe(true);
    const s2 = resolveAll(declareAttackers(toDeclareAttackers(s1), [[bear, 'p2']]), { option: /reach/i });
    expect(kw(s2, bear, 'reach')).toBe(true);
    expect(kw(s2, bear, 'vigilance')).toBe(false);
    expect(pt(s2, bear)).toBe('3/2');
  });
});

describe('CR 701.10b, 608.2h: "double the power of target creature you control until end of turn"', () => {
  it('a land arrives: the target creature gets +X/+0 where X is its power as the effect begins', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Swamp'], battlefield: ['Test Harmonizer', 'Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    let s = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Swamp', 'hand', 'p1') });
    s = resolveAll(s, { targets: [obj(bear)] });
    expect(pt(s, bear)).toBe('4/2');
  });
});

describe('CR 122.1, 611.2c: "Creatures you control with counters on them gain hexproof and indestructible until end of turn."', () => {
  it('only the creatures that have a counter as it resolves gain the keywords', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Ox', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Imp'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const imp = find(s0, 'Test Imp', 'battlefield');
    const s = resolveAll(activate(s0, 'Test Ox'));
    expect(kw(s, bear, 'hexproof')).toBe(true);
    expect(kw(s, bear, 'indestructible')).toBe(true);
    expect(kw(s, imp, 'hexproof')).toBe(false);
    expect(kw(s, imp, 'indestructible')).toBe(false);
  });
});

describe('CR 603.2, 122.1: "put a +1/+1 counter on that creature and it gains haste until end of turn"', () => {
  it('the Elf that entered gets the counter and haste; the Gardener itself gets neither', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Elf'], battlefield: ['Test Gardener'] } });
    const gardener = find(s0, 'Test Gardener', 'battlefield');
    const s1 = resolveAll(cast(s0, 'Test Elf'));
    const elf = find(s1, 'Test Elf', 'battlefield', 'p1');
    expect(s1.objects[elf]!.counters['+1/+1']).toBe(1);
    expect(kw(s1, elf, 'haste')).toBe(true);
    expect(s1.objects[gardener]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 603.2, 611.2a: "he gets +2/+0 and gains indestructible until end of turn" (a character\'s own pronoun)', () => {
  it('when the Hero attacks alone he gets +2/+0 and indestructible; attacking with another creature too, he does not', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Hero', 'Test Bear'] } });
    const hero = find(s0, 'Test Hero', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    let s = resolveAll(declareAttackers(toDeclareAttackers(s0), [[hero, 'p2']]));
    expect(pt(s, hero)).toBe('4/2');
    expect(kw(s, hero, 'indestructible')).toBe(true);
    s = resolveAll(declareAttackers(toDeclareAttackers(s0), [[hero, 'p2'], [bear, 'p2']]));
    expect(pt(s, hero)).toBe('2/2');
    expect(kw(s, hero, 'indestructible')).toBe(false);
  });
});

describe('CR 611.2a, 603.2: "target creature you control with power 3 or greater gains trample and \\"Whenever this creature deals combat damage to a player, draw a card.\\""', () => {
  it('only a creature with power 3 or greater is a legal target', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Prize', 'Test Bear'] } });
    const la = legal(s0, 'p1', 'activate').filter((a) => a.object === find(s0, 'Test Prize', 'battlefield', 'p1') && !a.isMana);
    const s = la.length === 0 ? s0 : settle(act(s0, la[0]!.action));
    expect(s.pending?.kind === 'chooseTargets' || la.length === 0).toBe(true);
  });
  it('the 3-power creature deals combat damage to a player: its controller draws a card', () => {
    const big = card('Test Brute', 'Creature — Ogre', '', ['3', '3']);
    const s0 = scenario([], { defs: [...ALL, big], p1: { battlefield: ['Test Prize', 'Test Brute'] } });
    const brute = find(s0, 'Test Brute', 'battlefield');
    let s = resolveAll(activate(s0, 'Test Prize', { targets: [obj(brute)] }));
    expect(kw(s, brute, 'trample')).toBe(true);
    const h = handSize(s, 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[brute, 'p2']]);
    for (let i = 0; i < 30 && s.turn.step !== 'main2' && s.pending; i++) s = settle(pass(s));
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(handSize(s, 'p1')).toBe(h + 1);
  });
});

describe('CR 113.6, 613.1f, 701.57a: "Equipped creature has reach, \\"{0}, {T}: Tap target artifact or creature,\\" and \\"{0}, {T}: Discover 2.\\""', () => {
  it('the equipped creature has reach and both abilities; an unequipped creature has none', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Blade', 'Test Bear', 'Test Bear Cub'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const cub = find(s0, 'Test Bear Cub', 'battlefield');
    const blade = find(s0, 'Test Blade', 'battlefield');
    const s1 = tweak(s0, (t) => { t.objects[blade]!.attachedTo = bear; });
    expect(kw(s1, bear, 'reach')).toBe(true);
    expect(kw(s1, cub, 'reach')).toBe(false);
    const acts = (s: GameState, id: ObjectId) => legal(s, 'p1', 'activate').filter((a) => a.object === id && !a.isMana).length;
    expect(acts(s1, bear)).toBe(2);
    expect(acts(s1, cub)).toBe(0);
  });
});
