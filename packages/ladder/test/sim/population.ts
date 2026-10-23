/**
 * M15-6: the population simulation (design 16, M15-6; 17.11). Synthetic players of known skill arrive, come online in sessions, queue in the real
 * rated matcher (createRatedMatcher, src/match) driven by a fake clock, pass or miss the anonymous ready check, play best-of-one games whose result
 * comes from their true skills (test/sim/truth.ts), and are rated with the ladder's math (test/sim/model.ts, the package's to the last bit at the
 * defaults), monthly resets on. Seasons close as the service closes them (final standings, ranks, badges), and M15-5's abuse checks run over the
 * history as the service runs them (test/sim/abuse.ts).
 *
 * The matcher is ticked as hosted's timer wheel ticks it, once a second (after every other event of that millisecond), but only at the seconds
 * where a tick can form a match: after an entry joins, leaves or is put back at the front, and when a waiting entry's window widens, its
 * 'everyone', rematch-relaxation or 3-player-pod time comes. Between those seconds every tick would find what the last one found (the windows, the
 * entries and the rules are unchanged), so the matches, their times and their order are those of a tick every second; test/sim/population.test.ts
 * checks that against `tickEverySecond`.
 *
 * Times are whole epoch ms on a FakeClock (test/support/clock.ts), which the matcher reads. Deterministic: the same options give the same result
 * (fixed inputs only, owner rule; no Math.random, no Date.now).
 */
import type { AccountId } from '../../src/accounts';
import {
  displayRating, LADDERS, tierOf, WENGLIN, type LadderDef, type Place, type RatingState, type SeasonId, type TierId,
} from '../../src/api';
import { createRatedMatcher } from '../../src/match/index';
import type { RankedEntry, RankedMatch, RankedMatcher } from '../../src/match/api';
import { cappedWindow } from '../../src/match/window';
import type { AbuseRules } from '../../src/abuse/types';
import type { AppliedGame, AppliedSeat, HistoryRow, SeasonRecord } from '../../src/store/api';
import { nameOf, SimAbuseRunner, SimAbuseStore, SimDirectory, simAccount, type RecordedHistory, type ReportTally } from './abuse';
import { FakeClock } from '../support/clock';
import { EventHeap } from './heap';
import {
  applySimGame, closeSimSeason, DAY_MS, deviationAt, liveEligibleSim, median, ratingNowSim, seasonEndMs, seasonOfMs, shownDeviationAfter,
  type SimRecord, type SimRow,
} from './model';
import { DEFAULT_SIM_PARAMS, floorsOf, modelOf, type SimLadder, type SimParams } from './params';
import { Rng } from './rng';
import type { MetRecord, Opponent } from './solo';
import { HONEST_ENDINGS, play1v1, playPod, type Endings, type GameEnding } from './truth';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
/** An average month (365.25 / 12 days). */
export const MONTH_MS = 30.4375 * DAY_MS;
/** 2027-01-01T00:00:00.000Z: the simulated launch, the first day of the first season. */
export const LAUNCH_MS = Date.UTC(2027, 0, 1);

export interface PopulationOptions {
  ladder: SimLadder;
  /** Accounts at any time (a quitting account is replaced by a new one, `churnPerMonth`). */
  players: number;
  seed: string;
  /** Simulated days from the launch. */
  days: number;
  startMs?: number;
  /** New accounts arrive uniformly over the first days (0: all at the launch). */
  arrivalDays?: number;
  /** True skills: normal, in shown points. */
  skillMean?: number;
  skillSd?: number;
  /** Games per month; player i gets activity[i % length]. */
  activity?: readonly number[];
  /** The share of accounts that quit each month, each replaced by a new account of the same activity (a stationary population). */
  churnPerMonth?: number;
  params?: Readonly<SimParams>;
  /** The chance a player misses a ready check (no confirmation in 15 s); the player is then gone for the session. */
  readyMiss?: number;
  /** A queued player gives up after this long and ends the session. */
  patienceMs?: number;
  /** Run M15-5's checks (with these threshold overrides); false: none. */
  abuse?: false | { rules?: Readonly<AbuseRules> };
  endings?: Readonly<Endings>;
  /** Game lengths, uniform, in minutes. */
  gameMinutes?: readonly [number, number];
  /** Keep a log of every start, game and missed check (the service cross-check). */
  log?: boolean;
  /** Record what the abuse checks read (test/sim/abuse.ts replayAbuse: the same run checked under other thresholds). */
  record?: boolean;
  /**
   * Abusers among the honest players, for the checks' detection rates: `smurfs` new accounts of true skill N(2000, 60) arriving after the first
   * `fromDay` days; `sandbaggers` established heavy players (picked at `fromDay` among those with 100 games a month, at least 40 games and a shown
   * rating of at least 1600) that concede every game of 7 days on turn 2-4 and then play honestly again.
   */
  abusers?: { smurfs?: number; sandbaggers?: number; fromDay?: number };
  /**
   * Instead of sessions, every account is online all the time and queues again after each game (the waits by population of 17.11), starting
   * 'established': a rating at its skill plus noise, settled deviation, 60 games, last rated a day before the start.
   */
  alwaysOnline?: boolean;
  /** Career games at which the rating error is sampled. */
  errorAt?: readonly number[];
  /** Tick the matcher every second instead of only when a tick can form a match (the equivalence check; slow). */
  tickEverySecond?: boolean;
  /** Matches formed in the first days are not measured (waits, spreads, relaxed, everyone, threes): the always-online runs' start. */
  warmupDays?: number;
  /** From this time on (epoch ms), log every seat's opponents (test/sim/solo.ts metOpponents). */
  recordMetFromMs?: number;
}

