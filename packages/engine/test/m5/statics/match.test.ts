/**
 * statics/match.ts: filters, references, quantities and conditions evaluated over the characteristics computed so far (the layer system cannot call
 * getChars). Checked directly on a board, and the tables of what it evaluates are pinned against its behavior.
 */
import { describe, expect, it } from 'vitest';
import type { Condition, ObjectFilter, ObjRef, Quantity } from '../../../src/index';
import { computeAll } from '../../../src/statics/layers';
import { eachMatching, evalCondition, evalQuantity, filterMatches, objectsOf, playersOf, STATIC_CONDITION_KINDS, STATIC_FILTER_FIELDS, STATIC_OBJREF_KINDS, STATIC_QUANTITY_KINDS, type EvalCx } from '../../../src/statics/match';
import { FINGERPRINTED, NOT_READ_BY_LAYERS } from '../../../src/rules/characteristics';
import { createGame } from '../../../src/index';
import { simpleConfig } from '../../helpers';
import { activated, scenario } from '../helpers';
import { creature, nth, tweak } from './fixtures';
import { setLink } from '../../../src/statics/links';

const FLYING = { kind: 'keyword', text: 'Flying', keyword: 'flying' } as const;
const red = creature('Test Red', '3', '1', [FLYING], { cost: '{1}{R}{R}' });
const green = creature('Test Green', '2', '4', [activated('{T}: Add {G}.', { tap: true })], { cost: '{G}', type: 'Creature — Elf Druid' });
const blue = creature('Test Blue', '1', '1', [], { cost: '{U}', type: 'Creature — Elf Wizard' });

const base = scenario([], { defs: [red, green, blue], p1: { battlefield: ['Test Red', 'Test Green', { name: 'Test Blue', tapped: true, counters: { charge: 2 } }, 'Plains'], graveyard: ['Test Green'], hand: ['Test Red'] }, p2: { battlefield: ['Test Red'] } });
const cxOf = (s = base, over: Partial<EvalCx> = {}): EvalCx => ({ s, all: computeAll(s), source: nth(s, 'Test Green'), controller: 'p1', ...over });
const names = (cx: EvalCx, ids: string[]): string[] => ids.map((i) => cx.s.defs[cx.s.objects[i]!.defId]!.name);
const match = (f: ObjectFilter): string[] => { const cx = cxOf(); return names(cx, eachMatching(cx, f)); };

