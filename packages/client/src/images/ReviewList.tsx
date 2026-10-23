/**
 * The review list for images the matcher was not sure about (ARCHITECTURE.md "Card images" A: "unmatched or ambiguous images go to a review screen
 * where the player picks the card"): quick choices from the server's guesses, a card search the player opens per image (so a large upload does not
 * start one search per file), skip, or skip all. When an image is resolved, keyboard focus moves on to the next one.
 */
import { useEffect, useRef, useState } from 'react';
import type { ImageFileMatch, ImageSlotMatch } from '@openmtg/server/api';
import { CardPicker } from './CardPicker';
import { choicesOf, type ReviewItem } from './matching';
import { Thumbnail } from './Thumbnail';

const REASON: Record<ReviewItem['reason'], string> = {
  unmatched: 'No card matched this file name.',
  unsure: 'Not sure which card this is.',
  duplicate: 'Another file in this upload was matched to the same card side.',
};

/** Words at the end of a file name that are not part of the card name: "(2)", "(MMA)", "199", "copy", side words "front", "back", "f", "b". */
const TRAILING = /\s+(?:\([^()]*\)|\d+|copy|front|back|f|b)$/i;

/** A file name as a search query: no extension, separators as spaces, no leading numbering, no set code, collector number, copy number or side word. */
export function queryFromFileName(name: string): string {
  let q = name
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\d+\s+/, '');
  for (let prev = ''; prev !== q; ) {
    prev = q;
    q = q.replace(TRAILING, '').trim();
  }
  return q;
}

/** Where a review search starts: the card the server guessed (its first face's name), else the cleaned file name. */
export function queryOf(result: ImageFileMatch): string {
  const card = result.match?.card ?? result.alternatives[0]?.card;
  return card ? card.split(' // ')[0]! : queryFromFileName(result.fileName);
}

function ReviewRow({ item, onChoose, onSkip, debounceMs }: { item: ReviewItem; onChoose: (slot: ImageSlotMatch) => void; onSkip: () => void; debounceMs?: number }) {
  const choices = choicesOf(item.result);
  const [searching, setSearching] = useState(false);
  return (
    <li className="review-item" aria-label={`Review ${item.file.name}`} data-review-id={item.id}>
      <Thumbnail blob={item.file} version={item.id} alt={item.file.name} />
      <div className="review-body">
        <p className="review-file">
          <strong>{item.file.name}</strong>
        </p>
        <p className="muted">
          {REASON[item.reason]}
          {item.reason === 'unsure' && item.result.match ? ` Best guess: ${item.result.match.label} (${Math.round(item.result.confidence * 100)}%).` : ''}
        </p>
        {choices.length > 0 && (
          <div className="review-choices" role="group" aria-label="Suggestions">
            {choices.map((s) => (
              <button key={s.key} type="button" onClick={() => onChoose(s)}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        {searching ? (
          <CardPicker onPick={onChoose} initialQuery={queryOf(item.result)} label="Or search for the card" autoFocus {...(debounceMs !== undefined ? { debounceMs } : {})} />
        ) : (
          <button type="button" onClick={() => setSearching(true)}>
            Search for the card
          </button>
        )}
        <button type="button" className="button-link" onClick={onSkip}>
          Skip this image
        </button>
      </div>
    </li>
  );
}

export function ReviewList({
  items,
  onChoose,
  onSkip,
  onSkipAll,
  onEmptied,
  debounceMs,
}: {
  items: readonly ReviewItem[];
  onChoose: (item: ReviewItem, slot: ImageSlotMatch) => void;
  onSkip: (item: ReviewItem) => void;
  onSkipAll: () => void;
  /** The list was emptied by the player: the screen moves focus somewhere that still exists. */
  onEmptied: () => void;
  debounceMs?: number;
}) {
  const list = useRef<HTMLUListElement>(null);
  /** The row to focus once the row being resolved is gone ('' when it was the last one). */
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    if (items.length === 0) {
      focusNext.current = null;
      onEmptied();
      return;
    }
    const row = [...(list.current?.children ?? [])].find((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.reviewId === target);
    if (!row) return;
    focusNext.current = null;
    row.querySelector<HTMLElement>('button, input')?.focus();
  }, [items, onEmptied]);

  if (items.length === 0) return null;
  const resolving = (it: ReviewItem) => {
    const i = items.indexOf(it);
    focusNext.current = (items[i + 1] ?? items[i - 1])?.id ?? '';
  };
  return (
    <section className="hud-panel images-panel" aria-labelledby="review-heading">
      <h2 id="review-heading">Review ({items.length})</h2>
      <p className="muted">Pick the card each image shows. Skipped images are not stored.</p>
      <button
        type="button"
        className="button-link"
        onClick={() => {
          focusNext.current = '';
          onSkipAll();
        }}
      >
        Skip all {items.length} {items.length === 1 ? 'image' : 'images'}
      </button>
      <ul className="review-list" ref={list}>
        {items.map((it) => (
          <ReviewRow
            key={it.id}
            item={it}
            onChoose={(s) => {
              resolving(it);
              onChoose(it, s);
            }}
            onSkip={() => {
              resolving(it);
              onSkip(it);
            }}
            {...(debounceMs !== undefined ? { debounceMs } : {})}
          />
        ))}
      </ul>
    </section>
  );
}
