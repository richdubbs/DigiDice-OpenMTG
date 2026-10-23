/**
 * M15-6: the knobs the simulation sweeps (design 16, M15-6; 4.4, 5.2, 7, 9, 10.1, 6.3). Each default is the package's own constant, read from it, so
 * a run with DEFAULT_SIM_PARAMS is the ladder as built; test/sim/model.test.ts pins that the simulation's rating math then equals the package's to
 * the last bit.
 *
 * Not swept (fixed by the design): Glicko-2's τ (0.5; with one game per period it hardly matters, 4.4), the RD bounds and the volatility cap, the
 * pod μ0, σ0, β and κ, the placement games, the provisional limit, the leaderboard games and the demotion buffer. The badge's game counts are
 * parameters too, for the one check that tries them (docs/perf/m15-ladder-sim.md, the gaming scenarios against simulated opponents).
 */
import {
  BADGE_CAREER_GAMES, DEFAULT_TIER_FLOORS, GLICKO2, LADDERS, LEADERBOARD_K, SEASON_BADGE_GAMES, SEASON_RESET, WENGLIN, type LadderId, type RatingModel,
} from '../../src/api';
import { DEFAULT_RANKED_POLICY, type RankedMatchPolicy } from '../../src/match/api';

export interface SimParams {
  /** Glicko-2's initial volatility σ0, the knob of 4.4 (every stored σ stays within about 0.001 of it). */
  vol0: number;
  /** RD growth per day away (4.3 step 2); pods drift by (idleVolPerDay × c_ref)² μ² per day, the same growth in shown points (5.2). */
  idleVolPerDay: number;
  /** The pod dynamics τ added to σ² before every pod (5.2). */
  podTau: number;
  /** The season reset's pull toward 1500 (7). */
  pull: number;
  /** The season reset's deviation bump, shown points in quadrature (7). */
  deviationBump: number;
  /** The leaderboard key: standing = round(display − K × deviation) (10.1). */
  leaderboardK: number;
  /** Tier floors of the 1v1 ladders and of the pod ladder (6.3). */
  floors1v1: readonly number[];
  floorsPod: readonly number[];
  /** The badge's post-placement season games and career games (7: SEASON_BADGE_GAMES, BADGE_CAREER_GAMES). */
  badgeSeasonGames: number;
  badgeCareerGames: number;
  /** The rated matcher's policy (9). */
  policy: Readonly<RankedMatchPolicy>;
}

export const DEFAULT_SIM_PARAMS: Readonly<SimParams> = Object.freeze({
  vol0: GLICKO2.vol0,
  idleVolPerDay: GLICKO2.idleVolPerDay,
  podTau: WENGLIN.tau,
  pull: SEASON_RESET.pull,
  deviationBump: SEASON_RESET.deviationBump,
  leaderboardK: LEADERBOARD_K,
  floors1v1: DEFAULT_TIER_FLOORS,
  floorsPod: DEFAULT_TIER_FLOORS,
  badgeSeasonGames: SEASON_BADGE_GAMES,
  badgeCareerGames: BADGE_CAREER_GAMES,
  policy: DEFAULT_RANKED_POLICY,
});

/** The defaults with some knobs changed (a new frozen object). */
export function simParams(over: Partial<SimParams> = {}): Readonly<SimParams> {
  return Object.freeze({ ...DEFAULT_SIM_PARAMS, ...over });
}

/** The two ladders the simulation runs: one of the three identical 1v1 ladders, and the pod ladder. */
export type SimLadder = Extract<LadderId, '1v1-standard' | 'pod-commander'>;
export const SIM_LADDERS: readonly SimLadder[] = ['1v1-standard', 'pod-commander'];

export function modelOf(ladder: SimLadder): RatingModel {
  return LADDERS[ladder].model;
}

export function floorsOf(p: Readonly<SimParams>, ladder: SimLadder): readonly number[] {
  return modelOf(ladder) === 'glicko2' ? p.floors1v1 : p.floorsPod;
}

/** A short label of the knobs that differ from the defaults ("σ0 0.05, pull 0.1"), for the report's tables. */
export function describeParams(p: Readonly<SimParams>): string {
  const d = DEFAULT_SIM_PARAMS;
  const parts: string[] = [];
  if (p.vol0 !== d.vol0) parts.push(`σ0 ${p.vol0}`);
  if (p.idleVolPerDay !== d.idleVolPerDay) parts.push(`idleVolPerDay ${p.idleVolPerDay}`);
  if (p.podTau !== d.podTau) parts.push(`pod τ ${(p.podTau * 300).toFixed(0)}/300`);
  if (p.pull !== d.pull) parts.push(`pull ${p.pull}`);
  if (p.deviationBump !== d.deviationBump) parts.push(`bump ${p.deviationBump}`);
  if (p.leaderboardK !== d.leaderboardK) parts.push(`K ${p.leaderboardK}`);
  if (p.floors1v1.join() !== d.floors1v1.join()) parts.push(`1v1 floors ${p.floors1v1.join('/')}`);
  if (p.floorsPod.join() !== d.floorsPod.join()) parts.push(`pod floors ${p.floorsPod.join('/')}`);
  if (p.badgeSeasonGames !== d.badgeSeasonGames) parts.push(`badge season games ${p.badgeSeasonGames}`);
  if (p.badgeCareerGames !== d.badgeCareerGames) parts.push(`badge career games ${p.badgeCareerGames}`);
  if (p.policy !== d.policy) {
    const changed = (Object.keys(d.policy) as (keyof RankedMatchPolicy)[]).filter((k) => p.policy[k] !== d.policy[k]);
    for (const k of changed) parts.push(`${k} ${p.policy[k]}`);
  }
  return parts.length === 0 ? 'defaults' : parts.join(', ');
}
