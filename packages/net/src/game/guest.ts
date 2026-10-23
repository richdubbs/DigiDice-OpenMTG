/**
 * The guest side of an online game (docs/design/online.md): connects to the host, submits its decklist by names, then sends Actions and renders
 * the views the host sends. It never holds the full state. After a drop it reconnects by itself (a new handshake with fresh keys), takes its
 * seat back with the session token and re-requests the latest view (`sync`); the host's action log makes the game itself unaffected. A new process
 * can take the seat back too: keep `session` and pass it as `resume`.
 *
 * Every action names the view it was chosen from (`seq`) and carries an id that goes on across reconnects, so the host applies it at most once. After
 * a drop, look at the synced view and resend only what it shows was not applied (a resend is refused as 'stale' if the game moved on meanwhile).
 *
 * M12-5a (m12 design 6): in a 3-4 player game the guest holds its seat's join code (`seat`, `seats` from `welcome`), waits in the lobby until every seat
 * is taken (`lobby`, then `start` with the table in seating order), follows the table's links and drop clocks (`presence`, `notice`), answers the other
 * players' manual adjustments (`manualProposal`, `vote`), and chats with everyone (each line with its sender).
 *
 * RPL-3 (protocol 5; replays design 6, 16.3): this player's "Show my cards in replays" goes to the host (`setReplayConsent`; sent again after a
 * reconnection, and never on its own: a new process says nothing until its player chooses, so the host keeps the last choice made). When the game is
 * over and every player agreed, the host sends this guest the whole game as a replay file (`replayGame`, kept in `replayData`); a malformed one is
 * dropped by the protocol's check (parseHostMessage) and this guest keeps only what it was shown.
 */
import type { Action, ActionError, GameEvent, GameView, LegalAction, PlayerId } from '@openmtg/engine';
import { NetError, type NetErrorCode } from '../errors';
import type { Connection } from '../link/connection';
import { connect, type EndpointOptions } from '../link/endpoint';
import {
  msg, parseHostMessage,
  type DeckSubmission, type ErrorMessage, type HelloMessage, type ManualClosedMessage, type ManualProposalMessage, type NoticeKind, type WelcomeMessage,
} from '../protocol/messages';
import { cleanText } from '../protocol/text';
import { localVersions } from '../protocol/versions';
import { helloProof } from '../wire/crypto';
import { Emitter } from './emitter';

export interface GuestOptions extends EndpointOptions {
  host: string;
  port: number;
  code: string;
  name: string;
  deck: DeckSubmission;
  rulesPack?: string | null;
  /** Automatic reconnection after a drop (default: 30 attempts, 1 s apart). */
  reconnect?: { attempts?: number; delayMs?: number };
  /** How long to wait for `welcome` after the handshake (ms). */
  welcomeTimeout?: number;
  /** Take a seat back with the session token of an earlier GameGuest (`session`), e.g. after a restart; `deck` is then not sent. */
  resume?: string;
  /** Diagnostics and tests: sees every message received from the host, before it is handled. */
  inspect?: (message: unknown) => void;
  /**
   * Another transport for the link (in-process tests: link/memory.ts). Called for the first handshake and for each reconnection; default: a UDP
   * handshake with `host`:`port` (endpoint.ts, `connect`).
   */
  connector?: (o: GuestOptions) => Promise<Connection>;
}

/** M12-5a: one player of a 3-4 player table as this guest knows them (`GameGuest.players`). */
export interface GuestTablePlayer {
  id: PlayerId;
  name: string;
  seat: number;
  connected: boolean;
  /** Left the game (CR 104.5, 800.4a). */
  left?: boolean;
  /** While their link is down: when they forfeit, on this machine's clock (Date.now() ms; the host's clock counts). */
  forfeitAt?: number;
}

/** M12-5a: manual adjustments of a player of a 3-4 player game, in words as this guest may know the game (CR 400.2). */
export type GuestManualProposal = ManualProposalMessage['proposal'];

