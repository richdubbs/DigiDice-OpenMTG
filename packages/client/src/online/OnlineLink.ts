/**
 * The browser's side of online play (milestone 9, docs/design/online.md "Browser and local server"): the localhost WebSocket to this player's own OpenMTG
 * server, which plays the game over UDP (packages/net) as the host or the guest. The browser never talks to the other player directly.
 *
 *   1. GET /api/online/session -> { token, protocol } (same origin; the server answers only its own page, audit 2026-10-12 m11).
 *   2. ws://<this page's host>/api/online/socket?token=<token>
 *   3. The server sends `status` at once (and the current view, if a game runs), then on every change; every command gets one `reply` with its id.
 *
 * One link per page. It keeps what the server last said (status, the latest view with its events and legal actions, a waiting manual proposal, notices,
 * chat) and announces every change through `subscribe`; every getter returns the same object until something changes (React's useSyncExternalStore).
 * Closing the socket does not end the game (the server keeps it; a new socket gets the status and the view again): `leave` does.
 *
 * A socket that drops for no reason (not replaced by another tab, not the server stopping, not closed here) is opened again after `retryMs`, up to
 * `maxRetries` times in a row; commands waiting for a reply are answered `disconnected` (the server may or may not have done them: the next view says).
 *
 * RPL-3 (replays design 6, 16.3): this player's "Show my cards in replays" (`setReplayConsent`; the status's `replay` says what the server holds), the
 * whole game when the host shared it (`replayGame()`: a guest's, gzip in base64, as the server passed it on; the page checks it before keeping it,
 * online/recording.ts), and the replays API of this server (`request`: the host's page reads its game's record, online/hostReplay.ts).
 */
import type { Action, PlayerId } from '@openmtg/engine';
import {
  CHAT_HISTORY_LINES, CLOSE_PROTOCOL, CLOSE_REPLACED, CLOSE_SHUTDOWN, ONLINE_PROTOCOL, ONLINE_SESSION_PATH, ONLINE_SOCKET_PATH, type ClientMessage, type OnlineDeck, type OnlineError,
  type OnlineManualProposal, type OnlineSessionResponse, type OnlineStatus, type ServerMessage,
} from '@openmtg/server/online';

/** What the link needs of a WebSocket (the browser's own; tests pass a fake, the two-server test Node's). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

const OPEN = 1;

export type ViewMessage = Extract<ServerMessage, { t: 'view' }>;
export type Reply = { ok: true } | { ok: false; error: OnlineError };
/** A command without its id (the link numbers them). */
export type Command = ClientMessage extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never;

/** The socket to the local server: connecting, open, lost (dropped; trying again or given up), closed (by this page, or for good). */
export type LinkState = 'connecting' | 'open' | 'lost' | 'closed';

export interface OnlineNotice {
  /** Counts up from 1 for each notice of this link (React keys, "new since"). */
  n: number;
  kind: Extract<ServerMessage, { t: 'notice' }>['kind'];
  text: string;
  /** M12-5b: the player the notice is about (a 3-4 player game: who joined, left, dropped, came back or forfeited). */
  player?: PlayerId;
}

export interface ChatLine {
  n: number;
  /** This player's own line, or another player's ('opponent': in a 3-4 player game, any other player; `player` says who). */
  from: 'me' | 'opponent';
  text: string;
  /** M12-5b: the sender of another player's line (a 3-4 player game: every line has one). */
  player?: PlayerId;
  /** M12F: a line the local server kept and sent again (`chatHistory`: a reloaded page), not news. */
  history?: true;
}

/** M12-5b: how a manual adjustments proposal ended (3-4 players: `manualClosed` with an outcome), described with the proposal it closed. */
export interface ManualOutcome {
  n: number;
  proposal: number;
  outcome: 'applied' | 'rejected' | 'withdrawn' | 'failed';
  /** Who rejected it. */
  by?: PlayerId;
  /** Who proposed it, and for what (from the proposal this link last held; absent when it never had it). */
  player?: PlayerId;
  sourceName?: string;
}

