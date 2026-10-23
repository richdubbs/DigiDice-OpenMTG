/**
 * Join an online game (milestone 9, docs/design/online.md): this player's name and deck, the host's address ("ip:port", "[ipv6]:port" or "name:port";
 * the port may be left out: 47620) and the join code the host gave. The local server connects to the host over UDP, sends the deck by names (the host
 * resolves and checks it with its own card data) and the game opens with the first view. Errors say what to check: a wrong code, no answer (the host's
 * port forwarding and firewall), different versions, a deck the host refused, a host that has a guest already.
 *
 * M12-5b (docs/design/m12-multiplayer.md 6): in a game of 3-4 players the code is the one of this player's own seat; once seated, the player waits in
 * the lobby (who sits where, how many more the table waits for) until every seat is taken, and the game opens by itself. Leaving the lobby gives the
 * seat back (its code admits another player).
 */
import { DEFAULT_GAME_PORT, type OnlineError } from '@openmtg/server/online';
import { useEffect, useMemo, useState } from 'react';
import { ScreenHeader } from '../app/ScreenHeader';
import { useNav } from '../app/nav';
import { DEFAULT_FORMAT, commanderCount, deckNotes, unplayableReason } from '../game/config';
import { DeckOptions } from '../game/DeckOptions';
import type { GameDeck } from '../game/services';
import { MAX_NAME_LENGTH, settingsStore, type SettingsStore } from '../settings/settings';
import { useSettings } from '../settings/useSettings';
import { explainOnlineError } from './errors';
import { ConnectProblem, ErrorBox, LobbySeats, OpenGamePanel, defaultOnlineServices, gameOpen, toOnlineDeck, useSetupLink, type OnlineServices } from './setup';
import { isTable, waitingText } from './table';

/** The port of an address as typed ("ip:port", "[v6]:port", "name:port", or no port: the default), for the error hints; null when it cannot be read. */
export function addressPort(address: string): number | null {
  const a = address.trim();
  const m = /^\[[^\]]*\](?::(\d+))?$/.exec(a) ?? /^[^:\s]*(?::(\d+))?$/.exec(a);
  if (!m) return null;
  return m[1] === undefined ? DEFAULT_GAME_PORT : Number(m[1]);
}

/** Why the address cannot be used yet, or null (the server checks it again). */
export function addressProblem(address: string): string | null {
  const a = address.trim();
  if (a === '') return 'Enter the host\'s address.';
  const port = addressPort(a);
  if (port === null) return 'Write the address as ip:port, for example 203.0.113.7:47620 ([2001:db8::7]:47620 for IPv6).';
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'The port must be a whole number from 1 to 65535.';
  return null;
}

