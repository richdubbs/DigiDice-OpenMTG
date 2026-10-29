/**
 * Godot plan phase 1: a local game (hot-seat, or against the computer) whose engine and AI run in the local OpenMTG server, played over the table
 * channel (packages/server/src/table, `/table` on this page's own server; messages in its api.ts). The page only draws, as with the game worker
 * (WorkerConnection.ts), but the game lives in the server process: the same channel the Godot table uses, so the browser tests it first. Behind the
 * development setting "Run the game in the server" (Settings, default off).
 *
 * It is the screen's `GameConnection` (kind `'local'`) exactly as WorkerConnection is: it holds the last snapshot the server sent (a full `view`, or a
 * `patch` of the last one applied with the engine's `nextView`, so the parts of the board that did not change keep their identity), and `view()`,
 * `legalActions()`, `handoff()`, `canUndo()`, `status()`, `events()` and `seated()` return it, the same objects until the next change. The server sends
 * only the shown player's `viewFor` view and the events redacted for it (CR 400.2); never a state.
 *
 * - `act` sends the action with the seq of the latest view held; it resolves with the server's `reply`, which comes after the change the action made.
 *   An action chosen from a view the game has moved on from is refused as stale (the server's rule), never half-applied.
 * - `undo()` and `acceptHandoff()` are sent; the change follows (`undoNow()` waits for the answer).
 * - Pace: the server's computers wait until the table has shown the latest change (`shown`). With the game screen's pace attached (`attachPacer`,
 *   registered for `attachComputerPacer` like a ComputerGame) that is when its PacedConnection is idle; without it, as soon as a screen is subscribed.
 * - The game is not recorded for the replays in this mode (the server keeps no record of it yet).
 * - Closing the game (it left the screen for good, closeGame.ts) sends `leave`: the players at this screen concede if the game is not over (CR 104.3a),
 *   and the server forgets the table.
 */
import { nextView, type Action, type GameConfig, type GameEvent, type GameView, type LegalAction, type PlayerId } from '@openmtg/engine';
import type { StartMessage, TableServerMessage, TableSpeed } from '@openmtg/server/table';
import { withComputerStops } from '../game/computer';
import { registerComputerPacing, type ComputerPacer } from '../game/computerPacer';
import { sealConnection } from '../game/sealed';
import type { SocketLike } from '../online/OnlineLink';
import { registerGameCloser } from './closeGame';
import type { ActResult, EventBatch, GameConnection } from './GameConnection';
import type { Snapshot } from './WorkerConnection';

/** The table channel's path and protocol (packages/server/src/table/api.ts; constants repeated here so the page loads none of the server's code). */
export const TABLE_PATH = '/table';
export const TABLE_PROTOCOL_VERSION = 1;

export interface TableConnectionOptions {
  /** Opens the socket (default: the browser's WebSocket; tests pass Node's `ws`). */
  socket?: (url: string) => SocketLike;
  /** The server's page origin, `http://127.0.0.1:47600` (default '': this page's own). */
  base?: string;
  /** The per-launch token (not needed by this server's own page). */
  token?: string;
  /** The first snapshot, for a screen that reads the connection before the server answers (a rematch); default none (reading then throws). */
  bootstrap?: () => Snapshot;
}

const OPEN = 1;
const EMPTY_BATCH: EventBatch = { seq: 0, events: [] };
const reject = (message: string, rules: readonly string[] = []): ActResult => ({ ok: false, error: { message, rules: [...rules] } });

/** Whether games can run in the server from this page (a WebSocket to it). */
export function tableChannelAvailable(): boolean {
  return typeof WebSocket !== 'undefined';
}

/** The ws:// URL of the table channel for a page at `base` ('' = this page). */
export function tableSocketUrl(base: string, token?: string): string {
  const origin = base || (typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1');
  const u = new URL(TABLE_PATH, origin);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token !== undefined) u.searchParams.set('token', token);
  return u.toString();
}

export class TableConnection implements GameConnection {
  readonly kind = 'local' as const;
  /** The game's config as the server runs it (against the computer: with the computers' stops). */
  readonly config: GameConfig;
  /** Settles true with the server's first view, false when the table could not be opened. */
  readonly ready: Promise<boolean>;
  private settleReady!: (ok: boolean) => void;
  private ws: SocketLike | null = null;
  /** The table's id (from `table`), and the players at this screen. */
  private table: string | null = null;
  private seats: readonly PlayerId[] = [];
  private snap: Snapshot | null = null;
  /** The seq of the view held (0: none yet; a bootstrap snapshot is not one), and whether a full view was asked for. */
  private seq = 0;
  private resyncing = false;
  /** The events counter of `events()` (grows with each change that brought events). */
  private batchSeq = 0;
  private broken: string | null = null;
  /** The last warning the server sent (a table opened elsewhere), shown with the status. */
  private problem: string | null = null;
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private readonly acts = new Map<number, (r: ActResult) => void>();
  private readonly undos = new Map<number, (ok: boolean) => void>();
  private pacer: ComputerPacer | null = null;
  private shownSent = 0;

