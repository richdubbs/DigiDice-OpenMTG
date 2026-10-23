/**
 * M15-2: the ledger's shared-place rule (design 8.2 check 9, 5.4, 17.4: validPlaces on every pattern of 2-4 players) and the ladder ids (3, 13.1).
 */
import { describe, expect, it } from 'vitest';
import { isLadderId, LADDER_IDS, validPlaces } from '@openmtg/ladder/api';

/** Every array of n values from `values`. */
function arrays(n: number, values: readonly number[]): number[][] {
  let out: number[][] = [[]];
  for (let k = 0; k < n; k += 1) out = out.flatMap((xs) => values.map((v) => [...xs, v]));
  return out;
}

/** The rule written another way: sorted, each place is the 1-based position of its first occurrence (a competition ranking). */
function competition(places: readonly number[]): boolean {
  const sorted = [...places].sort((a, b) => a - b);
  return sorted.every((p, k) => p === sorted.indexOf(p) + 1);
}

describe('M15-2: validPlaces (8.2)', () => {
  it("the design's examples: 1,2,3,3 and 1,2,2,4 and 1,1,3,4 pass; 1,2,2,3 fails; places are in seat order", () => {
    for (const ok of [[1, 2, 3, 3], [1, 2, 2, 4], [1, 1, 3, 4], [1, 1, 1, 4], [1, 1, 1, 1], [1, 2], [2, 1], [1, 1], [2, 4, 2, 1], [3, 1, 2, 4], [1, 2, 3], [1, 1, 3]]) {
      expect(validPlaces(ok), ok.join(',')).toBe(true);
    }
    for (const bad of [[1, 2, 2, 3], [1, 1, 2, 3], [2, 2], [1, 3], [1, 2, 4, 4], [2, 3, 4, 4], [1, 1, 1, 2], [1, 3, 3, 3]]) {
      expect(validPlaces(bad), bad.join(',')).toBe(false);
    }
  });

  it('every pattern of 2, 3 and 4 players (values 0-5): exactly the competition rankings, 3, 13 and 75 of them (the weak orders)', () => {
    const counts: number[] = [];
    for (const n of [2, 3, 4]) {
      const all = arrays(n, [0, 1, 2, 3, 4, 5]);
      for (const places of all) {
        const want = places.every((p) => p >= 1 && p <= n) && competition(places);
        expect(validPlaces(places), places.join(',')).toBe(want);
      }
      counts.push(all.filter((p) => validPlaces(p)).length);
    }
    expect(counts).toEqual([3, 13, 75]);
  });

  it('false for fewer than 2 or more than 4 players, and for anything that is not whole numbers', () => {
    for (const bad of [[], [1], [1, 2, 3, 4, 5], [1, 1, 1, 1, 1], [1, 1.5], [1, Number.NaN], [1, '2'], ['1', '1'], null, undefined, '12', { length: 2 }]) {
      expect(validPlaces(bad as unknown as number[]), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('M15-2: isLadderId (3)', () => {
  it('true for the four ladders and nothing else: not the reserved best-of-three ids, other cases, inherited names or other types', () => {
    for (const id of LADDER_IDS) expect(isLadderId(id), id).toBe(true);
    expect(LADDER_IDS).toEqual(['1v1-standard', '1v1-pioneer', '1v1-pauper', 'pod-commander']);
    for (const bad of ['1v1-standard-bo3', '1v1-pioneer-bo3', '1v1-pauper-bo3', '1V1-STANDARD', ' 1v1-standard', 'standard', 'commander', '', 'toString', '__proto__', 'constructor', 'length', null, undefined, 1, {}, ['1v1-standard']]) {
      expect(isLadderId(bad), String(bad)).toBe(false);
    }
  });
});
