/**
 * Pass 9, sequencing (design 6.5): "then", "and", commas and sentence boundaries produce steps in textual order (CR 608.2c: instructions are followed in
 * the order written; "then" orders, it never makes a step depend on the success of the previous one, that is "if you do", CR 608.2d). Owner: WP17.
 *
 * A sentence no template understood becomes ONE `manual` step at its place (design 6.6), so the steps before and after it still run automatically; the
 * taint pass (parser/taint.ts) then decides whether the manual island spreads. A rider that was folded (pass 4) and a "pay" follow-up that was folded
 * (pass 7) contribute nothing of their own. The modal options are sequenced separately (CR 700.2d: chosen modes run in printed order, then `steps`).
 */
import type { EffectStep } from '../../types/ability';
import type { Draft, LoweredProgram, LoweredSeq, Unit } from './types';
import { clone } from './util';

/** The manual step of a sentence (design 6.6 "an effect sentence in an otherwise understood ability"). */
export function manualStep(u: Unit): EffectStep {
  return { op: 'manual', text: u.text, reason: u.manual?.reason ?? 'not understood' };
}

export function sequenceUnits(units: readonly Unit[]): LoweredSeq {
  const steps: EffectStep[] = [];
  const stepUnits: number[] = [];
  units.forEach((u, i) => {
    if (u.manual) { steps.push(manualStep(u)); stepUnits.push(i); return; }
    for (const s of u.steps) { steps.push(clone(s) as unknown as EffectStep); stepUnits.push(i); }
  });
  return { steps, units: [...units], stepUnits };
}

/** Pass 9. */
export function lowerSequencing(d: Draft): LoweredProgram {
  return {
    targets: clone(d.targets),
    main: sequenceUnits(d.units),
    ...(d.modes ? { modes: { min: d.modes.min, max: d.modes.max, options: d.modes.options.map((o) => ({ text: o.text, ...(o.cost ? { cost: o.cost } : {}), ...sequenceUnits(o.units) })) } } : {}),
  };
}
