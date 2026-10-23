/**
 * Targets (CR 115): which objects and players a TargetSpec may choose, and whether chosen targets
 * are still legal when the spell or ability resolves (CR 608.2b). Protection, hexproof and shroud
 * (CR 702.16b, 702.11b, 702.18a) and "can't be the target" effects are applied by `isTargetable` through rules/hookpoints.ts.
 *
 * Owner: WP7. What this file adds to milestone 3/4:
 *   - the kinds `anyTarget` (CR 115.4) and `stackObject` (a spell or an ability, CR 115.1, 115.2);
 *   - a `PlayerRef` in `TargetSpec.players.who` ("target player who controls it", CR 115.1), read against the targets already chosen for other specs (`TargetEnv`);
 *   - `distinctFrom` ("another target", CR 115.3) and `groupLimit` ("total power 5 or less", CR 115.1) in the feasibility check `specsFeasible` and `targetRange`;
 *   - `isLegalTarget`, the per-target legality check WP4's `recheckAll` builds on (CR 608.2b), and `targetsById`.
 */
import type { CardType } from '../types/card';
import type { EffectProgram, NumberCmp, PlayerRef, TargetSpec } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState, TargetChoice } from '../types/state';
import { evalCount } from '../effects/eval';
import { charsOfObject, ptNumbers } from './characteristics';
import { creatureTypesOf, findObjects, matchesFilter, type FilterContext } from './filter';
import { filterCtxOutside, filterMentionsX, relaxUnannouncedX } from './filter-env';
import { gameOf, hookpoints } from './hookpoints';
import { seatNeighbor } from '../statics/seats';

export interface TargetOptions {
  objects: ObjectId[];
  players: PlayerId[];
}

/**
 * Targets already chosen for other specs of the same spell or ability, by spec id. Needed to read a `PlayerRef` such as "the controller of target creature".
 * Specs are announced in order (CR 601.2c), so a reference to a spec that is not chosen yet resolves to nothing (no legal player).
 *
 * WP30: the same environment is what the spec's FILTER reads its references and quantities in (rules/filter-env.ts): "target creature that player controls"
 * (`controller: {ref}`), "with power X or less" (`cmp.quantity`), "target spell that targets you" (`targets`), "another target creature that shares a color with
 * it" (`sharesWith`). A triggered ability's stack object gives the event it triggered on. X is whatever `x` says (`AnnouncedX`), decided by the caller from
 * the announcement, never from whether the stack object exists (the object is on the stack before X is announced, CR 601.2a-b).
 */
export interface TargetEnv {
  chosen?: ReadonlyMap<string, readonly TargetChoice[]>;
  /** How X reads in the spec's filter (`AnnouncedX`). Absent: as the resolution reads it. */
  x?: AnnouncedX;
}

/**
 * The state of X while targets are checked or chosen (WP30 review: decided from the announcement, never from whether the stack object exists, because a spell
 * or ability is on the stack before its modes, optional costs and X are chosen, CR 601.2a-b, 602.2a):
 *   - a number: the announced X (CR 107.3a), or for a triggered ability the X the resolution will read (CR 107.3m);
 *   - `'unannounced'`: a spell or activated ability whose X is not announced yet (CR 601.2b: modes and optional costs come first; a legality check, CR 601.3):
 *     a comparison with X is relaxed so the check never refuses what some X would allow;
 *   - `{ upTo }`: the same, with the largest X the player could pay for known (a legality check, CR 601.2c, 601.2h): the program has targets when SOME X from 0
 *     to `upTo` gives every required spec its targets (`programHasTargets`); a single spec's options are the relaxed ones;
 *   - absent (`undefined`): read X exactly as the resolution reads it (`effects/eval.ts`: the stack object's X, else the X its source was cast with, CR 107.3m,
 *     else 0). The CR 608.2b re-check uses this.
 */
export type AnnouncedX = number | 'unannounced' | { upTo: number };

/** The X a count (`Count`: min, max, a division total, a group limit) is read with: before X is announced, X = 0 (the announcement that always exists, CR 107.3b). */
export const countX = (x: AnnouncedX | undefined): number => (typeof x === 'number' ? x : 0);

