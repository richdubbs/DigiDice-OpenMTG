/**
 * Conditions and quantities that are read WHILE a spell or ability is being announced (CR 601.2b-f, 602.2b), before it exists as a finished object on the stack:
 *   - `TargetSpec.onlyIf` ("if this spell was kicked, it also targets ...", CR 601.2c, 700.2c);
 *   - `ModeSpec.override.when` ("if this spell was kicked, choose any number instead", entwine, CR 601.4... 702.42);
 *   - `AlternativeCostDef.when` ("if an opponent controls a Swamp", CR 118.9);
 *   - `ActivatedAbilityDef.onlyIf` ("Activate only if you control a Forest", CR 602.5b).
 *
 * Owner: WP7. The full evaluators (`effects/eval.ts#evalCond`, WP4) need an execution context that exists only while an effect resolves, so this module reads
 * the subset that is meaningful at announcement: the cast choices made so far (kicker, buyback, entwine and the alternative cost, X, the zone it is cast from)
 * and the visible board. Everything else is `undefined` ("can't be determined"): the callers treat that as a denial, never as true or false (design D2, 3.2).
 */
import type { Condition, PlayerPred, PlayerRef, Quantity } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { CastOrigin, CostsPaid, EventContext, GameState, ZoneKind } from '../types/state';
import { announceCondForms, isAttackedWithThisTurn, isBarePlayerCount, isOpponentDrawsPerPlayer, isOpponentSpellsPerPlayer, isOpponentsHappenedPlayers, isSelfEnteredThisTurn, isTurnDamageTotal, isTurnEnergySpent, isTurnPlayerCombatDamage, isTurnPlayerLifeLoss, turnHistoryAtAnnouncement, type AnnounceWhere } from '../model/forms';
import { countHistory, enteredThisTurn, happenedCountOf, happenedPlayersOf, opponentsAttackedCount } from '../rules/history';
import { compareNumbers } from '../rules/predicates';
import { charsOfObject, controllerOf, ptNumbers } from '../rules/characteristics';
import { creatureTypesOf, findObjects, matchesFilter, type FilterContext } from '../rules/filter';
import { filterCtxOutside, filterMentionsX } from '../rules/filter-env';
import { announcedPlayers } from '../rules/targets';
import { hasCompleted } from '../core/dungeon-data';
import { isKickerName } from './cast-options';
import { PERMANENT_TYPES } from '../statics/subtypes';
import { devotionBonusOf } from '../statics/devotion-bonus'; // edh-next-140

/**
 * The announcement capabilities this module reads, WITHOUT the `feature:` prefix (names from model/forms.ts `announceCondForms` / `playerRefForms`). They are the
 * single source of what is readable: `announceReadable` is "every name of the condition is in this list", `FEATURES` (actions/announce.ts) spreads it so
 * the capability set claims exactly this much, and `announceCond` answers `undefined` only outside it. Not here (so a card that needs it stays manual even
 * when WP4 evaluates the same condition at resolution): any other condition kind, quantity, object reference or player reference; a player reference that
 * points at a target in a condition (the targets are not chosen yet when conditions are read); X before X is announced.
 */
