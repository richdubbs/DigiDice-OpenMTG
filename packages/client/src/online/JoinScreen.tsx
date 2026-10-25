/**
 * Join an online game (milestone 9, docs/design/online.md): this player's name and deck, and one box for the host's address ("ip:port", "[ipv6]:port"
 * or "name:port"; the port may be left out: 47620) and the join code the host gave, in any order (readInvite). The local server connects to the host
 * over UDP, sends the deck by names (the host resolves and checks it with its own card data) and the game opens with the first view. Errors say what to
 * check: a wrong code, no answer (the host's port forwarding and firewall), different versions, a deck the host refused, a host that has a guest already.
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

/** The join codes' alphabet, Crockford base32 (packages/net wire/codes.ts, which the server reads a code with). */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A typed join code in canonical form, as net's normalizeJoinCode reads it (case, spaces and dashes ignored, O read as 0, I and L as 1), or null. */
export function canonicalJoinCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return s.length === 16 && [...s].every((ch) => CODE_ALPHABET.includes(ch)) ? s : null;
}

export interface Invite {
  /** The host's address as found, with a port given on its own added; null when none was found. */
  address: string | null;
  /** The join code in groups of four, null when none was found. */
  code: string | null;
}

/** A word that can only be part of an address: it has a dot, a colon or a bracket (no join code has any). */
const ADDRESS_LIKE = /[.:[\]]/;

/**
 * What the Join screen's one box holds: the host's address ("ip:port", "[ipv6]:port", "name:port", or with no port: 47620) and the join code, typed or
 * pasted together in any order ("203.0.113.7:47621 7KQ2-M9XD-4TRB-HC8P"), with words such as "IP:" or "code" around them. The code is one word that
 * reads as a code, or else a run of up to four (its groups split by spaces); the address is the first word with a dot, a colon or brackets that is not a
 * label ("IP:"); a bare number beside an address that has no port is its port (the Host screen shows the port on a line of its own).
 */
export function readInvite(text: string): Invite {
  const words = text.split(/[\s,;]+/).filter((w) => w !== '');
  const used = new Set<number>();
  let code: string | null = null;
  // Groups split by spaces are first read only as the Host screen shows them (four characters of the alphabet, which has no O, I, L or U), so a word
  // such as "code" before them is not taken for the first group; then, for a code typed by hand, any words.
  const strictGroup = /^[0-9A-HJKMNP-TV-Z]{4}$/i;
  for (const strict of [true, false]) {
    for (let n = 1; n <= 4 && code === null; n++) {
      for (let i = 0; i + n <= words.length && code === null; i++) {
        const run = words.slice(i, i + n);
        if (run.some((w) => ADDRESS_LIKE.test(w)) || (strict && n > 1 && !run.every((w) => strictGroup.test(w)))) continue;
        code = canonicalJoinCode(run.join(''));
        if (code !== null) for (let k = i; k < i + n; k++) used.add(k);
      }
    }
  }
  const rest = words.filter((w, i) => !used.has(i) && !w.endsWith(':'));
  const candidates = rest.filter((w) => ADDRESS_LIKE.test(w));
  let address = candidates.find((w) => addressProblem(w) === null) ?? candidates[0] ?? null;
  const port = rest.find((w) => /^\d{1,5}$/.test(w));
  if (address !== null && port !== undefined && !/(^[^:]*|\]):\d+$/.test(address)) address = `${address}:${port}`;
  return { address, code: code === null ? null : (code.match(/.{4}/g) ?? []).join('-') };
}

/** Why the box cannot be joined with yet (what is missing or wrong), or null. */
export function inviteProblem(text: string, invite: Invite = readInvite(text)): string | null {
  if (text.trim() === '') return 'Enter the host\'s address and the join code.';
  if (invite.address === null) return 'Add the host\'s address to the box: their IP address and port, like 203.0.113.7:47620.';
  const bad = addressProblem(invite.address);
  if (bad) return bad;
  if (invite.code === null) return 'Add the join code the host gave you (16 letters and digits, like XXXX-XXXX-XXXX-XXXX).';
  return null;
}

export function JoinScreen({ services = defaultOnlineServices, settings = settingsStore() }: { services?: OnlineServices; settings?: SettingsStore }) {
  const s = useSettings(settings);
  const nav = useNav();
  const { link, status, view, connected, connectError, connect, enterGame, startedHere } = useSetupLink(services);
  const [decks, setDecks] = useState<GameDeck[] | null>(null);
  const [name, setName] = useState(s.playerNames[0]);
  const [deckId, setDeckId] = useState('');
  // One box for the host's address and the join code, in any order (readInvite): there is only one thing to type in, and nothing goes in the wrong box.
  const [box, setBox] = useState('');
  const invite = useMemo(() => readInvite(box), [box]);
  const address = invite.address ?? '';
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
        : inviteProblem(box, invite) ?? (!connected ? 'Connecting to the local OpenMTG server…' : null));

  const join = async () => {
    if (!deck || blocked || invite.code === null) return;
    setBusy(true);
    setError(null);
    startedHere.current = true;
    const r = await link.join({ address: address.trim(), code: invite.code, name: name.trim(), deck: toOnlineDeck(deck.deck) });
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
              Host address and join code
              <input
                type="text"
                value={box}
                placeholder={`203.0.113.7:${DEFAULT_GAME_PORT} XXXX-XXXX-XXXX-XXXX`}
                autoComplete="off"
                spellCheck={false}
                disabled={joining}
                aria-describedby="online-join-found"
                onChange={(e) => setBox(e.target.value)}
              />
            </label>
          </div>
          {/* What the box was read as, so a player sees at once which part is still missing */}
          <p id="online-join-found" className="online-note online-join-found">
            Address: {invite.address ?? 'not found yet'} · Join code: {invite.code ?? 'not found yet'}
          </p>
          {unplayable && <p className="online-error">{unplayable}</p>}
          {notes.length > 0 && (
            <ul className="online-notes">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className="online-note">
            Ask the host for their public IP address, the port and the join code (in a game of 3 or 4 players, the code of your own seat), and paste or
            type them all into the box above, in any order. You need nothing forwarded on your own router to join. The host&apos;s server checks your
            deck for the host&apos;s format with the host&apos;s card data.
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
