/**
 * M12-4a (docs/design/m12-multiplayer.md 5.1): the shared table, the default view of a game with three or four players. "The players view should see their
 * own board and all other 3 as if they are all on the same table, the camera can look where the mouse is looking so you can see the whole table, players
 * are arranged in a square, 2 side by side on one side 2 side by side on the other, you can switch between player views but not see opponents cards."
 *
 * Rendering: CSS 3D transforms on the existing DOM board (no new dependency). Every seat's battlefield (seats.ts places them) lies on one flat table plane
 * under one camera transform (camera.ts, useTableCamera.ts): cards keep their own components, pictures, artist credits, highlights and clicks, and the
 * browser hit-tests them in their projected shape. The table is two layers under the same camera: the floor (the grid and each seat's mat) below, and the
 * cards above with a transparent background, so the target and attack arrows (TargetArrows, measured from each element's projected rectangle every frame)
 * and the impacts on the fx canvas run between them, under the cards, as on the two-player board.
 *
 * Screen-space layers that the camera never moves (the owner's board rules): the viewer's HUD (life disc, piles) bottom-left, the hand in the middle
 * column, the prompt's action buttons bottom-right, the chips at the table's top-left, the stack pile, and everything GameBoard draws over the table
 * (the zoom, the stage overlays, the log, the end screen) and beside it (the rail).
 *
 * Seat views: clicking a seat's name plate (or keys 1-4) looks from that seat: across the table the table turns half round, beside the viewer the camera
 * moves over. A viewpoint only: the board still draws the viewer's own `viewFor` (CR 400.2), so that player's hand stays card backs, and the viewer's own
 * hand, HUD and buttons stay where they are. "Back to my seat" returns; a hot-seat hand-off draws the table afresh at the new viewer's own seat.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PlayerId } from '@openmtg/engine';
import { useBoard } from '../context';
import { OwnHand, HiddenHand } from '../Hand';
import { CenterLine } from '../PhaseBar';
import { Piles, PlayerPanel } from '../PlayerPanel';
import { TableStack } from '../StackPanel';
import { TargetArrows } from '../fx/TargetArrows';
import type { CameraPose } from './camera';
import { Seat, SeatMat } from './Seat';
import { isAcross, tableSeating } from './seats';
import { useTableCamera } from './useTableCamera';

export interface SharedTableProps {
  /** The player whose seat is the viewer's (the view's viewer; during a hot-seat hand-off, the one who sat here a moment ago). */
  viewer: PlayerId | null;
  actionsSlot: (el: HTMLDivElement | null) => void;
  zoomOpen: () => boolean;
  /** A static camera: prefers-reduced-motion, or the follow setting off. */
  reduced: boolean;
  /** The result banner (GameBoard), drawn on the table's middle band. */
  banner?: ReactNode;
  overlap: boolean;
  /** The layout switch (GameBoard), among the table's chips. */
  layoutSwitch?: ReactNode;
}

/** The framing that looks from a seat: across the table it turns half round (seats.ts), then the camera leans over that seat's half. */
function seatBase(span: 1 | 2, col: 0 | 1): Partial<CameraPose> {
  if (span === 2) return { zoom: 1.06, panY: -0.04 };
  return { zoom: 1.14, panX: col === 0 ? 0.16 : -0.16, panY: -0.06 };
}

const REST: Partial<CameraPose> = {};

/**
 * A seat's battlefield that needs more room than its place on the table (a crowded board: forty permanents) is drawn smaller as a whole (CSS zoom) rather
 * than spilling into the next seat; rows still never clip a card. Measured when the number of permanents changes and when the table is resized.
 */
export function fitSeats(plane: HTMLElement | null): void {
  if (!plane) return;
  for (const bf of plane.querySelectorAll<HTMLElement>('.seat > .battlefield')) {
    bf.style.zoom = '';
    for (let i = 0; i < 2; i++) {
      const need = bf.scrollHeight;
      const room = bf.clientHeight;
      if (room <= 0 || need <= room + 2) break;
      const z = Math.max(0.35, (Number(bf.style.zoom) || 1) * (room / need) * 0.98);
      bf.style.zoom = z.toFixed(3);
    }
  }
}

