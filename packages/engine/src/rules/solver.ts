/**
 * The mana payment solver: given the symbols of a cost (X already substituted) and the providers
 * (floating mana plus mana abilities), find the cheapest way to pay (CR 601.2g-h, 107.4).
 *
 * Model: every symbol becomes one or more alternatives; an alternative is a list of "atoms" (each
 * atom needs one unit of mana that is one of its accepted types) plus an amount of life.
 *   {W}            -> [W]
 *   {W/U}          -> [W or U]
 *   {2/W}          -> [W]  or  [any, any]
 *   {W/P}          -> [W]  or  2 life           (CR 107.4f)
 *   {S}            -> [any unit from a snow source]
 *   {2}            -> [any, any]
 * For each combination of alternatives the atoms are matched to providers as a minimum-cost
 * assignment (Hungarian algorithm), so feasibility is exact and the choice of sources is the
 * cheapest: floating mana first, then the least flexible sources. Combinations that pay life are
 * penalised so mana is always preferred (the auto-payer pays life only when mana cannot pay).
 */
import type { ManaSymbol, ManaType } from '../types/mana';
import type { Provider } from './sources';

interface Atom {
  /** Accepted types; null = any. */
  accept: ManaType[] | null;
  snow: boolean;
}

interface Alt {
  atoms: Atom[];
  life: number;
}

const any = (n: number, snow = false): Atom[] => Array.from({ length: n }, () => ({ accept: null, snow }));
const of = (...accept: ManaType[]): Atom => ({ accept, snow: false });

/** The ways to pay one symbol, in order of preference. X must already be substituted. */
export function alternativesOf(sym: ManaSymbol): Alt[] {
  switch (sym.kind) {
    case 'generic': return [{ atoms: any(sym.amount), life: 0 }];
    case 'colored': return [{ atoms: [of(sym.color)], life: 0 }];
    case 'colorless': return [{ atoms: [of('C')], life: 0 }];
    case 'hybrid': return [{ atoms: [of(sym.colors[0], sym.colors[1])], life: 0 }];
    case 'monoHybrid': return [{ atoms: [of(sym.color)], life: 0 }, { atoms: any(sym.generic), life: 0 }];
    case 'colorlessHybrid': return [{ atoms: [of('C', sym.color)], life: 0 }];
    case 'phyrexian': return [{ atoms: [of(sym.color)], life: 0 }, { atoms: [], life: 2 }];
    case 'hybridPhyrexian': return [{ atoms: [of(sym.colors[0], sym.colors[1])], life: 0 }, { atoms: [], life: 2 }];
    case 'snow': return [{ atoms: any(1, true), life: 0 }];
    case 'variable': throw new Error('The solver needs X substituted before payment');
  }
}

/** True for symbols that can be paid with life. */
export const isPhyrexian = (sym: ManaSymbol): boolean => sym.kind === 'phyrexian' || sym.kind === 'hybridPhyrexian';

export interface SolveInput {
  symbols: ManaSymbol[];
  providers: Provider[];
  /** The paying player's life total (CR 119.4 limits life payments). */
  life: number;
  /**
   * Symbol indices that MUST be paid with life; every other Phyrexian symbol must be paid with mana.
   * Omit to let the solver decide (mana preferred).
   */
  forceLife?: ReadonlySet<number>;
  /**
   * FAST5X E5 INTERFACE CHANGE (additive): symbol indices that are the mana cost of a filter ability the payment activates (rules/convert.ts); a provider with
   * `innerBan` can't pay them. Omit: every provider may pay every symbol, as before.
   */
  inner?: ReadonlySet<number>;
  /**
   * FAST5X E29 INTERFACE CHANGE (additive), CR 609.4b: "mana of any type can be spent to cast that spell": every atom accepts any type (snow is not a type:
   * a {S} still needs a snow source, CR 107.4h). Omit: the types the symbols ask for, as before.
   */
  anyType?: boolean;
  /** std-rx32 INTERFACE CHANGE (additive), CR 609.4b: "as though it were mana of any color": an atom that asks only for colors accepts any mana ({C} still needs colorless). */
  anyColor?: boolean;
}

export interface Solution {
  /** One entry per mana atom: which provider pays it and the type of mana it supplies. */
  used: { providerId: number; type: ManaType; symbol: number }[];
  /** Symbol indices paid with life. */
  lifeSymbols: number[];
}

const BIG = 1e7;
const LIFE_PENALTY = 1e5;
const MAX_COMBOS = 512;

