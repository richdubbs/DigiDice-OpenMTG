/**
 * The link's life on a hosted screen (compare online/setup.tsx `useSetupLink`): opened on mount; when the screen started the table and the game begins (the
 * first view arrives), the game screen opens with a HostedConnection over the same link. Leaving the screen any other way closes the socket, and stands the
 * player up from a table that has not started (the seat opens; the creator leaving closes the table), so no seat stays taken behind the player's back.
 * A game that is running is not left by leaving the screen: that is the game screen's Leave (a concession).
 *
 * The lobby browser, quick match and queue screens (M13-12) use this hook too: it knows nothing of how the table was made.
 */
import type { NoticeKind, TableView } from '@openmtg/hosted/api';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNav } from '../../app/nav';
import { sfx } from '../../audio/sfx';
import { HostedConnection } from '../../connection/HostedConnection';
import { sealConnection } from '../../game/sealed';
import { HostedLinkError, type HostedLink } from '../HostedLink';
import { recordHostedGame } from '../replay';
import type { HostedServices } from './services';

/** Whether the table has not started: a lobby, waiting for room on the server, or the ready check. */
export function isUnstarted(t: TableView | null): boolean {
  return t !== null && (t.status === 'lobby' || t.status === 'waitingCapacity' || t.status === 'readyCheck');
}

/** The notices of the lobby: a table that closed, expired or fell back to a lobby. */
export const LOBBY_NOTICES: readonly NoticeKind[] = ['tableClosed', 'tableExpired', 'readyCheckFailed', 'queueLost', 'capacityTimeout', 'serverDraining'];

export interface ConnectFailure {
  code: HostedLinkError['code'];
  message: string;
}

export function useHostedSetup(services: HostedServices, server: string, name: string) {
  const nav = useNav();
  const [link] = useState<HostedLink>(() => services.openLink(server, name));
  const [connected, setConnected] = useState(false);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);
  const table = useSyncExternalStore(link.subscribe, link.table);
  const view = useSyncExternalStore(link.subscribe, link.view);
  const state = useSyncExternalStore(link.subscribe, link.linkState);
  const problem = useSyncExternalStore(link.subscribe, link.linkProblem);
  const startedHere = useRef(false);
  const handedOff = useRef(false);

  const connect = useCallback(() => {
    setFailure(null);
    link.connect().then(
      () => {
        setConnected(true);
        sfx('net.connected');
      },
      (e: unknown) => {
        if (e instanceof HostedLinkError && e.code === 'closed') return; // this screen closed it (React runs an effect twice in development)
        setFailure(e instanceof HostedLinkError ? { code: e.code, message: e.message } : { code: 'unreachable', message: String(e) });
      },
    );
  }, [link]);

  useEffect(() => {
    connect();
    return () => {
      if (handedOff.current) return;
      // Leaving a table that has not started stands the player up first; a running game stays (the game screen's Leave is the concession).
      if (isUnstarted(link.table())) void link.leave().finally(() => link.close());
      else link.close();
    };
  }, [connect, link]);

  // A table this screen is part of that has not started: its game is this screen's to open.
  useEffect(() => {
    if (isUnstarted(table)) startedHere.current = true;
  }, [table]);

  const enterGame = useCallback(() => {
    if (handedOff.current || !link.view()) return;
    handedOff.current = true;
    sfx('net.joined');
    // FXH (audit m5): the route holds the sealed form of the connection, like every game route.
    const conn = new HostedConnection(link);
    const sealed = sealConnection(conn);
    // M13-12: the replay of what this player is shown (hosted/replay.ts); the end screen offers it, a bug report carries it so far
    recordHostedGame(conn, link, sealed);
    nav.go({ screen: 'game', connection: sealed, hosted: link });
  }, [link, nav]);

  // The game this screen's table began: open it.
  useEffect(() => {
    if (startedHere.current && view && (table?.status === 'playing' || table?.status === 'over')) enterGame();
  }, [enterGame, table?.status, view]);

  return { link, table, view, state, problem, connected, failure, connect, enterGame, startedHere };
}
