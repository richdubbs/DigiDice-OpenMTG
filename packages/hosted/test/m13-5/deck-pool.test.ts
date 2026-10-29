/**
 * M13-5: the deck pool's bounds (design 2.1, review 12): a full queue answers `busy`; a deck past its deadline is answered with an error and its worker
 * is replaced, and the next deck is checked normally.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeckWorkerPool } from '../../src/runtime';
import { DECKS, FIXTURE_CARDS } from './harness';

const deck = (extra: { name: string; count: number }[] = []) => ({ main: [...DECKS[0]!.map(([name, count]) => ({ name, count })), ...extra], sideboard: [] });

describe('M13-5 deck pool', () => {
  let pool: DeckWorkerPool;

  beforeAll(async () => {
    pool = new DeckWorkerPool({ workers: 1, cards: { module: FIXTURE_CARDS, options: { hangOn: 'Hang Card', hangMs: 3_000 } }, deadlineMs: 400, queue: 1 });
    await pool.ready();
  }, 120_000);

  afterAll(async () => {
    await pool?.close();
  });

  it('answers busy when the queue is full; a deck past its deadline gets an error and its worker is replaced', async () => {
    // The first deck hangs the only worker; the second waits in the queue (1); the third finds it full.
    const slow = pool.prepare(deck([{ name: 'Hang Card', count: 1 }]), 'casual');
    const queued = pool.prepare(deck(), 'casual');
    const busy = await pool.prepare(deck(), 'casual');
    expect(busy).toMatchObject({ ok: false, busy: true });
    expect(await slow).toMatchObject({ ok: false, timeout: true });
    // The queued deck runs on the replacement worker.
    const r = await queued;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.deck.main).toHaveLength(60);
  }, 120_000);

  it('refuses a malformed decklist before any worker sees it', async () => {
    expect(await pool.prepare({ main: 'nope' } as never, 'casual')).toMatchObject({ ok: false });
  });
});

describe('F32: the deck pool paces each session and keeps checked lists', () => {
  let pool: DeckWorkerPool;
  const clock = { t: 1_000_000 };
  /** A list that differs by the count of its first card (n: 1-4). */
  const variant = (n: number) => ({ main: DECKS[0]!.map(([name, count], i) => ({ name, count: i === 0 ? n : count })), sideboard: [] });

  beforeAll(async () => {
    pool = new DeckWorkerPool({ workers: 1, cards: { module: FIXTURE_CARDS }, deadlineMs: 10_000, queue: 16, now: () => clock.t });
    await pool.ready();
  }, 120_000);

  afterAll(async () => {
    await pool?.close();
  });

  it('a session gets 3 checks at once, then 1 every 2 s (rateLimited with the wait); other sessions and the server are not held back', async () => {
    for (let n = 1; n <= 3; n++) expect(await pool.prepare(variant(n), 'casual', 'flood')).not.toMatchObject({ rateLimited: true });
    const paced = await pool.prepare(variant(4), 'casual', 'flood');
    expect(paced).toMatchObject({ ok: false, rateLimited: true });
    expect((paced as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(1_000);
    expect((paced as { retryAfterMs: number }).retryAfterMs).toBeLessThanOrEqual(2_000);
    expect(await pool.prepare(variant(4), 'standard', 'someone-else')).not.toMatchObject({ rateLimited: true });
    expect(await pool.prepare(variant(4), 'modern')).not.toMatchObject({ rateLimited: true }); // the server's own check
    clock.t += 2_000;
    expect(await pool.prepare(variant(4), 'pioneer', 'flood')).not.toMatchObject({ rateLimited: true });
  }, 120_000);

  it('the same list for the same format is answered from the cache (a copy, no token) for 5 minutes', async () => {
    clock.t += 60_000;
    const first = await pool.prepare(deck(), 'casual', 'cache-a');
    expect(first.ok).toBe(true);
    const hits = pool.cacheHits;
    // Another session, several times: from the cache, past any pace.
    for (let i = 0; i < 5; i++) {
      const again = await pool.prepare(deck(), 'casual', 'cache-b');
      expect(again).toEqual(first);
      expect(again).not.toBe(first);
    }
    expect(pool.cacheHits).toBe(hits + 5);
    // Changing an answer does not change the cache.
    if (first.ok) first.deck.main.length = 0;
    const copy = await pool.prepare(deck(), 'casual');
    expect(copy.ok && copy.deck.main.length).toBe(60);
    // Another format is another check; 5 minutes later the list is checked again.
    await pool.prepare(deck(), 'legacy');
    expect(pool.cacheHits).toBe(hits + 6);
    clock.t += 5 * 60_000;
    await pool.prepare(deck(), 'casual');
    expect(pool.cacheHits).toBe(hits + 6);
  }, 120_000);
});

