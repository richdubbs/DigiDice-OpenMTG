/**
 * Primitives for objects on the stack that the proposal pipeline has no form for (design 8.5 lists none): countering an ability (it is removed and ceases to
 * exist, CR 701.6a, 113.7a) and putting a copy of a spell or ability onto the stack (CR 707.10). Added by WP14; the `counter` and `copy` op handlers call them
 * (design 8.6 stage 4: "the performer of a non-proposable action").
 *
 * WP14 INTERFACE CHANGE (new module outside WP14's files, declared in the WP14 review): state-writing performers the design 8.5 table does not list yet (see
 * rules/status.ts). `removeFromStack` calls core/zones.ts#moveObject directly: an ability leaving the stack is no zone change of a card, so no replacement
 * effect can apply to it (CR 113.7a), which is why it does not go through `propose`.
 */
import type { Game } from '../core/game';
import { freshObject, moveObject } from '../core/zones';
import type { DefId, ObjectId, PlayerId } from '../types/ids';
import type { GameObject, StackInfo, TargetChoice } from '../types/state';

/** CR 701.6a, 113.7a: a countered ability is removed from the stack and ceases to exist (an ability is not a card and goes nowhere). */
export function removeFromStack(g: Game, id: ObjectId): void {
  moveObject(g, id, 'graveyard', { cause: 'counter' }); // core/zones.ts: an ability leaving the stack just ends
  g.emit({ type: 'abilityCountered', objectId: id });
}

/** "That spell can't be countered" from the mana spent on it (CR 106.6, actions/cast.ts FLAG_CANT_BE_COUNTERED): a rider of the spell that was CAST, not copiable. */
const CAST_ONLY_FLAGS = new Set(['cantBeCountered']);

/**
 * CR 707.10: put a copy of `original` (a spell or ability as it is, or as it last was on the stack) onto the stack under `controller`, who also owns a copy of a
 * spell. The copy has the original's characteristics (`defId`, face) and every choice made for it: modes, X, division, the costs paid (CR 707.10: an effect of the
 * copy that refers to objects used to pay its costs uses the original's), the triggering event; `targets` are the copy's (the original's, or new ones chosen
 * under CR 707.10c). A copy of a spell is a spell but was not cast (no `spellCast` event; `spellCopied` instead, CR 707.10); where the original was cast from is
 * not a choice made for it, so the copy has no `castFrom` ("if this spell was cast from your hand" is false for it). A copy of an ability is not a spell and
 * emits no `spellCopied` (CR 113.1, 707.10: "whenever you cast or copy a spell" doesn't see it). Returns the copy's id.
 */
/** CLOUD std-misc (CR 707.9b, 707.10): `defId`, the definition of a copy with exceptions (effects/handlers/token-defs.ts#exceptedSpellDef); else the original's. */
export function putCopyOnStack(g: Game, original: GameObject, controller: PlayerId, targets: TargetChoice[][], defId?: DefId): ObjectId {
  const info = original.stack!;
  const stack: StackInfo = JSON.parse(JSON.stringify(info)) as StackInfo; // plain data: the copy never aliases the original's choices (design 4.3)
  stack.isCopy = true;
  delete stack.pendingId; // std-copy-6 (CR 707.10): a copy is not the trigger the original was
  delete stack.castFrom; // CR 707.10: a copy isn't cast, so it wasn't cast from anywhere (the costs paid, kicker and alternative costs, ARE copied)
  // CR 607.2q, 707.10: a linked ability refers only to cards exiled to pay the cost of the spell that became that permanent; a copy isn't cast and paid no
  // cost, so the permanent it becomes is linked to nothing the original's cost exiled (FAST5X E11 review: Champion of the Clachan and its cycle)
  delete stack.costsPaid.costLinks;
  stack.targets = targets.map((list) => list.map((t) => ({ ...t })));
  if (stack.flags) {
    stack.flags = stack.flags.filter((f) => !CAST_ONLY_FLAGS.has(f));
    if (stack.flags.length === 0) delete stack.flags;
  }
  const kind = original.kind === 'ability' ? 'ability' : 'spellCopy';
  const o = freshObject(g, { kind, defId: defId ?? original.defId, owner: controller, controller, face: original.face }, 'stack'); // CR 707.10: owned and controlled by that player
  o.stack = stack;
  if (kind === 'spellCopy' && original.prototyped === true) o.prototyped = true; // CR 718.3c: a copy of a prototyped spell is also a prototyped spell
  if (kind === 'spellCopy' && original.bestowed === true) o.bestowed = true; // std-ry7 (CR 702.103b, 707.10; cite unverified): a copy of a bestowed Aura spell is one too
  g.s.objects[o.id] = o;
  g.s.zones.stack.push(o.id); // it becomes the topmost object (CR 405.2)
  if (kind === 'spellCopy') g.emit({ type: 'spellCopied', objectId: o.id, copyOf: original.id }); // CR 707.10: only a copy of a spell is a spell
  // CR 603.2, 115: the copy's targets become targets of a spell or ability (ward and "becomes the target" triggers see the copy).
  const seen = new Set<string>();
  for (const t of stack.targets.flat()) {
    const key = `${t.kind}:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    g.emit({ type: 'becameTarget', objectId: t.id, byStackId: o.id, byController: controller });
  }
  return o.id;
}

/**
 * FAST5X E26 (CR 707.12, 702.192a): create a copy of a card in `zone` (paradigm: "create a copy of this object in exile"), owned and controlled by `controller`,
 * with the characteristics of `original` (its definition and face; the original may be last known information, CR 608.2h). A copy of a card is never a card
 * (`kind: 'spellCopy'`): the `cast` op casts it at once (CR 707.12), and one left outside the stack ceases to exist (CR 707.10a, 704.5e). Returns its id.
 */
export function createCardCopy(g: Game, original: Pick<GameObject, 'defId' | 'face'>, controller: PlayerId, zone: 'exile'): ObjectId {
  const o = freshObject(g, { kind: 'spellCopy', defId: original.defId, owner: controller, controller, face: original.face }, zone);
  g.s.objects[o.id] = o;
  g.s.zones[zone].push(o.id);
  return o.id;
}
