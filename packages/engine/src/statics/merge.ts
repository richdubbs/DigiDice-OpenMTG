/**
 * Merged permanents (mutate, CR 702.140, 730; m6 design 3.7, E5, E16, E20). Owner: M6-9.
 *
 * A merged permanent is ONE object represented by more than one card or token (CR 730.2): `GameObject.components`, topmost first, where every component that
 * merged with the permanent records when (`Component.mergedAt`); the component the permanent was before any merge has none (the "original"). The object's
 * `defId`, `cardId` and `kind` are the topmost component's (CR 730.2a, 730.2d: core/resolve-parts/mutate.ts keeps them so).
 *
 *   mergeSteps           CR 730.2a, 613.7: the parts of a merged permanent's copiable effect, each with the timestamp of its merge. The latest merge that put a
 *                        component on top (if any: the original component may still be on top) makes the characteristics those of that component plus the
 *                        abilities of every component under it then ("over"). Each later merge put its component under: it changes nothing on top (CR
 *                        730.2c: a copy effect that began after the earlier merges keeps applying) and adds that component's abilities ("under", CR 702.140e).
 *   applyMerged          CR 730.2a, 702.140e: the characteristics after every part in timestamp order (`applyMergeStep`: after one part, the 1a applier). An
 *                        "under" part keeps the values the permanent has so far in layer 1 as they are (its printed abilities keep their keys and its link
 *                        store, and a copy effect that applied to it keeps applying: the merged permanent is still that copy) and adds the abilities printed
 *                        on its component; the "over" part replaces them by the topmost card's face. Keys and link namespaces (E5, E20): a component that
 *                        merged in has the abilities `c:merge@<object>@<mergedAt>:<face>:<index>` with links in the namespace `merge@<object>@<mergedAt>`;
 *                        the original component, when it is not on top, has `c:merge@<object>@base:...` with the bare link ids of the permanent's own store
 *                        (it is the same object, CR 730.2c). A face-down component has no abilities (CR 708.2a).
 *   MERGE_RULE_EFFECTS   rule-generated 1a effects, one per part of each merged permanent on the battlefield (statics/layers.ts#RULE_EFFECTS): copiable
 *                        effects with the timestamp of their merge (CR 730.2a, 613.2a, 613.7), applied by statics/copy.ts#LAYER_1A through `applyMergeStep`.
 *   MERGE_INTRINSIC      the same on the fast path (statics/layers.ts#intrinsicChars, E16: no layer source, so no other 1a effect exists); a face-down merged
 *                        permanent is the face-down profile there (CR 708.2a, 730.2e: the 1b effect applies after 1a on the layered path).
 *   mergedCopiable       CR 707.2, 730.2a: the copiable values of a merged permanent after one part (statics/copy.ts#copiableOrWhy interleaves the parts with
 *                        the other 1a effects): "over", the topmost component's values plus `alsoAbilitiesOf` the face-up components under it then; "under",
 *                        the values so far plus that component's abilities.
 *
 * Import rules (m6 design 4.4): types, keywords, statics, util and rules/base-chars only.
 */
import type { CardDef } from '../types/card';
import type { ObjectId } from '../types/ids';
import { manaValue } from '../types/mana';
import type { Component, CopiableValues, GameObject, GameState } from '../types/state';
import { costForManaValue, fromFace } from '../rules/base-chars';
import type { Chars } from '../rules/characteristics';
import { copiedAbilities, keywordsOfAbilities } from './abilities';
import type { CharAbility, LiveEffect } from './api';
import { hasFaceDownProfile } from './face-down';

/** The id prefix of the rule-generated merge effects (statics/copy.ts#LAYER_1A applies an effect with this prefix through `applyMergeStep`). */
export const MERGE_EFFECT_PREFIX = 'merge@';

/** The id of a merged permanent's "over" 1a effect (stable while it is the same object, CR 730.2c); an "under" part's id adds `#<mergedAt>`. */
export const mergeEffectId = (id: ObjectId): string => `${MERGE_EFFECT_PREFIX}${id}`;

/** Is this one of the rule-generated merge effects? */
export const isMergeEffect = (effectId: string | undefined): boolean => effectId !== undefined && effectId.startsWith(MERGE_EFFECT_PREFIX);

