/**
 * M12-2 (docs/design/m12-multiplayer.md D8, D9, D12, 4.2, 4.4): leaving a multiplayer game (CR 104.5, 800.4a-e).
 *
 * A player who loses a multiplayer game that goes on leaves it at once (CR 104.5; 800.4a: "This is not a state-based action"). `markLost` (core/sba.ts)
 * notes each loser here; `checkGameOver` runs the procedure ONCE for the whole set of players who lost together (one state-based action check, one effect,
 * one concession, the opponents of a player who wins: CR 104.4a), and only when the game goes on (CR 104.2a: when one player is left the game is over and
 * nothing leaves; a two-player game never gets here, m12 design D16). The order of CR 800.4a:
 *
 *   0. priority (D12, CR 117.4, 800.4a): a leaver's pass no longer counts; a leaver who had priority passes it to the next player still in the game;
 *   1. every object the leavers own leaves the game, in every zone: removed from the state with its last known information (CR 603.10, 608.2h; hidden zones
 *      keep none, nobody may learn those cards, CR 400.2); a phased-in permanent among them triggers leaves-the-battlefield abilities (CR 603.6c,
 *      triggers/normalize.ts maps the `playerLeft` event), never "dies"; their face-down permanents and spells are revealed to everyone (CR 708.9);
 *   2. the effects that give a leaver control of an object end (resolved layer-2 effects whose new controller is a leaver; statics/mods.ts ignores a
 *      layer-2 controller who has left, CR 800.4b), and control is written back (core/control.ts#syncControl, which exiles an object whose default
 *      controller has left, CR 800.4c);
 *   3. the objects on the stack they control that are not cards (abilities, copies of spells) cease to exist;
 *   4. everything they still control is exiled (ordinary moves, cause 'leftGame');
 *   5. attackers attacking a leaver attack nothing (CR 800.4e, as CR 506.4c);
 *   then `PlayerState.left` (one shared `order` per set, D10) and one `playerLeft` event per leaver, with a public log line.
 *
 * What happens later because a player left lives with the code it changes: a resolution whose controller left stops (effects/run.ts), the turn of a left
 * active player goes on without them (CR 800.4j: core/turn.ts, core/steps.ts), "until your next turn" effects and goad end when that turn would have begun
 * (CR 800.4m: core/durations.ts), decisions a leaver would make (CR 800.4f-h: core/game.ts#choose), objects a leaver would get (CR 800.4b, 800.4d:
 * core/zones.ts), the monarch and the initiative (CR 725.4, 726.4: core/designations.ts).
 */
import { clone } from '../util/clone';
import type { ContinuousEffectRec, GameObject, LastKnown, ZoneKind } from '../types/state';
import type { ObjectId, PlayerId } from '../types/ids';
import type { PlayerRef } from '../types/ability';
import { charsOfObject } from '../rules/characteristics';
import { attackerState, isAttacking, isBlocking, removeFromCombat } from '../rules/combat-state';
import type { Game } from './game';
import { moveObject, zoneArray } from './zones';
import { syncControl } from './control';

/** A player who lost and has not left yet: their loss as `markLost` logged it (CR 104.3, 104.5). */
export interface Loser {
  player: PlayerId;
  reason: string;
  rules: string[];
}

/** The players marked lost during this run whose leave procedure has not run yet. Transient (per run, like `Game.events`): never in the state. */
const PENDING = new WeakMap<Game, Loser[]>();

/** core/sba.ts#markLost: a player lost (only noted in a multiplayer game, where losing means leaving, CR 104.5, 800.4a). */
export function noteLoser(g: Game, loser: Loser): void {
  if (g.s.options.multiplayer === undefined) return;
  const list = PENDING.get(g) ?? [];
  list.push(loser);
  PENDING.set(g, list);
}

/**
 * core/sba.ts#checkGameOver: the players noted since the last call leave the game together, unless the game is over (CR 104.2a, 104.4a: then nobody leaves,
 * and the end screen shows their board as it was, m12 design D8).
 */
export function leavePending(g: Game): void {
  const set = PENDING.get(g);
  if (set === undefined || set.length === 0) return;
  PENDING.delete(g);
  if (g.s.result) return;
  leaveGame(g, set);
}

/** The zones in the order the procedure walks them (deterministic): the public zones, then each player's graveyard, hand and library. */
const SHARED_ZONES = ['battlefield', 'stack', 'exile', 'command'] as const;
const HIDDEN: ReadonlySet<ZoneKind> = new Set<ZoneKind>(['library', 'hand']);

