/**
 * std-combat-3 (CR 603.10a, 603.6c): the battlefield as it was immediately before a permanent left it, for the quantities of a leaves-the-battlefield trigger's
 * pattern. A leaves-the-battlefield ability "looks back in time": "Whenever a creature an opponent controls with the greatest power among creatures that player
 * controls dies" (Kraven the Hunter) compares the creature with the creatures that player controlled then, the creature itself and every creature that left in the
 * same event included, each with the characteristics it had then (a lord that died with them still pumped them).
 *
 * The state is rebuilt from what the engine keeps: the ids on the battlefield just before the event (`LastKnown.board`, core/zones.ts#moveObject), each object
 * that has left since put back as it last existed (its last known information), every object still there as it is now. The layer system then works out every
 * characteristic on that state (rules/characteristics.ts caches per state object). What changed later in the same resolution on the objects that stayed (a counter
 * put on them after the event) is read as it is now. An object of the old battlefield of which nothing is known any more is left out; null when the departed object
 * has no recorded battlefield (the caller fails closed: no match).
 */
import type { ObjectId } from '../types/ids';
import type { GameObject, GameState, LastKnown } from '../types/state';

/** The state with the battlefield as it was immediately before `lk`'s object left it, or null when that is not recorded. */
export function boardBefore(s: GameState, lk: LastKnown | undefined): GameState | null {
  if (lk === undefined || lk.leftZone !== 'battlefield' || lk.board === undefined) return null;
  const objects: Record<ObjectId, GameObject> = { ...s.objects };
  const battlefield: ObjectId[] = [];
  for (const id of lk.board) {
    const now = s.objects[id];
    if (now !== undefined && now.zone === 'battlefield') { battlefield.push(id); continue; }
    const gone = s.lki[id];
    if (gone === undefined || gone.leftZone !== 'battlefield') continue;
    objects[id] = { ...gone.object, zone: 'battlefield' };
    battlefield.push(id);
  }
  return { ...s, objects, zones: { ...s.zones, battlefield } };
}
