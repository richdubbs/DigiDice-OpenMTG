/**
 * M15-6: the season measures of section 7 and the gaming scenarios S1-S3 with their bounds, in both models, on the solo model (test/sim/solo.ts:
 * opponents rated at their true skill and matched at the player's rating, the model the design's own check used).
 *
 * The scenarios (section 7's table), as this simulation reads them:
 *   S1  A new true-1500 account plays up to 200 games, one an hour (all in one season: the attacker's best case, no reset and no time away), and
 *       stops as soon as its strategy's condition holds:
 *         (a) its first game after placement with a shown rating at Laser's floor or above and a deviation of at most 120 ("7-8% do"); the season
 *             then closes the day after, and it counts when its final standing is at or above the median final standing of honest true-1675
 *             players with 30 games a month (bound 2%);
 *         (b) as soon as its standing at a close the next day would reach that median (bound 6%);
 *         (c) as soon as its season badge (the median rule) would be Laser or better (bound 1%).
 *   S2  The best of 3, 5 or 10 new true-1500 accounts: (a) after its 10 placement games one of them stands at or above that honest median at a close
 *       the next day; (b) after 30 games each (the badge's career games), one of them has a Laser-or-better badge. Bounds for the best of 5: 6% and
 *       5%.
 *   S3  A true-1250 (Wire) player after the season reset plays exactly 5 games and stops: a Circuit-or-better badge (bound 15%). `exact` starts it at
 *       1250 with a settled deviation (the design's check); `stationary` takes an honest true-1250 career of three months at 30 games a month first.
 * The rates count every account (or group) that tried, not only those whose condition came true. Every function takes the opponents
 * (test/sim/solo.ts): the design's matched opponents by default, or a panel drawn from a simulated population.
 */
import { LADDERS, TIER_IDS, type RatingModel, type TierId } from '../../src/api';
import { DAY_MS, deviationAt, seasonOfMs } from './model';
import type { SimParams } from './params';
import { Rng } from './rng';
import {
  deviationAtMs, establishedSolo, honestCareer, matchedOpponents, monthGames, monthStart, newSolo, OPPONENT_DEVIATION, shown, soloBadge,
  soloFinalStanding, soloGame, tierAtLeast, type OpponentPool, type SoloState,
} from './solo';
import { mean, median, share } from './stats';

const HOUR_MS = 3_600_000;
const MATCHED = matchedOpponents();
/** A season start for the scenario runs (any would do). */
export const SCENARIO_START_MS = Date.UTC(2027, 2, 1);

/** Section 7's bounds. */
export const BOUNDS = Object.freeze({
  s1Rank: 0.02, s1Standing: 0.06, s1Badge: 0.01, s2Best5Leaderboard: 0.06, s2Best5Badge: 0.05, s3Circuit: 0.15,
  /** 17.11: a true-1800 player's season shortfall at 10 games a month. */
  shortfall10: 25,
});

function floorOf(floors: readonly number[], tier: TierId): number {
  return floors[TIER_IDS.indexOf(tier) - 1]!;
}

// ---- honest seasons ----------------------------------------------------------------------------------------------------------------------------

export interface HonestSeasons {
  /** Per season end of months `fromMonth`..`months`: the shown rating, the final standing, the badge. */
  displays: number[];
  finals: number[];
  badges: (TierId | null)[];
  deviations: number[];
}

/** `players` honest careers of true `skill` at `gpm` games a month; the season ends of months fromMonth..months (3-8 by default, 7). */
export function honestSeasons(
  model: RatingModel, skill: number, gpm: number, players: number, seed: string, p: Readonly<SimParams>, floors: readonly number[],
  months = 8, fromMonth = 3, pool: OpponentPool = MATCHED,
): HonestSeasons {
  const rng = new Rng(seed);
  const out: HonestSeasons = { displays: [], finals: [], badges: [], deviations: [] };
  for (let i = 0; i < players; i++) {
    for (const e of honestCareer(model, skill, gpm, months, SCENARIO_START_MS, rng, p, floors, undefined, pool)) {
      if (e.month < fromMonth) continue;
      out.displays.push(e.display);
      if (e.finalStanding !== null) out.finals.push(e.finalStanding);
      out.badges.push(e.badge);
      out.deviations.push(e.deviationAtEnd);
    }
  }
  return out;
}

/**
 * The S1/S2 yardstick: the median final standing of honest players whose true skill is Laser's floor (1675 with the default floors) with 30 games a
 * month.
 */
export function honestMedianStanding(
  model: RatingModel, p: Readonly<SimParams>, floors: readonly number[], players = 400, seed = 'honest-1675', pool: OpponentPool = MATCHED,
): number {
  return median(honestSeasons(model, floorOf(floors, 'laser'), 30, players, seed, p, floors, 8, 3, pool).finals);
}

