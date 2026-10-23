/**
 * Artist credits. One place for the
 * words and the look, used by every screen that shows a card picture:
 *
 * - Where the picture is shown at a readable size (the deckbuilder's preview, the card zooms, the stage overlays, the zone viewers, the own-draw reveal)
 *   the credit is a visible line under the picture: `ArtistCredit` / `CardCredit`, "Illustrated by <artist>".
 * - Where it is a small thumbnail (permanents, hand cards, the stack, piles, search results) nothing is added to the table: the picture's accessible name
 *   and tooltip carry it (`creditedName`, "Lightning Bolt, illustrated by Christopher Moeller"), and the zoom it opens shows the visible line.
 *
 * Only Scryfall pictures are credited, and only while the Scryfall setting is on (useImageCredit); uploaded images and our own frames get no credit. The
 * line always sits OUTSIDE the picture, never over it, and nothing about the picture changes for it (Scryfall's image rules, ARCHITECTURE.md "Card images").
 */
import type { CardModel } from './model';
import { useImageCredit } from './useCardImage';
import './cards.css';

/** The visible credit line. */
export function creditText(artist: string): string {
  return `Illustrated by ${artist}`;
}

/** A picture's name with its credit, for accessible names and tooltips: "Lightning Bolt, illustrated by Christopher Moeller"; just the name without one. */
export function creditedName(name: string, artist: string | null | undefined): string {
  return artist ? `${name}, illustrated by ${artist}` : name;
}

/** The credit line under a picture, for an artist already known; nothing without one. */
export function ArtistCredit({ artist, className }: { artist: string | null | undefined; className?: string }) {
  if (!artist) return null;
  return <p className={`artist-credit${className ? ` ${className}` : ''}`}>{creditText(artist)}</p>;
}

/** The credit line for the picture a card face shows (the Scryfall image's artist; nothing for uploads, our frames and hidden cards). */
export function CardCredit({ card, face = 0, className }: { card: CardModel | null; face?: number; className?: string }) {
  const artist = useImageCredit(card, face);
  return <ArtistCredit artist={artist} {...(className ? { className } : {})} />;
}

/** The same line as a DOM element, for the fx layer's copies of pictures (the own-draw reveal), which are not React. */
export function creditElement(artist: string, className = ''): HTMLElement {
  const p = document.createElement('p');
  p.className = `artist-credit${className ? ` ${className}` : ''}`;
  p.textContent = creditText(artist);
  return p;
}
