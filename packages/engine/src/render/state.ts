/**
 * The mutable state of one rendering pass (WP2): which things the text has already named (so a second mention is an anaphor: "it", "that
 * creature"), which target specs exist, what the trigger exposes, who is the subject of the clause being written.
 *
 * State is per ability and never shared between abilities (anaphora does not cross abilities). It is NOT part of the model: it only decides which
 * words the renderer prints, and the words it is unsure about are alternative groups (render/text.ts).
 */
import type { AbilityDef, Condition, EventPattern, ObjRef, PlayerRef, TargetSpec } from '../types/ability';
import type { RenderContext } from './api';
import type { Person } from './text';

/** What the renderer remembers about something that was named. */
export interface RefInfo {
  /** Singular head nouns usable in "that <noun>" ("creature", "card", "permanent"). The first is the preferred one. */
  nouns: string[];
  plural: boolean;
  /** A player rather than an object. */
  player?: boolean;
  /**
   * std-combat-1 ADDITION (optional), CR 603.12, 608.2c: on a move's result (`r:<name>`), the binding of the objects it moved, the choice whose objects it put onto the
   * battlefield ("you may put any number of Equipment cards from among them onto the battlefield", render/fold.ts#putAnyFromGroup): a reflexive trigger that waits for what
   * it moved ("When you put one or more Equipment onto the battlefield this way, ...") names them "them" (render/steps-lasting.ts#reflexive makes them its focus).
   */
  movedBinding?: string;
  /** The binding of an optional choice: a `did` guard on it adds no words (the anaphor "that creature" already presupposes the choice). */
  optional?: boolean;
  /** Extra whole phrases an anaphor to this thing may use ("one pile", "the other pile"). */
  alts?: string[];
  /**
   * FAST4 T19 ADDITION (optional): the two nouns of a thing that is "a creature or planeswalker" (a target of exactly two card types, CR 115.1): an anaphor may
   * also name it by both, "that creature or planeswalker", when each of them names it uniquely (refs.ts#anaphor).
   */
  orNouns?: [string, string];
  /**
   * FAST4 T19 ADDITION (optional): the binding is what a step acted on, said by a participle phrase after a noun of a filter ("a creature dealt damage this
   * way", CR 608.2c): `{is: <this binding>, ...filter}` prints as the filter's noun phrase followed by these words (np.ts#build).
   */
  thisWay?: string;
  /** Where the thing came from when it was found or revealed ("library", "graveyard"): the verb of moving it follows (CR 400.3). */
  zone?: string;
  /** The player who acted, for a binding that records whether they did ("if you do", "if that player does"). */
  actor?: string | null;
  /** r4-moved ADDITION (optional): the binding records an option of yours whose first instruction searches your library ("If you search your library this way", render/cond.ts). */
  searched?: true;
  /** std-combat-2 (CR 118.12, 608.2d): a payment made a chosen number of times (`pay.upTo`): its count is "that many" of the modes after it (render/program.ts#modeHeader). */
  paidUpTo?: true;
  /** std-rx32 ADDITION (optional): the binding of an attach of targets (CR 701.3a): "one or more <noun> become attached to <to> this way" (render/steps-lasting.ts#reflexive). */
  attachedThisWay?: { noun: string; to: ObjRef };
  /** std-rq ADDITION (optional): the binding records whether any one player of a group did it ("any opponent may ...": "if a player does", render/cond.ts). */
  anyOne?: true;
  /** std-rx31 ADDITION (optional): the binding records whether you cast a spell you were offered to cast ("You may cast it. Otherwise, ...", render/steps-flow.ts). */
  castOption?: true | 'inIf';
  /** pc-tokens-1 ADDITION (optional), CR 608.2d, 101.4: the binding records which players of a group did the optional action of "each opponent may ..." ("For each opponent who does, ...", render/steps-flow.ts#repeat). */
  eachMay?: 'opponent' | 'player';
  /** std-rx31 ADDITION (optional): the binding records a move of the one card a choice revealed ("If you didn't put the revealed card onto the battlefield this way", render/cond.ts). */
  revealedPut?: true;
  /**
   * FAST2 T10: the key of the thing this binding is the new form of ("exile target creature ... return that card": the card in exile is the target that
   * moved, CR 400.7). The two are one antecedent for the unique-candidate rule (refs.ts#antecedents), so "it" may name either.
   */
  sameAs?: string;
  /**
   * cmd1 (CR 608.2f; the parser's rule, parser/lower/anaphora.ts, Mention.iterates): the player of the current iteration of "for each opponent" / "for each player":
   * "that opponent" names it inside the body whatever other player was named (the idiom). trek-8 (CR 608.2f): also the object of the current iteration of "for each
   * creature ...": "that creature" names it inside the body, whatever other creature an earlier sentence named ("... create a token that's a copy of that creature").
   */
  iterates?: string | readonly string[];
  /**
   * FAST5 T46 ADDITION (optional): the binding is a whole hand a step revealed or looked at (CR 701.20a, 701.20e): "You choose a nonland card from it" says "it" for
   * it (steps-flow.ts#chooseObjects, written by steps-cards.ts reveal and look).
   */
  hand?: boolean;
  /**
   * trek-3 ADDITION (optional): the player whose hand it is (the `owner` of the hand a step revealed or looked at, as JSON), on the binding of the whole hand and on the
   * binding of the one card "You may choose a nonland card from it" chose there (steps-cards.ts reveal and look, steps-flow.ts#chooseObjects). That player is the one who
   * "exiles that card" in Oracle's "If you do, that player exiles that card, then draws a card" (render/fold-trek3.ts).
   */
  handOwner?: string;
  /**
   * std-ro ADDITION (optional): the binding is the top cards of a library a `reveal` step revealed (not only looked at): they are also "<cards> revealed this way"
   * (fold.ts#putAllFromGroupAndRest, written by steps-cards.ts reveal).
   */
  revealedTop?: true;
  /**
   * std-rx1 ADDITION (optional): the binding is the cards a choice among a group in a library chose and a reveal then revealed ("You may reveal up to two creature
   * and/or land cards from among them"): they are also "<cards> revealed this way" (fold.ts#putAllRevealedSplit, written by fold.ts#chooseUpToFromGroupThenReveal).
   */
  revealedChosen?: true;
  /**
   * Cloud C7 ADDITION (optional): the binding is a named instruction that reports what it moved (effects/api.ts#StepResult.before), of this kind: "for each creature
   * destroyed this way", "if a creature card was exiled this way" (render/moved.ts). Written by the step renderers under `r:<name>`.
   */
  moved?: MovedKind;
  /**
   * audit-fix-1 ADDITION (optional): for a `sacrificeChoice` binding, who sacrificed (its `who`, as JSON): "another" after it excludes only what you sacrificed
   * (render/fold-stdlibrary2.ts#returnAnotherThanSacrificed; written by render/steps-zones.ts#sacrificeChoice).
   */
  sacrificedBy?: string;
  /**
   * C6 ADDITION (optional): the binding is the players of a group who can't do what a step told each of them (`cantAs`, CR 101.3): printed "each <noun> who can't"
   * as a subject and "<noun> who can't" after "for each" (render/refs.ts#player, render/steps-flow.ts forEach; written by render/steps-util.ts#bindCant).
   */
  cant?: 'opponent' | 'player';
  /**
   * trek-7 ADDITION (optional): the binding is every card an `exileUntil` exiled (`exiled`, CR 406.1), and this is who exiled them: "They put the rest on the bottom in a
   * random order" says that player (render/steps-zones.ts#move, written by steps-cards.ts exileUntil). Not an antecedent of its own (the parser's rest mention is
   * participle-only, parser/lower/mentions.ts#exiledRestOf).
   */
  exiledBy?: PlayerRef;
}

