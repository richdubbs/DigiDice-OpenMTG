/**
 * Copy effects, layer 1a (CR 707, 613.2a-c; m6 design 3.3). Owner: M6-2.
 *
 *   copiableValuesOf  CR 613.2c, 707.2-707.3: the copiable values of an object now, ALL of layer 1: its own face (a flip card's half is chosen later, by the
 *                     AFFECTED object's flip status), then the 1a effects that apply to it in the order layer 1a applies them, then, for a face-down permanent or
 *                     spell, the face-down profile (CR 708.2, 708.10: the pseudo-definition, never the hidden card). `copiableOrWhy` says why an object can't be
 *                     copied exactly by this build.
 *   concreteSnapshot  CR 707.9: a copy effect's exceptions made concrete as it begins: `retain` materialized from the copy's own values (707.9c), `if` judged on
 *                     the result without it (707.9f), the copied characteristic-defining abilities an exception overrides recorded in `dropCda` (707.9d).
 *   LAYER_1A          the layer 1a applier (statics/layers.ts#LAYER_TABLE): a copy effect's snapshot replaces the characteristics (CR 707.2), a flip card's half is
 *                     chosen by the affected object's flip status (CR 707.3 Tomoya example, 710.1b-c), the exceptions are applied as part of 1a (CR 707.9b).
 *                     Copied abilities are keyed `c:<effectId>:<face>:<index>` (statics/abilities.ts#copiedAbilities, E5) with their links in the copy
 *                     effect's namespace (E20, CR 707.7).
 *   isCopyPermanent   CR 707.1: a 1a copy effect applies to this permanent (rules/filter.ts#isCopy).
 *   copyRecord        the stored record of a copy effect (CR 611.2, 613.7): written by effects/copy.ts and core/move-parts/copy.ts.
 *
 * Why the 1a order here is timestamp order (CR 613.7) without the dependency check of `computeAll`: every 1a effect this build stores has a fixed affected set
 * and a fixed snapshot (CR 611.2c, 707.2b), so applying one can never change whether another exists, what it applies to or what it does (CR 613.8a); timestamp
 * order is then exactly the order `order1a` gives. (statics/layers.ts imports this module, so `order1a` can't be called from here.)
 *
 * Not done here (fail closed elsewhere): a static ability's copy effect (CR 707.2c, `feature:copy.static`, unregistered); the P/T-setting "as enters" records
 * (`asEntry`, CR 613.2a: read into the copiable values when present, but no handler writes one and `feature:copy.asEntersPT` stays unregistered); copying a split
 * card outside the stack (M6-6: `copiableOrWhy` refuses it; a prototyped object is copied with its prototype characteristics since the wave 3 merge, CR 718.3d; a melded one is copied since M6-4, CR 712.8g; a merged one since M6-9,
 * CR 730.2a: its copiable effect is statics/merge.ts's, applied here through `applyMergeStep`).
 *
 * Import rules (m6 design 4.4): GameState-level pure functions only; statics may value-import types, keywords, statics, util and rules/base-chars.
 */
import type { AbilityDef, CopyExcept, Modification, ObjectFilter } from '../types/ability';
import { FACE_DOWN_DEF_IDS, type CardDef } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import { manaValue } from '../types/mana';
import type { CopiableValues, ContinuousEffectRec, GameObject, GameState } from '../types/state';
import { costForManaValue, faceIndexOf, fromFace, hasSharedTypeLine, prototypeChars } from '../rules/base-chars';
import type { BaseChars, Chars } from '../rules/characteristics';
import { copiedAbilities, keywordsOfAbilities } from './abilities';
import type { ApplyMods, LiveEffect } from './api';
import { numOf, resolvedEffects } from './live';
import { filterMatches } from './match';
import { applyMods } from './mods';
import { applyMergeStep, isMergeEffect, isMergedObject, mergedCopiable, mergeSteps } from './merge';

type Characteristic = NonNullable<CopiableValues['dropCda']>[number];

/**
 * The id of the copy effect effects/enters-parts/copy.ts#hypothetical writes on the object `asItWouldEnter` builds (CR 614.12): a choice an "as enters" ability
 * of the copy makes there is stored under this link namespace, which core/move-parts/copy.ts renames to the real copy effect's (E20).
 */
export const HYPOTHETICAL_COPY = 'copy?';