/** Hungarian algorithm. cost is n x m with n <= m (1-indexed rows/cols are handled internally). Returns the column per row. */
function hungarian(cost: number[][], n: number, m: number): number[] {
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) { minv[j] = cur; way[j] = j0; }
        if (minv[j]! < delta) { delta = minv[j]!; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]!] = u[p[j]!]! + delta; v[j] = v[j]! - delta; } else minv[j] = minv[j]! - delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const colOfRow = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]! > 0) colOfRow[p[j]! - 1] = j - 1;
  return colOfRow;
}

function atomFits(a: Atom, pr: Provider): boolean {
  if (a.snow && !pr.snow) return false;
  return a.accept === null || a.accept.some((t) => pr.options.includes(t));
}

/** The type a provider supplies for an atom: the first accepted type it can make, else its first option. */
function supplied(a: Atom, pr: Provider): ManaType {
  if (a.accept) for (const t of a.accept) if (pr.options.includes(t)) return t;
  return pr.options[0]!;
}

function assign(atoms: { atom: Atom; symbol: number }[], providers: Provider[], inner?: ReadonlySet<number>): { total: number; used: Solution['used'] } | null {
  const n = atoms.length;
  if (n === 0) return { total: 0, used: [] };
  const m = providers.length;
  if (n > m) return null;
  const cost = atoms.map(({ atom, symbol }) => providers.map((pr) => (atomFits(atom, pr) && !(pr.innerBan && inner?.has(symbol)) ? pr.cost : BIG)));
  const cols = hungarian(cost, n, m);
  let total = 0;
  const used: Solution['used'] = [];
  for (let i = 0; i < n; i++) {
    const j = cols[i]!;
    if (j < 0 || cost[i]![j]! >= BIG) return null;
    total += cost[i]![j]!;
    const pr = providers[j]!;
    used.push({ providerId: pr.id, type: supplied(atoms[i]!.atom, pr), symbol: atoms[i]!.symbol });
  }
  return { total, used };
}

/** Find the cheapest payment, or null if the symbols cannot be paid. */
export function solve(input: SolveInput): Solution | null {
  const r = solveOneType(input);
  return r ? { used: r.used, lifeSymbols: r.lifeSymbols } : null;
}

type Scored = { score: number; used: Solution['used']; lifeSymbols: number[] };

/** At most this many combinations of types for the "any one color" sources are tried; the sources beyond keep their first candidate type. */
const MAX_TYPE_COMBOS = 64;

/**
 * PAY1: a source whose units must all be one type ("Add X mana of any one color", CR 106.1b; `Provider.source.oneType`) can't be expressed in the assignment,
 * which matches every unit on its own. So one type is fixed per such source and each combination is solved; the cheapest wins. The candidate types of a
 * source are the ones some symbol of the cost asks for, plus its first type (generic mana takes any type). Without such sources this is `solveFlat`.
 */
function solveOneType(input: SolveInput): Scored | null {
  const groups = new Map<string, ManaType[]>();
  for (const pr of input.providers) if (pr.source?.oneType && !groups.has(pr.source.objectId)) groups.set(pr.source.objectId, pr.options);
  if (groups.size === 0) return solveFlat(input);
  const asked = new Set<ManaType>();
  for (const sym of input.symbols) for (const alt of alternativesOf(sym)) for (const a of alt.atoms) for (const t of a.accept ?? []) asked.add(t);
  const ids = [...groups.keys()];
  const candidates = ids.map((id) => {
    const options = groups.get(id)!;
    return [...new Set([...options.filter((t) => asked.has(t)), options[0]!])];
  });
  let combos = 1;
  const limited = candidates.map((c, i) => {
    if (combos * c.length > MAX_TYPE_COMBOS) return [groups.get(ids[i]!)![0]!]; // its first type (pays generic mana); fewer payments found, never a wrong one
    combos *= c.length;
    return c;
  });
  let best: Scored | null = null;
  const pick: ManaType[] = [];
  const walk = (i: number): void => {
    if (i === ids.length) {
      const fixed = new Map(ids.map((id, k) => [id, pick[k]!]));
      const providers = input.providers.map((pr) => (pr.source?.oneType ? { ...pr, options: [fixed.get(pr.source.objectId)!] } : pr));
      const r = solveFlat({ ...input, providers });
      if (r && (!best || r.score < best.score)) best = r;
      return;
    }
    for (const t of limited[i]!) { pick[i] = t; walk(i + 1); }
  };
  walk(0);
  return best;
}

