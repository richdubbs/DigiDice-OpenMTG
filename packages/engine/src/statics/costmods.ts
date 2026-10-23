/**
 * Cost increases and reductions from static abilities (CR 601.2f, 118.7-118.9; design 9.5). Owner: WP16. Applied to spells by actions/cast.ts#applyCostModifiers
 * (and by castCheck, so a spell is listed as castable exactly when its modified cost can be paid).
 *
 * Which modifiers apply to a spell (`costModsFor`):
 *   - `applies.self`: the spell's own static ability that functions on the stack (CR 604.5: affinity, CR 702.41a; "this spell costs {1} more for each target
 *     beyond the first"; Death-Rattle Oni). A card that is not on the stack yet is read as the face being cast (CR 601.3e);
 *   - `applies.spells`: another object's (or a resolved effect's) modifier for spells matching the filter (Thalia), seen as the spell on the stack;
 *   - `applies.caster` is required (design 1.1.3) and is relative to the modifier's controller ("spells your opponents cast");
 *   - `applies.abilities` modifies activation costs: actions/activate.ts has no cost-modifier step yet, so such a modifier is never applied here and the capability
 *     walker names it `feature:costMod.abilities`, which is not advertised.
 *
 * How they apply (`modifyMana`), CR 601.2f: the total cost is the mana cost (or the alternative cost, CR 118.9d) plus additional costs (already in the plan)
 * plus increases, minus reductions; the player may apply reductions in any order (the order used here never makes the result worse for the player: specific
 * mana first, then generic amounts); generic reductions affect only the generic component (CR 118.7a); a colored or colorless reduction the cost has no such
 * mana for reduces the generic component instead (CR 118.7b-d); the result is never below {0} (CR 118.7, 601.2f). A `set` ("costs {N}") is an effect that directly
 * affects the total cost and is applied last (CR 601.2f, last sentences).
 *
 * Quantities are evaluated as the layer system evaluates them (statics/match.ts), plus `spellTargetCount` (CR 601.2c: targets are chosen before the total cost)
 * and whatever the caller's `qty` adds (actions/cast.ts supplies the history count of "for each creature that died this turn", `happenedCount`, which statics may
 * not import). A quantity nobody can evaluate makes the cost unknown: the caller refuses the cast with an explanation instead of charging a wrong amount.
 *
 * FAST4 T21 additions: `change.times` applies `mana` that many times (strive: "{2}{R} more for each target beyond the first"); `spellTargetCount` with a
 * `filter` counts only the targets that match ("if it targets a tapped creature"); `applies.spells.targets: {ref:'self'}` is "spells ... that target ~"
 * (CR 115.9b). All three read the targets chosen before the total cost (CR 601.2c, 601.2f). Before the spell is cast (castCheck) nothing is chosen: a
 * reduction is then counted at the most its targets could make it and an increase at the least, so castCheck never refuses a spell its targets would make
 * payable; the cast itself charges the exact amount once the targets are chosen. Inside the cast, before 601.2c (the payability of optional costs, X and
 * modes), a target-dependent amount counts no targets.
 */
import type { ActivatedAbilityDef, CostModDef, ObjectFilter, Quantity } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { Color, ManaCost, ManaSymbol } from '../types/mana';
import type { GameObject, GameState, TargetChoice } from '../types/state';
import type { Chars } from '../rules/characteristics';
import { evalCondition, evalQuantity, STATIC_QUANTITY_KINDS, type EvalCx } from './match';
import { objectMatches, ruleFilterEvaluable, spellActor, type Actor } from './rule-match';
import { charsViewOf, defHasRuleEffects, overlayAsSpell, overlayZone, playerPredIncludes, ruleContext, spellFaceChars, type CharsView } from './rule-sources';

/**
 * The quantity kinds a cost modifier's amount may use (design 5.2: `rq:cost.<kind>`): what statics/match.ts evaluates, `spellTargetCount` (below) and
 * `happenedCount`, which actions/cast.ts#modifiedPlan supplies from the history (the only caller that applies modifiers).
 */
export const COST_QUANTITY_KINDS: ReadonlySet<string> = new Set([...STATIC_QUANTITY_KINDS, 'spellTargetCount', 'happenedCount']);

