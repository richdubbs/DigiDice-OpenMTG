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
import { commanderOfCard } from './commander';
import { readLink } from './links';
import { isFirstTypedActivation } from './typed-activations';
import { evalCondition, evalQuantity, objectsOf, STATIC_QUANTITY_KINDS, type EvalCx } from './match';
import { objectMatches, ruleFilterEvaluable, spellActor, type Actor } from './rule-match';
import { charsViewOf, defHasRuleEffects, overlayAsSpell, overlayZone, playerPredIncludes, ruleContext, spellFaceChars, type CharsView } from './rule-sources';
import { namedPermitSpellKeyword } from './play-permits'; // edh-d-91

/**
 * The quantity kinds a cost modifier's amount may use (design 5.2: `rq:cost.<kind>`): what statics/match.ts evaluates, `spellTargetCount` (below) and
 * `happenedCount`, which actions/cast.ts#modifiedPlan supplies from the history (the only caller that applies modifiers).
 */
export const COST_QUANTITY_KINDS: ReadonlySet<string> = new Set([...STATIC_QUANTITY_KINDS, 'spellTargetCount', 'happenedCount', 'happenedDistinct' /* edh-next-58 */, 'happenedPlayers', 'lifeGainedThisTurn', 'opponentsAttacked', 'casterSpellsCastThisTurn', 'casterControlledCount', 'chosenColorsOf' /* edh-d-45 */, 'sharedCardTypes' /* edh-d-90 */]);

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
  /** edh-next-58 (CR 601.2c, 601.2f): the spell the modifier is applied to (for `spellTargetCount` of another object's modifier of spells); absent for an ability's cost. */
  spell?: ObjectId;
  /** edh-next-107 (CR 601.2c, 602.2b): the modifier applies only to an ability whose announced targets include the modifier's own source (`applies.abilities.source.targets: {ref:'self'}`). */
  abilityTargetsSelf?: true;
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
export function applicableCostMods(s: GameState, spell: ObjectId, player: PlayerId, chars?: Chars, via?: string): CostModDef[] {
  return costModsFor(s, spell, player, chars, false, via).map((h) => h.def); // edh-next-48's `via` after the face-down flag another round added (merge of both)
}

