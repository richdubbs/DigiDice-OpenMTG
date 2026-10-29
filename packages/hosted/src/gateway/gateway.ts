/**
 * The gateway (design 3; package M13-6): connections, sessions, the hosted protocol's commands, the per-command limits, the outbound budget, and the
 * routing between seated connections and their tables.
 *
 * Transport-free: the `ws` server (gateway/server.ts) and the in-process transport (gateway/in-process.ts, the tests and M13-15's simulation) both call
 * `upgrade` (Origin, proxy and per-address checks before a socket exists) and `open`, then hand over every frame (`message`), pong and close.
 *
 * - **Upgrade** (design 3.1): the strict Origin allow-list; with `TRUST_PROXY` only the proxy may connect and the client address is the rightmost
 *   `X-Forwarded-For` entry; address keys /32 and /64; per address key 8 open sockets and 1 new socket a second (burst 10); `MAX_CONNECTIONS` in all.
 * - **Frames** (gateway/frames.ts): size and depth before parsing, strict fields, the string checks. A frame that is not a message closes the
 *   connection (4002); a bad command is answered `badMessage` (a strike).
 * - **Hello** within 5 s; a token (`HOSTED_TOKEN`, sent only in `hello`) resumes its session (stored as SHA-256 only; forgotten after 30 days unused); a
 *   second socket with the same token replaces the first (4001). New sessions per address key 5 a minute (burst 10), the global rate shedding only
 *   heavy keys. A ping every 20 s; a connection silent for 45 s is closed.
 * - **Limits** (design 3.6): every command has its per-connection bucket (`COMMAND_LIMITS`); a seated connection's actions and chat go through net's
 *   `GuestGate` (20/s burst 50 with a queue of 32; chat 2/s); `sync` at most one full view per 5 s (more are coalesced); join attempts per session and
 *   address key with lock-outs (`JoinGuard`). Every refusal is a strike; strikes past the budget close the connection (4004).
 * - **Outbound** (gateway/outbound.ts): 1 MB per connection with the behind mode and its catch-up (`sync` without an id), and the total budget.
 * - **Nothing a client sends can throw out of a handler** (audit C4): a failure closes that connection only (1011).
 */
import { DEFAULT_GUEST_LIMITS, GuestGate, TokenBucket, type GuestMessage, type RateConfig } from '@openmtg/net/server-kit';
import type { Action } from '@openmtg/engine';
import {
  checkChat, checkName, CLOSE_PROTOCOL, CLOSE_REFUSED, CLOSE_REPLACED, CLOSE_STOPPING, CLOSE_VERSION, HOSTED_PROTOCOL, HOSTED_TIMING, isHostedToken,
  seatsAllowed, type HostedClientMessage, type HostedError, type HostedServerMessage, type HostedServerType, type ReplyMessage, type SeatNumber,
  type ServerInfo,
} from '../api';
import type { Admission } from '../admission/api';
import { clockFor, COMMAND_LIMITS, type HostedConfig } from '../config';
import { readHistory } from '../ledger/history';
import { METRICS, NULL_LOGGER, NULL_METRICS, type Logger, type Metrics } from '../obs';
import type { Runtime, RuntimeEvents, TableEnded } from '../runtime/api';
import type { GameStore, SessionRow } from '../store/api';
import type { TableLimits } from '../table/limits';
import { Tables, type TableReply, type Who } from '../tables/tables';
import type { ListingSink, ModerationHook, PasswordHook } from '../tables/hooks';
import { clientAddress } from './address';
import { parseFrame, type FrameData } from './frames';
import type { GatewayHooks } from './hooks';
import { newToken, sha256Hex, ulid } from './ids';
import { JoinGuard, SessionGuard, SocketGuard } from './limits';
import { originAllowed } from './origin';
import { DEFAULT_OUTBOUND_LIMITS, Outbound, OutboundBudget, type OutboundLimits } from './outbound';

/** What the gateway needs of the runtime. */
export type GatewayRuntime = Pick<Runtime, 'start' | 'submit' | 'prepare' | 'ready' | 'draining'>;

/** The socket of one connection (the `ws` adapter, or the in-process transport). */
export interface GatewaySocket {
  /** Sends one text frame; `done` when it was written (or failed). */
  send(text: string, done: (err?: Error) => void): void;
  close(code: number, reason: string): void;
  /** A WebSocket ping (the in-process transport has none). */
  ping?(): void;
  /**
   * Destroys the socket at once, without the closing handshake (`ws.terminate()`): `close` leaves it open for up to 30 s (its close timer) while the gateway has
   * already given its queued bytes back to the budget. The connections closed for their backlog (4004) are terminated; the code and the reason are what the
   * in-process transport records (a terminated socket tells its peer nothing).
   */
  terminate?(code: number, reason: string): void;
}

/** What `upgrade` decided about a new connection, before any socket exists. */
export type UpgradeDecision = { ok: true; address: string; key: string } | { ok: false; status: 403 | 429 | 503; why: string };

export interface UpgradeRequest {
  /** The TCP peer's address. */
  peer: string | undefined;
  origin: string | string[] | undefined;
  forwardedFor: string | string[] | undefined;
}

