/**
 * M15-2: the ladder ids (design 3, 13.1). Browser-safe: no `node:` imports, here or in anything this file imports. Exposed only through the named
 * re-export in ../api.ts.
 * Imports: values only from ./constants (LADDER_IDS, LADDERS, ...) or files of this part's own; from ../api types only (`import type`). ../api
 * re-exports this file, so a value taken from ../api would be undefined while the contract loads (a cycle; test/m15-1/load.test.ts refuses one).
 */
import type { LadderId } from '../api';
import { LADDER_IDS } from './constants';

/** True for one of LADDER_IDS (a hosted message's `ladder` is checked with it, 13.6): the exact string, nothing inherited, nothing reserved yet. */
export function isLadderId(x: unknown): x is LadderId {
  return typeof x === 'string' && (LADDER_IDS as readonly string[]).includes(x);
}
