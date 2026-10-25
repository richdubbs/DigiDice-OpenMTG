/**
 * Shared types of the lowering passes (design 6.5). Owner: WP17.
 *
 * The chart parser (WP6) turns each sentence into model-shaped JSON that still carries MARKERS for facts that belong to the whole ability: target phrases
 * (`$target`), pronouns (`$anaphor`), "if you do" (`$step`) and links (`'$link'`), see parser/holes/core.ts. The lowering passes replace every marker,
 * fold riders into the step they modify, attach durations and conditions, and sequence the sentences into ONE `EffectProgram`. A unit that a pass
 * cannot lower becomes manual (never a guess): `Unit.manual` records why, and the taint pass (parser/taint.ts) decides how far that spreads.
 *
 * Every pass is a pure function `(Draft) => Draft`: it copies what it changes and never edits its input (tests pin that).
 */
import type { CostDef, EffectStep, EventPattern, ObjectFilter, TargetSpec } from '../../types/ability';
import type { Diagnostic, DiagnosticCode } from '../types';
import type { Tok } from '../holes/tok';
import type { TemplateUse } from '../chart';

export type Rec = Record<string, unknown>;
export type Range = [number, number];

/** Why a unit is manual. `unresolved`: an anaphor could not be bound (design 6.4); that makes the manual unit contagious (T2, design 6.7). */
export interface ManualInfo {
  code: DiagnosticCode;
  reason: string;
  unresolved?: boolean;
  furthest?: { token: string; expected: string[] };
  alternatives?: unknown[];
}

/** One sentence of an ability (or of a modal bullet): the unit the chart parsed (design 6.2 step 6). */
export interface Unit {
  /** Sentence index inside the ability (stable across passes; StepBase.sentence). */
  index: number;
  /** trek-8: index of the Oracle line (paragraph) the sentence is on (`PreprocessedFace.lines`); undefined where it was not recorded (lower/delay-tail.ts reads it). */
  line?: number;
  /** Normalized-text range of the unit (for the ledger and the diagnostics). */
  range: Range;
  /** Display text of the sentence: "~" for the object, reminder text removed, whitespace collapsed. */
  text: string;
  /** Tokens of the unit (as the hole grammars read them). */
  tokens: readonly Tok[];
  /** Lowered steps (chart output with markers until the passes have run). Empty for a manual unit and for a rider that was folded. */
  steps: Rec[];
  /** A rider sentence (design 6.5 pass 4): what it merges into the previous step. */
  rider?: { patch: Rec; attachTo?: string; template: string };
  manual?: ManualInfo;
  templates: string[];
  experimental: string[];
  /** Notes from the hole grammars ("batch", "assumed:...", "each-of"). */
  flags: string[];
  /** The derivation tree (guard G3 reads it). */
  tree?: TemplateUse;
  /** Binding names (`as`, `let`) the sentence produced before it became manual: a later step that reads one is poisoned (taint T1, design 6.7). */
  lostNames?: string[];
  /** Ids of the target specs this sentence introduced (pass 2). They stay announced even if the sentence later becomes manual (design 6.7). */
  targetIds?: string[];
  /** Token index (in `tokens`) where the phrase of each target it introduced starts (pass 2): a pronoun never refers to a later target (design 6.4). */
  targetPos?: Record<string, number>;
  /**
   * p2-c-dieroll-1 (CR 706.3a, unverified cite): a sentence of a die-roll result row ("1-9 | Create a Treasure token."), the row's index and range; the conditions
   * pass (lower/die-roll.ts#foldRollTable) moves its steps into the `table` of the roll right before the rows.
   */
  row?: { index: number; min: number; max: number };
}

/** One option of a modal ability (CR 700.2): its bullet text, its units, and the additional cost of a Spree-like mode (CR 700.2h). */
export interface ModeDraft {
  text: string;
  units: Unit[];
  /** FAST5X E1: the "+ {cost}" of a Spree mode (CR 702.172a, 700.2h). */
  cost?: CostDef;
}

export interface ModesDraft {
  min: number;
  max: number;
  options: ModeDraft[];
}

