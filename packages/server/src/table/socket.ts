/**
 * The table channel's WebSocket (Godot plan phase 1; table/api.ts): path `/table` on the local server, for the Godot table and for this server's own
 * page. The upgrade is checked like the online socket's (online/guard.ts, audit 2026-10-12 m11) before the `ws` package (MIT) takes the socket:
 *   1. `Host` is a loopback name with the bound port (DNS rebinding).
 *   2. `Origin`, when sent, is exactly an origin this server serves its page from (or a dev origin given at start, `--allow-origin`): a page of any other
 *      site is refused, token or not. Browsers always send `Origin` on a WebSocket upgrade; the Godot app sends none.
 *   3. `Sec-Fetch-Site`, when sent, is `same-origin` or `none`.
 *   4. The per-launch token (the one the online socket uses, GET /api/online/session; `RunningServer.token`): a socket opened by this server's own page
 *      (rule 2 with an `Origin`) needs none; any other must give it, as the `token` query parameter of the upgrade or in its `hello`, before anything
 *      else is answered. A wrong token is refused wherever it is given.
 * Then each socket is a `TableChannel`: `hello` first, then the table messages (tables.ts does the game side).
 */
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Action, PlayerId, ReplayApp, ReplayFile, StopSettings } from '@openmtg/engine';
import { WebSocketServer, type WebSocket } from 'ws';
import { allowedOrigins, checkExtraOrigin, isLoopbackHostWithPort, newOnlineToken, sameToken } from '../online/guard';
import {
  MAX_TABLE_MESSAGE_BYTES, ONLINE_TABLE, TABLE_CLOSE_PROTOCOL, TABLE_CLOSE_SHUTDOWN, TABLE_CLOSE_TOKEN, TABLE_PROTOCOL, TABLE_SOCKET_PATH, type StartMessage,
  type TableServerMessage,
} from './api';
import { Table, TableError, Tables, type TableSink, type TablesOptions } from './tables';
import { environmentOf, makeBugReport, type BugCapture } from './bugs';
import { openReplay, ReplayUnplayable } from './replay';

export interface TableUpgradeRequest {
  /** The request target (path and query), as in `req.url`. */
  url: string | undefined;
  host: string | undefined;
  /** The `Origin` header; several values (a repeated header) are refused. */
  origin: string | string[] | undefined;
  /** `Sec-Fetch-Site`, when the client sent it. */
  fetchSite: string | string[] | undefined;
}

export type TableVerdict = { ok: true; trusted: boolean } | { ok: false; status: 403 | 404; reason: string };

/** Whether a `/table` upgrade may be accepted, and whether the socket is trusted already (this server's own page, or a valid token in the URL). */
export function checkTableUpgrade(req: TableUpgradeRequest, o: { port: number; token: string; extraOrigins?: readonly string[] }): TableVerdict {
  let url: URL;
  try {
    url = new URL(req.url ?? '', 'http://127.0.0.1');
  } catch {
    return { ok: false, status: 404, reason: 'not found' };
  }
  if (url.pathname !== TABLE_SOCKET_PATH) return { ok: false, status: 404, reason: 'not found' };
  if (!isLoopbackHostWithPort(req.host, o.port)) return { ok: false, status: 403, reason: 'Host must be 127.0.0.1 or localhost with this server\'s port' };
  if (req.origin !== undefined && (typeof req.origin !== 'string' || !allowedOrigins(o.port, o.extraOrigins).includes(req.origin))) {
    return { ok: false, status: 403, reason: 'Origin not allowed' };
  }
  if (req.fetchSite !== undefined && req.fetchSite !== 'same-origin' && req.fetchSite !== 'none') return { ok: false, status: 403, reason: 'cross-site request' };
  const tokens = url.searchParams.getAll('token');
  if (tokens.length > 1 || (tokens.length === 1 && !sameToken(tokens[0], o.token))) return { ok: false, status: 403, reason: 'bad token' };
  return { ok: true, trusted: req.origin !== undefined || tokens.length === 1 };
}

