/**
 * M15-3: the ladder as milestone 14's AccountDataHolder (design 8.7, D13, 17.6): exportAccount holds only the account's own data; forgetAccount
 * anonymises history, registry, cap and audit rows, keeps closed-season rows under a random marker with only a closed leaderboard's fields, leaves
 * no two rows of the account that can be chained, changes nobody else's rating, and run twice finds nothing more. Also resetRating (11.3).
 */
import { describe, expect, it } from 'vitest';
import { DELETED_PLAYER_NAME, initialState } from '../../src/api';
import { isDeletedSortKey } from '../../src/ids';
import type { HistoryRow, SeasonRecord } from '../../src/store/api';
import { acc, ended, establish, gid, harness, HOUR, MINUTE, memoryOf, text, type Harness } from './fixtures';
import { placesInDump } from './support';

const [A, B, C, D] = [acc(1), acc(2), acc(3), acc(4)];

/** A's life: 12 October games against B (closed season, on the final board), November games, a pioneer game, a cap event, a miss, a report. */
async function life(): Promise<Harness> {
  const h = await harness({ accounts: [1, 2, 3, 4], ledger: null });
  await establish(h, B, { model: 'glicko2', r: 1500, rd: 60, vol: 0.06 }, { games: 40 });
  for (let i = 0; i < 12; i++) {
    await h.play({ game: gid(i + 1), accounts: [A, B], places: i % 3 === 1 ? [2, 1] : [1, 2] });
    h.clock.advance(40 * MINUTE);
  }
  h.clock.set('2026-11-01T00:15:00.000Z');
  await h.svc.sweep();
  h.clock.set('2026-11-03T12:00:00.000Z');
  for (let i = 0; i < 3; i++) {
    await h.play({ game: gid(100 + i), accounts: [A, B] });
    h.clock.advance(40 * MINUTE);
  }
  const r = ended(await h.start({ game: gid(200), ladder: '1v1-pioneer', accounts: [C, A] }), { places: [1, 2] });
  await h.svc.intake({ ...r, cap: { kind: 'actions', verdict: { kind: 'driver', seat: 2, share: 0.8 }, seats: [{ seat: 1, initiated: 100, chargedMs: 1 }, { seat: 2, initiated: 400, chargedMs: 1 }] } });
  h.clock.advance(HOUR);
  await h.svc.resetRating(A, '1v1-pioneer', 'moderator-7', 'win-trading with a second account');
  await h.svc.readyCheckMissed('m1', [A]);
  h.abuse.next.afterGame.push({ kind: 'repeatedPairing', ladder: '1v1-standard', accounts: [B, A], evidence: { games: [gid(100)], stats: { games: 5 } } });
  await h.play({ game: gid(103), accounts: [A, B] });
  return h;
}

describe('M15-3: exportAccount (8.7)', () => {
  it('holds only the account\'s own data: its rows, records, its own seat of each game, its penalties; JSON-safe', async () => {
    const h = await life();
    const x = await h.svc.exportAccount(A);
    expect(x.ratings.map((r) => [r.account, r.ladder])).toEqual([[A, '1v1-standard'], [A, '1v1-pioneer']]);
    // newest season first, then by ladder
    expect(x.seasons.map((s) => [s.account, s.ladder, s.season])).toEqual([[A, '1v1-pioneer', '2026-11'], [A, '1v1-standard', '2026-11'], [A, '1v1-standard', '2026-10']]);
    expect(x.games).toHaveLength(17);
    expect(x.games.every((g) => g.seat.account === A)).toBe(true);
    expect(x.games[0]).toMatchObject({ game: gid(103), ladder: '1v1-standard', season: '2026-11', outcome: 'win' });
    expect(x.penalties?.misses).toHaveLength(1);
    expect(text(x)).not.toContain(B);
    expect(text(x)).not.toContain(C);
    expect(JSON.parse(text(x))).toEqual(x);
  });
});

