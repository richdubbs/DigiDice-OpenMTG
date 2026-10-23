/**
 * Searchable card picker for the Images screen: search the local card index (`GET /api/cards/search`), pick a card, then pick the printed side when the
 * card has more than one image slot (engine `imageSlots`: one per printed side). Shows the first few results, with a control for the rest.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { CardSummary, ImageSlotMatch } from '@openmtg/server/api';
import { apiGet } from '../api/http';
import { sfx } from '../audio/sfx';
import { slotsOfSummary } from '../cards/model';

type Results = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; cards: CardSummary[]; total: number } | { kind: 'error'; message: string };

/** Results shown before "Show more". */
export const FIRST_RESULTS = 5;

const typeLineOf = (c: CardSummary): string => c.faces.map((f) => f.typeLine).join(' // ');

export function CardPicker({
  onPick,
  initialQuery = '',
  debounceMs = 250,
  label = 'Search for the card',
  autoFocus = false,
}: {
  onPick: (slot: ImageSlotMatch) => void;
  initialQuery?: string;
  debounceMs?: number;
  label?: string;
  /** Focus the search box when the picker appears (it replaced the control the player used to open it). */
  autoFocus?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Results>({ kind: 'idle' });
  const [chosen, setChosen] = useState<CardSummary | null>(null);
  const [showAll, setShowAll] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const firstSide = useRef<HTMLButtonElement>(null);
  /** The last search failed (ui.error once per outage, not on every pause in typing). */
  const failed = useRef(false);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (chosen) firstSide.current?.focus();
  }, [chosen]);

  useEffect(() => {
    const q = query.trim();
    setShowAll(false);
    if (q.length < 2) {
      setResults({ kind: 'idle' });
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setResults({ kind: 'loading' });
      apiGet('GET /api/cards/search', { query: { q }, signal: ctl.signal })
        .then((r) => {
          failed.current = false;
          setResults({ kind: 'ok', cards: r.cards, total: r.total });
        })
        .catch((e: unknown) => {
          if (ctl.signal.aborted) return;
          setResults({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
          if (!failed.current) sfx('ui.error');
          failed.current = true;
        });
    }, debounceMs);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query, debounceMs]);

  const pickCard = (card: CardSummary) => {
    const slots = slotsOfSummary(card);
    if (slots.length === 1) onPick({ key: slots[0]!.key, label: slots[0]!.label, card: card.name });
    else setChosen(card);
  };

  if (chosen) {
    const slots = slotsOfSummary(chosen);
    return (
      <div className="card-picker">
        <p>
          <strong>{chosen.name}</strong> has {slots.length} printed sides. Which one is this image?
        </p>
        <div className="card-picker-slots" role="group" aria-label={`Sides of ${chosen.name}`}>
          {slots.map((s, i) => (
            <button key={s.key} ref={i === 0 ? firstSide : undefined} type="button" onClick={() => onPick({ key: s.key, label: s.label, card: chosen.name })}>
              {s.label}
            </button>
          ))}
          <button type="button" className="button-link" onClick={() => setChosen(null)}>
            Another card
          </button>
        </div>
      </div>
    );
  }

  const shown = results.kind === 'ok' ? (showAll ? results.cards : results.cards.slice(0, FIRST_RESULTS)) : [];
  const hidden = results.kind === 'ok' ? results.cards.length - shown.length : 0;
  const unlisted = results.kind === 'ok' ? results.total - results.cards.length : 0;
  return (
    <div className="card-picker">
      <label htmlFor={id}>{label}</label>
      <input ref={input} id={id} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Card name" autoComplete="off" />
      {results.kind === 'loading' && <p className="muted">Searching…</p>}
      {results.kind === 'error' && <p className="card-picker-error" role="alert">Search failed: {results.message}</p>}
      {results.kind === 'ok' && results.cards.length === 0 && <p className="muted">No card found.</p>}
      {results.kind === 'ok' && results.cards.length > 0 && (
        <ul className="card-picker-results" aria-label="Search results">
          {shown.map((c) => (
            <li key={c.oracleId || c.name}>
              <button type="button" onClick={() => pickCard(c)} aria-label={`${c.name}, ${typeLineOf(c)}`}>
                <span className="card-picker-name">{c.name}</span>
                <span className="card-picker-type">{typeLineOf(c)}</span>
              </button>
            </li>
          ))}
          {hidden > 0 && (
            <li>
              <button type="button" className="button-link" onClick={() => setShowAll(true)}>
                Show {hidden} more
              </button>
            </li>
          )}
          {(showAll || hidden === 0) && unlisted > 0 && <li className="muted">{unlisted} more: type more of the name.</li>}
        </ul>
      )}
    </div>
  );
}
