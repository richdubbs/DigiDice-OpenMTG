/**
 * M15-6: the measurements of the work-package row (design 16, M15-6) and of 17.11, shared by the slow suite (test/sim/*.test.ts) and the report
 * script (scripts/simulate.ts, which writes docs/perf/m15-ladder-sim.md's numbers). Every function is deterministic: a seed names every random
 * stream, the clock is the simulation's own, and only the wall times it reports vary between machines.
 *
 *  - `stationary`: a population of synthetic players from a cold start through eight monthly seasons (resets on): rating error after k games or
 *    pods, the stationary rating distribution and tier shares by games per month, drift, the cold start's first leaderboard rows, waits in the
 *    session model, rematches, the leaderboard order by LEADERBOARD_K, and a panel of established opponents for the solo scenarios.
 *  - `waitsByPopulation`: always-online populations of fixed sizes (waits by population, the window sweep).
 *  - `scenarioSet`: the season shortfall and the gaming scenarios S1-S3 (test/sim/scenarios.ts) for one model and set of knobs.
 *  - `honestReports`: M15-5's checks over honest play (and, with abusers, their detection), under the default thresholds and candidate ones.
 *  - `floorAdvice`: tier floors for the pod ladder from the two stationary distributions.
 */
import type { AccountId } from '../../src/accounts';
import { TIER_IDS, tierOf, type RatingModel } from '../../src/api';
import type { AbuseKind, AbuseRules } from '../../src/abuse/types';
import { DEFAULT_RANKED_POLICY, type RankedMatchPolicy } from '../../src/match/api';
import { replayAbuse, type ReportTally } from './abuse';
import { DESIGN_ABUSE_RULES } from './recommend';
import { DAY_MS, seasonEndMs } from './model';
import { DEFAULT_SIM_PARAMS, floorsOf, modelOf, simParams, type SimLadder, type SimParams } from './params';
import { COLD_DAYS, LAUNCH_MS, Population, type PopulationOptions, type PopulationResult } from './population';
import {
  BOUNDS, honestMedianStanding, honestSeasons, movement, scenarioS1, scenarioS2, scenarioS3, shortfallTable, type MovementRow, type S1Result,
  type S2Row, type S3Result, type ShortfallRow,
} from './scenarios';
import { matchedOpponents, metOpponents, type MetRecord, type OpponentPool } from './solo';
import type { Endings } from './truth';
import { mean, median, quantile, sd, share, spearman } from './stats';

/** The 17.11 targets and section 7's bounds, in one place. */
export const TARGETS = Object.freeze({
  ...BOUNDS,
  /** 17.11: median |rating − skill| after 30 games (1v1) and after 30 pods, in shown points, on the stationary distribution. */
  error30: { glicko2: 60, wenglin: 80 } as Readonly<Record<RatingModel, number>>,
  /** 17.11: with 50 players online, the median 1v1 wait in ms. */
  wait50Ms: 30_000,
  /** 17.11: honest play files no oneSided or sandbagging report, and fewer than 1 in 1,000 accounts get any report. */
  honestAccountShare: 0.001,
  /** 17.11: a matcher tick with 2,000 entries, ms on the owner's machine (reported). */
  tickMs: 50,
});

/**
 * The run's months: the launch (2027-01-01) through 2027-08. The run ends on 2027-09-03, so 2027-08 closes at the sweep of 2027-09-01 or, when a
 * game from before its end is still running then (a pod across midnight), at the next day's (7).
 */
export const STATIONARY_DAYS = Math.round((Date.UTC(2027, 8, 3) - LAUNCH_MS) / DAY_MS);
/** Seasons from this one on are the stationary distribution (the launch and its first month excluded). */
export const STATIONARY_FROM = '2027-03';
/** Accounts created from this day of the run on joined an established ladder (2027-03-01). */
export const LATE_FROM_DAY = Math.round((Date.UTC(2027, 2, 1) - LAUNCH_MS) / DAY_MS);
export const ACTIVITY: readonly number[] = [5, 10, 30, 100];
export const ERROR_AT: readonly number[] = [5, 10, 15, 20, 30, 50, 100];
export const LEADERBOARD_KS: readonly number[] = [1, 1.5, 2, 2.5, 3];

