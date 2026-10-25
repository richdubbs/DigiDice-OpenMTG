/**
 * Mana sources and providers for the payment solver. A "provider" is one unit of mana that the
 * solver may spend: either a unit already floating in the pool, or a unit a mana ability would
 * produce when activated. Activating a source adds ALL its units to the pool, but for the solver
 * each unit is an independent provider (an unused extra unit just floats, which is always harmless).
 */
import type { ManaRestriction } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { ManaSymbol, ManaType } from '../types/mana';
import { castOriginOf, type GameObject, type GameState } from '../types/state';
import { activatedAbilities, type ActivatedInfo } from './abilities';
import { charsOfObject, readingStable, type Chars } from './characteristics';
import { FACE_DOWN } from './base-chars';
import { matchesFilter } from './filter';
import { filterCtxOutside } from './filter-env';
import { computedManaUnits, inManaCostCheck, manaAbilityDenial, manaCostShapeNow, restrictionOf, unitOptions } from './mana';
import { abilityManaCost } from '../statics/costmods';

/**
 * What the mana being paid is FOR (design D8, CR 106.6): a spell being cast, or an ability of a source being activated. Mana with a spending restriction ("Spend this
 * mana only to cast creature spells", Cavern of Souls) can be spent only where its `ManaRestriction` allows. An unknown context spends no restricted mana.
 */
// FAST5X E8 INTERFACE CHANGE (additive): 'unlock', the unlock cost of a door of the Room `id` (CR 709.5e, 116.2m: a special action, neither a spell nor an ability)
// FAST5X E23 INTERFACE CHANGE (additive):
//   - 'spell' carries `x`, the value of X the payment is planned for (CR 601.2b, 202.3e: the spell's mana value on the stack counts it; read while the
//     largest payable X is looked for, before `stack.x` is set);
//   - 'ability' carries `keyword`, the keyword whose expansion the activated ability is (provenance `{by: 'keyword', id}`: "an equip ability", CR 702.6a);
//   - 'faceUp': the cost to turn the face-down permanent `id` face up (CR 116.2b, 702.37e, 702.168d, 708.7: a special action, neither a spell nor an ability);
//   - 'special': any other special action's cost (plotting a card, CR 116.2k, 702.170a): only mana restricted by `notSpells` pays it.
//   - before the card is cast (the legal actions, actions/cast.ts), 'spell' names the card, the face it would be cast with and whether it would be cast face
//     down: the restriction reads it as the spell it would be (CR 601.2a: on the stack, cast from its zone; CR 708.4: face down).
// FAST5X E29 INTERFACE CHANGE (additive): `anyType` on a spell = "mana of any type can be spent to cast that spell" (CR 609.4b): every mana symbol of the
// total cost may be paid with mana of any type (a {S} still needs mana from a snow source, CR 107.4h, which is not a type); read by the solver
// (rules/solver.ts `SolveInput.anyType`). Set by actions/cast.ts when a permission or a resolving effect says so.
export type SpendContext =
  | { kind: 'spell'; id: ObjectId; x?: number; face?: number; faceDown?: true; anyType?: true | 'color' } // 'color': Standard round I, a static's "as though it were mana of any color" (CR 609.4b)
  | { kind: 'ability'; id: ObjectId; keyword?: string; anyColor?: true } // std-rx32: anyColor, "as though it were mana of any color" (CR 609.4b)
  | { kind: 'unlock'; id: ObjectId }
  | { kind: 'faceUp'; id: ObjectId }
  | { kind: 'special'; id: ObjectId };

/** FAST5X E29 (CR 609.4b): may mana of any type pay for what `spend` is? */
export const anyTypeSpend = (spend: SpendContext | undefined): boolean => spend?.kind === 'spell' && spend.anyType === true;

/**
 * std-rx32 (CR 609.4b): the solver options a payment has: `anyType` (above) and `anyColor`, "you may spend mana as though it were mana of any color to activate
 * abilities of creatures you control" (an ability's `SpendContext.anyColor`, set by actions/activate.ts): a colored symbol may be paid with any mana.
 */