/** CR 800.4a: the leave procedure for a set of players who lost at the same time (see the file comment). */
export function leaveGame(g: Game, losers: readonly Loser[]): void {
  const s = g.s;
  const leaving = new Set(losers.map((l) => l.player));
  const order = 1 + Math.max(0, ...s.players.map((p) => p.left?.order ?? 0));
  const turn = s.turn.number;

  passPriorityOfLeavers(g, leaving); // 0

  // 1. Objects they own leave the game. Last known information first, for all of them at once (they leave simultaneously, CR 603.10a).
  const owned: { id: ObjectId; zone: ZoneKind }[] = [];
  for (const z of SHARED_ZONES) for (const id of s.zones[z]) if (leaving.has(s.objects[id]?.owner ?? '')) owned.push({ id, zone: z });
  for (const p of s.players) {
    for (const z of ['graveyard', 'hand', 'library'] as const) {
      if (!leaving.has(p.id)) continue;
      for (const id of zoneArray(g, z, p.id)) if (s.objects[id]) owned.push({ id, zone: z });
    }
  }
  const revealed = new Map<PlayerId, { id: ObjectId; name: string }[]>();
  for (const { id, zone } of owned) {
    const o = s.objects[id]!;
    if (o.faceDown && (zone === 'battlefield' || zone === 'stack')) {
      // CR 708.9: "If a player leaves the game, all face-down permanents, face-down components of merged permanents, and face-down spells owned by that
      // player must be revealed to all players."
      const list = revealed.get(o.owner) ?? [];
      list.push({ id, name: realName(g, o) });
      revealed.set(o.owner, list);
    }
  }
  const lki = new Map<ObjectId, LastKnown>();
  for (const { id, zone } of owned) if (!HIDDEN.has(zone)) lki.set(id, lastKnown(g, s.objects[id]!, zone));
  const removed = new Map<PlayerId, ObjectId[]>();
  for (const { id, zone } of owned) {
    const o = s.objects[id]!;
    const l = lki.get(id);
    if (l) s.lki[id] = l;
    removeObject(g, o, zone);
    if (!HIDDEN.has(zone)) removed.set(o.owner, [...(removed.get(o.owner) ?? []), id]); // CR 400.2: hidden cards are not named to anyone
  }

  // 2. Effects that give a leaver control of objects end (CR 800.4a), then control is written back (CR 613.1b; 800.4c in syncControl).
  const kept = s.continuousEffects.filter((e) => !givesControlTo(e, leaving));
  if (kept.length !== s.continuousEffects.length) {
    s.continuousEffects = kept;
    g.log('The effects that gave a player who left the game control of objects end.', { rules: ['CR 800.4a'], level: 'info' });
  }
  syncControl(g);

  // 3. Their objects on the stack that are not cards cease to exist (an ability, a copy of a spell, CR 707.10, 113.7a).
  for (const id of [...s.zones.stack]) {
    const o = s.objects[id];
    if (!o || !leaving.has(o.controller) || (o.kind !== 'ability' && o.stack?.isCopy !== true)) continue;
    s.lki[id] = lastKnown(g, o, 'stack');
    removeObject(g, o, 'stack');
    removed.set(o.controller, [...(removed.get(o.controller) ?? []), id]);
  }

  // 4. What they still control is exiled.
  const exiled = new Map<PlayerId, ObjectId[]>();
  for (const z of ['battlefield', 'stack'] as const) {
    for (const id of [...s.zones[z]]) {
      const o = s.objects[id];
      if (!o || !leaving.has(o.controller)) continue;
      const by = o.controller;
      const now = moveObject(g, id, 'exile', { cause: 'leftGame' });
      if (now !== null) exiled.set(by, [...(exiled.get(by) ?? []), now]);
      else if (s.objects[id]) g.log(`${g.nameOf(id)} would be exiled as ${g.player(by).name} leaves the game, but it stays where it is.`, { rules: ['CR 800.4a', 'CR 614.17'], level: 'warning' });
    }
  }

  // 5. CR 800.4e: combat damage isn't assigned to a player who left: what attacked them attacks nothing (as CR 506.4c).
  for (const a of s.combat?.attackers ?? []) if (leaving.has(a.defendingPlayer) && a.defender !== null) a.defender = null;

  for (const l of losers) {
    const p = g.player(l.player);
    p.left = { turn, order, reason: l.reason, rules: [...l.rules] };
    const shown = revealed.get(l.player) ?? [];
    const gone = removed.get(l.player) ?? [];
    const out = exiled.get(l.player) ?? [];
    if (shown.length > 0) g.log(`${p.name}'s face-down cards are revealed as they leave the game: ${shown.map((x) => x.name).join(', ')}.`, { rules: ['CR 708.9'], level: 'info' });
    g.log(`${p.name} leaves the game: the cards and objects they own leave with them${out.length > 0 ? `; ${out.length} object${out.length === 1 ? '' : 's'} they controlled ${out.length === 1 ? 'is' : 'are'} exiled` : ''}.`, { rules: ['CR 104.5', 'CR 800.4a'], level: 'action' });
    g.emit({ type: 'playerLeft', player: l.player, reason: l.reason, removed: gone, exiled: out, revealed: shown });
  }
}

