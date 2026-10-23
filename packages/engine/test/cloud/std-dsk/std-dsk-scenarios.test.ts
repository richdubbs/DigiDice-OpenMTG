/**
 * Cloud batch 2, slice std-dsk (the Standard backlog of Duskmourn, tuning half): the templates of parser/templates/zz-cloud/std-dsk.json and the engine support
 * they needed, played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 613.4c, 613.1f, 303.4  an Aura's "gets +1/+1 for each <kind> you control and has <keyword>" (layers 7c and 6, counted as the layers apply)
 *   CR 122.1b, 608.2d         "put a flying, lifelink, or +1/+1 counter on it": the controller chooses one kind as the ability resolves
 *   CR 608.2c                 "then discard a card unless you control another creature with power 2 or less" (checked as the instruction is carried out)
 *   CR 506.2, 603.4           "if defending player controls no Glimmer creatures": the player the attacking creature attacks, an intervening if
 *   CR 201.2, 709.5           "a Room card that doesn't have the same name as a Room you control" (a Room permanent has the names of its unlocked halves)
 *   CR 709.5c, 104.2b         "you win the game if there are N or more different names among unlocked doors of Rooms you control"
 *   CR 709.5c, 709.5j         "the number of unlocked doors among Rooms you control"
 *   CR 702.37e, 708.2         "whenever you turn a permanent face up": the player who turned it face up
 *   CR 111.4, 205.3i, 305.6   "a tapped colorless land token named Everywhere that is every basic land type"
 *   CR 702.177a, 602.5b       "Exhaust -- {2}: ... Activate only as a sorcery.": the keyword's "once" and the ability's own timing, both
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, castAuto, find, legal, life, pass, put, scenario, zoneNames } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { putFaceDown, turnUp } from '../../m6/face-down/support';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
function room(left: [string, string, string], right: [string, string, string]): CardDef {
  return compileCard({
    name: `${left[0]} // ${right[0]}`, layout: 'split', type_line: 'Enchantment — Room // Enchantment — Room', mana_cost: `${left[1]} // ${right[1]}`, colors: [],
    card_faces: [
      { name: left[0], type_line: 'Enchantment — Room', mana_cost: left[1], oracle_text: left[2] },
      { name: right[0], type_line: 'Enchantment — Room', mana_cost: right[1], oracle_text: right[2] },
    ],
  } as unknown as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

/** Answer the decisions of an action: costs automatically, targets, then the given answers in order; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering decisions as `settle` does. */
function resolveAll(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; (s.zones.stack.length > 0 || (s.pending !== null && s.pending.kind !== 'priority')) && guard < 40; guard++) {
    if (s.pending?.kind === 'priority') s = pass(s);
    const before = queue.length;
    s = settle(s, targets, queue);
    if (s.pending !== null && s.pending.kind !== 'priority' && queue.length === before) break; // a decision nobody answers
    queue.splice(0, before - queue.length);
  }
  return s;
}
/** Cast the named spell from p1's hand at the given targets and let everything resolve. */
function castAt(s0: GameState, name: string, targets: ObjectId[] = [], answers: DecisionAnswer[] = []): GameState {
  return resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets.map(obj)), targets.map(obj), answers);
}
/** Activate the first non-keyword ability of a permanent of p1, then let it resolve. */
function activate(s0: GameState, source: ObjectId, targets: ObjectId[] = [], answers: DecisionAnswer[] = []): GameState {
  return resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source, ability: 'p:0:0' }), targets.map(obj)), targets.map(obj), answers);
}
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(chars(s, id).power), Number(chars(s, id).toughness)];
const keywords = (s: GameState, id: ObjectId): string[] => chars(s, id).keywords.map((k) => k.keyword);
const tokensOf = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.isToken === true);
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const SPRITE = card('Test Sprite', 'Creature — Faerie', '', ['1', '1']);
const TOTEM = card('Test Totem', 'Enchantment', '');

