/**
 * References, handles and last known information (design 3.1). Owner: WP4.
 * Acting on a handle applies only if the object is still in the expected zone (CR 400.7); reading uses the snapshot when it left (CR 608.2h);
 * a move to a public zone re-bases the bindings (CR 400.7j).
 *
 * Division of labor with the handlers (WP10-WP15): `resolveObjs` says WHICH objects a reference stands for (illegal targets are not among them, CR 608.2b;
 * a handle whose object has since moved is still returned, because the part of the effect that reads it needs the last known information). Before ACTING on
 * a handle a handler checks `isCurrent` (or uses `currentObjs`); before READING it calls `readInfo`.
 */
import { EngineBug } from '../core/errors';
import { isPlayerOnlyRef, type EventPattern, type ObjRef, type PlayerRef, type Quantity, type Ref } from '../types/ability';
import { seatNeighbor } from '../statics/seats';
import { attachedPlayer } from '../statics/attached-player';
import type { ObjectId, PlayerId } from '../types/ids';
import type { EventContext, GameObject, LastKnown, LinkValue, ObjHandle, RoleValue, ZoneKind } from '../types/state';
import { attackerState } from '../rules/combat-state';
import { charsOfObject, controllerOf, type Chars } from '../rules/characteristics';
import { partnerOf } from '../statics/pairing';
import { readLinkOf } from '../statics/links';
import { findObjects, matchesFilter, type FilterContext, type FilterEnv, type RefValue } from '../rules/filter';
import { countHistory } from '../rules/history';
import { compareNumbers } from '../rules/predicates';
import { randomIndex } from '../rules/random';
import type { Binding, ExecCtx } from './api';

/**
 * Capability table (design 5.2): the `ref` discriminators `resolveObjs` / `resolvePlayers` / `resolveRecipients` handle. The object and player unions share the
 * names `target`, `each`, `event`, `bound`, `linked` and `fixed`; each name is implemented for both.
 */
/** audit-fix-1: the reference forms resolveObjs reads beyond the plain kinds (`feature:<name>`, model/capabilities.ts; model/cap-walk.ts emits them). */
export const REF_FEATURES: readonly string[] = ['ref.bound.which' /* audit-fix-1: CR 608.2h, 400.7 */, 'each.otherPlayer.castPlayer' /* edh-mana-keywords-7 */, 'ref.linked.except' /* edh-perms-21: all other tokens created with ~ */, 'ref.seat.chosen' /* edhd63: the next player in the chosen direction (CR 101.4, 607.2d) */, 'each.otherPlayer.than' /* edh-next-134: each player other than a named one (CR 102.1, 608.2c) */, 'ref.controlsAny.atLeast' /* edh-d-88: a player who controls N or more X (CR 109.4); also triggers/filters.ts */, 'ref.linked.ever' /* edh-d-96: every card ever exiled with ~ (CR 607.2a) */];

export const REF_RESOLVERS: Readonly<Record<string, true>> = {
  self: true, target: true, bound: true, event: true, attachedTo: true, linked: true, each: true, subject: true, topCards: true, union: true, fixed: true,
  you: true, controllerOf: true, ownerOf: true, anOpponent: true, active: true, defending: true, iterating: true,
  otherOpponents: true, // M6-12: myriad (CR 702.116a)
  costSacrificed: true, // FAST3 T18
  costTapped: true, // T35
  costBeheld: true, // std-rx28: what a behold cost revealed or chose (CR 701.4a)
  costChosenObject: true, // std-costs-2: what a chooseObject cost chose (CR 601.2b)
  costRevealed: true, // p2-refs-1: what a reveal cost revealed (CR 601.2b, 701.20a)
  costReturned: true, // std-rx28: what web-slinging or sneak returned (CR 702.188a)
  costExiled: true, // FAST5X E13: craft (CR 702.167a, 702.167c)
  costDiscarded: true, // CLOUD C8: "the discarded card" (CR 400.7j, 608.2h)
  costChosen: true, // FAST5X E1: the player chosen for an additional cost (gift, CR 702.174a)
  seat: true, // M12-1: "the player to your left / right" (m12 design D6; CR 101.4, 103.1)
  controlsMost: true, // C6: "each player who controls the most creatures" (CR 109.4, 101.4)
  controlsAny: true, // edh-perms-13: "each player who controls an artifact" (CR 109.4, 101.4)
  grantor: true, // r4-static: the object whose static ability grants the ability; statics/mods.ts#withGrantor writes it as `fixed` before any ability uses it
  voters: true, // M12F: "each opponent who voted for a choice you (didn't) vote for" (CR 701.38a)
  monarch: true, // edh-d-10: "the monarch" (CR 725.1)
  initiative: true, // edh-next-82: "the player who has the initiative" (CR 726.1)
  enchantedPlayer: true, // std-rr: "enchanted player", the player the source Aura is attached to (CR 303.4, 702.5a)
  otherOf: true, // std-rx30: "the other player" of a group (CR 608.2c)
  eachWho: true, // std-combat-1: "each opponent who attacked you ... this turn" (CR 608.2c, 508.1)
  chose: true, // edh-players-13: "each player who chose fame" (CR 608.2d)
  choseNumber: true, // edh-next-120: "each player who chose that number" after "the highest number" (CR 608.2d)
  attackedBySource: true, // edh-players-17: "each player this creature attacked this turn" (CR 506.3, 508.1)
  attacked: true, // edh-combat-6: "players being attacked" (CR 506.2, 506.3)
  votedFor: true, // edh-players-17: "for each money vote ... the voter" (CR 701.38a)
  convokers: true, // edh-mana-keywords-8: the creatures that convoked this spell (CR 702.51a)
  pair: true, // edh-top-2: the source creature and the creature it is paired with (CR 702.95b)
  randomOpponent: true, // trek-17: "a random opponent" (Alexander, Ship's Fool)
  withLife: true, // edh-next-72: "each player with exactly 13 life" (CR 119.1, 104.3b)
  costUnattached: true, // edh-next-141: the permanent an unattach cost unattached (CR 701.3d; Captain America, First Avenger)
  mostLife: true, // edh-d-85: "an opponent with the most life among your opponents" (CR 119.1, 102.3)
  grantCaster: true, // edh-next-146: "the player who cast ¤" (CR 601.2a, 611.2c): fixed by effects/handlers/lasting.ts#fixGrantCaster as a spell's effect is created, nobody anywhere else
};

// ---- the quantity evaluator is installed by effects/eval.ts (it needs these resolvers, so it cannot be imported here without a cycle) ----------------------

type QuantityEvaluator = (cx: ExecCtx, q: Quantity) => number | undefined;
let quantityEvaluator: QuantityEvaluator | null = null;

/** Called once by effects/eval.ts when it loads. A function registry, not game data: nothing about a game is cached here. */
export function installQuantityEvaluator(f: QuantityEvaluator): void {
  quantityEvaluator = f;
}

function quantity(cx: ExecCtx, q: Quantity): number | undefined {
  if (typeof q === 'number') return q;
  if (!quantityEvaluator) throw new EngineBug('effects/eval.ts is not loaded: import it before evaluating a quantity');
  return quantityEvaluator(cx, q);
}

// ---- handles ------------------------------------------------------------------------------------------------------------------------------------------------

/** Is the object of this handle still where the handle says it is (CR 400.7: otherwise it is a new object and the effect cannot find it)? */
export const isCurrent = (cx: ExecCtx, h: ObjHandle): boolean => cx.g.s.objects[h.id]?.zone === h.zone;

/** The handles of `hs` that can still be acted on. */
export const currentObjs = (cx: ExecCtx, hs: readonly ObjHandle[]): ObjHandle[] => hs.filter((h) => isCurrent(cx, h));

const handleOf = (o: GameObject): ObjHandle => ({ id: o.id, zone: o.zone });

