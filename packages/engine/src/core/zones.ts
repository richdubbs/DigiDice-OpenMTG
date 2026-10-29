/**
 * Zone bookkeeping (CR 400). Every zone change creates a new object (CR 400.7) and records
 * last known information about the old one (CR 608.2h, 603.10).
 */
import { clone } from '../util/clone';
import { HIDDEN_ZONES, type GameObject, type GameState, type LastKnown, type LinkValue, type ObjHandle, type ZoneKind } from '../types/state';
import type { DefId, ObjectId, PlayerId } from '../types/ids';
import { EngineBug, type Game } from './game';
import { shuffleInPlace } from '../rng';
import { charsOfObject, isPermanentCard, readingStable, type Chars } from '../rules/characteristics';
import { MENTIONS_ENTERS_WITH_COUNTERS } from '../cards/enters-with';
import { attackerState, isAttacking, isBlocking, removeFromCombat } from '../rules/combat-state';
import { cantDo } from '../rules/cant';
import { variableCounterText } from '../cards/variable-counters';
import { resolveManually } from './manual';
import type { CardDef } from '../types/card';
import type { DestinationFacts } from '../effects/api';
import { MOVE_PARTS } from './registries';
import { isCommander, isCommanderGame } from '../statics/commander';
import { staticGoadersOf, staticGoadPresent } from '../statics/rule-sources';

export function zoneArray(g: Game, zone: ZoneKind, owner: PlayerId): ObjectId[] {
  const z = g.s.zones;
  switch (zone) {
    case 'library': return (z.library[owner] ??= []);
    case 'hand': return (z.hand[owner] ??= []);
    case 'graveyard': return (z.graveyard[owner] ??= []);
    case 'battlefield': return z.battlefield;
    case 'stack': return z.stack;
    case 'exile': return z.exile;
    case 'command': return z.command;
  }
}

function removeFromZone(g: Game, o: GameObject): void {
  const arr = zoneArray(g, o.zone, o.owner);
  const i = arr.indexOf(o.id);
  if (i < 0) throw new EngineBug(`Object ${o.id} not found in its zone ${o.zone}`);
  arr.splice(i, 1);
}

export interface MoveOptions {
  /** Library/stack position: 'top' (default) or 'bottom', or an index from the top for libraries. */
  position?: 'top' | 'bottom' | number;
  cause?: string;
  /** New controller (battlefield/stack); defaults to the owner (CR 110.2) unless `keepController`. */
  controller?: PlayerId;
  tapped?: boolean;
  faceDown?: boolean;
  face?: number;
  /** Don't emit an event (used during game setup). */
  silent?: boolean;
  /** The move has been through the proposal pipeline already: perform it as it is (WP11 interface change, see `installZoneChangeFunnel`). */
  proposed?: boolean;
  /** M6-0 (m6 design 2.6): the facts of the proposal (effects/perform-events.ts passes them), read by the move parts (core/registries.ts#MOVE_PARTS). */
  enter?: DestinationFacts;
  /** M6-1 review: how the counters it enters with are put (see `PutEnteringCounters`); the performer of a proposed move passes it. */
  putEnteringCounters?: PutEnteringCounters;
}

/**
 * M6-1 review (CR 306.5b, 310.4b, 614.1c, 614.16): the printed loyalty and defense counters a permanent enters with are put by replacement effects built into
 * its card type, so "if an effect would put one or more counters" (Doubling Season) applies to them. The performer of the entering (effects/perform-events.ts)
 * passes this: it proposes them as a `counters` event with the cause 'replacement' in the branch of the entering (CR 614.5) and returns how many were put.
 * Core does not import the pipeline (import rules), so a move without it (a silent setup move) puts them directly.
 */
export type PutEnteringCounters = (id: ObjectId, kind: string, count: number) => number;

/**
 * WP11 INTERFACE CHANGE (design 8.5): the proposal pipeline (effects/propose.ts) is the one place that knows replacement effects, so EVERY zone change goes
 * through it, whoever asks for the move (a resolving spell, a land being played, a state-based action, a cost, a manual operation): "as it enters" replacements
 * (CR 614.1c-d, 614.12) and "would be put into ... instead" (CR 614.1a) apply however the object moves. effects/funnels.ts installs the funnel when it loads
 * (core/create.ts and core/apply.ts import it); the funnel calls back into `moveObject` with `proposed: true` once the replacements are applied. Silent setup
 * moves and abilities leaving the stack (they cease to exist, CR 113.7a) are not events and skip it. A move with no funnel installed is an EngineBug: it is
 * never performed without its replacement effects (WP11 review).
 */
export type ZoneChangeFunnel = (g: Game, id: ObjectId, to: ZoneKind, opts: MoveOptions) => ObjectId | null;
let zoneFunnel: ZoneChangeFunnel | null = null;
export function installZoneChangeFunnel(f: ZoneChangeFunnel | null): void {
  zoneFunnel = f;
}

/** A fresh object state for an object entering a zone (CR 400.7: no memory of its previous existence). */
export function freshObject(g: Game, base: Pick<GameObject, 'kind' | 'defId' | 'owner'> & Partial<GameObject>, zone: ZoneKind): GameObject {
  const o: GameObject = {
    id: g.newObjectId(),
    kind: base.kind,
    defId: base.defId,
    owner: base.owner,
    controller: base.controller ?? base.owner,
    zone,
    timestamp: g.newTimestamp(),
    tapped: false,
    flipped: false,
    faceDown: false,
    phasedOut: false,
    face: base.face ?? 0,
    controlledSinceTurn: g.s.turn.number,
    counters: {},
    damage: 0,
    deathtouchDamaged: false,
  };
  if (base.cardId !== undefined) o.cardId = base.cardId;
  return o;
}

