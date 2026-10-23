/**
 * M15-6: the ladder's rating math with the swept knobs as parameters (design 4.3, 5.3, 6.2, 7, 10.1), and what one rated game writes, mirroring
 * M15-3's computeApplication (src/intake/apply.ts) and its season close (src/service/seasons.ts) field by field.
 *
 * The package's functions read their constants (GLICKO2, WENGLIN, SEASON_RESET, LEADERBOARD_K), which are frozen; a sweep needs other values. So this
 * file builds on the package's parameter-free cores (glicko2Period, plackettLuceTerms, displayRating, displayDeviation, tierOf, tierAfter,
 * badgeTier's median) and writes again only what reads a swept constant: time away, the pod's τ, the reset, the standing, provisionalFrom and the
 * badge's game counts. Each is the
 * package's expression with the constant replaced, so with DEFAULT_SIM_PARAMS every result equals the package's to the last bit;
 * test/sim/model.test.ts pins that against rateOneVsOne, ratePod, seasonReset, ratingNow, provisionalFrom, standingOf and computeApplication.
 *
 * Times are epoch milliseconds (the simulation runs millions of games; it formats ISO strings only where a package function needs them).
 */
import {
  displayDeviation, displayRating, GLICKO2, glicko2Period, LADDERS, plackettLuceTerms, tierAfter, tierOf, WENGLIN,
  type Glicko2State, type LadderDef, type Place, type RatingModel, type RatingState, type SeasonId, type TierId, type WengLinState,
} from '../../src/api';
import { higherTier } from '../../src/store/memory';
import type { SimLadder, SimParams } from './params';

export const DAY_MS = GLICKO2.periodMs;

// ---- seasons, in ms ---------------------------------------------------------------------------------------------------------------------------

/** 'YYYY-MM' of an epoch ms (seasonOf without the string round trip). */
export function seasonOfMs(ms: number): SeasonId {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The first ms of a season and of the next one. */
export function seasonStartMs(s: SeasonId): number {
  return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, 1);
}
export function seasonEndMs(s: SeasonId): number {
  return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 1);
}

// ---- time away, the reset, the standing -------------------------------------------------------------------------------------------------------

/** RD² a day away adds: (scale · idleVolPerDay)², as glicko2RdAt computes it. */
export function rd2PerDay(p: Readonly<SimParams>): number {
  return (GLICKO2.scale * p.idleVolPerDay) ** 2;
}

/** μ² a day away adds in pods: WENGLIN.driftPerDay at the default, else (idleVolPerDay · c_ref)² (5.2: the same growth in shown points). */
export function driftPerDay(p: Readonly<SimParams>): number {
  return p.idleVolPerDay === GLICKO2.idleVolPerDay ? WENGLIN.driftPerDay : (p.idleVolPerDay * WENGLIN.cRef) ** 2;
}

/** glicko2RdAt with the swept constant. */
export function rdAt(rd: number, days: number, p: Readonly<SimParams>): number {
  return Math.min(GLICKO2.rdMax, Math.sqrt(rd * rd + Math.max(0, days) * rd2PerDay(p)));
}

/** σ² after `days` away (wenglin.ts varianceAt) with the swept drift. */
export function varianceAt(sigma: number, days: number, p: Readonly<SimParams>): number {
  return Math.min(WENGLIN.sigma0 * WENGLIN.sigma0, sigma * sigma + Math.max(0, days) * driftPerDay(p));
}

/** wenglinSigmaAt with the swept drift. */
export function sigmaAt(sigma: number, days: number, p: Readonly<SimParams>): number {
  return Math.sqrt(varianceAt(sigma, days, p));
}

/** The shown deviation of a state `days` later, by time away only (ratingNow's `deviation` without a reset). */
export function deviationAt(s: RatingState, days: number, p: Readonly<SimParams>): number {
  return s.model === 'glicko2' ? rdAt(s.rd, days, p) : WENGLIN.displayScale * sigmaAt(s.sigma, days, p);
}

