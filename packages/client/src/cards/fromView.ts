/**
 * A game object as the card component draws it, from a GameView (the client renders views, never states; ARCHITECTURE.md "Hidden information"). An
 * object the viewer may not see has the hidden definition (`HIDDEN_DEF`) and is drawn as the card back.
 */
import { HIDDEN_DEF, type CardDef, type GameView, type ObjectId } from '@openmtg/engine';
import { modelFromDef, type CardModel } from './model';

const MODELS = new WeakMap<CardDef, CardModel>();
/** The model last made for a definition id, with a fingerprint of the definition it was made from. */
const BY_ID = new Map<string, { print: string; model: CardModel }>();

/** A short fingerprint of a definition's content (length and a 32-bit FNV-1a of its JSON). */
function fingerprint(def: CardDef): string {
  const json = JSON.stringify(def);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) h = Math.imul(h ^ json.charCodeAt(i), 0x01000193);
  return `${json.length}:${h >>> 0}`;
}

/**
 * The model of a definition, memoized (definitions are immutable, ARCHITECTURE.md "Engine principles" 2). Every view carries its own copy of the
 * definitions it uses (engine `projectView` clones them), so the same card is a new object with each change: the model is kept by definition id as well
 * (while the content is the same), so the card's picture component gets the same model and is not drawn again (ui/arena perf).
 */
export function cardModelOf(def: CardDef): CardModel {
  let m = MODELS.get(def);
  if (!m) {
    const print = fingerprint(def);
    const known = BY_ID.get(def.id);
    if (known && known.print === print) m = known.model;
    else {
      m = modelFromDef(def);
      BY_ID.set(def.id, { print, model: m });
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