// ---- copiable values (CR 613.2c, 707.2-707.3) -----------------------------------------------------------------------------------------------------------

/** Does the fixed `affects` of a stored effect name this object? */
const affectsObject = (e: LiveEffect, id: ObjectId): boolean => {
  const a = e.effect.affects;
  return a.ref === 'fixed' && 'objects' in a && a.objects.some((h) => h.id === id);
};

/** The 1a effects stored for an object (copy effects and `asEntry` records), in the order layer 1a applies them (see the file comment). */
export function stored1a(s: GameState, id: ObjectId): LiveEffect[] {
  if (s.continuousEffects.length === 0) return [];
  return resolvedEffects(s)
    .filter((e) => (e.copy !== undefined || e.asEntry === true) && affectsObject(e, id))
    .sort((a, b) => a.timestamp - b.timestamp || numOf(a.id) - numOf(b.id));
}

/** The object as it is, or as it last existed (CR 608.2h). */
const objectOf = (s: GameState, id: ObjectId): GameObject | undefined => s.objects[id] ?? s.lki[id]?.object;

/** Is this a face-down permanent or spell (CR 708.2: the profile is its copiable values)? A face-down card in exile has no characteristics (CR 406.3a). */
const faceDownHere = (o: GameObject): boolean => o.faceDown && (o.zone === 'battlefield' || o.zone === 'stack');

/** The pseudo-definition of a face-down object's profile (M6-0's two frozen definitions, core/create.ts). */
const faceDownDef = (o: GameObject): string => (o.faceDownInfo?.profile === 'ward2' ? FACE_DOWN_DEF_IDS.ward2 : FACE_DOWN_DEF_IDS.plain);

/**
 * The copiable values of `o` (CR 613.2c, 707.2-707.3), or why this build can't give them exactly. `o` may be an object that left (its last known object):
 * the copy effects stored for its id are still read.
 */
export function copiableOrWhy(s: GameState, o: GameObject): CopiableValues | { reason: string } {
  const def = s.defs[o.defId];
  if (!def) return { reason: 'the object has no definition this player can see' };
  if (o.kind === 'ability') return { reason: 'an ability is not an object a copy effect can copy (CR 707.10 copies abilities on the stack)' };
  let cv: CopiableValues;
  if (faceDownHere(o)) cv = { defId: faceDownDef(o), face: 0, except: [] };
  else {
    if (def.layout === 'split' && def.faces.length > 1 && o.zone !== 'stack') return { reason: 'copying a split card or a Room is not automated yet (CR 709.4)' };
    // FAST5X E8: a Room spell's copiable values include both halves (CR 709.5b, an exception to CR 709.3b), and the token it becomes (CR 707.10f) enters with
    // designations no rule spells out for a copy that was not cast (CR 709.5d): not automated
    if (def.layout === 'split' && def.faces.length > 1 && hasSharedTypeLine(def)) return { reason: 'copying a Room spell is not automated yet (CR 709.5b, 709.5d)' };
    // M6-4: a melded permanent's copiable values are the meld result's, and a copy of it has mana value 0 (CR 712.8g, 202.3c); a meld card that isn't
    // melded is copied as its front face (CR 712.8a-b, 712.4b). M6-9: a merged permanent's are its topmost component's plus every component's abilities
    // (CR 730.2a, 702.140e: statics/merge.ts#mergedCopiable, applied below in 1a order).
    const merged = isMergedObject(o);
    const melded = !merged && def.layout === 'meld' && def.meld?.isResult === true && o.components !== undefined && o.components.length > 1;
    if (!melded && !merged && o.components !== undefined && o.components.length > 0) return { reason: 'copying this permanent made of several cards is not automated (CR 712.4a, 730.2a)' };
    const face = def.layout === 'flip' || def.layout === 'meld' ? 0 : faceIndexOf(def, o); // a flip card: the half is chosen by the affected object's status (CR 707.3, 710.1b)
    cv = { defId: o.defId, face, except: [] };
    // wave 3 merge (CR 718.3c-d): a prototyped spell or permanent's copiable values are its prototype characteristics: the copy has them too (applyCopiable).
    // Only the characteristics: a copy that is not a spell copy (rules/stack-objects.ts) gets no `prototyped` status of its own.
    if (o.prototyped === true && (o.zone === 'stack' || o.zone === 'battlefield') && def.faces[face]?.prototype !== undefined) cv.prototyped = true;
    // std-ry7 (CR 702.103b, 707.2; cite unverified): whether a copy of a bestowed Aura copies its Aura characteristics is not modelled: not automated (fail closed)
    if (o.bestowed === true && (o.zone === 'stack' || o.zone === 'battlefield')) return { reason: 'copying a bestowed Aura is not automated yet (CR 702.103b, 707.2)' };
    if (melded) cv.manaValueZero = true; // CR 712.8g, 202.3c
    if (def.layout === 'transform' && face >= 1) cv.manaValueZero = true; // CR 202.3b: a copy of a nonmodal DFC's back face has mana value 0 (CR 707.8, 712.8e)
  }
  // (2) the 1a effects that apply to it, in 1a order: a copy effect replaces the values by its snapshot; an `asEntry` effect modifies them (CR 707.2, 613.2a).
  // M6-9 (CR 730.2a, 613.7): each part of a merged permanent's copiable effect takes its place among them by the timestamp of its merge.
  const steps = faceDownHere(o) ? [] : mergeSteps(o);
  let next = 0;
  for (const e of stored1a(s, o.id)) {
    while (next < steps.length && e.timestamp > steps[next]!.at) cv = mergedCopiable(o, cv, steps[next++]!);
    if (e.copy) cv = { ...e.copy, except: [...e.copy.except] };
    else if (e.asEntry) cv = { ...cv, except: [...cv.except, ...e.effect.mods.filter((m) => m.layer !== '1a')] };
  }
  while (next < steps.length) cv = mergedCopiable(o, cv, steps[next++]!);
  // (3) CR 708.2, 708.10, 707.3 example 3: a face-down permanent or spell's copiable values are the profile, whatever copy effects apply to it.
  if (faceDownHere(o)) cv = { defId: faceDownDef(o), face: 0, except: [] };
  return cv;
}

