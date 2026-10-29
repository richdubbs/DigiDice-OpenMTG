/**
 * The complete game state. Plain JSON-serializable data: no classes, no functions,
 * no Maps. The engine never mutates a state it was given; it clones and returns a new one.
 */
import type { RngState } from '../rng';
import type { CardDef } from './card';
import type { Decision, DecisionAnswer } from './decisions';
import type { Action } from './actions';
import type { CardId, DefId, ObjectId, PlayerId } from './ids';
import type { Color, ManaType } from './mana';
import type { AbilityDef, AltCostDelay, CounterSpec, Destination, Duration, EffectStep, EventPattern, EventRole, FaceDownProfile, KeywordAbilityDef, LinkId, ManaRestriction, ManaSpentRider, ManaSpentTrigger, Modification, Name, ObjectFilter, StaticEffect, TargetSpec } from './ability';
import type { Chars } from '../rules/characteristics';

/** Zones (CR 400.1). Library, hand and graveyard are always the owner's (CR 400.3). */
export type ZoneKind = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'stack' | 'exile' | 'command';
export const HIDDEN_ZONES: readonly ZoneKind[] = ['library', 'hand']; // CR 400.2

/**
 * trek-11 INTERFACE CHANGE (additive), CR 400.11, 601.2a: where a spell was cast from. A zone, or `'outside'`: the card came from outside the game (The Holodeck:
 * "play a permanent card you own from outside the game", `GameState.outside`), which is no zone (CR 400.11). A filter or event that names a zone ("cast from your hand",
 * "from exile") never matches it, while "from anywhere other than your hand" (`not` of a zone, `notFrom`) does: the spell was plainly not cast from the hand.
 * (A judgement the owner may revisit: Star Trek's rules text is not out yet.)
 */
export type CastOrigin = ZoneKind | 'outside';

/** trek-11 (CR 400.11, 601.2a): the origin of a spell cast from `o`: `'outside'` for the staging object of a card played from outside the game, else its zone. */
export const castOriginOf = (o: { zone: ZoneKind; fromOutside?: true }): CastOrigin => (o.fromOutside === true ? 'outside' : o.zone);

/** Steps of a turn (CR 500.1). Main phases have no steps; we model them as steps for simplicity. */
export type Step =
  | 'untap' | 'upkeep' | 'draw' // beginning phase (CR 501)
  | 'main1' // precombat main phase (CR 505)
  | 'beginCombat' | 'declareAttackers' | 'declareBlockers' | 'combatDamage' | 'endCombat' // combat (CR 506)
  | 'main2' // postcombat main phase
  | 'end' | 'cleanup'; // ending phase (CR 512)

export const STEP_ORDER: readonly Step[] = [
  'untap', 'upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers',
  'combatDamage', 'endCombat', 'main2', 'end', 'cleanup',
];

export type Phase = 'beginning' | 'precombatMain' | 'combat' | 'postcombatMain' | 'ending';

/** WP15 ADDITION: a kind of phase, as effects that add phases name it ("after this main phase", CR 500.8; every main phase is a main phase, CR 505.1). */
export type PhaseKind = 'beginning' | 'main' | 'combat' | 'ending';

export function phaseOf(step: Step): Phase {
  switch (step) {
    case 'untap': case 'upkeep': case 'draw': return 'beginning';
    case 'main1': return 'precombatMain';
    case 'main2': return 'postcombatMain';
    case 'end': case 'cleanup': return 'ending';
    default: return 'combat';
  }
}

/** One unit of mana in a pool (CR 106.4), with what produced it. */
export interface ManaUnit {
  type: ManaType;
  /** Object that produced it (for snow, restrictions, "mana spent" tracking). */
  sourceId?: ObjectId;
  snow?: boolean;
  /** Structured spending restriction, e.g. "Spend this mana only to cast creature spells." (design D8; enforced by payment, WP7). */
  restriction?: ManaRestriction;
  /** FAST5 MX6 (additive): firebending's mana (CR 702.189a): not lost as steps and phases end until the end of combat (core/steps.ts#endOfStepCleanup). */
  keep?: 'endOfCombat' | 'endOfTurn'; // std-mkm: 'endOfTurn', "until end of turn, you don't lose this mana" (kept until the cleanup step ends, CR 514.2, 500.5)
  /**
   * FAST5X E19 INTERFACE CHANGE (additive), CR 106.3: the subtypes its source had as it produced this mana (last known information: a Treasure sacrificed for
   * it is gone by the time the mana is spent), for "if mana from a Treasure was spent to cast it", "for each mana from a Cave spent to cast it". Absent when
   * the source had no subtypes (rules/mana.ts#addMana).
   */
  sourceSubtypes?: string[];
  /** std-mana-1 INTERFACE CHANGE (additive), CR 106.6: a rider on the spell this mana is spent on (`ManaSpentRider`; actions/cast.ts#applySpentRiders). */
  rider?: ManaSpentRider;
  /**
   * std-copy-3 INTERFACE CHANGE (additive), CR 106.6, 603.2: "When that mana is spent to cast <spells>, <do>" (`addMana.whenSpent`): the triggered ability this unit
   * carries, with the controller and the source of the ability that added it (actions/cast.ts#manaSpentTriggers puts it on the stack).
   */
  whenSpent?: ManaSpentTrigger & { controller: PlayerId; sourceId: ObjectId };
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number; // CR 119
  poison: number; // CR 122.1f
  manaPool: ManaUnit[];
  landsPlayedThisTurn: number; // CR 305.2
  /** Number of the most recent turn of this player that has begun (CR 302.6 summoning sickness, CR 602.5a). */
  lastTurnStarted: number;
  /**
   * std-r9 INTERFACE CHANGE (additive): how many turns of this player have begun this game, extra turns included (CR 500.7) and skipped turns not (CR 500.11:
   * a skipped turn does not happen); counted as each turn begins (core/turn.ts#beginTurn). Read by the quantity `turnsBegun` ("You can't cast ~ during your
   * first, second, or third turns of the game"). Absent = 0, so every earlier state and action log is unchanged.
   */
  turnsBegun?: number;
  /**
   * CMD3 INTERFACE CHANGE (additive): the numbers of the turns of this player's last two upkeep steps that began, the latest last (core/turn.ts#beginStep);
   * read by the condition `controlledSinceUpkeep` (echo, CR 702.30a: "if this permanent came under your control since the beginning of your last upkeep").
   * Absent before the player's first upkeep.
   */
  upkeepTurns?: number[];
  /** CR 704.5b: attempted to draw from an empty library since the last SBA check. */
  drewFromEmptyLibrary: boolean;
  hasLost: boolean;
  lostReason?: string;
  conceded: boolean;
  mulligans: number;
  keptHand: boolean;
  /** Per-player auto-pass / stop settings (Arena-style). */
  stops: StopSettings;
  /** Counters on players (energy, experience, ...). CR 122.1. */
  counters: Record<string, number>;
  /**
   * Life gained / lost this turn, spells cast this turn, etc. for conditions. FAST5X E20 INTERFACE CHANGE (additive): `manaSpentOnSpells`, the mana this player
   * spent this turn to cast spells (CR 700.14, expend; absent = 0; rules/crime.ts).
   * FAST5X E22 INTERFACE CHANGE (additive): `descended`, the permanent cards put into this player's graveyard from anywhere this turn (CR 700.11: "the number of
   * times you descended this turn"; core/zones.ts#moveObject counts them as they arrive, judged as cards in the graveyard, CR 110.4a). Absent = 0.
   * r4-mech INTERFACE CHANGE (additive): `coinFlips`, the instructions by which this player flipped one or more coins this turn (CR 705.1; "the first time you flip one
   * or more coins each turn", effects/handlers/game.ts#flipCoin). Absent = 0.
   */
  turnStats: {
    lifeGained: number; lifeLost: number; spellsCast: number; cardsDrawn: number; damageDealtToOpponents?: number; descended?: number; manaSpentOnSpells?: number; coinFlips?: number;
    /** r5-repl INTERFACE CHANGE (additive): `cardsDrawn` as this player's draw step began this turn (core/steps.ts); absent before it (CR 504.1). */
    drawStepFrom?: number;
    /** pc-exile-play-2 INTERFACE CHANGE (additive), CR 601.2i: the spells this player cast this turn, by the zone each was cast from ("the first spell you cast from exile each turn"). */
    castFromCount?: Record<string, number>;
  };

  // ---- M11-0 ADDITIONS (m11 design 4.2; all optional and absent outside a Commander game, so every earlier state and action log is unchanged) ----
  /**
   * CR 903.3, 702.124b: the cards designated as this player's commander (one, or two with a partner ability), in the order the deck lists them. Present
   * only in a Commander game (`GameOptions.commander`). Public information: each starts face up in the command zone (CR 903.6, 103.2c).
   */
  commanders?: CommanderRec[];
  /**
   * CR 903.10a, 704.6c, 702.124d: the combat damage dealt to THIS player by each commander over the whole game, keyed by the commander's CardId (the
   * designation belongs to the card and survives zone changes, CR 903.3; an object id does not, CR 400.7). Absent until a commander deals combat damage
   * to this player; written from M11-1.
   */
  commanderDamage?: Record<CardId, number>;

