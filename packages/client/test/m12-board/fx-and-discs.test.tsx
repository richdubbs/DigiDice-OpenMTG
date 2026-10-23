/**
 * M12-4a: the effects side of a multiplayer table.
 * - Eliminations (m12 design 5.1; inventory C21, C22): a mid-game `playerLost` and a `playerLeft` are planned (the final blow, the leaver's objects
 *   vanishing, their face-down cards named, CR 708.9), where before only the game's end was.
 * - Arrows in perspective (5.1; C15): each attacker being declared points at its own picked target; with several possible defenders and no pick, no
 *   arrow (D15: no default); a two-player game as before. The path is computed from projected rectangles and ends at the target's edge.
 * - Commander damage at a table of four (C18): the disc shows the highest three lines and "+N"; the popover lists the whole table.
 * - Compact faces (5.1 "Readability"): a card drawn compact shows its name, cost and P/T, no picture and so no artist; outside a compact part of the
 *   board every card is drawn as before.
 */
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@openmtg/engine';
import { GameBoard } from '../../src/board';
import { CardSlot } from '../../src/board/CardSlot';
import { BoardContext, CompactContext, type BoardContextValue } from '../../src/board/context';
import { commanderDamageTable, discDamageLines, type CommanderDamageLine } from '../../src/board/commander';
import { defaultCardRenderer } from '../../src/board/cardRenderer';
import { arrowPath, pendingAttackArrows } from '../../src/board/fx/TargetArrows';
import { planBatch, planIsEmpty } from '../../src/board/fx/plan';
import { CameraRig, projectRect, tableGeometry } from '../../src/board/table/camera';
import { tableState, viewOf, withLeft } from './fixtures';

describe('eliminations are planned (C21, C22)', () => {
  const s = tableState(4);
  const from = viewOf(s, 'p1');
  const to = viewOf(withLeft(s, 'p3', 1, 'has 0 or less life'), 'p1');
  const carolPerms = from.zones.battlefield.filter((id) => from.objects[id]!.owner === 'p3');

  it('a player lost and the game goes on: not an end of the game, but a plan of its own', () => {
    const events: GameEvent[] = [{ type: 'playerLost', player: 'p3', reason: 'has 0 or less life' } as GameEvent];
    const p = planBatch(events, from, to);
    expect(p.b.lost).toEqual(['p3']);
    expect(p.b.gameOver).toBeNull();
    expect(planIsEmpty(p)).toBe(false);
  });

  it('a player left: the objects that left with them, and their face-down cards revealed by name (CR 708.9)', () => {
    const events = [
      { type: 'playerLeft', player: 'p3', reason: 'has 0 or less life', removed: carolPerms, exiled: [], revealed: [{ id: carolPerms[0]!, name: 'Secret Sphinx' }] },
    ] as GameEvent[];
    const p = planBatch(events, from, to);
    expect(p.b.left).toEqual([{ player: 'p3', removed: carolPerms, revealed: [{ id: carolPerms[0]!, name: 'Secret Sphinx' }] }]);
    expect(planIsEmpty(p)).toBe(false);
  });

  it('a two-player end of the game is planned as before', () => {
    const p = planBatch([{ type: 'playerLost', player: 'p2', reason: 'x' }, { type: 'gameOver', winner: 'p1', reason: 'x' }] as GameEvent[], from, from);
    expect(p.b.gameOver).toEqual({ winner: 'p1' });
    expect(p.b.left).toEqual([]);
  });
});

describe('attack arrows while attackers are declared (C15, D15)', () => {
  const players = [
    { id: 'p1', hasLost: false },
    { id: 'p2', hasLost: false },
    { id: 'p3', hasLost: false },
  ];

  it('each attacker points at its own picked target', () => {
    expect(pendingAttackArrows('p1', players, ['a', 'b'], { a: 'p2', b: 'pw1' })).toEqual([
      { attacker: 'a', target: 'p2' },
      { attacker: 'b', target: 'pw1' },
    ]);
  });

  it('with several possible defenders an attacker without a target has no arrow (no default)', () => {
    expect(pendingAttackArrows('p1', players, ['a', 'b'], { a: 'p3' })).toEqual([{ attacker: 'a', target: 'p3' }]);
    expect(pendingAttackArrows('p1', players, ['a'], undefined)).toEqual([]);
  });

  it('a two-player game points at the one opponent, as before', () => {
    expect(pendingAttackArrows('p1', players.slice(0, 2), ['a'], undefined)).toEqual([{ attacker: 'a', target: 'p2' }]);
  });

  it('the path runs between projected rectangles and stops at the target\'s edge', () => {
    // A card on the near-left seat and a disc on the far-right seat, as the camera projects them (what getBoundingClientRect reports).
    const g = tableGeometry(1000, 600);
    const rig = new CameraRig();
    rig.setReduced(true);
    rig.pointer(0.9, -0.9);
    const toScreen = (r: { left: number; top: number; right: number; bottom: number }) => {
      const left = r.left + 500;
      const top = r.top + 300;
      return { left, top, right: r.right + 500, bottom: r.bottom + 300, width: r.right - r.left, height: r.bottom - r.top };
    };
    const from = toScreen(projectRect(rig.pose, g, { x: -300, y: 120, w: 70, h: 98 }));
    const disc = toScreen(projectRect(rig.pose, g, { x: 260, y: -250, w: 60, h: 60 }));
    const box = { left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600 };
    const d = arrowPath(box, box, from, disc, null)!;
    const nums = d.match(/-?[\d.]+/g)!.map(Number);
    const [x1, y1] = nums.slice(-2) as [number, number];
    // the end lies just outside the disc's projected box (never across it), on the side toward the card
    const inside = x1 > disc.left && x1 < disc.right && y1 > disc.top && y1 < disc.bottom;
    expect(inside).toBe(false);
    expect(Math.abs(x1 - (disc.left + disc.right) / 2)).toBeLessThan(disc.width);
    expect(y1).toBeGreaterThan(disc.top);
  });
});

