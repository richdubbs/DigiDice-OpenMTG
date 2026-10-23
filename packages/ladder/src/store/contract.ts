/**
 * The LadderStore contract suite (M15-3; design 13.3, 8.3, 8.7, 10.1, 11.2, 17.10). One suite for every store: test/m15-3/store.test.ts runs it on
 * the memory and file stores, and M15-7 runs it on PostgresLadderStore (PGlite, and a real server with OPENMTG_TEST_PG_URL) with a harness of its
 * own. Server only; fixed inputs and fixed times only (owner rule).
 *
 * The suite is a list of cases, not test-runner calls: `ladderStoreContract(harness)` returns `{ name, run }` pairs and a test file registers each
 * with its runner (`for (const c of ladderStoreContract(h)) it(c.name, c.run)`), so this file imports no test framework and no devDependency.
 * Assertions are node:assert's. A harness opens a fresh store per case and says where a string occurs in everything the store keeps (`places`: the
 * memory store's dump, the file store's bytes, PostgreSQL's tables), for the erasure case; `reopen`, when it has one, closes the store and opens the
 * same data again (the file store), for the persistence case.
 *
 * What only the file store has (a torn journal line, a crash after the snapshot and before the journal rewrite, the lock) is in
 * test/m15-3/file.test.ts.
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_TIER_FLOORS, DELETED_PLAYER_NAME, initialState, LADDERS, type LadderId, type RatingState, type SeasonId, type SeatNo, type TierId,
} from '../api';
import type { AccountId } from '../accounts';
import type { AbuseReport } from '../abuse/types';
import { isDeletedSortKey } from '../ids';
import type { RankedStart } from '../ledger';
import {
  LADDER_STORE_METHODS, type AdjustmentRow, type AppliedGame, type AppliedSeat, type CapEvent, type LadderStore, type RatingRow, type SeasonRecord,
} from './api';

// ---- the harness -------------------------------------------------------------------------------------------------------------------------------

export interface LadderStoreHarness {
  readonly name: string;
  /** A fresh, empty store. */
  open(): Promise<LadderStore>;
  /** The places `needle` occurs in everything the store keeps (table names, or `file:<name>` for raw bytes it cannot place); [] when nowhere. */
  places(store: LadderStore, needle: string): Promise<string[]>;
  /** Closes `store` and opens the same data again (a store that persists); absent: the persistence case is skipped. */
  reopen?(store: LadderStore): Promise<LadderStore>;
}

export interface LadderStoreCase { name: string; run: () => Promise<void> }

// ---- fixtures ----------------------------------------------------------------------------------------------------------------------------------

export const CONTRACT_T0 = '2026-10-15T12:00:00.000Z';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** CONTRACT_T0 + ms, canonical. */
export const at = (ms: number): string => new Date(Date.parse(CONTRACT_T0) + ms).toISOString();
/** A valid account id: "acc_" and 26 digits (digits are Crockford base32). */
export const accountOf = (n: number): AccountId => `acc_${String(n).padStart(26, '0')}` as AccountId;
/** A ULID-shaped game id. */
export const gameOf = (n: number): string => `01JG${String(n).padStart(22, '0')}`;

const L: LadderId = '1v1-standard';
const SEASON: SeasonId = '2026-10';

function startOf(game: string, accounts: (AccountId | null)[], o: { ladder?: LadderId; startedAt?: string; status?: RankedStart['status'] } = {}): RankedStart {
  const ladder = o.ladder ?? L;
  const startedAt = o.startedAt ?? at(0);
  return {
    game, match: `m-${game}`, ladder, startedAt,
    seats: accounts.map((account, i) => ({
      seat: (i + 1) as SeatNo, account, row: { state: initialState(LADDERS[ladder].model), season: startedAt.slice(0, 7), lastRatedAt: null }, games: 0,
    })),
    status: o.status ?? 'running', closedAt: null,
  };
}

function seatOf(seat: number, account: AccountId | null, place: 1 | 2 | 3 | 4, state: RatingState | null, display: number | null): AppliedSeat {
  return {
    seat: seat as SeatNo, account, name: account === null ? DELETED_PLAYER_NAME : `Player ${seat}`, place, loss: place === 1 ? null : 'life', lossRule: place === 1 ? null : 'CR 104.3b',
    outTurn: place === 1 ? null : 7, before: state, awayMs: 0, after: state, displayBefore: display, displayAfter: display, tierAfter: display === null ? null : 'pulse',
  };
}

function ratingRow(account: AccountId, o: Partial<RatingRow> = {}): RatingRow {
  return { account, ladder: L, state: { model: 'glicko2', r: 1500, rd: 200, vol: 0.06 }, season: SEASON, lastRatedAt: at(0), games: 1, tier: null, version: 1, ...o };
}

export function recordOf(account: AccountId | null, o: Partial<SeasonRecord> = {}): SeasonRecord {
  return {
    account, ladder: L, season: SEASON, sortKey: account ?? 'deleted:00000000000000000000000000', listed: true,
    games: 12, wins: 6, draws: 0, losses: 6, places: null, display: 1600, deviation: 70, standing: 1460, provisionalFrom: at(60 * DAY), peak: 1610,
    tier: 'arc', peakTier: 'arc', seasonRatings: [1590, 1600, 1610, 1600, 1600], careerGames: 40, lastGameAt: at(0), finalStanding: null, finalRank: null,
    badge: null, ...o,
  };
}