  // ---- M12-1 ADDITION (m12 design 4.2; absent in every state of a two-player game, so every earlier state and action log is unchanged) ----
  /**
   * CR 104.5, 800.4a: set when the player left a multiplayer game that went on (written only by the leave procedure, M12-2; never in a two-player game, which
   * is over when a player loses, CR 104.2a). `hasLost` stays the flag every reader uses for "not in the game"; this records the leaving for the end screen
   * and the rules that need its order (CR 800.4i: information about the player is kept). `turn`: the turn number when they left. `order`: the number of the
   * elimination they left in, NOT a per-player counter: 1 for the first set of players to leave, 2 for the next set. Players who lose at the same time
   * (one state-based action check, one effect, one concession, the opponents of a player who wins with "wins the game", CR 104.2b, 104.4a; the leave
   * procedure runs once per such set, m12 design D8) share one `order`, so they share their finishing place (`placements`; milestone 13's results ledger
   * reads the same value). `reason`: how they lost (the `lostReason` text, or the concession, CR 104.3a); `rules`: the CR citations of that loss (the
   * rules the `playerLost` log line cites, e.g. CR 704.5a, 104.3a), for a loss code.
   */
  left?: { turn: number; order: number; reason: string; rules?: string[] };
  /**
   * CMP1 INTERFACE CHANGE (additive, optional; absent for a player without a companion, so every earlier state and action log is unchanged): the companion
   * this player revealed before the game began (CR 702.139a), a card they own outside the game (`GameState.outside`, CR 400.11). Public information: it is
   * revealed, so every view shows it and its definition (core/view.ts). `inHand`: the turn number in which the player took the companion special action and
   * put it into their hand (CR 116.2g: once per game; CR 702.139c: it stays in the game until the game ends); absent while it is still outside the game.
   */
  companion?: CompanionRec;
}

/** CMP1 (CR 702.139a, 116.2g): a player's revealed companion. */
export interface CompanionRec {
  defId: DefId;
  /** The turn in which the special action put it into its owner's hand (CR 116.2g: only once per game); absent until then. */
  inHand?: number;
}

/**
 * M12-1 (m12 design D1, D4, 4.1): the multiplayer options of a game that begins with more than two players (CR 800.1). Milestone 12 plays one variant:
 * Free-for-All (CR 806) with the attack multiple players option (CR 802; CR 806.2b requires exactly one attack option) and without the limited range of
 * influence option (CR 801 is not used: CR 806.2a, 903.2). core/create.ts#initialState refuses any other value.
 */
export interface MultiplayerOptions {
  /** CR 806: Free-for-All (the only multiplayer variant of milestone 12; Two-Headed Giant, CR 810, and the others are later milestones). */
  variant: 'freeForAll';
  /** CR 802, 806.2b, 903.2: attack multiple players (attack left / attack right, CR 803, are not offered). */
  attack: 'multiple';
}

/** M12-1 (m12 design 4.1): the most players a game can begin with (Free-for-All with 3 or 4 players; two-player games as before). */
export const MAX_PLAYERS = 4;

/** M11-0 (m11 design 4.2): the Commander variants a game can be (the format ids of packages/cards/src/formats/formats.ts that have commanders). */
export type CommanderVariant = 'commander' | 'duel' | 'brawl' | 'standardbrawl';

/**
 * M11-0 (m11 design 4.1): the rules of a Commander game that differ between the variants. `core/commander.ts#commanderOptions` gives each variant's
 * defaults. A game is a Commander game exactly when `GameOptions.commander` is present.
 */
export interface CommanderOptions {
  variant: CommanderVariant;
  /** CR 903.10a, 704.6c: a player dealt this much combat damage by the same commander loses; null: the rule is not used (Brawl, CR 903.12h). */
  damageLimit: number | null;
  /** CR 903.8: the additional generic mana per previous cast from the command zone ("commander tax"). */
  tax: number;
  /** CR 903.12g, 103.5c: the first mulligan a player takes is free (Brawl; a multiplayer game). */
  freeMulligan: boolean;
}

/** M11-0 (m11 design 4.2): one commander of a player (CR 903.3). */
export interface CommanderRec {
  /** The physical card (CR 903.3: the designation is an attribute of the card; a copy of it, a token or a spell copy is not a commander). */
  card: CardId;
  /** Its definition (the client's command zone panel and commander damage need it while the card is in a hidden zone; core/view-parts/commander.ts). */
  defId: DefId;
  /**
   * CR 903.8, 702.124d: how many times its owner has cast it from the command zone this game; the commander tax is `CommanderOptions.tax` times this
   * (core/commander.ts#commanderTax). Counted when the spell is cast (CR 601.2i), whatever happens to it afterwards. Written from M11-1.
   */
  casts: number;
  /**
   * CR 903.4, 903.4a: its color identity, established before the game began (from `CardDef.colorIdentity`, which the compiler copies from Scryfall's
   * `color_identity`, M11-4). null when the definition has none: a "commander's color identity" ability then resolves by hand (never a guess).
   */
  identity: Color[] | null;
}

export interface StopSettings {
  /** Steps of this player's own turn where they want to receive priority even with nothing obvious to do. */
  ownTurn: Step[];
  /** Steps of the opponent's turn where they want to stop. */
  opponentTurn: Step[];
  /** If true, never auto-pass (CR-faithful "full control"). */
  fullControl: boolean;
  /**
   * AP1: the temporary "hold priority" toggle. While true the player gets every priority, also right after their own spell or
   * ability (CR 117.3c), like full control; the engine clears it when the turn ends (the next turn begins with it absent). Absent = off.
   */
  holdPriority?: boolean;
}

/** Information about a spell or ability on the stack (CR 405, 601, 602, 603). */
export interface StackInfo {
  kind: 'spell' | 'activated' | 'triggered';
  /** For abilities: the source object (CR 113.7) and its last known information. */
  sourceId?: ObjectId;
  sourceName?: string;
  /** Which ability of the source: face index + ability index in FaceDef.abilities, or a keyword/rule ability id. */
  abilityRef?: AbilityRef;
  /** For spells: which face was cast (split halves, adventures, MDFC back faces). */
  face?: number;
  /** Chosen modes (indices into ModeSpec.options), CR 700.2. */
  modes?: number[];
  /** Chosen targets per TargetSpec (per chosen mode when modal), CR 601.2c. */
  targets: TargetChoice[][];
  /** Value of X (CR 107.3). */
  x?: number;
  /** Optional/additional/alternative costs paid (kicker count, flashback, ...). */
  costsPaid: CostsPaid;
  /** For triggered abilities: the event that triggered it, with last known information of its participants (CR 603.2, 603.10). Replaces the old TriggerContext. */
  event?: EventContext;
  /** Announced division per target spec id (CR 601.2d), parallel to the chosen targets. */
  division?: Record<string, number[]>;
  /**
   * The ability itself, for abilities that do not come from the printed text of a living object: delayed and reflexive triggers, emblem and
   * granted abilities. It exists independently of its source (CR 113.7a).
   */
  inline?: AbilityDef;
  /** Copy of a spell (CR 707.10) — ceases to exist if it leaves the stack. */
  isCopy?: boolean;
  /**
   * std-copy-6 INTERFACE CHANGE (additive), CR 603.3: of a triggered ability, the id of the pending trigger it was (PendingTrigger.id), so an ability that triggered
   * on its triggering ("copy that ability", the `abilityTriggered` event) finds it on the stack (effects/refs.ts).
   */
  pendingId?: string;
  /** "Split second" and similar flags read from the spell when cast. */
  flags?: string[];
  /** Zone the card was cast from (aftermath: exile instead of leaving the stack, CR 702.127a); trek-11: or `'outside'`, from outside the game (CR 400.11). */
  castFrom?: CastOrigin;
  /** pc-exile-play-2 INTERFACE CHANGE (additive), CR 601.2i: which spell this was among those its caster cast this turn (`turn`), and among those cast from the same zone (`fromZone`); 1 is the first. */
  castOrdinal?: { turn: number; fromZone: number };
  /** FAST4 T27 INTERFACE CHANGE (additive): the player who cast the spell (CR 601.2a), kept in the permanent's cast record (`GameObject.cast.by`). */
  caster?: PlayerId;
  /** std-rx22 INTERFACE CHANGE (additive): the spell's controller changed while it was on the stack (core/control.ts); copied to `GameObject.cast.controlLost`. */
  controlLost?: true;
  /**
   * FAST5X E17 INTERFACE CHANGE (additive): the "as you cast this spell" conditions of the spell, decided when it became cast (CR 601.2i), keyed by the JSON of
   * the condition (rules/resolutions.ts#castCheckKey). Read by `{cond:'asCast'}`.
   */
  castChecks?: Record<string, boolean>;
  /** A fused split spell: both halves were cast together (CR 702.102). */
  fused?: boolean;
  /**
   * FAST5X E6 INTERFACE CHANGE (additive): the alternative cost paid for this spell says "exile this card instead of putting it anywhere else any time it
   * would leave the stack" (harmonize, CR 702.180a; `AlternativeCostDef.exileOnLeave`). Recorded at the announcement (a granted harmonize keeps applying on
   * the stack, CR 400.7g).
   */
  exileOnLeave?: true;
  /**
   * FAST5X E2 INTERFACE CHANGE (additive): the delayed part of the alternative cost paid for this spell (warp, CR 702.185a; `AlternativeCostDef.delay`),
   * recorded at the announcement and copied with the spell (CR 707.10); core/resolve.ts creates the delayed triggered ability as the permanent enters.
   */
  altDelay?: AltCostDelay;
  /**
   * FAST5X E7 INTERFACE CHANGE (additive), CR 702.190b: the permanent this spell becomes enters tapped and attacking what the creature returned to pay its
   * sneak cost was attacking (`AlternativeCostDef.entersAttacking`), as that creature last existed on the battlefield (CR 608.2h): `defender` null when it
   * was attacking nothing (CR 506.4c) or no attacking creature was returned; then the permanent enters tapped but is never attacking (CR 508.4a). Recorded
   * after the payment (CR 601.2h) and copied with the spell (CR 707.10); core/resolve.ts applies it.
   */
  entersAttacking?: { defender: PlayerId | ObjectId | null; defendingPlayer: PlayerId | null };
  /**
   * C10 INTERFACE CHANGE (additive), CR 614.1c: the spell was cast with a permission that says "If you cast a spell this way, that artifact enters with a
   * finality counter on it" (`PermissionDef.entersWith`): the counters the permanent it becomes enters with, and the name of the permission's source for
   * the log. Recorded as the spell is cast (actions/cast.ts), applied by effects/rule-replacements/permit-enters.ts; a copy (CR 707.10) is not cast, so
   * it is ignored there.
   */
  permitEnters?: { counters: CounterSpec[]; source: string; /** std-freecast-2 (CR 614.1c, 205.1b): and the subtypes it has in addition to its other types (PermissionDef.entersSubtypes). */ subtypes?: string[] };
  /**
   * r5-repl INTERFACE CHANGE (additive), CR 614.1a, 400.7: the spell was cast with a permission that says "If that spell would be put into a graveyard, exile
   * it instead" (`PermissionDef.graveyardInstead`): where it goes instead of a graveyard, and the name of the permission's source for the log. Recorded as
   * the spell is cast (actions/cast.ts; a "your graveyard" permission only when the caster owns it), applied by effects/rule-replacements/permit-graveyard.ts;
   * a copy (CR 707.10) is not cast, so it is ignored there.
   */
  permitGraveyardInstead?: { to: Destination; source: string };
}

