/**
 * M15-6: one player against established opponents. Fast enough for tens of thousands of careers, so it carries the season-shortfall table, the
 * gaming scenarios S1-S3 and most of the sweeps; the population simulation (test/sim/population.ts) checks the same quantities with real
 * matchmaking.
 *
 * Who the opponents are is an `OpponentPool`:
 *  - `matchedOpponents()`: the design's own check model (section 7: "opponents rated at their true skill and matched at the player's rating"):
 *    each opponent's shown rating and true skill are the player's current shown rating, at a settled deviation (60).
 *  - `metOpponents(log)`: the opponents the real matcher gave in a simulated population (test/sim/population.ts, `recordMetFromMs`): for a player
 *    whose shown rating is R (and who is in placement or not), the opponents of a game in which a seat of that population stood at about R, with
 *    their ratings, deviations and TRUE skills at that game. A rating is skill plus noise, so the true skill of an opponent rated 1700 is lower
 *    than 1700 on average (regression to the mean), and a sparse queue pairs a high rating with a lower one once the window widens (9.2): the
 *    matched model has neither, so a lucky account high above its skill keeps its rating longer against these opponents than against matched
 *    ones. A new player's rating error against them is the population's own (docs/perf/m15-ladder-sim.md).
 *
 * In 1v1 there is one opponent, in pods three (SOLO_POD). The player's result comes from the true skills (test/sim/truth.ts: the logistic, and
 * Plackett-Luce by Gumbel noise in pods), and it is rated with the ladder's math (test/sim/model.ts: time away, the lazy season reset, placement,
 * tiers, the season's post-placement ratings for the badge). The opponents are not rated: they stand for an established population.
 */
import {
  displayRating, GLICKO2, LADDERS, TIER_IDS, tierOf, WENGLIN, type Glicko2State, type Place, type RatingModel,
  type RatingState, type SeasonId, type TierId, type WengLinState,
} from '../../src/api';
import {
  DAY_MS, deviationAt, initialSimState, rate1v1A, ratePodSim, resetState, seasonEndMs, seasonOfMs, standingWith,
} from './model';
import type { SimParams } from './params';
import type { Rng } from './rng';
import { SCALE, winChance } from './truth';

/**
 * The matched opponents' shown deviation: about where an active player rests, in both models (1v1 RD 60, as G9's opponents; pods the same in shown
 * points, 5.2).
 */
export const OPPONENT_DEVIATION: Readonly<Record<RatingModel, number>> = Object.freeze({ glicko2: 60, wenglin: 60 });

/** The pod size of the solo runs. */
export const SOLO_POD = 4;

/** An opponent in shown points: its shown rating (not rounded), its shown deviation at the game, its true skill. */
export interface Opponent { shown: number; deviation: number; skill: number }

export interface OpponentPool {
  readonly name: string;
  /** `count` opponents for a player whose shown rating is `shown` (and in placement or not). */
  pick(shown: number, count: number, rng: Rng, placement: boolean): Opponent[];
}

/** The design's check model: every opponent rated and skilled at the player's shown rating, at `deviation`. Draws nothing. */
export function matchedOpponents(deviation = 60): OpponentPool {
  return {
    name: 'matched',
    pick: (shown, count) => Array.from({ length: count }, () => ({ shown, deviation, skill: shown })),
  };
}

/** One seat of one game of a simulated population: its shown rating before the game, whether it was in placement, its opponents then. */
export interface MetRecord { shown: number; placement: boolean; opponents: Opponent[] }

/** Rating buckets of the met log, in shown points. */
const MET_BUCKET = 10;

/**
 * Opponents as a population's matcher gave them (see the file comment): the records whose seat stood in the player's rating bucket (10 points;
 * the nearest buckets outward until at least `minRecords` records), placement matching the player's when there are such records, with `count`
 * opponents (pods: 4-player pods only for 3 opponents). One record at random, its opponents as they were.
 */
