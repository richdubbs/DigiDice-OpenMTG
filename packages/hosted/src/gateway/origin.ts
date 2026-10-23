/**
 * The strict Origin allow-list of the WebSocket upgrade (design 3.1, 11; the 2026-10-12 audit's m11 rules, online.md). The upgrade is refused (403)
 * unless `Origin` is present and EXACTLY one of:
 * - `PUBLIC_ORIGINS` (production: `https://play.digidice.net`; config.ts accepts only exact https origins), or
 * - with `ALLOW_DESKTOP_ORIGINS` (default on), a loopback origin of the desktop app's page: `http://127.0.0.1:<port>` or `http://localhost:<port>`.
 * No `null`, no prefix or suffix matching, no wildcard, no case folding, no default port, no trailing slash. The token travels in a message (D6), so the
 * Origin check is defense in depth: it stops other web pages from using visitors' browsers as clients.
 */

export interface OriginPolicy {
  publicOrigins: readonly string[];
  allowDesktopOrigins: boolean;
}

/** The desktop app's loopback origins: http, 127.0.0.1 or localhost, an explicit port 1-65535 without leading zeros. */
const DESKTOP = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/;

export function originAllowed(origin: string | string[] | undefined, p: OriginPolicy): boolean {
  if (typeof origin !== 'string' || origin.length === 0 || origin.length > 256) return false;
  if (p.publicOrigins.includes(origin)) return true;
  if (!p.allowDesktopOrigins) return false;
  const m = DESKTOP.exec(origin);
  return m !== null && Number(m[1]) <= 65_535;
}