/** CR 730.2: an object some card or token merged with (a melded permanent's cards have no `mergedAt`: CR 712.4a is not a merge). */
export const isMergedObject = (o: GameObject): boolean => o.components !== undefined && o.components.some((c) => c.mergedAt !== undefined);

/** CR 730.2a, 613.7: the time of a merged permanent's latest merge. */
export const mergeTimestamp = (o: GameObject): number | undefined =>
  o.components?.reduce<number | undefined>((t, c) => (c.mergedAt === undefined ? t : Math.max(t ?? c.mergedAt, c.mergedAt)), undefined);

/** CR 730.2a: the time of a merged permanent's first merge (a copy effect that began after it may have replaced abilities a later merge does not give back). */
export const firstMergeTimestamp = (o: GameObject): number | undefined =>
  o.components?.reduce<number | undefined>((t, c) => (c.mergedAt === undefined ? t : Math.min(t ?? c.mergedAt, c.mergedAt)), undefined);

/** E20, CR 607: the link namespace of a component's abilities (null: the original component, which keeps the permanent's bare link ids). */
export const componentNamespace = (o: GameObject, c: Component): string | null => (c.mergedAt === undefined ? null : `${mergeEffectId(o.id)}@${c.mergedAt}`);

/** E5: the effect id in the keys of a component's abilities (`c:<this>:<face>:<index>`). */
const componentKeyId = (o: GameObject, c: Component): string => `${mergeEffectId(o.id)}@${c.mergedAt ?? 'base'}`;

/** A face index of `def` (clamped). */
const faceOf = (def: CardDef, face: number): number => Math.max(0, Math.min(face, def.faces.length - 1));

/** The abilities a component gives the merged permanent (CR 702.140e), keyed and namespaced (E5, E20). A face-down component has none (CR 708.2a). */
function componentAbilities(s: GameState, o: GameObject, c: Component): CharAbility[] {
  if (c.faceDown) return [];
  const def = s.defs[c.defId];
  if (!def || def.faces.length === 0) return [];
  return copiedAbilities(componentKeyId(o, c), fromFace(def.faces[0]!, 0), [], componentNamespace(o, c)); // its front face (CR 712.8a, 730.2i)
}

/**
 * CR 730.2a, 613.7: one part of a merged permanent's copiable effect. `under` is the component a merge put under (the part adds its abilities); without it, the
 * part of the latest merge that put a component on top (the topmost component's values).
 */
export interface MergeStep { id: string; at: number; under?: Component }

