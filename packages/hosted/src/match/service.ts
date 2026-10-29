/**
 * `MatchmakingService`, the gateway's `MatchService` (design 4.5, 4.6; package M13-13 wiring of M13-9's matcher): the unranked quick match as the gateway
 * runs it. It follows the header of `./index.ts` step by step: `queue` checks the deck with the deck pool and enters `FifoMatcher`; a tick every second
 * (and at once after an entry) forms the due matches; each match asks capacity admission for its start, then runs one ready check (15 s), then starts a
 * `matched` game; a failed ready check goes to `settleReadyCheck` (the confirmers back to the front of the queue, the others out with a miss); a drain
 * empties the queues with a `queueLost` notice to each.
 *
 * - **What it needs of the others** is small and named: the gateway's `SessionLink` (send to a session, who is connected, whether it drains:
 *   `gateway/hooks.ts`, given through `MatchService.attach`), `MatchTables` (the tables layer's `busyIn` and `adopt`, which `Tables` already has), the runtime
 *   (`prepare`, `start`), the store (`createGame`, `voidGame`, `sessionResults`) and admission. Nothing else of the tables layer is touched.
 * - **The matched table is the service's own until its game starts**: the tables layer has no way to create a matched table (it creates tables from
 *   `create` and `join`, and its ready check is the 30 s table one whose failure reopens a seat), so the service keeps the match (who, their decks, the
 *   ready check, the wait for capacity) in memory and sends the same messages a table does (`table` with `source: 'matched'`, `readyCheck`, `queueStatus`).
 *   The `games` row is made when the ready check passes, right before the runtime starts the game; after the start `Tables.adopt` gives the game its seats'
 *   routes (`seatOf`, the runtime's deliveries, `ended` freeing the units), as it does for a game recovered after a restart. The runtime's first deliveries
 *   come inside `start`, before those routes exist: `intercept` keeps them and `adopt` is followed by their delivery in order.
 * - **Admission's events** for a matched table (admitted, expired, position) come out of `Admission.tick`, `freed` and `released`, which the tables layer
 *   calls and handles for its own tables only. `MatchAdmission` stands between: it takes the events of matched tables out, gives them to the service, and
 *   hands the rest on unchanged, so each layer sees exactly its own tables' events (main.ts builds it, and passes it to both).
 * - **Disconnected sessions**: a queued session with no connection is not matched (it keeps its place); gone for `graceMs` it leaves the queue. A match
 *   member gone for `readyGraceMs` during the ready check fails it as a leaver; gone `graceMs` while the start waits for capacity it leaves too. A session
 *   that comes back is sent its state again (queue status, table, ready check).
 * - **Not here**: the match's restart order. The queues and matches are in memory (design 4.5: after a restart, queued clients re-queue); a matched table's
 *   row exists only once its ready check passed, so a restart in the capacity wait or a ready check leaves nothing to restore.
 */
import type { PreparedDeck } from '@openmtg/net/server-kit';
import { commanderVariantOf } from '@openmtg/net/server-kit';
import {
  HOSTED_TIMING, type HostedDeck, type HostedError, type HostedFormatId, type HostedServerMessage, type NoticeKind, type QueueMessage, type QueueStatus, type SeatNumber,
  type TableStatus, type TableView,
} from '../api';
import type { Admission, AdmissionDecision, AdmissionEvent, QueueStanding, ReleaseCause, StartRequest } from '../admission/api';
import { clockFor, type HostedConfig } from '../config';
import { shortId, ulid } from '../gateway/ids';
import type { MatchService } from '../gateway/hooks';
import { preparedDeckHash } from '../ledger/fingerprint';
import { NULL_LOGGER, NULL_METRICS, type Logger, type Metrics } from '../obs';
import type { DeckResult, Runtime, StartSeat } from '../runtime/api';
import type { GameStore } from '../store/api';
import type { SeatSend } from '../table/types';
import type { TableReply, Who } from '../tables/tables';
import type { EnterRefusal, Match, MatchEntry, QueueKey } from './api';
import { queueKeyString } from './api';
import { FifoMatcher } from './fifo';
import { matchPolicyFor, offeredQueues } from './policy';
import { matchStartRequest, MatchReadyCheck, settleReadyCheck, type ReadyOutcome } from './start';

/**
 * What the gateway lets the service do with sessions (INTERFACE CHANGE, M13-13: the gateway gives it through `attach`, once, at its construction; hooks.ts
 * does not name it yet).
 */
export interface SessionLink {
  /** To the session's connection, if it has one (the gateway's outbound budget applies; dropped when there is none). */
  send(session: string, msg: HostedServerMessage): void;
  /** The session has a connection now. */
  isConnected(session: string): boolean;
  /** The session's connection (an id that is new for each connection), or null: a session that reconnected is told its state again. */
  connection(session: string): number | null;
  /** A drain has begun (design 2.3): no new games start. */
  draining(): boolean;
}

/** The title of every matched table (it has no creator to name one). */
export const MATCH_TITLE = 'Quick match';

