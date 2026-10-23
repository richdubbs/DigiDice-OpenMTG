/**
 * The `during` replacement body (CR 614.1e, 708.11: "As this permanent is turned face up, ..."; CR 712.20: "As this permanent transforms into ~, ..."; m6 design
 * 2.1). Owner: M6-3; M6-4 added the `transform` proposal.
 *
 * It applies to a `turnFaceUp` or a `transform` proposal only: applying it records its steps on the event (`Proposed.turnFaceUp.during`,
 * `Proposed.transform.during`), and the event's performer (effects/handlers/face-ops.ts, effects/handlers/dfc-ops.ts) runs them while the permanent is being
 * turned face up or transforming, before anything can see the result (Hooded Hydra's five +1/+1 counters are on it when it is face up; no trigger or
 * state-based action sees it without them).
 */
import type { BodyKinds } from '../registries';

export const DURING_BODY_KINDS: Pick<BodyKinds, 'during'> = {
  during: {
    capabilities: ['during'],
    fits: (_g, e) => e.ev === 'turnFaceUp' || e.ev === 'transform',
    apply: (_g, e, b, c) =>
      e.ev === 'turnFaceUp' || e.ev === 'transform' ? { ...e, during: [...(e.during ?? []), { steps: b.do, source: c.source, controller: c.controller }] } : e,
  },
};