/** Where an ability on the stack or in a key comes from. `keyword` = generated by the keyword library, key `k:<face>:<index>:<n>`. */
export type AbilitySource = 'printed' | 'rule' | 'keyword' | 'granted' | 'delayed' | 'reflexive' | 'emblem'
  /** M6-0 (m6 design E5): keys `c:<effectId>:<face>:<index>` and `c:<effectId>:<face>:<index>:<n>`; carried inline on the stack (CR 113.7a). Used from M6-2. */
  | 'copied';

export interface AbilityRef {
  /** 'printed' = FaceDef.abilities[index]; 'rule' = a rule-generated ability (e.g. basic land mana). */
  source: AbilitySource;
  face: number;
  index: number;
  /** For rule/granted abilities: an identifier like "basicLand:G" or "equip". */
  key?: string;
}

export type TargetChoice = { kind: 'object'; id: ObjectId } | { kind: 'player'; id: PlayerId };

export interface CostsPaid {
  kicked?: number;
  /** std-costs-1 (CR 601.2b): the number announced for each optional additional cost with `announceCount`, by its name (Quantity `costCount`). */
  counts?: Record<string, number>;
  alternative?: string; // "flashback", "evoke", "overload", ...
  additional?: string[];
  manaSpent?: ManaUnit[];
  /** Objects sacrificed/exiled/discarded as part of the cost (CR 400.7j: effects can find them). */
  costObjects?: ObjectId[];
  /**
   * FAST3 T18 ADDITION: the permanents sacrificed to pay the cost, by the ids they had ON THE BATTLEFIELD (keys of `GameState.lki`): "the sacrificed
   * creature's power" reads them as they last existed there (CR 608.2h, 701.21a; ObjRef `costSacrificed`).
   */
  sacrificed?: ObjectId[];
  /** T35 ADDITION: the permanents tapped to pay a `tapUntapped` cost (ObjRef `costTapped`, station CR 702.184a); they stay on the battlefield. */
  tapped?: ObjectId[];
  /**
   * FAST5X E7 ADDITION (additive): the permanents returned to their owner's hand to pay the cost, by the ids they had ON THE BATTLEFIELD (keys of
   * `GameState.lki`, CR 608.2h): sneak's "the creature that was returned" (CR 702.190b), web-slinging's "the returned creature" (CR 702.188a).
   */
  returned?: ObjectId[];
  /**
   * FAST5X E13 ADDITION (additive): the cards exiled to pay the cost, by the ids they have IN EXILE (CR 400.7j): `self`, the card the source became ("Exile
   * this permanent"; craft returns it transformed, CR 702.167a), and `others` (craft's materials: "the exiled cards used to craft it", CR 702.167c). Read by
   * ObjRef `costExiled`.
   */
  exiled?: { self?: ObjectId; others: ObjectId[] };
  /**
   * CLOUD C8 ADDITION (additive): the cards discarded to pay the cost, as handles of the cards the discard made of them (CR 400.7j: the effects of the spell or
   * ability the cost was paid for can find a card a cost moved to a public zone; normally the graveyard, exile when a replacement sent it there). A card a
   * replacement put into a hidden zone is the handle it had in the hand, which nothing can act on and which reads its last known information (CR 400.7,
   * 608.2h). Read by ObjRef `costDiscarded` ("the discarded card"). A copy keeps it (CR 707.10: its effects use the objects paid for the original).
   */
  discarded?: ObjHandle[];
  lifePaid?: number;
  /**
   * FAST5X E1 INTERFACE CHANGE (additive): the player chosen to pay an additional cost, by the cost's name (CR 702.174a: the opponent a gift is promised to,
   * read by PlayerRef `costChosen`). A copy keeps it (CR 707.10), and so does the permanent's cast record (CR 607.2i-j, 400.7d).
   */
  chosenPlayers?: Record<string, PlayerId>;
  /**
   * FAST5X E11 INTERFACE CHANGE (additive): what was beheld to pay the cost (CR 701.4a), as its characteristics were at that time (CR 701.4b: "if a [quality]
   * was beheld" reads them, whatever the card or permanent became later). A copy keeps it (CR 707.10), and so does the permanent's cast record.
   */
  beheld?: BeheldSnapshot[];
  /**
   * std-costs-2 INTERFACE CHANGE (additive): the objects chosen to pay a `chooseObject` cost part (CR 601.2b, 601.2h), with the zone each was in then ("the chosen
   * creature or card", Close Encounter). Read by ObjRef `costChosenObject`. A copy keeps it (CR 707.10), and so does the permanent's cast record.
   */
  chosenObjects?: ObjHandle[];
  /**
   * p2-refs-1 INTERFACE CHANGE (additive): the cards revealed from the hand to pay a `reveal` cost part of cards other than ~ (CR 601.2b, 701.20a), each with the zone it
   * was in then ("the revealed card's mana value", Disaster Radius). Read by ObjRef `costRevealed`. A copy keeps it (CR 707.10), and so does the permanent's cast record.
   */
  revealed?: ObjHandle[];
  /**
   * std-costs-2 INTERFACE CHANGE (additive): the creature type chosen as an additional cost with `chooseType` was announced, by its link (CR 601.2b, 607.2d). The spell
   * also remembers it in its `links`; a copy keeps this record (CR 707.10), which an ObjectFilter `chosen` of the copy reads (rules/filter.ts).
   */
  chosenTypes?: Record<string, string>;
  /**
   * FAST5X E11 INTERFACE CHANGE (additive): objects a cost part moved that a linked ability of the permanent the spell becomes reads, by link id (CR 607.2q:
   * "behold a Goblin and exile it" ... "return the exiled card"), as handles of the objects in their new zone. core/resolve.ts puts them in that
   * permanent's link store; a spell that never becomes a permanent links nothing, and a copy drops them (it paid no cost, CR 607.2q, 707.10).
   */
  costLinks?: Record<string, ObjHandle[]>;
}

/** FAST5X E11: the characteristics of a beheld card or permanent at the time it was beheld (CR 701.4b). */
export interface BeheldSnapshot {
  types: string[];
  subtypes: string[];
  supertypes: string[];
  /**
   * std-rx28 INTERFACE CHANGE (additive): the card revealed from the hand or the permanent chosen, and where it was then ("the power of the creature you chose or
   * the card you revealed", Monstrous Emergence; CR 701.4a, 608.2h). Read by ObjRef `costBeheld`.
   */
  id?: ObjectId;
  zone?: 'hand' | 'battlefield';
}

/** An object reference that remembers where the object is expected to be (CR 400.7, 603.7c, 608.2b). */
export interface ObjHandle {
  id: ObjectId;
  /** Zone the object was in when the handle was made; a handle whose object is no longer there is stale (it is a new object). */
  zone: ZoneKind;
}

/** What a linked ability remembers about its source object (CR 607). Stored on the source object; fresh after any zone change (CR 400.7). */
export interface LinkValue {
  objects?: ObjHandle[];
  players?: PlayerId[];
  /** A chosen color, creature type, card name, number, ... as strings. */
  values?: string[];
  /**
   * std-combat-5 ADDITION (additive), CR 608.2d: a secret choice ("secretly choose Human, Merfolk, or Goblin"): the players who know the value. The client view of
   * every other player leaves `values` out (core/view.ts#hideSecretLinks) until a `revealChosen` cost reveals it (rules/pay-parts.ts deletes this field).
   */
  secret?: PlayerId[];
}

export type RoleValue = { objects: ObjHandle[] } | { players: PlayerId[] };

