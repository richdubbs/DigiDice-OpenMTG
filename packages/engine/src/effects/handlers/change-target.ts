/**
 * r4-fxb: changeTarget, "Change the target of target spell or ability with a single target." (CR 115.7, 115.7a). Each spell or ability `what` names keeps its
 * one target unless another legal one exists: `who` then chooses which (legal for that spell or ability: its spec, its controller, its source, CR 115.7a).
 * A spell or ability with any other number of targets is left alone (the words say "with a single target"; the target spec of the effect already asks it).
 */
import type { EffectStep } from '../../types/ability';
import type { ObjectId } from '../../types/ids';
import type { TargetChoice } from '../../types/state';
import { targetOptions } from '../../rules/targets';
import type { ExecCtx, StepResult } from '../api';
import { resolveObjs, resolvePlayers } from '../refs';
import { targetSpecsOf } from './tokens-copy';
import { did, NOTHING } from './zones-util';

type ChangeTarget = Extract<EffectStep, { op: 'changeTarget' }>;

/** The forms of the step this handler carries out beyond the plain one (read by model/capabilities.ts). */
export const OP_FORMS: readonly string[] = ['op:changeTarget.to' /* edh-cast-1: "change a target of target spell or ability to ~", CR 115.7 */];

/**
 * edh-cast-1 (CR 115.7, 115.7a, 115.3; unverified cites): "Change a target of target spell or ability to ~.": one target of each spell or ability `what` names becomes the object
 * `to` names, when that object is a legal choice for that target's spec and is not already one of that spec's targets. `who` chooses which target when several can change.
 */
function changeTargetTo(cx: ExecCtx, st: ChangeTarget, who: string): StepResult {
  const g = cx.g;
  const dest = st.to === undefined ? undefined : resolveObjs(cx, st.to)[0];
  if (dest === undefined) return NOTHING;
  const destId = dest.id;
  let changed = 0;
  for (const h of resolveObjs(cx, st.what)) {
    const o = g.s.objects[h.id];
    if (!o || o.zone !== 'stack' || !o.stack) continue; // it left the stack: nothing to change (CR 608.2b)
    const specs = targetSpecsOf(cx, o);
    if (!specs || specs.length !== o.stack.targets.length) continue;
    const sourceId: ObjectId | undefined = o.kind === 'ability' ? o.stack.sourceId : o.id;
    const slots: { spec: number; at: number; old: TargetChoice }[] = [];
    // review (edh-cast-1): a target spec tied to another one or to the whole set ("another target", "different names", "total power ...", "for each opponent") can't be
    // changed here without re-checking those ties (CR 115.3, 115.7a, 115.7d; effects/handlers/new-targets.ts does): fail closed, the target stays
    const TIES = ['distinctFrom', 'groupLimit', 'sameOwner', 'differentNames', 'perOpponent', 'perPlayer', 'sharedCardType', 'sharedCreatureType', 'differentControllers', 'sameController'] as const;
    const tied = (i: number): boolean => TIES.some((k) => (specs[i] as unknown as Record<string, unknown>)[k] !== undefined) || specs.some((x) => x.distinctFrom?.includes(specs[i]!.id) === true);
    o.stack.targets.forEach((list, i) => {
      if (tied(i)) return;
      if (list.some((t) => t.kind === 'object' && t.id === destId)) return; // already a target of that "target" (CR 115.3)
      if (!targetOptions(g.s, specs[i]!, o.controller, sourceId, o.id).objects.includes(destId)) return;
      list.forEach((old, at) => { slots.push({ spec: i, at, old }); });
    });
    if (slots.length === 0) {
      g.log(`No target of ${g.nameOf(o.id)} can be changed to ${g.nameOf(destId)}: it is unchanged.`, { rules: ['CR 115.7a'], level: 'info' });
      continue;
    }
    let slot = slots[0]!;
    if (slots.length > 1) {
      const [picked] = g.choose({
        kind: 'chooseTargets', player: who, prompt: `Choose the target of ${g.nameOf(o.id)} to change to ${g.nameOf(destId)}.`, targetText: 'a target of the spell or ability',
        objects: [...new Set(slots.filter((x) => x.old.kind === 'object').map((x) => x.old.id))], players: [...new Set(slots.filter((x) => x.old.kind === 'player').map((x) => x.old.id))],
        min: 1, max: 1, rules: ['CR 115.7'],
      }).targets;
      slot = slots.find((x) => picked !== undefined && x.old.kind === picked.kind && x.old.id === picked.id) ?? slots[0]!;
    }
    o.stack.targets = o.stack.targets.map((l, i) => (i === slot.spec ? l.map((t, at) => (at === slot.at ? { kind: 'object' as const, id: destId } : t)) : l));
    g.log(`${g.player(who).name} changes a target of ${g.nameOf(o.id)} to ${g.nameOf(destId)}.`, { rules: ['CR 115.7'], level: 'action' });
    g.emit({ type: 'becameTarget', objectId: destId, byStackId: o.id, byController: o.controller }); // CR 603.2: it becomes a target of that spell or ability
    changed++;
  }
  return changed > 0 ? did(changed) : NOTHING;
}

