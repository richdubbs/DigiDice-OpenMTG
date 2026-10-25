/**
 * The decks of a deck picker (New game, Host, Join) as option groups: the player's saved decks, the built-in decks, then the Commander precons (newest
 * first, each with its commander so it can be found by commander as well as by name). Given the game's format, a deck that format cannot play is greyed
 * out and says why: in a Commander format, a deck without a commander (the 60-card practice decks, CR 903.3).
 */
import { commanderCount, commanderVariantOf } from './config';
import type { GameDeck } from './services';

/** The text of a deck's option: a precon also names its commander(s). */
export function deckOptionLabel(d: GameDeck): string {
  return d.precon ? `${d.name} · ${d.precon.commanders}` : d.name;
}

/** Why the format cannot play the deck, as a short note for its option, or null: in a Commander format, a deck with no commander (CR 903.3). */
export function deckOptionNote(d: GameDeck, format: string | undefined): string | null {
  return format !== undefined && commanderVariantOf(format) !== null && commanderCount(d.deck) === 0 ? 'not a Commander deck' : null;
}

export function DeckOptions({ decks, format }: { decks: readonly GameDeck[]; format?: string }) {
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
          {g.decks.map((d) => {
            const note = deckOptionNote(d, format);
            return (
              <option key={d.id} value={d.id} disabled={note !== null}>
                {deckOptionLabel(d)}
                {note !== null ? ` (${note})` : ''}
              </option>
            );
          })}
        </optgroup>
      ))}
    </>
  );
}