/**
 * Hexproof, shroud and protection (CR 702.11b, 702.16b, 702.18a: the keyword provider applies them to permanents only, CR 113.6) and "can't be the target of"
 * effects, which can apply to an object in any zone and to a player (design 9.4, `beTargeted`). The source is the spell (its stack object) or the permanent that
 * has the ability; if it has since left the game its last known information is used.
 */
export function isTargetable(s: GameState, target: ObjectId | PlayerId, controller: PlayerId, sourceId: ObjectId | undefined): boolean {
  return hookpoints.canBeTargeted(gameOf(s), target, sourceId ?? null, controller) === null;
}

/** The `TargetSpec` kinds this engine build handles (capabilities `target:<kind>`, design 5.2). */
export const TARGET_KINDS: Readonly<Record<string, true>> = { object: true, player: true, objectOrPlayer: true, anyTarget: true, spell: true, ability: true, stackObject: true };

/** CR 115.4: "any target" is a creature, a planeswalker, a battle or a player. */
const ANY_TARGET_TYPES: readonly CardType[] = ['Creature', 'Planeswalker', 'Battle'];

/**
 * The players a `PlayerRef` stands for while targets are announced, or null when this build can't read it. Only the references that exist at that moment are
 * read (design 3.1): the controller, the opponents, the active player, a chosen player target, the controller / owner of a chosen target or of the source.
 */
export function announcedPlayers(s: GameState, ref: PlayerRef, controller: PlayerId, sourceId: ObjectId | undefined, env: TargetEnv = {}): PlayerId[] | null {
  switch (ref.ref) {
    case 'you': return [controller];
    case 'anOpponent': return s.players.filter((p) => p.id !== controller && !p.hasLost).map((p) => p.id);
    case 'active': return [s.turn.activePlayer];
    case 'target': return (env.chosen?.get(ref.id) ?? []).filter((t) => t.kind === 'player').map((t) => t.id);
    case 'controllerOf':
    case 'ownerOf': {
      const o = ref.object;
      if (o.ref !== 'self' && o.ref !== 'target') return null;
      const ids: ObjectId[] = o.ref === 'self' ? (sourceId ? [sourceId] : []) : (env.chosen?.get(o.id) ?? []).filter((t) => t.kind === 'object').map((t) => t.id);
      const out = new Set<PlayerId>();
      for (const id of ids) {
        const obj = s.objects[id] ?? s.lki[id]?.object;
        if (obj) out.add(ref.ref === 'controllerOf' ? obj.controller : obj.owner);
      }
      return [...out];
    }
    case 'seat': { // M12-1 (m12 design D6): the next / previous player in turn order still in the game (CR 101.4, 103.1), from `of` (you by default)
      const from = ref.of === undefined ? [controller] : announcedPlayers(s, ref.of, controller, sourceId, env);
      return from === null ? null : [...new Set(from.flatMap((p) => { const n = seatNeighbor(s, p, ref.side); return n !== undefined ? [n] : []; }))];
    }
    default:
      return null;
  }
}

/**
 * An ability on the stack has no characteristics, so only `stackKind`, `controller`, `targets` ("ability that targets a permanent you control", CR 115.9b) and
 * `is` can be tested on it; any other set field never matches (a target the engine can't verify is not offered, never offered wrongly). `targets` and `is` are
 * read by rules/filter.ts with the same environment as for a spell (WP30 review), so the announcement and the resolution agree (effects/ctx.ts#targetLegal).
 */
function abilityMatches(s: GameState, o: GameObject, f: TargetSpec['filter'], you: PlayerId, ctx: FilterContext): boolean {
  if (!f) return true;
  // FAST5 T45 (CR 113.3b-c): "target activated or triggered ability" is the filter of either kind; the fields beside `anyOf` hold for both
  if (f.anyOf !== undefined) {
    const { anyOf, ...rest } = f;
    return anyOf.some((opt) => abilityMatches(s, o, { ...rest, ...opt }, you, ctx));
  }
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && k !== 'zone' && k !== 'controller' && k !== 'stackKind' && k !== 'targets' && k !== 'is' && k !== 'abilitySource') return false;
  }
  if (f.abilitySource !== undefined && !matchesFilter(s, o, { abilitySource: f.abilitySource, zone: 'stack' as const }, ctx)) return false; // FAST5 T45: CR 113.7a
  if (typeof f.controller === 'object') {
    const players = ctx.env.refs(f.controller)?.players; // "target activated ability that player controls" (WP30: read in the announcement environment)
    if (!players?.includes(o.controller)) return false;
  }
  if (f.controller === 'you' && o.controller !== you) return false;
  if (f.controller === 'opponent' && o.controller === you) return false;
  if (f.targets !== undefined || f.is !== undefined) {
    const sub = { ...(f.targets !== undefined ? { targets: f.targets } : {}), ...(f.is !== undefined ? { is: f.is } : {}), zone: 'stack' as const };
    if (!matchesFilter(s, o, sub, ctx)) return false; // CR 115.9b: the current targets of the ability
  }
  const kind = o.stack?.kind;
  switch (f.stackKind) {
    case undefined: case 'ability': return true;
    case 'activatedAbility': return kind === 'activated';
    case 'triggeredAbility': return kind === 'triggered';
    default: return false; // 'spell' and 'copy' name spells
  }
}