/** services/views.ts deviationAfter: from a stored shown deviation (the season close's final standing). */
export function shownDeviationAfter(model: RatingModel, deviation: number, days: number, p: Readonly<SimParams>): number {
  return model === 'glicko2' ? rdAt(deviation, days, p) : WENGLIN.displayScale * sigmaAt(deviation / WENGLIN.displayScale, days, p);
}

/** seasonReset with the swept pull and bump. */
export function resetState(s: RatingState, p: Readonly<SimParams>): RatingState {
  const keep = 1 - p.pull;
  if (s.model === 'glicko2') {
    return {
      model: 'glicko2',
      r: GLICKO2.r0 + keep * (s.r - GLICKO2.r0),
      rd: Math.min(GLICKO2.rdMax, Math.sqrt(s.rd * s.rd + p.deviationBump * p.deviationBump)),
      vol: s.vol,
    };
  }
  const bump = p.deviationBump / WENGLIN.displayScale;
  return { model: 'wenglin', mu: WENGLIN.mu0 + keep * (s.mu - WENGLIN.mu0), sigma: Math.min(WENGLIN.sigma0, Math.sqrt(s.sigma * s.sigma + bump * bump)) };
}

/** initialState with the swept σ0. */
export function initialSimState(model: RatingModel, p: Readonly<SimParams>): RatingState {
  return model === 'glicko2'
    ? { model: 'glicko2', r: GLICKO2.r0, rd: GLICKO2.rd0, vol: p.vol0 }
    : { model: 'wenglin', mu: WENGLIN.mu0, sigma: WENGLIN.sigma0 };
}

/** standingOf with the swept K. */
export function standingWith(display: number, deviation: number, p: Readonly<SimParams>): number {
  return Math.round(display - p.leaderboardK * deviation);
}

/** A stored row as ratingNow reads it (ms instead of an ISO time). */
export interface RowLike { state: RatingState; season: SeasonId; lastRatedMs: number | null }

/** ratingNow with the swept knobs: the state with the reset applied once if the row is from an earlier season, and the deviation now. */
export function ratingNowSim(row: RowLike, atMs: number, p: Readonly<SimParams>): { state: RatingState; season: SeasonId; deviation: number; reset: boolean } {
  const atSeason = seasonOfMs(atMs);
  const reset = row.season < atSeason;
  const state = reset ? resetState(row.state, p) : row.state;
  const days = row.lastRatedMs === null ? 0 : Math.max(0, (atMs - row.lastRatedMs) / GLICKO2.periodMs);
  return { state, season: reset ? atSeason : row.season, deviation: deviationAt(state, days, p), reset };
}

/** display.ts's NEVER_PROVISIONAL, in ms. */
export const NEVER_MS = Date.parse('9999-12-31T23:59:59.999Z');

/** provisionalFrom with the swept time away, in ms: the same doubling and bisection, so the same millisecond at the defaults. */
export function provisionalFromMs(def: LadderDef, s: RatingState, lastMs: number, p: Readonly<SimParams>): number {
  const limit = def.provisionalDeviation;
  const after = s.model === 'glicko2'
    ? (ms: number) => rdAt(s.rd, ms / GLICKO2.periodMs, p)
    : (ms: number) => WENGLIN.displayScale * sigmaAt(s.sigma, ms / GLICKO2.periodMs, p);
  if (after(0) > limit) return lastMs;
  const room = NEVER_MS - lastMs;
  let hi = 1;
  while (after(hi) <= limit) {
    if (hi >= room) return NEVER_MS;
    hi = Math.min(hi * 2, room);
  }
  let lo = 0;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (after(mid) > limit) hi = mid;
    else lo = mid;
  }
  return lastMs + hi > NEVER_MS ? NEVER_MS : lastMs + hi;
}

// ---- one game ----------------------------------------------------------------------------------------------------------------------------------

const PERIOD_OPTIONS = Object.freeze({ tau: GLICKO2.tau, volMax: GLICKO2.volMax });

