/**
 * The localhost WebSocket between the browser and the online bridge (docs/design/online.md, "Browser and local server"; audit 2026-10-12 m11). The
 * server listens on 127.0.0.1 only (http.ts); here the upgrade is checked (guard.ts: exact Origin, loopback Host with the bound port, per-launch token)
 * before the `ws` package (MIT) takes the socket, and the token is handed to the client's own page (GET /api/online/session).
 *
 * RPL-3 (replays design 7.2): the host's game records (online/replays.ts) are kept under `replaysDir`, and this server's own page reads them through the
 * replays API (api.ts ONLINE_REPLAYS_PATH), with the same check as the token request.
 */
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { ReplayApp } from '@openmtg/engine';
import { GameGuest, GameHost } from '@openmtg/net';
import { WebSocketServer, type WebSocket } from 'ws';
import { CLOSE_PROTOCOL, CLOSE_REPLACED, CLOSE_SHUTDOWN, MAX_CLIENT_MESSAGE_BYTES, ONLINE_PROTOCOL, ONLINE_REPLAYS_PATH, type OnlineSessionResponse } from './api';
import { OnlineBridge, type BridgeOptions } from './bridge';
import { checkExtraOrigin, checkSessionRequest, checkUpgrade, newOnlineToken } from './guard';
import { finishLeftRecordings, type OnlineLibrary } from './guestRecording';
import { OnlineReplayStore, replayRequest } from './replays';

export interface OnlineOptions {
  /** Extra origins the socket accepts (the Vite dev server, http://127.0.0.1:5173): loopback http origins only (guard.ts, checkExtraOrigin). */
  allowOrigins?: string[];
  /** The bridge's options except the card source (http.ts gives the server's card index). */
  bridge?: Partial<Omit<BridgeOptions, 'cards'>>;
  /** The per-launch token (default: a new random one; tests pass their own). */
  token?: string;
  /** RPL-3: the folder of the host's game records (http.ts: `replays/online` next to the card cache); absent or null: none are kept. */
  replaysDir?: string | null;
  /** RPL-3: this server's app (its version; no commit), recorded in the replay files it makes. */
  app?: ReplayApp;
  /** RPL-3: the server's replay library, for a page without one of its own (`library` on host or join: online/bridge.ts). */
  library?: OnlineLibrary | null;
  /** RPL-3: the folder of the guests' recordings for `library` (http.ts: `replays/online-guest` next to the card cache). */
  guestRecordingsDir?: string | null;
}

const STATUS_TEXT: Record<number, string> = { 403: 'Forbidden', 404: 'Not Found' };
const NO_APP: ReplayApp = { version: '0.0.0', commit: null };

export class OnlineService {
  readonly token: string;
  readonly bridge: OnlineBridge;
  /** RPL-3: the host's game records (null: none are kept). */
  readonly replayStore: OnlineReplayStore | null;
  private readonly app: ReplayApp;
  private readonly extraOrigins: readonly string[];
  private readonly wss: WebSocketServer;
  private server: Server | null = null;
  /** RPL-3: the replays an earlier server left for the library, being kept there (tests wait for it). */
  readonly left: Promise<void> = Promise.resolve();

  constructor(cards: BridgeOptions['cards'], o: OnlineOptions = {}) {
    for (const origin of o.allowOrigins ?? []) {
      const problem = checkExtraOrigin(origin);
      if (problem) throw new Error(`--allow-origin: ${problem}`);
    }
    this.extraOrigins = [...(o.allowOrigins ?? [])];
    this.token = o.token ?? newOnlineToken();
    this.app = o.app ?? NO_APP;
    this.replayStore = o.replaysDir ? new OnlineReplayStore(o.replaysDir) : null;
    this.bridge = new OnlineBridge({
      cards, backends: { startHost: (h) => GameHost.start(h), joinGuest: (g) => GameGuest.join(g) }, replays: this.replayStore, app: this.app,
      library: o.library ?? null, guestRecordings: o.guestRecordingsDir ?? null, ...o.bridge,
    });
    if (o.library) this.left = keepLeftReplays(o.library, this.replayStore, o.guestRecordingsDir ?? null, this.app);
    // No compression (CRIME-style length leaks; views are small enough), and a size cap on what the browser may send.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES, perMessageDeflate: false });
  }

