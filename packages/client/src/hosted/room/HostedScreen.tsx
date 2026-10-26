/**
 * Play on the DigiDice server (milestone 13, docs/design/m13-hosted-server.md 4.1, 4.3, 12): a player's name and deck, then either make a private table (the
 * server makes one invite code for each other seat, shown to the creator and sent by them to the players they want) or join one with an invite code. Once
 * seated the player is in the waiting room (Room.tsx) until every seat is taken and everyone has confirmed the ready check; then the game opens with the
 * first view over a HostedConnection and the usual board and prompts.
 *
 * The decks stay on this machine: the server gets only their names (the server finds the cards and checks the deck for the table's format; what is wrong
 * comes back as the reason). The game itself runs on the server, which holds the whole state and sends this player's own view only.
 *
 * Shown from New game only when a hosted server is configured (hosted/config.ts). Leaving this screen before the game starts stands the player up (the seat
 * opens; the creator leaving closes the table). A reload into a table or a game finds it again: the session's token is kept (hosted/storage.ts), and the
 * screen offers to return to a game that is running.
 *
 * M13-12 adds the other ways to a table, on the same link and Room: the lobby browser (the server's open tables, live, with filters; a table made "open"
 * is listed there, optionally with a password), quick match (the server pairs players of a format: Searching while it looks), and the wait for room on a
 * busy server (Room's CapacityWait).
 */
import {
  checkName,
  checkPassword,
  checkTitle,
  defaultTitle,
  isHostedFormat,
  type HostedFormatId,
  type LobbyListing,
  type QueueSize,
  type TableSize,
  type TableVisibility,
} from '@openmtg/hosted/api';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ScreenHeader } from '../../app/ScreenHeader';
import { DEFAULT_FORMAT, deckNotes, FORMATS, offeredFormat, unplayableReason } from '../../game/config';
import { DeckChooser } from '../../game/DeckOptions';
import type { GameDeck } from '../../game/services';
import { MAX_NAME_LENGTH, settingsStore, type SettingsStore } from '../../settings/settings';
import { useSettings } from '../../settings/useSettings';
import { useHostedServer } from '../config';
import { explainHostedError, type ExplainedHostedError } from '../errors';
import { LobbyBrowser } from '../lobby/LobbyBrowser';
import { formatShort } from '../lobby/words';
import { QuickMatchChoice, Searching } from '../match/QuickMatch';
import { ConnectProblem, HostedErrorBox } from './HostedErrorBox';
import { Room, clockSentence } from './Room';
import { defaultHostedServices, toHostedDeck, type HostedServices } from './services';
import { isUnstarted, useHostedSetup } from './useHostedSetup';
import '../hosted.css';

export interface HostedScreenProps {
  services?: HostedServices;
  settings?: SettingsStore;
  /** The hosted server's WebSocket origin; by default the one `GET /api/status` gives (hosted/config.ts). */
  server?: string | null;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="screen hosted-screen">
      <ScreenHeader title="Play on the DigiDice server" />
      {children}
    </div>
  );
}

export function HostedScreen({ services = defaultHostedServices, settings = settingsStore(), server: serverProp }: HostedScreenProps) {
  const server = useHostedServer(serverProp);
  if (server === undefined) {
    return (
      <Frame>
        <p role="status">Loading…</p>
      </Frame>
    );
  }
  if (server === null) {
    return (
      <Frame>
        <section className="hud-panel hosted-panel" aria-label="No game server">
          <p>
            <strong>No game server is set up.</strong> Start OpenMTG with the address of the DigiDice server (<code>--hosted-url</code>, or the{' '}
            <code>OPENMTG_HOSTED_URL</code> setting) to play there.
          </p>
        </section>
      </Frame>
    );
  }
  return <Connected server={server} services={services} settings={settings} />;
}

