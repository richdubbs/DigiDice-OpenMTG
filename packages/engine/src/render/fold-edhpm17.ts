/**
 * edh-perms-17 (Commander lane edh-perms): the folds of its templates (parser/templates/zz-cloud/edh-perms-17.json), called from render/fold.ts#foldAt.
 *
 * `gainControlUntapCounters` (CR 108.4, 613.1b, 701.26b, 122.1; Alexios, Deimos of Kosmos): "that player gains control of ~, untaps it, and puts a +1/+1 counter on it":
 * a player other than you gains control of one object for good, the object is untapped and gets counters; the second and third verbs take the first one's subject.
 * Exactly the three steps of template eff.edhpm17.player.gainControl.untapIt.counterOnIt (the two-step older idiom is render/fold.ts#gainControlThenUntap).
 */
import type { EffectStep, PlayerRef } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import { NoRenderer } from './text';
import type { RenderState } from './state';
import { countersText } from './steps-life';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function gainControlUntapCounters(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'effect' || b?.op !== 'untap' || c?.op !== 'putCounters' || a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || b.as !== undefined || c.as !== undefined) return null;
  if (a.duration?.d !== 'permanent' || a.effects.length !== 1) return null;
  const e = a.effects[0]!;
  if (e.s !== 'continuous' || e.mods.length !== 1 || e.mods[0]!.layer !== 2 || !same(e.affects, b.what) || !same(e.affects, c.on)) return null;
  if (c.upTo === true || c.distribute === true || c.kindOfChoice !== undefined || c.kind === 'energy') return null;
  const control = e.mods[0] as { layer: 2; controller: PlayerRef };
  if (control.controller.ref === 'you' || control.controller.ref === 'ownerOf') return null;
  if (!same(c.by, control.controller)) return null; // edh-top-5 (CR 122.6): the new controller is the player who puts the counter (putCounters.by)
  const who = K.player(control.controller, st, 'subject');
  if (who.person !== 'sg') throw new NoRenderer('a plural or second-person new controller');
  return { clauses: [plain(`${who.text} gains control of ${K.obj(b.what, st, 'object').text}, untaps it, and puts ${countersText(c.count, c.kind, st)} on it`, { standalone: true })], consumed: 3 };
}

/** The folds of edh-perms-17 (render/fold.ts#foldAt). */
export function foldEdhPm17(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return gainControlUntapCounters(list, i, st);
}
