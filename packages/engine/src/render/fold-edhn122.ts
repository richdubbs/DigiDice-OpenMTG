/**
 * edh-next-122 (must-finish round, group copies): the folds of its templates (parser/templates/zz-cloud/edh-next-122.json), called from render/fold.ts#foldAt. As every fold, one
 * applies only when every part is exactly what the idiom says. No value import of render/fold.ts (an import cycle).
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Mystic Reflection (CR 614.1c, 616.1, 707.2, 608.2h; template eff.edhn122.nextEnter.asCopies.thisTurn): "The next time one or more creatures or planeswalkers enter this turn, they
 * enter as copies of the chosen creature.": one `effect` step of exactly one batch shield that lasts this turn, an entering creature or planeswalker, the copy of one object.
 */
function nextEnterAsCopies(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const e = list[i];
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1 || !same(e.duration, { d: 'endOfTurn' })) return null;
  const r = e.effects[0]!;
  if (r.s !== 'replace' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || !same(r.shield, { uses: 1, batch: true })) return null;
  if (!same(r.replaces, { ev: 'zoneChange', subject: { anyOf: [{ types: ['Creature'] }, { types: ['Planeswalker'] }] }, to: 'battlefield' })) return null;
  const b = r.body;
  if (b.b !== 'enters' || Object.keys(b).length !== 2 || b.copy === undefined) return null;
  const c = b.copy;
  if (Object.keys(c).sort().join(',') !== 'lastKnown,of,optional' || c.optional !== false || c.lastKnown !== true || Object.keys(c.of).length !== 1 || c.of.is === undefined) return null;
  const of = K.obj(c.of.is as ObjRef, st, 'object');
  if (of.plural) return null;
  return { clauses: [plain(`the next time one or more creatures or planeswalkers enter this turn, they enter as copies of ${of.text}`)], consumed: 1 };
}

/** The folds of edh-next-122 (render/fold.ts#foldAt). */
export function foldEdhN122(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return nextEnterAsCopies(list, i, st);
}
