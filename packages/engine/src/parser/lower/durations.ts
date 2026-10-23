/**
 * Pass 6, durations (design 6.5). Owner: WP17.
 *
 * A duration attaches to every continuous-effect clause of its sentence: "Target creature gets +2/+0 and gains first strike until end of turn" is one
 * duration for both (CR 611.2a). An `effect` step without a duration takes the sentence's duration when the sentence states exactly one; when it states
 * none the effect lasts indefinitely (`permanent`, CR 611.2a); when two clauses state different durations and a third states none, the reading is ambiguous
 * and the sentence is manual (design 6.5: "a duration that could attach to either of two coordinated clauses with different results").
 */
import { canonicalJson } from '../holes/core';
import { stepsInOrder } from './mentions';
import type { Draft } from './types';
import { cloneDraft, sequences, setManual } from './util';

/** Pass 6. */
export function lowerDurations(input: Draft): Draft {
  const d = cloneDraft(input);
  for (const seq of sequences(d)) {
    for (const u of seq) {
      if (u.manual) continue;
      const effects = stepsInOrder(u.steps).map((s) => s.step).filter((s) => s['op'] === 'effect');
      if (effects.length === 0) continue;
      const stated = new Map<string, unknown>();
      for (const e of effects) if (e['duration'] !== undefined) stated.set(canonicalJson(e['duration']), e['duration']);
      const missing = effects.filter((e) => e['duration'] === undefined);
      if (missing.length === 0) continue;
      if (stated.size > 1) {
        setManual(u, { code: 'ambiguous', reason: 'a duration could attach to more than one clause of the sentence (design 6.5)' });
        continue;
      }
      const dur = stated.size === 1 ? [...stated.values()][0] : { d: 'permanent' };
      for (const e of missing) e['duration'] = JSON.parse(JSON.stringify(dur)) as unknown;
    }
  }
  return d;
}
