/**
 * Announcing targets (CR 601.2c-d, 602.2b, 603.3d). Owner: WP7.
 *
 * Target ids are unique across the whole ability, modes included (design 3.6), so the chosen targets of an effective program list are parallel to
 * `programs.flatMap(p => p.targets)` and `targetsById` (rules/targets.ts) names them. For each spec, in order:
 *   - a spec whose `onlyIf` is false at this point (kicked, a mode chosen) is skipped and gets an empty list (CR 601.2c, 700.2c); a condition that can't be read is
 *     an `IllegalAction`, never "not required" (programsDenial keeps such a spell from being offered);
 *   - `min`/`max` are `Count`s read with the announced X (CR 107.3a);
 *   - `distinctFrom` removes what the listed specs already target ("another target", CR 115.3); the same object may serve two specs that both say "target";
 *   - only a target that leaves the LATER specs satisfiable is offered (a later spec that must differ from it, or names its controller, still needs a legal choice, CR 601.2c);
 *   - `groupLimit` ("total power 5 or less") is checked on the chosen set (CR 115.1);
 *   - `chooser`: another player makes the choice (the decision is theirs and not cancellable);
 *   - `divide`: the caster announces the division, each target at least 1 (CR 601.2d), stored in `StackInfo.division[spec.id]`.
 *
 * DEVIATION from design 3.6 / 8.2.3 ("the player picks how many when the range is variable, before the targets"): the number of targets is the size of the set
 * chosen in ONE `chooseTargets` decision with `min..max`. CR 601.2c has no separate announcement of a count, a second question would only make "up to N" spells
 * slower to cast, and the decision already carries the range. Revisit if the client wants a count first.
 */
import type { Count, EffectProgram, PlayerPred, PlayerRef, Quantity, TargetSpec } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { TargetChoice } from '../types/state';
import { IllegalAction, IllegalAnswer, type Game } from '../core/game';
import { evalCount } from '../effects/eval';
import { randomIndex } from '../core/manual';
import { announcedPlayers, candidatesFor, differentControllersHold, sameControllerHolds, differentNamesHold, groupLimitHolds, perCardTypeHolds, perOpponentHolds, sameOwnerHolds, sharedCardTypeHolds, sharedCreatureTypeHolds, specsFeasibility, specsFeasible, targetRange, targetsById, type TargetOptions } from '../rules/targets';
import { announceCond, announceQty, type AnnounceEnv } from './announce-cond';

export interface AnnouncedTargets {
  /** One list per spec of the effective programs, in order (empty for a spec that was skipped or has no target). */
  targets: TargetChoice[][];
  /** The announced division per spec id (CR 601.2d). */
  division: Record<string, number[]>;
}

/** Conditions of target specs are read before X is announced with X = 0 (CR 107.3b: the announcement that always exists); the announcement re-reads them with the real X. */
const withX = (aenv: AnnounceEnv): AnnounceEnv => (aenv.x === undefined ? { ...aenv, x: 0 } : aenv);

/** Whether a spec is required now (its `onlyIf` holds). A condition that can't be answered is NOT "required"; callers ask `specUnreadable` first and refuse. */
export function specRequired(aenv: AnnounceEnv, spec: TargetSpec): boolean {
  if (!spec.onlyIf) return true;
  return announceCond(withX(aenv), spec.onlyIf) === true;
}

/** The condition of the spec can't be answered here: the spell or ability is refused rather than read as "not required" (fail closed). */
export function specUnreadable(aenv: AnnounceEnv, spec: TargetSpec): boolean {
  return spec.onlyIf !== undefined && announceCond(withX(aenv), spec.onlyIf) === undefined;
}

