/**
 * The lowering passes of design 6.5, in order. Owner: WP17. Each pass is a pure function with its own tests (test/m5/lower):
 *
 *   1 scope         lower/scope.ts        trigger event roles seed the discourse model (design 3.5, 6.4)
 *   2 targets       lower/targets.ts      target phrases -> TargetSpecs t0, t1, ... unique across the ability and its modes (CR 115.1, 601.2c, 608.2b)
 *   3 anaphora      lower/anaphora.ts     the unique-candidate rule (design 6.4)
 *  3b choose        lower/choose.ts       a sentence that only announces targets ("Choose up to one target creature.") keeps them and no step (Cloud std-eoe)
 *   4 riders        lower/riders.ts       "$patchPrevious" sentences merge into the step they modify (CR 608.2c, 614.15)
 *   5 quantities    lower/quantities.ts   "where X is", "that many" / "that much" (CR 608.2h)
 *  5b links         lower/links.ts        "the chosen type", "that type": the earlier choice of the same ability (CR 608.2c-d; FAST5 T67)
 *   6 durations     lower/durations.ts    a sentence's duration attaches to all its continuous effects; none = permanent (CR 611.2a)
 *   7 conditions    lower/conditions.ts   "if you do" -> did; "may pay ... if they don't" folds into pay (CR 118.12, 608.2d)
 *   8 optionality   lower/optionality.ts  every may / pay names its actor (design 1.1.3)
 *   9 sequencing    lower/sequencing.ts   steps in text order, manual sentences in place (CR 608.2c)
 *  8b same-for       lower/same-for.ts     "Do the same for <keywords>": the sentence before it once more per keyword (std-combat-2)
 *  10 normalize     lower/normalize.ts    no marker survives; unstated zones are manual
 *
 * The taint pass (parser/taint.ts) runs next on the LoweredProgram.
 */
import { lowerAnaphora } from './anaphora';
import { lowerChoose } from './choose';
import { lowerConditions } from './conditions';
import { lowerDurations } from './durations';
import { lowerNormalize } from './normalize';
import { lowerOptionality } from './optionality';
import { lowerLinks } from './links';
import { lowerQuantities } from './quantities';
import { lowerRiders } from './riders';
import { lowerSameFor } from './same-for';
import { lowerScope } from './scope';
import { lowerSequencing } from './sequencing';
import { lowerTargets } from './targets';
import type { Draft, LoweredProgram } from './types';

export const OWNER = 'WP17' as const;

/** Passes 1-8 work on the Draft; 9 turns it into a program; 10 checks the program. */
export const DRAFT_PASSES = [
  ['scope', lowerScope],
  ['targets', lowerTargets],
  ['anaphora', lowerAnaphora],
  ['choose', lowerChoose], // Cloud std-eoe
  ['riders', lowerRiders],
  ['quantities', lowerQuantities],
  ['links', lowerLinks], // FAST5 T67
  ['durations', lowerDurations],
  ['conditions', lowerConditions],
  ['optionality', lowerOptionality],
  ['sameFor', lowerSameFor], // std-combat-2
] as const;

/** Run the ten passes. Pure. */
export function lowerProgram(draft: Draft): { program: LoweredProgram; draft: Draft } {
  let d = draft;
  for (const [, pass] of DRAFT_PASSES) d = pass(d);
  return { program: lowerNormalize(lowerSequencing(d)), draft: d };
}

export { lowerAnaphora, lowerChoose, lowerConditions, lowerLinks, lowerDurations, lowerNormalize, lowerOptionality, lowerQuantities, lowerRiders, lowerScope, lowerSequencing, lowerTargets };
export type * from './types';
