/**
 * The performers of the milestone 5 proposal kinds (design 8.5), moved unchanged out of effects/perform.ts by M6-0 (m6 design 2.6, E17) so that the entries of
 * `PROPOSAL_KINDS` (effects/proposal-kinds/m5.ts) can call them without an import cycle through effects/registries.ts: effects/perform.ts dispatches through
 * the registry, and the registry's entries call these. Like effects/perform.ts and effects/perform-direct.ts this is a performer module: the only kind of
 * interpreter module that calls the milestone 3/4 primitives (`moveObject`, `dealDamage`, `gainLife`/`loseLife`, `drawCard`, `addCounters`, `destroy`,
 * `createToken`), which stay the single implementation of each rule (the lint of test/m5/propose/lint.test.ts lists it).
 *
 * Also here, for the same reason (effects/bodies/m5.ts calls them): the payment of a cost "you may pay" as a permanent enters (`performPayment`, CR 614.12a)
 * and what is left of a shield (`setShieldLeft`, CR 615.7-615.8). effects/perform.ts re-exports every name, so callers are unchanged.
 */
import type { Game } from '../core/game';
import { EngineBug } from '../core/game';
import { createToken, drawCard, moveObject, shuffleLibrary, type MoveOptions, type PutEnteringCounters } from '../core/zones';
import type { ObjectId, PlayerId } from '../types/ids';
import type { PayCostDecision } from '../types/decisions';
import { type ContinuousEffectRec, type GameObject, type ObjHandle } from '../types/state';
import type { LinkId } from '../types/ability';
import type { CostPlan } from '../rules/cost';
import { addCounters } from '../rules/counters';
import { becomePrepared } from '../core/prepare';
import { enterAttackingChoosing } from '../rules/status';
import { dealDamage, type DamageOptions } from '../rules/damage';
import { destroy, type DestroyOptions, type DestroyResult } from '../rules/destroy';
import { changeLife, gainLife, givePoison, loseLife } from '../rules/life';
import { payPlan } from '../rules/pay';
import { readLink, setLink } from '../statics/links';
import type { DestinationFacts, Proposed } from './api';
import { CHAIN_OF, inBranch, proposeNested } from './nested';
import { transformedEntry } from './enters-parts/transformed';

/**
 * Steps 1-4 of the pipeline (effects/propose.ts#runPipeline), installed by effects/funnels.ts: each token created enters through it (CR 616.1g). This module
 * can't import propose.ts (propose.ts imports the performers), hence the hook, as for the funnels of the primitives.
 */
type EntryPipeline = (g: Game, e: Proposed) => Proposed | null;
let entryPipeline: EntryPipeline | null = null;
export function installEntryPipeline(f: EntryPipeline | null): void {
  entryPipeline = f;
}

/** What a performed event did. */
export interface Performed {
  /** The final form of the event (after replacement and prevention). */
  event: Proposed;
  /** New objects: the object after a zone change (CR 400.7), the tokens created (CR 111.1). */
  newIds: ObjectId[];
  /** Damage dealt, life gained or lost, cards drawn, counters that changed: the amount that actually happened ("that much", CR 603.2, 120.3). */
  amount: number;
  /** What became of a destruction (rules/destroy.ts). */
  destroyed?: DestroyResult;
}

/** Options of the milestone 3/4 call-site the event came through (a funnel), passed on to the primitive. */
export interface CallerOptions {
  damage?: DamageOptions;
  destroy?: DestroyOptions;
}

type Ev<K extends Proposed['ev']> = Extract<Proposed, { ev: K }>;

const isLive = (g: Game, id: ObjectId, zone: string): GameObject | undefined => {
  const o = g.s.objects[id];
  return o && o.zone === zone ? o : undefined;
};

const done = (e: Proposed, newIds: ObjectId[], amount: number, extra: Partial<Performed> = {}): Performed => ({ event: e, newIds, amount, ...extra });

// ---- the milestone 5 kinds (each one the former case of effects/perform.ts#performEvent) -------------------------------------------------------------

