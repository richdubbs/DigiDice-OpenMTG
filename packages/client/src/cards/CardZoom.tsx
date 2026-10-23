/**
 * The card zoom (docs/design/m8-client.md screen 6: "card zoom on hover"): a large view of the card on the side of the card with more room (never
 * covering the card), with both sides of a double-faced card, a flipped flip card turned so its active half reads upright (CR 710.2), its automation
 * level and the text players resolve by hand, all outside the card images. It fits the window: no part is cut off below the bottom edge.
 */
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CardCredit } from './ArtistCredit';
import { AUTOMATION_TEXT } from './AutomationBadge';
import { CardPicture } from './CardPicture';
import { activeFaceName, isTwoSided, shownFace, type CardModel } from './model';
import { selfNamed } from './text';

/** Where the zoom goes: the side of the card with more room, and that room in pixels (null when unknown). */
export interface ZoomPlacement {
  side: 'left' | 'right';
  room: number | null;
}

/** Padding and gap of the zoom box (cards.css .card-zoom). */
const PAD = 12;
const GAP = 8;

export function CardZoom({
  card,
  face = 0,
  faceDown = false,
  flipped = false,
  placement = { side: 'right', room: null },
}: {
  card: CardModel;
  face?: number;
  faceDown?: boolean;
  /** A flipped flip card (CR 710.2). */
  flipped?: boolean;
  placement?: ZoomPlacement;
}) {
  const faces = isTwoSided(card) ? [face, 1 - face] : [face];
  const level = card.automation;
  const isFlipped = flipped && card.layout === 'flip';
  const name = activeFaceName(card, face, isFlipped);
  const fallback = card.faces[shownFace(card, face)]?.name ?? card.name;
  const style: CSSProperties & Record<string, string> = {};
  if (placement.room !== null) {
    style.maxWidth = `${placement.room}px`;
    // Each picture gets its share of the room.
    style['--zoom-room-card'] = `${Math.max(0, (placement.room - 2 * PAD - GAP * (faces.length - 1)) / faces.length)}px`;
  }
  const content = (
    <div
      className={`card-zoom card-zoom-${placement.side}`}
      role="dialog"
      aria-label={isFlipped ? `${name} (zoomed, flipped)` : `${card.name} (zoomed)`}
      style={style}
    >
      <div className="card-zoom-pictures">
        {faces.map((f) => (
          <div key={f} className="card-zoom-face">
            <div className={`card-zoom-picture${isFlipped ? ' is-flipped' : ''}`}>
              <CardPicture card={card} face={f} flipped={isFlipped} size="large" />
            </div>
            {/* Each side's own artist, under its picture (never on it, and not turned with a flipped card) */}
            <CardCredit card={card} face={f} />
          </div>
        ))}
      </div>
      <div className="card-zoom-info">
        {faceDown && <p className="card-zoom-note">Face down: other players see only the card back.</p>}
        {isFlipped && <p className="card-zoom-note">Flipped (CR 710.2): {name} applies; the card is shown turned around.</p>}
        {level && <p className={`card-zoom-level automation-text-${level}`}>{AUTOMATION_TEXT[level].long}</p>}
        {card.unsupported.length > 0 && (
          <div className="card-zoom-manual">
            <p>Resolved by hand:</p>
            <ul>
              {card.unsupported.map((u, i) => (
                <li key={i}>{selfNamed(u, card.faces, fallback)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