/** std-tla: the info key (RenderState.info) of a mill step's name, for "<card> milled this way" (render/cond.ts#existsPhrase; set by steps-cards.ts and fold.ts). */
export const MILLED_KEY = 'milled:';

/** Cloud C7: the kinds of instruction a "<participle> this way" names (parser/holes/moved-words.ts#MovedKind; render may not import the parser). */
export type MovedKind = 'destroyed' | 'exiled' | 'discarded' | 'sacrificed' | 'graveyard' | 'battlefield' | 'hand' | 'top';

export interface RenderState {
  ctx: RenderContext;
  /** Things named so far, by key (see `objKey`, `playerKey`). */
  mentioned: Set<string>;
  info: Map<string, RefInfo>;
  /** Target specs of the ability by id (including the ones inside modes and reflexive triggers). */
  specs: Map<string, TargetSpec>;
  /** The events of the trigger being rendered, for `{ref:'event'}` references. */
  trigger: EventPattern[] | null;
  /** Key of the player who is the subject of the clause being written ('you', 'ctrl:t:t0', ...), or null when it is the controller by default. */
  actor: string | null;
  /** FAST2 T10: the identity of a thing the reference being written cannot be ("attach ~ to it": not ~ itself, CR 301.5c), so it is no other antecedent. */
  notAntecedent?: string;
  /**
   * r5-fxb (the parser's rule, parser/lower/anaphora.ts#damageAmountSource): the key of the target that deals the damage whose amount is being written: a bare
   * pronoun for it is valid whatever else was named ("Target creature you control deals damage equal to its power to that permanent", CR 120.1, 608.2h).
   */
  ownSubject?: string;
  /** FAST2 T10: the reference being written is what "sacrifice" or "destroy" acts on: a permanent, never a spell or ability (CR 701.8a, 701.21a). */
  permanentOnly?: boolean;
  /**
   * std-exile-play-1-2 ADDITION (optional): the reference being written is the object of a power or toughness ("equal to its power"): an instant or sorcery has
   * neither (CR 208.1, 208.3), so the instant or sorcery itself is never what "its" names there (refs.ts#candidateCheck; the parser never makes the damage source
   * of a spell a mention, parser/lower/mentions.ts#namedObjects). Set by render/qty.ts#statPhrase.
   */
  powerOf?: boolean;
  /**
   * std-rw9 (the parser's rule, parser/lower/anaphora.ts, CR 701.21a, 115.4): the reference being written is what "sacrifice" acts on: a permanent its controller
   * controls, so a target that may be a player ("any other target") is no antecedent of it.
   */
  sacrificeOnly?: boolean;
  /** Cloud std-fin: the reference being written is what "unattach" moves: an attached Aura, Equipment or Fortification, never a creature (CR 701.3d, 301.5c). */
  attachmentOnly?: boolean;
  /**
   * FAST3 T18 ADDITION (optional): the trigger being rendered is a batch ("one or more", CR 603.2c): its object roles stand for a group, "those creatures" /
   * "them" (parser/lower/scope.ts#eventMentions reads them as plural mentions).
   */
  triggerBatch?: boolean;
  /**
   * std-rx11 (the parser's rule, parser/lower/anaphora.ts#resolveAnaphor with Mention.forTarget; CR 201.5, 603.7c): a delayed trigger is being rendered inside the
   * object's own "enters" trigger, so a bare pronoun for a target of that ability (or what its event or a move made of it) is never the object itself.
   */
  inOwnEnters?: boolean;
  /** Standard round 5, r5-trig: ... and one occurrence for the whole batch (TriggerDef.wholeBatch): its objects are a group even where one occurrence is one object. */
  triggerWholeBatch?: boolean;
  /**
   * std-ry3: while a resolved replacement effect is rendered (`trigger` is then its replaced event, design 3.5), the events of the ability that creates it. A
   * reference to the triggering event inside the replaced event's own pattern is fixed as the effect is created (effects/handlers/lasting-fix.ts, COND mode:
   * "Whenever ~ deals combat damage to a player, that player skips their next untap step", CR 614.10a); only the pattern reads it, never the body.
   */
  outerTrigger?: EventPattern[];
  /** FAST5 T62 (CR 603.4): the intervening "if" of the triggered ability being rendered, which "the difference" of its effect stands for (render/qty.ts). */
  interveningIf?: Condition;
  /** Cloud std-fin (CR 608.2c): the condition of the `if` step whose branch is being rendered, which "the difference" inside it may stand for too (render/qty.ts). */
  stepIf?: Condition;
  /** Values named by `let` steps: the phrase printed at the first use. */
  vars: Map<string, { phrase: string; used: boolean }>;
  /** Depth of quotes (an ability inside an ability has its own self scope). */
  depth: number;
  /** Set by a triggered ability for its effect: the next clause is the first thing after the trigger condition (CR 603.4). Consumed by `clause()`. */
  afterTrigger: boolean;
  /** Set by `clause()` for an `if` step that stands right after a trigger condition: it must not print as an intervening if. Consumed by the `if` clause. */
  leadingIf: boolean;
  /** Ids of the target specs the text has named (shared by every copy of the state: a spec used in any reading is used). */
  used: Set<string>;
  /** Conditions the text has printed, as JSON (shared like `used`): a target spec with `onlyIf` is announced only if its condition is in the text. */
  conds: Set<string>;
  /** Depth of step lists inside step lists (render/steps.ts caps it: every level can multiply the text by the number of its alternative readings). */
  nest: number;
  /**
   * FAST1 T4 ADDITION (optional): set by an activated ability that functions only in its owner's graveyard (`zone: ['graveyard']`, CR 113.6m): there the
   * object itself is a card in that graveyard, so moving it reads "~ from your graveyard" as well as "~". r4-fxz: 'hand' for an activated ability that functions
   * only in its owner's hand ("Put this card from your hand onto the battlefield", CR 113.6m).
   */
  selfZone?: 'graveyard' | 'hand';
  /**
   * FAST3 T13 ADDITION (optional): set by the fold of a `chooseValue` made as the ability resolves (render/fold.ts#choiceThenEffect) for the one effect after
   * it: the link of that choice and how the text names it ("creature type", "basic land type"). The noun phrase ("creatures of the creature type of your
   * choice") and the type change ("becomes the creature type of your choice") read it and count their uses, so the fold applies only when the text says it.
   */
  choiceWords?: Map<string, { words: string; quality: string; used: number }>;
  /**
   * FAST5 T69 ADDITION (optional): the JSON of a calculated quantity that the text names "x" in a target count ("up to X target creatures you control get +X/+X until
   * end of turn, where X is the number of colors among permanents you control", CR 107.3c, 601.2c): set by the lasting effect that says it (steps-lasting.ts), read
   * by the count words of a target phrase (refs.ts#countWord).
   */
  xCount?: string;
  /**
   * std-rx5 ADDITION (optional): the activated ability being written pays "Remove any number of <kind> counters from ~" (CostPart `anyNumber`): its X is that
   * number, which the effect calls "that many" / "that much" (render/qty.ts; set by render/abil.ts#activated).
   */
  anyNumberX?: true;
  /**
   * p2-mana-1 ADDITION (optional): the activated ability being written pays "Remove any number of <kind> counters from ~" or "Remove X <kind> counters from ~": its
   * X is the number of those counters, which a "for each" of the effect calls "for each <kind> counter removed this way" (render/qty.ts#countParts).
   */
  costCountersX?: string;
  /**
   * p2-counters-move-2 ADDITION (optional): the activated ability being written pays "Remove all <kind> counters from ~" (CostPart `all`): its X is printed
   * nowhere, so the effect names it "the number of <kind> counters removed this way" (render/qty.ts; set by render/abil.ts#activated).
   */
  costAllCountersX?: string;
  /**
   * FAST5 T76 ADDITION (optional): the key (`objKey`) of the focus of the instruction being written: the token the instruction right before it created or the
   * object it put counters on (parser/lower/anaphora.ts#focusOf, CR 608.2c). A bare pronoun for that object is a unique reading even if another object of the
   * same kind was named before ("create a token. Put a +1/+1 counter on it"). Set by render/steps.ts#clausesOf, read by refs.ts#candidateCheck.
   */
  focus?: string;
  /**
   * std-ra (CR 603.12, 608.2c): inside a reflexive trigger that waits for what an instruction moved ("When you discard one or more nonland cards this way, ..."),
   * the count of those objects (`{step, which}` of its condition, as JSON): "that many" there names it (render/refs.ts#countWord). Set by
   * render/steps-lasting.ts#reflexive.
   */
  movedThatMany?: string;
  /**
   * std-exile-play-1-1 ADDITION (optional): the key (`playerKey`) of the player who looked at the top card of a library and exiled it face down ("its controller looks at
   * the top card of that opponent's library and exiles it face down", render/fold.ts#playerLooksThenExilesFaceDown): "they" names that player in the instruction that
   * lets them play the card (the parser's impulse idiom, parser/lower/anaphora.ts#impulseIdiom), whatever other player was named. Read by refs.ts#candidateCheck.
   */
  theyFocus?: string;
  /** FAST5 T76 ADDITION (optional): the antecedents (render/refs.ts#antecedentIds) named when the instruction being written began: the focus is honored only while no other one has been named since (a "~" in the instruction's own condition, a target of its own). */
  focusSeen?: Set<string>;
  /** FAST5 T76 ADDITION (optional): the description (JSON of the filter) of the group the last pump or grant gave a continuous effect (model/focus.ts#grantedGroup): the same description again is also "them" / "those creatures" (refs.ts, case each). */
  group?: string;
  /**
   * Cloud std-eoe ADDITION (optional): the target a sentence of its own announced before the instructions ("Choose up to one target creature. That creature ...",
   * render/program.ts; the parser's rule, parser/lower/anaphora.ts#chosenFocus): its key, and the step list whose FIRST instruction it is the focus of. Any
   * reference to it there is a unique reading (refs.ts#candidateCheck); render/steps.ts#clausesOf drops it after that instruction.
   */
  chosen?: { key: string; list: readonly unknown[] };
  /**
   * std-rx10 ADDITION (optional): the two object targets a sentence of their own announced together ("Choose target creature you control and target creature you don't
   * control.", render/program.ts#chosenPair): a fight of the one with the other is also "those creatures fight each other" (render/steps-life.ts#fight).
   */
  chosenPair?: { a: string; b: string; noun: string };
}