/**
 * Cloud r5-repl (CR 614.1a): "instead that damage is dealt, but all other damage already dealt to him is healed" (effects/bodies/heal.ts): the damage marked on
 * the permanent is removed as this damage is dealt to it, so only this damage is marked afterwards (CR 120.3e, 120.6, 704.5g). Wave 8 review: for the parts
 * of one simultaneous event (CR 510.2: a combat damage step) effects/funnels.ts#proposeSimultaneous heals each permanent once before any part is dealt and
 * clears the mark, so the damage the other parts deal to it at the same time is not healed (a double block).
 */
export function healMarkedDamage(g: Game, e: Ev<'damage'>): void {
  if (e.healFirst !== true || typeof e.to === 'string' || e.amount <= 0) return;
  const to = isLive(g, e.to.id, e.to.zone)?.id;
  if (to === undefined || g.obj(to).damage <= 0) return;
  g.log(`All other damage dealt to ${g.nameOf(to)} is healed.`, { rules: ['CR 614.1a'], level: 'info' });
  g.obj(to).damage = 0;
}

/** std-rx24 (CR 120.6, 702.89a): umbra armor removes all damage marked on the permanent (and the deathtouch mark of that damage, CR 704.5h). */
export function performRemoveAllDamage(g: Game, id: ObjectId): void {
  const o = g.s.objects[id];
  if (!o || o.zone !== 'battlefield') return;
  o.damage = 0;
  o.deathtouchDamaged = false;
}

export function performDamageEvent(g: Game, e: Ev<'damage'>, caller: CallerOptions = {}): Performed {
  const to = typeof e.to === 'string' ? e.to : isLive(g, e.to.id, e.to.zone)?.id;
  if (to === undefined) return done(e, [], 0);
  healMarkedDamage(g, e);
  const dealt = dealDamage(g, e.source.id, to, e.amount, { ...caller.damage, ...(e.lifelink ? { lifelink: e.lifelink } : {}), combat: e.combat, unpreventable: e.unpreventable, proposed: true }); // CR 120.3; one step's damage shares a lifelink ledger (CR 702.15e, WP12)
  return done(e, [], dealt);
}

export function performLifeEvent(g: Game, e: Ev<'life'>): Performed {
  const cause = e.cause ?? 'an effect';
  const n = e.change === 'gain' ? gainLife(g, e.player, e.amount, cause) : loseLife(g, e.player, e.amount, cause); // CR 119.3
  return done(e, [], n);
}

/** std-library-4 (CR 119.4): a payment of life no replacement replaced: the life total changes by the amount paid (proposed by rules/life.ts#payLife). */
export function performPayLifeEvent(g: Game, e: Ev<'payLife'>): Performed {
  changeLife(g, e.player, -e.amount, e.cause ?? 'paid', e.rules ?? ['CR 119.4']);
  return done(e, [], e.amount);
}

export function performDrawEvent(g: Game, e: Ev<'draw'>): Performed {
  const mark = g.events.length;
  const id = drawCard(g, e.player); // CR 121.2: one card at a time
  if (id) g.log(`${g.player(e.player).name} draws a card.`, { rules: ['CR 121.1'], privateText: { players: [e.player], text: `${g.player(e.player).name} draws ${g.nameOf(id)}.` } });
  // CMDF (CR 121.1, 903.9b): a commander drawn and put into the command zone instead was drawn too (core/zones.ts#drawCard emits `drew` for it)
  const drew = g.events.slice(mark).find((x) => x.type === 'drew' && x.player === e.player);
  const drawn = drew?.type === 'drew' ? drew.objectId : id;
  return done(e, drawn ? [drawn] : [], drawn ? 1 : 0);
}

export function performZoneChangeEvent(g: Game, e: Ev<'zoneChange'>): Performed {
  const newId = performZoneChange(g, e);
  return done(e, newId ? [newId] : [], newId ? 1 : 0);
}

