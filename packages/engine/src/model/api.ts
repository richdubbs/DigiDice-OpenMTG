/**
 * model/: everything that treats ability JSON as data (no game state, no I/O). Owner: WP1.
 * Files: model/validate.ts, model/lint.ts, model/capabilities.ts, model/degrade.ts, model/classify.ts, model/strip.ts,
 * model/canonical.ts, model/hash.ts, model/schema.generated.json (+ model/index.ts re-exporting this API).
 */
import type { AbilityDef } from '../types/ability';
import type { AbilityAutomation, CardAutomation, ManualSpan, ReviewState } from '../types/automation';
import type { CardDef } from '../types/card';

// ---- validation: schema (types cannot say everything) + semantic lint -------------------------------------------------

export type IssueCode =
  | 'schema' // JSON does not match the generated JSON Schema (unknown op, missing required field, wrong tag)
  | 'unbound-name' // {ref:'bound'}, {cond:'did'}, {q:'resultCount'} names a step that is not earlier on every path
  | 'duplicate-name' | 'unknown-target' | 'duplicate-target' | 'bad-distinct' | 'bad-target-count'
  | 'bad-var' // {q:'var'} without a `let`; {q:'X'} in an ability whose cost has no X and that is not a spell with X
  | 'bad-event-role' // {ref:'event', role} not exposed by every pattern of the trigger (design 3.5), or `event` outside a trigger/replacement
  | 'bad-subject' // {ref:'subject'} outside a continuous effect or an `each`-scoped quantity
  | 'bad-layer' // layer 7a without `cda`; a modification in the wrong layer for its payload
  | 'bad-divide' // divided:'announced' without a TargetSpec.divide
  | 'bad-capture' // delay.capture names an unbound step
  | 'unlinked' // a `linked`/`chosen` consumer without a producer on the same object (or reverse: warning)
  | 'ask-position' // {cond:'ask'} / {q:'ask'} / CostPart manual in a position that must be automated (design 10.1)
  | 'live-position' // {q:'live'} outside a continuous-effect mod
  | 'modal-ids' // target ids not unique across modes
  | 'fixed-in-card-data' // {ref:'fixed'} is written only by the `effect` handler into game state, never in card data, packs or LLM output
  | 'bad-grantor' // r4-static: {ref:'grantor'} outside an ability a static ability grants (layer 6)
  | 'spell-target-count' // {q:'spellTargetCount'} outside a self cost modifier; std-costs-1: {q:'spellTargetTotal'} outside a spell's additional cost
  | 'executable-gap'; // a node the interpreter has no semantics for (e.g. both `units` and `dynamic` on addMana)

