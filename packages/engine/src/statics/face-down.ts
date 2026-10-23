/**
 * Face-down spells and permanents, layer 1b (CR 708, 613.2b; m6 design 3.4, D6, E6, E16). Owner: M6-3.
 *
 *   LAYER_1B                 the layer 1b applier: every characteristic of the object is replaced by its face-down profile (CR 708.2a, 613.2b): a 2/2
 *                            creature with no name, subtypes, mana cost, color or abilities; the `ward2` profile (disguise CR 702.168a, cloak CR 701.58a) adds
 *                            ward {2}. Applied after layer 1a (CR 708.10: a face-down permanent that becomes a copy stays a face-down 2/2).
 *   FACE_DOWN_RULE_EFFECTS   one rule-generated 1b effect per face-down permanent or spell (battlefield or stack only; a card exiled face down has no
 *                            characteristics at all, CR 406.3a, rules/base-parts/face-down.ts), its timestamp the object's (CR 613.7f gives the object a new one
 *                            when it turns face down or up).
 *   FACE_DOWN_INTRINSIC      the same profile on the fast path (statics/layers.ts#intrinsicChars, E16: no layer source in the state, so no 1a effect exists and
 *                            the profile is exactly all of layer 1 there).
 *
 * The profile's ward is a RULE ability of the object (`r:facedown:ward`, its expansion `r:facedown:ward:<n>`): never a printed key, which would be resolved through
 * the hidden card's definition (rules/abilities.ts#abilityDefOnStack); a rule-origin trigger carries its definition inline on the stack (triggers/stack.ts).
 * `faceUpHypothetical` (statics/api.ts#FaceUpHypothetical) needs the characteristics function, which statics may not import: it lives in
 * core/special/turn-face-up.ts.
 *
 * Import rules (m6 design 4.4): types, keywords, statics, util and rules/base-chars only.
 */
import type { FaceDownProfile, KeywordAbilityDef, Modification } from '../types/ability';
import type { Chars } from '../rules/characteristics';
import type { GameObject, GameState } from '../types/state';
import type { ApplyMods, CharAbility, LiveEffect } from './api';
import { expansionOf, keywordsOfAbilities } from './abilities';

/** CR 708.2a, 613.2b: a face-down permanent or spell has the profile (cards exiled face down have none: rules/base-parts/face-down.ts). */
export const hasFaceDownProfile = (o: GameObject): boolean => o.faceDown && o.kind !== 'ability' && (o.zone === 'battlefield' || o.zone === 'stack');

/** The profile of a face-down permanent or spell (CR 708.2a; 'ward2': CR 702.168a, 701.58a). An object put face down with no recorded status is plain. */
export const profileOf = (o: GameObject): FaceDownProfile => o.faceDownInfo?.profile ?? 'plain';

/** CR 702.21a: the ward {2} of the `ward2` profile (the same keyword ability as the pseudo-definition `__facedown_ward2__`, core/create.ts). */
export const FACE_DOWN_WARD: KeywordAbilityDef = { kind: 'keyword', keyword: 'ward', text: 'Ward {2}', cost: { mana: [{ kind: 'generic', amount: 2 }] } };

/** The key of the profile's ward ability (a rule ability of the face-down object). */
export const FACE_DOWN_WARD_KEY = 'r:facedown:ward';

const PROFILE_ABILITIES = new Map<FaceDownProfile, readonly CharAbility[]>();

/** The abilities a profile gives (computed once: the keyword library does not change while the process runs, statics/layers.ts). Shared, immutable data. */
function profileAbilities(profile: FaceDownProfile): readonly CharAbility[] {
  let out = PROFILE_ABILITIES.get(profile);
  if (out) return out;
  const list: CharAbility[] = [];
  if (profile === 'ward2') {
    list.push({ key: FACE_DOWN_WARD_KEY, origin: 'rule', face: 0, index: -1, def: FACE_DOWN_WARD });
    expansionOf(FACE_DOWN_WARD, { granted: false, faceName: '', types: ['Creature'], keyPrefix: FACE_DOWN_WARD_KEY }).forEach((def, n) =>
      list.push({ key: `${FACE_DOWN_WARD_KEY}:${n}`, origin: 'rule', face: 0, index: -1, def, parent: FACE_DOWN_WARD_KEY }));
  }
  out = Object.freeze(list);
  PROFILE_ABILITIES.set(profile, out);
  return out;
}

/**
 * The characteristics of a face-down permanent or spell (CR 708.2a): everything is replaced. Its controller is layer 2's business (later) and what it "can't
 * have" comes from layer 6 (later), so both are kept. Every array is the caller's own (design 4.3, hazards 2-3).
 */
export function faceDownChars(c: Pick<Chars, 'controller' | 'cantHave'>, profile: FaceDownProfile): Chars {
  const abilities = profileAbilities(profile).slice();
  return {
    name: '', names: [], face: 0, combined: false, manaCost: null, manaValue: 0, colors: [], supertypes: [], types: ['Creature'], subtypes: [],
    power: '2', toughness: '2', abilities, keywords: keywordsOfAbilities(abilities), cantHave: [...c.cantHave], controller: c.controller,
  };
}

/** The profile a 1b effect applies: the effect's own, else the modification's, else plain. */
function profileIn(mods: readonly Modification[], fx: FaceDownProfile | undefined): FaceDownProfile {
  if (fx) return fx;
  for (const m of mods) if (m.layer === '1b') return m.profile ?? 'plain';
  return 'plain';
}

/** CR 613.2b, 708.2a: the layer 1b applier (m6 design 2.5): the profile replaces every characteristic. */
export const LAYER_1B: ApplyMods | null = (c, mods, _subject, _s, _all, fx) => faceDownChars(c, profileIn(mods, fx?.faceDown));

/** CR 708.2a, 613.7f: the rule-generated 1b effect of one face-down permanent or spell. */
export function faceDownEffect(o: GameObject): LiveEffect {
  const profile = profileOf(o);
  return {
    id: `fd:${o.id}`,
    source: { id: o.id, zone: o.zone },
    timestamp: o.timestamp,
    controller: o.controller,
    faceDown: profile,
    effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: o.id, zone: o.zone }] }, mods: [{ layer: '1b', faceDown: true, profile }] },
  };
}

/** Every face-down permanent and spell's 1b effect (statics/layers.ts#RULE_EFFECTS spreads this). */
export const FACE_DOWN_RULE_EFFECTS: readonly ((s: GameState) => LiveEffect[])[] = [
  (s) => {
    const out: LiveEffect[] = [];
    for (const zone of [s.zones.battlefield, s.zones.stack]) {
      for (const id of zone) {
        const o = s.objects[id];
        if (o && hasFaceDownProfile(o)) out.push(faceDownEffect(o));
      }
    }
    return out;
  },
];

/** E16: the fast path's part (no layer source in the state, so the profile is all of layer 1): applied after the base and before counters. */
export const FACE_DOWN_INTRINSIC: readonly ((s: GameState, o: GameObject, c: Chars) => Chars)[] = [
  (_s, o, c) => (hasFaceDownProfile(o) ? faceDownChars(c, profileOf(o)) : c),
];
