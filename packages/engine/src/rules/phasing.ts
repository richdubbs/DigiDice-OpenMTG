/**
 * Phasing (CR 702.26, 502.1). Added by WP14 for the `phaseOut` op (effects/handlers/zones-status.ts) and the untap step (core/steps.ts).
 *
 * `GameObject.phasedOut` is the only status the state keeps. Phasing out "indirectly" (CR 702.26g: an Aura, Equipment or Fortification phases out with the
 * permanent it is attached to) is derived from the attachment: a phased-out attachment whose host is phased out too phased out with it, and it phases in only
 * together with that host (CR 702.26g-h). A phased-out permanent is treated as though it does not exist (CR 702.26b): the WP14 ops skip it (actOn), so do
 * targeting (rules/targets.ts), `{ref:'each'}` and counts (rules/filter.ts#findObjects) and the untap step; statics and SBA code of milestones 3-4 that loops
 * over the battlefield itself is not audited here.
 *
 * Who phases in (CR 502.1: the permanents "that phased out under that player's control") is read from the stored `GameObject.controller`: a phased-out
 * permanent is excluded from layer-2 effects (CR 702.26e), and the state keeps no record of the controller at phase-out time, so a permanent phased out while a
 * layer-2 effect controlled it phases in during its stored controller's untap step (known gap, reported).
 *
 * WP14 INTERFACE CHANGE (new module outside WP14's files, declared in the WP14 review): `phaseOutPermanent` is a state-writing performer the design 8.5
 * table does not list yet (see rules/status.ts).
 */
import type { Game } from '../core/game';
import type { ObjectId, PlayerId } from '../types/ids';
import { removeFromCombat } from './combat-state';
import { charsOfObject, hasKeyword } from './characteristics';

/** The permanents attached to `host` (Auras, Equipment, Fortifications), in battlefield order. */
const attachmentsOf = (g: Game, host: ObjectId): ObjectId[] => g.s.zones.battlefield.filter((id) => g.s.objects[id]?.attachedTo === host);

/**
 * CR 702.26b, 702.26g: phase a permanent out, and with it ("indirectly") everything attached to it. Each one is removed from combat (CR 506.4). Returns the ids
 * that phased out, the permanent first. Phasing is not a zone change (CR 702.26d): no new object, no zone-change trigger.
 */
export function phaseOutPermanent(g: Game, id: ObjectId): ObjectId[] {
  const out: ObjectId[] = [];
  const visit = (x: ObjectId): void => {
    const o = g.s.objects[x];
    if (!o || o.zone !== 'battlefield' || o.phasedOut || out.includes(x)) return;
    o.phasedOut = true;
    removeFromCombat(g.s, x);
    out.push(x);
    g.emit({ type: 'phasedOut', objectId: x });
    for (const a of attachmentsOf(g, x)) visit(a); // CR 702.26g: indirectly, together with the permanent
  };
  visit(id);
  return out;
}

/** Was this phased-out permanent phased out indirectly, i.e. is it attached to a permanent that is phased out too (CR 702.26g)? */
function phasedOutIndirectly(g: Game, id: ObjectId): boolean {
  const host = g.s.objects[id]?.attachedTo;
  const h = host !== undefined ? g.s.objects[host] : undefined;
  return h !== undefined && h.zone === 'battlefield' && h.phasedOut;
}

/**
 * CR 502.1: in the untap step, the phased-out permanents the active player controlled when they phased out phase in (the controller does not change while a
 * permanent is phased out, CR 702.26d). An attachment that phased out indirectly phases in together with its host, whoever controls it (CR 702.26g). (The
 * other half of 502.1: p2-misc-1 (CR 702.26a): the active player's phased-in permanents with phasing phase out at the same time.) Returns the ids that phased in.
 */
export function phaseInForUntapStep(g: Game, active: PlayerId): ObjectId[] {
  // p2-misc-1 (CR 702.26a, 502.1; unverified): the phased-in permanents with phasing the active player controls phase out at the same time as the others phase
  // in, so a permanent that phases in now does not phase out again; chosen before anything changes
  const phasers = g.s.zones.battlefield.filter((id) => {
    const o = g.s.objects[id]!;
    return !o.phasedOut && o.controller === active && hasKeyword(charsOfObject(g.s, o), 'phasing');
  });
  const direct = g.s.zones.battlefield.filter((id) => {
    const o = g.s.objects[id]!;
    return o.phasedOut && o.controller === active && !phasedOutIndirectly(g, id);
  });
  const out: ObjectId[] = [];
  const visit = (x: ObjectId): void => {
    const o = g.s.objects[x];
    if (!o || !o.phasedOut || out.includes(x)) return;
    o.phasedOut = false;
    out.push(x);
    for (const a of attachmentsOf(g, x)) visit(a); // CR 702.26g: it phases in along with the permanent
  };
  for (const id of direct) visit(id);
  if (out.length > 0) g.log(`${out.map((id) => g.nameOf(id)).join(', ')} phase${out.length === 1 ? 's' : ''} in.`, { rules: ['CR 502.1', 'CR 702.26c'], level: 'info' });
  const gone = phasers.flatMap((id) => phaseOutPermanent(g, id)); // p2-misc-1: with what is attached to each (CR 702.26g)
  if (gone.length > 0) g.log(`${gone.map((id) => g.nameOf(id)).join(', ')} phase${gone.length === 1 ? 's' : ''} out.`, { rules: ['CR 502.1', 'CR 702.26a'], level: 'info' });
  return out;
}
