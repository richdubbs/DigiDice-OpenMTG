/**
 * edh-perms-12 (Commander lane edh-perms): the folds of its templates (parser/templates/zz-cloud/edh-perms-12.json), called from render/fold.ts#foldAt. CR cites from memory,
 * unverified unless the record says otherwise.
 *
 * `chooseUpToDestroyRest` (CR 608.2d, 701.8a; Mount Doom): "Choose up to two creatures, then destroy the rest." You choose at most N permanents of a kind among ALL the permanents of
 * that kind, then destroy every other one. Exactly the two steps of template eff.edhpm12.chooseUpTo.destroyRest.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { alt, numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function chooseUpToDestroyRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random === true || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined
    || a.link !== undefined || a.distinct !== undefined || a.damageSource !== undefined || a.as === undefined || a.min !== 0 || typeof a.max !== 'number' || a.max < 1) return null;
  if (a.who.ref !== 'you' || a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const f = a.from.filter;
  const kinds = f.anyOf;
  if (kinds?.length !== 1 || Object.keys(f).length !== 1) return null;
  if (b?.op !== 'destroy' || b.guard !== undefined || b.as !== undefined || b.what.ref !== 'each' || !('filter' in b.what)) return null;
  if (!same(b.what.filter, { anyOf: kinds, not: { is: { ref: 'bound', name: a.as } } })) return null;
  const n = a.max;
  const things = n === 1 ? `one ${K.np(kinds[0]!, st, { det: 'none' })}` : `${numWord(n)} ${K.np(kinds[0]!, st, { det: 'none', plural: true })}`;
  bind(st, a.as, { nouns: K.nounsOf(kinds[0]!), plural: n !== 1 });
  // edh-b-12 (family joiner; Duneblast): the two instructions are also two sentences, "Choose up to one creature. Destroy the rest."
  return { clauses: [plain(alt(`choose up to ${things}, then destroy the rest`, `choose up to ${things}. destroy the rest`), { standalone: true })], consumed: 2 };
}

/** The folds of edh-perms-12 (render/fold.ts#foldAt). */
export function foldEdhPm12(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return chooseUpToDestroyRest(list, i, st);
}
