/**
 * Card search for the deckbuilder (docs/design/decks-and-formats.md "Deckbuilder"), through GET /api/cards/search; the filters are in searchQuery.ts.
 * The top row is Arena's: a search box with a clear button, round color toggles, a Filters button for everything else and an Advanced search button
 * (AdvancedSearch.tsx: Scryfall's search syntax, sent as the `scry` parameter and ANDed with the other filters). The search box takes Scryfall syntax
 * too: text with a Scryfall keyword (t:creature, s:dmu, mv<=2) goes out as `scry`, other text searches names and rules text (searchQuery.ts). The results are a grid of cards
 * (the shared card picture, nothing drawn over it); clicking a card adds it to the main deck, hovering or focusing it asks the deckbuilder for the big
 * preview. In a commander format the color identity filter starts at the commander's identity (CR 903.4). Previous / Next page through the search that
 * was submitted, not filters changed since; results stay on screen while the next page loads. With `autoSearch` (the app's default) the grid fills at
 * once and follows the filters as they change; without it, only the Search button searches.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { CardSummary, SearchResponse } from '@openmtg/server/api';
import { ApiRequestError } from '../api/http';
import { sfx } from '../audio/sfx';
import { AutomationBadge, CardPicture, ManaCost, modelFromSummary } from '../cards';
import { AdvancedSearch } from './AdvancedSearch';
import { Icon } from './chrome';
import { describeApiError, type DecksApi, type DeckSearchQuery } from './context';
import type { FormatOption } from './formats';
import type { DeckSection } from './model';
import { COLOR_FILTERS, EMPTY_FILTERS, effectiveIdentity, sameSearch, searchQuery, toggleLetter, type SearchFilters } from './searchQuery';

export { EMPTY_FILTERS, searchQuery, type SearchFilters } from './searchQuery';

const isCompanion = (c: CardSummary) => c.faces.some((f) => /^Companion\s+—/m.test(f.oracleText));

/** Wait this long after the last change of a filter before searching again (typing). */
const LIVE_DELAY_MS = 320;

