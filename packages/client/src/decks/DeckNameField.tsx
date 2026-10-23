/**
 * The deckbuilder's deck name: edited as a draft, saved on every keystroke while it is not blank. A blank name is never saved (the library would show
 * a row with no name); leaving the field puts the last name back.
 */
import { useEffect, useState } from 'react';

export function DeckNameField({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  // A rename from elsewhere (reloading the deck) shows up in the field.
  useEffect(() => setDraft(name), [name]);
  const blank = draft.trim() === '';
  return (
    <span className="deck-name-field">
      <label>
        <span className="sr-only">Deck name</span>
        <input
          value={draft}
          title={draft}
          aria-label="Deck name"
          placeholder="Deck name"
          aria-describedby={blank ? 'deck-name-hint' : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim()) onRename(e.target.value);
          }}
          onBlur={() => blank && setDraft(name)}
        />
      </label>
      {blank && (
        <span id="deck-name-hint" className="deck-hint deck-error">
          A deck needs a name; the last name is kept.
        </span>
      )}
    </span>
  );
}
