/**
 * Structured ability model (final milestone 5 design, docs/design/m5-ability-model.md).
 *
 * Card behavior is DATA interpreted by the engine, never a hand-written function per card. Every node type
 * corresponds to a concept of the Comprehensive Rules (CR) and cites it. Conventions:
 *   - every union is discriminated by a short tag: kind (abilities, cost parts), op (steps), cond (conditions),
 *     q (quantities), ref (references), ev (events), s (static effects), layer (modifications), d (durations),
 *     b (replacement bodies);
 *   - JSON only: no functions, no `undefined`-sensitive logic, no code strings, so a node can be validated, cached,
 *     diffed, shipped in rules packs (docs/design/updates.md), produced by the LLM compile step, rendered back to
 *     English and executed;
 *   - there is NO "unsupported" escape inside an executable position. Anything the parser or the engine does not
 *     understand is a MANUAL node of the smallest enclosing unit (ManualAbilityDef, `manual` step, `ask` condition or
 *     quantity, manual cost part), see section 10 of the design;
 *   - a player who acts is always named: `who`, `payer`, `source`, `caster` are REQUIRED wherever a wrong default
 *     would change the rules (a missing `who` is a compile error, not a silent "you").
 */
import type { Color, ManaCost, ManaType } from './mana';
import type { Step as TurnStep, ZoneKind } from './state';

/** Version of this schema. Rules-pack entries and caches record it; a pack newer than the engine cannot be used (updates.md). */
export const ABILITY_MODEL_VERSION = 4; // M6-0 (m6 design 2.1): 2, additive M6 nodes; M11-0 (m11 design 4.5): 3, the Commander nodes; M12-1 (m12 design 4.3): 4, `PlayerRef` seat. An older engine refuses packs that use them (updates.md)

// ---------------------------------------------------------------------------
// 0. Small shared types
// ---------------------------------------------------------------------------

/** Zones (CR 400.1). */
export type ZoneName = ZoneKind;

/** A name an earlier step gave to the objects/players it acted on ("it", "that creature", "the exiled card"). */
export type Name = string;

/** Key joining two abilities of one object that CR 607 links ("the exiled card", "the chosen color"). */
export type LinkId = string;

/**
 * LNK1 ADDITION: the link a "that player" of one ability reads when it means the player another ability of the same object targeted ("When this creature
 * enters, target player loses 6 life. / When this creature leaves the battlefield, that player gains 6 life."; CR 607.1). Written by the parser on the
 * producer's `TargetSpec.link` and the reader's `{ref:'linked'}` (parser/parse.ts#linkTargetedPlayer).
 */
export const TARGETED_PLAYER_LINK: LinkId = 'targetedPlayer';

/** CR 122.1b: the keywords a keyword counter can be (statics/mods.ts re-exports it; std-combat-2 moved it here so the parser's lower/same-for.ts may read it). */
export const KEYWORD_COUNTERS: readonly string[] = [
  'flying', 'first strike', 'double strike', 'deathtouch', 'decayed', 'exalted', 'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'reach',
  'shadow', 'trample', 'vigilance',
];

/**
 * FAST5 T65 INTERFACE CHANGE (additive, no new field), CR 700.4, 603.6c: "leaves the battlefield without dying" is a `zoneChange` from the battlefield whose
 * `to` is exactly these zones: every zone a permanent can go to but a graveyard (it dies when it is put into a graveyard from the battlefield; the battlefield
 * and the stack are no destination of a permanent leaving the battlefield). Read by the parser (holes/event.ts) and the renderer (render/evt.ts).
 */
export const WITHOUT_DYING: readonly ZoneName[] = Object.freeze(['hand', 'library', 'exile', 'command'] as ZoneName[]);

/** Counter kinds (CR 122.1): "+1/+1", "-1/-1", "loyalty", "lore", "charge", a keyword name ("flying"), "poison", "energy"... */
export type CounterKind = string;

export type Cmp = '<=' | '>=' | '==' | '!=' | '<' | '>';

/** Fixed number, "any number" (unbounded), or a computed value (e.g. "up to X"). */
export type Count = number | 'any' | Quantity;

export type PlayerPred = 'you' | 'opponent' | 'any' | PlayerRef;

export interface NumberCmp {
  op: Cmp;
  value: Quantity;
}

// ---------------------------------------------------------------------------
// 1. Abilities (CR 113)
// ---------------------------------------------------------------------------

export type AbilityDef =
  | SpellAbilityDef // CR 113.3a
  | ActivatedAbilityDef // CR 602, 605 (mana), 606 (loyalty)
  | TriggeredAbilityDef // CR 603
  | StaticAbilityDef // CR 604 (continuous, replacement, prevention, cost, restriction, rule-modifying)
  | KeywordAbilityDef // CR 702, implemented once in the keyword library
  | ChapterAbilityDef // CR 714 (sugar, expands to a triggered ability)
  | ClassLevelDef // CR 716
  | LevelBracketDef // CR 711
  | CaseDef // CR 719 (M6-0, m6 design 2.1)
  | ManualAbilityDef; // text the engine does not automate

export interface Provenance {
  /**
   * Who produced this ability. `fallback` = the compiler could not do better than manual. `native` = the milestone 3/4 recognizers the compile pipeline
   * keeps below the parser until the template packages cover their lines (cards/native.ts; id = the recognizer).
   */
  by: 'keyword' | 'template' | 'llm' | 'pack' | 'hand' | 'native' | 'fallback';
  /** Template id, keyword name, recognizer, pack version or LLM prompt version. */
  id?: string;
  /** A human reviewed it (hand-written data and reviewed LLM/pack entries). Unreviewed LLM data caps the card at `partial`. */
  reviewed?: boolean;
}

export interface AbilityBase {
  /** The Oracle text this ability was compiled from, reminder text removed, "~" for the object's own name. Display data: derived, stripped from packs and caches. */
  text: string;
  /** Ability word or flavor word prefix, e.g. "Landfall" (CR 207.2c-d). Has no rules meaning. */
  label?: string;
  /** Indices of the normalized Oracle lines this ability came from. Packs and caches store this instead of any text (IP hygiene, updates.md). */
  src?: number[];
  prov?: Provenance;
}

/** The effect of an instant or sorcery spell (CR 113.3a, 608.2). */
export interface SpellAbilityDef extends AbilityBase {
  kind: 'spell';
  effect: EffectProgram;
}

/** "[Cost]: [Effect.]" (CR 602). Mana abilities (CR 605) and loyalty abilities (CR 606) are flags, not kinds. */
export interface ActivatedAbilityDef extends AbilityBase {
  kind: 'activated';
  cost: CostDef;
  effect: EffectProgram;
  /** CR 605.1a: no target, could add mana, not a loyalty ability. Does not use the stack (CR 605.3b). */
  isMana?: boolean;
  /** CR 606: sorcery timing and at most one per planeswalker per turn (CR 606.3). */
  isLoyalty?: boolean;
  /** "Activate only as a sorcery." (CR 602.5d) */
  sorcerySpeed?: boolean;
  /**
   * MX5 INTERFACE CHANGE (additive): "Any player may activate this ability." (CR 602.2: the object says otherwise, so a player other than its controller may
   * activate it; that player controls the ability, CR 602.2a, and pays its costs). The other restrictions are read for the activating player ("but only as a
   * sorcery", "but only during their turn": `onlyIf` with `you`). Capability `feature:activate.anyPlayer` (model/forms.ts); with {T} or {Q} in the cost, or on a
   * mana ability, `feature:activate.anyPlayer.tap` / `.mana`, which nothing registers.
   */
  anyPlayer?: boolean;
  /** "Activate only once each turn." (CR 602.5b) and similar ("only twice each turn", exhaust: once per game). */
  limit?: { per: 'turn' | 'game' | 'combat'; max: number };
  /**
   * "Activate only if/during ..." (CR 602.5b). Unlike every other condition position, `{cond:'ask'}` is allowed here:
   * the controller attests the restriction when activating and the ability is `partial`.
   */
  onlyIf?: Condition;
  /** Zones the ability functions from (CR 113.6), default battlefield. */
  zone?: ZoneName[];
  /**
   * FAST1 T4 ADDITION (INTERFACE CHANGE, optional): the wrapper keyword written before the cost ("Exhaust -- {3}{G}: ...", CR 702.177a), lower case. The
   * restrictions it means are the fields above (`limit`, `onlyIf`, `zone`, `sorcerySpeed`: the keyword data's `modifies`, keywords/types.ts), and the
   * ability has no restriction of its own (the parser refuses one), so its text is the keyword, the cost and the effect. Capability `keyword:<name>`.
   */
  keyword?: string;
  /**
   * T35 INTERFACE CHANGE (optional): "If this permanent entered this turn, this ability's cost is reduced by this permanent's mana cost" (power-up, CR 702.193a-b):
   * actions/activate.ts takes the mana cost of the source off the mana of this ability's cost (statics/costmods.ts#reduceManaBy, CR 118.7) while the source entered
   * the battlefield this turn. Set by the wrapper keyword's data (`modifies`), never printed on its own.
   */
  reducedByManaCost?: true;
  /**
   * T38 INTERFACE CHANGE (additive): "This ability costs {1} less to activate for each Equipment you control." (CR 601.2f, 602.2b, 118.7): a change to the total
   * cost of THIS ability, determined when it is activated, like a spell's own cost modifier (`CostModDef` with `applies.self`). Quantities are read as the
   * static-ability evaluator reads them (statics/match.ts; the player is the one activating it). Not on a mana or loyalty ability. Capability
   * `feature:activate.costChange` (actions/activate.ts#costChangeOf applies it; every quantity kind is `rq:cost.<kind>`).
   */
  costChange?: CostModDef['change'];
  /**
   * Standard round 4 r4-cost INTERFACE CHANGE (additive): the condition under which `costChange` applies, "This ability costs {1} less to activate during your
   * turn" (CR 601.2f, 602.2b, 500.1): read with the static-ability evaluator as the total cost is determined (statics/match.ts#evalCondition, the player
   * activating it as "you"). Only with `costChange`. Capability `feature:activate.costChange.if` (actions/activate.ts#costChangeOf).
   */
  costChangeIf?: Condition;
  /**
   * std-rx12 INTERFACE CHANGE (additive): "X can't be 0." of an ability with an X in its cost (CR 107.3a, 602.2b, 601.2b): the least value of X the activating player
   * may announce. actions/activate.ts offers only payable values of X at least this; with no X in the cost the ability is not offered. Only 1 is written (the
   * parser reads that sentence alone). Capability `feature:activate.xMin`.
   */
  xMin?: number;
  /**
   * std-copy-1 INTERFACE CHANGE (additive): "This ability can't be copied." (CR 707.10, 101.2): the copy op puts no copy of this ability onto the stack
   * (effects/handlers/tokens-copy.ts#copySpells). Capability `feature:activate.uncopiable`.
   */
  uncopiable?: true;
  /**
   * std-rx27 INTERFACE CHANGE (additive): "For each mana in this ability's activation cost, you may tap an untapped creature you control rather than pay that
   * mana." (CR 601.2f-h, 602.2b; convoke's way of paying, CR 702.51a, for an activation cost): the untapped permanents of this filter the activating player
   * controls that may each pay for one generic mana of the total cost (rules/payment-options.ts#tapForManaOption). Colored mana in the cost is a form nothing
   * registers. Capability `feature:activate.tapForMana`.
   */
  tapForMana?: ObjectFilter;
}

/** "When/Whenever/At [event], [effect]." (CR 603) */
export interface TriggeredAbilityDef extends AbilityBase {
  kind: 'triggered';
  trigger: TriggerDef;
  /** Intervening "if" (CR 603.4): checked when the event happens and again on resolution. Never `ask`: an unknown one makes the whole ability manual. */
  interveningIf?: Condition;
  effect: EffectProgram;
  /**
   * "This ability triggers only once each turn" (CR 603.2h). FAST5X E21 INTERFACE CHANGE (additive): `action: true` is "Do this only once each turn" after
   * "you may <action>" (CR 603.2h): the ability triggers only if its source's controller has not yet taken that action through it this turn, and the action is
   * counted only when the player takes it (the program is one `may` step with an `as` name; effects/run.ts, triggers/collect.ts#applyLimit). Capability
   * `feature:trigger.limit.action`. Cloud std-spm: or that `may` first, then only `if` steps on its "if you do" ("you may discard a card. If you do, draw a
   * card. Do this only once each turn."): every later step needs the action, so an ability that no longer triggers loses nothing.
   */
  limit?: { per: 'turn' | 'game'; max: number; action?: true };
  zone?: ZoneName[];
}

/** A static ability (CR 604): one printed paragraph can generate several effects (CR 607.2h, 613.6). */
export interface StaticAbilityDef extends AbilityBase {
  kind: 'static';
  effects: StaticEffect[];
  /** "As long as [condition], ..." wraps every effect (CR 611.3a). Never `ask`. */
  condition?: Condition;
  /**
   * r5-static INTERFACE CHANGE (additive), CR 611.3a: the effects the ability has while `condition` is false ("Equipped creature has deathtouch during your
   * turn. Otherwise, it has reach."; "... gets +2/+2 as long as it's a Detective you control. Otherwise, it has base power and toughness 1/1"). Only with a
   * `condition`; continuous effects and restrictions only (capability `feature:static.otherwise`, statics/live.ts and statics/rule-sources.ts read it), never a
   * characteristic-defining ability (CR 604.3: it has no condition).
   */
  otherwise?: StaticEffect[];
  /** Zones it functions in (CR 113.6, 604.5, 604.6): battlefield by default; stack for cost/cast statics; hand for "you may cast". */
  zone?: ZoneName[];
  /**
   * T35 ADDITION (optional): this static ability is a station symbol and what is printed in its striation (CR 721.2): "8+ | Flying, lifelink". It means the
   * condition ("as long as this permanent has N or more charge counters on it") and the effect it has; the Oracle line is `N+ | abilities` (render/abil.ts prints
   * it from the JSON, and only for the exact shape parser/lower/station.ts builds).
   */
  station?: true;
  /**
   * FAST5X-4 ADDITION (INTERFACE CHANGE, optional): the keyword this static ability is the meaning of, lower case: "Max speed -- [Ability]" is "As long as your
   * speed is 4, this object has [Ability]" (CR 702.178a; the keyword data's `modifies` of kind `grant`, keywords/types.ts). Such an ability is exactly that:
   * `condition` the keyword's, one continuous effect on itself that adds the one ability in layer 6, and `zone` the zones the granted ability states (CR
   * 702.178b, 113.6c), so its text is the keyword, a dash and the granted ability. Capability `keyword:<name>`.
   */
  keyword?: string;
  /**
   * Cloud r3-mech ADDITION (INTERFACE CHANGE, optional): a Siege's bulleted ability, "• [Word] -- [Ability]" under "As ~ enters, choose [Word] or [Word]."
   * (CR 614.12a, 607.2d): the permanent has [Ability] only if [Word] was chosen as it entered. Such an ability is exactly that: `condition` is
   * `{cond:'chosen', link:'siege', equals: <the word>}`, one continuous effect on itself that adds the one ability in layer 6, and `zone` the zones the granted
   * ability states; its text is the word, a dash and the granted ability (render/abil.ts, parser/lower/ability.ts#grantLine).
   * Also '∞', an Infinity Stone's "∞ -- [Ability]" (CR 701.64): the condition is then `{cond:'matches', object:{ref:'self'}, filter:{harnessed:true}}`.
   */
  chosenMode?: string;
}

/** A keyword ability (CR 702). The keyword library turns it into flags, hooks, generated abilities and cast options. */
export interface KeywordAbilityDef extends AbilityBase {
  kind: 'keyword';
  /** Canonical lower-case keyword: "flying", "kicker", "ward", "protection", "landwalk", ... */
  keyword: string;
  /** Cost parameter (kicker {2}{G}, equip {1}, ward--pay 3 life, flashback, cycling, ...). */
  cost?: CostDef;
  /**
   * FAST5 T56 INTERFACE CHANGE (additive): the cost parameter is the mana cost of the card the ability is on, as that card has it: "target instant or sorcery card in your
   * graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost." (CR 702.34a, 118.9). Only on `flashback`, and then without `cost`;
   * read by actions/cast-options.ts#castOptionsOf (the card's own mana cost, an X in it announced as for any alternative cost, CR 107.3a). Capability
   * `feature:keyword.flashback.costIsManaCost` (granted by a layer 6 `add`: actions/cast.ts#withGrantedCosts).
   * Cloud r3-mech (additive): also on `mayhem`, "Each nonland card in your graveyard has mayhem. The mayhem cost is equal to its mana cost." (CR 702.187b, 118.9):
   * the card's own mana cost as its mayhem cost; capability `feature:keyword.mayhem.costIsManaCost`.
   */
  costIsManaCost?: true;
  /** Numeric parameter (crew 2, annihilator 2, bushido 1, toxic 1, ...). A plain number everywhere except "X" (e.g. Ward-style scaling): then a Quantity. */
  amount?: Quantity;
  /**
   * Qualifier in the canonical string form of rules/quality.ts (milestone 4): the quality of protection / hexproof from X
   * ("color:R", "type:Artifact", "subtype:goblins", "multicolored", "everything"), the land words of a landwalk ("snow swamp").
   * A quality the engine cannot test parses to nothing and the keyword stays manual text.
   */
  quality?: string;
  /** Object-quality parameter that IS a filter: what an Aura's enchant ability allows (CR 702.5a), affinity for X, ward on X. */
  filter?: ObjectFilter;
  /** "Enchant player" / "Enchant opponent" (CR 702.5a, 303.4a). */
  player?: 'any' | 'opponent' | 'you';
  /**
   * FAST5X E27 INTERFACE CHANGE (additive): "Equip--Pay 3 life. Activate only once each turn." (CR 602.5b, 702.6a): a restriction printed with the keyword on
   * its line is the `limit` of the activated ability the keyword stands for (keywords/expand.ts puts it there; a keyword that stands for no activated ability
   * can't have one: expanding it throws).
   */
  limit?: { per: 'turn'; max: number };
  /**
   * Standard round 4 r4-cost INTERFACE CHANGE (additive): "Equip {4}. This ability costs {1} less to activate for each color of the creature it targets." (CR
   * 601.2f, 602.2b, 702.6a): a cost change printed with the keyword on its line is the `costChange` of the activated ability the keyword stands for
   * (keywords/expand.ts puts it there; a keyword that stands for no activated ability refuses it). Capability `feature:keyword.costChange`.
   */
  costChange?: CostModDef['change'];
  /**
   * pc-statics-1 INTERFACE CHANGE (additive): "Equip {2}. This ability costs {2} less to activate if you have one or fewer cards in hand." (CR 601.2f, 602.2b,
   * 702.6a): the condition of the keyword's `costChange`, the `costChangeIf` of the activated ability the keyword stands for (keywords/expand.ts). Only with
   * `costChange`. Capability `feature:keyword.costChange.if`.
   */
  costChangeIf?: Condition;
}

/** Saga chapters "I, II -- ..." (CR 714). Expands to a triggered ability on lore counters (CR 714.2). */
export interface ChapterAbilityDef extends AbilityBase {
  kind: 'chapter';
  chapters: number[];
  effect: EffectProgram;
}

/** Class level N (CR 716): level-up activated ability plus abilities that function from that level on. */
export interface ClassLevelDef extends AbilityBase {
  kind: 'classLevel';
  level: number;
  /** Cost to reach this level (absent for level 1). */
  cost?: CostDef;
  abilities: AbilityDef[];
}

/** One bracket of a leveler card (CR 711.2): while the level counter count is in range, these P/T and abilities apply. */
export interface LevelBracketDef extends AbilityBase {
  kind: 'levelBracket';
  min: number;
  max: number | null;
  power?: string;
  toughness?: string;
  abilities: AbilityDef[];
}

/**
 * M6-0 ADDITION (m6 design 2.1). A Case (CR 719.3): "To solve -- [condition]" is "At the beginning of your end step, if [condition] and this Case is not
 * solved, it becomes solved" (CR 719.3a); "Solved -- [ability]" functions only while the Case is solved (CR 719.3c). Expanded by statics/levels.ts (M6-6)
 * into one triggered ability (key `x:<face>:<index>:solve`) and the `solved` abilities, each with the condition
 * `{ cond: 'matches', object: { ref: 'self' }, filter: { solved: true } }` (keys `x:<face>:<index>:<n>`). Capability `feature:case` (M6-6; until then
 * nothing reads it and a card with a CaseDef is not full).
 */
export interface CaseDef extends AbilityBase {
  kind: 'case';
  solve: Condition;
  solved: AbilityDef[];
}

/**
 * Text the engine cannot automate (docs/ARCHITECTURE.md item 5). Never silently skipped:
 *   spell:      a manualResolve prompt on resolution;
 *   activated:  the normal activation flow with the understood `cost`, then manualResolve;
 *   triggered:  listed in the "Triggers to check" tray with a "Trigger now" button; when `effect` is present
 *               (the effect was understood, only the event could not be detected) the button goes through normal
 *               announcement (targets, modes) and the effect is automated;
 *   static:     an "unenforced rule" chip while the object is in a functional zone;
 *   unknown:    shown on the card, nothing offered.
 */
export interface ManualAbilityDef extends AbilityBase {
  kind: 'manual';
  reason: string;
  shape: 'spell' | 'activated' | 'triggered' | 'static' | 'unknown';
  /** A cost that WAS understood (so the engine can still make players pay it), for shape 'activated'. */
  cost?: CostDef;
  /** An effect that WAS understood, for shape 'triggered' (manual trigger detection) and 'activated'. */
  effect?: EffectProgram;
  /** The line is an activated mana ability the recognizer rejected: the controller can still run it by hand (CR 605.3b). */
  mana?: boolean;
  /** Chip lifetime for one-shot text that works like a replacement/prevention shield ("If ... would die this turn, exile it instead"). */
  reminder?: Duration;
  /**
   * WP1 ADDITION (review round): the activation or trigger restrictions of the ability this one replaced, so a manual ability is not offered at instant
   * speed, without its limit or from the wrong zone (CR 602.5d, 602.5b, 603.2h, 113.6). Copied by the degrade pass; `onlyIf` is always `{cond:'ask'}`
   * here (the controller attests it, CR 602.5b). Same meaning as on ActivatedAbilityDef / TriggeredAbilityDef.
   */
  sorcerySpeed?: boolean;
  limit?: { per: 'turn' | 'game' | 'combat'; max: number };
  zone?: ZoneName[];
  onlyIf?: Condition;
  /**
   * WP0 ADDITION (milestone 4 carry-over, optional): part of the text says the permanent enters with counters in a form the engine does not evaluate
   * (CR 614.1c), so its controller adds them by hand as it enters. Disappears when the `enters` replacement body parses those lines (WP22).
   */
  entersWithCounters?: boolean;
}

// ---------------------------------------------------------------------------
// 2. Costs (CR 118, 601.2f-h, 602.2)
// ---------------------------------------------------------------------------

export interface CostDef {
  mana?: ManaCost;
  tap?: boolean; // {T}, CR 107.5
  untap?: boolean; // {Q}
  /** Loyalty cost +N / -N / 0 (CR 606.4). */
  loyalty?: number;
  /**
   * std-r9 INTERFACE CHANGE (additive): a loyalty cost of minus X ("−X: ...", CR 606.4, 107.3a, 601.2b): X is announced as the ability is activated, at most the
   * loyalty counters on the permanent (CR 606.4: a negative loyalty cost greater than the loyalty can't be paid), and that many are removed; the effect's X
   * (`{q:'X'}`) is the announced value. Never beside `loyalty`. Capability `feature:activate.loyaltyX` (model/forms.ts#activatedForms, actions/announce.ts#FEATURES).
   */
  loyaltyX?: true;
  other?: CostPart[];
}

export type CostPart =
  /**
   * r3-cost INTERFACE CHANGE (additive): `distinctNames`, "Sacrifice three artifact tokens with different names" (Transmutation Font; CR 118.3, 201.2): no two of
   * the objects sacrificed have the same name. Capability `cost:sacrifice.distinctNames`.
   */
  | { kind: 'sacrifice'; filter: ObjectFilter; count: Count; self?: boolean; distinctNames?: true; /** std-mana-1 (additive): with count 'any', "Sacrifice one or more artifacts": never fewer (CR 601.2b, 118.3). Capability `cost:sacrifice.atLeast`. */ atLeast?: number }
  | { kind: 'payLife'; amount: Quantity }
  | { kind: 'discard'; filter?: ObjectFilter; count: Count; random?: boolean; self?: boolean; hand?: boolean }
  /**
   * FAST5X E13 INTERFACE CHANGE (additive): `zone: 'battlefield'` is payable for "Exile ~" (`self`, CR 118.3, 602.2: the source exiles itself) and for "Exile
   * <a permanent> you control" (a filter with `controller: 'you'`). `orGraveyard`: craft's materials (CR 702.167a-b), "from among permanents you control
   * and/or cards in your graveyard" (`zone` is 'battlefield'; the source itself is never one of them: it pays its own part, CR 118.3). `atLeast` with
   * `count: 'any'`: "N or more" (craft with one or more Dinosaurs): the count is announced (CR 601.2b) and is at least N.
   */
  /**
   * FAST5 T59 INTERFACE CHANGE (additive): `link` names the link the exiled cards are remembered under by the permanent the spell becomes (CR 607.2q: "As an additional cost to
   * cast this spell, exile a creature you control" ... "When this creature leaves the battlefield, put each card exiled with it into its owner's hand"); parser/parse.ts#linkExiled sets it.
   */
  /**
   * std-costs-1 INTERFACE CHANGE (additive): `totalManaValue`, "Exile one or more other artifacts you control with total mana value X" (CR 118.3, 107.3a, 202.3;
   * Fabrication Foundry): the permanents exiled (at least `atLeast`, from the battlefield) have EXACTLY that total mana value, X announced with the ability (CR
   * 602.2b). rules/cost-pick.ts picks them (an exact-total part). Capability `cost:exileFrom.totalManaValue`.
   */
  /**
   * std-cardcopy-7 INTERFACE CHANGE (additive): `symbolTotal`, "Exile any number of black cards from your graveyard with fifteen or more black mana symbols among their mana costs"
   * (Baron Helmut Zemo; CR 118.3, 107.4, 202.1): with `count: 'any'`, the player exiles as many cards as they choose whose mana costs have, together, at least
   * `atLeast` mana symbols of `color` (a hybrid or Phyrexian symbol of that color counts, types/mana.ts#colorSymbolCount), as a threshold part
   * (rules/cost-pick.ts, like collect evidence's total). Capability `cost:exileFrom.symbolTotal`.
   */
  | { kind: 'exileFrom'; zone: ZoneName; filter?: ObjectFilter; count: Count; self?: boolean; orGraveyard?: true; atLeast?: number; link?: LinkId; totalManaValue?: Quantity; symbolTotal?: { color: Color; atLeast: number } }
  | { kind: 'tapUntapped'; filter: ObjectFilter; count: Count; other?: boolean }
  /**
   * p2-cost-parts-1 INTERFACE CHANGE (additive): "Untap two tapped creatures you control" (Halo Fountain; CR 118.3, 602.2b, 701.26b): untap that many tapped
   * permanents you control of the filter (never the source of a {T} or {Q} cost). Capability `cost:untapTapped`.
   */
  | { kind: 'untapTapped'; filter: ObjectFilter; count: Count }
  /** Crew/saddle style: tap any number of untapped creatures with total power N or more (CR 702.122a). */
  /**
   * FAST5X E3 INTERFACE CHANGE (additive): `as` names the keyword ability whose cost this is, 'crew' (CR 702.122a-b) or 'saddle' (CR 702.171a, c): a creature
   * tapped for it crews or saddles, and counts as a rule modification says ("saddles Mounts and crews Vehicles as though its power were N greater").
   */
  | { kind: 'tapPower'; filter: ObjectFilter; power: Quantity; other?: boolean; as?: 'crew' | 'saddle' }
  /**
   * r3-cost INTERFACE CHANGE (additive): `among` with `filter`, "Remove two +1/+1 counters from among artifacts you control" (CR 118.3, 122.1): `count` counters in
   * all from any number of the permanents `filter` describes (the payer's choice, one counter at a time, rules/pay-parts.ts); without it a filter is one chosen
   * permanent that loses them all. Capability `cost:removeCounters.among`.
   * std-rx5 INTERFACE CHANGE (additive): `anyNumber`, "Remove any number of +1/+1 counters from ~" (CR 107.1c, 602.2b, 601.2h): the payer chooses how many as the
   * cost is paid, which the model writes as the ability's X (`count: {q:'X'}`, announced before the costs are paid, CR 601.2b); "that many" / "that much" of
   * the effect is that number. Only the wording changes (render/costs.ts, render/qty.ts); the engine pays it as "Remove X ... counters".
   * p2-counters-move-2 INTERFACE CHANGE (additive): `all`, "Remove all charge counters from ~" (CR 118.3, 107.3a, 602.2b; cites unverified): every counter of that
   * kind on ~, written as the ability's X (`count: {q:'X'}`, `self`) with no choice: the X the activation announces is the number of those counters on ~
   * (actions/activate.ts#fixedCounterX), so "the number of charge counters removed this way" of the effect is that X (render/costs.ts). Capability
   * `cost:removeCounters.all`.
   */
  | { kind: 'removeCounters'; counter: CounterKind; count: Quantity; self?: boolean; filter?: ObjectFilter; among?: true; anyNumber?: true; all?: true }
  | { kind: 'putCounters'; counter: CounterKind; count: Quantity; self?: boolean; filter?: ObjectFilter }
  /**
   * trek-1 INTERFACE CHANGE (additive): `beamUp`, the creature returned to its owner's hand to pay a beam me up cost (Star Trek keyword, reminder text: "You may cast
   * this card from your graveyard for [cost] if you also return a creature you control to its owner's hand"; CR 702, rule number unverified): a permanent that
   * "can't be beamed up" (a `cant` restriction of `beBeamedUp`) can't be returned for it (CR 614.17b; rules/cant.ts#costUseDenial). Written only by
   * keywords/data/beam-me-up.json. Capability `cost:returnToHand.beamUp`.
   */
  | { kind: 'returnToHand'; filter: ObjectFilter; count: Count; self?: boolean; beamUp?: true }
  /**
   * trek-9 INTERFACE CHANGE (additive): "Put this card from your graveyard on the bottom of your library" as a cost (Daniels, Temporal Agent; CR 118.3, 602.2b, 113.6j,
   * 401.4; cites unverified): the source itself, in `zone`, goes to the `position` of its owner's library (a single card, so no order to choose). Only the source
   * itself (`self: true`) and only from your graveyard are paid; any other zone is an unregistered form (the cost stays manual). Capability `cost:putIntoLibrary`.
   */
  | { kind: 'putIntoLibrary'; zone: ZoneName; self: true; position: 'top' | 'bottom' }
  | { kind: 'reveal'; zone: 'hand'; filter?: ObjectFilter; count: Count; self?: boolean }
  | { kind: 'mill'; count: Quantity }
  | { kind: 'payEnergy'; amount: Quantity }
  /**
   * FAST5X E11 INTERFACE CHANGE (additive): "behold a [quality]" (CR 701.4a): reveal a [quality] card from your hand or choose a [quality] permanent you control.
   * `filter` is the quality; `exile` ("behold a Goblin and exile it", Champions of Lorwyn: exile the chosen permanent or revealed card); `link` names the link
   * the exiled card is remembered under by the permanent the spell becomes (CR 607.2a: "return the exiled card"; parser/parse.ts#linkExiled sets it).
   */
  | { kind: 'behold'; filter: ObjectFilter; count: Count; exile?: boolean; link?: LinkId }
  /**
   * std-costs-2 INTERFACE CHANGE (additive): "As an additional cost to cast this spell, choose a creature you control or a warped creature card you own in exile"
   * (Close Encounter; CR 601.2b, 601.2h, 118.8): the payer chooses `count` objects, each matching one of `filters` (every filter names its zone and whose objects;
   * the battlefield's are permanents that aren't phased out). Choosing does nothing to the object; what was chosen is kept in `CostsPaid.chosenObjects` and read by
   * ObjRef `costChosenObject`. Capability `cost:chooseObject`.
   */
  | { kind: 'chooseObject'; filters: ObjectFilter[]; count: Count }
  /** A keyword action used as a cost: exert, collect evidence N, forage, blight N, waterbend {N}, behold ... */
  | {
    kind: 'action'; action: KeywordActionName; arg?: Quantity;
    /**
     * std-rx27 INTERFACE CHANGE (additive), CR 607.2a, 701.59a: of collect evidence in the cost of an activated ability ("Collect evidence 6: ..."), the link the
     * cards it exiled are remembered under by the source ("you may cast an instant or sorcery spell from among cards exiled with it", Kylox's Voltstrider;
     * parser/parse.ts#linkExiled sets it; actions/activate.ts stores them as the cost is paid). Capability `feature:cost.collectEvidence.link`.
     */
    link?: LinkId;
  }
  /**
   * FAST5X E27 INTERFACE CHANGE (additive): "get N poison counters" as a cost ("Ward--Get five poison counters.", CR 702.21a, 122.1f, 118.3): the paying player
   * gets that many poison counters. It can't be paid while the player can't get counters (CR 614.17b).
   */
  | { kind: 'getCounters'; counter: 'poison'; amount: Quantity }
  /**
   * std-combat-5 INTERFACE CHANGE (additive): "Reveal the creature type you chose" (A Killer Among Us; CR 608.2d, 602.2b, 118.3): the controller reveals the value the
   * source's choice `link` holds (a secret choice, `chooseValue.secret`); payable only when the source (as it last existed, if it already left as another part of the
   * same cost) holds one. Capability `cost:revealChosen`.
   */
  | { kind: 'revealChosen'; link: LinkId; what: 'creatureType' }
  /**
   * FAST5X E27 INTERFACE CHANGE (additive): a choice between costs, "Pay {3} or discard a card", "Discard a card or pay {2}" (CR 601.2b, 602.2b, 118.12a): the
   * paying player chooses ONE of `options` they can pay (each a whole cost) and pays it. Resolved before the payment (rules/pay.ts#resolveOneOf); an unresolved
   * choice is never paid (the payment throws), never free.
   */
  | { kind: 'oneOf'; options: CostDef[] }
  /** One cost word the compiler did not understand: the controller confirms it was paid; declining cancels the activation (CR 733.1). */
  | { kind: 'manual'; text: string };

// ---------------------------------------------------------------------------
// 3. Effect programs: targets, modes, steps (CR 115, 601.2b-d, 608.2, 700.2)
// ---------------------------------------------------------------------------

export interface EffectProgram {
  /**
   * Targets announced when the object goes on the stack (CR 115.1, 601.2c). Ids are unique inside the WHOLE ability,
   * including its modes (a modal ability numbers t0, t1, ... across all of its modes), because CR 608.2b is decided once
   * over the targets of all chosen modes.
   */
  targets: TargetSpec[];
  /** "Choose one --" (CR 700.2). Chosen modes run first, in printed order (CR 700.2d), then `steps`. */
  modes?: ModeSpec;
  /** Instructions performed in order on resolution (CR 608.2c). */
  steps: EffectStep[];
}

export interface ModeSpec {
  min: Count;
  max: Count;
  /** "You may choose the same mode more than once." (CR 700.2d) */
  allowRepeat?: boolean;
  /** Who chooses; the controller by default (CR 700.2e for others, CR 603.3c for triggers). */
  chooser?: PlayerRef;
  /**
   * Condition under which the count changes, e.g. "If this spell was kicked, choose any number instead." (CR 601.4)
   * p2-modal-2 INTERFACE CHANGE (additive): `chosen`, with `random`: "Choose one at random. If you discarded a card this turn, you choose one instead." (Typhoid Mary,
   * Fractured): when the condition holds, the player chooses the modes instead of their being chosen at random (CR 700.2; capability `feature:modes.random`).
   */
  override?: { when: Condition; min: Count; max: Count; chosen?: true };
  /**
   * p2-modal-2 INTERFACE CHANGE (additive), CR 700.2 (unverified cite): "Choose one at random --": the modes are chosen at random (the game's random number generator,
   * design 8.8) among those that can be chosen, as the spell or ability is put on the stack, not by a player. Only with `min` equal to `max`. Read by
   * actions/announce.ts#chooseModes (capability `feature:modes.random`).
   */
  random?: true;
  /** Additional cost of a mode (CR 700.2h). */
  /**
   * FAST5X E11 INTERFACE CHANGE (additive): `label`, the name printed before a mode's effect ("Street Justice", "Fire"): a flavor word with no rules meaning
   * (CR 207.2d), display data only (the render gate prints it back; tiered spells print one before each mode's cost, CR 702.183a).
   */
  /**
   * std-blb INTERFACE CHANGE (additive), CR 700.2i: "Choose up to N {P} worth of modes": each option has a pawprint count (`options[].pawprints`) and the chosen
   * modes' pawprints total at most this many, a mode chosen more than once counting each time (with `allowRepeat`, CR 700.2d). `min` / `max` still count the modes
   * chosen. Read by actions/announce.ts#chooseModes (capability `feature:modes.pawprints`).
   */
  pawprints?: number;
  /**
   * r3-choose INTERFACE CHANGE (additive), CR 700.2, 603.3c: "choose one that hasn't been chosen" ('object': no mode the ability of this object had chosen before, since
   * it became this object, CR 400.7) and "choose one that hasn't been chosen this turn" ('turn'): a mode chosen for the ability is remembered as it is chosen (the
   * ability is put on the stack, CR 603.3c, 602.2b) and can't be chosen again; with every mode used no mode can be chosen, so a triggered ability is removed from the
   * stack. Read by actions/announce.ts#chooseModes (capability `feature:modes.unchosen`).
   */
  unchosen?: 'object' | 'turn';
  options: { text: string; program: EffectProgram; cost?: CostDef; label?: string; pawprints?: number }[];
}

