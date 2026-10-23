/**
 * M15-2: the ledger's shared-place rule (design 8.2 check 9, 5.4, m13 7, 13.1). Browser-safe: no `node:` imports, here or in anything this file
 * imports. Exposed only through the named re-export in ../api.ts.
 * Imports: values only from ./constants or files of this part's own; from ../api types only (`import type`). ../api re-exports this file, so a value
 * taken from ../api would be undefined while the contract loads (a cycle; test/m15-1/load.test.ts refuses one).
 */

/**
 * The ledger's shared-place rule: each place is 1 + the number of players strictly ahead (1,2,3,3 and 1,2,2,4 and 1,1,3,4 pass; 1,2,2,3 fails).
 * Also false for anything that is not 2-4 integers from 1 to the player count. The places are in seat order: (2, 1) and (2, 4, 2, 1) pass too.
 */
export function validPlaces(places: readonly number[]): boolean {
  if (!Array.isArray(places)) return false;
  const n = places.length;
  if (n < 2 || n > 4) return false;
  for (const p of places) if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > n) return false;
  return places.every((p) => p === 1 + places.filter((q) => q < p).length);
}
