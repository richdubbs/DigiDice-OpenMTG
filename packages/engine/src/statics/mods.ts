/**
 * The per-layer modification functions (CR 613.1-613.4). Owner: WP9. Contract: statics/api.ts#ApplyMods.
 *
 * `applyMods(c, mods, subject, s, all, fx)` applies the modifications of ONE effect, in the order written, to the characteristics `c` of `subject` and returns
 * the result. It is PURE: `c` and every array inside it are left alone, a changed copy is returned (the layer system keeps the characteristics of the other
 * objects, and the dependency check of CR 613.8 applies a modification to a scratch copy, so nothing here may edit in place). A modification of a layer this
 * build does not implement (1a, 1b, 3: milestone 6) changes nothing.
 *
 * Quantities are evaluated against `all`, the characteristics BEFORE this effect touched any object (CR 613.8c: each effect is applied as a whole), through
 * statics/match.ts; one that cannot be determined leaves that characteristic alone (a characteristic-defining "*" stays "*", which the rest of the engine reads
 * as "not evaluated" and treats as manual).
 */
import type { Color } from '../types/mana';
import { sortColors } from '../types/mana';
import type { AbilityDef, Modification, TypeChange } from '../types/ability';
import type { ObjectId } from '../types/ids';
import type { Chars } from '../rules/characteristics';
import { grantedAbilities, keywordsOfAbilities } from './abilities';
import type { ApplyMods, CharAbility, ModContext } from './api';
import { colorFromWord, evalQuantity, objectsOf, playerOf, type EvalCx } from './match';
import { readLink } from './links';
import { BASIC_LAND_TYPES, CREATURE_TYPES, hasTypeFor, subtypeClass } from './subtypes';

const INTEGER = /^-?\d+$/;

/** CR 122.1b: the keywords a keyword counter can be (std-combat-2: kept in types/ability.ts, which the parser may import too). */
export { KEYWORD_COUNTERS } from '../types/ability';

// ---- layer 2 (CR 613.1b) ----------------------------------------------------------------------------------------------------

function layer2(c: Chars, m: Extract<Modification, { layer: 2 }>, cx: EvalCx): Chars {
  const p = playerOf(cx, m.controller);
  if (p === undefined || p === c.controller) return c;
  // M12-2 (m12 design E26): CR 800.4b, "If an object would change to the control of a player who has left the game, it doesn't." (Multiplayer only: a
  // two-player game is over when a player loses, and its last state is read as it was.)
  if (cx.s.options.multiplayer !== undefined && cx.s.players.find((x) => x.id === p)?.hasLost === true) return c;
  return { ...c, controller: p };
}

// ---- layer 4 (CR 613.1d, 205.3d, 305.7) -------------------------------------------------------------------------------------

const withAll = (list: readonly string[], add: readonly string[]): string[] => [...list, ...add.filter((x, i) => !list.includes(x) && add.indexOf(x) === i)];

/** The values a link stored for "the chosen ..." (colors, creature types, card types). */
function chosenValues(cx: EvalCx, link: string | undefined): string[] {
  return link === undefined ? [] : readLink(cx.source === null ? undefined : cx.s.objects[cx.source], link)?.values ?? [];
}

/**
 * Type changes. `set` replaces; `add` adds; `remove` removes; `chosen` names a link whose values join the list (a creature type chosen as the permanent entered).
 * For subtypes `set` replaces only the subtypes of the class(es) it names (CR 305.7, 205.3d): "becomes a Mountain" keeps a creature type and loses the old
 * land types. CR 305.7 also makes a land whose land type is set to a basic land type lose the abilities generated from its rules text; abilities granted by
 * other effects (layer 6, later) are not affected. Afterwards the object keeps only subtypes that correspond to one of its card types (CR 205.3d).
 */