/**
 * CR 306.5b / 310.4b: a planeswalker enters with loyalty counters equal to its printed loyalty, a battle with defense counters
 * equal to its printed defense. Both are replacement effects built into the card type (CR 614.1c), so they apply however the
 * permanent enters (resolving spell, put onto the battlefield by hand, ...).
 */
/**
 * CR 310.12a ("As a Siege enters the battlefield, its controller must choose its protector from among their opponents"), 704.5x (again when it has none):
 * M12-2 (m12 design D13, E19-E20): the controller is asked only when two or more opponents are still in the game (a multiplayer game); with one it is that
 * opponent, as in a two-player game. Undefined: no opponent is left.
 */
export function chooseSiegeProtector(g: Game, controller: PlayerId, name: string, rules: string[] = ['CR 310.9a', 'CR 310.12a']): PlayerId | undefined {
  const opponents = g.opponents(controller).map((p) => p.id);
  if (opponents.length <= 1) return opponents[0];
  const pick = g.choose({
    kind: 'chooseOption', player: controller, min: 1, max: 1, rules,
    prompt: `Choose the protector of ${name} among your opponents.`,
    options: opponents.map((id) => ({ id, label: g.player(id).name })),
  });
  return opponents.find((p) => p === pick.ids[0]) ?? opponents[0];
}

function enterWithPrintedCounters(g: Game, o: GameObject, put?: PutEnteringCounters): void {
  if (o.faceDown) return;
  const c = charsOfObject(g.s, o);
  const byHand: string[] = [];
  if (c.types.includes('Battle')) {
    // CR 310.9a, 310.12a: a Siege's protector is chosen from its controller's opponents (the only one in a two-player game); a battle without
    // a battle type is protected by its controller.
    o.protector = c.subtypes.includes('Siege') ? chooseSiegeProtector(g, o.controller, c.name) ?? o.controller : o.controller;
  }
  const intrinsic = [
    { type: 'Planeswalker', printed: c.loyalty, counter: 'loyalty', rule: 'CR 306.5b' },
    { type: 'Battle', printed: c.defense, counter: 'defense', rule: 'CR 310.4b' },
  ] as const;
  for (const { type, printed, counter, rule } of intrinsic) {
    if (!c.types.includes(type) || printed === undefined) continue;
    const n = Number(printed);
    if (!Number.isInteger(n) || n < 0) {
      byHand.push(variableCounterText(counter, printed)); // the text of the card's manual part (cards/pipeline.ts#variableCounterAbilities)
      continue;
    }
    if (n === 0) continue;
    if (cantDo(g.s, 'haveCountersPut', o.id)) { // WP31: CR 122.6, 614.17 (a planeswalker that can't have counters put on it enters with none)
      g.log(`${c.name} enters with no ${counter} counters: a "can't" effect forbids putting counters on it.`, { rules: [rule, 'CR 122.6', 'CR 614.17'], level: 'info' });
      continue;
    }
    // M6-1 review: through the pipeline (CR 614.16), so a counters replacement (Doubling Season) sees them; directly only on a silent setup move.
    let added = n;
    if (put) added = put(o.id, counter, n);
    else {
      o.counters[counter] = n;
      g.emit({ type: 'countersChanged', target: o.id, counter, delta: n, by: o.controller }); // FAST5X E21: its controller puts them (CR 122.6a)
    }
    if (added > 0) g.log(`${c.name} enters with ${added} ${counter} counter${added === 1 ? '' : 's'}.`, { rules: [rule, 'CR 614.1c', ...(added !== n ? ['CR 614.16'] : [])], level: 'info' });
  }
  // "Enters with X +1/+1 counters" and every other `enters` replacement of the permanent's own static abilities (CR 614.1c, 614.12) are applied by the proposal
  // pipeline (effects/propose.ts, WP11) as it enters, before any state-based action can see it; only the lines the compiler could not read are asked here.
  for (const a of c.abilities) {
    if (a.def.kind === 'manual' && a.def.entersWithCounters) byHand.push(a.def.text.split(/\r?\n/).filter((l) => MENTIONS_ENTERS_WITH_COUNTERS.test(l)).join(' '));
  }
  // What the engine can't evaluate is asked from the controller now, before state-based actions (never silently skipped, and a 0/0 creature or a planeswalker
  // with 0 loyalty must not be put into the graveyard before its counters are added, CR 704.5f, 704.5i).
  if (byHand.length > 0) {
    const name = g.nameOf(o.id);
    const text = byHand.join(' ');
    resolveManually(g, o.controller, { // MRE: in steps like every manualResolve decision
      kind: 'manualResolve',
      player: o.controller,
      prompt: `${name} enters the battlefield with counters the engine can't work out: ${text} Add them with a counters operation on ${o.id}, then confirm.`,
      sourceName: name,
      text,
      subjectId: o.id,
      rules: ['CR 614.1c'],
    });
  }
}

/**
 * FAST5X E28 review (CR 603.10a, 608.2h): `fn` moves the objects `ids` (some or all of them) in one event, one after another; the last known information of each
 * is its characteristics just before the first of them moved (a creature that has persist because of a permanent that leaves with it still had persist, Isilu,
 * Carrier of Twilight under a "destroy all creatures"). Pass the characteristics already worked out (`known`) to skip recomputing them. Nests: an inner call keeps
 * the snapshots of the outer one. Review 2026-10-26 F33: the snapshots are pure reads of the state as it is, taken in one `readingStable` scope (one check of the
 * characteristics cache, not one per object), and what is attached to each permanent is read from one index of the battlefield (`attachmentIndex`).
 */
