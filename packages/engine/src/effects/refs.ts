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
import { isPlayerOnlyRef, type ObjRef, type PlayerRef, type Quantity, type Ref } from '../types/ability';
import { seatNeighbor } from '../statics/seats';
import { attachedPlayer } from '../statics/attached-player';
import type { ObjectId, PlayerId } from '../types/ids';
import type { EventContext, GameObject, LastKnown, LinkValue, ObjHandle, RoleValue, ZoneKind } from '../types/state';
import { attackerState } from '../rules/combat-state';
import { charsOfObject, controllerOf, type Chars } from '../rules/characteristics';
import { findObjects, matchesFilter, type FilterContext, type FilterEnv, type RefValue } from '../rules/filter';
import { countHistory } from '../rules/history';
import type { Binding, ExecCtx } from './api';

/**
 * Capability table (design 5.2): the `ref` discriminators `resolveObjs` / `resolvePlayers` / `resolveRecipients` handle. The object and player unions share the
 * names `target`, `each`, `event`, `bound`, `linked` and `fixed`; each name is implemented for both.
 */
/** audit-fix-1: the reference forms resolveObjs reads beyond the plain kinds (`feature:<name>`, model/capabilities.ts; model/cap-walk.ts emits them). */
export const REF_FEATURES: readonly string[] = ['ref.bound.which' /* audit-fix-1: CR 608.2h, 400.7 */];

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
  grantor: true, // r4-static: the object whose static ability grants the ability; statics/mods.ts#withGrantor writes it as `fixed` before any ability uses it
  voters: true, // M12F: "each opponent who voted for a choice you (didn't) vote for" (CR 701.38a)
  enchantedPlayer: true, // std-rr: "enchanted player", the player the source Aura is attached to (CR 303.4, 702.5a)
  otherOf: true, // std-rx30: "the other player" of a group (CR 608.2c)
  eachWho: true, // std-combat-1: "each opponent who attacked you ... this turn" (CR 608.2c, 508.1)
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
export const linkValue = (cx: ExecCtx, link: string): LinkValue | undefined => cx.choices?.get(link) ?? sourceObject(cx)?.links?.[link];

function bindingOf(cx: ExecCtx, name: string): Binding {
  const b = cx.bindings.get(name);
  if (!b) throw new EngineBug(`The name "${name}" was never bound (design 3.1 rule 6)`);
  return b;
}

const roleOf = (cx: ExecCtx, role: Extract<ObjRef, { ref: 'event' }>['role']): RoleValue | undefined => cx.event?.roles[role];

/** The filter context a handler uses to run an `ObjectFilter` while resolving: "you" is the controller, "this" the source, references resolve through `cx`. */
export function filterCtxOf(cx: ExecCtx): FilterContext {
  return { you: cx.controller, sourceId: cx.source.id, env: filterEnvOf(cx), ...(cx.choices !== undefined && cx.choices.size > 0 ? { choices: cx.choices } : {}) };
}

