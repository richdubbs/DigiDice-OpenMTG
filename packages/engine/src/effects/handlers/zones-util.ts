/**
 * Helpers shared by the WP14 handler families (effects/handlers/zones*.ts, tokens*.ts): the stages of design 8.6 that every one of them repeats.
 *
 *  - references: the objects a step may still ACT on (CR 400.7: a handle whose object moved is a new object), the player a `who` names;
 *  - acting: a zone change proposed to the pipeline (`propose`, WP11) and what it became (the new object, CR 400.7), re-basing bindings (design 3.1 rule 2);
 *  - recording: `as` bindings with last known information, the manual fallback for forms the M5 build does not run (never silently skipped).
 */
import type { Game } from '../../core/game';
import { renewedHandle } from '../../core/zones';
import type { Destination, ObjRef, PlayerRef, EffectStep, LinkId, Name } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameObject, LastKnown, ObjHandle, ZoneKind } from '../../types/state';
import { charsOfObject, controllerOf, faceChars, hasKeyword } from '../../rules/characteristics';
import { randomIndex } from '../../rules/random';
import { readLink } from '../../statics/links';
import type { DestinationFacts, ExecCtx, StepResult } from '../api';
import { evalQty } from '../eval';
import { askManual } from '../manual';
import { performLink } from '../perform';
import { performEnterAttacking, performEntersAttackingAsReturned, performExiledWith, performWithEnterAttacking } from '../perform-direct';
import { propose } from '../propose';
import { alsoBecameHandles, isCurrent, readInfo, rebase, resolveObjs, resolvePlayers } from '../refs';

/** The step did nothing (nothing to act on, or information that fails to determine, CR 608.2b). */
export const NOTHING: StepResult = { performed: false, count: 0 };

export const did = (count: number): StepResult => ({ performed: count > 0, count });

/** Zones everyone can see (CR 400.2): a move there re-bases the bindings and the new object can be found by the rest of the effect (CR 400.7j). */
export const PUBLIC_ZONES: readonly ZoneKind[] = ['battlefield', 'graveyard', 'stack', 'exile', 'command'];

/**
 * The objects of a reference that can still be acted on, in the order the reference gives them (zone order, then id: design 8.8 rule 1). A phased-out permanent
 * is treated as though it doesn't exist (CR 702.26b): no op acts on it.
 */
export function actOn(cx: ExecCtx, ref: ObjRef): ObjHandle[] {
  return resolveObjs(cx, ref).filter((h) => isCurrent(cx, h) && !(h.zone === 'battlefield' && cx.g.s.objects[h.id]?.phasedOut === true));
}

/** The objects of a reference that can still be acted on AND are permanents on the battlefield (phased-out ones do not exist, CR 702.26b). */
export function permanentsOf(cx: ExecCtx, ref: ObjRef): ObjHandle[] {
  return actOn(cx, ref).filter((h) => h.zone === 'battlefield');
}

/** A whole number from a quantity, or undefined when it fails to determine (CR 608.2b); a negative result is 0 (CR 107.1b). */
export function wholeNumber(cx: ExecCtx, q: Parameters<typeof evalQty>[1]): number | undefined {
  const n = evalQty(cx, q);
  return n === undefined || Number.isNaN(n) ? undefined : Math.max(0, Math.floor(n));
}

/**
 * The library position of one card (CR 401.3 counts from the top; "at random" is drawn as the card moves, design 8.8 rule 2). No position is the top. Undefined
 * when an "Nth from the top" quantity fails to determine (CR 608.2b).
 */
export function libraryPosition(cx: ExecCtx, p: Destination['position'], owner: PlayerId): DestinationFacts['position'] | undefined {
  if (p === undefined || p === 'top') return 'top';
  if (p === 'bottom') return 'bottom';
  if (p === 'random') return randomIndex(cx.g, (cx.g.s.zones.library[owner]?.length ?? 0) + 1);
  const n = wholeNumber(cx, p.nth);
  return n === undefined ? undefined : Math.max(0, n - 1); // "Nth from the top": index N-1
}

/**
 * CR 607.2a, 607.2c: the linked ability refers to every object the other ability put somewhere (or created) on ANY of its resolutions, so each resolution ADDS
 * to the source's link store instead of replacing it; insertion order is kept ("the card most recently exiled with ~"). Only the source as it is now has a store
 * (CR 400.7: a new object starts without one). Handles that went stale are left for the readers to skip (`isCurrent`).
 */
export function addToLink(cx: ExecCtx, link: LinkId | undefined, objects: readonly ObjHandle[]): void {
  if (!link) return;
  const src = cx.g.s.objects[cx.source.id];
  if (!src || src.zone !== cx.source.zone) return;
  const prev = readLink(src, link);
  const before = prev?.objects ?? [];
  performLink(cx.g, cx.source, link, { ...prev, objects: [...before, ...objects.filter((h) => !before.some((b) => b.id === h.id))] }); // the write is a performer's (design 8.5)
}