export function leavingTogether<T>(g: Game, ids: readonly ObjectId[], fn: () => T, known?: ReadonlyMap<ObjectId, LastKnown['chars']>): T {
  const outer = g.leaving;
  const outerGoaded = g.leavingGoaded;
  const outerAttached = g.leavingAttached;
  const outerBoard = g.leavingBoard;
  const s = g.s;
  const snap = new Map(outer ?? []);
  try {
    readingStable(s, () => {
      for (const id of ids) {
        const o = s.objects[id];
        if (!o || o.kind === 'ability' || snap.has(id)) continue;
        snap.set(id, known?.get(id) ?? charsOfObject(s, o));
      }
      // Cloud C3 (CR 603.10a): who goads each of them through a static goad, before any of them moves (the Aura or the goading creature may leave with them)
      if (staticGoadPresent(s)) {
        const goaded = new Map(outerGoaded ?? []);
        for (const id of ids) if (!goaded.has(id) && s.objects[id]?.zone === 'battlefield') goaded.set(id, staticGoadersOf(s, id));
        g.leavingGoaded = goaded;
      }
      // r5-fxb (CR 603.10a): what is attached to each of them, before any of them (or an Aura or Equipment on it) moves; review 2026-10-26 F18: only in a game
      // one of whose definitions can ask (`attachedLookbackPresent`)
      if (attachedLookbackPresent(s)) {
        const attached = new Map(outerAttached ?? []);
        let index: ReadonlyMap<ObjectId, readonly ObjectId[]> | undefined;
        for (const id of ids) {
          if (attached.has(id) || s.objects[id]?.zone !== 'battlefield') continue;
          attached.set(id, attachedState(s, id, (index ??= attachmentIndex(s)), snap.get(id) ?? undefined));
        }
        g.leavingAttached = attached;
      }
    });
    g.leaving = snap;
    // std-combat-3 (CR 603.10a): the battlefield before any of them moves (an outer call's snapshot is earlier still); review 2026-10-26 F18: one frozen array that
    // the last known information of every object of the event shares (moveObject), not a copy each
    g.leavingBoard = outerBoard ?? Object.freeze([...s.zones.battlefield]);
    return fn();
  } finally {
    g.leaving = outer;
    g.leavingGoaded = outerGoaded;
    g.leavingAttached = outerAttached;
    g.leavingBoard = outerBoard;
  }
}

/**
 * Review 2026-10-26 F18 (CR 603.10a, 700.9, 301.5): can anything in this game ask what was attached to a permanent as it left (`LastKnown.attached`): a filter
 * `equipped`, `modified` or `wasAttachedTo` anywhere in a definition (its own abilities, an ability it grants, a token it creates)? Every reader of an object's
 * equipped or modified state comes from a definition (rules/filter.ts, statics/match.ts), so in a game without one the last known information skips it.
 * Memoized per definition and per `defs` map and its size, as statics/rule-sources.ts#staticGoadPresent (definitions are only added: a "yes" stays true).
 */
const DEF_ASKS_ATTACHED = new WeakMap<object, boolean>();
const DEFS_ASK_ATTACHED = new WeakMap<GameState['defs'], { v: boolean; n: number }>();
export function attachedLookbackPresent(s: GameState): boolean {
  const defs = s.defs;
  const hit = DEFS_ASK_ATTACHED.get(defs);
  if (hit?.v) return true;
  let n = 0;
  for (const _k in defs) n++;
  if (hit && hit.n === n) return false;
  let v = false;
  for (const k in defs) {
    const d = defs[k]!;
    let r = DEF_ASKS_ATTACHED.get(d);
    if (r === undefined) {
      const j = JSON.stringify(d);
      DEF_ASKS_ATTACHED.set(d, (r = j.includes('"equipped":') || j.includes('"modified":') || j.includes('"wasAttachedTo":')));
    }
    if (r) { v = true; break; }
  }
  DEFS_ASK_ATTACHED.set(defs, { v, n });
  return v;
}

/** Review 2026-10-26 F33: the permanents attached to each permanent (in battlefield order; a phased-out attachment is none), from one pass over the battlefield. */
function attachmentIndex(s: GameState): Map<ObjectId, ObjectId[]> {
  const out = new Map<ObjectId, ObjectId[]>();
  for (const aid of s.zones.battlefield) {
    const a = s.objects[aid];
    if (a === undefined || a.attachedTo === undefined || a.phasedOut) continue;
    const list = out.get(a.attachedTo);
    if (list) list.push(aid);
    else out.set(a.attachedTo, [aid]);
  }
  return out;
}

/**
 * r5-fxb (CR 700.9, 301.5, 303.4): is the permanent equipped (an Equipment attached), and modified (a counter on it, an Equipment attached, or an Aura its
 * controller controls attached), now? As rules/filter.ts#isEquipped / isModified read a permanent on the battlefield (a phased-out attachment is none).
 * `index` is `attachmentIndex(s)`, `chars` the permanent's characteristics when they are already worked out.
 */
function attachedState(s: GameState, id: ObjectId, index: ReadonlyMap<ObjectId, readonly ObjectId[]> = attachmentIndex(s), chars?: Chars): { equipped: boolean; modified: boolean; ids?: ObjectId[] } {
  const o = s.objects[id]!;
  const controller = (chars ?? charsOfObject(s, o)).controller;
  let equipped = false;
  let aura = false;
  const ids = [...(index.get(id) ?? [])];
  for (const aid of ids) {
    const c = charsOfObject(s, s.objects[aid]!);
    if (c.subtypes.includes('Equipment')) equipped = true;
    if (c.subtypes.includes('Aura') && c.controller === controller) aura = true;
  }
  return { equipped, modified: equipped || aura || Object.values(o.counters).some((n) => n > 0), ...(ids.length > 0 ? { ids } : {}) };
}

