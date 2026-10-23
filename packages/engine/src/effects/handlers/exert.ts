/**
 * FAST5X E28 / std-ry8: exert (CR 701.43) as a keyword action in an effect, run by the `action` op through actions-native.ts#NATIVE_ACTIONS. Owner: std-ry8.
 *
 *   CR 701.43a  "To exert a permanent, you choose to have it not untap during your next untap step." The same effect the exert cost and the exert "as it attacks"
 *               make (rules/pay-parts.ts#exertPermanent): a `restrict` of `untapDuringUntapStep` on the permanent lasting through the exerting player's next untap
 *               step (core/durations.ts#expireAfterUntapStep, CR 502.3, 611.2a), and the `exert` action of the player ("whenever you exert a creature").
 *   CR 701.43b  Exerting twice ends in the same untap step (each record ends then).
 *   CR 701.43c  A permanent that is not on the battlefield can't be exerted.
 *
 * Step: `{op:'action', action:'exert', who: you, subject}`; the exerting player must be the controller of the effect ("your next untap step"), else it is resolved
 * by hand. `as` binds the permanents exerted. Until std-ry8 this was a macro over the restriction (keywords/actions/exert-forage.ts), which emitted no event.
 */
import { isPlayerOnlyRefKind, type EffectStep, type ObjRef } from '../../types/ability';
import type { ObjHandle } from '../../types/state';
import { exertPermanent } from '../../rules/pay-parts';
import type { StepHandler } from '../api';
import { askManual } from '../manual';
import { bindAs, did, permanentsOf } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const EXERT_FEATURES: readonly string[] = ['action.native.exert'];

const exert: StepHandler<ActionStep> = (cx, st) => {
  const subject = st.subject;
  if (subject === undefined || isPlayerOnlyRefKind(subject.ref) || (subject.ref === 'each' && 'who' in subject)) {
    bindAs(cx, st.as, []);
    return askManual(cx, st.span ?? 'Exert.', 'exert needs the permanent it exerts');
  }
  if (st.who.ref !== 'you') {
    bindAs(cx, st.as, []);
    return askManual(cx, st.span ?? 'Exert.', 'only the controller of the effect exerts here ("your next untap step", CR 701.43a)');
  }
  const done: ObjHandle[] = [];
  for (const h of permanentsOf(cx, subject as ObjRef)) {
    const o = cx.g.s.objects[h.id];
    if (!o || o.phasedOut) continue; // a phased-out permanent is treated as though it doesn't exist (CR 702.26b)
    if (exertPermanent(cx.g, cx.controller, h.id, cx.g.nameOf(cx.source.id))) done.push(h);
  }
  bindAs(cx, st.as, done);
  return did(done.length);
};

/** The native action of this module by `ActionMacro.native` name (effects/handlers/actions-native.ts#NATIVE_ACTIONS). */
export const EXERT_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { exert };
