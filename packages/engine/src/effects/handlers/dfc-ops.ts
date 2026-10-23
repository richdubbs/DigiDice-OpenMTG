/**
 * Double-faced operations: transform, convert, flip and the delayed self transform (CR 701.27, 701.28, 710, 712; m6 design 3.6). Owner: M6-4.
 *
 *   DFC_OPS             the `changeFace` forms this package owns (effects/handlers/change-face.ts#CHANGE_FACE spreads them LAST, so `transform` here replaces the
 *                       milestone 5 entry):
 *                         transform     the handler decided it may (CR 701.27c-f, 712.9, 712.10, 712.15a: change-face.ts#cantTransform); the permanent is turned
 *                                       over through a `transform` proposal, so "As this creature transforms into ~" (CR 712.20) and "can't transform"
 *                                       (CR 101.2, 614.17) apply;
 *                         convert       the same checks made here (CR 701.28a-f), then the same proposal with `convert` (the event says so, CR 701.27e);
 *                         delayedSelf   a delayed triggered ability of the permanent transforms it only if it hasn't transformed or converted since the delayed
 *                                       ability was created (CR 701.27f, 701.28e): its creation time is the record's `createdAt`, carried by the stack object's
 *                                       `abilityRef.index` (triggers/delayed.ts), compared with the permanent's `transformedAt`;
 *                         flip          a permanent whose copiable values are a flip card's flips once (CR 710.4, 110.5c: a Clone of an unflipped Jushi
 *                                       Apprentice can flip; a flipped one can't flip back).
 *   the performer of `transform` (installed into effects/proposal-kinds/transform.ts): the permanent is turned over (CR 701.27a, 712.18, 613.7g: same object,
 *                       new timestamp), then the steps of the `during` bodies run while it is transforming (CR 712.20), before any trigger or state-based
 *                       action can look.
 *   the day/night transform (installed into core/day-night.ts, which can't import the pipeline): a daybound or nightbound permanent transforms through the
 *                       same proposal, marked `dayNight` (CR 702.145b-c, e-f: the only transform such a permanent can make).
 */
import type { Game } from '../../core/game';
import { installDayNightTransform } from '../../core/day-night';
import { withMeld } from '../../core/move-parts/components';
import type { EffectStep, ObjRef } from '../../types/ability';
import type { ObjectId } from '../../types/ids';
import type { GameObject, GameState } from '../../types/state';
import { charsOfObject, faceChars } from '../../rules/characteristics';
import { cantDo } from '../../rules/cant';
import { copiableValuesOf } from '../../statics/copy';
import type { ExecCtx, Proposed, StepHandler } from '../api';
import type { Performed } from '../perform-events';
import { performFlip, performTransform } from '../perform-direct';
import { installTransformPerformer } from '../proposal-kinds/transform';
import { proposeResult } from '../propose';
import { contextFor } from '../replace-ctx';
import { runSteps } from '../run';
import type { ChangeFaceOp, ChangeFaceTable } from './change-face';
import { actOn, bindAs, byHand, did, firstPlayer, NOTHING, proposeMove } from './zones-util';

type Transform = Extract<Proposed, { ev: 'transform' }>;

/** The layouts whose cards (and tokens) can transform or convert (CR 712.9; a meld card can't, CR 712.4c). */
const TURNS_OVER = ['transform', 'modal_dfc', 'double_faced_token'];

/**
 * Why this permanent can't be turned over at all (CR 701.27c-d, 701.28c-d, 712.4c, 712.9, 712.10, 712.15a), or null. Decided by what REPRESENTS it (its own
 * card or token, `defId`), never by its copiable values: a Clone that copies Wildblood Pack can't transform; a Kruin Outlaw that became a copy of Elite Vanguard
 * can (CR 712.9 examples). Pure.
 */
export function whyCantTurnOver(s: GameState, o: GameObject): string | null {
  const def = s.defs[o.defId];
  if (o.components !== undefined) return 'a melded or merged permanent is not represented by one double-faced card (CR 701.27g, 712.4c)';
  if (!def || def.faces.length !== 2 || !TURNS_OVER.includes(def.layout)) return 'it is not represented by a double-faced card or token (CR 701.27c, 712.9)';
  if (o.faceDown) return "a face-down permanent can't transform (CR 712.15a)";
  const other = faceChars(def, o.face === 0 ? 1 : 0);
  if (other.types.includes('Instant') || other.types.includes('Sorcery')) return 'its other face is an instant or sorcery face (CR 701.27d, 712.10)';
  return null;
}

/**
 * CR 701.27f, 701.28e: has the permanent transformed or converted since the ability that tries to do it again was put onto the stack (or, for a delayed
 * triggered ability of the permanent, since that ability was created)? Only for an activated or triggered ability of the permanent itself.
 */
