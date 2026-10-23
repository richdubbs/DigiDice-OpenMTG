/**
 * The lobby browser (design 4.2, 3.4, 3.6; package M13-8): the gateway's `LobbyService` (`browse` pages, `watchLobby` live updates) and the tables
 * layer's `ListingSink`, on one listing index (listings.ts).
 *
 * - **Browse**: one page (at most 50) of the visible listed tables that match the filter, in the order asked, and how many match in all (query.ts).
 * - **Live updates**: `watch` subscribes one connection to the changes of the tables that match a filter (one subscription per connection; asking again
 *   replaces it, `null` ends it). A change is not sent at once but held for the connection's next batch: `lobbyUpdate { added, changed, removed }`, at most
 *   one per connection per second (`HOSTED_TIMING.lobbyUpdateEveryMs`), naming every table touched in that second as it is at the end of it (also
 *   when the changes cancel out: the browser may have browsed a state in between). Nothing is queued per change: a
 *   connection holds one entry per table, whatever happened to it in the second, so what a slow reader costs is bounded by the number of listed tables.
 *   What the batch says is relative to the filter: a table that starts to match is `added`, one that stops matching (it filled, was hidden, started) is
 *   `removed`, one that still matches is `changed`. The browser applies `added` and `changed` as upserts and `removed` as deletes. A watch reports the
 *   changes from the moment it is made on: the browser `browse`s for the state itself (after `watchLobby`, so that no change falls between the two).
 * - **Limits** (design 4.2, 11): at most `ADDRESS_LIMITS.lobbyWatchers` (4) subscriptions per address key and `MAX_LOBBY_WATCHERS` (2,000) in all; above
 *   them `watch` answers `limitReached` (the browser falls back to `browse` every 10 s). A closed connection's subscription ends at once.
 * - **Time**: `tick(now)` sends the batches that are due and, every 30 s, brings the index in step with the tables layer (`source`) and lifts hides that
 *   ran out; `start` runs it on a timer. Pure in time otherwise: the tests drive `tick` with a fake clock.
 * - **Never throws into a caller**: a `push` that fails ends that connection's subscription and is logged by the error's name.
 */
import { HOSTED_TIMING, type BrowseMessage, type HostedError, type LobbyFilter, type LobbyListing, type LobbyUpdateMessage } from '../api';
import { ADDRESS_LIMITS } from '../config';
import type { LobbyService } from '../gateway/hooks';
import { METRICS, NULL_LOGGER, NULL_METRICS, type Logger, type Metrics } from '../obs';
import type { ListingSink } from '../tables/hooks';
import { ListingIndex } from './listings';
import { matchesFilter, normalizeFilter, sameFilter } from './query';

export interface LobbyBrowserOptions {
  /** `MAX_LOBBY_WATCHERS` (design 4.2: 2,000). */
  maxWatchers?: number;
  /** Subscriptions per address key (`ADDRESS_LIMITS.lobbyWatchers`: 4). */
  perKey?: number;
  /** A connection gets one `lobbyUpdate` at most this often (`HOSTED_TIMING.lobbyUpdateEveryMs`). */
  updateEveryMs?: number;
  /** The tables layer's own list (`() => gateway.tables.listings()`): settled against every `RECONCILE_EVERY_MS`. Absent: never. */
  source?: () => readonly LobbyListing[];
  now?: () => number;
  logger?: Logger;
  metrics?: Metrics;
}

/** How often `tick` settles the index against `source` and lifts hides that ran out. */
export const RECONCILE_EVERY_MS = 30_000;
/** The timer `start` runs: finer than a batch's interval, so a batch goes out within a quarter second of being due. */
const TICK_MS = 250;
/** What a refused watcher is told to wait before it asks again (the browser refreshes by `browse` meanwhile). */
const RETRY_WATCH_MS = 60_000;

/** What one connection holds for a table since its last batch: the listing it was shown (null: none) and the listing it should hold now. */
interface Held {
  base: LobbyListing | null;
  now: LobbyListing | null;
}

interface Watcher {
  conn: number;
  key: string;
  filter: LobbyFilter;
  push: (m: LobbyUpdateMessage) => void;
  held: Map<string, Held>;
  /** When the last batch went out (`-Infinity`: none yet, so the first change goes out at the next tick). */
  lastSent: number;
}

