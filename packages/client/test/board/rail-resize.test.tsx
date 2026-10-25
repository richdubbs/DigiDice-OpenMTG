/**
 * The right rail sized by the player (board/RailResize.tsx, Settings.railWidth and railPromptShare): its left edge and the edge above the prompt are
 * separators that change the stored size with the arrow keys, give back the default with Home or a double click, and the board draws the stored size.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GameBoard } from '../../src/board';
import { RAIL_SHARE_MAX, RAIL_WIDTH_MIN, SettingsStore, resetSettingsStoreForTests, sanitizeSettings, settingsStore } from '../../src/settings/settings';
import { memoryStorage } from '../game-fixtures';
import { ALICE, playGame } from './fixtures';

const game = playGame(2);
const view = () => game.captured.find((c) => c.view.viewer === ALICE)!.view;
const board = (container: HTMLElement) => container.querySelector<HTMLElement>('.game-board')!;

afterEach(() => resetSettingsStoreForTests());

describe('the player sizes the right rail', () => {
  it('stored sizes are kept to their ranges; anything else is the default', () => {
    expect(sanitizeSettings({ railWidth: 10, railPromptShare: 5 })).toMatchObject({ railWidth: RAIL_WIDTH_MIN, railPromptShare: RAIL_SHARE_MAX });
    expect(sanitizeSettings({ railWidth: 'wide', railPromptShare: Number.NaN })).toMatchObject({ railWidth: null, railPromptShare: null });
    expect(sanitizeSettings({})).toMatchObject({ railWidth: null, railPromptShare: null });
  });

  it('the left edge: arrow keys widen and narrow the rail, Home gives back the default; the board draws the stored width', () => {
    resetSettingsStoreForTests(new SettingsStore(memoryStorage()));
    settingsStore().update({ railWidth: 400 });
    const { container } = render(<GameBoard view={view()} />);
    expect(board(container).style.getPropertyValue('--rail-w')).toBe('min(400px, 60vw)');
    const edge = screen.getByRole('separator', { name: /Resize the side panel/ });
    fireEvent.keyDown(edge, { key: 'ArrowLeft' });
    expect(settingsStore().get().railWidth).toBe(416);
    fireEvent.keyDown(edge, { key: 'ArrowRight' });
    fireEvent.keyDown(edge, { key: 'ArrowRight' });
    expect(settingsStore().get().railWidth).toBe(384);
    fireEvent.keyDown(edge, { key: 'Home' });
    expect(settingsStore().get().railWidth).toBeNull();
    expect(board(container).style.getPropertyValue('--rail-w')).toBe('');
  });

  it('the edge above the prompt: up gives the bottom pane more of the rail, a double click gives back half each', () => {
    resetSettingsStoreForTests(new SettingsStore(memoryStorage()));
    settingsStore().update({ railPromptShare: 0.5 });
    const { container } = render(<GameBoard view={view()} />);
    const edge = screen.getByRole('separator', { name: /Resize the bottom panel/ });
    // between the turn structure and the prompt
    expect(edge.previousElementSibling?.classList.contains('phase-bar')).toBe(true);
    expect(edge.nextElementSibling?.classList.contains('board-prompt')).toBe(true);
    fireEvent.keyDown(edge, { key: 'ArrowUp' });
    expect(settingsStore().get().railPromptShare).toBe(0.55);
    expect(board(container).style.getPropertyValue('--rail-prompt-grow')).toBe('0.55');
    expect(Number(board(container).style.getPropertyValue('--rail-top-grow'))).toBeCloseTo(0.45);
    fireEvent.doubleClick(edge);
    expect(settingsStore().get().railPromptShare).toBeNull();
  });
});
