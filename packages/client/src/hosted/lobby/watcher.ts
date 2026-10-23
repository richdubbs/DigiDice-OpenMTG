/**
 * The lobby browser's feed (hosted design 4.2, 3.6): the listed tables for one filter, sort and page, kept current.
 *
 * - **Order.** `watchLobby` first, then `browse`: a change that happens between the two is in the live batches of the watch, so none falls between. The
 *   server sends a batch at most once a second, and takes one `watchLobby` per connection per 5 s (the link's pacing keeps to that); so a filter change
 *   asks for the page at once and for the new watch as soon as it is allowed, and asks for the page again when the watch is in place.
 * - **Live.** A batch is applied (filters.ts) only while the server's watch is the one for the filter in force: a batch made for the filter before it
 *   is dropped. When this page holds every listing that matches (up to one page), the batch is exact. When there are more than a page of them it cannot
 *   know what slides in or out of the page, so it applies what it can and asks for the page again a few seconds later.
 * - **Fallback.** When the server cannot give this connection a watch (its limit of live views: `limitReached`), the page is asked for again every 10 s.
 *   When it cannot browse at all (`notYet`: a server without the lobby browser) the feed says so and stops asking.
 * - **Reconnect.** A new socket has no watch: it is set again, and the page asked for again.
 *
 * A plain class, so the hook (useLobby.ts) is a thin binding and the tests drive it with the link's fake socket and fake timers.
 */
import { HOSTED_LIMITS, type HostedServerMessage, type LobbyFilter, type LobbyListing, type LobbySort, type LobbyUpdateMessage } from '@openmtg/hosted/api';
import { explainHostedError, type ExplainedHostedError, type LinkError } from '../errors';
import type { HostedLink } from '../HostedLink';
import { applyUpdate, cleanFilter, matchesFilter, pageCount, sameFilter, sortListings } from './filters';

export type LobbyMode = 'loading' | 'live' | 'polling' | 'unavailable';

export interface LobbyQuery {
  filter: LobbyFilter;
  sort: LobbySort;
  /** From 0. */
  page: number;
}

export interface LobbySnapshot {
  mode: LobbyMode;
  /** The listings of the page, in the order asked. */
  listings: readonly LobbyListing[];
  /** How many tables match in all (the server's count at the last page, adjusted by the batches since). */
  total: number;
  pages: number;
  /** A page has arrived for the query in force. */
  loaded: boolean;
  problem: ExplainedHostedError | null;
}

/** The page is asked for again this often when there is no watch (design 4.2). */
export const POLL_MS = 10_000;
/** A change of filter, sort or page waits this long for the next one before the page is asked for. */
export const QUERY_DEBOUNCE_MS = 250;
/** After a batch this page could not apply exactly, the page is asked for again after this long. */
export const RECHECK_MS = 3_000;
/** After a failure that may pass (a dropped socket, no answer), this long before the next try. */
export const RETRY_MS = 2_000;

function normalize(q: LobbyQuery): LobbyQuery {
  return { filter: cleanFilter(q.filter), sort: q.sort, page: Math.max(0, Math.floor(q.page)) };
}

function sameQuery(a: LobbyQuery, b: LobbyQuery): boolean {
  return sameFilter(a.filter, b.filter) && a.sort === b.sort && a.page === b.page;
}

export class LobbyWatcher {
  private snap: LobbySnapshot = { mode: 'loading', listings: [], total: 0, pages: 1, loaded: false, problem: null };
  private readonly listeners = new Set<() => void>();
  private query: LobbyQuery;
  private mode: LobbyMode = 'loading';
  private held = new Map<string, LobbyListing>();
  private total = 0;
  private loaded = false;
  private problem: ExplainedHostedError | null = null;
  /** The filter the server holds as this socket's watch (null: none). */
  private watched: LobbyFilter | null = null;
  private wantBrowse = true;
  private browseAfter = 0;
  private watchAfter = 0;
  private lastBrowse = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private stopped = true;
  private taps: (() => void)[] = [];

