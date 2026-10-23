/**
 * The gateway's HTTP server (design 3.1, 10.2): the WebSocket path `/ws` (the `ws` library, MIT), `/healthz` and `/readyz`. Nothing else: no static
 * files, no `/metrics` (that is a separate listener with a token, gateway/metrics.ts), no CORS.
 *
 * The upgrade is decided by `Gateway.upgrade` BEFORE the WebSocket handshake (Origin, proxy, per-address sockets): a refused upgrade gets a plain HTTP
 * status and the TCP socket is destroyed. The `ws` server runs with `maxPayload` = `MAX_FRAME_BYTES` (a bigger frame closes the connection, 1009),
 * without compression (`perMessageDeflate: false`) and without its own client tracking.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { HEALTH_PATH, HOSTED_SOCKET_PATH, MAX_FRAME_BYTES, READY_PATH } from '../api';
import type { Gateway, GatewaySocket } from './gateway';

export interface GatewayServerOptions {
  gateway: Gateway;
  /** `/readyz`: storage reachable, workers answering, not draining (the runtime's `ready()`), and the gateway not draining. */
  ready: () => { ok: boolean; reasons: string[] };
}

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable' };

function refuseUpgrade(socket: Duplex, status: number): void {
  try {
    socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    // already gone
  }
  socket.destroy();
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

/** The `ws` socket as the gateway sees it. */
export function wsSocket(ws: WebSocket): GatewaySocket {
  return {
    send: (text, done) => {
      try {
        ws.send(text, { binary: false, compress: false }, (e) => done(e ?? undefined));
      } catch (e) {
        done(e instanceof Error ? e : new Error('send failed'));
      }
    },
    close: (code, reason) => ws.close(code, reason),
    ping: () => ws.ping(),
    terminate: () => ws.terminate(),
  };
}

/** The HTTP server with the WebSocket upgrade and the health endpoints (not listening yet). */
export function createGatewayServer(o: GatewayServerOptions): { server: Server; wss: WebSocketServer } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false, clientTracking: false });
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false });
      if (req.url === HEALTH_PATH) return json(res, 200, { ok: true });
      if (req.url === READY_PATH) {
        const r = o.ready();
        return json(res, r.ok ? 200 : 503, { ok: r.ok, reasons: r.reasons });
      }
      json(res, 404, { ok: false });
    } catch {
      res.destroy();
    }
  });
  // Slow request headers or bodies cannot hold sockets for long.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      if (req.url !== HOSTED_SOCKET_PATH) return refuseUpgrade(socket, 404);
      const d = o.gateway.upgrade({
        peer: req.socket.remoteAddress,
        origin: req.headers.origin,
        forwardedFor: req.headers['x-forwarded-for'],
      });
      if (!d.ok) return refuseUpgrade(socket, d.status);
      let opened = false;
      socket.on('close', () => {
        // The handshake failed before the WebSocket opened: the gateway's socket count is given back.
        if (!opened) o.gateway.upgradeFailed(d.key);
      });
      wss.handleUpgrade(req, socket, head, (ws) => {
        opened = true;
        const h = o.gateway.open(wsSocket(ws), d);
        ws.on('message', (data: RawData, isBinary: boolean) => h.message(data as Buffer | ArrayBuffer | Buffer[], isBinary));
        ws.on('pong', () => h.pong());
        ws.on('close', () => h.closed());
        ws.on('error', () => {
          // 'close' follows (a frame past maxPayload, a protocol error): nothing to do here
        });
      });
    } catch {
      socket.destroy();
    }
  });
  server.on('clientError', (_e, socket) => {
    try {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    } catch {
      socket.destroy();
    }
  });
  return { server, wss };
}
