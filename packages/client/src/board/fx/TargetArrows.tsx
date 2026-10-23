/**
 * Arrows across the table (ui/arena, Arena style): from the spell or ability on top of the stack to what it targets (CR 115.1, 601.2c; the one under the
 * pointer in the stack panel too), from the spell being cast to the targets picked so far and to the pointer while the viewer chooses targets, from each
 * attacker to what it attacks and from each blocker to the attacker it blocks (CR 508.1, 509.1).
 *
 * The arrows run along the table UNDER the cards and end at the edge of what they point at, so they never cross a card picture (ARCHITECTURE.md "Card
 * images"); an arrow from the stack in the side rail starts at the table's edge beside it. They follow the cards every frame while there is anything to
 * point at (cards move during animations), and are hidden from screen readers (the markers and the stack panel say the same in text).
 *
 * Perf: nothing here goes through React state. The arrow that follows the pointer is written in the
 * pointer event itself, from rectangles measured in the last frame, so it is on screen in the same frame as the pointer, with no easing; the frame loop
 * looks the elements up once (not a selector per arrow per frame), reads every rectangle first and only then writes the paths, and writes nothing when a
 * path did not change.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useBoard } from '../context';
import { stackItems } from '../model';
import { decidingPlayer } from '@openmtg/engine';

type Kind = 'target' | 'focus' | 'choose' | 'pointer' | 'attack' | 'block';

interface Spec {
  key: string;
  from: string;
  /** A selector, or null for the pointer. */
  to: string | null;
  kind: Kind;
}

/** The stack object's card: in the pile on the table when it is drawn (Arena style), else in the rail (querySelector takes the first in page order). */
const stackSel = (id: string) => `[data-table-stack-id="${id}"] .board-card-image, [data-table-stack-id="${id}"] .ability-tile, [data-stack-id="${id}"] .stack-card`;

function cardSel(id: string): string {
  return `.board-card[data-object-id="${id}"] > .board-card-image`;
}
function targetSel(id: string, players: ReadonlySet<string>): string {
  if (players.has(id)) return `[data-fx="avatar"][data-player-id="${id}"] .avatar-disc`;
  return `${cardSel(id)}, ${stackSel(id)}`;
}

const NS = 'http://www.w3.org/2000/svg';
/** The browser sends both kinds; a move is handled twice at worst, and the second finds nothing to change. */
const MOVE = ['pointermove', 'mousemove'] as const;
const LEAVE = ['pointerleave', 'mouseleave'] as const;
const HIT ='[data-object-id], [data-fx="avatar"][data-player-id], [data-stack-id], [data-table-stack-id]';

/** What the geometry reads of a DOMRect (M12-4a: on the shared table these are the projected rectangles `getBoundingClientRect` reports under the camera). */
export type RectLike = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;

/**
 * M12-4a (m12 design D15, 5.3 item 2; inventory C15): what each attacker being declared points at: its own picked target (`attackTargets`, from the
 * prompt); without picked targets, the one opponent of a two-player game (as before); with several possible defenders and no pick, nothing (there is no
 * default). Pure.
 */
export function pendingAttackArrows(viewer: string | null, players: readonly { id: string; hasLost: boolean }[], selected: Iterable<string>, attackTargets: Readonly<Record<string, string>> | undefined): { attacker: string; target: string }[] {
  const out: { attacker: string; target: string }[] = [];
  const opponents = players.filter((p) => p.id !== viewer && !p.hasLost);
  for (const id of selected) {
    const picked = attackTargets?.[id];
    if (picked) out.push({ attacker: id, target: picked });
    else if (!attackTargets && opponents.length === 1) out.push({ attacker: id, target: opponents[0]!.id });
  }
  return out;
}

