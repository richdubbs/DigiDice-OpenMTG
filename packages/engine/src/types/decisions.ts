/**
 * Decisions: everything the game asks a player. Exactly one decision is pending at a time
 * (GameState.pending). Priority is also a decision, so UIs and bots have one place to look.
 */
import type { CardId, ObjectId, PlayerId } from './ids';
import type { TargetChoice } from './state';
import type { ManaType } from './mana';
import type { Duration, ObjectFilter } from './ability';

interface DecisionBase {
  /** Unique id; answers must quote it. */
  id: string;
  player: PlayerId;
  prompt: string;
  /** Comprehensive Rules citations explaining why this is being asked. */
  rules?: string[];
  /** If true the player may cancel, reversing the whole action (CR 733.1). */
  cancellable?: boolean;
  /**
   * M12-1 INTERFACE CHANGE (additive, optional; m12 design 4.5): who would ask this and why, for the CR 800.4f-h guard of `Game.choose` (M12-2) when the
   * player asked has left the game. Absent: a rule's choice (CR 800.4h: the next player in turn order chooses). `cost`: a cost that player would pay is not
   * paid (CR 800.4f). `choice`: a choice an object would have that player make goes to `controller`, the object's controller (CR 800.4g). `opponentChoice`:
   * the same, but it was an opponent's choice, so `controller` picks another opponent instead (CR 800.4g). Stamped by M12-2 (the effect runner's choose
   * wrapper and cost payment); nothing writes it before, and nothing reads it in a two-player game.
   */
  asker?: DecisionAsker;
  /**
   * std-control-3 INTERFACE CHANGE (additive, optional): the player who answers this decision for `player`, who is controlled (CR 723.5: "you control target
   * opponent during their next turn"; core/player-control.ts). The answer still names `player` (`Action.player`); a transport accepts it from this player's
   * seat (`mayActAs`). Absent: `player` answers.
   */
  decidedBy?: PlayerId;
}

/** M12-1 (m12 design 4.5): the asker of a decision (`DecisionBase.asker`; CR 800.4f-h). */
export interface DecisionAsker {
  kind: 'cost' | 'choice' | 'opponentChoice';
  /** The controller of the spell, ability or object that asks (CR 800.4g: the choice goes to them, or to another opponent they pick). */
  controller: PlayerId;
}

/** The player has priority (CR 117). Answer with a priority action, not an `answer`. */
export interface PriorityDecision extends DecisionBase { kind: 'priority' }

/** CR 103.1: the chosen player decides who takes the first turn. */
export interface PlayFirstDecision extends DecisionBase { kind: 'playFirst'; options: PlayerId[] }

/** CR 103.5: keep or take a mulligan. */
export interface MulliganDecision extends DecisionBase { kind: 'mulligan'; handSize: number; mulligans: number }

/** Choose objects from a list (discard, sacrifice, put on bottom, search, ...). */
export interface ChooseObjectsDecision extends DecisionBase {
  kind: 'chooseObjects';
  options: ObjectId[];
  min: number;
  max: number;
  /** If true the answer's order matters (e.g. "in any order"). */
  ordered?: boolean;
  /**
   * FAST5 T66 INTERFACE CHANGE (additive): the objects chosen together must keep a total ("up to two creature cards with total mana value 4 or less", CR 608.2d,
   * 115.1): the sum of `values` (the statistic of each option, read as the choice is offered) compared with `value` by `op`. An answer that breaks it is
   * rejected (core/validate.ts); a bot or UI picks a set that keeps it (`chooseObjectsLimitHolds`).
   */
  limit?: { stat: 'power' | 'toughness' | 'manaValue'; op: '<=' | '>=' | '==' | '!=' | '<' | '>'; value: number; values: Record<ObjectId, number> };
}

export interface YesNoDecision extends DecisionBase { kind: 'yesNo'; yesLabel?: string; noLabel?: string }

export interface ChooseOptionDecision extends DecisionBase {
  kind: 'chooseOption';
  options: { id: string; label: string; disabled?: string }[];
  min: number;
  max: number;
  allowRepeat?: boolean;
}

export interface ChooseNumberDecision extends DecisionBase { kind: 'chooseNumber'; min: number; max: number }

export interface ChooseColorDecision extends DecisionBase { kind: 'chooseColor'; options: ManaType[] }

/** Put things in order (simultaneous triggers CR 603.3b, cards on top of library, ...). */
export interface OrderDecision extends DecisionBase {
  kind: 'order';
  items: { id: string; label: string }[];
}

