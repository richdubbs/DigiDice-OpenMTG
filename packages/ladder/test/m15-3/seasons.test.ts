/**
 * M15-3: seasons through the service (design 7, 6.3, D7, 17.6): the month a game counts for, the lazy reset, when and how a season closes (the
 * grace, a caught-up read, running games, once, a quiet server), final standings at the season's end, badges.
 */
import { describe, expect, it } from 'vitest';
import {
  badgeTier, DEFAULT_TIER_FLOORS, displayRating, glicko2RdAt, seasonReset, standingOf, tierOf,
} from '../../src/api';
import { createMemoryLadderStore } from '../../src/service/create';
import type { LadderStore } from '../../src/store/api';
import { acc, DAY, ended, establish, gid, harness, HOUR, MINUTE, type Harness } from './fixtures';
import { wrapStore } from './support';

const A = acc(1);
const B = acc(2);
const PLAYERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** `a` plays `n` games against its own established opponent `opp` (1500/60), winning those `win(i)` says, one an hour. */
async function games(h: Harness, a: string, opp: string, n: number, first: number, win: (i: number) => boolean = () => true): Promise<void> {
  if (!(await h.store.ratings('1v1-standard', [opp as never])).has(opp as never)) await establish(h, opp as never, { model: 'glicko2', r: 1500, rd: 60, vol: 0.06 });
  for (let i = 0; i < n; i++) {
    await h.play({ game: gid(first + i), accounts: [a as never, opp as never], places: win(i) ? [1, 2] : [2, 1] });
    h.clock.advance(40 * MINUTE);
  }
}

describe('M15-3: the season a game counts for, and the lazy reset (7)', () => {
  it('a game across midnight counts for the month it ended in', async () => {
    const h = await harness({ accounts: PLAYERS, start: '2026-10-31T23:50:00.000Z' });
    await h.play({ game: gid(1), accounts: [A, B], durationMs: 30 * MINUTE });
    expect(await h.store.seasonRecord(A, '1v1-standard', '2026-10')).toBeNull();
    expect((await h.store.seasonRecord(A, '1v1-standard', '2026-11'))?.games).toBe(1);
    expect((await h.store.history({ account: A, limit: 1 }))[0]?.season).toBe('2026-11');
    expect((await h.store.ratings('1v1-standard', [A])).get(A)?.season).toBe('2026-11');
  });

  it('the reset applies once, at the first game or read in a new season, and is never shown as part of a game\'s change', async () => {
    const h = await harness({ accounts: PLAYERS });
    await establish(h, A, { model: 'glicko2', r: 1700, rd: 70, vol: 0.06 }, { season: '2026-10' });
    await establish(h, B, { model: 'glicko2', r: 1600, rd: 70, vol: 0.06 }, { season: '2026-10' });
    h.clock.set('2026-12-10T12:00:00.000Z'); // two seasons later: reset once all the same
    const stored = (await h.store.ratings('1v1-standard', [A])).get(A)!;
    const st = await h.svc.status(A);
    const view = st.ladders.find((l) => l.ladder === '1v1-standard')!.me!;
    expect(view.rating.display).toBe(displayRating(seasonReset(stored.state)));
    expect((await h.store.ratings('1v1-standard', [A])).get(A)!.season).toBe('2026-10'); // a read stores nothing
    await h.play({ game: gid(1), accounts: [A, B] });
    const seat = (await h.store.history({ account: A, limit: 1 }))[0]!.seats[0]!;
    expect(seat.before).toEqual(seasonReset(stored.state));
    expect(seat.displayBefore).toBe(1690);
    expect(h.rated[0]!.notices[0]!.before).toBe(1690);
    const after = (await h.store.ratings('1v1-standard', [A])).get(A)!;
    expect(after.season).toBe('2026-12');
    // the next game of the season starts from the stored row as is
    h.clock.advance(HOUR);
    await h.play({ game: gid(2), accounts: [A, B] });
    expect((await h.store.history({ account: A, limit: 1 }))[0]!.seats[0]!.before).toEqual(after.state);
  });
});

