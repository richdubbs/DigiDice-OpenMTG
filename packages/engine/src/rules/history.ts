/**
 * What happened this turn / this combat / this game (design 3.3, 3.4; `GameState.history`). Owner: WP4 (reader and the facts convention); WP8's normalizer
 * WRITES the entries and must use `objectFacts` / `makeHistoryEntry` below, so writer and reader cannot drift (INTERFACE NOTE in the WP4 report).
 *
 * A `HistoryEntry` keeps only primitives (`facts`), because a state is JSON and an entry outlives the objects it talks about (CR 400.7). This file fixes what
 * the facts are, so an `ObjectFilter` can be re-run against an entry ("a creature died this turn", CR 603.4):
 *
 *   entry.subject   the object the event is about, in the form it had AT THE EVENT (id of the object in its NEW zone for a zone change, so an object that
 *                   changed zones again is a different object, CR 400.7); the damaged object for `damage`; the attacker for `attacks`; the blocker for `blocks`;
 *                   the spell for `cast`; the new token for `createToken`.
 *   entry.actor     the player who did it (caster, drawer, whose step began, the player damaged / gaining / losing life).
 *   facts           `objectFacts(chars, object)` for the subject (characteristics as they were at the event: for look-back events such as dying, as the
 *                   object last existed on the battlefield, CR 603.10a), plus these event keys:
 *       zoneChange  from, to (zone names)               cast        from (zone), copy (bool), via      activate   mana (bool)
 *       attacks     alone (bool), count, defendingPlayer, defenderKind ('player' | 'planeswalker' | 'battle')
 *       blocks      `attacker.<fact>` facts of the blocked attacker, first (bool: the first pair of this blocker; a pattern without `attacker` counts only
 *                   those, CR 509.3a)                                becomesBlocked  `by.<fact>` facts of the blocker (one entry per pair), first (bool:
 *                   the first pair of this attacker in this declaration; WP30: a pattern without `by` counts only those, CR 509.3c)
 *       damage      amount, combat (bool), toPlayer (bool), recipientPlayer, `source.<fact>` facts of the damage source
 *       life        change ('gain' | 'loss'), amount           draw       nth (this card was the nth drawn this turn)
 *       becomes     what, `by.<fact>`                          counters   change ('put' | 'removed'), kind, total, onPlayer (bool), recipientPlayer, by (who put them)
 *       step        step                                       beginTurn  extra (bool)
 *       action      verb, revealed (an explore's, std-lci)     dieRoll    result
 *   `<fact>` is `name`, `names`, `types`, `subtypes`, `supertypes`, `colors`, `keywords` (all as `|A|B|`), `manaValue`, `power`, `toughness`, `token`, `isCard`,
 *   `controller`, `owner`, `id`; CMD2: `commander` (true, only for an object that was a commander, CR 903.3).
 *
 * Reading a pattern or filter field that the facts cannot answer THROWS an EngineBug: a "did a creature die this turn" that quietly counted 0 because a field
 * was ignored would be a silent wrong answer (design 3.3: a filter is never approximately right). `historyPatternForms` names those fields as capabilities
 * (`feature:history.pattern.<field>`, never advertised) so the walker makes the card manual before the engine could meet one.
 *
 * Capabilities. Nothing writes `GameState.history` until WP8's normalizer lands, so the nodes that read it (`HISTORY_CAPABILITIES`) are not advertised until
 * then: a card that used them would be classed automated and every "this turn" test would silently answer no / 0 (design D2). WP8 flips `HISTORY_WRITTEN` and
 * registers `feature:history` in one change; test/m5/eval/review.test.ts fails if only one of the two happens.
 *
 * WP4 REPORT NOTE (INTERFACE CHANGE): this file and rules/predicates.ts are new, and the facts convention above is a contract for WP8's writer.
 */
import { EngineBug } from '../core/errors';
import type { EventPattern, HistoryScope as ModelHistoryScope, NumberCmp, ObjectFilter, ObjRef, PlayerPred, Quantity, ZoneName } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState, HistoryEntry } from '../types/state';
import { ptNumbers, type Chars } from './characteristics';
import { compareNumbers, playerPredMatches, type PlayerResolver } from './predicates';

export type Facts = HistoryEntry['facts'];
/**
 * The scopes of the history (types/ability.ts#HistoryScope). M6-0: `lastTurn` = the entries of the turn before this one (CR 500.1: whichever player's turn it
 * was; the werewolf transforms "if no spells were cast last turn"). The history is never pruned (WP30: it grows for the whole game, "this game", CR 603.4), so
 * the previous turn's entries are always there; a game's first turn has no last turn (no entries: nothing happened).
 */
export type HistoryScope = ModelHistoryScope;

const list = (xs: readonly string[]): string => `|${xs.join('|')}|`;
const unsupported = (what: string): never => {
  throw new EngineBug(`history: ${what} (design 3.3: a history question the facts cannot answer must have made the card manual)`);
};

/** Flipped to `true` by WP8 together with the `feature:history` capability, when something writes `GameState.history`. */
export const HISTORY_WRITTEN = true;

/** The `ObjectFilter` fields that read `GameState.history`. */
export const HISTORY_FILTER_FIELDS: readonly string[] = ['foughtThisTurn' /* edh-next-139 */, 'enteredThisTurn', 'enteredUnderYourControl' /* edh-next-109 */, 'dealtDamageThisTurn', 'attackedThisTurn', 'blockedThisTurn', 'wasBlockedThisTurn' /* edh-c-18 */, 'dealtDamageBySourceThisTurn', 'dealtDamageByAttachedThisTurn' /* edh-c-113 */, 'controllerDealtCombatDamageBySourceThisTurn',
  'dealtDamageAsSourceThisTurn' /* std-mkm */, 'dealtDamageToYouThisTurn' /* edh-players-9 */, 'dealtDamageByYourSourceThisTurn' /* edh-c-48 */, 'putThereThisTurn' /* r3-choose */, 'putThereThisCombat' /* edh-next-116 */, 'crewedBySourceThisTurn' /* r5-trig */, 'enteredFrom' /* r5-trig */, 'putThereFrom' /* r5-fxz */, 'countersPutThisTurn' /* std-rx12 */, 'dealtExcessDamageThisTurn' /* edh-d-38 */, 'controllerDealtCombatDamageBy' /* edh-next-134 */, 'dealtDamageThisTurnBy' /* edh-next-130 */];

/** Every capability name that needs the history to exist (they are in `ENGINE_CAPABILITIES` exactly when `HISTORY_WRITTEN` is). */
export const HISTORY_CAPABILITIES: readonly string[] = [...HISTORY_FILTER_FIELDS.map((f) => `filter:${f}`), 'cond:happened', 'q:happenedCount'];

/** The facts about one object (see the file comment). `prefix` is '' for the subject, 'source.' / 'attacker.' / 'by.' for the other object of an event. */
export function objectFacts(chars: Chars, o: GameObject, prefix = ''): Facts {
  const { power, toughness } = ptNumbers(chars);
  const f: Facts = {
    [`${prefix}id`]: o.id,
    [`${prefix}name`]: chars.name,
    [`${prefix}names`]: list(chars.names),
    [`${prefix}types`]: list(chars.types),
    [`${prefix}subtypes`]: list(chars.subtypes),
    [`${prefix}supertypes`]: list(chars.supertypes),
    [`${prefix}colors`]: list(chars.colors),
    [`${prefix}keywords`]: list(chars.keywords.map((k) => k.keyword)),
    [`${prefix}manaValue`]: chars.manaValue,
    [`${prefix}token`]: o.kind === 'token',
    [`${prefix}isCard`]: o.kind === 'card',
    [`${prefix}controller`]: o.controller,
    [`${prefix}owner`]: o.owner,
    // FAST5X E25 (CR 708.2, 603.4): "a permanent entered the battlefield face down under your control this turn" (the object as it was at the event)
    [`${prefix}faceDown`]: o.faceDown === true,
  };
  if (power !== null) f[`${prefix}power`] = power;
  if (toughness !== null) f[`${prefix}toughness`] = toughness;
  return f;
}

