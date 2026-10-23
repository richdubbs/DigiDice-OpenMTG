/**
 * The browser's side of the DigiDice game server (hosted design 3, 12; protocol 1 of `@openmtg/hosted/api`): one WebSocket to the server's `/ws`, `hello`
 * with the stored guest token, numbered commands with replies, the table, the ready check, the views and patches of a running game, the clocks, notices and
 * chat. It is a pure transport and a keeper of what the server last said: the screens (hosted/room, hosted/game) and `HostedConnection` read it.
 *
 * - **Sessions.** `hello { token?, name }`; the server answers `welcome` with the token (kept in the browser's storage, hosted/storage.ts) and, for a
 *   session that has a seat, its table and seat. The token is sent only in `hello`, never in a URL.
 * - **Commands.** Every command but `hello` and `ping` takes the next number of a counter that is kept in storage across sockets and reloads (a table
 *   answers an older `act` id as `stale`), and resolves with its one `reply`. A socket that drops answers the commands waiting with `disconnected`: the
 *   server may or may not have done them, and the next view says. A command waits for its turn when it would go faster than the server takes it (pacing.ts:
 *   the server counts a refusal as a strike), and is not sent at all when the wait would be long: it answers `rateLimited` with the time left.
 * - **Reconnect.** A socket that drops for no reason of its own is opened again after 1 s, doubling to 10 s, for as long as the page keeps the link; the
 *   server keeps the seat ("disconnected") and re-attaches it: `welcome { resumed }`, a full view, the clocks, the result if the game is over. Not
 *   retried: another window took the session over (4001), a page and server of different versions (4005), a protocol error (4002).
 * - **Views.** The full `view` replaces what is held; a `patch` is applied with `nextView` (api/patch.ts) and, when its base is not the view held or it does
 *   not fit, one `sync` asks for a full view (the patches meanwhile are dropped). `seq` only goes up.
 * - **Clocks.** The server sends them when one starts or stops. The link keeps them with `at` rewritten to this page's own clock at arrival, so the
 *   countdown (hosted/clocks.ts) never depends on the server's time of day.
 *
 * Getters return the same object until something changes and every change is announced through `subscribe` (React's `useSyncExternalStore`).
 * `onMessage` hands every server message to a listener after the link has taken it in, for screens that need what the link does not keep (the lobby
 * browser's `lobbyUpdate`).
 *
 * - **Quick match (M13-12).** `searching()` is the matchmaking queue this session is in (`queue` was answered ok, or the server says so in `welcome` or
 *   `queueStatus`), with the waiting figures of the last `queueStatus` in `queue()`. A match found arrives as a `table` of source 'matched', and the search is
 *   over. A ready check of a match that fails ends that table for this seat at once (the match is dissolved: those who confirmed go back to the front of the
 *   queue, the others leave it, design 4.5), so the link takes `searching()` up again for a seat that had confirmed.
 */
import type { Action, GameEvent, GameView, LegalAction, PlayerId } from '@openmtg/engine';
import {
  CLOSE_PROTOCOL, CLOSE_REFUSED, CLOSE_REPLACED, CLOSE_STOPPING, CLOSE_VERSION, HOSTED_PROTOCOL, HOSTED_SOCKET_PATH, HOSTED_TIMING, nextView,
  type ClockView, type HostedClientMessage, type HostedClientType, type HostedFormatId, type HostedServerMessage, type NoticeKind, type ProposalView, type QueueSize, type QueueStatus,
  type ReadyCheckMessage, type ReplyMessage, type ResultMessage, type SeatNumber, type ServerInfo, type StartMessage, type TableView, type WelcomeMessage,
} from '@openmtg/hosted/api';
import type { SocketLike } from '../online/OnlineLink';
import type { LinkError } from './errors';
import { Pacer } from './pacing';
import { EMPTY_SESSION, MemoryHostedStorage, type HostedStorage, type StoredSession } from './storage';

export type { SocketLike };

const OPEN = 1;

/** The socket to the server: connecting (the first time), open, lost (dropped; trying again), closed (by this page, or for good). */
export type HostedLinkState = 'connecting' | 'open' | 'lost' | 'closed';

/** The view the server last sent this seat, with the events of the change that led to it and this seat's legal priority actions. */
export interface HeldView {
  readonly seq: number;
  readonly view: GameView;
  readonly events: readonly GameEvent[];
  readonly legal: readonly LegalAction[];
}

/** The running ready check, with its deadline on this page's own clock (the server's `deadlineAt` is its time of day). */
export interface HeldReadyCheck {
  readonly start: string;
  /** When the check runs out, as `Date.now()` of this page. */
  readonly deadline: number;
  readonly players: readonly { seat: SeatNumber; name: string; ready: boolean }[];
  /** This seat has confirmed. */
  readonly confirmed: boolean;
}

/** The matchmaking queue this session is in (design 4.5): which queue, and since when on this page's clock. */
export interface HeldSearch {
  readonly format: HostedFormatId;
  readonly size: QueueSize;
  readonly since: number;
}