/** Choose targets for one TargetSpec group (CR 601.2c, 115). Only legal choices are offered. */
export interface ChooseTargetsDecision extends DecisionBase {
  kind: 'chooseTargets';
  /** Text of the target requirement, e.g. "target creature". */
  targetText: string;
  objects: ObjectId[];
  players: PlayerId[];
  min: number;
  max: number;
}

/** Pay a cost (CR 601.2g-h). The answer is "auto" or an explicit plan. */
export interface PayCostDecision extends DecisionBase {
  kind: 'payCost';
  /** Human-readable cost, e.g. "{2}{R}{R}". */
  costText: string;
  /** Mana-producing abilities the player could activate (CR 605.3a). */
  manaSources: { objectId: ObjectId; abilityKey: string; label: string; produces: ManaType[] }[];
  /** Whether automatic payment found a solution. */
  autoPayable: boolean;
  /**
   * Automatic payment found the only way to pay (rules/pay-ways.ts): every way taps sources with the same names, no Phyrexian symbol could be paid with
   * life, and no X was announced. A client may answer `auto` at once without asking. Absent otherwise.
   */
  onlyWay?: true;
  /** Who pays: "unless that player pays" (CR 118.12a) is paid by a player other than the controller of the spell or ability. */
  forPlayer?: PlayerId;
  /** Why the cost is being paid. */
  origin?: 'cast' | 'activate' | 'unless' | 'optional';
}

export interface DeclareAttackersDecision extends DecisionBase {
  kind: 'declareAttackers';
  /**
   * r5-static INTERFACE CHANGE (additive): `taxed`: attacking with it costs something for at least one of its defenders (CR 508.1h: "Creatures can't attack you
   * unless their controller pays ..."); the declaring player is asked to pay after declaring (core/combat-tax.ts).
   */
  /** Creatures that may attack and what each may attack (CR 508.1a-b). `mustAttack`: an attack requirement applies to it (R1, from `requirements`). FAST5 T37: `onlyWithOthers`: "can't attack alone" (CR 506.5): a declaration in which it is the only attacker is refused. */
  candidates: { id: ObjectId; defenders: (PlayerId | ObjectId)[]; mustAttack?: boolean; onlyWithOthers?: boolean; taxed?: true; /** M12 gaps: the defenders an attack on which has a cost (with `taxed`) */ taxedDefenders?: (PlayerId | ObjectId)[] }[];
  /**
   * R1 (M6-7a) INTERFACE CHANGE (design m6 2.3), CR 508.1d: the requirements that apply to creatures that can attack ("attacks each combat if able"), so a
   * client or bot can obey them. The declaration is checked against them (rules/requirements.ts) when `mustObey` is present. Absent when none applies.
   */
  requirements?: CombatRequirement[];
  /**
   * R1, CR 508.1d: how many of `requirements` a legal declaration obeys (the maximum without breaking a restriction). Absent: not enforced, because the
   * engine can't know the maximum (`unchecked` says why: manual text that mentions attacking, a requirement it can't evaluate, the search budget).
   */
  mustObey?: number;
  /** R1: a declaration that obeys `mustObey` requirements (for a client's hint and a bot's fallback); only a hint when `mustObey` is absent. */
  obeying?: { attacker: ObjectId; defender: PlayerId | ObjectId }[];
  /** R1 review (design m6 3.9, never a silent pass), CR 508.1d: what the engine does not check in this declaration, said before the choice. */
  unchecked?: { sourceName: string; text: string }[];
  /**
   * r5-static INTERFACE CHANGE (additive), CR 508.1c: "No more than one creature can attack each combat": at most `max` of these attacker-defender pairs (by
   * attacker) may be declared. Absent when no such limit applies.
   */
  limits?: { max: number; pairs: { attacker: ObjectId; defender: PlayerId | ObjectId }[] }[];
}