/** The number of the combat phase in progress this turn (1 for the first, 2 for an extra one, CR 500.8), or 0 outside combat: the value of `HistoryEntry.combat` for an entry written now. */
export const currentCombatNumber = (s: GameState): number => s.combat?.number ?? 0;

/** A history entry for the current turn (and combat, when one is in progress). */
export function makeHistoryEntry(s: GameState, e: { ev: EventPattern['ev']; actor?: PlayerId; subject?: ObjectId; combat?: number; facts?: Facts }): HistoryEntry {
  return {
    turn: s.turn.number,
    combat: e.combat ?? currentCombatNumber(s),
    ev: e.ev,
    ...(e.actor !== undefined ? { actor: e.actor } : {}),
    ...(e.subject !== undefined ? { subject: e.subject } : {}),
    facts: e.facts ?? {},
  };
}

/**
 * The entries of a scope: this turn, the combat in progress (none outside combat), or the whole game (CR 603.4 style "this turn" facts). edh-next-135 (CR 500.1): `sinceYourLastTurn`
 * needs `you`, the player "your last turn" belongs to: the entries of the turns after that player's most recent turn that ended (during their own turn the one before it, otherwise the
 * one that began last); a player who has had no turn that ended yet reads the whole game.
 */
export function historyInScope(s: GameState, scope: HistoryScope, you?: PlayerId): HistoryEntry[] {
  const turn = s.turn.number;
  if (scope === 'game') return s.history;
  if (scope === 'sinceYourLastTurn') {
    const p = you === undefined ? undefined : s.players.find((x) => x.id === you);
    if (p === undefined) return unsupported('"since your last turn" with no player it belongs to');
    const mineNow = s.turn.activePlayer === p.id && p.lastTurnStarted === turn;
    const last = mineNow ? p.previousTurnStarted ?? 0 : p.lastTurnStarted;
    return s.history.filter((e) => e.turn > last);
  }
  if (scope === 'turn') return s.history.filter((e) => e.turn === turn);
  if (scope === 'lastTurn') return s.history.filter((e) => e.turn === turn - 1); // M6-0: the previous turn (CR 500.1)
  if (!s.combat) return [];
  const now = currentCombatNumber(s);
  return s.history.filter((e) => e.turn === turn && e.combat === now);
}

// ---- the four history fields of ObjectFilter -------------------------------------------------------------------------------------------------------------

const thisTurn = (s: GameState, id: ObjectId, ev: HistoryEntry['ev']): HistoryEntry[] => s.history.filter((e) => e.turn === s.turn.number && e.ev === ev && e.subject === id);

/** edh-next-109, `enteredUnderYourControl` (CR 110.2, 400.7): the object entered the battlefield this turn under the control of `player` (the `enteredController` fact; an entry without it never matches). */
export const enteredUnderControlOfThisTurn = (s: GameState, id: ObjectId, player: PlayerId): boolean => thisTurn(s, id, 'zoneChange').some((e) => e.facts['to'] === 'battlefield' && e.facts['enteredController'] === player);
/** `enteredThisTurn`: the object entered the battlefield this turn (as this object: a later zone change makes it a new object, CR 400.7). */
export const enteredThisTurn = (s: GameState, id: ObjectId): boolean => thisTurn(s, id, 'zoneChange').some((e) => e.facts['to'] === 'battlefield');
/** edh-d-38, `dealtExcessDamageThisTurn` (CR 120.10): this object was dealt excess damage this turn (the `excess` fact of a damage entry written to it). */
export const dealtExcessDamageThisTurn = (s: GameState, id: ObjectId): boolean => thisTurn(s, id, 'damage').some((e) => typeof e.facts['excess'] === 'number' && e.facts['excess'] > 0);
/** `dealtDamageThisTurn`: this object was dealt damage this turn (an amount of 0 is no event, CR 614.7a). */
export const dealtDamageThisTurn = (s: GameState, id: ObjectId): boolean => thisTurn(s, id, 'damage').some((e) => e.facts['amount'] !== 0);
/**
 * FAST3 T14, `dealtDamageBySourceThisTurn`: this object was dealt damage this turn by the object `sourceId` (the `source.id` fact of the damage entry: the
 * source as it was when it dealt the damage, CR 120.1, 400.7; an amount of 0 is no event, CR 614.7a).
 */
export const dealtDamageBySourceThisTurn = (s: GameState, id: ObjectId, sourceId: ObjectId): boolean =>
  thisTurn(s, id, 'damage').some((e) => e.facts['amount'] !== 0 && e.facts['source.id'] === sourceId);
/**
 * FAST5 T66, `controllerDealtCombatDamageBySourceThisTurn`: the player `controller` was dealt combat damage this turn by the object `sourceId` (the `source.id` fact
 * of a damage entry to a player: the source as it was when it dealt the damage, CR 510.2, 120.1, 400.7; an amount of 0 is no event, CR 614.7a).
 */
export const controllerDealtCombatDamageBySourceThisTurn = (s: GameState, controller: PlayerId, sourceId: ObjectId): boolean =>
  s.history.some((e) => e.turn === s.turn.number && e.ev === 'damage' && e.facts['toPlayer'] === true && e.facts['combat'] === true && e.facts['amount'] !== 0
    && e.facts['recipientPlayer'] === controller && e.facts['source.id'] === sourceId);
/**
 * std-mkm, `dealtDamageAsSourceThisTurn`: this object dealt damage this turn, to anything (the `source.id` fact of a damage entry: the source as it was when it dealt
 * the damage, so the same object, CR 120.1, 400.7; an amount of 0 is no event, CR 614.7a).
 */
export const dealtDamageAsSourceThisTurn = (s: GameState, id: ObjectId): boolean =>
  s.history.some((e) => e.turn === s.turn.number && e.ev === 'damage' && e.facts['amount'] !== 0 && e.facts['source.id'] === id);
/**
 * edh-c-48, `dealtDamageByYourSourceThisTurn` (CR 120.1, 400.7): this object was dealt damage this turn by a source `controller` controlled as it dealt the damage (the
 * `source.controller` fact of the damage entry; an amount of 0 is no event, CR 614.7a).
 */
export const dealtDamageBySourceOfThisTurn = (s: GameState, id: ObjectId, controller: PlayerId): boolean =>
  thisTurn(s, id, 'damage').some((e) => e.facts['amount'] !== 0 && e.facts['source.controller'] === controller);
/**
 * edh-next-130, `dealtDamageThisTurnBy` (CR 120.1, 400.7): this object was dealt damage this turn by a source that matched `source` as it dealt the damage (the `source.`
 * facts of the damage entry; "you" is `you`; an amount of 0 is no event, CR 120.8).
 */
export const dealtDamageThisTurnByMatching = (s: GameState, id: ObjectId, source: ObjectFilter, you: PlayerId): boolean =>
  thisTurn(s, id, 'damage').some((e) => e.facts['amount'] !== 0 && factsMatchFilter(e.facts, 'source.', source, { you }));
/**
 * edh-players-9, `dealtDamageToYouThisTurn` (CR 120.1, 510.2, 400.7): this object (as this object) dealt damage this turn to the player `you` (the `source.id` and
 * `recipientPlayer` facts of a damage entry to a player; `combat` only combat damage; an amount of 0 is no event, CR 120.8).
 */
