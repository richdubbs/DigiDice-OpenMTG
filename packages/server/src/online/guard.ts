/**
 * Who may use the online socket (audit 2026-10-12 m11; docs/design/online.md, "Browser and local server"). Pure functions of the request's headers, so
 * the tests call them with crafted headers in process.
 *
 * Browsers send cross-origin WebSocket upgrades without a CORS preflight, so any page the player opens could otherwise connect to
 * ws://127.0.0.1:<port> and play, or read the views, in the player's name. An upgrade is accepted only when all three hold:
 *   1. `Origin` is present and equals, exactly, an origin this server serves the client from: http://127.0.0.1:<port> or http://localhost:<port> for
 *      the port actually bound, or a dev origin given at start (`--allow-origin`, loopback only: Vite's http://127.0.0.1:5173). No `null`, no prefix or
 *      suffix matching, no wildcard.
 *   2. `Host` is a loopback name with the bound port (DNS rebinding: a page of evil.test that resolves to 127.0.0.1 sends `Host: evil.test:<port>`).
 *   3. The `token` query parameter is the per-launch token (random, made at start). The page gets it from GET /api/online/session, which answers
 *      only same-origin requests and sends no CORS headers, so no other site can read it.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ONLINE_SOCKET_PATH } from './api';

export const TOKEN_FORMAT = /^[0-9a-f]{64}$/;

/** A new per-launch token (32 random bytes, hex). */
export function newOnlineToken(): string {
  return randomBytes(32).toString('hex');
}

const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):(\d{1,5})$/;

/**
 * An extra origin allowed at start (the Vite dev server), or an error message. Loopback http origins only, written exactly as a browser sends them
 * (lowercase, no path, no trailing slash, an explicit port).
 */
export function checkExtraOrigin(origin: string): string | null {
  const m = LOOPBACK_ORIGIN.exec(origin);
  if (!m) return `"${origin}" is not a loopback origin like http://127.0.0.1:5173 (http, 127.0.0.1 or localhost, an explicit port, nothing after it)`;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== m[2]) return `"${origin}" has an invalid port`;
  return null;
}

/** The origins the socket accepts: this server's own for the bound port, and the extra ones. */
export function allowedOrigins(port: number, extra: readonly string[] = []): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extra];
}

/** `Host` is a loopback name with exactly the bound port. */
export function isLoopbackHostWithPort(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

/** Constant-time comparison of a token from a request with the server's. */
export function sameToken(given: string | null | undefined, token: string): boolean {
  if (typeof given !== 'string' || !TOKEN_FORMAT.test(given) || !TOKEN_FORMAT.test(token)) return false;
  return timingSafeEqual(Buffer.from(given, 'ascii'), Buffer.from(token, 'ascii'));
}

export interface UpgradeRequest {
  /** The request target (path and query), as in `req.url`. */
  url: string | undefined;
  host: string | undefined;
  /** The `Origin` header; several values (a repeated header) are refused. */
  origin: string | string[] | undefined;
}

export type Verdict = { ok: true } | { ok: false; status: 403 | 404; reason: string };

/** Whether a WebSocket upgrade may be accepted (see the file header). */
export function checkUpgrade(req: UpgradeRequest, o: { port: number; token: string; extraOrigins?: readonly string[] }): Verdict {
  let url: URL;
  try {
    url = new URL(req.url ?? '', 'http://127.0.0.1');
  } catch {
    return { ok: false, status: 404, reason: 'not found' };
  }
  if (url.pathname !== ONLINE_SOCKET_PATH) return { ok: false, status: 404, reason: 'not found' };
  if (!isLoopbackHostWithPort(req.host, o.port)) return { ok: false, status: 403, reason: 'Host must be 127.0.0.1 or localhost with this server\'s port' };
  if (typeof req.origin !== 'string') return { ok: false, status: 403, reason: 'Origin missing' };
  if (!allowedOrigins(o.port, o.extraOrigins).includes(req.origin)) return { ok: false, status: 403, reason: 'Origin not allowed' };
  if (url.searchParams.getAll('token').length !== 1 || !sameToken(url.searchParams.get('token'), o.token)) return { ok: false, status: 403, reason: 'bad token' };
  return { ok: true };
}

export interface SessionRequest {
  host: string | undefined;
  origin: string | string[] | undefined;
  /** `Sec-Fetch-Site` (sent by current browsers): 'same-origin' for the client's own fetch. */
  fetchSite: string | string[] | undefined;
}

/**
 * Whether GET /api/online/session may answer. The client's own fetch is same-origin: browsers send no `Origin` on a same-origin GET (or the exact own
 * origin) and `Sec-Fetch-Site: same-origin`. A request another site makes is refused: it has another `Origin` (cors mode) or `Sec-Fetch-Site:
 * cross-site` (no-cors mode, where no `Origin` is sent). The answer has no CORS headers either, so no other site could read it anyway.
 */
export function checkSessionRequest(req: SessionRequest, o: { port: number; extraOrigins?: readonly string[] }): Verdict {
  if (!isLoopbackHostWithPort(req.host, o.port)) return { ok: false, status: 403, reason: 'Host must be 127.0.0.1 or localhost with this server\'s port' };
  if (req.origin !== undefined && (typeof req.origin !== 'string' || !allowedOrigins(o.port, o.extraOrigins).includes(req.origin))) {
    return { ok: false, status: 403, reason: 'Origin not allowed' };
  }
  if (req.fetchSite !== undefined && req.fetchSite !== 'same-origin' && req.fetchSite !== 'none') {
    // 'same-site' too: another port of 127.0.0.1 is another site's page for us (only the dev origin, which the proxy makes same-origin, is allowed).
    return { ok: false, status: 403, reason: 'cross-site request' };
  }
  return { ok: true };
}