/** A two-seat applied game of `a` (seat 1, won) and `b` (seat 2), writing `records` and `ratings` as given. */
function gameFor(game: string, start: RankedStart, o: { endedAt?: string; records?: SeasonRecord[]; ratings?: AppliedGame['ratings']; cap?: CapEvent | null } = {}): AppliedGame {
  const endedAt = o.endedAt ?? at(20 * MINUTE);
  const state: RatingState = { model: 'glicko2', r: 1500, rd: 200, vol: 0.06 };
  return {
    game, ladder: start.ladder, season: endedAt.slice(0, 7), endedAt, appliedAt: endedAt, outcome: 'win', turns: 9,
    seats: start.seats.map((s, i) => seatOf(s.seat, s.account, i === 0 ? 1 : 2, s.account === null ? null : state, s.account === null ? null : 1500)),
    ratings: o.ratings ?? [], seasonRecords: o.records ?? [], cap: o.cap ?? null,
  };
}

let seeded = 0;
/** Writes `rec` through a game of its own (applyGame is the only way records are written): its account against a filler account. */
async function seed(store: LadderStore, rec: SeasonRecord, endedAt?: string): Promise<void> {
  assert.ok(rec.account !== null, 'seed: a live record');
  const game = gameOf(900_000 + ++seeded);
  const start = startOf(game, [rec.account, accountOf(800_000 + seeded)], { ladder: rec.ladder });
  await store.putStart(start);
  assert.equal(await store.applyGame(gameFor(game, start, { records: [rec], endedAt: endedAt ?? rec.lastGameAt })), 'applied');
}

function capOf(game: string, accounts: (AccountId | null)[], atTime: string): CapEvent {
  return {
    game, ladder: L, at: atTime, kind: 'actions', verdict: { kind: 'driver', seat: 1, share: 0.81 },
    seats: accounts.map((account, i) => ({ seat: (i + 1) as SeatNo, account, initiated: i === 0 ? 1700 : 400, chargedMs: 1000, share: i === 0 ? 0.81 : 0.19 })),
  };
}

