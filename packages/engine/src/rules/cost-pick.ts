/**
 * Cost parts that make someone pick objects or cards (sacrifice, return to hand, exile, discard, reveal, tap an untapped permanent, tap creatures with total power
 * N, collect evidence, counters on a chosen permanent) and the question "can the whole cost be paid?" when those picks and the mana payment compete for the
 * same permanents. Owner: WP7.
 *
 * The rules (CR 601.2g-h, 602.2b): the player activates mana abilities BEFORE paying the other costs, so a permanent can be
 * tapped for mana and then sacrificed or returned to hand as part of the same cost. But a permanent that is tapped by "tap an
 * untapped creature you control" can't also be tapped for mana, and one whose mana ability sacrifices it (Lotus Petal) can't
 * be sacrificed a second time. Each object pays at most one part (CR 118.3).
 *
 * Most parts take a fixed number of objects. A THRESHOLD part (`tapPower`: total power N or more, CR 702.122a; `collectEvidence`: total mana value N or more,
 * CR 701.59a) takes as many as it needs: the feasibility search tries the fewest objects that reach the total, preferring the ones mana does not need.
 */
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import type { CostPlan, PlanPart } from './cost';
import { charsOfObject, ptNumbers } from './characteristics';
import { findObjects } from './filter';
import { filterCtxOutside } from './filter-env';
import { lifeBudget } from './life';
import { solve } from './solver';
import { buildProviders, extraManaModes, manaSources, spendAllows, spendOptions, type ManaConverter, type ManaSource } from './sources';
import { solveWithConverters } from './convert';
import { costUseDenial, type CostUse } from './cant';
import { crewSaddleValue } from '../statics/hooks';
import { colorSymbolCount } from '../types/mana';

/**
 * CLOUD std-ecl (CR 122.1, 118.3): how many counters of `kind` a permanent has toward a "remove counters" cost: of that kind, or of every kind together for
 * `'any'` ("Remove two counters from this creature": any kinds, the payer chooses which). Counter names are data: "toString" is not an inherited member.
 */
export function countersFor(counters: Readonly<Record<string, number>>, kind: string): number {
  if (kind !== 'any') return Object.hasOwn(counters, kind) ? counters[kind] ?? 0 : 0;
  let n = 0;
  for (const k of Object.keys(counters)) n += counters[k] ?? 0;
  return n;
}

export type PickPart = Extract<PlanPart, { kind: 'sacrifice' | 'returnToHand' | 'putIntoLibrary' | 'exileFrom' | 'discard' | 'tapUntapped' | 'tapPower' | 'collectEvidence' | 'reveal' | 'removeCounters' | 'putCounters' | 'behold' | 'chooseObject' | 'untapTapped' }>;

export const isPickPart = (part: PlanPart): part is PickPart => {
  switch (part.kind) {
    case 'sacrifice': case 'returnToHand': case 'exileFrom': case 'tapUntapped': case 'tapPower': case 'collectEvidence': case 'reveal': case 'behold': case 'chooseObject': return true;
    case 'putIntoLibrary': return true; // trek-9: the source itself (isSelfPart)
    case 'untapTapped': return true; // p2-cost-parts-1
    case 'discard': return part.hand !== true; // "discard your hand" picks nothing
    case 'removeCounters': return part.filter !== undefined && part.among !== true; // on the source otherwise; r3-cost: "from among" is chosen counter by counter as it is paid
    case 'putCounters': return part.self !== true && part.filter !== undefined;
    default: return false;
  }
};

/** "Sacrifice this permanent", "discard this card": the source itself pays, there is nothing to choose. */
export const isSelfPart = (part: PlanPart): boolean =>
  (part.kind === 'sacrifice' || part.kind === 'returnToHand' || part.kind === 'exileFrom' || part.kind === 'discard' || part.kind === 'reveal' || part.kind === 'putIntoLibrary') && part.self === true;

/** Discarding at random (CR 701.9b) is decided when the cost is paid. */
export const isRandomPart = (part: PlanPart): boolean => part.kind === 'discard' && part.random === true;

