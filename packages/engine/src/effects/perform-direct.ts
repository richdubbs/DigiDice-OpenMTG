/**
 * The performers of the actions the proposal pipeline has no `Proposed` form for (design 8.5, 8.6 stage 4: "or the performer of a non-proposable action such
 * as `tap`"): tapping and untapping, attaching, transforming, phasing out, removing from combat, putting a permanent into combat attacking, removing an ability
 * from the stack, putting a copy onto the stack, and a resolved continuous effect joining the state. Owner: WP31 (an addition to the files of design 5.1, beside
 * WP11's effects/perform.ts, which it would otherwise grow past a cohesive size).
 *
 * Each one calls the single primitive that implements its rule (rules/status.ts, rules/phasing.ts, rules/combat-state.ts, rules/stack-objects.ts,
 * core/durations.ts); the handlers of effects/handlers/ call these, never the primitives, so the lint of test/m5/propose/lint.test.ts can tell the interpreter's
 * state writes from its reads. Legality (may it be attached there? may it transform? does a "can't" effect forbid it?) is the handler's to decide first.
 */
import type { Game } from '../core/game';
import { addEffectRecord, addUntilMove } from '../core/durations';
import { syncControl } from '../core/control';
import type { DefId, ObjectId, PlayerId } from '../types/ids';
import { bringIntoGame } from '../core/zones';
import type { ContinuousEffectRec, FaceDownInfo, GameObject, TargetChoice, UntilMoveRec } from '../types/state';
import { turnPermanentFaceDown, turnPermanentFaceUp } from '../rules/face-down';
import { makeBlocked, removeFromCombat } from '../rules/combat-state';
import { phaseOutPermanent } from '../rules/phasing';
import { createCardCopy, putCopyOnStack, removeFromStack } from '../rules/stack-objects';
import { addAttacker, attachPermanent, enterAttackingChoosing, entersAttackingAsReturned, flipPermanent, tapPermanent, transformPermanent, unattachPermanent, untapPermanent } from '../rules/status';

/** CR 701.26a: tap an untapped permanent; whether it changed. */
export const performTap = (g: Game, id: ObjectId, by?: PlayerId): boolean => tapPermanent(g, id, by); // FAST5X E20: `by`, the player whose effect taps it

/** CR 701.26b: untap a tapped permanent; whether it changed. */
export const performUntap = (g: Game, id: ObjectId): boolean => untapPermanent(g, id);

/** CR 701.3a, 613.7e: attach an Aura, Equipment or Fortification (the handler checked CR 701.3b). */
export const performAttach = (g: Game, id: ObjectId, to: ObjectId | PlayerId): void => attachPermanent(g, id, to);

/** CR 701.3d: unattach; whether it was attached. */
export const performUnattach = (g: Game, id: ObjectId): boolean => unattachPermanent(g, id);

/** CR 701.27a, 712.18, 613.7g: turn a double-faced permanent over (the handler checked CR 701.27c-f). */
export const performTransform = (g: Game, id: ObjectId, convert = false): void => transformPermanent(g, id, convert);

/** M6-4, CR 710.4: flip a permanent whose copiable values are a flip card's (the handler checked CR 110.5c); whether it changed. */
export const performFlip = (g: Game, id: ObjectId): boolean => flipPermanent(g, id);

/** CR 702.26b, 702.26g: phase a permanent out with what is attached to it; the ids that phased out. */
export const performPhaseOut = (g: Game, id: ObjectId): ObjectId[] => phaseOutPermanent(g, id);

/** CR 506.4: remove a permanent from combat. */
export const performRemoveFromCombat = (g: Game, id: ObjectId): void => removeFromCombat(g.s, id);

/** p2-combat-flow-2 (CR 509.1h): an unblocked attacking creature becomes blocked, with no blocker; whether it changed. */
export const performMakeBlocked = (g: Game, id: ObjectId): boolean => makeBlocked(g.s, id);

/** CR 508.4: a permanent put onto the battlefield attacking becomes an attacking creature (the handler checked CR 506.3, 508.4a). */
export const performAddAttacker = (g: Game, id: ObjectId, defender: PlayerId | ObjectId, defendingPlayer: PlayerId): void => addAttacker(g, id, defender, defendingPlayer);
/** trek-8 (CR 508.4): the creatures just put onto the battlefield attacking become attacking creatures; each one's controller chooses what it attacks (rules/status.ts#enterAttackingChoosing). */
export const performEnterAttacking = (g: Game, ids: readonly ObjectId[], named?: PlayerId, walkersOnly = false): ObjectId[] => enterAttackingChoosing(g, ids, named, walkersOnly);