export function SearchPanel({
  api,
  format,
  commanderIdentity = '',
  images = false,
  autoSearch = false,
  inDeck,
  onAdd,
  onPreview,
  onHover,
  onResults,
}: {
  api: DecksApi;
  format: FormatOption;
  /** The commander's color identity letters ('' without a commander). */
  commanderIdentity?: string;
  /** Ask for Scryfall image URLs (the player opted in). */
  images?: boolean;
  /** Search on open and whenever a filter changes. */
  autoSearch?: boolean;
  /** Copies of a card already in the deck (all sections). */
  inDeck: (name: string) => number;
  onAdd: (card: CardSummary, section: DeckSection) => void;
  /** Pin the big preview (the name under a card). */
  onPreview: (card: CardSummary) => void;
  /** The pointer or keyboard focus is on a card (`el`), or left it (null): the deckbuilder shows the floating preview beside it. */
  onHover?: (card: CardSummary | null, el: HTMLElement | null) => void;
  onResults?: (cards: CardSummary[]) => void;
}) {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [submitted, setSubmitted] = useState<DeckSearchQuery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The server did not understand the Scryfall query (HTTP 400): the player's input, not an outage. */
  const [syntaxError, setSyntaxError] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const inflight = useRef<AbortController | null>(null);
  /** The last search failed (its ui.error was heard). */
  const failed = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => () => inflight.current?.abort(), []);

  const identity = effectiveIdentity(filters, format, commanderIdentity);
  const current = searchQuery(filters, format, 1, { identity, images });
  const currentKey = JSON.stringify(current);

  const run = (query: DeckSearchQuery) => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setBusy(true);
    setError(null);
    setSyntaxError(false);
    api.search(query, ctrl.signal).then(
      (r) => {
        if (ctrl.signal.aborted) return;
        failed.current = false;
        setResult(r);
        setBusy(false);
        onResults?.(r.cards);
        scroller.current?.scrollTo?.({ top: 0 });
      },
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        setBusy(false);
        setError(describeApiError(e));
        // A query the server cannot read (a keyword it does not support, an unclosed quote) is input to correct: shown in words, without the error sound
        // that live search would repeat while the player is still typing.
        if (query.scry && e instanceof ApiRequestError && e.status === 400) {
          setSyntaxError(true);
          return;
        }
        // Once per outage: live search retries on every pause in typing.
        if (!failed.current) sfx('ui.error');
        failed.current = true;
      },
    );
  };

  // Live search: the grid is never empty when the screen opens, and a color toggle or a typed word shows its cards without pressing Search.
  useEffect(() => {
    if (!autoSearch) return;
    const wait = first.current ? 0 : LIVE_DELAY_MS;
    first.current = false;
    const timer = setTimeout(() => {
      setSubmitted(current);
      run(current);
    }, wait);
    return () => clearTimeout(timer);
    // `current` is captured through `currentKey`.
  }, [autoSearch, currentKey]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(current);
    run(current);
  };
  const toPage = (page: number) => submitted && run({ ...submitted, page });
  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const pages = result ? Math.max(1, Math.ceil(result.total / Math.max(1, result.pageSize))) : 0;
  const changed = !autoSearch && result !== null && submitted !== null && !sameSearch(current, submitted);
  // Filters behind the Filters button, counted so a closed drawer still says something is set.
  const active = [filters.identity !== null, !!filters.types.trim(), !!filters.keywords.trim(), !!filters.mv.trim(), !!filters.pow.trim(), !!filters.tou.trim(), !!filters.automation, !filters.legalOnly && !!format.legalityKey].filter(Boolean).length;

  return (
    <section className="deck-search" aria-label="Card search">
      <form
        onSubmit={submit}
        className="deck-search-form"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && (drawer || advanced)) {
            e.stopPropagation();
            setDrawer(false);
            setAdvanced(false);
          }
        }}
      >
        <div className="deck-search-bar">
          <div className="deck-searchbox">
            <Icon name="search" size={18} />
            <input
              type="search"
              aria-label="Name or rules text"
              placeholder="Search cards, or t:creature s:dmu mv<=3"
              title="A name or rules text, or Scryfall syntax: t:creature o:draw s:dmu mv<=3 (see Advanced search)"
              value={filters.q}
              onChange={(e) => set('q', e.target.value)}
              spellCheck={false}
            />
            {filters.q && (
              <button type="button" className="deck-clear" onClick={() => set('q', '')} aria-label="Clear search" title="Clear search">
                <Icon name="clear" size={14} />
              </button>
            )}
          </div>
          <fieldset className="color-filters">
            <legend className="sr-only">Colors</legend>
            {COLOR_FILTERS.map((c) => (
              <label key={c.letter} title={c.name} className="deck-toggle">
                <input type="checkbox" checked={filters.colors.includes(c.letter)} onChange={() => set('colors', toggleLetter(filters.colors, c.letter))} aria-label={c.name} />
                <span className={`deck-mana deck-mana-${c.letter}`}>{c.letter}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="deck-filter-toggle"
            onClick={() => {
              setDrawer((v) => !v);
              setAdvanced(false);
            }}
            aria-expanded={drawer}
            aria-controls="deck-filter-drawer"
          >
            <Icon name="filter" size={16} /> Filters{active > 0 && <span className="deck-filter-count">{active}</span>}
          </button>
          <button
            type="button"
            className="deck-filter-toggle deck-advanced-toggle"
            onClick={() => {
              setAdvanced((v) => !v);
              setDrawer(false);
            }}
            aria-expanded={advanced}
            aria-controls="deck-advanced-drawer"
          >
            Advanced search{filters.scry.trim() !== '' && <span className="deck-filter-count" title="An advanced search is set">on</span>}
          </button>
          <button type="submit" className="button-primary deck-search-go">
            Search
          </button>
        </div>
        <div className="deck-filter-drawer" id="deck-filter-drawer" hidden={!drawer}>
          <fieldset className="color-filters">
            <legend>Color identity</legend>
            {COLOR_FILTERS.map((c) => (
              <label key={c.letter} title={`Identity ${c.name}`} className="deck-toggle">
                <input type="checkbox" checked={identity.includes(c.letter)} onChange={() => set('identity', toggleLetter(identity, c.letter))} aria-label={`Identity ${c.name}`} />
                <span className={`deck-mana deck-mana-${c.letter}`}>{c.letter}</span>
              </label>
            ))}
          </fieldset>
          {format.commander && filters.identity === null && commanderIdentity && <p className="muted deck-hint">Showing cards within your commander&apos;s color identity.</p>}
          <div className="deck-search-row">
            <input aria-label="Types" placeholder="Types: creature, elf" value={filters.types} onChange={(e) => set('types', e.target.value)} />
            <input aria-label="Keywords" placeholder="Keywords: flying, lifelink" value={filters.keywords} onChange={(e) => set('keywords', e.target.value)} />
          </div>
          <div className="deck-search-row">
            <input aria-label="Mana value" placeholder="Mana value: 3, <=2" value={filters.mv} onChange={(e) => set('mv', e.target.value)} size={8} />
            <input aria-label="Power" placeholder="Power: >=3" value={filters.pow} onChange={(e) => set('pow', e.target.value)} size={6} />
            <input aria-label="Toughness" placeholder="Toughness" value={filters.tou} onChange={(e) => set('tou', e.target.value)} size={6} />
          </div>
          <div className="deck-search-row">
            {format.legalityKey && (
              <label>
                <input type="checkbox" checked={filters.legalOnly} onChange={(e) => set('legalOnly', e.target.checked)} /> Legal in {format.name}
              </label>
            )}
            <label>
              Automation{' '}
              <select aria-label="Automation" value={filters.automation} onChange={(e) => set('automation', e.target.value as SearchFilters['automation'])}>
                <option value="">Any</option>
                <option value="full">Full</option>
                <option value="partial">Partial</option>
                <option value="manual">Manual</option>
              </select>
            </label>
          </div>
        </div>
        <div className="deck-filter-drawer deck-advanced-drawer" id="deck-advanced-drawer" hidden={!advanced}>
          <AdvancedSearch value={filters.scry} onChange={(v) => set('scry', v)} error={syntaxError ? error : null} {...(api.sets ? { loadSets: api.sets } : {})} />
        </div>
      </form>

      <div className="deck-search-status">
        {busy && (
          <p role="status" className="deck-searching">
            Searching…
          </p>
        )}
        {error && (
          <p role="alert" className="deck-error">
            {syntaxError ? `This search can't run: ${error}` : `Search failed: ${error}`}
          </p>
        )}
        {result && <p className="muted">{result.total === 0 ? 'No cards found.' : `${result.total} card${result.total === 1 ? '' : 's'}${pages > 1 ? `, page ${result.page} of ${pages}` : ''}`}</p>}
        {changed && <p className="deck-hint">Filters changed: press Search to apply them.</p>}
        {busy && <span className="deck-progress" aria-hidden="true" />}
      </div>
      {result && (
        <div className="deck-pool-scroll" ref={scroller} aria-busy={busy}>
          <ul className="search-results" aria-label="Search results">
            {result.cards.map((c) => (
              <SearchResult key={c.oracleId || c.name} card={c} count={inDeck(c.name)} format={format} onAdd={onAdd} onPreview={onPreview} onHover={onHover} />
            ))}
          </ul>
          {pages > 1 && (
            <div className="pager">
              <button type="button" disabled={result.page <= 1} onClick={() => toPage(result.page - 1)}>
                Previous
              </button>
              <span className="muted">
                {result.page} / {pages}
              </span>
              <button type="button" disabled={result.page >= pages} onClick={() => toPage(result.page + 1)}>
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SearchResult({
  card,
  count,
  format,
  onAdd,
  onPreview,
  onHover,
}: {
  card: CardSummary;
  count: number;
  format: FormatOption;
  onAdd: (card: CardSummary, section: DeckSection) => void;
  onPreview: (card: CardSummary) => void;
  onHover: ((card: CardSummary | null, el: HTMLElement | null) => void) | undefined;
}) {
  const face = card.faces[0];
  const model = useMemo(() => modelFromSummary(card), [card]);
  return (
    <li className="deck-pick" aria-label={card.name} data-card={card.name}>
      <button
        type="button"
        className="deck-pick-art"
        onClick={() => onAdd(card, 'main')}
        onMouseEnter={(e) => onHover?.(card, e.currentTarget)}
        onMouseLeave={() => onHover?.(null, null)}
        onFocus={(e) => onHover?.(card, e.currentTarget)}
        onBlur={() => onHover?.(null, null)}
        aria-label={`Add ${card.name} to main deck`}
      >
        <span className="deck-pick-img">
          <CardPicture card={model} />
        </span>
      </button>
      <button type="button" className="button-link card-name deck-pick-name" onClick={() => onPreview(card)} title={`Show ${card.name} large`}>
        {card.name}
      </button>
      <span className="deck-pick-line">
        <ManaCost cost={face?.manaCost ?? null} />
        <AutomationBadge level={card.automation} />
      </span>
      <span className="deck-pick-actions">
        {count > 0 && <span className="in-deck">{count} in deck</span>}
        <button type="button" className="deck-mini" onClick={() => onAdd(card, 'sideboard')} aria-label={`Add ${card.name} to sideboard`}>
          + Side
        </button>
        {format.commander && (
          <button type="button" className="deck-mini" onClick={() => onAdd(card, 'commander')} aria-label={`Set ${card.name} as commander`}>
            Commander
          </button>
        )}
        {isCompanion(card) && (
          <button type="button" className="deck-mini" onClick={() => onAdd(card, 'companion')} aria-label={`Set ${card.name} as companion`}>
            Companion
          </button>
        )}
      </span>
    </li>
  );
}
