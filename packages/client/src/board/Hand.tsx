/**
 * Hands (CR 402). The viewer's own hand is fanned face up along the bottom edge; every other player's hand is a fan of card backs with a count (CR 402.3:
 * hidden zone, the number of cards is public). A card of another player's hand that was revealed to the viewer (Thoughtseize, CR 701.20b) stays face up in
 * that fan for as long as it stays in the hand: the view shows it only to the players it was revealed to, so on a hot-seat screen it is never shown to
 * anyone else. The one exception is a replay's open view (`view.open`, core/view.ts#openView, replays design 6), which is never a live view: there
 * every hand is face up, the bottom seat's in the fan along the bottom edge and every other player's in a row of small cards at their edge (`OpenHand`).
 *
 * The own hand sits in the middle of the bottom edge, between the piles and the action buttons, and never takes more than that column's width: its cards keep the hand size while they fit, edge to edge, then overlap Arena style, each covering the edge of the one before it (the
 * card under the pointer comes to the front). While Scryfall images can be on screen (`data-overlap="no"` on the board) a picture is never covered
 * (ARCHITECTURE.md "Card images"), so the cards shrink to share the column instead (`--hand-cw` from `--hand-n`). The fan is a gentle arc, not a turn.
 * Pointing at a card raises it toward the player (or the keyboard focus: the focus a click or a drag leaves behind doesn't keep a card up, board.css).
 * Lands the player may play from their graveyard right now (Crucible of Worlds, CR 305.1) join the hand at its right end with their own violet glow and a
 * "Graveyard" tag (`graveyardLandPlays`); they play like hand cards but never take part in the hand's own order.
 *
 * Dragging (ui/arena, like Arena): any card can be dragged sideways along the hand to put it somewhere else, the other cards making room as it passes
 *. The order is the player's own (`handOrders`, never sent to the game: CR 402 gives a hand no order); a new card joins at the
 * right. A playable card dragged up out of the hand and let go over the battlefield is played the same way as clicking it (the prompt plays its only action
 * at once or lists its actions); let go anywhere else above the hand, it slides back. A drag never counts as a click. Picking a card up and letting it go
 * past the play line are heard (card.pickup, card.drop), and so is a card set down in a new place (ui.tick); a card that slides back is silent.
 */
import { useEffect, useReducer, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import type { GameView, LegalAction, ObjectId, PlayerId } from '@openmtg/engine';
import { gameSfx } from '../game/sound';
import { useBoard } from './context';
import { CardSlot } from './CardSlot';
import { OwnerSleeve } from './sleeves';
import { CardBack } from './cardRenderer';
import { cardCount, defOf, isHidden, objectName, playerName, shownFace } from './model';

/** The outer cards sit at most this much lower than the middle ones (the arc); the hand's top padding in board.css makes room for it. */
const MAX_ARC_PX = 8;
/** Pixels the pointer must move before a press on a hand card becomes a drag. */
const DRAG_START_PX = 8;
/** How far above the hand's top edge a card must be let go to be played. */
const PLAY_LINE_PX = 24;

function fanStyle(i: number, n: number): CSSProperties {
  const mid = (n - 1) / 2;
  const t = mid === 0 ? 0 : (i - mid) / mid;
  return { '--arc-y': `${(t * t * MAX_ARC_PX).toFixed(1)}px` } as CSSProperties;
}

/** The hand in the player's own order: the cards of `saved` still in the hand, in that order, then the others (new cards) in the view's order. */
export function arrangeHand(saved: readonly ObjectId[] | undefined, ids: readonly ObjectId[]): ObjectId[] {
  if (!saved || saved.length === 0) return [...ids];
  const inHand = new Set(ids);
  const kept = saved.filter((id) => inHand.has(id));
  const placed = new Set(kept);
  return [...kept, ...ids.filter((id) => !placed.has(id))];
}

/** `list` with `id` taken out and put back at index `to` (an index into the list without it). */
export function moveInHand(list: readonly ObjectId[], id: ObjectId, to: number): ObjectId[] {
  const rest = list.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id);
  return rest;
}

interface Drag {
  x: number;
  y: number;
  on: boolean;
  pointer: number;
  /** Measured when the card is picked up: the play line, the hand's cards, their centres and the distance between two neighbours. */
  line?: number;
  cards?: HTMLElement[];
  centers?: number[];
  step?: number;
  from?: number;
  /** Where the card would go in the hand (an index into the hand without it), or null while it is above the play line. */
  to?: number | null;
}

/** Pointer capture, when the pointer is still there to capture (a pointer that is gone throws). */
function capture(el: HTMLElement, pointer: number, on: boolean): void {
  try {
    if (on) el.setPointerCapture?.(pointer);
    else el.releasePointerCapture?.(pointer);
  } catch {
    // the pointer went away: nothing to capture or release
  }
}

function clearShifts(cards: readonly HTMLElement[] | undefined): void {
  for (const c of cards ?? []) c.style.removeProperty('--shift-x');
}

