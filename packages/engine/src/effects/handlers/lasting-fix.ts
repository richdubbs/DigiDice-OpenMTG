/**
 * What a resolved effect remembers (design 9.1, 3.4; CR 611.2c-d, 608.2h, 603.7c). Owner: WP15.
 *
 * `fixNode` turns a piece of a `StaticEffect` (or a duration) into the form the `effect` handler stores: every quantity outside a `{q:'live'}` wrapper replaced by
 * its number (CR 611.2d) and every reference to specific objects or players (`target`, `bound`, `event`, `linked`, `self`, `attachedTo`, `topCards`, and the
 * player references) replaced by `{ref:'fixed'}`. Where the affected set of an effect that changes characteristics or control is locked (CR 611.2c) the caller
 * asks for it with `lockSet`, which also evaluates an `each` filter once. Three modes, by position:
 *   - TOP:  the effect itself: everything is fixed (an `each` filter stays live: a rule-modifying effect affects newcomers too, CR 611.2c second sentence);
 *   - COND: inside a condition, an event pattern or a `live` quantity, which are judged later and must stay live: only the identities and the values that exist
 *           only during this resolution (X, `let` variables, step results, target counts, the die result) are fixed;
 *   - STEP: inside instructions that run later (a replacement's `instead`, a prevention's `then`): only `target` and `bound` (names of this resolution) and the
 *           resolution-local values; `event` and "that much" there are the event that is replaced, so they are left alone.
 * Nested abilities (granted, emblem, token abilities) are never entered: `self` there is the object that has them.
 *
 * `prepareDeferred` does the same for the instructions of a delayed or reflexive triggered ability (CR 603.7c, 603.12): what they say about this resolution is fixed
 * now; the names of bound objects are left to `triggers/delayed.ts#bakeSteps`, which turns them into handles with the zone each object is expected in. A
 * characteristic, a counter count, "its controller" or "its owner" of an object of this resolution that only last known information still describes (a
 * countered spell, a sacrificed creature, a binding re-based after a move) is read NOW (CR 608.2h): the deferred ability could not find that information.
 * An object still where it is expected is read when the deferred ability resolves, as it is then.
 */
import { isPlayerOnlyRefKind, type ChosenWord, type Duration, type Modification, type ObjRef, type PlayerPred, type PlayerRef, type Quantity, type TypeChange } from '../../types/ability';
import type { Color } from '../../types/mana';
import type { PlayerId } from '../../types/ids';
import type { ObjHandle } from '../../types/state';
import type { ExecCtx } from '../api';
import { EXTRA_TURN_VAR, evalQty } from '../eval';
import { isCurrent, linkValue, readInfo, resolveObjs, resolvePlayers } from '../refs';

/** A quantity that fails to determine (CR 608.2b): the part of the effect that needs it does nothing. */
export class FailsToDetermine extends Error {
  constructor(what: string) {
    super(`The value of ${what} can't be determined.`);
    this.name = 'FailsToDetermine';
  }
}

interface Mode {
  q: 'all' | 'local';
  refs: 'all' | 'local';
}
export const TOP: Mode = { q: 'all', refs: 'all' };
export const COND: Mode = { q: 'local', refs: 'all' };
const STEP: Mode = { q: 'local', refs: 'local' };

/** Quantities that exist only while this resolution runs (design 3.4): they can never be evaluated later, so they are fixed in every position. */
const LOCAL_Q: ReadonlySet<string> = new Set(['X', 'var', 'resultCount', 'targetCount', 'dieResult', 'excessDamage' /* FAST5X E16 */, 'lifeLost', 'countersRemoved' /* std-rx14 */, 'votes' /* M12-3 */, 'damageDealt' /* std-rx20 */, 'chosenNumber' /* CLOUD std-misc */]);
const ABILITY_KINDS: ReadonlySet<string> = new Set(['spell', 'activated', 'triggered', 'static', 'keyword', 'chapter', 'classLevel', 'levelBracket', 'manual']);
const CMP: ReadonlySet<string> = new Set(['<=', '>=', '==', '!=', '<', '>']);
const OBJ_ONLY: ReadonlySet<string> = new Set(['self', 'attachedTo', 'topCards', 'union', 'subject']);

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isAbility = (o: Rec): boolean => typeof o['kind'] === 'string' && ABILITY_KINDS.has(o['kind']) && typeof o['text'] === 'string';
const isStep = (o: Rec): boolean => typeof o['op'] === 'string' && !CMP.has(o['op']) && !('q' in o) && !('cond' in o);

