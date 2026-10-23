/**
 * The entering object as it would exist on the battlefield (CR 614.12; m6 design 3.1.2). Owner: M6-1 (new file of W1).
 *
 * "Some replacement effects modify how a permanent enters the battlefield. To determine which replacement effects apply and how they apply, check the
 * characteristics of the permanent as it would exist on the battlefield, taking into account replacement effects that have already modified how it enters
 * the battlefield, continuous effects from the permanent's own static abilities that would apply to it once it's on the battlefield, and continuous effects
 * that already exist and would apply to the permanent" (CR 614.12). Patterns of the replacement effects of OTHER objects (Orb of Dreams' "Permanents enter
 * tapped", "creatures your opponents control enter tapped") are therefore matched against a hypothetical state in which the object already is on the
 * battlefield, under the player it would enter under, with the face it would enter with and the facts the enters parts of this chain decided (the copy part
 * adds its snapshot, the face-down part its profile, the transformed part the back face: effects/registries.ts#ENTERS_PARTS `hypothetical`).
 *
 * The hypothetical state is a copy (statics/hooks.ts#onBattlefield copies the object and the zone list it changes); the live state is never touched.
 */
import { Game } from '../core/game';
import type { Proposed } from './api';
import { enteringState } from './entering-state';

export { enteringState };

type ZoneChange = Extract<Proposed, { ev: 'zoneChange' }>;

/** Is this proposal a permanent entering the battlefield (from another zone, or a token being created, CR 111.1, 616.1g)? */
export const isEntering = (e: Proposed): e is ZoneChange => e.ev === 'zoneChange' && e.to === 'battlefield';

/**
 * A game over the hypothetical state, for reading patterns and conditions only (triggers/match.ts reads `g.s`). It never asks a decision and is thrown away;
 * `g` itself is returned for a proposal that is not an entering permanent.
 */
export function asItWouldEnter(g: Game, e: Proposed): Game {
  if (!isEntering(e)) return g;
  const alt = enteringState(g, e);
  return alt ? new Game(alt) : g;
}