/** What a channel needs of its socket (a `ws` WebSocket, or a test's fake). */
export interface TablePort {
  send(m: TableServerMessage): void;
  close(code: number, reason: string): void;
}

/** A channel's inbound side, for the socket (or a test) to feed. */
export interface TableHandle {
  /** One text frame. */
  message(text: string): void;
  /** The socket closed. */
  closed(): void;
}

/** How long a socket may stay without a valid `hello` (ms). */
export const HELLO_TIMEOUT_MS = 10_000;
/** The table kinds this server builds, and its optional parts (`welcome.features`). */
export const TABLE_FEATURES = ['hotseat', 'computer', 'undo', 'stops', 'shown'];

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0;

/** One socket's conversation: `hello`, then the table messages for the table it has attached (at most one at a time). */
export class TableChannel implements TableSink, TableHandle {
  private hello = false;
  private table: Table | null = null;
  /** "Report a bug" during an online game: the moment taken (ONLINE_TABLE). */
  private onlineBug: BugCapture | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null;
  private done = false;

  constructor(
    private readonly port: TablePort,
    private readonly tables: Tables,
    private readonly o: {
      token: string; trusted: boolean; version: string; loadReplay?: (id: string) => Promise<ReplayFile>; onlineCapture?: (app: ReplayApp) => BugCapture | null;
    },
  ) {
    this.helloTimer = setTimeout(() => this.shut(TABLE_CLOSE_PROTOCOL, 'No hello.'), HELLO_TIMEOUT_MS);
    this.helloTimer.unref?.();
  }

  /** The table this socket has attached, if any (tests). */
  get current(): Table | null {
    return this.table;
  }

  send(m: TableServerMessage): void {
    if (!this.done) this.port.send(m);
  }

  private notice(text: string, level: 'info' | 'warning' | 'error' = 'error'): void {
    this.send({ t: 'notice', text, level });
  }

  private shut(code: number, reason: string): void {
    if (this.done) return;
    this.closed();
    this.port.close(code, reason);
  }

  /** Another socket attached this channel's table: it is that socket's now. */
  replaced(table: Table): void {
    if (this.table !== table) return;
    this.table = null;
    this.notice('This table was opened on another connection.', 'warning');
  }

  closed(): void {
    if (this.done) return;
    this.done = true;
    if (this.helloTimer !== null) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.table?.detach(this);
    this.table = null;
  }