export const ANNOUNCE_READABLE: readonly string[] = [
  'announce.cond.all', 'announce.cond.any', 'announce.cond.not', 'announce.cond.compare', 'announce.cond.exists', 'announce.cond.matches', 'announce.cond.turnOf',
  'announce.cond.wasCast', 'announce.cond.ask',
  'announce.cond.firstSpellCast', // edh-next-143 (CR 601.2b, 118.9; Once Upon a Time): an alternative cost's "if this spell is the first spell you've cast this game" (announceCond)
  'announce.cond.controlledSinceTurnStart', // edh-c-110 (CR 302.6, 602.5b, 400.7): "Activate only if you've controlled ~ continuously since the beginning of your most recent turn"
  'announce.qty.X', 'announce.qty.count', 'announce.qty.life', 'announce.qty.zoneSize', 'announce.qty.math', 'announce.qty.counters',
  'announce.qty.kickCount', // pc-zones-3 (CR 702.33d, 601.2c, 603.3d): "up to X target creature cards ..., where X is the number of times ~ was kicked", the kicks of the source's cast record
  'announce.qty.eventAmount', // r3-choose (CR 603.3d): the amount of the event a triggered ability is put on the stack for (AnnounceEnv.eventAmount)
  'announce.qty.modesChosen', // Standard round 3, r3-trig (CR 700.2, 603.3c): the modes chosen for the spell of a cast trigger (AnnounceEnv.modesChosen)
  'announce.qty.startingLife', // FAST5 T60 (CR 103.4, 602.5b): "activate only if you have at least 7 life more than your starting life total"
  'announce.qty.distinct', // FAST5X E13: card types among a set of visible objects (delirium, CR 205.2a); the other kinds are `announce.qty.distinct.<what>`
  'announce.qty.distinct.colors', // FAST5X E12 (CR 105.1, 602.5b): the colors among the objects a filter selects on the visible board
  'announce.qty.distinct.powers.each', // CLOUD std-misc (coven, CR 208.1, 602.5b): the different powers among the objects a filter selects on the visible board
  'announce.qty.spellsCastThisTurn', // std-ry8 (CR 702.117a): "if you've cast another spell this turn" (surge), the announcing player's spells cast so far this turn
  'announce.qty.descendedThisTurn', // FAST5X E22 (CR 700.11, 700.2): "If you descended this turn, you may choose both instead" (turnStats, kept current by every move)
  // merge line D (std-sos's countPlayers.controlsVs, CR 102.2, 102.3, 602.5b): "activate only if an opponent controls more lands than you", each opponent counted
  // alone on the visible board (the players of `of` are each opponent, each player or each other player; `than` is one player of the condition)
  'announce.qty.countPlayers.controlsVs',
  'announce.qty.stat.event', // edh-next-9 (CR 208.1, 603.10a, 608.2h): the power or toughness of the subject of the triggering event, as it last existed ("When ~ dies, it deals damage equal to its power divided as you choose among ...")
  'announce.qty.stat.max.each', // edh-next-9 (CR 208.1, 601.2d): "the greatest power among creatures you control" as the amount divided among the targets is announced
  'announce.qty.stat.sum.each', // std-ry5 (formidable, CR 208.1, 602.5b): "creatures you control have total power 8 or greater", the powers added up as they are now
  'announce.qty.stat.self', // r4-fxb (CR 602.5b, 208.1): "Activate only if ~'s power is 3 or greater": the source's own power, toughness or mana value as it is now
  // r4-cost (CR 402.1, 602.5b): "activate only if a player has one or fewer cards in hand", each player's hand size on the visible board (`sizeIs` over `each`)
  'announce.qty.countPlayers.sizeIs',
  // std-rx24 (CR 122.1f, 602.5b): "activate only if an opponent has three or more poison counters" (`poisonIs` over `each`, nothing else narrowing the players)
  'announce.qty.countPlayers.poisonIs',
  // opp-port-1 (OPP1 of 2026-10-17; CR 102.3, 602.5b): "activate only if an opponent controls four or more lands", each player's own permanents on the visible
  // board against a fixed number (`controlsIs` over `each`, nothing else narrowing the players)
  'announce.qty.countPlayers.controlsIs',
  // r4-cost (CR 110.4, 602.5b): "activate only if there are four or more permanent types among cards in your graveyard"
  'announce.qty.distinct.permanentTypes.each',
  'announce.qty.distinct.names.each', // trek-5 (CR 201.2, 602.5b): "activate only if you control seven or more differently named lands", the names among the visible objects a filter selects
  // CMD2 (CR 702.173a, 510.2): the source filter fields of freerunning's "if you dealt combat damage to a player this turn with an Assassin or commander" that the
  // history facts answer (rules/history.ts#factsMatchFilter), read by announce.happened.turn below (model/forms.ts#isTurnPlayerCombatDamage)
  ...['anyOf', 'not', 'controller', 'owner', 'types', 'subtypes', 'supertypes', 'colors', 'name', 'token', 'isCard', 'commander', 'sharesWith'].map((k) => `announce.history.${k}`),
  'announce.count.each', 'announce.counters.self', 'announce.counters.each', 'announce.exists.each', 'announce.matches.self',
  'announce.matches.attachedTo', // p2-cost-parts-1 (CR 303.4, 602.5b): "activate only if enchanted creature is untapped"
  // M6-6 INTERFACE CHANGE (CR 716.2a, 716.2d): the level designation of the Class itself ("activate only if this Class is level N-1", statics/levels.ts)
  'announce.cond.classLevel', 'announce.classLevel.self',
  // MX4 INTERFACE CHANGE (CR 309.7): "activate only if you've completed a dungeon" (core/dungeon-data.ts)
  'announce.cond.completedDungeon',
  'announce.cond.designation', // edh-mana-keywords-6 (CR 702.131c, 725.1, 726.1, 602.5): "Activate only if you have the city's blessing", "if you're the monarch"; as effects/eval.ts reads it
  // FAST5 batch 2 merge (E5 + E9, CR 602.5b, 400.7): "activate only if this land entered this turn", the one history pattern read here
  'announce.happened.selfEntered',
  // std-blb (CR 602.5b): an event of this turn's history, "activate only if an opponent lost life this turn" (model/forms.ts#turnHistoryAtAnnouncement). The
  // one reader of this turn's history at announcement: STD-FRA's "activate only if you've scried or surveilled this turn" and std-lci's "activate only if an artifact
  // entered the battlefield under your control this turn" are read by it too (their own readers, announce.happened.history / .zoneChange, were folded in)
  'announce.happened.turn',
  // CLOUD std-ecl (CR 508.1, 602.5b): "activate only if you attacked with two or more creatures this turn" (the turn's history of attacks, rules/history.ts)
  'announce.happened.attackedWith',
  // std-rB (CR 120.1, 602.5b): "activate only if red sources you controlled dealt 4 or more noncombat damage this turn": this turn's damage added up
  // (model/forms.ts#isTurnDamageTotal; rules/history.ts#happenedCountOf), in an activation restriction only
  'announce.qty.happenedCount.damageTotal',
  // p2-cost-statics-1 (CR 601.2i, 118.9): "if an opponent cast three or more spells this turn" (Mindbreak Trap), the most spells one opponent cast this turn, from the
  // players' turnStats (model/forms.ts#isOpponentSpellsPerPlayer), in every position
  'announce.qty.happenedCount.opponentSpellsPerPlayer',
  // Players inside conditions and quantities.
  'announce.cref.you', 'announce.cref.anOpponent', 'announce.cref.active', 'announce.cref.controllerOf.self', 'announce.cref.ownerOf.self',
  'announce.cref.seat', // M12-2 (m12 design D6): "the player to your left / right" (rules/targets.ts#announcedPlayers, CR 101.4)
  // Players of a TargetSpec and the chooser of a spec or of modes: the targets chosen so far can be named.
  'announce.sref.you', 'announce.sref.anOpponent', 'announce.sref.active', 'announce.sref.target',
  'announce.sref.seat', // M12-2 (m12 design D6): the same as the player of a spec or its chooser
  'announce.sref.controllerOf.self', 'announce.sref.controllerOf.target', 'announce.sref.ownerOf.self', 'announce.sref.ownerOf.target',
  // edh-replace-5 (CR 107.14): "activate only if you've paid or lost four or more {E} this turn" (model/forms.ts#isTurnEnergySpent; rules/history.ts#happenedCountOf)
  'announce.qty.happenedCount.energySpent',
  'announce.qty.mostSharingName', // edh-mana-keywords-7 (CR 201.2, 602.5b): "three or more lands with the same name"
  'announce.exists.attachedTo', // edh-mana-keywords-7 (CR 702.151a)
  // trek-15 (CR 506.3, 508.1, 603.3d): "goad up to X target creatures, where X is the number of opponents you attacked this turn": the history's attacks of the turn, written
  // before a triggered ability's targets are chosen (triggers/stack.ts#collectPendingTriggers); the whole turn only (a combat's own count has no announcement)
  'announce.qty.opponentsAttacked',
  // edh-next-51 (CR 506.3, 508.1, 602.5b; Nemesis Phoenix): "you're attacking two or more opponents": the opponents the announcing player's creatures are attacking in the combat under way (0 outside combat), from the history of that combat
  'announce.qty.opponentsAttacked.combat',
  'announce.qty.timesMutated', // edh-next-140 (CR 702.140d, 601.2c; Archipelagore): the times the source permanent has mutated
  'announce.qty.lifeGainedThisTurn', // edh-perms-22 (CR 119.3, 603.3d): the life the announcing player gained this turn (PlayerState.turnStats.lifeGained)
  // edh-next-3 (CR 121.1, 601.2f): "if an opponent has drawn four or more cards this turn" (Even the Score), the most cards one opponent drew this turn, from the players' turnStats
  // (model/forms.ts#isOpponentDrawsPerPlayer), in every position
  'announce.qty.happenedCount.opponentDrawsPerPlayer',
  // edh-c-40 (CR 402.1, 102.3, 602.5b): "activate only if you have more cards in hand than each opponent", each player's hand (graveyard, library) against one player's, each counted alone
  'announce.qty.countPlayers.sizeVs',
  // edh-next-39 (CR 102.3, 601.2c; Rot Hulk): "up to X target Zombie cards ..., where X is the number of opponents you have": the players of `each` still in the game, no narrowing
  'announce.qty.countPlayers.bare',
  // edh-c-30 (CR 102.3, 118.9; Lavaball Trap): the opponents who each had enough matching events this turn, from the turn's history (model/forms.ts#isOpponentsHappenedPlayers), in every position
  'announce.qty.happenedPlayers.opponents',
  'announce.qty.devotion', // edh-next-42 (CR 700.5, 601.2c; Mogis's Marauder): "up to X target creatures ..., where X is your devotion to black", the announcing player's devotion on the visible board
  // edh-next-141 (CR 601.2b, 601.2d, 701.3d; Captain America, First Avenger): the mana value (power, toughness) of the permanent the ability's unattach cost will unattach, chosen as the ability is
  // announced because the amount divided is defined by it (actions/activate.ts#chooseUnattachedAhead)
  'announce.qty.stat.costUnattached',
  'announce.sref.event.chooser', // edh-d-87 (CR 601.7a, 603.3d; Bladegriff Prototype): the chooser of a triggered ability's target named by its event's player (actions/announce-targets.ts#chooserOf)
];

