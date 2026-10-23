/**
 * E3XP (FAST5X E31's `changeTargets` with `how: 'new'`, ported onto main): the `chooseNewTargets` op, "you may choose new targets for it / that spell / the
 * spell" (CR 115.7d) on a spell or ability already on the stack (Aethersnatch, Commandeer, Perplexing Chimera, Speedball, Redirect, Wild Ricochet,
 * Insidious Will, Deflecting Swat). Beside r4-fxb's `changeTarget` ("change the target of ...", CR 115.7a), which keeps its own handler.
 *
 * `who` is asked whether to choose new targets; then, one `chooseTargets` decision per target word that has targets, it may keep any of them, even illegal ones,
 * and a changed one must be legal for the stack object's controller and source, judged with the targets chosen so far for the other words (a target word that
 * reads another one, "target player who controls it", CR 115.7d), never the object itself (CR 115.5; the spell or ability that is resolving is no exception:
 * it is still on the stack, CR 608.2n). Specs related by "another target" (`distinctFrom`, either way round) never end on the same target, a kept one
 * included, and only the final set is judged (CR 115.3, 115.7d-e: two targets can be swapped, the Arc Trail example); a changed set keeps every restriction
 * its text puts on it, the ones the announcement checks (CR 115.1, actions/announce-targets.ts); and no unchanged target may become illegal by the change
 * (CR 115.7d). When the final set breaks one of these, the targets stay (changing none is always legal, CR 115.7d). The division of an effect stays as
 * announced (CR 115.7f): a kept target keeps its place in the list `StackInfo.division` is parallel to, and a new target takes the place, and so the share,
 * of a target it replaces (its chooser says which, when several are replaced). A new target "becomes the target" of it (CR 603.2; ward, CR 702.21a).
 *
 * Resolved by hand: a stack object whose target words can't be matched with its chosen targets, and a target word whose filter reads X (CR 107.3).
 */
import type { EffectStep, TargetSpec } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameObject, TargetChoice } from '../../types/state';
import { filterMentionsX } from '../../rules/filter-env';
import { differentControllersHold, sameControllerHolds, differentNamesHold, groupLimitHolds, isLegalTarget, perCardTypeHolds, perOpponentHolds, sameOwnerHolds, sharedCardTypeHolds, sharedCreatureTypeHolds, targetOptions, targetsById } from '../../rules/targets';
import type { ExecCtx, OpHandlers, StepHandler } from '../api';
import { targetSpecsOf } from './tokens-copy';
import { actOn, byHand, did, firstPlayer, NOTHING } from './zones-util';

type ChooseNewTargets = Extract<EffectStep, { op: 'chooseNewTargets' }>;

/** What the targets of a stack object are judged against (CR 608.2b): an ability's source, a spell itself. */
const sourceOf = (cx: ExecCtx, o: GameObject): ObjectId | undefined => (cx.g.s.objects[o.id] ? o.stack?.sourceId ?? o.id : o.stack?.sourceId);

const key = (t: TargetChoice): string => `${t.kind}:${t.id}`;

/** CR 115.1 (as announce-targets.ts checks them at announcement): the restrictions the text of one target word puts on its whole set. */
function setRestrictionsHold(cx: ExecCtx, spec: TargetSpec, set: readonly TargetChoice[], x: number): boolean {
  const s = cx.g.s;
  return sameOwnerHolds(s, spec, set) && differentNamesHold(s, spec, set) && perOpponentHolds(s, spec, set) && sharedCardTypeHolds(s, spec, set)
    && sharedCreatureTypeHolds(s, spec, set) && differentControllersHold(s, spec, set) && sameControllerHolds(s, spec, set) && groupLimitHolds(s, spec, set, x) && perCardTypeHolds(s, spec, set, x);
}

/**
 * CR 115.7d-e: the new targets of `o`, or `current` when `who` keeps them (or the final set breaks a restriction). The specs are chosen in order; each is offered
 * what is legal with the final targets of the specs before it (and the current ones after it), minus the final targets of the specs related by "another target".
 */
