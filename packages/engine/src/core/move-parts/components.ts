/**
 * The components move part (CR 701.42a, 712.4a, 712.21; m6 design 3.6, 3.7). Owner: M6-4, then M6-9.
 *
 *  - Melding (CR 701.42a, 712.14c): the meld action (effects/handlers/dfc-ops.ts) proposes ONE zone change of the first card of the pair to the battlefield inside
 *    `withMeld`; as that card's new object exists on the battlefield (afterLeave of its move), it becomes the melded permanent: its definition is the meld result's
 *    (CR 712.8g, the base part rules/base-parts/melded.ts), it has no card of its own, and its `components` are the two cards; the partner card leaves its zone
 *    without becoming an object of its own. A replacement that sends the first card elsewhere leaves the partner where it is (CR 701.42c).
 *  - Leaving the battlefield (CR 712.21): the melded permanent leaves as ONE event (a single proposal: the replacement effect chosen for it applies to both cards,
 *    CR 712.21d); its new object becomes the first card, and every other card becomes an object of its own in the same kind of zone (its owner's): "dies"
 *    triggers once, "a card is put into a graveyard from anywhere" twice (CR 712.21 example: the other card's event comes from no zone).
 *  - CR 712.21c: the last known information of the melded permanent records every other card's new object (`LastKnown.alsoBecame`, beside `newId`), so an
 *    effect that finds "the card" it became (a binding re-based after "exile it", the subject of a "dies" trigger) finds both cards and acts on each
 *    (effects/refs.ts#alsoBecameHandles).
 *
 * M6-9, merged permanents (CR 730.3; m6 design 3.7):
 *  - A merged permanent (statics/merge.ts#isMergedObject) leaves the battlefield as ONE permanent (one proposal: the replacement effect chosen for it applies to
 *    every component, CR 730.3d); its new object is its topmost component (core/zones.ts made it from the permanent's definition, card and kind, which are the
 *    topmost component's) and every other card or token becomes an object of its own in its owner's zone of the same kind, its event coming from no zone. A
 *    token component ceases to exist there (SBA 704.5d). A face-down component is revealed (CR 708.9).
 *  - CR 730.3e: a replacement effect that applies to a "card" and not to tokens applies to every component of a merged permanent that is not a token (the one
 *    proposal does that); if the merged permanent is a token, it and its token components go where the event says, and each card component is moved by such a
 *    replacement: its destination is asked of the proposal pipeline (`installComponentDestination`, effects/merge-leave.ts: core may not import it).
 *  - CR 730.3c: as for meld, every other component's new object is in `LastKnown.alsoBecame`.
 *
 * Not done here (by hand, the engine does not ask): the order of the cards in a library or graveyard (CR 712.21a, 730.3a: the first card is put first) and
 * their relative timestamps in exile (CR 712.21b, 730.3b).
 */
import type { DefId, ObjectId } from '../../types/ids';
import type { GameObject } from '../../types/state';
import { charsOfObject } from '../../rules/characteristics';
import { isMergedObject } from '../../statics/merge';
import { clone } from '../../util/clone';
import type { Game } from '../game';
import type { MovePart } from '../registries';
import type { MoveOptions } from '../zones';
import type { ZoneKind } from '../../types/state';
import type { PlayerId } from '../../types/ids';