function alreadyTurnedOver(cx: ExecCtx, o: GameObject): boolean {
  const ability = cx.stack !== null && cx.stack.kind !== 'spell';
  if (!ability || o.id !== cx.source.id) return false;
  const since = o.transformedAt ?? -1;
  if (cx.stackTimestamp !== undefined && since > cx.stackTimestamp) return true;
  return cx.stack!.abilityRef?.source === 'delayed' && since >= cx.stack!.abilityRef.index; // the record's creation time (triggers/delayed.ts)
}

/** Propose the permanent turning over (CR 701.27a, 701.28a); whether it did. */
function turnOver(g: Game, id: ObjectId, convert: boolean, dayNight = false): boolean {
  const o = g.s.objects[id];
  if (!o || o.zone !== 'battlefield') return false;
  return proposeResult(g, { ev: 'transform', object: { id, zone: 'battlefield' }, convert, ...(dayNight ? { dayNight: true } : {}) }) !== null;
}

/** The performer of a `transform` proposal (effects/proposal-kinds/transform.ts). Null when nothing happened. */
function performTransformEvent(g: Game, e: Transform): Performed | null {
  const id = e.object.id;
  const o = g.s.objects[id];
  if (!o || o.zone !== 'battlefield' || o.zone !== e.object.zone) return null;
  const why = whyCantTurnOver(g.s, o);
  if (why) {
    g.log(`${g.nameOf(id)} doesn't ${e.convert ? 'convert' : 'transform'}: ${why}.`, { rules: ['CR 701.27c', 'CR 712.9'], level: 'info' });
    return null;
  }
  const before = g.nameOf(id);
  performTransform(g, id, e.convert); // CR 701.27a, 701.28a, 712.18, 613.7g
  g.log(`${before} ${e.convert ? 'converts' : 'transforms'} into ${g.nameOf(id)}.`, { rules: [e.convert ? 'CR 701.28a' : 'CR 701.27a', 'CR 712.18'], level: 'action' });
  // CR 712.20: "As this permanent transforms into ~, ..." happens while it is transforming (before any trigger or state-based action looks)
  for (const d of e.during ?? []) {
    const src = g.s.objects[d.source.id] ?? g.s.lki[d.source.id]?.object;
    if (src) runSteps(contextFor(g, src, d.controller), d.steps);
  }
  return { event: e, newIds: [id], amount: 1 };
}
installTransformPerformer(performTransformEvent);
installDayNightTransform((g, id) => turnOver(g, id, false, true));

/** CR 701.27a: the handler (change-face.ts) checked CR 701.27c-f; the permanent turns over through the proposal pipeline. */
const transform: ChangeFaceOp = (cx, _st, id) => void turnOver(cx.g, id, false);

/** CR 701.28: "convert ~" follows the transform rules (701.28a), checked here. */
const convert: ChangeFaceOp = (cx, _st, id) => {
  const g = cx.g;
  const o = g.s.objects[id];
  if (!o || o.zone !== 'battlefield') return;
  const why = whyCantTurnOver(g.s, o) ?? (cantDo(g.s, 'transform', id) ? 'a "can\'t transform" effect applies (CR 701.28f)' : null);
  if (why) return void g.log(`${g.nameOf(id)} doesn't convert: ${why}.`, { rules: ['CR 701.28c', 'CR 701.28d'], level: 'info' });
  if (alreadyTurnedOver(cx, o)) return void g.log(`${g.nameOf(id)} doesn't convert: it has transformed or converted since (CR 701.28e).`, { rules: ['CR 701.28e'], level: 'info' });
  turnOver(g, id, true);
};

/** CR 701.27f: a delayed triggered ability of the permanent transforms it only if it hasn't transformed or converted since the delayed ability was created. */
const delayedSelf: ChangeFaceOp = (cx, _st, id) => {
  const g = cx.g;
  const o = g.s.objects[id];
  if (!o) return;
  if (alreadyTurnedOver(cx, o)) return void g.log(`${g.nameOf(id)} doesn't transform: it has transformed since this delayed triggered ability was created (CR 701.27f).`, { rules: ['CR 701.27f'], level: 'info' });
  turnOver(g, id, false);
};