/** A connection as its transport drives it. */
export interface ConnectionHandle {
  readonly id: number;
  message(data: FrameData, isBinary: boolean): void;
  pong(): void;
  closed(): void;
}

export type GatewayConfig = Pick<
  HostedConfig,
  | 'publicOrigins' | 'allowDesktopOrigins' | 'trustProxy' | 'maxConnections' | 'sessionRate' | 'outboundBudgetMb' | 'formats' | 'podsEnabled' | 'clocks'
  | 'maxLobby' | 'maxListed' | 'units' | 'capacityQueueMax' | 'retention'
>;

export interface GatewayOptions {
  config: GatewayConfig;
  store: GameStore;
  runtime: GatewayRuntime;
  admission: Admission;
  /** The deck fingerprints' key (ledger/fingerprint.ts `ledgerSecret`). */
  ledgerSecret: string;
  /** The engine build players are told (`welcome.server`). */
  engineBuild: string;
  now?: () => number;
  logger?: Logger;
  metrics?: Metrics;
  hooks?: GatewayHooks;
  passwords?: PasswordHook;
  moderation?: ModerationHook;
  listings?: ListingSink;
  /** Tests: shorter times, smaller budgets, table limits. */
  timing?: Partial<typeof HOSTED_TIMING>;
  outboundLimits?: Partial<OutboundLimits>;
  tableLimits?: Partial<TableLimits>;
  /** The guest gate of seated connections (net's defaults). */
  guestLimits?: typeof DEFAULT_GUEST_LIMITS;
}

/** A guest session in memory (the store keeps its row: id, token hash, name, times). */
interface Session {
  id: string;
  tokenHash: string;
  name: string;
  createdAt: Date;
  conn: Conn | null;
}

interface Conn {
  id: number;
  address: string;
  key: string;
  socket: GatewaySocket;
  out: Outbound;
  state: 'hello' | 'open' | 'closed';
  /** A hello was accepted from this socket (set when it arrives, before its session is looked up): a second one closes the socket. */
  helloSeen: boolean;
  session: Session | null;
  openedAt: number;
  lastSeen: number;
  lastPing: number;
  buckets: Map<string, TokenBucket>;
  strikes: TokenBucket;
  chat: TokenBucket;
  gate: GuestGate | null;
  syncLast: number;
  syncPending: number[];
  /** Commands that wait for the store or the deck pool run one after another per connection. */
  chain: Promise<void>;
  /** The gate's messages and what each runs (and its command id, for a refusal). */
  gated: WeakMap<object, { run: () => void; id: number }>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A reply without its type and id. */
type ReplyBody = DistributiveOmit<ReplyMessage, 't' | 'id'>;

/** Codes of refusals that count as strikes (the player's own client misbehaving, or someone guessing). */
const STRIKE_CODES: ReadonlySet<HostedError['code']> = new Set(['badMessage', 'rateLimited', 'badCode', 'badPassword', 'notAllowed', 'notStarted']);
const SYNC_PENDING_MAX = 8;
/** WebSocket close: an internal error (RFC 6455 7.4.1). */
const CLOSE_INTERNAL = 1011;

export class Gateway {
  readonly tables: Tables;
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private readonly timing: typeof HOSTED_TIMING;
  private readonly budget: OutboundBudget;
  private readonly outLimits: OutboundLimits;
  private readonly sockets: SocketGuard;
  private readonly sessionGuard: SessionGuard;
  readonly joins = new JoinGuard();
  private readonly conns = new Map<number, Conn>();
  private readonly sessions = new Map<string, Session>();
  /** Sessions in memory by token hash. */
  private readonly byToken = new Map<string, Session>();
  /**
   * Sessions whose connection closed, with the time it did, oldest first (a session that drops again is put at the end): after `goneAfterMs` without a
   * connection the matchmaking service is told the session is gone (`MatchService.gone`). A session that comes back leaves it.
   */
  private readonly dropped = new Map<string, number>();
  private lastSweep = 0;
  private nextConn = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private drainingNow = false;
  private stopped = false;

