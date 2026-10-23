/**
 * Design 4.3: the hazards of the structural sharing that milestone 4 introduced (`util/clone.ts#cloneState`), as they apply to the records the ability
 * model adds. Each test is a rule every later work package relies on.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, cloneState, getChars, type GameState } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import { cloneObject, clone } from '../../../src/util/clone';
import { FACE_DOWN } from '../../../src/rules/base-chars';
import { startedGame } from '../../helpers';
import { find, pass, scenario, tweak } from '../helpers';

const board = (): GameState => scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });

/** A state in which the bears carry a link store and a cast record (what WP7/WP9 write). */
function withRecords(): { s: GameState; bears: string } {
  const s0 = board();
  const bears = find(s0, 'Grizzly Bears', 'battlefield');
  const s = tweak(s0, (t) => {
    t.objects[bears]!.links = { exiled: { objects: [{ id: 'o900', zone: 'exile' }], values: ['red'] } };
    t.objects[bears]!.cast = { costsPaid: { kicked: 1, manaSpent: [{ type: 'G' }] }, x: 2, from: 'hand', via: 'kicker', turn: 1 };
  });
  return { s, bears };
}

describe('design 4.3 hazard 1: cloneObject deep-copies links and cast', () => {
  it('mutating a clone\'s links (nested objects, arrays) or cast (nested costsPaid) leaves the base state untouched', () => {
    const { s, bears } = withRecords();
    const before = JSON.stringify(s.objects[bears]);
    const copy = cloneState(s);
    const o = copy.objects[bears]!;
    expect(o.links).toEqual(s.objects[bears]!.links);
    expect(o.links).not.toBe(s.objects[bears]!.links);
    expect(o.cast).not.toBe(s.objects[bears]!.cast);
    o.links!['exiled']!.objects!.push({ id: 'o901', zone: 'exile' });
    o.links!['exiled']!.values![0] = 'blue';
    o.links!['other'] = { players: ['p1'] };
    o.cast!.costsPaid.kicked = 5;
    o.cast!.costsPaid.manaSpent![0]!.type = 'R';
    o.cast!.x = 9;
    expect(JSON.stringify(s.objects[bears])).toBe(before);
  });

  it('cloneObject itself copies both records and does not invent them', () => {
    const { s, bears } = withRecords();
    const c = cloneObject(s.objects[bears]!);
    expect(c.links).not.toBe(s.objects[bears]!.links);
    expect(c.cast!.costsPaid).not.toBe(s.objects[bears]!.cast!.costsPaid);
    const plain = cloneObject(s.objects[find(s, 'Hill Giant', 'battlefield')]!);
    expect('links' in plain).toBe(false);
    expect('cast' in plain).toBe(false);
  });

  it('an action that edits links in place (as a handler will) cannot corrupt the state it started from, so replay stays deterministic', () => {
    const { s, bears } = withRecords();
    const before = JSON.stringify(s);
    const r = applyAction(s, { type: 'pass', player: 'p1' });
    expect(r.error).toBeUndefined();
    expect(JSON.stringify(s)).toBe(before);
    // Edit the successor the way a handler would, then check neither the source nor a sibling successor changed.
    const sibling = applyAction(s, { type: 'pass', player: 'p1' }).state;
    r.state.objects[bears]!.links!['exiled']!.values!.push('x');
    expect(JSON.stringify(s)).toBe(before);
    expect(sibling.objects[bears]!.links!['exiled']!.values).toEqual(['red']);
  });
});

