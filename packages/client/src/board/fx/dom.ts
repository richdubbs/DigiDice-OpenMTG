/**
 * Where things are on the board, for the animations (ui/arena). Before the new view is shown the animator measures every card picture, identity disc and pile;
 * afterwards it measures again. Cards that left keep their measured picture element: React has removed it from the page, so the animator can put that very
 * element into the fx layer as a "ghost" and play its exit there (nothing new is rendered, nothing is ever drawn over a card picture on the board).
 *
 * The board marks what the animations need: `data-object-id` on cards, `data-fx="avatar"` + `data-player-id` on identity discs, `data-fx="pile"` +
 * `data-pile` on piles, `data-fx="hand"` on hands, `data-stack-id` on stack entries, `data-fx="stack-anchor"` where a new stack entry appears.
 */
export interface Box {
  /** Centre, viewport pixels. */
  x: number;
  y: number;
  /** Layout size (before transforms). */
  w: number;
  h: number;
}

export interface CardEntry extends Box {
  /** The card's outer element (`.board-card` or `.hand-back`). */
  el: HTMLElement;
  /** The picture box that ghosts copy (`.board-card-image`, or the back itself). */
  image: HTMLElement;
  /** The picture box's own transform (tapped, flipped), kept on its ghost. */
  transform: string;
  /** Drawn with a Scryfall image: its exits never crop, filter or fade it (ARCHITECTURE.md "Card images"). */
  scryfall: boolean;
  /**
   * Where the card was: 'hand' (face up in a hand: the viewer's own, or any hand in a replay's open view), 'battlefield', 'stack', 'back' (another
   * player's hand).
   */
  zone: string;
}

export interface BoardSnapshot {
  cards: Map<string, CardEntry>;
  /** Stack entries by stack object id: the entry's card or ability tile. */
  stack: Map<string, CardEntry>;
  avatars: Map<string, Box & { el: HTMLElement }>;
  /** `${player}:${pile}` → pile box. */
  piles: Map<string, Box & { el: HTMLElement }>;
  hands: Map<string, Box>;
  stackAnchor: Box | null;
}

function boxOf(el: Element, layoutEl: HTMLElement = el as HTMLElement): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: layoutEl.offsetWidth || r.width, h: layoutEl.offsetHeight || r.height };
}

/**
 * The picture's own transform. A card back in another player's hand is fanned by its inline style; a card picture is turned only by its card's classes
 * (board.css: `.is-tapped`, a mana source picked in a payment, `.hl-selected`), so only those cards have their computed style read: a board of 60
 * permanents read every one of them at each measurement.
 */
function pictureTransform(el: HTMLElement, image: HTMLElement): string {
  if (image.style.transform) return image.style.transform;
  if (!el.matches('.is-tapped, .hl-selected')) return '';
  const t = getComputedStyle(image).transform;
  return t && t !== 'none' ? t : '';
}

function entryOf(el: HTMLElement, zone: string): CardEntry {
  const image = (el.matches('.board-card') ? el.querySelector<HTMLElement>(':scope > .board-card-image') : el) ?? el;
  const b = boxOf(image, image);
  return { ...b, el, image, transform: pictureTransform(el, image), scryfall: image.querySelector('img[data-source="scryfall"]') !== null, zone };
}

/** Measure the board (`root`: the `.game-board`). Cards inside an open zone viewer or the fx layer are skipped. */
export function snapshotBoard(root: HTMLElement): BoardSnapshot {
  const snap: BoardSnapshot = { cards: new Map(), stack: new Map(), avatars: new Map(), piles: new Map(), hands: new Map(), stackAnchor: null };
  for (const el of root.querySelectorAll<HTMLElement>('[data-object-id]')) {
    if (el.closest('.zone-viewer, .fx-overlay, .zoom')) continue;
    const id = el.dataset.objectId!;
    const inStack = el.closest('[data-stack-id]');
    if (inStack) continue; // measured below with its entry
    const zone = el.classList.contains('hand-back') ? 'back' : el.closest('.hand-own, .hand-open') ? 'hand' : 'battlefield';
    if (!snap.cards.has(id)) snap.cards.set(id, entryOf(el, zone));
  }
  for (const li of root.querySelectorAll<HTMLElement>('[data-stack-id]')) {
    const card = li.querySelector<HTMLElement>('.stack-card');
    if (!card) continue;
    const inner = card.querySelector<HTMLElement>('.board-card') ?? card.querySelector<HTMLElement>('.ability-tile') ?? card;
    const e = entryOf(inner, 'stack');
    snap.stack.set(li.dataset.stackId!, e);
    if (!snap.cards.has(li.dataset.stackId!)) snap.cards.set(li.dataset.stackId!, e);
  }
  // ui/arena: the pile on the table (Arena style) stands for the stack wherever it is drawn: flights onto and off the stack use it, not the rail's list.
  for (const t of root.querySelectorAll<HTMLElement>('[data-table-stack-id]')) {
    const img = t.querySelector<HTMLElement>('.board-card-image, .ability-tile');
    if (!img) continue;
    const e = entryOf(img, 'stack');
    snap.stack.set(t.dataset.tableStackId!, e);
    snap.cards.set(t.dataset.tableStackId!, e);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-fx="avatar"][data-player-id]')) {
    const disc = el.querySelector<HTMLElement>('.avatar-disc') ?? el;
    snap.avatars.set(el.dataset.playerId!, { ...boxOf(disc, disc), el: disc });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-fx="pile"][data-player-id]')) {
    const art = el.querySelector<HTMLElement>('.pile-art') ?? el;
    snap.piles.set(`${el.dataset.playerId}:${el.dataset.pile}`, { ...boxOf(art, art), el });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-fx="hand"][data-player-id]')) snap.hands.set(el.dataset.playerId!, boxOf(el));
  const anchor = root.querySelector<HTMLElement>('[data-fx="stack-anchor"]');
  const list = root.querySelector<HTMLElement>('.stack-list');
  const pile = root.querySelector<HTMLElement>('[data-fx="table-stack-anchor"]');
  if (pile) {
    const r = pile.getBoundingClientRect();
    snap.stackAnchor = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  } else if (list) {
    const r = list.getBoundingClientRect();
    snap.stackAnchor = { x: r.left + r.width * 0.32, y: r.bottom - 60, w: 96, h: 134 };
  } else if (anchor) {
    const r = anchor.getBoundingClientRect();
    snap.stackAnchor = { x: r.left + Math.min(70, r.width / 2), y: r.top - 70, w: 96, h: 134 };
  }
  return snap;
}

