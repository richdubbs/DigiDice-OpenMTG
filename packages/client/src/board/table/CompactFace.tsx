/**
 * M12-4a (docs/design/m12-multiplayer.md 5.1 "Readability"): a card far across the shared table, drawn small: its name, mana cost and power and toughness
 * on our own frame colour, large enough to read where the whole frame would not be. Counters, damage and the tapped state stay where they are on every
 * card (the counters on the card, CardOverlay.tsx; damage in the marker strip; the card turned sideways); the P/T here is the current one, so the overlay
 * draws no P/T plate on a compact face. It shows no picture, so it names no artist; its zoom shows the whole card with its credit.
 */
import type { CardDef, Chars } from '@openmtg/engine';
import { frameClass } from '../cardRenderer';
import { ManaCostView } from '../ManaSymbols';

export function CompactFace({ def, face, chars }: { def: CardDef; face: number; chars: Chars | null }) {
  const f = def.faces[face] ?? def.faces[0];
  if (!f) return null;
  const power = chars?.power ?? f.power;
  const toughness = chars?.toughness ?? f.toughness;
  const name = chars?.name || f.name;
  return (
    <div className={`compact-face ${frameClass(chars?.colors ?? f.colors)}`} data-card-name={f.name} data-compact="">
      <span className="cf-name">{name}</span>
      <ManaCostView cost={f.manaCost} />
      {power !== undefined && toughness !== undefined ? (
        <span className="cf-pt">
          {power}/{toughness}
        </span>
      ) : f.loyalty !== undefined ? (
        <span className="cf-pt">{f.loyalty}</span>
      ) : null}
    </div>
  );
}