export const dealtDamageToPlayerThisTurn = (s: GameState, id: ObjectId, you: PlayerId, combatOnly: boolean): boolean =>
  s.history.some((e) => e.turn === s.turn.number && e.ev === 'damage' && e.facts['toPlayer'] === true && e.facts['amount'] !== 0 && e.facts['recipientPlayer'] === you
    && e.facts['source.id'] === id && (!combatOnly || e.facts['combat'] === true));
/**
 * edh-next-134, `controllerDealtCombatDamageBy` (CR 510.2, 120.1, 400.7; Admiral Beckett Brass ruling 2017-09-29): the number of DIFFERENT sources that dealt combat damage (an amount
 * above 0) to the player `player` this turn and matched `by` as they dealt it (the entry's `source.*` facts, the source as it was then; its `source.id` tells sources apart, so a
 * creature with double strike counts once). An entry without the facts fails closed (factsMatchFilter).
 */
export const combatDamageSourcesToPlayerThisTurn = (s: GameState, player: PlayerId, by: ObjectFilter, env: FactsEnv): number => {
  const seen = new Set<string>();
  for (const e of s.history) {
    if (e.turn !== s.turn.number || e.ev !== 'damage' || e.facts['toPlayer'] !== true || e.facts['combat'] !== true || e.facts['amount'] === 0 || e.facts['recipientPlayer'] !== player) continue;
    const id = e.facts['source.id'];
    if (id === undefined) return unsupported('damage entry has no "source.id" fact');
    if (factsMatchFilter(e.facts, 'source.', by, env)) seen.add(String(id));
  }
  return seen.size;
};
/** edh-next-86 (CR 120.1, 120.8; Needle Drop): was this player dealt damage (an amount above 0) this turn? */
export const playerDealtDamageThisTurn = (s: GameState, you: PlayerId): boolean =>
  s.history.some((e) => e.turn === s.turn.number && e.ev === 'damage' && e.facts['toPlayer'] === true && e.facts['amount'] !== 0 && e.facts['recipientPlayer'] === you);
/**
 * edh-d-102 (CR 701.9a, 702.29a, 702.35a, 400.7; Shadow of the Grave, ruling 2017-04-18): its owner discarded this very card this turn (a discard entry of the history whose subject is this
 * object, the card where the discard put it), or a madness card the owner discarded into exile this turn and then put from exile into the zone it is in now (the object that move made).
 */
function discardedByOwnerThisTurn(s: GameState, o: GameObject): boolean {
  const discards = s.history.filter((h) => h.turn === s.turn.number && h.ev === 'action' && h.facts['verb'] === 'discard' && (h.actor === undefined || h.actor === o.owner));
  return discards.some((h) => h.subject === o.id || (s.objects[h.subject as string] === undefined && s.lki[h.subject as string]?.newId === o.id && thisTurn(s, o.id, 'zoneChange').some((e) => e.facts['to'] === o.zone && e.facts['from'] === 'exile')));
}
/**
 * r3-choose, `putThereThisTurn`: this object was put into the zone it is in this turn, from anywhere (CR 400.7: the object a zone change made has the subject id
 * of that zoneChange entry, so any entry for it this turn into its zone is that move).
 */
/** edh-next-116, `putThereThisCombat` (CR 400.7, 506.1): this object was put into the zone it is in during the current combat (its zoneChange entry has the current combat's number; no combat: never). */
export const putThereThisCombat = (s: GameState, o: GameObject): boolean => {
  const now = currentCombatNumber(s);
  return now > 0 && thisTurn(s, o.id, 'zoneChange').some((e) => e.facts['to'] === o.zone && e.combat === now);
};
export const putThereThisTurn = (s: GameState, o: GameObject, from?: string): boolean => from === 'discard' ? discardedByOwnerThisTurn(s, o)
  // edh-d-85 (CR 701.9a, 400.7, 404.1; Ghost of Ramirez DePietro): "that was discarded or put there from a library this turn": edh-d-102's discard test, or a move this turn from a library into its zone
  : from === 'discardOrLibrary' ? discardedByOwnerThisTurn(s, o) || thisTurn(s, o.id, 'zoneChange').some((e) => e.facts['to'] === o.zone && e.facts['from'] === 'library')
  : thisTurn(s, o.id, 'zoneChange').some((e) => e.facts['to'] === o.zone && (from === undefined || (from === 'mill' ? e.facts['milled'] === true : from === 'notBattlefield' ? e.facts['from'] !== 'battlefield' : e.facts['from'] === from))); // r5-fxz: `from`, the zone it came from (filter `putThereFrom`)
/**
 * Standard round 5, r5-trig, `crewedBySourceThisTurn` (CR 702.122c): the object `sourceId` was tapped this turn to pay a crew cost of this object
 * (the `by.id` fact of a `becomes` 'crewCostPaid' entry: the creature as it was then, CR 400.7).
 */
export const crewedBySourceThisTurn = (s: GameState, id: ObjectId, sourceId: ObjectId): boolean =>
  thisTurn(s, id, 'becomes').some((e) => e.facts['what'] === 'crewCostPaid' && e.facts['by.id'] === sourceId);
/** edh-perms-9, `cond: 'putBySource'` (CR 608.2, 400.7): this object was put onto the battlefield this turn by an effect of an ability of the object `sourceId` (the `viaSource` fact of its zoneChange entry). */
export const putOntoBattlefieldBy = (s: GameState, id: ObjectId, sourceId: ObjectId): boolean => thisTurn(s, id, 'zoneChange').some((e) => e.facts['to'] === 'battlefield' && e.facts['viaSource'] === sourceId);
/** Standard round 5, r5-trig, `enteredFrom` (CR 603.6a, 400.7): this object entered the battlefield this turn from `zone` (as this object). */
export const enteredFromThisTurn = (s: GameState, id: ObjectId, zone: string): boolean => thisTurn(s, id, 'zoneChange').some((e) => e.facts['to'] === 'battlefield' && e.facts['from'] === zone);
/**
 * std-rx12, `countersPutThisTurn`: counters of `kind` ('any': of any kind) were put on this object this turn by the player `by` (the `by` fact of a `counters` entry;
 * an entry that does not know who put them never matches, CR 122.6; the object as this object, CR 400.7).
 */
export const countersPutThisTurn = (s: GameState, id: ObjectId, kind: string, by: PlayerId): boolean =>
  thisTurn(s, id, 'counters').some((e) => e.facts['change'] === 'put' && e.facts['onPlayer'] !== true && (kind === 'any' || e.facts['kind'] === kind) && e.facts['by'] === by);
/** edh-next-139, `foughtThisTurn` (CR 701.14a, 400.7; Boxing Ring): this object fought this turn (a `fight` action of it, as this object). */
export const foughtThisTurn = (s: GameState, id: ObjectId): boolean => thisTurn(s, id, 'action').some((e) => e.facts['verb'] === 'fight');
/** `attackedThisTurn`: this creature was declared as an attacker this turn. */
export const attackedThisTurn = (s: GameState, id: ObjectId): boolean => thisTurn(s, id, 'attacks').length > 0;
/** edh-combat-5 (CR 508.1): how many times this creature was declared as an attacker this turn (an `attacks` entry per declaration, as this object, CR 400.7). */
export const attacksThisTurn = (s: GameState, id: ObjectId): number => thisTurn(s, id, 'attacks').length;
/** edh-combat-1 (CR 701.43a): this permanent was exerted this turn (an `exert` action entry whose subject is this object: as this object, CR 400.7). */
export const exertedThisTurn = (s: GameState, id: ObjectId): boolean => thisTurn(s, id, 'action').some((e) => e.facts['verb'] === 'exert');
/** `blockedThisTurn`: this creature was declared as a blocker this turn. */
export const blockedThisTurn = (s: GameState, id: ObjectId): boolean => thisTurn(s, id, 'blocks').length > 0;
/** edh-c-18 (CR 509.1h), `wasBlockedThisTurn`: this creature became blocked this turn (a `becomesBlocked` entry whose subject is the attacker). */
export const wasBlockedThisTurn = (s: GameState, id: ObjectId): boolean => thisTurn(s, id, 'becomesBlocked').length > 0;