describe('M15-3: forgetAccount (8.7)', () => {
  it('leaves no trace of the id, keeps opponents\' ratings and the closed board, and chains nothing; run twice it finds nothing more', async () => {
    const h = await life();
    const running = await h.start({ game: gid(300), accounts: [A, D] });
    const before = memoryOf(h).dump();
    const opponents = [...(await h.store.ratings('1v1-standard', [B, D]))];
    const boardBefore = await h.svc.leaderboard({ ladder: '1v1-standard', season: '2026-10' }, null);
    expect(placesInDump(before, A).length).toBeGreaterThan(0);

    // as milestone 14 runs it: the account is 'deleting' (its grace), then every holder erases it
    h.dir.get(A).status = 'deleting';
    await h.svc.standingChanged([A]);
    const report = await h.svc.forgetAccount(A);
    expect(report).toEqual({ ratings: 2, seasonRecords: 3, historySeats: 17, reports: 1, starts: 18, penalties: 1, capSeats: 1, adjustments: 1 });
    const dump = memoryOf(h).dump();
    expect(placesInDump(dump, A)).toEqual([]);
    expect([...(await h.store.ratings('1v1-standard', [B, D]))]).toEqual(opponents);

    // the closed board: the same ranks, A's row "Deleted player" under a random marker with only a closed board's fields
    const board = await h.svc.leaderboard({ ladder: '1v1-standard', season: '2026-10' }, null);
    expect(board.entries.map((e) => [e.rank, e.display, e.tier, e.games])).toEqual(boardBefore.entries.map((e) => [e.rank, e.display, e.tier, e.games]));
    expect(board.entries.map((e) => e.deleted)).toEqual(boardBefore.entries.map((e) => e.account === A));
    expect(board.entries.filter((e) => e.deleted)).toHaveLength(1);
    const kept = dump['records']!.map(([, r]) => r as SeasonRecord).filter((r) => r.account === null);
    expect(kept).toHaveLength(1);
    const k = kept[0]!;
    expect(isDeletedSortKey(k.sortKey)).toBe(true);
    expect([k.seasonRatings, k.badge, k.peak, k.peakTier, k.places, k.provisionalFrom]).toEqual([[], null, null, null, null, null]);
    expect([k.careerGames, k.lastGameAt]).toEqual([k.games, '2026-11-01T00:00:00.000Z']);

    // history seats: no account, "Deleted player", no rating values, so one game's after cannot be matched to the next game's before
    const seats = dump['history']!.flatMap(([, r]) => (r as HistoryRow).seats).filter((s) => s.account === null);
    expect(seats).toHaveLength(17);
    for (const s of seats) {
      expect([s.name, s.before, s.after, s.awayMs, s.displayBefore, s.displayAfter, s.tierAfter]).toEqual([DELETED_PLAYER_NAME, null, null, 0, null, null, null]);
    }
    // closed starts: the snapshot and the career count cleared; the running one keeps its snapshot until it is rated
    const starts = (dump['starts']!.map(([, s]) => s) as { game: string; status: string; seats: { account: string | null; row: unknown; games: number }[] }[]);
    for (const s of starts.filter((x) => x.status !== 'running')) {
      for (const seat of s.seats.filter((x) => x.account === null)) expect([seat.row, seat.games]).toEqual([null, 0]);
    }
    const run = starts.find((s) => s.game === gid(300))!;
    expect([run.seats[0]!.account, run.seats[0]!.row !== null]).toEqual([null, true]);
    // the audit keeps who acted, why and when; the report keeps its other account
    const audit = dump['adjustments']!.map(([, a]) => a as { account: unknown; before: unknown; after: unknown; by: string; reason: string });
    expect(audit.filter((a) => a.by === 'moderator-7').map((a) => [a.account, a.before, a.after, a.reason])).toEqual([[null, null, null, 'win-trading with a second account']]);
    expect((await h.store.pendingReports(5))[0]!.accounts).toEqual([B, null]);
    expect(h.svc.accountBusy(A)).toBe(false);
    expect(h.svc.cooldownUntil(A)).toBeNull();
    expect(await h.svc.profile(A, null)).toBeNull();

    // the running game ends: D is rated, nothing of A is stored, the snapshot goes in the same write
    h.clock.advance(20 * MINUTE);
    expect((await h.svc.intake(ended(running, { endedAt: h.clock.iso() }))).kind).toBe('applied');
    expect((await h.store.start(gid(300)))!.seats[0]).toEqual({ seat: 1, account: null, row: null, games: 0 });
    expect(placesInDump(memoryOf(h).dump(), A)).toEqual([]);

    expect(await h.svc.forgetAccount(A)).toEqual({ ratings: 0, seasonRecords: 0, historySeats: 0, reports: 0, starts: 0, penalties: 0, capSeats: 0, adjustments: 0 });
  });

  it('two closed seasons\' rows get markers with no shared part: nothing groups the rows of one erasure', async () => {
    const h = await harness({ accounts: [1, 2], ledger: null });
    await establish(h, B, { model: 'glicko2', r: 1500, rd: 60, vol: 0.06 }, { games: 40 });
    let n = 0;
    for (const month of ['2026-10', '2026-11']) {
      h.clock.set(`${month}-15T12:00:00.000Z`);
      for (let i = 0; i < 12; i++) {
        await h.play({ game: gid(++n), accounts: [A, B], places: i % 3 === 1 ? [2, 1] : [1, 2] });
        h.clock.advance(40 * MINUTE);
      }
    }
    h.clock.set('2026-12-01T00:15:00.000Z');
    await h.svc.sweep();
    await h.svc.forgetAccount(A);
    const markers = memoryOf(h).dump()['records']!.map(([, r]) => r as SeasonRecord).filter((r) => r.account === null).map((r) => r.sortKey);
    expect(markers).toHaveLength(2);
    // ULIDs made in one millisecond share their first 10 characters; these markers are 128 random bits each
    expect(markers[0]!.slice(8, 18)).not.toBe(markers[1]!.slice(8, 18));
  });
});