export interface AnnounceEnv {
  s: GameState;
  /** The player casting or activating. */
  player: PlayerId;
  /** The card being cast, or the permanent with the ability. */
  sourceId: ObjectId;
  /** What has been announced so far (CR 601.2b): kicker count, `additional` names, the alternative cost. */
  costsPaid: CostsPaid;
  /** The announced X, once known. For a triggered ability, which announces none, the X the resolution will read (CR 107.3m: the X its source was cast with). */
  x?: number;
  /** edh-d-97 (CR 107.3f, 603.3d): a triggered ability whose controller chooses X as it resolves (types/x-on-resolution.ts): its target filters read X relaxed (`'unannounced'`). */
  xOnResolution?: true;
  /**
   * Before X is announced: the largest X the player could pay for, when the caller knows it (a legality check, CR 601.2c, 601.2h). A target filter that reads
   * X then needs SOME X from 0 to it to have targets (actions/announce.ts#announcedX); without it the filter is only relaxed.
   */
  xMax?: number;
  /** pc-statics-1: the check is for casting a spell (not an ability) whose X is bounded by `xMax` (rules/targets.ts#AnnouncedX). */
  castingSpell?: true;
  /** The zone the spell is being cast from. */
  castFrom?: CastOrigin; // trek-11: or 'outside' (CR 400.11)
  /**
   * How `{cond:'ask'}` is answered: only activation restrictions allow it (the controller attests, CR 602.5b). A pure check passes `() => true` (optimistic: the
   * attestation is asked when the ability is actually activated). Without it an `ask` condition can't be determined.
   */
  attest?: (c: Extract<Condition, { cond: 'ask' }>) => boolean;
  /**
   * std-blb (CR 602.5b): set for an activation restriction, the one position that reads this turn's history ("Activate only if an opponent lost life this turn",
   * model/forms.ts#turnHistoryAtAnnouncement). Without it such a condition can't be determined, as before.
   */
  history?: true;
  /**
   * r3-choose (CR 700.2, 603.3c; `ModeSpec.unchosen`): the key of the ability whose modes are being chosen (`AbilityRef.key`), under which the modes it already had
   * chosen are remembered ("choose one that hasn't been chosen"), and whether it is a triggered ability (removed from the stack when no mode is left, CR 603.3c).
   * Without it such modes can't be chosen (actions/announce.ts#usedModes).
   */
  modeMemory?: { key: string; triggered: boolean };
  /** r3-choose (CR 603.3d, 603.2): the amount of the event a triggered ability is put on the stack for ("up to that many target creatures"), when the event has one. */
  eventAmount?: number;
  /** Standard round 3, r3-trig (CR 700.2, 603.3c): of a cast event, the number of modes chosen for that spell as it was cast (EventContext.modesChosen). */
  modesChosen?: number;
  /** edh-next-9 (CR 603.3d, 608.2h): the event a triggered ability is put on the stack for, so that "damage equal to its power" reads the power of the object that died, as it last existed. */
  event?: EventContext;
}

/**
 * The filter context of a condition read while announcing: "you" is the player, "this" the source, and the references and quantities inside a filter are read
 * in the announcement environment (WP30, rules/filter-env.ts), as they will be read when the ability resolves.
 */
const filterCtxOf = (env: AnnounceEnv): FilterContext =>
  filterCtxOutside(env.s, { controller: env.player, sourceId: env.sourceId, x: env.x ?? null }); // X not announced yet: it can't be read (CR 601.2b)

/** A filter that compares with X before X is announced (modes are chosen first, CR 601.2b) can't be read: the condition is undetermined, never false. */
const xUnread = (env: AnnounceEnv, f: unknown): boolean => env.x === undefined && filterMentionsX(f);

/** Was this named additional cost paid? Without a name: was it kicked with any kicker cost (CR 702.33d; "kicker:2" alone counts, M6-5a)? */
const kickedNamed = (paid: CostsPaid, name: string | undefined): boolean =>
  name === undefined ? (paid.kicked ?? 0) > 0 || (paid.additional ?? []).some(isKickerName) : (paid.additional ?? []).includes(name);

/** The players a reference inside a condition or quantity stands for, or undefined for a reference that is not in `ANNOUNCE_READABLE` (never a guess). */
function condPlayers(env: AnnounceEnv, ref: PlayerRef): PlayerId[] | undefined {
  switch (ref.ref) {
    case 'you': case 'anOpponent': case 'active': return announcedPlayers(env.s, ref, env.player, env.sourceId) ?? undefined;
    // M12-2 (m12 design D6): 'seat', the player to your left / right of you (announcedPlayers reads it, CR 101.4); of anyone else: not read here (never a guess)
    case 'seat': return ref.of === undefined || ref.of.ref === 'you' ? announcedPlayers(env.s, ref, env.player, env.sourceId) ?? undefined : undefined;
    case 'controllerOf': case 'ownerOf': return ref.object.ref === 'self' ? announcedPlayers(env.s, ref, env.player, env.sourceId) ?? undefined : undefined;
    default: return undefined;
  }
}