/** `applicableCostMods` with the context each modifier is evaluated in. */
export function costModsFor(s: GameState, spell: ObjectId, player: PlayerId, chars?: Chars, faceDown = false, via0?: string): CostModHit[] {
  const ctx = ruleContext(s);
  const o = s.objects[spell];
  const def = o ? s.defs[o.defId] : undefined;
  if (!o || !def) return [];
  const onStack = o.zone === 'stack';
  // edh-next-48 (CR 601.2f, 118.9; Visions of Dominance): the alternative cost the spell is cast for ("This spell costs {X} less to cast this way"): the one the caller names, else the one a spell on the stack paid
  const via = via0 ?? (onStack ? o.stack?.costsPaid.alternative : undefined);
  // A card that is not a spell yet has its own modifiers too (affinity): they are read from the card even when nothing else in the game has a rule effect.
  // std-rx26: or a keyword a waiting "the next spell you cast this turn has affinity for artifacts" would give it (statics/rule-sources.ts#overlayAsSpell)
  const rider = (!onStack && (s.turn.nextSpell ?? []).some((r) => r.rider === 'keyword' && r.player === player)) || (s.turn.nextSpell ?? []).some((r) => r.rider === 'reduce' && r.player === player); // edh-c-53: and a waiting "the next spell you cast costs {1} less"
  if (!ctx && (onStack || !defHasRuleEffects(def)) && !rider && o.castReduce === undefined) return [];
  // The spell as CR 601.2f sees it: on the stack, with the characteristics of the face being cast.
  const own = onStack ? undefined : chars ? { ...chars, controller: player } : spellFaceChars(s, o, 0, player);
  // P1: the overlay (a copy of the whole object map) is built the first time a modifier needs it; most spells meet none
  let at: { s2: GameState; view: CharsView } | undefined;
  const spellEnv = (): { s2: GameState; view: CharsView } => {
    if (at) return at;
    // edh-d-12 (CR 708.4, 601.2f; Kadena, Slinking Sorcerer): a card about to be cast face down is a face-down spell from the moment it is announced, so a modifier of "face-down creature spells" sees it so
    const s2 = onStack ? s : faceDown ? { ...s, objects: { ...s.objects, [spell]: { ...o, zone: 'stack' as const, faceDown: true } } } : overlayZone(s, spell, 'stack');
    const base = ctx?.view ?? charsViewOf(s);
    // edh-cast-2 (CR 604.3, 601.2f, 208.2a; Goreclaw): a card's characteristic-defining ability works in every zone, so a "*" power or toughness of the face being cast
    // ("Ulvenwald Hydra") is the number the ability gives it as the spell; a "*" that no ability evaluates stays "*" (the modifier then fails closed)
    const star = (v: string | undefined): boolean => v !== undefined && !/^-?\d+$/.test(v);
    let seen = own;
    if (own && !onStack && (star(own.power) || star(own.toughness))) {
      const c = charsViewOf(s2).get(spell);
      if (c) seen = { ...own, ...(star(own.power) && c.power !== undefined ? { power: c.power } : {}), ...(star(own.toughness) && c.toughness !== undefined ? { toughness: c.toughness } : {}) };
    }
    // edh-c-24 (CR 702.73a, 205.3m, 604.3; Mistform Warchief): changeling works in every zone, so the spell has every creature type: "share a creature type" reads them from the view
    if (own && !onStack && own.keywords.some((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword) === 'changeling')) {
      const c = charsViewOf(s2).get(spell);
      if (c) seen = { ...(seen ?? own), subtypes: c.subtypes };
    }
    return (at = { s2, view: seen ? base.with(s2, new Map([[spell, seen]])) : s2 === s ? base : base.with(s2, new Map()) });
  };
  const actor = spellActor(o); // CR 601.2a: a spell, cast from where the card is
  const out: CostModHit[] = [];
  for (const src of ctx?.sources ?? []) {
    const e = src.effect;
    if (e.s !== 'costMod') continue;
    const { s2, view } = spellEnv();
    const cx: EvalCx = { s: s2, all: view, source: src.source, controller: src.controller };
    if (e.applies.self === true) {
      if (e.applies.via !== undefined && e.applies.via !== via) continue;
      if (src.source === spell) out.push({ def: e, source: spell, controller: player, name: src.name, text: src.text, cx: { ...cx, controller: player } });
      continue;
    }
    if (e.applies.via !== undefined && e.applies.via !== via) continue; // edh-d-45 (CR 702.34a, 601.2f; Catalyst Stone): "Flashback costs you pay cost {2} less" changes only the spell cast for that alternative cost
    const applies = appliesToSpell(cx, e, spell, player, actor);
    if (applies !== false) out.push({ def: e, source: src.source, controller: src.controller, name: src.name, text: src.text, cx, ...(applies === undefined ? { unknown: true as const } : {}) });
  }
  // edh-c-53 (CR 601.2f, 118.7, 611.2; Hardened Berserker): a waiting "the next spell you cast this turn costs {1} less" rider of the caster, for a spell its filter matches;
  // core/turn-effects.ts#takeNextSpellRiders uses it up as that spell is cast
  for (const r of s.turn.nextSpell ?? []) {
    if (r.rider !== 'reduce' || r.mana === undefined || r.player !== player) continue;
    const { s2, view } = spellEnv();
    const cx: EvalCx = { s: s2, all: view, source: r.sourceId ?? null, controller: r.controller };
    const rdef: CostModDef = { s: 'costMod', applies: { spells: r.filter ?? {}, caster: 'you' }, change: { kind: 'reduce', mana: r.mana } };
    const applies = appliesToSpell(cx, rdef, spell, player, actor);
    if (applies !== false) out.push({ def: rdef, source: r.sourceId ?? null, controller: r.controller, name: r.sourceId !== undefined ? (s.defs[s.objects[r.sourceId]?.defId ?? '']?.name ?? 'an effect') : 'an effect', text: 'the next spell you cast this turn costs less to cast', cx, ...(applies === undefined ? { unknown: true as const } : {}) });
  }
  // edh-next-132 (CR 601.2f, 707.12; God-Eternal Kefnet): the reduction a copy of a card was created with ("That copy costs {2} less to cast"), of its own cost only
  if (o.castReduce !== undefined) { // (also once the spell is on the stack, as its total cost is paid: CR 601.2a, 601.2f)
    const { s2, view } = spellEnv();
    const rdef: CostModDef = { s: 'costMod', applies: { self: true, caster: 'you' }, change: { kind: 'reduce', mana: o.castReduce } };
    out.push({ def: rdef, source: spell, controller: player, name: 'the effect that created the copy', text: 'that copy costs less to cast', cx: { s: s2, all: view, source: spell, controller: player } });
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
        if (e.s !== 'costMod' || e.applies.self !== true || (e.applies.via !== undefined && e.applies.via !== via)) continue;
        const { s2, view } = spellEnv();
        out.push({ def: e, source: spell, controller: player, name: c?.name ?? '', text: d.text, cx: { s: s2, all: view, source: spell, controller: player } });
      }
    }
  }
  // edh-d-91 (CR 601.2f, 702.41a; Chiss-Goria): a card not yet cast that a permission for named objects lets the player cast with affinity ("If you do, it has affinity for artifacts"): the
  // spell will have the keyword from the moment it is put on the stack (actions/cast.ts gives it), so its cost is determined with that reduction, read as the keyword library expands affinity
  if (!onStack) {
    const k = namedPermitSpellKeyword(s, player, spell);
    if (k !== null && k.keyword === 'affinity' && k.filter !== undefined) {
      const { s2, view } = spellEnv();
      const e: CostModDef = { s: 'costMod', applies: { self: true, caster: 'you' }, change: { kind: 'reduce', generic: { q: 'count', of: { ref: 'each', filter: { controller: 'you', anyOf: [k.filter] } } } } };
      out.push({ def: e, source: spell, controller: player, name: def.name, text: 'affinity, from the permission it is cast with', cx: { s: s2, all: view, source: spell, controller: player } });
    }
  }
  return out.map((h) => (h.spell === undefined ? { ...h, spell } : h)); // edh-next-58: every hit knows the spell it is applied to
}

