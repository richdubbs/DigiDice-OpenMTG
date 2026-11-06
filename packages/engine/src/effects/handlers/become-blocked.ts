/**
 * p2-combat-flow-2: `becomeBlocked` (CR 509.1h, 506.4): "Target unblocked attacking creature becomes blocked", "Attacking creatures become blocked" (Curtain of Light,
 * Fog Patch). Each attacking creature it names that is not blocked becomes a blocked creature with no creature blocking it; a creature that is not attacking, or is
 * blocked already, is unchanged. Emits `becameBlocked` for those that changed, which triggers/normalize.ts reads as "becomes blocked" (CR 509.3c), with no blocker.
 */
import type { EffectStep } from '../../types/ability';
import type { StepHandler } from '../api';
import { performMakeBlockedIds } from '../perform-direct';
import { did, namesOf, permanentsOf } from './zones-util';

type Step = Extract<EffectStep, { op: 'becomeBlocked' }>;

const becomeBlocked: StepHandler<Step> = (cx, st) => {
  const g = cx.g;
  // edhv31 (CR 702.22i): a band blocks as a group, so every member that changed is named, not only the ones the effect named
  const ids = [...new Set(permanentsOf(cx, st.what).flatMap((h) => performMakeBlockedIds(g, h.id)))];
  const done = ids.map((id) => ({ id })) as ReturnType<typeof permanentsOf>;
  if (done.length > 0) {
    g.log(`${namesOf(g, done)} ${done.length === 1 ? 'becomes' : 'become'} blocked.`, { rules: ['CR 509.1h'], level: 'action' });
    g.emit({ type: 'becameBlocked', attackers: ids });
  }
  return did(done.length);
};

export const BECOME_BLOCKED_HANDLERS = { becomeBlocked };
