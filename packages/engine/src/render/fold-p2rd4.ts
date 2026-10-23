/**
 * p2-replace-damage-4 (Phase 2 lane p2-replace-damage): the folds of its templates (parser/templates/zz-cloud/p2-replace-damage-4.json), called from
 * render/fold.ts#foldAt. As every fold, one applies only when every part is exactly what the idiom says (same players, bound names, nothing else in between).
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import type { EffectStep, ObjectFilter } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** render/fold.ts#SOURCE_CHOICE_ZONES (FAST5 T36, CR 609.7a), said again here: a value import of fold.ts would be an import cycle (design 5.4). */
const SOURCE_CHOICE_ZONES = ['battlefield', 'stack'];

/**
 * "The next time an artifact source of your choice would deal damage to you this turn, prevent that damage." (Rune of Protection: Artifacts), "... a black or red
 * source of your choice ..." (Greater Realm of Preservation; CR 609.7a, 615.1a, 615.7): the source is chosen as the effect resolves among the objects of that
 * description, then a one-use shield on the damage that source would deal to you while it still has that description (the shield names it, as FAST5 T36's color
 * shield does). Exactly the two steps of template eff.p2rd4.prevent.nextDescribedSourceOfChoice.you; the chosen source is named nowhere else.
 */
function describedSourceOfChoiceShield(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const e = list[i + 1];
  if (c?.op !== 'chooseObjects' || c.who.ref !== 'you' || c.guard !== undefined || c.as === undefined || c.min !== 1 || c.max !== 1 || c.random !== undefined) return null;
  if (c.from.ref !== 'each' || !('filter' in c.from)) return null;
  const f = c.from.filter;
  const desc = f.anyOf?.length === 1 ? f.anyOf[0]! : undefined;
  if (desc === undefined || !same(f, { zone: SOURCE_CHOICE_ZONES, anyOf: [desc] })) return null;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1 || e.duration === undefined) return null;
  const r = e.effects[0]!;
  if (r.s !== 'replace' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || !same(r.shield, { uses: 1 })) return null;
  if (!same(r.body, { b: 'prevent', amount: 'all' })) return null;
  if (!same(r.replaces, { ev: 'damage', source: { is: { ref: 'bound', name: c.as }, anyOf: [desc] }, recipient: { player: 'you' } })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(c.as)}`))) return null;
  const dur = K.dur(e.duration, st);
  const which = K.np(desc as ObjectFilter, st, { det: 'a', head: 'source' });
  return { clauses: [plain(`the next time ${which} of your choice would deal damage to you${dur ? ` ${dur}` : ''}, prevent that damage`)], consumed: 2 };
}

/** The folds of p2-replace-damage-4 (render/fold.ts#foldAt). */
export function foldP2ReplaceDamage4(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return describedSourceOfChoiceShield(list, i, st);
}