/** One cost modifier that applies to a spell, with what evaluating it needs. */
export interface CostModHit {
  def: CostModDef;
  /** The object with the ability (the spell itself for a self modifier), or null for a resolved effect whose source is gone. */
  source: ObjectId | null;
  /** "You": the modifier's controller (the caster for a self modifier). */
  controller: PlayerId;
  /** For logs: the source's name and the ability text. */
  name: string;
  text: string;
  /** The evaluation context (the spell seen as a spell on the stack). */
  cx: EvalCx;
  /** The modifier's `applies.spells` filter can't be evaluated (statics/rule-match.ts): the cost is unknown, the cast is refused (never a guess). */
  unknown?: true;
  /**
   * r4-cost (CR 601.2c, 601.2f, 602.2b): for the cost of an ACTIVATED ability (its own cost change, or another object's modifier of it), the targets announced
   * for that ability, one list per target spec in order (`t0` is the first); `undefined` while none are announced (the legality check before activation).
   * Read by `spellTargetCount` and by "the creature it targets" (`{ref:'target'}`) in the amount.
   */
  targets?: () => readonly (readonly TargetChoice[])[] | undefined;
}

/**
 * The cost modifiers that apply to `spell` (a stack object, or the card being cast) cast by `player`, in timestamp order (design 5.3). `chars` are the
 * characteristics of the face being cast when the card is not on the stack yet (castCheck passes them).
 */
export function applicableCostMods(s: GameState, spell: ObjectId, player: PlayerId, chars?: Chars): CostModDef[] {
  return costModsFor(s, spell, player, chars).map((h) => h.def);
}

/** `applicableCostMods` with the context each modifier is evaluated in. */
export function costModsFor(s: GameState, spell: ObjectId, player: PlayerId, chars?: Chars): CostModHit[] {
  const ctx = ruleContext(s);
  const o = s.objects[spell];
  const def = o ? s.defs[o.defId] : undefined;
  if (!o || !def) return [];
  const onStack = o.zone === 'stack';
  // A card that is not a spell yet has its own modifiers too (affinity): they are read from the card even when nothing else in the game has a rule effect.
  // std-rx26: or a keyword a waiting "the next spell you cast this turn has affinity for artifacts" would give it (statics/rule-sources.ts#overlayAsSpell)
  const rider = !onStack && (s.turn.nextSpell ?? []).some((r) => r.rider === 'keyword' && r.player === player);
  if (!ctx && (onStack || !defHasRuleEffects(def)) && !rider) return [];
  // The spell as CR 601.2f sees it: on the stack, with the characteristics of the face being cast.
  const own = onStack ? undefined : chars ? { ...chars, controller: player } : spellFaceChars(s, o, 0, player);
  // P1: the overlay (a copy of the whole object map) is built the first time a modifier needs it; most spells meet none
  let at: { s2: GameState; view: CharsView } | undefined;
  const spellEnv = (): { s2: GameState; view: CharsView } => {
    if (at) return at;
    const s2 = onStack ? s : overlayZone(s, spell, 'stack');
    const base = ctx?.view ?? charsViewOf(s);
    return (at = { s2, view: own ? base.with(s2, new Map([[spell, own]])) : s2 === s ? base : base.with(s2, new Map()) });
  };
  const actor = spellActor(o); // CR 601.2a: a spell, cast from where the card is
  const out: CostModHit[] = [];
  for (const src of ctx?.sources ?? []) {
    const e = src.effect;
    if (e.s !== 'costMod') continue;
    const { s2, view } = spellEnv();
    const cx: EvalCx = { s: s2, all: view, source: src.source, controller: src.controller };
    if (e.applies.self === true) {
      if (src.source === spell) out.push({ def: e, source: spell, controller: player, name: src.name, text: src.text, cx: { ...cx, controller: player } });
      continue;
    }
    const applies = appliesToSpell(cx, e, spell, player, actor);
    if (applies !== false) out.push({ def: e, source: src.source, controller: src.controller, name: src.name, text: src.text, cx, ...(applies === undefined ? { unknown: true as const } : {}) });
  }
  if (!onStack) {
    // CR 604.5, 601.2f: the card's own modifiers function once it is a spell on the stack; read them from the face being cast (keyword expansions included).
    const face = own?.face ?? 0;
    const c = spellFaceChars(s, o, face, player, own?.combined === true) ?? own;
    // FAST5 T60 (CR 613.1f, 601.2a, 601.2f): and what other objects GRANT the card as the spell its caster controls ("spells you cast have affinity for artifacts"):
    // the granted keyword's expansion is a static ability of the spell like a printed one. The overlay is built only when some permanent could grant one.
    const asSpell = overlayAsSpell(s, spell, player);
    const granted = asSpell === s ? [] : charsViewOf(asSpell).get(spell)?.abilities.filter((a) => a.origin === 'granted') ?? [];
    for (const a of [...(c?.abilities ?? []), ...granted]) {
      const d = a.def;
      if (d.kind !== 'static' || !(d.zone ?? []).includes('stack')) continue;
      // FAST1 T5: "This spell costs {1} less to cast if you control a Wizard": the condition is read as on the stack, exactly as
      // rule-sources.ts#collectSources reads it once the card is a spell (CR 601.2f, 604.5, 611.3a), so castCheck and the cast agree
      if (d.condition) {
        const { s2, view } = spellEnv();
        if (!evalCondition({ s: s2, all: view, source: spell, controller: player }, d.condition)) continue;
      }
      for (const e of d.effects) {
        if (e.s !== 'costMod' || e.applies.self !== true) continue;
        const { s2, view } = spellEnv();
        out.push({ def: e, source: spell, controller: player, name: c?.name ?? '', text: d.text, cx: { s: s2, all: view, source: spell, controller: player } });
      }
    }
  }
  return out;
}

