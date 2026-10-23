/**
 * Layer-2 control on the stored controller (MX2; CR 108.4, 613.1b, 302.6, 506.4, 701.12b). Owner: MX2.
 *
 * Until MX2 the layers computed the controller after control-changing effects (`rules/characteristics.ts#controllerOf`) but the milestone 3/4 call-sites
 * (attackers and blockers, activations, the untap step, the legend rule, filters, ...) read the stored `GameObject.controller`, so a layer-2 effect was
 * fail-closed (`feature:control.layered`, never advertised). MX2 keeps ONE invariant instead of switching every call-site: on the battlefield and the stack,
 * `GameObject.controller` IS the controller after layer 2. The layers start from the controller before any control-changing effect (`baseController`, present
 * only while it differs; statics/layers.ts), and `syncControl` writes their answer back:
 *
 *   - after every performed event and first in each state-based action check (`CONTROL_IMMEDIATE_CHECKS`, effects/registries.ts#IMMEDIATE_CHECKS), when a
 *     resolved effect is created (the `effect` and `exchange` handlers) and when effects end (core/durations.ts#expire);
 *   - a permanent whose controller changes is removed from combat (CR 506.4) and has been under its new controller's control only since now (CR 302.6:
 *     `controlledSinceTurn`); a `controlChanged` event is emitted;
 *   - a phased-out permanent is left as it is: it is treated as though it doesn't exist (CR 702.26b) and phases in under the player who controlled it when it
 *     phased out (CR 702.26c, rules/phasing.ts reads the stored controller);
 *   - the check costs nothing in a game where nothing can change control: it runs only while some resolved effect, permanent, spell or emblem definition holds
 *     a layer-2 modification, or some object still has a `baseController` to return to (a scan memoized per definition and per effect).
 *
 *   CONTROL_FEATURES   `feature:control.layered` (model/capabilities.ts): a layer-2 modification (model/cap-walk.ts) runs now.
 *   OP_FORMS           `op:exchange.control` (CR 701.12a-b): the `exchange` handler (effects/handlers/zones-status.ts) creates two layer-2 effects.
 */
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import { allChars } from '../rules/characteristics';
import { isAttacking, isBlocking, removeFromCombat } from '../rules/combat-state';
import { layerSourcesPresent } from '../statics/live';
import type { Game } from './game';
import { ringControlChanged } from './ring-state';
import { moveObject } from './zones';

export const CONTROL_FEATURES: readonly string[] = ['control.layered'];
export const OP_FORMS: readonly string[] = ['op:exchange.control'];

// ---- can anything change control in this state? ----------------------------------------------------------------------------------------------------------

const HAS_LAYER2 = new WeakMap<object, boolean>();

/** Does this JSON (a card definition, a stored effect) hold a layer-2 modification anywhere, granted and quoted abilities included? Memoized per object. */
function holdsLayer2(x: unknown): boolean {
  if (x === null || typeof x !== 'object') return false;
  const hit = HAS_LAYER2.get(x);
  if (hit !== undefined) return hit;
  let found = false;
  const walk = (v: unknown): void => {
    if (found || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const e of v) walk(e);
      return;
    }
    const r = v as Record<string, unknown>;
    if (r['layer'] === 2 && r['controller'] !== undefined) {
      found = true;
      return;
    }
    for (const k in r) walk(r[k]);
  };
  walk(x);
  HAS_LAYER2.set(x, found);
  return found;
}

const SYNC_ZONES = ['battlefield', 'stack', 'command'] as const;

/** Could the controller after layer 2 differ from the stored one for some object of this state? (Cheap; false in almost every game.) */
function controlMayChange(s: GameState): boolean {
  for (const e of s.continuousEffects) {
    if (holdsLayer2(e.effect)) return true;
    const copied = e.copy ? s.defs[e.copy.defId] : undefined;
    if (copied && holdsLayer2(copied)) return true;
  }
  for (const zone of SYNC_ZONES) {
    for (const id of s.zones[zone]) {
      const o = s.objects[id];
      if (!o) continue;
      if (o.baseController !== undefined) return true;
      const def = s.defs[o.defId];
      if (def && holdsLayer2(def)) return true;
      for (const c of o.components ?? []) {
        const cd = s.defs[c.defId];
        if (cd && holdsLayer2(cd)) return true;
      }
    }
  }
  return false;
}

