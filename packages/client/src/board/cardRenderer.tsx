/**
 * How the board draws one card image. The board owns everything around the image (highlights, tapped rotation, damage, combat and summoning-sickness
 * markers, automation badges) and, on a permanent, the P/T, loyalty or defense and counters drawn on the card (CardOverlay.tsx; ARCHITECTURE.md "Card
 * images"); the card component owns the image itself.
 *
 * The game screen passes C2's card picture as `renderCard` (game/boardCards.tsx: uploaded image, opt-in Scryfall image, our text frame). `PlaceholderCard`
 * below is the board's own default, for tests and for any screen that draws a board without C2.
 */
import type { ReactNode } from 'react';
import type { CardDef, Chars } from '@openmtg/engine';
import { CardBack as DigiDiceCardBack } from '../cards';
import { ManaCostView } from './ManaSymbols';

export type CardSize = 'small' | 'normal' | 'large';

export interface BoardCardProps {
  /**
   * The card's definition; null whenever the image must be the DigiDice card back and nothing else: a hidden card (CR 400.2), and a face-down card on the
   * board even when the viewer may look at it (CR 708.2a, 708.5).
   */
  def: CardDef | null;
  /**
   * The face that is up, as the engine chooses it (`faceIndexOf`): the cast face on the stack, the face up of a double-faced card (CR 711, 712), the flipped
   * half of a flipped flip card (CR 710.2). Draw this face, never `GameObject.face` directly.
   */
  face: number;
  /**
   * The object is face down (CR 708). With `def` null draw the back; with `def` set (only in the controller's zoom, CR 708.5) draw the real card: the board
   * labels it "Face down" outside the image.
   */
  faceDown: boolean;
  /** Characteristics after the layers (CR 613), when known: the frame may show the current P/T and type line. */
  chars: Chars | null;
  size: CardSize;
}

export type CardRenderer = (props: BoardCardProps) => ReactNode;

/**
 * The artist to credit for the picture the renderer draws for (`def`, `face`), or null (every Scryfall picture is credited to its
 * artist). A React hook: the board calls it once per card on every draw, so a screen passes one function for the board's whole life (GameBoardProps
 * `useArtist`; the game screen's is game/boardCards.tsx `useBoardArtist`). The board's own text frames name no artist (`noArtist`).
 */
export type ArtistHook = (def: CardDef | null, face: number) => string | null;

export const noArtist: ArtistHook = () => null;

/**
 * The DigiDice card back (branding.md), drawn by C2's card back in a box the board sizes; hidden cards are only ever drawn like this. Only the large back
 * (the zoom, a prompt's picture) carries the sleeve's moving lights: a table full of small animated backs ran at 7 fps (cards/CardBack.tsx).
 */
export function CardBack({ size }: { size: CardSize }) {
  return (
    <span className={`board-card-back board-back-${size}`}>
      <DigiDiceCardBack label="Card back" lights={size === 'large'} />
    </span>
  );
}

const FRAME_COLOR: Record<string, string> = { W: 'frame-w', U: 'frame-u', B: 'frame-b', R: 'frame-r', G: 'frame-g' };

export function frameClass(colors: readonly string[]): string {
  if (colors.length === 0) return 'frame-colorless';
  if (colors.length > 1) return 'frame-multi';
  return FRAME_COLOR[colors[0]!] ?? 'frame-colorless';
}

/** Our own text frame (no Wizards frames or symbols): name, mana cost, type line, rules text, P/T or loyalty. LOCAL PLACEHOLDER for C2's component. */
export function PlaceholderCard({ def, face, chars: layered, size, faceDown }: BoardCardProps) {
  // A face-down card's characteristics are the 2/2's (CR 708.2a): in the controller's zoom draw the printed card instead.
  const chars = faceDown ? null : layered;
  if (!def) return <CardBack size={size} />;
  const f = def.faces[face] ?? def.faces[0];
  if (!f) return <CardBack size={size} />;
  const colors = chars?.colors ?? f.colors;
  const power = chars?.power ?? f.power;
  const toughness = chars?.toughness ?? f.toughness;
  const typeLine = chars ? [...chars.supertypes, ...chars.types].join(' ') + (chars.subtypes.length ? ` — ${chars.subtypes.join(' ')}` : '') : f.typeLine;
  return (
    <div className={`placeholder-card pc-${size} ${frameClass(colors)}`} data-card-name={f.name}>
      <div className="pc-title">
        <span className="pc-name">{chars?.name ?? f.name}</span>
        <ManaCostView cost={f.manaCost} />
      </div>
      <div className="pc-type">{typeLine}</div>
      {size !== 'small' && <div className="pc-text">{f.oracleText}</div>}
      {power !== undefined && toughness !== undefined && (
        <div className="pc-pt">
          {power}/{toughness}
        </div>
      )}
      {f.loyalty !== undefined && power === undefined && <div className="pc-pt">{f.loyalty}</div>}
      {f.defense !== undefined && power === undefined && <div className="pc-pt">{f.defense}</div>}
    </div>
  );
}

export const defaultCardRenderer: CardRenderer = (p) => <PlaceholderCard {...p} />;
