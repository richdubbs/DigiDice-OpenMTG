/**
 * FAST2 MRE: the computer never uses the by-hand tools for manual triggered and static abilities (engine `manualTrigger` / `manualStatic`, C6 gap 7) and
 * finishes every manual resolution in one answer (no `continue`, C6 gap 6), so games against it still end.
 */
import { describe, expect, it } from 'vitest';
import { legalActions, viewFor, type Action, type GameState } from '@openmtg/engine';
import { act, castAuto, scenario } from '../../engine/test/m3/scenario';
import { synth } from '../../engine/test/m3/synthetic';
import { chooseAction, explainPriority } from '../src/index';

const drain = synth({
  name: 'Test Drain Outlaw', cost: '{1}', type: 'Creature — Human', pt: ['2', '2'],
  abilities: [{ kind: 'manual', text: 'When Test Drain Outlaw enters, each opponent loses 2 life.', reason: 'test', shape: 'triggered' }],
});
const anthem = synth({ name: 'Test Odd Anthem', cost: '{2}', type: 'Enchantment', abilities: [{ kind: 'manual', text: 'Creatures you control get +1/+0.', reason: 'test', shape: 'static' }] });
const think = synth({ name: 'Test Manual Draw', cost: '{W}', type: 'Instant', abilities: [{ kind: 'manual', text: 'Draw three cards, then put two back.', reason: 'test', shape: 'spell' }] });

const ai = (s: GameState): Action => {
  const v = viewFor(s, s.pending!.player);
  return chooseAction(v, v.pending!, 'mre');
};

describe('the AI and the by-hand tools (MRE)', () => {
  it('never chooses manualTrigger or manualStatic, though the engine lists them', () => {
    const s = scenario([], { defs: [drain, anthem], p1: { battlefield: ['Test Drain Outlaw', 'Test Odd Anthem'] } });
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'manualTrigger' || a.kind === 'manualStatic')).toHaveLength(2);
    expect(explainPriority(viewFor(s, 'p1'), 'mre')).toEqual([]);
    expect(ai(s)).toEqual({ type: 'pass', player: 'p1' });
  });

  it('answers its own manual resolution once, without "continue", so the spell finishes resolving', () => {
    let s = castAuto(scenario([], { defs: [think], p1: { hand: ['Test Manual Draw'], battlefield: ['Plains'] } }), 'Test Manual Draw');
    while (s.pending?.kind !== 'manualResolve') s = act(s, { type: 'pass', player: s.pending!.player });
    const a = ai(s);
    expect(a.type).toBe('answer');
    expect((a as Extract<Action, { type: 'answer' }>).answer).not.toHaveProperty('continue');
    s = act(s, a);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.stack).toEqual([]);
  });
});
