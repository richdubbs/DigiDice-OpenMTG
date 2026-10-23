/**
 * The `FilterEnv` of a filter that is read OUTSIDE a resolution (WP30, the W1 follow-up "FilterEnv at the announcement call sites"). Owner: WP30.
 *
 * Some forms of `ObjectFilter` mention something besides the object: a reference (`is`, `sharesWith`, `targets`, `controller: {ref}`, `owner: {ref}`,
 * `attacking: {defender: {ref}}`) or a quantity (`power <= {q:...}`). `rules/filter.ts#matchesFilter` (WP4) evaluates them through a `FilterEnv`; while an effect
 * resolves the interpreter builds one from its execution context (`effects/refs.ts#filterEnvOf`). Everywhere else a filter is read (the targets a spell or
 * ability may choose, CR 601.2c, 115.1; the 608.2b re-check; the conditions read while announcing; cost parts, CR 601.2h; the enchant restriction of an Aura,
 * CR 303.4; the spending restriction of mana, CR 106.6; the patterns and conditions of triggered abilities, CR 603.2, 603.4) used to pass none, so a filter with one
 * of those forms never matched there, and the forms could not be advertised (design 5.2: a capability exists only when it works in every position).
 *
 * This module gives those call sites an environment with the SAME semantics as resolution: it builds a read-only execution context and lets WP4's reference
 * resolvers and quantity evaluators answer (`resolveRecipients`, `evalQty`), so a reference means at announcement what it means when the ability resolves. What
 * the context holds:
 *   - "you" is the controller, "this" / `self` the source (the spell on the stack, the permanent with the ability, the Aura);
 *   - `{ref:'target', id}` is a target ALREADY chosen for an earlier spec (CR 601.2c: targets are chosen in order; a later spec's targets are nothing yet);
 *   - X is the announced X (CR 107.3a); before it is announced it is undetermined (a target filter is relaxed instead, rules/targets.ts#AnnouncedX); a
 *     triggered ability, which announces none, reads the X its source was cast with (CR 107.3m), as the resolution does;
 *   - `{ref:'event', role}` is the event a triggered ability triggered on (CR 603.2, the `event` of its stack object);
 *   - the cast record, links and attachments are read from the objects as the resolvers always do.
 * Anything that cannot be determined (a choice, which no pure check may ask: "an opponent" among several; a name bound only while an effect resolves) is
 * `undefined`: the filter does not match (design D2, 3.2). The context is built lazily, the first time a filter actually needs it, and never stored.
 */
import type { Game } from '../core/game';
import { EngineBug } from '../core/errors';
import type { ExecCtx, TargetSlot } from '../effects/api';
import { evalQty } from '../effects/eval';
import { resolveRecipients } from '../effects/refs';
import type { ObjectFilter, Quantity } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { EventContext, GameState, ObjHandle, StackInfo, TargetChoice } from '../types/state';
import type { FilterContext, FilterEnv } from './filter';

export interface OutsideResolution {
  /** The player "you" means: the controller of the spell or ability (or of the permanent whose restriction is read). */
  controller: PlayerId;
  /** The source: the spell, the permanent with the ability, the Aura. */
  sourceId?: ObjectId;
  /** The spell or ability on the stack being announced, if it is there already (CR 601.2a, 602.2a, 603.3): its X, event and cast choices are read from it. */
  stackId?: ObjectId;
  /** Targets already chosen, by spec id (CR 601.2c). */
  chosen?: ReadonlyMap<string, readonly TargetChoice[]>;
  /**
   * X (WP30 review: decided by the caller from the announcement, never from whether the stack object exists, since a spell or ability is on the stack before
   * its X is announced, CR 601.2a-b). A number: the announced X (CR 107.3a), whatever the stack object holds yet. `null`: X has not been announced yet (modes
   * are chosen before X, CR 601.2b), so a quantity that mentions X cannot be determined. Absent: X is read exactly as the resolution reads it (the stack
   * object's X, else the X its source was cast with, CR 107.3m, else 0).
   */
  x?: number | null;
  /** The event a triggered ability triggered on; defaults to the stack object's (CR 603.2). */
  event?: EventContext | null;
}

/** A question a pure check may not ask (a decision). */
class Undetermined extends Error {}