export interface ShortfallRow {
  gpm: number;
  /** The mean shown rating at season end, months 3-8, and the shortfall below the true skill. */
  meanDisplay: number;
  shortfall: number;
  /** Seasons with a Prism badge (the median rule). */
  prism: number;
  /** The median shown deviation at the season's end. */
  deviation: number;
}

/** Section 7's table: a true-1800 player's season-end rating and Prism badges by games per month. */
export function shortfallTable(
  model: RatingModel, p: Readonly<SimParams>, floors: readonly number[], gpms: readonly number[] = [5, 10, 30, 100], players = 600, skill = 1800,
  seed = 'shortfall', pool: OpponentPool = MATCHED,
): ShortfallRow[] {
  return gpms.map((gpm) => {
    const h = honestSeasons(model, skill, gpm, Math.max(100, Math.round((players * 10) / Math.max(10, gpm))), `${seed}/${gpm}`, p, floors, 8, 3, pool);
    return {
      gpm, meanDisplay: mean(h.displays), shortfall: skill - mean(h.displays), prism: share(h.badges, (b) => tierAtLeast(b, 'prism')), deviation: median(h.deviations),
    };
  });
}

// ---- S1 --------------------------------------------------------------------------------------------------------------------------------------

export interface S1Result {
  accounts: number;
  /** Met (a)'s stopping condition within 200 games. */
  stops: number;
  rankAtClose: number;
  standingStop: number;
  badgeStop: number;
}

export function scenarioS1(
  model: RatingModel, p: Readonly<SimParams>, floors: readonly number[], baseline: number, accounts = 10_000, seed = 's1', maxGames = 200,
  pool: OpponentPool = MATCHED,
): S1Result {
  const rng = new Rng(seed);
  const laser = floorOf(floors, 'laser');
  let stops = 0;
  let rank = 0;
  let standing = 0;
  let badge = 0;
  for (let i = 0; i < accounts; i++) {
    const s = newSolo(model, p, SCENARIO_START_MS);
    let doneA = false;
    let doneB = false;
    let doneC = false;
    for (let g = 1; g <= maxGames && !(doneA && doneB && doneC); g++) {
      const t = SCENARIO_START_MS + g * HOUR_MS;
      soloGame(s, 1500, t, rng, p, pool);
      if (s.games < 10) continue;
      const close = soloFinalStanding(s, t + DAY_MS, p);
      if (!doneA && shown(s) >= laser && deviationAtMs(s, t, p) <= 120) {
        doneA = true;
        stops++;
        if (close !== null && close >= baseline) rank++;
      }
      if (!doneB && close !== null && close >= baseline) {
        doneB = true;
        standing++;
      }
      if (!doneC && tierAtLeast(soloBadge(s, floors, p), 'laser')) {
        doneC = true;
        badge++;
      }
    }
  }
  return { accounts, stops: stops / accounts, rankAtClose: rank / accounts, standingStop: standing / accounts, badgeStop: badge / accounts };
}

// ---- S2 --------------------------------------------------------------------------------------------------------------------------------------

export interface S2Row { k: number; groups: number; leaderboard: number; badge: number }

export function scenarioS2(
  model: RatingModel, p: Readonly<SimParams>, floors: readonly number[], baseline: number, ks: readonly number[] = [3, 5, 10], groups = 4000, seed = 's2',
  pool: OpponentPool = MATCHED,
): S2Row[] {
  const rng = new Rng(seed);
  const accounts = groups * Math.max(...ks);
  const board: boolean[] = [];
  const badges: boolean[] = [];
  for (let i = 0; i < accounts; i++) {
    const s: SoloState = newSolo(model, p, SCENARIO_START_MS);
    let onBoard = false;
    // the badge needs BADGE_CAREER_GAMES career games (30 by default): each account plays that many, all in one season
    const games = Math.max(30, p.badgeCareerGames);
    for (let g = 1; g <= games; g++) {
      const t = SCENARIO_START_MS + g * HOUR_MS;
      soloGame(s, 1500, t, rng, p, pool);
      if (g === 10) {
        const close = soloFinalStanding(s, t + DAY_MS, p);
        onBoard = close !== null && close >= baseline;
      }
    }
    board.push(onBoard);
    badges.push(tierAtLeast(soloBadge(s, floors, p), 'laser'));
  }
  return ks.map((k) => {
    const n = Math.floor(accounts / k);
    let b = 0;
    let c = 0;
    for (let gi = 0; gi < n; gi++) {
      if (board.slice(gi * k, gi * k + k).some(Boolean)) b++;
      if (badges.slice(gi * k, gi * k + k).some(Boolean)) c++;
    }
    return { k, groups: n, leaderboard: b / n, badge: c / n };
  });
}

