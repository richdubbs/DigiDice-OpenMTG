/**
 * Hone counters in the layer system (std-ra). Owner: std-ra.
 *
 *   CR 122.1   Some kinds of counters have rules of their own. A hone counter is one (The Hobbit, reminder text "Each hone counter on an Equipment grants
 *              +1/+0 to equipped creature."): for each hone counter on an Equipment, the creature it is attached to gets +1/+0. One rule-generated layer 7c
 *              effect per Equipment on the battlefield with hone counters on it (`HONE_RULE_EFFECTS`, spread into statics/layers.ts#RULE_EFFECTS), with that
 *              Equipment's timestamp (CR 613.7; the engine keeps no timestamp per counter, as statics/live.ts#counterMods). It affects the object the
 *              Equipment is attached to as the attachments are now (CR 301.5, 611.3a), so moving the Equipment moves the bonus.
 *   CR 613.4c  A change of power from counters is applied in layer 7c; the changes are additions, so their order among the other 7c effects is not observable.
 *
 * Whether the object is an Equipment is read from its base characteristics (rules/base-chars): the standing effects of the layer system do not depend on
 * characteristics (statics/layers.ts#standingEffects). Hone counters on anything else do nothing. `honePresent` tells statics/live.ts#layerSourcesPresent that
 * such an effect exists, so the fast path (no layer source) is never taken while one does.
 *
 * Cites from memory (the cloud checkout has no rules/cr/): unverified.
 *
 * Import rules (m6 design 4.4): types, statics and rules/base-chars only.
 */
import type { GameObject, GameState } from '../types/state';
import { baseChars } from '../rules/base-chars';
import type { LiveEffect } from './api';

/** The counter kind; `counter:hone` is registered by model/capabilities.ts from this list. */
export const HONE_COUNTER_KINDS: readonly string[] = Object.freeze(['hone']);

/** An Equipment on the battlefield (not phased out, CR 702.26b) with one or more hone counters on it, attached to something. */
function honing(s: GameState, o: GameObject | undefined): o is GameObject {
  if (o === undefined || o.zone !== 'battlefield' || o.phasedOut || (o.counters['hone'] ?? 0) <= 0 || o.attachedTo === undefined) return false;
  return baseChars(s, o).subtypes.includes('Equipment');
}

/** Does any Equipment have hone counters (statics/live.ts#layerSourcesPresent)? Counters are read, not memoized: putting one takes no timestamp. */
export function honePresent(s: GameState): boolean {
  for (const id of s.zones.battlefield) {
    const o = s.objects[id];
    if (o !== undefined && (o.counters['hone'] ?? 0) > 0 && honing(s, o)) return true;
  }
  return false;
}

/** CR 122.1, 613.4c: the layer 7c effect of one Equipment's hone counters on the creature it is attached to. */
export function honeEffect(o: GameObject): LiveEffect {
  const n = o.counters['hone'] ?? 0;
  return {
    id: `hone:${o.id}`,
    source: { id: o.id, zone: o.zone },
    timestamp: o.timestamp,
    controller: o.controller,
    effect: { s: 'continuous', affects: { ref: 'each', filter: { attachedToSource: true } }, mods: [{ layer: '7c', power: n, toughness: 0 }] },
  };
}

/** Every honed Equipment's layer 7c effect (statics/layers.ts#RULE_EFFECTS spreads this). */
export const HONE_RULE_EFFECTS: readonly ((s: GameState) => LiveEffect[])[] = [
  (s) => {
    const out: LiveEffect[] = [];
    for (const id of s.zones.battlefield) {
      const o = s.objects[id];
      if (honing(s, o)) out.push(honeEffect(o));
    }
    return out;
  },
];
