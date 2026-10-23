/**
 * M15-3: what one rated game writes (design 8.3 "Computation is pure", 4.3, 5.3, 6.2, 6.3, 7, 8.7, 13.3). `computeApplication` takes the RatedGame,
 * its registry entry and the stored rows, and returns the AppliedGame the store writes in one atomic step, with the notices for the seats. Pure: the
 * same inputs always give the same result, and nothing here reads a clock, a store or a random source. The service supplies `appliedAt`.
 *
 * Per seat (4.3, 5.3):
 * - the row it starts from: the stored rating row for a live account (none: the initial state, first game), or for a deleted account (the registry
 *   seat's account is null, 8.7) the registry seat's start snapshot, exactly like a live row;
 * - `before` = ratingNow(row, endedAt).state: the season reset applied once if the row is from an earlier season, NO time away;
 * - time away: endedAt − lastRatedAt in ms (`awayMs`, 0 for a first game), which rateOneVsOne and ratePod add from their `days`;
 * - the rating: rateOneVsOne for 1v1 (both from each other's values before the game), ratePod for pods;
 * - shown values: hidden during placement (the first `placementGames` career games): `displayBefore` when the account was placed before the game,
 *   `displayAfter` and `tierAfter` once it is placed after it; the tier with the demotion buffer, computed fresh at placement's end and after a
 *   season reset (6.3);
 * - a deleted seat is rated as above and stored nowhere: its AppliedSeat is "Deleted player" with no rating values, it gets no rating row, no
 *   season record and no notice (8.7).
 *
 * The season record of each live account (7, 10.1): games and results, the pods' places, `listed` from milestone 14's Standing.listed at this game,
 * and once placed: the shown rating, deviation, standing and provisionalFrom after the game, the peak and the tier; after a post-placement game (one
 * the account played with placement already done, so from its 11th career game) also the shown rating appended to the season's ratings, the
 * badge's median (7). Results: a seat alone in 1st place won; sharing 1st place drew (CR 104.4a, unverified); any other place lost.
 */
import {
  displayDeviation, displayRating, GLICKO2, initialState, isProvisional, LADDERS, provisionalFrom, ratePod, rateOneVsOne, ratingNow, standingOf,
  tierAfter, tierOf, type CapSeat, type Glicko2State, type LadderId, type Place, type RatedNotice, type RatingRowLike, type RatingState, type SeatNo,
  type WengLinState,
} from '../api';
import { isoMs } from '../api/season';
import type { AccountId } from '../accounts';
import type { RankedStart, RatedGame } from '../ledger';
import type { AppliedGame, AppliedSeat, CapEvent, RatingRow, SeasonRecord } from '../store/api';
import { deletedSeat, higherTier } from '../store/memory';

/** The stored rows computeApplication reads (8.3). */
export interface ApplicationRows {
  /** The stored rating rows of the game's live accounts in its ladder; absent: the account's first game there. */
  ratings: ReadonlyMap<AccountId, RatingRow>;
  /** Their records of the game's season; absent: the account's first game of the season. */
  seasons: ReadonlyMap<AccountId, SeasonRecord>;
  /** Milestone 14's Standing.listed for each live account at this game (10.1); absent counts as false. */
  listed: ReadonlyMap<AccountId, boolean>;
}

export interface ApplicationConfig {
  /** The tier floors of the game's season (SeasonRow.floors, 6.3). */
  floors: readonly number[];
  /** AppliedGame.appliedAt: when the write happens (the only time that is not the game's own). */
  appliedAt: string;
  /** False when the game's season is closed already: the ratings and the history are written, no season record (a closed season never changes, 7). */
  seasonOpen?: boolean;
}

export interface Application {
  applied: AppliedGame;
  /** One per live seat, in seat order (13.6 ratedResult). */
  notices: RatedNotice[];
  /** Step 5 of Glicko-2 that kept the old σ (4.1: logged): the seat and the Illinois steps taken. */
  volatilityKept: { seat: SeatNo; iterations: number }[];
}