// ---- S3 --------------------------------------------------------------------------------------------------------------------------------------

export interface S3Result {
  /** Circuit-or-better badges after the reset and exactly 5 games. */
  exact: number;
  stationary: number;
  /** The same stationary players playing their whole month of 30 games (how often an honest true-1250 player gets Circuit anyway). */
  honestMonth: number;
}

export function scenarioS3(
  model: RatingModel, p: Readonly<SimParams>, floors: readonly number[], players = 10_000, seed = 's3', pool: OpponentPool = MATCHED,
): S3Result {
  const rng = new Rng(seed);
  const seasonStart = monthStart(SCENARIO_START_MS, 3);
  const prevEnd = seasonStart;
  let exact = 0;
  for (let i = 0; i < players; i++) {
    const s = establishedSolo(model, 1250, OPPONENT_DEVIATION[model], prevEnd - DAY_MS, p);
    for (let g = 1; g <= 5; g++) soloGame(s, 1250, seasonStart + g * HOUR_MS, rng, p, pool);
    if (tierAtLeast(soloBadge(s, floors, p), 'circuit')) exact++;
  }
  let stationary = 0;
  let honest = 0;
  const n = Math.max(500, Math.round(players / 5));
  for (let i = 0; i < n; i++) {
    const s = newSolo(model, p, SCENARIO_START_MS);
    honestCareer(model, 1250, 30, 3, SCENARIO_START_MS, rng, p, floors, s, pool);
    const five = structuredClone(s);
    for (let g = 1; g <= 5; g++) soloGame(five, 1250, seasonStart + g * HOUR_MS, rng, p, pool);
    if (tierAtLeast(soloBadge(five, floors, p), 'circuit')) stationary++;
    honestCareer(model, 1250, 30, 1, seasonStart, rng, p, floors, s, pool);
    if (seasonOfMs(seasonStart) === s.season && tierAtLeast(soloBadge(s, floors, p), 'circuit')) honest++;
  }
  return { exact: exact / players, stationary: stationary / n, honestMonth: honest / n };
}

// ---- how fast ratings move ----------------------------------------------------------------------------------------------------------------------

export interface MovementRow {
  gpm: number;
  /** The median shown deviation of an active player right after a game (months 3-6), and at a season's end. */
  restAfterGame: number;
  restAtSeasonEnd: number;
  /** A win and a loss between two such players a day after their last games, in shown points (pods: 1st and 4th of four equals). */
  win: number;
  loss: number;
  /** Games until a settled player whose skill rose by 200 shows half of it (median), playing at `gpm`. */
  halfGapGames: number;
  /** Days without a game until a settled active player turns provisional. */
  provisionalDays: number;
  /** The median |rating − skill| after 10 and 30 games of a new player against established opponents (skills N(1500, 130)), one game a day. */
  error10: number;
  error30: number;
}

/** How fast ratings move at `gpm` games a month (the σ0, idleVolPerDay and pod τ sweeps). */
export function movement(model: RatingModel, p: Readonly<SimParams>, gpm = 30, seed = 'movement', players = 400): MovementRow {
  const rng = new Rng(`${seed}/${gpm}`);
  const after: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < Math.max(40, players / 8); i++) {
    const s = newSolo(model, p, SCENARIO_START_MS);
    for (let m = 0; m < 6; m++) {
      const monthMs = monthStart(SCENARIO_START_MS, m);
      for (const t of monthGames(rng, monthMs, gpm)) {
        soloGame(s, 1500, t, rng, p);
        if (m >= 2) after.push(deviationAtMs(s, t, p));
      }
      if (m >= 2) ends.push(deviationAtMs(s, monthStart(SCENARIO_START_MS, m + 1), p));
    }
  }
  const rest = median(after);
  const gapMs = MONTH_AVG_MS / gpm;
  // one game between two settled equals, each `gapMs` after its last game
  const t0 = SCENARIO_START_MS + 10 * DAY_MS;
  const restState = establishedSolo(model, 1500, rest, t0 - gapMs, p).state;
  const opponents = matchedOpponents(deviationAt(restState, gapMs / DAY_MS, p));
  const winState = establishedSolo(model, 1500, rest, t0 - gapMs, p);
  const lossState = establishedSolo(model, 1500, rest, t0 - gapMs, p);
  soloGame(winState, 9000, t0, rng, p, opponents);
  soloGame(lossState, -9000, t0, rng, p, opponents);
  // tracking: settled at 1500, the skill now 1700
  const half: number[] = [];
  for (let i = 0; i < players; i++) {
    const s = establishedSolo(model, 1500, rest, t0 - gapMs, p);
    let g = 0;
    let t = t0;
    while (shown(s) < 1600 && g < 5000) {
      soloGame(s, 1700, t, rng, p);
      t += gapMs;
      g++;
    }
    half.push(g);
  }
  // provisional after a stop: the deviation's growth from the resting value to the limit
  const settled = establishedSolo(model, 1500, rest, t0, p);
  let days = 0;
  while (deviationAtMs(settled, t0 + days * DAY_MS, p) <= 120 && days < 5000) days += 0.1;
  // the error of a new player against established opponents
  const e10: number[] = [];
  const e30: number[] = [];
  for (let i = 0; i < players; i++) {
    const skill = rng.normal(1500, 130);
    const s = newSolo(model, p, t0);
    for (let g = 1; g <= 30; g++) {
      soloGame(s, skill, t0 + g * DAY_MS, rng, p);
      if (g === 10) e10.push(Math.abs(shown(s) - skill));
    }
    e30.push(Math.abs(shown(s) - skill));
  }
  return {
    gpm, restAfterGame: rest, restAtSeasonEnd: median(ends), win: shown(winState) - 1500, loss: shown(lossState) - 1500, halfGapGames: median(half),
    provisionalDays: Math.round(days * 10) / 10, error10: median(e10), error30: median(e30),
  };
}

