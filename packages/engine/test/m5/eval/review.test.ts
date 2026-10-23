/**
 * WP4 review fixes: one test (or a few) per finding, named after the rule. Each of these failed before its fix.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EngineBug } from '../../../src/core/errors';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import type { ExecCtx } from '../../../src/effects/api';
import { recheckAll } from '../../../src/effects/ctx';
import { evalCond, evalCount, evalQty, COND_EVALUATORS, QTY_EVALUATORS } from '../../../src/effects/eval';
import { rebase, resolveObjs, resolvePlayers } from '../../../src/effects/refs';
import { ENGINE_CAPABILITIES, type EffectProgram, type EventContext, type GameState, type HistoryEntry, type ObjectFilter, type ObjectId, type ObjRef, type Quantity, type TargetSpec } from '../../../src/index';
import { newCombat } from '../../../src/rules/combat-state';
import { getChars } from '../../../src/rules/characteristics';
import { SUPPORTED_FILTER_FIELDS, matchesFilter, NO_ENV } from '../../../src/rules/filter';
import { HISTORY_CAPABILITIES, HISTORY_WRITTEN, countHistory, historyPatternForms, makeHistoryEntry, objectFacts, currentCombatNumber, type FactsEnv } from '../../../src/rules/history';
import { ALL_CREATURE_TYPES } from '../../../src/rules/creature-types';
import { SRC_ROOT, keyword, spellAbility, synth } from '../helpers';
import { bind, chosenObject, ctxOn, find, handle, moveTo, putOnStack, scenario } from './helpers';

const creatureSpec: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const poke = synth({ name: 'Test Poke', cost: '{R}', type: 'Instant', abilities: [spellAbility('x', [creatureSpec])] });

// ---- CR 603.10a, 608.2h: last known information of an object that moved --------------------------------------------------------------------------------------

describe('CR 603.10a, 608.2h: a look-back event is read through the last known information of the object, not through the object it became', () => {
  function dying(setup: (s: GameState, bears: ObjectId, giant: ObjectId) => void = () => undefined, subject: 'Grizzly Bears' | 'Hill Giant' = 'Grizzly Bears') {
    const s = scenario(['Grizzly Bears', 'Hill Giant', 'Llanowar Elves'], { p1: { battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, p2: { battlefield: ['Hill Giant'] }, defs: [poke] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield', 'p2');
    setup(s, bears, giant);
    const old = subject === 'Grizzly Bears' ? bears : giant;
    const newId = moveObject(new Game(s, []), old, 'graveyard', { cause: 'test' })!;
    const event: EventContext = { ev: 'zoneChange', roles: { subject: { objects: [{ id: newId, zone: 'graveyard' }] } }, before: { [old]: s.lki[old]! } };
    const trigger = putOnStack(s, { name: 'Llanowar Elves', kind: 'triggered', event });
    return { s, old, newId, cx: ctxOn(s, trigger) };
  }
  const subject = { ref: 'event', role: 'subject' } as const;

  it('"its power": a Grizzly Bears with two +1/+1 counters that died had power 4 (the graveyard card has 2)', () => {
    const { cx } = dying((s, bears) => { s.objects[bears]!.counters = { '+1/+1': 2 }; });
    expect(evalQty(cx, { q: 'stat', stat: 'power', of: subject })).toBe(4);
    expect(evalQty(cx, { q: 'stat', stat: 'toughness', of: subject })).toBe(4);
  });
  it('"its controller" and "its owner": a creature owned by p1 and controlled by p2 that died was controlled by p2', () => {
    const { cx } = dying((s, _b, giant) => { s.objects[giant]!.owner = 'p1'; }, 'Hill Giant');
    expect(resolvePlayers(cx, { ref: 'controllerOf', object: subject })).toEqual(['p2']);
    expect(resolvePlayers(cx, { ref: 'ownerOf', object: subject })).toEqual(['p1']);
  });
  it('"the number of counters on it" and "if it was a creature with power 4 or more" read the object as it last existed', () => {
    const { cx } = dying((s, bears) => { s.objects[bears]!.counters = { '+1/+1': 2 }; });
    expect(evalQty(cx, { q: 'counters', on: subject, kind: '+1/+1' })).toBe(2);
    expect(evalCond(cx, { cond: 'matches', object: subject, filter: { power: { op: '>=', value: 4 } } })).toBe(true);
  });
  it('a card that was in the graveyard before it was chosen as a target is read as it is now (no predecessor), even if the same card also died in the event', () => {
    const { s, old, newId, cx: cx0 } = dying((s, bears) => { s.objects[bears]!.counters = { '+1/+1': 2 }; });
    const spec: TargetSpec = { id: 't0', kind: 'object', filter: { zone: 'graveyard', types: ['Creature'] }, min: 1, max: 1, text: 'target creature card in a graveyard' };
    const event = cx0.event!;
    const spell = putOnStack(s, { name: 'Llanowar Elves', kind: 'triggered', event, targets: [[chosenObject(newId)]] });
    const cx = ctxOn(s, spell, { targets: [spec], steps: [] });
    expect(s.lki[old]!.newId).toBe(newId);
    expect(evalQty(cx, { q: 'stat', stat: 'power', of: { ref: 'target', id: 't0' } })).toBe(2); // the card in the graveyard
    expect(evalQty(cx, { q: 'stat', stat: 'power', of: subject })).toBe(4); // the creature that died
  });
});

describe('CR 400.7j, 608.2h: a re-based binding reads the last known information of the object it was before the move', () => {
  function exiled(setup: (s: GameState, bears: ObjectId, giant: ObjectId) => void) {
    const s = scenario(['Grizzly Bears', 'Hill Giant', 'Llanowar Elves'], { p1: { battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, p2: { battlefield: ['Hill Giant'] }, defs: [poke] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield', 'p2');
    setup(s, bears, giant);
    const cx = ctxOn(s, putOnStack(s, { name: 'Test Poke', targets: [[chosenObject(giant)]] }), { targets: [creatureSpec], steps: [] });
    return { s, bears, giant, cx };
  }
  it('"exile target creature. Its controller gains life equal to its power": a stolen Hill Giant, exiled, was controlled by p1', () => {
    const { s, giant, cx } = exiled((s, _b, giant) => { s.objects[giant]!.controller = 'p1'; });
    bind(cx, 'ex', [handle(s, giant)]);
    const to = moveTo(cx, giant, 'exile')!;
    rebase(cx, giant, { id: to, zone: 'exile' });
    expect(resolvePlayers(cx, { ref: 'controllerOf', object: { ref: 'bound', name: 'ex' } })).toEqual(['p1']);
    expect(resolvePlayers(cx, { ref: 'ownerOf', object: { ref: 'bound', name: 'ex' } })).toEqual(['p2']);
  });
  it('a Grizzly Bears with two +1/+1 counters, exiled: its power was 4', () => {
    const { s, bears, cx } = exiled((s, bears) => { s.objects[bears]!.counters = { '+1/+1': 2 }; });
    bind(cx, 'ex', [handle(s, bears)]);
    const to = moveTo(cx, bears, 'exile')!;
    rebase(cx, bears, { id: to, zone: 'exile' });
    expect(evalQty(cx, { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'ex' } })).toBe(4);
  });
  it('an object that did not move is read as it is now', () => {
    const { s, bears, cx } = exiled(() => undefined);
    bind(cx, 'it', [handle(s, bears)]);
    s.objects[bears]!.counters = { '+1/+1': 1 };
    expect(evalQty(cx, { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'it' } })).toBe(3);
  });
});

// ---- the history capabilities wait for the writer ------------------------------------------------------------------------------------------------------------

describe('design 5.2, D2: a history capability is advertised only together with the package that writes the history', () => {
  const names = [...HISTORY_CAPABILITIES].sort();
  it('the history capabilities are exactly these', () => {
    expect(names).toEqual(['cond:happened', 'filter:attackedThisTurn', 'filter:blockedThisTurn', 'filter:controllerDealtCombatDamageBySourceThisTurn' /* FAST5 T66 */, 'filter:dealtDamageBySourceThisTurn', 'filter:dealtDamageThisTurn', 'filter:enteredThisTurn', 'q:happenedCount', 'filter:dealtDamageAsSourceThisTurn' /* CLOUD std-mkm: "a creature that dealt damage this turn", CR 120.1 */, 'filter:putThereThisTurn' /* r3-choose: "that was put there from anywhere this turn", CR 400.7 */, 'filter:putThereFrom' /* r5-fxz: "... from the battlefield this turn", CR 400.7 */,
      'filter:crewedBySourceThisTurn', 'filter:enteredFrom' /* Standard round 5, r5-trig: "crewed by ~ this turn", "entered from exile" (CR 702.122c, 603.6a) */,
      'filter:countersPutThisTurn' /* std-rx12: "that you've put one or more +1/+1 counters on this turn", CR 122.6 */].sort()); // FAST3 T14: dealtDamageBySourceThisTurn
  });
  it('each is in ENGINE_CAPABILITIES if and only if feature:history is (WP8 writes GameState.history and registered both)', () => {
    for (const n of names) expect(ENGINE_CAPABILITIES.has(n), n).toBe(ENGINE_CAPABILITIES.has('feature:history'));
    expect(HISTORY_WRITTEN).toBe(ENGINE_CAPABILITIES.has('feature:history'));
    expect(ENGINE_CAPABILITIES.has('feature:history')).toBe(true);
  });
  it('the evaluators are in the capability tables now that the history is written', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, defs: [poke] });
    const cx = ctxOn(s, putOnStack(s, { name: 'Test Poke' }));
    expect(evalCond(cx, { cond: 'happened', event: { ev: 'draw', player: 'you' }, scope: 'turn' })).toBe(false);
    expect(evalQty(cx, { q: 'happenedCount', event: { ev: 'draw', player: 'you' }, scope: 'turn' })).toBe(0);
    expect(Object.hasOwn(COND_EVALUATORS, 'happened')).toBe(true);
    expect(Object.hasOwn(QTY_EVALUATORS, 'happenedCount')).toBe(true);
  });
});

