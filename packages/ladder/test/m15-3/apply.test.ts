/**
 * M15-3: computeApplication (design 8.3 "Computation is pure", 4.3, 6.2, 6.3, 7, 8.5, 8.7, 13.3): what one rated game writes. Pure: the same
 * inputs give the same result. Vectors from M15-2's G10b (4.5).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIER_FLOORS, DELETED_PLAYER_NAME, displayRating, initialState, ratePod, ratingNow, seasonReset, type Glicko2State, type RatingRowLike,
  type WengLinState,
} from '../../src/api';
import { computeApplication, type ApplicationRows } from '../../src/intake/apply';
import type { RankedStart, RatedGame } from '../../src/ledger';
import type { RatingRow, SeasonRecord } from '../../src/store/api';
import { acc, DAY, gid } from './fixtures';

const A = acc(1);
const B = acc(2);
const G = (r: number, rd: number, vol = 0.06): Glicko2State => ({ model: 'glicko2', r, rd, vol });
const before = (iso: string, days: number) => new Date(Date.parse(iso) - days * DAY).toISOString();
const near = (x: number, y: number, eps = 0.0001) => expect(Math.abs(x - y), `${x} vs ${y}`).toBeLessThanOrEqual(eps);

function startOf(game: string, seats: { account: string | null; row: RatingRowLike; games: number }[], ladder: RankedStart['ladder'] = '1v1-standard'): RankedStart {
  return {
    game, match: `m${game}`, ladder, startedAt: '2026-10-31T23:40:00.000Z',
    seats: seats.map((s, i) => ({ seat: (i + 1) as 1 | 2 | 3 | 4, account: s.account as never, row: s.row, games: s.games })),
    status: 'running', closedAt: null,
  };
}

function gameOf(start: RankedStart, places: (1 | 2 | 3 | 4)[], endedAt: string): RatedGame {
  return {
    game: start.game, ladder: start.ladder, season: endedAt.slice(0, 7), endedAt, outcome: places.filter((p) => p === 1).length > 1 ? 'draw' : 'win', turns: 9,
    seats: start.seats.map((s, i) => ({ seat: s.seat, account: s.account, name: `Name ${i + 1}`, place: places[i]!, loss: places[i] === 1 ? null : 'life', lossRule: null, outTurn: null })),
    cap: null,
  };
}

const rowOf = (account: string, like: RatingRowLike, games: number, o: Partial<RatingRow> = {}): RatingRow => ({
  account: account as never, ladder: '1v1-standard', ...like, games, tier: 'laser', version: 4, ...o,
});
const rows = (ratings: RatingRow[], seasons: SeasonRecord[] = [], listed: [string, boolean][] = []): ApplicationRows => ({
  ratings: new Map(ratings.map((r) => [r.account, r])), seasons: new Map(seasons.map((s) => [s.account!, s])),
  listed: new Map(listed.map(([a, l]) => [a as never, l])),
});
const config = { floors: DEFAULT_TIER_FLOORS, appliedAt: '2026-11-01T00:21:00.000Z' };

describe('M15-3: computeApplication', () => {
  // G10b: a game across midnight, A loses
  const endedAt = '2026-11-01T00:20:00.000Z';
  const rowA: RatingRowLike = { state: G(1700, 70), season: '2026-09', lastRatedAt: before(endedAt, 40) };
  const rowB: RatingRowLike = { state: G(1600, 80), season: '2026-10', lastRatedAt: before(endedAt, 1) };

  it('G10b: both reset once by the game\'s season, time away from each row\'s last game, the game\'s season everywhere', () => {
    const start = startOf(gid(1), [{ account: A, row: rowA, games: 40 }, { account: B, row: rowB, games: 40 }]);
    const app = computeApplication(gameOf(start, [2, 1], endedAt), start, rows([rowOf(A, rowA, 40), rowOf(B, rowB, 40)], [], [[A, true], [B, true]]), config);
    const [a, b] = app.applied.seats;
    expect(a!.before).toEqual(ratingNow(rowA, endedAt).state);
    near((a!.before as Glicko2State).r, 1690);
    near((b!.before as Glicko2State).rd, 100);
    expect([a!.awayMs, b!.awayMs]).toEqual([40 * DAY, DAY]);
    near((a!.after as Glicko2State).r, 1649.1505);
    near((a!.after as Glicko2State).rd, 108.9629);
    near((b!.after as Glicko2State).r, 1627.3667);
    near((b!.after as Glicko2State).rd, 97.7094);
    expect([a!.displayBefore, b!.displayBefore, b!.displayAfter]).toEqual([1690, 1595, 1627]);
    expect(app.applied.ratings.map((r) => [r.row.season, r.row.lastRatedAt, r.row.games, r.row.version, r.expectVersion])).toEqual([
      ['2026-11', endedAt, 41, 5, 4], ['2026-11', endedAt, 41, 5, 4],
    ]);
    // the tier is fresh after the reset (6.3): not the stored Laser held by the buffer
    expect([a!.tierAfter, b!.tierAfter]).toEqual(['arc', 'arc']);
    expect(app.applied.seasonRecords.map((r) => [r.account, r.season, r.games, r.wins, r.losses, r.listed, r.display, r.careerGames])).toEqual([
      [A, '2026-11', 1, 0, 1, true, 1649, 41], [B, '2026-11', 1, 1, 0, true, 1627, 41],
    ]);
    expect(app.notices.map((n) => [n.seat, n.before, n.after, n.tierBefore, n.tierAfter, n.placementLeft])).toEqual([[1, 1690, 1649, 'laser', 'arc', 0], [2, 1595, 1627, 'arc', 'arc', 0]]);
  });

  it('G10b with A deleted while it ran: B rated identically from A\'s start snapshot; nothing of A is written', () => {
    const live = startOf(gid(1), [{ account: A, row: rowA, games: 40 }, { account: B, row: rowB, games: 40 }]);
    const liveApp = computeApplication(gameOf(live, [2, 1], endedAt), live, rows([rowOf(A, rowA, 40), rowOf(B, rowB, 40)]), config);
    const start = startOf(gid(1), [{ account: null, row: rowA, games: 40 }, { account: B, row: rowB, games: 40 }]);
    const app = computeApplication(gameOf(start, [2, 1], endedAt), start, rows([rowOf(B, rowB, 40)]), config);
    expect(app.applied.seats[1]!.after).toEqual(liveApp.applied.seats[1]!.after);
    expect(app.applied.seats[0]).toEqual({
      seat: 1, account: null, name: DELETED_PLAYER_NAME, place: 2, loss: 'life', lossRule: null, outTurn: null,
      before: null, awayMs: 0, after: null, displayBefore: null, displayAfter: null, tierAfter: null,
    });
    expect(app.applied.ratings.map((r) => r.row.account)).toEqual([B]);
    expect(app.applied.seasonRecords.map((r) => r.account)).toEqual([B]);
    expect(app.notices.map((n) => n.seat)).toEqual([2]);
  });

  it('is pure: the same inputs give equal results, and the inputs are not changed', () => {
    const start = startOf(gid(1), [{ account: A, row: rowA, games: 40 }, { account: B, row: rowB, games: 40 }]);
    const r = rows([rowOf(A, rowA, 40), rowOf(B, rowB, 40)]);
    const snapshot = structuredClone({ start, ratings: [...r.ratings] });
    const x = computeApplication(gameOf(start, [2, 1], endedAt), start, r, config);
    const y = computeApplication(gameOf(start, [2, 1], endedAt), start, r, config);
    expect(x).toEqual(y);
    expect({ start, ratings: [...r.ratings] }).toEqual(snapshot);
  });

  it('placement: the first 10 games hide the rating; the 10th shows it after; the badge ratings count from the 11th game', () => {
    const t0 = '2026-10-15T12:00:00.000Z';
    let row: RatingRow | null = null;
    let rec: SeasonRecord | undefined;
    for (let g = 1; g <= 12; g++) {
      const endedAt2 = new Date(Date.parse(t0) + g * 3_600_000).toISOString();
      const mine: RatingRowLike = row ?? { state: initialState('glicko2'), season: '2026-10', lastRatedAt: null };
      const opp: RatingRowLike = { state: G(1500, 60), season: '2026-10', lastRatedAt: t0 };
      const start = startOf(gid(g), [{ account: A, row: mine, games: row?.games ?? 0 }, { account: B, row: opp, games: 50 }]);
      const app = computeApplication(gameOf(start, [1, 2], endedAt2), start, rows(row ? [row, rowOf(B, opp, 50)] : [rowOf(B, opp, 50)], rec ? [rec] : []), config);
      const seat = app.applied.seats[0]!;
      const notice = app.notices[0]!;
      row = app.applied.ratings[0]!.row;
      rec = app.applied.seasonRecords[0]!;
      expect(notice.placementLeft).toBe(Math.max(0, 10 - g));
      if (g < 10) {
        expect([seat.displayBefore, seat.displayAfter, seat.tierAfter, rec.display, rec.standing, rec.tier, notice.after]).toEqual([null, null, null, null, null, null, null]);
      } else if (g === 10) {
        expect(seat.displayBefore).toBeNull();
        expect(seat.displayAfter).toBe(displayRating(row.state));
        expect(rec.display).toBe(seat.displayAfter);
        expect(rec.seasonRatings).toEqual([]);
      } else {
        expect(seat.displayBefore).not.toBeNull();
      }
    }
    expect(rec!.games).toBe(12);
    expect(rec!.wins).toBe(12);
    expect(rec!.seasonRatings).toHaveLength(2);
    expect(rec!.peak).toBe(Math.max(...[rec!.display!, ...rec!.seasonRatings]));
  });

  it('the tier keeps its demotion buffer within a season and is fresh after a reset', () => {
    const t = '2026-10-20T12:00:00.000Z';
    const mine: RatingRowLike = { state: G(1560, 60), season: '2026-10', lastRatedAt: t };
    const opp: RatingRowLike = { state: G(1500, 60), season: '2026-10', lastRatedAt: t };
    const start = startOf(gid(1), [{ account: A, row: mine, games: 50 }, { account: B, row: opp, games: 50 }]);
    const lose = gameOf(start, [2, 1], '2026-10-20T13:00:00.000Z');
    const held = computeApplication(lose, start, rows([rowOf(A, mine, 50, { tier: 'arc' }), rowOf(B, opp, 50)]), config);
    const after = held.applied.seats[0]!.displayAfter!;
    expect(after).toBeLessThan(1550);
    expect(after).toBeGreaterThanOrEqual(1525);
    expect(held.applied.seats[0]!.tierAfter).toBe('arc'); // within the buffer: stays Arc
    // the same rating from the previous season: reset, and the tier computed fresh
    const old: RatingRowLike = { ...mine, season: '2026-09' };
    const start2 = startOf(gid(2), [{ account: A, row: old, games: 50 }, { account: B, row: opp, games: 50 }]);
    const fresh = computeApplication(gameOf(start2, [2, 1], '2026-10-20T13:00:00.000Z'), start2, rows([rowOf(A, old, 50, { tier: 'arc' }), rowOf(B, opp, 50)]), config);
    expect(fresh.applied.seats[0]!.before).toEqual(seasonReset(mine.state));
    expect(fresh.applied.seats[0]!.tierAfter).toBe('pulse');
  });

  it('pods: ratePod with every seat\'s before and days, places counted, the record\'s wins, draws and losses', () => {
    const t = '2026-10-20T12:00:00.000Z';
    const accounts = [acc(1), acc(2), acc(3), acc(4)];
    const like = (mu: number): RatingRowLike => ({ state: { model: 'wenglin', mu, sigma: 2 }, season: '2026-10', lastRatedAt: before(t, 2) });
    const start = startOf(gid(1), accounts.map((a, i) => ({ account: a, row: like(25 + i), games: 20 })), 'pod-commander');
    const g = gameOf(start, [1, 1, 3, 4], t);
    const pr = accounts.map((a, i) => ({ ...rowOf(a, like(25 + i), 20), ladder: 'pod-commander' as const, tier: null }));
    const app = computeApplication(g, start, rows(pr), config);
    const expected = ratePod(accounts.map((_, i) => like(25 + i).state as WengLinState), [1, 1, 3, 4], [2, 2, 2, 2]);
    expect(app.applied.seats.map((s) => s.after)).toEqual(expected);
    expect(app.applied.seasonRecords.map((r) => [r.wins, r.draws, r.losses, r.places])).toEqual([
      [0, 1, 0, [1, 0, 0, 0]], [0, 1, 0, [1, 0, 0, 0]], [0, 0, 1, [0, 0, 1, 0]], [0, 0, 1, [0, 0, 0, 1]],
    ]);
  });

  it('a cap event from the record\'s evidence: each seat\'s account from the registry seat, its share by the cap\'s own measure', () => {
    const t = '2026-10-20T12:00:00.000Z';
    const r: RatingRowLike = { state: G(1500, 60), season: '2026-10', lastRatedAt: t };
    const start = startOf(gid(1), [{ account: null, row: r, games: 50 }, { account: B, row: r, games: 50 }]);
    const g = { ...gameOf(start, [2, 1], '2026-10-20T14:00:00.000Z'), cap: {
      kind: 'actions' as const, verdict: { kind: 'driver' as const, seat: 1 as const, share: 0.81 },
      seats: [{ seat: 1 as const, initiated: 1700, chargedMs: 10 }, { seat: 2 as const, initiated: 400, chargedMs: 9_999_999 }],
    } };
    const cap = computeApplication(g, start, rows([rowOf(B, r, 50)]), config).applied.cap!;
    expect(cap.seats.map((s) => [s.seat, s.account, s.share])).toEqual([[1, null, 1700 / 2100], [2, B, 400 / 2100]]);
    expect([cap.game, cap.kind, cap.at, cap.verdict]).toEqual([gid(1), 'actions', '2026-10-20T14:00:00.000Z', { kind: 'driver', seat: 1, share: 0.81 }]);
  });

  it('refuses inputs that do not belong together', () => {
    const start = startOf(gid(1), [{ account: A, row: rowA, games: 40 }, { account: B, row: rowB, games: 40 }]);
    expect(() => computeApplication({ ...gameOf(start, [2, 1], endedAt), game: gid(2) }, start, rows([]), config)).toThrow(/registry entry/);
    const other = startOf(gid(1), [{ account: A, row: rowA, games: 40 }, { account: acc(9), row: rowB, games: 40 }]);
    expect(() => computeApplication(gameOf(start, [2, 1], endedAt), other, rows([]), config)).toThrow(/registry seat/);
  });
});