/** M6-2 (statics/api.ts#CopiableValuesOf): the copiable values of an object now. An object this build can't copy exactly gets its plain definition. */
export function copiableValuesOf(s: GameState, id: ObjectId): CopiableValues {
  const o = objectOf(s, id);
  const r = o ? copiableOrWhy(s, o) : { reason: 'no such object' };
  return 'reason' in r ? { defId: o?.defId ?? '', face: 0, except: [] } : r;
}

// ---- applying (layer 1a) ----------------------------------------------------------------------------------------------------------------------------

/** The characteristics a characteristic-defining ability defines (CR 604.3), for `dropCda` (CR 707.9d). */
function cdaDefines(a: AbilityDef): Characteristic[] {
  const out: Characteristic[] = [];
  if (a.kind !== 'static') return out;
  for (const e of a.effects) {
    if (e.s !== 'continuous' || e.cda !== true) continue;
    for (const m of e.mods) {
      if (m.layer === 5) out.push('colors');
      if (m.layer === 4 && m.types) out.push('types');
      if (m.layer === 4 && m.subtypes) out.push('subtypes');
      if (m.layer === '7a' && m.power !== undefined) out.push('power');
      if (m.layer === '7a' && m.toughness !== undefined) out.push('toughness');
    }
  }
  return out;
}

/** The layer 6 additions among exceptions: abilities that are part of the copiable values (CR 707.9b), copied rules text rather than granted abilities. */
const exceptAbilities = (except: readonly Modification[]): AbilityDef[] => except.flatMap((m) => (m.layer === 6 ? m.add ?? [] : []));

/** An exception without its layer 6 additions (they are copied abilities, see `exceptAbilities`), or null when nothing is left. */
function withoutAdds(m: Modification): Modification | null {
  if (m.layer !== 6 || m.add === undefined) return m;
  const { add: _add, ...rest } = m;
  return rest.removeAll || (rest.remove?.length ?? 0) > 0 || (rest.cantHave?.length ?? 0) > 0 ? rest : null;
}

/**
 * The characteristics a copy effect with these copiable values gives `subject` (CR 707.2): the copied face (a flip card's half by the subject's flip status), its
 * abilities as copied abilities, the controller and "can't have" markers the subject already has, mana value 0 when `manaValueZero`, the copied CDAs named in
 * `dropCda` removed, then each exception applied with its own layer's function (CR 707.9b). `c` unchanged when the definition is not in this state (a view
 * without it: core/view-parts/copy-defs.ts gives every viewer the definitions snapshots name).
 */