/** The player who chooses the targets or modes of a spec: the controller unless `chooser` names another player (CR 601.7... 700.2e). */
export function chooserOf(g: Game, controller: PlayerId, ref: PlayerRef | undefined, sourceId: ObjectId, chosen: ReadonlyMap<string, readonly TargetChoice[]>): PlayerId {
  if (!ref) return controller;
  const ps = announcedPlayers(g.s, ref, controller, sourceId, { chosen });
  if (!ps || ps.length === 0) throw new IllegalAction('The player who must choose is not available.', ['CR 601.2c']);
  if (ps.length === 1 || g.s.options.multiplayer === undefined) return ps[0]!; // a two-player game as before (D16)
  // M12-2 (m12 design D13): CR 601.7a, "If there is more than one opponent who could make such a choice, the spell's controller decides which of those
  // opponents will make the choice." Asked only with two or more (a multiplayer game); before, the first in turn order was taken silently.
  const pick = g.choose({
    kind: 'chooseOption', player: controller, min: 1, max: 1, cancellable: true, rules: ['CR 601.7a'],
    prompt: 'Choose which of your opponents makes this choice.',
    options: ps.map((id) => ({ id, label: g.player(id).name })),
  });
  return ps.find((p) => p === pick.ids[0]) ?? ps[0]!;
}

const labelOf = (g: Game, t: TargetChoice): string => (t.kind === 'player' ? g.player(t.id).name : g.nameOf(t.id));

/**
 * FAST5 T69 (CR 601.2c, 107.1b, 107.3c): a spec whose number of targets is a calculated quantity ("up to X target creatures you control get +X/+X ..., where X is
 * the number of colors among permanents you control") has that number read now, as the targets are announced, from the visible board
 * (actions/announce-cond.ts#announceQty); a negative result is 0. The spec is returned unchanged when its counts are numbers, "any" or the announced X.
 * A quantity the announcement can't read never gets here (model/forms.ts#targetSpecForms keeps the ability from being offered).
 */
export function withFixedCounts(aenv: AnnounceEnv, spec: TargetSpec): TargetSpec {
  const computed = (c: Count): c is Quantity => typeof c === 'object' && c.q !== 'X';
  // std-tdm (CR 601.2d, 603.3d): a calculated amount to divide among the targets is fixed as the division is announced, with the targets
  const total = spec.divide !== undefined && computed(spec.divide.total) ? spec.divide.total : null;
  if (!computed(spec.min) && !computed(spec.max) && total === null) return spec;
  const fix = (c: Count): Count => {
    if (!computed(c)) return c;
    const n = announceQty(aenv, c);
    if (n === undefined) throw new IllegalAction(`This engine build can't read the number of targets of "${spec.text}" as it is announced.`, ['CR 601.2c', 'CR 107.3c']);
    return Math.max(0, n);
  };
  const fixedTotal = (q: Quantity): number => {
    const n = announceQty(aenv, q);
    if (n === undefined) throw new IllegalAction(`This engine build can't read the amount divided among the targets of "${spec.text}" as it is announced.`, ['CR 601.2d', 'CR 107.3']);
    return Math.max(0, n); // CR 107.1b: a calculated amount below 0 is 0
  };
  return { ...spec, min: fix(spec.min), max: fix(spec.max), ...(total !== null ? { divide: { ...spec.divide!, total: fixedTotal(total) } } : {}) };
}

/** `withFixedCounts` for the specs of a program and of its modes. */
export function programWithFixedCounts(aenv: AnnounceEnv, p: EffectProgram): EffectProgram {
  const targets = p.targets.map((sp) => withFixedCounts(aenv, sp));
  const modes = p.modes === undefined ? undefined : { ...p.modes, options: p.modes.options.map((o) => ({ ...o, program: programWithFixedCounts(aenv, o.program) })) };
  return { ...p, targets, ...(modes === undefined ? {} : { modes }) };
}

/** Does `ref` (the player of a spec, its chooser) name the targets of the spec `id`? */
function refersTo(ref: PlayerPred | undefined, id: string): boolean {
  if (ref === undefined || typeof ref === 'string') return false;
  if (ref.ref === 'target') return ref.id === id;
  return (ref.ref === 'controllerOf' || ref.ref === 'ownerOf') && ref.object.ref === 'target' && ref.object.id === id;
}

