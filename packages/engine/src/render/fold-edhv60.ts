/**
 * edh-c-60 (Commander EDHREC ranks 17,501-18,000, sixth pass): the folds of its templates (parser/templates/zz-cloud/edh-c-60.json), called from render/fold.ts#foldAt.
 * As every fold, one applies only when every part is exactly what the idiom says (same players, bound names, nothing else in between). CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 * `unblockedChoicePreventAllBut` (CR 609.7a, 615.1, 615.7, 506.4; Forcefield, eff.edhv60.prevent.nextUnblockedChoice.combatToYou.allButN): the unblocked attacking creature is
 * chosen as the ability resolves, then a one-use shield that prevents all but N of the combat damage that creature would deal to you.
 *
 * `sourceChoiceRedirectToObj` (CR 609.7a, 614.9, 615.7 by analogy; Opal-Eye, Konda's Yojimbo, eff.edhv60.redirect.nextSourceChoice.toSelf): the source is chosen as the ability
 * resolves, then a one-use shield that redirects the damage that source would deal (to any recipient) to one object.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** render/fold.ts#SOURCE_CHOICE_ZONES (CR 609.7a), said again here: a value import of fold.ts would be an import cycle (design 5.4). */
const SOURCE_CHOICE_ZONES = ['battlefield', 'stack', 'command'];

/** The choice of one object as the damage source and the one `effect` step with one replacement that follows it; null when the shape differs. */
function choiceAndShield(list: EffectStep[], i: number): { c: Extract<EffectStep, { op: 'chooseObjects' }>; e: Extract<EffectStep, { op: 'effect' }>; r: Extract<Extract<EffectStep, { op: 'effect' }>['effects'][number], { s: 'replace' }> } | null {
  const c = list[i];
  const e = list[i + 1];
  if (c?.op !== 'chooseObjects' || c.who.ref !== 'you' || c.guard !== undefined || c.as === undefined || c.min !== 1 || c.max !== 1 || c.random !== undefined) return null;
  if (c.damageSource !== true || c.perPlayer !== undefined || c.startingWith !== undefined || c.from.ref !== 'each' || !('filter' in c.from)) return null;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1 || e.duration === undefined) return null;
  const r = e.effects[0]!;
  if (r.s !== 'replace' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || !same(r.shield, { uses: 1 })) return null;
  if (r.replaces.ev !== 'damage' || !same(r.replaces.source, { is: { ref: 'bound', name: c.as } })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(c.as)}`))) return null; // the chosen source is named nowhere else
  return { c, e, r } as never;
}

function unblockedChoicePreventAllBut(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = choiceAndShield(list, i);
  if (m === null) return null;
  const { c, e, r } = m;
  if (!same((c.from as { filter: unknown }).filter, { types: ['Creature'], attacking: true, blocked: false, zone: ['battlefield'] })) return null;
  const ev = r.replaces;
  if (ev.ev !== 'damage' || ev.combat !== true || ev.amount !== undefined || !same(ev.recipient, { player: 'you' })) return null;
  if (r.body.b !== 'prevent' || r.body.then !== undefined || r.body.as !== undefined || r.body.oncePerBatch !== undefined) return null;
  const a = r.body.amount;
  if (typeof a !== 'object' || a.q !== 'math' || a.op !== '-' || a.args.length !== 2 || !same(a.args[0], { q: 'eventAmount' })) return null;
  const dur = K.dur(e.duration, st);
  return { clauses: [plain(`the next time an unblocked creature of your choice would deal combat damage to you${dur ? ` ${dur}` : ''}, prevent all but ${K.qty(a.args[1]!, st)} of that damage`)], consumed: 2 };
}

function sourceChoiceRedirectToObj(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = choiceAndShield(list, i);
  if (m === null) return null;
  const { c, e, r } = m;
  if (!same((c.from as { filter: unknown }).filter, { zone: SOURCE_CHOICE_ZONES })) return null;
  const ev = r.replaces;
  if (ev.ev !== 'damage' || ev.combat !== undefined || ev.amount !== undefined || ev.recipient !== undefined) return null;
  if (r.body.b !== 'redirect' || r.body.amount !== undefined) return null;
  const dur = K.dur(e.duration, st);
  return { clauses: [plain(`the next time a source of your choice would deal damage${dur ? ` ${dur}` : ''}, that damage is dealt to ${K.obj(r.body.to as ObjRef, st, 'object').text} instead`)], consumed: 2 };
}

/** The folds of edh-c-60 (render/fold.ts#foldAt). */
export function foldEdhV60(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return unblockedChoicePreventAllBut(list, i, st) ?? sourceChoiceRedirectToObj(list, i, st);
}
