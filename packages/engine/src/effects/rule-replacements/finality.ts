/**
 * Finality counters (CR 122.1h). Owner: FAST5X E13.
 *
 * "One or more finality counters on a permanent create a single replacement effect that stops the permanent from going to the graveyard. That effect is 'If this
 * permanent would be put into a graveyard from the battlefield, exile it instead.'" It is a replacement effect (CR 614.1a) of the rules, not of an ability: losing
 * all abilities doesn't remove it, and it lasts while the counter is there. It is offered to the proposal pipeline with the other replacement effects (CR 616.1:
 * the affected object's controller orders it among them; CR 614.5: it applies at most once to the event), as one candidate however many counters there are.
 * Every move of a permanent to a graveyard goes through the pipeline: dying (CR 704.5f-g, 700.4), destruction (CR 701.8), sacrifice, also as a cost (CR 701.21).
 */
import type { ReplacementDef } from '../../types/ability';
import type { Candidate } from '../replacements';
import type { RuleReplacement } from '../registries';

/** The counter kind (CR 122.1h); `counter:finality` is registered by model/capabilities.ts from this list. */
export const FINALITY_COUNTER_KINDS: readonly string[] = Object.freeze(['finality']);

/** CR 122.1h: "If this permanent would be put into a graveyard from the battlefield, exile it instead." */
const FINALITY_REPLACEMENT: ReplacementDef = Object.freeze({
  s: 'replace',
  replaces: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' },
  body: { b: 'modify', destination: { zone: 'exile' } },
}) as ReplacementDef;

export const finalityReplacement: RuleReplacement = (g, e) => {
  if (e.ev !== 'zoneChange' || e.from !== 'battlefield' || e.to !== 'graveyard') return [];
  const o = g.s.objects[e.object.id];
  if (!o || o.zone !== 'battlefield' || e.object.zone !== 'battlefield' || (o.counters['finality'] ?? 0) <= 0) return [];
  const c: Candidate = {
    id: `rule:finality:${o.id}`, def: FINALITY_REPLACEMENT, source: { id: o.id, zone: 'battlefield' }, klass: 4, // CR 616.1e
    sourceName: `the finality counter on ${g.nameOf(o.id)}`, controller: o.controller,
  };
  return [c];
};

export const FINALITY_RULE_REPLACEMENTS: readonly RuleReplacement[] = [finalityReplacement];