/** The parts of the tables layer the service uses; `Tables` has them all (it has no way to make a matched table, which is why the service keeps its own). */
export interface MatchTables {
  /** The table the session sits at now (any status but over), or null. */
  busyIn(session: string): string | null;
  /** A started game's seats take their routes (the runtime's deliveries find them, the game's end frees its units): `Tables.adopt`. */
  adopt(game: string): Promise<boolean>;
  /** A seat's connection came back or dropped while the game started (`Tables.connected`, `Tables.disconnected`): the table is told. */
  connected(session: string): void;
  disconnected(session: string): void;
}

/** The times of the service (milliseconds); the design's, tests shorten them. */
export interface MatchTiming {
  /** The ready check's length (15 s for a match). */
  readyCheckMs: number;
  /** `queueStatus` to a queued session at most this often (5 s). */
  queueStatusEveryMs: number;
  /** A queued session (or a match member while the start waits for capacity) with no connection for this long leaves. */
  graceMs: number;
  /** A match member with no connection for this long during the ready check leaves it. */
  readyGraceMs: number;
  /** A match capacity admission refused is tried again after this long (its members are skipped meanwhile; nobody loses their place). */
  refusedBackoffMs: number;
  /** The last game's opponents count for the rematch rule for this long. */
  recentMs: number;
  /** The timer's period (`start`). */
  tickMs: number;
}

export const DEFAULT_MATCH_TIMING: Readonly<MatchTiming> = {
  readyCheckMs: HOSTED_TIMING.readyCheckMatchMs,
  queueStatusEveryMs: HOSTED_TIMING.queueStatusEveryMs,
  graceMs: 30_000,
  readyGraceMs: 5_000,
  refusedBackoffMs: 5_000,
  recentMs: 30 * 60_000,
  tickMs: 1_000,
};

export interface MatchServiceOptions {
  config: Pick<HostedConfig, 'formats' | 'podsEnabled' | 'podThreeAfterSeconds' | 'clocks' | 'units'>;
  store: Pick<GameStore, 'createGame' | 'voidGame' | 'sessionResults'>;
  runtime: Pick<Runtime, 'prepare' | 'start'>;
  /** The admission the gateway and tables use, as `MatchAdmission` gives it (the matched tables' events come to `onAdmission`). */
  admission: Admission;
  tables: MatchTables;
  /** The runtime's deliveries once a started game's seats have their routes (`gateway.events.deliver`). */
  deliver: (game: string, sends: readonly SeatSend[]) => void;
  /** Admission events of the tables layer's own tables that came back from a call the service made (`gateway.tables.admissionEvents`). */
  foreign: (events: readonly AdmissionEvent[]) => void;
  /** The deck fingerprints' key (`ledgerSecret`). */
  ledgerSecret: string;
  now?: () => number;
  timing?: Partial<MatchTiming>;
  logger?: Logger;
  metrics?: Metrics;
}

/** A member of a queue entry or a match: what the service keeps of the session besides the matcher's entry. */
interface Member {
  session: string;
  name: string;
  deck: HostedDeck;
  prepared: PreparedDeck;
  deckHash: string;
}

type Phase = 'waiting' | 'ready' | 'starting' | 'gone';

/** A match from the moment it forms until its game has started or it came apart. */
interface Formed {
  table: string;
  match: Match;
  phase: Phase;
  formedAt: number;
  /** Where the start waits in the capacity queue (phase 'waiting'). */
  standing: QueueStanding | null;
  check: MatchReadyCheck | null;
  start: string | null;
  /** The members' display names by session (the match outlives the service's hold on the members: the final `table` is sent after it let go). */
  names: ReadonlyMap<string, string>;
}

function failWith(message: string): never {
  throw new Error(message);
}

const err = (code: HostedError['code'], message: string, extra: Partial<HostedError> = {}): TableReply => ({ ok: false, error: { code, message, ...extra } });

/** What a refused `enter` means to the player (design 4.5; the header of ./index.ts). */
function refusal(r: EnterRefusal, key: QueueKey, podsEnabled: boolean, cooldownMs: number): TableReply {
  switch (r) {
    case 'inQueue':
      return err('busy', 'You are in the queue already.');
    case 'atTable':
      return err('busy', 'You already take part in a game (one at a time).');
    case 'address':
      return err('limitReached', 'Your network already has two players in the queue.');
    case 'cooldown':
      return err('limitReached', 'You missed two ready checks: queuing is paused for a few minutes.', { retryAfterMs: Math.max(1, cooldownMs) });
    case 'notOffered':
      return key.size === 'pod' && !podsEnabled
        ? err('notYet', 'Pod queues (3 or 4 players) are not open on this server yet.')
        : err('notAllowed', 'This server does not offer that queue.');
  }
}

export class MatchmakingService implements MatchService {
  private readonly now: () => number;
  private readonly timing: MatchTiming;
  private readonly logger: Logger;
  private readonly matcher: FifoMatcher;
  private link: SessionLink | null = null;
  /** The time of the step in progress (the matcher's `matchable` asks about it). */
  private clock = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private drained = false;