/** Everything `spec` can legally target for a spell or ability controlled by `controller` (CR 115.1, 115.2). */
export function targetOptions(s: GameState, spec: TargetSpec, controller: PlayerId, sourceId?: ObjectId, stackId?: ObjectId, env: TargetEnv = {}): TargetOptions {
  // A kind this build lacks is a missing capability (the `degrade` pass keeps such abilities manual); reaching here with one is a bug, never a guess.
  if (!Object.hasOwn(TARGET_KINDS, spec.kind)) throw new Error(`not implemented: WP7 (target kind "${spec.kind}")`);
  // WP30: the filter reads its references and quantities in the announcement environment (rules/filter-env.ts), with the same meaning as at resolution. While
  // X is not announced (CR 601.2b: modes and optional costs come first, although the spell or ability is already on the stack, CR 601.2a, 602.2a) a comparison
  // with X is relaxed, so no check refuses what some X would allow; an announced X is read exactly; without one (a triggered ability's announcement, CR 603.3d,
  // and the CR 608.2b re-check) X is what the resolution reads (`AnnouncedX`).
  const xs = env.x;
  const filter = xs === undefined || typeof xs === 'number' ? spec.filter : relaxUnannouncedX(spec.filter);
  const ctx: FilterContext = filterCtxOutside(s, {
    controller, ...(sourceId ? { sourceId } : {}), ...(stackId ? { stackId } : {}), ...(env.chosen ? { chosen: env.chosen } : {}), ...(typeof xs === 'number' ? { x: xs } : {}),
  });
  const out: TargetOptions = { objects: [], players: [] };
  const kind = spec.kind;
  if (kind === 'object' || kind === 'objectOrPlayer') {
    for (const o of findObjects(s, filter ?? {}, ctx)) {
      if (o.kind === 'ability' || o.id === stackId || o.phasedOut) continue; // CR 702.26b: a phased-out permanent is treated as though it doesn't exist
      if (isTargetable(s, o.id, controller, sourceId)) out.objects.push(o.id);
    }
  }
  if (kind === 'anyTarget') {
    // CR 115.4: a creature, planeswalker or battle (on the battlefield) or a player; the filter narrows it further.
    for (const o of findObjects(s, { ...(filter ?? {}), zone: 'battlefield' }, ctx)) {
      if (o.id === stackId || o.phasedOut || !charsOfObject(s, o).types.some((t) => ANY_TARGET_TYPES.includes(t))) continue; // CR 702.26b
      if (isTargetable(s, o.id, controller, sourceId)) out.objects.push(o.id);
    }
  }
  if (kind === 'spell' || kind === 'stackObject') {
    for (const o of findObjects(s, { ...(filter ?? {}), zone: 'stack' }, ctx)) {
      if (o.kind !== 'ability' && o.id !== stackId && isTargetable(s, o.id, controller, sourceId)) out.objects.push(o.id); // CR 115.5: not itself
    }
  }
  if (kind === 'ability' || kind === 'stackObject') {
    for (const id of s.zones.stack) {
      const o = s.objects[id];
      if (o?.kind === 'ability' && id !== stackId && abilityMatches(s, o, filter, controller, ctx)) out.objects.push(id);
    }
  }
  if (kind === 'player' || kind === 'objectOrPlayer' || kind === 'anyTarget') {
    const who = spec.players?.who ?? 'any';
    const refPlayers = typeof who === 'string' ? null : announcedPlayers(s, who, controller, sourceId, env);
    if (typeof who !== 'string' && refPlayers === null) return out; // a reference this build can't read: no legal player (the spec is gated by `feature:target.playerRef`)
    for (const p of s.players) {
      if (p.hasLost) continue;
      if (who === 'you' && p.id !== controller) continue;
      if (who === 'opponent' && p.id === controller) continue;
      if (refPlayers && !refPlayers.includes(p.id)) continue;
      if (!isTargetable(s, p.id, controller, sourceId)) continue; // CR 115.1, 702.11b: a player can't be targeted by a spell the effect forbids (Leyline of Sanctity)
      out.players.push(p.id);
    }
  }
  return out;
}

