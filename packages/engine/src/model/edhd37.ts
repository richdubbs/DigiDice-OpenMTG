/**
 * edh-d-37 (Commander lane lands): conditions both the parser (parser/holes/edhd37.ts) and the renderer (render/cond.ts) must write the same JSON for.
 */
import type { Condition, Quantity } from '../types/ability';

/** The five basic land types among lands you control, counted as parser/holes/qty.ts#domain does (each type once). */
export const DOMAIN_OF_YOUR_LANDS: Quantity = {
  q: 'math', op: '+',
  args: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((t) => ({ q: 'math', op: 'min', args: [1, { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you', subtypes: [t] } } }] })),
} as never;
/** The colors among creatures you control (CR 105.1: five colors in the game). */
export const COLORS_OF_YOUR_CREATURES: Quantity = { q: 'distinct', what: 'colors', among: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } as never;
/** "You control a land of each basic land type and a creature of each color": all five basic land types among your lands and all five colors among your creatures. */
export const EACH_LAND_TYPE_AND_EACH_COLOR: Condition = {
  cond: 'all',
  of: [{ cond: 'compare', left: DOMAIN_OF_YOUR_LANDS, op: '>=', right: 5 }, { cond: 'compare', left: COLORS_OF_YOUR_CREATURES, op: '>=', right: 5 }],
};

