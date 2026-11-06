/**
 * edh-next-63 (Commander lane counters): the folds of its templates (parser/templates/zz-cloud/edh-next-63.json), called from render/fold.ts#foldAt.
 *
 * `drawAndLose` (CR 121.1, 119.3, 608.2c; Eventide's Shadow): "You draw cards and lose life equal to the number of counters removed this way.": a draw of N cards and a
 * loss of N life by the controller, N one and the same number read at the start of each (a count of the removal right before). Only those two steps, in that order, with the
 * same quantity and nothing else on either.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function drawAndLose(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  const l = list[i + 1];
  if (d?.op !== 'draw' || l?.op !== 'loseLife' || d.who.ref !== 'you' || l.who.ref !== 'you' || d.guard !== undefined || l.guard !== undefined || d.as !== undefined || l.as !== undefined) return null;
  if (typeof d.count !== 'object' || d.count.q !== 'countersRemoved' || JSON.stringify(d.count) !== JSON.stringify(l.amount)) return null;
  return { clauses: [plain(`you draw cards and lose life equal to ${K.qty(d.count, st)}`)], consumed: 2 };
}

export function foldEdhN63(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return drawAndLose(list, i, st);
}