export function metOpponents(log: readonly MetRecord[], minRecords = 40): OpponentPool {
  const index = new Map<string, MetRecord[]>();
  const key = (placement: boolean, count: number, b: number) => `${placement ? 'p' : 'e'}|${count}|${b}`;
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of log) {
    const b = Math.floor(r.shown / MET_BUCKET);
    lo = Math.min(lo, b);
    hi = Math.max(hi, b);
    const k = key(r.placement, r.opponents.length, b);
    const list = index.get(k);
    if (list) list.push(r);
    else index.set(k, [r]);
  }
  const near = (placement: boolean, count: number, b: number): MetRecord[][] => {
    const out: MetRecord[][] = [];
    let n = 0;
    for (let d = 0; n < minRecords && (b - d >= lo || b + d <= hi); d++) {
      for (const x of d === 0 ? [b] : [b - d, b + d]) {
        const list = index.get(key(placement, count, x));
        if (list !== undefined) {
          out.push(list);
          n += list.length;
        }
      }
    }
    return out;
  };
  return {
    name: 'met',
    pick: (shown, count, rng, placement) => {
      const b = Math.floor(shown / MET_BUCKET);
      let lists = near(placement, count, b);
      if (lists.length === 0) lists = near(!placement, count, b);
      if (lists.length === 0) throw new RangeError(`metOpponents: no game with ${count} opponents in the log`);
      const total = lists.reduce((a, l) => a + l.length, 0);
      let i = rng.int(total);
      for (const l of lists) {
        if (i < l.length) return l[i]!.opponents.map((o) => ({ ...o }));
        i -= l.length;
      }
      throw new Error('metOpponents: unreachable');
    },
  };
}

export interface SoloState {
  model: RatingModel;
  state: RatingState;
  season: SeasonId;
  lastMs: number | null;
  games: number;
  /** This season: games, and the post-placement ratings (the badge's), in order and sorted. */
  seasonGames: number;
  seasonRatings: number[];
  sortedRatings: number[];
}

export function newSolo(model: RatingModel, p: Readonly<SimParams>, atMs: number): SoloState {
  return { model, state: initialSimState(model, p), season: seasonOfMs(atMs), lastMs: null, games: 0, seasonGames: 0, seasonRatings: [], sortedRatings: [] };
}

/** A state at a shown rating and deviation. */
export function stateAt(model: RatingModel, shown: number, deviation: number, p: Readonly<SimParams>): RatingState {
  return model === 'glicko2'
    ? { model: 'glicko2', r: shown, rd: deviation, vol: p.vol0 }
    : { model: 'wenglin', mu: WENGLIN.mu0 + (shown - 1500) / WENGLIN.displayScale, sigma: deviation / WENGLIN.displayScale };
}

/** An established player at a shown rating and deviation, last rated at `lastMs`. */
export function establishedSolo(model: RatingModel, display: number, deviation: number, lastMs: number, p: Readonly<SimParams>, games = 100): SoloState {
  return { model, state: stateAt(model, display, deviation, p), season: seasonOfMs(lastMs), lastMs, games, seasonGames: 0, seasonRatings: [], sortedRatings: [] };
}

/** The shown rating of the stored state (no reset), rounded. */
export function shown(s: SoloState): number {
  return displayRating(s.state);
}

/** The shown rating, not rounded. */
function exactShown(st: RatingState): number {
  return st.model === 'glicko2' ? st.r : 1500 + WENGLIN.displayScale * (st.mu - WENGLIN.mu0);
}

/** The shown deviation `atMs`, by time away only (the deviation at a season's end, 7). */
export function deviationAtMs(s: SoloState, atMs: number, p: Readonly<SimParams>): number {
  return deviationAt(s.state, s.lastMs === null ? 0 : Math.max(0, atMs - s.lastMs) / DAY_MS, p);
}

const MATCHED = matchedOpponents();

/**
 * One game at `endMs` (the player's place comes from its skill against the opponents'): the season reset if due, time away, the update. Returns
 * the player's place.
 */
export function soloGame(s: SoloState, skill: number, endMs: number, rng: Rng, p: Readonly<SimParams>, pool: OpponentPool = MATCHED): Place {
  const season = seasonOfMs(endMs);
  if (s.season < season) {
    s.state = resetState(s.state, p);
    s.season = season;
    s.seasonGames = 0;
    s.seasonRatings = [];
    s.sortedRatings = [];
  }
  const days = s.lastMs === null ? 0 : Math.max(0, endMs - s.lastMs) / DAY_MS;
  const placedBefore = s.games >= LADDERS['1v1-standard'].placementGames;
  let place: Place;
  if (s.model === 'glicko2') {
    const me = s.state as Glicko2State;
    const [o] = pool.pick(me.r, 1, rng, !placedBefore) as [Opponent];
    const opp: Glicko2State = { model: 'glicko2', r: o.shown, rd: o.deviation, vol: p.vol0 };
    const win = rng.chance(winChance(skill, o.skill));
    place = win ? 1 : 2;
    s.state = rate1v1A(me, opp, win ? 1 : 0, days, 0, p);
  } else {
    const me = s.state as WengLinState;
    const opps = pool.pick(exactShown(me), SOLO_POD - 1, rng, !placedBefore);
    // Plackett-Luce by Gumbel noise over all four (the order among the opponents matters to the update when they differ)
    const skills = [skill, ...opps.map((o) => o.skill)];
    const perf = skills.map((x) => (x - 1500) / SCALE + rng.gumbel());
    const order = skills.map((_, i) => i).sort((i, j) => perf[j]! - perf[i]! || i - j);
    const places = new Array<Place>(SOLO_POD);
    order.forEach((seat, k) => { places[seat] = (k + 1) as Place; });
    place = places[0]!;
    const players: WengLinState[] = [me, ...opps.map((o) => stateAt('wenglin', o.shown, o.deviation, p) as WengLinState)];
    s.state = ratePodSim(players, places, [days, ...opps.map(() => 0)], p)[0]!;
  }
  s.games++;
  s.seasonGames++;
  s.lastMs = endMs;
  if (placedBefore) {
    const r = displayRating(s.state);
    s.seasonRatings.push(r);
    let i = s.sortedRatings.length;
    s.sortedRatings.push(r);
    while (i > 0 && s.sortedRatings[i - 1]! > r) {
      s.sortedRatings[i] = s.sortedRatings[i - 1]!;
      i--;
    }
    s.sortedRatings[i] = r;
  }
  return place;
}

