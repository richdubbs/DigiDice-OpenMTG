/**
 * M15-6 (slow suite): the simulation's rating math is the ladder's. With DEFAULT_SIM_PARAMS every function of test/sim/model.ts gives exactly the
 * package's numbers (rateOneVsOne, ratePod, seasonReset, ratingNow, provisionalFrom, standingOf, badgeTier, the season close), and a sequence of
 * games applied by applySimGame writes exactly what M15-3's computeApplication writes. So a sweep that changes a knob changes only that knob.
 * Also: the random source is deterministic, and the Plackett-Luce sampler of test/sim/truth.ts has the logistic pairwise chances it claims.
 */
import { expect, it } from 'vitest';
import { describeSlow } from '../../../engine/test/slow';
import {
  badgeTier, LADDERS, provisionalFrom, ratePod, rateOneVsOne, ratingNow, seasonReset, standingOf, type Glicko2State, type LadderId, type Place,
  type RatingState, type SeasonId, type SeatNo, type WengLinState,
} from '../../src/api';
import type { AccountId } from '../../src/accounts';
import { computeApplication } from '../../src/intake/apply';
import type { RankedStart, RatedGame } from '../../src/ledger';
import { competitionRanks, finalStandingOf } from '../../src/service/seasons';
import type { RatingRow, SeasonRecord } from '../../src/store/api';
import { simAccount } from './abuse';
import {
  applySimGame, closeSimSeason, competitionRanksOf, finalStandingSim, provisionalFromMs, rate1v1, ratePodSim, ratingNowSim, resetState, seasonEndMs,
  seasonOfMs, standingWith, type SimRecord, type SimRow,
} from './model';
import { DEFAULT_SIM_PARAMS as P, simParams, type SimLadder } from './params';
import { toSeasonRecord } from './population';
import { Rng } from './rng';
import { newSolo, soloBadge, soloGame } from './solo';
import { playPod, winChance } from './truth';

const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;
const T0 = Date.UTC(2027, 0, 20, 12);

