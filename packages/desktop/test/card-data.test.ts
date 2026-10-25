/** The desktop app refreshes card data a day old at launch (cardData.ts), so new cards show up without pressing Check for updates. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_DATA_MAX_AGE_MS, cardDataStale, refreshCardData } from '../src/cardData';

const dirWith = (meta: unknown) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openmtg-card-data-'));
  writeFileSync(path.join(dir, 'bulk-meta.json'), JSON.stringify(meta));
  return dir;
};

describe('card data refresh at launch', () => {
  it('is stale after a day, or when its date cannot be read', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    expect(cardDataStale(dirWith({ downloaded_at: '2026-10-25T06:00:00Z' }), now)).toBe(false);
    expect(cardDataStale(dirWith({ downloaded_at: new Date(now - CARD_DATA_MAX_AGE_MS - 1).toISOString() }), now)).toBe(true);
    expect(cardDataStale(dirWith({}), now)).toBe(true);
    expect(cardDataStale(path.join(os.tmpdir(), 'openmtg-no-such-dir'), now)).toBe(true);
  });

  it("asks the server for the Check for updates button's update", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const post = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('{}', { status: 202 });
    }) as typeof fetch;
    expect(await refreshCardData('http://127.0.0.1:47600/', post)).toBe(true);
    expect(calls).toEqual([{ url: 'http://127.0.0.1:47600/api/update', init: expect.objectContaining({ method: 'POST', body: '{}' }) }]);
    expect(await refreshCardData('http://127.0.0.1:47600/', (async () => new Response('', { status: 409 })) as typeof fetch)).toBe(true);
    expect(await refreshCardData('http://127.0.0.1:47600/', (async () => { throw new Error('offline'); }) as typeof fetch)).toBe(false);
  });
});