// ---- the sync ------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Write the controller after layer 2 (CR 613.1b) into every permanent and spell whose stored controller differs (see the file header). Deterministic: zone
 * order, then position in the zone. Idempotent.
 */
export function syncControl(g: Game): void {
  const s = g.s;
  if (!controlMayChange(s)) return;
  const layered = layerSourcesPresent(s) ? allChars(s) : null;
  const changes: { id: ObjectId; from: PlayerId; to: PlayerId; base: PlayerId }[] = [];
  for (const zone of ['battlefield', 'stack'] as const) {
    for (const id of s.zones[zone]) {
      const o = s.objects[id];
      if (!o || o.kind === 'ability' || o.kind === 'emblem' || o.phasedOut) continue; // CR 702.26b: a phased-out permanent keeps its controller
      const base = o.baseController ?? o.controller;
      const now = layered?.get(id)?.controller ?? base;
      if (now !== o.controller) changes.push({ id, from: o.controller, to: now, base });
      else if (o.baseController !== undefined && o.baseController === now) delete o.baseController;
    }
  }
  const exiled: ObjectId[] = [];
  for (const c of changes) {
    if (s.options.multiplayer !== undefined && s.players.find((p) => p.id === c.to)?.hasLost === true) {
      // M12-2 (m12 design E26): CR 800.4c, the effect that gave a player still in the game control of it ended, no other effect gives it to a player in the
      // game, and the player who controls it by default has left the game: it is exiled (statics/mods.ts never gives control to a leaver, CR 800.4b)
      exiled.push(c.id);
      continue;
    }
    const o = s.objects[c.id]!;
    o.controller = c.to;
    if (c.to === c.base) delete o.baseController;
    else o.baseController = c.base;
    // std-rx22 (CR 702.62a: "until you lose control of the spell or the permanent it becomes"): the record that it changed controllers (Condition `wasCast.kept`)
    if (o.zone === 'stack' && o.stack?.kind === 'spell') o.stack.controlLost = true;
    if (o.zone === 'battlefield' && o.cast !== undefined) o.cast = { ...o.cast, controlLost: true };
    if (o.zone === 'battlefield') {
      o.controlledSinceTurn = s.turn.number; // CR 302.6: under its new controller's control only since now
      ringControlChanged(s, c.id, c.to); // MX3, CR 701.54a: another player gained control of a Ring-bearer
      if (isAttacking(s, c.id) || isBlocking(s, c.id) || (s.combat?.attackers.some((a) => a.defender === c.id) ?? false)) {
        removeFromCombat(s, c.id); // CR 506.4: its controller changes
        g.log(`${g.nameOf(c.id)} is removed from combat: its controller changed.`, { rules: ['CR 506.4'], level: 'info' });
      }
    }
    g.emit({ type: 'controlChanged', objectId: c.id, from: c.from, to: c.to });
    g.log(`${g.player(c.to).name} now controls ${g.nameOf(c.id)}.`, { rules: ['CR 108.4', 'CR 613.1b'], level: 'action' });
  }
  for (const id of exiled) {
    const name = g.nameOf(id);
    if (moveObject(g, id, 'exile', { cause: 'leftGame' }) !== null) g.log(`${name} is exiled: the player who would control it has left the game.`, { rules: ['CR 800.4c'], level: 'action' });
  }
}

/** effects/registries.ts#IMMEDIATE_CHECKS: after every performed event and first in each state-based action check. */
export const CONTROL_IMMEDIATE_CHECKS: readonly ((g: Game) => void)[] = [syncControl];
