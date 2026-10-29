/**
 * effects/: the interpreter. Plain imperative code over the ability JSON, re-executed from the settled base state on every
 * decision (docs/ARCHITECTURE.md, "The decision model"). Owners: WP4 (ctx, refs, eval), WP10 (spine), WP11 (propose), WP12-WP15 (handler families).
 *
 * Files:
 *   effects/api.ts            this file (types shared by all handlers)
 *   effects/run.ts            resolveStackObject, runSteps, manualFallback             (WP10)
 *   effects/ctx.ts            makeCtx, target legality                                 (WP4)
 *   effects/refs.ts           resolveObjs, resolvePlayers, readInfo, rebase            (WP4)
 *   effects/eval.ts           evalQty, evalCond, evalCount, filter evaluation          (WP4; with rules/filter.ts)
 *
 * refs.ts and eval.ts need each other (a reference counts `topCards` with a quantity; a quantity resolves references) and the import rules forbid the cycle, so
 * eval.ts calls `installQuantityEvaluator` (refs.ts) when it loads. Anything that uses refs.ts must therefore also import eval.ts (effects/ctx.ts does, for
 * everyone who builds a context); refs.ts alone throws an EngineBug at the first quantity it meets instead of guessing.
 *   effects/handlers/index.ts OP_HANDLERS = { ...control, ...damage, ...cards, ... }   (WP0 writes it once, importing every family file as a stub)
 *   effects/handlers/control.ts      if may forEach repeat let manual; the control table also spreads pay and the choices         (WP10)
 *   effects/handlers/pay.ts          pay                                                                (WP10)
 *   effects/handlers/choose.ts       chooseObjects chooseValue                                          (WP10)
 *   effects/handlers/lifedamage.ts   damage gainLife loseLife setLife fight                           (WP12)
 *   effects/handlers/counters.ts     putCounters removeCounters moveCounters                           (WP12)
 *   effects/handlers/cards.ts        draw discard mill scry surveil reveal look search shuffle piles addMana   (WP13)
 *   effects/handlers/zones.ts        move destroy sacrifice sacrificeChoice counter tap untap attach changeFace phaseOut regenerate removeFromCombat exchange   (WP14)
 *   effects/handlers/tokens.ts       createToken copy cast changeTarget                                (WP14; changeTarget r4-fxb)
 *   effects/handlers/new-targets.ts  chooseNewTargets                                                  (E3XP, CR 115.7d)
 *   effects/handlers/lasting.ts      effect delay reflexive                                            (WP15)
 *   effects/handlers/game.ts         extraTurn controlPlayer extraPhase extraStep endTurn winGame loseGame createEmblem rollDie flipCoin designate action   (WP15; extraStep r4-fxb; controlPlayer std-control-3)
 *   effects/propose.ts perform.ts  the proposal pipeline (CR 614-616) and the performers    (WP11)
 *   effects/replacements.ts replace-bodies.ts cant.ts funnels.ts   applicable effects, their bodies, "can't", the funnels of the primitives (WP11 addition)
 *   effects/manual.ts         manual step support (manualResolve prompts, reminders)       (WP10)
 */
import type { Game } from '../core/game';
import type { EventContext, FaceDownInfo, LinkValue, ObjHandle } from '../types/state';
import type { AbilityDef, CopyExcept, CounterSpec, EffectProgram, Name, EffectStep, EffectOp, Duration, ObjectFilter, ReplacementDef, TurnPhase } from '../types/ability';
import type { Performed } from './perform';
import type { CardId, ObjectId, PlayerId } from '../types/ids';
import type { GameObject, LastKnown, StackInfo, TargetChoice, ZoneKind } from '../types/state';
import type { LifelinkLedger } from '../rules/damage';

