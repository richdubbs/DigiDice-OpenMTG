/**
 * M15-1: the constants of design 13 pinned (17.1): LADDERS, GLICKO2, WENGLIN, the tiers, the seasons, LEADERBOARD_K, the loss codes, the limits and
 * DEFAULT_RANKED_POLICY, each against the value the design gives, copied here by hand; the derived ones (19.302 points per μ, the drift) against the
 * formulas that define them; and every object and array frozen.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ID_SHAPE, BADGE_CAREER_GAMES, DEFAULT_RANKED_POLICY, DEFAULT_TIER_FLOORS, DELETED_PLAYER_NAME, GLICKO2, LADDER_IDS, LADDER_LIMITS, LADDERS,
  LEADERBOARD_K, LOSS_CODES, SEASON_BADGE_GAMES, SEASON_ID, SEASON_RESET, TIER_DEMOTION_BUFFER, TIER_IDS, TIER_NAMES, WENGLIN,
  type LadderDef, type LadderId, type LossCode, type RankedMatchPolicy, type TierId,
} from '@openmtg/ladder';
import type { Equals } from '../support/types';

const pinLadderId: Equals<LadderId, '1v1-standard' | '1v1-pioneer' | '1v1-pauper' | 'pod-commander'> = true;
const pinTierId: Equals<TierId, 'wire' | 'circuit' | 'pulse' | 'arc' | 'laser' | 'prism'> = true;
const pinLossCode: Equals<
  LossCode,
  'life' | 'emptyLibrary' | 'poison' | 'commanderDamage' | 'effect' | 'opponentWon' | 'concession' | 'left' | 'timeout' | 'disconnect' | 'draw' | 'limit'
> = true;

/** Section 3's table and 13.1's literal, copied by hand. */
const LADDER_TABLE: Record<LadderId, LadderDef> = {
  '1v1-standard': { id: '1v1-standard', format: 'standard', seats: [2], bestOf: 1, model: 'glicko2', placementGames: 10, provisionalDeviation: 120, leaderboardGames: 10 },
  '1v1-pioneer': { id: '1v1-pioneer', format: 'pioneer', seats: [2], bestOf: 1, model: 'glicko2', placementGames: 10, provisionalDeviation: 120, leaderboardGames: 10 },
  '1v1-pauper': { id: '1v1-pauper', format: 'pauper', seats: [2], bestOf: 1, model: 'glicko2', placementGames: 10, provisionalDeviation: 120, leaderboardGames: 10 },
  'pod-commander': { id: 'pod-commander', format: 'commander', seats: [4, 3], bestOf: 1, model: 'wenglin', placementGames: 10, provisionalDeviation: 120, leaderboardGames: 10 },
};

describe('M15-1: ladders (3)', () => {
  it('four ladders, in order, as the table gives them', () => {
    expect([pinLadderId]).toEqual([true]);
    expect(LADDER_IDS).toEqual(['1v1-standard', '1v1-pioneer', '1v1-pauper', 'pod-commander']);
    expect(LADDERS).toEqual(LADDER_TABLE);
    expect(Object.keys(LADDERS)).toEqual([...LADDER_IDS]);
    for (const id of LADDER_IDS) expect(LADDERS[id].id).toBe(id);
  });

  it('1v1 ladders are Glicko-2 on two seats, the pod Weng-Lin on 4 then 3', () => {
    for (const id of LADDER_IDS) {
      const d = LADDERS[id];
      expect(d.model, id).toBe(id.startsWith('1v1-') ? 'glicko2' : 'wenglin');
      expect(d.seats, id).toEqual(d.model === 'glicko2' ? [2] : [4, 3]);
    }
  });
});

describe('M15-1: seats, places and loss codes (13.1, m13 7, 8.5)', () => {
  it('m13\'s eleven loss codes in its order, then limit', () => {
    expect([pinLossCode]).toEqual([true]);
    expect(LOSS_CODES).toEqual([
      'life', 'emptyLibrary', 'poison', 'commanderDamage', 'effect', 'opponentWon', 'concession', 'left', 'timeout', 'disconnect', 'draw', 'limit',
    ]);
    expect(new Set(LOSS_CODES).size).toBe(LOSS_CODES.length);
  });
});

describe('M15-1: rating constants (4.1, 5.2)', () => {
  it('GLICKO2: the paper\'s defaults, the bounds, time away and the day', () => {
    expect(GLICKO2).toEqual({
      r0: 1500, rd0: 350, vol0: 0.06, tau: 0.5, scale: 173.7178, epsilon: 0.000001, maxIterations: 100, rdMin: 50, rdMax: 350, volMax: 0.1,
      idleVolPerDay: 0.06, periodMs: 86_400_000,
    });
    // 400 / ln 10, to the 4 decimals the paper uses
    expect(GLICKO2.scale).toBeCloseTo(400 / Math.LN10, 4);
  });

  it('WENGLIN: openskill\'s defaults, c_ref 9, the drift and the 19.302 display scale', () => {
    expect(WENGLIN).toEqual({ mu0: 25, sigma0: 25 / 3, beta: 25 / 6, tau: 25 / 300, kappa: 0.0001, cRef: 9, driftPerDay: 0.2916, displayScale: 173.7178 / 9 });
    expect(WENGLIN.displayScale).toBe(GLICKO2.scale / WENGLIN.cRef);
    expect(WENGLIN.displayScale).toBeCloseTo(19.302, 3);
    expect(WENGLIN.driftPerDay).toBeCloseTo((GLICKO2.idleVolPerDay * WENGLIN.cRef) ** 2, 12);
  });
});

