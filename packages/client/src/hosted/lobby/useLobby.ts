/** The lobby feed (watcher.ts) for a screen: starts with the screen, follows the filter, sort and page, stops with it. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { HostedLink } from '../HostedLink';
import { LobbyWatcher, type LobbyQuery, type LobbySnapshot } from './watcher';

export function useLobby(link: HostedLink, query: LobbyQuery): LobbySnapshot & { refresh: () => void } {
  const [watcher] = useState(() => new LobbyWatcher(link, query));
  useEffect(() => {
    watcher.start();
    return () => watcher.stop();
  }, [watcher]);
  const { filter, sort, page } = query;
  useEffect(() => {
    watcher.setQuery({ filter, sort, page });
    // the filter's fields, not its identity: a screen that builds a new object on every render does not ask again
  }, [watcher, filter.format, filter.seats, filter.open, filter.locked, sort, page]);
  const snapshot = useSyncExternalStore(watcher.subscribe, watcher.getSnapshot);
  return { ...snapshot, refresh: () => watcher.refresh() };
}