export interface DeclareBlockersDecision extends DecisionBase {
  kind: 'declareBlockers';
  /** Creatures that may block and which attackers each may block (CR 509.1a-b). r5-static: `taxed`, blocking with it costs something (CR 509.1d). */
  candidates: { id: ObjectId; attackers: ObjectId[]; maxBlocks: number; onlyWithOthers?: boolean; taxed?: true }[];
  /** Attackers that can't be blocked except by two or more creatures (menace, CR 702.111b): blocking one with a single creature is illegal. */
  needsMultiple: ObjectId[];
  /**
   * MX5 (additive), CR 509.1b: attackers that can't be blocked by more than `max` creatures ("~ can't be blocked by more than one creature"); blocking one
   * with more is illegal. Absent: no such limit on an attacker offered. (An attacker that also needs two or more blockers can't be blocked: not offered.)
   */
  maxBlockers?: { attacker: ObjectId; max: number }[];
  /**
   * FAST5 T57 (additive), CR 509.1b: attackers that can't be blocked except by `min` or more creatures, `min` above two ("~ can't be blocked except by three
   * or more creatures"); they are also in `needsMultiple`. Absent: none (menace's two is only `needsMultiple`).
   */
  minBlockers?: { attacker: ObjectId; min: number }[];
  /** R1 (M6-7a), CR 509.1c: the requirements that apply ("blocks each combat if able", "must be blocked if able"); as for attackers. */
  requirements?: CombatRequirement[];
  /** R1, CR 509.1c: how many of `requirements` a legal declaration obeys. Absent: not enforced (see `unchecked`). */
  mustObey?: number;
  /** R1: a declaration that obeys `mustObey` requirements; only a hint when `mustObey` is absent. */
  obeying?: { blocker: ObjectId; attacker: ObjectId }[];
  /** R1 review, CR 509.1c: what the engine does not check in this declaration, said before the choice. */
  unchecked?: { sourceName: string; text: string }[];
  /** r5-static INTERFACE CHANGE (additive), CR 509.1b: "No more than one creature can block each combat": at most `max` of `blockers` may block. */
  limits?: { max: number; blockers: ObjectId[] }[];
}

/**
 * R1 (M6-7a), design m6 2.3: one attack or block requirement (CR 508.1d, 509.1c).
 *   attack: `creature` attacks (anything, or one of `among`); block: `creature` blocks (any attacker, or one of `among`);
 *   beBlocked: the attacking `creature` is blocked by AT LEAST ONE creature (Gaea's Protector, "must be blocked if able"), or (M6-7 INTERFACE CHANGE) by
 *     at least one of `among`, the potential blockers matching the requirement's filter ("must be blocked by a Dalek if able"); `by` is not produced
 *     (the engine resolves the filter to `among`, so a client needs no filter evaluator). It never means "by every able creature": Lure's "All creatures
 *     able to block enchanted creature do so." is one `block` requirement per able creature with `among` naming the lured creature (from
 *     `RestrictionDef.other`, M6-7, `feature:require.other.block`).
 */
export interface CombatRequirement {
  id: string;
  creature: ObjectId;
  kind: 'attack' | 'block' | 'beBlocked';
  among?: (ObjectId | PlayerId)[];
  by?: ObjectFilter;
  sourceName: string;
  /** R1: the requirement in words, for explanations ("Goblin Brigand attacks each combat if able."). */
  text: string;
}

/**
 * Divide a creature's combat damage among the creatures it is blocking or blocked by (CR 510.1c-d), or, for an attacker with trample,
 * also the player / planeswalker / battle it attacks (CR 702.19b). There is no damage assignment order in this edition of the rules.
 */
export interface AssignDamageDecision extends DecisionBase {
  kind: 'assignDamage';
  /** The creature whose damage is assigned (a blocker when a blocking creature blocks several attackers). */
  attacker: ObjectId;
  amount: number;
  /**
   * Who can be assigned damage. `lethal` is the damage that counts as lethal for the purposes of trample (CR 702.19b, damage already
   * marked and damage assigned by other creatures in this step is taken into account; deathtouch makes it 1, CR 702.2c).
   * `trampleTarget` marks the player / planeswalker / battle the attacker attacks: it may only be assigned damage once every
   * other recipient is assigned at least its `lethal` amount.
   */
  recipients: { id: ObjectId | PlayerId; lethal: number; trampleTarget?: boolean }[];
  canTrample: boolean;
}

/** CR 616.1: choose which replacement/prevention effect to apply first. */
export interface ChooseReplacementDecision extends DecisionBase {
  kind: 'chooseReplacement';
  /** `klass` (M6-0, m6 design 2.3, optional): the CR 616.1a-e class of the option (0 self-replacement ... 4 any other), for a client to group them. */
  options: { id: string; label: string; klass?: 0 | 1 | 2 | 3 | 4 }[];
}

/**
 * The engine does not understand this effect. Players resolve it by hand, using manual
 * adjustment operations, and then confirm. Never silently skipped.
 */
