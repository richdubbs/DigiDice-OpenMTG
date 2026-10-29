/**
 * A game object as the card component draws it, from a GameView (the client renders views, never states; ARCHITECTURE.md "Hidden information"). An
 * object the viewer may not see has the hidden definition (`HIDDEN_DEF`) and is drawn as the card back.
 */
import { HIDDEN_DEF, type CardDef, type GameView, type ObjectId } from '@openmtg/engine';
import { modelFromDef, type CardModel } from './model';

/** The model of each definition object seen (first lookup: no definition seen by identity is ever compared or serialized again). */
const MODELS = new WeakMap<CardDef, CardModel>();
/** The model last made for a definition id, with the definition object it was made from (compared by content when another object of that id comes). */
const BY_ID = new Map<string, { def: CardDef; model: CardModel }>();

/**
 * Whether two definitions have the same content (plain data: objects, arrays, strings, numbers, booleans, null). Exact, unlike a hash, and it stops at the
 * first difference; parts shared by identity (a definition shared between views, or frozen sub-objects) are not walked at all.
 */
export function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameContent(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !sameContent((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * The model of a definition, memoized (definitions are immutable, ARCHITECTURE.md "Engine principles" 2). Keyed by the definition object first: a view
 * that shares the definition objects of the view before it (or the same view drawn again) finds the model at once. A definition object not seen before is
 * compared by content with the last definition of the same id (a view may carry its own copy of the definitions it uses), so the same card keeps the same
 * model and its picture component is not drawn again (ui/arena perf); only a changed definition makes a new model.
 */
export function cardModelOf(def: CardDef): CardModel {
  let m = MODELS.get(def);
  if (!m) {
    const known = BY_ID.get(def.id);
    if (known && sameContent(known.def, def)) m = known.model;
    else {
      m = modelFromDef(def);
      BY_ID.set(def.id, { def, model: m });
    }
    MODELS.set(def, m);
  }
  return m;
}

export interface ObjectCardProps {
  card: CardModel | null;
  face: number;
  tapped: boolean;
  flipped: boolean;
  faceDown: boolean;
}

/** Props for <Card> of an object of the view; null when the view has no such object. */
export function objectCardProps(view: GameView, id: ObjectId): ObjectCardProps | null {
  const o = view.objects[id];
  if (!o) return null;
  const def = o.defId === HIDDEN_DEF ? undefined : view.defs[o.defId];
  return {
    card: def ? cardModelOf(def) : null,
    face: o.face,
    tapped: o.tapped,
    flipped: o.flipped,
    faceDown: o.faceDown,
  };
}
