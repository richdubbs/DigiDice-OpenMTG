import { describe, expect, it } from 'vitest';
import { parseManaCost, randomInt, seedRng, type ManaSymbol, type ManaType } from '../../src/index';
import { alternativesOf, solve } from '../../src/rules/solver';
import type { Provider } from '../../src/rules/sources';

const cost = (text: string): ManaSymbol[] => parseManaCost(text)!;

function provider(id: number, options: string, opts: { snow?: boolean; cost?: number } = {}): Provider {
  return { id, options: options.split('') as ManaType[], snow: opts.snow ?? false, cost: opts.cost ?? 100 };
}

type Alt = ReturnType<typeof alternativesOf>[number];

/** Exhaustive search for the cheapest payment (the reference the solver is checked against). */
function brute(symbols: ManaSymbol[], providers: Provider[], life: number): number | null {
  const LIFE = 1e5;
  let best: number | null = null;
  const fits = (a: Alt['atoms'][number], p: Provider) => (!a.snow || p.snow) && (a.accept === null || a.accept.some((t) => p.options.includes(t)));
  const assign = (atoms: Alt['atoms'], i: number, used: Set<number>, total: number, lifeCost: number): void => {
    if (i === atoms.length) {
      const score = total + lifeCost;
      if (best === null || score < best) best = score;
      return;
    }
    providers.forEach((p, j) => {
      if (used.has(j) || !fits(atoms[i]!, p)) return;
      used.add(j);
      assign(atoms, i + 1, used, total + p.cost, lifeCost);
      used.delete(j);
    });
  };
  const pickAlt = (i: number, atoms: Alt['atoms'], lifeSpent: number, lifeSymbols: number): void => {
    if (i === symbols.length) {
      assign(atoms, 0, new Set(), 0, lifeSymbols * LIFE);
      return;
    }
    for (const alt of alternativesOf(symbols[i]!)) {
      if (lifeSpent + alt.life > life) continue;
      pickAlt(i + 1, [...atoms, ...alt.atoms], lifeSpent + alt.life, lifeSymbols + (alt.life > 0 ? 1 : 0));
    }
  };
  pickAlt(0, [], 0, 0);
  return best;
}