describe('design 5.2: the filter forms that need a resolution context are advertised once every call site passes one (WP30)', () => {
  it('controller.ref, owner.ref, cmp.quantity and the fields is, sharesWith, targets and attacking.defender are capabilities (rules/filter-env.ts at every call site)', () => {
    for (const n of ['controller.ref', 'owner.ref', 'cmp.quantity', 'is', 'sharesWith', 'targets', 'attacking.defender']) {
      expect(SUPPORTED_FILTER_FIELDS.has(n), n).toBe(true);
      expect(ENGINE_CAPABILITIES.has(`filter:${n}`), n).toBe(true);
    }
    for (const n of ['keyword.list', 'notKeyword.list', 'hasAbility', 'counters', 'power', 'attacking']) expect(SUPPORTED_FILTER_FIELDS.has(n), n).toBe(true);
  });
});

describe('history: self and other compare the object of the entry that the pattern is about (the damage source, the blocked attacker, ...)', () => {
  function board() {
    const s = scenario(['Grizzly Bears', 'Serra Angel', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears', 'Serra Angel'] }, p2: { battlefield: ['Hill Giant'] } });
    const id = (n: string, owner = 'p1') => find(s, n, 'battlefield', owner);
    const facts = (oid: ObjectId, prefix = '') => objectFacts(getChars(s, oid), s.objects[oid]!, prefix);
    const add = (e: HistoryEntry) => { s.history.push(e); };
    return { s, id, facts, add };
  }
  const count = (s: GameState, p: Parameters<typeof countHistory>[1], sourceId: ObjectId) => countHistory(s, p, 'turn', undefined, { you: 'p1', sourceId });

  it('damage: the source is Grizzly Bears; "self" is true for the Bears and "other" for anything else', () => {
    const { s, id, facts, add } = board();
    const bears = id('Grizzly Bears');
    const giant = id('Hill Giant', 'p2');
    add(makeHistoryEntry(s, { ev: 'damage', subject: giant, actor: 'p1', facts: { ...facts(giant), amount: 2, combat: false, toPlayer: false, ...facts(bears, 'source.') } }));
    expect(count(s, { ev: 'damage', source: { name: 'Grizzly Bears' } }, bears)).toBe(1);
    expect(count(s, { ev: 'damage', source: { self: true } }, bears)).toBe(1);
    expect(count(s, { ev: 'damage', source: { other: true } }, bears)).toBe(0);
    expect(count(s, { ev: 'damage', source: { self: true } }, id('Serra Angel'))).toBe(0);
    expect(count(s, { ev: 'damage', source: { other: true } }, id('Serra Angel'))).toBe(1);
  });
  it('blocks (the blocked attacker), becomesBlocked (the blocker) and becomes (the object that did it)', () => {
    const { s, id, facts, add } = board();
    const bears = id('Grizzly Bears');
    const angel = id('Serra Angel');
    const giant = id('Hill Giant', 'p2');
    add(makeHistoryEntry(s, { ev: 'blocks', subject: giant, actor: 'p2', facts: { ...facts(giant), ...facts(bears, 'attacker.') } }));
    add(makeHistoryEntry(s, { ev: 'becomesBlocked', subject: bears, actor: 'p1', facts: { ...facts(bears), ...facts(giant, 'by.') } }));
    add(makeHistoryEntry(s, { ev: 'becomes', subject: giant, actor: 'p1', facts: { ...facts(giant), what: 'tapped', ...facts(angel, 'by.') } }));
    expect(count(s, { ev: 'blocks', attacker: { self: true } }, bears)).toBe(1);
    expect(count(s, { ev: 'blocks', attacker: { other: true } }, bears)).toBe(0);
    expect(count(s, { ev: 'becomesBlocked', by: { self: true } }, giant)).toBe(1);
    expect(count(s, { ev: 'becomesBlocked', by: { other: true } }, giant)).toBe(0);
    expect(count(s, { ev: 'becomes', what: 'tapped', object: {}, by: { self: true } }, angel)).toBe(1);
    expect(count(s, { ev: 'becomes', what: 'tapped', object: {}, by: { other: true } }, angel)).toBe(0);
  });
  it('a zone change: the subject entry is the NEW object, the facts keep the id it had on the battlefield; "self" recognizes either (CR 400.7, 603.10a)', () => {
    const { s, id, facts, add } = board();
    const bears = id('Grizzly Bears');
    add(makeHistoryEntry(s, { ev: 'zoneChange', subject: 'o900', facts: { ...facts(bears), from: 'battlefield', to: 'graveyard' } }));
    expect(count(s, { ev: 'zoneChange', subject: { self: true } }, bears)).toBe(1);
    expect(count(s, { ev: 'zoneChange', subject: { self: true } }, 'o900')).toBe(1);
    expect(count(s, { ev: 'zoneChange', subject: { other: true } }, bears)).toBe(0);
  });
  it('an entry that says nothing about the object it is asked about is a loud error', () => {
    const { s, add } = board();
    add(makeHistoryEntry(s, { ev: 'blocks', subject: 'o1', facts: {} }));
    expect(() => count(s, { ev: 'blocks', attacker: { self: true } }, 'o2')).toThrow(EngineBug);
  });
});

describe('history: a pattern field the facts cannot answer is a named missing form, and an error (never a plain Error) if it is evaluated anyway', () => {
  it('historyPatternForms names every unanswerable object-filter field of a pattern', () => {
    expect(historyPatternForms({ ev: 'zoneChange', subject: { tapped: true, types: ['Creature'] } })).toEqual(['feature:history.pattern.tapped']);
    // FAST5X E25: `faceDown` is a fact of an entry now (rules/history.ts#objectFacts, CR 708.3: "entered the battlefield face down this turn")
    expect(historyPatternForms({ ev: 'damage', source: { anyOf: [{ attacking: true }, { counters: { kind: 'x' } }] }, recipient: { object: { not: { faceDown: true } } } }).sort())
      .toEqual(['feature:history.pattern.attacking', 'feature:history.pattern.counters']);
    expect(historyPatternForms({ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you', self: true, keyword: 'flying' }, from: 'battlefield', to: 'graveyard' })).toEqual([]);
    expect(historyPatternForms({ ev: 'draw', player: 'you' })).toEqual([]);
    for (const n of historyPatternForms({ ev: 'zoneChange', subject: { tapped: true } })) expect(ENGINE_CAPABILITIES.has(n)).toBe(false);
  });
  it('evaluating one throws EngineBug (the interpreter\'s backstop), not a plain Error', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    s.history.push(makeHistoryEntry(s, { ev: 'zoneChange', subject: 'o901', facts: { ...objectFacts(getChars(s, find(s, 'Grizzly Bears', 'battlefield')), s.objects[find(s, 'Grizzly Bears', 'battlefield')]!), from: 'battlefield', to: 'graveyard' } }));
    const env: FactsEnv = { you: 'p1' };
    expect(() => countHistory(s, { ev: 'zoneChange', subject: { tapped: true } }, 'turn', undefined, env)).toThrow(EngineBug);
  });
});

// ---- advertised nodes must not throw --------------------------------------------------------------------------------------------------------------------------

describe('cond:designation citysBlessing (CR 702.131) is evaluated, not thrown', () => {
  it('true for the players who have it, false for the others', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, defs: [poke] });
    const cx = ctxOn(s, putOnStack(s, { name: 'Test Poke' }));
    const has = (who: 'you' | 'anOpponent') => evalCond(cx, { cond: 'designation', who: { ref: who }, what: 'citysBlessing' });
    expect([has('you'), has('anOpponent')]).toEqual([false, false]);
    s.designations.citysBlessing = ['p1'];
    expect([has('you'), has('anOpponent')]).toEqual([true, false]);
  });
});

describe('q:distinct creatureTypes with a changeling (CR 702.73a, 205.3m)', () => {
  const shifter = synth({ name: 'Test Shifter', cost: '{1}', type: 'Creature — Shapeshifter', pt: ['1', '1'], abilities: [keyword('changeling')] });
  const odd = synth({ name: 'Test Odd', cost: '{1}', type: 'Creature — Zzyzx', pt: ['1', '1'], abilities: [] });
  const among: ObjRef = { ref: 'each', filter: { types: ['Creature'] } };
  it('a changeling has every creature type: the count is the size of the whole list (a type outside the list adds one)', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears', 'Test Shifter'] }, defs: [shifter, poke] });
    const cx = ctxOn(s, putOnStack(s, { name: 'Test Poke' }));
    expect(ALL_CREATURE_TYPES.size).toBeGreaterThan(280);
    expect(ALL_CREATURE_TYPES.has('Time Lord')).toBe(true);
    expect(evalQty(cx, { q: 'distinct', what: 'creatureTypes', among })).toBe(ALL_CREATURE_TYPES.size);
    const t = scenario([], { p1: { battlefield: ['Test Shifter', 'Test Odd'] }, defs: [shifter, odd, poke] });
    expect(evalQty(ctxOn(t, putOnStack(t, { name: 'Test Poke' })), { q: 'distinct', what: 'creatureTypes', among })).toBe(ALL_CREATURE_TYPES.size + 1);
  });
});