function playerPred(env: AnnounceEnv, who: PlayerPred, p: PlayerId): boolean | undefined {
  if (who === 'any') return true;
  if (who === 'you') return p === env.player;
  if (who === 'opponent') return p !== env.player;
  const ps = condPlayers(env, who);
  return ps ? ps.includes(p) : undefined;
}

/** A quantity at announcement: numbers, the announced X, arithmetic, and the counts and totals of the visible board. `undefined` = can't be read here. */
export function announceQty(env: AnnounceEnv, q: Quantity): number | undefined {
  if (typeof q === 'number') return q;
  const ctx = filterCtxOf(env);
  switch (q.q) {
    case 'X': return env.x;
    // pc-zones-3 (CR 702.33d): the kicks of the spell being announced, or of the cast record of the permanent whose triggered ability puts its targets on the stack
    case 'kickCount': return q.name !== undefined ? undefined : env.costsPaid.kicked ?? env.s.objects[env.sourceId]?.cast?.costsPaid.kicked ?? env.s.lki[env.sourceId]?.object.cast?.costsPaid.kicked ?? 0; // (the permanent that already left: its last known information, CR 603.10a)
    case 'eventAmount': return env.eventAmount; // r3-choose (CR 603.3d): the triggering event's amount; undefined outside a triggered ability whose event has one
    case 'modesChosen': return env.modesChosen; // Standard round 3, r3-trig (CR 700.2, 603.3c): undefined outside a triggered ability of a cast event
    // FAST5X E22 (CR 700.11): the permanent cards put into the announcing player's graveyard this turn; core/zones.ts#moveObject counts each as it arrives,
    // so the number is current while a spell is announced (unlike the history, which is written when triggers are collected)
    case 'descendedThisTurn': return env.s.players.find((p) => p.id === env.player)?.turnStats.descended ?? 0;
    // std-ry8 (CR 702.117a, 601.2i): the spells the announcing player cast this turn, counted as each becomes cast; the spell being announced is not one yet
    case 'lifeGainedThisTurn': return env.s.players.find((p) => p.id === env.player)?.turnStats.lifeGained ?? 0; // edh-perms-22 (CR 119.3)
    // edh-next-140 (CR 702.140d, 730.2, 601.2c; Archipelagore): the times the permanent whose triggered ability puts its targets on the stack has mutated, as effects/eval.ts reads them
    // (each mutating creature spell that merged with it left a component with `mergedAt`); a source no longer on the battlefield: undetermined
    case 'timesMutated': { const o = env.s.objects[env.sourceId]; return o === undefined || o.zone !== 'battlefield' ? undefined : (o.components ?? []).filter((c) => c.mergedAt !== undefined).length; }
    case 'spellsCastThisTurn': return env.s.players.find((p) => p.id === env.player)?.turnStats.spellsCast ?? 0;
    case 'startingLife': return env.s.options.startingLife; // FAST5 T60, CR 103.4
    case 'opponentsAttacked': return q.scope === 'turn' ? opponentsAttackedCount(env.s, env.player, null) : new Set((env.s.combat?.attackers ?? []).filter((x) => env.s.objects[x.id]?.controller === env.player && x.defender === x.defendingPlayer && x.defendingPlayer !== env.player).map((x) => x.defendingPlayer)).size; // trek-15 (CR 506.3, 508.1); edh-next-51: and the opponents attacked now in this combat ("you're attacking", present tense: a creature removed from combat or put onto the battlefield attacking counts as it stands, CR 506.4, 508.4)
    case 'countPlayers': {
      // edh-next-39 (CR 102.3): the players of `each` still in the game (an opponent who has left the game is no opponent any more)
      if (isBarePlayerCount(q)) return env.s.players.filter((p) => !p.hasLost && (q.of.ref === 'each' && q.of.who === 'player' ? true : p.id !== env.player)).length;
      // r4-cost (CR 402.1, 404.1, 602.5b): the players of `each` whose hand (graveyard, library) has a number of cards that compares with a fixed number
      // (wave 7 merge: and no r4-static `lifeIs`, which this branch does not read: a player whose hand AND life compare so would be misread as the hand alone)
      if (q.sizeIs !== undefined && q.controlsVs === undefined && q.sizeVs === undefined && q.lifeVs === undefined && q.lifeIs === undefined && q.lostLifeThisTurn === undefined && q.lostLifeIs === undefined && q.controlsIs === undefined && q.of.ref === 'each') {
        const who = q.of.who;
        const { zone, op, n } = q.sizeIs;
        return env.s.players.filter((p) => !p.hasLost && (who === 'player' || p.id !== env.player) && compareNumbers(op, (env.s.zones[zone][p.id] ?? []).length, n)).length;
      }
      // std-rx24 (CR 122.1f, 602.5b): "activate only if an opponent has three or more poison counters", the players of `each` whose poison counters compare with a
      // fixed number, as they are now (poison counters alone: any other narrowing is not read here)
      if (q.poisonIs !== undefined) {
        if (q.controlsVs !== undefined || q.sizeVs !== undefined || q.sizeIs !== undefined || q.lifeVs !== undefined || q.lifeIs !== undefined || q.lostLifeThisTurn !== undefined || q.lostLifeIs !== undefined || q.controlsIs !== undefined || q.didNot !== undefined || q.of.ref !== 'each') return undefined;
        const who = q.of.who;
        const { op, n } = q.poisonIs;
        return env.s.players.filter((p) => !p.hasLost && (who === 'player' || p.id !== env.player) && compareNumbers(op, p.poison, n)).length;
      }
      // opp-port-1 (OPP1 of 2026-10-17; CR 102.3, 806, 602.5b): "activate only if an opponent controls four or more lands" (Tectonic Edge), the players of `each`
      // who themselves control a number of permanents matching the filter that compares with a fixed number, each counted alone, as they are now
      if (q.controlsIs !== undefined) {
        if (q.controlsVs !== undefined || q.sizeVs !== undefined || q.sizeIs !== undefined || q.lifeVs !== undefined || q.lifeIs !== undefined || q.poisonIs !== undefined || q.lostLifeThisTurn !== undefined || q.lostLifeIs !== undefined || q.didNot !== undefined || q.speedVs !== undefined || q.of.ref !== 'each' || xUnread(env, q.controlsIs.filter)) return undefined;
        const who = q.of.who;
        const per = new Map<PlayerId, number>();
        for (const id of findObjects(env.s, q.controlsIs.filter, ctx)) {
          const c = controllerOf(env.s, id);
          per.set(c, (per.get(c) ?? 0) + 1);
        }
        const { op, n } = q.controlsIs;
        return env.s.players.filter((p) => !p.hasLost && (who === 'player' || p.id !== env.player) && compareNumbers(op, per.get(p.id) ?? 0, n)).length;
      }
      // edh-c-40 (CR 402.1, 102.3, 602.5b; Kitsune Bonesetter): the players of `each` whose zone has more (fewer, ...) cards than `than`'s, each counted alone, as they are now
      if (q.sizeVs !== undefined) {
        if (q.controlsVs !== undefined || q.sizeIs !== undefined || q.lifeVs !== undefined || q.lifeIs !== undefined || q.poisonIs !== undefined || q.lostLifeThisTurn !== undefined || q.lostLifeIs !== undefined || q.controlsIs !== undefined || q.didNot !== undefined || q.speedVs !== undefined || q.of.ref !== 'each') return undefined;
        const who = q.of.who;
        const than = condPlayers(env, q.sizeVs.than);
        if (!than || than.length !== 1) return undefined;
        const { zone, op } = q.sizeVs;
        const size = (id: PlayerId): number => (env.s.zones[zone][id] ?? []).length;
        return env.s.players.filter((p) => !p.hasLost && (who === 'player' || p.id !== env.player) && compareNumbers(op, size(p.id), size(than[0]!) + (q.sizeVs!.by ?? 0))).length;
      }
      // merge line D (std-sos's controlsVs, CR 102.2, 102.3, 602.5b): the players who control more (fewer, ...) permanents matching the filter than `than`, each
      // player counted alone, as they are now. Only `controlsVs` over `each` players (each opponent, player or other player) is read here (model/forms.ts)
      if (q.controlsVs === undefined || q.sizeVs !== undefined || q.sizeIs !== undefined || q.lifeVs !== undefined || q.lifeIs !== undefined || q.lostLifeThisTurn !== undefined || q.lostLifeIs !== undefined || q.controlsIs !== undefined || q.of.ref !== 'each' || xUnread(env, q.controlsVs.filter)) return undefined;
      const who = q.of.who;
      const than = condPlayers(env, q.controlsVs.than);
      if (!than || than.length !== 1) return undefined;
      const players = env.s.players.filter((p) => !p.hasLost && (who === 'player' || p.id !== env.player)).map((p) => p.id);
      const per = new Map<PlayerId, number>();
      for (const id of findObjects(env.s, q.controlsVs.filter, ctx)) {
        const c = controllerOf(env.s, id);
        per.set(c, (per.get(c) ?? 0) + 1);
      }
      const { op } = q.controlsVs;
      return players.filter((p) => compareNumbers(op, per.get(p) ?? 0, (per.get(than[0]!) ?? 0) + (q.controlsVs!.by ?? 0))).length;
    }
    // std-rB (CR 120.1, 602.5b): this turn's damage added up, read only by an activation restriction (the history is written before a player receives priority,
    // as for `happened`), relative to the activating player
    // p2-cost-statics-1 (CR 601.2i): the most spells one opponent of the announcing player cast this turn, counted as each became cast (actions/cast.ts); the spell
    // being announced is not cast yet, and it is the announcing player's own
    case 'happenedCount':
      if (isOpponentSpellsPerPlayer(q)) return Math.max(0, ...env.s.players.filter((p) => !p.hasLost && p.id !== env.player).map((p) => p.turnStats.spellsCast));
      if (isOpponentDrawsPerPlayer(q)) return Math.max(0, ...env.s.players.filter((p) => !p.hasLost && p.id !== env.player).map((p) => p.turnStats.cardsDrawn)); // edh-next-3 (CR 121.1)
      return env.history === true && (isTurnDamageTotal(q) || isTurnEnergySpent(q)) ? happenedCountOf(env.s, q, { you: env.player, sourceId: env.sourceId }) : undefined;
    // edh-c-30 (CR 102.3, 118.9, 120.8): each opponent still in the game judged alone on this turn's history, as the cost change of actions/cast.ts counts them
    case 'happenedPlayers':
      return isOpponentsHappenedPlayers(q) ? happenedPlayersOf(env.s, env.s.players.filter((p) => !p.hasLost && p.id !== env.player).map((p) => p.id), q.event, q.scope, q.times, { you: env.player, sourceId: env.sourceId }).length : undefined;
    case 'count': return q.of.ref === 'each' && !xUnread(env, q.of.filter) ? findObjects(env.s, q.of.filter, ctx).length : undefined;
    case 'life': {
      const ps = condPlayers(env, q.of);
      return ps && ps.length === 1 ? env.s.players.find((p) => p.id === ps[0])?.life : undefined;
    }
    case 'zoneSize': {
      const ps = condPlayers(env, q.of);
      if (!ps || ps.length !== 1) return undefined;
      if (q.zone === 'battlefield' || q.zone === 'stack' || q.zone === 'exile' || q.zone === 'command') return env.s.zones[q.zone].length;
      return env.s.zones[q.zone][ps[0]!]?.length ?? 0;
    }
    // r4-fxb (CR 602.5b, 208.1, 202.3): a statistic of the source itself, as it is now ("Activate only if Kitsa's power is 3 or greater"); no other object is read here
    case 'stat': {
      // std-ry5 (formidable, CR 208.1, 602.5b, 107.1b): "creatures you control have total power 8 or greater": the powers of the visible objects the filter selects
      // now, added up (a negative power counts as it is); an object with no power adds nothing
      if (q.sum === true && q.agg === undefined && q.station === undefined && q.of.ref === 'each' && (q.stat === 'power' || q.stat === 'toughness')) {
        if (xUnread(env, q.of.filter)) return undefined;
        return findObjects(env.s, q.of.filter, ctx).reduce((t, o) => t + (ptNumbers(charsOfObject(env.s, o))[q.stat as 'power' | 'toughness'] ?? 0), 0);
      }
      // edh-next-9 (CR 208.1, 601.2d): "the greatest power among creatures you control": the largest power (or toughness) of the visible objects the filter selects now
      // (0 when there are none, CR 107.1b)
      if (q.sum !== true && q.agg === 'max' && q.station === undefined && q.by === undefined && q.of.ref === 'each' && (q.stat === 'power' || q.stat === 'toughness')) {
        if (xUnread(env, q.of.filter)) return undefined;
        return Math.max(0, ...findObjects(env.s, q.of.filter, ctx).map((o) => ptNumbers(charsOfObject(env.s, o))[q.stat as 'power' | 'toughness'] ?? 0));
      }
      // edh-next-9 (CR 603.10a, 608.2h): the power (or toughness) of the subject of the triggering event; an object that left is read from what it last was (the event's look-back)
      if (q.of.ref === 'event' && q.of.role === 'subject' && q.sum !== true && q.agg === undefined && q.station === undefined && q.by === undefined && (q.stat === 'power' || q.stat === 'toughness')) {
        const role = env.event?.roles.subject;
        if (!role || !('objects' in role) || role.objects.length !== 1) return undefined;
        const h = role.objects[0]!;
        const was = Object.values(env.event!.before).find((l) => l.newId === h.id || l.object.id === h.id);
        const c = was?.chars ?? (env.s.objects[h.id] ? charsOfObject(env.s, env.s.objects[h.id]!) : null);
        return c ? ptNumbers(c)[q.stat] ?? undefined : undefined;
      }
      // edh-next-141 (CR 601.2b, 601.2d, 701.3d): the permanent the unattach cost will unattach, chosen already (actions/activate.ts#chooseUnattachedAhead), as it is now
      if (q.of.ref === 'costUnattached' && q.sum !== true && q.agg === undefined && q.station === undefined && q.by === undefined) {
        const ids = env.costsPaid.unattached ?? [];
        const u = ids.length === 1 ? env.s.objects[ids[0]!] : undefined;
        if (u === undefined || u.zone !== 'battlefield') return undefined;
        const c = charsOfObject(env.s, u);
        if (q.stat === 'manaValue') return c.manaValue;
        if (q.stat === 'power' || q.stat === 'toughness') return ptNumbers(c)[q.stat] ?? undefined;
        return undefined;
      }
      if (q.of.ref !== 'self' || q.sum === true || q.agg !== undefined) return undefined;
      const o = env.s.objects[env.sourceId];
      // edh-next-9 (CR 603.10a, 608.2h): the source of a leaves-the-battlefield trigger is read as it last existed ("When ~ dies, it deals damage equal to ~'s power divided ...")
      const lk = o === undefined ? env.s.lki[env.sourceId]?.chars ?? undefined : undefined;
      if (!o && !lk) return undefined;
      const c = lk ?? charsOfObject(env.s, o!);
      if (q.stat === 'manaValue') return c.manaValue;
      if (q.stat === 'power' || q.stat === 'toughness') return ptNumbers(c)[q.stat] ?? undefined;
      return undefined;
    }
    case 'counters': {
      // The counters of one kind (or of any kind) on the source itself, as they are now (CR 122.1, 602.5b: "Activate only if there are three or more brick
      // counters on ~"). Only the source can be read here: other objects are not chosen yet.
      // std-rg (CR 122.1, 602.5b): the counters of one kind on every visible object a description selects ("among Jaces you control"), as they are now
      if (q.on.ref === 'each' && 'filter' in q.on) {
        if (xUnread(env, q.on.filter)) return undefined;
        let total = 0;
        for (const o of findObjects(env.s, q.on.filter, ctx)) {
          const bag: Record<string, number> = o.counters ?? {};
          total += q.kind === 'any' ? Object.values(bag).reduce((a, b) => a + b, 0) : (Object.hasOwn(bag, q.kind) ? bag[q.kind]! : 0);
        }
        return total;
      }
      if (q.on.ref !== 'self') return undefined;
      // edh-next-46 (CR 603.10a, 400.7, 122.1; Quirion Beastcaller): the source of a "dies" trigger is no longer there when its targets are announced: its counters are what it last had (its look-back)
      const o = env.s.objects[env.sourceId] ?? env.s.lki[env.sourceId]?.object;
      if (!o) return undefined;
      const cs: Record<string, number> = o.counters ?? {};
      return q.kind === 'any' ? Object.values(cs).reduce((a, b) => a + b, 0) : (Object.hasOwn(cs, q.kind) ? cs[q.kind]! : 0);
    }
    case 'distinct': {
      // FAST5X E13 (delirium, CR 205.2a, 602.5b): "Activate only if there are four or more card types among cards in your graveyard": the card types of the
      // visible objects the filter selects now. FAST5X E12 (CR 105.1, 105.2): the number of colors among them ("there are five colors among permanents you
      // control"). Only card types and colors among `each` are read here (model/forms.ts names the others `announce.qty.distinct.<what>.<ref>`).
      if ((q.what !== 'cardTypes' && q.what !== 'colors' && q.what !== 'powers' && q.what !== 'permanentTypes' && q.what !== 'names') || q.among.ref !== 'each' || xUnread(env, q.among.filter)) return undefined;
      // trek-5 (CR 201.2, 602.5b): "Activate only if you control seven or more differently named lands": each name among the objects counted once (effects/eval.ts reads the same names)
      if (q.what === 'names') {
        const names = new Set<string>();
        for (const o of findObjects(env.s, q.among.filter, ctx)) charsOfObject(env.s, o).names.forEach((n) => names.add(n));
        return names.size;
      }
      // CLOUD std-misc (coven, CR 208.1): "Activate only if you control three or more creatures with different powers": each power counted once
      if (q.what === 'powers') {
        const powers = new Set<number>();
        for (const o of findObjects(env.s, q.among.filter, ctx)) { const p = ptNumbers(charsOfObject(env.s, o)).power; if (p !== null) powers.add(p); }
        return powers.size;
      }
      const seen = new Set<string>();
      // r4-cost (CR 110.4): the permanent types only, of the card types
      for (const o of findObjects(env.s, q.among.filter, ctx)) for (const t of q.what === 'colors' ? charsOfObject(env.s, o).colors : charsOfObject(env.s, o).types) if (q.what !== 'permanentTypes' || PERMANENT_TYPES.includes(t)) seen.add(t);
      return seen.size;
    }
    // edh-mana-keywords-7 (CR 201.2, 602.5b; Sceptre of Eternal Glory, Endless Atlas): "Activate only if you control three or more lands with the same name": the most of the visible
    // objects the filter selects that have a name in common (effects/eval.ts reads the same count; an object without a name shares none)
    case 'mostSharingName': {
      if (q.among.ref !== 'each' || xUnread(env, q.among.filter)) return undefined;
      const byName = new Map<string, number>();
      for (const o of findObjects(env.s, q.among.filter, ctx)) for (const n of new Set(charsOfObject(env.s, o).names)) if (n !== '') byName.set(n, (byName.get(n) ?? 0) + 1);
      return Math.max(0, ...byName.values());
    }
    // edh-next-42 (CR 700.5, 702.26b, 601.2c; Mogis's Marauder): the mana symbols of the color(s) among the mana costs of the announcing player's permanents, as effects/eval.ts
    // reads them (a hybrid symbol counts once; a phased-out permanent is treated as though it didn't exist)
    case 'devotion': {
      if (q.of.ref !== 'you') return undefined;
      let n = 0;
      for (const id of env.s.zones.battlefield) {
        const o = env.s.objects[id];
        if (!o || o.controller !== env.player || o.phasedOut) continue;
        for (const sym of charsOfObject(env.s, o).manaCost ?? []) {
          const colors: string[] = sym.kind === 'colored' || sym.kind === 'monoHybrid' || sym.kind === 'colorlessHybrid' || sym.kind === 'phyrexian' ? [sym.color] : sym.kind === 'hybrid' || sym.kind === 'hybridPhyrexian' ? [...sym.colors] : [];
          if (colors.some((c) => (q.to as string[]).includes(c))) n++;
        }
      }
      const bonus = devotionBonusOf(env.s, (id) => { const x = env.s.objects[id]; return x ? charsOfObject(env.s, x) : undefined; }, env.player); // edh-next-140 (CR 700.5; Altar of the Pantheon)
      return bonus === null ? undefined : n + bonus;
    }
    case 'math': {
      const args = q.args.map((a) => announceQty(env, a));
      if (args.some((a) => a === undefined)) return undefined;
      const [a, b] = args as number[];
      switch (q.op) {
        case '+': return args.reduce((n, v) => n! + v!, 0) as number;
        case '*': return args.reduce((n, v) => n! * v!, 1) as number;
        case '-': return a! - (b ?? 0);
        case 'floorDiv': return b ? Math.floor(a! / b) : undefined;
        case 'ceilDiv': return b ? Math.ceil(a! / b) : undefined;
        case 'min': return Math.min(...(args as number[]));
        case 'max': return Math.max(...(args as number[]));
      }
      return undefined;
    }
    default: return undefined;
  }
}

