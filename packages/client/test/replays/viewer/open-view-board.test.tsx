/**
 * RPL-2 (replays design 6): the board draws a replay's open view (`core/view.ts#openView`, `view.open`) with nothing hidden. Every hand is face up (the
 * bottom seat's in its fan along the bottom edge, every other player's at their own edge), each library is a zone viewer that lists its cards in order,
 * and a face-down card's zoom says the open view shows it. A view that is not the open view draws exactly what it did before (CR 400.2): another
 * player's hand as backs and every library as a pile. Board-level, from engine states: the replay viewer's own test renders it through a replay.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { openView, viewFor, type GameState, type GameView, type ObjectId } from '@openmtg/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { GameBoard, type BoardCardProps } from '../../../src/board';
import { snapshotBoard } from '../../../src/board/fx/dom';
import { cardCount } from '../../../src/board/model';
import { cssRules, decl, removeBoardCss } from '../../board/css';
import { ALICE, BOB, SECRET, playGame } from '../../board/fixtures';
import { tableState } from '../../m12-board/fixtures';

const game = playGame(5);
/** A settled state of turn 5 with cards in both hands and both libraries (Bob holds the Secret Sphinx in some of them). */
function aState(): GameState {
  const c = game.captured.find((x) => x.turn === 5 && x.step === 'main1')!;
  return c.state;
}

const nameOf = (s: GameState | GameView, id: ObjectId) => s.defs[s.objects[id]!.defId]!.name;
const spyRenderer = (p: BoardCardProps) => <span className="spy" data-def={p.def?.name ?? 'back'} data-face-down={String(p.faceDown)} />;

afterEach(() => removeBoardCss());

/** Every card of `ids` is drawn face up inside `region`, under its own name (and its owner's, `whose`: outside a hand), in that order. */
function expectFaceUp(region: HTMLElement, s: GameState, ids: readonly ObjectId[], whose?: string) {
  const drawn = [...region.querySelectorAll<HTMLElement>('[data-object-id]')];
  expect(drawn.map((el) => el.getAttribute('data-object-id'))).toEqual([...ids]);
  for (const el of drawn) {
    expect(el.getAttribute('data-face'), el.getAttribute('aria-label') ?? '').toBe('up');
    expect(el.getAttribute('aria-label')).toBe(`${nameOf(s, el.getAttribute('data-object-id')!)}${whose ? ` (${whose})` : ''}`);
  }
}

