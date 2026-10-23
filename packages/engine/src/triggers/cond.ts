/**
 * Conditions at trigger time: the intervening "if" (CR 603.4) and the condition of a state trigger (CR 603.8) are judged here, with the event that caused
 * the trigger in hand. Owner: WP8.
 *
 * The interpreter's evaluator (`evalCond`, WP4) is the one evaluator of conditions; it is reached through `wiring.ts` and used for every condition it
 * knows. This module has its own for the conditions that need no resolution context (the ones the model allows in these positions and that talk about the
 * source, the event, the turn, the players and the history) so that triggers work, and are tested, before WP4 has merged. Three-valued: `undefined` means
 * "this build cannot tell" (a quantity or reference it does not evaluate), never "false".
 */
import type { Game } from '../core/game';
import { hasCompleted } from '../core/dungeon-data';
import { isPlayerOnlyRef, isPrime, type Cmp, type Condition, type ObjRef, type PlayerPred, type PlayerRef, type Quantity } from '../types/ability';
import { seatNeighbor } from '../statics/seats';
import type { ExecCtx } from '../effects/api';
import type { ObjectId, PlayerId } from '../types/ids';
import type { EventContext, GameObject, ObjHandle } from '../types/state';
import { findObjects } from '../rules/filter';
import { filterCtxOutside } from '../rules/filter-env';
import { countHistory } from '../rules/history';
import { castVia } from './match';
import { compareNumbers } from '../rules/predicates';
import { spentAtLeast } from '../types/mana';
import { lookupObject, objectMatches, playerMatches } from './filters';
import { conditionEvaluator } from './wiring';

/** Who is asking: the object whose ability it is, its controller and the event that triggered it (null for a state trigger). */
export interface CondEnv {
  source: ObjHandle;
  controller: PlayerId;
  event: EventContext | null;
}

/** The execution context the interpreter's evaluator wants, built for trigger time (no program, no targets, nothing bound yet). */
export function triggerCtx(g: Game, env: CondEnv): ExecCtx {
  return {
    g, source: env.source, stackId: null, controller: env.controller, program: { targets: [], steps: [] }, stack: null, targets: new Map(), event: env.event,
    bindings: new Map(), results: new Map(), vars: new Map(),
  };
}

const eventHandles = (env: CondEnv, role: keyof EventContext['roles']): ObjHandle[] => {
  const v = env.event?.roles[role];
  return v && 'objects' in v ? v.objects : [];
};
const eventPlayers = (env: CondEnv, role: keyof EventContext['roles']): PlayerId[] => {
  const v = env.event?.roles[role];
  return v && 'players' in v ? v.players : [];
};

const find = (g: Game, id: ObjectId, env: CondEnv): GameObject | undefined => g.s.objects[id] ?? env.event?.before[id]?.object ?? lookupObject(g.s, id);

/** The objects an object reference stands for at trigger time, or undefined when this module cannot say. */
function objsOf(g: Game, ref: ObjRef, env: CondEnv): GameObject[] | undefined {
  switch (ref.ref) {
    case 'self': {
      const o = find(g, env.source.id, env);
      return o ? [o] : [];
    }
    case 'event': return eventHandles(env, ref.role).flatMap((h) => { const o = find(g, h.id, env); return o ? [o] : []; });
    case 'each': return findObjects(g.s, ref.filter, filterCtxOutside(g.s, { controller: env.controller, sourceId: env.source.id, event: env.event })); // WP30
    case 'attachedTo': {
      const host = find(g, env.source.id, env)?.attachedTo;
      const o = host ? find(g, host, env) : undefined;
      return o ? [o] : [];
    }
    case 'union': {
      const parts = ref.of.map((r) => objsOf(g, r, env));
      return parts.some((p) => p === undefined) ? undefined : parts.flat() as GameObject[];
    }
    default: return undefined;
  }
}