describe('CR 613.4c, 613.1f, 303.4: "Enchanted creature gets +1/+1 for each enchantment you control and has first strike."', () => {
  const MANTLE = card('Test Mantle', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control and has first strike.');
  it('is automated', () => expect(full(MANTLE)).toBe(true));
  it('counts the enchantments its controller controls (the Aura itself included), not an opponent\'s, and grants first strike', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mantle'], battlefield: ['Test Bear', 'Test Totem'] }, p2: { battlefield: ['Test Totem', 'Test Totem'] }, defs: [MANTLE, BEAR, TOTEM] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castAt(s0, 'Test Mantle', [bear]);
    expect(pt(s, bear)).toEqual([4, 4]); // the Aura and Test Totem
    expect(keywords(s, bear)).toContain('first strike');
    // one more enchantment: the count is read as the layers apply (CR 613.4c), not fixed when the Aura arrived
    const more = tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test Totem'); });
    expect(pt(more, bear)).toEqual([5, 5]);
  });
});

describe('CR 122.1b, 608.2d: "When ~ enters, put a flying, lifelink, or +1/+1 counter on it."', () => {
  const PUPIL = card('Test Pupil', 'Creature — Human', 'When this creature enters, put a flying, lifelink, or +1/+1 counter on it.', ['1', '1']);
  it('is automated', () => expect(full(PUPIL)).toBe(true));
  // the options are offered in the printed order (effects/handlers/choose.ts answers an option choice by its index)
  for (const [kind, option, check] of [['lifelink', '1', (s: GameState, id: ObjectId) => expect(keywords(s, id)).toContain('lifelink')], ['+1/+1', '2', (s: GameState, id: ObjectId) => expect(pt(s, id)).toEqual([2, 2])]] as const) {
    it(`the controller chooses "${kind}" as the ability resolves: exactly one counter of that kind`, () => {
      const s0 = scenario([], { p1: { hand: ['Test Pupil'] }, defs: [PUPIL] });
      const s = castAt(s0, 'Test Pupil', [], [{ kind: 'chooseOption', ids: [option] }]);
      const [id] = onBf(s, 'Test Pupil');
      expect(s.objects[id!]!.counters).toEqual({ [kind]: 1 });
      check(s, id!);
    });
  }
});

describe('CR 608.2c: "When ~ enters, draw a card. Then discard a card unless you control another creature with power 2 or less."', () => {
  const DOLL = card('Test Doll', 'Artifact Creature — Toy', 'When this creature enters, draw a card. Then discard a card unless you control another creature with power 2 or less.', ['2', '1']);
  it('is automated', () => expect(full(DOLL)).toBe(true));
  it('with another creature with power 2 or less: draw and keep the card', () => {
    const s0 = scenario([], { p1: { hand: ['Test Doll'], battlefield: ['Test Sprite'], library: ['Test Bear', 'Test Bear'] }, defs: [DOLL, SPRITE, BEAR] });
    const s = castAt(s0, 'Test Doll');
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Bear']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
  });
  it('with only a bigger creature (the Doll itself does not count, "another"): draw, then discard a card', () => {
    const s0 = scenario([], { p1: { hand: ['Test Doll'], battlefield: ['Test Ogre'], library: ['Test Bear', 'Test Bear'] }, defs: [DOLL, OGRE, BEAR] });
    let s = castAt(s0, 'Test Doll');
    if (s.pending?.kind === 'chooseObjects') s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [s.pending.options[0]!] }));
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Bear']);
  });
});

