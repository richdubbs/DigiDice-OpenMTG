/**
 * Graveyard, exile and command zone viewers (CR 404, 406, 408): a button with the card count that opens a list of the cards, top first. These zones are public
 * (CR 400.2), except face-down exiled cards, which only their controller may look at (CR 406.3, 708): `CardSlot` draws whatever the view hides as a back.
 * RPL-2: in a replay's open view, where nothing is hidden, every library is one too, its cards in order (board/PlayerPanel.tsx, replays design 6).
 *
 * The button also says when the zone holds cards the player can use now (flashback, escape, unearth, foretell ...: CR 117.1, 702.34) or pick in the current
 * decision (targets in a graveyard, CR 115.1), so they are found without opening it. The viewer is a modal dialog: one at a time (the open one is board
 * state), focus stays inside, Escape or the backdrop closes it, and focus returns to its button. Opening and closing it are heard (ui.open, ui.close).
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ObjectId } from '@openmtg/engine';
import { gameSfx } from '../game/sound';
import { useBoard } from './context';
import { CardSlot } from './CardSlot';
import { cardCount, charsOf, defOf, isHidden, isKnownFaceDown, shownFace } from './model';

export interface ZoneViewerProps {
  /** "Graveyard", "Exile", "Command", or "Library" (a replay's open view only). */
  title: string;
  ownerName: string;
  /** Cards top first. */
  ids: readonly ObjectId[];
  rule: string;
  /** Unique on the board (the open viewer is remembered by it). */
  zoneKey: string;
  /** ui/arena: draw the button as a pile of cards with the top card (the fx layer flies cards into it). */
  pile?: 'graveyard' | 'exile' | 'command' | 'library';
  playerId?: string;
}

/** Short pile labels (the full name is in the button's accessible name and tooltip). */
const SHORT: Record<string, string> = { Graveyard: 'Grave', Exile: 'Exile', Command: 'Cmd', Library: 'Lib' };

/**
 * The top card of a public pile as a small picture inside the pile button (only a picture: the button is the control). FAST5X E14: also the top card of the
 * viewer's library while they may look at it (CR 401.5, board/PlayerPanel.tsx#Piles); a card the view hides is drawn as a back.
 */
export function PileTop({ id }: { id: ObjectId | undefined }) {
  const { view, renderCard } = useBoard();
  const o = id ? view.objects[id] : undefined;
  if (!o)
    return (
      <span className="pile-art is-empty" aria-hidden="true">
        <span className="pile-empty" />
      </span>
    );
  const hidden = isHidden(o) || isKnownFaceDown(o);
  const def = hidden ? null : defOf(view, o);
  return (
    <span className="pile-art" aria-hidden="true">
      {renderCard({ def, face: def ? shownFace(def, o) : 0, chars: hidden ? null : charsOf(view, o), size: 'small', faceDown: o.faceDown === true })}
    </span>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ZoneViewer({ title, ownerName, ids, rule, zoneKey, pile, playerId }: ZoneViewerProps) {
  const board = useBoard();
  const open = board.openZone === zoneKey;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** Set while closing: returning focus to the button must not be pulled back into the dialog. */
  const closing = useRef(false);
  const label = `${ownerName}'s ${title.toLowerCase()}`;

  const playable = ids.filter((id) => board.playable.has(id) || board.manaOnly.has(id)).length;
  const choosable = ids.filter((id) => board.selectable.has(id) || board.selected.has(id)).length;
  const flags = [playable > 0 ? `${playable} playable` : null, choosable > 0 ? `${choosable} to choose` : null].filter((x): x is string => x !== null);

  const { setOpenZone } = board;
  useEffect(() => {
    if (!open) return;
    closing.current = false;
    closeRef.current?.focus();
    const button = buttonRef.current;
    const close = () => {
      closing.current = true;
      gameSfx('ui.close');
      setOpenZone(null);
      button?.focus();
    };
    // Capture phase: Escape closes the viewer from anywhere, and does not also reach the game screen's own Escape (cancel).
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    // Focus that leaves the dialog (a click or a script behind the backdrop) comes back to it.
    const onFocusIn = (e: FocusEvent) => {
      const d = dialogRef.current;
      if (!closing.current && d && e.target instanceof Node && !d.contains(e.target)) closeRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open, setOpenZone]);

  const close = () => {
    closing.current = true;
    gameSfx('ui.close');
    setOpenZone(null);
    buttonRef.current?.focus();
  };

  // Tab and Shift+Tab cycle inside the dialog.
  const trapTab = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`zone-button${pile ? ` pile pile-${pile}` : ''}${playable > 0 ? ' has-playable' : ''}${choosable > 0 ? ' has-selectable' : ''}`}
        onClick={() => {
          if (!open) gameSfx('ui.open');
          setOpenZone(zoneKey);
        }}
        aria-label={[`${label}: ${cardCount(ids.length)}`, ...flags].join(', ')}
        aria-haspopup="dialog"
        title={`${title} (${rule})`}
        {...(pile ? { 'data-fx': 'pile', 'data-pile': pile, 'data-player-id': playerId } : {})}
      >
        {pile && <PileTop id={ids[0]} />}
        <span className="zone-title">{SHORT[title] ?? title}</span> <span className="count">{ids.length}</span>
        {flags.map((f) => (
          <span key={f} className="zone-flag">
            {f}
          </span>
        ))}
      </button>
      {open && (
        <>
          <div className="zone-backdrop" onClick={close} />
          <div ref={dialogRef} className="zone-viewer" role="dialog" aria-modal="true" aria-label={label} onKeyDown={trapTab}>
            <div className="zone-viewer-header">
              <h2>
                {label} ({cardCount(ids.length)})
              </h2>
              <span className="rule-chip">{rule}</span>
              <button ref={closeRef} type="button" className="zone-close" onClick={close}>
                Close
              </button>
            </div>
            {ids.length === 0 ? (
              <p className="muted">No cards.</p>
            ) : (
              <div className="zone-viewer-cards">
                {ids.map((id) => (
                  // A Scryfall picture's artist under each card: the viewer shows them at a readable size
                  <CardSlot key={id} id={id} size="normal" credit />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
