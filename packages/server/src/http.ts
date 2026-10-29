/**
 * The local server: the JSON API under /api and the built client, on 127.0.0.1 only (docs/design/m8-client.md).
 *
 * Safety for a server on the player's machine: it binds to the loopback interface, rejects requests whose Host header is not a loopback name (DNS
 * rebinding), sends no CORS headers (other sites cannot read answers) and accepts POST bodies only as application/json (cross-site forms cannot send
 * them without a preflight, which is never granted).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultCacheDir } from '@openmtg/cards';
import { API_PREFIX, DEFAULT_PORT, type ApiError, type EndpointKey } from './api';
import { cardStore } from './cache';
import type { ServerContext, UpdateIo } from './context';
import { ONLINE_REPLAYS_PATH, ONLINE_SESSION_PATH } from './online/api';
import { newOnlineToken } from './online/guard';
import { OnlineService, type OnlineOptions } from './online/socket';
import { matchRoute } from './routes';
import { SOUNDS_PREFIX } from './sounds/api';
import { SoundService } from './sounds/service';
import { resolveStatic } from './static';
import { TABLE_SOCKET_PATH } from './table/api';
import type { ReplayApp } from '@openmtg/engine';
import { TableService, type TableServiceOptions } from './table/socket';
import { addReplay, GameRecording, loadReplay, type RecordingInfo } from './library/replays';

export const HOST = '127.0.0.1';
/** Largest accepted JSON body (a decklist, a list of names or file names). */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Endpoints that take larger bodies: a picture of up to 25 MB sent as base64 (library/images.ts). */
const BODY_LIMITS: Partial<Record<EndpointKey, number>> = {
  'POST /api/library/images/add': 36 * 1024 * 1024,
  // A replay of up to 8 MB sent as base64 (library/replays.ts).
  'POST /api/library/replays/import': 12 * 1024 * 1024,
};
/** How much of an oversized body is read and discarded before the connection is closed instead (readJsonBody). */
const DRAIN_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * img-src allows Scryfall's image host for the opt-in images (ARCHITECTURE.md "Card images" B) and blob:/data: for the player's own uploads.
 *
 * M13-11 (hosted design 12): `hostedOrigin`, when a hosted game server is configured (`--hosted-url`, OPENMTG_HOSTED_URL; `hostedSocketOrigin`), is added to
 * connect-src as exactly that one WebSocket origin, so the page can open its socket and nothing else new.
 */
export function contentSecurityPolicy(hostedOrigin: string | null = null): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.scryfall.io",
    `connect-src 'self'${hostedOrigin ? ` ${hostedOrigin}` : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The policy of a server without a hosted game server. */
export const CONTENT_SECURITY_POLICY = contentSecurityPolicy();

/**
 * M13-11: the WebSocket origin (`wss://host[:port]`, or `ws://` for this machine) of the hosted game server a setting names: `https://play.example.net`,
 * `wss://play.example.net`, `http://127.0.0.1:47700` and `ws://localhost:47700` are all accepted (a trailing `/` or `/ws` is dropped), nothing else: no
 * other scheme, no user name, query or other path, and no plain `ws://` / `http://` to another machine (the guest token and the game would travel
 * unencrypted). The page adds the socket path itself. Empty or absent: null (no hosted server). Throws an Error saying what is wrong.
 */
export function hostedSocketOrigin(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw new Error(`Invalid hosted server address "${text}" (expected an address such as https://play.example.net).`);
  }
  const secure = u.protocol === 'https:' || u.protocol === 'wss:';
  if (!secure && u.protocol !== 'http:' && u.protocol !== 'ws:') throw new Error(`Invalid hosted server address "${text}": use https:// (or wss://).`);
  if (u.username || u.password || u.search || u.hash || !['', '/', '/ws'].includes(u.pathname)) {
    throw new Error(`Invalid hosted server address "${text}": give only the server's address, without a path, user name or query.`);
  }
  if (!secure && !isLoopbackHost(u.host)) {
    throw new Error(`Invalid hosted server address "${text}": a server on another machine needs https:// (the guest session and the game must not travel unencrypted).`);
  }
  return `${secure ? 'wss' : 'ws'}://${u.host}`;
}