describe('design 4.3 hazard 2: definitions are frozen and shared', () => {
  it('createGame freezes every definition deeply (compile output, token definitions) and states share them', () => {
    const s = startedGame();
    const def = s.defs['Test Bear']!;
    expect(Object.isFrozen(def) && Object.isFrozen(def.faces[0]) && Object.isFrozen(def.faces[0]!.abilities) && Object.isFrozen(def.automation)).toBe(true);
    expect(applyAction(s, { type: 'pass', player: s.pending!.player }).state.defs).toBe(s.defs);
  });

  it('Game.addDef is copy-on-write: the map the earlier states hold never gains an entry', () => {
    const s = board();
    const g = new Game(cloneState(s));
    const token = { ...s.defs['Grizzly Bears']!, id: 'token:test', isToken: true };
    g.addDef(token);
    expect(g.s.defs).not.toBe(s.defs);
    expect(Object.keys(s.defs)).not.toContain('token:test');
    expect(Object.isFrozen(g.s.defs['token:test'])).toBe(true);
  });
});

describe('design 4.3 hazard 3: lki entries are written once, with complete characteristics', () => {
  it('moveObject fills LastKnown.chars with the characteristics the object had when it left (CR 608.2h, 603.10)', () => {
    const s = board();
    const g = new Game(cloneState(s));
    const bears = find(g.s, 'Grizzly Bears', 'battlefield');
    g.s.objects[bears]!.counters['+1/+1'] = 2; // the layered values, not the printed ones
    const expected = getChars(g.s, bears);
    expect(expected.power).toBe('4');
    moveObject(g, bears, 'graveyard', { cause: 'test' });
    const lki = g.s.lki[bears]!;
    expect(lki.chars).toEqual(expected);
    expect(lki.chars!.name).toBe('Grizzly Bears');
    expect(lki.chars!.types).toContain('Creature');
    expect(lki.leftZone).toBe('battlefield');
    expect(lki.newId).toBeDefined();
  });

  it('abilities on the stack have no characteristics of their own, so their lki chars stay null', () => {
    const s = scenario(['Llanowar Elves'], { p1: { battlefield: ['Llanowar Elves'] } });
    const g = new Game(cloneState(s));
    const elves = find(g.s, 'Llanowar Elves', 'battlefield');
    const abilityObject = { ...g.s.objects[elves]!, id: 'o-ability', kind: 'ability' as const, zone: 'stack' as const };
    g.s.objects[abilityObject.id] = abilityObject;
    g.s.zones.stack.push(abilityObject.id);
    expect(moveObject(g, abilityObject.id, 'graveyard')).toBeNull();
    expect(g.s.lki[abilityObject.id]!.chars).toBeNull();
  });

  it('an entry is shared by the states derived from it and never edited by later actions', () => {
    let s = board();
    const g = new Game(cloneState(s));
    const bears = find(g.s, 'Grizzly Bears', 'battlefield');
    moveObject(g, bears, 'graveyard');
    s = g.s;
    const entry = s.lki[bears]!;
    const json = JSON.stringify(entry);
    const next = pass(pass(s));
    expect(next.lki[bears]).toBe(entry);
    expect(JSON.stringify(next.lki[bears])).toBe(json);
  });
});

describe('design 4.3 hazard 4: the log is append-only; reminders are state, not log entries', () => {
  it('log entries are shared and only appended; the new state arrays are not shared', () => {
    const s = board();
    const next = applyAction(s, { type: 'pass', player: 'p1' }).state;
    for (let i = 0; i < s.log.length; i++) expect(next.log[i]).toBe(s.log[i]);
    expect(next.reminders).not.toBe(s.reminders);
  });
});