/** A notice of the server (a player dropped, came back, left, ran out of time...), numbered for React keys and "new since". */
export interface HostedNotice {
  readonly n: number;
  readonly kind: NoticeKind;
  readonly seat?: SeatNumber;
  /** The server's own text. */
  readonly text: string;
}

export interface HostedChatLine {
  readonly n: number;
  readonly from: SeatNumber;
  readonly mine: boolean;
  readonly text: string;
}

/** How a by-hand proposal of another player ended, as this seat is told. */
export interface HostedProposalEnd {
  readonly n: number;
  readonly proposal: number;
  readonly outcome: 'approved' | 'rejected' | 'withdrawn';
}

/** A seat that is not at the table now, as far as the notices say. */
export type SeatAway = 'dropped' | 'left';

export interface InviteCode {
  readonly seat: SeatNumber;
  /** In groups of four, as the server formatted it. */
  readonly code: string;
}

export type Reply =
  | { ok: true; codes?: string[]; tables?: Extract<ReplyMessage, { ok: true }>['tables']; total?: number; table?: string; warnings?: string[]; history?: Extract<ReplyMessage, { ok: true }>['history'] }
  | { ok: false; error: LinkError };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A command without its number (the link numbers them). `act` carries the `seq` of the view it was chosen from. */
export type HostedCommand = DistributiveOmit<Exclude<HostedClientMessage, { t: 'hello' } | { t: 'ping' }>, 'id'>;

export interface HostedLinkOptions {
  /** The hosted server's WebSocket origin as `GET /api/status` gives it: `wss://play.example.net`, or `ws://127.0.0.1:47700` on this machine. */
  server: string;
  /** The display name `hello` sends (1-40 characters; the server shows it as "Name (guest)"). */
  name: string;
  /** Where the session is kept (default: the browser's storage for this server). */
  storage?: HostedStorage;
  /** Opens the WebSocket (default: the browser's own; tests pass a fake). */
  socket?: (url: string) => SocketLike;
  /** The first retry after a drop, and the longest wait between retries (ms). */
  retryMs?: number;
  retryMaxMs?: number;
  /** A text `ping` this often while open (ms; 0: never). Browsers answer WebSocket pings by themselves; this keeps proxies that drop idle sockets awake. */
  pingEveryMs?: number;
  /** Notices and chat lines kept (the oldest go first). */
  keepNotices?: number;
  keepChat?: number;
}