/** Everything an effect may ask about the event that triggered it (replaces the loose TriggerContext of milestone 4). */
export interface EventContext {
  ev: EventPattern['ev'];
  roles: Partial<Record<EventRole, RoleValue>>;
  /** "that much": damage dealt, life gained, cards drawn, counters put. */
  amount?: number;
  /** pc-tokens-2 INTERFACE CHANGE (additive): of a `createToken` event being replaced, the definition id of the token (`createToken.exceptReplaced` skips a step that would make that very token). */
  token?: string;
  /** INTEGRATION ADDITION (W1): of a `cast` event, the spells cast this turn by all players before that spell (CR 702.40a); read by `{q:'spellsBefore'}` (storm). */
  spellsBefore?: number;
  /** FAST5X E9 INTERFACE CHANGE (additive): of a `cast` event, the amount of mana spent to cast that spell (CR 601.2h); read by `{q:'spellManaSpent'}` (increment, CR 702.191a). */
  manaSpent?: number;
  /** Standard round 3, r3-trig INTERFACE CHANGE (additive): of a `cast` event, the number of modes chosen for that spell as it was cast (CR 601.2b, 700.2); read by `{q:'modesChosen'}`. */
  modesChosen?: number;
  /** Standard round 3, r3-trig INTERFACE CHANGE (additive): of an `activate` event of a loyalty ability, the loyalty counters its cost removed (CR 606.4); read by `{q:'loyaltyRemoved'}`. */
  loyaltyRemoved?: number;
  /** T38 INTERFACE CHANGE (additive): of an `activate` event of a mana ability (CR 605.1a), the mana that activation produced (CR 106.3); read by `ManaProduction` `eventProduced` ("one mana of any type that land produced"). */
  produced?: ManaType[];
  /**
   * FAST5X E19 INTERFACE CHANGE (additive): of a `cast` event, how many of the mana spent to cast that spell came from a source with each subtype, as it
   * produced the mana (CR 106.3; ManaUnit.sourceSubtypes): "if mana from a Treasure was spent to cast it". Absent when none did.
   */
  manaFrom?: Record<string, number>;
  /**
   * CLOUD std-dft INTERFACE CHANGE (additive): of a `cycle` action, the X announced for the cycling cost (CR 107.3a, 702.29a). The cycled card's own "when you
   * cycle ~" ability takes it as its X when it is put on the stack (triggers/stack.ts): "Cycling {X}{G}{G}" / "When you cycle this card, destroy up to one target
   * artifact or enchantment with mana value X".
   */
  x?: number;
  /**
   * M12F INTERFACE CHANGE (additive): of a `votesFinished` action event (CR 701.38a), every voter's votes in the order cast (the `votesFinished` GameEvent);
   * absent when the vote was resolved by hand. Read by the `voters` player reference ("each opponent who voted for a choice you voted for").
   */
  ballots?: { voter: PlayerId; votes: string[] }[];
  /** Snapshots taken before the event for look-back events (CR 603.10). */
  before: Record<ObjectId, LastKnown>;
}

/** A game object (CR 109): card, token, copy of a spell, ability on the stack, or emblem. */
export interface GameObject {
  id: ObjectId;
  kind: 'card' | 'token' | 'spellCopy' | 'ability' | 'emblem';
  /** Physical card this object represents (cards only). */
  cardId?: CardId;
  defId: DefId;
  owner: PlayerId;
  /**
   * Who controls it (CR 108.4). MX2 INTERFACE CHANGE: on the battlefield and the stack this is the controller AFTER layer 2 (CR 613.1b), kept in step with the
   * control-changing effects by core/control.ts#syncControl, so every call-site that reads it (attackers, blockers, activations, the untap step, the legend
   * rule, ...) sees the current controller. The controller the layers start from is `baseController` when it differs.
   */
  controller: PlayerId;
  /**
   * MX2 ADDITION: the controller before any control-changing effect (what it entered under, CR 110.2), present only while a layer-2 effect gives it another
   * controller (core/control.ts). Layer 2 starts from `baseController ?? controller` (statics/layers.ts). Gone with the object (CR 400.7).
   */
  baseController?: PlayerId;
  zone: ZoneKind;
  /** CR 613.7: timestamp, updated when the object enters a zone or changes control etc. */
  timestamp: number;

  // Permanent status (CR 110.5)
  tapped: boolean;
  flipped: boolean;
  faceDown: boolean;
  phasedOut: boolean;
  /** Face currently up for double-faced/split/flip handling (0 = front). */
  face: number;
  /** Turn number this object came under its controller's control (CR 302.6 summoning sickness). */
  controlledSinceTurn: number;

  counters: Record<string, number>;
  /**
   * r4-fxb INTERFACE CHANGE (additive): the timestamp of the latest keyword counter of each kind put on this object (CR 122.1b, 613.7c: a counter's effect has
   * the timestamp of when it was put on), written by rules/counters.ts#addCounters, read by statics/live.ts#counterEffects: a flying counter put on after a
   * "loses all abilities" effect began still gives flying. Absent = every keyword counter takes the object's own timestamp (as before).
   */
  counterStamps?: Record<string, number>;
  damage: number; // marked damage (CR 120.3e)
  /** CR 704.5h: dealt damage by a source with deathtouch since the last SBA check. */
  deathtouchDamaged: boolean;
  /** The object (or player, for "Enchant player") this Aura / Equipment / Fortification is attached to (CR 301.5, 303.4, 301.5a). */
  attachedTo?: ObjectId | PlayerId;
  /** CR 310.9: the player who protects this battle (it can be attacked by that player's opponents). */
  protector?: PlayerId;
  /** Choices made as it entered ("As ~ enters, choose a color"). */
  chosen?: Record<string, unknown>;
  /** Players allowed to see this object while it is in a hidden zone (revealed/looked at). */
  revealedTo?: PlayerId[];
  /** CR 607 link store of THIS object instance (a new object after any zone change, CR 400.7). Redacted like `chosen` for hidden objects. */
  links?: Record<LinkId, LinkValue>;
  /** Kept from the spell that became this permanent (CR 400.7d, 607.2i): costs paid, X, alternative cost, zone cast from. */
  // FAST4 T27 INTERFACE CHANGE (additive): `by`, the player who cast the spell (CR 601.2a; "if you cast it": Condition `wasCast.by`)
  // std-rx22 INTERFACE CHANGE (additive): `controlLost`, the permanent's controller changed at least once since it entered (core/control.ts), so the caster has not
  // controlled it without a break (Condition `wasCast.kept`, suspend's haste, CR 702.62a)
  cast?: { costsPaid: CostsPaid; x?: number; from: CastOrigin; via?: string; turn: number; by?: PlayerId; controlLost?: true };
  /**
   * trek-11 INTERFACE CHANGE (additive), CR 400.11b, 601.2a, 305.1: set ONLY on the staging object of a card a player plays from outside the game (core/zones.ts#stageFromOutside):
   * a card they own outside the game (`GameState.outside`) becomes this object, in its owner's hand, for the length of ONE special action (`playOutside`,
   * core/special/play-outside.ts), whose checks (actions/cast.ts#castCheck, actions/land.ts#landCheck) then read it as a card cast or played from no zone and move it to the
   * stack or the battlefield (the new object has no marker). It exists in no published state: a refused or cancelled action leaves the state it began with.
   */
  fromOutside?: true;

  /** Present while on the stack. */
  stack?: StackInfo;
  /** For tokens and other objects without a printed card: the definition lives in state.defs[defId]. */