/** How filters resolve the references and quantities they mention (`is`, `sharesWith`, `targets`, `controller: {ref}`, `power <= {q:...}`). */
export function filterEnvOf(cx: ExecCtx): FilterEnv {
  return {
    refs: (ref): RefValue => resolveRecipients(cx, ref),
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
 * The objects an object reference stands for: legal targets only (CR 608.2b), the bound objects, the objects a filter selects now, ... A handle may be stale
 * (the object moved during this resolution): reading it gives last known information (`readInfo`), acting on it does nothing (`isCurrent`).
 */
export function resolveObjs(cx: ExecCtx, ref: ObjRef): ObjHandle[] {
  const s = cx.g.s;
  switch (ref.ref) {
    case 'self': return 'moved' in ref ? auraBecame(cx) : [cx.source];
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
    case 'linked': return (linkValue(cx, ref.link)?.objects ?? []).filter((h) => h.zone !== 'exile' || s.objects[h.id]?.zone === 'exile');
    case 'each': return findObjects(s, ref.filter, filterCtxOf(cx)).map(handleOf);
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
      return resolvePlayers(cx, ref.player).flatMap((p) => (s.zones.library[p] ?? []).slice(0, take).map((id): ObjHandle => ({ id, zone: 'library' }))); // index 0 is the top (CR 401.5)
    }
    case 'union': return dedupe(ref.of.flatMap((r) => resolveObjs(cx, r)));
    // r4-static: the granting object of a granted ability (statics/mods.ts#withGrantor) is named as `self` names the source: a handle even once it left (CR 608.2h)
    case 'fixed': return ref.source === true ? ref.objects.map((h) => ({ id: h.id, zone: h.zone })) : fixedObjs(cx, ref.objects); // CR 611.2c; a moved object is a new one (CR 400.7)
    // FAST3 T18: the permanents sacrificed to pay this spell's or ability's cost, as handles on the battlefield objects they were: they left, so a read is last
    // known information (CR 608.2h, `readInfo`) and nothing can act on them (CR 400.7). A copy of a spell keeps the costs paid for the original (CR 707.10).
    case 'costSacrificed': return (cx.stack?.costsPaid.sacrificed ?? []).filter((id) => s.lki[id] !== undefined).map((id): ObjHandle => ({ id, zone: 'battlefield' }));
    // T35 (station, CR 702.184a): the permanents tapped to pay this ability's cost: handles on the battlefield; one that has left is read as it last existed there (CR 608.2h)
    case 'costTapped': return (cx.stack?.costsPaid.tapped ?? []).filter((id) => s.objects[id]?.zone === 'battlefield' || s.lki[id] !== undefined).map((id): ObjHandle => ({ id, zone: 'battlefield' }));
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
      return (paid?.returned ?? []).filter((id) => s.lki[id] !== undefined).map((id): ObjHandle => ({ id, zone: 'battlefield' }));
    }
    // FAST5X E13 (craft, CR 702.167a, 702.167c): the cards this ability's cost exiled, as the cards they are in exile; one that left exile is a new object (CR 400.7)
    case 'costExiled': {
      const ex = cx.stack?.costsPaid.exiled;
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

/** The players a player reference stands for. Players who have lost the game are never part of "each player" (CR 800.4a). */
export function resolvePlayers(cx: ExecCtx, ref: PlayerRef): PlayerId[] {
  const g = cx.g;
  switch (ref.ref) {
    case 'you': return [cx.controller];
    case 'target': return (cx.targets.get(ref.id) ?? []).filter((t) => t.legal && t.player !== undefined).map((t) => t.player!);
    case 'controllerOf': return uniquePlayers(resolveObjs(cx, ref.object).flatMap((h) => { const i = readInfo(cx, h); return i ? [controllerOfInfo(i)] : []; })); // last known information (CR 608.2h)
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
    case 'each': return g.apnap().filter((p) => ref.who === 'player' || p !== cx.controller); // active player first (CR 101.4, 608.2e): 'opponent' and 'otherPlayer' are the players other than the controller
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
      return uniquePlayers(from.flatMap((p) => { const n = seatNeighbor(g.s, p, ref.side); return n !== undefined ? [n] : []; }));
    }
    case 'controlsMost': { // C6: "each player who controls the most creatures" / "the fewest": every player tied for it, in APNAP order (CR 101.4, 109.4)
      const players = g.apnap();
      const found = findObjects(g.s, { ...ref.filter, zone: 'battlefield' }, filterCtxOf(cx)).filter((o) => !o.phasedOut); // CR 702.26b: phased out, treated as though it doesn't exist
      const counts = players.map((p) => found.filter((o) => controllerOf(g.s, o) === p).length); // CR 613.1b: the controller after layer 2
      const best = ref.fewest === true ? Math.min(...counts) : Math.max(...counts);
      return players.filter((_, i) => counts[i] === best);
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
      return g.apnap().filter((p) => (ref.who === 'player' || p !== cx.controller) && countHistory(g.s, ref.did, (ref.scope as 'turn'), { ref: 'fixed', players: [p] }, env) > 0);
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

const controllerOfInfo = (i: LastKnown): PlayerId => (i.chars as (Chars & { controller?: PlayerId }) | null)?.controller ?? i.object.controller; // layer 2 (WP9) adds `Chars.controller`

// ---- both --------------------------------------------------------------------------------------------------------------------------------------------------------

/** Something damage or counters can be directed at: objects and players. */
export function resolveRecipients(cx: ExecCtx, ref: Ref): { objects: ObjHandle[]; players: PlayerId[] } {
  if (isPlayerOnlyRef(ref)) return { objects: [], players: resolvePlayers(cx, ref) }; // M12-1: the one table of player-only references (m12 design 4.3)
  switch (ref.ref) {
    case 'self': case 'attachedTo': case 'subject': case 'topCards': case 'union': case 'costSacrificed': case 'costTapped': case 'costBeheld': case 'costChosenObject': case 'costRevealed': case 'costReturned': case 'costExiled': case 'costDiscarded': case 'grantor':
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