/** What an earlier name was bound to, plus what the objects were like when bound (for last known information, CR 608.2h). */
export interface Binding {
  objects: ObjHandle[];
  players: PlayerId[];
  snapshots: Record<ObjectId, LastKnown>;
  /**
   * audit-fix-1 ADDITION (optional): the objects stand for themselves even once they have left their zone ("a source of your choice", CR 609.7a: an object an
   * ability on the stack refers to, by last known information): a lasting effect fixes them with the rest (effects/handlers/lasting-fix.ts#fixRef). Set by
   * effects/handlers/choose.ts for a `damageSource` choice.
   */
  keepsLeft?: true;
}

export interface StepResult {
  /** The step carried out its action at least once (for `may`/`pay`: the player chose to; CR 118.12). */
  performed: boolean;
  /**
   * What `{q:'resultCount'}` reads, which the renderer prints as "the number of <what the step bound>" (render/qty.ts): the number of things the step
   * ACTUALLY acted on (design 8.3: events that happened), never an amount. Damage, life and counters ops (WP12) count the distinct objects and players
   * that were dealt damage, gained or lost life, or got or lost counters, as measured from the events the performers emitted (so prevented damage and
   * "can't lose life" are not counted); amount readings ("the damage dealt this way", "for each counter removed this way") have no quantity yet.
   */
  count: number;
  /**
   * FAST5X E16 INTERFACE CHANGE (additive), CR 120.4a, 120.10, 608.2c: of a `damage` or `fight` step, the excess damage it dealt to each permanent (object id
   * -> amount, summed over the step's damage events; NaN when it could not be computed), read by `{q:'excessDamage'}` ("the excess damage dealt this way").
   * Absent for every other step; a damage step that dealt no damage to a permanent has an empty map.
   */
  excess?: Map<ObjectId, number>;
  /**
   * std-rx20 ADDITION (optional), CR 120.3, 608.2c: of a `damage` step, the damage it actually dealt (the amounts of its `damageDealt` events, to players and
   * permanents), read by `{q:'damageDealt'}` ("you gain life equal to the damage dealt this way"). Absent for every other step.
   */
  dealt?: number;
  /**
   * FAST5X E17 ADDITION (optional): the last known information of the objects the step actually moved, as they were before it moved them (CR 608.2h; a token
   * that ceased to exist too). Set by `destroy` (effects/handlers/zones-remove.ts); read by `{cond:'did', which}` ("a creature you controlled was destroyed
   * this way"). Absent: the step reports nothing, and such a condition is false.
   * Cloud C7: also set, for a named step, by `move` (the objects that ended in its destination: a replaced move reports what it really put there), `sacrifice`,
   * `sacrificeChoice`, `discard` and `mill` (the cards it put into a graveyard) (effects/handlers/zones-move.ts, zones-remove.ts, cards-draw.ts); read by
   * `{q:'resultCount', which}` ("for each creature destroyed this way", CR 608.2c, 608.2h) as well.
   */
  before?: LastKnown[];
  /**
   * std-rw9 ADDITION (optional), CR 701.8a, 614.6, 608.2c: of a `destroy` step, the zone each object of `before` went to (same order; null when it ceased to exist), so
   * `{cond:'did', which, to:'graveyard'}` ("if a creature card is put into a graveyard this way") reads only what really went to a graveyard (a replacement may have
   * exiled it instead). Absent for every other step: `before` is then what reached the step's own destination already.
   */
  beforeTo?: (ZoneKind | null)[];
  /**
   * CLOUD std-dft ADDITION (optional), CR 701.23a: of a `search` step, every zone it searched and whose zone it was; read by a `shuffle` step with `ifSearched`
   * ("If you search your library this way, shuffle"). Absent for every other step.
   */
  searched?: { owner: PlayerId; zone: ZoneKind }[];
  /**
   * M12-3 ADDITION (optional), CR 119.3, 608.2c: of a `loseLife` step, the life its players actually lost, summed over every player (as the events measured
   * it: "can't lose life" and replacement effects counted), read by `{q:'lifeLost'}` ("you gain life equal to the life lost this way"). Absent for every other
   * step; a loseLife step whose players lost nothing has 0.
   * Cloud std-spm: also of an exchange of life totals (CR 701.12c) and of a `may` (what the steps of its optional action recorded), with `lifeLostBy`.
   */
  lifeLost?: number;
  /**
   * Cloud std-spm ADDITION (optional), CR 119.3, 701.12c: the life each player actually lost in the step (`lifeLost` is their sum), read by `{q:'lifeLost', who}`
   * ("if you lost life this way"). Recorded by `loseLife` and by an exchange of life totals; `runSteps` adds up its steps' records, and a `may` keeps those of its
   * optional action (effects/handlers/control.ts). A player who lost nothing is not listed.
   */
  lifeLostBy?: ReadonlyMap<PlayerId, number>;
  /**
   * std-rx14 ADDITION (optional), CR 122.1, 608.2c: of a `removeCounters` step, the counters it actually removed (kind -> number, summed over the objects), read by
   * `{q:'countersRemoved'}` ("for each lore counter removed this way"). `runSteps` adds up its steps' records, and a `may` keeps those of its optional action
   * (effects/handlers/control.ts). Absent for every other step.
   */
  countersRemoved?: ReadonlyMap<string, number>;
  /**
   * trek-6 ADDITION (optional), CR 122.1, 122.6, 608.2c: of a `putCounters` step, the counters it actually put (kind -> number, as the replacement effects left them, summed over
   * the holders), read by `{q:'countersPut'}` ("if you put two or more +1/+1 counters on creatures this way"). `runSteps` adds up its steps' records, and a `may` keeps those of its
   * optional action (effects/handlers/control.ts). Absent for every other step.
   */
  countersPut?: ReadonlyMap<string, number>;
  /**
   * M12-3 ADDITION (optional), CR 701.38a-b: of a vote, the votes each choice got (a word, an object id or a player id -> the number of votes; every choice is
   * listed, 0 included), read by `{q:'votes'}`. Absent for every other step.
   */
  votes?: Map<string, number>;
  /**
   * r5-fxz ADDITION (optional), CR 701.25a, 701.22a: of a `surveil` or `scry` step, the cards its players left on top of their libraries, as they are there
   * (read by `{q:'resultCount', which}` in place of `before`: "for each card you put on top of your library"). Absent for every other step.
   */
  kept?: LastKnown[];
  /**
   * Merge wave 8 ADDITION (optional; audit D2, design 10): the step, or one of the steps `runSteps` ran, was resolved by hand (effects/manual.ts#askManual). The
   * engine can't tell what a player did by hand, so a `may` whose optional action was resolved by hand counts as done (effects/handlers/control.ts#mayHandler).
   */
  byHand?: true;
}