function newTargets(cx: ExecCtx, o: GameObject, specs: readonly TargetSpec[], current: TargetChoice[][], who: PlayerId): TargetChoice[][] {
  const g = cx.g;
  const name = g.nameOf(o.id);
  const yes = g.choose({ kind: 'yesNo', player: who, prompt: `Choose new targets for ${name}?`, yesLabel: 'Choose new targets', noLabel: 'Keep the targets', rules: ['CR 115.7d'] }).yes;
  if (!yes) return current;
  const sourceId = sourceOf(cx, o);
  const x = o.stack?.x ?? 0;
  const out: TargetChoice[][] = current.map((list) => list.map((t) => ({ ...t })));
  // "another target" relates two specs whichever of them names the other (`distinctFrom` is on the later one only)
  const related = (i: number): number[] =>
    specs.flatMap((sp, j) => (j < i && ((specs[i]!.distinctFrom ?? []).includes(sp.id) || (sp.distinctFrom ?? []).includes(specs[i]!.id)) ? [j] : []));
  const keep = (why: string): TargetChoice[][] => {
    g.log(`The targets of ${name} stay as they were: ${why}.`, { rules: ['CR 115.7d', 'CR 115.7e'], level: 'info' });
    return current;
  };
  const nameOfTarget = (t: TargetChoice): string => (t.kind === 'player' ? g.player(t.id).name : g.nameOf(t.id));
  for (let i = 0; i < current.length; i++) {
    const list = current[i]!;
    if (list.length === 0) continue;
    const spec = specs[i]!;
    const taken = new Set(related(i).flatMap((j) => out[j]!.map(key)));
    const legal = targetOptions(g.s, spec, o.controller, sourceId, o.id, { chosen: targetsById(specs, out) });
    const objects = [...new Set([...list.filter((t) => t.kind === 'object').map((t) => t.id), ...legal.objects])].filter((id) => !taken.has(`object:${id}`));
    const players = [...new Set([...list.filter((t) => t.kind === 'player').map((t) => t.id), ...legal.players])].filter((id) => !taken.has(`player:${id}`));
    // CR 115.7d: no final set keeps "another target" (the earlier choices took every candidate this one has): changing nothing is the legal choice left
    if (objects.length + players.length < list.length) return keep(`no set of targets for "${spec.text}" would differ from the other targets (CR 115.3)`);
    const picked = g.choose({
      kind: 'chooseTargets', player: who, prompt: `Choose the targets of ${name} (${spec.text}).`, targetText: spec.text,
      objects, players, min: list.length, max: list.length, rules: ['CR 115.7d'],
    }).targets;
    const pickedKeys = new Set(picked.map(key));
    const listKeys = new Set(list.map(key));
    const added = picked.filter((t) => !listKeys.has(key(t)));
    if (added.length === 0) continue; // the same targets, in whatever order they were picked: nothing changes (CR 115.7f: the division stays)
    // CR 115.1, 115.7d: a changed set of one spec still keeps the restrictions the text puts on it
    if (!setRestrictionsHold(cx, spec, picked, x)) return keep(`the new targets for "${spec.text}" break a restriction on them (CR 115.1)`);
    // CR 115.7f: a kept target keeps its place; each new target takes the place (and the share of a divided effect) of a target it replaces
    const placed: TargetChoice[] = [];
    let rest = added;
    for (const t of list) {
      if (pickedKeys.has(key(t))) {
        placed.push({ ...t });
        continue;
      }
      let next = rest[0]!;
      if (spec.divide && rest.length > 1) {
        const [c] = g.choose({
          kind: 'chooseTargets', player: who, prompt: `Which new target of ${name} takes the place of ${nameOfTarget(t)} (its share of the division stays)?`, targetText: spec.text,
          objects: rest.filter((r) => r.kind === 'object').map((r) => r.id), players: rest.filter((r) => r.kind === 'player').map((r) => r.id), min: 1, max: 1, rules: ['CR 115.7f'],
        }).targets;
        if (c !== undefined && rest.some((r) => key(r) === key(c))) next = c;
      }
      placed.push({ ...next });
      rest = rest.filter((r) => key(r) !== key(next));
    }
    out[i] = placed;
  }
  // CR 115.7d: the change must not make an unchanged target illegal (a target word that reads another one, "target player who controls it")
  if (sourceId !== undefined) {
    const before = targetsById(specs, current);
    const after = targetsById(specs, out);
    for (let i = 0; i < out.length; i++) {
      for (const t of out[i]!) {
        if (!current[i]!.some((c) => key(c) === key(t))) continue;
        const was = isLegalTarget(g.s, specs[i]!, t, o.controller, sourceId, o.id, { chosen: before });
        if (was && !isLegalTarget(g.s, specs[i]!, t, o.controller, sourceId, o.id, { chosen: after })) {
          return keep(`the change would make the target ${nameOfTarget(t)} it keeps for "${specs[i]!.text}" illegal (CR 115.7d)`);
        }
      }
    }
  }
  return out;
}

const describe = (cx: ExecCtx, ts: readonly TargetChoice[]): string => ts.map((t) => (t.kind === 'player' ? cx.g.player(t.id).name : cx.g.nameOf(t.id))).join(', ');

export const chooseNewTargets: StepHandler<ChooseNewTargets> = (cx, st) => {
  const g = cx.g;
  const who = firstPlayer(cx, st.who);
  if (who === undefined) return NOTHING;
  let changed = 0;
  for (const h of actOn(cx, st.what)) {
    const o = g.s.objects[h.id];
    if (!o || h.zone !== 'stack' || !o.stack) continue; // only a spell or ability on the stack has targets to choose (CR 115.7)
    const current = o.stack.targets;
    const name = g.nameOf(o.id);
    if (current.every((l) => l.length === 0)) {
      g.log(`${name} has no targets to change.`, { rules: ['CR 115.7d'], level: 'info' });
      continue;
    }
    const specs = targetSpecsOf(cx, o);
    if (!specs || specs.length !== current.length) return byHand(cx, st, `the targets of ${name} can't be matched with its target words (CR 115.7)`);
    if (specs.some((sp, i) => current[i]!.length > 0 && filterMentionsX(sp.filter))) return byHand(cx, st, `a target of ${name} is described with X (CR 107.3, 115.7)`);
    const next = newTargets(cx, o, specs, current, who);
    if (JSON.stringify(next) === JSON.stringify(current)) continue;
    const before = new Set(current.flat().map(key));
    o.stack.targets = next;
    changed++;
    g.log(`${g.player(who).name} chooses new targets for ${name}: ${describe(cx, next.flat())}.`, { rules: ['CR 115.7d'], level: 'action' });
    const seen = new Set<string>();
    for (const t of next.flat()) {
      if (before.has(key(t)) || seen.has(key(t))) continue;
      seen.add(key(t));
      g.emit({ type: 'becameTarget', objectId: t.id, byStackId: o.id, byController: o.controller }); // CR 603.2: it becomes a target of that spell or ability
    }
  }
  return did(changed);
};

export const NEW_TARGETS_HANDLERS: OpHandlers = { chooseNewTargets };
