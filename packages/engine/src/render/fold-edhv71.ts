/**
 * edh-c-71 (Commander lane edh-c): the folds of its templates (parser/templates/zz-cloud/edh-c-71.json), called from render/fold.ts#foldAt. CR cites are from the Comprehensive
 * Rules text of 2026-09-25.
 *
 * `chooseColorThenDestroyEnchantments` (CR 105.4, 608.2c, 701.8a; Root Greevil, eff.edhv71.destroy.all.enchantments.colorOfYourChoice): the choice of a color and the destruction of every
 * enchantment of that color, said in one sentence, "Destroy all enchantments of the color of your choice." Both readings are the two steps (family choose-color-destroy-all). Only that exact shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function chooseColorThenDestroyEnchantments(list: EffectStep[], i: number): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseValue' || b?.op !== 'destroy') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.what !== 'color' || !same(a.who, { ref: 'you' }) || a.link !== 'color' || typeof a.as !== 'string') return null;
  if (!same(b.what, { ref: 'each', filter: { types: ['Enchantment'], chosen: { link: 'color', quality: 'color' } } }) || Object.keys(b).some((k) => !['op', 'what'].includes(k))) return null;
  const text = alt('choose a color. destroy all enchantments of the chosen color', 'destroy all enchantments of the color of your choice');
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

/** The folds of edh-c-71 (render/fold.ts#foldAt). */
export function foldEdhV71(list: EffectStep[], i: number): Folded | null {
  return chooseColorThenDestroyEnchantments(list, i);
}