// ---- CR 508.5, 506.3: the attacked entity --------------------------------------------------------------------------------------------------------------------

describe('CR 506.3, 508.5: "attacking you" is attacking the player, not a planeswalker the player controls', () => {
  it('a creature attacking p2\'s planeswalker is not "attacking" p2; one attacking p2 is', () => {
    const s = scenario(['Grizzly Bears', 'Serra Angel', 'Jace Beleren'], { p1: { battlefield: ['Grizzly Bears', 'Serra Angel'] }, p2: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const angel = find(s, 'Serra Angel', 'battlefield');
    const jace = find(s, 'Jace Beleren', 'battlefield', 'p2');
    s.combat = {
      number: 1,
      attacked: true, damageSteps: 0, extraDamageStep: false, firstStrikers: [],
      attackers: [
        { id: bears, defender: jace, defendingPlayer: 'p2', blockedBy: [], blocked: false },
        { id: angel, defender: 'p2', defendingPlayer: 'p2', blockedBy: [], blocked: false },
      ],
      blockers: [],
    };
    const m = (id: ObjectId, f: ObjectFilter) => matchesFilter(s, s.objects[id]!, f, { you: 'p2', env: NO_ENV });
    expect(m(bears, { attacking: { defender: 'you' } })).toBe(false);
    expect(m(angel, { attacking: { defender: 'you' } })).toBe(true);
    expect(m(bears, { attacking: true })).toBe(true);
  });
});

// ---- hasAbility ------------------------------------------------------------------------------------------------------------------------------------------------

describe('hasAbility: a definite answer or no match at all, so a "not" never flips what could not be classified (design D2)', () => {
  const unknownLine = synth({ name: 'Test Unknown', cost: '{1}', type: 'Creature — Wizard', pt: ['1', '1'], abilities: [{ kind: 'manual', text: 'Do a thing.', reason: 'not understood', shape: 'unknown' }] });
  const persister = synth({ name: 'Test Persister', cost: '{1}', type: 'Creature — Elemental', pt: ['1', '1'], abilities: [keyword('persist')] });
  const oddKeyword = synth({ name: 'Test OddKeyword', cost: '{1}', type: 'Creature — Wizard', pt: ['1', '1'], abilities: [keyword('someunknownkeyword')] });
  const board = () => {
    const s = scenario(['Serra Angel', 'Plains', 'Dryad Arbor', 'Prodigal Pyromancer', 'Grizzly Bears'], {
      p1: { battlefield: ['Serra Angel', 'Test Persister', 'Plains', 'Dryad Arbor', 'Test Unknown', 'Test OddKeyword', 'Grizzly Bears'] },
      defs: [unknownLine, oddKeyword, persister],
    });
    const m = (name: string, f: ObjectFilter) => matchesFilter(s, s.objects[find(s, name, 'battlefield')]!, f, { you: 'p1', env: NO_ENV });
    return { s, m };
  };
  it('keywords are static, triggered or activated as the rules say (CR 702.9a flying, 702.20a vigilance: static; persist, 702.79a: triggered)', () => {
    const { m } = board();
    expect([m('Serra Angel', { hasAbility: 'static' }), m('Serra Angel', { hasAbility: 'activated' }), m('Serra Angel', { not: { hasAbility: 'activated' } })]).toEqual([true, false, true]);
    expect([m('Test Persister', { hasAbility: 'triggered' }), m('Test Persister', { hasAbility: 'static' })]).toEqual([true, false]);
  });
  it('a basic land type is an intrinsic mana ability (CR 305.6, 605.1a)', () => {
    const { m } = board();
    expect([m('Plains', { hasAbility: 'mana' }), m('Plains', { hasAbility: 'activated' }), m('Plains', { hasAbility: 'triggered' })]).toEqual([true, true, false]);
    expect(m('Dryad Arbor', { hasAbility: 'mana' })).toBe(true); // it is a Forest
  });
  it('an ability that cannot be classified (an unknown manual line, a keyword with no tabulated kind) makes the filter not match, also under "not"', () => {
    const { m } = board();
    for (const name of ['Test Unknown', 'Test OddKeyword']) {
      expect(m(name, { hasAbility: 'activated' }), name).toBe(false);
      expect(m(name, { not: { hasAbility: 'activated' } }), name).toBe(false);
    }
    expect(m('Grizzly Bears', { not: { hasAbility: 'activated' } })).toBe(true); // nothing to classify: a definite no
  });
});

// ---- aggregates over an empty set of the game ----------------------------------------------------------------------------------------------------------------

describe('CR 608.2h: a total over a set of the game that is empty is 0, not "fails to determine"', () => {
  const board = () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, defs: [poke] });
    return { s, cx: ctxOn(s, putOnStack(s, { name: 'Test Poke' })) };
  };
  it('the total power / toughness of no creatures is 0', () => {
    const { cx } = board();
    const none: ObjRef = { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } };
    expect(evalQty(cx, { q: 'stat', stat: 'power', sum: true, of: none })).toBe(0);
    expect(evalQty(cx, { q: 'stat', stat: 'power', sum: true, of: { ref: 'union', of: [none, none] } })).toBe(0);
    expect(evalCond(cx, { cond: 'compare', left: { q: 'stat', stat: 'power', sum: true, of: none }, op: '<=', right: 3 })).toBe(true);
  });
  it('the number of counters on no permanents is 0', () => {
    const { cx } = board();
    expect(evalQty(cx, { q: 'counters', on: { ref: 'each', filter: { types: ['Artifact'] } }, kind: 'charge' })).toBe(0);
  });
  it('a target, a bound name or an event role with nothing in it still fails to determine (CR 608.2b)', () => {
    const { cx } = board();
    bind(cx, 'empty', []);
    expect(evalQty(cx, { q: 'stat', stat: 'power', sum: true, of: { ref: 'bound', name: 'empty' } })).toBeUndefined();
    expect(evalQty(cx, { q: 'counters', on: { ref: 'bound', name: 'empty' }, kind: 'charge' })).toBeUndefined();
    expect(evalQty(cx, { q: 'stat', stat: 'power', sum: true, of: { ref: 'event', role: 'subject' } })).toBeUndefined();
  });
});