const compare = (op: '<=' | '>=' | '==' | '!=' | '<' | '>', a: number, b: number): boolean =>
  op === '<=' ? a <= b : op === '>=' ? a >= b : op === '==' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : a > b;

/** Whether `c` holds at announcement: `true`/`false`, or `undefined` when this subset can't tell (the caller refuses rather than guesses). */
export function announceCond(env: AnnounceEnv, c: Condition): boolean | undefined {
  switch (c.cond) {
    // edh-next-143 (CR 601.2b, 601.2f, 118.9; Once Upon a Time: "If this spell is the first spell you've cast this game, you may cast it without paying its mana cost."): the spell
    // being cast becomes cast only at the end of casting (CR 601.2i), so it is the first spell its caster casts this game when the game's history has no spell that player cast
    // (triggers/history.ts keeps every `cast` entry of the game); only while the spell itself is being cast (an alternative cost's condition, env.history)
    case 'firstSpellCast':
      if (env.history !== true || c.scope !== 'game') return undefined;
      return !env.s.history.some((e) => e.ev === 'cast' && e.actor === env.player);
    case 'all': {
      let unknown = false;
      for (const x of c.of) {
        const v = announceCond(env, x);
        if (v === false) return false;
        if (v === undefined) unknown = true;
      }
      return unknown ? undefined : true;
    }
    case 'any': {
      let unknown = false;
      for (const x of c.of) {
        const v = announceCond(env, x);
        if (v === true) return true;
        if (v === undefined) unknown = true;
      }
      return unknown ? undefined : false;
    }
    case 'not': {
      const v = announceCond(env, c.of);
      return v === undefined ? undefined : !v;
    }
    case 'compare': {
      const a = announceQty(env, c.left);
      const b = announceQty(env, c.right);
      return a === undefined || b === undefined ? undefined : compare(c.op, a, b);
    }
    case 'exists': {
      // edh-mana-keywords-7 (CR 702.151a, 602.5b): "Activate only if this permanent is attached to a creature" (reconfigure's second ability): the source is attached now
      if (c.of.ref === 'attachedTo') return c.atLeast === undefined ? env.s.objects[env.sourceId]?.attachedTo !== undefined : undefined;
      if (c.of.ref !== 'each' || xUnread(env, c.of.filter)) return undefined;
      const n = findObjects(env.s, c.of.filter, filterCtxOf(env)).length;
      const need = c.atLeast === undefined ? 1 : announceQty(env, c.atLeast);
      return need === undefined ? undefined : n >= need;
    }
    case 'matches': {
      if ((c.object.ref !== 'self' && c.object.ref !== 'attachedTo') || xUnread(env, c.filter)) return undefined;
      const src = env.s.objects[env.sourceId];
      // p2-cost-parts-1 (CR 303.4, 602.5b): "Activate only if enchanted creature is untapped": the permanent the source is attached to, as it is now
      const o = c.object.ref === 'self' ? src : src?.attachedTo !== undefined ? env.s.objects[src.attachedTo] : undefined;
      // trek-12 (CR 113.6, 602.5b, 400.7): "Activate only if ~ is exiled": the zone the filter names is the zone the source is in now (the filter's own, not any)
      return o ? matchesFilter(env.s, o, { ...c.filter, zone: c.object.ref === 'self' && c.filter.zone !== undefined ? c.filter.zone : 'any' }, filterCtxOf(env)) : undefined;
    }
    case 'controlledSinceTurnStart': { // edh-c-110, as effects/eval.ts reads it: the source itself, under the announcing player's control since before their most recent turn began
      if (c.object.ref !== 'self') return undefined;
      const o = env.s.objects[env.sourceId];
      const mine = env.s.players.find((p) => p.id === env.player)?.lastTurnStarted; // the turn that player began last (core/turn.ts), also when an upkeep step was skipped
      if (o === undefined || mine === undefined || mine <= 0) return false;
      return o.zone === 'battlefield' && o.controller === env.player && o.controlledSinceTurn < mine;
    }
    case 'completedDungeon': { // MX4, CR 309.7
      const ps = condPlayers(env, c.who);
      return ps === undefined ? undefined : ps.some((p) => hasCompleted(env.s, p, c.name));
    }
    case 'designation': { // edh-mana-keywords-6: the same reading as effects/eval.ts `designation`, on the state as it is now (the designations are state, not history)
      const d = env.s.designations;
      if (c.what === 'day') return d.dayNight === 'day';
      if (c.what === 'night') return d.dayNight === 'night';
      const ps = condPlayers(env, c.who);
      if (ps === undefined) return undefined;
      switch (c.what) {
        case 'monarch': return ps.some((p) => (c.asTurnBegan === true ? d.monarchAtTurnStart : d.monarch) === p); // edh-next-82
        case 'initiative': return ps.some((p) => d.initiative === p);
        case 'citysBlessing': return ps.some((p) => d.citysBlessing?.includes(p) === true);
        case 'maxSpeed': return ps.some((p) => (d.speed?.[p] ?? 0) >= 4);
        case 'enduringStory': return ps.some((p) => d.enduringStory?.includes(p) === true);
      }
      return undefined;
    }
    case 'classLevel': {
      // M6-6: CR 716.2a-d, as effects/eval.ts reads it: the level designation of a Class (absent = level 1), never level counters (CR 716.4)
      const o = c.object.ref === 'self' ? env.s.objects[env.sourceId] : undefined;
      if (!o) return undefined;
      return charsOfObject(env.s, o).subtypes.includes('Class') && (o.classLevel ?? 1) >= c.atLeast;
    }
    case 'turnOf': {
      const who = playerPred(env, c.whose, env.s.turn.activePlayer);
      if (who === undefined) return undefined;
      if (c.extra === true && env.s.turn.extra !== true) return false; // edh-next-31 (CR 500.7)
      if (c.step !== undefined) {
        const steps = Array.isArray(c.step) ? c.step : [c.step];
        if (!steps.includes(env.s.turn.step)) return false;
      }
      return who;
    }
    case 'wasCast': {
      const paid = env.costsPaid;
      if (c.kicked !== undefined) {
        // `true` / `false` mean any kicker cost (CR 702.33d); a string names one additional cost ("kicker:2", "entwine", "buyback", CR 702.33f).
        const was = kickedNamed(paid, typeof c.kicked === 'string' ? c.kicked : undefined);
        if (was !== (c.kicked !== false)) return false;
      }
      if (c.via !== undefined && paid.alternative !== c.via) return false;
      if (c.from !== undefined && env.castFrom !== c.from) return false;
      if (c.xAtLeast !== undefined && (env.x ?? 0) < c.xAtLeast) return false;
      return true;
    }
    case 'ask': return env.attest && (c.who === undefined || c.who.ref === 'you') ? env.attest(c) : undefined; // only the controller attests (CR 602.5b)
    // FAST5 batch 2 merge (E5 + E9): "Activate only if this land entered this turn" (CR 602.5b, 400.7): the source itself entered the battlefield this turn
    case 'happened': {
      if (isSelfEnteredThisTurn(c)) return enteredThisTurn(env.s, env.sourceId);
      // CLOUD std-ecl (CR 508.1, 602.5b): "you attacked with two or more creatures this turn": each attacker counted once (rules/history.ts#countHistory)
      if (isAttackedWithThisTurn(c)) return countHistory(env.s, c.event, c.scope, undefined, { you: env.player, sourceId: env.sourceId }) >= (c.times!.value as number);
      // std-blb (CR 602.5b): an activation restriction reads the turn's history as the interpreter does (rules/history.ts#countHistory, effects/eval.ts),
      // relative to the activating player; CMD2 (CR 702.173a, 510.2): combat damage to a player this turn in every position (freerunning's alternative cost)
      // std-ry7 (CR 702.137a, 119.3, 120.3a): "if an opponent lost life this turn" (spectacle) is read from the players' `turnStats.lifeLost`, which every life
      // change keeps current at once (rules/life.ts#changeLife, damage included), so it is exact in every position, also while an effect resolves
      if (isTurnPlayerLifeLoss(c) && c.event.ev === 'life') {
        const who = c.event.player;
        return env.s.players.some((p) => (who === 'any' || (who === 'you') === (p.id === env.player)) && p.turnStats.lifeLost > 0);
      }
      if ((env.history !== true && !isTurnPlayerCombatDamage(c)) || !turnHistoryAtAnnouncement(c)) return undefined;
      // edh-players-22 (CR 702.76a; prowl): the creature types of the spell being cast, for a source filter that shares them
      const own = JSON.stringify(c.event).includes('"sharesWith"') ? env.s.objects[env.sourceId] : undefined;
      const types = own === undefined ? undefined : creatureTypesOf(charsOfObject(env.s, own));
      const n = countHistory(env.s, c.event, c.scope, c.by, { you: env.player, sourceId: env.sourceId, ...(types !== undefined ? { sourceCreatureTypes: { set: [...types.set], all: types.all } } : {}) });
      return c.times === undefined ? n >= 1 : compare(c.times.op, n, c.times.value as number);
    }
    default: return undefined; // other happened, did, designation, chosen: they need history, bindings or links that exist only while an effect resolves
  }
}