  // ---- M6-0 ADDITIONS (m6 design 2.2; all optional, absent in every M5 state; util/clone.ts#cloneObject copies each) ----
  /**
   * CR 708.6, 702.37, 702.168, 701.40, 701.58: what made it face down and its profile. Present iff `faceDown` AND the object is on the battlefield or the
   * stack (a card exiled face down has no characteristics and no profile, CR 406.3a, 110.5d). The state holds the true method; views of other players show
   * 'megamorph' as 'morph' (CR 702.37b-c). Written from M6-3.
   */
  faceDownInfo?: FaceDownInfo;
  /** CR 702.37f, 702.168e: X chosen when the turn-face-up special action was taken; other abilities of the permanent read it (`q: 'faceUpX'`). */
  faceUpX?: number;
  /** CR 718.3b, 718.2a: cast prototyped (copiable: CR 718.3c-d). */
  prototyped?: boolean;
  /**
   * std-ry7 INTERFACE CHANGE (additive), CR 702.103b, 702.103f: cast for its bestow cost, a bestowed Aura spell, and the permanent it becomes while it stays
   * attached (rules/base-parts/bestow.ts gives it the Aura's characteristics); it ends when the Aura becomes unattached or a new object is made (CR 400.7).
   */
  bestowed?: boolean;
  /** CR 716.2b: Class level designation (absent = level 1, CR 716.2d). Not copiable. */
  classLevel?: number;
  /** CR 719.3b solved, CR 722.3a prepared: designations of a permanent; they end when it leaves the battlefield. */
  solved?: boolean;
  /** Cloud r3-mech INTERFACE CHANGE (additive), CR 701.64: the harnessed designation of a permanent (effects/handlers/levels.ts); a new object has none (CR 400.7). */
  harnessed?: boolean;
  prepared?: boolean;
  /**
   * FAST5X E3 INTERFACE CHANGE (additive), CR 702.171b: the saddled designation. It lasts until the end of the turn (core/steps.ts, cleanup, CR 514.2) or until
   * the permanent leaves the battlefield (a new object, CR 400.7). Not copiable (CR 702.171b).
   */
  saddled?: boolean;
  /**
   * FAST5X E3 INTERFACE CHANGE (additive), CR 702.171c: the creatures that saddled this permanent this turn (tapped to pay the cost of its saddle ability,
   * whether or not the ability resolved), by their battlefield ids. Cleared with `saddled` at the end of the turn.
   */
  saddledBy?: ObjectId[];
  /**
   * r5-fxb INTERFACE CHANGE (additive), CR 702.122c: the creatures that crewed this Vehicle this turn (tapped to pay the cost of its crew
   * ability, whether or not the ability resolved), by their battlefield ids. Cleared in the cleanup step, as `saddledBy`.
   */
  crewedBy?: ObjectId[];
  /**
   * FAST5X E12 INTERFACE CHANGE (additive), CR 701.60a-d: the suspected designation, as the timestamp it got when it became suspected (the timestamp of the
   * rule-generated layer 6 effect that gives it menace and "This creature can't block", statics/suspect.ts). It lasts until the permanent leaves the
   * battlefield (a new object, CR 400.7, has none) or an effect makes it no longer suspected; a control change keeps it. Not copiable (CR 701.60b).
   */
  suspected?: number;
  /**
   * FAST5 T37 ADDITION, CR 701.37b: the monstrous designation. A marker only the monstrosity action (effects/handlers/actions-native-counters.ts) sets and reads
   * ("if this permanent isn't monstrous"); once set it stays until the permanent leaves the battlefield (a new object, CR 400.7, has none). Not copiable.
   */
  monstrous?: boolean;
  /**
   * std-ry8 ADDITION, CR 702.112b: the renowned designation. A marker only the renown action (effects/handlers/actions-native-counters.ts) sets; once set it stays
   * until the permanent leaves the battlefield (a new object, CR 400.7, has none). Not copiable.
   */
  renowned?: boolean;
  /**
   * FAST5X E8 INTERFACE CHANGE (additive), CR 709.5c: the unlocked designations of a permanent with a shared type line (a Room), as the indices of its unlocked
   * halves (0 = left, 1 = right; ascending, no duplicates). Absent or empty: every half is locked. Only on the battlefield; not copiable (a copy has the halves,
   * CR 709.5b, but not the designations); a new object has none (CR 400.7). Written only by core/rooms.ts.
   */
  unlocked?: number[];
  /** CR 722.3c: on a prepared permanent, the copy of its prepare spell in exile; on that copy, the permanent it belongs to. */
  preparedCopy?: ObjectId;
  preparedFor?: ObjectId;
  /**
   * CR 712.4a (melded), CR 730 (merged): the cards and tokens this one object is represented by, TOPMOST FIRST. Absent for an ordinary object. Melded:
   * `defId` is the meld RESULT's definition (CR 712.8g) and `cardId` is absent (two cards represent it). Merged: `defId`/`cardId` are those of the topmost
   * component (CR 730.2a, 730.2d).
   */
  components?: Component[];
  /** CR 701.27f: the value of `counters.timestamp` (the game's timestamp counter) when it last transformed or converted. */
  transformedAt?: number;

  // ---- M11-0 ADDITION (m11 design 4.2; absent in every state outside a Commander game; copied by util/clone.ts#cloneObject's spread) ----
  /**
   * CR 903.9a, 704.6d: this commander was put into a graveyard or exile since state-based actions were last checked, so its owner may now put it into the
   * command zone. Set on the new object by the move (CR 400.7) and removed when the state-based action has asked (whatever the answer). Written from M11-1.
   */
  commanderMoved?: true;
  /**
   * M11-1 INTERFACE CHANGE (additive; review finding 2, CR 400.2, 708.2): combat damage this commander dealt to each player (by player id) while it was a
   * face-down permanent. Counting it in `PlayerState.commanderDamage` (keyed by its public card id) would tell the other players what it is, so it waits here
   * (private: core/view.ts#hiddenObject strips it) until the permanent is turned face up or leaves the battlefield (CR 708.9); then it joins the public tally
   * with its `commanderDamage` event (core/commander-damage.ts). CR 704.6c reads both. Replaced, never edited in place (the clone shares it).
   */
  hiddenCommanderDamage?: Record<PlayerId, number>;
  /**
   * M12-1 ADDITION (m12 design D14, 4.2; absent = not goaded): CR 701.15a-d: the players who goaded this creature, one entry per goader (CR 701.15c: goaded
   * by several players, it must attack a player other than each of them if able; goaded again by the same player, the entry stays one). Each entry ends at
   * the start of that goader's next turn, or when that turn would have begun if the goader has left the game (CR 800.4m; core/durations.ts, M12-2). No turn
   * number is stored: extra and skipped turns and a goader who leaves are read when the turn begins. Written by the native goad action (M12-3).
   */
  goaded?: { by: PlayerId }[];
  /**
   * MX4 INTERFACE CHANGE (additive), CR 309.4: on a dungeon card in the command zone, the room its owner's venture marker is on (an index into the dungeon's
   * rooms, core/dungeons.json; 0 = the topmost room, CR 309.4a).
   */
  ventureRoom?: number;
}

/** M6-0 (m6 design 2.2): how a face-down permanent or spell came to be face down (CR 708.6) and its face-down profile (CR 708.2a, 702.168a). */
export interface FaceDownInfo {
  by: 'morph' | 'megamorph' | 'disguise' | 'manifest' | 'cloak' | 'effect';
  profile: FaceDownProfile;
}

/** M6-0 (m6 design 2.2): one card or token of a melded or merged object (CR 712.4a, 730.2). */
export interface Component {
  kind: 'card' | 'token';
  defId: DefId;
  cardId?: CardId;
  owner: PlayerId;
  /** CR 730.2e: a face-down component (mutating onto a face-down creature) keeps its own status. Redacted in views like any face-down card. */
  faceDown?: boolean;
  /**
   * M6-9 INTERFACE CHANGE (additive; m6 design 3.7, E20): the value of the timestamp counter when this component merged with the permanent (CR 730.2a: the
   * merged permanent's copiable effect has the timestamp of the merge). Absent for the component the permanent was before any merge (and for the cards of a
   * melded permanent), so a merged permanent is one with a component that has it (statics/merge.ts#isMergedObject). It also names the component's link
   * namespace (`merge@<object>@<mergedAt>`, CR 607, 707.7): the original component keeps the bare link ids of the permanent's link store.
   */
  mergedAt?: number;
}

/**
 * M6-0 (m6 design 2.2): the copiable values a copy effect gives (CR 707.2-707.3, 707.8, 707.9, 708.10, 712.8e, 712.8g, 718.3d, 730.2a), fixed when the
 * effect begins (CR 707.2b-c). Built by statics/copy.ts#copiableValuesOf (M6-2) as ALL of layer 1 of the copied object, never from its layered
 * characteristics.
 */
export interface CopiableValues {
  /**
   * The definition whose characteristics are copied: the copied object's face up for a DFC (CR 707.8), the meld result for a melded permanent (CR 712.8g),
   * the pseudo-definition `__facedown__` / `__facedown_ward2__` for a face-down object (CR 708.2: the profile IS its copiable values; the hidden card is
   * never referenced). A flip card's definition with face 0: the half is chosen by the AFFECTED object's status.
   */
  defId: DefId;
  face: number;
  /** CR 718.3d: the copied permanent was prototyped. */
  prototyped?: boolean;
  /** CR 202.3b-c, 712.8e, 712.8g: the copied face is a nonmodal DFC's back face or a melded face: the copy's mana value is 0. */
  manaValueZero?: true;
  /**
   * FAST5 T64 (CR 707.9b, 707.9c): the copy's name, when an exception keeps it ("except its name is Chameleon, Master of Disguise" is `retain: ['name']`): the
   * copy has this name instead of the copied definition's. Part of the copiable values, so a copy of the copy has it too (CR 707.2).
   */
  name?: string;
  /** CR 707.9d: the copied characteristic-defining abilities that an exception overrides (and the color indicator for 'colors'). */
  dropCda?: ('colors' | 'types' | 'subtypes' | 'power' | 'toughness')[];
  /**
   * CR 707.9, 707.3, 613.2a: concrete modifications that are part of the copiable values, in order along the whole chain (oldest first): copy exceptions
   * (retained values materialized, conditional ones resolved) and the P/T-setting "as enters" / "as turned face up" effects.
   */
  except: Modification[];
  /** CR 702.140e, 730.2a: the other components of a merged permanent, whose abilities the copy also has. */
  alsoAbilitiesOf?: { defId: DefId; face: number }[];
}

/** An attacking creature (CR 508.1k). */
export interface AttackerState {
  id: ObjectId;
  /** The player, planeswalker or battle it attacks; null once that planeswalker or battle left combat (CR 506.4c): it deals no combat damage. */
  defender: PlayerId | ObjectId | null;
  /** The player it was attacking or whose planeswalker / battle it was attacking (CR 508.5). */
  defendingPlayer: PlayerId;
  /** Creatures currently blocking it (declared blockers that are still in combat). */
  blockedBy: ObjectId[];
  /** CR 509.1h: set when blockers are declared and unchanged by blockers leaving. */
  blocked: boolean;
}