/**
 * FAST5 T60 (CR 601.2f, 602.2b, 118.7; capability `feature:costMod.abilities.keyword`): the modifiers of ANOTHER object's static ability that apply to the cost of
 * activating this ability ("Exhaust abilities of other permanents you control cost {2} less to activate"): the activating player is one `caster` names (relative to
 * the modifier's controller), the ability is of the kind and has the wrapper keyword `applies.abilities` names, and its source is one `applies.abilities.source`
 * matches (relative to the modifier's own source: "other permanents you control"). A source filter the rule hooks can't evaluate makes the hit `unknown`, so the
 * activation is refused with an explanation, never charged a guessed amount.
 */
export function abilityCostModsFor(s: GameState, player: PlayerId, source: GameObject, def: ActivatedAbilityDef): CostModHit[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const kind = def.isMana === true ? 'mana' : def.isLoyalty === true ? 'loyalty' : 'activated';
  const out: CostModHit[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'costMod' || e.applies.abilities === undefined || e.applies.self === true || e.applies.spells !== undefined) continue;
    const a = e.applies.abilities;
    if (a.kind !== undefined && a.kind !== kind) continue;
    // p2-cost-statics-2 (CR 605.1a, 115.1): a change by what the ability targets ("Abilities your opponents activate that target a Merfolk you control cost {2} more")
    // never applies to a mana ability, which has no targets
    if (kind === 'mana' && targetCounted(e.change.times)) continue;
    // r4-cost (CR 702.6a): "Equip abilities you activate ...": the ability a keyword stands for is that keyword's ability (keywords/expand.ts provenance)
    if (a.keyword !== undefined && a.keyword !== def.keyword && !(def.prov?.by === 'keyword' && def.prov.id === a.keyword)) continue;
    // std-rx27 (CR 602.2b, 118.9): "the first equip ability you activate each turn": none with that keyword activated by the player this turn, and a cost of mana alone
    // (an optional alternative the player may decline: not applied to another cost)
    if (e.applies.firstEachTurn === true) {
      if (a.keyword === undefined || (s.turnActivations[`kw:${player}:${a.keyword}`] ?? 0) > 0) continue;
      const c = def.cost as unknown as Record<string, unknown>;
      if (Object.keys(c).some((k) => c[k] !== undefined && k !== 'mana')) continue;
    }
    const cx: EvalCx = { s, all: ctx.view, source: src.source, controller: src.controller };
    if (!playerPredIncludes(cx, e.applies.caster, player)) continue;
    // r3-cost (CR 109.2): "activated abilities of creatures" are those of creature permanents: a source filter that names no zone is the battlefield
    // (objectMatches reads such a filter in any zone, so a creature card's ability in a graveyard would match)
    const m = a.source === undefined ? true : objectMatches(cx, source.id, a.source.zone === undefined ? { ...a.source, zone: 'battlefield' } : a.source);
    if (m === false) continue;
    out.push({ def: e, source: src.source, controller: src.controller, name: src.name, text: src.text, cx, ...(m === undefined ? { unknown: true as const } : {}) });
  }
  return out;
}

