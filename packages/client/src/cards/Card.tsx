/**
 * The card component every screen uses (docs/design/m8-client.md, work package C2): the card's picture (uploaded image > Scryfall image if enabled >
 * our text frame; the DigiDice card back when hidden), tapped rotation (CR 701.26a: turned sideways), flipped rotation (CR 710.2: turned 180 degrees),
 * hover and focus zoom, the face toggle of double-faced cards (CR 712), and a strip under the card with the automation badge and whatever the screen
 * adds (`below`: counters, damage, combat markers). Nothing is ever drawn on top of the card's picture.
 *
 * Only the picture is the card's control (role=button when clickable, otherwise a group that is focusable when it can zoom); the strip under it is a
 * sibling, so its controls (the face toggle, whatever `below` holds) are never nested inside the card's own button.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArtistCredit, creditedName } from './ArtistCredit';
import { AutomationBadge } from './AutomationBadge';
import { CardPicture } from './CardPicture';
import { CardZoom, type ZoomPlacement } from './CardZoom';
import { activeFaceName, isTwoSided, shownFace, type CardModel } from './model';
import { useImageCredit } from './useCardImage';
import './cards.css';

export type CardSize = 'small' | 'normal' | 'large';

export interface CardProps {
  /** The card; null for a hidden card (an opponent's hand, a library): the DigiDice card back. */
  card: CardModel | null;
  /** Side shown of a double-faced card (GameObject.face). */
  face?: number;
  /** Tapped (CR 701.26a): turned sideways. */
  tapped?: boolean;
  /** A flipped flip card (CR 710.2): turned upside down; its flipped half's characteristics apply. */
  flipped?: boolean;
  /** Face down (CR 708.2): the card back; the zoom still shows the card to a viewer who may see it. */
  faceDown?: boolean;
  size?: CardSize;
  /** Hover and focus zoom (default on). */
  zoom?: boolean;
  /** Milliseconds the pointer rests on the card before the zoom opens. */
  zoomDelayMs?: number;
  /** The automation badge under the card (default on). */
  badge?: boolean;
  /** The "Show back" button of double-faced cards (default on). */
  faceToggle?: boolean;
  /**
   * The visible artist credit under the picture ("Illustrated by ...", only for a Scryfall picture): for screens that show the card at a readable size
   * (the deckbuilder's preview). Off by default: a thumbnail names its artist in its accessible name and tooltip, and its zoom shows the line.
   */
  credit?: boolean;
  /** Extra content under the card (outside the picture): counters, damage, markers. */
  below?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

/** Space kept between the zoom, the window edge and the card. */
const GAP = 16;

/** The zoom goes on the side of the card with more room, and is never wider than that room (so it never covers the card). */
export function zoomPlacement(rect: { left: number; right: number }, viewportWidth: number): ZoomPlacement {
  const leftRoom = rect.left - 2 * GAP;
  const rightRoom = viewportWidth - rect.right - 2 * GAP;
  return leftRoom > rightRoom ? { side: 'left', room: Math.max(0, leftRoom) } : { side: 'right', room: Math.max(0, rightRoom) };
}

/** What a screen reader hears: the card's name and its state. */
function cardLabel(name: string, state: { tapped: boolean; flipped: boolean; selected: boolean; clickable: boolean }): string {
  const parts = [name];
  if (state.tapped) parts.push('tapped');
  if (state.flipped) parts.push('flipped');
  if (state.selected && !state.clickable) parts.push('selected'); // a clickable card says it with aria-pressed
  return parts.join(', ');
}

export function Card({
  card,
  face = 0,
  tapped = false,
  flipped = false,
  faceDown = false,
  size = 'normal',
  zoom = true,
  zoomDelayMs = 350,
  badge = true,
  faceToggle = true,
  credit = false,
  below,
  selected = false,
  onClick,
  className = '',
}: CardProps) {
  const [peek, setPeek] = useState<number | null>(null);
  useEffect(() => setPeek(null), [face, card?.name]);
  const [zoomed, setZoomed] = useState<ZoomPlacement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slot = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const shown = card ? shownFace(card, peek ?? face) : 0;
  const isFlipped = flipped && card?.layout === 'flip';
  const name = faceDown ? 'Face-down card' : !card ? 'Hidden card' : activeFaceName(card, shown, isFlipped);
  const rotation = (tapped ? 90 : 0) + (flipped ? 180 : 0);
  const canZoom = zoom && card !== null;

  const openZoom = () => {
    if (!canZoom) return;
    // Already open or about to open (the pointer is on the card, or a click focused it): keep it where it is.
    if (zoomed || timer.current) return;
    const rect = slot.current?.getBoundingClientRect();
    const width = typeof window === 'undefined' ? 0 : window.innerWidth;
    const placement: ZoomPlacement = rect && width > 0 ? zoomPlacement(rect, width) : { side: 'right', room: null };
    timer.current = setTimeout(() => {
      timer.current = null;
      setZoomed(placement);
    }, zoomDelayMs);
  };
  const closeZoom = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setZoomed(null);
  };
  const onKey = (e: KeyboardEvent) => {
    // Keys pressed on a control inside the card belong to that control.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Escape') {
      closeZoom();
      return;
    }
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick();
    }
  };

  const classes = ['card', `card-${size}`, tapped && 'is-tapped', flipped && 'is-flipped', selected && 'is-selected', onClick && 'is-clickable', className]
    .filter(Boolean)
    .join(' ');
  const twoSided = card !== null && !faceDown && isTwoSided(card);
  const showBadge = badge && card !== null && card.automation !== null && !faceDown;
  // The Scryfall picture's artist in the card's accessible name; the zoom shows it as a line under the picture.
  const artist = useImageCredit(faceDown ? null : card, shown);
  const label = cardLabel(creditedName(name, artist), { tapped, flipped: isFlipped, selected, clickable: !!onClick });
  const control = onClick ? { role: 'button', tabIndex: 0, onClick, 'aria-pressed': selected } : { role: 'group', ...(canZoom ? { tabIndex: 0 } : {}) };
  return (
    <figure className={classes} data-tapped={tapped || undefined} data-flipped={flipped || undefined} onMouseEnter={openZoom} onMouseLeave={closeZoom}>
      <div ref={slot} className="card-slot" aria-label={label} {...control} onKeyDown={onKey} onFocus={openZoom} onBlur={closeZoom}>
        <div className="card-box" style={{ transform: `translate(-50%, -50%) rotate(${rotation}deg)` }} data-rotation={rotation}>
          <CardPicture card={card} face={shown} faceDown={faceDown} flipped={isFlipped} />
        </div>
      </div>
      {/* The side shown (the "Back" toggle included) credits its own artist */}
      {credit && <ArtistCredit artist={artist} className="card-credit" />}
      {(showBadge || twoSided || below) && (
        <figcaption className="card-meta">
          {showBadge && <AutomationBadge level={card.automation!} />}
          {twoSided && faceToggle && (
            <button
              type="button"
              className="card-face-toggle"
              onClick={() => setPeek(1 - shown)}
              aria-label={shown === 0 ? `Show back of ${card.name}` : `Show front of ${card.name}`}
            >
              {shown === 0 ? 'Back' : 'Front'}
            </button>
          )}
          {below}
        </figcaption>
      )}
      {zoomed && card && <CardZoom card={card} face={shown} faceDown={faceDown} flipped={isFlipped} placement={zoomed} />}
    </figure>
  );
}