export interface SimPlayer {
  index: number;
  account: AccountId;
  skill: number;
  gpm: number;
  createdMs: number;
  quitMs: number;
  row: SimRow | null;
  /** Its season records, oldest first. */
  records: SimRecord[];
  /** The opponents of its last games in the ladder, newest first (9.4). */
  recent: AccountId[][];
  status: 'offline' | 'queued' | 'check' | 'playing' | 'gone';
  sessionLeft: number;
  token: number;
  enteredAt: number;
  misses: number[];
  cooldownUntil: number;
  /** Wait of each match it was in (ms). */
  waits: number;
  waitMs: number;
  /** When it was first on the live leaderboard (10.1), and its career games then; null until it is. */
  firstEligibleMs: number | null;
  firstEligibleGames: number | null;
}

export interface SeasonPlayerStat {
  index: number;
  skill: number;
  gpm: number;
  /** Games in the season, and career games after them. */
  games: number;
  careerGames: number;
  /** The shown rating and deviation after its last game of the season (null during placement), the deviation at the season's end. */
  display: number | null;
  deviation: number | null;
  deviationAtEnd: number | null;
  finalStanding: number | null;
  finalRank: number | null;
  badge: TierId | null;
  median: number | null;
  peak: number | null;
  /** Placed before the season (at its first game). */
  placedBefore: boolean;
}

export interface SeasonSummary {
  season: SeasonId;
  closedAtMs: number;
  stats: SeasonPlayerStat[];
  /** Live leaderboard rows when the board first held 1, 10, 50, 100 rows: ms since the season's start (null: never). */
  boardFill: (number | null)[];
}

export interface GameLog {
  game: string;
  match: string;
  startMs: number;
  endMs: number;
  accounts: AccountId[];
  ending: GameEnding;
}
export interface MissLog { match: string; ms: number; accounts: AccountId[] }

export interface PopulationResult {
  options: PopulationOptions;
  params: Readonly<SimParams>;
  players: SimPlayer[];
  games: number;
  matches: number;
  /** Matches formed under the rematch relaxation or the everyone window (RankedMatch.relaxed), and with a member past 'everyone'. */
  relaxed: number;
  everyone: number;
  /** Pods of 3. */
  threes: number;
  readyChecksFailed: number;
  giveUps: number;
  /** Every matched entry's wait (ms), and the shown-rating spread and the true-skill spread of every match. */
  waits: number[];
  spreads: number[];
  skillGaps: number[];
  /**
   * |rating − skill| (shown points) and the shown deviation right after the k-th career game, and the account's games a month and the day of the
   * run it was created (the launch cohort's opponents were new too, 6.2; accounts that joined later met an established ladder, 17.11).
   */
  errors: Map<number, { abs: number[]; signed: number[]; deviation: number[]; gpm: number[]; createdDay: number[] }>;
  seasons: SeasonSummary[];
  /** Pairs of accounts that met at least 5 times within 7 days (repeatedPairing's pattern), and the games that were rematches of a last-3 game. */
  repeatedPairs: number;
  rematches: number;
  /** Hourly samples of the accounts online (queued, in a ready check or playing) and queued. */
  online: number[];
  queued: number[];
  tally: ReportTally | null;
  log: { games: GameLog[]; misses: MissLog[] } | null;
  history: RecordedHistory | null;
  /** The injected abusers (PopulationOptions.abusers). */
  abusers: { smurfs: AccountId[]; sandbaggers: AccountId[] };
  /** With `recordMetFromMs`: every seat's shown rating before each game, its placement, and its opponents then (ratings, deviations, skills). */
  met: MetRecord[];
  wallMs: number;
}

const ERROR_AT = [5, 10, 15, 20, 30, 50, 100];
/** The launch cohort: accounts created in the first days of a run, whose opponents were new too (the cold start of 6.2). */
export const COLD_DAYS = 30;

/** Games per session: about a sixth of a week's games, 1 to 5 on average. */
function sessionMean(gpm: number): number {
  return Math.min(5, Math.max(1, gpm / 8));
}

/** The CR citation the ledger gives a loss code (unverified cites, no rules/cr here). */
export function lossRuleOf(loss: string | null): string | null {
  if (loss === null) return null;
  if (loss === 'draw') return 'CR 104.4a';
  if (loss === 'life') return 'CR 704.5a';
  if (loss === 'emptyLibrary') return 'CR 704.5b';
  if (loss === 'poison') return 'CR 704.5c';
  return 'CR 104.3a';
}

/** The established starting row of the always-online runs: rating at skill plus noise, settled deviation, 60 games. */
function establishedRow(def: LadderDef, skill: number, rng: Rng, atMs: number, p: Readonly<SimParams>): SimRow {
  const shown = skill + rng.normal(0, 60);
  const state: RatingState = def.model === 'glicko2'
    ? { model: 'glicko2', r: shown, rd: 65, vol: p.vol0 }
    : { model: 'wenglin', mu: WENGLIN.mu0 + (shown - 1500) / WENGLIN.displayScale, sigma: 65 / WENGLIN.displayScale };
  const display = displayRating(state);
  return { state, season: seasonOfMs(atMs), lastRatedMs: atMs - DAY_MS, games: 60, tier: tierOf(display, def.model === 'glicko2' ? p.floors1v1 : p.floorsPod) };
}