export interface ErrorSummary { n: number; median: number; p90: number; meanSigned: number; deviation: number }
export interface ErrorRow { k: number; cold: ErrorSummary; late: ErrorSummary }

export interface TierRow {
  gpm: number;
  /** Player-seasons placed at the season's end (any game in the season), months 3-8. */
  n: number;
  /** Shares of the shown rating's tier at the season's end (fresh, no buffer), Wire to Prism. */
  tiers: number[];
  /** Shares of the season badge among those seasons (null: no badge), Wire to Prism, then none. */
  badges: number[];
  /** Median shown deviation at the season's end, and median games in the season. */
  deviation: number;
  games: number;
  /** Mean display − skill (the season-end shortfall of this activity, every skill). */
  bias: number;
}

export interface LeaderboardRow {
  k: number;
  /** Spearman's rank correlation of the final standing with the true skill, of eligible players, months 3-8 (mean over seasons). */
  spearman: number;
  /** Share of the top 10% of each final board that play 100 games a month, and that play 10 or fewer. */
  topHeavy: number;
  topLight: number;
  /** Mean |rank by standing − rank by shown rating|, as a share of the board. */
  displacement: number;
}

export interface StationaryResult {
  ladder: SimLadder;
  params: string;
  seed: string;
  players: number;
  accounts: number;
  days: number;
  games: number;
  wallMs: number;
  errors: ErrorRow[];
  tiers: TierRow[];
  /** All placed player-seasons of months 3-8: shown rating mean, SD and quantiles (5, 25, 50, 75, 95), the skill SD, their correlation. */
  dist: { n: number; mean: number; sd: number; q: number[]; skillSd: number; corr: number; all: number[] };
  /**
   * Per closed season, over the placed players with games in it: the mean shown rating and mean skill, their SDs, and the slope of the shown rating
   * on the skill (above 1: the rating scale is stretched against the true one).
   */
  drift: { season: string; meanDisplay: number; meanSkill: number; sd: number; skillSd: number; slope: number; n: number }[];
  /** The S1/S2 yardstick in the population: the median final standing of honest players within 50 of the Laser floor in skill, 30 games a month. */
  baseline: { n: number; median: number };
  /** The cold start (season 2027-01): hours from the launch until the live board held 1, 10, 50 and 100 rows; the career games at which the launch
   * cohort's accounts first stood on it (median, 10th and 90th percentile) and the share of them that did within the season. */
  board: { fillHours: (number | null)[]; firstGames: { median: number; p10: number; p90: number }; firstShare: number; firstDays: number };
  /** The session model's waits (every matched entry, ms) and the accounts online (hourly samples). */
  waits: { median: number; p90: number; onlineMedian: number; queuedMedian: number; giveUpShare: number };
  /** Games that were a rematch of a last-3 game (under the relaxation), matches formed relaxed or with a member past 'everyone', pods of 3. */
  rematchShare: number;
  relaxedShare: number;
  everyoneShare: number;
  threeShare: number;
  leaderboard: LeaderboardRow[];
  /** Every seat's opponents from the stationary period on, for the solo scenarios' met opponents. */
  met: MetRecord[];
  /** Placed player-seasons of months 3-8: games a month, career games by the season's last game, and whether the season gave a badge. */
  badgeSeasons: { gpm: number; careerGames: number; badge: boolean }[];
}

function summarize(abs: number[], signed: number[], deviation: number[]): ErrorSummary {
  return { n: abs.length, median: median(abs), p90: quantile(abs, 0.9), meanSigned: mean(signed), deviation: median(deviation) };
}

export interface StationaryOptions {
  players?: number;
  days?: number;
  seed?: string;
  params?: Readonly<SimParams>;
  /** Extra population options (activity, churn, ...). */
  population?: Partial<PopulationOptions>;
}

