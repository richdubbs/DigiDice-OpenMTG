/**
 * What the deck screens talk to: the deck store (IndexedDB) and the local server's card and deck endpoints. Both are behind small interfaces so tests
 * (and, later, other back ends) can swap them; by default the screens use the browser store and the HTTP API of packages/server.
 *
 * The "Show card images from Scryfall" setting (`showScryfallImages`) is C2's page-wide setting (`useShowScryfallImages()`) unless a provider sets it,
 * and the card component (`cardView`) is C2's card (CardPreview.tsx `DeckCardView`: the player's uploaded image, then the opt-in Scryfall image, then
 * the text frame) unless a provider passes another one (tests).
 */
import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import type { CardDetailResponse, ResolveResponse, SearchQuery, SearchResponse, SetsResponse, ValidateResponse } from '@openmtg/server/api';
import { ApiRequestError, apiGet, apiPost } from '../api/http';
import { useShowScryfallImages } from '../images/settings';
import type { CardViewProps } from './CardPreview';
import { toDeckList, type Deck } from './model';
import { defaultDeckStore, type DeckStore } from './store';

/**
 * The search query the deckbuilder sends. MERGE NOTE (C1): `identity`, `pow`, `tou` and `keywords` are C1 additions to `SearchQuery` in
 * packages/server/src/api.ts (not on main when C3 was built); once C1 is merged this is just `SearchQuery`.
 */
export type DeckSearchQuery = SearchQuery & { identity?: string; pow?: string; tou?: string; keywords?: string };

/** The server calls the deck screens make (types from packages/server/src/api.ts). */
export interface DecksApi {
  search(query: DeckSearchQuery, signal?: AbortSignal): Promise<SearchResponse>;
  card(name: string, opts?: { signal?: AbortSignal; images?: boolean }): Promise<CardDetailResponse>;
  resolve(text: string): Promise<ResolveResponse>;
  /** Format validation (work package F1 rules, served by C1). `format` is the deck's format id (formats.ts). */
  validate(deck: Deck, format: string, signal?: AbortSignal): Promise<ValidateResponse>;
  /** Every set, for the Advanced search form's Set field (optional: without it the field takes typed codes and names only). */
  sets?(signal?: AbortSignal): Promise<SetsResponse>;
}

/** The format name the validation API takes: the client's "casual" is the contract's "freeform" (no card-pool checks; api.ts ValidateRequest). */
export const validationFormat = (format: string): string => (format === 'casual' ? 'freeform' : format);

export const httpDecksApi: DecksApi = {
  search: (query, signal) => apiGet('GET /api/cards/search', { query, ...(signal ? { signal } : {}) }),
  card: (name, opts = {}) => apiGet('GET /api/cards/:name', { params: { name }, ...(opts.images ? { query: { images: 1 } } : {}), ...(opts.signal ? { signal: opts.signal } : {}) }),
  resolve: (text) => apiPost('POST /api/decks/resolve', { text }),
  validate: (deck, format, signal) => apiPost('POST /api/decks/validate', { deck: toDeckList(deck), format: validationFormat(format) }, signal ? { signal } : {}),
  sets: (signal) => apiGet('GET /api/sets', signal ? { signal } : {}),
};

/** What every deck screen shows when the local server cannot be reached. */
export const SERVER_NOT_RUNNING = 'The OpenMTG server is not running. Start it with npm run play, then try again.';

/** An error from a server call in plain words: a failed fetch (TypeError) or a gateway error (502/503/504) means the local server is not running. */
export function describeApiError(e: unknown): string {
  if (e instanceof TypeError) return SERVER_NOT_RUNNING;
  if (e instanceof ApiRequestError && (e.status === 502 || e.status === 503 || e.status === 504)) return SERVER_NOT_RUNNING;
  return e instanceof Error ? e.message : String(e);
}

interface DecksEnv {
  store: DeckStore;
  api: DecksApi;
  /** The player turned on "Show card images from Scryfall" (off by default). */
  showScryfallImages: boolean;
  /** The card component; undefined: C2's card (CardPreview.tsx DeckCardView). */
  cardView?: ComponentType<CardViewProps>;
}

let sharedStore: DeckStore | null = null;
/** One store per page, so the library and the deckbuilder see the same decks even when it is the in-memory fallback. */
export function pageStore(): DeckStore {
  sharedStore ??= defaultDeckStore();
  return sharedStore;
}

const DecksContext = createContext<Partial<DecksEnv>>({});

export function DecksProvider({
  store,
  api,
  showScryfallImages,
  cardView,
  children,
}: {
  store?: DeckStore;
  api?: DecksApi;
  showScryfallImages?: boolean;
  cardView?: ComponentType<CardViewProps>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ ...(store ? { store } : {}), ...(api ? { api } : {}), ...(showScryfallImages !== undefined ? { showScryfallImages } : {}), ...(cardView ? { cardView } : {}) }),
    [store, api, showScryfallImages, cardView],
  );
  return <DecksContext.Provider value={value}>{children}</DecksContext.Provider>;
}

export function useDecksEnv(): DecksEnv {
  const env = useContext(DecksContext);
  const [scryfall] = useShowScryfallImages();
  return { store: env.store ?? pageStore(), api: env.api ?? httpDecksApi, showScryfallImages: env.showScryfallImages ?? scryfall, ...(env.cardView ? { cardView: env.cardView } : {}) };
}

/** "2026-10-12T09:30:00.000Z" for stored dates. */
export const nowIso = () => new Date().toISOString();

/** A stored ISO date as the player's own calendar date ("2026-10-12"), not the UTC one. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
