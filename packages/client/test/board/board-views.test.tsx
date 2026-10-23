/**
 * The game board renders real views (`viewFor`) of every step of the turn (CR 500.1) and never shows a hidden card face up (CR 400.2, design "Hot-seat hidden
 * information": an opponent's hand and the libraries are never rendered face up).
 */
import { render, screen, within } from '@testing-library/react';
import { HIDDEN_DEF, STEP_ORDER, viewFor, type GameView, type Step } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { GameBoard } from '../../src/board';
import type { BoardCardProps } from '../../src/board';
import { cardCount } from '../../src/board/model';
import { ALICE, BOB, SECRET, editable, playGame } from './fixtures';

const game = playGame(6);

function viewOfStep(step: Step): GameView {
  const c = game.captured.find((x) => x.step === step);
  if (c) return c.view;
  // Nobody receives priority in the untap and cleanup steps (CR 502.4, 514.3): a view taken there looks like the upkeep view with the step changed.
  const v = editable(game.captured.find((x) => x.step === 'upkeep')!.view);
  v.turn.step = step;
  return v;
}

/** Every element of an object that must stay hidden: none may be face up. */
function expectNeverFaceUp(container: HTMLElement, ids: readonly string[]) {
  for (const id of ids) {
    for (const el of container.querySelectorAll(`[data-object-id="${id}"]`)) expect(el.getAttribute('data-face'), `object ${id}`).toBe('down');
  }
}