export class LobbyBrowser implements LobbyService, ListingSink {
  readonly index: ListingIndex;
  private readonly watchers = new Map<number, Watcher>();
  private readonly perKeyCount = new Map<string, number>();
  /** Watchers that hold changes to send. */
  private readonly dirty = new Set<Watcher>();
  private readonly maxWatchers: number;
  private readonly perKey: number;
  private readonly updateEveryMs: number;
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  /** When `tick` last settled the index (`-Infinity`: never, so the first tick does). */
  private lastReconcile = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly o: LobbyBrowserOptions = {}) {
    this.maxWatchers = o.maxWatchers ?? 2_000;
    this.perKey = o.perKey ?? ADDRESS_LIMITS.lobbyWatchers;
    this.updateEveryMs = o.updateEveryMs ?? HOSTED_TIMING.lobbyUpdateEveryMs;
    this.now = o.now ?? Date.now;
    this.logger = o.logger ?? NULL_LOGGER;
    this.metrics = o.metrics ?? NULL_METRICS;
    this.index = new ListingIndex((table, before, after) => this.noteChange(table, before, after));
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The tables layer's side

  /** `ListingSink`: a listed unstarted table was added or changed, or left the listing (null). */
  changed(table: string, listing: LobbyListing | null): void {
    this.index.changed(table, listing);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The gateway's side (`LobbyService`)

  browse(m: BrowseMessage, _now: number): { tables: LobbyListing[]; total: number } {
    return this.index.page(m.filter, m.sort, m.page);
  }

  watch(conn: number, key: string, filter: LobbyFilter | null, push: (m: LobbyUpdateMessage) => void, _now: number): HostedError | null {
    if (filter === null) {
      this.remove(conn);
      return null;
    }
    const f = normalizeFilter(filter);
    const had = this.watchers.get(conn);
    if (had) {
      // asking again for what the connection already watches changes nothing (and loses nothing it holds); another filter starts from the index as it is
      if (!sameFilter(had.filter, f)) {
        had.filter = f;
        had.held.clear();
        this.dirty.delete(had);
      }
      had.push = push;
      return null;
    }
    if ((this.perKeyCount.get(key) ?? 0) >= this.perKey) return this.refuse('Too many live lobby views are open from your network; refresh the list instead.');
    if (this.watchers.size >= this.maxWatchers) return this.refuse('The live lobby is full right now; the list refreshes on its own every 10 seconds.');
    this.watchers.set(conn, { conn, key, filter: f, push, held: new Map(), lastSent: -Infinity });
    this.perKeyCount.set(key, (this.perKeyCount.get(key) ?? 0) + 1);
    return null;
  }

  /** The connection closed: its subscription ends. */
  closed(conn: number): void {
    this.remove(conn);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Time

  /** Sends the batches that are due; every `RECONCILE_EVERY_MS` also settles the index against `source` and lifts hides that ran out. */
  tick(now: number = this.now()): void {
    // A clock that stepped back (the wall clock set back) makes every interval due at once instead of stopping them until it catches up again
    // (M13-8 review, finding 4); a step forward only brings the next batch early.
    if (now < this.lastReconcile) this.lastReconcile = -Infinity;
    for (const w of this.dirty) if (now < w.lastSent) w.lastSent = -Infinity;
    if (now - this.lastReconcile >= RECONCILE_EVERY_MS) {
      this.lastReconcile = now;
      this.guarded('reconcile', () => {
        const source = this.o.source;
        if (source) this.index.reconcile(source());
        this.index.prune(now);
      });
    }
    for (const w of [...this.dirty]) if (now - w.lastSent >= this.updateEveryMs) this.flush(w, now);
  }

  /** Runs `tick` on a timer (unref'd: it never keeps the process alive). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The operator's side (design 4.2: the admin command; moderation/hidden.ts reads it from the file the command writes)

  /** Hides a table and its title from the lobby (browse and live updates). True when it was listed. The table itself goes on. */
  hide(table: string, now: number = this.now()): boolean {
    const listed = this.index.hide(table, now);
    this.logger.log('info', 'tableHidden', { game: table, listed });
    return listed;
  }

  /** Lifts a hide: the table is listed again if it still is one. True when it was hidden. */
  unhide(table: string): boolean {
    const was = this.index.unhide(table);
    this.logger.log('info', 'tableUnhidden', { game: table, hidden: was });
    return was;
  }

  /** Counts for the operator and the tests. */
  stats(): { visible: number; held: number; hidden: number; watchers: number; waiting: number } {
    return { visible: this.index.size, held: this.index.held, hidden: this.index.hiddenTables().length, watchers: this.watchers.size, waiting: this.dirty.size };
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Batching

  /** A visible change of one table: what each watcher holds for it is updated, and a watcher with something to say is marked for the next batch. */
  private noteChange(table: string, before: LobbyListing | null, after: LobbyListing | null): void {
    for (const w of this.watchers.values()) {
      const had = before !== null && matchesFilter(before, w.filter) ? before : null;
      const has = after !== null && matchesFilter(after, w.filter) ? after : null;
      if (had === null && has === null) continue;
      const held = w.held.get(table);
      // the first change since the last batch: the browser holds what the table was before it
      if (held) held.now = has;
      else w.held.set(table, { base: had, now: has });
      this.dirty.add(w);
    }
  }

  /**
   * One batch for a watcher: every table touched since the last batch, as it is now. The browser may have `browse`d in between (its first page, a page
   * or sort change), so what it shows can be any state the table passed through, not the one of the last batch: a table that came and went is sent as
   * `removed`, one that changed and changed back as `changed` (both are idempotent for the browser: upserts and deletes). M13-8 review, finding 2.
   */
  private flush(w: Watcher, now: number): void {
    const added: LobbyListing[] = [];
    const changed: LobbyListing[] = [];
    const removed: string[] = [];
    for (const [table, h] of w.held) {
      if (h.now === null) removed.push(table);
      else if (h.base === null) added.push(h.now);
      else changed.push(h.now);
    }
    w.held.clear();
    this.dirty.delete(w);
    if (added.length + changed.length + removed.length === 0) return;
    w.lastSent = now;
    try {
      w.push({ t: 'lobbyUpdate', added, changed, removed });
    } catch (e) {
      this.logger.log('error', 'lobbyPushError', { conn: w.conn, error: e instanceof Error ? e.name : 'error' });
      this.remove(w.conn);
    }
  }

  private remove(conn: number): void {
    const w = this.watchers.get(conn);
    if (!w) return;
    this.watchers.delete(conn);
    this.dirty.delete(w);
    const n = (this.perKeyCount.get(w.key) ?? 1) - 1;
    if (n <= 0) this.perKeyCount.delete(w.key);
    else this.perKeyCount.set(w.key, n);
  }

  private refuse(message: string): HostedError {
    this.metrics.inc(METRICS.refusals, { reason: 'watchers' });
    return { code: 'limitReached', message, retryAfterMs: RETRY_WATCH_MS };
  }

  private guarded(what: string, f: () => void): void {
    try {
      f();
    } catch (e) {
      this.logger.log('error', 'lobbyError', { what, error: e instanceof Error ? e.name : 'error' });
    }
  }
}