/** Does this node mention the object a continuous effect is currently modifying ("its power")? Such a quantity is evaluated per object (CR 611.2d). */
export function mentionsSubject(x: unknown): boolean {
  if (Array.isArray(x)) return x.some(mentionsSubject);
  if (!isRec(x)) return false;
  if (isAbility(x)) return false;
  if (x['ref'] === 'subject') return true;
  if (x['q'] === 'live') return false;
  return Object.values(x).some(mentionsSubject);
}

const fixedObjects = (hs: readonly ObjHandle[]): ObjRef => ({ ref: 'fixed', objects: hs.map((h) => ({ id: h.id, zone: h.zone })) });
const fixedPlayers = (ps: readonly PlayerId[]): PlayerRef => ({ ref: 'fixed', players: [...new Set(ps)] });

/** The objects (current ones only: a moved object is a new one, CR 400.7) or players a reference stands for right now, as a fixed reference. */
function fixRef(cx: ExecCtx, ref: ObjRef | PlayerRef): ObjRef | PlayerRef {
  const r = ref.ref;
  if (r === 'fixed' || r === 'subject') return ref;
  if (r === 'each') return 'who' in ref ? fixedPlayers(resolvePlayers(cx, ref as PlayerRef)) : fixedObjects(resolveObjs(cx, ref as ObjRef).filter((h) => isCurrent(cx, h)));
  if (OBJ_ONLY.has(r)) return fixedObjects(resolveObjs(cx, ref as ObjRef).filter((h) => isCurrent(cx, h)));
  if (isPlayerOnlyRefKind(r)) return fixedPlayers(resolvePlayers(cx, ref as PlayerRef)); // M12-1: the one table of player-only references (types/ability.ts)
  // target, event, bound, linked: an object or a player reference, depending on what it stands for
  const players = playerSlot(cx, ref) ? resolvePlayers(cx, ref as PlayerRef) : [];
  if (players.length > 0) return fixedPlayers(players);
  // audit-fix-1 (CR 609.7a, 608.2h): a chosen source stands for the object even once it has left its zone: its handles are kept (`source`, effects/refs.ts) and
  // read by last known information ("that source's controller")
  if (r === 'bound' && cx.bindings.get((ref as { name: string }).name)?.keepsLeft === true) {
    const hs = resolveObjs(cx, ref as ObjRef).filter((h) => isCurrent(cx, h) || (cx.g.s.objects[h.id] === undefined && cx.g.s.lki[h.id] !== undefined));
    return { ref: 'fixed', objects: hs.map((h) => ({ id: h.id, zone: h.zone })), source: true };
  }
  return fixedObjects(resolveObjs(cx, ref as ObjRef).filter((h) => isCurrent(cx, h)));
}

/**
 * CLOUD std-msh (CR 608.2h, 707.2): what a copy effect copies. Unlike the objects an effect changes, the object copied may have left its zone earlier in this
 * resolution ("exile up to one target creature until this Aura leaves the battlefield. Enchanted creature becomes a copy of that creature ...", Secret
 * Invasion): the effect needs information from it, so its last known information is used, and the handle is kept for effects/copy.ts#objectAt, which reads
 * `lki`. An object with no last known information (or a target never chosen) stands for nothing, as before.
 */
function fixCopied(cx: ExecCtx, ref: ObjRef, mode: Mode): ObjRef {
  if (ref.ref === 'fixed' || ref.ref === 'each' || ref.ref === 'union' || ref.ref === 'subject') return fixInside(cx, ref as unknown as Rec, mode) as unknown as ObjRef;
  return fixedObjects(resolveObjs(cx, ref).filter((h) => isCurrent(cx, h) || cx.g.s.lki[h.id] !== undefined));
}

/** Does a `target` / `event` / `bound` / `linked` reference stand for players? */
function playerSlot(cx: ExecCtx, ref: ObjRef | PlayerRef): boolean {
  switch (ref.ref) {
    case 'target': {
      const spec = cx.program.targets.find((t) => t.id === ref.id);
      if (spec?.kind === 'player') return true;
      return (cx.targets.get(ref.id) ?? []).some((t) => t.player !== undefined);
    }
    case 'event': {
      const v = cx.event?.roles[ref.role];
      return v !== undefined && 'players' in v;
    }
    case 'bound': {
      const b = cx.bindings.get(ref.name);
      return b !== undefined && b.players.length > 0 && b.objects.length === 0;
    }
    case 'linked': {
      const v = linkValue(cx, ref.link);
      return v !== undefined && (v.players?.length ?? 0) > 0 && (v.objects?.length ?? 0) === 0;
    }
    default:
      return false;
  }
}