export const optionCount = (t: TargetOptions): number => t.objects.length + t.players.length;

/** CR 608.2b: is this one chosen target still legal for its spec (right zone, still matches, not protected from the source)? WP4's `recheckAll` calls this per target. */
export function isLegalTarget(s: GameState, spec: TargetSpec, target: TargetChoice, controller: PlayerId, sourceId: ObjectId, stackId: ObjectId, env: TargetEnv = {}): boolean {
  const opts = targetOptions(s, spec, controller, sourceId, stackId, env);
  return target.kind === 'object' ? opts.objects.includes(target.id) : opts.players.includes(target.id);
}

/** The chosen targets by spec id (target ids are unique across the whole ability, modes included, design 3.6). */
export function targetsById(specs: readonly TargetSpec[], choices: readonly (readonly TargetChoice[])[]): Map<string, TargetChoice[]> {
  const out = new Map<string, TargetChoice[]>();
  specs.forEach((spec, i) => out.set(spec.id, [...(choices[i] ?? [])]));
  return out;
}

/** The statistic `groupLimit` sums over the chosen targets (CR 115.1): a creature's power or toughness, or an object's mana value. Players and unknown values count 0. */
export function groupStat(s: GameState, target: TargetChoice, stat: 'power' | 'toughness' | 'manaValue'): number {
  if (target.kind !== 'object') return 0;
  const o = s.objects[target.id];
  if (!o) return 0;
  const c = charsOfObject(s, o);
  return stat === 'manaValue' ? c.manaValue : ptNumbers(c)[stat] ?? 0;
}

function holds(c: NumberCmp, actual: number, limit: number): boolean {
  switch (c.op) {
    case '<=': return actual <= limit;
    case '>=': return actual >= limit;
    case '==': return actual === limit;
    case '!=': return actual !== limit;
    case '<': return actual < limit;
    case '>': return actual > limit;
  }
}

/** Does the total of the spec's statistic over `chosen` satisfy its `groupLimit` (always true without one)? CR 115.1. */
export function groupLimitHolds(s: GameState, spec: TargetSpec, chosen: readonly TargetChoice[], x: number): boolean {
  const g = spec.groupLimit;
  if (!g) return true;
  const total = chosen.reduce((n, t) => n + groupStat(s, t, g.stat), 0);
  return holds(g.cmp, total, evalCount(g.cmp.value, { x }));
}

/** FAST3 T14: do the objects of `chosen` have one owner, as a spec's `sameOwner` requires ("from a single graveyard", CR 115.1; always true without it)? */
export function sameOwnerHolds(s: GameState, spec: TargetSpec, chosen: readonly TargetChoice[]): boolean {
  if (spec.sameOwner !== true) return true;
  const owners = new Set(chosen.flatMap((t) => (t.kind === 'object' ? [s.objects[t.id]?.owner ?? `?${t.id}`] : [])));
  return owners.size <= 1;
}

/**
 * FAST5 T42: do the objects of `chosen` have different names, as a spec's `differentNames` requires ("up to six target creature cards with different names", CR 201.2:
 * two objects have the same name when they have a name in common; a nameless object, such as a face-down one, shares none; always true without it)?
 */
export function differentNamesHold(s: GameState, spec: TargetSpec, chosen: readonly TargetChoice[]): boolean {
  if (spec.differentNames !== true) return true;
  const names = chosen.flatMap((t) => {
    const o = t.kind === 'object' ? s.objects[t.id] : undefined;
    return o === undefined ? [] : [charsOfObject(s, o).names];
  });
  return names.every((a, i) => names.slice(i + 1).every((b) => !a.some((n) => b.includes(n))));
}

