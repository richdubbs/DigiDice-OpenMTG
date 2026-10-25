/**
 * Deck Details: the Arena layout for looking at a deck. Left, the deck's name and format with its statistics (creature / non-creature mana curve,
 * colors, lands); in the middle a big 3D deck box (the cover card, or the deck's sleeve) with pill buttons under it; right, the cards by type with their subtypes.
 */
import { useRef, type ReactNode } from 'react';
import type { CardSummary } from '@openmtg/server/api';
import { DeckBox } from './chrome';
import { DeckNameField } from './DeckNameField';
import { FormatSelect } from './FormatSelect';
import { deckSize } from './look';
import { sectionCount, type Deck } from './model';
import { StatsPanel, TypePanel } from './StatsPanel';
import type { DeckStats } from './stats';

export function DeckDetails({
  deck,
  cover = null,
  stats,
  onRename,
  onFormat,
  onEdit,
  onExport,
  sleeve,
  validation,
}: {
  deck: Deck;
  /** The deck's cover card (null: the card back). */
  cover?: CardSummary | null;
  /** The sleeve of the deck's colors (branding/sleeves.ts deckSleeve); undefined: the classic back. */
  sleeve: string | undefined;
  stats: DeckStats;
  onRename: (name: string) => void;
  onFormat: (format: string) => void;
  onEdit: () => void;
  onExport: () => void;
  /** The format check panel, shown under the pills. */
  validation: ReactNode;
}) {
  const check = useRef<HTMLDivElement>(null);
  const main = sectionCount(deck, 'main') + sectionCount(deck, 'commander');
  return (
    <div className="deck-details">
      <aside className="deck-details-left hud-panel">
        <div className="deck-plate">
          <DeckNameField name={deck.name} onRename={onRename} />
        </div>
        <FormatSelect value={deck.format} onChange={onFormat} />
        <StatsPanel stats={stats} />
      </aside>

      <section className="deck-showcase" aria-label="Deck showcase">
        <div className="deck-box-host deck-showcase-box">
          <DeckBox size="lg" cover={cover} sleeve={sleeve} />
        </div>
        <p className="deck-showcase-name">{deck.name.trim() || '(unnamed deck)'}</p>
        <p className="deck-showcase-count">
          {main}/{deckSize(deck.format)} Cards
          {sectionCount(deck, 'sideboard') > 0 && <span className="muted"> · {sectionCount(deck, 'sideboard')} sideboard</span>}
        </p>
        <div className="deck-pills">
          <button type="button" className="button-primary deck-pill" onClick={onEdit}>
            Edit deck
          </button>
          <button type="button" className="deck-pill" onClick={onExport}>
            Export
          </button>
          <button
            type="button"
            className="deck-pill"
            onClick={() => {
              const region = check.current?.querySelector<HTMLElement>('[aria-label="Format check"]');
              region?.scrollIntoView?.({ block: 'nearest' });
              region?.focus({ preventScroll: true });
            }}
          >
            Validate
          </button>
        </div>
        <div className="deck-showcase-check" ref={check}>
          {validation}
        </div>
      </section>

      <aside className="deck-details-right hud-panel">
        <h2 className="deck-panel-title">Card types</h2>
        <TypePanel stats={stats} />
      </aside>
    </div>
  );
}
