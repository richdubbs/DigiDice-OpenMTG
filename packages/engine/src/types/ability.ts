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
  /**
   * edh-next-85 INTERFACE CHANGE (additive), CR 107.3a, 106.6 (Consume Spirit: "Spend only black mana on X."): the color of mana that may be spent on the X of the spell's mana cost; each of
   * the X generic mana the announced X adds is a mana of that color (actions/cast.ts, rules/cost.ts#substituteX), the other symbols of the cost are paid as they print. Capability
   * `feature:spell.spendOnlyX`.
   */
  spendOnlyX?: Color;
  /**
   * edh-next-100 INTERFACE CHANGE (additive), CR 702.148a-b (Wash Away, Dig Up, Alchemist's Retrieval): the effect of the spell cast for its cleave cost, the printed text with
   * the words in square brackets removed (`effect` is the text with the brackets taken away and their words kept; `text` keeps the brackets). Read by actions/cast.ts and
   * effects/run.ts when the spell's alternative cost is `cleave`; capability `feature:spell.cleave`.
   */
  cleave?: EffectProgram;
  /**
   * edh-d-98 INTERFACE CHANGE (additive), CR 107.3, 601.2b (Mind Grind: "... X can't be 0."): the smallest X the caster may announce for the X of the spell's mana cost; a cast
   * with no X announced (without paying its mana cost: X is 0, CR 107.3b) is not allowed (Mind Grind ruling 2013-01-24). Only 1 is written. actions/cast.ts; capability
   * `feature:spell.xMin`.
   */
  xMin?: number;
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
   * edh-mana-keywords-2 INTERFACE CHANGE (additive), CR 602.5e: "Activate only as an instant." (Lion's Eye Diamond): the player must follow the timing rules for casting an
   * instant, so they have priority. A mana ability can be activated while a cost is being paid (CR 605.3a), when no one has priority: such an ability is refused then
   * and the automatic payer never uses it (rules/sources.ts leaves it out of the sources, rules/pay.ts refuses a payCost answer naming it); at priority it is activated as any ability is.
   */
  instantSpeed?: boolean;
  /**
   * MX5 INTERFACE CHANGE (additive): "Any player may activate this ability." (CR 602.2: the object says otherwise, so a player other than its controller may
   * activate it; that player controls the ability, CR 602.2a, and pays its costs). The other restrictions are read for the activating player ("but only as a
   * sorcery", "but only during their turn": `onlyIf` with `you`). Capability `feature:activate.anyPlayer` (model/forms.ts); with {T} or {Q} in the cost, or on a
   * mana ability, `feature:activate.anyPlayer.tap` / `.mana`, which nothing registers.
   */
  anyPlayer?: boolean;
  /**
   * edh-c-103 INTERFACE CHANGE (additive), CR 602.2: "Only your opponents may activate this ability." (Detention Vortex): only an opponent of the permanent's controller may activate
   * it (the controller may not); that player controls the ability, CR 602.2a, and pays its costs. The other restrictions are read for the activating player ("and only as a
   * sorcery"). Capability `feature:activate.opponentsOnly` (model/forms.ts); with {T} or {Q} in the cost, on a mana or loyalty ability or with a cost part on the object itself, the
   * forms `.tap` / `.mana` / `.self`, which nothing registers.
   */
  opponentsOnly?: boolean;
  /**
   * edh-d-88 INTERFACE CHANGE (additive), CR 602.2, 602.2a, 506.2 (Capricopian): "Only the player this creature is attacking may activate this ability.": only the PLAYER the source
   * (an attacking creature) is attacking may activate it (never its controller; nobody while it attacks a planeswalker or battle, or is not attacking); that player controls the ability
   * and pays its costs. Capability `feature:activate.attackedPlayerOnly` (model/forms.ts); with {T} or {Q} in the cost, on a mana or loyalty ability, or with a cost part on the object
   * itself, the form `feature:activate.attackedPlayerOnly.form`, which nothing registers.
   */
  attackedPlayerOnly?: boolean;
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
   * edh-next-132 INTERFACE CHANGE (additive), CR 107.3c, 602.2b, 607.2a (Prototype Portal, Soul Foundry: "{X}, {T}: Create a token that's a copy of the exiled card. X is the mana value of that
   * card."): the value of the X of the activation cost that the ability's text defines: no X is announced, X is this number as the ability is activated (actions/activate.ts#definedX). Only
   * the mana value of the one card linked to the source by `link` that is still in exile; with no such card X is undefined and the ability can't be activated (ruling 2011-01-01).
   * Capability `feature:activate.xIs`.
   */
  xIs?: { q: 'stat'; stat: 'manaValue'; of: { ref: 'linked'; link: LinkId } };
  /**
   * std-copy-1 INTERFACE CHANGE (additive): "This ability can't be copied." (CR 707.10, 101.2): the copy op puts no copy of this ability onto the stack
   * (effects/handlers/tokens-copy.ts#copySpells). Capability `feature:activate.uncopiable`.
   */
  uncopiable?: true;
  /**
   * edh-mana-keywords-8 INTERFACE CHANGE (additive), CR 106.6, 602.2b, 118.3 (Throne of Eldraine: "Spend only mana of the chosen color to activate this ability."): the link id of
   * a color the source chose (CR 607.2d); every mana the activation spends must be of that color, so the generic mana of the cost is paid with mana of it (actions/activate.ts#abilityPlan).
   * An ability whose cost has any other colored mana, or whose source has chosen no color, is not offered. Capability `feature:activate.spendOnlyChosen`.
   */
  spendOnlyChosen?: LinkId;
  /**
   * edh-next-85 INTERFACE CHANGE (additive), CR 107.3a, 106.6, 602.2b (Crypt Rats: "{X}: ~ deals X damage to each creature and each player. Spend only black mana on X."): the color
   * of mana that may be spent on the X of this ability's cost; each of the X generic mana the announced X adds is a mana of that color (rules/cost.ts#substituteX, actions/activate.ts#abilityPlan),
   * while the other symbols of the cost are paid as they print. Capability `feature:activate.spendOnlyX` (not for a mana or loyalty ability, or one any player may activate).
   */
  spendOnlyX?: Color;
  /**
   * edh-next-141 INTERFACE CHANGE (additive), CR 609.4b, 106.6, 602.2b (Grell Philosopher, Quicksilver Elemental: "You may spend blue mana as though it were mana of any color to activate those
   * abilities."): mana of this color may pay any colored symbol of this ability's cost (a {C} still needs colorless mana). Written only on an ability a resolved "gains all activated abilities of"
   * effect copies (statics/mods.ts#spendingColorAsAny, from Modification layer 6 `spendColorAsAny`), read by actions/activate.ts#abilityPlan as the solver's `anyColorWith` (edh-next-140).
   */
  spendColorAsAny?: Color;
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
  /**
   * edh-top-9 INTERFACE CHANGE (additive), CR 608.2b: "This ability still resolves if its target becomes illegal." (Gilded Drake): the ability is not removed from the stack when
   * its one target is illegal as it would resolve; its instructions run, those naming the illegal target doing nothing. Only an ability with exactly one target.
   * Capability `feature:trigger.resolvesIfIllegal`.
   */
  resolvesIfIllegal?: true;
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
  /**
   * edh-combat-5 INTERFACE CHANGE (additive), CR 702.11d-f, Odric, Lunarch Marshal ruling 2020-01-24: in a layer 6 `add` of a resolved effect, the creatures gain the keyword's
   * specific variants (the `quality` of "hexproof from blue") that the permanents matching this filter have as the effect is created, a plain one if any of them has it plain.
   * Replaced by the concrete abilities when the effect is created (effects/handlers/lasting.ts#expandVariants); never stored. Capability `feature:keyword.likeAmong`.
   */
  likeAmong?: ObjectFilter;
  /**
   * edh-perms-21 INTERFACE CHANGE (additive), CR 702.16c, 613.1f, Flickering Ward ("Enchanted creature has protection from the chosen color. This effect doesn't remove
   * this Aura."): on a `protection` granted by a static ability, an attachment the protection does not keep from being attached to the permanent that has it. Written
   * `{ref:'grantor'}` (statics/mods.ts#withGrantor turns it into the granting object), read by rules/protection.ts#hasProtectionFrom's attachment check. Capability
   * `feature:keyword.exceptAttached`.
   */
  exceptAttached?: ObjRef;
  /**
   * edh-d-24 INTERFACE CHANGE (additive), CR 702.16c-d, 613.1f, Spectra Ward and Benevolent Blessing rulings: with `exceptAttached`, "This effect doesn't remove Auras (and Equipment you control
   * that are already attached to it)": the other attachments the protection does not keep from STAYING attached, those that are already attached to the permanent that has it and have one of
   * these subtypes; with `yours`, only those the granting object's controller controls. A new attachment is still refused (the attach check passes the attachment already attached to the
   * host only); targeting, damage and blocking never read it. Read by keywords/hooks/protection.ts. Capability `feature:keyword.exceptAttached.kinds`.
   */
  exceptAttachedKinds?: { subtypes: string[]; yours?: true };
  /**
   * edh-mana-keywords-7 INTERFACE CHANGE (additive), CR 702.165a, 702.165c-d: backup's "non-backup abilities of this creature printed below this one": copies of the abilities
   * that follow the keyword line on its face, written by the parser once they are all lowered (parser/parse.ts#fillBackupAbilities) and read by the keyword's expansion
   * (`$below`, keywords/expand.ts) as the abilities the creature that got the counters gains. Only a backup keyword has it.
   */
  below?: AbilityDef[];
  /** Cost parameter (kicker {2}{G}, equip {1}, ward--pay 3 life, flashback, cycling, ...). */
  cost?: CostDef;
  /**
   * edh-perms-24 INTERFACE CHANGE (additive), CR 107.3, 601.2b, Thieving Skydiver: "Kicker {X}. X can't be 0.": the smallest X the caster may announce once the cost of this
   * keyword is paid (1 for "X can't be 0"). On `kicker`: the expansion copies it to the additional cost (`AdditionalCostDef.xMin`), capability `feature:additionalCost.xMin` (on the generated cost). edhn81 (CR 702.62a, 107.3a): on `suspend` with an X amount ("Suspend X--{X}{3}{U}. X can't be 0."), the smallest X chosen as the suspend action is taken (core/special/suspend.ts); capability `feature:keyword.suspend.x`.
   */
  xMin?: number;
  /**
   * edh-next-137 INTERFACE CHANGE (additive), CR 702.153a, 707.9b, 707.10, 306.5b (Ob Nixilis, the Adversary: "Casualty X. The copy isn't legendary and has starting loyalty X."): on
   * `casualty`, the exceptions of the copy its trigger makes (`copyExcept`, the copy step's `except`) and the starting loyalty of that copy (`copyLoyalty`, the copy step's
   * `startingLoyalty`; `$copyExcept` / `$copyLoyalty`, keywords/expand.ts). Capability `op:copy.startingLoyalty` (on the generated copy step).
   */
  copyExcept?: Modification[];
  copyLoyalty?: Quantity;
  /**
   * FAST5 T56 INTERFACE CHANGE (additive): the cost parameter is the mana cost of the card the ability is on, as that card has it: "target instant or sorcery card in your
   * graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost." (CR 702.34a, 118.9). Only on `flashback`, and then without `cost`;
   * read by actions/cast-options.ts#castOptionsOf (the card's own mana cost, an X in it announced as for any alternative cost, CR 107.3a). Capability
   * `feature:keyword.flashback.costIsManaCost` (granted by a layer 6 `add`: actions/cast.ts#withGrantedCosts).
   * Cloud r3-mech (additive): also on `mayhem`, "Each nonland card in your graveyard has mayhem. The mayhem cost is equal to its mana cost." (CR 702.187b, 118.9):
   * the card's own mana cost as its mayhem cost; capability `feature:keyword.mayhem.costIsManaCost`.
   * edh-zones-5 (additive): also on `escape` WITH a `cost` that holds no mana but the rest of the cost, "The escape cost is equal to the card's mana cost plus exile three other
   * cards from your graveyard." (Underworld Breach; CR 702.138a, 118.9): the cost is the object's mana cost plus that rest (keywords/expand.ts).
   */
  costIsManaCost?: true;
  /**
   * edh-d-73 INTERFACE CHANGE (additive), CR 702.143a, 118.9, 107.4 (Dream Devourer: "Each nonland card in your hand without foretell has foretell. Its foretell cost is equal to its mana cost
   * reduced by {2}."): on a granted `foretell` without `cost`, the foretell cost is the card's mana cost with this much generic mana taken off (only generic mana is reduced, never below
   * none, ruling 2021-02-05). The cost is worked out when the card is foretold and kept on the foretold card (`chosen.foretellLess`, core/special/foretell.ts), as the granted keyword is
   * gone once the card has left the hand. Capability `feature:keyword.foretell.costIsManaCostLess`.
   * edh-d-102 (additive), CR 702.94a, 118.9 (Aminatou, Veil Piercer: "Each enchantment card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}."):
   * also on a granted `miracle` without `cost`; the cost is worked out as the card is revealed (triggers/miracle.ts). Capability `feature:keyword.miracle.costIsManaCostLess`.
   */
  costIsManaCostLess?: number;
  /**
   * edh-next-59 INTERFACE CHANGE (additive), CR 702.141a, 107.3, 202.3 (Sliver Gravemother, Graywater's Fixer): "Each Sliver creature card in your graveyard has encore {X}, where X
   * is its mana value": the cost is generic mana equal to the mana value of the object the keyword is on (X is 0 outside the stack, CR 202.3e). Only on `encore`, without `cost`;
   * keywords/expand.ts substitutes it. Capability `feature:keyword.costIsManaValue`.
   */
  costIsManaValue?: true;
  /**
   * edh-next-146 INTERFACE CHANGE (additive), CR 702.21a-b, 107.3, 122.1 (Minthara, Merciless Soul: "Minthara has ward {X}, where X is the number of experience counters you have."):
   * on `ward` whose `cost` is the mana cost {X} alone, the value of that X, a quantity worked out when the ward trigger resolves and the payment is offered, not as it triggers
   * (CR 702.21b). keywords/expand.ts gives the generated pay step the cost {1} paid that many times (one payment). Capability `feature:keyword.ward.costX`.
   */
  costX?: Quantity;
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
  instantSpeed?: boolean; // edh-mana-keywords-2 (CR 602.5e)
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
  | { kind: 'sacrifice'; filter: ObjectFilter; count: Count; self?: boolean; distinctNames?: true; /** std-mana-1 (additive): with count 'any', "Sacrifice one or more artifacts": never fewer (CR 601.2b, 118.3). Capability `cost:sacrifice.atLeast`. */ atLeast?: number; /** edh-next-45 INTERFACE CHANGE (additive), CR 601.2b, 118.3, 701.21a (Soulblast): "Sacrifice all creatures you control": with count 'any', every permanent the filter matches is sacrificed, no number is announced (rules/pay.ts#resolveAnyCounts); none matching is a cost of nothing. Capability `cost:sacrifice.all` */ all?: true; /** edh-next-144 INTERFACE CHANGE (additive), CR 601.2b, 118.3, 107.1a (Baba Lysaga, Night Witch): "Sacrifice up to three permanents": with count 'any', never more than this many (none at all is a cost paid of nothing; the player announces how many as the cost is announced, rules/pay.ts#resolveAnyCounts). Capability `cost:sacrifice.atMost` */ atMost?: number; /** edh-next-106 INTERFACE CHANGE (additive), CR 601.2b, 118.3, 107.1a (Tectonic Split): with count 'any', "Sacrifice half the lands you control, rounded up": half of the permanents the filter matches as the cost is announced, rounded up (rules/pay.ts#resolveAnyCounts); no number is chosen. Capability `cost:sacrifice.half` */ half?: 'up'; /** edh-next-147 INTERFACE CHANGE (additive), CR 118.3, 701.21a, 208.1 (Phyrexian Dreadnought): with count 'any', "sacrifice any number of creatures with total power 12 or greater": as many as the payer chooses, their powers adding up to at least this number (a threshold part, rules/cost-pick.ts); no number is announced. Capability `cost:sacrifice.totalPower` */ totalPower?: number }
  | { kind: 'payLife'; amount: Quantity }
  /**
   * edh-top-15 INTERFACE CHANGE (additive), CR 701.3d, 118.3, 602.2: "Unattach ~" (Sunforger) and "Unattach Toralf's Hammer" in an ability an Equipment grants (`filter: {is: grantor}`): the
   * Equipment (or Aura, Fortification) the part names, a permanent on the battlefield that is attached to something, is unattached as the cost is paid. `self`: the source itself.
   * Nothing moves zones; the cost can't be paid by a permanent that is not attached. Capability `cost:unattach`.
   */
  | { kind: 'unattach'; filter: ObjectFilter; count: Count; self?: boolean }
  /**
   * edh-c-111 INTERFACE CHANGE (additive): `sameName`, "Discard two nonland cards with the same name" (Sphinx of the Chimes; CR 118.3, 701.9a, 201.2): the `count` (a number of two
   * or more) cards chosen all have the same name. Capability `cost:discard.sameName` (rules/cost-pick.ts#findAssignment, mirror of `distinctNames`).
   */
  | { kind: 'discard'; filter?: ObjectFilter; count: Count; random?: boolean; self?: boolean; hand?: boolean; sameName?: true; /** edh-next-90 INTERFACE CHANGE (additive): `distinctNames`, "Discard three cards with different names" (Ormos, Archive Keeper; CR 118.3, 701.9a, 201.2): no two of the cards chosen have the same name. Capability `cost:discard.distinctNames` (rules/cost-pick.ts#findAssignment). */ distinctNames?: true }
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
  /**
   * edh-d-100 INTERFACE CHANGE (additive): `mvTotal`, "Exile any number of historic cards from your graveyard with total mana value 30 or greater" (The Capitoline Triad; CR 118.3, 202.3,
   * 107.3b): with `count: 'any'`, from your graveyard, the player exiles as many cards as they choose whose mana values add up to at least `atLeast` ({X} counts 0 in a graveyard, the
   * ruling of 2024-07-05), a threshold part as `symbolTotal` (rules/cost-pick.ts). Capability `cost:exileFrom.mvTotal`.
   */
  /**
   * edh-d-101 INTERFACE CHANGE (additive), CR 708.9, 406.3, 400.7 (Primordial Mist): `faceUp`, "Exile a face-down permanent you control face up": the words say what moving a face-down
   * permanent to exile always does (it is revealed and exiled face up; a card in exile is face up unless an effect says otherwise). Only on a part from the battlefield whose filter is
   * face down; it changes nothing the engine does (the move makes a new face-up object). Read only by the renderer (render/costs.ts).
   */
  | { kind: 'exileFrom'; zone: ZoneName; filter?: ObjectFilter; count: Count; self?: boolean; orGraveyard?: true; atLeast?: number; link?: LinkId; totalManaValue?: Quantity; symbolTotal?: { color: Color; atLeast: number }; mvTotal?: { atLeast: number };
    /**
     * edh-d-100 INTERFACE CHANGE (additive), CR 118.3, 205.2a, 702.138a (Nethergoyf: "Escape—{2}{B}, Exile any number of other cards from your graveyard with four or more card types among
     * them."): with `count: 'any'`, from your graveyard, the cards chosen have together at least `atLeast` different card types (the union of their card types, never a sum: an artifact
     * creature card counts two, two creature cards count one). A threshold part (rules/cost-pick.ts). Capability `cost:exileFrom.typesAmong`.
     */
    typesAmong?: { atLeast: number }; faceUp?: true }
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
  /**
   * edh-d-54 INTERFACE CHANGE (additive), CR 118.3, 400.3, 401.4 (Void Attendant, Hidden Retreat): "Put a card an opponent owns from exile into that player's graveyard" and "Put a card from
   * your hand on top of your library": the payer chooses `count` cards of `filter` in `from` ('exile': any player's, as the filter says; 'hand': their own) and each goes to
   * `to`: its owner's graveyard, or the top of its owner's library. Capability `cost:moveCards` (rules/cost.ts#toPlanPart, rules/pay-parts.ts).
   */
  | { kind: 'moveCards'; from: 'exile' | 'hand'; filter?: ObjectFilter; count: Count; to: 'graveyard' | 'libraryTop' }
  | { kind: 'reveal'; zone: 'hand'; filter?: ObjectFilter; count: Count; self?: boolean; /** edh-next-117 INTERFACE CHANGE (additive), CR 701.20a, 118.3 (Land Grant): `hand`, "reveal your hand": every card of the hand is revealed, nothing is chosen. Capability `cost:reveal.hand`. */ hand?: true }
  /** edh-mana-keywords-12 (CR 702.24a, 106.4, 118.1; Braid of Fire): "Cumulative upkeep--Add {R}.", a cost that is adding mana to your own pool; only a cumulative upkeep keyword's cost reads it (parser/holes/misc.ts#addManaCost). Capability `cost:addMana`. */
  | { kind: 'addMana'; mana: ManaType[] }
  | { kind: 'mill'; count: Quantity }
  /** edh-c-48 (CR 702.24a, 121.2, 118.3; Psychic Vortex ruling 2008-04-01): "Cumulative upkeep--Draw a card.", drawing cards is the cost (a replaced draw still pays it; a draw from an empty library loses the game as a state-based action); only a cumulative upkeep keyword's cost reads it (parser/holes/misc.ts#drawCost). Capability `cost:draw`. */
  | { kind: 'draw'; count: Quantity }
  | { kind: 'payEnergy'; amount: Quantity }
  /**
   * edh-d-49 INTERFACE CHANGE (additive), CR 706.2, 118.3, 602.2b (Clay Golem): "{6}, Roll a d8: Monstrosity X, where X is the result.": rolling one die of `sides` sides is part of the cost, made as the cost is
   * paid (the roller's own after-roll options apply, edh-d-49 `rollAdjust`/`rollReroll`); its result is kept with the ability on the stack (`CostsPaid.rolled`) and is `{q:'dieResult'}` of the
   * ability's effect. A roll can't be refused, so the cost is always payable. Capability `cost:rollDie`.
   */
  | { kind: 'rollDie'; sides: number }
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
   * edh-cast-14 INTERFACE CHANGE (additive), CR 118.1, 118.3, 119.3, 119.7, 601.2b: "you may have an opponent gain 3 life" as a cost (Invigorate's alternative cost): the
   * player paying the cost chooses one opponent, as the cost is paid, and that opponent gains `amount` life. It can't be paid when no opponent of the payer can gain life
   * (Scryfall ruling 2020-08-07 of Invigorate: an effect that says an opponent can't gain life; a replacement of the life gain does not stop the payment, CR 118.3).
   * Capability `cost:opponentGainsLife`.
   */
  | { kind: 'opponentGainsLife'; amount: Quantity }
  /**
   * edh-d-74 INTERFACE CHANGE (additive), CR 701.13a, 118.3, 702.24a (Thought Lash): "Exile the top card of your library" as a cost, "Cumulative upkeep--Exile the top card of your library." and
   * "Exile the top card of your library: Prevent the next 1 damage ...": the top `count` cards of the payer's library go to exile face up. It can't be paid with fewer cards in the library
   * (Thought Lash ruling 2008-10-01). Capability `cost:exileTop`.
   */
  | { kind: 'exileTop'; count: Quantity }
  /**
   * edh-d-74 INTERFACE CHANGE (additive), CR 705.1-705.2, 118.3, 702.24a (Karplusan Minotaur, ruling 2006-07-15): "Cumulative upkeep--Flip a coin." as a cost: the payer flips one coin as the cost is paid,
   * and calls it when its source watches coin flips ("whenever you win a coin flip"), so the win or loss is seen (core/dice.ts#flipCoin). A coin can always be flipped. Capability `cost:flipCoin`.
   */
  | { kind: 'flipCoin' }
  /**
   * std-combat-5 INTERFACE CHANGE (additive): "Reveal the creature type you chose" (A Killer Among Us; CR 608.2d, 602.2b, 118.3): the controller reveals the value the
   * source's choice `link` holds (a secret choice, `chooseValue.secret`); payable only when the source (as it last existed, if it already left as another part of the
   * same cost) holds one. Capability `cost:revealChosen`.
   * edh-next-135 INTERFACE CHANGE (additive), CR 608.2d, 118.3 (Stalking Leonin: "Reveal the player you chose"; rulings 2017-08-25): `what: 'player'`, the player a secret choice of a
   * player holds (`LinkValue.players`); not payable when no player was chosen (a copy, or a permanent whose choice another player made). Capability `cost:revealChosen.player`.
   */
  | { kind: 'revealChosen'; link: LinkId; what: 'creatureType' | 'player' }
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
  /** edh-next-129 INTERFACE CHANGE (additive, display only), CR 700.2, 111.1 (Outlaws' Merriment): "Create a red and white creature token with those characteristics." over bullets of characteristics: each mode is one token creation, printed back as the shared sentence and the bare characteristics. No rule reads it. */
  tokenChars?: true;
  /** "You may choose the same mode more than once." (CR 700.2d) */
  allowRepeat?: boolean;
  /**
   * edh-next-139 INTERFACE CHANGE (additive), CR 601.2b, 601.4 (Doomsday Confluence): "Choose X." on a spell with {X} in its cost: the number of modes chosen is the X it is cast with
   * (`min` and `max` are `{q:'X'}`; actions/announce.ts#modeLimits offers none up to the largest payable X, actions/cast.ts announces X as that number). Capability `modes.countIsX`.
   */
  countIsX?: true;
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
  /**
   * edh-mana-keywords-2 INTERFACE CHANGE (additive), CR 702.120a: escalate (Collective Resistance): "Pay this cost for each mode chosen beyond the first": this cost is added
   * once for each chosen mode after the first (a mode chosen twice counts twice, CR 700.2d). Set at announcement from the spell's escalate keyword (actions/cast.ts#withModalKeywords),
   * read by actions/announce.ts#modeCosts. Capability `feature:modes.escalate`.
   */
  escalate?: CostDef;
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
  /**
   * edh-players-19 INTERFACE CHANGE (additive), CR 700.2, 603.3c: "you may choose two" (Shadrix Silverquill): the controller chooses exactly zero modes or exactly `max` of them, never
   * a number in between (`min` is 0). Read by actions/announce.ts#chooseModes (capability `feature:modes.mayChoose`).
   */
  mayChoose?: true;
  options: { text: string; program: EffectProgram; cost?: CostDef; label?: string; pawprints?: number }[];
}

export interface TargetSpec {
  /** Referenced as { ref: 'target', id } by steps. */
  id: string;
  kind: 'object' | 'player' | 'objectOrPlayer' | 'anyTarget' | 'spell' | 'ability' | 'stackObject';
  filter?: ObjectFilter;
  /**
   * `dealtCombatDamageBySource` (edh-cast-13 INTERFACE CHANGE, additive; CR 115.1, 510.2, 120.1, 400.7): "target player who was dealt combat damage by ~ this turn" (Hope of
   * Ghirapur): only a player that the source of the ability dealt combat damage to this turn (the `source.id` fact of a damage entry to a player, rules/history.ts#
   * controllerDealtCombatDamageBySourceThisTurn; no source, no player). Capability `feature:target.player.dealtCombatDamageBySource`.
   */
  /**
   * trek-16 INTERFACE CHANGE (additive), CR 115.1, 608.2b, 500.1 (`activePlayer`; Cmdr. Troi, Outgoing Empath): "target opponent whose turn it is": only the player whose turn it is, judged as
   * the targets are chosen and again as the ability resolves (rules/targets.ts, effects/ctx.ts). Capability `feature:target.player.activePlayer`.
   */
  players?: { who: PlayerPred; /** edh-next-86 INTERFACE CHANGE (additive), CR 115.4, 120.1, 608.2b (Needle Drop): "any target that was dealt damage this turn": of an `anyTarget` spec, only a player who was dealt damage this turn (a damage entry to that player in the turn's history, rules/history.ts#playerDealtDamageThisTurn), judged as the targets are chosen (damage history only grows within a turn, so a later recheck cannot differ); the objects are narrowed by the spec's `filter.dealtDamageThisTurn`. Capability `feature:target.player.dealtDamage`. */ dealtDamage?: true; dealtCombatDamageBySource?: true; activePlayer?: true; /** edh-c-34 INTERFACE CHANGE (additive), CR 115.1, 608.2b, 119.3 (Rix Maadi Guildmage): "target player who lost life this turn": only a player who has lost life this turn (`turnStats.lifeLost`, damage included), judged as the targets are chosen and again as the ability resolves (rules/targets.ts, effects/ctx.ts). Capability `feature:target.player.lostLife`. */ lostLife?: true; /** edh-cast-15 INTERFACE CHANGE (additive), CR 115.1, 608.2b (The Lord of Pain): "choose another target player" in a trigger: not the player this reference names (the player who cast the spell: `{ref:'event', role:'player'}`), judged as the targets are chosen and again as the ability resolves (rules/targets.ts, effects/ctx.ts). Capability `feature:target.player.otherThan`. */ otherThan?: PlayerRef };
  /** Number of targets (CR 601.2c: variable counts are announced before the targets). */
  min: Count;
  max: Count;
  /** Prompt text, e.g. "target creature you don't control". Display data. */
  text: string;
  /** "another target ..." / "two other target ...": must differ from these specs' targets (CR 115.3 allows reuse otherwise). */
  distinctFrom?: string[];
  /** The caster announces a division of damage/counters among the targets (CR 601.2d). Every target gets at least 1. */
  divide?: { what: 'damage' | 'counters' | 'other'; total: Quantity; /** edh-perms-22 (CR 601.2d, 603.3d): "distribute up to that many counters": the caster divides any number from one per target up to `total`; capability `feature:target.divide.upTo` */ upTo?: true };
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
   * edh-top-3 INTERFACE CHANGE (additive): "any number of target creature cards that each have a different mana value X or less" (Agadeem's Awakening): no two of the
   * objects chosen for this spec share a mana value (CR 202.3, 115.1, 601.2c). A restriction on the set of targets the text states, checked as the targets are announced
   * and asked again when an answer breaks it; each card's own "mana value X or less" is the spec's filter. Capability `feature:target.differentManaValues`.
   */
  differentManaValues?: boolean;
  /**
   * FAST5 T66 INTERFACE CHANGE (additive): "for each opponent, exile up to one target nonland permanent that player controls" (CR 115.1, 601.2c): at most one target
   * for each opponent, each controlled by that opponent (a restriction on the set the text states, checked as the targets are announced). The spec's `max` is the
   * most targets for EACH opponent (one: so one target in a two-player game) and its filter names a controller ('opponent').
   * trek-13 (additive): or, for a card in a graveyard ("for each opponent, assimilate up to one target creature card from that player's graveyard", Assimilate the Wounded), an
   * owner ('opponent') and `zone: 'graveyard'`: the opponent each target is for is its OWNER (CR 108.3, 404.1: a card in a graveyard has no controller).
   */
  perOpponent?: boolean;
  /**
   * edh-d-96 INTERFACE CHANGE (additive), CR 115.1, 601.2c, 122.1f (Geth's Summons, Corrupted: "For each opponent who has three or more poison counters as you cast this spell, put up to one
   * target creature card from that player's graveyard onto the battlefield under your control."): with `perOpponent`, only the opponents who have at least this many poison counters get a
   * target, judged as the targets are chosen (rules/targets.ts#candidatesFor: "as you cast this spell"); never again at resolution (the target's own words don't say it, CR 608.2b).
   * Capability `feature:target.perOpponent.poison`.
   */
  perOpponentPoison?: number;
  /**
   * r5-fxb INTERFACE CHANGE (additive): "for each player, destroy up to one target creature that player controls" (CR 115.1, 601.2c): as `perOpponent`, for every
   * player (you too): at most `max` targets for EACH player, each controlled by that player; the filter names no controller. Capability `feature:target.perPlayer`.
   */
  perPlayer?: boolean;
  /**
   * edh-next-127 INTERFACE CHANGE (additive), CR 115.1, 601.2c, 404.1 (Mysterious Stranger: "for each graveyard with an instant or sorcery card in it, exile target instant or sorcery card from that
   * graveyard"): with `perPlayer` and `min` = `max` = 1, exactly one target in EACH player's zone (the card's owner, rules/targets.ts#perPlayerKey) that has a legal one as the targets are
   * chosen; a graveyard with none needs none. Capability `feature:target.eachWithOne`.
   */
  eachWithOne?: true;
  /**
   * FAST5 T66 INTERFACE CHANGE (additive): "two target nonland permanents that share a card type" (CR 115.1, 601.2c, 205.2a): the objects chosen for this spec have a
   * card type in common (a restriction on the set the text states, checked as the targets are announced and asked again when an answer breaks it).
   */
  sharedCardType?: boolean;
  /**
   * edh-next-54 INTERFACE CHANGE (additive): with `sharedCardType`, "two target permanents that share a permanent type" (Role Reversal; CR 110.4, 205.2a): the card type the objects
   * have in common must be a permanent type (artifact, battle, creature, enchantment, land, planeswalker; Kindred is not one). Read only inside rules/targets.ts#sharedCardTypeHolds.
   * Capability `feature:target.sharedPermanentType`.
   */
  sharedPermanentType?: true;
  /**
   * CLOUD std-ecl INTERFACE CHANGE (additive): "two target creature cards that share a creature type" (CR 115.1, 601.2c, 205.3m, 702.73a): the objects chosen for
   * this spec have a creature type in common (a changeling has all of them), checked like `sharedCardType`.
   */
  sharedCreatureType?: boolean;
  /**
   * edh-next-126 INTERFACE CHANGE (additive): "Choose any number of target creatures with equal toughness." (V.A.T.S.; CR 115.1, 601.2c, 608.2b, 208.1): the objects chosen for this
   * spec all have the same toughness (a restriction on the set, checked as the targets are announced, rules/targets.ts#equalToughnessHolds). As the spell resolves, if its legal
   * targets of this spec no longer all have the same toughness, none of them is legal (ruling 2024-03-08: it won't resolve; effects/ctx.ts#checkAll). Capability
   * `feature:target.equalToughness`.
   */
  equalToughness?: true;
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
   * edh-d-87 INTERFACE CHANGE (additive), CR 601.7a, 800.4a (Bladegriff Prototype, ruling 2020-11-10): with `chooser`, when the player it names has left the game as the ability is put on the stack,
   * an opponent of the controller makes the choice instead (the controller picks which one when there are several, CR 601.7a). Read by actions/announce-targets.ts#chooserOf. Capability
   * `feature:target.chooserElse`.
   */
  chooserElse?: 'anOpponent';
  /**
   * edh-next-146 INTERFACE CHANGE (additive), CR 601.7, 601.7a, 115.1, 601.2c (Arena: "target creature of an opponent's choice they control"): with `chooser`, the player who chooses
   * picks among the objects they control only. With `{ref:'anOpponent'}` the controller decides which opponent chooses, among those who control a legal candidate (CR 601.7a:
   * "who could make such a choice"); no such opponent: no legal target. Read by actions/announce-targets.ts. Capability `feature:target.chooserControls`.
   */
  chooserControls?: true;
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
  /**
   * edh-zones-24 INTERFACE CHANGE (additive), CR 607.2a, 400.7: `last`, "the last creature card exiled with it" (Duplicant): of the objects the link remembers, in the order they were
   * linked, only the most recent one that matches this filter and is still where it was linked (statics/match.ts, effects/refs.ts). Capability `feature:linked.last`.
   */
  /**
   * edh-perms-21 INTERFACE CHANGE (additive), Faerie Artisans: `except`, "Then exile all OTHER tokens created with ~": the linked objects except those of `except` (the token the same ability
   * just created, bound by name). Capability `feature:ref.linked.except`.
   */
  /**
   * edh-d-96 INTERFACE CHANGE (additive), CR 607.2a, 603.4 (Colfenor's Urn ruling 2007-10-01: "checks how many creatures have been exiled with Colfenor's Urn over the course of the entire game"):
   * `ever`, every object the link has remembered on this object, wherever it is now (one that left exile since is counted too); only counted ("three or more cards have been exiled with ~"),
   * never acted on. Capability `feature:ref.linked.ever` (a resolved effect only).
   */
  | { ref: 'linked'; link: LinkId; last?: ObjectFilter; except?: ObjRef; ever?: true } // CR 607.2a, 607.2c: objects the linked ability exiled/created/put onto the battlefield
  | { ref: 'each'; filter: ObjectFilter } // "each creature", "all creatures you control"
  | { ref: 'subject' } // inside a continuous effect: the object currently being modified ("its mana value")
  /**
   * std-rg INTERFACE CHANGE (additive): `allButBottom`, "all but the bottom card of each opponent's library" (Jace, Reality Sculptor; CR 401.1, 401.2): every card of the
   * library except the bottom N (N = the field; only 1 is read by the parser), in order, top first, for each player the reference names. `count` is 0 then and is
   * not read (effects/refs.ts#resolveObjs).
   */
  | { ref: 'topCards'; player: PlayerRef; count: Quantity; /** edh-c-73 (CR 404.1, 401.2; Soldevi Digger): `graveyard`, "the top card of your graveyard" (the card put there last); read by effects/refs.ts and statics/match.ts */ zone?: 'library' | 'graveyard'; allButBottom?: number; /** edh-next-43 (CR 404.1; Phyrexian Furnace): `bottom`, "the bottom card of target player's graveyard" (the card put there first); edh-next-123 (CR 401.1; Arvinox, the Mind Flail): also a library's bottom card (count 1; a static ability's read fails closed); read by effects/refs.ts and statics/match.ts */ fromBottom?: true; /** edhn78 (CR 404.1, 401.2; Shallow Grave): `matching`, "the top creature card of your graveyard": the card put there last among those that fit (a graveyard, one card); read by effects/refs.ts, statics/match.ts fails closed */ matching?: ObjectFilter } // ordered, top first
  | { ref: 'union'; of: ObjRef[] }
  /**
   * edh-top-2 INTERFACE CHANGE (additive), CR 702.95b-d: "each of those creatures" / "both creatures" of a soulbond ability: the source creature and the creature it is
   * paired with (both, or nothing while it is unpaired). Read from `GameObject.pairedWith` (statics/match.ts, effects/refs.ts). Capability `ref:pair`, `sref:pair`.
   * `both`: only the wording ("both creatures have ..." instead of "each of those creatures has ..."); the same two creatures.
   */
  | { ref: 'pair'; both?: true }
  /**
   * FAST3 T18 ADDITION: the permanents sacrificed to pay a cost of THIS spell or ability ("the sacrificed creature": an activation cost, CR 602.2b, or an
   * additional cost of a spell, CR 601.2b, 601.2h; `CostsPaid.sacrificed`). They have left the battlefield, so every read is last known information
   * (CR 608.2h, 113.7a): "the sacrificed creature's power" is its power as it last existed on the battlefield. Nothing for a spell or ability that sacrificed
   * nothing as a cost (a triggered ability, a copy), so the parser writes it only where the ability's own cost sacrifices (parser/lower/ability.ts).
   */
  /** trek-21 INTERFACE CHANGE (additive), CR 400.7j, 602.2b; The Guardian of Forever: `card`, "that card" for the CARD the sacrificed nontoken permanent became in its owner's graveyard (`CostsPaid.costObjects`): an effect can find the new object a cost moved. Capability `ref:costSacrificed.card`. */
  | { ref: 'costSacrificed'; card?: true }
  /**
   * edh-mana-keywords-8 ADDITION, CR 702.51a, 702.51c: the creatures tapped to convoke THIS spell as it was cast ("each creature that convoked this spell", Lethal Scheme; `CostsPaid.convoked`).
   * They are still on the battlefield unless they left since, when a read is their last known information (CR 608.2h; Lethal Scheme's ruling: a creature that left still connives). A copy
   * of the spell was never cast, so no creature convoked it. Written only inside a spell.
   */
  | { ref: 'convokers' }
  /**
   * T35 ADDITION: the permanents tapped to pay a `tapUntapped` cost of THIS activated ability ("the tapped creature": station, CR 702.184a: "put charge counters on
   * this permanent equal to the tapped creature's power"; `CostsPaid.tapped`). They are still on the battlefield, so a read is their current characteristics
   * (their last known information when they have left, CR 608.2h). Nothing for an ability whose cost taps nothing but its source.
   */
  | { ref: 'costTapped' }
  /**
   * edh-next-141 ADDITION, CR 701.3d, 118.3, 602.2b: the permanent an `unattach` cost of THIS activated ability unattached from something ("Unattach an Equipment from ~: He deals damage equal to that
   * Equipment's mana value ...", Captain America, First Avenger; `CostsPaid.unattached`). It stays on the battlefield, so a read is its current characteristics (its last known information once it
   * left, CR 608.2h). Only in an activated ability whose cost unattaches another permanent than the source (model/lint-card.ts).
   */
  | { ref: 'costUnattached' }
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
  /**
   * edh-d-5 INTERFACE CHANGE (additive), CR 109.4, 115.1, 608.2h; Acorn Catapult: `orPlayer`, "that permanent's controller or that player":
   * with an `object` that is a `target` of a spell or ability that may choose a player as well as a permanent ("any target"), the chosen permanent's
   * controller, or the chosen player. Without a player chosen it is the controller alone, as before. Capability `feature:ref.controllerOf.orPlayer`.
   */
  | { ref: 'controllerOf'; object: ObjRef; orPlayer?: true }
  | { ref: 'ownerOf'; object: ObjRef }
  | { ref: 'anOpponent' } // "an opponent": the controller picks one in multiplayer (CR 601.7a)
  /**
   * simultaneous / APNAP (CR 608.2e-f). edh-next-134 INTERFACE CHANGE (additive), CR 102.1, 608.2c; Oft-Nabbed Goat: `than`, with 'otherPlayer' only, "its owner draws that many
   * cards and each other player loses that much life": the players other than the ones `than` names (the player the sentence named before), instead of other than the controller.
   * Capability `feature:each.otherPlayer.than` (a resolved step only).
   */
  | { ref: 'each'; who: 'player' | 'opponent' | 'otherPlayer'; than?: PlayerRef }
  | { ref: 'event'; role: EventRole }
  | { ref: 'bound'; name: Name }
  | { ref: 'linked'; link: LinkId } // "the chosen player", "the player you chose" (CR 607.2d)
  | { ref: 'active' } // CR 102.1
  /**
   * edh-next-146 INTERFACE CHANGE (additive), CR 601.2a, 611.2c, 707.10 (Hellish Rebuke: "permanents your opponents control gain "When this permanent deals damage to the player who cast
   * Hellish Rebuke, ...""): inside an ability that a spell's resolved effect grants (layer 6 `add`), the player who cast that spell. effects/handlers/lasting.ts#fixGrantCaster writes it as
   * `{ref:'fixed'}` with that player as the effect is created, or with nobody when the resolving spell is a copy that was not cast (ruling 2021-07-23). Anywhere else nothing registers it.
   * Capability `feature:ref.grantCaster`.
   */
  | { ref: 'grantCaster' }
  /** edh-top-14 INTERFACE CHANGE (additive), CR 608.2c, 303.4: `than`, "another one of your opponents chosen at random" (Maddening Hex): the random pick is among the opponents other than the players `than` names (only `enchantedPlayer`, the player the source Aura is attached to). Capability `ref:randomOpponent.than`. */
  | { ref: 'randomOpponent'; than?: PlayerRef } // trek-17: "a random opponent" (Alexander, Ship's Fool): the game picks one opponent with its random number generator as the step resolves (CR 608.2c; the rules have no term for the pick, the Oracle word is "random")
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
  /**
   * edhd63 INTERFACE CHANGE (additive), CR 101.4, 607.2d (Aminatou, the Fateshifter; Pramikon, Sky Rampart): `chosen`, "the next player in the chosen direction": the side is the one a
   * `chooseValue` / `enters.choose` with `what: 'option'` and options `left`, `right` chose for the link `chosen` (this resolution's choice, else the source's link); `side` is then 'left' and unread.
   * No choice, or a value that is neither: nobody. Read where a step or a static ability reads it (effects/refs.ts, statics/match.ts); a target, a trigger's filter or a condition reads nobody
   * (fail closed). Capability `ref:seat.chosen`.
   */
  /**
   * edhd63 (cont.): `inverse` (only with `chosen`), "the player whose next player in the chosen direction is `of`" (each player gains control of what the next player in that direction controls: the object of
   * the player `of` goes to the player on the OTHER side of `of`): the neighbour on the opposite side. Capability `ref:seat.chosen`.
   */
  | { ref: 'seat'; side: 'left' | 'right'; of?: PlayerRef; chosen?: LinkId; inverse?: true }
  /**
   * C6 INTERFACE CHANGE (additive): "each player who controls the most creatures" (`fewest`: "the fewest"): the players still in the game who control a number of
   * permanents matching `filter` that no other player exceeds (or, with `fewest`, goes below): every player tied for the most is one of them, and when no player
   * controls any, every player is (CR 109.4: a permanent's controller; CR 101.4: in APNAP order; CR 608.2h: counted as the instruction is performed). Steps only
   * (effects/refs.ts); capability `feature:player.controlsMost`.
   */
  /** edh-d-46 INTERFACE CHANGE (additive; CR 109.4, 101.4; Scholarship Sponsor): `below`, "each player who controls fewer lands than the player who controls the most lands": the players whose number is less than the largest number any player controls. (A static ability reads it as nobody: `feature:player.controlsMost.static`.) */
  | { ref: 'controlsMost'; filter: ObjectFilter; fewest?: true; below?: true }
  /**
   * edh-perms-13 INTERFACE CHANGE (additive; CR 109.4, 101.4, 608.2h): "each player who controls an artifact or enchantment" (Fade from History): the players still in the game
   * who control at least one permanent matching `filter` as the instruction is performed, in APNAP order (a phased-out permanent counts as not existing, CR 702.26b).
   * Steps only (effects/refs.ts); a static or a rule effect reads it as nobody (capability `feature:player.controlsMost.static`).
   */
  | { ref: 'controlsAny'; filter: ObjectFilter; /** edh-players-15 INTERFACE CHANGE (additive; CR 102.2, 109.4): only the controller's opponents who control one ("an opponent who controls an artifact named X", the actor of a trigger's event; effects/refs.ts, triggers/filters.ts). */ opponents?: true; /** edh-d-88 INTERFACE CHANGE (additive; CR 109.4, 508.1b; Owlbear Cub): the players who control at least this many permanents that match (two or more), "a player who controls eight or more lands" (triggers/filters.ts, effects/refs.ts). Capability `feature:ref.controlsAny.atLeast`. */ atLeast?: number; /** edh-d-4 INTERFACE CHANGE (additive; CR 109.4, 101.4, 608.2h): the players (with `opponents`, only the controller's opponents) who control NO permanent that matches, "each opponent who doesn't control an Elf" (Thornbow Archer; effects/refs.ts, triggers/filters.ts, judged as the instruction is performed). */ none?: true }
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
   * edh-d-10 INTERFACE CHANGE (additive; CR 725.1, 725.2, 110.2b): "the monarch" (Archivist of Gondor, Azure Fleet Admiral, Fealty to the Realm): the player who has the monarch designation as it is read (a
   * static or a condition reads it now, a step as it resolves); nobody when there is no monarch (CR 725.2: there is at most one). Capability `ref:monarch`.
   */
  | { ref: 'monarch' }
  /**
   * edh-next-82 INTERFACE CHANGE (additive; CR 726.1, 726.2, 110.2b): "the player who has the initiative" (Loot Dispute, Undercellar Sweep): the player who has the initiative designation as it is read (a trigger's
   * defender is the player who has it as the attackers are declared); nobody when no player has it (CR 726.1: at most one). Capability `ref:initiative`.
   */
  | { ref: 'initiative' }
  /**
   * std-rx30 INTERFACE CHANGE (additive; CR 608.2c): "the other player" of two players a step names, "Two target players each reveal the top card of their library. They
   * each lose life equal to the mana value of the card revealed by the other player." (Parker Luck): the players of `of` other than the ones `than` stands for (in APNAP
   * order). Steps only (effects/refs.ts); capability `ref:otherOf`.
   */
  | { ref: 'otherOf'; of: PlayerRef; than: PlayerRef }
  /**
   * edh-players-13 INTERFACE CHANGE (additive; CR 608.2d, 101.4): "each player who chose fame" (Seize the Spotlight, Master of Ceremonies): the players, in APNAP
   * order, whose own choice for the `chooseValue` step with this `link` was `value` (a listed option; `LinkValue.byPlayer`, kept for the resolution only (`cx.choices`);
   * Nobody when the link has no choices by player. Steps only (effects/refs.ts); capability `ref:chose`.
   */
  | { ref: 'chose'; link: LinkId; value: string }
  /**
   * edh-next-120 INTERFACE CHANGE (additive; CR 608.2d, 101.4): "each player who chose that number" after "the highest number", "each player who didn't choose the lowest number"
   * (Wheel of Misfortune): the players, in APNAP order and still in the game, whose own number for the `chooseValue` step (`what: 'number'`) with this `link` was the highest
   * (`extreme: 'highest'`) or the lowest (`'lowest'`) number chosen by any player of it; with `not`, the other choosers of that step (a player who chose nothing is never one).
   * Nobody when the link has no numbers by player. Steps only (effects/refs.ts); capability `ref:choseNumber`.
   */
  | { ref: 'choseNumber'; link: LinkId; extreme: 'highest' | 'lowest'; not?: true }
  /**
   * edh-players-17 INTERFACE CHANGE (additive; CR 506.3, 508.1, 608.2c, 101.4): "each player this creature attacked this turn" (Angel of Destiny): the players still in the
   * game, in APNAP order, whom the SOURCE creature attacked in a declare attackers step of this turn (an `attacks` entry of the game history whose subject is the source and
   * whose defender is the player themselves: a planeswalker or a battle it attacked does not make its controller or protector a player it attacked; a creature put onto
   * the battlefield attacking never attacked, CR 508.4). The source is read by its id, so it still counts once it has left the battlefield (CR 400.7, 608.2h). Steps
   * only (effects/refs.ts); a static reads it as nobody (capability `ref:attackedBySource`, `feature:player.controlsMost.static`'s kin: never advertised for a static).
   */
  | { ref: 'attackedBySource' }
  /**
   * edh-combat-6 INTERFACE CHANGE (additive; CR 506.2, 506.3, 508.1b, 101.4; Norn's Decree): "players being attacked": the players still in the game, in APNAP order, that a creature
   * now in combat attacks (a player attacked, never the controller of a planeswalker or the protector of a battle that is attacked, CR 506.3), as the condition or instruction is
   * read. Steps and conditions only (effects/refs.ts); a static reads it as nobody (capability `ref:attacked`, `feature:player.controlsMost.static`'s kin: never advertised for a static).
   */
  | { ref: 'attacked'; by?: 'you'; andYou?: true }
  /**
   * edh-players-17 INTERFACE CHANGE (additive; CR 701.38a, 701.38d, 608.2c, 608.2f): the voters of "for each money vote" (Expropriate): the players who cast a vote for the choice
   * `votes` names (`{q:'votes'}`, whose `step` is the vote step and `choice` the word) in that vote, one entry per vote cast, in the order the votes were cast (a player with an
   * additional vote is listed once for each). A player who has left the game is not listed (CR 800.4a). Steps only (effects/refs.ts); a vote resolved by hand has no ballots, and
   * nobody is listed. Capability `ref:votedFor`.
   */
  | { ref: 'votedFor'; votes: Extract<Quantity, { q: 'votes' }> }
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
  /**
   * edh-d-86 INTERFACE CHANGE (additive; CR 120.1, 510.2, 608.2c; Gollum, Obsessed Stalker): `scope: 'game'`, "each opponent dealt combat damage this game by a creature named X":
   * the whole game's history (rules/history.ts#historyInScope). A `damage` pattern counts only entries that dealt damage (an amount of 1 or more, CR 120.8).
   */
  | { ref: 'eachWho'; who: 'opponent' | 'player'; did: EventPattern; scope: 'turn' | 'attacking' | 'game' }
  /**
   * edh-next-72 INTERFACE CHANGE (additive; CR 119.1, 104.3b, 101.4, 608.2h; Triskaidekaphobia): "each player with exactly 13 life": the players of `who` (every player, or the controller's opponents) still in
   * the game whose life total compares with the fixed number `n` by `op` (`==` for "exactly"), judged once as the instruction is performed, in APNAP order (so all of them lose the game together,
   * CR 104.4a). Steps only (effects/refs.ts); a static or a rule effect reads it as nobody (capability `ref:withLife`).
   */
  | { ref: 'withLife'; who: 'opponent' | 'player'; op: Cmp; n: number }
  /**
   * edh-d-85 INTERFACE CHANGE (additive; CR 119.1, 102.3, 508.1d; Galactus, Devourer of Worlds): "an opponent with the most life among your opponents": the controller's opponents still in the game
   * whose life total no other opponent exceeds (every one tied for the most), read as it is now (a static requirement: as attackers are declared; a step: as it is performed), in APNAP order.
   * Capability `ref:mostLife` (effects/refs.ts, statics/match.ts).
   */
  | { ref: 'mostLife'; who: 'opponent' };

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
  controlsAny: true, // edh-perms-13
  voters: true, // M12F
  monarch: true, // edh-d-10
  initiative: true, // edh-next-82
  choseNumber: true, // edh-next-120
  enchantedPlayer: true, // std-rr
  otherOf: true, // std-rx30
  eachWho: true, // std-combat-1
  chose: true, // edh-players-13
  attackedBySource: true, // edh-players-17
  attacked: true, // edh-combat-6
  votedFor: true, // edh-players-17
  randomOpponent: true, // trek-17
  withLife: true, // edh-next-72
  mostLife: true, // edh-d-85
  grantCaster: true, // edh-next-146
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
  /** edh-players-22 INTERFACE CHANGE (additive), CR 109.5: of a `destroy` action, the controller of the spell or ability that destroyed the permanent ("that opponent"). */
  | 'by'
  | 'newObject' // the token or object created/produced by the event
  /**
   * edh-perms-21 INTERFACE CHANGE (additive), CR 115.9c, 608.2h, Vesuvan Duplimancy rulings 2022-09-09: of a `cast` event whose spell "targets only a single X", the one object
   * the spell targeted as it was cast (fixed with the event: a target that has left since is read as it last existed, the spell's original target if it was changed later).
   */
  | 'spellTarget'
  /**
   * edhn102 INTERFACE CHANGE (additive), CR 113.7a, 608.2h, 714.2e (Narci, Fable Singer: "where X is that Saga's mana value"): of a `resolves` event of an ability, the source object the
   * ability came from, as it last existed (the Saga whose final chapter ability resolved). Exposed (silentRole) only by "the final chapter ability of a Saga you control resolves".
   */
  | 'abilitySource';

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
  /** edh-d-51 INTERFACE CHANGE (additive), CR 105.2: `false`, "creatures that aren't all colors" (Iridian Maelstrom): the object has fewer than all five colors; `true` has no wording (nothing prints it). Read on the characteristics (`Chars.colors`). */
  allColors?: boolean;
  /** edh-d-86 INTERFACE CHANGE (additive), CR 205.2a, 300.1: "a card with two or more card types" (Rendmaw, Creaking Nest): the object has at least this many card types (`Chars.types`, an artifact creature has two). Capability `filter:minCardTypes`. */
  minCardTypes?: number;
  name?: string;
  notName?: string;
  /**
   * r5-static INTERFACE CHANGE (additive), CR 201.2a, 708.2a: `true`, an object that has no name ("creatures that don't have a name": a face-down permanent, a
   * token whose copiable values give it none); `false`, one that has a name. Read on the object's characteristics (`Chars.names` empty).
   */
  nameless?: boolean;
  manaValue?: NumberCmp;
  /** edh-cast-4 INTERFACE CHANGE (additive), CR 202.3: "with an even / odd mana value" (zero is even); read on the same mana value as `manaValue`. */
  manaValueParity?: 'even' | 'odd';
  /**
   * edh-cast-12 INTERFACE CHANGE (additive), CR 202.3, 404.1, 608.2b (Drown in the Loch): "with mana value less than or equal to the number of cards in its controller's graveyard":
   * the object's own mana value (op) the number of cards in the graveyard of ITS controller (or, with `of: 'owner'`, its owner), read each time the filter is: as the target is
   * chosen and again as the spell resolves. A quantity that names the candidate cannot be a `NumberCmp` value, which is read once for the whole filter.
   */
  manaValueVsGraveyard?: { op: Cmp; of: 'controller' | 'owner' };
  /**
   * edh-next-32 INTERFACE CHANGE (additive), CR 201.2, 404.1: "a creature spell with the same name as a card in their graveyard" (Dragonlord Kolaghan): the object has the same
   * name as at least one card in its controller's (`of: 'controller'`) or owner's graveyard; it is never its own match (a spell on the stack is in no graveyard). Capability
   * `filter:nameInGraveyard` (rules/filter.ts; a static ability does not read it).
   */
  nameInGraveyard?: { of: 'controller' | 'owner' };
  power?: NumberCmp;
  toughness?: NumberCmp;
  keyword?: string | string[]; // has any of these keyword abilities
  notKeyword?: string | string[];
  /** Has an ability of a kind: "an activated ability", "a mana ability", "a triggered ability". */
  hasAbility?: 'activated' | 'mana' | 'triggered' | 'static';
  /**
   * edh-perms-8 INTERFACE CHANGE (additive), CR 602.1, 107.5: with `hasAbility: 'activated'`, "an activated ability with {T} in its cost" (Magewright's Stone): the object has an
   * activated ability (a mana ability too, CR 605.1a) whose cost has {T}, its own tap symbol. A basic land type gives such an ability (CR 305.6); an ability whose cost is not known
   * (a manual one, a keyword with no tabulated cost) makes the answer "cannot be determined" when none matched. Capability `filter:abilityTapCost`.
   */
  abilityTapCost?: true;
  /**
   * edh-c-44 INTERFACE CHANGE (additive), CR 602.1, 605.1a, 113.3b (Ravager Wurm): with `hasAbility: 'activated'`, "an activated ability that isn't a mana ability": the object has an
   * activated ability that is not a mana ability (CR 605.1a: a basic land type's {T}: Add is one). An ability whose kind is not known (a manual activated line, a keyword with no
   * tabulated kind, a Class level) makes the answer "cannot be determined" when none matched, so `not` never turns it into "true". Read by rules/filter.ts; a static ability does not
   * read it (statics/match.ts), so it stays manual there. Capability `filter:abilityNotMana`.
   */
  abilityNotMana?: true;

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
  /** edhd60 (CR 707.10, 707.12, 601.2a; Errant, Street Artist): a spell on the stack that was not cast (a copy put on the stack, never a copy of a card that is cast). Read from `StackInfo.castOrdinal` (absent). Capability `filter:uncast`. */
  uncast?: true;
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
   * edh-d-75 INTERFACE CHANGE (additive), CR 508.1d, 506.4, 603.4 (Firkraag, Cunning Instigator; ruling 2022-06-10): the creature "had to attack this combat": when it was declared as an attacker, an attack
   * requirement applied to it (goad, "attacks each combat if able", "attacks this turn if able"; never a requirement on its controller's whole group, Trove of Temptation). `true` only; read from
   * `CombatState.forced` (written by core/combat.ts#declareAttackers), so it holds for a creature that has left combat or the battlefield since (rules/filter.ts). A creature put onto the
   * battlefield attacking was never declared. Capability `filter:hadToAttack`.
   */
  hadToAttack?: true;
  /**
   * Standard round 4, r4-trig INTERFACE CHANGE (additive), CR 208.1: "a creature you control with toughness greater than its power" (Fecund Greenshell): the
   * object's own toughness is greater than its own power, both as its characteristics are now (or as it last existed). `true` only (rules/filter.ts; static
   * abilities do not read it, statics/match.ts, so a static ability that says it stays manual).
   */
  toughnessGreaterThanPower?: true;
  /**
   * edh-c-20 INTERFACE CHANGE (additive), CR 208.1: "target non-Elf creature whose power and toughness aren't equal" (Gilt-Leaf Winnower): the object's own power and
   * toughness, as its characteristics are now (or as it last existed), are two different numbers; an object without both never matches. `true` only (rules/filter.ts; a
   * static ability reads it too, statics/match.ts).
   */
  powerNotEqualToughness?: true;
  /**
   * edh-next-32 INTERFACE CHANGE (additive), CR 208.1: "a creature you control with power equal to its toughness" (Symmetry Matrix): the object's own power and toughness,
   * as its characteristics are now (or as it last existed), are the same number; an object without both never matches. `true` only (rules/filter.ts; a static ability reads it
   * too, statics/match.ts). Capability `filter:powerEqualsToughness`.
   */
  powerEqualsToughness?: true;
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
   * edh-d-93 INTERFACE CHANGE (additive), CR 208.1, 613.4, 603.10a, 608.2h (Jason Bright, Glowing Prophet: "Whenever a Zombie or Mutant you control dies, if its power was different from its base
   * power, draw a card."): the object's power is not its base power (after layer 7b: printed, or as a characteristic-defining ability or an effect that sets it made it). A permanent on the
   * battlefield is read now; one that left the battlefield is read from its last known information (`LastKnown.basePower`, recorded as it left in a game whose definitions ask, core/zones.ts).
   * `true` only. Read by rules/filter.ts; static abilities do not read it (statics/match.ts). Capability `filter:powerDiffersFromBase`.
   */
  powerDiffersFromBase?: true;
  /**
   * edh-perms-11 INTERFACE CHANGE (additive), CR 208.1, 613.4a-b: "a creature you control with base power or toughness 1" (Sword of the Squeak): either the object's base power
   * or its base toughness (its value after layer 7b: printed, or as a characteristic-defining ability or an effect that sets it made it, before the modifications and counters of
   * 7c) meets the one comparison. A permanent on the battlefield only (the base of an object that left is not recorded: it is unevaluable and never matches). Read by
   * rules/filter.ts and, in a static ability, by statics/match.ts from the layer system's own snapshot of the base values. Capability `filter:basePowerOrToughness`.
   */
  basePowerOrToughness?: NumberCmp;
  /**
   * edh-next-23 INTERFACE CHANGE (additive), CR 208.1, 613.4a-b: "another creature you control with base power 1" (Rapid Augmenter): the object's base power (its value after layer 7b, before
   * the modifications and counters of 7c) meets the comparison. As `basePowerOrToughness`, a permanent on the battlefield only; read by rules/filter.ts and, in a static ability, by statics/match.ts.
   */
  basePower?: NumberCmp;
  /**
   * edh-next-19 INTERFACE CHANGE (additive), CR 208.1, 613.4b: "a creature you control with base power and toughness 2/2" (Duskana, the Rage Mother): both the object's base
   * power and its base toughness (after layer 7b, before 7c) equal the numbers. Same reading rules as `basePowerOrToughness`. Capability `filter:basePowerAndToughness`.
   */
  basePowerAndToughness?: { power: number; toughness: number };
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
  /**
   * edh-d-100 INTERFACE CHANGE (additive), CR 400.7, 603.7c (Havengul Lich: "You may cast target creature card in a graveyard this turn. When you cast it this turn, ..."): is the object a spell
   * on the stack one of these objects became by ONE move, its cast (their last-known `newId`, CR 400.7h): "it" of a delayed trigger that waits for the card it names to be cast (the spell is
   * a new object, CR 400.7); a card that moved again before it was cast is not followed. Read by rules/filter.ts; capability `filter:sameCardAs`.
   */
  sameCardAs?: ObjRef;
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
   * edh-d-24 INTERFACE CHANGE (additive), CR 303.4a, 702.5a, 303.4g (Sovereigns of Lost Alara, Auratouched Mage: "an Aura card that could enchant that creature"): an Aura (card, token or permanent,
   * in any zone) whose enchant restriction accepts the one permanent this names (the enchant filter and protection, `rules/attachment.ts#auraCanEnchantObject`); nothing else matches, an Aura
   * whose restriction the engine does not understand included. Evaluated by rules/filter.ts only (a static ability's filter never matches it). Capability `filter:couldEnchant`.
   */
  couldEnchant?: ObjRef;
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
   * edh-perms-16 INTERFACE CHANGE (additive; CR 301.5, 303.4, 205.3h): with `attachedWith`, the attachment must be another permanent than the source of the filter ("Enchant
   * creature with another Aura attached to it": the Aura itself does not count once it is attached). rules/filter.ts and statics/match.ts read it.
   */
  attachedWithOther?: true;
  /**
   * edh-next-23 INTERFACE CHANGE (additive; CR 301.5, 303.4, 205.4a): with `attachedWith`, the attachment must also be legendary ("a creature you control with a legendary Equipment attached to it",
   * Kassandra, Eagle Bearer). rules/filter.ts and statics/match.ts read it.
   */
  attachedWithLegendary?: true;
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
  /**
   * edh-players-7 INTERFACE CHANGE (additive), CR 121.1, 400.7: "cards in your hand drawn this turn" (Sylvan Library): the object is a card in its owner's hand that its owner drew this turn
   * (`PlayerState.turnStats.drawn`, written as the card is drawn; a card that left the hand and came back is another object). Only `true` has a wording. Capability `filter:drawnThisTurn`.
   */
  drawnThisTurn?: true;
  /** "that was dealt damage this turn" (Death-Rattle Oni, Swift Demise, Restore the Peace). */
  dealtDamageThisTurn?: boolean;
  /** edh-next-139 INTERFACE CHANGE (additive), CR 701.14a, 400.7 (Boxing Ring): "a creature that fought this turn": this object fought this turn (a `fight` action in `GameState.history`, by any effect). Capability `filter:foughtThisTurn`. */
  foughtThisTurn?: true;
  /**
   * edh-d-38 INTERFACE CHANGE (additive), CR 120.10, 603.4 (Maarika, Brutal Gladiator): "that creature was dealt excess damage this turn": this object was dealt excess damage
   * (damage beyond lethal damage, CR 120.10) at least once this turn, read from the `excess` fact of the damage entries of `GameState.history` (an amount of 0 is no
   * event, CR 120.8). Only `true` has a wording. Capability `filter:dealtExcessDamageThisTurn`.
   */
  dealtExcessDamageThisTurn?: true;
  /**
   * FAST3 T14 (INTERFACE CHANGE): "dealt damage by ~ this turn" (Sengir Vampire): this object was dealt damage this turn by the source of the ability (the
   * object itself, CR 400.7: not an earlier or later object it was). Read from `GameState.history` like `dealtDamageThisTurn`.
   */
  dealtDamageBySourceThisTurn?: boolean;
  /**
   * edh-c-113 INTERFACE CHANGE (additive), CR 120.1, 301.5, 400.7 (Unscythe, Killer of Kings): "a creature dealt damage by equipped creature this turn": this object was dealt damage this turn by the permanent
   * the ability's source is attached to (read as the filter is checked; the damage entry's source as it was when it dealt the damage). With no host there is no such damage. Only `true` has a wording.
   * Capability `filter:dealtDamageByAttachedThisTurn`.
   */
  dealtDamageByAttachedThisTurn?: true;
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
   * edh-next-109 INTERFACE CHANGE (additive), CR 110.2, 400.7 (Shaile, Dean of Radiance): the permanent entered the battlefield this turn under the control of the
   * filter's `you` ("each creature that entered the battlefield under your control this turn"); read from the `enteredController` fact of its zoneChange history entry.
   * Used with `enteredThisTurn: true`. Capability `filter:enteredUnderYourControl`.
   */
  enteredUnderYourControl?: boolean;
  /**
   * std-mkm INTERFACE CHANGE (additive): "that dealt damage this turn" (Treacherous Greed): this object dealt damage this turn, as this object (CR 120.1, 400.7: the
   * `source.id` of a damage entry of `GameState.history`; an amount of 0 is no event, CR 614.7a). Capability `filter:dealtDamageAsSourceThisTurn`.
   */
  dealtDamageAsSourceThisTurn?: boolean;
  /**
   * edh-players-9 INTERFACE CHANGE (additive), CR 120.1, 510.2, 400.7: "creature that dealt combat damage to you this turn" (Witch-king of Angmar), "that dealt damage to you
   * this turn": this object, as this object, dealt that damage to the player "you" stands for (the controller of the ability or source the filter is read for): a `damage`
   * entry of `GameState.history` to that player (`recipientPlayer`) with this object as its `source.id`; `'combat'` only combat damage. An amount of 0 is no event
   * (CR 120.8). Only the two forms have a wording. Capability `filter:dealtDamageToYouThisTurn`.
   */
  dealtDamageToYouThisTurn?: 'any' | 'combat';
  /**
   * edh-c-48 INTERFACE CHANGE (additive), CR 120.1, 400.7 (Kumano Faces Kakkazan: "a creature dealt damage this turn by a source you controlled"): this object was dealt damage this turn by a
   * source that its controller (the player "you" stands for: the controller of the ability or source the filter is read for) controlled when it dealt the damage (a `damage` entry of
   * `GameState.history` with `source.controller`; an amount of 0 is no event, CR 614.7a). Only `true` has a wording. Capability `filter:dealtDamageByYourSourceThisTurn`.
   */
  dealtDamageByYourSourceThisTurn?: true;
  /**
   * edh-next-130 INTERFACE CHANGE (additive), CR 120.1, 400.7, 603.10a (Shelob, Child of Ungoliant: "another creature dealt damage this turn by a Spider you controlled"): this object was
   * dealt damage this turn by a source that matched this filter as it dealt the damage (the `source.` facts of a `damage` entry of `GameState.history`: its types, subtypes and
   * controller then, CR 400.7; "you" is the controller of the ability or source the filter is read for; an amount of 0 is no event, CR 120.8). Only fields the facts answer
   * (rules/history.ts#factsMatchFilter); any other makes the card manual. Capability `filter:dealtDamageThisTurnBy`.
   */
  dealtDamageThisTurnBy?: ObjectFilter;
  /**
   * r3-choose INTERFACE CHANGE (additive): "target permanent card in your graveyard that was put there from anywhere this turn" (Night Nurse): this object was put
   * into the zone it is in this turn, from any zone (a zone change makes a new object, CR 400.7, so the zoneChange entry of `GameState.history` whose subject is
   * this object is the move that put it there). Only `true` has a wording. Capability `filter:putThereThisTurn`.
   */
  putThereThisTurn?: true;
  /**
   * edh-next-116 INTERFACE CHANGE (additive), CR 400.7, 506.1 (Storrev, Devkarin Lich: "target creature or planeswalker card in your graveyard that wasn't put there this combat"): this object
   * was put into the zone it is in during the current combat (the zoneChange entry of `GameState.history` for this object carries the current combat's number); `false` is "wasn't put there
   * this combat". Outside combat nothing was put there this combat. Capability `filter:putThereThisCombat`.
   */
  putThereThisCombat?: boolean;
  /**
   * r5-fxz INTERFACE CHANGE (additive), CR 400.7: with `putThereThisTurn`, the zone the move that put it there came from: "creature cards in your opponents'
   * graveyards that were put there from the battlefield this turn" (Supper for Spiders). Read only together with `putThereThisTurn`. Capability `filter:putThereFrom`.
   */
  putThereFrom?: 'battlefield' | 'library' | 'mill' | 'notBattlefield' | 'discardOrLibrary' /* edh-d-85 (CR 701.9a, 400.7, 404.1; Ghost of Ramirez DePietro): "that was discarded or put there from a library this turn": edh-d-102's 'discard' test, or a move this turn from a library into its zone (rules/history.ts#putThereThisTurn) */ | 'discard' /* edh-d-102 (CR 701.9a, 702.29a, 400.7; Shadow of the Grave): "that you cycled or discarded this turn": its owner discarded it this turn (rules/history.ts#putThereThisTurn), a madness card put into the graveyard from exile after that discard included */ /* edh-next-59 (CR 400.7; Banon, the Returners' Leader): "put there from anywhere other than the battlefield this turn": the move that put it there did not come from the battlefield */; /* edh-top-13: 'mill' (CR 701.17a, 400.7; Tato Farmer: "a land card in a graveyard that was milled this turn"): put into a graveyard from a library by a mill, not by any other effect (ruling 2024-03-08); */ // edh-zones-22: 'library' (CR 400.7, 404.1; Captain N'ghathrod: "that was put there from their library this turn", a card in a graveyard comes from its owner's library)
  /**
   * FAST5 T66 INTERFACE CHANGE (additive): "whose controller was dealt combat damage by ~ this turn" (Steel Hellkite, CR 510.2, 120.1): the object's controller (as
   * it is now) was dealt combat damage this turn by the source of the ability (the object itself, CR 400.7). Read from `GameState.history` like the other history
   * fields (capability `filter:controllerDealtCombatDamageBySourceThisTurn`).
   */
  controllerDealtCombatDamageBySourceThisTurn?: boolean;
  /**
   * edh-next-134 INTERFACE CHANGE (additive), CR 510.2, 120.1, 400.7, 109.4 (Admiral Beckett Brass ruling 2017-09-29): "controlled by a player who was dealt combat damage by three or
   * more Pirates this turn": the object's controller (as it is now) was dealt combat damage this turn by at least `atLeast` DIFFERENT sources that matched `by` as each dealt that
   * damage (the `source.*` facts of the turn's damage entries to that player; a source that dealt combat damage twice, double strike, counts once; whether it is still there or
   * still matches does not matter). Capability `filter:controllerDealtCombatDamageBy`.
   */
  controllerDealtCombatDamageBy?: { atLeast: number; by: ObjectFilter };
  attackedThisTurn?: boolean;
  blockedThisTurn?: boolean;
  /** edh-c-18 INTERFACE CHANGE (additive), CR 509.1h, 506.4 (Heat Stroke: "each creature that blocked or was blocked this turn"): this creature was blocked by at least one creature this turn (a `becomesBlocked` entry of this turn whose subject is it, read like `blockedThisTurn`). Capability `filter:wasBlockedThisTurn`. */
  wasBlockedThisTurn?: boolean;

  /** Shares a quality with another object: "that shares a creature type with it". */
  /** std-rx32 INTERFACE CHANGE (additive): `other`, "another <set>": the object tested is not one of the set it is compared with (CR 201.2: "doesn't have the same name as another permanent you control"). */
  /**
   * edh-next-145 INTERFACE CHANGE (additive), CR 205.3m, 608.2c (Cryptic Gateway, ruling 2022-12-08): `sharesWith.each`, "that shares a creature type with each creature tapped this way":
   * the quality is shared with EVERY object of the set (and the set is not empty), not with some one of them (rules/filter.ts, statics/match.ts).
   */
  sharesWith?: { with: ObjRef; quality: 'creatureType' | 'color' | 'cardType' | 'name' | 'landType' | 'permanentType' | 'manaValue' | 'otherSpellType' /* edh-d-96 (CR 304.1, 307.1, 205.2a; Gale, Waterdeep Prodigy): "a card of the other type" after "an instant or sorcery spell": the object is a sorcery when the one compared with is an instant and not a sorcery, an instant when it is a sorcery and not an instant (an object that is both, or neither, has no other type) */; other?: true; each?: true }; // edh-b-14: 'manaValue', "the same mana value as that permanent" (CR 202.3); edh-zones-10: 'permanentType', "shares a permanent type with it" (CR 110.4, 205.2a: a card type that permanents have; Kindred is not one)
  /** Matches a quality chosen by a linked ability: "creatures of the chosen type", "the chosen color". */
  /** Cloud std-eoe INTERFACE CHANGE (additive): quality `oddEven`, "with mana value of the chosen quality": the object's mana value is odd or even as chosen (zero is even, CR 202.3). */
  /** edh-zones-16 INTERFACE CHANGE (additive): quality `landOrNonland`, "a card of the chosen kind" after "choose land or nonland" (Abundance, Abundant Harvest; CR 205.2a, 607.2d): a land card if `land` was chosen, any other card if `nonland` was. */
  /** edh-d-94 INTERFACE CHANGE (additive): quality `planeswalkerType`, "Planeswalkers you control of the chosen type" after "As ~ enters, choose a planeswalker type." (Deification; CR 205.3j, 607.2d): an object with that planeswalker type. */
  /** edh-d-95 INTERFACE CHANGE (additive): quality `oddEvenPower`, "each creature with power of the chosen quality" after "choose odd or even" (Zimone's Hypothesis; CR 208.1, 607.2d): the parity of its power (zero is even), read from the `oddEven` choice. */
  chosen?: { link: LinkId; quality: 'color' | 'creatureType' | 'cardType' | 'landType' | 'cardName' | 'oddEven' | 'oddEvenPower' | 'landOrNonland' | 'planeswalkerType' };
  /**
   * edh-players-17 INTERFACE CHANGE (additive; CR 105.2a, 105.2b, 608.2d, 613.1b; Selective Obliteration): "it's only the color its controller chose": the object is exactly one color,
   * the color its CONTROLLER chose for the `chooseValue` step with this link when several players chose (`LinkValue.byPlayer`, kept for the resolution only: `cx.choices`).
   * An object whose controller made no choice, or with two or more colors, or none, does not match. Capability `filter:onlyColorChosenByController`; not read by static abilities
   * (statics/match.ts does not list it, so a static that uses it is manual).
   */
  onlyColorChosenByController?: LinkId;
  /** Stack objects: what kind, and what it targets ("spell that targets ~", CR 115.9b). */
  stackKind?: 'spell' | 'activatedAbility' | 'triggeredAbility' | 'ability' | 'copy' | 'finalChapterAbility' /* edhn78 (CR 714.2d): a Saga's final chapter ability on the stack */;
  /**
   * FAST5 T45 INTERFACE CHANGE (additive): an ability on the stack whose SOURCE matches this filter ("copy target activated or triggered ability you control
   * from an artifact source", CR 113.7a): the source object as it last existed (CR 608.2h, 400.7). A spell, or any object that is not an ability, never matches.
   */
  abilitySource?: ObjectFilter;
  /**
   * edhd36 INTERFACE CHANGE (additive): an activated ability on the stack that is a loyalty ability (CR 606.2: its cost has a loyalty cost, or minus X), "counter target loyalty ability of a planeswalker"
   * (Verdant Command). Read by rules/filter.ts and the target legality of rules/targets.ts. Capability: none (the matchers that do not read it refuse the filter).
   */
  loyaltyAbility?: true;
  targets?: ObjRef | PlayerRef;
  /**
   * FAST5 T45 INTERFACE CHANGE (additive), CR 115.9c: a spell or ability that targets ONLY the object or player the reference names ("an instant or sorcery
   * spell that targets only a single creature you control"): it has exactly one different target (chosen once or several times), and that one is it.
   */
  targetsOnly?: ObjRef | PlayerRef;
  /**
   * edh-next-74 INTERFACE CHANGE (additive), CR 115.9c, 115.1 (Radiate, Radiant Performer): with `targetsOnly`, "that targets only a single permanent or player": the one different target may also be a
   * PLAYER (any player), beside the objects `targetsOnly` names. Capability `filter:targetsOnlyPlayer` (rules/filter.ts).
   */
  targetsOnlyPlayer?: true;
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
   * edh-next-13 INTERFACE CHANGE (additive), CR 702.33d, 601.2b: a kicked spell ("Spend this mana only to cast kicked spells", Elfhame Druid): a spell on the stack that was cast with at least one kicker
   * payment (`StackInfo.costsPaid.kicked`, so multikicker and each kicker cost count). Never true of a spell not yet cast. Read by rules/filter.ts and statics/match.ts; capability `filter:kicked`.
   */
  kicked?: true;
  /**
   * pc-exile-play-2 INTERFACE CHANGE (additive), CR 601.2i: a spell that was the first its controller cast this turn (`turn`), or the first they cast this turn from the
   * zone it was cast from (`turnFromZone`; with `castFrom` "the first spell you cast from exile each turn"). Read from `StackInfo.castOrdinal`: a copy of a spell was never cast (CR 707.10, putCopyOnStack drops the ordinal), a copy of a card that is cast is (CR 707.12).
   * Capability `filter:firstCast`.
   */
  /** edh-next-114 INTERFACE CHANGE (additive), CR 601.2i (The Twelfth Doctor): `turnNotHand`, the first spell its caster cast this turn from anywhere other than their hand (`StackInfo.castOrdinal.notHand`). Capability `filter:firstCast`. */
  firstCast?: 'turn' | 'turnFromZone' | 'turnNotHand';
  /**
   * edh-mana-keywords-12 INTERFACE CHANGE (additive), CR 601.2i, 106.3, 205.3; Rain of Riches: a spell that was the first its controller cast this turn with mana from a source of this
   * subtype spent on it ("the first spell you cast each turn that mana from a Treasure was spent to cast"): among the spells cast this turn that had such mana, the first. Read from
   * `StackInfo.castOrdinal.manaFrom`; a copy was never cast. Capability `filter:firstCastManaFrom`.
   */
  firstCastManaFrom?: string;
  /**
   * edh-next-143 INTERFACE CHANGE (additive), CR 601.2h, 106.3, 205.2a; Shadow the Hedgehog: a spell some of whose mana was produced by a source of this card type or subtype ("if
   * mana from an artifact was spent to cast it"): read from the units of `StackInfo.costsPaid.manaSpent` (`sourceTypes`, as the source was as it was paid, and `sourceSubtypes`);
   * a copy of a spell was never cast and had no mana spent on it (CR 707.10). Capability `filter:manaSpentFrom`.
   */
  manaSpentFrom?: string;
  /**
   * edh-next-97 INTERFACE CHANGE (additive), CR 601.2i, 707.10; Anhelo, the Painter ("The first instant or sorcery spell you cast each turn has casualty 2"): a spell that is the first one matching this
   * description that its controller cast this turn. Read from the turn's history (the `cast` entries of the spell's controller, facts of types, supertypes, colors and subtypes only; a description
   * with any other field matches nothing: fail closed) while the spell is being cast and after; a copy was never cast. Capability `filter:firstCastOf`.
   */
  firstCastOf?: ObjectFilter;
  /**
   * FAST5X E23 INTERFACE CHANGE (additive): the object's mana cost contains {X} ("spells with {X} in their mana costs", CR 107.3, 202.1): read from its
   * characteristics (for a spell, the face being cast). False: no {X} in it.
   */
  manaCostHasX?: boolean;
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 107.4, 202.1: "with one or more blue mana symbols in its mana cost" (Namor the Sub-Mariner): the number of
   * mana symbols of `color` in its mana cost (types/mana.ts#colorSymbolCount, counted as devotion counts them) compared with `cmp`. Capability `filter:manaSymbols`.
   */
  /**
   * edh-next-142 (additive), CR 105.1, 107.4, 202.1; Omnath, Locus of All: `color: 'colored'`, "three or more colored mana symbols in its mana cost": every symbol of the cost that has a
   * color counts once, whatever its color (a hybrid {R/G} is one colored symbol; generic, {C}, {X} and {S} are none). Read under the same capability `filter:manaSymbols`.
   */
  manaSymbols?: { color: Color | 'colored'; cmp: NumberCmp };
  /**
   * edh-zones-6 INTERFACE CHANGE (additive), CR 202.1, 202.1b: the object's printed mana cost is exactly one of these costs ("an artifact card with mana cost {0} or {1}", Urza's
   * Saga), each written as its symbols in order ("{0}", "{1}", "{1}{G}"). An object with no mana cost (a land, CR 202.1b) is none of them; a cost of {0} is not "no mana cost"
   * (CR 202.1a) and {X} is not {0}. Read from its characteristics (for a spell, the face being cast). Capability `filter:manaCostIs`.
   */
  manaCostIs?: string[];

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
   * edh-top-2 INTERFACE CHANGE (additive), CR 702.95b: a paired creature ("as long as ~ is paired with another creature", `GameObject.pairedWith`); false: an unpaired creature.
   * Capability `filter:paired`, `sfilter:paired`.
   */
  paired?: boolean;
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
   * edh-d-26 INTERFACE CHANGE (additive): `sizeVs.by`, the size of the zone of the player `than` plus `by` is what each player's size is compared with: "an opponent has at least four more
   * cards in hand than you" is `op: '>='`, `by: 4` (CR 402.1, 102.3; Teachings of the Archaics). Without `by` it is 0.
   * edh-c-58 INTERFACE CHANGE (additive): `controlsVs.by`, the number the player `than` controls plus `by` is what the player's number is compared with: "an opponent controls at least four
   * more creatures than you" is `op: '>='`, `by: 4` (CR 102.2, 102.3; Avatar of Might). Without `by` it is 0 (the older reading).
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
  | { q: 'countPlayers'; of: PlayerRef; sizeVs?: { zone: 'hand' | 'graveyard' | 'library'; op: Cmp; than: PlayerRef; by?: number }; sizeIs?: { zone: 'hand' | 'graveyard' | 'library'; op: Cmp; n: number }; lifeVs?: { op: Cmp; than: PlayerRef }; lifeIs?: { op: Cmp; n: number; halfStarting?: true }; poisonIs?: { op: Cmp; n: number }; lostLifeThisTurn?: true; lostLifeIs?: { op: Cmp; n: number }; controlsVs?: { filter: ObjectFilter; op: Cmp; than: PlayerRef; by?: number }; controlsIs?: { filter: ObjectFilter; op: Cmp; n: number }; speedVs?: { op: Cmp; than: PlayerRef }; didNot?: { op: 'discard'; step: Name; which: ObjectFilter } }
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
  /**
   * edh-players-21 INTERFACE CHANGE (additive), CR 608.2h, 101.4 (Olórin's Searing Light: "damage to each opponent equal to the power of the creature they exiled"): `by`, only the
   * objects of `of` whose controller as they last existed is this player (the creature each player of a group chose for themselves), read with `{ref:'iterating'}` for each player of
   * the group. Capability `feature:q.stat.by`.
   */
  | { q: 'stat'; stat: 'power' | 'toughness' | 'manaValue' | 'loyalty' | 'defense'; of: ObjRef; sum?: boolean; agg?: 'max' | 'min'; station?: true; by?: PlayerRef }
  /**
   * edh-next-126 INTERFACE CHANGE (additive), CR 601.2i, 608.2h (Lifestream's Blessing: "Draw X cards, where X is the greatest power among creatures you controlled as you cast this
   * spell."): `value` read once, when the spell became cast, as its controller (actions/cast-checks.ts records it on the spell, `StackInfo.castValues`, keyed by the JSON of `value`);
   * the spell reads that record as it resolves, whatever happened since (ruling 2025-06-06). A spell that was not cast (a copy, CR 707.10), or any other object, has no record: the
   * value is undetermined (CR 608.2h). Capability `qty:asCast`.
   */
  | { q: 'asCast'; value: Quantity }
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
  /** edh-next-19 (CR 119.1, 500.1; Sengir, the Dark Baron): `atTurnStart` = the player's life total as the turn began (`turnStats.lifeAtTurnStart`, set when the turn begins; core/turn.ts). */
  | { q: 'life'; of: PlayerRef; agg?: 'min' | 'max'; atTurnStart?: true }
  /** edh-c-59 INTERFACE CHANGE (additive), CR 402.1: `agg: 'max'` on a hand over a group of players, "the number of cards in the hand of the opponent with the most cards in hand" (Adamaro, First to Desire; capability `feature:q.zoneSize.agg`). */
  | { q: 'zoneSize'; zone: ZoneName; of: PlayerRef; agg?: 'max' }
  | { q: 'counters'; on: Ref; kind: CounterKind | 'any' }
  | { q: 'devotion'; to: Color[]; of: PlayerRef } // CR 700.5
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 107.4, 202.1: the number of mana symbols of `color` in the mana cost of the one object `of` stands for
   * (as it last existed): Namor's "create that many" after "a noncreature spell with one or more blue mana symbols in its mana cost". Capability `q:manaSymbols`.
   */
  | { q: 'manaSymbols'; of: ObjRef; color: Color }
  /**
   * edh-next-143 INTERFACE CHANGE (additive), CR 115.9a, 601.2c, 608.2h (Voracious Bibliophile: "Whenever you cast a spell with one or more targets, draw that many cards."): the number of targets
   * the spell or ability had when it was put on the stack, each time an object or player was chosen counted (as `ObjectFilter.targetCount` counts them), read from the object as it is on
   * the stack, or as it last existed there once it left (CR 608.2h). Capability `q:targetsOf`.
   */
  | { q: 'targetsOf'; of: ObjRef }
  /**
   * edh-c-37 INTERFACE CHANGE (additive), CR 107.4, 202.1: the number of mana symbols of `color` in the mana costs of all the objects `of` stands for ("the number of black mana
   * symbols in the mana costs of cards in your graveyard", Umbra Stalker; "... of permanents you control" is devotion, `q:'devotion'`): a hybrid symbol of that color counts
   * once, as devotion counts it. Capability `q:symbolsAmong`.
   */
  | { q: 'symbolsAmong'; of: ObjRef; color: Color }
  /**
   * edh-next-145 INTERFACE CHANGE (additive), CR 702.1, 608.2h, 611.2c (Akroma, Vision of Ixidor; rulings 2020-11-10): "+1/+1 if it has flying, +1/+1 if it has first strike, and so on
   * for ...": how many of the listed keywords the one object has, each entry counted once however many instances or variants it has ("protection from black and from red" is one
   * protection); an entry that is a list counts once when the object has any of its keywords ("partner" and "partner with"). Read from the object as it is now (last known
   * information once it has left). Capability `q:keywordsHad`.
   */
  | { q: 'keywordsHad'; of: ObjRef; keywords: (string | string[])[] }
  /** T38, CR 700.8: the number of creatures in the player's party (up to one each of Cleric, Rogue, Warrior and Wizard among the creatures they control; statics/party.ts). */
  | { q: 'partySize'; of: PlayerRef }
  /**
   * edh-next-33 INTERFACE CHANGE (additive), CR 702.140d, 730.2: "the number of times ~ has mutated" (Insatiable Hemophage, Archipelagore): the mutating creature spells
   * that merged with this permanent, each one a component that has `mergedAt`. 0 for an object that never mutated. Capability `feature:q.timesMutated`.
   */
  | { q: 'timesMutated' }
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
  /**
   * edh-d-90 INTERFACE CHANGE (additive), CR 601.2f, 118.7, 205.2a, 607.2a (Cemetery Prowler: "Spells you cast cost {1} less to cast for each card type they share with cards exiled with this
   * creature"): the number of card types the spell a cost change is applied to (the subject) has that at least one object of `among` also has; a type two exiled cards share is counted once
   * (Cemetery Prowler ruling 2021-11-19). Read only by a cost modifier's amount (statics/costmods.ts#costQuantity); everywhere else it is unknown. Capability `rq:cost.sharedCardTypes`.
   */
  | { q: 'sharedCardTypes'; among: ObjRef }
  | { q: 'distinct'; what: 'colors' | 'cardTypes' | 'creatureTypes' | 'names' | 'landTypes' | 'manaValues' | 'powers' | 'colorPairs' | 'permanentTypes' | 'counterKinds' | 'planeswalkerTypes' | 'manaCosts'; among: ObjRef } // 'planeswalkerTypes': r5-fxb INTERFACE CHANGE (additive), "the number of planeswalker types among planeswalkers you control" (CR 205.3j), capability `feature:q.distinct.planeswalkerTypes`
  /**
   * r5-cost INTERFACE CHANGE (additive): "the greatest number of creatures you control that have a creature type in common" (White Lotus Tile; CR 205.3m, 702.73a):
   * the most objects of `among` that share one creature type (a changeling has every creature type); 0 with none. Capability `q:mostSharingCreatureType`
   * (effects/eval.ts).
   */
  | { q: 'mostSharingCreatureType'; among: ObjRef }
  /**
   * edh-replace-4 INTERFACE CHANGE (additive): "you control eight or more artifacts with the same name as one another" (Mechanized Production; CR 201.2, 603.4): the
   * most objects of `among` that have one name in common (CR 201.2: objects have the same name when they have a name in common; an object without a name shares none);
   * 0 with none. Capability `q:mostSharingName` (effects/eval.ts). Effects only: statics do not evaluate it.
   */
  | { q: 'mostSharingName'; among: ObjRef }
  /**
   * edh-cast-3 INTERFACE CHANGE (additive): "the greatest number of artifacts an opponent controls" (Cavern-Hoard Dragon; CR 109.4, 608.2h, 601.2f): the objects of
   * `of` counted per controller, and the largest of those counts (0 with none). `of` is a description that names the players whose objects count ("artifacts an
   * opponent controls"): the permanents are grouped by who controls each. Capability `q:mostByController` (effects/eval.ts, statics/match.ts).
   */
  | { q: 'mostByController'; of: ObjRef }
  /**
   * edh-cast-3 INTERFACE CHANGE (additive): "1 life your opponents have lost this turn", "the amount of life your opponents lost this turn" (Rakdos, Lord of Riots; CR
   * 119.3, 120.3a, 601.2f): the life lost this turn by every player of `of`, added up (damage included, `turnStats.lifeLost`). Unlike `lifeLostThisTurn` it takes
   * a group of players. Capability `q:lifeLostTotal` (effects/eval.ts, statics/match.ts).
   */
  | { q: 'lifeLostTotal'; of: PlayerRef }
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
  /**
   * edh-next-82 INTERFACE CHANGE (additive; CR 120.1, 400.7; Dragon Cultist): `per: 'source'` with `sum: 'amount'` and a `damage` event: the damage each source dealt is added up on its own and the
   * quantity is the most one source dealt ("if a source you controlled dealt 5 or more damage this turn": one source, not all of them together). Each source is the object as it dealt
   * the damage (the `source.id` fact), so a source that changed zones is another one. Statics never read it.
   */
  /**
   * edh-d-92 INTERFACE CHANGE (additive; CR 208.1, 700.4, 603.10a, 608.2h; Genesis of the Daleks): `sum: 'power'`, without `per`, of a `zoneChange` pattern: the powers of the matching
   * entries added up, each the object's power as it last existed (the entry's `power` fact; "the total power of Daleks that died this turn"). An entry without that fact fails closed.
   * Read by rules/history.ts#sumHistory (the history capability `q:happenedCount`); statics never read it.
   */
  | { q: 'happenedCount'; event: EventPattern; scope: HistoryScope; by?: PlayerPred; per?: 'player' | 'source'; beforeEvent?: boolean; sum?: 'amount' | 'manaValue' | 'power' }
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
  /**
   * edh-players-9 INTERFACE CHANGE (additive): "for each opponent who drew two or more cards this turn", "the number of opponents that were dealt combat damage this turn"
   * (CR 121.1, 120.2a, 120.8, 102.3; Smuggler's Share, Tymna the Weaver): the players of `of` for whom the history of `scope` holds at least (`times`, default one or more)
   * events matching `event`, each player judged ALONE with the pattern read from that player's side (the player judged is "you" of the pattern: a `draw` of player `you`,
   * a combat `damage` to a player `you`, a `zoneChange` of a land whose controller is `you`). A damage entry of 0 is no damage dealt (CR 120.8). Capability `q:happenedPlayers`
   * (effects/eval.ts, rules/history.ts#happenedPlayersOf) and `feature:history`; statics never read it.
   */
  /**
   * `countLeft`: a player who has left the game since still counts (Tymna the Weaver, ruling 2020-11-10: "If a player was dealt combat damage and subsequently lost the game,
   * Tymna's triggered ability counts that player"); only with `of` each opponent / each player (the players of the game, the controller aside for opponents).
   */
  | { q: 'happenedPlayers'; of: PlayerRef; event: EventPattern; scope: HistoryScope; times?: { op: Cmp; n: number }; countLeft?: true }
  /** Storm (CR 702.40a): the number of spells cast this turn by ALL players before the spell of the triggering `cast` event. Fixed when that spell is cast (read from `spellCast.spellsBefore`), so a spell cast in response to the storm trigger is not counted. Only in an ability triggered by a `cast` event. */
  | { q: 'spellsBefore' }
  /** edh-d-3 INTERFACE CHANGE (additive), CR 702.69a: gravestorm, the number of permanents (tokens too, whoever controlled or owned them) put into a graveyard from the battlefield this turn by ALL players, counted as the ability resolves (`turnStats.permanentsToGraveyard`). */
  | { q: 'permanentsToGraveyardThisTurn' }
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
  | { q: 'spellManaSpent'; of?: ObjRef; from?: ObjectFilter; /** edh-next-139 INTERFACE CHANGE (additive), CR 602.2b, 106.3 (Forsworn Paladin): "if mana from a Treasure was spent to activate this ability": the mana spent to activate the resolving activated ability (its cost record; with `from`, only mana from such a source); never with `of`. Capability `feature:spellManaSpent.activation`. */ activation?: true }
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
  /**
   * edh-c-89 INTERFACE CHANGE (additive), CR 602.2, 602.5b, 400.7 (Dragon Whelp): "this ability has been activated four or more times this turn", read by the resolving activated
   * ability itself: the activations this turn of this ability of this source object, this one included (it counts as it is put on the stack, actions/activate.ts; one that was
   * countered still counts). A source that changed zones is a new object (CR 400.7). Kept in `GameState.turnActivations` under `<sourceId>|<ability key>`. Outside a resolving
   * ability it fails to determine. Capability `q:activatedThisTurn`.
   */
  | { q: 'activatedThisTurn' }
  /** edh-top-15 INTERFACE CHANGE (additive), CR 120.10, 603.2, 608.2h: "damage equal to the excess" in the ability that triggers on a permanent being dealt excess damage (Toralf): the part of that damage that was excess damage (`damageDealt.excess`). Only a trigger on a `damage` event with `excess`. Capability `q:eventExcess`. */
  | { q: 'eventExcess' }
  /**
   * edh-d-90 INTERFACE CHANGE (additive), CR 106.3, 605.1a, 605.3b (Tyvar the Bellicose: "put a number of +1/+1 counters on it equal to the amount of mana this creature produced"): the number
   * of mana the triggering activation of a mana ability added (the event's `produced`, triggers/context.ts); only in a trigger on such an activation (model/lint-roles.ts). Capability `q:manaProduced`.
   */
  | { q: 'manaProduced' }
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
  | { q: 'resultCount'; step: Name; which?: ObjectFilter; maxPerOwner?: true; /** edh-perms-22 (CR 608.2c, 614.1, 903.9; Flood of Tears ruling 2019-07-12): count the objects the move was applied to (`StepResult.attempted`), also one a replacement effect put elsewhere (a commander put into the command zone instead of the hand); needs `which`; capability `feature:resultCount.attempted` */ attempted?: true; /** edh-c-61 INTERFACE CHANGE (additive), CR 701.8a, 700.4, 614.6, 608.2c (Hellfire ruling 2009-10-01): "the number of creatures that died this way": of what a destroy step reports it destroyed, only the objects a replacement effect did not send elsewhere than `to` (`StepResult.beforeTo`); with `which` the description they match as they last existed. Capability `feature:resultCount.to` */ to?: 'graveyard'; /** edh-next-128 INTERFACE CHANGE (additive), CR 705.2, 608.2c (Yusri, Fortune's Flame): of a called flip of several coins, the flips LOST ("for each flip you lose"; `StepResult.lost`). Capability `feature:resultCount.lost` */ lost?: true } // "the number of cards discarded this way"
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
  | { q: 'damageDealt'; step: Name; /** edh-next-109 INTERFACE CHANGE (additive), CR 120.3, 608.2h (Kaya, Orzhov Usurper; ruling 2019-01-25): `stated`, the amount the damage instruction said it deals (read before any prevention), not what it dealt: "deals damage to target player equal to N and you gain that much life". Not a new form: capability `q:damageDealt`. */ stated?: true }
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
   * edhd27 INTERFACE CHANGE (additive), CR 701.38a-b, 608.2c: the votes the vote named `step` gave `of`, a player or an object ("for each vote you received", "draw a card for each
   * vote they received", "put that many stun counters on it"): `{ref:'iterating'}` is the player or object a `forEach` is at; any other reference is read for its first player or
   * object. A vote that did not happen, a vote resolved by hand, or someone nobody voted for gave none (0). Capability `q:votesFor`.
   */
  | { q: 'votesFor'; step: Name; of: PlayerRef | ObjRef }
  /**
   * M12-3 INTERFACE CHANGE (additive), CR 702.121a (melee): "the number of opponents you attacked with a creature this combat": the different players other than
   * the controller that creatures the controller controlled were declared attacking in this combat phase (a planeswalker or a battle attacked is not its player;
   * creatures that left combat or the battlefield since still count: read from the game history, CR 508.1). Outside a combat phase it is 0. Capability
   * `q:opponentsAttacked`.
   * trek-7 INTERFACE CHANGE (additive): `scope: 'turn'`, "the number of opponents you attacked this turn" (Worf, Defiant Commander; the Star Trek set is newer than the
   * rules in rules/cr, CR 506.2-506.3 and 508.1 from memory): the same count over every combat of the turn so far, still read from the history (a combat's attackers
   * are written as they are declared); a planeswalker or battle attacked is not its player (CR 506.3). Same capability `q:opponentsAttacked`.
   */
  /** edh-next-98 INTERFACE CHANGE (additive): `present: true`, "the number of opponents being attacked" (Dimir Strandcatcher): a player who has left the game since the attack is not counted (CR 800.4a; ruling 2024-02-02). */
  | { q: 'opponentsAttacked'; scope?: 'turn'; present?: true }
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
   * edh-mana-keywords-10 INTERFACE CHANGE (additive), CR 706.2, 608.2h: "the other result" of "Roll two d12 and choose one result" (the result of the die that was not chosen; Reckless Endeavor).
   * Fails to determine without such a roll in this resolution. Capability `q:dieResultOther`.
   */
  | { q: 'dieResultOther' }
  /**
   * edh-next-147 INTERFACE CHANGE (additive), CR 123.6e (_____ Goblin): "for each unique vowel on that sticker": the number of different vowels (A, E, I, O, U and Y) on
   * the name sticker a `putSticker` step of this resolution put; 0 when it put none (no sticker, so no vowel on it). Steps only. Capability `q:stickerVowels`.
   */
  | { q: 'stickerVowels' }
  /**
   * edh-d-49 INTERFACE CHANGE (additive), CR 706.2, 603.2c, 608.2h: "any of those results was 10 or higher" (Farideh, Devil's Chosen): the highest result among the dice of the roll that triggered the ability
   * (one occurrence of "whenever you roll one or more dice": every die the instruction rolled that was not ignored) or, in an instruction that rolled in this resolution, among the dice of its last roll.
   * Fails to determine without a roll. Capability `q:dieResultHighest`.
   */
  | { q: 'dieResultHighest' }
  /**
   * edh-mana-keywords-10 INTERFACE CHANGE (additive), CR 706.2, 608.2h: how many of the dice of the last roll of this resolution have a result that is even, odd or exactly that number
   * ("Create a tapped Treasure token for each even result", "If you rolled 6 exactly seven times"; Luck Bobblehead). Fails to determine without a roll. Capability `q:diceResults`.
   */
  /*
   * edh-next-55 INTERFACE CHANGE (additive), CR 706.2, 608.2h: `match: 'distinct'`, "For each different result, create a 1/1 white Clown Robot artifact creature token" (Circuits Act): how many different
   * numbers the dice of the last roll of this resolution came up (three dice showing 2, 2 and 5 are two different results).
   */
  | { q: 'diceResults'; match: 'even' | 'odd' | 'distinct' | number }
  /**
   * CLOUD std-misc INTERFACE CHANGE (additive): "the chosen number", the number an earlier `chooseValue` of `what: 'number'` with this `link` chose ("Choose a number
   * between 0 and 10. Destroy all creatures with power greater than or equal to the chosen number.", CR 608.2c-d, 607.2d): read from this resolution's choices,
   * else the source's link; fails to determine when nothing was chosen (CR 608.2b). Capability `q:chosenNumber` (effects/eval.ts) and `sq:chosenNumber` (statics/match.ts, edh-c-95: the source's own link).
   */
  | { q: 'chosenNumber'; link: LinkId; /** edh-next-139 INTERFACE CHANGE (additive), CR 608.2d (Plague of Vermin): `of`, the number THAT player of several chose or paid (`LinkValue.byPlayer`; a `pay` with a `link` writes what each player paid), "for each 1 life they paid this way"; capability `feature:q.chosenNumber.of` */ of?: PlayerRef; /** edh-next-120 (additive; CR 608.2d; Wheel of Misfortune): "the highest number" / "the lowest number" chosen by the players of a `chooseValue` of several choosers (`LinkValue.byPlayer`), instead of the one number; capability `feature:q.chosenNumber.extreme` */ extreme?: 'highest' | 'lowest' }
  /** edh-d-45 INTERFACE CHANGE (additive), CR 105.1, 601.2f, 607.2d (Seal of the Guildpact): how many of the colors the source kept under `link` the spell a cost modifier is applied to is. Cost modifiers only (statics/costmods.ts#costQuantity). Capability `rq:cost.chosenColorsOf`. */
  | { q: 'chosenColorsOf'; link: LinkId; /** edh-d-72 INTERFACE CHANGE (additive), CR 105.1, 607.2d, 608.2h (Tablet of the Guilds): in a resolving effect, "for each of the chosen colors it is": how many of the colors the source kept under `link` the object `of` names is (as it last existed). Without `of` an effect reads nothing. Capability `q:chosenColorsOf` (effects/eval.ts). */ of?: ObjRef }
  /**
   * edh-next-12 INTERFACE CHANGE (additive), CR 601.2f, 601.2i (Damping Sphere): "each other spell that player has cast this turn": of a cost modifier that applies to every
   * player's spells, the number of spells the player casting the spell has cast so far this turn (the spell being cast is not counted yet). Read by statics/costmods.ts
   * (`COST_QUANTITY_KINDS`, supplied by actions/cast.ts#modifiedPlan); nothing else evaluates it. Capability `rq:cost.casterSpellsCastThisTurn`.
   */
  | { q: 'casterSpellsCastThisTurn' }
  /**
   * edh-c-73 INTERFACE CHANGE (additive), CR 601.2f, 109.4 (Hum of the Radix): "for each artifact its controller controls", of a cost modifier that applies to every player's spells: the
   * number of objects matching `filter` that the player casting the spell controls (a filter's "you" is the caster). Read by statics/costmods.ts (`COST_QUANTITY_KINDS`, supplied by
   * actions/cast.ts#modifiedPlan); nothing else evaluates it. Capability `rq:cost.casterControlledCount`.
   */
  | { q: 'casterControlledCount'; filter: ObjectFilter }
  | { q: 'speed' | 'age' | 'level' | 'turnNumber' | 'cardsDrawnThisTurn' | 'spellsCastThisTurn' | 'lifeGainedThisTurn' }
  /** FAST5 T60 INTERFACE CHANGE (additive), CR 103.4: "your starting life total" (`GameState.options.startingLife`: 20, or what the format says; 40 in Commander). */
  | { q: 'startingLife' }
  /** edhn95 INTERFACE CHANGE (additive), CR 104.3, 800.4a: "the number of players who have lost the game" / "for each player who has lost the game" (Rampant Frogantua, Hot Pursuit): the players of the game with `hasLost` set (players who left stay counted, CR 800.4). Capability `q:playersLost`; a static ability reads it (the flag is part of the layer cache key). */
  | { q: 'playersLost' }
  /**
   * FAST5X E22 INTERFACE CHANGE (additive), CR 700.11: "the number of times you descended this turn", the permanent cards put into its controller's graveyard
   * from anywhere this turn (`turnStats.descended`); "you descended this turn" is this compared `>=` 1.
   */
  | { q: 'descendedThisTurn' }
  /**
   * edh-combat-5 INTERFACE CHANGE (additive), CR 508.1, 500.8: "for each time it has attacked this turn" (Moraug, Fury of Akoum): the number of times the object `of` was declared
   * as an attacker this turn (one per declaration, so two with an added combat phase; history entries `attacks` of this turn whose subject is this object, as that object, CR 400.7).
   * Inside a continuous effect `of` is `{ref:'subject'}`, the creature being modified. Not a creature put onto the battlefield attacking (it was never declared). Read by effects/eval.ts
   * and statics/match.ts (statics may not import rules/history.ts, design 5.4; rules/characteristics.ts keys its layer cache on the history when a definition reads it).
   */
  | { q: 'attacksThisTurn'; of: ObjRef }
  /**
   * std-r9 INTERFACE CHANGE (additive): the number of turns of the controller that have begun this game, the current one included (`PlayerState.turnsBegun`;
   * extra turns count, CR 500.7, skipped turns don't, CR 500.11). "during your first, second, or third turns of the game" is your turn while this is 3 or less.
   * Capability `q:turnsBegun` (effects/eval.ts) and `sq:turnsBegun` (statics/match.ts).
   */
  | { q: 'turnsBegun' }
  /**
   * trek-18 INTERFACE CHANGE (additive): the number of extra turns of the controller that have begun this game, the current one included (`PlayerState.extraTurnsBegun`; CR 500.7).
   * "if you haven't begun an extra turn this game" is this compared with 0. Capability `q:extraTurnsBegun` (effects/eval.ts) and `sq:extraTurnsBegun` (statics/match.ts).
   */
  | { q: 'extraTurnsBegun' }
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
  /** edh-c-95 INTERFACE CHANGE (additive), CR 601.2h: with `among`, only those colors are counted (Dawnglow Infusion: {G} and {W} among the mana spent, 0 to 2). Capability `q:colorsSpent` */
  | { q: 'colorsSpent'; among?: Color[] }
  /**
   * FAST5 T42 INTERFACE CHANGE (additive), CR 601.2h, 106.1, 707.10: "the amount of mana spent to cast ~" (Astelli Reclaimer): how much mana was spent on ALL the costs
   * of casting this spell or the permanent it became (generic and colored, an alternative cost's included, nothing for what was not mana: life, a sacrifice). A copy
   * of a spell was not cast (CR 707.10), a spell cast without paying its mana cost spent none. Read from this spell (or the permanent it became) only.
   */
  | { q: 'manaSpent' }
  /**
   * edh-zones-26 INTERFACE CHANGE (additive), CR 107.4h, 601.2h, 106.1 (Search for Glory): "{S} spent to cast this spell" / "the amount of {S} spent to cast this spell": the mana from
   * snow sources among the mana spent on ALL the costs of casting this spell or the permanent it became (every unit once; the {S} of its own cost or not: Scryfall's ruling
   * counts any snow mana spent). A copy of a spell was not cast (CR 707.10), a spell cast without paying its mana cost spent none: 0. Capability `q:snowSpent`.
   */
  | { q: 'snowSpent' }
  /**
   * edh-next-129 INTERFACE CHANGE (additive), CR 602.2b, 106.3, 707.10 (Mr. House, President and CEO): "for each mana from Treasures spent to activate this ability": the mana spent on the
   * activation cost of the resolving activated ability whose source had that subtype as it produced the mana (ManaUnit.sourceSubtypes, last known information: a Treasure sacrificed for
   * it is gone). A copy of the ability was not activated (CR 707.10): 0. Anywhere but a resolving activated ability it fails to determine. Capability `q:activationManaFrom`.
   */
  | { q: 'activationManaFrom'; subtype: string }
  /**
   * FAST5 T51 INTERFACE CHANGE (additive), CR 601.2h, 106.1: "the number of colors of mana spent to cast that spell" / "for each color of mana spent to cast that spell": the
   * colors (W, U, B, R, G) among the mana spent on the spell of the triggering `cast` event, read from that spell (on the stack, or as last known). Only in an ability
   * triggered by a `cast` event; anywhere else it fails to determine (CR 608.2b). A copy of a spell was not cast (CR 707.10): 0.
   */
  | { q: 'spellColorsSpent' }
  /** edh-d-31 (CR 107.3e, 601.2b; Brass Infiniscope): the X announced for the spell of the triggering cast event (0 for a spell without {X}; a copy has the X of what it copies, CR 707.10). Capability `q:spellX`. */
  | { q: 'spellX' }
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
  /**
   * edh-mana-keywords-2 INTERFACE CHANGE (additive), CR 903.8: `self`, the casts of THIS commander card from the command zone ("the number of times it's been cast from the
   * command zone this game", Opal Palace: the card the ability's source object is, a partner's casts do not count; the cast that put it on the stack counts, Opal Palace
   * ruling 2020-11-10). 0 for an object that is not a commander card. Capability `feature:q.commanderCasts.self` (effects/eval.ts).
   */
  /**
   * edh-mana-keywords-7 INTERFACE CHANGE (additive), CR 903.8, 106.6 (Study Hall: "When you spend this mana to cast your commander, scry X, where X is the number of times it's
   * been cast from the command zone this game"): `spell`, the casts of the commander card of the spell the trigger's `cast` event is about, the cast that put it on the stack
   * counted. 0 for a spell that is not a commander card. Capability `feature:q.commanderCasts.spell` (effects/eval.ts).
   */
  /**
   * edh-next-75 INTERFACE CHANGE (additive), CR 903.8, 601.2f (Myth Unbound: "Your commander costs {1} less to cast for each time it's been cast from the command zone this game"):
   * `costSpell`, the casts of the commander card of the spell whose cost the modifier is changing, counted as the cost is determined, so the cast itself is not yet counted (the same
   * number the commander tax is made of, statics/commander.ts#commanderTax). Read only in a cost modifier's amount (statics/costmods.ts#costQuantity); 0 for a spell that is not a commander
   * card. Capability `feature:q.commanderCasts.costSpell` (a quantity anywhere else is never registered).
   */
  | { q: 'commanderCasts'; of?: PlayerRef; self?: true; spell?: true; costSpell?: true }
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
   * edh-d-91 INTERFACE CHANGE (additive): `what: 'allCardTypes'`, "if two cards that share all their card types were milled this way" (Demonic Covenant; CR 205.2a, 608.2c; ruling 2024-09-20: "only
   * if both cards have the exact same combination of card types. Supertypes and subtypes are not taken into account"): at least `count` of the objects have exactly the same set of card types.
   */
  | { cond: 'share'; what: 'cardType' | 'color' | 'allCardTypes'; of: ObjRef; count: number | 'all' }
  /** "if it's a creature card", "if that creature has flying", "if enchanted creature is red". */
  | { cond: 'matches'; object: ObjRef; filter: ObjectFilter }
  /**
   * edh-next-31 INTERFACE CHANGE (additive): `extra: true`, "~ can't attack during extra turns" (CR 500.7; Medomai the Ageless): the turn is an extra turn (`turn.extra`, the turn
   * an effect added), whoever's it is. Read by statics/match.ts, triggers/cond.ts, effects/eval.ts and actions/announce-cond.ts; no capability name (the field is read wherever `turnOf` is).
   */
  | { cond: 'turnOf'; whose: PlayerPred; step?: TurnStep | TurnStep[]; extra?: true }
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
  // edh-players-10 INTERFACE CHANGE (additive, widening): `spent.color` may be 'C', "if at least three colorless mana was spent to cast this spell" (Desecrate Reality; CR 601.2h, 106.1b)
  // std-rx22 INTERFACE CHANGE (additive): `kept`, "until you lose control of the spell or the permanent it becomes" (suspend's haste, CR 702.62a): with `by: 'you'`,
  // also true only while the caster has controlled the spell and the permanent without a break since it was cast (`GameObject.cast.controlLost` unset; written by
  // core/control.ts). Read for a permanent by statics/match.ts#wasCastKept only; elsewhere capability `feature:wasCast.kept`, which nothing registers (manual).
  // edh-players-11 INTERFACE CHANGE (additive): `viaCost`, "if the {1}{B} cost was paid" (Baleful Mastery; CR 118.9, 601.2b): with `via: 'alternative'`, the mana cost of the face's
  // one alternative cost, as the condition's words state it. The engine reads `via` only (the cast record's alternative cost); parseCard keeps the condition only when the
  // face has exactly one alternative cost named `alternative` with this mana cost (parser/parse.ts#linkAltCostNamed), so the cost named here is the cost paid. The renderer
  // prints it back. No capability of its own: `via` is what the engine reads.
  | { cond: 'wasCast'; kicked?: boolean | string; via?: string; viaCost?: ManaCost; from?: ZoneName; fromOwner?: 'you'; xAtLeast?: number; by?: 'you'; spent?: { color: Color | 'C'; atLeast: number }; object?: ObjRef; kept?: true }
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
  /**
   * edh-next-82 INTERFACE CHANGE (additive; CR 725.1, 500.1, 603.4; Knights of the Black Rose): `asTurnBegan` (monarch only), "if you were the monarch as the turn began": the player who was the monarch when this turn began
   * (`DesignationState.monarchAtTurnStart`, written by core/turn.ts as a turn starts), not the one now. Capability `cond:designation.asTurnBegan`.
   */
  | { cond: 'designation'; who: PlayerRef; what: 'monarch' | 'initiative' | 'citysBlessing' | 'day' | 'night' | 'maxSpeed' | 'enduringStory'; asTurnBegan?: true }
  /**
   * MX4 INTERFACE CHANGE (additive), CR 309.7: "you've completed a dungeon" (no `name`) or "you've completed Tomb of Annihilation" (`name`: that dungeon):
   * the player has completed such a dungeon this game (`GameState.designations.completedDungeons`, core/dungeons.ts). Negated with `not`.
   */
  | { cond: 'completedDungeon'; who: PlayerRef; name?: string }
  | { cond: 'chosen'; link: LinkId; equals: string }
  /**
   * edh-next-120 INTERFACE CHANGE (additive; CR 608.2d, 608.2c; Prisoner's Dilemma): "if each opponent chose silence": every player who made a choice for the `chooseValue` step with
   * this `link` (`LinkValue.byPlayer`) and is still in the game chose `equals`; false when nobody did. Capability `cond:allChose`.
   */
  | { cond: 'allChose'; link: LinkId; equals: string }
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
   * edh-c-110 INTERFACE CHANGE (additive), CR 302.6, 400.7: "you've controlled this artifact continuously since the beginning of your most recent turn" (Rocket Launcher): every object
   * `object` stands for is still that object (CR 400.7), is on the battlefield under the control of this ability's controller, and has been under that control since before
   * that player's most recent turn began (`controlledSinceTurn` earlier than the number of the turn PlayerState.lastTurnStarted holds, the turn they began last, also when
   * an upkeep step was skipped). False when the player has not begun a turn yet. Capability `cond:controlledSinceTurnStart`.
   */
  | { cond: 'controlledSinceTurnStart'; object: ObjRef }
  /**
   * Standard round 4, r4-trig INTERFACE CHANGE (additive), CR 500.8, 505.1a, 506.1: "if it's the first combat phase of the turn" (Genji Glove, Raph & Leo, Sibling
   * Rivals; Karlach, Fury of Avernus): a combat phase is in progress and it is the first one that began this turn (`CombatState.number` 1; an additional combat
   * phase is the second or later, rules/combat-state.ts). False outside combat. Capability `cond:firstCombat`.
   * edh-combat-5 INTERFACE CHANGE (additive): `yourTurn`, "if it's the first combat phase of your turn" (Tifa, Martial Artist): also the turn is the controller's.
   * Read where `firstCombat` is (effects/eval.ts).
   */
  | { cond: 'firstCombat'; yourTurn?: true }
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
  | { cond: 'firstSpellCast'; scope: 'game' }
  /**
   * edh-perms-9 INTERFACE CHANGE (additive), CR 608.2, 603.4: "if it wasn't put onto the battlefield with this ability" (Kodama of the East Tree): the object (each, if
   * several) was put onto the battlefield this turn by an effect of an ability of the source of this resolution (the `viaSource` fact of its zoneChange entry,
   * written from the move that put it there). It judges the source, not which of its abilities: the cards that say "this ability" have one such ability. Capability
   * `cond:putBySource`.
   */
  | { cond: 'putBySource'; object: ObjRef }
  /**
   * edh-players-18 INTERFACE CHANGE (additive), CR 102.3, 603.4 (Fevered Visions): "if the player is your opponent": every player `who` names is (`is: 'opponent'`) an opponent of
   * the controller, or is (`'you'`) the controller; at least one player is named. Capability `cond:playerIs`.
   */
  | { cond: 'playerIs'; who: PlayerRef; is: 'you' | 'opponent' }
  /**
   * edh-next-53 INTERFACE CHANGE (additive), CR 506.2, 508.1b, 506.3; Suppressor Skyguard: "that player has another opponent who isn't being attacked": among the players still in the game other
   * than `of` (the attacking player) and the controller of the ability, at least one has no creature attacking them in this combat. A planeswalker or battle they control being attacked does
   * not make the player "being attacked" (the Skyguard ruling). Read as it is now, again as the ability resolves (CR 603.4). Capability `cond:otherOpponentNotAttacked`.
   */
  | { cond: 'otherOpponentNotAttacked'; of: PlayerRef }
  /** edh-d-45 INTERFACE CHANGE (additive), CR 506.1, 508.1 (Avenge): "a player attacked you during their last turn": some other player attacked the controller (the player, not a planeswalker or battle) during their own last turn before this one (statics/last-turn-attack.ts). Capability `cond:attackedYouLastTurn`. */
  /** edh-d-85 INTERFACE CHANGE (additive), CR 506.1, 508.1 (O-Kagachi, Vengeful Kami; ruling 2017-08-25): `who`, "that player attacked you during their last turn": the named player (one) attacked the controller during their own last turn (declared an attacker attacking the controller itself; statics/last-turn-attack.ts). Absent: any other player (Avenge). Same capability (`cond:attackedYouLastTurn`); a static ability never reads `who` (statics/match.ts: false). */
  | { cond: 'attackedYouLastTurn'; who?: PlayerRef }
  /**
   * edh-next-97 INTERFACE CHANGE (additive), CR 700.4, 603.4 (Taeko, the Patient Avalanche): "if it didn't die" (as `not` of this): the object(s) of the zone-change event that triggered the ability were put
   * into a graveyard from the battlefield (CR 700.4: "dies"). Read from the event (`EventContext.died`), so what happened to the object since does not matter; false outside a zone-change event
   * from the battlefield. Capability `cond:eventDied`.
   */
  | { cond: 'eventDied' }
  /**
   * edh-d-89 INTERFACE CHANGE (additive), CR 702.122c, 702.122e, 603.4 (Mighty Servant of Leuk-o): "if it was crewed by exactly two creatures" after "whenever ~ becomes crewed": exactly `count`
   * creatures were tapped to pay the cost of the crew ability whose resolution triggered the ability (`EventContext.crewers`; not the other crew abilities of the turn). False for any other event.
   * Capability `cond:eventCrewers`.
   */
  | { cond: 'eventCrewers'; count: number };

/**
 * The scopes of the history conditions (CR 603.4 style). M6-0: `lastTurn` = the previous turn's entries (the werewolf transforms "if no spells were cast last
 * turn"); the cleanup pruning keeps them until the next cleanup (rules/history.ts). The day/night check of CR 502.2 does NOT use it (m6 design E14).
 * edh-next-135 INTERFACE CHANGE (additive), CR 500.1, 603.4: `sinceYourLastTurn` = the entries written after the controller's ("you") most recent turn that ended, up to now
 * (Marchesa, Resolute Monarch: "if you haven't been dealt combat damage since your last turn"): during your own turn, your turn before it (PlayerState.previousTurnStarted); during
 * another player's turn, your turn that began last. Before you had a turn that ended, the whole game. Capability `feature:history.sinceYourLastTurn`.
 */
export type HistoryScope = 'turn' | 'combat' | 'game' | 'lastTurn' | 'sinceYourLastTurn';

// ---- Durations -------------------------------------------------------------

export type Duration =
  | { d: 'endOfTurn' } // "until end of turn", ends in the cleanup step (CR 514.2)
  | { d: 'endOfCombat' }
  | { d: 'permanent' } // no stated duration: until end of game (CR 611.2a)
  | { d: 'whileSource'; as: 'onBattlefield' | 'controlled' | 'attached' | 'tapped' | 'controlledTapped' } // "for as long as ..." (CR 611.2b); edh-next-50 `controlledTapped`: "for as long as you control ~ and ~ remains tapped" (Helm of Possession; CR 611.2b: it ends as soon as either part fails, and does not begin again)
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
  /**
   * edh-c-76 INTERFACE CHANGE (additive): `whose`, "Each opponent can't cast instant or sorcery spells during that player's next turn" (Sphinx's Decree; CR 611.2a, 500.1): the
   * effect does nothing until the next turn of one of the players `whose` names (fixed as the effect begins, effects/handlers/lasting-fix.ts#fixDuration) BEGINS, the first
   * such turn after the one the effect began in, and then lasts through that turn only: as that turn begins the record becomes an `endOfTurn` one (core/durations.ts#nextTurnBegins).
   * Unlike `endOfNextTurn` it does not apply during the rest of the turn it began in (an opponent may cast an instant on my turn). Restrictions only (cap-walk, as above).
   */
  | { d: 'duringNextTurn'; turn?: number; whose?: PlayerRef }
  /**
   * edh-d-88 INTERFACE CHANGE (additive), CR 611.2a, 500.8, 506.1 (Trench Behemoth: "target creature an opponent controls attacks during its controller's next combat phase if able"): the
   * effect does nothing until the next combat phase of a turn of one of the players `whose` names BEGINS (the first one that begins after the effect began: a combat phase in progress
   * as the effect begins is not it), and lasts through that combat phase only. `whose` and `after` (the turn number and the number of the combat phase in progress, 0 for none, as the effect
   * began) are fixed as the effect begins (effects/handlers/lasting-fix.ts#fixDuration); statics/rule-sources.ts#durationActive judges it, core/steps.ts#endCombatPhase ends it.
   * Restrictions and requirements only (model/cap-walk.ts). Capability `dur:duringNextCombat`.
   */
  | { d: 'duringNextCombat'; whose: PlayerRef; after?: { turn: number; combat: number } };

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
  /*
   * edh-top-5 INTERFACE CHANGE (additive), CR 608.2c, 608.2d, 122.1: `gather`, with a group `who`: the name a step of `do` binds for each player who does it ("Each player may put two
   * +1/+1 counters on a creature they control. Goad each creature that had counters put on it this way.", Agitator Ant); after the group has acted it stands for what every player's run
   * bound under it, together, as a forEach's `gather` does (effects/handlers/control.ts#mayHandler). A player who did not do it adds nothing.
   */
  | (StepBase & { op: 'may'; who: PlayerRef; do: EffectStep[]; otherwise?: EffectStep[]; anyOne?: true; villainous?: true; gather?: Name }) // CR 608.2d; `as` records whether they did
  /*
   * edh-players-11 INTERFACE CHANGE (additive), CR 608.2c, 608.2d, 101.4: a `may` of a group of players (`who` is `each`) with an `as` name also binds the players who DID
   * it under that name, in APNAP order, as `{ref:'bound', name}`: "Each player may draw a card, then each player who drew a card this way gains 1 life" (Kwain),
   * "each opponent who does can't attack you" (The Second Doctor), "If a player does, creatures that player controls can't attack you" (Orzhov Advokist). A player
   * "did" it as `StepResult.performed` says for one player (they chose it and it was carried out: CR 603.12); the others are not bound. A group `may` that did not run, or
   * that nobody did, binds nobody (CR 609.3). The same name still answers `{q:'resultCount'}` and `did` as before (no new capability: `bound` is read as ever).
   */
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
   * edh-replace-5 INTERFACE CHANGE (additive): `anyAmount`, "you may pay any amount of {R}" (CR 118.12, 608.2d): the same, with no most but what the payer can pay. Capability `op:pay.anyAmount`.
   */
  /**
   * edh-top-6 INTERFACE CHANGE (additive), CR 101.4, 118.12, 608.2d (join forces; Minds Aglow): `startingWith` with `anyAmount` and a group in `who`: each player of the group, in turn
   * order beginning with `startingWith`, may pay any amount of the cost (generic mana only), each seeing what was paid before; the step's count is the TOTAL paid by all of them
   * (`resultCount`, "the total amount of mana paid this way"). Capability `op:pay.eachStartingWith` (effects/handlers/pay.ts#OP_FORMS).
   * edh-players-6 INTERFACE CHANGE (additive), CR 107.3, 118.12, 608.2h: `xMax`, "you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards"
   * (Well of Lost Dreams): the X the controller chooses as they pay ({X} in the mana cost, effects/handlers/pay.ts#choosesX) is at most this number, read as the step runs; a
   * number that can't be read means no payment. Only with a variable mana cost and the controller as payer. Capability `op:pay.xMax` (effects/handlers/pay.ts#OP_FORMS).
   */
  /**
   * edh-c-57 INTERFACE CHANGE (additive), CR 101.4, 118.12, 608.2c-d (Argothian Wurm ruling 2007-02-01; Carrion Rats): `everyPlayer`, "Any player may sacrifice a land. If a player does, ..." with a group in
   * `who`: EVERY player of the group, in turn order beginning with the active player (CR 101.4), is offered the payment, also after one has paid; `then` runs once if at least one of them paid, `else`
   * is not used. Without it a group in `who` is offered the payment until one pays ("unless any player pays"). Capability `op:pay.everyPlayer` (effects/handlers/pay.ts#OP_FORMS).
   */
  | (StepBase & { op: 'pay'; who: PlayerRef; cost: CostDef; times?: Quantity; /** edh-d-74 INTERFACE CHANGE (additive), CR 702.24a (Hibernation's End, Thought Lash): the payment is a cumulative upkeep's: whether the controller paid it is an event, `payCumulativeUpkeep` ("whenever you pay ~'s cumulative upkeep") or `failCumulativeUpkeep` ("when a player doesn't pay ~'s cumulative upkeep"), seen before the unpaid branch (the sacrifice) runs. Written by keywords/data/cumulative-upkeep.json only. Capability `op:pay.cumulativeUpkeep`. */ cumulativeUpkeep?: true; /** edh-d-45 INTERFACE CHANGE (additive), CR 118.12, 118.7 (Draco): "This cost is reduced by {2} for each basic land type among lands you control": the generic mana of `cost` is reduced by this amount (never below zero) as the payment is offered. Mana-only costs. Capability `op:pay.reduceBy`. */ reduceBy?: Quantity; upTo?: Quantity; anyAmount?: true; startingWith?: PlayerRef; mandatory?: boolean; then?: EffectStep[]; else?: EffectStep[]; xMax?: Quantity; everyPlayer?: true; /** edh-next-139 INTERFACE CHANGE (additive), CR 608.2c-d, 119.4 (Plague of Vermin): with `startingWith` and `anyAmount`, what EACH player paid is kept under this link for the rest of the resolution (`LinkValue.byPlayer`, added up over the runs of a repeated process; read by `chosenNumber` with `of`). Capability `op:pay.byPlayerLink`. */ link?: LinkId })
  /**
   * one at a time (CR 608.2f). std-rx32 INTERFACE CHANGE (additive): `gather`, the name a step of `do` binds in each iteration; after the loop it stands for what
   * every iteration bound under it, together ("For each creature card exiled this way, create a token that's a copy of it. ... sacrifice those tokens.")
   */
  /**
   * edhd63 INTERFACE CHANGE (additive), CR 101.4, 608.2c (Order of Succession): `inDirection`, with players in `over`: "Starting with you and proceeding in the chosen direction, each player ...":
   * the players are taken one at a time beginning with the controller, then each next player on the side the link `inDirection` chose (left: the next in turn order; right: the previous), instead of
   * in turn order from the active player. A link that holds neither side: nobody is taken. Capability `op:forEach.inDirection` (effects/handlers/control.ts#OP_FORMS).
   */
  | (StepBase & { op: 'forEach'; over: Ref; as: Name; do: EffectStep[]; gather?: Name; inDirection?: LinkId })
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
  /*
   * edh-zones-5 INTERFACE CHANGE (additive): `optional`, "You may repeat this process any number of times." (Ad Nauseam; CR 608.2c, 608.2d): a process repeat (`process`)
   * whose runs are asked for one at a time: after the instructions before it ran once, the controller is asked before each further run whether to do it again, and
   * the loop ends at the first "no". `times` is 1 and unread. Capability `op:repeat.optional`.
   */
  /*
   * edh-zones-10 INTERFACE CHANGE (additive): `until`, "Repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes
   * first." (Tainted Pact; CR 608.2c): a process repeat whose runs are the whole process, done at least once and again for as long as the condition is false after a run
   * (`do` holds the process: the instructions before the marker move into it, parser/lower/repeat-process.ts); `times` is 1 and unread. A run that did nothing ends the loop (an
   * empty library). `gather` is the group "the cards exiled this way": the objects the instruction of `do` named `of` took in each run are added to the group bound as `as`
   * once the run is over, so inside a run it holds the earlier runs' objects only and in `until` all of them. Capability `op:repeat.until`.
   */
  | (StepBase & { op: 'repeat'; times: Quantity; do: EffectStep[]; process?: true; again?: true; optional?: true; until?: Condition; gather?: { as: Name; of?: Name } })
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
   * edh-zones-4 (additive): `distinct: 'name'`, "Return any number of permanent cards with different names from your graveyard to the battlefield" (Eerie Ultimatum; CR 201.2,
   * 608.2d): no two objects chosen together have a name in common (the objects share a name when they have one in common, as a search for different names).
   */
  /**
   * audit-fix-1 INTERFACE CHANGE (additive): `damageSource`, "a source of your choice" (CR 609.7a; from memory, unverified): an ability on the stack is also offered
   * when its source (the object it refers to, by last known information once it has left its zone) matches `from`'s filter, and a chosen ability binds that
   * source, not the ability (abilities are never sources of damage); a chosen permanent spell also covers the permanent it becomes
   * (effects/replacements.ts#standsForSource). Only with `from` an `each` filter and neither `perPlayer` nor `startingWith`. Capability `op:chooseObjects.damageSource`.
   */
  /**
   * edh-next-142 INTERFACE CHANGE (additive), CR 105.5, 105.2b, 608.2d (Niv-Mizzet Reborn; rulings 2019-05-03): `eachColorPair`, "for each color pair, choose a card that's exactly those colors from
   * among them": for each of the ten color pairs in turn the chooser takes one of the objects that are exactly those two colors, when there is one (as many as they can; an object of any other
   * number of colors is never taken). `as` binds every object taken. Capability `op:chooseObjects.eachColorPair`.
   */
  /**
   * edh-next-135 INTERFACE CHANGE (additive), CR 101.4, 608.2d (Rejoin the Fight: "Then starting with the next opponent in turn order, each opponent chooses a creature card in your graveyard
   * that hasn't been chosen."): `unchosen`, with `startingWith`: each player chooses only among the objects no player chose before in this step (a player left with none chooses nothing).
   * Capability `op:chooseObjects.unchosen`.
   */
  | (StepBase & { op: 'chooseObjects'; who: PlayerRef; from: ObjRef; min: Count; max: Count; as: Name; random?: boolean; eachColorPair?: true; unchosen?: true; groupLimit?: { stat: 'power' | 'toughness' | 'manaValue'; cmp: NumberCmp }; perPlayer?: PlayerRef; startingWith?: PlayerRef; eachCardType?: true; link?: LinkId; distinct?: 'power' | 'toughness' | 'manaValue' | 'name'; /** edh-d-85 INTERFACE CHANGE (additive), CR 205.2a, 608.2d (Winter, Cynical Opportunist): "any number of cards ... with four or more card types among them": a nonempty set chosen must have at least this many different card types among its objects (a card of two types gives both); none chosen is always allowed. The chooser's answer is checked (core/validate.ts). Only without `perPlayer`, `startingWith`, `eachCardType`, `distinct`, `random`. Capability `op:chooseObjects.cardTypesAtLeast`. */ cardTypesAtLeast?: number; damageSource?: true })
  /**
   * std-rx28 INTERFACE CHANGE (additive): `cardKind`, of a card name only: "choose a land card name" / "a nonland card name" (CR 201.3; ChooseNameDecision.cardKind).
   */
  /**
   * std-combat-5 INTERFACE CHANGE (additive): `secret`, "secretly choose Human, Merfolk, or Goblin" (A Killer Among Us; CR 608.2d, 607.2d): the value is known to the
   * chooser only until it is revealed: the link stores who knows it (`LinkValue.secret`), the client views of the other players leave the value out (core/view.ts) and
   * the log names it to the chooser only. A cost part `revealChosen` reveals it. Capability `feature:chooseValue.secret`.
   */
  /**
   * edh-players-8 INTERFACE CHANGE (additive): `mostLife`, "choose a player with the most life or tied for most life" (The Black Gate; CR 119.1, 608.2d): with `what: 'player'`,
   * only the players of the game whose life total is at least that of every other player in it are offered (every player when all are tied), as the choice is made; a
   * player who has left the game is not counted. Capability `op:chooseValue.mostLife` (effects/handlers/choose.ts#OP_FORMS).
   */
  | (StepBase & { op: 'chooseValue'; who: PlayerRef; /** edh-next-129 INTERFACE CHANGE (additive), CR 506.1, 508.1, 608.2d (Territorial Hellkite; rulings 2017-08-25): with `what: 'opponent'`, "an opponent ... that this creature didn't attack during your last combat": the opponents this source (the same object) attacked as players during the latest combat phase of a turn of the chooser before the current one are never offered; a source that did not attack then, or no earlier combat of theirs, excludes nobody. With every opponent excluded nothing is chosen. Capability `op:chooseValue.notAttackedLastCombat`. */ notAttackedLastCombat?: true; /** edh-perms-15 INTERFACE CHANGE (additive): `counterKind`, "choose a counter on <permanent or player>" (CR 122.1, 608.2d): a kind of counter the `counterOn` holder has now; capability `op:chooseValue.counterKind` */ what: ChoiceKind | 'counterKind'; as: Name; link?: LinkId; /** edh-zones-26 INTERFACE CHANGE (additive), CR 608.2d (Tibalt's Trickery): with `what: 'number'`, the number from `min` to `max` is picked at random with the game's RNG, nobody chooses it ("Choose 1, 2, or 3 at random"); edh-c-14: also with `what: 'player' | 'opponent'` ("Choose an opponent at random", Ruhan of the Fomori); capability `op:chooseValue.random` */ random?: true; options?: string[]; min?: Quantity; max?: Quantity; exclude?: ChoiceExclusion[]; cardKind?: 'land' | 'nonland'; secret?: true; /** edh-next-120 INTERFACE CHANGE (additive), CR 608.2d (Wheel of Misfortune, Prisoner's Dilemma): with `secret` and several choosers, "..., then the choices are revealed": each player chooses without seeing the others' choices (logged to the chooser only), then, once every player has chosen, all the choices are revealed at once (logged to everyone, and the link keeps no `secret`). Capability `op:chooseValue.secretReveal` */ reveal?: true; mostLife?: true; /** edh-d-46 INTERFACE CHANGE (additive), CR 109.4, 608.2d (Boreas Charger): with `what: 'opponent'`, "choose an opponent who controls more lands than you": only the opponents who control more permanents matching the filter than the chooser (none: nothing is chosen and the later steps that read the choice do nothing). Capability `op:chooseValue.controlsMore` */ controlsMore?: ObjectFilter; /** edh-next-143 INTERFACE CHANGE (additive), CR 608.2d (Pir's Whim, Khorvath's Fury): "For each player, choose friend or foe.": the one chooser `who` makes a choice among `options` for each player of this group (APNAP order), and the link remembers the word chosen for each of them by player (the `chose` player reference reads it: "each friend"). Capability `op:chooseValue.forEachPlayer` */ forEachPlayer?: PlayerRef; /** edh-perms-15 (CR 122.1, 608.2d): with `what: 'counterKind'`, the holder whose counters are offered */ counterOn?: Ref; /** edh-next-128 INTERFACE CHANGE (additive), CR 122.1, 608.2d (Crystalline Giant: "choose a kind of counter at random that this creature doesn't have on it from among flying, first strike, ..., and +1/+1"): with `what: 'counterKind'` and `options` (and no `counterOn`), one of the listed kinds that this object has no counter of now (a keyword it has another way does not count, ruling 2020-04-17); every kind there already: nothing is chosen. Capability `op:chooseValue.counterKindNotOn` */ counterNotOn?: ObjRef })
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
  /**
   * edh-replace-4 INTERFACE CHANGE (additive): `excessToController`, "If the creature you control has trample, excess damage is dealt to that creature's controller
   * instead" (Ram Through; CR 120.4a, 120.10, 608.2c; Scryfall ruling 2020-04-17, trample-like): the damage to each CREATURE recipient is split into the lethal part
   * (the creature's toughness minus damage already marked, 1 from a deathtouch source, read before any replacement or prevention effect) and the excess, and the excess
   * is dealt to that creature's controller in the same damage event. A recipient that is not a creature gets all of it. Never together with `divided`, `also` or
   * `perSource` (the handler and the renderer refuse that shape). Capability `op:damage.excessToController` (effects/handlers/lifedamage.ts#OP_FORMS).
   */
  /**
   * edh-next-128 INTERFACE CHANGE (additive): `orPlaneswalker`, "~ deals damage equal to that spell's mana value to that player or a planeswalker that player controls"
   * (Vial Smasher the Fierce, Curse of the Pierced Heart; CR 608.2d, 120.3, 306.8): `to` is a player reference (one player, or several, each judged alone) and, as the step
   * resolves, the controller of the effect chooses for each of them that player or one planeswalker that player controls now (Scryfall ruling 2020-11-10: chosen while
   * the ability resolves, no player acts in between). Not a target (CR 115.1). Never together with `divided`, `also`, `perSource` or `excessToController` (the handler and
   * the renderer refuse that shape). Capability `op:damage.orPlaneswalker` (effects/handlers/lifedamage.ts#OP_FORMS).
   */
  /**
   * edh-next-139 INTERFACE CHANGE (additive), CR 608.2d, 120.2b (Master of the Wild Hunt): `divided: 'bySourceController'`, "deals damage equal to its power divided as its controller chooses
   * among any number of those Wolves": divided as the step resolves by the controller of the ONE source, among the recipients (no targets), 0 or more each, all of it given out. Capability
   * `op:damage.dividedBySourceController` (effects/handlers/lifedamage.ts#OP_FORMS).
   */
  | (StepBase & { op: 'damage'; source: ObjRef; to: Ref; amount: Quantity; orPlaneswalker?: true; divided?: 'announced' | 'evenlyRoundDown' | 'evenlyRoundUp' | 'bySourceController'; unpreventable?: boolean; also?: { to: Ref; amount: Quantity }[]; perSource?: boolean; excessToController?: true })
  | (StepBase & { op: 'gainLife'; who: PlayerRef; amount: Quantity; /** edh-players-17 INTERFACE CHANGE (additive), CR 119.3, 608.2c: "you and that player each gain N life": these players gain the same amount in the same step; a player named by both gains the two amounts as ONE life-gaining event (Angel of Destiny's ruling: damage redirected to you gains you twice that much, once). Capability `op:gainLife.also` */ also?: PlayerRef })
  | (StepBase & { op: 'loseLife'; who: PlayerRef; amount: Quantity; /** edh-next-93 (CR 728.1): the life loss of the rad counters' triggered ability only (core/rad.ts), which a `radiationGainsLife` rule turns into a gain; never written by the parser. */ radiation?: true })
  | (StepBase & { op: 'setLife'; who: PlayerRef; value: Quantity })
  // --- cards ---------------------------------------------------------------------
  /**
   * edh-players-1 INTERFACE CHANGE (additive): `upTo`, "Its controller may draw up to two cards" (Arcane Denial; CR 121.1, 608.2d, 609.3): each player of `who` chooses
   * how many cards to draw, from 0 to the count (the count is the most, never an obligation). Capability `op:draw.upTo` (effects/handlers/cards-draw.ts#OP_FORMS).
   */
  | (StepBase & { op: 'draw'; who: PlayerRef; count: Quantity; upTo?: true; /** edh-next-136 INTERFACE CHANGE (additive), CR 121.1, 701.20a, 614.11 (Jace, Mirror Mage: "Draw a card and reveal it."; rulings 2020-09-25): one player draws ONE card and reveals it as it is drawn; `as` names that card. A draw a replacement effect replaced (or changed into other draws) reveals and names nothing. Only with a count of 1 and one player. Capability `op:draw.revealDrawn` */ revealDrawn?: true })
  /**
   * C6 INTERFACE CHANGE (additive): `cantAs` names the players of `who` who can't do what the step tells them, "Each opponent discards a card. Each opponent who
   * can't loses 3 life." (CR 101.3: the part of an instruction that is impossible is ignored, and the card may say what happens instead; CR 608.2c, 608.2e):
   * the players who could not discard as many cards as the step asks (an empty hand, cards that can't be discarded). Capability `op:discard.cantAs`.
   */
  | (StepBase & { op: 'discard'; who: PlayerRef; count: Quantity | 'hand'; filter?: ObjectFilter; mode?: 'choose' | 'random' | 'opponentChooses'; cantAs?: Name })
  | (StepBase & { op: 'mill'; who: PlayerRef; count: Quantity })
  | (StepBase & { op: 'scry'; who: PlayerRef; count: Quantity })
  | (StepBase & { op: 'surveil'; who: PlayerRef; count: Quantity })
  /**
   * edh-next-135 INTERFACE CHANGE (additive), CR 603.12, 701.20a (Invasion of Tarkir: "Reveal any number of Dragon cards from your hand. When you do, ..."; ruling 2023-04-14): `anyNumber`,
   * the reveal of a chosen "any number" of cards is done even when the player chose none (a reflexive "when you do" triggers, its count 0). Capability `op:reveal.anyNumber`.
   */
  | (StepBase & { op: 'reveal'; who: PlayerRef; what: ObjRef; to?: 'all' | PlayerRef; anyNumber?: true })
  /**
   * edh-next-126 INTERFACE CHANGE (additive): `rebind`, "As many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at
   * the top five cards of your library. Then shuffle and put the last cards you looked at this way on top in any order." (Lim-Dûl's Vault; CR 608.2c, 608.2d): a look that binds
   * `as` again: the cards it looks at replace the group an earlier look on the same path bound under that name, so "those cards" of the next run and "the last cards you looked at
   * this way" are the cards the last look saw (model/lint-flow.ts lets only such a look name a bound group again). Capability `op:look.rebind`.
   */
  | (StepBase & { op: 'look'; who: PlayerRef; at: ObjRef; rebind?: true })
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
  /**
   * edh-zones-10 INTERFACE CHANGE (additive): `groupLimit`, "search your library for any number of creature cards with total mana value 6 or less" (Protean Hulk; CR 701.23a,
   * 202.3, 608.2d): a limit on a statistic summed over the cards found together, as `chooseObjects.groupLimit` (the searcher's answer must keep the total; a card is
   * never forced). Capability `op:search.groupLimit`.
   */
  /**
   * edh-c-32 INTERFACE CHANGE (additive), CR 701.23a-b: `publicRequired`, "Search its controller's graveyard, hand, and library for all cards with the same name as that creature and
   * exile them" (Eradicate, Splinter; Scryfall rulings 2005-02-01: "The copies must be found if they are in publicly viewable zones. Finding copies while searching private zones is
   * optional."): of the zones searched, the cards that match in a public zone (a graveyard) are all found, where those in a hidden zone (hand, library) may be left (CR 701.23b).
   * Only with `allZones` and `max: 'any'`. Capability `op:search.publicRequired`.
   */
  /**
   * edh-next-135 INTERFACE CHANGE (additive), CR 701.23a, 208.1 (Threats Undetected: "Search your library for up to four creature cards with different powers"; ruling 2022-09-09): `differentPowers`,
   * no two of the cards found have the same power (each card is taken one at a time, those with a power already taken are no longer offered). Never beside `differentNames`. Capability
   * `op:search.differentPowers`.
   */
  | (StepBase & { op: 'search'; who: PlayerRef; zone: ZoneName; alsoZones?: ZoneName[]; allZones?: true; publicRequired?: true; owner?: PlayerRef; filter: ObjectFilter; min?: Count; max: Count; reveal?: boolean; differentNames?: true; differentPowers?: true; and?: ObjectFilter[]; alsoOutside?: true; shareLandType?: true; groupLimit?: { stat: 'power' | 'toughness' | 'manaValue'; cmp: NumberCmp }; as: Name })
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
  /**
   * edh-d-102 INTERFACE CHANGE (additive): `count`, "exile cards from the top of your library until you exile X permanent cards, where X is the number of times ~ has mutated"
   * (Auspicious Starrix; CR 406.1, 107.3, 608.2c, 608.2h): the loop goes on until that many cards that match `filter` are exiled (or the library is empty), the count worked
   * out once as the step begins; `as` then names every matching card it exiled ("Put those permanent cards onto the battlefield"). A count of 0 or less exiles nothing. Only
   * with `who` you and no `total`. Capability `op:exileUntil.count`.
   */
  | (StepBase & { op: 'exileUntil'; who: PlayerRef; filter: ObjectFilter; total?: { stat: 'manaValue'; atLeast: Quantity }; count?: Quantity; link?: LinkId; exiled?: Name })
  /**
   * r3-dig INTERFACE CHANGE (additive): "reveal cards from the top of your library until you reveal a land card" (CR 701.20a-b, 401.1, 608.2c): `who` reveals
   * the top card of their library, then the next, until `count` (default 1) cards that match `filter` are revealed or the library has no more; the cards stay
   * in the library. `as` names the matching cards ("that card", "those land cards"), `revealed` every card revealed (so "the rest" is `revealed` less `as`).
   * Capability `op:revealUntil`.
   * trek-13 (additive; CR 101.4, 701.20a): `who` may be several players ("Each opponent reveals cards from the top of their library until they reveal a creature card", Gift of
   * Perfection): each of them in turn reveals from their own library; `as` then names every card they stopped at and `revealed` every card revealed.
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
  /**
   * edh-next-135 INTERFACE CHANGE (additive), CR 700.3, 406.3, 608.2d: `second` "Exile the top three cards of your library in a face-down pile, then exile the top three cards of your
   * library in another face-down pile. Look at the cards in each pile, then turn a pile of your choice face up. An opponent chooses one of those piles." (Hostile Negotiations): the piles
   * are given (`cards` is the first pile, `second` the other): nobody separates. With `turnUp`, the separator looks at both piles and turns one pile of their choice face up (every player
   * sees its cards); the chooser then picks a pile knowing that pile's cards and the other pile's size. Never beside `faceDown`. Capability `feature:piles.given`.
   */
  | (StepBase & { op: 'piles'; cards: ObjRef; separator: PlayerRef; chooser: PlayerRef; chosen: Name; other: Name; faceDown?: true; second?: ObjRef; turnUp?: true })
  // --- moving objects --------------------------------------------------------------
  /**
   * FAST5X E13 INTERFACE CHANGE (additive): `remember`: each permanent this step puts onto the battlefield remembers `what` under `link` in ITS OWN link store
   * (the new object, CR 400.7; read by its abilities as `{ref:'linked', link}`, CR 607.2a): craft's "the exiled cards used to craft it" (CR 702.167c).
   * Capability `op:move.remember`.
   */
  | (StepBase & { op: 'move'; what: ObjRef; to: Destination; until?: Duration; link?: LinkId; remember?: { link: LinkId; what: ObjRef } })
  /**
   * edh-mana-keywords-7 INTERFACE CHANGE (additive), CR 701.8a, 614.6, 608.2c (Terastodon: "For each permanent put into a graveyard this way, its controller creates ..."):
   * `boundTo: 'graveyard'`, the objects `as` binds are only those that went to a graveyard; one a replacement effect exiled instead (Rest in Peace) is not "put into a graveyard
   * this way". Written by the parser (lower/quantities.ts) only where the words say so.
   */
  | (StepBase & { op: 'destroy'; what: ObjRef; regeneration?: 'allowed' | 'cant'; boundTo?: 'graveyard' })
  | (StepBase & { op: 'sacrifice'; what: ObjRef; /** edh-d-88 INTERFACE CHANGE (additive), CR 701.21a, 608.2e (Vaevictis Asmadi, the Dire: "Those players sacrifice those permanents."): each permanent `what` names is sacrificed by its own controller, all at the same time (without it, only those the effect's controller controls). Capability `op:sacrifice.byControllers` */ byControllers?: true })
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
  /**
   * edh-d-28 INTERFACE CHANGE (additive; CR 608.2d, 701.21a; Tyrant of Discord): `mode: 'random'`, "target opponent chooses a permanent they control at random and sacrifices it": no player chooses,
   * the game picks `count` of the permanents the player controls that match `filter` at random (uniformly, without replacement; all of them when there are no more than `count`). Not with
   * `chooser`, `keepTypes`, `keepFilter` or `exploit`. Capability `op:sacrificeChoice.random`.
   */
  /**
   * edh-next-147 INTERFACE CHANGE (additive; CR 700.8, 608.2d-e, 701.21a; Stick Together): `mode: 'keepParty'`, "each player chooses a party from among creatures they control, then
   * sacrifices the rest": each player of `who`, in APNAP order, chooses up to one each of a Cleric, a Rogue, a Warrior and a Wizard among the permanents they control that match
   * `filter` (one creature answers for one of the four only, whatever its creature types: CR 700.8), then every other such permanent they control is sacrificed, all at the same
   * time. `count` is unread (1). Not with `keepTypes`, `keepFilter`, `chooser`, `cantAs` or `exploit`. Capability `op:sacrificeChoice.keepParty`.
   */
  | (StepBase & { op: 'sacrificeChoice'; who: PlayerRef; filter: ObjectFilter; count: Quantity; mode?: 'choose' | 'all' | 'keepEachType' | 'random' | 'keepParty'; cantAs?: Name; exploit?: true; keepTypes?: string[]; keepFilter?: ObjectFilter; chooser?: PlayerRef })
  /**
   * std-rx30 INTERFACE CHANGE (additive): `toIf`, "If a permanent spell is countered this way, exile it instead of putting it into its owner's graveyard." (Thranduil's
   * Decree; CR 701.6a, 614.15): `to` applies only to a countered spell that matches it as it is countered; any other goes to its owner's graveyard. Capability
   * `op:counter.toIf`.
   * std-rx30 INTERFACE CHANGE (additive): `sourceEffect`, "If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all
   * abilities for as long as this creature remains on the battlefield." (Tishana's Tidebinder; CR 701.6a, 113.7, 611.2a): a continuous effect with these `mods` and
   * this `duration` on the source of each ability the step counters that is a permanent matching `filter` as it is countered. Capability `op:counter.sourceEffect`.
   */
  | (StepBase & { op: 'counter'; what: ObjRef; to?: Destination; toIf?: ObjectFilter; sourceEffect?: { filter: ObjectFilter; duration: Duration; mods: Modification[] }; /** edh-d-43 (CR 701.6a, 113.7a, 701.8a, 602.5; Green Slime, Trickbind): what happens to the permanent that is the source of each ability the step counters (a permanent matching `filter` as it is countered): `destroy` it, or `cantActivate`, its activated abilities, mana abilities too, can't be activated this turn. Capability `op:counter.sourceThen`. */ sourceThen?: { filter: ObjectFilter; do: 'destroy' | 'cantActivate' } })
  /**
   * cmd1 INTERFACE CHANGE (additive): `attacking` may name the player the tokens attack (CR 508.4: "for each opponent, create a 1/1 white Soldier creature token that's
   * tapped and attacking that opponent"), as a token copy's does (`AttackingWhom`); `true` lets the controller choose. Capability `feature:createToken.attackingWhom`.
   */
  /**
   * edh-combat-4 INTERFACE CHANGE (additive), CR 506.3e, 509.3a: `blocking`, "create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature"
   * (Brimaz, King of Oreskos): the attacking creature `blocking` names (when it is one); the tokens become blocking creatures if their controller is the player it attacks
   * (never declared as blockers, so nothing that triggers on blocking triggers). Capability `feature:createToken.blocking`.
   */
  | (StepBase & { op: 'createToken'; who: PlayerRef; token: TokenDef; count: Quantity; exceptReplaced?: true; tapped?: boolean; attacking?: boolean | AttackingWhom; blocking?: ObjRef; attachTo?: ObjRef; counters?: CounterSpec[]; link?: LinkId })
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
  /**
   * edh-perms-21 INTERFACE CHANGE (additive), CR 607.2c (objects "created with [this object]"), Faerie Artisans ruling 2016-11-08: with `result: 'token'`, `link`, the tokens this step creates are added to what the source object
   * remembers under this link, for a later read `{ref:'linked', link}` ("all other tokens created with ~"). Capability `op:copy.link`.
   */
  | (StepBase & { op: 'copy'; /** edh-next-131 INTERFACE CHANGE (additive), CR 303.4f, 301.5c, 707.2 (Arna Kennerüd, Skycaptain): with `result: 'token'`, "a copy of that permanent attached to that creature": each token copy of an Aura or Equipment enters attached to that object (an Aura that can't enchant it is not created; an Equipment that can't equip it enters unattached). Capability `op:copy.attachTo` */ attachTo?: ObjRef; /** edh-next-137 INTERFACE CHANGE (additive), CR 707.9b, 707.10, 306.5b (Ob Nixilis, the Adversary): with `result: 'spell'`, "the copy has starting loyalty X": the copy's printed loyalty (a copiable value) is this amount, worked out as the copy is made; the token permanent it becomes enters with that many loyalty counters. Capability `op:copy.startingLoyalty`. edh-next-136 (CR 707.9b, 306.5b; Jace, Mirror Mage): with `result: 'token'`, "except ... its starting loyalty is 1": a fixed number only, the token copies' loyalty, a copiable value (statics/copy.ts, CopyExcept `startingLoyalty`; capability `op:copy.except`; any other amount on a token copy is `op:copy.startingLoyalty.other`, never registered) */ startingLoyalty?: Quantity; link?: LinkId; /** edh-next-114 INTERFACE CHANGE (additive), CR 707.9e, 122.6, 111.1 (Littjara Mirrorlake): with `result: 'token'`, "except it enters with an additional +1/+1 counter on it": the counters each token copy enters with, on top of the copiable values (not part of them). Capability `op:copy.counters` */ counters?: CounterSpec[]; what: ObjRef; result: 'spell' | 'token'; who: PlayerRef; count?: Quantity; newTargets?: boolean | 'may'; except?: Modification[]; noManaCost?: true; /** edh-next-122 INTERFACE CHANGE (additive), CR 702.128b: the tokens are "embalmed" (the embalm keyword's expansion, keywords/data/embalm.json): they enter with the `embalmed` fact and keep the mark. Capability `op:copy.embalmed` */ embalmed?: true; tapped?: boolean; attacking?: boolean | AttackingWhom; gains?: { add: AbilityDef[]; ifPermanent?: true }; /** edh-cast-14 INTERFACE CHANGE (additive), CR 707.10, 707.10c, 115.1, 601.2c (Zada, Hedron Grinder): with `result: 'spell'`, one copy of the spell for each object `retargetEach` names that is a legal target for every target the spell has; each copy targets only that object, in every place the original has a target (a different one for each copy), and its controller puts the copies onto the stack in the order they choose. Only a spell all of whose target lists have exactly one target and no `distinctFrom`; any other spell is copied by hand. Capability `op:copy.retargetEach`. */ retargetEach?: ObjRef; /** edh-next-74 INTERFACE CHANGE (additive), CR 707.10c, 115.1, 601.2c (Radiate, Radiant Performer): "copy that spell for each other permanent or player the spell could target. Each copy targets a different one of those permanents and players.": like `retargetEach` over every permanent and every player (not the object or player the original targets), of a spell OR ability on the stack. Needs `different`. Capability `op:copy.retargetAll`. */ retargetAll?: true; /** edhd60 INTERFACE CHANGE (additive), CR 707.10c, 115.1, 601.2c (Frontline Heroism): "Copy that spell. The copy targets that token.": with `result: 'spell'`, the one copy of the spell targets only this object in every place the original has a target; the object must be a legal target for each (else the copy is made by hand). Capability `op:copy.targetsObject` */ targetsObject?: ObjRef; /** edh-cast-14: with `retargetEach`, "Each copy targets a different one of those creatures." (written by the second sentence; the handler copies by hand without it) */ different?: true; /** edh-next-130 INTERFACE CHANGE (additive), CR 603.10a, 608.2h, 707.2 (Shelob, Child of Ungoliant; Hofri Ghostforge, ruling 2021-04-16: "the copiable values of the creature as it last existed on the battlefield before it died, not as it existed in the graveyard"): with `result: 'token'`, an object that has left the battlefield since is copied as it last existed THERE (its last known information on the battlefield, CR 400.7 links); one whose last battlefield form showed other characteristics than its card (it was a copy, or an effect changed it) is copied by hand. Capability `op:copy.lastOnBattlefield` */ lastOnBattlefield?: true; /** edh-next-130 INTERFACE CHANGE (additive), CR 607.2a, 607.1 (Hofri Ghostforge, ruling 2021-04-16: the token's granted ability "is linked to" the ability that made it; "Each Spirit token ... refers only to the card you exile during the resolution of the ability that created that token"): with `result: 'token'`, each token's own link store `linkCopied` holds the object it was copied from, where that object is now, when it is in exile (the granted ability's "the exiled card" reads it). Capability `op:copy.linkCopied` */ linkCopied?: LinkId; /** edh-cast-15 INTERFACE CHANGE (additive), CR 707.10, 113.7a: "copy all OTHER activated and triggered abilities you control" (Ulalek): the ability whose instructions these are, on the stack now, is not copied. Capability `op:copy.exceptThis` */ exceptThis?: true })
  /**
   * r4-fxb INTERFACE CHANGE (additive): "Change the target of target spell or ability with a single target." (CR 115.7, 115.7a): `who` changes the one target of
   * each spell or ability `what` names to another legal target of it (legal for that spell or ability, as if it had been chosen for it); with no other legal
   * target the target is unchanged. The new target becomes a target of it (CR 603.2: "becomes the target" triggers, ward). Capability `op:changeTarget`.
   */
  /**
   * edh-cast-1 INTERFACE CHANGE (additive): `to`, "Change a target of target spell or ability to ~" (Spellskite), "change the target of target instant or sorcery spell with a single
   * target to this creature" (Hydroelectric Specimen): `who` changes ONE target of each spell or ability `what` names to the object `to` names, when that object is a legal
   * target for that target (CR 115.7b, 115.3): it is not already a target of the same instance of the word "target", and the spell's target spec
   * allows it. When the spell or ability has several targets `who` chooses which one to change. With no target that can be changed to it, nothing changes. Capability
   * `op:changeTarget.to` (effects/handlers/change-target.ts#OP_FORMS).
   */
  | (StepBase & { op: 'changeTarget'; who: PlayerRef; what: ObjRef; to?: ObjRef })
  /**
   * edh-next-134 INTERFACE CHANGE (additive), CR 508.4, 506.3, 701.26a (Midnight Crusader Shuttle: "tap it, and it's attacking that player"): `attacking`, each creature the step
   * names (tapped now or already tapped) becomes an attacking creature in the combat in progress, attacking the player `defender` names: it was never declared as an attacker (no
   * "attacks" trigger, no attack cost or restriction, CR 508.4), and only a creature its controller (the active player) controls attacking an opponent of that controller joins
   * (rules/status.ts#enterAttackingChoosing). Capability `op:tap.attacking`.
   */
  /** edh-d-94 INTERFACE CHANGE (additive), CR 701.26a, 608.2c (Suppression Ray): `changedOnly`, the step's `as` names only the permanents this step tapped ("creatures tapped this way"), not one that was tapped already (ruling 2024-06-07). Capability `op:tap.changedOnly` (effects/handlers/zones-status.ts#TAP_OP_FORMS). */
  | (StepBase & { op: 'tap'; what: ObjRef; attacking?: AttackingWhom; changedOnly?: true })
  | (StepBase & { op: 'untap'; what: ObjRef })
  /** edh-mana-keywords-12 (CR 701.3a, 301.5c; Luxior, Giada's Gift): `asCreature`, "Equip planeswalker" attaches "as though that planeswalker were a creature" (ruling 2022-04-29): the host need not be a creature as the Equipment is attached. Capability `op:attach.asCreature`. */
  | (StepBase & { op: 'attach'; what: ObjRef; to: ObjRef | Extract<PlayerRef, { ref: 'randomOpponent' | 'anOpponent' }> | null; /* edh-d-29 (CR 303.4, 601.7a; Lynde, Cheerful Tormentor): `anOpponent`, "attach a Curse attached to you to one of your opponents": the controller picks the opponent as the step resolves */ /* edh-top-14 (CR 303.4, 701.3a): a random opponent for an Aura that enchants players (Maddening Hex); the ref is a player, never an object */ asCreature?: true; /* edh-top-15 (CR 701.3d, 608.2c; Akiri): with `to: null`, binds the permanents the unattached objects were attached to (as they were), under this name: "unattach an Equipment from a creature you control. If you do, tap that creature". Capability `op:attach.hostAs`. */ hostAs?: Name })
  | (StepBase & { op: 'changeFace'; what: ObjRef; to: 'transform' | 'convert' | 'faceUp' | 'faceDown' | 'flip'; manifest?: boolean; /** edh-mana-keywords-12: with `to: 'faceDown'`, the set characteristics it gets (FaceDownSet); capability `feature:faceDown.set` */ faceDownAs?: FaceDownSet; /** edh-d-101 INTERFACE CHANGE (additive), CR 406.3, 400.2 (The Creation of Avacyn): with `to: 'faceUp'`, the face-down CARDS in exile `what` names are turned face up there (every player sees them; no permanent is turned face up, so nothing "turned face up" triggers). Capability `op:changeFace.faceUp.exile` (effects/handlers/change-face.ts). */ inExile?: true })
  /**
   * edh-perms-22 (CR 702.26b, 610.3, 702.26d): `until` is "phases out until ~ leaves the battlefield" (the one form: `{d:'until', event: the source leaves the battlefield}`): the
   * permanents do not phase in during an untap step but all together when that happens (effects/until-return.ts); `tapped` is "Tap that creature as it phases in this way"
   * (they phase in tapped). Capability `op:phaseOut.until` (effects/handlers/zones-status.ts#OP_FORMS); `tapped` only with `until`.
   */
  | (StepBase & { op: 'phaseOut'; what: ObjRef; until?: Duration; tapped?: boolean })
  /**
   * edhn102 INTERFACE CHANGE (additive), CR 702.26b-c, 702.26g, 603.7 (The Pandorica: "When ~ becomes untapped or leaves the battlefield, that permanent phases in."): the
   * phased-out permanents `what` names phase in now, with what phased out with them (rules/phasing.ts#phaseInPermanent); "Permanents can't phase in" / "It can't phase in for as
   * long as ..." keep a permanent out (statics/hooks.ts#phaseInDenied). A permanent that is not phased out does nothing. Capability `op:phaseIn` (effects/handlers/zones-status.ts).
   */
  | (StepBase & { op: 'phaseIn'; what: ObjRef })
  | (StepBase & { op: 'regenerate'; what: ObjRef; duration?: Duration })
  | (StepBase & { op: 'removeFromCombat'; what: ObjRef })
  /**
   * edh-next-135 INTERFACE CHANGE (additive), CR 608.2d, 701.20a (Gollum, Scheming Guide: "... then choose land or nonland. An opponent guesses whether the top card of your library is the
   * chosen kind. Reveal that card. If they guessed right, ..."; rulings 2023-06-16; Master of Predicaments: "choose a card in your hand. That player guesses whether the card's mana value is
   * greater than 4. If the player guessed wrong, ..."): with two or more `kinds` (each a word and the cards it means) `chooser` chooses one of them first; with one, that is the question. Then
   * `guesser` guesses whether the card `card` stands for (one card) is of that kind; with `reveal` the card is then revealed (also after a right guess; without it, nobody else sees it,
   * ruling 2014-07-18). A kind without `word` is said from its filter (a mana value comparison). The step is done (`did`) when the guess was right; with no such card (an empty library) no guess is right. Capability `op:guess`.
   */
  /**
   * edh-next-135 INTERFACE CHANGE (additive), CR 101.4, 608.2c, 303.4f (Thieves' Auction: "Starting with you, each player chooses one of the exiled cards and puts it onto the battlefield tapped
   * under their control. Repeat this process until all cards exiled this way have been chosen."; rulings 2004-10-04, 2005-08-01): the players in turn order from `startingWith`, again and
   * again, each choose one card of `cards` still in exile and put it onto the battlefield (`tapped`) under their own control, until none is left. A card that can't be put onto the
   * battlefield now (an Aura with nothing to enchant) stays exiled and can't be chosen until another card was put; when no card left can be put, the rest stay exiled. Capability `op:auction`.
   */
  | (StepBase & { op: 'auction'; cards: ObjRef; startingWith: PlayerRef; tapped?: true })
  | (StepBase & { op: 'guess'; chooser: PlayerRef; guesser: PlayerRef; card: ObjRef; kinds: { word?: string; filter: ObjectFilter }[]; reveal?: true })
  /**
   * p2-combat-flow-2 INTERFACE CHANGE (additive): "Target unblocked attacking creature becomes blocked", "Attacking creatures become blocked" (CR 509.1h, 506.4):
   * each attacking creature `what` names that is not blocked becomes a blocked creature with no creature blocking it (it stays blocked for the rest of combat and
   * deals no combat damage unless it has trample or an effect lets it assign as though unblocked, CR 510.1c). "Becomes blocked" abilities of it trigger (CR 509.3c),
   * once; "becomes blocked by a creature" ones do not (no blocker). Capability `op:becomeBlocked`.
   */
  | (StepBase & { op: 'becomeBlocked'; what: ObjRef })
  /**
   * edh-top-2 INTERFACE CHANGE (additive), CR 702.95a-e: soulbond's "you may pair [what] with [with]": the two creatures become paired if both are creatures on the
   * battlefield under the control of the ability's controller, neither is paired and they are two objects (702.95c: otherwise neither becomes paired); each names the
   * other as its partner (`GameObject.pairedWith`). `with` stands for one creature (the one chosen, the one that entered). Capability `op:pair` (effects/handlers/pair.ts).
   */
  | (StepBase & { op: 'pair'; what: ObjRef; with: ObjRef })
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
  /**
   * edh-c-111 INTERFACE CHANGE (additive): `by: 'toughness'`, "Each of those creatures deals damage equal to its toughness to the other" (Grim Contest; CR 120.2b, 608.2b,
   * Scryfall ruling 2014-11-24): the two creatures `a` and `b` each deal damage equal to their toughness to the other at the same time (all read before any damage), but it
   * is NOT a fight (CR 701.14 does not apply: nothing "fights"); if either is an illegal target or no longer a creature on the battlefield, neither deals damage. Never with
   * `pairs`. Capability `op:fight.toughness` (effects/handlers/lifedamage.ts#OP_FORMS).
   */
  | (StepBase & { op: 'fight'; a: ObjRef; b: ObjRef; pairs?: true; by?: 'toughness' })
  /**
   * p2-pt-1 INTERFACE CHANGE (additive): `lifeToughness`, "exchange your life total with ~'s toughness" (Tree of Redemption, CR 701.12a, 613.4b): `a` is one player, `b`
   * one permanent. The player gains or loses the life needed to make their life total the creature's toughness, and the creature's toughness becomes the player's
   * former life total (a layer-7b effect with no duration). Capability `op:exchange.lifeToughness` (effects/handlers/zones-status.ts).
   */
  /**
   * edh-zones-26 INTERFACE CHANGE (additive), CR 701.21a, 400.7, 608.2b, 608.2c (Goblin Welder): `what: 'sacrificeReturn'`, "that player simultaneously sacrifices the artifact and returns the
   * artifact card to the battlefield": `a` the permanent (the controller of it sacrifices it), `b` the card in the graveyard of that player that returns under that player's control. Both
   * must still be there and `b` still in that player's graveyard, else neither happens (the ruling of 2008-08-01). Capability `op:exchange.sacrificeReturn`.
   */
  /**
   * edh-c-13 INTERFACE CHANGE (additive), CR 701.12a, 613.4b, 611.2a (Serene Master): `what: 'power'`, "exchange its power and the power of target creature it's blocking until end of combat":
   * `a` and `b` are one creature each; each one's power as the step runs becomes the other's, a layer-7b setting for the step's `duration` (default: permanent). If either is no
   * longer a creature on the battlefield, or its power can't be determined, nothing is exchanged. Capability `op:exchange.power` (effects/handlers/zones-status.ts).
   * edh-b-12 INTERFACE CHANGE (additive), CR 701.12a, 401.1 (Mordenkainen): `what: 'handLibrary'`, "exchange your hand and library": `a` is the one player (`b` equal to `a`); every card of their hand
   * is put into their library and every card of their library into their hand, together. Capability `op:exchange.handLibrary` (effects/handlers/zones-status.ts).
   * edh-c-113 INTERFACE CHANGE (additive), CR 701.12a, 400.1 (Harness Infinity): `what: 'handGraveyard'`, "exchange your hand and graveyard": the same shape with the graveyard for the library (no shuffle).
   */
  | (StepBase & { op: 'exchange'; a: Ref; b: Ref; what: 'control' | 'life' | 'sacrificeReturn' | 'hands' | 'powerToughness' | 'lifeToughness' | /** edh-next-89 INTERFACE CHANGE (additive), CR 701.12a, 613.4b (Evra, Halcyon Witness): `lifePower`, "exchange your life total with ~'s power", as `lifeToughness` with the creature's power (a layer-7b effect). Capability `op:exchange.lifePower`. */ 'lifePower' | 'power' | 'handLibrary' | 'handGraveyard'; duration?: Duration })
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
   * edh-cast-9 INTERFACE CHANGE (additive): `exactManaValue`, "You may cast that card without paying its mana cost if the two spells have the same mana value" (Powerbalance;
   * CR 601.2, 202.3): only a face or half whose resulting spell has exactly that mana value may be cast (the resolution cast's option, actions/cast.ts; a quantity is read
   * as the step runs, CR 608.2h); a card with none is not cast. Capability `op:cast.exactManaValue`.
   */
  /*
   * std-cardcopy-7 INTERFACE CHANGE (additive): `select`, "You may cast up to three of the copies without paying their mana costs." (Baron Helmut Zemo), "You may cast any
   * number of spells with total mana value 6 or less from among the copies without paying their mana costs." (Uldaros Theorix; CR 608.2d, 601.2, 202.3): instead of a
   * yes or no for each object, the player chooses at once which of the ones that can be cast now to cast: at most `max` of them, with a total of their mana values of at
   * most `totalManaValue` (each read once, as the step starts, CR 608.2h); the chosen ones are cast in the order chosen, the others are not. Capability
   * `op:cast.select`.
   */
  /** trek-21 INTERFACE CHANGE (additive), CR 601.2, 608.2g (Lieutenant Nyota Uhura): `dropUncast`: a chosen card that cannot be cast now leaves the binding `what` names, so a later "the rest" counts it. Capability `op:cast.dropUncast`. */
  | (StepBase & { op: 'cast'; dropUncast?: true; who: PlayerRef; what: ObjRef; free?: boolean; costChange?: CostChange; optional?: boolean; transformed?: boolean; copyIn?: 'exile' | 'hand' /* edh-next-132 (CR 707.12; God-Eternal Kefnet, ruling 2019-05-03: "The copy is created in and cast from your hand"), capability `op:cast.copy.hand` */; play?: true; anyManaType?: true; /** edh-next-50 INTERFACE CHANGE (additive), CR 601.2, 113.6m, 400.7 (Sproutback Trudge): "you may cast ~ from your graveyard" in an ability that functions there: the card is cast only if it is still in that graveyard (a card in another zone is not cast). Capability `op:cast.from` */ from?: 'graveyard'; graveyardInstead?: { to: Destination; yours?: true; types?: string[] }; maxManaValue?: number | Quantity; exactManaValue?: number | Quantity; select?: { max?: Quantity; totalManaValue?: Quantity }; /** trek-14 INTERFACE CHANGE (additive), CR 707.12, 707.10: with `copyIn`, the number of copies created of each card, read as the step runs ("Copy that card X times ... You may cast the copies"; default 1; an amount that fails to determine, or less than 1, creates none). Capability `op:cast.copyCount` */ count?: Quantity })
  /**
   * E3XP INTERFACE CHANGE (additive; FAST5X E31's `changeTargets` with `how: 'new'`): "you may choose new targets for it / that spell" (CR 115.7d) on a spell or
   * ability already on the stack. `who` may leave any number of its targets as they are, even illegal ones; a changed one must be legal for the stack object's
   * controller and source, never the object itself (CR 115.5); only the final set is judged (CR 115.7e), the division stays (CR 115.7f). A new target becomes a
   * target of it (CR 603.2). Beside r4-fxb's `changeTarget` ("change the target of ...", CR 115.7a). Capability `op:chooseNewTargets` (effects/handlers/new-targets.ts).
   */
  /**
   * edh-next-129 INTERFACE CHANGE (additive), CR 115.7, 608.2d (Chef's Kiss; Scryfall rulings 2021-06-18): `random`, "reselect the targets at random for the spell and the copy": no question is asked;
   * each instance of the word "target" that has targets gets as many new ones chosen at random among its legal targets (the current one included when still legal); an instance with no
   * legal target left keeps its targets; a final set that breaks a restriction keeps them all (CR 115.7d). `notYours`, "The new targets can't be you or a permanent you control.": the
   * controller of the resolving ability and the permanents they control are never chosen. Capability `op:chooseNewTargets.random` (effects/handlers/new-targets.ts).
   */
  | (StepBase & { op: 'chooseNewTargets'; who: PlayerRef; what: ObjRef; random?: true; notYours?: true })
  // --- counters --------------------------------------------------------------------------
  /**
   * std-rx26 INTERFACE CHANGE (additive): `distribute`, "distribute three stun counters among any number of tapped creatures your opponents control" (no target;
   * CR 608.2c-d, 122.1; unverified cites): as the step resolves, the controller chooses one or more of the objects of `on` (an `each` set, at most `count` of
   * them) and divides `count` among them, each getting at least one (effects/handlers/counters.ts#distributedShares). Capability `op:putCounters.distribute`.
   */
  | (StepBase & { op: 'putCounters'; on: Ref; kind: CounterKind; count: Quantity; distribute?: true; /** edh-d-89 INTERFACE CHANGE (additive), CR 122.1, 608.2c (Aven Courier): with `kindOfChoice`, "put a counter of that kind on <one object> if it doesn't have a counter of that kind on it": nothing is put on a recipient that already has one (judged as it resolves); capability op:putCounters.ifNone */ ifNone?: true; /** std-mana-2 (additive): "put up to N <kind> counters on <one object>": the controller chooses how many, 0 to N (CR 608.2d; capability op:putCounters.upTo) */ upTo?: true; /** edh-perms-15 INTERFACE CHANGE (additive), CR 122.1, 608.2d: "put another counter of that kind": the kind is the one a `chooseValue` with `what: 'counterKind'` chose for this link earlier in the resolution (`kind` is then ignored); capability `op:putCounters.kindOfChoice` */ kindOfChoice?: LinkId; /** edh-players-19 INTERFACE CHANGE (additive), CR 122.6, 608.2d: the player who puts the counters when it is not the controller ("target player puts a +1/+1 counter on each creature they control"); read by effects/handlers/counters.ts (the `by` of the counters events); capability `op:putCounters.by` */ by?: PlayerRef; /** edh-c-48 INTERFACE CHANGE (additive), CR 702.100a, 701.x (cites unverified: "evolves" is defined by Renegade Krasis's rulings): the counter is the one an evolve ability puts; when a counter is put, the creature "evolves" (the `action` event with the verb `evolve`, once however many counters); only the evolve keyword's own expansion writes it; capability `op:putCounters.evolve` */ evolve?: true; /** edhn63 INTERFACE CHANGE (additive), CR 122.1, 122.6, 608.2h: "put the same number and kind of counters on ~" (`same`) / "put one of each of those kinds of counters on it" (`oneEach`): the counters the triggering counters event put (`EventContext.counterKinds`); `kind` and `count` are then ignored (write 'any' and 1); capability `op:putCounters.ofEvent` */ ofEvent?: 'same' | 'oneEach'; /** edhn63 INTERFACE CHANGE (additive), CR 122.1, 122.6, 608.2h: "put the same number of each kind of counter on that creature" (Denry Klin): the counters of every kind the object `copyFrom` has as the step resolves (last known information if it left), the same number of each; `kind` and `count` are then ignored (write 'any' and 1); capability `op:putCounters.copyFrom` */ copyFrom?: ObjRef })
  /**
   * FAST4 T31 INTERFACE CHANGE (additive): `upTo` = "remove up to N counters": the controller removes any number from 0 to N (CR 122.1, 608.2d: of any kinds
   * with `kind: 'any'`, choosing each counter's kind; capability `op:removeCounters.upTo`, effects/handlers/counters.ts#OP_FORMS).
   */
  | (StepBase & { op: 'removeCounters'; from: Ref; kind: CounterKind | 'any'; count: Quantity | 'all'; upTo?: true; /** edhn63 INTERFACE CHANGE (additive), CR 122.1, 608.2d: `among`, "remove any number of +1/+1 counters from among creatures you control" (Galloping Lizrog): `count` is the TOTAL taken from the whole group `from` (not from each member), the controller choosing which member (and kind) gives each counter; capability `op:removeCounters.among` */ among?: true; /** edh-perms-24 INTERFACE CHANGE (additive), CR 122.1, 608.2d: "remove that counter": the kind is the one a `chooseValue` with `what: 'counterKind'` chose for this link earlier in the resolution (`kind` is then ignored); none chosen (the holder had no counters): nothing happens. Capability `op:removeCounters.kindOfChoice` */ kindOfChoice?: LinkId })
  /**
   * FAST5X E21 INTERFACE CHANGE (additive): `kind: 'any'` with `count: 'all'` is "put its counters on <object>": every counter of every kind (CR 122.5); when the
   * first object has left the battlefield, the same number of each kind it had (CR 122.8, 122.9; effects/handlers/counters.ts). Capability `op:moveCounters.every`.
   * p2-counters-move-1 INTERFACE CHANGE (additive; CR 122.5, 608.2d, cites unverified): `kind: 'any'` with a number is "move a counter / N counters from <obj> onto
   * <obj>": the controller chooses each counter's kind (capability `op:moveCounters.anyKind`); `upTo` with `count: 'all'` is "move any number of [<kind>] counters
   * from <obj> onto <obj>": the controller chooses how many of each kind, none to all (capability `op:moveCounters.upTo`).
   * p2-counters-move-4 INTERFACE CHANGE (additive; CR 122.5, 608.2d, cites unverified): `distribute`, "move any number of +1/+1 counters from ~ onto other creatures":
   * `to` is a group; the controller chooses how many of one fixed kind (with `upTo` and `count: 'all'`), then which objects of the group get them and how they are
   * divided, each at least one (effects/handlers/counters.ts#moveDistributed). Capability `op:moveCounters.distribute`.
   * edh-misc-6 INTERFACE CHANGE (additive; CR 122.5, 608.2d): `among`, "move any number of counters from among <objects> onto <object>" (Slippery Bogbonder): `from`
   * is a group, the controller chooses how many counters of each kind each object gives, none to all, and the receiver itself gives none (capability
   * `op:moveCounters.among`); `eachNewKind`, "move a counter of each kind not on <the receiver> from <object> onto <the receiver>" (Goldberry): one counter of every kind the
   * giver has and the receiver lacks when the step begins (capability `op:moveCounters.eachNewKind`); `atLeastOne` with `upTo` and `count: 'all'`, "move one or more
   * counters from <obj> onto <obj>": the controller may not choose to move none when the giver has any (capability `op:moveCounters.atLeastOne`).
   */
  | (StepBase & { op: 'moveCounters'; from: ObjRef; to: ObjRef; kind: CounterKind; count: Quantity | 'all'; upTo?: true; distribute?: true; among?: true; eachNewKind?: true; atLeastOne?: true })
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
  | (StepBase & { op: 'addMana'; who: PlayerRef; /** edh-misc-6 (additive; CR 106.4, 605.3b, 608.2d): "a player of your choice adds {C}" (Victory Chimes): `who` chooses a player as the step resolves and that player adds the mana; capability `op:addMana.playerOfChoice` */ ofYourChoice?: true; units?: ManaType[][]; dynamic?: ManaProduction; restriction?: ManaRestriction; keep?: 'endOfCombat' | 'endOfTurn'; link?: LinkId ; /** std-mana-1 (additive): a rider on the spell the mana is spent on (ManaSpentRider) */ rider?: ManaSpentRider; /** std-copy-3 (additive): "When that mana is spent to cast ..." (ManaSpentTrigger) */ whenSpent?: ManaSpentTrigger })
  /**
   * edh-c-85 INTERFACE CHANGE (additive), CR 106.4, 500.5, 614.1: "that player loses all unspent mana" (Mana Short): every unit of mana in the pool of each player `who`
   * names is lost right now (the mana-pool rules of steps and phases do not apply: "doesn't lose mana as steps end" says nothing of this instruction, 500.5). A rule that
   * says unspent mana "becomes" another type instead (Kruphix) turns it into mana of that type, which stays (core/steps.ts#loseUnspentMana). Capability `op:emptyManaPool`.
   */
  | (StepBase & { op: 'emptyManaPool'; who: PlayerRef })
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
  /**
   * edh-players-13 INTERFACE CHANGE (additive), CR 603.2c (Forth Eorlingas!): `wholeBatch: true` with `batch`: "whenever one or more creatures you control deal combat damage to one or more
   * players this turn" is ONE occurrence for the whole simultaneous batch however many players were dealt damage (as `TriggerDef.wholeBatch` is for a triggered ability), where
   * `batch` alone is one occurrence for each player dealt damage (triggers/delayed.ts). Capability `feature:delay.batch.whole`.
   */
  | (StepBase & { op: 'delay'; when: DelayedWhen; do: EffectStep[]; capture?: Name[]; duration?: Duration; once?: boolean; batch?: boolean; wholeBatch?: true; targets?: TargetSpec[] })
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
  | (StepBase & { op: 'extraTurn'; who: PlayerRef; count: Quantity; /** edh-next-46 (additive; CR 500.7, 502.1, 614.10; Savor the Moment): "Skip the untap step of that turn": the extra turns this step adds begin without an untap step. Capability `op:extraTurn.skipUntap`. */ skipUntap?: boolean })
  /**
   * std-control-3 INTERFACE CHANGE (additive): "you control target opponent during their next turn" / "... during their next combat phase" (CR 723.1, 723.5):
   * the controller of the spell or ability makes every decision of each player of `who` during that player's next turn, or the next combat phase of a turn of
   * theirs (`during`; core/player-control.ts). A player is never controlled by themselves this way. Capability `op:controlPlayer`.
   */
  | (StepBase & { op: 'controlPlayer'; who: PlayerRef; during: 'turn' | 'combat'; /** edh-next-119 INTERFACE CHANGE (additive), CR 723.1, 500.7 (Emrakul, the Promised End: "you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn."): with `during` 'turn', the controlled turn adds, as it ends, one extra turn of that player directly after it (none if the player has left the game; a turn that never begins adds none). Capability `op:controlPlayer.thenExtraTurn` */ thenExtraTurn?: true })
  /**
   * r4-mech INTERFACE CHANGE (additive): `followedBy`, "there is an additional combat phase followed by an additional main phase" (CR 500.8, 505.1a): the added combat
   * phase is itself followed by an added main phase (core/turn-effects.ts#addExtraPhase). Only with `phase: 'combat'` and `followedBy: 'main'`.
   */
  /*
   * std-rq INTERFACE CHANGE (additive): `attackers`, "After this phase, there is an additional combat phase. Only land creatures can attack during that combat phase."
   * (CR 500.8, 508.1): during the added combat phase only creatures that match the filter (read for the controller of the effect) can be declared as attackers.
   * Only with `phase: 'combat'` and no `followedBy`. Capability `op:extraPhase.attackers` (core/turn-effects.ts).
   */
  /**
   * edh-d-34 INTERFACE CHANGE (additive): `onlyThese`, "After this main phase, there is an additional combat phase. Only the chosen creatures can attack during that combat phase."
   * (Last Night Together; CR 500.8, 508.1): the objects the reference names as the effect resolves (its targets, "the chosen creatures") are the only creatures that can be
   * declared as attackers in the added combat phase (the ones still on the battlefield when its declare attackers step begins). Only with `phase: 'combat'`, no `followedBy`
   * and no `attackers`. Capability `op:extraPhase.onlyThese` (core/turn-effects.ts#fixAllowedAttackers).
   */
  | (StepBase & { op: 'extraPhase'; phase: 'combat' | 'main'; after?: TurnStep; followedBy?: 'main'; attackers?: ObjectFilter; onlyThese?: ObjRef })
  /**
   * r4-fxb INTERFACE CHANGE (additive): "there is an additional end step after this step", "you get that many additional upkeep steps after this phase" (CR 500.9,
   * unverified number; CR 500.8 for phases): `count` steps of the kind `step` (1 when absent), added directly after the current step, or with `afterPhase` after the
   * current phase; several added after the same step or phase: the most recently created one occurs first. When an added step ends the turn goes on as if the step
   * or phase it was added after had just ended (core/turn.ts#goToNextStep). Capability `op:extraStep` (effects/handlers/r4-fxb.ts).
   */
  /** edh-next-74 INTERFACE CHANGE (additive), CR 107.3, 601.2b (Unbound Flourishing): "double the value of X": the announced X of the spell on the stack `what` names is doubled (the mana paid stays). Capability `op:doubleX` (effects/handlers/edh-next-74.ts). */
  | (StepBase & { op: 'doubleX'; what: ObjRef })
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
   * edh-c-53 INTERFACE CHANGE (additive): rider `reduce`, "the next spell you cast this turn costs {1} less to cast" (Hardened Berserker; CR 601.2f, 118.7, 611.2): `mana`, the
   * symbols the next matching spell's cost is reduced by (a generic reduction, as a `costMod` reduce); statics/costmods.ts#costModsFor offers it while the spell's cost is
   * determined, core/turn-effects.ts#takeNextSpellRiders uses it up as that spell is cast. Capability `feature:nextSpell.reduce`.
   * edh-next-18 INTERFACE CHANGE (additive): rider `flash`, "the next sorcery spell you cast this turn can be cast as though it had flash" (Quicken; CR 601.3b, 702.8a, 611.2):
   * while it waits, the player may cast a spell it matches at instant timing (statics/hooks.ts#castsAsInstant); the next matching spell the player casts uses it up,
   * cast at instant timing or not (Scryfall ruling 2006-02-01 of Quicken). Capability `op:nextSpell`.
   */
  | (StepBase & { op: 'nextSpell'; who: PlayerRef; filter?: ObjectFilter; rider: 'cantBeCountered' | 'keyword' | 'free' | 'reduce' | 'flash' | 'enters' | 'life'; keyword?: KeywordAbilityDef; /** edh-d-95 INTERFACE CHANGE (additive), CR 614.1c, 122.6, 611.2 (Savage Summoning: "That creature enters with an additional +1/+1 counter on it."): rider `enters`, the permanent the next matching spell becomes enters with these counters besides its others (the spell's `permitEnters`, effects/rule-replacements/permit-enters.ts); a fixed number of each kind. Capability `feature:nextSpell.enters`. */ counters?: CounterSpec[]; /** edh-d-50 (CR 601.2i, 611.2; Yidris, Maelstrom Wielder): a `keyword` rider that is not used up by the first spell: "as you cast spells from your hand this turn, they gain cascade" gives the keyword to every matching spell until the turn ends */ lasting?: true; mana?: ManaCost; /** edh-next-38 (CR 601.2f, 107.3, 608.2h; Kaza, Elminster): a `reduce` rider's generic amount, counted as the effect resolves, instead of `mana` */ amount?: Quantity })
  | (StepBase & { op: 'endTurn' })
  /**
   * edh-next-137 INTERFACE CHANGE (additive), CR 727, 104.1, 104.6 (Karn Liberated): "Restart the game, leaving in exile all non-Aura permanent cards exiled with ~. Then put those
   * cards onto the battlefield under your control.": the game ends and its players begin a new one, the controller of this ability the starting player; the cards `keep` names that
   * are in exile as the instruction resolves are left out of the new game's decks (they begin it in exile) and, with `toBattlefield` (the "Then put those cards ..." sentence, a
   * rider), just before the new game's first untap step, are put onto the battlefield under that player's control (core/restart.ts). The last instruction of its ability.
   * Capability `op:restartGame`.
   */
  | (StepBase & { op: 'restartGame'; keep: ObjRef; toBattlefield?: true })
  /**
   * trek-18 INTERFACE CHANGE (additive), CR 724.2 (Merciful Mandate): "end the combat phase": nothing happens outside a combat phase (724.2g); else the triggers waiting to be put on the
   * stack cease to exist (724.2a), every object on the stack is exiled, the resolving one included (724.2b), no player gets priority and the game goes straight to the next phase,
   * the creatures removed from combat (724.2c-f). Capability `op:endCombatPhase` (effects/handlers/game.ts, core/turn.ts#endTheCombatPhase).
   */
  | (StepBase & { op: 'endCombatPhase' })
  /**
   * edh-next-147 INTERFACE CHANGE (additive), CR 123.3, 123.3a-b, 123.6, 123.6b (_____ Goblin): "put a name sticker on it". The player `who` chooses one of the name stickers
   * they have access to (`PlayerState.stickers`, CR 123.2c) that is on no object they own (CR 123.3) and puts it on the one object `on` names; the object's controller
   * chooses where in its name the words go (CR 123.6b). Nothing happens when the player does not own that object (CR 123.3b), it is not where the reference found it, or
   * the player has no such sticker left. The number of unique vowels on the sticker put is `{q:'stickerVowels'}` for the rest of the resolution (CR 123.6e).
   * Capability `op:putSticker`.
   */
  | (StepBase & { op: 'putSticker'; who: PlayerRef; on: ObjRef; sticker: 'name' })
  /**
   * trek-18 INTERFACE CHANGE (additive), CR 508.7 (Tuvok, Chief Tactical Officer): "you may reselect which player or permanent that creature is attacking": the controller of the effect
   * chooses a new player, planeswalker or battle for each attacking creature `what` names (or keeps it as it is). The creature stays in combat and is not considered to have attacked
   * again (508.7a). Capability `op:reselectAttack` (effects/handlers/trek-18.ts).
   */
  | (StepBase & { op: 'reselectAttack'; what: ObjRef; /** edh-d-88 INTERFACE CHANGE (additive), CR 508.7, 508.7c (Capricopian): "reselect which player ~ is attacking": only a player may be chosen (never a planeswalker or battle). Capability `op:reselectAttack.playersOnly` */ playersOnly?: true })
  /**
   * edh-combat-7 INTERFACE CHANGE (additive), CR 509.1, 723.1 (Odric, Master Tactician): "you choose which creatures block this combat and how those creatures block": the declare blockers
   * decisions of this combat's defending players are made by `who` (the controller of the effect), who may choose any set of blocks that is legal for that player (every requirement, restriction and
   * cost still applies: a cost the defending player does not pay makes `who` propose another declaration). Only the block declarations, never another decision of those players; nothing
   * happens outside a combat phase or after blockers were declared. Capability `op:controlBlocks` (effects/handlers/edh-combat-7.ts, core/combat.ts#declareBlockers).
   */
  | (StepBase & {
    op: 'controlBlocks'; who: PlayerRef;
    /**
     * edh-d-89 ADDITION (optional, absent = this combat only), CR 509.1, 723.1 (Master Warcraft): "you choose which creatures block THIS TURN and how those creatures block": every declare blockers
     * step of the rest of the turn (each combat phase, an added one too) is decided by `who` (`turn.blocksBy`, core/combat.ts#declareBlockers). An effect of this combat (Odric) still decides its own combat.
     */
    turn?: true;
  })
  /**
   * edh-d-89 INTERFACE CHANGE (additive), CR 508.1a-b, 723.1 (Master Warcraft, ruling 2008-04-01): "you choose which creatures attack this turn": every declare attackers decision of the rest of the turn
   * is made by `who` (`turn.attacksBy`), who chooses the complete group of creatures that attack (every requirement, restriction, limit and cost still applies, as for the active player); then the
   * active player chooses which player, planeswalker or battle each of them attacks when more than one can be attacked (CR 508.1b; the costs are still the active player's, CR 508.1g-j).
   * Capability `op:controlAttacks` (effects/handlers/edh-d-89.ts, core/combat.ts#declareAttackers).
   */
  | (StepBase & { op: 'controlAttacks'; who: PlayerRef })
  | (StepBase & { op: 'winGame'; who: PlayerRef })
  | (StepBase & { op: 'loseGame'; who: PlayerRef })
  | (StepBase & { op: 'createEmblem'; who: PlayerRef; abilities: AbilityDef[] })
  /**
   * edh-mana-keywords-10 INTERFACE CHANGE (additive), CR 706.1-706.3: `count` may be a quantity ("Roll X six-sided dice, where X is the number of Bobbleheads you control", read once as the
   * roll begins; capability `op:rollDie.countQty`); `modifier`, a number added to the natural result of a roll of ONE die ("Roll a d20 and subtract the number of cards in your hand":
   * `{q:'math', op:'-', args:[0, N]}`; CR 706.2; capability `op:rollDie.modifier`); `chooseOne`, "Roll two d12 and choose one result" (the roller picks one of the results of two or
   * more dice: `{q:'dieResult'}` is the chosen one, `{q:'dieResultOther'}` the other; capability `op:rollDie.chooseOne`); `afterRoll`, the instructions printed between the roll and
   * its results table ("If the result is 0 or less, discard your hand."), run after the roll and before the table (CR 706.3b; capability `op:rollDie.afterRoll`).
   * edh-d-49: `keepHighest`, "Roll a d20 for each player being attacked and ignore all but the highest roll" (Iron Mastiff; CR 706.2, 706.6): `count` dice are rolled and only the highest roll is kept (the others
   * are ignored: never rolled, no event); the one kept result is `{q:'dieResult'}` and picks the row of a results table. Only for one roller; capability `op:rollDie.keepHighest`.
   */
  /*
   * edh-top-16 INTERFACE CHANGE (additive), CR 706.1, 706.2, 608.2c: `highest`, "Each player rolls a d20. If one or more opponents had the highest result, ~ can't attack those players" (Chaos Dragon): after
   * every player of `who` has rolled ONE die each, the opponents of the roller's controller whose result equals the highest result of all the players are bound under `as` (the group is empty when only
   * the controller or nobody else had it). Only with one die each and no table. Capability `op:rollDie.highest`.
   */
  | (StepBase & { op: 'rollDie'; who: PlayerRef; sides: number; count?: Quantity; modifier?: Quantity; chooseOne?: true; keepHighest?: true; afterRoll?: EffectStep[]; highest?: { as: Name }; table?: { min: number; max: number; do: EffectStep[]; /** edh-next-121 INTERFACE CHANGE (additive), CR 706.2, 706.3a, 608.2c (Delina, Wild Mage: "15-20 | Create one of those tokens. You may roll again."): after this row's instructions the roller may roll the same die again (with the same modifier), and the row of the new result happens, which may offer another roll. Only for the one die of one roller. Capability `op:rollDie.again`. */ again?: 'may' }[] })
  /**
   * r4-mech INTERFACE CHANGE (additive): `count`, "Flip five coins." (CR 705.1): the player flips that many coins, one at a time; only without `onWin` / `onLose`
   * (parser/lower/coin-flip.ts folds those into a one-coin flip). The step's count is the flips won when they are called, else the coins that came up heads.
   * p2-coinflip-1 INTERFACE CHANGE (additive): `untilLose`, "flip a coin until you lose a flip" (CR 705.1-705.2): the player flips and calls one coin at a time
   * until they lose one; each won flip is won as it happens. The step's count is the flips won. Only for one player, without `count`, `onWin` or `onLose`.
   * Capability `op:flipCoin.untilLose`.
   * p2-coinflip-3 INTERFACE CHANGE (additive): `called`, "flip three coins. For each flip you win, ..." (CR 705.2): each flip is called, so each is won or lost, and the
   * step's count is the flips won (set by the quantities pass when "for each flip you win" counts this flip, parser/lower/quantities.ts). Capability `op:flipCoin.called`.
   */
  /**
   * edh-next-128 INTERFACE CHANGE (additive), CR 705.1, 705.2, 608.2c (Yusri, Fortune's Flame: "choose a number between 1 and 5. Flip that many coins. For each flip you win, draw a card. For
   * each flip you lose, ~ deals 2 damage to you. If you won five flips this way, ..."): `times`, the number of coins as a quantity read as the flip begins (in place of `count`; never with
   * `onWin`/`onLose`, like `count`); capability `op:flipCoin.times`. A called flip of several coins (`called`, with `as`) also reports the flips lost (`StepResult.lost`), read by
   * `{q:'resultCount', step, lost: true}`.
   */
  | (StepBase & { op: 'flipCoin'; who: PlayerRef; count?: number; times?: Quantity; onWin?: EffectStep[]; onLose?: EffectStep[]; untilLose?: true; /** edh-next-129 INTERFACE CHANGE (additive), CR 705.2, 608.2c (Fiery Gambit; rulings 2004-12-01): with `untilLose`, "or choose to stop flipping": after each won flip the player chooses whether to flip again. Capability `op:flipCoin.mayStop` */ mayStop?: true; /** edh-next-129 INTERFACE CHANGE (additive), CR 705.2, 119.3, 608.2c (Game of Chaos; ruling 2004-10-04): with `onWin` and `onLose` on one coin, "..., and you decide whether to flip again" / "..., and that player decides whether to flip again": after each result the player of that side (`winDecides` / `loseDecides`) decides whether the same player flips again, and the next result happens the same way; with `doubleLife`, "Double the life stakes with each flip": each flip doubles the life gained and lost by the branches (their `gainLife` / `loseLife` numbers). Capability `op:flipCoin.stakes` */ stakes?: { winDecides?: PlayerRef; loseDecides?: PlayerRef; doubleLife?: true }; /** edh-next-129 INTERFACE CHANGE (additive), CR 705.2, 608.2c (Fiery Gambit): with `mayStop`, "If you lose a flip, ~ has no effect": a lost flip makes the flips count as none won (the step's result count is 0), so no later "if you win N or more flips" holds. Capability `op:flipCoin.mayStop` */ lostVoids?: true; called?: true; /** edh-d-20 INTERFACE CHANGE (additive), CR 705.1-705.2: `onTails`, "flip a coin for each creature. Destroy each creature whose coin comes up tails" (Rakdos, the Showstopper): the coin is NOT called (nobody wins or loses it, no `coinFlipped` event), the steps run when it lands tails; capability `op:flipCoin.onTails` */ onTails?: EffectStep[] })
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
   * edh-next-33 (additive): verb 'connive' with `object`, the permanent that connived (CR 701.50a: the connive macro ends with it, so "Whenever a creature you control
   * connives" (Iron Monger) sees the whole process done; capability `feature:ev.action.connive`).
   * edh-next-39 (additive): verb 'crew' with `object`, the Vehicle whose crew ability resolved (CR 702.122e: "becomes crewed"; keywords/data/crew.json; capability `feature:ev.becomes.crewed`).
   */
  | (StepBase & { op: 'reportAction'; who: PlayerRef; verb: 'earthbend' | 'firebend' | 'connive' | 'crew' | 'investigate' /* edh-next-113 */ | 'adapt' | 'adaptAsNoCounters' /* edh-next-110 */; object?: ObjRef })
  /**
   * edh-c-84 INTERFACE CHANGE (additive), CR 608.2e, 701.21a, 701.9a: "Each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the
   * fewest, then sacrifices the rest. Players discard cards and sacrifice creatures the same way." (Magus of the Balance, Restore Balance): for each part in order, every player keeps as many
   * of those permanents (or cards in hand) as the player who has the fewest has, and loses the rest (sacrificed or discarded). Capability `op:balance` (effects/handlers/edh-c-84.ts).
   */
  | (StepBase & { op: 'balance'; parts: ('lands' | 'creatures' | 'cards')[] })
  /**
   * edh-next-131 INTERFACE CHANGE (additive), CR 101.4, 608.2d, 701.9a, 701.21a (Eumidian Wastewaker): "you and defending player each discard a card or sacrifice a permanent": each player of
   * `players`, in that order, chooses to discard a card or to sacrifice a permanent of `filter` and does it (one who can't do one of them does the other; neither, nothing). `as` names the
   * cards those discards and sacrifices put into a graveyard. Capability `op:discardOrSacrifice` (effects/handlers/edh-next-131.ts).
   */
  | (StepBase & { op: 'discardOrSacrifice'; players: PlayerRef[]; filter: ObjectFilter })
  | (StepBase & { op: 'designateObject'; what: ObjRef; designation: 'classLevel' | 'solved' | 'harnessed' | 'prepared' | 'unprepared' | 'saddled' | 'unlockDoor' | 'lockOrUnlockDoor' | 'suspected' | 'unsuspected' | 'plotted' | 'warped' | 'foretold' /* edh-next-109 INTERFACE CHANGE (additive), CR 702.143d, 400.7 (The Foretold Soldier): "It becomes foretold": a card in exile that is face down becomes foretold, castable for its foretell cost on a later turn. Capability `op:designateObject.foretold`. */; level?: number; /** edh-d-86 INTERFACE CHANGE (additive), CR 702.143a, 118.9 (Ethereal Valkyrie): with `foretold` only, "Its foretell cost is its mana cost reduced by {2}": the generic mana the card's foretell cost takes off its mana cost (kept on the foretold card, actions/cast-opt/foretell.ts). Capability `op:designateObject.foretold.less`. */ foretellLess?: number }) // 'saddled': FAST5X E3 (CR 702.171a-b); 'unlockDoor', 'lockOrUnlockDoor': FAST5X E8 INTERFACE CHANGE (additive), CR 709.5f-g; 'suspected' / 'unsuspected': FAST5X E12 INTERFACE CHANGE (additive), "suspect it" and "it's no longer suspected" (CR 701.60a-d); 'plotted': r5-fxb INTERFACE CHANGE (additive), "It becomes plotted." (CR 702.170c-d); 'warped': std-costs-2 INTERFACE CHANGE (additive), the card warp's delayed triggered ability exiled is a warped card (CR 702.185a; keywords/data/warp.json)
  /**
   * Any other CR 701 keyword action, implemented once in the keyword library as a macro over the ops above.
   * M12-3 INTERFACE CHANGE (additive), CR 701.38a-b: `choices`, of a vote only: the words the players vote for ("each player votes for carnage or homage";
   * words with no rules meaning, each connected to an effect). A vote's choices are `choices` (words), or what `subject` stands for: objects ("votes for a
   * nonland permanent you don't control") or players (a player-only reference, "votes for a player"). The vote binds `as` to the objects or players with the
   * most votes or tied for most votes, and records the tally (`StepResult.votes`, read by `{q:'votes'}`). Capabilities `feature:vote.words`,
   * `feature:vote.players` (model/cap-walk.ts; effects/handlers/actions-native.ts).
   * edhd19 INTERFACE CHANGE (additive), CR 701.38a: `secret`, of a vote only: "each player secretly votes for truth or consequences, then those votes are revealed": the players
   * choose without seeing the others' votes, which are said (logged) only once every player has voted. Capability `feature:vote.secret`.
   * edhd27 INTERFACE CHANGE (additive), CR 701.38a-b: of a vote for players or objects only: `notSelf`, "votes for another player" (nobody votes for themselves), and `upTo`, "votes for up
   * to one creature" (a player may cast no vote); a vote nobody cast binds nothing. Capabilities `feature:vote.notSelf`, `feature:vote.upTo`.
   */
  | (StepBase & {
    op: 'action'; action: KeywordActionName; subject?: Ref; who: PlayerRef; n?: Quantity; arg?: string; choices?: string[]; secret?: true; notSelf?: true; upTo?: true;
    /**
     * edh-d-89 ADDITION (optional; `meldPair` only), CR 701.42a, 712.4a, 508.4 (Mishra, Claimed by Gix): `partner`, what else the meld partner must be (the one the condition named: "~ and a
     * creature named Phyrexian Dragon Engine are attacking": an attacking one); `entersAttacking`, "It enters tapped and attacking." (the melded permanent enters tapped and attacking, its
     * controller choosing what it attacks, CR 508.4; it was never declared as an attacker). Capability `feature:action.native.meldPair.attacking`.
     */
    partner?: ObjectFilter; entersAttacking?: true;
  })
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

/** edh-d-94 INTERFACE CHANGE (additive): `planeswalkerType`, "choose a planeswalker type" (Deification; CR 205.3j, 614.12a), from the planeswalker types of CR 205.3j (statics/subtypes.ts#PLANESWALKER_TYPES). */
/**
 * edh-next-144 INTERFACE CHANGE (additive): `lifeTotal`, "note your life total" (CR 119.1, 607.2d; Sigarda's Splendor): nobody chooses; the life total the player has now is kept as a
 * number under the link (the source's, rewritten by every later note), read as `{q:'chosenNumber', link:'notedLife'}` ("the last noted life total for ~"). Only `who: {ref:'you'}`,
 * as a step or as the permanent enters (`ReplacementBody` `choose`). Capability `op:chooseValue.lifeTotal`.
 */
export type ChoiceKind = 'color' | 'creatureType' | 'cardType' | 'landType' | 'cardName' | 'number' | 'player' | 'opponent' | 'option' | 'oddEven' | 'landOrNonland' | 'lifeTotal' | 'manaTypeSpent' | 'planeswalkerType';

/**
 * M6-8 INTERFACE CHANGE (additive): a value `chooseValue` never offers: a fixed value ("the new creature type can't be Wall") or the value chosen earlier in this
 * resolution for a link ("one color word with another": the second choice is a different word, CR 612.2). A value of a color choice may be a letter or a word.
 */
export type ChoiceExclusion = string | ChosenWord | BoundWord;

/**
 * edhn110 INTERFACE CHANGE (additive), CR 608.2d (Gluntch, the Bestower: "Choose a second player", "Then choose a third player"): the players an earlier `chooseValue` of this resolution bound
 * under `bound` (its `as`); a player choice never offers them. With every candidate excluded this way nothing is chosen and the later steps that read the choice do nothing (a
 * two-player game has no third player). Capability `op:chooseValue.excludeBound`.
 */
export interface BoundWord {
  bound: Name;
}

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
   * edhd19 ADDITION (INTERFACE CHANGE, additive; CR 701.31a, 311.7, 901): "chaos ensues" (the chaos ability of a plane, run by an effect). OpenMTG has no Planechase
   * game (no planar deck, no planes), so no plane has a chaos ability to trigger and nothing happens: the native handler (effects/handlers/planechase.ts) does nothing.
   */
  | 'chaosEnsues'
  /**
   * edh-next-127 ADDITION (INTERFACE CHANGE, additive; CR 901.3, 901.9d, 706.7, 107.11-12; Fractured Powerstone): "roll the planar die". The planar die exists only in a Planechase game
   * (CR 901.3); OpenMTG has no Planechase game, so the instruction has no effect (ruling 2012-06-01: "In non-Planechase games, Fractured Powerstone's second ability will have no
   * effect"): no die is rolled, nothing triggers ("whenever a player rolls one or more dice" counts the planar die only in a Planechase game, CR 706.7). Native: effects/handlers/planechase.ts.
   */
  | 'rollPlanarDie'
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
   * trek-13 (additive): a permanent that is already on the battlefield ("Assimilate target nonartifact creature an opponent controls", The Best of Both Worlds; the reminder text:
   * "Gain control of it and put a +1/+1 counter on it") changes control instead of being moved; a target spec of it may carry `link: 'assimilated'`, which "the Borg assimilated with
   * ~" of another ability of the face reads (parser/parse.ts#linkAssimilated).
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
  /**
   * edh-zones-21 INTERFACE CHANGE (additive): "its owner puts it on their choice of the top or bottom of their library" for every moved object together (Aetherspouts, CR 401.4,
   * 400.3): with `zone: 'library'` and no `position`, the owner of each moved card chooses `top` or `bottom` for it; the cards one owner sends to the same end are arranged by that
   * owner in any order (CR 401.4). Capability `op:move.ownerChoosesEnd`.
   */
  ownerChoosesEnd?: boolean;
  /**
   * edh-c-107 INTERFACE CHANGE (additive): "Put target card from a graveyard on your choice of the top or bottom of its owner's library" (Not Forgotten, CR 401.4, 400.3):
   * with `zone: 'library'` and no `position`, the named player (not the owner) chooses `top` or `bottom` for each moved card; the card goes to its owner's library.
   * Capability `op:move.endChosenBy`.
   */
  endChosenBy?: PlayerRef;
  tapped?: boolean;
  faceDown?: boolean;
  /**
   * edh-next-80 INTERFACE CHANGE (additive), CR 708.2, 708.3, 400.7 (Deathmist Raptor: "you may return this card from your graveyard to the battlefield face up or face down"): on the battlefield, the player
   * who moves it chooses for each object whether it enters face down (a face-down 2/2 creature, as with `faceDown`) or face up. Never beside `faceDown`. Capability `op:move.faceUpOrDown`.
   */
  faceUpOrDown?: true;
  /** edh-mana-keywords-12: with `faceDown` on the battlefield, the set characteristics the permanent has (FaceDownSet): "..., face down. It's a Forest land." Capability `feature:faceDown.set`. */
  faceDownAs?: FaceDownSet;
  transformed?: boolean;
  /**
   * std-typechange-1 INTERFACE CHANGE (additive), CR 702.49c, 508.4: `{ asReturned: true }`, attacking the same player, planeswalker or battle as the creature
   * returned to its owner's hand to pay the cost of the ability or spell doing the move (`CostsPaid.returned`, as it last existed: ninjutsu). Nothing to attack
   * (that creature attacked nothing, or what it attacked is gone) is never attacking (CR 508.4a). Capability `op:move.attackingAsReturned`.
   */
  /**
   * edh-zones-22 INTERFACE CHANGE (additive), CR 508.4: `{ defender, orPlaneswalkers: true }`, "tapped and attacking that player or a planeswalker they control"
   * (Zara, Renegade Recruiter): the controller of the permanent chooses between that player and the planeswalkers that player controls (no battle), as a token created
   * attacking does (`AttackingWhom`). Capability `op:move.attackingOrPlaneswalkers`.
   */
  attacking?: boolean | { defender: PlayerRef; orPlaneswalkers?: true } | { asReturned: true };
  attachedTo?: ObjRef;
  /**
   * edh-d-29 INTERFACE CHANGE (additive), CR 303.4f, 303.4g, 303.4h, 702.5a; Bitterheart Witch ("put it onto the battlefield attached to target player"), Radiant Grace,
   * Lynde: an Aura with "Enchant player" (or "Enchant opponent") put onto the battlefield enters attached to this player (the second form of `attachedTo`, which names an
   * object). An Aura that can't enchant that player stays where it is (CR 303.4g); a card that is not an Aura ignores it (CR 303.4h). Capability `op:move.attachedToPlayer`.
   */
  attachedToPlayer?: PlayerRef;
  counters?: CounterSpec[];
  /**
   * std-typechange-2 INTERFACE CHANGE (additive), CR 608.2c, 508.4: `tapped` and `attacking` apply only to the moved objects that match this filter as they are
   * before the move ("put a creature card from your hand onto the battlefield. If that card is an enchantment card, it enters tapped and attacking": Summoner's
   * Grimoire); every other object enters untapped and not attacking. Capability `op:move.statusIf`.
   */
  statusIf?: ObjectFilter;
  /**
   * edh-perms-10 INTERFACE CHANGE (additive), CR 614.1c, 608.2c: "If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it" (Turntimber
   * Symbiosis), "If it enters as a creature, it enters with an additional +1/+1 counter on it" (Teferi's Time Twist), "Each of them enters with an additional +1/+1 counter on it
   * if it's a creature and an additional loyalty counter on it if it's a planeswalker" (Semester's End): in addition to `counters`, each moved object that matches `if` (judged on
   * the card as it is before it moves, the way `statusIf` is) enters with these counters; every entry judged for itself, the counts added up kind by kind. Battlefield only.
   * Capability `op:move.countersIf`.
   */
  /**
   * edh-c-6 INTERFACE CHANGE (additive), CR 614.1c, 608.2c, 601.2h (Vigor Mortis: "If {G} was spent to cast this spell, that creature enters with an additional +1/+1 counter on it"):
   * an entry may carry `when`, a condition of the resolving ability checked as the move happens (the entry gives its counters only if it holds; `if` is then `{}`, every object).
   * Capability `op:move.countersIf.when`.
   */
  countersIf?: { if: ObjectFilter; when?: Condition; counters: CounterSpec[] }[];
  /**
   * edh-perms-21 INTERFACE CHANGE (additive), CR 303.4f, 303.4g; Retether: "Return each Aura card from your graveyard to the battlefield. Only creatures can be enchanted this way.":
   * an Aura put onto the battlefield by this move can enchant only an object that matches this description (besides its own enchant restriction); an Aura with no such object
   * stays where it is. Capability `op:move.enchantOnly`.
   */
  enchantOnly?: ObjectFilter;
  /**
   * edh-next-125 INTERFACE CHANGE (additive), CR 614.1c, 205.1b, 613.1d, 613.4b, 608.2c (Dance of the Manse: "Return up to X target artifact and/or non-Aura enchantment cards ... to the
   * battlefield. If X is 6 or more, those permanents are 4/4 creatures in addition to their other types."; ruling 2019-10-04: they ENTER as 4/4 creatures, not noncreature
   * permanents that then become creatures): each object this move puts onto the battlefield enters as these types (added, layer 4) with this base power and toughness (layer 7b),
   * from the moment it enters, as an `enters` replacement's `becomes` does (effects/perform-events.ts#applyEnterFacts); `when`, a condition of the resolving ability checked
   * as the move happens (none: always). Battlefield only. Capability `op:move.becomes`.
   */
  becomes?: { types?: string[]; subtypes?: string[]; power?: number; toughness?: number; when?: Condition };
  /**
   * edh-next-140 INTERFACE CHANGE (additive), CR 303.4f, 303.4g, 614.1c, 613.1d, 613.1f, 205.1a (Harold and Bob, First Numens: "return it to the battlefield. It's an Aura enchantment with enchant
   * Forest you control and "Enchanted Forest has ..." Harold and Bob loses all other abilities."; rulings 2024-03-08): each object this move puts onto the battlefield ENTERS as an Aura enchantment
   * (its card types and subtypes become exactly Enchantment and Aura; its name, colors and supertypes stay) with "Enchant <enchant>" and `abilities`, and with `losesOthers` no other ability.
   * As it enters, the player putting it there chooses an object it can enchant and it enters attached to it (CR 303.4f); with nothing it could enchant, it stays where it is (CR 303.4g).
   * Battlefield only. Capability `op:move.asAura`.
   */
  asAura?: { enchant: ObjectFilter; abilities: AbilityDef[]; losesOthers?: true };
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
  /**
   * edh-next-67 INTERFACE CHANGE (additive), CR 118.9, 202.3, 107.3b (Kentaro, the Smiling Cat): with `kind: 'set'` on a static ability's alternative-cost permission, "You may pay {X} rather
   * than pay the mana cost for Samurai spells you cast, where X is that spell's mana value": the alternative cost of each spell is generic mana equal to its own mana value (an X in
   * its mana cost is 0, as for the life form; a Y or Z refuses the cast). Alone (`{kind:'set', manaValue:true}`); statics/play-permits.ts#grantedAlternatives. Capability `feature:permit.cast.alternative.manaValue`.
   */
  manaValue?: true;
  /**
   * edh-d-100 INTERFACE CHANGE (additive), CR 118.9, 202.3, 107.14 (Amped Raptor: "You may cast that card by paying an amount of {E} equal to its mana value rather than paying its mana
   * cost."): with `kind: 'set'` on a cast during a resolution (op `cast`), the alternative cost is that many energy counters, the mana value of the spell as it is cast (an X in its mana cost
   * is 0, as for `life`). Alone (`{kind:'set', energy:'manaValue'}`); effects/handlers/tokens-cast.ts, actions/cast.ts. Capability `op:cast.energyManaValue`.
   */
  energy?: 'manaValue';
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
   * edh-mana-keywords-3 INTERFACE CHANGE (additive), CR 105.1, 105.4, 106.1: `distinct`, "Add two mana of different colors" (Firemind Vessel): the units are of pairwise
   * different colors (colorless is not a color), each chosen among those not chosen yet; at most five. The automatic payer does not plan it (the player activates
   * it). Capability `feature:mana.anyColor.distinct`.
   */
  | { kind: 'anyColor'; count: Quantity; from?: ManaType[]; distinct?: true }
  /**
   * FAST5 T48 INTERFACE CHANGE (additive): `from` = the types the one choice is limited to ("Add X {G} or X {W}, where X is the number of other creatures you
   * control": X mana of {G}, or X mana of {W}, never a mix; CR 106.1b, 106.4). Absent: any color (as before).
   */
  | { kind: 'anyOneColor'; count: Quantity; from?: ManaType[]; /** edh-d-22 (additive), CR 106.1b, 106.4 (Open the Omenpaths: "Add two mana of any one color and two mana of any other color"): then `otherGroup` more mana of one color other than the first group's; capability `feature:mana.anyOneColor.otherGroup` */ otherGroup?: Quantity } // "N mana of any one color"
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
  | { kind: 'chosen'; link: LinkId; count: Quantity; or?: ManaType[]; /** edh-mana-keywords-12 (CR 106.1b, 607.2d; Jeweled Amulet): the link holds a type NOTED earlier ("one mana of this artifact's last noted type"), not a chosen color; none noted, no mana. */ noted?: true } // "the chosen color"
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
  /**
   * edh-cast-15 INTERFACE CHANGE (additive), CR 106.6, 603.2, 602.2: "When you spend this mana to cast a spell or activate an ability, copy that spell or ability" (Sunken Palace):
   * the mana also triggers when it is spent to activate an ability that uses the stack (the event's `spell` role is that ability; a mana ability never uses the stack, so spending
   * mana on one triggers nothing here). Capability `feature:mana.whenSpent.abilities`.
   */
  orAbilities?: true;
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
  abilityKeyword?: 'equip' | 'power-up' | 'classLevel'; // edh-d-31 (CR 716.2a, 106.6; Sorcerer Class): 'classLevel', the level-up ability of a Class (statics/levels.ts gives it the wrapper keyword); edh-c-110 (additive), CR 702.193a: "Spend this mana only to activate power-up abilities" (Quinjet Technician)
  /**
   * FAST5X E23 INTERFACE CHANGE (additive): ... and/or on the cost to turn a face-down permanent matching this filter face up ("turn a permanent face up",
   * "turn creatures face up"): the special action of morph, disguise, manifest and cloak (CR 116.2b, 702.37e, 702.168d, 708.7), neither a spell nor an
   * ability. Capability `feature:mana.restriction.turnFaceUp`.
   */
  turnFaceUp?: ObjectFilter;
  /**
   * edh-c-48 INTERFACE CHANGE (additive), CR 106.6, 116.2h, 702.143a (Karfell Harbinger: "Spend this mana only to foretell a card from your hand or cast an instant or sorcery spell."): ... and/or on the
   * {2} of the foretell special action. Capability `feature:mana.restriction.foretell`.
   */
  foretell?: true;
  /**
   * FAST5X E23 INTERFACE CHANGE (additive): "This mana can't be spent to cast <spells>" (CR 106.6): the mana may pay any cost (an ability, a special action, a
   * cost an effect asks for) EXCEPT the cost of casting a spell matching this filter. Never combined with the other fields. Capability
   * `feature:mana.restriction.notSpells`.
   */
  notSpells?: ObjectFilter;
  /**
   * edh-mana-keywords-7 INTERFACE CHANGE (additive), CR 106.6, 107.4b (Jegantha, the Wellspring: "This mana can't be spent to pay generic mana costs."): the mana may pay any cost
   * but the generic part of one (a generic symbol, the generic half of a hybrid symbol, X): the solver keeps it off generic atoms (rules/solver.ts, `Provider.noGeneric`).
   * Never combined with the other fields. Capability `feature:mana.restriction.notGeneric`.
   */
  notGeneric?: true;
  /**
   * edh-mana-keywords-11 INTERFACE CHANGE (additive), CR 106.6, 107.3 (Elementalist's Palette: "Spend this mana only on costs that contain {X}."): the mana may pay only a cost that contains {X}, any
   * part of it (the generic part, a colored symbol, the X itself): the cost to cast a spell with {X} in its mana cost (cast for that mana cost: not for an alternative cost such as flashback, not without paying it), or the cost to activate an ability with the {X} mana symbol in its cost (not an X of another part such as "remove X counters"). It pays no other cost
   * (a cost a resolving effect asks for, a special action and a spell without {X} are not read, so the mana is not spent on them). Never combined with the other fields. Capability `feature:mana.restriction.costHasX`.
   */
  costHasX?: true;
  /**
   * edh-d-22 INTERFACE CHANGE (additive), CR 106.6, 118.9, 702.146a (Unblinking Observer: "Spend this mana only to pay a disturb cost or cast an instant or sorcery spell."): ... and/or on the
   * alternative cost of that name when a spell is cast for it (the spell's `costsPaid.alternative`; the keyword's name, "disturb"). Capability `feature:mana.restriction.viaAlt`.
   */
  viaAlt?: string;
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
  /**
   * edh-mana-keywords-4 INTERFACE CHANGE (additive), CR 106.6, 611.2a, 400.7a: with `gains`, the keyword has no stated duration ("If that mana is spent on a creature
   * spell, it gains haste.", Hall of the Bandit Lord): the effect does not wear off at end of turn, it lasts as long as the spell and the permanent it becomes
   * (core/mana-riders.ts: duration `permanent`). Capability `feature:mana.spentRider.permanent`.
   */
  permanent?: true;
  /**
   * edh-top-10 INTERFACE CHANGE (additive), CR 106.6, 611.2a, 400.7a (Jade Orb of Dragonkind: "When you spend this mana to cast a Dragon creature spell, it enters with an additional +1/+1 counter
   * on it and gains hexproof until your next turn."): with `gains`, the keyword lasts until the next turn of the mana's controller (core/mana-riders.ts: duration `untilNextTurn`), carried to the
   * permanent the spell becomes. Never with `permanent`. Capability `feature:mana.spentRider.untilNextTurn`.
   */
  untilNextTurn?: true;
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
  /**
   * edh-combat-5 INTERFACE CHANGE (additive): `phase: 'added'` = "at the beginning of that combat" (Moraug, Fury of Akoum; CR 500.8, 603.7a): the phase the `extraPhase` step before it in
   * the same resolution added, nothing else (the delayed trigger is made with the id of that phase, `$phase`, and waits for the step of that phase; a regular combat or another added
   * combat never fires it). With `step: 'beginCombat'`. Capability `feature:delayed.step.addedPhase` (triggers/forms.ts).
   */
  | { at: 'step'; step: TurnStep; whose?: PlayerPred; next?: boolean; turn?: 'next' | 'later'; anyMain?: true; phase?: 'added' }
  | { at: 'endOfCombat' }
  /** "when ~ leaves the battlefield", "the next time ... this turn" */
  /** edh-next-74 INTERFACE CHANGE (additive), CR 603.7, 603.7b (Magus Lucea Kane, Repeated Reverberation): `or`, more patterns, any of which also fires it ("when you next cast an instant spell, cast a sorcery spell, or activate a loyalty ability this turn"). Capability `feature:delayed.event.or`. */
  | { at: 'event'; event: EventPattern; or?: EventPattern[] };

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
  /**
   * edh-next-64 INTERFACE CHANGE (additive), CR 111.3, 202.1: the token has this mana cost ("It's a {1}{G} Lhurgoyf creature", the Tarmogoyf token of Disa the Restless and
   * Tarmogoyf Nest): a token has no mana cost unless the effect gives it one, so its mana value is that cost's total (CR 202.3). Capability `feature:createToken.manaCost`.
   */
  manaCost?: ManaCost;
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
  | { ev: 'zoneChange'; subject: ObjectFilter; from?: ZoneName | ZoneName[]; to?: ZoneName | ZoneName[]; cause?: 'resolve' | 'discard' /* M6-0: 'discard', madness (CR 702.35a) */ | 'craft' | 'unplayed' /* edh-zones-21: a land that entered other than by being played (CR 305.1, 603.6a; Deep Gnome Terramancer); capability `feature:ev.cause.unplayed` */; byOpponent?: true; byEffect?: true }
  /**
   * edh-zones-20 INTERFACE CHANGE (additive): `byEffect` (with `cause: 'discard'`, a replacement's `replaces` only): the discard is the effect of a spell or ability, of any
   * player ("If an effect causes you to discard a card", Library of Leng; CR 701.9a). A discard that is a cost, the cleanup step's or a rule's never matches
   * (effects/replacements.ts#matchProposed). Capability `feature:replace.byEffect` (the same name the counters and tokens form of `byEffect` has).
   */
  /** FAST1 T4 ADDITION (INTERFACE CHANGE): `nth` is "the Nth spell that player casts this turn" ("your second spell each turn"), counted like `draw.nth` (CR 601.2i). */
  /**
   * FAST5X E2 INTERFACE CHANGE (additive): `via`, the alternative cost the spell was cast for ("a spell was warped this turn" = cast for its warp cost, CR 702.185c,
   * 118.9): `CostsPaid.alternative` of the spell (a second cost of the same name, `warp:2`, counts). Capability `feature:ev.cast.via`.
   */
  /**
   * edh-next-91 INTERFACE CHANGE (additive), CR 601.2i, 603.2 (Nullstone Gargoyle: "Whenever the first noncreature spell of a turn is cast"): with `nth`, `nthMatching` and `spell`, the Nth
   * spell of the turn that matches `spell` counting the spells of EVERY player (the pattern names no caster). Capability `feature:ev.cast.nthAnyCaster`.
   */
  /**
   * FAST5X E18 INTERFACE CHANGE (additive): `nthMatching`, with `nth` and `spell`: "the Nth <spell> that player casts this turn" counts only that player's spells
   * of this turn that match `spell` ("an opponent casts their first noncreature spell each turn", CR 601.2i), read from the game history (rules/history.ts).
   * Capability `feature:ev.cast.nthMatching`.
   */
  | { ev: 'cast'; player?: PlayerPred; spell?: ObjectFilter; from?: ZoneName; orCopy?: boolean; /** edh-b-13 (CR 707.10, 603.2; Kalamax, the Stormsire): "whenever you copy an instant spell": only a copy made of a spell matches, never the cast of a spell (feature `feature:ev.cast.copyOnly`) */ copyOnly?: true; nth?: number; nthMatching?: true; anyCaster?: true; via?: string; /** std-lci (CR 106.3): "using mana produced by ~": some of the mana spent to cast it came from the pattern's own object */ manaFromSelf?: true;
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
  | { ev: 'activate'; player?: PlayerPred; source?: ObjectFilter; manaAbility?: boolean; /** edh-next-74 INTERFACE CHANGE (additive), CR 602.2b, 118.3 (Verrak, Warped Sengir): "if life was paid to activate it": the cost of the activated ability paid life (the amount is the event's amount, "that much"). Capability `feature:trigger.activateLifePaid`. */ lifePaid?: true; /** edh-next-74 INTERFACE CHANGE (additive), CR 107.3a, 602.2b (Magus Lucea Kane, Unbound Flourishing): "activate an ability with {X} in its activation cost". Capability `feature:trigger.activateXInCost`. */ xInCost?: true; /** edh-d-50 INTERFACE CHANGE (additive), CR 602.2b, 106.3 (Dynaheir, Invoker Adept): "by spending four or more mana to activate it": the mana spent on the cost of the activation, counted as it was paid (the mana of a mana ability or a free cost is none). Capability `feature:trigger.activateManaSpent`. */ manaSpentAtLeast?: number; /** edh-next-67 INTERFACE CHANGE (additive), CR 115.1, 602.2b (Professor Hojo): the ability targeted a creature its controller controls (as it was activated: triggers/normalize.ts, the history fact `targetsOwnCreature`). Capability `feature:ev.activate.targetsYourCreature`. */ targetsYourCreature?: true; ability?: 'exhaust' | 'loyalty' | 'ninjutsu' /* edh-zones-19: CR 702.49a */ | 'boast' /* edh-c-104: CR 702.142a, Frenzied Raider */; activated?: ObjectFilter; /** std-mana-1 INTERFACE CHANGE (additive), CR 106.12: with `manaAbility`, "taps <a permanent> for mana": the mana ability had {T} in its cost. Capability `feature:trigger.tappedForMana`. */ tapped?: true; /** std-mana-1 INTERFACE CHANGE (additive), CR 106.12: with `manaAbility`, "taps a land for {C}": the activation produced mana of that type. Capability `feature:trigger.tappedForMana`. */ produced?: ManaType | /** edh-mana-keywords-5 INTERFACE CHANGE (additive), CR 106.4, 605.1b, 607.2d: the mana the activation produced includes mana of the color the trigger's own object chose as it entered (link `color`): "Whenever a land's ability causes you to add one or more mana of the chosen color" (Caged Sun), "whenever a basic land is tapped for mana of the chosen color" (Gauntlet of Power). Capability `feature:trigger.producedChosen`. */ 'chosen' }
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
  /**
   * edh-combat-1 INTERFACE CHANGE (additive): `defending`, "Whenever a creature an opponent controls attacks, if you're the defending player" (Kazuul, Tyrant of the Cliffs;
   * CR 508.5, 506.3, 603.4): the defending player of the attack matches (the player attacked, the controller of the planeswalker or the protector of the battle attacked),
   * as the attack is declared (triggers/normalize.ts carries `defendingPlayer`; triggers/match.ts and rules/history.ts read it). Capability `feature:ev.attacks.defending`.
   */
  /**
   * edh-combat-5 INTERFACE CHANGE (additive): `withOther`, "Whenever you attack with ~ and another legendary creature" (Merry, Esquire of Rohan; CR 508.1, 603.2c): the same declaration of attackers
   * also declared a creature other than the attacker the event is about that matches the filter (read as the attack is declared; a creature put onto the battlefield attacking was not declared,
   * CR 508.4). Capability `feature:ev.attacks.withOther` (triggers/match.ts; a history question about it is not answerable, rules/history.ts).
   */
  /**
   * edh-players-20 INTERFACE CHANGE (additive): `otherThanAttacker`, "Whenever an opponent attacks another one of your opponents" (Karazikar, the Eye Tyrant; CR 506.2, 508.1b, 603.2c): the player
   * attacked is not the attacking creature's controller. Capability `feature:ev.attacks.otherThanAttacker` (triggers/match.ts; a history question about it is not answerable, rules/history.ts).
   */
  /**
   * edh-c-83 INTERFACE CHANGE (additive): `allAttack`, "Whenever all non-Wall creatures you control attack" (Mob Mentality; CR 508.1, 603.2c): every permanent on the battlefield that matches
   * the filter (a description with `controller: 'you'`, read for the trigger's controller) was declared as an attacker in the same declaration, and there is at least one. Capability
   * `feature:ev.attacks.allAttack` (triggers/match.ts reads the declared ids normalize.ts carries; a history question about it is not answerable, rules/history.ts).
   */
  | { ev: 'attacks'; attacker?: ObjectFilter; alone?: boolean; allAttack?: ObjectFilter; defender?: PlayerPred | 'planeswalker' | 'battle'; count?: NumberCmp; orPlaneswalker?: true; power?: NumberCmp; defending?: PlayerPred; withOther?: ObjectFilter; otherThanAttacker?: true }
  | { ev: 'blocks'; blocker?: ObjectFilter; attacker?: ObjectFilter }
  /** edh-c-48 (CR 509.3e; Seifer, Balamb Rival): `byAtLeast` = "becomes blocked by two or more creatures": one occurrence per attacker, when the number of creatures blocking it first reaches that number; `by` describes each of them. Capability `event:becomesBlocked.byAtLeast`. */
  | { ev: 'becomesBlocked'; attacker?: ObjectFilter; by?: ObjectFilter; byAtLeast?: number }
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
   * edh-zones-19 INTERFACE CHANGE (additive): `sourcePermanent`, "Whenever a permanent deals damage to you" (Dissipation Field; CR 109.2, 120.2): only damage dealt by a
   * permanent, an object on the battlefield as it deals the damage (as it last was there if it has left); a spell's or ability's damage never matches. The `source` description
   * still applies. Capability `feature:ev.damage.sourcePermanent` (triggers/match.ts).
   */
  /**
   * edhd63 INTERFACE CHANGE (additive), CR 120.1, 102.1, 109.4, 614.1a (Bitter Feud): `toOtherThanSourceController`, "damage to the other chosen player or a permanent that player controls" from a source one of the
   * chosen players controls: the damaged player, or the controller of the damaged permanent, is a player other than the controller of the damage source (the source as it last existed if it has left). Used
   * with a `source` and a `recipient` that each name the chosen players (`linked`), so the two are the two different chosen players. Capability `feature:ev.damage.toOtherThanSourceController`.
   */
  | { ev: 'damage'; source?: ObjectFilter; recipient?: { object?: ObjectFilter; player?: PlayerPred }; combat?: boolean; amount?: NumberCmp; excess?: true; amountIsToughness?: true; toSourceTarget?: true; sourcePermanent?: true; toOtherThanSourceController?: true }
  /**
   * edh-replace-3 INTERFACE CHANGE (additive), CR 615.13, 615.1: "Whenever damage that would be dealt to you is prevented" (Selfless Squire): a prevention effect was applied
   * to damage and prevented some or all of it. One occurrence for each prevention effect and recipient, the consecutive `damagePrevented` events of the simultaneous damage
   * of one batch being one occurrence (triggers/normalize.ts); its amount is the damage prevented (`{q:'eventAmount'}`, "that much"). `source` and `recipient` are judged like
   * a damage pattern's. Capability `ev:damagePrevented` (triggers/match.ts).
   */
  | { ev: 'damagePrevented'; source?: ObjectFilter; recipient?: { object?: ObjectFilter; player?: PlayerPred } }
  /**
   * FAST5X E17 INTERFACE CHANGE (additive): `nth`, of a main phase, "your second main phase": the main phase that is the Nth main phase of its turn (CR
   * 505.1b counts the main phases that have occurred in the turn; an additional main phase is a postcombat main phase but not the second one, CR 505.1a).
   * edh-d-71 (additive): `nth` 1 of an `upkeep` step is "the first upkeep each turn" (Paradox Haze; CR 503.1, 500.9): the first upkeep step that began in its turn, never an
   * additional one (`GameState.turn.upkeeps`). Capability `feature:ev.step.nth`.
   */
  | { ev: 'step'; step: TurnStep; whose?: PlayerPred; nth?: number }
  /**
   * edh-players-3 INTERFACE CHANGE (additive): `fromDamage`, life lost because damage was dealt to the player (CR 120.3a): "damage that would reduce your life total to
   * less than 1 reduces it to 1 instead" (Angel's Grace). Infect damage, a life payment and any other loss of life never match. Compared by the replacement matcher
   * (effects/replacements.ts#matchProposed) with the loss rules/damage.ts proposes through the life-loss funnel, and by triggers (triggers/normalize.ts carries
   * the damage cause of a `lifeChanged`). Capability `feature:ev.life.fromDamage`.
   */
  /**
   * edh-players-20 INTERFACE CHANGE (additive), CR 119.3, 120.3a, 603.2c: `totalAmount`, "Whenever one or more opponents each lose exactly 1 life" (Ob Nixilis, Captive Kingpin): `amount` is compared with the
   * TOTAL life that player lost in the batch (three 1/1 creatures dealing combat damage at once to one opponent are 3 life lost, not three losses of 1), a batch trigger of the whole batch
   * (triggers/occurrences.ts#byPlayerTotal). Capability `feature:ev.life.totalAmount` (a history question about it is not answerable, rules/history.ts).
   */
  | { ev: 'life'; change: 'gain' | 'loss'; player?: PlayerPred; amount?: NumberCmp; fromDamage?: true; totalAmount?: true;
    /** edh-d-54 INTERFACE CHANGE (additive), CR 614.1a, 119.3: "If a spell or ability would cause its controller to gain life" (Rain of Gore): a life GAIN that the instructions of a resolving spell or ability cause for its own controller (not lifelink, a cost, or a gain of another player). Capability `feature:replace.life.byController`. */
    byController?: true;
    /** edh-d-86 INTERFACE CHANGE (additive), CR 614.1a, 119.3, 119.4 (Enduring Angel): "If your life total would be reduced to 0 or less": with `change: 'loss'`, a loss of life (or a payment of life, CR 119.4) that would leave the player with this many life or less, judged on the life total as the event would happen (effects/replacements.ts#matchProposed). A replacement pattern only. Capability `feature:replace.life.toAtMost`. */
    toAtMost?: number }
  /**
   * r5-repl INTERFACE CHANGE (additive): `exceptFirstInDrawStep`, "If you would draw a card except the first one you draw in each of your draw steps" (CR 504.1,
   * 614.1a): not the first card the player draws in their own draw step. Compared by the replacement matcher only (effects/replacements.ts#matchProposed,
   * `feature:replace.draw.exceptFirstInDrawStep`). edh-players-1 (additive): also a trigger pattern, "Whenever an opponent draws a card except the first one they
   * draw in each of their draw steps" (Orcish Bowmasters), judged on the draw event (triggers/normalize.ts says whether it was that first card, match.ts reads it).
   * Capability `feature:ev.draw.exceptFirstInDrawStep`.
   */
  | { ev: 'draw'; player?: PlayerPred; nth?: number; exceptFirstInDrawStep?: true; /** edh-d-98 (CR 121.2, 614.1a; Scion of Halaster): a REPLACEMENT pattern only, "the first time you would draw a card each turn": the first draw proposed for the player this turn, replaced or not (`turnStats.drawsProposed`, effects/replacements.ts#matchProposed). Capability `feature:replace.draw.firstEachTurn`; as a trigger pattern it is unsupported */ firstEachTurn?: true }
  /**
   * edh-next-144 INTERFACE CHANGE (additive), CR 701.20a, 603.2, 607.2 (Keranos, God of Storms): "Whenever you reveal a land card this way": the reveal a `revealFirstDraw` rule of the
   * trigger's OWN source made (`thisWay`, the linked pair of CR 607.2; another object's reveal is not "this way"), by a player `player` matches, of a card `card` describes (judged in the hand
   * the card was revealed in). Emitted by triggers/reveal-draw.ts only. Capability `ev:reveal`.
   */
  | { ev: 'reveal'; player?: PlayerPred; card?: ObjectFilter; thisWay: true }
  /**
   * M6-0 widened `what` (m6 design 2.1): 'turnedFaceDown' (CR 708.2b), 'converted' (CR 701.28), 'flipped' (CR 710), 'mutated' (CR 702.140d), 'melded'
   * (CR 701.42), 'solved' (CR 719.3b), 'prepared' (CR 722.3a), 'classLevel' (CR 716.2a: "When this Class becomes level N", with `level`).
   */
  | { ev: 'becomes'; what: BecomesWhat; object: ObjectFilter; by?: ObjectFilter; level?: number; door?: 'this'; player?: PlayerPred;
    /** Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 502.3: with `untapped` only, untapped by the untap step's turn-based action ("you untap one or more permanents during your untap step"). Capability `feature:ev.becomes.untapStep`. */
    untapStep?: true;
    /** edh-players-20 INTERFACE CHANGE (additive), CR 508.1f: with `tapped` only, "if it isn't being declared as an attacker" (Verity Circle): not tapped as it was declared as an attacker (one that becomes tapped while attacking, vigilance or not, still counts). Capability `feature:ev.becomes.notAsAttacker`. */
    notAsAttacker?: true;
    /** edh-next-76 INTERFACE CHANGE (additive), CR 701.27e, 603.2: with `transformed` only, "whenever a permanent you control transforms into a Phyrexian": the description the permanent matches after it transformed (its characteristics are those of the face it transformed into). Capability `feature:ev.becomes.into` */
    into?: ObjectFilter } // door: FAST5X E8 (CR 709.5h, 709.5j); player: cloud std-dsk INTERFACE CHANGE (additive), "whenever you turn a permanent face up" (CR 702.37e, 708.2): the player who turned it face up, `turnedFaceUp` only (feature:ev.becomes.turnedFaceUp.player); Standard round 4, r4-trig INTERFACE CHANGE (additive): with `targeted`, the PLAYER who becomes the target ("whenever a player or permanent becomes the target of an ability you control", CR 115.1, 603.2; `object` is then `{}` and unread; feature:ev.becomes.targeted.player)
  /** M6-0 `byEffect` (CR 614.16): "if an EFFECT would put counters": matches only proposals whose cause is 'effect' or 'replacement' (effects/api.ts). */
  /**
   * FAST5X E21 INTERFACE CHANGE (additive): `by`, the player who puts the counters ("whenever YOU put one or more +1/+1 counters on a creature you control"):
   * the controller of the spell or ability whose instruction puts them, the player paying a cost, or the controller of a permanent entering with them (CR 122.6,
   * 122.6a); capability `feature:ev.counters.by`. `atLeast` with a number: the event makes the number of counters of the kind reach it ("the fourth plan counter").
   */
  | { ev: 'counters'; change: 'put' | 'removed'; kind?: CounterKind; on: ObjectFilter | { player: PlayerPred }; atLeast?: Quantity; byEffect?: true; by?: PlayerPred; /** edhn63 INTERFACE CHANGE (additive), CR 122.6: with `by`, "an opponent puts one or more counters on a creature THEY control" (Bold Plagiarist): the player who puts them is the controller of the permanent they go on; capability `feature:ev.counters.byController` */ byController?: true }
  | { ev: 'action'; verb: KeywordActionName | 'sacrifice' | 'discard' | 'cycle' | 'foretell' /* edh-d-73: "whenever you foretell a card", CR 702.143a (core/special/foretell.ts emits it) */ | 'scry' | 'scryBottom' /* edh-d-96: "whenever you choose to put one or more cards on the bottom of your library while scrying" (CR 701.22a; The Temporal Anchor): the scry handler emits it after a scry that put at least one card on the bottom, with `x` the number of them (effects/handlers/cards-library.ts) */ | 'surveil' | 'search' | 'shuffle' | 'mill' | 'draw' /* Cloud r4-repl: a replacement's "would draw one or more cards" only (effects/proposal-kinds/draw-many.ts) */ | 'create' | 'playLand' | 'regenerate' | 'exile' | 'destroy' | 'tap' | 'untap' | 'counter' | 'attach' | 'transform' | 'reveal' | 'completeDungeon' /* MX4: "whenever you complete a dungeon", CR 309.7 */
    | 'commitCrime' | 'expend' /* FAST5X E20: "whenever you commit a crime" (CR 700.13), "whenever you expend N" (CR 700.14, with `n`) */
    | 'votesFinished' /* M12F: "whenever players finish voting" (CR 701.38a), the `votesFinished` GameEvent; no actor and no object */
    | 'exploit' /* std-rx17: "<object> exploits a creature" (CR 702.110b); `object` is the exploiting creature */
    | 'payLife' /* std-library-4: a replacement's "if you would pay life" only (effects/proposal-kinds/pay-life.ts, CR 119.4, 614.1a) */
    | 'crew' /* edh-next-39: a crew ability of the Vehicle resolved (CR 702.122e); normalize.ts reports it as the Vehicle "becomes crewed" */
    | 'adaptAsNoCounters' /* edh-next-110: a mark in the turn history, "the next time target creature adapts this turn, it adapts as though it had no +1/+1 counters on it" (CR 701.46a, Biomancer's Familiar; op reportAction; history only) */
    | 'firebend' /* std-mana-12: "whenever you firebend", a firebending ability of yours resolved (CR 702.189; op reportAction) */
    | 'enlist' /* edh-c-49: "whenever ~ enlists a creature" (CR 702.154a); the enlisting (attacking) creature is the event's `object` (core/attack-options.ts emits it) */
    | 'fight' /* edh-combat-6: "whenever a creature you control fights" (CR 701.14a); the fighting creature is the event's `object`, one event for each creature of each fight (effects/handlers/lifedamage.ts) */
    | 'evolve' /* edh-c-48: "whenever ~ evolves" (rulings of Renegade Krasis, CR 702.100a): an evolve ability put a +1/+1 counter on the creature; the creature is the event's `object` (effects/handlers/counters.ts) */
    | 'payCumulativeUpkeep' | 'failCumulativeUpkeep' /* edh-d-74 (CR 702.24a): "whenever you pay ~'s cumulative upkeep" / "when a player doesn't pay ~'s cumulative upkeep"; the permanent is the event's `object`, the player who paid or did not the actor (effects/handlers/pay.ts) */
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
    won?: boolean;
    /**
     * edh-players-18 INTERFACE CHANGE (additive), CR 121.2, 614.1a (Alms Collector): only with the verb `draw` of a replacement ("if an opponent would draw two or more cards"): the
     * number of cards the draw instruction or draw step would draw at once is at least this (the `drawMany` proposal's count, effects/proposal-kinds/draw-many.ts).
     * Capability `feature:ev.action.draw.atLeast`; on any other verb never registered (fail closed).
     */
    atLeast?: number;
    /**
     * edh-players-22 INTERFACE CHANGE (additive), CR 701.8a, 109.5 (Karmic Justice): only with the verb `destroy`, "a spell or ability an opponent controls destroys a noncreature permanent you
     * control": the controller of the spell or ability whose instruction destroyed the permanent (a destruction by a state-based action, lethal damage or deathtouch, has none and never
     * matches). The event's `by` role is that player. Capability `feature:ev.action.destroy.by`; on any other verb never registered (fail closed).
     * edh-next-132 (CR 701.9a; Orvar, the All-Form, Guerrilla Tactics): also with the verb `discard`, "a spell or ability an opponent controls causes you to discard this card": the controller of the
     * spell or ability whose instruction made the player discard (a cost, the cleanup step or a rule has none). Capability `feature:ev.action.discard.by`.
     */
    by?: PlayerPred }
  | { ev: 'createToken'; player?: PlayerPred; token?: ObjectFilter; byEffect?: true /* M6-0, CR 614.16 */ }
  /**
   * edh-next-55 INTERFACE CHANGE (additive), CR 706.2, 603.2c: `highest`, "Whenever you roll a die's highest natural result" (Netherese Puzzle-Ward): only a roll whose natural result (before any
   * modifier of the roll) is the greatest number the die has (a 6 on a d6, a 20 on a d20). Matched by triggers/match.ts and rules/history.ts from the roll's `natural` and `sides`; a roll
   * that does not state its natural result never matches.
   */
  /** edhn115 INTERFACE CHANGE (additive), CR 706.2, 603.2c: `natural`, "Whenever you roll a natural 20" (Critical Hit): the NATURAL result of the die (before any modifier) is exactly that number; matched by triggers/match.ts and rules/history.ts from the roll's `natural`, a roll that does not state it never matches. No capability of its own (as `highest`). */
  | { ev: 'dieRoll'; player?: PlayerPred; result?: NumberCmp; highest?: true; natural?: number }
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
   * edh-players-18 INTERFACE CHANGE (additive), CR 725.1, 725.3: "until an opponent becomes the monarch" (Palace Jailer), "whenever you become the monarch": a player becomes the monarch
   * (a player who already is the monarch does not become it again). Normalized from `designationChanged` (triggers/normalize.ts). Capability `ev:monarch` (triggers/match.ts).
   */
  | { ev: 'monarch'; player?: PlayerPred }
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
  /** edh-next-74 INTERFACE CHANGE (additive), CR 603.2, 603.6a (Aboleth Spawn): `causedBy: 'entering'`, "a creature entering under an opponent's control causes a triggered ability of that creature to trigger": that object entering the battlefield caused it. Capability `feature:ev.abilityTriggered.entering`. */
  | { ev: 'abilityTriggered'; of?: ObjectFilter; causedBy?: 'attacking' | 'entering'; /** edhn78 (CR 714.2, 714.2d): only a Saga's final chapter ability ("Whenever the final chapter ability of a Saga you control triggers", Historian's Boon). */ finalChapter?: true };

/** The phases of a turn (CR 500.1), as `phase` patterns and proposals name them. */
export type TurnPhase = 'beginning' | 'precombatMain' | 'combat' | 'postcombatMain' | 'ending';

/** What an object `becomes` (CR 603.2, 700.4). The members after 'crewed' are M6-0's (m6 design 2.1). */
export type BecomesWhat =
  | 'tapped' | 'untapped' | 'targeted' | 'attached' | 'unattached' | 'transformed' | 'turnedFaceUp' | 'monstrous' | 'renowned' | 'saddled' | 'crewed'
  | 'turnedFaceDown' | 'converted' | 'flipped' | 'mutated' | 'melded' | 'solved' | 'prepared' | 'classLevel'
  | 'phasedOut' | 'phasedIn' /* edh-d-39 INTERFACE CHANGE (additive): "whenever ~ phases in", "whenever one or more other permanents phase out" (CR 702.26b-c, 603.2); capability `feature:ev.becomes.phasedOut` / `.phasedIn` (triggers/forms-phase.ts) */
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
  /**
   * edh-next-133 INTERFACE CHANGE (additive), CR 611.3d, 400.7b, 601.2a-b (Ashling, the Limitless: "Elemental permanent spells you cast from your hand gain evoke {4} as you
   * cast them"; Zinnia, Valley's Voice: "... gain offspring {2} as you cast them"): a static ability's layer 6 grant to spells you cast that the spell GAINS as it is cast:
   * while a card is being considered for casting (the castCheck overlay, statics/rule-sources.ts#overlayAsSpell) the static grants it as usual, so its cast cost is
   * offered; as the card is put on the stack (CR 601.2a) the grant becomes a stored effect on that spell with no duration (CR 611.3d: until the end of the game), which
   * follows it to the battlefield (CR 400.7a-b; core/move-parts/spell-effects.ts) even if the source leaves (the Ashling ruling of 2025-11-17), and the static itself no
   * longer applies to a spell already cast (statics/layers.ts#matchSet). Only on a static ability's `continuous` effect over spells (actions/cast.ts#lockAsCastGrants).
   * Capability `feature:static.asCast`.
   */
  asCast?: true;
  /**
   * edh-next-147 INTERFACE CHANGE (additive), CR 611.3a, 604.2 (Multiclass Baldric: "Equipped creature has lifelink if you control a Cleric, deathtouch if you control a Rogue,
   * ..."): this effect of a static ability applies only while `when` holds, judged as the ability's own `condition` is (statics/live.ts#staticEffectsOf), each effect of the
   * ability by its own condition. Static abilities only, never a characteristic-defining effect; capability `feature:static.effectWhen`.
   */
  when?: Condition;
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
  /**
   * edh-next-120 INTERFACE CHANGE (additive), CR 612.5, 701.12h, 613.1c (Deadpool, Trading Card): "exchange his text box and another creature's": the affected object's rules text
   * (its abilities that are text of the object: printed, keyword expansions, copied; never granted ones, CR 612.3) becomes the rules text the object `rulesTextOf` names had as
   * the exchange began: the snapshot of its copiable values the stored record carries (`ContinuousEffectRec.textOf`, written once by effects/text-exchange.ts; never card data).
   * Its name, mana cost, types, power and toughness are not text of the text box and stay (CR 612.5). Without a snapshot it changes nothing.
   */
  | { layer: 3; rulesTextOf: ObjRef }
  | { layer: 3; changeWord: { from: string | ChosenWord; to: string | ChosenWord; kind: 'color' | 'landType' | 'creatureType' } }
  /**
   * FAST5 T69 INTERFACE CHANGE (additive, `named`): "is a green and white Citizen creature ... named Legitimate Businessperson", "becomes a legendary creature
   * named Mileva, the Stalwart": the object's name becomes exactly this one (CR 201.2; it loses its other names), applied with the type changes (statics/mods.ts#layer4).
   */
  /**
   * edh-next-146 INTERFACE CHANGE (additive), CR 612.8, 201.2, 607.2d (Psychic Paper: "its name and creature type are the last chosen name and creature type"): `namedChosen`, the
   * object's name becomes exactly the card name the SOURCE's link holds (the last value chosen; it loses its other names), applied with `named`; nothing chosen changes nothing.
   * Capability `feature:layer4.namedChosen`.
   */
  | { layer: 4; types?: TypeChange; subtypes?: TypeChange; supertypes?: TypeChange; named?: string; namedChosen?: LinkId }
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
  /**
   * edh-perms-4 INTERFACE CHANGE (additive), CR 613.1f, 702.5a, 303.4a: `removeEnchant`, "it loses "enchant creature card in a graveyard"" (Animate Dead, Dance of the Dead):
   * the object loses its enchant abilities whose filter is exactly this one (an enchant ability it gained some other way stays); with `add` it also "gains" the enchant
   * ability that replaces it. Capability `feature:layer6.removeEnchant`.
   */
  /**
   * edh-players-15 INTERFACE CHANGE (additive), CR 702.16a, 105.1, 608.2h, 400.7; Éowyn, Fearless Knight: `protectionFromColorsOf`, "protection from each of that creature's colors": as a
   * resolved effect is created, it is replaced by `add` of one protection from each color the referenced object has (its last known information when it has left; an object with no
   * color, or one that can't be found, gives none). Never stored (effects/handlers/lasting.ts#expandVariants); a static ability's modification never has it (capability
   * `feature:mod.protectionFromColorsOf`, `feature:mod.protectionFromColorsOf.static`).
   */
  | { layer: 6; add?: AbilityDef[]; removeAll?: boolean; /** edh-d-46 INTERFACE CHANGE (additive), CR 613.1f, 605.1a (Blood Sun): with `removeAll`, "except mana abilities": the activated mana abilities stay. Capability `feature:layer6.removeAll.exceptMana`. */ exceptMana?: true; remove?: string[]; removeEnchant?: ObjectFilter; cantHave?: string[]; addActivatedOf?: ObjRef; /** edh-next-141 INTERFACE CHANGE (additive), CR 609.4b, 613.1f, 608.2h (Grell Philosopher): with `addActivatedOf` in a resolved effect, "You may spend <color> mana as though it were mana of any color to activate those abilities": each ability the effect copies (fixed as it begins, effects/handlers/lasting-fix.ts) gets `spendColorAsAny` (statics/mods.ts). Capability `feature:layer6.addActivatedOf.spendColorAsAny`. */ spendColorAsAny?: Color; /** edh-d-102 INTERFACE CHANGE (additive), CR 613.1f, 702.167c, 702.16a (Wretched Bonemass: "This creature has flying as long as an exiled card used to craft it has flying. The same is true for first strike, ..., protection, reach, trample, and vigilance."): `keywordsOf`, the objects whose keywords are shared: of the keywords named in `keywordsFirst` and `keywordsAmong` (by keyword name), each instance one of those objects has as this effect applies in layer 6 (their characteristics so far, the quality of "protection from red" or "hexproof from blue" kept), granted to the affected object; none of them having it, nothing. Capability `feature:layer6.keywordsOf`. */ keywordsOf?: ObjRef; keywordsFirst?: AbilityDef[]; keywordsAmong?: AbilityDef[]; otherAbilitiesOfCard?: true; activatedOfLimit?: { per: 'turn'; max: number }; alsoTriggered?: true; /** edh-next-124 INTERFACE CHANGE (additive), CR 606.1, 606.3, 613.1f (Nicol Bolas, Dragon-God; Scryfall rulings 2024-01-12): with `addActivatedOf`, "has all loyalty abilities of <objects>": only the loyalty abilities of those objects (an activated ability with `isLoyalty` or a loyalty cost), never their other activated, static or triggered abilities. Capability `feature:layer6.addActivatedOf.loyalty`. */ loyaltyOnly?: true; protectionFromColorsOf?: ObjRef; /** edhd63 INTERFACE CHANGE (additive), CR 702.1, 607.2d, 613.1f (Greymond, Avacyn's Stalwart): "have each of the chosen abilities": layer 6 gives the affected objects one simple keyword (flying, first strike, double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, reach, trample, vigilance) for each value the SOURCE's link `addChosen` holds (`chooseValue`/`enters.choose` with `what: 'option'`); a value that is not one of those is ignored. A static ability only. Capability `feature:layer6.addChosen`. */ addChosen?: LinkId }
  | { layer: '7a'; power?: Quantity; toughness?: Quantity }
  | { layer: '7b'; power?: Quantity; toughness?: Quantity }
  | { layer: '7c'; power?: Quantity; toughness?: Quantity }
  | { layer: '7d'; switchPT: true };

export type Layer = Modification['layer'];

/** M6-0, CR 708.2a / 701.40a / 702.37a: a 2/2 with no name, text, subtypes or mana cost; 'ward2' adds ward {2} (CR 702.168a, 701.58a). */
export type FaceDownProfile = 'plain' | 'ward2' | FaceDownSet;
/**
 * edh-mana-keywords-12 (CR 708.2a, 613.2b, 708.4; Yedora, Cyber Conversion + their rulings): a face-down permanent whose effect gives it set characteristics: "It's a Forest land." /
 * "It's a 2/2 Cyberman artifact creature." The profile is `set:<card types>|<subtypes>|<power>/<toughness>` (types and subtypes comma-separated; the last part empty for no power and
 * toughness): no name, no color, no abilities of its own (a basic land type brings its mana ability, CR 305.6), nothing else of the card. Capability `feature:faceDown.set`.
 */
export type FaceDownSet = `set:${string}`;

/** M6-0: the exceptions a copy effect's card data may state (CR 707.9). Only `Modification` and `retain` are copiable values (CR 707.9a-c). */
export type CopyExcept =
  /** CR 707.9a-b: "except it's an artifact", "except it's 7/7", "except it has [ability]", "except it isn't legendary". */
  | Modification
  /** CR 707.9c: "except it doesn't copy that creature's color": the copy keeps its own values, materialized when the effect begins (m6 design 3.3). */
  | { retain: ('name' | 'manaCost' | 'colors' | 'types' | 'subtypes' | 'supertypes' | 'power' | 'toughness')[] }
  /** CR 707.9f: "if it's a creature, ...": judged on the result of the copy without this exception (m6 design 3.3); stored only if it applies. */
  | { if: ObjectFilter; then: CopyExcept[] }
  /**
   * edh-next-122 INTERFACE CHANGE (additive), CR 707.9b, 202.1b, 702.128b (Vizier of Many Faces): "except ... the token has no mana cost": the copy has no mana cost (mana value 0), a
   * copiable value (statics/copy.ts#applyCopiable). Capability `body:enters.copy.noManaCost` (on an `enters` copy).
   */
  | { noManaCost: true }
  /**
   * edh-next-136 INTERFACE CHANGE (additive), CR 707.9b, 306.5b, 707.2 (Jace, Mirror Mage: "create a token that's a copy of Jace, except it's not legendary and its starting loyalty is 1"; ruling
   * 2020-09-25): the copy's loyalty (the printed number a planeswalker enters with as loyalty counters) is this number, a copiable value (statics/copy.ts#applyCopiable), so a copy of the copy
   * has it too. Capability `op:copy.except` (on a token copy).
   */
  | { startingLoyalty: number }
  /**
   * edh-next-122 INTERFACE CHANGE (additive), CR 707.9b, 702.128b, 614.1c (Vizier of Many Faces: "except if this creature was embalmed, the token has no mana cost, it's white, and it's a
   * Zombie in addition to its other types"): the exceptions `then` apply only when the object entering as the copy is a token created by a resolving embalm ability (the `embalmed`
   * fact of its entering, effects/handlers/tokens-copy.ts); judged as it enters (effects/enters-parts/copy.ts). Only on an `enters` copy. Capability `body:enters.copy.ifEmbalmed`.
   */
  | { ifEmbalmed: true; then: CopyExcept[] }
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
  /**
   * edh-zones-24 INTERFACE CHANGE (additive), CR 613.1d, 205.3d; Duplicant: `setFrom`, "has the creature types of the last creature card exiled with it": the object's creature types
   * become exactly the creature types of the object this reference names (none of them: it has no creature types), as `set` with their list, read when the layer is applied. With
   * `add` ("It's still a Shapeshifter") the added types stay. Nothing is changed while the reference stands for no object. Capability `feature:subtypes.setFrom`.
   */
  setFrom?: ObjRef;
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
    /**
     * edh-cast-6 INTERFACE CHANGE (additive), CR 602.2, 605.1a, 601.2f: `exceptMana`, "Abilities you activate that aren't mana abilities cost {2} less to activate" (Zirda, the
     * Dawnwaker): every activated ability (loyalty abilities too) but a mana ability. statics/costmods.ts#abilityCostModsFor. Capability `feature:costMod.abilities.reduce`.
     */
    abilities?: { source?: ObjectFilter; kind?: 'activated' | 'loyalty' | 'mana'; keyword?: string; exceptMana?: true };
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
     * edh-next-48 INTERFACE CHANGE (additive), CR 601.2f, 118.9, 702.34a (Visions of Dominance): with `self`, the change applies only to the spell cast for the alternative cost
     * of this name ("Flashback {8}{G}{G}. This spell costs {X} less to cast this way, where X is ..."). A keyword's `costChange` on a flashback keyword is expanded to such a static
     * ability (keywords/expand.ts); read by statics/costmods.ts#costModsFor, which actions/cast.ts#modifiedPlan gives the alternative cost being paid.
     */
    via?: string;
    /**
     * std-rx27 INTERFACE CHANGE (additive), CR 602.2b, 601.2f, 118.9: "you may pay {0} rather than pay the equip cost of the first equip ability you activate each
     * turn" (Kili the Resourceful): with `abilities.keyword`, the change applies to an ability with that keyword only when the caster has activated no ability with
     * it this turn (counted in `GameState.turnActivations` under `kw:<player>:<keyword>`, actions/activate.ts), and only to an ability whose cost is mana alone
     * (any other cost part: the option is not taken, as a player may decline it). Capability `feature:costMod.abilities.firstEachTurn`.
     * edh-mana-keywords-8: `'yourTurns'`, "the first equip ability you activate during each of your turns" (Forge Anew): and only during a turn of the static ability's controller.
     */
    firstEachTurn?: true | 'yourTurns';
    /**
     * edh-next-58 INTERFACE CHANGE (additive), CR 115.1, 601.2c, 601.2f, 115.9b (Monastery Siege): with `spells.targets`, the spell ALSO applies when one of its targets is the modifier's controller
     * ("Spells your opponents cast that target you or a permanent you control cost {2} more to cast"): it targets an object of the `targets` description, or that player. Counted once, however
     * many of its targets qualify. statics/costmods.ts#appliesToSpell. Capability `feature:costMod.spellTargets.orYou`.
     */
    orTargetsYou?: true;
  };
  /**
   * FAST4 T21 INTERFACE CHANGE (additive): `times` is how many times `mana` is added or removed (default once; `increase` and `reduce` only): "costs {2}{R}
   * more to cast for each target beyond the first" is `mana` {2}{R} `times` max(0, targets - 1) (CR 601.2f, 118.7); "costs {3} less to cast if it targets a
   * tapped creature" is `mana` {3} `times` min(1, its targets that are tapped creatures). statics/costmods.ts#modifyMana evaluates it as it does `generic`.
   */
  change: {
    kind: 'increase' | 'reduce' | 'set'
    /**
     * edh-next-12 INTERFACE CHANGE (additive), CR 601.2f, 118.7 (Trinisphere): `floor` as a KIND: "each spell that would cost less than three mana to cast costs three mana to cast":
     * `generic` is the number of mana (a number). After every increase, reduction and set cost (Trinisphere ruling 2020-08-07: the effect is applied last), a cost with fewer
     * than that many mana gets generic mana added up to it (a {1}{B} cost becomes {2}{B}); a cost of that many or more is unchanged. Capability `feature:costMod.floorTotal`.
     */
    | 'floor'; mana?: ManaCost; generic?: Quantity; times?: Quantity;
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
    /**
     * edh-cast-4 INTERFACE CHANGE (additive), CR 601.2f, 118.7: `coloredOnly`, with `kind: 'reduce'` and `mana` of colored symbols alone, "This effect reduces only the amount of
     * colored mana you pay" (Morophon, the Boundless): each symbol reduces the mana of its own color in the cost, and a symbol the cost has no such mana for reduces nothing
     * (without it, CR 118.7b reduces the generic part instead). Spells only. statics/costmods.ts#modifyMana; capability `feature:costMod.coloredOnly`.
     */
    coloredOnly?: true;
    /**
     * edh-next-142 INTERFACE CHANGE (additive), CR 606.4, 601.2f, 118.8 (Carth the Lion; rulings 2021-06-18; CR 107.7): `loyalty`, with `kind: 'increase'` and `applies.abilities.kind: 'loyalty'`, "Planeswalkers'
     * loyalty abilities you activate cost an additional [+1] to activate": the loyalty cost of each such ability is that many more ([+1] becomes [+2], [0] becomes [+1], [−6] becomes [−5]; a
     * −X cost removes X less), once for each modifier, worked out before any counter is put or removed (actions/activate.ts#costChangeOf). Capability `feature:costMod.abilities.loyalty`.
     */
    loyalty?: number;
  };
}

/** "Can't"/"must"/"only" effects (CR 614.17, 508.1d). They constrain actions; they are not replacement effects. */
export interface RestrictionDef {
  s: 'restrict';
  /**
   * edh-next-143 INTERFACE CHANGE (additive), CR 116.2d, 116.1 (Leonin Arbiter: "Players can't search libraries. Any player may pay {2} for that player to ignore this effect until end of
   * turn."): on a static ability's restriction of players, any player may pay this cost as a special action, any time they have priority, to ignore this effect of THIS object for the
   * rest of the turn (`GameState.ignoredEffects`; core/special/ignore-effect.ts). Each object's effect is paid for separately (a new object is a new effect, CR 400.7). Capability
   * `feature:restrict.ignoreFor`.
   */
  ignoreFor?: CostDef;
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
   * edh-next-145 INTERFACE CHANGE (additive), CR 601.2i, 611.2c (Irencrag Feat, rulings 2019-10-04): "You can cast only one more spell this turn": the limit `max` counts only the spells cast
   * AFTER the effect began: `countFrom` is the count of spells the player had cast this turn when it began (`{q:'spellsCastThisTurn'}` in the template, fixed to a number as the effect is
   * created, effects/handlers/lasting-fix.ts), taken off the turn's count. Only on a `cant` `cast` limit with no `other`; a `countFrom` that is not a number (a static ability) is applied as a ban.
   * Capability `feature:restrict.max.cast.countFrom`.
   */
  countFrom?: Quantity;
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
   * edh-b-12 INTERFACE CHANGE (additive): with `exceptMana`, loyalty abilities are not restricted either ("Enchanted player can't activate abilities that aren't mana abilities or
   * loyalty abilities", Overwhelming Splendor; CR 602.5, 605.1a, 606.1): statics/hooks.ts#canActivate tells the ability's wrapper keyword ('loyalty' for a loyalty ability), and an
   * ability of unknown kind is restricted (fail closed). Only `activate` with `exceptMana: true`. Capability `feature:restrict.exceptLoyalty.activate`.
   */
  exceptLoyalty?: true;
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
   * edh-d-75 INTERFACE CHANGE (additive; CR 508.1d, 506.4; Seeker of Slaanesh, Trove of Temptation): "Each opponent must attack with at least one creature each combat if able": a
   * `mustIfAble` `attack` requirement that binds not each creature of the subject but the player who controls them as a group: ONE requirement for each controller of the subject's
   * creatures, obeyed when at least one of their creatures attacks (a defender among those `other` / `otherPlayer` name, when it has them: "attack you or a planeswalker you control with at
   * least one creature"). A creature that can't attack does not take part; a requirement no creature could obey is not counted (508.1d). It is no requirement of any one creature (ruling
   * 2022-06-10: such a creature "had to attack" nothing). statics/requirements.ts#sourceHits makes the group hit, rules/requirements.ts judges it. Only with `mode: 'mustIfAble'`
   * and `action: 'attack'`, no `max`, `min`, `alone`, `goad`. Capability `feature:require.atLeastOne.attack`.
   */
  atLeastOne?: true;
  /**
   * edh-d-88 INTERFACE CHANGE (additive; CR 508.1d, 506.4; War's Toll): "If a creature an opponent controls attacks, all creatures that opponent controls attack if able": a `mustIfAble`
   * `attack` requirement of each creature of the subject that applies only when another creature of the same controller attacks in the same declaration: ONE requirement for each such
   * creature that can attack, obeyed when it attacks or when none of its controller's creatures the subject names attacks (the condition is false, so the requirement does not apply;
   * an empty declaration obeys every one of them). statics/requirements.ts#sourceHits makes the hits (`allIfAny`), rules/requirements.ts judges them. Only with `mode: 'mustIfAble'`
   * and `action: 'attack'`, no `other`, `otherPlayer`, `max`, `min`, `alone`, `goad`, `atLeastOne`, `exactly`. Capability `feature:require.allIfAny.attack`.
   */
  allIfAny?: true;
  /**
   * edh-d-75 INTERFACE CHANGE (additive; CR 509.1c; Nacatl War-Pride): "This creature must be blocked by exactly one creature if able": a `mustIfAble` `beBlocked` requirement obeyed only when
   * EXACTLY this many creatures block the attacker (a block by more, or by none, does not obey it; ruling 2007-05-01: when exactly one block is impossible, the defending player may block
   * it with several creatures or leave it unblocked, which is the "maximum number of requirements" of CR 509.1c). No `min`, `max`, `other`, `atLeastOne`. Capability `feature:require.exactly.beBlocked`.
   */
  exactly?: number;
  /**
   * std-control-1 INTERFACE CHANGE (additive): of an `activate` restriction, only the activated abilities with this wrapper keyword ("power-up abilities can't
   * be activated", CR 602.5, 702.193a; `ActivatedAbilityDef.keyword`); statics/hooks.ts#canActivate tells it the ability's keyword, and an ability of unknown
   * keyword is restricted (fail closed). Capability `feature:restrict.abilityKeyword.activate`. edh-players-6 (CR 606.1): `loyalty` names the loyalty abilities ("Players can't
   * activate planeswalkers' loyalty abilities", The Immortal Sun).
   */
  abilityKeyword?: string;
  /**
   * p2-graveyard-2 INTERFACE CHANGE (additive): of a `castFromZone` restriction, the zones it names ("Players can't cast spells from graveyards or libraries",
   * Grafdigger's Cage; "... from graveyards or exile", Soulless Jailer; CR 601.3, 101.2): a spell cast from one of them is restricted (statics/hooks.ts#canCast
   * tells the zone the card is cast from); absent, the graveyard only. Capability `feature:restrict.fromZones.castFromZone`.
   */
  fromZones?: ZoneName[];
  /**
   * edh-b-2 INTERFACE CHANGE (additive): of a `haveCountersPut` restriction, the one kind of counter it forbids ("Creatures your opponents control can't have +1/+1 counters put on
   * them", Blightbeetle; "Creatures you control can't have -1/-1 counters put on them", Darksteel Angel; CR 122.6, 614.17, 101.2): counters of other kinds can still be put.
   * Asked with the kind of the counters (rules/counters.ts#countersPutDenial); a call-site that names no kind applies it (fail closed). Capability `feature:restrict.counter.haveCountersPut`.
   */
  counter?: string;
  /**
   * edh-combat-1 INTERFACE CHANGE (additive): "~ can't attack a player it has already attacked this turn" (Port Razer, Bloodthirster; CR 508.1b, 508.1c, 506.2): a
   * `cant` `attackPlayer` restriction of a creature that forbids attacking a player this creature was already declared as an attacker of earlier this turn (an
   * `attacks` history entry of the turn whose subject is the creature and whose defender is that player: a planeswalker or battle the player controls or protects
   * is not "a player it attacked"). The player attacked is the one asked at canAttack (`other` of the call-site, statics/hooks.ts#verdict); no `otherPlayer`, `other`,
   * `max`, `min`, `alone`. Capability `feature:restrict.alreadyAttacked.attackPlayer`.
   */
  alreadyAttacked?: true;
  /**
   * edhd63 INTERFACE CHANGE (additive; CR 101.4, 506.2, 508.1b-c, 801.2, 802.3; Pramikon, Sky Rampart; Mystic Barrier; Teyo, Geometric Tactician): "Each player may attack only the nearest opponent in the
   * chosen direction and planeswalkers controlled by that opponent": a `cant` `attack` restriction (no `other`, `otherPlayer`, `max`, `min`, `alone`) that forbids a creature of the subjects to
   * attack any player but the nearest player to the creature's controller on a side, any planeswalker that player does not control, and any battle. The side is `{ side }` (a resolved effect:
   * fixed when it began) or `{ chosen }`, the first value of the link the source's `chooseValue` / `enters.choose` (options `left`, `right`) kept (a static ability). The nearest player
   * is the next one in turn order on that side still in the game (core/multiplayer.ts#seatNeighbor; this engine has no teams, so every other player is an opponent). Asked about an attack on a
   * defender, with no side to read, it does nothing (Pramikon ruling 2019-08-23). Capability `feature:restrict.onlyNearest.attack`.
   */
  onlyNearest?: { side: 'left' | 'right' } | { chosen: LinkId; /** only the wording: "the last chosen direction" (a choice made again each turn) rather than "the chosen direction" */ last?: true };
  /**
   * edh-combat-6 INTERFACE CHANGE (additive; CR 506.5, 508.1c; Master of Cruelties): "~ can only attack alone": a `cant` `attack` restriction that forbids not the creature but the
   * whole declaration in which it is one of two or more attackers (it may be declared as the only attacker; a creature put onto the battlefield attacking afterwards doesn't break it,
   * ruling 2013-04-15). Judged on the declaration by statics/hooks.ts#onlyAttacksAlone (core/combat.ts), never on the creature (`verdict` lets it be asked). No `other`, `otherPlayer`,
   * `max`, `min`, `alone`. Capability `feature:restrict.onlyAlone.attack`.
   */
  onlyAlone?: true;
  /**
   * edh-combat-6 INTERFACE CHANGE (additive; CR 509.1b, 101.2, 802.4; Mirri, Weatherlight Duelist): "Each opponent can't block with more than one creature this combat": with a `cant`
   * `block` restriction that has a numeric `max` (a declaration limit), the creatures it names are counted for each player on their own, the ones that player controls: every
   * defending player may declare up to `max` blockers (without it, all defending players' blockers are counted together, "No more than one creature can block each combat").
   * Capability `feature:restrict.perPlayer.block` (statics/hooks.ts#declarationLimits).
   */
  perPlayer?: true;
  /**
   * edh-players-5 INTERFACE CHANGE (additive; CR 702.11b, 702.11c, 101.2): "Players gain hexproof until end of turn" (Everybody Lives!): with a `cant` `beTargeted` restriction
   * that has an `other`, the `other` filter is read relative to the player who is the SUBJECT of the question (its "opponent" is an opponent of that player), not relative to
   * the controller of the restriction's source: every player is protected from spells and abilities their own opponents control. The subject must be a player
   * (statics/hooks.ts#verdict; a permanent asked about is applied, fail closed). Capability `feature:restrict.relativeToSubject.beTargeted`.
   * edh-cast-11 INTERFACE CHANGE (additive; CR 601.3, 101.2; Lavinia, Azorius Renegade): also with a `cant` `cast` restriction: "Each opponent can't cast noncreature spells with
   * mana value greater than the number of lands that player controls": the `other` filter is read with the casting player as `you`. Capability `feature:restrict.relativeToSubject.cast`.
   */
  relativeToSubject?: true;
  /**
   * edh-zones-14 INTERFACE CHANGE (additive; CR 701.23a, 101.2, 109.5): "Spells and abilities your opponents control can't cause their controller to search their library"
   * (Ashiok, Dream Render): with a `cant` `search` restriction whose `other` describes the spell or ability that causes the search, the restriction applies only when the
   * player who would search CONTROLS that spell or ability ("their controller"): the search a spell or ability makes another player do is not forbidden. The search
   * instruction asks with the source of the spell or ability as `other` (effects/handlers/cards-library.ts); asked with none it is applied (fail closed). Capability
   * `feature:restrict.causedByOwn.search`.
   */
  causedByOwn?: true;
  /**
   * edh-next-69 INTERFACE CHANGE (additive), CR 701.21a, 101.2, 109.5 (Sigarda, Host of Herons; Tajuru Preserver): "Spells and abilities your opponents control can't cause you to sacrifice
   * permanents": with a `cant` `sacrifice` restriction (no `other`, `max`, `when`), the subject player can't be made to sacrifice by an effect of a spell or ability that an opponent of the
   * restriction's controller controls. The sacrifice instruction of an effect asks with its source as `RuleQuery.cause` (effects/handlers/zones-remove.ts); a sacrifice paid as a cost
   * asks with none and is not forbidden (it is the player's own choice, CR 118.3). Capability `feature:restrict.causedByOpponents.sacrifice`.
   */
  causedByOpponents?: true;
  /**
   * edh-next-122 INTERFACE CHANGE (additive), CR 701.21a, 406.1, 603.1, 113.3c, 101.2 (The Master, Multiplied: "Triggered abilities you control can't cause you to sacrifice or exile creature tokens you
   * control"): with a `cant` `sacrifice` (the player, `other` the permanent) or `beExiled` (the permanent) restriction, it applies only while a triggered ability the restriction's controller controls
   * is resolving (a delayed one too: myriad's "exile the tokens at end of combat"); a spell, an activated ability, a cost of either, another player's ability or a rule is not that cause
   * (statics/hooks.ts#verdict). Capability `feature:restrict.causedByOwnTriggered.<action>`.
   */
  causedByOwnTriggered?: true;
  /**
   * edh-next-18 INTERFACE CHANGE (additive), CR 118.3, 119.4, 701.21a, 101.2, 614.17b: "Players can't pay life or sacrifice creatures to cast spells or activate abilities" (Angel of
   * Jubilation, Yasharn, Karn's Sylex): the ban applies only to paying that as a COST of casting a spell or activating an ability (rules/cost.ts#partsDenial, rules/cost-pick.ts, the mana
   * solver's Phyrexian life, rules/pay.ts), never to an effect that has a player pay life or sacrifice (Scryfall rulings 2012-05-01 of Angel of Jubilation). Only on `cant` restrictions of
   * `payLife` and `sacrifice`. Capability `feature:restrict.forCosts.<action>`.
   */
  forCosts?: true;
  /**
   * edh-next-18 INTERFACE CHANGE (additive), CR 509.1b, 509.1c, 101.2: "~ can't be blocked unless all creatures defending player controls block it" (Tromokratis): a `cant`
   * `beBlocked` restriction judged on the whole set of blockers of the attacker (statics/hooks.ts#blockSetValid): the set is legal only if every creature the defending player
   * controls is in it. A creature that can't block (tapped ...) therefore leaves the attacker unblockable (Scryfall ruling 2014-02-01). No `other`, `max`, `min`, `alone`.
   * Capability `feature:restrict.unlessAllBlock.beBlocked`.
   */
  unlessAllBlock?: true;
  when?: Condition;
}

export type RuleAction =
  | 'attack' | 'block' | 'beBlocked' | 'beBlockedBy' | 'attackPlayer'
  | 'cast' | 'activate' | 'playLand' | 'draw' | 'gainLife' | 'loseLife' | 'lose' | 'win'
  | 'untap' | 'untapDuringUntapStep' | 'tap' | 'beTapped' | 'transform' | 'search' | 'sacrifice' | 'discard'
  | 'beTargeted' | 'beCountered' | 'beDestroyed' | 'beRegenerated' | 'beSacrificed' | 'beExiled' | 'beAttached' | 'beEnchanted' | 'beEquipped'
  | 'dealDamage' | 'receiveDamage' | 'preventDamage' | 'enter' | 'leave' | 'gainAbility' | 'haveCountersPut' | 'payLife' | 'castFromZone' | 'spendMana'
  /**
   * edh-cast-3 INTERFACE CHANGE (additive): "Each opponent can cast spells only any time they could cast a sorcery" (Teferi, Time Raveler; CR 117.1a, 307.1, 101.2): the
   * subject can't cast a spell at any time it could not cast a sorcery, whatever its type or flash (rules/timing.ts#castTiming asks statics/hooks.ts#castsOnlySorcerySpeed). With
   * `mode: 'cant'`, no `other`, `max` or `when`. Capability `rule:castAtInstantSpeed`.
   */
  | 'castAtInstantSpeed'
  /** FAST5X E25 INTERFACE CHANGE (additive): "can't be turned face up" (CR 708.7, 101.2): the special action and every effect that turns a permanent face up. */
  | 'beTurnedFaceUp'
  /** std-mkm INTERFACE CHANGE (additive): "can't become suspected" (CR 701.60a, 101.2): every effect that would suspect the permanent (effects/handlers/levels.ts). */
  | 'beSuspected'
  /** edh-next-82 INTERFACE CHANGE (additive): "You can't become the monarch this turn" (Jared Carthalion, True Heir; CR 725.1, 101.2): the subject player can't get the monarch designation (core/designations.ts#setMonarch). */
  | 'becomeMonarch'
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
   * edh-c-72 INTERFACE CHANGE (additive): "can't crew Vehicles" (CR 702.122a, 101.2, 614.17b; Revoke Privileges): the creature the subject describes can't be tapped to pay a crew cost
   * (rules/cant.ts#costUseDenial, the `tapPower` part with `as: 'crew'`, rules/cost-pick.ts#costUse); it can still be tapped for anything else. Capability `rule:crew`.
   */
  | 'crew'
  /**
   * std-copy-1 INTERFACE CHANGE (additive): "This spell can't be copied." (CR 707.10, 101.2): a static ability of a spell (zone `stack`, subject `self`); the copy op
   * puts no copy of the spell onto the stack (effects/handlers/tokens-copy.ts#copySpells asks statics/hooks.ts#ruleDenial).
   */
  | 'beCopied'
  /**
   * edh-players-22 INTERFACE CHANGE (additive): "Stun counters can't be removed from permanents your opponents control." (CR 122.1d, 101.2, 614.17; Fear of Sleep Paralysis): no stun
   * counter is removed from a permanent the subject describes, by an effect, a cost or the untap replacement (which then leaves the permanent tapped and the counter on it, Scryfall
   * ruling 2024-09-20). rules/counters.ts#stunRemovalDenial. Capability `rule:haveStunCountersRemoved`.
   */
  | 'haveStunCountersRemoved'
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
  shield?: {
    uses: number | 'all'; amount?: Quantity;
    /**
     * edh-next-122 INTERFACE CHANGE (additive), CR 614.1c, 616.1, 603.2c (Mystic Reflection: "The next time one or more creatures or planeswalkers enter this turn, they enter as copies of the
     * chosen creature"): with `uses: 1` and an entering pattern, the one use is the next time one or more matching objects enter together: the shield applies to every object of the group
     * that enter by the same instruction of a resolution (one step, or a run of plain token creations by one player) or that one move or creation outside a resolution puts onto the battlefield together (effects/entering-together.ts) and ends once they have entered; an object entering alone uses it up. Capability `feature:shield.batch`.
     */
    batch?: true;
  };
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
  /**
   * edh-b-5 INTERFACE CHANGE (additive), CR 615.5, 614.5, 510.2 (Undergrowth Champion ruling 2015-08-25): `oncePerBatch`, the `then` steps happen once for all the
   * damage the effect prevents to one recipient in one simultaneous batch (damage from two blockers is one application: "you'll remove only one +1/+1 counter"); the
   * other applications in the batch still prevent their damage. Capability `body:prevent.oncePerBatch`.
   */
  | { b: 'prevent'; amount: Quantity | 'all'; then?: EffectStep[]; as?: Name; oncePerBatch?: true } // CR 615
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
    /**
     * edh-next-106 INTERFACE CHANGE (additive), CR 614.1c, 614.12a, 603.12 (cites unverified; Mariposa Military Base): "You may have this land enter tapped. If you do, you get two rad
     * counters.": the player it enters under chooses whether it enters tapped; if they do, the `then` steps run once it has entered, with that player as their controller. Nothing
     * else happens when they decline. Capability `body:enters.tappedMay`.
     */
    tappedMay?: { then: EffectStep[] };
    tappedUnlessPay?: CostDef;
    /**
     * edh-d-54 INTERFACE CHANGE (additive), CR 614.1c, 614.12a, 701.20a (Dragon's Disciple): "As ~ enters, you may reveal a Dragon card from your hand. If you do or if you control a
     * Dragon, ~ enters with a +1/+1 counter on it.": when `or` holds the permanent enters with `counters` and nothing is asked; otherwise the player it enters under may pay `cost`
     * (a reveal from the hand) and, if they do, it enters with `counters`. Capability `body:enters.countersIfPay`.
     */
    countersIfPay?: { cost: CostDef; or?: Condition; counters: CounterSpec[] };
    /**
     * edh-next-138 INTERFACE CHANGE (additive), CR 614.12a, 119.4, 107.1b, 607.2d (Phyrexian Processor): "As ~ enters, pay any amount of life.": the player it enters under chooses an amount from 0
     * to their life total (0 only when they can't pay life, CR 119.4, 119.8) and pays it; the amount paid is kept under `link` as a number the object's other abilities read
     * (`{q:'chosenNumber', link}`, "the life paid as ~ entered"). Capability `body:enters.payLifeAny`.
     */
    payLifeAny?: { link: LinkId };
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
    choose?: { what: ChoiceKind; link: LinkId; options?: string[]; exclude?: string[]; min?: number; max?: number; cardKind?: 'land' | 'nonland' /* std-rx28: of a card name, CR 201.3 */; fromRevealed?: true /* edh-c-84: of a card name, among the cards `revealHands` revealed */; /** edh-d-72 INTERFACE CHANGE (additive), CR 614.12a, 608.2d (Callous Oppressor; no rule says which opponent chooses in a multiplayer game: the controller picks, a reading of "an opponent"): `chooser: 'opponent'`, "As ~ enters, an opponent chooses a creature type.": the player it enters under picks the opponent (the only one in a two-player game), and that opponent makes the choice. Capability `feature:choose.chooser`. */ chooser?: 'opponent' }[];
    /**
     * std-rx6 INTERFACE CHANGE (additive): "As ~ enters, look at an opponent's hand, then choose any card name." (Sorcerous Spyglass): before the choices, the
     * player it enters under chooses an opponent and looks at that player's hand (CR 614.12a, 402.3, 701.20e). Capability `body:enters.lookAtHand`.
     */
    lookAtHand?: 'opponent';
    /**
     * edh-c-84 INTERFACE CHANGE (additive), CR 614.12a, 701.20a, 201.3 (Alhammarret, High Arbiter; cites checked against the 2026-09-25 text): "As ~ enters, each opponent reveals their hand. You choose the
     * name of a nonland card revealed this way.": before the choices, every opponent of the player it enters under reveals their hand (every player may see the cards), and a `choose` entry
     * with `fromRevealed` offers only the names of the nonland cards revealed this way (none revealed: no name is chosen, nothing is linked). Capability `body:enters.revealHands`.
     */
    revealHands?: 'eachOpponent';
    /**
     * edh-next-137 INTERFACE CHANGE (additive), CR 614.12, 614.1c, 114.2, 607.2a (Tibalt, Cosmic Impostor): "As ~ enters, you get an emblem with "You may play cards exiled with
     * ~ ..."": as the permanent enters, the player it enters under gets an emblem with these abilities (created right after it enters, before anything else sees it). The emblem's
     * links are the PERMANENT'S (`GameObject.linksFrom`): "cards exiled with ~" in the emblem are the cards that permanent's abilities exile, before and after the emblem is made,
     * and still after the permanent has left (its last known links; ruling 2021-02-05). Capability `body:enters.emblem`.
     */
    emblem?: AbilityDef[];
    copy?: {
      of: ObjectFilter; optional: boolean; except?: CopyExcept[];
      /**
       * edh-next-122 INTERFACE CHANGE (additive), CR 707.2, 608.2h, 614.1c (Mystic Reflection ruling 2021-02-05: "If ... the target creature leaves the battlefield before the next time one
       * or more creatures or planeswalkers enter the battlefield, use the copiable values of the target creature as it last existed on the battlefield"): `of` names one fixed object
       * (`is`); when it is no longer on the battlefield, its last known information is copied. Capability `body:enters.copy.lastKnown`.
       */
      lastKnown?: true;
      /**
       * M6-0, CR 707.9e: exceptions that are additional effects, not copiable values ("it enters with an additional +1/+1 counter if it's a creature"):
       * applied as the object enters, and NOT applied if another copy effect is applied to it later in the same entering (Altered Ego/Clone).
       */
      /**
       * edh-next-114 INTERFACE CHANGE (additive), CR 707.9e, 614.1c (Undercover Operative): `ifCopiedControlled` limits an additional effect to the case where the player the permanent enters under
       * controls the object that was chosen to be copied ("it enters with a shield counter on it if you control that creature"). Capability `body:enters.copy.ifControlled`.
       */
      additional?: { if?: ObjectFilter; ifCopiedControlled?: true; counters: CounterSpec[] }[];
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
      /**
       * edh-next-133 INTERFACE CHANGE (additive), CR 614.1c, 614.12a, 707.5, 707.9e, 122.6 (The Mimeoplasm: "As ~ enters, you may exile two creature cards from graveyards. If you do, it enters
       * as a copy of one of those cards with a number of additional +1/+1 counters on it equal to the power of the other card."): as it enters, the player it enters under may exile exactly two
       * cards matching `of` (from any graveyards; fewer than two there: nothing is asked, rulings 2011-09-22); if they do, they choose which of the two it enters as a copy of, and it enters
       * with additional counters of `counters` equal to the power of the other card in exile (an additional effect, CR 707.9e). Capability `body:enters.copy.exilePair`.
       */
      exilePair?: { counters: CounterKind };
    };
    /**
     * edh-next-120 INTERFACE CHANGE (additive), CR 614.1c, 614.12, 612.5, 701.12h (Deadpool, Trading Card): "As ~ enters, you may exchange his text box and another creature's.": the
     * player it enters under may choose another creature on the battlefield matching `with` (not targeted); if they do, as soon as it is on the battlefield the two permanents' rules
     * texts are exchanged for good: each gets the text the other had (effects/text-exchange.ts, two layer 3 effects with one timestamp). Capability `body:enters.exchangeText`.
     */
    exchangeText?: { with: ObjectFilter };
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
    devour?: { filter: ObjectFilter; times: Quantity; /** edh-c-35: the link the number devoured is kept under (copies rename links, CR 707.9; the keyword says `devoured`) */ link?: LinkId };
    /**
     * edh-c-37 INTERFACE CHANGE (additive): tribute (CR 702.104a-b): "As this creature enters, choose an opponent. That player may put an additional N +1/+1 counters on it
     * as it enters." The player it enters under chooses an opponent (the only one with one opponent), who is asked whether to have it enter with `count` +1/+1 counters; the
     * answer is kept under `link` for the permanent as the value 'paid' or 'unpaid' (`{ cond: 'chosen', link, equals: 'unpaid' }` is "if tribute wasn't paid"). Counters a rule
     * forbids are not put, and then tribute was not paid. Capability `body:enters.tribute`.
     */
    tribute?: { count: Quantity; link: LinkId };
    /**
     * edh-c-42 INTERFACE CHANGE (additive): amplify (CR 702.38a): "As this object enters, you may reveal any number of [filter] cards in your hand. This permanent
     * enters with `times` +1/+1 counters on it for each card revealed this way." As it enters, the player it enters under chooses any number of cards in their hand
     * that match `filter` (read with the entering object as "it": "shares a creature type with it") and reveals them; it enters with `times` +1/+1 counters for each
     * card revealed. Capability `body:enters.revealHand`.
     */
    revealHand?: { filter: ObjectFilter; times: Quantity; kind?: CounterKind };
    /**
     * std-cardcopy-3 INTERFACE CHANGE (additive): "As Mimeoplasm enters, exile up to X creature cards from your graveyard. It enters with three +1/+1 counters on
     * it for each creature card exiled this way." (CR 614.1c, 614.12a, 607.2a): as it enters, the player it enters under chooses up to `max` cards that match
     * `filter` (read for that player: "your graveyard") and exiles them; the cards actually exiled are kept in the new permanent's link store under `link` (the
     * cards "exiled with" it, parser/parse.ts#linkExiled), and it enters with `counters.per` counters of `counters.kind` for each of them. Capability
     * `body:enters.exileCards`.
     */
    exileCards?: { filter: ObjectFilter; max: Quantity; link?: LinkId; counters?: { kind: string; per: Quantity } };
    /**
     * edh-d-73 INTERFACE CHANGE (additive): "As ~ enters, turn all other nontoken creatures face down." (Ixidron; CR 614.12a, 708.2): as it enters, every permanent that
     * matches `filter` (read with the entering object as the source: "other" leaves it out) is turned face down (the `changeFace` step to faceDown, a plain 2/2 face-down creature,
     * CR 708.2a), before it is on the battlefield. Capability `body:enters.turnFaceDown`.
     */
    turnFaceDown?: { filter: ObjectFilter };
    /**
     * edh-next-128 INTERFACE CHANGE (additive): `roll`, "As this creature enters, roll X d6. It enters with a number of +1/+1 counters on it equal to the total of those
     * results." (Neverwinter Hydra; CR 614.12a, 614.1c, 706.1, 706.2, 107.3m): as it enters, the player it enters under rolls `count` dice of `sides` sides (read once, the X of
     * the spell it was, 0 when it was not cast), before it is on the battlefield; `{q:'dieResult'}` in this body's `counters` is the total. Capability `body:enters.roll`.
     */
    roll?: { sides: number; count: Quantity };
    /**
     * edh-d-78 (lane must-finish-5000, handed over by A) INTERFACE CHANGE (additive), CR 614.12a, 122.1, 122.6 (Sin, Unending Cataclysm): "As ~ enters, remove all counters from any number
     * of artifacts, creatures, and enchantments. ~ enters with X +1/+1 counters on it, where X is twice the number of counters removed this way.": the player it enters under chooses any
     * number of the permanents on the battlefield matching `filter` (any controller; the entering object is not on the battlefield yet) and every counter of every kind is removed from
     * each of them; it enters with `times` counters of `kind` for each counter actually removed. Capability `body:enters.removeCounters`.
     */
    removeCounters?: { filter: ObjectFilter; kind: string; times: Quantity };
    /**
     * edh-d-54 INTERFACE CHANGE (additive): "As ~ enters, you may put two cards your opponents own from exile into their owners' graveyards. If you do, ~ enters with four
     * +1/+1 counters on it." (Ulamog's Despoiler; CR 614.1c, 614.12a, 400.3): as it enters, the player it enters under may put exactly `count` cards that match `filter` (read
     * for that player: "your opponents own", zone exile) from exile into their owners' graveyards, all or none; if they do, it enters with `counters.count` counters of
     * `counters.kind`. Fewer matching cards than `count`: nothing is put and it enters without the counters. Capability `body:enters.putToGraveyard`.
     */
    putToGraveyard?: { filter: ObjectFilter; count: number; counters: { kind: string; count: number } };
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
    /**
     * edh-perms-21 INTERFACE CHANGE (additive), CR 614.1c, 205.1b, 613.1d, 613.4b; Displaced Dinosaurs: "As a historic permanent you control enters, it becomes a 7/7 Dinosaur
     * creature in addition to its other types.": the entering permanent is these types and subtypes in addition to its other types (a layer 4 effect on the new object), with
     * this base power and toughness (layer 7b), from the moment it enters (effects/perform-events.ts#applyEnterFacts). Capability `body:enters.becomes`.
     */
    becomes?: { types?: string[]; subtypes?: string[]; power?: number; toughness?: number };
    /**
     * edh-next-146 INTERFACE CHANGE (additive), CR 614.1c, 614.12a, 613.2a, 707.2 (Corrupted Shapeshifter: "As this creature enters, it becomes your choice of a 3/3 creature with flying,
     * a 2/5 creature with vigilance, or a 0/12 creature with defender."): the player it enters under chooses one option; the permanent is then that creature from the moment it enters:
     * base power and toughness, card types `types` ("a 3/3 creature": its card types become those; `typesAdded`: "... in addition to its other types") and the abilities `add`. Because
     * the ability sets power and toughness, these are copiable values (CR 613.2a): one `asEntry` record, applied in layer 1a (effects/perform-events.ts#applyEnterFacts, statics/copy.ts),
     * which a copy of it copies (rulings 2024-06-07). Capability `body:enters.becomesOneOf`.
     */
    becomesOneOf?: { power: number; toughness: number; types: string[]; typesAdded?: true; subtypes?: string[]; add?: AbilityDef[] }[];
    /**
     * edh-next-146 INTERFACE CHANGE (additive), CR 614.12a, 607.2d, 400.7 (Dauntless Bodyguard: "As this creature enters, choose another creature you control."): the player it enters under
     * chooses one permanent the filter matches that is on the battlefield as it enters (one entering at the same time is not there yet: ruling 2018-04-27); the permanent remembers it under
     * `link` (the face's "the chosen creature", parser/parse.ts#linkChosenObject), the object as it is: once it leaves the battlefield it is a new object nothing names (CR 400.7). No such
     * permanent: nothing is chosen. Not a triggered ability: no one can respond. Capability `body:enters.chooseObject`.
     */
    chooseObject?: { filter: ObjectFilter; link?: LinkId };
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
     * edh-b-14 INTERFACE CHANGE (additive), CR 302.6, 508.1a, 609.4 (Frenzied Saddlebrute): "All creatures can attack your opponents and planeswalkers your opponents control as though those creatures
     * had haste": the objects `of` matches (their controllers `who`) are not held back by summoning sickness when they attack; with `opponentsOnly`, only when what they attack is a player
     * who is an opponent of the permission's controller or a planeswalker such an opponent controls (never a battle). Read by rules/combat-rules.ts via hookpoints.attacksAsThoughHaste;
     * activating abilities is a different permission (`activate`). Capability `permit:attackAsThoughHaste`.
     */
    | 'attackAsThoughHaste'
    // edh-next-12 INTERFACE CHANGE (additive), CR 402.3, 604.1 (Telepathy): "Your opponents play with their hands revealed." (`revealHand`, `who` the players whose hands): the cards in
    // those players' hands are revealed to every player while it functions (core/view.ts#canSee via statics/play-permits.ts#handRevealed). No optional field. Capability `permit:revealHand`
    | 'revealHand'
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
     * edh-mana-keywords-8 INTERFACE CHANGE (additive), CR 702.6a, 602.5d, 117.1a: "During your turn, you may activate equip abilities any time you could cast an instant" (Forge
     * Anew): the equip abilities `who` activates lose their "activate only as a sorcery" timing (the static ability's own condition keeps it to the turn). Read by
     * rules/timing.ts via hookpoints.equipAsInstant (statics/hooks.ts); capability `permit:activateEquipAsInstant`.
     */
    | 'activateEquipAsInstant'
    /**
     * std-freecast-5 INTERFACE CHANGE (additive): plot from the top of your library (CR 702.170a, 702.170f, 116.2k), with `fromTop` only: "You may plot nonland cards
     * from the top of your library" (`of`: the cards that may be plotted from there) and "The top card of your library has plot. The plot cost is equal to its mana
     * cost." (`plotCost: 'manaCost'`). Read by core/special/plot.ts via statics/play-permits.ts#topPlotUses; capability `permit:plot.top`.
     */
    | 'plot';
  of?: ObjectFilter;
  /**
   * edh-combat-6 INTERFACE CHANGE (additive; CR 609.4, 702.3b, 508.1b, 500.1; Weathered Sentinels): with `attackAsThoughNoDefender` only, "~ can attack players who attacked you during their last
   * turn as though it didn't have defender": the permission applies only to attacking a PLAYER (never a planeswalker or a battle) who, on the most recent turn they were the active player
   * before this one, was declared as the defending player of at least one attack on the permission's controller (a player attacked, never the controller of an attacked planeswalker, CR 506.3).
   * Read from the game history (`beginTurn` and `attacks` entries, rules/history.ts#playerAttackedPlayerLastTurn). Capability `feature:permit.attackAsThoughNoDefender.attackedYouLastTurn`.
   */
  attackedYouLastTurn?: true;
  /** edh-b-14 (CR 609.4): with `attackAsThoughHaste` only, the permission applies to attacks on opponents of its controller and the planeswalkers they control. Capability `feature:permit.attackAsThoughHaste.opponentsOnly`. */
  opponentsOnly?: true;
  /**
   * edh-d-25 INTERFACE CHANGE (additive; CR 510.1b-c, 609.4; Outmaneuver): with `assignAsUnblocked` only, "X target blocked creatures assign their combat damage this turn as though they
   * weren't blocked": the assignment is not optional, so no question is asked and a blocked attacker the permission covers assigns all its combat damage to what it attacks (it stays blocked,
   * CR 509.1h, 509.3g). Without it the controller chooses ("you may have"). core/combat-damage.ts via statics/hooks.ts#mustAssignAsUnblocked. Capability `feature:permit.assignAsUnblocked.mandatory`.
   */
  mandatory?: true;
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
  /**
   * edh-next-140 INTERFACE CHANGE (additive), CR 609.4b (Quicksilver Elemental): with `spendMana`, `asThough` 'any color' and `abilities`: only mana of this type may be spent as though it
   * were mana of any color ("You may spend blue mana as though it were mana of any color to pay the activation costs of this creature's abilities"): rules/sources.ts
   * `SpendContext.anyColorWith`, set by actions/activate.ts via statics/play-permits.ts#staticAnyColorWithForAbility. Capability `permit:spendMana.anyColorWithAbilities`.
   */
  spentType?: 'W' | 'U' | 'B' | 'R' | 'G';
  /**
   * edhc5 INTERFACE CHANGE (additive), CR 118.1, 119.4, 107.4f: with `spendMana` and no `asThough`: "For each {B} in a cost, you may pay 2 life rather than pay that mana"
   * (K'rrik, Son of Yawgmoth): each symbol of the cost that asks for mana of `color` ({B}, {B/R}, the {B} of {2/B}) may be paid with 2 life instead. With `of` it is for
   * the spells that filter describes, and with `once` for one symbol of a spell: "As an additional cost to cast green permanent spells, you may pay 2 life. Those spells
   * cost {G} less to cast if you paid life this way." (Defiler of Vigor; rulings of 2022-09-09: once per permanent spell; the same payment as a reduction). Read by the
   * payment (rules/solver.ts `SolveInput.lifeFor`, statics/play-permits.ts#staticLifeFor); a static ability of an object only. Capability `permit:spendMana.lifeFor`.
   */
  lifeFor?: { color: Color; once?: true };
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
   * edh-next-127 INTERFACE CHANGE (additive), CR 603.7a, 603.7c, 601.2i (The Ruinous Powers: "Until end of turn, you may play that card ... When you cast a spell this way, its owner loses life equal
   * to its mana value."): a delayed triggered ability the resolved permission carries: each time `who` casts a spell using THIS permission, these steps trigger (controlled by the permission's
   * controller, its source the permission's source), put on the stack the next time a player would receive priority (above the spell); the event is that cast (`{ref:'event', role:'spell'}` is the
   * spell, read as it is or last existed on the stack, ruling 2022-10-07). A land played this way is not cast and triggers nothing. Honored on permissions for named objects only
   * (statics/play-permits.ts#onCastPermits, actions/cast.ts); capability `feature:permit.<action>.onCast`.
   */
  onCast?: EffectStep[];
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
   * edh-next-143 INTERFACE CHANGE (additive), CR 401.5, 601.3, 305.1, 609.4b (Xanathar, Guild Kingpin: "you may look at the top card of their library any time, you may play the top
   * card of their library, and you may spend mana as though it were mana of any color to cast spells this way"): the permission is for the top card of the library of each player
   * of this group, not of the `who` player's own. With `lookAt` and no other optional field: the `who` players may look at that card any time (core/view.ts#canSee); with `play`
   * or `cast` and `fromTop`: they may play or cast it (actions/land.ts, actions/cast.ts), and with `anyManaColor` spend mana as though it were mana of any color to cast it. No
   * other optional field (statics/play-permits.ts#isTopOtherPermit, fail closed). Capabilities `permit:lookAt.ofLibrary`, `permit:<action>.top.ofLibrary`.
   */
  ofLibrary?: PlayerRef;
  /**
   * edh-next-143 INTERFACE CHANGE (additive), CR 601.3, 305.1, 108.3 (Sen Triplets: "You may play lands and cast spells from that player's hand this turn."): with `play` (lands and
   * spells) or `cast` and no other optional field, the `who` players may play or cast the cards in the hands of the players of this group, other than their own (the cards stay their
   * owner's, CR 108.3; a card the player can't see is never offered, CR 400.2). Read by statics/play-permits.ts#handOfCandidates. Capability `permit:<action>.handOf`.
   */
  fromHandOf?: PlayerRef;
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
   * edh-next-50 INTERFACE CHANGE (additive), CR 601.2f, 118.8, 404.1 (Risen Executioner: "You may cast this creature from your graveyard if you pay {1} more to cast it for each other creature card in your graveyard"): an additional cost of
   * that many generic mana ({1} more for each ...), read as the permission is used (statics/play-permits.ts#permitUsesOf: a quantity that cannot be read offers no cast). Honored on the graveyard
   * cast permissions of that module only, never beside `addCost`. Capability `feature:permit.cast.addGeneric`.
   */
  addGeneric?: Quantity;
  /**
   * C10 INTERFACE CHANGE (additive): "If you cast a spell this way, that artifact enters with a finality counter on it" (CR 614.1c, 122.1h): the permanent
   * a spell cast with this permission becomes enters with these counters. Recorded on the spell as it is cast (`StackInfo.permitEnters`), so it applies
   * even if the permission's source is gone by then; a copy of the spell was not cast this way (CR 707.10). Honored on the graveyard cast permissions
   * of statics/play-permits.ts (`feature:permit.cast.entersWith`).
   */
  entersWith?: CounterSpec[];
  /**
   * edh-next-68 INTERFACE CHANGE (additive), CR 614.1c, 601.3 (Edgar, Master Machinist: "Once during each of your turns, you may cast an artifact spell from your graveyard. If you cast a spell this way, that
   * artifact enters tapped."): the permanent a spell cast with this permission becomes enters tapped. Recorded on the spell as it is cast (`StackInfo.permitEnters.tapped`), so it applies even if the
   * permission's source is gone by then; a copy of the spell was not cast this way (CR 707.10). Honored on the graveyard cast permissions of statics/play-permits.ts (`feature:permit.cast.entersTapped`).
   */
  entersTapped?: true;
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
   * edh-d-97 INTERFACE CHANGE (additive), CR 609.4b, 107.4c (Abstruse Appropriation): "..., and you may spend colorless mana as though it were mana of any color to cast that spell": a spell
   * cast with this permission may pay a colored symbol with colorless mana (rules/sources.ts `SpendContext.anyType` 'colorless'). Honored on the permissions for named objects, as
   * `anyManaColor` is (statics/play-permits.ts#colorlessAnyColorPermit; capability `feature:permit.cast.colorlessAnyColor`); a wider rider (`anyManaType`, `anyManaColor`) wins.
   */
  colorlessAnyColor?: true;
  /**
   * edh-d-66 INTERFACE CHANGE (additive), CR 607.2a, 601.3, 108.3, 609.4b (Ian Malcolm, Chaotician: "During each player's turn, that player may cast a spell from among the cards they don't own
   * exiled with ~, and mana of any type can be spent to cast it."): with a static linked cast permission (statics/play-permits.ts#isLinkedRiderPermit) whose `who` is `{ref:'active'}`, the
   * permission covers only the linked cards the player who casts does not own (their owner is another player, CR 108.3). Judged where the card is, in exile. Capability
   * `feature:permit.cast.linked.notOwn`; `who` active on that form is `feature:permit.cast.linked.activePlayer`.
   */
  notOwn?: true;
  /**
   * edh-d-100 INTERFACE CHANGE (additive), CR 603.2, 603.3, 607.2a, 305.1, 601.2a (Share the Spoils: "During each player's turn, that player may play a land or cast a spell from among cards
   * exiled with this enchantment, and they may spend mana as though it were mana of any color to cast that spell. When they do, exile the top card of their library."): a triggered ability
   * of the permission's source, controlled by the source's controller, that triggers each time a player plays a land or casts a spell WITH this permission; the event's player
   * (`{ref:'event', role:'player'}`) is that player. It goes on the stack the next time a player would receive priority (CR 603.3), above the spell. A `link` its steps write is the
   * source's (CR 607.2a: the cards it exiles are "exiled with ~" too). Honored on the static linked permission of the active player only (statics/play-permits.ts#isLinkedRiderPermit,
   * actions/cast.ts, actions/land.ts); capability `feature:permit.play.linked.onUse`.
   */
  onUse?: { steps: EffectStep[] };
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
   * edh-zones-27 INTERFACE CHANGE (additive), CR 601.3, 404.1, 400.3: "Until end of turn, you may cast instant and sorcery spells from any graveyard" (The Great Work): with `from: 'graveyard'` and
   * action 'cast' (a resolved effect), the permission covers the cards in EVERY player's graveyard, not only the ones `who` owns. The spell is cast as usual (CR 601.2); a card goes to its
   * owner's zone afterwards (CR 400.3). Honored on the graveyard cast permissions of statics/play-permits.ts (graveyardCandidates, graveyardPermitUses); capability
   * `feature:permit.cast.zone.anyGraveyard`.
   */
  anyGraveyard?: true;
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
   * edh-d-96 INTERFACE CHANGE (additive), CR 601.3, 305.1, 611.2a (March of Reckless Joy: "You may play up to two of those cards until the end of your next turn."; ruling 2022-02-18: the cards
   * are chosen as they are played): as `single`, but the permission lets the player play or cast up to this many (2 or more) of the objects it names over its whole duration (the same
   * counter, `single:<the effect's order>`, which outlasts the turn: core/turn.ts). Never with `single`. Honored on the permissions for named objects of statics/play-permits.ts
   * (capability `feature:permit.<action>.uses`).
   */
  uses?: number;
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
   * edh-zones-22 INTERFACE CHANGE (additive), CR 305.1, 601.3, 614.1c, 400.7 (Serra Paragon: "Once during each of your turns, you may play a land from your graveyard or cast a
   * permanent spell with mana value 3 or less from your graveyard. If you do, it gains \"When this permanent is put into a graveyard from the battlefield, exile it and you gain 2
   * life.\""): the abilities the land played, or the permanent a spell cast, with this permission has from the moment it enters, for as long as it is that object (a layer 6
   * effect on the new object: effects/perform-events.ts#applyEnterFacts, the facts of an `enters` replacement's `withAbilities`). Recorded on the spell as it is cast
   * (`StackInfo.permitEnters.abilities`), so it applies even if the permission's source is gone by then; a copy of the spell was not cast this way (CR 707.10). Honored on the one
   * form statics/play-permits.ts#isPermanentPlayPermit honors, for the land play and the cast alike (capability `feature:permit.play.zone.entersAbilities`).
   */
  entersAbilities?: AbilityDef[];
  /**
   * std-rx27 INTERFACE CHANGE (additive), CR 614.1c, 601.3e: "If you cast a creature spell this way, that creature enters with an additional +1/+1 counter on it"
   * on a top-card cast permission (Mikey & Don, Party Planners): `entersWith` applies only to a spell this filter describes, judged on the spell as it is cast
   * (CR 601.3e). Honored with `entersWith` on the top-card cast permissions of statics/play-permits.ts (`feature:permit.cast.top.entersWith`).
   */
  entersWithIf?: ObjectFilter;
  /**
   * edh-cast-12 INTERFACE CHANGE (additive), CR 611.2c, 601.2i, 400.7a, 702.10a (Thundermane Dragon): "If you cast a creature spell this way, it gains haste until end of turn" on a
   * top-card cast permission: every spell cast with the permission (its `of` says which) gains this keyword from the moment it is cast, until end of turn, a layer 6 effect on the
   * spell that the permanent it becomes keeps (the same effect as mana-spent riders, core/mana-riders.ts). A copy of the spell was not cast this way (CR 707.10). Honored on the
   * top-card cast permissions of statics/play-permits.ts (capability `feature:permit.cast.top.gainsThisTurn`).
   */
  gainsThisTurn?: KeywordAbilityDef;
  /**
   * edh-d-91 INTERFACE CHANGE (additive), CR 601.2a, 601.2f, 613.1f, 702.41a (Chiss-Goria, Forge Tyrant): "You may cast an artifact spell from among them this turn. If you do, it has affinity for
   * artifacts.": on a cast permission for named objects (`of.is`), the spell cast with it has this keyword from the moment it is put on the stack, so its cost is determined with it (affinity
   * only: statics/play-permits.ts#namedPermitSpellKeyword, statics/costmods.ts#costModsFor, actions/cast.ts). A spell cast another way does not have it. Capability `feature:permit.cast.spellKeyword`.
   */
  spellKeyword?: KeywordAbilityDef;
  /**
   * edh-perms-4 INTERFACE CHANGE (additive), CR 601.3b, 702.8a, 603.7, 701.21a: "You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, the
   * controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step." (Necromancy): with `haveFlash` and `of: {self: true}` only (the card's own static ability, which
   * functions in its owner's hand). A spell cast at a time a sorcery could not have been cast, when this permission is the only thing that let it be cast then (no other effect gives it flash), is
   * recorded as it is cast (`StackInfo.offTimingSacrifice`, actions/cast.ts); as it resolves, a delayed triggered ability makes the controller of the permanent it became sacrifice it at the beginning
   * of the next cleanup step (core/resolve.ts#offTimingSacrifice). A copy of the spell was not cast (CR 707.10). Capability `feature:permit.haveFlash.offTimingSacrifice`.
   */
  offTimingSacrifice?: true;
  /**
   * edht4 INTERFACE CHANGE (additive), CR 601.3b, 601.2c, 702.8a (Timely Ward: "You may cast this spell as though it had flash if it targets a commander"): with `haveFlash` and
   * `of: {self: true}` only (the card's own static ability, `zone: ['hand']`): the spell may be cast as though it had flash, but only if at least one object it targets matches this
   * filter. The player may begin to cast it when some object on the battlefield matches (CR 601.3b); the targets chosen (CR 601.2c) must include one that does, or the cast is illegal
   * (actions/cast.ts). Not flash by itself (statics/hooks.ts#castsAsInstant skips it; castFlashIfTargets reads it). Capability `feature:permit.haveFlash.ifTargets`.
   */
  ifTargets?: ObjectFilter;
  /**
   * edh-d-44 INTERFACE CHANGE (additive), CR 601.3b, 601.2b, 107.3a, 702.8a (Silver Scrutiny: "You may cast this spell as though it had flash if X is 3 or less"): with `haveFlash` and
   * `of: {self: true}` only (the card's own static ability, `zone: ['hand']`): the spell may be cast as though it had flash only with a value of X at most this number. The player may begin
   * to cast it (CR 601.3b); X is announced as the spell is cast (CR 601.2b), and only values up to the limit are offered when the permission is what lets it be cast now. Not flash by itself
   * (statics/hooks.ts#castsAsInstant skips it; castFlashXLimit reads it). Capability `feature:permit.haveFlash.ifXAtMost`.
   */
  ifXAtMost?: number;
  /**
   * edh-d-44 INTERFACE CHANGE (additive), CR 601.3b, 601.2i, 702.8a (The Blue Spirit: "You may cast the first creature spell you cast each turn as though it had flash"): with `haveFlash` and `of`
   * (a kind of spell) only: the permission applies to a spell of that kind only while `who` has cast no spell of that kind yet this turn (the turn's history, a cast copy counts, CR 707.12;
   * a kind the history can't answer: no permission). Capability `feature:permit.haveFlash.firstOfKind`.
   */
  firstOfKind?: true;
  /**
   * edh-d-44 INTERFACE CHANGE (additive), CR 601.3b, 601.3, 702.8a, 401.5 (Elsha of the Infinite: "You may cast noncreature spells from the top of your library. If you cast a spell this way, you may cast
   * it as though it had flash"): with `cast` and `fromTop` only: a spell cast from the top of the library with this permission may be cast at any time the player could cast an instant. Read by
   * statics/play-permits.ts#topPermitFor (TopUse.flash) and actions/cast.ts (the timing check). Capability `feature:permit.cast.top.flash`.
   */
  flashThisWay?: true;
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
  // edh-d-102 (additive), CR 607.2a, 121.1 (Uba Mask): also on a static linked play permission of each player, "cards they exiled with ~ this turn" (statics/play-permits.ts#isLinkedOwnOnlyPermit), the linked cards the player owns
  ownOnly?: true;
  /**
   * edh-zones-11 INTERFACE CHANGE (additive), CR 601.3, 406.3a, 205.2: "For as long as it remains exiled, you may cast it if it's a creature spell." (Vivien, Champion of the
   * Wilds): the cast permission for the named objects covers only a spell of one of these card types, judged on the card as it would be cast (its printed face: a card exiled
   * face down has no characteristics in exile, but the player looks at it). Honored on the CAST permissions for named objects of statics/play-permits.ts (namedObjects for
   * the card, namedPermitTypesAllow for the face being cast, actions/cast.ts); capability `feature:permit.cast.onlyTypes`.
   */
  onlyTypes?: string[];
  /**
   * edh-next-100 INTERFACE CHANGE (additive), CR 601.3, 105.2, 105.4: "You may cast red spells from among them this turn." (Chandra, Dressed to Kill): the cast permission for the
   * named objects covers only a spell that has at least one of these colors, judged on the card as it would be cast (as `onlyTypes`: statics/play-permits.ts namedObjects,
   * namedPermitTypesAllow, actions/cast.ts); capability `feature:permit.cast.onlyColors`.
   */
  onlyColors?: string[];
  /**
   * edh-d-56 INTERFACE CHANGE (additive), CR 601.3, 205.2, 305.1 (Narset, Enlightened Master): "Until end of turn, you may cast noncreature spells from among those cards without paying their mana
   * costs.": the cast permission for the named objects covers only a spell none of whose card types is one of these (judged on the face as it would be cast; a land card is no spell and is never
   * cast). Honored beside `onlyTypes` (statics/play-permits.ts#namedObjects, namedPermitTypesAllow, grantedAlternatives); capability `feature:permit.cast.exceptTypes`.
   */
  exceptTypes?: string[];
  /**
   * edh-d-58 INTERFACE CHANGE (additive), CR 118.9, 601.2b, 205.3: "You may play that card this turn. You may cast Equipment spells this way without paying their mana costs." (Nahiri,
   * Forged in Fury): a spell of one of these subtypes cast with this permission for named objects may be cast for the alternative cost of nothing (the player may still pay its mana
   * cost, CR 118.9a). Judged on the face being cast. Honored on the permissions for named objects of statics/play-permits.ts#grantedAlternatives (capability
   * `feature:permit.play.freeSubtypes`, `feature:permit.cast.freeSubtypes`).
   */
  freeSubtypes?: string[];
  /**
   * edh-d-58 INTERFACE CHANGE (additive), CR 601.2f, 109.5 (Soul Partition: "A spell cast by an opponent this way costs {2} more to cast"): with a `costChange` increase on a permission for named
   * objects, the increase applies only to a spell cast by an opponent of the controller of the effect that made the permission (the owner who gets the card back casts it for its mana cost
   * when that owner is the effect's controller). Honored by statics/play-permits.ts#namedUses (capability `feature:permit.<action>.increaseIfOpponent`).
   */
  increaseIfOpponent?: true;
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
    // edh-combat-6 INTERFACE CHANGE (additive), CR 510.1, 510.1a: "This creature assigns no combat damage this combat." (`assignsNoCombatDamage`, `of` the creatures it concerns, the source without it):
    // the creatures `of` matches assign no combat damage as combat damage is assigned (core/combat-damage.ts via statics/hooks.ts#assignsNoCombatDamage). Not prevention (the
    // Master of Cruelties ruling 2013-04-15): damage that can't be prevented is still not assigned. Capability `rulemod:assignsNoCombatDamage`.
    | 'assignsNoCombatDamage'
    // edh-next-146 INTERFACE CHANGE (additive), CR 701.3a, 607.2d, 613.7e (Psychic Paper: "As this Equipment becomes attached to a creature, choose a creature card name and a creature type."):
    // `chooseAsAttached`, each time the source (an Aura, Equipment or Fortification) becomes attached to an object `of` matches, its controller makes the choices `asAttached` lists, as
    // part of that event (no stack, nobody can respond; rules/status.ts#attachPermanent), and the source's links keep the last values chosen. Capability `rulemod:chooseAsAttached`.
    | 'chooseAsAttached'
    // FAST5X E3 INTERFACE CHANGE (additive), CR 702.122a, 702.171a: "~ saddles Mounts and crews Vehicles as though its power were N greater" (`value` N) and
    // "... using its toughness rather than its power": what the source counts for the total of a crew or saddle cost (statics/hooks.ts#crewSaddleValue)
    | 'crewSaddlePowerBonus' | 'crewSaddleUsesToughness'
    // edh-perms-15 INTERFACE CHANGE (additive), CR 702.122a: "~ crews Vehicles as though its power were N greater" (`value` N): the same for crew costs only, never for a saddle cost (statics/hooks.ts#crewSaddleValue)
    | 'crewPowerBonus'
    // edh-next-15 INTERFACE CHANGE (additive), CR 702.122a: "~ crews Vehicles using its toughness rather than its power" (Giant Ox): the same as `crewSaddleUsesToughness` for crew costs only, never for a saddle cost (statics/hooks.ts#crewSaddleValue)
    | 'crewUsesToughness'
    // trek-18 INTERFACE CHANGE (additive), CR 702.122a, 702.184a, 701.11: "~ stations Spacecraft and crews Vehicles as though its power were tripled" (Sulu, Heroic Helmsman): the source
    // counts three times its power for a crew cost (statics/hooks.ts#crewSaddleValue) and for a station cost (effects/eval.ts, `stat` with `station`, via statics/hooks.ts#stationPowerFactor); source itself only
    | 'crewStationPowerTripled'
    // FAST5X E19 INTERFACE CHANGE (additive), CR 106.4, 500.5, 614.1: "If you would lose unspent mana, that mana becomes red instead" (`manaType` the type it
    // becomes): a replacement of the emptying of the player's mana pool as a step or phase ends; the mana stays, of that type (core/steps.ts#endOfStepCleanup)
    | 'unspentManaBecomes'
    // edh-next-141 INTERFACE CHANGE (additive), CR 106.4, 500.5, 119.3 (Yurlok of Scorch Thrash; rulings 2020-11-10): "A player losing unspent mana causes that player to lose that much life." (`manaBurn`,
    // `player` the players it applies to): as a step or phase ends, or when an instruction makes them lose all unspent mana, each such player loses 1 life for each unit of mana that is lost
    // (none for mana kept or that becomes another type instead), at the same time, without the stack (core/steps.ts). Several such rules make no more life lost. Capability `rulemod:manaBurn`.
    | 'manaBurn'
    // edh-next-124 INTERFACE CHANGE (additive), CR 504.1, 504.2, 114.4 (Teferi, Who Slows the Sunset's emblem; ruling 2021-09-24): "You draw a card during each opponent's draw step."
    // (`drawDuringOpponentsDrawSteps`, `player` default you): after the active player's draw of the draw step, the source's controller draws a card (each such source one card) when the
    // active player is an opponent of theirs, as part of the turn-based action, no player getting priority in between (core/steps.ts, statics/hooks.ts#drawsDuringDrawStep). Not a triggered
    // ability: it uses no stack. Capability `rulemod:drawDuringOpponentsDrawSteps`.
    | 'drawDuringOpponentsDrawSteps'
    // edh-next-145 INTERFACE CHANGE (additive), CR 120.6, 704.5g, 702.19b, 120.10 (Zilortha, Strength Incarnate; rulings 2020-04-17): "Lethal damage dealt to creatures you control is determined
    // by their power rather than their toughness." (`lethalDamageUsesPower`, `of` the creatures it concerns): wherever the game checks whether damage is lethal, it is checked against the
    // creature's power: the state-based action (core/sba-objects.ts; a creature with 0 or less power is destroyed only with 1 or more damage marked), the lethal damage a trampler or a
    // creature dividing its combat damage must assign (core/combat-damage.ts), and excess damage (rules/damage.ts). A toughness of 0 or less still puts it into the graveyard (CR 704.5f).
    // Read through statics/hooks.ts#lethalDamageUsesPower. Capability `rulemod:lethalDamageUsesPower`.
    | 'lethalDamageUsesPower'
    // edh-next-144 INTERFACE CHANGE (additive), CR 701.20a, 121.2, 603.2, 607.2 (Keranos, God of Storms; Primitive Etchings, Rowen): `revealFirstDraw`, "Reveal the first card you draw each turn"
    // (with `onYourTurns`: "... on each of your turns"): as the source's controller draws the first card they draw in a turn (their own turns only with `onYourTurns`), that card is revealed
    // to every player (no choice, no stack); each such reveal is an event `{ev:'reveal', thisWay: true}` of THAT source, which its linked "Whenever you reveal a <kind> card this way"
    // triggers (CR 607.2) read (triggers/reveal-draw.ts, via statics/hooks.ts#revealFirstDrawSources). Capability `rulemod:revealFirstDraw`.
    | 'revealFirstDraw'
    // M12-3 INTERFACE CHANGE (additive), CR 701.38d: "While voting, you get an additional vote." (`additionalVote`) and "While voting, you may vote an additional
    // time." (`mayVoteAdditional`): `player` (default you) has one more vote, which happens at the same time as their other votes (effects/handlers/actions-native.ts)
    | 'additionalVote' | 'mayVoteAdditional'
    // edh-next-135 INTERFACE CHANGE (additive), CR 701.38a, 608.2d (Illusion of Choice: "You choose how each player votes this turn."; rulings 2016-08-23): while the effect lasts, the
    // controller of the effect makes every vote's decisions for each voter; with several, the one with the latest timestamp (the one that resolved most recently). A voter who may vote an
    // additional time still decides whether they do, after their normal vote; the controller chooses those votes too (effects/handlers/actions-native.ts#vote via statics/hooks.ts#voteChooser).
    // Capability `rulemod:choosesVotes`.
    | 'choosesVotes'
    // edh-next-135 INTERFACE CHANGE (additive), CR 701.55c (The Valeyard: "If an opponent would face a villainous choice, they face that choice an additional time."): a player `player`
    // matches (default you; "an opponent": the source controller's opponents) who would face a villainous choice faces it once more for each such effect, the whole choice and its option
    // one time after the other (effects/handlers/control.ts#mayHandler via statics/hooks.ts#villainousChoiceTimes). Capability `rulemod:villainousChoiceExtra`.
    | 'villainousChoiceExtra'
    // edh-d-97 INTERFACE CHANGE (additive), CR 702.85b (Averna, the Chaos Bloom): "As you cascade, you may put a land card from among the exiled cards onto the battlefield tapped." (`cascadeLandTapped`):
    // after a cascade of the source's controller has finished exiling cards and before they choose whether to cast the last one, they may put one land card from among the cards
    // that cascade exiled onto the battlefield tapped (each such source one card; effects/handlers/actions-native.ts#cascade via statics/hooks.ts#cascadeLandPuts). "You" only.
    // Capability `rulemod:cascadeLandTapped`.
    | 'cascadeLandTapped'
    // edh-d-96 INTERFACE CHANGE (additive), CR 701.25a, 609.3 (Enhanced Surveillance): "You may look at an additional two cards each time you surveil." (`surveilLookAdditional`, `value` the
    // number of cards, a fixed number): each time the source's controller surveils, they may look at that many more cards (the rulings of 2018-10-05: the additional cards are part of what
    // is surveiled, and each such permanent adds its own number); asked as the surveil begins (effects/handlers/cards-library.ts via statics/hooks.ts#surveilExtraLooks).
    // Capability `rulemod:surveilLookAdditional`.
    | 'surveilLookAdditional'
    // r3-static INTERFACE CHANGE (additive), CR 704.5j: "The "legend rule" doesn't apply to permanents you control" (`of` the permanents it doesn't apply to;
    // without `of`, every permanent: "The "legend rule" doesn't apply."): a permanent `of` matches is not counted by the legend rule (core/sba-objects.ts via
    // statics/hooks.ts#legendRuleExempt), judged on the permanents as they are when the rule is checked (a rule effect, not a characteristic: CR 611.2c
    // locks no set for it). As a resolved effect: "... this turn" (Hall of Echoes).
    | 'legendRuleExempt'
    // r3-static INTERFACE CHANGE (additive), CR 704.5a, 104.3b: "You don't lose the game for having 0 or less life" (`player`, default you): the state-based
    // action of CR 704.5a doesn't apply to that player (core/sba.ts via statics/hooks.ts#losesForZeroLife); the other losses (704.5b-c, 704.6c) still do
    | 'noLossForZeroLife'
    // edh-next-49 INTERFACE CHANGE (additive), CR 120.3b, 120.3, 122.1b: "As long as you have 0 or less life, all damage is dealt to you as though its source had infect." (`damageAsInfect`,
    // Phyrexian Unlife; `player` the player damaged, default you): damage dealt to that player results in that many poison counters (the controller of the source gives them, CR 122.6) instead of a
    // loss of life, as if its source had infect; the source's other abilities are unchanged (damage to a creature is not affected). Read by rules/damage.ts#dealDamage via
    // statics/hooks.ts#damageAsInfect. Capability `rulemod:damageAsInfect`
    | 'damageAsInfect'
    // edh-d-44 INTERFACE CHANGE (additive), CR 702.80a, 120.3d, 122.6 (Everlasting Torment: "All damage is dealt as though its source had wither."): damage dealt to a creature, by any source, is dealt
    // as damage from a source with wither (-1/-1 counters, put by the controller of the source), while it applies. No field. Read by rules/damage.ts#dealDamage via statics/hooks.ts#damageAsWither.
    // Capability `rulemod:damageAsWither`
    | 'damageAsWither'
    // edh-next-140 INTERFACE CHANGE (additive), CR 700.5, 700.5a (Altar of the Pantheon: "Your devotion to each color and each combination of colors is increased by one."): `devotionBonus`, the
    // devotion of `player` (default you) to every color and every combination of colors is `value` (a number, default 1) greater, whatever the permanents they control are (its ruling 2020-01-24: also
    // to a color among none of them). Read wherever a devotion is counted (effects/eval.ts, actions/announce-cond.ts, statics/match.ts) via statics/hooks.ts#devotionBonus and #devotionBonusOf.
    // Capability `rulemod:devotionBonus`
    | 'devotionBonus'
    // edh-next-119 INTERFACE CHANGE (additive), CR 723.2, 723.5, 701.23a (Opposition Agent: "You control your opponents while they're searching their libraries."): `controlSearching`, while a
    // player `player` names (relative to the rule's controller; never the controller themselves) searches their own library, every decision of that search is made by the rule's controller
    // (core/player-control.ts, a record `during: 'search'`); of two such rules the one whose source most recently entered the battlefield works (its ruling of 2020-11-10). Read by
    // effects/handlers/search-control.ts via statics/hooks.ts#searchControllerOf. Capability `rulemod:controlSearching`
    | 'controlSearching'
    // edh-next-119 INTERFACE CHANGE (additive), CR 614.1a, 609.4b, 701.23a (Opposition Agent: "While an opponent is searching their library, they exile each card they find. You may play those cards for as
    // long as they remain exiled, and you may spend mana as though it were mana of any color to cast them."): `searchFoundExiled`, a player `player` names who searches their own library exiles each
    // card they find (in every zone that search searches) instead of putting it anywhere else; the rule's controller may play those cards for as long as they remain exiled, spending mana as though
    // it were mana of any color to cast them (a permission record `remainsExiled`). Two such rules: the searching player chooses which applies (CR 616.1). Read by effects/handlers/search-control.ts
    // via statics/hooks.ts#searchExilersOf. Capability `rulemod:searchFoundExiled`
    | 'searchFoundExiled'
    // edh-next-93 INTERFACE CHANGE (additive), CR 728.1, 119.3, 614.1a (Strong, the Brutish Thespian: "You gain life rather than lose life from radiation."): `player` (default you) gains the life that
    // the rad counters' triggered ability would make them lose (the `loseLife` step with `radiation: true`, core/rad.ts), the same amount, as it resolves. Read by effects/handlers/lifedamage.ts via
    // statics/hooks.ts#radiationGainsLife. Capability `rulemod:radiationGainsLife`
    | 'radiationGainsLife'
    // edh-next-75 INTERFACE CHANGE (additive), CR 309.4c, 701.49, 603.2d (Hama Pashar, Ruin Seeker; Dungeon Delver: "Room abilities of dungeons you own trigger an additional time."): `roomAbilitiesExtra`,
    // each such rule of the dungeon's owner (`player`, default you: the rule's controller) makes the room ability a venture marker moves into trigger one more time (core/dungeons.ts#triggerRoom via
    // statics/hooks.ts#extraRoomTriggers). Capability `rulemod:roomAbilitiesExtra`
    | 'roomAbilitiesExtra'
    // r3-static INTERFACE CHANGE (additive), CR 602.5b, 702.193a: "Each power-up ability of permanents you control can be activated an additional time"
    // (`keyword` the wrapper keyword of the abilities, `of` their sources, `value` the extra activations, default 1): an activated ability with that keyword
    // whose printed limit is "only once" per game may be activated that many more times (rules/timing.ts via statics/hooks.ts#additionalActivations).
    // edh-players-6 INTERFACE CHANGE (additive), CR 606.3, 602.5b: with the keyword `loyalty`, the loyalty abilities of a permanent `of` matches may be activated `value` more
    // times each turn than the one the rules allow ("You may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once",
    // Oath of Teferi); as a resolved effect `of` is `{is: {ref:'each', ...}}`, the permanents it picks as it resolves ("For each planeswalker you control, you may activate
    // one of its loyalty abilities once this turn as though none of its loyalty abilities have been activated this turn", The Chain Veil; effects/handlers/lasting.ts)
    | 'additionalActivation'
    // edh-cast-13 INTERFACE CHANGE (additive), CR 707.10, 614.1a, 616.1 (Twinning Staff): "If you would copy a spell one or more times, instead copy it that many times plus an additional time. You may
    // choose new targets for the additional copy." (`extraSpellCopy`, `player` the copier, default you): each such effect makes one more copy of a SPELL (an ability is no spell) put onto the stack by an
    // effect of that player's, whose targets that player may change as for any copy (CR 707.10c); every effect applies once (a second Twinning Staff, one more copy). effects/handlers/tokens-copy.ts
    // #copySpells via statics/hooks.ts#extraSpellCopies. Capability `rulemod:extraSpellCopy`.
    | 'extraSpellCopy'
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
    // edhn81 INTERFACE CHANGE (additive), CR 122.2, 400.7, 113.6b (Skullbriar, the Walking Grave; Me, the Immortal): "Counters remain on ~ as it moves to any zone other than a player's
    // hand or library." (`countersRemain`, the source itself only): the new object that ~ becomes keeps the counters it had, unless it goes to a hand or a library; judged by the
    // abilities it has in the zone it moves from (a static ability with `zone` naming every zone but those two). core/zones.ts#moveObject via statics/hooks.ts#countersRemainOnMove
    | 'countersRemain'
    // r4-mech INTERFACE CHANGE (additive), CR 704.5i: "Planeswalkers you control aren't put into their owners' graveyards for having 0 loyalty." (`zeroLoyaltyKept`):
    // the state-based action that puts a planeswalker with 0 loyalty into its owner's graveyard does not apply to the planeswalkers `of` matches (relative to the
    // source; the source itself without `of`); core/sba-objects.ts via statics/hooks.ts#zeroLoyaltyKept
    | 'zeroLoyaltyKept'
    // edh-d-94 INTERFACE CHANGE (additive), CR 120.3c, 614.1a (Deification; rulings 2023-05-12: the damage is still dealt, only fewer counters are removed): "if damage dealt to a
    // planeswalker you control of the chosen type would result in all loyalty counters on it being removed, instead all but one of those counters are removed"
    // (`damageLeavesOneLoyalty`, `of` the planeswalkers, relative to the source): damage dealt to such a planeswalker that would remove every loyalty counter it has removes all but one
    // (rules/damage.ts#dealDamage via statics/hooks.ts#damageLeavesOneLoyalty). Capability `rulemod:damageLeavesOneLoyalty`
    | 'damageLeavesOneLoyalty'
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
    | 'diceAdvantage'
    // edh-d-49 INTERFACE CHANGE (additive), CR 706.2, 706.6 (Night Shift of the Living Dead, Xenosquirrels, Monitor Monitor): after the source's controller rolls dice, they may pay `cost`
    // (an optional payment made when the roll is done and before anything sees its results); `rollAdjust`: "If you do, increase or decrease the result by 1" (`value` the amount, 1;
    // the result of ONE die of the instruction, their choice after seeing all the results; a result may leave the range of the die), `rollReroll`: "reroll one or more dice you rolled"
    // (any of the dice just rolled, once for the one payment; an original roll that is rerolled never happened: it caused nothing and no effect sees it). `oncePerTurn`: "Do this only
    // once each turn" / "Once each turn" (counted for the source object, PlayerState.turnStats.rollOptionsUsed). Read by effects/handlers/game.ts#rollDie via effects/roll-options.ts
    // (core/dice.ts#rollDice calls the hook before it emits dieRolled). Capabilities `rulemod:rollAdjust`, `rulemod:rollReroll`
    | 'rollAdjust' | 'rollReroll'
    // edh-next-12 INTERFACE CHANGE (additive), CR 705.1, 614.1a (Krark's Thumb): "If you would flip a coin, instead flip two coins and ignore one." (`coinAdvantage`): each coin
    // the source's controller would flip is flipped together with one more coin, and one of the results is ignored (not considered flipped: only the kept flip emits `coinFlipped`
    // and counts). The player keeps the result of their choice when the coins differ. Several such effects each double the flips of the one before (2^n coins, ruling 2019-01-25). Read by effects/handlers/game.ts#flipCoin via
    // statics/hooks.ts#coinAdvantage; core/dice.ts#flipCoin flips and ignores. Capability `rulemod:coinAdvantage`
    | 'coinAdvantage'
    // edh-c-72 INTERFACE CHANGE (additive), CR 106.12, 614.1a, 106.1b (Ritual of Subdual): "If a land is tapped for mana, it produces colorless mana instead of any other type."
    // (`tappedLandManaOnlyColorless`, `player` whose lands, default you; Ritual of Subdual says every player's): a land tapped for mana ({T} in the cost of its mana ability) produces
    // {C} for each mana it would produce, the amount unchanged. Read where the mana is added (rules/mana.ts#addMana via statics/hooks.ts#tappedManaOnlyColorless, installed by
    // effects/mana-ability.ts) and by the payment planner (rules/sources.ts). Capability `rulemod:tappedLandManaOnlyColorless`
    | 'tappedLandManaOnlyColorless'
    // edh-next-45 INTERFACE CHANGE (additive), CR 106.12, 614.1a, 106.1b (Infernal Darkness): "If a land is tapped for mana, it produces {B} instead of any other type."
    // (`tappedLandManaOnlyType`, `manaType` the type, `player` whose lands, default you; Infernal Darkness says every player's): as `tappedLandManaOnlyColorless`, with the type named.
    // Read where the mana is added (rules/mana.ts#addMana via statics/hooks.ts#tappedManaOnlyColorless) and by the payment planner (rules/sources.ts). Capability `rulemod:tappedLandManaOnlyType`
    | 'tappedLandManaOnlyType'
    // edh-next-12 INTERFACE CHANGE (additive), CR 106.12, 614.1a, 106.1b (Damping Sphere): "If a land is tapped for two or more mana, it produces {C} instead of any other type and
    // amount." (`tappedLandManaColorless`, `value` the least mana, `player` whose lands, default you; Damping Sphere says every player's): a land tapped for mana ({T} in the
    // cost of its mana ability) that would produce that much mana or more produces one {C} instead. Read where the mana is added (rules/mana.ts#addMana via
    // statics/hooks.ts#tappedManaCollapseAt, installed by effects/mana-ability.ts) and by the payment planner (rules/sources.ts). Capability `rulemod:tappedLandManaColorless`
    // edh-next-140 (CR 106.12, 614.1a; Contamination: "If a land is tapped for mana, it produces {B} instead of any other type and amount."): with `manaType`, the one mana is of that type
    // (`value` 1: from one mana on); without it {C}, as before
    | 'tappedLandManaColorless';
  /**
   * std-ry8 INTERFACE CHANGE (additive), CR 603.12: of `mayExertAsAttacks` and `enlist`, what happens right after the option was taken, in a context whose source
   * and controller are the attacking creature's, with the exerted creature (or the creature enlisted) bound as `as` and that name's result performed. Capability
   * `feature:rule.attackOption.then`.
   */
  then?: { as: Name; do: EffectStep[] };
  /**
   * edh-combat-1 INTERFACE CHANGE (additive), CR 701.43a, 508.1: of `mayExertAsAttacks`, "If this creature hasn't been exerted this turn, you may exert it as it attacks."
   * (Combat Celebrant): the option is offered only while the creature has not been exerted this turn (an `exert` action entry of this turn's history whose subject
   * is the creature; core/attack-options.ts). Capability `feature:rule.attackOption.unlessExertedThisTurn`.
   */
  unlessExertedThisTurn?: true;
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
  /** r3-static: of `additionalActivation`, the wrapper keyword of the activated abilities it applies to ("power-up", `ActivatedAbilityDef.keyword`; `loyalty` for loyalty abilities, edh-players-6). */
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
   * edh-players-22 INTERFACE CHANGE (additive), CR 702.11b-c, 115.1, 609.4 (Detection Tower): of `targetableThroughHexproof` only, "your opponents ... can be the targets of spells and abilities you
   * control as though they didn't have hexproof": the players the waiver covers (a player's hexproof is the restriction "can't be the target of spells or abilities your opponents control",
   * which this waives; statics/hooks.ts#hexproofIgnored). With `player` (the controller of the spells and abilities that may target them) the waiver covers only what that player controls.
   * Capability `feature:rulemod.targetableThroughHexproof.players` (and `.player`).
   */
  ofPlayers?: PlayerRef;
  /**
   * FAST5 T60 INTERFACE CHANGE (additive), CR 510.1a, 613.11: of `combatDamageUsesToughness`, only for a creature whose toughness is greater than its power
   * ("each creature you control with toughness greater than its power assigns combat damage equal to its toughness rather than its power", "as long as
   * equipped creature's toughness is greater than its power, it assigns ..."); without it the creature always does (Doran, the Siege Tower). Judged on the
   * characteristics the creature has as combat damage is assigned (statics/hooks.ts#assignsCombatDamageAsToughness). Any other rule has no `onlyIf`.
   */
  onlyIf?: 'toughnessGreaterThanPower';
  /** edh-next-146 (CR 607.2d, 201.3, 205.3m): of `chooseAsAttached`, the choices made as the source becomes attached, each kept under its link ('creature': a creature card's name). */
  asAttached?: { what: 'color' | 'creatureType' | 'cardName'; link: LinkId; cardKind?: 'creature' }[];
  /**
   * edh-next-124 INTERFACE CHANGE (additive), CR 502.3, 102.3 (Teferi, Who Slows the Sunset's emblem): of `untapDuringOtherUntapSteps` only, "during each OPPONENT'S untap step": the untap step of
   * an opponent of the source's controller only (a teammate's is not, CR 102.3, 810.2). statics/hooks.ts#untapsDuringOthersUntapStep. Capability `feature:rulemod.untapDuringOtherUntapSteps.opponents`.
   */
  opponents?: true;
  /** edh-d-49: of `rollAdjust` and `rollReroll`, the option can be taken once each turn per source object (it is not offered again this turn). Capability `feature:rulemod.rollOption.oncePerTurn`. */
  oncePerTurn?: true;
  /** edh-next-144 (CR 102.1, 500.1): of `revealFirstDraw` only, "on each of your turns": only the first card drawn in a turn of the source's controller (Keranos, God of Storms). */
  onYourTurns?: true;
  /**
   * edh-next-132 INTERFACE CHANGE (additive), CR 701.20a, 121.2 (God-Eternal Kefnet, ruling 2019-05-03): of `revealFirstDraw` only, "You may reveal the first card you draw each turn as you draw
   * it": the reveal is the controller's choice, made after seeing the card and before it joins the hand (triggers/reveal-draw.ts asks a yes/no for each such source); declined, no reveal and
   * no "this way" trigger. Extends edh-next-144's rule. Capability `feature:rulemod.revealFirstDraw.optional`.
   */
  optional?: true;
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
  /**
   * edh-misc-5 INTERFACE CHANGE (additive), CR 603.2d, 603.6a, 603.10a: with a `cause` that is a permanent ENTERING the battlefield (a zone change `to: 'battlefield'`,
   * only `subject` besides), the same described permanent LEAVING the battlefield (any zone) causes the extra trigger too ("If a legendary permanent or an artifact
   * entering or leaving the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time", Gandalf the White).
   * Entering is judged as before; leaving looks back (CR 603.10a: the permanent's own "when this leaves the battlefield" and a doubler that left with it count as they
   * were immediately before the event). Capability `feature:triggerMod.enterLeave` (triggers/collect.ts#timesTriggered).
   */
  orLeaves?: true;
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
 * edh-next-141 (CR 603.2d, 702.37e, 708.8; Panoptic Projektor): a cause that is ANY face-down permanent being turned face up ("If turning a face-down permanent face up causes a triggered
 * ability of a permanent you control to trigger, that ability triggers an additional time"): the `turnedFaceUp` event with no description of the permanent or of who turned it. The
 * permanent is on the battlefield as it turns face up, so nothing looks back (CR 708.8: it is the same object). Capability `feature:triggerMod.turnedFaceUp` (triggers/collect.ts).
 */
export function isTurnedFaceUpCause(cause: EventPattern | undefined): boolean {
  if (cause === undefined || cause.ev !== 'becomes') return false;
  const c = cause as { what?: unknown; object?: unknown };
  return c.what === 'turnedFaceUp' && (c.object === undefined || JSON.stringify(c.object) === '{}') && Object.keys(cause).every((k) => k === 'ev' || k === 'what' || k === 'object');
}

/**
 * edh-misc-5 (CR 603.2d, 603.6a, 603.10a): the cause of a mod with `orLeaves`: a zone change INTO the battlefield of a described object and nothing else (the mod's
 * other half is the same object leaving, `leavingOf`).
 */
export function isEnterLeaveCause(def: { cause?: EventPattern; orLeaves?: true }): boolean {
  const c = def.cause as { ev?: string; from?: unknown; to?: unknown } | undefined;
  return def.orLeaves === true && c !== undefined && c.ev === 'zoneChange' && c.to === 'battlefield' && c.from === undefined && Object.keys(c).every((k) => k === 'ev' || k === 'to' || k === 'subject');
}

/** edh-misc-5: the leaving half of an enter-or-leave cause: the same subject filter, from the battlefield to anywhere. */
export function leavingOf(cause: EventPattern): EventPattern {
  const subject = (cause as { subject?: ObjectFilter }).subject;
  return { ev: 'zoneChange', from: 'battlefield', ...(subject !== undefined ? { subject } : {}) } as EventPattern;
}

/**
 * trek-2 (CR 603.2d, 119.9; cites unverified): a cause that is YOU GAINING LIFE ("If you gaining life causes a triggered ability of a permanent you control to trigger,
 * that ability triggers an additional time", Dr. Beverly Crusher): a `life` gain event of the controller of the doubler, with no amount. Nothing leaves the
 * battlefield with it, so it is matched without looking back, like a permanent entering (triggers/collect.ts#timesTriggered).
 */
/**
 * edh-d-93 (CR 603.2d, 121.1; Krang, the All-Powerful): "If a player drawing a card causes a triggered ability of a permanent you control to trigger": the cause is a draw of any player and nothing
 * else (no ordinal, no draw-step exception), matched without looking back like a life gain (no object leaves with it; triggers/collect.ts#timesTriggered).
 */
export function isAnyDrawCause(cause: EventPattern | undefined): boolean {
  return cause !== undefined && cause.ev === 'draw' && cause.player === 'any' && Object.keys(cause).every((k) => k === 'ev' || k === 'player');
}

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
   * edh-perms-24 INTERFACE CHANGE (additive), CR 107.3, 601.2b ("Kicker {X}. X can't be 0.", Thieving Skydiver): the smallest X the caster may announce when this OPTIONAL cost
   * (which has an X) is paid. The cost is offered only when X can be at least this and still be paid, and X is announced from that value up (actions/cast.ts#xFloor).
   * Capability `feature:additionalCost.xMin`.
   */
  xMin?: number;
  /**
   * std-costs-1 INTERFACE CHANGE (additive), CR 601.2b, 601.2f: an optional cost with an "any number" part whose number a cost reduction of the spell reads
   * ("you may sacrifice any number of nonland permanents. This spell costs {1} less to cast for each permanent sacrificed this way"): the caster announces the
   * number as the cost is announced (actions/cast-costs.ts; 0 is not paying it), and it is kept in `CostsPaid.counts[name]` (Quantity `costCount`). Needs
   * `name`. Capability `feature:additionalCost.announceCount`.
   */
  announceCount?: true;
  /**
   * edh-cast-15 INTERFACE CHANGE (additive), CR 603.12, 707.10, 601.2b: "As an additional cost to cast this spell, you may sacrifice one or more creatures. When you do, copy this spell for each
   * creature sacrificed this way" (Plumb the Forbidden): when the spell is cast with this cost paid, a reflexive trigger copies the spell once for each object the cost took (its
   * announced number in `CostsPaid.counts`), the copies keeping the spell's choices (no new targets). Needs `name` and `announceCount`. Capability `feature:additionalCost.copyForEach`.
   */
  copyForEach?: true;
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
  /**
   * edh-next-68 INTERFACE CHANGE (additive), CR 614.1a, 118.9 (Glimpse the Cosmos: "If you cast this card this way and it would be put into your graveyard, exile it instead"): a spell cast with this cost
   * is exiled instead of being put into a graveyard, and only then (a spell returned to its owner's hand goes there). Recorded as `StackInfo.permitGraveyardInstead`. Capability `feature:alternativeCost.graveyardInstead`.
   */
  graveyardInstead?: true;
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
  /** edh-top-1: "... and you're not the starting player" (Gemstone Caverns): the starting player (CR 103.1) may not begin the game with it. */
  notStarting?: boolean;
  /** edh-top-1: "... on the battlefield with a luck counter on it": the permanent has the counters from the moment it is on the battlefield (CR 122.1). */
  counters?: { kind: string; count: number };
  /** edh-top-1: "If you do, exile a card from your hand" (Gemstone Caverns): the player exiles this many cards of their hand, or all of them (CR 103.6). */
  exileFromHand?: number;
  /**
   * edhd32 (CR 103.6b, 603.7a; the Chancellor cycle, Sphinx of Foresight, Devourer of Destiny): with `reveal`, "If you do, at the beginning of [the | your] first upkeep, ...":
   * the delayed triggered abilities (only `delay` steps with a step `when` and baked instructions) the player's reveal creates before the game begins. Capability
   * `feature:pregame.reveal.delayed` (core/pregame.ts runs them).
   */
  then?: EffectStep[];
}