type Threshold = Extract<PlanPart, { kind: 'tapPower' | 'collectEvidence' | 'exileFrom' }>;

/**
 * A part that takes as many objects as it needs to reach a total (tapPower, collectEvidence). std-costs-1: also an EXACT total, "Exile one or more other artifacts
 * you control with total mana value X" (`exileFrom` with `total`, CR 118.3, 107.3a): the objects' mana values add up to exactly that number (isExactPart).
 */
export const isThresholdPart = (part: PlanPart): part is Threshold => part.kind === 'tapPower' || part.kind === 'collectEvidence' || (part.kind === 'exileFrom' && (part.total !== undefined || part.symbolTotal !== undefined)); // std-cardcopy-7: or a total of mana symbols

/** std-costs-1: a threshold part whose total must be met exactly, not exceeded. */
export const isExactPart = (part: PlanPart): boolean => part.kind === 'exileFrom' && part.total !== undefined;

export const thresholdOf = (part: Threshold): number => (part.kind === 'tapPower' ? part.power : part.kind === 'exileFrom' ? part.total ?? part.symbolTotal?.atLeast ?? 0 : part.amount);

/** What one object counts for a threshold part: a creature's power, or a card's mana value. */
export function valueOf(s: GameState, part: Threshold, id: ObjectId): number {
  const o = s.objects[id];
  if (!o) return 0;
  const c = charsOfObject(s, o);
  if (part.kind === 'tapPower' && part.as !== undefined) return crewSaddleValue(s, id, c); // FAST5X E3: what it counts for a crew or saddle cost (CR 702.122a, 702.171a)
  if (part.kind === 'exileFrom' && part.symbolTotal !== undefined) return colorSymbolCount(c.manaCost, part.symbolTotal.color); // std-cardcopy-7 (CR 107.4)
  return part.kind === 'tapPower' ? ptNumbers(c).power ?? 0 : c.manaValue;
}

/**
 * r3-cost (CR 118.3, 122.1): the permanents a "remove N counters from among <permanents>" part may take counters from: the ones the filter describes that the
 * player controls with at least one counter of the kind (any kind for `'any'`); `countersAmong` is how many there are in all.
 */
export function amongCounterHolders(s: GameState, player: PlayerId, sourceId: ObjectId | null, part: Extract<PlanPart, { kind: 'removeCounters' }>): ObjectId[] {
  if (part.filter === undefined) return [];
  const ctx = filterCtxOutside(s, { controller: player, ...(sourceId ? { sourceId } : {}), x: null });
  return findObjects(s, { ...part.filter, zone: 'battlefield', controller: 'you' }, ctx).filter((o) => !o.phasedOut && countersFor(o.counters, part.counter) > 0).map((o) => o.id);
}
export function countersAmong(s: GameState, player: PlayerId, sourceId: ObjectId | null, part: Extract<PlanPart, { kind: 'removeCounters' }>): number {
  return amongCounterHolders(s, player, sourceId, part).reduce((n, id) => n + countersFor(s.objects[id]!.counters, part.counter), 0);
}

/** How many objects a pick part takes (a threshold part takes at least one unless its total is 0). */
export function pickCount(part: PickPart): number {
  if (isSelfPart(part) || part.kind === 'putIntoLibrary') return 1; // trek-9: putIntoLibrary is the source itself
  if (part.kind === 'exileFrom' && isExactPart(part)) return part.count; // std-costs-1: at least this many objects ("one or more")
  if (isThresholdPart(part)) return thresholdOf(part) > 0 ? 1 : 0;
  if (part.kind === 'removeCounters' || part.kind === 'putCounters') return 1; // one chosen permanent gets / loses all the counters
  return part.count;
}

