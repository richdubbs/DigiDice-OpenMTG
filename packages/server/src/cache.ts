/**
 * The server's view of the local card cache (docs/design/m8-client.md, "Server API"): the card index (@openmtg/cards CardDatabase over the Scryfall
 * cache), the compiled-definition cache and the classification index the API reads.
 *
 * One store per cache directory, opened on first use and kept in memory (the index is about 34k cards). When the index files change on disk (a card-data
 * refresh while the server runs), the next request opens the new index. Only the local index is read: nothing here talks to the network.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { CardDatabase, CardDatabaseError, type IndexedCard } from '@openmtg/cards';
import type { StatusResponse } from './api';
import { AutomationIndex } from './automation';
import { DefCache } from './compiled';
import type { ServerContext } from './context';
import { fold } from './search-query';

export interface CardStore {
  readonly db: CardDatabase;
  /**
   * Every deckable card of the index, sorted by folded Oracle name (compareCardNames): the stable order of search results. Tokens and meld results (the
   * back face of a meld pair, CR 712.4b) are left out; `db` still finds them by name (image slots).
   */
  readonly cards: readonly IndexedCard[];
  /** A card by Scryfall Oracle id (decks store it next to the name). */
  byOracleId(id: string): IndexedCard | undefined;
  readonly defs: DefCache;
  readonly automation: AutomationIndex;
  /** Per-store memo for data derived from the cards (search rows): built once, dropped with the store. */
  derived<T>(key: string, build: (store: CardStore) => T): T;
}

export type StoreResult = { ok: true; store: CardStore } | { ok: false; status: 503; error: string; code: 'noCardData' };

/** The 503 answer of a failed `cardStore` (api.ts ApiError `code`). */
export const storeError = (r: { status: 503; error: string; code: 'noCardData' }) => ({ status: r.status, body: { error: r.error, code: r.code } });

/**
 * Card-name order: the folded name (case, accents and quotes ignored, so "Éowyn" sorts among the E names, not after Z), then the exact name as the
 * tiebreaker so the order is total and stable.
 */
export function compareCardNames(a: string, b: string): number {
  const fa = fold(a);
  const fb = fold(b);
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The back face of a meld pair, which Scryfall lists as a card of its own (layout "meld", its own all_parts entry is the meld_result). */
export function isMeldResult(card: IndexedCard): boolean {
  return card.layout === 'meld' && (card.all_parts ?? []).some((p) => p.component === 'meld_result' && p.name === card.name);
}

export const NO_CARD_DATA =
  'No card data yet: download the Scryfall Oracle Cards bulk data with "npm run cards -- refresh" (or the Update button), then try again.';

interface Entry {
  stamp: string;
  store: Promise<CardStore>;
}

const stores = new Map<string, Entry>();

/** Changes when the index files are rewritten (size and modification time of cards.jsonl and tokens.jsonl); null when there is no index. */
async function indexStamp(cacheDir: string): Promise<string | null> {
  try {
    const [cards, tokens] = await Promise.all([stat(path.join(cacheDir, 'cards.jsonl')), stat(path.join(cacheDir, 'tokens.jsonl'))]);
    return `${cards.size}:${cards.mtimeMs}:${tokens.size}:${tokens.mtimeMs}`;
  } catch {
    return null;
  }
}

/** Build a store over an opened database (tests use it with an in-memory database). Does not start the classification build. */
export function storeFromDatabase(db: CardDatabase, compiledDir: string): CardStore {
  // CR 712.4b: a meld result is used only for the melded permanent, so it is no card to search for or put in a deck.
  const cards = ([...db.cards()] as IndexedCard[]).filter((c) => !isMeldResult(c));
  cards.sort((a, b) => compareCardNames(a.name, b.name));
  let oracle: Map<string, IndexedCard> | undefined;
  const memo = new Map<string, unknown>();
  const store: CardStore = {
    db,
    cards,
    byOracleId(id) {
      oracle ??= new Map(cards.flatMap((c) => (c.oracle_id ? [[c.oracle_id, c] as const] : [])));
      return oracle.get(id);
    },
    defs: new DefCache(compiledDir),
    automation: new AutomationIndex(compiledDir, cards),
    derived<T>(key: string, build: (s: CardStore) => T): T {
      if (!memo.has(key)) memo.set(key, build(store));
      return memo.get(key) as T;
    },
  };
  return store;
}

async function openStore(ctx: ServerContext): Promise<CardStore> {
  const db = await CardDatabase.open({ cacheDir: ctx.cacheDir });
  const store = storeFromDatabase(db, ctx.compiledDir);
  void store.automation.start(); // the classification index builds in the background (time-sliced, automation.ts)
  return store;
}

const keyOf = (ctx: ServerContext): string => `${path.resolve(ctx.cacheDir)}|${path.resolve(ctx.compiledDir)}`;

/** The card store of a context, or a 503 answer when the cache has no index yet. */
export async function cardStore(ctx: ServerContext): Promise<StoreResult> {
  const key = keyOf(ctx);
  const stamp = await indexStamp(ctx.cacheDir);
  if (stamp === null) return { ok: false, status: 503, error: NO_CARD_DATA, code: 'noCardData' };
  let entry = stores.get(key);
  if (!entry || entry.stamp !== stamp) {
    if (entry) void entry.store.then((s) => s.automation.stop(), () => undefined);
    entry = { stamp, store: openStore(ctx) };
    stores.set(key, entry);
  }
  try {
    return { ok: true, store: await entry.store };
  } catch (e) {
    if (stores.get(key) === entry) stores.delete(key); // try again on the next request
    if (e instanceof CardDatabaseError) return { ok: false, status: 503, error: NO_CARD_DATA, code: 'noCardData' };
    throw e;
  }
}

/** Open the store and start the classification index in the background (server startup). Never throws. */
export async function warmCardCache(ctx: ServerContext): Promise<void> {
  try {
    await cardStore(ctx);
  } catch (e) {
    console.error('[openmtg-server] could not open the card index:', e);
  }
}

/** Stop background work and forget every store (tests, shutdown). */
export async function closeCardStores(): Promise<void> {
  const all = [...stores.values()];
  stores.clear();
  await Promise.all(all.map((e) => e.store.then((s) => s.automation.stop(), () => undefined)));
}

/**
 * Automation coverage of the whole card pool for the About screen (full, partial and manual card counts), null while the classification index has
 * not been built, or no store is open (the status endpoint never loads the index itself).
 */
export async function coverageCounts(ctx: ServerContext): Promise<StatusResponse['coverage']> {
  const entry = stores.get(keyOf(ctx));
  if (!entry) return null;
  try {
    return (await entry.store).automation.counts();
  } catch {
    return null;
  }
}