function dedupe(hs: ObjHandle[]): ObjHandle[] {
  const seen = new Set<string>();
  return hs.filter((h) => {
    const k = `${h.id}@${h.zone}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const uniquePlayers = (ps: PlayerId[]): PlayerId[] => [...new Set(ps)];

/**
 * CR 712.21c: the other cards a melded permanent became as it left the battlefield (`LastKnown.alsoBecame`; `newId` is the first card), those still in `zone`
 * (the zone the first card went to). "If an effect can find the new object that a melded permanent becomes ..., it finds both cards."
 */
export function alsoBecameHandles(cx: ExecCtx, lki: LastKnown | undefined, zone: ZoneKind): ObjHandle[] {
  return (lki?.alsoBecame ?? []).flatMap((id) => (cx.g.s.objects[id]?.zone === zone ? [{ id, zone }] : []));
}

/** The source object as it is now, or as it last existed (CR 113.7a, 608.2h). */
export const sourceObject = (cx: ExecCtx): GameObject | undefined => cx.g.s.objects[cx.source.id] ?? cx.g.s.lki[cx.source.id]?.object;

/**
 * What the source's linked ability remembers (CR 607.1); reads last known information once the source has left. A value chosen during this resolution comes
 * first (FAST3 T13: `ExecCtx.choices`, CR 608.2d): it is the same value while the source is there, and the only one once it has left.
 */
export const linkValue = (cx: ExecCtx, link: string): LinkValue | undefined => cx.choices?.get(link) ?? readLinkOf(cx.g.s, sourceObject(cx), link); // edh-next-137: an emblem's `linksFrom` (statics/links.ts#readLinkOf)

function bindingOf(cx: ExecCtx, name: string): Binding {
  const b = cx.bindings.get(name);
  if (!b) throw new EngineBug(`The name "${name}" was never bound (design 3.1 rule 6)`);
  return b;
}

const roleOf = (cx: ExecCtx, role: Extract<ObjRef, { ref: 'event' }>['role']): RoleValue | undefined => cx.event?.roles[role];

/** The filter context a handler uses to run an `ObjectFilter` while resolving: "you" is the controller, "this" the source, references resolve through `cx`. */
export function filterCtxOf(cx: ExecCtx, followRevealed = false): FilterContext {
  return { you: cx.controller, sourceId: cx.source.id, env: filterEnvOf(cx, followRevealed), ...(cx.choices !== undefined && cx.choices.size > 0 ? { choices: cx.choices } : {}) };
}

/** How filters resolve the references and quantities they mention (`is`, `sharesWith`, `targets`, `controller: {ref}`, `power <= {q:...}`). */
export function filterEnvOf(cx: ExecCtx, followRevealed = false): FilterEnv {
  return {
    // `followRevealed`: the filter of an `each` over "the cards revealed this way" (zone 'any'), see `followRevealedBinding`
    refs: (ref): RefValue => followRevealed && ref.ref === 'bound' && (ref as { which?: unknown }).which === undefined ? { ...resolveRecipients(cx, ref), objects: followRevealedBinding(cx, ref.name) } : resolveRecipients(cx, ref),
    qty: (q) => quantity(cx, q),
  };
}

// ---- objects ----------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * r5-fxz (CR 400.7f, 704.5m): `{ref:'self', moved:true}`, the card an Aura became in its owner's graveyard after the permanent it enchanted left the battlefield.
 * The source handle is the Aura as it was on the battlefield; its new object is found only while it is still in the graveyard the move from the battlefield put
 * it in (a card that left that graveyard again is a new object, CR 400.7).
 */
function auraBecame(cx: ExecCtx): ObjHandle[] {
  const s = cx.g.s;
  const id = cx.source.id;
  if (s.objects[id] !== undefined) return []; // it never left the battlefield
  const lk = s.lki[id];
  const now = lk?.newId !== undefined ? s.objects[lk.newId] : undefined;
  if (lk === undefined || lk.leftZone !== 'battlefield' || now === undefined || now.zone !== 'graveyard') return [];
  return [{ id: now.id, zone: now.zone }];
}

/**
 * edh-zones-7 (CR 400.7j, 602.2b): "{1}, Discard this card: ... Shuffle this card into your library from your graveyard." (Kogla and Yidaro): the cost of an ability moved
 * its own source to a public zone (the discard), and the ability's effects can find that object. The card the discard made of the source, while it is still where the
 * discard put it; null when the source did not pay its way out of a hand (it is read as it is, or as it last existed).
 */
function costMovedSelf(cx: ExecCtx): ObjHandle[] | null {
  const s = cx.g.s;
  if (s.objects[cx.source.id] !== undefined) return null; // the source is still the object it was
  const became = s.lki[cx.source.id]?.newId;
  if (became === undefined) return null;
  const paid = (cx.stack?.costsPaid.discarded ?? []).find((h) => h.id === became);
  return paid !== undefined && paid.zone === 'graveyard' && s.objects[paid.id]?.zone === 'graveyard' ? [{ id: paid.id, zone: paid.zone }] : null; // (a replacement sent it elsewhere: it is not in the graveyard "from your graveyard" names)
}

/**
 * edh-next-146 (CR 400.7j, 602.2b, 603.7c; Plague Reaver: "Discard two cards, Sacrifice this creature: ... Return this creature to the battlefield ... at the beginning of their next
 * upkeep."): the card the cost of this ability made of its own source by sacrificing, exiling or discarding it (the cost moved it to a public zone, so the ability's effects can find it, CR 400.7j),
 * or the card the move that triggered this ability made of it (CR 400.7e),
 * while it is still where the cost put it; null when the source was not moved by the cost. Only for a move of the source a delayed trigger of this ability makes
 * (effects/handlers/lasting.ts#delay): every other read of "~" keeps the object as it last existed (CR 608.2h).
 */
export function costMovedSelfCard(cx: ExecCtx): ObjHandle[] | null {
  const s = cx.g.s;
  if (s.objects[cx.source.id] !== undefined || cx.stack === null) return null; // the source is still the object it was
  const became = s.lki[cx.source.id]?.newId;
  if (became === undefined) return null;
  const paid = cx.stack.costsPaid;
  const byCost = (paid.sacrificed ?? []).includes(cx.source.id) || paid.exiled?.self === became || (paid.discarded ?? []).some((h) => h.id === became);
  // CR 400.7e: or a triggered ability whose event is the move of the source itself ("When ~ dies, ... Return ~ to the battlefield ... at the beginning of their next upkeep")
  const ev = cx.stack.kind === 'triggered' ? cx.stack.event : undefined;
  const subj = ev?.ev === 'zoneChange' ? ev.roles.subject : undefined;
  const byEvent = subj !== undefined && 'objects' in subj && subj.objects.some((h) => h.id === cx.source.id || h.id === became);
  const now = s.objects[became];
  return (byCost || byEvent) && now !== undefined && (now.zone === 'graveyard' || now.zone === 'exile') ? [{ id: became, zone: now.zone }] : null;
}

/**
 * trek-17 (CR 701.20a, 608.2c, 400.7; Ambassador K'Ehleyr, Alexander, Ship's Fool): the cards a `reveal` step of this resolution revealed (`Binding.revealed`) stay "the cards revealed this
 * way" wherever the resolution moved them since ("each player reveals the top card of their library, then draws a card. For each nonland card revealed this way, ..."): each card that
 * left its zone is found again as the object it became (the last known information's `newId`, followed through later moves), in any zone; one that ceased to exist drops out.
 * Opt-in: only `{ref:'each', filter:{is:<that binding>, zone:'any'}}` (parser/holes/trek17.ts#where) follows; every other reference to a bound reveal ("put one of them into
 * your hand", "the rest") keeps the objects as they were bound, so a card moved on by the resolution is not part of them again.
 */
function followRevealedBinding(cx: ExecCtx, name: string): ObjHandle[] {
  const b = bindingOf(cx, name);
  if (b.revealed !== true) return b.objects;
  const s = cx.g.s;
  return dedupe(b.objects.flatMap((h): ObjHandle[] => {
    let id = h.id;
    for (let i = 0; i < 8 && s.objects[id] === undefined; i++) {
      const next = s.lki[id]?.newId;
      if (next === undefined) return [];
      id = next;
    }
    const o = s.objects[id];
    return o === undefined ? [] : [{ id, zone: o.zone }];
  }));
}

/**
 * The objects an object reference stands for: legal targets only (CR 608.2b), the bound objects, the objects a filter selects now, ... A handle may be stale
 * (the object moved during this resolution): reading it gives last known information (`readInfo`), acting on it does nothing (`isCurrent`).
 */
export function resolveObjs(cx: ExecCtx, ref: ObjRef): ObjHandle[] {
  const s = cx.g.s;
  switch (ref.ref) {
    case 'self': return 'moved' in ref ? auraBecame(cx) : costMovedSelf(cx) ?? [cx.source];
    case 'target': return (cx.targets.get(ref.id) ?? []).filter((t) => t.legal && t.handle !== null).map((t) => t.handle!);
    case 'bound': {
      const b = bindingOf(cx, ref.name);
      if (ref.which === undefined) return b.objects;
      // audit-fix-1 (CR 608.2h, 400.7): only those that matched `which` as they last existed before the binding step moved them (the binding's snapshot)
      const ctx = filterCtxOf(cx);
      return b.objects.filter((h) => {
        const lk = b.snapshots[h.id];
        const o = lk?.object ?? s.objects[h.id];
        return o !== undefined && matchesFilter(s, o, ref.which!, lk?.chars ? { ...ctx, chars: lk.chars } : ctx);
      });
    }
    case 'event': {
      const v0 = roleOf(cx, ref.role);
      if (!v0 || !('objects' in v0)) return [];
      // std-copy-6 (CR 603.3): "that ability" of an `abilityTriggered` event is the triggered ability on the stack the pending trigger became, if it is there
      const v = { objects: v0.objects.flatMap((h): ObjHandle[] => {
        if (!h.id.startsWith('pending:')) return [h];
        const pending = h.id.slice('pending:'.length);
        const on = s.zones.stack.find((id) => s.objects[id]?.stack?.pendingId === pending);
        return on === undefined ? [] : [{ id: on, zone: 'stack' }];
      }) };
      // CR 712.21c: the card a melded permanent became as it left ("return that card", False Demise) is every card it became
      const before = Object.values(cx.event?.before ?? {});
      return dedupe(v.objects.flatMap((h) => {
        const l = before.find((x) => x.newId === h.id && x.alsoBecame !== undefined);
        return l ? [h, ...alsoBecameHandles(cx, l, h.zone)] : [h];
      }));
    }
    case 'attachedTo': {
      // CR 303.4, 301.5: the permanent the source is attached to (a player, for "Enchant player", is not an object).
      const host = sourceObject(cx)?.attachedTo;
      const o = host ? s.objects[host] : undefined;
      return o ? [handleOf(o)] : [];
    }
    // FAST5X E25 (CR 607.2a, 400.7): "the exiled card" of an exile link refers only to a card still in the exile zone: one that left exile is a new object, so
    // nothing (not even its last known information, `readInfo`) stands for it any more (as `costExiled` below). Other linked handles are left as they are.
    case 'linked': {
      // edh-d-96 (CR 607.2a, 603.4; Colfenor's Urn ruling 2007-10-01): `ever`, every object the link has remembered, wherever it is now (counted only)
      if (ref.ever === true) return dedupe(linkValue(cx, ref.link)?.objects ?? []);
      const here = (linkValue(cx, ref.link)?.objects ?? []).filter((h) => h.zone !== 'exile' || s.objects[h.id]?.zone === 'exile');
      // edh-zones-24 (CR 607.2a): "the last creature card exiled with it": the most recently linked object that fits the description and is still where it was linked
      if (ref.last === undefined) {
        if (ref.except === undefined) return here;
        const out = new Set(resolveObjs(cx, ref.except).map((h) => h.id)); // edh-perms-21: "all other tokens created with ~"
        return here.filter((h) => !out.has(h.id));
      }
      const fit = new Set(findObjects(s, { zone: 'any', ...ref.last }, filterCtxOf(cx)).map((o) => o.id));
      const fits = here.filter((h) => s.objects[h.id]?.zone === h.zone && fit.has(h.id));
      return fits.length === 0 ? [] : [fits[fits.length - 1]!];
    }
    case 'each': {
      // edh-c-104 (CR 400.1, 608.2c; Thran Tome): a filter that names only the group of cards a reveal step bound ("one of those cards": the revealed top cards of a library) and no zone is
      // those cards wherever they are now (a library is no zone of a filter, rules/filter.ts#findIn); any other group stays a description of the battlefield
      const bare = ref.filter.zone === undefined && ref.filter.is?.ref === 'bound' && Object.keys(ref.filter).filter((k) => (ref.filter as Record<string, unknown>)[k] !== undefined).join() === 'is';
      if (bare && bindingOf(cx, (ref.filter.is as { name: string }).name).revealed === true) return followRevealedBinding(cx, (ref.filter.is as { name: string }).name); // (cards revealed this way, wherever they are now)
      return findObjects(s, ref.filter, filterCtxOf(cx, ref.filter.zone === 'any')).map(handleOf);
    }
    case 'pair': { // edh-top-2 (CR 702.95b-d): the source creature and its partner, both or none
      const me = sourceObject(cx);
      const mate = partnerOf(s, me);
      return me !== undefined && mate !== undefined ? [handleOf(me), handleOf(mate)] : [];
    }
    case 'subject': return cx.subject ? [cx.subject] : [];
    case 'topCards': {
      // std-rg (CR 401.1, 401.2): all but the bottom N cards of each library the reference names, top first
      if (ref.allButBottom !== undefined) {
        const keep = Math.max(0, Math.floor(ref.allButBottom));
        return resolvePlayers(cx, ref.player).flatMap((p) => { const lib = s.zones.library[p] ?? []; return lib.slice(0, Math.max(0, lib.length - keep)).map((id): ObjHandle => ({ id, zone: 'library' })); });
      }
      const n = quantity(cx, ref.count);
      if (n === undefined) return []; // fails to determine (CR 608.2b)
      const take = Math.max(0, Math.floor(n));
      // edh-c-73 (CR 404.1; Soldevi Digger): a graveyard is ordered, its top card the one put there last (core/move-parts/components.ts#place adds last); top first
      // edh-next-43 (CR 404.1; Phyrexian Furnace): the bottom card of a graveyard, the card put there first (zone lists end with the newest); bottom first
      // edhn78 (CR 404.1, 401.2; Shallow Grave): "the top creature card of your graveyard": the card put there last among those that fit (none: nothing)
      if (ref.zone === 'graveyard' && ref.matching !== undefined) {
        const fctx = filterCtxOf(cx);
        return resolvePlayers(cx, ref.player).flatMap((p) => {
          const gy = s.zones.graveyard[p] ?? [];
          const out: ObjHandle[] = [];
          for (let i = gy.length - 1; i >= 0 && out.length < take; i--) { const o = s.objects[gy[i]!]; if (o !== undefined && matchesFilter(s, o, ref.matching!, fctx)) out.push({ id: o.id, zone: 'graveyard' }); }
          return out;
        });
      }
      // edh-next-123 (CR 401.1, 401.2; Arvinox, the Mind Flail): the bottom card of a library, the last of its list (index 0 is the top), bottom first
      if (ref.zone !== 'graveyard' && ref.fromBottom === true) return resolvePlayers(cx, ref.player).flatMap((p) => { const lib = s.zones.library[p] ?? []; return lib.slice(Math.max(0, lib.length - take)).reverse().map((id): ObjHandle => ({ id, zone: 'library' })); });
      if (ref.zone === 'graveyard' && ref.fromBottom === true) return resolvePlayers(cx, ref.player).flatMap((p) => (s.zones.graveyard[p] ?? []).slice(0, take).map((id): ObjHandle => ({ id, zone: 'graveyard' })));
      if (ref.zone === 'graveyard') return resolvePlayers(cx, ref.player).flatMap((p) => { const gy = s.zones.graveyard[p] ?? []; return gy.slice(Math.max(0, gy.length - take)).reverse().map((id): ObjHandle => ({ id, zone: 'graveyard' })); });
      return resolvePlayers(cx, ref.player).flatMap((p) => (s.zones.library[p] ?? []).slice(0, take).map((id): ObjHandle => ({ id, zone: 'library' }))); // index 0 is the top (CR 401.5)
    }
    case 'union': return dedupe(ref.of.flatMap((r) => resolveObjs(cx, r)));
    // r4-static: the granting object of a granted ability (statics/mods.ts#withGrantor) is named as `self` names the source: a handle even once it left (CR 608.2h)
    case 'fixed': return ref.source === true ? ref.objects.map((h) => ({ id: h.id, zone: h.zone })) : fixedObjs(cx, ref.objects); // CR 611.2c; a moved object is a new one (CR 400.7)
    // FAST3 T18: the permanents sacrificed to pay this spell's or ability's cost, as handles on the battlefield objects they were: they left, so a read is last
    // known information (CR 608.2h, `readInfo`) and nothing can act on them (CR 400.7). A copy of a spell keeps the costs paid for the original (CR 707.10).
    case 'costSacrificed': if (ref.card === true) return (cx.stack?.costsPaid.costObjects ?? []).filter((id) => s.objects[id] !== undefined && s.objects[id]!.zone !== 'battlefield' && s.objects[id]!.zone !== 'stack').map((id): ObjHandle => ({ id, zone: s.objects[id]!.zone })); // trek-21 (CR 400.7j): the card the sacrifice made, where it is now
      return (cx.stack?.costsPaid.sacrificed ?? cx.manaPaid?.sacrificed ?? []).filter((id) => s.lki[id] !== undefined).map((id): ObjHandle => ({ id, zone: 'battlefield' }));
    // edh-mana-keywords-8 (CR 702.51a, 608.2h): the creatures tapped to convoke this spell, handles on the battlefield; one that has left is read as it last existed there
    // edh-d-9 (CR 702.51a, 400.7d; Venerated Loxodon): the permanent keeps the record of the spell it was, so its own enters trigger reads the creatures that convoked it too
    case 'convokers': return (cx.stack?.costsPaid.convoked ?? sourceObject(cx)?.cast?.costsPaid.convoked ?? []).filter((id) => s.objects[id]?.zone === 'battlefield' || s.lki[id] !== undefined).map((id): ObjHandle => ({ id, zone: 'battlefield' }));
    // T35 (station, CR 702.184a): the permanents tapped to pay this ability's cost: handles on the battlefield; one that has left is read as it last existed there (CR 608.2h)
    case 'costTapped': return (cx.stack?.costsPaid.tapped ?? []).filter((id) => s.objects[id]?.zone === 'battlefield' || s.lki[id] !== undefined).map((id): ObjHandle => ({ id, zone: 'battlefield' }));
    // edh-next-141 (CR 701.3d, 608.2h): the permanents unattached to pay this ability's cost: handles on the battlefield; one that has left is read as it last existed there
    case 'costUnattached': return (cx.stack?.costsPaid.unattached ?? []).filter((id) => s.objects[id]?.zone === 'battlefield' || s.lki[id] !== undefined).map((id): ObjHandle => ({ id, zone: 'battlefield' }));
    // std-rx28 (CR 701.4a, 608.2h): the card revealed from the hand or the permanent chosen to pay this spell's behold cost, where it was then; one that left that
    // zone is read as it last existed there (it is only ever read: "the power of the creature you chose or the card you revealed"). A copy keeps it (CR 707.10).
    case 'costBeheld': return (cx.stack?.costsPaid.beheld ?? []).filter((b) => b.id !== undefined && b.zone !== undefined && (s.objects[b.id]?.zone === b.zone || s.lki[b.id] !== undefined))
      .map((b): ObjHandle => ({ id: b.id!, zone: b.zone! }));
    // std-costs-2 (CR 601.2b, 608.2h): the object chosen to pay this spell's chooseObject cost, where it was then; one that left that zone is read as it last existed
    // there (it is only ever read: "the power of the chosen creature or card"). A copy keeps it (CR 707.10).
    case 'costChosenObject': return (cx.stack?.costsPaid.chosenObjects ?? []).filter((h) => s.objects[h.id]?.zone === h.zone || s.lki[h.id] !== undefined).map((h): ObjHandle => ({ id: h.id, zone: h.zone }));
    // p2-refs-1 (CR 701.20a, 608.2h): the card revealed to pay this spell's reveal cost, where it was then; one that left that zone is read as it last existed there
    // (it is only ever read: "the revealed card's mana value"). A copy keeps it (CR 707.10).
    case 'costRevealed': return (cx.stack?.costsPaid.revealed ?? []).filter((h) => s.objects[h.id]?.zone === h.zone || s.lki[h.id] !== undefined).map((h): ObjHandle => ({ id: h.id, zone: h.zone }));
    // std-rx28 (CR 702.188a, 608.2h, 400.7d): the permanent returned to its owner's hand to pay the cost of the spell this object is (or was: the cast record of the
    // permanent it became), as it last existed on the battlefield; only ever read ("the mana value of the returned creature")
    case 'costReturned': {
      const src = sourceObject(cx);
      const paid = src?.zone === 'stack' && src.stack && src.kind !== 'ability' ? src.stack.costsPaid : src?.cast?.costsPaid;
      if (cx.stack?.kind === 'activated' && (cx.stack.costsPaid.returned?.length ?? 0) > 0) return (cx.stack.costsPaid.returned ?? []).filter((id) => s.lki[id] !== undefined).map((id): ObjHandle => ({ id, zone: 'battlefield' })); // edh-d-46 (CR 118.3, 608.2h): the permanent this ability's own cost returned
      return (paid?.returned ?? []).filter((id) => s.lki[id] !== undefined).map((id): ObjHandle => ({ id, zone: 'battlefield' }));
    }
    // FAST5X E13 (craft, CR 702.167a, 702.167c): the cards this ability's cost exiled, as the cards they are in exile; one that left exile is a new object (CR 400.7)
    case 'costExiled': {
      const ex = cx.stack?.costsPaid.exiled ?? cx.manaPaid?.exiled; // edh-top-2 (CR 605.3b): a mana ability has no stack object; its cost's cards are kept by the activation
      const ids = ref.self ? (ex?.self !== undefined ? [ex.self] : []) : ex?.others ?? [];
      // CLOUD C8 (CR 608.2h): the other cards (an additional cost's "the exiled card", craft's materials) are only ever read: one that left exile is read from its last
      // known information ("the exiled card's power"), and nothing acts on it (CR 400.7; the parser never writes an instruction that does, lower/anaphora.ts)
      if (!ref.self) return ids.filter((id) => s.objects[id]?.zone === 'exile' || s.lki[id] !== undefined).map((id): ObjHandle => ({ id, zone: 'exile' }));
      return ids.filter((id) => s.objects[id]?.zone === 'exile').map((id): ObjHandle => ({ id, zone: 'exile' }));
    }
    // CLOUD C8 (CR 400.7j, 608.2h): the cards this spell's or ability's cost discarded, as the cards they became where the discard put them: one still there is
    // read and acted on there, one that left is read from its last known information there and acted on nowhere (CR 400.7). A copy keeps them (CR 707.10).
    // r4-static (CR 201.5a, 613.1f): the layer that grants the ability writes the granting object as `fixed` (statics/mods.ts#withGrantor), so an ability that still
    // holds `grantor` was never granted (the lint refuses that in card data): it names nothing
    case 'grantor': return [];
    case 'costDiscarded': return (cx.stack?.costsPaid.discarded ?? []).filter((h) => s.objects[h.id]?.zone === h.zone || s.lki[h.id] !== undefined).map((h): ObjHandle => ({ id: h.id, zone: h.zone }));
  }
}

/**
 * Standard round 3, r3-fx (CR 603.7c, 608.2b, 608.2h): the objects a delayed or reflexive ability fixed (`bakeSteps`) are checked once, as that ability starts to
 * resolve, like the targets of any ability: one no longer in the zone it was expected in is a new object and the ability does nothing to it (CR 603.7c, 400.7).
 * One that an instruction of this same resolution moved stays named by a stale handle, so a later instruction reads its last known information ("sacrifice it.
 * If you do, you gain life equal to its toughness", CR 608.2h) and acts on nothing (`isCurrent`), exactly as a target that moved during the resolution. Only
 * for a stack object's resolution (`stackId`); anything else (a replacement body, a continuous effect's set) keeps the zone check at every read.
 */
const fixedAtStart = new WeakMap<ExecCtx, Map<string, ObjHandle[]>>();
function fixedObjs(cx: ExecCtx, objects: readonly { id: string; zone: ZoneKind }[]): ObjHandle[] {
  const s = cx.g.s;
  const now = (): ObjHandle[] => objects.filter((h) => s.objects[h.id]?.zone === h.zone).map((h) => ({ id: h.id, zone: h.zone }));
  if (cx.stackId === null) return now();
  let seen = fixedAtStart.get(cx);
  if (!seen) fixedAtStart.set(cx, (seen = new Map()));
  const key = objects.map((h) => `${h.id}@${h.zone}`).join(',');
  const known = seen.get(key);
  if (known) return [...known];
  const out = now();
  seen.set(key, out);
  return [...out];
}

// ---- players ----------------------------------------------------------------------------------------------------------------------------------------------------

/** The player a multiplayer "an opponent" stands for is chosen once per resolution (CR 601.7a). */
const opponentChoices = new WeakMap<ExecCtx, PlayerId>();
const randomOpponents = new WeakMap<ExecCtx, PlayerId>(); // trek-17: the opponent "a random opponent" picked in this resolution

/** The players a player reference stands for. Players who have lost the game are never part of "each player" (CR 800.4a). */
export function resolvePlayers(cx: ExecCtx, ref: PlayerRef): PlayerId[] {
  const g = cx.g;
  switch (ref.ref) {
    case 'you': return [cx.controller];
    case 'target': return (cx.targets.get(ref.id) ?? []).filter((t) => t.legal && t.player !== undefined).map((t) => t.player!);
    case 'controllerOf': {
      const controllers = resolveObjs(cx, ref.object).flatMap((h) => { const i = readInfo(cx, h); return i ? [controllerOfInfo(i)] : []; }); // last known information (CR 608.2h)
      // edh-d-29 (CR 608.2h, 303.4; Strangling Grasp): "enchanted permanent's controller sacrifices a nonland permanent of their choice, then that player loses 1 life": when the permanent the
      // source is attached to was itself sacrificed, its controller is read from last known information, so "that player" is still the same player
      if (controllers.length === 0 && ref.object.ref === 'attachedTo') { const gone = attachedHostLki(cx); if (gone) controllers.push(controllerOfInfo(gone)); }
      // edh-d-5 (CR 115.1, 109.4; Acorn Catapult, Rakdos's Return): "that permanent's controller or that player": the player chosen as that target, if one was
      const chosenPlayers = ref.orPlayer === true && ref.object.ref === 'target' ? (cx.targets.get(ref.object.id) ?? []).filter((t) => t.legal && t.player !== undefined).map((t) => t.player!) : [];
      return uniquePlayers([...controllers, ...chosenPlayers]);
    }
    case 'ownerOf': return uniquePlayers(resolveObjs(cx, ref.object).flatMap((h) => { const i = readInfo(cx, h); return i ? [i.object.owner] : []; })); // CR 108.3
    case 'anOpponent': {
      const opponents = g.opponents(cx.controller).map((p) => p.id);
      if (opponents.length <= 1) return opponents;
      let chosen = opponentChoices.get(cx);
      if (chosen === undefined) {
        const ans = g.choose({
          kind: 'chooseOption', player: cx.controller, prompt: 'Choose an opponent.', min: 1, max: 1,
          options: opponents.map((id) => ({ id, label: g.player(id).name })), rules: ['CR 601.7a'],
        });
        chosen = ans.ids[0] ?? opponents[0]!;
        opponentChoices.set(cx, chosen);
      }
      return [chosen];
    }
    // trek-17 (Alexander, Ship's Fool: "deals X damage to a random opponent"): one opponent of the controller, picked with the game's random number generator (design 8.8 rule 2);
    // nobody chooses. No opponent left (CR 800.4a): nobody.
    case 'randomOpponent': {
      const except = ref.than !== undefined ? resolvePlayers(cx, ref.than) : []; // edh-top-14 (Maddening Hex): "another one of your opponents"
      const opponents = g.opponents(cx.controller).map((p) => p.id).filter((p) => !except.includes(p));
      if (opponents.length === 0) return [];
      let picked = randomOpponents.get(cx);
      if (picked === undefined) { picked = opponents[randomIndex(g, opponents.length)]!; randomOpponents.set(cx, picked); } // (the same opponent every time this resolution says "that player")
      return [picked];
    }
    case 'each': {
      // active player first (CR 101.4, 608.2e): 'opponent' is the players other than the controller; 'otherPlayer' the players other than the one the ability is about:
      // edh-mana-keywords-7 (CR 603.2, 601.2i; Zenith Chronicler): in a trigger on a spell being cast ("whenever a player casts ..., each other player draws a card") the player
      // who cast it, otherwise the controller (model/cap-walk.ts allows only cast events for another player there, `feature:each.otherPlayer.castPlayer`)
      const caster = ref.who === 'otherPlayer' && cx.event?.ev === 'cast' ? roleOf(cx, 'player') : undefined;
      const except = caster !== undefined && 'players' in caster && caster.players.length === 1 ? caster.players[0] : cx.controller;
      // edh-next-134 (CR 102.1, 608.2c; Oft-Nabbed Goat): "its owner draws ... and each other player loses ...": the players other than the one `than` names
      if (ref.who === 'otherPlayer' && ref.than !== undefined) { const than = resolvePlayers(cx, ref.than); return g.apnap().filter((p) => !than.includes(p)); }
      return g.apnap().filter((p) => ref.who === 'player' || p !== except);
    }
    case 'event': {
      const v = roleOf(cx, ref.role);
      if (v && 'players' in v) return v.players;
      // CLOUD std-misc (CR 506.2, 508.5): the defender of an attack read as a PLAYER while a planeswalker or battle is attacked ("it deals damage to defending
      // player equal to the number of artifacts they control") is the defending player of that attack (the planeswalker's controller, the battle's protector)
      if (ref.role === 'defender' && v && 'objects' in v) {
        const att = roleOf(cx, 'attacker');
        const ps = att && 'objects' in att ? att.objects.flatMap((h) => { const a = attackerState(cx.g.s, h.id); return a ? [a.defendingPlayer] : []; }) : [];
        if (ps.length > 0) return uniquePlayers(ps);
        return uniquePlayers(v.objects.flatMap((h) => { const o = cx.g.s.objects[h.id]; return o ? [o.protector ?? o.controller] : []; }));
      }
      return [];
    }
    case 'bound': return bindingOf(cx, ref.name).players;
    case 'linked': return linkValue(cx, ref.link)?.players ?? [];
    // CR 102.1. M12-2 (m12 design E22): CR 800.4j, an active player who left the game leaves a turn "without an active player": nobody
    case 'active': return g.s.options.multiplayer !== undefined && g.player(g.s.turn.activePlayer).hasLost ? [] : [g.s.turn.activePlayer];
    case 'grantCaster': return []; // edh-next-146 (CR 611.2c): written as `fixed` by effects/handlers/lasting.ts#fixGrantCaster as the effect is created; read anywhere else it is nobody
    case 'defending': return defendingPlayers(cx); // CR 506.2
    case 'otherOpponents': { // M6-12: "each opponent other than defending player" (CR 702.116a, 506.2), APNAP order (CR 101.4)
      // FAST4 T25: "each other opponent": other than the players `than` names (the opponent the trigger's event was about, CR 102.3, 603.2)
      const defending = ref.than !== undefined ? resolvePlayers(cx, ref.than) : defendingPlayers(cx);
      return g.apnap().filter((p) => p !== cx.controller && !defending.includes(p));
    }
    case 'iterating': return typeof cx.iterating === 'string' ? [cx.iterating] : [];
    // std-rr (CR 303.4, 702.5a, 608.2h): "enchanted player", the player the source Aura is attached to (as it last existed on the battlefield once it left, as
    // `attachedTo` reads "enchanted creature"); nobody when it is attached to an object or to nothing
    case 'enchantedPlayer': return attachedPlayer(g.s, sourceObject(cx));
    // edh-d-10 (CR 725.1, 725.2): "the monarch", the one player with the designation (nobody when there is none or the monarch has left the game, CR 800.4)
    case 'monarch': { const m = g.s.designations.monarch; return m !== undefined && !g.player(m).hasLost ? [m] : []; }
    // edh-next-82 (CR 726.1, 800.4): "the player who has the initiative", the one player with the designation (nobody when there is none)
    case 'initiative': { const m = g.s.designations.initiative; return m !== undefined && !g.player(m).hasLost ? [m] : []; }
    case 'chose': { // edh-players-13 (CR 608.2d, 101.4): the players whose own choice for the link was the value, in APNAP order, still in the game
      const by = linkValue(cx, ref.link)?.byPlayer ?? {};
      return g.apnap().filter((p) => by[p] === ref.value && !g.player(p).hasLost);
    }
    case 'choseNumber': { // edh-next-120 (CR 608.2d, 101.4; Wheel of Misfortune): the choosers whose number was the highest (lowest) of all the numbers chosen, or with `not` the other choosers
      const by = linkValue(cx, ref.link)?.byPlayer ?? {};
      const nums = Object.values(by).map(Number).filter((n) => Number.isInteger(n));
      if (nums.length === 0) return [];
      const edge = ref.extreme === 'highest' ? Math.max(...nums) : Math.min(...nums);
      return g.apnap().filter((p) => by[p] !== undefined && Number.isInteger(Number(by[p])) && (Number(by[p]) === edge) !== (ref.not === true) && !g.player(p).hasLost);
    }
    case 'otherOf': { // std-rx30 (CR 608.2c): "the other player", the players of `of` other than the ones `than` names
      const than = resolvePlayers(cx, ref.than);
      return resolvePlayers(cx, ref.of).filter((p) => !than.includes(p));
    }
    case 'fixed': return [...ref.players];
    case 'costChosen': { // FAST5X E1: "the chosen player" of gift (CR 702.174a, 702.174d-i), from the spell's choices or the permanent's cast record (CR 607.2i-j, 400.7d)
      const src = sourceObject(cx);
      const paid = src?.zone === 'stack' && src.stack && src.kind !== 'ability' ? src.stack.costsPaid : src?.cast?.costsPaid;
      const p = paid?.chosenPlayers?.[ref.name];
      return p !== undefined && g.s.players.some((x) => x.id === p) ? [p] : [];
    }
    case 'seat': { // M12-1 (m12 design D6): the next / previous player in turn order still in the game, from `of` (you by default; CR 101.4, 103.1)
      const from = ref.of !== undefined ? resolvePlayers(cx, ref.of) : [cx.controller];
      const chosenSide = ref.chosen === undefined ? ref.side : linkValue(cx, ref.chosen)?.values?.[0]; // edhd63: "the next player in the chosen direction"
      if (chosenSide !== 'left' && chosenSide !== 'right') return [];
      const side = ref.inverse === true ? (chosenSide === 'left' ? 'right' : 'left') : chosenSide;
      return uniquePlayers(from.flatMap((p) => { const n = seatNeighbor(g.s, p, side); return n !== undefined ? [n] : []; }));
    }
    case 'controlsMost': { // C6: "each player who controls the most creatures" / "the fewest": every player tied for it, in APNAP order (CR 101.4, 109.4)
      const players = g.apnap();
      const found = findObjects(g.s, { ...ref.filter, zone: 'battlefield' }, filterCtxOf(cx)).filter((o) => !o.phasedOut); // CR 702.26b: phased out, treated as though it doesn't exist
      const counts = players.map((p) => found.filter((o) => controllerOf(g.s, o) === p).length); // CR 613.1b: the controller after layer 2
      const best = ref.fewest === true ? Math.min(...counts) : Math.max(...counts);
      if (ref.below === true) return players.filter((_, i) => counts[i]! < Math.max(...counts)); // edh-d-46: fewer than the player who controls the most
      return players.filter((_, i) => counts[i] === best);
    }
    case 'controlsAny': { // edh-perms-13: "each player who controls an artifact or enchantment": the players who control at least one such permanent, in APNAP order (CR 101.4, 109.4)
      const found = findObjects(g.s, { ...ref.filter, zone: 'battlefield' }, filterCtxOf(cx)).filter((o) => !o.phasedOut); // CR 702.26b
      const held = (p: PlayerId): boolean => found.filter((o) => controllerOf(g.s, o) === p).length >= (ref.atLeast ?? 1); // edh-d-88: at least `atLeast` of them
      return g.apnap().filter((p) => held(p) !== (ref.none === true) && (ref.opponents !== true || p !== cx.controller)); // edh-players-15: `opponents`; edh-d-4: `none`, the players who control no such permanent
    }
    case 'eachWho': { // std-combat-1 (CR 608.2c, 102.1): the players of `who` who did it in the scope's history, in APNAP order (CR 101.4)
      // pc-combat-1 (CR 508.1, 506.4): `attacking` is live: who controls a creature attacking that player now, as the effect resolves
      if (ref.scope === 'attacking') {
        const d = ref.did.ev === 'attacks' ? ref.did.defender : undefined;
        if (d === undefined || d === 'planeswalker' || d === 'battle') return [];
        const found = findObjects(g.s, { types: ['Creature'], zone: 'battlefield', attacking: { defender: d } }, filterCtxOf(cx));
        const owners = new Set(found.map((o) => controllerOf(g.s, o)));
        return g.apnap().filter((p) => (ref.who === 'player' || p !== cx.controller) && owners.has(p));
      }
      const env = { you: cx.controller, sourceId: cx.source.id, resolvePlayers: (r: PlayerRef) => resolvePlayers(cx, r) };
      const did: EventPattern = ref.did.ev === 'damage' && ref.did.amount === undefined ? { ...ref.did, amount: { op: '>=', value: 1 } } : ref.did; // edh-d-86 (CR 120.8): damage of 0 is no damage dealt
      return g.apnap().filter((p) => (ref.who === 'player' || p !== cx.controller) && countHistory(g.s, did, (ref.scope as 'turn' | 'game'), { ref: 'fixed', players: [p] }, env) > 0);
    }
    case 'mostLife': { // edh-d-85 (CR 119.1, 102.3): the controller's opponents still in the game tied for the most life among them, in APNAP order
      const opp = g.apnap().filter((p) => p !== cx.controller && !g.player(p).hasLost);
      const top = Math.max(...opp.map((p) => g.player(p).life));
      return opp.filter((p) => g.player(p).life === top);
    }
    case 'withLife': // edh-next-72 (CR 119.1, 104.3b, 101.4, 608.2h): the players of the group whose life total compares with the fixed number now, in APNAP order, still in the game
      return g.apnap().filter((p) => (ref.who === 'player' || p !== cx.controller) && !g.player(p).hasLost && compareNumbers(ref.op, g.player(p).life, ref.n));
    case 'votedFor': { // edh-players-17 (CR 701.38a, 701.38d, 800.4a): the players who cast each vote for the choice, once per vote, in the order cast; none for a vote resolved by hand
      const cast = cx.results.get(ref.votes.step)?.voters?.get(ref.votes.choice) ?? [];
      return cast.filter((p) => !g.player(p).hasLost);
    }
    case 'attacked': { // edh-combat-6 (CR 506.2, 506.3, 508.1b, 101.4): the players a creature now in combat attacks (not those who only control an attacked planeswalker or protect an attacked battle), in APNAP order
      const attacked = new Set<PlayerId>();
      // edh-next-82 (CR 508.1b; Undercellar Sweep): `by: 'you'`, "a player you're attacking": only the players the controller's creatures attack
      for (const a of g.s.combat?.attackers ?? []) if (typeof a.defender === 'string' && g.s.players.some((p) => p.id === a.defender) && (ref.by !== 'you' || g.s.objects[a.id]?.controller === cx.controller)) attacked.add(a.defender as PlayerId);
      if (ref.andYou === true) attacked.add(cx.controller); // edh-next-82: "you or a player you're attacking"
      return g.apnap().filter((p) => attacked.has(p) && !g.player(p).hasLost);
    }
    case 'attackedBySource': { // edh-players-17 (CR 506.3, 508.1, 608.2c, 101.4): the players the source creature attacked in a declare attackers step this turn, in APNAP order
      // The history entry of an attack names its subject (the attacker's id, still the id after it left, CR 400.7) and, only for an attack on a player, defenderKind 'player'.
      const id = cx.source.id;
      const attacked = new Set<PlayerId>();
      for (const e of g.s.history) {
        if (e.ev !== 'attacks' || e.turn !== g.s.turn.number || e.subject !== id || e.facts['defenderKind'] !== 'player') continue;
        const d = e.facts['defendingPlayer'];
        if (typeof d === 'string') attacked.add(d);
      }
      return g.apnap().filter((p) => attacked.has(p) && !g.player(p).hasLost);
    }
    case 'voters': {
      const voters = votersOf(cx, ref.agree);
      // M12 gaps: "you and each opponent who voted for ...": the controller with them, in APNAP order (CR 101.4)
      return ref.andYou === true ? g.apnap().filter((p) => p === cx.controller || voters.includes(p)) : voters;
    }
  }
}

/** The players the controller named for a `voters` reference whose ballots the engine does not know, once per resolution and reading. */
const voterChoices = new WeakMap<ExecCtx, Map<boolean, PlayerId[]>>();

/**
 * M12F (CR 701.38a, 701.38d): the opponents who voted for at least one choice among (`agree`) or outside (not `agree`) the controller's own votes, in APNAP
 * order (CR 101.4), from the ballots of the trigger's `votesFinished` event. A player who left the game is no opponent any more (CR 800.4a). When the ballots
 * are not known (the vote was resolved by hand, or the reference is read outside that trigger), the controller says who they are: never a guess.
 */
function votersOf(cx: ExecCtx, agree: boolean): PlayerId[] {
  const g = cx.g;
  const opponents = g.apnap().filter((p) => p !== cx.controller && !g.player(p).hasLost);
  const ballots = cx.event?.ballots;
  if (ballots !== undefined) {
    const mine = new Set(ballots.filter((b) => b.voter === cx.controller).flatMap((b) => b.votes));
    const theirs = (p: PlayerId): string[] => ballots.filter((b) => b.voter === p).flatMap((b) => b.votes);
    return opponents.filter((p) => theirs(p).some((v) => mine.has(v) === agree));
  }
  let byReading = voterChoices.get(cx);
  if (byReading === undefined) voterChoices.set(cx, (byReading = new Map()));
  const known = byReading.get(agree);
  if (known !== undefined) return known;
  const what = agree ? 'a choice you voted for' : "a choice you didn't vote for";
  const ans = opponents.length === 0 ? { ids: [] as string[] } : g.choose({
    kind: 'chooseOption', player: cx.controller, prompt: `The votes were cast by hand: choose each opponent who voted for ${what}.`, min: 0, max: opponents.length,
    options: opponents.map((id) => ({ id, label: g.player(id).name })), rules: ['CR 701.38a'],
  });
  const chosen = opponents.filter((p) => ans.ids.includes(p));
  byReading.set(agree, chosen);
  return chosen;
}

/** CR 506.2: the defending player is the player the creature attacks (or whose planeswalker / battle it attacks); in a two-player game, the opponent of the active player. */
function defendingPlayers(cx: ExecCtx): PlayerId[] {
  const s = cx.g.s;
  const attackers: ObjectId[] = [cx.source.id];
  const ev = cx.event?.roles.attacker;
  if (ev && 'objects' in ev) attackers.push(...ev.objects.map((h) => h.id));
  // edh-next-99 (CR 802.2a, 506.2; Kusari-Gama): an Equipment's trigger on the damage its equipped creature dealt: the defending player is the one that creature attacks (the damage source of the event, or
  // the creature this source is attached to), tried only after the source itself and the event's attacker
  const dealt = cx.event?.roles.source;
  if (dealt && 'objects' in dealt) attackers.push(...dealt.objects.map((h) => h.id));
  const host = sourceObject(cx)?.attachedTo;
  if (host !== undefined) attackers.push(host);
  for (const id of attackers) {
    const a = attackerState(s, id);
    if (a) return [a.defendingPlayer];
  }
  if (s.combat && s.players.length === 2) return s.players.filter((p) => p.id !== s.turn.activePlayer).map((p) => p.id);
  if (s.combat && s.options.multiplayer !== undefined) return [chosenDefendingPlayer(cx)].filter((p): p is PlayerId => p !== undefined);
  return [];
}

/** The defending player chosen for a spell or ability once per resolution (CR 508.5a), like "an opponent" (CR 601.7a). */
const defendingChoices = new WeakMap<ExecCtx, PlayerId>();

/**
 * M12-2 (m12 design D5, E21): CR 508.5a, 802.2a, "If there are multiple defending players that could be chosen, the controller of the spell or ability
 * chooses one." With the attack multiple players option every opponent of the active player still in the game is a defending player (CR 802.2); the
 * controller is asked only when there are two or more (D13).
 */
function chosenDefendingPlayer(cx: ExecCtx): PlayerId | undefined {
  const g = cx.g;
  const ap = g.s.turn.activePlayer;
  const candidates = g.apnap().filter((p) => p !== ap);
  if (candidates.length <= 1) return candidates[0];
  let chosen = defendingChoices.get(cx);
  if (chosen === undefined) {
    const ans = g.choose({
      kind: 'chooseOption', player: cx.controller, prompt: 'Choose a defending player.', min: 1, max: 1,
      options: candidates.map((id) => ({ id, label: g.player(id).name })), rules: ['CR 508.5a', 'CR 802.2a'],
    });
    chosen = candidates.find((p) => p === ans.ids[0]) ?? candidates[0]!;
    defendingChoices.set(cx, chosen);
  }
  return chosen;
}

/** edh-d-29: the last known information of the permanent the source is (still) recorded as attached to, once it has left the battlefield (CR 608.2h). */
function attachedHostLki(cx: ExecCtx): LastKnown | undefined {
  const host = sourceObject(cx)?.attachedTo;
  return host !== undefined && cx.g.s.objects[host] === undefined ? cx.g.s.lki[host] : undefined;
}
const controllerOfInfo = (i: LastKnown): PlayerId => (i.chars as (Chars & { controller?: PlayerId }) | null)?.controller ?? i.object.controller; // layer 2 (WP9) adds `Chars.controller`

// ---- both --------------------------------------------------------------------------------------------------------------------------------------------------------

/** Something damage or counters can be directed at: objects and players. */
export function resolveRecipients(cx: ExecCtx, ref: Ref): { objects: ObjHandle[]; players: PlayerId[] } {
  if (isPlayerOnlyRef(ref)) return { objects: [], players: resolvePlayers(cx, ref) }; // M12-1: the one table of player-only references (m12 design 4.3)
  switch (ref.ref) {
    // edh-mana-keywords-9 (CR 115.4, 608.2b; Comet Storm): a union of targets is the recipients of each member: a target of "any target" may be a player
    case 'union': {
      const parts = ref.of.map((m) => resolveRecipients(cx, m as Ref));
      const players = parts.flatMap((p) => p.players);
      return { objects: dedupe(parts.flatMap((p) => p.objects)), players: players.filter((id, i) => players.indexOf(id) === i) };
    }
    case 'self': case 'attachedTo': case 'pair': case 'subject': case 'topCards': case 'costSacrificed': case 'convokers': case 'costTapped': case 'costBeheld': case 'costChosenObject': case 'costRevealed': case 'costReturned': case 'costExiled': case 'costDiscarded': case 'grantor': case 'costUnattached':
      return { objects: resolveObjs(cx, ref), players: [] };
    case 'each':
      return 'filter' in ref ? { objects: resolveObjs(cx, ref), players: [] } : { objects: [], players: resolvePlayers(cx, ref) };
    case 'fixed':
      return 'objects' in ref ? { objects: resolveObjs(cx, ref), players: [] } : { objects: [], players: resolvePlayers(cx, ref) };
    case 'target': case 'event': case 'bound': case 'linked':
      return { objects: resolveObjs(cx, { ...ref } as ObjRef), players: resolvePlayers(cx, { ...ref } as PlayerRef) };
  }
}

// ---- last known information -----------------------------------------------------------------------------------------------------------------------------

const sameHandle = (a: ObjHandle, b: ObjHandle): boolean => a.id === b.id && a.zone === b.zone;

/**
 * CR 603.10a, 608.2h: the information a look-back event recorded about the object that an event role stands for. The role holds the object in its NEW zone (a
 * creature that died is the card in the graveyard), the event's `before` holds what it was on the battlefield. Only a handle that comes from the event role is
 * read this way: the same card chosen as a target later is a card in a graveyard, read as it is now. (A handle of the role's own object instance is the event's;
 * a copy of it is too, unless a target slot holds the same object.)
 * AF2 (FINAL6 D1): the context holds the snapshot of an event that put an object onto the battlefield only when the trigger looks back at that event
 * (triggers/context.ts#contextOf, `lookBackApplies`): an enters trigger reads its permanent as it is now (CR 608.2h, 603.10a), not the spell it was.
 */
function lookBackInfo(cx: ExecCtx, handle: ObjHandle): LastKnown | undefined {
  const ev = cx.event;
  if (!ev) return undefined;
  const roles = Object.values(ev.roles).flatMap((v) => (v && 'objects' in v ? [v.objects] : []));
  const ownInstance = roles.some((hs) => hs.includes(handle));
  // CR 712.21c: another card a melded permanent of the role became (the event role expands to it, `resolveObjs`) reads what the melded permanent was
  const melded = Object.values(ev.before).find((l) => l.alsoBecame?.includes(handle.id) === true && roles.some((hs) => hs.some((h) => h.id === l.newId)));
  if (!ownInstance) {
    if (!melded && !roles.some((hs) => hs.some((h) => sameHandle(h, handle)))) return undefined;
    for (const slots of cx.targets.values()) if (slots.some((t) => t.handle !== null && sameHandle(t.handle, handle))) return undefined;
  }
  return ev.before[handle.id] ?? Object.values(ev.before).find((l) => l.newId === handle.id) ?? melded;
}

/**
 * What the engine knew about the object when the handle was bound or when it left its zone (design 3.1 rule 3, CR 608.2h): the last known information of the
 * object a look-back event is about (`lookBackInfo`) or of the object a re-based binding used to be (`rebase`: the snapshot kept under the new id, whose
 * `leftZone` differs from the handle's zone); otherwise the object as it is if the handle is still current (`leftZone` is then just the handle's zone);
 * otherwise the last known information the zone change recorded; otherwise the snapshot some binding took; otherwise nothing (the part of the effect that needs it
 * "fails to determine", CR 608.2b).
 */
export function readInfo(cx: ExecCtx, handle: ObjHandle): LastKnown | undefined {
  const s = cx.g.s;
  const looked = lookBackInfo(cx, handle);
  if (looked) return looked;
  for (const b of cx.bindings.values()) {
    const snap = b.snapshots[handle.id];
    if (snap && snap.leftZone !== handle.zone && b.objects.some((h) => sameHandle(h, handle))) return snap; // the object this one became (rebase)
  }
  const cur = s.objects[handle.id];
  if (cur && cur.zone === handle.zone) return { object: cur, chars: cur.kind === 'ability' ? null : charsOfObject(s, cur), leftZone: handle.zone };
  const lki = s.lki[handle.id];
  if (lki) return lki;
  for (const b of cx.bindings.values()) {
    const snap = b.snapshots[handle.id];
    if (snap) return snap;
  }
  return undefined;
}

// ---- re-basing -----------------------------------------------------------------------------------------------------------------------------------------------

const PUBLIC_ZONES: readonly ZoneKind[] = ['battlefield', 'graveyard', 'stack', 'exile', 'command']; // CR 400.2

/**
 * CR 400.7j: after a move to a PUBLIC zone, every binding that contains `from` points to `to`, the object it became (design 3.1 rule 2, D7). `to` is `null` when
 * the object ceased to exist (a token left the battlefield, CR 111.7): it drops out of the bindings. A move to a hand or a library does not re-base: those are
 * new hidden objects the rest of the effect cannot find, so the call does nothing. Target handles are not bindings and never re-base (rule 4). The last known
 * information of `from` (what it was when it moved: its controller, its counters, its power with them; CR 608.2h) is kept in the binding's snapshots under the
 * id of `to`, so "its controller" / "its power" read after "exile it" still say what they said before. It is not kept when `to` is on the battlefield or the
 * stack: there the object has current information of its own (a returned permanent, CR 400.7j). CR 712.21c: a melded permanent became every one of its cards
 * (`alsoBecameHandles`): the binding holds each of them, all reading the same last known information (one object moved, CR 712.21e).
 */
export function rebase(cx: ExecCtx, from: ObjectId, to: ObjHandle | null): void {
  if (to !== null && !PUBLIC_ZONES.includes(to.zone)) return;
  const became = to === null ? [] : [to, ...alsoBecameHandles(cx, cx.g.s.lki[from], to.zone)];
  for (const b of cx.bindings.values()) {
    if (!b.objects.some((h) => h.id === from)) continue;
    const lki = cx.g.s.lki[from] ?? b.snapshots[from];
    if (to !== null && lki && to.zone !== 'battlefield' && to.zone !== 'stack') for (const h of became) b.snapshots[h.id] = lki;
    b.objects = dedupe(b.objects.flatMap((h) => (h.id !== from ? [h] : became)));
  }
  // FAST5X E12, CR 400.7j: the object a trigger's event names ("it", "this card") is found by the rest of the same effect after the effect moved it to a public
  // zone ("When this creature dies, you may exile it and collect evidence 4. If you do, return this card to the battlefield": the card in exile). The event
  // context of this resolution gets a copy with the new handle; the stored event is never edited.
  // CR 608.2h: reads of the role ("its power", "that creature's toughness", "its controller") still use what the object was before this move: the information
  // the old handle read (the event's look-back snapshot, or the last known information of the move) is recorded in the copy's `before` under each new id
  // (`lookBackInfo`), as `b.snapshots` does for bindings; not on the battlefield or the stack, where the object has current information of its own (CR 400.7j).
  // An object that ceased to exist (`to === null`, CR 111.7) keeps its old handle: nothing can find it, and reads still give its last known information.
  const ev = cx.event;
  if (to !== null && ev && Object.values(ev.roles).some((v) => v !== undefined && 'objects' in v && v.objects.some((h) => h.id === from))) {
    let info: LastKnown | undefined;
    for (const v of Object.values(ev.roles)) {
      const h = v && 'objects' in v ? v.objects.find((x) => x.id === from) : undefined;
      if (h) { info = readInfo(cx, h); break; }
    }
    const before = { ...ev.before };
    if (info && to.zone !== 'battlefield' && to.zone !== 'stack') for (const h of became) before[h.id] = info;
    const roles: EventContext['roles'] = {};
    for (const [k, v] of Object.entries(ev.roles) as [keyof EventContext['roles'], RoleValue | undefined][]) {
      if (v === undefined) continue;
      roles[k] = 'objects' in v && v.objects.some((h) => h.id === from) ? { objects: dedupe(v.objects.flatMap((h) => (h.id !== from ? [h] : became))) } : v;
    }
    cx.event = { ...ev, roles, before };
  }
}
