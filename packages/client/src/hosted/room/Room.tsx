/**
 * The waiting room of a table on the DigiDice server (hosted design 4.1, 4.3, 4.6, 12): who sits where and whether they are connected, the invite codes of
 * the open seats (the creator of a private table: the page keeps the codes it was shown, because the server keeps only their hashes and cannot show them
 * again, with "New codes" for the rest), the capacity wait ("the server is busy": position and estimate), the ready check, a short chat and Leave.
 *
 * It knows nothing of how the table was made (a private table's codes, a listed table, a quick match): M13-12's screens put their players here too.
 * Everything comes from the link; nothing is sent until a button is pressed.
 */
import type { SeatView, TableView } from '@openmtg/hosted/api';
import { useState, useSyncExternalStore } from 'react';
import { sfx } from '../../audio/sfx';
import { useSfxOn } from '../../audio/useSfxOn';
import { clockText } from '../clocks';
import { explainHostedError, type ExplainedHostedError } from '../errors';
import { ChatBox } from '../game/Chat';
import { useNow } from '../game/useNow';
import type { HostedLink } from '../HostedLink';
import { CapacityWait } from '../queue/CapacityWait';
import { HostedErrorBox } from './HostedErrorBox';
import { LOBBY_NOTICES } from './useHostedSetup';

