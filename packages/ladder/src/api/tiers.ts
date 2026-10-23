/**
 * M15-2: the six tiers, their hysteresis and the season badge (design 6.3, 7, D6, D7, 13.1). Browser-safe: no `node:` imports, here or in anything
 * this file imports. Exposed only through the named re-export in ../api.ts.
 * Imports: values only from ./constants (TIER_IDS, DEFAULT_TIER_FLOORS, TIER_DEMOTION_BUFFER, SEASON_BADGE_GAMES, BADGE_CAREER_GAMES) or files of
 * this part's own; from ../api types only (`import type`). ../api re-exports this file, so a value taken from ../api would be undefined while the
 * contract loads (a cycle; test/m15-1/load.test.ts refuses one).
 *
 * Tiers are cosmetic: they unlock nothing and matchmaking ignores them. `floors` are the lowest shown ratings of Circuit, Pulse, Arc, Laser and
 * Prism (Wire is below the first); a ladder may have its own per season (LadderConfig.tierFloors), so every function takes them.
 */
import type { TierId } from '../api';
import { BADGE_CAREER_GAMES, DEFAULT_TIER_FLOORS, SEASON_BADGE_GAMES, TIER_DEMOTION_BUFFER, TIER_IDS } from './constants';

function finite(x: number, what: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new RangeError(`tiers: ${what} is not a finite number (${String(x)})`);
  return x;
}

/** One floor per tier above Wire, finite and strictly rising; a RangeError otherwise. */
function checkFloors(floors: readonly number[]): readonly number[] {
  if (!Array.isArray(floors) || floors.length !== TIER_IDS.length - 1) {
    throw new RangeError(`tiers: floors must be ${TIER_IDS.length - 1} numbers, one per tier above ${TIER_IDS[0]} (${String(floors)})`);
  }
  floors.forEach((f, i) => {
    finite(f, `floors[${i}]`);
    if (i > 0 && f <= floors[i - 1]!) throw new RangeError(`tiers: floors must rise strictly (${floors.join(', ')})`);
  });
  return floors;
}

/** The index in TIER_IDS of a shown rating, fresh: the number of floors at or below it. */
function tierIndex(display: number, floors: readonly number[]): number {
  return floors.filter((f) => f <= display).length;
}

/** The tier of a shown rating, fresh (no buffer): Wire below the first floor; `floors` defaults to DEFAULT_TIER_FLOORS. */
export function tierOf(display: number, floors: readonly number[] = DEFAULT_TIER_FLOORS): TierId {
  return TIER_IDS[tierIndex(finite(display, 'display'), checkFloors(floors))]!;
}

/**
 * 6.3: promotion at once; demotion only below the floor minus the buffer; `prev` null computes it fresh.
 * A rating at or above `prev`'s floor less TIER_DEMOTION_BUFFER (25) keeps `prev` (or promotes); one further down falls to the highest tier whose
 * floor less the buffer is still at or below it: an Arc player at 1530 stays Arc, at 1524 becomes Pulse; a Laser player at 1540 lands in Arc
 * (1525 ≤ 1540), not in Pulse where tierOf would put it. Placement's end and a season's reset pass `prev` null.
 */
export function tierAfter(prev: TierId | null, display: number, floors: readonly number[] = DEFAULT_TIER_FLOORS): TierId {
  finite(display, 'display');
  checkFloors(floors);
  const fresh = tierIndex(display, floors);
  if (prev === null) return TIER_IDS[fresh]!;
  const held = (TIER_IDS as readonly string[]).indexOf(prev);
  if (held < 0) throw new RangeError(`tiers: unknown tier (${String(prev)})`);
  if (fresh >= held) return TIER_IDS[fresh]!;
  // below prev's floor: the highest tier whose floor − buffer ≤ display, but never above prev
  return TIER_IDS[Math.min(held, tierIndex(display + TIER_DEMOTION_BUFFER, floors))]!;
}

/**
 * The season badge (7): tierOf(median(seasonRatings), floors), fresh, no buffer (the median of an even count is the mean of the two middle values).
 * Null with fewer than SEASON_BADGE_GAMES ratings or fewer than BADGE_CAREER_GAMES career games.
 * `seasonRatings` are the shown ratings after each post-placement game of the season (SeasonRecord.seasonRatings), in any order; `careerGames` the
 * account's career rated games in the ladder by its last game of the season. Throws a RangeError on a rating that is not a finite number or a
 * games count that is not a whole number of at least 0.
 */
export function badgeTier(seasonRatings: readonly number[], careerGames: number, floors: readonly number[] = DEFAULT_TIER_FLOORS): TierId | null {
  checkFloors(floors);
  if (!Number.isInteger(careerGames) || careerGames < 0) throw new RangeError(`tiers: careerGames must be a whole number of at least 0 (${String(careerGames)})`);
  const sorted = seasonRatings.map((r, i) => finite(r, `seasonRatings[${i}]`)).sort((a, b) => a - b);
  if (sorted.length < SEASON_BADGE_GAMES || careerGames < BADGE_CAREER_GAMES) return null;
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return TIER_IDS[tierIndex(median, floors)]!;
}
