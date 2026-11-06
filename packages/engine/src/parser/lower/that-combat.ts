/**
 * Pass 8d, that-combat (edh-combat-5; CR 500.8, 603.7a): "At the beginning of that combat, ..." (template dl.edhcb5.thatCombat.lead, a delayed trigger whose `when.phase` is
 * `added`) names the combat phase an instruction of the same ability added. It waits for the phase the `extraPhase` step before it added (effects/handlers/game.ts), so with no
 * such step in a unit before it the sentence would silently do nothing: it is manual then (fail closed).
 */
import type { Draft, Rec } from './types';
import { cloneDraft, isRec, sequences, setManual, visit } from './util';

const addedWhen = (r: Rec): boolean => r['op'] === 'delay' && isRec(r['when']) && r['when']['phase'] === 'added';
const addsCombat = (r: Rec): boolean => r['op'] === 'extraPhase' && r['phase'] === 'combat';

export function lowerThatCombat(draft: Draft): Draft {
  const wants = (d: Draft): boolean => sequences(d).some((seq) => seq.some((u) => u.manual === undefined && u.steps.some((s) => isRec(s) && addedWhen(s))));
  if (!wants(draft)) return draft;
  const d = cloneDraft(draft);
  for (const seq of sequences(d)) {
    seq.forEach((u, i) => {
      if (u.manual !== undefined || !u.steps.some((s) => isRec(s) && addedWhen(s))) return;
      const before = seq.slice(0, i).some((p) => p.manual === undefined && p.steps.some((s) => { let found = false; visit(s, (n) => { if (addsCombat(n)) found = true; if (n['op'] === 'delay') return false; /* an extra phase added later by another delayed trigger leaves no id here */ }); return found; }));
      // edh-combat-7 (Illusionist's Gambit): one joined unit may hold the added phase and the delayed trigger that waits for it, the phase first
      const at = u.steps.findIndex((s) => isRec(s) && addedWhen(s));
      const within = u.steps.slice(0, at).some((s) => { let found = false; if (isRec(s)) visit(s, (n) => { if (addsCombat(n)) found = true; if (n['op'] === 'delay') return false; }); return found; });
      if (!before && !within) setManual(u, { code: 'unbound-reference', reason: '"at the beginning of that combat": no instruction before it in this ability adds a combat phase (CR 500.8, 603.7a)' });
    });
  }
  return d;
}