/** One side of rateOneVsOne: A's new state, both RDs already grown by time away; RD' clamped to [rdMin, rdMax]. */
function rateSide(a: Glicko2State, rdA: number, b: Glicko2State, rdB: number, score: 0 | 0.5 | 1): Glicko2State {
  const x = glicko2Period({ model: 'glicko2', r: a.r, rd: rdA, vol: a.vol }, [{ r: b.r, rd: rdB, score }], PERIOD_OPTIONS);
  return { model: 'glicko2', r: x.r, rd: Math.min(GLICKO2.rdMax, Math.max(GLICKO2.rdMin, x.rd)), vol: x.vol };
}

/** rateOneVsOne with the swept time away (τ and the volatility cap are the package's, 4.4). */
export function rate1v1(a: Glicko2State, b: Glicko2State, scoreA: 0 | 0.5 | 1, daysA: number, daysB: number, p: Readonly<SimParams>): [Glicko2State, Glicko2State] {
  const sB: 0 | 0.5 | 1 = scoreA === 1 ? 0 : scoreA === 0 ? 1 : 0.5;
  const rdA = rdAt(a.rd, daysA, p);
  const rdB = rdAt(b.rd, daysB, p);
  return [rateSide(a, rdA, b, rdB, scoreA), rateSide(b, rdB, a, rdA, sB)];
}

/** A's side of rate1v1 only (the solo model's opponents are not tracked). */
export function rate1v1A(a: Glicko2State, b: Glicko2State, scoreA: 0 | 0.5 | 1, daysA: number, daysB: number, p: Readonly<SimParams>): Glicko2State {
  return rateSide(a, rdAt(a.rd, daysA, p), b, rdAt(b.rd, daysB, p), scoreA);
}

