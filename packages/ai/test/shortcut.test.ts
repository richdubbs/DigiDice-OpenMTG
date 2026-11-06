/**
 * Shortcuts (engine docs/design/shortcuts.md 6; CR 727.2b, cited from memory, unverified): the computer answers another player's proposed shortcut by letting
 * it run, unless it has a play it would make right now (the same scoring as its priority decision, over the actions it would have with priority): then it
 * takes priority at pass 1 after the proposer's last step.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, viewFor, type Action, type GameState, type OracleCard } from '@openmtg/engine';
import { act, answer, find, scenario, type Zones } from '../../engine/test/m3/scenario';
import { chooseAction } from '../src/index';

const FOUNTAIN = compileCard({ name: 'Life Fountain', layout: 'normal', mana_cost: '{1}', type_line: 'Artifact', oracle_text: '{0}: You gain 1 life.' } as OracleCard);

/**
 * Alice (p1) activates Life Fountain, passes, Bob passes and it resolves; then she proposes to repeat those two steps 20 times. Bob has `p2`; both start at
 * `life`.
 */
function proposed(p2: Zones, life = 20): GameState {
  let s = scenario(['Shock', 'Mountain', 'Grizzly Bears'], { defs: [FOUNTAIN], p1: { battlefield: ['Life Fountain'] }, p2, life });
  const source = find(s, 'Life Fountain', 'battlefield', 'p1');
  s = act(s, legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === source)!.action);
  while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
  s = act(s, { type: 'pass', player: 'p1' });
  s = act(s, { type: 'pass', player: 'p2' });
  expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
  s = act(s, { type: 'shortcut', player: 'p1', steps: 2, times: 20 });
  expect(s.pending).toMatchObject({ kind: 'shortcut', player: 'p2', proposer: 'p1', times: 20 });
  return s;
}

const bot = (s: GameState): Action => {
  const v = viewFor(s, s.pending!.player);
  return chooseAction(v, v.pending!, 'shortcut');
};

describe('the computer answers a proposed shortcut (CR 727.2b)', () => {
  it('with nothing it would do (a creature card, an untapped Mountain), it lets the shortcut run, and the engine plays every pass', () => {
    const s = proposed({ hand: ['Grizzly Bears'], battlefield: ['Mountain'] });
    const a = bot(s);
    expect(a).toMatchObject({ type: 'answer', player: 'p2', answer: { kind: 'shortcut' } });
    expect((a as Extract<Action, { type: 'answer' }>).answer).not.toHaveProperty('stop');
    const r = applyAction(s, a);
    expect(r.error).toBeUndefined();
    expect(r.state.players[0]!.life).toBe(20 + 1 + 20);
  });

  it('with a Shock it would cast now (lethal: Alice is at 2) and an untapped Mountain, it stops at pass 1 after the last step and gets priority', () => {
    const s = proposed({ hand: ['Shock'], battlefield: ['Mountain'] }, 1);
    expect(s.players[0]!.life).toBe(2);
    const a = bot(s);
    expect(a).toMatchObject({ type: 'answer', player: 'p2', answer: { kind: 'shortcut', stop: { pass: 1, step: 2 } } });
    const r = applyAction(s, a);
    expect(r.error).toBeUndefined();
    expect(r.state.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    // the first time Bob would get priority at or after step 2 of pass 1 (Alice's pass, the Fountain's ability on the stack): not twenty passes
    expect(r.state.zones.stack).toHaveLength(1);
    expect(r.state.players[0]!.life).toBe(2);
    expect(bot(r.state)).toMatchObject({ type: 'cast' }); // it plays
  });
});
