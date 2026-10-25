/**
 * Deckbuilder (docs/design/m8-client.md screen 3; docs/design/decks-and-formats.md "Deckbuilder"), laid out like Arena's: a card pool (search box, color
 * toggles, a grid of cards, a big preview beside the card you point at) on the left and the deck list (banners tinted by color, sideboard, format check)
 * on the right, with a Done button. A second view, Deck Details, shows the deck's statistics around a 3D deck box. Card search with filters and automation
 * badges, main deck / sideboard / commander / companion with counts, live format validation with the broken rule shown next to the card, stats, card preview.
 *
 * Every change is saved to the deck library at once, one save after another, each naming the stored version it replaces: when the deck was changed
 * somewhere else (another tab), nothing is overwritten and the player is offered the stored deck instead.
 *
 * Sounds: deck.add / deck.remove for each card that goes in or out (instead of the buttons' click), deck.legal / deck.illegal when the format check's
 * answer changes (useValidationSound), ui.error when the deck cannot be opened or saved.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CardDetailResponse, CardSummary } from '@openmtg/server/api';
import { useNav } from '../app/nav';
import { sfx } from '../audio/sfx';
import { deckSleeve } from '../branding/sleeves';
import { DeckBox, Modal, TitleBar } from './chrome';
import { CardPreview } from './CardPreview';
import { nowIso, useDecksEnv } from './context';
import { DeckDetails } from './DeckDetails';
import { DeckNameField } from './DeckNameField';
import { DeckSectionList, type SectionHandlers } from './DeckSectionList';
import { ExportPanel } from './ExportPanel';
import { afterRemoval, applyFocus, type FocusRequest } from './focus';
import { FormatSelect } from './FormatSelect';
import { DEFAULT_FORMAT, formatOption } from './formats';
import { deckColors, deckSize } from './look';
import { addCard, countOf, deckNames, emptyDeck, moveCard, sectionCount, SECTION_LABEL, SECTIONS, type Deck, type DeckSection } from './model';
import { SearchPanel } from './SearchPanel';
import { commanderIdentity } from './searchQuery';
import { deckStats } from './stats';
import { DeckConflictError } from './store';
import { useCardData } from './useCardData';
import { shownResult, useValidation, useValidationSound } from './useValidation';
import { problemsByCard, ValidationPanel } from './ValidationPanel';
import { requestedView, type BuilderView } from './view';
import './decks.css';

type Load = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready' };

export function DeckbuilderScreen({ deckId, now = nowIso, validateDelayMs, autoSearch = true }: { deckId?: string; now?: () => string; validateDelayMs?: number; autoSearch?: boolean }) {
  const { store } = useDecksEnv();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [deck, setDeck] = useState<Deck | null>(null);
  const latest = useRef<Deck | null>(null);
  /** `updatedAt` of the version in the store (null: not stored yet); each save names it so a change from another tab is never overwritten. */
  const stored = useRef<string | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const show = (d: Deck | null, inStore: string | null) => {
    latest.current = d;
    stored.current = inStore;
    setDeck(d);
  };

  useEffect(() => {
    let alive = true;
    if (deckId === undefined) {
      show(emptyDeck('New deck', DEFAULT_FORMAT, now()), null);
      setLoad({ status: 'ready' });
      return;
    }
    setLoad({ status: 'loading' });
    store.get(deckId).then(
      (d) => {
        if (!alive) return;
        show(d ?? null, d?.updatedAt ?? null);
        setLoad(d ? { status: 'ready' } : { status: 'missing' });
        if (!d) sfx('ui.error');
      },
      (e: unknown) => {
        if (!alive) return;
        setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) });
        sfx('ui.error');
      },
    );
    return () => {
      alive = false;
    };
    // `now` is a clock, not an input.
  }, [store, deckId]);

  /** Apply a change, show it, and save it (the first change of a new deck creates it in the library); false when it changed nothing. */
  const update = (change: (d: Deck) => Deck): boolean => {
    const cur = latest.current;
    if (!cur) return false;
    const changed = change(cur);
    if (changed === cur) return false;
    const next = { ...changed, updatedAt: now() };
    latest.current = next;
    setDeck(next);
    saving.current = saving.current.then(async () => {
      try {
        await store.put(next, stored.current);
        stored.current = next.updatedAt;
        setSaveError(null);
      } catch (e) {
        if (e instanceof DeckConflictError) setConflict(true);
        else setSaveError(e instanceof Error ? e.message : String(e));
        sfx('ui.error');
      }
    });
    return true;
  };

  /** Show the deck as it is stored now (after a change in another tab). */
  const reload = () => {
    const id = latest.current?.id;
    if (!id) return;
    saving.current = saving.current.then(() =>
      store.get(id).then(
        (d) => {
          if (!d) {
            sfx('ui.error');
            return setSaveError('This deck was deleted in another tab. Export it to keep a copy.');
          }
          show(d, d.updatedAt);
          setConflict(false);
          setSaveError(null);
        },
        (e: unknown) => {
          sfx('ui.error');
          setSaveError(e instanceof Error ? e.message : String(e));
        },
      ),
    );
  };

  if (load.status !== 'ready' || !deck) {
    const text =
      load.status === 'loading'
        ? `Deck: ${deckId} (loading…)`
        : load.status === 'missing'
          ? `Deck: ${deckId} was not found in your deck library.`
          : `Deck: ${deckId} could not be opened: ${load.status === 'error' ? load.message : ''}`;
    return (
      <div className="screen deckbuilder-screen">
        <TitleBar title="Deckbuilder" />
        <p role={load.status === 'loading' ? 'status' : 'alert'}>{text}</p>
      </div>
    );
  }
  return (
    <Builder
      deck={deck}
      update={update}
      problem={
        conflict ? (
          <p role="alert" className="deck-error">
            This deck was changed in another tab, so your latest changes were not saved.{' '}
            <button type="button" onClick={reload}>
              Reload the deck
            </button>
          </p>
        ) : saveError ? (
          <p role="alert" className="deck-error">
            Could not save the deck: {saveError}
          </p>
        ) : null
      }
      validateDelayMs={validateDelayMs}
      autoSearch={autoSearch}
      whenSaved={() => saving.current}
    />
  );
}

