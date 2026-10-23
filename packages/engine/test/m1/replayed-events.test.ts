/**
 * Answering a decision re-runs the suspended action from the state it started from (core/apply.ts), so the answer's events begin with the events the
 * run already reported when it stopped. `Suspension.emitted` counts them and `replayedEvents` tells a screen how many it was already given (the bug:
 * every trigger that resolved before the cleanup's discard was animated a second time after it).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, createGame, replayedEvents, type Action, type GameEvent, type GameState } from '../../src/index';

const ringer = compileCard({
  name: 'Bell Ringer', layout: 'normal', mana_cost: '{0}', type_line: 'Artifact Creature — Construct', power: '1', toughness: '1',
  oracle_text: 'At the beginning of your end step, you gain 1 life.',
});
const zap = compileCard({ name: 'Zero Zap', layout: 'normal', mana_cost: '{0}', type_line: 'Instant', oracle_text: 'Zero Zap deals 1 damage to any target.' });
const forest = compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '' });

/** `instants`: the deck has Zero Zaps (with none, the smart auto-pass carries the whole turn through the end step and its trigger in one action). */
function game(handSize: number, instants: boolean): GameState {
  const deck = instants ? [...Array(20).fill(zap.id), ...Array(20).fill(forest.id)] : [...Array(20).fill(ringer.id), ...Array(20).fill(forest.id)];
  return createGame({
    seed: 'replayed-events',
    players: [{ name: 'Alice', deck }, { name: 'Bob', deck }],
    defs: [ringer, zap, forest],
    options: { startingPlayer: 'p1', skipMulligans: true, startingHandSize: handSize },
  });
}

function apply(s: GameState, a: Action): { state: GameState; events: GameEvent[] } {
  const r = applyAction(s, a);
  if (r.error) throw new Error(r.error.message);
  return r;
}

const inHand = (s: GameState, defId: string) => s.zones.hand.p1!.find((id) => s.objects[id]!.defId === defId)!;

describe('replayedEvents: an answer does not give a screen the events it already had', () => {
  it("the end step's trigger, then the cleanup's discard (CR 514.1): the answer's events repeat the trigger, and replayedEvents counts exactly those", () => {
    const s0 = game(10, false);
    let s = apply(s0, { type: 'cast', player: 'p1', card: inHand(s0, ringer.id) }).state;
    let last: GameEvent[] = [];
    for (let i = 0; i < 10 && s.pending?.kind === 'priority'; i++) ({ state: s, events: last } = apply(s, { type: 'pass', player: s.pending.player }));
    const d = s.pending!;
    expect(d.kind).toBe('chooseObjects');
    expect(d.rules).toContain('CR 514.1');
    expect(last.map((e) => e.type)).toContain('abilityTriggered');
    expect(s.suspended!.emitted).toBe(last.length);

    const action: Action = { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseObjects', ids: d.kind === 'chooseObjects' ? d.options.slice(0, d.min) : [] } };
    const r = apply(s, action);
    // the re-run reports the trigger again, first, exactly as before
    expect(r.events.slice(0, last.length)).toEqual(last);
    // a decision nobody can cancel hides nothing: every player was given those events
    expect(replayedEvents(s, action, 'p1')).toBe(last.length);
    expect(replayedEvents(s, action, 'p2')).toBe(last.length);
    expect(replayedEvents(s, action, null)).toBe(last.length);
    const fresh = r.events.slice(last.length);
    expect(fresh.filter((e) => e.type === 'abilityTriggered')).toEqual([]);
    expect(fresh.map((e) => e.type)).toContain('turnBegan');
  });

  it("another player's cancellable action in progress was hidden (CR 733.1): they get its events in full", () => {
    const s0 = game(7, true);
    const cast: Action = { type: 'cast', player: 'p1', card: inHand(s0, zap.id) };
    const { state: s, events: before } = apply(s0, cast);
    const d = s.pending!;
    expect(d.kind).toBe('chooseTargets');
    expect(d.cancellable).toBe(true);
    const action: Action = { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } };
    const r = apply(s, action);
    expect(r.events.slice(0, before.length)).toEqual(before);
    expect(replayedEvents(s, action, 'p1')).toBe(before.length);
    expect(replayedEvents(s, action, 'p2')).toBe(0);
    expect(replayedEvents(s, action, null)).toBe(0);
  });

  it('nothing else is a replay: a new action, or an answer without a known count', () => {
    const s0 = game(7, true);
    expect(replayedEvents(s0, { type: 'pass', player: 'p1' }, 'p1')).toBe(0);
    const s = apply(s0, { type: 'cast', player: 'p1', card: inHand(s0, zap.id) }).state;
    const d = s.pending!;
    const { emitted: _emitted, ...unknown } = s.suspended!;
    const action: Action = { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } };
    expect(replayedEvents({ ...s, suspended: unknown }, action, 'p1')).toBe(0);
    expect(replayedEvents(s, { type: 'cancel', player: 'p1' }, 'p1')).toBe(0);
  });
});