export function applyCopiable(c: Chars, cv: CopiableValues, subject: ObjectId, s: GameState, all: ReadonlyMap<ObjectId, Chars>, effectId: string, ns: string | null = effectId): Chars {
  const def: CardDef | undefined = s.defs[cv.defId];
  if (!def || def.faces.length === 0) return c;
  const o = s.objects[subject];
  const face = def.layout === 'flip' ? (o?.flipped === true && def.faces.length > 1 ? 1 : 0) : Math.min(cv.face, def.faces.length - 1);
  // wave 3 merge (CR 718.3d): the copy of a prototyped object has the prototype's mana cost, colors, power and toughness (rules/base-parts/prototype.ts)
  const base: BaseChars = (cv.prototyped === true ? prototypeChars(def, face) : null) ?? fromFace(def.faces[face]!, face);
  const drop = new Set<Characteristic>(cv.dropCda ?? []);
  if (drop.size > 0) base.abilities = base.abilities.filter((a) => !cdaDefines(a.def).some((k) => drop.has(k)));
  const extra = [...exceptAbilities(cv.except), ...(cv.alsoAbilitiesOf ?? []).flatMap((x) => s.defs[x.defId]?.faces[x.face]?.abilities ?? [])];
  const abilities = copiedAbilities(effectId, base, extra, ns);
  const x = o?.zone === 'stack' ? o.stack?.x ?? 0 : 0;
  let out: Chars = {
    name: base.name, names: base.names, face, combined: false, manaCost: base.manaCost,
    manaValue: cv.manaValueZero ? 0 : manaValue(costForManaValue(def, face, base.manaCost), x),
    colors: base.colors, supertypes: base.supertypes, types: base.types, subtypes: base.subtypes,
    abilities, keywords: keywordsOfAbilities(abilities), controller: c.controller, cantHave: c.cantHave,
  };
  for (const k of ['power', 'toughness', 'loyalty', 'defense'] as const) if (base[k] !== undefined) out[k] = base[k];
  if (cv.name !== undefined) out = { ...out, name: cv.name, names: [cv.name] }; // FAST5 T64, CR 707.9b-c: "except its name is ..."
  const fx = { id: effectId, source: subject, controller: c.controller, timestamp: 0 };
  for (const m of cv.except) {
    const rest = withoutAdds(m);
    if (rest && rest.layer !== '1a' && rest.layer !== '1b' && rest.layer !== 3) out = applyMods(out, [rest], subject, s, all, fx);
  }
  return out;
}

/** M6-2: the layer 1a applier. A 1a modification without a snapshot (no copy effect began it) changes nothing. */
export const LAYER_1A: ApplyMods | null = (c, mods, subject, s, all, fx) => {
  // M6-9 (CR 730.2a, 702.140e): a merged permanent's rule-generated copiable effect (statics/merge.ts)
  if (isMergeEffect(fx?.id)) {
    const o = s.objects[subject] ?? s.lki[subject]?.object;
    return o && fx ? applyMergeStep(c, o, s, fx.id) : c;
  }
  if (!fx?.copy || !mods.some((m) => m.layer === '1a')) return c;
  return applyCopiable(c, fx.copy, subject, s, all, fx.id);
};

/** CR 707.1: whether a copy effect applies to this permanent (a stored 1a copy effect names it). */
export function isCopyPermanent(s: GameState, o: GameObject): boolean {
  return stored1a(s, o.id).some((e) => e.copy !== undefined);
}

// ---- beginning a copy effect (CR 707.9) -------------------------------------------------------------------------------------------------------------

/** A minimal starting record for `applyCopiable` (it keeps only the controller and the "can't have" markers of what it is given). */
const blankChars = (controller: PlayerId): Chars => ({
  name: '', names: [], face: 0, combined: false, manaCost: null, manaValue: 0, colors: [], supertypes: [], types: [], subtypes: [], abilities: [], keywords: [],
  controller, cantHave: [],
});

/** The characteristics `subject` would have from these copiable values alone (layer 1 only). */
export function charsFromCopiable(s: GameState, cv: CopiableValues, subject: ObjectId, controller: PlayerId): Chars {
  return applyCopiable(blankChars(controller), cv, subject, s, new Map(), HYPOTHETICAL_COPY, null);
}

