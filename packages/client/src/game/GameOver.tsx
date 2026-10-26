/**
 * Game over (docs/design/m8-client.md screen 8; branding slot 7, docs/design/branding.md): the DigiDice logo, the result (CR 104.2-104.4), Rematch,
 * New game, Home, and a quiet Donate link only when brand.json has a URL; the Donate link can be dismissed and never blocks anything (at most one per
 * game: this panel is shown once per game). "Show the board" folds the panel so the players can look at the final position. The panel marks itself
 * `data-result="open"` or `"folded"`: the board shows its end screen across the table only while the panel is open.
 *
 * M12-4b (docs/design/m12-multiplayer.md D10, 5.3 item 6): a multiplayer game also shows the finishing order, 1st to 4th, with how each
 * player lost (life, commander damage, poison, an empty library, a concession, ...), from the engine's `placements` and each player's `left` record. A
 * two-player game's panel is unchanged.
 *
 * RPL-1 (replays design 6, 10): a recorded game (a local one) also gets the replay panel (replays/EndScreenReplay.tsx): Watch replay, Keep replay and,
 * in hot-seat, each person's "Show my cards in replays". The panel finds the game's replay by the game route's connection (replays/live.ts), so the
 * game screen passes nothing new; an online game has none and shows no panel.
 *
 * RPL-4 (replays design 11): "Report a bug" next to Show the board, when the game screen offers it (`onReportBug`: it opens the bug report dialog).
 *
 * Owner, 2026-10-25: a multiplayer game that can be started again asks "Rematch?" instead of a plain Rematch button. Yes shows each player with their
 * deck (the game's `setup`): "Same decks" starts the rematch at once, "Change decks" opens New game with the same players, decks and options.
 */
import { placements, type GameResult, type GameView, type PlayerState } from '@openmtg/engine';
import { useEffect, useRef, useState } from 'react';
import { useOptionalNav } from '../app/nav';
import { stateOfView } from '../board/model';
import { ordinal } from '../board/table/seats';
import { BRAND, donationUrl, type Brand } from '../branding/brand';
import { DonateLink } from '../branding/Branding';
import { Logo3D } from '../branding/Logo3D';
import { EndScreenReplay } from '../replays/EndScreenReplay';
import { liveReplayOf, type LiveReplay } from '../replays/live';
import { playerName, resultHeadline } from './labels';
import type { GameSetup } from './NewGameScreen';

export interface GameOverProps {
  view: GameView;
  result: GameResult;
  /** Absent when the screen that opened the game gave no way to start it again (the game route's `rematch`). */
  onRematch?: () => void;
  onNewGame: () => void;
  onHome: () => void;
  brand?: Brand;
  /** RPL-1: the game's replay; by default the one of the game route's connection (replays/live.ts), null for a game that is not recorded. */
  replay?: LiveReplay | null;
  /** RPL-4 (optional): "Report a bug" opens the bug report dialog. Absent: no such button. */
  onReportBug?: () => void;
  /** What New game started the game with: the rematch question lists each player's deck from it. */
  setup?: GameSetup;
  /** Open New game with the same players, decks and options, to change the decks before the rematch. */
  onChangeDecks?: () => void;
}

/**
 * How a player lost, in a word or two, from the engine's reason and rules (CR 704.5a-c, 704.6c, 104.3a; a forfeit after a dropped link is a concession by
 * the table's rule, m12 design 6).
 */
export function lossCause(reason: string, rules: readonly string[] = []): string {
  const r = reason.toLowerCase();
  if (/timed out|forfeit|disconnect/.test(r)) return 'Timed out';
  if (rules.includes('CR 104.3a') || /\bconced/.test(r)) return 'Conceded';
  if (rules.includes('CR 704.6c') || /commander/.test(r)) return 'Commander damage';
  if (rules.includes('CR 704.5c') || /poison/.test(r)) return 'Poison';
  if (rules.includes('CR 704.5b') || /empty library/.test(r)) return 'Empty library';
  if (rules.includes('CR 704.5a') || /\blife\b/.test(r)) return 'Life';
  if (/won the game/.test(r)) return 'Another player won';
  return 'Lost';
}

export interface FinishRow {
  player: string;
  name: string;
  place: number;
  /** "1st", "2nd" ... */
  placeLabel: string;
  /** "Winner", "Draw (CR 104.4a)", or how the player lost ("Commander damage: ..."). */
  how: string;
}