/** Candidate objects for a cost part that makes the player choose (sacrifice, discard, ...). Objects the player already chose (`chosen`) are the only ones left. */
export function partCandidates(s: GameState, player: PlayerId, sourceId: ObjectId | null, part: PlanPart, plan?: CostPlan): ObjectId[] {
  // WP30: references and quantities in a part's filter are read in the announcement environment (rules/filter-env.ts); its X is already fixed (cost.ts#toPlanPart).
  // M6-12 (CR 702.78a: "two untapped creatures you control that each share a color with it"): a spell's cost is paid with no ability source, so its filters
  // read "it" / "this spell" as the spell being paid for (`plan.spend`)
  const filterSource = sourceId ?? (plan?.spend?.kind === 'spell' ? plan.spend.id : undefined);
  const ctx = filterCtxOutside(s, { controller: player, ...(filterSource ? { sourceId: filterSource } : {}), x: null });
  const all = ((): ObjectId[] => {
    switch (part.kind) {
      case 'sacrifice':
        if (part.self) return sourceId && s.objects[sourceId]?.zone === 'battlefield' ? [sourceId] : [];
        return findObjects(s, { ...part.filter, zone: 'battlefield', controller: 'you' }, ctx).map((o) => o.id); // CR 701.21a: only your own
      case 'returnToHand':
        if (part.self) return sourceId && s.objects[sourceId]?.zone === 'battlefield' ? [sourceId] : [];
        // FAST3 T14: "return an enchantment to its owner's hand" may return anyone's (CR 118.3; the text says "you control" where it means yours, and the parsed
        // filter keeps it), so the controller is the filter's own, any player when it names none
        // ... and "return a basic land card from your graveyard to your hand" returns a card of your graveyard (CR 118.3, 404.1; only your own cards)
        if (part.filter.zone === 'graveyard') return findObjects(s, { ...part.filter, zone: 'graveyard', owner: 'you' }, ctx).map((o) => o.id);
        return findObjects(s, { controller: 'any', ...part.filter, zone: 'battlefield' }, ctx).map((o) => o.id);
      case 'tapUntapped':
      case 'tapPower':
        return findObjects(s, { ...part.filter, zone: 'battlefield', controller: 'you', tapped: false }, ctx).map((o) => o.id).filter((id) => !(part.other && id === sourceId));
      case 'untapTapped':
        // p2-cost-parts-1 (CR 118.3, 701.26b, 122.1d): tapped permanents you control; one with a stun counter would not untap (the counter is removed instead), so it
        // can't pay the part
        return findObjects(s, { ...part.filter, zone: 'battlefield', controller: 'you', tapped: true }, ctx).filter((o) => countersFor(o.counters, 'stun') === 0).map((o) => o.id);
      case 'discard':
      case 'reveal':
        // M11-1, CR 702.49d: commander ninjutsu reveals "this card from your hand or from the command zone" (an ability that functions in the command zone)
        if (part.self) return sourceId && (s.objects[sourceId]?.zone === 'hand' || (part.kind === 'reveal' && s.objects[sourceId]?.zone === 'command')) ? [sourceId] : [];
        return findObjects(s, { ...(part.filter ?? {}), zone: 'hand', owner: 'you' }, ctx).map((o) => o.id);
      case 'putIntoLibrary': // trek-9 (CR 118.3, 401.4): the source itself, where the part says it is
        return sourceId && s.objects[sourceId]?.zone === part.zone ? [sourceId] : [];
      case 'exileFrom':
        if (part.self) return sourceId && s.objects[sourceId]?.zone === part.zone ? [sourceId] : [];
        if (part.orGraveyard) {
          // FAST5X E13, CR 702.167a-b: craft's materials are permanents you control and/or cards in your graveyard with the quality (an "artifact" is an
          // artifact permanent or an artifact card); never the source, which pays its own "Exile this permanent" part (CR 118.3)
          return [
            ...findObjects(s, { ...(part.filter ?? {}), zone: 'battlefield', controller: 'you' }, ctx),
            ...findObjects(s, { ...(part.filter ?? {}), zone: 'graveyard', owner: 'you' }, ctx),
          ].map((o) => o.id).filter((id) => id !== sourceId);
        }
        // FAST5X E13: "Exile a creature you control" (CR 118.3): permanents you control
        if (part.zone === 'battlefield') return findObjects(s, { ...(part.filter ?? {}), zone: 'battlefield', controller: 'you' }, ctx).map((o) => o.id);
        return findObjects(s, { ...(part.filter ?? {}), zone: part.zone, owner: 'you' }, ctx).map((o) => o.id);
      case 'collectEvidence':
        return findObjects(s, { zone: 'graveyard', owner: 'you' }, ctx).map((o) => o.id);
      case 'behold':
        // FAST5X E11, CR 701.4a: "reveal a [quality] card from your hand or choose a [quality] permanent you control on the battlefield"
        return [
          ...findObjects(s, { ...part.filter, zone: 'battlefield', controller: 'you' }, ctx).map((o) => o.id),
          ...findObjects(s, { ...part.filter, zone: 'hand', owner: 'you' }, ctx).map((o) => o.id),
        ];
      case 'chooseObject':
        // std-costs-2 (CR 601.2b): the objects of each filter, in the zone it names ("a creature you control or a warped creature card you own in exile")
        return [...new Set(part.filters.flatMap((f) => findObjects(s, f, ctx).map((o) => o.id)))];
      case 'removeCounters':
        return part.filter ? findObjects(s, { ...part.filter, zone: 'battlefield', controller: 'you' }, ctx).filter((o) => countersFor(o.counters, part.counter) >= part.count).map((o) => o.id) : [];
      case 'putCounters':
        return part.filter ? findObjects(s, { ...part.filter, zone: 'battlefield', controller: 'you' }, ctx).map((o) => o.id) : [];
      default:
        return [];
    }
  })();
  const chosen = 'chosen' in part ? part.chosen : undefined;
  // A spell still in the hand while `castCheck` asks "can this be paid?" can't discard, reveal or exile itself for its own cost: it will be on the stack (CR 601.2a).
  const self = plan?.spend?.kind === 'spell' && !isSelfPart(part) ? plan.spend.id : undefined;
  const use = costUse(part);
  // CR 702.26b: a phased-out permanent is treated as though it doesn't exist. CR 614.17b (WP31): an object a "can't" effect keeps from paying this part
  // ("can't be sacrificed", "can't leave the battlefield", "you can't discard cards", ...) is no candidate.
  const rest = all.filter((id) => id !== self && !s.objects[id]?.phasedOut && (use === undefined || costUseDenial(s, player, id, use) === null));
  return chosen ? rest.filter((id) => chosen.includes(id)) : rest;
}