export function SharedTable({ viewer, actionsSlot, zoomOpen, reduced, banner, overlap, layoutSwitch }: SharedTableProps) {
  const { view } = useBoard();
  const [seatView, setSeatView] = useState<PlayerId | null>(null);
  const meId = viewer ?? view.turn.activePlayer;
  const looking = seatView !== null && seatView !== meId ? seatView : null;
  const turned = isAcross(view, viewer, looking);
  const seating = useMemo(() => tableSeating(view, viewer, turned), [view, viewer, turned]);
  const me = seating.all[0]!.player;
  // The HUD's hand is face up for the viewer's own seat, and in a replay's open view, where every hand is (Hand.tsx).
  const ownHud = view.viewer === me.id || view.open === true;
  const base = useMemo(() => {
    const s = looking ? seating.all.find((x) => x.player.id === looking) : undefined;
    return s ? seatBase(s.span, s.col) : REST;
  }, [looking, seating]);

  const onView = useCallback((id: PlayerId) => setSeatView((cur) => (id === meId || cur === id ? null : id)), [meId]);
  const onSeatKey = useCallback(
    (n: number) => {
      const s = seating.all.find((x) => x.key === n);
      if (s) setSeatView(s.player.id === meId ? null : s.player.id);
    },
    [seating, meId],
  );

  const area = useRef<HTMLDivElement>(null);
  const floorScene = useRef<HTMLDivElement>(null);
  const floorCam = useRef<HTMLDivElement>(null);
  const cardScene = useRef<HTMLDivElement>(null);
  const cardCam = useRef<HTMLDivElement>(null);
  const scenes = useMemo(() => [floorScene, cardScene], []);
  const cameras = useMemo(() => [floorCam, cardCam], []);
  const cam = useTableCamera({ area, scenes, cameras, zoomOpen, base, reduced, onSeatKey });

  // Crowded seats are fitted to their place (fitSeats), when the permanents change in number and when the table is resized.
  const crowd = view.zones.battlefield.length;
  const remeasure = cam.remeasure;
  useLayoutEffect(() => {
    fitSeats(cardCam.current);
    remeasure();
  }, [crowd, turned, seating.all.length, remeasure]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      fitSeats(cardCam.current);
      remeasure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [remeasure]);

  // The table turns half round when the seat looked from moves across it (a short turn about the table's centre, none with reduced motion).
  const lastTurned = useRef(turned);
  useLayoutEffect(() => {
    if (lastTurned.current === turned) return;
    lastTurned.current = turned;
    if (reduced) return;
    for (const c of cameras) {
      const plane = c.current?.querySelector<HTMLElement>(':scope > .table-turn');
      if (plane && typeof plane.animate === 'function') plane.animate([{ rotate: '180deg' }, { rotate: '0deg' }], { duration: 520, easing: 'cubic-bezier(.45,0,.2,1)' });
    }
  }, [turned, reduced, cameras]);

  const rows = (which: 'far' | 'near', mats: boolean) => (
    <div className={`table-row table-row-${which}`} data-seats={seating[which].length}>
      {seating[which].map((s) =>
        mats ? (
          <SeatMat key={s.player.id} place={s} own={s.player.id === me.id} />
        ) : (
          <Seat key={s.player.id} place={s} own={s.player.id === me.id} compact={cam.compact.has(s.player.id)} viewing={(looking ?? me.id) === s.player.id} onView={onView} />
        ),
      )}
    </div>
  );

  return (
    <div className="arena-stage table-shared" data-fx="arena" data-players={view.players.length} data-turned={turned ? '' : undefined} data-looking={looking ?? undefined}>
      <div className="table-area" ref={area}>
        <div className="table-scene table-floor" ref={floorScene} aria-hidden="true">
          <div className="table-camera" ref={floorCam}>
            <div className="table-turn">
              <div className="table-floor-grid" />
              {rows('far', true)}
              <div className="table-band">
                <div className="table-emblem" />
              </div>
              {rows('near', true)}
            </div>
          </div>
        </div>
        <canvas className="fx-under" data-fx="under" aria-hidden="true" />
        <TargetArrows />
        <div className="table-scene table-cards" ref={cardScene}>
          <div className="table-camera table-plane" ref={cardCam}>
            <div className="table-turn">
              {rows('far', false)}
              <div className="table-band">
                {banner}
                <CenterLine />
              </div>
              {rows('near', false)}
            </div>
          </div>
        </div>
        {/* Where a card the viewer draws is shown on its way to the hand (Animator showcaseSpot): the right of the viewer's half of the table. */}
        <div className="table-showcase" data-fx="showcase" aria-hidden="true" />
        <div className="table-chips" role="toolbar" aria-label="Table view">
          {looking && (
            <button type="button" className="table-chip is-primary" onClick={() => setSeatView(null)}>
              Back to my seat
            </button>
          )}
          <button type="button" className="table-chip" onClick={cam.recentre} title="Recentre the camera on this seat (Home)">
            Recentre
          </button>
          <button
            type="button"
            className="table-chip"
            onClick={cam.toggleFollow}
            aria-pressed={cam.following && !reduced}
            disabled={reduced}
            data-perf={cam.perf}
            title={
              reduced
                ? 'The camera stays still (reduced motion, or Settings: camera follows the mouse off); zoom with the wheel or + and -'
                : cam.perf === 'off'
                  ? 'Following was turned off: this computer drew the moving table under 30 frames a second (F turns it back on)'
                  : 'The camera looks where the mouse points (F)'
            }
          >
            Follow {cam.following && !reduced ? 'on' : 'off'}
          </button>
          <button type="button" className="table-chip" onClick={() => cam.zoomBy(1 / 1.1)} aria-label="Zoom out (-)">
            −
          </button>
          <button type="button" className="table-chip" onClick={() => cam.zoomBy(1.1)} aria-label="Zoom in (+)">
            +
          </button>
          {layoutSwitch}
        </div>
      </div>
      <div className={`side side-bottom table-hud${ownHud ? ' is-own' : ''}`} data-player-id={me.id}>
        <div className="side-bar seat-hud">
          <div className="seat-cluster">
            <Piles player={me} />
            <PlayerPanel player={me} position="bottom" />
          </div>
          {ownHud ? <OwnHand player={me.id} /> : <HiddenHand player={me.id} />}
          <div className="table-actions" ref={actionsSlot} role="group" aria-label="Prompt actions" />
        </div>
      </div>
      <TableStack overlap={overlap} />
    </div>
  );
}
