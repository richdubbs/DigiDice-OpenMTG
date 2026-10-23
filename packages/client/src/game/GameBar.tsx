/**
 * The game's top bar (branding slot 3, docs/design/branding.md): the Menu button with the DigiDice logo mark (Settings, About, Report a bug and a quiet
 * Donate only when brand.json has a URL), the turn, active player and step, Undo (hot-seat), Concede and Leave. Concede and Leave ask first.
 *
 * While the hot-seat pass cover is up (`covered`) the bar sits inside the cover and shows only Concede (CR 104.3a: at any time) and Leave: nothing of
 * the game, not even the turn.
 *
 * A confirm or the menu takes the keyboard focus when it opens; Esc closes it (and nothing else: the prompt's Esc = Cancel does not also fire) and
 * gives the focus back to the button that opened it. A panel opening or folding away is heard (ui.open, ui.close).
 */
import type { GameView, PlayerId } from '@openmtg/engine';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { BRAND, type Brand } from '../branding/brand';
import { DonateLink } from '../branding/Branding';
import { Logo3D } from '../branding/Logo3D';
import { STEP_LABELS, playerName } from './labels';
import { gameSfx } from './sound';

export interface GameBarProps {
  view: GameView;
  /** Undo is offered only in hot-seat games (online games never undo, docs/design/online.md). */
  undo: { available: boolean; can: boolean; run: () => void };
  /** Players who may concede from this screen (CR 104.3a: at any time). */
  concedable: readonly PlayerId[];
  onConcede: (player: PlayerId) => void;
  onLeave: () => void;
  /**
   * CL4 (optional): leaving a running game concedes it (online: the other player is told they won, CR 104.3a), and the Leave dialog says so. Absent
   * or false: the dialog says the game is not saved.
   */
  leaveConcedes?: boolean;
  /**
   * M12-5b (optional): the Leave dialog's own words and button, when leaving means something else (the host of a 3-4 player online game concedes and
   * keeps serving the game; a second Leave stops it for everyone). Overrides `leaveConcedes`'s text.
   */
  leaveConfirm?: { text: string; button: string };
  /** Open Settings or About; the game stays where it is (the route keeps its connection). */
  onSettings: () => void;
  onAbout: () => void;
  /** Inside the hot-seat pass cover: only Concede and Leave. */
  covered?: boolean;
  /** RPL-2 (optional): Leave goes at once, without asking (a replay: nothing is lost by leaving it). Absent or false: Leave asks while the game runs. */
  leaveAtOnce?: boolean;
  /** RPL-4 (optional, replays design 11): the menu's "Report a bug" opens the bug report dialog. Absent: the menu has no such item. */
  onReportBug?: () => void;
  brand?: Brand;
}

type Panel = 'concede' | 'leave' | 'menu';

