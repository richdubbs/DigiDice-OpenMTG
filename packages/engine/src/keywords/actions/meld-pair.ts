/**
 * MX2: "exile them, then meld them into <result>", the meld instruction of the meld cards after "if you both own and control ~ and a <type> named <its
 * partner>" (CR 701.42a, 712.4a). Native: effects/handlers/meld-pair.ts (through actions-native.ts#NATIVE_ACTIONS; `feature:action.native.meldPair`).
 * Step: `{op:'action', action:'meldPair', who, arg: <the result's name>}`.
 */
import type { ActionMacro } from '../types';

export const MELD_PAIR: ActionMacro = { name: 'meldPair', rule: 'CR 701.42a', native: 'meldPair' };

export const MELD_PAIR_MACROS: readonly ActionMacro[] = [MELD_PAIR];