function layer4(c: Chars, m: Extract<Modification, { layer: 4 }>, cx: EvalCx): Chars {
  // FAST3 T13: `chosenSets` makes the chosen values a `set` (nothing chosen: no change)
  const setChosen = (t: TypeChange | undefined): TypeChange | undefined => {
    if (t?.chosenSets !== true) return t;
    const picked = chosenValues(cx, t.chosen);
    const { chosen: _c, chosenSets: _s, ...rest } = t;
    return picked.length === 0 ? rest : { ...rest, set: [...(rest.set ?? []), ...picked] };
  };
  const change = (list: readonly string[], t0: TypeChange | undefined): string[] => {
    const t = setChosen(t0);
    if (!t) return list.slice();
    let out = t.set !== undefined ? [...new Set(t.set)] : list.slice();
    if (t.add) out = withAll(out, t.add);
    out = withAll(out, chosenValues(cx, t.chosen));
    if (t.remove) out = out.filter((x) => !t.remove!.includes(x));
    return out;
  };

  const types = change(c.types, m.types) as Chars['types'];
  const supertypes = change(c.supertypes, m.supertypes) as Chars['supertypes'];

  let subtypes = c.subtypes.slice();
  const st = setChosen(m.subtypes);
  let lostRulesText = false;
  if (st) {
    if (st.set !== undefined) {
      const classes = new Set(st.set.map(subtypeClass).filter((k) => k !== undefined));
      subtypes = subtypes.filter((t) => {
        const k = subtypeClass(t);
        return k === undefined || !classes.has(k);
      });
      subtypes = withAll(subtypes, st.set);
      lostRulesText = (types as string[]).includes('Land') && st.set.some((t) => BASIC_LAND_TYPES.includes(t)); // CR 305.7
    }
    if (st.add) subtypes = withAll(subtypes, st.add);
    if (st.all) subtypes = withAll(subtypes, CREATURE_TYPES); // CR 702.73a: every creature type
    if (st.removeAll === 'creature') subtypes = subtypes.filter((t) => subtypeClass(t) !== 'creature'); // FAST5 T41, CR 205.3m: "loses all creature types"
    if (st.removeAll === 'land') subtypes = subtypes.filter((t) => subtypeClass(t) !== 'land'); // std-mana-1, CR 205.3i, 305.7: "loses all land types"
    subtypes = withAll(subtypes, chosenValues(cx, st.chosen));
    if (st.remove) subtypes = subtypes.filter((x) => !st.remove!.includes(x));
  }
  if (m.types || st) subtypes = subtypes.filter((t) => hasTypeFor(subtypeClass(t), types)); // CR 205.3d

  let abilities = c.abilities;
  let keywords = c.keywords;
  if (lostRulesText) {
    // CR 305.7: the rules text it loses is its own: printed, keyword-generated and (M6-0, m6 design 4.1) copied abilities (a copy's rules text, CR 707.2)
    abilities = abilities.filter((a) => a.origin !== 'printed' && a.origin !== 'keyword' && a.origin !== 'copied');
    keywords = keywordsOfAbilities(abilities);
  }
  return { ...c, types, subtypes, supertypes, abilities, keywords, ...(m.named !== undefined ? { names: [m.named] } : {}) }; // FAST5 T69, CR 201.2
}

// ---- layer 5 (CR 613.1e) ----------------------------------------------------------------------------------------------------

/**
 * `colors.chosen` names a link whose values are the chosen colors: with neither `set` nor `add` the chosen colors ARE the object's colors ("becomes the color
 * of your choice"), otherwise they are added.
 */
function layer5(c: Chars, m: Extract<Modification, { layer: 5 }>, cx: EvalCx): Chars {
  const k = m.colors;
  let colors: Color[] = k.set !== undefined ? sortColors(k.set) : c.colors.slice();
  const chosen = chosenValues(cx, k.chosen).flatMap((v) => { const col = colorFromWord(v); return col ? [col] : []; });
  if (chosen.length > 0) colors = k.set === undefined && k.add === undefined ? sortColors(chosen) : sortColors([...colors, ...chosen]);
  if (k.add) colors = sortColors([...colors, ...k.add]);
  if (k.remove) colors = colors.filter((x) => !k.remove!.includes(x));
  return { ...c, colors };
}

// ---- layer 6 (CR 613.1f) ----------------------------------------------------------------------------------------------------