/**
 * FAST5 T66: is each object of `chosen` controlled by a different player, as a spec's `perOpponent` requires ("for each opponent, ... up to one target nonland
 * permanent that player controls", CR 115.1, 601.2c: at most one target for each opponent; always true without it)?
 */
export function perOpponentHolds(s: GameState, spec: TargetSpec, chosen: readonly TargetChoice[]): boolean {
  if (spec.perOpponent !== true && spec.perPlayer !== true) return true; // r5-fxb: `perPlayer`, one for each player, the same rule
  const controllers = chosen.flatMap((t) => (t.kind === 'object' ? [s.objects[t.id]?.controller ?? `?${t.id}`] : []));
  return new Set(controllers).size === controllers.length;
}

/**
 * FAST5 T66: do the objects of `chosen` have a card type in common, as a spec's `sharedCardType` requires ("two target nonland permanents that share a card type",
 * CR 115.1, 205.2a; always true without it, and with fewer than two objects)? The card types a permanent has now (CR 109.3): a land creature has both.
 */
export function sharedCardTypeHolds(s: GameState, spec: TargetSpec, chosen: readonly TargetChoice[]): boolean {
  if (spec.sharedCardType !== true) return true;
  const sets = chosen.flatMap((t) => {
    const o = t.kind === 'object' ? s.objects[t.id] : undefined;
    return o === undefined ? [] : [charsOfObject(s, o).types];
  });
  if (sets.length < 2) return true;
  return sets[0]!.some((ty) => sets.every((set) => set.includes(ty)));
}

/**
 * CLOUD std-ecl: do the objects of `chosen` have a creature type in common, as a spec's `sharedCreatureType` requires ("two target creature cards that share a
 * creature type", CR 115.1, 205.3m; always true without it, and with fewer than two objects)? A changeling has every creature type (CR 702.73a, a
 * characteristic-defining ability that works in every zone, CR 604.3), so it shares one with any object that has a creature type.
 */
export function sharedCreatureTypeHolds(s: GameState, spec: TargetSpec, chosen: readonly TargetChoice[]): boolean {
  if (spec.sharedCreatureType !== true) return true;
  const kinds = chosen.flatMap((t) => {
    const o = t.kind === 'object' ? s.objects[t.id] : undefined;
    return o === undefined ? [] : [creatureTypesOf(charsOfObject(s, o))];
  });
  if (kinds.length < 2) return true;
  const fixed = kinds.filter((k) => !k.all);
  if (fixed.length === 0) return true;
  return [...fixed[0]!.set].some((ty) => fixed.every((k) => k.set.has(ty)));
}

/**
 * CLOUD std-tmt: is each object of `chosen` controlled by a different player, as a spec's `differentControllers` requires ("two target creatures controlled by
 * different players", CR 115.1, 601.2c, 110.2; always true without it)? The controllers now: an object that is gone counts as a controller of its own.
 */
export function differentControllersHold(s: GameState, spec: TargetSpec, chosen: readonly TargetChoice[]): boolean {
  if (spec.differentControllers !== true) return true;
  const controllers = chosen.flatMap((t) => (t.kind === 'object' ? [s.objects[t.id]?.controller ?? `?${t.id}`] : []));
  return new Set(controllers).size === controllers.length;
}

/**
 * std-rx30: is every object of `chosen` controlled by the same player, as a spec's `sameController` requires ("two target creatures controlled by the same opponent",
 * CR 115.1, 601.2c, 110.2; always true without it)? The controllers now: an object that is gone has no controller in common with another.
 */
export function sameControllerHolds(s: GameState, spec: TargetSpec, chosen: readonly TargetChoice[]): boolean {
  if (spec.sameController !== true) return true;
  const controllers = chosen.flatMap((t) => (t.kind === 'object' ? [s.objects[t.id]?.controller ?? `?${t.id}`] : []));
  return new Set(controllers).size <= 1;
}

/**
 * std-cardcopy-7 (CR 115.1, 601.2c, 205.2a): can the objects of `chosen` be "one of each card type" as a spec's `perCardType` requires ("up to one target nonland card of
 * each card type"): each object given a card type it has, no type given to more than `max` of them (a matching, tried by backtracking; an artifact creature card counts
 * for either). Always true without it.
 */