  constructor(
    private readonly link: HostedLink,
    query: LobbyQuery,
    private readonly now: () => number = Date.now,
  ) {
    this.query = normalize(query);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): LobbySnapshot => this.snap;

  /** Begins (again, after `stop`): listens to the link and asks for the page. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.watched = null;
    this.wantBrowse = true;
    this.browseAfter = this.now();
    this.taps.push(this.link.onMessage((m) => this.onMessage(m)));
    this.wake(0);
  }

  /** Ends: the timers stop, and the server's watch is let go when the link may say so at once (it also ends with the connection). */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const t of this.taps.splice(0)) t();
    if (this.watched !== null && this.link.linkState() === 'open' && this.link.delayFor('watchLobby') === 0) {
      void this.link.command({ t: 'watchLobby', filter: null }, { timeoutMs: 5_000 });
    }
    this.watched = null;
  }

  /** The filter, sort or page changed. */
  setQuery(q: LobbyQuery): void {
    const next = normalize(q);
    if (sameQuery(next, this.query)) return;
    this.query = next;
    this.wantBrowse = true;
    this.browseAfter = this.now() + QUERY_DEBOUNCE_MS;
    // The old rows stay on screen until the new page arrives.
    this.loaded = false;
    this.publish();
    if (!this.stopped) this.plan();
  }

  /** Asks for the page again now. */
  refresh(): void {
    this.wantBrowse = true;
    this.browseAfter = this.now();
    if (!this.stopped) this.plan();
  }

  // ---- the link

  private onMessage(m: HostedServerMessage): void {
    if (m.t === 'welcome') this.reconnected();
    else if (m.t === 'lobbyUpdate') this.update(m);
  }

  /** A new socket: it has no watch (and its own command buckets). */
  private reconnected(): void {
    this.watched = null;
    this.watchAfter = 0;
    if (this.mode === 'live' || this.mode === 'polling') this.mode = 'loading';
    this.wantBrowse = true;
    this.browseAfter = this.now();
    this.publish();
    this.wake(0);
  }

  private update(u: LobbyUpdateMessage): void {
    if (this.stopped || this.mode === 'unavailable') return;
    const filter = this.query.filter;
    // Only the batches of the watch for this filter: an older watch's last batch may still be on the wire.
    if (!sameFilter(this.watched, filter)) return;
    if (this.query.page !== 0) {
      this.refreshSoon();
      return;
    }
    const complete = this.held.size === this.total;
    const next = applyUpdate(this.held, u, filter);
    if (complete) {
      this.total = next.size;
    } else {
      let total = this.total;
      for (const l of u.added) if (matchesFilter(l, filter) && !this.held.has(l.table)) total++;
      for (const id of u.removed) if (this.held.has(id)) total--;
      this.total = Math.max(next.size, total);
      this.refreshSoon();
    }
    this.held = new Map(sortListings(next.values(), this.query.sort).slice(0, HOSTED_LIMITS.browsePage).map((l) => [l.table, l]));
    this.publish();
  }

  private refreshSoon(): void {
    this.wantBrowse = true;
    this.browseAfter = Math.max(this.browseAfter, this.now() + RECHECK_MS);
    this.plan();
  }

  // ---- the loop

  private wake(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.step(), ms);
  }

  private needsWatch(): boolean {
    return (this.mode === 'loading' || this.mode === 'live') && !sameFilter(this.watched, this.query.filter);
  }

  private async step(): Promise<void> {
    this.timer = null;
    if (this.stopped || this.busy || this.mode === 'unavailable') return;
    if (this.link.linkState() !== 'open') return; // the next `welcome` wakes this up
    this.busy = true;
    try {
      if (this.needsWatch() && this.now() >= this.watchAfter && this.link.delayFor('watchLobby') === 0) await this.watch();
      if (this.stopped) return;
      if (this.mode === 'polling' && this.now() >= this.lastBrowse + POLL_MS) this.wantBrowse = true;
      if (this.wantBrowse && this.now() >= this.browseAfter) await this.browse();
    } finally {
      this.busy = false;
    }
    this.plan();
  }

  /** When the loop next has something to do. */
  private plan(): void {
    if (this.stopped || this.mode === 'unavailable') return;
    const t = this.now();
    let at = Number.POSITIVE_INFINITY;
    if (this.needsWatch()) at = Math.min(at, Math.max(this.watchAfter, t + this.link.delayFor('watchLobby')));
    if (this.wantBrowse) at = Math.min(at, this.browseAfter);
    else if (this.mode === 'polling') at = Math.min(at, this.lastBrowse + POLL_MS);
    if (at !== Number.POSITIVE_INFINITY) this.wake(Math.max(0, at - t));
  }

  private async watch(): Promise<void> {
    const filter = this.query.filter;
    const r = await this.link.command({ t: 'watchLobby', filter }, { timeoutMs: 10_000 });
    if (this.stopped) return;
    if (r.ok) {
      this.watched = filter;
      this.mode = 'live';
      this.problem = null;
      // The page, now that the watch is in place: nothing can fall between the two.
      this.wantBrowse = true;
      this.browseAfter = this.now();
    } else {
      this.watchRefused(r.error);
    }
    this.publish();
  }

  private watchRefused(e: LinkError): void {
    const t = this.now();
    switch (e.code) {
      case 'rateLimited':
        this.watchAfter = t + (e.retryAfterMs ?? 5_000);
        return;
      case 'disconnected':
      case 'timeout':
        this.watchAfter = t + RETRY_MS;
        return;
      case 'limitReached':
        // This connection has no live view to have (the server's limits): the page refreshes on its own every 10 s (design 4.2).
        this.mode = 'polling';
        this.problem = null;
        return;
      default:
        // `notYet` (no lobby browser on this server: `browse` says so next) and anything else: ask for the page and see.
        this.mode = 'polling';
    }
  }

  private async browse(): Promise<void> {
    const q = this.query;
    this.wantBrowse = false;
    const r = await this.link.command({ t: 'browse', filter: q.filter, sort: q.sort, page: q.page }, { timeoutMs: 15_000 });
    if (this.stopped) return;
    this.lastBrowse = this.now();
    if (!sameQuery(q, this.query)) {
      // Asked for a page for what is no longer on screen: the page for the current query is wanted already.
      this.wantBrowse = true;
      return;
    }
    if (r.ok && r.tables) {
      this.held = new Map(sortListings(r.tables, q.sort).map((l) => [l.table, l]));
      this.total = r.total ?? r.tables.length;
      this.loaded = true;
      this.problem = null;
    } else if (!r.ok) {
      this.browseRefused(r.error);
    }
    this.publish();
  }

  private browseRefused(e: LinkError): void {
    const t = this.now();
    this.wantBrowse = true;
    switch (e.code) {
      case 'notYet':
        this.mode = 'unavailable';
        this.wantBrowse = false;
        this.problem = explainHostedError(e);
        return;
      case 'rateLimited':
        this.browseAfter = t + (e.retryAfterMs ?? 1_000);
        return;
      case 'disconnected':
      case 'timeout':
        this.browseAfter = t + RETRY_MS;
        return;
      default:
        this.browseAfter = t + POLL_MS;
        this.problem = explainHostedError(e);
    }
  }

  private publish(): void {
    const listings = sortListings(this.held.values(), this.query.sort).slice(0, HOSTED_LIMITS.browsePage);
    this.snap = { mode: this.mode, listings, total: this.total, pages: pageCount(this.total), loaded: this.loaded, problem: this.problem };
    for (const l of [...this.listeners]) l();
  }
}