describe('filters', () => {
  it('zones: the battlefield by default, a named zone, a list, any', () => {
    expect(match({ types: ['Creature'] })).toEqual(['Test Red', 'Test Green', 'Test Blue', 'Test Red']);
    expect(match({ types: ['Creature'], zone: 'graveyard' })).toEqual(['Test Green']);
    expect(match({ types: ['Creature'], zone: ['graveyard', 'hand'] }).sort()).toEqual(['Test Green', 'Test Red']);
    expect(match({ name: 'Test Red', zone: 'any' })).toHaveLength(3);
  });
  it('controller and owner relative to the effect\'s controller', () => {
    expect(match({ types: ['Creature'], controller: 'you' })).toHaveLength(3);
    expect(match({ types: ['Creature'], controller: 'opponent' })).toEqual(['Test Red']);
    expect(match({ types: ['Creature'], owner: 'opponent' })).toEqual(['Test Red']);
    expect(match({ types: ['Creature'], controller: { ref: 'fixed', players: ['p2'] } })).toEqual(['Test Red']);
  });
  it('types, subtypes, colors, names, keywords, abilities', () => {
    expect(match({ subtypes: ['Elf'] })).toEqual(['Test Green', 'Test Blue']);
    expect(match({ subtypes: ['Elf'], notSubtypes: ['Wizard'] })).toEqual(['Test Green']);
    expect(match({ allTypes: ['Creature'], notTypes: ['Land'], colors: ['R'] })).toEqual(['Test Red', 'Test Red']);
    expect(match({ colorless: true })).toEqual(['Plains']);
    expect(match({ multicolored: true })).toEqual([]);
    expect(match({ monocolored: true, types: ['Creature'] })).toHaveLength(4);
    expect(match({ name: 'Test Blue' })).toEqual(['Test Blue']);
    expect(match({ notName: 'Test Red', types: ['Creature'] })).toEqual(['Test Green', 'Test Blue']);
    expect(match({ keyword: 'flying' })).toEqual(['Test Red', 'Test Red']);
    expect(match({ keyword: ['flying', 'reach'], types: ['Creature'] })).toHaveLength(2);
    expect(match({ notKeyword: 'flying', types: ['Creature'] })).toEqual(['Test Green', 'Test Blue']);
    expect(match({ hasAbility: 'mana' })).toEqual(['Plains']); // the rule-generated mana ability of the Plains; Test Green's is an ordinary activated ability here (no isMana flag)
    expect(match({ hasAbility: 'activated', types: ['Creature'] })).toEqual(['Test Green']);
  });
  it('comparisons: power, toughness, mana value, counters, with a number or a quantity', () => {
    expect(match({ power: { op: '>=', value: 2 }, types: ['Creature'] })).toEqual(['Test Red', 'Test Green', 'Test Red']);
    expect(match({ toughness: { op: '<', value: 2 }, types: ['Creature'] })).toEqual(['Test Red', 'Test Blue', 'Test Red']);
    expect(match({ manaValue: { op: '==', value: 3 } })).toEqual(['Test Red', 'Test Red']);
    expect(match({ counters: { kind: 'charge' } })).toEqual(['Test Blue']);
    expect(match({ counters: { kind: 'charge', cmp: { op: '>=', value: 3 } } })).toEqual([]);
    expect(match({ types: ['Creature'], power: { op: '>', value: { q: 'count', of: { ref: 'each', filter: { name: 'Test Blue' } } } } }).length).toBe(3); // greater than 1
  });
  it('status: tapped, token, isCard, self, other, is, anyOf, not', () => {
    expect(match({ tapped: true })).toEqual(['Test Blue']);
    expect(match({ token: true })).toEqual([]);
    expect(match({ isCard: true, types: ['Creature'] })).toHaveLength(4);
    expect(match({ self: true })).toEqual(['Test Green']);
    expect(match({ types: ['Creature'], other: true })).toHaveLength(3);
    expect(match({ is: { ref: 'self' } })).toEqual(['Test Green']);
    expect(match({ anyOf: [{ name: 'Test Blue' }, { name: 'Plains' }] })).toEqual(['Test Blue', 'Plains']);
    expect(match({ types: ['Creature'], not: { colors: ['R'] } })).toEqual(['Test Green', 'Test Blue']);
  });
  it('sharesWith and chosen read other objects and the source\'s links', () => {
    expect(match({ types: ['Creature'], sharesWith: { with: { ref: 'self' }, quality: 'creatureType' } })).toEqual(['Test Blue']); // Elf, but not itself
    expect(match({ types: ['Creature'], sharesWith: { with: { ref: 'self' }, quality: 'color' } })).toEqual([]);
    const s = tweak(base, (t) => { setLink(t.objects[nth(t, 'Test Green')]!, 'c', { values: ['Wizard'] }); });
    const cx = cxOf(s);
    expect(names(cx, eachMatching(cx, { chosen: { link: 'c', quality: 'creatureType' } }))).toEqual(['Test Blue']);
  });
  it('a field this module does not evaluate NEVER matches, also under `not` (it is not silently ignored)', () => {
    expect(match({ dealtDamageThisTurn: true })).toEqual([]);
    expect(match({ not: { enteredThisTurn: true }, types: ['Creature'] })).toEqual([]);
    expect(match({ castFrom: 'hand', zone: 'any' })).toEqual([]); // FAST4 T24: stackKind is evaluated now (statics/match.ts#stackKindOk)
    const cx = cxOf();
    expect(filterMatches(cx, nth(base, 'Test Red'), { castFrom: 'hand' })).toBe(false);
  });
  it('combat fields read the combat structure', () => {
    const s = tweak(base, (t) => {
      const id = nth(t, 'Test Red', 0);
      t.combat = { number: 1, attacked: true, attackers: [{ id, defender: 'p2', defendingPlayer: 'p2', blockedBy: [], blocked: false }], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] };
    });
    const cx = cxOf(s);
    expect(names(cx, eachMatching(cx, { attacking: true }))).toEqual(['Test Red']);
    expect(names(cx, eachMatching(cx, { attacking: { defender: 'opponent' } }))).toEqual(['Test Red']);
    expect(names(cx, eachMatching(cx, { blocking: true }))).toEqual([]);
  });
});

