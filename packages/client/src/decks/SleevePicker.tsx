/**
 * The deck's sleeve (branding/sleeves.ts): the classic DigiDice back, or one of the mana-color sleeves, one for every color and every combination. The
 * sleeve of exactly the deck's colors is marked "Matches this deck". Picking one saves it (Deck.sleeve) and closes the panel.
 */
import type { Color } from '@openmtg/engine';
import { CLASSIC_SLEEVE, SLEEVES, sleeveForColors } from '../branding/sleeves';
import { CardBack } from '../cards';
import { Modal } from './chrome';

const GROUPS: readonly { label: string; count: number }[] = [
  { label: 'One color', count: 1 },
  { label: 'Two colors', count: 2 },
  { label: 'Three colors', count: 3 },
  { label: 'Four colors', count: 4 },
  { label: 'All five colors', count: 5 },
];

export function SleevePicker({
  current,
  colors,
  onPick,
  onClose,
}: {
  /** The deck's sleeve id; undefined: the classic back. */
  current: string | undefined;
  /** The deck's colors, for "Matches this deck"; null while they are not known. */
  colors: readonly Color[] | null;
  /** undefined picks the classic back. */
  onPick: (sleeve: string | undefined) => void;
  onClose: () => void;
}) {
  const match = colors && colors.length > 0 ? sleeveForColors(colors)?.id : undefined;
  const option = (id: string | undefined, name: string) => (
    <button
      key={id ?? CLASSIC_SLEEVE}
      type="button"
      className="sleeve-option"
      data-sleeve={id ?? CLASSIC_SLEEVE}
      aria-pressed={current === id}
      onClick={() => {
        onPick(id);
        onClose();
      }}
    >
      <span className="sleeve-option-art">
        <CardBack sleeve={id ?? null} label="" />
      </span>
      <span className="sleeve-option-name">{name}</span>
      {id !== undefined && id === match && <span className="sleeve-option-match">Matches this deck</span>}
    </button>
  );
  return (
    <Modal label="Choose a sleeve" wide onClose={onClose}>
      <div className="deck-panel sleeve-picker">
        <h2>Sleeve</h2>
        <p className="muted">Your card backs in a game: your library, your hand as the other players see it, and your face-down cards.</p>
        <div className="sleeve-grid">{option(undefined, 'Classic')}</div>
        {GROUPS.map((g) => (
          <section key={g.count} aria-label={g.label}>
            <h3>{g.label}</h3>
            <div className="sleeve-grid">{SLEEVES.filter((s) => s.colors.length === g.count).map((s) => option(s.id, s.name))}</div>
          </section>
        ))}
        <div className="panel-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
