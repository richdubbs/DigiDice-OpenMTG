/**
 * edh-next-55 (Commander lane dice, round edhn55): words for die-roll results (CR 706.2, 706.3a). Helpers of render/steps-lasting.ts#rollDie; a pure function of the model.
 */
import { DIE_ROW_OPEN } from '../model/die-rows';
import type { EffectStep } from '../types/ability';
import { alt, numWord } from './text';

/**
 * The label of one result row of a die-roll table. A row of one result is "20"; an open last row "20+"; the first row (from 1) is also "9 or less" (Druid of the Emerald
 * Grove prints "9 or less | ..." for results 1 to 9: the same results, CR 706.3a); any other row "10-19".
 */
export function rowLabel(r: { min: number; max: number }, first: boolean, last: boolean): string {
  if (r.min === r.max) return `${r.min}`;
  if (r.max >= DIE_ROW_OPEN) return `${r.min}+`;
  const range = `${r.min}-${r.max}`;
  // edh-next-137 (CR 706.3a; Comet, Stellar Pup): a row of two consecutive results is also "1 or 2" (the dash form, `1 or 2 -- ...`)
  const words = [...(first && r.min === 1 && !last ? [`${r.max} or less`] : []), ...(r.max === r.min + 1 ? [`${r.min} or ${r.max}`] : [])];
  return words.length > 0 ? alt(range, ...words) : range;
}

type Row = { min: number; max: number; do: EffectStep[]; again?: 'may' };

const withoutCount = (x: EffectStep): string => JSON.stringify({ ...x, count: undefined, as: undefined });

/**
 * "Create two of those tokens." (CR 706.3a, 111.1; Swarming Goblins, Delina): a row whose only step makes the tokens an earlier row makes (the same token and flags, any number)
 * is also said with the earlier row's tokens as "those tokens". Null when the row is not such a row.
 */
export function ofThoseTokens(table: readonly Row[], k: number): string | null {
  const only = table[k]!.do.length === 1 ? table[k]!.do[0]! : undefined;
  // edh-next-121 (CR 706.3a, 707.2; Delina, Wild Mage): or the token copy an earlier row makes ("Create one of those tokens.")
  const tokenish = (x: EffectStep): boolean => x.op === 'createToken' || (x.op === 'copy' && x.result === 'token');
  const n = only === undefined ? undefined : only.op === 'copy' ? (only.count ?? 1) : only.op === 'createToken' ? only.count : undefined;
  if (only === undefined || !tokenish(only) || typeof n !== 'number' || !Number.isInteger(n) || n < 1) return null;
  for (let j = k - 1; j >= 0; j--) {
    const made = table[j]!.do.filter(tokenish);
    if (made.length > 0) return made.some((x) => withoutCount(x) === withoutCount(only)) ? `create ${numWord(n)} of those tokens` : null;
  }
  return null;
}

/** The mark between a row's results and its instructions: a bar, or (for a single result) the dash Six-Sided Die prints, "1 -- Destroy it." (CR 706.3a). */
export function rowSep(r: { min: number; max: number }): string {
  return r.min === r.max || r.max === r.min + 1 /* edh-next-137: "1 or 2 -- ..." (Comet, Stellar Pup) */ ? alt('|', '--') : '|';
}
