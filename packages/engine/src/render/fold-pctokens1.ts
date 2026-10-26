/**
 * pc-tokens-1: the folds of its templates (parser/templates/zz-cloud/pc-tokens-1.json), called from render/fold.ts#foldAt. CR cites from memory, unverified.
 *
 * `eachExplores` (CR 701.44a, 608.2f): "Each Merfolk creature you control explores." (Hakbal of the Surging Soul): a `forEach` over the permanents of a description whose one
 * step is the explore of the bound permanent by its controller. Exactly the steps of template eff.pctokens1.forEach.explores.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function eachExplores(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.gather !== undefined || f.as === undefined || f.over.ref !== 'each' || !('filter' in f.over) || f.do.length !== 1) return null;
  const a = f.do[0]!;
  if (a.op !== 'action' || a.action !== 'explore' || a.guard !== undefined || a.n !== undefined || a.as !== undefined) return null;
  const me = { ref: 'bound', name: f.as };
  if (!same(a.subject, me) || !same(a.who, { ref: 'controllerOf', object: me })) return null;
  const group = K.obj(f.over, st, 'object');
  return { clauses: [plain(`${group.text} explores`, { standalone: true })], consumed: 1 };
}

export function foldPcTokens1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachExplores(list, i, st);
}