/** p2-cost-statics-2: an amount counted from the targets of the spell or ability (`spellTargetCount`, alone or in arithmetic). */
const targetCounted = (q: Quantity | undefined): boolean =>
  q !== undefined && typeof q === 'object' && (q.q === 'spellTargetCount' || (q.q === 'math' && q.args.some((x) => targetCounted(x))));

/**
 * std-rx26 (CR 702.170a, 116.2k, 601.2f, 118.7; capability `feature:costMod.plot`; cites unverified): the modifiers of static abilities that apply to the cost
 * `player` pays to plot a card from their hand ("Plotting cards from your hand costs {2} less"). Applied by core/special/plot.ts with `modifyMana`.
 */
export function plotCostModsFor(s: GameState, player: PlayerId): CostModHit[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const out: CostModHit[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'costMod' || e.applies.plot !== true || e.applies.self === true || e.applies.spells !== undefined || e.applies.abilities !== undefined) continue;
    const cx: EvalCx = { s, all: ctx.view, source: src.source, controller: src.controller };
    if (!playerPredIncludes(cx, e.applies.caster, player)) continue;
    out.push({ def: e, source: src.source, controller: src.controller, name: src.name, text: src.text, cx });
  }
  return out;
}

/**
 * Cloud std-woe (CR 601.2f, 602.2b, 605.1a, 605.3a; capability `feature:costMod.abilities.reduce`): the mana cost of a MANA ability of `source` once the modifiers of
 * other objects' static abilities apply ("Activated abilities of lands you control cost {1} less to activate": a mana ability is an activated ability, so "{1}, {T}: Add
 * one mana of any color" costs {T} only). A mana ability has no cost change of its own (types/ability.ts#ActivatedAbilityDef.costChange). `mana` unchanged when no
 * modifier applies; null when an amount can't be worked out (the caller does not offer the ability, never a guessed cost). Reductions never take a cost below
 * {0} (CR 118.7, statics/costmods.ts#modifyMana).
 */
export function abilityManaCost(s: GameState, player: PlayerId, source: GameObject, def: ActivatedAbilityDef, mana: readonly ManaSymbol[]): ManaSymbol[] | null {
  const hits = abilityCostModsFor(s, player, source, def);
  if (hits.length === 0) return [...mana];
  const r = modifyMana(mana, hits);
  return 'unknown' in r ? null : r.mana;
}

/**
 * std-rh (CR 116.2m, 709.5e, 601.2f, 118.7; capability `feature:costMod.unlock`): the modifiers of static abilities that apply to the unlock cost `player` pays
 * ("Unlock costs you pay cost {1} less"): the unlocking player is one `caster` names, relative to the modifier's controller. An unlock is a special action, not a spell.
 */
export function unlockCostMods(s: GameState, player: PlayerId): CostModHit[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const out: CostModHit[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'costMod' || e.applies.unlock !== true) continue;
    const cx: EvalCx = { s, all: ctx.view, source: src.source, controller: src.controller };
    if (!playerPredIncludes(cx, e.applies.caster, player)) continue;
    out.push({ def: e, source: src.source, controller: src.controller, name: src.name, text: src.text, cx });
  }
  return out;
}

/** The unlock cost `mana` of a door once the modifiers apply; null when an amount can't be worked out (the door is not offered, never a guessed cost). */
export function unlockManaCost(s: GameState, player: PlayerId, mana: readonly ManaSymbol[]): ManaSymbol[] | null {
  const hits = unlockCostMods(s, player);
  if (hits.length === 0) return [...mana];
  const r = modifyMana(mana, hits);
  return 'unknown' in r ? null : r.mana;
}

