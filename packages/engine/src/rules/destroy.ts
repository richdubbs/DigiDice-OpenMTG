/**
 * Destroying permanents (CR 701.8) and regeneration shields (CR 701.19). Destruction comes only from effects that say "destroy" and from the
 * state-based actions for lethal damage and deathtouch (CR 701.8b); putting a permanent into a graveyard any other way (sacrifice, toughness 0,
 * legend rule) is not destruction, so neither indestructible nor regeneration applies to it.
 *
 * Transition T1 (design 4.5, WP11): a regeneration shield is a typed `ContinuousEffectRec` holding a shielded replacement effect (CR 614.8, 701.19a):
 * `{s:'replace', replaces:{ev:'action', verb:'destroy', object:{is:{ref:'fixed', objects:[handle]}}}, body:{b:'regeneration'}, shield:{uses:1}}` with the
 * duration `{d:'endOfTurn'}`. `destroy()` keeps owning indestructible and regeneration (design 8.5): the same code serves destruction by an effect (through the
 * proposal pipeline, effects/propose.ts) and by a state-based action.
 */
import type { ObjectFilter, ReplacementDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import { type ContinuousEffectRec, type GameState } from '../types/state';
import { EngineBug, type Game } from '../core/game';
import { moveObject } from '../core/zones';
import { charsOfObject, controllerOf, hasKeyword } from './characteristics';
import { removeFromCombat } from './combat-state';
import { matchesFilter } from './filter';
import { filterCtxOutside } from './filter-env';
import { cantDo } from './cant';

/** The replacement body of a regeneration shield (capability `body:regeneration`). Milestone 4's legacy `effect.kind` record is gone (T1). */
export const REGENERATION_SHIELD = 'regeneration';

/** "Regenerate [permanent]" as the effect of a resolving spell or ability: create a shield that lasts until end of turn (CR 701.19a, 701.19c). */
export function addRegenerationShield(g: Game, id: ObjectId, sourceId?: ObjectId): void {
  const o = g.obj(id);
  const src = sourceId ? g.maybeObj(sourceId) ?? g.s.lki[sourceId]?.object : undefined;
  const rec: ContinuousEffectRec = {
    id: g.newEffectId(),
    source: src ? { id: src.id, zone: src.zone } : null,
    sourceName: g.nameOf(src ? src.id : id),
    controller: src?.controller ?? o.controller,
    timestamp: g.newTimestamp(),
    startedTurn: g.s.turn.number,
    duration: { d: 'endOfTurn' },
    effect: {
      s: 'replace',
      replaces: { ev: 'action', verb: 'destroy', object: { is: { ref: 'fixed', objects: [{ id, zone: o.zone }] } } },
      body: { b: 'regeneration' },
      shield: { uses: 1 },
    },
    usesLeft: 1,
  };
  g.s.continuousEffects.push(rec);
  g.log(`${g.nameOf(id)} gets a regeneration shield until end of turn.`, { rules: ['CR 701.19a'], level: 'info' });
}


/** Is the shield still in force? `whileSource` durations end with the source (CR 611.2b); the others are removed by the turn structure (CR 514.2). */
function shieldAlive(s: GameState, rec: ContinuousEffectRec): boolean {
  if (rec.duration.d !== 'whileSource') return true;
  const src = rec.source ? s.objects[rec.source.id] : undefined;
  return src !== undefined && src.zone === rec.source!.zone;
}

/** Does this shield's "would be destroyed" pattern cover the permanent? Every field is evaluated or the shield does not apply (design 3.3: never approximately). */
function shieldCovers(s: GameState, rec: ContinuousEffectRec, def: ReplacementDef, id: ObjectId): boolean {
  const p = def.replaces;
  if (p.ev !== 'action' || p.verb !== 'destroy' || p.actor !== undefined) return false;
  const o = s.objects[id];
  if (!o) return false;
  const f: ObjectFilter = p.object ?? {};
  // A shield made by a resolved effect holds a `{ref:'fixed'}` set (CR 611.2c); references are read through WP30's environment outside a resolution.
  return matchesFilter(s, o, f, filterCtxOutside(s, { controller: rec.controller, ...(rec.source ? { sourceId: rec.source.id } : {}) }));
}

/** Index in `continuousEffects` of the first (oldest) regeneration shield that covers the permanent, or -1 (CR 701.19a; using any one of several has the same result). */
export function regenerationShieldIndex(s: GameState, id: ObjectId): number {
  return s.continuousEffects.findIndex((e) => {
    if (e.effect.s !== 'replace') return false;
    const def = e.effect;
    return def.body.b === 'regeneration' && def.shield !== undefined && def.condition === undefined && shieldAlive(s, e) && shieldCovers(s, e, def, id);
  });
}

/** Use up one use of a shield (CR 614.8, 615.8: "the next time"); a shield whose uses are spent is gone. */
function spendShield(g: Game, index: number): void {
  const rec = g.s.continuousEffects[index];
  if (!rec || rec.effect.s !== 'replace' || !rec.effect.shield) return;
  const uses = rec.effect.shield.uses;
  if (uses === 'all') return;
  const left = (rec.usesLeft ?? uses) - 1;
  if (left <= 0) g.s.continuousEffects.splice(index, 1);
  else rec.usesLeft = left;
}

/** CR 701.19a: "Regenerate": remove all damage marked on it, tap it, remove it from combat. */
export function regenerate(g: Game, id: ObjectId, reason?: string, rules: string[] = [], by?: PlayerId): void {
  const o = g.obj(id);
  o.damage = 0; // CR 120.6, 701.19a: all damage marked on it is removed
  o.deathtouchDamaged = false;
  if (!o.tapped) {
    o.tapped = true;
    g.emit({ type: 'tapped', objectId: id });
    // FAST5X E20 (CR 701.19a, 701.26a): `by` is the player who taps it, the regenerated permanent's controller ("its controller taps it")
    if (by !== undefined) g.emit({ type: 'actionPerformed', verb: 'tap', actor: by, objectId: id, zone: 'battlefield' });
  }
  removeFromCombat(g.s, id);
  g.log(`${g.nameOf(id)} regenerates${reason ? ` instead of being destroyed (${reason})` : ''}: damage is removed, it becomes tapped and is removed from combat.`, { rules: [...rules, 'CR 701.19a', 'CR 701.8c', 'CR 506.4'], level: 'action' });
}

export interface DestroyOptions {
  /** "It can't be regenerated" (CR 701.19c): shields are not applied. */
  cantRegenerate?: boolean;
  /** Why it is destroyed, for the log ("lethal damage"), and the rules that say so. */
  reason?: string;
  rules?: string[];
  /** The destruction has been through the proposal pipeline already (WP11 interface change, see `installDestroyFunnel`). */
  proposed?: boolean;
  /** FAST5X E28 INTERFACE CHANGE (additive): a state-based action destroys it (CR 704.5g-h), not an effect (CR 122.1c: shield counters don't apply). */
  stateBased?: boolean;
}

/** What happened to a permanent that was to be destroyed. */
export type DestroyResult = 'destroyed' | 'regenerated' | 'indestructible' | 'none';

/**
 * WP11 INTERFACE CHANGE (design 8.5): every destruction, by an effect or by a state-based action, is proposed to the pipeline (effects/propose.ts) first, so a
 * "can't be destroyed" restriction (CR 614.17) is honored however it comes. effects/funnels.ts installs the funnel; it calls back with `proposed: true`.
 * A destruction with no funnel installed is an EngineBug.
 */
export type DestroyFunnel = (g: Game, id: ObjectId, opts: DestroyOptions) => DestroyResult;
let destroyFunnel: DestroyFunnel | null = null;
export function installDestroyFunnel(f: DestroyFunnel | null): void {
  destroyFunnel = f;
}

/**
 * Destroy a permanent: it is put into its owner's graveyard (CR 701.8a) unless it is indestructible (CR 702.12b) or a regeneration shield
 * replaces the destruction (CR 701.19a: remove all damage, tap it, remove it from combat).
 */
export function destroy(g: Game, id: ObjectId, opts: DestroyOptions = {}): DestroyResult {
  const o = g.maybeObj(id);
  if (!o || o.zone !== 'battlefield') return 'none';
  if (!opts.proposed) {
    if (!destroyFunnel) throw new EngineBug('destroy: the destroy funnel is not installed (effects/funnels.ts was not loaded)');
    return destroyFunnel(g, id, opts);
  }
  const name = g.nameOf(id);
  if (hasKeyword(charsOfObject(g.s, o), 'indestructible')) {
    g.log(`${name} is indestructible and is not destroyed.`, { rules: ['CR 702.12b'], level: 'info' });
    return 'indestructible';
  }
  // WP31: "can't be regenerated" (CR 701.19c) is read here, so every destruction honors it (an effect's `destroy` proposal as well as the funnel's).
  const i = opts.cantRegenerate || cantDo(g.s, 'beRegenerated', id) ? -1 : regenerationShieldIndex(g.s, id);
  if (i >= 0) {
    spendShield(g, i); // the shield is used up
    // CR 701.19a: "its controller taps it": the regenerated permanent's own controller taps it, not the shield's controller, so a shield on an
    // opponent's creature is never "you tap an untapped creature an opponent controls" (CR 701.26a)
    regenerate(g, id, opts.reason, opts.rules, controllerOf(g.s, id));
    return 'regenerated';
  }
  moveObject(g, id, 'graveyard', { cause: 'destroy' }); // CR 701.8a
  // WP11 review: the move goes through the proposal pipeline, which may drop it (a "can't" effect, CR 614.17, 614.6). A permanent still on the battlefield
  // was not destroyed; one that went elsewhere instead (exile, CR 614.1a) was.
  if (g.s.objects[id]?.zone === 'battlefield') return 'none';
  g.log(`${name} is destroyed${opts.reason ? ` (${opts.reason})` : ''}.`, { rules: [...(opts.rules ?? []), 'CR 701.8a'], level: 'action' });
  return 'destroyed';
}
