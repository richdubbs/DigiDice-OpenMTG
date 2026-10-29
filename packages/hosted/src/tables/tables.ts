/**
 * Tables (design 4.1, 4.3 codes, 4.4, 4.6's start flow; package M13-6): create, join (a listed table by id, a private table by its seat's invite code),
 * new codes, leave, the lobby caps and expiry, the start through capacity admission and a ready check, and the table's life until it is unloaded.
 *
 * - **One game per session** (D6): a session sits at one table at a time (lobby, waiting for capacity, ready check, playing); after the end, or after
 *   it left the game, it may sit elsewhere.
 * - **Lobby limits** (review 5): unstarted tables at most 1 per session and 2 per address key; `MAX_LOBBY` unstarted and `MAX_LISTED` listed tables in
 *   all, counted separately from running games (above them `create` answers `busy` for address keys that already have a table, `serverBusy`
 *   otherwise). An unstarted table expires `lobbyExpiryMs` (5 minutes) after its last join by another player (the creator's own actions do not
 *   extend it).
 * - **Invite codes** (private tables): one per open seat, hashed, spent when used; `codes` (creator only, before the start) replaces the codes of the
 *   open seats. A wrong code is a failed join attempt (the gateway's `JoinGuard`).
 * - **Start** (design 4.1, 4.6): when every seat is taken the table asks admission; admitted at once (under the soft limit) or later (the table waits as
 *   `waitingCapacity` with its position), then a ready check (30 s, every seat confirms with `ready`), then `TableRouter.start` with the decks the deck
 *   pool prepared. A seat that does not confirm is stood up (the creator: the table closes) and the table goes back to the lobby.
 * - **Stored** (design 4.7): the `games` and `seats` rows (`createGame`, `updateLobby`; a closed or expired table is voided, 'abandoned', no ledger
 *   row); after a restart `restore` reloads the unstarted tables (decks are prepared again at the start) and `adopt` the recovered games.
 * - **Never sent**: decks, passwords, codes (but to the creator, once), session ids, tokens. A table's view is `TableView` (api.ts).
 */
import type { PreparedDeck } from '@openmtg/net/server-kit';
import {
  checkPassword, checkTitle, defaultTitle, HOSTED_TIMING, seatsAllowed, type ClockSettings, type CreateMessage, type HostedDeck, type HostedError,
  type HostedFormatId, type HostedServerMessage, type JoinMessage, type LobbyListing, type NoticeKind, type QueueStatus, type SeatNumber, type SeatView,
  type TableSize, type TableSource, type TableStatus, type TableView,
} from '../api';
import { capacityUnits, type Admission, type AdmissionDecision, type AdmissionEvent, type ReleaseCause, type StartRequest } from '../admission/api';
import { ADDRESS_AGGREGATE, clockFor, type HostedConfig } from '../config';
import { aggregateKey } from '../gateway/address';
import { preparedDeckHash } from '../ledger/fingerprint';
import { METRICS, NULL_LOGGER, NULL_METRICS, type Logger, type Metrics } from '../obs';
import type { DeckResult, Runtime, StartSeat, TableEnded } from '../runtime/api';
import type { GameStore, SeatRow, TableRow } from '../store/api';
import type { TableLimits } from '../table/limits';
import { commanderVariantOf } from '@openmtg/net/server-kit';
import { shortId, ulid } from '../gateway/ids';
import { newInviteCode, typedInviteHash } from './codes';
import type { ListingSink, ModerationHook, PasswordHook } from './hooks';

/** Who sends a command: the session, its display name and the address key of its connection. */
export interface Who {
  session: string;
  name: string;
  key: string;
}

export type TableReply =
  | { ok: true; table?: string; codes?: string[]; warnings?: string[] }
  | { ok: false; error: HostedError };

/** Join attempts by code or password go through this (the gateway's `JoinGuard`, per session and address key). */
export interface JoinAttempts {
  check(session: string, key: string, now: number): 'locked' | 'rate' | null;
  fail(session: string, key: string, now: number): boolean;
  lockedFor(session: string, key: string, now: number): number;
}

export interface TablesOptions {
  store: GameStore;
  runtime: Pick<Runtime, 'start' | 'submit' | 'prepare'>;
  admission: Admission;
  config: Pick<HostedConfig, 'formats' | 'podsEnabled' | 'clocks' | 'maxLobby' | 'maxListed' | 'units'>;
  /** The deck fingerprints' key (`ledgerSecret`). */
  ledgerSecret: string;
  joins: JoinAttempts;
  /** Sends a message to a session's connection (dropped when it has none). */
  send: (session: string, msg: HostedServerMessage) => void;
  /** Whether a session has a connection now. */
  isConnected: (session: string) => boolean;
  now?: () => number;
  passwords?: PasswordHook;
  moderation?: ModerationHook;
  listings?: ListingSink;
  /** The session takes part in something else (matchmaking, M13-9): it may not sit down. */
  busyElsewhere?: (session: string) => boolean;
  logger?: Logger;
  metrics?: Metrics;
  /** Ready check and lobby expiry (tests shorten them). */
  readyCheckMs?: number;
  lobbyExpiryMs?: number;
  /** Overrides of every game's table limits (tests: `checkpointEvery`). */
  limits?: Partial<TableLimits>;
}

interface SeatState {
  seat: SeatNumber;
  session: string | null;
  name: string | null;
  /** The address key of the session's connection when it sat down ('' after a restart). */
  key: string;
  deck: HostedDeck | null;
  /** The deck pool's deck (null after a restart: prepared again at the start). */
  prepared: PreparedDeck | null;
  deckHash: string | null;
  inviteHash: string | null;
  joinedAt: number | null;
  /** A session whose join is being prepared holds the seat. */
  reserved: string | null;
  ready: boolean;
  /** Left the game (a concession) or the ended table. */
  left: boolean;
}

interface Table {
  id: string;
  format: HostedFormatId;
  size: TableSize;
  source: TableSource;
  title: string;
  passwordHash: string | null;
  passwordSalt: string | null;
  status: TableStatus;
  seats: SeatState[];
  creator: SeatNumber | null;
  creatorName: string;
  creatorKey: string;
  createdAt: number;
  expiresAt: number;
  readyCheck: { start: string; deadline: number } | null;
  waitingSince: number | null;
  /** Admission admitted this table's start and it has neither begun nor been released (its units are reserved). */
  admitted: boolean;
  queue: QueueStatus | null;
  queueSentAt: number;
  starting: boolean;
  closed: boolean;
  clock: ClockSettings;
  units: number;
  persisting: Promise<void>;
}

