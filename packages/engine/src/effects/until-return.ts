/**
 * FAST4 MX1: the second one-shot effect of CR 610.3. "Exile target creature an opponent controls until this creature leaves the battlefield": when the event
 * happens (core/durations.ts#endDurations), each object the first effect moved that is still in the zone it was moved to returns to its previous zone
 * (CR 610.3), to the battlefield under its owner's control (CR 610.3c), as a new object (CR 400.7). The records ended by the same events return at the same
 * time (CR 610.3d): one `move` step per previous zone, run through the `move` handler (replacement effects, the entering face, an Aura's object chosen as it
 * enters, CR 303.4f, the log), in a context with no stack object and no targets, like a mana ability's (effects/mana-ability.ts). It is not a triggered
 * ability: nothing goes on the stack and nobody can respond. Loading this module installs it; effects/funnels.ts loads it.
 */
import { installUntilReturner } from '../core/durations';
import type { EffectStep } from '../types/ability';
import type { ObjHandle, UntilMoveRec, ZoneKind } from '../types/state';
import type { ExecCtx } from './api';
import { runSteps } from './run';

installUntilReturner((g, ended: readonly UntilMoveRec[]) => {
  const first = ended[0]!;
  const byZone = new Map<ZoneKind, ObjHandle[]>();
  for (const r of ended) {
    for (const o of r.objects) {
      if (g.s.objects[o.object.id]?.zone !== o.object.zone) continue; // it left the zone it was moved to: a new object, not returned (CR 400.7)
      byZone.set(o.back, [...(byZone.get(o.back) ?? []), o.object]);
    }
  }
  const names = [...new Set(ended.map((r) => r.sourceName))].join(', ');
  g.log(`${names} left the battlefield: what ${ended.length === 1 ? 'it' : 'they'} exiled until then returns.`, { rules: ['CR 610.3', 'CR 610.3c', 'CR 610.3d'], level: 'info' });
  const steps: EffectStep[] = [...byZone].map(([zone, objects]) => ({
    op: 'move',
    what: { ref: 'fixed', objects: objects.map((h) => ({ id: h.id, zone: h.zone })) },
    to: zone === 'battlefield' ? { zone, controller: 'owner' } : { zone: zone as Exclude<ZoneKind, 'battlefield'> },
    span: `Return the cards exiled until ${names} left the battlefield.`,
  }));
  const cx: ExecCtx = {
    g, source: { ...first.source }, stackId: null, controller: first.controller, program: { targets: [], steps }, stack: null, targets: new Map(), event: null,
    bindings: new Map(), results: new Map(), vars: new Map(),
  };
  runSteps(cx, steps);
});
