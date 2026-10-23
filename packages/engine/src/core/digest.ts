/**
 * RPL-0 (replays design 4, "Digests, not state hashes"): a short digest of what a game IS, for the checkpoints of a replay. A hash of the whole state
 * changes whenever a state field is added, so it would fail on every other engine build even when the game plays the same; this digest covers only the
 * facts of the game, so a replay made on another build is checked against what happened, not against how the state was written down.
 *
 * The digest is cyrb128 (rng.ts) over a canonical summary:
 *  - the turn: its number, the step, the active player and the game's stage;
 *  - each player in seat order: life, poison, counters (CR 122.1), whether they lost (CR 104.3) and whether they left (CR 800.4a), and the mana in
 *    their pool (CR 106.4: its types, snow, whether it is restricted and how long it stays);
 *  - every zone's cards in order (libraries top first, graveyards bottom first, CR 401.1, 404.1), each by its definition, with owner, controller,
 *    tapped, flipped (CR 710), face down, phased out (CR 702.26), the face up (CR 712), counters, damage and what it is attached to; a permanent also
 *    with its name, colors, power, toughness and types after the layers (CR 613, through the characteristics function, rules/characteristics.ts);
 *  - the stack's objects bottom first, with the ability they are, their targets by position (CR 405.2, 601.2c);
 *  - combat: each attacker with what it attacks and whether it is blocked, each blocker with what it blocks, by position (CR 506.4, 508.1, 509.1);
 *  - the result: over or not, and the winner (CR 104).
 *
 * Object ids are left out: renumbering them (a build that hands ids out in another order) changes no fact of the game. Where one object refers to
 * another (an attachment, a target, an attacker), the summary names the other by its position: its zone, its owner for a zone each player has, and its
 * index there. The same goes for the other numbers the engine hands out as it goes, effect ids and timestamps (`counters.effect`,
 * `counters.timestamp`): an ability on the stack is named by what it is, not by the ids in its key (RPL-0 review: a granted ability's key held the
 * granting Equipment's object id, a delayed trigger's its effect id and timestamp). A card's definition is its definition id (the config carries the
 * definitions, so the ids are the same under every build); a token's or an emblem's is its name, since the engine makes those definitions and their ids
 * come from their JSON, which a build may write differently. Text that is only wording (a log line, the reason of a loss) is left out too.
 *
 * Pure: the same state gives the same digest on every build that reads it the same way. A digest that is too strict only makes a replay fall back to
 * its recording sooner, which is safe (design 14.3).
 */
import { cyrb128 } from '../rng';
import type { AbilityRef, GameObject, GameState, ManaUnit } from '../types/state';
import type { ObjectId, PlayerId } from '../types/ids';
import { getChars, readingStable } from '../rules/characteristics';

/** The version of the summary below; it begins every digest ("d1:..."), so a digest of another version is never mistaken for a different game. */
export const DIGEST_VERSION = 1;

/** A replay takes a checkpoint at every 20th action (design 4). */
export const CHECKPOINT_EVERY = 20;

type Json = string | number | boolean | null | Json[];

const PER_PLAYER_ZONES = ['library', 'hand', 'graveyard'] as const;
const SHARED_ZONES = ['battlefield', 'stack', 'exile', 'command'] as const;

/** Counters as sorted [name, amount] pairs, without zero amounts (an emptied counter and a removed key are the same fact). */
function countersOf(rec: Readonly<Record<string, number>> | undefined): Json[] {
  if (!rec) return [];
  return Object.keys(rec).filter((k) => rec[k] !== 0).sort().map((k) => [k, rec[k]!]);
}

/** Every object in a zone by its position (see the file comment). */
function positions(state: GameState): Map<ObjectId, string> {
  const at = new Map<ObjectId, string>();
  for (const zone of PER_PLAYER_ZONES) {
    for (const p of state.players) (state.zones[zone][p.id] ?? []).forEach((id, i) => at.set(id, `${zone}:${p.id}:${i}`));
  }
  for (const zone of SHARED_ZONES) state.zones[zone].forEach((id, i) => at.set(id, `${zone}:${i}`));
  return at;
}

/** A reference to an object or a player: a player by id, an object by position, anything else (an object that has left) as '?'. */
function refOf(state: GameState, at: ReadonlyMap<ObjectId, string>, id: ObjectId | PlayerId | undefined): Json {
  if (id === undefined) return null;
  const pos = at.get(id);
  if (pos !== undefined) return pos;
  return state.players.some((p) => p.id === id) ? `player:${id}` : '?';
}

/** An id the engine hands out from a counter as the game goes (an effect `e17`, a trigger `t23`, a delayed trigger `d4`): not a fact of the game. */
const COUNTER_ID = /^[etd][0-9]+$/;

/**
 * A key the engine wrote (an ability's key, `g:live:o176:p:0:0:0:0`) with every object id in it named by its position and every id handed out from a
 * counter left out, so two builds that number differently write the same key.
 */
function keyOf(state: GameState, at: ReadonlyMap<ObjectId, string>, key: string): string {
  return key
    .split(':')
    .map((t) => (Object.hasOwn(state.objects, t) || Object.hasOwn(state.lki, t) ? String(refOf(state, at, t)) : COUNTER_ID.test(t) ? '#' : t))
    .join(':');
}

/**
 * The ability a stack object is (CR 113.3), without what numbering left in its reference: a printed, keyword, rule or emblem ability by its face, index and
 * key; a granted or copied one by its key with ids replaced (`keyOf`); a delayed trigger (index: when it was created; key: its effect id, CR 603.7) and
 * a reflexive or miracle trigger (key: `reflexive:<n>`, `miracle:<n>`, CR 603.12, 702.94) by what kind it is. Its source is in the summary already.
 */