/** The first player a `who` stands for, or undefined when it fails to determine (CR 608.2b). */
export const firstPlayer = (cx: ExecCtx, ref: PlayerRef): PlayerId | undefined => resolvePlayers(cx, ref)[0];

/** Bind `as` to what the step produced (design 2.3 `StepBase.as`); `snapshots` keep the last known information later steps read (CR 608.2h). */
export function bindAs(cx: ExecCtx, as: Name | undefined, objects: ObjHandle[], players: PlayerId[] = [], snapshots: Record<ObjectId, LastKnown> = {}): void {
  if (!as) return;
  const snaps: Record<ObjectId, LastKnown> = { ...snapshots };
  for (const h of objects) {
    if (snaps[h.id]) continue;
    const info = readInfo(cx, h);
    if (info) snaps[h.id] = info;
  }
  cx.bindings.set(as, { objects, players, snapshots: snaps });
}

/** What became of an object after a zone change: its new object (CR 400.7), or null when it did not move, ceased to exist (a token, CR 111.7) or vanished. */
export function newObjectOf(g: Game, oldId: ObjectId): ObjHandle | null {
  if (g.s.objects[oldId]) return null; // still there: it did not move (a replacement kept it, or nothing happened)
  const newId = g.s.lki[oldId]?.newId;
  const o = newId ? g.s.objects[newId] : undefined;
  return o ? { id: o.id, zone: o.zone } : null;
}

/** The result of proposing one zone change. */
export interface Moved {
  /** The pipeline let it happen (or a replacement did something else in its place: then `to` says what became of the object). */
  ok: boolean;
  /** The new object (CR 400.7), null when there is none (it ceased to exist, or it stayed where it was). */
  to: ObjHandle | null;
  /** Last known information of the object before it moved (CR 608.2h). */
  before: LastKnown | undefined;
  /** CR 712.21c: the other cards a melded permanent became, in the zone of `to` (`movedHandles`). */
  also?: ObjHandle[];
}

/** Every object a move made (CR 712.21c: each card a melded permanent became). */
export const movedHandles = (m: Moved): ObjHandle[] => (m.to ? [m.to, ...(m.also ?? [])] : []);

/** The result of a move of `oldId` that left its zone (`to`: the object it became), with the other cards a melded permanent became (CR 712.21c). */
export function movedResult(cx: ExecCtx, oldId: ObjectId, to: ObjHandle | null): Moved {
  const before = cx.g.s.lki[oldId];
  const also = to ? alsoBecameHandles(cx, before, to.zone) : [];
  return { ok: true, to, before, ...(also.length > 0 ? { also } : {}) };
}

/**
 * Propose a zone change for an object that can still be acted on (design 8.5: the pipeline applies replacements, then the performer calls `moveObject`), and
 * re-base every binding that holds it onto the new object when the destination is public (CR 400.7j, design 3.1 rule 2; a hand or library is not: the rest of
 * the effect can't find the new object there). H1: a library card a shuffle renewed earlier in this run is followed to its new id (`renewedHandle`, CR 614.1a:
 * a replacement of an earlier move of the same effect shuffled that library).
 */
export function proposeMove(cx: ExecCtx, held: ObjHandle, to: ZoneKind, destination: DestinationFacts): Moved {
  const h = renewedHandle(cx.g, held);
  propose(cx.g, { ev: 'zoneChange', object: h, from: h.zone, to, destination });
  // What happened is read from the state, not from the pipeline's answer: the object left its zone (it is a new object, or it ceased to exist) or it didn't.
  const left = !cx.g.s.objects[h.id];
  const moved = newObjectOf(cx.g, h.id);
  if (left) rebase(cx, h.id, moved); // rebase ignores a hidden destination (the stale handle keeps reading last known information)
  // r5-dig (CR 607.2a): one more card exiled with the source of this effect (the duration "until you exile another card with ~", core/durations.ts)
  if (left && to === 'exile' && moved !== null && moved.zone === 'exile' && cx.g.s.objects[moved.id]?.kind === 'card') {
    performExiledWith(cx.g, cx.source.id);
  }
  return left ? movedResult(cx, h.id, moved) : { ok: false, to: moved, before: cx.g.s.lki[h.id] };
}

/**
 * The binding a step that moved objects leaves under `as` ("exile it ... return it", "the exiled card"): the new objects in public zones, read through the last
 * known information of what they were (CR 608.2h) except on the battlefield and the stack, where the object has current information of its own (CR 400.7j).
 */
export function bindMoved(cx: ExecCtx, as: Name | undefined, moved: Moved[]): void {
  if (!as) return;
  const objects: ObjHandle[] = [];
  const snapshots: Record<ObjectId, LastKnown> = {};
  for (const m of moved) {
    for (const to of movedHandles(m)) { // CR 712.21c: each card a melded permanent became
      if (!PUBLIC_ZONES.includes(to.zone)) continue;
      objects.push(to);
      if (m.before && to.zone !== 'battlefield' && to.zone !== 'stack') snapshots[to.id] = m.before;
    }
  }
  bindAs(cx, as, objects, [], snapshots);
}