  private constructor(
    config: GameConfig,
    private readonly start: Omit<StartMessage, 't'>,
    private readonly opts: TableConnectionOptions,
  ) {
    this.config = config;
    this.ready = new Promise<boolean>((resolve) => (this.settleReady = resolve));
    if (start.kind === 'computer') registerComputerPacing(this, this);
    registerGameCloser([this, sealConnection(this)], () => this.close());
    this.open();
  }

  /** A hot-seat game (every player at this screen), as `new LocalConnection(config)`. */
  static hotSeat(config: GameConfig, opts: TableConnectionOptions = {}): TableConnection {
    return new TableConnection(config, { kind: 'hotseat', config }, opts);
  }

  /** A game against the computer, as `new ComputerGame(config, humans, computers, ...)`: the computers' pause comes from the animation speed. */
  static computer(
    config: GameConfig,
    humans: PlayerId | readonly PlayerId[],
    computers: PlayerId | readonly PlayerId[],
    computerOpts: { speed: TableSpeed; seed: string },
    opts: TableConnectionOptions = {},
  ): TableConnection {
    const list = (p: PlayerId | readonly PlayerId[]) => (typeof p === 'string' ? [p] : [...p]);
    // The server's ComputerGame gives the computers the AI's stops; `config` here is that one (as WorkerConnection's).
    const stopped = withComputerStops(config, list(computers));
    return new TableConnection(stopped, { kind: 'computer', config, seats: list(humans), computers: list(computers), ...computerOpts }, opts);
  }

  // ---- the socket ----------------------------------------------------------------------------------------------------------------

  private open(): void {
    const make = this.opts.socket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    let ws: SocketLike;
    try {
      ws = make(tableSocketUrl(this.opts.base ?? '', this.opts.token));
    } catch (e) {
      this.fail(`The game could not start in the server: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.send({ t: 'hello', protocol: TABLE_PROTOCOL_VERSION, ...(this.opts.token !== undefined ? { token: this.opts.token } : {}) });
      this.send({ t: 'start', ...this.start });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let m: TableServerMessage;
      try {
        m = JSON.parse(String(ev.data)) as TableServerMessage;
      } catch {
        return;
      }
      this.receive(m);
    };
    ws.onerror = () => undefined; // the close event follows
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.fail(`The connection to the local OpenMTG server closed${ev.reason ? `: ${ev.reason}` : '.'}`);
    };
  }

  private send(m: object): void {
    if (this.broken !== null || !this.ws || this.ws.readyState !== OPEN) return;
    try {
      this.ws.send(JSON.stringify(m));
    } catch (e) {
      this.fail(`The connection to the local OpenMTG server failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private receive(m: TableServerMessage): void {
    switch (m.t) {
      case 'table':
        this.table = m.table;
        this.seats = m.seats;
        return;
      case 'view':
        if (m.table !== this.table) return;
        this.resyncing = false;
        this.take(m, m.view, m.events);
        return;
      case 'patch': {
        if (m.table !== this.table || this.resyncing) return;
        const next = nextView(this.snap && this.seq > 0 ? { seq: this.seq, view: this.snap.view } : null, m);
        if (!next) {
          // Should never happen (the messages arrive in order): ask for the whole view, which comes as the next `view`.
          console.error('[TableConnection] a view patch did not fit; asking for the whole view');
          this.resyncing = true;
          this.send({ t: 'attach', table: this.table });
          return;
        }
        this.take(m, next.view, m.events);
        return;
      }
      case 'reply':
        if (this.acts.has(m.id)) {
          this.acts.get(m.id)!(m.ok ? { ok: true } : reject(m.error?.message ?? 'The server refused the action.', m.error?.rules ?? []));
          this.acts.delete(m.id);
        } else if (this.undos.has(m.id)) {
          this.undos.get(m.id)!(m.ok);
          this.undos.delete(m.id);
        }
        return;
      case 'notice':
        console.warn(`[TableConnection] ${m.level}: ${m.text}`);
        if (m.level === 'error' && this.snap === null) this.fail(`The game could not start in the server: ${m.text}`);
        else if (m.level !== 'info') {
          this.problem = m.text;
          this.changed();
        }
        return;
      default:
        return; // welcome, result (the view carries it), pong, proposals (not for local tables)
    }
  }

  private take(m: Extract<TableServerMessage, { t: 'view' | 'patch' }>, view: GameView, events: readonly GameEvent[]): void {
    const prev = this.snap;
    this.seq = m.seq;
    const batch = events.length > 0 ? { seq: ++this.batchSeq, events } : (prev?.events ?? EMPTY_BATCH);
    this.snap = {
      view,
      legal: m.legal as readonly LegalAction[],
      events: batch,
      handoff: m.handoff,
      canUndo: m.canUndo,
      status: m.status,
      seated: this.seats,
    };
    this.settleReady(true); // the first view (a promise settles once)
    this.changed();
    this.report();
  }

  /** The table failed (or was closed): every waiting call is answered, the screen shows why, and nothing more is sent. */
  private fail(message: string): void {
    if (this.broken !== null) return;
    this.broken = message;
    console.error('[TableConnection]', message);
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* already gone */
    }
    for (const done of this.acts.values()) done(reject(message));
    this.acts.clear();
    for (const done of this.undos.values()) done(false);
    this.undos.clear();
    this.settleReady(false);
    if (this.snap) this.snap = { ...this.snap, legal: [], canUndo: false, status: message };
    this.changed();
  }

  /** Leave the table (the players at this screen concede if the game is not over, CR 104.3a) and close the socket. Idempotent. */
  close(): void {
    if (this.broken !== null) return;
    if (this.table !== null) this.send({ t: 'leave', table: this.table });
    const ws = this.ws;
    this.broken = 'The game was closed.';
    this.ws = null;
    try {
      ws?.close(1000, 'left');
    } catch {
      /* already gone */
    }
    for (const done of this.acts.values()) done(reject(this.broken));
    this.acts.clear();
    for (const done of this.undos.values()) done(false);
    this.undos.clear();
    this.settleReady(false);
  }

  private changed(): void {
    for (const l of [...this.listeners]) l();
  }

  private current(): Snapshot {
    if (!this.snap) {
      if (!this.opts.bootstrap) throw new Error('TableConnection: read before the server answered (await `ready`).');
      this.snap = this.opts.bootstrap();
    }
    return this.snap;
  }

  // ---- GameConnection ------------------------------------------------------------------------------------------------------------

  readonly view = (): GameView => this.current().view;
  readonly legalActions = (): readonly LegalAction[] => this.current().legal;
  readonly handoff = (): PlayerId | null => this.current().handoff;
  readonly canUndo = (): boolean => this.current().canUndo;
  readonly seated = (): readonly PlayerId[] => this.current().seated;
  readonly events = (): EventBatch => this.current().events;
  readonly status = (): string | null => this.current().status ?? this.problem;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.report();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.listeners.delete(listener);
    };
  };