/**
 * Something a pronoun can refer to (design 6.4): a target, an event role of the trigger, or the objects/players/number an earlier step produced.
 * `sort` and `number` are compared with the anaphor; `canBe` with its head noun ("that creature" needs a mention that can be a creature).
 * An `opaque` mention stands for what a sentence that is not understood (or a trigger clause that is not understood) may have mentioned: it is compatible
 * with every anaphor, so a pronoun that could refer to it never resolves (design 6.4: zero or several candidates make the sentence manual).
 */
export interface Mention {
  sort: 'object' | 'player' | 'any' | 'number';
  number: 'singular' | 'plural';
  /**
   * STD-FRA (CR 115.1, 601.2c): one target for each opponent. It is a set ("those creatures", `number` plural), but it may hold one object ("it"): a singular pronoun is still a
   * candidate for it, so that a pronoun with this and the object itself as candidates stays ambiguous (never a silent guess), as for a single target.
   */
  alsoSingular?: boolean;
  /**
   * std-rx10 (CR 115.1, 608.2c): what the description of a target says of its controller ("target creature you control": 'you'; "you don't control": 'notYou'; "an
   * opponent controls": 'opponent'), read by an anaphor that names it so ("the creature you control", AnaphorInfo.controls; lower/anaphora.ts#compatible).
   */
  controls?: 'you' | 'notYou' | 'opponent';
  /** Head nouns the mention can be called by; `*` = any object noun (an unrestricted "target permanent" can be "that creature"). */
  heads: string[];
  /** The reference written at the use (ObjRef / PlayerRef / Quantity). */
  ref: Rec;
  origin: 'target' | 'event' | 'step' | 'opaque';
  /** Participles that describe what happened to it ("exiled", "sacrificed", "created"): "the exiled card" (design 6.4). */
  verbs?: string[];
  /** Unit index that introduced it (pronouns may only look back). */
  unit: number;
  /** For a target of the sentence being resolved: the token index where its phrase starts (a pronoun before it cannot refer to it). */
  pos?: number;
  /**
   * The last earlier step that moved this object to another zone (exile, return, destroy, sacrifice): a reference that ACTS on it afterwards ("exile
   * target creature, then return it") is bound to that step's `as`, because a target handle never re-bases and a binding does (design 3.1 rules 2 and 4,
   * CR 400.7). Property reads ("its controller", "its power") keep `ref` and read last known information (CR 608.2h).
   */
  movedBy?: { unitRef: Unit; path: string };
  /** PUSH1 T2: an event role the trigger clause does not name (model/lint-roles.ts#implicitRole): a description may pick it out, a bare pronoun may not. */
  implicit?: boolean;
  /** PUSH1 T2: a candidate only when no other mention is compatible (the object an activation cost names, lower/ability.ts#costMentions). */
  fallback?: boolean;
  /**
   * FAST2 T10: the object with the ability as a trigger names it in an event that does not move it ("Whenever ~ becomes blocked by a creature", "Whenever ~
   * deals damage to a creature"). Oracle names the object itself "~", "this creature" or "it", never "that creature" (CR 201.5): a demonstrative ("that
   * creature", "that card") is never this mention (lower/anaphora.ts#compatible). A bare pronoun still may be.
   */
  selfObject?: boolean;
  /**
   * FAST5 T76 (CR 201.5): the object itself as a step, a condition or a quantity of THIS ability names it ("~", "this creature"; lower/mentions.ts#namedMention): a demonstrative
   * ("that creature") is never it while it has not moved (its `movedBy` unset), as for `selfObject`, but a bare pronoun still may be.
   */
  namedSelf?: boolean;
  /**
   * cmd1 (CR 608.2f): the player of the current iteration of a "for each opponent" / "for each player" step, by the noun it iterates over: inside that step
   * "that opponent" ("for each opponent, create a token that's tapped and attacking that opponent") names it whatever else is a player (the idiom; lower/anaphora.ts).
   */
  iterates?: 'opponent' | 'player';
  /**
   * MX5: the object itself in its own "enters" trigger (CR 603.6a). For a demonstrative ("that creature", "that card") it is a candidate only when no
   * other mention is (as `fallback`, lower/anaphora.ts#resolveAnaphor): Oracle names the object "~", "this creature" or "it" (CR 201.5). A bare pronoun
   * keeps it as a full candidate.
   */
  selfEntered?: boolean;
  /**
   * p2-refs-2 (CR 702.33d, 608.2c): the object itself, named only by a condition about its own cast ("if this spell was kicked", `wasCast` with no object): a candidate
   * only when no other mention is (lower/anaphora.ts#resolveAnaphor demotes it), so "gain control of that creature ..., untap it" keeps "it" the creature.
   */
  condSelf?: boolean;
  /**
   * std-rx11 (CR 603.7c, 201.5): the object a delayed trigger's own event is about, where that event names a TARGET of the ability that creates it ("target creature you
   * control can't be blocked this turn. Whenever that creature deals combat damage this turn, you may exile it": the creature that dealt the damage IS the target;
   * lower/anaphora.ts#resolveEventDelay). It counts as the target for the rule that a bare pronoun after a target is never the object of its own enters trigger.
   */
  forTarget?: boolean;
  /**
   * FAST2 T10: a spell or ability on the stack ("the target of a spell or ability"): never what an instruction that acts on a permanent means ("sacrifice
   * it", "destroy it": CR 701.8a, 701.21a act on permanents only; lower/anaphora.ts#resolveIn).
   */
  stackObject?: boolean;
  /**
   * Cloud std-eoe (CR 400.7, 701.8a, 701.21a): a group a destroy or sacrifice step put into graveyards ("Destroy each creature with mana value of the chosen quality"):
   * cards now, no permanents, so never what an instruction that acts on permanents means ("Untap them", "They gain haste until end of turn"; lower/anaphora.ts#resolveIn).
   */
  leftBattlefield?: boolean;
  /**
   * FAST5X E19: head nouns that never name it although `heads` has `*` ("~" of a permanent's triggered ability is never "that spell", lower/mentions.ts
   * #selfNeverSpell; lower/anaphora.ts#compatible).
   */
  notHeads?: string[];
  /**
   * FAST3 T18: only a description with a participle names it ("the sacrificed creature": what a cost sacrificed, lower/ability.ts#sacrificedMentions); a bare
   * pronoun or "that creature" never does, so it adds no candidate to any other reference (lower/anaphora.ts#compatible).
   */
  participleOnly?: boolean;
  /**
   * std-rw8 (CR 608.2h, 118.12): with `participleOnly`, a demonstrative with a head noun names it too ("You may sacrifice another creature. When you do, ~ deals
   * damage equal to that creature's power ..."): what an optional payment of the effect sacrificed (lower/mentions.ts#paidSacrificed). A bare pronoun still never
   * does (lower/anaphora.ts#compatible).
   */
  demonstrative?: boolean;
  /**
   * Cloud r3-moved (CR 602.2b, 601.2b, 608.2c): what ONE part of the ability's cost moved, of any number of objects (lower/ability.ts#costGroupMentions): a count "the
   * number of cards exiled this way" with no instruction of that kind reads it (lower/quantities.ts). Its verb is no participle, so no description names it.
   */
  costPart?: { kind: 'sacrificed' | 'discarded' | 'exiled'; filter: ObjectFilter };
  /**
   * LNK1 ADDITION: the player another ability of the face targeted (`{ref:'linked', link: TARGETED_PLAYER_LINK}`, CR 607.1), seeded only where the face has
   * exactly one such target elsewhere (parser/parse.ts#playerLinkable). Only "that player" names it, and only when no other mention of the ability is a
   * candidate (lower/anaphora.ts#compatible, #resolveAnaphor): a reference with an antecedent in its own ability never reaches across abilities.
   */
  linked?: boolean;
  /**
   * LNK1 ADDITION: a player a phrase names in passing ("target creature an opponent controls", "to its owner's hand"): only a demonstrative with a head noun
   * ("that player", "that opponent") names it, never a bare "they" or "their" (lower/anaphora.ts#compatible), so it adds no candidate to any other pronoun.
   */
  headOnly?: boolean;
  /**
   * Standard round 4, r4-refs (CR 608.2c): a `headOnly` player that the subject "they" names too, Oracle's singular "they" for the opponent a target phrase named
   * ("Destroy target permanent an opponent controls. They create a Treasure token."). Only "they" and "their", never "them" (an object word as well).
   */
  alsoThey?: boolean;
  /**
   * std-rx30 (CR 608.2c, 400.3): an `alsoThey` player that "them" names too: the owner of one object who is the subject acting in the sentence ("Its owner may put it
   * on top of their library. If they do, ~ deals 2 damage to them.", Clash of Elements). A plural object is still a candidate of "them" beside it (design 6.4).
   */
  alsoThem?: boolean;
  /**
   * T46 ADDITION: a hand a step revealed or looked at (CR 701.20a, 701.20e, 402.3): the cards of that hand as ONE set, which the sentence "You choose a nonland
   * card from it" names with the pronoun "it". Only the anaphor with the head `hand` (parser/templates/zz-fast5/t46.json) names it
   * (lower/anaphora.ts#compatible), so it adds no candidate to any other reference.
   */
  handOnly?: boolean;
  /**
   * C6 ADDITION: the step field a reference to this mention names (default `as`): the players who can't do what a step of a group tells them ("Each opponent
   * who can't ..."; CR 101.3) are bound by the step's `cantAs` (lower/mentions.ts#cantOf, lower/anaphora.ts#bind).
   *
   * trek-7 ADDITION: `exiledRest`, "the rest" of the cards an `exileUntil` exiled (the card it stopped at less): the step's names `exiled` and `as` are given when a
   * reference to it is bound (lower/anaphora.ts#bind), not when the mention is made.
   */
  bindKey?: 'cantAs' | 'exiledRest';
}

