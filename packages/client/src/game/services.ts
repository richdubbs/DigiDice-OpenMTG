/**
 * What the game screens need from the rest of the app, as one small adapter (tests pass their own):
 * - the saved decks (deck library of work package C3, IndexedDB) plus the built-in practice decks and the Commander precons (precons.ts);
 * - deck checks for a format (`POST /api/decks/validate`, work package C1 on top of the cards package's format rules, package F1);
 * - compiled card definitions (`POST /api/cards/defs`, C1): game configs embed them, so the engine state is self-contained;
 * - a fresh seed for each game (the browser's crypto RNG; the engine itself never reads randomness, ARCHITECTURE.md principle 1);
 * - each deck's sleeve, the one of its colors (branding/sleeves.ts), from its cards' data (`GET /api/cards/:name`).
 *
 * `validateDeck` answers null when the server has no deck checker (501/503), and the New game screen then says the decks were not checked.
 */
import type { GameConfig } from '@openmtg/engine';
import type { CardSummary, DeckList, DefsResponse, ValidateResponse } from '@openmtg/server/api';
import { ApiRequestError, apiPost } from '../api/http';
import { deckSleeve } from '../branding/sleeves';
import { LocalConnection } from '../connection/LocalConnection';
import { httpDecksApi, pageStore, type DecksApi } from '../decks/context';
import { deckColors } from '../decks/look';
import { toDeckList } from '../decks/model';
import type { DeckStore } from '../decks/store';
import { PRACTICE_DECKS } from './practiceDecks';
import { preconDecks } from './precons';

/** A deck a player can pick for a game. */
export interface GameDeck {
  id: string;
  name: string;
  /** The format the deck was built for (a FORMATS id of config.ts, "casual" when unrestricted; "freeform" is read as casual); preselected for the game. */
  format?: string;
  deck: DeckList;
  /** A built-in practice deck (not from the player's library). */
  builtIn?: boolean;
  /** A preconstructed Commander deck as printed (precons.ts): built in too, listed in its own group with its commander(s). */
  precon?: { set: string; released: string; commanders: string };
}

export interface GameServices {
  listDecks(): Promise<GameDeck[]>;
  /** Construction problems of `deck` in `format`; null when no deck checker is available (the screen says so, nothing is assumed). */
  validateDeck(deck: DeckList, format: string): Promise<ValidateResponse | null>;
  /**
   * `signal` aborts the request when the player leaves the New game screen before it answers. `stubs`: names the player confirmed to play as blank stub
   * cards, resolved by hand (DefsRequest.stubs, C1).
   */
  compileDefs(names: string[], opts?: { signal?: AbortSignal; stubs?: string[] }): Promise<DefsResponse>;
  newSeed(): string;
  /** The sleeve of the deck's colors, the player's card backs in the game; undefined: the classic back. Absent: everyone has the classic back. */
  deckSleeve?(deck: DeckList): Promise<string | undefined>;
}

/** The player's saved decks: the deck library's store (C3, IndexedDB; the same store the Decks screens use), newest first as the library lists them. */
export async function savedDecks(store: DeckStore = pageStore()): Promise<GameDeck[]> {
  const decks = await store.list();
  return decks.map((d) => ({ id: d.id, name: d.name, format: d.format, deck: toDeckList(d) }));
}

/** Card data read for sleeves, kept for the page's life (a failed lookup is asked again next time). */
const sleeveCards = new Map<string, CardSummary>();

/** The sleeve of a deck's colors (decks/look.ts deckColors), its cards looked up four at a time; a card that cannot be read adds no color. */
export async function deckSleeveOf(deck: DeckList, api: Pick<DecksApi, 'card'> = httpDecksApi): Promise<string | undefined> {
  const queue = [...new Set([...deck.main, ...(deck.commander ?? [])].map((e) => e.name))].filter((n) => !sleeveCards.has(n));
  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      try {
        sleeveCards.set(n, (await api.card(n)).card);
      } catch {
        // No color from this card; the sleeve is still the one of the colors that were read.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return deckSleeve(deckColors(deck, sleeveCards));
}

/** A 128-bit random seed in hex. */
export function newSeed(): string {
  const words = new Uint32Array(4);
  globalThis.crypto.getRandomValues(words);
  return Array.from(words, (w) => w.toString(16).padStart(8, '0')).join('');
}

export const defaultServices: GameServices = {
  async listDecks() {
    let saved: GameDeck[] = [];
    try {
      saved = await savedDecks();
    } catch (e) {
      console.error('[NewGame] could not read the saved decks', e);
    }
    let precons: GameDeck[] = [];
    try {
      precons = await preconDecks();
    } catch (e) {
      console.error('[NewGame] could not load the Commander precons', e);
    }
    return [...saved, ...PRACTICE_DECKS, ...precons];
  },
  async validateDeck(deck, format) {
    try {
      return await apiPost('POST /api/decks/validate', { deck, format });
    } catch (e) {
      // 501: a scaffold stub; 503: the server has no card data yet (server api.ts header).
      if (e instanceof ApiRequestError && (e.status === 501 || e.status === 503)) return null;
      throw e;
    }
  },
  compileDefs: (names, opts) =>
    apiPost('POST /api/cards/defs', { names, ...(opts?.stubs?.length ? { stubs: opts.stubs } : {}) }, opts?.signal ? { signal: opts.signal } : {}),
  newSeed,
  deckSleeve: (deck) => deckSleeveOf(deck),
};

/**
 * Rematch for a hot-seat game: the same players, decks, definitions and options with a fresh seed. The New game screen puts it on the game route, so
 * the game screen offers Rematch without knowing what kind of connection it has (an online rematch, milestone 9, brings its own).
 */
export function localRematch(config: GameConfig, seed: () => string): () => LocalConnection {
  return () => new LocalConnection({ ...config, seed: seed() });
}