describe('CR 506.2, 603.4: "Whenever ~ attacks, if defending player controls no Glimmer creatures, it gains menace and deathtouch until end of turn."', () => {
  const DREAD = card('Test Dread', 'Enchantment Creature — Nightmare', 'Whenever this creature attacks, if defending player controls no Glimmer creatures, it gains menace and deathtouch until end of turn.', ['3', '3']);
  const GLIMMER = card('Test Glimmer', 'Enchantment Creature — Glimmer', '', ['1', '1']);
  const attackWith = (s0: GameState): [GameState, ObjectId] => {
    const dread = find(s0, 'Test Dread', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[dread, 'p2']]);
    s = resolveAll(settle(s));
    return [s, dread];
  };
  it('is automated', () => expect(full(DREAD)).toBe(true));
  it('the defending player controls no Glimmer: it gains menace and deathtouch', () => {
    const [s, dread] = attackWith(scenario([], { p1: { battlefield: ['Test Dread'] }, p2: { battlefield: ['Test Bear'] }, defs: [DREAD, GLIMMER, BEAR] }));
    expect(keywords(s, dread)).toEqual(expect.arrayContaining(['menace', 'deathtouch']));
  });
  it('the defending player controls a Glimmer creature: no trigger; a Glimmer of its own controller does not matter', () => {
    const [s, dread] = attackWith(scenario([], { p1: { battlefield: ['Test Dread', 'Test Glimmer'] }, p2: { battlefield: ['Test Glimmer'] }, defs: [DREAD, GLIMMER, BEAR] }));
    expect(keywords(s, dread)).not.toContain('menace');
    const [t, dread2] = attackWith(scenario([], { p1: { battlefield: ['Test Dread', 'Test Glimmer'] }, p2: { battlefield: ['Test Bear'] }, defs: [DREAD, GLIMMER, BEAR] }));
    expect(keywords(t, dread2)).toEqual(expect.arrayContaining(['menace', 'deathtouch']));
  });
});

