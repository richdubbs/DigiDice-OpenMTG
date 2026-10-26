/**
 * The decks of a deck picker (New game, Host, Join, the DigiDice server) as option groups: the player's saved decks, the built-in decks, then the
 * Commander precons by year, newest first (each with its commander so it can be found by commander as well as by name). Given the game's format, a deck
 * that format cannot play is greyed out and says why: in a Commander format, a deck without a commander (CR 903.3).
 *
 * Owner, 2026-10-25: every deck picker also has a dropdown for each category (`DeckChooser`): "All decks", "Your decks", "Built-in decks" or "Commander
 * precons"; with the precons, a second dropdown for the year. The deck list then holds only those decks (and the chosen one, so it stays shown).
 */
import { useState } from 'react';
import { commanderCount, commanderVariantOf } from './config';
import type { GameDeck } from './services';
import './game.css';

/** The text of a deck's option: a precon also names its commander(s). */
export function deckOptionLabel(d: GameDeck): string {
  return d.precon ? `${d.name} · ${d.precon.commanders}` : d.name;
}

/** Why the format cannot play the deck, as a short note for its option, or null: in a Commander format, a deck with no commander (CR 903.3). */
export function deckOptionNote(d: GameDeck, format: string | undefined): string | null {
  return format !== undefined && commanderVariantOf(format) !== null && commanderCount(d.deck) === 0 ? 'not a Commander deck' : null;
}

/** The categories of the deck pickers' first dropdown. */
export type DeckCategory = 'all' | 'yours' | 'builtIn' | 'precons';

const yearOf = (d: GameDeck): string => d.precon?.released.slice(0, 4) ?? '';

function inCategory(d: GameDeck, category: DeckCategory): boolean {
  if (category === 'yours') return !d.builtIn;
  if (category === 'builtIn') return !!d.builtIn && !d.precon;
  if (category === 'precons') return !!d.precon;
  return true;
}

/** The years of the precons, newest first, with how many decks each has. */
export function preconYears(decks: readonly GameDeck[]): { year: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of decks) if (d.precon) counts.set(yearOf(d), (counts.get(yearOf(d)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[0].localeCompare(a[0])).map(([year, count]) => ({ year, count }));
}

export function DeckOptions({ decks, format }: { decks: readonly GameDeck[]; format?: string }) {
  const groups = [
    { label: 'Your decks', decks: decks.filter((d) => inCategory(d, 'yours')) },
    { label: 'Built-in decks', decks: decks.filter((d) => inCategory(d, 'builtIn')) },
    ...preconYears(decks).map(({ year, count }) => ({ label: `Commander precons ${year} (${count})`, decks: decks.filter((d) => d.precon && yearOf(d) === year) })),
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

/**
 * A deck picker with its category dropdowns: "Show" (all decks or one category) and, for the precons, "Year"; then the "Deck" dropdown itself.
 * The category dropdowns are left out when there is only one category to show.
 */
export function DeckChooser({
  decks, value, onChange, format, placeholder = 'Choose a deck…', disabled = false,
}: {
  decks: readonly GameDeck[];
  value: string;
  onChange: (id: string) => void;
  format?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [category, setCategory] = useState<DeckCategory>('all');
  const [year, setYear] = useState('all');
  const categories = (
    [
      { id: 'yours', label: 'Your decks' },
      { id: 'builtIn', label: 'Built-in decks' },
      { id: 'precons', label: 'Commander precons' },
    ] as const
  )
    .map((c) => ({ ...c, count: decks.filter((d) => inCategory(d, c.id)).length }))
    .filter((c) => c.count > 0);
  const years = category === 'precons' ? preconYears(decks) : [];
  const shown = decks.filter((d) => d.id === value || (inCategory(d, category) && (category !== 'precons' || year === 'all' || yearOf(d) === year)));
  return (
    <>
      {categories.length > 1 && (
        <div className="deck-chooser-filter" role="group" aria-label="Deck categories">
          <label>
            Show
            <select
              value={category}
              disabled={disabled}
              onChange={(e) => {
                setCategory(e.target.value as DeckCategory);
                setYear('all');
              }}
            >
              <option value="all">All decks ({decks.length})</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.count})
                </option>
              ))}
            </select>
          </label>
          {years.length > 0 && (
            <label>
              Year
              <select value={year} disabled={disabled} onChange={(e) => setYear(e.target.value)}>
                <option value="all">All years</option>
                {years.map((y) => (
                  <option key={y.year} value={y.year}>
                    {y.year} ({y.count})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <label>
        Deck
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">{placeholder}</option>
          <DeckOptions decks={shown} {...(format !== undefined ? { format } : {})} />
        </select>
      </label>
    </>
  );
}
