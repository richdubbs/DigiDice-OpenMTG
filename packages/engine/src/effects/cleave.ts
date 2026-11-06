/**
 * Cleave (CR 702.148a-b): a spell cast for its cleave cost uses the effect without the bracketed words (`SpellAbilityDef.cleave`, parser/cleave.ts). A spell ability with no
 * such effect can't be cast so: the cast refuses it (actions/cast.ts), fail closed. CR cites written in a cloud session, unchecked against rules/cr.
 */
import type { SpellAbilityDef } from '../types/ability';

/** The name of the alternative cost (`CostsPaid.alternative`) of a spell cast for its cleave cost. */
export const CLEAVE = 'cleave';

/** The effect of a spell ability as it is cast for its cleave cost (the cleaved one) or as printed. */
export const effectFor = (def: SpellAbilityDef, cleaved: boolean) => (cleaved && def.cleave !== undefined ? def.cleave : def.effect);
