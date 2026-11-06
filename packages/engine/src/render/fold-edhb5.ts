/**
 * edh-b-5 (Commander lane edh-b, EDHREC ranks 8,001-9,000, second pass): the folds of its templates (parser/templates/zz-cloud/edh-b-5.json), called from
 * render/fold.ts#foldAt.
 *
 * `shuffleThenVillainous` (CR 701.24a, 701.55a, 608.2d; This Is How It Ends, eff.edhb5.shufflesIntoLibrary.thenVillainous): "Target creature's owner shuffles it into their library, then faces a villainous choice -- They lose 5 life, or they
 * shuffle another creature they own into their library.": the move and shuffle of the target, then the owner's villainous choice between losing a fixed amount of life and
 * shuffling a creature they own into their library. Only that exact shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const json = JSON.stringify;

function shuffleThenVillainous(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [mv, sh, may] = [list[i], list[i + 1], list[i + 2]];
  if (mv?.op !== 'move' || sh?.op !== 'shuffle' || may?.op !== 'may' || may.villainous !== true) return null;
  if (mv.what.ref !== 'target' || mv.guard !== undefined || mv.as !== undefined || mv.until !== undefined) return null;
  const owner = { ref: 'ownerOf', object: mv.what };
  const lib = { zone: 'library', owner };
  if (json(mv.to) !== json(lib) || json(sh.who) !== json(owner) || json(may.who) !== json(owner) || sh.guard !== undefined) return null;
  if (may.guard !== undefined || may.as !== undefined || may.anyOne !== undefined || may.gather !== undefined || may.do.length !== 1 || may.otherwise?.length !== 3) return null;
  const [lose] = may.do;
  if (lose?.op !== 'loseLife' || typeof lose.amount !== 'number' || json(lose.who) !== json(owner) || lose.guard !== undefined) return null;
  const [pick, move, shuffle] = may.otherwise;
  if (pick?.op !== 'chooseObjects' || move?.op !== 'move' || shuffle?.op !== 'shuffle' || pick.as === undefined) return null;
  if (json(pick.who) !== json(owner) || pick.min !== 1 || pick.max !== 1 || pick.random !== undefined || pick.guard !== undefined || pick.groupLimit !== undefined || pick.perPlayer !== undefined) return null;
  if (json(pick.from) !== json({ ref: 'each', filter: { types: ['Creature'], owner } })) return null;
  if (json(move.what) !== json({ ref: 'bound', name: pick.as }) || json(move.to) !== json(lib) || json(shuffle.who) !== json(owner) || move.guard !== undefined || shuffle.guard !== undefined) return null;
  const head = K.steps([mv, sh], st).replace(/\.$/, '');
  return { clauses: [plain(`${head}, then faces a villainous choice -- they lose ${lose.amount} life, or they shuffle another creature they own into their library`, { standalone: true })], consumed: 3 };
}

export function foldEdhB5(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return shuffleThenVillainous(list, i, st);
}
