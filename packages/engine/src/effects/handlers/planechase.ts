/**
 * edhd19: the keyword action "planeswalk" (CR 701.31) and "chaos ensues" (CR 311.7), run by the `action` op through actions-native.ts#NATIVE_ACTIONS.
 * A player may planeswalk only during a Planechase game (CR 701.31a), and chaos ensuing has an effect only through the chaos abilities of face-up planes
 * (CR 311.7). OpenMTG has no Planechase game, no planar decks and no plane cards, so both instructions have no effect: nothing is done, nothing is emitted.
 * (The vote cards "Path of the ..." end in these two words; their other instructions play normally.)
 */
import type { EffectStep } from '../../types/ability';
import type { StepHandler } from '../api';
import { NOTHING } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native actions of this module. */
export const PLANECHASE_FEATURES: readonly string[] = ['action.native.planeswalk', 'action.native.chaosEnsues', 'action.native.rollPlanarDie' /* edh-next-127 */];

const nothing: StepHandler<ActionStep> = () => NOTHING;

export const PLANECHASE_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { planeswalk: nothing, chaosEnsues: nothing, rollPlanarDie: nothing /* edh-next-127 (CR 901.3, 706.7; Fractured Powerstone ruling 2012-06-01): no planar die outside Planechase */ };
