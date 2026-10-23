/**
 * M15-1: the contracts as data and as types (design 13.2-13.5, 17.1): LADDER_STORE_METHODS matches LadderStore both ways; the method sets of
 * LadderService, RankedMatcher, AbuseChecker and LedgerSource pinned against independent lists (a missing or extra one fails the typecheck);
 * NO_ABUSE_CHECKS files nothing; the reason codes agree with each other (every NotRatedReason is a SkipReason); the extended rows extend what they
 * say; m13's GameRecord shape, as extracted on 2026-10-21, fits LedgerGameRecord (D2; M15-8 replaces this copy with the real type test); and the
 * PostgreSQL seam LadderSql has m14's AccountsSql's shape, which hosted's SqlClient satisfies (13.7; M15-7 pins it against SqlClient at the sync).
 */
import { describe, expect, it } from 'vitest';
import type { AccountsSql, AccountsSqlQueryable, AccountsSqlResult } from '@openmtg/accounts';
import {
  LADDER_SCHEMA_VERSION, LADDER_STORE_METHODS, NO_ABUSE_CHECKS,
  type AbuseChecker, type AbuseContext, type AppliedGame, type AppliedSeat, type CapEvent, type CapKind, type Eligibility, type Glicko2PeriodResult,
  type Glicko2State, type IntakeResult, type LadderService, type LadderStore, type LedgerGameRecord, type LedgerPlacement, type LedgerSource, type LossCode,
  type NotRatedReason, type RankedEnterRefusal, type RankedMatcher, type RatedSeat, type RatingRow, type RatingRowLike, type SkipReason, type StartSeat,
  type LadderSql, type LadderSqlQueryable, type LadderSqlResult,
} from '@openmtg/ladder';
import type { Equals } from '../support/types';

// ---- LadderStore's methods, listed here independently of the package -------------------------------------------------------------------------
const STORE = [
  'ratings', 'putStart', 'start', 'runningStarts', 'closeStart', 'applyGame', 'markSkipped', 'applied', 'intakeCursor', 'setIntakeCursor', 'seasonRow',
  'putSeasonRow', 'seasonRecord', 'seasonRecords', 'seasonRecordsOf', 'setListed', 'leaderboard', 'leaderboardCount', 'rankOf', 'closeSeason',
  'history', 'recentOpponents', 'pairGames', 'gamesSince', 'capEvents', 'penalties', 'putPenalties', 'activeCooldowns', 'putReport', 'pendingReports',
  'markReportSent', 'purgeReports', 'reports', 'resetRating', 'forgetAccount', 'close',
] as const;
const pinStore: Equals<(typeof STORE)[number], keyof LadderStore> = true;
const pinStoreList: Equals<(typeof LADDER_STORE_METHODS)[number], keyof LadderStore> = true;

const SERVICE = [
  'open', 'eligibility', 'accountBusy', 'cooldownUntil', 'matcherContext', 'attachQueue', 'entryFor', 'blockedAmong', 'readyCheckMissed', 'registerStart',
  'stakes', 'intake', 'sweep', 'standingChanged', 'status', 'leaderboard', 'history', 'profile', 'exportAccount', 'forgetAccount', 'resetRating', 'onRated',
  'onNotRated',
] as const;
const pinService: Equals<(typeof SERVICE)[number], keyof LadderService> = true;
const MATCHER = ['enter', 'leave', 'tick', 'requeueFront', 'missed', 'status', 'queued', 'accounts', 'window', 'noteBlocks'] as const;
const pinMatcher: Equals<(typeof MATCHER)[number], keyof RankedMatcher> = true;
const pinChecker: Equals<keyof AbuseChecker, 'afterGame' | 'afterMiss' | 'daily'> = true;
const pinLedger: Equals<keyof LedgerSource, 'results' | 'resultsAfter' | 'result' | 'running'> = true;
const pinContext: Equals<keyof AbuseContext['store'], 'pairGames' | 'history' | 'gamesSince' | 'capEvents' | 'penalties' | 'seasonRecord' | 'seasonRecordsOf'> = true;

// ---- reason codes ----------------------------------------------------------------------------------------------------------------------------
const pinSkip: Equals<SkipReason, 'unranked' | 'unregistered' | 'lost' | 'closed' | 'void' | 'mismatch' | 'malformed' | 'ladderOff'> = true;
/** Every reason the end screen shows is a skip reason the adapter or the sweep produces (8.2, 8.3). */
const pinNotRated: Equals<Extract<SkipReason, NotRatedReason>, NotRatedReason> = true;
const pinIntake: Equals<IntakeResult['kind'], 'applied' | 'duplicate' | 'skipped' | 'failed'> = true;
const pinRefusal: Equals<RankedEnterRefusal, 'inQueue' | 'atTable' | 'inRankedGame' | 'address' | 'cooldown' | 'notOffered'> = true;
const pinEligibility: Equals<Extract<Eligibility, { ok: false }>['reason'], 'notSignedIn' | 'notAllowed' | 'notOffered' | 'inRankedGame' | 'inQueue' | 'cooldown'> = true;
const pinCapKind: Equals<CapKind, CapEvent['kind']> = true;

// ---- rows that extend others ----------------------------------------------------------------------------------------------------------------
const pinRatingRow: Equals<Pick<RatingRow, keyof RatingRowLike>, RatingRowLike> = true;
const pinAppliedSeat: Equals<Pick<AppliedSeat, keyof RatedSeat>, RatedSeat> = true;
const pinPeriod: Equals<Pick<Glicko2PeriodResult, keyof Glicko2State>, Glicko2State> = true;
const pinStartRow: Equals<StartSeat['row'], RatingRowLike | null> = true;
const pinAppliedRatings: Equals<AppliedGame['ratings'][number]['row'], RatingRow> = true;

