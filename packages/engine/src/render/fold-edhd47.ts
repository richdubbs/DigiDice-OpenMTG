/**
 * edh-d-47 (Commander lane exchange, second pass): the folds of its templates (parser/templates/zz-cloud/edh-d-47.json), called from render/fold.ts#foldAt.
 *
 * `gainControlCounter` (CR 108.4, 613.1b, 122.1, 122.6; Jinxed Choker): "target opponent gains control of ~ and puts a charge counter on it": a player other than you gains control
 * of one object for good and puts counters on it (the new controller is the player who puts them).
 * `untapGainControl` (CR 701.26b, 108.4, 613.1b; Karona, False God): "that player untaps ~ and gains control of it": the object is untapped, then a player other than you gains control.
 * `gainControlLoseAllCant` (CR 611.2a, 613.1b, 613.1f, 508.1c, 509.1b; Opportunistic Dragon): "For as long as ~ remains on the battlefield, gain control of that permanent, it loses all
 * abilities, and it can't attack or block": one instruction for one duration, you gain control and the object loses all abilities and can't attack or block.
 */
import type { EffectStep, ObjRef, PlayerRef } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import { NoRenderer } from './text';
import type { RenderState } from './state';
import { countersText } from './steps-life';
import { lasting } from './stat';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A lone permanent control change (layer 2, nothing else) as an `effect` step: the object and the new controller, else null. */
function lonePermanentControl(s: EffectStep | undefined): { what: ObjRef; controller: PlayerRef } | null {
  if (s?.op !== 'effect' || s.guard !== undefined || s.duration?.d !== 'permanent' || s.effects.length !== 1) return null;
  const e = s.effects[0]!;
  if (e.s !== 'continuous' || e.cda === true || e.mods.length !== 1) return null;
  const m = e.mods[0] as { layer?: unknown; controller?: PlayerRef };
  if (m.layer !== 2 || Object.keys(m).length !== 2 || m.controller === undefined || !('ref' in e.affects)) return null;
  return { what: e.affects as ObjRef, controller: m.controller };
}

function gainControlCounter(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = lonePermanentControl(list[i]);
  const c = list[i + 1];
  if (a === null || c?.op !== 'putCounters' || c.guard !== undefined || c.as !== undefined) return null;
  if (a.controller.ref === 'you' || a.controller.ref === 'ownerOf' || !same(a.what, c.on)) return null;
  if (c.upTo === true || c.distribute === true || c.kindOfChoice !== undefined || c.kind === 'energy' || c.kind === 'any' || !same(c.by, a.controller)) return null;
  const who = K.player(a.controller, st, 'subject');
  if (who.person !== 'sg') throw new NoRenderer('a plural or second-person new controller');
  return { clauses: [plain(`${who.text} gains control of ${K.obj(a.what, st, 'object').text} and puts ${countersText(c.count, c.kind, st)} on it`, { standalone: true })], consumed: 2 };
}

function untapGainControl(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const u = list[i];
  const a = lonePermanentControl(list[i + 1]);
  if (u?.op !== 'untap' || u.guard !== undefined || u.as !== undefined || a === null || a.controller.ref === 'you' || a.controller.ref === 'ownerOf' || !same(u.what, a.what)) return null;
  const who = K.player(a.controller, st, 'subject');
  if (who.person !== 'sg') throw new NoRenderer('a plural or second-person new controller');
  return { clauses: [plain(`${who.text} untaps ${K.obj(u.what as ObjRef, st, 'object').text} and gains control of it`, { standalone: true })], consumed: 2 };
}

function gainControlLoseAllCant(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'effect' || s.guard !== undefined || s.duration === undefined || s.duration.d === 'permanent' || s.effects.length !== 4) return null;
  const [c, l, a, b] = s.effects as unknown as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
  if (c.s !== 'continuous' || c.cda === true || !same(c.mods, [{ layer: 2, controller: { ref: 'you' } }]) || !same(l.mods, [{ layer: 6, removeAll: true }]) || l.s !== 'continuous' || l.cda === true) return null;
  const restricts = (x: Record<string, unknown>, action: string): boolean => x.s === 'restrict' && x.mode === 'cant' && x.action === action && Object.keys(x).length === 4 && same(x.subject, c.affects);
  if (!same(l.affects, c.affects) || !restricts(a, 'attack') || !restricts(b, 'block') || !('ref' in (c.affects as object))) return null;
  const o = K.obj(c.affects as ObjRef, st, 'object').text;
  return { clauses: [plain(lasting(`gain control of ${o}, it loses all abilities, and it can't attack or block`, s.duration, st), { standalone: true })], consumed: 1 };
}

/** The folds of edh-d-47 (render/fold.ts#foldAt). */
export function foldEdhD47(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return gainControlCounter(list, i, st) ?? untapGainControl(list, i, st) ?? gainControlLoseAllCant(list, i, st);
}
