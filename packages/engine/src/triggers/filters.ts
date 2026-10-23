/**
 * Object and player predicates for event patterns (design 3.3, 3.5). Owner: WP8.
 *
 * Event patterns carry `ObjectFilter`s ("another creature you control", "a spell that targets ~") and `PlayerPred`s. `rules/filter.ts#matchesFilter` (WP4) evaluates
 * the characteristics fields; this module adds what only an event can say: `self` / `other` against the identity of the ability's source (a zone change gives the
 * object two ids, CR 400.7), `controller` / `owner` as `PlayerPred`s, `anyOf` / `not`, and the stack kinds. Anything the two together cannot evaluate NEVER matches
 * (a trigger that does not fire is visible; a trigger that fires wrongly is not) and its `ev:` / `filter:` capability is then missing, so the card is manual.
 */
import type { ObjectFilter, PlayerPred, PlayerRef } from '../types/ability';
import { seatNeighbor } from '../statics/seats';
import { attachedPlayer } from '../statics/attached-player';
import type { ObjectId, PlayerId } from '../types/ids';
import type { EventContext, GameObject, GameState } from '../types/state';
import { matchesFilter } from '../rules/filter';
import { filterCtxOutside, filterEnvOutside } from '../rules/filter-env';

/** Who the pattern is relative to. */
export interface FilterCx {
  /** The object whose ability owns the pattern: `self` / `other` mean this object. */
  source: ObjectId;
  /** The player "you" and "opponent" are relative to. */
  controller: PlayerId;
  /**
   * std-combat-1 (CR 603.2): the event being matched, for a description that names another object of the same event ("a nonland permanent ... with mana value less than
   * or equal to that Aura's mana value", `{ref:'event'}` in the filter; triggers/match.ts passes it for the attach event only). Absent: such a reference is nothing.
   * std-combat-3 (CR 603.10a): also for a leaves-the-battlefield pattern read on the battlefield as it was (triggers/lookback-board.ts).
   */
  event?: EventContext;
}

/** The object `id` as it is now, or as it last was (last known information). */
export function lookupObject(s: GameState, id: ObjectId): GameObject | undefined {
  return s.objects[id] ?? s.lki[id]?.object;
}

/** A PlayerPred or PlayerRef against one player. A reference this module cannot resolve in an event pattern matches nothing. */
export function playerMatches(s: GameState, pred: PlayerPred | undefined, player: PlayerId | undefined, cx: FilterCx): boolean {
  if (pred === undefined || pred === 'any') return true;
  if (player === undefined) return false;
  if (pred === 'you') return player === cx.controller;
  // M12-2 (m12 design E25): a player who left the game is nobody's opponent any more (CR 800.4a, 102.3), as for `each` below
  if (pred === 'opponent') return player !== cx.controller && s.players.some((p) => p.id === player && !p.hasLost);
  return refPlayers(s, pred, cx).includes(player);
}

function refPlayers(s: GameState, ref: PlayerRef, cx: FilterCx): PlayerId[] {
  switch (ref.ref) {
    case 'you': return [cx.controller];
    case 'active': return [s.turn.activePlayer];
    case 'controllerOf':
    case 'ownerOf': {
      // FAST1 T4 (CR 303.4, 301.5): also the permanent the source is attached to ("the upkeep of enchanted creature's controller"); before, that reference read
      // nobody, so such a trigger never matched. An Aura attached to a player has no permanent there: nobody.
      const src = lookupObject(s, cx.source);
      const o = ref.object.ref === 'self' ? src : ref.object.ref === 'attachedTo' && src?.attachedTo !== undefined ? s.objects[src.attachedTo] : undefined;
      return o ? [ref.ref === 'controllerOf' ? o.controller : o.owner] : [];
    }
    // M12-1 (m12 design E25): players who left the game are not "each player" / "each opponent" any more (CR 800.4a, 102.3)
    case 'each': return s.players.filter((p) => !p.hasLost && (ref.who === 'player' || p.id !== cx.controller)).map((p) => p.id);
    case 'enchantedPlayer': return attachedPlayer(s, lookupObject(s, cx.source)); // std-rr (CR 303.4, 702.5a): the player the source Aura is attached to
    case 'seat': { // M12-1 (m12 design D6): the next / previous player in turn order still in the game (CR 101.4, 103.1), from `of` (you by default)
      const from = ref.of !== undefined ? refPlayers(s, ref.of, cx) : [cx.controller];
      return [...new Set(from.flatMap((p) => { const n = seatNeighbor(s, p, ref.side); return n !== undefined ? [n] : []; }))];
    }
    // WP15 INTERFACE CHANGE: the players a resolved effect, a delayed trigger or an `until` duration fixed when it was created ("that player", "target
    // player", CR 603.7, 610.3, 611.2a; effects/handlers/lasting-fix.ts).
    case 'fixed': return 'players' in ref ? [...ref.players] : [];
    // WP30: any other reference is read in the environment of a filter outside a resolution (rules/filter-env.ts), as the interpreter would read it; what
    // cannot be determined there is nobody.
    default: return filterEnvOutside(s, { controller: cx.controller, sourceId: cx.source }).refs?.(ref)?.players ?? [];
  }
}