// ---- m13's ledger shape (hosted/src/ledger/types.ts on m13/main, extracted 2026-10-21), copied here: it must fit LedgerGameRecord ------------------
interface M13Placement {
  seat: 1 | 2 | 3 | 4; name: string; place: 1 | 2 | 3 | 4; loss: Exclude<LossCode, 'limit'> | null; lossRule: string | null; outTurn: number | null;
  player: string; session: string; account: string | null; deckHash: string; outOrder: number | null; timeUsedMs: number; timeouts: number; disconnectedMs: number;
}
interface M13GameRecord {
  game: string; format: string; variant: string | null; seats: 2 | 3 | 4; source: 'listed' | 'private' | 'matched'; ranked: false;
  outcome: 'win' | 'draw' | 'void'; reason: string; turns: number; actions: number; startedAt: string; endedAt: string; engineBuild: string;
  placements: M13Placement[]; seatActions?: { seat: 1 | 2 | 3 | 4; actions: number }[];
}
const pinM13Record: M13GameRecord extends LedgerGameRecord ? true : false = true;
const pinM13Placement: M13Placement extends LedgerPlacement ? true : false = true;

// ---- the PostgreSQL seam (13.7): the shape of m14's AccountsSql, so the one SqlClient of hosted serves both stores ------------------------------
const pinSql: Equals<LadderSql, AccountsSql> = true;
const pinSqlQueryable: Equals<LadderSqlQueryable, AccountsSqlQueryable> = true;
const pinSqlResult: Equals<LadderSqlResult<{ n: number }>, AccountsSqlResult<{ n: number }>> = true;
const pinSqlFits: [AccountsSql extends LadderSql ? true : false, LadderSql extends AccountsSql ? true : false] = [true, true];

describe('M15-1: LADDER_STORE_METHODS (13.3)', () => {
  it('lists every method of LadderStore exactly once, and is frozen', () => {
    expect([pinStore, pinStoreList]).toEqual([true, true]);
    expect(new Set(LADDER_STORE_METHODS).size).toBe(LADDER_STORE_METHODS.length);
    expect([...LADDER_STORE_METHODS].sort()).toEqual([...STORE].sort());
    expect(LADDER_STORE_METHODS).toHaveLength(36);
    expect(Object.isFrozen(LADDER_STORE_METHODS)).toBe(true);
  });
});

describe('M15-1: the service, matcher, checker and ledger interfaces (13.4, 13.5)', () => {
  it('have exactly the methods of the design (type pins)', () => {
    expect([pinService, pinMatcher, pinChecker, pinLedger, pinContext]).toEqual([true, true, true, true, true]);
    expect(SERVICE).toHaveLength(23);
    expect(MATCHER).toHaveLength(10);
  });

  it('the reason codes agree (8.2, 8.3, 9.7, 13.6)', () => {
    expect([pinSkip, pinNotRated, pinIntake, pinRefusal, pinEligibility, pinCapKind]).toEqual([true, true, true, true, true, true]);
  });

  it('the rows extend what they say (13.1-13.3)', () => {
    expect([pinRatingRow, pinAppliedSeat, pinPeriod, pinStartRow, pinAppliedRatings]).toEqual([true, true, true, true, true]);
  });

  it('m13\'s GameRecord and Placement fit the ladder\'s structural copies (D2)', () => {
    expect([pinM13Record, pinM13Placement]).toEqual([true, true]);
    const record: M13GameRecord = {
      game: '01JBZ0000000000000000000GA', format: 'standard', variant: null, seats: 2, source: 'matched', ranked: false, outcome: 'win', reason: 'life',
      turns: 9, actions: 120, startedAt: '2026-10-15T12:00:00.000Z', endedAt: '2026-10-15T12:20:00.000Z', engineBuild: 'test',
      placements: [
        { seat: 1, name: 'A', place: 1, loss: null, lossRule: null, outTurn: null, player: 'p1', session: 's1', account: null, deckHash: 'h1', outOrder: null, timeUsedMs: 1, timeouts: 0, disconnectedMs: 0 },
        { seat: 2, name: 'B', place: 2, loss: 'life', lossRule: 'CR 704.5a', outTurn: 9, player: 'p2', session: 's2', account: null, deckHash: 'h2', outOrder: 1, timeUsedMs: 1, timeouts: 0, disconnectedMs: 0 },
      ],
    };
    const ours: LedgerGameRecord = record;
    expect(ours.ranked).toBe(false);
    expect(ours.ladder).toBeUndefined();
    expect(ours.cap).toBeUndefined();
  });
});

describe('M15-1: the PostgreSQL seam (13.7)', () => {
  it('LadderSql has m14\'s AccountsSql\'s shape (type pins), and schema ladder is at version 1', () => {
    expect([pinSql, pinSqlQueryable, pinSqlResult, ...pinSqlFits]).toEqual([true, true, true, true, true]);
    expect(LADDER_SCHEMA_VERSION).toBe(1);
  });
});

describe('M15-1: NO_ABUSE_CHECKS (13.4)', () => {
  it('files nothing from any check, and is frozen', async () => {
    const ctx = { now: '2026-10-15T12:00:00.000Z' } as unknown as AbuseContext;
    expect(await NO_ABUSE_CHECKS.afterGame({} as AppliedGame, ctx)).toEqual([]);
    expect(await NO_ABUSE_CHECKS.afterMiss('acc_00000000000000000000000000', ['2026-10-15T12:00:00.000Z'], ctx)).toEqual([]);
    expect(await NO_ABUSE_CHECKS.daily([{ ladder: '1v1-standard', season: '2026-09' }], ctx)).toEqual([]);
    expect(Object.isFrozen(NO_ABUSE_CHECKS)).toBe(true);
  });
});