  /** The port the HTTP server is bound to (0 before it listens). */
  private get port(): number {
    const a = this.server?.address();
    return a && typeof a === 'object' ? (a as AddressInfo).port : 0;
  }

  /** The HTTP server whose upgrade requests come here (http.ts routes them: `upgrade`; Godot plan phase 1 added the table channel's /table beside it). */
  attach(server: Server): void {
    this.server = server;
  }

  /** GET /api/online/session: the token, for the client's own page only (guard.ts, checkSessionRequest). */
  session(req: IncomingMessage, res: ServerResponse): void {
    const verdict = checkSessionRequest({ host: req.headers.host, origin: req.headers.origin, fetchSite: req.headers['sec-fetch-site'] }, { port: this.port, extraOrigins: this.extraOrigins });
    const body = verdict.ok ? ({ token: this.token, protocol: ONLINE_PROTOCOL } satisfies OnlineSessionResponse) : { error: verdict.reason };
    res.writeHead(verdict.ok ? 200 : verdict.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  /**
   * RPL-3: the replays API (api.ts ONLINE_REPLAYS_PATH): this server's own page lists, reads and removes the host's game records (online/replays.ts).
   * The same check as the token request (guard.ts `checkSessionRequest`): another site's page is refused.
   */
  replays(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    const verdict = checkSessionRequest({ host: req.headers.host, origin: req.headers.origin, fetchSite: req.headers['sec-fetch-site'] }, { port: this.port, extraOrigins: this.extraOrigins });
    let status: number;
    let body: unknown;
    if (!verdict.ok) {
      status = verdict.status;
      body = { error: verdict.reason };
    } else {
      try {
        const r = replayRequest(req.method ?? 'GET', pathname, {
          store: this.replayStore, running: (id) => this.bridge.running(id), open: this.bridge.openReplay(), app: this.app, base: ONLINE_REPLAYS_PATH,
        });
        status = r.status;
        body = r.body;
      } catch (e) {
        status = 500;
        body = { error: `The replay could not be read: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(status === 405 ? { Allow: 'GET, DELETE' } : {}) });
    res.end(JSON.stringify(body));
  }

  /** Leave the game (a bye to the other side), close the browser sockets. */
  async close(): Promise<void> {
    await this.bridge.close();
    for (const ws of this.wss.clients) ws.close(CLOSE_SHUTDOWN, 'The OpenMTG server is stopping.');
    await new Promise((r) => setTimeout(r, 50));
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
  }

  /** An upgrade request (any path but /table): checked (guard.ts), then handed to `ws`. */
  upgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    socket.on('error', () => undefined); // a reset by the browser must not take the server down
    const verdict = checkUpgrade({ url: req.url, host: req.headers.host, origin: req.headers.origin }, { port: this.port, token: this.token, extraOrigins: this.extraOrigins });
    if (!verdict.ok) {
      const body = `${verdict.reason}\n`;
      socket.end(`HTTP/1.1 ${verdict.status} ${STATUS_TEXT[verdict.status]}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.connected(ws));
  }

  private connected(ws: WebSocket): void {
    const handle = this.bridge.attach(
      {
        send: (m) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
        },
        close: (code, reason) => ws.close(code, reason),
      },
      CLOSE_REPLACED,
    );
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(CLOSE_PROTOCOL, 'Text frames only.');
      handle.message(Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data));
    });
    ws.on('close', () => handle.closed());
    ws.on('error', () => handle.closed());
  }
}

/**
 * RPL-3: at a server's start, the replays of online games an earlier server left for the library (it stopped or crashed with a game open): the guests'
 * recordings (online/guestRecording.ts) and the host's records begun for the library. Never throws.
 */
async function keepLeftReplays(library: OnlineLibrary, store: OnlineReplayStore | null, guests: string | null, app: ReplayApp): Promise<void> {
  try {
    if (guests) await finishLeftRecordings(guests, library);
    for (const id of store?.leftForLibrary() ?? []) {
      const file = store!.file(id, app);
      if (file === 'running') continue;
      if (file && !('problem' in file)) await library.add(file);
      store!.remove(id);
    }
  } catch (e) {
    console.error(`[online] the replays an earlier server left could not be kept: ${e instanceof Error ? e.message : String(e)}`);
  }
}