/** CR 707.9d: the characteristics an exception sets, whose copied characteristic-defining abilities are dropped ("in addition to its other types" is not one). */
function setsCharacteristics(m: Modification): Characteristic[] {
  const out: Characteristic[] = [];
  if (m.layer === 5 && m.colors.set !== undefined) out.push('colors');
  if (m.layer === 4 && m.types?.set !== undefined) out.push('types');
  if (m.layer === 4 && m.subtypes?.set !== undefined) out.push('subtypes');
  if ((m.layer === '7a' || m.layer === '7b') && m.power !== undefined) out.push('power');
  if ((m.layer === '7a' || m.layer === '7b') && m.toughness !== undefined) out.push('toughness');
  return out;
}

const INTEGER = /^-?\d+$/;
type Retain = Extract<CopyExcept, { retain: unknown }>['retain'];

/** CR 707.9c: "except it doesn't copy ...": the copy's OWN values (its copiable values now) as concrete modifications, or why they can't be stated. */
function retained(own: Chars, what: Retain, copied: Chars): Modification[] | { reason: string } {
  const out: Modification[] = [];
  for (const k of what) {
    switch (k) {
      case 'colors': out.push({ layer: 5, colors: { set: own.colors.slice() } }); break;
      case 'types': out.push({ layer: 4, types: { set: own.types.slice() } }); break;
      case 'supertypes': out.push({ layer: 4, supertypes: { set: own.supertypes.slice() } }); break;
      case 'subtypes': out.push({ layer: 4, subtypes: { remove: copied.subtypes.slice() } }, { layer: 4, subtypes: { add: own.subtypes.slice() } }); break;
      case 'power': case 'toughness': {
        const v = own[k];
        if (v === undefined || !INTEGER.test(v)) return { reason: `the copy would keep its own ${k}, which is not a number (CR 707.9c)` };
        out.push(k === 'power' ? { layer: '7b', power: Number(v) } : { layer: '7b', toughness: Number(v) });
        break;
      }
      default: return { reason: `keeping its own ${k} through a copy effect is not automated yet (CR 707.9c)` };
    }
  }
  return out;
}

/** Is `x` a `Modification` (not a `retain` or `if` exception)? */
const isModification = (x: CopyExcept): x is Modification => 'layer' in x;

/**
 * The copiable values a copy effect of `target` begins with (CR 707.2b, 707.9): `of` (the copied object's copiable values, from `copiableOrWhy`) with the effect's
 * own exceptions made concrete and appended (`retain` from the target's own copiable values, 707.9c; an `if` exception judged on the result of the copy without
 * it, with the effect's unconditional exceptions, 707.9f, kept only if it applies; `dropCda` for each characteristic a kept exception sets or retains, 707.9d).
 * The target is judged as the permanent it will be (a spell or card becoming a permanent copy is looked at on the battlefield).
 */
export function concreteSnapshot(s: GameState, target: GameObject, of: CopiableValues, except: readonly CopyExcept[]): CopiableValues | { reason: string } {
  const kept: Modification[] = [];
  const drop = new Set<Characteristic>(of.dropCda ?? []);
  let keptName: string | undefined;
  let ownChars: Chars | { reason: string } | undefined;
  const ownOnce = (): Chars | { reason: string } => {
    if (ownChars) return ownChars;
    const own = copiableOrWhy(s, target);
    return (ownChars = 'reason' in own ? own : charsFromCopiable(s, own, target.id, target.controller));
  };
  const add = (list: readonly CopyExcept[], nested: boolean): { reason: string } | null => {
    for (const x of list) {
      if (isModification(x)) {
        kept.push(x);
        for (const k of setsCharacteristics(x)) drop.add(k);
      } else if ('retain' in x) {
        const own = ownOnce();
        if ('reason' in own) return { reason: `the copy would keep its own values, which this build can't read (${own.reason})` };
        // FAST5 T64 (CR 707.9c): "except its name is X" keeps the copy's own name: part of the copiable values, not a modification
        if (x.retain.includes('name')) keptName = own.name;
        const r = retained(own, x.retain.filter((k) => k !== 'name'), charsFromCopiable(s, of, target.id, target.controller));
        if ('reason' in r) return r;
        kept.push(...r);
        for (const k of x.retain) if (k === 'colors' || k === 'types' || k === 'subtypes' || k === 'power' || k === 'toughness') drop.add(k);
      } else if ('thisAbility' in x) {
        // MX2: a resolved effect replaces it with the ability itself before the snapshot (effects/handlers/lasting.ts); anywhere else it can't be stated
        return { reason: '"it has this ability" outside a resolving ability is not automated (CR 707.9a)' };
      } else if (nested) return { reason: 'a conditional copy exception inside another one is not automated (CR 707.9f)' };
      else {
        // CR 707.9f: judged on the result of the copy without this exception (with the unconditional ones), as the permanent it will be
        const trial: CopiableValues = { ...of, except: [...of.except, ...kept], ...(drop.size > 0 ? { dropCda: [...drop] } : {}) };
        if (applies(s, target, trial, x.if)) {
          const r = add(x.then, true);
          if (r) return r;
        }
      }
    }
    return null;
  };
  const why = add(except.filter((x) => !('if' in x)), false) ?? add(except.filter((x) => 'if' in x), false);
  if (why) return why;
  const out: CopiableValues = { ...of, except: [...of.except, ...kept] };
  if (keptName !== undefined) out.name = keptName;
  if (drop.size > 0) out.dropCda = [...drop];
  return out;
}