export function changeTarget(cx: ExecCtx, st: ChangeTarget): StepResult {
  const g = cx.g;
  const [who] = resolvePlayers(cx, st.who);
  if (who === undefined) return NOTHING;
  if (st.to !== undefined) return changeTargetTo(cx, st, who);
  let changed = 0;
  for (const h of resolveObjs(cx, st.what)) {
    const o = g.s.objects[h.id];
    if (!o || o.zone !== 'stack' || !o.stack) continue; // it left the stack: nothing to change (CR 608.2b)
    const current = o.stack.targets;
    const filled = current.map((l, i) => [i, l] as const).filter(([, l]) => l.length > 0);
    if (filled.length !== 1 || filled[0]![1].length !== 1) continue; // CR 115.7: only a spell or ability with a single target
    const [index, [old]] = filled[0]! as readonly [number, readonly TargetChoice[]];
    const specs = targetSpecsOf(cx, o);
    const spec = specs?.[index];
    if (!spec || specs!.length !== current.length) continue;
    const sourceId: ObjectId | undefined = o.kind === 'ability' ? o.stack.sourceId : o.id;
    const legal = targetOptions(g.s, spec, o.controller, sourceId, o.id);
    // CR 115.7a: only to ANOTHER legal target; the resolving spell or ability is no target of it any more (it leaves the stack as it finishes, CR 608.2n)
    const objects = legal.objects.filter((id) => !(old!.kind === 'object' && old!.id === id) && id !== cx.stackId);
    const players = legal.players.filter((id) => !(old!.kind === 'player' && old!.id === id));
    if (objects.length + players.length === 0) {
      g.log(`The target of ${g.nameOf(o.id)} can't be changed to another legal target: it is unchanged.`, { rules: ['CR 115.7a'], level: 'info' });
      continue;
    }
    const [picked] = g.choose({
      kind: 'chooseTargets', player: who, prompt: `Choose the new target of ${g.nameOf(o.id)} (${spec.text}).`, targetText: spec.text,
      objects, players, min: 1, max: 1, rules: ['CR 115.7', 'CR 115.7a'],
    }).targets;
    if (picked === undefined) continue;
    o.stack.targets = current.map((l, i) => (i === index ? [{ ...picked }] : l));
    g.log(`${g.player(who).name} changes the target of ${g.nameOf(o.id)} to ${picked.kind === 'player' ? g.player(picked.id).name : g.nameOf(picked.id)}.`, { rules: ['CR 115.7'], level: 'action' });
    g.emit({ type: 'becameTarget', objectId: picked.id, byStackId: o.id, byController: o.controller }); // CR 603.2: it becomes a target of that spell or ability
    changed++;
  }
  return changed > 0 ? did(changed) : NOTHING;
}