/** Cloud std-eoe: the words of the cards a destroy or sacrifice of a group put into graveyards (RefInfo.thisWay; render/steps-zones.ts, render/np.ts). */
export const PUT_INTO_GRAVEYARD_THIS_WAY = 'put into a graveyard this way';

/** The public context plus the hidden state, so a public renderer called with a context from an earlier call continues the same pass. */
export type StatefulContext = RenderContext & { st?: RenderState };

export function newState(ctx: RenderContext): RenderState {
  return { ctx, mentioned: new Set(), info: new Map(), specs: new Map(), trigger: null, actor: null, vars: new Map(), depth: 0, nest: 0, afterTrigger: false, leadingIf: false, used: new Set(), conds: new Set() };
}

/** The state of a pass: the one hidden in the context if there is one, otherwise a fresh one. */
export function stateFor(ctx: RenderContext): RenderState {
  const c = ctx as StatefulContext;
  if (c.st) return c.st;
  return newState(ctx);
}

/** A fresh state for an ability inside an ability (a quoted granted ability, a token's ability): its own anaphora and self scope. */
export function nestedState(st: RenderState): RenderState {
  return { ...newState(st.ctx), depth: st.depth + 1, nest: st.nest };
}

export function cloneState(st: RenderState): RenderState {
  return {
    ctx: st.ctx,
    mentioned: new Set(st.mentioned),
    info: new Map(st.info),
    specs: new Map(st.specs),
    trigger: st.trigger,
    actor: st.actor,
    vars: new Map([...st.vars].map(([k, v]) => [k, { ...v }])),
    depth: st.depth,
    nest: st.nest,
    afterTrigger: st.afterTrigger,
    leadingIf: st.leadingIf,
    used: st.used,
    conds: st.conds,
    ...(st.selfZone !== undefined ? { selfZone: st.selfZone } : {}),
    ...(st.triggerBatch === true ? { triggerBatch: true } : {}),
    ...(st.triggerWholeBatch === true ? { triggerWholeBatch: true } : {}),
    ...(st.outerTrigger !== undefined ? { outerTrigger: st.outerTrigger } : {}),
    ...(st.interveningIf !== undefined ? { interveningIf: st.interveningIf } : {}),
    ...(st.stepIf !== undefined ? { stepIf: st.stepIf } : {}),
    ...(st.xCount !== undefined ? { xCount: st.xCount } : {}),
    ...(st.focus !== undefined ? { focus: st.focus } : {}),
    ...(st.theyFocus !== undefined ? { theyFocus: st.theyFocus } : {}),
    ...(st.focusSeen !== undefined ? { focusSeen: st.focusSeen } : {}),
    ...(st.group !== undefined ? { group: st.group } : {}),
    ...(st.chosen !== undefined ? { chosen: st.chosen } : {}),
    ...(st.chosenPair !== undefined ? { chosenPair: st.chosenPair } : {}),
    ...(st.costAllCountersX !== undefined ? { costAllCountersX: st.costAllCountersX } : {}), // p2-counters-move-2
  };
}