function permutations(xs: readonly number[]): number[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** wenglin.ts strictOrders: every strict order a finishing order with shared places allows. */
function strictOrders(places: readonly number[]): number[][] {
  const groups = new Map<number, number[]>();
  places.forEach((pl, i) => groups.set(pl, [...(groups.get(pl) ?? []), i]));
  let orders: number[][] = [places.map(() => 0)];
  for (const [place, seats] of [...groups].sort((x, y) => x[0] - y[0])) {
    const ways = permutations(seats);
    orders = orders.flatMap((o) => ways.map((way) => {
      const ranks = [...o];
      way.forEach((seat, k) => { ranks[seat] = place + k; });
      return ranks;
    }));
  }
  return orders;
}

/** ratePod with the swept τ and drift. */
export function ratePodSim(players: readonly WengLinState[], places: readonly Place[], days: readonly number[], p: Readonly<SimParams>): WengLinState[] {
  const tau2 = p.podTau * p.podTau;
  const grown = players.map((pl, i): WengLinState => ({ model: 'wenglin', mu: pl.mu, sigma: Math.sqrt(varianceAt(pl.sigma, days[i]!, p) + tau2) }));
  const orders = strictOrders(places);
  const omega = new Array<number>(players.length).fill(0);
  const delta = new Array<number>(players.length).fill(0);
  for (const ranks of orders) {
    plackettLuceTerms(grown, ranks).forEach((t, i) => {
      omega[i]! += t.omega;
      delta[i]! += t.delta;
    });
  }
  return grown.map((pl, i) => {
    const sigma2 = pl.sigma * pl.sigma;
    return { model: 'wenglin', mu: pl.mu + omega[i]! / orders.length, sigma: Math.sqrt(sigma2 * Math.max(1 - delta[i]! / orders.length, WENGLIN.kappa)) };
  });
}

// ---- what one game writes (computeApplication's fields) ---------------------------------------------------------------------------------------

/** A stored rating row (RatingRow without the account, ladder and version). */
export interface SimRow extends RowLike { games: number; tier: TierId | null }

/** A season record (SeasonRecord without the account and keys; ms times). */
export interface SimRecord {
  season: SeasonId;
  listed: boolean;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  places: [number, number, number, number] | null;
  display: number | null;
  deviation: number | null;
  standing: number | null;
  provisionalFromMs: number | null;
  peak: number | null;
  tier: TierId | null;
  peakTier: TierId | null;
  seasonRatings: number[];
  careerGames: number;
  lastGameMs: number;
  finalStanding: number | null;
  finalRank: number | null;
  badge: TierId | null;
}

export function newSimRecord(season: SeasonId, pods: boolean): SimRecord {
  return {
    season, listed: false, games: 0, wins: 0, draws: 0, losses: 0, places: pods ? [0, 0, 0, 0] : null,
    display: null, deviation: null, standing: null, provisionalFromMs: null, peak: null, tier: null, peakTier: null,
    seasonRatings: [], careerGames: 0, lastGameMs: 0, finalStanding: null, finalRank: null, badge: null,
  };
}

export interface SimSeatIn {
  /** The stored row; null for the account's first game in the ladder. */
  row: SimRow | null;
  /** The account's record of the game's season; null for its first game of the season. */
  record: SimRecord | null;
  place: Place;
  /** Milestone 14's Standing.listed at this game (10.1). */
  listed: boolean;
}

export interface SimSeatOut {
  place: Place;
  before: RatingState;
  awayMs: number;
  after: RatingState;
  displayBefore: number | null;
  displayAfter: number | null;
  tierBefore: TierId | null;
  tierAfter: TierId | null;
  /** The new stored row and season record. */
  row: SimRow;
  record: SimRecord;
  /** ratingNow at the end: the season reset applied to this seat. */
  reset: boolean;
}

/** computeApplication for live seats (the simulation deletes no account), with the swept knobs. Seats in seat order. */
export function applySimGame(ladder: SimLadder, seats: readonly SimSeatIn[], endMs: number, p: Readonly<SimParams>, floors: readonly number[]): SimSeatOut[] {
  const def = LADDERS[ladder];
  const pods = def.model === 'wenglin';
  const season = seasonOfMs(endMs);
  const inputs = seats.map((s) => {
    const base: RowLike = s.row ?? { state: initialSimState(def.model, p), season, lastRatedMs: null };
    const now = ratingNowSim(base, endMs, p);
    const awayMs = base.lastRatedMs === null ? 0 : Math.max(0, endMs - base.lastRatedMs);
    return { s, games: s.row?.games ?? 0, before: now.state, awayMs, days: awayMs / GLICKO2.periodMs, reset: base.season < season };
  });
  let afters: RatingState[];
  if (def.model === 'glicko2') {
    if (inputs.length !== 2) throw new RangeError(`applySimGame: a 1v1 game with ${inputs.length} seats`);
    const [a, b] = inputs as [(typeof inputs)[0], (typeof inputs)[0]];
    const scoreA = a.s.place < b.s.place ? 1 : a.s.place > b.s.place ? 0 : 0.5;
    afters = rate1v1(a.before as Glicko2State, b.before as Glicko2State, scoreA, a.days, b.days, p);
  } else {
    afters = ratePodSim(inputs.map((x) => x.before as WengLinState), inputs.map((x) => x.s.place), inputs.map((x) => x.days), p);
  }
  const firsts = seats.filter((s) => s.place === 1).length;
  return inputs.map((x, i) => {
    const after = afters[i]!;
    const gamesAfter = x.games + 1;
    const placedBefore = x.games >= def.placementGames;
    const placedAfter = gamesAfter >= def.placementGames;
    const displayBefore = placedBefore ? displayRating(x.before) : null;
    const displayAfter = placedAfter ? displayRating(after) : null;
    const heldTier = placedBefore && !x.reset ? x.s.row?.tier ?? null : null;
    const tierBefore = displayBefore === null ? null : heldTier ?? tierOf(displayBefore, floors);
    const tierAfterGame = displayAfter === null ? null : tierAfter(heldTier, displayAfter, floors);
    const row: SimRow = { state: after, season, lastRatedMs: endMs, games: gamesAfter, tier: tierAfterGame };
    const prev = x.s.record !== null && x.s.record.season === season ? x.s.record : newSimRecord(season, pods);
    const rec: SimRecord = {
      ...prev,
      seasonRatings: [...prev.seasonRatings],
      places: prev.places === null ? (pods ? [0, 0, 0, 0] : null) : [...prev.places],
      listed: x.s.listed,
      games: prev.games + 1,
      careerGames: gamesAfter,
      lastGameMs: endMs,
      tier: tierAfterGame,
    };
    const place = x.s.place;
    if (place === 1 && firsts === 1) rec.wins++;
    else if (place === 1) rec.draws++;
    else rec.losses++;
    if (rec.places !== null) rec.places[place - 1] = rec.places[place - 1]! + 1;
    if (displayAfter !== null) {
      const deviationAfter = displayDeviation(after);
      rec.display = displayAfter;
      rec.deviation = deviationAfter;
      rec.standing = standingWith(displayAfter, deviationAfter, p);
      rec.provisionalFromMs = provisionalFromMs(def, after, endMs, p);
      rec.peak = rec.peak === null ? displayAfter : Math.max(rec.peak, displayAfter);
      rec.peakTier = higherTier(rec.peakTier, tierAfterGame);
      if (placedBefore) rec.seasonRatings.push(displayAfter);
    } else {
      rec.display = null;
      rec.deviation = null;
      rec.standing = null;
      rec.provisionalFromMs = null;
    }
    return {
      place, before: x.before, awayMs: x.awayMs, after, displayBefore, displayAfter, tierBefore, tierAfter: tierAfterGame, row, record: rec, reset: x.reset,
    };
  });
}

// ---- the season close (seasons.ts) ------------------------------------------------------------------------------------------------------------

/** finalStandingOf with the swept knobs: null when not eligible for the final leaderboard at the season's end. */
export function finalStandingSim(ladder: SimLadder, r: SimRecord, endsMs: number, p: Readonly<SimParams>): number | null {
  const def = LADDERS[ladder];
  if (r.display === null || r.deviation === null || r.provisionalFromMs === null) return null;
  if (r.games < def.leaderboardGames || !r.listed || !(r.provisionalFromMs > endsMs)) return null;
  const days = Math.max(0, endsMs - r.lastGameMs) / GLICKO2.periodMs;
  return standingWith(r.display, shownDeviationAfter(def.model, r.deviation, days, p), p);
}

/** Competition ranks (1, 1, 3); null stays null. One sort, so a season of thousands of records closes quickly. */
export function competitionRanksOf(standings: readonly (number | null)[]): (number | null)[] {
  const sorted = standings.filter((s): s is number => s !== null).sort((a, b) => b - a);
  const firstAt = new Map<number, number>();
  sorted.forEach((s, i) => {
    if (!firstAt.has(s)) firstAt.set(s, i + 1);
  });
  return standings.map((s) => (s === null ? null : firstAt.get(s)!));
}

/** badgeTier with the swept game counts: the tier, fresh, of the median of the season's post-placement ratings (7). */
export function badgeWith(seasonRatings: readonly number[], careerGames: number, floors: readonly number[], p: Readonly<SimParams>): TierId | null {
  if (seasonRatings.length < p.badgeSeasonGames || careerGames < p.badgeCareerGames) return null;
  return tierOf(median(seasonRatings)!, floors);
}

/** Closes a season's records in place: final standings, ranks and badges (7). */
export function closeSimSeason(ladder: SimLadder, records: readonly SimRecord[], season: SeasonId, p: Readonly<SimParams>, floors: readonly number[]): void {
  const endsMs = seasonEndMs(season);
  const finals = records.map((r) => finalStandingSim(ladder, r, endsMs, p));
  const ranks = competitionRanksOf(finals);
  records.forEach((r, i) => {
    r.finalStanding = finals[i]!;
    r.finalRank = ranks[i]!;
    r.badge = badgeWith(r.seasonRatings, r.careerGames, floors, p);
  });
}

/** Whether a record is on the live leaderboard at `nowMs` (views.ts liveEligible). */
export function liveEligibleSim(ladder: SimLadder, r: SimRecord | null, nowMs: number): boolean {
  const def = LADDERS[ladder];
  return r !== null && r.display !== null && r.standing !== null && r.games >= def.leaderboardGames && r.listed && r.provisionalFromMs !== null
    && nowMs < r.provisionalFromMs;
}

/** The median (views.ts medianOf). */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
