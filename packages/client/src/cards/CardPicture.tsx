/**
 * What fills a card's rectangle: the uploaded image, the Scryfall image, or our text frame (priority in useCardImage.ts), or the DigiDice card back.
 *
 * Scryfall's image rules (ARCHITECTURE.md "Card images" B): the image keeps its aspect ratio (`object-fit: contain`), is never cropped, filtered, tinted,
 * blurred or covered: nothing is drawn on top of it (badges, counters and highlights go outside the card's rectangle).
 */
import { memo, useEffect, useState } from 'react';
import { creditedName } from './ArtistCredit';
import { CardBack } from './CardBack';
import { CardFrame } from './CardFrame';
import { activeFaceName, type CardModel } from './model';
import { useCardImage } from './useCardImage';

export interface CardPictureProps {
  /** Null: a hidden card (the card back). */
  card: CardModel | null;
  face?: number;
  /** Face-down (CR 708): the card back, whatever the viewer may know. */
  faceDown?: boolean;
  /** A flipped flip card (CR 710.2): the picture is named after the flipped half (the card itself turns 180 degrees). */
  flipped?: boolean;
  size?: 'normal' | 'large';
}

/**
 * Memoized (ui/arena perf): the board re-renders on every change and every hover, and a card's frame is a lot of SVG; its props are plain values and the
 * card model is the same object for the same definition (fromView `cardModelOf`), so a picture whose card did not change is not drawn again.
 */
export const CardPicture = memo(function CardPicture({ card, face = 0, faceDown = false, flipped = false, size = 'normal' }: CardPictureProps) {
  const choice = useCardImage(faceDown ? null : card, face, size);
  const src = choice.kind === 'placeholder' ? null : choice.src;
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setFailed(null), [src]);
  if (!card || faceDown) return <CardBack label={faceDown ? 'Face-down card' : 'Hidden card'} lights={size === 'large'} />;
  if (src && failed !== src) {
    const name = activeFaceName(card, face, flipped);
    // A Scryfall picture names its artist: in its accessible name and tooltip, and in `data-artist` for the fx layer's copies
    // (the own-draw reveal shows the credit line under its copy). Readable-size places add the visible line under the picture (ArtistCredit.tsx).
    const artist = choice.kind === 'scryfall' ? choice.artist : undefined;
    const label = creditedName(name, artist);
    return (
      <img
        className={`card-image card-image-${choice.kind}`}
        src={src}
        alt={label}
        {...(artist ? { title: label, 'data-artist': artist } : {})}
        data-source={choice.kind}
        draggable={false}
        {...(choice.kind === 'scryfall' ? { referrerPolicy: 'no-referrer' as const } : {})}
        onError={() => setFailed(src)}
      />
    );
  }
  return <CardFrame card={card} face={face} pending={choice.loading} />;
});