/** Does the modifier apply to this spell? `undefined` when its filter can't be evaluated here (the caller refuses the cast). */
function appliesToSpell(cx: EvalCx, e: CostModDef, spell: ObjectId, player: PlayerId, actor: Actor): boolean | undefined {
  const a = e.applies;
  if (!playerPredIncludes(cx, a.caster, player)) return false;
  if (a.spells !== undefined && a.spells.targets !== undefined) {
    const { targets, ...rest } = a.spells;
    const m = objectMatches(cx, spell, rest, actor);
    return m !== true ? m : spellTargetsSource(cx, e, spell, targets);
  }
  if (a.spells !== undefined) return objectMatches(cx, spell, a.spells, actor);
  return a.abilities === undefined && a.unlock !== true && a.plot === undefined; // a modifier of abilities only (std-rh: or of unlock costs; std-rx26: or of plotting) is not about spells
}

/**
 * FAST4 T21 (capability `feature:costMod.spellTargets`): "spells your opponents cast that target ~" (CR 115.9b): the spell's chosen targets include the
 * modifier's source. Targets are chosen before the total cost is determined (CR 601.2c, 601.2f); before the spell is cast (castCheck: no stack record) it
 * targets nothing yet, so an increase is not applied there and a reduction is (the cheapest its targets could make it; the cast itself decides once the
 * targets are chosen). Only `{ref:'self'}` is evaluated:
 * any other reference makes the cost unknown (the cast is refused with an explanation, never a guess).
 */
function spellTargetsSource(cx: EvalCx, e: CostModDef, spell: ObjectId, targets: NonNullable<ObjectFilter['targets']>): boolean | undefined {
  // p2-cost-statics-2 (CR 115.9b, 601.2c, 601.2f; capability `feature:costMod.spellTargets.each`): "spells your opponents cast that target a creature or planeswalker
  // you control": one of the spell's chosen targets is an object of the description, as it is when the total cost is determined (an object filter only; a player
  // target never matches it)
  const each = targets.ref === 'each' && 'filter' in targets ? targets.filter : undefined;
  if ((targets.ref !== 'self' && each === undefined) || cx.source === null) return undefined;
  const st = cx.s.objects[spell]?.stack;
  if (st === undefined) return e.change.kind === 'reduce'; // castCheck: the cheapest the targets could make it (statics/costmods.ts#filteredTargetCount)
  if (each === undefined) return st.targets.flat().some((t) => t.kind === 'object' && t.id === cx.source);
  let unknown = false;
  for (const t of st.targets.flat()) {
    if (t.kind !== 'object') continue;
    const m = objectMatches(cx, t.id, each.zone === undefined ? { ...each, zone: 'battlefield' } : each); // "a creature you control": a permanent (CR 109.2)
    if (m === true) return true;
    if (m === undefined) unknown = true;
  }
  return unknown ? undefined : false;
}

// ---- Applying them to a mana cost -----------------------------------------------------------------------------------------------------------------------

/** Extra quantities the caller can evaluate (the history), or undefined. */
export type ExtraQuantity = (q: Quantity, hit: CostModHit) => number | undefined;

export type ModifiedMana = { mana: ManaSymbol[]; applied: string[] } | { unknown: CostModHit };

/** The value of a modifier's quantity: statics/match.ts, `spellTargetCount`, the caller's extras, through `math` and `live`. */
export function costQuantity(hit: CostModHit, q: Quantity, extra?: ExtraQuantity): number | undefined {
  if (typeof q === 'number') return q;
  switch (q.q) {
    case 'math': {
      const args: number[] = [];
      for (const a of q.args) {
        const v = costQuantity(hit, a, extra);
        if (v === undefined) return undefined;
        args.push(v);
      }
      return evalQuantity(hit.cx, { ...q, args });
    }
    case 'live': return costQuantity(hit, q.value, extra);
    // r4-cost (CR 601.2c, 601.2f, 105.2): "for each color of the creature it targets", "for each +1/+1 counter on the creature it targets"
    case 'distinct': if (q.what === 'colors' && q.among.ref === 'target' && hit.targets !== undefined) return targetValue(hit, q.among.id, (id) => hit.cx.all.get(id)?.colors.length ?? 0); break;
    case 'counters': if (q.on.ref === 'target' && hit.targets !== undefined) { const kind = q.kind; return targetValue(hit, (q.on as { id: string }).id, (id) => countersOf(hit.cx.s, id, kind)); } break;
    case 'spellTargetCount': {
      // r4-cost (CR 602.2b): an activated ability's targets ("This ability costs {1} less to activate if it targets a creature with power 3 or less")
      if (hit.targets !== undefined) {
        const t = hit.targets();
        if (q.filter === undefined) return t !== undefined ? t.flat().length : 0;
        return filteredTargetCount(hit, q.filter, t, true);
      }
      const st = hit.source !== null ? hit.cx.s.objects[hit.source]?.stack : undefined;
      if (q.filter === undefined) return st ? st.targets.flat().length : 0; // CR 601.2c, 601.2f: the targets announced so far (none before the spell is on the stack)
      return filteredTargetCount(hit, q.filter, st?.targets);
    }
    default:
  }
  return evalQuantity(hit.cx, q) ?? extra?.(q, hit);
}