export interface TargetSpec {
  /** Referenced as { ref: 'target', id } by steps. */
  id: string;
  kind: 'object' | 'player' | 'objectOrPlayer' | 'anyTarget' | 'spell' | 'ability' | 'stackObject';
  filter?: ObjectFilter;
  players?: { who: PlayerPred };
  /** Number of targets (CR 601.2c: variable counts are announced before the targets). */
  min: Count;
  max: Count;
  /** Prompt text, e.g. "target creature you don't control". Display data. */
  text: string;
  /** "another target ..." / "two other target ...": must differ from these specs' targets (CR 115.3 allows reuse otherwise). */
  distinctFrom?: string[];
  /** The caster announces a division of damage/counters among the targets (CR 601.2d). Every target gets at least 1. */
  divide?: { what: 'damage' | 'counters' | 'other'; total: Quantity };
  /** "Any number of target creatures with total power 5 or less": a limit on a statistic summed over the chosen targets (CR 115.1). */
  groupLimit?: { stat: 'power' | 'toughness' | 'manaValue'; cmp: NumberCmp };
  /**
   * FAST3 T14 (INTERFACE CHANGE): "up to three target cards from a single graveyard": every object chosen for this spec has the same owner (a restriction on
   * the set of targets the text states, CR 115.1, 601.2c). Announced by choosing whose cards first (actions/announce-targets.ts).
   */
  sameOwner?: boolean;
  /**
   * FAST5 T42 INTERFACE CHANGE (additive): "up to six target creature cards with different names" (Behold the Sinister Six!): no two of the objects chosen for this spec
   * share a name (CR 201.2: objects have the same name when they have a name in common; a nameless object shares none). A restriction on the set of targets the text
   * states (CR 115.1, 601.2c), checked as the targets are announced and asked again when an answer breaks it.
   */
  differentNames?: boolean;
  /**
   * FAST5 T66 INTERFACE CHANGE (additive): "for each opponent, exile up to one target nonland permanent that player controls" (CR 115.1, 601.2c): at most one target
   * for each opponent, each controlled by that opponent (a restriction on the set the text states, checked as the targets are announced). The spec's `max` is the
   * most targets for EACH opponent (one: so one target in a two-player game) and its filter names a controller ('opponent').
   */
  perOpponent?: boolean;
  /**
   * r5-fxb INTERFACE CHANGE (additive): "for each player, destroy up to one target creature that player controls" (CR 115.1, 601.2c): as `perOpponent`, for every
   * player (you too): at most `max` targets for EACH player, each controlled by that player; the filter names no controller. Capability `feature:target.perPlayer`.
   */
  perPlayer?: boolean;
  /**
   * FAST5 T66 INTERFACE CHANGE (additive): "two target nonland permanents that share a card type" (CR 115.1, 601.2c, 205.2a): the objects chosen for this spec have a
   * card type in common (a restriction on the set the text states, checked as the targets are announced and asked again when an answer breaks it).
   */
  sharedCardType?: boolean;
  /**
   * CLOUD std-ecl INTERFACE CHANGE (additive): "two target creature cards that share a creature type" (CR 115.1, 601.2c, 205.3m, 702.73a): the objects chosen for
   * this spec have a creature type in common (a changeling has all of them), checked like `sharedCardType`.
   */
  sharedCreatureType?: boolean;
  /**
   * CLOUD std-tmt INTERFACE CHANGE (additive): "two target creatures controlled by different players" (CR 115.1, 601.2c, 110.2): no two of the objects chosen for
   * this spec have the same controller (a restriction on the set the text states, checked as the targets are announced and asked again when an answer breaks it).
   * Capability `feature:target.differentControllers`.
   */
  differentControllers?: boolean;
  /**
   * std-rx30 INTERFACE CHANGE (additive): "two target creatures controlled by the same opponent" (Trial of Agony; CR 115.1, 601.2c, 110.2): every object chosen for
   * this spec has the same controller (a restriction on the set the text states, checked as the targets are announced and asked again when an answer breaks it);
   * the filter names who that controller may be. Capability `feature:target.sameController`.
   */
  sameController?: boolean;
  /**
   * std-cardcopy-7 INTERFACE CHANGE (additive): "exile up to one target nonland card of each card type from your graveyard" (Uldaros Theorix; CR 115.1, 601.2c,
   * 205.2a): at most `max` targets for EACH card type: the objects chosen can be given distinct card types, each one a type of its own object (an artifact
   * creature card counts for one of the two), at most `max` objects for a type. Checked as the targets are announced (asked again when an answer breaks it).
   * Capability `feature:target.perCardType`.
   */
  perCardType?: boolean;
  /** Required only if a condition holds at announcement (kicker, a mode, a cost paid; CR 601.2c, 700.2c). */
  onlyIf?: Condition;
  /** A player other than the controller chooses (CR 601.7). */
  chooser?: PlayerRef;
  /**
   * p2-damage-2 INTERFACE CHANGE (additive): "target creature an opponent controls chosen at random" (Scab-Clan Giant; CR 601.2c, 603.3d): nobody chooses, the game
   * picks the targets with its random generator among the legal ones as the spell or ability is put on the stack. Capability `feature:target.random`.
   */
  random?: true;
  /**
   * LNK1 INTERFACE CHANGE (additive): remember the players and objects chosen for this spec that are still legal as the ability resolves (the ones it
   * affects) on the source object under this link (CR 607.1, 608.2b; effects/run.ts#rememberTargets), for a linked ability of the same object to read with
   * `{ref:'linked', link}` ("that player"). Added to what earlier resolutions remembered; a new object starts with none (CR 400.7).
   */
  link?: LinkId;
}

// ---- References ------------------------------------------------------------

/** Handle on one or more objects. Plural references (each, linked, bound) stand for sets. */
export type ObjRef =
  | { ref: 'self' } // the source object; uses last known information when it has left (CR 608.2h, 113.7a)
  /**
   * r5-fxz ADDITION: `moved`, the new object an Aura became in its owner's graveyard after the permanent it enchanted left the battlefield ("When enchanted
   * creature dies, return this card to its owner's hand"): it went there at the same time, or as the state-based action for an Aura attached to nothing
   * (CR 400.7f, 704.5m), and the ability can find it there. Nothing when the Aura is anywhere else (still on the battlefield, or it left that graveyard: a
   * new object again, CR 400.7). Written by the parser only for a step that acts on "~" in a triggered ability of an Aura whose host left the battlefield.
   */
  | { ref: 'self'; moved: true }
  | { ref: 'target'; id: string }
  /**
   * audit-fix-1 ADDITION (additive, CR 608.2h, 400.7, 701.21a; unverified): `which`, only the bound objects that match it as they last existed before the step that
   * bound them moved them (the binding's snapshots, effects/handlers/zones-util.ts#bindMoved; current information where there is none): "another permanent card"
   * after "each player sacrifices ..." excludes only the permanent YOU sacrificed (`which: {controller: 'you'}`, Deadly Brew; parser/lower/targets.ts).
   */
  | { ref: 'bound'; name: Name; which?: ObjectFilter }
  | { ref: 'event'; role: EventRole }
  | { ref: 'attachedTo' } // "enchanted creature", "equipped creature", "fortified land" (CR 303.4, 301.5)
  | { ref: 'linked'; link: LinkId } // CR 607.2a, 607.2c: objects the linked ability exiled/created/put onto the battlefield
  | { ref: 'each'; filter: ObjectFilter } // "each creature", "all creatures you control"
  | { ref: 'subject' } // inside a continuous effect: the object currently being modified ("its mana value")
  /**
   * std-rg INTERFACE CHANGE (additive): `allButBottom`, "all but the bottom card of each opponent's library" (Jace, Reality Sculptor; CR 401.1, 401.2): every card of the
   * library except the bottom N (N = the field; only 1 is read by the parser), in order, top first, for each player the reference names. `count` is 0 then and is
   * not read (effects/refs.ts#resolveObjs).
   */
  | { ref: 'topCards'; player: PlayerRef; count: Quantity; zone?: 'library'; allButBottom?: number } // ordered, top first
  | { ref: 'union'; of: ObjRef[] }
  /**
   * FAST3 T18 ADDITION: the permanents sacrificed to pay a cost of THIS spell or ability ("the sacrificed creature": an activation cost, CR 602.2b, or an
   * additional cost of a spell, CR 601.2b, 601.2h; `CostsPaid.sacrificed`). They have left the battlefield, so every read is last known information
   * (CR 608.2h, 113.7a): "the sacrificed creature's power" is its power as it last existed on the battlefield. Nothing for a spell or ability that sacrificed
   * nothing as a cost (a triggered ability, a copy), so the parser writes it only where the ability's own cost sacrifices (parser/lower/ability.ts).
   */
  | { ref: 'costSacrificed' }
  /**
   * T35 ADDITION: the permanents tapped to pay a `tapUntapped` cost of THIS activated ability ("the tapped creature": station, CR 702.184a: "put charge counters on
   * this permanent equal to the tapped creature's power"; `CostsPaid.tapped`). They are still on the battlefield, so a read is their current characteristics
   * (their last known information when they have left, CR 608.2h). Nothing for an ability whose cost taps nothing but its source.
   */
  | { ref: 'costTapped' }
  /**
   * std-rx28 ADDITION: the card revealed or the permanent chosen to pay a behold cost of THIS spell ("As an additional cost to cast ~, choose a creature you control or
   * reveal a creature card from your hand. ~ deals damage equal to the power of the creature you chose or the card you revealed ...", Monstrous Emergence; CR 701.4a,
   * `CostsPaid.beheld`). Read where it is now (the card in the hand, the permanent on the battlefield), or as it last existed there once it has left (CR 608.2h);
   * nothing acts on it. Only in a spell whose face has an additional behold cost (model/lint-card.ts#costReferenceIssues).
   */
  | { ref: 'costBeheld' }
  /**
   * std-costs-2 ADDITION: the object chosen to pay a `chooseObject` additional cost of THIS spell ("~ deals damage equal to the power of the chosen creature or card to
   * target creature", Close Encounter; `CostsPaid.chosenObjects`). Read where it is now, or as it last existed there once it has left (CR 608.2h); nothing acts on
   * it. Only in a spell whose face has such a cost (model/lint-nodes.ts).
   */
  | { ref: 'costChosenObject' }
  /**
   * p2-refs-1 ADDITION: the card revealed from the hand to pay a reveal additional cost of THIS spell ("As an additional cost to cast this spell, reveal a creature card
   * from your hand. ... equal to the revealed card's mana value", Disaster Radius; CR 601.2b, 701.20a, `CostsPaid.revealed`). Read where it is now, or as it last existed
   * there once it has left (CR 608.2h); nothing acts on it. Only in a spell whose face has such a cost (model/lint-card.ts, model/lint-nodes.ts).
   */
  | { ref: 'costRevealed' }
  /**
   * std-rx28 ADDITION: the permanent returned to its owner's hand to pay this object's web-slinging or sneak cost ("If ~ was cast using web-slinging, ~ enters with X
   * +1/+1 counters on ~, where X is the mana value of the returned creature", Scarlet Spider, Ben Reilly; CR 702.188a, `CostsPaid.returned`): read as it last existed
   * on the battlefield (CR 608.2h), from the spell's cost or the cast record of the permanent it became (CR 400.7d); nothing acts on it. Only on a face with such a
   * keyword (model/lint-card.ts#costReferenceIssues).
   */
  | { ref: 'costReturned' }
  /**
   * FAST5X E13 ADDITION: the cards exiled to pay a cost of THIS activated ability (`CostsPaid.exiled`), as the cards they are now in exile (CR 400.7j):
   * `self: true` is the card the source became by being exiled ("Exile this permanent"; craft returns "this card", CR 702.167a), otherwise the other cards
   * exiled for the cost (craft's materials, CR 702.167c). A card no longer in exile is a new object and is not found (CR 400.7).
   */
  | { ref: 'costExiled'; self?: true }
  /**
   * CLOUD C8 ADDITION: the cards discarded to pay a cost of THIS spell or ability ("the discarded card": an activation cost, CR 602.2b, an additional cost of a
   * spell, CR 601.2b, 601.2h, or a payment an effect asked for, CR 118.12; `CostsPaid.discarded`), as the cards they became in the zone the discard put them
   * (CR 400.7j). A read is their current characteristics there, or their last known information once they left it (CR 608.2h); several cards are a group
   * ("the discarded cards"). Nothing for a spell or ability whose cost discarded nothing (a triggered ability); a copy reads the original's (CR 707.10).
   */
  | { ref: 'costDiscarded' }
  /**
   * r4-static INTERFACE CHANGE (additive; CR 201.5a): inside an ability that a static ability grants to another object (layer 6, CR 613.1f),
   * the object whose static ability grants it: the outer card's name in the quote ("Equipped creature has "{T}, Sacrifice Blazing Torch: ...""). The layer that
   * adds the ability writes it as `{ref:'fixed'}` for the granting object on the battlefield (statics/mods.ts#withGrantor); anywhere else the lint refuses it.
   */
  | { ref: 'grantor' }
  /**
   * A set of objects fixed when a resolved effect was created (CR 611.2c). Written ONLY by the `effect` handler into
   * ContinuousEffectRec.effect (it rewrites every target/bound/event/linked/self reference and, for effects that change characteristics or
   * control, the `each` set); never by parsers, packs or the LLM (the validator rejects it in card data). Handles whose object is no longer in
   * the expected zone are skipped (a new object, CR 400.7). r4-static (additive): `source: true` (written only by statics/mods.ts#withGrantor for `grantor`) names
   * the object the way `self` names an ability's source: the handle even after the object left, read with its last known information (CR 608.2h, 113.7a), and
   * every handler that acts on it checks it is still there (CR 400.7). audit-fix-1: also written by effects/handlers/lasting-fix.ts#fixRef for a chosen "source of
   * your choice" (a `damageSource` choice's binding, CR 609.7a), which may name an object that has left its zone.
   */
  | { ref: 'fixed'; objects: { id: string; zone: ZoneName }[]; source?: true };

export type PlayerRef =
  | { ref: 'you' } // controller of the spell/ability (CR 109.5)
  | { ref: 'target'; id: string }
  | { ref: 'controllerOf'; object: ObjRef }
  | { ref: 'ownerOf'; object: ObjRef }
  | { ref: 'anOpponent' } // "an opponent": the controller picks one in multiplayer (CR 601.7a)
  | { ref: 'each'; who: 'player' | 'opponent' | 'otherPlayer' } // simultaneous / APNAP (CR 608.2e-f)
  | { ref: 'event'; role: EventRole }
  | { ref: 'bound'; name: Name }
  | { ref: 'linked'; link: LinkId } // "the chosen player", "the player you chose" (CR 607.2d)
  | { ref: 'active' } // CR 102.1
  | { ref: 'defending' } // CR 506.2
  /** M6-12 INTERFACE CHANGE (additive): "each opponent other than defending player" (myriad, CR 702.116a, 506.2), in APNAP order. Steps only. */
  /**
   * FAST4 T25 INTERFACE CHANGE (additive): `than`, "each other opponent" after a trigger that names one opponent ("whenever ~ deals combat damage to an
   * opponent, it deals that much damage to each other opponent"): the opponents of the controller other than the players `than` stands for (the event's
   * recipient), in APNAP order. Without `than`, other than the defending player (myriad).
   */
  | { ref: 'otherOpponents'; than?: PlayerRef }
  | { ref: 'iterating' } // the current player inside a forEach over players
  /**
   * FAST5X E1 INTERFACE CHANGE (additive): the player chosen as the additional cost `name` of this object's cast (CR 702.174a: gift's "you may choose an
   * opponent"; CR 702.174d-i "the chosen player"), read from the cast record (`CostsPaid.chosenPlayers`, CR 607.2i-j, 400.7d). Nobody when it wasn't paid.
   */
  | { ref: 'costChosen'; name: string }
  /** Players fixed when a resolved effect was created (the player counterpart of ObjRef 'fixed'; written only by the `effect` handler and by the migration of milestone 4's player restrictions). */
  | { ref: 'fixed'; players: string[] }
  /**
   * M12-1 INTERFACE CHANGE (additive; m12 design D6, 4.3): "the player to your left / right", "the player to the left of [player]": the next (`left`) or the
   * previous (`right`) player in turn order who is still in the game, counted from `of` (default: you). CR 101.4: the next player in turn order is usually the
   * player seated to the left; CR 103.1: play proceeds clockwise. A player who left the game has no seat any more (as CR 801.2c treats seats); nobody when no
   * other player is in the game. In a two-player game both sides are the opponent. Resolved by core/multiplayer.ts#seatNeighbor everywhere a player
   * reference is read; M12-3 adds the templates.
   */
  | { ref: 'seat'; side: 'left' | 'right'; of?: PlayerRef }
  /**
   * C6 INTERFACE CHANGE (additive): "each player who controls the most creatures" (`fewest`: "the fewest"): the players still in the game who control a number of
   * permanents matching `filter` that no other player exceeds (or, with `fewest`, goes below): every player tied for the most is one of them, and when no player
   * controls any, every player is (CR 109.4: a permanent's controller; CR 101.4: in APNAP order; CR 608.2h: counted as the instruction is performed). Steps only
   * (effects/refs.ts); capability `feature:player.controlsMost`.
   */
  | { ref: 'controlsMost'; filter: ObjectFilter; fewest?: true }
  /**
   * M12F INTERFACE CHANGE (additive; CR 701.38a): "each opponent who voted for a choice you voted for" (`agree`) / "... a choice you didn't vote for" (not
   * `agree`), in APNAP order, read from the ballots of the trigger's `votesFinished` event ("whenever players finish voting"): an opponent with at least one
   * vote for a choice among (`agree`) or outside (not `agree`) the controller's own votes (CR 701.38d: a player may have several). When the engine does not know
   * the ballots (a vote resolved by hand), the controller says who they are (effects/refs.ts). Only after that trigger (render/refs.ts).
   * M12 gaps INTERFACE CHANGE (additive): `andYou`, "you and each opponent who voted for a choice you voted for" (Model of Unity): the controller too, the
   * group in APNAP order (CR 101.4); a group of players like "each player" (a `may` of it is every player's own choice, effects/handlers/control.ts).
   */
  | { ref: 'voters'; agree: boolean; andYou?: true }
  /**
   * std-rr INTERFACE CHANGE (additive; CR 303.4, 702.5a): "enchanted player": the player the source Aura is attached to (an Aura with "Enchant player" or
   * "Enchant opponent", a Curse). Nobody when the source is attached to an object or to nothing, or is not on the battlefield (rules/attachment.ts attaches an
   * Aura to a player only through that keyword). Capability `ref:enchantedPlayer`.
   */
  | { ref: 'enchantedPlayer' }
  /**
   * std-rx30 INTERFACE CHANGE (additive; CR 608.2c): "the other player" of two players a step names, "Two target players each reveal the top card of their library. They
   * each lose life equal to the mana value of the card revealed by the other player." (Parker Luck): the players of `of` other than the ones `than` stands for (in APNAP
   * order). Steps only (effects/refs.ts); capability `ref:otherOf`.
   */
  | { ref: 'otherOf'; of: PlayerRef; than: PlayerRef }
  /**
   * std-combat-1 INTERFACE CHANGE (additive; CR 608.2c, 102.1, 508.1): "each opponent who attacked you or a planeswalker you control this turn" (Sandswirl Wanderglyph):
   * the players of `who` (the controller's opponents, or every player) still in the game, in APNAP order, who performed an event matching `did` in `scope` (the game
   * history, rules/history.ts#countHistory with the player as its actor). Read where it is used: a static restriction names the players it applies to now (CR
   * 611.3a). Capability `ref:eachWho`.
   */
  /**
   * pc-combat-1: `scope: 'attacking'` (CR 508.1, 303.4; Curse of Opulence ruling: a player is attacking another player if they control a creature that is attacking that player):
   * not the history but the battlefield as the effect resolves: the players of `who` who control at least one creature attacking the player `did.defender` names (`did` is an
   * `attacks` pattern with a player `defender`), in APNAP order. Steps only (effects/refs.ts); statics read it as nobody.
   */
  | { ref: 'eachWho'; who: 'opponent' | 'player'; did: EventPattern; scope: 'turn' | 'attacking' };

/**
 * M12-1 (m12 design 4.3, review finding 6): the `PlayerRef` kinds that stand ONLY for players (no `ObjRef` has the same `ref`). Every reader that tells a
 * player reference from an object reference by its `ref` reads this one table (effects/handlers/lasting-fix.ts, effects/handlers/actions-native.ts,
 * model/cap-walk.ts, statics/match.ts, render/refs.ts, render/np.ts, effects/refs.ts). The `Record` over exactly those kinds makes a new `PlayerRef` kind
 * a compile error here until it is listed, so it can never be read as an object reference by a forgotten private list. The shared kinds (`target`,
 * `bound`, `event`, `linked`, `each`, `fixed`) stand for players or objects depending on their shape or on what they stand for.
 */
const PLAYER_ONLY_KINDS: Readonly<Record<Exclude<PlayerRef['ref'], ObjRef['ref']>, true>> = {
  you: true, controllerOf: true, ownerOf: true, anOpponent: true, active: true, defending: true, iterating: true, otherOpponents: true, costChosen: true,
  seat: true, // M12-1 (D6)
  controlsMost: true, // C6
  voters: true, // M12F
  enchantedPlayer: true, // std-rr
  otherOf: true, // std-rx30
  eachWho: true, // std-combat-1
};
export type PlayerOnlyRefKind = keyof typeof PLAYER_ONLY_KINDS;
export const PLAYER_ONLY_REFS: readonly PlayerOnlyRefKind[] = Object.freeze(Object.keys(PLAYER_ONLY_KINDS) as PlayerOnlyRefKind[]);
/** Is this `ref` discriminator one that stands only for players (`PLAYER_ONLY_REFS`)? */
export const isPlayerOnlyRefKind = (ref: string): ref is PlayerOnlyRefKind => Object.hasOwn(PLAYER_ONLY_KINDS, ref);
/** The player references of the `PLAYER_ONLY_REFS` kinds. */
export type PlayerOnlyRef = Extract<PlayerRef, { ref: PlayerOnlyRefKind }>;
/** Does this reference stand only for players (`PLAYER_ONLY_REFS`)? Narrows: after a false answer a switch over `ref` needs only the other kinds. */
export const isPlayerOnlyRef = (r: ObjRef | PlayerRef): r is PlayerOnlyRef => isPlayerOnlyRefKind(r.ref);

/** Something damage, counters or a step can be directed at. */
export type Ref = ObjRef | PlayerRef;

/** What a trigger event exposes to its effect ("that creature", "that player", "that much"). Valid roles per event: design section 3.5. */
export type EventRole =
  | 'subject' // the object that did/underwent the event (for zone changes: the object in its new zone, CR 603.6)
  | 'object' // the second object (the blocked attacker, the damaged object)
  | 'source' // the damage source, the source of the targeting spell or ability
  | 'player' // the player who acted (caster, drawer, the player who gained life, the controller of the targeting spell or ability)
  | 'recipient' // the player damaged
  | 'spell' // the spell OR ability on the stack that the event concerns (cast spell, spell or ability that targeted)
  | 'attacker'
  | 'blocker'
  | 'defender'
  | 'newObject'; // the token or object created/produced by the event

// ---- Filters ---------------------------------------------------------------

/**
 * A predicate over objects. All set fields are ANDed; anyOf/not give full boolean structure.
 * There is no way to say "a word I could not test": a sentence whose filter cannot be expressed here is manual (design 6.6).
 * A field the running engine cannot evaluate (not in EngineCapabilities.filters) makes the unit that uses it manual (degrade pass).
 */
export interface ObjectFilter {
  anyOf?: ObjectFilter[];
  not?: ObjectFilter;

  /** Where to look, default battlefield. */
  zone?: ZoneName | ZoneName[] | 'any';
  controller?: PlayerPred;
  owner?: PlayerPred;

  // printed/derived characteristics (always read through the characteristics function, CR 109.3)
  types?: string[]; // any of
  allTypes?: string[];
  notTypes?: string[];
  subtypes?: string[]; // any of
  /** std-rx32 INTERFACE CHANGE (additive): every one of these subtypes ("a Spider Hero card", CR 205.3m: two subtypes said together). Capability: none (both matchers read it). */
  allSubtypes?: string[];
  notSubtypes?: string[];
  supertypes?: string[];
  notSupertypes?: string[];
  colors?: Color[]; // any of
  notColors?: Color[];
  colorless?: boolean;
  multicolored?: boolean;
  monocolored?: boolean;
  name?: string;
  notName?: string;
  /**
   * r5-static INTERFACE CHANGE (additive), CR 201.2a, 708.2a: `true`, an object that has no name ("creatures that don't have a name": a face-down permanent, a
   * token whose copiable values give it none); `false`, one that has a name. Read on the object's characteristics (`Chars.names` empty).
   */
  nameless?: boolean;
  manaValue?: NumberCmp;
  power?: NumberCmp;
  toughness?: NumberCmp;
  keyword?: string | string[]; // has any of these keyword abilities
  notKeyword?: string | string[];
  /** Has an ability of a kind: "an activated ability", "a mana ability", "a triggered ability". */
  hasAbility?: 'activated' | 'mana' | 'triggered' | 'static';

  // status
  tapped?: boolean;
  token?: boolean;
  /** Tokens are not cards (CR 111.1): `isCard:true` matches cards only, `token:true` tokens only. */
  isCard?: boolean;
  /**
   * std-typechange-2 INTERFACE CHANGE (additive), CR 114.1, 114.4: `true`, an emblem (an object in the command zone that is neither a card nor a permanent); "a
   * triggered ability of this creature or an emblem you own" (The Masamune). Read by rules/filter.ts; the static-ability matcher does not list it (it never
   * describes what a static ability affects).
   */
  emblem?: true;
  faceDown?: boolean;
  transformed?: boolean;
  /**
   * std-rx31 INTERFACE CHANGE (additive), CR 712.1, 712.4: a double-faced card ("If it's a double-faced card, you may transform it"): a card whose layout has a
   * Magic card face on each side (transforming and modal double-faced cards, meld cards); a token or a single-faced card is not. Read on the object's card.
   */
  doubleFaced?: boolean;
  isCopy?: boolean;
  /**
   * std-combat-1 INTERFACE CHANGE (additive): `orPlaneswalker`, "attacking you and/or planeswalkers you control" (Tomik, Wielder of Law; CR 506.3, 508.1b, 508.5): the
   * creature attacks a player `defender` matches, or a planeswalker such a player controls (the defending player of an attacked planeswalker is its controller, CR
   * 508.5); never a battle. Capability `filter:attacking.orPlaneswalker`.
   */
  attacking?: boolean | { defender: PlayerPred; orPlaneswalker?: true };
  /**
   * CLOUD std-msh INTERFACE CHANGE (additive), CR 506.5: the creature is attacking alone, "it's attacking but no other creatures are" ("target creature you control
   * that's attacking alone", Crowd of True Believers). `true` only: the object is an attacking creature and the only one (rules/filter.ts, statics/match.ts).
   */
  attackingAlone?: true;
  /**
   * Standard round 4, r4-trig INTERFACE CHANGE (additive), CR 208.1: "a creature you control with toughness greater than its power" (Fecund Greenshell): the
   * object's own toughness is greater than its own power, both as its characteristics are now (or as it last existed). `true` only (rules/filter.ts; static
   * abilities do not read it, statics/match.ts, so a static ability that says it stays manual).
   */
  toughnessGreaterThanPower?: true;
  /**
   * std-rx10 INTERFACE CHANGE (additive), CR 208.1: "a creature card with total power and toughness 5 or less" (Meek Attack): the object's power plus its
   * toughness, as its characteristics are now, compared with a number; an object without both has no total and never matches (rules/filter.ts; static
   * abilities do not read it, statics/match.ts).
   */
  totalPowerToughness?: NumberCmp;
  /**
   * std-rx11 INTERFACE CHANGE (additive), CR 208.1, 613.4: "a creature you control with power greater than its base power" (Kutzil, Malamet Exemplar; Ms. Marvel,
   * Elastic Ally): the object's power now is greater than its base power (its power after layer 7b: printed, or as a characteristic-defining ability or an effect
   * that sets it made it; statics/layers.ts#charsThroughLayer7b). `true` only; a permanent on the battlefield only (an object that left is unevaluable and never
   * matches). Read by rules/filter.ts; static abilities do not read it (statics/match.ts), so a static ability that says it stays manual.
   */
  powerGreaterThanBase?: true;
  /**
   * r5-fxz INTERFACE CHANGE (additive), CR 709.5c, 709.5f: a Room permanent with at least one locked door (half), "a locked door of a Room you control": `true`
   * only (rules/filter.ts; core/rooms.ts#lockedHalves). Not read by static abilities (statics/match.ts does not list it, so they never use it).
   */
  lockedDoor?: true;
  blocking?: boolean;
  blocked?: boolean;
  /**
   * FAST3 T18 ADDITION: is a blocking creature that blocks one of these objects ("for each creature blocking it", CR 509.1g, 506.4): read where the filter is
   * read (a count is fixed as the effect resolves, CR 608.2h). A creature removed from combat blocks nothing.
   */
  blockingObject?: ObjRef;
  /**
   * p2-combat-flow-1 INTERFACE CHANGE (additive): is an attacking creature one of these objects blocks ("all creatures blocked by ~", Wall of Nets; CR 509.1g-h,
   * 506.4): read where the filter is read, as `blockingObject`; a blocker removed from combat blocks nothing. Capability `filter:blockedByObject`.
   */
  blockedByObject?: ObjRef;
  /**
   * p2-combat-flow-1 INTERFACE CHANGE (additive): is blocking one of these objects or blocked by one of them ("each creature blocking or blocked by ~", Kjeldoran
   * Frostbeast, Cromat; CR 509.1g-h, 506.4): `blockingObject` or `blockedByObject` of the same objects. Capability `filter:blockingOrBlockedBy`.
   */
  blockingOrBlockedBy?: ObjRef;
  /** Is the object the source ("this creature"). */
  self?: boolean;
  /** Is one of these specific objects ("if THAT creature would die"): a reference resolved when an effect is created; see ObjRef 'fixed'. */
  is?: ObjRef;
  /** Is not the source ("another", "other"). */
  other?: boolean;
  /** Is attached to / has attachments. */
  attached?: boolean;
  /** Enchanted / equipped by the source. */
  attachedToSource?: boolean;
  /**
   * FAST4 T22 INTERFACE CHANGE (additive): is attached to one of these objects ("for each Aura attached to it", "for each Aura and Equipment attached to
   * enchanted creature", CR 301.5, 303.4): the attachment as it is when the filter is read (a static ability reads it continuously, CR 611.3a).
   */
  attachedToObject?: ObjRef;
  /**
   * p2-damage-2 INTERFACE CHANGE (additive): is attached to a player the predicate names ("the number of Curses attached to them", Curse of Thirst; CR 303.4,
   * 702.5d: an Aura with enchant player is attached to a player), the attachment as it is when the filter is read. rules/filter.ts and statics/match.ts read it.
   */
  attachedToPlayer?: PlayerPred;
  /** FAST4 T33 INTERFACE CHANGE (additive): an Equipment is attached to it ("target attacking equipped creature", CR 301.5): the object is equipped. */
  equipped?: boolean;
  /**
   * trek-9 INTERFACE CHANGE (additive): a permanent with this subtype is attached to it ("creatures you control with a Communicator attached to them", Starfleet
   * Communicator; CR 301.5, 303.4, 205.3g-h; cites unverified): the Equipment, Aura or Fortification type word named (an artifact or enchantment subtype). The
   * attachments as they are when the filter is read (a static ability reads it continuously, CR 611.3a); a phased-out one is not attached (CR 702.26b).
   * rules/filter.ts and statics/match.ts read it.
   */
  attachedWith?: string;
  /**
   * FAST5 T39 INTERFACE CHANGE (additive), CR 303.4b: the object is enchanted (an Aura is attached to it, whoever controls the Aura): "enchanted creatures you
   * control get +1/+1". The plural description; the singular "enchanted creature" is the object the source Aura is attached to (`ref: 'attachedTo'`).
   */
  enchanted?: boolean;
  /**
   * FAST5 T68 INTERFACE CHANGE (additive), CR 303.4b, 109.4: the object is enchanted by an Aura that the described player controls: "creatures you control that are
   * enchanted by Auras you control" (Archon of the Wild Rose), "each creature that's enchanted by an Aura you control" (Eriette). "you" is the controller of the
   * ability, as for `controller`; the Aura's controller, not the enchanted object's.
   */
  enchantedBy?: PlayerPred;
  /**
   * FAST5 T49 INTERFACE CHANGE (additive), CR 715.1: the card is an adventurer card, one that has an Adventure (a face with the Adventure subtype), wherever it
   * is: "cards in your graveyard that are instant cards, sorcery cards, and/or have an Adventure". True only for such a card (the Adventure's own
   * characteristics exist on the stack only, CR 715.3b, so a card in a graveyard is asked about its definition).
   */
  adventure?: boolean;
  /**
   * FAST4 T33 INTERFACE CHANGE (additive): the object is modified (CR 700.9): it has a counter on it, it is equipped, or it is enchanted by an Aura controlled by
   * its controller ("modified creatures you control have trample").
   */
  modified?: boolean;
  counters?: { kind: CounterKind; cmp?: NumberCmp };

  // history (read from GameState.history, CR 603.4 style "this turn" facts)
  enteredThisTurn?: boolean;
  /**
   * std-rx12 INTERFACE CHANGE (additive): "each creature you control that you've put one or more +1/+1 counters on this turn" (Kid Loki): counters of `kind` (any kind
   * for 'any') were put on this object this turn by the player "you" names (the `by` fact of the history's `counters` entries, CLOUD std-msh; the object as the
   * object it is now, CR 400.7, 122.6). Read by rules/filter.ts and statics/match.ts.
   */
  countersPutThisTurn?: { kind: CounterKind | 'any'; by: 'you' };
  /** "that was dealt damage this turn" (Death-Rattle Oni, Swift Demise, Restore the Peace). */
  dealtDamageThisTurn?: boolean;
  /**
   * FAST3 T14 (INTERFACE CHANGE): "dealt damage by ~ this turn" (Sengir Vampire): this object was dealt damage this turn by the source of the ability (the
   * object itself, CR 400.7: not an earlier or later object it was). Read from `GameState.history` like `dealtDamageThisTurn`.
   */
  dealtDamageBySourceThisTurn?: boolean;
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 702.122c: "a Vehicle crewed by ~ this turn" (Balthier and Fran): the object had its
   * crew cost paid this turn by tapping the source (a `becomes` 'crewCostPaid' history entry with the source as `by`, triggers/history.ts), whether or not the
   * crew ability resolved. Only `true` has a wording. Capability `filter:crewedBySourceThisTurn`.
   */
  crewedBySourceThisTurn?: boolean;
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 601.2h, 400.7d: the permanent was a spell cast with mana spent on it (`GameObject.cast`, kept from the
   * spell it was; `false`: it was not cast, or no mana was spent to cast it: "none of them were cast or no mana was spent to cast them", Satoru, the Infiltrator).
   * Capability `filter:castWithMana`.
   */
  castWithMana?: boolean;
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 603.6a, 400.7: the permanent entered the battlefield this turn from that zone ("entered from exile",
   * Extraordinary Journey): a zoneChange history entry of this object onto the battlefield with that `from` (triggers/history.ts). Capability `filter:enteredFrom`.
   */
  enteredFrom?: ZoneName;
  /**
   * std-mkm INTERFACE CHANGE (additive): "that dealt damage this turn" (Treacherous Greed): this object dealt damage this turn, as this object (CR 120.1, 400.7: the
   * `source.id` of a damage entry of `GameState.history`; an amount of 0 is no event, CR 614.7a). Capability `filter:dealtDamageAsSourceThisTurn`.
   */
  dealtDamageAsSourceThisTurn?: boolean;
  /**
   * r3-choose INTERFACE CHANGE (additive): "target permanent card in your graveyard that was put there from anywhere this turn" (Night Nurse): this object was put
   * into the zone it is in this turn, from any zone (a zone change makes a new object, CR 400.7, so the zoneChange entry of `GameState.history` whose subject is
   * this object is the move that put it there). Only `true` has a wording. Capability `filter:putThereThisTurn`.
   */
  putThereThisTurn?: true;
  /**
   * r5-fxz INTERFACE CHANGE (additive), CR 400.7: with `putThereThisTurn`, the zone the move that put it there came from: "creature cards in your opponents'
   * graveyards that were put there from the battlefield this turn" (Supper for Spiders). Read only together with `putThereThisTurn`. Capability `filter:putThereFrom`.
   */
  putThereFrom?: 'battlefield';
  /**
   * FAST5 T66 INTERFACE CHANGE (additive): "whose controller was dealt combat damage by ~ this turn" (Steel Hellkite, CR 510.2, 120.1): the object's controller (as
   * it is now) was dealt combat damage this turn by the source of the ability (the object itself, CR 400.7). Read from `GameState.history` like the other history
   * fields (capability `filter:controllerDealtCombatDamageBySourceThisTurn`).
   */
  controllerDealtCombatDamageBySourceThisTurn?: boolean;
  attackedThisTurn?: boolean;
  blockedThisTurn?: boolean;

