/**
 * Deep clone for plain JSON-like data (objects, arrays, primitives). Game states contain
 * only such data, so this is portable (no structuredClone dependency) and fast.
 */
import type { GameObject, GameState } from '../types/state';

export function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  // F17/F9 (owner decision 2026-10-26): a frozen object is returned as it is, not copied. Every frozen object of a game state is deep-frozen and never
  // edited (design 4.3, docs/ARCHITECTURE.md "Engine principles"): card definitions (`deepFreeze` in core/create.ts and Game.addDef) and history entries
  // (triggers/history.ts), so sharing one is the same as copying it, without the cost (a view used to deep-copy every definition it carries).
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    // Arrays of ids and numbers (zones, answers) are by far the most common arrays: copy them without recursing.
    let flat = true;
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (v !== null && typeof v === 'object') { flat = false; break; }
    }
    if (flat) return value.slice() as T;
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = clone(value[i]);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const k in value as Record<string, unknown>) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = clone(v);
  }
  return out as T;
}

/** Freeze a plain-data tree so any attempt to mutate it in place throws (ES modules are strict). Used for card definitions. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const k in value as Record<string, unknown>) deepFreeze((value as Record<string, unknown>)[k]);
  return value;
}

/**
 * Clone a game state for the engine to mutate (core/apply.ts#run). Everything the engine edits in place is deep-cloned;
 * the parts that are immutable after they are created are shared with the source state:
 *
 *  - `defs`: compiled card definitions. Never mutated in place; the map is copy-on-write (`Game.addDef` shallow-copies it
 *    before adding a token definition) and the definitions are frozen when a game is created.
 *  - `log`: append-only and its entries are never edited, so only the array is copied (pointer copy), not the entries.
 *  - `history` (WP30, an AMENDMENT of design 4.3 hazard 5, which had it deep-cloned): the same; entries are written once by triggers/history.ts, frozen
 *    there (`deepFreeze`, test/m5/skeleton/wp30-history-hazard.test.ts) and never edited, and the array grows for the whole game ("this game", CR 603.4), so
 *    deep-cloning it on every action made a long game slower and slower (the main cause of the W1 slowdown of the soak tests).
 *  - `lki`: last known information entries are written once, when an object leaves a zone; only the map is copied.
 *  - `suspended`: a settled snapshot nobody mutates (`setStops` is the one writer and replaces it with a clone).
 *
 * This is the structural sharing that makes an action cost proportional to the live objects, not to the size of every
 * card definition and of the whole log.
 */
export function cloneState(s: GameState): GameState {
  const { defs, log, history, lki, suspended, objects, ...rest } = s;
  const copy: Record<string, GameObject> = {};
  for (const id in objects) copy[id] = cloneObject(objects[id]!);
  return { ...clone(rest), objects: copy, defs, log: log.slice(), history: history.slice(), lki: { ...lki }, suspended } as GameState;
}

/** A game object has a fixed flat shape plus a few small nested records: copying it field by field is several times faster than the generic clone. */
export function cloneObject(o: GameObject): GameObject {
  const c: GameObject = { ...o, counters: { ...o.counters } };
  if (o.stack) c.stack = clone(o.stack);
  if (o.chosen) c.chosen = clone(o.chosen);
  if (o.revealedTo) c.revealedTo = o.revealedTo.slice();
  // Per-object records of the ability model (design 4.3): sharing either with the source state would let an in-place update corrupt replay determinism.
  if (o.links) c.links = clone(o.links);
  if (o.cast) c.cast = clone(o.cast);
  if (o.counterStamps) c.counterStamps = { ...o.counterStamps }; // r4-fxb (CR 613.7c)
  // M6-0 (m6 design 2.2): the nested M6 records; the scalar M6 fields (faceUpX, prototyped, classLevel, solved, prepared, preparedCopy, preparedFor,
  // transformedAt) are copied by the spread above.
  if (o.faceDownInfo) c.faceDownInfo = { ...o.faceDownInfo };
  if (o.components) c.components = o.components.map((x) => ({ ...x }));
  if (o.saddledBy) c.saddledBy = o.saddledBy.slice(); // FAST5X E3 (CR 702.171c)
  if (o.crewedBy) c.crewedBy = o.crewedBy.slice(); // r5-fxb (CR 702.122)
  if (o.unlocked) c.unlocked = o.unlocked.slice(); // FAST5X E8 (CR 709.5c)
  if (o.goaded) c.goaded = o.goaded.map((x) => ({ ...x })); // M12-1 (CR 701.15a-d; m12 design 4.2): one entry per goader
  return c;
}