/** r4-cost: the counters of a kind (or of every kind) on an object. */
function countersOf(s: GameState, id: ObjectId, kind: string): number {
  const cs: Record<string, number> = s.objects[id]?.counters ?? {};
  return kind === 'any' ? Object.values(cs).reduce((a, b) => a + b, 0) : (cs[kind] ?? 0);
}

/**
 * r4-cost (CR 601.2c, 601.2f): a value of the object an activated ability targets with spec `id` ("t0" is the first spec), once its targets are announced; a
 * spec with no object target counts 0. Before that (the legality check) a reduction takes the greatest value among the permanents on the battlefield (the most it
 * could be) and an increase 0, so an ability is never refused for a cost its target could still lower (the same rule as filteredTargetCount).
 */
function targetValue(hit: CostModHit, id: string, value: (id: ObjectId) => number): number | undefined {
  const index = /^t(\d+)$/.exec(id);
  if (index === null) return undefined;
  const t = hit.targets!();
  if (t !== undefined) {
    const obj = (t[Number(index[1])] ?? []).find((c) => c.kind === 'object');
    return obj === undefined || obj.kind !== 'object' ? 0 : value(obj.id);
  }
  if (hit.def.change.kind !== 'reduce') return 0;
  return hit.cx.s.zones.battlefield.reduce((m, o) => Math.max(m, value(o)), 0);
}

/**
 * FAST4 T21: the spell's targets that are objects matching `filter` ("if it targets a tapped creature"), as they are when the total cost is determined
 * (CR 601.2c: targets are chosen before CR 601.2f). Before the spell is cast (actions/cast.ts#castCheck, no stack record yet) nothing is chosen, and castCheck
 * asks whether SOME choice leaves the cost payable: a reduction then counts every object on the battlefield that matches (the most it could be), an increase
 * none (the least), so a spell is never refused for a cost its targets could still lower. `undefined` (cost unknown) when the filter can't be evaluated.
 */
function filteredTargetCount(hit: CostModHit, filter: ObjectFilter, targets: readonly (readonly TargetChoice[])[] | undefined, ability = false): number | undefined {
  if (!ruleFilterEvaluable(filter)) return undefined;
  // "a tapped creature", "a blue permanent" are on the battlefield (a filter's default zone, statics/match.ts#filterMatches); "a blue spell" says the stack.
  // objectMatches reads a filter without a zone in any zone, so the default is written out (a blue spell is not "a blue permanent", CR 110.1)
  const where: ObjectFilter = filter.zone === undefined ? { ...filter, zone: 'battlefield' } : filter;
  // CR 115.5: a spell never targets itself; an ability's source may be its target (r4-cost: "Equip abilities you activate that target ~")
  const ids = targets !== undefined ? targets.flat().flatMap((t) => (t.kind === 'object' ? [t.id] : [])) : hit.def.change.kind === 'reduce' ? objectsIn(hit.cx.s, where.zone!).filter((id) => ability || id !== hit.source) : [];
  let n = 0;
  for (const id of ids) {
    const m = objectMatches(hit.cx, id, where);
    if (m === undefined) return undefined;
    if (m) n++;
  }
  return n;
}

/** The objects in a filter's zone (or zones), for the upper bound of a target count before targets are chosen. */
function objectsIn(s: GameState, zone: NonNullable<ObjectFilter['zone']>): ObjectId[] {
  const names: string[] = zone === 'any' ? ['battlefield', 'stack', 'exile', 'command', 'hand', 'graveyard', 'library'] : Array.isArray(zone) ? zone : [zone];
  const out: ObjectId[] = [];
  for (const name of names) {
    if (name === 'battlefield' || name === 'stack' || name === 'exile' || name === 'command') out.push(...s.zones[name]);
    else if (name === 'hand' || name === 'graveyard' || name === 'library') for (const p of s.players) out.push(...(s.zones[name][p.id] ?? []));
  }
  return out;
}

