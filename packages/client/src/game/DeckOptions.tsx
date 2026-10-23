/**
 * The decks of a deck picker (New game, Host, Join) as option groups: the player's saved decks, the built-in decks, then the Commander precons (newest
 * first, each with its commander so it can be found by commander as well as by name).
 */
import type { GameDeck } from './services';

/** The text of a deck's option: a precon also names its commander(s). */
export function deckOptionLabel(d: GameDeck): string {
  return d.precon ? `${d.name} · ${d.precon.commanders}` : d.name;
}

export function DeckOptions({ decks }: { decks: readonly GameDeck[] }) {
  const precons = decks.filter((d) => d.precon);
  const groups = [
    { label: 'Your decks', decks: decks.filter((d) => !d.builtIn) },
    { label: 'Built-in decks', decks: decks.filter((d) => d.builtIn && !d.precon) },
    { label: `Commander precons (${precons.length})`, decks: precons },
  ].filter((g) => g.decks.length > 0);
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.decks.map((d) => (
            <option key={d.id} value={d.id}>
              {deckOptionLabel(d)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
