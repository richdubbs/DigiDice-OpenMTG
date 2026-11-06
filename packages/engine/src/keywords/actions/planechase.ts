/**
 * edhd19: "planeswalk" (CR 701.31) and "chaos ensues" (CR 311.7) as instructions of a spell or ability. A player may planeswalk only during a Planechase game
 * (CR 701.31a) and chaos ensuing triggers the chaos abilities of the face-up planes (CR 311.7); OpenMTG has no Planechase game (no planar deck, no plane
 * cards), so neither instruction does anything. Native: effects/handlers/planechase.ts. Steps: `{op:'action', action:'planeswalk' | 'chaosEnsues', who}`.
 */
import type { ActionMacro } from '../types';

export const PLANESWALK: ActionMacro = { name: 'planeswalk', rule: 'CR 701.31a', native: 'planeswalk' };
export const CHAOS_ENSUES: ActionMacro = { name: 'chaosEnsues', rule: 'CR 311.7', native: 'chaosEnsues' };

/** edh-next-127 (CR 901.3, 706.7; Fractured Powerstone): "roll the planar die": no planar die outside a Planechase game, so nothing happens. */
export const ROLL_PLANAR_DIE: ActionMacro = { name: 'rollPlanarDie', rule: 'CR 901.3', native: 'rollPlanarDie' };

export const PLANECHASE_MACROS: readonly ActionMacro[] = [PLANESWALK, CHAOS_ENSUES, ROLL_PLANAR_DIE];
