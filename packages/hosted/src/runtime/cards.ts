/**
 * The deck workers' default card source (design 2.1, 6.2; package M13-5): the cards package's local index at `CARD_DATA_DIR` (Scryfall-derived data,
 * mounted at run time, never in the repository). It never fetches: a decklist never makes the server contact anyone (design 6.2). Imported only inside a
 * deck worker (`CardSourceSpec.module`).
 */
import { CardDatabase } from '@openmtg/cards';
import type { CardSource } from '@openmtg/net/server-kit';

export interface DefaultCardSourceOptions {
  /** The card index directory (`CARD_DATA_DIR`); absent: the cards package's default cache directory. */
  cacheDir?: string | null;
}

export async function createCardSource(options: unknown): Promise<CardSource> {
  const o = (options ?? {}) as DefaultCardSourceOptions;
  const db = await CardDatabase.open(o.cacheDir ? { cacheDir: o.cacheDir } : {});
  // resolveNames without fetchMissing: local names only.
  return { resolveNames: (names) => db.resolveNames(names), suggest: (name, limit) => db.suggest(name, limit) };
}