function abilityOf(state: GameState, at: ReadonlyMap<ObjectId, string>, ref: AbilityRef): Json {
  switch (ref.source) {
    case 'delayed':
      return [ref.source, ref.face];
    case 'reflexive':
      return [ref.source, ref.face, ref.index, (ref.key ?? '').split(':')[0]!];
    default:
      return [ref.source, ref.face, ref.index, ref.key === undefined ? null : keyOf(state, at, ref.key)];
  }
}

/** A player's mana pool (CR 106.4), in a canonical order: each unit's type, snow, whether it is restricted and how long it stays. */
function poolOf(units: readonly ManaUnit[] | undefined): Json[] {
  return (units ?? []).map((u) => JSON.stringify([u.type, u.snow === true, u.restriction !== undefined, u.keep ?? null])).sort();
}

/** Combat (CR 506-511) by position: each attacker with what it attacks, the player it attacks and whether it is blocked; each blocker with what it blocks. */
function combatOf(state: GameState, at: ReadonlyMap<ObjectId, string>): Json {
  const c = state.combat;
  if (!c) return null;
  const attackers: Json[] = c.attackers.map((a) => [refOf(state, at, a.id), a.defender === null ? null : refOf(state, at, a.defender), a.defendingPlayer, a.blocked, a.blockedBy.map((b) => refOf(state, at, b))]);
  const blockers: Json[] = c.blockers.map((b) => [refOf(state, at, b.id), b.blocking.map((x) => refOf(state, at, x)), b.defendingPlayer]);
  return [c.number, c.attacked, attackers, blockers, c.damageSteps];
}

/** The definition of an object, as the summary names it: a card's definition id, a token's or an emblem's name. */
function defOf(state: GameState, o: GameObject): Json {
  const def = Object.hasOwn(state.defs, o.defId) ? state.defs[o.defId] : undefined;
  if (o.kind === 'token' || o.kind === 'emblem' || def?.isToken) return `${o.kind}:${def?.name ?? o.defId}`;
  return o.defId;
}

/**
 * The name, colors, power, toughness and type line of a permanent after the layers (CR 613); '!' when the characteristics can't be computed (the same
 * on every run).
 */
function layered(state: GameState, o: GameObject): Json {
  if (o.kind === 'ability' || o.kind === 'emblem') return null;
  try {
    const c = getChars(state, o.id);
    return [c.name, [...c.colors], c.power ?? null, c.toughness ?? null, [...c.supertypes], [...c.types], [...c.subtypes]];
  } catch {
    return '!';
  }
}

function objectOf(state: GameState, at: ReadonlyMap<ObjectId, string>, id: ObjectId, zone: string): Json {
  const o = Object.hasOwn(state.objects, id) ? state.objects[id] : undefined;
  if (!o) return '?';
  const facts: Json[] = [
    defOf(state, o), o.owner, o.controller, o.tapped, o.flipped === true, o.faceDown, o.phasedOut === true, o.face ?? 0, countersOf(o.counters), o.damage,
    refOf(state, at, o.attachedTo),
  ];
  if (zone === 'battlefield') facts.push(layered(state, o));
  if (zone === 'stack' && o.stack) {
    const st = o.stack;
    const source = st.sourceId === undefined ? null : at.get(st.sourceId) ?? `name:${st.sourceName ?? ''}`;
    const ability = st.abilityRef ? abilityOf(state, at, st.abilityRef) : null;
    const targets = st.targets.map((spec) => spec.map((t) => refOf(state, at, t.id)));
    facts.push([st.kind, source, ability, st.face ?? null, st.modes ? [...st.modes] : null, st.x ?? null, targets]);
  }
  return facts;
}

/** The canonical summary of a game (see the file comment), as JSON text. Exported for tests and for diagnosing a difference. */
export function digestSummary(state: GameState): string {
  return readingStable(state, () => {
    const at = positions(state);
    const turn: Json = [state.turn.number, state.turn.step, state.turn.activePlayer, state.stage];
    const players: Json = state.players.map((p) => [p.id, p.life, p.poison, countersOf(p.counters), p.hasLost, p.left !== undefined, poolOf(p.manaPool)]);
    const zones: Json[] = [];
    for (const zone of PER_PLAYER_ZONES) {
      for (const p of state.players) zones.push([zone, p.id, (state.zones[zone][p.id] ?? []).map((id) => objectOf(state, at, id, zone))]);
    }
    for (const zone of SHARED_ZONES) zones.push([zone, state.zones[zone].map((id) => objectOf(state, at, id, zone))]);
    const result: Json = state.result ? [true, state.result.winner] : [false, null];
    return JSON.stringify([DIGEST_VERSION, turn, players, zones, combatOf(state, at), result]);
  });
}

const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');

/** The checkpoint digest of a game: "d1:" and 32 hexadecimal digits (cyrb128 of `digestSummary`). */
export function gameDigest(state: GameState): string {
  const h = cyrb128(digestSummary(state));
  return `d${DIGEST_VERSION}:${h.map(hex).join('')}`;
}

/**
 * The checkpoint rule (design 4): the state right after the action at `index` of the log (0 = the first action) gets a checkpoint when a turn began
 * during that action (CR 500: the turn number grew), at every 20th action, and at the last action of the log.
 */
export function checkpointDue(at: { index: number; turnBefore: number; turnAfter: number; last: boolean }): boolean {
  return at.last || at.turnAfter !== at.turnBefore || (at.index + 1) % CHECKPOINT_EVERY === 0;
}
