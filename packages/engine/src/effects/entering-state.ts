/**
 * The state in which the entering object is already on the battlefield as it would enter (CR 614.12; effects/entering.ts explains the model). A leaf module
 * (CMD3): effects/bodies/m5.ts reads it for sunburst's `countersIf` (CR 702.44a), so it imports neither core/game.ts nor effects/registries.ts as values.
 */
import type { Game } from '../core/game';
import type { GameState } from '../types/state';
import { onBattlefield } from '../statics/hooks';
import type { Proposed } from './api';
import { ALL_ENTERS_PARTS } from './enters-parts/all';

type ZoneChange = Extract<Proposed, { ev: 'zoneChange' }>;

/** The state in which the entering object is already on the battlefield as it would enter (CR 614.12); null when the object is gone. */
export function enteringState(g: Game, e: ZoneChange): GameState | null {
  const o = g.s.objects[e.object.id];
  if (!o) return null;
  const d = e.destination;
  const controller = d.controller ?? o.controller;
  let alt = onBattlefield(g.s, o.id, controller, { ...(d.face !== undefined ? { face: d.face } : {}), ...(d.faceDown !== undefined ? { faceDown: d.faceDown } : {}) });
  // the parts below may write to the object: make sure it is a copy even when nothing else changed
  if (alt === g.s) alt = { ...g.s, objects: { ...g.s.objects, [o.id]: { ...o } } };
  const entering = alt.objects[o.id]!;
  for (const p of ALL_ENTERS_PARTS) {
    const set = d[p.field === 'copy' ? 'copyOf' : p.field === 'faceDown' ? 'faceDownInfo' : p.field];
    if (set !== undefined && set !== false) p.hypothetical(alt, entering, d);
  }
  return alt;
}
