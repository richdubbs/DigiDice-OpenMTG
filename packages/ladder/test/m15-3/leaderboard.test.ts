/**
 * M15-3: leaderboards (design 10.1, D16, 17.6): the standing order with shared ranks, ranks and totals without gaps as accounts become unlisted
 * (the listed mirror through standingChanged and the refresh at read), a parked account leaving the live board at provisionalFrom, keyset pages,
 * closed boards with deleted rows, "Hidden player" rows, and the sealed cursors.
 */
import { describe, expect, it } from 'vitest';
import { LADDER_LIMITS } from '../../src/api';
import { LadderCursorError, parseCursor } from '../../src/service/create';
import { cursorKeys, leaderboardCursor, openCursor } from '../../src/service/cursor';
import { acc, establish, gid, harness, MINUTE, round, TEST_SECRET, text, type Harness } from './fixtures';

// the opponents (acc(11)-acc(15)) are not in the directory: no standing, so never listed, never on a board
const PLAYERS = [1, 2, 3, 4, 5];
const [A, B, C, D, E] = [acc(1), acc(2), acc(3), acc(4), acc(5)];
const opp = (a: string) => acc(Number(a.slice(-2)) + 10);

/**
 * Each account plays 12 games against its own established opponent, side by side (the same times), winning the games `wins` gives it: equal
 * patterns give equal ratings and so equal standings.
 */
async function board(h: Harness, wins: Record<string, (i: number) => boolean>, first = 1): Promise<void> {
  for (const a of Object.keys(wins)) await establish(h, opp(a) as never, { model: 'glicko2', r: 1500, rd: 60, vol: 0.06 });
  for (let i = 0; i < 12; i++) {
    await round(h, Object.entries(wins).map(([a, w], k) => ({ game: gid(first + 100 * i + k), accounts: [a as never, opp(a) as never], places: w(i) ? [1, 2] : [2, 1] })));
    h.clock.advance(40 * MINUTE);
  }
}

const alternate = (i: number) => i % 2 === 0;
const better = (i: number) => i % 3 !== 2;
const worse = (i: number) => i % 3 === 0;

