/**
 * M12-4a (docs/design/m12-multiplayer.md 5.1): drives the shared table's camera (camera.ts) on the page.
 *
 * Nothing here goes through React state per frame: the pointer sets the rig's target, a frame loop eases the rig and writes two transforms per layer (the
 * floor and the cards are two layers with the same camera, so the arrows can run between them, under the cards); the loop stops once the camera has
 * settled, and only then are the seats' projected card widths measured for the compact faces (one React update, only when a seat changes face).
 *
 * The camera follows the pointer only over the table: never over the HUD, the hand, the action buttons, the chips, a zoom, the log, a zone viewer, a stage
 * overlay or the side rail (those are screen-space layers outside the scene). It holds still while a card is dragged (a pointer button is down), while
 * the animator plays a change (`data-fx-playing` on the board) and while a card zoom is open. Keys (not while typing, not with a modifier, not inside the
 * rail, a dialog or a stage overlay): arrows pan, + and - zoom, Home recentres, F toggles following, 1-4 look from a seat.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { CameraRig, PERF_SAMPLES, cameraHeld, cameraPerfMode, cameraTransforms, nextCompact, projectedWidth, tableGeometry, type CameraPose, type TableGeometry } from './camera';

export interface TableCameraParts {
  /** The table area (untransformed): the pointer is measured against it. */
  area: RefObject<HTMLElement>;
  /** Each layer's scene (pan) and camera (the plane) elements, floor and cards. */
  scenes: RefObject<HTMLElement>[];
  cameras: RefObject<HTMLElement>[];
  /** Is a card zoom open (the zoom store). */
  zoomOpen: () => boolean;
  /** The seat's framing: rest, or looking from another seat. */
  base: Partial<CameraPose>;
  /** Static camera (prefers-reduced-motion, or the follow setting off). */
  reduced: boolean;
  /** A key 1-4 was pressed: look from that seat. */
  onSeatKey?: (n: number) => void;
}

export interface TableCameraControls {
  following: boolean;
  toggleFollow: () => void;
  recentre: () => void;
  zoomBy: (factor: number) => void;
  panBy: (dx: number, dy: number) => void;
  /** Seats drawn with compact faces (by player id), measured each time the camera settles. */
  compact: ReadonlySet<string>;
  /** The measured fallback (camera.ts cameraPerfMode): 'off' when this machine drew the moving table under 30 fps, so following was turned off. */
  perf: 'full' | 'half' | 'off';
  /** Measure the compact faces again now (the seats' contents changed size). */
  remeasure: () => void;
}

/** Where the pointer does not steer the camera: the screen-space layers over and beside the table. */
const NOT_TABLE = '.table-hud, .table-chips, .zoom:not(.zoom-empty), .game-log, .zone-viewer, .zone-backdrop, .decision-stage, .board-side, [role="dialog"]';
const NO_KEYS = '.board-side, .decision-stage, .zone-viewer, .game-log, [role="dialog"], input, textarea, select';