/** Comparison with a number (a quantity that is not a number cannot be evaluated while events are matched: no match). */
export function cmpMatches(c: { op: '<=' | '>=' | '==' | '!=' | '<' | '>'; value: unknown } | undefined, actual: number | undefined): boolean {
  if (c === undefined) return true;
  if (actual === undefined || typeof c.value !== 'number') return false;
  switch (c.op) {
    case '<=': return actual <= c.value;
    case '>=': return actual >= c.value;
    case '==': return actual === c.value;
    case '!=': return actual !== c.value;
    case '<': return actual < c.value;
    case '>': return actual > c.value;
  }
}

const stackKindMatches = (o: GameObject, kind: NonNullable<ObjectFilter['stackKind']>): boolean => {
  switch (kind) {
    case 'spell': return o.kind === 'card' || o.kind === 'spellCopy';
    case 'copy': return o.kind === 'spellCopy';
    case 'ability': return o.kind === 'ability';
    case 'activatedAbility': return o.kind === 'ability' && o.stack?.kind === 'activated';
    case 'triggeredAbility': return o.kind === 'ability' && o.stack?.kind === 'triggered';
  }
};

/**
 * Does `o` satisfy `f`? `identity` lists every id the object has had during the event (a zone change: the old and the new id), so `self` is true for the
 * source whichever of them the source is.
 */
export function objectMatches(s: GameState, f: ObjectFilter | undefined, o: GameObject, identity: readonly ObjectId[], cx: FilterCx): boolean {
  if (f === undefined) return true;
  if (f.anyOf && !f.anyOf.some((x) => objectMatches(s, x, o, identity, cx))) return false;
  if (f.not && objectMatches(s, f.not, o, identity, cx)) return false;
  // `is`, `targets`, `sharesWith`, a quantity in a comparison and the link of `chosen` are left to `matchesFilter` (WP4), which reads them in the environment of a
  // filter outside a resolution (WP30, rules/filter-env.ts): "a spell that targets you", "a creature that shares a creature type with ~", "a creature of the
  // chosen type" (CR 607.2d: the source's link).
  const { anyOf: _anyOf, not: _not, self, other, controller, owner, stackKind, castFrom, ...rest } = f;
  const isSource = identity.includes(cx.source);
  if (self !== undefined && isSource !== self) return false;
  if (other === true && isSource) return false;
  if (controller !== undefined && !playerMatches(s, controller, o.controller, cx)) return false;
  if (owner !== undefined && !playerMatches(s, owner, o.owner, cx)) return false;
  if (stackKind !== undefined && !stackKindMatches(o, stackKind)) return false;
  if (castFrom !== undefined && o.stack?.castFrom !== castFrom) return false;
  // WP31, CR 603.10a: an object that has left (a look-back trigger: "whenever a creature with power 5 or greater dies") is judged as it last existed, with the
  // characteristics recorded as it left (LastKnown.chars: every layer applied then, an anthem included), not recomputed in the current state.
  const lk = s.objects[o.id] === o ? undefined : s.lki[o.id];
  const chars = lk !== undefined && lk.object === o && lk.chars ? lk.chars : undefined;
  return matchesFilter(s, o, rest, { ...filterCtxOutside(s, { controller: cx.controller, sourceId: cx.source, ...(cx.event !== undefined ? { event: cx.event } : {}) }), ...(chars ? { chars } : {}) });
}