export function perCardTypeHolds(s: GameState, spec: TargetSpec, chosen: readonly TargetChoice[], x = 0): boolean {
  if (spec.perCardType !== true) return true;
  const cap = evalCount(spec.max, { x });
  const sets = chosen.flatMap((t) => {
    const o = t.kind === 'object' ? s.objects[t.id] : undefined;
    return o === undefined ? [[] as string[]] : [[...new Set<string>(charsOfObject(s, o).types)]];
  });
  const used = new Map<string, number>();
  const fit = (i: number): boolean => {
    if (i === sets.length) return true;
    for (const ty of sets[i]!) {
      if ((used.get(ty) ?? 0) >= cap) continue;
      used.set(ty, (used.get(ty) ?? 0) + 1);
      if (fit(i + 1)) return true;
      used.set(ty, used.get(ty)! - 1);
    }
    return false;
  };
  return fit(0);
}

/**
 * A spec's effective count range once X is known (CR 107.3a, 601.2c): `min`, and `max` clamped by what exists and by the amount to divide (each target gets at
 * least 1, CR 601.2d). `null` when the range can't be met (too few candidates, or the cheapest `min` candidates already break `groupLimit`).
 */
export function targetRange(s: GameState, spec: TargetSpec, available: TargetOptions, x: number): { min: number; max: number } | null {
  const min = evalCount(spec.min, { x });
  // FAST5 T66: `perOpponent`, `max` is the most targets for EACH opponent ("for each opponent, ... up to one target ... that player controls"): at most that many from each
  // controller the candidates have (the opponents; a two-player game has one), checked on the set chosen by `perOpponentHolds`
  const perPlayer = spec.perOpponent === true || spec.perPlayer === true ? new Set(available.objects.map((id) => s.objects[id]?.controller)).size : 1;
  // std-cardcopy-7: `perCardType`, `max` for EACH card type the candidates have (checked on the set chosen by `perCardTypeHolds`)
  const perType = spec.perCardType === true ? new Set(available.objects.flatMap((id) => { const o = s.objects[id]; return o ? charsOfObject(s, o).types : []; })).size : 1;
  let max = Math.min(evalCount(spec.max, { x }) * perPlayer * perType, optionCount(available));
  if (spec.divide) max = Math.min(max, evalCount(spec.divide.total, { x }));
  if (max < min) return null;
  const g = spec.groupLimit;
  if (g && min > 0 && (g.cmp.op === '<=' || g.cmp.op === '<')) {
    const costs = [...available.objects.map((id) => groupStat(s, { kind: 'object', id }, g.stat)), ...available.players.map(() => 0)].sort((a, b) => a - b);
    if (!holds(g.cmp, costs.slice(0, min).reduce((n, c) => n + c, 0), evalCount(g.cmp.value, { x }))) return null;
  }
  return { min, max };
}

const MAX_LEAVES = 2000;

/** Candidates of a spec minus the ones its `distinctFrom` forbids (CR 115.3: "another target" differs from the targets of the listed specs). */
export function candidatesFor(
  s: GameState, spec: TargetSpec, controller: PlayerId, sourceId: ObjectId | undefined, stackId: ObjectId | undefined, chosen: ReadonlyMap<string, readonly TargetChoice[]>, x?: AnnouncedX,
): TargetOptions {
  const opts = targetOptions(s, spec, controller, sourceId, stackId, { chosen, ...(x !== undefined ? { x } : {}) });
  const forbidden = new Set<string>();
  for (const other of spec.distinctFrom ?? []) for (const t of chosen.get(other) ?? []) forbidden.add(`${t.kind}:${t.id}`);
  if (forbidden.size === 0) return opts;
  return { objects: opts.objects.filter((id) => !forbidden.has(`object:${id}`)), players: opts.players.filter((id) => !forbidden.has(`player:${id}`)) };
}

/**
 * Can every required target of `specs` be chosen at once (CR 601.2c)? A spec's targets must differ from each other (CR 115.3) and from the targets of the
 * specs in its `distinctFrom`. `required` says which specs count (a spec whose `onlyIf` is false doesn't). Backtracking with a leaf cap: when the cap is reached
 * the answer is optimistic (the announcement then reports the problem and the action is cancelled, never half-applied; a triggered ability's announcement
 * asks `specsFeasibility` instead, which says when it gave up).
 */