export function performCreateTokenEvent(g: Game, e: Ev<'createToken'>): Performed {
  const ids = performCreateToken(g, e);
  return done(e, ids, ids.length);
}

export function performCountersEvent(g: Game, e: Ev<'counters'>): Performed {
  return done(e, [], performCounters(g, e));
}

export function performDestroyEvent(g: Game, e: Ev<'destroy'>, caller: CallerOptions = {}): Performed {
  if (!isLive(g, e.object.id, e.object.zone)) return done(e, [], 0, { destroyed: 'none' });
  const r = destroy(g, e.object.id, { ...caller.destroy, cantRegenerate: !e.canRegenerate || caller.destroy?.cantRegenerate === true, proposed: true }); // CR 701.8, 701.19
  return done(e, [], r === 'destroyed' ? 1 : 0, { destroyed: r });
}

/** The turn structure performs the step itself; proposing it only lets "skip" effects act (milestone 6). The same for phases and turns (M6-0 stubs). */
export function performNothing(_g: Game, e: Proposed): Performed {
  return done(e, [], 0);
}

// ---- zone changes (CR 400.7, 614.12) -------------------------------------------------------------------------------------------------

function moveOptions(d: DestinationFacts): MoveOptions {
  return {
    proposed: true,
    ...(d.position !== undefined ? { position: d.position } : {}),
    ...(d.cause !== undefined ? { cause: d.cause } : {}),
    ...(d.controller !== undefined ? { controller: d.controller } : {}),
    ...(d.tapped ? { tapped: true } : {}),
    ...(d.faceDown ? { faceDown: true } : {}),
    ...(d.face !== undefined ? { face: d.face } : {}),
    enter: d, // M6-0 (m6 design 2.6): the facts of the proposal, read by the move parts (core/registries.ts#MOVE_PARTS)
  };
}

function performZoneChange(g: Game, e: Ev<'zoneChange'>): ObjectId | null {
  const o = isLive(g, e.object.id, e.object.zone);
  // CR 701.24c: "shuffle it into its owner's library" shuffles that library even if the object is no longer where it was expected.
  const owner = (o ?? g.s.lki[e.object.id]?.object)?.owner;
  const used = CHAIN_OF.get(e);
  // M6-4 INTERFACE CHANGE (m6 design 3.6): a double-faced card told to enter transformed whose back face is an instant or sorcery doesn't enter: a resolving
  // spell goes to its owner's graveyard (CR 712.13a), anything else stays where it is (CR 304.4, 307.4)
  const blocked = o && e.to === 'battlefield' && e.destination.transformed === true ? transformedEntry(g.s, o) : null;
  if (o && blocked) {
    g.log(`${g.nameOf(o.id)} can't enter the battlefield transformed: its back face is an instant or sorcery${blocked === 'graveyard' ? ", so it is put into its owner's graveyard" : ''}.`, { rules: blocked === 'graveyard' ? ['CR 712.13a'] : ['CR 304.4', 'CR 307.4'], level: 'info' });
    return blocked === 'graveyard' ? moveObject(g, o.id, 'graveyard', { cause: 'resolve' }) : null;
  }
  const opts = e.to === 'battlefield' ? { ...moveOptions(e.destination), putEnteringCounters: putEnteringCounters(g, () => used) } : moveOptions(e.destination);
  const newId = o ? moveObject(g, o.id, e.to, opts) : null;
  if (newId && e.to === 'battlefield') applyEnterFacts(g, newId, e.destination, used);
  if (e.destination.shuffle === true && e.to === 'library' && owner !== undefined) shuffleLibrary(g, owner); // CR 701.24a
  return newId;
}

/**
 * Counters a permanent is put onto the battlefield with (CR 122.6, 614.1c): a `counters` proposal with the cause 'replacement', made in the branch of the
 * entering (`used`, CR 614.5), so "if an effect would put one or more counters" (Doubling Season) and "if one or more +1/+1 counters would be put" (Hardened
 * Scales) apply to them (CR 614.16) and "can't have counters put on it" stops them (CR 614.17). Returns how many were put. M6-1 review: core/zones.ts uses it
 * for the printed loyalty and defense counters too (CR 306.5b, 310.4b).
 */