type GuestEvents = {
  view: [view: GameView, events: GameEvent[]];
  /** An error the host reported (an illegal action, a refused message). */
  error: [error: ErrorMessage];
  chat: [text: string, from: PlayerId | undefined];
  disconnected: [reason: string];
  reconnected: [];
  /** The game is over for this guest: it left, the host left, or reconnecting failed. */
  closed: [reason: string];
  /** M12-5a: the table changed (`players`): the lobby before the start, links, drop clocks and players who left during the game. */
  table: [players: GuestTablePlayer[]];
  /** M12-5a: the 3-4 player game was created: the table in seating order (CR 806.3). */
  start: [players: GuestTablePlayer[]];
  /** M12-5a: a line about a player (joined, left, dropped, back, forfeited). */
  notice: [kind: NoticeKind, player: PlayerId, text: string];
  /** M12-5a: manual adjustments of a player (another's: answer with `vote`; this guest's own: who is still to answer), again after each answer. */
  manualProposal: [proposal: GuestManualProposal];
  /** M12-5a: a proposal closed. */
  manualClosed: [closed: Omit<ManualClosedMessage, 'v' | 'type'>];
  /** RPL-3: the host sent the whole game (every player agreed, after the end): a replay file, gzipped, in base64 (protocol 5 `replayGame`). */
  replayGame: [data: string];
};

export type GuestActResult = { ok: true } | { ok: false; error: ActionError & { code: NetErrorCode } };

/** Errors after which reconnecting cannot help. */
const FINAL: ReadonlySet<NetErrorCode> = new Set<NetErrorCode>(['badCode', 'version', 'rulesPack', 'gameFull', 'deckRejected']);

export class GameGuest extends Emitter<GuestEvents> {
  player: PlayerId = '';
  /**
   * The host's player (protocol 4: `welcome.host`). In a two-player game it is the one opponent, as in milestone 9; in a 3-4 player game the table is
   * `players`.
   */
  opponent: { id: PlayerId; name: string } = { id: '', name: '' };
  /** M12-5a: this guest's seat (2-4) in a 3-4 player game; null in a two-player game. */
  seat: number | null = null;
  /** M12-5a: the seats at the table (2 in a two-player game). */
  seats = 2;
  /** M12-5a: the table of a 3-4 player game (seat order in the lobby, seating order once it started); empty in a two-player game. */
  players: GuestTablePlayer[] = [];
  /** M12-5a: the 3-4 player game was created (`start`); a two-player game: once the first view arrived. */
  started = false;
  /** M12-5a: the proposal of manual adjustments open now, if any (3-4 players: the host's, in a two-player game). */
  proposal: GuestManualProposal | null = null;
  format = '';
  warnings: string[] = [];
  /** The latest view (null until the first one arrives). */
  view: GameView | null = null;
  /** The guest's legal priority actions in the latest view. */
  legal: LegalAction[] = [];
  /** Actions applied by the host when the latest view was made. */
  seq = -1;
  /** RPL-3: the game as a replay file (gzip, base64), once the host shared it (every player agreed, after the end); null before. */
  replayData: string | null = null;
  /** RPL-3: this player's last "Show my cards in replays" (null: not chosen in this process). */
  private consent: boolean | null = null;
  private conn: Connection | null = null;
  private token: string | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, (r: GuestActResult) => void>();
  private welcomeWaiter: { resolve: (w: WelcomeMessage) => void; reject: (e: NetError) => void } | null = null;
  private leaving = false;
  private ended = false;
  /** True once the current connection's welcome arrived (false during a handshake and while reconnecting). */
  private ready = false;
  private reconnecting = false;

  private constructor(private readonly o: GuestOptions) {
    super();
  }

  /** Connect, submit the deck and wait for `welcome`. Rejects with a NetError ('badCode', 'timeout', 'version', 'deckRejected', 'gameFull', ...). */
  static async join(o: GuestOptions): Promise<GameGuest> {
    const g = new GameGuest(o);
    if (o.resume) g.token = o.resume;
    const welcome = await g.handshake();
    g.player = welcome.player;
    g.opponent = welcome.host;
    g.seat = welcome.seat ?? null;
    g.seats = welcome.seats ?? 2;
    g.format = welcome.format;
    g.warnings = welcome.warnings;
    g.token = welcome.session;
    if (welcome.resumed) g.sync();
    return g;
  }

  /** The session token: keep it to take the seat back from a new process (GuestOptions.resume). */
  get session(): string | null {
    return this.token;
  }

  get connected(): boolean {
    return this.ready && this.conn !== null && !this.conn.closed;
  }

  /** The current connection (for diagnostics and tests). */
  get connection(): Connection | null {
    return this.conn;
  }

