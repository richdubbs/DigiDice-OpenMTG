/**
 * WP10, design 8.8 and docs/ARCHITECTURE.md "The decision model": a resolution that asks several decisions is re-executed from the settled base state each
 * time one is answered. Re-execution must reach the same point (the same decisions with the same ids) and finish in the same state, whether the answers come
 * one at a time or all at once, and the same actions from the same state must give the same game.
 */
import { describe, expect, it } from 'vitest';
import type { Action, DecisionAnswer, EffectStep, GameState } from '../../../src/index';
import { applyAction } from '../../../src/index';
import { run } from '../../../src/core/apply';
import { act, castAuto, find, instant, mark, pass, scenario, withFakes, you } from './helpers';

/** A resolution with five decisions of four kinds, a random choice, a payment and a fake draw. */
const steps: EffectStep[] = [
  { op: 'may', who: you, as: 'm', do: [{ op: 'draw', who: you, count: 1 }] },
  { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Creature'] } }, min: 1, max: 1, as: 'c' },
  { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { zone: 'hand', controller: 'opponent' } }, min: 1, max: 1, random: true, as: 'r' },
  { op: 'chooseValue', who: you, what: 'color', as: 'col' },
  { op: 'pay', who: { ref: 'anOpponent' }, cost: { mana: [{ kind: 'generic', amount: 1 }] }, else: [mark('not paid')] },
  { op: 'if', cond: { cond: 'did', step: 'm' }, then: [mark('drew')] },
];

function setup(): GameState {
  const s = scenario(['Grizzly Bears', 'Hill Giant', 'Island'], {
    p1: { hand: ['Test Many Decisions'], battlefield: ['Grizzly Bears'] }, p2: { hand: ['Hill Giant', 'Island'], battlefield: ['Hill Giant', 'Island'] },
    defs: [instant('Test Many Decisions', { steps })],
  });
  return pass(castAuto(s, 'Test Many Decisions')); // p1 passes; p2 holds priority
}

/** The answers, by the kind of decision asked. */
function answerFor(s: GameState): DecisionAnswer {
  const d = s.pending!;
  switch (d.kind) {
    case 'yesNo': return { kind: 'yesNo', yes: d.player === 'p1' }; // p1 draws; p2 declines to pay
    case 'chooseObjects': return { kind: 'chooseObjects', ids: [find(s, 'Hill Giant', 'battlefield')] };
    case 'chooseColor': return { kind: 'chooseColor', color: 'G' };
    case 'manualResolve': return { kind: 'manualResolve', ops: [] };
    default: throw new Error(`unexpected ${d.kind}`);
  }
}

/** Play the resolution answer by answer; returns the states, the actions and the decision ids seen. */
function playOut(start: GameState): { states: GameState[]; actions: Action[]; ids: string[] } {
  let s = act(start, { type: 'pass', player: 'p2' }); // both passed: the spell resolves
  const states = [s];
  const actions: Action[] = [{ type: 'pass', player: 'p2' }];
  const ids: string[] = [];
  while (s.pending && s.pending.kind !== 'priority') {
    ids.push(`${s.pending.id}:${s.pending.kind}:${s.pending.player}`);
    const a: Action = { type: 'answer', player: s.pending.player, decisionId: s.pending.id, answer: answerFor(s) };
    actions.push(a);
    s = act(s, a);
    states.push(s);
  }
  return { states, actions, ids };
}

describe('NeedDecision replay determinism (design 8.8)', () => {
  it('the same resolution asks the same decisions, with the same ids, and ends in the same state', () => withFakes(() => {
    const a = playOut(setup());
    const b = playOut(setup());
    expect(a.ids).toEqual(b.ids);
    expect(a.ids.map((x) => x.split(':').slice(1).join(':'))).toEqual(['yesNo:p1', 'chooseObjects:p1', 'chooseColor:p1', 'yesNo:p2', 'manualResolve:p1', 'manualResolve:p1']);
    expect(a.states.at(-1)).toEqual(b.states.at(-1));
  }));

  it('answering one at a time equals re-executing the action once with every answer (core/apply.ts#run)', () => withFakes(() => {
    const start = setup();
    const { states, actions } = playOut(start);
    const last = states.at(-2)!; // suspended at the last decision
    const answers = [...last.suspended!.answers, (actions.at(-1) as Extract<Action, { type: 'answer' }>).answer];
    const once = run(last.suspended!.base, last.suspended!.action, answers);
    // applyAction counts the answer actions (`actionCount`); everything the resolution did is identical.
    expect({ ...once.state, actionCount: 0 }).toEqual({ ...states.at(-1)!, actionCount: 0 });
  }));

  it('every intermediate state is reproduced by re-execution: each suspended run, replayed, asks the same pending decision', () => withFakes(() => {
    const { states } = playOut(setup());
    for (const s of states.slice(0, -1)) {
      const again = run(s.suspended!.base, s.suspended!.action, s.suspended!.answers);
      expect(again.state.pending).toEqual(s.pending);
      expect(again.state.objects).toEqual(s.objects);
    }
  }));

  it('the random choice is the same card every time it is re-executed (the RNG is in the state)', () => withFakes(() => {
    const start = setup();
    const finals = [playOut(start), playOut(setup())].map((r) => r.states.at(-1)!);
    expect(finals[0]!.rng).toEqual(finals[1]!.rng);
    expect(finals[0]!.rng).not.toEqual(start.rng); // the pick consumed the RNG in the state
    // The card picked, as its owner (who can see it, CR 400.2) reads it in the log: the same card in both games.
    const picked = finals.map((f) => f.log.flatMap((e) => (e.privateText?.players.includes('p2') && e.privateText.text.startsWith('Alice chooses') ? [e.privateText.text] : [])));
    expect(picked[0]).toHaveLength(1);
    expect(picked[0]![0]).toMatch(/^Alice chooses (Hill Giant|Island)\.$/);
    expect(picked[1]).toEqual(picked[0]);
    const r = applyAction(setup(), { type: 'pass', player: 'p2' });
    expect(r.error).toBeUndefined();
  }));
});