function putEnteringCounters(g: Game, used: () => ReadonlySet<string> | undefined): PutEnteringCounters {
  return (id, kind, count) =>
    inBranch(g, used(), () => proposeNested(g, { ev: 'counters', change: 'put', on: { id, zone: 'battlefield' }, kind, count, cause: 'replacement' }))?.amount ?? 0;
}

/**
 * What an `enters` replacement decided, applied to the new permanent before anything else can see it (CR 614.1c, 614.12): counters "put on it as it enters"
 * (CR 122.6), choices in its link store (CR 607.2d), the object it enters attached to (CR 303.4f), abilities it enters with (a layer 6 effect, CR 613.1f).
 * Tapped and controller were given to `moveObject`.
 *
 * M6-1 (m6 design 3.1.7, CR 614.16, 122.6): the counters are `counters` proposals with the cause 'replacement', made in the branch of the entering
 * (`used`: CR 614.5), so "if an effect would put one or more counters" (Doubling Season) and "if one or more +1/+1 counters would be put" (Hardened Scales)
 * apply to them, and "can't have counters put on it" stops them (CR 614.17).
 */
function applyEnterFacts(g: Game, id: ObjectId, d: DestinationFacts, used?: ReadonlySet<string>): void {
  const o = g.obj(id);
  const name = g.nameOf(id);
  for (const ch of d.chosen ?? []) setLink(o, ch.link, { ...(ch.values ? { values: ch.values } : {}), ...(ch.players ? { players: ch.players } : {}), ...(ch.objects ? { objects: ch.objects } : {}) });
  if (d.chosen && d.chosen.some((c) => c.objects === undefined)) {
    const what = d.chosen.filter((c) => c.objects === undefined).map((c) => (c.values ?? c.players?.map((p) => g.player(p).name) ?? []).join(', ')).join('; ');
    g.log(`${name} enters with ${what} chosen.`, { rules: ['CR 614.12a', 'CR 607.2d'], level: 'info' });
  }
  if (d.tapped && o.tapped) g.log(`${name} enters tapped.`, { rules: ['CR 614.1c'], level: 'info' });
  const putCounters = putEnteringCounters(g, () => used);
  for (const c of d.counters ?? []) {
    if (c.count <= 0) continue;
    // WP31 review: 0 under "can't have counters put on it" (CR 122.6, 614.17): logged as it happened
    const put = putCounters(id, c.kind, c.count);
    if (put > 0) g.log(`${name} enters with ${put} ${c.kind} counter${put === 1 ? '' : 's'} on it.`, { rules: ['CR 614.1c', 'CR 122.6'], level: 'info' });
  }
  if (d.attachTo !== undefined) {
    o.attachedTo = d.attachTo;
    g.emit({ type: 'attached', objectId: id, to: d.attachTo });
    const host = g.s.players.find((p) => p.id === d.attachTo)?.name ?? g.nameOf(d.attachTo);
    g.log(`${name} enters attached to ${host}.`, { rules: ['CR 303.4f', 'CR 614.1c'], level: 'info' });
  }
  // M6-6 INTERFACE CHANGE (additive): "enters prepared" (CR 722.3a; effects/enters-parts/prepared.ts): the designation and the exile copy (CR 722.3c)
  if (d.prepared === true) becomePrepared(g, id);
  // trek-8 (CR 614.1c, 508.4): "enters tapped and attacking": once it is on the battlefield with its other entering facts, it joins the combat (its controller chooses what it attacks)
  // (trek-8 review: the way the putting effect says, when it says one: "tapped and attacking target player", ninjutsu; else the controller chooses, once)
  if (d.attacking === true) (g.enterAttackingBy ?? ((ids) => enterAttackingChoosing(g, ids)))([id]);
  if (d.abilities && d.abilities.length > 0) {
    const rec: ContinuousEffectRec = {
      id: g.newEffectId(),
      source: { id, zone: 'battlefield' },
      sourceName: name,
      controller: o.controller,
      timestamp: o.timestamp, // it has them from the moment it enters (CR 613.7d)
      startedTurn: g.s.turn.number,
      duration: { d: 'permanent' }, // for as long as it is this object: a handle to a moved object is stale (CR 400.7, 611.2c)
      effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] }, mods: [{ layer: 6, add: d.abilities }] },
    };
    g.s.continuousEffects.push(rec);
    g.log(`${name} enters with ${d.abilities.map((a) => a.text).join('; ')}.`, { rules: ['CR 614.1c', 'CR 613.1f'], level: 'info' });
  }
  // std-freecast-2 (CR 614.1c, 205.1b, 613.1d): "... and is a Vampire in addition to its other types": a layer 4 effect on the new object, as its abilities above
  if (d.subtypes && d.subtypes.length > 0) {
    g.s.continuousEffects.push({
      id: g.newEffectId(),
      source: { id, zone: 'battlefield' },
      sourceName: name,
      controller: o.controller,
      timestamp: o.timestamp, // from the moment it enters (CR 613.7d)
      startedTurn: g.s.turn.number,
      duration: { d: 'permanent' }, // for as long as it is this object (CR 400.7, 611.2c)
      effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] }, mods: [{ layer: 4, subtypes: { add: [...d.subtypes] } }] },
    });
    g.log(`${name} enters as ${d.subtypes.join(' ')} in addition to its other types.`, { rules: ['CR 614.1c', 'CR 205.1b'], level: 'info' });
  }
}