/** Combat bookkeeping (CR 506-511). Exists from the beginning of combat step until the end of combat step (CR 511.3). */
export interface CombatState {
  /** Which combat phase of the turn this is: 1 for the first, 2 for an extra one, ... (CR 500.8). Stamps `HistoryEntry.combat`. */
  number: number;
  /** True once at least one creature was declared as an attacker: only then do the declare blockers and combat damage steps happen (CR 508.8). */
  attacked: boolean;
  attackers: AttackerState[];
  /** Blocking creatures and the attackers they block. */
  blockers: { id: ObjectId; blocking: ObjectId[]; /** The player who declared it as a blocker: a blocker whose controller is no longer this player is removed from combat (CR 506.4). */ defendingPlayer: PlayerId }[];
  /** Combat damage steps that have happened (0, 1 or 2; CR 510.4). */
  damageSteps: number;
  /** True after the first-strike combat damage step: the regular combat damage step must follow (CR 510.4, 702.7b). */
  extraDamageStep: boolean;
  /** Attackers and blockers that had first strike or double strike as the first combat damage step began (CR 702.7b-c, 702.4b). */
  firstStrikers: ObjectId[];
}

/** A continuous effect created by a resolving spell or ability (CR 611.2). Static abilities store nothing: they are re-derived (CR 611.3a). */
export interface ContinuousEffectRec {
  id: string;
  source: ObjHandle | null;
  sourceName: string;
  controller: PlayerId;
  /** CR 613.7b: one timestamp per effect (all its modifications share it). */
  timestamp: number;
  startedTurn: number;
  duration: Duration;
  /**
   * The effect as created: every non-`live` Quantity replaced by its number (CR 611.2d, 608.2h) and every reference to a specific object
   * replaced by `{ref:'fixed'}` (CR 611.2c: for effects that change characteristics or control the affected set, including an `each`
   * filter, is determined when the effect begins and never changes).
   */
  effect: StaticEffect;
  /** Remaining uses of a shield: "prevent the next 3 damage" (CR 615.7), "the next time" (CR 615.8). */
  usesLeft?: number;
  /**
   * WP15 INTERFACE CHANGE (review): for a `{d:'whileSource', as:'attached'}` duration ("for as long as ~ remains attached to it"), what the source was attached
   * to as the effect began; the effect ends when the source is attached to anything else or to nothing (CR 611.2b, 301.5c). Set by the `effect` handler.
   */
  attachedTo?: ObjectId | PlayerId;
  /** M6-0 (m6 design 2.2), M6-2: the snapshot a copy effect applies (written once by effects/copy.ts#beginCopy; never by card data). */
  copy?: CopiableValues;
  /**
   * M6-0 (m6 design 2.2), M6-2, CR 613.2a: created by an "as ~ enters" or "as ~ is turned face up" ability that sets power and toughness (Primal Clay,
   * Aquamorph Entity): its modifications apply in layer 1a with this record's timestamp and are part of the copiable values (CR 707.2).
   */
  asEntry?: true;
}

/*
 * Transition T1 (design 4.5) is complete: milestone 4's legacy records (a string `duration`, an open `effect: {kind}`) are gone. WP11 migrated the
 * regeneration shields, WP16 the player restrictions, and WP31 removed `LegacyContinuousEffect`, `ContinuousEffectEntry`, `isTypedEffect` and
 * `isLegacyEffect` (INTERFACE CHANGE): `GameState.continuousEffects` holds only typed `ContinuousEffectRec`s.
 */

/** Does this effect have the simple duration `d` ('endOfTurn', 'endOfCombat', ...)? */
export function hasSimpleDuration(e: ContinuousEffectRec, d: Duration['d']): boolean {
  return e.duration.d === d;
}

/** A delayed triggered ability waiting for its event (CR 603.7). */
export interface DelayedTriggerRec {
  id: string;
  source: ObjHandle;
  /** CR 603.7d-g. */
  controller: PlayerId;
  when: Extract<EffectStep, { op: 'delay' }>['when'];
  do: EffectStep[];
  /** Names captured at creation with the zone each object was expected in (CR 603.7c). */
  captured: Record<Name, ObjHandle[]>;
  /** Variables fixed at creation (CR 608.2h). */
  vars: Record<string, number>;
  createdTurn: number;
  duration?: Duration;
  /** FAST5 T45: with a `duration`, triggers only once ("When you next cast ... this turn"); see `delay.once` (types/ability.ts). */
  once?: boolean;
  /** FAST5 T50 (CR 603.2c): the event is a "one or more" batch: the matching events of one batch are one occurrence (the `batch` of the `delay` step). */
  batch?: boolean;
  /** std-tdm (CR 603.7, 603.3d): the targets of the delayed triggered ability, chosen when it is put on the stack (`delay.targets`, types/ability.ts). */
  targets?: TargetSpec[];
  firedCount: number;
  /** M6-0 (m6 design 2.2), CR 701.27f: the timestamp counter when the delayed ability was created ("if it hasn't transformed since"). Read from M6-4. */
  createdAt?: number;
}

/**
 * FAST4 MX1 ADDITION: a zone change "until" an event (CR 610.3: "exile target creature an opponent controls until this creature leaves the battlefield").
 * Written by the `move` handler (effects/handlers/zones-move.ts) after the first one-shot effect; when the event happens, core/durations.ts#endDurations
 * deletes it and the second one-shot effect returns each object still in the zone it was moved to (CR 610.3, 400.7) to its previous zone, under its
 * owner's control (CR 610.3c), all records ended by the same events at once (CR 610.3d). Not a triggered ability: nothing goes on the stack.
 */
export interface UntilMoveRec {
  id: string;
  /** The source whose event ends it (the object on the battlefield as the move happened; a new object is not it, CR 400.7). */
  source: ObjHandle;
  controller: PlayerId;
  duration: Extract<Duration, { d: 'until' }>;
  /** The objects the move made (in the zone they were moved to) and the zone each returns to. */
  objects: { object: ObjHandle; back: ZoneKind }[];
  /** Name of the source for the log. */
  sourceName: string;
}

/** What the "happened this turn" conditions and the history filters read (CR 603.4 style). Pruned at cleanup, except game-scope entries. */
export interface HistoryEntry {
  turn: number;
  /** Combat number inside the turn, for scope 'combat'. */
  combat: number;
  ev: EventPattern['ev'];
  actor?: PlayerId;
  subject?: ObjectId;
  /** Characteristics summary good enough to re-run an ObjectFilter ("a creature died this turn"). */
  facts: Record<string, string | number | boolean>;
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive): the index of `GameState.history` where the entries of this entry's simultaneous batch begin (CR 603.2c;
   * triggers/stack.ts): two entries with the same `batch` happened at the same time. Absent on an entry written without it (each is then a batch of its own).
   */
  batch?: number;
}

export interface DesignationState {
  monarch?: PlayerId;
  initiative?: PlayerId;
  dayNight?: 'day' | 'night';
  /** Players who have the city's blessing (CR 702.131c): once gained it stays for the rest of the game. */
  citysBlessing?: PlayerId[];
  /**
   * FAST5X E18 ADDITION (INTERFACE CHANGE, optional): players who have an enduring story (Storied reminder text: "If you control three or more artifacts,
   * legendaries, and/or Sagas, you have an enduring story for the rest of the game."). Like the city's blessing (CR 702.131c) it is kept for the rest of the
   * game and is not a counter (CR 122). Written only by core/enduring-story.ts.
   */
  enduringStory?: PlayerId[];
  /** Player speed 0-4 (CR 702.179). A player absent here has no speed (CR 702.179b); written only by core/designations.ts. */
  speed?: Record<PlayerId, number>;
  /**
   * FAST5X-4 ADDITION (INTERFACE CHANGE, optional): the turn number in which each player's inherent speed ability last triggered ("This ability triggers only
   * once each turn", CR 702.179d). Written only by core/designations.ts.
   */
  speedTriggered?: Record<PlayerId, number>;
  /**
   * MX4 INTERFACE CHANGE (additive), CR 309.7: the names of the dungeons each player has completed this game, in order (one entry per completion). Written by
   * core/dungeons.ts; read by the `completedDungeon` condition. Absent = nobody has completed a dungeon.
   */
  completedDungeons?: Record<PlayerId, string[]>;
  /** MX3 ADDITION (CR 701.54): the Ring, per player it has tempted (absent for a player it never tempted). Written only by core/ring.ts. */
  ring?: Record<PlayerId, RingState>;
}

/** MX3 (CR 701.54): one player's Ring. */
export interface RingState {
  /** How many times the Ring has tempted this player this game (CR 701.54c-d). */
  tempted: number;
  /**
   * The permanent chosen last as this player's Ring-bearer (CR 701.54a-b). It is the Ring-bearer only while it is on the battlefield under this player's
   * control (CR 701.54e); core/ring.ts drops it when another player gains control of it (CR 701.54a). A permanent that left the battlefield is a new object
   * (CR 400.7), so its id no longer names a permanent.
   */
  bearer?: ObjectId;
  /** The emblem named The Ring in this player's command zone (CR 701.54c). */
  emblem?: ObjectId;
}

/** A chip the UI shows until `until` passes: manual shields and unenforced one-shot text ("If it would die this turn, exile it instead."). */
export interface ManualReminder {
  id: string;
  text: string;
  sourceName: string;
  controller: PlayerId;
  until: Duration;
  createdTurn: number;
  /**
   * WP15 INTERFACE CHANGE (review): the source of the effect the chip stands for, so a `whileSource` chip ends when the source leaves and an `until ~ leaves
   * the battlefield` chip when it does (core/durations.ts). WP10's `askManual` sets it from `cx.source` when it leaves a chip; without it such a chip never ends.
   */
  source?: ObjHandle;
}

