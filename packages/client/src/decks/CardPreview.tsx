/**
 * Card preview in the deckbuilder: the card itself, large (C2's card component: the player's uploaded image, then the opt-in Scryfall image, then our
 * text frame), and beside it, outside the picture, its name, cost, type line, rules text, automation level, keyword reminders, the parts players resolve
 * by hand (with the server's player-facing summary, C1), and "Use as deck cover". The floating version (hovering a card) has no buttons. A Scryfall image
 * is credited to its artist under the picture.
 */
import { useMemo, type ComponentType, type Ref } from 'react';
import type { CardDetailResponse, CardSummary, ManualPart } from '@openmtg/server/api';
import { AutomationBadge, Card, ManaCost, PartialWarning, SymbolText, modelFromSummary } from '../cards';
import { keywordReminders } from './keywords';

/** What the deckbuilder hands the card component. */
export interface CardViewProps {
  card: CardSummary;
  /** Face index (0 = front). */
  face?: number;
}

/**
 * C2's card for a search result or deck card, at its large size and without the hover zoom (the preview is the zoom); the badge is drawn by the preview
 * itself. A Scryfall picture is credited to its artist under it (the side shown, the "Back" toggle included).
 */
export function DeckCardView({ card, face = 0 }: CardViewProps) {
  const model = useMemo(() => modelFromSummary(card), [card]);
  return <Card card={model} face={face} badge={false} size="large" zoom={false} credit />;
}

/** What the player does with a manual part, in plain words (the compiler's `reason` is for developers). */
const BY_HAND: Record<ManualPart['impact'], string> = {
  ability: 'You resolve this ability by hand.',
  trigger: 'You resolve this triggered ability by hand.',
  static: 'You apply this effect by hand.',
  step: 'You do this part by hand.',
  condition: 'You check this condition by hand.',
  quantity: 'You choose this number by hand.',
  cost: 'You pay this cost by hand.',
  target: 'You choose these targets by hand.',
  restriction: 'You keep to this restriction by hand.',
  mana: 'You add this mana by hand.',
};

export function CardPreview({
  card,
  detail,
  onUseAsCover,
  onClose,
  isCover,
  floating = false,
  cardView: View = DeckCardView,
  sectionRef,
}: {
  card: CardSummary;
  detail?: CardDetailResponse;
  onUseAsCover?: () => void;
  /** The pinned preview's close button. */
  onClose?: () => void;
  isCover?: boolean;
  /** The preview that follows the pointer: nothing in it can be clicked. */
  floating?: boolean;
  /** The card component (default: C2's card); tests pass their own. */
  cardView?: ComponentType<CardViewProps>;
  /** The preview region (the deckbuilder scrolls it into view and focuses it). */
  sectionRef?: Ref<HTMLElement>;
}) {
  const reminders = useMemo(() => keywordReminders(card), [card]);
  return (
    <section className={`card-preview${floating ? ' card-preview-floating' : ''}`} aria-label="Card preview" tabIndex={-1} ref={sectionRef}>
      <div className="card-preview-art">
        <View card={card} face={0} />
      </div>
      <div className="card-preview-info">
        {card.faces.map((f, i) => (
          <div key={i} className="card-preview-face">
            <p className="card-preview-title">
              <strong>{f.name}</strong>
              <ManaCost cost={f.manaCost} />
            </p>
            <p className="card-preview-type">
              {f.typeLine}
              {f.power !== undefined && f.toughness !== undefined && <span className="card-preview-pt"> {f.power}/{f.toughness}</span>}
              {f.loyalty !== undefined && <span className="card-preview-pt"> Loyalty {f.loyalty}</span>}
            </p>
            {f.oracleText && (
              <p className="card-preview-text">
                <SymbolText text={f.oracleText} />
              </p>
            )}
          </div>
        ))}
        <p className="card-preview-badges">
          <AutomationBadge level={card.automation} />
        </p>
        <PartialWarning level={card.automation} />
        {reminders.length > 0 && (
          <ul className="card-preview-keywords" aria-label="Keywords">
            {reminders.map((k) => (
              <li key={k.keyword}>
                <strong>{k.keyword}</strong> <span>{k.text}</span> <span className="rule">({k.rule})</span>
              </li>
            ))}
          </ul>
        )}
        {detail && detail.manualParts.length > 0 && (
          <div>
            <p className="muted">Resolved by hand during a game:</p>
            <ul className="manual-parts" aria-label="Resolved by hand">
              {detail.manualParts.map((p, i) => (
                <li key={i}>
                  {p.text && <q>{p.text}</q>} {p.summary}
                  {!floating && (
                  <details className="manual-reason">
                    <summary>Details</summary>
                    <span className="muted">
                      {BY_HAND[p.impact] ?? 'You do this part by hand.'} ({p.reason})
                    </span>
                  </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!floating && (onUseAsCover || onClose) && (
          <p className="card-preview-actions">
            {onUseAsCover && (
              <button type="button" onClick={onUseAsCover} disabled={isCover}>
                {isCover ? 'Deck cover' : 'Use as deck cover'}
              </button>
            )}
            {onClose && (
              <button type="button" onClick={onClose}>
                Close
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
