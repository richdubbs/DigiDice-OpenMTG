/**
 * edh-next-98 (Commander effort, top-rank second pass 8): the fold of its template eff.edhn98.forEach.eachOpponentLoses1.youGain1 (parser/templates/zz-cloud/edh-next-98.json), called from
 * render/fold.ts#foldAtPlain. Never imports a value from render/fold.ts.
 *
 * `forEachDrain` (CR 119.3, 608.2c, 608.2h; Graveyard Glutton): "For each creature card exiled this way, each opponent loses 1 life and you gain 1 life." is each opponent losing, and you gaining, an
 * amount of life equal to a count: ONE life event each (Suffer the Past ruling: "a single life-gain event, not a number of separate ones"), said in the lead form or after the instructions ("Each opponent
 * loses 1 life and you gain 1 life for each creature card exiled this way"). Only that shape: the two steps with the same count, no guards.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { countParts } from './qty';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function foldEdhN98(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'loseLife' || b?.op !== 'gainLife' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (!same(a.who, { ref: 'each', who: 'opponent' }) || !same(b.who, { ref: 'you' }) || typeof a.amount !== 'object' || a.amount.q !== 'count' || !same(a.amount, b.amount)) return null;
  // only a count of what an earlier instruction moved ("exiled this way": a filter that is a bound group); "where X is the number of ..." wordings keep their own readings (eff.t26.drain.whereX)
  const of = a.amount.of as { ref?: string; filter?: { is?: { ref?: string } } };
  if (of.ref !== 'each' || of.filter?.is?.ref !== 'bound') return null;
  const parts = countParts(a.amount, st);
  if (parts === null) return null;
  const text = alt(`each opponent loses 1 life and you gain 1 life for each ${parts.singular}`, `for each ${parts.singular}, each opponent loses 1 life and you gain 1 life`);
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}