/** Does `later` depend on what `spec` chooses ("another target", "target player who controls it")? Only those specs can make an earlier choice a dead end. */
const dependsOn = (later: TargetSpec, id: string): boolean => (later.distinctFrom?.includes(id) ?? false) || refersTo(later.players?.who, id) || refersTo(later.chooser, id);

/**
 * CR 601.2c: choose targets for every spec of the effective programs. See the file comment. `aenv.x` is the announced X (0 when there is none).
 * Returns the targets and the announced division.
 */
export function announceTargets(g: Game, player: PlayerId, programs: EffectProgram[], sourceId: ObjectId, stackId: ObjectId, what: string, aenv: AnnounceEnv): AnnouncedTargets {
  const specs = programs.flatMap((p) => p.targets).map((sp) => withFixedCounts(aenv, sp));
  const x = aenv.x ?? 0;
  const xs = aenv.x; // the filters read the announced X (rules/targets.ts#AnnouncedX); a caller without one reads X as the resolution will
  const chosen = new Map<string, TargetChoice[]>();
  const out: AnnouncedTargets = { targets: [], division: {} };
  const required = (r: TargetSpec): boolean => specRequired(aenv, r);
  // AF1 review (CR 601.2c, 603.3d, 115.3): when a later spec depends on an earlier one ("another target"), each candidate can be legal alone while no legal
  // SET of targets exists (two target creatures, then another target creature, with two creatures). That is "no legal choice", found before anyone is asked:
  // a spell is not offered then (actions/announce.ts#programsDenial), and a triggered ability is removed (triggers/stack.ts), never asked a question every
  // answer to which is rejected.
  if (specs.some((sp, i) => specs.slice(i + 1).some((r) => dependsOn(r, sp.id))) && specsFeasibility(g.s, specs, required, player, sourceId, stackId, xs) === 'no') {
    throw new IllegalAction(`There is no legal set of targets for ${what} (each "another target" must differ), so it can't be put on the stack.`, ['CR 601.2c', 'CR 115.3']);
  }
  /**
   * An answer broke a rule of the whole set (`groupLimit`, or no legal completion): it is rejected and asked again (`IllegalAnswer`, CR 601.2c, 733) only when
   * a legal answer to this same decision provably exists; otherwise there is no legal choice (an `IllegalAction`: a triggered ability is removed, CR 603.3d),
   * so a non-cancellable decision can never re-ask forever (the leaf cap of the search, a limit it can't settle).
   */
  const reject = (spec: TargetSpec, rest: readonly TargetSpec[], before: ReadonlyMap<string, readonly TargetChoice[]>, message: string, rules: string[]): never => {
    const f = specsFeasibility(g.s, [spec, ...rest], required, player, sourceId, stackId, xs, before);
    if (f === 'yes') throw new IllegalAnswer(message, rules);
    throw new IllegalAction(`${message} No legal set of targets for ${what} ${f === 'no' ? 'exists' : 'could be found (the search gave up)'}.`, rules);
  };
  for (const [i, spec] of specs.entries()) {
    if (specUnreadable(aenv, spec)) throw new IllegalAction(`This engine build can't read the condition under which "${spec.text}" is a target of ${what}.`, ['CR 601.2c', 'CR 700.2c']);
    if (!specRequired(aenv, spec)) { out.targets.push([]); chosen.set(spec.id, []); continue; }
    const rest = specs.slice(i + 1);
    let opts = candidatesFor(g.s, spec, player, sourceId, stackId, chosen, xs);
    if (rest.some((r) => dependsOn(r, spec.id))) opts = offerable(g, opts, spec, rest, aenv, player, sourceId, stackId, chosen, xs);
    let range = targetRange(g.s, spec, opts, x);
    if (!range) throw new IllegalAction(`There is no legal target for "${spec.text}", so ${what} can't be put on the stack.`, ['CR 601.2c', 'CR 115.1']);
    if (range.max === 0) { out.targets.push([]); chosen.set(spec.id, []); continue; }
    const chooser = chooserOf(g, player, spec.chooser, sourceId, chosen);
    if (spec.sameOwner === true) {
      // FAST3 T14 ("from a single graveyard", CR 115.1, 601.2c): whose cards are chosen first, among the owners with enough candidates, so every answer to the
      // targets decision keeps the restriction (no answer has to be rejected)
      const owned = sameOwnerOptions(g, opts, range.min);
      if (owned.length === 0) throw new IllegalAction(`There is no legal set of targets for "${spec.text}", so ${what} can't be put on the stack.`, ['CR 601.2c', 'CR 115.1']);
      let owner = owned[0]!.owner;
      if (owned.length > 1) {
        const pick = g.choose({
          kind: 'chooseOption', player: chooser, prompt: `Choose whose cards to target: ${spec.text} (for ${what}).`,
          options: owned.map((o) => ({ id: o.owner, label: `${g.player(o.owner).name}'s cards` })), min: 1, max: 1, cancellable: chooser === player,
          rules: ['CR 601.2c', 'CR 115.1'],
        });
        const id = pick.ids[0];
        owner = owned.find((o) => o.owner === id)?.owner ?? owner;
      }
      opts = { objects: opts.objects.filter((id) => g.s.objects[id]?.owner === owner), players: [] };
      range = targetRange(g.s, spec, opts, x)!;
    }
    const specMax = evalCount(spec.max, { x });
    // p2-damage-2 (CR 601.2c, 603.3d): "chosen at random": nobody chooses; the game's random generator picks as many as the spec takes among the legal candidates
    // (design 8.8 rule 2), and the rules of the set below still hold
    const ans = spec.random === true ? { targets: randomTargets(g, opts, range.max) } : g.choose({
      kind: 'chooseTargets',
      player: chooser,
      prompt: `Choose ${range.min === specMax ? range.min : `${range.min} to ${Number.isFinite(specMax) ? specMax : 'any number of'}`} target(s): ${spec.text} (for ${what}).`,
      targetText: spec.text,
      objects: opts.objects,
      players: opts.players,
      min: range.min,
      max: range.max,
      cancellable: chooser === player,
      rules: ['CR 601.2c', 'CR 115.1', ...(chooser === player ? [] : ['CR 601.7'])],
    });
    const picked = ans.targets;
    const before = new Map(chosen);
    if (!sameOwnerHolds(g.s, spec, picked)) {
      reject(spec, rest, before, `The targets of "${spec.text}" must all be cards of one player.`, ['CR 115.1', 'CR 601.2c']);
    }
    if (!differentNamesHold(g.s, spec, picked)) {
      reject(spec, rest, before, `The targets of "${spec.text}" must all have different names.`, ['CR 201.2', 'CR 115.1', 'CR 601.2c']);
    }
    // FAST5 T66 (CR 115.1, 601.2c): "for each opponent, ... up to one target ... that player controls" and "two target nonland permanents that share a card type"
    if (!perOpponentHolds(g.s, spec, picked)) {
      reject(spec, rest, before, spec.perPlayer === true ? `The targets of "${spec.text}" must be controlled by different players (one for each player).` : `The targets of "${spec.text}" must be controlled by different opponents (one for each opponent).`, ['CR 115.1', 'CR 601.2c']);
    }
    if (!sharedCardTypeHolds(g.s, spec, picked)) {
      reject(spec, rest, before, `The targets of "${spec.text}" must share a card type.`, ['CR 205.2a', 'CR 115.1', 'CR 601.2c']);
    }
    if (!sharedCreatureTypeHolds(g.s, spec, picked)) { // CLOUD std-ecl: "two target creature cards that share a creature type"
      reject(spec, rest, before, `The targets of "${spec.text}" must share a creature type.`, ['CR 205.3m', 'CR 702.73a', 'CR 115.1', 'CR 601.2c']);
    }
    // CLOUD std-tmt (CR 115.1, 601.2c): "two target creatures controlled by different players"
    if (!differentControllersHold(g.s, spec, picked)) {
      reject(spec, rest, before, `The targets of "${spec.text}" must be controlled by different players.`, ['CR 115.1', 'CR 601.2c']);
    }
    // std-cardcopy-7 (CR 115.1, 601.2c, 205.2a): "up to one target nonland card of each card type"
    if (!perCardTypeHolds(g.s, spec, picked, aenv.x ?? 0)) {
      reject(spec, rest, before, `The targets of "${spec.text}" must be one of each card type.`, ['CR 115.1', 'CR 601.2c', 'CR 205.2a']);
    }
    // std-rx30 (CR 115.1, 601.2c): "two target creatures controlled by the same opponent"
    if (!sameControllerHolds(g.s, spec, picked)) {
      reject(spec, rest, before, `The targets of "${spec.text}" must be controlled by the same player.`, ['CR 115.1', 'CR 601.2c']);
    }
    if (!groupLimitHolds(g.s, spec, picked, x)) {
      reject(spec, rest, before, `Those targets break the limit of "${spec.text}" (${spec.groupLimit!.stat} ${spec.groupLimit!.cmp.op} ${evalCount(spec.groupLimit!.cmp.value, { x })} in total).`, ['CR 115.1', 'CR 601.2c']);
    }
    chosen.set(spec.id, picked);
    out.targets.push(picked);
    // A later spec that has to differ from this one (CR 115.3) must still be able to find its targets (a set of several targets is checked here; single candidates were filtered above).
    if (rest.some((r) => dependsOn(r, spec.id)) && !specsFeasible(g.s, rest, required, player, sourceId, stackId, xs, chosen)) {
      reject(spec, rest, before, `With those targets there is no legal way to choose the rest of the targets of ${what} (each "another target" must differ).`, ['CR 115.3', 'CR 601.2c']);
    }
    if (spec.divide && picked.length > 0) out.division[spec.id] = announceDivision(g, player, spec, picked, what, x);
  }
  return out;
}