/** One engine happening in the shape triggers, replacements and history need. Produced by the normalizer (WP8) from GameEvents. */
export interface SemEvent {
  ev: EventPattern['ev'];
  seq: number;
  /** Events produced by one simultaneous action share a batch id (CR 603.2c, 603.6a, 603.10a). */
  batch: number;
  roles: Partial<Record<EventRole, RoleValue>>;
  data: Record<string, string | number | boolean | undefined>;
  /** Last known information of objects as they were just before the event (look-back events). */
  before: Record<ObjectId, LastKnown>;
}

/** Event kinds that "look back in time" (CR 603.10a-g); decided by code from the pattern, never stored in card data. */
export type LookBackKind =
  | 'leavesBattlefield' | 'sacrifice' | 'leavesGraveyard' | 'visibleToHandOrLibrary' // 603.10a
  | 'phaseOut' | 'unattach' | 'controlLost' | 'spellCountered' | 'playerLoses' | 'planeswalkAway'; // 603.10b-g

/** A triggered ability that has triggered but has not been put on the stack yet (CR 603.3). */
export interface PendingTrigger {
  id: string;
  sourceId: ObjectId;
  sourceName: string;
  controller: PlayerId;
  abilityRef: AbilityRef;
  context: EventContext;
  /** For delayed/reflexive triggers: the inline ability. */
  inline?: AbilityDef;
  /** Specs of targets already known when it was created (reflexive triggers choose targets on being put on the stack, CR 603.3d). */
  targetSpecs?: TargetSpec[];
}

/** Last known information about an object that left a zone (CR 608.2h, 603.10). */
export interface LastKnown {
  object: GameObject;
  /** Characteristics computed at the moment it left (layers applied), filled by `moveObject` (CR 608.2h, 603.10). */
  chars: Chars | null;
  leftZone: ZoneKind;
  newId?: ObjectId;
  /**
   * CR 712.21c: the other cards a melded permanent became as it left the battlefield (`newId` is its first card). An effect that finds the new object finds
   * each of them too (effects/refs.ts#alsoBecameHandles). Set by core/move-parts/components.ts.
   */
  alsoBecame?: ObjectId[];
  /**
   * FAST4 T34 ADDITION (INTERFACE CHANGE, additive): whether the permanent was an attacking or a blocking creature as it left the battlefield (CR 506.4
   * removes it from combat as it leaves, so the combat state cannot say it afterwards; CR 608.2h: "if it wasn't attacking" reads it as it last existed).
   * Absent: it was in no combat. Set by core/zones.ts#moveObject; read by rules/filter.ts for an object that is only last known information.
   */
  /**
   * r5-fxb ADDITION (additive): what was attached to the permanent as it left the battlefield (CR 603.10a, 700.9, 301.5): equipped (an Equipment attached) and
   * modified (a counter on it, an Equipment attached, or an Aura its controller controls attached); the Aura may leave with it or go to the graveyard after,
   * so the battlefield cannot say it afterwards. Set by core/zones.ts#moveObject; read by rules/filter.ts#isEquipped / isModified for last known information.
   */
  attached?: { equipped: boolean; modified: boolean; ids?: ObjectId[] }; // `ids`: the permanents attached to it then (filter `wasAttachedTo`)
  /**
   * std-combat-3 ADDITION (additive), CR 603.10a: the permanents on the battlefield immediately before it left (itself included; for objects that leave together,
   * before the first of them moved, core/zones.ts#leavingTogether). A leaves-the-battlefield trigger "looks back in time": a quantity in its pattern ("with the
   * greatest power among creatures that player controls") is read on the battlefield as it was then (triggers/lookback-board.ts). Set by core/zones.ts#moveObject.
   * Review 2026-10-26 F18: frozen, and shared by every object that left in the same event.
   */
  board?: readonly ObjectId[];
  combat?: {
    attacking: boolean;
    blocking: boolean;
    /**
     * FAST5X E7 ADDITION (additive): when it was attacking, what it was attacking and the defending player (`AttackerState.defender` / `defendingPlayer`,
     * CR 508.5): "attacking the same player, planeswalker, or battle as the creature that was returned" (sneak, CR 702.190b) reads it after it left.
     */
    defender?: PlayerId | ObjectId | null;
    defendingPlayer?: PlayerId;
    /**
     * p2-combat-flow-1 ADDITION (additive): when it was attacking, the creatures blocking it then (`AttackerState.blockedBy`; CR 506.4: they remain blocking
     * creatures after it left): "sacrifice it. If you do, it deals 4 damage to each creature blocking it" (Ib Halfheart) reads them (rules/filter.ts).
     */
    blockedBy?: ObjectId[];
    /** p2-combat-flow-1 ADDITION (additive): when it was blocking, the attackers it blocked then ("whenever a creature blocking ~ dies", rules/filter.ts). */
    blockingIds?: ObjectId[];
  };
  /**
   * Cloud C3 (batch 3) ADDITION (additive): the players who goaded the permanent through a static ability as it left the battlefield ("enchanted creature is
   * goaded", `RestrictionDef.goad`; CR 701.15a-c, 603.10a, 608.2h): the static designation ends with it, so "whenever a goaded creature dies" reads it here.
   * Absent: none (the goad action's entries are in `object.goaded`). Set by core/zones.ts#moveObject; read by rules/filter.ts.
   */
  goadedBy?: PlayerId[];
}

/** A log line. `text` is public; `privateText` replaces it for the listed players (hidden info). */
export interface LogEntry {
  seq: number;
  turn: number;
  text: string;
  /** Comprehensive Rules citations, e.g. ["CR 704.5a"]. */
  rules?: string[];
  privateText?: { players: PlayerId[]; text: string };
  level?: 'info' | 'action' | 'warning' | 'manual' | 'error';
}

export interface GameResult {
  winner: PlayerId | null; // null = draw (CR 104.4)
  reason: string;
}

/** A suspended action waiting for a player's decision; see core/apply.ts. */
export interface Suspension {
  /** The settled state the action started from. */
  base: GameState;
  /** The action being performed. */
  action: Action;
  /** Answers given so far, in the order decisions were asked. */
  answers: DecisionAnswer[];
  /**
   * M12-2 INTERFACE CHANGE (additive; multiplayer games only, absent in every two-player state, m12 design D16): who gave each of `answers` (the player of
   * the decision it answered). When a re-run (a concession, D11) asks a decision of another player at that position, the answer is refused
   * (IllegalAnswer, core/game.ts#choose): an answer never passes from one player to another. The answers of a player who concedes are dropped before
   * the re-run.
   */
  answeredBy?: PlayerId[];
  /**
   * INTERFACE CHANGE (additive, optional): how many events the run had reported when it stopped for this decision (`applyAction` returned them with this
   * state). Answering re-runs the action from `base`, so the answer's events begin with these very events again (determinism); `replayedEvents`
   * (core/apply.ts) tells a screen how many of them it was already given, so a trigger is not animated twice. Absent: unknown (a concession's re-run).
   */
  emitted?: number;
}

export interface GameOptions {
  startingLife: number; // CR 103.4
  startingHandSize: number; // CR 103.5
  /** Skip the mulligan process (useful for tests and scenarios). */
  skipMulligans?: boolean;
  /** Who plays first; if absent it is determined randomly and the chosen player decides (CR 103.1). */
  startingPlayer?: PlayerId;
  /**
   * M11-0 (m11 design 4.1): present exactly in a Commander game (CR 903; Duel Commander and Brawl as variants of it). Absent: the normal game, unchanged.
   * Set by core/create.ts#initialState from `GameConfig.options.commander` (each player's `PlayerConfig.commanders` then names their commander cards).
   */
  commander?: CommanderOptions;
  /**
   * M12-1 (m12 design D1, 4.1): present exactly in a game that began with 3 or 4 players (CR 800.1: "a game that begins with more than two players"); a game
   * reduced to two players stays multiplayer. Absent: the two-player game, unchanged. core/create.ts#initialState refuses it with two players and refuses 3-4
   * players without it.
   */
  multiplayer?: MultiplayerOptions;
}

/** std-rq: the creatures that may attack during one added combat phase: the filter, read for the controller of the effect that added it and its source. */
export interface AttackersOnly {
  filter: ObjectFilter;
  controller: PlayerId;
  sourceId?: ObjectId;
  /** The creatures that match, fixed as the declare attackers step of that combat phase begins (core/turn-effects.ts#fixAllowedAttackers). */
  allowed?: ObjectId[];
}

/**
 * std-control-3: one player-controlling effect (CR 723.1): `controller` makes `player`'s decisions during `player`'s next turn, or during the next combat
 * phase of a turn of theirs (`during`). `active` once that turn or combat phase has begun; the record is removed as it ends (core/player-control.ts).
 */
export interface PlayerControlRec {
  id: string;
  controller: PlayerId;
  player: PlayerId;
  during: 'turn' | 'combat';
  /** CR 723.1a: of two active records for one player, the most recently created one works. */
  timestamp: number;
  active?: true;
  /** For the log. */
  sourceName: string;
}