const genericOf = (mana: readonly ManaSymbol[]): number => mana.reduce((n, m) => n + (m.kind === 'generic' ? m.amount : 0), 0);

/** Remove one mana of `color` from the colored component, or report that there was none (CR 118.7b-c). Preference: plain, Phyrexian, hybrid symbols. */
function takeColor(rest: ManaSymbol[], color: Color): boolean {
  const order: ((m: ManaSymbol) => boolean)[] = [
    (m) => m.kind === 'colored' && m.color === color,
    (m) => m.kind === 'phyrexian' && m.color === color,
    (m) => (m.kind === 'hybrid' || m.kind === 'hybridPhyrexian') && m.colors.includes(color),
    (m) => (m.kind === 'monoHybrid' || m.kind === 'colorlessHybrid') && m.color === color,
  ];
  for (const test of order) {
    const i = rest.findIndex(test);
    if (i >= 0) {
      rest.splice(i, 1);
      return true;
    }
  }
  return false;
}

/**
 * Take one mana symbol `m` off a cost whose generic part is `generic` and whose other symbols are `rest` (changed in place), CR 118.7: specific mana first
 * (colored, colorless, hybrid, Phyrexian), a symbol the cost has no such mana for reduces the generic part instead (CR 118.7b-g). Returns the new generic
 * amount (it may go below zero: the caller floors it), or undefined for an {X} (nothing can be known).
 */
function subtractSymbol(rest: ManaSymbol[], generic: number, m: ManaSymbol): number | undefined {
  switch (m.kind) {
    case 'generic': return generic - m.amount;
    case 'snow': return generic - 1; // CR 118.7g
    case 'colored': case 'phyrexian': return takeColor(rest, m.color) ? generic : generic - 1; // CR 118.7b-c, 118.7f
    case 'colorless': { const i = rest.findIndex((x) => x.kind === 'colorless'); if (i >= 0) { rest.splice(i, 1); return generic; } return generic - 1; } // CR 118.7d
    case 'hybrid': case 'hybridPhyrexian': return m.colors.some((c) => takeColor(rest, c)) ? generic : generic - 1; // CR 118.7e: the half that saves the most
    case 'monoHybrid': return takeColor(rest, m.color) ? generic : generic - m.generic;
    case 'colorlessHybrid': {
      if (takeColor(rest, m.color)) return generic;
      const i = rest.findIndex((x) => x.kind === 'colorless');
      if (i >= 0) { rest.splice(i, 1); return generic; }
      return generic - 1;
    }
    case 'variable': return undefined;
  }
}

/**
 * T35 (CR 702.193b, 118.7): `mana` reduced by the mana cost `by` ("reduce the cost by its mana cost", power-up): generic mana reduces generic mana, colored and
 * colorless mana reduce mana of the same type, and any excess reduces that much generic mana; never below {0}. Null when `by` holds an {X} (a permanent's mana
 * cost never does, CR 202.1b) or `mana` holds one (`mana` has X substituted).
 */
export function reduceManaBy(mana: readonly ManaSymbol[], by: readonly ManaSymbol[]): ManaSymbol[] | null {
  if (mana.some((m) => m.kind === 'variable')) return null;
  let generic = genericOf(mana);
  const rest: ManaSymbol[] = mana.filter((m) => m.kind !== 'generic');
  for (const m of by) {
    const g = subtractSymbol(rest, generic, m);
    if (g === undefined) return null;
    generic = Math.max(0, g);
  }
  return generic > 0 ? [{ kind: 'generic', amount: generic }, ...rest] : rest;
}

/**
 * Apply the modifiers to a mana cost (CR 601.2f, 118.7). `mana` has X already substituted (CR 107.3a), so a generic reduction reduces the X part too. Returns
 * the new cost and one line per applied modifier, or the first modifier whose amount can't be determined.
 */
