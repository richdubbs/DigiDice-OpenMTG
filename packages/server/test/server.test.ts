/** Smoke test of the local server: static client, API routing, answers without card data, status and the loopback-only safety checks. No network beyond 127.0.0.1. */
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPILER_VERSION } from '@openmtg/engine';
import { ENDPOINTS, MAX_BODY_BYTES, ROUTES, matchRoute, startServer, type RunningServer, type StatusResponse } from '../src/index';

let tmp: string;
let srv: RunningServer;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'openmtg-server-'));
  const dist = path.join(tmp, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OpenMTG by DigiDice</title><div id="root"></div>');
  writeFileSync(path.join(dist, 'assets', 'app-123.js'), 'console.log(1)');
  writeFileSync(path.join(tmp, 'secret.txt'), 'outside the client');
  const cacheDir = path.join(tmp, 'scryfall');
  mkdirSync(cacheDir);
  writeFileSync(path.join(cacheDir, 'bulk-meta.json'), JSON.stringify({ updated_at: '2026-10-11T21:01:56.537+00:00', downloaded_at: '2026-10-11T22:15:00.384Z', index: { cards: 34473 } }));
  srv = await startServer({ port: 0, clientDist: dist, cacheDir, version: '1.2.3' });
});

afterAll(async () => {
  await srv.close();
  rmSync(tmp, { recursive: true, force: true });
});

function raw(pathname: string, headers: Record<string, string> = {}, method = 'GET', body?: string): Promise<{ status: number; headers: Record<string, unknown>; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: srv.port, path: pathname, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('server smoke test', () => {
  it('listens on 127.0.0.1 only and reports the URL', () => {
    expect(srv.url).toBe(`http://127.0.0.1:${srv.port}`);
    expect((srv.server.address() as { address: string }).address).toBe('127.0.0.1');
  });

  it('serves the built client with security headers and the Scryfall image host in the CSP', async () => {
    const r = await fetch(`${srv.url}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    expect(await r.text()).toContain('OpenMTG by DigiDice');
    expect(r.headers.get('content-security-policy')).toContain('img-src \'self\' data: blob: https://*.scryfall.io');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('caches hashed assets and falls back to index.html for extension-less paths only', async () => {
    const asset = await fetch(`${srv.url}/assets/app-123.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
    expect((await fetch(`${srv.url}/some/screen`)).status).toBe(200);
    expect((await fetch(`${srv.url}/missing.png`)).status).toBe(404);
  });

  it('never serves files outside the client directory', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const r = await raw(p);
      expect(r.text).not.toContain('outside the client');
    }
  });

  it('rejects requests whose Host is not a loopback name (DNS rebinding)', async () => {
    expect((await raw('/api/status', { Host: 'evil.example' })).status).toBe(421);
    expect((await raw('/api/status', { Host: `localhost:${srv.port}` })).status).toBe(200);
  });

  it('GET /api/status reports versions and the card-data date from bulk-meta.json', async () => {
    const r = await fetch(`${srv.url}/api/status`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as StatusResponse;
    expect(body).toEqual({
      app: { name: 'OpenMTG', version: '1.2.3' },
      compilerVersion: COMPILER_VERSION,
      cardData: { updatedAt: '2026-10-11T21:01:56.537+00:00', downloadedAt: '2026-10-11T22:15:00.384Z', cards: 34473 },
      rulesPack: null,
      coverage: null,
    });
  });

  it('every card endpoint answers 503 with the refresh instructions while the cache has no card index (C1)', async () => {
    const stubs: [string, string, unknown?][] = [
      ['GET', '/api/cards/search?q=bolt'],
      ['GET', '/api/cards/Lightning%20Bolt'],
      ['POST', '/api/decks/resolve', { text: '4 Lightning Bolt' }],
      ['POST', '/api/cards/defs', { names: ['Lightning Bolt'] }],
      ['POST', '/api/decks/validate', { deck: { main: [], sideboard: [] }, format: 'modern' }],
      ['POST', '/api/images/match', { fileNames: ['bolt.jpg'] }],
    ];
    for (const [method, p, body] of stubs) {
      const r = await fetch(`${srv.url}${p}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
      expect(r.status, `${method} ${p}`).toBe(503);
      const json = (await r.json()) as { error: string };
      expect(json.error).toMatch(/npm run cards -- refresh|not available in this build/);
    }
  });

  it('answers unknown endpoints, wrong methods, non-JSON and invalid JSON bodies with errors', async () => {
    expect((await fetch(`${srv.url}/api/nope`)).status).toBe(404);
    const wrong = await fetch(`${srv.url}/api/decks/resolve`);
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');
    expect((await fetch(`${srv.url}/api/decks/resolve`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    expect((await fetch(`${srv.url}/api/decks/resolve`, { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } })).status).toBe(400);
  });

  it('answers bodies over the size limit with a JSON 413, never a connection reset (with and without Content-Length)', async () => {
    for (const mb of [3, 10, 20]) {
      const big = JSON.stringify({ text: 'x'.repeat(mb * 1024 * 1024) });
      for (const chunked of [false, true]) {
        const length: Record<string, string> = chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': String(Buffer.byteLength(big)) };
        for (let i = 0; i < 2; i++) {
          const r = await raw('/api/decks/resolve', { 'Content-Type': 'application/json', ...length }, 'POST', big);
          expect(r.status, `${mb} MB ${chunked ? 'chunked' : 'with Content-Length'}`).toBe(413);
          expect(JSON.parse(r.text)).toEqual({ error: `Body larger than ${MAX_BODY_BYTES} bytes` });
        }
      }
    }
    expect((await fetch(`${srv.url}/api/status`)).status).toBe(200);
  });
});

describe('route table', () => {
  it('has exactly one handler per endpoint of api.ts', () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...ENDPOINTS].sort());
  });

  it('prefers literal routes over parameter routes and decodes parameters', () => {
    const search = matchRoute('GET', '/api/cards/search');
    expect(search.kind === 'found' && search.key).toBe('GET /api/cards/search');
    const card = matchRoute('GET', '/api/cards/J%C3%B6tun%20Grunt');
    expect(card.kind === 'found' && card.params).toEqual({ name: 'Jötun Grunt' });
    expect(matchRoute('GET', '/api/cards/%E0%A4%A').kind).toBe('notFound');
  });
});
