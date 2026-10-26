/**
 * pc-combat-4 (Commander precon lane pc-combat): the fold of its template eff.pccombat4.player.drawAndGainControl, called from render/fold.ts#foldAt.
 *
 * `drawAndGainControl` (CR 121.1, 613.1b, 608.2c; Coveted Jewel): "that player draws three cards and gains control of ~": a draw by a player, then that player gaining control (for good)
 * of an object, said as one sentence with the player named once. Only that exact pair of steps.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function drawAndGainControl(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'draw' || b?.op !== 'effect' || b.duration?.d !== 'permanent' || b.effects.length !== 1) return null;
  const e = b.effects[0]!;
  if (e.s !== 'continuous' || e.mods.length !== 1) return null;
  const m = e.mods[0] as { layer?: unknown; controller?: unknown };
  if (m.layer !== 2 || Object.keys(m).length !== 2 || JSON.stringify(m.controller) !== JSON.stringify(a.who)) return null;
  // third person only ("that player draws ... and gains ..."): a player of the trigger's event
  if (a.who.ref !== 'event' || !('role' in a.who) || a.count === undefined) return null;
  const who = K.player(a.who, st, 'subject').text;
  const n = K.qty(a.count, st);
  if (!('ref' in e.affects) || (e.affects.ref !== 'self' && e.affects.ref !== 'bound' && e.affects.ref !== 'event')) return null;
  const o = K.obj(e.affects as ObjRef, st, 'object').text;
  return { clauses: [plain(`${who} draws ${n} ${n === '1' ? 'card' : 'cards'} and gains control of ${o}`, { standalone: true })], consumed: 2 };
}

export function foldPcCombat4(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return drawAndGainControl(list, i, st);
}
