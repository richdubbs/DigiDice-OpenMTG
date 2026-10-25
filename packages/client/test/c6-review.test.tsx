/**
 * C6 review fixes on the board with C2's card picture: a flipped flip card turns 180 degrees (CR 710.2), the card zoom follows the pointer and the
 * keyboard but not a mouse click's focus, a battlefield never shrinks below one screen of cards under a tall prompt, a stack entry is the click target
 * when its spell may be chosen (CR 115.1, 601.2c), and nobody is shown as the active player before the play order is chosen (CR 103.1).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { GameSession, viewFor, type GameView, type ObjectId } from '@openmtg/engine';
import { describe, expect, it, vi } from 'vitest';
import { GameBoard } from '../src/board';
import { renderBoardCard } from '../src/game/boardCards';
import { ALICE, boardConfig, editable, playGame } from './board/fixtures';
import { decl } from './board/css';
import { cssOf, declarations } from './css-rules';

const game = playGame(6, undefined, (s) => s.zones.stack.length > 0);

function at(turn: number, step: string, viewer = ALICE): GameView {
  const c = game.captured.find((x) => x.turn === turn && x.step === step && x.view.viewer === viewer);
  if (!c) throw new Error(`no capture at ${turn}:${step}`);
  return c.view;
}

function named(view: GameView, controller: string, name: string): ObjectId[] {
  return view.zones.battlefield.filter((id) => view.objects[id]!.controller === controller && view.defs[view.objects[id]!.defId]?.name === name);
}

function slot(container: HTMLElement, id: ObjectId): HTMLElement {
  const el = container.querySelector<HTMLElement>(`.board-card[data-object-id="${id}"]`);
  if (!el) throw new Error(`no card slot for ${id}`);
  return el;
}

const zoomShown = (container: HTMLElement) => container.querySelector('.zoom:not(.zoom-empty)') !== null;

describe('CR 710.2: a flipped flip card with C2 as the board renderer', () => {
  function flipView() {
    const v = editable(at(5, 'main1'));
    const [bear, other] = named(v, ALICE, 'Test Bear');
    const d = Object.keys(v.defs).find((k) => v.defs[k]!.name === 'Test Bear')!;
    const def = v.defs[d]!;
    v.defs[d] = { ...def, layout: 'flip', faces: [def.faces[0]!, { ...def.faces[0]!, name: 'Flipped Bear' }] };
    v.objects[bear!] = { ...v.objects[bear!]!, flipped: true };
    return { v, flipped: bear!, unflipped: other };
  }

  it('CR 710.2: a flipped flip card is turned 180 degrees on the board (the real renderer), an unflipped one is not', () => {
    const { v, flipped, unflipped } = flipView();
    const { container } = render(<GameBoard view={v} renderCard={renderBoardCard} />);
    const turned = slot(container, flipped).querySelector('.game-card-flipped');
    expect(turned).not.toBeNull();
    expect(turned!.getAttribute('data-flipped')).toBe('true');
    if (unflipped) expect(slot(container, unflipped).querySelector('.game-card-flipped')).toBeNull();
    expect(declarations(cssOf('game/game.css'), '.game-card-flipped').transform).toBe('rotate(180deg)');
  });
});

describe('the card zoom and the mouse', () => {
  it('a mouse click focuses a card without opening the zoom; leaving it with the pointer closes the zoom even while it has focus; the keyboard still opens it', () => {
    const v = at(5, 'main1');
    const [forest] = named(v, ALICE, 'Forest');
    const { container } = render(<GameBoard view={v} />);
    const card = slot(container, forest!);
    fireEvent.mouseDown(card);
    fireEvent.focus(card);
    expect(zoomShown(container)).toBe(false);
    fireEvent.mouseEnter(card);
    expect(zoomShown(container)).toBe(true);
    fireEvent.mouseLeave(card); // still focused
    expect(zoomShown(container)).toBe(false);
    fireEvent.blur(card);
    fireEvent.focus(card); // keyboard focus (Tab): no mouse button pressed
    expect(zoomShown(container)).toBe(true);
  });
});

describe('the board under a tall prompt (1400x900)', () => {
  it('each battlefield keeps room for its rows of cards: the prompt sits in the side rail and scrolls there, never taking the table\'s height', () => {
    // ui/arena: the table and the side rail (stack, log, turn, prompt) side by side; the table never grows past its track.
    expect(decl('.game-board')['grid-template-columns']).toBe('minmax(0, 1fr) var(--rail-w)');
    // Card sizes follow the table's own size (a size container), so both battlefields, both hands and the middle band always fit in it.
    expect(decl('.board-main')['container-type']).toBe('size');
    expect(decl('.arena-stage')['--cw-near']).toMatch(/cqh/);
    expect(decl('.arena-stage')['--cw-far']).toMatch(/cqh/);
    // A tall prompt (pay by hand, blockers, manual resolution, game over) scrolls inside the rail.
    expect(decl('.board-side')['flex-direction']).toBe('column');
    expect(decl('.board-side').overflow).toBe('hidden');
    expect(decl('.board-prompt')['overflow-y']).toBe('auto');
    expect(decl('.board-prompt')['min-height']).toBe('0');
    // The rail never moves: the stack's half and the prompt's half share it (equally until the player sizes the share, RailResize.tsx), the
    // turn structure fixed between them.
    expect(decl('.board-prompt').flex).toBe('var(--rail-prompt-grow, 1) 1 0');
    expect(decl('.rail-top').flex).toBe('var(--rail-top-grow, 1) 1 0');
    // The board fills the game screen's slot below the top bar (100vh would push the prompt below the window).
    expect(decl('.game-board').height).toBe('100%');
  });
});

describe('CR 115.1, 601.2c: choosing a spell on the stack as a target', () => {
  const stackView = () => game.kept.find((x) => x.view.viewer === ALICE)!.view;

  it('the whole stack entry is the click target and carries the highlight; its card is not a second button inside it', () => {
    const v = stackView();
    const top = v.zones.stack[v.zones.stack.length - 1]!;
    const onObjectClick = vi.fn();
    const { container } = render(<GameBoard view={v} interaction={{ selectable: [top], onObjectClick }} />);
    const entry = container.querySelector<HTMLElement>(`li.stack-item[data-stack-id="${top}"]`)!;
    expect(entry.getAttribute('role')).toBe('button');
    expect(entry.getAttribute('aria-pressed')).toBe('false');
    expect(entry.classList.contains('hl-selectable')).toBe(true);
    expect(entry.querySelector('[role="button"]')).toBeNull();
    fireEvent.click(within(entry).getByText(v.defs[v.objects[top]!.defId]!.name, { selector: '.stack-name' }));
    expect(onObjectClick.mock.calls).toEqual([[top]]);
    onObjectClick.mockClear();
    fireEvent.keyDown(entry, { key: 'Enter' });
    expect(onObjectClick.mock.calls).toEqual([[top]]);
  });

  it('a stack entry that may not be chosen is not a button', () => {
    const v = stackView();
    const top = v.zones.stack[v.zones.stack.length - 1]!;
    const { container } = render(<GameBoard view={v} interaction={{ selectable: [], onObjectClick: () => {} }} />);
    expect(container.querySelector(`li.stack-item[data-stack-id="${top}"]`)!.getAttribute('role')).toBeNull();
  });

  it('the selectable entry is scrolled into view when the prompt opens', () => {
    const v = stackView();
    const top = v.zones.stack[v.zones.stack.length - 1]!;
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      render(<GameBoard view={v} interaction={{ selectable: [top], onObjectClick: () => {} }} />);
      expect(scroll).toHaveBeenCalled();
      expect((scroll.mock.contexts[0] as HTMLElement).getAttribute('data-stack-id')).toBe(top);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe('CR 103.1: before the play order is chosen', () => {
  it('nobody has the Turn badge and the phase bar says "Start of the game", not a player\'s turn 0', () => {
    const { startingPlayer: _, ...options } = boardConfig('c6-turn0').options ?? {};
    const s = new GameSession({ ...boardConfig('c6-turn0'), options }).state;
    expect(s.turn.number).toBe(0);
    expect(s.pending!.kind).toBe('playFirst');
    const v = viewFor(s, s.pending!.player);
    const { container } = render(<GameBoard view={v} />);
    expect(container.querySelector('.badge-turn')).toBeNull();
    expect(container.querySelector('.player-panel.is-active')).toBeNull();
    expect(screen.getByRole('region', { name: 'Turn structure' }).querySelector('.phase-turn')!.textContent).toBe('Start of the game');
    expect(container.querySelector('.phase-step.is-current')).toBeNull();
  });
});

describe('one card component (M8-W1 gap 4): the board draws hidden cards and mana with C2', () => {
  it('CR 400.2: the opponent’s hidden hand and the library are C2’s DigiDice card back; the mana pool uses C2’s glyphs (CR 106.4)', () => {
    const v = editable(at(5, 'main1'));
    v.players = v.players.map((p) => (p.id === ALICE ? { ...p, manaPool: [{ type: 'G' }, { type: 'G' }] as typeof p.manaPool } : p));
    const { container } = render(<GameBoard view={v} />);
    const backs = [...container.querySelectorAll('.hand-hidden .board-card-back, .zone-count .board-card-back')];
    expect(backs.length).toBeGreaterThan(0);
    for (const b of backs) expect(b.querySelector('img.card-back')).not.toBeNull();
    const pool = screen.getByRole('list', { name: "Alice's mana pool" });
    expect(pool.querySelector('.mana-glyph[data-symbol="G"]')).not.toBeNull();
    expect(pool.querySelector('.board-mana-glyph')).toBeNull();
  });
});