/** std-copy-4 (CR 400.7): the ids `id` had before, newest first, by the `newId` links of last known information (a spell that became this permanent, ...). */
/** edh-c-53 (CR 400.7, 601.2i): the spell `id` resolved from, when it is a permanent that was a spell on the stack just before; none otherwise (an earlier cast of the same card is another object). */
export function resolvedFromSpell(s: GameState, id: ObjectId): ObjectId[] {
  const p = formerIds(s, id)[0];
  return p !== undefined && s.lki[p]?.leftZone === 'stack' ? [p] : [];
}

export function formerIds(s: GameState, id: ObjectId): ObjectId[] {
  const out: ObjectId[] = [];
  let cur = id;
  for (let guard = 0; guard < 8; guard++) {
    const prev = Object.entries(s.lki).find(([k, l]) => l.newId === cur && k !== cur)?.[0];
    if (prev === undefined || out.includes(prev)) break;
    out.push(prev);
    cur = prev;
  }
  return out;
}

// ---- patterns and filters over facts ------------------------------------------------------------------------------------------------------------------

export interface FactsEnv {
  /** The controller "you" / "opponent" are relative to. */
  you: PlayerId;
  /** The source object: `self` / `other` compare the entry's subject with it. */
  sourceId?: ObjectId;
  resolvePlayers?: PlayerResolver;
  /** Needed for a comparison whose value is a quantity. */
  qty?: (q: Quantity) => number | undefined;
  /**
   * std-rx14 (CR 400.7, 608.2c): the objects a reference names now (the ids of their handles), for `is` of a reference other than a fixed object or the source
   * ("each other Zombie that entered the battlefield under your control this turn": not the Zombie of the trigger event). Absent: such an `is` is unsupported.
   */
  objectIds?: (ref: ObjRef) => readonly ObjectId[];
  /**
   * std-copy-4 (CR 400.7, 201.5): the ids the source had before it became the object it is now (the spell it was on the stack, `GameState.lki` newId links):
   * `self` / `other` read an entry of one of them as the source too ("the first Otter spell other than Alania you've cast this turn": Alania's own spell is not
   * counted). Absent: the source's current id only.
   */
  sourceWas?: readonly ObjectId[];
  /**
   * edh-players-22 (CR 702.76a, 205.3m; prowl): the creature types of the source (the spell being cast) for a source filter's `sharesWith` {with: self, quality: creatureType}, and whether it
   * has every creature type (changeling). Absent: such a filter is unsupported.
   */
  sourceCreatureTypes?: { set: readonly string[]; all: boolean };
}

function playerOk(pred: PlayerPred | undefined, who: PlayerId | string | number | boolean | undefined, env: FactsEnv): boolean {
  if (pred === undefined) return true;
  if (typeof who !== 'string') return false;
  const r = playerPredMatches(pred, who, env.you, env.resolvePlayers);
  if (r === undefined) return unsupported('a player reference in a history pattern that cannot be resolved here');
  return r;
}

function cmpOk(c: NumberCmp | undefined, actual: string | number | boolean | undefined, env: FactsEnv): boolean {
  if (c === undefined) return true;
  if (typeof actual !== 'number') return false;
  const value = typeof c.value === 'number' ? c.value : env.qty?.(c.value);
  return value === undefined ? false : compareNumbers(c.op, actual, value);
}

const zoneOk = (want: ZoneName | ZoneName[] | undefined, actual: string | number | boolean | undefined): boolean =>
  want === undefined || (typeof actual === 'string' && (Array.isArray(want) ? want.includes(actual as ZoneName) : want === actual));

/** Does the object described by `facts` (under `prefix`) satisfy `f`? `zone` is ignored: the pattern's own `from` / `to` say where. */
export function factsMatchFilter(facts: Facts, prefix: string, f: ObjectFilter, env: FactsEnv, subject?: ObjectId): boolean {
  const get = (k: string) => facts[`${prefix}${k}`];
  /** Is this the source? The object of an entry has two ids when it moved (its id before in the facts, the one it became in `subject`): either one is it (CR 400.7). */
  const isSource = (): boolean => {
    const ids = [subject, get('id')].filter((x): x is string => typeof x === 'string');
    if (ids.length === 0) return unsupported(`history entry has no "${prefix}id" fact and no subject`);
    return env.sourceId !== undefined && (ids.includes(env.sourceId) || ids.some((x) => env.sourceWas?.includes(x) === true));
  };
  const need = (k: string): string | number | boolean => {
    const v = get(k);
    if (v === undefined) return unsupported(`history entry has no "${prefix}${k}" fact`);
    return v;
  };
  const has = (k: string, v: string): boolean => String(need(k)).includes(`|${v}|`);
  for (const [key, v] of Object.entries(f)) {
    if (v === undefined) continue;
    switch (key) {
      case 'zone': break;
      // edh-players-22 (CR 702.76a, 702.73a; prowl): "a creature that had any of this spell's creature types": the entry's source has one of the spell's creature types (or either has every one)
      case 'sharesWith': {
        const sw = v as NonNullable<ObjectFilter['sharesWith']>;
        if (JSON.stringify(sw) !== '{"with":{"ref":"self"},"quality":"creatureType"}' || env.sourceCreatureTypes === undefined) return unsupported('a quality shared with an object in a history pattern');
        const mine = env.sourceCreatureTypes;
        const theirs = String(need('subtypes')).split('|').filter(Boolean);
        const changeling = has('keywords', 'changeling');
        if (!((mine.all && theirs.length > 0) || (changeling && mine.set.length > 0) || mine.set.some((t) => has('subtypes', t)))) return false;
        break;
      }
      case 'anyOf': if (!(v as ObjectFilter[]).some((x) => factsMatchFilter(facts, prefix, x, env, subject))) return false; break;
      case 'not': if (factsMatchFilter(facts, prefix, v as ObjectFilter, env, subject)) return false; break;
      case 'controller': if (!playerOk(v as PlayerPred, need('controller') as string, env)) return false; break;
      case 'owner': if (!playerOk(v as PlayerPred, need('owner') as string, env)) return false; break;
      case 'types': if (!(v as string[]).some((t) => has('types', t))) return false; break;
      case 'allTypes': if (!(v as string[]).every((t) => has('types', t))) return false; break;
      case 'notTypes': if ((v as string[]).some((t) => has('types', t))) return false; break;
      case 'subtypes': if (!(v as string[]).some((t) => has('subtypes', t))) return false; break;
      case 'allSubtypes': if (!(v as string[]).every((t) => has('subtypes', t))) return false; break; // std-rx32 (CR 205.3m)
      case 'notSubtypes': if ((v as string[]).some((t) => has('subtypes', t))) return false; break;
      case 'supertypes': if (!(v as string[]).some((t) => has('supertypes', t))) return false; break;
      case 'notSupertypes': if ((v as string[]).some((t) => has('supertypes', t))) return false; break;
      case 'colors': if (!(v as string[]).some((t) => has('colors', t))) return false; break;
      case 'notColors': if ((v as string[]).some((t) => has('colors', t))) return false; break;
      case 'colorless': if ((String(need('colors')) === '||') !== v) return false; break;
      case 'multicolored': if ((String(need('colors')).split('|').filter(Boolean).length >= 2) !== v) return false; break;
      case 'monocolored': if ((String(need('colors')).split('|').filter(Boolean).length === 1) !== v) return false; break;
      case 'minCardTypes': if (String(need('types')).split('|').filter(Boolean).length < (v as number)) return false; break; // edh-d-86 (CR 205.2a)
      case 'name': if (!has('names', v as string)) return false; break;
      case 'notName': if (has('names', v as string)) return false; break;
      case 'manaValue': if (!cmpOk(v as NumberCmp, need('manaValue'), env)) return false; break;
      case 'power': if (!cmpOk(v as NumberCmp, get('power'), env)) return false; break;
      case 'toughness': if (!cmpOk(v as NumberCmp, get('toughness'), env)) return false; break;
      case 'keyword': if (!([] as string[]).concat(v as string | string[]).some((k) => has('keywords', k.toLowerCase()))) return false; break;
      case 'notKeyword': if (([] as string[]).concat(v as string | string[]).some((k) => has('keywords', k.toLowerCase()))) return false; break;
      case 'token': if (need('token') !== v) return false; break;
      case 'isCard': if (need('isCard') !== v) return false; break;
      case 'faceDown': if ((get('faceDown') === true) !== v) return false; break; // FAST5X E25 (CR 708.2)
      case 'manaCostHasX': if ((get('manaCostHasX') === true) !== v) return false; break; // edh-next-48 (CR 107.3): written for a spell cast (triggers/history.ts); an entry without the fact has none
      case 'kicked': if (get('kicked') !== true) return false; break; // edh-c-59 (CR 702.33d): written for a spell cast (triggers/normalize.ts); a past spell that was cast kicked
      case 'commander': if ((get('commander') === true) !== v) return false; break; // CMD2 (CR 903.3): written only for a commander (triggers/history.ts)
      case 'self': if (isSource() !== v) return false; break;
      // r5-dig (CR 400.7): the object a fixed reference names (either id of the entry's object, as for `self`), or the source itself
      case 'is': {
        const r = v as ObjRef;
        if (r.ref === 'self' && Object.keys(r).length === 1) { if (!isSource()) return false; break; }
        const ids = [subject, get('id')].filter((x): x is string => typeof x === 'string');
        // std-rx14 (CR 400.7, 608.2c): another reference (the object of the trigger event) through the environment: either id of the entry's object is one it names
        if (r.ref !== 'fixed' && env.objectIds !== undefined && r.ref !== 'each') { const named = env.objectIds(r); if (!named.some((id) => ids.includes(id))) return false; break; }
        if (r.ref !== 'fixed' || !('objects' in r)) return unsupported('a history filter "is" other than a fixed object or the source');
        if (!(r.objects as { id: ObjectId }[]).some((h) => ids.includes(h.id))) return false;
        break;
      }
      case 'other': if (v && isSource()) return false; break;
      default: return unsupported(`history filter field "${key}"`);
    }
  }
  return true;
}

