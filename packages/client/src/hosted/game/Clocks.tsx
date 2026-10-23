/**
 * The clocks of a game on the DigiDice server (hosted design 5, 12), drawn from what the server last said (HostedLink `clocks()`), counted down by the page
 * (hosted/clocks.ts):
 * - `ClockStrip`: every player's bank, in the rail above the prompt: the running one marked, the free delay of the decision while it lasts, the away time of
 *   a player whose link dropped, and the time left before a game nobody is connected to ends. (The board's name plates are the board's; the strip is the
 *   clocks' own place until a plate can carry them.)
 * - `Rope`: the Arena-like countdown for this player, on the table beside the prompt's buttons (the board's actions slot), once the free delay of their
 *   decision is spent; it turns urgent under a minute of bank.
 */
import { useContext, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useSfxOn } from '../../audio/useSfxOn';
import { PromptSlotsContext } from '../../board/context';
import { clockOfSeat, clocksAt, clocksMoving, clockText } from '../clocks';
import type { HostedLink } from '../HostedLink';
import { useNow } from './useNow';

/** A seat's name for the strip ("You" for this seat). */
function seatName(link: HostedLink, seat: number, mine: boolean): string {
  if (mine) return 'You';
  return link.nameOfSeat(seat as 1 | 2 | 3 | 4) ?? `Seat ${seat}`;
}

export function ClockStrip({ link }: { link: HostedLink }) {
  const clocks = useSyncExternalStore(link.subscribe, link.clocks);
  const away = useSyncExternalStore(link.subscribe, link.away);
  const game = useSyncExternalStore(link.subscribe, link.view);
  const mySeat = link.seat();
  const now = useNow(clocksMoving(clocks));
  if (!clocks || game?.view.result) return null;
  const at = clocksAt(clocks, now);
  return (
    <div className="hosted-clocks">
      <ul className="hosted-clock-list" aria-label="Clocks">
        {[...at.seats].sort((a, b) => a.seat - b.seat).map((c) => {
          const mine = c.seat === mySeat;
          const gone = away.get(c.seat) === 'left';
          const name = seatName(link, c.seat, mine);
          return (
            <li key={c.seat} data-running={c.running || undefined} data-urgent={c.urgent || undefined} data-you={mine || undefined} data-state={gone ? 'left' : c.dropRunning || away.get(c.seat) === 'dropped' ? 'away' : 'here'}>
              <span className="hosted-clock-name">{name}</span>{' '}
              {gone ? (
                <span className="hosted-clock-note">left</span>
              ) : (
                <>
                  <span className="hosted-clock-bank" role="timer" aria-label={`${mine ? 'Your' : `${name}'s`} clock`}>
                    {clockText(c.bankMs)}
                  </span>
                  {c.running && c.delayMs > 0 && <span className="hosted-clock-note"> +{Math.ceil(c.delayMs / 1000)} s free</span>}
                  {(c.dropRunning || away.get(c.seat) === 'dropped') && (
                    <span className="hosted-clock-note hosted-clock-away">
                      {' '}
                      away{c.dropRunning ? `, ${clockText(c.dropMs)} left to come back` : ''}
                    </span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {at.abandonMs !== undefined && (
        <p className="hosted-clock-abandon" role="status">
          Nobody in the game is connected: it ends without a result in <b role="timer">{clockText(at.abandonMs)}</b> unless someone comes back.
        </p>
      )}
    </div>
  );
}

export function Rope({ link }: { link: HostedLink }) {
  const slots = useContext(PromptSlotsContext);
  const clocks = useSyncExternalStore(link.subscribe, link.clocks);
  const table = useSyncExternalStore(link.subscribe, link.table);
  const game = useSyncExternalStore(link.subscribe, link.view);
  const now = useNow(clocksMoving(clocks));
  const mine = clockOfSeat(clocks ? clocksAt(clocks, now) : null, link.seat());
  const shown = mine !== null && mine.rope && !game?.view.result;
  useSfxOn('ui.notify', shown && mine!.urgent ? 'urgent' : null);
  if (!shown || !mine) return null;
  const total = table?.clock.bankMs ?? Math.max(mine.bankMs, 1);
  const pct = Math.max(0, Math.min(100, (mine.bankMs / total) * 100));
  const rope = (
    <div className="hosted-rope" role="timer" aria-label="Your time" data-urgent={mine.urgent || undefined}>
      <span className="hosted-rope-text">Your time {clockText(mine.bankMs)}</span>
      <span className="hosted-rope-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
  return slots?.actions ? createPortal(rope, slots.actions) : rope;
}
