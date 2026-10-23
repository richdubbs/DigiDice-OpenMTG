/**
 * The board's card renderer (C4 `CardRenderer`) drawn with C2's card picture: the player's uploaded image, then the Scryfall image when the player opted in,
 * then our text frame; the DigiDice card back for hidden and face-down cards (ARCHITECTURE.md "Card images" A + B). Only the picture: the board draws
 * everything around it (highlights, tapped rotation, combat markers and automation badges) and a permanent's P/T and counters on it (board/CardOverlay.tsx).
 */
import type { CardDef } from '@openmtg/engine';
import type { ArtistHook, BoardCardProps, CardRenderer } from '../board';
import { CardPicture, cardModelOf, useImageCredit } from '../cards';

/**
 * `def` null means the card back and nothing else (CR 400.2, 708.2a). A face-down card with `def` set is only ever drawn in its controller's zoom
 * (CR 708.5), where the real card is shown and the board labels it "Face down" outside the image.
 */
export function BoardCardPicture({ def, face, faceDown, size }: BoardCardProps) {
  const picture = <CardPicture card={def ? cardModelOf(def) : null} face={face} faceDown={def === null && faceDown} flipped={def?.layout === 'flip' && face === 1} size={size === 'large' ? 'large' : 'normal'} />;
  // CR 710.2: a flipped flip card is turned 180 degrees, so its flipped half reads upright. C4's `shownFace` gives face 1 only for a flipped flip card.
  // The whole picture turns (outside the image box, like C2's Card); nothing is drawn on the image.
  if (def?.layout !== 'flip' || face !== 1) return picture;
  return (
    <div className="game-card-flipped" data-flipped="true">
      {picture}
    </div>
  );
}

export const renderBoardCard: CardRenderer = (p) => <BoardCardPicture {...p} />;

/**
 * The artist of the picture `renderBoardCard` draws for (`def`, `face`): the Scryfall image's artist while that image is shown
 * (the setting on, no upload for that side), each side of a double-faced card its own; null for uploads, our frames and card backs (`def` null).
 */
export const useBoardArtist: ArtistHook = (def: CardDef | null, face: number) => useImageCredit(def ? cardModelOf(def) : null, face);
