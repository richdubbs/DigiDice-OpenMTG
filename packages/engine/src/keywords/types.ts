/**
 * keywords/: the keyword library (CR 702 abilities, CR 701 actions), implemented once. Owner: WP3 (registry, data, hooks, actions).
 *
 * Files:
 *   keywords/types.ts          this file
 *   keywords/registry.ts       loads keywords/data/*.json, implements KeywordRegistry
 *   keywords/expand.ts         placeholder substitution ($cost, $amount, ...) -> AbilityDef[]; pure
 *   keywords/data/<name>.json  one KeywordDefData per keyword (single source of truth; NO parallel TypeScript expand functions)
 *   keywords/hooks/*.ts        KeywordHooks implementations (flying.ts, protection.ts, ...), registered by name in hooks/index.ts
 *   keywords/special/*.ts      special actions (foretell, suspend, plot, morph, ...), registered in special/index.ts
 *   keywords/actions/*.ts      CR 701 action macros, registered in actions/index.ts
 *   keywords/capabilities.ts   builds the keyword:* and action:* capability names
 */
import type { AbilityDef, ActivatedAbilityDef, Condition, CostDef, KeywordAbilityDef, KeywordActionName, EffectStep, ZoneName } from '../types/ability';
import type { Denial } from '../rules/denial';
import type { Chars } from '../rules/characteristics';
import type { ManaCost } from '../types/mana';
import type { Game } from '../core/game';
import type { GameLike } from '../rules/hookpoints';
import type { ObjectId, PlayerId } from '../types/ids';

/** The six mechanisms by which a keyword plugs into the rules. A keyword may use several. */
export type Mechanism =
  | 'flag' // F: read through the characteristics function (c.abilities contains the keyword)
  | 'hook' // H: the engine consults the keyword at a named call-site (KeywordHooks)
  | 'expands' // X: expands into ordinary abilities (activated, triggered, static, replacement)
  | 'castOption' // C: contributes alternative/additional costs (as statics in `expand`) or special actions
  | 'replacement' // R: contributes replacement effects (inside `expand`)
  | 'structural'; // S: needs state machinery beyond abilities (face-down, day/night, speed, merge)

export interface KeywordParam {
  name: 'cost' | 'amount' | 'quality' | 'filter';
  type: 'cost' | 'number' | 'quality' | 'filter' | 'costOrNumber';
  optional?: boolean;
}

/** One file of keywords/data. Pure JSON. */
export interface KeywordDefData {
  /** Canonical lower-case name, the value of KeywordAbilityDef.keyword. */
  name: string;
  aliases?: string[];
  /** CR 702.x ("702.9"), or "reminder" for a keyword newer than the CR in rules/cr (keywords/validate.ts#REMINDER_RULE_KEYWORDS, FAST5X E18). */
  rule: string;
  params: KeywordParam[];
  mechanisms: Mechanism[];
  /** CR reminder wording with {cost}, {n}, {quality}. Used to confirm a keyword line and by the renderer. Never executed. */
  reminder: string;
  /**
   * What several instances of the keyword do together (CR 702.x rules about multiple instances). `redundant`: any further instance is redundant (flying);
   * `redundantPerParam`: instances with the SAME parameter are redundant, instances with different parameters are separate abilities (protection from red and
   * from blue, CR 702.16g/m; landwalk of different kinds, CR 702.14e; hexproof from different qualities, CR 702.11f/h); `cumulative`: they add up (bushido,
   * annihilator); `independent`: each works on its own (ward, cycling).
   */
  multiple: 'redundant' | 'redundantPerParam' | 'cumulative' | 'independent';
  /**
   * `implemented`: every mechanism listed exists in this engine build (flags are read, hooks registered, expansion valid).
   * `planned`: the line parses and displays, the engine cannot act (capability keyword:<name> absent -> manual with requiresEngine). Also the status of a keyword
   *           whose engine mechanism has no owner or no call-site yet (cascade, convoke), so that nothing is advertised that does not work.
   * `native`: acted on by engine code that predates the data form (flashback exile in core/resolve.ts in M5); the data form is the spec, used by
   *           the renderer and enabled as the engine path the day the native code is removed (milestone 6).
   */
  status: 'implemented' | 'planned' | 'native';
  /**
   * The keyword whose family this one belongs to, when the rules say its abilities ARE that keyword's abilities: typecycling is cycling (CR 702.29e-f), a
   * multikicker cost is a kicker cost (CR 702.33c). Generated abilities carry the family as provenance id, so "when you cycle" and kicker links see them.
   */
  family?: string;
  /** Names of KeywordHooks this keyword implements (hooks/ directory). A planned keyword may list hooks that exist but have no call-site yet (convoke). */
  hooks?: HookName[];
  /**
   * Flag/hook keywords: the engine call-sites that read the keyword, as "<file>#<function>". A grep test fails if a keyword with status
   * `implemented` and mechanism flag or hook has no reader (no keyword is silently ignored).
   */
  readers?: string[];
  /**
   * Pack form of the keyword's expansion: ability JSON in which whole string values "$cost", "$amount", "$quality", "$filter" are
   * replaced by the keyword instance's parameters, and the objects {"$costAdd":{"base":"$cost","other":[...]}} / {"$ifParam":"amount","then":X,"else":Y}
   * are evaluated by keywords/expand.ts. Nothing else: no code, no arithmetic.
   * WP3 NOTE: a `filter` parameter is the COMPLETE ObjectFilter (the parser adds "you control" where the rules say so: affinity for artifacts is
   * `{types:['Artifact'], controller:'you'}`), because a whole-string placeholder cannot be merged with other fields.
   */
  expand?: unknown[];
  /**
   * WP3 ADDITION (optional, additive). For a keyword that precedes an ability and changes how that ability works ("Exhaust -- {cost}: ...", "Boast -- ...",
   * "Forecast -- ..."; CR 702.177a): the fields the parser applies to the activated ability the keyword introduces. Such a keyword generates no ability of its
   * own (`expand` is absent and `expandKeyword` returns nothing).
   */
  modifies?: KeywordModifier;
}