describe('payment solver (CR 601.2g-h, 107.4)', () => {
  it('pays an empty cost with nothing', () => {
    expect(solve({ symbols: [], providers: [], life: 20 })).toEqual({ used: [], lifeSymbols: [] });
  });

  it('CR 107.4a-b: colored and generic symbols; generic can use any type', () => {
    const sol = solve({ symbols: cost('{1}{G}'), providers: [provider(0, 'R'), provider(1, 'G')], life: 20 })!;
    expect(sol.used.map((u) => [u.providerId, u.type]).sort()).toEqual([[0, 'R'], [1, 'G']]);
    expect(solve({ symbols: cost('{G}{G}'), providers: [provider(0, 'R'), provider(1, 'G')], life: 20 })).toBeNull();
  });

  it('CR 107.4c: {C} needs colorless; CR 107.4e: {C/W} takes either', () => {
    expect(solve({ symbols: cost('{C}'), providers: [provider(0, 'G')], life: 20 })).toBeNull();
    expect(solve({ symbols: cost('{C/W}'), providers: [provider(0, 'W')], life: 20 })).not.toBeNull();
    expect(solve({ symbols: cost('{C/W}'), providers: [provider(0, 'C')], life: 20 })).not.toBeNull();
    expect(solve({ symbols: cost('{C/W}'), providers: [provider(0, 'G')], life: 20 })).toBeNull();
  });

  it('CR 107.4h: {S} only takes snow providers', () => {
    expect(solve({ symbols: cost('{S}'), providers: [provider(0, 'G')], life: 20 })).toBeNull();
    expect(solve({ symbols: cost('{S}'), providers: [provider(0, 'G'), provider(1, 'U', { snow: true })], life: 20 })!.used[0]!.providerId).toBe(1);
  });

  it('CR 107.4f: Phyrexian symbols use mana first and life only when needed, never more life than the player has', () => {
    expect(solve({ symbols: cost('{W/P}'), providers: [provider(0, 'W')], life: 20 })!.lifeSymbols).toEqual([]);
    expect(solve({ symbols: cost('{W/P}'), providers: [], life: 20 })!.lifeSymbols).toEqual([0]);
    expect(solve({ symbols: cost('{W/P}'), providers: [], life: 1 })).toBeNull(); // CR 119.4
    expect(solve({ symbols: cost('{W/P}{W/P}'), providers: [], life: 3 })).toBeNull();
    expect(solve({ symbols: cost('{W/P}{W/P}'), providers: [], life: 4 })!.lifeSymbols).toEqual([0, 1]);
    expect(solve({ symbols: cost('{G/W/P}'), providers: [provider(0, 'G')], life: 20 })!.lifeSymbols).toEqual([]);
  });

  it('forced life: the listed symbols are paid with life and the other Phyrexian symbols with mana', () => {
    const two = cost('{W/P}{W/P}');
    expect(solve({ symbols: two, providers: [provider(0, 'W')], life: 20, forceLife: new Set([1]) })!.lifeSymbols).toEqual([1]);
    expect(solve({ symbols: two, providers: [], life: 20, forceLife: new Set([1]) })).toBeNull(); // symbol 0 must be mana
  });

  it('CR 107.4e: {2/W} prefers one W over two generic mana, and falls back to two generic', () => {
    const w = solve({ symbols: cost('{2/W}'), providers: [provider(0, 'W'), provider(1, 'G'), provider(2, 'G')], life: 20 })!;
    expect(w.used).toHaveLength(1);
    const g = solve({ symbols: cost('{2/W}'), providers: [provider(1, 'G'), provider(2, 'G')], life: 20 })!;
    expect(g.used).toHaveLength(2);
    expect(solve({ symbols: cost('{2/W}'), providers: [provider(1, 'G')], life: 20 })).toBeNull();
  });

  it('prefers cheap providers: floating mana (cost 0) and inflexible sources before flexible ones', () => {
    const sol = solve({ symbols: cost('{G}'), providers: [provider(0, 'GR', { cost: 120 }), provider(1, 'G', { cost: 110 }), provider(2, 'G', { cost: 0 })], life: 20 })!;
    expect(sol.used[0]!.providerId).toBe(2);
    const sol2 = solve({ symbols: cost('{G}'), providers: [provider(0, 'GR', { cost: 120 }), provider(1, 'G', { cost: 110 })], life: 20 })!;
    expect(sol2.used[0]!.providerId).toBe(1);
  });

  it('a choice unit supplies the color the symbol needs', () => {
    const sol = solve({ symbols: cost('{R}{G}'), providers: [provider(0, 'WUBRG'), provider(1, 'G')], life: 20 })!;
    expect(sol.used.map((u) => [u.providerId, u.type]).sort()).toEqual([[0, 'R'], [1, 'G']]);
  });

  it('matches an exhaustive search on random small instances (feasibility and cost)', () => {
    const rng = seedRng('solver-fuzz');
    const SYMS = ['{1}', '{2}', '{W}', '{U}', '{B}', '{R}', '{G}', '{C}', '{W/U}', '{B/R}', '{G/W}', '{2/W}', '{2/G}', '{W/P}', '{U/P}', '{G/U/P}', '{S}', '{C/B}'];
    const OPTS = ['W', 'U', 'B', 'R', 'G', 'C', 'WU', 'BR', 'GW', 'WUBRG', 'CC'.slice(0, 1)];
    let feasible = 0;
    for (let n = 0; n < 400; n++) {
      const symbols = cost(Array.from({ length: 1 + randomInt(rng, 4) }, () => SYMS[randomInt(rng, SYMS.length)]!).join(''));
      const providers = Array.from({ length: randomInt(rng, 6) }, (_, i) =>
        provider(i, OPTS[randomInt(rng, OPTS.length)]!, { snow: randomInt(rng, 3) === 0, cost: randomInt(rng, 4) === 0 ? 0 : 100 + 10 * randomInt(rng, 4) }));
      const life = [0, 1, 2, 3, 4, 20][randomInt(rng, 6)]!;
      const want = brute(symbols, providers, life);
      const got = solve({ symbols, providers, life });
      expect(got === null, `case ${n}: ${JSON.stringify({ symbols, providers, life })}`).toBe(want === null);
      if (got && want !== null) {
        feasible++;
        // The solution must be valid: distinct providers, each atom accepted, life within limits...
        const ids = got.used.map((u) => u.providerId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(got.lifeSymbols.length * 2).toBeLessThanOrEqual(life);
        // ...and as cheap as the exhaustive optimum.
        const score = got.used.reduce((t, u) => t + providers[u.providerId]!.cost, 0) + got.lifeSymbols.length * 1e5;
        expect(score, `case ${n}`).toBe(want);
      }
    }
    expect(feasible).toBeGreaterThan(50); // the fuzz really exercised successful payments
  });
});