export interface OnlineLinkOptions {
  /** Where the local server is: '' (default) for this page's own origin; a test gives `http://127.0.0.1:<port>`. */
  base?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Opens the WebSocket (default: the browser's `WebSocket`). */
  socket?: (url: string) => SocketLike;
  /** How long a `host` or `join` may take before the page gives up waiting (ms; the server has its own, shorter handshake timeout). */
  setupTimeoutMs?: number;
  retryMs?: number;
  maxRetries?: number;
  /** Notices kept (the oldest go first). */
  keep?: number;
  /** M12F: chat lines kept (the oldest go first; default the local server's CHAT_HISTORY_LINES). */
  keepChat?: number;
}

/** An error of the link itself (no server, wrong protocol), with an OnlineError code the screens explain (errors.ts). */
export class OnlineLinkError extends Error {
  constructor(
    readonly code: OnlineError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'OnlineLinkError';
  }
}

const IDLE: OnlineStatus = { role: 'none', phase: 'idle', warnings: [] };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** The ws:// URL of the socket for a page at `base` ('' = this page). */
export function socketUrl(base: string, token: string): string {
  const origin = base || (typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1');
  const u = new URL(ONLINE_SOCKET_PATH, origin);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('token', token);
  return u.toString();
}

export class OnlineLink {
  private readonly o: Required<Omit<OnlineLinkOptions, 'socket' | 'fetch'>> & Pick<OnlineLinkOptions, 'socket' | 'fetch'>;
  private ws: SocketLike | null = null;
  private token: string | null = null;
  private state: LinkState = 'connecting';
  private problem: string | null = null;
  private st: OnlineStatus = IDLE;
  private lastView: ViewMessage | null = null;
  private waiting: OnlineManualProposal | null = null;
  private noticeList: readonly OnlineNotice[] = [];
  private chatList: readonly ChatLine[] = [];
  private outcome: ManualOutcome | null = null;
  /** RPL-3: the game the host shared (a guest), as the server passed it on. */
  private sharedGame: string | null = null;
  private counter = 0;
  private nextId = 1;
  private readonly pending = new Map<number, (r: Reply) => void>();
  private readonly listeners = new Set<() => void>();
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Resolves the first `status` after a socket opens (connect()). */
  private statusWaiter: (() => void) | null = null;
  private closedHere = false;

  constructor(opts: OnlineLinkOptions = {}) {
    this.o = { base: '', setupTimeoutMs: 45000, retryMs: 1000, maxRetries: 5, keep: 50, keepChat: CHAT_HISTORY_LINES, ...opts };
  }

  // ---- getters (stable between changes)

  readonly status = (): OnlineStatus => this.st;
  readonly view = (): ViewMessage | null => this.lastView;
  readonly proposal = (): OnlineManualProposal | null => this.waiting;
  readonly notices = (): readonly OnlineNotice[] => this.noticeList;
  readonly chat = (): readonly ChatLine[] => this.chatList;
  /** M12-5b: how the last manual adjustments proposal of a 3-4 player game ended; null before any, and after a new game began. */
  readonly manualOutcome = (): ManualOutcome | null => this.outcome;
  /** RPL-3: the whole game as the host shared it (a guest: gzip in base64, unchecked), or null; cleared when a new game begins. */
  readonly replayGame = (): string | null => this.sharedGame;
  readonly linkState = (): LinkState => this.state;
  /** Why the socket is lost or closed, in words (null while it is fine). */
  readonly linkProblem = (): string | null => this.problem;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed(): void {
    for (const l of [...this.listeners]) l();
  }

  // ---- connecting

  /**
   * Get the token and open the socket; resolves once the server's first status arrived. Rejects with an OnlineLinkError: no local server (`closed`),
   * a page and server of different versions (`version`), a socket that would not open (`disconnected`).
   */
  async connect(): Promise<void> {
    this.closedHere = false;
    if (this.token === null) {
      const doFetch = this.o.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
      let res: Response;
      try {
        res = await doFetch(`${this.o.base}${ONLINE_SESSION_PATH}`, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
      } catch (e) {
        throw this.fail('closed', `The local OpenMTG server does not answer (${e instanceof Error ? e.message : String(e)}). Start it with npm run play.`);
      }
      if (!res.ok) throw this.fail('closed', `The local OpenMTG server refused online play (HTTP ${res.status}). Open OpenMTG from the address npm run play prints.`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const session = body as OnlineSessionResponse | null;
      if (!isObject(session) || typeof session.token !== 'string' || typeof session.protocol !== 'number') throw this.fail('closed', 'The local OpenMTG server gave no online session.');
      if (session.protocol !== ONLINE_PROTOCOL)
        throw this.fail('version', `This page and the local OpenMTG server are different versions (online protocol ${ONLINE_PROTOCOL} and ${session.protocol}). Reload the page; if that does not help, restart OpenMTG.`);
      this.token = session.token;
    }
    await this.open();
  }

  private fail(code: OnlineError['code'], message: string): OnlineLinkError {
    this.state = 'closed';
    this.problem = message;
    this.changed();
    return new OnlineLinkError(code, message);
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const make = this.o.socket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
      let ws: SocketLike;
      try {
        ws = make(socketUrl(this.o.base, this.token!));
      } catch (e) {
        reject(this.fail('disconnected', `The socket to the local OpenMTG server could not be opened (${e instanceof Error ? e.message : String(e)}).`));
        return;
      }
      this.ws = ws;
      this.state = 'connecting';
      this.changed();
      let settled = false;
      this.statusWaiter = () => {
        if (settled) return;
        settled = true;
        this.retries = 0;
        resolve();
      };
      ws.onmessage = (ev) => {
        if (this.ws === ws) this.receive(ev.data);
      };
      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.state = 'open';
        this.problem = null;
        this.changed();
      };
      ws.onerror = () => undefined; // the close event follows
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.dropped(ev.code, ev.reason);
        if (!settled) {
          settled = true;
          reject(new OnlineLinkError('disconnected', this.problem ?? 'The socket to the local OpenMTG server closed.'));
        }
      };
    });
  }