describe('references', () => {
  it('self, subject, attachedTo, fixed (zone checked), union, linked', () => {
    const s = tweak(base, (t) => {
      t.objects[nth(t, 'Test Green')]!.attachedTo = nth(t, 'Test Blue');
      setLink(t.objects[nth(t, 'Test Green')]!, 'x', { objects: [{ id: nth(t, 'Test Red', 0), zone: 'battlefield' }, { id: nth(t, 'Test Red', 0), zone: 'graveyard' }], players: ['p2'] });
    });
    const cx = cxOf(s, { subject: nth(s, 'Test Blue') });
    const ids = (r: ObjRef): string[] => names(cx, objectsOf(cx, r));
    expect(ids({ ref: 'self' })).toEqual(['Test Green']);
    expect(ids({ ref: 'subject' })).toEqual(['Test Blue']);
    expect(ids({ ref: 'attachedTo' })).toEqual(['Test Blue']);
    expect(ids({ ref: 'fixed', objects: [{ id: nth(s, 'Test Red', 1), zone: 'battlefield' }, { id: nth(s, 'Test Red', 1), zone: 'hand' }] })).toEqual(['Test Red']);
    expect(ids({ ref: 'union', of: [{ ref: 'self' }, { ref: 'attachedTo' }, { ref: 'self' }] })).toEqual(['Test Green', 'Test Blue']);
    expect(ids({ ref: 'linked', link: 'x' })).toEqual(['Test Red']); // the handle in the wrong zone is skipped
    expect(playersOf(cx, { ref: 'linked', link: 'x' })).toEqual(['p2']);
    expect(ids({ ref: 'target', id: 't' })).toEqual([]); // an event or target reference means nothing in a static ability
  });
  it('players: you, active, anOpponent (only when unambiguous), each, controllerOf, ownerOf, fixed', () => {
    const cx = cxOf();
    expect(playersOf(cx, { ref: 'you' })).toEqual(['p1']);
    expect(playersOf(cx, { ref: 'active' })).toEqual(['p1']);
    expect(playersOf(cx, { ref: 'anOpponent' })).toEqual(['p2']);
    expect(playersOf(cx, { ref: 'each', who: 'player' })).toEqual(['p1', 'p2']);
    expect(playersOf(cx, { ref: 'each', who: 'opponent' })).toEqual(['p2']);
    expect(playersOf(cx, { ref: 'controllerOf', object: { ref: 'each', filter: { name: 'Test Red' } } })).toEqual(['p1', 'p2']);
    expect(playersOf(cx, { ref: 'ownerOf', object: { ref: 'self' } })).toEqual(['p1']);
    expect(playersOf(cx, { ref: 'fixed', players: ['p2', 'nobody'] })).toEqual(['p2']);
    expect(playersOf(cx, { ref: 'bound', name: 'x' })).toEqual([]);
  });
});