/** The effect program of one ability while it is being lowered. */
export interface Draft {
  units: Unit[];
  modes?: ModesDraft;
  targets: TargetSpec[];
  /** The trigger of a triggered ability (pass 1 seeds its event roles as mentions). */
  trigger?: { on: EventPattern[]; batch?: boolean; /** r5-trig: TriggerDef.wholeBatch (parser/lower/scope.ts#eventMentions) */ wholeBatch?: true };
  /** The effect of a triggered ability whose trigger clause was not understood: its event roles are unknown, so pass 1 seeds one opaque mention. */
  unknownTrigger?: boolean;
  /**
   * The intervening "if" of a triggered ability (CR 603.4), lowered by the ability driver: the objects it names ("if enchanted creature is red") are
   * mentions for the whole effect (design 6.4; WP21 review, INTERFACE CHANGE of this WP17 file).
   */
  condition?: Rec;
  /** Lower-case card types and subtypes of the face (what "~" can be called). */
  selfHeads: string[];
  /** FAST5 T47: the object can become a creature through its own ability (FaceInfo.animates). */
  animates?: boolean;
  /** CLOUD C5 (CR 607.2d): the choices other abilities of the face make as the object enters (FaceInfo.choices), for "the chosen color" (lower/links.ts). */
  faceChoices?: { link: string; what: string }[];
  /** Mentions seeded by pass 1 (event roles); later mentions are computed by the passes that need them. */
  mentions: Mention[];
  /** Binding names already used in this ability (StepBase.as); new ones never collide. */
  names: string[];
  diagnostics: Diagnostic[];
  /** FAST5X E1: the effect of a spell ability (CR 113.3a): its cast-record conditions are decided as it is cast (lower/riders.ts, CR 601.2b-c). */
  spell?: boolean;
}

/** One sequenced list of steps (the main program or one modal option) with the step-to-sentence map the taint pass needs. */
export interface LoweredSeq {
  steps: EffectStep[];
  /** Units in text order (manual ones included). */
  units: Unit[];
  /** Index (into `units`) of the sentence each top-level step came from, same order as `steps`. */
  stepUnits: number[];
}

/** Output of the lowering passes, input of the taint pass (parser/taint.ts). */
export interface LoweredProgram {
  targets: TargetSpec[];
  main: LoweredSeq;
  modes?: { min: number; max: number; options: (LoweredSeq & { text: string; cost?: CostDef })[] };
}