describe('CR 201.2, 709.5, 709.5c: Rooms, their door names and their unlocked doors', () => {
  const HALL = room(['Test Hall', '{0}', ''], ['Test Stair', '{0}', '']);
  const CELLAR = room(['Test Cellar', '{0}', ''], ['Test Attic', '{0}', '']);
  const STUDY = room(['Test Study', '{0}', ''], ['Test Den', '{0}', '']);
  const MAP = card('Test Map', 'Artifact', "{T}: Search your library for a Room card that doesn't have the same name as a Room you control, reveal it, put it into your hand, then shuffle.");
  const CROWN = card('Test Crown', 'Artifact', '{T}: You win the game if there are three or more different names among unlocked doors of Rooms you control.');
  const LANTERN = card('Test Lantern', 'Artifact', '{T}: Create an X/X blue Spirit creature token with flying, where X is the number of unlocked doors among Rooms you control.');
  const DEFS = [HALL, CELLAR, STUDY, MAP, CROWN, LANTERN];
  const setDoors = (s: GameState, doors: Record<string, number[][]>, owner = 'p1'): GameState => tweak(s, (t) => {
    for (const [name, sets] of Object.entries(doors)) {
      const ids = t.zones.battlefield.filter((id) => t.defs[t.objects[id]!.defId]!.name === name && t.objects[id]!.controller === owner);
      sets.forEach((u, i) => { if (u.length > 0) t.objects[ids[i]!]!.unlocked = u; else delete t.objects[ids[i]!]!.unlocked; });
    }
  });
  it('the three test cards are automated', () => {
    for (const d of [MAP, CROWN, LANTERN]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });

  it('the search offers only a Room card that shares no name with a Room you control (a locked door has no name there)', () => {
    let s0 = scenario([], { p1: { battlefield: ['Test Map', HALL.name], library: [HALL.name, CELLAR.name, 'Test Bear'] }, p2: { battlefield: [STUDY.name] }, defs: [...DEFS, BEAR] });
    s0 = setDoors(s0, { [HALL.name]: [[0]] }); // "Test Hall" unlocked: the Hall // Stair card in the library shares that name
    s0 = setDoors(s0, { [STUDY.name]: [[0, 1]] }, 'p2'); // an opponent's Room does not matter
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Map', 'battlefield'), ability: 'p:0:0' }));
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseObjects');
    const options = s.pending?.kind === 'chooseObjects' ? s.pending.options.map((id) => s.defs[s.objects[id]!.defId]!.name) : [];
    expect(options).toEqual([CELLAR.name]);
    // with every door of the Room locked it has no name (CR 709.5): both Room cards may be found
    let t0 = setDoors(s0, { [HALL.name]: [[]] });
    t0 = settle(act(t0, { type: 'activate', player: 'p1', source: find(t0, 'Test Map', 'battlefield'), ability: 'p:0:0' }));
    t0 = pass(pass(t0));
    const all = t0.pending?.kind === 'chooseObjects' ? t0.pending.options.map((id) => t0.defs[t0.objects[id]!.defId]!.name).sort() : [];
    expect(all).toEqual([CELLAR.name, HALL.name].sort());
  });

  it('three or more different names among unlocked doors: the player wins; two copies of one fully unlocked Room are two names only', () => {
    const base = scenario([], { p1: { battlefield: ['Test Crown', HALL.name, HALL.name, CELLAR.name] }, defs: DEFS });
    const crown = find(base, 'Test Crown', 'battlefield');
    const twoNames = activate(setDoors(base, { [HALL.name]: [[0, 1], [0, 1]], [CELLAR.name]: [[]] }), crown);
    expect(twoNames.result).toBe(null);
    const three = activate(setDoors(base, { [HALL.name]: [[0, 1], []], [CELLAR.name]: [[1]] }), crown);
    expect(three.result?.winner).toBe('p1');
  });

  it('the number of unlocked doors among Rooms you control: each Room\'s unlocked halves, summed (an opponent\'s do not count)', () => {
    let s0 = scenario([], { p1: { battlefield: ['Test Lantern', HALL.name, HALL.name, CELLAR.name] }, p2: { battlefield: [STUDY.name] }, defs: DEFS });
    s0 = setDoors(s0, { [HALL.name]: [[0, 1], []], [CELLAR.name]: [[1]] });
    s0 = setDoors(s0, { [STUDY.name]: [[0, 1]] }, 'p2');
    const s = activate(s0, find(s0, 'Test Lantern', 'battlefield'));
    const tokens = tokensOf(s);
    expect(tokens.length).toBe(1);
    expect(pt(s, tokens[0]!)).toEqual([3, 3]);
    expect(keywords(s, tokens[0]!)).toContain('flying');
  });
});

describe('CR 702.37e, 708.2: "Whenever you turn a permanent face up, put a +1/+1 counter on it."', () => {
  const GROWTH = card('Test Growth', 'Enchantment', 'Whenever you turn a permanent face up, put a +1/+1 counter on it.');
  const VEILED = card('Test Veiled', 'Creature — Horror', 'Morph {0}', ['2', '2']);
  it('is automated', () => expect(full(GROWTH)).toBe(true));
  it('p1 turns its face-down creature face up: it gets the counter', () => {
    let s = scenario([], { p1: { battlefield: ['Test Growth'] }, defs: [GROWTH, VEILED] });
    let id: ObjectId;
    [s, id] = putFaceDown(s, 'p1', 'Test Veiled');
    s = resolveAll(turnUp(s, id));
    expect(s.objects[id]!.faceDown).toBe(false);
    expect(s.objects[id]!.counters).toEqual({ '+1/+1': 1 });
    expect(pt(s, id)).toEqual([3, 3]);
  });
  it('an opponent turning its own face-down creature face up does not trigger p1\'s enchantment', () => {
    let s = scenario([], { p1: { battlefield: ['Test Growth'] }, defs: [GROWTH, VEILED] });
    let id: ObjectId;
    [s, id] = putFaceDown(s, 'p2', 'Test Veiled');
    s = tweak(s, (t) => { t.turn.activePlayer = 'p2'; t.pending = { kind: 'priority', player: 'p2' } as never; });
    s = turnUp(s, id, undefined, [], 'p2');
    expect(s.objects[id]!.faceDown).toBe(false);
    expect(s.zones.stack).toEqual([]);
    expect(s.objects[id]!.counters ?? {}).toEqual({});
  });
});

describe('CR 111.4, 205.3i, 305.6: "create a tapped colorless land token named Everywhere that is every basic land type"', () => {
  const SEED = card('Test Seed', 'Creature — Treefolk', 'When this creature enters, create a tapped colorless land token named Elsewhere that is every basic land type.', ['2', '2']);
  it('is automated', () => expect(full(SEED)).toBe(true));
  it('the token is a tapped colorless land named Elsewhere with the five basic land types, and so their five mana abilities', () => {
    const s0 = scenario([], { p1: { hand: ['Test Seed'] }, defs: [SEED] });
    const s = castAt(s0, 'Test Seed');
    const tokens = tokensOf(s);
    expect(tokens.length).toBe(1);
    const t = tokens[0]!;
    const c = chars(s, t);
    expect(c.name).toBe('Elsewhere');
    expect(c.types).toEqual(['Land']);
    expect(c.colors).toEqual([]);
    expect([...c.subtypes].sort()).toEqual(['Forest', 'Island', 'Mountain', 'Plains', 'Swamp']);
    expect(c.abilities.filter((a) => a.def.kind === 'activated' && a.def.isMana === true).length).toBe(5);
    expect(s.objects[t]!.tapped).toBe(true);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 702.177a, 602.5b: "Exhaust -- {0}: Draw a card. Activate only as a sorcery."', () => {
  const RELIC = card('Test Relic', 'Artifact', 'Exhaust — {0}: Draw a card. Activate only as a sorcery.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.');
  const exhaustOffered = (s: GameState, id: ObjectId): boolean => legal(s, 'p1', 'activate').some((a) => a.object === id);
  it('is automated, with both restrictions', () => {
    expect(full(RELIC)).toBe(true);
    expect(RELIC.faces[0]!.abilities[0]).toMatchObject({ kind: 'activated', keyword: 'exhaust', sorcerySpeed: true, limit: { per: 'game', max: 1 } });
  });
  it('offered only with an empty stack in its controller\'s main phase, and only once', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Relic'], hand: ['Test Bolt'], library: ['Test Bear', 'Test Bear'] }, defs: [RELIC, BOLT, BEAR] });
    const relic = find(s0, 'Test Relic', 'battlefield', 'p1');
    expect(exhaustOffered(s0, relic)).toBe(true);
    // with a spell on the stack it is not (CR 307.1 timing of a sorcery)
    const onStack = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bolt', 'hand', 'p1') }), [{ kind: 'player', id: 'p2' }]);
    expect(onStack.zones.stack.length).toBe(1);
    expect(exhaustOffered(onStack, relic)).toBe(false);
    // activated once, it is never offered again (CR 702.177a)
    const s = activate(s0, relic);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Bolt', 'Test Bear']);
    expect(exhaustOffered(s, relic)).toBe(false);
  });
});

describe('the card-level checks of the slice (castAuto keeps working with the new templates)', () => {
  it('a Room with the new door wordings on its halves compiles and casts', () => {
    const SALON = room(['Test Lounge', '{0}', 'When you unlock this door, create an X/X blue Spirit creature token with flying, where X is the number of unlocked doors among Rooms you control.'], ['Test Stairwell', '{0}', 'At the beginning of your upkeep, surveil 1. You win the game if there are eight or more different names among unlocked doors of Rooms you control.']);
    expect(full(SALON), JSON.stringify(SALON.automation)).toBe(true);
    const s0 = scenario([], { p1: { hand: [SALON.name] }, defs: [SALON] });
    const s = resolveAll(castAuto(s0, SALON.name, { face: 0 }));
    const tokens = tokensOf(s);
    expect(tokens.length).toBe(1);
    expect(pt(s, tokens[0]!)).toEqual([1, 1]); // the Room entered with one door unlocked: X = 1
  });
});