/** FAST3 T14: the owners of a `sameOwner` spec's candidate objects that own at least `min` of them, in the order the candidates come. */
function sameOwnerOptions(g: Game, opts: TargetOptions, min: number): { owner: PlayerId; count: number }[] {
  const out: { owner: PlayerId; count: number }[] = [];
  for (const id of opts.objects) {
    const owner = g.s.objects[id]?.owner;
    if (owner === undefined) continue;
    const e = out.find((o) => o.owner === owner);
    if (e) e.count++;
    else out.push({ owner, count: 1 });
  }
  return out.filter((o) => o.count >= Math.max(1, min));
}

/** The candidates of `spec` that leave the later specs satisfiable when chosen alone (CR 601.2c): a target that can never be completed is not offered. */
function offerable(
  g: Game, opts: TargetOptions, spec: TargetSpec, rest: readonly TargetSpec[], aenv: AnnounceEnv, player: PlayerId, sourceId: ObjectId, stackId: ObjectId,
  chosen: ReadonlyMap<string, readonly TargetChoice[]>, x: number | undefined,
): TargetOptions {
  const completes = (t: TargetChoice): boolean => specsFeasible(g.s, rest, (r) => specRequired(aenv, r), player, sourceId, stackId, x, new Map([...chosen, [spec.id, [t]]]));
  return {
    objects: opts.objects.filter((id) => completes({ kind: 'object', id })),
    players: opts.players.filter((id) => completes({ kind: 'player', id })),
  };
}