// WP30 amended hazard 5 for `history`: its ARRAY is copied (a push to a copy does not reach the original, checked here) but its entries are shared and frozen,
// like the log's (test/m5/skeleton/wp30-history-hazard.test.ts). The other new arrays are deep-cloned.
describe('design 4.3 hazard 5 (amended by WP30 for history): the new top-level arrays are copied, not shared', () => {
  it('history (array copied, frozen entries shared), designations, reminders, continuousEffects and delayedTriggers exist on a new game and are copied', () => {
    const s = board();
    const had = s.history.length; // WP8 records the events of the game from its first event on
    for (const key of ['history', 'reminders', 'continuousEffects', 'delayedTriggers'] as const) expect(Array.isArray(s[key]), key).toBe(true);
    expect(s.designations).toEqual({});
    const copy = cloneState(s);
    copy.history.push({ turn: 1, combat: 0, ev: 'zoneChange', facts: { creature: true } });
    copy.reminders.push({ id: 'r1', text: 'x', sourceName: 'x', controller: 'p1', until: { d: 'endOfTurn' }, createdTurn: 1 });
    copy.delayedTriggers.push({ id: 'd1', source: { id: 'o1', zone: 'battlefield' }, controller: 'p1', when: { at: 'endOfCombat' }, do: [], captured: {}, vars: {}, createdTurn: 1, firedCount: 0 });
    copy.continuousEffects.push({ id: 'e1', source: null, sourceName: 'x', controller: 'p1', timestamp: 1, startedTurn: 1, duration: { d: 'endOfTurn' }, effect: { s: 'restrict', subject: { ref: 'fixed', players: ['p1'] }, mode: 'cant', action: 'draw' } });
    copy.designations.monarch = 'p2';
    copy.designations.speed = { p1: 3 };
    expect([s.history, s.reminders, s.delayedTriggers, s.continuousEffects].map((a) => a.length)).toEqual([had, 0, 0, 0]);
    expect(s.designations).toEqual({});
  });

  it('structural equality: cloneState equals a deep clone of everything, with the new records present', () => {
    const { s } = withRecords();
    expect(cloneState(s)).toEqual(clone(s));
  });
});

describe('design 4.3 hazards 2-3: face-down characteristics never alias a module-level constant', () => {
  const faceDownBoard = (): { s: GameState; a: string; b: string } => {
    const s0 = board();
    const a = find(s0, 'Grizzly Bears', 'battlefield');
    const b = find(s0, 'Hill Giant', 'battlefield');
    const s = tweak(s0, (t) => {
      t.objects[a]!.faceDown = true;
      t.objects[b]!.faceDown = true;
    });
    return { s, a, b };
  };

  it('CR 708.2a: two face-down creatures (and two calls for one) get their own arrays, so a layer that pushes a type or a subtype cannot leak into a later 2/2', () => {
    const { s, a, b } = faceDownBoard();
    const [ca, cb, ca2] = [getChars(s, a), getChars(s, b), getChars(s, a)];
    for (const key of ['types', 'colors', 'supertypes', 'subtypes', 'abilities', 'keywords', 'names'] as const) {
      expect(ca[key], key).not.toBe(cb[key]);
      expect(ca[key], key).not.toBe(ca2[key]);
    }
    ca.types.push('Artifact');
    ca.subtypes.push('Zombie');
    ca.keywords.push({ kind: 'keyword', text: 'Flying', keyword: 'flying' });
    expect(cb.types).toEqual(['Creature']);
    expect(getChars(s, b).types).toEqual(['Creature']);
    expect(getChars(s, b).subtypes).toEqual([]);
    expect(getChars(s, b).keywords).toEqual([]);
  });

  it('the lki chars of a state are not the arrays of the next face-down creature, and the base constant stays a 2/2 Creature', () => {
    const { s, a, b } = faceDownBoard();
    const g = new Game(cloneState(s));
    moveObject(g, a, 'graveyard', { cause: 'test' });
    const stored = g.s.lki[a]!.chars!;
    stored.types.push('Land');
    expect(getChars(g.s, b).types).toEqual(['Creature']);
    expect(getChars(g.s, b).power).toBe('2');
  });

  it('the module-level face-down record is frozen, so an in-place edit throws at once instead of corrupting every later 2/2', () => {
    const { s, a } = faceDownBoard();
    expect(Object.isFrozen(FACE_DOWN)).toBe(true);
    for (const key of ['names', 'colors', 'supertypes', 'types', 'subtypes', 'abilities', 'keywords'] as const) expect(Object.isFrozen(FACE_DOWN[key]), key).toBe(true);
    expect(() => (FACE_DOWN.types as string[]).push('Land')).toThrow();
    expect(getChars(s, a).types).toEqual(['Creature']);
  });
});
