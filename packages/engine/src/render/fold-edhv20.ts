/**
 * edh-c-20 (Commander effort, EDHREC ranks 18,126 to 18,750, third pass): the folds of its templates (parser/templates/zz-cloud/edh-c-20.json), called from render/fold.ts#foldAt.
 *
 * `twoPumpGroups` (CR 611.2a, 611.2c, 613.4c; Agrus Kos, Wojek Veteran): "Attacking red creatures get +2/+0 and attacking white creatures get +0/+2 until end of turn." The one
 * `effect` step of template eff.edhv20.pump.twoGroups: two continuous effects of one layer-7c modification each, one duration: said as one sentence ("A get X and B get Y <duration>").
 */
import type { EffectStep, StaticEffect } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import type { RenderState } from './state';

function twoPumpGroups(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || a.guard !== undefined || a.as !== undefined || a.effects.length !== 2 || Object.keys(a).sort().join(',') !== 'duration,effects,op') return null;
  const parts: string[] = [];
  for (const e of a.effects as unknown[]) {
    const c = e as { s: string; cda?: boolean; mods: { layer: unknown }[]; affects: { ref?: string } };
    if (c.s !== 'continuous' || c.cda === true || c.mods.length !== 1 || c.mods[0]!.layer !== '7c' || c.affects.ref !== 'each') return null;
    parts.push(K.staticEffect(e as StaticEffect, st));
  }
  const dur = K.dur(a.duration, st, { context: 'mods' });
  return { clauses: [plain(`${parts[0]} and ${parts[1]} ${dur}`, { standalone: true })], consumed: 1 };
}

/** The folds of edh-c-20 (render/fold.ts#foldAt). */
export function foldEdhV20(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return twoPumpGroups(list, i, st);
}
