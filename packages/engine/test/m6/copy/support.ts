/**
 * Helpers of the M6-2 tests (m6 design 3.3, 5 "M6-2"): real fixture cards compiled by the default compiler (the game path), placed with the milestone 3
 * `scenario` helper and driven by real actions and answers through `applyAction`. Nothing is mocked.
 */
import { ENGINE_CAPABILITIES, getChars, ptNumbers, type DecisionAnswer, type GameState, type ObjectId } from '../../../src/index';

export { answer, find, pass, scenario } from '../../m5/helpers';
export { cast, drive, gamePath, nameOf, resolveAll, resolveTop, stackNames, target } from '../../m5/cr-examples/helpers';

/** Choose `ids` in a `chooseObjects` decision (Clone's choice of what to copy, CR 707.5). */
export const pick = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });

/** The name, P/T and types a player sees for an object (after every layer). */
export function looks(s: GameState, id: ObjectId): { name: string; pt: [number | null, number | null]; types: string[]; subtypes: string[]; colors: string[] } {
  const c = getChars(s, id);
  const n = ptNumbers(c);
  return { name: c.name, pt: [n.power, n.toughness], types: [...c.types], subtypes: [...c.subtypes], colors: [...c.colors] };
}

/**
 * M6-1 is on this branch (merge order 4.3: M6-1, then M6-2). The tests of CR 616.1c and 616.1g need M6-1's chooser and `asItWouldEnter` (CR 614.12) with the
 * copy enters part's `hypothetical`; they live here (4.3: in the directory of the package that merges later) and run once both are on main.
 */
export const M6_1_MERGED = ENGINE_CAPABILITIES.has('feature:replace.foreign');