/** trek-8 review (CR 508.4): run `f` (the proposals of an effect that puts permanents onto the battlefield attacking) with `by` as the way they join the combat. */
export const performWithEnterAttacking = <T>(g: Game, by: (ids: readonly ObjectId[]) => ObjectId[], f: () => T): T => {
  const before = g.enterAttackingBy;
  g.enterAttackingBy = by;
  try {
    return f();
  } finally {
    g.enterAttackingBy = before;
  }
};

/** std-typechange-1 (CR 702.49c, 508.4, 508.4a): a permanent put onto the battlefield attacking what the creature returned for the cost attacked; true when it attacks. */
export const performEntersAttackingAsReturned = (g: Game, id: ObjectId, how: { defender: PlayerId | ObjectId | null; defendingPlayer: PlayerId | null }, rule: string): boolean =>
  entersAttackingAsReturned(g, id, how, rule);

/** CR 701.6a, 113.7a: a countered ability is removed from the stack and ceases to exist. */
export const performRemoveFromStack = (g: Game, id: ObjectId): void => removeFromStack(g, id);

/** CR 707.10: a copy of a spell or ability onto the stack; its id. */
export const performCopyOnStack = (g: Game, original: GameObject, controller: PlayerId, targets: TargetChoice[][], defId?: DefId): ObjectId => putCopyOnStack(g, original, controller, targets, defId);

/** CR 707.12, 702.192a (FAST5X E26): a copy of a card created in exile (paradigm), to be cast at once; its id. */
export const performCreateCardCopy = (g: Game, original: Pick<GameObject, 'defId' | 'face'>, controller: PlayerId, zone: 'exile'): ObjectId => createCardCopy(g, original, controller, zone);

/** CR 611.2: a resolved continuous effect joins the state (an `until` duration counts events from now on). */
export const performEffectRecord = (g: Game, rec: ContinuousEffectRec): void => addEffectRecord(g, rec);

/** FAST4 MX1, CR 610.3: the objects a move exiled "until" an event wait for it (GameState.untilMoves; the event counts from now on). */
export const performUntilMove = (g: Game, rec: UntilMoveRec): void => addUntilMove(g, rec);

/** MX2: CR 613.1b: write the controller after layer 2 into the stored controllers now (core/control.ts#syncControl), after a control-changing effect began. */
export const performControlSync = (g: Game): void => syncControl(g);

/** M6-3 (m6 design 3.4): CR 708.8, 613.7f, 712.15a: turn a face-down permanent face up (the `turnFaceUp` proposal's performer decided it happens). */
export const performTurnFaceUp = (g: Game, id: ObjectId, opts: { x?: number; by?: PlayerId } = {}): boolean => turnPermanentFaceUp(g, id, opts);

/** M6-3 (m6 design 3.4): CR 708.2a, 613.7f: turn a face-up permanent face down (the handler checked CR 708.2b and 712.16). */
export const performTurnFaceDown = (g: Game, id: ObjectId, info: FaceDownInfo): boolean => turnPermanentFaceDown(g, id, info);

/**
 * FAST5 MX7, CR 400.11b, 701.48a: a card the player owns from outside the game is put into their hand (no `Proposed` form: no replacement effect in this
 * build applies to a card coming from outside the game); its new object id, or null when they own no such card outside the game.
 */
export const performBringIntoGame = (g: Game, owner: PlayerId, defId: DefId, to: 'hand' | 'library' = 'hand'): ObjectId | null => bringIntoGame(g, owner, defId, to);

/**
 * FAST5X E25 (CR 406.3): who may look at a card exiled face down: the players who could see it as it was exiled (`players`), or nobody (an empty list: "a pile
 * of cards that are shuffled", or no instruction let anyone look). Hidden information only: no game event.
 */
export function performExiledSeers(g: Game, ids: readonly ObjectId[], players: readonly PlayerId[]): void {
  for (const id of ids) {
    const o = g.s.objects[id];
    if (!o || o.zone !== 'exile' || !o.faceDown) continue;
    if (players.length > 0) o.revealedTo = [...players];
    else delete o.revealedTo;
  }
}

/**
 * r5-dig (CR 607.2a, 611.2a, 400.7): one more card exiled by an effect of the object `sourceId` (counted by object id: the source as a new object after a zone
 * change has its own count). Read by the duration "until you exile another card with ~" (`untilExiledWith`, core/durations.ts). No game event.
 */
export function performExiledWith(g: Game, sourceId: ObjectId): void {
  g.s.exiledWith = { ...(g.s.exiledWith ?? {}), [sourceId]: (g.s.exiledWith?.[sourceId] ?? 0) + 1 };
}