/**
 * Whether a card's picture is still on its way: its text frame stands in for it while an uploaded image is read or the Scryfall URL is looked up (the
 * frame is marked `data-picture-pending`), or its image has not finished loading. A ghost made now would show the stand-in, and the real card would change
 * its picture when it landed.
 */
/** The artist of the Scryfall picture in a card's picture box (CardPicture's `data-artist`), or null: uploads and our own frames name none. */
export function pictureArtist(image: HTMLElement): string | null {
  return image.querySelector('img[data-source="scryfall"][data-artist]')?.getAttribute('data-artist') || null;
}

export function picturePending(el: HTMLElement): boolean {
  if (el.querySelector('[data-picture-pending]')) return true;
  for (const img of el.querySelectorAll('img')) if (!img.complete) return true;
  return false;
}

/** The box a target id refers to: a card picture, or a player's identity disc. */
export function targetBox(snap: BoardSnapshot, id: string): Box | null {
  return snap.cards.get(id) ?? snap.avatars.get(id) ?? null;
}

/**
 * A ghost of a card picture in the fx layer, centred on `at` (viewport pixels) at the picture's layout size, with the picture's own transform (tapped,
 * flipped). `reuse`: put the original element itself in the ghost (it has left the page); otherwise a copy is drawn, and the caller hides the original.
 */
export function makeGhost(layer: HTMLElement, e: CardEntry, at: Box = e, reuse = false, lr: DOMRect = layer.getBoundingClientRect()): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'fx-ghost';
  wrap.style.left = `${at.x - lr.left - e.w / 2}px`;
  wrap.style.top = `${at.y - lr.top - e.h / 2}px`;
  wrap.style.width = `${e.w}px`;
  wrap.style.height = `${e.h}px`;
  // Its shadows and glows (glowLayer) lie in a box turned like the picture, behind it.
  const under = document.createElement('div');
  under.className = 'fx-ghost-under';
  under.style.width = `${e.w}px`;
  under.style.height = `${e.h}px`;
  if (e.transform) under.style.transform = e.transform;
  wrap.appendChild(under);
  const inner = reuse && !e.image.isConnected ? e.image : (e.image.cloneNode(true) as HTMLElement);
  dropGlows(inner);
  inner.removeAttribute('id');
  inner.style.width = `${e.w}px`;
  inner.style.height = `${e.h}px`;
  inner.style.transform = e.transform;
  inner.style.transition = 'none';
  inner.style.margin = '0';
  // A copy of a picture the animator already hid must show in the fx layer.
  inner.style.visibility = '';
  inner.classList.add('fx-ghost-image');
  // The copy keeps the picture the card shows (the same URL, already loaded): it paints in its first frame, not after an asynchronous decode.
  for (const img of inner.querySelectorAll('img')) img.decoding = 'sync';
  wrap.appendChild(inner);
  layer.appendChild(wrap);
  return wrap;
}

/** The box a ghost's shadows and glows lie in (makeGhost), behind its picture. */
export function ghostUnder(g: HTMLElement): HTMLElement {
  return g.querySelector<HTMLElement>(':scope > .fx-ghost-under') ?? g;
}

/**
 * Where a glow around an element on the board goes: a card's picture box (behind the picture: the card is a stacking context, arena.css), a ghost's
 * box behind its picture, the pile's place for an ability tile on the table (the tile clips what is outside it), or the element itself (a disc, a tile).
 */
export function glowHost(el: HTMLElement): HTMLElement {
  if (el.matches('.fx-ghost')) return ghostUnder(el);
  if (el.matches('.board-card')) return el.querySelector<HTMLElement>(':scope > .board-card-image') ?? el;
  if (el.matches('.ability-tile') && el.parentElement?.matches('.table-stack-item')) return el.parentElement;
  return el;
}