/** Words for a time of "5 minutes", "15 minutes", "5 seconds". */
function span(ms: number): string {
  if (ms % 60_000 === 0) {
    const m = ms / 60_000;
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  const s = Math.round(ms / 1000);
  return `${s} second${s === 1 ? '' : 's'}`;
}

/** The clocks of a table in one sentence. */
export function clockSentence(c: TableView['clock']): string {
  return `Each player has ${span(c.bankMs)} on their clock for the game, with ${span(c.delayMs)} free at the start of each decision, and ${span(c.dropMs)} of away time in all if their connection drops.`;
}

/** "Alice", "Alice (you)", "Alice (you, made the table)". */
function seatName(name: string, you: boolean, creator: boolean): string {
  const tags = [you ? 'you' : null, creator ? 'made the table' : null].filter((t) => t !== null);
  return tags.length > 0 ? `${name} (${tags.join(', ')})` : name;
}

function seatState(s: SeatView, status: TableView['status'], ready: boolean): string {
  if (s.name === null) return 'open';
  const parts: string[] = [];
  parts.push(s.connected ? 'here' : 'connection lost');
  if (status === 'readyCheck') parts.push(ready ? 'ready' : 'not ready yet');
  else parts.push(s.deckAccepted ? 'deck ready' : 'checking the deck');
  return parts.join(', ');
}

export function Room({ link, warnings, onLeave, leaving }: { link: HostedLink; warnings: readonly string[]; onLeave: () => void; leaving: boolean }) {
  const table = useSyncExternalStore(link.subscribe, link.table);
  const codes = useSyncExternalStore(link.subscribe, link.codes);
  const queue = useSyncExternalStore(link.subscribe, link.queue);
  const ready = useSyncExternalStore(link.subscribe, link.readyCheck);
  const notices = useSyncExternalStore(link.subscribe, link.notices);
  const state = useSyncExternalStore(link.subscribe, link.linkState);
  const [copied, setCopied] = useState<number | null>(null);
  const [problem, setProblem] = useState<ExplainedHostedError | null>(null);
  const [busy, setBusy] = useState<'codes' | 'ready' | null>(null);
  const now = useNow(ready !== null);
  useSfxOn('ui.notify', ready?.start ?? null);
  if (!table) return null;

  const mine = table.you;
  const isCreator = table.creator !== null && table.creator === mine;
  const openSeats = table.seats.filter((s) => s.name === null);
  const showCodes = table.source === 'private' && isCreator && table.status === 'lobby';
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  const lastLobbyNotice = [...notices].reverse().find((n) => (LOBBY_NOTICES as readonly string[]).includes(n.kind));

  const copy = (seat: number, code: string) => {
    if (!canCopy) return;
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(seat);
        sfx('ui.success');
      },
      () => {
        setCopied(null);
        sfx('ui.error');
      },
    );
  };

  const newCodes = async () => {
    setBusy('codes');
    setProblem(null);
    const r = await link.newCodes();
    setBusy(null);
    if (!r.ok) setProblem(explainHostedError(r.error));
  };

  const confirm = async () => {
    if (!ready) return;
    setBusy('ready');
    setProblem(null);
    const r = await link.confirm(ready.start);
    setBusy(null);
    if (!r.ok) setProblem(explainHostedError(r.error));
  };

  const filled = table.seats.length - openSeats.length;
  const people = (n: number) => `${n} more ${n === 1 ? 'player' : 'players'}`;

  return (
    <section className="hud-panel hosted-panel hosted-room" aria-label="Waiting room">
      <h2>{table.title}</h2>
      <p className="hosted-note">
        {table.source === 'private' ? 'Private table' : table.source === 'matched' ? 'Quick match' : table.locked ? 'Open table with a password' : 'Open table'} ·{' '}
        {table.seats.length} players · the game starts when every seat is taken
      </p>

      <ul className="hosted-seats" aria-label="Players at the table">
        {table.seats.map((s) => {
          // The ready check's own list is the newest word on who has confirmed (the table's follows it).
          const isReady = ready?.players.find((p) => p.seat === s.seat)?.ready ?? s.ready;
          return (
            <li key={s.seat} data-open={s.name === null || undefined} data-ready={(table.status === 'readyCheck' && isReady) || undefined}>
              <b>Seat {s.seat}</b>{' '}
              {s.name === null ? 'open' : seatName(s.name, s.seat === mine, s.seat === table.creator)}
              {s.name !== null && <span className="hosted-seat-state"> · {seatState(s, table.status, isReady)}</span>}
            </li>
          );
        })}
      </ul>

      {showCodes && openSeats.length > 0 && (
        <div className="hosted-codes">
          <h3>Invite codes</h3>
          <p className="hosted-note">Send each code only to the player it is for. A code works once, and only until the game starts.</p>
          <ul aria-label="Invite codes">
            {openSeats.map((s) => {
              const c = codes.find((x) => x.seat === s.seat);
              return (
                <li key={s.seat}>
                  <b>Seat {s.seat}</b>{' '}
                  {c ? (
                    <>
                      <code className="hosted-code" aria-label={`Invite code for seat ${s.seat}`}>
                        {c.code}
                      </code>{' '}
                      {canCopy && (
                        <button type="button" data-sfx="none" aria-label={`Copy the code for seat ${s.seat}`} onClick={() => copy(s.seat, c.code)}>
                          {copied === s.seat ? 'Copied' : 'Copy'}
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="hosted-note">no code to show here: make new ones</span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="hosted-buttons">
            <button type="button" disabled={busy === 'codes' || state !== 'open'} onClick={() => void newCodes()}>
              New codes
            </button>
            <span className="hosted-note">The server cannot show a code again. New codes replace the ones for the open seats; the old ones stop working.</span>
          </div>
        </div>
      )}

      {table.status === 'lobby' && (
        <p role="status" className="hosted-status">
          {openSeats.length > 0 ? `Waiting for ${people(openSeats.length)} to join…` : 'Every seat is taken: the game is about to start…'}
          {filled > 0 && openSeats.length > 0 && isCreator ? ' A table closes if nobody joins for 5 minutes.' : ''}
        </p>
      )}

      {table.status === 'waitingCapacity' && <CapacityWait queue={queue} table={table.table} />}

      {table.status === 'readyCheck' && ready && (
        <div className="hosted-ready" role="group" aria-label="Ready check">
          <p role="status" className="hosted-status">
            Everyone is here. Confirm that you are ready: the game starts when everyone has.{' '}
            <span role="timer" aria-label="Time left to confirm">
              {clockText(ready.deadline - now)}
            </span>
          </p>
          <div className="hosted-buttons">
            <button type="button" className="button-primary" disabled={ready.confirmed || busy === 'ready'} onClick={() => void confirm()}>
              {ready.confirmed ? 'Waiting for the others…' : "I'm ready"}
            </button>
          </div>
        </div>
      )}

      <p className="hosted-note">{clockSentence(table.clock)}</p>

      {warnings.length > 0 && (
        <ul className="hosted-notes" aria-label="Deck warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {lastLobbyNotice && (
        <p className="hosted-note" role="status">
          {lastLobbyNotice.text}
        </p>
      )}
      {state !== 'open' && (
        <p className="hosted-error" role="alert">
          Lost the connection to the game server; trying again… Your seat is kept.
        </p>
      )}
      {problem && <HostedErrorBox error={problem} />}

      <details className="hosted-chat-box">
        <summary>Chat</summary>
        <ChatBox link={link} name={(seat) => link.nameOfSeat(seat) ?? `Seat ${seat}`} autoFocus={false} />
      </details>

      <div className="hosted-buttons">
        <button type="button" onClick={onLeave} disabled={leaving}>
          {leaving ? 'Leaving…' : isCreator ? 'Close the table' : 'Leave the table'}
        </button>
      </div>
    </section>
  );
}