/** The `ObjectFilter` fields that `factsMatchFilter` can answer from the facts (every other field makes it throw). */
export const ANSWERABLE_FIELDS: ReadonlySet<string> = new Set([
  'zone', 'anyOf', 'not', 'controller', 'owner', 'types', 'allTypes', 'notTypes', 'subtypes', 'allSubtypes', 'notSubtypes', 'supertypes', 'notSupertypes', 'colors', 'notColors', 'colorless',
  'multicolored', 'monocolored', 'minCardTypes' /* edh-d-86 */, 'name', 'notName', 'manaValue', 'power', 'toughness', 'keyword', 'notKeyword', 'token', 'isCard', 'self', 'other',
  'faceDown', // FAST5X E25
  'kicked', // edh-c-59 (CR 702.33d): a cast event keeps whether the spell was kicked
  'manaCostHasX', // edh-next-48 (CR 107.3): a cast event keeps whether the spell's mana cost has {X}
  'commander', // CMD2 (CR 903.3, 702.173a)
  'is', // r5-dig (CR 400.7): a fixed object or the source only ("a lore counter on this Saga" after it left, the reference fixed as the effect began; unanswerable below otherwise)
]);

/** r5-dig: an `is` the facts can answer: a fixed object, or the source (`self`, with nothing else). */
const isAnswerableIs = (v: unknown): boolean => typeof v === 'object' && v !== null && (((v as { ref?: unknown }).ref === 'fixed' && 'objects' in v) || ((v as { ref?: unknown }).ref === 'self' && Object.keys(v).length === 1) || (v as { ref?: unknown }).ref === 'target' /* edh-c-87: a target of the ability, resolved through the environment (effects/eval.ts factsEnv.objectIds) while the ability resolves */);

function unanswerable(f: ObjectFilter | undefined, out: Set<string>): void {
  if (!f) return;
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    if (!ANSWERABLE_FIELDS.has(k) || (k === 'is' && !isAnswerableIs(v))) out.add(`feature:history.pattern.${k}`);
    else if (k === 'anyOf') for (const x of v as ObjectFilter[]) unanswerable(x, out);
    else if (k === 'not') unanswerable(v as ObjectFilter, out);
  }
}

/** The object filters inside an event pattern, by the key that holds them (the same ones `historyMatches` reads). */
function patternFilters(p: EventPattern): (ObjectFilter | undefined)[] {
  switch (p.ev) {
    case 'zoneChange': return [p.subject];
    case 'cast': return [p.spell];
    case 'activate': return [p.source];
    case 'attacks': return [p.attacker];
    case 'blocks': return [p.blocker, p.attacker];
    case 'becomesBlocked': return [p.attacker, p.by];
    case 'attacksUnblocked': return [p.attacker]; // std-rx35
    case 'damage': return [p.source, p.recipient?.object];
    case 'damagePrevented': return [p.source, p.recipient?.object]; // edh-replace-3
    case 'becomes': return [p.object, p.by];
    case 'counters': return ['player' in p.on ? undefined : p.on];
    case 'action': return [p.object];
    case 'createToken': return [p.token];
    case 'resolves': return [p.what];
    case 'controlChange': return [p.object]; // Standard round 3, r3-trig
    default: return [];
  }
}

/**
 * The capability names (`feature:history.pattern.<field>`, never in `ENGINE_CAPABILITIES`) of the filter fields in a history pattern that the facts cannot
 * answer (`tapped`, `attacking`, `counters`, `hasAbility`, `faceDown`, ...): the capability walker reports them so the card is manual (design 5.2).
 */
export function historyPatternForms(p: EventPattern): string[] {
  const out = new Set<string>();
  for (const f of patternFilters(p)) unanswerable(f, out);
  return [...out];
}