export interface TargetSlot {
  handle: ObjHandle | null;
  player?: PlayerId;
  /** Result of the CR 608.2b re-check. */
  legal: boolean;
}

/** One resolution. Rebuilt on every re-execution, never stored in GameState. */
export interface ExecCtx {
  g: Game;
  /** Spell, or the source of the ability. Falls back to last known information once it has left (CR 113.7a, 608.2h). */
  source: ObjHandle;
  /** The spell or ability on the stack, if any. */
  stackId: ObjectId | null;
  /**
   * WP14 INTERFACE CHANGE (additive): the timestamp of that stack object when the context was built, i.e. when it was put onto the stack (CR 613.7). Handlers
   * read it instead of the stack object (design 8.6: never read the stack object after makeCtx): CR 701.27f compares it with the permanent's timestamp.
   */
  stackTimestamp?: number;
  /** edh-perms-1 (CR 614.6, 603.2e): set while a replacement makes tokens INSTEAD of a creation that entered them tapped: the replacing tokens enter tapped too (not "becomes tapped"). */
  insteadTapped?: true;
  controller: PlayerId;
  /** The effective program: chosen modes' programs concatenated in printed order (CR 700.2d), then the ability's own steps. */
  program: EffectProgram;
  stack: StackInfo | null;
  /** Per target spec id (unique across all chosen modes): chosen targets and their CR 608.2b legality. ONE legality check for the whole ability. */
  targets: Map<string, TargetSlot[]>;
  event: EventContext | null;
  bindings: Map<Name, Binding>;
  results: Map<Name, StepResult>;
  vars: Map<string, number>;
  /** p2-mana-1 INTERFACE CHANGE (additive): a mana ability run at once (no stack object): the X announced for its cost (rules/mana.ts#counterXPart, CR 107.3a). */
  manaX?: number;
  /** Iteration variable inside forEach. */
  iterating?: PlayerId | ObjHandle;
  /**
   * std-rq INTERFACE CHANGE (additive), CR 608.2d, 122.6: the one player who performs the instructions being run when that is not the controller: set by a `may` of
   * one other player ("that player may put a +1/+1 counter on ~") while its optional instructions run. Read by counters events (`by`); absent = the controller.
   */
  performer?: PlayerId;
  /** Set while a continuous effect's modifications are evaluated, for {ref:'subject'}. */
  subject?: ObjHandle;
  /**
   * FAST3 T13 INTERFACE CHANGE (additive): the values `chooseValue` chose during THIS resolution, by link id (CR 608.2d). The later steps of the same
   * resolution read them first (`effects/refs.ts#linkValue`, the `chosen` filter through `filterCtxOf`), so a choice counts even when the source left before
   * it could remember it (an ability whose cost sacrificed its source: CR 607.2d stores nothing on a new object, CR 400.7). Absent outside a resolution.
   */
  choices?: Map<string, LinkValue>;
}

