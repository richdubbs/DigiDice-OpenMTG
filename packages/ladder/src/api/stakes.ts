/**
 * M15-2: the stakes of a ranked start (design 6.4, 13.1): what one game can do to a player's shown rating, for the start banner and the end screen.
 * Browser-safe: no `node:` imports, here or in anything this file imports. Exposed only through the named re-export in ../api.ts.
 * Imports: values only from ./constants or files of this part's own (./glicko2, ./wenglin, ./display); from ../api types only (`import type`). ../api
 * re-exports this file, so a value taken from ../api would be undefined while the contract loads (a cycle; test/m15-1/load.test.ts refuses one).
 *
 * A preview: the service computes it from ratingNow at startedAt, and a game that ends in the next season is rated after that season's reset, so the
 * rated change can differ (G10b). Each change is the difference of two SHOWN ratings (displayRating after − displayRating before, whole points), the
 * same difference the end screen shows between RatedNotice.before and .after. What stakes reveal about the opponent is accepted (6.4).
 */
import type { Glicko2State, Place, WengLinState } from '../api';
import { displayRating } from './display';
import { rateOneVsOne } from './glicko2';
import { ratePod } from './wenglin';

/** 6.4: the change of `me`'s shown rating for a win, a draw and a loss against `opponent` (both as ratingNow(...).state; days as for rateOneVsOne). */
export function stakesOneVsOne(me: Glicko2State, opponent: Glicko2State, daysMe: number, daysOpponent: number): { win: number; draw: number; loss: number } {
  const before = displayRating(me);
  const change = (score: 0 | 0.5 | 1) => displayRating(rateOneVsOne(me, opponent, score, daysMe, daysOpponent)[0]) - before;
  return { win: change(1), draw: change(0.5), loss: change(0) };
}

/**
 * 6.4: the change of players[me]'s shown rating for each place of the pod (index 0 = 1st), with the other players in rating order; `players` as
 * ratingNow(...).state and `days` as for ratePod.
 * For place k, players[me] finishes k-th and the others take the remaining places, strictly, in the order of their ratings (the higher μ ahead; equal
 * μ in seat order). Throws a RangeError on a `me` that is not an index of `players`, and as ratePod does.
 */
export function stakesPod(players: readonly WengLinState[], me: number, days: readonly number[]): number[] {
  if (!Number.isInteger(me) || me < 0 || me >= players.length) throw new RangeError(`stakes: me must be an index of the ${players.length} players (${String(me)})`);
  const before = displayRating(players[me]!);
  const others = players.map((_, i) => i).filter((i) => i !== me).sort((a, b) => players[b]!.mu - players[a]!.mu || a - b);
  return players.map((_, k) => {
    const order = [...others.slice(0, k), me, ...others.slice(k)];
    const places = players.map(() => 0 as Place);
    order.forEach((seat, at) => { places[seat] = (at + 1) as Place; });
    return displayRating(ratePod(players, places, days)[me]!) - before;
  });
}
