/** Contract points other packages build on: Oracle ids in the API (C1, C3) and the coverage numbers of /api/status coming from cache.ts (C1). */
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CardSummary, DeckList, ResolvedCard } from '../src/api';
import { getStatus } from '../src/status';

vi.mock('../src/cache', () => ({ coverageCounts: vi.fn(async () => ({ full: 1, partial: 2, manual: 3, total: 6 })) }));

describe('API contract', () => {
  it('identifies cards by Oracle id as well as Oracle name, so decks survive card-data refreshes (decks-and-formats.md)', () => {
    expectTypeOf<CardSummary>().toHaveProperty('oracleId').toEqualTypeOf<string>();
    expectTypeOf<ResolvedCard>().toHaveProperty('oracleId').toEqualTypeOf<string>();
    expectTypeOf<DeckList['main'][number]>().toHaveProperty('oracleId').toEqualTypeOf<string | undefined>();
  });
});

describe('GET /api/status', () => {
  it('reports the automation coverage that cache.ts computes (C1 fills coverageCounts in without touching status.ts)', async () => {
    const r = await getStatus({ query: {}, params: {}, body: undefined }, { cacheDir: '/nonexistent-openmtg-cache', compiledDir: '/nonexistent', version: '1' });
    expect(r.status).toBe(200);
    if (r.status === 200) expect(r.body.coverage).toEqual({ full: 1, partial: 2, manual: 3, total: 6 });
  });
});
