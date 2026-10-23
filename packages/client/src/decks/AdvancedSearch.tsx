/**
 * The deckbuilder's "Advanced search" panel (SearchPanel.tsx opens it from its own button): one box that takes Scryfall's search syntax, a small form
 * whose fields write Scryfall syntax into that box, a cheat sheet and the link to Scryfall's guide. The box is the only state: the form adds terms to it
 * (it never reads the box back), so what is searched is always exactly what the player can see. The server reads the syntax; a keyword the card data cannot
 * answer (rarity, artist, prices, ...) comes back as a message naming it, shown under the box. The Set field suggests every set (GET /api/sets, loaded the
 * first time the field is used) and writes s:<code>; a typed name works too.
 */
import { useRef, useState } from 'react';
import type { SetsResponse, SetSummary } from '@openmtg/server/api';
import {
  appendTerms,
  builderTerms,
  COLOR_OPS,
  COMPARE_OPS,
  EMPTY_BUILDER,
  FORMAT_CHOICES,
  IS_CHOICES,
  SCRYFALL_SYNTAX_URL,
  SYNTAX_EXAMPLES,
  UNAVAILABLE_NOTE,
  type BuilderFields,
  type ColorOp,
  type CompareOp,
} from './scryfallBuilder';

export function AdvancedSearch({
  value,
  onChange,
  error,
  loadSets,
}: {
  value: string;
  onChange: (query: string) => void;
  error: string | null;
  /** The sets the Set field suggests (DecksApi.sets). */
  loadSets?: (signal?: AbortSignal) => Promise<SetsResponse>;
}) {
  const [fields, setFields] = useState<BuilderFields>(EMPTY_BUILDER);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const asked = useRef(false);
  const askSets = () => {
    if (asked.current || !loadSets) return;
    asked.current = true;
    loadSets().then(
      (r) => setSets(r.sets),
      () => {
        asked.current = false; // offline: typed codes and names still work, and the next focus asks again
      },
    );
  };
  const set = <K extends keyof BuilderFields>(k: K, v: BuilderFields[K]) => setFields((f) => ({ ...f, [k]: v }));
  const terms = builderTerms(fields);

  const text = (key: 'name' | 'oracle' | 'type' | 'keyword' | 'colors' | 'identity' | 'produces', label: string, placeholder: string) => (
    <input aria-label={`${label} (builder)`} placeholder={placeholder} value={fields[key]} onChange={(e) => set(key, e.target.value)} />
  );
  const colorOp = (key: 'colorsOp' | 'identityOp', label: string) => (
    <select aria-label={`${label} (builder)`} value={fields[key]} onChange={(e) => set(key, e.target.value as ColorOp)}>
      {COLOR_OPS.map((o) => (
        <option key={o.op} value={o.op}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const numeric = (opKey: 'mvOp' | 'powerOp' | 'toughnessOp', key: 'mv' | 'power' | 'toughness', label: string) => (
    <span className="deck-advanced-pair">
      <select aria-label={`${label} comparison (builder)`} value={fields[opKey]} onChange={(e) => set(opKey, e.target.value as CompareOp)}>
        {COMPARE_OPS.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>
      <input aria-label={`${label} (builder)`} placeholder={label} value={fields[key]} onChange={(e) => set(key, e.target.value)} size={6} />
    </span>
  );

  return (
    <div className="deck-advanced">
      <label className="deck-advanced-box">
        <span>Search in Scryfall syntax</span>
        <input
          type="text"
          aria-label="Scryfall syntax"
          placeholder='t:creature c:g mv<=3 o:"draw a card"'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby="deck-advanced-note"
        />
      </label>
      {error && <p className="deck-error deck-hint">{error}</p>}
      <p id="deck-advanced-note" className="muted deck-hint">
        Words search card names; keywords narrow the search (<code>c:</code>, <code>id:</code>, <code>t:</code>, <code>o:</code>, <code>mv</code>, <code>pow</code>, <code>f:</code>, <code>s:</code>, <code>is:</code> ...). Combine them with spaces (and), <code>or</code>, ( ) and <code>-</code> (not).{' '}
        <a href={SCRYFALL_SYNTAX_URL} target="_blank" rel="noopener noreferrer">
          Scryfall syntax guide
        </a>
        . {UNAVAILABLE_NOTE}
      </p>

      <fieldset className="deck-advanced-form">
        <legend>Build a search</legend>
        <div className="deck-search-row">
          {text('name', 'Name contains', 'Name contains')}
          {text('oracle', 'Rules text contains', 'Rules text contains')}
          {text('type', 'Type line contains', 'Type: creature, elf')}
          {text('keyword', 'Keyword', 'Keyword: flying')}
        </div>
        <div className="deck-search-row">
          <span className="deck-advanced-pair">
            {colorOp('colorsOp', 'Colors comparison')}
            {text('colors', 'Colors', 'Colors: rg, izzet, c, m')}
          </span>
          <span className="deck-advanced-pair">
            {colorOp('identityOp', 'Color identity comparison')}
            {text('identity', 'Color identity', 'Identity: esper')}
          </span>
          {text('produces', 'Produces mana', 'Produces: g')}
          <input
            aria-label="Set (builder)"
            placeholder="Set: dmu, Dominaria United"
            list="deck-set-list"
            value={fields.set}
            onFocus={askSets}
            onChange={(e) => set('set', e.target.value)}
            autoComplete="off"
          />
          <datalist id="deck-set-list">
            {sets.map((s) => (
              <option key={s.code} value={s.code}>
                {`${s.name}${s.released ? ` (${s.released.slice(0, 4)})` : ''}`}
              </option>
            ))}
          </datalist>
        </div>
        <div className="deck-search-row">
          {numeric('mvOp', 'mv', 'Mana value')}
          {numeric('powerOp', 'power', 'Power')}
          {numeric('toughnessOp', 'toughness', 'Toughness')}
        </div>
        <div className="deck-search-row">
          <select aria-label="Only this format (builder)" value={fields.format} onChange={(e) => set('format', e.target.value)}>
            <option value="">Any format</option>
            {FORMAT_CHOICES.map((f) => (
              <option key={f} value={f}>
                Legal in {f}
              </option>
            ))}
          </select>
          <select aria-label="Card property (builder)" value={fields.is} onChange={(e) => set('is', e.target.value)}>
            <option value="">Any card</option>
            {IS_CHOICES.map((p) => (
              <option key={p} value={p}>
                is:{p}
              </option>
            ))}
          </select>
          <span className="deck-advanced-actions">
            <button
              type="button"
              disabled={terms.length === 0}
              onClick={() => {
                onChange(appendTerms(value, terms));
                setFields(EMPTY_BUILDER);
              }}
            >
              Add to search
            </button>
            <button type="button" className="button-link" disabled={value.trim() === ''} onClick={() => onChange('')}>
              Clear advanced search
            </button>
          </span>
        </div>
        {terms.length > 0 && (
          <p className="muted deck-hint">
            Adds: <code>{terms.join(' ')}</code>
          </p>
        )}
      </fieldset>

      <details className="deck-advanced-sheet">
        <summary>Syntax cheat sheet</summary>
        <ul>
          {SYNTAX_EXAMPLES.map((ex) => (
            <li key={ex.query}>
              <button type="button" className="button-link deck-advanced-example" onClick={() => onChange(ex.query)} title="Use this example">
                <code>{ex.query}</code>
              </button>
              <span className="muted"> {ex.finds}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
