/**
 * M15-1: the entry points (design 13 intro, 16, 17.1). `@openmtg/ladder/api` exports exactly the browser-safe values of 13.1 (constants and pure
 * functions; types are erased); `@openmtg/ladder` exports all of them as the same objects, plus every server-side entry point: the ids, the
 * contract constants, and the factories and functions of the stub files (M15-7's PostgreSQL opener among them). Not the command line.
 */
import { describe, expect, it } from 'vitest';
import * as api from '@openmtg/ladder/api';
import * as ladder from '@openmtg/ladder';

const API_CONSTANTS = [
  'LADDER_IDS', 'LADDERS', 'ACCOUNT_ID_SHAPE', 'DELETED_PLAYER_NAME', 'LOSS_CODES', 'GLICKO2', 'WENGLIN', 'LEADERBOARD_K', 'TIER_IDS', 'TIER_NAMES',
  'DEFAULT_TIER_FLOORS', 'TIER_DEMOTION_BUFFER', 'SEASON_ID', 'SEASON_RESET', 'SEASON_BADGE_GAMES', 'BADGE_CAREER_GAMES', 'LADDER_LIMITS',
];
const API_FUNCTIONS = [
  'isLadderId', 'validPlaces', 'initialState', 'glicko2Period', 'glicko2RdAt', 'glicko2Expected', 'rateOneVsOne', 'wenglinSigmaAt', 'ratePod',
  'plackettLuceTerms', 'displayRating', 'displayDeviation', 'isProvisional', 'provisionalFrom', 'standingOf', 'tierOf', 'tierAfter', 'badgeTier',
  'isSeasonId', 'seasonOf', 'seasonBounds', 'nextSeason', 'seasonReset', 'ratingNow', 'capShareThreshold', 'capVerdict', 'stakesOneVsOne', 'stakesPod',
];
const SERVER_CONSTANTS = [
  'LADDER_STORE_METHODS', 'DEFAULT_RANKED_POLICY', 'NO_ABUSE_CHECKS', 'ABUSE_REPORT_REASON', 'ULID', 'DELETED_SORT_KEY', 'DELETED_SORT_KEY_PREFIX',
  'LADDER_SCHEMA_VERSION',
];
const SERVER_FUNCTIONS = [
  'newUlid', 'newMatchId', 'newReportId', 'newDeletedSortKey', 'isUlid', 'isDeletedSortKey',
  'toRatedGame', 'createLadderService', 'createRatedMatcher', 'rankedWindow', 'createAbuseChecker', 'openPostgresLadderStore',
];

describe('M15-1: @openmtg/ladder/api', () => {
  it('exports exactly the constants and pure functions of 13.1', () => {
    expect(Object.keys(api).sort()).toEqual([...API_CONSTANTS, ...API_FUNCTIONS].sort());
    for (const f of API_FUNCTIONS) expect(typeof (api as Record<string, unknown>)[f], f).toBe('function');
    for (const c of API_CONSTANTS) expect((api as Record<string, unknown>)[c], c).toBeDefined();
  });
});

describe('M15-1: @openmtg/ladder', () => {
  it('re-exports the whole browser-safe contract, as the same objects', () => {
    const root = ladder as Record<string, unknown>;
    for (const k of Object.keys(api)) expect(root[k], k).toBe((api as Record<string, unknown>)[k]);
  });

  it('exports every server-side entry point (the stub files are re-exported with export *, so their owners may add more)', () => {
    const root = ladder as Record<string, unknown>;
    for (const f of SERVER_FUNCTIONS) expect(typeof root[f], f).toBe('function');
    for (const c of SERVER_CONSTANTS) expect(root[c], c).toBeDefined();
  });

  it('does not export the command line', () => {
    expect((ladder as Record<string, unknown>)['main']).toBeUndefined();
  });
});