export interface ServerOptions {
  /** Default 47600; 0 picks a free port (tests). */
  port?: number;
  /** Built client directory; default packages/client/dist. null = API only. */
  clientDist?: string | null;
  cacheDir?: string;
  compiledDir?: string;
  version?: string;
  /**
   * Online play (milestone 9, docs/design/online.md): the localhost WebSocket at /api/online/socket and its token at /api/online/session. Default on;
   * false turns it off (API tests).
   */
  online?: OnlineOptions | false;
  /**
   * Godot plan phase 1: the table channel, the WebSocket at /table (table/socket.ts) over which the Godot table or this server's own page plays a game whose
   * engine runs here. Default on, with the online socket's per-launch token and its extra origins; false turns it off.
   */
  table?: Omit<TableServiceOptions, 'token' | 'allowOrigins' | 'version'> | false;
  /** UPD1: installed rules packs; default $OPENMTG_PACKS_DIR, else `packs` next to the card cache directory. */
  packsDir?: string;
  /** UPD1: the rules-pack manifest URL; default $OPENMTG_PACK_URL (none: the pack part of the Update button is off). null turns it off. */
  packUrl?: string | null;
  /** UPD1: the update's network and clock (tests). */
  updateIo?: UpdateIo;
  /**
   * M13-11 (hosted design 12): the hosted game server this page may offer ("Play on the DigiDice server"); default $OPENMTG_HOSTED_URL, none when unset.
   * `hostedSocketOrigin` explains what is accepted and throws on anything else. It goes to the page as `hostedUrl` of GET /api/status and as the one
   * extra connect-src origin of the Content-Security-Policy. null turns it off.
   */
  hostedUrl?: string | null;
  /**
   * Godot plan phase 3: the game's sounds as WAV files under /api/sounds (sounds/api.ts), rendered off the event loop by `workers` threads (default: one
   * less than the cores, at most 2) and kept in `dir` (default `sounds` next to the card cache directory). false turns them off.
   */
  sounds?: { dir?: string; workers?: number } | false;
  /** The player's library (decks, settings); default `library` next to the card cache directory. */
  libraryDir?: string;
}

export interface RunningServer {
  server: Server;
  port: number;
  url: string;
  /** The online service (null when turned off). */
  online: OnlineService | null;
  /** Godot plan phase 1: the table channel (null when turned off). */
  table: TableService | null;
  /** The per-launch token of the online socket and the table channel (for a shell that starts this server: the Godot app, the desktop app). */
  token: string;
  /** Godot plan phase 3: the sounds under /api/sounds (null when turned off). */
  sounds: SoundService | null;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CLIENT_DIST = path.resolve(here, '..', '..', 'client', 'dist');

function securityHeaders(res: ServerResponse, csp: string): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', csp);
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}

function sendError(res: ServerResponse, status: number, error: string, extra: Record<string, string> = {}): void {
  sendJson(res, status, { error } satisfies ApiError, extra);
}

/** Loopback host names only (DNS rebinding protection). */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const name = hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : hostHeader.split(':')[0]!;
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

class BodyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * The JSON body of a POST. An oversized body is answered with 413 as soon as it is known (from Content-Length, or once the limit is passed), and the
 * rest of it is read and thrown away, so the client can finish sending and then reads the answer: destroying the request instead would reset the
 * connection and the client would never see the 413. Past DRAIN_LIMIT_BYTES the connection is closed after all (a runaway upload).
 */