/**
 * Whether every node of `c` is one this module can read, as a static check that mirrors `announceCond` exactly: the same capability names the capability
 * walker emits (`announceCondForms`) must all be in `ANNOUNCE_READABLE`. `where` is the position of the condition (X is known only for a target's `onlyIf`; only
 * an activation restriction can `ask`, design 2.3); `true` means `'activate'` and `false` `'spec'`. A condition that fails this check makes the spell or
 * ability not offered, with the reason.
 */
export function announceReadable(c: Condition, where: boolean | AnnounceWhere = 'spec'): boolean {
  const w: AnnounceWhere = where === true ? 'activate' : where === false ? 'spec' : where;
  return announceCondForms(c, w).every((f) => ANNOUNCE_READABLE.includes(f.slice('feature:'.length)));
}

const countAsks = (c: Condition): number =>
  c.cond === 'ask' ? 1 : c.cond === 'all' || c.cond === 'any' ? c.of.reduce((n, x) => n + countAsks(x), 0) : c.cond === 'not' ? countAsks(c.of) : 0;

/**
 * Could an activation restriction (CR 602.5b) hold for SOME attestation of its `ask` leaves? Pure, for `legalActions`: the answers are asked only when the
 * ability is activated, so every combination of answers is tried (up to six asks; more are tried all-yes and all-no). `unreadable` = some combination could not be
 * decided at all (the callers refuse, never guess); `possible` = at least one holds.
 */
export function activationOutcome(env: Omit<AnnounceEnv, 'attest'>, c: Condition): { possible: boolean; unreadable: boolean } {
  const asks = countAsks(c);
  const masks = asks <= 6 ? Array.from({ length: 2 ** asks }, (_, m) => m) : [0, 2 ** asks - 1];
  let possible = false;
  let unreadable = false;
  for (const mask of masks) {
    let i = 0;
    const r = announceCond({ ...env, attest: () => ((mask >> i++) & 1) === 1 }, c);
    if (r === undefined) unreadable = true;
    else if (r) possible = true;
  }
  return { possible, unreadable };
}
