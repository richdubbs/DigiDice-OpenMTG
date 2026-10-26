/**
 * Host an online game (milestone 9, docs/design/online.md): this player's name, deck and the format, and the UDP port; then the local server opens the
 * port, checks the deck for the format with its card data, and makes a join code. The screen shows the code and the port to give the other player, how
 * to make the port reachable (router port forwarding, the public IP address, the Windows firewall), and opens the game when the guest has joined.
 *
 * The code is always made by the server (audit m9: no code field). Leaving this screen while waiting stops hosting (the port closes).
 *
 * While the game waits for the guest, a calm net.waiting ping sounds at once and every WAITING_PING_MS; Copy code sounds ui.success when copied.
 *
 * M12-5b (docs/design/m12-multiplayer.md 6): "Players: 2 / 3 / 4". With 3 or 4 the server makes one
 * join code per guest seat; the lobby shows each seat's code with Copy and whether it is taken (a code admits one player, into its seat), who has joined,
 * and how many more the table waits for; the game opens by itself when every seat is taken. Duel Commander stays a two-player format.
 */
import { DEFAULT_GAME_PORT, type OnlineError, type OnlineStatus } from '@openmtg/server/online';
import { useEffect, useMemo, useState } from 'react';
import { ScreenHeader } from '../app/ScreenHeader';
import { sfx } from '../audio/sfx';
import { DEFAULT_FORMAT, FORMATS, deckNotes, formatProblem, offeredFormat, unplayableReason } from '../game/config';
import { DeckChooser } from '../game/DeckOptions';
import type { GameDeck } from '../game/services';
import { MAX_NAME_LENGTH, settingsStore, type SettingsStore } from '../settings/settings';
import { useSettings } from '../settings/useSettings';
import { explainOnlineError } from './errors';
import { ConnectProblem, ErrorBox, LobbySeats, OpenGamePanel, PortForwardingHelp, defaultOnlineServices, gameOpen, toOnlineDeck, useSetupLink, type OnlineServices } from './setup';
import { isTable, waitingText } from './table';

/** How often the waiting host hears net.waiting (the catalog: "every few seconds"). */
export const WAITING_PING_MS = 3500;

/** A port the player typed: a whole number from 1 to 65535 (0, any free port, is for tests and the server's own use). */
export function portProblem(port: number): string | null {
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? null : 'The port must be a whole number from 1 to 65535.';
}

