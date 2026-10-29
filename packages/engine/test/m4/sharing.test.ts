/**
 * Structural sharing (util/clone.ts#cloneState): applying an action must not copy card definitions or old log entries, must never let one
 * state's edits show up in another, and token definitions are added copy-on-write.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, cloneState, compileCard, createToken, replay, type GameState } from '../../src/index';
import { Game } from '../../src/core/game';
import { clone, deepFreeze } from '../../src/util/clone';
import { getTokens } from '../fixtures';
import { startedGame } from '../helpers';
import { answer, find, pass, scenario } from './helpers';

const board = () => scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });

describe('state definitions are shared and never mutated', () => {
  it('applyAction returns a state that shares the very same definitions map as the state it came from', () => {
    const s = board();
    const r = applyAction(s, { type: 'pass', player: 'p1' });
    expect(r.error).toBeUndefined();
    expect(r.state.defs).toBe(s.defs);
    expect(r.state.defs['Grizzly Bears']).toBe(s.defs['Grizzly Bears']);
  });

  it('old log entries and last known information are shared; only the arrays are new', () => {
    const s = board();
    const r = applyAction(s, { type: 'pass', player: 'p1' });
    expect(r.state.log).not.toBe(s.log);
    expect(r.state.log.length).toBeGreaterThan(s.log.length);
    for (let i = 0; i < s.log.length; i++) expect(r.state.log[i]).toBe(s.log[i]);
    expect(r.state.lki).not.toBe(s.lki);
    expect(s.log.length).toBe(s.counters.log); // the input state still has its own log
  });

  it('card definitions are frozen when a game is created: editing one in place throws', () => {
    const s = startedGame(); // (createGame's own state; the scenario helper's clone shares the same frozen definitions since F17/F9)
    const def = s.defs['Test Bear']!;
    expect(Object.isFrozen(def) && Object.isFrozen(def.faces) && Object.isFrozen(def.faces[0]) && Object.isFrozen(def.faces[0]!.abilities)).toBe(true);
    expect(() => { (def.faces[0] as { name: string }).name = 'Other'; }).toThrow(TypeError);
  });

  it('adding a token definition copies the map (copy-on-write): the states before keep their own, the later ones share the new one', () => {
    const s = board();
    const g = new Game(cloneState(s));
    const id = createToken(g, compileCard(getTokens('Soldier')[0]!), 'p1');
    const withToken = g.s;
    expect(withToken.defs).not.toBe(s.defs);
    expect(Object.keys(s.defs)).not.toContain('Soldier');
    expect(Object.keys(withToken.defs)).toContain('Soldier');
    expect(Object.isFrozen(withToken.defs['Soldier'])).toBe(true);
    for (const name of Object.keys(s.defs)) expect(withToken.defs[name]).toBe(s.defs[name]); // the old definitions are shared, not copied
    // A second token reuses the definition and does not copy again.
    const defsBefore = g.s.defs;
    createToken(g, compileCard(getTokens('Soldier')[0]!), 'p1');
    expect(g.s.defs).toBe(defsBefore);
    // The next state derived from the one with the token shares its map.
    const r = applyAction(withToken, { type: 'pass', player: 'p1' });
    expect(r.state.defs).toBe(withToken.defs);
    expect(id).toBeTruthy();
  });
});

describe('states stay immutable', () => {
  it('applying actions never changes the state they were applied to (including combat decisions and rejected actions)', () => {
    const s0 = board();
    const snapshots: [GameState, string][] = [];
    let s = s0;
    snapshots.push([s, JSON.stringify(s)]);
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    for (let i = 0; i < 12 && !s.result; i++) {
      const d = s.pending!;
      let r;
      if (d.kind === 'declareAttackers') r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bears, defender: 'p2' }] } });
      else if (d.kind === 'declareBlockers') r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: d.candidates[0]!.id, attacker: bears }] } });
      else r = applyAction(s, { type: 'pass', player: d.player });
      applyAction(s, { type: 'concede', player: 'p9' }); // rejected
      s = r.state;
      snapshots.push([s, JSON.stringify(s)]);
    }
    for (const [state, json] of snapshots) expect(JSON.stringify(state)).toBe(json);
    expect(snapshots.length).toBeGreaterThan(8);
  });

  it('cloneState is equivalent to a deep clone of everything but the shared parts, and changes to the copy do not reach the original', () => {
    let s = board();
    s = pass(s);
    const copy = cloneState(s);
    expect(copy).toEqual(clone(s));
    copy.objects[Object.keys(copy.objects)[0]!]!.damage = 99;
    copy.players[0]!.life = 1;
    copy.zones.battlefield.pop();
    copy.log.push({ seq: 999, turn: 1, text: 'x' });
    expect(s.objects[Object.keys(s.objects)[0]!]!.damage).not.toBe(99);
    expect(s.players[0]!.life).toBe(20);
    expect(s.zones.battlefield.length).toBe(2);
    expect(s.log.some((l) => l.seq === 999)).toBe(false);
  });

  it('a suspended action (a pending decision) keeps its base state untouched while answers are re-executed', () => {
    const s0 = board();
    let s = s0;
    while (s.pending!.kind === 'priority' && s.turn.step !== 'declareAttackers') s = pass(s);
    expect(s.pending!.kind).toBe('declareAttackers');
    const base = s.suspended!.base;
    const baseJson = JSON.stringify(base);
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bears, defender: 'p2' }] });
    expect(JSON.stringify(base)).toBe(baseJson);
    expect(s.combat!.attackers).toHaveLength(1);
  });

  it('replay of a game that used decisions reproduces it exactly (determinism with shared state)', () => {
    const actions: Parameters<typeof applyAction>[1][] = [];
    const cfg = {
      seed: 'share-1',
      players: [{ name: 'A', deck: Array(40).fill('Plains') as string[], stops: { fullControl: true } }, { name: 'B', deck: Array(40).fill('Plains') as string[], stops: { fullControl: true } }],
      defs: [...Object.values(board().defs)],
      options: { startingPlayer: 'p1', skipMulligans: true },
    };
    let s = replay(cfg, []).state;
    for (let i = 0; i < 30 && !s.result; i++) {
      const a = { type: 'pass' as const, player: s.pending!.player };
      actions.push(a);
      s = applyAction(s, a).state;
    }
    expect(JSON.stringify(replay(cfg, actions).state)).toBe(JSON.stringify(s));
  });
});

describe('F17/F9 (owner decision 2026-10-26): clone shares what is frozen', () => {
  it('a frozen tree is returned as it is: the same reference, at the root and inside a mutable tree', () => {
    const frozen = deepFreeze({ name: 'Bear', faces: [{ types: ['Creature'], abilities: [{ kind: 'keyword', keyword: 'trample' }] }] });
    expect(clone(frozen)).toBe(frozen);
    expect(clone(frozen.faces)).toBe(frozen.faces);
    const holder = { defs: { Bear: frozen }, list: [frozen, { n: 1 }] };
    const c = clone(holder);
    expect(c).not.toBe(holder);
    expect(c.defs).not.toBe(holder.defs);
    expect(c.defs.Bear).toBe(frozen);
    expect(c.list[0]).toBe(frozen);
    expect(c.list[1]).not.toBe(holder.list[1]);
    expect(c).toEqual(holder);
  });

  it('a mutable tree is a deep copy: no object or array is shared, and editing the copy changes nothing in the original', () => {
    const tree = { a: { b: [1, 2, { c: 'x' }] }, d: [[1], [2]], e: undefined as unknown, f: null };
    const c = clone(tree);
    expect(c).toEqual({ a: { b: [1, 2, { c: 'x' }] }, d: [[1], [2]], f: null }); // an undefined key is dropped, as before
    expect('e' in c).toBe(false);
    expect(c.a).not.toBe(tree.a);
    expect(c.a.b).not.toBe(tree.a.b);
    expect(c.a.b[2]).not.toBe(tree.a.b[2]);
    expect(c.d[0]).not.toBe(tree.d[0]);
    (c.a.b[2] as { c: string }).c = 'y';
    c.d[0]!.push(9);
    expect(tree).toEqual({ a: { b: [1, 2, { c: 'x' }] }, d: [[1], [2]], e: undefined, f: null });
  });

  it('a shallow-frozen object is shared too (so only deep-frozen objects may be frozen in a state: definitions, history entries)', () => {
    const inner = { n: 1 };
    const shallow = Object.freeze({ inner });
    expect(clone(shallow)).toBe(shallow);
  });

  it('cloneState still copies what the engine edits and shares the definitions and history entries', () => {
    const s = board();
    const c = cloneState(s);
    expect(c.defs).toBe(s.defs);
    for (const id of Object.keys(s.objects)) {
      expect(c.objects[id]).not.toBe(s.objects[id]);
      expect(c.objects[id]!.counters).not.toBe(s.objects[id]!.counters);
    }
    expect(c.players[0]).not.toBe(s.players[0]);
    expect(c.zones.battlefield).not.toBe(s.zones.battlefield);
    expect(c.turn).not.toBe(s.turn);
    expect(c.history).not.toBe(s.history);
    for (let i = 0; i < s.history.length; i++) expect(c.history[i]).toBe(s.history[i]);
    expect(JSON.stringify(c)).toBe(JSON.stringify(s));
  });
});