const MONTH_AVG_MS = 30.4375 * DAY_MS;

/**
 * The median |shown rating − true skill| of new players (skills N(1500, 130)) after each of `ks` games against `pool`, one game a day: the solo
 * model's rating error, to set beside the population's (test/sim/measure.ts `stationary`).
 */
export function newPlayerError(
  model: RatingModel, p: Readonly<SimParams>, ks: readonly number[], players: number, seed: string, pool: OpponentPool = MATCHED,
): { k: number; median: number }[] {
  const rng = new Rng(seed);
  const errs = ks.map(() => [] as number[]);
  const last = Math.max(...ks);
  const t0 = SCENARIO_START_MS + 10 * DAY_MS;
  for (let i = 0; i < players; i++) {
    const skill = rng.normal(1500, 130);
    const s = newSolo(model, p, t0);
    for (let g = 1; g <= last; g++) {
      soloGame(s, skill, t0 + g * DAY_MS, rng, p, pool);
      const at = ks.indexOf(g);
      if (at >= 0) errs[at]!.push(Math.abs(shown(s) - skill));
    }
  }
  return ks.map((k, i) => ({ k, median: median(errs[i]!) }));
}

// ---- the smurf rule over new accounts ---------------------------------------------------------------------------------------------------------

/** One setting of the smurf rule's thresholds (11.1: `smurfRating`, `smurfWinShare`, `smurfMinGames`; the age and game limits stay 30). */
export interface SmurfThresholds { rating: number; winShare: number; minGames: number }

/**
 * The share of new accounts the smurf rule (11.1, M15-5's checkSmurf) would report: an account at most 30 days old with at most 30 rated games
 * whose shown rating after a game reached `rating` (a hidden placement rating never counts), or that won at least `winShare` of its games once it
 * had at least `minGames`. Each account is new, plays `gpm` games a month evenly spaced from its creation against `pool`, and its true skill comes
 * from `skillOf`; the rule is read after every game, as afterGame and the daily sweep read it. One pass gives every setting's share.
 */
export function smurfRates(
  model: RatingModel, p: Readonly<SimParams>, thresholds: readonly SmurfThresholds[], accounts: number, seed: string,
  skillOf: (rng: Rng) => number, gpm: number, pool: OpponentPool = MATCHED,
): number[] {
  const rng = new Rng(seed);
  const hits = thresholds.map(() => 0);
  const gapMs = MONTH_AVG_MS / gpm;
  const t0 = SCENARIO_START_MS + 3 * DAY_MS;
  for (let i = 0; i < accounts; i++) {
    const skill = skillOf(rng);
    const s = newSolo(model, p, t0);
    let peak = -Infinity;
    let wins = 0;
    const fired = thresholds.map(() => false);
    for (let g = 1; g <= 30; g++) {
      const t = t0 + Math.round(g * gapMs);
      if (t - t0 > 30 * DAY_MS) break;
      if (soloGame(s, skill, t, rng, p, pool) === 1) wins++;
      if (s.games >= LADDERS['1v1-standard'].placementGames) peak = Math.max(peak, shown(s));
      thresholds.forEach((x, k) => {
        if (!fired[k] && (peak >= x.rating || (g >= Math.max(1, x.minGames) && wins / g >= x.winShare))) fired[k] = true;
      });
    }
    fired.forEach((f, k) => { if (f) hits[k]!++; });
  }
  return hits.map((h) => h / accounts);
}

