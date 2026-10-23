/**
 * std-combat-5 (lane std-combat): the folds of its templates (parser/templates/zz-cloud/std-combat-5.json), called from render/fold.ts#foldAt.
 *
 * `threeTokens` (CR 111.1, 111.2; eff.stdcombat5.token.three): "create a 1/1 white Human creature token, a 1/1 blue Merfolk creature token, and a 1/1 red Goblin creature
 * token" (A Killer Among Us): three token creations by you in a row, said as one list. Only plain creations (no guard, no name bound, nothing said after them).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function threeTokens(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const steps = list.slice(i, i + 3);
  if (steps.length !== 3 || steps.some((x) => x.op !== 'createToken' || x.guard !== undefined || x.as !== undefined || x.who.ref !== 'you')) return null;
  const parts: string[] = [];
  for (const x of steps) {
    const c = K.clause(x, st);
    if (!c.imp.startsWith('create ') || c.standalone === true) return null;
    parts.push(c.imp.slice('create '.length));
  }
  return { clauses: [plain(`create ${parts[0]}, ${parts[1]}, and ${parts[2]}`)], consumed: 3 };
}

/** The folds of std-combat-5, tried before the shared ones (render/fold.ts#foldAt). */
export function foldStdCombat5(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return threeTokens(list, i, st);
}
