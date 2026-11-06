/**
 * Shortcuts (engine docs/design/shortcuts.md 6; CR 727.2a, cited from memory, unverified): the hosted table lets a `shortcut` proposal through to the engine
 * only from the player who holds priority; its shape is net's `checkAction` (the engine's action shape: whole numbers within the caps).
 */
import { describe, expect, it } from 'vitest';
import { SHORTCUT_MAX_STEPS, SHORTCUT_MAX_TIMES } from '@openmtg/engine';
import { scenario } from '../../../engine/test/m3/scenario';
import { actionLegalityProblem, actionShapeProblem } from '../../src/table/check';

describe('shortcuts: the hosted table\'s checks', () => {
  const s = scenario([]);
  const proposal = (player: string, steps = 2, times = 10) => ({ type: 'shortcut' as const, player, steps, times });

  it('the player with priority may propose (the engine decides the rest); another player, a pending decision or a finished game may not', () => {
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(actionLegalityProblem(s, 'p1', proposal('p1'))).toBeNull();
    expect(actionLegalityProblem(s, 'p2', proposal('p2'))).toMatchObject({ code: 'stale' });
    expect(actionLegalityProblem(s, 'p2', proposal('p1'))).toMatchObject({ code: 'notYourPlayer' });
    const asked = { ...s, pending: { kind: 'yesNo', id: 'd-x', player: 'p1', prompt: '?' } } as unknown as typeof s;
    expect(actionLegalityProblem(asked, 'p1', proposal('p1'))).toMatchObject({ code: 'stale', rules: ['CR 117.1'] });
    const over = { ...s, result: { winner: 'p2', reason: 'test' } } as unknown as typeof s;
    expect(actionLegalityProblem(over, 'p1', proposal('p1'))).toMatchObject({ code: 'illegalAction' });
  });

  it('the shape: steps and times are whole numbers within the caps', () => {
    expect(actionShapeProblem(proposal('p1', 1, 1))).toBeNull();
    expect(actionShapeProblem(proposal('p1', SHORTCUT_MAX_STEPS, SHORTCUT_MAX_TIMES))).toBeNull();
    for (const [steps, times] of [[0, 10], [SHORTCUT_MAX_STEPS + 1, 10], [2, 0], [2, SHORTCUT_MAX_TIMES + 1], [2, 2.5]] as const) {
      expect(actionShapeProblem(proposal('p1', steps, times)), `${steps} x ${times}`).toMatchObject({ code: 'badMessage' });
    }
  });
});