function readJsonBody(req: IncomingMessage, limit: number = MAX_BODY_BYTES): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\b/i.test(type)) return Promise.reject(new BodyError(415, 'POST bodies must be application/json'));
  return new Promise((resolve, reject) => {
    const tooLarge = (): void => reject(new BodyError(413, `Body larger than ${limit} bytes`));
    let chunks: Buffer[] = [];
    let size = 0;
    let over = Number(req.headers['content-length'] ?? 0) > limit;
    if (over) tooLarge();
    req.on('data', (buf: Buffer) => {
      size += buf.length;
      if (size > DRAIN_LIMIT_BYTES) req.destroy();
      if (over) return;
      if (size > limit) {
        over = true;
        chunks = [];
        tooLarge();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (over) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new BodyError(400, 'Body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, ctx: ServerContext): Promise<void> {
  const m = matchRoute(req.method ?? 'GET', url.pathname);
  if (m.kind === 'notFound') return sendError(res, 404, `No API endpoint ${url.pathname}`);
  if (m.kind === 'methodNotAllowed') return sendError(res, 405, `Method ${req.method} not allowed`, { Allow: m.allow.join(', ') });
  let body: unknown;
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req, BODY_LIMITS[m.key] ?? MAX_BODY_BYTES);
    } catch (e) {
      if (e instanceof BodyError) return sendError(res, e.status, e.message);
      throw e;
    }
  }
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  const result = await m.handler({ query, params: m.params, body }, ctx);
  sendJson(res, result.status, result.body);
}

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>OpenMTG by DigiDice</title>
<p>The client has not been built yet. Run <code>npm run play</code> (or <code>npm run dev</code> for development).</p>`;

async function handleStatic(req: IncomingMessage, res: ServerResponse, url: URL, dist: string | null): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, `Method ${req.method} not allowed`, { Allow: 'GET, HEAD' });
  if (dist === null) return sendError(res, 404, 'This server runs without a client');
  const file = await resolveStatic(dist, url.pathname);
  if (!file) {
    if (url.pathname === '/') {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(NOT_BUILT);
      return;
    }
    return sendError(res, 404, 'Not found');
  }
  res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.body.length, 'Cache-Control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : file.body);
}

export function contextFrom(options: ServerOptions): ServerContext {
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  return {
    cacheDir,
    compiledDir: options.compiledDir ?? path.join(path.dirname(cacheDir), 'compiled'),
    version: options.version ?? '0.0.0',
    packsDir: options.packsDir ?? (process.env['OPENMTG_PACKS_DIR']?.trim() ? path.resolve(process.env['OPENMTG_PACKS_DIR'].trim()) : path.join(path.dirname(cacheDir), 'packs')),
    packUrl: options.packUrl !== undefined ? options.packUrl : process.env['OPENMTG_PACK_URL']?.trim() || null,
    ...(options.updateIo ? { updateIo: options.updateIo } : {}),
    hostedUrl: hostedSocketOrigin(options.hostedUrl !== undefined ? options.hostedUrl : process.env['OPENMTG_HOSTED_URL']),
    ...(options.libraryDir !== undefined ? { libraryDir: options.libraryDir } : {}),
  };
}

/** The sound service of `options` (null when turned off): its files next to the card cache unless a folder is given. */
export function soundsFrom(options: ServerOptions, ctx: ServerContext = contextFrom(options)): SoundService | null {
  if (options.sounds === false) return null;
  return new SoundService({ dir: options.sounds?.dir ?? path.join(path.dirname(ctx.cacheDir), 'sounds'), ...(options.sounds?.workers !== undefined ? { size: options.sounds.workers } : {}) });
}

/**
 * The request listener, without listening (tests may use it directly). `online` answers GET /api/online/session (startServer makes it); `sounds` answers
 * /api/sounds (made here from the options when not given; startServer makes it, to close it).
 */
export function createApp(options: ServerOptions = {}, online: OnlineService | null = null, sounds: SoundService | null | undefined = undefined): Server {
  const ctx = contextFrom(options);
  const soundService = sounds === undefined ? soundsFrom(options, ctx) : sounds;
  const dist = options.clientDist === undefined ? DEFAULT_CLIENT_DIST : options.clientDist;
  const csp = contentSecurityPolicy(ctx.hostedUrl ?? null);
  return createServer((req, res) => {
    securityHeaders(res, csp);
    if (!isLoopbackHost(req.headers.host)) return sendError(res, 421, 'OpenMTG answers only on 127.0.0.1 / localhost');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (online && url.pathname === ONLINE_SESSION_PATH) {
      if (req.method !== 'GET') return sendError(res, 405, `Method ${req.method} not allowed`, { Allow: 'GET' });
      return online.session(req, res);
    }
    // RPL-3: the host's online game records, for this server's own page (online/replays.ts; checked like the token request).
    if (online && (url.pathname === ONLINE_REPLAYS_PATH || url.pathname.startsWith(`${ONLINE_REPLAYS_PATH}/`))) return online.replays(req, res, url.pathname);
    // Godot plan phase 3: the sounds (WAV files are not JSON: sounds/service.ts answers them itself)
    const isSound = soundService !== null && url.pathname.startsWith(`${SOUNDS_PREFIX}/`);
    const isApi = url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`);
    (isSound ? soundService.handle(req, res, url.pathname) : isApi ? handleApi(req, res, url, ctx) : handleStatic(req, res, url, dist)).catch((e: unknown) => {
      console.error('[openmtg-server]', e);
      if (!res.headersSent) sendError(res, 500, 'Internal server error');
      else res.end();
    });
  });
}