// ---- CR 107.1b ------------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 107.1b: a computed count is never negative; a comparison still sees the negative number', () => {
  it('evalCount clamps at 0, evalQty does not', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, defs: [poke] });
    const cx = ctxOn(s, putOnStack(s, { name: 'Test Poke' }));
    const q: Quantity = { q: 'math', op: '-', args: [1, 3] };
    expect(evalCount(q, { cx })).toBe(0);
    expect(evalQty(cx, q)).toBe(-2);
    expect(evalCond(cx, { cond: 'compare', left: q, op: '<', right: 0 })).toBe(true);
  });
});

// ---- CR 702.33d -----------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 702.33d: only a spell can be kicked, so a permanent that was never cast was not kicked', () => {
  const kickable = synth({ name: 'Test Kicker', cost: '{1}{R}', type: 'Creature — Elemental', pt: ['2', '2'], abilities: [] });
  it('"unless it was kicked" holds for a reanimated creature: kicked:false is true, kicked:true and every other part are false', () => {
    const s = scenario([], { p1: { battlefield: ['Test Kicker'] }, defs: [kickable] });
    const cx = ctxOn(s, find(s, 'Test Kicker', 'battlefield'));
    const w = (c: object) => evalCond(cx, { cond: 'wasCast', ...c });
    expect([w({ kicked: false }), w({ kicked: true }), w({ kicked: 'kicker' }), w({}), w({ via: 'evoke' }), w({ from: 'hand' }), w({ kicked: false, from: 'hand' })]).toEqual([true, false, false, false, false, false, false]);
    expect(evalCond(cx, { cond: 'not', of: { cond: 'wasCast', kicked: true } })).toBe(true);
  });
});