describe('RPL-2: the board draws a replay\'s open view with nothing hidden (replays design 6)', () => {
  it('CR 402.3: every hand is face up in the open view, the bottom seat\'s in its fan and the other player\'s at their edge, each card by name', () => {
    const s = aState();
    expect(s.zones.hand[ALICE]!.length).toBeGreaterThan(0);
    expect(s.zones.hand[BOB]!.length).toBeGreaterThan(0);
    const v = openView(s);
    const { container } = render(<GameBoard view={v} />);
    // Nothing is drawn as a hand of backs.
    expect(container.querySelectorAll('.hand-hidden, .hand-back')).toHaveLength(0);
    const bottom = container.querySelector<HTMLElement>('.side-bottom')!;
    const top = container.querySelector<HTMLElement>('.side-top')!;
    const bottomId = bottom.getAttribute('data-player-id')!;
    const topId = top.getAttribute('data-player-id')!;
    const name = (id: string) => (id === ALICE ? 'Alice' : 'Bob');
    // The bottom seat: its fan along the bottom edge, as in that player's own view (its count for screen readers only, the hand being on screen).
    expect(bottom.classList.contains('is-own')).toBe(true);
    const own = within(bottom).getByRole('region', { name: `${name(bottomId)}'s hand (${s.zones.hand[bottomId]!.length})` });
    expect(own.classList.contains('hand-own')).toBe(true);
    expectFaceUp(own, s, s.zones.hand[bottomId]!);
    // The other player: a row of small face-up cards at their edge, where their backs would be.
    const theirs = within(top).getByRole('region', { name: `${name(topId)}'s hand (${s.zones.hand[topId]!.length})` });
    expect(theirs.classList.contains('hand-open')).toBe(true);
    expect(theirs.getAttribute('data-fx')).toBe('hand');
    expectFaceUp(theirs, s, s.zones.hand[topId]!);
    expect(theirs.querySelectorAll('.open-hand-card .slot-small')).toHaveLength(s.zones.hand[topId]!.length);
  });

  it('CR 402.3: a card only Bob holds (Secret Sphinx) is drawn and named in the open view', () => {
    const c = game.captured.find((x) => x.state.zones.hand[BOB]!.some((id) => nameOf(x.state, id) === SECRET))!;
    expect(c).toBeDefined();
    const drawn: BoardCardProps[] = [];
    render(<GameBoard view={openView(c.state)} renderCard={(p) => (drawn.push(p), <span>{p.def?.name ?? 'back'}</span>)} />);
    const bob = screen.getByRole('region', { name: new RegExp(`^Bob's hand \\(${c.state.zones.hand[BOB]!.length}\\)$`) });
    expect(within(bob).getAllByRole('group', { name: SECRET }).length).toBe(c.state.zones.hand[BOB]!.filter((id) => nameOf(c.state, id) === SECRET).length);
    expect(drawn.some((p) => p.def?.name === SECRET)).toBe(true);
  });

  it('CR 401.2: each library is a zone viewer in the open view, listing its cards in order, top first; no "look at the top card" (CR 401.5)', () => {
    const s = aState();
    const v = openView(s);
    const { container } = render(<GameBoard view={v} />);
    expect(screen.queryByLabelText(/you may look at the top card/)).toBeNull();
    expect(container.querySelector('span.pile-library')).toBeNull();
    for (const [id, who] of [[ALICE, 'Alice'], [BOB, 'Bob']] as const) {
      const library = s.zones.library[id]!;
      expect(library.length).toBeGreaterThan(0);
      const button = screen.getByRole('button', { name: `${who}'s library: ${cardCount(library.length)}` });
      // Still the pile the animations fly into, its top card face up (nothing is hidden in the open view).
      expect(button.getAttribute('data-fx')).toBe('pile');
      expect(button.getAttribute('data-pile')).toBe('library');
      expect(button.getAttribute('data-player-id')).toBe(id);
      expect(button.textContent).toContain('Lib');
      fireEvent.click(button);
      const dialog = screen.getByRole('dialog', { name: `${who}'s library` });
      expectFaceUp(dialog.querySelector<HTMLElement>('.zone-viewer-cards')!, s, library, who);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('CR 400.2: the same state\'s seat and public views still draw the other hands as backs and each library as a pile', () => {
    const s = aState();
    const seat = render(<GameBoard view={viewFor(s, ALICE)} />);
    const bob = within(seat.container).getByRole('region', { name: new RegExp(`^Bob's hand: ${cardCount(s.zones.hand[BOB]!.length)}$`) });
    expect(bob.querySelectorAll('.hand-back')).toHaveLength(Math.min(12, s.zones.hand[BOB]!.length));
    expect(seat.container.querySelectorAll('.hand-open')).toHaveLength(0);
    expect(within(seat.container).queryByRole('button', { name: /library/ })).toBeNull();
    expect(within(seat.container).getAllByLabelText(`Library: ${cardCount(s.zones.library[BOB]!.length)}`).length).toBeGreaterThan(0);
    seat.unmount();
    const pub = render(<GameBoard view={viewFor(s, null)} />);
    expect(pub.container.querySelectorAll('.hand-own, .hand-open')).toHaveLength(0);
    expect(pub.container.querySelectorAll('.hand-hidden')).toHaveLength(2);
    for (const oid of [...s.zones.hand[ALICE]!, ...s.zones.hand[BOB]!]) for (const el of pub.container.querySelectorAll(`[data-object-id="${oid}"]`)) expect(el.getAttribute('data-face')).toBe('down');
  });

  it('the shared table (3-4 players): every other seat\'s hand is face up on its seat in the open view, and the HUD\'s hand too', () => {
    const s = tableState(4);
    const v = openView(s);
    const { container } = render(<GameBoard view={v} tableLayout="shared" />);
    expect(container.querySelector('.table-shared')).not.toBeNull();
    expect(container.querySelectorAll('.hand-hidden, .hand-back')).toHaveLength(0);
    const hud = container.querySelector<HTMLElement>('.table-hud')!;
    const me = hud.getAttribute('data-player-id')!;
    expect(hud.classList.contains('is-own')).toBe(true);
    expectFaceUp(hud.querySelector<HTMLElement>('.hand-own')!, s, s.zones.hand[me]!);
    const others = s.players.map((p) => p.id).filter((id) => id !== me);
    expect(others).toHaveLength(3);
    for (const id of others) {
      const seat = container.querySelector<HTMLElement>(`.table-plane .seat[data-player-id="${id}"]`)!;
      const hand = seat.querySelector<HTMLElement>('.hand-open')!;
      expect(hand.getAttribute('data-player-id')).toBe(id);
      expect(s.zones.hand[id]!.length).toBeGreaterThan(0);
      expectFaceUp(hand, s, s.zones.hand[id]!);
    }
  });

  it('CR 708.5: a face-down permanent\'s zoom in the open view says the open view shows it, not that it was revealed (CR 708.9)', () => {
    const s = structuredClone(aState()) as GameState;
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.controller === BOB && nameOf(s, id) === 'Test Bear')!;
    expect(bear).toBeDefined();
    s.objects[bear] = { ...s.objects[bear]!, faceDown: true };
    const { container } = render(<GameBoard view={openView(s)} renderCard={spyRenderer} />);
    const el = container.querySelector<HTMLElement>(`.board-card[data-object-id="${bear}"]`)!;
    expect(el.getAttribute('data-face')).toBe('down');
    fireEvent.mouseEnter(el);
    const zoom = container.querySelector<HTMLElement>('.zoom:not(.zoom-empty)')!;
    expect(within(zoom).getByText('Face down (shown in the open view): Test Bear')).toBeTruthy();
    expect(zoom.textContent).not.toContain('CR 708.9');
    expect(zoom.querySelector('.spy')!.getAttribute('data-def')).toBe('Test Bear');
  });

  it('the animator counts the cards of a face-up hand at a player\'s edge as hand cards, not as permanents (board/fx/dom.ts)', () => {
    const s = aState();
    const { container } = render(<GameBoard view={openView(s)} />);
    const topId = container.querySelector('.side-top')!.getAttribute('data-player-id')!;
    const snap = snapshotBoard(container.querySelector<HTMLElement>('.game-board')!);
    for (const id of s.zones.hand[topId]!) expect(snap.cards.get(id)?.zone, id).toBe('hand');
    expect(snap.hands.has(topId)).toBe(true);
    expect(snap.piles.has(`${topId}:library`)).toBe(true);
  });

  it('ARCHITECTURE.md "Card images": the open hand\'s cards overlap only while card pictures may, and then only to fit the hand', () => {
    for (const r of cssRules()) {
      if (!r.selectors.some((x) => x.includes('open-hand-card'))) continue;
      for (const [k, val] of Object.entries(r.decls)) {
        if (!k.startsWith('margin') || !/-/.test(val)) continue;
        for (const x of r.selectors) expect(x, `${x} ${k}`).toMatch(/^\.game-board\[data-overlap='yes'\] /);
      }
    }
    // Edge to edge otherwise: each card a back's width, or its share of the hand's width when that is less.
    expect(decl('.open-hand-card')['--row-cw']).toMatch(/var\(--back-w\).*100cqw.*var\(--hand-n/);
    expect(decl('.hand-open')['container-type']).toBe('inline-size');
    expect(decl(".game-board[data-overlap='yes'] .open-hand-card + .open-hand-card")['margin-left']).toMatch(/^min\(0px, .*100cqw.*var\(--hand-n/);
  });
});
