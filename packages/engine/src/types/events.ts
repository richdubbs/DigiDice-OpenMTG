/**
 * Events emitted while an action is processed. They drive triggered abilities (CR 603.2),
 * the game log, and UI animations. Events are returned from applyAction; they are not
 * stored in the state (the log is).
 */
import type { CardId, ObjectId, PlayerId } from './ids';
import type { CastOrigin, LastKnown, Step, ZoneKind } from './state';
import type { ManaType } from './mana';

export type GameEvent =
  | { type: 'gameStarted'; startingPlayer: PlayerId }
  | { type: 'turnBegan'; turn: number; activePlayer: PlayerId }
  /** FAST5X E17 (additive): `mainPhase`, of a main phase, the number of the main phase in its turn (CR 505.1b; `GameState.turn.mains`). */
  | { type: 'stepBegan'; step: Step; activePlayer: PlayerId; mainPhase?: number }
  | { type: 'stepEnded'; step: Step }
  | { type: 'priorityGiven'; player: PlayerId }
  | {
      type: 'zoneChanged';
      /** The object before the move (now gone, see lki) and the new object (CR 400.7). */
      oldId: ObjectId;
      newId: ObjectId | null;
      from: ZoneKind | null;
      to: ZoneKind;
      owner: PlayerId;
      controller: PlayerId;
      name: string;
      cause?: string;
      /** Layered snapshot of the old object just before it moved (CR 603.10, 608.2h); filled once the trigger normalizer (WP8) needs it. */
      before?: LastKnown;
      /**
       * FAST5X E25 INTERFACE CHANGE (additive): the new object is face down (put onto the battlefield face down, CR 708.3, or exiled face down, CR 406.3): what
       * "a permanent entered the battlefield face down under your control this turn" reads (triggers/history.ts), whatever happens to it later in the batch.
       */
      faceDown?: true;
    }
  /**
   * CMDF INTERFACE CHANGE (additive): `commandZone` when the drawn card was the player's commander and its owner put it into the command zone instead of into
   * the hand (CR 903.9b). The card was still drawn (CR 121.1, 614.6; see core/zones.ts#drawCard); `objectId` is the card in the command zone, and the move
   * itself is the `zoneChanged` event with cause 'commander' that comes just before.
   */
  | { type: 'drew'; player: PlayerId; objectId: ObjectId; commandZone?: true }
  | { type: 'shuffled'; player: PlayerId }
  | { type: 'lifeChanged'; player: PlayerId; delta: number; life: number; cause?: string }
  /**
   * `group` (PUSH1 T2, optional): the damage events one instruction dealt at the same time share it (one noncombat damage step, CR 120.2b, 608.2c), so a
   * trigger on "~ deals damage" sees ONE event however many recipients there were (triggers/occurrences.ts). Combat damage needs none: a step's batch is it.
   * FAST5X E16 INTERFACE CHANGE (additive): `excess`, of damage dealt to a permanent, the part of `amount` that was excess damage (CR 120.4a, 120.10): beyond
   * lethal damage for a creature (its toughness minus the damage already marked on it, at most 1 if the source has deathtouch, CR 702.2c), beyond its loyalty
   * for a planeswalker, beyond its defense for a battle; the greatest of these for a permanent of several of those types. Absent for damage to a player.
   * NaN when it cannot be computed (a creature whose toughness is not a number): readers fail to determine (CR 608.2b).
   */
  | { type: 'damageDealt'; source: ObjectId; target: ObjectId | PlayerId; amount: number; combat: boolean; group?: number; excess?: number }
  | { type: 'tapped'; objectId: ObjectId }
  | { type: 'untapped'; objectId: ObjectId; /** Standard round 5, r5-trig (CR 502.3): untapped by the untap step's turn-based action */ untapStep?: true }
  /** FAST5X E21 INTERFACE CHANGE (additive): `by`, the player who put the counters (CR 122.6, 122.6a); absent when no player is known (a by-hand change). */
  | { type: 'countersChanged'; target: ObjectId | PlayerId; counter: string; delta: number; by?: PlayerId }
  /**
   * `sourceId`: the source of the mana (CR 106.3: the spell, or the source of the ability). `viaActivation` (WP13 INTERFACE CHANGE): set only when the mana was
   * added by ACTIVATING a mana ability (CR 605.3b), which the trigger normalizer reads as an activation; a triggered mana ability (CR 605.1b) or a spell or
   * ability that adds mana leaves it out, so a "whenever you tap ... for mana" trigger never sees its own mana.
   */
  | { type: 'manaAdded'; player: PlayerId; mana: ManaType[]; sourceId?: ObjectId; viaActivation?: true; /** FAST5X E20: the activated mana ability is an exhaust ability (CR 702.177a). */ exhaust?: true; /** std-mana-1 (additive): the activated mana ability had {T} in its cost: the source was tapped for mana (CR 106.12). */ tapped?: true }
  | { type: 'spellCast'; objectId: ObjectId; player: PlayerId; /** Spells cast this turn before this one by ALL players, not only by this player (storm counts every player's spells, CR 702.40a). */ spellsBefore?: number; /** FAST5X E9 INTERFACE CHANGE (additive), CR 601.2h, 702.191a: the amount of mana spent to cast it (its mana units; life paid for Phyrexian mana, convoke and delve are not mana). */ manaSpent?: number; /** FAST5X E19 INTERFACE CHANGE (additive), CR 106.3: per mana spent, the subtypes its source had as it produced it (ManaUnit.sourceSubtypes); absent when no source had any. */ manaFrom?: string[][]; /** std-lci (additive), CR 106.3: the objects that produced the mana spent to cast it (ManaUnit.sourceId, each once); absent when none is known. */ manaSources?: ObjectId[] }
  /** FAST5X E20 INTERFACE CHANGE (additive): `exhaust` (CR 702.177a: an exhaust ability) and `loyalty` (CR 606.3: a loyalty ability), what was activated. */
  /** Standard round 3, r3-trig INTERFACE CHANGE (additive): `loyaltyRemoved`, the loyalty counters the cost of a loyalty ability removed from its source (CR 606.4). */
  | { type: 'abilityActivated'; objectId: ObjectId; sourceId: ObjectId; player: PlayerId; exhaust?: true; loyalty?: true; loyaltyRemoved?: number }
  | { type: 'abilityTriggered'; objectId: ObjectId; sourceId: ObjectId; player: PlayerId }
  | { type: 'resolved'; objectId: ObjectId }
  | { type: 'countered'; objectId: ObjectId }
  /** Cloud std-spm ADDITION (optional): `from`, the zone the land was played from (CR 305.1: "whenever you play a land from exile"). */
  | { type: 'landPlayed'; objectId: ObjectId; player: PlayerId; from?: CastOrigin /* trek-11: or 'outside', a land played from outside the game (CR 400.11b) */ }
  | { type: 'attackersDeclared'; attackers: { attacker: ObjectId; defender: PlayerId | ObjectId }[] }
  /** std-rx35 ADDITION (optional): `unblocked`, the attacking creatures of that defending player no blocker was declared for (CR 509.1h). */
  | { type: 'blockersDeclared'; blocks: { blocker: ObjectId; attacker: ObjectId }[]; unblocked?: ObjectId[] }
  /** p2-combat-flow-2 ADDITION: attacking creatures an effect made blocked, with no blocker (CR 509.1h; op becomeBlocked): "becomes blocked" triggers (CR 509.3c). */
  | { type: 'becameBlocked'; attackers: ObjectId[] }
  | { type: 'mulligan'; player: PlayerId; count: number }
  /**
   * CR 104.3, 104.5. M12-1 (type only; coordination with milestone 13): `rules`, the CR citations of the loss (core/sba.ts#markLost has them for its log
   * line); optional, filled by core/sba.ts#markLost since milestone 13 (M13-7) for the hosted results ledger's loss codes. The leave procedure copies the
   * same citations into `PlayerState.left.rules`. Events are not state: states and action logs are unchanged.
   */
  | { type: 'playerLost'; player: PlayerId; reason: string; rules?: string[] }
  | { type: 'gameOver'; winner: PlayerId | null; reason: string }
  // Added by the ability model (milestone 5, design 4.1): the trigger normalizer needs these.
  /** `owner`, `zone` (WP13 INTERFACE CHANGE): for a search (CR 701.23a), whose zone was searched and which zone ("whenever an opponent searches their library"). */
  /**
   * FAST5X E20 INTERFACE CHANGE (additive): `spent`, for the verb `expend` (CR 700.14, rules/crime.ts): the mana the actor spent this turn to cast spells
   * before and after this payment. Verbs E20 added: `commitCrime` (CR 700.13), `expend` (CR 700.14) and `tap` (CR 701.26a: a permanent the actor's effect or
   * cost tapped).
   * CLOUD std-dft INTERFACE CHANGE (additive): `x`, for the verb `cycle`: the X announced for the cycling cost (CR 107.3a, 702.29a; actions/activate.ts), which
   * the cycled card's own "when you cycle ~" ability reads as its X (triggers/stack.ts).
   */
  | { type: 'actionPerformed'; verb: string; actor: PlayerId; objectId?: ObjectId; owner?: PlayerId; zone?: ZoneKind; spent?: { before: number; after: number };
    /** std-lci (CR 701.44a): an `explore` that revealed a card says whether it was a land card (absent: no card was revealed). */
    revealed?: 'land' | 'nonland'; x?: number;
    /** p2-player-rules-3 (CR 701.30c): a `clash` says whether its actor won it. */
    won?: boolean;
    /** std-rx17 (CR 702.110b): for the verb `exploit`, the creature sacrificed (`objectId` is the exploiting creature). */
    exploited?: ObjectId }
  | { type: 'tokenCreated'; player: PlayerId; objectId: ObjectId }
  | { type: 'becameTarget'; objectId: ObjectId | PlayerId; byStackId: ObjectId; byController: PlayerId }
  | { type: 'attached'; objectId: ObjectId; to: ObjectId | null }
  /** `convert` (M6-0, m6 design 2.3, CR 701.27e: "transforms into" also sees converting). */
  | { type: 'transformed'; objectId: ObjectId; convert?: true }
  /** `by` (FAST5X E25, CR 701.40b, 608.2, 116.2b): the player who turned it face up (the special action's player, or the controller of the effect). */
  | { type: 'turnedFaceUp'; objectId: ObjectId; by?: PlayerId }
  /** `instruction` (p2-c-dieroll-1, CR 706.1, 603.2c): the rolls of one instruction share it ("whenever you roll one or more dice" triggers once for them). */
  | { type: 'dieRolled'; player: PlayerId; sides: number; result: number; instruction?: number }
  | { type: 'coinFlipped'; player: PlayerId; won: boolean }
  | { type: 'spellCopied'; objectId: ObjectId; copyOf: ObjectId }
  | { type: 'abilityCountered'; objectId: ObjectId }
  | { type: 'controlChanged'; objectId: ObjectId; from: PlayerId; to: PlayerId }
  | { type: 'phasedOut'; objectId: ObjectId }
  | { type: 'designationChanged'; what: 'monarch' | 'initiative' | 'day' | 'night'; to: PlayerId | 'day' | 'night' }
  /** FAST5X-4 ADDITION: a player's speed became `speed` (CR 702.179a-d; `from` absent: they had no speed). No trigger pattern reads it. */
  | { type: 'speedChanged'; player: PlayerId; speed: number; from?: number }
  /**
   * M12F ADDITION (CR 701.38a): the players finished a vote ("whenever players finish voting"). `starter`: the player the vote started with. `ballots`: every
   * voter's votes in the order cast (a choice is a word, an object id or a player id; a player with additional votes has more than one, CR 701.38d); absent
   * when the vote was resolved by hand (who voted for what is then not known to the engine). Emitted once per vote by effects/handlers/actions-native.ts#vote
   * and by effects/manual.ts#askManual for a vote resolved by hand; triggers/normalize.ts reads it as the action `votesFinished` of `starter`.
   */
  | { type: 'votesFinished'; starter: PlayerId; ballots?: { voter: PlayerId; votes: string[] }[] }
  // ---- M6-0 ADDITIONS (m6 design 2.3). Each has a case in triggers/normalize.ts and a matcher in triggers/match.ts; the packages that emit them list them in
  // their `EMITS` (triggers/forms.ts). Events are not redacted (ARCHITECTURE "Hidden information"): every event about a face-down object names it as "a
  // face-down creature/spell" in the log.
  /** CR 708.2b */
  | { type: 'turnedFaceDown'; objectId: ObjectId }
  /** CR 710 */
  | { type: 'flipped'; objectId: ObjectId }
  /** CR 701.42a */
  | { type: 'melded'; objectId: ObjectId; from: ObjectId[] }
  /** CR 702.140c-d */
  | { type: 'mutated'; objectId: ObjectId; spell: ObjectId; over: boolean }
  /** CR 707.4: no enters or leaves triggers. */
  | { type: 'becameCopy'; objectId: ObjectId; of: ObjectId | null }
  /** CR 615.13: one event per application of a prevention effect to one or more SIMULTANEOUS damage events; `amount` is the sum it prevented. */
  | { type: 'damagePrevented'; effect: string; batch: number; amount: number; source: ObjectId[]; target: (ObjectId | PlayerId)[] }
  /**
   * Standard round 5, r5-trig INTERFACE CHANGE (additive), CR 702.122b, 702.171c: the creature `by` was tapped to pay the cost of the crew
   * (`as: 'crew'`) or saddle (`as: 'saddle'`) ability of the permanent `objectId`: it "crews that Vehicle" / "saddles that Mount" at that moment, whether or not
   * the ability resolves. One event per creature tapped (actions/activate.ts).
   */
  | { type: 'crewTapped'; objectId: ObjectId; by: ObjectId; as: 'crew' | 'saddle' | 'teamwork'; player: PlayerId }
  // std-rq INTERFACE CHANGE (additive), CR 702.194a: `as: 'teamwork'`, the creature `by` was tapped to pay the teamwork cost of the spell `objectId` as it was cast
  // (actions/cast.ts): "Whenever ~ becomes tapped to pay a teamwork cost".
  /** CR 719.3b, 722.3a-b, 716.2a */
  | { type: 'objectDesignation'; objectId: ObjectId; what: 'solved' | 'harnessed' | 'prepared' | 'unprepared' | 'classLevel' | 'saddled' | 'plotted' | 'suspected' | 'unsuspected'; level?: number } // 'saddled': FAST5X E3, CR 702.171b; 'plotted': FAST5X E6, CR 702.170a; 'suspected' / 'unsuspected': FAST5X E12, CR 701.60a
  /**
   * FAST5X E8 INTERFACE CHANGE (additive), CR 709.5c-i: a permanent with a shared type line (a Room) was given the unlocked designation of its half `face`
   * (0 = left, 1 = right) by `player` (who paid the unlock cost, whose effect unlocked it, or who cast that half: CR 709.5d-f, 709.5h); `full`: it now has both
   * unlocked designations and did not have both before (CR 709.5i). `lock`: the designation was removed instead (CR 709.5g; `full` is then false).
   */
  | { type: 'doorUnlocked'; objectId: ObjectId; face: number; player: PlayerId; full: boolean; lock?: true }
  /** CR 731.1a: "day becomes night" / "night becomes day" (and the first designation). */
  | { type: 'dayNight'; to: 'day' | 'night' }
  // ---- M11-0 ADDITIONS (m11 design 4.4). A commander's moves to the command zone are ordinary `zoneChanged` events with `cause` 'commander' (CR 903.9a-b,
  // 704.6d); a cast from the command zone is an ordinary `spellCast` (the tax paid is in the log and `CommanderRec.casts`). No trigger pattern reads these.
  /**
   * CR 903.10a, 704.6c, 702.124d: a commander dealt combat damage to a player; `total` is that commander's combat damage to that player this game
   * (`PlayerState.commanderDamage[commander]` after the damage). Emitted right after the `damageDealt` event it counts, from M11-1.
   */
  | { type: 'commanderDamage'; player: PlayerId; commander: CardId; source: ObjectId; amount: number; total: number }
  // ---- M12-1 ADDITION (m12 design D8, D9, 4.4; never emitted in a two-player game, which is over when a player loses, CR 104.2a) ----
  /**
   * CR 104.5, 800.4a: a player who lost a multiplayer game that goes on has left it. Emitted once per leaver by the leave procedure (M12-2), after its moves
   * and after that player's `playerLost` (CR 104.5: the player loses, then leaves). `removed`: the objects they owned, which left the game (removed from the
   * state; their last known information is in `lki`, CR 603.10, 608.2h); the trigger normalizer maps each removed phased-in permanent to the
   * leaves-the-battlefield pattern and to nothing else (CR 603.6c; a phased-out one to nothing, CR 702.26k). `exiled`: the objects they controlled but did not
   * own, exiled by ordinary moves (their `zoneChanged` events have `cause` 'leftGame'). `revealed`: the leaver's face-down permanents and spells, foretold
   * cards and face-down conspiracies, with their names, shown to every player as they leave (CR 708.9, 702.143f, 702.106e): public in every view.
   */
  | { type: 'playerLeft'; player: PlayerId; reason: string; removed: ObjectId[]; exiled: ObjectId[]; revealed: { id: ObjectId; name: string }[] };

export type GameEventType = GameEvent['type'];
