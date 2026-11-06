/**
 * edh-d-61 (Commander lane transform, second pass): the folds of its templates, called from render/fold.ts#foldAt.
 *
 * `transformAOne` (CR 701.27a, 608.2d, 701.27c; Sunder the Gateway, eff.edhd61.transform.aFilter): "Incubate 2, then transform an Incubator token you control.": your choice of one
 * permanent of a description (chosen as the instruction resolves, no target) and the transform of exactly that one. Only those two steps, the permanent chosen read by nothing after them.
 */
import type { EffectStep } from '../types/ability';
import { cloneState } from './state';
import type { RenderState } from './state';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';

function transformAOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'changeFace' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || a.min !== 1 || a.max !== 1) return null;
  if (a.who.ref !== 'you' || a.from.ref !== 'each' || JSON.stringify(b.what) !== JSON.stringify({ ref: 'bound', name: a.as }) || b.to !== 'transform' || b.manifest !== undefined || b.faceDownAs !== undefined) return null;
  if (Object.keys(a).some((k) => !['op', 'who', 'from', 'min', 'max', 'as'].includes(k)) || Object.keys(b).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const text = `transform ${K.np(a.from.filter, cloneState(st), { det: 'a', plural: false })}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * `gainUntapTransformSelf` (CR 119.3, 701.26b, 701.27a; Azor's Gateway, eff.edhd61.gainLife.untapSelf.andTransformIt): "you gain 5 life, untap ~, and transform it": the three steps
 * said as one list. Only a gain of life by you, the untap of ~ and its transform, in that order and with nothing else on them.
 */
function gainUntapTransformSelf(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'gainLife' || b?.op !== 'untap' || c?.op !== 'changeFace') return null;
  if (a.who.ref !== 'you' || a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || a.as !== undefined) return null;
  if (JSON.stringify(b.what) !== '{"ref":"self"}' || JSON.stringify(c.what) !== '{"ref":"self"}' || c.to !== 'transform' || c.manifest !== undefined || c.faceDownAs !== undefined) return null;
  if (Object.keys(a).some((k) => !['op', 'who', 'amount'].includes(k)) || Object.keys(b).some((k) => !['op', 'what'].includes(k)) || Object.keys(c).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  const text = `gain ${K.qty(a.amount, st)} life, untap ~, and transform it`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

export function foldEdhD61(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return transformAOne(list, i, st) ?? gainUntapTransformSelf(list, i, st);
}