/**
 * Move an object to a zone. Returns the new object's id (or null if it ceased to exist,
 * e.g. a token leaving the battlefield is put in the new zone and then removed by SBA 704.5d;
 * an ability leaving the stack simply ends).
 */
export function moveObject(g: Game, id: ObjectId, to: ZoneKind, opts: MoveOptions = {}): ObjectId | null {
  const old = g.obj(id);
  if ((to === 'battlefield' || to === 'stack') && old.kind !== 'ability' && g.s.options.multiplayer !== undefined) {
    // M12-2 (m12 design E28): CR 800.4b, "If an object would be put onto the battlefield or onto the stack under the control of a player who has left the
    // game, that object remains in its current zone."
    const ctl = opts.controller ?? (to === 'stack' ? old.controller : old.owner);
    if (g.player(ctl).hasLost) {
      g.log(`${g.nameOf(id)} stays where it is: ${g.player(ctl).name}, who would control it, has left the game.`, { rules: ['CR 800.4b'], level: 'info' });
      return null;
    }
  }
  if (!opts.proposed && !opts.silent && old.kind !== 'ability') {
    if (!zoneFunnel) throw new EngineBug('moveObject: the zone change funnel is not installed (effects/funnels.ts was not loaded)');
    return zoneFunnel(g, id, to, opts); // WP11: replacement effects first (design 8.5)
  }
  const from = old.zone;
  // Record last known information before it leaves (CR 608.2h, 603.10): the object and its characteristics with every effect applied, written once and
  // never edited (design 4.3). Abilities on the stack are not cards and have no characteristics of their own.
  // FAST5X E28 review (CR 603.10a): an object that leaves together with others is as it was just before that event, not after the others moved
  const together = g.leaving?.get(id);
  if (together !== undefined) g.leaving!.delete(id);
  g.s.lki[id] = { object: clone(old), chars: old.kind === 'ability' ? null : together ?? charsOfObject(g.s, old), leftZone: from };
  // Cloud C3 (CR 701.15a-c, 603.10a): the players who goaded it through a static goad as it left ("whenever a goaded creature dies", rules/filter.ts)
  if (from === 'battlefield' && old.kind !== 'ability') {
    const goadedBy = g.leavingGoaded?.get(id) ?? staticGoadersOf(g.s, id);
    g.leavingGoaded?.delete(id);
    if (goadedBy.length > 0) g.s.lki[id]!.goadedBy = [...goadedBy];
  }
  // r5-fxb (CR 603.10a, 700.9): what was attached to it as it left ("whenever a modified creature you control leaves the battlefield")
  // Review 2026-10-26 F18: only in a game that can ask (`attachedLookbackPresent`)
  if (from === 'battlefield' && old.kind !== 'ability') {
    const attached = g.leavingAttached?.get(id) ?? (attachedLookbackPresent(g.s) ? attachedState(g.s, id) : undefined);
    if (attached !== undefined) g.s.lki[id]!.attached = attached;
    g.leavingAttached?.delete(id);
  }
  // std-combat-3 (CR 603.10a): the battlefield as it was immediately before it left (with the others of its event still on it); review 2026-10-26 F18: the frozen
  // snapshot of its event is shared by every object of it (written once, never edited, like every last known information)
  if (from === 'battlefield' && old.kind !== 'ability') g.s.lki[id]!.board = g.leavingBoard ?? Object.freeze([...g.s.zones.battlefield]);
  // FAST4 T34 (CR 506.4, 608.2h): whether it was attacking or blocking as it left, which removing it from combat erases
  if (from === 'battlefield' && (isAttacking(g.s, id) || isBlocking(g.s, id))) {
    // FAST5X E7 (CR 702.190b, 508.5): and what it was attacking, which sneak's "the same player, planeswalker, or battle" reads after it was returned
    const att = attackerState(g.s, id);
    const blk = g.s.combat?.blockers.find((b) => b.id === id);
    g.s.lki[id]!.combat = { attacking: att !== undefined, blocking: isBlocking(g.s, id), ...(att ? { defender: att.defender, defendingPlayer: att.defendingPlayer, blockedBy: [...att.blockedBy] } : {}), ...(blk ? { blockingIds: [...blk.blocking] } : {}) };
  }
  if (from === 'battlefield') removeFromCombat(g.s, id); // CR 506.4
  removeFromZone(g, old);
  delete g.s.objects[id];

  if (old.kind === 'ability') {
    // Abilities on the stack aren't cards; they just cease to exist when they leave (CR 113.7a style bookkeeping).
    return null;
  }
  const o = freshObject(g, { kind: old.kind, defId: old.defId, owner: old.owner, ...(old.cardId !== undefined ? { cardId: old.cardId } : {}) }, to);
  if (opts.face !== undefined) o.face = opts.face;
  if (to === 'battlefield' || to === 'stack') o.controller = opts.controller ?? (to === 'stack' ? old.controller : old.owner);
  if (opts.tapped) o.tapped = true;
  if (opts.faceDown) o.faceDown = true;
  g.s.objects[o.id] = o;
  const arr = zoneArray(g, to, o.owner);
  const pos = opts.position ?? 'top';
  if (to === 'library') {
    if (pos === 'top') arr.unshift(o.id);
    else if (pos === 'bottom') arr.push(o.id);
    else arr.splice(Math.max(0, Math.min(arr.length, pos)), 0, o.id);
  } else {
    // Graveyard and stack: last = top. Other zones are unordered.
    arr.push(o.id);
  }
  g.s.lki[id]!.newId = o.id;
  // M6-0 (m6 design 2.6): the move parts, after the object left and the new one exists, before the event and before it enters with printed counters
  // (CR 708.9 reveals, CR 712.21 / 730.3 components; CR 707.5 copies, CR 708.3 face down). Empty in M6-0.
  for (const p of MOVE_PARTS) p.afterLeave?.(g, old, o.id, opts);
  for (const p of MOVE_PARTS) p.beforeEnter?.(g, o, opts);
  if (!opts.silent) {
    // M11-1, CR 903.9c: a move part may have put the new object elsewhere (the commander card of a melded or merged permanent goes to the command zone,
    // core/move-parts/components.ts): the event says where it is. Outside that case `o.zone` is `to`.
    const cause = o.zone !== to && o.zone === 'command' ? 'commander' : opts.cause;
    g.emit({
      type: 'zoneChanged', oldId: id, newId: o.id, from: old.fromOutside === true ? null : from, to: o.zone, owner: o.owner, controller: o.controller, // trek-11 (CR 400.11b): a card from outside the game comes from no zone
      name: g.nameOf(o.id), ...(cause ? { cause } : {}), ...(o.faceDown ? { faceDown: true as const } : {}), // FAST5X E25 (CR 708.3, 406.3)
      ...(o.zone === 'battlefield' && o.tapped ? { tapped: true as const } : {}), // pc-tokens-2 (CR 603.6a)
    });
  }
  // FAST5X E22 (CR 700.11, 110.4a): a permanent card put into a graveyard from anywhere is one more time its owner (a card goes to its owner's graveyard,
  // CR 400.3) "descended this turn"; judged as the card is in the graveyard (a modal double-faced card is its front face there, CR 712.8a), so a token, which
  // is no card, never descends. A silent setup move is no event and counts nothing. Where it actually is (`o.zone`, M11-1: a move part may have put a
  // commander in the command zone instead, CR 903.9c).
  if (o.zone === 'graveyard' && o.kind === 'card' && !opts.silent && isPermanentCard(charsOfObject(g.s, o))) {
    const stats = g.player(o.owner).turnStats;
    stats.descended = (stats.descended ?? 0) + 1;
  }
  if (o.zone === 'battlefield') enterWithPrintedCounters(g, o, opts.putEnteringCounters);
  return o.id;
}