export const spendOptions = (spend: SpendContext | undefined): { anyType?: boolean; anyColor?: boolean } => ({
  ...(anyTypeSpend(spend) ? { anyType: true } : {}),
  ...((spend?.kind === 'ability' && spend.anyColor === true) || (spend?.kind === 'spell' && spend.anyType === 'color') ? { anyColor: true } : {}), // Standard round I: a spell's 'color'
});

/**
 * Whether mana with restriction `r`, produced by `manaSource`, may pay for `spend`: the spell (or the ability's source) must match the restriction's filter; a
 * missing filter means "not on those". The restriction is text of the mana's SOURCE (CR 106.6: "Spend this mana only to cast the last card exiled with this
 * artifact", "a creature spell of the chosen type"), so "this" (`self`, `linked`, `chosen`) is the source of the mana, and "you" the player paying (WP30
 * review). Mana whose source is unknown can't have "this" read: such a reference does not match.
 *
 * FAST5X E23 (CR 106.6): a restriction that says what the mana CAN'T pay for ("This mana can't be spent to cast a nonartifact spell", `notSpells`) allows
 * every other payment, an unknown context included (every spell is cast with a 'spell' context: actions/cast.ts; the other payments are abilities, special
 * actions and costs effects ask for, CR 118.12). Every other restriction lists what the mana CAN pay for, and an unknown context spends none of it.
 */