export function specsFeasible(
  s: GameState, specs: readonly TargetSpec[], required: (spec: TargetSpec) => boolean, controller: PlayerId, sourceId: ObjectId | undefined, stackId: ObjectId | undefined, x: AnnouncedX | undefined,
  already: ReadonlyMap<string, readonly TargetChoice[]> = new Map(),
): boolean {
  const r = searchSpecs(s, specs, required, controller, sourceId, stackId, x, already, false);
  return r.found || r.capped;
}

/**
 * `specsFeasible` without the optimism (AF1 review, CR 603.3d): 'yes' when a full legal assignment of min-size target sets was FOUND (a witness: each set
 * also keeps its spec's `groupLimit`), 'no' when the search was exhaustive and found none, 'unknown' when it gave up at its leaf cap or met a `groupLimit` it
 * can't settle with min-size sets (an op other than `<=`/`<`: a larger set might keep it). A triggered ability's announcement reads it to tell "no legal
 * choice exists" (the ability is removed, CR 603.3d) from "this answer is illegal" (rejected and asked again, CR 601.2c), so a decision whose every answer
 * would be rejected is never left pending (actions/announce-targets.ts).
 */
export type Feasibility = 'yes' | 'no' | 'unknown';
export function specsFeasibility(
  s: GameState, specs: readonly TargetSpec[], required: (spec: TargetSpec) => boolean, controller: PlayerId, sourceId: ObjectId | undefined, stackId: ObjectId | undefined, x: AnnouncedX | undefined,
  already: ReadonlyMap<string, readonly TargetChoice[]> = new Map(),
): Feasibility {
  const r = searchSpecs(s, specs, required, controller, sourceId, stackId, x, already, true);
  if (r.found) return 'yes';
  return r.capped || r.unsettled ? 'unknown' : 'no';
}

/**
 * The backtracking behind both: `found` a full assignment, `capped` when the leaf cap stopped the search (it then stops at once), `unsettled` when a spec's
 * `groupLimit` can't be settled by min-size sets. With `witness` each chosen set is checked against its spec's `groupLimit` (the sets of such a spec are
 * enumerated), so a found assignment is a real one; without it this is the original optimistic search of `specsFeasible`, unchanged.
 */
function searchSpecs(
  s: GameState, specs: readonly TargetSpec[], required: (spec: TargetSpec) => boolean, controller: PlayerId, sourceId: ObjectId | undefined, stackId: ObjectId | undefined, x: AnnouncedX | undefined,
  already: ReadonlyMap<string, readonly TargetChoice[]>, witness: boolean,
): { found: boolean; capped: boolean; unsettled: boolean } {
  const active = specs.filter(required);
  if (active.length === 0) return { found: true, capped: false, unsettled: false };
  const unsettled = witness && active.some((sp) => sp.groupLimit !== undefined && sp.groupLimit.cmp.op !== '<=' && sp.groupLimit.cmp.op !== '<');
  const usesDistinct = active.some((sp) => sp.distinctFrom?.length);
  const xn = countX(x);
  let leaves = 0;
  let capped = false;
  const chosen = new Map<string, readonly TargetChoice[]>(already);

  const walk = (i: number): boolean => {
    if (i === active.length) return true;
    if (capped || ++leaves > MAX_LEAVES) { capped = true; return false; }
    const spec = active[i]!;
    const opts = candidatesFor(s, spec, controller, sourceId, stackId, chosen, x);
    const range = targetRange(s, spec, opts, xn);
    if (!range) return false;
    if (range.min === 0) { chosen.set(spec.id, []); return walk(i + 1); }
    const all: TargetChoice[] = [...opts.objects.map((id): TargetChoice => ({ kind: 'object', id })), ...opts.players.map((id): TargetChoice => ({ kind: 'player', id }))];
    // FAST3 T14: a `sameOwner` spec is enumerated too (its first `min` candidates may have several owners), in both modes
    const limited = (witness && spec.groupLimit !== undefined) || spec.sameOwner === true || spec.differentNames === true || spec.perOpponent === true || spec.perPlayer === true || spec.sharedCardType === true || spec.sharedCreatureType === true
      || spec.differentControllers === true || spec.sameController === true || spec.perCardType === true; // CLOUD std-tmt, std-rx30, std-cardcopy-7
    if (!usesDistinct && !limited) {
      // Without distinctFrom the choice of one spec never limits another: only the count matters.
      chosen.set(spec.id, all.slice(0, range.min));
      return walk(i + 1);
    }
    const combo = (start: number, picked: TargetChoice[]): boolean => {
      if (capped) return false;
      if (picked.length === range.min) {
        if (limited && (!groupLimitHolds(s, spec, picked, xn) || !sameOwnerHolds(s, spec, picked) || !differentNamesHold(s, spec, picked) || !perOpponentHolds(s, spec, picked) || !sharedCardTypeHolds(s, spec, picked) || !sharedCreatureTypeHolds(s, spec, picked)
          || !differentControllersHold(s, spec, picked) || !sameControllerHolds(s, spec, picked) || !perCardTypeHolds(s, spec, picked, xn))) return false;
        chosen.set(spec.id, picked);
        return walk(i + 1);
      }
      for (let k = start; k < all.length; k++) if (combo(k + 1, [...picked, all[k]!])) return true;
      return false;
    };
    return combo(0, []);
  };
  const found = walk(0);
  return { found, capped, unsettled };
}

