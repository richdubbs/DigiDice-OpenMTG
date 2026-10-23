/**
 * M15-1's: every value of `@openmtg/ladder/api` (design 13.1), in a leaf module that takes no value from any other module. ../api re-exports each
 * of them by name, so importers see no difference.
 *
 * INTERFACE CHANGE (layout only, M15-1): 13.1 writes these constants in api.ts itself. ../api re-exports the parts in this folder (glicko2, wenglin,
 * display, tiers, season, ...), and each part needs these numbers. A part that took them from ../api would close a cycle in which, while the contract
 * loads, the part runs before ../api's body, so a value read at the part's top level (`const { scale } = GLICKO2`) is undefined in a bundle or in
 * its temporal dead zone in Node: milestone 14's review found exactly that (m14 17, finding 1). So the parts take values from here and types from
 * ../api (`import type`); test/m15-1/load.test.ts checks both, and loads the contract with each file first.
 *
 * This file imports types only (erased at run time). Every object and array here is frozen: they are shared by the server, the matcher and the
 * client, and none of them may change at run time (tiers and floors per season are configuration, LadderConfig.tierFloors, not edits of these).
 */
import type { LadderDef, LadderId, TierId } from '../api';

// ---- Ladders (section 3)
export const LADDER_IDS = Object.freeze(['1v1-standard', '1v1-pioneer', '1v1-pauper', 'pod-commander'] as const);

function ladder(d: LadderDef): LadderDef {
  Object.freeze(d.seats);
  return Object.freeze(d);
}

export const LADDERS: Readonly<Record<LadderId, LadderDef>> = Object.freeze({
  '1v1-standard': ladder({ id: '1v1-standard', format: 'standard', seats: [2], bestOf: 1, model: 'glicko2', placementGames: 10, provisionalDeviation: 120, leaderboardGames: 10 }),
  '1v1-pioneer': ladder({ id: '1v1-pioneer', format: 'pioneer', seats: [2], bestOf: 1, model: 'glicko2', placementGames: 10, provisionalDeviation: 120, leaderboardGames: 10 }),
  '1v1-pauper': ladder({ id: '1v1-pauper', format: 'pauper', seats: [2], bestOf: 1, model: 'glicko2', placementGames: 10, provisionalDeviation: 120, leaderboardGames: 10 }),
  'pod-commander': ladder({ id: 'pod-commander', format: 'commander', seats: [4, 3], bestOf: 1, model: 'wenglin', placementGames: 10, provisionalDeviation: 120, leaderboardGames: 10 }),
});

/**
 * The account id's shape (milestone 14 owns it, m14 11.1 `ACCOUNT_ID`; this copy is pinned against accounts' own by a test): "acc_" and 26
 * characters in the ULID shape, all 128 bits random (m14 D22).
 */
export const ACCOUNT_ID_SHAPE = /^acc_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * The name a deleted account's history seats carry (8.7): the text of milestone 14's DELETED_PLAYER_NAME, which is a value and so is copied, not
 * imported (design 2); test/m15-1/accounts.test.ts pins the copy. Addition of M15-1 (13.1 names the words, not the constant).
 */
export const DELETED_PLAYER_NAME = 'Deleted player';

// ---- Seats, places, loss codes (the ledger's, m13 7, plus 'limit', 8.5)
export const LOSS_CODES = Object.freeze([
  'life', 'emptyLibrary', 'poison', 'commanderDamage', 'effect', 'opponentWon', 'concession', 'left', 'timeout', 'disconnect', 'draw', 'limit',
] as const);

// ---- Rating constants (sections 4, 5)
export const GLICKO2 = Object.freeze({
  r0: 1500, rd0: 350, vol0: 0.06, tau: 0.5,
  scale: 173.7178,
  epsilon: 0.000001, maxIterations: 100,
  rdMin: 50, rdMax: 350, volMax: 0.1,
  /** Time away (4.3 step 2): RD grows as if an empty period with this volatility passed per day; the player's own σ plays no part (4.4). */
  idleVolPerDay: 0.06,
  periodMs: 86_400_000,
} as const);

export const WENGLIN = Object.freeze({
  mu0: 25, sigma0: 25 / 3, beta: 25 / 6, tau: 25 / 300, kappa: 0.0001,
  /** c of a 4-player pod of established players (5.2): fixes the display scale and the drift. */
  cRef: 9,
  /** μ² per day of time away: (GLICKO2.idleVolPerDay × cRef)², the 1v1 growth in shown points. */
  driftPerDay: 0.2916,
  /** Shown points per μ: GLICKO2.scale / cRef ≈ 19.302, so a shown gap means the same pairwise chance as in 1v1. */
  displayScale: 173.7178 / 9,
} as const);

// ---- What players see (6.1, 6.3, 10.1)
/** The leaderboard key (6.1, 10.1): standingOf = Math.round(display − LEADERBOARD_K × deviation). Never shown as a rating. */
export const LEADERBOARD_K = 2;

export const TIER_IDS = Object.freeze(['wire', 'circuit', 'pulse', 'arc', 'laser', 'prism'] as const);
export const TIER_NAMES: Readonly<Record<TierId, string>> = Object.freeze({
  wire: 'Wire', circuit: 'Circuit', pulse: 'Pulse', arc: 'Arc', laser: 'Laser', prism: 'Prism',
});
/** The lowest shown rating of Circuit, Pulse, Arc, Laser and Prism (Wire is below the first). */
export const DEFAULT_TIER_FLOORS: readonly number[] = Object.freeze([1300, 1425, 1550, 1675, 1800]);
export const TIER_DEMOTION_BUFFER = 25;

// ---- Seasons (section 7)
/** 'YYYY-MM' (a UTC calendar month). */
export const SEASON_ID = /^\d{4}-(0[1-9]|1[0-2])$/;
export const SEASON_RESET = Object.freeze({ pull: 0.05, deviationBump: 60 } as const);
/**
 * Post-placement games in the season, and career games in the ladder, that a badge needs (7). Career games 55, not the design's 30 (M15-6,
 * docs/perf/m15-ladder-sim.md): against the opponents the matcher gives, 30 let gaming scenarios S1 (c) and S2 (b) through (2.89% and 12.66%,
 * bounds 1% and 5%); 55 is the smallest value tried that meets both (0.76%, 3.96%).
 */
export const SEASON_BADGE_GAMES = 5;
export const BADGE_CAREER_GAMES = 55;

// ---- Page sizes and other limits (13.6)
export const LADDER_LIMITS = Object.freeze({
  leaderboardPage: 50, leaderboardPageMax: 100, historyPage: 50, cursorMax: 200, leaderboardTopRanks: 100,
} as const);
