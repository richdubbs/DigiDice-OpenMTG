/**
 * MX3: the keyword action "the Ring tempts you" (CR 701.54), run by the `action` op through actions-native.ts#NATIVE_ACTIONS. Owner: MX3.
 * Step: `{op:'action', action:'ringTempts', who, n?}` (`n`: how many times, each one a whole temptation). The rules are core/ring.ts#ringTempts: the
 * emblem named The Ring (CR 701.54c), the choice of a Ring-bearer (CR 701.54a), the count and the event (CR 701.54d). `as` binds the chosen Ring-bearer
 * (of the last temptation).
 */
import type { EffectStep } from '../../types/ability';
import type { ObjHandle } from '../../types/state';
import { ringTempts as tempt } from '../../core/ring';
import type { StepHandler } from '../api';
import { evalQty } from '../eval';
import { bindAs, did, firstPlayer, NOTHING } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const RING_FEATURES: readonly string[] = ['action.native.ringTempts'];

const ringTempts: StepHandler<ActionStep> = (cx, st) => {
  const player = firstPlayer(cx, st.who);
  const raw = st.n === undefined ? 1 : evalQty(cx, st.n);
  if (player === undefined || raw === undefined || Number.isNaN(raw)) {
    bindAs(cx, st.as, []);
    return NOTHING; // fails to determine (CR 608.2b)
  }
  const times = Math.max(0, Math.floor(raw));
  let bearer: ObjHandle | undefined;
  for (let i = 0; i < times; i++) {
    const id = tempt(cx.g, player);
    bearer = id === undefined ? undefined : { id, zone: 'battlefield' };
  }
  bindAs(cx, st.as, bearer ? [bearer] : []);
  return did(times); // CR 701.54d: the Ring tempted the player even when no creature could be chosen
};

/** The native action of this module by `ActionMacro.native` name (keywords/actions/ring.ts). */
export const RING_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { ringTempts };