/**
 * The same, for callers that announce with just the value of X (triggered abilities, CR 603.3d: "the same functions" as a spell): returns one list of chosen targets
 * per spec. It can't carry a division (CR 601.2d), so a spec with `divide` is refused loudly here; use `announceTargets`, which returns it.
 * With an `AnnounceEnv` it is `announceTargets`.
 */
export function chooseTargets(g: Game, player: PlayerId, programs: EffectProgram[], sourceId: ObjectId, stackId: ObjectId, what: string, x: number): TargetChoice[][];
export function chooseTargets(g: Game, player: PlayerId, programs: EffectProgram[], sourceId: ObjectId, stackId: ObjectId, what: string, aenv: AnnounceEnv): AnnouncedTargets;
export function chooseTargets(g: Game, player: PlayerId, programs: EffectProgram[], sourceId: ObjectId, stackId: ObjectId, what: string, xOrEnv: number | AnnounceEnv): TargetChoice[][] | AnnouncedTargets {
  if (typeof xOrEnv !== 'number') return announceTargets(g, player, programs, sourceId, stackId, what, xOrEnv);
  if (programs.some((p) => p.targets.some((sp) => sp.divide))) {
    throw new Error('chooseTargets(..., x) returns only the targets and would lose the division of CR 601.2d; call announceTargets, which returns the division too');
  }
  return announceTargets(g, player, programs, sourceId, stackId, what, { s: g.s, player, sourceId, costsPaid: {}, x: xOrEnv }).targets;
}