/** CR 710.4, 110.5c: flip a permanent whose copiable values are a flip card's; a flipped one stays flipped. */
const flip: ChangeFaceOp = (cx, _st, id) => {
  const g = cx.g;
  const o = g.s.objects[id];
  if (!o || o.zone !== 'battlefield') return;
  const def = g.s.defs[copiableValuesOf(g.s, id).defId];
  if (o.faceDown || !def || def.layout !== 'flip' || def.faces.length < 2) {
    return void g.log(`${g.nameOf(id)} doesn't flip: it is not a flip card (CR 710.1).`, { rules: ['CR 710.1', 'CR 110.5c'], level: 'info' });
  }
  if (o.flipped) return void g.log(`${g.nameOf(id)} is already flipped (CR 710.4).`, { rules: ['CR 710.4'], level: 'info' });
  const before = charsOfObject(g.s, o).name; // a flip card keeps its face: its name comes from the half its status selects (CR 710.2)
  if (performFlip(g, id)) g.log(`${before} flips into ${charsOfObject(g.s, g.s.objects[id]!).name}.`, { rules: ['CR 710.2', 'CR 710.4'], level: 'action' });
};

export const DFC_OPS: ChangeFaceTable = { transform, convert, delayedSelf, flip };

// ---- meld (CR 701.42, 712.4) -------------------------------------------------------------------------------------------------------------------------------

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native actions of this module. */
export const DFC_NATIVE_FEATURES: readonly string[] = ['action.native.meld'];

/**
 * Why these two objects can't be melded (CR 701.42b): two cards (not tokens) that are the two meld cards of one meld pair, in the same zone; `result`, when the
 * step names it ("meld them into Brisela"), must be that pair's result. Null when they can.
 */
export function whyCantMeld(s: GameState, objects: readonly GameObject[], result?: string): string | null {
  const [a, b] = objects;
  if (objects.length !== 2 || !a || !b || a.id === b.id) return 'melding takes exactly the two cards of a meld pair';
  if (a.kind !== 'card' || b.kind !== 'card') return "a token can't be melded";
  const da = s.defs[a.defId];
  const db = s.defs[b.defId];
  if (!da || !db || da.layout !== 'meld' || db.layout !== 'meld' || da.meld?.isResult || db.meld?.isResult) return 'only meld cards can be melded';
  if (da.meld?.partner !== b.defId || db.meld?.partner !== a.defId || da.meld?.result === undefined || da.meld.result !== db.meld?.result) return 'they are not the two cards of one meld pair';
  if (result !== undefined && da.meld.result !== result) return `they don't meld into ${result}`;
  if (a.zone !== b.zone) return 'they are not in the same zone';
  return null;
}

/**
 * "Meld them into <result>" (CR 701.42a): the two cards are put onto the battlefield as ONE permanent with their back faces up and combined, under the
 * control of `who` (the meld card's controller). `subject` names the two cards (bound by "exile them"); `arg` the result's name. Objects that can't be melded
 * stay where they are (CR 701.42c: a token there ceases to exist by the state-based actions). The result's definition must be in the game (loaded by deck
 * compilation, packages/cards/src/compile.ts, m6 design E18); without it the step is resolved by hand.
 */
const meldAction: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  const player = firstPlayer(cx, st.who);
  const subject = st.subject;
  if (player === undefined || typeof subject !== 'object' || !('ref' in subject)) return byHand(cx, st, "the engine can't tell which two cards to meld (CR 701.42a)");
  const handles = actOn(cx, subject as ObjRef);
  const objects = handles.map((h) => g.s.objects[h.id]!).filter((o) => o !== undefined);
  const why = whyCantMeld(g.s, objects, st.arg);
  if (why) {
    g.log(`They can't be melded: ${why}; they stay where they are.`, { rules: ['CR 701.42b', 'CR 701.42c'], level: 'info' });
    bindAs(cx, st.as, []);
    return NOTHING;
  }
  const [a, b] = objects as [GameObject, GameObject];
  const result = g.s.defs[a.defId]!.meld!.result!;
  if (!g.s.defs[result]) return byHand(cx, st, `the definition of the meld result ${result} is not loaded in this game (m6 design E18): put the two cards onto the battlefield as one permanent by hand`);
  const moved = withMeld(g, { from: a.id, partner: b.id, result }, () => proposeMove(cx, { id: a.id, zone: a.zone }, 'battlefield', { controller: player, cause: 'meld' }));
  const melded = moved.to !== null ? g.s.objects[moved.to.id] : undefined;
  if (!melded || melded.components === undefined) {
    g.log('The meld did not happen: the first card did not enter the battlefield.', { rules: ['CR 701.42c'], level: 'info' });
    bindAs(cx, st.as, []);
    return NOTHING;
  }
  g.log(`${g.player(player).name} melds them into ${g.nameOf(melded.id)}.`, { rules: ['CR 701.42a', 'CR 712.4a'], level: 'action' });
  bindAs(cx, st.as, [{ id: melded.id, zone: 'battlefield' }]);
  return did(1);
};

/** The native actions of this module by `ActionMacro.native` name (keywords/actions/meld.ts). */
export const DFC_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { meld: meldAction };
