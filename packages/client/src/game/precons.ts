/**
 * The preconstructed Commander decks a player can pick (every deck of docs/decks/commander-precons.md, generated into precons.generated.json by
 * scripts/gen-precons.ts): card names only, as printed, newest first. Loaded on first use, a chunk of its own (about 400 kB), so the app's start never
 * waits for it. A deck as printed may hold a card banned since or break a rule (the deck checks of the New game screen say so, as for any deck).
 */
import type { DeckEntry } from '@openmtg/server/api';
import type { GameDeck } from './services';

/** One deck of precons.generated.json. */
export interface PreconRow {
  id: string;
  name: string;
  set: string;
  released: string;
  colors: string;
  commander: [number, string][];
  main: [number, string][];
}

const entries = (rows: readonly [number, string][]): DeckEntry[] => rows.map(([count, name]) => ({ count, name }));

/** A precon as a deck to pick: "Counterpunch (CMD 2011)", its commander(s) in their own section. */
export function preconDeck(p: PreconRow): GameDeck {
  return {
    id: p.id,
    name: `${p.name} (${p.set} ${p.released.slice(0, 4)})`,
    format: 'commander',
    builtIn: true,
    precon: { set: p.set, released: p.released, commanders: p.commander.map(([, name]) => name).join(' and ') },
    deck: { commander: entries(p.commander), main: entries(p.main), sideboard: [] },
  };
}

let loaded: Promise<GameDeck[]> | undefined;

/** Every precon, newest first; the data is read once (a failed read is tried again on the next call). */
export function preconDecks(): Promise<GameDeck[]> {
  loaded ??= import('./precons.generated.json').then(
    (m) => (m.default.decks as PreconRow[]).map(preconDeck),
    (e: unknown) => {
      loaded = undefined;
      throw e;
    },
  );
  return loaded;
}
