/** The prompt bar around the prompts: hot-seat hand-off and waiting, game over, the exhaustive prompt table, the board selection bridge. */
import { act as reactAct, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createGame, viewFor, type Decision, type DecisionAnswer } from '@openmtg/engine';
import type { GameConnection } from '../../src/connection/GameConnection';
import { describe, expect, it, vi } from 'vitest';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { DecisionPrompt, PROMPTS } from '../../src/prompts/DecisionPrompt';
import { PromptBar } from '../../src/prompts/PromptBar';
import { useBoardInteraction } from '../../src/game/interaction';
import * as prompts from '../../src/prompts';
import { SelectionStore } from '../../src/prompts/selection';
import { smallConfig } from '../helpers';
import { pass, renderPrompt, scenario, tweak } from './harness';

describe('PromptBar', () => {
  it('hot-seat: while a hand-off is pending nothing of the decision is shown; after it, the acting player gets the prompt', async () => {
    const conn = new LocalConnection(smallConfig('bar-handoff'));
    render(<PromptBar connection={conn} />);
    const first = conn.handoff()!;
    const name = conn.view().players.find((p) => p.id === first)!.name;
    expect(screen.getByText(`Pass the screen to ${name}.`)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    await reactAct(async () => conn.acceptHandoff());
    expect(screen.getByRole('button', { name: 'I play first' })).toBeTruthy();
  });

  it('shows "Waiting for" when the decision belongs to a player who is not on screen (a remote opponent, docs/design/online.md)', () => {
    const s = pass(scenario([])); // Alice passed: Bob has priority
    const view = viewFor(s, 'p1');
    const none: never[] = []; // stable between calls, as the GameConnection contract requires
    const conn: GameConnection = {
      kind: 'remote', view: () => view, legalActions: () => none, act: async () => ({ ok: true }), subscribe: () => () => {}, canUndo: () => false, undo: () => false,
      handoff: () => null, acceptHandoff: () => {},
    };
    render(<PromptBar connection={conn} />);
    expect(screen.getByText('Waiting for Bob.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('CR 104: when the game is over, no prompt is shown', () => {
    const s = tweak(scenario([]), (t) => {
      t.result = { winners: ['p1'], reason: 'test' } as never;
      t.pending = null;
    });
    renderPrompt(s);
    expect(screen.getByText('The game is over.')).toBeTruthy();
  });

  it('has one prompt component for every decision kind of the engine', () => {
    expect(Object.keys(PROMPTS).sort()).toEqual([
      'assignDamage', 'chooseColor', 'chooseDivision', 'chooseName', 'chooseNumber', 'chooseObjects', 'chooseOption', 'chooseReplacement', 'chooseTargets', 'commanderZone',
      'declareAttackers', 'declareBlockers', 'manualResolve', 'mulligan', 'order', 'payCost', 'playFirst', 'priority', 'yesNo',
    ]);
  });
});

describe('chooseOption with repeats (CR 700.2d: a mode may be chosen more than once)', () => {
  it('counts each choice and answers with the id repeated', () => {
    const view = createGameView();
    const d: Decision = { kind: 'chooseOption', id: 'd1', player: 'p1', prompt: 'Choose up to three.', min: 1, max: 3, allowRepeat: true, options: [{ id: 'a', label: 'Mode A' }, { id: 'b', label: 'Mode B' }] };
    const answer = vi.fn<(a: DecisionAnswer) => void>();
    render(<DecisionPrompt d={d} view={view} legal={[]} answer={answer} act={() => {}} busy={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Mode B/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Mode B/ })); // a fourth choice is over the maximum: ignored
    fireEvent.click(screen.getByRole('button', { name: 'One less: Mode A' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(answer).toHaveBeenCalledWith({ kind: 'chooseOption', ids: ['a', 'b'] });
  });
});

describe('SelectionStore (the board bridge)', () => {
  it('notifies only when what the board draws changes, always uses the latest click handler, and ignores clicks on ids that are not selectable', () => {
    const store = new SelectionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const first = vi.fn();
    const second = vi.fn();
    store.publish({ selectable: ['o1'], click: first });
    store.publish({ selectable: ['o1'], click: second });
    expect(listener).toHaveBeenCalledTimes(1);
    store.click('o1');
    store.click('o2');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith('o1');
    store.publish(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.snapshot().selectable.size).toBe(0);
  });

  it('one selection store, one board adapter: the prompts export no board adapter of their own (the game screen uses game/interaction.ts)', () => {
    expect(Object.keys(prompts)).not.toContain('useBoardInteraction');
    expect(Object.keys(prompts)).not.toContain('toBoardInteraction');
    expect(Object.keys(prompts)).not.toContain('usePromptSelection');
  });

  it("the game's board adapter: the store in the shape of C4's BoardInteraction (selectable, selected, marks, onObjectClick, onPlayerClick)", () => {
    const store = new SelectionStore();
    const click = vi.fn();
    store.publish({ selectable: ['o1', 'p2'], selected: ['o1'], marks: { o1: 'attacking Bob' }, click });
    const b = renderHook(() => useBoardInteraction(new LocalConnection(smallConfig('bar-adapter')), store)).result.current;
    expect(b).toMatchObject({ selectable: ['o1', 'p2'], selected: ['o1'], marks: { o1: 'attacking Bob' } });
    b.onObjectClick('o1');
    b.onPlayerClick('p2');
    b.onObjectClick('o9'); // not selectable: ignored
    expect(click.mock.calls).toEqual([['o1'], ['p2']]);
  });
});

function createGameView() {
  return viewFor(createGame(smallConfig('bar-view')), 'p1');
}