/** What paying this part does to the object it takes, for the "can't" checks (rules/cant.ts); undefined for parts no wired rule action concerns. */
function costUse(part: PlanPart): CostUse | undefined {
  switch (part.kind) {
    case 'sacrifice': return 'sacrifice';
    case 'returnToHand': return part.beamUp === true ? 'beamUp' : 'returnToHand'; // trek-1: a beam me up cost (rules/cant.ts)
    case 'exileFrom': return 'exile';
    case 'collectEvidence': return 'exile'; // CR 701.59a: exile cards from your graveyard (WP31 review)
    case 'discard': return 'discard';
    case 'putCounters': return 'putCounters';
    case 'behold': return part.exile ? 'exile' : undefined; // FAST5X E11: "behold a Goblin and exile it" exiles what was beheld
    default: return undefined;
  }
}

/**
 * Candidates for a pick part once the whole plan is known. A permanent tapped for the {T} cost can't also be tapped by
 * "tap an untapped creature you control" (the {T} cost is paid first, so the source is already tapped).
 */
export function pickCandidates(s: GameState, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, part: PickPart): ObjectId[] {
  const cands = partCandidates(s, player, sourceId, part, plan);
  if (part.kind === 'untapTapped') return (plan.tap || plan.untap) && sourceId ? cands.filter((id) => id !== sourceId) : cands; // p2-cost-parts-1: the {T} / {Q} source is never one of them
  return (part.kind === 'tapUntapped' || part.kind === 'tapPower') && plan.tap && sourceId ? cands.filter((id) => id !== sourceId) : cands;
}

