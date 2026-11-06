/**
 * edh-d-29 (Commander coordinator D, lane attach second pass): the fold of its template eff.edhd29.forEach.mayAttachEquipment (parser/templates/zz-cloud/edh-d-29.json), called from
 * render/fold.ts#foldAt.
 *
 * (CR 701.3a, 301.5c, 608.2c-d; Goldwardens' Gambit, Reckless Crew; Scryfall rulings 2021-02-05, 2023-02-04: "You can't move the same Equipment around to each of the tokens as the ability
 * resolves", "You can't have more than one Equipment become attached to the same token"): "For each of those tokens, you may attach an Equipment you control to it." For each object an earlier
 * instruction bound, in turn, its controller may choose an Equipment they control that is not already attached to one of those objects, and attach it to that object (an Equipment on a
 * permanent outside the group may be moved). Exactly the shape the template builds: one `forEach` over the bound group, one `may` of "you" with a choice of one Equipment and the attach.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function forEachMayAttachEquipment(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.gather !== undefined || f.over.ref !== 'bound' || f.do.length !== 1) return null;
  const may = f.do[0];
  if (may?.op !== 'may' || may.guard !== undefined || may.otherwise !== undefined || may.anyOne !== undefined || may.villainous !== undefined || may.gather !== undefined || !same(may.who, { ref: 'you' }) || may.do.length !== 2) return null;
  const [choose, attach] = may.do;
  if (choose?.op !== 'chooseObjects' || choose.guard !== undefined || choose.random === true || choose.min !== 1 || choose.max !== 1 || !same(choose.who, { ref: 'you' }) || choose.perPlayer !== undefined || choose.distinct !== undefined) return null;
  if (!same(choose.from, { ref: 'each', filter: { subtypes: ['Equipment'], controller: 'you', not: { attachedToObject: f.over } } })) return null;
  if (attach?.op !== 'attach' || attach.guard !== undefined || attach.asCreature !== undefined || attach.hostAs !== undefined || !same(attach.what, { ref: 'bound', name: choose.as }) || !same(attach.to, { ref: 'bound', name: f.as })) return null;
  if (list.slice(i + 1).some((x) => JSON.stringify(x).includes(`"${choose.as}"`) || JSON.stringify(x).includes(`"${f.as}"`))) return null;
  const over = K.obj(f.over, st, 'object');
  if (!over.plural) return null;
  return { clauses: [plain(`for each of ${over.text}, you may attach an Equipment you control to it`, { standalone: true })], consumed: 1 };
}

/** The folds of edh-d-29 (render/fold.ts#foldAt). */
export function foldEdhD29(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return forEachMayAttachEquipment(list, i, st);
}
