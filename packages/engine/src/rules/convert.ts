/**
 * FAST5X E5: payments that activate filter abilities (CR 605.3a, 605.3b, 601.2g-h). A filter ability is a mana ability with a mana cost ("{1}, {T}: Add one
 * mana of any color", "{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}", Signets; rules/mana.ts#manaCostShape `converter`): its controller may activate it while paying
 * a cost (CR 605.3a), paying its own mana cost first (CR 602.2b, 601.2g-h) with mana from the pool or from other mana abilities activated for it.
 *
 * The planner tries the filter abilities as additions to an ordinary payment: for each set of them (smallest sets first, at most MAX_CONVERTERS abilities
 * considered, each object once), their mana costs become extra symbols of the payment (`SolveInput.inner`) and the mana they add becomes extra providers that
 * may pay only the cost being paid, never a filter ability's cost (`Provider.innerBan`). So no filter ability pays for itself (CR 605.3c) or for another
 * one: the plan has one order, ordinary sources first, then each filter ability, and every check is a finite number of solver calls. The cheapest plan in
 * which every filter ability used adds mana the cost spends wins; ties go to the set tried first (battlefield order), so the plan is deterministic. A payment
 * that would need a filter ability to pay another one is not found (fewer payments found, never a wrong one): the player can still activate them by hand.
 */
import type { ManaRestriction } from '../types/ability';
import type { ObjectId } from '../types/ids';
import type { ManaSymbol, ManaType } from '../types/mana';
import { solveBest, trueCost, type Solution } from './solver';
import { buildProviders, type ManaConverter, type ManaSource, type Provider } from './sources';

/** At most this many filter abilities are considered for one payment (2^4 sets); the ones after them in battlefield order are left to the player. */
export const MAX_CONVERTERS = 4;

type PoolUnit = { type: ManaType; snow?: boolean; restriction?: ManaRestriction; sourceId?: ObjectId };

export interface ConverterPlan {
  /** The solution over `providers`; symbol indices from `symbols.length` on are the filter abilities' costs. */
  solution: Solution;
  providers: Provider[];
  /** The filter abilities activated, in the order they are activated, each with the symbol indices of its cost. */
  converters: { converter: ManaConverter; symbols: number[] }[];
}

export interface ConvertInput {
  symbols: ManaSymbol[];
  sources: readonly ManaSource[];
  pool: readonly PoolUnit[];
  converters: readonly ManaConverter[];
  life: number;
  forceLife?: ReadonlySet<number>;
  onlyPool?: ReadonlySet<number>;
  allows?: (r: ManaRestriction, manaSource: ObjectId | undefined) => boolean;
  /** FAST5X E29 (CR 609.4b): mana of any type may pay the symbols of the cost being paid (not the filter abilities' own costs). */
  anyType?: boolean;
  anyColor?: boolean; // std-rx32 (CR 609.4b)
}

/** Every set of indices 0..n-1 (n <= MAX_CONVERTERS), non-empty, smallest first, then in index order. */
function subsets(n: number): number[][] {
  const out: number[][] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const set: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) set.push(i);
    out.push(set);
  }
  return out.sort((a, b) => a.length - b.length || a.join(',').localeCompare(b.join(',')));
}

/** The cheapest payment of `symbols` that activates at least one filter ability, or null. Callers try the ordinary payment (no filter ability) first. */
export function solveWithConverters(input: ConvertInput): ConverterPlan | null {
  // one ability per object: two abilities of one object would both need its {T} (and a filter ability can't be activated during its own activation, CR 605.3c)
  const seen = new Set<ObjectId>();
  const usable = input.converters.filter((c) => (seen.has(c.objectId) ? false : (seen.add(c.objectId), true))).slice(0, MAX_CONVERTERS);
  if (usable.length === 0) return null;
  // Mana with a spending restriction was allowed for the spell or ability being paid, not for a filter ability's cost (CR 106.6): floating restricted mana,
  // and the units of a source any of whose offered abilities adds restricted mana. A source whose units merge a restricted and an unrestricted ability
  // ("{T}: Add {C}" and "{T}: Add one mana of any color. Spend this mana only to cast a creature spell.") is banned as a whole: fewer payments found, never a
  // wrong one (the player can activate it by hand).
  const modesOf = new Map(input.sources.map((src) => [src.objectId, src.modes]));
  const restricted = (pr: Provider): boolean => {
    if (pr.poolIndex !== undefined) return input.pool[pr.poolIndex]?.restriction !== undefined;
    if (!pr.source) return false;
    const keys = new Set(Object.values(pr.source.keyFor));
    return (modesOf.get(pr.source.objectId) ?? []).some((m) => keys.has(m.key) && m.restriction !== undefined);
  };
  let best: { plan: ConverterPlan; cost: number } | null = null;
  for (const set of subsets(usable.length)) {
    const chosen = set.map((i) => usable[i]!);
    const ids = new Set(chosen.map((c) => c.objectId));
    const providers = buildProviders(input.sources.filter((src) => !ids.has(src.objectId)), input.pool, input.onlyPool, input.allows)
      .map((pr) => (restricted(pr) ? { ...pr, innerBan: true as const } : pr));
    const symbols = [...input.symbols];
    const converters: ConverterPlan['converters'] = [];
    for (const c of chosen) {
      const own: number[] = [];
      for (const sym of c.cost) { own.push(symbols.length); symbols.push(sym); }
      converters.push({ converter: c, symbols: own });
      c.units.forEach((options, unitIndex) => {
        providers.push({
          id: providers.length, options, snow: c.snow, cost: c.price, innerBan: true,
          source: {
            objectId: c.objectId, keyFor: Object.fromEntries(options.map((t) => [t, c.key])), unitCount: c.units.length, activationCost: c.price, unitIndex,
            allOptions: c.units, ...(c.oneType ? { oneType: true } : {}),
          },
        });
      });
    }
    const inner = new Set<number>();
    for (let i = input.symbols.length; i < symbols.length; i++) inner.add(i);
    const solution = solveBest({ symbols, providers, life: input.life, inner, ...(input.forceLife ? { forceLife: input.forceLife } : {}), ...(input.anyType ? { anyType: true } : {}), ...(input.anyColor ? { anyColor: true } : {}) });
    if (!solution) continue;
    // every filter ability of the set adds mana the cost being paid spends; otherwise a smaller set pays the same way, cheaper
    const spends = (c: ManaConverter): boolean => solution.used.some((u) => u.symbol < input.symbols.length && providers[u.providerId]!.source?.objectId === c.objectId);
    if (!chosen.every(spends)) continue;
    const cost = trueCost(solution, providers) + chosen.reduce((n, c) => n + c.cost.length, 0);
    if (!best || cost < best.cost) best = { plan: { solution, providers, converters }, cost };
  }
  return best?.plan ?? null;
}

/** The types of mana a plan spends on the cost of one filter ability (its `payWith`, rules/mana.ts#ActivateOptions), in symbol order. */
export function payWithOf(plan: ConverterPlan, symbols: readonly number[]): ManaType[] {
  const own = new Set(symbols);
  return plan.solution.used.filter((u) => own.has(u.symbol)).sort((a, b) => a.symbol - b.symbol || a.providerId - b.providerId).map((u) => u.type);
}