/** A population from the launch through eight seasons (design 17.11's stationary distribution, monthly resets on). */
export async function stationary(ladder: SimLadder, o: StationaryOptions = {}): Promise<StationaryResult> {
  const players = o.players ?? 1000;
  const days = o.days ?? STATIONARY_DAYS;
  const seed = o.seed ?? 'stationary';
  const params = o.params ?? DEFAULT_SIM_PARAMS;
  const pop = new Population({
    ladder, players, seed, days, params, activity: ACTIVITY, churnPerMonth: 0.1, arrivalDays: 14, abuse: false, errorAt: ERROR_AT,
    recordMetFromMs: Date.UTC(2027, 2, 1), ...o.population,
  });
  const r = await pop.run();
  return summarizeStationary(ladder, r, seed, players, days, floorsOf(params, ladder));
}

export function summarizeStationary(
  ladder: SimLadder, r: PopulationResult, seed: string, players: number, days: number, floors: readonly number[],
): StationaryResult {
  const p = r.params;
  // rating error after k games, the launch cohort and the accounts that joined an established ladder
  const errors: ErrorRow[] = [];
  for (const [k, e] of r.errors) {
    const pick = (f: (day: number) => boolean) => {
      const idx = e.createdDay.flatMap((d, i) => (f(d) ? [i] : []));
      return summarize(idx.map((i) => e.abs[i]!), idx.map((i) => e.signed[i]!), idx.map((i) => e.deviation[i]!));
    };
    errors.push({ k, cold: pick((d) => d < COLD_DAYS), late: pick((d) => d >= LATE_FROM_DAY) });
  }
  // the stationary seasons
  const seasons = r.seasons.filter((s) => s.season >= STATIONARY_FROM);
  const placed = seasons.flatMap((s) => s.stats.filter((x) => x.display !== null).map((x) => ({ ...x, season: s.season })));
  const tiers: TierRow[] = ACTIVITY.map((gpm) => {
    const xs = placed.filter((x) => x.gpm === gpm);
    const tierShares = TIER_IDS.map((t) => share(xs, (x) => tierOf(x.display!, floors) === t));
    const badgeShares = [...TIER_IDS.map((t) => share(xs, (x) => x.badge === t)), share(xs, (x) => x.badge === null)];
    return {
      gpm, n: xs.length, tiers: tierShares, badges: badgeShares, deviation: median(xs.map((x) => x.deviationAtEnd!)), games: median(xs.map((x) => x.games)),
      bias: mean(xs.map((x) => x.display! - x.skill)),
    };
  });
  const displays = placed.map((x) => x.display!);
  const dist = {
    n: displays.length, mean: mean(displays), sd: sd(displays), q: [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => quantile(displays, q)),
    skillSd: sd(placed.map((x) => x.skill)), corr: pearson(displays, placed.map((x) => x.skill)), all: displays,
  };
  const drift = r.seasons.map((s) => {
    const xs = s.stats.filter((x) => x.display !== null);
    const d = xs.map((x) => x.display!);
    const k = xs.map((x) => x.skill);
    return {
      season: s.season, meanDisplay: mean(d), meanSkill: mean(k), sd: sd(d), skillSd: sd(k), slope: (pearson(d, k) * sd(d)) / sd(k), n: xs.length,
    };
  });
  const laser = floors[TIER_IDS.indexOf('laser') - 1]!;
  const yard = placed.filter((x) => x.gpm === 30 && Math.abs(x.skill - laser) <= 50 && x.finalStanding !== null).map((x) => x.finalStanding!);
  const baseline = { n: yard.length, median: median(yard) };
  // the cold start
  const first = r.seasons.find((s) => s.season === '2027-01');
  const cohort = r.players.filter((pl) => pl.createdMs < LAUNCH_MS + COLD_DAYS * DAY_MS);
  const janEnd = seasonEndMs('2027-01');
  const firstIn = cohort.filter((pl) => pl.firstEligibleMs !== null && pl.firstEligibleMs < janEnd);
  const firstGames = firstIn.map((pl) => pl.firstEligibleGames!);
  const board = {
    fillHours: (first?.boardFill ?? [null, null, null, null]).map((x) => (x === null ? null : x / 3_600_000)),
    firstGames: { median: median(firstGames), p10: quantile(firstGames, 0.1), p90: quantile(firstGames, 0.9) },
    firstShare: firstIn.length / Math.max(1, cohort.filter((pl) => pl.createdMs < janEnd).length),
    firstDays: median(firstIn.map((pl) => (pl.firstEligibleMs! - pl.createdMs) / DAY_MS)),
  };
  const waits = {
    median: median(r.waits), p90: quantile(r.waits, 0.9), onlineMedian: median(r.online), queuedMedian: median(r.queued),
    giveUpShare: r.giveUps / Math.max(1, r.waits.length + r.giveUps),
  };
  const leaderboard = LEADERBOARD_KS.map((k) => leaderboardRow(seasons, k));
  return {
    ladder, params: describe(p), seed, players, accounts: r.players.length, days, games: r.games, wallMs: r.wallMs, errors, tiers, dist, drift, baseline, board,
    waits, rematchShare: r.rematches / Math.max(1, r.games), relaxedShare: r.relaxed / Math.max(1, r.matches), everyoneShare: r.everyone / Math.max(1, r.matches),
    threeShare: r.threes / Math.max(1, r.matches), leaderboard, met: r.met,
    badgeSeasons: placed.map((x) => ({ gpm: x.gpm, careerGames: x.careerGames, badge: x.badge !== null })),
  };
}