export type StepHandler<S extends EffectStep = EffectStep> = (cx: ExecCtx, step: S) => StepResult;
export type OpHandlers = { [K in EffectOp]?: StepHandler<Extract<EffectStep, { op: K }>> };

/** An event the engine is about to perform, before replacement and prevention (CR 614.1, 616.1). */
export type Proposed =
  | {
    ev: 'damage'; source: ObjHandle; to: ObjHandle | PlayerId; amount: number; combat: boolean; unpreventable: boolean;
    /**
     * INTERFACE CHANGE (WP12): the damage proposals of ONE step share this ledger (one damage event, CR 120.3f, 702.15e). The performer passes this same
     * Map to `dealDamage` as `opts.lifelink` (kept when the event is modified), so lifelink life is collected instead of gained per recipient; the proposing
     * handler then proposes one `life` gain per lifelink source.
     */
    lifelink?: LifelinkLedger;
    /**
     * Cloud r5-repl INTERFACE CHANGE (additive): "instead that damage is dealt, but all other damage already dealt to him is healed" (the `healFirst` body,
     * effects/bodies/heal.ts, CR 614.1a): the damage already marked on the permanent the damage is dealt to is removed as this damage is dealt (performDamageEvent).
     */
    healFirst?: true;
  }
  /**
   * Cloud r3-repl INTERFACE CHANGE (additive): `cause`, the text the life log names ("damage from X" for the life loss damage causes, CR 120.3a; rules/damage.ts
   * proposes that loss through the life-loss funnel so effects that modify life loss apply to it, CR 614.1a).
   */
  | { ev: 'life'; change: 'gain' | 'loss'; player: PlayerId; amount: number; cause?: string }
  | { ev: 'draw'; player: PlayerId }
  /**
   * std-library-4 INTERFACE CHANGE (additive): a payment of life a player can make (rules/life.ts#payLife: a cost, a Phyrexian mana symbol, an effect's payment;
   * effects/proposal-kinds/pay-life.ts, CR 119.4, 614.1a), proposed before the life total changes. `cause` and `rules` are the log's.
   */
  | { ev: 'payLife'; player: PlayerId; amount: number; cause?: string; rules?: string[] }
  /** Cloud r3-repl INTERFACE CHANGE (additive): one player's mill of `count` cards, proposed before any card moves (effects/proposal-kinds/mill.ts, CR 701.17a, 614.1a). */
  | { ev: 'mill'; player: PlayerId; count: number }
  /** Cloud r4-repl INTERFACE CHANGE (additive): one player's draw of `count` cards, proposed before any card is drawn (effects/proposal-kinds/draw-many.ts, CR 121.2, 614.1a). */
  | { ev: 'drawMany'; player: PlayerId; count: number }
  /** Cloud r3-repl INTERFACE CHANGE (additive): a permanent's connive N, proposed before the keyword action's macro runs (effects/proposal-kinds/connive.ts, CR 701.50a, 614.1a). */
  | { ev: 'connive'; object: ObjHandle; player: PlayerId; n: number }
  /** Cloud r4-repl INTERFACE CHANGE (additive): one explore of a permanent, proposed before its process runs (effects/proposal-kinds/explore.ts, CR 701.44a, 614.1a). */
  | { ev: 'explore'; object: ObjHandle; player: PlayerId }
  /** p2-replace-events-2 INTERFACE CHANGE (additive): one proliferate of a player, proposed before it runs (effects/proposal-kinds/proliferate.ts, CR 701.34a, 614.1a). */
  | { ev: 'proliferate'; player: PlayerId }
  /** p2-replace-events-3 INTERFACE CHANGE (additive): one player's scry of N cards, proposed before they look (effects/proposal-kinds/scry.ts, CR 701.22a, 614.1a). */
  | { ev: 'scry'; player: PlayerId; count: number }
  /** `from` is null for a token entering as it is created (CR 111.1, 616.1g; WP11 review interface change, a widening). */
  | { ev: 'zoneChange'; object: ObjHandle; from: ZoneKind | null; to: ZoneKind; destination: DestinationFacts }
  /**
   * `token` is the id of a token `CardDef` already in `g.s.defs` (the handler adds it with `Game.addDef`). WP11 INTERFACE CHANGE (additive): `enter`, how each
   * token enters (tapped, with counters, attached: CR 111.4, 614.1c), applied together with the token's own "as it enters" replacements (CR 616.1g).
   */
  | { ev: 'createToken'; player: PlayerId; count: number; token: string; enter?: DestinationFacts; cause?: ProposalCause }
  /**
   * FAST5X E21 INTERFACE CHANGE (additive): `by`, the player who puts the counters (CR 122.6, 122.6a): the controller of the resolving spell or ability
   * (effects/handlers/lifedamage.ts#proposeMeasured), or, for counters a permanent enters with or a rule puts, its controller (effects/perform-events.ts).
   */
  | { ev: 'counters'; change: 'put' | 'removed'; on: ObjHandle | PlayerId; kind: string; count: number; cause?: ProposalCause; by?: PlayerId }
  /**
   * FAST5X E28 INTERFACE CHANGE (additive): `stateBased`, the destruction of a state-based action (lethal damage, deathtouch damage: CR 704.5g-h), not "as the
   * result of an effect" (a shield counter's replacement does not apply to it, CR 122.1c).
   */
  | { ev: 'destroy'; object: ObjHandle; canRegenerate: boolean; stateBased?: true }
  | { ev: 'step'; step: string; whose: PlayerId }
  // ---- M6-0 ADDITIONS (m6 design 2.4). Each kind has an entry in effects/registries.ts#PROPOSAL_KINDS; the four below are stubs (no capability, proposed by
  // nobody) until their owners land: phase/turn M6-1, turnFaceUp M6-3, transform M6-4.
  /** CR 614.10: a phase or a turn about to begin (proposed by core/turn.ts so "skip" can replace it). */
  | { ev: 'phase'; phase: TurnPhase; whose: PlayerId }
  | { ev: 'turn'; whose: PlayerId; extra: boolean }
  /** CR 116.2b, 614.1e, 708.8, 708.11: a face-down permanent being turned face up. `x`: CR 702.37f, 702.168e. */
  | {
    ev: 'turnFaceUp'; object: ObjHandle; via: 'morph' | 'megamorph' | 'disguise' | 'manifest' | 'cloak' | 'effect'; x?: number; megamorphPaid?: boolean;
    /**
     * FAST5X E25 INTERFACE CHANGE (additive): the player who turns it face up: the one taking the special action, or the controller of the effect (CR 608.2,
     * 116.2b). The event's player ("you turned a permanent face up this turn", CR 603.4); absent = the permanent's controller.
     */
    by?: PlayerId;
    /**
     * M6-3 INTERFACE CHANGE (additive): the `during` replacement bodies applied to this event ("As this permanent is turned face up, ...", CR 614.1e, 708.11),
     * in the order they were applied; its performer runs their steps while the permanent is being turned face up, before anything can see the result.
     */
    during?: DuringApplied[];
  }
  /** CR 701.27, 701.28, 712.20: a permanent about to transform or convert (to the other face). */
  | {
    ev: 'transform'; object: ObjHandle; convert: boolean;
    /**
     * M6-4 INTERFACE CHANGE (additive, as M6-3's `turnFaceUp.during`): the `during` bodies applied to this event ("As this permanent transforms into ~, ...",
     * CR 712.20), run by the performer while the permanent is transforming. `dayNight`: the transform is the daybound or nightbound one (CR 702.145b-c, e-f),
     * the only kind a permanent with daybound or nightbound can make (core/day-night.ts).
     */
    during?: DuringApplied[]; dayNight?: boolean;
  };

