/**
 * M11-2 (docs/design/m11-commander.md 4.3, 5.3): the 903.9 prompt names the commander and the rule, shows its card on the board's stage, and answers
 * `commanderZone` with either choice.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CommanderZoneDecision, DecisionAnswer, GameState, MulliganDecision } from '@openmtg/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameBoard } from '../../src/board';
import { CommanderZonePrompt, commanderName, commanderZoneQuestion } from '../../src/prompts/CommanderPrompts';
import { MulliganPrompt } from '../../src/prompts/SimplePrompts';
import { commanderId, commanderState, view } from './fixtures';

afterEach(cleanup);

function decision(s: GameState, over: Partial<CommanderZoneDecision>): CommanderZoneDecision {
  const titania = commanderId(s, 'Test Titania');
  return {
    kind: 'commanderZone', id: 'd-cz', player: 'p1', prompt: 'Put Test Titania into the command zone?', rules: ['CR 903.9b'],
    object: titania, card: s.objects[titania]!.cardId!, rule: '903.9b', zone: 'hand', ...over,
  } as CommanderZoneDecision;
}

function show(s: GameState, d: CommanderZoneDecision) {
  const answer = vi.fn<(a: DecisionAnswer) => void>();
  const v = view(s, 'p1');
  render(<GameBoard view={v} prompt={<CommanderZonePrompt d={d} view={v} legal={[]} answer={answer} act={vi.fn()} busy={false} />} />);
  return answer;
}

describe('M11-2: the 903.9 prompt', () => {
  it('CR 903.9b: names the commander and the replacement; its card on the stage; the main button puts it into the command zone', () => {
    const s = commanderState();
    const d = decision(s, {});
    const answer = show(s, d);
    const stage = screen.getByRole('region', { name: 'Test Titania: to the command zone?' });
    expect(within(stage).getByText('Test Titania would be put into your hand. You may put it into the command zone instead (CR 903.9b).')).toBeTruthy();
    expect(stage.querySelector('[data-stage-id]')).not.toBeNull(); // the commander's card, drawn by the board's card renderer
    fireEvent.click(screen.getByRole('button', { name: 'Put Test Titania into the command zone' }));
    expect(answer).toHaveBeenLastCalledWith({ kind: 'commanderZone', command: true });
    fireEvent.click(screen.getByRole('button', { name: 'Put Test Titania into your hand' }));
    expect(answer).toHaveBeenLastCalledWith({ kind: 'commanderZone', command: false });
  });

  it('CR 903.9a, 704.6d: after it died or was exiled, "leave it there" is the other choice', () => {
    const s = commanderState();
    expect(commanderZoneQuestion({ rule: '903.9a', zone: 'graveyard' }, 'Test Titania')).toBe(
      'Test Titania was put into your graveyard. You may put it into the command zone (CR 903.9a, 704.6d).',
    );
    const answer = show(s, decision(s, { rule: '903.9a', zone: 'exile' }));
    // In the rail and as the stage's subtitle.
    expect(screen.getAllByText('Test Titania was put into exile. You may put it into the command zone (CR 903.9a, 704.6d).').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Leave Test Titania in exile' }));
    expect(answer).toHaveBeenLastCalledWith({ kind: 'commanderZone', command: false });
  });

  it('CR 903.6: the owner always knows their commander: named from its definition when the object is out of sight', () => {
    const s = commanderState();
    const d = decision(s, {});
    const v = view(s, 'p1');
    expect(commanderName(v, 'no-such-object', d.card)).toBe('Test Titania');
    expect(commanderName(v, d.object, d.card)).toBe('Test Titania');
  });
});

describe('M11-2: the mulligan in Brawl (CR 903.12g)', () => {
  const mulligan = (variant: 'brawl' | 'commander', mulligans: number, handSize: number) => {
    const s = commanderState(variant);
    const v = view(s, 'p1');
    const d = { kind: 'mulligan', id: 'd-m', player: 'p1', prompt: '', rules: ['CR 103.5'], mulligans, handSize } as MulliganDecision;
    render(<GameBoard view={v} prompt={<MulliganPrompt d={d} view={v} legal={[]} answer={vi.fn()} act={vi.fn()} busy={false} />} />);
  };

  it('the first mulligan is free: nothing goes on the bottom; the second puts one card there', () => {
    mulligan('brawl', 0, 7);
    expect(document.querySelector('.prompt-mulligan-hint')!.textContent).toBe(
      'Your first mulligan is free: it draws a new hand and puts nothing on the bottom of your library (CR 903.12g).',
    );
    cleanup();
    mulligan('brawl', 1, 6);
    expect(document.querySelector('.prompt-mulligan-hint')!.textContent).toMatch(/put 1 card from it on the bottom/);
    expect(screen.getByText(/You took 1 mulligan; 0 cards are already on the bottom of your library\./)).toBeTruthy();
  });

  it('a Commander game has no free mulligan (CR 103.5c names multiplayer games only)', () => {
    mulligan('commander', 0, 6);
    expect(document.querySelector('.prompt-mulligan-hint')!.textContent).toMatch(/put 1 card from it on the bottom/);
  });
});