/** FAST5X E29 (CR 609.4b): the same alternative with every atom accepting mana of any type (a snow atom still needs a snow source). */
const anyTypeAlt = (a: Alt): Alt => ({ atoms: a.atoms.map((x) => ({ accept: null, snow: x.snow })), life: a.life });
/** std-rx32 (CR 609.4b): an atom that asks only for colored mana accepts mana of any type; colorless and generic atoms are unchanged. */
const COLOR_TYPES: ReadonlySet<string> = new Set(['W', 'U', 'B', 'R', 'G']);
const anyColorAlt = (a: Alt): Alt => ({ atoms: a.atoms.map((x) => (x.accept !== null && x.accept.length > 0 && x.accept.every((t) => COLOR_TYPES.has(t)) ? { accept: null, snow: x.snow } : x)), life: a.life });

/** `solve` with every provider's units matched on their own. */
function solveFlat(input: SolveInput): Scored | null {
  const { symbols, providers, life, forceLife } = input;
  const choices: Alt[][] = symbols.map((sym, i) => {
    const own = input.inner?.has(i) === true; // a filter ability's own cost keeps its types
    const alts = input.anyType === true && !own ? alternativesOf(sym).map(anyTypeAlt) : input.anyColor === true && !own ? alternativesOf(sym).map(anyColorAlt) : alternativesOf(sym);
    if (!isPhyrexian(sym)) return alts;
    if (forceLife) return forceLife.has(i) ? alts.filter((a) => a.life > 0) : alts.filter((a) => a.life === 0);
    return alts;
  });
  if (choices.some((c) => c.length === 0)) return null;

  // Enumerate combinations of alternatives (a handful of hybrid/Phyrexian symbols in practice).
  const combos: number[][] = [];
  const pick = new Array<number>(symbols.length).fill(0);
  const walk = (i: number): void => {
    if (combos.length >= MAX_COMBOS) return;
    if (i === symbols.length) { combos.push([...pick]); return; }
    for (let a = 0; a < choices[i]!.length; a++) { pick[i] = a; walk(i + 1); }
  };
  walk(0);

  let best: Scored | null = null;
  for (const combo of combos) {
    let lifeTotal = 0;
    const lifeSymbols: number[] = [];
    const atoms: { atom: Atom; symbol: number }[] = [];
    combo.forEach((a, i) => {
      const alt = choices[i]![a]!;
      if (alt.life > 0) { lifeTotal += alt.life; lifeSymbols.push(i); }
      for (const atom of alt.atoms) atoms.push({ atom, symbol: i });
    });
    if (lifeTotal > life) continue; // CR 119.4: a player can pay life only if their life total is at least the payment
    const r = assign(atoms, providers, input.inner);
    if (!r) continue;
    const score = r.total + lifeSymbols.length * LIFE_PENALTY;
    if (!best || score < best.score) best = { score, used: r.used, lifeSymbols };
  }
  return best;
}

/** What a solution costs the player: each floating unit at its price, each activated source once, whatever number of its units is used. */
export function trueCost(sol: Solution, providers: Provider[]): number {
  const activated = new Set<string>();
  let total = 0;
  for (const u of sol.used) {
    const pr = providers[u.providerId]!;
    if (!pr.source) total += pr.cost;
    else if (!activated.has(pr.source.objectId)) {
      activated.add(pr.source.objectId);
      total += pr.source.activationCost;
    }
  }
  return total;
}

/**
 * Like `solve`, but a source that makes several mana with one activation (Sol Ring) is priced once per activation, not once
 * per unit: {2} is paid by Sol Ring alone, while {1} is still paid by a land (Sol Ring would waste a mana). The assignment
 * problem can't express "pay once, use any number of units", so each such source is tried as a bundle: its units made nearly
 * free, accepted only when the solution uses all of its units (or none) and is really cheaper.
 */
export function solveBest(input: SolveInput): Solution | null {
  const base = solve(input);
  if (!base) return null;
  const bundles = new Map<string, number>();
  for (const pr of input.providers) if (pr.source && pr.source.unitCount >= 2) bundles.set(pr.source.objectId, pr.source.unitCount);
  let best = base;
  let bestCost = trueCost(base, input.providers);
  for (const [objectId, units] of bundles) {
    const cheap = input.providers.map((pr) => (pr.source?.objectId === objectId ? { ...pr, cost: 1 } : pr));
    const alt = solve({ ...input, providers: cheap });
    if (!alt || alt.lifeSymbols.length > best.lifeSymbols.length) continue;
    const used = alt.used.filter((u) => cheap[u.providerId]!.source?.objectId === objectId).length;
    if (used !== 0 && used !== units) continue;
    const cost = trueCost(alt, input.providers);
    if (cost < bestCost) { best = alt; bestCost = cost; }
  }
  return best;
}
