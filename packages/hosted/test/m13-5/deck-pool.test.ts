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