  constructor(private readonly o: GatewayOptions) {
    this.now = o.now ?? Date.now;
    this.logger = o.logger ?? NULL_LOGGER;
    this.metrics = o.metrics ?? NULL_METRICS;
    this.timing = { ...HOSTED_TIMING, ...o.timing };
    this.budget = new OutboundBudget(o.config.outboundBudgetMb * 1024 * 1024, undefined, this.now);
    this.outLimits = { ...DEFAULT_OUTBOUND_LIMITS, ...o.outboundLimits };
    this.sockets = new SocketGuard(o.config.maxConnections);
    this.sessionGuard = new SessionGuard(o.config.sessionRate);
    this.tables = new Tables({
      store: o.store,
      runtime: o.runtime,
      admission: o.admission,
      config: o.config,
      ledgerSecret: o.ledgerSecret,
      joins: this.joins,
      send: (session, msg) => this.sendTo(session, msg),
      isConnected: (session) => this.sessions.get(session)?.conn != null,
      now: this.now,
      ...(o.passwords ? { passwords: o.passwords } : {}),
      ...(o.moderation ? { moderation: o.moderation } : {}),
      ...(o.listings ? { listings: o.listings } : {}),
      ...(o.hooks?.match ? { busyElsewhere: (s: string) => o.hooks!.match!.busy(s) } : {}),
      logger: this.logger,
      metrics: this.metrics,
      readyCheckMs: this.timing.readyCheckTableMs,
      lobbyExpiryMs: this.timing.lobbyExpiryMs,
      ...(o.tableLimits ? { limits: o.tableLimits } : {}),
    });
    // INTERFACE CHANGE (M13-13, additive): the match service talks to sessions through the gateway's own connections. `attach` is not (yet) on
    // `MatchService` in hooks.ts, so it is reached structurally; the link's shape is `SessionLink` in match/service.ts.
    (o.hooks?.match as { attach?: (link: { send(session: string, msg: HostedServerMessage): void; isConnected(session: string): boolean; connection(session: string): number | null; draining(): boolean }) => void } | undefined)?.attach?.({
      send: (session, msg) => this.sendTo(session, msg), isConnected: (session) => this.sessions.get(session)?.conn != null,
      connection: (session) => this.sessions.get(session)?.conn?.id ?? null, draining: () => this.drainingNow,
    });
  }

  /** The runtime's events, routed to the seats' connections and the tables. */
  readonly events: RuntimeEvents = {
    deliver: (game, sends) => {
      for (const s of sends) {
        const session = this.tables.sessionAt(game, s.seat);
        const conn = session ? this.sessions.get(session)?.conn : null;
        if (conn && conn.state === 'open') conn.out.send(s.t, s.json);
      }
    },
    ended: (e: TableEnded) => this.guarded('ended', () => this.tables.ended(e)),
    unloaded: (game) => this.guarded('unloaded', () => this.tables.unloaded(game)),
  };

  /** The total outbound budget in use, 0..1 (admission's signal). */
  outbound(): number {
    return this.budget.fraction();
  }

  get connections(): number {
    return this.conns.size;
  }

  /** Sessions the gateway holds in memory (connected, or seated at a table; the store holds the rest): tests and metrics. */
  get sessionsInMemory(): number {
    return this.sessions.size;
  }

  get draining(): boolean {
    return this.drainingNow;
  }

  /** Starts the housekeeping timer (once a second). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1_000);
    this.timer.unref?.();
  }

  /** Drain (design 2.3): no new tables or joins; open lobby tables close with a notice; running games go on. */
  drain(): void {
    if (this.drainingNow) return;
    this.drainingNow = true;
    // A session at an unstarted table is told by the notice of the table's own closing; the others (and those whose game has ended) by this one.
    const unstarted = (id: string): boolean => {
      const seat = this.tables.seatOf(id);
      return seat !== null && (seat.status === 'lobby' || seat.status === 'waitingCapacity' || seat.status === 'readyCheck');
    };
    const atTables = new Set([...this.sessions.keys()].filter(unstarted));
    this.guarded('matchDrain', () => this.o.hooks?.match?.drain?.());
    this.tables.drain();
    this.o.admission.drain();
    for (const c of this.conns.values()) {
      if (c.state !== 'open' || !c.session) continue;
      if (atTables.has(c.session.id) && !unstarted(c.session.id)) continue;
      const seat = this.tables.seatOf(c.session.id);
      if (seat && seat.status === 'playing') continue;
      this.send(c, { t: 'notice', kind: 'serverDraining', text: 'The server is restarting soon; games in progress go on, no new games start.' });
    }
  }

  /** Closes every connection (4003) and stops the timer. */
  close(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of [...this.conns.values()]) this.closeConn(c, CLOSE_STOPPING, 'The server is stopping.', null);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Connections

  /** Before the WebSocket upgrade: Origin, proxy and address, per-address sockets and the global connection cap. */
  upgrade(req: UpgradeRequest): UpgradeDecision {
    if (this.stopped) return { ok: false, status: 503, why: 'stopping' };
    if (!originAllowed(req.origin, this.o.config)) return this.refuseUpgrade(403, 'origin');
    const peer = clientAddress(req.peer, req.forwardedFor, this.o.config.trustProxy);
    if (!peer.ok) return this.refuseUpgrade(403, 'proxy');
    const s = this.sockets.admit(peer.key, this.now());
    if (s) return this.refuseUpgrade(s === 'connections' ? 503 : 429, s);
    return { ok: true, address: peer.address, key: peer.key };
  }

  /** An admitted upgrade whose WebSocket never opened (the handshake failed): its socket is given back. */
  upgradeFailed(key: string): void {
    this.sockets.release(key);
  }

  private refuseUpgrade(status: 403 | 429 | 503, why:'origin' | 'proxy' | 'connections' | 'sockets'): UpgradeDecision {
    this.metrics.inc(METRICS.refusals, { reason: why });
    return { ok: false, status, why };
  }