describe('M15-1: what players see (6, 10.1)', () => {
  it('six tiers with our own names, five floors, the buffer and the leaderboard key', () => {
    expect([pinTierId]).toEqual([true]);
    expect(TIER_IDS).toEqual(['wire', 'circuit', 'pulse', 'arc', 'laser', 'prism']);
    expect(TIER_NAMES).toEqual({ wire: 'Wire', circuit: 'Circuit', pulse: 'Pulse', arc: 'Arc', laser: 'Laser', prism: 'Prism' });
    expect(Object.keys(TIER_NAMES)).toEqual([...TIER_IDS]);
    expect(DEFAULT_TIER_FLOORS).toEqual([1300, 1425, 1550, 1675, 1800]);
    expect(DEFAULT_TIER_FLOORS).toHaveLength(TIER_IDS.length - 1);
    expect(TIER_DEMOTION_BUFFER).toBe(25);
    expect(LEADERBOARD_K).toBe(2);
  });

  it('no tier name is Arena\'s or Wizards\' (owner rule): none of the names of their ranked ladders', () => {
    const theirs = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'mythic'];
    for (const n of Object.values(TIER_NAMES)) expect(theirs).not.toContain(n.toLowerCase());
  });
});

describe('M15-1: seasons (7)', () => {
  it('the id pattern, the soft reset and the badge minimums', () => {
    expect(SEASON_ID.source).toBe('^\\d{4}-(0[1-9]|1[0-2])$');
    for (const s of ['2026-01', '2026-12', '2028-02']) expect(SEASON_ID.test(s), s).toBe(true);
    for (const s of ['2026-00', '2026-13', '2026-1', '26-01', '2026-01-01', ' 2026-01']) expect(SEASON_ID.test(s), s).toBe(false);
    expect(SEASON_RESET).toEqual({ pull: 0.05, deviationBump: 60 });
    expect(SEASON_BADGE_GAMES).toBe(5);
    expect(BADGE_CAREER_GAMES).toBe(55);
  });
});

describe('M15-1: limits (13.6) and the account values copied from milestone 14', () => {
  it('LADDER_LIMITS', () => {
    expect(LADDER_LIMITS).toEqual({ leaderboardPage: 50, leaderboardPageMax: 100, historyPage: 50, cursorMax: 200, leaderboardTopRanks: 100 });
  });

  it('the account id shape and the deleted player\'s name (pinned against accounts in accounts.test.ts)', () => {
    expect(ACCOUNT_ID_SHAPE.source).toBe('^acc_[0-7][0-9A-HJKMNP-TV-Z]{25}$');
    expect(ACCOUNT_ID_SHAPE.flags).toBe('');
    expect(DELETED_PLAYER_NAME).toBe('Deleted player');
  });
});

describe('M15-1: DEFAULT_RANKED_POLICY (9, 13.5, 19.9)', () => {
  it('has the values M15-1 lands', () => {
    const want: RankedMatchPolicy = {
      windowStart: 100, windowStep: 50, windowEveryMs: 15_000, windowCap1v1: 400, windowCapPod: 500, everyoneAfterMs: 300_000, rematchGames: 3,
      rematchRelaxMs: 600_000, placementMixCost: 50, repeatedPairCost: 100, podThreeAfterMs: 120_000, podCandidates: 12, perAddress: 2,
    };
    expect(DEFAULT_RANKED_POLICY).toEqual(want);
    expect(Object.keys(DEFAULT_RANKED_POLICY).sort()).toEqual(Object.keys(want).sort());
  });

  it('agrees with the decisions: ±100, +50 every 15 s, at most ±400 (pods 500), everyone after 5 minutes, 3 after 2 minutes, relax after 10', () => {
    const p = DEFAULT_RANKED_POLICY;
    expect((p.windowCap1v1 - p.windowStart) / p.windowStep * p.windowEveryMs).toBe(90_000);
    expect(p.everyoneAfterMs).toBe(5 * 60_000);
    expect(p.podThreeAfterMs).toBe(2 * 60_000);
    expect(p.rematchRelaxMs).toBe(10 * 60_000);
  });
});

describe('M15-1: the constants cannot change at run time', () => {
  it('every constant object and array is frozen, nested ones too', () => {
    const frozen: [string, unknown][] = [
      ['LADDER_IDS', LADDER_IDS], ['LADDERS', LADDERS], ['LOSS_CODES', LOSS_CODES], ['GLICKO2', GLICKO2], ['WENGLIN', WENGLIN], ['TIER_IDS', TIER_IDS],
      ['TIER_NAMES', TIER_NAMES], ['DEFAULT_TIER_FLOORS', DEFAULT_TIER_FLOORS], ['SEASON_RESET', SEASON_RESET], ['LADDER_LIMITS', LADDER_LIMITS],
      ['DEFAULT_RANKED_POLICY', DEFAULT_RANKED_POLICY],
      ...LADDER_IDS.flatMap((id): [string, unknown][] => [[`LADDERS.${id}`, LADDERS[id]], [`LADDERS.${id}.seats`, LADDERS[id].seats]]),
    ];
    for (const [name, v] of frozen) expect(Object.isFrozen(v), name).toBe(true);
    expect(() => {
      (GLICKO2 as { tau: number }).tau = 1;
    }).toThrow(TypeError);
    expect(GLICKO2.tau).toBe(0.5);
  });
});