/** r3-cost (CR 201.2): the name an object has for "with different names" (a nameless object, a face-down one, has none: it differs from every name). */
function namesOf(s: GameState, id: ObjectId): string {
  const o = s.objects[id];
  const name = o ? charsOfObject(s, o).name : '';
  return name === '' ? `#${id}` : name;
}

/** Does the part have enough candidates (ignoring what other parts and the mana use)? CR 118.3. */
export function pickFeasible(s: GameState, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, part: PickPart): boolean {
  const cands = pickCandidates(s, player, sourceId, plan, part);
  if (isExactPart(part) && isThresholdPart(part)) return exactSubset(cands.map((id) => valueOf(s, part, id)), thresholdOf(part), pickCount(part));
  if (isThresholdPart(part)) return cands.reduce((n, id) => n + valueOf(s, part, id), 0) >= thresholdOf(part);
  if (part.kind === 'sacrifice' && part.distinctNames === true) return new Set(cands.map((id) => namesOf(s, id))).size >= pickCount(part); // r3-cost
  return cands.length >= pickCount(part);
}

/**
 * std-costs-1 (CR 118.3): can some `min` or more of these values add up to exactly `total`? (A subset sum over small whole numbers: the reachable totals for each
 * number of values taken, capped at `min`.)
 */
export function exactSubset(values: readonly number[], total: number, min: number): boolean {
  if (total < 0) return false;
  // reach[k] = the totals reachable with k values (k capped at min: "min or more")
  const reach: Set<number>[] = Array.from({ length: min + 1 }, () => new Set<number>());
  reach[0]!.add(0);
  for (const v of values) {
    for (let k = min; k >= 0; k--) {
      for (const t of [...reach[k]!]) {
        const nt = t + v;
        if (nt <= total) reach[Math.min(min, k + 1)]!.add(nt);
      }
    }
  }
  return reach[min]!.has(total);
}

const lifeInParts = (plan: CostPlan): number => plan.other.reduce((n, part) => n + (part.kind === 'payLife' ? part.amount : 0), 0);

const MAX_LEAVES = 400;

type Group = 'remove' | 'tap' | 'touch';

/** Objects of the same group can't pay two parts (CR 118.3); tapping, removing and merely touching an object (reveal, counters) are separate groups. */
function groupOf(part: PickPart): Group {
  switch (part.kind) {
    case 'tapUntapped': case 'tapPower': case 'untapTapped': return 'tap'; // p2-cost-parts-1: an object is tapped or untapped by one part at most
    case 'reveal': case 'removeCounters': case 'putCounters': return 'touch';
    case 'behold': return part.exile ? 'remove' : 'touch'; // FAST5X E11: beholding only shows or names the object (CR 701.4a) unless it is exiled too
    case 'chooseObject': return 'touch'; // std-costs-2: choosing only names the object (CR 601.2b)
    default: return 'remove';
  }
}

/**
 * Which objects pay the pick parts of a plan, such that the whole cost can be paid. `forced[i]` are objects already chosen for
 * plan.other[i] (a partial or complete choice that must be kept). Returns one array per part of plan.other (empty for parts
 * that pick nothing), or null if there is no way. With `withMana`, the mana of the plan must be payable from the sources the
 * picks leave over.
 */