describeSlow('M15-6: the simulation model is the ladder\'s at the defaults', () => {
  it('rate1v1 equals rateOneVsOne to the last bit', () => {
    const rng = new Rng('pin-1v1');
    for (let i = 0; i < 2000; i++) {
      const a: Glicko2State = { model: 'glicko2', r: rng.uniform(900, 2300), rd: rng.uniform(50, 350), vol: rng.uniform(0.04, 0.1) };
      const b: Glicko2State = { model: 'glicko2', r: rng.uniform(900, 2300), rd: rng.uniform(50, 350), vol: rng.uniform(0.04, 0.1) };
      const score = rng.pick([0, 0.5, 1] as const);
      const da = rng.chance(0.2) ? 0 : rng.uniform(0, 400);
      const db = rng.chance(0.2) ? 0 : rng.uniform(0, 400);
      expect(rate1v1(a, b, score, da, db, P)).toEqual(rateOneVsOne(a, b, score, da, db));
    }
  });

  it('ratePodSim equals ratePod to the last bit, ties included', () => {
    const rng = new Rng('pin-pod');
    const patterns: Place[][] = [[1, 2, 3, 4], [1, 2, 3, 3], [1, 2, 2, 4], [1, 1, 3, 4], [1, 1, 1, 4], [2, 1, 3, 4], [1, 2, 3], [1, 1, 3], [3, 1, 2]];
    for (let i = 0; i < 1500; i++) {
      const places = rng.pick(patterns);
      const players = places.map((): WengLinState => ({ model: 'wenglin', mu: rng.uniform(15, 35), sigma: rng.uniform(0.8, 25 / 3) }));
      const days = places.map(() => (rng.chance(0.3) ? 0 : rng.uniform(0, 200)));
      expect(ratePodSim(players, places, days, P)).toEqual(ratePod(players, places, days));
    }
  });

  it('the reset, ratingNow, provisionalFrom and the standing equal the package', () => {
    const rng = new Rng('pin-season');
    for (let i = 0; i < 600; i++) {
      const state: RatingState = rng.chance(0.5)
        ? { model: 'glicko2', r: rng.uniform(1000, 2200), rd: rng.uniform(50, 350), vol: 0.06 }
        : { model: 'wenglin', mu: rng.uniform(15, 35), sigma: rng.uniform(0.8, 25 / 3) };
      expect(resetState(state, P)).toEqual(seasonReset(state));
      const lastMs = T0 + Math.floor(rng.uniform(-90, 0) * DAY);
      const season: SeasonId = seasonOfMs(lastMs - Math.floor(rng.uniform(0, 60) * DAY));
      const atMs = lastMs + Math.floor(rng.uniform(0, 120) * DAY);
      const row = { state, season, lastRatedAt: iso(lastMs) };
      const pkg = ratingNow(row, iso(atMs));
      const sim = ratingNowSim({ state, season, lastRatedMs: lastMs }, atMs, P);
      expect({ state: sim.state, season: sim.season, deviation: sim.deviation }).toEqual(pkg);
      const ladder: LadderId = state.model === 'glicko2' ? '1v1-standard' : 'pod-commander';
      expect(iso(provisionalFromMs(LADDERS[ladder], state, lastMs, P))).toBe(provisionalFrom(LADDERS[ladder], state, iso(lastMs)));
      const display = Math.round(rng.uniform(1000, 2200));
      const dev = rng.uniform(50, 350);
      expect(standingWith(display, dev, P)).toBe(standingOf(display, dev));
    }
  });

  it('applySimGame writes what computeApplication writes, across a season boundary, in both models', () => {
    for (const ladder of ['1v1-standard', 'pod-commander'] as SimLadder[]) {
      const rng = new Rng(`pin-apply-${ladder}`);
      const def = LADDERS[ladder];
      const n = 12;
      const accounts = Array.from({ length: n }, (_, i) => simAccount(i + 1));
      const simRows = new Map<AccountId, SimRow>();
      const simRecords = new Map<string, SimRecord>();
      const rows = new Map<AccountId, RatingRow>();
      const records = new Map<string, SeasonRecord>();
      let t = Date.UTC(2027, 0, 25);
      for (let g = 0; g < 400; g++) {
        t += Math.floor(rng.uniform(0.01, 0.6) * DAY);
        const size = ladder === '1v1-standard' ? 2 : rng.chance(0.3) ? 3 : 4;
        const seats = [...accounts].sort(() => rng.next() - 0.5).slice(0, size);
        const ties: Place[][] = [[1, 2, 3, 3], [1, 2, 2, 4], [1, 1, 3, 4]];
        const places: Place[] = ladder === '1v1-standard'
          ? (rng.chance(0.05) ? [1, 1] : rng.chance(0.5) ? [1, 2] : [2, 1])
          : size === 4 && rng.chance(0.15) ? rng.pick(ties) : playPod(rng, seats.map(() => 1500)).seats.map((s) => s.place);
        const season = seasonOfMs(t);
        const sim = applySimGame(ladder, seats.map((a, i) => ({
          row: simRows.get(a) ?? null, record: simRecords.get(`${a}|${season}`) ?? null, place: places[i]!, listed: true,
        })), t, P, P.floors1v1);
        const game: RatedGame = {
          game: `g${g}`, ladder, season, endedAt: iso(t), outcome: places.filter((x) => x === 1).length > 1 ? 'draw' : 'win', turns: 9,
          seats: seats.map((a, i) => ({ seat: (i + 1) as SeatNo, account: a, name: 'x', place: places[i]!, loss: places[i] === 1 ? null : 'life', lossRule: null, outTurn: null })),
          cap: null,
        };
        const start: RankedStart = {
          game: game.game, match: `m${g}`, ladder, startedAt: iso(t - 1000), status: 'running', closedAt: null,
          seats: seats.map((a, i) => ({ seat: (i + 1) as SeatNo, account: a, row: null, games: 0 })),
        };
        const app = computeApplication(game, start, {
          ratings: new Map(seats.flatMap((a) => (rows.has(a) ? [[a, rows.get(a)!] as const] : []))),
          seasons: new Map(seats.flatMap((a) => (records.has(`${a}|${season}`) ? [[a, records.get(`${a}|${season}`)!] as const] : []))),
          listed: new Map(seats.map((a) => [a, true] as const)),
        }, { floors: P.floors1v1, appliedAt: iso(t) });
        sim.forEach((x, i) => {
          const a = seats[i]!;
          const seat = app.applied.seats[i]!;
          expect({ before: x.before, awayMs: x.awayMs, after: x.after, displayBefore: x.displayBefore, displayAfter: x.displayAfter, tierAfter: x.tierAfter })
            .toEqual({ before: seat.before, awayMs: seat.awayMs, after: seat.after, displayBefore: seat.displayBefore, displayAfter: seat.displayAfter, tierAfter: seat.tierAfter });
          const row = app.applied.ratings[i]!.row;
          expect({ state: x.row.state, season: x.row.season, lastRatedAt: iso(x.row.lastRatedMs!), games: x.row.games, tier: x.row.tier })
            .toEqual({ state: row.state, season: row.season, lastRatedAt: row.lastRatedAt, games: row.games, tier: row.tier });
          expect(toSeasonRecord(ladder, a, x.record)).toEqual(app.applied.seasonRecords[i]);
          expect(app.notices[i]!.tierBefore).toBe(x.tierBefore);
          simRows.set(a, x.row);
          simRecords.set(`${a}|${season}`, x.record);
          rows.set(a, row);
          records.set(`${a}|${season}`, app.applied.seasonRecords[i]!);
        });
      }
      // the close of the first season: final standings, competition ranks, badges
      const season = '2027-01';
      const endsMs = seasonEndMs(season);
      const sims = [...simRecords.entries()].filter(([k]) => k.endsWith(season));
      const pkgFinals = sims.map(([k]) => finalStandingOf(ladder, records.get(k)!, iso(endsMs)));
      expect(sims.map(([, r]) => finalStandingSim(ladder, r, endsMs, P))).toEqual(pkgFinals);
      expect(competitionRanksOf(pkgFinals)).toEqual(competitionRanks(pkgFinals));
      closeSimSeason(ladder, sims.map(([, r]) => r), season, P, P.floors1v1);
      sims.forEach(([k, r]) => expect(r.badge).toBe(badgeTier(records.get(k)!.seasonRatings, records.get(k)!.careerGames)));
      expect(def.placementGames).toBe(10);
    }
  });

  it('the solo model\'s badge is badgeTier, and a changed knob changes the result', () => {
    const rng = new Rng('pin-solo');
    for (const model of ['glicko2', 'wenglin'] as const) {
      const s = newSolo(model, P, Date.UTC(2027, 2, 1));
      for (let g = 1; g <= 60; g++) {
        soloGame(s, 1650, Date.UTC(2027, 2, 1) + g * 3_600_000, rng, P);
        expect(soloBadge(s, P.floors1v1, P)).toBe(badgeTier(s.seasonRatings, s.games, P.floors1v1));
      }
    }
    const a: Glicko2State = { model: 'glicko2', r: 1500, rd: 60, vol: 0.06 };
    expect(rate1v1(a, a, 1, 0, 0, simParams({ vol0: 0.08 }))[0].r).toBe(rate1v1(a, a, 1, 0, 0, P)[0].r);
    expect(rate1v1({ ...a, vol: 0.08 }, a, 1, 0, 0, P)[0].r).toBeGreaterThan(rate1v1(a, a, 1, 0, 0, P)[0].r);
    expect(rate1v1(a, a, 1, 30, 0, simParams({ idleVolPerDay: 0.09 }))[0].r).toBeGreaterThan(rate1v1(a, a, 1, 30, 0, P)[0].r);
    expect((resetState(a, simParams({ pull: 0.2 })) as Glicko2State).r).toBe(1500);
    const pod: WengLinState = { model: 'wenglin', mu: 25, sigma: 2 };
    expect(ratePodSim([pod, pod, pod, pod], [1, 2, 3, 4], [0, 0, 0, 0], simParams({ podTau: 25 / 100 }))[0]!.mu)
      .toBeGreaterThan(ratePodSim([pod, pod, pod, pod], [1, 2, 3, 4], [0, 0, 0, 0], P)[0]!.mu);
  });
});

describeSlow('M15-6: the random source and the true outcomes', () => {
  it('the same seed gives the same draws; another seed or stream gives others', () => {
    const a = new Rng('x');
    const b = new Rng('x');
    const xs = Array.from({ length: 50 }, () => a.next());
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(xs);
    expect(new Rng('y').next()).not.toBe(xs[0]);
    expect(new Rng('x').fork('f').next()).not.toBe(xs[0]);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });

  it('the pod sampler finishes i ahead of j with the 1v1 logistic chance (Luce\'s choice axiom)', () => {
    const rng = new Rng('luce');
    const skills = [1700, 1500, 1450, 1300];
    const ahead = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const n = 40_000;
    for (let k = 0; k < n; k++) {
      const places = playPod(rng, skills).seats.map((s) => s.place);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (places[i]! < places[j]!) ahead[i]![j]!++;
    }
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) expect(Math.abs(ahead[i]![j]! / n - winChance(skills[i]!, skills[j]!))).toBeLessThan(0.01);
    }
  });
});