/**
 * FAST5 T60 (CR 601.2f, 602.2b, 118.7; capability `feature:costMod.abilities.keyword`): the modifiers of ANOTHER object's static ability that apply to the cost of
 * activating this ability ("Exhaust abilities of other permanents you control cost {2} less to activate"): the activating player is one `caster` names (relative to
 * the modifier's controller), the ability is of the kind and has the wrapper keyword `applies.abilities` names, and its source is one `applies.abilities.source`
 * matches (relative to the modifier's own source: "other permanents you control"). A source filter the rule hooks can't evaluate makes the hit `unknown`, so the
 * activation is refused with an explanation, never charged a guessed amount.
 */
export function abilityCostModsFor(s: GameState, player: PlayerId, source: GameObject, def: ActivatedAbilityDef, planning = false): CostModHit[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const kind = def.isMana === true ? 'mana' : def.isLoyalty === true ? 'loyalty' : 'activated';
  const out: CostModHit[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'costMod' || e.applies.abilities === undefined || e.applies.self === true || e.applies.spells !== undefined) continue;
    const a = e.applies.abilities;
    if (a.kind !== undefined && a.kind !== kind) continue;
    if (a.exceptMana === true && kind === 'mana') continue; // edh-cast-6 (CR 605.1a): "abilities you activate that aren't mana abilities"
    // p2-cost-statics-2 (CR 605.1a, 115.1): a change by what the ability targets ("Abilities your opponents activate that target a Merfolk you control cost {2} more")
    // never applies to a mana ability, which has no targets
    if (kind === 'mana' && targetCounted(e.change.times)) continue;
    // r4-cost (CR 702.6a): "Equip abilities you activate ...": the ability a keyword stands for is that keyword's ability (keywords/expand.ts provenance)
    if (a.keyword !== undefined && a.keyword !== def.keyword && !(def.prov?.by === 'keyword' && def.prov.id === a.keyword)) continue;
    // std-rx27 (CR 602.2b, 118.9): "the first equip ability you activate each turn": none with that keyword activated by the player this turn, and a cost of mana alone
    // (an optional alternative the player may decline: not applied to another cost)
    if (e.applies.firstEachTurn !== undefined) {
      if (e.applies.firstEachTurn === 'yourTurns' && s.turn.activePlayer !== src.controller) continue; // edh-mana-keywords-8: "during each of your turns"
      // edh-next-124 (CR 602.2, 601.2f, 605.1a; Tezzeret, Betrayer of Flesh, rulings 2022-02-18): "the first activated ability of an artifact you activate each turn": with no keyword and a
      // source of one card type, the first activation this turn by the player of an ability (a mana ability too) of a permanent of that type (rules/typed-activations.ts)
      const firstType = firstOfTypeKind(e.applies);
      if (firstType !== null) {
        // (`planning`: the auto-payer plans several mana abilities before it activates any, so which one is the first is not known yet: it plans without this reduction, never
        // counting on mana it may not get; the reduction still applies to the one activated first, CR 601.2f)
        if (planning || e.applies.firstEachTurn !== true || !isFirstTypedActivation(s, player, firstType, source.id)) continue;
      } else {
      if (a.keyword === undefined || (s.turnActivations[`kw:${player}:${a.keyword}`] ?? 0) > 0) continue;
      const c = def.cost as unknown as Record<string, unknown>;
      // edh-next-117 (CR 702.29a, 118.9; Gavi, Nest Warden): the cycling cost is the mana of "Cycling {2}"; the discard of this card is part of the ability's cost but not of the cycling cost
      const discardSelfOnly = a.keyword === 'cycling' && Array.isArray(c['other']) && (c['other'] as { kind?: string; self?: boolean }[]).every((o) => o.kind === 'discard' && o.self === true);
      if (Object.keys(c).some((k) => c[k] !== undefined && k !== 'mana' && !(k === 'other' && discardSelfOnly))) continue;
      }
    }
    const cx: EvalCx = { s, all: ctx.view, source: src.source, controller: src.controller };
    if (!playerPredIncludes(cx, e.applies.caster, player)) continue;
    // r3-cost (CR 109.2): "activated abilities of creatures" are those of creature permanents: a source filter that names no zone is the battlefield
    // (objectMatches reads such a filter in any zone, so a creature card's ability in a graveyard would match)
    // edh-next-107 (CR 115.1, 601.2c, 601.2f, 602.2b; Bladegraft Aspirant: "Activated abilities of Equipment you control that target this creature cost {1} less to activate"): the ability's
    // announced targets include the modifier's own source (`targets: {ref:'self'}` of the source filter); actions/activate.ts#costChangeOf reads them (CostModHit.abilityTargetsSelf).
    // Any other reference makes the cost unknown (refused with an explanation, never a guess)
    const { targets: viaTargets, ...srcRest } = a.source ?? {};
    const selfTarget = viaTargets !== undefined && viaTargets.ref === 'self';
    if (selfTarget && kind === 'mana') continue; // a mana ability has no targets (CR 605.1a, 115.1): a modifier of abilities that target ~ never applies to it (reviewer finding)
    const srcFilter: ObjectFilter | undefined = a.source === undefined ? undefined : viaTargets === undefined ? a.source : srcRest;
    const m = srcFilter === undefined ? true : objectMatches(cx, source.id, srcFilter.zone === undefined ? { ...srcFilter, zone: 'battlefield' } : srcFilter);
    if (m === false) continue;
    out.push({ def: e, source: src.source, controller: src.controller, name: src.name, text: src.text, cx, ...(m === undefined || (viaTargets !== undefined && !selfTarget) ? { unknown: true as const } : {}), ...(selfTarget ? { abilityTargetsSelf: true as const } : {}) });
  }
  return out;
}