/** The fields of the following activated ability that a wrapper keyword (exhaust, boast, forecast, ...) sets. */
export type KeywordModifier =
  | {
      kind: 'activated';
      limit?: ActivatedAbilityDef['limit'];
      sorcerySpeed?: boolean;
      onlyIf?: ActivatedAbilityDef['onlyIf'];
      zone?: ActivatedAbilityDef['zone'];
      /** T35 (power-up, CR 702.193a): the ability costs less by the permanent's mana cost on the turn it entered (ActivatedAbilityDef.reducedByManaCost). */
      reducedByManaCost?: true;
    }
  /**
   * A keyword that changes how the modes of its spell are chosen (entwine, CR 702.42a: "choose both" when its cost was paid). Unlike an `activated` modifier it MAY
   * come with an `expand` (entwine's additional cost): the cost is an ability, the mode choice a modifier of the spell. `chooseAll.when` is the condition under
   * which every mode is chosen. The lowering leaves the spell's modes as printed; when the spell is announced, actions/cast.ts#spellPrograms
   * (withModalKeywords, M6-5a) reads this modifier from the keyword registry and applies it as `ModeSpec.override` (min and max = the mode count of the card,
   * CR 601.2b), capability `feature:modes.override`.
   */
  | { kind: 'modal'; chooseAll: { when: Condition } }
  /**
   * FAST5X-4 ADDITION: a keyword that grants the ability written after its dash while a condition holds: "Max speed -- [Ability]" is "As long as your speed is
   * 4, this object has [Ability]" (CR 702.178a). The parser (segment.ts, lower/ability.ts#grantLine) makes the line a static ability with this condition, one
   * continuous effect on the object itself that adds the ability in layer 6, the zones the granted ability states (CR 702.178b, 113.6c), and `keyword` set
   * (types/ability.ts#StaticAbilityDef.keyword). Like an `activated` modifier it generates no ability of its own: no `expand`.
   */
  | { kind: 'grant'; while: Condition };

export type HookName = keyof KeywordHooks;

const HOOK_TABLE = {
  canAttack: true, canBeBlocked: true, blockSetValid: true, attackTaps: true, summoningSick: true, castTiming: true, canBeTargetedBy: true, combatDamageSteps: true,
  assignCombatDamage: true, onDamageDealt: true, indestructible: true, canBeEnchantedBy: true, canBeEquippedBy: true, paymentOptions: true,
} satisfies Record<HookName, true>; // a hook added to KeywordHooks without a line here (or a line without a hook) does not compile

/** Every hook a keyword may implement, as a runtime list (the data validator and the data-code coherence test use it). */
export const HOOK_NAMES: readonly HookName[] = Object.keys(HOOK_TABLE) as HookName[];

