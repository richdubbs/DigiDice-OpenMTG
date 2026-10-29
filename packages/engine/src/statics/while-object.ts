/**
 * std-rx32: the duration `whileObject` ("for as long as it remains tapped", "for as long as it has a flood counter on it", CR 611.2b), judged from the state of
 * the object it names, never from characteristics, so the layer system (statics/live.ts, statics/rule-sources.ts) and core/durations.ts can read it at any
 * time without recursion. The object was fixed as the effect began (effects/handlers/lasting-fix.ts#fixDuration).
 */
import type { Duration } from '../types/ability';
import type { GameState } from '../types/state';
import { wasCastKept } from './match';
import { noteLayerRead, READ_TAPPED } from './layer-reads';

/** Does a `whileObject` duration still hold? Over once the object left the battlefield (a new object, CR 400.7), phased out, untapped, lost the counters or is no longer attached to `to`; `kept`: once its caster lost control of the spell or the permanent it became. */
export function whileObjectHolds(s: GameState, d: Extract<Duration, { d: 'whileObject' }>): boolean {
  const ref = d.object;
  if (ref.ref !== 'fixed' || !('objects' in ref) || ref.objects.length === 0) return false;
  return ref.objects.some((h) => {
    const o = s.objects[h.id];
    // audit-fix-2 (CR 702.62a, 400.7a): "until you lose control of the spell or the permanent it becomes": still that spell on the stack or that permanent (the
    // set is carried to it, statics/spell-carry.ts#carried), its caster in control without a break. A phased-out permanent is still controlled (CR 702.26d).
    if (d.as === 'kept') {
      if (!o || o.zone !== h.zone || (o.zone !== 'stack' && o.zone !== 'battlefield')) return false;
      const caster = o.zone === 'stack' ? (o.stack?.kind === 'spell' ? o.stack.caster : undefined) : o.cast?.by;
      return caster !== undefined && wasCastKept(o, caster);
    }
    if (!o || o.zone !== h.zone || o.zone !== 'battlefield' || o.phasedOut) return false;
    // std-combat-1 (CR 611.2b, 301.5, 400.7): still attached to one of the objects `to` fixed as the effect began (each still that object on the battlefield)
    if (d.as === 'attached') {
      const to = d.to;
      if (to === undefined || to.ref !== 'fixed' || !('objects' in to)) return false;
      return to.objects.some((t) => { const x = s.objects[t.id]; return x !== undefined && x.zone === t.zone && x.zone === 'battlefield' && o.attachedTo === t.id; });
    }
    if (d.as === 'tapped') { noteLayerRead(READ_TAPPED); return o.tapped; }
    return (o.counters[d.counter ?? ''] ?? 0) > 0;
  });
}