function playersOf(g: Game, ref: PlayerRef, env: CondEnv): PlayerId[] | undefined {
  switch (ref.ref) {
    case 'you': return [env.controller];
    case 'active': return [g.s.turn.activePlayer];
    case 'event': return eventPlayers(env, ref.role);
    // M12-1 (m12 design E24): players who left the game are not "each player" / "each opponent" any more (CR 800.4a, 102.3)
    case 'each': return g.s.players.filter((p) => !p.hasLost && (ref.who === 'player' || p.id !== env.controller)).map((p) => p.id);
    case 'controllerOf': case 'ownerOf': {
      const os = objsOf(g, ref.object, env);
      return os === undefined ? undefined : os.map((o) => (ref.ref === 'controllerOf' ? o.controller : o.owner));
    }
    case 'seat': { // M12-1 (m12 design D6): the next / previous player in turn order still in the game (CR 101.4, 103.1), from `of` (you by default)
      const from = ref.of !== undefined ? playersOf(g, ref.of, env) : [env.controller];
      return from === undefined ? undefined : [...new Set(from.flatMap((p) => { const n = seatNeighbor(g.s, p, ref.side); return n !== undefined ? [n] : []; }))];
    }
    default: return undefined;
  }
}

/** A quantity at trigger time. */
function qty(g: Game, q: Quantity, env: CondEnv): number | undefined {
  if (typeof q === 'number') return q;
  switch (q.q) {
    case 'count': return objsOf(g, q.of, env)?.length;
    case 'life': { const p = playersOf(g, q.of, env); return p && p.length === 1 ? g.player(p[0]!).life : undefined; }
    case 'counters': {
      if (isPlayerOnlyRef(q.on) || q.on.ref === 'each') return undefined; // M12-1: the one table of player-only references (types/ability.ts); 'each' as before
      const os = objsOf(g, q.on as ObjRef, env);
      if (!os || q.kind === 'any') return undefined;
      return os.reduce((n, o) => n + (o.counters[q.kind] ?? 0), 0);
    }
    case 'eventAmount': return env.event?.amount;
    case 'turnNumber': return g.s.turn.number;
    case 'startingLife': return g.s.options.startingLife; // FAST5 T60, CR 103.4
    case 'zoneSize': {
      const p = playersOf(g, q.of, env);
      if (!p || p.length !== 1 || q.zone === 'battlefield' || q.zone === 'stack' || q.zone === 'exile' || q.zone === 'command') return undefined;
      return g.s.zones[q.zone][p[0]!]?.length ?? 0;
    }
    case 'cardsDrawnThisTurn': return g.player(env.controller).turnStats.cardsDrawn;
    case 'spellsCastThisTurn': return g.player(env.controller).turnStats.spellsCast;
    case 'lifeGainedThisTurn': return g.player(env.controller).turnStats.lifeGained;
    case 'descendedThisTurn': return g.player(env.controller).turnStats.descended ?? 0; // FAST5X E22 (CR 700.11)
    case 'turnsBegun': return g.player(env.controller).turnsBegun ?? 0; // std-r9 (CR 500.7, 500.11)
    case 'math': {
      const args = q.args.map((a) => qty(g, a, env));
      if (args.some((a) => a === undefined)) return undefined;
      const n = args as number[];
      switch (q.op) {
        case '+': return n.reduce((a, b) => a + b, 0);
        case '-': return n.slice(1).reduce((a, b) => a - b, n[0]!);
        case '*': return n.reduce((a, b) => a * b, 1);
        case 'floorDiv': return Math.floor(n[0]! / n[1]!);
        case 'ceilDiv': return Math.ceil(n[0]! / n[1]!);
        case 'min': return Math.min(...n);
        case 'max': return Math.max(...n);
      }
    }
    // falls through (unreachable: the switch above returns for every op)
    default: return undefined;
  }
}

const cmp = (a: number, op: Cmp, b: number): boolean => (op === '<=' ? a <= b : op === '>=' ? a >= b : op === '==' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : a > b);
const player = (g: Game, pred: PlayerPred, id: PlayerId, env: CondEnv): boolean => playerMatches(g.s, pred, id, { source: env.source.id, controller: env.controller });

