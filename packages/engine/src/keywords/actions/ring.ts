/**
 * MX3: "the Ring tempts you" (CR 701.54). Native: effects/handlers/ring.ts (through actions-native.ts#NATIVE_ACTIONS; `feature:action.native.ringTempts`),
 * with the rules in core/ring.ts. Step: `{op:'action', action:'ringTempts', who}`.
 */
import type { ActionMacro } from '../types';

export const RING_TEMPTS: ActionMacro = { name: 'ringTempts', rule: 'CR 701.54a', native: 'ringTempts' };

export const RING_MACROS: readonly ActionMacro[] = [RING_TEMPTS];