/**
 * The season badge now (7): badgeTier's rule (the tier, fresh, of the median of the season's post-placement ratings, with SEASON_BADGE_GAMES such
 * games and BADGE_CAREER_GAMES career games, or the swept counts), from the kept sorted ratings; test/sim/model.test.ts pins it against badgeTier.
 */
export function soloBadge(s: SoloState, floors: readonly number[], p: Readonly<SimParams>): TierId | null {
  const xs = s.sortedRatings;
  if (xs.length < p.badgeSeasonGames || s.games < p.badgeCareerGames) return null;
  const mid = xs.length >> 1;
  return tierOf(xs.length % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2, floors);
}

export function tierAtLeast(t: TierId | null, min: TierId): boolean {
  return t !== null && TIER_IDS.indexOf(t) >= TIER_IDS.indexOf(min);
}

/**
 * The final standing if the season closed at `closeMs` (7, 10.1): null when not eligible then (placement, the season's leaderboard games, or
 * provisional at the close), else round(display − K × the deviation at the close).
 */
export function soloFinalStanding(s: SoloState, closeMs: number, p: Readonly<SimParams>): number | null {
  const def = LADDERS[s.model === 'glicko2' ? '1v1-standard' : 'pod-commander'];
  if (s.games < def.placementGames || s.seasonGames < def.leaderboardGames) return null;
  const dev = deviationAtMs(s, closeMs, p);
  if (dev > def.provisionalDeviation) return null;
  return standingWith(displayRating(s.state), dev, p);
}

/** `n` game end times within the month starting at `monthMs`, uniform, sorted. */
export function monthGames(rng: Rng, monthMs: number, n: number): number[] {
  const len = seasonEndMs(seasonOfMs(monthMs)) - monthMs;
  return Array.from({ length: n }, () => monthMs + Math.floor(rng.next() * len)).sort((a, b) => a - b);
}

/** The first ms of the month `k` months after `startMs` (a season start). */
export function monthStart(startMs: number, k: number): number {
  const d = new Date(startMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1);
}

export interface SeasonEnd {
  month: number;
  season: SeasonId;
  display: number;
  deviationAtEnd: number;
  finalStanding: number | null;
  badge: TierId | null;
  games: number;
}

/**
 * An honest career: a new player of true `skill` with `gpm` games a month for `months` months from `startMs` (a season start). Returns its state at
 * each season's end (the close takes the season's end itself, 7).
 */
export function honestCareer(
  model: RatingModel, skill: number, gpm: number, months: number, startMs: number, rng: Rng, p: Readonly<SimParams>, floors: readonly number[],
  start?: SoloState, pool: OpponentPool = MATCHED,
): SeasonEnd[] {
  const s = start ?? newSolo(model, p, startMs);
  const out: SeasonEnd[] = [];
  for (let m = 0; m < months; m++) {
    const monthMs = monthStart(startMs, m);
    for (const t of monthGames(rng, monthMs, gpm)) soloGame(s, skill, t, rng, p, pool);
    const endMs = monthStart(startMs, m + 1);
    if (s.season !== seasonOfMs(monthMs)) continue; // no game this season
    out.push({
      month: m + 1, season: s.season, display: shown(s), deviationAtEnd: deviationAtMs(s, endMs, p),
      finalStanding: soloFinalStanding(s, endMs, p), badge: soloBadge(s, floors, p), games: s.seasonGames,
    });
  }
  return out;
}

/** GLICKO2.periodMs, for callers that space games by days. */
export const SOLO_DAY_MS = GLICKO2.periodMs;