export function findAssignment(
  s: GameState, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, forced: ObjectId[][], withMana: boolean,
): ObjectId[][] | null {
  const parts = plan.other;
  const picks: ObjectId[][] = parts.map(() => []);
  const needMana = withMana && plan.mana.length > 0;
  const sources = needMana ? manaSources(s, player, undefined, plan.spend) : [];
  const allows = spendAllows(s, player, plan.spend);
  const anyType = spendOptions(plan.spend); // FAST5X E29 (CR 609.4b); std-rx32: "as though it were mana of any color"
  const bySource = new Map(sources.map((x) => [x.objectId, x]));
  const p = s.players.find((x) => x.id === player)!;
  const life = Math.max(0, lifeBudget(s, player) - lifeInParts(plan));
  // An object is "lost" to the mana payment when the part uses it up in a way that matters to mana.
  const lost = (group: Group, id: ObjectId): boolean => (group === 'tap' ? bySource.has(id) : group === 'remove' ? bySource.get(id)?.modes.some((m) => m.sacrifices) === true : false);
  // FAST5X E5 (CR 605.3a): filter abilities may pay too, when the ordinary sources can't (rules/convert.ts); read only then. A filter ability's permanent is
  // lost to the payment when a part taps it, or removes it while the ability sacrifices it too (as for a source).
  let converters: ManaConverter[] | null = null;
  const manaCache = new Map<string, boolean>();
  const convCache = new Map<string, boolean>();
  const manaOk = (excluded: Set<ObjectId>, tapped: ReadonlySet<ObjectId>, removed: ReadonlySet<ObjectId>): boolean => {
    if (!needMana) return true;
    const key = [...excluded].sort().join(',');
    const usable = (): ManaSource[] => sources.filter((x) => !excluded.has(x.objectId) && !(plan.tap && x.objectId === sourceId));
    let ok = manaCache.get(key);
    if (ok === undefined) {
      ok = solve({ symbols: plan.mana, providers: buildProviders(usable(), p.manaPool, undefined, allows), life, ...anyType }) !== null;
      manaCache.set(key, ok);
    }
    if (ok) return true;
    const convKey = `${key}|${[...tapped].sort().join(',')}|${[...removed].sort().join(',')}`;
    let viaFilters = convCache.get(convKey);
    if (viaFilters === undefined) {
      converters ??= extraManaModes(s, player, undefined, plan.spend).converters;
      const filters = converters.filter((c) => !tapped.has(c.objectId) && !(c.sacrifices && removed.has(c.objectId)) && !(plan.tap && c.objectId === sourceId));
      viaFilters = filters.length > 0 && solveWithConverters({ symbols: plan.mana, sources: usable(), pool: p.manaPool, converters: filters, life, allows, ...anyType }) !== null;
      convCache.set(convKey, viaFilters);
    }
    return viaFilters;
  };

  const order: number[] = [];
  parts.forEach((part, i) => { if (isPickPart(part) && !isRandomPart(part)) order.push(i); });
  const used: Record<Group, Set<ObjectId>> = { remove: new Set(), tap: new Set(), touch: new Set() };
  let leaves = 0;

  const finish = (): boolean => {
    leaves++;
    const excluded = new Set<ObjectId>();
    const tapped = new Set<ObjectId>();
    const removed = new Set<ObjectId>();
    for (const i of order) {
      const group = groupOf(parts[i] as PickPart);
      for (const id of picks[i]!) {
        if (lost(group, id)) excluded.add(id);
        if (group === 'tap') tapped.add(id);
        else if (group === 'remove') removed.add(id);
      }
    }
    return manaOk(excluded, tapped, removed);
  };

  // Every combination of `size` items of `list` (in order), passed to `then`.
  const combos = (list: ObjectId[], size: number, then: (chosen: ObjectId[]) => boolean): boolean => {
    const go = (start: number, chosen: ObjectId[]): boolean => {
      if (chosen.length === size) return then(chosen);
      for (let k = start; k < list.length; k++) if (go(k + 1, [...chosen, list[k]!])) return true;
      return false;
    };
    return go(0, []);
  };

  const walk = (n: number): boolean => {
    if (leaves > MAX_LEAVES) return false;
    if (n === order.length) return finish();
    const i = order[n]!;
    const part = parts[i] as PickPart;
    const group = groupOf(part);
    const fixed = forced[i] ?? [];
    const cands = pickCandidates(s, player, sourceId, plan, part);
    const set = used[group];
    for (const id of fixed) if (!cands.includes(id) || set.has(id)) return false;
    const free = cands.filter((id) => !set.has(id) && !fixed.includes(id));
    const relevant = free.filter((id) => lost(group, id));
    const neutral = free.filter((id) => !lost(group, id));

    const take = (chosen: ObjectId[]): boolean => {
      const all = [...fixed, ...chosen];
      picks[i] = all;
      for (const id of all) set.add(id);
      if (walk(n + 1)) return true;
      for (const id of all) set.delete(id);
      picks[i] = [];
      return false;
    };

    if (isThresholdPart(part) && isExactPart(part)) {
      // std-costs-1 (CR 118.3): exactly that total mana value, from at least `count` objects: every combination of the free ones, smallest first, preferring the
      // ones mana does not need (a few permanents only: MAX_LEAVES bounds the payable ones tried)
      const need = thresholdOf(part);
      const val = (id: ObjectId): number => valueOf(s, part, id);
      const have = fixed.reduce((t, id) => t + val(id), 0);
      if (have > need) return false;
      const pool = [...neutral, ...relevant].slice(0, 16);
      for (let j = Math.max(0, pickCount(part) - fixed.length); j <= pool.length; j++) {
        if (j === 0 && fixed.length > 0 && have === need) { if (take([])) return true; continue; }
        if (j === 0) continue;
        if (combos(pool, j, (chosen) => have + chosen.reduce((t, id) => t + val(id), 0) === need && take(chosen))) return true;
      }
      return false;
    }
    if (isThresholdPart(part)) {
      // Total power / mana value N or more: the fewest objects that reach it, preferring the ones mana does not need.
      const need = thresholdOf(part);
      const val = (id: ObjectId): number => valueOf(s, part, id);
      const have = fixed.reduce((t, id) => t + val(id), 0);
      const byValue = (a: ObjectId, b: ObjectId): number => val(b) - val(a);
      const rel = [...relevant].sort(byValue);
      const neu = [...neutral].sort(byValue);
      for (let j = 0; j <= rel.length; j++) {
        const ok = combos(rel, j, (chosen) => {
          let sum = have + chosen.reduce((t, id) => t + val(id), 0);
          const fill: ObjectId[] = [];
          for (const id of neu) {
            if (sum >= need) break;
            fill.push(id);
            sum += val(id);
          }
          return sum >= need && take([...chosen, ...fill]);
        });
        if (ok) return true;
      }
      return false;
    }

    const need = pickCount(part) - fixed.length;
    if (need < 0) return false;
    // r3-cost (CR 118.3, 201.2): "with different names": the objects are not interchangeable; every combination of the free ones is tried (few objects)
    if (part.kind === 'sacrifice' && part.distinctNames === true) {
      const names = (ids: ObjectId[]): boolean => new Set(ids.map((id) => namesOf(s, id))).size === ids.length;
      if (!names(fixed)) return false;
      return combos(free, need, (chosen) => names([...fixed, ...chosen]) && take(chosen));
    }
    // Neutral objects are interchangeable as far as mana goes, so only the first few ever need trying.
    for (let j = 0; j <= Math.min(need, relevant.length); j++) {
      if (need - j > neutral.length) continue;
      const rest = neutral.slice(0, need - j);
      if (combos(relevant, j, (chosen) => take([...chosen, ...rest]))) return true;
    }
    return false;
  };

  return walk(0) ? picks : null;
}

/**
 * The objects the player may choose for plan.other[index] given what they chose for the parts before it: only those that
 * leave a way to pay the rest of the cost (so a listed action is never a dead end, docs/ARCHITECTURE.md).
 */
export function pickOptions(s: GameState, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, index: number, chosen: ObjectId[][]): ObjectId[] {
  const part = plan.other[index] as PickPart;
  return pickCandidates(s, player, sourceId, plan, part).filter((id) => {
    const forced = plan.other.map((_, i) => (i < index ? chosen[i] ?? [] : i === index ? [id] : []));
    return findAssignment(s, player, sourceId, plan, forced, true) !== null;
  });
}