/**
 * Whether every required target of the program could be chosen (CR 601.2c: otherwise it can't be cast/activated). `x` is the state of X (`AnnouncedX`): a
 * count that is X is read at X = 0 before X is announced, the announcement that always exists (CR 107.3b); the announcement re-reads it with the announced X
 * (CR 601.2b-c). With `{ upTo }` and a target filter that reads X, the program has targets when SOME payable X gives them all (one X for the whole spell,
 * CR 107.3i). `required` tells which specs count; by default every spec that has no `onlyIf` (a conditional target is required only once the choice that
 * makes it required is made, so it can't keep a spell from being cast). Callers gate unsupported specs first (`actions/announce.ts#unsupportedForms`): this
 * function throws for a spec the build can't read.
 */
export function programHasTargets(
  s: GameState, program: EffectProgram, controller: PlayerId, sourceId?: ObjectId, stackId?: ObjectId, required: (spec: TargetSpec) => boolean = (sp) => sp.onlyIf === undefined, x?: AnnouncedX,
): boolean {
  if (typeof x === 'object') {
    if (!programFiltersMentionX(program)) return programHasTargets(s, program, controller, sourceId, stackId, required, 'unannounced');
    for (let n = 0; n <= x.upTo; n++) if (programHasTargets(s, program, controller, sourceId, stackId, required, n)) return true;
    return false;
  }
  const own = specsFeasible(s, program.targets, required, controller, sourceId, stackId, x);
  if (!program.modes) return own;
  const m = program.modes;
  const ok = m.options.filter((o) => programHasTargets(s, o.program, controller, sourceId, stackId, required, x)).length;
  const min = evalCount(m.min, { x: countX(x) });
  // std-blb (CR 700.2d): when a mode may be chosen more than once, one usable mode is enough for any number of choices (as actions/announce.ts#modesDenial counts)
  return own && (ok >= min || min === 0 || (m.allowRepeat === true && ok > 0));
}

/** Does a target filter of the program (modes included) read X? */
export function programFiltersMentionX(p: EffectProgram): boolean {
  return p.targets.some((t) => filterMentionsX(t.filter)) || (p.modes?.options.some((o) => programFiltersMentionX(o.program)) ?? false);
}

/**
 * CR 608.2b: after resolution starts, check each target. Returns how many chosen targets are still legal
 * and how many were chosen. A target that left its zone (it is then a new object) or no longer matches is illegal.
 */
export function recheckTargets(s: GameState, specs: TargetSpec[], choices: TargetChoice[][], controller: PlayerId, sourceId: ObjectId, stackId: ObjectId): { legal: number; total: number } {
  let legal = 0;
  let total = 0;
  const chosen = targetsById(specs, choices);
  choices.forEach((group, i) => {
    const spec = specs[i];
    const opts = spec ? targetOptions(s, spec, controller, sourceId, stackId, { chosen }) : { objects: [], players: [] };
    for (const t of group) {
      total++;
      if (t.kind === 'object' ? opts.objects.includes(t.id) : opts.players.includes(t.id)) legal++;
    }
  });
  return { legal, total };
}