  /** Shares a quality with another object: "that shares a creature type with it". */
  /** std-rx32 INTERFACE CHANGE (additive): `other`, "another <set>": the object tested is not one of the set it is compared with (CR 201.2: "doesn't have the same name as another permanent you control"). */
  sharesWith?: { with: ObjRef; quality: 'creatureType' | 'color' | 'cardType' | 'name' | 'landType'; other?: true };
  /** Matches a quality chosen by a linked ability: "creatures of the chosen type", "the chosen color". */
  /** Cloud std-eoe INTERFACE CHANGE (additive): quality `oddEven`, "with mana value of the chosen quality": the object's mana value is odd or even as chosen (zero is even, CR 202.3). */
  chosen?: { link: LinkId; quality: 'color' | 'creatureType' | 'cardType' | 'landType' | 'cardName' | 'oddEven' };
  /** Stack objects: what kind, and what it targets ("spell that targets ~", CR 115.9b). */
  stackKind?: 'spell' | 'activatedAbility' | 'triggeredAbility' | 'ability' | 'copy';
  /**
   * FAST5 T45 INTERFACE CHANGE (additive): an ability on the stack whose SOURCE matches this filter ("copy target activated or triggered ability you control
   * from an artifact source", CR 113.7a): the source object as it last existed (CR 608.2h, 400.7). A spell, or any object that is not an ability, never matches.
   */
  abilitySource?: ObjectFilter;
  targets?: ObjRef | PlayerRef;
  /**
   * FAST5 T45 INTERFACE CHANGE (additive), CR 115.9c: a spell or ability that targets ONLY the object or player the reference names ("an instant or sorcery
   * spell that targets only a single creature you control"): it has exactly one different target (chosen once or several times), and that one is it.
   */
  targetsOnly?: ObjRef | PlayerRef;
  /**
   * std-rx28 INTERFACE CHANGE (additive), CR 115.9b, 608.2c: an object that the spell or ability the reference names targets ("Whenever you cast a spell that targets
   * one or more creatures, those creatures gain flying", Storm, Windrider: `{ref:'event', role:'spell'}`): one of that spell's or ability's targets is this object
   * (the stack object itself, or its last known information once it has left the stack). Nothing matches when the reference names no spell or ability.
   */
  targetedBy?: ObjRef;
  /**
   * FAST5 T45 INTERFACE CHANGE (additive), CR 115.9a: the number of targets a spell or ability had when it was put on the stack, each time the same object or
   * player was chosen counted separately ("a spell with a single target" is `{op:'==', value:1}`).
   */
  targetCount?: NumberCmp;
  castFrom?: ZoneName;
  /**
   * pc-exile-play-2 INTERFACE CHANGE (additive), CR 601.2i: a spell that was the first its controller cast this turn (`turn`), or the first they cast this turn from the
   * zone it was cast from (`turnFromZone`; with `castFrom` "the first spell you cast from exile each turn"). Read from `StackInfo.castOrdinal`: a copy of a spell was never cast (CR 707.10, putCopyOnStack drops the ordinal), a copy of a card that is cast is (CR 707.12).
   * Capability `filter:firstCast`.
   */
  firstCast?: 'turn' | 'turnFromZone';
  /**
   * FAST5X E23 INTERFACE CHANGE (additive): the object's mana cost contains {X} ("spells with {X} in their mana costs", CR 107.3, 202.1): read from its
   * characteristics (for a spell, the face being cast). False: no {X} in it.
   */
  manaCostHasX?: boolean;
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 107.4, 202.1: "with one or more blue mana symbols in its mana cost" (Namor the Sub-Mariner): the number of
   * mana symbols of `color` in its mana cost (types/mana.ts#colorSymbolCount, counted as devotion counts them) compared with `cmp`. Capability `filter:manaSymbols`.
   */
  manaSymbols?: { color: Color; cmp: NumberCmp };

  // M6-0 ADDITION (m6 design 2.1): designations and statuses, read with the existing `cond: 'matches'`. Evaluated by rules/filter.ts; the capability
  // `filter:<field>` is registered by the package whose mechanism sets the status (rules/registries.ts#FILTER_PARTS).
  /** CR 719.3b: a solved Case. */
  solved?: boolean;
  /** Cloud r3-mech INTERFACE CHANGE (additive), CR 701.64: a harnessed permanent (its ∞ abilities function, parser/segment.ts#infinityLine). */
  harnessed?: boolean;
  /** CR 722.3a: a prepared permanent. */
  prepared?: boolean;
  /**
   * std-copy-2 INTERFACE CHANGE (additive), CR 722.3c-d: a prepare spell ("Whenever you cast a prepared spell", Codie, Ravenous Codex): a spell (or a copy of
   * one in exile) whose characteristics are only the prepare spell of a preparation card, made by core/prepare.ts; a copy of it is one too (CR 722.3d).
   * `true` only. Not the designation `prepared`, which only a permanent has (CR 722.3a).
   */
  prepareSpell?: boolean;
  /** CR 718.3b-d: a prototyped spell or a permanent that was one (copies included). */
  prototyped?: boolean;
  /** CR 710: a flipped permanent. */
  flipped?: boolean;

  // M11-0 ADDITION (m11 design 4.5): CR 903.3, 903.3d: is a commander (the designation belongs to the card: a face-down or copying commander still is one,
  // a copy of a commander or a token is not; a melded or merged permanent with a commander component is one, CR 903.3b-c). "Your commander" is
  // `{commander:true, owner:'you'}` (CR 903.3e; 702.124e: with two, either one). Matches nothing outside a Commander game. Registered (`filter:commander`,
  // `sfilter:commander`) by M11-1.
  commander?: boolean;
  /** FAST5X E3 INTERFACE CHANGE (additive), CR 702.171b: a saddled permanent ("while saddled", "if ~ is saddled"). */
  saddled?: boolean;
  /** FAST5X E12 INTERFACE CHANGE (additive), CR 701.60a-b: a suspected permanent ("target suspected creature", "if it's suspected"); false: not suspected. */
  suspected?: boolean;
  /**
   * std-costs-2 INTERFACE CHANGE (additive), CR 702.185a: a warped card, a card in exile that warp's delayed triggered ability exiled ("a warped creature card you own
   * in exile", Close Encounter): it has the `warped` designation (`GameObject.chosen.warped`, set as warp exiles it; the card is a new object once it leaves exile,
   * CR 400.7). Capability `filter:warped`.
   */
  warped?: true;
  /** std-rx34 INTERFACE CHANGE (additive), CR 701.37b: a monstrous permanent ("as long as ~ is monstrous", `GameObject.monstrous`); false: not monstrous. */
  monstrous?: boolean;
  /**
   * M12-3 INTERFACE CHANGE (additive), CR 701.15b: a goaded permanent ("whenever a goaded creature attacks", "goaded creatures get ..."): it has at least one
   * `GameObject.goaded` entry (by any player); false: not goaded. Capability `filter:goaded`, `sfilter:goaded`.
   */
  goaded?: boolean;
  /** std-ry8 INTERFACE CHANGE (additive), CR 702.112b: a renowned permanent ("as long as ~ is renowned", `GameObject.renowned`); false: not renowned. */
  renowned?: boolean;
  /**
   * FAST5X E3 INTERFACE CHANGE (additive), CR 702.171c: a creature that saddled one of these objects this turn ("target creature that saddled it this turn"):
   * its id is in the object's `GameObject.saddledBy`.
   */
  saddledThisTurn?: ObjRef;
  /**
   * r5-fxb INTERFACE CHANGE (additive), CR 702.122c: a creature that crewed one of these objects this turn ("target creature that crewed it
   * this turn"): its id is in the object's `GameObject.crewedBy`, as `saddledThisTurn` reads `saddledBy`. Capability `filter:crewedThisTurn`.
   */
  crewedThisTurn?: ObjRef;
  /**
   * r5-fxb INTERFACE CHANGE (additive), CR 603.10a, 301.5: a permanent that was attached to one of these objects as that object left the battlefield ("attach an
   * Equipment that was attached to Zack Fair to that creature"): its id is in the object's `LastKnown.attached.ids`. Capability `filter:wasAttachedTo`.
   */
  wasAttachedTo?: ObjRef;
  /**
   * MX3 INTERFACE CHANGE (additive), CR 701.54a-b, 701.54e: is the Ring-bearer of a player the predicate names ("your Ring-bearer": `'you'`; "Ring-bearers":
   * `'any'`): a permanent on the battlefield, under that player's control, that the player chose last as their Ring-bearer (core/ring.ts). Not copiable
   * (CR 701.54b): it is a designation of the object, never of its characteristics.
   */
  ringBearer?: PlayerPred;
}

// ---- Quantities ------------------------------------------------------------

export type Quantity =
  | number
  | { q: 'X' } // the announced X of the spell/ability being cast or resolved (CR 107.3)
  | { q: 'var'; name: string } // a value fixed earlier by a `let`, "that much", "where X is ..." (CR 608.2h)
  | { q: 'count'; of: ObjRef } // number of objects in a set: "the number of creatures you control"
  /**
   * FAST5 T53 INTERFACE CHANGE (additive): `sizeVs`, only the players of `of` whose `zone` holds a number of cards that compares by `op` with the number in the same zone of
   * the player `than` names (one player): "an opponent has more cards in hand than you" is at least one of them, "once for each opponent who has more cards in hand
   * than you" is their number (CR 402.1, 102.3). Capability `feature:q.countPlayers.sizeVs`.
   * std-sos review INTERFACE CHANGE (additive): `controlsVs`, only the players of `of` who control a number of permanents matching `filter` (its own `controller`
   * unset) that compares by `op` with the number the player `than` names (one player) controls: "an opponent controls more lands than you" is at least one of
   * them, each opponent judged alone (CR 102.2, 102.3; exact in multiplayer). Capability `feature:q.countPlayers.controlsVs`.
   */
  /**
   * std-hob INTERFACE CHANGE (additive): `sizeIs`, only the players of `of` whose `zone` holds a number of cards that compares by `op` with the fixed number `n`: "for each
   * graveyard with seven or more cards in it" counts the players whose graveyard has at least seven cards (CR 404.1: each player has one graveyard, CR 402.1, 401.1).
   * Capability `feature:q.countPlayers.sizeIs`.
   */
  /**
   * std-lci INTERFACE CHANGE (additive): `lifeVs`, only the players of `of` whose life total compares by `op` with the life total of the one player `than`
   * names: "you have the most life or are tied for most life" is no opponent with more life than you, "the player with the most life or tied for most life"
   * is no player with more life than that player (CR 119.1, 102.1). Capability `feature:q.countPlayers.lifeVs`.
   */
  /**
   * std-mkm INTERFACE CHANGE (additive): `lostLifeThisTurn`, only the players of `of` who lost life this turn ("investigate for each opponent who lost life this
   * turn": any life lost, damage included, CR 119.3, 120.3a; the players' `turnStats.lifeLost`). Capability `feature:q.countPlayers.lostLife`.
   */
  /**
   * r5-fxz INTERFACE CHANGE (additive): `didNot`, only the players of `of` who did not discard a card matching `which` in the earlier `discard` step named `step`
   * of the same resolution ("for each of those opponents who didn't discard a card with mana value 4 or greater": a player who discarded nothing counts; CR 701.9a,
   * 608.2c, 608.2h: each card read as it last existed in its owner's hand, `StepResult.before`). Effects only (a static ability has no steps). Capability
   * `feature:q.countPlayers.didNot`.
   */
  /**
   * Standard round P INTERFACE CHANGE (additive): `lostLifeIs`, only the players of `of` whose life lost this turn compares by `op` with the fixed number `n` ("if an
   * opponent lost 3 or more life this turn": the players' `turnStats.lifeLost`, any life lost, damage included, CR 119.3, 120.3a). Capability
   * `feature:q.countPlayers.lostLifeIs`.
   */
  /**
   * std-rx12 INTERFACE CHANGE (additive): `controlsIs`, only the players of `of` who control a number of permanents matching `filter` that compares by `op` with the
   * fixed number `n` ("the number of opponents who control an artifact": each opponent who controls one or more artifacts, each player counted alone on the battlefield
   * as it is now; CR 102.3, 108.4, 608.2h). The filter says nothing of a controller (the player counted supplies it). Capability `feature:q.countPlayers.controlsIs`.
   * std-control-1 INTERFACE CHANGE (additive): `speedVs`, only the players whose speed compares with another player's (no speed counts as 0, CR 702.179f):
   * "that opponent's speed is greater than each other player's speed" is one such player with speed `>=` that opponent's. Capability `feature:q.countPlayers.speedVs`.
   */
  | { q: 'countPlayers'; of: PlayerRef; sizeVs?: { zone: 'hand' | 'graveyard' | 'library'; op: Cmp; than: PlayerRef }; sizeIs?: { zone: 'hand' | 'graveyard' | 'library'; op: Cmp; n: number }; lifeVs?: { op: Cmp; than: PlayerRef }; lifeIs?: { op: Cmp; n: number }; poisonIs?: { op: Cmp; n: number }; lostLifeThisTurn?: true; lostLifeIs?: { op: Cmp; n: number }; controlsVs?: { filter: ObjectFilter; op: Cmp; than: PlayerRef }; controlsIs?: { filter: ObjectFilter; op: Cmp; n: number }; speedVs?: { op: Cmp; than: PlayerRef }; didNot?: { op: 'discard'; step: Name; which: ObjectFilter } }
  /**
   * The power, toughness, mana value, loyalty or defense of one object; of a set with `sum: true` its total (CR 208.1, 202.3). FAST5X E15 INTERFACE CHANGE
   * (additive), MX18: with `agg`, the greatest (`'max'`) or least (`'min'`) value among the objects of the set ("the greatest power among creatures you
   * control"; CR 208.1, 202.3); with no object at all the value is 0 (as the total of none is). Read once, when the effect is applied (CR 608.2h), or while
   * the spell is cast for a cost (CR 601.2f). `sum` and `agg` never come together.
   */
  /**
   * Cloud r3-mech INTERFACE CHANGE (additive): `station`, the power of a creature tapped to pay a station cost (CR 702.184a), or its toughness when a rule modification
   * `stationUsesToughness` applies to it (statics/hooks.ts#stationsUsingToughness). Only with `stat: 'power'` (keywords/data/station.json writes it).
   */
  | { q: 'stat'; stat: 'power' | 'toughness' | 'manaValue' | 'loyalty' | 'defense'; of: ObjRef; sum?: boolean; agg?: 'max' | 'min'; station?: true }
  /**
   * std-rx29 INTERFACE CHANGE (additive), CR 208.1, 613.4 (Sovereign Okinec Ahau): "that creature's base power", the power of one permanent after layer 7b (printed, or
   * as a characteristic-defining ability or an effect that sets it made it; statics/layers.ts#charsThroughLayer7b), before modifications and counters. Only a
   * permanent still on the battlefield (the base of an object that left is not recorded): otherwise it is undetermined (CR 608.2h).
   */
  | { q: 'basePower'; of: ObjRef }
  /**
   * p2-group-actions-1 ADDITION (additive): `agg`, "the highest / lowest life total among all players / your opponents" (CR 119.1): the greatest or least life total
   * of the players of `of` (a set); without `agg`, the life total of one player. Capability `feature:q.life.agg`.
   */
  | { q: 'life'; of: PlayerRef; agg?: 'min' | 'max' }
  | { q: 'zoneSize'; zone: ZoneName; of: PlayerRef }
  | { q: 'counters'; on: Ref; kind: CounterKind | 'any' }
  | { q: 'devotion'; to: Color[]; of: PlayerRef } // CR 700.5
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 107.4, 202.1: the number of mana symbols of `color` in the mana cost of the one object `of` stands for
   * (as it last existed): Namor's "create that many" after "a noncreature spell with one or more blue mana symbols in its mana cost". Capability `q:manaSymbols`.
   */
  | { q: 'manaSymbols'; of: ObjRef; color: Color }
  /** T38, CR 700.8: the number of creatures in the player's party (up to one each of Cleric, Rogue, Warrior and Wizard among the creatures they control; statics/party.ts). */
  | { q: 'partySize'; of: PlayerRef }
  /**
   * CLOUD std-misc INTERFACE CHANGE (additive): `what: 'powers'`, the number of different powers among the objects (coven: "you control three or more creatures with
   * different powers", CR 207.2c, 208.1): each object with a power counts its value once. Capability `feature:q.distinct.powers` (effects/eval.ts, statics/match.ts).
   */
  /** r4-mech INTERFACE CHANGE (additive): `what: 'colorPairs'`, "the number of different color pairs among permanents you control that are exactly two colors" (CR 105.1, 105.2a): each object of exactly two colors adds its pair; any other adds none. */
  /**
   * Standard round 4 r4-cost INTERFACE CHANGE (additive): `what: 'permanentTypes'`, the different permanent types among the objects (CR 110.4: artifact, battle,
   * creature, enchantment, land, planeswalker; "there are four or more permanent types among cards in your graveyard"). Capability
   * `feature:q.distinct.permanentTypes` (effects/eval.ts, statics/match.ts, actions/announce-cond.ts).
   */
  | { q: 'distinct'; what: 'colors' | 'cardTypes' | 'creatureTypes' | 'names' | 'landTypes' | 'manaValues' | 'powers' | 'colorPairs' | 'permanentTypes' | 'counterKinds' | 'planeswalkerTypes'; among: ObjRef } // 'planeswalkerTypes': r5-fxb INTERFACE CHANGE (additive), "the number of planeswalker types among planeswalkers you control" (CR 205.3j), capability `feature:q.distinct.planeswalkerTypes`
  /**
   * r5-cost INTERFACE CHANGE (additive): "the greatest number of creatures you control that have a creature type in common" (White Lotus Tile; CR 205.3m, 702.73a):
   * the most objects of `among` that share one creature type (a changeling has every creature type); 0 with none. Capability `q:mostSharingCreatureType`
   * (effects/eval.ts).
   */
  | { q: 'mostSharingCreatureType'; among: ObjRef }
  /** Number of events that happened in a scope: "for each creature that died this turn", "the number of spells you've cast this turn" (reads GameState.history). */
  /**
   * M6-0: scope `lastTurn` (the previous turn's entries: the werewolf transforms) and `per: 'player'`: the MAXIMUM over players of the per-player count
   * ("if a player cast two or more spells last turn"); without `per` the count is a total, as in M5.
   */
  /**
   * FAST5 T45 INTERFACE CHANGE (additive): `beforeEvent` counts only what happened BEFORE the event that triggered the ability reading this quantity ("copy it for
   * each other instant and sorcery spell you've cast before it this turn": the entries before the triggering spell's own cast entry, so a spell cast in response
   * is not counted; the same reading as `spellsBefore`, CR 702.40a). Only in an ability triggered by an event the history records with a subject (a `cast`).
   */
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive): `sum: 'amount'`, only with `per: 'player'` and a `damage` event: the amounts of the matching entries are
   * added up per player instead of counted ("if a player was dealt 6 or more combat damage this turn", Sidequest: Play Blitzball; CR 120.1, 510.2): the most damage
   * any one player was dealt (the entry's actor is the player dealt the damage, triggers/history.ts). rules/history.ts#happenedCountOf reads it; statics never do
   * (a `per` is unknown there). std-rB INTERFACE CHANGE (additive): `sum: 'amount'` without `per`, the amounts of every matching damage entry added up ("red sources
   * you controlled dealt 4 or more noncombat damage this turn", Ojer Axonil's Temple of Power; CR 120.1, 602.5b).
   */
  | { q: 'happenedCount'; event: EventPattern; scope: HistoryScope; by?: PlayerPred; per?: 'player'; beforeEvent?: boolean; sum?: 'amount' }
  /**
   * CLOUD std-tmt INTERFACE CHANGE (additive): "for each card type among spells you've cast this turn" (CR 205.2a, 601.2i, 608.2h): the number of different card
   * types among the subjects of the history entries in `scope` that match `event` (done by a player of `by`), as each object was at its event (a spell's types on
   * the stack as it was cast). Capability `q:happenedDistinct` (effects/eval.ts, rules/history.ts#distinctHistory) and `feature:history`.
   */
  /**
   * Cloud r3-mech INTERFACE CHANGE (additive): `what: 'sources'`, the number of different sources among `damage` entries ("three or more sources you controlled
   * dealt damage this turn", Case of the Burning Masks' "To solve", CR 719.3a, 120.1): the `source.id` fact of each entry with an amount greater than 0 (the source
   * as it was when it dealt the damage, CR 400.7; 0 damage is no event, CR 120.8). Same capability.
   */
  | { q: 'happenedDistinct'; event: EventPattern; scope: HistoryScope; by?: PlayerPred; what: 'cardTypes' | 'sources' }
  /** Storm (CR 702.40a): the number of spells cast this turn by ALL players before the spell of the triggering `cast` event. Fixed when that spell is cast (read from `spellCast.spellsBefore`), so a spell cast in response to the storm trigger is not counted. Only in an ability triggered by a `cast` event. */
  | { q: 'spellsBefore' }
  /**
   * Standard round 3, r3-trig INTERFACE CHANGE (additive), CR 700.2, 601.2b: "the number of times you chose a mode for that spell": how many modes were chosen
   * for the spell of the triggering cast event as it was cast (a mode chosen more than once counts each time, CR 700.2d), fixed when it was cast.
   */
  | { q: 'modesChosen' }
  /** Standard round 3, r3-trig INTERFACE CHANGE (additive), CR 606.4: "the loyalty counters you removed to activate it": of the triggering activation of a loyalty ability, how many its cost removed (0 for a + or 0 cost). */
  | { q: 'loyaltyRemoved' }
  /**
   * FAST5X E9 INTERFACE CHANGE (additive), CR 601.2h, 702.191a: "the amount of mana spent to cast that spell", the spell of the triggering `cast` event (fixed when it
   * was cast, read from `spellCast.manaSpent`). Only in an ability triggered by a `cast` event; anywhere else it fails to determine (CR 608.2b).
   * FAST5X E19 INTERFACE CHANGE (additive): `of`, the spell named ("if five or more mana was spent to cast that spell", "at least four mana was spent to cast
   * it", opus, CR 601.2h, 207.2c): `{ref:'event', role:'spell'}` is the triggering cast event's spell (as without `of`); `{ref:'self'}` this spell or the
   * permanent it became (its cast record; a copy, or an object that was not cast, had no mana spent, CR 707.10). Any other reference has no reading
   * (model/cap-walk.ts adds `feature:spellManaSpent.of.other`, which no engine registers: the ability is not automated).
   */
  | { q: 'spellManaSpent'; of?: ObjRef; from?: ObjectFilter }
  // FAST5X E19 INTERFACE CHANGE (additive): `from`, only the mana produced by a source matching it, as the source was then ("mana from a Treasure", "for each
  // mana from a Cave", CR 106.3; ManaUnit.sourceSubtypes). Only `{subtypes: [one]}` is read (`feature:spellManaSpent.from.subtype`); any other filter is not.
  /**
   * FAST5X E17 INTERFACE CHANGE (additive), CR 113.7a, 400.7, 608.2: "the number of times this ability has resolved this turn", read by the resolving ability
   * itself: the resolutions this turn of this ability of this source object, this one included (it counts as it begins to resolve; one that is removed by its
   * intervening "if" or whose targets are all illegal does not resolve, CR 603.4, 608.2b). A source that changed zones is a new object whose abilities have not
   * resolved (CR 400.7). Kept in `GameState.turnActivations` under `<sourceId>|resolved:<ability key>` (rules/resolutions.ts#countResolution). Outside a
   * resolving ability (a spell, a static ability) it fails to determine (CR 608.2b).
   */
  | { q: 'resolvedThisTurn' }
  | { q: 'eventAmount' } // "that much": damage dealt, life gained, cards drawn, counters put (CR 603.4 context)
  /**
   * Cloud C7 INTERFACE CHANGE (additive), CR 608.2c, 608.2h: `which` on `resultCount`, "for each creature destroyed this way", "the number of artifacts exiled this
   * way", "for each card discarded this way": only the objects the step named `step` reports it actually moved (`StepResult.before`: what a destroy destroyed,
   * a sacrifice sacrificed, a discard discarded, a mill put into a graveyard, a move put into its destination; a regenerated or indestructible permanent is not among them, nor
   * an object a replacement effect sent elsewhere than a move's destination) that match the filter as each last existed before it moved (CR 608.2h; a token that
   * ceased to exist too). `which: {}` counts all of them. A step that did not run, or reports nothing, moved none (0). Capability `feature:resultCount.which`.
   */
  /**
   * p2-zone-moves-1 INTERFACE CHANGE (additive), CR 701.9a, 608.2c: `maxPerOwner`, "draws cards equal to the greatest number of cards a player discarded this way"
   * (Windfall): of what the step reports it moved (matching `which` if given), the greatest number owned by one player (0 if none). Capability
   * `feature:resultCount.maxPerOwner`.
   */
  | { q: 'resultCount'; step: Name; which?: ObjectFilter; maxPerOwner?: true } // "the number of cards discarded this way"
  /**
   * FAST5X E16 INTERFACE CHANGE (additive), CR 120.4a, 120.10, 608.2c: "the excess damage dealt [to that creature] this way": the excess damage the `damage` or
   * `fight` step named `step` dealt to permanents (`StepResult.excess`: beyond lethal damage for a creature, its loyalty for a planeswalker, its defense for a
   * battle), summed; with `to`, only what it dealt to those objects ("dealt to the creature an opponent controls this way"). A step that did not run, or dealt
   * no damage to a permanent, dealt none (0); an amount that could not be computed fails to determine (CR 608.2b). Capability `q:excessDamage`.
   */
  | { q: 'excessDamage'; step: Name; to?: ObjRef }
  /**
   * std-rx20 INTERFACE CHANGE (additive), CR 120.3, 120.4b, 608.2c: "the damage dealt this way": the damage the `damage` step named `step` actually dealt
   * (`StepResult.dealt`), summed over its recipients, players and permanents alike; prevented damage was not dealt (CR 615.1) and is not counted. A step that did
   * not run dealt none (0). Read only after a `damage` step of one or more fixed sources ("~ deals damage to any target equal to ... You gain life equal to the
   * damage dealt this way."). Capability `q:damageDealt`.
   */
  | { q: 'damageDealt'; step: Name }
  /**
   * M12-3 INTERFACE CHANGE (additive), CR 119.3, 608.2c: "the life lost this way": the life the `loseLife` step named `step` made its players lose, summed over
   * every player ("each opponent loses 2 life. You gain life equal to the life lost this way": 2 per opponent who lost it, CR 119.3). A step that did not run
   * made nobody lose life (0). Capability `q:lifeLost`.
   * Cloud std-spm INTERFACE CHANGE (additive), CR 119.3, 701.12c: `who`, only the life those players lost ("If you lost life this way, draw that many cards"
   * after "you may exchange life totals with target opponent": the life you lost, not your opponent's). The step named may also be an exchange of life totals,
   * or a `may` whose optional action made players lose life (`StepResult.lifeLostBy`). Capability `feature:lifeLost.who`.
   */
  | { q: 'lifeLost'; step: Name; who?: PlayerRef }
  /**
   * std-rx14 INTERFACE CHANGE (additive), CR 122.1, 608.2c: "for each lore counter removed this way", "the number of counters removed this way": the counters the
   * `removeCounters` step named `step` actually removed (of `kind` only when given), summed over the objects it removed them from. The step may also be a `may`
   * whose optional action removed counters (`StepResult.countersRemoved`). A step that did not run removed none (0). Capability `q:countersRemoved`.
   */
  | { q: 'countersRemoved'; step: Name; kind?: CounterKind }
  /**
   * trek-6 INTERFACE CHANGE (additive), CR 122.1, 122.6, 608.2c: "if you put two or more +1/+1 counters on creatures this way": the counters the `putCounters` step
   * named `step` actually put (as the event came out of the replacement effects that applied: twice as many under a doubling effect), of `kind` only when given, summed
   * over everything it put them on. The step may also be a `may` whose optional action put counters (`StepResult.countersPut`). A step that did not run put none (0).
   * Capability `q:countersPut`.
   */
  | { q: 'countersPut'; step: Name; kind?: CounterKind }
  /**
   * M12-3 INTERFACE CHANGE (additive), CR 701.38a-b: the number of votes the vote named `step` gave the word `choice` ("for each money vote"; "if carnage gets
   * more votes" compares two of these). A vote that did not happen gave none (0). Capability `q:votes`.
   */
  | { q: 'votes'; step: Name; choice: string }
  /**
   * M12-3 INTERFACE CHANGE (additive), CR 702.121a (melee): "the number of opponents you attacked with a creature this combat": the different players other than
   * the controller that creatures the controller controlled were declared attacking in this combat phase (a planeswalker or a battle attacked is not its player;
   * creatures that left combat or the battlefield since still count: read from the game history, CR 508.1). Outside a combat phase it is 0. Capability
   * `q:opponentsAttacked`.
   * trek-7 INTERFACE CHANGE (additive): `scope: 'turn'`, "the number of opponents you attacked this turn" (Worf, Defiant Commander; the Star Trek set is newer than the
   * rules in rules/cr, CR 506.2-506.3 and 508.1 from memory): the same count over every combat of the turn so far, still read from the history (a combat's attackers
   * are written as they are declared); a planeswalker or battle attacked is not its player (CR 506.3). Same capability `q:opponentsAttacked`.
   */
  | { q: 'opponentsAttacked'; scope?: 'turn' }
  | { q: 'targetCount'; id: string } // number of targets announced for a spec of the SAME ability (CR 115.9a)
  /**
   * The number of targets of the spell this static ability is on; only in self cost modifiers (CR 601.2c, 601.2f: costs are determined after targets).
   * FAST4 T21 INTERFACE CHANGE (additive): with `filter`, only its targets that are objects matching the filter ("if it targets a tapped creature" is
   * min(1, this)), read as they are when the total cost is determined.
   */
  | { q: 'spellTargetCount'; filter?: ObjectFilter }
  /**
   * std-costs-1 INTERFACE CHANGE (additive), CR 601.2c, 601.2f, 701.59a: "the total mana value of the permanents this spell targets" (Urgent Necropsy's "collect
   * evidence X, where X is ..."): the total mana value of the spell's targets that are permanents, read as the total cost is determined, after its targets are
   * chosen (actions/cast.ts#withTargetTotals fixes it in the spell's costs). Only in an additional cost of the spell itself (model/lint-nodes.ts); at resolution
   * (effects/eval.ts) it reads the targets as they are then. Capability `q:spellTargetTotal`.
   */
  | { q: 'spellTargetTotal'; stat: 'manaValue' }
  /**
   * std-costs-1 INTERFACE CHANGE (additive), CR 601.2b, 601.2f: "for each permanent sacrificed this way" in the spell's own cost reduction (Rottenmouth Viper):
   * how many objects the caster announced for the spell's optional additional cost `name` (an `AdditionalCostDef` with `announceCount`), kept in
   * `CostsPaid.counts[name]`; 0 when it was not paid. Only in a cost modifier of the spell itself (model/lint-nodes.ts; statics/costmods.ts reads it).
   * Capability `rq:cost.costCount`.
   */
  | { q: 'costCount'; name: string }
  | { q: 'dieResult' }
  /**
   * CLOUD std-misc INTERFACE CHANGE (additive): "the chosen number", the number an earlier `chooseValue` of `what: 'number'` with this `link` chose ("Choose a number
   * between 0 and 10. Destroy all creatures with power greater than or equal to the chosen number.", CR 608.2c-d, 607.2d): read from this resolution's choices,
   * else the source's link; fails to determine when nothing was chosen (CR 608.2b). Capability `q:chosenNumber` (effects/eval.ts); never read by statics.
   */
  | { q: 'chosenNumber'; link: LinkId }
  | { q: 'speed' | 'age' | 'level' | 'turnNumber' | 'cardsDrawnThisTurn' | 'spellsCastThisTurn' | 'lifeGainedThisTurn' }
  /** FAST5 T60 INTERFACE CHANGE (additive), CR 103.4: "your starting life total" (`GameState.options.startingLife`: 20, or what the format says; 40 in Commander). */
  | { q: 'startingLife' }
  /**
   * FAST5X E22 INTERFACE CHANGE (additive), CR 700.11: "the number of times you descended this turn", the permanent cards put into its controller's graveyard
   * from anywhere this turn (`turnStats.descended`); "you descended this turn" is this compared `>=` 1.
   */
  | { q: 'descendedThisTurn' }
  /**
   * std-r9 INTERFACE CHANGE (additive): the number of turns of the controller that have begun this game, the current one included (`PlayerState.turnsBegun`;
   * extra turns count, CR 500.7, skipped turns don't, CR 500.11). "during your first, second, or third turns of the game" is your turn while this is 3 or less.
   * Capability `q:turnsBegun` (effects/eval.ts) and `sq:turnsBegun` (statics/match.ts).
   */
  | { q: 'turnsBegun' }
  /**
   * Cloud std-dsk INTERFACE CHANGE (additive), CR 709.5c, 709.5j: "the number of unlocked doors among Rooms you control": the unlocked halves (doors) of the Room
   * permanents of `among`, summed (`GameObject.unlocked`; anything that is not a Room permanent has none). Read as the effect resolves (effects/eval.ts) only.
   */
  | { q: 'unlockedDoors'; among: ObjRef }
  /**
   * FAST4 T34 INTERFACE CHANGE (additive), CR 119.3, 120.3a: the life ONE player lost this turn, all of it (damage dealt to a player causes that loss too, and
   * life gained this turn is not subtracted): the player's `turnStats.lifeLost`. `of` must name one player (several or none fail to determine, CR 608.2b).
   */
  | { q: 'lifeLostThisTurn'; of: PlayerRef }
  /**
   * FAST4 T34 INTERFACE CHANGE (additive), CR 601.2h, 106.1, 707.10: converge, "the number of colors of mana spent to cast this spell" (W, U, B, R, G among the
   * mana spent on its costs; colorless mana is no color). A copy of a spell was not cast, so no mana was spent on it (CR 707.10, its Dawnglow Infusion
   * example); a spell cast without paying mana spent none. Read from this spell (or the permanent it became) only.
   */
  | { q: 'colorsSpent' }
  /**
   * FAST5 T42 INTERFACE CHANGE (additive), CR 601.2h, 106.1, 707.10: "the amount of mana spent to cast ~" (Astelli Reclaimer): how much mana was spent on ALL the costs
   * of casting this spell or the permanent it became (generic and colored, an alternative cost's included, nothing for what was not mana: life, a sacrifice). A copy
   * of a spell was not cast (CR 707.10), a spell cast without paying its mana cost spent none. Read from this spell (or the permanent it became) only.
   */
  | { q: 'manaSpent' }
  /**
   * FAST5 T51 INTERFACE CHANGE (additive), CR 601.2h, 106.1: "the number of colors of mana spent to cast that spell" / "for each color of mana spent to cast that spell": the
   * colors (W, U, B, R, G) among the mana spent on the spell of the triggering `cast` event, read from that spell (on the stack, or as last known). Only in an ability
   * triggered by a `cast` event; anywhere else it fails to determine (CR 608.2b). A copy of a spell was not cast (CR 707.10): 0.
   */
  | { q: 'spellColorsSpent' }
  /**
   * FAST5X E19 INTERFACE CHANGE (additive), CR 106.4: "the amount of unspent mana you have" (Ozai's "as long as you have six or more unspent mana"): the mana in
   * the controller's mana pool, only of `type` when given ("unspent green mana"). Read as it is (statics: rules/characteristics.ts fingerprints `players`).
   */
  | { q: 'unspentMana'; type?: ManaType }
  | { q: 'math'; op: '+' | '-' | '*' | 'floorDiv' | 'ceilDiv' | 'min' | 'max'; args: Quantity[] }
  /**
   * Keep re-evaluating (a granted characteristic-defining value); otherwise values are fixed when a resolved effect
   * is created (CR 611.2d, 608.2h: the `effect` handler replaces every non-live quantity by its number).
   */
  | { q: 'live'; value: Quantity }
  /**
   * M6-0, CR 702.33d-e: the number of times this spell, or the spell this permanent was, was kicked (multikicker and each kicker cost count).
   * M6-12 INTERFACE CHANGE (additive): with `name`, the number of times the additional cost of that name was paid for it ("for each time its squad cost was
   * paid", CR 702.157a; replicate, CR 702.56a): the occurrences of the name in `CostsPaid.additional`.
   */
  | { q: 'kickCount'; name?: string }
  /** M6-0, CR 615.5: inside a prevention effect's `then` steps, the damage that application prevented (nothing anywhere else: fails closed). */
  | { q: 'preventedAmount' }
  /** M6-0, CR 702.37f, 702.168e: the X chosen when this permanent was turned face up by the morph/disguise special action (GameObject.faceUpX). */
  | { q: 'faceUpX' }
  /**
   * M11-0 (m11 design 4.5), CR 903.8: the number of times the controller has cast their commander(s) from the command zone this game ("for each time
   * you've cast your commander from the command zone this game"; both commanders' casts with partners). 0 outside a Commander game. Registered by M11-1.
   */
  /**
   * CMD2 INTERFACE CHANGE (additive): `of`, another player's casts of their commanders from the command zone ("for each time they've cast a commander from
   * the command zone this game", Commander's Insight: the target player's own count, CR 903.8). Capability `feature:q.commanderCasts.of` (effects/eval.ts;
   * a static ability's quantity with `of` is not read, `feature:q.commanderCasts.of.static`, never registered).
   */
  | { q: 'commanderCasts'; of?: PlayerRef }
  /**
   * pc-statics-2 INTERFACE CHANGE (additive), CR 903.4, 903.4f: the number of colors in the controller's commanders' color identity (both commanders' identities combined;
   * "Pay life equal to the number of colors in your commanders' color identity", War Room). 0 for a colorless identity; not read (the ability is not offered) without a
   * commander (War Room ruling 2020-11-10: with no commander it can't be activated) or when a commander's identity was not given. Capability `feature:q.commanderIdentitySize` (effects/eval.ts).
   */
  | { q: 'commanderIdentitySize' }
  /** MANUAL: the controller types the number. Allowed only inside steps (never in costs, targets, triggers or static conditions). */
  | { q: 'ask'; text: string };

// ---- Conditions ------------------------------------------------------------

/** std-rx1: is `n` a prime number (a whole number greater than 1 with no divisor but 1 and itself)? "a prime number of lands" (Zimone, All-Questioning). */
export function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}


export type Condition =
  | { cond: 'all'; of: Condition[] }
  | { cond: 'any'; of: Condition[] }
  | { cond: 'not'; of: Condition }
  | { cond: 'compare'; left: Quantity; op: Cmp; right: Quantity }
  /**
   * std-rx1 INTERFACE CHANGE (additive): "you control a prime number of lands" (Zimone, All-Questioning): the quantity is a prime number (a whole number greater
   * than 1 whose only divisors are 1 and itself; 0 and 1 are not prime). Evaluated by triggers/cond.ts and statics/match.ts; capability `cond:prime`.
   */
  | { cond: 'prime'; of: Quantity }
  /** "if you control a creature", "if an opponent has no cards in hand". */
  | { cond: 'exists'; of: ObjRef; atLeast?: Quantity }
  /**
   * std-cardcopy-1 INTERFACE CHANGE (additive): "if two cards that share a card type were milled this way" (The Tale of Tamiyo), "if two nonland cards that share a
   * color were milled this way" (Sphinx's Tutelage; CR 205.2a, 105.2, 608.2c): `count` of the objects `of` stands for have a card type (`what: 'cardType'`) or a
   * color (`what: 'color'`; a colorless object has none, CR 105.2c) in common: some card type or color is one of those of at least `count` of them, each read where it
   * is now, or as it last existed (CR 608.2h). Evaluated while an ability resolves (effects/eval.ts); capability `cond:share`.
   * trek-9 INTERFACE CHANGE (additive): `count: 'all'`, "if all cards exiled with this Saga share a card type" (All Good Things...; CR 205.2a, 607.2a, 608.2c; cites unverified):
   * some card type (or color) is one of those of EVERY object `of` stands for, and there is at least one object (nothing to share with no card: false, never a free
   * "yes"); a single object shares its own types with all of them.
   */
  | { cond: 'share'; what: 'cardType' | 'color'; of: ObjRef; count: number | 'all' }
  /** "if it's a creature card", "if that creature has flying", "if enchanted creature is red". */
  | { cond: 'matches'; object: ObjRef; filter: ObjectFilter }
  | { cond: 'turnOf'; whose: PlayerPred; step?: TurnStep | TurnStep[] }
  /** Cast history of THIS object (CR 607.2i-j, 400.7d): kicked, an alternative cost, the zone it was cast from. */
  // FAST4 T27 INTERFACE CHANGE (additive): `by: 'you'`, "if you cast it": the controller of the ability is the player who cast it (the cast record's `by`, CR 601.2a);
  // capability `feature:wasCast.by` (model/cap-walk.ts)
  // FAST5 T37 INTERFACE CHANGE (additive): `spent`, "if at least three white mana was spent to cast this spell" (adamant, CR 601.2h): at least `atLeast` of the mana
  // paid for the spell (or the spell this permanent was) was of that color; capability `feature:wasCast.spent`
  // std-tdm INTERFACE CHANGE (additive): `object`, "Whenever a creature you control enters, if you cast it, ..." (The Sibsig Ceremony): the cast record of that object (the
  // permanent that entered, `{ref:'event', role:'subject'}`, read from last known information once it has left, CR 608.2h) instead of the ability's own object; only
  // with `by` (CR 601.2a, 603.4, 400.7d). Capability `feature:wasCast.object`
  // Standard round 4, r4-trig INTERFACE CHANGE (additive): `fromOwner: 'you'`, with `from`, "if it was cast from your graveyard" (Rocket-Powered Goblin Glider): the zone it
  // was cast from was that of the ability's controller, i.e. the object's owner is that player (a card is in its owner's graveyard, hand or library, CR 400.3).
  // Capability `feature:wasCast.fromOwner` (model/cap-walk.ts)
  // std-rx22 INTERFACE CHANGE (additive): `kept`, "until you lose control of the spell or the permanent it becomes" (suspend's haste, CR 702.62a): with `by: 'you'`,
  // also true only while the caster has controlled the spell and the permanent without a break since it was cast (`GameObject.cast.controlLost` unset; written by
  // core/control.ts). Read for a permanent by statics/match.ts#wasCastKept only; elsewhere capability `feature:wasCast.kept`, which nothing registers (manual).
  | { cond: 'wasCast'; kicked?: boolean | string; via?: string; from?: ZoneName; fromOwner?: 'you'; xAtLeast?: number; by?: 'you'; spent?: { color: Color; atLeast: number }; object?: ObjRef; kept?: true }
  /** History queries over a scope: "if a creature died this turn", "if you've cast two spells this turn". */
  | { cond: 'happened'; event: EventPattern; scope: HistoryScope; times?: NumberCmp; by?: PlayerPred }
  /** Result of an earlier step: "if you do", "if you don't", "if that spell is countered this way" (CR 118.12, 603.12, 608.2c). */
  /**
   * FAST5X E17 INTERFACE CHANGE (additive): `which`, "if a creature you controlled was destroyed this way", "if a permanent you controlled or a token was
   * destroyed this way": the step (a `destroy`) actually destroyed at least one object that matched the filter as it last existed on the battlefield (CR
   * 608.2c, 608.2h: its controller then, a token that ceased to exist too). The step reports those objects (`StepResult.before`); a step that reports
   * none fails closed (false). Capability `feature:did.which`.
   */
  /**
   * FAST5 T75 INTERFACE CHANGE (additive): `to: 'hand'` with `which`, "if you put a Town card into your hand this way": the step (a `move` to the hand, run with `as`)
   * actually put at least one object that matched the filter into its owner's hand, read as it last existed before it moved (CR 608.2c, 608.2h, 400.7); the step
   * reports those objects the same way (`StepResult.before`, only for the cards that really ended in the hand). Capability `feature:did.which.move`.
   */
  /**
   * Cloud std-fin INTERFACE CHANGE (additive): `to: 'exile'`, "if a creature card was exiled this way": the same reading for a `move` to exile run with `as` (the cards
   * that really ended in exile, as each was before it moved). Capability `feature:did.which.move` as for the hand.
   */
  /**
   * LOOK3 and Cloud std-fin INTERFACE CHANGE (additive): `to` WITHOUT `which`, negated (`to: 'battlefield'` is new), "If you don't put the card onto the battlefield, put
   * it into your hand." (Risen Reef): the named step is the `move` of one card to that zone, the last instruction (through its `if` and `may`) of the instruction right
   * before (model/focus.ts#notPutMove); the condition holds when that move was not performed, including when it never ran because the condition before it was false or
   * the option was declined (effects/eval.ts#did reads a missing result as not performed, CR 608.2c). `to` only says which move the words name (render/cond.ts writes it
   * back). One reading of the words: LOOK3's templates (zz-cloud/look3.json) and the std-fin Cond hole build the same condition. Capability `feature:did.which.move` as above.
   */
  /**
   * Cloud C7 INTERFACE CHANGE (additive): `to` with `which` for every destination of a `move` (CR 608.2c, 608.2h, 400.7): "if a creature card was exiled this way"
   * (`'exile'`), "if you put an artifact onto the battlefield this way" (`'battlefield'`), "if a creature card was put into a graveyard this way" (`'graveyard'`):
   * the move named `step` actually put at least one object that matched the filter there, read as it last existed before it moved (a move reports only the
   * objects that ended in its destination, `StepResult.before`). `which` without `to` reads any step that reports what it moved: a destroy (FAST5X E17), a
   * sacrifice ("if a Goblin was sacrificed this way"), a discard ("if a creature card was discarded this way"). Capabilities as above.
   */
  | { cond: 'did'; step: Name; not?: boolean; which?: ObjectFilter; to?: 'hand' | 'exile' | 'battlefield' | 'graveyard' }
  /** FAST5X-4 INTERFACE CHANGE (additive): `maxSpeed`, "you have max speed": the player's speed is 4 (CR 702.179e; no speed counts as 0, CR 702.179f). */
  /**
   * FAST5X E18 INTERFACE CHANGE (additive): `enduringStory`, "you have an enduring story" (Storied, CR 702.195a-b): a designation a player keeps for the
   * rest of the game (`DesignationState.enduringStory`, core/enduring-story.ts), modelled on the city's blessing (CR 702.131c).
   */
  | { cond: 'designation'; who: PlayerRef; what: 'monarch' | 'initiative' | 'citysBlessing' | 'day' | 'night' | 'maxSpeed' | 'enduringStory' }
  /**
   * MX4 INTERFACE CHANGE (additive), CR 309.7: "you've completed a dungeon" (no `name`) or "you've completed Tomb of Annihilation" (`name`: that dungeon):
   * the player has completed such a dungeon this game (`GameState.designations.completedDungeons`, core/dungeons.ts). Negated with `not`.
   */
  | { cond: 'completedDungeon'; who: PlayerRef; name?: string }
  | { cond: 'chosen'; link: LinkId; equals: string }
  /** MANUAL: the named player (controller by default) is asked yes/no. Allowed only in step guards, `if` steps and activation restrictions. */
  | { cond: 'ask'; text: string; who?: PlayerRef }
  /** M6-0, CR 716.2a: "as long as this Class is level N or greater" (the level designation, never level counters, CR 716.4). */
  | { cond: 'classLevel'; object: ObjRef; atLeast: number }
  /** M6-0: a flag of the event being replaced, read inside a `during` body: megamorph's "if its megamorph cost was paid to turn it face up" (CR 702.37b). */
  | { cond: 'eventFlag'; flag: 'megamorphPaid' }
  /**
   * FAST5X E11 INTERFACE CHANGE (additive): "if a Dragon was beheld" (CR 701.4b): a card or permanent with that quality was beheld to pay this spell's cost,
   * judged on its characteristics at the time it was beheld (`CostsPaid.beheld`). `quality` uses only types, subtypes and supertypes.
   */
  | { cond: 'beheld'; quality: ObjectFilter }
  /**
   * FAST5X E17 INTERFACE CHANGE (additive), CR 601.2i: "if you controlled a Mount as you cast this spell": `held` was true when this spell became cast. Decided
   * once at that moment and kept on the spell (`StackInfo.castChecks`, actions/cast-checks.ts); read as the spell resolves. A spell that was not cast (a copy,
   * CR 707.10) has no record: false.
   */
  | { cond: 'asCast'; held: Condition }
  /**
   * FAST5X E26 INTERFACE CHANGE (additive), CR 702.192a (paradigm): "if this is the first time a spell you control with this spell's name has resolved this game":
   * no spell (a card or a copy, CR 707.10) controlled by this resolution's controller and sharing a name with the resolving source has resolved earlier in the game,
   * read from the game history (`resolves` entries, triggers/history.ts). Evaluated only while a spell resolves (effects/eval.ts); capability `cond:firstNamedResolution`.
   */
  | { cond: 'firstNamedResolution' }
  /**
   * CMD3 INTERFACE CHANGE (additive), CR 702.30a (echo): "if this permanent came under your control since the beginning of your last upkeep": every object
   * `object` stands for is still that object (CR 400.7), is controlled by the controller of this ability, and came under that control (`controlledSinceTurn`)
   * during or after the turn in which that player's last upkeep began; during that player's own upkeep step, "last" is the upkeep before this one
   * (PlayerState.upkeepTurns). True when the player has had no such upkeep. Capability `cond:controlledSinceUpkeep`.
   */
  | { cond: 'controlledSinceUpkeep'; object: ObjRef }
  /**
   * Standard round 4, r4-trig INTERFACE CHANGE (additive), CR 500.8, 505.1a, 506.1: "if it's the first combat phase of the turn" (Genji Glove, Raph & Leo, Sibling
   * Rivals; Karlach, Fury of Avernus): a combat phase is in progress and it is the first one that began this turn (`CombatState.number` 1; an additional combat
   * phase is the second or later, rules/combat-state.ts). False outside combat. Capability `cond:firstCombat`.
   */
  | { cond: 'firstCombat' }
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 603.4: "if it's the first time that creature has become tapped this turn" (Captain America, Living
   * Legend), "if it's the first time counters have been put on that creature this turn" (Stalwart Successor): of the events of this turn that match `event`
   * and are about `object` (the history entry's subject, the object as it was then, CR 400.7), all belong to one simultaneous batch (CR 603.2c: putting a
   * +1/+1 counter and a shield counter on a creature at once is one time). Read from the game history (`HistoryEntry.batch`, triggers/stack.ts), so the event
   * that triggered the ability is that batch; a second such event before the ability resolves makes it false (the second check, CR 603.4). `event`'s own
   * object filter is `{}`. Capability `cond:firstTime`.
   */
  | { cond: 'firstTime'; object: ObjRef; event: EventPattern }
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 603.4, 608.2h: "if one or more of them entered from exile or was cast from exile" (Extraordinary
   * Journey): at least one of the objects `object` stands for matches the filter (each read as it last existed); `matches` is every one of them. Capability
   * `cond:someMatch`.
   */
  | { cond: 'someMatch'; object: ObjRef; filter: ObjectFilter }
  /**
   * trek-2 INTERFACE CHANGE (additive), CR 601.2i, 707.10: "If this spell is the first spell you've cast this game" (First Contact): the resolving source is a spell
   * that was cast (a copy that was not cast has no cast entry) by the controller of this resolution, and no spell that player cast this game was cast before it
   * (the `cast` entries of the game history, triggers/history.ts; a spell cast in response, after it, does not count). Only `scope: 'game'`. Evaluated only while a
   * spell resolves (effects/eval.ts); false anywhere else. Capability `cond:firstSpellCast`.
   */
  | { cond: 'firstSpellCast'; scope: 'game' };

/**
 * The scopes of the history conditions (CR 603.4 style). M6-0: `lastTurn` = the previous turn's entries (the werewolf transforms "if no spells were cast last
 * turn"); the cleanup pruning keeps them until the next cleanup (rules/history.ts). The day/night check of CR 502.2 does NOT use it (m6 design E14).
 */
export type HistoryScope = 'turn' | 'combat' | 'game' | 'lastTurn';

// ---- Durations -------------------------------------------------------------

export type Duration =
  | { d: 'endOfTurn' } // "until end of turn", ends in the cleanup step (CR 514.2)
  | { d: 'endOfCombat' }
  | { d: 'permanent' } // no stated duration: until end of game (CR 611.2a)
  | { d: 'whileSource'; as: 'onBattlefield' | 'controlled' | 'attached' | 'tapped' } // "for as long as ..." (CR 611.2b)
  | { d: 'until'; event: EventPattern } // "until ~ leaves the battlefield" (CR 610.3)
  | { d: 'untilNextTurn'; whose: PlayerRef } // "until your next turn"
  | { d: 'untilNextStep'; step: TurnStep; whose?: PlayerPred }
  /**
   * MX5 INTERFACE CHANGE (additive): "doesn't untap during its controller's next untap step" (CR 502.3, 611.2a): the effect lasts THROUGH the next untap
   * step it applies in and ends as that untap step ends (core/durations.ts#expireAfterUntapStep). `whose` names the player whose untap step it is ("your
   * next untap step", "that player's next untap step"; fixed as the effect begins, like `untilNextStep`). Without `whose` it is the next untap step of the
   * controller of each object the effect is about, judged at that untap step (a permanent that changed controllers stays tapped during its new
   * controller's next untap step): the `effect` handler then stores one record per object (effects/handlers/lasting.ts). A skipped untap step does not
   * end it (CR 500.11: a skipped step does not happen). Capability `dur:throughNextUntap`.
   */
  | { d: 'throughNextUntap'; whose?: PlayerPred }
  | { d: 'asLongAs'; cond: Condition }
  /**
   * std-rx32 INTERFACE CHANGE (additive): "for as long as it remains tapped" / "for as long as it has a flood counter on it" about the object the effect is
   * about, not its source (CR 611.2b): lasts while `object` (fixed as the effect begins) is still that object on the battlefield (CR 400.7) and still tapped,
   * or still has a counter of kind `counter`. Judged from the object's own state, so the layer system reads it every time (statics/while-object.ts), and
   * core/durations.ts deletes the record. Capability `dur:whileObject`.
   */
  /**
   * std-combat-1 INTERFACE CHANGE (additive): `as: 'attached'` with `to`, "for as long as that Aura is attached to it" (Eriette, the Beguiler; CR 611.2b, 301.5, 303.4):
   * lasts while `object` (fixed as the effect begins) is still that object on the battlefield and attached to one of the objects `to` names (fixed then too, the
   * same objects, CR 400.7). Judged from the objects' own state (statics/while-object.ts).
   */
  /**
   * audit-fix-2 INTERFACE CHANGE (additive): `as: 'kept'`, "until you lose control of the spell or the permanent it becomes" (suspend's haste, CR 702.62a;
   * 400.7a): lasts while `object` (the spell just cast, fixed as the effect begins) is still that spell on the stack, or the permanent it became (the fixed set
   * is carried to it with the effect's own, statics/spell-carry.ts#carried), and its caster has controlled it without a break (statics/match.ts#wasCastKept).
   * Written only by keyword expansions (keywords/data/suspend.json), never by the parser.
   */
  | { d: 'whileObject'; object: ObjRef; as: 'tapped' | 'counter' | 'attached' | 'kept'; counter?: string; to?: ObjRef }
  /**
   * FAST5X E29 INTERFACE CHANGE (additive): "until the end of your next turn" (CR 611.2a, 514.2): ends in the cleanup step of the next turn of `whose`, the
   * first turn of that player that BEGINS after the effect began. An effect that begins during that player's own turn lasts through this turn and all of the
   * player's next turn; one that begins during another player's turn ends at the end of the player's coming turn. As that turn begins the record becomes an
   * `endOfTurn` one (core/durations.ts#expireAtTurnStart), which the cleanup step ends (CR 514.2). `whose` is fixed as the effect begins
   * (effects/handlers/lasting-fix.ts#fixDuration). Capability `dur:endOfNextTurn`.
   */
  | { d: 'endOfNextTurn'; whose: PlayerRef }
  /**
   * FAST5X E29 INTERFACE CHANGE (additive): "for as long as it remains exiled" / "for as long as that card remains exiled" (CR 611.2b, 400.7): lasts while
   * at least one of the objects the effect names is still the same object in exile. Only for an `effect` step whose effects are all permissions for named
   * objects (statics/play-permits.ts; any other use needs `feature:remainsExiled.other`, which nothing registers): the permission also dies with its object
   * (a card that leaves exile is a new object, CR 400.7); core/durations.ts deletes the record then. Capability `dur:remainsExiled`.
   */
  | { d: 'remainsExiled' }
  /**
   * r5-dig INTERFACE CHANGE (additive): "until you exile another card with ~" (Superior Foes of Spider-Man, Furious Rise, Unstable Amulet; CR 611.2a, 607.2a, 400.7):
   * lasts until an effect whose source is the record's source object exiles another card (a card exiled with that object, counted in `GameState.exiledWith` by
   * effects/handlers/zones-util.ts#proposeMove). `after` is the count when the effect began (written by effects/handlers/lasting-fix.ts#fixDuration). The source
   * as a new object (it left and came back, CR 400.7) is another object: what the old one exiled with it stays the last card. Capability `dur:untilExiledWith`.
   */
  | { d: 'untilExiledWith'; after?: number }
  /**
   * std-control-1 INTERFACE CHANGE (additive): "Take an extra turn after this one. During that turn, power-up abilities can't be activated." (CR 500.7, 611.2a):
   * the effect does nothing during the turn it began in and applies through the next turn, the extra turn just added (it is taken directly after this one,
   * CR 500.7), ending in that turn's cleanup step: as that turn begins the record becomes an `endOfTurn` one (core/durations.ts#expireAtTurnStart). As with
   * T36's "that turn's end step" (`DelayedWhen.turn: 'next'`), two extra turns added in one turn make "that turn" ambiguous and this reading stays with the
   * first turn after this one. Only for an `effect` step whose effects are all restrictions (statics/rule-sources.ts#durationActive keeps them dormant; any
   * other use needs `feature:duringNextTurn.other`, which nothing registers). Capability `dur:duringNextTurn`.
   * audit-fix-2 INTERFACE CHANGE (additive): `turn`, the id of the extra turn "that turn" is (`GameState.turn.extraTurnIds`): the last extra turn the same
   * resolution created, fixed as the effect begins (effects/handlers/lasting-fix.ts#fixDuration). The effect applies during that turn only, whichever turns are
   * taken before it (CR 500.7: a later-created extra turn is taken first), and ends unused when that turn is skipped or its player left the game (CR 800.4a).
   * No extra turn created (no id, `turn: -1`): it never applies. Without `turn` (a record from before this change) it is the next turn, as above.
   */
  | { d: 'duringNextTurn'; turn?: number };

// ---------------------------------------------------------------------------
// 4. Steps: the effect vocabulary (CR 609-610, 701)
// ---------------------------------------------------------------------------

export interface StepBase {
  /** Name the objects/players this step acted on or created, so later steps can say "it"/"that creature" (CR 608.2c). */
  as?: Name;
  /** Guard: the step is skipped unless the condition holds. */
  guard?: Condition;
  /** Index of the sentence inside the ability's text this step came from (stored form of the display text). */
  sentence?: number;
  /** Source sentence text, for manual fallback prompts and the log. Display data, hydrated from `sentence`. */
  span?: string;
}

export type EffectStep =
  // --- control flow -----------------------------------------------------------
  /**
   * also the form of self-replacement "instead" (CR 614.15). std-rx32 INTERFACE CHANGE (additive): `intervening`, the one step of a delayed triggered ability's
   * instructions that is its intervening "if" (CR 603.4): checked as the ability would trigger (triggers/delayed.ts#collectDelayed) and again as it resolves
   */
  | (StepBase & { op: 'if'; cond: Condition; then: EffectStep[]; else?: EffectStep[]; intervening?: true })
  /**
   * pc-keywords-mana-3 INTERFACE CHANGE (additive), CR 701.55 (cite from memory, unverified): `villainous`, "[who] faces a villainous choice -- [do], or [otherwise]": `who` chooses
   * one of the two lists of instructions and it is carried out; unlike an optional action neither is declined, and an option that can't be carried out may still be
   * chosen. Needs `otherwise`. Capability `feature:may.villainous`.
   */
  | (StepBase & { op: 'may'; who: PlayerRef; do: EffectStep[]; otherwise?: EffectStep[]; anyOne?: true; villainous?: true }) // CR 608.2d; `as` records whether they did
  /*
   * std-rq INTERFACE CHANGE (additive), CR 608.2d, 101.4: `anyOne`, "any opponent may sacrifice a creature of their choice. If a player does, ...": the players of the
   * group `who` are asked one at a time in APNAP order, and once one of them does it the others are not asked (one player at most does it); `as` records whether
   * someone did. Its instructions name that player as `{ref:'iterating'}`. Only with a group `who` and no `otherwise` (effects/handlers/control.ts#mayHandler).
   */
  /**
   * "[Who] may pay [cost]. If [they do], [then]; if they don't, [else]." CR 118.12. "X unless [player] pays [cost]" is `else:[X]`
   * (CR 118.12a: the payer decides FIRST, so a "you may" inside the else branch is asked afterwards: Rhystic Study).
   * `times` pays the cost that many times (cumulative upkeep). `mandatory` = "pay N life" as an instruction, no choice (CR 119.4, 118.3).
   */
  /**
   * std-combat-2 INTERFACE CHANGE (additive): `upTo`, "you may pay {1} up to three times" (CR 118.12, 608.2d): the payer chooses how many times, from 0 to that many,
   * and pays the cost that many times; the step's count is that number ("When you do, choose up to that many", `resultCount`), and it is done when the number is 1
   * or more. Capability `op:pay.upTo` (effects/handlers/pay.ts#OP_FORMS).
   */
  | (StepBase & { op: 'pay'; who: PlayerRef; cost: CostDef; times?: Quantity; upTo?: Quantity; mandatory?: boolean; then?: EffectStep[]; else?: EffectStep[] })
  /**
   * one at a time (CR 608.2f). std-rx32 INTERFACE CHANGE (additive): `gather`, the name a step of `do` binds in each iteration; after the loop it stands for what
   * every iteration bound under it, together ("For each creature card exiled this way, create a token that's a copy of it. ... sacrifice those tokens.")
   */
  | (StepBase & { op: 'forEach'; over: Ref; as: Name; do: EffectStep[]; gather?: Name })
  /**
   * r4-mech INTERFACE CHANGE (additive): `process`, "Repeat this process once." (CR 608.2c): `do` is a copy of every instruction of the effect before this step, at
   * the top level (parser/lower/repeat-process.ts builds it, model/lint-flow.ts checks it), and the renderer says only "repeat this process".
   * Merge wave 6: r3-refs's "Then repeat this process X more times." is the same step with `times` X (its own rider was folded into it).
   */
  /*
   * std-cardcopy-1 INTERFACE CHANGE (additive): `again`, "If two cards that share a card type were milled this way, draw a card and repeat this process." (The Tale
   * of Tamiyo; CR 608.2c): "repeat this process" with no count, the last instruction of the `then` of the effect's last sentence `if`. "This process" is then the
   * whole effect, that sentence included: `do` is a copy of every top-level step of the effect, the marker in that copy replaced by an empty `again` repeat
   * (parser/lower/repeat-process.ts). The step runs `do` again for as long as the empty one inside it is reached (effects/handlers/control.ts); `times` is 1 and
   * unread. Capability `op:repeat.again`.
   */
  | (StepBase & { op: 'repeat'; times: Quantity; do: EffectStep[]; process?: true; again?: true })
  | (StepBase & { op: 'let'; name: string; value: Quantity }) // fix a value once (CR 608.2h, 611.2d)
  /**
   * FAST5 T66 INTERFACE CHANGE (additive): `groupLimit`, "return up to two creature cards with total mana value 4 or less from your graveyard to the battlefield"
   * (Lively Dirge, CR 608.2d): a limit on a statistic summed over the objects chosen together (the same rule as `TargetSpec.groupLimit`, CR 115.1), kept by the
   * chooser's answer (capability `op:chooseObjects.groupLimit`).
   */
  /**
   * C6 INTERFACE CHANGE (additive): `perPlayer`, "for each player, choose a creature with power 2 or less that player controls" (CR 608.2c, 101.4): for each of these
   * players in APNAP order, `who` chooses `min`..`max` objects among those of `from` that player controls (on the battlefield; owns, in any other zone), with
   * `{ref:'iterating'}` = that player while the objects are read; `as` binds every object chosen. Capability `op:chooseObjects.perPlayer`.
   */
  /**
   * std-rx30 INTERFACE CHANGE (additive): `startingWith`, "Starting with you, each player chooses up to one permanent ... from among permanents your opponents control"
   * (The Legend of Yangchen; CR 101.4, 608.2d): `who` is a group, and each of its players in turn order, beginning with `startingWith`, chooses `min`..`max` objects of
   * `from`, seeing the choices made before (an object may be chosen again); `as` binds every object chosen. Capability `op:chooseObjects.startingWith`.
   */
  /**
   * std-library-3 INTERFACE CHANGE (additive): `eachCardType`, "For each card type, you may exile a card of that type from among them." (Portent of Calamity; CR 205.2a,
   * 608.2d): for each card type in turn, the chooser may take one object of that type not taken yet (a card of two types counts for one of them); `min`/`max` bound the
   * whole set. Capability `op:chooseObjects.eachCardType`.
   */
  /**
   * std-control-1 INTERFACE CHANGE (additive): `link`, the chosen objects are remembered by the source for a linked ability of the same face ("choose a creature an
   * opponent controls. ... When the chosen creature leaves the battlefield, transform ~.", CR 607.2d; parser/parse.ts#linkChosenObject writes it). Only with
   * neither `perPlayer` nor `startingWith`. Capability `op:chooseObjects.link`.
   */
  /**
   * std-library-1 INTERFACE CHANGE (additive): `distinct`, "Put any number of creature and/or Vehicle cards with different powers from among them into your hand" (Rip,
   * Spawn Hunter; CR 208.1, 608.2d): no two objects chosen together have the same value of that statistic (a property of the set, not of each object). The chooser
   * takes them one at a time, each with a value not taken yet. Capability `op:chooseObjects.distinct`.
   */
  /**
   * audit-fix-1 INTERFACE CHANGE (additive): `damageSource`, "a source of your choice" (CR 609.7a; from memory, unverified): an ability on the stack is also offered
   * when its source (the object it refers to, by last known information once it has left its zone) matches `from`'s filter, and a chosen ability binds that
   * source, not the ability (abilities are never sources of damage); a chosen permanent spell also covers the permanent it becomes
   * (effects/replacements.ts#standsForSource). Only with `from` an `each` filter and neither `perPlayer` nor `startingWith`. Capability `op:chooseObjects.damageSource`.
   */
  | (StepBase & { op: 'chooseObjects'; who: PlayerRef; from: ObjRef; min: Count; max: Count; as: Name; random?: boolean; groupLimit?: { stat: 'power' | 'toughness' | 'manaValue'; cmp: NumberCmp }; perPlayer?: PlayerRef; startingWith?: PlayerRef; eachCardType?: true; link?: LinkId; distinct?: 'power' | 'toughness' | 'manaValue'; damageSource?: true })
  /**
   * std-rx28 INTERFACE CHANGE (additive): `cardKind`, of a card name only: "choose a land card name" / "a nonland card name" (CR 201.3; ChooseNameDecision.cardKind).
   */
  /**
   * std-combat-5 INTERFACE CHANGE (additive): `secret`, "secretly choose Human, Merfolk, or Goblin" (A Killer Among Us; CR 608.2d, 607.2d): the value is known to the
   * chooser only until it is revealed: the link stores who knows it (`LinkValue.secret`), the client views of the other players leave the value out (core/view.ts) and
   * the log names it to the chooser only. A cost part `revealChosen` reveals it. Capability `feature:chooseValue.secret`.
   */
  | (StepBase & { op: 'chooseValue'; who: PlayerRef; what: ChoiceKind; as: Name; link?: LinkId; options?: string[]; min?: Quantity; max?: Quantity; exclude?: ChoiceExclusion[]; cardKind?: 'land' | 'nonland'; secret?: true })
  /** Players resolve it by hand (manualResolve). `reminder` also leaves a chip for text that outlives the step (manual shields). */
  | (StepBase & { op: 'manual'; text: string; reason: string; reminder?: Duration })
  // --- damage and life ----------------------------------------------------------
  /**
   * FAST2 T8 INTERFACE CHANGE (additive): `also` lists more recipients of the SAME damage, each with its own amount, dealt by the same source at the same
   * time as `to` (one damage event: CR 120.2b, 120.3f, 702.15e): "~ deals 1 damage to each creature and each player", "~ deals 4 damage to any target and
   * 2 damage to you". Never together with `divided` (the renderer refuses that shape).
   */
  /**
   * FAST5 T49 INTERFACE CHANGE (additive): `perSource`, "up to two target creatures you control each deal damage equal to their power to target creature an
   * opponent controls" (CR 120.1, 120.3, 608.2h): `source` is a group and EACH object of it deals its own damage to every recipient, the amount read once
   * for each source with `{ref:'subject'}` standing for that source (its power, before any of the damage is dealt). All of it is one simultaneous damage event
   * (CR 120.2b). Never together with `divided` or `also` (the handler and the renderer refuse that shape).
   */
  | (StepBase & { op: 'damage'; source: ObjRef; to: Ref; amount: Quantity; divided?: 'announced' | 'evenlyRoundDown' | 'evenlyRoundUp'; unpreventable?: boolean; also?: { to: Ref; amount: Quantity }[]; perSource?: boolean })
  | (StepBase & { op: 'gainLife'; who: PlayerRef; amount: Quantity })
  | (StepBase & { op: 'loseLife'; who: PlayerRef; amount: Quantity })
  | (StepBase & { op: 'setLife'; who: PlayerRef; value: Quantity })
  // --- cards ---------------------------------------------------------------------
  /**
   * edh-players-1 INTERFACE CHANGE (additive): `upTo`, "Its controller may draw up to two cards" (Arcane Denial; CR 121.1, 608.2d, 609.3): each player of `who` chooses
   * how many cards to draw, from 0 to the count (the count is the most, never an obligation). Capability `op:draw.upTo` (effects/handlers/cards-draw.ts#OP_FORMS).
   */
  | (StepBase & { op: 'draw'; who: PlayerRef; count: Quantity; upTo?: true })
  /**
   * C6 INTERFACE CHANGE (additive): `cantAs` names the players of `who` who can't do what the step tells them, "Each opponent discards a card. Each opponent who
   * can't loses 3 life." (CR 101.3: the part of an instruction that is impossible is ignored, and the card may say what happens instead; CR 608.2c, 608.2e):
   * the players who could not discard as many cards as the step asks (an empty hand, cards that can't be discarded). Capability `op:discard.cantAs`.
   */
  | (StepBase & { op: 'discard'; who: PlayerRef; count: Quantity | 'hand'; filter?: ObjectFilter; mode?: 'choose' | 'random' | 'opponentChooses'; cantAs?: Name })
  | (StepBase & { op: 'mill'; who: PlayerRef; count: Quantity })
  | (StepBase & { op: 'scry'; who: PlayerRef; count: Quantity })
  | (StepBase & { op: 'surveil'; who: PlayerRef; count: Quantity })
  | (StepBase & { op: 'reveal'; who: PlayerRef; what: ObjRef; to?: 'all' | PlayerRef })
  | (StepBase & { op: 'look'; who: PlayerRef; at: ObjRef })
  /**
   * FAST5 T42 INTERFACE CHANGE (additive): `differentNames`, "up to two basic land cards and/or Town cards with different names" (Reach the Horizon): the cards found have
   * different names (CR 201.2); the searcher takes them one at a time, each of a name not yet taken (capability `op:search.differentNames`).
   */
  /**
   * pc-zones-2 INTERFACE CHANGE (additive): `shareLandType`, "search your library for up to two basic land cards that share a land type" (CR 701.23a, 205.3i): the cards found
   * share a land type (a subtype of a land card); the searcher takes them one at a time, each sharing a land type with every card taken before (capability
   * `op:search.shareLandType`).
   */
  /**
   * CLOUD std-dft INTERFACE CHANGE (additive): `alsoZones`, "search your library and/or graveyard", "your graveyard, hand, and/or library" (CR 701.23a): the searcher
   * chooses which of `zone` and `alsoZones` (zones of the same player) to search, one or more, and finds the cards among the cards of every zone searched; the
   * order is the printed one. A library the searcher can't search (CR 101.2) is not offered. Capability `op:search.alsoZones`.
   * CLOUD C9 INTERFACE CHANGE (additive): `and`, "search your library for a basic land card and a Shrine card" (Aang's Journey, Krosan Verge): one search for one
   * card of each further description too (`filter` is the first one; only with `max` 1). A card found for one description is not found again for the next; with
   * a stated quality each may be not found (CR 701.23b). All the cards found are the one result `as` (capability `op:search.and`).
   */
  /**
   * Standard round 4, r4-refs INTERFACE CHANGE (additive): `allZones`, "search target opponent's graveyard, hand, and library" (CR 701.23a): every zone listed
   * (`zone` and `alsoZones`) is searched, where without it the searcher chooses one or more of them ("and/or"). Capability `op:search.allZones`.
   */
  /**
   * std-rx30 INTERFACE CHANGE (additive): `alsoOutside`, "Search your library and/or outside the game for exactly four legendary creature cards you own with different
   * names" (Turtles Forever; CR 400.11b, 701.23a-b): the searcher finds the cards among those of their library and the cards they own outside the game, together (and/or:
   * from either or both); a card found outside the game is brought into the game on top of its owner's library, where the found cards are, so the instructions after the
   * search find it there. Only with `zone: 'library'` and no other zones. Capability `op:search.alsoOutside`.
   */
  | (StepBase & { op: 'search'; who: PlayerRef; zone: ZoneName; alsoZones?: ZoneName[]; allZones?: true; owner?: PlayerRef; filter: ObjectFilter; min?: Count; max: Count; reveal?: boolean; differentNames?: true; and?: ObjectFilter[]; alsoOutside?: true; shareLandType?: true; as: Name })
  /**
   * Cloud std-eoe INTERFACE CHANGE (additive): "exile cards from the top of your library until you exile a nonland card" (CR 406.1, 401.1, 608.2c): `who` exiles
   * the top card of their library, one card at a time and face up, until a card that matches `filter` is exiled or the library is empty. `as` names the card it
   * stopped at (none when no card matched, so "that card" then names nothing, CR 608.2b); the other exiled cards stay in exile. The count is the number of cards
   * exiled. Capability `op:exileUntil`.
   * std-rs INTERFACE CHANGE (additive): `who` may be another player or several ("target opponent exiles cards from the top of their library until they exile a
   * nonland card", "each opponent exiles ..."): each of them in turn (APNAP order, CR 101.4) exiles from their own library; `as` then names every card it stopped at.
   * `link` names the link every card it exiled is remembered under (CR 607.2a: "you may cast a card exiled with ~"; parser/parse.ts#linkExiled sets it).
   */
  /*
   * std-rx31 INTERFACE CHANGE (additive): `total`, "exile cards from the top of your library until you exile cards with total mana value 4 or greater" (CR 406.1,
   * 202.3, 608.2c): the cards that match `filter` count toward the total of their mana values (read in exile), and the loop stops as soon as the total of every
   * counted card exiled this way reaches `atLeast` (or the library is empty). `as` then names EVERY card exiled this way ("You may cast any number of spells from
   * among them"), not one card. Capability `op:exileUntil.total`.
   */
  /**
   * trek-7 INTERFACE CHANGE (additive): `exiled`, the name every card it exiled is bound under, the card it stopped at included ("Target opponent exiles cards from the top
   * of their library until they exile a creature card. Assimilate that card. They put the rest on the bottom in a random order.", The Borg Queen; CR 406.1, 608.2c): "the
   * rest" is `exiled` less `as` that is still in exile. Written by the parser when a later sentence says "the rest" (parser/lower/mentions.ts#exiledRestOf). Capability `op:exileUntil`.
   */
  | (StepBase & { op: 'exileUntil'; who: PlayerRef; filter: ObjectFilter; total?: { stat: 'manaValue'; atLeast: Quantity }; link?: LinkId; exiled?: Name })
  /**
   * r3-dig INTERFACE CHANGE (additive): "reveal cards from the top of your library until you reveal a land card" (CR 701.20a-b, 401.1, 608.2c): `who` reveals
   * the top card of their library, then the next, until `count` (default 1) cards that match `filter` are revealed or the library has no more; the cards stay
   * in the library. `as` names the matching cards ("that card", "those land cards"), `revealed` every card revealed (so "the rest" is `revealed` less `as`).
   * Capability `op:revealUntil`.
   */
  /** Cloud r4-dig INTERFACE CHANGE (additive): `count` may be a computed quantity ("until you reveal X permanent cards, where X is ...", CR 107.3, 608.2h). */
  | (StepBase & { op: 'revealUntil'; who: PlayerRef; filter: ObjectFilter; count?: Quantity; revealed?: Name })
  /**
   * CLOUD std-dft INTERFACE CHANGE (additive): `ifSearched`, "If you search your library this way, shuffle." (CR 701.23a, 701.24a): only a library a search of the
   * same resolution searched is shuffled (StepResult.searched). Capability `op:shuffle.ifSearched`.
   */
  | (StepBase & { op: 'shuffle'; who: PlayerRef; ifSearched?: true })
  /** `separator` separates the cards into two piles, `chooser` picks one (Fact or Fiction; no dedicated CR rule, choices follow CR 608.2d). */
  /**
   * r5-dig INTERFACE CHANGE (additive), CR 700.3, 701.20a: `faceDown` "separate them into a face-down pile and a face-up pile" (Riddles in the Dark, Curator of
   * Destinies): the separator's first pile is face down (only the separator sees its cards), the second face up (every player sees it); the chooser sees the
   * face-up cards and the number of face-down ones. Capability `feature:piles.faceDown`.
   */
  | (StepBase & { op: 'piles'; cards: ObjRef; separator: PlayerRef; chooser: PlayerRef; chosen: Name; other: Name; faceDown?: true })
  // --- moving objects --------------------------------------------------------------
  /**
   * FAST5X E13 INTERFACE CHANGE (additive): `remember`: each permanent this step puts onto the battlefield remembers `what` under `link` in ITS OWN link store
   * (the new object, CR 400.7; read by its abilities as `{ref:'linked', link}`, CR 607.2a): craft's "the exiled cards used to craft it" (CR 702.167c).
   * Capability `op:move.remember`.
   */
  | (StepBase & { op: 'move'; what: ObjRef; to: Destination; until?: Duration; link?: LinkId; remember?: { link: LinkId; what: ObjRef } })
  | (StepBase & { op: 'destroy'; what: ObjRef; regeneration?: 'allowed' | 'cant' })
  | (StepBase & { op: 'sacrifice'; what: ObjRef })
  /**
   * FAST5 T66 INTERFACE CHANGE (additive): `mode: 'keepEachType'`, "each opponent chooses a permanent they control of each permanent type and sacrifices the rest"
   * (Liliana, Dreadhorde General; CR 110.4, 608.2d-e, 701.21a): each player chooses `count` permanents they control (matching `filter`) of every permanent type (artifact,
   * battle, creature, enchantment, land, planeswalker), one type at a time, a permanent of several types being a permanent of each of them; every other such permanent
   * they control is sacrificed. Capability `op:sacrificeChoice.keepEachType`.
   */
  /**
   * pc-players-1 INTERFACE CHANGE (additive; CR 110.4, 205.2a, 608.2d-e, 701.21a): with `mode: 'keepEachType'`, `keepTypes` limits the types a permanent is kept for ("each player
   * chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest": Cataclysmic Gearhulk; a
   * permanent of several types may be chosen for any or all of them, so one choice may answer for two types), `keepFilter` is the description the kept ones are chosen
   * among when it is not the description of the permanents that are sacrificed ("you choose from among the permanents that player controls an artifact, ... Then each
   * player sacrifices all other nonland permanents they control": Tragic Arrogance, whose choice pool includes lands and whose sacrifice does not), and `chooser` is who
   * chooses for each player of `who` (you, instead of each player for themselves). Capabilities `op:sacrificeChoice.keepTypes`, `.keepFilter`, `.chooser`.
   */
  /**
   * C6 INTERFACE CHANGE (additive): `cantAs` names the players of `who` who can't sacrifice as many permanents as the step asks ("Each opponent sacrifices a
   * creature of their choice. Each opponent who can't discards a card.": no such permanent they control, or none they can sacrifice; CR 101.3, 701.21a, 608.2e).
   * Not with `mode: 'all'` or `'keepEachType'` (no count to fall short of). Capability `op:sacrificeChoice.cantAs`.
   * std-rx17 INTERFACE CHANGE (additive): `exploit` = the sacrifice of an exploit ability (CR 702.110a-b): each creature sacrificed as it resolves is "exploited" by
   * the ability's source, which emits the action `exploit` (effects/handlers/zones-remove.ts) while that source is still on the battlefield. Capability
   * `op:sacrificeChoice.exploit`.
   */
  | (StepBase & { op: 'sacrificeChoice'; who: PlayerRef; filter: ObjectFilter; count: Quantity; mode?: 'choose' | 'all' | 'keepEachType'; cantAs?: Name; exploit?: true; keepTypes?: string[]; keepFilter?: ObjectFilter; chooser?: PlayerRef })
  /**
   * std-rx30 INTERFACE CHANGE (additive): `toIf`, "If a permanent spell is countered this way, exile it instead of putting it into its owner's graveyard." (Thranduil's
   * Decree; CR 701.6a, 614.15): `to` applies only to a countered spell that matches it as it is countered; any other goes to its owner's graveyard. Capability
   * `op:counter.toIf`.
   * std-rx30 INTERFACE CHANGE (additive): `sourceEffect`, "If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all
   * abilities for as long as this creature remains on the battlefield." (Tishana's Tidebinder; CR 701.6a, 113.7, 611.2a): a continuous effect with these `mods` and
   * this `duration` on the source of each ability the step counters that is a permanent matching `filter` as it is countered. Capability `op:counter.sourceEffect`.
   */
  | (StepBase & { op: 'counter'; what: ObjRef; to?: Destination; toIf?: ObjectFilter; sourceEffect?: { filter: ObjectFilter; duration: Duration; mods: Modification[] } })
  /**
   * cmd1 INTERFACE CHANGE (additive): `attacking` may name the player the tokens attack (CR 508.4: "for each opponent, create a 1/1 white Soldier creature token that's
   * tapped and attacking that opponent"), as a token copy's does (`AttackingWhom`); `true` lets the controller choose. Capability `feature:createToken.attackingWhom`.
   */
  | (StepBase & { op: 'createToken'; who: PlayerRef; token: TokenDef; count: Quantity; exceptReplaced?: true; tapped?: boolean; attacking?: boolean | AttackingWhom; attachTo?: ObjRef; counters?: CounterSpec[]; link?: LinkId })
  /**
   * M6-12 INTERFACE CHANGE (additive): `noManaCost` on a token copy, "except it has no mana cost" (CR 707.9b: part of the token's copiable values; embalm
   * CR 702.128a, eternalize CR 702.129a), capability `op:copy.except` like the other exceptions.
   */
  /**
   * std-copy-1 INTERFACE CHANGE (additive): `gains`, "The copy gains haste and "At the beginning of the end step, sacrifice this token."" and "If the copy is a
   * permanent spell, it gains haste." (`ifPermanent`): with `result: 'spell'`, each copy put onto the stack (of a permanent spell only, with `ifPermanent`) gains these
   * abilities with no duration (CR 611.2a, layer 6): a resolved effect, not a copiable value (CR 707.2, 707.10), carried to the token the copy becomes
   * (CR 400.7a, 707.10f; core/move-parts/spell-effects.ts). Capability `op:copy.gains`.
   */
  | (StepBase & { op: 'copy'; what: ObjRef; result: 'spell' | 'token'; who: PlayerRef; count?: Quantity; newTargets?: boolean | 'may'; except?: Modification[]; noManaCost?: true; tapped?: boolean; attacking?: boolean | AttackingWhom; gains?: { add: AbilityDef[]; ifPermanent?: true } })
  /**
   * r4-fxb INTERFACE CHANGE (additive): "Change the target of target spell or ability with a single target." (CR 115.7, 115.7a): `who` changes the one target of
   * each spell or ability `what` names to another legal target of it (legal for that spell or ability, as if it had been chosen for it); with no other legal
   * target the target is unchanged. The new target becomes a target of it (CR 603.2: "becomes the target" triggers, ward). Capability `op:changeTarget`.
   */
  /**
   * edh-cast-1 INTERFACE CHANGE (additive): `to`, "Change a target of target spell or ability to ~" (Spellskite), "change the target of target instant or sorcery spell with a single
   * target to this creature" (Hydroelectric Specimen): `who` changes ONE target of each spell or ability `what` names to the object `to` names, when that object is a legal
   * target for that target (CR 115.7a, 115.7b?; cites from memory, unverified): it is not already a target of the same instance of the word "target", and the spell's target spec
   * allows it. When the spell or ability has several targets `who` chooses which one to change. With no target that can be changed to it, nothing changes. Capability
   * `op:changeTarget.to` (effects/handlers/change-target.ts#OP_FORMS).
   */
  | (StepBase & { op: 'changeTarget'; who: PlayerRef; what: ObjRef; to?: ObjRef })
  | (StepBase & { op: 'tap'; what: ObjRef })
  | (StepBase & { op: 'untap'; what: ObjRef })
  | (StepBase & { op: 'attach'; what: ObjRef; to: ObjRef | null })
  | (StepBase & { op: 'changeFace'; what: ObjRef; to: 'transform' | 'convert' | 'faceUp' | 'faceDown' | 'flip'; manifest?: boolean })
  | (StepBase & { op: 'phaseOut'; what: ObjRef })
  | (StepBase & { op: 'regenerate'; what: ObjRef; duration?: Duration })
  | (StepBase & { op: 'removeFromCombat'; what: ObjRef })
  /**
   * p2-combat-flow-2 INTERFACE CHANGE (additive): "Target unblocked attacking creature becomes blocked", "Attacking creatures become blocked" (CR 509.1h, 506.4):
   * each attacking creature `what` names that is not blocked becomes a blocked creature with no creature blocking it (it stays blocked for the rest of combat and
   * deals no combat damage unless it has trample or an effect lets it assign as though unblocked, CR 510.1c). "Becomes blocked" abilities of it trigger (CR 509.3c),
   * once; "becomes blocked by a creature" ones do not (no blocker). Capability `op:becomeBlocked`.
   */
  | (StepBase & { op: 'becomeBlocked'; what: ObjRef })
  /**
   * trek-8 INTERFACE CHANGE (additive), CR 120.6, 614.1a (unverified cites): "remove all damage from it", "all damage already dealt to it is healed" (Dr. McCoy, Surly
   * Surgeon; the reminder of umbra armor says the first): all the damage marked on each permanent `what` names is removed (and with it the mark of deathtouch damage,
   * CR 704.5h). It is not regeneration: nothing is tapped and nothing leaves combat. Capability `op:removeDamage`.
   */
  | (StepBase & { op: 'removeDamage'; what: ObjRef })
  /**
   * p2-damage-2 INTERFACE CHANGE (additive): `pairs`, "each of those tokens fights a different one of those creatures" (Ezuri's Predation; CR 701.14a, 608.2d): each
   * object of `a` fights a different object of `b`, the controller pairing them (as many fights as the smaller side has creatures that can fight). Capability
   * `op:fight.pairs`.
   */
  | (StepBase & { op: 'fight'; a: ObjRef; b: ObjRef; pairs?: true })
  /**
   * p2-pt-1 INTERFACE CHANGE (additive): `lifeToughness`, "exchange your life total with ~'s toughness" (Tree of Redemption, CR 701.12a, 613.4b): `a` is one player, `b`
   * one permanent. The player gains or loses the life needed to make their life total the creature's toughness, and the creature's toughness becomes the player's
   * former life total (a layer-7b effect with no duration). Capability `op:exchange.lifeToughness` (effects/handlers/zones-status.ts).
   */
  | (StepBase & { op: 'exchange'; a: Ref; b: Ref; what: 'control' | 'life' | 'hands' | 'powerToughness' | 'lifeToughness' })
  /**
   * FXC INTERFACE CHANGE (additive): `transformed` casts a transforming double-faced card with its back face up (CR 712.11a, 712.8c: the back face's
   * characteristics, the front face's mana value); a card that isn't one can't be cast this way. First user: the Siege defeat trigger (CR 310.12b).
   */
  /**
   * FAST5X E26 INTERFACE CHANGE (additive): `copyIn`, "create a copy of [what] in [zone]. You may cast the copy" (paradigm, CR 702.192a; CR 707.12): for each
   * object a copy of the card it is (its last known information if it has left its zone, CR 608.2h) is created in that zone and cast while the effect resolves
   * (CR 707.12, 608.2g); a copy that is not cast ceases to exist (CR 707.10a, 704.5e). Capability `op:cast.copy` (effects/handlers/tokens-cast.ts#OP_FORMS).
   *
   * FAST5X E26 INTERFACE CHANGE (additive): `play`, "you may PLAY the exiled card without paying its mana cost" (hideaway, CR 702.75a): a land card is played as a
   * land as part of the resolution, which needs the player's turn and a land play left (CR 305.2a-b, 305.3; 305.9: a land is never cast), any other card is
   * cast. Capability `op:cast.play` (effects/handlers/tokens-cast.ts#OP_FORMS).
   *
   * FAST5X E29 INTERFACE CHANGE (additive): `anyManaType` = "..., and mana of any type can be spent to cast that spell" (CR 609.4b): the spell's mana payment may
   * use mana of any type (effects/cast-hook.ts `ResolutionCastOptions.anyManaType`). Capability `op:cast.anyManaType`.
   */
  /**
   * Cloud r4-repl INTERFACE CHANGE (additive): `graveyardInstead`, "... cast that card ... If that spell would be put into a graveyard, exile it instead." (CR 614.1a,
   * 400.7): each spell this step casts gets a replacement effect, created as it is cast, that sends it to `to` instead of a graveyard (`yours`: "into your
   * graveyard"), whether it resolves or is countered; it applies to that spell only (the object on the stack, CR 400.7). Capability `op:cast.graveyardInstead`.
   * std-rw7 INTERFACE CHANGE (additive): `graveyardInstead.types`, "If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead."
   * (Bilbo, Thief in the Night): only a spell of any of these card types is sent elsewhere (CR 614.1a, 205.2a); a spell of another type (an artifact spell that is
   * countered) goes to its graveyard as usual. Capability `op:cast.graveyardInstead` (the same handler, effects/handlers/tokens-cast.ts).
   */
  /*
   * std-rq INTERFACE CHANGE (additive): `maxManaValue`, "You may cast it without paying its mana cost if that spell's mana value is 8 or less" (CR 601.2, 202.3): only a
   * face or half whose resulting spell has at most that mana value may be cast (the resolution cast's option of cascade and discover, actions/cast.ts); a card with none
   * is not cast. Capability `op:cast.maxManaValue`.
   * std-rx31 INTERFACE CHANGE (additive): `maxManaValue` may be a quantity read as the step runs (CR 608.2h), "if the spell's mana value is less than or equal to
   * the amount of life you gained this turn" (Bre of Clan Stoutarm).
   */
  /*
   * std-cardcopy-7 INTERFACE CHANGE (additive): `select`, "You may cast up to three of the copies without paying their mana costs." (Baron Helmut Zemo), "You may cast any
   * number of spells with total mana value 6 or less from among the copies without paying their mana costs." (Uldaros Theorix; CR 608.2d, 601.2, 202.3): instead of a
   * yes or no for each object, the player chooses at once which of the ones that can be cast now to cast: at most `max` of them, with a total of their mana values of at
   * most `totalManaValue` (each read once, as the step starts, CR 608.2h); the chosen ones are cast in the order chosen, the others are not. Capability
   * `op:cast.select`.
   */
  | (StepBase & { op: 'cast'; who: PlayerRef; what: ObjRef; free?: boolean; costChange?: CostChange; optional?: boolean; transformed?: boolean; copyIn?: 'exile'; play?: true; anyManaType?: true; graveyardInstead?: { to: Destination; yours?: true; types?: string[] }; maxManaValue?: number | Quantity; select?: { max?: Quantity; totalManaValue?: Quantity } })
  /**
   * E3XP INTERFACE CHANGE (additive; FAST5X E31's `changeTargets` with `how: 'new'`): "you may choose new targets for it / that spell" (CR 115.7d) on a spell or
   * ability already on the stack. `who` may leave any number of its targets as they are, even illegal ones; a changed one must be legal for the stack object's
   * controller and source, never the object itself (CR 115.5); only the final set is judged (CR 115.7e), the division stays (CR 115.7f). A new target becomes a
   * target of it (CR 603.2). Beside r4-fxb's `changeTarget` ("change the target of ...", CR 115.7a). Capability `op:chooseNewTargets` (effects/handlers/new-targets.ts).
   */
  | (StepBase & { op: 'chooseNewTargets'; who: PlayerRef; what: ObjRef })
  // --- counters --------------------------------------------------------------------------
  /**
   * std-rx26 INTERFACE CHANGE (additive): `distribute`, "distribute three stun counters among any number of tapped creatures your opponents control" (no target;
   * CR 608.2c-d, 122.1; unverified cites): as the step resolves, the controller chooses one or more of the objects of `on` (an `each` set, at most `count` of
   * them) and divides `count` among them, each getting at least one (effects/handlers/counters.ts#distributedShares). Capability `op:putCounters.distribute`.
   */
  | (StepBase & { op: 'putCounters'; on: Ref; kind: CounterKind; count: Quantity; distribute?: true; /** std-mana-2 (additive): "put up to N <kind> counters on <one object>": the controller chooses how many, 0 to N (CR 608.2d; capability op:putCounters.upTo) */ upTo?: true })
  /**
   * FAST4 T31 INTERFACE CHANGE (additive): `upTo` = "remove up to N counters": the controller removes any number from 0 to N (CR 122.1, 608.2d: of any kinds
   * with `kind: 'any'`, choosing each counter's kind; capability `op:removeCounters.upTo`, effects/handlers/counters.ts#OP_FORMS).
   */
  | (StepBase & { op: 'removeCounters'; from: Ref; kind: CounterKind | 'any'; count: Quantity | 'all'; upTo?: true })
  /**
   * FAST5X E21 INTERFACE CHANGE (additive): `kind: 'any'` with `count: 'all'` is "put its counters on <object>": every counter of every kind (CR 122.5); when the
   * first object has left the battlefield, the same number of each kind it had (CR 122.8, 122.9; effects/handlers/counters.ts). Capability `op:moveCounters.every`.
   * p2-counters-move-1 INTERFACE CHANGE (additive; CR 122.5, 608.2d, cites unverified): `kind: 'any'` with a number is "move a counter / N counters from <obj> onto
   * <obj>": the controller chooses each counter's kind (capability `op:moveCounters.anyKind`); `upTo` with `count: 'all'` is "move any number of [<kind>] counters
   * from <obj> onto <obj>": the controller chooses how many of each kind, none to all (capability `op:moveCounters.upTo`).
   * p2-counters-move-4 INTERFACE CHANGE (additive; CR 122.5, 608.2d, cites unverified): `distribute`, "move any number of +1/+1 counters from ~ onto other creatures":
   * `to` is a group; the controller chooses how many of one fixed kind (with `upTo` and `count: 'all'`), then which objects of the group get them and how they are
   * divided, each at least one (effects/handlers/counters.ts#moveDistributed). Capability `op:moveCounters.distribute`.
   */
  | (StepBase & { op: 'moveCounters'; from: ObjRef; to: ObjRef; kind: CounterKind; count: Quantity | 'all'; upTo?: true; distribute?: true })
  // --- mana ----------------------------------------------------------------------------
  /** `units` is the shape M3 already runs (one entry per unit, each a list of the types it may be). */
  /**
   * FAST5 MX6 INTERFACE CHANGE (additive): `keep: 'endOfCombat'` = "Until end of combat, you don't lose this mana as steps and phases end" (firebending,
   * CR 702.189a; CR 500.5, 106.4): the units stay in the pool through the ends of the combat steps and empty as the end of combat step ends. Capability
   * `op:addMana.keepEndOfCombat` (effects/handlers/cards-mana.ts#OP_FORMS).
   * std-mkm INTERFACE CHANGE (additive): `keep: 'endOfTurn'` = "Until end of turn, you don't lose this mana as steps and phases end" (CR 500.5, 106.4, 514.2): the
   * units stay in the pool through the end of every step and phase of the turn and empty as the cleanup step ends (the "until end of turn" effect ends in it).
   * Capability `op:addMana.keepEndOfTurn`.
   */
  /**
   * std-mana-12 INTERFACE CHANGE (additive): `link`, the color of the one mana of one color this step added is a choice of this resolution under that link ("Add one mana
   * of any color. This creature becomes that color until end of turn.", Foraging Wickermaw; CR 106.1, 608.2c): read by a later step's `colors.chosen` (the parser's
   * lower/links.ts#resolveManaColor writes the link `manaColor` only after one mana of any color). Nothing is recorded for colorless or several mana.
   */
  | (StepBase & { op: 'addMana'; who: PlayerRef; units?: ManaType[][]; dynamic?: ManaProduction; restriction?: ManaRestriction; keep?: 'endOfCombat' | 'endOfTurn'; link?: LinkId ; /** std-mana-1 (additive): a rider on the spell the mana is spent on (ManaSpentRider) */ rider?: ManaSpentRider; /** std-copy-3 (additive): "When that mana is spent to cast ..." (ManaSpentTrigger) */ whenSpent?: ManaSpentTrigger })
  // --- durations, shields, delayed and reflexive triggers -----------------------------
  | (StepBase & { op: 'effect'; effects: StaticEffect[]; duration: Duration })
  /**
   * FAST5 T45 INTERFACE CHANGE (additive): `once: true` makes a delayed trigger with a `duration` trigger only for the FIRST event that fits and then end
   * ("When you next cast an instant or sorcery spell this turn, copy that spell.", CR 603.7b: it triggers once; the duration only bounds how long it waits,
   * "this turn"). Without it a stated duration lets it trigger every time (triggers/delayed.ts), without a duration it always triggers once.
   *
   * FAST5 T50 INTERFACE CHANGE (additive): `batch: true` on an event-timed delay is the "one or more" / "whenever you attack" reading of its event (CR 603.2c): all the
   * matching events of one batch are ONE occurrence of the delayed trigger, as `TriggerDef.batch` is for a triggered ability (triggers/delayed.ts#collectDelayed).
   */
  /**
   * std-tdm INTERFACE CHANGE (additive): `targets`, the targets of a delayed triggered ability that waits for an event ("Whenever you cast a noncreature spell this turn,
   * target creature you control gains double strike until end of turn"): chosen when the delayed trigger is put on the stack, after it triggers (CR 603.7, 603.3d),
   * like a reflexive trigger's (`reflexive.targets`, CR 603.12a); its instructions name them by id. Capability `feature:delay.targets`.
   */
  | (StepBase & { op: 'delay'; when: DelayedWhen; do: EffectStep[]; capture?: Name[]; duration?: Duration; once?: boolean; batch?: boolean; targets?: TargetSpec[] })
  /**
   * FAST5X E16 INTERFACE CHANGE (additive): `when.if`, a reflexive trigger that waits for a RESULT of the named step, not only for it to be carried out ("When
   * excess damage is dealt to the creature an opponent controls this way, ...", CR 603.12, 120.10): it triggers if the step was performed and `if` is true
   * right after it (read during the resolution, CR 608.2c). Capability `feature:reflexive.if`.
   */
  /**
   * r5-cost INTERFACE CHANGE (additive): `modes`, a reflexive trigger with modes ("you may pay {1}. When you do, choose one -- • ... • ..."): its modes are chosen as it
   * is put on the stack (CR 603.12, 603.3c, 700.2), each with its own targets; `do` (empty in that wording) runs after the chosen modes, as a program's steps do.
   */
  | (StepBase & { op: 'reflexive'; when: { did: Name; if?: Condition }; targets: TargetSpec[]; modes?: ModeSpec; do: EffectStep[] }) // CR 603.12
  // --- the game itself ---------------------------------------------------------------------
  | (StepBase & { op: 'extraTurn'; who: PlayerRef; count: Quantity })
  /**
   * std-control-3 INTERFACE CHANGE (additive): "you control target opponent during their next turn" / "... during their next combat phase" (CR 723.1, 723.5):
   * the controller of the spell or ability makes every decision of each player of `who` during that player's next turn, or the next combat phase of a turn of
   * theirs (`during`; core/player-control.ts). A player is never controlled by themselves this way. Capability `op:controlPlayer`.
   */
  | (StepBase & { op: 'controlPlayer'; who: PlayerRef; during: 'turn' | 'combat' })
  /**
   * r4-mech INTERFACE CHANGE (additive): `followedBy`, "there is an additional combat phase followed by an additional main phase" (CR 500.8, 505.1a): the added combat
   * phase is itself followed by an added main phase (core/turn-effects.ts#addExtraPhase). Only with `phase: 'combat'` and `followedBy: 'main'`.
   */
  /*
   * std-rq INTERFACE CHANGE (additive): `attackers`, "After this phase, there is an additional combat phase. Only land creatures can attack during that combat phase."
   * (CR 500.8, 508.1): during the added combat phase only creatures that match the filter (read for the controller of the effect) can be declared as attackers.
   * Only with `phase: 'combat'` and no `followedBy`. Capability `op:extraPhase.attackers` (core/turn-effects.ts).
   */
  | (StepBase & { op: 'extraPhase'; phase: 'combat' | 'main'; after?: TurnStep; followedBy?: 'main'; attackers?: ObjectFilter })
  /**
   * r4-fxb INTERFACE CHANGE (additive): "there is an additional end step after this step", "you get that many additional upkeep steps after this phase" (CR 500.9,
   * unverified number; CR 500.8 for phases): `count` steps of the kind `step` (1 when absent), added directly after the current step, or with `afterPhase` after the
   * current phase; several added after the same step or phase: the most recently created one occurs first. When an added step ends the turn goes on as if the step
   * or phase it was added after had just ended (core/turn.ts#goToNextStep). Capability `op:extraStep` (effects/handlers/r4-fxb.ts).
   */
  | (StepBase & { op: 'extraStep'; step: TurnStep; count?: Quantity; afterPhase?: true })
  /**
   * Standard round 10 INTERFACE CHANGE (additive): "the next spell you cast this turn can't be countered", "the next creature spell you cast this turn can't be
   * countered" (CR 101.2, 601.2i, 611.2; unverified cites): a rider on the next spell `who` casts this turn that matches `filter` (any spell when absent), applied as
   * that spell becomes cast (actions/cast.ts#takeNextSpellRiders), not by a trigger, so no player can respond before it applies. It lasts until that spell is cast
   * or the turn ends (`TurnState.nextSpell`, cleared as a turn begins). Only the filter fields effects/handlers/next-spell.ts#NEXT_SPELL_FILTER_FIELDS reads.
   * Capability `op:nextSpell` (effects/handlers/next-spell.ts).
   * std-rx26 INTERFACE CHANGE (additive): rider `keyword`, "the next noncreature spell you cast this turn has affinity for artifacts", "the next spell you cast this
   * turn has convoke" (CR 601.2a, 601.2f, 611.2c, 613.1f; unverified cites): the spell has `keyword` from the moment it is put on the stack to be cast, so the cost
   * keywords it grants work while its costs are determined and paid (core/turn-effects.ts#lockNextSpellKeywords). Only the keywords
   * effects/handlers/next-spell.ts#NEXT_SPELL_KEYWORDS names (capability `feature:nextSpell.keyword`).
   * std-freecast-1 INTERFACE CHANGE (additive): rider `free`, "the next red or green creature spell you cast this turn can be cast without paying its mana cost"
   * (CR 118.9, 601.2b, 601.2i, 611.2; unverified cites): while it waits, that player may cast a spell it matches for the alternative cost of nothing
   * (statics/play-permits.ts#grantedAlternatives); it is used up by the next matching spell that player casts, paid for that way or not
   * (core/turn-effects.ts#takeNextSpellRiders). Capability `op:nextSpell`.
   */
  | (StepBase & { op: 'nextSpell'; who: PlayerRef; filter?: ObjectFilter; rider: 'cantBeCountered' | 'keyword' | 'free'; keyword?: KeywordAbilityDef })
  | (StepBase & { op: 'endTurn' })
  | (StepBase & { op: 'winGame'; who: PlayerRef })
  | (StepBase & { op: 'loseGame'; who: PlayerRef })
  | (StepBase & { op: 'createEmblem'; who: PlayerRef; abilities: AbilityDef[] })
  | (StepBase & { op: 'rollDie'; who: PlayerRef; sides: number; count?: number; table?: { min: number; max: number; do: EffectStep[] }[] })
  /**
   * r4-mech INTERFACE CHANGE (additive): `count`, "Flip five coins." (CR 705.1): the player flips that many coins, one at a time; only without `onWin` / `onLose`
   * (parser/lower/coin-flip.ts folds those into a one-coin flip). The step's count is the flips won when they are called, else the coins that came up heads.
   * p2-coinflip-1 INTERFACE CHANGE (additive): `untilLose`, "flip a coin until you lose a flip" (CR 705.1-705.2): the player flips and calls one coin at a time
   * until they lose one; each won flip is won as it happens. The step's count is the flips won. Only for one player, without `count`, `onWin` or `onLose`.
   * Capability `op:flipCoin.untilLose`.
   * p2-coinflip-3 INTERFACE CHANGE (additive): `called`, "flip three coins. For each flip you win, ..." (CR 705.2): each flip is called, so each is won or lost, and the
   * step's count is the flips won (set by the quantities pass when "for each flip you win" counts this flip, parser/lower/quantities.ts). Capability `op:flipCoin.called`.
   */
  | (StepBase & { op: 'flipCoin'; who: PlayerRef; count?: number; onWin?: EffectStep[]; onLose?: EffectStep[]; untilLose?: true; called?: true })
  /**
   * p2-player-rules-2 INTERFACE CHANGE (additive), CR 701.30: "Clash with an opponent" / "clash with defending player": `who` (you) and the one player of `with`
   * each reveal the top card of their library, then each, in APNAP order, puts it on the top or the bottom of their library; `who` wins when they revealed a
   * card with a greater mana value than every other card revealed (CR 701.30c; a player with an empty library reveals nothing). `onWin` runs when `who` won,
   * `onLose` otherwise ("Otherwise, ...", a draw included). effects/handlers/cards-library.ts#clashHandler; the result sentences are folded by parser/lower/clash.ts.
   */
  | (StepBase & { op: 'clash'; who: PlayerRef; with: PlayerRef; onWin?: EffectStep[]; onLose?: EffectStep[] })
  /**
   * FAST5X-4 INTERFACE CHANGE (additive): `what: 'speed'` with `by`, "your speed increases by N" (CR 702.179c-d: a player with no speed gets speed N). Only the
   * inherent triggered ability of speed uses it (core/designations.ts, CR 702.179d); capability `op:designate.speed`.
   */
  /** CMD3 INTERFACE CHANGE (additive): `what: 'citysBlessing'`, "you get the city's blessing for the rest of the game" (ascend, CR 702.131a, 702.131c); capability `op:designate.citysBlessing`. */
  /**
   * std-control-1 INTERFACE CHANGE (additive): `what: 'speed'` with `decrease` and `floor`, "reduce that opponent's speed by 1. This effect can't reduce their
   * speed below 1." (CR 702.179): the speed goes down by `by` but never below `floor` (a speed already at or below it stays); a player with no speed keeps
   * none. Only with `what: 'speed'` and both fields. Capability `op:designate.speed.reduce`.
   */
  | (StepBase & { op: 'designate'; who: PlayerRef; what: 'monarch' | 'initiative' | 'day' | 'night' | 'speed' | 'citysBlessing'; by?: number; decrease?: true; floor?: number })
  /**
   * M6-6 INTERFACE CHANGE (additive, m6 design 3.7): a designation of a permanent: "this Class's level becomes N" (CR 716.2a, with `level`), "this Case becomes
   * solved" (CR 719.3a-b), "~ becomes prepared" (CR 722.3a) and "~ becomes unprepared" (CR 722.3b). The capability is the value form
   * `op:designateObject.<designation>` (effects/handlers/levels.ts#OP_FORMS), each registered with the mechanism that reads the designation.
   */
  // Cloud r3-mech INTERFACE CHANGE (additive): 'harnessed', "Harness ~." (CR 701.64: the permanent becomes harnessed; it stays so until it leaves the battlefield)
  /**
   * std-mana-12 INTERFACE CHANGE (additive): `who` performed this keyword action, an event other abilities see ("Whenever you waterbend, earthbend, firebend, or airbend",
   * Avatar Aang; CR 603.2): emitted by the earthbend macro (CR 701.66, keywords/actions/bending.ts) and by the firebending trigger as it resolves (CR 702.189,
   * keywords/data/firebending.json); never written by a parsed sentence. Capability `op:reportAction`.
   */
  | (StepBase & { op: 'reportAction'; who: PlayerRef; verb: 'earthbend' | 'firebend' })
  | (StepBase & { op: 'designateObject'; what: ObjRef; designation: 'classLevel' | 'solved' | 'harnessed' | 'prepared' | 'unprepared' | 'saddled' | 'unlockDoor' | 'lockOrUnlockDoor' | 'suspected' | 'unsuspected' | 'plotted' | 'warped'; level?: number }) // 'saddled': FAST5X E3 (CR 702.171a-b); 'unlockDoor', 'lockOrUnlockDoor': FAST5X E8 INTERFACE CHANGE (additive), CR 709.5f-g; 'suspected' / 'unsuspected': FAST5X E12 INTERFACE CHANGE (additive), "suspect it" and "it's no longer suspected" (CR 701.60a-d); 'plotted': r5-fxb INTERFACE CHANGE (additive), "It becomes plotted." (CR 702.170c-d); 'warped': std-costs-2 INTERFACE CHANGE (additive), the card warp's delayed triggered ability exiled is a warped card (CR 702.185a; keywords/data/warp.json)
  /**
   * Any other CR 701 keyword action, implemented once in the keyword library as a macro over the ops above.
   * M12-3 INTERFACE CHANGE (additive), CR 701.38a-b: `choices`, of a vote only: the words the players vote for ("each player votes for carnage or homage";
   * words with no rules meaning, each connected to an effect). A vote's choices are `choices` (words), or what `subject` stands for: objects ("votes for a
   * nonland permanent you don't control") or players (a player-only reference, "votes for a player"). The vote binds `as` to the objects or players with the
   * most votes or tied for most votes, and records the tally (`StepResult.votes`, read by `{q:'votes'}`). Capabilities `feature:vote.words`,
   * `feature:vote.players` (model/cap-walk.ts; effects/handlers/actions-native.ts).
   */
  | (StepBase & { op: 'action'; action: KeywordActionName; subject?: Ref; who: PlayerRef; n?: Quantity; arg?: string; choices?: string[] })
  /**
   * Cloud r3-mech INTERFACE CHANGE (additive), CR 400.11b: "reveal a creature card you own from outside the game and put it into your hand" (`reveal`), "put a
   * card you own from outside the game into your hand": the player chooses one card they own outside the game (their sideboard, `GameState.outside`, CR 400.11a)
   * whose front face matches `filter` (CR 712.8a: outside the game a card has its front face's characteristics), if any, and it is put into their hand. Only
   * the filter fields effects/handlers/outside.ts reads (types, notTypes, anyOf of those, colors, name); any other is a form nothing registers. Capability
   * `op:fromOutside`.
   */
  /**
   * std-rx30 INTERFACE CHANGE (additive), CR 400.11b, 201.2, 608.2d: `exactly` / `differentNames` / `chooser`, "You may reveal exactly two cards you own with different
   * names from outside the game. An opponent chooses one of them. You put that card into your hand." (Extrapolate the Impossible): the player reveals exactly that many
   * cards they own outside the game, no two with the same name (none when they can't), then `chooser` chooses one of them, and only that card is put into the hand;
   * the others stay outside the game. Only with `reveal`. Capability `op:fromOutside.chosenAmong`.
   */
  | (StepBase & { op: 'fromOutside'; who: PlayerRef; filter?: ObjectFilter; reveal: boolean; exactly?: number; differentNames?: true; chooser?: PlayerRef });

export type EffectOp = EffectStep['op'];

export type ChoiceKind = 'color' | 'creatureType' | 'cardType' | 'landType' | 'cardName' | 'number' | 'player' | 'opponent' | 'option' | 'oddEven';

/**
 * M6-8 INTERFACE CHANGE (additive): a value `chooseValue` never offers: a fixed value ("the new creature type can't be Wall") or the value chosen earlier in this
 * resolution for a link ("one color word with another": the second choice is a different word, CR 612.2). A value of a color choice may be a letter or a word.
 */
export type ChoiceExclusion = string | ChosenWord;

/** M6-8 INTERFACE CHANGE (additive): the value chosen for a link (`chooseValue ... link`) as this resolution goes, stored as the value itself once fixed (CR 608.2h). */
export interface ChosenWord {
  chosen: LinkId;
}

/** CR 701 keyword actions that are not primitive steps. Library macros expand them (CR 701.x cited per action in design section 7.5). */
export type KeywordActionName =
  | 'investigate' | 'explore' | 'amass' | 'connive' | 'populate' | 'proliferate' | 'bolster' | 'adapt' | 'monstrosity'
  | 'support' | 'fabricate' | 'manifest' | 'cloak' | 'manifestDread' | 'suspect' | 'incubate' | 'discover' | 'learn'
  | 'goad' | 'detain' | 'exert' | 'renown' /* std-ry8: renown N, CR 702.112a */ | 'clash' | 'vote' | 'ringTempts' | 'venture' | 'timeTravel' | 'meld' | 'planeswalk'
  | 'doubleCounters' | 'doublePT' | 'collectEvidence' | 'forage' | 'blight' | 'endure' | 'behold' | 'waterbend' | 'airbend' | 'earthbend'
  | 'abandon' | 'setInMotion' | 'assemble' | 'harness' | 'openAttraction' | 'rollToVisit' | 'cascade' | 'cycle' | 'transmute'
  /** MX2 ADDITION: "exile them, then meld them into <result>" after "if you both own and control ~ and a <type> named <its meld partner>" (CR 701.42a, 603.4). */
  | 'meldPair'
  /** FAST5X E1 ADDITION: "gives a gift" (CR 702.174c): the gift of a spell or of a permanent's gift trigger was given; emits the `giveGift` action event. */
  | 'giveGift'
  /**
   * FAST5 MX6 ADDITION (INTERFACE CHANGE, additive): "empower <planeswalker type> N" (not a CR 701 term; its reminder text defines it: put N loyalty counters on a
   * <type> token you control, first creating the <type> planeswalker token if you control none). `arg` is the planeswalker type.
   */
  | 'empower'
  /**
   * FAST5X E18 ADDITION (INTERFACE CHANGE, additive): "recruit" (not a CR 701 term yet; its reminder text defines it): draw a card, then discard a card; if a
   * nonland card was discarded, create a 1/1 white Human Soldier creature token (keywords/actions/library.ts#RECRUIT, modelled on connive, CR 701.50a).
   */
  | 'recruit'
  /**
   * trek-1 ADDITION (INTERFACE CHANGE, additive): "assimilate <card>" (Star Trek; not in the CR edition of rules/cr, its reminder text defines it): put the card onto the
   * battlefield under your control with a +1/+1 counter; it's a Borg artifact creature and loses all other creature types (keywords/actions/assimilate.ts). Listed
   * here, not last, so that other rounds appending to the union do not touch the same line.
   */
  | 'assimilate'
  /**
   * cloud std-spm ADDITION (INTERFACE CHANGE, additive): "double the number of each kind of counter on <subject>" (CR 701.10e for each kind the object has):
   * every kind of counter on each permanent or player of `subject` is doubled, the kinds and their numbers read before any counter is put
   * (effects/handlers/actions-native-counters.ts). `doubleCounters` with `arg` is the same action for one named kind.
   */
  | 'doubleEachKind'
  /**
   * Standard round 5, r5-refs ADDITION (INTERFACE CHANGE, additive): "for each kind of counter on <subject>, give that permanent or player another counter of that
   * kind" (CR 122.1, 122.6): one more counter of each kind each permanent or player of `subject` has, the kinds read before any counter is put (proliferate's
   * "give each another counter of each kind already there" for named holders, CR 701.34a; effects/handlers/actions-native-counters.ts).
   */
  | 'anotherOfEachKind';

interface DestinationBase {
  /** Whose library/graveyard/hand/exile bin: the owner by default (CR 400.3). */
  owner?: PlayerRef;
  /** Library placement; `nth` counts from the top (CR 401.3). */
  position?: 'top' | 'bottom' | { nth: Quantity } | 'random';
  /** When several cards go to an ordered zone: owner's choice ("in any order"), random, or as listed. */
  order?: 'chosen' | 'random' | 'asBound';
  /**
   * p2-dig-1 INTERFACE CHANGE (additive): with `order: 'chosen'`, the player who arranges the cards when the effect says so instead of the owner (CR 401.4: "unless
   * the effect says otherwise"): "Look at the top three cards of target player's library, then put them back in any order" (Portent) is arranged by the player who
   * looked, the spell's controller. Capability `op:move.arrangedBy`.
   */
  arrangedBy?: PlayerRef;
  tapped?: boolean;
  faceDown?: boolean;
  transformed?: boolean;
  /**
   * std-typechange-1 INTERFACE CHANGE (additive), CR 702.49c, 508.4: `{ asReturned: true }`, attacking the same player, planeswalker or battle as the creature
   * returned to its owner's hand to pay the cost of the ability or spell doing the move (`CostsPaid.returned`, as it last existed: ninjutsu). Nothing to attack
   * (that creature attacked nothing, or what it attacked is gone) is never attacking (CR 508.4a). Capability `op:move.attackingAsReturned`.
   */
  attacking?: boolean | { defender: PlayerRef } | { asReturned: true };
  attachedTo?: ObjRef;
  counters?: CounterSpec[];
  /**
   * std-typechange-2 INTERFACE CHANGE (additive), CR 608.2c, 508.4: `tapped` and `attacking` apply only to the moved objects that match this filter as they are
   * before the move ("put a creature card from your hand onto the battlefield. If that card is an enchantment card, it enters tapped and attacking": Summoner's
   * Grimoire); every other object enters untapped and not attacking. Capability `op:move.statusIf`.
   */
  statusIf?: ObjectFilter;
}

/**
 * Where an object goes. Moving to the battlefield REQUIRES `controller` (CR 110.2: an object put onto the battlefield enters under the
 * control of the player who put it there unless the effect says otherwise, and that player is not always the controller of the effect:
 * Path to Exile's searching player). "under its owner's control" is 'owner'.
 */
export type Destination = DestinationBase & (
  | { zone: 'battlefield'; controller: 'owner' | PlayerRef }
  | { zone: Exclude<ZoneName, 'battlefield'>; controller?: undefined }
);

/**
 * M6-12 INTERFACE CHANGE (additive): what a token put onto the battlefield attacking attacks (CR 508.4): the named player, or that player or a planeswalker they
 * control ("attacking that player or a planeswalker they control", myriad CR 702.116a). Absent (`attacking: true`): its controller chooses among every defender.
 */
export interface AttackingWhom {
  defender: PlayerRef;
  orPlaneswalkers?: true;
}

export interface CounterSpec {
  kind: CounterKind;
  count: Quantity;
}

export interface CostChange {
  /** "without paying its mana cost" is `free`; otherwise reduce/increase/replace. */
  kind: 'reduce' | 'increase' | 'set';
  /**
   * std-ru INTERFACE CHANGE (additive), CR 118.9, 202.3, 107.3a: with `kind: 'set'` on a permission, "If you cast a spell this way, pay life equal to its mana value
   * rather than pay its mana cost": the alternative cost every spell cast with that permission is cast for (it is not optional), life equal to the mana value of the
   * spell as it would be on the stack (an X in its mana cost is announced and counted, CR 107.3a, 202.3e). Honored on the permissions for the cards an object's
   * linked ability exiled (statics/play-permits.ts#linkedPermitLifeCost; capability `feature:permit.<action>.linked.lifeCost`); any other form is unregistered.
   */
  life?: 'manaValue';
  mana?: ManaCost;
  generic?: Quantity;
  /**
   * M6-12 INTERFACE CHANGE (additive): with `kind: 'set'`, "by paying [cost] rather than paying its mana cost": an alternative cost (CR 118.9, 601.2b,
   * 601.2f-h) under the name `name` (read by `wasCast.via`; madness, CR 702.35a-b). The only form of `op:cast.costChange` the cast handler carries out
   * (effects/handlers/tokens-cast.ts); every other form is named `op:cast.costChange.<kind>` by the capability walker and resolved by hand.
   */
  cost?: CostDef;
  name?: string;
}

export type ManaProduction =
  /**
   * "one mana of any color" (each unit may differ). r3-cost INTERFACE CHANGE (additive): `from`, the types each unit is chosen among ("Add {R} or {G} for each
   * Raccoon you control": one choice per unit, CR 106.1, 106.4; Muerra, Trash Tactician). Capability `feature:mana.anyColor.from`.
   */
  | { kind: 'anyColor'; count: Quantity; from?: ManaType[] }
  /**
   * FAST5 T48 INTERFACE CHANGE (additive): `from` = the types the one choice is limited to ("Add X {G} or X {W}, where X is the number of other creatures you
   * control": X mana of {G}, or X mana of {W}, never a mix; CR 106.1b, 106.4). Absent: any color (as before).
   */
  | { kind: 'anyOneColor'; count: Quantity; from?: ManaType[] } // "N mana of any one color"
  /**
   * FAST5 T48 INTERFACE CHANGE (additive): "For each color among permanents you control, add one mana of that color" (Vivid; CR 105.1, 106.4): one mana of
   * each color that at least one of the objects `among` has (colorless is not a color, CR 105.4; a multicolored permanent counts for each of its colors).
   * Read as the ability resolves (CR 608.2h).
   */
  | { kind: 'eachColorAmong'; among: ObjRef }
  /**
   * FAST5 T48 INTERFACE CHANGE (additive): "Add one mana of any of the exiled cards' colors" (CR 106.5): `count` mana, each of any color the objects `of`
   * (a linked ability's exiled cards, CR 607.2a) have, chosen unit by unit; no mana at all when none of them has a color (CR 106.5).
   */
  | { kind: 'colorsOf'; of: ObjRef; count: Quantity }
  /**
   * CMD3 INTERFACE CHANGE (additive): `or`, "Add {W} or one mana of the chosen color" (the Thriving lands; CR 106.1b, 607.2d): each unit is one of these types or
   * the chosen color, the player's choice as the ability resolves. Capability `op:addMana.chosenOr`.
   */
  | { kind: 'chosen'; link: LinkId; count: Quantity; or?: ManaType[] } // "the chosen color"
  | { kind: 'ofType'; type: ManaType; count: Quantity } // "an amount of {G} equal to ..."
  | { kind: 'sameAsSpent' }
  /**
   * M11-0 (m11 design 4.5): "one mana of any color in your commander's color identity" (Command Tower, Arcane Signet; CR 903.4, 702.124c: both commanders'
   * identities combined). CR 903.4f: no commander (any game that is not a Commander game) or a colorless identity: the production adds nothing. Capability
   * `feature:mana.commanderIdentity` (model/cap-walk.ts), registered by M11-1.
   */
  | { kind: 'commanderIdentity'; count: Quantity }
  /**
   * T38 INTERFACE CHANGE (additive): "one mana of any type that land produced" (CR 106.3, 605.1b), the mana of a triggered mana ability that triggers from tapping a
   * land for mana: `count` units, each of a type the triggering activation produced (EventContext.produced); `noun` is the word the text uses for the source.
   * Capability `feature:mana.eventProduced` (triggered mana abilities only: an activated mana ability has no triggering event).
   */
  | { kind: 'eventProduced'; count: Quantity; noun: 'land' | 'permanent' | 'artifact token' }
  /**
   * p2-mana-1 INTERFACE CHANGE (additive), CR 106.7: "one mana of any color that a land an opponent controls could produce" (`colorsOnly`; "any type" without it):
   * each unit one of the types the activated mana abilities of the objects `among` names would produce if they resolved now (their costs ignored). An ability
   * whose types the engine can't read (a type chosen elsewhere, another "could produce") leaves the step to the player (never a guess). Capability
   * `feature:mana.couldProduce` (effects/handlers/cards-mana.ts).
   * edh-mana-keywords-1 INTERFACE CHANGE (additive), CR 106.1, 106.7: `oneType`, "If ~ has a +1/+1 counter on it, add three mana of that type instead" (Incubation Druid):
   * one type is chosen among those and every unit is that type (without it each unit is chosen on its own). Capability `op:addMana.couldProduce.oneType`.
   */
  | { kind: 'couldProduce'; count: Quantity; among: ObjRef; colorsOnly?: true; oneType?: true }
  /**
   * p2-mana-2 INTERFACE CHANGE (additive), CR 700.5, 106.1: "Choose a color. Add an amount of mana of that color equal to your devotion to that color." (Nykthos, Shrine
   * to Nyx; Nyx Lotus): the player chooses a color as the ability resolves, then adds that many mana of it as the mana symbols of that color among the mana costs of
   * the permanents `of` controls. Capability `feature:mana.devotionColor`.
   */
  | { kind: 'devotionColor'; of: PlayerRef }; // std-mana-1: 'permanent', 'artifact token' ("whenever you tap an artifact token for mana", CR 106.12)

/**
 * "Spend this mana only to cast creature spells" (Cavern of Souls, 177 cards). Structured so the payment code can ENFORCE it;
 * restriction wording the engine cannot represent here makes the `addMana` step manual (never a free-text string that is ignored).
 */
/** std-copy-3: the triggered ability mana carries ("When that mana is spent to cast <spells>, <do>"; `addMana.whenSpent`, CR 106.6, 603.2). */
export interface ManaSpentTrigger {
  /** The spells whose casting the mana must pay for (as each is cast; CR 601.2h). */
  spells: ObjectFilter;
  /** The instructions of the triggered ability ("that spell": `{ref:'event', role:'spell'}`). */
  do: EffectStep[];
}

export interface ManaRestriction {
  /** The mana can be spent only on spells matching this filter (a missing field means "not on those"). */
  spells?: ObjectFilter;
  /** ... and/or on activating abilities of sources matching this filter. */
  abilities?: ObjectFilter;
  /** Spells cast with this mana get a rider (Cavern of Souls: "that spell can't be countered"). */
  spellRider?: 'cantBeCountered';
  /** FAST5X E8 INTERFACE CHANGE (additive): ... and/or on unlock costs ("Spend this mana only to cast Room spells and unlock doors", CR 709.5e, 116.2m). */
  unlock?: true;
  /**
   * FAST5X E23 INTERFACE CHANGE (additive): with `abilities`, only abilities that keyword makes ("activate an equip ability": the activated ability of equip,
   * CR 702.6a; provenance `{by: 'keyword', id}` of the expanded ability). Capability `feature:mana.restriction.abilityKeyword`.
   */
  abilityKeyword?: 'equip';
  /**
   * FAST5X E23 INTERFACE CHANGE (additive): ... and/or on the cost to turn a face-down permanent matching this filter face up ("turn a permanent face up",
   * "turn creatures face up"): the special action of morph, disguise, manifest and cloak (CR 116.2b, 702.37e, 702.168d, 708.7), neither a spell nor an
   * ability. Capability `feature:mana.restriction.turnFaceUp`.
   */
  turnFaceUp?: ObjectFilter;
  /**
   * FAST5X E23 INTERFACE CHANGE (additive): "This mana can't be spent to cast <spells>" (CR 106.6): the mana may pay any cost (an ability, a special action, a
   * cost an effect asks for) EXCEPT the cost of casting a spell matching this filter. Never combined with the other fields. Capability
   * `feature:mana.restriction.notSpells`.
   */
  notSpells?: ObjectFilter;
}

/**
 * std-mana-1 INTERFACE CHANGE (additive), CR 106.6, 601.2h, 611.2c, 400.7a (cites unverified): a rider on the mana an `addMana` step adds that does something
 * to the spell the mana is spent on, without limiting what the mana may pay for: "If that mana is spent on a Dragon creature spell, it gains haste until end of
 * turn." (Carnelian Orb of Dragonkind), "If any of that mana is spent on a creature spell, it gains haste until end of turn.", "If that mana is spent on an
 * instant or sorcery spell, that spell can't be countered.". When a spell matching `spells` is cast with at least one unit carrying the rider, the spell gains
 * the keyword until end of turn (a layer 6 effect on the spell, carried to the permanent it becomes, CR 400.7a) or can't be countered (CR 101.2). `any` is the
 * wording "any of that mana" only. Capability `feature:mana.spentRider` (actions/cast.ts#applySpentRiders).
 */
export interface ManaSpentRider {
  /** The spells the rider applies to, stored as a restriction stores them (no stack kind, no zone). */
  spells: ObjectFilter;
  any?: true;
  /** "it gains <keyword> until end of turn" */
  gains?: KeywordAbilityDef;
  /** "that spell can't be countered" */
  cantBeCountered?: true;
  /**
   * pc-keywords-mana-2 INTERFACE CHANGE (additive), CR 614.1c, 106.6 (Biophagus: "If this mana is spent to cast a creature spell, that creature enters with an additional +1/+1
   * counter on it"): counters the permanent the spell becomes enters with, recorded on the spell as it is cast (`StackInfo.permitEnters`, core/mana-riders.ts). Capability
   * `feature:mana.spentRider.entersWith`.
   */
  entersWith?: CounterSpec[];
}

export type DelayedWhen =
  /** "at the beginning of the next end step", "at the beginning of your next upkeep" (CR 603.7). */
  /**
   * FAST5 T36 INTERFACE CHANGE (additive): `turn: 'next'` is the turn that begins right after the turn the delayed trigger was created in ("Take an extra turn
   * after this one. At the beginning of that turn's end step, you lose the game.", CR 500.7, 603.7a): it fires at that step of that turn only, never earlier
   * (triggers/delayed.ts#fires). Two extra turns added in one turn make "that turn" ambiguous: the later spell's turn comes first (CR 500.7), and this reading
   * stays with the first turn after this one.
   */
  /**
   * r4-fxz INTERFACE CHANGE (additive): `turn: 'later'` is a turn after the one the delayed trigger was created in, never that turn itself ("At the beginning of the end
   * step on your next turn, sacrifice that token.", with `whose: 'you'`: the end step of your next turn, even when it was created during your turn before its end step;
   * CR 603.7a, 513.1; triggers/delayed.ts#fires).
   * r5-fxb INTERFACE CHANGE (additive): `anyMain` = "at the beginning of your next main phase" (Mana Sculpt): the first main phase after the trigger was
   * created, precombat or postcombat (CR 505.1, 603.7a); `step` is then 'main1'. Capability `feature:delayed.step.anyMain` (triggers/forms.ts).
   */
  | { at: 'step'; step: TurnStep; whose?: PlayerPred; next?: boolean; turn?: 'next' | 'later'; anyMain?: true }
  | { at: 'endOfCombat' }
  /** "when ~ leaves the battlefield", "the next time ... this turn" */
  | { at: 'event'; event: EventPattern };

/** The definition of a token (CR 111.2-111.4) or a predefined token (CR 111.10). */
export interface TokenDef {
  /** CR 111.10: Treasure, Food, Clue, Blood, Map, Powerstone, Gold, Junk, Shard, Incubator ... (rules text comes from the CR). */
  predefined?: string;
  name?: string;
  colors?: Color[];
  supertypes?: string[];
  types?: string[];
  subtypes?: string[];
  power?: Quantity;
  toughness?: Quantity;
  /** Keyword shorthand ("with flying"). */
  keywords?: string[];
  /** Full nested abilities ("with 'When this creature dies, ...'"): 4% of cards. */
  abilities?: AbilityDef[];
}

// ---------------------------------------------------------------------------
// 5. Events and triggers (CR 603, 700.4)
// ---------------------------------------------------------------------------

export interface TriggerDef {
  /** Any of these events (disjunction): "whenever ~ enters or attacks". */
  on: EventPattern[];
  /** "one or more" triggers: once for the whole simultaneous batch (CR 603.2c). */
  batch?: boolean;
  /**
   * CLOUD std-misc INTERFACE CHANGE (additive): with `batch`, the players of the batch are counted together too: "Whenever one or more players discard one or more
   * cards" triggers once for the whole batch, however many players discarded in it (CR 603.2c), where "a player discards one or more cards" triggers once for each
   * of them (triggers/occurrences.ts#batchOccurrences). Only on a player action whose actor is any player. Capability `feature:trigger.batch.whole`.
   * Standard merge wave 3: also "whenever one or more of your opponents are attacked" (std-tmt, Party Dude; CR 603.2c, 506.2, 508.1b): the players attacked are
   * the "one or more", so a declaration that attacks several of them is ONE occurrence, never one for each player attacked as "whenever one or more creatures
   * attack an opponent" is (std-tla). It replaces the wave-3 tmt line's `together` on the attack pattern (one mechanism for both).
   */
  wholeBatch?: true;
  /**
   * FAST4 T27 INTERFACE CHANGE (additive): a condition that is part of the trigger EVENT ("whenever ~ attacks while you control a creature with power 4 or
   * greater", "whenever you cast a spell during an opponent's turn"). It is judged once, when the event happens (CR 603.1, 603.2), with the event in hand,
   * and never again: unlike an intervening "if" (`TriggeredAbilityDef.interveningIf`, CR 603.4) it is not checked as the ability resolves. Never `ask`.
   * Capability `feature:trigger.while` (triggers/collect.ts).
   */
  while?: Condition;
  /**
   * FAST4 T27 INTERFACE CHANGE (additive): "for the first time each turn": the ability triggers only on the first event of the turn that matches `on` (as
   * the ability sees it: "you" is its controller, "~" its source), counted over EVERY event of the turn, also those that happened before the source was on
   * the battlefield (the game history, CR 603.2, 603.2c); later occurrences, in the same simultaneous batch or after it, do not trigger it. "For the first
   * time during each of your turns" is this with `while` "it's your turn". Capability `feature:trigger.first` (triggers/collect.ts).
   */
  first?: 'turn';
}

/**
 * A pattern over the engine's semantic event stream. The same patterns serve triggers (CR 603.2),
 * replacement/prevention effects ("would", CR 614.1), delayed triggers, durations and history conditions.
 * Look-back (CR 603.10) is decided by code from the pattern, never stored per card. An unparsed trigger is never a pattern:
 * it makes the whole ability manual (ManualAbilityDef shape 'triggered', optionally with the understood effect).
 */
export type EventPattern =
  /** `cause: 'resolve'`: only the move a spell makes as it RESOLVES (CR 608.2n), not a counter or a fizzle (CR 701.6a, 608.2b): buyback (CR 702.27a). Capability `feature:replace.cause` in a replacement's `replaces`, `feature:ev.cause` (unregistered: the trigger matcher ignores it) elsewhere (m6 design D12). */
  /**
   * FAST5 T36 INTERFACE CHANGE (additive): `byOpponent` (with `cause: 'discard'`, a replacement's `replaces` only): the discard is the effect of a spell or ability a
   * player other than the discarding player controls ("If a spell or ability an opponent controls causes you to discard this card", CR 701.9a). A discard that is a
   * cost, the cleanup step's or the player's own effect never matches. Capability `feature:replace.byOpponent` (effects/replacements.ts#matchProposed).
   */
  /**
   * Standard round 3, r3-trig INTERFACE CHANGE (additive): `cause: 'craft'`, exiled as a material of a craft ability being activated ("When this creature is exiled
   * from the battlefield while you're activating a craft ability", CR 702.167a; rules/pay-parts.ts). The only cause the TRIGGER matcher compares (triggers/match.ts);
   * capability `feature:ev.cause.craft` (any other cause in a trigger stays `feature:ev.cause`, unregistered).
   */
  | { ev: 'zoneChange'; subject: ObjectFilter; from?: ZoneName | ZoneName[]; to?: ZoneName | ZoneName[]; cause?: 'resolve' | 'discard' /* M6-0: 'discard', madness (CR 702.35a) */ | 'craft'; byOpponent?: true }
  /** FAST1 T4 ADDITION (INTERFACE CHANGE): `nth` is "the Nth spell that player casts this turn" ("your second spell each turn"), counted like `draw.nth` (CR 601.2i). */
  /**
   * FAST5X E2 INTERFACE CHANGE (additive): `via`, the alternative cost the spell was cast for ("a spell was warped this turn" = cast for its warp cost, CR 702.185c,
   * 118.9): `CostsPaid.alternative` of the spell (a second cost of the same name, `warp:2`, counts). Capability `feature:ev.cast.via`.
   */
  /**
   * FAST5X E18 INTERFACE CHANGE (additive): `nthMatching`, with `nth` and `spell`: "the Nth <spell> that player casts this turn" counts only that player's spells
   * of this turn that match `spell` ("an opponent casts their first noncreature spell each turn", CR 601.2i), read from the game history (rules/history.ts).
   * Capability `feature:ev.cast.nthMatching`.
   */
  | { ev: 'cast'; player?: PlayerPred; spell?: ObjectFilter; from?: ZoneName; orCopy?: boolean; nth?: number; nthMatching?: true; via?: string; /** std-lci (CR 106.3): "using mana produced by ~": some of the mana spent to cast it came from the pattern's own object */ manaFromSelf?: true;
    /** Standard round 3, r3-trig INTERFACE CHANGE (additive), CR 700.2: "whenever you cast a modal spell": modes were chosen for the spell as it was cast (CR 601.2b). Capability `feature:ev.cast.modal`. */
    modal?: true;
    /**
     * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 601.2a: "cast a spell this turn from anywhere other than your hand" (Spider-Man 2099): the zone the spell was
     * cast from is not this one (the cast event's and the history entry's `from`; an entry without the fact never matches). Capability `feature:ev.cast.notFrom`.
     */
    notFrom?: 'hand';
    /**
     * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 601.2i: "other than your first spell that turn" (Geralf, the Fleshwright): the spell is at least the
     * `nthMin`th spell its caster cast this turn (the cast event's and the history entry's `nth`, FAST1 T4). Only 2 has a wording. Capability `feature:ev.cast.nthMin`.
     */
    nthMin?: number;
    /**
     * std-exile-play-1-1 INTERFACE CHANGE (additive), CR 108.3, 601.2a: "whenever a player casts a spell they don't own" (Gonti, Night Minister): the spell's owner is not
     * the player who cast it (triggers/match.ts, judged on the spell as it was cast). Capability `feature:ev.cast.notOwnedByCaster`.
     */
    notOwnedByCaster?: true }
  /**
   * FAST5X E20 INTERFACE CHANGE (additive): `ability`, the kind of ability activated: 'exhaust' ("whenever you activate an exhaust ability", CR 702.177a) or
   * 'loyalty' ("whenever you activate a loyalty ability", CR 606.3). Capability `feature:ev.activate.ability`.
   */
  /**
   * std-rx28 INTERFACE CHANGE (additive): `activated`, a filter on the activated ability itself as it is put on the stack ("whenever you activate an ability that targets
   * a creature or player", Ertha Jo, Frontier Mentor; CR 602.2, 115.9b), read through the event's `spell` role. Capability `feature:ev.activate.activated`.
   */
  | { ev: 'activate'; player?: PlayerPred; source?: ObjectFilter; manaAbility?: boolean; ability?: 'exhaust' | 'loyalty'; activated?: ObjectFilter; /** std-mana-1 INTERFACE CHANGE (additive), CR 106.12: with `manaAbility`, "taps <a permanent> for mana": the mana ability had {T} in its cost. Capability `feature:trigger.tappedForMana`. */ tapped?: true; /** std-mana-1 INTERFACE CHANGE (additive), CR 106.12: with `manaAbility`, "taps a land for {C}": the activation produced mana of that type. Capability `feature:trigger.tappedForMana`. */ produced?: ManaType }
  /**
   * M12-3 INTERFACE CHANGE (additive): `orPlaneswalker`, with a player `defender`: "attacks you or a planeswalker you control" (CR 506.3, 508.1b): the attack is
   * on that player or on a planeswalker that player controls (as the attack is declared). A battle is not one (its protector is the defending player, CR 508.5,
   * but no such card says "or a battle you protect"). Capability `feature:ev.attacks.orPlaneswalker` (triggers/match.ts, rules/history.ts).
   */
  /**
   * Standard round 3, r3-trig INTERFACE CHANGE (additive): `power`, the total power of all the creatures the player declared as attackers in that declaration
   * ("whenever you attack with creatures with total power 12 or greater", CR 508.1, 208.1), beside `count` (the number of them); read as the attackers are
   * declared (triggers/normalize.ts). Capability `feature:ev.attacks.power`.
   */
  | { ev: 'attacks'; attacker?: ObjectFilter; alone?: boolean; defender?: PlayerPred | 'planeswalker' | 'battle'; count?: NumberCmp; orPlaneswalker?: true; power?: NumberCmp }
  | { ev: 'blocks'; blocker?: ObjectFilter; attacker?: ObjectFilter }
  | { ev: 'becomesBlocked'; attacker?: ObjectFilter; by?: ObjectFilter }
  /**
   * std-rx35 INTERFACE CHANGE (additive): "Whenever ~ attacks and isn't blocked" (CR 509.1h, 509.3g, unverified): an attacking creature for which no blocker was
   * declared, once per declare blockers step, as the blockers of its defending player are declared (core/combat.ts `blockersDeclared.unblocked`). A creature put
   * onto the battlefield attacking after that is never one. Capability `ev:attacksUnblocked`.
   */
  /**
   * pc-combat-4 INTERFACE CHANGE (additive; CR 509.1h, 508.1b, 603.2c): `defender`, the unblocked creatures attack a PLAYER that matches ("one or more creatures an opponent controls attack you
   * and aren't blocked", Coveted Jewel): never a planeswalker or battle.
   */
  | { ev: 'attacksUnblocked'; attacker?: ObjectFilter; defender?: PlayerPred }
  /**
   * FAST5X E16 INTERFACE CHANGE (additive): `excess`, "is dealt excess damage" (CR 120.10): only damage dealt to a permanent part of which was excess damage
   * (`damageDealt.excess` > 0: beyond lethal damage, loyalty or defense, rules/damage.ts). Capability `feature:ev.damage.excess` (triggers/match.ts).
   * std-rx28 INTERFACE CHANGE (additive): `amountIsToughness`, "deals noncombat damage to a creature equal to that creature's toughness" (Taii Wakeen, Perfect Shot;
   * CR 120.1, 208.1): only damage dealt to a creature whose amount equals that creature's toughness as the damage is dealt (as it last existed if it has left).
   * Capability `feature:ev.damage.amountIsToughness` (triggers/match.ts).
   * std-rx28 INTERFACE CHANGE (additive): `toSourceTarget`, "an instant or sorcery spell you control that targets only a single creature deals damage to that
   * creature" (Imodane, the Pyrohammer; CR 115.9b, 120.1): only damage dealt to an object that the source (a spell or ability on the stack) targets. Capability
   * `feature:ev.damage.toSourceTarget` (triggers/match.ts).
   */
  | { ev: 'damage'; source?: ObjectFilter; recipient?: { object?: ObjectFilter; player?: PlayerPred }; combat?: boolean; amount?: NumberCmp; excess?: true; amountIsToughness?: true; toSourceTarget?: true }
  /**
   * FAST5X E17 INTERFACE CHANGE (additive): `nth`, of a main phase, "your second main phase": the main phase that is the Nth main phase of its turn (CR
   * 505.1b counts the main phases that have occurred in the turn; an additional main phase is a postcombat main phase but not the second one, CR 505.1a).
   * Capability `feature:ev.step.nth`.
   */
  | { ev: 'step'; step: TurnStep; whose?: PlayerPred; nth?: number }
  | { ev: 'life'; change: 'gain' | 'loss'; player?: PlayerPred; amount?: NumberCmp }
  /**
   * r5-repl INTERFACE CHANGE (additive): `exceptFirstInDrawStep`, "If you would draw a card except the first one you draw in each of your draw steps" (CR 504.1,
   * 614.1a): not the first card the player draws in their own draw step. Compared by the replacement matcher only (effects/replacements.ts#matchProposed,
   * `feature:replace.draw.exceptFirstInDrawStep`). edh-players-1 (additive): also a trigger pattern, "Whenever an opponent draws a card except the first one they
   * draw in each of their draw steps" (Orcish Bowmasters), judged on the draw event (triggers/normalize.ts says whether it was that first card, match.ts reads it).
   * Capability `feature:ev.draw.exceptFirstInDrawStep`.
   */
  | { ev: 'draw'; player?: PlayerPred; nth?: number; exceptFirstInDrawStep?: true }
  /**
   * M6-0 widened `what` (m6 design 2.1): 'turnedFaceDown' (CR 708.2b), 'converted' (CR 701.28), 'flipped' (CR 710), 'mutated' (CR 702.140d), 'melded'
   * (CR 701.42), 'solved' (CR 719.3b), 'prepared' (CR 722.3a), 'classLevel' (CR 716.2a: "When this Class becomes level N", with `level`).
   */
  | { ev: 'becomes'; what: BecomesWhat; object: ObjectFilter; by?: ObjectFilter; level?: number; door?: 'this'; player?: PlayerPred;
    /** Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 502.3: with `untapped` only, untapped by the untap step's turn-based action ("you untap one or more permanents during your untap step"). Capability `feature:ev.becomes.untapStep`. */
    untapStep?: true } // door: FAST5X E8 (CR 709.5h, 709.5j); player: cloud std-dsk INTERFACE CHANGE (additive), "whenever you turn a permanent face up" (CR 702.37e, 708.2): the player who turned it face up, `turnedFaceUp` only (feature:ev.becomes.turnedFaceUp.player); Standard round 4, r4-trig INTERFACE CHANGE (additive): with `targeted`, the PLAYER who becomes the target ("whenever a player or permanent becomes the target of an ability you control", CR 115.1, 603.2; `object` is then `{}` and unread; feature:ev.becomes.targeted.player)
  /** M6-0 `byEffect` (CR 614.16): "if an EFFECT would put counters": matches only proposals whose cause is 'effect' or 'replacement' (effects/api.ts). */
  /**
   * FAST5X E21 INTERFACE CHANGE (additive): `by`, the player who puts the counters ("whenever YOU put one or more +1/+1 counters on a creature you control"):
   * the controller of the spell or ability whose instruction puts them, the player paying a cost, or the controller of a permanent entering with them (CR 122.6,
   * 122.6a); capability `feature:ev.counters.by`. `atLeast` with a number: the event makes the number of counters of the kind reach it ("the fourth plan counter").
   */
  | { ev: 'counters'; change: 'put' | 'removed'; kind?: CounterKind; on: ObjectFilter | { player: PlayerPred }; atLeast?: Quantity; byEffect?: true; by?: PlayerPred }
  | { ev: 'action'; verb: KeywordActionName | 'sacrifice' | 'discard' | 'cycle' | 'scry' | 'surveil' | 'search' | 'shuffle' | 'mill' | 'draw' /* Cloud r4-repl: a replacement's "would draw one or more cards" only (effects/proposal-kinds/draw-many.ts) */ | 'create' | 'playLand' | 'regenerate' | 'exile' | 'destroy' | 'tap' | 'untap' | 'counter' | 'attach' | 'transform' | 'reveal' | 'completeDungeon' /* MX4: "whenever you complete a dungeon", CR 309.7 */
    | 'commitCrime' | 'expend' /* FAST5X E20: "whenever you commit a crime" (CR 700.13), "whenever you expend N" (CR 700.14, with `n`) */
    | 'votesFinished' /* M12F: "whenever players finish voting" (CR 701.38a), the `votesFinished` GameEvent; no actor and no object */
    | 'exploit' /* std-rx17: "<object> exploits a creature" (CR 702.110b); `object` is the exploiting creature */
    | 'payLife' /* std-library-4: a replacement's "if you would pay life" only (effects/proposal-kinds/pay-life.ts, CR 119.4, 614.1a) */
    | 'firebend' /* std-mana-12: "whenever you firebend", a firebending ability of yours resolved (CR 702.189; op reportAction) */
    | 'faceDilemma' /* trek-2: "whenever you face a dilemma", the player chose one or more modes for a spell or ability (CR 700.2, 601.2b, 602.2b, 603.3c; actions/announce.ts#chooseModes) */; actor?: PlayerPred; object?: ObjectFilter;
    /**
     * std-rx17 INTERFACE CHANGE (additive): with the verb `exploit`, the creature sacrificed ("exploits a nontoken creature", CR 702.110b), judged as it last
     * existed on the battlefield (the event's `object` role). Capability `feature:ev.action.exploit`; on any other verb the matcher has nothing to read.
     */
    exploited?: ObjectFilter;
    /** FAST5X E20 INTERFACE CHANGE (additive): the N of "expend N" (CR 700.14): only with the verb `expend`, which needs it. */
    n?: number;
    /**
     * Cloud std-spm INTERFACE CHANGE (additive): with the verb `playLand`, the zone the land was played from ("whenever you play a land from exile", CR 305.1;
     * the `landPlayed` event's `from`). Capability `feature:ev.action.playLand.from`; on any other verb the matcher has nothing to read (never registered).
     */
    from?: ZoneName;
    /**
     * Standard round 4, r4-trig INTERFACE CHANGE (additive): with the verb `playLand`, "whenever you play a land from anywhere other than your hand" (Shadow of the
     * Goblin; CR 305.1, 305.2): the land was played from a zone other than this one (the `landPlayed` event's `from`). Capability `feature:ev.action.playLand.notFrom`;
     * on any other verb never registered (fail closed).
     */
    notFrom?: 'hand';
    /**
     * Standard round 4, r4-trig INTERFACE CHANGE (additive): with the verb `search`, "whenever an opponent searches their library" (Wan Shi Tong, Librarian; CR 701.23a):
     * the zone searched was the actor's own library (the `actionPerformed` event's `zone` and `owner`). Capability `feature:ev.action.search.ownLibrary`; on any
     * other verb never registered (fail closed).
     */
    searched?: 'ownLibrary';
    /**
     * std-lci INTERFACE CHANGE (additive): only with the verb `explore`, "explores a land card" / "explores a nonland card" (CR 701.44a: the card the explore
     * revealed was a land card, or a nonland card; with no card revealed, neither). Capability `feature:ev.action.explore.revealed`.
     */
    revealed?: 'land' | 'nonland';
    /**
     * p2-player-rules-3 INTERFACE CHANGE (additive): with the verb `clash`, whether the actor won the clash ("whenever you clash and win", "whenever you win a clash",
     * CR 701.30c; the event is emitted as the clash ends, effects/handlers/cards-library.ts#clashHandler). Capability `feature:ev.action.clash.won`.
     */
    won?: boolean }
  | { ev: 'createToken'; player?: PlayerPred; token?: ObjectFilter; byEffect?: true /* M6-0, CR 614.16 */ }
  | { ev: 'dieRoll'; player?: PlayerPred; result?: NumberCmp }
  /**
   * Cloud r3-mech INTERFACE CHANGE (additive), CR 705.2: "whenever you win a coin flip" (`won: true`), "whenever you lose a coin flip" (`won: false`): a flip a player
   * called (the effect cares who wins), from core/dice.ts#flipCoin's `coinFlipped` event. Without `won`, any called flip.
   */
  | { ev: 'coinFlip'; player?: PlayerPred; won?: boolean }
  | { ev: 'state'; cond: Condition }
  | { ev: 'beginTurn'; whose?: PlayerPred; extra?: boolean }
  | { ev: 'resolves'; what: ObjectFilter }
  /** M6-0, CR 614.10: "skip your next combat phase" (replacement patterns only: no GameEvent is a phase beginning, so `phase` is NOT_EMITTED for triggers). */
  | { ev: 'phase'; phase: TurnPhase; whose?: PlayerPred }
  /** M6-0, CR 731.1, 702.145: "whenever day becomes night" / "as it becomes night". */
  | { ev: 'dayNight'; to?: 'day' | 'night' }
  /**
   * M12-3 INTERFACE CHANGE (additive), CR 603.9: "whenever a player loses the game", "whenever an opponent loses the game", "whenever another player loses the
   * game": a player loses or leaves the game, whatever the reason (a concession too, CR 104.3a), "unless that player leaves the game as the result of a draw"
   * (CR 104.4a: then the game is over). Normalized from `playerLost` (triggers/normalize.ts). Capability `ev:loseGame` (triggers/match.ts).
   */
  | { ev: 'loseGame'; player?: PlayerPred }
  /**
   * Standard round 3, r3-trig INTERFACE CHANGE (additive), CR 108.4, 613.1b: "whenever an opponent gains control of a permanent from you": the control of a
   * permanent `object` passed from the player `from` to the player `to` (the engine's `controlChanged` event, triggers/normalize.ts; roles: the permanent as
   * `subject`, the player who gained control as `player`). Capability `ev:controlChange` (triggers/match.ts).
   */
  | { ev: 'controlChange'; object?: ObjectFilter; from?: PlayerPred; to?: PlayerPred }
  /**
   * std-copy-6 INTERFACE CHANGE (additive), CR 603.2, 603.3b: "a triggered ability of <object> triggers" (Firebender Ascension): a triggered ability of an object
   * `of` matches triggered (once per time it triggered; triggers/collect.ts#metaEvents makes the event from the triggers a batch caused). `causedBy: 'attacking'`:
   * only when that object attacking caused it ("a creature you control attacking causes a triggered ability of that creature to trigger": one of the events that
   * triggered it is an `attacks` event of that object, CR 508.1m). Roles: the object as `subject`, the triggered ability as `spell` (an ability on the stack once it
   * is put there, CR 603.3; effects/refs.ts finds it). Capability `ev:abilityTriggered`. A trigger of this kind does not itself make such an event (one level).
   */
  | { ev: 'abilityTriggered'; of?: ObjectFilter; causedBy?: 'attacking' };

/** The phases of a turn (CR 500.1), as `phase` patterns and proposals name them. */
export type TurnPhase = 'beginning' | 'precombatMain' | 'combat' | 'postcombatMain' | 'ending';

/** What an object `becomes` (CR 603.2, 700.4). The members after 'crewed' are M6-0's (m6 design 2.1). */
export type BecomesWhat =
  | 'tapped' | 'untapped' | 'targeted' | 'attached' | 'unattached' | 'transformed' | 'turnedFaceUp' | 'monstrous' | 'renowned' | 'saddled' | 'crewed'
  | 'turnedFaceDown' | 'converted' | 'flipped' | 'mutated' | 'melded' | 'solved' | 'prepared' | 'classLevel'
  | 'plotted' /* FAST5X E6 INTERFACE CHANGE (additive): "When this card becomes plotted" (CR 702.170a), core/special/plot.ts */
  /**
   * FAST5X E8 INTERFACE CHANGE (additive), CR 709.5h-i: "you unlock" a door of the Room (`door: 'this'`: the half the ability is printed on, "When you unlock
   * this door") and "you fully unlock" a Room. The player who unlocked it is the pattern's controller ("you"), entering unlocked included (CR 709.5d, 709.5h).
   */
  | 'unlocked' | 'fullyUnlocked'
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 702.122b, 702.171c: "Whenever ~ crews a Vehicle" / "saddles a Mount": the permanent
   * (`object`, the Vehicle or Mount) had the cost of its crew / saddle ability paid by tapping the creature `by` (one event per creature tapped, as the cost is
   * paid: not "becomes crewed", which is the ability resolving). Only with `by`. Capability `feature:ev.becomes.crewCostPaid` (triggers/match.ts).
   */
  | 'crewCostPaid' | 'saddleCostPaid'
  /**
   * std-rq INTERFACE CHANGE (additive), CR 702.194a: "Whenever ~ becomes tapped to pay a teamwork cost": the creature `by` was tapped to pay the teamwork cost of a
   * spell (`object`, the spell) as it was cast. Only with `by`. Capability `feature:ev.becomes.teamworkCostPaid` (triggers/match.ts).
   */
  | 'teamworkCostPaid';

// ---------------------------------------------------------------------------
// 6. Static effects: continuous, cost, restriction, replacement, permission, rule-modifying (CR 604, 611-616, 117.7, 601.2f)
// ---------------------------------------------------------------------------

/** What an object's static ability or a resolved effect does. Evaluated continuously (static) or created once (`effect` step). */
export type StaticEffect =
  | ContinuousEffectDef
  | CostModDef
  | RestrictionDef
  | ReplacementDef
  | PermissionDef
  | RuleModDef
  | TriggerModDef
  | AdditionalCostDef
  | AlternativeCostDef
  | CastWithDef
  | PregameDef
  | DeckConstructionDef;

/** Continuous effects in layers (CR 613). Affected sets are re-evaluated for statics (CR 611.3a), locked in for resolved effects (CR 611.2c). */
export interface ContinuousEffectDef {
  s: 'continuous';
  affects: ObjRef | PlayerRef;
  mods: Modification[];
  /** Characteristic-defining ability (CR 604.3): applies in every zone, first within its layer (CR 613.3). */
  cda?: boolean;
}

export type Modification =
  /** Layer 1a: copy effects (CR 707, 613.2a). `except`: the copy exceptions (CR 707.9; widened by M6-0); the snapshot lives in the effect record. M6. */
  /**
   * FAST5 T64 INTERFACE CHANGE (additive): `choose`, the controller of the effect picks ONE of the objects `copyOf` stands for that match this filter
   * ("you may have ~ become a copy of a creature card exiled with it", CR 607.2a, 608.2d): the choice is made as the effect begins (effects/copy.ts), not a
   * target. With none of them matching, nothing becomes a copy. Capability `feature:copy.choose`.
   */
  | { layer: '1a'; copyOf: ObjRef; except?: CopyExcept[]; choose?: ObjectFilter }
  | { layer: '1b'; faceDown: true; profile?: FaceDownProfile } // CR 708.2. M6 (`profile` M6-0; absent = 'plain').
  | { layer: 2; controller: PlayerRef }
  /**
   * CR 612. M6. M6-8 INTERFACE CHANGE (additive, widened union): `from` and `to` may name a choice made as the effect's spell or ability resolved ("one color word
   * with another", CR 608.2d); a resolved effect stores the chosen words themselves (effects/handlers/lasting-fix.ts#fixChosen). A color word is a color letter
   * or the word ("R", "red"); a land or creature type is the subtype as the type line prints it ("Swamp", "Goblin"). Applied by statics/text-change.ts.
   */
  | { layer: 3; changeWord: { from: string | ChosenWord; to: string | ChosenWord; kind: 'color' | 'landType' | 'creatureType' } }
  /**
   * FAST5 T69 INTERFACE CHANGE (additive, `named`): "is a green and white Citizen creature ... named Legitimate Businessperson", "becomes a legendary creature
   * named Mileva, the Stalwart": the object's name becomes exactly this one (CR 201.2; it loses its other names), applied with the type changes (statics/mods.ts#layer4).
   */
  | { layer: 4; types?: TypeChange; subtypes?: TypeChange; supertypes?: TypeChange; named?: string }
  | { layer: 5; colors: { set?: Color[]; add?: Color[]; remove?: Color[]; chosen?: LinkId } }
  /**
   * r5-static INTERFACE CHANGE (additive), CR 613.1f, 113.? (unverified): `addActivatedOf`, "~ has all activated abilities of <objects>": the object gains every
   * activated ability (mana and loyalty abilities too, and those a keyword generates) that the objects `addActivatedOf` names have when this effect is applied
   * in layer 6, as granted abilities (statics/mods.ts). "This" in a gained ability is the object that has it. Capability `feature:layer6.addActivatedOf`.
   * std-cardcopy-9 INTERFACE CHANGE (additive): `alsoTriggered`, with `addActivatedOf`: the triggered abilities of those objects too ("Koh has all activated and
   * triggered abilities of the last chosen card", CR 613.1f); a keyword's generated triggered abilities included, the keyword itself not. Capability
   * `feature:layer6.addActivatedOf.triggered`.
   * std-craft-2 INTERFACE CHANGE (additive), CR 602.5b, 613.1f: `activatedOfLimit`, "You may activate each of those abilities only once each turn." (Locus of
   * Enlightenment): each ability `addActivatedOf` grants is restricted to `max` activations each turn, on top of its own restrictions (an ability already limited
   * per turn keeps the smaller limit; one limited per game or per combat keeps its own, which is as strict). Capability `feature:layer6.addActivatedOf.limit`.
   */
  /*
   * std-cardcopy-2 INTERFACE CHANGE (additive), CR 611.2a, 613.1f, 113.? (unverified): `otherAbilitiesOfCard`, "It gains this card's other abilities." (Symbiote
   * Spider-Man): `add` holds copies of every other ability of the face whose ability resolves, written there by the parser (parser/parse.ts#fillOtherAbilities); the
   * flag only says how the grant is worded. "This" in a gained ability is the object that has it.
   */
  | { layer: 6; add?: AbilityDef[]; removeAll?: boolean; remove?: string[]; cantHave?: string[]; addActivatedOf?: ObjRef; otherAbilitiesOfCard?: true; activatedOfLimit?: { per: 'turn'; max: number }; alsoTriggered?: true }
  | { layer: '7a'; power?: Quantity; toughness?: Quantity }
  | { layer: '7b'; power?: Quantity; toughness?: Quantity }
  | { layer: '7c'; power?: Quantity; toughness?: Quantity }
  | { layer: '7d'; switchPT: true };

export type Layer = Modification['layer'];

/** M6-0, CR 708.2a / 701.40a / 702.37a: a 2/2 with no name, text, subtypes or mana cost; 'ward2' adds ward {2} (CR 702.168a, 701.58a). */
export type FaceDownProfile = 'plain' | 'ward2';

/** M6-0: the exceptions a copy effect's card data may state (CR 707.9). Only `Modification` and `retain` are copiable values (CR 707.9a-c). */
export type CopyExcept =
  /** CR 707.9a-b: "except it's an artifact", "except it's 7/7", "except it has [ability]", "except it isn't legendary". */
  | Modification
  /** CR 707.9c: "except it doesn't copy that creature's color": the copy keeps its own values, materialized when the effect begins (m6 design 3.3). */
  | { retain: ('name' | 'manaCost' | 'colors' | 'types' | 'subtypes' | 'supertypes' | 'power' | 'toughness')[] }
  /** CR 707.9f: "if it's a creature, ...": judged on the result of the copy without this exception (m6 design 3.3); stored only if it applies. */
  | { if: ObjectFilter; then: CopyExcept[] }
  /**
   * MX2 ADDITION (CR 707.9a): "except it has this ability": the copy gains the very ability whose resolution creates the copy effect (Unstable Shapeshifter,
   * Cryptoplasm, Vesuvan Doppelganger's granted trigger). A resolved effect stores it as `{layer: 6, add: [that ability]}` as it begins
   * (effects/handlers/lasting.ts); anywhere else it is not automated (`feature:copy.thisAbility.other`, never registered).
   */
  | { thisAbility: true };

export interface TypeChange {
  /** "in addition to its other types". */
  add?: string[];
  /** "becomes a Mountain" (replaces the subtypes of that class; CR 305.7). */
  set?: string[];
  remove?: string[];
  /** All creature types (changeling, CR 702.73). */
  all?: boolean;
  /**
   * FAST5 T41 INTERFACE CHANGE (additive, subtypes only): "loses all creature types" (CR 205.3m, 613.1d): every subtype of that class the object has when the
   * effect applies is removed, whatever it is (statics/mods.ts#layer4). A creature type another effect adds later in the layer (a later timestamp) stays.
   */
  removeAll?: 'creature' | 'land'; // std-mana-1 (additive): 'land', "loses all land types" (CR 205.3i, 305.7; statics/mods.ts#layer4)
  /** The type chosen by a linked ability (CR 607.2d). */
  chosen?: LinkId;
  /**
   * FAST3 T13 INTERFACE CHANGE (additive): the `chosen` values replace the old ones of their class, as `set` does ("becomes the creature type of your choice",
   * CR 205.1a-b), instead of joining them. Nothing chosen changes nothing. A resolved effect stores the values themselves (effects/handlers/lasting-fix.ts).
   */
  chosenSets?: boolean;
}

/** "Spells you cast cost {1} less", "This spell costs {1} more for each target beyond the first" (CR 601.2f, 118.7-118.8). */
export interface CostModDef {
  s: 'costMod';
  /** What it applies to. `self` = the spell/ability this static ability is on (functions on the stack, CR 604.5). `caster` is REQUIRED. */
  applies: {
    self?: boolean;
    spells?: ObjectFilter;
    /**
     * FAST5 T60 INTERFACE CHANGE (additive): `keyword`, the wrapper keyword of the activated abilities it modifies ("Exhaust abilities of other permanents you
     * control cost {2} less to activate", CR 702.177a; `ActivatedAbilityDef.keyword`), with `kind: 'activated'`. Capability `feature:costMod.abilities.keyword`
     * (actions/activate.ts#costChangeOf applies it, statics/costmods.ts#abilityCostModsFor finds it); the other forms keep `feature:costMod.abilities`, which nothing registers.
     */
    abilities?: { source?: ObjectFilter; kind?: 'activated' | 'loyalty' | 'mana'; keyword?: string };
    /**
     * std-rh INTERFACE CHANGE (additive), CR 116.2m, 709.5e, 118.7: `unlock`, the unlock costs of the doors of Room permanents ('Unlock costs you pay cost {1} less', Inquisitive Glimmer):
     * the mana cost a player pays to unlock a door, a special action (core/rooms.ts#listed reads it through effects/handlers/rooms.ts, statics/costmods.ts#unlockCostMods).
     * `caster` is the player who unlocks. Capability `feature:costMod.unlock`.
     */
    unlock?: true;
    /**
     * std-rx26 INTERFACE CHANGE (additive): the plot special action ("Plotting cards from your hand costs {2} less", CR 702.170a, 116.2k, 601.2f; unverified
     * cites): the cost a player pays to plot a card from their hand; with neither `self`, `spells` nor `abilities`. Read by core/special/plot.ts
     * (statics/costmods.ts#plotCostModsFor); capability `feature:costMod.plot`.
     */
    plot?: true;
    caster: PlayerPred;
    /**
     * std-rx27 INTERFACE CHANGE (additive), CR 602.2b, 601.2f, 118.9: "you may pay {0} rather than pay the equip cost of the first equip ability you activate each
     * turn" (Kili the Resourceful): with `abilities.keyword`, the change applies to an ability with that keyword only when the caster has activated no ability with
     * it this turn (counted in `GameState.turnActivations` under `kw:<player>:<keyword>`, actions/activate.ts), and only to an ability whose cost is mana alone
     * (any other cost part: the option is not taken, as a player may decline it). Capability `feature:costMod.abilities.firstEachTurn`.
     */
    firstEachTurn?: true;
  };
  /**
   * FAST4 T21 INTERFACE CHANGE (additive): `times` is how many times `mana` is added or removed (default once; `increase` and `reduce` only): "costs {2}{R}
   * more to cast for each target beyond the first" is `mana` {2}{R} `times` max(0, targets - 1) (CR 601.2f, 118.7); "costs {3} less to cast if it targets a
   * tapped creature" is `mana` {3} `times` min(1, its targets that are tapped creatures). statics/costmods.ts#modifyMana evaluates it as it does `generic`.
   */
  change: {
    kind: 'increase' | 'reduce' | 'set'; mana?: ManaCost; generic?: Quantity; times?: Quantity;
    /**
     * Round 3 r3-cost INTERFACE CHANGE (additive): `one`, "This effect can't reduce the mana in that cost to less than one mana" (Training Grounds, Agatha
     * of the Vile Cauldron; CR 601.2f, 118.7): a `reduce` of a generic amount that leaves at least one mana (of any type) in a cost that had some; a cost
     * with no mana ({T}) stays as it is. statics/costmods.ts#modifyMana applies such reductions before the others (the order that never costs the player
     * more, CR 601.2f). Capability `feature:costMod.floor.one`. `zero` (or absent) is the general rule (never below {0}).
     */
    floor?: 'zero' | 'one';
    /**
     * r5-cost INTERFACE CHANGE (additive): `life`, with `kind: 'increase'`, "Spells your opponents cast that target this creature cost an additional 3 life to cast"
     * (Terror of the Peaks; CR 601.2f, 118.2, 119.4): the total cost includes paying that much life, once for each such modifier. actions/cast.ts#modifiedPlan adds
     * it to the plan's other parts; a player who can't pay it can't cast the spell (CR 119.4, 601.2h). Capability `feature:costMod.life`.
     */
    life?: number;
  };
}

/** "Can't"/"must"/"only" effects (CR 614.17, 508.1d). They constrain actions; they are not replacement effects. */
export interface RestrictionDef {
  s: 'restrict';
  subject: Ref; // p2-attack-block-1: `Ref` (ObjRef | PlayerRef), so a target of either kind is the subject (model/lint-nodes.ts, CR 115.1)
  mode: 'cant' | 'mustIfAble' | 'onlyIf';
  action: RuleAction;
  /** The object the action concerns ("can't be blocked by creatures with power 2 or less", "can't cast spells with mana value 3 or less"). */
  other?: ObjectFilter;
  /**
   * M6-12 INTERFACE CHANGE (additive): the PLAYER an `attack` requirement names ("attacks that opponent this turn if able", encore CR 702.141a, 508.1d):
   * obeyed only by attacking that player (a planeswalker or battle does not obey it). Capability `feature:require.player.attack`; a resolved effect stores the
   * player itself (`{ref:'fixed'}`), the only form statics/requirements.ts reads.
   */
  otherPlayer?: PlayerRef;
  /** Limit rather than ban ("can't cast more than one spell each turn"). */
  max?: number;
  /**
   * FAST5 T57 INTERFACE CHANGE (additive): a minimum, for a `cant` `beBlocked` restriction with no `other`: "~ can't be blocked except by three or more
   * creatures" (CR 509.1b; menace, CR 702.111b, is the same with two). Judged on the whole set of blockers of the attacker (statics/hooks.ts#blockSetValid),
   * never on one blocker alone. Capability `feature:restrict.min.beBlocked`.
   */
  min?: number;
  /**
   * FAST4 T33 INTERFACE CHANGE (additive): an `activate` restriction that does not apply to mana abilities ("its activated abilities can't be activated unless
   * they're mana abilities", CR 602.5, 605.1a); statics/hooks.ts#canActivate tells it the kind of the ability. Capability `feature:restrict.exceptMana.<action>`
   * (registered for `activate` only).
   */
  exceptMana?: boolean;
  /**
   * FAST5 T37 INTERFACE CHANGE (additive): "~ can't attack alone" / "~ can't block alone" (CR 506.5, 508.1c, 509.1b): a `cant` restriction of `attack` or `block`
   * that forbids not the creature but the whole declaration in which it is the only attacker (blocker). It never forbids the creature by itself
   * (statics/hooks.ts#verdict); the declaration is judged by statics/hooks.ts#cantActAlone (core/combat.ts). Capability `feature:restrict.alone.<action>`.
   */
  alone?: boolean;
  /**
   * Cloud C3 (batch 3) INTERFACE CHANGE (additive): a static goad. "Enchanted creature is goaded", "equipped creature gets +2/+0 and is goaded" (CR 701.15a-c,
   * 303.4, 301.5): the subject is goaded by the controller of the effect ("you": the source's controller for a static ability, CR 109.5) for as long as the
   * effect applies (CR 604.1, 611.3a), so it ends as the Aura or Equipment leaves or is attached to another object. Only with `mode: 'mustIfAble'` and
   * `action: 'attack'`, no `other`, `otherPlayer`, `max`, `min`, `alone`. It is not one requirement but the designation: statics/requirements.ts#goadHits makes
   * the two requirements of each goader (stored by the goad action and static ones together, one pair per player, CR 701.15b-d), and the `goaded` filter
   * sees it (statics/rule-sources.ts#staticGoaders). Capability `feature:require.goad`.
   */
  goad?: true;
  /**
   * std-control-1 INTERFACE CHANGE (additive): of an `activate` restriction, only the activated abilities with this wrapper keyword ("power-up abilities can't
   * be activated", CR 602.5, 702.193a; `ActivatedAbilityDef.keyword`); statics/hooks.ts#canActivate tells it the ability's keyword, and an ability of unknown
   * keyword is restricted (fail closed). Capability `feature:restrict.abilityKeyword.activate`.
   */
  abilityKeyword?: string;
  /**
   * p2-graveyard-2 INTERFACE CHANGE (additive): of a `castFromZone` restriction, the zones it names ("Players can't cast spells from graveyards or libraries",
   * Grafdigger's Cage; "... from graveyards or exile", Soulless Jailer; CR 601.3, 101.2): a spell cast from one of them is restricted (statics/hooks.ts#canCast
   * tells the zone the card is cast from); absent, the graveyard only. Capability `feature:restrict.fromZones.castFromZone`.
   */
  fromZones?: ZoneName[];
  when?: Condition;
}

export type RuleAction =
  | 'attack' | 'block' | 'beBlocked' | 'beBlockedBy' | 'attackPlayer'
  | 'cast' | 'activate' | 'playLand' | 'draw' | 'gainLife' | 'loseLife' | 'lose' | 'win'
  | 'untap' | 'untapDuringUntapStep' | 'tap' | 'beTapped' | 'transform' | 'search' | 'sacrifice' | 'discard'
  | 'beTargeted' | 'beCountered' | 'beDestroyed' | 'beRegenerated' | 'beSacrificed' | 'beExiled' | 'beAttached' | 'beEnchanted' | 'beEquipped'
  | 'dealDamage' | 'receiveDamage' | 'preventDamage' | 'enter' | 'leave' | 'gainAbility' | 'haveCountersPut' | 'payLife' | 'castFromZone' | 'spendMana'
  /** FAST5X E25 INTERFACE CHANGE (additive): "can't be turned face up" (CR 708.7, 101.2): the special action and every effect that turns a permanent face up. */
  | 'beTurnedFaceUp'
  /** std-mkm INTERFACE CHANGE (additive): "can't become suspected" (CR 701.60a, 101.2): every effect that would suspect the permanent (effects/handlers/levels.ts). */
  | 'beSuspected'
  /**
   * r5-repl INTERFACE CHANGE (additive): "Combat damage can't be prevented." (CR 615.12, 510.2): asked like `preventDamage` (the recipient as the subject, the
   * source as `other`), but only of combat damage (effects/propose.ts#unpreventableIfRuled).
   */
  | 'preventCombatDamage'
  /**
   * trek-1 INTERFACE CHANGE (additive): "can't be beamed up" (Marooned; Star Trek, CR 702 beam me up, rule number unverified; CR 101.2, 614.17b): the permanent can't
   * be returned to its owner's hand to pay a beam me up cost (`CostPart` returnToHand `beamUp`, rules/cant.ts#costUseDenial). Nothing else beams a permanent up.
   * Listed here, not last, so that other rounds appending to the union do not touch the same line.
   */
  | 'beBeamedUp'
  /**
   * std-copy-1 INTERFACE CHANGE (additive): "This spell can't be copied." (CR 707.10, 101.2): a static ability of a spell (zone `stack`, subject `self`); the copy op
   * puts no copy of the spell onto the stack (effects/handlers/tokens-copy.ts#copySpells asks statics/hooks.ts#ruleDenial).
   */
  | 'beCopied'
  /**
   * trek-4 INTERFACE CHANGE (additive): "Permanents can't phase in." (CR 702.26c, 502.1, 101.2; cites unverified): a phased-out permanent the restriction's
   * subject includes stays phased out when it would phase in (its controller's untap step, rules/phasing.ts#phaseInForUntapStep, the only phase-in the engine
   * performs). The subject is matched against the permanent as it would be phased in (statics/hooks.ts#phaseInDenied): a phased-out permanent is otherwise
   * treated as though it doesn't exist (CR 702.26b), but this rule names phasing in itself.
   */
  | 'phaseIn';

/** Replacement (CR 614), prevention (CR 615) and redirection (CR 614.9) effects. Event ordering: CR 616. Executed by the proposal pipeline (M6; design 8.5). */
export interface ReplacementDef {
  s: 'replace';
  /** The event that "would" happen. */
  replaces: EventPattern;
  body: ReplacementBody;
  condition?: Condition;
  /** "You may ..." (the affected object's controller or player chooses when applying, CR 616.1). */
  optional?: boolean;
  /** Self-replacement (CR 614.15): applied first (CR 616.1a). */
  selfReplacement?: boolean;
  /** Shield bookkeeping for resolved effects: "the next time", "prevent the next N damage" (CR 615.7-615.8). Static ones have none. */
  shield?: { uses: number | 'all'; amount?: Quantity };
}

export type ReplacementBody =
  /** Do these steps instead; the original event does not happen (CR 614.6). `event` roles stay readable. */
  | { b: 'instead'; do: EffectStep[] }
  /**
   * Merge wave 8 INTERFACE CHANGE (additive; audit D4, docs/audits/2026-10-18-STD.md): "instead [do these steps], then [the replaced event]" ("If a creature you
   * control would connive, instead you draw a card, then that creature connives", Leader, Super-Genius; CR 614.1a, 614.6): the event is replaced by a modified
   * event, the steps and then the same event with all its parameters (its object, its amount N, its cause). The steps run in the replacement's context (as those
   * of `instead`); then the event goes on through the pipeline unchanged, as the modified event this effect has already applied to (CR 614.5), so the other
   * applicable effects may still apply to it (CR 616.1: two Leaders draw twice, then the creature connives N). Capability `body:insteadThen`.
   */
  | {
    b: 'insteadThen'; do: EffectStep[];
    /**
     * p2-replace-events-1 INTERFACE CHANGE (additive): `if` and `otherwise`, "If this land would enter, sacrifice a Swamp instead. If you do, put this land onto the
     * battlefield. If you don't, put it into its owner's graveyard." (Lake of the Dead, Mox Diamond; CR 614.1a, 614.6, 305.1): after the steps, the same event goes on
     * unchanged only when `if` holds (read in the replacement's context, so `{cond:'did', step}` reads a step of `do`); when it does not, the same event goes to
     * `otherwise` instead (a zone change only, as a `modify` destination: its cause is kept, so a land played this way is still the land played this turn). Capability
     * `body:insteadThen.if`.
     */
    if?: Condition; otherwise?: Destination;
  }
  /**
   * Modify the event's parameters: amount, count, destination, entering status.
   * M6-12 INTERFACE CHANGE (additive): `then` (with a destination only), what happens immediately after the modified zone change was carried out, in the
   * replacement's context, with the object the event moved bound as `then.as` and the step result `then.as` performed: the triggered ability that triggers
   * "when this card is exiled this way" (madness, CR 702.35a: `then.do` is a `reflexive` step, CR 603.12 style, which goes on the stack the next time a
   * player would receive priority). Nothing happens when the event was not carried out or the object is not in the new zone. Capability `body:modify.then`.
   * Cloud r3-repl INTERFACE CHANGE (additive): also alone on a `createToken` event ("instead create those tokens plus an additional Map token", CR 614.1a): the
   * tokens are created as they would be, and `then.do` runs right after, in the branch of that event (CR 614.5).
   */
  | {
    b: 'modify'; amount?: AmountChange; count?: AmountChange; destination?: Destination; to?: PlayerRef; then?: { as: Name; do: EffectStep[] };
    /**
     * std-ru INTERFACE CHANGE (additive), CR 607.2a, 614.1a: with a destination in exile, the object the modified zone change put there is recorded under this
     * link of the replacement's source (the link store, design 3.9), as a `move` with `link` records what it exiled: "If a card you didn't control would be put
     * into an opponent's graveyard from anywhere, exile it instead" and "During your turn, you may play cards exiled with ~" (Valgavoth, Terror Eater) are linked.
     * Nothing is recorded when the event was not carried out or the object is not in exile afterwards. Capability `body:modify.link`.
     */
    link?: LinkId;
  }
  /**
   * std-library-2 INTERFACE CHANGE (additive): `as`, the prevention named for its `then` steps: while they run the name's result is performed when damage was
   * prevented (count: the damage prevented), so a `reflexive` step on it ("When damage is prevented this way, ~ deals that much damage to that source's controller",
   * CR 603.12, 615.5) triggers only then. Capability `body:prevent.as`.
   */
  | { b: 'prevent'; amount: Quantity | 'all'; then?: EffectStep[]; as?: Name } // CR 615
  /** `amount` (M6-0): CR 614.9 with a shield budget, "the next N damage ... is dealt to X instead". */
  | { b: 'redirect'; to: Ref; amount?: Quantity } // CR 614.9
  | { b: 'skip' } // CR 614.10
  /**
   * Cloud r5-repl INTERFACE CHANGE (additive): "If damage would be dealt to ~, instead that damage is dealt, but all other damage already dealt to him is healed"
   * (Wolverine, Fierce Fighter; CR 614.1a): the damage is dealt as it would be, and the damage already marked on the permanent is removed as it is dealt. A
   * damage event to a permanent only (effects/bodies/heal.ts, capability `body:healFirst`).
   */
  | { b: 'healFirst' }
  /**
   * Enters-the-battlefield modification (CR 614.1c-d, 614.12): tapped, tapped unless, with counters, choices, as a copy.
   * Choices are made first (CR 614.12a). `tappedUnlessPay` is the shock land ("you may pay 2 life; if you don't, it enters tapped").
   */
  | {
    b: 'enters';
    tapped?: boolean;
    /**
     * r5-fxb INTERFACE CHANGE (additive): "Lands you control enter untapped." (Spelunking): the permanent enters untapped, whatever an instruction (a "put onto
     * the battlefield tapped") or another replacement effect applied before it said (CR 614.1c; the affected object's controller orders it among the others,
     * CR 616.1, so it is never order-free). Capability `body:enters.untapped`.
     */
    untapped?: true;
    /**
     * trek-8 INTERFACE CHANGE (additive), CR 614.1c, 508.4 (cites from memory, unverified): "it enters tapped and attacking" (Kira Nerys, Firebrand): the permanent enters
     * as an attacking creature of the current combat, its controller choosing what it attacks (CR 508.4); it enters tapped and not attacking when there is no combat,
     * its controller is not the attacking player or it is no creature (CR 506.3a-b, 508.4a). Used with `tapped`. Capability `body:enters.attacking`.
     */
    attacking?: true;
    tappedUnless?: Condition;
    tappedUnlessPay?: CostDef;
    counters?: CounterSpec[];
    /**
     * CMD3 INTERFACE CHANGE (additive): counters it enters with only when the permanent, as it would exist on the battlefield (CR 614.12: with the continuous
     * effects that would apply to it there, its own static abilities included), matches `if`: sunburst's "if this object is entering the battlefield from the
     * stack as a creature, ... +1/+1 counter ...; if it ... isn't entering the battlefield as a creature, ... charge counter" (CR 702.44a). Capability
     * `body:enters.countersIf`.
     */
    countersIf?: { if: ObjectFilter; counters: CounterSpec[] }[];
    /**
     * CMD3 INTERFACE CHANGE (additive): `exclude`, values the choice never offers: "choose a color other than white" (the Thriving lands; CR 614.12a), color
     * letters for a color choice. std-rx5 INTERFACE CHANGE (additive): `min` and `max` of a number choice, "As ~ enters, choose a number between 1 and 10"
     * (Talion, the Kindly Lord; CR 614.12a, 607.2d).
     */
    choose?: { what: ChoiceKind; link: LinkId; options?: string[]; exclude?: string[]; min?: number; max?: number; cardKind?: 'land' | 'nonland' /* std-rx28: of a card name, CR 201.3 */ }[];
    /**
     * std-rx6 INTERFACE CHANGE (additive): "As ~ enters, look at an opponent's hand, then choose any card name." (Sorcerous Spyglass): before the choices, the
     * player it enters under chooses an opponent and looks at that player's hand (CR 614.12a, 402.3, 701.20e). Capability `body:enters.lookAtHand`.
     */
    lookAtHand?: 'opponent';
    copy?: {
      of: ObjectFilter; optional: boolean; except?: CopyExcept[];
      /**
       * M6-0, CR 707.9e: exceptions that are additional effects, not copiable values ("it enters with an additional +1/+1 counter if it's a creature"):
       * applied as the object enters, and NOT applied if another copy effect is applied to it later in the same entering (Altered Ego/Clone).
       */
      additional?: { if?: ObjectFilter; counters: CounterSpec[] }[];
      /**
       * FAST5 T64 (CR 614.1c, 614.12): "You may have this land enter tapped as a copy of any land card in a graveyard" (Echoing Deeps): the permanent enters tapped
       * only if the copy is chosen (the whole choice is optional; declining it, it enters untapped as itself).
       */
      tapped?: boolean;
      /**
       * r4-copy INTERFACE CHANGE (additive): "You may have ~ enter as a copy of any creature card in a graveyard, ... When you do, exile that card." (Superior
       * Spider-Man; CR 603.12, 614.12): what happens once the object entered as a copy of the chosen object, with that object bound as `then.as` and that name's
       * result performed (a `reflexive` step on it puts its triggered ability on the stack the next time a player would receive priority). Nothing happens when no
       * copy was chosen. Capability `body:enters.copy.then`.
       */
      then?: { as: Name; do: EffectStep[] };
      /**
       * trek-4 INTERFACE CHANGE (additive), CR 614.1c, 707.9 (unverified): "If you do, it enters with additional counters on it equal to the same number and
       * kinds of counters the copied permanent has on it." (Dominion Saboteur): once a copy is chosen, the counters on the chosen object as the permanent enters
       * are added, kind by kind, to the additional effects of the copy (`additional`, applied as it enters; none when no copy is chosen). Capability
       * `body:enters.copy.copiedCounters`.
       */
      copiedCounters?: true;
      /**
       * pc-tokens-2 (CR 614.12, 707.2, 611.2): "As ~ enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste."
       * (Cursed Mirror): the copy effect it enters with has this duration instead of lasting for good; it is itself again when the effect ends. Capability
       * `body:enters.copy.duration`.
       */
      duration?: Duration;
    };
    attachTo?: ObjRef;
    faceDown?: boolean;
    transformed?: boolean;
    under?: PlayerRef;
    withAbilities?: AbilityDef[];
    /** M6-0, CR 722.3a: "enters prepared" (capability `body:enters.prepared`, M6-6). */
    prepared?: boolean;
    /**
     * FAST5X E28 INTERFACE CHANGE (additive): "enters with your choice of A or B" (riot, CR 702.136a: "You may have this permanent enter with an additional
     * +1/+1 counter on it. If you don't, it gains haste."; CR 614.1c, 614.12a): as it enters, the player it enters under chooses one option (no stack, the
     * choice is part of the replacement), which adds its counters and the abilities it has from then on (an effect of the replacement, CR 611.2: losing the
     * ability later doesn't take them away). An option with counters is not offered when a rule forbids putting counters on the object (riot's ruling: it
     * gains haste). Capability `body:enters.choice`.
     */
    choice?: { label: string; counters?: CounterSpec[]; withAbilities?: AbilityDef[] }[];
    /**
     * std-rx15 INTERFACE CHANGE (additive): devour (CR 702.82a-b): "As this object enters, you may sacrifice any number of [filter] permanents. This permanent
     * enters with N times that many +1/+1 counters on it." As it enters, the player it enters under chooses any number of permanents they control that match
     * `filter` (creatures for plain devour) and sacrifices them; it enters with `times` +1/+1 counters for each one actually sacrificed. Capability
     * `body:enters.devour`.
     */
    devour?: { filter: ObjectFilter; times: Quantity };
    /**
     * std-cardcopy-3 INTERFACE CHANGE (additive): "As Mimeoplasm enters, exile up to X creature cards from your graveyard. It enters with three +1/+1 counters on
     * it for each creature card exiled this way." (CR 614.1c, 614.12a, 607.2a): as it enters, the player it enters under chooses up to `max` cards that match
     * `filter` (read for that player: "your graveyard") and exiles them; the cards actually exiled are kept in the new permanent's link store under `link` (the
     * cards "exiled with" it, parser/parse.ts#linkExiled), and it enters with `counters.per` counters of `counters.kind` for each of them. Capability
     * `body:enters.exileCards`.
     */
    exileCards?: { filter: ObjectFilter; max: Quantity; link?: LinkId; counters?: { kind: string; per: Quantity } };
    /**
     * std-freecast-2 INTERFACE CHANGE (additive), CR 614.1c, 205.1b: "... enters ... and is a Vampire in addition to its other types": it has these subtypes in
     * addition to its other types from the moment it enters (a layer 4 effect on the new object, effects/perform-events.ts#applyEnterFacts). Written by
     * effects/rule-replacements/permit-enters.ts only (PermissionDef.entersSubtypes); card text has no template for it (capability `body:enters.subtypes`).
     */
    subtypes?: string[];
    /**
     * p2-misc-1 INTERFACE CHANGE (additive), CR 731.1, 614.12 (cites unverified): "If it's neither day nor night, it becomes day as ~ enters." (Firmament Sage,
     * Vadrik, Astral Archmage): as the permanent enters, the game becomes day if it is neither day nor night; a game that is already day or night is left as it
     * is (becoming day from neither emits no `dayNight` event, CR 731.1a). Capability `body:enters.dayIfNeither` (effects/bodies/m5.ts#applyEnters).
     */
    dayIfNeither?: true;
  }
  /** Regeneration shield (CR 614.8, 701.19): remove damage, tap, remove from combat. */
  | { b: 'regeneration' }
  /**
   * M6-0. "As [this permanent] is turned face up / transforms, ..." (CR 614.1e, 708.11, 712.20): the steps happen DURING the event, before anything can see
   * the result (megamorph's +1/+1 counter, CR 702.37b). Only on `turnFaceUp` and `transform` proposals; the candidates come from the permanent as it will be
   * after the event (effects/registries.ts#PROPOSAL_KINDS, `selfCandidatesFrom`). Capability `body:during` (M6-3).
   */
  | { b: 'during'; do: EffectStep[] }
  /**
   * FAST5X E28 INTERFACE CHANGE (additive): the effects one or more shield counters create (CR 122.1c), generated by the RULES
   * (effects/rule-replacements/shield.ts), never by card text: "If this permanent would be destroyed as the result of an effect, instead remove a shield counter
   * from it" and "If damage would be dealt to this permanent, prevent that damage and remove a shield counter from it". Capability `body:shieldCounter`.
   */
  | { b: 'shieldCounter' }
  /**
   * std-rx24 INTERFACE CHANGE (additive): umbra armor (CR 702.89a), written by its keyword data only (keywords/data/umbra-armor.json): "If enchanted permanent
   * would be destroyed, instead remove all damage marked on it and destroy this Aura." On a `destroy` of a permanent that is not indestructible; asks the
   * CR 616.1 order against a regeneration shield (effects/bodies/umbra-armor.ts). Capability `body:umbraArmor`.
   */
  | { b: 'umbraArmor' };

export interface AmountChange {
  /** x2, x0.5 rounded as stated. */
  mul?: number;
  add?: Quantity;
  set?: Quantity;
  round?: 'up' | 'down';
  min?: number;
}

/** "You may cast ... as though ...", "You may play an additional land", "spend mana as though it were any color" (CR 609.4). */
export interface PermissionDef {
  s: 'permit';
  who: PlayerRef;
  action: 'cast' | 'play' | 'playLand' | 'activate' | 'spendMana' | 'haveFlash' | 'attackAsThoughNoDefender' | 'blockAsThough' | 'lookAt' | 'revealTop'
    /**
     * FAST5 T37 INTERFACE CHANGE (additive): "You may have ~ assign its combat damage as though it weren't blocked" (Thorn Elemental, CR 510.1b-c): when the object (the
     * source, or the objects `of` matches) is a blocked attacker, its controller may assign all its combat damage to what it attacks. Read at damage assignment by
     * statics/hooks.ts#mayAssignAsUnblocked; capability `permit:assignAsUnblocked`.
     */
    | 'assignAsUnblocked'
    /**
     * r4-mech INTERFACE CHANGE (additive): "you may activate loyalty abilities of Jace planeswalkers you control on any player's turn any time you could cast an
     * instant" (CR 606.3): the loyalty abilities of the permanents `of` matches (the source without it) are activated at instant speed; the one-each-turn limit stays.
     * Read by rules/timing.ts via hookpoints.loyaltyAsInstant (statics/hooks.ts); capability `permit:activateLoyaltyAsInstant`.
     */
    | 'activateLoyaltyAsInstant'
    /**
     * std-freecast-5 INTERFACE CHANGE (additive): plot from the top of your library (CR 702.170a, 702.170f, 116.2k), with `fromTop` only: "You may plot nonland cards
     * from the top of your library" (`of`: the cards that may be plotted from there) and "The top card of your library has plot. The plot cost is equal to its mana
     * cost." (`plotCost: 'manaCost'`). Read by core/special/plot.ts via statics/play-permits.ts#topPlotUses; capability `permit:plot.top`.
     */
    | 'plot';
  of?: ObjectFilter;
  /**
   * p2-attack-block-1 INTERFACE CHANGE (additive): with `blockAsThough` only, the ATTACKERS the permission concerns ("Creatures with islandwalk can be blocked as
   * though they didn't have islandwalk", CR 609.4, 702.14c): any creature of a `who` player may block an attacker this filter matches as though the attacker
   * didn't have the evasion keyword `asThough` names. Without `of` (any blocker); statics/hooks.ts#permits. Capability `feature:permit.blockAsThough.attacker`.
   */
  attacker?: ObjectFilter;
  /**
   * std-rx32 INTERFACE CHANGE (additive): with `spendMana` and `asThough` 'any color', "You may spend mana as though it were mana of any color to activate
   * abilities of creatures you control" (CR 609.4b): the activated abilities of the objects `of` matches (rules/sources.ts `SpendContext.anyColor`, set by
   * actions/activate.ts via statics/play-permits.ts#staticAnyColorForAbility). Capability `permit:spendMana.anyColorAbilities`.
   */
  abilities?: true;
  from?: ZoneName;
  /** "as though they had flash", "mana of any type" ... */
  asThough?: string;
  /** Additional land plays etc. */
  count?: Quantity;
  costChange?: CostChange;
  /** Spells cast this way gain this (CR 610.5). */
  grants?: AbilityDef[];
  /**
   * FAST5X E2 INTERFACE CHANGE (additive): only on a turn after the one in which this resolved effect began (warp, CR 702.185a: "Its owner may cast this card
   * after the current turn has ended for as long as it remains exiled"). Honored for the object permissions of statics/play-permits.ts (capability
   * `feature:permit.<action>.laterTurn`); a static ability never has it (it has no beginning: fails closed).
   */
  laterTurn?: true;
  /**
   * FAST5X E14 INTERFACE CHANGE (additive): "from the top of your library" (CR 401.5, 601.3, 305.1). With `action` 'cast' or 'play' the permission is for
   * the card on top of each `who` player's own library, whichever card that is at the moment (re-evaluated as the top card changes: a static ability's
   * effect is never locked in, CR 611.3a, and a resolved one names no object; CR 611.2c concerns characteristics and control). `of` is matched against the
   * card as the spell it would become (CR 601.3e) or as the face played as a land; 'play' without `of` is "play cards" / "play the top card". Read by
   * statics/play-permits.ts (capability `permit:<action>.top`). A player can use it only while they may look at that card (`lookAt`, CR 401.5).
   * `lookAt` without any optional field ("You may look at the top card of your library any time", CR 401.5) is the other permission of this package:
   * capability `permit:lookAt`, core/view.ts#canSee via statics/play-permits.ts#topCardVisibleTo.
   */
  fromTop?: true;
  /**
   * FAST5X E14 INTERFACE CHANGE (additive): "Once each turn, you may cast ... from the top of your library" (CR 601.3, the effect's own limit). Each object's
   * permission allows one spell each turn (a new object has its own, CR 400.7), counted in `GameState.turnActivations` under `<source>|top:<pos>:<index>`.
   * Honored with `fromTop` and action 'cast' only (`feature:permit.cast.oncePerTurn`).
   * C10: and on the graveyard permissions of a static ability ("Once during each of your turns, you may cast a creature spell from your graveyard": the
   * ability's condition is "it's your turn"), counted under `<source>|gy:<pos>:<index>` (statics/play-permits.ts#graveyardPermitUses).
   */
  oncePerTurn?: true;
  /**
   * C10 INTERFACE CHANGE (additive): "... from your graveyard by paying 3 life in addition to paying their other costs" (CR 601.2b, 601.2f-h, 118.8): an
   * additional cost of each spell cast with this permission, paid with the spell's other costs. Honored on the graveyard cast permissions of
   * statics/play-permits.ts (`feature:permit.cast.addCost`).
   */
  addCost?: CostDef;
  /**
   * C10 INTERFACE CHANGE (additive): "If you cast a spell this way, that artifact enters with a finality counter on it" (CR 614.1c, 122.1h): the permanent
   * a spell cast with this permission becomes enters with these counters. Recorded on the spell as it is cast (`StackInfo.permitEnters`), so it applies
   * even if the permission's source is gone by then; a copy of the spell was not cast this way (CR 707.10). Honored on the graveyard cast permissions
   * of statics/play-permits.ts (`feature:permit.cast.entersWith`).
   */
  entersWith?: CounterSpec[];
  /**
   * FAST5X E29 INTERFACE CHANGE (additive), CR 609.4b: "..., and mana of any type can be spent to cast that spell": a spell cast with this permission may be
   * paid for with mana of any type (rules/sources.ts `SpendContext.anyType`). Honored on the permissions for named objects of statics/play-permits.ts
   * (capability `feature:permit.<action>.anyManaType`).
   */
  anyManaType?: true;
  /**
   * pc-exile-play-1 INTERFACE CHANGE (additive), CR 609.4b, 107.4c: "..., and you may spend mana as though it were mana of any color to cast that spell": a spell cast
   * with this permission may be paid for as though each mana were mana of any color (a {C} symbol still needs colorless mana; rules/sources.ts `SpendContext.anyType`
   * 'color'). Honored on the permissions for named objects, as `anyManaType` is (statics/play-permits.ts#anyManaColorPermit; capability
   * `feature:permit.<action>.anyManaColor`). Mana of any type (`anyManaType`) wins when both apply.
   */
  anyManaColor?: true;
  /**
   * FAST5X E29 INTERFACE CHANGE (additive): "... you may play it if you control a Kavu": the permission applies only while this condition holds, judged each time
   * it is read (CR 611.2b-like: the effect itself stays). Honored on the permissions for named objects of statics/play-permits.ts (capability
   * `feature:permit.<action>.while`; the condition's own kinds need `rcond:<kind>`, model/cap-walk.ts).
   */
  while?: Condition;
  /**
   * Cloud r3-mech INTERFACE CHANGE (additive): mayhem with no cost, on a land card (CR 702.187a-b): "You may play this card from your graveyard if you discarded it
   * this turn" (`of: {self: true}`, `from: 'graveyard'`, action 'play', a static ability of the card that functions in the graveyard, CR 113.6). The card is the
   * very object a discard by its owner put there this turn (CR 400.7). Honored by statics/play-permits.ts#isDiscardedSelfPlayPermit for land plays only
   * (capability `permit:play.discardedSelf`).
   */
  discardedThisTurn?: true;
  /**
   * r5-repl INTERFACE CHANGE (additive), CR 614.1a, 400.7: "You may cast it this turn. If that spell would be put into a graveyard, exile it instead." (Nita,
   * Forum Conciliator): a spell cast with this permission is put there instead of a graveyard (`yours`: "into your graveyard", only while its owner is the
   * permission's player), whether it resolves or is countered. Recorded on the spell as it is cast (`StackInfo.permitGraveyardInstead`), so it applies to
   * that spell only (the object on the stack) even if the permission's source is gone by then; a copy of the spell was not cast this way (CR 707.10).
   * Honored on the cast permissions for named objects of statics/play-permits.ts (capability `feature:permit.cast.graveyardInstead`), applied by
   * effects/rule-replacements/permit-graveyard.ts.
   */
  graveyardInstead?: { to: Destination; yours?: true };
  /**
   * r5-dig INTERFACE CHANGE (additive), CR 715.3, 715.3a: "you may cast it from your graveyard as an Adventure until the end of your next turn" (Mosswood
   * Dreadknight): the permission lets the card be cast only as its Adventure (the face whose type line has the subtype Adventure); its other face is not
   * cast this way. Honored on the permissions for named objects of statics/play-permits.ts (actions/cast.ts; capability `feature:permit.cast.asAdventure`).
   */
  asAdventure?: true;
  /**
   * std-rx27 INTERFACE CHANGE (additive), CR 601.3, 305.1, 611.2a: "until end of turn, you may play a card exiled with ~" (Raphael, Most Attitude): the permission
   * lets the player play or cast ONE of the objects it names; once a card has been played or cast with it, it allows no more (counted in
   * `GameState.turnActivations` under `single:<the effect's order>`; a permission for the same card without this limit is used first, CR 601.3: the player
   * chooses which permission applies). Honored on the permissions for named objects of statics/play-permits.ts (capability `feature:permit.<action>.single`).
   */
  single?: true;
  /**
   * std-freecast-2 INTERFACE CHANGE (additive), CR 614.1c, 205.1b: "If you do, it enters with a finality counter on it and is a Vampire in addition to its other types"
   * (The Tomb of Aclazotz): the permanent a spell cast with this permission becomes has these subtypes in addition to its other types from the moment it enters
   * (a layer 4 effect on that object for as long as it is that object, CR 613.1d, 400.7). Recorded on the spell as it is cast with `entersWith`
   * (`StackInfo.permitEnters.subtypes`); a copy of the spell was not cast this way (CR 707.10). Honored on the graveyard cast permissions of
   * statics/play-permits.ts with `entersWith` (capability `feature:permit.cast.entersSubtypes`).
   */
  entersSubtypes?: string[];
  /**
   * trek-11 INTERFACE CHANGE (additive), CR 400.11, 400.11a-b, 305.1, 601.3, 404.1: "Once during each of your turns, you may play a permanent card you own from outside the game or
   * from your graveyard" (The Holodeck): with `from: 'graveyard'`, `action: 'play'`, an `of` of the permanent card types and `oncePerTurn`, the permission covers the cards the
   * player owns outside the game too (`GameState.outside`: their sideboard, CR 400.11a). ONE permission for both places: the once-each-turn use is counted once for the two
   * together (the counter of the graveyard permission). A land card is played as a land (CR 305.1: a land play), any other permanent card is cast with its mana cost
   * and the timing of its type; it is no object until the player does (core/special/play-outside.ts, the `playOutside` special action). Honored by
   * statics/play-permits.ts#isPermanentPlayPermit only (capability `feature:permit.play.zone.outside`); on any other permission a form nothing registers.
   */
  alsoOutside?: true;
  /**
   * std-rx27 INTERFACE CHANGE (additive), CR 614.1c, 601.3e: "If you cast a creature spell this way, that creature enters with an additional +1/+1 counter on it"
   * on a top-card cast permission (Mikey & Don, Party Planners): `entersWith` applies only to a spell this filter describes, judged on the spell as it is cast
   * (CR 601.3e). Honored with `entersWith` on the top-card cast permissions of statics/play-permits.ts (`feature:permit.cast.top.entersWith`).
   */
  entersWithIf?: ObjectFilter;
  /**
   * std-rx24 INTERFACE CHANGE (additive), CR 702.133a: a spell cast with this graveyard permission is exiled instead of put anywhere else any time it would
   * leave the stack (jump-start: "If this spell was cast using jump-start, exile this card instead of putting it anywhere else any time it would leave the
   * stack"), recorded on the spell as it is cast (`StackInfo.exileOnLeave`, as harmonize's alternative cost does; core/resolve.ts#leaveStack). Written by keyword
   * data only (keywords/data/jump-start.json). Honored on graveyard permissions (statics/play-permits.ts#graveyardPermitUses, actions/cast.ts; capability
   * `feature:permit.cast.exileOnLeave`).
   */
  exileOnLeave?: true;
  /**
   * std-freecast-1 INTERFACE CHANGE (additive), CR 118.9, 601.2b, 601.2i: "The first spell each player casts during each of their turns may be cast without paying its
   * mana cost" (Weftwalking): the alternative cost of an isAltCostPermit form is offered only for the first spell the player casts this turn (no spell cast by
   * that player yet this turn, `PlayerState.turnStats.spellsCast`; the spell being cast counts once it becomes cast, CR 601.2i). Casting that first spell any
   * other way uses the chance up. With `who` `{ref:'active'}` ("each player ... during each of their turns", CR 102.1). Honored by
   * statics/play-permits.ts#grantedAlternatives (capability `feature:permit.cast.alternative.firstSpell`).
   */
  firstSpellThisTurn?: true;
  /**
   * std-freecast-5 INTERFACE CHANGE (additive), CR 702.170a, 702.170f: with action 'plot' and `fromTop`, "The top card of your library has plot. The plot cost is equal to
   * its mana cost.": a plot cost for whichever card is on top of `who`'s library, its mana cost (a card with no mana cost, or with {X} in it, gets none). Plotting
   * from the library still needs a permission with `of` ("You may plot nonland cards from the top of your library"). Capability `permit:plot.top`.
   */
  plotCost?: 'manaCost';
  /**
   * std-exile-play-1-3 INTERFACE CHANGE (additive), CR 400.3, 608.2c: "players may play cards they exiled this way" (Memory Vessel): each player of `who` may play
   * only those of the named objects they own (each player exiled cards from their own library). Honored on the permissions for named objects of
   * statics/play-permits.ts (capability `feature:permit.<action>.ownOnly`).
   */
  ownOnly?: true;
  /**
   * std-exile-play-1-3 INTERFACE CHANGE (additive), CR 614.1c, 305.1: "Each land played this way enters tapped." (Lightstall Inquisitor): a land played with this
   * permission for named objects enters the battlefield tapped (actions/land.ts; capability `feature:permit.play.landsEnterTapped`).
   */
  landsEnterTapped?: true;
}

/**
 * Rule-modifying statics that read as numbers, not as restrictions. Each is a named hook the engine queries (design 9.4).
 * T20 (FAST4) INTERFACE CHANGE (additive): `untapDuringOtherUntapSteps`, "Untap ~ during each other player's untap step" (CR 502.3): the source itself untaps
 * during the untap step of each player other than its controller (statics/hooks.ts#untapsDuringOthersUntapStep, read by core/steps.ts). Without `of` only.
 */
export interface RuleModDef {
  s: 'rule';
  /**
   * Cloud r3-mech INTERFACE CHANGE (additive): 'stationUsesToughness', "Each creature you control with toughness greater than its power stations permanents using its
   * toughness rather than its power." (CR 702.184a: station puts charge counters equal to the tapped creature's power; with `of` and `onlyIf` as for
   * `combatDamageUsesToughness`). Read by effects/eval.ts (`stat` with `station`) via statics/hooks.ts#stationsUsingToughness.
   */
  rule: 'maxHandSize' | 'startingLife' | 'landPlays' | 'combatDamageUsesToughness' | 'stationUsesToughness' | 'manaDoesNotEmpty' | 'attackTax' | 'extraBlockers' | 'extraAttackerBlocks' | 'handSizeNoLimit' | 'poisonLimit' | 'commanderTax' | 'lifeTotalSetAs'
    | 'untapDuringOtherUntapSteps'
    // FAST5X E3 INTERFACE CHANGE (additive), CR 702.122a, 702.171a: "~ saddles Mounts and crews Vehicles as though its power were N greater" (`value` N) and
    // "... using its toughness rather than its power": what the source counts for the total of a crew or saddle cost (statics/hooks.ts#crewSaddleValue)
    | 'crewSaddlePowerBonus' | 'crewSaddleUsesToughness'
    // FAST5X E19 INTERFACE CHANGE (additive), CR 106.4, 500.5, 614.1: "If you would lose unspent mana, that mana becomes red instead" (`manaType` the type it
    // becomes): a replacement of the emptying of the player's mana pool as a step or phase ends; the mana stays, of that type (core/steps.ts#endOfStepCleanup)
    | 'unspentManaBecomes'
    // M12-3 INTERFACE CHANGE (additive), CR 701.38d: "While voting, you get an additional vote." (`additionalVote`) and "While voting, you may vote an additional
    // time." (`mayVoteAdditional`): `player` (default you) has one more vote, which happens at the same time as their other votes (effects/handlers/actions-native.ts)
    | 'additionalVote' | 'mayVoteAdditional'
    // r3-static INTERFACE CHANGE (additive), CR 704.5j: "The "legend rule" doesn't apply to permanents you control" (`of` the permanents it doesn't apply to;
    // without `of`, every permanent: "The "legend rule" doesn't apply."): a permanent `of` matches is not counted by the legend rule (core/sba-objects.ts via
    // statics/hooks.ts#legendRuleExempt), judged on the permanents as they are when the rule is checked (a rule effect, not a characteristic: CR 611.2c
    // locks no set for it). As a resolved effect: "... this turn" (Hall of Echoes).
    | 'legendRuleExempt'
    // r3-static INTERFACE CHANGE (additive), CR 704.5a, 104.3b: "You don't lose the game for having 0 or less life" (`player`, default you): the state-based
    // action of CR 704.5a doesn't apply to that player (core/sba.ts via statics/hooks.ts#losesForZeroLife); the other losses (704.5b-c, 704.6c) still do
    | 'noLossForZeroLife'
    // r3-static INTERFACE CHANGE (additive), CR 602.5b, 702.193a: "Each power-up ability of permanents you control can be activated an additional time"
    // (`keyword` the wrapper keyword of the abilities, `of` their sources, `value` the extra activations, default 1): an activated ability with that keyword
    // whose printed limit is "only once" per game may be activated that many more times (rules/timing.ts via statics/hooks.ts#additionalActivations)
    | 'additionalActivation'
    // r3-static INTERFACE CHANGE (additive), CR 510.1a: "If ~'s power is negative, ~ assigns combat damage as though ~'s power were positive" (Loot, the
    // Anomaly): the source itself (no `of`) assigns combat damage equal to the absolute value of its power (core/combat-damage.ts via
    // statics/hooks.ts#assignsNegativePowerAsPositive); its power itself is unchanged
    | 'negativePowerAssignsAsPositive'
    // CMD2 INTERFACE CHANGE (additive), CR 903.8, 119.4: "Rather than pay {2} for each previous time you've cast this spell from the command zone this game, pay
    // 2 life that many times." (`commanderTaxAsLife`, `value` the life per previous cast): the commander's own tax is paid in life instead of mana as it is cast
    // from the command zone (actions/cast-costs.ts#commanderTaxCost reads it from the card's own abilities)
    | 'commanderTaxAsLife'
    // r4-mech INTERFACE CHANGE (additive), CR 705.1-705.2, 614.1a: "The first time you flip one or more coins each turn, those coins come up heads and you win those
    // flips." (`firstCoinFlipsWon`): the coins of the first instruction this turn by which the source's controller flips coins come up heads and are won (no call is
    // made); read by effects/handlers/game.ts#flipCoin via statics/hooks.ts#firstCoinFlipsWon, counted by PlayerState.turnStats.coinFlips
    | 'firstCoinFlipsWon'
    // r4-mech INTERFACE CHANGE (additive), CR 514.2: "Damage isn't removed from this creature during cleanup steps." (`damageNotRemovedInCleanup`): the damage marked
    // on the source (or on each permanent `of` matches) stays as the cleanup step removes damage (core/steps.ts via statics/hooks.ts#damageKeptInCleanup)
    | 'damageNotRemovedInCleanup'
    // r4-mech INTERFACE CHANGE (additive), CR 704.5i: "Planeswalkers you control aren't put into their owners' graveyards for having 0 loyalty." (`zeroLoyaltyKept`):
    // the state-based action that puts a planeswalker with 0 loyalty into its owner's graveyard does not apply to the planeswalkers `of` matches (relative to the
    // source; the source itself without `of`); core/sba-objects.ts via statics/hooks.ts#zeroLoyaltyKept
    | 'zeroLoyaltyKept'
    // r5-static INTERFACE CHANGE (additive), CR 508.1h-j, 509.1d-f: "Creatures can't block unless their controller pays {1} for each of those creatures"
    // (`blockTax`): each creature declared as a blocker that `of` describes (default every creature) costs its controller `value` generic mana (or `cost`) more
    // to declare; `blocking` limits it to blockers of the attackers it describes ("can't block creatures you control unless ..."). The total is determined,
    // locked in and paid as the declaration is made (core/combat-tax.ts via statics/combat-tax.ts#blockTaxes); a player who doesn't pay declares again.
    // `attackTax` (the same, CR 508.1h-j) is the tax on attackers: `player` the protected players (default you), `defenders` what of theirs it protects
    | 'blockTax'
    // std-rx13 INTERFACE CHANGE (additive), CR 502.3: "You may choose not to untap ~ during your untap step." (`mayNotUntap`): as its controller's untap step
    // untaps their permanents, they may keep the source tapped (core/steps.ts asks once for every such permanent, via statics/hooks.ts#mayNotUntap). The source
    // itself only (no `of`, no `player`)
    | 'mayNotUntap'
    // std-rx32 INTERFACE CHANGE (additive), CR 702.11b, 115.1: "Creatures your opponents control can be the targets of spells and abilities as though they didn't have
    // hexproof." (`targetableThroughHexproof`): a permanent `of` matches (relative to the source) is targeted as though it had no hexproof (nor "hexproof from"),
    // by any player's spells and abilities (keywords/hooks/targeting.ts marks the hexproof denial waivable, statics/hooks.ts#permits waives it); shroud and protection still apply
    | 'targetableThroughHexproof'
    // std-rx27 INTERFACE CHANGE (additive), CR 602.5b, 702.177a: "you may activate exhaust abilities as though they haven't been activated" (Elvish Refueler;
    // `keyword` the wrapper keyword of the abilities): while it applies (its static ability's condition, "During your turn, as long as you haven't activated an
    // exhaust ability this turn", CR 611.3a), the per-game limit of such an ability of a permanent `player` (default you) controls is not counted (rules/timing.ts
    // via statics/hooks.ts#activatesAsUnactivated). No `of`, `value` or other field
    | 'activateAsUnactivated'
    // std-ry8 INTERFACE CHANGE (additive), CR 701.43a, 508.1: "You may exert ~ as it attacks." (`mayExertAsAttacks`): as its controller declares it as an attacker,
    // they may exert it (core/combat.ts asks once for every such attacker, via statics/hooks.ts#attackOptions); `then` runs right after it is exerted this way
    // ("When you do, ...": a `reflexive` step waiting for `then.as`, CR 603.12). `enlist` (CR 702.154a): as the source attacks, its controller may tap one
    // untapped creature they control that they didn't choose to attack with and that has haste or has been under their control continuously since the turn
    // began; `then` runs with the tapped creature bound as `then.as` ("When you do, add its power to this creature's until end of turn"). The source itself only
    | 'mayExertAsAttacks' | 'enlist'
    // std-mana-1 INTERFACE CHANGE (additive), CR 106.12, 614.1a: "If you tap a basic land for mana, it produces three times as much of that mana instead."
    // (`tapManaMultiplier`, `of` the permanents, `value` the factor, `player` who taps, default you): a mana ability with {T} in its cost of a permanent `of`
    // matches, activated by that player, adds each unit `value` times (rules/mana.ts#addMana via statics/hooks.ts#tapManaMultiplier; several multiply)
    | 'tapManaMultiplier'
    // p2-player-rules-1 INTERFACE CHANGE (additive), CR 502.3: "Players can't untap more than one nonbasic land during their untap steps." (`untapLimit`, `value`
    // the most permanents, `of` the permanents it counts, default every permanent; `player` whose untap steps, default you): of the permanents `of` matches that
    // the active player's untap step would untap (their own, CR 502.3), that player untaps no more than `value`, chosen by them one at a time among the ones
    // every such limit still allows (core/steps.ts via statics/hooks.ts#untapLimits). Untaps by other effects, and permanents of other players untapping
    // during this step ("untap ~ during each other player's untap step"), are not limited
    | 'untapLimit'
    // p2-c-dieroll-1 INTERFACE CHANGE (additive), CR 706.6, 614.1a (unverified cites): "If you would roll one or more dice, instead roll that many dice plus one and
    // ignore the lowest roll." (`diceAdvantage`): each instruction by which the source's controller rolls dice rolls one more die of that kind, and the lowest
    // roll is ignored (not considered rolled: no event, not counted). Several such effects each add a die and each ignore one more (CR 616.1). Read by
    // effects/handlers/game.ts#rollDie via statics/hooks.ts#diceAdvantage; core/dice.ts#rollDice rolls and ignores
    | 'diceAdvantage';
  /**
   * std-ry8 INTERFACE CHANGE (additive), CR 603.12: of `mayExertAsAttacks` and `enlist`, what happens right after the option was taken, in a context whose source
   * and controller are the attacking creature's, with the exerted creature (or the creature enlisted) bound as `as` and that name's result performed. Capability
   * `feature:rule.attackOption.then`.
   */
  then?: { as: Name; do: EffectStep[] };
  /**
   * r5-static INTERFACE CHANGE (additive), CR 508.1h: of `attackTax`, what an attacking creature must be attacking for the tax to apply: one of the `player`
   * players (`players`, the default: "creatures can't attack you unless ..."), a planeswalker one of them controls (`planeswalkers`: "... attack planeswalkers
   * you control unless ..."), or either (`both`: "... attack you or planeswalkers you control unless ..."). `any`: whatever it attacks, `player` unread
   * ("creatures can't attack unless their controller pays ...").
   */
  defenders?: 'players' | 'planeswalkers' | 'both' | 'any';
  /** r5-static: of `blockTax`, only blockers of an attacker this describes are taxed ("... can't block creatures you control unless ..."). */
  blocking?: ObjectFilter;
  /**
   * r5-static INTERFACE CHANGE (additive), CR 508.1h, 509.1d: of `attackTax` and `blockTax`, the cost for each creature when it is not generic mana `value`
   * ("{W/P}", "2 life"). Exactly one of `value` and `cost` is given.
   */
  cost?: CostDef;
  /** r3-static: of `additionalActivation`, the wrapper keyword of the activated abilities it applies to ("power-up", `ActivatedAbilityDef.keyword`). */
  keyword?: string;
  player?: PlayerRef;
  /**
   * FAST5X E19 INTERFACE CHANGE (additive), CR 106.4, 500.5: of `manaDoesNotEmpty`, only mana of this type is not lost ("You don't lose unspent red mana as
   * steps and phases end"); of `unspentManaBecomes`, the type the mana becomes. Any other rule has no `manaType`.
   */
  manaType?: ManaType;
  value?: Quantity | 'none';
  /**
   * std-ry3 INTERFACE CHANGE (additive), CR 402.2: of `maxHandSize`, the value changes the player's maximum hand size instead of setting it: "Your maximum hand
   * size is increased by two." (`increase`), "... is reduced by three." (`reduce`). Applied with the other hand-size modifications in timestamp order
   * (statics/hooks.ts#maxHandSize); "no maximum hand size" stays no maximum. Capability `feature:rulemod.maxHandSize.delta`.
   */
  delta?: 'increase' | 'reduce';
  of?: ObjectFilter;
  /**
   * FAST5 T60 INTERFACE CHANGE (additive), CR 510.1a, 613.11: of `combatDamageUsesToughness`, only for a creature whose toughness is greater than its power
   * ("each creature you control with toughness greater than its power assigns combat damage equal to its toughness rather than its power", "as long as
   * equipped creature's toughness is greater than its power, it assigns ..."); without it the creature always does (Doran, the Siege Tower). Judged on the
   * characteristics the creature has as combat damage is assigned (statics/hooks.ts#assignsCombatDamageAsToughness). Any other rule has no `onlyIf`.
   */
  onlyIf?: 'toughnessGreaterThanPower';
}

/** "Triggers an additional time" (CR 603.2d). */
export interface TriggerModDef {
  s: 'triggerMod';
  /**
   * The event that causes the trigger.
   * FAST5 T40 INTERFACE CHANGE (additive): absent, ANY event ("If a triggered ability of a Ninja creature you control triggers, that ability triggers an additional
   * time", CR 603.2d). Only the triggered abilities of permanents on the battlefield (or that were there as the event left it, CR 603.10a) are affected, judged by
   * `abilitiesOf`; capability `feature:triggerMod.any` (triggers/collect.ts).
   */
  cause?: EventPattern;
  /** Whose triggered abilities are affected. */
  abilitiesOf: ObjectFilter;
  additional: Quantity;
  /**
   * CLOUD std-misc INTERFACE CHANGE (additive): the events matching `cause` cause NO ability to trigger ("Creatures entering don't cause abilities to trigger", Torpor
   * Orb): neither triggered abilities of objects nor delayed ones, whatever `additional` says (written 0). Only a permanent entering is read (CR 603.6a: the object as it
   * exists on the battlefield; the static abilities of permanents on the battlefield right after the event apply, CR 603.2), with `abilitiesOf` empty (every ability).
   * Capability `feature:triggerMod.suppress.enters` (triggers/collect.ts#suppressed).
   */
  suppress?: true;
  /**
   * std-rx32 INTERFACE CHANGE (additive): with `suppress` and no `cause`, the triggered abilities that the keyword `keyword` of the permanents `abilitiesOf` matches
   * generates don't trigger at all ("Ward abilities of those creatures don't trigger", CR 702.21a, 603.2). Capability `feature:triggerMod.suppress.keyword`
   * (triggers/collect.ts#silencedKeywords).
   */
  keyword?: string;
}

/**
 * std-typechange-2 (CR 603.2d, 603.10a, 700.4; cites unverified): a cause that is a creature DYING ("If a creature dying causes a triggered ability of this creature or
 * an emblem you own to trigger, that ability triggers an additional time", The Masamune; Teysa Karlov): a zone change from the battlefield to a graveyard of a
 * described object. Such an event looks back (CR 603.10a), so the abilities of permanents that left with it (the dying creature's own "when this creature dies") and
 * a doubler that left with it (the creature that had the ability, dying itself) count as they were immediately before the event, judged on last known information.
 */
export function diesCause(cause: EventPattern | undefined): boolean {
  if (cause === undefined || cause.ev !== 'zoneChange') return false;
  const c = cause as { from?: unknown; to?: unknown; subject?: unknown };
  return c.from === 'battlefield' && c.to === 'graveyard' && Object.keys(cause).every((k) => k === 'ev' || k === 'from' || k === 'to' || k === 'subject');
}

/**
 * trek-2 (CR 603.2d, 119.9; cites unverified): a cause that is YOU GAINING LIFE ("If you gaining life causes a triggered ability of a permanent you control to trigger,
 * that ability triggers an additional time", Dr. Beverly Crusher): a `life` gain event of the controller of the doubler, with no amount. Nothing leaves the
 * battlefield with it, so it is matched without looking back, like a permanent entering (triggers/collect.ts#timesTriggered).
 */
export function isLifeGainCause(cause: EventPattern | undefined): boolean {
  if (cause === undefined || cause.ev !== 'life') return false;
  return cause.change === 'gain' && cause.player === 'you' && Object.keys(cause).every((k) => k === 'ev' || k === 'change' || k === 'player');
}

/** "As an additional cost to cast this spell, ..." (CR 118.8, 601.2b, 604.5). */
export interface AdditionalCostDef {
  s: 'additionalCost';
  cost: CostDef;
  optional?: boolean;
  /** Name used by linked abilities: "if its kicker was paid" (CR 607.2i). */
  name?: string;
  repeatable?: boolean; // multikicker, replicate
  /** M6-0, CR 601.2b: "As an additional cost to cast this spell, sacrifice a creature or pay {3}": exactly one of the costs sharing this group is paid (M6-5). */
  choiceGroup?: string;
  /**
   * FAST5X E1 INTERFACE CHANGE (additive): paying this cost is choosing a player (CR 702.174a, gift: "As an additional cost to cast this spell, you may
   * choose an opponent"). The choice is made as the cost is announced (CR 601.2b) and kept in `CostsPaid.chosenPlayers[name]` (PlayerRef `costChosen`).
   */
  choosePlayer?: 'opponent';
  /**
   * std-costs-2 INTERFACE CHANGE (additive): paying this cost starts with choosing a creature type ("As an additional cost to cast this spell, you may choose a creature
   * type and behold two creatures of that type", Celestial Reunion; CR 601.2b, 205.3m): the type is chosen as the cost is announced and remembered by the spell under
   * `link` (`GameObject.links`, CR 607.2d), where the cost's own filters ("of that type": `{chosen: {link, quality: 'creatureType'}}`) and the spell's "the chosen type"
   * read it. Only the types that leave the cost payable are offered. Capability `feature:additionalCost.chooseType`.
   */
  chooseType?: { what: 'creatureType'; link: LinkId };
  /**
   * r3-cost INTERFACE CHANGE (additive): "As an additional cost to cast this spell, blight X. X can't be greater than the greatest toughness among creatures you
   * control." (Soul Immolation; CR 107.3, 601.2b): the largest X the caster may announce for this mandatory cost, read as X is announced (actions/cast.ts; a value
   * that can't be read refuses the cast, never a guess). Capability `feature:additionalCost.xMax`.
   */
  xMax?: Quantity;
  /**
   * std-costs-1 INTERFACE CHANGE (additive), CR 601.2b, 601.2f: an optional cost with an "any number" part whose number a cost reduction of the spell reads
   * ("you may sacrifice any number of nonland permanents. This spell costs {1} less to cast for each permanent sacrificed this way"): the caster announces the
   * number as the cost is announced (actions/cast-costs.ts; 0 is not paying it), and it is kept in `CostsPaid.counts[name]` (Quantity `costCount`). Needs
   * `name`. Capability `feature:additionalCost.announceCount`.
   */
  announceCount?: true;
}

/** "You may pay [cost] rather than pay this spell's mana cost" (CR 118.9, 601.2b). */
export interface AlternativeCostDef {
  s: 'alternativeCost';
  cost: CostDef;
  /** Zone it may be cast from (flashback: graveyard). */
  from?: ZoneName;
  /** Name used by linked abilities and by `wasCast.via`. */
  name: string;
  when?: Condition;
  /**
   * FAST5X E2 INTERFACE CHANGE (additive): the second static ability of warp (CR 702.185a), which functions on the stack: "If this spell's [name] cost was
   * paid, [do] the permanent this spell becomes at [when]". As the permanent spell resolves and the permanent enters, a delayed triggered ability is created
   * (CR 603.7) whose steps name that permanent `{ref:'bound', name:'permanent'}` (captured with the zone it entered: if it leaves first it is a new object and
   * nothing happens to it, CR 400.7). Carried in `StackInfo.altDelay` from the announcement (a granted warp keeps applying on the stack, CR 400.7g) and copied
   * with the spell (CR 707.10). Capability `feature:alternativeCost.delay` (actions/cast-kinds.ts).
   */
  delay?: AltCostDelay;
  /**
   * FAST5X E7 INTERFACE CHANGE (additive), CR 702.190a: "Any time you could cast an instant during your declare blockers step, you may cast this spell by
   * paying [cost] ...": cast this way, the spell may be cast any time its caster could cast an instant (they have priority, CR 117.1a), whatever its card
   * type, while `when` holds (sneak: `turnOf you, step declareBlockers`). Read by actions/cast.ts#castCheck; capability `feature:alternativeCost.instantSpeed`.
   */
  instantSpeed?: true;
  /**
   * FAST5X E7 INTERFACE CHANGE (additive), CR 702.190b, 506.3a, 508.4, 508.4a, 508.4d: "A permanent spell whose sneak cost was paid enters the battlefield
   * tapped and attacking. It will be attacking the same player, planeswalker, or battle as the creature that was returned to its owner's hand to pay the
   * sneak cost". `'returned'`: the creature this cost returned to its owner's hand (a `returnToHand` part, CR 601.2h) names the defender, read from its last
   * known information (`LastKnown.combat.defender`). Kept in `StackInfo.entersAttacking` (copied with the spell, CR 707.10) and applied by core/resolve.ts.
   * Capability `feature:alternativeCost.entersAttacking`.
   */
  entersAttacking?: 'returned';
  /**
   * FAST5X E6 INTERFACE CHANGE (additive): usable only on a card its owner discarded this turn ("As long as you discarded this card this turn", mayhem,
   * CR 702.187b): the card in the graveyard is the very object a discard put there this turn (a card that left the graveyard and came back is a new object,
   * CR 400.7). Read by actions/cast.ts#castCheck from the history. Capability `feature:alternativeCost.discardedThisTurn`.
   */
  discardedThisTurn?: true;
  /**
   * FAST5X E6 INTERFACE CHANGE (additive): "and tapping up to one untapped creature you control ... its total cost is reduced by an amount of generic mana
   * equal to the tapped creature's power" (harmonize, CR 702.180a-b): the creature is chosen as the cost is announced (CR 601.2b) and tapped as the total cost
   * is paid (CR 601.2h); the reduction is part of the total cost (CR 601.2f, 118.7a: generic mana only). Capability `feature:alternativeCost.tapReduces`.
   */
  tapReduces?: 'power';
  /**
   * FAST5X E6 INTERFACE CHANGE (additive): "If the [name] cost was paid, exile this card instead of putting it anywhere else any time it would leave the stack"
   * (harmonize, CR 702.180a; the rule flashback has natively, CR 702.34a). Kept in `StackInfo.exileOnLeave` from the announcement; read by core/resolve.ts
   * #leaveStack and effects/handlers/zones-util.ts#exiledLeavingStack. Capability `feature:alternativeCost.exileOnLeave`.
   */
  exileOnLeave?: true;
}

/**
 * FAST5X E2 INTERFACE CHANGE (additive): "You may cast this card from your graveyard using its warp ability" (CR 601.3, 113.6f): the card's own alternative
 * cost named `method` may also be used from `from` (the same cost and the same static abilities, CR 702.185a). Read by actions/cast-options.ts#castOptionsOf
 * (capability `static:castWith`, actions/cast-kinds.ts); a method the card does not have offers nothing.
 */
export interface CastWithDef {
  s: 'castWith';
  method: string;
  from: ZoneName;
}

/** FAST5X E2: what an alternative cost's static ability does to the permanent its spell becomes (CR 702.185a; AlternativeCostDef.delay). */
export interface AltCostDelay {
  when: DelayedWhen;
  do: EffectStep[];
}

/**
 * CMDF INTERFACE CHANGE (additive): an ability that modifies the rules for deck construction (CR 113.6n): it functions before the game begins and does nothing
 * in the game. `canBeCommander`: "~ can be your commander" (CR 903.3a; Commander and Brawl deck checks, packages/cards/src/formats/commander.ts#canBeCommander,
 * read it from the Oracle text). No engine code reads it (capability `static:deckConstruction`, core/commander.ts).
 */
export interface DeckConstructionDef {
  s: 'deckConstruction';
  /**
   * r3-static INTERFACE CHANGE (additive): `anyNumber`, "A deck can have any number of cards named ~", and `upTo` (with `value`), "A deck can have up to seven
   * cards named ~": exceptions to the copy limit of deck construction (CR 100.2a, 113.6n). Like `canBeCommander` they do nothing in a game; packages/cards
   * reads the limit from the Oracle text while it validates a deck (formats/card-rules.ts). The sentence names the card itself (the render gate reads "~").
   */
  rule: 'canBeCommander' | 'anyNumber' | 'upTo';
  /** r3-static: of `upTo`, the most copies a deck may have. */
  value?: number;
}

/** "If this card is in your opening hand, you may begin the game with it on the battlefield." (CR 103.6) */
export interface PregameDef {
  s: 'pregame';
  action: 'beginOnBattlefield' | 'reveal' | 'exileBeforeShuffle';
  optional: boolean;
}
