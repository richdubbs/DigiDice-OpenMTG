/**
 * ui/arena perf: the arrow that follows the pointer while the viewer chooses targets is written in the
 * pointer event itself, not on the next animation frame and never through React state; the arrows are not rebuilt when the board draws again for another
 * reason; and the picture of a card is the same object for the same definition however many times the view is copied.
 */
import { act, fireEvent, render } from '@testing-library/react';
import type { GameView } from '@openmtg/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameBoard } from '../../src/board';
import { cardModelOf } from '../../src/cards';
import { ALICE, editable, playGame } from './fixtures';

const game = playGame(6, undefined, (s) => s.zones.stack.length > 0);
const withStack = game.kept.find((c) => c.view.viewer === ALICE && c.view.zones.stack.length > 0)!;

/** The viewer is choosing one more target for the spell on top of the stack (CR 601.2c). */
function choosing(): GameView {
  const view = editable(withStack.view);
  view.pending = { id: 'd-test', kind: 'chooseTargets', player: ALICE, max: 1, min: 1, options: [] } as unknown as NonNullable<GameView['pending']>;
  return view;
}

function pointerArrow(container: HTMLElement): SVGPathElement {
  const el = container.querySelector<SVGPathElement>('.arrow-line.arrow-pointer');
  if (!el) throw new Error('no pointer arrow');
  return el;
}

describe('the arrow that follows the pointer', () => {
  const frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    // Animation frames never come in this test: whatever shows is what the pointer event itself wrote.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    frames.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ends on the pointer in the same event, without waiting for a frame', () => {
    const { container } = render(<GameBoard view={choosing()} interaction={{ selectable: [], selected: [] }} />);
    const root = container.querySelector<HTMLElement>('.game-board')!;
    expect(pointerArrow(container).getAttribute('d') ?? '').toBe('');
    fireEvent.mouseMove(root, { clientX: 321, clientY: 123 });
    expect(pointerArrow(container).getAttribute('d')).toMatch(/ 321\.0,123\.0$/);
    fireEvent.mouseMove(root, { clientX: 322, clientY: 140 });
    expect(pointerArrow(container).getAttribute('d')).toMatch(/ 322\.0,140\.0$/);
  });

  it('is cleared when the pointer leaves the board', () => {
    const { container } = render(<GameBoard view={choosing()} interaction={{ selectable: [], selected: [] }} />);
    const root = container.querySelector<HTMLElement>('.game-board')!;
    fireEvent.mouseMove(root, { clientX: 50, clientY: 60 });
    expect(pointerArrow(container).getAttribute('d') ?? '').not.toBe('');
    fireEvent.mouseLeave(root);
    expect(pointerArrow(container).getAttribute('d') ?? '').toBe('');
  });

  it('is not rebuilt when the board draws again with the same arrows', () => {
    const view = choosing();
    const { container, rerender } = render(<GameBoard view={view} interaction={{ selectable: [], selected: [] }} />);
    const before = pointerArrow(container);
    // A new copy of the same view (every change brings one) and a new interaction object: the same arrows.
    act(() => rerender(<GameBoard view={editable(view)} interaction={{ selectable: [], selected: [] }} />));
    expect(pointerArrow(container)).toBe(before);
  });
});

describe('the picture of a card', () => {
  it('is one model for one definition, however often the view is copied (so its picture is not drawn again)', () => {
    const view = withStack.view;
    const def = Object.values(view.defs)[0]!;
    const copy = structuredClone(def);
    expect(copy).not.toBe(def);
    expect(cardModelOf(copy)).toBe(cardModelOf(def));
  });

  it('is a new model when the definition changed', () => {
    const def = Object.values(withStack.view.defs)[0]!;
    const changed = structuredClone(def);
    changed.faces[0]!.oracleText += ' Changed.';
    expect(cardModelOf(changed)).not.toBe(cardModelOf(def));
  });
});
