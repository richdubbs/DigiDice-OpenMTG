/**
 * What the Host and Join screens share (milestone 9, docs/design/online.md): the services they use, the link's life on a setup screen, the deck as the
 * server takes it, the error box, the port-forwarding help, and the panel for a game the local server already has open (after a reload: closing the
 * page's socket does not end the game, so the player can return to it or leave it).
 *
 * M12-5b (m12 design 6): a 3-4 player game's words (the lobby, the other players, a host that left and keeps serving the game).
 *
 * RPL-3 (replays design 7.2, 7.3): entering a game starts its replay (online/replays.ts: a guest records what it is shown, the host reads its record from
 * its own server at the end), so the end screen offers Watch replay and Keep replay; a game the host shared after the guest's page left the game screen
 * is kept from the setup screen that sees the game open.
 */
import type { DeckList } from '@openmtg/server/api';
import type { OnlineDeck, OnlineStatus } from '@openmtg/server/online';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNav } from '../app/nav';
import { sfx } from '../audio/sfx';
import { useSfxOn } from '../audio/useSfxOn';
import { RemoteConnection } from '../connection/RemoteConnection';
import { sealConnection } from '../game/sealed';
import { defaultServices, type GameDeck } from '../game/services';
import type { ReplayEnv } from '../replays/env';
import type { ExplainedError } from './errors';
import { OnlineLink, OnlineLinkError } from './OnlineLink';
import { keepSharedOnlineGame, recordOnlineGame } from './replays';
import { watchLinkSounds } from './sounds';
import { isTable, listNames, seatedPlayers } from './table';
import './online.css';

export interface OnlineServices {
  /** The decks a player can pick (the deck library and the practice decks, like New game). */
  listDecks(): Promise<GameDeck[]>;
  /** A new link to this player's own OpenMTG server (not connected yet). */
  openLink(): OnlineLink;
  /** RPL-3: where the game's replay is kept (default this page's replays, replays/env.ts `pageReplays`; tests give their own). */
  replays?(): ReplayEnv;
}

export const defaultOnlineServices: OnlineServices = {
  listDecks: () => defaultServices.listDecks(),
  openLink: () => new OnlineLink(),
};

/**
 * The deck as the host's server takes it: names and counts of the main deck and the sideboard (the sideboard stays outside the game, CR 100.4), and the
 * commander section when the deck has one (M11-3 INTERFACE CHANGE: `OnlineDeck.commander`, one card or two partners, CR 903.3, 702.124; `main` is then the
 * 99). The host's server checks it against the host's format: a commander in a format without one comes back as `deckRejected` with its reason (shown).
 * CMP1 INTERFACE CHANGE: the companion section too (`OnlineDeck.companion`, CR 702.139a), when the deck has one; the host checks its condition.
 */
export function toOnlineDeck(deck: DeckList): OnlineDeck {
  const keep = (list: readonly { name: string; count: number }[] | undefined) => (list ?? []).filter((e) => e.count > 0).map((e) => ({ name: e.name, count: e.count }));
  const commander = keep(deck.commander);
  const companion = keep(deck.companion);
  return { main: keep(deck.main), sideboard: keep(deck.sideboard), ...(commander.length > 0 ? { commander } : {}), ...(companion.length > 0 ? { companion } : {}) };
}

/** Whether `s` is a game in progress at the server (not idle, not closed). */
export function gameOpen(s: OnlineStatus): boolean {
  return s.phase !== 'idle' && s.phase !== 'closed';
}

/**
 * The link of a setup screen: opened on mount; when the screen started a game (`startedHere`) and its first view arrives, the game screen opens with a
 * RemoteConnection over the same link. Leaving the screen any other way closes the socket, and leaves a game this screen started that never began
 * (a host still waiting, a join still connecting), so no UDP port stays open behind the player's back.
 *
 * Sounds: net.connected when the link to the local server is up, net.joined when the game opens, and the link's own (sounds.ts) while the screen has it.
 */
