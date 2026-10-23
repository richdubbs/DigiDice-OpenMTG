/**
 * Card data for the cards in a deck: decks store only Oracle names (and ids), so the deckbuilder looks each name up once through GET /api/cards/:name
 * and keeps the answers for the session. Search results are added as they arrive, so cards added from search need no extra request.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CardDetailResponse, CardSummary } from '@openmtg/server/api';
import { ApiRequestError } from '../api/http';
import type { DecksApi } from './context';

/** At most this many lookups at once (the server is local, but a 100-card import should not open 100 requests). */
const PARALLEL = 4;

export interface CardData {
  cards: ReadonlyMap<string, CardSummary>;
  details: ReadonlyMap<string, CardDetailResponse>;
  /** Names whose lookup failed: 'unknown' when the server does not know the card (404), 'unavailable' when the lookup itself failed. */
  missing: ReadonlyMap<string, 'unknown' | 'unavailable'>;
  remember(cards: readonly CardSummary[]): void;
}

/** `images`: ask for Scryfall image URLs too (only when the player opted in). */
export function useCardData(api: DecksApi, names: readonly string[], images = false): CardData {
  const [cards, setCards] = useState<ReadonlyMap<string, CardSummary>>(new Map());
  const [details, setDetails] = useState<ReadonlyMap<string, CardDetailResponse>>(new Map());
  const [missing, setMissing] = useState<ReadonlyMap<string, 'unknown' | 'unavailable'>>(new Map());
  const asked = useRef(new Set<string>());

  const remember = useCallback((list: readonly CardSummary[]) => {
    if (!list.length) return;
    setCards((m) => {
      const next = new Map(m);
      for (const c of list) next.set(c.name, c);
      return next;
    });
  }, []);

  const key = names.join('\n');
  useEffect(() => {
    const todo = names.filter((n) => !cards.has(n) && !asked.current.has(n));
    if (!todo.length) return;
    for (const n of todo) asked.current.add(n);
    let alive = true;
    const queue = [...todo];
    const worker = async () => {
      // A started lookup always records its answer; `alive` only stops taking more names from the queue.
      for (let name = queue.shift(); alive && name !== undefined; name = queue.shift()) {
        const n = name;
        try {
          const d = await api.card(n, images ? { images: true } : {});
          setDetails((m) => new Map(m).set(n, d));
          setCards((m) => new Map(m).set(n, d.card));
        } catch (e) {
          const why = e instanceof ApiRequestError && e.status === 404 ? 'unknown' : 'unavailable';
          setMissing((m) => new Map(m).set(n, why));
        }
      }
    };
    for (let i = 0; i < Math.min(PARALLEL, todo.length); i++) void worker();
    return () => {
      alive = false;
      // Lookups cut short may be asked again by the next run.
      for (const n of queue) asked.current.delete(n);
    };
    // `cards` is read only to skip known names; re-running on every arrival would restart the queue.
  }, [api, key, images]);

  return { cards, details, missing, remember };
}
