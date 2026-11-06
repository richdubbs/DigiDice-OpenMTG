/**
 * edh-next-97 (top-rank second pass 6): the folds of its readings, called from render/fold.ts#foldAt.
 *
 * `pumpThenOwnActivateBan` (CR 611.2a, 611.2c, 613.4c, 602.5; Dovin Baan's +1): "Until your next turn, up to one target creature gets -3/-0 and its activated abilities can't be
 * activated": a P/T change and the ban on activating the abilities of the same object, two steps of one sentence that share ONE stated duration (parser/lower/durations.ts gives the
 * second step the sentence's duration; the older eff.edhv11.its.cantActivate.permanent used to give it a permanent one), said as one sentence with the duration in front.
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import type { RenderState } from './state';
import { lasting } from './stat';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function pumpThenOwnActivateBan(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'effect' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (a.duration === undefined || a.duration.d === 'permanent' || !same(a.duration, b.duration) || a.effects.length !== 1 || b.effects.length !== 1) return null;
  const p = a.effects[0]!;
  const r = b.effects[0]!;
  if (p.s !== 'continuous' || p.cda === true || p.mods.length !== 1 || p.mods[0]!.layer !== '7c' || !('ref' in p.affects)) return null;
  if (r.s !== 'restrict' || r.mode !== 'cant' || r.action !== 'activate' || Object.keys(r).length !== 4 || !same(r.subject, p.affects)) return null;
  const pump = K.staticEffect(p, st);
  return { clauses: [plain(lasting(`${pump} and its activated abilities can't be activated`, a.duration, st), { standalone: true })], consumed: 2 };
}

/** The folds of edh-next-97 (render/fold.ts#foldAt). */
export function foldEdhN97(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return pumpThenOwnActivateBan(list, i, st);
}

