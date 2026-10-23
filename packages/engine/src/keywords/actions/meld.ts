/**
 * The keyword action meld (CR 701.42; m6 design 3.6). Owner: M6-4. Two cards become one permanent with a status a step list can't give (its components, the
 * meld result's definition), so it is a native action run by effects/handlers/dfc-ops.ts#DFC_NATIVES (through actions-native.ts#NATIVE_ACTIONS;
 * `feature:action.native.meld`). Step: `{op:'action', action:'meld', subject: <the two cards>, who, arg?: <the result's name>}`.
 */
import type { ActionMacro } from '../types';

/** CR 701.42a: meld the two cards of a meld pair into one permanent. */
export const MELD: ActionMacro = { name: 'meld', rule: 'CR 701.42a', native: 'meld' };

export const MELD_MACROS: readonly ActionMacro[] = [MELD];
