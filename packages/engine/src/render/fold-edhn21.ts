/**
 * edh-next-21: the fold of its template eff.edhn21.eachOpponent.poisonAtLeast.loseLife (parser/templates/zz-cloud/edh-next-21.json), called from render/fold.ts#foldAt.
 *
 * `eachOpponentPoisonLosesLife` (CR 122.1f, 104.3d, 119.3, 608.2c; Feed the Infection): "Each opponent who has three or more poison counters loses 3 life.": a forEach over each opponent
 * whose one instruction, taken for the opponents with at least that many poison counters, is that opponent losing an amount of life. Only that exact shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function eachOpponentPoisonLosesLife(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'forEach' || s.guard !== undefined || s.as === undefined || s.gather !== undefined || s.do.length !== 1 || !same(s.over, { ref: 'each', who: 'opponent' })) return null;
  const [c] = s.do;
  if (c?.op !== 'if' || c.guard !== undefined || c.as !== undefined || c.else !== undefined || c.then.length !== 1 || c.cond.cond !== 'compare' || c.cond.op !== '>=') return null;
  const who = { ref: 'bound', name: s.as };
  if (!same(c.cond.left, { q: 'counters', on: who, kind: 'poison' })) return null;
  const [l] = c.then;
  if (l?.op !== 'loseLife' || l.guard !== undefined || l.as !== undefined || !same(l.who, who)) return null;
  const text = `each opponent who has ${K.qty(c.cond.right, st)} or more poison counters loses ${K.qty(l.amount, st)} life`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

/** The folds of edh-next-21 (render/fold.ts#foldAt). */
export function foldEdhN21(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachOpponentPoisonLosesLife(list, i, st);
}
