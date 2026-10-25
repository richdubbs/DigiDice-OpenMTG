/**
 * The DigiDice card back (docs/design/branding.md; not MIT) for hidden and face-down cards, in a deck sleeve (branding/sleeves.ts): the board sets
 * SleeveContext to the sleeve of the card's owner; without one it is the classic sleeve. The sleeve's moving lights are a second picture laid over the
 * still card back, on a layer of their own so only they are drawn again while they move; reduced motion hides them (cards.css). Without that layer every
 * frame of the lights (an SVG of 96 looping strokes) redrew the still back under them, blur filters and all: a four-player table of 25 small backs ran
 * at 7 fps, 32 large ones at 5. Only a large back (the zoom, a prompt's picture, the deck box) carries them (`lights`);
 * the small and normal backs on the table and in hands are the still sleeve. A UI profile on the Reality Fracture template draws every sleeve as its
 * cracked mirror in the same colors (profiles/useSleevePictures.ts).
 */
import { createContext, useContext } from 'react';
import { useSleevePictures } from '../profiles/useSleevePictures';

/** The sleeve id card backs inside are drawn in; null: the classic sleeve. */
export const SleeveContext = createContext<string | null>(null);

export function CardBack({ label = 'Hidden card', sleeve, lights = true }: { label?: string; sleeve?: string | null; lights?: boolean }) {
  const scoped = useContext(SleeveContext);
  const id = sleeve === undefined ? scoped : sleeve;
  const pictures = useSleevePictures(id);
  return (
    <span className="card-back-sleeve">
      <img className="card-back" src={pictures.back} alt={label} data-sleeve={id ?? 'classic'} draggable={false} />
      {lights && <img className="card-back-tracers" src={pictures.lights} alt="" aria-hidden="true" draggable={false} />}
    </span>
  );
}
