/**
 * M11-1's filter part (m11 design 4.5, the M6 pattern of rules/registries.ts#FILTER_PARTS): `commander` (CR 903.3, 903.3d). rules/filter.ts and
 * statics/match.ts evaluate it since M11-0 (statics/commander.ts#isCommander); M11-1 lists it here now that a Commander game sets commanders up and moves them
 * (the command zone, CR 903.6, 903.8, 903.9), so "commander creatures you own" and "as long as you control your commander" can be automated.
 */
import type { FilterStatusField } from '../registries';

export const COMMANDER_FILTER_PARTS: readonly FilterStatusField[] = ['commander'];