  /** Every session the service holds a deck for: queued, or a member of a match that has not started. */
  private readonly members = new Map<string, Member>();
  private readonly formed = new Map<string, Formed>();
  private readonly inFormed = new Map<string, Formed>();
  private readonly byStart = new Map<string, Formed>();
  /** When a session lost its connection (queued or in a match), until it has one again. */
  private readonly away = new Map<string, number>();
  /** The connection each session had when the service last looked: a different one means it came back (and is told its state again). */
  private readonly seenConn = new Map<string, number>();
  /** The `queueStatus` last sent to a queued session, and when. */
  private readonly shown = new Map<string, { at: number; text: string }>();
  /** Matches a start's refusal sent back: their members are not tried again before this time. */
  private readonly skip = new Map<string, number>();
  /** The sessions a session last played (matches begun by this service), for the rematch rule. */
  private readonly lastOpponents = new Map<string, { with: string[]; at: number }>();
  /** The runtime's deliveries for a game that is starting, kept until its seats have their routes. */
  private readonly early = new Map<string, SeatSend[]>();
  /** Admission events for matched tables, handled one batch at a time (a handler may cause more). */
  private eventQueue: AdmissionEvent[] = [];
  private handlingEvents = false;

  constructor(private readonly o: MatchServiceOptions) {
    this.now = o.now ?? Date.now;
    this.timing = { ...DEFAULT_MATCH_TIMING, ...o.timing };
    this.logger = o.logger ?? NULL_LOGGER;
    this.matcher = new FifoMatcher(
      {
        sessionBusy: (s) => this.inFormed.has(s) || o.tables.busyIn(s) !== null || o.admission.hasWaitingSession(s),
        offered: offeredQueues(o.config),
        policy: matchPolicyFor(o.config),
      },
      { metrics: o.metrics ?? NULL_METRICS, matchable: (s) => this.link?.isConnected(s) === true && (this.skip.get(s) ?? 0) <= this.clock },
    );
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The MatchService seam (gateway/hooks.ts)

  attach(link: SessionLink): void {
    this.link = link;
  }

  async queue(who: Who, m: QueueMessage): Promise<TableReply> {
    const key: QueueKey = { format: m.format, size: m.size };
    const early = this.refusedEarly(who, key, this.now());
    if (early) return early;
    const deck = await this.prepare(m.deck, m.format, who.session);
    if (!deck.ok) return deck.reply;
    const opponents = await this.opponentsOf(who.session);
    // The awaits above let anything happen (a drain among it): `enter` checks again, in its own order.
    if (this.drained || this.link?.draining()) return err('draining', 'The server is restarting soon; no new games now.');
    const now = this.now();
    this.clock = now;
    const entry: MatchEntry = { session: who.session, addressKey: who.key || who.session, key, deck: deck.hash, enteredAt: now, recentOpponents: opponents };
    const refused = this.matcher.enter(entry, now);
    if (refused !== null) return refusal(refused, key, this.o.config.podsEnabled, this.matcher.cooldownLeftMs(who.session, now));
    this.members.set(who.session, { session: who.session, name: who.name, deck: m.deck, prepared: deck.deck, deckHash: deck.hash });
    this.away.delete(who.session);
    this.noteConnection(who.session);
    this.sendStatus(who.session, now, true);
    // The match (if this entry makes one) forms after the reply has gone out: a client hears "queued" before "ready check".
    setImmediate(() => this.guarded('process', () => this.process(this.now())));
    return { ok: true, ...(deck.deck.warnings.length > 0 ? { warnings: deck.deck.warnings } : {}) };
  }

  async unqueue(who: Who): Promise<TableReply | null> {
    const now = this.now();
    this.clock = now;
    if (this.matcher.leave(who.session)) {
      this.forget(who.session);
      return { ok: true };
    }
    const f = this.inFormed.get(who.session);
    if (!f) return null;
    if (f.phase === 'starting') return err('busy', 'The game is starting.');
    if (f.phase === 'ready' && f.check) {
      f.check.leave(who.session, now);
      this.settle(f, now);
    } else this.leaveWaiting(f, who.session, now);
    return { ok: true };
  }

  ready(who: Who, start: string): TableReply | null {
    const f = this.byStart.get(start);
    if (!f || f.phase !== 'ready' || !f.check || this.inFormed.get(who.session) !== f) return null;
    const now = this.now();
    this.clock = now;
    const counted = f.check.confirm(who.session, now);
    if (counted) {
      this.sendReady(f);
      this.sendTable(f);
    }
    this.settle(f, now);
    return counted ? { ok: true, table: f.table } : err('notAllowed', 'The ready check is over.');
  }

  busy(session: string): boolean {
    return this.matcher.queued(session) !== null || this.inFormed.has(session);
  }

  /** What the service holds now (tests: it stays as small as the traffic): sessions with a deck, matches not yet started, deliveries kept for a start. */
  get held(): { sessions: number; matches: number; early: number } {
    return { sessions: this.members.size, matches: this.formed.size, early: this.early.size };
  }

  /**
   * The gateway has forgotten the session for good (`MatchService.gone`, its idle sweep): it leaves the queue; a match it was in comes apart as if it had
   * left (a ready check fails with it as the leaver, a wait for capacity ends, the others go back to the front). A game that is starting goes on.
   */
  gone(session: string): void {
    const now = this.now();
    this.clock = now;
    this.guarded('gone', () => {
      if (this.matcher.leave(session)) return this.forget(session);
      const f = this.inFormed.get(session);
      if (!f) return this.forget(session);
      if (f.phase === 'ready' && f.check) {
        f.check.leave(session, now);
        this.settle(f, now);
      } else if (f.phase === 'waiting') this.leaveWaiting(f, session, now);
    });
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Time

  /** Runs once a second (`start`): reconnections and drops, ready-check deadlines, new matches, `queueStatus`. */
  tick(now: number = this.now()): void {
    this.clock = now;
    if (!this.drained && this.link?.draining()) this.drain();
    this.guarded('watch', () => this.watch(now));
    this.guarded('deadlines', () => {
      for (const f of [...this.formed.values()]) if (f.phase === 'ready') this.settle(f, now);
    });
    this.guarded('process', () => this.process(now));
    this.guarded('status', () => this.statuses(now));
    this.prune(now);
  }

  /** Starts the timer (`tickMs`). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.timing.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * A drain (design 2.3): no new queue entries or matches; every queued session and every member of a match that has not started is told (`queueLost`),
   * and the waiting starts leave admission. A game that is starting goes on (the runtime refuses it if it is draining by then).
   */
  drain(): void {
    if (this.drained) return;
    this.drained = true;
    const now = this.now();
    for (const e of this.matcher.drain()) this.lost(e.session, 'The server is restarting soon: you are no longer in the queue. Please queue again in a few minutes.');
    for (const f of [...this.formed.values()]) {
      if (f.phase === 'starting' || f.phase === 'gone') continue;
      this.release(f, now, 'closed');
      this.dissolve(f);
      for (const e of f.match.entries) this.lost(e.session, 'The server is restarting soon: your match was cancelled. Please queue again in a few minutes.');
    }
    this.logger.log('info', 'matchDrained', {});
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Admission's events and the runtime's deliveries

  /** Whether `table` is a match the service holds (`MatchAdmission` gives its events to `onAdmission`). */
  owns(table: string): boolean {
    return this.formed.has(table);
  }

  /** Admission events for matched tables: a head admitted, a wait that ran out, a new place in the queue. */
  onAdmission(events: readonly AdmissionEvent[]): void {
    this.eventQueue.push(...events);
    if (this.handlingEvents) return;
    this.handlingEvents = true;
    try {
      while (this.eventQueue.length > 0) {
        const e = this.eventQueue.shift()!;
        this.guarded('admission', () => this.onEvent(e, this.now()));
      }
    } finally {
      this.handlingEvents = false;
    }
  }

  /**
   * The runtime's deliveries (main.ts calls it first): those of a game this service is starting are kept (true); the others go on to the gateway. Kept
   * ones are delivered, in order, once the game's seats have their routes (`start`).
   */
  intercept(game: string, sends: readonly SeatSend[]): boolean {
    const held = this.early.get(game);
    if (!held) return false;
    held.push(...sends);
    return true;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Matches

  /** Forms the matches due now and puts each through admission. */
  private process(now: number): void {
    this.clock = now;
    for (const match of this.matcher.tick(now)) this.form(match, now);
  }

  private form(match: Match, now: number): void {
    const names = new Map(match.entries.map((e) => [e.session, this.members.get(e.session)?.name ?? ''] as const));
    const f: Formed = { table: ulid(now), match, phase: 'waiting', formedAt: now, standing: null, check: null, start: null, names };
    this.formed.set(f.table, f);
    for (const e of match.entries) this.inFormed.set(e.session, f);
    this.logger.log('info', 'matchFormed', { game: f.table, format: match.key.format, seats: match.seats });
    const request: StartRequest = matchStartRequest(match, f.table, now, this.o.config.units);
    this.decided(f, this.o.admission.request(request, now), now);
  }

  private decided(f: Formed, d: AdmissionDecision, now: number): void {
    if (d.kind === 'admitted') return this.readyCheck(f, now);
    if (d.kind === 'waiting') {
      f.standing = { position: d.position, unitsAhead: d.unitsAhead, estimatedWaitMs: d.estimatedWaitMs };
      this.sendTable(f);
      this.sendCapacity(f);
      return;
    }
    // refused: the match comes apart at once (no row, no notice but a drain's); the members keep their places and are tried again later
    this.dissolve(f);
    if (d.reason === 'draining') {
      for (const e of f.match.entries) this.lost(e.session, 'The server is restarting soon: you are no longer in the queue. Please queue again in a few minutes.');
      return;
    }
    for (const e of f.match.entries) this.skip.set(e.session, now + this.timing.refusedBackoffMs);
    this.matcher.requeueFront(f.match.entries, now);
    this.logger.log('info', 'matchRefused', { game: f.table, cause: d.reason });
  }

  /** Admission let the start in: every seat is asked to confirm (15 s). */
  private readyCheck(f: Formed, now: number): void {
    f.phase = 'ready';
    f.standing = null;
    f.start = shortId();
    f.check = new MatchReadyCheck(f.match, now, this.timing.readyCheckMs);
    this.byStart.set(f.start, f);
    this.sendTable(f);
    this.sendReady(f);
  }

  /** The ready check's outcome, if it has one: the game starts, or the check failed. */
  private settle(f: Formed, now: number): void {
    const o = f.check?.poll(now) ?? null;
    if (o === null) return;
    if (o.kind === 'start') this.begin(f);
    else this.failed(f, o, now);
  }

  /**
   * A ready check failed (design 4.5): admission counts it ('readyCheck' for a time-out, 'left' for a seat that left; it owns the metric), then the
   * misses are recorded and the others go back to the front of their queue, their waiting time kept.
   */
  private failed(f: Formed, o: Extract<ReadyOutcome, { kind: 'failed' }>, now: number): void {
    this.release(f, now, o.reason === 'timeout' ? 'readyCheck' : 'left');
    this.dissolve(f);
    settleReadyCheck(this.matcher, o, now);
    this.logger.log('info', 'matchReadyFailed', { game: f.table, cause: o.reason, missed: o.missed.length });
    for (const e of o.missed) {
      this.forget(e.session);
      if (o.reason === 'timeout') this.notice(e.session, 'readyCheckFailed', 'You did not confirm in time: you left the queue.');
    }
    for (const e of o.requeue) {
      this.notice(e.session, 'readyCheckFailed', o.reason === 'timeout' ? 'Not every player confirmed in time: you are back in the queue.' : 'A player left before the game started: you are back in the queue.');
      this.sendStatus(e.session, now, true);
    }
    this.process(now);
  }

  /** A seat left while the start waits for capacity: no ready check was shown, so no miss; the others go back to the front. */
  private leaveWaiting(f: Formed, leaver: string, now: number): void {
    this.release(f, now, 'left');
    this.dissolve(f);
    this.forget(leaver);
    const stay = f.match.entries.filter((e) => e.session !== leaver);
    this.matcher.requeueFront(stay, now);
    for (const e of stay) {
      this.notice(e.session, 'tableClosed', 'A player left before the game started: you are back in the queue.');
      this.sendStatus(e.session, now, true);
    }
    this.process(now);
  }

  /** The ready check passed: the game's rows, then the runtime starts it, then its seats get their routes. */
  private begin(f: Formed): void {
    f.phase = 'starting';
    if (f.start !== null) this.byStart.delete(f.start);
    // (startGame answers for its own failures; what escapes it is logged, never thrown into the timer or a command)
    void this.startGame(f).catch((e: unknown) => this.logger.log('error', 'matchStartError', { game: f.table, error: e instanceof Error ? e.name : 'error' }));
  }

  private async startGame(f: Formed): Promise<void> {
    const { match, table } = f;
    const { format } = match.key;
    let members: Member[];
    let seats: StartSeat[];
    let connected: SeatNumber[];
    let r: Awaited<ReturnType<MatchServiceOptions['runtime']['start']>>;
    try {
      members = match.entries.map((e) => this.members.get(e.session) ?? failWith(`the member ${e.session} is gone`));
      seats = members.map((m, i) => ({ seat: (i + 1) as SeatNumber, name: m.name, session: m.session, account: null, deck: m.prepared, deckHash: m.deckHash }));
      const created = this.now();
      try {
        await this.o.store.createGame({
          id: table, format, variant: commanderVariantOf(format), seats: match.seats, source: 'matched', title: MATCH_TITLE, passwordHash: null, passwordSalt: null,
          createdAt: new Date(created),
          seatRows: members.map((m, i) => ({
            seat: (i + 1) as SeatNumber, player: null, session: m.session, name: m.name, deck: m.deck, deckHash: m.deckHash, inviteHash: null, joinedAt: new Date(created), leftAt: null,
          })),
        });
      } catch (e) {
        this.logger.log('error', 'matchCreateFailed', { game: table, error: e instanceof Error ? e.name : 'error' });
        return this.startFailed(f, 'busy', false);
      }
      connected = seats.filter((s) => this.link?.isConnected(s.session) === true).map((s) => s.seat);
      this.early.set(table, []);
      r = await this.o.runtime.start({ game: table, format, source: 'matched', seats, clock: clockFor(this.o.config.clocks, format, match.seats), connected });
    } catch (e) {
      this.logger.log('error', 'matchStartError', { game: table, error: e instanceof Error ? e.name : 'error' });
      return this.startFailed(f, 'failed', true);
    }
    if (!r.ok) {
      this.logger.log('warn', 'matchStartRefused', { game: table, cause: r.reason });
      return this.startFailed(f, r.reason === 'draining' ? 'draining' : 'failed', true);
    }
    await this.running(f, members, seats, connected);
  }

  /**
   * The runtime started the game. From here it runs whatever happens below: a step that fails is logged and the next one goes on, nothing undoes the start.
   * Admission is told (the reserved units are the runtime's now), the seats get their routes (`Tables.adopt`), the deliveries kept meanwhile go out in
   * order, and a seat whose connection changed during the start is told to the table.
   */
  private async running(f: Formed, members: readonly Member[], seats: readonly StartSeat[], connected: readonly SeatNumber[]): Promise<void> {
    const { table, match } = f;
    this.guarded('begun', () => this.o.admission.begun(table, this.now()));
    let adopted = false;
    try {
      adopted = await this.o.tables.adopt(table);
    } catch (e) {
      this.logger.log('error', 'matchAdoptError', { game: table, error: e instanceof Error ? e.name : 'error' });
    }
    if (!adopted) this.logger.log('error', 'matchAdoptFailed', { game: table });
    const held = this.early.get(table) ?? [];
    this.early.delete(table);
    this.guarded('deliver', () => this.o.deliver(table, held));
    const at = this.now();
    this.dissolve(f);
    for (const m of members) {
      this.lastOpponents.set(m.session, { with: members.filter((x) => x !== m).map((x) => x.session), at });
      this.forget(m.session);
    }
    for (const s of seats) {
      const up = this.link?.isConnected(s.session) === true;
      this.guarded('table', () => {
        this.sendTable(f, s.session, 'playing');
        if (adopted && up !== connected.includes(s.seat)) {
          if (up) this.o.tables.connected(s.session);
          else this.o.tables.disconnected(s.session);
        }
      });
    }
    this.logger.log('info', 'matchStarted', { game: table, format: match.key.format, seats: match.seats });
  }

  /**
   * The game could not start (the rows, or the runtime refused it): admission is told ('startFailed': the units are free), the row of a game that was
   * never run is voided, and the players, who all confirmed, go back to the front of their queue (a drain: out, with the notice).
   */
  private startFailed(f: Formed, why: 'busy' | 'failed' | 'draining', row: boolean): void {
    const now = this.now();
    this.early.delete(f.table);
    if (f.phase !== 'gone') this.release(f, now, 'startFailed');
    this.dissolve(f);
    if (row) void this.o.store.voidGame(f.table, 'abandoned').catch(() => undefined);
    if (why === 'draining') {
      for (const e of f.match.entries) this.lost(e.session, 'The server is restarting soon: you are no longer in the queue. Please queue again in a few minutes.');
      return;
    }
    this.matcher.requeueFront(f.match.entries, now);
    for (const e of f.match.entries) {
      this.notice(e.session, 'tableClosed', 'The game could not start on the server: you are back in the queue.');
      this.sendStatus(e.session, now, true);
    }
    this.process(now);
  }

  private onEvent(e: AdmissionEvent, now: number): void {
    const f = this.formed.get(e.table);
    if (!f) return;
    if (e.kind === 'admitted') {
      if (f.phase === 'waiting') this.readyCheck(f, now);
    } else if (e.kind === 'position') {
      if (f.phase !== 'waiting') return;
      f.standing = { position: e.position, unitsAhead: e.unitsAhead, estimatedWaitMs: e.estimatedWaitMs };
      this.sendCapacity(f);
    } else if (f.phase === 'waiting') {
      // the start waited past the longest wait (or the server drains): it is not in admission any more
      this.dissolve(f);
      if (e.cause === 'draining') {
        for (const x of f.match.entries) this.lost(x.session, 'The server is restarting soon: your match was cancelled. Please queue again in a few minutes.');
        return;
      }
      this.matcher.requeueFront(f.match.entries, now);
      for (const x of f.match.entries) {
        this.notice(x.session, 'capacityTimeout', 'The server is busy: your match waited too long. You are back in the queue.');
        this.sendStatus(x.session, now, true);
      }
      this.process(now);
    }
  }

  /** Ends admission's hold on an unstarted match (waiting: out of the queue; in its ready check: the reserved units are free); events go on to the tables. */
  private release(f: Formed, now: number, cause: ReleaseCause): void {
    if (f.phase === 'waiting') this.o.admission.withdraw(f.table, now);
    else if (f.phase === 'ready' || f.phase === 'starting') this.o.foreign(this.o.admission.released(f.table, now, cause));
  }

  /** A match is over as a match (started, or come apart): it holds nobody any more. The members' decks stay until each is forgotten. */
  private dissolve(f: Formed): void {
    f.phase = 'gone';
    this.formed.delete(f.table);
    if (f.start !== null) this.byStart.delete(f.start);
    for (const e of f.match.entries) if (this.inFormed.get(e.session) === f) this.inFormed.delete(e.session);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Connections

  /** Sessions that dropped or came back: a drop that lasts leaves the queue or the match; a session that is back is told where it is. */
  private watch(now: number): void {
    const link = this.link;
    if (!link) return;
    for (const [session] of [...this.members]) {
      const f = this.inFormed.get(session);
      const conn = link.connection(session);
      if (conn !== null) {
        this.away.delete(session);
        // another connection than the one the service last saw: the session came back (however fast), and is told where it is
        const known = this.seenConn.has(session);
        if (this.seenConn.get(session) !== conn) {
          this.seenConn.set(session, conn);
          if (known) this.resend(session, f ?? null, now);
        }
        continue;
      }
      const since = this.away.get(session);
      if (since === undefined) {
        this.away.set(session, now);
        continue;
      }
      const gap = now - since;
      if (f === undefined) {
        if (gap >= this.timing.graceMs && this.matcher.leave(session)) {
          this.forget(session);
          this.logger.log('info', 'matchQueueGone', {});
        }
      } else if (f.phase === 'ready' && gap >= this.timing.readyGraceMs && f.check) {
        f.check.leave(session, now);
        this.settle(f, now);
      } else if (f.phase === 'waiting' && gap >= this.timing.graceMs) this.leaveWaiting(f, session, now);
    }
  }

  /** The connection the session has now is the one the service has seen. */
  private noteConnection(session: string): void {
    const c = this.link?.connection(session) ?? null;
    if (c !== null) this.seenConn.set(session, c);
  }

  private resend(session: string, f: Formed | null, now: number): void {
    if (f === null) return this.sendStatus(session, now, true);
    this.sendTable(f, session);
    if (f.phase === 'waiting') this.sendCapacity(f, session);
    else if (f.phase === 'ready') this.sendReady(f, session);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Messages

  private send(session: string, msg: HostedServerMessage): void {
    this.link?.send(session, msg);
  }

  private notice(session: string, kind: NoticeKind, text: string): void {
    this.send(session, { t: 'notice', kind, text });
  }

  /** The session is out of the queue and every match for good (a drain): its deck is let go and it is told. */
  private lost(session: string, text: string): void {
    this.forget(session);
    this.notice(session, 'queueLost', text);
  }

  /** The service holds nothing more of the session (it left the queue, or its game started). */
  private forget(session: string): void {
    this.members.delete(session);
    this.away.delete(session);
    this.seenConn.delete(session);
    this.shown.delete(session);
    this.skip.delete(session);
  }

  /** `queueStatus` of a queued session's queue: at most one every 5 s, and only when it says something new (`force`: now). */
  private sendStatus(session: string, now: number, force: boolean, cache?: Map<string, QueueStatus>): void {
    const key = this.matcher.queued(session);
    if (key === null) return;
    const last = this.shown.get(session);
    if (!force && last && now - last.at < this.timing.queueStatusEveryMs) return;
    const ks = queueKeyString(key);
    let q = cache?.get(ks);
    if (!q) {
      const s = this.matcher.status(key, now);
      q = { kind: 'match', format: key.format, size: key.size, waiting: s.waiting, estimatedWaitMs: s.estimatedWaitMs };
      cache?.set(ks, q);
    }
    const text = JSON.stringify(q);
    if (!force && last?.text === text) return;
    this.shown.set(session, { at: now, text });
    this.send(session, { t: 'queueStatus', queue: q });
  }

  private statuses(now: number): void {
    const cache = new Map<string, QueueStatus>();
    for (const session of this.members.keys()) this.sendStatus(session, now, false, cache);
  }

  /** The capacity wait's `queueStatus` (position, units ahead, estimate) to every seat of the match, or to `only`. */
  private sendCapacity(f: Formed, only?: string): void {
    if (!f.standing) return;
    const q: QueueStatus = { kind: 'capacity', table: f.table, ...f.standing };
    for (const e of f.match.entries) if (only === undefined || only === e.session) this.send(e.session, { t: 'queueStatus', queue: q });
  }

  private sendReady(f: Formed, only?: string): void {
    if (!f.check || f.start === null) return;
    const players = f.check.players().map((p, i) => ({ seat: (i + 1) as SeatNumber, name: f.names.get(p.session) ?? '', ready: p.ready }));
    const m: HostedServerMessage = { t: 'readyCheck', start: f.start, deadlineAt: f.check.deadlineAt, players };
    for (const e of f.match.entries) if (only === undefined || only === e.session) this.send(e.session, m);
  }

  /** The match as a table (`TableView`, `source: 'matched'`) to every seat, or to `only`; `status` overrides the phase's (a started game is 'playing'). */
  private sendTable(f: Formed, only?: string, status?: TableStatus): void {
    const { key, seats } = f.match;
    const ready = new Map((f.check?.players() ?? []).map((p) => [p.session, p.ready] as const));
    const base = {
      table: f.table, title: MATCH_TITLE, format: key.format as HostedFormatId, variant: commanderVariantOf(key.format), source: 'matched' as const,
      status: status ?? (f.phase === 'waiting' ? 'waitingCapacity' : 'readyCheck'), locked: false, clock: clockFor(this.o.config.clocks, key.format, seats), creator: null, createdAt: f.formedAt,
    };
    f.match.entries.forEach((e, i) => {
      if (only !== undefined && only !== e.session) return;
      const view: TableView = {
        ...base,
        seats: f.match.entries.map((x, j) => ({
          seat: (j + 1) as SeatNumber, name: f.names.get(x.session) ?? null, connected: this.link?.isConnected(x.session) === true, deckAccepted: true,
          ready: ready.get(x.session) ?? false, left: false,
        })),
        you: (i + 1) as SeatNumber,
      };
      this.send(e.session, { t: 'table', table: view });
    });
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Entering

  /** The refusals that need no deck (design 4.5): checked first, so a refused session costs the deck pool nothing. */
  private refusedEarly(who: Who, key: QueueKey, now: number): TableReply | null {
    if (this.drained || this.link?.draining()) return err('draining', 'The server is restarting soon; no new games now.');
    if (this.matcher.queued(who.session) !== null) return refusal('inQueue', key, this.o.config.podsEnabled, 0);
    if (this.inFormed.has(who.session) || this.o.tables.busyIn(who.session) !== null || this.o.admission.hasWaitingSession(who.session)) return refusal('atTable', key, this.o.config.podsEnabled, 0);
    const cooldown = this.matcher.cooldownLeftMs(who.session, now);
    if (cooldown > 0) return refusal('cooldown', key, this.o.config.podsEnabled, cooldown);
    if (!offeredQueues(this.o.config)(key)) return refusal('notOffered', key, this.o.config.podsEnabled, 0);
    return null;
  }

  private async prepare(deck: HostedDeck, format: string, session: string): Promise<{ ok: true; deck: PreparedDeck; hash: string } | { ok: false; reply: TableReply }> {
    let r: DeckResult;
    try {
      r = await this.o.runtime.prepare(deck, format, session); // F32: paced per session in the deck pool
    } catch {
      return { ok: false, reply: err('busy', 'The deck check failed; try again.') };
    }
    if (r.ok) return { ok: true, deck: r.deck, hash: preparedDeckHash(this.o.ledgerSecret, r.deck) };
    if ('rateLimited' in r) return { ok: false, reply: err('rateLimited', 'You are checking decks too often; wait a moment.', { retryAfterMs: r.retryAfterMs }) };
    if ('busy' in r) return { ok: false, reply: err('busy', 'The server is busy checking decks; try again shortly.', { retryAfterMs: 2_000 }) };
    if ('timeout' in r) return { ok: false, reply: err('busy', 'The deck check took too long; try again.') };
    return { ok: false, reply: err('deckRejected', 'The deck is not legal for this queue.', { details: r.errors.slice(0, 50) }) };
  }

  /** The sessions of the session's last game (the rematch rule): this service's own matches first, else the ledger's newest game within `recentMs`. */
  private async opponentsOf(session: string): Promise<string[]> {
    const now = this.now();
    const mine = this.lastOpponents.get(session);
    if (mine && now - mine.at < this.timing.recentMs) return mine.with;
    try {
      const [last] = await this.o.store.sessionResults(session, { since: new Date(now - this.timing.recentMs), limit: 1 });
      return last ? last.placements.map((p) => p.session).filter((s) => s !== session) : [];
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------

  /** Forgets what is old: opponents past the rematch window, skips that ended. */
  private prune(now: number): void {
    for (const [s, x] of this.lastOpponents) if (now - x.at >= this.timing.recentMs) this.lastOpponents.delete(s);
    for (const [s, t] of this.skip) if (t <= now) this.skip.delete(s);
  }

  /** Nothing in a step may throw out of the timer or a handler: a failure is logged and the step is skipped. */
  private guarded(what: string, f: () => void): void {
    try {
      f();
    } catch (e) {
      this.logger.log('error', 'matchError', { what, error: e instanceof Error ? e.name : 'error' });
    }
  }
}

/**
 * Capacity admission as the gateway and the tables layer see it, with the matched tables' events taken out (see the file comment): every call goes to the
 * real admission; the events `tick`, `freed` and `released` return, and those it gives `onEvents` (a `withdraw` or `begun` that admitted a head), are split
 * by `owner.owns`: the matched tables' go to `owner.onAdmission`, the others are returned (or, for `onEvents`, given to `others`).
 */
export class MatchAdmission implements Admission {
  /** The match service (set once it exists: it is built after admission). */
  owner: Pick<MatchmakingService, 'owns' | 'onAdmission'> | null = null;

  constructor(private readonly inner: Admission) {}

  private split(events: AdmissionEvent[]): AdmissionEvent[] {
    if (!this.owner || events.length === 0) return events;
    const mine = events.filter((e) => this.owner!.owns(e.table));
    if (mine.length === 0) return events;
    // given after the caller has its return value: the service's handler may call admission again
    queueMicrotask(() => this.owner?.onAdmission(mine));
    return events.filter((e) => !mine.includes(e));
  }

  /** `CapacityAdmission`'s `onEvents`: events that came outside a step. The tables layer's own go to `others`. */
  dispatch(events: AdmissionEvent[], others: (events: AdmissionEvent[]) => void): void {
    const rest = this.owner ? events.filter((e) => !this.owner!.owns(e.table)) : events;
    const mine = this.owner ? events.filter((e) => this.owner!.owns(e.table)) : [];
    if (mine.length > 0) this.owner!.onAdmission(mine);
    if (rest.length > 0) others(rest);
  }

  request(r: StartRequest, now: number): AdmissionDecision {
    return this.inner.request(r, now);
  }
  withdraw(table: string, now: number): boolean {
    return this.inner.withdraw(table, now);
  }
  begun(table: string, now: number): void {
    this.inner.begun(table, now);
  }
  released(table: string, now: number, cause?: ReleaseCause): AdmissionEvent[] {
    return this.split(this.inner.released(table, now, cause));
  }
  freed(units: number, now: number): AdmissionEvent[] {
    return this.split(this.inner.freed(units, now));
  }
  tick(now: number): AdmissionEvent[] {
    return this.split(this.inner.tick(now));
  }
  size(): { starts: number; units: number; reserved: number } {
    return this.inner.size();
  }
  drain(): void {
    this.inner.drain();
  }
  capacityState(): ReturnType<Admission['capacityState']> {
    return this.inner.capacityState();
  }
  lookup(table: string, now: number): QueueStanding | null {
    return this.inner.lookup(table, now);
  }
  isWaiting(table: string): boolean {
    return this.inner.isWaiting(table);
  }
  hasWaitingSession(session: string): boolean {
    return this.inner.hasWaitingSession(session);
  }
  restore(starts: readonly StartRequest[], now: number): { table: string; decision: AdmissionDecision }[] {
    return this.inner.restore(starts, now);
  }
}