// ---- CR 608.2b ------------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 608.2b: legality is checked once, when resolution begins', () => {
  it('recheckAll after something happened does not change the verdict (a target that was legal and was acted on is still read through its handle)', () => {
    const s = scenario(['Hill Giant'], { p2: { battlefield: ['Hill Giant'] }, defs: [poke] });
    const giant = find(s, 'Hill Giant', 'battlefield', 'p2');
    const cx = ctxOn(s, putOnStack(s, { name: 'Test Poke', targets: [[chosenObject(giant)]] }), { targets: [creatureSpec], steps: [] });
    expect(resolvePlayers(cx, { ref: 'controllerOf', object: { ref: 'target', id: 't0' } })).toEqual(['p2']);
    moveTo(cx, giant, 'exile');
    expect(recheckAll(cx)).toEqual({ legal: 1, total: 1 });
    expect(resolvePlayers(cx, { ref: 'controllerOf', object: { ref: 'target', id: 't0' } })).toEqual(['p2']);
  });
  it('the Plague Spores example of CR 608.2b: ONE land creature chosen for both "target nonblack creature" and "target land", then it turns black: the land part is still legal', () => {
    const nonblack: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'], notColors: ['B'] }, min: 1, max: 1, text: 'target nonblack creature' };
    const land: TargetSpec = { id: 't1', kind: 'object', filter: { types: ['Land'] }, min: 1, max: 1, text: 'target land' };
    const spores = synth({ name: 'Test Spores', cost: '{4}{B}', type: 'Sorcery', abilities: [spellAbility('Destroy target nonblack creature and target land.', [nonblack, land])] });
    const dryad = synth({ name: 'Test Black Dryad', cost: '{B}', type: 'Land Creature — Dryad', pt: ['1', '1'], abilities: [] }); // black: by the time the spell resolves the "nonblack" part is illegal
    const s = scenario([], { p1: { battlefield: ['Test Black Dryad'] }, defs: [spores, dryad] });
    const both = find(s, 'Test Black Dryad', 'battlefield');
    const spell = putOnStack(s, { name: 'Test Spores', targets: [[chosenObject(both)], [chosenObject(both)]] });
    expect(getChars(s, both).colors).toEqual(['B']);
    const cx = ctxOn(s, spell, { targets: [nonblack, land], steps: [] });
    expect(recheckAll(cx)).toEqual({ legal: 1, total: 2 });
    expect(resolveObjs(cx, { ref: 'target', id: 't0' })).toEqual([]);
    expect(resolveObjs(cx, { ref: 'target', id: 't1' })).toEqual([{ id: both, zone: 'battlefield' }]);
  });
});