/**
 * What the players of a table are told when its game could not start: a fixed text for each reason, never the runtime's own message (an engine or
 * configuration error text is for the log; every seat would read it).
 */
function startFailureText(reason: 'draining' | 'exists' | 'closed' | 'failed' | 'busy'): string {
  switch (reason) {
    case 'draining':
      return 'The server is restarting soon, so the game could not start. Please try again in a few minutes.';
    case 'busy':
      return 'The server is busy saving games, so the game could not start. Please try again shortly.';
    case 'closed':
      return 'The server is stopping, so the game could not start.';
    case 'exists':
    case 'failed':
      return 'The game could not start on the server.';
  }
}

const err = (code: HostedError['code'], message: string, extra: Partial<HostedError> = {}): TableReply => ({ ok: false, error: { code, message, ...extra } });

const openSeat = (s: SeatState): boolean => s.session === null && s.reserved === null;

export class Tables {
  private readonly tables = new Map<string, Table>();
  /** Session -> the table it sits at (any status; cleared when it leaves, the table closes or unloads). */
  private readonly bySession = new Map<string, string>();
  /** Invite hash -> its table and seat. */
  private readonly codes = new Map<string, { table: string; seat: SeatNumber }>();
  /**
   * Creates that passed their checks and are being saved (the store is awaited before the table exists). They count against the caps and the
   * one-game rule like the tables they will be, so creates in flight together cannot all pass a check that none of them has used up yet.
   */
  private readonly creating = new Set<{ session: string; key: string; listed: boolean }>();
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private readonly readyCheckMs: number;
  private readonly lobbyExpiryMs: number;
  private drainingNow = false;
  /**
   * Sessions that sat at a table a restart could not bring back (a matched table: the matcher's state is gone; a row without its creator), with what to tell
   * them when they come back, once. Forgotten after an hour.
   */
  private readonly lost = new Map<string, { at: number; kind: NoticeKind; text: string }>();