export interface Issue {
  /** JSON pointer inside the ability, e.g. "/effect/steps/2/to". */
  path: string;
  code: IssueCode;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidateContext {
  /** True when the ability sits on a card that has a linked-ability producer for `link` (checked card-wide by validateCardAbilities). */
  cardHasX?: boolean;
  /**
   * CLOUD std-dft INTERFACE CHANGE (additive): the card's cycling cost has an X ("Cycling {X}{G}{G}", parser/parse.ts#cyclingHasX). Its "when you cycle ~"
   * ability reads that X (CR 107.3a, 702.29a; triggers/stack.ts), so the lint accepts an X there (and only there) on a card without X in its mana cost.
   */
  cyclingX?: boolean;
  layout?: string;
  /**
   * r4-static INTERFACE CHANGE (additive, set by model/lint.ts only): the scope is an ability that a static ability grants (the `add` of a layer 6 modification of
   * one of its continuous effects), where `{ref:'grantor'}` names the granting object (statics/mods.ts#withGrantor). Elsewhere that reference is refused.
   */
  grantedScope?: boolean;
}

/** Schema + lint for one ability. Pure. Errors make the ability unusable (the compiler turns it into a manual ability with the first message). */
export type ValidateAbility = (def: AbilityDef, ctx?: ValidateContext) => Issue[];
/** Card-wide checks: link producers/consumers across abilities, duplicate keywords, face structure. */
export type ValidateCardAbilities = (faces: { abilities: AbilityDef[] }[]) => Issue[];

// ---- capabilities ---------------------------------------------------------------------------------------------------

/**
 * Capability names, one per discriminator value the engine may or may not implement:
 *   op:<op>  cost:<kind>  ev:<ev>  cond:<cond>  q:<q>  ref:<ref>  filter:<ObjectFilter field>  dur:<d>  target:<kind>
 *   static:<s>  layer:<layer>  body:<b>  rule:<RuleAction>  permit:<action>  rulemod:<rule>  restrict:<mode>
 *   keyword:<name>  action:<KeywordActionName>  decision:<kind>  feature:<name>   (feature: modes.override, trigger.batch, ...)
 * There is no `ability:<kind>` prefix: the structural kinds are `feature:` constants (below), so every name the walker emits has a table that can register it.
 *
 * Names a table owner has to register for the matching cards to become automated (all emitted by model/cap-walk.ts; none exists in a table before its owner
 * adds it, so a card that uses one stays partial or manual until then):
 *   value forms of replacement bodies    body:enters.copy|faceDown|transformed|under|attachTo  (copy also needs layer:1a, faceDown layer:1b)
 *                                        body:modify.amount|count|destination|to                          owner: effects/propose.ts (REPLACEMENT_BODIES)
 *   value forms of steps                 op:changeFace.faceDown|faceUp|convert|flip|manifest   (plain transform is op:changeFace)
 *                                        op:copy.except   op:designate.day|night                          owner: the handler's package (OP_HANDLERS keys)
 *   restrictions                         restrict:cant|mustIfAble|onlyIf and feature:restrict.max|other.<action>|when   owner: statics/hooks.ts (RULE_HOOK_ACTIONS keys
 *                                        are full capability names, so a hook registers `rule:attack` AND the modes it enforces, e.g. `restrict:cant`)
 *   requirements (mustIfAble)            feature:require.<action> (a non-combat action), feature:require.other.attack|block|beBlocked (the other-creature
 *                                        forms)                     owner: rules/requirements.ts, milestone 6 M6-7 (R1, M6-7a INTERFACE CHANGE: model/cap-walk.ts)
 *   structural kinds                     feature:chapter (with ev:counters)      owner: triggers/normalize.ts (FEATURES, written without the prefix)
 *                                        feature:class.level, feature:leveler.bracket                      owner: statics/layers.ts (FEATURES)
 *                                        feature:mana.restriction                                           owner: the addMana handler (WP13): it needs a
 *                                        `FEATURES` export and an import in model/capabilities.ts, a table the builder does not read yet
 *   dependency                           feature:dependency is needed by EVERY continuous effect (CR 613.8a applies in each layer and sublayer)
 * The engine exports ENGINE_CAPABILITIES, a Set<string> BUILT from its own tables (OP_HANDLERS keys, keyword registry,
 * evaluator tables, layer table), so adding a handler registers its capability without a second list.
 */
export type Capability = string;
export type CapabilitySet = ReadonlySet<Capability>;

/**
 * Walk an ability and list the capabilities it needs (deterministic order, no duplicates). Besides the discriminator names above it emits the VALUE-FORM and
 * UNREAD-FIELD names of model/forms.ts (`filter:keyword.list`, `cost:discard.hand`, `feature:target.distinct`, ...) by calling that file's helpers node by node,
 * so a field the build can't honor is a missing capability, not a silent default (design D2).
 */
export type CapabilitiesOf = (def: AbilityDef) => Capability[];

/** Capabilities of `def` that `caps` lacks. */
export type MissingCapabilities = (def: AbilityDef, caps: CapabilitySet) => Capability[];

// ---- degradation (the only place an understood node becomes manual because of the engine) ---------------------------

/** The normalized Oracle lines of one face, used to hydrate manual node text. */
export interface FaceLines {
  lines: string[];
  /** Sentences per line, same indexing as AbilityBase.src and StepBase.sentence. */
  sentences: string[][];
}

export interface DegradeResult {
  def: AbilityDef;
  /** Capabilities that were missing and caused a node to become manual (also copied to CardAutomation.requiresEngine). */
  requires: Capability[];
}

/**
 * Replace every node that uses a missing capability by the manual node of the smallest enclosing unit (design 10.2):
 *   step (op, quantity, condition, filter, ref, duration, decision)  -> {op:'manual'} for that step, then taint (design 6.7)
 *   cost part                                                         -> CostPart {kind:'manual'}
 *   target spec, trigger event, intervening if, static effect or condition, activation `onlyIf` of kind other than ask
 *                                                                      -> the whole ability becomes ManualAbilityDef (cost/effect kept when understood)
 * Pure and idempotent; run by compileCard on every ability from every source (parser, LLM cache, pack, hand).
 */
export type DegradeAbility = (def: AbilityDef, caps: CapabilitySet, lines: FaceLines) => DegradeResult;

// ---- classification -------------------------------------------------------------------------------------------------

export interface ClassifyInput {
  faces: { abilities: AbilityDef[]; lines: FaceLines }[];
  /** Data source of the highest-precedence ability on the card. */
  source: CardAutomation['source'];
  review?: ReviewState;
  textHash?: string;
  /** Local kill switch (design 10.4): the card is treated as manual. */
  forceManual?: boolean;
  /** Names of templates marked experimental that matched (cap at partial, design 6.9). */
  experimentalTemplates?: string[];
}

/** Pure: the level of every ability and of the card (rules in design 10.3), manual spans, autoRatio, requiresEngine. */
export type ClassifyCard = (input: ClassifyInput, caps: CapabilitySet) => CardAutomation;
export type ClassifyAbility = (def: AbilityDef, caps: CapabilitySet) => AbilityAutomation;
/** Manual nodes of an ability in document order (used by the UI to paint Oracle text). */
export type ManualNodes = (def: AbilityDef) => ManualSpan[];

// ---- stored form (packs, LLM cache): structure without any display text -----------------------------------------------

/**
 * Same shape as AbilityDef with every display field removed: AbilityBase.text, .label, StepBase.span, TargetSpec.text,
 * ModeSpec option text, manual node text. `src` and `sentence` indices stay. Typed as unknown-JSON because it is
 * validated by the generated schema with display fields optional.
 */
export type StoredAbility = Record<string, unknown>;

export type StripAbility = (def: AbilityDef) => StoredAbility;
/** Restores display text from the player's local Oracle lines. Returns null (and the caller discards the entry) when `textHash` differs. */
export type HydrateAbility = (stored: StoredAbility, lines: FaceLines, expectedHash: string, actualHash: string) => AbilityDef | null;

/** SHA-256 hex of the normalized Oracle text of all faces (NFC, straight quotes, collapsed spaces, "\n" between lines, faces joined by "\n//\n"). */
export type TextHash = (cardFacesOracleText: string[]) => string;

// ---- canonical form --------------------------------------------------------------------------------------------------

/**
 * One JSON form per meaning: fields in a fixed order, defaults removed (only where the type has a default: none of `who`, `source`, `caster`),
 * arrays sorted where order is meaningless (types, colors, anyOf), nested single-element `all`/`any` collapsed.
 * Used by the cache, the diff tools, the corpus snapshot and the "two LLM runs agree" check.
 */
export type Canonicalize = (def: AbilityDef) => AbilityDef;