/** Does a name in `remove` (a keyword, or "activated", "triggered", "static", "mana") name this ability? */
function removalNames(a: CharAbility, names: readonly string[]): boolean {
  const d = a.def;
  if (d.kind === 'keyword') return names.includes(d.keyword);
  if (names.includes(d.kind)) return true;
  return d.kind === 'activated' && d.isMana === true && names.includes('mana');
}

/** Drop what was generated by an ability that is no longer there (the expansion of a removed keyword). */
function dropOrphans(list: CharAbility[]): CharAbility[] {
  const keys = new Set(list.map((a) => a.key));
  return list.filter((a) => a.parent === undefined || keys.has(a.parent));
}

/**
 * Layer 6, in the order the pieces of one modification are written: lose everything, lose the named, "can't have" (removes what is there now and refuses
 * every grant that comes later in timestamp order), then gain. The abilities this layer adds carry `g:<effect id>:<n>` keys.
 */
function layer6(c: Chars, m: Extract<Modification, { layer: 6 }>, fx: ModContext, cx: EvalCx): Chars {
  let abilities = c.abilities;
  let cantHave = c.cantHave;
  if (m.removeAll) abilities = [];
  if (m.remove && m.remove.length > 0) abilities = dropOrphans(abilities.filter((a) => !removalNames(a, m.remove!)));
  if (m.cantHave && m.cantHave.length > 0) {
    cantHave = withAll(cantHave, m.cantHave);
    abilities = dropOrphans(abilities.filter((a) => !(a.def.kind === 'keyword' && m.cantHave!.includes(a.def.keyword))));
  }
  if (m.add && m.add.length > 0) abilities = [...abilities, ...grantedAbilities(fx.id, fx.timestamp, withGrantor(withChosenQualities(m.add, cx), fx.source), c, cantHave)];
  if (m.addActivatedOf !== undefined) abilities = [...abilities, ...grantedAbilities(`${fx.id}~of`, fx.timestamp, activatedOf(cx, m.addActivatedOf, m.activatedOfLimit, m.alsoTriggered === true), c, cantHave)];
  return { ...c, abilities, cantHave, keywords: keywordsOfAbilities(abilities) };
}

/**
 * r5-static (CR 613.1f): the activated abilities the objects of `ref` have as this effect applies (their characteristics so far in layer 6, `cx.all`): every
 * ability of kind `activated`, a keyword's generated activated ability included (the keyword itself is not copied: what it generates is). The same definition
 * objects, so a gained ability keeps its identity from one computation to the next.
 */
function activatedOf(cx: EvalCx, ref: NonNullable<Extract<Modification, { layer: 6 }>['addActivatedOf']>, limit?: { per: 'turn'; max: number }, triggered = false): AbilityDef[] {
  const out: AbilityDef[] = [];
  for (const id of objectsOf(cx, ref)) {
    // std-cardcopy-5 (CR 613.1f): `alsoTriggered`, the triggered abilities too ("all activated and triggered abilities of the last chosen card")
    // audit-fix-2 (CR 113.2c, 702.167c): duplicates are removed per object only. Two copies of one card share their printed definitions (one CardDef), yet each
    // gives its own instance, each with its own key (`g:<fx>~of:<n>`) and its own count of activations (rules/timing.ts)
    const seen: AbilityDef[] = [];
    for (const a of cx.all.get(id)?.abilities ?? []) if ((a.def.kind === 'activated' || (triggered && a.def.kind === 'triggered')) && !seen.includes(a.def)) seen.push(a.def);
    out.push(...seen);
  }
  return limit === undefined ? out : out.map((d) => limitedEachTurn(d, limit.max));
}

/** One limited definition per (ability, limit): the same object every time, so a granted ability keeps its identity from one computation to the next. */
const LIMITED = new WeakMap<AbilityDef, Map<number, AbilityDef>>();

/**
 * std-craft-2 (CR 602.5b): an activated ability that may be activated only `max` times each turn (counted on the object that has it, rules/timing.ts). A limit
 * per turn it already has is kept when smaller; a limit per game or per combat is kept as it is (at most once per game or combat is never more each turn when its
 * maximum is one; any other such limit fails closed in rules/timing.ts or stays at most as permissive as printed).
 */
