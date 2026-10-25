/**
 * Shared pieces of the deck screens' look: the title bar (back chevron + big title), a modal panel, the 3D deck box (the DigiDice card back as box art),
 * color pips, and the small line icons of the tactile buttons. All procedural CSS and SVG; nothing here is card art.
 */
import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Color } from '@openmtg/engine';
import type { CardSummary } from '@openmtg/server/api';
import { useNav } from '../app/nav';
import { sfx } from '../audio/sfx';
import { CardPicture, modelFromSummary } from '../cards';
import { useSleevePictures } from '../profiles/useSleevePictures';
import { COLOR_NAME } from './stats';

/** Back chevron and a large neon title, with the screen's actions on the right. The back button keeps the name "Back" (it goes to the previous screen). */
export function TitleBar({ title, children }: { title: string; children?: ReactNode }) {
  const nav = useNav();
  return (
    <header className="deck-titlebar">
      <button type="button" className="deck-back" onClick={nav.back} aria-label="Back">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <h1 className="neon-title deck-title">{title}</h1>
      {children}
    </header>
  );
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A panel over a dimmed backdrop (Escape or a click outside closes it; Tab stays inside). It is drawn where it is written, not in a portal, so the
 * screen that opens it can still find it inside its own row. `role` is "alertdialog" for a confirmation. It plays ui.open when it appears and
 * ui.close when Escape or the backdrop dismisses it (its own Cancel and Close buttons sound as buttons do, audio/uiSounds.ts); not on unmount, which
 * also happens when a delete or a save completes, or the screen changes, each with its own sound.
 */
export function Modal({ label, onClose, role = 'dialog', wide = false, children }: { label: string; onClose: () => void; role?: 'dialog' | 'alertdialog'; wide?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  // Once per panel: StrictMode runs the mount effect twice, the ref survives.
  const opened = useRef(false);
  const dismiss = () => {
    sfx('ui.close');
    onClose();
  };
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      sfx('ui.open');
    }
    const el = box.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    const from = opener.current;
    return () => {
      if (from instanceof HTMLElement && from.isConnected) from.focus({ preventScroll: true });
    };
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dismiss();
    } else if (e.key === 'Tab' && box.current) {
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div className="deck-modal-layer" onKeyDown={onKey}>
      <div className="deck-modal-backdrop" onClick={dismiss} aria-hidden="true" />
      <div ref={box} className={`deck-modal hud-panel${wide ? ' deck-modal-wide' : ''}`} role={role} aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

/**
 * The deck box: a block of cards seen at an angle, its face the deck's sleeve (the DigiDice card back or a mana-color one, or Reality Fracture's cracked mirror
 * in that look) or its cover card, with neon edges. Pure decoration (hidden
 * from screen readers); the box turns toward you when its tile is hovered or focused (the tile sets the pose through `.deck-box-host`).
 * The cover is drawn by the shared card picture: the player's upload, the Scryfall image if that setting is on, otherwise our text frame (never bundled art).
 */
export function DeckBox({ size = 'md', cover, sleeve }: { size?: 'xs' | 'sm' | 'md' | 'lg'; cover?: CardSummary | null; sleeve?: string | undefined }) {
  const model = useMemo(() => (cover ? modelFromSummary(cover) : null), [cover]);
  const pictures = useSleevePictures(sleeve);
  return (
    <div className={`deck-box deck-box-${size}`} aria-hidden="true">
      <div className="deck-box-body">
        {model ? (
          <div className="deck-box-face deck-box-cover" data-cover={model.name}>
            <CardPicture card={model} />
          </div>
        ) : (
          <>
            <img className="deck-box-face" src={pictures.back} alt="" data-sleeve={sleeve ?? 'classic'} draggable={false} />
            <img className="deck-box-face deck-box-tracers" src={pictures.lights} alt="" draggable={false} />
          </>
        )}
        <span className="deck-box-side deck-box-right" />
        <span className="deck-box-side deck-box-left" />
        <span className="deck-box-side deck-box-top" />
        <span className="deck-box-side deck-box-bottom" />
        <span className="deck-box-side deck-box-back" />
      </div>
      <span className="deck-box-floor" />
    </div>
  );
}

/** One round pip per color of a deck. */
export function ColorPips({ colors, empty }: { colors: readonly Color[]; empty?: string }) {
  if (colors.length === 0) return empty ? <span className="deck-pips-empty">{empty}</span> : null;
  return (
    <span className="deck-pips" role="img" aria-label={`Colors: ${colors.map((c) => COLOR_NAME[c]).join(', ')}`}>
      {colors.map((c) => (
        <span key={c} className={`deck-mana deck-mana-${c}`} aria-hidden="true">
          {c}
        </span>
      ))}
    </span>
  );
}

type IconName = 'edit' | 'copy' | 'export' | 'trash' | 'search' | 'clear' | 'filter' | 'check' | 'cross' | 'close';

const PATHS: Record<IconName, ReactNode> = {
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  export: <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6m4-6v6" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  clear: <path d="M6 6l12 12M18 6 6 18" />,
  filter: <path d="M4 5h16l-6 8v6l-4-2v-4L4 5Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cross: <path d="M6 6l12 12M18 6 6 18" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

/** A line icon in the current text color. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
