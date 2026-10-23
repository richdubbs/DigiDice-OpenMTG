/**
 * The `changeFace` op (CR 701.27 transform, 701.28 convert, 708 face up / face down, 701.40 manifest, 710 flip), moved out of effects/handlers/zones-status.ts
 * by M6-0 (m6 design 2.6, 4.1) so each form is an entry of `CHANGE_FACE` in its owner's file: transform (milestone 5, below), faceUp / faceDown / manifest
 * (M6-3, effects/handlers/face-ops.ts), convert / flip / delayedSelf (M6-4, effects/handlers/dfc-ops.ts). A form with no entry is resolved by hand, and the
 * capability walker names it (`op:changeFace.<to>`, model/cap-walk.ts), so no card using it is classified automated.
 *
 * `delayedSelf` is the CR 701.27f case of a DELAYED triggered ability that transforms the permanent it belongs to ("if it hasn't transformed since the delayed
 * ability was created"): the milestone 5 transform resolves it by hand when the timestamps don't settle it; M6-4's entry (with DelayedTriggerRec.createdAt)
 * takes it over.
 */
import type { EffectStep } from '../../types/ability';
import type { ObjectId } from '../../types/ids';
import type { GameObject } from '../../types/state';
import { faceChars } from '../../rules/characteristics';
import { cantDo } from '../../rules/cant';
import type { ExecCtx, StepHandler } from '../api';
import { performTransform } from '../perform-direct';
import { bindAs, byHand, did, permanentsOf } from './zones-util';
import { DFC_OPS } from './dfc-ops';
import { FACE_OPS } from './face-ops';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;

/** The forms of `changeFace`: its `to`, `manifest` (the step's `manifest` flag) and `delayedSelf` (see the file comment). */
export type ChangeFaceTo = Step<'changeFace'>['to'] | 'manifest' | 'delayedSelf';
/**
 * One form, for one object (m6 design 2.6). std-typechange-2 INTERFACE CHANGE (additive): a form may return `false` when nothing happened to the object (a face-down
 * instant or sorcery card that can't be turned face up, a permanent already face up, a "can't be turned face up" effect: CR 701.40g, 701.58g, 708.7), so the step
 * reports only what it did ("Turn this creature face up. If you can't, ...", CR 608.2c); any other return counts the object as before.
 */
export type ChangeFaceOp = (cx: ExecCtx, step: Step<'changeFace'>, object: ObjectId) => boolean | void;
export type ChangeFaceTable = Partial<Record<ChangeFaceTo, ChangeFaceOp>>;

/** CR 701.27a, 712.18: the permanent transforms (the handler decided it may). */
const transformOne: ChangeFaceOp = (cx, _st, id) => {
  const g = cx.g;
  const before = g.nameOf(id);
  performTransform(g, id);
  g.log(`${before} transforms into ${g.nameOf(id)}.`, { rules: ['CR 701.27a', 'CR 712.18'], level: 'action' });
};

/** The forms of `changeFace` this build performs (m6 design 2.6): transform (milestone 5) and the entries of the owners' files (empty in M6-0). */
export const CHANGE_FACE: ChangeFaceTable = { transform: transformOne, ...FACE_OPS, ...DFC_OPS };

// ---- transform (CR 701.27) ------------------------------------------------------------------------------------------------------------------------

/**
 * Why this permanent doesn't transform now (`skip`), or why the engine can't tell (`manual`), or null when it transforms (CR 701.27c-d, 701.27f, 712.9, 712.10,
 * 712.15a).
 *
 * CR 701.27f: an activated or triggered ability of a permanent transforms it only if it hasn't transformed since the ability was put onto the stack; a DELAYED
 * triggered ability of the permanent, only if it hasn't transformed since the delayed ability was created. A transformation gives the permanent a new timestamp
 * (CR 613.7g), so a timestamp later than the ability's (captured by makeCtx, `stackTimestamp`) means it has (an Aura or Equipment that became attached meanwhile
 * reads the same; such double-faced attachments are rare and the check errs on doing nothing). For a delayed ability that only proves it for the time since the
 * ability was put onto the stack: the record of a delayed trigger keeps no creation time yet (WP8/WP15), so when the timestamps don't settle it the step is
 * resolved by hand (the capability walker names the form `op:changeFace.delayedSelf`) unless `CHANGE_FACE.delayedSelf` exists (M6-4).
 */