export function JoinScreen({ services = defaultOnlineServices, settings = settingsStore() }: { services?: OnlineServices; settings?: SettingsStore }) {
  const s = useSettings(settings);
  const nav = useNav();
  const { link, status, view, connected, connectError, connect, enterGame, startedHere } = useSetupLink(services);
  const [decks, setDecks] = useState<GameDeck[] | null>(null);
  const [name, setName] = useState(s.playerNames[0]);
  const [deckId, setDeckId] = useState('');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ e: OnlineError; port?: number } | null>(null);
  const [leaving, setLeaving] = useState(false);

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
  // M11-2: the host's format is not known here: a deck with a commander is judged as a Commander deck (the host's server checks it for its format and
  // says why when it refuses it, `deckRejected`).
  const unplayable = deck ? unplayableReason(deck.deck, commanderCount(deck.deck) > 0 ? 'commander' : DEFAULT_FORMAT) : null;
  const notes = deck ? deckNotes(deck.deck) : [];
  const blocked = !deck
    ? 'Choose a deck.'
    : unplayable
      ? 'This deck cannot be played yet (see above).'
      :
      (name.trim() === ''
        ? 'Enter your name.'
        : addressProblem(address) ?? (code.trim() === '' ? 'Enter the join code the host gave you.' : !connected ? 'Connecting to the local OpenMTG server…' : null));

  const join = async () => {
    if (!deck || blocked) return;
    setBusy(true);
    setError(null);
    startedHere.current = true;
    const r = await link.join({ address: address.trim(), code: code.trim(), name: name.trim(), deck: toOnlineDeck(deck.deck) });
    setBusy(false);
    if (!r.ok) {
      startedHere.current = false;
      const port = addressPort(address);
      setError({ e: r.error, ...(port !== null ? { port } : {}) });
    }
  };

  const leave = async () => {
    setLeaving(true);
    const r = await link.leave();
    setLeaving(false);
    startedHere.current = false;
    if (!r.ok) setError({ e: r.error });
  };

  const otherGame = connected && gameOpen(status) && !startedHere.current;
  // M12-5b: seated in a 3-4 player game that waits for every seat to be taken.
  const lobby = connected && startedHere.current && status.role === 'guest' && status.phase === 'waiting' && isTable(status);
  const joining = !lobby && (busy || (startedHere.current && status.role === 'guest' && status.phase === 'joining'));

  return (
    <div className="screen online-screen">
      <ScreenHeader title="Join an online game" />
      {connectError && <ConnectProblem message={connectError.message} onRetry={connect} />}
      {otherGame && <OpenGamePanel status={status} canReturn={view !== null} onReturn={enterGame} onLeave={() => void leave()} leaving={leaving} onShowCode={() => nav.go({ screen: 'hostOnline' })} />}
      {error && <ErrorBox error={explainOnlineError(error.e, error.port !== undefined ? { port: error.port } : {})} />}
      {lobby && (
        <section className="hud-panel online-panel online-waiting" aria-label="Lobby">
          <h2>{status.seat !== undefined ? `You have seat ${status.seat}` : 'You have a seat'}</h2>
          <LobbySeats status={status} />
          <p role="status" className="online-status">
            {waitingText(status)}
          </p>
          <div className="online-buttons">
            <button type="button" onClick={() => void leave()} disabled={leaving}>
              {leaving ? 'Leaving…' : 'Leave the table'}
            </button>
          </div>
        </section>
      )}
      {!otherGame && !lobby && (
        <section className="hud-panel online-panel" aria-label="Your game">
          <div className="online-form">
            <label>
              Your name
              <input type="text" value={name} maxLength={MAX_NAME_LENGTH} disabled={joining} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Deck
              <select value={deckId} onChange={(e) => setDeckId(e.target.value)} disabled={decks === null || joining}>
                <option value="">{decks === null ? 'Loading decks…' : 'Choose a deck…'}</option>
                <DeckOptions decks={decks ?? []} />
              </select>
            </label>
            <label>
              Host address
              <input
                type="text"
                value={address}
                placeholder={`203.0.113.7:${DEFAULT_GAME_PORT}`}
                autoComplete="off"
                spellCheck={false}
                disabled={joining}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label>
              Join code
              <input
                type="text"
                value={code}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                disabled={joining}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          </div>
          {unplayable && <p className="online-error">{unplayable}</p>}
          {notes.length > 0 && (
            <ul className="online-notes">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className="online-note">
            Ask the host for their public IP address, the port and the join code (in a game of 3 or 4 players, the code of your own seat). You need nothing
            forwarded on your own router to join. The host&apos;s server checks your deck for the host&apos;s format with the host&apos;s card data.
          </p>
          <div className="online-buttons">
            {joining ? (
              <>
                <span role="status" className="online-status">
                  Connecting to {address.trim()}…
                </span>
                <button type="button" onClick={() => void leave()} disabled={leaving}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                {blocked && (
                  <span id="online-join-reason" className="online-note">
                    {blocked}
                  </span>
                )}
                <button
                  type="button"
                  className="button-primary"
                  disabled={blocked !== null}
                  {...(blocked ? { 'aria-describedby': 'online-join-reason' } : {})}
                  onClick={() => void join()}
                >
                  Join game
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