/**
 * A light or a shadow around `host`, painted once: a transparent box the size of the host with `shadow` as its box shadow (drawn only outside the box, so
 * never on a picture), behind the host's content (arena.css `.fx-glow`), hidden until its opacity is animated. One per `key`; its shadow is set again
 * when it changes.
 */
export function glowLayer(host: HTMLElement, key: string, shadow: string): HTMLElement {
  let el = host.querySelector<HTMLElement>(`:scope > .fx-glow[data-glow="${key}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'fx-glow';
    el.dataset.glow = key;
    host.appendChild(el);
  }
  if (el.dataset.shadow !== shadow) {
    el.dataset.shadow = shadow;
    el.style.boxShadow = shadow;
  }
  return el;
}

/** Take the glows out of a copy of a picture (one may have been lit on the card when it was copied). */
export function dropGlows(el: HTMLElement): void {
  for (const g of el.querySelectorAll(':scope > .fx-glow')) g.remove();
}

/** Pieces of a rectangle for a shatter: triangles fanned from an impact point (percent coordinates for clip-path). */
export function shardPolygons(impact: { x: number; y: number }, rings = 2, spokes = 9, seed = 3): string[] {
  let r = seed;
  const rnd = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  // Points around the border, in order, then rays from the impact point to them.
  const border: { x: number; y: number }[] = [];
  for (let i = 0; i < spokes * 2; i++) {
    const t = (i + rnd() * 0.6) / (spokes * 2);
    const p = t * 4;
    const side = Math.floor(p);
    const f = p - side;
    border.push(side === 0 ? { x: f * 100, y: 0 } : side === 1 ? { x: 100, y: f * 100 } : side === 2 ? { x: 100 - f * 100, y: 100 } : { x: 0, y: 100 - f * 100 });
  }
  const out: string[] = [];
  for (let i = 0; i < border.length; i++) {
    const a = border[i]!;
    const b = border[(i + 1) % border.length]!;
    // Split each wedge into `rings` bands between the impact point and the border.
    let prevA = impact;
    let prevB = impact;
    for (let k = 1; k <= rings; k++) {
      const f = k === rings ? 1 : k / rings + (rnd() - 0.5) * 0.18;
      const na = { x: impact.x + (a.x - impact.x) * f, y: impact.y + (a.y - impact.y) * f };
      const nb = { x: impact.x + (b.x - impact.x) * f, y: impact.y + (b.y - impact.y) * f };
      const pts = k === 1 ? [impact, na, nb] : [prevA, na, nb, prevB];
      out.push(`polygon(${pts.map((p) => `${p.x.toFixed(1)}% ${p.y.toFixed(1)}%`).join(', ')})`);
      prevA = na;
      prevB = nb;
    }
  }
  return out;
}

/**
 * Big pieces of a rectangle for a card breaking apart: a jittered `cols` x `rows` grid (inner corners moved, border corners kept on the border), some
 * cells split along a diagonal, as clip-path polygons in percent, each with its middle (where it turns and where it flies from). At most `max` pieces:
 * a cell is split only while the pieces still fit (each piece is a copy of the whole card).
 */
export function chunkPolygons(cols = 3, rows = 3, seed = 5, max = Infinity): { clip: string; cx: number; cy: number }[] {
  let r = seed;
  const rnd = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  const pt: { x: number; y: number }[][] = [];
  for (let j = 0; j <= rows; j++) {
    const line: { x: number; y: number }[] = [];
    for (let i = 0; i <= cols; i++) {
      const edgeX = i === 0 || i === cols;
      const edgeY = j === 0 || j === rows;
      const x = (i / cols) * 100 + (edgeX ? 0 : (rnd() - 0.5) * (60 / cols));
      const y = (j / rows) * 100 + (edgeY ? 0 : (rnd() - 0.5) * (60 / rows));
      line.push({ x, y });
    }
    pt.push(line);
  }
  const out: { clip: string; cx: number; cy: number }[] = [];
  const poly = (ps: { x: number; y: number }[]) => {
    const cx = ps.reduce((n, p) => n + p.x, 0) / ps.length;
    const cy = ps.reduce((n, p) => n + p.y, 0) / ps.length;
    out.push({ clip: `polygon(${ps.map((p) => `${p.x.toFixed(1)}% ${p.y.toFixed(1)}%`).join(', ')})`, cx, cy });
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = pt[j]![i]!;
      const b = pt[j]![i + 1]!;
      const c = pt[j + 1]![i + 1]!;
      const d = pt[j + 1]![i]!;
      // The cells after this one still need a piece each.
      const left = rows * cols - (j * cols + i) - 1;
      if (rnd() < 0.35 && out.length + 2 + left <= max) {
        if (rnd() < 0.5) {
          poly([a, b, c]);
          poly([a, c, d]);
        } else {
          poly([a, b, d]);
          poly([b, c, d]);
        }
      } else poly([a, b, c, d]);
    }
  }
  return out;
}