function limitedEachTurn(d: AbilityDef, max: number): AbilityDef {
  if (d.kind !== 'activated') return d;
  const own = d.limit;
  if (own !== undefined && (own.per !== 'turn' || own.max <= max)) return d;
  let byMax = LIMITED.get(d);
  if (!byMax) LIMITED.set(d, (byMax = new Map()));
  let out = byMax.get(max);
  if (!out) byMax.set(max, (out = { ...d, limit: { per: 'turn', max } }));
  return out;
}

/** MX2: `feature:quality.chosen` (model/cap-walk.ts#chosenQualityForm), registered by model/capabilities.ts: `withChosenQualities` below reads it. */
export const CHOSEN_QUALITY_FEATURES: readonly string[] = ['quality.chosen'];

/** One resolved keyword per (granted keyword, chosen color): the same object every time, so the keyword library's memos keep working. */
const CHOSEN_QUALITY = new WeakMap<AbilityDef, Map<string, AbilityDef>>();

/**
 * MX2 (`feature:quality.chosen`; CR 702.16a, 607.2d): a granted keyword whose quality is `chosen:color` ("has protection from the chosen color") gets the color
 * chosen by the linked "choose a color" ability of the effect's SOURCE (its link store, statics/links.ts): for "enchanted creature has protection from the
 * chosen color" that is the Aura, not the creature. No choice recorded (it entered without one, CR 607.2d): the keyword is not granted at all, never a
 * protection from nothing.
 */
const GRANTED_BY = new WeakMap<AbilityDef, Map<ObjectId, AbilityDef>>();

/**
 * r4-static (CR 201.5a): an ability a static ability grants that names the granting object ("Equipped creature has "{T}, Sacrifice Blazing
 * Torch: Blazing Torch deals 2 damage to any target."", `{ref:'grantor'}`): the object it is granted to gets it with that object written as a fixed reference to
 * the source of the granting effect on the battlefield (`ref:'fixed'` with `source: true`: named as `self` names an ability's source, so a cost that sacrificed it
 * still lets it deal the damage with its last known information, CR 608.2h, 113.7a, and a handler that acts on it finds it gone, CR 400.7).
 * The same definition object for the same source each time, so a granted ability keeps its identity from one computation to the next. A grant without a source
 * (a resolved effect) keeps the definition as it is.
 */
function withGrantor(add: readonly AbilityDef[], source: ObjectId | null): readonly AbilityDef[] {
  if (source === null || !add.some(hasGrantor)) return add;
  return add.map((d) => {
    if (!hasGrantor(d)) return d;
    let bySource = GRANTED_BY.get(d);
    if (!bySource) GRANTED_BY.set(d, (bySource = new Map()));
    let out = bySource.get(source);
    if (!out) bySource.set(source, (out = replaceGrantor(d, { ref: 'fixed', objects: [{ id: source, zone: 'battlefield' }], source: true }) as AbilityDef));
    return out;
  });
}

const hasGrantor = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.some(hasGrantor);
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return o['ref'] === 'grantor' || Object.values(o).some(hasGrantor);
};

const replaceGrantor = (v: unknown, by: unknown): unknown => {
  if (Array.isArray(v)) return v.map((x) => replaceGrantor(x, by));
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (o['ref'] === 'grantor') return by;
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, replaceGrantor(x, by)]));
};

function withChosenQualities(add: readonly AbilityDef[], cx: EvalCx): readonly AbilityDef[] {
  if (!add.some((d) => d.kind === 'keyword' && d.quality?.startsWith('chosen:') === true)) return add;
  return add.flatMap((d): AbilityDef[] => {
    if (d.kind !== 'keyword' || d.quality?.startsWith('chosen:') !== true) return [d];
    const link = d.quality.slice('chosen:'.length);
    if (link !== 'color' && !link.endsWith('#color')) return []; // a copied or granted pair reads its own namespace (statics/abilities.ts#namespacedAbility)
    const colors = chosenValues(cx, link).flatMap((v) => { const col = colorFromWord(v); return col ? [col] : []; });
    let byQuality = CHOSEN_QUALITY.get(d);
    if (!byQuality) CHOSEN_QUALITY.set(d, (byQuality = new Map()));
    return colors.map((col) => {
      const quality = `color:${col}`;
      let out = byQuality!.get(quality);
      if (!out) byQuality!.set(quality, (out = { ...d, quality }));
      return out;
    });
  });
}