  /** Send an action for this guest's player; resolves when the host answered with a new view or an error. */
  act(action: Action): Promise<GuestActResult> {
    const conn = this.conn;
    if (!conn || conn.closed || !this.ready) return Promise.resolve({ ok: false, error: { code: 'disconnected', message: 'Not connected to the host.', rules: [] } });
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      conn.send(msg({ type: 'action', id, seq: Math.max(0, this.seq), action }));
    });
  }

  /** Ask the host for the latest view again. */
  sync(): void {
    this.conn?.send(msg({ type: 'sync' }));
  }

  chat(text: string): void {
    this.conn?.send(msg({ type: 'chat', text: cleanText(text).slice(0, 500) }));
  }

  /**
   * RPL-3: this player's "Show my cards in replays" (default off; replays design 6). Kept, and sent to the host now when the link is up and again after
   * each reconnection; the host keeps the last choice it got. Returns whether it was sent now.
   */
  setReplayConsent(agree: boolean): boolean {
    this.consent = agree;
    return this.sendConsent();
  }

  private sendConsent(): boolean {
    const conn = this.conn;
    if (this.consent === null || !conn || conn.closed || !this.ready) return false;
    conn.send(msg({ type: 'replayConsent', agree: this.consent }));
    return true;
  }

  /**
   * M12-5a: this player's answer to another player's manual adjustments (`manualProposal`). The host applies them once every other
   * player still in the game accepted; one rejection rejects them. A refusal (no such proposal, answered already) comes back as an `error`.
   */
  vote(proposal: number, accept: boolean, reason?: string): boolean {
    const conn = this.conn;
    if (!conn || conn.closed || !this.ready) return false;
    conn.send(msg({ type: 'manualVote', proposal, accept, ...(reason !== undefined ? { reason: cleanText(reason).slice(0, 500) } : {}) }));
    return true;
  }

  async close(reason = 'guest left'): Promise<void> {
    if (this.ended) return;
    this.leaving = true;
    const c = this.conn;
    if (c && !c.closed) {
      c.send(msg({ type: 'bye', reason }));
      await c.flush(500);
      c.close(reason);
    }
    this.end(reason);
  }

  // ---- connection handling

  private async handshake(): Promise<WelcomeMessage> {
    this.ready = false;
    const conn = await (this.o.connector ?? connect)(this.o);
    this.conn = conn;
    conn.onMessage((raw) => this.onMessage(conn, raw));
    conn.onClose((reason) => this.onClose(conn, reason));
    const hello: HelloMessage = msg<HelloMessage>({
      type: 'hello', versions: localVersions(this.o.rulesPack ?? null), name: cleanText(this.o.name).slice(0, 40), deck: this.token ? { main: [], sideboard: [] } : this.o.deck,
      proof: helloProof(conn.keys, conn.connId), ...(this.token ? { resume: this.token } : {}),
    });
    return await new Promise<WelcomeMessage>((resolve, reject) => {
      const timer = setTimeout(() => fail(new NetError('timeout', 'The host did not answer the join request.')), this.o.welcomeTimeout ?? 15000);
      const fail = (e: NetError) => {
        clearTimeout(timer);
        this.welcomeWaiter = null;
        conn.close(e.message);
        reject(e);
      };
      this.welcomeWaiter = {
        resolve: (w) => {
          clearTimeout(timer);
          this.welcomeWaiter = null;
          this.ready = true;
          resolve(w);
        },
        reject: fail,
      };
      conn.send(hello);
    });
  }

  private onMessage(conn: Connection, raw: unknown): void {
    if (conn !== this.conn) return;
    this.o.inspect?.(raw);
    const m = parseHostMessage(raw);
    if (!m) return;
    switch (m.type) {
      case 'welcome':
        this.nextId = Math.max(this.nextId, m.lastAction + 1); // ids go on after the last action the host applied (a new process starts at 1)
        this.seat = m.seat ?? null;
        this.seats = m.seats ?? 2;
        this.welcomeWaiter?.resolve(m);
        return;
      case 'error': {
        if (this.welcomeWaiter && m.fatal) return this.welcomeWaiter.reject(new NetError(m.code, m.message, m.details ?? []));
        const waiter = m.ref !== undefined ? this.waiting.get(m.ref) : undefined;
        if (waiter) {
          this.waiting.delete(m.ref!);
          waiter({ ok: false, error: { code: m.code, message: m.message, rules: m.rules ?? [] } });
        }
        this.emit('error', m);
        return;
      }
      case 'view': {
        if (m.seq < this.seq) return; // an older view overtaken by a newer one (cannot happen on one link; defensive across reconnects)
        this.seq = m.seq;
        this.view = m.view;
        this.legal = m.legal;
        if (this.seats === 2) this.started = true;
        this.emit('view', m.view, m.events);
        const waiter = m.ref !== undefined ? this.waiting.get(m.ref) : undefined;
        if (waiter) {
          this.waiting.delete(m.ref!);
          waiter({ ok: true });
        }
        return;
      }
      case 'ack': {
        // The action changed nothing and the view the guest has is current (audit M5: no full view is rendered for it).
        const waiter = this.waiting.get(m.ref);
        if (waiter) {
          this.waiting.delete(m.ref);
          waiter({ ok: true });
        }
        return;
      }
      case 'chat':
        return this.emit('chat', m.text, m.from);
      case 'bye':
        this.leaving = true;
        conn.close(`host left: ${m.reason}`);
        return;
      case 'lobby':
        this.players = m.players.map((p) => ({ ...p }));
        return this.emit('table', this.table());
      case 'start':
        this.started = true;
        this.players = m.players.map((p) => ({ ...p, connected: this.players.find((q) => q.id === p.id)?.connected ?? true }));
        return this.emit('start', this.table());
      case 'presence': {
        const now = Date.now();
        this.players = m.players.map(({ forfeitInMs, ...p }) => ({ ...p, ...(forfeitInMs !== undefined ? { forfeitAt: now + forfeitInMs } : {}) }));
        return this.emit('table', this.table());
      }
      case 'notice':
        return this.emit('notice', m.kind, m.player, m.text);
      case 'manualProposal':
        this.proposal = m.proposal;
        return this.emit('manualProposal', m.proposal);
      case 'manualClosed': {
        if (this.proposal?.id === m.proposal) this.proposal = null;
        const { v: _v, type: _t, ...closed } = m;
        return this.emit('manualClosed', closed);
      }
      case 'replayGame':
        // RPL-3: once per game (the host shares once; a copy sent again after a resume is the same).
        if (this.replayData !== null) return;
        this.replayData = m.data;
        return this.emit('replayGame', m.data);
    }
  }

  /** A copy of the table (listeners may keep it). */
  private table(): GuestTablePlayer[] {
    return this.players.map((p) => ({ ...p }));
  }

  private onClose(conn: Connection, reason: string): void {
    if (conn !== this.conn) return;
    this.conn = null;
    for (const [id, w] of this.waiting) {
      this.waiting.delete(id);
      w({ ok: false, error: { code: 'disconnected', message: `Connection lost (${reason}); the action may not have reached the host. Check the view after reconnecting before sending it again.`, rules: [] } });
    }
    this.ready = false;
    if (this.welcomeWaiter) {
      // The host answered the handshake but never a datagram of ours: it did not accept the connection (not "the link dropped").
      const e = conn.heardFromPeer ? new NetError('disconnected', `Connection lost: ${reason}`) : new NetError('timeout', `The host did not accept the connection (${reason}).`);
      return this.welcomeWaiter.reject(e);
    }
    if (this.reconnecting) return; // a failed attempt: the reconnect loop goes on
    if (this.leaving || !this.token) return this.end(reason);
    // FIX-NET gap 1: once the game is over (CR 104.1) nothing can change any more, so a lost link ends the game for this guest with its final view
    // instead of 30 s of "reconnecting..." to a host that has left.
    if (this.view?.result) return this.end(`the link closed after the game ended (${reason})`);
    this.emit('disconnected', reason);
    void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    const attempts = this.o.reconnect?.attempts ?? 30;
    const delay = this.o.reconnect?.delayMs ?? 1000;
    let last = 'gave up';
    this.reconnecting = true;
    for (let i = 0; i < attempts && !this.leaving; i++) {
      await new Promise((r) => setTimeout(r, delay));
      if (this.leaving) break;
      try {
        await this.handshake();
        this.reconnecting = false;
        this.sync();
        this.sendConsent(); // RPL-3: a choice made while the link was down reaches the host now
        this.emit('reconnected');
        return;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        if (e instanceof NetError && FINAL.has(e.code)) break;
      }
    }
    this.reconnecting = false;
    this.end(`could not reconnect: ${last}`);
  }

  private end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.emit('closed', reason);
  }
}