/** Does this history entry satisfy the event pattern? (`state` patterns are not events: they are conditions and never appear in history.) */
export function historyMatches(e: HistoryEntry, p: EventPattern, env: FactsEnv): boolean {
  if (e.ev !== p.ev) return false;
  const f = e.facts;
  const subject = (flt: ObjectFilter | undefined): boolean => flt === undefined || factsMatchFilter(f, '', flt, env, e.subject);
  const other = (prefix: string, flt: ObjectFilter | undefined): boolean => flt === undefined || factsMatchFilter(f, prefix, flt, env);
  switch (p.ev) {
    case 'zoneChange': return zoneOk(p.from, f['from']) && zoneOk(p.to, f['to']) && subject(p.subject);
    // FAST5X E18: a filtered Nth (`nthMatching`) is not a fact of one entry (triggers/match.ts#nthMatchingOf counts it when the event happens)
    case 'cast': return playerOk(p.player, e.actor, env) && subject(p.spell) && zoneOk(p.from, f['from']) && (p.notFrom === undefined || (typeof f['from'] === 'string' && f['from'] !== p.notFrom)) /* r5-trig (CR 601.2a) */
      && (p.nthMin === undefined || (typeof f['nth'] === 'number' && f['nth'] >= p.nthMin)) /* r5-trig (CR 601.2i) */ && (p.copyOnly === true ? f['copy'] === true : p.orCopy === true || f['copy'] !== true)
      && (p.manaFromSelf === undefined || unsupported('the sources of the mana spent in a history pattern')) // std-lci: the facts keep no mana source (CR 106.3)
      && (p.nth === undefined || (p.nthMatching === true ? unsupported('the Nth spell of a kind in a history pattern') : f['nth'] === p.nth))
      && (p.via === undefined || (typeof f['via'] === 'string' && (f['via'] === p.via || f['via'].startsWith(`${p.via}:`)))) // FAST5X E2 (CR 702.185c)
      && (p.modal === undefined || f['modal'] === true); // Standard round 3, r3-trig (CR 700.2): an entry written before the fact existed never matches
    // Standard round 3, r3-trig (CR 606.3, 702.177a): `ability`, the kind of ability activated, from the entry's own fact (triggers/history.ts); an entry written before
    // the fact existed has none and never matches
    case 'activate': return playerOk(p.player, e.actor, env) && subject(p.source) && (p.manaAbility === true || f['mana'] !== true) && (p.ability === undefined || f[p.ability] === true) && (p.targetsYourCreature === undefined || f['targetsOwnCreature'] === true);
    case 'attacks': {
      if (!subject(p.attacker)) return false;
      if (p.alone !== undefined && (f['alone'] === true) !== p.alone) return false;
      if (!cmpOk(p.count, f['count'], env)) return false;
      if (!cmpOk(p.power, f['totalPower'], env)) return false; // Standard round 3, r3-trig (CR 508.1): an entry without the fact never matches a pattern that asks it
      if (p.allAttack !== undefined) return unsupported('whether every creature of a description attacked in a history pattern'); // edh-c-83: the facts keep no declaration
      if (p.withOther !== undefined) return unsupported('the other attackers of a declaration in a history pattern'); // edh-combat-5: the facts keep no declaration (the walker makes such a card manual: feature:ev.attacks.withOther is no history form)
      if (p.otherThanAttacker !== undefined) return unsupported('the attacked player compared with the attacker in a history pattern'); // edh-players-20: feature:ev.attacks.otherThanAttacker is no history form
      if (p.defending !== undefined && !playerOk(p.defending, f['defendingPlayer'], env)) return false; // edh-combat-1 (CR 508.5): an entry without the fact never matches
      if (p.defender === undefined) return true;
      if (p.defender === 'planeswalker' || p.defender === 'battle') return f['defenderKind'] === p.defender;
      // M12-3: "attacks you or a planeswalker you control" (triggers/history.ts records the planeswalker's controller as the defending player, CR 508.5)
      if (p.orPlaneswalker === true && f['defenderKind'] === 'planeswalker') return playerOk(p.defender, f['defendingPlayer'], env);
      return f['defenderKind'] === 'player' && playerOk(p.defender, f['defendingPlayer'], env);
    }
    // CR 509.3a: "blocked" is once per blocker however many attackers it blocks (only the first pair counts); CR 509.3b: "blocked a creature" is once per
    // attacker (every pair whose attacker matches). An entry written before `first` existed counts as a first pair.
    case 'blocks': return (p.attacker !== undefined || f['first'] !== false) && subject(p.blocker) && other('attacker.', p.attacker);
    // CR 509.3c: "became blocked" is once per attacker however many creatures block it (only the first pair counts); CR 509.3d: "became blocked by a creature"
    // is once per blocker (every pair whose blocker matches). An entry written before `first` existed counts as a first pair.
    case 'becomesBlocked': return p.byAtLeast === undefined /* edh-c-48: a count of blockers is not recorded (CR 509.3e), never matched here */ && (p.by !== undefined || f['first'] !== false) && subject(p.attacker) && other('by.', p.by);
    case 'damage': {
      if (p.combat !== undefined && (f['combat'] === true) !== p.combat) return false;
      if (p.excess === true && !(typeof f['excess'] === 'number' && f['excess'] > 0)) return false; // edh-next-110 (CR 120.10): only the damage entries with an excess part (an entry that does not know it never matches)
      if (!cmpOk(p.amount, f['amount'], env) || !other('source.', p.source)) return false;
      const r = p.recipient;
      if (r === undefined) return true;
      const toPlayer = f['toPlayer'] === true;
      const asObject = r.object !== undefined && !toPlayer && subject(r.object);
      const asPlayer = r.player !== undefined && toPlayer && playerOk(r.player, f['recipientPlayer'], env);
      return asObject || asPlayer;
    }
    case 'step': return f['step'] === p.step && playerOk(p.whose, e.actor, env) && (p.nth === undefined || f[p.step === 'endCombat' ? 'combatPhase' : 'mainPhase'] === p.nth); // FAST5X E17 (CR 505.1b); edh-d-34: the Nth combat phase of an end of combat (CR 500.8)
    case 'life': if (p.totalAmount !== undefined) return unsupported('the total life changed in a batch in a history pattern'); /* edh-players-20 */ return f['change'] === p.change && playerOk(p.player, e.actor, env) && cmpOk(p.amount, f['amount'], env);
    case 'draw': return playerOk(p.player, e.actor, env) && (p.nth === undefined || f['nth'] === p.nth);
    case 'reveal': return false; // edh-next-144: a reveal "this way" is linked to its source (CR 607.2), never a question about the turn's history
    case 'becomes': if (p.into !== undefined) return unsupported('what a permanent transformed into in a history pattern'); /* edh-next-76 */ if (p.notAsAttacker === true) return unsupported('whether a tap was the attack declaration\'s in a history pattern'); /* edh-players-20 */ return f['what'] === p.what && (p.untapStep === undefined || f['untapStep'] === true) && subject(p.object) && other('by.', p.by); // r5-trig: untapStep (CR 502.3)
    case 'counters': {
      if (f['change'] !== p.change || (p.kind !== undefined && f['kind'] !== p.kind)) return false;
      if (p.atLeast !== undefined && !cmpOk({ op: '>=', value: p.atLeast }, f['total'], env)) return false;
      // CLOUD std-msh (CR 122.6, 122.6a): the player who put them (an entry that does not know it never matches a pattern that asks)
      if (p.by !== undefined && (typeof f['by'] !== 'string' || !playerOk(p.by, f['by'], env))) return false;
      if ('player' in p.on) return f['onPlayer'] === true && playerOk(p.on.player, f['recipientPlayer'], env);
      return f['onPlayer'] !== true && subject(p.on);
    }
    // Standard round 4, r4-trig (CR 305.1): the zone a land was played from (`from`, `notFrom`); an entry written before the fact existed never matches a pattern that asks
    case 'action': return f['verb'] === p.verb && (p.revealed === undefined || f['revealed'] === p.revealed) && (p.won === undefined || f['won'] === p.won) /* p2-player-rules-3 */ && (p.from === undefined || f['from'] === p.from)
      && (p.notFrom === undefined || (typeof f['from'] === 'string' && f['from'] !== p.notFrom)) && playerOk(p.actor, e.actor, env) && subject(p.object)
      && (p.searched === undefined || (f['zone'] === 'library' && f['zoneOwner'] === e.actor)) /* edh-next-58 (CR 701.23a): the actor searched their OWN library */
      && (p.by === undefined || (p.verb === 'destroy' && typeof f['by'] === 'string' && playerOk(p.by, f['by'], env))); // std-lci: an explore's revealed card; edh-c-85 (CR 701.8a, 109.5): who controlled the spell or ability that destroyed it (an entry without the fact never matches)
    case 'createToken': return playerOk(p.player, e.actor, env) && subject(p.token);
    case 'dieRoll': return playerOk(p.player, e.actor, env) && cmpOk(p.result, f['result'], env) && (p.natural === undefined || (typeof f['natural'] === 'number' && f['natural'] === p.natural)) && (p.highest !== true || (typeof f['natural'] === 'number' && f['natural'] === f['sides'])); // edh-next-55
    case 'coinFlip': return playerOk(p.player, e.actor, env) && (p.won === undefined || f['won'] === p.won); // cloud r3-mech (CR 705.2)
    case 'beginTurn': return playerOk(p.whose, e.actor, env) && (p.extra === undefined || (f['extra'] === true) === p.extra);
    case 'resolves': return subject(p.what);
    case 'state': return unsupported('a state trigger is a condition, not an event in the history');
    // M6-0: no history entry is written for these (triggers/history.ts), so none ever has their `ev`; the answers below are what the facts would say.
    case 'phase': return f['phase'] === p.phase && playerOk(p.whose, e.actor, env);
    case 'dayNight': return p.to === undefined || f['to'] === p.to;
    case 'monarch': return playerOk(p.player, e.actor, env); // edh-players-18 (CR 725.3): no history entry is written for it; the answer is what the facts would say
    // M12-3 (CR 603.9): no history entry is written for a loss (triggers/history.ts); the answer is what the facts would say
    case 'loseGame': return playerOk(p.player, e.actor, env);
    // Standard round 3, r3-trig (CR 108.4): no history entry is written for a change of control (triggers/history.ts); the answer is what the facts would say
    case 'controlChange': return playerOk(p.from, f['from'], env) && playerOk(p.to, f['to'], env) && subject(p.object);
    // std-rx35 (CR 509.1h): no history entry is written for an unblocked attacker (triggers/history.ts); the answer is what the facts would say
    case 'attacksUnblocked': return subject(p.attacker);
    case 'abilityTriggered': return unsupported('a triggered ability triggering is not written to the history'); // std-copy-6 (triggers/collect.ts#metaEvents)
    case 'damagePrevented': return unsupported('prevented damage is not written to the history'); // edh-replace-3 (CR 615.13): triggers only
  }
}