// ---- layer 7 (CR 613.4) -----------------------------------------------------------------------------------------------------

type PtMod = Extract<Modification, { layer: '7a' | '7b' | '7c' }>;

/** 7a (characteristic-defining) and 7b (set): the value replaces the characteristic. A quantity that cannot be determined leaves it alone. */
function ptSet(c: Chars, m: PtMod, cx: EvalCx): Chars {
  const power = m.power === undefined ? undefined : evalQuantity(cx, m.power);
  const toughness = m.toughness === undefined ? undefined : evalQuantity(cx, m.toughness);
  if (power === undefined && toughness === undefined) return c;
  const out = { ...c };
  if (power !== undefined) out.power = String(power);
  if (toughness !== undefined) out.toughness = String(toughness);
  return out;
}

/** 7c: +N/+M. Only on a number: an object with no power or toughness (or a "*" nobody could evaluate) is left as it is. */
function ptModify(c: Chars, m: PtMod, cx: EvalCx): Chars {
  const dp = m.power === undefined ? undefined : evalQuantity(cx, m.power);
  const dt = m.toughness === undefined ? undefined : evalQuantity(cx, m.toughness);
  const out = { ...c };
  let changed = false;
  if (dp !== undefined && c.power !== undefined && INTEGER.test(c.power)) { out.power = String(Number(c.power) + dp); changed = true; }
  if (dt !== undefined && c.toughness !== undefined && INTEGER.test(c.toughness)) { out.toughness = String(Number(c.toughness) + dt); changed = true; }
  return changed ? out : c;
}

/** 7d: the power becomes the toughness and the toughness the power (CR 613.4d). */
function ptSwitch(c: Chars): Chars {
  if (c.power === undefined || c.toughness === undefined) return c;
  return { ...c, power: c.toughness, toughness: c.power };
}

// ---- the entry points ---------------------------------------------------------------------------------------------------------

export const applyMods: ApplyMods = (c, mods, subject, s, all, fx) => {
  const ctx: ModContext = fx ?? { id: `self:${subject}`, source: subject, controller: c.controller, timestamp: 0 };
  const cx: EvalCx = { s, all, source: ctx.source, controller: ctx.controller, subject };
  let out = c;
  for (const m of mods) {
    switch (m.layer) {
      case 2: out = layer2(out, m, cx); break;
      case 4: out = layer4(out, m, cx); break;
      case 5: out = layer5(out, m, cx); break;
      case 6: out = layer6(out, m, ctx, cx); break;
      case '7a': case '7b': out = ptSet(out, m, cx); break;
      case '7c': out = ptModify(out, m, cx); break;
      case '7d': out = ptSwitch(out); break;
      default: break; // 1a, 1b, 3: milestone 6
    }
  }
  return out;
};

/** The modifications of exactly one layer, applied by `applyMods` (the entries of `LAYER_TABLE`, capability `layer:<layer>`). */
export const layerApplier = (layer: Modification['layer']): ApplyMods => (c, mods, subject, s, all, fx) =>
  applyMods(c, mods.filter((m) => m.layer === layer), subject, s, all, fx);

/** A copy of the characteristics with its own arrays (the abilities themselves are shared: they are immutable data). */
export function copyChars(c: Chars): Chars {
  return {
    ...c,
    names: c.names.slice(), colors: c.colors.slice(), supertypes: c.supertypes.slice(), types: c.types.slice(), subtypes: c.subtypes.slice(),
    abilities: c.abilities.slice(), keywords: c.keywords.slice(), cantHave: c.cantHave.slice(),
  };
}