function fixQuantity(cx: ExecCtx, q: Exclude<Quantity, number>, mode: Mode): Quantity {
  if (q.q === 'live') return { q: 'live', value: fixNode(cx, q.value, COND) }; // live: the identities only (a granted CDA keeps counting, CR 611.2d)
  const evaluateNow = mode.q === 'all' ? !mentionsSubject(q) || cx.subject !== undefined : LOCAL_Q.has(q.q);
  if (!evaluateNow) return fixInside(cx, q, mode) as Quantity;
  const n = evalQty(cx, q);
  if (n === undefined) throw new FailsToDetermine(JSON.stringify(q)); // CR 608.2b
  return n;
}

function fixInside(cx: ExecCtx, o: Rec, mode: Mode): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(o)) out[k] = slotted(k, fixNode(cx, v, mode));
  return out;
}

/**
 * PUSH1 T2 (CR 115.4): a reference to "any target" fixed in an object position (a filter's `is`) or a player position (`player`) when the target is the
 * other kind stands for nothing there: an object filter never matches a player, a player predicate never matches an object ("prevent the next 2 damage
 * that would be dealt to any target" names one target in both parts of the recipient, and one part is empty once it is fixed).
 */
function slotted(key: string, v: unknown): unknown {
  if (!isRec(v) || v['ref'] !== 'fixed') return v;
  if (key === 'is' && 'players' in v) return { ref: 'fixed', objects: [] };
  if (key === 'player' && 'objects' in v) return { ref: 'fixed', players: [] };
  return v;
}

/**
 * std-rB (CR 614.1a, 608.2c, 400.7): the names a replacement body binds only when it applies (`modify.then.as`, effects/bodies/m5.ts#thenAfterMove: the object
 * the modified move put in its new zone). Inside that body they stay names: there is nothing to fix them to as the lasting effect is created. Set while the body
 * is being fixed (fixNode is synchronous).
 */
const LATER_NAMES = new Set<string>();

/** See the file comment. Pure with respect to the state (it reads, never writes); throws `FailsToDetermine`. */
export function fixNode<T>(cx: ExecCtx, node: T, mode: Mode): T {
  if (Array.isArray(node)) return node.map((x) => fixNode(cx, x, mode)) as T;
  if (!isRec(node)) return node;
  if (isAbility(node)) return node; // a nested ability has its own context
  if (node['b'] === 'modify' && isRec(node['then']) && typeof node['then']['as'] === 'string' && !LATER_NAMES.has(node['then']['as'])) {
    const name = node['then']['as'];
    LATER_NAMES.add(name);
    try {
      return fixInside(cx, node, mode) as T;
    } finally {
      LATER_NAMES.delete(name);
    }
  }
  if (node['ref'] === 'bound' && LATER_NAMES.has(node['name'] as string)) return node;
  if (typeof node['q'] === 'string') return fixQuantity(cx, node as unknown as Exclude<Quantity, number>, mode) as T;
  if (node['layer'] === '1a' && isRec(node['copyOf']) && mode.refs === 'all') {
    const { copyOf, ...rest } = node;
    return { ...fixInside(cx, rest, mode), copyOf: fixCopied(cx, copyOf as unknown as ObjRef, mode) } as T;
  }
  if (typeof node['ref'] === 'string') {
    const ref = node as unknown as ObjRef | PlayerRef;
    if (mode.refs === 'local' && ref.ref !== 'target' && ref.ref !== 'bound') return fixInside(cx, node, mode) as T;
    if (ref.ref === 'each' || ref.ref === 'union' || ref.ref === 'subject' || ref.ref === 'fixed') return fixInside(cx, node, mode) as T; // `each` stays live (CR 611.2c)
    return fixRef(cx, ref) as T;
  }
  if (typeof node['cond'] === 'string') {
    if (node['cond'] === 'did') return didConstant(cx, node['step'] as string, node['not'] === true) as T; // a result of this resolution (CR 608.2c)
    return fixInside(cx, node, mode.refs === 'local' ? STEP : COND) as T;
  }
  if (typeof node['ev'] === 'string') return fixInside(cx, node, mode.refs === 'local' ? STEP : COND) as T; // an event pattern is matched later
  if (isStep(node)) return fixInside(cx, node, STEP) as T;
  return fixInside(cx, node, mode) as T;
}