// ---- CR 500.8 -------------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 500.8: a second combat phase in the same turn is combat number 2', () => {
  it('the number of the combat in progress is counted by the combat state, not guessed from earlier entries', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const fresh = (number: number): NonNullable<GameState['combat']> => ({ attacked: false, damageSteps: 0, extraDamageStep: false, firstStrikers: [], attackers: [], blockers: [], number });
    s.combat = fresh(1);
    expect(currentCombatNumber(s)).toBe(1);
    const first = makeHistoryEntry(s, { ev: 'attacks', subject: 'o1', facts: {} });
    s.history.push(first);
    s.combat = fresh(2); // the extra combat phase
    expect(currentCombatNumber(s)).toBe(2);
    const second = makeHistoryEntry(s, { ev: 'attacks', subject: 'o2', facts: {} });
    s.history.push(second);
    expect(second.combat).toBe(2);
    expect(s.history.filter((e) => e.combat === currentCombatNumber(s))).toEqual([second]);
    expect(countHistory(s, { ev: 'attacks' }, 'combat', undefined, { you: 'p1' })).toBe(1);
    s.combat = null;
    expect(currentCombatNumber(s)).toBe(0);
  });
  it('newCombat numbers the combat phases of a turn 1, 2, 3 and starts again at 1 on the next turn', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    expect([newCombat(s).number, newCombat(s).number, newCombat(s).number]).toEqual([1, 2, 3]);
    s.turn.combats = 0; // what beginNextTurn does
    expect(newCombat(s).number).toBe(1);
  });
});