/** The members of `Game` the reference resolvers and quantity evaluators use, without anything that could change the state (no decision is ever asked). */
function readOnlyGame(s: GameState): Game {
  const player = (id: PlayerId): GameState['players'][number] => {
    const p = s.players.find((x) => x.id === id);
    if (!p) throw new EngineBug(`No player ${id}`);
    return p;
  };
  const g = {
    s,
    player,
    opponents: (id: PlayerId) => s.players.filter((p) => p.id !== id && !p.hasLost),
    apnap: () => {
      const ids = s.players.map((p) => p.id);
      const i = ids.indexOf(s.turn.activePlayer);
      return [...ids.slice(i), ...ids.slice(0, i)].filter((id) => !player(id).hasLost); // CR 101.4
    },
    choose: () => {
      throw new Undetermined('a filter read outside a resolution cannot ask for a decision');
    },
  };
  return g as unknown as Game;
}

const handleOf = (s: GameState, id: ObjectId): ObjHandle | null => {
  const o = s.objects[id];
  if (o) return { id, zone: o.zone };
  const l = s.lki[id];
  return l ? { id, zone: l.leftZone } : null;
};

/** The execution context a filter outside a resolution is read in (see the file comment). */
export function outsideResolutionCtx(s: GameState, o: OutsideResolution): ExecCtx {
  const onStack = o.stackId !== undefined ? s.objects[o.stackId]?.stack : undefined;
  const base: StackInfo = onStack ?? { kind: 'spell', targets: [], costsPaid: {} };
  const stack: StackInfo = typeof o.x === 'number' ? { ...base, x: o.x } : base;
  const sourceId = o.sourceId ?? o.stackId;
  const source: ObjHandle = sourceId !== undefined ? handleOf(s, sourceId) ?? { id: sourceId, zone: 'battlefield' } : { id: '', zone: 'battlefield' };
  const targets = new Map<string, TargetSlot[]>();
  for (const [id, picks] of o.chosen ?? []) {
    targets.set(id, picks.map((t): TargetSlot => (t.kind === 'player' ? { handle: null, player: t.id, legal: true } : { handle: handleOf(s, t.id), legal: true })));
  }
  return {
    g: readOnlyGame(s),
    source,
    stackId: o.stackId ?? null,
    controller: o.controller,
    program: { targets: [], steps: [] },
    stack,
    targets,
    event: o.event !== undefined ? o.event : onStack?.event ?? null,
    bindings: new Map(),
    results: new Map(),
    vars: new Map(),
  };
}

/**
 * `undefined` for what cannot be determined here (see the file comment): a decision (`Undetermined`). Every other error, an `EngineBug` included (a missing
 * evaluator, a module not loaded, a missing player), is a real one and propagates (WP30 review: never hide a bug as "does not match").
 */
function guarded<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch (e) {
    if (e instanceof Undetermined) return undefined;
    throw e;
  }
}

/**
 * Does this reference or quantity read something that exists only while an effect resolves: a name bound by an earlier step (`{ref:'bound'}`, design 3.1),
 * a variable set by a `let` (`{q:'var'}`, design 3.4) or the result of an earlier step (`resultCount`)? Outside a resolution there is none, so the value
 * cannot be determined (the resolvers would report a program error, which here is not one).
 */
function readsResolutionState(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(readsResolutionState);
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r['ref'] === 'bound' || r['q'] === 'var' || r['q'] === 'resultCount' || r['q'] === 'excessDamage' || r['q'] === 'lifeLost' || r['q'] === 'countersRemoved' || r['q'] === 'votes' || r['q'] === 'damageDealt') return true;
  for (const k in r) if (readsResolutionState(r[k])) return true;
  return false;
}

/**
 * The X a spell or ability on the stack will read when it resolves (`effects/eval.ts`: its own announced X, else the X its source was cast with, CR 107.3m,
 * else 0). A triggered ability announces no X (CR 603.3c), so this is the X its targets and conditions are read with while it is put on the stack.
 */
export function resolutionX(s: GameState, controller: PlayerId, sourceId: ObjectId, stackId: ObjectId): number {
  return evalQty(outsideResolutionCtx(s, { controller, sourceId, stackId }), { q: 'X' }) ?? 0;
}