export function useSetupLink(services: OnlineServices) {
  const nav = useNav();
  const [link] = useState(() => services.openLink());
  const [connectError, setConnectError] = useState<{ code: string; message: string } | null>(null);
  const [connected, setConnected] = useState(false);
  const status = useSyncExternalStore(link.subscribe, link.status);
  const view = useSyncExternalStore(link.subscribe, link.view);
  const linkProblem = useSyncExternalStore(link.subscribe, link.linkProblem);
  const startedHere = useRef(false);
  const handedOff = useRef(false);

  const connect = useCallback(() => {
    setConnectError(null);
    link.connect().then(
      () => {
        setConnected(true);
        sfx('net.connected');
      },
      (e: unknown) => setConnectError(e instanceof OnlineLinkError ? { code: e.code, message: e.message } : { code: 'closed', message: String(e) }),
    );
  }, [link]);

  useEffect(() => watchLinkSounds(link), [link]);

  useEffect(() => {
    connect();
    return () => {
      if (handedOff.current) return;
      if (startedHere.current && gameOpen(link.status()) && !link.view()) void link.leave().finally(() => link.close());
      else link.close();
    };
  }, [connect, link]);

  const enterGame = useCallback(() => {
    if (handedOff.current || !link.view()) return;
    handedOff.current = true;
    sfx('net.joined');
    // FXH (audit m5): the route holds the sealed form of the connection, like every game route.
    const connection = new RemoteConnection(link);
    const sealed = sealConnection(connection);
    recordOnlineGame(connection, link, services.replays?.(), sealed);
    nav.go({ screen: 'game', connection: sealed, online: link });
  }, [link, nav, services]);

  // The game this screen started has begun: open it.
  useEffect(() => {
    if (startedHere.current && view && (status.phase === 'playing' || status.phase === 'over' || status.phase === 'reconnecting' || status.phase === 'spectating')) enterGame();
  }, [enterGame, status.phase, view]);

  // RPL-3: a game the host shared after this player's page left its game screen waits at the server for a page: kept now (online/replays.ts
  // `keepSharedOnlineGame`), so leaving that game from here loses nothing. A page that returns to the game keeps it itself.
  const shared = useSyncExternalStore(link.subscribe, link.replayGame);
  useEffect(() => {
    if (shared !== null && !handedOff.current) void keepSharedOnlineGame(link, services.replays?.());
  }, [link, shared, services]);

  return { link, status, view, connected, connectError, linkProblem, connect, enterGame, startedHere };
}