/** The socket URL for a server origin (`ws(s)://host` or `http(s)://host`; the path is the protocol's). */
export function hostedSocketUrl(server: string): string {
  const u = new URL(server);
  u.protocol = u.protocol === 'https:' || u.protocol === 'wss:' ? 'wss:' : 'ws:';
  u.pathname = HOSTED_SOCKET_PATH;
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** An error of the link itself: the server cannot be reached, or it and this page are different versions. */
export class HostedLinkError extends Error {
  constructor(
    readonly code: 'unreachable' | 'version' | 'refused' | 'replaced' | 'closed',
    message: string,
  ) {
    super(message);
    this.name = 'HostedLinkError';
  }
}

/** `text` ending in one full stop (empty stays empty). */
function sentence(text: string): string {
  const t = text.trim().replace(/[.s]+$/, '');
  return t ? `${t}.` : '';
}

/** `text` without a closing full stop. */
function trimStop(text: string): string {
  return text.trim().replace(/[.s]+$/, '');
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const NO_NOTICES: readonly HostedNotice[] = Object.freeze([]);
const NO_CHAT: readonly HostedChatLine[] = Object.freeze([]);
const NO_AWAY: ReadonlyMap<SeatNumber, SeatAway> = new Map();

export class HostedLink {
  private readonly o: Required<Omit<HostedLinkOptions, 'storage' | 'socket'>> & Pick<HostedLinkOptions, 'socket'>;
  private readonly storage: HostedStorage;
  private session: StoredSession = EMPTY_SESSION;
  private ws: SocketLike | null = null;
  private state: HostedLinkState = 'connecting';
  private problem: string | null = null;
  private displayName: string;
  /** The name the last `hello` said (the server shows a session's name as of its last hello). */
  private helloName: string | null = null;
  private welcomed = false;
  private welcomeMsg: WelcomeMessage | null = null;
  private tableView: TableView | null = null;
  private mySeat: SeatNumber | null = null;
  private heldView: HeldView | null = null;
  private syncing = false;
  private syncSentAt = 0;
  private clockHeld: ClockView | null = null;
  private serverOffset: number | null = null;
  private readyHeld: HeldReadyCheck | null = null;
  private queueHeld: QueueStatus | null = null;
  private searchHeld: HeldSearch | null = null;
  private startHeld: StartMessage | null = null;
  private proposalHeld: ProposalView | null = null;
  private proposalEnd: HostedProposalEnd | null = null;
  private noticeList: readonly HostedNotice[] = NO_NOTICES;
  private chatList: readonly HostedChatLine[] = NO_CHAT;
  private resultHeld: ResultMessage | null = null;
  private awayMap: ReadonlyMap<SeatNumber, SeatAway> = NO_AWAY;
  private codeList: readonly InviteCode[] = [];
  private byeText: string | null = null;
  private counter = 0;
  private readonly pending = new Map<number, { t: string; seats?: number; search?: { format: HostedFormatId; size: QueueSize }; resolve: (r: Reply) => void }>();
  private readonly listeners = new Set<() => void>();
  private readonly taps = new Set<(m: HostedServerMessage) => void>();
  private readonly pacer = new Pacer(() => this.now());
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedHere = false;
  /** Counts `connect`s and `close`s: a `connect` that was closed (or replaced by a newer one) while it waited for the storage does nothing (React's StrictMode runs an effect twice). */
  private generation = 0;
  /** Resolves `connect()` with the first `welcome` of a socket (or rejects it when the socket fails first). */
  private first: { resolve: () => void; reject: (e: HostedLinkError) => void } | null = null;
  private openWaiters: (() => void)[] = [];

  constructor(opts: HostedLinkOptions) {
    const { storage, socket, ...rest } = opts;
    this.o = { retryMs: 1000, retryMaxMs: 10_000, pingEveryMs: HOSTED_TIMING.pingEveryMs, keepNotices: 50, keepChat: 200, ...rest, ...(socket ? { socket } : {}) };
    this.storage = storage ?? new MemoryHostedStorage();
    this.displayName = opts.name;
  }

  // ---- getters (the same object until something changes)

  readonly linkState = (): HostedLinkState => this.state;
  /** Why the socket is lost or closed, in words (null while it is fine). */
  readonly linkProblem = (): string | null => this.problem;
  readonly welcome = (): WelcomeMessage | null => this.welcomeMsg;
  readonly server = (): ServerInfo | null => this.welcomeMsg?.server ?? null;
  /** The table as the server last described it to this session (null: none; after a reload into a running game, the one the page kept). */
  readonly table = (): TableView | null => this.tableView;
  readonly seat = (): SeatNumber | null => this.mySeat;
  readonly view = (): HeldView | null => this.heldView;
  /** The clocks as last sent, `at` on this page's clock; count them down with hosted/clocks.ts. */
  readonly clocks = (): ClockView | null => this.clockHeld;
  readonly readyCheck = (): HeldReadyCheck | null => this.readyHeld;
  readonly queue = (): QueueStatus | null => this.queueHeld;
  /** The matchmaking queue this session is in, or null (M13-12). */
  readonly searching = (): HeldSearch | null => this.searchHeld;
  readonly start = (): StartMessage | null => this.startHeld;
  readonly proposal = (): ProposalView | null => this.proposalHeld;
  readonly proposalOutcome = (): HostedProposalEnd | null => this.proposalEnd;
  readonly notices = (): readonly HostedNotice[] => this.noticeList;
  readonly chat = (): readonly HostedChatLine[] => this.chatList;
  readonly result = (): ResultMessage | null => this.resultHeld;
  /** Seats that dropped or left, as the notices say (a seat that is back is not in it). */
  readonly away = (): ReadonlyMap<SeatNumber, SeatAway> => this.awayMap;
  /** The invite codes of the open seats of this session's private table, as the creator was shown them (the server cannot show them again). */
  readonly codes = (): readonly InviteCode[] => this.codeList;
  /** Why the server said goodbye (`bye`), if it did. */
  readonly bye = (): string | null => this.byeText;
  readonly name = (): string => this.displayName;

  /** This seat's player in the game (`p1`..`p4`): the viewer of the view, else the seat's player in `start`. */
  readonly me = (): PlayerId | null => {
    const viewer = this.heldView?.view.viewer;
    if (viewer) return viewer;
    const seat = this.mySeat;
    return seat !== null ? (this.startHeld?.players.find((p) => p.seat === seat)?.id ?? null) : null;
  };

  /** A seat's display name, from what the server told: the table, the start, the view. */
  readonly nameOfSeat = (seat: SeatNumber): string | null => {
    const fromTable = this.tableView?.seats.find((s) => s.seat === seat)?.name;
    if (fromTable) return fromTable;
    const fromStart = this.startHeld?.players.find((p) => p.seat === seat);
    if (fromStart?.name) return fromStart.name;
    const id = fromStart?.id ?? (`p${seat}` as PlayerId);
    return this.heldView?.view.players.find((p) => p.id === id)?.name ?? null;
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Every message the server sends, after the link has taken it in. */
  onMessage(listener: (m: HostedServerMessage) => void): () => void {
    this.taps.add(listener);
    return () => {
      this.taps.delete(listener);
    };
  }

  private changed(): void {
    for (const l of [...this.listeners]) l();
  }

  private now(): number {
    return Date.now();
  }

  /** The name `hello` sends from now on (a reconnect sends it again; the server shows the new one). */
  setName(name: string): void {
    this.displayName = name;
  }

  /**
   * Says hello again under another name and resolves when the server has taken it (the same session, the same seat). The server shows a session's name
   * as of its last `hello`, so a player who changes the name field after the link is open needs a fresh socket; one that is not open yet just sends it.
   * Commands waiting on the old socket are answered `disconnected`.
   */
  async rename(name: string): Promise<void> {
    this.displayName = name;
    if (this.helloName === name || !this.ws || this.state !== 'open') return;
    const old = this.ws;
    this.ws = null;
    this.stopPing();
    try {
      old.close(1000, 'renaming');
    } catch {
      // closing already
    }
    for (const [id, p] of [...this.pending]) {
      this.pending.delete(id);
      p.resolve({ ok: false, error: { code: 'disconnected', message: 'The connection was renewed before the server answered.' } });
    }
    await this.open();
  }

  // ---- connecting

  /**
   * Opens the socket and says `hello`; resolves with the server's `welcome`. Rejects with a `HostedLinkError` when the server cannot be reached or refuses
   * this page (no retry then: the screen says so and offers to try again). After the first `welcome` a dropped socket is opened again by itself.
   */
  async connect(): Promise<void> {
    this.closedHere = false;
    this.welcomed = false;
    this.retries = 0;
    const generation = ++this.generation;
    const session = await this.storage.open();
    if (generation !== this.generation || this.closedHere) throw new HostedLinkError('closed', 'The link was closed.');
    this.session = session;
    this.listenForNetwork();
    return this.open();
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = hostedSocketUrl(this.o.server);
      let ws: SocketLike;
      try {
        ws = (this.o.socket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike))(url);
      } catch (e) {
        this.state = 'closed';
        this.problem = `The connection to the game server could not be opened (${e instanceof Error ? e.message : String(e)}).`;
        this.changed();
        reject(new HostedLinkError('unreachable', this.problem));
        return;
      }
      this.ws = ws;
      if (!this.welcomed) this.state = 'connecting';
      this.first = { resolve, reject };
      this.changed();
      ws.onmessage = (ev) => {
        if (this.ws === ws) this.receive(ev.data);
      };
      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.helloName = this.displayName;
        this.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name: this.displayName, ...(this.session.token ? { token: this.session.token } : {}) });
      };
      ws.onerror = () => undefined; // the close event follows
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.dropped(ev.code, ev.reason);
      };
    });
  }

  private send(m: HostedClientMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return false;
    try {
      ws.send(JSON.stringify(m));
      return true;
    } catch {
      return false;
    }
  }

  private dropped(code: number, reason: string): void {
    this.stopPing();
    for (const [id, p] of [...this.pending]) {
      this.pending.delete(id);
      p.resolve({ ok: false, error: { code: 'disconnected', message: 'The connection to the server dropped before it answered.' } });
    }
    const first = this.first;
    this.first = null;
    let fatal: HostedLinkError | null = null;
    if (this.closedHere) {
      this.state = 'closed';
      this.problem = null;
    } else if (code === CLOSE_REPLACED) {
      fatal = new HostedLinkError('replaced', 'This game is open in another window or tab; play it there (or reload this page to take it back).');
    } else if (code === CLOSE_VERSION) {
      fatal = new HostedLinkError('version', 'This page and the game server are different versions. Update OpenMTG, then reload the page.');
    } else if (code === CLOSE_PROTOCOL) {
      fatal = new HostedLinkError('closed', `The game server closed the connection: ${sentence(this.byeText ?? reason ?? '') || 'protocol error.'}`);
    } else if (!this.welcomed) {
      // The first connection of this page failed: the screen says so (no endless retrying behind its back).
      fatal = new HostedLinkError(
        code === CLOSE_REFUSED ? 'refused' : 'unreachable',
        code === CLOSE_REFUSED
          ? `The game server is not taking new connections from this network right now${this.byeText ?? reason ? ` (${trimStop(this.byeText ?? reason)})` : ''}. Try again in a few minutes.`
          : 'The game server did not answer. Check that it is running, then try again.',
      );
    } else {
      this.state = 'lost';
      this.problem =
        code === CLOSE_STOPPING
          ? 'The game server is restarting; trying again…'
          : code === CLOSE_REFUSED
            ? 'The game server asked this page to wait; trying again…'
            : 'Lost the connection to the game server; trying again…';
      const wait = Math.min(this.o.retryMaxMs, this.o.retryMs * 2 ** this.retries);
      this.retries++;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.reopen();
      }, code === CLOSE_REFUSED || code === CLOSE_STOPPING ? Math.max(wait, this.o.retryMaxMs) : wait);
    }
    if (fatal) {
      this.state = 'closed';
      this.problem = fatal.message;
    }
    this.changed();
    if (first && fatal) first.reject(fatal);
    else if (first && this.closedHere) first.reject(new HostedLinkError('closed', 'The link was closed.'));
    // A socket opened after the first welcome that drops is retried by the link itself: whoever waited for it (a rename) is let go, the state says the rest.
    else first?.resolve();
  }

  /** Opens the socket again now (a retry that came due, or the browser says it is online again). */
  private reopen(): void {
    if (this.closedHere || this.ws || this.state === 'closed') return;
    this.open().catch(() => undefined);
  }

  private readonly onOnline = (): void => {
    if (this.state !== 'lost' || !this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.reopen();
  };

  private listenForNetwork(): void {
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
  }

  /** Closes the socket for good (a game goes on at the server: `leave` first to concede it). Waiting commands are answered `disconnected`. */
  close(): void {
    this.closedHere = true;
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopPing();
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(1000, 'closed by the page');
      } catch {
        // already closing
      }
    }
    this.dropped(1000, '');
    for (const w of this.openWaiters.splice(0)) w();
  }

  private startPing(): void {
    this.stopPing();
    if (this.o.pingEveryMs > 0) this.pingTimer = setInterval(() => this.send({ t: 'ping' }), this.o.pingEveryMs);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  // ---- receiving

  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let m: unknown;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (!isObject(m) || typeof m['t'] !== 'string') return;
    const msg = m as unknown as HostedServerMessage;
    this.take(msg);
    for (const tap of [...this.taps]) {
      try {
        tap(msg);
      } catch (e) {
        console.error('[HostedLink] a message listener failed', e);
      }
    }
  }

  private take(msg: HostedServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        return this.onWelcome(msg);
      case 'reply': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) {
          this.onReplyOk(p, msg);
          // what a reply changes (the codes, the search, a seat stood up) is announced like any other change
          this.changed();
        }
        p.resolve(
          msg.ok
            ? {
              ok: true,
              ...(msg.codes ? { codes: msg.codes } : {}), ...(msg.tables ? { tables: msg.tables } : {}), ...(msg.total !== undefined ? { total: msg.total } : {}),
              ...(msg.table ? { table: msg.table } : {}), ...(msg.warnings ? { warnings: msg.warnings } : {}), ...(msg.history ? { history: msg.history } : {}),
            }
            : { ok: false, error: msg.error },
        );
        return;
      }
      case 'table':
        return this.onTable(msg.table);
      case 'queueStatus':
        this.queueHeld = msg.queue;
        if (msg.queue.kind === 'match') this.searchHeld = { format: msg.queue.format, size: msg.queue.size, since: this.searchHeld?.since ?? this.now() };
        this.changed();
        return;
      case 'readyCheck':
        return this.onReadyCheck(msg);
      case 'start':
        // A new game: nothing of an earlier one stays.
        this.resetGame();
        this.startHeld = msg;
        this.queueHeld = null;
        this.searchHeld = null;
        this.readyHeld = null;
        this.changed();
        return;
      case 'view':
        return this.onView(msg.seq, msg.view, msg.events, msg.legal);
      case 'patch':
        return this.onPatch(msg);
      case 'clock': {
        const { t: _t, ...rest } = msg;
        const now = this.now();
        this.serverOffset = msg.at - now;
        this.clockHeld = { ...rest, at: now };
        this.changed();
        return;
      }
      case 'proposal':
        this.proposalHeld = msg.proposal;
        this.changed();
        return;
      case 'proposalClosed':
        if (this.proposalHeld?.id === msg.proposal) this.proposalHeld = null;
        this.proposalEnd = { n: ++this.counter, proposal: msg.proposal, outcome: msg.outcome };
        this.changed();
        return;
      case 'notice':
        return this.onNotice(msg.kind, msg.seat, msg.text);
      case 'chat':
        this.chatList = this.trim([...this.chatList, { n: ++this.counter, from: msg.from, mine: msg.from === this.mySeat, text: msg.text }], this.o.keepChat);
        this.changed();
        return;
      case 'result':
        this.resultHeld = msg;
        this.proposalHeld = null;
        this.changed();
        return;
      case 'bye':
        this.byeText = msg.reason;
        this.changed();
        return;
      case 'lobbyUpdate':
        return; // the lobby browser's (onMessage)
    }
  }

  private trim<T>(list: T[], keep: number): readonly T[] {
    return list.length > keep ? list.slice(list.length - keep) : list;
  }

  private onWelcome(m: WelcomeMessage): void {
    if (m.server.protocol !== HOSTED_PROTOCOL) {
      const err = new HostedLinkError('version', 'This page and the game server are different versions. Update OpenMTG, then reload the page.');
      const first = this.first;
      this.first = null;
      this.closedHere = true;
      this.state = 'closed';
      this.problem = err.message;
      const ws = this.ws;
      this.ws = null;
      try {
        ws?.close(1000, 'protocol');
      } catch {
        // closing already
      }
      this.changed();
      first?.reject(err);
      return;
    }
    const wasLost = this.state === 'lost';
    this.welcomed = true;
    this.retries = 0;
    this.state = 'open';
    this.problem = null;
    this.byeText = null;
    this.welcomeMsg = m;
    this.session = { ...this.session, token: m.token, name: m.name };
    // The server's view of this session decides which table it has; a socket that comes back to none has lost it.
    if (m.table === undefined || m.seat === undefined) {
      this.tableView = null;
      this.mySeat = null;
      this.readyHeld = null;
      this.session = { ...this.session, table: null, codes: null };
      this.codeList = [];
      this.queueHeld = m.queue ?? null;
      this.searchHeld = this.searchOf(m.queue);
    } else {
      this.mySeat = m.seat;
      // After a reload nothing of the table is held, and a running game sends no `table` message (design 3.3): what the page kept stands in for it.
      if (!this.tableView && this.session.table?.table === m.table) this.tableView = this.fromStored(this.session.table, m.seat);
      if (this.tableView && this.tableView.table !== m.table) this.tableView = null;
      this.queueHeld = m.queue ?? null;
      this.searchHeld = this.searchOf(m.queue);
      this.restoreCodes(m.table);
    }
    this.storage.save(this.session);
    // Everything that rides on a socket starts again on this one: the view patches against the server's cache of this connection (a full view comes).
    this.syncing = false;
    this.startPing();
    const first = this.first;
    this.first = null;
    this.changed();
    first?.resolve();
    if (wasLost || this.openWaiters.length > 0) for (const w of this.openWaiters.splice(0)) w();
  }

  private fromStored(t: NonNullable<StoredSession['table']>, you: SeatNumber): TableView {
    return {
      table: t.table, title: t.title, format: t.format, variant: null, source: t.source, status: t.status,
      seats: t.seats.map((s) => ({ seat: s.seat, name: s.name, connected: true, deckAccepted: true, ready: false, left: false })),
      locked: false, clock: t.clock, you, creator: null, createdAt: 0,
    };
  }

  private restoreCodes(table: string): void {
    const c = this.session.codes;
    this.codeList = c && c.table === table ? c.list : [];
  }

  private onTable(t: TableView): void {
    if (this.tableView && this.tableView.table !== t.table) this.resetGame();
    this.tableView = t;
    this.mySeat = t.you;
    // A match found: this session has a table now, and is no longer in the queue.
    if (t.source === 'matched') this.searchHeld = null;
    if (t.status !== 'readyCheck') this.readyHeld = null;
    if (t.status === 'playing' || t.status === 'over') this.queueHeld = null;
    this.session = {
      ...this.session,
      table: {
        table: t.table, title: t.title, format: t.format, source: t.source, status: t.status, clock: t.clock,
        seats: t.seats.map((s) => ({ seat: s.seat, name: s.name })), you: t.you,
      },
    };
    this.storage.save(this.session);
    // A seat that sits down again is no longer away.
    this.seedAway(t);
    this.changed();
  }

  private seedAway(t: TableView): void {
    const next = new Map<SeatNumber, SeatAway>(this.awayMap);
    for (const s of t.seats) {
      if (s.name === null) next.delete(s.seat);
      else if (s.left) next.set(s.seat, 'left');
      else if (s.connected) next.delete(s.seat);
      else next.set(s.seat, 'dropped');
    }
    this.awayMap = next;
  }

  private onReadyCheck(m: ReadyCheckMessage): void {
    const span = this.tableView?.source === 'matched' ? HOSTED_TIMING.readyCheckMatchMs : HOSTED_TIMING.readyCheckTableMs;
    const now = this.now();
    // The deadline is the server's time of day: with a measured offset (the clocks of a game carry one) it is exact, otherwise a check that has just begun
    // has its whole span left. The server alone decides when the check ends; this is only the countdown the player sees.
    const exact = this.serverOffset === null ? span : m.deadlineAt - (now + this.serverOffset);
    const same = this.readyHeld?.start === m.start;
    const deadline = same ? this.readyHeld!.deadline : now + Math.max(0, Math.min(span, exact));
    const confirmed = m.players.find((p) => p.seat === this.mySeat)?.ready ?? false;
    this.readyHeld = { start: m.start, deadline, players: m.players, confirmed };
    this.changed();
  }

  private onView(seq: number, view: GameView, events: GameEvent[], legal: LegalAction[]): void {
    const held = this.heldView;
    if (held && seq < held.seq) return; // `seq` only goes up
    this.syncing = false;
    // A resend of the view held (a new socket) is not news: its events were shown already.
    this.heldView = held && seq === held.seq ? { seq, view, events: held.events, legal } : { seq, view, events, legal };
    this.changed();
  }

  private onPatch(m: Extract<HostedServerMessage, { t: 'patch' }>): void {
    const held = this.heldView;
    if (held && m.seq <= held.seq) return; // a patch for a view this page is past already
    const next = nextView(held ? { seq: held.seq, view: held.view } : null, m);
    if (!next) {
      this.askForView();
      return;
    }
    this.heldView = { seq: next.seq, view: next.view, events: m.events, legal: m.legal };
    this.changed();
  }

  /** A patch that does not fit: one `sync` for a full view (the server coalesces them to one per 5 s; patches meanwhile are dropped until it comes). */
  private askForView(): void {
    const now = this.now();
    if (this.syncing && now - this.syncSentAt < HOSTED_TIMING.syncEveryMs) return;
    this.syncing = true;
    this.syncSentAt = now;
    void this.command({ t: 'sync' }, { timeoutMs: 10_000 });
  }

  private onNotice(kind: NoticeKind, seat: SeatNumber | undefined, text: string): void {
    this.noticeList = this.trim([...this.noticeList, { n: ++this.counter, kind, ...(seat !== undefined ? { seat } : {}), text }], this.o.keepNotices);
    // An unstarted table that closes (its creator left, it expired, the server is restarting) is announced by this notice alone: no `table` message follows.
    if (this.tableView && this.isUnstarted(this.tableView) && (kind === 'tableClosed' || kind === 'tableExpired' || kind === 'serverDraining')) this.forgetTable();
    if (kind === 'queueLost') {
      // The server no longer holds this session's place in a matchmaking queue (a restart, a drain): it queues again with one click.
      this.searchHeld = null;
      if (this.queueHeld?.kind === 'match') this.queueHeld = null;
    }
    if (this.tableView?.source === 'matched' && this.isUnstarted(this.tableView) && (kind === 'readyCheckFailed' || kind === 'capacityTimeout')) this.matchDissolved(kind);
    if (seat !== undefined) {
      const next = new Map(this.awayMap);
      if (kind === 'playerDropped') next.set(seat, 'dropped');
      else if (kind === 'playerBack') next.delete(seat);
      else if (kind === 'playerLeft' || kind === 'timeout' || kind === 'forfeit') next.set(seat, 'left');
      this.awayMap = next;
    }
    this.changed();
  }

  /** Forgets the game the page held (a new game on this link). */
  private resetGame(): void {
    this.heldView = null;
    this.clockHeld = null;
    this.syncing = false;
    this.startHeld = null;
    this.proposalHeld = null;
    this.proposalEnd = null;
    this.noticeList = NO_NOTICES;
    this.chatList = NO_CHAT;
    this.resultHeld = null;
    this.awayMap = NO_AWAY;
  }

  private onReplyOk(p: { t: string; seats?: number; search?: { format: HostedFormatId; size: QueueSize } }, r: Extract<ReplyMessage, { ok: true }>): void {
    if (p.t === 'create' && r.codes && p.seats) {
      // A fresh table: the codes are for seats 2 and up, in order.
      this.setCodes(r.table ?? this.tableView?.table ?? '', r.codes.map((code, i) => ({ seat: (i + 2) as SeatNumber, code })));
    } else if (p.t === 'codes' && r.codes) {
      const open = this.tableView ? this.tableView.seats.filter((s) => s.name === null).map((s) => s.seat) : [];
      this.setCodes(r.table ?? this.tableView?.table ?? '', r.codes.map((code, i) => ({ seat: open[i] ?? ((i + 2) as SeatNumber), code })));
    } else if (p.t === 'queue' && p.search) {
      this.searchHeld = { ...p.search, since: this.now() };
    } else if (p.t === 'ready' && this.readyHeld && !this.readyHeld.confirmed) {
      // Confirmed: the button says so at once (the server's next `readyCheck` says the same), and a match that fails now puts this seat back in the queue.
      this.readyHeld = { ...this.readyHeld, confirmed: true };
    } else if (p.t === 'leave') {
      this.searchHeld = null;
      this.forgetTable();
    } else if (p.t === 'unqueue') {
      // Out of the matchmaking queue; at a table that waits for room, unqueue stands the seat up (a table's own lobby state is not touched by it).
      this.queueHeld = null;
      this.searchHeld = null;
      if (this.tableView?.status === 'waitingCapacity') this.forgetTable();
    }
  }

  /** The matchmaking queue a `welcome` or `queueStatus` puts this session in, keeping the time it entered when it was in it already. */
  private searchOf(q: QueueStatus | undefined): HeldSearch | null {
    return q?.kind === 'match' ? { format: q.format, size: q.size, since: this.searchHeld?.since ?? this.now() } : null;
  }

  /**
   * A match that will not start (design 4.5): a ready check that ran out, or a start that waited too long for room. The table is gone for this seat. A seat
   * that had confirmed the check goes back to the front of the queue (its waiting time kept); the others left it, and so did everyone when the server is
   * too busy.
   */
  private matchDissolved(kind: NoticeKind): void {
    const t = this.tableView!;
    const requeue = kind === 'readyCheckFailed' && this.readyHeld?.confirmed === true;
    this.forgetTable();
    this.searchHeld = requeue ? { format: t.format, size: t.seats.length === 2 ? 2 : 'pod', since: this.now() } : null;
  }

  private isUnstarted(t: TableView): boolean {
    return t.status === 'lobby' || t.status === 'waitingCapacity' || t.status === 'readyCheck';
  }

  /** This session has no table any more (it left, it was closed): nothing of it is held here or kept in storage. */
  private forgetTable(): void {
    this.tableView = null;
    this.mySeat = null;
    this.readyHeld = null;
    this.queueHeld = null;
    this.codeList = [];
    this.session = { ...this.session, table: null, codes: null };
    this.storage.save(this.session);
  }

  private setCodes(table: string, list: InviteCode[]): void {
    this.codeList = list;
    this.session = { ...this.session, codes: { table, list } };
    this.storage.save(this.session);
  }

  // ---- commands

  /** The next command number; kept in storage before it is used, so a reload never repeats or lowers one. */
  private takeId(): number {
    const id = this.session.nextId;
    this.session = { ...this.session, nextId: id + 1 };
    this.storage.save(this.session);
    return id;
  }

  /**
   * Sends a command and resolves with its reply (never rejects). `timeoutMs`: give up waiting (the server may still do it). `waitOpenMs`: when the socket is
   * down and being reopened, wait this long for it before giving up (a Leave must not be lost to a flicker). `maxPaceMs`: the longest it waits for the
   * command's turn (default 15 s); a longer wait answers `rateLimited` at once, with `retryAfterMs`, and sends nothing.
   */
  async command(c: HostedCommand, opts: { timeoutMs?: number; waitOpenMs?: number; maxPaceMs?: number } = {}): Promise<Reply> {
    if (this.state !== 'open' && opts.waitOpenMs && this.state === 'lost') await this.waitOpen(opts.waitOpenMs);
    if (!this.isOpen()) return this.notOpen();
    const wait = this.pacer.reserve(c.t, opts.maxPaceMs ?? 15_000);
    if (wait < 0) {
      return { ok: false, error: { code: 'rateLimited', message: 'That was sent a moment ago; wait before trying again.', retryAfterMs: -wait } };
    }
    if (wait > 0) {
      await new Promise<void>((r) => setTimeout(r, wait));
      if (!this.isOpen()) return this.notOpen();
    }
    const id = this.takeId();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (r: Reply) => {
        if (timer) clearTimeout(timer);
        resolve(r);
      };
      this.pending.set(id, {
        t: c.t, ...(c.t === 'create' ? { seats: c.seats } : {}), ...(c.t === 'queue' ? { search: { format: c.format, size: c.size } } : {}), resolve: finish,
      });
      if (opts.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          if (!this.pending.delete(id)) return;
          resolve({ ok: false, error: { code: 'timeout', message: 'The game server did not answer in time.' } });
        }, opts.timeoutMs);
      }
      if (!this.send({ ...c, id } as HostedClientMessage)) {
        this.pending.delete(id);
        finish({ ok: false, error: { code: 'disconnected', message: 'Could not send to the game server.' } });
      }
    });
  }

  private isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === OPEN && this.state === 'open';
  }

  private notOpen(): Reply {
    return { ok: false, error: { code: 'disconnected', message: this.problem ?? 'Not connected to the game server.' } };
  }

  /** Milliseconds until a command of this kind could be sent without waiting for its turn (0: now); nothing is taken. */
  readonly delayFor = (t: HostedClientType): number => this.pacer.delay(t);

  private waitOpen(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.openWaiters = this.openWaiters.filter((w) => w !== done);
        resolve();
      }, ms);
      this.openWaiters.push(done);
    });
  }

  /** An engine action for this seat, chosen from the view held now (its `seq`). The reply comes after the change it caused. No timeout: a by-hand answer waits for the others' approval. */
  act(action: Action): Promise<Reply> {
    const seq = this.heldView?.seq;
    if (seq === undefined) return Promise.resolve({ ok: false, error: { code: 'notStarted', message: 'The game has not started yet.' } });
    return this.command({ t: 'act', seq, action });
  }

  /** Approve or reject another player's by-hand changes. */
  vote(proposal: number, accept: boolean, reason?: string): Promise<Reply> {
    return this.command({ t: 'vote', proposal, accept, ...(reason ? { reason } : {}) }, { timeoutMs: 15_000 });
  }

  /** A line to the table (the server sends it back to every seat, this one included). */
  say(text: string): Promise<Reply> {
    return this.command({ t: 'chat', text }, { timeoutMs: 15_000 });
  }

  /** Before the start: stand up (the creator closing the table). During a game: concede and leave. After the end: leave the table. */
  leave(): Promise<Reply> {
    return this.command({ t: 'leave' }, { timeoutMs: 10_000, waitOpenMs: 4000 });
  }

  /** Leave the matchmaking queue, or the line for room on a busy server (a table that waits for room: the seat stands up). */
  unqueue(): Promise<Reply> {
    return this.command({ t: 'unqueue' }, { timeoutMs: 10_000, waitOpenMs: 4000 });
  }

  /** Confirm the running ready check. */
  confirm(start: string): Promise<Reply> {
    return this.command({ t: 'ready', start }, { timeoutMs: 10_000 });
  }

  /** The creator of a private table, before the start: new codes for the open seats (the old ones stop working). */
  newCodes(): Promise<Reply> {
    return this.command({ t: 'codes' }, { timeoutMs: 15_000 });
  }

  /** Whether this session has a table or a game at the server (it takes part in one at a time). */
  hasTable(): boolean {
    return this.mySeat !== null;
  }
}
