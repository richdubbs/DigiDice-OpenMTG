/**
 * The own hand's order: any card can be dragged along the hand to a new place; the order is the player's own (CR 402 gives a hand
 * no order, nothing is sent to the game) and a newly drawn card joins at the right.
 */
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameBoard } from '../../src/board';
import { arrangeHand, moveInHand } from '../../src/board/Hand';
import { ALICE, editable, playGame } from './fixtures';

const game = playGame(3);
const main = () => game.captured.find((x) => x.turn === 3 && x.step === 'main1' && x.view.viewer === ALICE)!;

describe('the own hand order', () => {
  it('arrangeHand keeps the saved order of the cards still in hand and puts new cards at the right, in the view order', () => {
    expect(arrangeHand(undefined, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(arrangeHand(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    expect(arrangeHand(['c', 'x', 'a'], ['a', 'b', 'c', 'd'])).toEqual(['c', 'a', 'b', 'd']);
  });

  it('moveInHand puts a card at an index of the hand without it', () => {
    expect(moveInHand(['a', 'b', 'c', 'd'], 'a', 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveInHand(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveInHand(['a', 'b', 'c', 'd'], 'b', 2)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('a card dragged along the hand (below the play line) is set down at its new place, and the board keeps that order for the next view', () => {
    const c = main();
    const view = editable(c.view);
    const { container, rerender } = render(<GameBoard view={view} />);
    const order = () => [...container.querySelectorAll('.hand-own > .hand-card [data-object-id]')].map((e) => e.getAttribute('data-object-id'));
    const before = order();
    expect(before.length).toBeGreaterThan(2);
    const first = container.querySelector<HTMLElement>('.hand-own > .hand-card .board-card')!;
    // jsdom has no PointerEvent: mouse events under the pointer events' names (no pointerId, the same on every one).
    const at = (x: number, y: number) => ({ bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y });
    act(() => {
      first.dispatchEvent(new MouseEvent('pointerdown', at(0, 10)));
      window.dispatchEvent(new MouseEvent('pointermove', at(400, 10)));
      window.dispatchEvent(new MouseEvent('pointerup', at(400, 10)));
    });
    // jsdom measures every card at x 0: past all of them, the first card goes to the right end.
    expect(order()).toEqual([...before.slice(1), before[0]]);
    rerender(<GameBoard view={editable(c.view)} />);
    expect(order()).toEqual([...before.slice(1), before[0]]);
  });
});