/**
 * A token's characteristics come from the effect that creates it (CR 111.4), and compileCard names a definition after the card, so two different tokens
 * with the same name (a 2/2 Spirit and a 1/1 flying Spirit) would collide. An identical definition is reused; a different one gets the next free "name#n" id.
 */
function tokenDefWithOwnId(g: Game, def: CardDef): CardDef {
  let candidate = def;
  for (let n = 2; g.s.defs[candidate.id] && JSON.stringify(g.s.defs[candidate.id]) !== JSON.stringify(candidate); n++) candidate = { ...def, id: `${def.id}#${n}` };
  return candidate;
}

export interface CreateTokenOptions {
  tapped?: boolean;
  /** The creation has been through the proposal pipeline already (WP11 interface change, see `installTokenFunnel`). */
  proposed?: boolean;
  /**
   * Called once the token object exists (in `state.objects`, in no zone list yet), before it is put onto the battlefield: the performer works out how it
   * enters there (its own "as it enters" replacements, CR 614.12, 616.1g) and may set its tapped status and controller. False: the token is not created
   * (CR 303.4g, 614.17), and null is returned.
   */
  entering?: (o: GameObject) => boolean;
  /** M6-1 review: how the printed loyalty or defense counters it enters with are put (see `PutEnteringCounters`). */
  putEnteringCounters?: PutEnteringCounters;
}

/**
 * WP11 INTERFACE CHANGE (review, design 8.5, CR 616.1g): a token created by the milestone 3/4 route (a manual operation) is proposed like one created by an
 * effect, so its own "as it enters" replacements apply. effects/funnels.ts installs the funnel; it calls back with `proposed: true`.
 */
export type TokenFunnel = (g: Game, defId: string, controller: PlayerId, opts: { tapped?: boolean }) => ObjectId | null;
let tokenFunnel: TokenFunnel | null = null;
export function installTokenFunnel(f: TokenFunnel | null): void {
  tokenFunnel = f;
}

/**
 * Create a token on the battlefield (CR 111.1, 111.4). Its definition joins `state.defs` (copy-on-write, see Game.addDef); identical definitions are
 * shared and different ones that share a name get distinct ids. Tokens are objects without a card (`cardId` unset). Null: the token was not created.
 */
export function createToken(g: Game, def: CardDef, controller: PlayerId, opts: CreateTokenOptions = {}): ObjectId | null {
  if (g.s.options.multiplayer !== undefined && g.player(controller).hasLost) {
    // M12-2 (m12 design E27): CR 800.4b, "If a token would be created under the control of a player who has left the game, no token is created" (and CR
    // 800.4d: it would be owned by them, CR 111.2)
    g.log(`No ${def.name} token is created: ${g.player(controller).name} has left the game.`, { rules: ['CR 800.4b', 'CR 800.4d'], level: 'info' });
    return null;
  }
  const own = tokenDefWithOwnId(g, def);
  g.addDef(own);
  if (!opts.proposed) {
    if (!tokenFunnel) throw new EngineBug('createToken: the token funnel is not installed (effects/funnels.ts was not loaded)');
    return tokenFunnel(g, own.id, controller, opts.tapped ? { tapped: true } : {});
  }
  const o = freshObject(g, { kind: 'token', defId: own.id, owner: controller, controller }, 'battlefield');
  if (opts.tapped) o.tapped = true;
  g.s.objects[o.id] = o;
  if (opts.entering && !opts.entering(o)) {
    delete g.s.objects[o.id];
    return null;
  }
  g.s.zones.battlefield.push(o.id);
  g.emit({ type: 'zoneChanged', oldId: o.id, newId: o.id, from: null, to: 'battlefield', owner: o.owner, controller: o.controller, name: g.nameOf(o.id), cause: 'create token' });
  enterWithPrintedCounters(g, o, opts.putEnteringCounters);
  return o.id;
}

