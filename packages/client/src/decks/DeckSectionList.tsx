/**
 * One deck section (commander, companion, main deck, sideboard): one banner per card, tinted by the card's color, with "3x", the name, the mana cost and
 * (on hover or focus) − / + / move buttons; drag and drop between sections; and each card's validation problems shown inline under its banner.
 */
import { useState, type DragEvent } from 'react';
import type { CardSummary, DeckProblem } from '@openmtg/server/api';
import { AutomationBadge, ManaCost } from '../cards';
import { toneOf } from './look';
import { SECTION_LABEL, type DeckEntry, type DeckSection } from './model';

const DRAG_TYPE = 'application/x-openmtg-deck-card';

export interface SectionHandlers {
  onChange: (section: DeckSection, name: string, delta: number) => void;
  onMove: (from: DeckSection, to: DeckSection, name: string) => void;
  onPreview: (name: string) => void;
}

export function DeckSectionList({
  section,
  entries,
  cards,
  missing,
  problems,
  handlers,
}: {
  section: DeckSection;
  entries: readonly DeckEntry[];
  cards: ReadonlyMap<string, CardSummary>;
  missing: ReadonlyMap<string, 'unknown' | 'unavailable'>;
  /** Problems by card name. */
  problems: ReadonlyMap<string, DeckProblem[]>;
  handlers: SectionHandlers;
}) {
  const [over, setOver] = useState(false);
  const total = entries.reduce((n, e) => n + e.count, 0);
  const headingId = `deck-section-${section}`;
  const other: DeckSection = section === 'main' ? 'sideboard' : 'main';

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    const { from, name } = JSON.parse(raw) as { from: DeckSection; name: string };
    if (from !== section) handlers.onMove(from, section, name);
  };

  return (
    <section
      className={`deck-section${over ? ' drop-target' : ''}`}
      aria-labelledby={headingId}
      data-section={section}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <h2 id={headingId} tabIndex={-1}>
        {SECTION_LABEL[section]} <span className="count">({total})</span>
      </h2>
      {entries.length === 0 ? (
        <p className="muted empty-section">{section === 'commander' || section === 'companion' ? 'Empty' : 'No cards yet. Click a card to add it, or drag it here.'}</p>
      ) : (
        <ul className="deck-cards">
          {entries.map((e) => {
            const card = cards.get(e.name);
            const cardProblems = problems.get(e.name) ?? [];
            return (
              <li
                key={e.name}
                className={`deck-card${cardProblems.length ? ' has-problem' : ''}`}
                data-tone={toneOf(card)}
                aria-label={`${e.count} ${e.name}`}
                data-card={e.name}
                draggable
                onDragStart={(ev) => {
                  ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ from: section, name: e.name }));
                  ev.dataTransfer.effectAllowed = 'move';
                }}
              >
                <div className="deck-card-line">
                  <span className="deck-card-count">{e.count}x</span>
                  <button type="button" className="button-link card-name" title={e.name} onClick={() => handlers.onPreview(e.name)}>
                    {e.name}
                  </button>
                  {missing.get(e.name) === 'unknown' && <span className="deck-flag deck-error">Unknown card</span>}
                  {missing.get(e.name) === 'unavailable' && <span className="deck-flag">Card data unavailable</span>}
                  <span className="deck-card-meta">
                    {card && <ManaCost cost={card.faces[0]?.manaCost ?? null} />}
                    {card && <AutomationBadge level={card.automation} />}
                  </span>
                  <span className="deck-card-actions">
                    <button type="button" className="icon-button" data-control="remove" onClick={() => handlers.onChange(section, e.name, -1)} aria-label={`Remove one ${e.name}`} title="Remove one">
                      −
                    </button>
                    <button type="button" className="icon-button" data-control="add" onClick={() => handlers.onChange(section, e.name, 1)} aria-label={`Add one ${e.name}`} title="Add one">
                      +
                    </button>
                    <button
                      type="button"
                      className="icon-button deck-move"
                      data-control="move"
                      onClick={() => handlers.onMove(section, other, e.name)}
                      aria-label={`Move ${e.name} to ${SECTION_LABEL[other].toLowerCase()}`}
                      title={`Move to ${SECTION_LABEL[other].toLowerCase()}`}
                    >
                      {other === 'sideboard' ? '→ SB' : '→ Main'}
                    </button>
                  </span>
                </div>
                {cardProblems.map((p, i) => (
                  <p key={i} className="inline-problem" role="note">
                    {p.message} {p.rules.length > 0 && <span className="rule">({p.rules.join(', ')})</span>}
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