export function spendAllows(s: GameState, player: PlayerId, spend: SpendContext | undefined): (r: ManaRestriction, manaSource: ObjectId | undefined) => boolean {
  // The object the mana pays for and its characteristics, read once per payment check. FAST5X E23: a spell is read as the spell it is or would be (the
  // characteristics are always the real object's, from the cache: a copy of the object is never computed apart).
  let target: { o: GameObject; chars?: Chars } | undefined | null = null;
  const objectOf = (): { o: GameObject; chars?: Chars } | undefined => {
    if (target !== null) return target;
    const o = spend ? s.objects[spend.id] : undefined;
    if (o === undefined || spend?.kind !== 'spell') return (target = o === undefined ? undefined : { o });
    // CR 202.3e: on the stack, X is the value chosen for it; while the payment is planned for some X, the spell is read with that X
    if (o.zone === 'stack' && o.stack) {
      return (target = spend.x !== undefined && o.stack.x !== spend.x ? { o: { ...o, stack: { ...o.stack, x: spend.x } }, chars: charsOfObject(s, o) } : { o });
    }
    // FAST5X E23 (CR 601.2a, 708.4): not cast yet (the legal actions): the card as the spell it would be, on the stack, cast from its zone, face down (the
    // face-down 2/2's characteristics, CR 708.2a) if it would be cast face down
    const spell: GameObject = {
      ...o, zone: 'stack', ...(spend.faceDown ? { faceDown: true } : {}),
      stack: { kind: 'spell', face: spend.face ?? o.face ?? 0, targets: [], costsPaid: {}, castFrom: castOriginOf(o), caster: player, ...(spend.x !== undefined ? { x: spend.x } : {}) },
    };
    const own = charsOfObject(s, o);
    // Review E23 (CR 601.2a, 709.3, 715.3, 712.11): a card with more than one face is, as a spell, only the face being cast (the Adventure or Omen half, one
    // half of a split card, a back face), never the characteristics it has in its zone (the main face, or both halves combined, CR 709.4): those are read
    // on the spell as it would be on the stack (a copy computed apart, rules/characteristics.ts#charsOfObject). A one-faced card has the same face there.
    const multiFace = (s.defs[o.defId]?.faces.length ?? 1) > 1;
    const chars: Chars = spend.faceDown
      ? { ...own, ...FACE_DOWN, names: [], colors: [], supertypes: [], types: [...FACE_DOWN.types], subtypes: [], abilities: [], keywords: [], manaValue: 0 }
      : multiFace ? charsOfObject(s, spell) : own;
    return (target = { o: spell, chars });
  };
  const memo = new Map<string, boolean>();
  return (r, manaSource) => {
    const key = `${manaSource ?? ''}|${JSON.stringify(r)}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const ctx = filterCtxOutside(s, { controller: player, ...(manaSource !== undefined ? { sourceId: manaSource } : {}) });
    const matches = (filter: ManaRestriction['spells']): boolean => {
      const t = objectOf();
      return t !== undefined && filter !== undefined && matchesFilter(s, t.o, { ...filter, zone: 'any' }, t.chars ? { ...ctx, chars: t.chars } : ctx);
    };
    const allowed = ((): boolean => {
      if (r.notSpells !== undefined) return spend?.kind !== 'spell' || (objectOf() !== undefined && !matches(r.notSpells)); // FAST5X E23
      if (!spend) return false;
      switch (spend.kind) {
        case 'unlock': return r.unlock === true; // FAST5X E8 (CR 106.6, 709.5e): "... and unlock doors"
        case 'faceUp': return r.turnFaceUp !== undefined && matches(r.turnFaceUp); // FAST5X E23 (CR 116.2b): "... or turn a permanent face up"
        case 'special': return false; // neither a spell nor an ability (CR 116.2)
        case 'spell': return matches(r.spells);
        case 'ability': return (r.abilityKeyword === undefined || spend.keyword === r.abilityKeyword) && matches(r.abilities); // FAST5X E23 (CR 702.6a)
      }
    })();
    memo.set(key, allowed);
    return allowed;
  };
}

/**
 * FAST5X E23 (CR 106.6): whether `player` has mana with a spending restriction at hand: floating in the pool, or from a mana ability of a permanent they control.
 * A cheap test before the legal actions try every value of X for a spell only such mana could pay for (actions/cast.ts).
 */
export function hasRestrictedMana(s: GameState, player: PlayerId): boolean {
  if (s.players.find((p) => p.id === player)?.manaPool.some((u) => u.restriction !== undefined)) return true;
  return s.zones.battlefield.some((id) => {
    const o = s.objects[id];
    return o !== undefined && o.controller === player && activatedAbilities(s, o).some((a) => a.def.isMana === true && restrictionOf(a) !== undefined);
  });
}

export interface ManaMode {
  key: string;
  /** Spending restriction of the mana this ability adds (CR 106.6). */
  restriction?: ManaRestriction;
  info: ActivatedInfo;
  units: ManaType[][];
  sacrifices: boolean;
  /**
   * PAY1 INTERFACE CHANGE (additive): the units are an amount computed now ("Add X mana of any one color, where X is ~'s power", rules/mana.ts#computedManaUnits)
   * and every unit must be the same type ("any one color", CR 106.1b): the solver picks one type for all of them.
   */
  oneType?: boolean;
  /**
   * The ability also deals damage to its controller ("{T}: Add {W} or {B}. This land deals 1 damage to you.", `painUnits`): the solver uses it only when
   * painless mana can't pay instead (`sourceCost`).
   */
  pain?: true;
}

/** A permanent with at least one mana ability that can be activated right now. */
export interface ManaSource {
  objectId: ObjectId;
  name: string;
  modes: ManaMode[];
  snow: boolean;
  isCreature: boolean;
  isLand: boolean;
  /** Number of distinct mana types this source can produce: the fewer, the less flexible it is wasted when spent. */
  flex: number;
}

/**
 * All mana sources of a player that are usable now (CR 605.3a), in battlefield order. `exclude` lists permanents that are
 * spoken for by another part of the cost being paid (e.g. one that will be sacrificed by a mana ability of its own).
 */
export function manaSources(s: GameState, player: PlayerId, exclude?: ReadonlySet<ObjectId>, spend?: SpendContext): ManaSource[] {
  // W3b: a pure read of every permanent of `s`: the layered characteristics are checked once for the whole scan (readingStable), not once per object
  return readingStable(s, () => manaSourcesIn(s, player, exclude, spend));
}

function manaSourcesIn(s: GameState, player: PlayerId, exclude?: ReadonlySet<ObjectId>, spend?: SpendContext): ManaSource[] {
  const allows = spendAllows(s, player, spend);
  const out: ManaSource[] = [];
  for (const id of s.zones.battlefield) {
    const o = s.objects[id];
    if (!o || o.controller !== player || exclude?.has(id)) continue;
    const modes: ManaMode[] = [];
    for (const info of activatedAbilities(s, o)) {
      // FAST5X E5: only abilities whose cost is {T}, {Q} or "Sacrifice ~" are ordinary sources; the others are `extraManaModes` (below). "Activate only as a
      // sorcery" never pays a cost: the spell or ability being paid for is on the stack (CR 601.2a, 602.2a, 602.5d), so the player activates it at priority.
      if (!info.def.isMana || info.def.sorcerySpeed === true || manaCostShapeNow(s, player, o, info) !== 'simple' || manaAbilityDenial(s, player, o, info)) continue; // std-rx28: a cost increase makes it one to pay
      // PAY1: an amount computed as the ability resolves is read now, as the resolver will read it (CR 106.1, 605.3b); 0 mana is nothing to offer
      // Owner 2026-10-21: a pain land's colored ability is planned too (`painUnits`), so its mana counts for the playable cards and the automatic payment
      const pain = painUnits(info);
      const computed = unitOptions(info).length === 0 && pain === null ? computedManaUnits(s, player, o, info) : null;
      const units = pain ?? (computed ? computed.units : unitOptions(info));
      if (units.length === 0) continue;
      const restriction = restrictionOf(info);
      if (restriction && !allows(restriction, id)) continue; // its mana can't pay for this (Cavern of Souls for a noncreature spell)
      modes.push({
        key: info.key, info, ...(restriction ? { restriction } : {}), units, sacrifices: (info.def.cost.other ?? []).some((p) => p.kind === 'sacrifice'),
        ...(computed?.oneType && units.length > 1 ? { oneType: true } : {}), ...(pain ? { pain: true as const } : {}),
      });
    }
    if (modes.length === 0) continue;
    const c = charsOfObject(s, o);
    const types = new Set<ManaType>();
    for (const m of modes) for (const u of m.units) for (const t of u) types.add(t);
    out.push({
      objectId: id,
      name: c.name,
      modes,
      snow: c.supertypes.includes('Snow'),
      isCreature: c.types.includes('Creature'),
      isLand: c.types.includes('Land'),
      flex: types.size,
    });
  }
  return out;
}

export interface Provider {
  id: number;
  /** Types this unit may be. */
  options: ManaType[];
  snow: boolean;
  /** Cost to the player of spending it: pool mana is free; sources cost more the more flexible they are. */
  cost: number;
  /**
   * FAST5X E5 INTERFACE CHANGE (additive): this unit may not pay the mana cost of a filter ability the payment activates (`SolveInput.inner`, rules/convert.ts):
   * it is made by such an ability (which can't pay for itself or another one, CR 605.3c; the planner keeps them in one order), or it is mana with a spending
   * restriction (floating, or added by a source ability with one), which was checked for the spell or ability being paid, not for the filter ability (CR 106.6).
   */
  innerBan?: true;
  /** Index into the player's mana pool, for floating mana. */
  poolIndex?: number;
  source?: {
    objectId: ObjectId;
    /** Ability key to activate for each mana type this provider can produce. */
    keyFor: Partial<Record<ManaType, string>>;
    /** Number of units the activation produces (all of them land in the pool). */
    unitCount: number;
    /** What activating the source costs the player, whatever number of its units are used (the solver's `cost` is per unit). */
    activationCost: number;
    unitIndex: number;
    /** Unit options of every unit, to fill unassigned units with defaults. */
    allOptions: ManaType[][];
    /** PAY1 INTERFACE CHANGE (additive): every unit of this activation is the same type (ManaMode.oneType); the solver keeps them to one type. */
    oneType?: boolean;
  };
}

/**
 * What using a source costs the player, for the solver's tie-breaks. 100 per unit makes "fewer units" dominate; then prefer
 * inflexible sources (a dual land is kept), lands before artifacts before creatures, never sacrifice a permanent unless nothing
 * else pays, spend a color the player has several sources of before the last source of another color, and keep snow
 * sources for {S} (CR 107.4h).
 */
function sourceCost(src: ManaSource, sacrifices: boolean, sameColor: number): number {
  const pain = src.modes.some((m) => m.pain === true) ? 40 : 0; // a source that may hurt is used after the painless ones (its {C} still costs no life)
  return 100 + 10 * src.flex + (src.isCreature ? 5 : src.isLand ? 0 : 2) + (sacrifices ? 300 : 0) + (src.snow ? 3 : 0) + pain - Math.min(Math.max(sameColor - 1, 0), 3);
}

/** The single mana type of an inflexible source, or null. */
function onlyType(src: ManaSource): ManaType | null {
  return src.flex === 1 ? (src.modes[0]!.units[0]![0] ?? null) : null;
}

/**
 * Providers for the solver: floating mana first, then every source unit. `onlyPool` restricts the floating mana to those
 * pool indices (the player chose which units to spend, CR 601.2h).
 */
export function buildProviders(sources: ManaSource[], pool: readonly { type: ManaType; snow?: boolean; restriction?: ManaRestriction; sourceId?: ObjectId }[], onlyPool?: ReadonlySet<number>, allows?: (r: ManaRestriction, manaSource: ObjectId | undefined) => boolean): Provider[] {
  const out: Provider[] = [];
  pool.forEach((u, i) => {
    // Mana with a spending restriction is spent only where it allows (CR 106.6); without a context (`allows`) it is never used.
    if ((u.restriction && !(allows && allows(u.restriction, u.sourceId))) || (onlyPool && !onlyPool.has(i))) return;
    // Snow mana is kept when other mana of the same type pays as well (a later {S} needs it, CR 107.4h).
    out.push({ id: out.length, options: [u.type], snow: u.snow === true, cost: u.snow ? 1 : 0, poolIndex: i });
  });
  const sameColor = new Map<ManaType, number>();
  for (const src of sources) {
    const t = onlyType(src);
    if (t) sameColor.set(t, (sameColor.get(t) ?? 0) + 1);
  }
  for (const src of sources) {
    const mult = sameColor.get(onlyType(src) as ManaType) ?? 1;
    const price = (sac: boolean): number => sourceCost(src, sac, mult);
    if (src.modes.length === 1) {
      const m = src.modes[0]!;
      m.units.forEach((options, unitIndex) => {
        out.push({
          id: out.length, options, snow: src.snow, cost: price(m.sacrifices),
          source: { objectId: src.objectId, keyFor: Object.fromEntries(options.map((t) => [t, m.key])), unitCount: m.units.length, activationCost: price(m.sacrifices), unitIndex, allOptions: m.units, ...(m.oneType ? { oneType: true } : {}) },
        });
      });
      continue;
    }
    // Several mana abilities that all need the same {T}: only one can be used. When each makes a single unit they merge
    // into one provider that can make any of those types (a dual land); otherwise only the first ability is offered.
    if (src.modes.every((m) => m.units.length === 1)) {
      const keyFor: Partial<Record<ManaType, string>> = {};
      const options: ManaType[] = [];
      for (const m of src.modes) for (const t of m.units[0]!) if (!(t in keyFor)) { keyFor[t] = m.key; options.push(t); }
      out.push({
        id: out.length, options, snow: src.snow, cost: price(src.modes.some((m) => m.sacrifices)),
        source: { objectId: src.objectId, keyFor, unitCount: 1, activationCost: price(src.modes.some((m) => m.sacrifices)), unitIndex: 0, allOptions: [options] },
      });
    } else {
      const m = src.modes[0]!;
      m.units.forEach((options, unitIndex) => {
        out.push({
          id: out.length, options, snow: src.snow, cost: price(m.sacrifices),
          source: { objectId: src.objectId, keyFor: Object.fromEntries(options.map((t) => [t, m.key])), unitCount: m.units.length, activationCost: price(m.sacrifices), unitIndex, allOptions: m.units, ...(m.oneType ? { oneType: true } : {}) },
        });
      });
    }
  }
  return out;
}

/**
 * FAST5X E5 INTERFACE CHANGE (additive): a mana ability with a mana cost that the automatic payer may activate (rules/mana.ts#manaCostShape `converter`: "{1},
 * {T}: Add one mana of any color", "{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}", Signets). Its cost is paid from other mana of the same payment (rules/convert.ts).
 */
export interface ManaConverter {
  objectId: ObjectId;
  name: string;
  key: string;
  info: ActivatedInfo;
  /** The mana cost of the ability (plain symbols only). */
  cost: ManaSymbol[];
  /** The units it adds, as `ManaMode.units`. */
  units: ManaType[][];
  oneType?: true;
  snow: boolean;
  /** Its cost sacrifices its own permanent ("{1}, {T}, Sacrifice ~: Add one mana of any color"). */
  sacrifices: boolean;
  restriction?: ManaRestriction;
  /** What activating it costs the player, for the solver's tie-breaks: always more than an ordinary source (its own mana cost is paid on top). */
  price: number;
}

/** FAST5X E5: a mana ability the player activates by hand during a payment or at priority (rules/mana.ts#manaCostShape `byHand`, or a converter whose amount can't be planned). */
export interface ByHandManaMode {
  objectId: ObjectId;
  name: string;
  key: string;
  info: ActivatedInfo;
  /** The types it may add (empty when they are decided as it resolves). */
  produces: ManaType[];
}

export interface ExtraManaModes {
  converters: ManaConverter[];
  byHand: ByHandManaMode[];
}

/**
 * FAST5X E5 INTERFACE CHANGE (additive): the mana abilities of `player` usable now (CR 605.3a) whose cost is more than {T}, {Q} and "Sacrifice ~", in battlefield
 * order: those the automatic payer may plan (`converters`) and those the player activates by hand (`byHand`). `manaSources` keeps the ordinary ones only, so
 * every reader of it is unchanged. Empty while the cost of a mana ability is being checked (rules/mana.ts#inManaCostCheck: no ability counts another
 * filter ability's mana for its own cost).
 */
export function extraManaModes(s: GameState, player: PlayerId, exclude?: ReadonlySet<ObjectId>, spend?: SpendContext): ExtraManaModes {
  if (inManaCostCheck()) return { converters: [], byHand: [] };
  return readingStable(s, () => extraManaModesIn(s, player, exclude, spend));
}

/**
 * CMD5 (CR 605.3a-b, 601.2g): a mana ability with a {T}/{Q} cost whose effect has an instruction beside adding mana ("{T}: Add {W} or {B}. This land deals 1
 * damage to you."): rules/mana.ts#activateManaAbility runs it through the resolver, and the automatic payer never plans it (no plain units, `manaSourcesIn`).
 * It was a manual mana ability before it was automated, so the player still sees it as one to activate by hand: in the payment decision
 * (rules/pay.ts#describeManaSources) and for the auto-pass check (core/legal.ts#hasManualManaAbility).
 */
function withInstructionBesideMana(info: ActivatedInfo): boolean {
  return unitOptions(info).length === 0 && info.def.effect.steps.some((st) => st.op !== 'addMana');
}

/**
 * Owner 2026-10-21 (CR 605.3a, 601.2g): the units of a mana ability whose only instruction beside adding plain mana is damage its source deals to its controller
 * ("{T}: Add {W} or {B}. This land deals 1 damage to you.", the pain lands and Talismans; "{T}: Add {C}{C}. This land deals 2 damage to you."), or null. The
 * automatic payer plans such an ability like any other source (`manaSourcesIn`, priced after painless ones) and activates it with the type it needs
 * (rules/mana.ts presets the resolver's choice): before, its mana was offered only by hand, so a card it could pay for was not shown as playable and its
 * cost was not paid automatically.
 */
export function painUnits(info: ActivatedInfo): ManaType[][] | null {
  const steps = info.def.effect.steps;
  if (unitOptions(info).length > 0 || !steps.some((st) => st.op !== 'addMana')) return null;
  const units: ManaType[][] = [];
  for (const st of steps) {
    const step = st as { op: string; units?: unknown; dynamic?: unknown; source?: { ref?: string }; to?: { ref?: string }; who?: { ref?: string } };
    if (step.op === 'addMana' && Array.isArray(step.units) && step.dynamic === undefined && (step.who === undefined || step.who.ref === 'you')) units.push(...(step.units as ManaType[][]));
    else if (step.op === 'damage' && step.source?.ref === 'self' && step.to?.ref === 'you') continue;
    else return null;
  }
  return units.length > 0 ? units : null;
}

/** The types the plain productions of a mana ability may add ("Add {W} or {B}"); a production decided as it resolves adds nothing known here. */
function plainTypesOf(info: ActivatedInfo): ManaType[] {
  const out = new Set<ManaType>();
  for (const st of info.def.effect.steps) if (st.op === 'addMana' && Array.isArray(st.units)) for (const u of st.units as ManaType[][]) for (const t of u) out.add(t);
  return [...out];
}

function extraManaModesIn(s: GameState, player: PlayerId, exclude?: ReadonlySet<ObjectId>, spend?: SpendContext): ExtraManaModes {
  const allows = spendAllows(s, player, spend);
  const out: ExtraManaModes = { converters: [], byHand: [] };
  for (const id of s.zones.battlefield) {
    const o = s.objects[id];
    if (!o || o.controller !== player || exclude?.has(id)) continue;
    let c: ReturnType<typeof charsOfObject> | undefined;
    for (const info of activatedAbilities(s, o)) {
      if (!info.def.isMana) continue;
      const shape = manaCostShapeNow(s, player, o, info); // std-rx28: a {T} cost another object increases is paid by hand
      const sorcery = info.def.sorcerySpeed === true; // never activated for a payment (see manaSourcesIn): by hand at priority, CR 602.5d
      const besides = shape === 'simple' && !sorcery && withInstructionBesideMana(info) && painUnits(info) === null; // CMD5; a pain land's is planned now (painUnits)
      if ((shape === 'simple' && !sorcery && !besides) || shape === 'unsupported' || manaAbilityDenial(s, player, o, info)) continue;
      const restriction = restrictionOf(info);
      if (restriction && !allows(restriction, id)) continue; // its mana can't pay for this (CR 106.6)
      c ??= charsOfObject(s, o);
      if (besides) {
        out.byHand.push({ objectId: id, name: c.name, key: info.key, info, produces: plainTypesOf(info) });
        continue;
      }
      const computed = unitOptions(info).length === 0 ? computedManaUnits(s, player, o, info) : null;
      const units = computed ? computed.units : unitOptions(info);
      // Cloud std-woe (CR 601.2f, 605.1a): the cost the ability has once other objects' cost reductions apply (statics/costmods.ts#abilityManaCost), as rules/pay.ts pays it
      const cost = shape === 'converter' ? abilityManaCost(s, player, o, info.def, info.def.cost.mana ?? []) : null;
      if (shape === 'converter' && !sorcery && units.length > 0 && cost !== null) {
        const types = new Set(units.flat());
        const sacrifices = (info.def.cost.other ?? []).some((p) => p.kind === 'sacrifice');
        out.converters.push({
          objectId: id, name: c.name, key: info.key, info, cost, units, ...(computed?.oneType && units.length > 1 ? { oneType: true as const } : {}),
          snow: c.supertypes.includes('Snow'), sacrifices, ...(restriction ? { restriction } : {}),
          price: 150 + 10 * types.size + (c.types.includes('Creature') ? 5 : c.types.includes('Land') ? 0 : 2) + (sacrifices ? 300 : 0),
        });
      } else {
        out.byHand.push({ objectId: id, name: c.name, key: info.key, info, produces: [...new Set(units.flat())] });
      }
    }
  }
  return out;
}
