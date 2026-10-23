/**
 * The keyword actions manifest, cloak and manifest dread (CR 701.40, 701.58, 701.62; m6 design 3.4). Owner: M6-3. Each puts cards onto the battlefield face
 * down with a status a step list can't give (its profile and how it was put face down, which decide its characteristics and how it may be turned face up), so
 * they are native actions run by effects/handlers/face-ops.ts#FACE_NATIVES (through actions-native.ts#NATIVE_ACTIONS; `feature:action.native.<name>`).
 * Steps: `{op:'action', action:'manifest' | 'cloak', who, n?}` (the top N cards of `who`'s library, one at a time, CR 701.40e, 701.58e; `as` binds the new
 * permanents) and `{op:'action', action:'manifestDread', who}`.
 */
import type { ActionMacro } from '../types';

/** CR 701.40a: manifest the top card of a library: a face-down 2/2 creature. */
export const MANIFEST: ActionMacro = { name: 'manifest', rule: 'CR 701.40a', native: 'manifest' };
/** CR 701.58a: cloak the top card of a library: a face-down 2/2 creature with ward {2}. */
export const CLOAK: ActionMacro = { name: 'cloak', rule: 'CR 701.58a', native: 'cloak' };
/** CR 701.62a: look at the top two cards, manifest one, the rest into the graveyard. */
export const MANIFEST_DREAD: ActionMacro = { name: 'manifestDread', rule: 'CR 701.62a', native: 'manifestDread' };

export const FACE_DOWN_MACROS: readonly ActionMacro[] = [MANIFEST, CLOAK, MANIFEST_DREAD];
