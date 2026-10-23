/**
 * The face-down primitives (CR 708; m6 design 3.4). Owner: M6-3. Like rules/status.ts#transformPermanent they are the one implementation of their rule, reached
 * from the interpreter only through its performers (effects/perform-direct.ts): turning a face-down permanent face up (CR 708.8, 702.37e, 701.40b) and turning
 * a face-up permanent face down (CR 708.2a-b, 701.40a). Both give the permanent a new timestamp (CR 613.7f) and emit their event (`turnedFaceUp`,
 * `turnedFaceDown`, triggers/forms-face.ts).
 */
import type { Game } from '../core/game';
import type { ObjectId, PlayerId } from '../types/ids';
import type { FaceDownInfo } from '../types/state';

/**
 * CR 708.8: the face-down permanent is turned face up. Its copiable values revert to its normal ones (the 1b effect ends: statics/face-down.ts reads `faceDown`),
 * the effects that applied to it still apply, and abilities relating to entering the battlefield don't trigger (no zone change happens). CR 613.7f: a new
 * timestamp. CR 712.15a: a double-faced permanent turns up with its front face up. CR 702.37f, 702.168e: the X chosen as the special action was taken is kept
 * (`faceUpX`). FAST5X E25: `by`, the player who turns it face up, rides on the event (CR 701.40b, 608.2: "you turned a permanent face up"). CR 730.2f: each face-down component of a merged permanent is turned face up with it (statics/merge.ts reads the components' status). False
 * when there is no face-down permanent to turn.
 */
export function turnPermanentFaceUp(g: Game, id: ObjectId, opts: { x?: number; by?: PlayerId } = {}): boolean {
  const o = g.maybeObj(id);
  if (!o || !o.faceDown || o.zone !== 'battlefield') return false;
  o.faceDown = false;
  delete o.faceDownInfo;
  if (o.components) for (const c of o.components) delete c.faceDown; // CR 730.2f: each face-down component of a merged permanent is turned face up
  if (o.face !== 0) o.face = 0; // CR 712.15a
  o.timestamp = g.newTimestamp(); // CR 613.7f
  if (opts.x !== undefined) o.faceUpX = opts.x;
  g.emit({ type: 'turnedFaceUp', objectId: id, ...(opts.by !== undefined ? { by: opts.by } : {}) }); // FAST5X E25: who turned it (CR 701.40b, 608.2)
  return true;
}

/**
 * CR 708.2a: a face-up permanent is turned face down with this status (a plain 2/2 unless the effect lists other characteristics). CR 613.7f: a new timestamp.
 * The list of players it was revealed to is cleared (m6 design 3.4: a card shown earlier can't be followed into the face-down permanent), and so is the X of an
 * earlier turn face up. The caller checks CR 708.2b (already face down) and CR 712.16 (double-faced): false when nothing happened.
 */
export function turnPermanentFaceDown(g: Game, id: ObjectId, info: FaceDownInfo): boolean {
  const o = g.maybeObj(id);
  if (!o || o.faceDown || o.zone !== 'battlefield') return false;
  o.faceDown = true;
  o.faceDownInfo = { ...info };
  if (o.components) for (const c of o.components) c.faceDown = true; // CR 730.2f: each face-up component of a merged permanent is turned face down
  o.timestamp = g.newTimestamp(); // CR 613.7f
  delete o.revealedTo;
  delete o.faceUpX;
  g.emit({ type: 'turnedFaceDown', objectId: id });
  return true;
}
