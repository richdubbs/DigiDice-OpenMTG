/**
 * "Open an Attraction" (CR 701.51). Owner: T38 (FAST5).
 *
 * "A player may open an Attraction only during a game in which that player is playing with an Attraction deck" (CR 701.51a). This build has no Attraction
 * deck: the deckbuilder and the game setup know only the main deck and the sideboard (CR 717 is not modeled), so in every game it can run no player is
 * playing with one and the instruction cannot be performed. The action therefore does what the rules say happens then, nothing, and says so in the log
 * instead of staying silent. The Attractions that are already on the battlefield (a card cannot be in the main deck as one) and their visits are unaffected.
 * If an Attraction deck is ever added, this handler is where "move the top card of your Attraction deck onto the battlefield" (CR 701.51b) and the
 * "whenever you open an Attraction" event (CR 701.51c) belong.
 *
 * Step: `{op:'action', action:'openAttraction', who}`; it binds nothing and `as` is bound to no object (design 3.1 rule 6).
 */
import type { EffectStep } from '../../types/ability';
import type { StepHandler } from '../api';
import { playersOf } from './cards-util';
import { bindAs, NOTHING } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const ATTRACTION_FEATURES: readonly string[] = ['action.native.openAttraction'];

const openAttraction: StepHandler<ActionStep> = (cx, st) => {
  bindAs(cx, st.as, []);
  for (const p of playersOf(cx, st.who)) {
    cx.g.log(`${cx.g.player(p).name} has no Attraction deck, so no Attraction is opened.`, { rules: ['CR 701.51a'], level: 'info' });
  }
  return NOTHING;
};

export const ATTRACTION_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { openAttraction };