/**
 * Lands the player may play from their graveyard right now ("You may play lands from your graveyard", Crucible of Worlds, CR 305.1):
 * the cards of the player's own graveyard the game offers a land play for. They are shown at the right end of the hand, with their own glow.
 */
export function graveyardLandPlays(view: GameView, legal: readonly LegalAction[], player: PlayerId): ObjectId[] {
  const offered = new Set(legal.filter((a) => a.kind === 'playLand' && a.object !== undefined).map((a) => a.object!));
  return (view.zones.graveyard[player] ?? []).filter((id) => offered.has(id));
}

function HandCard({ id, i, n, onMove, from }: { id: ObjectId; i: number; n: number; onMove: (id: ObjectId, to: number) => void; from?: 'graveyard' }) {
  const board = useBoard();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const canPlay = board.playable.has(id) && board.interaction.onObjectClick !== undefined;

  const reset = (el: HTMLDivElement) => {
    el.classList.remove('is-dragging', 'will-play');
    el.style.removeProperty('--drag-x');
    el.style.removeProperty('--drag-y');
  };
  // The press is followed on the window, not just on this card: a quick flick whose first move already lands on another card still drags this one. (The
  // pointer is captured only once the drag starts: captured at the press, the click would go to this box instead of the card in it.)
  const follow = useRef<{ move: (e: PointerEvent) => void; end: (e: PointerEvent, cancelled: boolean) => void } | null>(null);
  const unfollow = useRef<(() => void) | null>(null);
  useEffect(() => () => unfollow.current?.(), []);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    unfollow.current?.();
    const pointer = e.pointerId;
    drag.current = { x: e.clientX, y: e.clientY, on: false, pointer };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === pointer) follow.current?.move(ev);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      unfollow.current?.();
      follow.current?.end(ev, ev.type === 'pointercancel');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    unfollow.current = () => {
      unfollow.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  };
  // The cards between where the dragged card was and where it would go slide one place toward its old spot, making room for it.
  const makeRoom = (d: Drag, to: number | null) => {
    if (d.to === to) return;
    d.to = to;
    const from = d.from ?? 0;
    d.cards?.forEach((c, j) => {
      if (j === from) return;
      const k = j < from ? j : j - 1;
      const shift = to === null ? 0 : ((k < to ? k : k + 1) - j) * (d.step ?? 0);
      if (shift) c.style.setProperty('--shift-x', `${shift}px`);
      else c.style.removeProperty('--shift-x');
    });
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || e.pointerId !== d.pointer) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.on) {
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      d.on = true;
      // Measured once, before the card is lifted (a measurement after a style write forces a layout on every move).
      const hand = el.closest<HTMLElement>('.hand-own');
      d.line = (hand?.getBoundingClientRect().top ?? -Infinity) - PLAY_LINE_PX;
      d.cards = hand ? [...hand.querySelectorAll<HTMLElement>(':scope > .hand-card')] : [el];
      d.centers = d.cards.map((c) => {
        const r = c.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      d.from = Math.max(0, d.cards.indexOf(el));
      d.step = d.centers.length > 1 ? (d.centers[d.centers.length - 1]! - d.centers[0]!) / (d.centers.length - 1) : 0;
      d.to = d.from;
      capture(el, e.pointerId, true);
      el.classList.add('is-dragging');
      board.setZoom(null);
      gameSfx('card.pickup');
    }
    el.style.setProperty('--drag-x', `${dx}px`);
    el.style.setProperty('--drag-y', `${dy}px`);
    const above = e.clientY < d.line!;
    el.classList.toggle('will-play', above && canPlay);
    let to: number | null = null;
    if (!above) {
      to = 0;
      d.centers!.forEach((c, j) => {
        if (j !== d.from && c < e.clientX) to!++;
      });
    }
    makeRoom(d, to);
  };
  const end = (e: PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (el) capture(el, e.pointerId, false);
    if (!d || !el || !d.on) return;
    suppressClick.current = true;
    const play = !cancelled && canPlay && el.classList.contains('will-play');
    if (!cancelled && !play && from === undefined && d.to != null && d.to !== d.from) {
      // Set down in a new place: the cards are put in their new order and lose their room-making shift in the same frame, with no slide (the shift and
      // the move cancel out); the hand's transitions are back two frames later.
      const hand = el.closest<HTMLElement>('.hand-own');
      hand?.classList.add('is-settling');
      reset(el);
      const to = d.to;
      flushSync(() => onMove(id, to));
      clearShifts(d.cards);
      gameSfx('ui.tick');
      requestAnimationFrame(() => requestAnimationFrame(() => hand?.classList.remove('is-settling')));
      return;
    }
    reset(el);
    clearShifts(d.cards);
    if (play) {
      gameSfx('card.drop');
      board.interaction.onObjectClick?.(id);
    }
  };
  follow.current = { move: onPointerMove, end };
  // The click that follows a drag's pointer-up must not also click the card.
  const onClickCapture = (e: ReactMouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };
  return (
    <div
      ref={ref}
      className={`hand-card is-draggable${from === 'graveyard' ? ' is-from-graveyard' : ''}`}
      style={fanStyle(i, n)}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      {...(from === 'graveyard' ? { 'data-from-zone': 'graveyard', title: 'In your graveyard: you may play it as your land' } : {})}
    >
      <CardSlot id={id} size="normal" />
    </div>
  );
}

