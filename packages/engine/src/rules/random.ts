/**
 * Randomness for effects ("discard a card at random", CR 701.9b; choosing at random, "in a random order", rolling a die, flipping a coin, CR 705, 706): always
 * the game's own generator in the state (design 8.8 rule 2, docs/ARCHITECTURE.md principle 1), never Math.random, so a re-execution from the same base state
 * makes the same choice. The interpreter (effects/) may not import the top-level rng module (design 5.4), so it comes through here. WP13 INTERFACE CHANGE: a
 * new shared module. Owner: WP13 (first user); WP10 (`chooseObjects` at random), WP14 (`randomOrder`) and WP15 (rollDie, flipCoin) reuse it.
 */
import type { Game } from '../core/game';
import { randomInt, shuffleInPlace } from '../rng';

/** A uniformly random index in [0, n). */
export const randomIndex = (g: Game, n: number): number => randomInt(g.s.rng, n);

/** A copy of `items` in a random order. */
export const randomOrder = <T>(g: Game, items: readonly T[]): T[] => shuffleInPlace(g.s.rng, [...items]);