/** CR 105.1: a chosen color as a color letter ("white" or "W"). */
const COLOR_OF: Readonly<Record<string, Color>> = { w: 'W', u: 'U', b: 'B', r: 'R', g: 'G', white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/**
 * FAST3 T13 (CR 608.2h, 611.2c): a resolved effect that changes types or colors to "the ... of your choice" (`chosen` link of layer 4 or 5) stores the values
 * chosen as it is created, never the link: a later choice of the same source (a second activation) must not change an effect that already began. With
 * `chosenSets` the values replace the old ones of their class (`set`); otherwise they are added, as the layer functions read a link (statics/mods.ts).
 */
export function fixChosen(cx: ExecCtx, mods: Modification[]): Modification[] {
  const values = (link: string): string[] => linkValue(cx, link)?.values ?? [];
  const typeChange = (t: TypeChange | undefined): TypeChange | undefined => {
    if (t?.chosen === undefined) return t;
    const { chosen, chosenSets, ...rest } = t;
    const picked = values(chosen);
    if (picked.length === 0) return rest;
    return chosenSets === true ? { ...rest, set: [...(rest.set ?? []), ...picked] } : { ...rest, add: [...(rest.add ?? []), ...picked] };
  };
  return mods.map((m): Modification => {
    if (m.layer === 4) {
      const out: Modification = { layer: 4 };
      for (const k of ['types', 'subtypes', 'supertypes'] as const) {
        const t = typeChange(m[k]);
        if (t !== undefined) out[k] = t;
      }
      if (m.named !== undefined) out.named = m.named; // FAST5 T69
      return out;
    }
    if (m.layer === 3) {
      // M6-8 (CR 608.2h, 612.2): "replacing all instances of one color word with another": the words chosen as the spell resolved, stored as words (a later
      // choice under the same link must not change an effect that already began). A word nobody chose stays a choice, which statics/text-change.ts reads as
      // undetermined (no change).
      const word = (w: string | ChosenWord): string | ChosenWord => (typeof w === 'string' ? w : values(w.chosen)[0] ?? w);
      return { layer: 3, changeWord: { ...m.changeWord, from: word(m.changeWord.from), to: word(m.changeWord.to) } };
    }
    if (m.layer === 5 && m.colors.chosen !== undefined) {
      const { chosen, ...rest } = m.colors;
      const picked = values(chosen).flatMap((v) => { const c = COLOR_OF[v.trim().toLowerCase()]; return c ? [c] : []; });
      if (picked.length === 0) return { layer: 5, colors: rest };
      return { layer: 5, colors: rest.set === undefined && rest.add === undefined ? { ...rest, set: picked } : { ...rest, add: [...(rest.add ?? []), ...picked] } };
    }
    if (m.layer === 6 && m.add?.some((d) => d.kind === 'keyword' && d.quality?.startsWith('chosen:') === true)) {
      // MX2 (CR 607.2d, 608.2h, 611.2c): "gain protection from the chosen color": the color chosen now, stored as the quality itself; nothing chosen, no keyword
      const add = m.add.flatMap((d) => {
        if (d.kind !== 'keyword' || d.quality?.startsWith('chosen:') !== true) return [d];
        const link = d.quality.slice('chosen:'.length);
        const picked = link === 'color' || link.endsWith('#color') ? values(link).flatMap((v) => { const c = COLOR_OF[v.trim().toLowerCase()]; return c ? [c] : []; }) : [];
        return picked.map((c) => ({ ...d, quality: `color:${c}` }));
      });
      return { ...m, add };
    }
    return m;
  });
}

/** `{cond:'did'}` about a step of this resolution, as a condition that always says the same: `all` of nothing is true, `any` of nothing is false. */
function didConstant(cx: ExecCtx, step: string, not: boolean): Rec {
  const did = (cx.results.get(step)?.performed ?? false) !== not;
  return did ? { cond: 'all', of: [] } : { cond: 'any', of: [] };
}

/**
 * CR 611.2c: the set an effect that changes characteristics or control affects, determined once, now (an `each` filter included). Players stay players.
 * Returns the fixed reference and whether it is empty.
 */
export function lockSet(cx: ExecCtx, affects: ObjRef | PlayerRef): { ref: ObjRef | PlayerRef; empty: boolean } {
  const ref = fixRef(cx, affects);
  const empty = 'players' in ref ? ref.players.length === 0 : ref.ref === 'fixed' && 'objects' in ref ? ref.objects.length === 0 : false;
  return { ref, empty };
}

/** A player predicate as stored: "you", "an opponent" and "any" stay relative to the record's controller; a reference ("that player", "target player") is fixed. */
export function fixPlayerPred(cx: ExecCtx, p: PlayerPred | undefined): PlayerPred | undefined {
  return p !== undefined && typeof p === 'object' ? fixedPlayers(resolvePlayers(cx, p)) : p;
}

/** A duration as stored: its player and condition identities fixed (CR 611.2a), its condition itself left live. */
export function fixDuration(cx: ExecCtx, d: Duration): Duration {
  switch (d.d) {
    case 'untilNextTurn': return { d: 'untilNextTurn', whose: fixedPlayers(resolvePlayers(cx, d.whose)) };
    case 'endOfNextTurn': return { d: 'endOfNextTurn', whose: fixedPlayers(resolvePlayers(cx, d.whose)) }; // FAST5X E29
    case 'untilNextStep': return d.whose !== undefined && typeof d.whose === 'object' ? { ...d, whose: fixedPlayers(resolvePlayers(cx, d.whose)) } : d;
    case 'throughNextUntap': return d.whose !== undefined && typeof d.whose === 'object' ? { ...d, whose: fixedPlayers(resolvePlayers(cx, d.whose)) } : d; // MX5
    case 'asLongAs': return { d: 'asLongAs', cond: fixNode(cx, d.cond, COND) };
    case 'whileObject': return { ...d, object: lockSet(cx, d.object).ref as ObjRef, ...(d.to !== undefined ? { to: lockSet(cx, d.to).ref as ObjRef } : {}) }; // std-rx32 (CR 611.2b, 611.2c): that object, fixed now; std-combat-1: and what it is attached to
    case 'until': return { d: 'until', event: fixNode(cx, d.event, COND) };
    // audit-fix-2 (CR 500.7, 611.2a): "During that turn": the extra turn this resolution created (none: -1, it never applies)
    case 'duringNextTurn': return { d: 'duringNextTurn', turn: cx.vars.get(EXTRA_TURN_VAR) ?? -1 };
    case 'untilExiledWith': return { d: 'untilExiledWith', after: cx.g.s.exiledWith?.[cx.source.id] ?? 0 }; // r5-dig (CR 611.2a, 607.2a): the cards exiled with the source so far
    default: return d;
  }
}

// ---- delayed and reflexive triggered abilities ----------------------------------------------------------------------------------------------------------

/** The names the steps bind themselves (`as`, `chosen`, `other`): they belong to the deferred ability, not to this resolution. */
function ownNames(x: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(x)) {
    for (const y of x) ownNames(y, into);
    return into;
  }
  if (!isRec(x) || isAbility(x)) return into;
  if (isStep(x)) {
    for (const k of ['as', 'chosen', 'other', 'name']) if (typeof x[k] === 'string') into.add(x[k] as string);
  }
  for (const v of Object.values(x)) ownNames(v, into);
  return into;
}