/** CR 601.2d: announce how damage or counters are divided among the targets of `spec`; each target gets at least one. */
function announceDivision(g: Game, player: PlayerId, spec: TargetSpec, picked: readonly TargetChoice[], what: string, x: number): number[] {
  const total = evalCount(spec.divide!.total, { x });
  if (picked.length === 1) return [total];
  const ans = g.choose({
    kind: 'chooseDivision',
    player,
    prompt: `Divide ${total} ${spec.divide!.what} among ${picked.map((t) => labelOf(g, t)).join(', ')} for ${what}; each gets at least 1.`,
    what: spec.divide!.what,
    total,
    targets: picked.map((t) => ({ id: t.id, label: labelOf(g, t) })),
    cancellable: true,
    rules: ['CR 601.2d'],
  });
  return ans.amounts;
}

/** The text of chosen targets for the log. */
export function describeTargets(g: Game, targets: TargetChoice[][]): string {
  const names = targets.flat().map((t) => labelOf(g, t));
  return names.length ? ` targeting ${names.join(', ')}` : '';
}

/**
 * CR 603.2, 601.2i: an object or player becomes the target of a spell or ability once it is put on the stack with it. Emitted once per distinct target (an
 * object chosen by two instances of the word "target" becomes a target once for the triggers that look for it).
 */
export function emitBecameTarget(g: Game, stackId: ObjectId, controller: PlayerId, targets: readonly (readonly TargetChoice[])[]): void {
  const seen = new Set<string>();
  for (const t of targets.flat()) {
    if (seen.has(`${t.kind}:${t.id}`)) continue;
    seen.add(`${t.kind}:${t.id}`);
    g.emit({ type: 'becameTarget', objectId: t.id, byStackId: stackId, byController: controller });
  }
}

export { targetsById };

/** p2-damage-2 (CR 601.2c, 603.3d): `n` different candidates of a spec "chosen at random", picked with the game's random generator (design 8.8 rule 2). */
function randomTargets(g: Game, opts: TargetOptions, n: number): TargetChoice[] {
  const left: TargetChoice[] = [...opts.objects.map((id) => ({ kind: 'object' as const, id })), ...opts.players.map((id) => ({ kind: 'player' as const, id }))];
  const out: TargetChoice[] = [];
  for (let i = 0; i < n && left.length > 0; i++) out.push(left.splice(randomIndex(g, left.length), 1)[0]!);
  if (out.length > 0) g.log(`Chosen at random: ${out.map((t) => (t.kind === 'object' ? g.nameOf(t.id) : g.player(t.id).name)).join(', ')}.`, { rules: ['CR 601.2c'], level: 'action' });
  return out;
}