/** CR 603.4 / 603.8 at trigger time; `undefined` = this build cannot evaluate it. */
export function localCondition(g: Game, c: Condition, env: CondEnv): boolean | undefined {
  switch (c.cond) {
    case 'all': {
      const r = c.of.map((x) => holds(g, x, env));
      return r.includes(false) ? false : r.includes(undefined) ? undefined : true;
    }
    case 'any': {
      const r = c.of.map((x) => holds(g, x, env));
      return r.includes(true) ? true : r.includes(undefined) ? undefined : false;
    }
    case 'not': { const r = holds(g, c.of, env); return r === undefined ? undefined : !r; }
    case 'compare': {
      const l = qty(g, c.left, env);
      const r = qty(g, c.right, env);
      return l === undefined || r === undefined ? undefined : cmp(l, c.op, r);
    }
    case 'prime': { const n = qty(g, c.of, env); return n === undefined ? undefined : isPrime(n); } // std-rx1
    case 'exists': {
      const os = objsOf(g, c.of, env);
      const n = c.atLeast === undefined ? 1 : qty(g, c.atLeast, env);
      return os === undefined || n === undefined ? undefined : os.length >= n;
    }
    case 'matches': {
      const os = objsOf(g, c.object, env);
      if (os === undefined) return undefined;
      const cx = { source: env.source.id, controller: env.controller };
      return os.length > 0 && os.every((o) => objectMatches(g.s, c.filter, o, [o.id], cx));
    }
    case 'turnOf': {
      if (c.step !== undefined && !(Array.isArray(c.step) ? c.step : [c.step]).includes(g.s.turn.step)) return false;
      return player(g, c.whose, g.s.turn.activePlayer, env);
    }
    case 'wasCast': {
      const cast = find(g, env.source.id, env)?.cast;
      if (!cast) return false;
      if (c.kicked !== undefined) {
        const kicked = (cast.costsPaid.kicked ?? 0) > 0;
        if (typeof c.kicked === 'boolean' ? kicked !== c.kicked : !(cast.costsPaid.additional ?? []).includes(c.kicked)) return false;
      }
      if (c.via !== undefined && !castVia(cast.via, c.via) && !castVia(cast.costsPaid.alternative, c.via)) return false; // p2-graveyard-1: `<via>:2` (CR 601.3)
      if (c.kept === true) return undefined; // std-rx22: read by statics/match.ts#wasCastKept only (fail closed)
      if (c.from !== undefined && cast.from !== c.from) return false;
      if (c.xAtLeast !== undefined && (cast.x ?? 0) < c.xAtLeast) return false;
      if (c.by === 'you' && cast.by !== env.controller) return false; // FAST4 T27 (CR 601.2a): "if you cast it"
      if (c.spent !== undefined && !spentAtLeast(cast.costsPaid.manaSpent, c.spent)) return false; // FAST5 T37 (CR 601.2h): adamant
      return true;
    }
    case 'happened': {
      // The reader is WP4's (rules/history.ts) over the entries triggers/history.ts writes. A count that is itself a quantity needs the interpreter.
      const want = c.times === undefined ? 1 : typeof c.times.value === 'number' ? c.times.value : undefined;
      if (want === undefined) return undefined;
      const n = countHistory(g.s, c.event, c.scope, c.by, { you: env.controller, sourceId: env.source.id });
      return c.times === undefined ? n >= 1 : compareNumbers(c.times.op, n, want);
    }
    case 'designation': {
      const who = playersOf(g, c.who, env);
      const d = g.s.designations;
      if (c.what === 'day' || c.what === 'night') return d.dayNight === c.what;
      if (c.what === 'citysBlessing') return undefined;
      if (c.what === 'enduringStory') return who === undefined ? undefined : who.length > 0 && who.every((p) => d.enduringStory?.includes(p) === true); // FAST5X E18
      if (c.what === 'maxSpeed') return who === undefined ? undefined : who.length > 0 && who.every((p) => (d.speed?.[p] ?? 0) >= 4); // FAST5X-4, CR 702.179e-f
      return who === undefined ? undefined : who.length > 0 && who.every((p) => d[c.what as 'monarch' | 'initiative'] === p);
    }
    case 'completedDungeon': { // MX4, CR 309.7
      const who = playersOf(g, c.who, env);
      return who === undefined ? undefined : who.some((p) => hasCompleted(g.s, p, c.name));
    }
    default: return undefined; // did, chosen, ask: need the resolution context or a person
  }
}

/** A condition at trigger time: the interpreter's evaluator when it knows the condition, this module's otherwise. `undefined` = cannot tell. */
export function holds(g: Game, c: Condition, env: CondEnv): boolean | undefined {
  const ev = conditionEvaluator();
  if (ev?.knows(c)) return ev.evaluate(triggerCtx(g, env), c);
  return localCondition(g, c, env);
}

/**
 * CR 603.4: the intervening "if" of a triggered ability, asked the second time, as the ability resolves (the first time is when it triggers). `source` is the
 * ability's source (last known information if it left), `event` the context stored on the stack object. A condition this build cannot evaluate is reported as
 * true: the ability stays, and the log has already said it could not be checked.
 */
export function interveningIfHolds(g: Game, cond: Condition | undefined, env: CondEnv): boolean {
  if (cond === undefined) return true;
  return holds(g, cond, env) !== false;
}
