/**
 * FAST5X E28: exert (CR 701.43) and forage (CR 701.61) as keyword actions in an effect. Owner: FAST5X E28.
 *
 *  - exert (CR 701.43a): "To exert a permanent, you choose to have it not untap during your next untap step." std-ry8: native (effects/handlers/exert.ts, through
 *    rules/pay-parts.ts#exertPermanent, which the cost "Exert ~:" and the exert "as it attacks" use too): the MX5 untap restriction on the permanent (locked in,
 *    CR 611.2c) lasting through the next untap step of the exerting player (CR 502.3, 611.2a), and the player's `exert` action. Step: `{op:'action', action:'exert',
 *    who: you, subject}`; the exerting player must be the controller of the effect ("you"), else it is resolved by hand.
 *  - forage (CR 701.61a): native, effects/handlers/forage.ts. As a COST it is paid by rules/pay-parts.ts.
 */
import type { ActionMacro } from '../types';

// std-ry8: native (effects/handlers/exert.ts), so an exert in an effect emits the player's `exert` action like the cost and the exert "as it attacks" do
export const EXERT: ActionMacro = { name: 'exert', rule: 'CR 701.43a', native: 'exert' };

export const FORAGE: ActionMacro = { name: 'forage', rule: 'CR 701.61a', native: 'forage' };