describe('M15-3: the live leaderboard (10.1)', () => {
  it('orders by standing, games and sortKey; equal standings share a rank (1, 1, 3); guests may read it', async () => {
    const h = await harness({ accounts: PLAYERS });
    await board(h, { [A]: better, [B]: better, [C]: alternate });
    const page = await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null);
    expect(page).toMatchObject({ ladder: '1v1-standard', season: '2026-10', closed: false, total: 3, next: null });
    expect(page.entries.map((e) => [e.rank, e.account, e.name, e.games, e.you, e.deleted])).toEqual([
      [1, A, 'Player 1', 12, false, false], [1, B, 'Player 2', 12, false, false], [3, C, 'Player 3', 12, false, false],
    ]);
    const recs = await Promise.all([A, B, C].map((a) => h.store.seasonRecord(a, '1v1-standard', '2026-10')));
    expect(page.entries.map((e) => e.display)).toEqual(recs.map((r) => r!.display));
    expect(page.entries.map((e) => e.tier)).toEqual(recs.map((r) => r!.tier));
    expect(recs[0]!.standing).toBe(recs[1]!.standing);
    // the viewer's own row is marked
    expect((await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, B)).entries.map((e) => e.you)).toEqual([false, true, false]);
  });

  it('ranks and totals have no gaps when accounts become unlisted: through standingChanged, and refreshed at read', async () => {
    const h = await harness({ accounts: PLAYERS });
    await board(h, { [A]: better, [B]: better, [C]: alternate, [D]: worse });
    h.dir.get(A).listed = false; // an unlist sanction, passed on by the change feed
    await h.svc.standingChanged([A]);
    let page = await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null);
    expect(page.entries.map((e) => [e.rank, e.account])).toEqual([[1, B], [2, C], [3, D]]);
    expect(page.total).toBe(3);
    // suspended without the feed: the read sees the fresh standing, writes the mirror and reads the page again
    h.dir.get(B).status = 'suspended';
    page = await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null);
    expect(page.entries.map((e) => [e.rank, e.account])).toEqual([[1, C], [2, D]]);
    expect(page.total).toBe(2);
    expect((await h.store.seasonRecord(B, '1v1-standard', '2026-10'))?.listed).toBe(false);
    // listed again: back at its rank
    h.dir.get(A).listed = true;
    await h.svc.standingChanged([A]);
    expect((await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null)).entries.map((e) => [e.rank, e.account])).toEqual([[1, A], [2, C], [3, D]]);
  });

  it('a parked account leaves the live board at its provisionalFrom', async () => {
    const h = await harness({ accounts: PLAYERS });
    await board(h, { [A]: alternate, [B]: alternate });
    const pf = (await h.store.seasonRecord(A, '1v1-standard', '2026-10'))!.provisionalFrom!;
    h.clock.set(Date.parse(pf) - 1);
    const read = () => h.svc.leaderboard({ ladder: '1v1-standard', season: '2026-10' }, null);
    expect((await read()).total).toBe(2);
    h.clock.set(pf);
    expect((await read()).total).toBe(0); // both parked the same way, the same moment
    expect((await h.svc.profile(A, A))!.ratings[0]!.provisional).toBe(true);
  });

  it('keyset pages: rows whose key did not change between requests are neither skipped nor repeated', async () => {
    const h = await harness({ accounts: PLAYERS });
    await board(h, { [A]: (i) => i % 4 !== 3, [B]: better, [C]: alternate, [D]: worse, [E]: (i) => i % 4 === 0 });
    const q = { ladder: '1v1-standard' as const, season: 'current' as const, limit: 2 };
    const p1 = await h.svc.leaderboard(q, null);
    expect(p1.entries.map((e) => e.account)).toEqual([A, B]);
    expect(p1.next).not.toBeNull();
    // between two requests A loses three games and falls: the rows that did not move still come once each
    for (let i = 0; i < 3; i++) {
      await round(h, [{ game: gid(9000 + i), accounts: [A, opp(A) as never], places: [2, 1] }]);
      h.clock.advance(MINUTE);
    }
    const p2 = await h.svc.leaderboard({ ...q, cursor: p1.next! }, null);
    const p3 = await h.svc.leaderboard({ ...q, cursor: p2.next! }, null);
    const seen = [...p1.entries, ...p2.entries, ...p3.entries].map((e) => e.account).filter((a) => a !== A);
    expect(seen).toEqual([B, C, D, E]);
    expect(p3.next).toBeNull();
  });

  it('accounts that chose not to be listed are "Hidden player": rank, rating and tier, no name, no id, no games; themselves they see in full', async () => {
    const h = await harness({ accounts: PLAYERS });
    await board(h, { [A]: better, [B]: alternate, [C]: worse });
    h.dir.get(B).privacy.leaderboards = false;
    const page = await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null);
    const hidden = page.entries[1]!;
    expect(hidden).toEqual({ rank: 2, display: hidden.display, tier: hidden.tier, games: null, account: null, name: null, deleted: false, you: false });
    expect(text(page)).not.toContain(B);
    expect((await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, B)).entries[1]).toMatchObject({ account: B, name: 'Player 2', games: 12, you: true });
    // a page that ends on the Hidden row: its cursor holds neither the id nor the games count in any readable form
    const p1 = await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current', limit: 2 }, null);
    const raw = Buffer.from(p1.next!.slice(1), 'base64url');
    expect(p1.next).not.toContain(B);
    expect(raw.includes(Buffer.from(B))).toBe(false);
    expect(raw.includes(Buffer.from(B.slice(4)))).toBe(false);
    expect((await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current', cursor: p1.next!, limit: 2 }, null)).entries.map((e) => e.account)).toEqual([C]);
  });
});