export interface GameState {
  schema: 1;
  seed: string;
  rng: RngState;
  options: GameOptions;
  /** Compiled card definitions used in this game (cards, tokens, emblems). */
  defs: Record<DefId, CardDef>;
  /** Players in turn order (CR 101.4). */
  players: PlayerState[];
  objects: Record<ObjectId, GameObject>;
  zones: {
    library: Record<PlayerId, ObjectId[]>; // index 0 = top
    hand: Record<PlayerId, ObjectId[]>;
    graveyard: Record<PlayerId, ObjectId[]>; // last = top
    battlefield: ObjectId[];
    stack: ObjectId[]; // last = top (CR 405.2)
    exile: ObjectId[];
    command: ObjectId[];
  };
  turn: {
    number: number; // 0 before the first turn begins
    activePlayer: PlayerId;
    step: Step;
    startingPlayer: PlayerId;
    /** Extra turns queued (CR 500.7). */
    extraTurns: PlayerId[];
    /**
     * audit-fix-2 INTERFACE CHANGE (additive): the id of each queued extra turn, in the same order as `extraTurns` (core/turn-effects.ts#addExtraTurns adds both
     * at the front, core/turn.ts takes both from the front), so "During that turn" can name the extra turn an effect created (`Duration` `duringNextTurn.turn`,
     * CR 500.7, 611.2a). Absent in a state with no extra turn added yet. `extraTurnSeq`: the last id given. `extraTurnId`: the id of the current turn when it is
     * an extra turn with one.
     */
    extraTurnIds?: number[];
    extraTurnSeq?: number;
    extraTurnId?: number;
    /** Steps to skip this turn. */
    skipSteps: Step[];
    /** CR 514.3a: another cleanup step follows the current one. */
    cleanupAgain?: boolean;
    /** Combat phases that have begun this turn (CR 500.8); reset when the turn begins. Numbers `CombatState.number`. */
    combats?: number;
    /**
     * FAST5X E17 ADDITION (optional, absent = none yet): main phases that have begun this turn (CR 505.1b: "first main phase", "second main phase" count the
     * main phases that have occurred in the current turn; an additional main phase counts too, CR 505.1a). Set as a main phase begins (core/turn.ts#beginStep),
     * cleared when the turn begins; the `stepBegan` event of a main phase carries its number (`mainPhase`).
     */
    mains?: number;
    /**
     * WP15 ADDITION (optional, absent = none): phases an effect added to this turn (CR 500.8), each to happen right after the next end of a phase of the kind
     * `after` (the current phase included). Several added after the same phase: the most recently created one occurs first (the last entry here).
     */
    extraPhases?: { after: PhaseKind; phase: 'combat' | 'main'; attackers?: AttackersOnly }[];
    /**
     * std-rq ADDITION (optional, absent = none): while an added combat phase with an attacker restriction is under way ("Only land creatures can attack during
     * that combat phase", CR 500.8, 508.1), the creatures that may attack in it. Set as that phase begins (core/turn.ts), removed as any phase ends and at the turn's start.
     */
    combatAttackers?: AttackersOnly;
    /**
     * r4-fxb ADDITION (optional, absent = none): steps an effect added to this turn (CR 500.9), each right after the step `afterStep`, or after the next end of a phase
     * of the kind `afterPhase`. Several added after the same step or phase: the most recently created one occurs first (the last entry here).
     */
    extraSteps?: { afterStep?: Step; afterPhase?: PhaseKind; step: Step }[];
    /**
     * Standard round 10 ADDITION (optional, absent = none): riders on the next spell a player casts this turn ("the next spell you cast this turn can't be
     * countered", op `nextSpell`, CR 601.2i, 611.2): each applies to the first spell `player` casts after it was created that matches `filter`, read with
     * `controller` as "you" and `sourceId` as the source, and is then removed (actions/cast.ts#takeNextSpellRiders). Cleared as a turn begins ("this turn").
     */
    nextSpell?: {
      player: PlayerId; controller: PlayerId; sourceId?: ObjectId; filter?: ObjectFilter; rider: 'cantBeCountered' | 'keyword' | 'free';
      /** std-rx26 ADDITION: the keyword a `keyword` rider gives the spell, from the moment it is put on the stack to be cast (core/turn-effects.ts#lockNextSpellKeywords). */
      keyword?: KeywordAbilityDef;
    }[];
    /** r4-fxb ADDITION (optional): while added steps run, the steps they were added after (the last is the running one's): the turn resumes as if it had just ended. */
    stepResume?: Step[];
    /** WP15 ADDITION (optional): while an added phase runs, where the turn resumes once it ends: the last step of the phase it was added after, and whether that phase was an added one itself. */
    phaseResume?: { after: Step; added: boolean }[];
    /** WP15 ADDITION (optional): an effect ended the turn (CR 724.1): nobody gets priority, the current step ends and the game skips to the cleanup step. */
    ending?: boolean;
    /** WP15 ADDITION (optional): this turn is an extra turn (CR 500.7). */
    extra?: boolean;
    /**
     * WP15 ADDITION (optional, present only while extra turns run): the active player of the last turn that was not an extra turn; the normal turn order
     * continues from it (CR 500.7: extra turns are added directly after a turn).
     */
    normalActive?: PlayerId;
  };
  /** Game start procedure stage (CR 103). 'playing' once the first turn has begun. */
  stage: 'choosePlayOrder' | 'mulligan' | 'playing' | 'over';
  priority: {
    player: PlayerId | null;
    /** Number of consecutive passes (CR 117.4: all players pass in succession). */
    passes: number;
    /**
     * TRG-STOP ADDITION (optional; absent = none, so states saved before it still load): the controller of the triggered ability that resolved last and
     * left the stack empty (CR 117.3b). Smart auto-pass stops for every player who can act in this step even when it is not one of their stops
     * (`shouldAutoPass`), so a beginning-of-combat trigger (Irma, Part-Time Mutant) can be answered before attackers are declared. Cleared when another
     * object resolves or a step begins.
     */
    afterTrigger?: PlayerId;
    /**
     * TRG-STOP2 ADDITION (optional; absent = 0): how many objects were left on the stack by the last resolution in this step (CR 117.3b). The objects above
     * them were put on the stack since; smart auto-pass passes for a player only on their own spell or activated ability among those (Arena, CR 117.3c),
     * so after a resolution they get a chance at their own spell again. Cleared when the stack is empty or a step begins.
     */
    stackBase?: number;
    /**
     * RES-ALL ADDITION (optional; absent = nobody): the players who chose "Resolve all" (`pass` with `resolveAll`): smart auto-pass passes for them until
     * the stack is empty. A player is taken off when another player casts a spell or activates an ability (`resetPasses`); cleared when the stack is
     * empty or a step begins.
     */
    resolveAll?: PlayerId[];
  };
  combat: CombatState | null;
  continuousEffects: ContinuousEffectRec[];
  pendingTriggers: PendingTrigger[];
  /**
   * Activations this turn per `<objectId>|<abilityKey>` (CR 602.5b "once each turn", CR 606.3 loyalty abilities). Reset every turn. Also the triggerings of a
   * limited trigger (`<objectId>|trigger:<key>`, CR 603.2h) and, FAST5X E17, the resolutions of an ability this turn (`<objectId>|resolved:<key>`, read by
   * `{q:'resolvedThisTurn'}`, CR 608.2).
   */
  turnActivations: Record<string, number>;
  /** Delayed triggered abilities (CR 603.7) waiting for their event. */
  delayedTriggers: DelayedTriggerRec[];
  /**
   * FAST4 MX1 ADDITION (optional, created by the first move "until" an event; absent = none, so states saved before it still load): zone changes waiting
   * for the event they last until (CR 610.3). Not read by the layers (rules/characteristics.ts#FINGERPRINTED lists only keys every new state has).
   */
  untilMoves?: UntilMoveRec[];
  /**
   * r5-dig ADDITION (optional; absent = no card exiled yet, so states saved before it still load): how many cards an effect of each source object has exiled
   * ("exile ... with ~", CR 607.2a), by the object id of the source (a new object after a zone change has its own count, CR 400.7). Read by the duration
   * `untilExiledWith` (core/durations.ts).
   */
  exiledWith?: Record<ObjectId, number>;
  /**
   * FAST5 MX7 INTERFACE CHANGE (additive, optional; present only when a player config gave a sideboard, so states saved before it still load): the cards each
   * player owns outside the game (CR 400.11, 400.11a: the sideboard, CR 100.4), as definition ids, one entry per card. They are no objects (outside the game
   * is not a zone, CR 400.11; they can't be affected, CR 400.11c) until an effect brings one into the game (CR 400.11b; learn, CR 701.48a), which removes
   * its entry (core/zones.ts#bringIntoGame). Hidden: a view shows a player only their own (core/view.ts). Not read by the layers.
   */
  outside?: Record<PlayerId, DefId[]>;
  /**
   * std-control-3 ADDITION (optional, absent = none, so states saved before it still load): "you control target opponent during their next turn / their next
   * combat phase" (CR 723.1), waiting or active (core/player-control.ts). Not read by the layers.
   */
  playerControl?: PlayerControlRec[];
  /** What "happened this turn" conditions and history filters read (CR 603.4). Filled by the trigger normalizer (WP8). */
  history: HistoryEntry[];
  /** Monarch, initiative, day/night, speed. */
  designations: DesignationState;
  /** Chips for manual shields and unenforced one-shot text; state, not log entries. */
  reminders: ManualReminder[];
  lki: Record<ObjectId, LastKnown>;
  /** The decision the game is waiting on (priority, target choice, ...). null only when the game is over. */
  pending: Decision | null;
  /** Present when `pending` is a mid-action decision (see core/apply.ts). */
  suspended: Suspension | null;
  log: LogEntry[];
  result: GameResult | null;
  counters: { object: number; timestamp: number; log: number; decision: number; card: number; effect: number };
  /** Number of actions applied (for replay bookkeeping). */
  actionCount: number;
}