/** M6-3: one applied `during` body (effects/bodies/during.ts): its steps, read in the context of the replacement effect's source and controller. */
export interface DuringApplied {
  steps: EffectStep[];
  source: ObjHandle;
  controller: PlayerId;
}

/**
 * M6-0 (m6 design 2.4), CR 614.16, 122.6: who puts the counters / creates the tokens. Absent = 'effect' (every M5 call-site is an effect). The lore counter of
 * CR 714.3c is 'rule'; the one a Saga enters with (CR 714.3a, a replacement effect) is 'replacement'; counters put as a cost are 'cost' once costs propose them.
 * A pattern with `byEffect` matches only 'effect' and 'replacement' (M6-1).
 */
export type ProposalCause = 'effect' | 'replacement' | 'rule' | 'cost';

/**
 * M6-0 (m6 design 2.4), M6-1 (E2, D3): the replacement effects already applied to an event and to the events that replace it (CR 614.5), per BRANCH.
 * Transient, on `Game` (core/game.ts#Game.chain), never in state. A proposal made while `g.chain` is set starts from `new Set(g.chain.used)`; a body applied
 * in that proposal that proposes events sets `g.chain = { used: <that proposal's set>, parent: g.chain }` around them (try/finally). Nothing sets it before M6-1.
 * (Declared in core/game.ts, which may not import this module's types; re-exported here, where the contract belongs.)
 */
