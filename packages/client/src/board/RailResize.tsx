/**
 * The right rail sized by the player (Settings.railWidth, railPromptShare): its left edge sets the rail's width, the edge above the prompt (the bottom pane:
 * declaring attackers and blockers, choices) how much of the rail that pane takes. Drag an edge, or focus it and use the arrow keys; a double click (or
 * Home) gives back the default. The rail still never changes size by itself as the stack, the log or a prompt grows (.board-side): only these handles do.
 *
 * While dragging, the size is written straight to the board's CSS variables (no React draw per pointer move); it is stored in Settings when the drag ends.
 */
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { RAIL_SHARE_MAX, RAIL_SHARE_MIN, RAIL_WIDTH_MAX, RAIL_WIDTH_MIN, settingsStore } from '../settings/settings';

/** The rail's width never takes more than this share of the board (the table keeps the rest). */
const MAX_BOARD_SHARE = 0.6;
const WIDTH_STEP = 16;
const SHARE_STEP = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The board's CSS variables for the player's rail size (absent: the stylesheet's defaults). */
export function railStyle(width: number | null, share: number | null): CSSProperties {
  return {
    ...(width !== null ? { '--rail-w': `min(${width}px, ${MAX_BOARD_SHARE * 100}vw)` } : {}),
    ...(share !== null ? { '--rail-prompt-grow': String(share), '--rail-top-grow': String(1 - share) } : {}),
  } as CSSProperties;
}

function apply(board: HTMLElement | null, width: number | null, share: number | null): void {
  if (!board) return;
  const s = railStyle(width, share) as Record<string, string>;
  for (const k of ['--rail-w', '--rail-prompt-grow', '--rail-top-grow']) {
    if (s[k] !== undefined) board.style.setProperty(k, s[k]);
  }
}

/** Follow the pointer from a pointerdown until it is released, then `done`. */
function drag(e: ReactPointerEvent<HTMLElement>, move: (ev: PointerEvent) => void, done: () => void): void {
  if (e.button !== 0) return;
  e.preventDefault();
  const el = e.currentTarget;
  el.setPointerCapture?.(e.pointerId);
  el.classList.add('is-dragging');
  const onMove = (ev: PointerEvent) => move(ev);
  const onUp = () => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.classList.remove('is-dragging');
    done();
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

interface HandleProps {
  board: RefObject<HTMLElement | null>;
  width: number | null;
  share: number | null;
}

/** The rail's left edge: drag it to make the rail wider or narrower. */
export function RailWidthHandle({ board, width }: HandleProps) {
  // As drawn (a stored width the window is too narrow for is drawn narrower); the stored width, or the smallest, while nothing is laid out
  const current = () => {
    const drawn = board.current?.querySelector<HTMLElement>('.board-side')?.getBoundingClientRect().width ?? 0;
    return drawn > 0 ? drawn : width ?? RAIL_WIDTH_MIN;
  };
  const limit = () => {
    const room = board.current?.getBoundingClientRect().width ?? 0;
    return room > 0 ? Math.max(RAIL_WIDTH_MIN, Math.min(RAIL_WIDTH_MAX, room * MAX_BOARD_SHARE)) : RAIL_WIDTH_MAX;
  };
  const save = (w: number | null) => settingsStore().update({ railWidth: w === null ? null : Math.round(w) });
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    let w = current();
    drag(
      e,
      (ev) => {
        const right = board.current?.getBoundingClientRect().right ?? ev.clientX;
        w = clamp(right - ev.clientX, RAIL_WIDTH_MIN, limit());
        apply(board.current, w, null);
      },
      () => save(w),
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const by = e.key === 'ArrowLeft' ? WIDTH_STEP : e.key === 'ArrowRight' ? -WIDTH_STEP : 0;
    if (e.key === 'Home') save(null);
    else if (by !== 0) save(clamp(current() + by, RAIL_WIDTH_MIN, limit()));
    else return;
    e.preventDefault();
  };
  return (
    <div
      className="rail-resize rail-resize-x"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the side panel (double-click for the default size)"
      aria-valuemin={RAIL_WIDTH_MIN}
      aria-valuemax={RAIL_WIDTH_MAX}
      aria-valuenow={Math.round(width ?? current())}
      tabIndex={0}
      title="Drag to resize the side panel; double-click for the default size"
      onPointerDown={onPointerDown}
      onDoubleClick={() => save(null)}
      onKeyDown={onKeyDown}
    />
  );
}

/** The edge above the prompt: drag it up to give the bottom pane (attackers, blockers, choices) more of the rail, down to give the stack more. */
export function RailShareHandle({ board, share }: HandleProps) {
  const parts = () => {
    const top = board.current?.querySelector<HTMLElement>('.rail-top')?.getBoundingClientRect().height ?? 0;
    const prompt = board.current?.querySelector<HTMLElement>('.board-prompt')?.getBoundingClientRect().height ?? 0;
    return { top, prompt, span: top + prompt };
  };
  const now = () => {
    const p = parts();
    return share ?? (p.span > 0 ? p.prompt / p.span : 0.5);
  };
  const save = (v: number | null) => settingsStore().update({ railPromptShare: v === null ? null : Math.round(v * 1000) / 1000 });
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const start = parts();
    const y0 = e.clientY;
    let v = now();
    drag(
      e,
      (ev) => {
        if (start.span <= 0) return;
        v = clamp((start.prompt + (y0 - ev.clientY)) / start.span, RAIL_SHARE_MIN, RAIL_SHARE_MAX);
        apply(board.current, null, v);
      },
      () => save(v),
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const by = e.key === 'ArrowUp' ? SHARE_STEP : e.key === 'ArrowDown' ? -SHARE_STEP : 0;
    if (e.key === 'Home') save(null);
    else if (by !== 0) save(clamp(now() + by, RAIL_SHARE_MIN, RAIL_SHARE_MAX));
    else return;
    e.preventDefault();
  };
  return (
    <div
      className="rail-resize rail-resize-y"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the bottom panel (double-click for the default size)"
      aria-valuemin={Math.round(RAIL_SHARE_MIN * 100)}
      aria-valuemax={Math.round(RAIL_SHARE_MAX * 100)}
      aria-valuenow={Math.round(now() * 100)}
      tabIndex={0}
      title="Drag to resize the bottom panel; double-click for the default size"
      onPointerDown={onPointerDown}
      onDoubleClick={() => save(null)}
      onKeyDown={onKeyDown}
    />
  );
}