/** Does the object, with these copiable values and as a permanent, match the filter (CR 707.9f; 707.9e "if it's a creature")? */
export function applies(s: GameState, target: GameObject, cv: CopiableValues, f: ObjectFilter): boolean {
  const chars = charsFromCopiable(s, cv, target.id, target.controller);
  const asPermanent: GameObject = { ...target, zone: 'battlefield' };
  const alt: GameState = { ...s, objects: { ...s.objects, [target.id]: asPermanent } };
  return filterMatches({ s: alt, all: new Map([[target.id, chars]]), source: target.id, controller: target.controller }, target.id, f);
}

/**
 * CR 707.9e: the counters of the additional effects of an "enters as a copy" effect that apply to `o` as the copy it becomes ("it enters with an additional
 * +1/+1 counter on it if it's a creature"), judged with the copy's values. `byHand`: the kinds whose count is not a number (the players add those).
 */
export function additionalCountersOf(
  s: GameState, o: GameObject, snapshot: CopiableValues, additional: readonly { if?: ObjectFilter; counters: { kind: string; count: unknown }[] }[],
): { counters: { kind: string; count: number }[]; byHand: string[] } {
  const counters: { kind: string; count: number }[] = [];
  const byHand: string[] = [];
  for (const a of additional) {
    if (a.if && !applies(s, o, snapshot, a.if)) continue;
    for (const spec of a.counters) {
      if (typeof spec.count !== 'number') byHand.push(spec.kind);
      else if (spec.count > 0) counters.push({ kind: spec.kind, count: spec.count });
    }
  }
  return { counters, byHand };
}

/**
 * The stored record of a copy effect on `target` (CR 611.2, 707.2): a 1a modification with the snapshot, affecting exactly the target as it is now (CR 611.2c),
 * for as long as the effect lasts (`duration`; by default as long as it is this object, CR 400.7).
 */
export function copyRecord(args: {
  id: string; target: { id: ObjectId; zone: GameObject['zone'] }; snapshot: CopiableValues; of: { id: ObjectId; zone: GameObject['zone'] } | null;
  source: ContinuousEffectRec['source']; sourceName: string; controller: PlayerId; timestamp: number; turn: number; duration?: ContinuousEffectRec['duration'];
}): ContinuousEffectRec {
  return {
    id: args.id,
    source: args.source,
    sourceName: args.sourceName,
    controller: args.controller,
    timestamp: args.timestamp,
    startedTurn: args.turn,
    duration: args.duration ?? { d: 'permanent' },
    effect: {
      s: 'continuous',
      affects: { ref: 'fixed', objects: [{ id: args.target.id, zone: args.target.zone }] },
      mods: [{ layer: '1a', copyOf: { ref: 'fixed', objects: args.of ? [{ id: args.of.id, zone: args.of.zone }] : [] } }],
    },
    copy: args.snapshot,
  };
}

/** The definitions the copy snapshots of this state refer to (core/view-parts/copy-defs.ts: a viewer needs them to compute the copies, CR 707.2). */
export function snapshotDefs(s: GameState): string[] {
  const out = new Set<string>();
  for (const rec of s.continuousEffects) {
    if (!rec.copy) continue;
    out.add(rec.copy.defId);
    for (const x of rec.copy.alsoAbilitiesOf ?? []) out.add(x.defId);
  }
  return [...out];
}