export function OwnHand({ player }: { player: PlayerId }) {
  const { view, handOrders, legalActions } = useBoard();
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const ids = arrangeHand(handOrders.get(player), view.zones.hand[player] ?? []);
  // Lands playable from the graveyard join the hand at its right end (they never take part in the hand's own order).
  const extra = graveyardLandPlays(view, legalActions, player);
  const n = ids.length + extra.length;
  const onMove = (id: ObjectId, to: number) => {
    handOrders.set(player, moveInHand(ids, id, to));
    redraw();
  };
  const ignore = () => {};
  return (
    <section
      className="hand hand-own"
      data-fx="hand"
      data-player-id={player}
      aria-label={`${playerName(view, player)}'s hand (${ids.length})${extra.length > 0 ? ` and ${extra.length} land${extra.length === 1 ? '' : 's'} you may play from your graveyard` : ''}`}
      style={{ '--hand-n': Math.max(1, n) } as CSSProperties}
    >
      {ids.map((id, i) => (
        <HandCard key={id} id={id} i={i} n={n} onMove={onMove} />
      ))}
      {extra.map((id, j) => (
        <HandCard key={id} id={id} i={ids.length + j} n={n} onMove={ignore} from="graveyard" />
      ))}
    </section>
  );
}

/**
 * RPL-2 (replays design 6): another player's hand in a replay's open view, where nothing is hidden: their cards face up in a row at their edge, each a
 * card back's width there (the row takes about the room of the backs it replaces), read-only (pointing at one opens the zoom). The cards keep that
 * width while they fit and shrink to share the row otherwise; they overlap, each covering the edge of the one before it, only while card pictures may
 * (board.css `.open-hand-card`, ARCHITECTURE.md "Card images").
 */
export function OpenHand({ player }: { player: PlayerId }) {
  const { view } = useBoard();
  const ids = view.zones.hand[player] ?? [];
  return (
    <section
      className="hand hand-open"
      data-fx="hand"
      data-player-id={player}
      aria-label={`${playerName(view, player)}'s hand (${ids.length})`}
      style={{ '--hand-n': Math.max(1, ids.length) } as CSSProperties}
    >
      {ids.map((id) => (
        <div key={id} className="open-hand-card">
          <CardSlot id={id} size="small" markers={false} />
        </div>
      ))}
    </section>
  );
}

/** Another player's hand: card backs (CR 402.3), or face up in a replay's open view (`OpenHand`). */
export function OtherHand({ player }: { player: PlayerId }) {
  const { view } = useBoard();
  return view.open === true ? <OpenHand player={player} /> : <HiddenHand player={player} />;
}

export function HiddenHand({ player }: { player: PlayerId }) {
  const { view, renderCard, setZoom } = useBoard();
  const ids = view.zones.hand[player] ?? [];
  const shown = ids.slice(0, 12);
  const n = shown.length;
  const known = shown.filter((id) => view.objects[id] !== undefined && !isHidden(view.objects[id]!)).length;
  return (
    <section
      className="hand hand-hidden"
      data-fx="hand"
      data-player-id={player}
      aria-label={`${playerName(view, player)}'s hand: ${cardCount(ids.length)}${known > 0 ? `, ${known} of them seen by you` : ''}`}
    >
      {shown.map((id, i) => {
        const mid = (n - 1) / 2;
        const style = { transform: `rotate(${(mid - i) * 3}deg) translateY(${-Math.abs(i - mid) * 1.6}px)` } as CSSProperties;
        const o = view.objects[id];
        const def = o ? defOf(view, o) : null;
        // A card of this hand the viewer has seen (revealed to them, CR 701.20b, and still the same object, CR 400.7): it stays face up for them, and
        // pointing at it shows it large. The view shows it only to the players it was revealed to (engine core/view.ts `revealedTo`).
        if (o && def) {
          return (
            <div
              key={id}
              className="hand-back is-known"
              data-object-id={id}
              data-face="up"
              style={style}
              role="img"
              tabIndex={0}
              aria-label={`${objectName(view, id)} (seen in ${playerName(view, player)}'s hand)`}
              onMouseEnter={(e) => setZoom(id, e.currentTarget)}
              onMouseLeave={() => setZoom(null)}
              onFocus={(e) => setZoom(id, e.currentTarget)}
              onBlur={() => setZoom(null)}
            >
              <div className="hand-known-card">{renderCard({ def, face: shownFace(def, o), chars: null, size: 'small', faceDown: false })}</div>
            </div>
          );
        }
        return (
          <div key={id} className="hand-back" data-object-id={id} data-face="down" style={style}>
            <OwnerSleeve owner={player}>
              <CardBack size="small" />
            </OwnerSleeve>
          </div>
        );
      })}
      {ids.length > shown.length && <span className="more">+{ids.length - shown.length}</span>}
    </section>
  );
}
