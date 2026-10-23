/**
 * Who may open the online socket and read its token (src/online/guard.ts; audit 2026-10-12 m11, docs/design/online.md "Browser and local server").
 * In process only: the checks are called with crafted headers, nothing is sent over a socket.
 */
import { describe, expect, it } from 'vitest';
import { checkExtraOrigin, checkSessionRequest, checkUpgrade, newOnlineToken, sameToken } from '../src/online/guard';

const PORT = 47600;
const TOKEN = newOnlineToken();
const OWN = `http://127.0.0.1:${PORT}`;
const url = (token: string | null = TOKEN, path = '/api/online/socket') => (token === null ? path : `${path}?token=${token}`);
const upgrade = (h: { url?: string; host?: string; origin?: string | string[] }, extraOrigins: string[] = []) =>
  checkUpgrade({ url: h.url ?? url(), host: 'host' in h ? h.host : `127.0.0.1:${PORT}`, origin: 'origin' in h ? h.origin : OWN }, { port: PORT, token: TOKEN, extraOrigins });

describe('the WebSocket upgrade (audit m11)', () => {
  it('accepts exactly this server\'s origin (127.0.0.1 or localhost, the bound port) with the token', () => {
    expect(upgrade({})).toEqual({ ok: true });
    expect(upgrade({ origin: `http://localhost:${PORT}`, host: `localhost:${PORT}` })).toEqual({ ok: true });
  });

  it('refuses a cross-origin page, a missing Origin, "null", look-alikes and near misses', () => {
    for (const origin of [
      'https://evil.test', 'http://evil.test', `http://127.0.0.1:${PORT}.evil.test`, `http://127.0.0.1.evil.test:${PORT}`, `http://127.0.0.1:${PORT}/`,
      `http://127.0.0.1:${PORT}/x`, `https://127.0.0.1:${PORT}`, `http://127.0.0.1:${PORT + 1}`, 'http://127.0.0.1', `http://[::1]:${PORT}`, `HTTP://127.0.0.1:${PORT}`,
      `http://0.0.0.0:${PORT}`, `http://127.0.0.2:${PORT}`, `http://localhost.:${PORT}`, `${OWN} `, `x${OWN}`, 'null', '*', '',
    ]) {
      expect(upgrade({ origin }), origin).toMatchObject({ ok: false, status: 403, reason: 'Origin not allowed' });
    }
    expect(upgrade({ origin: undefined })).toMatchObject({ ok: false, status: 403, reason: 'Origin missing' });
    expect(upgrade({ origin: [OWN, OWN] })).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a Host that is not a loopback name with the bound port (DNS rebinding)', () => {
    for (const host of [`evil.test:${PORT}`, 'evil.test', `127.0.0.1:${PORT + 1}`, '127.0.0.1', `localhost.evil.test:${PORT}`, `[::1]:${PORT}`, `127.0.0.1:${PORT}.evil.test`, '']) {
      expect(upgrade({ host }), host).toMatchObject({ ok: false, status: 403 });
    }
    expect(upgrade({ host: undefined })).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a missing, wrong, malformed or repeated token, and other paths', () => {
    expect(upgrade({ url: url(null) })).toMatchObject({ ok: false, status: 403, reason: 'bad token' });
    expect(upgrade({ url: url(newOnlineToken()) })).toMatchObject({ ok: false, status: 403, reason: 'bad token' });
    expect(upgrade({ url: url(TOKEN.toUpperCase()) })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ url: url(TOKEN.slice(1)) })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ url: url('') })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ url: `${url()}&token=${TOKEN}` })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ url: url(TOKEN, '/api/online/socket/') })).toMatchObject({ ok: false, status: 404 });
    expect(upgrade({ url: url(TOKEN, '/api/status') })).toMatchObject({ ok: false, status: 404 });
    expect(upgrade({ url: '//evil.test/api/online/socket?token=x' })).toMatchObject({ ok: false });
  });

  it('accepts a configured dev origin (the Vite dev server) only when it is configured, and only loopback ones can be', () => {
    const vite = 'http://127.0.0.1:5173';
    expect(upgrade({ origin: vite })).toMatchObject({ ok: false });
    expect(upgrade({ origin: vite }, [vite])).toEqual({ ok: true });
    expect(checkExtraOrigin(vite)).toBeNull();
    expect(checkExtraOrigin('http://localhost:5173')).toBeNull();
    for (const bad of ['https://127.0.0.1:5173', 'http://evil.test:5173', 'http://127.0.0.1', 'http://127.0.0.1:5173/', 'http://127.0.0.1:0', 'http://127.0.0.1:99999', 'http://127.0.0.1:05173', '*', 'null']) {
      expect(checkExtraOrigin(bad), bad).not.toBeNull();
    }
  });

  it('compares tokens in constant time and only in their format', () => {
    expect(sameToken(TOKEN, TOKEN)).toBe(true);
    expect(sameToken(undefined, TOKEN)).toBe(false);
    expect(sameToken(`${TOKEN}0`, TOKEN)).toBe(false);
    expect(TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(newOnlineToken()).not.toBe(TOKEN);
  });
});

describe('GET /api/online/session (the token for the client\'s own page)', () => {
  const session = (h: { host?: string; origin?: string; fetchSite?: string }) =>
    checkSessionRequest({ host: 'host' in h ? h.host : `127.0.0.1:${PORT}`, origin: h.origin, fetchSite: h.fetchSite }, { port: PORT });

  it('answers the client\'s own same-origin fetch', () => {
    expect(session({ fetchSite: 'same-origin' })).toEqual({ ok: true });
    expect(session({ origin: OWN, fetchSite: 'same-origin' })).toEqual({ ok: true });
    expect(session({})).toEqual({ ok: true }); // an older browser without Sec-Fetch-Site
  });

  it('refuses another site, in cors mode (Origin) or no-cors mode (Sec-Fetch-Site), and a rebinding Host', () => {
    expect(session({ origin: 'https://evil.test', fetchSite: 'cross-site' })).toMatchObject({ ok: false, status: 403 });
    expect(session({ fetchSite: 'cross-site' })).toMatchObject({ ok: false, status: 403 });
    expect(session({ fetchSite: 'same-site' })).toMatchObject({ ok: false, status: 403 }); // another port of 127.0.0.1
    expect(session({ origin: 'null' })).toMatchObject({ ok: false, status: 403 });
    expect(session({ host: `evil.test:${PORT}`, fetchSite: 'same-origin' })).toMatchObject({ ok: false, status: 403 });
  });
});