// ---- tokens (CR 111) ------------------------------------------------------------------------------------------------------------

/**
 * Creating tokens (CR 111.1, 111.4): the creation was proposed (and replaced) first; then each token entering is its own entry through the pipeline (CR 616.1g),
 * where its own "as it enters" replacements and the facts of the effect (`enter`) apply. The token object exists (in no zone list yet) while they are worked
 * out, so the choices are made before it is on the battlefield (CR 614.12a); a token whose entry does not happen is not created (CR 303.4g, 614.17).
 */
function performCreateToken(g: Game, e: Ev<'createToken'>): ObjectId[] {
  const def = g.s.defs[e.token];
  if (!def) throw new EngineBug(`createToken: no token definition "${e.token}" (the handler adds it with Game.addDef first)`);
  if (!entryPipeline) throw new EngineBug('createToken: the entry pipeline is not installed (effects/funnels.ts was not loaded)');
  const pipeline = entryPipeline;
  const out: ObjectId[] = [];
  for (let i = 0; i < e.count; i++) {
    let facts: DestinationFacts = {};
    let used: ReadonlySet<string> | undefined;
    const entering = (o: GameObject): boolean => {
      const entry = pipeline(g, { ev: 'zoneChange', object: { id: o.id, zone: 'battlefield' }, from: null, to: 'battlefield', destination: { ...e.enter, controller: e.player, cause: 'create token' } });
      if (!entry || entry.ev !== 'zoneChange' || entry.to !== 'battlefield') return false;
      facts = entry.destination;
      used = CHAIN_OF.get(entry);
      if (facts.tapped) o.tapped = true; // entering tapped is not becoming tapped (CR 603.2e)
      if (facts.controller !== undefined) o.controller = facts.controller; // CR 616.1b
      if (facts.face !== undefined && facts.face < def.faces.length) o.face = facts.face; // M6-4: CR 707.8a, 712.14a: a double-faced token enters with that face up
      return true;
    };
    const id = createToken(g, def, e.player, { proposed: true, entering, putEnteringCounters: putEnteringCounters(g, () => used) }); // CR 111.1, 111.4; `used` is set by `entering`
    if (!id) {
      g.log(`A ${def.name} token is not created.`, { rules: ['CR 303.4g', 'CR 614.17'], level: 'info' });
      continue;
    }
    g.emit({ type: 'tokenCreated', player: e.player, objectId: id });
    applyEnterFacts(g, id, facts, used);
    out.push(id);
  }
  if (out.length > 0) g.log(`${g.player(e.player).name} creates ${out.length === 1 ? 'a' : out.length} ${def.name} token${out.length === 1 ? '' : 's'}.`, { rules: ['CR 111.1', 'CR 701.7a'], level: 'action' });
  return out;
}

