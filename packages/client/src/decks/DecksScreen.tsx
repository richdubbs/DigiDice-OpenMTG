/**
 * Deck library (docs/design/m8-client.md screen 2; docs/design/decks-and-formats.md "Deck library"): every saved deck as a deck box in a grid, with its
 * format, size, colors and whether it passes the format check; new, import, open (Deck Details), edit, rename, duplicate, export and delete. Decks are
 * stored only in this browser (store.ts). Sounds: an import that completes ui.success, a delete ui.delete, a copy made ui.notify, a failure ui.error (a
 * rename is heard as its Save button's confirm).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNav } from '../app/nav';
import type { SoundId } from '../audio/catalog';
import { sfx } from '../audio/sfx';
import { ColorPips, DeckBox, Icon, Modal, TitleBar } from './chrome';
import { localDate, nowIso, useDecksEnv } from './context';
import { ExportPanel } from './ExportPanel';
import { DEFAULT_FORMAT, formatOption } from './formats';
import { ImportPanel } from './ImportPanel';
import { duplicateDeck, emptyDeck, sectionCount, type Deck } from './model';
import { ignoredText } from './textio';
import { useDeckInfo, type DeckInfo, type Validity } from './useDeckInfo';
import { requestView } from './view';
import './decks.css';

type RowAction = 'rename' | 'export' | 'delete';

export function DecksScreen({ now = nowIso }: { now?: () => string }) {
  const nav = useNav();
  const { store, api } = useDecksEnv();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState<{ id: string; action: RowAction } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // One library action at a time: a double click must not create, copy or import a deck twice.
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [focusDeck, setFocusDeck] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const newDeckRef = useRef<HTMLButtonElement>(null);
  const info = useDeckInfo(api, decks);

  const reload = useCallback(
    () =>
      store.list().then(setDecks, (e: unknown) => {
        setDecks([]);
        setError(`Could not open the deck library: ${e instanceof Error ? e.message : String(e)}`);
        sfx('ui.error');
      }),
    [store],
  );
  useEffect(() => void reload(), [reload]);

  /** Run one library action (ignored while another runs); true when it succeeded. `sound`: what its success sounds like. */
  const act = async (work: () => Promise<unknown>, done: string, sound: SoundId | null = null): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError(null);
    let ok = false;
    try {
      await work();
      setOpen(null);
      setMessage(done);
      if (sound) sfx(sound);
      ok = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      sfx('ui.error');
    }
    await reload();
    busy.current = false;
    setPending(false);
    return ok;
  };

  const createDeck = () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const deck = emptyDeck(nextName(decks ?? []), DEFAULT_FORMAT, now());
    store.put(deck, null).then(
      () => {
        requestView(deck.id, 'build');
        nav.go({ screen: 'deckbuilder', deckId: deck.id });
      },
      (e: unknown) => {
        busy.current = false;
        setPending(false);
        setError(e instanceof Error ? e.message : String(e));
        sfx('ui.error');
      },
    );
  };

  const openDeck = (d: Deck, view: 'build' | 'details') => {
    requestView(d.id, view);
    nav.go({ screen: 'deckbuilder', deckId: d.id });
  };

  const deleteDeck = async (d: Deck) => {
    // Focus goes to the next deck in the list (else the previous one, else New deck), not back to the top of the page.
    const list = decks ?? [];
    const i = list.findIndex((x) => x.id === d.id);
    const neighbour = list[i + 1] ?? list[i - 1];
    if (await act(() => store.delete(d.id), `Deleted “${displayName(d)}”.`, 'ui.delete')) setFocusDeck(neighbour?.id ?? '');
  };

  useEffect(() => {
    if (focusDeck === null || decks === null) return;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-deck-id]') ?? [])].find((r) => r.dataset.deckId === focusDeck);
    (row?.querySelector<HTMLElement>('.deck-tile-open') ?? newDeckRef.current)?.focus();
    setFocusDeck(null);
  }, [focusDeck, decks]);

  return (
    <div className="screen decks-screen">
      <TitleBar title="Decks">
        {decks !== null && decks.length > 0 && <span className="deck-total">{decks.length === 1 ? '1 deck' : `${decks.length} decks`}</span>}
        <span className="deck-header-actions">
          <button type="button" className="button-primary" onClick={createDeck} disabled={pending} ref={newDeckRef}>
            New deck
          </button>
          <button type="button" onClick={() => setImporting((v) => !v)} aria-expanded={importing}>
            Import
          </button>
        </span>
      </TitleBar>
      {!store.persistent && (
        <p className="deck-notice" role="note">
          {store.storageNote ?? 'This browser cannot store decks, so they last only until the page is closed. Export a deck to keep it.'}
        </p>
      )}
      {error && (
        <p role="alert" className="deck-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="deck-message">
          {message}
        </p>
      )}
      {importing && (
        <Modal label="Import decks" wide onClose={() => setImporting(false)}>
          <ImportPanel
            api={api}
            now={now}
            onClose={() => setImporting(false)}
            onImported={(deck, ignored) =>
              act(
                async () => {
                  await store.put(deck, null);
                  setImporting(false);
                },
                `Imported “${deck.name}” (${sectionCount(deck, 'main')} main-deck cards).${ignored > 0 ? ` ${ignoredText(ignored, 'were')}` : ''}`,
                'ui.success',
              )
            }
          />
        </Modal>
      )}
      {decks === null ? (
        <p role="status">Loading decks…</p>
      ) : decks.length === 0 ? (
        <div className="deck-empty hud-panel">
          <DeckBox size="lg" />
          <p className="muted">No decks yet. Start a new deck or import a decklist.</p>
        </div>
      ) : (
        <ul className="deck-library" aria-label="Your decks" ref={listRef}>
          {decks.map((d) => (
            <DeckTile
              key={d.id}
              deck={d}
              info={info.get(d.id)}
              action={open?.id === d.id ? open.action : null}
              setAction={(action) => setOpen(action ? { id: d.id, action } : null)}
              onOpen={() => openDeck(d, 'details')}
              onEdit={() => openDeck(d, 'build')}
              pending={pending}
              onRename={(name) => act(() => store.put({ ...d, name, updatedAt: now() }), `Renamed to “${name}”.`)}
              onDuplicate={() => act(() => store.put(duplicateDeck(d, now()), null), `Made a copy of “${displayName(d)}”.`, 'ui.notify')}
              onDelete={() => deleteDeck(d)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The deck's name, or a stand-in for a deck saved without one (older versions allowed it). */
const displayName = (d: Deck) => d.name.trim() || '(unnamed deck)';

function nextName(decks: Deck[]): string {
  const names = new Set(decks.map((d) => d.name));
  for (let i = 1; ; i++) {
    const n = i === 1 ? 'New deck' : `New deck ${i}`;
    if (!names.has(n)) return n;
  }
}

/** The format check's answer as a small chip. */
function validityChip(v: Validity | undefined): { tone: string; icon: 'check' | 'cross' | null; text: string } | null {
  switch (v?.kind) {
    case 'legal':
      return { tone: 'ok', icon: 'check', text: 'Legal' };
    case 'illegal':
      return { tone: 'bad', icon: 'cross', text: `${v.problems} problem${v.problems === 1 ? '' : 's'}` };
    case 'unchecked':
      return { tone: 'warn', icon: null, text: 'Not fully checked' };
    case 'empty':
      return { tone: 'idle', icon: null, text: 'Empty' };
    case 'checking':
      return { tone: 'idle', icon: null, text: 'Checking…' };
    default:
      return null;
  }
}

function DeckTile({
  deck,
  info,
  action,
  setAction,
  pending,
  onOpen,
  onEdit,
  onRename,
  onDuplicate,
  onDelete,
}: {
  deck: Deck;
  info: DeckInfo | undefined;
  action: RowAction | null;
  pending: boolean;
  setAction: (a: RowAction | null) => void;
  onOpen: () => void;
  onEdit: () => void;
  onRename: (name: string) => Promise<unknown>;
  onDuplicate: () => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [name, setName] = useState(deck.name);
  const main = sectionCount(deck, 'main');
  const side = sectionCount(deck, 'sideboard');
  const commander = deck.commander.map((e) => e.name).join(' & ');
  const toggle = (a: RowAction) => setAction(action === a ? null : a);
  const label = displayName(deck);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const chip = validityChip(info?.validity);
  // The confirmation takes focus, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (action === 'delete') cancelRef.current?.focus();
  }, [action]);
  return (
    <li className="deck-row" aria-label={label} data-deck-id={deck.id}>
      <div className="deck-tile deck-box-host hud-panel">
        <button type="button" className="deck-tile-open" onClick={onOpen} aria-label={label} aria-describedby={`deck-meta-${deck.id}`} title={`Open ${label}`}>
          <DeckBox size="md" cover={info?.cover ?? null} sleeve={deck.sleeve} />
          <span className="deck-tile-name">{label}</span>
          <span className="deck-tile-colors">
            <ColorPips colors={info?.colors ?? []} />
            {info?.colors && info.colors.length === 0 && main > 0 && <span className="deck-pips-empty">Colorless</span>}
          </span>
          <span id={`deck-meta-${deck.id}`} className="deck-tile-meta">
            <span>
              {formatOption(deck.format).name} · {main} main{side ? ` · ${side} sideboard` : ''}
              {commander ? ` · Commander: ${commander}` : ''}
              {deck.cover ? ` · Cover: ${deck.cover}` : ''}
            </span>
            <span className="deck-tile-date">Updated {localDate(deck.updatedAt)}</span>
          </span>
        </button>
        <span className="deck-tile-state">
          {chip ? (
            <span className={`deck-chip deck-chip-${chip.tone}`}>
              {chip.icon && <Icon name={chip.icon} size={14} />}
              <span className="sr-only">Format check: </span>
              {chip.text}
            </span>
          ) : (
            <span className="deck-chip-spacer" aria-hidden="true" />
          )}
        </span>
        <span className="deck-tile-actions">
          <button type="button" className="button-primary deck-tile-edit" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="deck-icon-button" onClick={() => toggle('rename')} aria-label="Rename" title="Rename">
            <Icon name="edit" />
          </button>
          <button type="button" className="deck-icon-button" onClick={() => void onDuplicate()} disabled={pending} aria-label="Duplicate" title="Duplicate">
            <Icon name="copy" />
          </button>
          <button type="button" className="deck-icon-button" onClick={() => toggle('export')} aria-label="Export" title="Export">
            <Icon name="export" />
          </button>
          <button type="button" className="deck-icon-button deck-icon-danger" onClick={() => toggle('delete')} aria-label="Delete" title="Delete">
            <Icon name="trash" />
          </button>
        </span>
      </div>
      {action === 'rename' && (
        <Modal label={`Rename ${label}`} onClose={() => setAction(null)}>
          <form
            className="deck-panel-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void onRename(name.trim());
            }}
          >
            <h2>Rename “{label}”</h2>
            <div className="panel-row">
              <input aria-label="New name" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-describedby={name.trim() ? undefined : `rename-hint-${deck.id}`} />
              <button type="submit" className="button-primary" disabled={!name.trim() || pending}>
                Save name
              </button>
              <button type="button" className="button-link" onClick={() => setAction(null)}>
                Cancel
              </button>
            </div>
            {!name.trim() && (
              <span id={`rename-hint-${deck.id}`} className="deck-hint">
                Type a name to save it.
              </span>
            )}
          </form>
        </Modal>
      )}
      {action === 'delete' && (
        <Modal label={`Delete ${label}`} role="alertdialog" onClose={() => setAction(null)}>
          <div className="deck-panel-form">
            <h2>Delete this deck?</h2>
            <p id={`delete-text-${deck.id}`}>Delete “{label}”? This cannot be undone; export it first to keep a copy (the Plain text export also keeps the notes).</p>
            <div className="panel-row">
              {/* Silent when pressed: ui.delete once the deck is gone (or ui.error). */}
              <button type="button" className="button-danger" data-sfx="none" onClick={() => void onDelete()} disabled={pending}>
                Delete deck
              </button>
              <button type="button" className="button-link" onClick={() => setAction(null)} ref={cancelRef}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
      {action === 'export' && (
        <Modal label={`Export ${label}`} wide onClose={() => setAction(null)}>
          <ExportPanel deck={deck} onClose={() => setAction(null)} />
        </Modal>
      )}
    </li>
  );
}
