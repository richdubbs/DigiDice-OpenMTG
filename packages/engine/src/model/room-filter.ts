/**
 * Cloud std-dsk: the description of Room permanents that the door wordings name ("unlocked doors of Rooms you control", "the number of unlocked doors among Rooms
 * you control", CR 709.5, 709.5j: a door is a half of a Room). Shared by the parser (parser/holes/cond.ts, qty.ts) and the renderer (render/cond.ts).
 */
import type { ObjectFilter } from '../types/ability';

/** A description of Room permanents and nothing else but who controls them ("Rooms", "Rooms you control"). */
export function isRoomsOnly(f: ObjectFilter): boolean {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  return f.subtypes?.length === 1 && f.subtypes[0] === 'Room' && keys.every((k) => k === 'subtypes' || k === 'controller');
}
