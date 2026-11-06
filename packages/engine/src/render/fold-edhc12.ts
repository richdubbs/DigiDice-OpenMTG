/**
 * Commander lane edh-c, round edh-c-12: the fold of the steps its templates build (render/fold.ts#foldAt tries `foldEdhC12` after the other slices' own folds). A fold applies
 * only when every part is exactly what the idiom says.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { noRegeneration } from './steps-zones';

/**
 * "Sacrifice this enchantment and destroy all creatures. They can't be regenerated." (Planar Collapse; CR 701.21a, 701.8a, 701.19c, 608.2c): the sacrifice of the object itself and
 * the destroy of every object of a description that can't be regenerated, the sacrifice said with the destroy ("... and destroy ..."). Exactly the two steps the generic templates eff.sacrifice and
 * eff.destroy (with rid.noregen) build.
 */
function sacrificeSelfAndDestroyAll(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'sacrifice' || b?.op !== 'destroy' || JSON.stringify(a.what) !== '{"ref":"self"}' || Object.keys(a).some((k) => k !== 'op' && k !== 'what')) return null;
  if (b.what.ref !== 'each' || b.regeneration !== 'cant' || Object.keys(b).some((k) => !['op', 'what', 'regeneration'].includes(k))) return null;
  const me = K.obj({ ref: 'self' }, st, 'object').text;
  const what = K.obj(b.what, st, 'object').text;
  return { clauses: [plain(`sacrifice ${me} and destroy ${what}. ${noRegeneration(b, st)}`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-c-12 (render/fold.ts#foldAt). */
export function foldEdhC12(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return sacrificeSelfAndDestroyAll(list, i, st);
}