/** Where the floating preview goes: beside the card you point at, on the side with more room, kept inside the window. */
export function previewPlacement(rect: { left: number; right: number; top: number }, viewport: { width: number; height: number }, size = { width: 600, height: 440 }) {
  const gap = 14;
  const room = 8;
  const rightFits = rect.right + gap + size.width <= viewport.width - room;
  const leftFits = rect.left - gap - size.width >= room;
  const left = rightFits || !leftFits ? Math.min(rect.right + gap, Math.max(room, viewport.width - size.width - room)) : rect.left - gap - size.width;
  const top = Math.min(Math.max(room, rect.top - 24), Math.max(room, viewport.height - size.height - room));
  return { left: Math.max(room, left), top };
}

function Builder({
  deck,
  update,
  problem,
  validateDelayMs,
  autoSearch,
  whenSaved,
}: {
  deck: Deck;
  update: (change: (d: Deck) => Deck) => boolean;
  problem: ReactNode;
  validateDelayMs: number | undefined;
  autoSearch: boolean;
  /** Settles once every change made so far is saved (or failed to save). */
  whenSaved: () => Promise<void>;
}) {
  const nav = useNav();
  const { api, showScryfallImages, cardView } = useDecksEnv();
  const format = formatOption(deck.format);
  // The cover card is looked up too, so it shows when it is not in the deck (it was picked from a search) and after a reload.
  const names = useMemo(() => (deck.cover && !deckNames(deck).includes(deck.cover) ? [...deckNames(deck), deck.cover] : deckNames(deck)), [deck]);
  const data = useCardData(api, names, showScryfallImages);
  const validation = useValidation(api, deck, validateDelayMs);
  useValidationSound(validation);
  const shown = shownResult(validation);
  const problems = useMemo(() => problemsByCard(shown?.problems ?? []), [shown]);
  const stats = useMemo(() => deckStats(deck, data.cards), [deck, data.cards]);
  const cover = deck.cover ? (data.cards.get(deck.cover) ?? null) : null;
  // The deck's sleeve is the one of its colors; it follows the cards as they are added (branding/sleeves.ts).
  const sleeve = useMemo(() => deckSleeve(deckColors(deck, data.cards)), [deck, data.cards]);
  const identity = commanderIdentity(deck.commander.map((e) => data.cards.get(e.name)?.colorIdentity).filter((c): c is NonNullable<typeof c> => c !== undefined));
  const [view, setView] = useState<BuilderView>(() => requestedView(deck.id));
  /** The card pinned large (a name was clicked) and the card under the pointer (floating preview). */
  const [pinned, setPinned] = useState<string | null>(null);
  const [previewAsked, setPreviewAsked] = useState(0);
  const [hover, setHover] = useState<{ card: CardSummary; rect: { left: number; right: number; top: number } } | null>(null);
  const [fetched, setFetched] = useState<ReadonlyMap<string, CardDetailResponse>>(new Map());
  const [exporting, setExporting] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const listsRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);

  const pinnedCard = pinned ? data.cards.get(pinned) : undefined;
  const shownName = pinnedCard?.name ?? hover?.card.name ?? null;
  // Details (the parts resolved by hand) of the card shown, when the deck's own lookups do not have them: after a short pause for the floating preview.
  useEffect(() => {
    if (!shownName || data.details.has(shownName) || fetched.has(shownName)) return;
    let alive = true;
    const timer = setTimeout(
      () =>
        api.card(shownName, showScryfallImages ? { images: true } : {}).then(
          (d) => alive && setFetched((m) => new Map(m).set(shownName, d)),
          () => undefined,
        ),
      pinned ? 0 : 250,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api, shownName, pinned, data.details, fetched, showScryfallImages]);

  // The pinned preview takes keyboard focus when it opens.
  useEffect(() => {
    if (previewAsked && previewRef.current) previewRef.current.focus({ preventScroll: true });
  }, [previewAsked, pinnedCard !== undefined]);

  useEffect(() => {
    if (focusRequest && applyFocus(listsRef.current, focusRequest)) setFocusRequest(null);
  }, [focusRequest, deck]);

  const openPreview = (name: string) => {
    setPinned(name);
    setPreviewAsked((n) => n + 1);
  };

  const addFromSearch = (card: CardSummary, section: DeckSection) => {
    const ref = { name: card.name, oracleId: card.oracleId };
    const added = update((d) => {
      // CR 903.3: the deck designates its commander; adding the same card again changes nothing.
      if (section === 'commander') return countOf(d, 'commander', card.name) ? d : addCard(d, 'commander', ref, 1);
      // One companion per deck (CR 702.139a): a new one replaces the old.
      if (section === 'companion') return countOf(d, 'companion', card.name) ? d : addCard({ ...d, companion: [] }, 'companion', ref, 1);
      return addCard(d, section, ref, 1);
    });
    // A commander or companion already chosen changes nothing: the press is only a click.
    if (added) sfx('deck.add');
  };

  const sectionName = (s: DeckSection) => (s === 'main' ? 'the main deck' : `the ${SECTION_LABEL[s].toLowerCase()}`);
  const handlers: SectionHandlers = {
    onChange: (section, name, delta) => {
      if (delta < 0 && countOf(deck, section, name) + delta <= 0) {
        setFocusRequest(afterRemoval(section, deck[section], name, 'remove'));
        setAnnouncement(`Removed ${name} from ${sectionName(section)}.`);
      }
      if (update((d) => addCard(d, section, { name }, delta))) sfx(delta > 0 ? 'deck.add' : 'deck.remove');
    },
    onMove: (from, to, name) => {
      setFocusRequest({ section: to, card: name, control: 'move' });
      setAnnouncement(`Moved ${name} to ${sectionName(to)}.`);
      update((d) => moveCard(d, from, to, name));
    },
    onPreview: openPreview,
  };

  const inDeck = (name: string) => SECTIONS.reduce((n, s) => n + countOf(deck, s, name), 0);
  const sections = SECTIONS.filter((s) => s === 'main' || s === 'sideboard' || deck[s].length > 0 || (s === 'commander' && format.commander));
  const cardsInDeck = sectionCount(deck, 'main') + sectionCount(deck, 'commander');
  // M11-2 (m11 design 5.5): a commander deck counts as "the 99 + its commander(s)" (CR 903.5a), and two commanders that cannot partner get a hint (the
  // validator's invalid-partners problem, CR 702.124f).
  const commanders = sectionCount(deck, 'commander');
  const partnerProblem = format.commander && commanders === 2 ? shown?.problems.find((p) => p.kind === 'commander' && p.rules.includes('CR 702.124f')) : undefined;
  const [opening, setOpening] = useState(false);
  const playDeck = () => {
    if (opening) return;
    setOpening(true);
    // The New game screen reads the deck library: the latest change must be stored first.
    void whenSaved().then(() => nav.go({ screen: 'newGame', deckId: deck.id }));
  };
  const check = (expanded: boolean) => <ValidationPanel state={validation} formatName={format.name} expanded={expanded} />;
  const onRename = (name: string) => update((d) => ({ ...d, name }));
  const onFormat = (f: string) => update((d) => ({ ...d, format: f }));

  const floating = hover && !pinnedCard && typeof window !== 'undefined' ? previewPlacement(hover.rect, { width: window.innerWidth, height: window.innerHeight }) : null;

  return (
    <div className={`screen deckbuilder-screen deck-view-${view}`}>
      <TitleBar title={view === 'details' ? 'Deck Details' : 'Deckbuilder'}>
        <span className="deck-header-actions">
          <span className="deck-segment" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'build'} onClick={() => setView('build')}>
              Build
            </button>
            <button type="button" aria-pressed={view === 'details'} onClick={() => setView('details')}>
              Details
            </button>
          </span>
          {view === 'build' && (
            <button type="button" onClick={() => setExporting((v) => !v)} aria-expanded={exporting}>
              Export
            </button>
          )}
        </span>
      </TitleBar>
      {problem}
      <p className="sr-only" role="status" aria-live="polite" data-testid="deck-announcer">
        {announcement}
      </p>
      {view === 'details' ? (
        <DeckDetails
          deck={deck}
          cover={cover}
          stats={stats}
          onRename={onRename}
          onFormat={onFormat}
          onEdit={() => setView('build')}
          onExport={() => setExporting(true)}
          sleeve={sleeve}
          validation={check(true)}
        />
      ) : (
        <div className="deck-build">
          <div className="deck-pool">
            <SearchPanel
              api={api}
              format={format}
              commanderIdentity={identity}
              images={showScryfallImages}
              autoSearch={autoSearch}
              inDeck={inDeck}
              onAdd={addFromSearch}
              onPreview={(c) => openPreview(c.name)}
              onHover={(card, el) => setHover(card && el ? { card, rect: el.getBoundingClientRect() } : null)}
              onResults={data.remember}
            />
          </div>
          <aside className="deck-list-panel hud-panel" aria-label="Deck list">
            <header className="deck-list-head">
              <div className="deck-list-thumb">
                <DeckBox size="sm" cover={cover} sleeve={sleeve} />
              </div>
              <div className="deck-list-id">
                <DeckNameField name={deck.name} onRename={onRename} />
                <div className="deck-list-sub">
                  {format.commander ? (
                    <p
                      className="deck-count"
                      aria-label="Deck size"
                      title={`${sectionCount(deck, 'main')} cards and ${commanders} commander${commanders === 1 ? '' : 's'} (CR 903.5a)`}
                    >
                      <strong>
                        {sectionCount(deck, 'main')} + {commanders}/{deckSize(deck.format)}
                      </strong>{' '}
                      Cards
                    </p>
                  ) : (
                    <p className="deck-count" aria-label="Deck size">
                      <strong>
                        {cardsInDeck}/{deckSize(deck.format)}
                      </strong>{' '}
                      Cards
                    </p>
                  )}
                  <FormatSelect value={deck.format} onChange={onFormat} />
                </div>
              </div>
            </header>
            {check(false)}
            {partnerProblem && (
              <p className="deck-partner-hint" role="note">
                {partnerProblem.message} Two commanders must share a partner ability: both have Partner, both have the same &quot;Partner&mdash;&quot; ability, or
                each is the other&apos;s &quot;Partner with&quot; (CR 702.124f, 702.124h-j).
              </p>
            )}
            <div className="deck-lists" ref={listsRef}>
              {sections.map((s) => (
                <DeckSectionList key={s} section={s} entries={deck[s]} cards={data.cards} missing={data.missing} problems={problems} handlers={handlers} />
              ))}
              <details className="deck-notes">
                <summary>Notes</summary>
                <textarea rows={3} value={deck.notes} onChange={(e) => update((d) => ({ ...d, notes: e.target.value }))} aria-label="Deck notes" />
              </details>
            </div>
            <footer className="deck-list-foot">
              {format.commander && (
                <button type="button" className="deck-play" disabled={opening} onClick={playDeck} title="Open New game with this deck for player 1">
                  Play this deck
                </button>
              )}
              <button type="button" className="button-primary deck-done" onClick={nav.back}>
                Done
              </button>
            </footer>
          </aside>
        </div>
      )}
      {exporting && (
        <Modal label={`Export ${deck.name}`} wide onClose={() => setExporting(false)}>
          <ExportPanel deck={deck} onClose={() => setExporting(false)} />
        </Modal>
      )}
      {pinnedCard && (
        <Modal label={`${pinnedCard.name}, large`} wide onClose={() => setPinned(null)}>
          <CardPreview
            card={pinnedCard}
            detail={data.details.get(pinnedCard.name) ?? fetched.get(pinnedCard.name)}
            isCover={deck.cover === pinnedCard.name}
            onUseAsCover={() => update((d) => ({ ...d, cover: pinnedCard.name }))}
            onClose={() => setPinned(null)}
            {...(cardView ? { cardView } : {})}
            sectionRef={previewRef}
          />
        </Modal>
      )}
      {hover && floating && !pinnedCard && (
        <div className="deck-hover-preview" style={{ left: floating.left, top: floating.top }} aria-hidden="true">
          <CardPreview card={hover.card} detail={data.details.get(hover.card.name) ?? fetched.get(hover.card.name)} floating {...(cardView ? { cardView } : {})} />
        </div>
      )}
    </div>
  );
}
