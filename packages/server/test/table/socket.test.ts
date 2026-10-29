/**
 * Godot plan phase 1: the table channel's WebSocket on a real server (startServer on an ephemeral port, Node's `ws` as the client). Who may open it
 * (src/table/socket.ts `checkTableUpgrade`, like the online socket's guard, audit 2026-10-12 m11): a loopback Host with the bound port; this server's
 * own page by its Origin without a token; anything without an Origin (the Godot app) only with the per-launch token; never another site's page. The
 * online socket keeps working beside it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../../src/http';
import type { TableServerMessage } from '../../src/table/api';
import { checkTableUpgrade } from '../../src/table/socket';
import { TOKEN, bearsConfig } from './helpers';

const PORT = 47999;
const OWN = `http://127.0.0.1:${PORT}`;
const upgrade = (h: { url?: string; host?: string; origin?: string | string[]; fetchSite?: string }) =>
  checkTableUpgrade({ url: h.url ?? '/table', host: 'host' in h ? h.host : `127.0.0.1:${PORT}`, origin: h.origin, fetchSite: h.fetchSite }, { port: PORT, token: TOKEN, extraOrigins: ['http://127.0.0.1:5173'] });

describe('checkTableUpgrade', () => {
  it('trusts this server\'s own page by its Origin, and a socket with the token in its URL', () => {
    expect(upgrade({ origin: OWN, fetchSite: 'same-origin' })).toEqual({ ok: true, trusted: true });
    expect(upgrade({ origin: `http://localhost:${PORT}` })).toEqual({ ok: true, trusted: true });
    expect(upgrade({ origin: 'http://127.0.0.1:5173' })).toEqual({ ok: true, trusted: true });
    expect(upgrade({ url: `/table?token=${TOKEN}` })).toEqual({ ok: true, trusted: true });
    // No Origin, no token: accepted, but the hello must carry the token (TableChannel).
    expect(upgrade({})).toEqual({ ok: true, trusted: false });
  });

  it('refuses another site\'s page (token or not), a cross-site fetch, a wrong or repeated token, a foreign Host and other paths', () => {
    expect(upgrade({ origin: 'http://evil.test' })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ origin: 'http://evil.test', url: `/table?token=${TOKEN}` })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ origin: [OWN, OWN] })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ origin: 'null' })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ fetchSite: 'cross-site' })).toMatchObject({ ok: false, status: 403, reason: 'cross-site request' });
    expect(upgrade({ fetchSite: 'same-site', origin: OWN })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ url: `/table?token=${'cd'.repeat(32)}` })).toMatchObject({ ok: false, status: 403, reason: 'bad token' });
    expect(upgrade({ url: `/table?token=${TOKEN}&token=${TOKEN}` })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ host: `evil.test:${PORT}`, origin: OWN })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ host: '127.0.0.1:1', origin: OWN })).toMatchObject({ ok: false, status: 403 });
    expect(upgrade({ url: '/tables', origin: OWN })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('the /table socket on a running server', () => {
  let srv: RunningServer;
  let dir: string;
  let base: string;
  let ws: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'openmtg-table-'));
    srv = await startServer({ port: 0, clientDist: null, cacheDir: path.join(dir, 'cache'), version: '1.2.3', online: { token: TOKEN } });
    base = srv.url;
    ws = base.replace('http:', 'ws:');
  });

  afterAll(async () => {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Open a socket; resolves with it and its messages once open, or rejects with the refusal's status. */
  function open(url: string, origin?: string): Promise<{ sock: WebSocket; got: TableServerMessage[]; closed: Promise<number> }> {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(url, origin ? { origin, perMessageDeflate: false } : { perMessageDeflate: false });
      const got: TableServerMessage[] = [];
      const closed = new Promise<number>((r) => sock.on('close', (code) => r(code)));
      sock.on('message', (data) => got.push(JSON.parse(String(data)) as TableServerMessage));
      sock.on('open', () => resolve({ sock, got, closed }));
      sock.on('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))));
      sock.on('error', reject);
    });
  }

  const until = async (got: TableServerMessage[], t: TableServerMessage['t']) => {
    for (let i = 0; i < 200; i++) {
      const m = got.find((x) => x.t === t);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no ${t}`);
  };

  it('shares the per-launch token with the online socket', () => {
    expect(srv.token).toBe(TOKEN);
    expect(srv.table?.token).toBe(TOKEN);
    expect(srv.online?.token).toBe(TOKEN);
  });

  it('plays from this server\'s own page without a token: hello, start, table, view', async () => {
    const { sock, got } = await open(`${ws}/table`, base);
    sock.send(JSON.stringify({ t: 'hello', protocol: 1 }));
    expect(await until(got, 'welcome')).toMatchObject({ protocol: 1, version: '1.2.3' });
    sock.send(JSON.stringify({ t: 'start', kind: 'hotseat', config: bearsConfig('socket-hotseat') }));
    expect(await until(got, 'table')).toMatchObject({ kind: 'hotseat', seats: ['p1', 'p2'] });
    const view = await until(got, 'view');
    expect(view).toMatchObject({ seq: 1, handoff: expect.any(String) });
    expect(view.t === 'view' && view.view.viewer).toBeNull();
    sock.close();
  });

  it('lets the Godot app (no Origin) in only with the token, in hello or in the URL', async () => {
    const a = await open(`${ws}/table`);
    a.sock.send(JSON.stringify({ t: 'hello', protocol: 1 }));
    expect(await a.closed).toBe(4004);
    const b = await open(`${ws}/table`);
    b.sock.send(JSON.stringify({ t: 'hello', protocol: 1, token: TOKEN }));
    expect(await until(b.got, 'welcome')).toMatchObject({ protocol: 1 });
    b.sock.close();
    const c = await open(`${ws}/table?token=${TOKEN}`);
    c.sock.send(JSON.stringify({ t: 'hello', protocol: 1 }));
    expect(await until(c.got, 'welcome')).toMatchObject({ protocol: 1 });
    c.sock.close();
  });

  it('refuses another site\'s page and another path', async () => {
    await expect(open(`${ws}/table?token=${TOKEN}`, 'http://evil.test')).rejects.toThrow('403');
    await expect(open(`${ws}/nowhere`, base)).rejects.toThrow('404');
  });

  it('keeps the online socket working beside it', async () => {
    const { sock, got } = await open(`${ws}/api/online/socket?token=${TOKEN}`, base);
    for (let i = 0; i < 200 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect((got[0] as unknown as { t: string }).t).toBe('status');
    sock.close();
  });
});