/** A cap event (8.5) from the record's cap evidence, each seat's account from the registry seat (8.2), its share by the cap's own measure. */
export function capEventOf(cap: NonNullable<RatedGame['cap']>, start: RankedStart, ladder: LadderId, at: string): CapEvent {
  const measure = (s: CapSeat): number => (cap.kind === 'actions' ? s.initiated : s.chargedMs);
  const total = cap.seats.reduce((n, s) => n + measure(s), 0);
  return {
    game: start.game,
    ladder,
    at,
    kind: cap.kind,
    verdict: { ...cap.verdict },
    seats: cap.seats.map((s) => ({
      seat: s.seat,
      account: start.seats.find((x) => x.seat === s.seat)?.account ?? null,
      initiated: s.initiated,
      chargedMs: s.chargedMs,
      share: total > 0 ? measure(s) / total : 0,
    })),
  };
}

function newRecord(account: AccountId, ladder: LadderId, season: string, pods: boolean): SeasonRecord {
  return {
    account, ladder, season, sortKey: account, listed: false,
    games: 0, wins: 0, draws: 0, losses: 0, places: pods ? [0, 0, 0, 0] : null,
    display: null, deviation: null, standing: null, provisionalFrom: null, peak: null, tier: null, peakTier: null,
    seasonRatings: [], careerGames: 0, lastGameAt: '', finalStanding: null, finalRank: null, badge: null,
  };
}

