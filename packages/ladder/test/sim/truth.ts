/**
 * M15-6: the synthetic players' true strength and how a game between them ends (design 16, M15-6: "1v1: logistic win chances; pods: Plackett-Luce
 * with Gumbel noise").
 *
 * A player's skill is in shown points (the one scale of both models, 5.2). In 1v1, A beats B with the logistic chance
 * 1 / (1 + 10^(−(sA − sB) / 400)), Glicko-2's own model (a 400-point gap is 10:1), less a small share of draws (CR 104.4a, unverified). In a pod each
 * player's performance is (s − 1500) / 173.7178 plus a standard Gumbel deviate and the order is by performance: that draws a Plackett-Luce order with
 * strengths exp((s − 1500) / 173.7178), in which i finishes ahead of j with the same logistic chance as in 1v1 (Luce's choice axiom), so a gap means
 * the same in both ladders, as the display scale of 5.2 intends.
 *
 * How honest games end (for the abuse heuristics, which read loss codes and turns; 11.1): a loser concedes, leaves, times out or disconnects in the
 * shares of HONEST_ENDINGS, otherwise loses by life (or another state-based loss); the game's last turn is 5 + a Poisson(4) number of turns; a small
 * share of losses are early concessions (turn 1 or 2: a bad mulligan, the wrong deck). These are assumptions of this simulation, stated in the report.
 */
import type { LossCode, Place } from '../../src/api';
import type { Rng } from './rng';

/** 400 / ln 10: Glicko-2's scale; the pod performance unit. */
export const SCALE = 173.7178;

/** A's chance to beat B, ignoring draws: Glicko-2's (and Elo's) logistic. */
export function winChance(sA: number, sB: number): number {
  return 1 / (1 + Math.pow(10, -(sA - sB) / 400));
}

export interface Endings {
  /** Share of 1v1 games that are draws (places 1, 1). */
  draw: number;
  /** Of losses: conceded, left, timed out, disconnected; the rest go out by life, library or poison. */
  concession: number;
  left: number;
  timeout: number;
  disconnect: number;
  /** Of losses: conceded on turn 1 or 2. */
  early: number;
  /** The game's last turn: base + Poisson(mean). */
  turnBase: number;
  turnMean: number;
}

/**
 * The defaults: about a third of losses conceded (best-of-one players often concede a lost board), a few leaves, time-outs and disconnects, 2% of
 * losses conceded on turn 1 or 2, games of 5-15 turns (mean 9). Draws are rare in best-of-one Magic: 0.5%.
 */
export const HONEST_ENDINGS: Readonly<Endings> = Object.freeze({
  draw: 0.005, concession: 0.33, left: 0.02, timeout: 0.02, disconnect: 0.01, early: 0.02, turnBase: 5, turnMean: 4,
});

export interface SeatEnding { place: Place; loss: LossCode | null; outTurn: number | null }
export interface GameEnding { turns: number; seats: SeatEnding[] }

function lossCode(rng: Rng, e: Readonly<Endings>): LossCode {
  const u = rng.next();
  let acc = e.concession;
  if (u < acc) return 'concession';
  if (u < (acc += e.left)) return 'left';
  if (u < (acc += e.timeout)) return 'timeout';
  if (u < (acc += e.disconnect)) return 'disconnect';
  const v = rng.next();
  return v < 0.9 ? 'life' : v < 0.96 ? 'emptyLibrary' : 'poison';
}

/** A 1v1 game between true skills: places in seat order, with the honest ending. */
export function play1v1(rng: Rng, sA: number, sB: number, e: Readonly<Endings> = HONEST_ENDINGS): GameEnding {
  let turns = e.turnBase + rng.poisson(e.turnMean);
  if (rng.chance(e.draw)) {
    return { turns, seats: [{ place: 1, loss: 'draw', outTurn: turns }, { place: 1, loss: 'draw', outTurn: turns }] };
  }
  const aWins = rng.chance(winChance(sA, sB));
  let loss = lossCode(rng, e);
  if (rng.chance(e.early)) {
    loss = 'concession';
    turns = 1 + rng.int(2);
  }
  const win: SeatEnding = { place: 1, loss: null, outTurn: null };
  const lose: SeatEnding = { place: 2, loss, outTurn: turns };
  return { turns, seats: aWins ? [win, lose] : [lose, win] };
}

/** A pod between true skills: a Plackett-Luce order by Gumbel noise (strict places), the honest ending for each player who went out. */
export function playPod(rng: Rng, skills: readonly number[], e: Readonly<Endings> = HONEST_ENDINGS): GameEnding {
  const perf = skills.map((s) => (s - 1500) / SCALE + rng.gumbel());
  const order = skills.map((_, i) => i).sort((i, j) => perf[j]! - perf[i]! || i - j);
  const n = skills.length;
  const turns = e.turnBase + 3 + rng.poisson(e.turnMean + 2);
  const seats: SeatEnding[] = skills.map(() => ({ place: 1, loss: null, outTurn: null }));
  // the last place goes out first; each later exit on a later (or the same) turn
  let turn = Math.max(1, turns - (n - 1) * 2 - rng.int(3));
  for (let k = n - 1; k >= 1; k--) {
    const seat = order[k]!;
    const early = k === n - 1 && rng.chance(e.early);
    seats[seat] = { place: (k + 1) as Place, loss: early ? 'concession' : lossCode(rng, e), outTurn: early ? 1 + rng.int(2) : Math.min(turn, turns) };
    turn += 1 + rng.int(3);
  }
  seats[order[0]!] = { place: 1, loss: null, outTurn: null };
  return { turns, seats };
}