function cantTransform(cx: ExecCtx, o: GameObject): { skip: string } | { manual: string } | { delayed: true } | null {
  const def = cx.g.s.defs[o.defId];
  if (!def || def.faces.length !== 2 || def.layout === 'meld' || !['transform', 'modal_dfc', 'double_faced_token'].includes(def.layout)) return { skip: 'it is not a double-faced permanent (CR 701.27c, 712.9)' };
  if (o.faceDown) return { skip: 'a face-down permanent can\'t transform (CR 712.15a)' };
  const other = faceChars(def, o.face === 0 ? 1 : 0);
  if (other.types.includes('Instant') || other.types.includes('Sorcery')) return { skip: 'its other face is an instant or sorcery (CR 701.27d, 712.10)' };
  const cant = cantDo(cx.g.s, 'transform', o.id); // WP31: "can't transform" (CR 701.27, 101.2)
  if (cant) return { skip: `a "can't transform" effect applies (CR 101.2): ${cant.message}` };
  const ability = cx.stack !== null && cx.stack.kind !== 'spell';
  if (!ability || o.id !== cx.source.id || cx.stackTimestamp === undefined) return null;
  if (o.timestamp > cx.stackTimestamp) return { skip: 'it has transformed since this ability was put onto the stack (CR 701.27f)' };
  if (cx.stack!.abilityRef?.source === 'delayed') {
    if (CHANGE_FACE.delayedSelf) return { delayed: true }; // M6-4 decides it from DelayedTriggerRec.createdAt (CR 701.27f)
    return { manual: 'whether it has transformed since this delayed triggered ability was created is not recorded yet (CR 701.27f)' };
  }
  return null;
}

/** "Transform ~", "transform target Werewolf" (`to: 'transform'`); the other forms through `CHANGE_FACE` (resolved by hand while they have no entry). */
export const changeFace: StepHandler<Step<'changeFace'>> = (cx, st) => {
  const key: ChangeFaceTo = st.manifest ? 'manifest' : st.to;
  if (key !== 'transform') {
    const op = CHANGE_FACE[key];
    if (!op) return byHand(cx, st, `${st.to}${st.manifest ? ' (manifest)' : ''} is milestone 6 (CR 701.28, 708, 709)`);
    const hs = permanentsOf(cx, st.what);
    const changed = hs.filter((h) => op(cx, st, h.id) !== false); // std-typechange-2: only what it did (CR 608.2c)
    bindAs(cx, st.as, hs);
    return did(changed.length);
  }
  const g = cx.g;
  const done: ObjectId[] = [];
  const plans = permanentsOf(cx, st.what).map((h) => ({ o: g.s.objects[h.id]!, why: cantTransform(cx, g.s.objects[h.id]!) }));
  const unknown = plans.find((p) => p.why !== null && 'manual' in p.why);
  if (unknown) return byHand(cx, st, (unknown.why as { manual: string }).manual); // decided before anything transforms (design 8.6 stage 3)
  for (const { o, why } of plans) {
    if (why && 'delayed' in why) {
      CHANGE_FACE.delayedSelf!(cx, st, o.id); // M6-4 (CR 701.27f)
      if (g.s.objects[o.id]) done.push(o.id);
      continue;
    }
    if (why) {
      g.log(`${g.nameOf(o.id)} doesn't transform: ${(why as { skip: string }).skip}.`, { rules: ['CR 701.27c', 'CR 701.27f'], level: 'info' });
      continue;
    }
    CHANGE_FACE.transform!(cx, st, o.id);
    done.push(o.id);
  }
  bindAs(cx, st.as, done.map((id) => ({ id, zone: 'battlefield' as const })));
  return did(done.length);
};
