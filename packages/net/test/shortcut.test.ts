/**
 * Shortcuts (engine docs/design/shortcuts.md 6; CR 727, cited from memory, unverified): a guest's proposal and its answer to another player's proposal
 * pass the host's message check (net's `checkAction` is the engine's action shape), out-of-range proposals are refused there, and the automatic player
 * lets another player's shortcut run.
 */
import { describe, expect, it } from 'vitest';
import { SHORTCUT_MAX_STEPS, SHORTCUT_MAX_TIMES, type Decision } from '@openmtg/engine';
import { autoAction, autoAnswer } from '../src/game/autoplay';
import { parseGuestMessage, PROTOCOL_VERSION } from '../src/protocol/messages';

const message = (action: unknown) => ({ v: PROTOCOL_VERSION, type: 'action', id: 1, seq: 0, action });

describe('shortcuts over the network', () => {
  it('a guest may propose a shortcut and answer one (with or without a stop point)', () => {
    for (const action of [
      { type: 'shortcut', player: 'p2', steps: 2, times: 100 },
      { type: 'shortcut', player: 'p2', steps: SHORTCUT_MAX_STEPS, times: SHORTCUT_MAX_TIMES },
      { type: 'answer', player: 'p2', decisionId: 'd7', answer: { kind: 'shortcut' } },
      { type: 'answer', player: 'p2', decisionId: 'd7', answer: { kind: 'shortcut', stop: { pass: 3, step: 1 } } },
    ]) {
      expect(parseGuestMessage(message(action)), JSON.stringify(action)).toMatchObject({ ok: true, message: { action } });
    }
  });

  it('a proposal out of range or with a field too many is refused before the engine sees it', () => {
    for (const action of [
      { type: 'shortcut', player: 'p2', steps: 0, times: 10 },
      { type: 'shortcut', player: 'p2', steps: 2, times: SHORTCUT_MAX_TIMES + 1 },
      { type: 'shortcut', player: 'p2', steps: 1.5, times: 10 },
      { type: 'shortcut', player: 'p2', steps: 2, times: 10, extra: true },
    ]) {
      expect(parseGuestMessage(message(action)), JSON.stringify(action)).toMatchObject({ ok: false });
    }
  });

  it('the automatic player lets another player\'s shortcut run (CR 727.2b)', () => {
    const d: Decision = { kind: 'shortcut', id: 'd7', player: 'p2', prompt: 'Let it run?', proposer: 'p1', times: 10, steps: ['Pass priority'] };
    expect(autoAnswer(d, 'p2')).toEqual({ kind: 'shortcut' });
    const view = { pending: d, result: null } as unknown as Parameters<typeof autoAction>[0];
    expect(autoAction(view, [], 'p2')).toEqual({ type: 'answer', player: 'p2', decisionId: 'd7', answer: { kind: 'shortcut' } });
  });
});