export type { ReplacementChain } from '../core/game';

/**
 * M6-0 (m6 design 2.4), M6-1 (D4): several events that happen at the same time. First the CR 615.7 division of every amount-budget shield (prevent N, redirect
 * N) among them (effects/funnels.ts#divideShields, `shares`), then the CR 616.1 choices in APNAP order of the affected players, then all are performed.
 */
export type ProposeSimultaneous = (g: Game, events: Proposed[]) => (Performed | null)[];

export interface DestinationFacts {
  /** FAST5 T36: the controller of the spell or ability whose effect performs a discard (`zoneChange.byOpponent`, CR 701.9a); absent for a cost, the cleanup step or a rule. */
  causedBy?: PlayerId;
  tapped?: boolean;
  /** trek-8 (CR 614.1c, 508.4): it enters as an attacking creature (effects/perform-events.ts#applyEnterFacts). */
  attacking?: boolean;
  faceDown?: boolean;
  controller?: PlayerId;
  counters?: { kind: string; count: number }[];
  /** Filled by an "enters as a copy" replacement (CR 614.12, 616.1c). */
  copyOf?: ObjHandle;
  // WP11 INTERFACE CHANGE (additive, all optional): what the performer needs to carry out the move (core/zones.ts#moveObject's options) and the rest of
  // what an `enters` body decides as the object enters (CR 614.1c-d, 614.12, 607.2d).
  /** Library position: top (default), bottom, or an index from the top (CR 401.3). */
  position?: 'top' | 'bottom' | number;
  /** "Shuffle it into its owner's library" (CR 701.24a, 701.24c): put into the library, then that library is shuffled (WP11 review, additive). */
  shuffle?: boolean;
  /** The face that enters (modal double-faced cards, CR 712.12). */
  face?: number;
  /** Why it moves, for the log and the trigger normalizer ("destroy", "resolve", "sacrifice", ...). */
  cause?: string;
  /** Choices made as it enters, stored in the new object's link store (CR 614.12a, 607.2d). */
  chosen?: { link: string; values?: string[]; players?: PlayerId[]; objects?: ObjHandle[] /* std-cardcopy-3: cards exiled as it enters, CR 607.2a */ }[];
  /** It enters attached to this object or player (CR 303.4f, 614.1c). */
  attachTo?: ObjectId | PlayerId;
  /** It enters with these abilities (CR 614.1c): granted by a layer 6 effect on the new object. */
  abilities?: AbilityDef[];
  /** std-freecast-2 (CR 614.1c, 205.1b): it enters as these subtypes in addition to its other types: a layer 4 effect on the new object. */
  subtypes?: string[];
  // ---- M6-0 ADDITIONS (m6 design 2.4; written by the ENTERS_PARTS / DESTINATION_PARTS of their owners, carried by core/zones.ts#MoveOptions.enter) ----
  /** CR 712.14a, 616.1d: it enters with its back face up (M6-4). */
  transformed?: boolean;
  /** CR 708.3, 701.40a: it enters face down with this status (replaces the bare `faceDown` flag on the battlefield; M6-3). */
  faceDownInfo?: FaceDownInfo;
  /** CR 707.9: the exceptions of an "enters as a copy" effect (with `copyOf`); CR 707.9e additional effects separately (M6-2). */
  copyExcept?: CopyExcept[];
  copyAdditional?: { if?: ObjectFilter; counters: CounterSpec[] }[];
  /** pc-tokens-2: how long the copy effect of `copyOf` lasts (CR 611.2); for good when absent ("enters as a copy"). */
  copyDuration?: Duration;
  /** CR 722.3a: it enters prepared (M6-6). */
  prepared?: boolean;
  /**
   * M11-1 INTERFACE CHANGE (additive), CR 903.9c: the moving permanent is melded or merged and its owner put its commander into the command zone (CR 903.9b):
   * this card goes to the command zone (cause 'commander') while the permanent and its other components go to the event's zone
   * (core/move-parts/components.ts reads it from `MoveOptions.enter`).
   */
  commanderCard?: CardId;
}

/** One replacement or prevention effect that currently applies (CR 616.1). */
export interface ApplicableReplacement {
  id: string;
  def: ReplacementDef;
  source: ObjHandle;
  /** CR 616.1a-e priority class: 0 self-replacement, 1 control, 2 copy, 3 back face, 4 everything else. */
  klass: 0 | 1 | 2 | 3 | 4;
}

/** The single funnel through which EVERY state-changing op acts (no handler mutates zones, life, damage or counters directly). */
export type Propose = (g: Game, e: Proposed) => boolean;

/**
 * INTERFACE CHANGE (WP12): whether a "can't" effect forbids the event (CR 614.17, 101.2), the check `propose` makes before any replacement (design 8.3
 * sketch). A handler asks it when an action is impossible as a whole if one of its parts is: moving counters removes nothing when the put can't happen
 * (CR 122.5). Pure: it changes nothing.
 */
export type Forbidden = (g: Game, e: Proposed) => boolean;

/** Entry point called by core/resolve.ts for the top object of the stack. Replaces the manual-only body of resolveSpell/resolveAbility. */
export type ResolveStackObject = (g: Game, obj: GameObject) => void;