/** The name of a face-down object's card (CR 708.9: revealed as its owner leaves). */
function realName(g: Game, o: GameObject): string {
  const def = g.s.defs[o.defId];
  return def?.faces[o.face]?.name ?? def?.name ?? o.id;
}

/** Last known information of an object as it leaves the game (CR 603.10, 608.2h), as `moveObject` records it. */
function lastKnown(g: Game, o: GameObject, zone: ZoneKind): LastKnown {
  const l: LastKnown = { object: clone(o), chars: o.kind === 'ability' ? null : charsOfObject(g.s, o), leftZone: zone };
  if (zone === 'battlefield' && (isAttacking(g.s, o.id) || isBlocking(g.s, o.id))) {
    const att = attackerState(g.s, o.id);
    l.combat = { attacking: att !== undefined, blocking: isBlocking(g.s, o.id), ...(att ? { defender: att.defender, defendingPlayer: att.defendingPlayer } : {}) };
  }
  return l;
}

/** Remove an object from its zone and from the game (it goes nowhere: CR 800.4a "leave the game"). */
function removeObject(g: Game, o: GameObject, zone: ZoneKind): void {
  if (zone === 'battlefield') removeFromCombat(g.s, o.id); // CR 506.4
  const arr = zoneArray(g, zone, o.owner);
  const i = arr.indexOf(o.id);
  if (i >= 0) arr.splice(i, 1);
  delete g.s.objects[o.id];
}

/** Does this resolved effect give one of these players control of something (a layer-2 modification naming them, CR 613.1b)? */
function givesControlTo(e: ContinuousEffectRec, leaving: ReadonlySet<PlayerId>): boolean {
  if (e.effect.s !== 'continuous') return false;
  return e.effect.mods.some((m) => m.layer === 2 && playersOfRef(m.controller, e.controller).some((p) => leaving.has(p)));
}

/** The players a stored layer-2 controller stands for: fixed when the effect was created (CR 611.2c), or the effect's controller ("you"). */
function playersOfRef(ref: PlayerRef, controller: PlayerId): PlayerId[] {
  if (ref.ref === 'fixed') return ref.players;
  return [controller];
}

/**
 * D12 (CR 117.4, 800.4a): the players who passed in succession are the `passes` players still in the game just before the priority holder in turn order.
 * A leaver among them no longer counts; a leaver who holds priority passes it to the next player in turn order still in the game. Whether everyone left has
 * now passed is judged when that player would receive priority (core/turn.ts#advance).
 */
function passPriorityOfLeavers(g: Game, leaving: ReadonlySet<PlayerId>): void {
  const pr = g.s.priority;
  if (pr.player === null) return;
  const before = g.s.players.filter((p) => !p.hasLost || leaving.has(p.id)).map((p) => p.id); // in the game until now, in turn order
  const at = before.indexOf(pr.player);
  if (at < 0) return;
  let passed = 0;
  for (let k = 1; k <= Math.min(pr.passes, before.length - 1); k++) {
    const p = before[(at - k + before.length) % before.length]!;
    if (!leaving.has(p)) passed++;
  }
  pr.passes = passed;
  if (leaving.has(pr.player)) {
    let next: PlayerId | null = null;
    for (let k = 1; k < before.length && next === null; k++) {
      const p = before[(at + k) % before.length]!;
      if (!leaving.has(p)) next = p;
    }
    pr.player = next;
    if (next !== null) g.log(`Priority passes to ${g.player(next).name}: the player who had it left the game.`, { rules: ['CR 800.4a'], level: 'info' });
  }
}