/** How many events of the scope match the pattern (optionally only those done by a player matching `by`). */
export function countHistory(s: GameState, pattern: EventPattern, scope: HistoryScope, by: PlayerPred | undefined, env: FactsEnv): number {
  let n = 0;
  // CLOUD std-ecl (CR 508.1, 506.4): a creature that attacked in two combats of the turn is one creature "you attacked with" ("you attacked with three or more
  // creatures this turn"): attacks are counted once per attacking object (an entry without a subject counts on its own)
  const attackers = pattern.ev === 'attacks' ? new Set<string>() : null;
  for (const e of historyInScope(s, scope, env.you)) {
    if (by !== undefined && !playerOk(by, e.actor, env)) continue;
    if (!historyMatches(e, pattern, env)) continue;
    if (attackers !== null && e.subject !== undefined) {
      if (attackers.has(e.subject)) continue;
      attackers.add(e.subject);
    }
    n++;
  }
  return n;
}

/**
 * M6-0 (`happenedCount.per: 'player'`): the MAXIMUM over the players of the number of matching events each player did ("if a player cast two or more spells
 * last turn", the back faces of the Innistrad werewolves). An entry without an actor belongs to no player. `by` restricts the players counted.
 */
export function maxHistoryPerPlayer(s: GameState, pattern: EventPattern, scope: HistoryScope, by: PlayerPred | undefined, env: FactsEnv, sum?: 'amount' | 'manaValue' | 'power'): number {
  // Standard round 5, r5-trig (CR 120.1, 510.2): with `sum`, the damage each player was dealt, added up (only a damage pattern: its entries' actor is the player dealt it)
  if (sum !== undefined && (sum !== 'amount' || pattern.ev !== 'damage')) return unsupported('a sum of amounts of an event other than damage');
  const per = new Map<string, number>();
  for (const e of historyInScope(s, scope, env.you)) {
    if (e.actor === undefined) continue;
    if (by !== undefined && !playerOk(by, e.actor, env)) continue;
    if (!historyMatches(e, pattern, env)) continue;
    const add = sum === undefined ? 1 : e.facts['toPlayer'] === true && typeof e.facts['amount'] === 'number' ? e.facts['amount'] : 0;
    per.set(e.actor, (per.get(e.actor) ?? 0) + add);
  }
  return per.size === 0 ? 0 : Math.max(...per.values());
}

/**
 * CLOUD std-tmt (`happenedDistinct`, CR 205.2a): the number of different card types among the subjects of the entries of `scope` that match `pattern` (done by a
 * player of `by`): the `types` fact each entry recorded for its object as it was at the event (objectFacts lists them |a|b|). An entry without that fact fails
 * closed (as factsMatchFilter does).
 */
export function distinctHistory(s: GameState, pattern: EventPattern, scope: HistoryScope, by: PlayerPred | undefined, env: FactsEnv, what: 'cardTypes' | 'sources' = 'cardTypes'): number {
  if (what === 'sources') return distinctSources(s, pattern, scope, by, env); // cloud r3-mech
  const CARD_TYPES = new Set(['Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Land', 'Planeswalker', 'Sorcery']); // CR 205.2a
  const seen = new Set<string>();
  for (const e of historyInScope(s, scope, env.you)) {
    if (by !== undefined && !playerOk(by, e.actor, env)) continue;
    if (!historyMatches(e, pattern, env)) continue;
    const types = e.facts['types'];
    if (types === undefined) return unsupported('history entry has no "types" fact');
    for (const t of String(types).split('|')) if (CARD_TYPES.has(t)) seen.add(t);
  }
  return seen.size;
}

/**
 * edh-players-9 (`happenedPlayers`, CR 102.3, 121.1, 120.2a, 120.8): which of `players` have at least (`times`, default 1 or more) events of `scope` that match
 * `pattern`, each player judged alone with the pattern read from that player's side (`env.you` is the player judged: "you" of the pattern is that player). An entry
 * of `damage` with an amount of 0 is no damage dealt (CR 120.8). The caller counts the players returned.
 */
export function happenedPlayersOf(s: GameState, players: readonly PlayerId[], pattern: EventPattern, scope: HistoryScope, times: { op: NumberCmp['op']; n: number } | undefined, env: FactsEnv): PlayerId[] {
  const entries = historyInScope(s, scope, env.you);
  return players.filter((p) => {
    const mine: FactsEnv = { ...env, you: p };
    let n = 0;
    for (const e of entries) {
      if (e.ev !== pattern.ev || (pattern.ev === 'damage' && e.facts['amount'] === 0)) continue;
      if (historyMatches(e, pattern, mine)) n++;
    }
    return compareNumbers(times?.op ?? '>=', n, times?.n ?? 1);
  });
}

/**
 * Cloud r3-mech (`happenedDistinct` with `what: 'sources'`, CR 120.1, 400.7, 719.3a): the number of different sources among the `damage` entries of `scope` that match
 * `pattern` (done by a player of `by`): each entry's `source.id` fact, the source as it was when it dealt the damage (a source that changed zones since is another
 * object). An entry with an amount of 0 is no damage dealt (CR 120.8); an entry of another event, or one without that fact, fails closed.
 */
function distinctSources(s: GameState, pattern: EventPattern, scope: HistoryScope, by: PlayerPred | undefined, env: FactsEnv): number {
  if (pattern.ev !== 'damage') return unsupported('different sources among events other than damage');
  const seen = new Set<string>();
  for (const e of historyInScope(s, scope, env.you)) {
    if (by !== undefined && !playerOk(by, e.actor, env)) continue;
    if (!historyMatches(e, pattern, env) || e.facts['amount'] === 0) continue;
    const id = e.facts['source.id'];
    if (id === undefined) return unsupported('damage entry has no "source.id" fact');
    seen.add(String(id));
  }
  return seen.size;
}

/**
 * Standard round 5, r5-trig (`cond: 'firstTime'`, CR 603.4, 603.2c): "if it's the first time that creature has become tapped this turn": the entries of this turn
 * that match `pattern` and are about one of `ids` (the entry's subject, or its `id` fact: the object as it was then, CR 400.7) all belong to ONE simultaneous
 * batch (`HistoryEntry.batch`; an entry without it is a batch of its own). False when there is none: the event that is asked about is in the history before
 * any trigger is collected (triggers/stack.ts), so none means the object is a different object now.
 */