export function GameBar({
  view, undo, concedable, onConcede, onLeave, leaveConcedes = false, leaveConfirm, onSettings, onAbout, covered = false, leaveAtOnce = false, onReportBug, brand = BRAND,
}: GameBarProps) {
  const [open, setOpen] = useState<Panel | null>(null);
  const concedeButton = useRef<HTMLButtonElement>(null);
  const leaveButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const openers: Record<Panel, RefObject<HTMLButtonElement | null>> = { concede: concedeButton, leave: leaveButton, menu: menuButton };
  const first = useRef<HTMLButtonElement>(null);
  const over = view.result !== null;

  const close = (refocus = true) => {
    if (open && refocus) openers[open].current?.focus();
    setOpen(null);
  };

  useEffect(() => {
    if (open === null) return;
    first.current?.focus();
    const opener = { concede: concedeButton, leave: leaveButton, menu: menuButton }[open];
    // Capture phase on window: runs before the prompt's own Esc handler, which then never sees this key.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      gameSfx('ui.close');
      opener.current?.focus();
      setOpen(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const toggle = (which: Panel) => {
    gameSfx(open === which ? 'ui.close' : 'ui.open');
    if (open === which) close();
    else setOpen(which);
  };
  const keepPlaying = () => {
    gameSfx('ui.close');
    close();
  };
  const turn =
    view.turn.number === 0 ? 'Start of the game' : `Turn ${view.turn.number}: ${playerName(view, view.turn.activePlayer)}, ${STEP_LABELS[view.turn.step]}`;
  // M12-4b (m12 design D8, 5.3 item 6; CR 104.3a, 800.4a): in a multiplayer game with more than two players still in it, one player conceding or leaving
  // does not end the game: it goes on for the others.
  const goesOn = view.options.multiplayer !== undefined && view.players.filter((p) => !p.hasLost).length > 2;

  return (
    <header className={covered ? 'game-bar game-bar-covered' : 'game-bar'}>
      {!covered && (
        <>
          <button ref={menuButton} type="button" className="game-bar-menu" aria-expanded={open === 'menu'} aria-controls="game-menu" onClick={() => toggle('menu')}>
            <Logo3D size={30} track="parent" />
            <span>Menu</span>
          </button>
          <h1 className="game-bar-title">Game</h1>
          <span className="game-bar-turn" aria-live="polite">
            {turn}
          </span>
        </>
      )}
      <div className="game-bar-actions">
        {!covered && undo.available && (
          <button type="button" onClick={undo.run} disabled={!undo.can} title="Take back your last action (Z)" aria-keyshortcuts="Z">
            Undo
          </button>
        )}
        {!over && concedable.length > 0 && (
          <button ref={concedeButton} type="button" className="game-bar-concede" onClick={() => toggle('concede')}>
            Concede
          </button>
        )}
        <button ref={leaveButton} type="button" onClick={() => (over || leaveAtOnce ? onLeave() : toggle('leave'))}>
          Leave
        </button>
      </div>
      {open === 'menu' && (
        <div id="game-menu" className="game-menu" role="group" aria-label="Game menu">
          <button ref={first} type="button" onClick={onSettings}>
            Settings
          </button>
          <button type="button" onClick={onAbout}>
            About
          </button>
          {onReportBug && (
            <button
              type="button"
              onClick={() => {
                // The dialog takes the focus, and gives it back to the Menu button when it closes.
                menuButton.current?.focus();
                setOpen(null);
                onReportBug();
              }}
            >
              Report a bug
            </button>
          )}
          <DonateLink quiet brand={brand} />
        </div>
      )}
      {open === 'concede' && (
        <div className="game-confirm" role="dialog" aria-label="Concede">
          <p>
            {goesOn
              ? 'Who concedes? That player loses and leaves the game at once; the game goes on for the others (CR 104.3a, 800.4a).'
              : 'Who concedes? That player loses the game at once (CR 104.3a).'}
          </p>
          {concedable.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                close(false);
                onConcede(p);
              }}
            >
              {playerName(view, p)} concedes
            </button>
          ))}
          <button ref={first} type="button" className="button-link" onClick={keepPlaying}>
            Keep playing
          </button>
        </div>
      )}
      {open === 'leave' && (
        <div className="game-confirm" role="dialog" aria-label="Leave the game">
          <p>
            {leaveConfirm
              ? leaveConfirm.text
              : leaveConcedes
              ? goesOn
                ? 'Leave this game? Leaving concedes it: you lose and leave the game, and it goes on for the others (CR 104.3a, 800.4a).'
                : 'Leave this game? Leaving concedes it: you lose, and the other player is told they won (CR 104.3a).'
              : 'Leave this game? It is not saved and cannot be resumed.'}
          </p>
          <button
            type="button"
            onClick={() => {
              // M12-5b: a Leave that keeps this screen (the host of a 3-4 player online game keeps serving it) closes the dialog.
              close(false);
              onLeave();
            }}
          >
            {leaveConfirm?.button ?? 'Leave the game'}
          </button>
          <button ref={first} type="button" className="button-link" onClick={keepPlaying}>
            Keep playing
          </button>
        </div>
      )}
    </header>
  );
}