describe('CR 500.1: the board renders a view of each step of the turn', () => {
  for (const step of STEP_ORDER) {
    it(`step ${step}: the phase bar marks it current and both players are on the table`, () => {
      const view = viewOfStep(step);
      const { container } = render(<GameBoard view={view} />);
      const current = container.querySelector('[aria-current="step"]');
      expect(current?.getAttribute('data-step')).toBe(step);
      expect(container.querySelectorAll('.phase-step')).toHaveLength(STEP_ORDER.length);
      expect(screen.getByRole('region', { name: /^Alice( \(you\))?$/ })).toBeTruthy();
      expect(screen.getByRole('region', { name: /^Bob( \(you\))?$/ })).toBeTruthy();
      expect(container.querySelector('.phase-turn')?.textContent).toBe(`Turn ${view.turn.number}: ${view.turn.activePlayer === ALICE ? 'Alice' : 'Bob'}`);
      expect(screen.getByRole('button', { name: /^Log/ })).toBeTruthy();
      expect(screen.getByRole('region', { name: /^Stack/ })).toBeTruthy();
    });
  }

  it('the viewer sits at the bottom and the opponent at the top', () => {
    const alice = game.captured.find((c) => c.view.viewer === ALICE)!.view;
    const bob = game.captured.find((c) => c.view.viewer === BOB)!.view;
    const a = render(<GameBoard view={alice} />);
    expect(a.container.querySelector('.side-bottom')?.getAttribute('data-player-id')).toBe(ALICE);
    expect(a.container.querySelector('.side-top')?.getAttribute('data-player-id')).toBe(BOB);
    a.unmount();
    const b = render(<GameBoard view={bob} />);
    expect(b.container.querySelector('.side-bottom')?.getAttribute('data-player-id')).toBe(BOB);
    expect(b.container.querySelector('.side-top')?.getAttribute('data-player-id')).toBe(ALICE);
  });

  it('the viewer\'s own hand is fanned face up with every card', () => {
    const c = game.captured.find((x) => x.view.viewer === ALICE && x.step === 'main1')!;
    render(<GameBoard view={c.view} />);
    const hand = screen.getByRole('region', { name: /^Alice's hand/ });
    const ids = c.state.zones.hand[ALICE]!;
    expect(hand.querySelectorAll('.hand-card')).toHaveLength(ids.length);
    for (const id of ids) expect(hand.querySelector(`[data-object-id="${id}"]`)?.getAttribute('data-face')).toBe('up');
  });
});

describe('CR 400.2: hidden cards are never face up', () => {
  it('in every captured view, the opponent\'s hand and every library are drawn as card backs, with counts', () => {
    for (const c of game.captured) {
      const viewer = c.view.viewer!;
      const other = viewer === ALICE ? BOB : ALICE;
      const { container, unmount } = render(<GameBoard view={c.view} />);
      expectNeverFaceUp(container, [...c.state.zones.hand[other]!, ...c.state.zones.library[ALICE]!, ...c.state.zones.library[BOB]!]);
      const hidden = within(container).getByRole('region', { name: new RegExp(`^${other === ALICE ? 'Alice' : 'Bob'}'s hand: \\d+ cards?`) });
      expect(hidden.querySelectorAll('.board-card-back').length).toBe(Math.min(10, c.state.zones.hand[other]!.length));
      expect(within(container).getAllByLabelText(`Library: ${cardCount(c.state.zones.library[other]!.length)}`).length).toBeGreaterThan(0);
      unmount();
    }
  }, 30_000); // renders the whole board once per captured view: slow on a loaded machine

  it('a card only the opponent holds (Secret Sphinx) is never named or drawn on Alice\'s screen', () => {
    const withSecret = game.captured.filter((c) => c.view.viewer === ALICE && c.state.zones.hand[BOB]!.some((id) => c.state.defs[c.state.objects[id]!.defId]!.name === SECRET));
    expect(withSecret.length).toBeGreaterThan(0); // the fixture deals Bob a Sphinx
    for (const c of withSecret) {
      const drawn: BoardCardProps[] = [];
      const { container, unmount } = render(<GameBoard view={c.view} renderCard={(p) => { drawn.push(p); return <span>{p.def?.name ?? 'back'}</span>; }} />);
      expect(container.textContent).not.toContain(SECRET);
      expect(drawn.some((p) => p.def?.name === SECRET)).toBe(false);
      unmount();
    }
  });

  it('an opponent\'s hand stays face down even when the view carries the cards (revealed to the viewer)', () => {
    const c = game.captured.find((x) => x.view.viewer === ALICE && x.step === 'main1')!;
    const v = editable(c.view);
    for (const id of c.state.zones.hand[BOB]!) {
      const real = c.state.objects[id]!;
      v.objects[id] = { ...structuredClone(real), revealedTo: [ALICE] };
      v.defs[real.defId] = c.state.defs[real.defId]!;
    }
    const { container } = render(<GameBoard view={v} />);
    expectNeverFaceUp(container, c.state.zones.hand[BOB]!);
    expect(container.textContent).not.toContain(SECRET);
  });

  it('a spectator view (hot-seat hand-off) shows both hands as backs and no stops', () => {
    const c = game.captured.find((x) => x.step === 'main1')!;
    const v = viewFor(c.state, null);
    const { container } = render(<GameBoard view={v} />);
    expectNeverFaceUp(container, [...c.state.zones.hand[ALICE]!, ...c.state.zones.hand[BOB]!]);
    expect(container.querySelectorAll('.hand-own')).toHaveLength(0);
    expect(screen.queryByRole('group', { name: /^Stops/ })).toBeNull();
  });

  it('a face-down permanent of the opponent is drawn as a back', () => {
    const c = game.captured.find((x) => x.view.viewer === ALICE && x.turn === 5 && x.step === 'main1')!;
    const v = editable(c.view);
    const bobBear = v.zones.battlefield.find((id) => v.objects[id]!.controller === BOB && v.defs[v.objects[id]!.defId]?.name === 'Test Bear')!;
    v.objects[bobBear] = { ...v.objects[bobBear]!, defId: HIDDEN_DEF, faceDown: true };
    const { container } = render(<GameBoard view={v} />);
    expect(container.querySelector(`[data-object-id="${bobBear}"]`)?.getAttribute('data-face')).toBe('down');
    expect(within(container.querySelector(`[data-object-id="${bobBear}"]`) as HTMLElement).getByText('Face down')).toBeTruthy();
  });
});