describe('quantities', () => {
  const q = (x: Quantity): number | undefined => evalQuantity(cxOf(), x);
  it('numbers, count, countPlayers, stat (single, sum), life, zoneSize, counters', () => {
    expect(q(7)).toBe(7);
    expect(q({ q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } })).toBe(3);
    expect(q({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' } })).toBe(1);
    expect(q({ q: 'stat', stat: 'power', of: { ref: 'self' } })).toBe(2);
    expect(q({ q: 'stat', stat: 'power', of: { ref: 'each', filter: { name: 'Test Red' } } })).toBeUndefined(); // two objects, no sum: not a single number
    expect(q({ q: 'stat', stat: 'power', sum: true, of: { ref: 'each', filter: { name: 'Test Red' } } })).toBe(6);
    expect(q({ q: 'stat', stat: 'manaValue', of: { ref: 'each', filter: { name: 'Test Blue' } } })).toBe(1);
    expect(q({ q: 'life', of: { ref: 'you' } })).toBe(20);
    expect(q({ q: 'zoneSize', zone: 'graveyard', of: { ref: 'you' } })).toBe(1);
    expect(q({ q: 'zoneSize', zone: 'battlefield', of: { ref: 'you' } })).toBe(4);
    expect(q({ q: 'counters', on: { ref: 'each', filter: { name: 'Test Blue' } }, kind: 'charge' })).toBe(2);
    expect(q({ q: 'counters', on: { ref: 'each', filter: { name: 'Test Blue' } }, kind: 'any' })).toBe(2);
    expect(q({ q: 'counters', on: { ref: 'you' }, kind: 'poison' })).toBe(0);
  });
  it('devotion (CR 700.5), distinct, math, live, turnNumber', () => {
    expect(q({ q: 'devotion', to: ['R'], of: { ref: 'you' } })).toBe(2); // {1}{R}{R} on the battlefield; the red card in hand does not count
    expect(q({ q: 'devotion', to: ['G', 'U'], of: { ref: 'you' } })).toBe(2);
    expect(q({ q: 'distinct', what: 'colors', among: { ref: 'each', filter: { types: ['Creature'] } } })).toBe(3);
    expect(q({ q: 'distinct', what: 'creatureTypes', among: { ref: 'each', filter: { types: ['Creature'] } } })).toBe(4); // Bear, Elf, Druid, Wizard
    expect(q({ q: 'math', op: '+', args: [1, 2, 3] })).toBe(6);
    expect(q({ q: 'math', op: '-', args: [10, 3, 2] })).toBe(5);
    expect(q({ q: 'math', op: '*', args: [2, { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }] })).toBe(6);
    expect(q({ q: 'math', op: 'floorDiv', args: [7, 2] })).toBe(3);
    expect(q({ q: 'math', op: 'ceilDiv', args: [7, 2] })).toBe(4);
    expect(q({ q: 'math', op: 'floorDiv', args: [7, 0] })).toBeUndefined();
    expect(q({ q: 'math', op: 'max', args: [1, 9, 4] })).toBe(9);
    expect(q({ q: 'live', value: 4 })).toBe(4);
    expect(q({ q: 'turnNumber' })).toBe(base.turn.number);
  });
  it('what needs an event, a variable, an announced X or a step result is unknown here', () => {
    for (const x of [{ q: 'X' }, { q: 'var', name: 'n' }, { q: 'eventAmount' }, { q: 'resultCount', step: 's' }, { q: 'dieResult' }, { q: 'ask', text: '?' }, { q: 'targetCount', id: 't' }] as Quantity[]) expect(q(x), JSON.stringify(x)).toBeUndefined();
    expect(q({ q: 'math', op: '+', args: [1, { q: 'X' }] })).toBeUndefined();
  });
});

describe('conditions', () => {
  const c = (x: Condition, s = base): boolean => evalCondition(cxOf(s), x);
  it('boolean structure, compare, exists, matches', () => {
    expect(c({ cond: 'all', of: [] })).toBe(true);
    expect(c({ cond: 'any', of: [] })).toBe(false);
    expect(c({ cond: 'not', of: { cond: 'any', of: [] } })).toBe(true);
    expect(c({ cond: 'compare', left: { q: 'life', of: { ref: 'you' } }, op: '>=', right: 20 })).toBe(true);
    expect(c({ cond: 'compare', left: { q: 'X' }, op: '>=', right: 0 })).toBe(false); // unknown is never true
    expect(c({ cond: 'exists', of: { ref: 'each', filter: { name: 'Test Blue' } } })).toBe(true);
    expect(c({ cond: 'exists', of: { ref: 'each', filter: { name: 'Test Red' } }, atLeast: 3 })).toBe(false);
    expect(c({ cond: 'matches', object: { ref: 'self' }, filter: { subtypes: ['Elf'] } })).toBe(true);
    expect(c({ cond: 'matches', object: { ref: 'self' }, filter: { colors: ['R'] } })).toBe(false);
  });
  it('turnOf, designation, wasCast, chosen', () => {
    expect(c({ cond: 'turnOf', whose: 'you' })).toBe(true);
    expect(c({ cond: 'turnOf', whose: 'opponent' })).toBe(false);
    expect(c({ cond: 'turnOf', whose: 'you', step: ['main1', 'main2'] })).toBe(true);
    expect(c({ cond: 'turnOf', whose: 'you', step: 'end' })).toBe(false);
    const s = tweak(base, (t) => {
      t.designations.monarch = 'p1';
      t.objects[nth(t, 'Test Green')]!.cast = { costsPaid: { kicked: 1 }, x: 3, from: 'hand', via: 'kicker', turn: 1 };
      setLink(t.objects[nth(t, 'Test Green')]!, 'color', { values: ['red'] });
    });
    expect(c({ cond: 'designation', who: { ref: 'you' }, what: 'monarch' }, s)).toBe(true);
    expect(c({ cond: 'designation', who: { ref: 'anOpponent' }, what: 'monarch' }, s)).toBe(false);
    expect(c({ cond: 'wasCast', kicked: true }, s)).toBe(true);
    expect(c({ cond: 'wasCast', from: 'hand', xAtLeast: 3 }, s)).toBe(true);
    expect(c({ cond: 'wasCast', xAtLeast: 4 }, s)).toBe(false);
    expect(c({ cond: 'wasCast', kicked: true })).toBe(false);
    expect(c({ cond: 'chosen', link: 'color', equals: 'red' }, s)).toBe(true);
    expect(c({ cond: 'chosen', link: 'color', equals: 'blue' }, s)).toBe(false);
  });
  it('history, step results and questions are false in a static ability', () => {
    expect(c({ cond: 'happened', event: { ev: 'draw' } as never, scope: 'turn' })).toBe(false);
    expect(c({ cond: 'did', step: 'x' })).toBe(false);
    expect(c({ cond: 'ask', text: '?' })).toBe(false);
  });
});

describe('the tables say what is evaluated', () => {
  it('every listed quantity kind is known (a canonical example answers), the unlisted ones are not', () => {
    const cx = cxOf();
    const samples: Record<string, Quantity> = {
      number: 1, count: { q: 'count', of: { ref: 'self' } }, countPlayers: { q: 'countPlayers', of: { ref: 'you' } }, stat: { q: 'stat', stat: 'power', of: { ref: 'self' } },
      life: { q: 'life', of: { ref: 'you' } }, zoneSize: { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } }, counters: { q: 'counters', on: { ref: 'self' }, kind: 'any' },
      devotion: { q: 'devotion', to: ['R'], of: { ref: 'you' } }, distinct: { q: 'distinct', what: 'colors', among: { ref: 'self' } }, math: { q: 'math', op: '+', args: [1] },
      live: { q: 'live', value: 1 }, turnNumber: { q: 'turnNumber' }, cardsDrawnThisTurn: { q: 'cardsDrawnThisTurn' }, spellsCastThisTurn: { q: 'spellsCastThisTurn' },
      lifeGainedThisTurn: { q: 'lifeGainedThisTurn' },
      kickCount: { q: 'kickCount' }, // M6-0 (CR 702.33d: never cast = kicked 0 times)
      commanderCasts: { q: 'commanderCasts' }, // M11-0 (CR 903.8: 0 outside Commander)
      speed: { q: 'speed' }, // FAST5X-4 (CR 702.179f: no speed counts as 0)
      partySize: { q: 'partySize', of: { ref: 'you' } }, // FAST5 T38 (CR 700.8)
      unspentMana: { q: 'unspentMana' }, // FAST5X E19 (CR 106.4: an empty mana pool has 0)
      turnsBegun: { q: 'turnsBegun' }, // std-r9 (CR 500.7: none of your turns begun counts 0)
      descendedThisTurn: { q: 'descendedThisTurn' }, // FAST5X E22 (CR 700.11: no permanent card put into your graveyard this turn counts as 0)
      startingLife: { q: 'startingLife' }, // FAST5 T60 (CR 103.4: the game's starting life total, 20 here)
      happenedCount: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, to: 'battlefield' }, scope: 'turn' }, // CLOUD std-ecl (CR 611.3a: nothing entered yet counts 0)
      lifeLostThisTurn: { q: 'lifeLostThisTurn', of: { ref: 'you' } }, // Cloud std-woe (CR 119.3: no life lost this turn counts as 0)
      unlockedDoors: { q: 'unlockedDoors', among: { ref: 'self' } }, // r4-static (CR 709.5c: no Room permanent counts 0)
      costCount: { q: 'costCount', name: 'sacrificed' }, // std-costs-1 (CR 601.2b: never cast, nothing announced, 0)
    };
    expect(Object.keys(samples).sort()).toEqual([...STATIC_QUANTITY_KINDS].sort());
    for (const [k, v] of Object.entries(samples)) expect(evalQuantity(cx, v), k).not.toBeUndefined();
  });
  it('the condition and reference kinds listed are the ones with behavior; the filter fields include every field a static ability in the model can use that has no history or stack meaning', () => {
    expect([...STATIC_CONDITION_KINDS].sort()).toEqual(['all', 'any', 'chosen', 'classLevel' /* M6-0, CR 716.2a */, 'compare', 'completedDungeon' /* MX4, CR 309.7 */, 'designation', 'exists', 'happened' /* FAST5X E9 */, 'matches', 'not', 'prime' /* std-rx1 */, 'turnOf', 'wasCast']);
    expect([...STATIC_OBJREF_KINDS].sort()).toEqual(['attachedTo', 'each', 'fixed', 'linked', 'self', 'subject', 'union']);
    for (const f of ['enteredThisTurn', 'dealtDamageThisTurn', 'blockedThisTurn', 'targets']) expect(STATIC_FILTER_FIELDS.has(f), f).toBe(false);
    for (const f of ['attackedThisTurn' /* FAST5X E28 */, 'stackKind' /* FAST4 T24 */, 'castFrom' /* std-rf */, 'zone', 'controller', 'types', 'keyword', 'hasAbility', 'counters', 'sharesWith', 'chosen', 'anyOf', 'not']) expect(STATIC_FILTER_FIELDS.has(f), f).toBe(true);
  });
});

describe('the cache fingerprint covers every part of the state exactly once', () => {
  it('each key of GameState is either read by the layers (and in the fingerprint) or listed as not read', () => {
    const keys = Object.keys(createGame(simpleConfig())).sort();
    expect([...FINGERPRINTED, ...NOT_READ_BY_LAYERS].sort()).toEqual(keys);
    expect(FINGERPRINTED.filter((k) => NOT_READ_BY_LAYERS.includes(k))).toEqual([]);
  });
});