describe('M15-3: resetRating (11.3)', () => {
  it('back to the initial state with placement again, audited; the season record keeps its games, loses its rating until placement is done', async () => {
    const h = await harness({ accounts: [1, 2], ledger: null });
    await establish(h, B, { model: 'glicko2', r: 1500, rd: 60, vol: 0.06 }, { games: 40 });
    for (let i = 0; i < 12; i++) {
      await h.play({ game: gid(i + 1), accounts: [A, B], places: [1, 2] });
      h.clock.advance(40 * MINUTE);
    }
    const bRow = (await h.store.ratings('1v1-standard', [B])).get(B)!;
    await h.svc.resetRating(A, '1v1-standard', 'moderator-7', 'smurf');
    const row = (await h.store.ratings('1v1-standard', [A])).get(A)!;
    expect([row.state, row.games, row.tier, row.lastRatedAt]).toEqual([initialState('glicko2'), 0, null, null]);
    const rec = (await h.store.seasonRecord(A, '1v1-standard', '2026-10'))!;
    expect([rec.games, rec.display, rec.standing, rec.tier]).toEqual([12, null, null, null]);
    expect((await h.svc.profile(A, null))!.ratings[0]).toMatchObject({ display: null, placementLeft: 10 });
    expect((await h.store.ratings('1v1-standard', [B])).get(B)).toEqual(bRow); // nothing recomputed
    const audit = memoryOf(h).dump()['adjustments']!.map(([, a]) => a as { by: string; reason: string; before: { games: number }; after: { games: number } });
    expect(audit.map((a) => [a.by, a.reason, a.before?.games, a.after.games])).toEqual([['moderator-7', 'smurf', 12, 0]]);
    await expect(h.svc.resetRating(A, '1v1-standard', '', 'x')).rejects.toThrow(RangeError);
    await expect(h.svc.resetRating(A, 'chess' as never, 'm', 'x')).rejects.toThrow(RangeError);
  });

  it('refuses an account with no rating in the ladder, and writes nothing: after an erasure it never writes the id back (review of M15-3)', async () => {
    const h = await harness({ accounts: [1, 2, 3], ledger: null });
    await h.play({ game: gid(1), accounts: [A, B] });
    await h.svc.forgetAccount(A);
    expect(placesInDump(memoryOf(h).dump(), A)).toEqual([]);
    // a moderator's reset queued just behind the erasure (or given an id from an older report)
    await expect(h.svc.resetRating(A, '1v1-standard', 'mod-1', 'smurfing')).rejects.toThrow(/no rating in 1v1-standard/);
    expect(placesInDump(memoryOf(h).dump(), A)).toEqual([]);
    // an account that never played the ladder: nothing to reset, no audit row
    await expect(h.svc.resetRating(C, '1v1-standard', 'mod-1', 'typo')).rejects.toThrow(RangeError);
    await expect(h.svc.resetRating(B, '1v1-pioneer', 'mod-1', 'wrong ladder')).rejects.toThrow(RangeError);
    expect(memoryOf(h).dump()['adjustments']).toEqual([]);
    expect(placesInDump(memoryOf(h).dump(), C)).toEqual([]);
  });
});