/** Folds what a variant mentioned into the state that continues (the union: any variant naming a thing makes it a known thing afterwards). */
export function absorb(into: RenderState, other: RenderState): void {
  for (const k of other.mentioned) into.mentioned.add(k);
  for (const [k, v] of other.info) if (!into.info.has(k)) into.info.set(k, v);
  for (const [k, v] of other.vars) {
    const mine = into.vars.get(k);
    if (!mine) into.vars.set(k, { ...v });
    else if (v.used) mine.used = true;
  }
}

/** Renders `fns` on copies of the state and returns their results; the continuing state absorbs all of them. */
export function withVariants<T>(st: RenderState, fns: ((s: RenderState) => T)[]): T[] {
  const out: T[] = [];
  const copies: RenderState[] = [];
  for (const fn of fns) {
    const s = cloneState(st);
    out.push(fn(s));
    copies.push(s);
  }
  for (const s of copies) absorb(st, s);
  return out;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** The key under which a reference is remembered, or null for a reference that cannot be named again ("each creature", "the top card"). */
export function objKey(ref: ObjRef): string | null {
  switch (ref.ref) {
    case 'self': return 'self';
    case 'target': return `t:${ref.id}`;
    case 'bound': return `b:${ref.name}`;
    case 'event': return `e:${ref.role}`;
    case 'attachedTo': return 'attached';
    case 'linked': return `l:${ref.link}`;
    case 'subject': return 'subject';
    case 'costSacrificed': return 'costSacrificed'; // FAST3 T18
    case 'costDiscarded': return 'costDiscarded'; // CLOUD C8
    case 'costExiled': return ref.self ? null : 'costExiled'; // CLOUD C8
    default: return null;
  }
}

export function playerKey(ref: PlayerRef | 'you' | 'opponent' | 'any'): string | null {
  if (ref === 'you') return 'you';
  if (ref === 'opponent') return 'opp';
  if (ref === 'any') return null;
  switch (ref.ref) {
    case 'you': return 'you';
    case 'target': return `t:${ref.id}`;
    case 'controllerOf': {
      const k = objKey(ref.object);
      return k === null ? null : `ctrl:${k}`;
    }
    case 'ownerOf': {
      const k = objKey(ref.object);
      return k === null ? null : `own:${k}`;
    }
    case 'anOpponent': return 'opp';
    case 'event': return `e:${ref.role}`;
    case 'bound': return `b:${ref.name}`;
    case 'linked': return `l:${ref.link}`;
    case 'active': return 'active';
    case 'defending': return 'defending';
    case 'iterating': return 'iter';
    case 'seat': { // M12-1 (m12 design D6): "the player to your left" is named again as "that player"
      const of = ref.of === undefined ? 'you' : playerKey(ref.of);
      return of === null ? null : `seat:${ref.side}:${of}`;
    }
    default: return null;
  }
}

/** A phrase with its grammatical number/person, for choosing verbs. */
export interface Phrase {
  text: string;
  plural: boolean;
  /** Grammatical person for verb agreement. */
  person: Person;
  /**
   * FAST2 T8: an earlier-named player that the singular pronoun "they" (with a plural verb) also names uniquely: "whenever an opponent draws a card, they
   * lose 2 life" (render/steps-util.ts#byPlayer offers it).
   */
  they?: boolean;
}

export type Form = 'subject' | 'object' | 'possessive';

export function personOf(plural: boolean, you = false): Person {
  return you ? 'you' : plural ? 'pl' : 'sg';
}

/** Collects every target spec of an ability (hoisted ones, the ones inside modes and inside reflexive steps). */
export function collectSpecs(def: { effect?: { targets: TargetSpec[]; modes?: { options: { program: { targets: TargetSpec[]; steps: unknown[] } }[] }; steps: unknown[] } }, into: Map<string, TargetSpec>): void {
  const visitProgram = (p: { targets: TargetSpec[]; modes?: { options: { program: { targets: TargetSpec[]; steps: unknown[] } }[] }; steps: unknown[] }): void => {
    for (const t of p.targets) into.set(t.id, t);
    for (const o of p.modes?.options ?? []) visitProgram(o.program as never);
    visitSteps(p.steps);
  };
  const visitSteps = (steps: unknown[]): void => {
    for (const s of steps) {
      const step = s as { op?: string; targets?: TargetSpec[]; do?: unknown[]; then?: unknown[]; else?: unknown[]; otherwise?: unknown[]; onWin?: unknown[]; onLose?: unknown[]; table?: { do: unknown[] }[] };
      if (step.op === 'reflexive' || step.op === 'delay') for (const t of step.targets ?? []) into.set(t.id, t); // std-tdm: a delayed trigger's own targets
      if (step.op === 'reflexive') for (const o of (step as { modes?: { options: { program: unknown }[] } }).modes?.options ?? []) visitProgram(o.program as never); // r5-cost: a reflexive trigger's modes
      for (const list of [step.do, step.then, step.else, step.otherwise, step.onWin, step.onLose]) if (Array.isArray(list)) visitSteps(list);
      for (const row of step.table ?? []) visitSteps(row.do);
    }
  };
  if (def.effect) visitProgram(def.effect as never);
  // std-promote-3 (CR 603.12a): the reflexive trigger of a static rule's `then` ("You may exert ~ as it attacks. When you do, ... target ...") has its own targets
  for (const e of (def as { effects?: { then?: { do?: unknown[] } }[] }).effects ?? []) if (Array.isArray(e.then?.do)) visitSteps(e.then.do);
}

/** The abilities of an ability definition's own nested lists (class levels, level brackets), for tests and the gate. */
export function childAbilities(def: AbilityDef): AbilityDef[] {
  return def.kind === 'classLevel' || def.kind === 'levelBracket' ? def.abilities : [];
}