function typing(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Projected card widths below which seats switch to compact faces: one measurement per seat, from its layout (untransformed) boxes. */
function measureCompact(plane: HTMLElement, g: TableGeometry, pose: CameraPose, was: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const seat of plane.querySelectorAll<HTMLElement>('.seat[data-player-id]')) {
    const id = seat.dataset.playerId!;
    const card = seat.querySelector<HTMLElement>('.bf-row .board-card-image');
    if (!card || card.offsetWidth <= 0) {
      if (was.has(id)) out.add(id);
      continue;
    }
    // The seat's centre in the plane's own pixels (offsets ignore transforms), from the plane's centre.
    const cx = seat.offsetLeft + seat.offsetWidth / 2 - g.planeW / 2;
    const cy = seat.offsetTop + seat.offsetHeight / 2 - g.planeH / 2;
    // A crowded seat's battlefield is drawn smaller as a whole (SharedTable fitSeats: CSS zoom).
    const zoom = Number(seat.querySelector<HTMLElement>(':scope > .battlefield')?.style.zoom) || 1;
    if (nextCompact(was.has(id), projectedWidth(pose, g, cx, cy, card.offsetWidth * zoom))) out.add(id);
  }
  return out;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

export function useTableCamera(p: TableCameraParts): TableCameraControls {
  const [rig] = useState(() => new CameraRig());
  const [following, setFollowing] = useState(true);
  const [compact, setCompact] = useState<ReadonlySet<string>>(() => new Set());
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const geo = useRef<TableGeometry | null>(null);
  const partsRef = useRef(p);
  partsRef.current = p;
  const raf = useRef(0);
  const last = useRef(0);
  const buttons = useRef(0);
  // The measured fallback: frame intervals while the camera moves, decided once.
  const samples = useRef<number[]>([]);
  const [perf, setPerf] = useState<'full' | 'half' | 'off'>('full');
  const perfRef = useRef(perf);
  perfRef.current = perf;
  const odd = useRef(false);

  /** Writes the pose on both layers. */
  const write = useCallback(() => {
    const g = geo.current;
    if (!g) return;
    const t = cameraTransforms(rig.pose, g);
    for (const s of partsRef.current.scenes) if (s.current) s.current.style.transform = t.scene;
    for (const c of partsRef.current.cameras) if (c.current) c.current.style.transform = t.camera;
  }, [rig]);

  const settle = useCallback(() => {
    const g = geo.current;
    const plane = partsRef.current.cameras[partsRef.current.cameras.length - 1]?.current;
    if (!g || !plane) return;
    const next = measureCompact(plane, g, rig.pose, compactRef.current);
    if (!sameSet(next, compactRef.current)) setCompact(next);
  }, [rig]);

  const held = useCallback((): boolean => {
    const root = partsRef.current.area.current?.closest<HTMLElement>('.game-board');
    return cameraHeld({
      dragging: buttons.current !== 0 || root?.querySelector('.is-dragging') != null,
      animating: root?.dataset.fxPlaying !== undefined,
      zoomOpen: partsRef.current.zoomOpen(),
    });
  }, []);

  const frame = useCallback(
    (now: number) => {
      const first = last.current === 0;
      const dt = first ? 16 : now - last.current;
      last.current = now;
      const h = held();
      const moving = rig.step(dt, h);
      if (moving && !first && dt < 250 && samples.current.length < PERF_SAMPLES) {
        samples.current.push(dt);
        if (samples.current.length === PERF_SAMPLES) {
          const mode = cameraPerfMode(samples.current);
          if (mode !== 'full') setPerf(mode);
          if (mode === 'off' && rig.following) setFollowing(rig.toggleFollow());
        }
      }
      // 'half': the camera is drawn every other frame (its last pose always is).
      odd.current = !odd.current;
      if (perfRef.current !== 'half' || odd.current || !moving) write();
      if (moving || (h && !rig.settled())) {
        raf.current = requestAnimationFrame(frame);
        return;
      }
      raf.current = 0;
      last.current = 0;
      settle();
    },
    [rig, write, held, settle],
  );

  /** Starts the frame loop if it is not running (the camera has somewhere to go). */
  const kick = useCallback(() => {
    if (typeof requestAnimationFrame !== 'function') {
      rig.step(1000, false);
      write();
      return;
    }
    if (raf.current === 0) raf.current = requestAnimationFrame(frame);
  }, [rig, write, frame]);

  // The scene's size: the geometry (fit, perspective) and the plane's size, measured on mount and on resize.
  useLayoutEffect(() => {
    const area = p.area.current;
    if (!area) return;
    const fit = () => {
      const w = area.clientWidth;
      const h = area.clientHeight;
      if (w <= 0 || h <= 0) return;
      const g = tableGeometry(w, h);
      geo.current = g;
      for (const s of partsRef.current.scenes) if (s.current) s.current.style.perspective = `${Math.round(g.perspective)}px`;
      for (const c of partsRef.current.cameras) {
        const el = c.current;
        if (!el) continue;
        el.style.width = `${Math.round(g.planeW)}px`;
        el.style.height = `${Math.round(g.planeH)}px`;
        el.style.left = `${Math.round((w - g.planeW) / 2)}px`;
        el.style.top = `${Math.round((h - g.planeH) / 2)}px`;
      }
      write();
      kick();
      settle();
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    return () => ro.disconnect();
  }, [p.area, write, kick, settle]);

  // Reduced motion and the seat's framing.
  useEffect(() => {
    rig.setReduced(p.reduced);
    rig.setBase(p.base);
    write();
    kick();
  }, [rig, p.reduced, p.base, write, kick]);

  // The pointer over the table, the wheel and the keys.
  useEffect(() => {
    const area = p.area.current;
    const main = area?.closest<HTMLElement>('.board-main');
    if (!area || !main) return;
    const onMove = (e: PointerEvent | MouseEvent) => {
      buttons.current = e.buttons;
      if (e.buttons !== 0) return;
      const t = e.target as Element | null;
      if (t?.closest?.(NOT_TABLE)) return;
      const r = area.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      if (held()) return;
      rig.pointer(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
      kick();
    };
    const onUp = (e: PointerEvent | MouseEvent) => {
      buttons.current = e.buttons;
      kick();
    };
    const onWheel = (e: WheelEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(NOT_TABLE) || !geo.current) return;
      e.preventDefault();
      const r = area.getBoundingClientRect();
      rig.zoomAt(Math.exp(-e.deltaY * 0.0015), geo.current, { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 });
      kick();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const t = e.target as Element | null;
      if (t instanceof Element && t !== document.body && t.closest(NO_KEYS)) return;
      const g = geo.current;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft':
          rig.panBy(0.05, 0);
          break;
        case 'ArrowRight':
          rig.panBy(-0.05, 0);
          break;
        case 'ArrowUp':
          rig.panBy(0, 0.05);
          break;
        case 'ArrowDown':
          rig.panBy(0, -0.05);
          break;
        case '+':
        case '=':
          if (g) rig.zoomAt(1.1, g);
          break;
        case '-':
        case '_':
          if (g) rig.zoomAt(1 / 1.1, g);
          break;
        case 'Home':
          rig.recentre();
          break;
        case 'f':
        case 'F':
          setFollowing(rig.toggleFollow());
          break;
        case '1':
        case '2':
        case '3':
        case '4':
          if (partsRef.current.onSeatKey) partsRef.current.onSeatKey(Number(e.key));
          else handled = false;
          break;
        default:
          handled = false;
      }
      if (!handled) return;
      e.preventDefault();
      kick();
    };
    main.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, true);
    area.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      main.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp, true);
      area.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [p.area, rig, kick, held]);

  // An animation ends or a zoom closes: the camera may have somewhere to go again.
  useEffect(() => {
    const root = p.area.current?.closest<HTMLElement>('.game-board');
    if (!root || typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => {
      if (root.dataset.fxPlaying === undefined) kick();
    });
    mo.observe(root, { attributes: true, attributeFilter: ['data-fx-playing'] });
    return () => mo.disconnect();
  }, [p.area, kick]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  return {
    following,
    compact,
    remeasure: settle,
    perf,
    toggleFollow: useCallback(() => {
      setFollowing(rig.toggleFollow());
      kick();
    }, [rig, kick]),
    recentre: useCallback(() => {
      rig.recentre();
      kick();
    }, [rig, kick]),
    zoomBy: useCallback(
      (f: number) => {
        if (geo.current) rig.zoomAt(f, geo.current);
        kick();
      },
      [rig, kick],
    ),
    panBy: useCallback(
      (dx: number, dy: number) => {
        rig.panBy(dx, dy);
        kick();
      },
      [rig, kick],
    ),
  };
}