  readonly act = (action: Action): Promise<ActResult> => {
    if (this.broken !== null) return Promise.resolve(reject(this.broken));
    if (this.table === null || this.seq === 0) return Promise.resolve(reject('The game has not started in the server yet.'));
    const id = this.nextId++;
    return new Promise<ActResult>((resolve) => {
      this.acts.set(id, resolve);
      this.send({ t: 'act', table: this.table, id, seq: this.seq, action });
    });
  };

  /** Undo, answered when the server has done it (true) or refused (false). */
  readonly undoNow = (): Promise<boolean> => {
    if (this.broken !== null || this.table === null || !this.current().canUndo) return Promise.resolve(false);
    const id = this.nextId++;
    // Nothing more to undo until the server's change says otherwise (a second click must not take back a second action unseen).
    this.snap = { ...this.current(), canUndo: false };
    const answered = new Promise<boolean>((resolve) => {
      this.undos.set(id, resolve);
      this.send({ t: 'undo', table: this.table, id });
    });
    this.changed();
    return answered;
  };

  readonly undo = (): boolean => {
    if (!this.canUndo()) return false;
    void this.undoNow();
    return true;
  };

  readonly acceptHandoff = (): void => {
    if (this.table !== null && this.current().handoff !== null) this.send({ t: 'handoff', table: this.table });
  };

  // ---- the computers' pace (F8) --------------------------------------------------------------------------------------------------

  /** Tell the server the table shows the latest change: when the game screen's pace is idle, or (without one) once a screen is subscribed. */
  private readonly report = (): void => {
    if (this.broken !== null || this.table === null || this.seq <= this.shownSent) return;
    const idle = this.pacer ? !this.pacer.busy() : this.listeners.size > 0;
    if (!idle) return;
    this.shownSent = this.seq;
    this.send({ t: 'shown', table: this.table, seq: this.seq });
  };

  /** The game screen's pace: the server's computers wait until it has shown every change. Returns the function that detaches it. */
  attachPacer(pacer: ComputerPacer): () => void {
    this.pacer = pacer;
    const off = pacer.subscribe(this.report);
    this.report();
    return () => {
      off();
      if (this.pacer !== pacer) return;
      this.pacer = null;
      this.report();
    };
  }
}