  /** A socket that passed `upgrade` is open. */
  open(socket: GatewaySocket, admitted: { address: string; key: string }): ConnectionHandle {
    const now = this.now();
    const id = this.nextConn++;
    const conn: Conn = {
      id, address: admitted.address, key: admitted.key, socket, state: 'hello', helloSeen: false, session: null, openedAt: now, lastSeen: now, lastPing: now,
      buckets: new Map(), strikes: new TokenBucket((this.o.guestLimits ?? DEFAULT_GUEST_LIMITS).strikes, now),
      chat: new TokenBucket((this.o.guestLimits ?? DEFAULT_GUEST_LIMITS).chat, now), gate: null, syncLast: -Infinity, syncPending: [],
      chain: Promise.resolve(), gated: new WeakMap(),
      out: undefined as unknown as Outbound,
    };
    conn.out = new Outbound(
      { send: (text, done) => socket.send(text, done) },
      this.budget,
      {
        catchUp: () => this.catchUp(conn),
        overflow: (why) => {
          this.metrics.inc(METRICS.refusals, { reason: why });
          this.closeConn(conn, CLOSE_REFUSED, 'Too far behind; please reconnect.', null, true);
        },
        behind: () => this.logger.log('info', 'connectionBehind', { conn: id }),
      },
      this.outLimits,
    );
    this.conns.set(id, conn);
    this.metrics.set(METRICS.connections, this.conns.size);
    this.logger.log('info', 'connectionOpen', { conn: id, address: admitted.address });
    return {
      id,
      message: (data, isBinary) => this.guardedConn(conn, () => this.onFrame(conn, data, isBinary)),
      pong: () => {
        conn.lastSeen = this.now();
      },
      closed: () => this.guarded('closed', () => this.onClosed(conn)),
    };
  }

  private onClosed(conn: Conn): void {
    if (conn.state === 'closed' && !this.conns.has(conn.id)) return;
    conn.state = 'closed';
    this.conns.delete(conn.id);
    this.sockets.release(conn.key);
    conn.out.dispose();
    conn.gate?.stop();
    this.o.hooks?.lobby?.closed(conn.id);
    const s = conn.session;
    if (s && s.conn === conn) {
      s.conn = null;
      this.dropped.delete(s.id);
      this.dropped.set(s.id, this.now());
      this.tables.disconnected(s.id);
      void this.o.store.touchSession(s.id, new Date(this.now())).catch(() => undefined);
      // A session nobody holds and that sits nowhere leaves memory (its row stays in the store).
      if (!this.tables.seatOf(s.id)) this.forget(s);
    }
    this.metrics.set(METRICS.connections, this.conns.size);
    this.metrics.set(METRICS.sessions, this.connectedSessions());
  }

  /** `hard`: terminate the socket (no closing handshake, no bye): a connection that is closed for its backlog must not keep its bytes alive for the close timer. */
  private closeConn(conn: Conn, code: number, text: string, bye: string | null, hard = false): void {
    if (conn.state === 'closed') return;
    if (hard && conn.socket.terminate) {
      try {
        conn.socket.terminate(code, text.slice(0, 120));
      } catch {
        // the socket is gone already
      }
      this.onClosed(conn);
      return;
    }
    if (bye !== null) {
      // The bye goes straight to the socket (the queue may be what is too full).
      try {
        conn.socket.send(JSON.stringify({ t: 'bye', reason: bye } satisfies HostedServerMessage), () => undefined);
      } catch {
        // the socket is gone already
      }
    }
    try {
      conn.socket.close(code, text.slice(0, 120));
    } catch {
      // the socket is gone already
    }
    this.onClosed(conn);
  }

