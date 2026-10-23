/**
 * M12-4a (docs/design/m12-multiplayer.md 5.1, 5.2): the board with three and four players, rendered from real `viewFor` views. The shared table puts every
 * seat on one plane under the camera and keeps the viewer's HUD, hand and buttons in screen space; a seat view is a viewpoint only (CR 400.2: the
 * other players' hands stay backs, the viewer's own hand stays theirs); a two-player game draws today's board; the other two layouts; compact faces;
 * a player who left.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameBoard } from '../../src/board';
import { tableState, viewOf, withLeft } from './fixtures';

const seatOf = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`.table-plane .seat[data-player-id="${id}"]`)!;

describe('the shared table (5.1)', () => {
  it('4 players: four seats on one table plane, two and two; the viewer\'s HUD, hand and buttons in the screen-space strip', () => {
    const { container } = render(<GameBoard view={viewOf(tableState(4), 'p1')} tableLayout="shared" />);
    const board = container.querySelector('.game-board')!;
    expect(board.getAttribute('data-layout')).toBe('shared');
    const plane = container.querySelector('.table-plane')!;
    expect([...plane.querySelectorAll('.table-row-far > .seat')].map((s) => s.getAttribute('data-seat'))).toEqual(['farLeft', 'farRight']);
    expect([...plane.querySelectorAll('.table-row-near > .seat')].map((s) => s.getAttribute('data-player-id'))).toEqual(['p1', 'p4']);
    // the viewer's disc, piles, hand and the prompt's buttons are not on the plane (the camera never moves them)
    const hud = container.querySelector('.table-hud')!;
    expect(hud.closest('.table-plane')).toBeNull();
    expect(hud.querySelector('.player-panel[data-player-id="p1"]')).not.toBeNull();
    expect(hud.querySelector('.hand-own')).not.toBeNull();
    expect(hud.querySelector('.table-actions')).not.toBeNull();
    expect(plane.querySelector('.player-panel[data-player-id="p1"]')).toBeNull();
    // every battlefield is on the plane, the far seats mirrored (creature line toward the centre)
    for (const id of ['p1', 'p2', 'p3', 'p4']) expect(plane.querySelector(`.battlefield[data-player-id="${id}"]`)).not.toBeNull();
    expect(seatOf(container, 'p2').querySelector('.battlefield')!.classList.contains('bf-far')).toBe(true);
    expect(seatOf(container, 'p4').querySelector('.battlefield')!.classList.contains('bf-near')).toBe(true);
    // the floor layer under the cards has a mat per seat; the arrows and the impact canvas lie between the two layers
    expect(container.querySelectorAll('.table-floor .seat-mat')).toHaveLength(4);
    const area = container.querySelector('.table-area')!;
    const order = [...area.children].map((e) => (e.getAttribute('class') ?? '').split(' ')[0]);
    expect(order.indexOf('table-scene')).toBeLessThan(order.indexOf('fx-arrows'));
    expect(order.lastIndexOf('table-scene')).toBeGreaterThan(order.indexOf('fx-arrows'));
    // the rail is where it always is
    expect(container.querySelector('.board-side .board-prompt')).not.toBeNull();
  });

  it('name plates say next / previous in turn order (CR 101.4) and carry the 1-4 keys', () => {
    const { container } = render(<GameBoard view={viewOf(tableState(4), 'p1')} tableLayout="shared" />);
    const plate = (id: string) => container.querySelector(`.seat-plate[data-player-id="${id}"]`)!;
    expect(plate('p2').textContent).toMatch(/Bianca.*next/);
    expect(plate('p4').textContent).toMatch(/Dmitri.*previous/);
    expect(plate('p1').textContent).toMatch(/Alice \(you\)/);
    expect(within(plate('p3') as HTMLElement).getByRole('button').getAttribute('aria-label')).toMatch(/key 3/);
  });

  it('3 players: the viewer has the whole near side, both opponents across', () => {
    const { container } = render(<GameBoard view={viewOf(tableState(3), 'p1')} />);
    expect(container.querySelector('.game-board')!.getAttribute('data-layout')).toBe('shared');
    expect(container.querySelectorAll('.table-row-near > .seat')).toHaveLength(1);
    expect(seatOf(container, 'p1').style.gridColumn).toBe('1 / -1');
    expect([...container.querySelectorAll('.table-row-far > .seat')].map((s) => s.getAttribute('data-player-id'))).toEqual(['p2', 'p3']);
  });

  it('a two-player game draws today\'s board whatever the layout', () => {
    for (const layout of ['shared', 'acrossTop', 'focused'] as const) {
      const { container, unmount } = render(<GameBoard view={viewOf(tableState(2), 'p1')} tableLayout={layout} />);
      expect(container.querySelector('.game-board')!.getAttribute('data-layout')).toBe('duel');
      expect(container.querySelector('.table-shared')).toBeNull();
      expect(container.querySelector('.table-layout-switch')).toBeNull();
      expect(container.querySelector('.side-bottom')!.getAttribute('data-player-id')).toBe('p1');
      expect(container.querySelector('.side-top')!.getAttribute('data-player-id')).toBe('p2');
      unmount();
    }
  });
});

describe('seat views: a viewpoint only (5.1, CR 400.2)', () => {
  it('looking from a seat across the table turns it; that player\'s hand stays card backs and the viewer keeps their own hand and HUD', () => {
    const view = viewOf(tableState(4), 'p1');
    const { container } = render(<GameBoard view={view} tableLayout="shared" />);
    const ownHand = () => [...container.querySelectorAll('.table-hud .hand-own .board-card')];
    const before = ownHand().length;
    expect(before).toBeGreaterThan(0);
    fireEvent.click(within(container.querySelector('.seat-plate[data-player-id="p2"]') as HTMLElement).getByRole('button'));
    const table = container.querySelector('.table-shared')!;
    expect(table.getAttribute('data-looking')).toBe('p2');
    expect(table.hasAttribute('data-turned')).toBe(true);
    expect(seatOf(container, 'p2').getAttribute('data-seat')).toBe('nearRight');
    // Bianca's hand: only backs, on her seat; Alice's hand: still face up in the HUD
    const theirs = seatOf(container, 'p2').querySelectorAll('.hand-back');
    expect(theirs.length).toBe(view.zones.hand.p2!.length);
    expect(seatOf(container, 'p2').querySelectorAll('[data-zone="hand"][data-face="up"]')).toHaveLength(0);
    expect(ownHand()).toHaveLength(before);
    expect(ownHand().every((c) => c.getAttribute('data-face') === 'up')).toBe(true);
    expect(container.querySelector('.table-hud')!.getAttribute('data-player-id')).toBe('p1');
    // no card of another player's hand or of any library is face up anywhere
    for (const p of ['p2', 'p3', 'p4']) for (const oid of [...view.zones.hand[p]!, ...view.zones.library[p]!]) for (const el of container.querySelectorAll(`[data-object-id="${oid}"]`)) expect(el.getAttribute('data-face')).toBe('down');
    // back to my seat
    fireEvent.click(screen.getByRole('button', { name: 'Back to my seat' }));
    expect(table.getAttribute('data-looking')).toBeNull();
    expect(seatOf(container, 'p1').getAttribute('data-seat')).toBe('nearLeft');
  });

  it('keys 1-4 look from the seats in turn order; a seat beside the viewer is looked at without turning the table', () => {
    const { container } = render(<GameBoard view={viewOf(tableState(4), 'p1')} tableLayout="shared" />);
    const table = container.querySelector('.table-shared')!;
    act(() => void fireEvent.keyDown(window, { key: '4' }));
    expect(table.getAttribute('data-looking')).toBe('p4');
    expect(table.hasAttribute('data-turned')).toBe(false);
    act(() => void fireEvent.keyDown(window, { key: '3' }));
    expect(table.getAttribute('data-looking')).toBe('p3');
    expect(table.hasAttribute('data-turned')).toBe(true);
    act(() => void fireEvent.keyDown(window, { key: '1' }));
    expect(table.getAttribute('data-looking')).toBeNull();
    // not while typing, not with a modifier
    act(() => void fireEvent.keyDown(window, { key: '2', ctrlKey: true }));
    expect(table.getAttribute('data-looking')).toBeNull();
  });

  it('a hot-seat hand-off draws the table at the new viewer\'s own seat', () => {
    const s = tableState(4);
    const { container, rerender } = render(<GameBoard view={viewOf(s, 'p1')} tableLayout="shared" />);
    fireEvent.click(within(container.querySelector('.seat-plate[data-player-id="p3"]') as HTMLElement).getByRole('button'));
    rerender(<GameBoard view={viewOf(s, 'p2')} tableLayout="shared" />);
    const table = container.querySelector('.table-shared')!;
    expect(table.getAttribute('data-looking')).toBeNull();
    expect(seatOf(container, 'p2').getAttribute('data-seat')).toBe('nearLeft');
    expect(container.querySelector('.table-hud')!.getAttribute('data-player-id')).toBe('p2');
  });
});

describe('the camera chips and reduced motion', () => {
  it('Recentre, Follow (F) and zoom are on the table, never in the rail; reduced motion disables following', () => {
    const { container, unmount } = render(<GameBoard view={viewOf(tableState(4), 'p1')} tableLayout="shared" />);
    const chips = container.querySelector('.table-chips')!;
    expect(chips.closest('.board-side')).toBeNull();
    const follow = within(chips as HTMLElement).getByRole('button', { name: /Follow on/ });
    expect(follow.getAttribute('aria-pressed')).toBe('true');
    act(() => void fireEvent.keyDown(window, { key: 'f' }));
    expect(within(chips as HTMLElement).getByRole('button', { name: /Follow off/ }).getAttribute('aria-pressed')).toBe('false');
    expect(within(chips as HTMLElement).getByRole('button', { name: 'Recentre' })).toBeTruthy();
    unmount();
    const r = render(<GameBoard view={viewOf(tableState(4), 'p1')} tableLayout="shared" cameraFollow={false} />);
    const f = within(r.container.querySelector('.table-chips') as HTMLElement).getByRole('button', { name: /Follow off/ });
    expect((f as HTMLButtonElement).disabled).toBe(true);
  });

  it('the layout switch is on the table and reports the choice', () => {
    const chosen: string[] = [];
    const { container } = render(<GameBoard view={viewOf(tableState(4), 'p1')} tableLayout="shared" onTableLayout={(l) => chosen.push(l)} />);
    const sw = container.querySelector('.table-layout-switch') as HTMLElement;
    expect(within(sw).getByRole('button', { name: 'Shared table' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(sw).getByRole('button', { name: 'Focused' }));
    expect(chosen).toEqual(['focused']);
  });
});

describe('a player who left (D9, D10)', () => {
  it('their seat stays, empty, with the plate greyed and their place; the other layouts say it too', () => {
    const s = withLeft(tableState(4), 'p3', 1, 'conceded');
    const { container, unmount } = render(<GameBoard view={viewOf(s, 'p1')} tableLayout="shared" />);
    const seat = seatOf(container, 'p3');
    expect(seat.classList.contains('is-out')).toBe(true);
    expect(seat.querySelectorAll('.bf-row .board-card')).toHaveLength(0);
    expect(container.querySelector('.seat-plate[data-player-id="p3"]')!.classList.contains('is-out')).toBe(true);
    expect(container.querySelector('.seat-plate[data-player-id="p3"] .seat-placement')!.textContent).toBe('4th: conceded');
    unmount();
    const across = render(<GameBoard view={viewOf(s, 'p1')} tableLayout="acrossTop" />);
    expect(across.container.querySelector('.side-top.is-out[data-player-id="p3"] .seat-out-label')!.textContent).toBe('Carol: 4th: conceded');
  });
});

describe('the two other layouts (5.2)', () => {
  it('opponents across the top: every opponent in a top seat, left to right from the next player', () => {
    const { container } = render(<GameBoard view={viewOf(tableState(4), 'p2')} tableLayout="acrossTop" />);
    expect(container.querySelector('.game-board')!.getAttribute('data-seats')).toBe('4');
    expect([...container.querySelectorAll('.board-top > .side-top')].map((s) => s.getAttribute('data-player-id'))).toEqual(['p3', 'p4', 'p1']);
    expect(container.querySelector('.side-bottom')!.getAttribute('data-player-id')).toBe('p2');
  });

  it('one focused opponent: one large at the top, the others as strips with compact creatures; a click on a strip brings it forward', () => {
    const { container } = render(<GameBoard view={viewOf(tableState(4, 6), 'p1')} tableLayout="focused" />);
    const top = () => container.querySelector('.board-top-focused > .side-top')!.getAttribute('data-player-id');
    expect(top()).toBe('p2');
    const strips = [...container.querySelectorAll('.opponent-strip')];
    expect(strips.map((s) => s.getAttribute('data-player-id'))).toEqual(['p3', 'p4']);
    // a strip's single row holds its creatures only, with compact faces (no picture, no artist)
    const row = strips[0]!.querySelector('.strip-creatures')!;
    const cards = [...row.querySelectorAll('.board-card')];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.querySelector('[data-compact]')).not.toBeNull();
    fireEvent.click(strips[1]!.querySelector('.strip-counts')!);
    expect(top()).toBe('p4');
  });
});
