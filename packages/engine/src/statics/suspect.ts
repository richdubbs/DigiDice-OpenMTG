/**
 * The suspected designation in the layer system (FAST5X E12, CR 701.60). Owner: FAST5X E12.
 *
 *   CR 701.60b  Suspected is a designation of a permanent (`GameObject.suspected`, set and cleared only by effects/handlers/levels.ts); it is neither an
 *               ability nor a copiable value, so nothing here touches layer 1.
 *   CR 701.60c  "A suspected permanent has menace and 'This creature can't block' for as long as it's suspected": one rule-generated layer 6 effect per
 *               suspected permanent on the battlefield adds those two abilities (`SUSPECT_RULE_EFFECTS`, spread into statics/layers.ts#RULE_EFFECTS). Its
 *               timestamp is the one the permanent got when it became suspected (CR 613.7), so an effect that makes it lose all abilities with a later
 *               timestamp removes them while it stays suspected, and one with an earlier timestamp does not. The two abilities are ordinary data: menace is
 *               the keyword (CR 702.111b, read where blocks are declared) and "can't block" is a static restriction of the creature itself (CR 509.1a,
 *               the rule hooks of statics/hooks.ts, which collect granted abilities in a layered state).
 *   CR 701.60a  It ends when the permanent leaves the battlefield (a new object, CR 400.7) or an effect makes it no longer suspected; a control change keeps it.
 *
 * `suspectedPresent` tells statics/live.ts#layerSourcesPresent and statics/rule-sources.ts#ruleSourcesPresent that such an effect exists, so the fast paths
 * (no layer source, no rule source) are never taken while a permanent is suspected.
 *
 * Import rules (m6 design 4.4): types, keywords, statics, util and rules/base-chars only.
 */
import type { AbilityDef } from '../types/ability';
import type { GameObject, GameState } from '../types/state';
import type { LiveEffect } from './api';

/** CR 701.60c: the two abilities a suspected permanent has. Shared, immutable data (the keyword library's memos key on the objects). */
export const SUSPECTED_ABILITIES: readonly AbilityDef[] = Object.freeze([
  Object.freeze({ kind: 'keyword', keyword: 'menace', text: 'Menace' }) as AbilityDef,
  Object.freeze({
    kind: 'static',
    text: '~ can\'t block.',
    effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'block' }],
  }) as AbilityDef,
]);

/** Is this object a suspected permanent (CR 701.60b: only permanents; a phased-out one is treated as though it doesn't exist, CR 702.26b)? */
export const isSuspected = (o: GameObject | undefined): boolean => o !== undefined && o.zone === 'battlefield' && o.suspected !== undefined && !o.phasedOut;

/** Is any permanent suspected (statics/live.ts#layerSourcesPresent, statics/rule-sources.ts#ruleSourcesPresent)? */
export function suspectedPresent(s: GameState): boolean {
  for (const id of s.zones.battlefield) if (s.objects[id]?.suspected !== undefined) return true;
  return false;
}

/** CR 701.60c, 613.1f: the rule-generated layer 6 effect of one suspected permanent. */
export function suspectedEffect(o: GameObject): LiveEffect {
  return {
    id: `susp:${o.id}`,
    source: { id: o.id, zone: o.zone },
    timestamp: o.suspected ?? o.timestamp,
    controller: o.controller,
    effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: o.id, zone: o.zone }] }, mods: [{ layer: 6, add: [...SUSPECTED_ABILITIES] }] },
  };
}

/** Every suspected permanent's layer 6 effect (statics/layers.ts#RULE_EFFECTS spreads this). */
export const SUSPECT_RULE_EFFECTS: readonly ((s: GameState) => LiveEffect[])[] = [
  (s) => {
    const out: LiveEffect[] = [];
    for (const id of s.zones.battlefield) {
      const o = s.objects[id];
      if (o && isSuspected(o)) out.push(suspectedEffect(o));
    }
    return out;
  },
];