/** CR 730.2a, 702.140e: the parts of a merged permanent's copiable effect in timestamp order (none when it is not merged). */
export function mergeSteps(o: GameObject): MergeStep[] {
  const comps = o.components;
  if (!comps || !isMergedObject(o)) return [];
  const topAt = comps[0]!.mergedAt;
  const out: MergeStep[] = topAt === undefined ? [] : [{ id: mergeEffectId(o.id), at: topAt }];
  for (const c of comps.slice(1)) {
    if (c.mergedAt !== undefined && (topAt === undefined || c.mergedAt > topAt)) out.push({ id: `${mergeEffectId(o.id)}#${c.mergedAt}`, at: c.mergedAt, under: c });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The components that were under the topmost one when it was put on top (the original and the components of earlier merges). */
function underTopAt(comps: readonly Component[]): Component[] {
  const topAt = comps[0]!.mergedAt!;
  return comps.slice(1).filter((c) => c.mergedAt === undefined || c.mergedAt < topAt);
}

/** One part applied to `c`; `c` unchanged when a definition is missing (a view without it: core/view-parts/components.ts sends them). */
function applyStep(c: Chars, o: GameObject, s: GameState, step: MergeStep): Chars {
  const comps = o.components!;
  let out: Chars;
  if (step.under) {
    out = { ...c, abilities: [...c.abilities, ...componentAbilities(s, o, step.under)] }; // CR 730.2c: the values so far, as they are, plus its abilities
  } else {
    const top = comps[0]!;
    const def = s.defs[top.defId];
    if (!def || def.faces.length === 0) return c;
    const face = faceOf(def, o.face);
    const base = fromFace(def.faces[face]!, face);
    out = {
      name: base.name, names: base.names, face, combined: false, manaCost: base.manaCost, manaValue: manaValue(costForManaValue(def, face, base.manaCost), 0),
      colors: base.colors, supertypes: base.supertypes, types: base.types, subtypes: base.subtypes,
      abilities: copiedAbilities(componentKeyId(o, top), base, [], componentNamespace(o, top)),
      keywords: [], controller: c.controller, cantHave: c.cantHave,
    };
    for (const k of ['power', 'toughness', 'loyalty', 'defense'] as const) if (base[k] !== undefined) out[k] = base[k];
    for (const comp of underTopAt(comps)) out.abilities.push(...componentAbilities(s, o, comp));
  }
  out.keywords = keywordsOfAbilities(out.abilities);
  return out;
}

/** CR 730.2a, 702.140e: the characteristics `c` (the values the merged permanent has so far in layer 1) after every part of its merge effect, in order. */
export function applyMerged(c: Chars, o: GameObject, s: GameState): Chars {
  return mergeSteps(o).reduce((acc, step) => applyStep(acc, o, s, step), c);
}

/** The 1a applier of one rule-generated merge effect (statics/copy.ts#LAYER_1A): the part with this effect id; `c` unchanged when there is none. */
export function applyMergeStep(c: Chars, o: GameObject, s: GameState, effectId: string): Chars {
  const step = mergeSteps(o).find((x) => x.id === effectId);
  return step ? applyStep(c, o, s, step) : c;
}

/** CR 730.2a: the rule-generated copiable effect of one part of a merged permanent's merge effect (layer 1a, the timestamp of that merge). */
export function mergeEffect(o: GameObject, step: MergeStep): LiveEffect {
  return {
    id: step.id,
    source: { id: o.id, zone: o.zone },
    timestamp: step.at,
    controller: o.controller,
    effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: o.id, zone: o.zone }] }, mods: [{ layer: '1a', copyOf: { ref: 'fixed', objects: [] } }] },
  };
}

/** Every merged permanent's 1a effects (statics/layers.ts#RULE_EFFECTS spreads this). */
export const MERGE_RULE_EFFECTS: readonly ((s: GameState) => LiveEffect[])[] = [
  (s) => {
    const out: LiveEffect[] = [];
    for (const id of s.zones.battlefield) {
      const o = s.objects[id];
      if (o && isMergedObject(o)) for (const step of mergeSteps(o)) out.push(mergeEffect(o, step));
    }
    return out;
  },
];

/** E16: the fast path's part (applied after the face-down part, before counters). A face-down merged permanent is the profile (CR 708.2a, 730.2e). */
export const MERGE_INTRINSIC: readonly ((s: GameState, o: GameObject, c: Chars) => Chars)[] = [
  (s, o, c) => (o.zone === 'battlefield' && isMergedObject(o) && !hasFaceDownProfile(o) ? applyMerged(c, o, s) : c),
];

/**
 * CR 707.2, 730.2a: the copiable values `cv` (those of the permanent before this part, in 1a order) after one part of the merge effect: "over", the topmost
 * component's values plus the abilities of the face-up components under it then (`alsoAbilitiesOf`, with their front faces); "under", `cv` plus the abilities
 * of the component put under, if it is face up.
 */
export function mergedCopiable(o: GameObject, cv: CopiableValues, step: MergeStep): CopiableValues {
  const comps = o.components ?? [];
  if (comps.length === 0 || !isMergedObject(o)) return cv;
  if (step.under) {
    const add = step.under.faceDown ? [] : [{ defId: step.under.defId, face: 0 }];
    const also = [...(cv.alsoAbilitiesOf ?? []), ...add];
    return { ...cv, except: [...cv.except], ...(also.length > 0 ? { alsoAbilitiesOf: also } : {}) };
  }
  const others = underTopAt(comps).filter((c) => !c.faceDown).map((c) => ({ defId: c.defId, face: 0 }));
  return { defId: comps[0]!.defId, face: Math.max(0, o.face), except: [], ...(others.length > 0 ? { alsoAbilitiesOf: others } : {}) };
}