/**
 * edh-next-124 (Tezzeret, Betrayer of Flesh): the card type of "the first activated ability of an <type> you activate each turn": `firstEachTurn` with no keyword and no kind, and a
 * source filter that is exactly one card type (a zone of the battlefield allowed); null for any other shape.
 */
export function firstOfTypeKind(applies: CostModDef['applies']): string | null {
  const a = applies.abilities;
  if (applies.firstEachTurn === undefined || a === undefined || a.keyword !== undefined || a.kind !== undefined || a.exceptMana !== undefined || a.source === undefined) return null;
  const f = a.source as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined);
  if (!keys.every((k) => k === 'types' || (k === 'zone' && f[k] === 'battlefield'))) return null;
  return Array.isArray(f['types']) && f['types'].length === 1 && typeof f['types'][0] === 'string' ? f['types'][0] : null;
}

/**
 * edh-next-106 (CR 601.2f, 602.2b, 605.1a, 119.4; capability `feature:costMod.abilities.manaLife`): the life other objects' static abilities (or the object's own) make `player` pay to
 * activate this MANA ability ("Mana abilities of this land cost an additional 1 life to activate"); 0 for none. Only increases count, once for each modifier.
 */
export function abilityLifeCost(s: GameState, player: PlayerId, source: GameObject, def: ActivatedAbilityDef): number {
  return abilityCostModsFor(s, player, source, def).reduce((n, h) => n + (h.def.change.kind === 'increase' && typeof h.def.change.life === 'number' ? h.def.change.life : 0), 0);
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
export function abilityManaCost(s: GameState, player: PlayerId, source: GameObject, def: ActivatedAbilityDef, mana: readonly ManaSymbol[], planning = false): ManaSymbol[] | null {
  const hits = abilityCostModsFor(s, player, source, def, planning);
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
    if (m !== true) return m;
    const r = spellTargetsSource(cx, e, spell, targets);
    // edh-next-58 (CR 115.1, 601.2c, 601.2f; Monastery Siege): or one of its targets is the modifier's controller
    if (r === true || a.orTargetsYou !== true) return r;
    const st = cx.s.objects[spell]?.stack;
    if (st === undefined) return r; // castCheck: no targets chosen yet, as for an object target (a reduction is the most it could be, an increase the least)
    return st.targets.flat().some((t) => t.kind === 'player' && t.id === cx.controller) ? true : r;
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
    // edh-next-75 (CR 903.8, 601.2f; Myth Unbound): "for each time it's been cast from the command zone this game": the casts of the commander card the cost is being determined for, this
    // one not yet counted (actions/cast.ts counts it once the spell is cast); a spell that is not a commander card, and an ability's cost, count 0 / are unknown
    case 'commanderCasts': if (q.costSpell === true) {
      const o = hit.spell !== undefined ? hit.cx.s.objects[hit.spell] : undefined;
      return o?.kind === 'card' ? commanderOfCard(hit.cx.s, o.cardId)?.rec.casts ?? 0 : hit.spell === undefined ? undefined : 0;
    } break;
    // r4-cost (CR 601.2c, 601.2f, 105.2): "for each color of the creature it targets", "for each +1/+1 counter on the creature it targets"
    // edh-d-45 (CR 105.1, 601.2f, 607.2d; Seal of the Guildpact): "for each of the chosen colors it is": the colors the source kept under the link that the spell has
    case 'chosenColorsOf': {
      const chars = hit.spell !== undefined ? hit.cx.all.get(hit.spell) : undefined;
      const src = hit.source !== null ? hit.cx.s.objects[hit.source] : undefined;
      if (chars === undefined || src === undefined) return undefined;
      return (readLink(src, q.link)?.values ?? []).filter((v) => (chars.colors as readonly string[]).includes(v)).length;
    }
    // edh-d-90 (CR 601.2f, 205.2a, 607.2a; Cemetery Prowler): "for each card type they share with cards exiled with ~": the card types of the spell the cost is being determined for that at
    // least one object of the group has (each type counted once, however many of the group have it: ruling 2021-11-19); an ability's cost (no spell) or a group the statics can't read is unknown
    case 'sharedCardTypes': {
      const chars = hit.spell !== undefined ? hit.cx.all.get(hit.spell) : undefined;
      if (chars === undefined) return undefined;
      if (q.among.ref === 'each' && 'filter' in q.among && !ruleFilterEvaluable(q.among.filter)) return undefined;
      const theirs = new Set<string>();
      for (const id of objectsOf(hit.cx, q.among)) for (const t of hit.cx.all.get(id)?.types ?? []) theirs.add(t);
      return new Set(chars.types.filter((t) => theirs.has(t))).size;
    }
    case 'distinct': if (q.what === 'colors' && q.among.ref === 'target' && hit.targets !== undefined) return targetValue(hit, q.among.id, (id) => hit.cx.all.get(id)?.colors.length ?? 0); break;
    case 'counters': if (q.on.ref === 'target' && hit.targets !== undefined) { const kind = q.kind; return targetValue(hit, (q.on as { id: string }).id, (id) => countersOf(hit.cx.s, id, kind)); } break;
    // edh-next-49 (CR 208.1, 601.2c, 601.2f; Belt of Giant Strength): "costs {X} less to activate, where X is the power of the creature it targets": the power it has when the total cost is determined
    // (before the targets are chosen: the greatest power on the battlefield, as for the counters above); an undetermined power ("*" not yet defined) leaves the cost unknown
    case 'stat': if (q.of.ref === 'target' && q.stat === 'power' && !q.sum && q.agg === undefined && hit.targets !== undefined) {
      let unknown = false;
      const v = targetValue(hit, (q.of as { id: string }).id, (id) => { const raw: unknown = hit.cx.all.get(id)?.power; const x = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw === undefined || raw === null ? 0 /* no power: not a creature */ : Number.NaN; if (Number.isNaN(x)) unknown = true; return Number.isNaN(x) ? 0 : x; });
      return unknown ? undefined : v;
    } break;
    // edh-next-67 (CR 601.2f, 201.2, 404.1; Locket of Yesterdays): "for each card with the same name as that spell in your graveyard": the cards of the filter that share the NAME of the
    // spell the modifier is applied to (`sharesWith` the subject), counted as the total cost is determined
    case 'count': {
      const of = q.of;
      if (of.ref !== 'each' || !('filter' in of) || of.filter.sharesWith === undefined || of.filter.sharesWith.with.ref !== 'subject') break;
      const { sharesWith, ...rest } = of.filter;
      if (sharesWith.quality !== 'name' || sharesWith.other !== undefined || hit.spell === undefined || !ruleFilterEvaluable(rest)) return undefined;
      const names = (hit.cx.all.get(hit.spell)?.names ?? []).filter((n) => n !== ''); // CR 201.2a: objects share a name when they have at least one name in common (split cards, Rooms)
      if (names.length === 0) return 0; // a nameless object shares no name (CR 201.2)
      let n = 0;
      for (const id of objectsIn(hit.cx.s, rest.zone ?? 'battlefield')) {
        const m = objectMatches(hit.cx, id, rest);
        if (m === undefined) return undefined;
        if (m && (hit.cx.all.get(id)?.names ?? []).some((x) => names.includes(x))) n++;
      }
      return n;
    }
    case 'spellTargetCount': {
      // r4-cost (CR 602.2b): an activated ability's targets ("This ability costs {1} less to activate if it targets a creature with power 3 or less")
      if (hit.targets !== undefined) {
        const t = hit.targets();
        if (q.filter === undefined) return t !== undefined ? t.flat().length : 0;
        return filteredTargetCount(hit, q.filter, t, true);
      }
      const st = hit.spell !== undefined ? hit.cx.s.objects[hit.spell]?.stack : hit.source !== null ? hit.cx.s.objects[hit.source]?.stack : undefined; // edh-next-58: the spell the modifier is applied to (a self modifier: the same object)
      // edh-next-58 (CR 601.2c, 601.2f): before the spell is cast (castCheck) a reduction counts the most its targets could make it, so no spell is refused for a cost its targets could still lower
      // edh-next-58 (CR 601.2c, 115.3; Hinata ruling 2022-02-18): a modifier of OTHER spells counts the different players and objects the spell targets, not the times its text says "target"
      if (q.filter === undefined) return st ? (hit.def.applies.self === true ? st.targets.flat().length : new Set(st.targets.flat().map((t) => `${t.kind}:${t.id}`)).size) : hit.def.change.kind === 'reduce' && hit.def.applies.self !== true ? maxTargetsOf(hit) : 0; // CR 601.2c, 601.2f: the targets announced so far (none before the spell is on the stack)
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

/** `dealtDamageThisTurn` (rules/history.ts reads it the same way): this object was dealt damage this turn, an amount of 0 being no event (CR 614.7a). Read from the
 * game's history here, as statics/hooks.ts does, because statics import types, keywords and rules/base-chars only (design 5.4; edh-d-10's Bitter Downfall). */
const dealtDamageThisTurn = (s: GameState, id: ObjectId): boolean =>
  s.history.some((e) => e.turn === s.turn.number && e.ev === 'damage' && e.subject === id && e.facts['amount'] !== 0);

/**
 * FAST4 T21: the spell's targets that are objects matching `filter` ("if it targets a tapped creature"), as they are when the total cost is determined
 * (CR 601.2c: targets are chosen before CR 601.2f). Before the spell is cast (actions/cast.ts#castCheck, no stack record yet) nothing is chosen, and castCheck
 * asks whether SOME choice leaves the cost payable: a reduction then counts every object on the battlefield that matches (the most it could be), an increase
 * none (the least), so a spell is never refused for a cost its targets could still lower. `undefined` (cost unknown) when the filter can't be evaluated.
 */
function filteredTargetCount(hit: CostModHit, filterIn: ObjectFilter, targets: readonly (readonly TargetChoice[])[] | undefined, ability = false): number | undefined {
  // edh-cast-15 (CR 115.9b, 601.2c; Not of This World): "if it targets a spell or ability that targets a creature you control with power 7 or greater": the object the spell targets is
  // judged by the objects IT targets, which `targets` names as a group of a filter (the rule hooks read no `targets` field themselves): one of them must match that filter
  // edh-d-10 (CR 120.1, 601.2c, 601.2f; Bitter Downfall): "if it targets a creature that was dealt damage this turn": the history of the turn is read from the game state
  // (rules/history.ts#dealtDamageThisTurn) for each target, as it is when the total cost is determined; the rest of the filter goes to the rule hooks' evaluator
  const { targets: viaRef, dealtDamageThisTurn: needDealt, ...rest } = filterIn;
  if (viaRef !== undefined && (viaRef.ref !== 'each' || !('filter' in viaRef))) return undefined;
  const via: ObjectFilter | undefined = viaRef !== undefined && viaRef.ref === 'each' ? { ...viaRef.filter, ...(viaRef.filter.zone === undefined ? { zone: 'battlefield' as const } : {}) } : undefined;
  const filter: ObjectFilter = viaRef !== undefined || needDealt !== undefined ? rest : filterIn;
  if (!ruleFilterEvaluable(filter) || (via !== undefined && !ruleFilterEvaluable(via))) return undefined;
  // "a tapped creature", "a blue permanent" are on the battlefield (a filter's default zone, statics/match.ts#filterMatches); "a blue spell" says the stack.
  // objectMatches reads a filter without a zone in any zone, so the default is written out (a blue spell is not "a blue permanent", CR 110.1)
  // edh-c-8 (CR 601.2c, 108.2; Revoke Demise): "if it targets a creature card with mana value 3 or less" says a card, which is in no zone of the battlefield: a filter of cards (`isCard`) without a zone reads every zone
  const where: ObjectFilter = filter.zone === undefined ? { ...filter, zone: filter.isCard === true ? (targets === undefined ? 'graveyard' : 'any') : 'battlefield' } : filter; // before targets are chosen the most the cost could be reduced counts cards in graveyards only (the cast menu is not over-offered by libraries or hands)
  // CR 115.5: a spell never targets itself; an ability's source may be its target (r4-cost: "Equip abilities you activate that target ~")
  // edh-next-58 (CR 601.2c, 115.3; Battlefield Thaumaturge ruling 2014-04-26): a modifier of other spells counts each object the spell targets once, even when its text targets it more than once
  const once = (ids: ObjectId[]): ObjectId[] => (hit.def.applies.spells !== undefined && hit.def.applies.self !== true ? [...new Set(ids)] : ids);
  const ids = targets !== undefined ? once(targets.flat().flatMap((t) => (t.kind === 'object' ? [t.id] : []))) : hit.def.change.kind === 'reduce' ? objectsIn(hit.cx.s, where.zone!).filter((id) => ability || id !== hit.source) : [];
  let n = 0;
  for (const id of ids) {
    let m = objectMatches(hit.cx, id, where);
    if (m === undefined) return undefined;
    if (m && needDealt !== undefined && dealtDamageThisTurn(hit.cx.s, id) !== needDealt) m = false;
    if (m && via !== undefined) {
      // the objects that spell or ability targets (an ability's targets are on its stack record too), as they are now (CR 608.2h: not their targets' last known state, the cost is set as the spell is cast)
      const aimed = (hit.cx.s.objects[id]?.stack?.targets ?? []).flat().flatMap((t) => (t.kind === 'object' ? [t.id] : []));
      m = false;
      for (const t of aimed) {
        const v = objectMatches(hit.cx, t, via);
        if (v === undefined) return undefined;
        if (v) { m = true; break; }
      }
    }
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
    if (h.def.change.loyalty !== undefined && h.def.change.mana === undefined && h.def.change.generic === undefined) continue; // edh-next-142: a loyalty increase alone changes no mana (actions/activate.ts#costChangeOf)
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
    // edh-cast-4 (CR 601.2f, 118.7): "This effect reduces only the amount of colored mana you pay": a colored symbol takes off the cost's mana of its own color and nothing else
    // (never the generic part, which CR 118.7b would reduce); anything but colored symbols in such a reduction is unknown
    const only = h.def.change.coloredOnly === true;
    if (only && (n !== null || h.def.change.kind !== 'reduce' || manaOf(h, t).some((m) => m.kind !== 'colored'))) return { unknown: h };
    for (const m of manaOf(h, t)) {
      const g = only && m.kind === 'colored' ? (takeColor(rest, m.color), generic) : subtractSymbol(rest, generic, m);
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
  // edh-next-12 (CR 601.2f, 118.7; Trinisphere, ruling 2020-08-07): "costs three mana to cast" is applied after everything else: generic mana is added up to that many mana. A symbol whose
  // mana can't be counted here (a Phyrexian symbol may be paid with life, a monoHybrid or variable one varies) makes the cost unknown (fail closed); a hybrid symbol is one mana
  for (const h of byKind('floor')) {
    const n = h.def.change.generic;
    if (typeof n !== 'number' || h.def.change.mana !== undefined || h.def.change.times !== undefined) return { unknown: h };
    if (rest.some((m) => m.kind === 'variable')) return { unknown: h };
    // a Phyrexian symbol paid with life adds no mana and paid with mana adds one, a {2/W} symbol adds one mana or two: when even the fewest mana the cost can need is the floor or more, nothing changes
    // (Birthing Pod, Spectral Procession); otherwise the cost depends on a choice made later and is unknown (the cast is refused, never a guess)
    const flexible = rest.some((m) => m.kind === 'phyrexian' || m.kind === 'hybridPhyrexian' || m.kind === 'monoHybrid');
    const total = generic + rest.length;
    if (flexible) {
      const least = generic + rest.filter((m) => m.kind !== 'phyrexian' && m.kind !== 'hybridPhyrexian').length;
      if (least >= n) continue;
      return { unknown: h };
    }
    if (total < n) generic += n - total;
    applied.push(`${h.name}: costs at least ${n} mana`);
  }
  return { mana: generic > 0 ? [{ kind: 'generic', amount: generic }, ...rest] : rest, applied };
}

function describe(mana: ManaCost | undefined, n: number | null, times = 1): string {
  const once = (mana ?? []).map((m) => (m.kind === 'generic' ? `{${m.amount}}` : m.kind === 'colored' ? `{${m.color}}` : m.kind === 'colorless' ? '{C}' : `{${m.kind}}`));
  const parts = times === 1 ? once : once.length > 0 ? [`${once.join('')} x${times}`] : [];
  if (n !== null) parts.push(`{${n}}`);
  return parts.join('') || '{0}';
}


/**
 * edh-next-58 (CR 601.2c, 601.2f): before the spell is cast (castCheck) the most targets it could have, so a reduction per target is never counted beyond what the spell can aim at: the
 * target specs of its spell abilities (a modal one: no bound but 20; an Aura aims at one), the greatest over its faces.
 */
function maxTargetsOf(hit: CostModHit): number {
  const o = hit.spell !== undefined ? hit.cx.s.objects[hit.spell] : undefined;
  const def = o ? hit.cx.s.defs[o.defId] : undefined;
  if (!def) return 20;
  let best = 0;
  for (const face of def.faces) {
    let n = (face.subtypes ?? []).includes('Aura') ? 1 : 0;
    for (const a of face.abilities as unknown as { kind: string; modes?: unknown; effect?: { targets?: { max?: unknown }[] } }[]) {
      if (a.kind !== 'spell') continue;
      if (a.modes !== undefined) return 20;
      for (const t of a.effect?.targets ?? []) n += typeof t.max === 'number' ? t.max : 20;
    }
    best = Math.max(best, n);
  }
  return Math.min(20, best);
}