/** An online error (ui.error when it appears or changes). */
export function ErrorBox({ error }: { error: ExplainedError }) {
  useSfxOn('ui.error', error.message);
  return (
    <div className="online-error" role="alert">
      <p>
        <strong>{error.message}</strong>
        {error.hint ? ` ${error.hint}` : ''}
      </p>
      {error.details && error.details.length > 0 && (
        <ul>
          {error.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The local server could not be reached for online play. */
export function ConnectProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  useSfxOn('ui.error', message);
  return (
    <div className="online-error" role="alert">
      <p>
        <strong>Online play is not available right now.</strong> {message}
      </p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** A game the local server has open already (this page was reloaded, or another tab started it). */
export function OpenGamePanel(props: { status: OnlineStatus; canReturn: boolean; onReturn: () => void; onLeave: () => void; leaving: boolean; onShowCode?: () => void }) {
  const { status, canReturn, onReturn, onLeave, leaving, onShowCode } = props;
  const hosting = status.role === 'host' && (status.phase === 'starting' || status.phase === 'waiting');
  const what = status.role === 'host' ? 'You are hosting a game' : 'You are in a game';
  const others = isTable(status) ? seatedPlayers(status).filter((p) => p.id !== status.me && p.name && !p.left).map((p) => p.name) : status.opponent ? [status.opponent] : [];
  const other = others.length > 0 ? ` with ${listNames(others)}` : '';
  return (
    <section className="hud-panel online-panel" aria-label="Open game">
      <h2>A game is open</h2>
      <p>
        {what}
        {other} on this OpenMTG server ({phaseLabel(status)}). Return to it, or leave it to start another.
      </p>
      <div className="online-buttons">
        {canReturn && (
          <button type="button" className="button-primary" onClick={onReturn}>
            Return to the game
          </button>
        )}
        {hosting && onShowCode && (
          <button type="button" className="button-primary" onClick={onShowCode}>
            Show the join code
          </button>
        )}
        <button type="button" onClick={onLeave} disabled={leaving}>
          {leaving ? 'Leaving…' : 'Leave that game'}
        </button>
      </div>
    </section>
  );
}

export function phaseLabel(s: OnlineStatus): string {
  switch (s.phase) {
    case 'starting':
      return 'starting';
    case 'joining':
      return 'connecting to the host';
    case 'waiting':
      // M12-5b: a 3-4 player game waits in the lobby until every seat is taken.
      return isTable(s) ? (s.role === 'host' ? 'waiting for every seat to be taken' : 'waiting in the lobby') : 'waiting for the other player';
    case 'spectating':
      return 'you left it; your server runs it for the others';
    case 'playing':
      return 'in progress';
    case 'reconnecting':
      return 'reconnecting to the host';
    case 'over':
      return 'the game is over';
    default:
      return s.phase;
  }
}

/** How a host makes the game reachable (docs/design/online.md "Connectivity"). OpenMTG never asks an IP-lookup service by itself. */
export function PortForwardingHelp({ port, open = false, players = 2 }: { port: number; open?: boolean; players?: number }) {
  // M12-5b: with 3-4 players every guest reaches the host's one port, each with the code of their own seat.
  const many = players > 2;
  return (
    <details className="hud-panel online-help" open={open}>
      <summary>{many ? 'How the other players reach you (port forwarding)' : 'How the other player reaches you (port forwarding)'}</summary>
      <ol>
        <li>
          <strong>Forward UDP port {port} on your router to this PC.</strong> Open your router&apos;s settings page (often http://192.168.0.1 or
          http://192.168.1.1; the address is on the router&apos;s label), find &quot;Port forwarding&quot; (also called &quot;Virtual server&quot; or
          &quot;NAT&quot;), and add a rule: protocol <strong>UDP</strong>, external port {port}, internal port {port}, to this PC&apos;s local address (shown by{' '}
          <code>ipconfig</code> in a Command Prompt as &quot;IPv4 Address&quot;, for example 192.168.1.23).
        </li>
        <li>
          <strong>Find your public IP address.</strong> Your router&apos;s status page shows it as the WAN or Internet address; a web search for &quot;what is
          my IP&quot; shows it too. OpenMTG does not look it up by itself. {many ? 'Give each other player' : 'Give the other player'} that address with the
          port, for example <code>203.0.113.7:{port}</code>, and {many ? 'the join code of their own seat' : 'the join code'}.
        </li>
        <li>
          <strong>Allow OpenMTG through the Windows firewall.</strong> The first time you host, Windows may ask whether Node.js may use the network: choose
          Allow (private networks are enough at home). If you closed that window, allow Node.js for UDP port {port} under Windows Security, Firewall &amp;
          network protection, Allow an app through firewall.
        </li>
      </ol>
      <p>
        {many
          ? "Only the player who hosts needs this; the players who join need nothing forwarded. Every message is encrypted with a key that comes from the join code of that player's seat, and nothing without a code gets in. When you stop hosting, the port closes again (you can remove the router rule too)."
          : 'Only the player who hosts needs this; the player who joins needs nothing forwarded. Every message is encrypted with a key that comes from the join code, and nothing without the code gets in. When you stop hosting, the port closes again (you can remove the router rule too).'}
      </p>
    </details>
  );
}

/** M12-5b: who sits at the table in the lobby (the host's and the guests'): each seat, its player or "open", and a link that is down. */
export function LobbySeats({ status }: { status: OnlineStatus }) {
  const players = status.players ?? [];
  const seats = status.seats ?? players.length;
  const rows = Array.from({ length: seats }, (_, i) => i + 1).map((seat) => ({ seat, p: players.find((x) => x.seat === seat && x.taken !== false) }));
  return (
    <ul className="online-seats" aria-label="Players at the table">
      {rows.map(({ seat, p }) => (
        <li key={seat} data-open={!p || undefined}>
          <b>Seat {seat}</b>{' '}
          {!p
            ? 'open'
            : `${p.name}${p.id === status.me ? (seat === 1 ? ' (you, the host)' : ' (you)') : seat === 1 ? ' (the host)' : ''}${p.connected ? '' : ' (link down)'}`}
        </li>
      ))}
    </ul>
  );
}