export function HostScreen({ services = defaultOnlineServices, settings = settingsStore() }: { services?: OnlineServices; settings?: SettingsStore }) {
  const s = useSettings(settings);
  const { link, status, view, connected, connectError, connect, enterGame, startedHere } = useSetupLink(services);
  const [decks, setDecks] = useState<GameDeck[] | null>(null);
  const [name, setName] = useState(s.playerNames[0]);
  const [deckId, setDeckId] = useState('');
  const [format, setFormat] = useState(DEFAULT_FORMAT);
  const [port, setPort] = useState(DEFAULT_GAME_PORT);
  const [players, setPlayers] = useState<2 | 3 | 4>(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ e: OnlineError; port: number } | null>(null);
  /** The seat whose code was copied last (0: the two-player game's one code), or null. */
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    services.listDecks().then(
      (list) => live && setDecks(list),
      () => live && setDecks([]),
    );
    return () => {
      live = false;
    };
  }, [services]);

  const deck = useMemo(() => decks?.find((d) => d.id === deckId) ?? null, [decks, deckId]);
  // M11-2: judged for the chosen format (a commander deck is played in a Commander format, and one needs a commander, CR 903.3).
  const unplayable = deck ? unplayableReason(deck.deck, format) : null;
  const notes = deck ? deckNotes(deck.deck) : [];
  // M12-5b: Duel Commander is for two players only.
  const tooMany = formatProblem(format, players);
  const blocked = !deck
    ? 'Choose a deck.'
    : unplayable
      ? 'This deck cannot be played yet (see above).'
      : tooMany ?? (name.trim() === '' ? 'Enter your name.' : portProblem(port) ?? (!connected ? 'Connecting to the local OpenMTG server…' : null));

  const pickDeck = (id: string) => {
    setDeckId(id);
    const f = offeredFormat(decks?.find((d) => d.id === id)?.format);
    if (f) setFormat(f);
  };

  const host = async () => {
    if (!deck || blocked) return;
    setBusy(true);
    setError(null);
    startedHere.current = true;
    const r = await link.host({ name: name.trim(), deck: toOnlineDeck(deck.deck), format, port, ...(players > 2 ? { seats: players as 3 | 4 } : {}) });
    setBusy(false);
    if (!r.ok) {
      startedHere.current = false;
      setError({ e: r.error, port });
    }
  };

  const [leaving, setLeaving] = useState(false);
  const leave = async () => {
    setLeaving(true);
    const r = await link.leave();
    setLeaving(false);
    startedHere.current = false;
    if (!r.ok) setError({ e: r.error, port });
  };

  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  const copy = (code: string | undefined, seat = 0) => {
    if (!code || !canCopy) return;
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

  // A game this server hosts that no guest joined yet is this screen's, also after a reload: it shows the code again, opens the game when the guest
  // joins, and stops hosting when the player leaves the screen.
  const hosting = status.role === 'host' && (status.phase === 'starting' || status.phase === 'waiting');
  if (connected && hosting) startedHere.current = true;
  const waiting = hosting && startedHere.current;
  const otherGame = connected && gameOpen(status) && !startedHere.current;
  const pinging = waiting && status.phase === 'waiting';

  useEffect(() => {
    if (!pinging) return;
    sfx('net.waiting');
    const t = setInterval(() => sfx('net.waiting'), WAITING_PING_MS);
    return () => clearInterval(t);
  }, [pinging]);

  return (
    <div className="screen online-screen">
      <ScreenHeader title="Host an online game" />
      {connectError && <ConnectProblem message={connectError.message} onRetry={connect} />}
      {otherGame && <OpenGamePanel status={status} canReturn={view !== null} onReturn={enterGame} onLeave={() => void leave()} leaving={leaving} />}
      {error && <ErrorBox error={explainOnlineError(error.e, { port: error.port })} />}

      {waiting && isTable(status) ? (
        <Lobby status={status} port={port} copied={copied} canCopy={canCopy} onCopy={copy} onStop={() => void leave()} leaving={leaving} />
      ) : waiting ? (
        <section className="hud-panel online-panel online-waiting" aria-label="Waiting for the other player">
          <h2>Give the other player these</h2>
          <dl className="online-facts">
            <dt>Join code</dt>
            <dd>
              <code className="online-code" aria-label="Join code">
                {status.code ?? '…'}
              </code>{' '}
              {status.code && canCopy && (
                <button type="button" data-sfx="none" onClick={() => copy(status.code)}>
                  {copied === 0 ? 'Copied' : 'Copy code'}
                </button>
              )}
            </dd>
            <dt>Port</dt>
            <dd>
              <code aria-label="Port">{status.port ?? port}</code> (UDP)
            </dd>
            <dt>Address</dt>
            <dd>
              Your public IP address with the port, for example <code>203.0.113.7:{status.port ?? port}</code> (see below how to find it).
            </dd>
          </dl>
          <p role="status" className="online-status">
            {status.phase === 'starting' ? 'Opening the port and checking your deck…' : 'Waiting for the other player to join…'}
          </p>
          {status.warnings.length > 0 && (
            <ul className="online-notes" aria-label="Warnings">
              {status.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="online-buttons">
            <button type="button" onClick={() => void leave()} disabled={leaving}>
              {leaving ? 'Stopping…' : 'Stop hosting'}
            </button>
          </div>
          <PortForwardingHelp port={status.port ?? port} open />
        </section>
      ) : (
        !otherGame && (
          <section className="hud-panel online-panel" aria-label="Your game">
            <div className="online-form">
              <label>
                Players
                <select value={players} onChange={(e) => setPlayers(Number(e.target.value) as 2 | 3 | 4)}>
                  <option value={2}>2: you and one other player</option>
                  <option value={3}>3: you and two others</option>
                  <option value={4}>4: you and three others</option>
                </select>
              </label>
              <label>
                Your name
                <input type="text" value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} />
              </label>
              <DeckChooser decks={decks ?? []} value={deckId} onChange={pickDeck} disabled={decks === null} placeholder={decks === null ? 'Loading decks…' : 'Choose a deck…'} />
              <label>
                Format
                <select value={format} onChange={(e) => setFormat(e.target.value)}>
                  {FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                UDP port
                <input type="number" min={1} max={65535} value={Number.isNaN(port) ? '' : port} onChange={(e) => setPort(e.target.valueAsNumber)} />
              </label>
            </div>
            {unplayable && <p className="online-error">{unplayable}</p>}
            {!unplayable && tooMany && <p className="online-error">{tooMany}</p>}
            {notes.length > 0 && (
              <ul className="online-notes">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            {players > 2 ? (
              <p className="online-note">
                Your server makes one join code for each other seat, checks every deck for the format with your card data, and runs the game: each other
                player&apos;s server gets only what their player may see. The game starts when every seat is taken; the seating is random.
              </p>
            ) : (
              <p className="online-note">
                Your server checks both decks for the format with your card data, and runs the game: the other player&apos;s server gets only what their player
                may see.
              </p>
            )}
            <div className="online-buttons">
              {blocked && (
                <span id="online-host-reason" className="online-note">
                  {blocked}
                </span>
              )}
              <button
                type="button"
                className="button-primary"
                disabled={blocked !== null || busy}
                {...(blocked ? { 'aria-describedby': 'online-host-reason' } : {})}
                onClick={() => void host()}
              >
                {busy ? 'Starting…' : 'Host game'}
              </button>
            </div>
            <PortForwardingHelp port={Number.isInteger(port) ? port : DEFAULT_GAME_PORT} players={players} />
          </section>
        )
      )}
    </div>
  );
}

/**
 * M12-5b: the host's lobby of a 3-4 player game: one join code per guest seat (Copy; taken or open), the port and the address, who has joined, and how
 * many more the table waits for. The game opens by itself when every seat is taken (useSetupLink).
 */
function Lobby(props: {
  status: OnlineStatus;
  port: number;
  copied: number | null;
  canCopy: boolean;
  onCopy: (code: string, seat: number) => void;
  onStop: () => void;
  leaving: boolean;
}) {
  const { status, port, copied, canCopy, onCopy, onStop, leaving } = props;
  const shownPort = status.port ?? port;
  const players = status.players ?? [];
  return (
    <section className="hud-panel online-panel online-waiting" aria-label="Lobby">
      <h2>Give each player the code of their own seat</h2>
      <p className="online-note">Each join code admits one player, into its seat. Send each code only to the player it is for.</p>
      <ul className="online-codes" aria-label="Join codes">
        {(status.codes ?? []).map((c) => {
          const who = players.find((p) => p.seat === c.seat && p.taken !== false);
          return (
            <li key={c.seat} data-taken={c.taken || undefined}>
              <b>Seat {c.seat}</b>{' '}
              <code className="online-code" aria-label={`Join code for seat ${c.seat}`}>
                {c.code}
              </code>{' '}
              {canCopy && !c.taken && (
                <button type="button" data-sfx="none" aria-label={`Copy the code for seat ${c.seat}`} onClick={() => onCopy(c.code, c.seat)}>
                  {copied === c.seat ? 'Copied' : 'Copy'}
                </button>
              )}{' '}
              <span className="online-seat-state">{c.taken ? `Taken${who?.name ? ` by ${who.name}` : ''}` : 'Open'}</span>
            </li>
          );
        })}
      </ul>
      <dl className="online-facts">
        <dt>Port</dt>
        <dd>
          <code aria-label="Port">{shownPort}</code> (UDP)
        </dd>
        <dt>Address</dt>
        <dd>
          Your public IP address with the port, for example <code>203.0.113.7:{shownPort}</code> (see below how to find it).
        </dd>
      </dl>
      <LobbySeats status={status} />
      <p role="status" className="online-status">
        {status.phase === 'starting' ? 'Opening the port and checking your deck…' : waitingText(status)}
      </p>
      {status.warnings.length > 0 && (
        <ul className="online-notes" aria-label="Warnings">
          {status.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="online-buttons">
        <button type="button" onClick={onStop} disabled={leaving}>
          {leaving ? 'Stopping…' : 'Stop hosting'}
        </button>
      </div>
      <PortForwardingHelp port={shownPort} players={status.seats ?? 3} open />
    </section>
  );
}