/** The list of a zone (core/zones.ts#zoneArray: a value import of core/zones would be an import cycle through core/registries). */
function zoneArray(g: Game, zone: ZoneKind, owner: PlayerId): ObjectId[] {
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

/** A new object for a card (CR 400.7; as core/zones.ts#freshObject makes one). */
export function cardObject(g: Game, c: { kind: 'card' | 'token'; defId: DefId; owner: PlayerId; cardId?: string }, zone: ZoneKind): GameObject {
  const o: GameObject = {
    id: g.newObjectId(), kind: c.kind, defId: c.defId, owner: c.owner, controller: c.owner, zone, timestamp: g.newTimestamp(), tapped: false, flipped: false, faceDown: false,
    phasedOut: false, face: 0, controlledSinceTurn: g.s.turn.number, counters: {}, damage: 0, deathtouchDamaged: false,
  };
  if (c.cardId !== undefined) o.cardId = c.cardId;
  return o;
}

/** A meld in progress: the move of `from` to the battlefield makes the melded permanent `result` with `partner` (set by `withMeld`, transient). */
interface PendingMeld { from: ObjectId; partner: ObjectId; result: DefId }
const pending = new WeakMap<Game, PendingMeld>();

/** Run `fn` (the proposal of `from`'s move to the battlefield) as the meld of `from` and `partner` into `result` (CR 701.42a). */
export function withMeld<T>(g: Game, meld: PendingMeld, fn: () => T): T {
  pending.set(g, meld);
  try {
    return fn();
  } finally {
    pending.delete(g);
  }
}

/** Take an object out of its zone and out of the game state, keeping its last known information (CR 400.7, 608.2h). */
function leaveWithoutObject(g: Game, o: GameObject, newId: ObjectId): void {
  g.s.lki[o.id] = { object: clone(o), chars: charsOfObject(g.s, o), leftZone: o.zone, newId };
  const zone = zoneArray(g, o.zone, o.owner);
  const at = zone.indexOf(o.id);
  if (at >= 0) zone.splice(at, 1);
  delete g.s.objects[o.id];
}

/** CR 701.42a, 712.4a: the first card's new object on the battlefield becomes the melded permanent. */
function meld(g: Game, first: GameObject, newId: ObjectId, m: PendingMeld): void {
  const o = g.s.objects[newId];
  const partner = g.s.objects[m.partner];
  if (!o || o.zone !== 'battlefield' || !partner) return;
  leaveWithoutObject(g, partner, newId);
  o.components = [
    { kind: 'card', defId: first.defId, ...(first.cardId !== undefined ? { cardId: first.cardId } : {}), owner: first.owner },
    { kind: 'card', defId: partner.defId, ...(partner.cardId !== undefined ? { cardId: partner.cardId } : {}), owner: partner.owner },
  ];
  o.defId = m.result; // CR 712.8g
  delete o.cardId;
  o.face = 0;
  g.emit({ type: 'melded', objectId: newId, from: [first.id, partner.id] });
}

/**
 * M11-1, CR 903.9c: is this the card of a melded or merged permanent its owner put into the command zone (CR 903.9b; `DestinationFacts.commanderCard`, set
 * by effects/rule-replacements/commander.ts)? Every other card goes where the permanent goes.
 */
const toCommand = (opts: MoveOptions, cardId: string | undefined): boolean => cardId !== undefined && opts.enter?.commanderCard === cardId;

/** M11-1, CR 903.9c: the new object made for the first or topmost card goes to the command zone instead (core/zones.ts reports the zone it ends in). */
function firstToCommand(g: Game, o: GameObject): void {
  const from = zoneArray(g, o.zone, o.owner);
  const at = from.indexOf(o.id);
  if (at >= 0) from.splice(at, 1);
  o.zone = 'command';
  o.controller = o.owner;
  o.tapped = false;
  g.s.zones.command.push(o.id);
}

/** CR 712.21: the melded permanent left: its new object is its first card, and each other card is an object of its own in its owner's zone. */
function split(g: Game, old: GameObject, newId: ObjectId, opts: MoveOptions): void {
  const o = g.s.objects[newId];
  const [first, ...others] = old.components!;
  if (!o || !first) return;
  o.kind = first.kind;
  o.defId = first.defId;
  if (first.cardId !== undefined) o.cardId = first.cardId;
  delete o.components;
  o.face = 0;
  const dest = o.zone;
  const also: ObjectId[] = [];
  for (const c of others) {
    const command = toCommand(opts, c.cardId); // M11-1: CR 903.9c
    const n = cardObject(g, c, command ? 'command' : dest);
    g.s.objects[n.id] = n;
    also.push(n.id);
    const zone = zoneArray(g, n.zone, c.owner);
    // next to the first card: the same position in a library (CR 712.21a: on top, on the bottom, or right below it at a given depth); last elsewhere
    const pos = opts.position ?? 'top';
    if (n.zone !== 'library' || pos === 'bottom') zone.push(n.id);
    else if (pos === 'top') zone.unshift(n.id);
    else zone.splice(Math.min(zone.length, Math.max(0, pos) + 1), 0, n.id);
    g.emit({ type: 'zoneChanged', oldId: n.id, newId: n.id, from: null, to: n.zone, owner: n.owner, controller: n.controller, name: g.nameOf(n.id), cause: command ? 'commander' : 'melded permanent left the battlefield' });
  }
  if (toCommand(opts, o.cardId)) firstToCommand(g, o); // M11-1: CR 903.9c
  const lki = g.s.lki[old.id];
  if (lki && also.length > 0) lki.alsoBecame = also; // CR 712.21c: an effect that finds the new object finds every card (moveObject wrote `newId` just before)
  const commander = opts.enter?.commanderCard !== undefined ? ', except its commander, which goes to the command zone (CR 903.9c)' : '';
  g.log(`The melded permanent leaves the battlefield as one permanent; its ${old.components!.length} cards are put into the ${dest}${commander}.`, { rules: ['CR 712.21'], level: 'info' });
}

/**
 * CR 730.3e: where a card component of a merged permanent that is a token goes: the destination the replacement effects give the card `card` put into `to`
 * from the battlefield (one that applied to the permanent's event applied already). While it is asked, `card` is an object on the battlefield in no zone list
 * (it never is a permanent, CR 730.3); it is then put into the zone returned. `shuffle`: the replacement says to shuffle it into its owner's library. Null:
 * where the permanent went. Installed by effects/merge-leave.ts (core may not import the proposal pipeline).
 */
export type ComponentDestination = (g: Game, card: ObjectId, to: ZoneKind, opts: MoveOptions) => { to: ZoneKind; position?: MoveOptions['position']; shuffle?: boolean } | null;
let componentDestination: ComponentDestination | null = null;
export function installComponentDestination(f: ComponentDestination | null): void {
  componentDestination = f;
}

/** Put a new object into its zone's list (a library at `position`: top by default; elsewhere last). */
function place(g: Game, n: GameObject, position: MoveOptions['position']): void {
  const zone = zoneArray(g, n.zone, n.owner);
  const pos = position ?? 'top';
  if (n.zone !== 'library' || pos === 'bottom') zone.push(n.id);
  else if (pos === 'top') zone.unshift(n.id);
  else zone.splice(Math.min(zone.length, Math.max(0, pos)), 0, n.id);
}

/** CR 730.3: a merged permanent left the battlefield: its new object is its topmost component, every other component an object of its own. */
function splitMerged(g: Game, old: GameObject, newId: ObjectId, opts: MoveOptions): void {
  const o = g.s.objects[newId];
  const [top, ...others] = old.components!;
  if (!o || !top) return;
  o.kind = top.kind; // CR 730.2d: the permanent's kind was the topmost component's
  o.defId = top.defId;
  if (top.cardId !== undefined) o.cardId = top.cardId;
  else delete o.cardId;
  delete o.components;
  const dest = o.zone;
  const also: ObjectId[] = [];
  for (const c of others) {
    const command = toCommand(opts, c.cardId); // M11-1: CR 903.9c
    const n = cardObject(g, c, command ? 'command' : dest);
    let position = opts.position;
    let shuffle = false;
    // CR 730.3e: a card component of a token merged permanent is moved by the replacement effects that apply to cards
    if (!command && old.kind === 'token' && c.kind === 'card' && componentDestination) {
      g.s.objects[n.id] = { ...n, zone: 'battlefield' };
      let d: ReturnType<ComponentDestination>;
      try {
        d = componentDestination(g, n.id, dest, opts);
      } finally {
        delete g.s.objects[n.id];
      }
      if (d) {
        n.zone = d.to;
        position = d.position;
        shuffle = d.shuffle === true;
      }
    }
    g.s.objects[n.id] = n;
    place(g, n, position);
    also.push(n.id);
    if (shuffle) g.log(`${g.nameOf(n.id)} is to be shuffled into its owner's library: shuffle that library by hand.`, { rules: ['CR 730.3e', 'CR 701.24a'], level: 'manual' });
    if (c.faceDown) g.log(`A face-down card of the merged permanent is revealed: it is ${g.nameOf(n.id)}.`, { rules: ['CR 708.9', 'CR 730.2e'], level: 'info' });
    g.emit({ type: 'zoneChanged', oldId: n.id, newId: n.id, from: null, to: n.zone, owner: n.owner, controller: n.controller, name: g.nameOf(n.id), cause: command ? 'commander' : 'merged permanent left the battlefield' });
  }
  if (toCommand(opts, o.cardId)) firstToCommand(g, o); // M11-1: CR 903.9c
  const lki = g.s.lki[old.id];
  if (lki && also.length > 0) lki.alsoBecame = also; // CR 730.3c
  g.log(`The merged permanent leaves the battlefield as one permanent; its ${old.components!.length} cards and tokens are each put into the appropriate zone.`, { rules: ['CR 730.3'], level: 'info' });
}

export const COMPONENTS_MOVE_PARTS: readonly MovePart[] = [
  {
    afterLeave: (g, old, newId, opts) => {
      if (!newId) return;
      const m = pending.get(g);
      if (m && m.from === old.id) return meld(g, old, newId, m);
      if (old.zone === 'battlefield' && isMergedObject(old)) return splitMerged(g, old, newId, opts); // M6-9: CR 730.3
      if (old.zone === 'battlefield' && old.components !== undefined && old.components.length > 1 && g.s.defs[old.defId]?.layout === 'meld') split(g, old, newId, opts);
    },
  },
];
