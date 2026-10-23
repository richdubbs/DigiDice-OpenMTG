/**
 * Naming something (CR 607.2d, 608.2d, 201.4): a creature type, card type or land type from the engine's closed list (filtered as the player types), or a
 * card name searched in the local Oracle index through the server (`GET /api/cards/search`), offering each face's name (CR 201.4b-f, 709.4a, 712.19).
 *
 * The decision can't be cancelled, so it must never become a dead end: when the search is not available (server unreachable, card data not downloaded, an
 * endpoint not implemented) the prompt says why, offers the names of the cards in this game, and lets the player use the typed name after a warning that
 * it is not checked against the card list.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ApiRequestError, apiGet } from '../api/http';
import { filterNames, gameCardNames, namesMatching } from './cardNames';
import { usePrimary } from './keys';
import type { CardNameSearch, PromptProps } from './types';
import { PromptActions } from './PromptActions';

export { filterNames } from './cardNames';

const MAX_SHOWN = 40;

/** The default card-name search: the server's card search, reduced to the nameable names that match the query. */
export const serverCardNameSearch: CardNameSearch = async (query, signal, kind) => {
  const r = await apiGet('GET /api/cards/search', { query: { q: query }, signal });
  return { names: namesMatching(r.cards, query, kind), complete: r.total <= r.cards.length };
};

export const CardNameSearchContext = createContext<CardNameSearch>(serverCardNameSearch);

type SearchResult =
  | { state: 'idle' | 'loading'; names: string[]; complete: boolean }
  | { state: 'done'; names: string[]; complete: boolean }
  | { state: 'error'; names: string[]; complete: boolean; message: string };

/** Why the search failed, in the server's own words when it answered. */
function searchError(e: unknown): string {
  if (e instanceof ApiRequestError) return `The card search is not available: ${e.message} (HTTP ${e.status})`;
  return 'The OpenMTG server could not be reached.';
}

function useCardSearch(query: string, enabled: boolean, kind?: 'land' | 'nonland'): SearchResult {
  const search = useContext(CardNameSearchContext);
  const [result, setResult] = useState<SearchResult>({ state: 'idle', names: [], complete: true });
  useEffect(() => {
    if (!enabled || query.trim().length < 2) {
      setResult({ state: 'idle', names: [], complete: true });
      return;
    }
    const ctl = new AbortController();
    setResult((r) => ({ state: 'loading', names: r.names, complete: r.complete }));
    const timer = setTimeout(() => {
      (kind === undefined ? search(query.trim(), ctl.signal) : search(query.trim(), ctl.signal, kind)).then(
        (r) => {
          if (!ctl.signal.aborted) setResult({ state: 'done', names: [...new Set(r.names)], complete: r.complete });
        },
        (e: unknown) => {
          if (!ctl.signal.aborted) setResult({ state: 'error', names: [], complete: true, message: searchError(e) });
        },
      );
    }, 200);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [query, enabled, search, kind]);
  return result;
}

const WHAT: Record<string, string> = { cardName: 'a card name', creatureType: 'a creature type', cardType: 'a card type', landType: 'a land type' };

export function ChooseNamePrompt({ d, view, answer, busy }: PromptProps<'chooseName'>) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [typed, setTyped] = useState(false); // `chosen` is the typed text, not a name from a list
  const closed = d.options !== undefined;
  const found = useCardSearch(query, !closed, d.cardKind);
  const failed = !closed && found.state === 'error';
  const offline = useMemo(() => (failed ? filterNames(gameCardNames(view, d.cardKind), query) : []), [failed, view, query, d.cardKind]);
  const list = useMemo(() => (closed ? filterNames(d.options!, query) : failed ? offline : found.names), [closed, d.options, query, failed, offline, found.names]);
  const hidden = Math.max(0, list.length - MAX_SHOWN);
  const serverHasMore = !closed && found.state === 'done' && !found.complete; // only the first page of matching cards came back
  const typedName = query.trim();
  const submit = () => {
    if (chosen !== null) answer({ kind: 'chooseName', name: chosen });
  };
  usePrimary(submit, chosen !== null);
  return (
    <>
      <label className="prompt-field">
        Search {d.what === 'cardName' && d.cardKind !== undefined ? `a ${d.cardKind} card name` : WHAT[d.what] ?? 'a name'}
        <input
          type="search"
          aria-label="Search names"
          value={query}
          disabled={busy}
          autoFocus
          onChange={(e) => {
            setQuery(e.target.value);
            if (typed) {
              setChosen(null);
              setTyped(false);
            }
          }}
        />
      </label>
      {!closed && found.state === 'idle' && <p className="prompt-hint">Type at least two letters of the card name.</p>}
      {!closed && found.state === 'loading' && <p className="prompt-hint">Searching...</p>}
      {found.state === 'error' && (
        <p className="prompt-warning" role="status">
          {found.message} {offline.length > 0 ? 'Names of the cards in this game:' : 'No card in this game matches; you can use the typed name.'}
        </p>
      )}
      {(closed || found.state === 'done') && list.length === 0 && <p className="prompt-hint">No match.</p>}
      <div className="prompt-chips prompt-names" role="listbox" aria-label="Names">
        {list.slice(0, MAX_SHOWN).map((n) => (
          <button
            key={n}
            type="button"
            role="option"
            aria-selected={chosen === n}
            className={chosen === n ? 'prompt-chip is-selected' : 'prompt-chip'}
            disabled={busy}
            onClick={() => {
              setChosen(n);
              setTyped(false);
            }}
          >
            {n}
          </button>
        ))}
        {(hidden > 0 || serverHasMore) && (
          <span className="prompt-hint">{hidden > 0 ? `${hidden} more` : 'More cards match'}: keep typing.</span>
        )}
      </div>
      {failed && typedName !== '' && !list.includes(typedName) && (
        <div className="prompt-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setChosen(typedName);
              setTyped(true);
            }}
          >
            Use the typed name
          </button>
        </div>
      )}
      {typed && chosen !== null && (
        <p className="prompt-warning">
          "{chosen}" is not checked against the Oracle card list (CR 201.4): make sure it is the exact name of a card.
        </p>
      )}
      <PromptActions>
        <button type="button" className="button-primary" disabled={busy || chosen === null} onClick={submit}>
          {chosen === null ? 'Choose a name' : `Name "${chosen}"`}
        </button>
      </PromptActions>
    </>
  );
}