  message(text: string): void {
    if (this.done) return;
    let m: unknown;
    try {
      m = JSON.parse(text);
    } catch {
      m = null;
    }
    if (!isObject(m) || typeof m['t'] !== 'string') {
      if (!this.hello) return this.shut(TABLE_CLOSE_PROTOCOL, 'Send hello first.');
      return this.notice('A message the table channel does not understand (JSON objects with a "t" field only).');
    }
    if (!this.hello && m['t'] !== 'hello') return this.shut(TABLE_CLOSE_PROTOCOL, 'Send hello first.');
    try {
      this.handle(m);
    } catch (e) {
      console.error('[table] message failed', m['t'], e);
      this.notice(e instanceof TableError ? e.message : `The server could not handle "${String(m['t'])}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private handle(m: Record<string, unknown>): void {
    switch (m['t']) {
      case 'hello':
        return this.onHello(m);
      case 'ping':
        return this.send({ t: 'pong' });
      case 'start':
        return this.onStart(m as unknown as StartMessage);
      case 'watch':
        void this.onWatch(m['replay'], m['perspective']);
        return;
      case 'attach':
        return this.onAttach(m['table']);
      default:
        break;
    }
    if ((m['t'] === 'bugCapture' || m['t'] === 'bugReport') && m['table'] === ONLINE_TABLE) return this.onOnlineBug(m);
    const table = this.table !== null && m['table'] === this.table.id ? this.table : null;
    switch (m['t']) {
      case 'act': {
        const id = m['id'];
        if (!isId(id)) return this.notice('An act needs an id (a positive whole number).');
        if (!table) return this.send({ t: 'reply', id, ok: false, error: { message: 'No such table on this connection.', rules: [] } });
        const action = m['action'];
        if (!isObject(action) || typeof action['type'] !== 'string') return this.send({ t: 'reply', id, ok: false, error: { message: 'The act has no action.', rules: [] } });
        void table.act(id, typeof m['seq'] === 'number' ? m['seq'] : NaN, action as unknown as Action).then((r) => this.send(r));
        return;
      }
      case 'stops': {
        const id = isId(m['id']) ? m['id'] : null;
        const refuse = (message: string) => (id !== null ? this.send({ t: 'reply', id, ok: false, error: { message, rules: [] } }) : this.notice(message));
        if (!table) return refuse('No such table on this connection.');
        if (typeof m['player'] !== 'string' || !isObject(m['stops'])) return refuse('A stops message needs a player and stops.');
        void table.stops(id ?? 0, m['player'] as PlayerId, m['stops'] as unknown as StopSettings).then((r) => {
          if (id !== null) this.send(r);
          else if (!r.ok) this.notice(r.error?.message ?? 'The stops were refused.');
        });
        return;
      }
      case 'undo': {
        const id = isId(m['id']) ? m['id'] : null;
        const ok = table !== null && table.undo();
        if (id !== null) this.send(ok ? { t: 'reply', id, ok } : { t: 'reply', id, ok, error: { message: table ? 'Nothing to undo.' : 'No such table on this connection.', rules: ['CR 733.1'] } });
        return;
      }
      case 'shown':
        if (table && typeof m['seq'] === 'number') table.shown(m['seq']);
        return;
      case 'handoff':
        if (!table) return this.notice('No such table on this connection.');
        table.handoff();
        return;
      case 'replay': {
        if (!table || table.kind !== 'replay') return this.notice('No replay on this connection.');
        const refused = table.control(m['op'], m['value']);
        if (refused !== null) this.send({ t: 'replayRefused', table: table.id, message: refused });
        return;
      }
      case 'bugCapture': {
        if (!table) return this.notice('No such table on this connection.');
        const id = m['id'];
        try {
          this.send({ t: 'bugCaptured', table: table.id, id: typeof id === 'number' ? id : 0, ...table.bugCapture({ version: this.o.version, commit: null }) });
        } catch (e) {
          this.send({ t: 'bugCaptured', table: table.id, id: typeof id === 'number' ? id : 0, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }
      case 'bugReport': {
        if (!table) return this.notice('No such table on this connection.');
        const id = typeof m['id'] === 'number' ? m['id'] : 0;
        const words = m['words'];
        const card = m['card'];
        const env = environmentOf(m['environment']);
        if (typeof words !== 'string' || words.trim() === '' || !env || (card !== undefined && card !== null && typeof card !== 'string')) {
          this.send({ t: 'bugReportFile', table: table.id, id, error: 'The report could not be made: it needs what happened, and the app it was made on.' });
          return;
        }
        void table.bugReport(words, typeof card === 'string' ? card : null, env).then((r) => this.send({ t: 'bugReportFile', table: table.id, id, ...r }));
        return;
      }
      case 'recording': {
        if (!table) return this.notice('No such table on this connection.');
        const refused = table.recordingControl(m['keep'], m['reveal']);
        if (refused !== null) this.notice(refused);
        return;
      }
      case 'leave': {
        if (!table) return;
        this.table = null;
        void table.leave().finally(() => this.tables.remove(table));
        return;
      }
      default:
        return this.notice(`Unknown message "${String(m['t'])}".`);
    }
  }

  /** "Report a bug" during an online game: the online socket's game (online/bridge.ts `bugCapture`), then the report of that moment. */
  private onOnlineBug(m: Record<string, unknown>): void {
    const id = typeof m['id'] === 'number' ? m['id'] : 0;
    if (m['t'] === 'bugCapture') {
      const b = (this.onlineBug = this.o.onlineCapture?.({ version: this.o.version, commit: null }) ?? null);
      if (!b) return this.send({ t: 'bugCaptured', table: ONLINE_TABLE, id, error: 'There is no online game to report on.' });
      return this.send({ t: 'bugCaptured', table: ONLINE_TABLE, id, holds: b.content.holds, kind: b.kind, at: b.content.at, length: b.length });
    }
    const capture = this.onlineBug;
    const words = m['words'];
    const card = m['card'];
    const env = environmentOf(m['environment']);
    if (!capture) return this.send({ t: 'bugReportFile', table: ONLINE_TABLE, id, error: 'Open the report again: the moment it was about is gone.' });
    if (typeof words !== 'string' || words.trim() === '' || !env || (card !== undefined && card !== null && typeof card !== 'string')) {
      return this.send({ t: 'bugReportFile', table: ONLINE_TABLE, id, error: 'The report could not be made: it needs what happened, and the app it was made on.' });
    }
    void makeBugReport(capture, words, typeof card === 'string' ? card : null, env).then((r) => this.send({ t: 'bugReportFile', table: ONLINE_TABLE, id, ...r }));
  }

  private onHello(m: Record<string, unknown>): void {
    if (m['protocol'] !== TABLE_PROTOCOL) {
      this.notice(`This server speaks table protocol ${TABLE_PROTOCOL}, not ${String(m['protocol'])}. Update the app or the server.`);
      return this.shut(TABLE_CLOSE_PROTOCOL, 'Unsupported protocol.');
    }
    const token = m['token'];
    if (token !== undefined && !sameToken(typeof token === 'string' ? token : null, this.o.token)) return this.shut(TABLE_CLOSE_TOKEN, 'Bad token.');
    if (!this.o.trusted && token === undefined) return this.shut(TABLE_CLOSE_TOKEN, 'Token missing.');
    this.hello = true;
    if (this.helloTimer !== null) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.send({ t: 'welcome', protocol: TABLE_PROTOCOL, version: this.o.version, features: [...TABLE_FEATURES] });
  }

  private use(table: Table): void {
    if (this.table && this.table !== table) this.table.detach(this);
    this.table = table;
    const previous = table.attach(this);
    if (previous instanceof TableChannel) previous.replaced(table);
  }

  private onStart(m: StartMessage): void {
    if (!isObject(m.config)) throw new TableError('A start needs the game\'s config.');
    this.use(this.tables.start(m));
  }

  /** Open a replay of the library as a table (its file read and checked by the service's `loadReplay`). */
  private async onWatch(id: unknown, perspective: unknown): Promise<void> {
    try {
      if (typeof id !== 'string' || !this.o.loadReplay) throw new TableError('No such replay.');
      const file = await this.o.loadReplay(id);
      // The table sends the replay's state after its first view, and after every change.
      this.use(this.tables.watch(openReplay(file, perspective)));
    } catch (e) {
      this.notice(e instanceof TableError || e instanceof ReplayUnplayable ? e.message : `The replay could not be opened: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private onAttach(id: unknown): void {
    const table = typeof id === 'string' ? this.tables.get(id) : null;
    if (!table) throw new TableError('No such table (it was closed, or the server restarted).');
    this.use(table);
  }
}

export interface TableServiceOptions {
  /** The per-launch token (http.ts gives the online socket's; default a new random one). */
  token?: string;
  /** Extra origins the socket accepts (the Vite dev server): loopback http origins only (online/guard.ts, checkExtraOrigin). */
  allowOrigins?: readonly string[];
  /** This server's version, for `welcome`. */
  version?: string;
  /** The tables' options (tests: the computer's AI and pace). */
  tables?: TablesOptions;
  /** Read a replay of the library by its id (http.ts: library/replays.ts `loadReplay`); absent: replays cannot be watched. */
  loadReplay?: (id: string) => Promise<ReplayFile>;
  /** "Report a bug" during an online game: the online socket's moment (http.ts: online/bridge.ts `bugCapture`); absent: none. */
  onlineCapture?: (app: ReplayApp) => BugCapture | null;
}

export class TableService {
  readonly token: string;
  readonly tables: Tables;
  private readonly loadReplay: ((id: string) => Promise<ReplayFile>) | null;
  private readonly onlineCapture: ((app: ReplayApp) => BugCapture | null) | null;
  private readonly version: string;
  private readonly extraOrigins: readonly string[];
  private readonly wss: WebSocketServer;
  private server: Server | null = null;
  private readonly channels = new Set<TableChannel>();

  constructor(o: TableServiceOptions = {}) {
    for (const origin of o.allowOrigins ?? []) {
      const problem = checkExtraOrigin(origin);
      if (problem) throw new Error(`--allow-origin: ${problem}`);
    }
    this.extraOrigins = [...(o.allowOrigins ?? [])];
    this.token = o.token ?? newOnlineToken();
    this.version = o.version ?? '0.0.0';
    this.tables = new Tables(o.tables);
    this.loadReplay = o.loadReplay ?? null;
    this.onlineCapture = o.onlineCapture ?? null;
    // No compression (views are sent often, the socket is on this machine), a size cap on what the client may send.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_TABLE_MESSAGE_BYTES, perMessageDeflate: false });
  }

  /** The port the HTTP server is bound to (0 before it listens). */
  private get port(): number {
    const a = this.server?.address();
    return a && typeof a === 'object' ? (a as AddressInfo).port : 0;
  }

  /** The HTTP server whose `/table` upgrades come here (http.ts routes them, `upgrade`). */
  attach(server: Server): void {
    this.server = server;
  }

  /** A `/table` upgrade request: checked (see the file header), then handed to `ws`. */
  upgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    socket.on('error', () => undefined); // a reset by the client must not take the server down
    const verdict = checkTableUpgrade(
      { url: req.url, host: req.headers.host, origin: req.headers.origin, fetchSite: req.headers['sec-fetch-site'] },
      { port: this.port, token: this.token, extraOrigins: this.extraOrigins },
    );
    if (!verdict.ok) {
      const body = `${verdict.reason}\n`;
      const text = verdict.status === 403 ? 'Forbidden' : 'Not Found';
      socket.end(`HTTP/1.1 ${verdict.status} ${text}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.connected(ws, verdict.trusted));
  }

  /** A channel for a socket (the real one below; tests drive it with a fake port). */
  connect(port: TablePort, trusted: boolean): TableChannel {
    const channel = new TableChannel(
      {
        send: (m) => port.send(m),
        close: (code, reason) => {
          this.channels.delete(channel);
          port.close(code, reason);
        },
      },
      this.tables,
      {
        token: this.token, trusted, version: this.version, ...(this.loadReplay ? { loadReplay: this.loadReplay } : {}),
        ...(this.onlineCapture ? { onlineCapture: this.onlineCapture } : {}),
      },
    );
    this.channels.add(channel);
    return channel;
  }

  private connected(ws: WebSocket, trusted: boolean): void {
    const channel = this.connect(
      {
        send: (m) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
        },
        close: (code, reason) => ws.close(code, reason),
      },
      trusted,
    );
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        channel.closed();
        ws.close(TABLE_CLOSE_PROTOCOL, 'Text frames only.');
        return;
      }
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      channel.message(buf.toString('utf8'));
    });
    const gone = () => {
      this.channels.delete(channel);
      channel.closed();
    };
    ws.on('close', gone);
    ws.on('error', gone);
  }

  /** Close every table and socket (the server is stopping). */
  async close(): Promise<void> {
    for (const c of [...this.channels]) c.closed();
    this.channels.clear();
    this.tables.closeAll();
    for (const ws of this.wss.clients) ws.close(TABLE_CLOSE_SHUTDOWN, 'The OpenMTG server is stopping.');
    await new Promise((r) => setTimeout(r, 50));
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}
