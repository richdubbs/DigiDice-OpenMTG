/**
 * Keeping the card data fresh (owner, 2026-10-25: new cards must show up without pressing "Check for updates"). The first start downloads the card data;
 * after that, every launch whose card data is more than a day old asks the local server for the same update the About screen's "Check for updates"
 * button runs (POST /api/update), in the background, so the game opens at once and the new cards appear when the download is done. Scryfall's file
 * only downloads when it is newer than the one on disk.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** How old the card data may be before a launch refreshes it. */
export const CARD_DATA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Whether the card data in `cacheDir` was downloaded more than CARD_DATA_MAX_AGE_MS ago, or its date cannot be read. */
export function cardDataStale(cacheDir: string, now = Date.now()): boolean {
  try {
    const meta = JSON.parse(readFileSync(path.join(cacheDir, 'bulk-meta.json'), 'utf8')) as { downloaded_at?: unknown };
    const t = typeof meta.downloaded_at === 'string' ? Date.parse(meta.downloaded_at) : NaN;
    return !Number.isFinite(t) || now - t > CARD_DATA_MAX_AGE_MS;
  } catch {
    return true;
  }
}

/** Starts the server's card-data update in the background (the "Check for updates" button's request); a failure only leaves the old data. */
export async function refreshCardData(serverUrl: string, post: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await post(new URL('/api/update', serverUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    // 409: an update is already running, which is as good.
    return r.ok || r.status === 409;
  } catch {
    return false;
  }
}
