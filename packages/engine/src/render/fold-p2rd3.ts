/**
 * p2-replace-damage-3 (Phase 2 lane p2-replace-damage): the folds of its templates (parser/templates/zz-cloud/p2-replace-damage-3.json), called from
 * render/fold.ts#foldAt. As every fold, one applies only when every part is exactly what the idiom says (same players, bound names, nothing else in between).
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** render/fold.ts#SOURCE_CHOICE_ZONES (FAST5 T36, CR 609.7a), said again here: a value import of fold.ts would be an import cycle (design 5.4). */
const SOURCE_CHOICE_ZONES = ['battlefield', 'stack'];

/**
 * "The next time a source of your choice would deal damage to you this turn, that damage is dealt to this creature instead." (Beacon of Destiny), "... to target
 * creature this turn, that damage is dealt to this creature instead." (Shaman en-Kor; CR 609.7a, 614.9, 615.7 by analogy): the source is chosen as the ability
 * resolves, then a one-use shield that redirects the damage that source would deal to you, or to one object named by its reference, to another object. Exactly the
 * two steps of the templates eff.p2rd3.redirect.nextSourceOfChoice.*; the chosen source is named nowhere else.
 */
function sourceOfChoiceRedirect(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const e = list[i + 1];
  if (c?.op !== 'chooseObjects' || c.who.ref !== 'you' || c.guard !== undefined || c.as === undefined || c.min !== 1 || c.max !== 1 || c.random !== undefined) return null;
  if (!same(c.from, { ref: 'each', filter: { zone: SOURCE_CHOICE_ZONES } })) return null;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1 || e.duration === undefined) return null;
  const r = e.effects[0]!;
  if (r.s !== 'replace' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || !same(r.shield, { uses: 1 })) return null;
  if (r.body.b !== 'redirect' || r.body.amount !== undefined) return null;
  const ev = r.replaces;
  if (ev.ev !== 'damage' || !same(ev.source, { is: { ref: 'bound', name: c.as } }) || ev.combat !== undefined || ev.amount !== undefined) return null;
  const rec = ev.recipient;
  const one = rec?.object !== undefined && rec.player === undefined && Object.keys(rec.object).length === 1 && rec.object.is !== undefined;
  const you = same(rec, { player: 'you' });
  if (!one && !you) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(c.as)}`))) return null;
  const to = you ? 'you' : K.obj(rec!.object!.is!, st, 'object').text;
  const dur = K.dur(e.duration, st);
  const text = `the next time a source of your choice would deal damage to ${to}${dur ? ` ${dur}` : ''}, that damage is dealt to ${K.obj(r.body.to as ObjRef, st, 'object').text} instead`;
  return { clauses: [plain(text)], consumed: 2 };
}

/** The folds of p2-replace-damage-3 (render/fold.ts#foldAt). */
export function foldP2ReplaceDamage3(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return sourceOfChoiceRedirect(list, i, st);
}