/** The finishing order of a finished game (m12 design D10): the engine's placements, named, each with how the player lost. Pure. */
export function finishingOrder(view: GameView, result: GameResult): FinishRow[] {
  const byId = new Map<string, PlayerState>(view.players.map((p) => [p.id, p]));
  return placements(stateOfView(view)).map((pl) => {
    const p = byId.get(pl.player);
    const reason = p?.left?.reason ?? p?.lostReason ?? pl.reason;
    const cause = reason ? lossCause(reason, p?.left?.rules ?? []) : '';
    const how =
      pl.player === result.winner
        ? 'Winner'
        : reason
          ? `${cause.toLowerCase() === reason.toLowerCase() ? cause : `${cause}: ${reason}`}${p?.left ? ` (turn ${p.left.turn})` : ''}`
          : result.winner === null
            ? 'Draw (CR 104.4a)'
            : 'Lost';
    return { player: pl.player, name: playerName(view, pl.player), place: pl.place, placeLabel: ordinal(pl.place), how };
  });
}

export function GameOver({ view, result, onRematch, onNewGame, onHome, brand = BRAND, replay: given, onReportBug, setup, onChangeDecks }: GameOverProps) {
  const nav = useOptionalNav();
  const route = nav?.route;
  const replay = given !== undefined ? given : route?.screen === 'game' ? liveReplayOf(route.connection) : null;
  const [folded, setFolded] = useState(false);
  const [donateDismissed, setDonateDismissed] = useState(false);
  /** The rematch question of a multiplayer game: asked, answered yes (the decks are shown), or answered no. */
  const [rematchAnswer, setRematchAnswer] = useState<'ask' | 'yes' | 'no'>('ask');
  const headline = resultHeadline(view, result);
  const multiplayer = view.options.multiplayer !== undefined;
  // CL4: why the game ended when a player conceded (CR 104.3a; online, leaving a running game concedes it): the engine's reason names the last player
  // remaining, this says who gave up. A multiplayer game says it in the finishing order instead.
  const conceded = multiplayer ? [] : view.players.filter((p) => p.conceded).map((p) => playerName(view, p.id));
  const order = multiplayer ? finishingOrder(view, result) : null;
  // The prompt this panel replaces had the focus: give it to the result, so keyboard and screen-reader users learn the game ended.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  if (folded)
    return (
      <div className="game-over game-over-folded" role="region" aria-label="Game over" data-result="folded">
        <strong>{headline}</strong>
        <button type="button" onClick={() => setFolded(false)}>
          Show the result
        </button>
      </div>
    );
  return (
    <div className="game-over" role="region" aria-label="Game over" data-result="open" data-places={order ? '' : undefined}>
      <Logo3D size={56} track="window" className="game-over-logo" />
      <h2 ref={title} tabIndex={-1} className="game-over-title">
        {headline}
      </h2>
      <p className="game-over-reason">{result.reason}</p>
      {conceded.length > 0 && <p className="game-over-conceded">{conceded.join(' and ')} conceded (CR 104.3a).</p>}
      {order && (
        <ol className="game-over-places" aria-label="Finishing order">
          {order.map((row) => (
            <li key={row.player} data-place={row.place}>
              <span className="game-over-place">{row.placeLabel}</span>
              <span className="game-over-place-name">{row.name}</span>
              <span className="game-over-place-how">{row.how}</span>
            </li>
          ))}
        </ol>
      )}
      {multiplayer && onRematch && rematchAnswer !== 'no' && (
        <section className="game-over-rematch" aria-label="Rematch">
          {rematchAnswer === 'ask' ? (
            <>
              <p className="game-over-rematch-ask">Rematch?</p>
              <button type="button" className="button-primary" onClick={() => setRematchAnswer('yes')}>
                Yes
              </button>
              <button type="button" onClick={() => setRematchAnswer('no')}>
                No
              </button>
            </>
          ) : (
            <>
              {setup && (
                <ul className="game-over-decks" aria-label="Decks for the rematch">
                  {setup.seats.map((seat, i) => (
                    <li key={i}>
                      <span className="game-over-place-name">{seat.name}</span>
                      <span className="game-over-deck">{setup.deckNames[i] ?? ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="button-primary" onClick={onRematch}>
                {setup ? 'Same decks' : 'Rematch'}
              </button>
              {onChangeDecks && (
                <button type="button" onClick={onChangeDecks}>
                  Change decks
                </button>
              )}
            </>
          )}
        </section>
      )}
      <div className="game-over-buttons">
        {onRematch && !multiplayer && (
          <button type="button" className="button-primary" onClick={onRematch}>
            Rematch
          </button>
        )}
        <button type="button" onClick={onNewGame}>
          New game
        </button>
        <button type="button" onClick={onHome}>
          Home
        </button>
        <button type="button" className="button-link" onClick={() => setFolded(true)}>
          Show the board
        </button>
        {onReportBug && (
          <button type="button" className="button-link" onClick={onReportBug}>
            Report a bug
          </button>
        )}
      </div>
      {replay && <EndScreenReplay replay={replay} />}
      {donationUrl(brand) && !donateDismissed && (
        <p className="game-over-donate">
          Enjoying OpenMTG? <DonateLink quiet brand={brand} />
          <button type="button" className="button-link" aria-label="Dismiss Donate" onClick={() => setDonateDismissed(true)}>
            ×
          </button>
        </p>
      )}
    </div>
  );
}
