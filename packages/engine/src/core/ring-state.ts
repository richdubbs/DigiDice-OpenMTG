/**
 * MX3 (CR 701.54): reading the Ring's state and ending the Ring-bearer designation. A leaf module (types only) so the control
 * paths (core/control.ts, core/manual.ts) can call it without joining the core/manual <-> core/zones import cycle; the Ring tempting a player is core/ring.ts.
 */
import type { GameObject, GameState, RingState } from '../types/state';
import type { ObjectId, PlayerId } from '../types/ids';

/** A player's Ring state, or undefined when the Ring never tempted them. */
export function ringOf(s: GameState, player: PlayerId): RingState | undefined {
  return s.designations.ring?.[player];
}

/** How many times the Ring has tempted this player this game (CR 701.54c). */
export function timesTempted(s: GameState, player: PlayerId): number {
  return ringOf(s, player)?.tempted ?? 0;
}

/**
 * CR 701.54e: the player whose Ring-bearer this object is, or undefined: it must be on the battlefield (not phased out, CR 702.26b), under the control of that
 * player (`controller`, when the caller has computed it; by default the stored controller, which core/control.ts#syncControl keeps in step with layer 2), and the permanent that player chose last. Only its controller can have it.
 */
export function ringBearerPlayer(s: GameState, o: GameObject, controller?: PlayerId): PlayerId | undefined {
  const ring = s.designations.ring;
  if (ring === undefined || o.zone !== 'battlefield' || o.phasedOut || s.objects[o.id] !== o) return undefined;
  const p = controller ?? o.controller;
  return ring[p]?.bearer === o.id ? p : undefined;
}

/** The player's Ring-bearer now (CR 701.54e), or undefined. */
export function ringBearerOf(s: GameState, player: PlayerId): ObjectId | undefined {
  const id = ringOf(s, player)?.bearer;
  const o = id === undefined ? undefined : s.objects[id];
  return o !== undefined && ringBearerPlayer(s, o) === player ? id : undefined;
}

/**
 * CR 701.54a: the designation ends when another player gains control of the permanent. Called by every code path that changes a permanent's controller
 * (core/control.ts#syncControl, core/manual.ts). Getting control back later does not bring it back.
 */
export function ringControlChanged(s: GameState, id: ObjectId, to: PlayerId): void {
  const ring = s.designations.ring;
  if (ring === undefined) return;
  for (const [p, r] of Object.entries(ring)) if (r.bearer === id && p !== to) delete r.bearer;
}