function Connected({ server, services, settings }: { server: string; services: HostedServices; settings: SettingsStore }) {
  const s = useSettings(settings);
  const { link, table, view, state, problem, connected, failure, connect, enterGame, startedHere } = useHostedSetup(services, server, s.playerNames[0]);
  const [decks, setDecks] = useState<GameDeck[] | null>(null);
  const [name, setName] = useState(s.playerNames[0]);
  const [deckId, setDeckId] = useState('');
  const [format, setFormat] = useState(DEFAULT_FORMAT);
  const [seats, setSeats] = useState<TableSize>(2);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | 'queue' | null>(null);
  const [visibility, setVisibility] = useState<TableVisibility>('private');
  const [title, setTitle] = useState('');
  const [tablePassword, setTablePassword] = useState('');
  const search = useSyncExternalStore(link.subscribe, link.searching);
  const [error, setError] = useState<ExplainedHostedError | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
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

  const info = connected ? link.server() : null;
  // The formats this server offers, as this page knows them (their labels), and the table sizes each allows.
  const offered = useMemo(() => (info ? FORMATS.filter((f) => info.formats.some((x) => x.id === f.id)) : []), [info]);
  const sizes: TableSize[] = info?.formats.find((f) => f.id === format)?.seats ?? [2];
  const clock = info?.formats.find((f) => f.id === format)?.clock;
  const deck = useMemo(() => decks?.find((d) => d.id === deckId) ?? null, [decks, deckId]);
  const unplayable = deck ? unplayableReason(deck.deck, format) : null;
  const notes = deck ? deckNotes(deck.deck) : [];
  const checkedName = checkName(name);
  const checkedTitle = title.trim() === '' ? null : checkTitle(title);
  const checkedPassword = visibility === 'listed' && tablePassword !== '' ? checkPassword(tablePassword) : null;
  const allSizes = useMemo(() => [...new Set((info?.formats ?? []).flatMap((f) => f.seats))].sort() as TableSize[], [info]);
  /** Why the player cannot sit at a table of `f` now (the lobby browser asks for each table's format). */
  const cannotSit = (f: string): string | null =>
    !connected
      ? 'Connecting to the game server…'
      : !deck
        ? 'Choose a deck above to join.'
        : unplayableReason(deck.deck, f)
          ? `Your deck cannot be played in ${formatShort(f)}.`
          : !checkedName.ok
            ? checkedName.message
            : null;
  const blocked = !connected
    ? 'Connecting to the game server…'
    : !deck
      ? 'Choose a deck.'
      : unplayable
        ? 'This deck cannot be played in this format (see above).'
        : !checkedName.ok
          ? checkedName.message
          : null;

  // The table sizes a format allows: the one chosen stays when it is still allowed.
  useEffect(() => {
    if (!sizes.includes(seats)) setSeats(sizes[0] ?? 2);
  }, [sizes, seats]);

  const pickDeck = (id: string) => {
    setDeckId(id);
    const f = offeredFormat(decks?.find((d) => d.id === id)?.format);
    if (f && offered.some((o) => o.id === f)) setFormat(f);
  };

  /** Create or join: the name first (the server shows a session's name as of its last hello), then the command. */
  const sit = async (how: 'create' | 'join') => {
    if (!deck || blocked || !checkedName.ok || !isHostedFormat(format)) return;
    if (how === 'create' && (checkedTitle?.ok === false || checkedPassword?.ok === false)) return;
    setBusy(how);
    setError(null);
    startedHere.current = true;
    await link.rename(checkedName.value);
    const d = toHostedDeck(deck.deck);
    const extra = {
      ...(checkedTitle?.ok ? { title: checkedTitle.value } : {}),
      ...(visibility === 'listed' && tablePassword !== '' ? { password: tablePassword } : {}),
    };
    const r =
      how === 'create'
        ? await link.command({ t: 'create', format, seats, visibility, ...extra, deck: d }, { timeoutMs: 60_000 })
        : await link.command({ t: 'join', code: code.trim(), deck: d }, { timeoutMs: 60_000 });
    setBusy(null);
    if (!r.ok) {
      startedHere.current = false;
      setError(explainHostedError(r.error));
    } else {
      setWarnings(r.warnings ?? []);
      setTablePassword('');
    }
  };

  /** A table of the lobby browser: its own format decides whether the deck may sit there. The error comes back to the list, by the table. */
  const sitListed = async (l: LobbyListing, password: string | undefined): Promise<ExplainedHostedError | null> => {
    if (!deck || !checkedName.ok || cannotSit(l.format)) return null;
    setBusy('join');
    setError(null);
    startedHere.current = true;
    await link.rename(checkedName.value);
    const r = await link.command(
      {
        t: 'join',
        table: l.table,
        ...(password !== undefined ? { password } : {}),
        deck: toHostedDeck(deck.deck),
      },
      { timeoutMs: 60_000 },
    );
    setBusy(null);
    if (!r.ok) {
      startedHere.current = false;
      return explainHostedError(r.error);
    }
    setWarnings(r.warnings ?? []);
    return null;
  };

  /** Quick match in the format chosen above. */
  const find = async (size: QueueSize) => {
    if (!deck || blocked || !checkedName.ok || !isHostedFormat(format)) return;
    setBusy('queue');
    setError(null);
    await link.rename(checkedName.value);
    const r = await link.command(
      {
        t: 'queue',
        format: format as HostedFormatId,
        size,
        deck: toHostedDeck(deck.deck),
      },
      { timeoutMs: 60_000 },
    );
    setBusy(null);
    if (!r.ok) setError(explainHostedError(r.error));
    else setWarnings(r.warnings ?? []);
  };

  const leave = async () => {
    setLeaving(true);
    const r = await link.leave();
    setLeaving(false);
    startedHere.current = false;
    if (!r.ok) setError(explainHostedError(r.error));
  };

  const inRoom = connected && isUnstarted(table);
  const gameOpen = connected && table !== null && !isUnstarted(table);
  const starting = gameOpen && view === null;
  const returning = gameOpen && view !== null && !startedHere.current;
  const joinBlocked = blocked ?? (code.trim() === '' ? 'Enter the invite code.' : null);
  const createBlocked = blocked ?? (checkedTitle?.ok === false ? checkedTitle.message : checkedPassword?.ok === false ? checkedPassword.message : null);
  const searchingNow = connected && search !== null && !inRoom && !gameOpen;
  const capacity = info?.capacity ?? 'open';

  return (
    <Frame>
      {failure && <ConnectProblem message={failure.message} onRetry={connect} />}
      {!failure && state === 'closed' && problem && <ConnectProblem message={problem} onRetry={connect} />}
      {!failure && state === 'lost' && connected && (
        <p className="hosted-error" role="alert">
          Lost the connection to the game server; trying again…
        </p>
      )}
      {error && <HostedErrorBox error={error} />}

      {starting && (
        <p role="status" className="hosted-status">
          The game is starting…
        </p>
      )}

      {returning && table && (
        <section className="hud-panel hosted-panel" aria-label="Open game">
          <h2>A game is open</h2>
          <p>You are in a game on the server ({table.title}). Return to it, or leave it to play another: leaving a game that is not over concedes it.</p>
          <div className="hosted-buttons">
            <button type="button" className="button-primary" onClick={enterGame}>
              Return to the game
            </button>
            <button type="button" onClick={() => void leave()} disabled={leaving}>
              {leaving ? 'Leaving…' : 'Leave that game'}
            </button>
          </div>
        </section>
      )}

      {inRoom ? (
        <Room link={link} warnings={warnings} onLeave={() => void leave()} leaving={leaving} />
      ) : searchingNow ? (
        <Searching link={link} />
      ) : (
        !gameOpen && (
          <>
            <section className="hud-panel hosted-panel" aria-label="Your table">
              <div className="hosted-form">
                <label>
                  Your name
                  <input type="text" value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} />
                </label>
                <DeckChooser decks={decks ?? []} value={deckId} onChange={pickDeck} disabled={decks === null} placeholder={decks === null ? 'Loading decks…' : 'Choose a deck…'} />
                <label>
                  Format
                  <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={!connected}>
                    {(offered.length > 0 ? offered : FORMATS).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                {sizes.length > 1 && (
                  <label>
                    Players
                    <select value={seats} onChange={(e) => setSeats(Number(e.target.value) as TableSize)}>
                      {sizes.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {unplayable && <p className="hosted-error">{unplayable}</p>}
              {notes.length > 0 && (
                <ul className="hosted-notes">
                  {notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              {clock && <p className="hosted-note">{clockSentence(clock)}</p>}
              {capacity !== 'open' && (
                <p className="hosted-note" role="note">
                  {capacity === 'full'
                    ? 'The server is full right now: new games cannot start. Please try again in a few minutes.'
                    : 'The server is busy: a new game may wait in line for room before it starts.'}
                </p>
              )}
              <p className="hosted-note">
                The game runs on the server, which checks every move; you see only your own cards. Only your deck&apos;s card names are sent. Games here are for
                fun and are not ranked.
              </p>

              <div className="hosted-choices">
                <section className="hosted-choice" aria-label="Make a table">
                  <h2>Make a table</h2>
                  <fieldset className="hosted-visibility">
                    <legend>Who can join</legend>
                    <label>
                      <input type="radio" name="hosted-visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
                      Only players I send an invite code
                    </label>
                    <label>
                      <input type="radio" name="hosted-visibility" checked={visibility === 'listed'} onChange={() => setVisibility('listed')} />
                      Anyone: show it in Open tables
                    </label>
                  </fieldset>
                  <label className="hosted-code-field">
                    Table name (optional)
                    <input
                      type="text"
                      value={title}
                      maxLength={120}
                      placeholder={checkedName.ok ? defaultTitle(checkedName.value) : ''}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  {visibility === 'listed' && (
                    <label className="hosted-code-field">
                      Table password (optional)
                      <input
                        type="password"
                        value={tablePassword}
                        maxLength={128}
                        autoComplete="new-password"
                        onChange={(e) => setTablePassword(e.target.value)}
                      />
                    </label>
                  )}
                  <p className="hosted-note">
                    {visibility === 'private'
                      ? 'You get an invite code for each other seat. Send each code only to the player it is for.'
                      : tablePassword !== ''
                        ? 'Anyone can see the table; only players who know the password can sit.'
                        : 'Anyone can see the table and sit at it.'}{' '}
                    The game starts when every seat is taken and everyone has confirmed they are ready.
                  </p>
                  <div className="hosted-buttons">
                    <button type="button" className="button-primary" disabled={createBlocked !== null || busy !== null} onClick={() => void sit('create')}>
                      {busy === 'create' ? 'Making the table…' : 'Make a table'}
                    </button>
                  </div>
                  {!blocked && createBlocked && <p className="hosted-note">{createBlocked}</p>}
                </section>
                <section className="hosted-choice" aria-label="Join with an invite code">
                  <h2>Join with an invite code</h2>
                  <label className="hosted-code-field">
                    Invite code
                    <input
                      type="text"
                      value={code}
                      maxLength={40}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                  <div className="hosted-buttons">
                    <button type="button" className="button-primary" disabled={joinBlocked !== null || busy !== null} onClick={() => void sit('join')}>
                      {busy === 'join' ? 'Joining…' : 'Join the table'}
                    </button>
                  </div>
                </section>
                <QuickMatchChoice
                  sizes={sizes}
                  blocked={blocked ?? (capacity === 'full' ? 'The server is full right now.' : null)}
                  busy={busy !== null}
                  find={(n) => void find(n)}
                />
              </div>
              {blocked && (
                <p className="hosted-note" role="status">
                  {blocked}
                </p>
              )}
            </section>
            {connected && <LobbyBrowser link={link} formats={offered} sizes={allSizes} cannotSit={cannotSit} sit={sitListed} busy={busy !== null} />}
          </>
        )
      )}
    </Frame>
  );
}