// ---- payments and shields (CR 614.12a, 615.7-615.8) -------------------------------------------------------------------------------------

/** Pay a cost "you may pay" as a permanent enters (CR 614.12a, 118.12): its mana through a `payCost` decision with this origin (design 3.8). */
export function performPayment(g: Game, player: PlayerId, plan: CostPlan, label: string, origin: NonNullable<PayCostDecision['origin']>): void {
  payPlan(g, player, null, plan, label, { origin });
}

/** Set what is left of a shield (its budget, CR 615.7, or its uses, CR 615.8); a spent shield is gone. */
export function setShieldLeft(g: Game, recId: string, left: number): void {
  const rec = g.s.continuousEffects.find((r) => r.id === recId);
  if (!rec) return;
  if (left > 0) rec.usesLeft = left;
  else g.s.continuousEffects = g.s.continuousEffects.filter((r) => r !== rec);
}

// ---- counters (CR 122) ------------------------------------------------------------------------------------------------------------

function performCounters(g: Game, e: Ev<'counters'>): number {
  const delta = e.change === 'put' ? e.count : -e.count;
  if (typeof e.on !== 'string') {
    if (!isLive(g, e.on.id, e.on.zone)) return 0;
    // FAST5X E21 (CR 122.6, 122.6a): who puts them: the player the proposal names, else (counters it enters with, a rule's or a replacement's) its controller
    const by = e.change === 'put' ? e.by ?? (e.cause === 'replacement' || e.cause === 'rule' ? g.s.objects[e.on.id]?.controller : undefined) : undefined;
    return Math.abs(addCounters(g, e.on.id, e.kind, delta, by)); // CR 122.1, 122.6
  }
  const p = g.player(e.on as PlayerId);
  if (e.kind === 'poison' && delta > 0) {
    givePoison(g, p.id, delta, 'an effect'); // CR 122.1f
    return delta;
  }
  const before = e.kind === 'poison' ? p.poison : Object.hasOwn(p.counters, e.kind) ? p.counters[e.kind]! : 0;
  const after = Math.max(0, before + delta);
  if (after === before) return 0;
  if (e.kind === 'poison') p.poison = after;
  else if (after === 0) delete p.counters[e.kind];
  else p.counters[e.kind] = after;
  g.emit({ type: 'countersChanged', target: p.id, counter: e.kind, delta: after - before, ...(e.by !== undefined && after > before ? { by: e.by } : {}) });
  g.log(`${p.name} ${after > before ? 'gets' : 'loses'} ${Math.abs(after - before)} ${e.kind} counter${Math.abs(after - before) === 1 ? '' : 's'}.`, { rules: ['CR 122.1'], level: 'info' });
  return Math.abs(after - before);
}

/**
 * std-ru (CR 607.2a, 607.2c, 400.7): an "exile it instead" replacement with a link adds the object it exiled to its source's link store (effects/bodies/m5.ts
 * #linkAfterMove), as a `move` with `link` does (effects/handlers/zones-util.ts#addToLink): only while the source is still the object it was.
 */
export function performAddToLink(g: Game, source: ObjHandle, link: LinkId, object: ObjHandle): void {
  const o = g.s.objects[source.id];
  if (!o || o.zone !== source.zone) return;
  const prev = readLink(o, link);
  const before = prev?.objects ?? [];
  if (!before.some((b) => b.id === object.id)) setLink(o, link, { ...prev, objects: [...before, object] });
}
