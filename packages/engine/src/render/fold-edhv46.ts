/**
 * edh-c-46 (Commander lane edh-c): the folds of its templates (parser/templates/zz-cloud/edh-c-46.json), called from render/fold.ts#foldAt. Each applies only when every part is
 * exactly what the idiom says.
 *
 * `thoseDiscardRandom` (CR 608.2c, 701.9a; Skull Rend, eff.edhv46.damageEachOpponent.thoseDiscardRandom): "~ deals 2 damage to each opponent. Those players each discard two cards at random.":
 * the discard step of the opponents directly after a damage step to each opponent; "those players" are the opponents the damage names. The plain "each opponent discards ..." stays a reading.
 */
import type { EffectStep } from '../types/ability';
import { alt } from './text';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function thoseDiscardRandom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [d, x] = [list[i - 1], list[i]];
  if (d?.op !== 'damage' || x?.op !== 'discard' || i === 0) return null;
  if (d.guard !== undefined || x.guard !== undefined || x.as !== undefined || x.mode !== 'random' || x.count === undefined) return null;
  if (!same(d.to, { ref: 'each', who: 'opponent' }) || !same(x.who, { ref: 'each', who: 'opponent' })) return null;
  if (typeof x.count !== 'number' || x.count < 1) return null;
  const alone = K.steps([x], st);
  const said = x.count === 1 ? 'a card' : `${K.qty(x.count, st)} cards`;
  return { clauses: [plain(alt(alone, `those players each discard ${said} at random`))], consumed: 1 };
}

export function foldEdhV46(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return thoseDiscardRandom(list, i, st);
}
