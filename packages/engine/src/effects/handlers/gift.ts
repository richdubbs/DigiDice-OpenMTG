/**
 * FAST5X E1: "gives a gift" (CR 702.174c). The keyword data of gift (keywords/data/gift.json) ends the gift's effect with the step
 * `{op:'action', action:'giveGift', who:{ref:'you'}}`: the spell's controller (an instant or sorcery whose gift cost was paid, CR 702.174b, 702.174j) or the
 * controller of the permanent's gift trigger (CR 702.174b) has given a gift. The step emits the `giveGift` action event, which "Whenever you give a gift"
 * matches (`{ev:'action', verb:'giveGift'}`, capability `feature:ev.action.giveGift`). Nothing else happens here: the gift itself (a card, a Food, a tapped
 * Fish, ...) is ordinary steps of the same data, run before this one. Owner: FAST5X E1.
 */
import type { EffectStep } from '../../types/ability';
import type { StepHandler } from '../api';
import { performAction } from '../perform';
import { firstPlayer, NOTHING } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const GIFT_NATIVE_FEATURES: readonly string[] = ['action.native.giveGift'];

const giveGift: StepHandler<ActionStep> = (cx, st) => {
  const player = firstPlayer(cx, st.who);
  if (player === undefined) return NOTHING;
  performAction(cx.g, { verb: 'giveGift', actor: player });
  return { performed: true, count: 1 };
};

export const GIFT_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { giveGift };
