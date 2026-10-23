/**
 * Helpers of the M6-8 tests (m6 design 3.5, 5 "M6-8"): real fixture cards compiled by the default compiler (the game path), placed with the milestone 3
 * `scenario` helper and driven by real actions and answers through `applyAction`. Nothing is mocked.
 */
import { getChars, ptNumbers, type DecisionAnswer, type GameState, type ObjectId } from '../../../src/index';

export { answer, find, pass, scenario, tweak } from '../../m5/helpers';
export { activate, cast, drive, gamePath, nameOf, resolveAll, resolveTop, stackNames, target } from '../../m5/cr-examples/helpers';

/** The answers that choose the two words of a text change: a color by its letter, a land or creature type by its name. */
export const color = (c: 'W' | 'U' | 'B' | 'R' | 'G'): DecisionAnswer => ({ kind: 'chooseColor', color: c });
export const named = (name: string): DecisionAnswer => ({ kind: 'chooseName', name });

/** P/T after every layer. */
export function ptOf(s: GameState, id: ObjectId): [number | null, number | null] {
  const n = ptNumbers(getChars(s, id));
  return [n.power, n.toughness];
}

/** The keyword texts an object has after every layer ("Protection from blue", "Islandwalk"). */
export const keywordTexts = (s: GameState, id: ObjectId): string[] => getChars(s, id).abilities.filter((a) => a.def.kind === 'keyword').map((a) => a.def.text);

/** p1's lands, enough for any spell of these tests. */
export const islands = (n: number): string[] => Array(n).fill('Island') as string[];