/** The environment for a filter read outside a resolution. Building it costs nothing: the context is made the first time a filter needs it. */
export function filterEnvOutside(s: GameState, o: OutsideResolution): FilterEnv {
  let cx: ExecCtx | null = null;
  const ctx = (): ExecCtx => (cx ??= outsideResolutionCtx(s, o));
  const xUnknown = o.x === null;
  return {
    refs: (ref) => (readsResolutionState(ref) ? undefined : guarded(() => resolveRecipients(ctx(), ref))),
    qty: (q) => ((xUnknown && mentionsX(q)) || readsResolutionState(q) ? undefined : guarded(() => evalQty(ctx(), q))),
  };
}

/** Does the quantity read X (CR 107.3)? */
function mentionsX(q: Quantity): boolean {
  if (typeof q === 'number') return false;
  if (q.q === 'X') return true;
  return Object.values(q).some((v) => (Array.isArray(v) ? v.some((a) => isQuantity(a) && mentionsX(a)) : isQuantity(v) && mentionsX(v)));
}

const isQuantity = (v: unknown): v is Quantity => typeof v === 'number' || (typeof v === 'object' && v !== null && typeof (v as { q?: unknown }).q === 'string');

/** The whole `FilterContext` for a filter read outside a resolution: "you", the source and the environment. */
export function filterCtxOutside(s: GameState, o: OutsideResolution): FilterContext {
  const sourceId = o.sourceId ?? o.stackId;
  return { you: o.controller, ...(sourceId !== undefined ? { sourceId } : {}), env: filterEnvOutside(s, o) };
}

/**
 * CR 601.2f, 107.3a: once X is announced, the total cost is locked in, so an X inside the filter of a cost part ("Sacrifice a creature with mana value X") is that
 * number. Returns the same object when the value holds no X (the common case: nothing is copied).
 */
export function fixX<T>(value: T, x: number): T {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v: unknown) => {
      const w = fixX(v, x);
      if (w !== v) changed = true;
      return w;
    });
    return (changed ? out : value) as T;
  }
  if (value === null || typeof value !== 'object') return value;
  const r = value as Record<string, unknown>;
  if (r['q'] === 'X' && Object.keys(r).length === 1) return x as T;
  let out: Record<string, unknown> | null = null;
  for (const k of Object.keys(r)) {
    const w = fixX(r[k], x);
    if (w !== r[k]) (out ??= { ...r })[k] = w;
  }
  return (out ?? value) as T;
}

/** Does any quantity inside this filter (at any depth) read X? */
export function filterMentionsX(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(filterMentionsX);
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r['q'] === 'X') return true;
  for (const k in r) if (filterMentionsX(r[k])) return true;
  return false;
}

/** A filter that matches nothing (an empty `anyOf`). */
const NOTHING: ObjectFilter = { anyOf: [] };

/**
 * The filter of a target spec for a check made BEFORE X is announced (CR 601.2b announces X, 601.2c chooses targets; a legality check asks whether the spell can
 * be cast at all, CR 601.3): every condition that reads X is dropped, so the result is the union over every value of X and the check never refuses what some X
 * would allow ("destroy target creature with mana value X or less" can be cast while a 4-drop is around). Under a `not` the polarity flips, so there a part that
 * reads X becomes "matches nothing" (the `not` of it then holds). The announcement reads the announced X exactly, so nothing is chosen that the X does not allow.
 * Returns the same object when nothing reads X.
 */
export function relaxUnannouncedX(f: ObjectFilter | undefined): ObjectFilter | undefined {
  if (f === undefined || !filterMentionsX(f)) return f;
  return relaxed(f, false);
}

function relaxed(f: ObjectFilter, negated: boolean): ObjectFilter {
  if (!filterMentionsX(f)) return f;
  if (negated) return NOTHING; // the narrowest filter: its negation is the widest
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    if (k === 'anyOf') out[k] = (v as ObjectFilter[]).map((x) => relaxed(x, false));
    else if (k === 'not') out[k] = relaxed(v as ObjectFilter, true);
    else if (!filterMentionsX(v)) out[k] = v; // a comparison or reference that reads X is dropped: it holds for some X
  }
  return out as ObjectFilter;
}