/** The pod-free ladders' pair keys. */
function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class Population {
  readonly o: Required<Omit<PopulationOptions, 'startMs' | 'abuse' | 'params' | 'endings' | 'gameMinutes' | 'errorAt' | 'abusers' | 'recordMetFromMs'>> & {
    startMs: number; abuse: PopulationOptions['abuse']; params: Readonly<SimParams>; endings: Readonly<Endings>; gameMinutes: readonly [number, number];
    errorAt: readonly number[]; abusers: { smurfs: number; sandbaggers: number; fromDay: number }; recordMetFromMs: number | undefined;
  };
  readonly def: LadderDef;
  readonly floors: readonly number[];
  readonly players: SimPlayer[] = [];
  readonly #byAccount = new Map<AccountId, SimPlayer>();
  readonly #heap = new EventHeap<() => void | Promise<void>>();
  readonly #ticks = new Set<number>();
  readonly #queued = new Set<SimPlayer>();
  readonly #running = new Map<string, number>();
  readonly #closed = new Set<SeasonId>();
  readonly #matcher: RankedMatcher;
  readonly #rngSkill: Rng;
  readonly #rngBehaviour: Rng;
  readonly #rngGames: Rng;
  readonly #abuse: SimAbuseRunner | null;
  readonly #directory = new SimDirectory();
  readonly #pairTimes = new Map<string, number[]>();
  readonly #repeated = new Set<string>();
  readonly #eligible = new Set<SimPlayer>();
  #eligibleSeason: SeasonId = '';
  #boardFill = new Map<SeasonId, (number | null)[]>();
  /** Sandbaggers' 7 days of concessions. */
  readonly #tank = new Map<SimPlayer, readonly [number, number]>();
  readonly #rngAbusers: Rng;
  /** The simulated time: every event sets it; the matcher reads it. */
  readonly clock: FakeClock;
  #gameSeq = 0;
  readonly result: PopulationResult;

  constructor(options: PopulationOptions) {
    this.o = {
      startMs: LAUNCH_MS, arrivalDays: 14, skillMean: 1500, skillSd: 130, activity: [5, 10, 30, 100], churnPerMonth: 0.1, readyMiss: 0.01,
      patienceMs: 20 * MINUTE_MS, log: false, record: false, alwaysOnline: false, tickEverySecond: false, warmupDays: 0, ...options,
      abuse: options.abuse,
      abusers: { smurfs: 0, sandbaggers: 0, fromDay: 60, ...options.abusers },
      params: options.params ?? DEFAULT_SIM_PARAMS,
      endings: options.endings ?? HONEST_ENDINGS,
      gameMinutes: options.gameMinutes ?? (modelOf(options.ladder) === 'glicko2' ? [12, 28] : [45, 90]),
      errorAt: options.errorAt ?? ERROR_AT,
      recordMetFromMs: options.recordMetFromMs,
    };
    this.def = LADDERS[this.o.ladder];
    this.floors = floorsOf(this.o.params, this.o.ladder);
    this.clock = new FakeClock(this.o.startMs);
    const rng = new Rng(`${this.o.seed}/${this.o.ladder}`);
    this.#rngSkill = rng.fork('skill');
    this.#rngBehaviour = rng.fork('behaviour');
    this.#rngGames = rng.fork('games');
    this.#rngAbusers = rng.fork('abusers');
    let ids = 0;
    this.#matcher = createRatedMatcher({
      sessionBusy: () => false,
      accountBusy: (a) => this.#byAccount.get(a)?.status === 'playing',
      cooldown: (a, now) => (this.#byAccount.get(a)?.cooldownUntil ?? 0) > now,
      offered: () => true,
      newMatchId: () => `m${String(++ids).padStart(10, '0')}`,
      policy: this.o.params.policy,
    });
    const store = new SimAbuseStore((ladder, season) => (ladder === this.o.ladder ? this.seasonRecords(season) : []));
    this.#abuse = this.o.abuse === false || this.o.abuse === undefined ? null : new SimAbuseRunner(store, this.#directory, this.o.abuse.rules);
    this.result = {
      options, params: this.o.params, players: this.players, games: 0, matches: 0, relaxed: 0, everyone: 0, threes: 0, readyChecksFailed: 0, giveUps: 0,
      waits: [], spreads: [], skillGaps: [], errors: new Map(this.o.errorAt.map((k) => [k, { abs: [], signed: [], deviation: [], gpm: [], createdDay: [] }])),
      seasons: [], repeatedPairs: 0, rematches: 0, online: [], queued: [], tally: this.#abuse?.tally ?? null,
      log: this.o.log ? { games: [], misses: [] } : null,
      history: this.o.record ? { ladder: this.o.ladder, events: [], records: new Map(), created: [] } : null,
      abusers: { smurfs: [], sandbaggers: [] }, met: [], wallMs: 0,
    };
  }

  get now(): number {
    return this.clock.now();
  }

  get #now(): number {
    return this.clock.now();
  }

  /** Schedules `f` at `t` (rounded to a whole ms, never in the past). */
  #at(t: number, f: () => void | Promise<void>): void {
    this.#heap.push(Math.max(Math.round(t), this.#now), f);
  }

  // ---- accounts and sessions ----------------------------------------------------------------------------------------------------------------

  #newPlayer(gpm: number, createdMs: number, skill?: number): SimPlayer {
    const index = this.players.length;
    const lifetime = this.o.churnPerMonth > 0 ? this.#rngBehaviour.exponential(MONTH_MS / this.o.churnPerMonth) : Infinity;
    const pl: SimPlayer = {
      index, account: simAccount(index + 1), skill: skill ?? this.#rngSkill.normal(this.o.skillMean, this.o.skillSd), gpm, createdMs, quitMs: createdMs + lifetime,
      row: null, records: [], recent: [], status: 'offline', sessionLeft: 0, token: 0, enteredAt: 0, misses: [], cooldownUntil: 0, waits: 0, waitMs: 0,
      firstEligibleMs: null, firstEligibleGames: null,
    };
    this.players.push(pl);
    this.#byAccount.set(pl.account, pl);
    this.#directory.add(pl.account, new Date(createdMs).toISOString());
    return pl;
  }

  #sessionGapMs(pl: SimPlayer): number {
    const m = sessionMean(pl.gpm);
    const busy = m * (this.o.gameMinutes[0] + this.o.gameMinutes[1]) * 0.5 * MINUTE_MS;
    return Math.max(10 * MINUTE_MS, (MONTH_MS * m) / pl.gpm - busy);
  }

  #startSession(pl: SimPlayer): void {
    if (pl.status !== 'offline') return;
    pl.sessionLeft = this.o.alwaysOnline ? Infinity : 1 + this.#rngBehaviour.poisson(sessionMean(pl.gpm) - 1);
    this.#enter(pl);
  }

  #endSession(pl: SimPlayer): void {
    pl.status = 'offline';
    pl.sessionLeft = 0;
    if (this.#now >= pl.quitMs) {
      pl.status = 'gone';
      const next = this.#newPlayer(pl.gpm, this.#now);
      this.#at(this.#now + this.#rngBehaviour.exponential(DAY_MS), () => this.#startSession(next));
      return;
    }
    const gap = this.o.alwaysOnline ? this.#rngBehaviour.uniform(MINUTE_MS, 5 * MINUTE_MS) : this.#rngBehaviour.exponential(this.#sessionGapMs(pl));
    this.#at(this.#now + gap, () => this.#startSession(pl));
  }

  // ---- the queue -------------------------------------------------------------------------------------------------------------------------------

  /** LadderService.entryFor (9.1): the rating and deviation from ratingNow in shown points, placement, the last games' opponents. */
  #entryOf(pl: SimPlayer): RankedEntry {
    const now = this.#now;
    let rating = 1500;
    let deviation = this.def.model === 'glicko2' ? 350 : WENGLIN.displayScale * WENGLIN.sigma0;
    if (pl.row !== null) {
      const rn = ratingNowSim(pl.row, now, this.o.params);
      rating = displayRating(rn.state);
      deviation = rn.deviation;
    }
    return {
      account: pl.account, session: `s${pl.index}`, addressKey: `a${pl.index}`, ladder: this.o.ladder, deck: 'deck', enteredAt: now,
      rating, deviation, placement: (pl.row?.games ?? 0) < this.def.placementGames, recent: pl.recent.slice(0, this.o.params.policy.rematchGames),
    };
  }

  #enter(pl: SimPlayer): void {
    if (pl.cooldownUntil > this.#now) {
      this.#at(pl.cooldownUntil + 1000, () => this.#enter(pl));
      return;
    }
    const entry = this.#entryOf(pl);
    const refused = this.#matcher.enter(entry, this.#now);
    if (refused !== null) throw new Error(`simulation: ${pl.account} refused by the matcher (${refused})`);
    pl.status = 'queued';
    pl.enteredAt = entry.enteredAt;
    const token = ++pl.token;
    this.#queued.add(pl);
    this.#tickAt(this.#now);
    if (!this.o.alwaysOnline) this.#at(entry.enteredAt + this.o.patienceMs, () => this.#giveUp(pl, token));
  }

  #giveUp(pl: SimPlayer, token: number): void {
    if (pl.status !== 'queued' || pl.token !== token) return;
    if (this.#now - pl.enteredAt < this.o.patienceMs) {
      this.#at(pl.enteredAt + this.o.patienceMs, () => this.#giveUp(pl, token));
      return;
    }
    this.#matcher.leave(pl.account);
    this.#queued.delete(pl);
    this.result.giveUps++;
    this.#endSession(pl);
    // a pod's 12 nearest candidates change when one leaves (9.3), so a tick may now form a pod
    this.#tickAt(this.#now);
  }

  /** A tick at the first whole second at or after `t`, after the other events of that millisecond. */
  #tickAt(t: number): void {
    if (this.o.tickEverySecond) return;
    const s = Math.ceil(t / 1000) * 1000;
    if (this.#ticks.has(s)) return;
    this.#ticks.add(s);
    this.#heap.push(Math.max(s, this.#now), () => {
      this.#ticks.delete(s);
      this.#tick();
    }, true);
  }

  /** When the waiting entries' windows or rules next change (9.2-9.4), so a tick could form a match that this one could not. */
  #nextChange(): number {
    const p = this.o.params.policy;
    const pod = this.def.model === 'wenglin';
    const cap = pod ? p.windowCapPod : p.windowCap1v1;
    let next = Infinity;
    for (const pl of this.#queued) {
      const e = pl.enteredAt;
      const w = this.#now - e;
      if (cappedWindow(w, pod, p) < cap) next = Math.min(next, e + p.windowEveryMs * (Math.floor(w / p.windowEveryMs) + 1));
      if (w < p.everyoneAfterMs) next = Math.min(next, e + p.everyoneAfterMs);
      if (w < p.rematchRelaxMs) next = Math.min(next, e + p.rematchRelaxMs);
      if (pod && w < p.podThreeAfterMs) next = Math.min(next, e + p.podThreeAfterMs);
    }
    return next;
  }

  #tick(): void {
    const matches = this.#matcher.tick(this.#now);
    for (const m of matches) this.#formed(m);
    if (this.o.tickEverySecond) return;
    if (this.#queued.size >= 2 || (this.#queued.size >= 1 && this.def.model === 'wenglin')) {
      const next = this.#nextChange();
      if (Number.isFinite(next)) this.#tickAt(next);
    }
  }

  #formed(m: RankedMatch): void {
    const members = m.entries.map((e) => this.#byAccount.get(e.account)!);
    if (this.#now >= this.o.startMs + this.o.warmupDays * DAY_MS) {
      this.result.matches++;
      if (m.relaxed) this.result.relaxed++;
      if (m.entries.some((e) => this.#now - e.enteredAt >= this.o.params.policy.everyoneAfterMs)) this.result.everyone++;
      if (m.seats === 3) this.result.threes++;
      this.result.spreads.push(m.spread);
      const skills = members.map((pl) => pl.skill);
      this.result.skillGaps.push(Math.max(...skills) - Math.min(...skills));
      for (const e of m.entries) this.result.waits.push(this.#now - e.enteredAt);
    }
    for (const pl of members) {
      this.#queued.delete(pl);
      pl.status = 'check';
      pl.waits++;
      pl.waitMs += this.#now - pl.enteredAt;
    }
    // the anonymous ready check (8.6): 15 s; each player confirms after 2-10 s, or misses it
    const missed = members.filter(() => this.#rngBehaviour.chance(this.o.readyMiss));
    if (missed.length === 0) {
      const delay = Math.max(...members.map(() => Math.round(this.#rngBehaviour.uniform(2000, 10_000))));
      this.#at(this.#now + delay, () => this.#start(m, members));
      return;
    }
    this.#at(this.#now + 15_000, () => this.#readyCheckFailed(m, missed));
  }

  async #readyCheckFailed(m: RankedMatch, missed: SimPlayer[]): Promise<void> {
    this.result.readyChecksFailed++;
    const now = this.#now;
    this.result.log?.misses.push({ match: m.match, ms: now, accounts: missed.map((pl) => pl.account) });
    for (const pl of missed) {
      // readyCheckMissed (8.6): misses within 24 hours; the 2nd costs 5 minutes, the 3rd 15, the 4th and later 60
      pl.misses = [...pl.misses.filter((t) => t > now - DAY_MS), now];
      const n = pl.misses.length;
      const cooldowns = [5 * MINUTE_MS, 15 * MINUTE_MS, 60 * MINUTE_MS];
      const ms = n < 2 ? 0 : cooldowns[Math.min(n - 2, 2)]!;
      if (ms > 0) pl.cooldownUntil = Math.max(now + ms, pl.cooldownUntil);
      this.#matcher.missed(pl.account, now);
      const iso = pl.misses.map((t) => new Date(t).toISOString());
      this.result.history?.events.push({ kind: 'miss', ms: now, account: pl.account, misses: iso });
      if (this.#abuse !== null) {
        this.#abuse.store.setMisses(pl.account, iso);
        await this.#abuse.afterMiss(pl.account, iso, now);
      }
      this.#endSession(pl);
    }
    const back = m.entries.filter((e) => !missed.some((pl) => pl.account === e.account));
    for (const e of back) {
      const pl = this.#byAccount.get(e.account)!;
      pl.status = 'queued';
      pl.enteredAt = e.enteredAt;
      this.#queued.add(pl);
      const token = ++pl.token;
      if (!this.o.alwaysOnline) this.#at(e.enteredAt + this.o.patienceMs, () => this.#giveUp(pl, token));
    }
    this.#matcher.requeueFront(back, now);
    this.#tickAt(now);
  }

  #start(m: RankedMatch, members: SimPlayer[]): void {
    const game = `g${String(++this.#gameSeq).padStart(10, '0')}`;
    const startMs = this.#now;
    for (const pl of members) pl.status = 'playing';
    this.#running.set(game, startMs);
    const [lo, hi] = this.o.gameMinutes;
    const endMs = startMs + Math.round(this.#rngGames.uniform(lo, hi) * MINUTE_MS);
    this.#at(endMs, () => this.#end(game, m.match, startMs, members));
  }

  // ---- a game's end: the rating, the records, the history, the checks ----------------------------------------------------------------------

  async #end(game: string, match: string, startMs: number, members: SimPlayer[]): Promise<void> {
    const endMs = this.#now;
    this.#running.delete(game);
    let ending = this.def.model === 'glicko2'
      ? play1v1(this.#rngGames, members[0]!.skill, members[1]!.skill, this.o.endings)
      : playPod(this.#rngGames, members.map((pl) => pl.skill), this.o.endings);
    const tanking = members.map((pl) => {
      const w = this.#tank.get(pl);
      return w !== undefined && endMs >= w[0] && endMs < w[1];
    });
    if (tanking.some(Boolean)) ending = tankedEnding(ending, tanking, this.#rngAbusers);
    this.result.log?.games.push({ game, match, startMs, endMs, accounts: members.map((pl) => pl.account), ending: structuredClone(ending) });
    await this.applyGame(game, endMs, members, ending);
    for (const pl of members) {
      pl.sessionLeft--;
      if (pl.sessionLeft > 0) {
        pl.status = 'offline';
        this.#at(endMs + Math.round(this.#rngBehaviour.uniform(15_000, 60_000)), () => this.#enterFromBreak(pl));
      } else {
        this.#endSession(pl);
      }
    }
  }

  #enterFromBreak(pl: SimPlayer): void {
    if (pl.status !== 'offline') return;
    this.#enter(pl);
  }

  /** Rates one game and records it (public for the scenario runs that drive games directly). */
  async applyGame(game: string, endMs: number, members: readonly SimPlayer[], ending: GameEnding): Promise<void> {
    const season = seasonOfMs(endMs);
    const p = this.o.params;
    const out = applySimGame(
      this.o.ladder,
      members.map((pl, i) => ({ row: pl.row, record: pl.records.at(-1)?.season === season ? pl.records.at(-1)! : null, place: ending.seats[i]!.place, listed: true })),
      endMs, p, this.floors,
    );
    const seats: AppliedSeat[] = [];
    if (this.o.recordMetFromMs !== undefined && endMs >= this.o.recordMetFromMs) {
      const at = out.map((x, i): Opponent => ({
        shown: exactShown(x.before), deviation: deviationAt(x.before, x.awayMs / DAY_MS, p), skill: members[i]!.skill,
      }));
      out.forEach((x, i) => {
        this.result.met.push({ shown: at[i]!.shown, placement: x.displayBefore === null, opponents: at.filter((_, j) => j !== i) });
      });
    }
    out.forEach((x, i) => {
      const pl = members[i]!;
      const s = ending.seats[i]!;
      seats.push({
        seat: (i + 1) as AppliedSeat['seat'], account: pl.account, name: nameOf(pl.account), place: s.place, loss: s.loss, lossRule: lossRuleOf(s.loss),
        outTurn: s.outTurn, before: x.before, awayMs: x.awayMs, after: x.after, displayBefore: x.displayBefore, displayAfter: x.displayAfter, tierAfter: x.tierAfter,
      });
      pl.row = x.row;
      if (pl.records.at(-1)?.season === season) pl.records[pl.records.length - 1] = x.record;
      else pl.records.push(x.record);
      const errs = this.result.errors.get(x.row.games);
      if (errs !== undefined) {
        const shown = displayRating(x.after);
        errs.abs.push(Math.abs(shown - pl.skill));
        errs.signed.push(shown - pl.skill);
        errs.deviation.push(x.after.model === 'glicko2' ? x.after.rd : WENGLIN.displayScale * x.after.sigma);
        errs.gpm.push(pl.gpm);
        errs.createdDay.push((pl.createdMs - this.o.startMs) / DAY_MS);
      }
    });
    // a rematch of one of either player's last games (9.4: only under the relaxation), the rematch rule's memory, and repeatedPairing's pattern
    // (5 meetings within 7 days; pods 6)
    const recentOf = (pl: SimPlayer) => new Set(pl.recent.slice(0, this.o.params.policy.rematchGames).flat());
    if (members.some((pl, i) => members.some((q, j) => j > i && (recentOf(pl).has(q.account) || recentOf(q).has(pl.account))))) this.result.rematches++;
    for (let i = 0; i < members.length; i++) {
      const pl = members[i]!;
      pl.recent = [members.filter((x) => x !== pl).map((x) => x.account), ...pl.recent].slice(0, Math.max(3, this.o.params.policy.rematchGames));
      for (let j = i + 1; j < members.length; j++) {
        const key = pairKey(pl.index, members[j]!.index);
        const times = (this.#pairTimes.get(key) ?? []).filter((t) => t > endMs - 7 * DAY_MS);
        times.push(endMs);
        this.#pairTimes.set(key, times);
        if (times.length >= (members.length > 2 ? 6 : 5)) this.#repeated.add(key);
      }
    }
    this.result.repeatedPairs = this.#repeated.size;
    this.result.games++;
    this.#updateBoard(members, endMs, season);
    if (this.#abuse !== null || this.result.history !== null) {
      const row: HistoryRow = {
        game, ladder: this.o.ladder, season, endedAt: new Date(endMs).toISOString(),
        outcome: ending.seats.filter((s) => s.place === 1).length > 1 ? 'draw' : 'win', turns: ending.turns, seats,
      };
      this.result.history?.events.push({ kind: 'game', ms: endMs, row });
      if (this.#abuse !== null) {
        this.#abuse.store.add(row);
        const applied: AppliedGame = { ...row, appliedAt: row.endedAt, ratings: [], seasonRecords: [], cap: null };
        await this.#abuse.afterGame(applied);
      }
    }
  }

  // ---- leaderboards, seasons ------------------------------------------------------------------------------------------------------------------

  #updateBoard(members: readonly SimPlayer[], nowMs: number, season: SeasonId): void {
    if (season !== this.#eligibleSeason) {
      this.#eligible.clear();
      this.#eligibleSeason = season;
    }
    for (const pl of members) {
      const r = pl.records.at(-1)!;
      if (liveEligibleSim(this.o.ladder, r, nowMs)) {
        this.#eligible.add(pl);
        if (pl.firstEligibleMs === null) {
          pl.firstEligibleMs = nowMs;
          pl.firstEligibleGames = pl.row!.games;
        }
      } else {
        this.#eligible.delete(pl);
      }
    }
    let fill = this.#boardFill.get(season);
    if (fill === undefined) this.#boardFill.set(season, (fill = [null, null, null, null]));
    const thresholds = [1, 10, 50, 100];
    const k = fill.findIndex((x) => x === null);
    if (k < 0 || this.#eligible.size < thresholds[k]!) return;
    for (const pl of [...this.#eligible]) if (!liveEligibleSim(this.o.ladder, pl.records.at(-1)!, nowMs)) this.#eligible.delete(pl);
    const startMs = Date.UTC(Number(season.slice(0, 4)), Number(season.slice(5, 7)) - 1, 1);
    for (let i = k; i < thresholds.length; i++) if (fill[i] === null && this.#eligible.size >= thresholds[i]!) fill[i] = nowMs - Math.max(startMs, this.o.startMs);
  }

  /** The season records of a season as the store holds them (for parkedHigh). */
  seasonRecords(season: SeasonId): SeasonRecord[] {
    const out: SeasonRecord[] = [];
    for (const pl of this.players) {
      const r = pl.records.find((x) => x.season === season);
      if (r !== undefined) out.push(toSeasonRecord(this.o.ladder, pl.account, r));
    }
    return out;
  }

  #closeSeasons(): SeasonId[] {
    const closed: SeasonId[] = [];
    const current = seasonOfMs(this.#now);
    for (let s = seasonOfMs(this.o.startMs); s < current; s = nextSeasonId(s)) {
      if (this.#closed.has(s)) continue;
      const endsMs = seasonEndMs(s);
      if (this.#now < endsMs + 15 * MINUTE_MS) break;
      if ([...this.#running.values()].some((t) => t < endsMs)) break;
      const records = this.players.flatMap((pl) => pl.records.filter((r) => r.season === s).map((r) => ({ pl, r })));
      closeSimSeason(this.o.ladder, records.map((x) => x.r), s, this.o.params, this.floors);
      this.#closed.add(s);
      closed.push(s);
      this.result.seasons.push({
        season: s,
        closedAtMs: this.#now,
        boardFill: this.#boardFill.get(s) ?? [null, null, null, null],
        stats: records.map(({ pl, r }) => ({
          index: pl.index, skill: pl.skill, gpm: pl.gpm, games: r.games, careerGames: r.careerGames, display: r.display, deviation: r.deviation,
          deviationAtEnd: r.deviation === null ? null : shownDeviationAfter(this.def.model, r.deviation, Math.max(0, endsMs - r.lastGameMs) / DAY_MS, this.o.params),
          finalStanding: r.finalStanding, finalRank: r.finalRank, badge: r.badge, median: median(r.seasonRatings), peak: r.peak,
          placedBefore: r.careerGames - r.games >= this.def.placementGames,
        })),
      });
    }
    return closed;
  }

  async #daily(): Promise<void> {
    const closed = this.#closeSeasons();
    const h = this.result.history;
    if (h !== null) {
      for (const s of closed) h.records.set(s, this.seasonRecords(s));
      h.events.push({ kind: 'daily', ms: this.#now, closed });
    }
    if (this.#abuse !== null) await this.#abuse.daily(closed.map((season) => ({ ladder: this.o.ladder, season })), this.#now);
  }

  /** PopulationOptions.abusers: smurf accounts arriving, and sandbaggers chosen among the established players. */
  #scheduleAbusers(endMs: number): void {
    const a = this.o.abusers;
    const from = this.o.startMs + a.fromDay * DAY_MS;
    const last = Math.max(from, endMs - 35 * DAY_MS);
    for (let i = 0; i < a.smurfs; i++) {
      const at = Math.round(this.#rngAbusers.uniform(from, last));
      this.#at(at, () => {
        const pl = this.#newPlayer(this.#rngAbusers.pick([30, 100]), at, this.#rngAbusers.normal(2000, 60));
        pl.quitMs = Infinity;
        this.result.abusers.smurfs.push(pl.account);
        this.#startSession(pl);
      });
    }
    if (a.sandbaggers > 0) {
      this.#at(from, () => {
        const pool = this.players.filter((pl) => pl.status !== 'gone' && (pl.row?.games ?? 0) >= 40 && displayRating(pl.row!.state) >= 1600 && pl.gpm >= 100);
        for (let i = 0; i < a.sandbaggers && pool.length > 0; i++) {
          const pl = pool.splice(this.#rngAbusers.int(pool.length), 1)[0]!;
          const start = Math.round(this.#rngAbusers.uniform(from, last));
          pl.quitMs = Infinity;
          this.#tank.set(pl, [start, start + 7 * DAY_MS]);
          this.result.abusers.sandbaggers.push(pl.account);
        }
      });
    }
  }

  #sample(): void {
    let online = 0;
    for (const pl of this.players) if (pl.status !== 'offline' && pl.status !== 'gone') online++;
    this.result.online.push(online);
    this.result.queued.push(this.#queued.size);
  }

  // ---- the run -------------------------------------------------------------------------------------------------------------------------------

  async run(): Promise<PopulationResult> {
    const wall = performance.now();
    const endMs = this.o.startMs + this.o.days * DAY_MS;
    const activity = this.o.activity;
    for (let i = 0; i < this.o.players; i++) {
      const created = this.o.alwaysOnline || this.o.arrivalDays === 0 ? this.o.startMs : this.o.startMs + this.#rngBehaviour.next() * this.o.arrivalDays * DAY_MS;
      const pl = this.#newPlayer(activity[i % activity.length]!, Math.round(created));
      if (this.o.alwaysOnline) {
        pl.row = establishedRow(this.def, pl.skill, this.#rngSkill, this.o.startMs, this.o.params);
        this.#at(this.o.startMs + Math.round(this.#rngBehaviour.uniform(0, 10 * MINUTE_MS)), () => this.#startSession(pl));
      } else {
        this.#at(pl.createdMs, () => this.#startSession(pl));
      }
    }
    for (let t = this.o.startMs + 20 * MINUTE_MS; t <= endMs; t += DAY_MS) this.#at(t, () => this.#daily());
    for (let t = this.o.startMs + HOUR_MS; t <= endMs; t += HOUR_MS) this.#at(t, () => this.#sample());
    this.#scheduleAbusers(endMs);
    if (this.o.tickEverySecond) {
      const every = (): void => {
        this.#tick();
        if (this.#now + 1000 <= endMs) this.#heap.push(this.#now + 1000, every, true);
      };
      this.#heap.push(Math.ceil(this.o.startMs / 1000) * 1000, every, true);
    }
    for (let n = 1; ; n++) {
      if (this.#heap.peekTime() > endMs) break;
      const ev = this.#heap.pop()!;
      this.clock.set(ev.t);
      await ev.v();
      // a long run gives the event loop a turn now and then (a test runner's messages wait for one); nothing simulated depends on it
      if (n % 20_000 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.clock.set(endMs);
    if (this.result.history !== null) this.result.history.created = this.players.map((pl) => [pl.account, new Date(pl.createdMs).toISOString()]);
    this.result.wallMs = performance.now() - wall;
    return this.result;
  }
}

function nextSeasonId(s: SeasonId): SeasonId {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  return m < 12 ? `${s.slice(0, 4)}-${String(m + 1).padStart(2, '0')}` : `${String(y + 1).padStart(4, '0')}-01`;
}

/**
 * A sandbagger's game (PopulationOptions.abusers): the seats that tank concede on turn 2-4 and take the last places; the others keep their honest
 * order above them. Two tanking 1v1 players play it out honestly.
 */
function tankedEnding(ending: GameEnding, tanking: readonly boolean[], rng: Rng): GameEnding {
  const honest = ending.seats.map((s, i) => ({ s, i })).filter((x) => !tanking[x.i]).sort((a, b) => a.s.place - b.s.place);
  if (honest.length === 0) return ending;
  const seats = ending.seats.map((s) => ({ ...s }));
  honest.forEach((x, k) => {
    seats[x.i] = k === 0 ? { place: 1, loss: null, outTurn: null } : { ...x.s, place: (k + 1) as Place };
  });
  let turns = ending.turns;
  let next = honest.length + 1;
  tanking.forEach((t, i) => {
    if (!t) return;
    const outTurn = 2 + rng.int(3);
    seats[i] = { place: next++ as Place, loss: 'concession', outTurn };
    if (ending.seats.length === 2) turns = outTurn;
  });
  return { turns, seats };
}

/** A SimRecord as the store's SeasonRecord (ISO times, account keys). */
export function toSeasonRecord(ladder: SimLadder, account: AccountId, r: SimRecord): SeasonRecord {
  return {
    account, ladder, season: r.season, sortKey: account, listed: r.listed, games: r.games, wins: r.wins, draws: r.draws, losses: r.losses,
    places: r.places === null ? null : [...r.places], display: r.display, deviation: r.deviation, standing: r.standing,
    provisionalFrom: r.provisionalFromMs === null ? null : new Date(r.provisionalFromMs).toISOString(), peak: r.peak, tier: r.tier, peakTier: r.peakTier,
    seasonRatings: [...r.seasonRatings], careerGames: r.careerGames, lastGameAt: new Date(r.lastGameMs).toISOString(), finalStanding: r.finalStanding,
    finalRank: r.finalRank, badge: r.badge,
  };
}

/** The shown rating of a state, not rounded. */
export function exactShown(st: RatingState): number {
  return st.model === 'glicko2' ? st.r : 1500 + WENGLIN.displayScale * (st.mu - WENGLIN.mu0);
}

/** Runs a population. */
export async function runPopulation(o: PopulationOptions): Promise<PopulationResult> {
  return new Population(o).run();
}

export type { Place };
