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

export function changeTarget(cx: ExecCtx, st: ChangeTarget): StepResult {
  const g = cx.g;
  const [who] = resolvePlayers(cx, st.who);
  if (who === undefined) return NOTHING;
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
