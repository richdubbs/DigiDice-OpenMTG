/**
 * The DigiDice card back (docs/design/branding.md; not MIT) for hidden and face-down cards, in a deck sleeve (branding/sleeves.ts): the board sets
 * SleeveContext to the sleeve of the card's owner; without one it is the classic sleeve. The sleeve's moving lights are a second picture laid over the
 * still card back, so only they are drawn again while they move; reduced motion hides them (cards.css). The lights are an SVG that animates on its own
 * (96 looping strokes), which the browser re-rasterizes every frame for every copy on screen: a four-player table draws 25 small backs (every opponent's
 * hidden hand, every library) and ran at 7 fps with them, 60 without. So only a large back (the zoom, a prompt's picture, the sleeve picker, the deck
 * box) carries them (`lights`); the small and normal backs on the table and in hands are the still sleeve.
 */
import { createContext, useContext } from 'react';
import { sleeveTracersUrl, sleeveUrl } from '../branding/sleeves';

/** The sleeve id card backs inside are drawn in; null: the classic sleeve. */
export const SleeveContext = createContext<string | null>(null);

export function CardBack({ label = 'Hidden card', sleeve, lights = true }: { label?: string; sleeve?: string | null; lights?: boolean }) {
  const scoped = useContext(SleeveContext);
  const id = sleeve === undefined ? scoped : sleeve;
  return (
    <span className="card-back-sleeve">
      <img className="card-back" src={sleeveUrl(id)} alt={label} data-sleeve={id ?? 'classic'} draggable={false} />
      {lights && <img className="card-back-tracers" src={sleeveTracersUrl(id)} alt="" aria-hidden="true" draggable={false} />}
    </span>
  );
}