export interface ManualResolveDecision extends DecisionBase {
  kind: 'manualResolve';
  sourceName: string;
  text: string;
  /** The spell or ability that is resolving right now: it leaves the stack by itself, so manual ops may not move it. */
  resolvingId?: ObjectId;
  /** The permanent the text is about, when no spell or ability is resolving: a permanent that entered with counters to be added by hand (CR 614.1c). */
  subjectId?: ObjectId;
  /** Names bound so far in this resolution, with the objects' display names (design 10.5). */
  bound?: { name: string; objects: string[] }[];
  /** Sentences of the ability already resolved automatically (display text), in order. */
  done?: string[];
  /** The unit is a manual shield: after the answer a ManualReminder is created with this duration. */
  reminder?: Duration;
  /** Why the engine asks (the reason of the manual node), shown verbatim. */
  reason?: string;
  /**
   * MRE (C6 gap 6): how many steps of this resolution were already applied ("Apply now", an answer with `continue: true`); absent on the first prompt.
   * The game state that comes with the decision already shows them (a drawn card is in the hand), and they are logged. Answering with `continue: true`
   * again is refused once `step` reaches MANUAL_MAX_STEPS - 1.
   */
  step?: number;
}

/**
 * MRE (C6 gap 6): the most prompts one manual resolution may take (the first one and every re-issue after an answer with `continue: true`). The whole action is
 * re-run from its base state for each answer (the decision model), so the bound keeps a runaway "Apply now" loop cheap; the last prompt can only be confirmed.
 */
export const MANUAL_MAX_STEPS = 50;

/** CR 601.2d: the caster divides damage or counters among the announced targets; each gets at least 1. */
export interface ChooseDivisionDecision extends DecisionBase {
  kind: 'chooseDivision';
  what: 'damage' | 'counters' | 'other';
  total: number;
  targets: { id: ObjectId | PlayerId; label: string }[];
}

/** CR 607.2d, 608.2d: name a card, a creature type, a basic land type ... from a searchable list. */
export interface ChooseNameDecision extends DecisionBase {
  kind: 'chooseName';
  what: 'cardName' | 'creatureType' | 'cardType' | 'landType';
  /** Closed list for types; for card names the whole local Oracle name index (the UI searches it). */
  options?: string[];
  /**
   * std-rx28 INTERFACE CHANGE (additive): of a card name, only the name of a land card ('land': "choose a land card name", Petrified Hamlet) or of a nonland card
   * ('nonland': "choose a nonland card name", Skyseer's Chariot; CR 201.3). The UI searches only such names; the engine refuses a name that the game's own cards
   * show to be of the other kind (core/validate.ts; a card that is not in the game has no object the choice could affect).
   */
  cardKind?: 'land' | 'nonland';
}

/**
 * M11-0 (m11 design 4.3): the owner of a commander chooses whether it goes to the command zone (CR 903.9). Asked of the commander's OWNER.
 *  - `rule: '903.9b'`: the commander would be put into its owner's hand or library (`zone`) from anywhere; it may be put into the command zone instead. A
 *    replacement effect that may apply more than once to the same event (an exception to CR 614.5); asked after any CR 616.1 ordering put it next.
 *  - `rule: '903.9a'`: the commander was put into a graveyard or exile (`zone`) since the last time state-based actions were checked; its owner may put
 *    it into the command zone. A state-based action (CR 704.6d), asked while state-based actions are performed (CR 704.3).
 * Answer `{ kind: 'commanderZone', command: true }` to put it into the command zone. Emitted from M11-1 (nothing asks it before).
 */
export interface CommanderZoneDecision extends DecisionBase {
  kind: 'commanderZone';
  /** The commander object: where it is now (903.9a) or before the move (903.9b). */
  object: ObjectId;
  /** Its card (CR 903.3: the designation belongs to the card). */
  card: CardId;
  rule: '903.9a' | '903.9b';
  /** 903.9b: the zone it would be put into; 903.9a: the zone it is in. */
  zone: 'hand' | 'library' | 'graveyard' | 'exile';
}

export type Decision =
  | PriorityDecision
  | PlayFirstDecision
  | MulliganDecision
  | ChooseObjectsDecision
  | YesNoDecision
  | ChooseOptionDecision
  | ChooseNumberDecision
  | ChooseColorDecision
  | OrderDecision
  | ChooseTargetsDecision
  | PayCostDecision
  | DeclareAttackersDecision
  | DeclareBlockersDecision
  | AssignDamageDecision
  | ChooseReplacementDecision
  | ManualResolveDecision
  | ChooseDivisionDecision
  | ChooseNameDecision
  | CommanderZoneDecision;

