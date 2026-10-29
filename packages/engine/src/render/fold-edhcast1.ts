/**
 * edh-cast-1 (Commander lane edh-cast): the folds of its templates (parser/templates/zz-cloud/edh-cast-1.json), called from render/fold.ts#foldAt.
 *
 * `copyThenReturnOriginal` (CR 707.10, 707.10c, 608.2c, 400.3; Narset's Reversal): "Copy target instant or sorcery spell, then return it to its owner's hand. You may choose
 * new targets for the copy.": the copy of the target spell (the copy is put on the stack first, with the option to choose new targets), then the move of the original spell
 * from the stack to its owner's hand. Oracle says the copy's new targets last. Only that exact shape: the copy of a target by you with nothing but the new-targets option,
 * the move of that same target to its owner's hand with no guard, name, duration or link.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function copyThenReturnOriginal(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'copy' || a.result !== 'spell' || a.newTargets !== 'may' || a.what.ref !== 'target' || JSON.stringify(a.who) !== JSON.stringify({ ref: 'you' })) return null;
  if (a.count !== undefined || a.except !== undefined || a.noManaCost !== undefined || a.guard !== undefined || a.as !== undefined || a.gains !== undefined) return null;
  if (b?.op !== 'move' || JSON.stringify(b.what) !== JSON.stringify(a.what) || JSON.stringify(b.to) !== JSON.stringify({ zone: 'hand' })) return null;
  if (b.guard !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined || b.as !== undefined) return null;
  const it = K.obj(a.what, st, 'object').text;
  return { clauses: [plain(`copy ${it}, then return it to its owner's hand. you may choose new targets for the copy`, { standalone: true })], consumed: 2 };
}

export function foldEdhCast1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return copyThenReturnOriginal(list, i, st);
}