function reportOf(n: number, accounts: (AccountId | null)[], createdAt: string): AbuseReport {
  return {
    id: gameOf(500_000 + n), kind: 'repeatedPairing', ladder: L, accounts, evidence: { games: [gameOf(n)], stats: { games: 5 } }, createdAt,
    dedupeKey: `key${n}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, status: 'pending',
  };
}

async function rejects(p: Promise<unknown>, what: string): Promise<void> {
  await assert.rejects(p, Error, what);
}

// ---- the cases ---------------------------------------------------------------------------------------------------------------------------------

export function ladderStoreContract(h: LadderStoreHarness): LadderStoreCase[] {
  const cases: LadderStoreCase[] = [];
  const add = (name: string, body: (store: LadderStore) => Promise<void>) =>
    cases.push({
      name: `${h.name}: ${name}`,
      run: async () => {
        const store = await h.open();
        try {
          await body(store);
        } finally {
          await store.close().catch(() => undefined);
        }
      },
    });
  const A = accountOf(1);
  const B = accountOf(2);
  const C = accountOf(3);
  const D = accountOf(4);

  add('has every method of LADDER_STORE_METHODS', async (store) => {
    for (const m of LADDER_STORE_METHODS) assert.equal(typeof (store as unknown as Record<string, unknown>)[m], 'function', m);
  });

  add('putStart is idempotent by game id (the first write stands); start and runningStarts read the registry, oldest first', async (store) => {
    const s1 = startOf(gameOf(1), [A, B], { startedAt: at(2 * MINUTE) });
    const s2 = startOf(gameOf(2), [C, D], { startedAt: at(MINUTE) });
    await store.putStart(s1);
    await store.putStart({ ...s1, match: 'other' });
    await store.putStart(s2);
    assert.deepEqual(await store.start(gameOf(1)), s1);
    assert.equal(await store.start(gameOf(3)), null);
    assert.deepEqual((await store.runningStarts()).map((s) => s.game), [gameOf(2), gameOf(1)]);
    assert.deepEqual((await store.runningStarts({ account: A })).map((s) => s.game), [gameOf(1)]);
    assert.deepEqual((await store.runningStarts({ startedBefore: at(2 * MINUTE) })).map((s) => s.game), [gameOf(2)]);
    assert.deepEqual((await store.runningStarts({ limit: 1 })).map((s) => s.game), [gameOf(2)]);
  });

  add('applyGame writes everything in one step, closes the start and is a no-op the second time (duplicate)', async (store) => {
    const s = startOf(gameOf(1), [A, B]);
    await store.putStart(s);
    const rowA = ratingRow(A, { version: 1 });
    const rec = recordOf(A, { lastGameAt: at(20 * MINUTE) });
    const g = gameFor(gameOf(1), s, { ratings: [{ row: rowA, expectVersion: null }], records: [rec], cap: capOf(gameOf(1), [A, B], at(20 * MINUTE)) });
    assert.equal(await store.applyGame(g), 'applied');
    assert.deepEqual(await store.applied(gameOf(1)), { status: 'applied', at: g.appliedAt });
    const closed = await store.start(gameOf(1));
    assert.equal(closed?.status, 'applied');
    assert.equal(closed?.closedAt, g.appliedAt);
    assert.deepEqual(await store.runningStarts(), []);
    assert.deepEqual((await store.ratings(L, [A, B])).get(A), { ...rowA, version: 1 });
    assert.equal((await store.ratings(L, [A, B])).has(B), false);
    assert.deepEqual(await store.seasonRecord(A, L, SEASON), rec);
    assert.equal((await store.history({ account: A, limit: 10 }))[0]?.game, gameOf(1));
    assert.equal((await store.capEvents(A, at(0))).length, 1);
    // the second time: nothing changes
    const again = { ...g, appliedAt: at(HOUR), ratings: [{ row: { ...rowA, games: 99 }, expectVersion: 1 }] };
    assert.equal(await store.applyGame(again), 'duplicate');
    assert.equal((await store.ratings(L, [A])).get(A)?.games, 1);
    assert.deepEqual(await store.applied(gameOf(1)), { status: 'applied', at: g.appliedAt });
  });

  add('applyGame answers conflict on a stale version or a row that appeared, and writes nothing', async (store) => {
    await store.putStart(startOf(gameOf(1), [A, B]));
    assert.equal(await store.applyGame(gameFor(gameOf(1), startOf(gameOf(1), [A, B]), { ratings: [{ row: ratingRow(A), expectVersion: null }] })), 'applied');
    const s = startOf(gameOf(2), [A, B]);
    await store.putStart(s);
    // A's row is at version 1 now: a computation that read no row, or version 2, is stale
    assert.equal(await store.applyGame(gameFor(gameOf(2), s, { ratings: [{ row: ratingRow(A, { version: 1, games: 2 }), expectVersion: null }] })), 'conflict');
    assert.equal(await store.applyGame(gameFor(gameOf(2), s, { ratings: [{ row: ratingRow(A, { version: 3, games: 2 }), expectVersion: 2 }] })), 'conflict');
    assert.equal(await store.applied(gameOf(2)), null);
    assert.equal((await store.start(gameOf(2)))?.status, 'running');
    assert.equal((await store.ratings(L, [A])).get(A)?.games, 1);
    assert.equal(await store.applyGame(gameFor(gameOf(2), s, { ratings: [{ row: ratingRow(A, { version: 2, games: 2 }), expectVersion: 1 }] })), 'applied');
    assert.deepEqual((await store.ratings(L, [A])).get(A), ratingRow(A, { version: 2, games: 2 }));
  });

  add('applyGame answers conflict when an account it writes is no longer its registry seat (erased since), or there is no running start', async (store) => {
    const s = startOf(gameOf(1), [A, B]);
    await store.putStart(s);
    await store.forgetAccount(A);
    const g = gameFor(gameOf(1), s, { ratings: [{ row: ratingRow(A), expectVersion: null }], records: [recordOf(A)] });
    assert.equal(await store.applyGame(g), 'conflict');
    assert.equal((await store.start(gameOf(1)))?.status, 'running');
    assert.deepEqual(await h.places(store, A), []);
    assert.equal(await store.applyGame(gameFor(gameOf(9), startOf(gameOf(9), [C, D]))), 'conflict');
    // rated with the erased seat as a deleted one: nothing of A is written, the start closes with A's snapshot cleared
    const fresh = (await store.start(gameOf(1)))!;
    assert.equal(fresh.seats[0]!.account, null);
    assert.notEqual(fresh.seats[0]!.row, null);
    assert.equal(await store.applyGame(gameFor(gameOf(1), fresh, { ratings: [{ row: ratingRow(B), expectVersion: null }] })), 'applied');
    const closed = (await store.start(gameOf(1)))!;
    assert.deepEqual(closed.seats.map((x) => [x.account, x.row === null, x.games]), [[null, true, 0], [B, false, 0]]);
    const seat = (await store.history({ account: B, limit: 1 }))[0]!.seats[0]!;
    assert.deepEqual(
      [seat.account, seat.name, seat.before, seat.after, seat.awayMs, seat.displayBefore, seat.displayAfter, seat.tierAfter],
      [null, DELETED_PLAYER_NAME, null, null, 0, null, null, null],
    );
  });

  add('markSkipped stores the marker, the cap event and the registry close in one write; again it is a duplicate', async (store) => {
    await store.putStart(startOf(gameOf(1), [A, B]));
    await store.putStart(startOf(gameOf(2), [C, D]));
    const cap = capOf(gameOf(1), [A, B], at(HOUR));
    assert.equal(await store.markSkipped({ game: gameOf(1), reason: 'void', at: at(HOUR), closeStartAs: 'void', cap }), 'stored');
    assert.equal((await store.start(gameOf(1)))?.status, 'void');
    assert.deepEqual(await store.applied(gameOf(1)), { status: 'skipped', at: at(HOUR) });
    assert.deepEqual(await store.capEvents(A, at(0)), [cap]);
    assert.equal(await store.markSkipped({ game: gameOf(1), reason: 'void', at: at(2 * HOUR), closeStartAs: 'void', cap: null }), 'duplicate');
    assert.deepEqual(await store.applied(gameOf(1)), { status: 'skipped', at: at(HOUR) });
    assert.equal(await store.markSkipped({ game: gameOf(2), reason: 'mismatch', at: at(HOUR), closeStartAs: 'skipped', cap: null }), 'stored');
    assert.equal((await store.start(gameOf(2)))?.status, 'skipped');
    // no registry entry (unregistered), and a lost start that stays lost
    assert.equal(await store.markSkipped({ game: gameOf(3), reason: 'unregistered', at: at(HOUR), closeStartAs: null, cap: null }), 'stored');
    await store.putStart(startOf(gameOf(4), [A, B]));
    await store.closeStart(gameOf(4), 'lost', at(HOUR));
    assert.equal(await store.markSkipped({ game: gameOf(4), reason: 'lost', at: at(2 * HOUR), closeStartAs: null, cap: null }), 'stored');
    assert.equal((await store.start(gameOf(4)))?.status, 'lost');
    // an applied game cannot be skipped, nor a skipped one applied
    assert.equal(await store.applyGame(gameFor(gameOf(1), startOf(gameOf(1), [A, B]))), 'duplicate');
  });

  add('a cap event takes its accounts from the registry seats: one computed before an erasure and written after it holds no id (review of M15-3)', async (store) => {
    // markSkipped: a void game at a cap, its cap computed while A still had its seat
    await store.putStart(startOf(gameOf(1), [A, B]));
    const cap = capOf(gameOf(1), [A, B], at(HOUR));
    await store.forgetAccount(A);
    assert.equal(await store.markSkipped({ game: gameOf(1), reason: 'void', at: at(HOUR), closeStartAs: 'void', cap }), 'stored');
    assert.deepEqual(await store.capEvents(A, at(0)), []);
    assert.deepEqual((await store.capEvents(B, at(0))).map((c) => c.seats.map((s) => s.account)), [[null, B]]);
    // applyGame the same way (the rated seats are the registry's; the cap's accounts are ignored)
    await store.putStart(startOf(gameOf(2), [C, D]));
    await store.forgetAccount(C);
    const fresh = (await store.start(gameOf(2)))!;
    assert.equal(await store.applyGame(gameFor(gameOf(2), fresh, { cap: capOf(gameOf(2), [C, D], at(2 * HOUR)) })), 'applied');
    assert.deepEqual((await store.capEvents(D, at(0))).map((c) => c.seats.map((s) => s.account)), [[null, D]]);
    // a seat the caller names with another account, or a cap without a registry entry: the registry decides, or null
    await store.putStart(startOf(gameOf(3), [B, D]));
    assert.equal(await store.markSkipped({ game: gameOf(3), reason: 'void', at: at(3 * HOUR), closeStartAs: 'void', cap: capOf(gameOf(3), [C, A], at(3 * HOUR)) }), 'stored');
    assert.equal(await store.markSkipped({ game: gameOf(4), reason: 'unregistered', at: at(3 * HOUR), closeStartAs: null, cap: capOf(gameOf(4), [A, C], at(3 * HOUR)) }), 'stored');
    assert.deepEqual((await store.capEvents(B, at(3 * HOUR))).map((c) => [c.game, c.seats.map((s) => s.account)]), [[gameOf(3), [B, D]]]);
    assert.deepEqual(await h.places(store, A), []);
    assert.deepEqual(await h.places(store, C), []);
  });

  add('markSkipped clears an erased seat\'s snapshot as it closes the start, and keeps it while it does not close it (review of M15-3)', async (store) => {
    await store.putStart(startOf(gameOf(1), [A, B]));
    await store.forgetAccount(A);
    const running = (await store.start(gameOf(1)))!;
    assert.deepEqual([running.seats[0]!.account, running.seats[0]!.row !== null], [null, true]);
    assert.equal(await store.markSkipped({ game: gameOf(1), reason: 'mismatch', at: at(HOUR), closeStartAs: 'skipped', cap: null }), 'stored');
    const closed = (await store.start(gameOf(1)))!;
    assert.equal(closed.status, 'skipped');
    assert.deepEqual(closed.seats.map((x) => [x.account, x.row === null, x.games]), [[null, true, 0], [B, false, 0]]);
  });

  add('closeStart closes only a running start as lost, clearing deleted seats\' snapshots', async (store) => {
    await store.putStart(startOf(gameOf(1), [A, B]));
    await store.forgetAccount(A);
    await store.closeStart(gameOf(1), 'lost', at(HOUR));
    const s = (await store.start(gameOf(1)))!;
    assert.deepEqual([s.status, s.closedAt, s.seats[0]!.row, s.seats[1]!.account], ['lost', at(HOUR), null, B]);
    await store.closeStart(gameOf(1), 'lost', at(2 * HOUR));
    assert.equal((await store.start(gameOf(1)))?.closedAt, at(HOUR));
    await store.closeStart(gameOf(7), 'lost', at(HOUR));
    assert.equal(await store.start(gameOf(7)), null);
    await rejects(store.closeStart(gameOf(1), 'void' as 'lost', at(HOUR)), 'closeStart only closes as lost');
  });

  add('the intake cursor round-trips', async (store) => {
    assert.equal(await store.intakeCursor(), null);
    await store.setIntakeCursor({ endedAt: at(HOUR), game: gameOf(5) });
    assert.deepEqual(await store.intakeCursor(), { endedAt: at(HOUR), game: gameOf(5) });
  });

  add('season rows and records: by account, newest season first, and every record of a season paged by sortKey', async (store) => {
    await store.putSeasonRow({ ladder: L, season: SEASON, status: 'open', floors: DEFAULT_TIER_FLOORS, closedAt: null, eligible: null });
    assert.deepEqual(await store.seasonRow(L, SEASON), { ladder: L, season: SEASON, status: 'open', floors: [...DEFAULT_TIER_FLOORS], closedAt: null, eligible: null });
    assert.equal(await store.seasonRow(L, '2026-11'), null);
    await seed(store, recordOf(A, { season: '2026-09', lastGameAt: '2026-09-20T12:00:00.000Z' }));
    await seed(store, recordOf(A));
    await seed(store, recordOf(B));
    await seed(store, recordOf(C));
    assert.deepEqual((await store.seasonRecords(A)).map((r) => r.season), ['2026-10', '2026-09']);
    assert.equal((await store.seasonRecord(A, L, '2026-09'))?.season, '2026-09');
    assert.equal(await store.seasonRecord(D, L, SEASON), null);
    assert.deepEqual((await store.seasonRecordsOf(L, SEASON, null, 2)).map((r) => r.sortKey), [A, B]);
    assert.deepEqual((await store.seasonRecordsOf(L, SEASON, B, 2)).map((r) => r.sortKey), [C]);
  });

  add('a closed season row keeps when the daily abuse sweep was handed it (dailyAt), across closes and reads (review of M15-3)', async (store) => {
    await store.putSeasonRow({ ladder: L, season: SEASON, status: 'open', floors: DEFAULT_TIER_FLOORS, closedAt: null, eligible: null });
    assert.equal(await store.closeSeason(L, SEASON, [], at(DAY)), 'closed');
    const closed = (await store.seasonRow(L, SEASON))!;
    assert.equal(closed.dailyAt ?? null, null);
    await store.putSeasonRow({ ...closed, dailyAt: at(2 * DAY) });
    assert.deepEqual(await store.seasonRow(L, SEASON), { ...closed, dailyAt: at(2 * DAY) });
    assert.equal(await store.closeSeason(L, SEASON, [], at(3 * DAY)), 'already');
    assert.equal((await store.seasonRow(L, SEASON))?.dailyAt, at(2 * DAY));
    await rejects(store.putSeasonRow({ ...closed, dailyAt: 'tomorrow' }), 'an ISO time');
  });

  add('the live leaderboard: eligible rows only, ordered by standing, games and sortKey, keyset pages, counts and shared ranks', async (store) => {
    const E = accountOf(5), F = accountOf(6), G = accountOf(7), H = accountOf(8);
    await seed(store, recordOf(A, { standing: 1588, games: 12 }));
    await seed(store, recordOf(B, { standing: 1588, games: 15 }));
    await seed(store, recordOf(C, { standing: 1550, games: 10 }));
    await seed(store, recordOf(D, { standing: 1588, games: 12 }));
    await seed(store, recordOf(E, { standing: 1700, games: 9 })); // too few season games
    await seed(store, recordOf(F, { standing: 1700, listed: false })); // not listed
    await seed(store, recordOf(G, { standing: 1700, provisionalFrom: at(DAY) })); // provisional from tomorrow
    await seed(store, recordOf(H, { display: null, deviation: null, standing: null, provisionalFrom: null })); // in placement
    const q = { ladder: L, season: SEASON, closed: false, minGames: 10, now: at(HOUR) } as const;
    assert.deepEqual((await store.leaderboard({ ...q, limit: 10 })).map((r) => r.account), [G, B, A, D, C]);
    assert.equal(await store.leaderboardCount(q), 5);
    // G leaves the board at its provisionalFrom (now < provisionalFrom only)
    const later = { ...q, now: at(DAY) };
    assert.deepEqual((await store.leaderboard({ ...later, limit: 10 })).map((r) => r.account), [B, A, D, C]);
    assert.equal(await store.leaderboardCount(later), 4);
    // ranks: 1 + the eligible rows with a higher standing (1588, 1588, 1588, 1550: 1, 1, 1, 4)
    assert.equal(await store.rankOf(later, 1588), 1);
    assert.equal(await store.rankOf(later, 1550), 4);
    assert.equal(await store.rankOf(later, 1600), 1);
    // keyset pages: neither skipped nor repeated
    const p1 = await store.leaderboard({ ...later, limit: 2 });
    const last = p1[p1.length - 1]!;
    const p2 = await store.leaderboard({ ...later, limit: 2, after: { key: last.standing!, games: last.games, sortKey: last.sortKey } });
    assert.deepEqual([...p1, ...p2].map((r) => r.account), [B, A, D, C]);
    // the listed mirror: open seasons only; how many changed
    assert.equal(await store.setListed(F, true), 1);
    assert.equal(await store.setListed(F, true), 0);
    assert.equal(await store.leaderboardCount(later), 5);
    assert.equal(await store.setListed(B, false), 1);
    assert.deepEqual((await store.leaderboard({ ...later, limit: 10 })).map((r) => r.account), [F, A, D, C]);
    assert.equal(await store.rankOf(later, 1550), 4);
  });

  add('closing a season: finals written once, the closed board by final standing, and a closed season never changes again', async (store) => {
    await seed(store, recordOf(A, { standing: 1500 }));
    await seed(store, recordOf(B, { standing: 1600 }));
    await seed(store, recordOf(C, { standing: 1550 }));
    await store.putSeasonRow({ ladder: L, season: SEASON, status: 'open', floors: [1200, 1400, 1500, 1600, 1700], closedAt: null, eligible: null });
    const finals = [
      { sortKey: A, finalStanding: 1490, finalRank: 2, badge: 'arc' as TierId },
      { sortKey: B, finalStanding: 1590, finalRank: 1, badge: null },
      { sortKey: C, finalStanding: null, finalRank: null, badge: 'pulse' as TierId },
    ];
    assert.equal(await store.closeSeason(L, SEASON, finals, at(DAY)), 'closed');
    assert.equal(await store.closeSeason(L, SEASON, [{ sortKey: A, finalStanding: 1, finalRank: 1, badge: null }], at(2 * DAY)), 'already');
    assert.deepEqual(await store.seasonRow(L, SEASON), { ladder: L, season: SEASON, status: 'closed', floors: [1200, 1400, 1500, 1600, 1700], closedAt: at(DAY), eligible: 2 });
    const q = { ladder: L, season: SEASON, closed: true, minGames: 10, now: at(3 * DAY) } as const;
    assert.deepEqual((await store.leaderboard({ ...q, limit: 10 })).map((r) => [r.account, r.finalRank, r.badge]), [[B, 1, null], [A, 2, 'arc']]);
    assert.equal(await store.leaderboardCount(q), 2);
    assert.equal((await store.seasonRecord(C, L, SEASON))?.badge, 'pulse');
    // nothing writes a closed season's records any more
    assert.equal(await store.setListed(A, false), 0);
    await seed(store, recordOf(A, { standing: 1, games: 99 }));
    assert.equal((await store.seasonRecord(A, L, SEASON))?.games, 12);
  });

  add('a closed board keeps a deleted account\'s row under a random marker, and a cursor on that row works', async (store) => {
    await seed(store, recordOf(A, { standing: 1600 }));
    await seed(store, recordOf(B, { standing: 1500 }));
    await seed(store, recordOf(C, { standing: 1400 }));
    await store.closeSeason(L, SEASON, [
      { sortKey: A, finalStanding: 1600, finalRank: 1, badge: 'arc' }, { sortKey: B, finalStanding: 1500, finalRank: 2, badge: 'pulse' },
      { sortKey: C, finalStanding: 1400, finalRank: 3, badge: null },
    ], at(DAY));
    const report = await store.forgetAccount(B);
    assert.equal(report.seasonRecords, 1);
    const q = { ladder: L, season: SEASON, closed: true, minGames: 10, now: at(3 * DAY) } as const;
    const rows = await store.leaderboard({ ...q, limit: 10 });
    assert.equal(rows.length, 3);
    const del = rows.find((r) => r.account === null)!;
    assert.ok(isDeletedSortKey(del.sortKey));
    assert.deepEqual(
      [del.listed, del.games, del.wins, del.draws, del.losses, del.display, del.deviation, del.standing, del.tier, del.finalStanding, del.finalRank],
      [true, 12, 6, 0, 6, 1600, 70, 1500, 'arc', 1500, 2],
    );
    assert.deepEqual(
      [del.places, del.provisionalFrom, del.peak, del.peakTier, del.seasonRatings, del.badge, del.careerGames, del.lastGameAt],
      [null, null, null, null, [], null, 12, '2026-11-01T00:00:00.000Z'],
    );
    // a page ending on the deleted row (the middle one): the next page starts right after it
    assert.deepEqual(rows.map((r) => r.account), [A, null, C]);
    const page = await store.leaderboard({ ...q, limit: 2 });
    const end = page[page.length - 1]!;
    assert.equal(end.sortKey, del.sortKey);
    const next = await store.leaderboard({ ...q, limit: 10, after: { key: end.finalStanding!, games: end.games, sortKey: end.sortKey } });
    assert.deepEqual(next.map((r) => r.account), [C]);
    assert.deepEqual(await h.places(store, B), []);
  });

  add('history, rematches, pairs and gamesSince: newest or oldest first as stated, keyset pages, the ladder filter', async (store) => {
    const games: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const g = gameOf(i);
      games.push(g);
      const s = startOf(g, i % 2 === 0 ? [A, C] : [A, B], { ladder: i === 5 ? '1v1-pioneer' : L });
      await store.putStart(s);
      // two games end in the same millisecond: (endedAt, game) orders them
      assert.equal(await store.applyGame(gameFor(g, s, { endedAt: at((i === 4 ? 3 : i) * HOUR) })), 'applied');
    }
    assert.deepEqual((await store.history({ account: A, limit: 10 })).map((h) => h.game), [games[4], games[3], games[2], games[1], games[0]]);
    assert.deepEqual((await store.history({ account: A, ladder: L, limit: 2 })).map((h) => h.game), [games[3], games[2]]);
    const page2 = await store.history({ account: A, ladder: L, limit: 2, before: { endedAt: at(3 * HOUR), game: games[2]! } });
    assert.deepEqual(page2.map((h) => h.game), [games[1], games[0]]);
    assert.deepEqual(await store.recentOpponents(A, L, 3), [[C], [B], [C]]);
    assert.deepEqual(await store.recentOpponents(B, L, 3), [[A], [A]]);
    assert.deepEqual((await store.pairGames(A, B, L, at(0))).map((h) => h.game), [games[0], games[2]]);
    assert.deepEqual((await store.pairGames(A, B, L, at(2 * HOUR))).map((h) => h.game), [games[2]]);
    const since = await store.gamesSince({ since: at(2 * HOUR), limit: 2 });
    assert.deepEqual(since.map((h) => h.game), [games[1], games[2]]);
    const last = since[since.length - 1]!;
    assert.deepEqual((await store.gamesSince({ since: at(2 * HOUR), after: { endedAt: last.endedAt, game: last.game }, limit: 5 })).map((h) => h.game), [games[3], games[4]]);
    assert.deepEqual((await store.gamesSince({ ladder: '1v1-pioneer', since: at(0), limit: 5 })).map((h) => h.game), [games[4]]);
  });

  add('cap events by account and time', async (store) => {
    await store.putStart(startOf(gameOf(1), [A, B]));
    await store.putStart(startOf(gameOf(2), [A, C]));
    await store.markSkipped({ game: gameOf(1), reason: 'void', at: at(HOUR), closeStartAs: 'void', cap: capOf(gameOf(1), [A, B], at(HOUR)) });
    const s2 = (await store.start(gameOf(2)))!;
    await store.applyGame(gameFor(gameOf(2), s2, { endedAt: at(3 * HOUR), cap: capOf(gameOf(2), [A, C], at(3 * HOUR)) }));
    assert.deepEqual((await store.capEvents(A, at(0))).map((c) => c.game), [gameOf(1), gameOf(2)]);
    assert.deepEqual((await store.capEvents(A, at(2 * HOUR))).map((c) => c.game), [gameOf(2)]);
    assert.deepEqual((await store.capEvents(B, at(0))).map((c) => c.game), [gameOf(1)]);
    assert.deepEqual(await store.capEvents(D, at(0)), []);
  });

  add('penalties and the active cooldowns', async (store) => {
    assert.equal(await store.penalties(A), null);
    await store.putPenalties({ account: A, misses: [at(0), at(MINUTE)], cooldownUntil: at(6 * MINUTE) });
    await store.putPenalties({ account: B, misses: [at(0)], cooldownUntil: null });
    await store.putPenalties({ account: C, misses: [at(0), at(MINUTE), at(2 * MINUTE)], cooldownUntil: at(17 * MINUTE) });
    assert.deepEqual(await store.penalties(A), { account: A, misses: [at(0), at(MINUTE)], cooldownUntil: at(6 * MINUTE) });
    assert.deepEqual((await store.activeCooldowns(at(5 * MINUTE))).map((p) => p.account), [A, C]);
    assert.deepEqual((await store.activeCooldowns(at(6 * MINUTE))).map((p) => p.account), [C]);
    assert.deepEqual(await store.activeCooldowns(at(HOUR)), []);
  });

  add('the report outbox: one report per dedupe key, pending oldest first, sent stripped to its key, kind and time, purged later', async (store) => {
    assert.equal(await store.putReport(reportOf(1, [A, B], at(0))), 'stored');
    assert.equal(await store.putReport({ ...reportOf(2, [A, B], at(MINUTE)), dedupeKey: reportOf(1, [], at(0)).dedupeKey }), 'duplicate');
    assert.equal(await store.putReport({ ...reportOf(3, [C], at(2 * MINUTE)), status: 'sent' }), 'stored');
    assert.deepEqual((await store.pendingReports(10)).map((r) => [r.id, r.status]), [[reportOf(1, [], at(0)).id, 'pending'], [reportOf(3, [], at(0)).id, 'pending']]);
    await store.markReportSent(reportOf(1, [], at(0)).id, at(HOUR));
    assert.deepEqual((await store.pendingReports(10)).map((r) => r.id), [reportOf(3, [], at(0)).id]);
    const sent = (await store.reports(at(0), 10))[0]!;
    assert.deepEqual(sent, {
      id: reportOf(1, [], at(0)).id, kind: 'repeatedPairing', ladder: null, accounts: [], evidence: { games: [], stats: {} }, createdAt: at(0),
      dedupeKey: reportOf(1, [], at(0)).dedupeKey, status: 'sent',
    });
    assert.equal(await store.purgeReports(at(HOUR)), 0);
    assert.equal(await store.purgeReports(at(HOUR + 1)), 1);
    assert.deepEqual((await store.reports(at(0), 10)).map((r) => r.id), [reportOf(3, [], at(0)).id]);
    // the key is free again once its stub is purged
    assert.equal(await store.putReport(reportOf(1, [A, B], at(8 * DAY))), 'stored');
    assert.deepEqual((await store.reports(at(DAY), 10)).map((r) => r.createdAt), [at(8 * DAY)]);
  });

  add('resetRating writes the row and its audit; the open season\'s record keeps its games and loses its rating', async (store) => {
    const s = startOf(gameOf(1), [A, B]);
    await store.putStart(s);
    assert.equal(await store.applyGame(gameFor(gameOf(1), s, { ratings: [{ row: ratingRow(A), expectVersion: null }], records: [recordOf(A)] })), 'applied');
    const before = (await store.ratings(L, [A])).get(A)!;
    const after = ratingRow(A, { state: initialState('glicko2'), lastRatedAt: null, games: 0, tier: null, version: before.version + 1 });
    const audit: AdjustmentRow = { id: gameOf(77), account: A, ladder: L, by: 'mod-1', reason: 'smurfing', before, after, at: at(HOUR) };
    await store.resetRating(after, audit);
    assert.deepEqual((await store.ratings(L, [A])).get(A), after);
    const rec = (await store.seasonRecord(A, L, SEASON))!;
    assert.deepEqual(
      [rec.games, rec.wins, rec.display, rec.deviation, rec.standing, rec.provisionalFrom, rec.tier, rec.peak, rec.peakTier, rec.seasonRatings, rec.careerGames],
      [12, 6, null, null, null, null, null, null, null, [], 0],
    );
    await rejects(store.resetRating(after, { ...audit, account: B }), 'an audit about another account');
  });

  add('resetRating resets only a row that is there, as it was read: otherwise conflict, and nothing is written (review of M15-3)', async (store) => {
    const reset = (account: AccountId, before: RatingRow | null, version: number, id: number) => {
      const after = ratingRow(account, { state: initialState('glicko2'), lastRatedAt: null, games: 0, tier: null, version });
      return store.resetRating(after, { id: gameOf(id), account, ladder: L, by: 'mod-1', reason: 'r', before, after, at: at(HOUR) });
    };
    // no row: nothing to reset (a mistyped id), and no audit row about it
    await assert.rejects(reset(C, null, 1, 70), { code: 'conflict' });
    assert.deepEqual(await h.places(store, C), []);
    const s = startOf(gameOf(1), [A, B]);
    await store.putStart(s);
    await store.applyGame(gameFor(gameOf(1), s, { ratings: [{ row: ratingRow(A), expectVersion: null }] }));
    const read = (await store.ratings(L, [A])).get(A)!;
    // a row changed since it was read (a game in between, another process), or a version that does not follow it
    await assert.rejects(reset(A, { ...read, version: read.version - 1 }, read.version, 71), { code: 'conflict' });
    await assert.rejects(reset(A, read, read.version + 2, 72), { code: 'conflict' });
    assert.deepEqual((await store.ratings(L, [A])).get(A), read);
    await reset(A, read, read.version + 1, 73);
    assert.equal((await store.ratings(L, [A])).get(A)?.games, 0);
  });

  add('forgetAccount, then a resetRating that read the row before the erasure: refused, and no trace of the id (review of M15-3)', async (store) => {
    const s = startOf(gameOf(1), [A, B]);
    await store.putStart(s);
    await store.applyGame(gameFor(gameOf(1), s, {
      ratings: [{ row: ratingRow(A), expectVersion: null }, { row: ratingRow(B), expectVersion: null }], records: [recordOf(A), recordOf(B)],
    }));
    const read = (await store.ratings(L, [A])).get(A)!;
    await store.forgetAccount(A);
    assert.deepEqual(await h.places(store, A), []);
    const after = ratingRow(A, { state: initialState('glicko2'), lastRatedAt: null, games: 0, tier: null, version: read.version + 1 });
    await assert.rejects(store.resetRating(after, { id: gameOf(80), account: A, ladder: L, by: 'mod-1', reason: 'smurfing', before: read, after, at: at(HOUR) }), { code: 'conflict' });
    assert.deepEqual(await h.places(store, A), []);
  });

  add('forgetAccount leaves no trace of the id, keeps opponents and closed boards, and finds nothing more the second time', async (store) => {
    // a rated game (history, cap, ratings), a running start, a closed season, an open season, penalties, a report, an audit row
    const s = startOf(gameOf(1), [A, B]);
    await store.putStart(s);
    await store.applyGame(gameFor(gameOf(1), s, {
      ratings: [{ row: ratingRow(A), expectVersion: null }, { row: ratingRow(B), expectVersion: null }],
      records: [recordOf(A, { season: '2026-10' }), recordOf(B)], cap: capOf(gameOf(1), [A, B], at(20 * MINUTE)),
    }));
    await seed(store, recordOf(A, { season: '2026-09', lastGameAt: '2026-09-20T12:00:00.000Z', standing: 1500 }));
    await store.closeSeason(L, '2026-09', [{ sortKey: A, finalStanding: 1480, finalRank: 1, badge: 'pulse' }], '2026-10-01T00:15:00.000Z');
    await store.putStart(startOf(gameOf(2), [A, C], { startedAt: at(HOUR) }));
    await store.putPenalties({ account: A, misses: [at(0)], cooldownUntil: null });
    await store.putReport(reportOf(1, [A, B], at(0)));
    await store.resetRating(ratingRow(A, { version: 2 }), { id: gameOf(78), account: A, ladder: L, by: 'mod-1', reason: 'r', before: ratingRow(A), after: ratingRow(A, { version: 2 }), at: at(HOUR) });
    assert.ok((await h.places(store, A)).length > 0);

    const report = await store.forgetAccount(A);
    // seats: the rated game's and the seeded September game's; starts: those two (closed) and the running one
    assert.deepEqual(report, { ratings: 1, seasonRecords: 2, historySeats: 2, reports: 1, starts: 3, penalties: 1, capSeats: 1, adjustments: 1 });
    assert.deepEqual(await h.places(store, A), []);
    // opponents keep everything; the closed board keeps an anonymous row; the running start keeps the snapshot until it is rated
    assert.ok((await store.ratings(L, [B])).has(B));
    assert.equal((await store.seasonRecord(B, L, SEASON))?.games, 12);
    const closed = await store.leaderboard({ ladder: L, season: '2026-09', closed: true, minGames: 10, now: at(DAY), limit: 5 });
    assert.deepEqual(closed.map((r) => [r.account, r.finalRank]), [[null, 1]]);
    const running = (await store.start(gameOf(2)))!;
    assert.deepEqual([running.status, running.seats[0]!.account, running.seats[0]!.row !== null], ['running', null, true]);
    assert.deepEqual((await store.start(gameOf(1)))!.seats[0], { seat: 1, account: null, row: null, games: 0 });
    assert.deepEqual((await store.reports(at(0), 5))[0]!.accounts, [B, null]);
    assert.equal(await store.penalties(A), null);
    // run again: nothing more
    assert.deepEqual(await store.forgetAccount(A), { ratings: 0, seasonRecords: 0, historySeats: 0, reports: 0, starts: 0, penalties: 0, capSeats: 0, adjustments: 0 });
  });

  add('every result is a copy, and so is every argument', async (store) => {
    const s = startOf(gameOf(1), [A, B]);
    await store.putStart(s);
    s.seats[0]!.account = C;
    const read = (await store.start(gameOf(1)))!;
    read.seats[1]!.account = D;
    assert.deepEqual((await store.start(gameOf(1)))!.seats.map((x) => x.account), [A, B]);
    const rec = recordOf(A);
    await seed(store, rec);
    rec.seasonRatings.push(1);
    const got = (await store.seasonRecord(A, L, SEASON))!;
    got.seasonRatings.push(2);
    assert.deepEqual((await store.seasonRecord(A, L, SEASON))!.seasonRatings, [1590, 1600, 1610, 1600, 1600]);
    const rows = await store.ratings(L, [A]);
    rows.clear();
    assert.equal((await store.leaderboard({ ladder: L, season: SEASON, closed: false, minGames: 0, now: at(0), limit: 5 })).length, 1);
  });

  add('refuses arguments that are not of the contract\'s shape', async (store) => {
    await rejects(store.ratings('no-ladder' as LadderId, [A]), 'a ladder id');
    await rejects(store.putStart({ ...startOf(gameOf(1), [A, B]), startedAt: 'yesterday' }), 'an ISO time');
    await rejects(store.setIntakeCursor({ endedAt: 'now', game: '' }), 'an ISO time');
    await rejects(store.leaderboard({ ladder: L, season: SEASON, closed: false, minGames: 10, now: at(0), limit: 0 }), 'a limit');
    await rejects(store.putPenalties({ account: A, misses: ['soon'], cooldownUntil: null }), 'miss times');
  });

  if (h.reopen) {
    const reopen = h.reopen.bind(h);
    cases.push({
      name: `${h.name}: everything written survives a reopen`,
      run: async () => {
        let store = await h.open();
        try {
          const s = startOf(gameOf(1), [A, B]);
          await store.putStart(s);
          await store.applyGame(gameFor(gameOf(1), s, { ratings: [{ row: ratingRow(A), expectVersion: null }], records: [recordOf(A)] }));
          await store.setIntakeCursor({ endedAt: at(HOUR), game: gameOf(1) });
          await store.putPenalties({ account: B, misses: [at(0)], cooldownUntil: at(HOUR) });
          await store.putReport(reportOf(1, [A, B], at(0)));
          const before = {
            start: await store.start(gameOf(1)), ratings: [...(await store.ratings(L, [A]))], record: await store.seasonRecord(A, L, SEASON),
            history: await store.history({ account: A, limit: 5 }), cursor: await store.intakeCursor(), penalties: await store.penalties(B),
            reports: await store.reports(at(0), 5),
          };
          store = await reopen(store);
          const after = {
            start: await store.start(gameOf(1)), ratings: [...(await store.ratings(L, [A]))], record: await store.seasonRecord(A, L, SEASON),
            history: await store.history({ account: A, limit: 5 }), cursor: await store.intakeCursor(), penalties: await store.penalties(B),
            reports: await store.reports(at(0), 5),
          };
          assert.deepEqual(after, before);
        } finally {
          await store.close().catch(() => undefined);
        }
      },
    });
  }
  return cases;
}