function describe(p: Readonly<SimParams>): string {
  return p === DEFAULT_SIM_PARAMS ? 'defaults' : 'swept';
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/** The final boards of the stationary seasons with the standing at another K (eligibility does not depend on K, 10.1). */
function leaderboardRow(seasons: PopulationResult['seasons'], k: number): LeaderboardRow {
  const rhos: number[] = [];
  const heavy: number[] = [];
  const light: number[] = [];
  const moves: number[] = [];
  for (const s of seasons) {
    const elig = s.stats.filter((x) => x.finalStanding !== null);
    if (elig.length < 20) continue;
    const standing = elig.map((x) => Math.round(x.display! - k * x.deviationAtEnd!));
    rhos.push(spearman(standing, elig.map((x) => x.skill)));
    const order = elig.map((_, i) => i).sort((i, j) => standing[j]! - standing[i]! || i - j);
    const top = order.slice(0, Math.max(1, Math.round(elig.length / 10)));
    heavy.push(share(top, (i) => elig[i]!.gpm >= 100));
    light.push(share(top, (i) => elig[i]!.gpm <= 10));
    const byDisplay = elig.map((_, i) => i).sort((i, j) => elig[j]!.display! - elig[i]!.display! || i - j);
    const rankDisplay = new Map(byDisplay.map((i, r) => [i, r] as const));
    moves.push(mean(order.map((i, r) => Math.abs(r - rankDisplay.get(i)!))) / elig.length);
  }
  return { k, spearman: mean(rhos), topHeavy: mean(heavy), topLight: mean(light), displacement: mean(moves) };
}

// ---- waits by population ------------------------------------------------------------------------------------------------------------------------

export interface WaitRow {
  online: number;
  matches: number;
  median: number;
  p90: number;
  /** Median shown-rating spread of a match, and its median true-skill gap. */
  spread: number;
  skillGap: number;
  relaxed: number;
  everyone: number;
  threes: number;
  wallMs: number;
}

/** Always-online populations of `online` accounts (everyone queues again 1-5 minutes after a game), `days` days after a day's warm-up. */
export async function waitsByPopulation(
  ladder: SimLadder, online: readonly number[], o: { days?: number; seed?: string; policy?: Readonly<RankedMatchPolicy> } = {},
): Promise<WaitRow[]> {
  const out: WaitRow[] = [];
  const params = o.policy === undefined ? DEFAULT_SIM_PARAMS : simParams({ policy: o.policy });
  for (const n of online) {
    const r = await new Population({
      ladder, players: n, seed: `${o.seed ?? 'waits'}/${n}`, days: 1 + (o.days ?? 2), alwaysOnline: true, warmupDays: 1, churnPerMonth: 0, abuse: false,
      readyMiss: 0.01, params,
    }).run();
    out.push({
      online: n, matches: r.matches, median: median(r.waits), p90: quantile(r.waits, 0.9), spread: median(r.spreads), skillGap: median(r.skillGaps),
      relaxed: r.relaxed / Math.max(1, r.matches), everyone: r.everyone / Math.max(1, r.matches), threes: r.threes / Math.max(1, r.matches), wallMs: r.wallMs,
    });
  }
  return out;
}

/** The window variants the sweep tries (9.2-9.3, 19.9): the defaults, narrower and wider starts, slower and faster widening. */
export const WINDOW_VARIANTS: readonly { name: string; policy: Readonly<RankedMatchPolicy> }[] = [
  { name: 'defaults (±100, +50 / 15 s, cap 400 / 500)', policy: DEFAULT_RANKED_POLICY },
  { name: 'start ±50', policy: { ...DEFAULT_RANKED_POLICY, windowStart: 50 } },
  { name: 'start ±150', policy: { ...DEFAULT_RANKED_POLICY, windowStart: 150 } },
  { name: '+25 / 15 s', policy: { ...DEFAULT_RANKED_POLICY, windowStep: 25 } },
  { name: '+100 / 15 s', policy: { ...DEFAULT_RANKED_POLICY, windowStep: 100 } },
  { name: 'cap 300 / 400', policy: { ...DEFAULT_RANKED_POLICY, windowCap1v1: 300, windowCapPod: 400 } },
  { name: 'everyone after 3 min', policy: { ...DEFAULT_RANKED_POLICY, everyoneAfterMs: 180_000 } },
  { name: 'pods of 3 after 4 min', policy: { ...DEFAULT_RANKED_POLICY, podThreeAfterMs: 240_000 } },
];

// ---- the season measures and the gaming scenarios ------------------------------------------------------------------------------------------

export interface ScenarioSizes { s1: number; s2Groups: number; s3: number; honest: number; shortfall: number }

export const SCENARIO_SIZES: Readonly<Record<'test' | 'report' | 'sweep', Readonly<Record<RatingModel, ScenarioSizes>>>> = Object.freeze({
  report: { glicko2: { s1: 20_000, s2Groups: 8000, s3: 20_000, honest: 800, shortfall: 1200 }, wenglin: { s1: 12_000, s2Groups: 5000, s3: 12_000, honest: 600, shortfall: 800 } },
  test: { glicko2: { s1: 10_000, s2Groups: 4000, s3: 10_000, honest: 400, shortfall: 600 }, wenglin: { s1: 6000, s2Groups: 2500, s3: 6000, honest: 300, shortfall: 400 } },
  sweep: { glicko2: { s1: 6000, s2Groups: 2500, s3: 6000, honest: 300, shortfall: 400 }, wenglin: { s1: 4000, s2Groups: 1500, s3: 4000, honest: 250, shortfall: 300 } },
});

export interface ScenarioSet {
  model: RatingModel;
  pool: string;
  /** The S1/S2 yardstick: the median final standing of honest true-Laser-floor players with 30 games a month. */
  baseline: number;
  s1: S1Result;
  s2: S2Row[];
  s3: S3Result;
  shortfall: ShortfallRow[];
  wallMs: number;
}

/**
 * The scenarios for one model, knobs and opponents. `baseline` overrides the yardstick (the median final standing of honest true-1675 players with
 * 30 games a month), for instance with the value a simulated population gives (`populationBaseline`); by default the solo model computes it with
 * the same opponents.
 */
export function scenarioSet(
  model: RatingModel, p: Readonly<SimParams>, sizes: ScenarioSizes, pool: OpponentPool = matchedOpponents(), seed = 'scenarios', withShortfall = true,
  baselineOverride?: number,
): ScenarioSet {
  const t = performance.now();
  const ladder: SimLadder = model === 'glicko2' ? '1v1-standard' : 'pod-commander';
  const floors = floorsOf(p, ladder);
  const baseline = baselineOverride ?? honestMedianStanding(model, p, floors, sizes.honest, `${seed}/honest-1675`, pool);
  const s1 = scenarioS1(model, p, floors, baseline, sizes.s1, `${seed}/s1`, 200, pool);
  const s2 = scenarioS2(model, p, floors, baseline, [3, 5, 10], sizes.s2Groups, `${seed}/s2`, pool);
  const s3 = scenarioS3(model, p, floors, sizes.s3, `${seed}/s3`, pool);
  const shortfall = withShortfall ? shortfallTable(model, p, floors, [5, 10, 30, 100], sizes.shortfall, 1800, `${seed}/shortfall`, pool) : [];
  return { model, pool: pool.name, baseline, s1, s2, s3, shortfall, wallMs: performance.now() - t };
}

export interface BoundCheck { name: string; value: number; bound: number; pass: boolean }

/** Section 7's bounds and 17.11's shortfall target for one scenario set. */
export function boundChecks(s: ScenarioSet): BoundCheck[] {
  const best5 = s.s2.find((r) => r.k === 5)!;
  const check = (name: string, value: number, bound: number): BoundCheck => ({ name, value, bound, pass: value <= bound });
  const out = [
    check('S1 rank at a close the day after stopping', s.s1.rankAtClose, TARGETS.s1Rank),
    check('S1 stopping when the standing gets there', s.s1.standingStop, TARGETS.s1Standing),
    check('S1 stopping for a Laser-or-better badge', s.s1.badgeStop, TARGETS.s1Badge),
    check('S2 best of 5 on the leaderboard after 10 games', best5.leaderboard, TARGETS.s2Best5Leaderboard),
    check('S2 best of 5 with a Laser-or-better badge', best5.badge, TARGETS.s2Best5Badge),
    check('S3 Circuit-or-better badge after 5 games', s.s3.exact, TARGETS.s3Circuit),
  ];
  const ten = s.shortfall.find((r) => r.gpm === 10);
  if (ten !== undefined) out.push(check('season shortfall of a true-1800 player at 10 games a month', ten.shortfall, TARGETS.shortfall10));
  return out;
}

/** The opponents the matcher gave in a stationary run of the ladder (test/sim/solo.ts metOpponents). */
export function metPool(s: StationaryResult): OpponentPool {
  return metOpponents(s.met);
}

// ---- the knob sweeps on the solo model ---------------------------------------------------------------------------------------------------------

export interface SweepRow {
  label: string;
  params: Readonly<SimParams>;
  movement: MovementRow[];
  bounds: BoundCheck[];
  scenarios: ScenarioSet;
}

/** One knob's values for a model: how fast ratings move (5, 10, 30 and 100 games a month) and every bound, on the matched opponents. */
export function soloSweep(model: RatingModel, variants: readonly { label: string; params: Readonly<SimParams> }[], sizes: ScenarioSizes, seed = 'sweep'): SweepRow[] {
  return variants.map((v) => {
    const sc = scenarioSet(model, v.params, sizes, matchedOpponents(), `${seed}/${v.label}`);
    return {
      label: v.label, params: v.params, movement: [5, 10, 30, 100].map((gpm) => movement(model, v.params, gpm, `${seed}/${v.label}/movement`, 200)),
      bounds: boundChecks(sc), scenarios: sc,
    };
  });
}

/** S1's (a) and (b) and S2's (a) at other values of LEADERBOARD_K (the badge does not depend on it). */
export function kSweep(model: RatingModel, ks: readonly number[], sizes: ScenarioSizes, seed = 'k'): { k: number; baseline: number; s1: S1Result; s2: S2Row[] }[] {
  const ladder: SimLadder = model === 'glicko2' ? '1v1-standard' : 'pod-commander';
  return ks.map((k) => {
    const p = simParams({ leaderboardK: k });
    const floors = floorsOf(p, ladder);
    const baseline = honestMedianStanding(model, p, floors, sizes.honest, `${seed}/honest-1675`);
    return {
      k, baseline, s1: scenarioS1(model, p, floors, baseline, sizes.s1, `${seed}/s1`),
      s2: scenarioS2(model, p, floors, baseline, [3, 5, 10], sizes.s2Groups, `${seed}/s2`),
    };
  });
}

/** The honest seasons a pull leaves (section 7's table) and S3, for each pull. */
export function pullSweep(model: RatingModel, pulls: readonly number[], sizes: ScenarioSizes, seed = 'pull'): { pull: number; shortfall: ShortfallRow[]; s3: S3Result }[] {
  const ladder: SimLadder = model === 'glicko2' ? '1v1-standard' : 'pod-commander';
  return pulls.map((pull) => {
    const p = simParams({ pull });
    const floors = floorsOf(p, ladder);
    return { pull, shortfall: shortfallTable(model, p, floors, [5, 10, 30, 100], sizes.shortfall, 1800, `${seed}/shortfall`), s3: scenarioS3(model, p, floors, sizes.s3, `${seed}/s3`) };
  });
}

// ---- floors -------------------------------------------------------------------------------------------------------------------------------------

export interface FloorAdvice {
  /** The tier shares of each ladder's stationary distribution with its own floors (all activities together). */
  shares1v1: number[];
  sharesPod: number[];
  /** Pod floors that give the pod ladder the 1v1 ladder's shares (each 1v1 floor's quantile in the pod distribution, to 5 points). */
  matchedPodFloors: number[];
  /** The shares the default floors give the pod ladder minus the 1v1 ladder's (points of share). */
  podMinus1v1: number[];
}

export function floorAdvice(one: StationaryResult, pod: StationaryResult, floors: readonly number[]): FloorAdvice {
  const sharesOf = (xs: readonly number[], f: readonly number[]) => TIER_IDS.map((t) => share(xs, (x) => tierOf(x, f) === t));
  const shares1v1 = sharesOf(one.dist.all, floors);
  const sharesPod = sharesOf(pod.dist.all, floors);
  const matchedPodFloors = floors.map((f) => {
    const q = share(one.dist.all, (x) => x < f);
    return Math.round(quantile(pod.dist.all, q) / 5) * 5;
  });
  return { shares1v1, sharesPod, matchedPodFloors, podMinus1v1: sharesPod.map((s, i) => s - shares1v1[i]!) };
}

// ---- the abuse heuristics over honest play ----------------------------------------------------------------------------------------------------

export interface KindCount { kind: AbuseKind; reports: number; accounts: number; lateReports: number; lateAccounts: number }

export interface ReportSummary {
  name: string;
  /** Reports and distinct accounts per kind, over the whole run and from the stationary period on (STATIONARY_FROM). */
  kinds: KindCount[];
  /** Distinct accounts with any report: overall, in the launch months, from the stationary period on. */
  accounts: number;
  launchAccounts: number;
  lateAccounts: number;
  /** Accounts that played: overall, in the launch months, from the stationary period on. */
  played: number;
  launchPlayed: number;
  latePlayed: number;
  /** With abusers: the share of the injected smurfs reported as `smurf`, of the sandbaggers as `sandbagging`; and honest accounts reported. */
  smurfsCaught: number | null;
  sandbaggersCaught: number | null;
  honestAccounts: number;
}

export interface HonestReportsResult {
  ladder: SimLadder;
  players: number;
  days: number;
  seed: string;
  games: number;
  wallMs: number;
  replayMs: number;
  /** The share of games that were a rematch of a last-3 game, and the pairs that met at least 5 times (pods 6) within 7 days. */
  rematchShare: number;
  repeatedPairs: number;
  sets: ReportSummary[];
}

const KINDS: readonly AbuseKind[] = ['repeatedPairing', 'oneSided', 'earlyConcessions', 'smurf', 'ratingTransfer', 'sandbagging', 'parkedHigh', 'capStall', 'dodging'];

const LATE_MS = Date.UTC(2027, 2, 1);

function summarizeTally(name: string, t: ReportTally, r: PopulationResult): ReportSummary {
  const played = r.players.filter((pl) => pl.row !== null);
  const launchPlayed = played.filter((pl) => pl.records.some((x) => x.season < STATIONARY_FROM)).length;
  const latePlayed = played.filter((pl) => pl.records.some((x) => x.season >= STATIONARY_FROM)).length;
  const abusers = new Set<AccountId>([...r.abusers.smurfs, ...r.abusers.sandbaggers]);
  const kinds = KINDS.map((kind): KindCount => {
    const f = t.filed.filter((x) => x.kind === kind);
    const late = f.filter((x) => x.ms >= LATE_MS);
    return {
      kind, reports: f.length, accounts: new Set(f.flatMap((x) => x.accounts)).size, lateReports: late.length,
      lateAccounts: new Set(late.flatMap((x) => x.accounts)).size,
    };
  });
  const all = new Set(t.filed.flatMap((x) => x.accounts));
  const launch = new Set(t.filed.filter((x) => x.ms < LATE_MS).flatMap((x) => x.accounts));
  const late = new Set(t.filed.filter((x) => x.ms >= LATE_MS).flatMap((x) => x.accounts));
  const caught = (list: readonly AccountId[], kind: AbuseKind) => {
    if (list.length === 0) return null;
    const hit = new Set(t.filed.filter((x) => x.kind === kind).flatMap((x) => x.accounts));
    return share(list, (a) => hit.has(a));
  };
  return {
    name, kinds, accounts: all.size, launchAccounts: launch.size, lateAccounts: late.size, played: played.length, launchPlayed, latePlayed,
    smurfsCaught: caught(r.abusers.smurfs, 'smurf'), sandbaggersCaught: caught(r.abusers.sandbaggers, 'sandbagging'),
    honestAccounts: [...all].filter((a) => !abusers.has(a)).length,
  };
}

/**
 * Honest play (or, with `abusers`, honest play with injected smurfs and sandbaggers) checked by M15-5's real checker with design 11.1's thresholds
 * (DESIGN_ABUSE_RULES) inline, then replayed under each candidate set of thresholds (the same calls in the same order; test/sim/abuse.ts replayAbuse). The kinds do not
 * share thresholds, so a set's count per kind is that kind's count under its own thresholds whatever the set does to the others.
 */
export async function honestReports(
  ladder: SimLadder, candidates: Readonly<Record<string, Readonly<AbuseRules>>>,
  o: { players?: number; days?: number; seed?: string; abusers?: PopulationOptions['abusers'] } = {},
): Promise<HonestReportsResult> {
  const players = o.players ?? 1000;
  const days = o.days ?? 150;
  const seed = o.seed ?? 'reports';
  const r = await new Population({
    ladder, players, seed, days, activity: ACTIVITY, churnPerMonth: 0.1, arrivalDays: 14, abuse: { rules: DESIGN_ABUSE_RULES }, record: true,
    abusers: o.abusers,
  }).run();
  const sets: ReportSummary[] = [summarizeTally("defaults (11.1's thresholds)", r.tally!, r)];
  const t = performance.now();
  for (const [name, rules] of Object.entries(candidates)) sets.push(summarizeTally(name, await replayAbuse(r.history!, rules), r));
  return {
    ladder, players, days, seed, games: r.games, wallMs: r.wallMs, replayMs: performance.now() - t, rematchShare: r.rematches / Math.max(1, r.games),
    repeatedPairs: r.repeatedPairs, sets,
  };
}

/** Honest play checked inline with one set of thresholds (the slow suite's check of a recommendation): its summary, without replays. */
export async function honestReportsWith(
  ladder: SimLadder, rules: Readonly<AbuseRules>, o: { players?: number; days?: number; seed?: string; endings?: Readonly<Endings> } = {},
): Promise<{ summary: ReportSummary; games: number; wallMs: number }> {
  const r = await new Population({
    ladder, players: o.players ?? 1000, seed: o.seed ?? 'reports', days: o.days ?? 150, activity: ACTIVITY, churnPerMonth: 0.1, arrivalDays: 14,
    abuse: { rules }, ...(o.endings === undefined ? {} : { endings: o.endings }),
  }).run();
  return { summary: summarizeTally('candidate', r.tally!, r), games: r.games, wallMs: r.wallMs };
}

/** Whether a set meets 17.11's honest-play target from the stationary period on: no oneSided or sandbagging report, under 1 in 1,000 accounts. */
export function meetsHonestTarget(s: ReportSummary): boolean {
  const k = (kind: AbuseKind) => s.kinds.find((x) => x.kind === kind)!.lateReports;
  return k('oneSided') === 0 && k('sandbagging') === 0 && s.lateAccounts / Math.max(1, s.latePlayed) < TARGETS.honestAccountShare;
}

export { honestSeasons, modelOf };