  constructor(private readonly o: TablesOptions) {
    this.now = o.now ?? Date.now;
    this.logger = o.logger ?? NULL_LOGGER;
    this.metrics = o.metrics ?? NULL_METRICS;
    this.readyCheckMs = o.readyCheckMs ?? HOSTED_TIMING.readyCheckTableMs;
    this.lobbyExpiryMs = o.lobbyExpiryMs ?? HOSTED_TIMING.lobbyExpiryMs;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Queries

  /** The table a session takes part in now (lobby, waiting, ready check or playing, its seat not left), or null. */
  busyIn(session: string): string | null {
    const id = this.bySession.get(session);
    const t = id ? this.tables.get(id) : undefined;
    if (!t || t.status === 'over') return null;
    const s = t.seats.find((x) => x.session === session);
    return s && !s.left ? t.id : null;
  }

  /** Whether a session takes part in a game now (one at a time, D6): it sits at a table, is saving one, or is matchmaking elsewhere. */
  private takesPart(session: string): boolean {
    if (this.busyIn(session) || this.o.busyElsewhere?.(session)) return true;
    for (const c of this.creating) if (c.session === session) return true;
    return false;
  }

  /** Where a session sits (for routing its game messages and for `welcome`), or null. */
  seatOf(session: string): { table: string; seat: SeatNumber; status: TableStatus; left: boolean } | null {
    const id = this.bySession.get(session);
    const t = id ? this.tables.get(id) : undefined;
    if (!t) return null;
    const s = t.seats.find((x) => x.session === session);
    return s ? { table: t.id, seat: s.seat, status: t.status, left: s.left } : null;
  }

  /** The session sitting at a game's seat (the runtime's deliveries), or null. */
  sessionAt(game: string, seat: SeatNumber): string | null {
    const t = this.tables.get(game);
    const s = t?.seats[seat - 1];
    if (!s?.session) return null;
    // A session that has moved on to another table no longer gets this one's messages.
    return this.bySession.get(s.session) === game ? s.session : null;
  }

  /** The capacity queue status of a session's table, if it waits. */
  queueOf(session: string): QueueStatus | null {
    const id = this.bySession.get(session);
    return (id ? this.tables.get(id)?.queue : null) ?? null;
  }

  has(id: string): boolean {
    return this.tables.has(id);
  }

  /** The listed unstarted tables (the lobby browser's index, M13-8). */
  listings(): LobbyListing[] {
    return [...this.tables.values()].filter((t) => this.listed(t)).map((t) => this.listingOf(t));
  }

  /** Counts by status (metrics, tests). */
  counts(): Record<TableStatus, number> {
    const c: Record<TableStatus, number> = { lobby: 0, waitingCapacity: 0, readyCheck: 0, playing: 0, over: 0 };
    for (const t of this.tables.values()) c[t.status]++;
    return c;
  }

  /** A table as a session may see it (tests and the gateway's resends). */
  viewFor(table: string, session: string | null): TableView | null {
    const t = this.tables.get(table);
    return t ? this.view(t, session) : null;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Commands

  async create(who: Who, m: CreateMessage): Promise<TableReply> {
    const now = this.now();
    const pre = this.mayCreate(who, m);
    if (pre) return pre;
    const title = checkTitle(m.title ?? defaultTitle(who.name));
    if (!title.ok) return err('badMessage', title.message);
    const words = this.o.moderation?.titleProblem(title.value);
    if (words) return err('notAllowed', words);
    let password: string | null = null;
    if (m.password !== undefined) {
      if (m.visibility !== 'listed') return err('badMessage', 'Only listed tables have passwords; a private table has invite codes.');
      if (!this.o.passwords) return err('notYet', 'Password-protected tables are not available on this server yet.');
      const p = checkPassword(m.password);
      if (!p.ok) return err('badMessage', p.message);
      password = p.value;
    }
    const deck = await this.prepare(m.deck, m.format, who.session);
    if (!deck.ok) return deck.reply;
    // Checked again after the deck pool's await (another command may have changed things meanwhile), and the place is taken at once: nothing is
    // awaited between this check and the reservation.
    const again = this.mayCreate(who, m);
    if (again) return again;
    const slot = { session: who.session, key: who.key, listed: m.visibility === 'listed' };
    this.creating.add(slot);
    try {
      return await this.createReserved(who, m, now, title.value, password, deck);
    } finally {
      this.creating.delete(slot);
    }
  }

  /** The rest of `create` once its place is reserved: the password hash, the rows, the table. */
  private async createReserved(
    who: Who, m: CreateMessage, now: number, title: string, password: string | null, deck: { deck: PreparedDeck; hash: string },
  ): Promise<TableReply> {
    let hashed: { hash: string; salt: string } | null = null;
    if (password !== null) {
      try {
        hashed = await this.o.passwords!.hash(password);
      } catch (e) {
        return this.passwordFailed('hash', e);
      }
    }
    const id = ulid(now);
    const variant = commanderVariantOf(m.format);
    const seats: SeatState[] = Array.from({ length: m.seats }, (_, i) => ({
      seat: (i + 1) as SeatNumber, session: null, name: null, key: '', deck: null, prepared: null, deckHash: null, inviteHash: null, joinedAt: null,
      reserved: null, ready: false, left: false,
    }));
    const creator = seats[0]!;
    Object.assign(creator, { session: who.session, name: who.name, key: who.key, deck: m.deck, prepared: deck.deck, deckHash: deck.hash, joinedAt: now });
    const codes: string[] = [];
    if (m.visibility === 'private') {
      for (const s of seats.slice(1)) {
        const c = newInviteCode();
        s.inviteHash = c.hash;
        codes.push(c.code);
      }
    }
    const t: Table = {
      id, format: m.format, size: m.seats, source: m.visibility, title, passwordHash: hashed?.hash ?? null, passwordSalt: hashed?.salt ?? null,
      status: 'lobby', seats, creator: 1, creatorName: who.name, creatorKey: who.key, createdAt: now, expiresAt: now + this.lobbyExpiryMs, readyCheck: null,
      waitingSince: null, admitted: false, queue: null, queueSentAt: 0, starting: false, closed: false, clock: clockFor(this.o.config.clocks, m.format, m.seats),
      units: capacityUnits(m.seats, this.o.config.units), persisting: Promise.resolve(),
    };
    try {
      await this.o.store.createGame({
        id, format: m.format, variant, seats: m.seats, source: m.visibility, title: t.title, passwordHash: t.passwordHash, passwordSalt: t.passwordSalt,
        createdAt: new Date(now), seatRows: this.seatRows(t),
      });
    } catch (e) {
      this.logger.log('error', 'tableCreateFailed', { game: id, error: e instanceof Error ? e.name : 'error' });
      return err('busy', 'The server could not save the table; try again.');
    }
    this.tables.set(id, t);
    this.releaseOld(who.session, id);
    this.bySession.set(who.session, id);
    for (const s of seats) if (s.inviteHash) this.codes.set(s.inviteHash, { table: id, seat: s.seat });
    this.listingChanged(t);
    this.gauges();
    this.sendViews(t);
    this.logger.log('info', 'tableCreated', { game: id, format: m.format, seats: m.seats, kind: m.visibility });
    return { ok: true, table: id, ...(codes.length ? { codes } : {}), ...(deck.deck.warnings.length ? { warnings: deck.deck.warnings } : {}) };
  }

  private mayCreate(who: Who, m: CreateMessage): TableReply | null {
    if (this.drainingNow) return err('draining', 'The server is restarting soon; no new tables now.');
    if (this.takesPart(who.session)) return err('busy', 'You already take part in a game (one at a time).');
    if (!this.o.config.formats.includes(m.format)) return err('notAllowed', 'This server does not offer that format.');
    if (!seatsAllowed(m.format, this.o.config.podsEnabled).includes(m.seats)) {
      return seatsAllowed(m.format, true).includes(m.seats)
        ? err('notYet', 'Tables of 3 or 4 players (pods) are not open on this server yet.')
        : err('badMessage', 'That format is played by two players.');
    }
    let unstarted = 0;
    let listed = 0;
    let mine = 0;
    let network = 0;
    const agg = who.key === '' ? null : aggregateKey(who.key);
    for (const t of this.tables.values()) {
      if (!this.unstarted(t)) continue;
      unstarted++;
      if (t.source === 'listed') listed++;
      if (t.creatorKey === who.key && who.key !== '') mine++;
      if (agg !== null && aggregateKey(t.creatorKey) === agg) network++;
    }
    for (const c of this.creating) {
      unstarted++;
      if (c.listed) listed++;
      if (c.key === who.key && who.key !== '') mine++;
      if (agg !== null && aggregateKey(c.key) === agg) network++;
    }
    if (mine >= 2 || network >= ADDRESS_AGGREGATE.unstartedTables) return err('busy', mine >= 2 ? 'Your network already has two tables waiting for players.' : 'Your network already has many tables waiting for players.');
    if (unstarted >= this.o.config.maxLobby || (m.visibility === 'listed' && listed >= this.o.config.maxListed)) {
      this.metrics.inc(METRICS.refusals, { reason: m.visibility === 'listed' ? 'listedFull' : 'lobbyFull' });
      return mine > 0
        ? err('busy', 'The lobby is full; your network already has a table waiting.')
        : err('serverBusy', 'The lobby is full; please try again in a few minutes.', { retryAfterMs: 60_000 });
    }
    return null;
  }

  async join(who: Who, m: JoinMessage): Promise<TableReply> {
    const now = this.now();
    if (this.drainingNow) return err('draining', 'The server is restarting soon; no new games now.');
    if (this.takesPart(who.session)) return err('busy', 'You already take part in a game (one at a time).');
    let t: Table | undefined;
    let seat: SeatState | undefined;
    let spent: string | null = null;
    if (m.code !== undefined) {
      const guard = this.guard(who, now);
      if (guard) return guard;
      const hash = typedInviteHash(m.code);
      const entry = hash ? this.codes.get(hash) : undefined;
      t = entry ? this.tables.get(entry.table) : undefined;
      seat = t && entry ? t.seats[entry.seat - 1] : undefined;
      if (!t || !seat || t.status !== 'lobby' || t.starting || !openSeat(seat) || seat.inviteHash !== hash) return this.failedJoin(who, now, 'badCode', 'That invite code is not valid (or its seat is taken).');
      spent = hash;
    } else {
      t = this.tables.get(m.table!);
      if (!t || t.source !== 'listed' || t.closed) return err('noTable', 'There is no such table.');
      if (t.status !== 'lobby' || t.starting) return err('tableFull', 'That table is not open for players now.');
      seat = t.seats.find(openSeat);
      if (!seat) return err('tableFull', 'That table is full.');
      if (t.passwordHash !== null) {
        const guard = this.guard(who, now);
        if (guard) return guard;
        if (m.password === undefined) return err('badPassword', 'That table needs a password.');
        let ok: boolean;
        try {
          ok = !!this.o.passwords && (await this.o.passwords.verify(m.password, t.passwordHash, t.passwordSalt ?? ''));
        } catch (e) {
          return this.passwordFailed('verify', e);
        }
        if (!ok) return this.failedJoin(who, now, 'badPassword', 'Wrong password.');
        if (!openSeat(seat)) seat = t.seats.find(openSeat);
        if (!seat || t.status !== 'lobby' || t.starting) return err('tableFull', 'That table is full.');
      }
    }
    const table = t;
    const s = seat;
    s.reserved = who.session;
    let deck: Awaited<ReturnType<Tables['prepare']>>;
    try {
      deck = await this.prepare(m.deck, table.format, who.session); // F32: paced per session in the deck pool (a listed table has no JoinGuard)
    } finally {
      if (s.reserved === who.session) s.reserved = null;
    }
    if (!deck.ok) return deck.reply;
    if (table.closed || !this.tables.has(table.id) || table.status !== 'lobby' || table.starting || s.session !== null) return err('tableFull', 'That seat was taken meanwhile.');
    if (this.takesPart(who.session)) return err('busy', 'You already take part in a game (one at a time).');
    if (this.drainingNow) return err('draining', 'The server is restarting soon; no new games now.');
    Object.assign(s, { session: who.session, name: who.name, key: who.key, deck: m.deck, prepared: deck.deck, deckHash: deck.hash, joinedAt: now, ready: false });
    if (spent) {
      this.codes.delete(spent);
      s.inviteHash = null;
    }
    const before = this.bySession.get(who.session);
    this.bySession.set(who.session, table.id);
    // The last join by another player extends the table's life (the creator cannot join its own table).
    table.expiresAt = now + this.lobbyExpiryMs;
    const revert = () => {
      Object.assign(s, { session: null, name: null, key: '', deck: null, prepared: null, deckHash: null, joinedAt: null, ready: false });
      if (spent) {
        s.inviteHash = spent;
        this.codes.set(spent, { table: table.id, seat: s.seat });
      }
      if (this.bySession.get(who.session) === table.id) {
        if (before !== undefined && this.tables.has(before)) this.bySession.set(who.session, before);
        else this.bySession.delete(who.session);
      }
    };
    try {
      await this.persist(table);
    } catch {
      revert();
      return err('busy', 'The server could not save your seat; try again.');
    }
    // The table may have closed while the seat was being saved (its creator left, the server began to drain): nothing is left to sit at or to start.
    if (table.closed) return err('noTable', 'That table closed while you were sitting down.');
    // One start per fill: the last two seats of a pod taken together both find the table full when their seats are saved; the first to get here asks (the
    // table is no longer in the lobby after that: a ready check or a wait for capacity), the other only sat down.
    if (table.status === 'lobby' && !table.starting && table.seats.every((x) => x.session !== null)) {
      const refused = this.requestStart(table, now);
      if (refused) {
        revert();
        void this.persist(table).catch(() => undefined);
        this.sendViews(table);
        return refused;
      }
    }
    if (before !== undefined && before !== table.id) this.releaseOld(who.session, table.id, before);
    this.listingChanged(table);
    this.sendViews(table);
    this.gauges();
    return { ok: true, table: table.id, ...(deck.deck.warnings.length ? { warnings: deck.deck.warnings } : {}) };
  }

  /**
   * A session sits down elsewhere: the ended (or left) game it still had a seat at gets its `leave`, so the runtime can unload that table once every
   * seat has left (design 2.2 step 7). `old`: the table it was linked to before (default: its link now).
   */
  private releaseOld(session: string, keep: string, old: string | undefined = this.bySession.get(session)): void {
    const t = old !== undefined && old !== keep ? this.tables.get(old) : undefined;
    if (!t || (t.status !== 'playing' && t.status !== 'over')) return;
    const s = t.seats.find((x) => x.session === session);
    if (!s || s.left) return;
    s.left = true;
    this.o.runtime.submit(t.id, { t: 'leave', seat: s.seat, id: 1 });
    this.markLeft(t, s);
  }

  /**
   * Writes the seat's `left_at` (after the concession was handed to the runtime: a seat marked left whose concession never ran would be cut off from a game it
   * still plays). After a restart `adopt` reads it back: a seat that left is not seated again. A failure is logged; the leave stands.
   */
  private markLeft(t: Table, s: SeatState): void {
    this.o.store.markSeatLeft(t.id, s.seat, new Date(this.now())).catch((e: unknown) => {
      this.logger.log('warn', 'seatLeftNotSaved', { game: t.id, seat: s.seat, error: e instanceof Error ? e.name : 'error' });
    });
  }

  /**
   * The password hook failed (a busy hasher: M13-8's scrypt has a few derivations at a time and a short line behind them): the command is answered `busy`
   * with a short wait, and nothing else changes (the connection stays, the table is as it was; a failure is not a wrong password: no failed attempt).
   */
  private passwordFailed(what: 'hash' | 'verify', e: unknown): TableReply {
    this.logger.log('warn', 'passwordHookFailed', { what, error: e instanceof Error ? e.name : 'error' });
    return err('busy', 'The server is busy checking passwords; try again in a moment.', { retryAfterMs: 2_000 });
  }

  private guard(who: Who, now: number): TableReply | null {
    const r = this.o.joins.check(who.session, who.key, now);
    if (r === 'locked') {
      this.metrics.inc(METRICS.refusals, { reason: 'joinLocked' });
      return err('rateLimited', 'Too many wrong codes or passwords: joining is paused for a while.', { retryAfterMs: this.o.joins.lockedFor(who.session, who.key, now) });
    }
    if (r === 'rate') return err('rateLimited', 'Too many join attempts; wait a moment.', { retryAfterMs: 1_000 });
    return null;
  }

  private failedJoin(who: Who, now: number, code: 'badCode' | 'badPassword', message: string): TableReply {
    this.o.joins.fail(who.session, who.key, now);
    return err(code, message);
  }

  /** `codes`: the creator of a private table gets new codes for the open seats (the old ones stop working). */
  async newCodes(who: Who): Promise<TableReply> {
    const t = this.tableOf(who.session);
    if (!t || t.creator === null || t.seats[t.creator - 1]?.session !== who.session) return err('notAllowed', 'Only the creator of a private table can make new codes.');
    if (t.source !== 'private') return err('notAllowed', 'Only private tables have invite codes.');
    if (t.status !== 'lobby' || t.starting) return err('notAllowed', 'New codes only before the game starts.');
    const codes: string[] = [];
    for (const s of t.seats) {
      if (!openSeat(s)) continue;
      if (s.inviteHash) this.codes.delete(s.inviteHash);
      const c = newInviteCode();
      s.inviteHash = c.hash;
      this.codes.set(c.hash, { table: t.id, seat: s.seat });
      codes.push(c.code);
    }
    await this.persist(t).catch(() => undefined);
    return { ok: true, table: t.id, codes };
  }

  /**
   * `leave`: before the start the seat opens (the creator closes the table); during the game it is a concession (CR 104.3a) the table applies (the
   * actor answers `id`: 'routed'); after the end the session leaves the table.
   */
  async leave(who: Who, id: number): Promise<TableReply | 'routed'> {
    const t = this.tableOf(who.session);
    if (!t) return { ok: true };
    const s = t.seats.find((x) => x.session === who.session)!;
    if (t.status === 'playing' || t.status === 'over') {
      if (s.left) {
        this.bySession.delete(who.session);
        return { ok: true };
      }
      s.left = true;
      this.bySession.delete(who.session);
      const routed = this.o.runtime.submit(t.id, { t: 'leave', seat: s.seat, id });
      this.markLeft(t, s);
      if (routed) {
        // The actor's reply goes to this seat: keep routing it to the session until it sits elsewhere.
        this.bySession.set(who.session, t.id);
        return 'routed';
      }
      return { ok: true };
    }
    if (t.starting) return err('busy', 'The game is starting.');
    await this.standUp(t, s, null);
    return { ok: true };
  }

  /** `ready`: confirms the running ready check of the session's table. */
  ready(who: Who, start: string): TableReply {
    const t = this.tableOf(who.session);
    if (!t || t.status !== 'readyCheck' || !t.readyCheck || t.readyCheck.start !== start) return err('notAllowed', 'There is no such ready check.');
    const s = t.seats.find((x) => x.session === who.session)!;
    if (!s.ready) {
      s.ready = true;
      this.sendReadyCheck(t);
      this.sendViews(t);
      if (t.seats.every((x) => x.ready) && !t.starting) void this.begin(t);
    }
    return { ok: true, table: t.id };
  }

  /** `unqueue` while the session's table waits for capacity: the seat reopens (design 4.6). Null: the session's table does not wait. */
  async unqueue(who: Who): Promise<TableReply | null> {
    const t = this.tableOf(who.session);
    if (!t || t.status !== 'waitingCapacity') return null;
    const s = t.seats.find((x) => x.session === who.session)!;
    await this.standUp(t, s, null);
    return { ok: true };
  }

  /** A chat line at an unstarted table (the game's chat is the table actor's). False: not at an unstarted table. */
  lobbyChat(who: Who, text: string): boolean {
    const t = this.tableOf(who.session);
    if (!t || !this.unstarted(t)) return false;
    const s = t.seats.find((x) => x.session === who.session)!;
    for (const o of t.seats) if (o.session) this.o.send(o.session, { t: 'chat', from: s.seat, text });
    return true;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Connections

  /** The session's connection is (back) in place: its table's state again (a full view for a game, through the table). */
  connected(session: string): void {
    const lost = this.lost.get(session);
    if (lost) {
      this.lost.delete(session);
      this.o.send(session, { t: 'notice', kind: lost.kind, text: lost.text });
    }
    const t = this.tableOf(session);
    if (!t) return;
    const s = t.seats.find((x) => x.session === session)!;
    if (t.status === 'playing' || t.status === 'over') {
      if (!s.left) this.o.runtime.submit(t.id, { t: 'connect', seat: s.seat });
      return;
    }
    this.sendViews(t);
    if (t.status === 'readyCheck') this.sendReadyCheck(t, session);
    if (t.queue) this.o.send(session, { t: 'queueStatus', queue: t.queue });
  }

  /** The session's connection dropped (it keeps its seat: design 3.3). */
  disconnected(session: string): void {
    const t = this.tableOf(session);
    if (!t) return;
    const s = t.seats.find((x) => x.session === session)!;
    if (t.status === 'playing' || t.status === 'over') {
      if (!s.left) this.o.runtime.submit(t.id, { t: 'disconnect', seat: s.seat });
      return;
    }
    this.sendViews(t);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The runtime's events

  /** The game ended (its ledger row is written): its units are free; the table stays for "good game" chat. */
  ended(e: TableEnded): void {
    const t = this.tables.get(e.game);
    if (!t) return;
    t.status = 'over';
    this.handle(this.o.admission.freed(e.units, this.now()));
    this.sendViews(t);
    this.gauges();
  }

  /** The table left the runtime's memory: it is gone here too. */
  unloaded(game: string): void {
    const t = this.tables.get(game);
    if (!t) return;
    this.remove(t);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Time

  /** Expiries, ready-check deadlines and admission's queue (the gateway calls it every second). */
  tick(now: number = this.now()): void {
    for (const t of [...this.tables.values()]) {
      if (t.closed) continue;
      if (t.status === 'lobby' && !t.starting && t.expiresAt <= now) {
        this.close(t, 'tableExpired', 'The table expired: nobody joined for 5 minutes.');
        continue;
      }
      if (t.status === 'readyCheck' && t.readyCheck && !t.starting && t.readyCheck.deadline <= now) {
        void this.readyFailed(t).catch((e: unknown) => this.logger.log('error', 'readyFailedError', { game: t.id, error: e instanceof Error ? e.name : 'error' }));
      }
    }
    for (const [session, l] of this.lost) if (now - l.at > 60 * 60_000) this.lost.delete(session);
    this.handle(this.o.admission.tick(now));
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Restart

  /** Reloads the unstarted tables an earlier process left (design 4.7); tables that waited for capacity ask again in their old order. */
  async restore(): Promise<number> {
    const rows = await this.o.store.openTables();
    const now = this.now();
    let restored = 0;
    for (const row of rows) {
      const t = this.fromRow(row, now);
      if (!t) {
        await this.voidUnrestorable(row, now);
        continue;
      }
      restored++;
      this.tables.set(t.id, t);
      for (const s of t.seats) {
        if (s.session) this.bySession.set(s.session, t.id);
        if (s.inviteHash) this.codes.set(s.inviteHash, { table: t.id, seat: s.seat });
      }
      this.listingChanged(t);
    }
    // Full tables ask for their start again, admission putting them in their old order (`waiting_since`; a ready check that was running is started again:
    // design 4.6): those that waited for capacity first, then the others.
    const since = (t: Table) => t.waitingSince ?? Number.MAX_SAFE_INTEGER;
    const full = [...this.tables.values()]
      .filter((t) => t.status === 'lobby' && t.seats.every((s) => s.session !== null))
      .sort((a, b) => since(a) - since(b) || a.createdAt - b.createdAt);
    const decisions = this.o.admission.restore(full.map((t) => this.startRequestOf(t, now)), now);
    for (const { table, decision } of decisions) {
      const t = this.tables.get(table)!;
      const refused = this.requestStart(t, now, decision);
      if (refused) {
        t.waitingSince = null;
        t.status = 'lobby';
        void this.persist(t).catch(() => undefined);
      }
    }
    this.gauges();
    return restored;
  }

  /**
   * An unstarted row a restart cannot bring back: a matched table (matchmaking's queues and ready checks are in memory and gone: design 4.5 has the players
   * queue again) or a row without its creator. It is voided, never left in `openTables()` for good, and its players are told when they come back.
   */
  private async voidUnrestorable(row: TableRow, now: number): Promise<void> {
    const matched = row.source === 'matched';
    const text = matched ? 'The server restarted while your match was forming; please queue again.' : 'The server restarted and your table could not be restored; please make a new one.';
    for (const r of row.seatRows) if (r.session) this.lost.set(r.session, { at: now, kind: matched ? 'queueLost' : 'tableClosed', text });
    try {
      await this.o.store.voidGame(row.id, 'abandoned');
    } catch (e) {
      this.logger.log('warn', 'tableVoidFailed', { game: row.id, error: e instanceof Error ? e.name : 'error' });
    }
    this.logger.log('info', 'tableNotRestored', { game: row.id, kind: matched ? 'matched' : row.source });
  }

  /** A game the runtime recovered after a restart: its seats' sessions (they reconnect with their tokens). */
  async adopt(game: string): Promise<boolean> {
    const row = await this.o.store.tableRow(game);
    if (!row || row.status !== 'running') return false;
    const t = this.fromRow(row, this.now());
    if (!t) return false;
    t.status = 'playing';
    this.tables.set(t.id, t);
    // A seat that left is not linked: its session may sit at another game now (whichever is adopted first), and a left seat blocks no new table.
    for (const s of t.seats) if (s.session && !s.left) this.bySession.set(s.session, t.id);
    this.gauges();
    return true;
  }

  private fromRow(row: TableRow, now: number): Table | null {
    if (row.status !== 'lobby' && row.status !== 'waitingCapacity' && row.status !== 'running') return null;
    const seats: SeatState[] = [];
    for (let i = 1; i <= row.seats; i++) {
      const r = row.seatRows.find((x) => x.seat === i);
      seats.push({
        seat: i as SeatNumber, session: r?.session ?? null, name: r?.name ?? null, key: '', deck: r?.deck ?? null, prepared: null, deckHash: r?.deckHash ?? null,
        inviteHash: r?.inviteHash ?? null, joinedAt: r?.joinedAt?.getTime() ?? null, reserved: null, ready: false, left: r?.leftAt != null,
      });
    }
    const creator = row.source === 'matched' ? null : (1 as SeatNumber);
    if (row.status !== 'running' && (creator === null || seats[0]!.session === null)) return null;
    return {
      id: row.id, format: row.format, size: row.seats, source: row.source, title: row.title, passwordHash: row.passwordHash, passwordSalt: row.passwordSalt,
      status: row.status === 'waitingCapacity' ? 'lobby' : row.status === 'running' ? 'playing' : 'lobby', seats, creator,
      creatorName: seats[0]!.name ?? '', creatorKey: '', createdAt: row.createdAt.getTime(), expiresAt: now + this.lobbyExpiryMs, readyCheck: null,
      waitingSince: row.waitingSince?.getTime() ?? null, admitted: false, queue: null, queueSentAt: 0, starting: false, closed: false,
      clock: clockFor(this.o.config.clocks, row.format, row.seats), units: capacityUnits(row.seats, this.o.config.units), persisting: Promise.resolve(),
    };
  }

  /** Drain (design 2.3): no new tables or joins; the unstarted tables close with a notice; running games go on. */
  drain(): void {
    this.drainingNow = true;
    for (const t of [...this.tables.values()]) {
      if (this.unstarted(t) && !t.starting) this.close(t, 'serverDraining', 'The server is restarting soon: this table is closed. Please try again in a few minutes.');
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The start

  /** What admission is asked for a full table: its seats' sessions and address keys, its units, and when it began to wait. */
  private startRequestOf(t: Table, now: number): StartRequest {
    return {
      table: t.id, source: t.source, seats: t.size, units: t.units, sessions: t.seats.map((s) => s.session!),
      addressKeys: [...new Set(t.seats.map((s) => s.key).filter((k) => k !== ''))], since: t.waitingSince ?? now,
    };
  }

  /**
   * Every seat is taken: ask admission (or apply its `decision`, when the restart asked for many tables at once). Returns the refusal (the last join is
   * undone by the caller), or null.
   */
  private requestStart(t: Table, now: number, decision?: AdmissionDecision): TableReply | null {
    const d = decision ?? this.o.admission.request(this.startRequestOf(t, now), now);
    if (d.kind === 'admitted') {
      this.startReadyCheck(t, now);
      return null;
    }
    if (d.kind === 'waiting') {
      t.status = 'waitingCapacity';
      t.waitingSince ??= now;
      this.setQueue(t, { kind: 'capacity', table: t.id, position: d.position, unitsAhead: d.unitsAhead, estimatedWaitMs: d.estimatedWaitMs }, now, true);
      void this.persist(t).catch(() => undefined);
      this.listingChanged(t);
      this.sendViews(t);
      this.gauges();
      return null;
    }
    if (d.reason === 'draining') return err('draining', 'The server is restarting soon; no new games now.');
    if (d.reason === 'queueFull') return err('serverBusy', 'The server is busy; please try again in a few minutes.', { retryAfterMs: d.retryAfterMs });
    return err('busy', 'A player at this table already waits for another game to start.', { retryAfterMs: d.retryAfterMs });
  }

  private setQueue(t: Table, q: QueueStatus | null, now: number, force = false): void {
    t.queue = q;
    if (!q) return;
    if (!force && now - t.queueSentAt < HOSTED_TIMING.queueStatusEveryMs) return;
    t.queueSentAt = now;
    for (const s of t.seats) if (s.session) this.o.send(s.session, { t: 'queueStatus', queue: q });
  }

  private startReadyCheck(t: Table, now: number): void {
    t.status = 'readyCheck';
    t.admitted = true;
    t.queue = null;
    t.readyCheck = { start: shortId(), deadline: now + this.readyCheckMs };
    for (const s of t.seats) s.ready = false;
    this.listingChanged(t);
    this.sendReadyCheck(t);
    this.sendViews(t);
    this.gauges();
  }

  private sendReadyCheck(t: Table, only?: string): void {
    if (!t.readyCheck) return;
    const m: HostedServerMessage = {
      t: 'readyCheck', start: t.readyCheck.start, deadlineAt: t.readyCheck.deadline,
      players: t.seats.map((s) => ({ seat: s.seat, name: s.name ?? '', ready: s.ready })),
    };
    for (const s of t.seats) if (s.session && (!only || only === s.session)) this.o.send(s.session, m);
  }

  /** A ready check ran out: the seats that did not confirm are stood up (the creator: the table closes); the rest go back to the lobby. */
  private async readyFailed(t: Table): Promise<void> {
    const missing = t.seats.filter((s) => !s.ready && s.session);
    t.readyCheck = null;
    this.release(t, this.now(), 'readyCheck'); // admission counts the failure (M13-10: it alone owns readyCheckFailures)
    for (const s of t.seats) if (s.session) this.o.send(s.session, { t: 'notice', kind: 'readyCheckFailed', text: 'Not every player confirmed in time; the table is open again.' });
    t.status = 'lobby';
    t.waitingSince = null;
    // The seats that did confirm are back in the lobby: their confirmation belongs to the check that failed.
    for (const s of t.seats) s.ready = false;
    if (t.creator !== null && missing.some((s) => s.seat === t.creator)) {
      this.close(t, 'tableClosed', 'The creator did not confirm in time: the table is closed.');
      return;
    }
    for (const s of missing) this.clearSeat(t, s);
    t.expiresAt = this.now() + this.lobbyExpiryMs;
    await this.persist(t).catch(() => undefined);
    this.listingChanged(t);
    this.sendViews(t);
    this.gauges();
  }

  /** Every seat confirmed: the game is created on a game worker. */
  private async begin(t: Table): Promise<void> {
    t.starting = true;
    try {
      await t.persisting.catch(() => undefined);
      // After a restart the decks are prepared again (the deck pool's deck is not stored).
      for (const s of t.seats) {
        if (s.prepared || !s.deck) continue;
        const r = await this.prepare(s.deck, t.format);
        if (r.ok) s.prepared = r.deck;
      }
      const bad = t.seats.filter((s) => !s.prepared || !s.session || !s.deckHash);
      if (bad.length) {
        t.starting = false;
        this.close(t, 'tableClosed', "A player's deck could not be prepared again: the table is closed.");
        return;
      }
      const seats: StartSeat[] = t.seats.map((s) => ({ seat: s.seat, name: s.name!, session: s.session!, account: null, deck: s.prepared!, deckHash: s.deckHash! }));
      const connected = t.seats.filter((s) => this.o.isConnected(s.session!)).map((s) => s.seat);
      // Routed before the start resolves: the first views are delivered inside it.
      t.status = 'playing';
      t.readyCheck = null;
      const r = await this.o.runtime.start({
        game: t.id, format: t.format, source: t.source, seats, clock: t.clock, connected, ...(this.o.limits ? { limits: this.o.limits } : {}),
      });
      t.starting = false;
      if (!r.ok) {
        this.release(t, this.now(), 'startFailed');
        t.status = 'lobby';
        this.logger.log('warn', 'tableStartFailed', { game: t.id, reason: r.reason });
        this.close(t, r.reason === 'draining' ? 'serverDraining' : 'tableClosed', startFailureText(r.reason));
        return;
      }
      t.admitted = false;
      // design 4.3: the password is deleted with the table (the store cleared it from the row when the game started)
      t.passwordHash = null;
      t.passwordSalt = null;
      this.o.admission.begun(t.id, this.now());
      for (const s of t.seats) s.ready = false;
      this.listingChanged(t);
      this.sendViews(t);
      this.gauges();
      this.logger.log('info', 'tableStarted', { game: t.id, format: t.format, seats: t.size, worker: r.worker });
    } catch (e) {
      t.starting = false;
      this.logger.log('error', 'tableStartError', { game: t.id, error: e instanceof Error ? e.name : 'error' });
      if (t.status !== 'over') {
        this.release(t, this.now(), 'startFailed');
        this.close(t, 'tableClosed', 'The game could not start on the server.');
      }
    }
  }

  /** An admitted start that did not begin (its ready check failed, a seat left, the table closed): its reserved units are free again, once. */
  private release(t: Table, now: number = this.now(), cause?: ReleaseCause): void {
    if (!t.admitted) return;
    t.admitted = false;
    this.handle(this.o.admission.released(t.id, now, cause));
  }

  /** Admission's events that came outside a step (`CapacityAdmission`'s `onEvents`: a `withdraw` or `begun` admitted the next head at once). */
  admissionEvents(events: readonly AdmissionEvent[]): void {
    this.handle(events);
  }

  /** Admission's events: admitted heads start their ready check; expired waits go back to the lobby; new positions are shown. */
  private handle(events: readonly AdmissionEvent[]): void {
    const now = this.now();
    for (const e of events) {
      const t = this.tables.get(e.table);
      if (!t || t.closed) continue;
      if (e.kind === 'admitted') {
        if (t.status === 'waitingCapacity' || t.status === 'lobby') this.startReadyCheck(t, now);
      } else if (e.kind === 'expired') {
        // Only a table that waits can run out of waiting: a late event for one that started (or never waited) must not take its game from it.
        if (t.status !== 'waitingCapacity') continue;
        t.status = 'lobby';
        t.queue = null;
        t.waitingSince = null;
        t.expiresAt = now + this.lobbyExpiryMs;
        for (const s of t.seats) {
          if (s.session) this.o.send(s.session, { t: 'notice', kind: 'capacityTimeout', text: 'The server is busy; please try again in a few minutes.' });
        }
        void this.persist(t).catch(() => undefined);
        this.listingChanged(t);
        this.sendViews(t);
      } else if (e.kind === 'position' && t.status === 'waitingCapacity') {
        this.setQueue(t, { kind: 'capacity', table: t.id, position: e.position, unitsAhead: e.unitsAhead, estimatedWaitMs: e.estimatedWaitMs }, now);
      }
    }
    this.gauges();
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Seats and tables

  private tableOf(session: string): Table | null {
    const id = this.bySession.get(session);
    return (id ? this.tables.get(id) : undefined) ?? null;
  }

  private unstarted(t: Table): boolean {
    return !t.closed && (t.status === 'lobby' || t.status === 'waitingCapacity' || t.status === 'readyCheck');
  }

  private listed(t: Table): boolean {
    return t.source === 'listed' && t.status === 'lobby' && !t.closed;
  }

  /** A seated session stands up before the start (the creator closes the table). */
  private async standUp(t: Table, s: SeatState, _why: null): Promise<void> {
    if (t.creator !== null && s.seat === t.creator) {
      this.close(t, 'tableClosed', 'The creator closed the table.');
      return;
    }
    const now = this.now();
    if (t.status === 'waitingCapacity') this.o.admission.withdraw(t.id, now);
    this.release(t, now, 'left');
    t.status = 'lobby';
    t.queue = null;
    t.readyCheck = null;
    t.waitingSince = null;
    for (const x of t.seats) x.ready = false;
    this.clearSeat(t, s);
    await this.persist(t).catch(() => undefined);
    this.listingChanged(t);
    this.sendViews(t);
    this.gauges();
  }

  private clearSeat(t: Table, s: SeatState): void {
    if (s.session && this.bySession.get(s.session) === t.id) this.bySession.delete(s.session);
    Object.assign(s, { session: null, name: null, key: '', deck: null, prepared: null, deckHash: null, joinedAt: null, ready: false });
    // A private table's reopened seat has no code until the creator asks for new codes (the server cannot show the old ones again).
  }

  /** Closes an unstarted table: a notice to every seated session, the table voided in the store ('abandoned', no ledger row). */
  private close(t: Table, kind: NoticeKind, text: string): void {
    if (t.closed) return;
    const now = this.now();
    if (t.status === 'waitingCapacity') this.o.admission.withdraw(t.id, now);
    this.release(t, now, 'closed');
    t.closed = true;
    for (const s of t.seats) if (s.session) this.o.send(s.session, { t: 'notice', kind, text });
    const id = t.id;
    t.persisting = t.persisting
      .catch(() => undefined)
      .then(() => this.o.store.voidGame(id, 'abandoned'))
      .catch((e: unknown) => this.logger.log('warn', 'tableCloseFailed', { game: id, error: e instanceof Error ? e.name : 'error' }));
    this.remove(t);
    this.logger.log('info', 'tableClosed', { game: id, kind });
  }

  private remove(t: Table): void {
    t.closed = true;
    this.tables.delete(t.id);
    for (const s of t.seats) {
      if (s.inviteHash) this.codes.delete(s.inviteHash);
      if (s.session && this.bySession.get(s.session) === t.id) this.bySession.delete(s.session);
    }
    if (t.source === 'listed') this.sink(t.id, null);
    this.gauges();
  }

  /** Writes the table's lobby row (one write at a time per table; each writes the table as it is when it runs). */
  private persist(t: Table): Promise<void> {
    const run = async (): Promise<void> => {
      if (t.closed || !this.unstarted(t)) return;
      await this.o.store.updateLobby(t.id, {
        seatRows: this.seatRows(t),
        status: t.waitingSince !== null ? 'waitingCapacity' : 'lobby',
        waitingSince: t.waitingSince !== null ? new Date(t.waitingSince) : null,
      });
    };
    const p = t.persisting.catch(() => undefined).then(run);
    t.persisting = p.catch((e: unknown) => this.logger.log('warn', 'tableSaveFailed', { game: t.id, error: e instanceof Error ? e.name : 'error' }));
    return p;
  }

  private seatRows(t: Table): SeatRow[] {
    return t.seats.map((s) => ({
      seat: s.seat, player: null, session: s.session, name: s.name, deck: s.deck, deckHash: s.deckHash, inviteHash: s.inviteHash,
      joinedAt: s.joinedAt !== null ? new Date(s.joinedAt) : null, leftAt: null,
    }));
  }

  /** `session`: the session asking (F32: its deck checks are paced); none for the server's own (a restart's lobby decks). */
  private async prepare(deck: HostedDeck, format: string, session?: string): Promise<{ ok: true; deck: PreparedDeck; hash: string } | { ok: false; reply: TableReply }> {
    let r: DeckResult;
    try {
      r = await this.o.runtime.prepare(deck, format, session);
    } catch {
      return { ok: false, reply: err('busy', 'The deck check failed; try again.') };
    }
    if (r.ok) return { ok: true, deck: r.deck, hash: preparedDeckHash(this.o.ledgerSecret, r.deck) };
    if ('rateLimited' in r) return { ok: false, reply: err('rateLimited', 'You are checking decks too often; wait a moment.', { retryAfterMs: r.retryAfterMs }) };
    if ('busy' in r) return { ok: false, reply: err('busy', 'The server is busy checking decks; try again shortly.', { retryAfterMs: 2_000 }) };
    if ('timeout' in r) return { ok: false, reply: err('busy', 'The deck check took too long; try again.') };
    return { ok: false, reply: err('deckRejected', 'The deck is not legal for this table.', { details: r.errors.slice(0, 50) }) };
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // What players see

  private view(t: Table, session: string | null): TableView {
    const you = session ? (t.seats.find((s) => s.session === session)?.seat ?? null) : null;
    const seats: SeatView[] = t.seats.map((s) => ({
      seat: s.seat, name: s.name, connected: s.session !== null && this.o.isConnected(s.session), deckAccepted: s.deckHash !== null, ready: s.ready, left: s.left,
    }));
    return {
      table: t.id, title: t.title, format: t.format, variant: commanderVariantOf(t.format), source: t.source, status: t.status, seats,
      locked: t.passwordHash !== null, clock: t.clock, you, creator: t.creator, createdAt: t.createdAt,
    };
  }

  private sendViews(t: Table): void {
    if (t.closed) return;
    for (const s of t.seats) if (s.session && this.bySession.get(s.session) === t.id) this.o.send(s.session, { t: 'table', table: this.view(t, s.session) });
  }

  private listingOf(t: Table): LobbyListing {
    return {
      table: t.id, title: t.title, format: t.format, variant: commanderVariantOf(t.format), seats: t.size, filled: t.seats.filter((s) => s.session !== null).length,
      locked: t.passwordHash !== null, clock: t.clock, creator: t.creatorName, ranked: false, createdAt: t.createdAt,
    };
  }

  private listingChanged(t: Table): void {
    if (!this.o.listings || t.source !== 'listed') return;
    this.sink(t.id, this.listed(t) ? this.listingOf(t) : null);
  }

  /** The listing sink is another package's: a failure there is logged and never stops a table's own command. */
  private sink(table: string, listing: LobbyListing | null): void {
    try {
      this.o.listings?.changed(table, listing);
    } catch (e) {
      this.logger.log('error', 'listingSinkError', { game: table, error: e instanceof Error ? e.name : 'error' });
    }
  }

  private gauges(): void {
    const c = this.counts();
    for (const [status, n] of Object.entries(c)) this.metrics.set(METRICS.tables, n, { status });
  }
}
