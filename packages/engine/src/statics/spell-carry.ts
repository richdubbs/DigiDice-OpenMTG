/**
 * CR 400.7a: effects from spells, activated abilities and triggered abilities that change the characteristics or controller of a permanent spell on the stack
 * continue to apply to the permanent that spell becomes. Added by cmd4 (commander batch) beside core/move-parts/spell-effects.ts, which carries them over AFTER
 * the move: here the same carrying for the hypothetical permanent of CR 614.12 (statics/hooks.ts#onBattlefield, which keeps the object's id), so a replacement
 * effect that modifies how the permanent enters sees what those effects gave the spell ("Whenever you cast a Vampire creature spell, it gains bloodthirst 3":
 * the permanent enters with the counters). Pure.
 */
import type { ContinuousEffectRec, GameState } from '../types/state';

/** Does this stored effect change characteristics or control (a `continuous` effect of layers 1-7), with a fixed set that names the object on the stack? */
export function namesSpellOnStack(rec: ContinuousEffectRec, id: string): boolean {
  const e = rec.effect;
  if (e.s !== 'continuous') return false;
  const a = e.affects;
  return a.ref === 'fixed' && 'objects' in a && a.objects.some((h) => h.id === id && h.zone === 'stack');
}

/** The stored effect with its fixed set naming the permanent `id` on the battlefield too (also core/move-parts/spell-effects.ts, after the move); `from` is the spell's id on the stack. */
export function carried(rec: ContinuousEffectRec, id: string, from: string = id): ContinuousEffectRec {
  const e = rec.effect as Extract<ContinuousEffectRec['effect'], { s: 'continuous' }>;
  const a = e.affects as Extract<typeof e.affects, { ref: 'fixed'; objects: unknown }>;
  // audit-fix-2 (CR 702.62a, 400.7a): "until you lose control of the spell or the permanent it becomes": the duration's fixed object follows the spell too
  const d = rec.duration;
  const o = d.d === 'whileObject' && d.as === 'kept' && d.object.ref === 'fixed' && 'objects' in d.object ? d.object : undefined;
  const duration = o && o.objects.some((h) => h.id === from && h.zone === 'stack') ? { ...d, object: { ...o, objects: [...o.objects, { id, zone: 'battlefield' as const }] } } : d;
  return { ...rec, duration, effect: { ...e, affects: { ...a, objects: [...a.objects, { id, zone: 'battlefield' }] } } };
}

/** The stored effects of `s` with those that name the permanent spell `id` on the stack also naming it on the battlefield; null when none names it. */
export function carriedIntoHypothetical(s: GameState, id: string): ContinuousEffectRec[] | null {
  const o = s.objects[id];
  if (o?.zone !== 'stack' || o.kind === 'ability' || !s.continuousEffects.some((r) => namesSpellOnStack(r, id))) return null;
  return s.continuousEffects.map((r) => (namesSpellOnStack(r, id) ? carried(r, id) : r));
}
