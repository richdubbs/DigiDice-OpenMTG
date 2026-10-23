/** The C1 endpoints through the real HTTP server on 127.0.0.1 over fixture cards: routing, JSON bodies, status codes. No other network. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CardDetailResponse, DefsResponse, ImageMatchResponse, ResolveResponse, SearchResponse, StatusResponse } from '../src/api';
import { cardStore, closeCardStores } from '../src/cache';
import { startServer, type RunningServer } from '../src/http';
import { makeFixtureCache, TEST_IMAGE, type FixtureCache } from './fixture-cache';

// Compiling fixture cards (search pages, definitions, the classification index) takes seconds on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });
// The classification-index tests also pass it themselves: in a full `npm test` run (shared worker threads) they timed out at the 5 s default.

let fx: FixtureCache;
let srv: RunningServer;

beforeAll(async () => {
  fx = makeFixtureCache();
  srv = await startServer({ port: 0, clientDist: null, cacheDir: fx.ctx.cacheDir, compiledDir: fx.ctx.compiledDir, version: '9.9.9' });
});

afterAll(async () => {
  await srv.close();
  await closeCardStores();
  fx.cleanup();
});

const get = async <T>(p: string): Promise<{ status: number; body: T }> => {
  const r = await fetch(`${srv.url}${p}`);
  return { status: r.status, body: (await r.json()) as T };
};
const post = async <T>(p: string, body: unknown): Promise<{ status: number; body: T }> => {
  const r = await fetch(`${srv.url}${p}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  return { status: r.status, body: (await r.json()) as T };
};

describe('C1 API over HTTP', () => {
  it('search, detail (URL-encoded name), resolve, defs and image matching answer 200 with the documented shapes', async () => {
    const s = await get<SearchResponse>('/api/cards/search?q=lightning%20bolt&images=1');
    expect(s.status).toBe(200);
    expect(s.body.cards[0]!.faces[0]!.imageUris?.normal).toBe(TEST_IMAGE.normal);
    const d = await get<CardDetailResponse>(`/api/cards/${encodeURIComponent('Fire // Ice')}`);
    expect(d.status).toBe(200);
    expect(d.body.card.faces.map((f) => f.name)).toEqual(['Fire', 'Ice']);
    const r = await post<ResolveResponse>('/api/decks/resolve', { text: '4 Shock\n2 Murder' });
    expect(r.body.cards.map((c) => c.name)).toEqual(['Shock', 'Murder']);
    const defs = await post<DefsResponse>('/api/cards/defs', { names: ['Shock', 'Murder'] });
    expect(Object.keys(defs.body.defs)).toEqual(['Shock', 'Murder']);
    const img = await post<ImageMatchResponse>('/api/images/match', { fileNames: ['Shock.jpg'] });
    expect(img.body.matches[0]!.match?.card).toBe('Shock');
  });

  it('answers 400 for bad input, 404 for an unknown card, and reports coverage on /api/status once the index is classified', async () => {
    expect((await get('/api/cards/search?mv=lots')).status).toBe(400);
    expect((await get('/api/cards/No%20Such%20Card%20At%20All')).status).toBe(404);
    expect((await post('/api/cards/defs', { names: 'Shock' })).status).toBe(400);
    const opened = await cardStore(fx.ctx);
    if (!opened.ok) throw new Error(opened.error);
    await opened.store.automation.start();
    const status = await get<StatusResponse>('/api/status');
    expect(status.body.coverage?.total).toBe(fx.deckCards.length);
  }, 60_000);
});