describe('M15-3: closed leaderboards (7, 8.7, 10.1)', () => {
  it('a closed season is ordered by the final standing and shows the stored final rank; a deleted row is "Deleted player" with a working cursor', async () => {
    const h = await harness({ accounts: PLAYERS, ledger: null });
    await board(h, { [A]: better, [B]: alternate, [C]: worse });
    h.clock.set('2026-11-01T00:15:00.000Z');
    await h.svc.sweep();
    await h.svc.forgetAccount(B);
    const all = await h.svc.leaderboard({ ladder: '1v1-standard', season: '2026-10' }, null);
    expect(all).toMatchObject({ closed: true, total: 3 });
    expect(all.entries.map((e) => [e.rank, e.account, e.deleted, e.name])).toEqual([[1, A, false, 'Player 1'], [2, null, true, null], [3, C, false, 'Player 3']]);
    const pages = [];
    let cursor: string | undefined;
    for (;;) {
      const p = await h.svc.leaderboard({ ladder: '1v1-standard', season: '2026-10', limit: 1, cursor }, null);
      pages.push(...p.entries.map((e) => [e.rank, e.deleted]));
      if (p.next === null) break;
      cursor = p.next;
    }
    expect(pages).toEqual([[1, false], [2, true], [3, false]]);
    // an account without a current name later (suspended) shows as "Hidden player" on the closed board
    h.dir.get(C).status = 'suspended';
    expect((await h.svc.leaderboard({ ladder: '1v1-standard', season: '2026-10' }, null)).entries[2]).toMatchObject({ rank: 3, account: null, name: null, games: null, deleted: false });
    // the current season's board is empty: nobody has played in November
    expect((await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null))).toMatchObject({ season: '2026-11', closed: false, total: 0, entries: [] });
  });
});

describe('M15-3: the read cursors (10.1, 13.4 "Errors")', () => {
  it('are sealed: the shape check passes them, a changed one is refused, another server\'s is refused, another kind is refused', async () => {
    const h = await harness({ accounts: PLAYERS });
    await board(h, { [A]: better, [B]: alternate, [C]: worse });
    const p1 = await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current', limit: 1 }, null);
    const next = p1.next!;
    expect(next.length).toBeLessThanOrEqual(LADDER_LIMITS.cursorMax);
    expect(parseCursor(next)).toBe('leaderboard');
    expect(parseCursor(next, 'history')).toBeNull();
    const q = { ladder: '1v1-standard' as const, season: 'current' as const, limit: 1 };
    const flipped = next.slice(0, -2) + (next.at(-2) === 'A' ? 'B' : 'A') + next.at(-1);
    for (const bad of [flipped, 'l' + 'A'.repeat(60), next + 'x', 'h' + next.slice(1), '', 'x'.repeat(201)]) {
      await expect(h.svc.leaderboard({ ...q, cursor: bad }, null)).rejects.toThrow(RangeError);
    }
    await expect(h.svc.leaderboard({ ...q, cursor: flipped }, null)).rejects.toBeInstanceOf(LadderCursorError);
    const other = cursorKeys(Buffer.alloc(32, 9).toString('base64url'));
    const foreign = leaderboardCursor(other, { key: 1500, games: 12, sortKey: B });
    expect(parseCursor(foreign)).toBe('leaderboard');
    await expect(h.svc.leaderboard({ ...q, cursor: foreign }, null)).rejects.toThrow(LadderCursorError);
    // the same position always seals to the same text; it opens to exactly that position
    const keys = cursorKeys(TEST_SECRET);
    expect(openCursor(keys, next)).toMatchObject({ kind: 'leaderboard', sortKey: A });
    expect(leaderboardCursor(keys, { key: 1, games: 2, sortKey: A })).toBe(leaderboardCursor(keys, { key: 1, games: 2, sortKey: A }));
  });

  it('bad queries are refused with a RangeError (hosted checks them first)', async () => {
    const h = await harness({ accounts: PLAYERS });
    await expect(h.svc.leaderboard({ ladder: 'chess' as never, season: 'current' }, null)).rejects.toThrow(RangeError);
    await expect(h.svc.leaderboard({ ladder: '1v1-standard', season: '2026-13' }, null)).rejects.toThrow(RangeError);
    await expect(h.svc.leaderboard({ ladder: '1v1-standard', season: 'current', limit: 101 }, null)).rejects.toThrow(RangeError);
    await expect(h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, 'nobody' as never)).rejects.toThrow(RangeError);
  });
});
