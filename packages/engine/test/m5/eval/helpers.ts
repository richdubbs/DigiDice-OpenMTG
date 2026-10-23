/**
 * Helpers for the WP4 tests (effects/{ctx,refs,eval}.ts and rules/filter.ts): real fixture cards in a scenario state, spells and abilities put on the stack
 * by hand (the way announcement leaves them), and an `ExecCtx` over them.
 */
import { Game } from '../../../src/core/game';
import type { CardDef, DecisionAnswer, EffectProgram, GameState, ObjectId, PlayerId, TargetChoice } from '../../../src/index';
import type { ExecCtx } from '../../../src/effects/api';
import { moveObject } from '../../../src/core/zones';
import { makeCtx } from '../../../src/effects/ctx';
import type { CostsPaid, EventContext, GameObject, HistoryEntry, ObjHandle, StackInfo, ZoneKind } from '../../../src/types/state';
import { find, scenario, type ScenarioOptions } from '../helpers';

export { find, scenario };
export type { ScenarioOptions };

export const NO_COSTS: CostsPaid = {};

export interface StackSpec {
  /** Name of a definition in the scenario (the spell, or the source of an ability). */
  name: string;
  owner?: PlayerId;
  kind?: 'spell' | 'activated' | 'triggered';
  /** One list of chosen targets per target spec of the program, in program order. */
  targets?: TargetChoice[][];
  x?: number;
  costsPaid?: CostsPaid;
  castFrom?: ZoneKind;
  event?: EventContext;
  /** For an ability: the object it comes from (default: the object named `name` on the battlefield). */
  sourceId?: ObjectId;
}

/** Put a spell or an ability on the stack directly (test setup only; mutates `s`). Returns the id of the stack object. */
export function putOnStack(s: GameState, spec: StackSpec): ObjectId {
  const owner = spec.owner ?? 'p1';
  const kind = spec.kind ?? 'spell';
  const id = `o${s.counters.object++}`;
  const stack: StackInfo = {
    kind,
    targets: spec.targets ?? [],
    costsPaid: spec.costsPaid ?? NO_COSTS,
    ...(kind === 'spell' ? {} : { sourceId: spec.sourceId ?? find(s, spec.name, 'battlefield'), sourceName: spec.name }),
    ...(spec.x !== undefined ? { x: spec.x } : {}),
    ...(spec.castFrom ? { castFrom: spec.castFrom } : {}),
    ...(spec.event ? { event: spec.event } : {}),
  };
  s.objects[id] = {
    id, kind: kind === 'spell' ? 'card' : 'ability', defId: spec.name, owner, controller: owner, zone: 'stack', timestamp: s.counters.timestamp++,
    tapped: false, flipped: false, faceDown: false, phasedOut: false, face: 0, controlledSinceTurn: 0, counters: {}, damage: 0, deathtouchDamaged: false, stack,
    ...(kind === 'spell' ? { cardId: `c${s.counters.card++}` } : {}),
  } satisfies GameObject;
  s.zones.stack.push(id);
  return id;
}

/** An execution context over the object `id` (a stack object, or a permanent for a context without a stack). */
export function ctxOn(s: GameState, id: ObjectId, program: EffectProgram = { targets: [], steps: [] }, answers: DecisionAnswer[] = []): ExecCtx {
  return makeCtx(new Game(s, answers), s.objects[id]!, program);
}

export const chosenObject = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
export const chosenPlayer = (id: PlayerId): TargetChoice => ({ kind: 'player', id });

/** Bind a name to objects in the context (what a `chooseObjects` or `search` step would do). */
export function bind(cx: ExecCtx, name: string, objects: ObjHandle[], players: PlayerId[] = []): void {
  cx.bindings.set(name, { objects, players, snapshots: Object.fromEntries(objects.flatMap((h) => { const o = cx.g.s.objects[h.id]; return o ? [[h.id, { object: structuredClone(o), chars: null, leftZone: h.zone }]] : []; })) });
}

export const handle = (s: GameState, id: ObjectId): ObjHandle => ({ id, zone: s.objects[id]!.zone });

/** Move an object to another zone the way the engine does (a new object, last known information kept); returns the new id, or null if it ceased to exist. */
export const moveTo = (cx: ExecCtx, id: ObjectId, zone: 'battlefield' | 'graveyard' | 'exile' | 'hand' | 'library'): ObjectId | null => moveObject(cx.g, id, zone, { cause: 'test' });

export const entry = (over: Partial<HistoryEntry> & Pick<HistoryEntry, 'ev'>): HistoryEntry => ({ turn: 1, combat: 0, facts: {}, ...over });

export const defs = (...cards: CardDef[]): CardDef[] => cards;

/** A context built again over the state as it is now: what the interpreter does on every re-execution (the legality check of CR 608.2b is made once per context). */
export const rebuild = (cx: ExecCtx): ExecCtx => makeCtx(cx.g, cx.g.s.objects[cx.stackId!]!, cx.program);
