/**
 * Pass 8d, phase-tapped (edh-perms-22; CR 702.26b-c, 610.3): "<Permanent> phases out until ~ leaves the battlefield. Tap that creature as it phases in this way."
 *
 * The second sentence is not an instruction of its own: it says how the permanent comes back (tapped), so it belongs to the phase-out of the sentence before it. The chart reads
 * the sentence alone (template eff.edhpm22.phaseIn.tapped, a `phaseOut` step with only `tapped`); this pass folds it into the `phaseOut` step with an `until` that ends the unit before
 * it, when both name the same object and are on the same Oracle line. Anything else stays as it was (the lone `tapped` step is refused by the capability walker, so the
 * ability stays manual: no unit that was automated changes).
 */
import type { Draft, Rec } from './types';
import { cloneDraft, isRec, sequences } from './util';

export function lowerPhaseTapped(draft: Draft): Draft {
  const only = (steps: readonly unknown[]): Rec | null => (steps.length === 1 && isRec(steps[0]) && steps[0]['op'] === 'phaseOut' ? steps[0] : null);
  const wanted = sequences(draft).some((seq) => seq.some((u) => {
    const s = only(u.steps);
    return s !== null && s['tapped'] === true && s['until'] === undefined;
  }));
  if (!wanted) return draft;
  const d = cloneDraft(draft);
  for (const seq of sequences(d)) {
    for (let i = 1; i < seq.length; i++) {
      const cur = seq[i]!;
      const tap = only(cur.steps);
      if (tap === null || tap['tapped'] !== true || tap['until'] !== undefined || cur.manual !== undefined || cur.rider !== undefined) continue;
      const prev = seq[i - 1]!;
      const lead = prev.steps[prev.steps.length - 1];
      if (prev.manual !== undefined || prev.rider !== undefined || !isRec(lead) || lead['op'] !== 'phaseOut' || lead['until'] === undefined || lead['tapped'] !== undefined || lead['lower'] !== undefined) continue;
      if (prev.line === undefined || prev.line !== cur.line || JSON.stringify(lead['what']) !== JSON.stringify(tap['what'])) continue;
      lead['tapped'] = true;
      cur.steps = [];
    }
  }
  return d;
}