// ---- the quantity hook ---------------------------------------------------------------------------------------------------------------------------------------

describe('effects/refs.ts cannot call effects/eval.ts without an import cycle: the hook is documented, and loading refs alone fails loudly', () => {
  it('a plain number needs nothing; a quantity needs effects/eval.ts (EngineBug, never a guess)', async () => {
    vi.resetModules();
    const refs = await import('../../../src/effects/refs');
    const cx = { controller: 'p1', g: { s: { zones: { library: { p1: ['a', 'b', 'c'] } } } } } as unknown as ExecCtx;
    expect(refs.resolveObjs(cx, { ref: 'topCards', player: { ref: 'you' }, count: 2 }).map((h) => h.id)).toEqual(['a', 'b']);
    expect(() => refs.resolveObjs(cx, { ref: 'topCards', player: { ref: 'you' }, count: { q: 'X' } })).toThrow('effects/eval.ts is not loaded');
    await import('../../../src/effects/eval'); // loading it installs the evaluator
    const withTurn = { ...cx, g: { s: { turn: { number: 3 }, zones: { library: { p1: ['a', 'b', 'c'] } } } } } as unknown as ExecCtx;
    expect(refs.resolveObjs(withTurn, { ref: 'topCards', player: { ref: 'you' }, count: { q: 'turnNumber' } }).map((h) => h.id)).toEqual(['a', 'b', 'c']); // evaluated now
  });
  it('effects/api.ts documents the hook', () => {
    expect(readFileSync(join(SRC_ROOT, 'effects/api.ts'), 'utf8')).toContain('installQuantityEvaluator');
  });
});
