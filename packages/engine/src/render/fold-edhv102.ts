/**
 * edh-c-102: the folds of its templates (parser/templates/zz-cloud/edh-c-102.json), called from render/fold.ts#foldAt. Each applies only when every part is exactly what the idiom says.
 * (A fold file never imports a value from fold.ts: fold.ts imports it back, an import cycle.)
 *
 * `countPermanentsLifeBecomes` (CR 119.5, 608.2c; Touch of the Eternal, eff.edhv102.countPermanents.lifeBecomes; family count-then-life-becomes): "Count the number of permanents you control.
 * Your life total becomes that number." is also "Your life total becomes the number of permanents you control." (the one setLife step). Exactly that step.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';
import { alt } from './text';

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function countPermanentsLifeBecomes(list: EffectStep[], i: number): Folded | null {
  const s = list[i];
  if (s?.op !== 'setLife' || s.guard !== undefined || !same(s.who, { ref: 'you' }) || !same(s.value, { q: 'count', of: { ref: 'each', filter: { controller: 'you' } } })) return null;
  if (Object.keys(s).some((k) => !['op', 'who', 'value'].includes(k))) return null;
  return { clauses: [plain(alt('your life total becomes the number of permanents you control', 'count the number of permanents you control. your life total becomes that number'), { standalone: true })], consumed: 1 };
}

export function foldEdhV102(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  return countPermanentsLifeBecomes(list, i);
}