/** The path of one arrow, in the svg's own pixels; null when an end is missing. `to` is a rectangle, or the pointer. Pure (reads only what it is given). */
export function arrowPath(box: RectLike, arena: RectLike, fr: RectLike, toRect: RectLike | null, toPoint: { x: number; y: number } | null): string | null {
  if (!toRect && !toPoint) return null;
  // From the side rail, start at the table's right edge level with the stack entry.
  let sx = fr.left + fr.width / 2;
  let sy = fr.top + fr.height / 2;
  if (sx > arena.right) {
    sx = arena.right - 4;
    sy = Math.min(Math.max(sy, arena.top + 20), arena.bottom - 20);
  }
  let tx = toRect ? toRect.left + toRect.width / 2 : toPoint!.x;
  let ty = toRect ? toRect.top + toRect.height / 2 : toPoint!.y;
  // Leave the source card's edge and stop at the target's edge (never across either picture).
  const clip = (r: RectLike, x0: number, y0: number, x1: number, y1: number, pad: number) => {
    const hw = r.width / 2 + pad;
    const hh = r.height / 2 + pad;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = x0 - cx;
    const dy = y0 - cy;
    const t = Math.min(hw / Math.max(1e-6, Math.abs(dx)), hh / Math.max(1e-6, Math.abs(dy)));
    return t < 1 ? { x: cx + dx * t, y: cy + dy * t } : { x: x1, y: y1 };
  };
  if (fr.left + fr.width / 2 <= arena.right) {
    const a = clip(fr, tx, ty, sx, sy, 4);
    sx = a.x;
    sy = a.y;
  }
  if (toRect) {
    const b = clip(toRect, sx, sy, tx, ty, 10);
    tx = b.x;
    ty = b.y;
  }
  const x0 = sx - box.left;
  const y0 = sy - box.top;
  const x1 = tx - box.left;
  const y1 = ty - box.top;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const bow = Math.min(90, len * 0.22);
  const cx = mx + ((y0 - y1) / (len || 1)) * bow * (x1 > x0 ? 1 : -1) * 0.5;
  const cy = my - bow * 0.6;
  return `M${x0.toFixed(1)},${y0.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

/** One arrow on the page: its two paths, the elements it joins (looked up once) and the last path written. */
interface Live {
  spec: Spec;
  glow: SVGPathElement;
  line: SVGPathElement;
  from: Element | null;
  to: Element | null;
  d: string;
}

export function TargetArrows() {
  const board = useBoard();
  const { view, focusStack, selected, selectable } = board;
  const svgRef = useRef<SVGSVGElement>(null);

  const players = useMemo(() => new Set(view.players.map((p) => p.id)), [view.players]);
  const specs = useMemo<Spec[]>(() => {
    const out: Spec[] = [];
    const items = stackItems(view);
    const mine = view.pending !== null && view.pending !== undefined && decidingPlayer(view.pending) === view.viewer && view.viewer !== null;
    const choosing = mine && view.pending?.kind === 'chooseTargets';
    const top = items[0];
    if (top) {
      const from = stackSel(top.id);
      if (choosing) {
        for (const id of selected) out.push({ key: `c:${id}`, from, to: targetSel(id, players), kind: 'choose' });
        const max = view.pending?.kind === 'chooseTargets' ? view.pending.max : 0;
        if (selected.size < max) out.push({ key: 'pointer', from, to: null, kind: 'pointer' });
      } else {
        top.targets.forEach((t, i) => out.push({ key: `t:${top.id}:${t}:${i}`, from, to: targetSel(t, players), kind: focusStack === top.id ? 'focus' : 'target' }));
      }
    }
    if (focusStack && focusStack !== top?.id) {
      const it = items.find((x) => x.id === focusStack);
      it?.targets.forEach((t, i) => out.push({ key: `f:${it.id}:${t}:${i}`, from: stackSel(it.id), to: targetSel(t, players), kind: 'focus' }));
    }
    const c = view.combat;
    if (c && c.attackers.length > 0) {
      // A blocked attacker points at its blockers through their block arrows, not at the defender (CR 509.1h).
      for (const a of c.attackers) if (a.defender && !a.blocked) out.push({ key: `a:${a.id}`, from: cardSel(a.id), to: targetSel(a.defender, players), kind: 'attack' });
      for (const b of c.blockers) for (const at of b.blocking) out.push({ key: `b:${b.id}:${at}`, from: cardSel(b.id), to: cardSel(at), kind: 'block' });
    } else if (mine && view.pending?.kind === 'declareAttackers') {
      // Attackers picked but not declared yet: each points at its own target (M12-4a), or at the one opponent of a two-player game.
      for (const a of pendingAttackArrows(view.viewer, view.players, selected, board.interaction.attackTargets)) {
        out.push({ key: `pa:${a.attacker}:${a.target}`, from: cardSel(a.attacker), to: targetSel(a.target, players), kind: 'attack' });
      }
    }
    return out;
  }, [view, focusStack, selected, players, board.interaction.attackTargets]);

  // What the arrows are is a function of this text, not of the array's identity: the board draws again for many reasons (every change, every hover), and the
  // arrows are only rebuilt when one of them is new or gone.
  const signature = specs.map((s) => `${s.key}|${s.kind}|${s.from}|${s.to ?? ''}`).join('\n');
  const specsRef = useRef(specs);
  specsRef.current = specs;
  // The board drew again: the elements the arrows joined may have been replaced, so the frame loop looks them up again.
  const epoch = useRef(0);
  useLayoutEffect(() => {
    epoch.current++;
  });
  // The pointer survives a rebuild of the arrows (picking a target adds one), so the live arrow does not wait for the next move.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const selectableRef = useRef(selectable);
  selectableRef.current = selectable;
  const playersRef = useRef(players);
  playersRef.current = players;

  useEffect(() => {
    const svg = svgRef.current;
    const g = svg?.querySelector('g.arrows');
    const root = svg?.closest<HTMLElement>('.game-board');
    if (!svg || !g || !root) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    const list = specsRef.current;
    if (list.length === 0 || typeof requestAnimationFrame !== 'function') return;
    const live: Live[] = [];
    for (const spec of list) {
      const glow = document.createElementNS(NS, 'path');
      glow.setAttribute('class', `arrow-glow arrow-${spec.kind}`);
      const line = document.createElementNS(NS, 'path');
      line.setAttribute('class', `arrow-line arrow-${spec.kind}`);
      line.setAttribute('marker-end', `url(#arrowhead-${spec.kind})`);
      g.appendChild(glow);
      g.appendChild(line);
      live.push({ spec, glow, line, from: null, to: null, d: '' });
    }
    const pointerArrow = live.find((l) => l.spec.to === null) ?? null;

    // The pointer, and what choosable it is over (the live arrow snaps to it).
    let pointer = pointerRef.current;
    let hoverId: string | null = null;
    let hoverEl: Element | null = null;
    // The rectangles of the last frame: what the pointer's own write reads, so it never has to measure (and never forces a layout).
    let box: DOMRect | null = null;
    let arena: DOMRect | null = null;
    let pointerFrom: DOMRect | null = null;
    let hoverRect: DOMRect | null = null;

    const set = (l: Live, d: string) => {
      if (l.d === d) return;
      l.d = d;
      l.line.setAttribute('d', d);
      l.glow.setAttribute('d', d);
    };
    /** The live arrow, now, from the rectangles already measured. */
    const writePointer = () => {
      if (!pointerArrow) return;
      const d = box && arena && pointerFrom ? arrowPath(box, arena, pointerFrom, hoverRect, pointer) : null;
      set(pointerArrow, d ?? '');
    };
    const onMove = (e: Event) => {
      const m = e as MouseEvent;
      pointer = pointerRef.current = { x: m.clientX, y: m.clientY };
      const hit = (m.target as Element | null)?.closest?.(HIT) as HTMLElement | null;
      const id = hit?.dataset.objectId ?? hit?.dataset.playerId ?? hit?.dataset.stackId ?? hit?.dataset.tableStackId ?? null;
      const next = id && selectableRef.current.has(id) ? id : null;
      if (next !== hoverId) {
        hoverId = next;
        hoverEl = null;
        hoverRect = null;
      }
      writePointer();
    };
    const onLeave = () => {
      pointer = pointerRef.current = null;
      hoverId = null;
      hoverEl = null;
      hoverRect = null;
      writePointer();
    };
    if (pointerArrow) {
      for (const type of MOVE) root.addEventListener(type, onMove);
      for (const type of LEAVE) root.addEventListener(type, onLeave);
    }

    let seen = -1;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      // Look the elements up again only when the board drew again (a selector over the whole board is the costly part), or when one has left the page.
      const stale = seen !== epoch.current;
      seen = epoch.current;
      for (const l of live) {
        if (stale || !l.from?.isConnected) l.from = root.querySelector(l.spec.from);
        if (l.spec.to !== null && (stale || !l.to?.isConnected)) l.to = root.querySelector(l.spec.to);
      }
      if (pointerArrow && hoverId !== null && (stale || !hoverEl?.isConnected)) hoverEl = root.querySelector(targetSel(hoverId, playersRef.current));
      // Read every rectangle first ...
      box = svg.getBoundingClientRect();
      arena = svg.parentElement!.getBoundingClientRect();
      const rects = new Map<Element, DOMRect>();
      const rect = (el: Element | null): DOMRect | null => {
        if (!el) return null;
        let r = rects.get(el);
        if (!r) {
          r = el.getBoundingClientRect();
          rects.set(el, r);
        }
        return r;
      };
      const paths = live.map((l) => {
        const fr = rect(l.from);
        if (l === pointerArrow) {
          pointerFrom = fr;
          hoverRect = hoverId !== null ? rect(hoverEl) : null;
          return fr ? arrowPath(box!, arena!, fr, hoverRect, pointer) : null;
        }
        if (!fr) return null;
        const tr = rect(l.to);
        return tr ? arrowPath(box!, arena!, fr, tr, null) : null;
      });
      // ... then write the paths.
      live.forEach((l, i) => set(l, paths[i] ?? ''));
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      for (const type of MOVE) root.removeEventListener(type, onMove);
      for (const type of LEAVE) root.removeEventListener(type, onLeave);
    };
  }, [signature]);

  return (
    <svg className="fx-arrows" ref={svgRef} aria-hidden="true">
      <defs>
        {(['target', 'focus', 'choose', 'pointer', 'attack', 'block'] as const).map((k) => (
          <marker key={k} id={`arrowhead-${k}`} className={`arrowhead arrow-${k}`} viewBox="0 0 12 12" refX="7" refY="6" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L12,6 L0,12 L3,6 Z" />
          </marker>
        ))}
      </defs>
      <g className="arrows" />
    </svg>
  );
}