/** Engine call-sites a keyword can hook. Each returns a denial (with CR citation) or null, or adjusts a value. Table in design 7.3. */
export interface KeywordHooks {
  canAttack(g: GameLike, attacker: ObjectId, defender: PlayerId | ObjectId): Denial | null; // defender 702.3b
  canBeBlocked(g: GameLike, attacker: ObjectId, blocker: ObjectId): Denial | null; // flying, reach, shadow, fear, intimidate, horsemanship, skulk (702.118), landwalk, protection
  blockSetValid(g: GameLike, attacker: ObjectId, blockers: ObjectId[]): Denial | null; // menace 702.111b
  attackTaps(g: GameLike, attacker: ObjectId, player: PlayerId, c: Chars): boolean; // vigilance 702.20b
  summoningSick(g: GameLike, object: ObjectId, player: PlayerId, c: Chars): boolean; // haste 702.10b
  castTiming(g: GameLike, spell: ObjectId, player: PlayerId, c: Chars): 'instant' | null; // flash 702.8a
  canBeTargetedBy(g: GameLike, target: ObjectId | PlayerId, source: ObjectId | null, controller: PlayerId): Denial | null; // hexproof, shroud, protection
  combatDamageSteps(c: Chars): ('first' | 'regular')[]; // first strike, double strike 702.7b / 702.4b
  assignCombatDamage(c: Chars): { trample: boolean; deathtouch: boolean }; // 702.19b, 702.2c
  onDamageDealt(g: Game, source: ObjectId, amount: number, to: ObjectId | PlayerId): void; // lifelink 702.15b, deathtouch flag, infect/wither/toxic
  indestructible(c: Chars): boolean; // 702.12b
  canBeEnchantedBy(g: GameLike, aura: ObjectId, host: ObjectId): Denial | null; // protection, enchant
  canBeEquippedBy(g: GameLike, equipment: ObjectId, host: ObjectId): Denial | null;
  paymentOptions(g: GameLike, spell: ObjectId, caster: PlayerId): PaymentOption[]; // convoke, improvise, delve, emerge: the options of the CASTER (CR 702.51a "you control")
}

export interface PaymentOption {
  key: string;
  /** What the player may do instead of paying mana (tap creatures, exile cards from the graveyard, sacrifice a creature). */
  describe: string;
  reduces: { generic?: number; colors?: string[] };
  cost: CostDef;
}

/** A special action a keyword grants (CR 116.2): foretell, suspend, plot, turn a face-down permanent face up. */
export interface SpecialActionDef {
  key: string;
  rule: string;
  /** Zones the object must be in. */
  zones: ZoneName[];
  timing: 'priority' | 'sorceryTiming';
  check(g: GameLike, object: ObjectId, player: PlayerId): Denial | null;
  perform(g: Game, object: ObjectId, player: PlayerId): void;
}

export interface ExpandContext {
  /** Printed or granted. Granted keywords are expanded on the fly (CR 613.1f). */
  granted: boolean;
  faceName: string;
  types: string[];
  /** Prefix of the generated stable ability keys: `k:<face>:<index>` (design 7.1). */
  keyPrefix: string;
  /**
   * 1-based position of this instance among the instances of its kind on the face (the second kicker cost of a card with "Kicker {A} and/or {B}" is 2). Default 1.
   * Only kicker costs are numbered (`{"$ordinal": "kicker"}` in the data): kicker, kicker:2 (CR 702.33b, 702.33f, 607.2i).
   */
  ordinal?: number;
  /**
   * r5-cost: the mana cost of the object the keyword is on (CR 202.1), for a keyword whose cost "is equal to its mana cost" (`KeywordAbilityDef.costIsManaCost`:
   * "Its harmonize cost is equal to its mana cost", "The embalm cost is equal to its mana cost", CR 702.180a, 702.128a). Given for a granted keyword.
   */
  manaCost?: ManaCost | null;
}

export interface KeywordDef extends KeywordDefData {
  hookImpl: Partial<KeywordHooks>;
  special: SpecialActionDef[];
}

export interface KeywordRegistry {
  get(name: string): KeywordDef | undefined;
  /** Canonical names, sorted. */
  names(): string[];
  /** Pure: AbilityDef[] a keyword instance stands for (may be empty for flag keywords). */
  expand(kw: KeywordAbilityDef, ctx: ExpandContext): AbilityDef[];
  /**
   * `keyword:<name>` for every status implemented|native keyword, as DECLARED by the data. This is not the engine's capability set: `keywordCapabilities`
   * (capabilities.ts) adds the `action:<name>` names and withholds a keyword whose expansion needs a capability the engine lacks.
   */
  capabilities(): string[];
}

/** A CR 701 keyword action as a pure expansion over the primitive ops. A few actions need engine state (vote, venture, ring) and set `native`. */
export interface ActionMacro {
  name: KeywordActionName;
  /** CR 701.x */
  rule: string;
  expand?: (step: Extract<EffectStep, { op: 'action' }>) => EffectStep[];
  /**
   * Name of a handler for actions that cannot be written as steps (cascade, discover, vote): a key of `NATIVE_ACTIONS` in
   * `effects/handlers/actions-native.ts` (WP32, which gave that file its owner), run by the `action` op. Its capability is `feature:action.native.<name>`.
   */
  native?: string;
}
