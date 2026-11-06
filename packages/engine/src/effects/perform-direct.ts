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
import { bringIntoGame, showCards } from '../core/zones';
import { exileLookVisibleTo } from '../statics/play-permits';
import type { ContinuousEffectRec, FaceDownInfo, GameObject, TargetChoice, UntilMoveRec } from '../types/state';
import type { ManaCost } from '../types/mana';
import { turnPermanentFaceDown, turnPermanentFaceUp } from '../rules/face-down';
import { makeBlocked, makeBlockedIds, removeFromCombat } from '../rules/combat-state';
import { phaseInPermanent, phaseOutPermanent } from '../rules/phasing';
import { createCardCopy, putCopyOnStack, removeFromStack } from '../rules/stack-objects';
import { addAttacker, attachPermanent, enterAttackingChoosing, enterBlocking, entersAttackingAsReturned, flipPermanent, tapPermanent, transformPermanent, unattachPermanent, untapPermanent } from '../rules/status';

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
/** edhn102 (CR 702.26b-c): a phased-out permanent phases in now, with what phased out with it; returns the ids that phased in. */
export const performPhaseIn = (g: Game, id: ObjectId, tapped = false): ObjectId[] => phaseInPermanent(g, id, tapped);

/** CR 506.4: remove a permanent from combat. */
export const performRemoveFromCombat = (g: Game, id: ObjectId): void => removeFromCombat(g.s, id);

/** p2-combat-flow-2 (CR 509.1h): an unblocked attacking creature becomes blocked, with no blocker; whether it changed. */
export const performMakeBlocked = (g: Game, id: ObjectId): boolean => makeBlocked(g.s, id);
export const performMakeBlockedIds = (g: Game, id: ObjectId): ObjectId[] => makeBlockedIds(g.s, id); // edhv31 (CR 702.22i)

/** CR 508.4: a permanent put onto the battlefield attacking becomes an attacking creature (the handler checked CR 506.3, 508.4a). */
export const performAddAttacker = (g: Game, id: ObjectId, defender: PlayerId | ObjectId, defendingPlayer: PlayerId): void => addAttacker(g, id, defender, defendingPlayer);
/** trek-8 (CR 508.4): the creatures just put onto the battlefield attacking become attacking creatures; each one's controller chooses what it attacks (rules/status.ts#enterAttackingChoosing). */
export const performEnterAttacking = (g: Game, ids: readonly ObjectId[], named?: PlayerId, walkersOnly = false): ObjectId[] => enterAttackingChoosing(g, ids, named, walkersOnly);

/** edh-combat-4 (CR 506.3e): the creatures just put onto the battlefield blocking an attacker become blocking creatures (rules/status.ts#enterBlocking). */
export const performEnterBlocking = (g: Game, ids: readonly ObjectId[], attackerId: ObjectId): ObjectId[] => enterBlocking(g, ids, attackerId);

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
export const performCreateCardCopy = (g: Game, original: Pick<GameObject, 'defId' | 'face'>, controller: PlayerId, zone: 'exile' | 'hand', castReduce?: ManaCost): ObjectId => {
  const id = createCardCopy(g, original, controller, zone);
  // edh-next-132 (CR 601.2f): "That copy costs {2} less to cast" (God-Eternal Kefnet), read by statics/costmods.ts#costModsFor
  if (castReduce !== undefined) g.s.objects[id]!.castReduce = castReduce;
  return id;
};

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
 * edh-next-62 (CR 406.3, 607.2a; rulings of Colfenor's Plans 2013-04-15 and Kheru Mind-Eater 2017-08-25: once a player looks at a face-down exiled card they may look at it any
 * time later): a card just exiled face down that the source's controller may look at because a static `lookAt` permission names the cards its linked ability exiled is
 * shown to that player for as long as it stays the same object in exile (core/zones.ts#showCards), also after the permission stops functioning. Hidden information only: no game event.
 */
export function performLookedAtExiled(g: Game, source: ObjectId, ids: readonly ObjectId[]): void {
  const viewer = g.s.objects[source]?.controller;
  if (viewer === undefined) return;
  for (const id of ids) if (g.s.objects[id]?.zone === 'exile' && g.s.objects[id]?.faceDown === true && exileLookVisibleTo(g.s, id, viewer)) showCards(g, [id], [viewer]);
}

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
 * edh-d-101 (CR 406.3, 400.2; The Creation of Avacyn): a face-down card in exile is turned face up where it is (the same object; it is a card, not a permanent, so no "turned face
 * up" event happens): every player may now see it. False when it is not a face-down card in exile.
 */
export function performTurnExiledFaceUp(g: Game, id: ObjectId): boolean {
  const o = g.s.objects[id];
  if (!o || o.kind !== 'card' || o.zone !== 'exile' || !o.faceDown) return false;
  o.faceDown = false;
  delete o.revealedTo;
  return true;
}

/**
 * r5-dig (CR 607.2a, 611.2a, 400.7): one more card exiled by an effect of the object `sourceId` (counted by object id: the source as a new object after a zone
 * change has its own count). Read by the duration "until you exile another card with ~" (`untilExiledWith`, core/durations.ts). No game event.
 */
export function performExiledWith(g: Game, sourceId: ObjectId): void {
  g.s.exiledWith = { ...(g.s.exiledWith ?? {}), [sourceId]: (g.s.exiledWith?.[sourceId] ?? 0) + 1 };
}
