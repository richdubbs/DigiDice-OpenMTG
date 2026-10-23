import { describe, expect, it } from 'vitest';
import { GameSession, replay, viewFor, HIDDEN_DEF, type Action } from '../../src/index';
import { simpleConfig } from '../helpers';

function playSome(session: GameSession, n: number): void {
  for (let i = 0; i < n && !session.state.result; i++) {
    const d = session.state.pending!;
    let a: Action;
    if (d.kind === 'playFirst') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'playFirst', player: d.player } };
    else if (d.kind === 'mulligan') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'mulligan', keep: i % 3 !== 0 } };
    else if (d.kind === 'chooseObjects') a = { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseObjects', ids: d.options.slice(0, d.min) } };
    else a = { type: 'pass', player: d.player };
    const r = session.apply(a);
    if (!r.ok) throw new Error(r.error.message);
  }
}

describe('determinism, replay and undo', () => {
  it('replaying the action log reproduces the exact state', () => {
    const cfg = simpleConfig('replay-seed');
    const session = new GameSession(cfg);
    playSome(session, 120);
    const { state, errors } = replay(cfg, session.actions);
    expect(errors).toEqual([]);
    expect(JSON.stringify(state)).toBe(JSON.stringify(session.state));
  });

  it('save/load via JSON round-trips', () => {
    const session = new GameSession(simpleConfig('json-seed'));
    playSome(session, 50);
    const loaded = GameSession.fromJSON(JSON.parse(JSON.stringify(session.toJSON())));
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(session.state));
  });

  it('undo rolls back to the previous state', () => {
    const session = new GameSession(simpleConfig('undo-seed'));
    playSome(session, 10);
    const before = JSON.stringify(session.state);
    playSome(session, 5);
    expect(session.undo(5)).toBe(true);
    expect(JSON.stringify(session.state)).toBe(before);
  });

  it('states are never mutated by applyAction', () => {
    const session = new GameSession(simpleConfig('immut'));
    playSome(session, 3);
    const s = session.state;
    const snapshot = JSON.stringify(s);
    playSome(session, 20);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('hidden information (CR 400.2)', () => {
  it('hides the opponent hand, all libraries, the RNG and private log text', () => {
    const session = new GameSession({ ...simpleConfig('hidden'), options: { startingPlayer: 'p1' } });
    playSome(session, 2);
    const s = session.state;
    const v = viewFor(s, 'p1');
    for (const id of s.zones.hand.p1!) expect(v.objects[id]!.defId).not.toBe(HIDDEN_DEF);
    expect(v.zones.hand.p2).toHaveLength(s.zones.hand.p2!.length);
    for (const id of v.zones.hand.p2!) expect(v.objects[id]!.defId).toBe(HIDDEN_DEF); // m4: under the view's aliases
    for (const id of s.zones.library.p1!) expect(v.objects[id]!.defId).toBe(HIDDEN_DEF);
    expect('rng' in v).toBe(false);
    expect('suspended' in v).toBe(false);
    expect(JSON.stringify(v.log)).not.toMatch(/Bob draws (Forest|Test Bear)/);
    const v2 = viewFor(s, 'p2');
    expect(v2.objects[v2.zones.hand.p1![0]!]!.defId).toBe(HIDDEN_DEF);
    expect(v2.objects[s.zones.hand.p1![0]!]).toBeUndefined(); // m4: the real id is not in the view
  });
});