  private dropped(code: number, reason: string): void {
    this.statusWaiter = null;
    for (const [id, done] of [...this.pending]) {
      this.pending.delete(id);
      done({ ok: false, error: { code: 'disconnected', message: 'The connection to the local OpenMTG server dropped before it answered.' } });
    }
    if (this.closedHere) {
      this.state = 'closed';
      this.problem = null;
    } else if (code === CLOSE_REPLACED) {
      this.state = 'closed';
      this.problem = 'This game was opened in another tab or window; play it there (or reload this page to take it back).';
    } else if (code === CLOSE_SHUTDOWN) {
      this.state = 'closed';
      this.problem = 'The local OpenMTG server stopped, and the online game with it.';
    } else if (code === CLOSE_PROTOCOL) {
      this.state = 'closed';
      this.problem = `The local OpenMTG server closed the connection: ${reason || 'protocol error'}.`;
    } else if (this.retries < this.o.maxRetries) {
      this.state = 'lost';
      this.problem = 'Lost the connection to the local OpenMTG server; trying again…';
      this.retries++;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.closedHere) return;
        this.open().catch(() => undefined);
      }, this.o.retryMs);
    } else {
      this.state = 'closed';
      this.problem = 'Lost the connection to the local OpenMTG server. Check that OpenMTG is still running, then reload the page.';
    }
    this.changed();
  }

  /** Close the socket (the game goes on at the server; `leave` first to end it). */
  close(): void {
    this.closedHere = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(1000, 'closed by the page');
      } catch {
        // already closing
      }
      this.dropped(1000, '');
    } else if (this.state !== 'closed') {
      this.state = 'closed';
      this.changed();
    }
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
    const msg = m as unknown as ServerMessage;
    switch (msg.t) {
      case 'status':
        this.st = msg.status;
        // A new game (or none): the old game's view and proposal are gone.
        if (msg.status.phase === 'idle' || msg.status.phase === 'starting' || msg.status.phase === 'joining' || msg.status.phase === 'waiting') {
          this.lastView = null;
          this.waiting = null;
          this.outcome = null;
          this.sharedGame = null;
        }
        // M12F: a game being set up starts its own chat (the local server keeps one per game, `chatHistory`)
        if (msg.status.phase === 'starting' || msg.status.phase === 'joining') this.chatList = [];
        this.changed();
        if (this.statusWaiter) {
          const w = this.statusWaiter;
          this.statusWaiter = null;
          w();
        }
        return;
      case 'view':
        // `seq` only goes up; a resend (a new socket, `status`) repeats the last view without its events, which were shown already.
        if (this.lastView && msg.seq < this.lastView.seq) return;
        this.lastView = msg;
        this.changed();
        return;
      case 'reply': {
        const done = this.pending.get(msg.id);
        if (!done) return;
        this.pending.delete(msg.id);
        done(msg.ok ? { ok: true } : { ok: false, error: msg.error });
        return;
      }
      case 'manualProposal':
        this.waiting = msg.proposal;
        this.changed();
        return;
      case 'manualClosed': {
        const held = this.waiting?.id === msg.proposal ? this.waiting : null;
        if (held) this.waiting = null;
        // M12-5b: a 3-4 player game says how it ended (applied, rejected by whom, withdrawn, failed).
        if (msg.outcome) {
          this.outcome = {
            n: ++this.counter, proposal: msg.proposal, outcome: msg.outcome, ...(msg.by ? { by: msg.by } : {}),
            ...(held?.player ? { player: held.player } : {}), ...(held ? { sourceName: held.sourceName } : {}),
          };
        }
        if (held || msg.outcome) this.changed();
        return;
      }
      case 'chat':
        this.chatList = this.trim([...this.chatList, { n: ++this.counter, from: 'opponent', text: msg.text, ...(msg.from ? { player: msg.from } : {}) }], this.o.keepChat);
        this.changed();
        return;
      case 'chatHistory': {
        // M12F: the table's chat as the local server kept it (a reloaded page, a new socket, `status`): it replaces the lines held here
        const lines = Array.isArray(msg.lines) ? msg.lines.filter((l) => isObject(l) && typeof l.text === 'string') : [];
        const same = lines.length === this.chatList.length && lines.every((l, i) => {
          const c = this.chatList[i]!;
          return c.text === l.text && c.from === (l.mine ? 'me' : 'opponent') && c.player === l.from;
        });
        if (same) return;
        this.chatList = this.trim(lines.map((l): ChatLine => ({ n: ++this.counter, from: l.mine ? 'me' : 'opponent', text: l.text, ...(!l.mine && l.from ? { player: l.from } : {}), history: true })), this.o.keepChat);
        this.changed();
        return;
      }
      case 'notice':
        this.noticeList = this.trim([...this.noticeList, { n: ++this.counter, kind: msg.kind, text: msg.text, ...(msg.player ? { player: msg.player } : {}) }]);
        this.changed();
        return;
      case 'replayGame':
        // RPL-3: kept as it came (a text of at most the server's bound); what it holds is checked where it is kept (online/recording.ts).
        if (typeof msg.data !== 'string' || msg.data === this.sharedGame) return;
        this.sharedGame = msg.data;
        this.changed();
        return;
    }
  }

  private trim<T>(list: T[], keep = this.o.keep): readonly T[] {
    return list.length > keep ? list.slice(list.length - keep) : list;
  }

  // ---- commands

  /** Send a command; resolves with its reply (never rejects). `timeoutMs`: give up waiting (the server may still do it). */
  command(c: Command, timeoutMs?: number): Promise<Reply> {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN || this.state !== 'open') {
      return Promise.resolve({ ok: false, error: { code: 'disconnected', message: this.problem ?? 'Not connected to the local OpenMTG server.' } });
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      this.pending.set(id, (r) => {
        if (timer) clearTimeout(timer);
        resolve(r);
      });
      if (timeoutMs !== undefined)
        timer = setTimeout(() => {
          if (!this.pending.delete(id)) return;
          resolve({ ok: false, error: { code: 'timeout', message: 'The local OpenMTG server did not answer in time.' } });
        }, timeoutMs);
      try {
        ws.send(JSON.stringify({ ...c, id }));
      } catch (e) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        resolve({ ok: false, error: { code: 'disconnected', message: `Could not send to the local OpenMTG server (${e instanceof Error ? e.message : String(e)}).` } });
      }
    });
  }

  /** `seats` (M12-5b): a 3- or 4-player game (one join code per guest seat); left out, a two-player game. */
  host(a: { name: string; deck: OnlineDeck; format?: string; port?: number; seats?: 3 | 4 }): Promise<Reply> {
    return this.command(
      { t: 'host', name: a.name, deck: a.deck, ...(a.format ? { format: a.format } : {}), ...(a.port !== undefined ? { port: a.port } : {}), ...(a.seats ? { seats: a.seats } : {}) },
      this.o.setupTimeoutMs,
    );
  }

  join(a: { address: string; code: string; name: string; deck: OnlineDeck }): Promise<Reply> {
    return this.command({ t: 'join', address: a.address, code: a.code, name: a.name, deck: a.deck }, this.o.setupTimeoutMs);
  }

  /** No timeout: a guest's manual answer waits for the host player's consent. */
  act(action: Action): Promise<Reply> {
    return this.command({ t: 'act', action });
  }

  answerProposal(proposal: number, accept: boolean, reason?: string): Promise<Reply> {
    return this.command({ t: 'manual', proposal, accept, ...(reason ? { reason } : {}) });
  }

  /** Host only: end the game for a guest that left (CR 104.3a). `player` (M12-5b): which guest of a 3-4 player game. */
  forfeit(player?: PlayerId): Promise<Reply> {
    return this.command({ t: 'forfeit', ...(player ? { player } : {}) });
  }

  async say(text: string): Promise<Reply> {
    const r = await this.command({ t: 'chat', text });
    if (r.ok) {
      this.chatList = this.trim([...this.chatList, { n: ++this.counter, from: 'me', text }], this.o.keepChat);
      this.changed();
    }
    return r;
  }

  /**
   * RPL-3: this player's "Show my cards in replays" (their hand, face-down cards and decklist; default off). The host keeps every player's last choice;
   * once the game was shared it is final. The status's `replay.agree` follows.
   */
  setReplayConsent(agree: boolean): Promise<Reply> {
    return this.command({ t: 'replayConsent', agree });
  }

  /**
   * RPL-3: a request to this player's own OpenMTG server (`path` from its root, the replays API of api.ts), with the link's base and fetch. Rejects
   * when the server cannot be reached.
   */
  request(path: string, init: RequestInit = {}): Promise<Response> {
    const doFetch = this.o.fetch ?? ((url: string, i?: RequestInit) => fetch(url, i));
    return doFetch(`${this.o.base}${path}`, { headers: { Accept: 'application/json' }, cache: 'no-store', ...init });
  }

  /**
   * End the game for this side (the other side is told) and go back to idle. M12-5b: the host of a running 3-4 player game concedes and its server keeps
   * running the game for the others (`spectating`); a second `leave` closes it (the game ends for everyone without a result).
   */
  leave(): Promise<Reply> {
    return this.command({ t: 'leave' }, 10000);
  }

  /** Whether a game is open at the server (hosting, joining, playing, over): a new host or join must leave it first. */
  hasGame(): boolean {
    return this.st.phase !== 'idle' && this.st.phase !== 'closed';
  }
}