export interface Deferred<T> {
  node: T;
  /** Objects bound by this resolution that the deferred ability names, with the zone each is expected in (CR 603.7c). */
  captured: Record<string, ObjHandle[]>;
}

/**
 * Prepare instructions (or target specs) that run later as their own triggered ability (CR 603.7, 603.12). Fixed now: targets of THIS ability (not `own`
 * target ids), players bound here, X and the other resolution-local values, "if you do" about steps of this resolution, and, unless `keepEvent` (an event-based
 * delayed trigger, whose event roles are its own event's, or a reflexive trigger, which keeps the parent's event), event roles and "that much". Objects bound here
 * are left as names and returned in `captured`, for `bakeSteps`; with `bakeBound` they are fixed here too (target specs are not baked by WP8).
 */
export function prepareDeferred<T>(cx: ExecCtx, node: T, opts: { keepEvent: boolean; own?: ReadonlySet<string>; bakeBound?: boolean; names?: Set<string> }): Deferred<T> {
  const names = opts.names ?? ownNames(node, new Set());
  const captured: Record<string, ObjHandle[]> = {};
  /** A reference to objects of THIS resolution (not to the deferred ability's own targets, names or event). */
  const ofThisResolution = (ref: Rec): boolean =>
    (ref['ref'] === 'target' && !opts.own?.has(ref['id'] as string)) || (ref['ref'] === 'event' && !opts.keepEvent) || (ref['ref'] === 'bound' && !names.has(ref['name'] as string));
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (!isRec(x) || isAbility(x)) return x;
    // CR 608.2h, 603.7c: information about an object of this resolution that only its last known information still has (a countered spell's controller, a
    // sacrificed creature's power) is read now: last known information never changes afterwards, and the deferred ability could not find it any more.
    const about = infoSubject(x);
    // std-rw8 (CR 603.12, 608.2h, 118.12): what a payment of this resolution sacrificed ("When you do, ~ deals damage equal to that creature's power") is read now as
    // well: the reflexive trigger is an ability of its own, whose costs paid hold nothing
    const sacrificed = about !== undefined && about['ref'] === 'costSacrificed';
    if (about && ((ofThisResolution(about) && readsLastKnown(cx, about as unknown as ObjRef)) || sacrificed)) {
      if (typeof x['q'] === 'string') {
        const n = evalQty(cx, x as unknown as Quantity);
        if (n !== undefined) return n;
      } else {
        return fixedPlayers(resolvePlayers(cx, x as unknown as PlayerRef));
      }
    }
    if (typeof x['ref'] === 'string') {
      const ref = x as unknown as ObjRef | PlayerRef;
      if (ref.ref === 'target' && !opts.own?.has(ref.id)) return fixRef(cx, ref);
      if (ref.ref === 'event' && !opts.keepEvent) return fixRef(cx, ref);
      if (ref.ref === 'bound' && !names.has(ref.name)) {
        const b = cx.bindings.get(ref.name);
        if (b && b.objects.length === 0 && b.players.length > 0) return fixedPlayers(b.players);
        if (b) {
          if (opts.bakeBound) return fixedObjects(b.objects);
          captured[ref.name] = b.objects;
        }
        return x;
      }
    }
    if (typeof x['q'] === 'string') {
      const q = x['q'] as string;
      const local = q === 'X' || q === 'targetCount' || q === 'dieResult' || q === 'preventedAmount' /* std-library-2: CR 603.12, 615.5 */ || (q === 'eventAmount' && !opts.keepEvent) || ((q === 'resultCount' || q === 'excessDamage' || q === 'lifeLost' || q === 'countersRemoved' || q === 'votes' || q === 'damageDealt') && !names.has(x['step'] as string));
      if (local) {
        const n = evalQty(cx, x as unknown as Quantity);
        if (n !== undefined) return n;
      }
    }
    if (x['cond'] === 'did' && typeof x['step'] === 'string' && !names.has(x['step'])) return didConstant(cx, x['step'], x['not'] === true);
    const out: Rec = {};
    for (const [k, v] of Object.entries(x)) out[k] = walk(v);
    return out;
  };
  return { node: walk(node) as T, captured };
}

/** The object reference a node reads information about: the `of` of a characteristic, the `on` of a counter count, the object of "its controller / owner". */
function infoSubject(x: Rec): Rec | undefined {
  const inner = x['q'] === 'stat' ? x['of'] : x['q'] === 'counters' ? x['on'] : x['ref'] === 'controllerOf' || x['ref'] === 'ownerOf' ? x['object'] : undefined;
  return isRec(inner) && typeof inner['ref'] === 'string' ? inner : undefined;
}

/** Would reading this reference now use last known information (CR 608.2h): an object that left the zone it was expected in, or a binding re-based after a move? */
function readsLastKnown(cx: ExecCtx, ref: ObjRef): boolean {
  return resolveObjs(cx, ref).some((h) => {
    const cur = cx.g.s.objects[h.id];
    if (!cur || cur.zone !== h.zone) return true;
    const info = readInfo(cx, h);
    return info !== undefined && info.object !== cur;
  });
}

/** The variables of this resolution a deferred ability may read (CR 608.2h); `$` names are the interpreter's own. */
export const varsOf = (cx: ExecCtx): Record<string, number> => Object.fromEntries([...cx.vars].filter(([k, v]) => !k.startsWith('$') && !Number.isNaN(v)));

