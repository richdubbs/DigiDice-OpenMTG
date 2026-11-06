/**
 * edh-c-95 (Commander lane edh-c, EDHREC ranks 24,001-24,500, third pass): the folds of its templates (parser/templates/zz-cloud/edh-c-95.json), called from
 * render/fold.ts#foldAt.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `gainLifeXPerSpentColor` (CR 119.3, 601.2h, 608.2c; Dawnglow Infusion; eff.edhv95.gainlife.x.perSpentColor): ONE life gain of X for each of {G} and {W} among the mana spent
 * (ruling 2008-05-01: a "whenever you gain life" ability triggers once), said "You gain X life if {G} was spent to cast ~ and X life if {W} was spent to cast ~." Only that exact shape.
 */
function gainLifeXPerSpentColor(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'gainLife' || a.guard !== undefined || a.as !== undefined || !same(a.who, { ref: 'you' })) return null;
  if (Object.keys(a).some((k) => !['op', 'who', 'amount'].includes(k))) return null;
  if (!same(a.amount, { q: 'math', op: '*', args: [{ q: 'X' }, { q: 'colorsSpent', among: ['G', 'W'] }] })) return null;
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  return { clauses: [plain(`you gain X life if {G} was spent to cast ${self} and X life if {W} was spent to cast ${self}`, { standalone: true })], consumed: 1 };
}

/** The folds of edh-c-95 (render/fold.ts#foldAt). */
export function foldEdhV95(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return gainLifeXPerSpentColor(list, i, st);
}