/**
 * WP15 INTERFACE CHANGE (review): create an emblem in the command zone (CR 114.2), owned and controlled by `owner`, so object creation stays in this module
 * (design 8.5). Its definition joins `state.defs` (equal definitions share an id, core/emblems.ts). No zone-change event: an emblem is not put into the command
 * zone from anywhere, and no pattern of the model reads its creation.
 */
export function createEmblemObject(g: Game, def: CardDef, owner: PlayerId, links?: Readonly<Record<string, LinkValue>>): ObjectId {
  g.addDef(def);
  const o = freshObject(g, { kind: 'emblem', defId: def.id, owner, controller: owner }, 'command');
  // std-rx9 (CR 607.2d, 608.2c): the choices of the creating resolution its abilities read, copied as the emblem's own links (core/emblems.ts#createEmblem)
  if (links !== undefined && Object.keys(links).length > 0) o.links = clone(links) as Record<string, LinkValue>;
  g.s.objects[o.id] = o;
  g.s.zones.command.push(o.id);
  return o.id;
}

/**
 * FAST5 MX7 INTERFACE CHANGE (additive): bring a card `owner` owns from outside the game (`GameState.outside`, CR 400.11a) into their hand (CR 400.11b; learn,
 * CR 701.48a). The card's entry leaves `outside` and it becomes a new card object in the hand, with a new card id (it was in no zone of this game before); it
 * stays in the game until the game ends (CR 400.11b). Emits `zoneChanged` from no zone. Null when the owner has no such card outside the game.
 */
/** std-rx30 (additive): `to` 'library' puts the card on top of its owner's library (Turtles Forever: the cards found outside the game join the ones found in it). */
export function bringIntoGame(g: Game, owner: PlayerId, defId: DefId, to: 'hand' | 'library' = 'hand'): ObjectId | null {
  const side = g.s.outside?.[owner];
  const i = side?.indexOf(defId) ?? -1;
  if (!side || i < 0 || !g.s.defs[defId]) return null;
  side.splice(i, 1);
  const o = freshObject(g, { kind: 'card', defId, owner, cardId: `c${g.s.counters.card++}` }, to);
  g.s.objects[o.id] = o;
  if (to === 'library') zoneArray(g, 'library', owner).unshift(o.id);
  else zoneArray(g, 'hand', owner).push(o.id);
  g.emit({ type: 'zoneChanged', oldId: o.id, newId: o.id, from: null, to, owner, controller: owner, name: g.nameOf(o.id), cause: 'from outside the game' });
  return o.id;
}

/**
 * trek-11 INTERFACE CHANGE (additive), CR 400.11, 400.11b, 305.1, 601.3: the card `owner` owns outside the game (`GameState.outside`), as the card they are about to play
 * from there (The Holodeck: "play a permanent card you own from outside the game"; core/special/play-outside.ts). It leaves `outside` and becomes a new card object in its
 * owner's hand marked `fromOutside`, with NO event (it is put in no zone: the move that follows, to the stack or the battlefield, is the card entering the game and says
 * it comes from no zone). The caller runs the cast or land checks on it and moves it at once, or throws away the state it staged it in (a check, a refusal and a
 * cancelled action all leave the state they began with, CR 733.1); nothing keeps the marker or the hand place past that. Null when the owner has no such card outside.
 */
export function stageFromOutside(g: Game, owner: PlayerId, defId: DefId): ObjectId | null {
  const side = g.s.outside?.[owner];
  const i = side?.indexOf(defId) ?? -1;
  if (!side || i < 0 || !g.s.defs[defId] || g.s.defs[defId]!.isToken) return null;
  side.splice(i, 1);
  const o = freshObject(g, { kind: 'card', defId, owner, cardId: `c${g.s.counters.card++}` }, 'hand');
  o.fromOutside = true;
  g.s.objects[o.id] = o;
  zoneArray(g, 'hand', owner).push(o.id);
  return o.id;
}

/**
 * H1 (hidden-information hardening): the card `id` of a library as a new object with a new id, timestamp and creation turn, keeping the card (`cardId`),
 * its definition and face. Object ids are in every view, so a card that kept its id through a shuffle or a secret arrangement could be followed to its new
 * place by any player who once knew it (CR 400.2, 401.2). Only `sightOf` may keep seeing it (the player who arranged the cards, if they saw it; CR 701.20d:
 * a revealed card that is reordered stops being revealed). No last known information is written: nothing left the library, a view must not link the two
 * ids, and the state must not grow with every shuffle. The run's `Game.renewed` map lets engine code that still holds the old id follow the card
 * (`renewedHandle`, `Game.renewedId`).
 */
function renewLibraryCard(g: Game, id: ObjectId, sightOf?: PlayerId): ObjectId {
  const old = g.obj(id);
  const fresh = freshObject(g, { kind: old.kind, defId: old.defId, owner: old.owner, face: old.face, ...(old.cardId !== undefined ? { cardId: old.cardId } : {}) }, 'library');
  if (sightOf !== undefined && old.revealedTo?.includes(sightOf)) fresh.revealedTo = [sightOf];
  delete g.s.objects[id];
  g.s.objects[fresh.id] = fresh;
  g.renewed.set(id, fresh.id);
  return fresh.id;
}

