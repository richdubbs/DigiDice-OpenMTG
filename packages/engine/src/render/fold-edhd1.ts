/**
 * edh-d-1 (Commander coordinator D, EDHREC ranks 10,001-11,250): the folds of its templates (parser/templates/zz-cloud/edh-d-1.json), called from render/fold.ts#foldAt.
 *
 * `chooseAtRandomDestroyRest` (CR 608.2d, 701.8a, 700.2; Last One Standing): "Choose a creature at random, then destroy the rest." The game picks one permanent of a kind
 * among ALL the permanents of that kind, then every other one is destroyed. Exactly the two steps of template eff.edhd1.choose.oneAtRandom.thenDestroyRest.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function chooseAtRandomDestroyRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.random !== true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined
    || a.link !== undefined || a.distinct !== undefined || a.damageSource !== undefined || a.as === undefined || a.min !== 1 || a.max !== 1) return null;
  if (a.who.ref !== 'you' || a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const f = a.from.filter;
  const kinds = f.anyOf;
  if (kinds?.length !== 1 || Object.keys(f).length !== 1) return null;
  if (b?.op !== 'destroy' || b.guard !== undefined || b.as !== undefined || b.what.ref !== 'each' || !('filter' in b.what)) return null;
  if (!same(b.what.filter, { anyOf: kinds, not: { is: { ref: 'bound', name: a.as } } })) return null;
  bind(st, a.as, { nouns: K.nounsOf(kinds[0]!), plural: false });
  return { clauses: [plain(`choose ${K.np(kinds[0]!, st, { det: 'a' })} at random, then destroy the rest`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-d-1 (render/fold.ts#foldAt). */
export function foldEdhD1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return chooseAtRandomDestroyRest(list, i, st);
}