export type DecisionKind = Decision['kind'];

/** Zones a manual `move` may use. */
export const MANUAL_MOVE_ZONES: readonly string[] = ['hand', 'battlefield', 'graveyard', 'exile', 'libraryTop', 'libraryBottom'];

/** A manual adjustment used to resolve effects the engine does not understand. */
export type ManualOp =
  /** `attachTo`: an Aura (or Equipment...) put onto the battlefield without being cast enters attached to this object or player (CR 303.4f); only with `to: 'battlefield'`. */
  | { op: 'move'; object: ObjectId; to: 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'libraryTop' | 'libraryBottom'; attachTo?: ObjectId | PlayerId }
  | { op: 'life'; player: PlayerId; delta: number }
  /** Counters on an object, or poison counters on a player (`object` is then a player id and `counter` is "poison", CR 122.1f). */
  | { op: 'counters'; object: ObjectId | PlayerId; counter: string; delta: number }
  | { op: 'tap'; object: ObjectId; tapped: boolean }
  | { op: 'draw'; player: PlayerId; count: number }
  | { op: 'shuffle'; player: PlayerId }
  | { op: 'control'; object: ObjectId; player: PlayerId }
  | { op: 'damage'; target: ObjectId | PlayerId; amount: number }
  /** Attach an Aura / Equipment / Fortification to an object or player, or detach it (`to: null`). Equip and "put onto the battlefield attached" until milestone 5. */
  | { op: 'attach'; object: ObjectId; to: ObjectId | PlayerId | null }
  /** Add mana to a player's pool (CR 106.3): rituals and loyalty abilities that add mana, or a mana ability the engine can't run. */
  | { op: 'mana'; player: PlayerId; types: ManaType[]; snow?: boolean }
  /** Create a token (CR 111): its characteristics are the ones the effect states. `typeLine` as printed on a token ("Token Creature - Soldier" with an em dash), `text` is its rules text. */
  | { op: 'token'; player: PlayerId; name: string; typeLine: string; power?: string; toughness?: string; colors?: ('W' | 'U' | 'B' | 'R' | 'G')[]; text?: string; tapped?: boolean }
  | { op: 'note'; text: string };

export type DecisionAnswer =
  | { kind: 'playFirst'; player: PlayerId }
  | { kind: 'mulligan'; keep: boolean }
  | { kind: 'chooseObjects'; ids: ObjectId[] }
  | { kind: 'yesNo'; yes: boolean }
  | { kind: 'chooseOption'; ids: string[] }
  | { kind: 'chooseNumber'; n: number }
  | { kind: 'chooseColor'; color: ManaType }
  | { kind: 'order'; ids: string[] }
  | { kind: 'chooseTargets'; targets: TargetChoice[] }
  | { kind: 'payCost'; auto: true }
  | {
    kind: 'payCost';
    auto: false;
    activations: { objectId: ObjectId; abilityKey: string; color?: ManaType }[];
    lifeForPhyrexian?: number[];
    /** Indices into the mana pool (after the activations) that may be spent; the rest stays. Omit to let the engine choose (CR 601.2h). */
    spendPool?: number[];
  }
  | { kind: 'declareAttackers'; attacks: { attacker: ObjectId; defender: PlayerId | ObjectId }[] }
  | { kind: 'declareBlockers'; blocks: { blocker: ObjectId; attacker: ObjectId }[] }
  | { kind: 'assignDamage'; amounts: { id: ObjectId | PlayerId; amount: number }[] }
  | { kind: 'chooseReplacement'; id: string }
  /**
   * MRE (C6 gap 6): `continue: true` applies `ops` now and keeps resolving by hand: the engine re-issues the manualResolve decision (a new id, `step` + 1)
   * with the game after them, until an answer without it (or `continue: false`) confirms. Each answer's ops must not be empty when it continues.
   */
  | { kind: 'manualResolve'; ops: ManualOp[]; continue?: boolean }
  | { kind: 'chooseDivision'; amounts: number[] }
  | { kind: 'chooseName'; name: string }
  /** M11-0: CR 903.9a-b: `command: true` puts the commander into the command zone; false lets it stay in (903.9a) or go to (903.9b) `zone`. */
  | { kind: 'commanderZone'; command: boolean };

export type AnswerFor<K extends DecisionKind> = Extract<DecisionAnswer, { kind: K }>;