export function firstTimeThisTurn(s: GameState, ids: readonly ObjectId[], pattern: EventPattern, env: FactsEnv): boolean {
  const batches = new Set<string>();
  s.history.forEach((e, i) => {
    if (e.turn !== s.turn.number || e.ev !== pattern.ev) return;
    const about = (e.subject !== undefined && ids.includes(e.subject)) || (typeof e.facts['id'] === 'string' && ids.includes(e.facts['id']));
    if (about && historyMatches(e, pattern, env)) batches.add(e.batch !== undefined ? `b${e.batch}` : `i${i}`);
  });
  return batches.size === 1;
}

/**
 * std-rB (CR 120.1, 120.3, 602.5b; Ojer Axonil's "red sources you controlled dealt 4 or more noncombat damage this turn"): with `sum` and no `per`, the damage of
 * every matching entry of `scope` added up, to players and to objects alike (each entry is one recipient's damage from one source, triggers/history.ts; the
 * source's facts are as it was when it dealt the damage, CR 400.7). Only a damage pattern.
 */
function sumHistory(s: GameState, pattern: EventPattern, scope: HistoryScope, by: PlayerPred | undefined, env: FactsEnv, sum: 'amount' | 'manaValue' | 'power' = 'amount'): number {
  // edh-d-92 (CR 208.1, 700.4, 608.2h; Genesis of the Daleks): `sum: 'power'` adds up the powers of the objects of the matching zone changes, each as it last existed (the entry's
  // `power` fact, written from the object's last known information); an entry without that fact fails closed
  if (sum === 'power') {
    if (pattern.ev !== 'zoneChange') return unsupported('a sum of powers of an event other than a zone change');
    let total = 0;
    for (const e of historyInScope(s, scope)) {
      if (by !== undefined && !playerOk(by, e.actor, env)) continue;
      if (!historyMatches(e, pattern, env)) continue;
      if (typeof e.facts['power'] !== 'number') return unsupported('zone-change entry has no "power" fact');
      total += e.facts['power'];
    }
    return total;
  }
  // edh-cast-12 (CR 202.3, 202.3e, 601.2i; Call Forth the Tempest): `sum: 'manaValue'` adds up the mana values of the spells cast (a `cast` entry's `castManaValue` fact is the
  // spell's value as it became cast, with its announced X, CR 202.3e); an entry without that fact fails closed
  if (sum === 'manaValue') {
    if (pattern.ev !== 'cast') return unsupported('a sum of mana values of an event other than casting a spell');
    let total = 0;
    for (const e of historyInScope(s, scope, env.you)) {
      if (by !== undefined && !playerOk(by, e.actor, env)) continue;
      if (!historyMatches(e, pattern, env)) continue;
      if (typeof e.facts['castManaValue'] !== 'number') return unsupported('cast entry has no "castManaValue" fact');
      total += e.facts['castManaValue'];
    }
    return total;
  }
  // edh-replace-5 (CR 107.14, 122.1; Izzet Generatorium): and the counters (energy) a player paid or lost, each `counters` entry's `amount`
  if (pattern.ev !== 'damage' && pattern.ev !== 'counters') return unsupported('a sum of amounts of an event other than damage or counters');
  let n = 0;
  for (const e of historyInScope(s, scope, env.you)) {
    if (by !== undefined && !playerOk(by, e.actor, env)) continue;
    if (!historyMatches(e, pattern, env)) continue;
    if (typeof e.facts['amount'] !== 'number') return unsupported('damage entry has no "amount" fact');
    n += e.facts['amount'];
  }
  return n;
}

/**
 * edh-next-82 (`happenedCount.per: 'source'`, CR 120.1, 400.7; Dragon Cultist): the MOST damage any one source dealt in the scope (the amounts of the matching `damage` entries added up
 * per `source.id` fact, the source as it was when it dealt the damage). An entry without a source id counts for no source (fails closed); an amount of 0 is no damage (CR 120.8).
 */
export function maxHistoryPerSource(s: GameState, pattern: EventPattern, scope: HistoryScope, by: PlayerPred | undefined, env: FactsEnv, sum?: 'amount' | 'manaValue' | 'power'): number {
  // edh-next-96 (CR 202.3, 202.3e, 601.2i; Rootha, Mastering the Moment): the greatest mana value among the spells cast in the scope (each spell is its own source): the largest
  // `castManaValue` of the matching `cast` entries (0 when none); an entry without that fact fails closed
  if (sum === 'manaValue' && pattern.ev === 'cast') {
    let best = 0;
    for (const e of historyInScope(s, scope, env.you)) {
      if (by !== undefined && !playerOk(by, e.actor, env)) continue;
      if (!historyMatches(e, pattern, env)) continue;
      if (typeof e.facts['castManaValue'] !== 'number') return unsupported('cast entry has no "castManaValue" fact');
      best = Math.max(best, e.facts['castManaValue']);
    }
    return best;
  }
  if (sum !== 'amount' || pattern.ev !== 'damage') return unsupported('a per-source total of anything but damage amounts');
  const per = new Map<string, number>();
  for (const e of historyInScope(s, scope, env.you)) {
    if (by !== undefined && !playerOk(by, e.actor, env)) continue;
    if (!historyMatches(e, pattern, env)) continue;
    const id = e.facts['source.id'];
    const amount = e.facts['amount'];
    if (typeof id !== 'string' || typeof amount !== 'number' || amount === 0) continue;
    per.set(id, (per.get(id) ?? 0) + amount);
  }
  return per.size === 0 ? 0 : Math.max(...per.values());
}

/** The value of a `happenedCount` quantity (M6-0: with `per: 'player'`, the per-player maximum; otherwise the total; std-rB: `sum` without `per`, the total amount). */
export function happenedCountOf(s: GameState, q: { event: EventPattern; scope: HistoryScope; by?: PlayerPred; per?: 'player' | 'source'; sum?: 'amount' | 'manaValue' | 'power' }, env: FactsEnv): number {
  if (q.per === 'source') return maxHistoryPerSource(s, q.event, q.scope, q.by, env, q.sum); // edh-next-82
  if (q.sum !== undefined && q.per !== 'player') return sumHistory(s, q.event, q.scope, q.by, env, q.sum);
  return q.per === 'player' ? maxHistoryPerPlayer(s, q.event, q.scope, q.by, env, q.sum) : countHistory(s, q.event, q.scope, q.by, env);
}

/**
 * trek-15 (CR 506.3, 508.1; Galvanizing Tenor, Martok): the different opponents of `controller` that a creature of theirs was declared as an attacker against this
 * turn (`combat` null), or in that one combat (melee's "this combat"). A planeswalker or battle attacked is not its player (CR 506.3). The one reader of
 * effects/eval.ts (`opponentsAttacked`) and of the announcement of a calculated number of targets (actions/announce-cond.ts), so they cannot disagree.
 */
export function opponentsAttackedCount(s: GameState, controller: PlayerId, combat: number | null, present = false): number {
  const attacked = new Set<string>();
  for (const e of s.history) {
    if (e.ev !== 'attacks' || e.turn !== s.turn.number || (combat !== null && e.combat !== combat) || e.actor !== controller || e.facts['defenderKind'] !== 'player') continue;
    const p = e.facts['defendingPlayer'];
    // edh-next-98 (CR 800.4a; Dimir Strandcatcher ruling 2024-02-02): `present` ("opponents being attacked") does not count a player who has left the game since; melee and the turn counts do (Adriana and Rose rulings)
    if (typeof p === 'string' && p !== controller && (!present || s.players.find((x) => x.id === p)?.hasLost !== true)) attacked.add(p);
  }
  return attacked.size;
}