describe('M15-3: closing a season (7)', () => {
  it('waits for the grace, then closes once; a quiet server closes the same way', async () => {
    const h = await harness({ accounts: PLAYERS, start: '2026-10-31T23:00:00.000Z' });
    h.clock.set('2026-11-01T00:14:59.999Z');
    expect((await h.svc.sweep()).seasonsClosed).toEqual([]);
    h.clock.set('2026-11-01T00:15:00.000Z');
    expect((await h.svc.sweep()).seasonsClosed).toEqual(['2026-10']);
    for (const l of ['1v1-standard', '1v1-pioneer', '1v1-pauper', 'pod-commander'] as const) {
      expect(await h.store.seasonRow(l, '2026-10')).toEqual({ ladder: l, season: '2026-10', status: 'closed', floors: [...DEFAULT_TIER_FLOORS], closedAt: '2026-11-01T00:15:00.000Z', eligible: 0 });
    }
    h.clock.advance(MINUTE);
    expect((await h.svc.sweep()).seasonsClosed).toEqual([]);
    // a restarted service knows nothing in memory: it finds the season closed and closes nothing again
    const h2 = await harness({ store: h.store, start: '2026-11-01T00:17:00.000Z' });
    expect((await h2.svc.sweep()).seasonsClosed).toEqual([]);
    // a long-idle server catches up month by month
    h2.clock.set('2027-02-03T00:00:00.000Z');
    expect((await h2.svc.sweep()).seasonsClosed).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('waits for a caught-up ledger read: a failed row keeps the season open until it is taken in', async () => {
    let fail = true;
    const store = wrapStore(createMemoryLadderStore(), { before: (m) => { if (m === 'applyGame' && fail) throw new Error('disk full'); } });
    const h = await harness({ accounts: PLAYERS, store, start: '2026-10-31T23:00:00.000Z' });
    const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), { endedAt: '2026-10-31T23:20:00.000Z' });
    h.ledger!.commit(r);
    h.clock.set('2026-11-01T00:20:00.000Z');
    const rep = await h.svc.sweep();
    expect(rep).toMatchObject({ failed: 1, reconciled: 0, caughtUp: false });
    expect(await h.store.seasonRow('1v1-standard', '2026-10')).toMatchObject({ status: 'open' });
    fail = false;
    h.clock.advance(MINUTE);
    expect(await h.svc.sweep()).toMatchObject({ applied: 1, caughtUp: true, seasonsClosed: ['2026-10'] });
    expect((await h.store.seasonRecord(A, '1v1-standard', '2026-10'))?.games).toBe(1);
  });

  it('waits for running games that started before the end; a game across midnight counts for the new month', async () => {
    const h = await harness({ accounts: PLAYERS, start: '2026-10-31T23:50:00.000Z' });
    const r = await h.start({ game: gid(1), accounts: [A, B] });
    h.ledger!.runningGames.add(gid(1));
    h.clock.set('2026-11-01T00:16:00.000Z');
    await h.svc.sweep();
    expect((await h.store.seasonRow('1v1-standard', '2026-10'))?.status ?? 'open').toBe('open');
    expect(await h.store.seasonRow('1v1-pioneer', '2026-10')).toMatchObject({ status: 'closed' });
    const rec = ended(r, { endedAt: '2026-11-01T00:20:00.000Z' });
    h.ledger!.commit(rec);
    h.clock.set('2026-11-01T00:21:00.000Z');
    expect(await h.svc.sweep()).toMatchObject({ applied: 1, seasonsClosed: ['2026-10'] });
    expect((await h.store.seasonRecord(A, '1v1-standard', '2026-11'))?.games).toBe(1);
  });

  it('final standings use the deviation at the season\'s end, so the result does not depend on when the sweep ran', async () => {
    const finals: unknown[] = [];
    for (const closeAt of ['2026-11-01T00:15:00.000Z', '2026-11-04T09:00:00.000Z']) {
      const h = await harness({ accounts: PLAYERS, ledger: null });
      await games(h, A, acc(9), 12, 1, (i) => i % 3 !== 2);
      const rec = (await h.store.seasonRecord(A, '1v1-standard', '2026-10'))!;
      h.clock.set(closeAt);
      expect((await h.svc.sweep()).seasonsClosed).toContain('2026-10');
      const closed = (await h.store.seasonRecord(A, '1v1-standard', '2026-10'))!;
      const days = (Date.parse('2026-11-01T00:00:00.000Z') - Date.parse(rec.lastGameAt)) / DAY;
      expect(closed.finalStanding).toBe(standingOf(rec.display!, glicko2RdAt(rec.deviation!, days)));
      expect(closed.finalRank).toBe(1);
      expect([closed.display, closed.standing]).toEqual([rec.display, rec.standing]);
      finals.push({ finalStanding: closed.finalStanding, finalRank: closed.finalRank, badge: closed.badge });
    }
    expect(finals[1]).toEqual(finals[0]);
  });

  it('only eligible records rank: placement done, 10 season games, listed (read fresh at the close), not provisional at the end', async () => {
    const h = await harness({ accounts: PLAYERS, ledger: null });
    // alternating results against an established opponent: settled ratings (an unbroken streak would leave the deviation high, 4.4)
    for (const [n, a, opp] of [[9, A, acc(10)], [12, B, acc(11)], [12, acc(3), acc(12)]] as const) {
      await games(h, a, opp, n, 100 * Number(a.slice(-2)), (i) => i % 2 === 0);
    }
    h.dir.get(acc(3)).listed = false; // unlisted by a sanction since its last game: off the final board, read fresh at the close
    h.clock.set('2026-11-01T00:15:00.000Z');
    await h.svc.sweep();
    const recs = await Promise.all([A, B, acc(3)].map((a) => h.store.seasonRecord(a, '1v1-standard', '2026-10')));
    expect(recs.map((r) => r!.finalRank)).toEqual([null, 1, null]);
    expect(recs.map((r) => r!.listed)).toEqual([true, true, false]);
    expect(await h.store.seasonRow('1v1-standard', '2026-10')).toMatchObject({ eligible: 1 });
    const board = await h.svc.leaderboard({ ladder: '1v1-standard', season: '2026-10' }, null);
    expect(board).toMatchObject({ closed: true, total: 1 });
    expect(board.entries.map((e) => [e.rank, e.account])).toEqual([[1, B]]);
  });

  it('badges: the tier of the median of the season\'s post-placement ratings, fresh, with 5 such games and 55 career games', async () => {
    const h = await harness({ accounts: PLAYERS, ledger: null });
    const cases = [
      { a: acc(1), career: 50, n: 6 }, // 56 career, 6 post-placement games: a badge
      { a: acc(2), career: 45, n: 6 }, // 51 career: none
      { a: acc(3), career: 60, n: 4 }, // 4 games: none
    ];
    for (const c of cases) {
      await establish(h, c.a, { model: 'glicko2', r: 1690, rd: 60, vol: 0.06 }, { games: c.career });
      await games(h, c.a, acc(Number(c.a.slice(-1)) + 5), c.n, 1000 * Number(c.a.slice(-1)), (i) => i % 2 === 0);
    }
    h.clock.set('2026-11-01T00:15:00.000Z');
    await h.svc.sweep();
    const recs = await Promise.all(cases.map((c) => h.store.seasonRecord(c.a, '1v1-standard', '2026-10')));
    expect(recs.map((r) => r!.seasonRatings.length)).toEqual([6, 6, 4]);
    expect(recs[0]!.badge).toBe(badgeTier(recs[0]!.seasonRatings, recs[0]!.careerGames, DEFAULT_TIER_FLOORS));
    const sorted = [...recs[0]!.seasonRatings].sort((x, y) => x - y);
    expect(recs[0]!.badge).toBe(tierOf((sorted[2]! + sorted[3]!) / 2));
    expect([recs[1]!.badge, recs[2]!.badge]).toEqual([null, null]);
    // the profile lists it, with its final rank (none here: 6 season games are not enough for the board)
    expect((await h.svc.profile(acc(1), null))!.badges).toEqual([{ ladder: '1v1-standard', season: '2026-10', tier: recs[0]!.badge, rank: null }]);
  });

  it('a season\'s floors are recorded when it starts and change only at the next', async () => {
    const store: LadderStore = createMemoryLadderStore();
    const h = await harness({ accounts: PLAYERS, store, ledger: null });
    await h.svc.sweep();
    expect((await store.seasonRow('1v1-standard', '2026-10'))?.floors).toEqual([...DEFAULT_TIER_FLOORS]);
    const floors = [1200, 1400, 1500, 1600, 1700];
    const h2 = await harness({ accounts: PLAYERS, store, ledger: null, config: { tierFloors: { '1v1-standard': floors } }, start: '2026-10-20T12:00:00.000Z' });
    await h2.svc.sweep();
    expect((await store.seasonRow('1v1-standard', '2026-10'))?.floors).toEqual([...DEFAULT_TIER_FLOORS]);
    h2.clock.set('2026-11-01T00:15:00.000Z');
    await h2.svc.sweep();
    expect((await store.seasonRow('1v1-standard', '2026-11'))?.floors).toEqual(floors);
  });
});