/**
 * The handle of a library card that a shuffle or an arrangement renewed during this run (H1), for code that still holds the old handle: "search, shuffle,
 * then put that card on top" (CR 701.24b), a mill or a surveil whose library a replacement shuffled meanwhile (CR 614.1a). Any other handle as it is.
 */
export function renewedHandle(g: Game, h: ObjHandle): ObjHandle {
  if (h.zone !== 'library' || g.s.objects[h.id]) return h;
  const id = g.renewedId(h.id);
  return id !== h.id && g.s.objects[id]?.zone === 'library' ? { id, zone: 'library' } : h;
}

/**
 * H1, CR 401.4: cards just put into libraries are arranged in an order nobody else may learn (`topToBottom`, first = highest: at random, CR 702.85a,
 * 701.57a, or as their owner chose). In each library the cards of the list take the places those cards occupy now, in that order, and become new objects,
 * the new ids handed out from the top down. The caller puts the cards there first in an order everybody may know (the events and the log name them in that
 * order), so neither the ids, the last known information, the events nor the log say which card is where. Ids not in a library are skipped.
 */
export function arrangeInLibrary(g: Game, topToBottom: readonly ObjectId[]): void {
  const ids = [...new Set(topToBottom.map((id) => g.renewedId(id)))].filter((id) => g.s.objects[id]?.zone === 'library');
  for (const owner of new Set(ids.map((id) => g.obj(id).owner))) {
    const lib = zoneArray(g, 'library', owner);
    const mine = ids.filter((id) => g.obj(id).owner === owner);
    const slots = mine.map((id) => lib.indexOf(id)).sort((a, b) => a - b);
    slots.forEach((slot, i) => { lib[slot] = mine[i]!; });
    for (const slot of slots) lib[slot] = renewLibraryCard(g, lib[slot]!);
  }
}

/**
 * H1: every card of a player's library becomes a new object where it is (the order is not changed, and nobody's sight of a card either), after cards were
 * put into it at places nobody else may learn (each "at a random position", CR 401.2): otherwise the newest ids would say where they went (CR 400.2).
 */
export function renewLibrary(g: Game, player: PlayerId): void {
  const lib = zoneArray(g, 'library', player);
  for (let i = 0; i < lib.length; i++) {
    const seen = g.obj(lib[i]!).revealedTo;
    lib[i] = renewLibraryCard(g, lib[i]!);
    if (seen && seen.length > 0) g.obj(lib[i]!).revealedTo = seen.slice();
  }
}

/**
 * Shuffle a player's library (CR 701.24a). H1: every card of the library becomes a new object, the new ids handed out in the new order: before the shuffle
 * a player may have known a card's id (it was searched for, looked at, revealed, put there from a hand or a public zone), and the same id afterwards would
 * say where that card went (CR 400.2, 401.2). Revealed cards stop being revealed (CR 701.20d). Not a zone change: no event but `shuffled`.
 */
export function shuffleLibrary(g: Game, player: PlayerId): void {
  const lib = zoneArray(g, 'library', player);
  shuffleInPlace(g.s.rng, lib);
  for (let i = 0; i < lib.length; i++) lib[i] = renewLibraryCard(g, lib[i]!);
  g.emit({ type: 'shuffled', player });
}

/**
 * Let `players` see these objects in a hidden zone (CR 400.2): revealing (CR 701.20a), looking at (CR 701.20e) and searching (CR 701.23a). The one place
 * effect code changes `GameObject.revealedTo`, which `core/view.ts#canSee` reads (WP13 INTERFACE CHANGE: a non-proposable zone primitive, next to
 * `shuffleLibrary`, which hides the cards again). A card stays visible to those players while it stays the same object: a card that changes zones or is
 * reordered in its library is a new object with no memory of having been seen (CR 400.7, 701.20d). Objects in public zones are seen by everybody already;
 * a player always sees their own hand (CR 402.3); ids that no longer exist are skipped.
 */
export function showCards(g: Game, ids: readonly ObjectId[], players: readonly PlayerId[]): void {
  for (const id of ids) {
    const o = g.s.objects[id];
    if (!o || (!HIDDEN_ZONES.includes(o.zone) && !(o.zone === 'exile' && o.faceDown))) continue; // FAST5X E25: a card exiled face down (CR 406.3)
    const seen = new Set(o.revealedTo ?? []);
    const add = players.filter((p) => !seen.has(p) && !(o.zone === 'hand' && p === o.owner));
    if (add.length > 0) o.revealedTo = [...(o.revealedTo ?? []), ...add];
  }
}

/**
 * Reorder a player's library (scry, surveil, "in any order", CR 701.22a, 701.25a, 401.4) without a zone change: `top` (first = topmost) above the other
 * cards, `bottom` (first = highest of them) below them; ids not in that library are ignored (an id renewed earlier in this run is followed). Nothing leaves
 * the library: no last known information is written and no event is emitted (design 4.3.3). WP13 INTERFACE CHANGE: a non-proposable zone primitive.
 * H1: every card the player placed (`top`, `bottom`) becomes a new object, also one that keeps its place, and only that player keeps seeing it (if they did):
 * the ids, or another player still seeing a card they had seen, would tell the other players whether the order was changed (CR 400.2, 401.2, 701.20d).
 * A card the player did not place that was seen and whose place changes becomes a new object nobody sees (CR 701.20d); one that keeps its place stays seen.
 */
