/**
 * M15-5: `parkedHigh` (design 11.1, 7's scenario S1): at a season's close, an account with a final rank in the top 100 or a Laser or Prism badge
 * whose last rated game was at least 14 days before the season's end, with the rating after it at least 150 above its season median. Run by
 * `daily` over the seasons closed since the last run, paging through `seasonRecordsOf` (17.8).
 */
import { describe, expect, it } from 'vitest';
import { createAbuseChecker, type AbuseDraft, type SeasonRecord } from '@openmtg/ladder';
import { A, acc, B, C, context, D, E, F, FakeAbuseStore, seasonRecord, win } from './fixtures';

const checker = createAbuseChecker();
/** A day after September 2026 closed (it ended at 2026-10-01T00:00:00.000Z). */
const NOW = '2026-10-02T00:00:00.000Z';
const SEPT = [{ ladder: '1v1-standard' as const, season: '2026-09' }];
const RATINGS = [1600, 1640, 1650, 1660, 1700]; // median 1650
const LAST = '2026-09-10T12:00:00.000Z'; // 20.5 days before the end

async function daily(records: SeasonRecord[], store = new FakeAbuseStore()): Promise<AbuseDraft[]> {
  store.records.push(...records);
  return (await checker.daily(SEPT, context(store, { now: NOW }))).filter((d) => d.kind === 'parkedHigh');
}

describe('M15-5: parkedHigh', () => {
  it('fires on a top-100 rank parked 20.5 days with a rating 170 above its median, naming the season\'s last game', async () => {
    const store = new FakeAbuseStore().add(
      win('aug', '2026-08-20T00:00:00.000Z', A, B),
      win('sep-last', LAST, A, B),
      win('sep-early', '2026-09-03T00:00:00.000Z', A, C),
      win('oct', '2026-10-01T10:00:00.000Z', A, C), // the next season: not the last game of September
    );
    const drafts = await daily([seasonRecord(A, { display: 1820, ratings: RATINGS, lastGameAt: LAST, finalRank: 7, badge: 'laser' })], store);
    expect(drafts).toEqual([{
      kind: 'parkedHigh', ladder: '1v1-standard', accounts: [A],
      evidence: {
        games: ['sep-last'],
        stats: {
          display: 1820, median: 1650, aboveMedian: 170, idleDays: 20.5, seasonGames: 15, finalRank: 7, badge: 4,
          'rating.1': 1600, 'rating.2': 1640, 'rating.3': 1650, 'rating.4': 1660, 'rating.5': 1700,
        },
      },
    }]);
  });

  it('fires on a Prism badge without a final rank, and on parking exactly 14 days', async () => {
    const drafts = await daily([
      seasonRecord(A, { display: 1820, ratings: RATINGS, lastGameAt: LAST, badge: 'prism' }),
      seasonRecord(B, { display: 1820, ratings: RATINGS, lastGameAt: '2026-09-17T00:00:00.000Z', finalRank: 100 }),
    ]);
    expect(drafts.map((d) => [d.accounts, d.evidence.stats['finalRank'], d.evidence.stats['badge'], d.evidence.games])).toEqual([
      [[A], undefined, 5, []], [[B], 100, undefined, []],
    ]);
  });

  it('stays quiet on each near miss: 13.99 days parked, 149 above the median, rank 101 with an Arc badge, a deleted account, no median', async () => {
    const drafts = await daily([
      seasonRecord(A, { display: 1820, ratings: RATINGS, lastGameAt: '2026-09-17T00:00:00.001Z', finalRank: 7 }),
      seasonRecord(B, { display: 1799, ratings: RATINGS, lastGameAt: LAST, finalRank: 7 }),
      seasonRecord(C, { display: 1820, ratings: RATINGS, lastGameAt: LAST, finalRank: 101, badge: 'arc' }),
      seasonRecord(null, { display: 1820, ratings: [], lastGameAt: '2026-09-30T23:59:59.999Z', finalRank: 3, badge: 'prism', sortKey: 'deleted:00000000000000000000000001' }),
      seasonRecord(D, { display: 1820, ratings: [], lastGameAt: LAST, finalRank: 7 }),
    ]);
    expect(drafts).toEqual([]);
  });

  it('pages through every record of the season by sortKey, and judges only the seasons it is given', async () => {
    const fillers = Array.from({ length: 450 }, (_, i) => seasonRecord(acc(1000 + i), { display: 1700, ratings: RATINGS, lastGameAt: LAST, finalRank: 50 }));
    const store = new FakeAbuseStore();
    const drafts = await daily([
      seasonRecord(E, { display: 1820, ratings: RATINGS, lastGameAt: LAST, finalRank: 7 }),
      ...fillers,
      seasonRecord(acc(9999), { display: 1820, ratings: RATINGS, lastGameAt: LAST, badge: 'laser' }),
      seasonRecord(F, { season: '2026-08', display: 1820, ratings: RATINGS, lastGameAt: '2026-08-01T00:00:00.000Z', finalRank: 1 }),
    ], store);
    expect(drafts.map((d) => d.accounts)).toEqual([[E], [acc(9999)]]);
    const pages = store.callsOf('seasonRecordsOf');
    expect(pages.map((p) => p[2])).toEqual([null, acc(1000 + 198), acc(1000 + 398)]);
    expect(pages.every((p) => p[0] === '1v1-standard' && p[1] === '2026-09')).toBe(true);
  });

  it('never runs without a closed season', async () => {
    const store = new FakeAbuseStore();
    store.records.push(seasonRecord(A, { display: 1820, ratings: RATINGS, lastGameAt: LAST, finalRank: 7 }));
    expect(await checker.daily([], context(store, { now: NOW }))).toEqual([]);
    expect(store.callsOf('seasonRecordsOf')).toEqual([]);
  });
});