/** The path of a request target, or null when it is not one. */
function pathOf(target: string | undefined): string | null {
  try {
    return new URL(target ?? '', 'http://127.0.0.1').pathname;
  } catch {
    return null;
  }
}

/** Start listening on 127.0.0.1 (never on other interfaces). */
export function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const ctx = contextFrom(options);
  // RPL-3: the host's online game records live next to the card cache (`<data>/replays/online`), like the compiled cache and the rules packs.
  // A page without a library of its own (the Godot app) has the online games' replays kept in the server's library, and the guests' recordings beside.
  const replays = {
    replaysDir: path.join(path.dirname(ctx.cacheDir), 'replays', 'online'), app: { version: ctx.version, commit: null },
    library: { add: async (file: Parameters<typeof addReplay>[1]) => void (await addReplay(ctx, file)) },
    guestRecordingsDir: path.join(path.dirname(ctx.cacheDir), 'replays', 'online-guest'),
  };
  // One per-launch token for the online socket and the table channel.
  const token = (options.online !== false ? options.online?.token : undefined) ?? newOnlineToken();
  const allowOrigins = options.online !== false ? (options.online?.allowOrigins ?? []) : [];
  const online = options.online === false ? null : new OnlineService(async () => {
    const r = await cardStore(ctx);
    if (!r.ok) throw new Error(r.error);
    return r.store.db;
  }, { ...replays, ...options.online, token });
  // Every local game played over the table channel is recorded as a replay in the library (library/replays.ts).
  const record = (info: Omit<RecordingInfo, 'version'>) => new GameRecording(ctx, { ...info, version: ctx.version });
  const tableOptions = options.table === false ? null : { ...options.table, tables: { record, ...options.table?.tables } };
  const table = tableOptions === null ? null : new TableService({
    ...tableOptions, token, allowOrigins, version: ctx.version, loadReplay: (id) => loadReplay(ctx, id),
    ...(online ? { onlineCapture: (app: ReplayApp) => online.bridge.bugCapture(app) } : {}),
  });
  const sounds = soundsFrom(options, ctx);
  const server = createApp(options, online, sounds);
  online?.attach(server);
  table?.attach(server);
  // WebSocket upgrades: /table to the table channel, everything else to the online socket (which refuses other paths).
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (table && pathOf(req.url) === TABLE_SOCKET_PATH) return table.upgrade(req, socket, head);
    if (online) return online.upgrade(req, socket, head);
    socket.on('error', () => undefined);
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_PORT, HOST, () => {
      server.off('error', reject);
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        port,
        url: `http://${HOST}:${port}`,
        online,
        table,
        token,
        sounds,
        close: async () => {
          await table?.close();
          await online?.close();
          await sounds?.close();
          await new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done())));
        },
      });
    });
  });
}