describe('commander damage at a table of four (C18)', () => {
  const line = (commander: string, amount: number): CommanderDamageLine => ({ commander, name: commander, owner: 'p2', amount, limit: 21, high: amount >= 15 });

  it('up to three lines show as they are; more show the highest three and "+N"', () => {
    expect(discDamageLines([line('a', 3), line('b', 5)])).toEqual({ shown: [line('a', 3), line('b', 5)], more: 0 });
    const r = discDamageLines([line('a', 3), line('b', 9), line('c', 1), line('d', 15), line('e', 9)]);
    expect(r.shown.map((l) => l.commander)).toEqual(['b', 'd', 'e']);
    expect(r.more).toBe(2);
  });

  it('the disc opens the whole table: rows of players, columns of commanders', () => {
    const s = structuredClone(tableState(4));
    s.options.commander = { variant: 'commander', damageLimit: 21 } as typeof s.options.commander;
    const cards = ['c1', 'c2', 'c3', 'c4'];
    s.players.forEach((p, i) => {
      p.commanders = [{ card: cards[i]!, defId: s.objects[s.zones.library[p.id]![0]!]!.defId } as NonNullable<typeof p.commanders>[number]];
    });
    s.players[0]!.commanderDamage = { c2: 4, c3: 16, c4: 2, c1: 0 };
    s.players[1]!.commanderDamage = { c1: 7 };
    const v = viewOf(s, 'p1');
    const t = commanderDamageTable(v);
    expect(t.commanders.map((c) => c.card)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(t.rows[0]!.cells).toEqual([0, 4, 16, 2]);
    expect(t.rows[1]!.cells).toEqual([7, 0, 0, 0]);
    // Alice's own disc: three lines from three commanders; adding a fourth shows "+1"
    s.players[0]!.commanderDamage = { c1: 1, c2: 4, c3: 16, c4: 2 };
    const { container } = render(<GameBoard view={viewOf(s, 'p1')} tableLayout="shared" />);
    const disc = container.querySelector('.table-hud .player-panel') as HTMLElement;
    expect(disc.querySelectorAll('[data-commander-damage]')).toHaveLength(3);
    const more = within(disc).getByRole('button', { name: '+1' });
    fireEvent.click(more);
    const dialog = within(disc).getByRole('dialog', { name: 'Commander damage' });
    expect(dialog.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(dialog.querySelector('td.is-high')!.textContent).toBe('16 / 21');
  });
});

describe('compact faces (5.1 "Readability")', () => {
  it('a compact card shows its name, cost and P/T, no picture and no artist; the same card outside is drawn as before', () => {
    const v = viewOf(tableState(4), 'p1');
    const bear = v.zones.battlefield.find((id) => v.defs[v.objects[id]!.defId]?.name === 'Test Bear')!;
    const ctx = {
      view: v, renderCard: defaultCardRenderer, useArtist: (def: unknown) => (def ? 'Some Artist' : null), legalActions: [], playable: new Set(), manaOnly: new Set(), byHand: new Set(), selectable: new Set(),
      selected: new Set(), targeted: new Map(), focusStack: null, setFocusStack: () => {}, setZoom: () => {}, openZone: null, setOpenZone: () => {}, interaction: {}, handOrders: new Map(),
    } as unknown as BoardContextValue;
    const compact = render(
      <BoardContext.Provider value={ctx}>
        <CompactContext.Provider value={true}>
          <CardSlot id={bear} size="small" />
        </CompactContext.Provider>
      </BoardContext.Provider>,
    );
    const face = compact.container.querySelector('[data-compact]')!;
    expect(face.querySelector('.cf-name')!.textContent).toBe('Test Bear');
    expect(face.querySelector('.cf-pt')!.textContent).toBe('2/2');
    expect(compact.container.querySelector('.placeholder-card')).toBeNull();
    expect(compact.container.querySelector('.board-card')!.getAttribute('aria-label')).not.toMatch(/Some Artist/);
    compact.unmount();
    const full = render(
      <BoardContext.Provider value={ctx}>
        <CardSlot id={bear} size="small" />
      </BoardContext.Provider>,
    );
    expect(full.container.querySelector('[data-compact]')).toBeNull();
    expect(full.container.querySelector('.placeholder-card')).not.toBeNull();
    expect(full.container.querySelector('.board-card')!.getAttribute('aria-label')).toMatch(/Some Artist/);
  });
});