  /** Housekeeping (once a second): hello deadlines, silent connections, pings, coalesced syncs, the tables' timers. */
  tick(now: number = this.now()): void {
    for (const c of [...this.conns.values()]) {
      if (c.state === 'hello' && now - c.openedAt >= this.timing.helloMs) {
        this.metrics.inc(METRICS.refusals, { reason: 'hello' });
        this.closeConn(c, CLOSE_PROTOCOL, 'No hello in time.', null);
        continue;
      }
      if (now - c.lastSeen >= this.timing.deadAfterMs) {
        this.metrics.inc(METRICS.refusals, { reason: 'dead' });
        this.closeConn(c, CLOSE_PROTOCOL, 'The connection was silent too long.', null);
        continue;
      }
      if (now - c.lastPing >= this.timing.pingEveryMs) {
        c.lastPing = now;
        try {
          c.socket.ping?.();
        } catch {
          // a closing socket
        }
      }
      if (c.syncPending.length > 0 && now - c.syncLast >= this.timing.syncEveryMs) this.guardedConn(c, () => this.flushSync(c, now));
    }
    this.guarded('tick', () => this.tables.tick(now));
    for (const [id, at] of this.dropped) {
      if (now - at < this.timing.goneAfterMs) break;
      this.dropped.delete(id);
      this.guarded('gone', () => this.o.hooks?.match?.gone?.(id));
    }
    // Sessions without a connection that sit nowhere any more (their table unloaded) leave memory once a minute.
    if (now - this.lastSweep >= 60_000) {
      this.lastSweep = now;
      for (const s of [...this.sessions.values()]) if (!s.conn && !this.tables.seatOf(s.id)) this.forget(s);
    }
    this.budget.check();
    this.metrics.set(METRICS.outboundBytes, this.budget.used);
    this.metrics.set(METRICS.connectionsBehind, this.budget.behindCount());
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Frames and commands

  private onFrame(conn: Conn, data: FrameData, isBinary: boolean): void {
    if (conn.state === 'closed') return;
    conn.lastSeen = this.now();
    const f = parseFrame(data, isBinary);
    if (!f.ok) {
      if (f.fatal !== null) {
        this.metrics.inc(METRICS.refusals, { reason: f.fatal === 'binary' ? 'binary' : f.fatal === 'depth' ? 'depth' : 'frame' });
        return this.closeConn(conn, CLOSE_PROTOCOL, 'Not a message of this protocol.', null);
      }
      if (conn.state === 'hello' || f.t === 'hello') return this.closeConn(conn, CLOSE_PROTOCOL, 'A malformed hello.', f.error.message);
      return this.refuse(conn, f.id, f.error);
    }
    const m = f.msg;
    if (conn.state === 'hello') {
      if (m.t !== 'hello') return this.closeConn(conn, CLOSE_PROTOCOL, 'Hello first.', null);
      // The state turns 'open' only after the session is looked up (the store is awaited): a second hello behind the first would otherwise be queued
      // and rebind the connection to another session while the first stays bound to it.
      if (conn.helloSeen) return this.closeConn(conn, CLOSE_PROTOCOL, 'Hello only once.', null);
      conn.helloSeen = true;
      return this.queue(conn, () => this.onHello(conn, m));
    }
    if (m.t === 'hello') return this.closeConn(conn, CLOSE_PROTOCOL, 'Hello only once.', null);
    this.command(conn, m);
  }

  /** Runs async work of a connection after its earlier work (the per-connection order of replies). */
  private queue(conn: Conn, f: () => Promise<void> | void): void {
    conn.chain = conn.chain.then(async () => {
      if (conn.state === 'closed') return;
      try {
        await f();
      } catch (e) {
        this.failed(conn, e);
      }
    });
  }

  private async onHello(conn: Conn, m: Extract<HostedClientMessage, { t: 'hello' }>): Promise<void> {
    if (conn.session !== null) return this.closeConn(conn, CLOSE_PROTOCOL, 'Hello only once.', null);
    if (m.protocol !== HOSTED_PROTOCOL) return this.closeConn(conn, CLOSE_VERSION, 'Another protocol version.', `This server speaks protocol ${HOSTED_PROTOCOL}; please update.`);
    const name = checkName(m.name);
    if (!name.ok) return this.closeConn(conn, CLOSE_PROTOCOL, 'A bad name.', name.message);
    const words = this.o.moderation?.nameProblem(name.value);
    if (words) return this.closeConn(conn, CLOSE_PROTOCOL, 'A refused name.', words);
    const now = this.now();
    let session: Session | null = null;
    let token: string;
    let resumed = false;
    // Anything but a well-formed token is refused before any lookup (design 3.2): it gets a new session.
    if (m.token !== undefined && isHostedToken(m.token)) {
      const hash = sha256Hex(m.token);
      session = this.byToken.get(hash) ?? null;
      if (!session) {
        const row = await this.o.store.sessionByTokenHash(hash);
        if (row && now - row.lastSeen.getTime() <= this.o.config.retention.sessionDays * 86_400_000) {
          session = this.sessions.get(row.id) ?? { id: row.id, tokenHash: row.tokenHash, name: row.name, createdAt: row.createdAt, conn: null };
          this.remember(session);
        }
      }
      if (conn.state === 'closed') return;
      if (session) {
        token = m.token;
        resumed = true;
      } else token = '';
    } else token = '';
    if (!session) {
      if (!this.sessionGuard.allow(conn.key, now)) {
        this.metrics.inc(METRICS.refusals, { reason: 'sessions' });
        return this.closeConn(conn, CLOSE_REFUSED, 'Too many new sessions.', 'Too many new sessions from your network; try again in a few minutes.');
      }
      token = newToken();
      const row: SessionRow = { id: ulid(now), tokenHash: sha256Hex(token), name: name.value, createdAt: new Date(now), lastSeen: new Date(now) };
      try {
        await this.o.store.putSession(row);
      } catch (e) {
        this.logger.log('error', 'sessionSaveFailed', { conn: conn.id, error: e instanceof Error ? e.name : 'error' });
        return this.closeConn(conn, CLOSE_REFUSED, 'The server could not start a session.', 'The server could not start a session; try again shortly.');
      }
      if (conn.state === 'closed') return;
      session = { id: row.id, tokenHash: row.tokenHash, name: row.name, createdAt: row.createdAt, conn: null };
      this.remember(session);
    } else {
      if (session.name !== name.value) {
        session.name = name.value;
        await this.o.store.putSession({ id: session.id, tokenHash: session.tokenHash, name: session.name, createdAt: session.createdAt, lastSeen: new Date(now) }).catch(() => undefined);
      } else void this.o.store.touchSession(session.id, new Date(now)).catch(() => undefined);
      if (conn.state === 'closed') return;
    }
    // The awaits above let the session leave memory (its last socket closed and nothing sat it anywhere) or another hello register a copy of it: this
    // connection goes on with the registered session, or registers its own again, so that what is sent to the session id finds the connection.
    const live = this.sessions.get(session.id);
    if (live && live !== session) {
      live.name = session.name;
      session = live;
    } else this.remember(session);
    // A second socket with the same token replaces the first (4001).
    const old = session.conn;
    if (old && old !== conn) {
      session.conn = null;
      this.metrics.inc(METRICS.refusals, { reason: 'replaced' });
      this.closeConn(old, CLOSE_REPLACED, 'Replaced by a newer connection.', 'You connected again from elsewhere.');
    }
    session.conn = conn;
    this.dropped.delete(session.id);
    conn.session = session;
    conn.state = 'open';
    const seat = this.tables.seatOf(session.id);
    const queue = this.tables.queueOf(session.id);
    this.send(conn, {
      // the token only when this hello minted it: a resume does not echo the client's own token back
      t: 'welcome', ...(resumed ? {} : { token }), session: session.id, name: session.name, resumed,
      ...(seat && !seat.left ? { table: seat.table, seat: seat.seat } : {}), ...(queue ? { queue } : {}), server: this.serverInfo(),
    });
    this.metrics.set(METRICS.sessions, this.connectedSessions());
    this.logger.log('info', 'hello', { conn: conn.id, resumed });
    this.tables.connected(session.id);
  }

  private serverInfo(): ServerInfo {
    return {
      protocol: HOSTED_PROTOCOL,
      engineBuild: this.o.engineBuild,
      formats: this.o.config.formats.map((id) => ({ id, seats: seatsAllowed(id, this.o.config.podsEnabled), clock: clockFor(this.o.config.clocks, id, 2) })),
      capacity: this.o.admission.capacityState(), // M13-10: the queue's own reading (signals, draining), not only its length
    };
  }

  private command(conn: Conn, m: Exclude<HostedClientMessage, { t: 'hello' }>): void {
    const session = conn.session!;
    const who: Who = { session: session.id, name: session.name, key: conn.key };
    const now = this.now();
    if (m.t === 'ping') {
      if (!this.take(conn, 'ping', COMMAND_LIMITS.ping, now)) this.strike(conn);
      else this.send(conn, { t: 'pong' });
      return;
    }
    switch (m.t) {
      case 'act':
        return this.seated(conn, m.id, (game, seat) => this.gated(conn, { v: 0, type: 'action', id: m.id, seq: m.seq, action: m.action } as unknown as GuestMessage, () => {
          if (!this.o.runtime.submit(game, { t: 'act', seat, id: m.id, seq: m.seq, action: m.action as Action })) this.reply(conn, m.id, { ok: false, error: { code: 'noTable', message: 'That game is over.' } });
        }, m.id));
      case 'vote':
        if (!this.limit(conn, m.id, 'vote', now)) return;
        return this.seated(conn, m.id, (game, seat) => {
          if (!this.o.runtime.submit(game, { t: 'vote', seat, id: m.id, proposal: m.proposal, accept: m.accept, ...(m.reason !== undefined ? { reason: m.reason } : {}) })) {
            this.reply(conn, m.id, { ok: false, error: { code: 'noTable', message: 'That game is over.' } });
          }
        });
      case 'sync':
        return this.seated(conn, m.id, () => this.onSync(conn, m.id, now));
      case 'chat': {
        const c = checkChat(m.text);
        if (!c.ok) return this.refuse(conn, m.id, { code: 'badMessage', message: c.message });
        const seat = this.tables.seatOf(session.id);
        if (seat && !seat.left && (seat.status === 'playing' || seat.status === 'over')) {
          return this.gated(conn, { v: 0, type: 'chat', text: c.value } as unknown as GuestMessage, () => {
            if (!this.o.runtime.submit(seat.table, { t: 'chat', seat: seat.seat, id: m.id, text: c.value })) this.reply(conn, m.id, { ok: false, error: { code: 'noTable', message: 'That table is gone.' } });
          }, m.id);
        }
        if (!conn.chat.take(now)) return this.refuse(conn, m.id, { code: 'rateLimited', message: 'Too many chat messages; wait a moment.', retryAfterMs: conn.chat.wait(now) });
        if (!this.tables.lobbyChat(who, c.value)) return this.refuse(conn, m.id, { code: 'notAllowed', message: 'You are not at a table.' });
        return this.reply(conn, m.id, { ok: true });
      }
      case 'leave':
        if (!this.limit(conn, m.id, 'leave', now)) return;
        return this.queue(conn, async () => {
          const r = await this.tables.leave(who, m.id);
          if (r !== 'routed') this.answer(conn, m.id, r);
        });
      case 'create':
        if (!this.limit(conn, m.id, 'create', now)) return;
        return this.queue(conn, async () => this.answer(conn, m.id, await this.tables.create(who, m)));
      case 'join':
        if (!this.limit(conn, m.id, 'join', now)) return;
        return this.queue(conn, async () => this.answer(conn, m.id, await this.tables.join(who, m)));
      case 'codes':
        if (!this.limit(conn, m.id, 'codes', now)) return;
        return this.queue(conn, async () => this.answer(conn, m.id, await this.tables.newCodes(who)));
      case 'ready':
        if (!this.limit(conn, m.id, 'ready', now)) return;
        return this.queue(conn, () => this.answer(conn, m.id, this.o.hooks?.match?.ready(who, m.start) ?? this.tables.ready(who, m.start)));
      case 'queue':
        if (!this.limit(conn, m.id, 'queue', now)) return;
        if (!this.o.hooks?.match) return this.notYet(conn, m.id, 'Quick match is not available on this server yet.');
        if (this.tables.busyIn(session.id)) return this.refuse(conn, m.id, { code: 'busy', message: 'You already take part in a game (one at a time).' });
        if (this.drainingNow) return this.refuse(conn, m.id, { code: 'draining', message: 'The server is restarting soon; no new games now.' });
        return this.queue(conn, async () => this.answer(conn, m.id, await this.o.hooks!.match!.queue(who, m)));
      case 'unqueue':
        if (!this.limit(conn, m.id, 'queue', now)) return;
        return this.queue(conn, async () => {
          const r = (await this.tables.unqueue(who)) ?? (await this.o.hooks?.match?.unqueue(who)) ?? { ok: true };
          this.answer(conn, m.id, r);
        });
      case 'browse': {
        if (!this.limit(conn, m.id, 'browse', now)) return;
        const lobby = this.o.hooks?.lobby;
        if (!lobby) return this.notYet(conn, m.id, 'The lobby browser is not available on this server yet.');
        const page = lobby.browse(m, now);
        return this.reply(conn, m.id, { ok: true, tables: page.tables, total: page.total });
      }
      case 'watchLobby': {
        if (!this.limit(conn, m.id, 'watchLobby', now)) return;
        const lobby = this.o.hooks?.lobby;
        if (!lobby) return this.notYet(conn, m.id, 'Live lobby updates are not available on this server yet.');
        const e = lobby.watch(conn.id, conn.key, m.filter, (u) => this.send(conn, u), now);
        return e ? this.refuse(conn, m.id, e) : this.reply(conn, m.id, { ok: true });
      }
      case 'report': {
        if (!this.limit(conn, m.id, 'report', now)) return;
        const reports = this.o.hooks?.reports;
        if (!reports) return this.notYet(conn, m.id, 'Reports are not available on this server yet.');
        const seat = this.tables.seatOf(session.id);
        return this.queue(conn, async () => this.answer(conn, m.id, await reports.report(who, m, seat ? { table: seat.table, seat: seat.seat } : null)));
      }
      case 'history':
        if (!this.limit(conn, m.id, 'history', now)) return;
        return this.queue(conn, async () => {
          const since = new Date(now - this.o.config.retention.logsDays * 86_400_000);
          const history = await readHistory(this.o.store, session.id, { since, limit: 50 });
          this.reply(conn, m.id, { ok: true, history });
        });
      case 'spectate':
        if (!this.limit(conn, m.id, 'spectate', now)) return;
        return this.notYet(conn, m.id, 'Watching games comes later.');
    }
  }

  /** Runs `f` with the connection's game and seat; refused when the session is not in a game (or left it). */
  private seated(conn: Conn, id: number, f: (game: string, seat: SeatNumber) => void): void {
    const seat = conn.session ? this.tables.seatOf(conn.session.id) : null;
    if (!seat || seat.left || (seat.status !== 'playing' && seat.status !== 'over')) {
      return this.refuse(conn, id, { code: 'notStarted', message: 'You are not in a game.' });
    }
    f(seat.table, seat.seat);
  }

  /** Actions and game chat through net's `GuestGate` (one per connection: rate, queue, strikes). */
  private gated(conn: Conn, m: GuestMessage, run: () => void, id: number): void {
    if (!conn.gate) {
      conn.gate = new GuestGate(this.o.guestLimits ?? DEFAULT_GUEST_LIMITS, {
        run: (x) => conn.gated.get(x)?.run(),
        refuse: (x, why) => {
          this.metrics.inc(METRICS.refusals, { reason: 'rateLimited' });
          const g = conn.gated.get(x);
          if (g) this.reply(conn, g.id, { ok: false, error: { code: 'rateLimited', message: why } });
        },
        sync: () => undefined,
        abuse: () => {
          this.metrics.inc(METRICS.refusals, { reason: 'strikes' });
          this.closeConn(conn, CLOSE_REFUSED, 'Too many refused messages.', 'Too many refused messages.');
        },
        fail: (e) => this.failed(conn, e),
      }, this.now);
    }
    conn.gated.set(m, { run, id });
    conn.gate.offer(m);
  }

  /** `sync`: one full view per 5 s per connection from the seat's cached view; more within that time are answered together when it is due. */
  private onSync(conn: Conn, id: number, now: number): void {
    if (now - conn.syncLast >= this.timing.syncEveryMs && conn.syncPending.length === 0) {
      conn.syncLast = now;
      const seat = this.tables.seatOf(conn.session!.id)!;
      if (!this.o.runtime.submit(seat.table, { t: 'sync', seat: seat.seat, id })) this.reply(conn, id, { ok: false, error: { code: 'noTable', message: 'That game is over.' } });
      return;
    }
    if (conn.syncPending.length >= SYNC_PENDING_MAX) return this.refuse(conn, id, { code: 'rateLimited', message: 'Too many syncs; one view is on its way.' });
    conn.syncPending.push(id);
  }

  private flushSync(conn: Conn, now: number): void {
    const ids = conn.syncPending.splice(0);
    if (ids.length === 0 || !conn.session) return;
    conn.syncLast = now;
    const seat = this.tables.seatOf(conn.session.id);
    const last = ids.pop()!;
    for (const id of ids) this.reply(conn, id, { ok: true });
    if (!seat || seat.left || !this.o.runtime.submit(seat.table, { t: 'sync', seat: seat.seat, id: last })) this.reply(conn, last, { ok: false, error: { code: 'notStarted', message: 'You are not in a game.' } });
  }

  /** After being behind: one fresh full view for a seated connection (`sync` with no id: design 3.5). */
  private catchUp(conn: Conn): boolean {
    const seat = conn.session ? this.tables.seatOf(conn.session.id) : null;
    if (!seat || seat.left || (seat.status !== 'playing' && seat.status !== 'over')) return false;
    return this.o.runtime.submit(seat.table, { t: 'sync', seat: seat.seat });
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Replies, refusals, strikes

  private take(conn: Conn, name: string, rate: RateConfig, now: number): boolean {
    let b = conn.buckets.get(name);
    if (!b) conn.buckets.set(name, (b = new TokenBucket(rate, now)));
    return b.take(now);
  }

  /** The command's per-connection bucket (design 3.6); false (answered `rateLimited`, a strike) when it is empty. */
  private limit(conn: Conn, id: number, name: keyof typeof COMMAND_LIMITS, now: number): boolean {
    if (this.take(conn, name, COMMAND_LIMITS[name], now)) return true;
    this.refuse(conn, id, { code: 'rateLimited', message: 'Too many of these in a short time; wait a moment.', retryAfterMs: conn.buckets.get(name)!.wait(now) });
    return false;
  }

  private notYet(conn: Conn, id: number, message: string): void {
    this.reply(conn, id, { ok: false, error: { code: 'notYet', message } });
  }

  private answer(conn: Conn, id: number, r: TableReply): void {
    if (r.ok) return this.reply(conn, id, r);
    if (STRIKE_CODES.has(r.error.code)) return this.refuse(conn, id, r.error);
    this.reply(conn, id, r);
  }

  /** A refusal: answered, counted, and a strike. */
  private refuse(conn: Conn, id: number, error: HostedError): void {
    const reason = error.code;
    this.metrics.inc(METRICS.refusals, { reason });
    this.reply(conn, id, { ok: false, error });
    this.strike(conn);
  }

  private strike(conn: Conn): void {
    this.metrics.inc(METRICS.strikes);
    if (conn.strikes.take(this.now())) return;
    this.metrics.inc(METRICS.refusals, { reason: 'strikes' });
    this.closeConn(conn, CLOSE_REFUSED, 'Too many refused messages.', 'Too many refused messages.');
  }

  private reply(conn: Conn, id: number, r: ReplyBody): void {
    this.send(conn, { t: 'reply', id, ...r } as ReplyMessage);
  }

  private send(conn: Conn, m: HostedServerMessage): void {
    if (conn.state === 'closed') return;
    conn.out.send(m.t as HostedServerType, JSON.stringify(m));
  }

  /** To a session's connection, if it has one (the tables layer's messages). */
  private sendTo(session: string, m: HostedServerMessage): void {
    const c = this.sessions.get(session)?.conn;
    if (c && c.state === 'open') this.send(c, m);
  }

  private remember(s: Session): void {
    this.sessions.set(s.id, s);
    this.byToken.set(s.tokenHash, s);
  }

  private forget(s: Session): void {
    if (this.sessions.get(s.id) === s) this.sessions.delete(s.id);
    if (this.byToken.get(s.tokenHash) === s) this.byToken.delete(s.tokenHash);
  }

  private connectedSessions(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.conn) n++;
    return n;
  }

  /** Audit C4: nothing a client sends throws out of a handler; a failure closes that connection only. */
  private guardedConn(conn: Conn, f: () => void): void {
    try {
      f();
    } catch (e) {
      this.failed(conn, e);
    }
  }

  private guarded(what: string, f: () => void): void {
    try {
      f();
    } catch (e) {
      this.logger.log('error', 'gatewayError', { what, error: e instanceof Error ? e.name : 'error' });
    }
  }

  private failed(conn: Conn, e: unknown): void {
    this.logger.log('error', 'connectionError', { conn: conn.id, error: e instanceof Error ? e.name : 'error' });
    this.closeConn(conn, CLOSE_INTERNAL, 'Server error.', null);
  }
}