export function modifyMana(mana: readonly ManaSymbol[], hits: readonly CostModHit[], extra?: ExtraQuantity): ModifiedMana {
  const unknown = hits.find((h) => h.unknown);
  if (unknown) return { unknown };
  let generic = genericOf(mana);
  let rest: ManaSymbol[] = mana.filter((m) => m.kind !== 'generic');
  const applied: string[] = [];
  const amountOf = (h: CostModHit): number | undefined | null => (h.def.change.generic === undefined ? null : costQuantity(h, h.def.change.generic, extra));
  const byKind = (k: CostModDef['change']['kind']): CostModHit[] => hits.filter((h) => h.def.change.kind === k);
  // FAST4 T21: `mana` is applied `times` times (default once): "{2}{R} more for each target beyond the first", "{3} less if it targets a tapped creature"
  const timesOf = (h: CostModHit): number | undefined => {
    if (h.def.change.times === undefined) return 1;
    const t = costQuantity(h, h.def.change.times, extra);
    return t === undefined ? undefined : Math.max(0, Math.floor(t));
  };
  const manaOf = (h: CostModHit, t: number): ManaSymbol[] => Array.from({ length: t }, () => h.def.change.mana ?? []).flat();

  // Increases (and additional mana) first (CR 601.2f).
  for (const h of byKind('increase')) {
    const n = amountOf(h);
    const t = timesOf(h);
    if (n === undefined || t === undefined) return { unknown: h };
    for (const m of manaOf(h, t)) {
      if (m.kind === 'variable') return { unknown: h };
      if (m.kind === 'generic') generic += m.amount;
      else rest.push(m);
    }
    if (n !== null && n > 0) generic += n;
    applied.push(`${h.name}: +${describe(h.def.change.mana, n, t)}`);
  }
  // Reductions: specific mana first (CR 118.7b-g), then generic amounts (CR 118.7a); never below zero.
  // r3-cost (CR 601.2f, 118.7): a reduction that "can't reduce the mana in that cost to less than one mana" (`floor: 'one'`) is applied first: the player
  // may apply reductions in any order, and this order never leaves more to pay (applied after another one, it could not reduce a cost already down to one
  // mana). It reduces generic mana only: one with a specific mana symbol is unknown (never a guess).
  const reductions = [...byKind('reduce').filter((h) => h.def.change.floor === 'one'), ...byKind('reduce').filter((h) => h.def.change.floor !== 'one')];
  for (const h of reductions) {
    const n = amountOf(h);
    const t = timesOf(h);
    if (n === undefined || t === undefined) return { unknown: h };
    const one = h.def.change.floor === 'one';
    if (one && manaOf(h, t).some((m) => m.kind !== 'generic')) return { unknown: h };
    const before = generic + rest.length; // the mana in the cost: each symbol other than generic is one mana (a hybrid symbol is paid with one)
    for (const m of manaOf(h, t)) {
      const g = subtractSymbol(rest, generic, m);
      if (g === undefined) return { unknown: h };
      generic = g;
    }
    if (n !== null && n > 0) generic -= n;
    generic = Math.max(0, generic, one ? Math.min(1, before) - rest.length : 0);
    applied.push(`${h.name}: -${describe(h.def.change.mana, n, t)}`);
  }
  // A cost set outright ("costs {N}") directly affects the total cost: applied last (CR 601.2f).
  for (const h of byKind('set')) {
    const n = amountOf(h);
    if (n === undefined || h.def.change.times !== undefined || (h.def.change.mana ?? []).some((m) => m.kind === 'variable')) return { unknown: h }; // `times` is not for a set cost
    rest = (h.def.change.mana ?? []).filter((m) => m.kind !== 'generic');
    generic = genericOf(h.def.change.mana ?? []) + (n ?? 0);
    applied.push(`${h.name}: costs ${describe(h.def.change.mana, n)}`);
  }
  generic = Math.max(0, generic); // CR 601.2f, 118.7: never less than {0}
  return { mana: generic > 0 ? [{ kind: 'generic', amount: generic }, ...rest] : rest, applied };
}

function describe(mana: ManaCost | undefined, n: number | null, times = 1): string {
  const once = (mana ?? []).map((m) => (m.kind === 'generic' ? `{${m.amount}}` : m.kind === 'colored' ? `{${m.color}}` : m.kind === 'colorless' ? '{C}' : `{${m.kind}}`));
  const parts = times === 1 ? once : once.length > 0 ? [`${once.join('')} x${times}`] : [];
  if (n !== null) parts.push(`{${n}}`);
  return parts.join('') || '{0}';
}