export function reorderLibrary(g: Game, player: PlayerId, top: readonly ObjectId[], bottom: readonly ObjectId[]): void {
  const lib = zoneArray(g, 'library', player);
  const inLib = new Set(lib);
  const t = [...new Set(top.map((id) => g.renewedId(id)))].filter((id) => inLib.has(id));
  const b = [...new Set(bottom.map((id) => g.renewedId(id)))].filter((id) => inLib.has(id) && !t.includes(id));
  const placed = new Set([...t, ...b]);
  const next = [...t, ...lib.filter((id) => !placed.has(id)), ...b];
  next.forEach((id, i) => {
    const o = g.obj(id);
    const kept = lib[i] === id;
    const seen = o.revealedTo !== undefined && o.revealedTo.length > 0;
    if (placed.has(id)) next[i] = renewLibraryCard(g, id, player);
    else if (!kept && seen) next[i] = renewLibraryCard(g, id);
  });
  lib.splice(0, lib.length, ...next);
}

/**
 * FAST5X E26 (CR 702.94a, miracle): what happens AS a card is drawn ("You may reveal this card from your hand as you draw it"). Installed by triggers/miracle.ts
 * (a function registry, not game data: core/ may not import the trigger code).
 */
let drawHook: ((g: Game, player: PlayerId, id: ObjectId) => void) | null = null;
export function installDrawHook(f: (g: Game, player: PlayerId, id: ObjectId) => void): void {
  drawHook = f;
}

/**
 * Draw a card (CR 121). Drawing from an empty library is recorded for SBA 704.5b. Returns the card now in the hand, or null (none drawn, or a commander its
 * owner put into the command zone instead, CR 903.9b: drawn all the same, with the `drew` event).
 */
export function drawCard(g: Game, player: PlayerId): ObjectId | null {
  const lib = zoneArray(g, 'library', player);
  const p = g.player(player);
  if (lib.length === 0) {
    p.drewFromEmptyLibrary = true;
    g.log(`${p.name} attempts to draw from an empty library.`, { rules: ['CR 121.4', 'CR 704.5b'], level: 'warning' });
    return null;
  }
  const top = lib[0]!;
  // M11-1 (review), CR 903.9b: a commander that would be put into its owner's hand from anywhere (drawn too) may be put into the command zone instead. The
  // draw's move is silent (no proposal), so the choice is asked here; yes: the card goes to the command zone (a public zone).
  // CMDF: and the card WAS drawn. CR 121.1 defines a draw as putting the top card of the library into the hand; 903.9b replaces only where the card is put,
  // as madness or "put it into exile instead" replace only where a discarded card goes and it is still discarded (CR 702.35a "discards it, but exiles it
  // instead", 701.9a-c), and an effect that replaces the draw itself says so ("if you would draw a card, ... instead", CR 121.6, 614.11). So the draw counts:
  // "whenever you draw a card" triggers, cards drawn this turn (the Nth card each turn), and "the number of cards drawn this way". No official ruling names
  // this case (judges' rulings on 903.9 apply the same reading to the verb "exile": an exiled commander was exiled even if it went to the command zone).
  const card = g.obj(top);
  if (isCommanderGame(g.s) && card.cardId !== undefined && isCommander(g.s, card)) {
    const ans = g.choose({
      kind: 'commanderZone', player: card.owner, object: top, card: card.cardId, rule: '903.9b', zone: 'hand',
      prompt: `You would draw your commander ${g.nameOf(top)}. Put it into the command zone instead?`, rules: ['CR 903.9b', 'CR 121.1'],
    });
    if (ans.command) {
      const id = moveObject(g, top, 'command', { cause: 'commander' });
      g.log(`${p.name} draws ${id ? g.nameOf(id) : 'their commander'} and puts it into the command zone instead of into their hand.`, { rules: ['CR 903.9b', 'CR 121.1'], level: 'action' });
      if (!id) return null;
      p.turnStats.cardsDrawn++; // CMDF: a card drawn (CR 121.1, 903.9b)
      g.emit({ type: 'drew', player, objectId: id, commandZone: true });
      return null;
    }
  }
  const newId = moveObject(g, top, 'hand', { cause: 'draw', silent: true });
  if (!newId) return null;
  p.turnStats.cardsDrawn++;
  g.emit({ type: 'drew', player, objectId: newId });
  drawHook?.(g, player, newId); // FAST5X E26: miracle's reveal as the card is drawn (CR 702.94a)
  return newId;
}

export function drawCards(g: Game, player: PlayerId, n: number): ObjectId[] {
  const out: ObjectId[] = [];
  const cant = n > 0 ? cantDo(g.s, 'draw', player) : null; // WP31: "can't draw cards" (CR 121.1, 614.17): no draw happens, so none from an empty library either
  if (cant) {
    g.log(`${g.player(player).name} can't draw cards. ${cant.message}`, { rules: ['CR 121.1', 'CR 614.17'], level: 'info' });
    return out;
  }
  for (let i = 0; i < n; i++) {
    const id = drawCard(g, player);
    if (id) out.push(id);
  }
  if (n > 0) {
    const p = g.player(player);
    const names = out.map((id) => g.nameOf(id)).join(', ');
    g.log(`${p.name} draws ${n === 1 ? 'a card' : `${n} cards`}.`, {
      rules: ['CR 121.1'],
      ...(out.length ? { privateText: { players: [player], text: `${p.name} draws ${names}.` } } : {}),
    });
  }
  return out;
}

export function objectsIn(g: Game, zone: ZoneKind, owner?: PlayerId): GameObject[] {
  if (zone === 'library' || zone === 'hand' || zone === 'graveyard') {
    const owners = owner ? [owner] : g.s.players.map((p) => p.id);
    return owners.flatMap((pid) => zoneArray(g, zone, pid).map((id) => g.obj(id)));
  }
  return zoneArray(g, zone, owner ?? '').map((id) => g.obj(id)).filter((o) => !owner || o.controller === owner);
}