/**
 * CR 702.34a, 702.127a: a spell cast with flashback, or the aftermath half cast from a graveyard, is exiled "instead of putting it anywhere else any time it would
 * leave the stack" (countered, returned to hand, ...). The same native rule core/resolve.ts applies when the spell resolves (design 15.3 #8: flashback stays native in M5).
 */
export function exiledLeavingStack(g: Game, o: GameObject): boolean {
  const info = o.stack;
  if (!info || o.kind !== 'card') return false;
  if (info.costsPaid.alternative === 'flashback') return true;
  if (info.exileOnLeave === true) return true; // FAST5X E6: CR 702.180a, harmonize (StackInfo.exileOnLeave)
  const def = g.s.defs[o.defId];
  if (!def || info.fused) return false;
  return info.castFrom === 'graveyard' && hasKeyword(faceChars(def, info.face ?? 0), 'aftermath');
}

/** The sentence of a step for prompts and the log (display data; design 2.3 `StepBase.span`). */
export const spanOf = (st: EffectStep): string => st.span ?? `(${st.op})`;

/** A form of the step this build does not run: the players do it by hand (never silently skipped; ARCHITECTURE "Abilities are data" item 5). */
export function byHand(cx: ExecCtx, st: EffectStep, reason: string): StepResult {
  return askManual(cx, spanOf(st), reason);
}

/**
 * CR 508.4: the creatures just put onto the battlefield "attacking" become attacking creatures. Each one's controller chooses what it attacks among the defending
 * players and the planeswalkers they control and battles they protect (no question when there is one choice), unless the effect names the player. A creature put
 * onto the battlefield outside combat, under the control of a player who isn't attacking, or attacking a player who has left, is not attacking (CR 506.3a-c, 506.3f,
 * 508.4a). Returns the ids that became attacking creatures.
 */
export function enterAttacking(cx: ExecCtx, ids: readonly ObjectId[], how: boolean | { defender: PlayerRef; orPlaneswalkers?: true } | { asReturned: true }): ObjectId[] {
  const g = cx.g;
  const s = g.s;
  if (!s.combat || how === false) return [];
  // std-typechange-1 (ninjutsu, CR 702.49c, 508.4): attacking what the creature returned to pay this ability's cost was attacking as it left the battlefield (its last
  // known information, CR 608.2h, 506.4): named by the effect, so nobody chooses (rules/status.ts#entersAttackingAsReturned, sneak's reading)
  if (typeof how === 'object' && 'asReturned' in how) {
    const returned = cx.stack?.costsPaid.returned?.[0];
    const was = returned !== undefined ? s.lki[returned]?.combat : undefined;
    const target = { defender: was?.defender ?? null, defendingPlayer: was?.defendingPlayer ?? null };
    return ids.filter((id) => s.objects[id]?.zone === 'battlefield' && performEntersAttackingAsReturned(g, id, target, 'CR 702.49c'));
  }
  let named: PlayerId | undefined;
  if (typeof how === 'object') {
    named = firstPlayer(cx, how.defender);
    if (named === undefined || g.player(named).hasLost) return []; // CR 508.4a
  }
  // M6-12: "attacking that player or a planeswalker they control" (myriad, CR 702.116a): the named player's planeswalkers, no battle
  return performEnterAttacking(g, ids, named, typeof how === 'object' && how.orPlaneswalkers === true); // trek-8: rules/status.ts#enterAttackingChoosing
}

/**
 * trek-8 review (CR 508.4): run the proposals of an effect that puts permanents onto the battlefield "attacking" (`how` is its `attacking`: false/undefined for none)
 * so that a replacement effect which makes a permanent enter tapped and attacking too (Kira Nerys) joins the combat the way THIS effect says (the player it names,
 * ninjutsu's "what the returned creature attacked"), the controller choosing only where the effect names nothing, and once (`enterAttacking` skips what already
 * attacks). Without such an effect nothing changes: the effect's own `enterAttacking` call after the proposals does it all.
 */
export function enteringAttacking<T>(cx: ExecCtx, how: boolean | { defender: PlayerRef; orPlaneswalkers?: true } | { asReturned: true } | undefined, f: () => T): T {
  if (how === undefined || how === false) {
    // trek-8 re-review: a nested entry that does not attack does not inherit the outer effect's way of attacking
    const before = cx.g.enterAttackingBy;
    cx.g.enterAttackingBy = null;
    try {
      return f();
    } finally {
      cx.g.enterAttackingBy = before;
    }
  }
  return performWithEnterAttacking(cx.g, (ids) => enterAttacking(cx, ids, how), f);
}

/** Names of several objects for the log. */
export const namesOf = (g: Game, hs: readonly ObjHandle[]): string => hs.map((h) => g.nameOf(h.id)).join(', ');