/** 8.3: what applyGame writes for `game`, and the notices; throws on inputs that do not belong together (the adapter has checked the record). */
export function computeApplication(game: RatedGame, start: RankedStart, rows: ApplicationRows, config: ApplicationConfig): Application {
  if (start.game !== game.game || start.ladder !== game.ladder) throw new Error(`computeApplication: the registry entry is not game ${game.game}'s`);
  const def = LADDERS[game.ladder];
  const pods = def.model === 'wenglin';
  const endMs = isoMs(game.endedAt);
  isoMs(config.appliedAt);
  const seats = [...game.seats].sort((a, b) => a.seat - b.seat);
  if (seats.length !== start.seats.length) throw new Error('computeApplication: the game and its registry entry have different seats');

  const inputs = seats.map((s) => {
    const ss = start.seats.find((x) => x.seat === s.seat);
    if (!ss) throw new Error(`computeApplication: seat ${s.seat} is not in the registry entry`);
    if (s.account !== ss.account) throw new Error(`computeApplication: seat ${s.seat}'s account is not its registry seat's`);
    const live = ss.account !== null;
    const stored = live ? rows.ratings.get(ss.account!) ?? null : null;
    let base: RatingRowLike;
    if (live) base = stored ?? { state: initialState(def.model), season: game.season, lastRatedAt: null };
    else if (ss.row !== null) base = ss.row;
    else throw new Error(`computeApplication: seat ${s.seat} has neither an account nor a start snapshot`);
    if (base.state.model !== def.model) throw new Error(`computeApplication: seat ${s.seat} has a ${base.state.model} rating on ${game.ladder}`);
    const games = live ? stored?.games ?? 0 : ss.games;
    const now = ratingNow(base, game.endedAt);
    const awayMs = base.lastRatedAt === null ? 0 : Math.max(0, endMs - isoMs(base.lastRatedAt));
    return { s, account: ss.account, stored, games, before: now.state, awayMs, days: awayMs / GLICKO2.periodMs, reset: base.season < game.season };
  });

  const volatilityKept: Application['volatilityKept'] = [];
  let afters: RatingState[];
  if (def.model === 'glicko2') {
    if (inputs.length !== 2) throw new Error(`computeApplication: a 1v1 game with ${inputs.length} seats`);
    const [a, b] = inputs as [(typeof inputs)[0], (typeof inputs)[0]];
    const scoreA = a.s.place < b.s.place ? 1 : a.s.place > b.s.place ? 0 : 0.5;
    afters = rateOneVsOne(a.before as Glicko2State, b.before as Glicko2State, scoreA, a.days, b.days, (player, iterations, converged) => {
      if (!converged) volatilityKept.push({ seat: (player === 'a' ? a : b).s.seat, iterations });
    });
  } else {
    afters = ratePod(inputs.map((x) => x.before as WengLinState), inputs.map((x) => x.s.place as Place), inputs.map((x) => x.days));
  }

  const firsts = seats.filter((s) => s.place === 1).length;
  const appliedSeats: AppliedSeat[] = [];
  const ratings: AppliedGame['ratings'] = [];
  const seasonRecords: SeasonRecord[] = [];
  const notices: RatedNotice[] = [];
  inputs.forEach((x, i) => {
    const after = afters[i]!;
    const seat = x.s;
    if (x.account === null) {
      appliedSeats.push(deletedSeat({ ...seat, before: null, awayMs: 0, after: null, displayBefore: null, displayAfter: null, tierAfter: null }));
      return;
    }
    const account = x.account;
    const gamesAfter = x.games + 1;
    const placedBefore = x.games >= def.placementGames;
    const placedAfter = gamesAfter >= def.placementGames;
    const displayBefore = placedBefore ? displayRating(x.before) : null;
    const displayAfter = placedAfter ? displayRating(after) : null;
    // the stored tier carries the buffer within a season; placement's end and a season's reset compute it fresh (6.3)
    const heldTier = placedBefore && !x.reset ? x.stored?.tier ?? null : null;
    const tierBefore = displayBefore === null ? null : heldTier ?? tierOf(displayBefore, config.floors);
    const tierAfterGame = displayAfter === null ? null : tierAfter(heldTier, displayAfter, config.floors);
    appliedSeats.push({ ...seat, before: x.before, awayMs: x.awayMs, after, displayBefore, displayAfter, tierAfter: tierAfterGame });
    ratings.push({
      row: {
        account, ladder: game.ladder, state: after, season: game.season, lastRatedAt: game.endedAt, games: gamesAfter, tier: tierAfterGame,
        version: (x.stored?.version ?? 0) + 1,
      },
      expectVersion: x.stored?.version ?? null,
    });
    const deviationAfter = displayDeviation(after);
    notices.push({
      game: game.game, ladder: game.ladder, season: game.season, seat: seat.seat, place: seat.place,
      before: displayBefore, after: displayAfter, tierBefore, tierAfter: tierAfterGame,
      placementLeft: Math.max(0, def.placementGames - gamesAfter), provisional: isProvisional(def, deviationAfter, gamesAfter),
    });
    if (config.seasonOpen === false) return;

    const prev = rows.seasons.get(account) ?? newRecord(account, game.ladder, game.season, pods);
    const rec: SeasonRecord = {
      ...prev,
      seasonRatings: [...prev.seasonRatings],
      places: prev.places === null ? (pods ? [0, 0, 0, 0] : null) : [...prev.places],
      listed: rows.listed.get(account) ?? false,
      games: prev.games + 1,
      careerGames: gamesAfter,
      lastGameAt: game.endedAt,
      tier: tierAfterGame,
    };
    if (seat.place === 1 && firsts === 1) rec.wins++;
    else if (seat.place === 1) rec.draws++;
    else rec.losses++;
    if (rec.places !== null) rec.places[seat.place - 1] = rec.places[seat.place - 1]! + 1;
    if (displayAfter !== null) {
      rec.display = displayAfter;
      rec.deviation = deviationAfter;
      rec.standing = standingOf(displayAfter, deviationAfter);
      rec.provisionalFrom = provisionalFrom(def, after, game.endedAt);
      rec.peak = rec.peak === null ? displayAfter : Math.max(rec.peak, displayAfter);
      rec.peakTier = higherTier(rec.peakTier, tierAfterGame);
      // the badge's median counts post-placement games only: games played once placement was done (the 11th career game on, 7)
      if (placedBefore) rec.seasonRatings.push(displayAfter);
    } else {
      rec.display = null;
      rec.deviation = null;
      rec.standing = null;
      rec.provisionalFrom = null;
    }
    seasonRecords.push(rec);
  });

  return {
    applied: {
      game: game.game, ladder: game.ladder, season: game.season, endedAt: game.endedAt, appliedAt: config.appliedAt, outcome: game.outcome,
      turns: game.turns, seats: appliedSeats, ratings, seasonRecords, cap: game.cap ? capEventOf(game.cap, start, game.ladder, game.endedAt) : null,
    },
    notices,
    volatilityKept,
  };
}
