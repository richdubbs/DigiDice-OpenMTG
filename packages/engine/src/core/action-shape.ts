/**
 * The shape of an `Action` that came from outside the engine: from the network (packages/net, an online guest's action) or from a file (a replay's
 * action log, replays design 4). The engine checks whether an action is legal as it applies it (CR 733: an illegal action is rejected, never
 * half-applied), but it reads an action's fields on the assumption that they have their types: an action without a player, a `setStops` with no
 * stops, or an answer that is not a record made it throw instead of rejecting (RPL-0 review). So everything outside is checked here first.
 *
 * RPL-0: moved from packages/net (`protocol/action-fields.ts`, removed, and `protocol/messages.ts#checkAction`, which delegates here), so the online host
 * and the replay reader check actions with one function.
 *
 * - The type is one of the actions a player takes; `startGame` is internal to the engine (it runs when a game is created) and never accepted.
 * - Every action names its player.
 * - The fields of each type have their types; `setStops` is checked fully, because the engine copies it into the state as it is.
 * - The action is bounded (nesting, number of values, estimated size), checked without recursion (audit 2026-10-12, C4).
 * - `exactFields` (the network): no field the engine does not read, at the top level, in an answer and in the objects of an answer's lists (audit M4:
 *   the host keeps every applied action for the whole game, so junk fields grew its heap). A replay leaves it off: its size is bounded as a file, and
 *   an added field must not make an older reader refuse a replay a newer build wrote (the engine ignores a field it does not read).
 *
 * The field tables are checked against the engine's types at compile time (`Complete`): a field the engine adds does not compile until it is listed
 * here. An action type added here is one an older reader refuses in a replay (`malformed`), so it comes with a new replay format version
 * (replay/format.ts `REPLAY_FORMAT_VERSION` and an upgrade function, replay/upgrade.ts), which older readers refuse as "made by a newer OpenMTG".
 *
 * Browser-safe: plain values only.
 */
import type { Action } from '../types/actions';
import type { DecisionAnswer, ManualOp } from '../types/decisions';
import { STEP_ORDER } from '../types/state';
import { measureJsonValue } from '../util/json-bounds';

type Keys<T> = T extends unknown ? keyof T & string : never;
type Variant<U, D extends string, V> = Extract<U, Record<D, V>>;
/** For each variant of `U` (told apart by its field `D`): every field the variant may have. */
type FieldTable<U, D extends string> = { [V in U[D & keyof U] & string]: readonly Keys<Variant<U, D, V>>[] };
/** The fields of some variant that its table entry leaves out (never, when the table is complete). */
type Unlisted<M, U, D extends string> = { [V in keyof M]: Exclude<Keys<Variant<U, D, V>>, M[V] extends readonly (infer E)[] ? E : never> }[keyof M];
type Complete<M, U, D extends string> = [Unlisted<M, U, D>] extends [never] ? true : false;
type Assert<T extends true> = T;

/** The actions a player takes (every action but `startGame`). */
export type PlayerAction = Exclude<Action, { type: 'startGame' }>;

const ACTION_FIELDS = {
  pass: ['type', 'player'],
  playLand: ['type', 'player', 'card', 'face'],
  cast: ['type', 'player', 'card', 'face', 'method'],
  activate: ['type', 'player', 'source', 'ability'],
  manualTrigger: ['type', 'player', 'source', 'ability'],
  manualStatic: ['type', 'player', 'source', 'ability'],
  special: ['type', 'player', 'kind', 'object', 'via', 'x', 'door', 'option'], // M6-0 (engine m6 design 2.3): the turn-face-up procedure and its X; FAST5X E8: door, the half of a Room to unlock (CR 709.5e); std-freecast-5: option, which of a plot card's costs (core/special/plot.ts, CR 702.170a)
  answer: ['type', 'player', 'decisionId', 'answer'],
  cancel: ['type', 'player'],
  concede: ['type', 'player'],
  setStops: ['type', 'player', 'stops'],
} as const satisfies FieldTable<PlayerAction, 'type'>;

const ANSWER_FIELDS = {
  playFirst: ['kind', 'player'],
  mulligan: ['kind', 'keep'],
  chooseObjects: ['kind', 'ids'],
  yesNo: ['kind', 'yes'],
  chooseOption: ['kind', 'ids'],
  chooseNumber: ['kind', 'n'],
  chooseColor: ['kind', 'color'],
  order: ['kind', 'ids'],
  chooseTargets: ['kind', 'targets'],
  payCost: ['kind', 'auto', 'activations', 'lifeForPhyrexian', 'spendPool'],
  declareAttackers: ['kind', 'attacks'],
  declareBlockers: ['kind', 'blocks'],
  assignDamage: ['kind', 'amounts'],
  chooseReplacement: ['kind', 'id'],
  manualResolve: ['kind', 'ops', 'continue'],
  chooseDivision: ['kind', 'amounts'],
  chooseName: ['kind', 'name'],
  commanderZone: ['kind', 'command'], // M11-0 (m11 design 4.3): CR 903.9a-b
} as const satisfies FieldTable<DecisionAnswer, 'kind'>;

const OP_FIELDS = {
  move: ['op', 'object', 'to', 'attachTo'],
  life: ['op', 'player', 'delta'],
  counters: ['op', 'object', 'counter', 'delta'],
  tap: ['op', 'object', 'tapped'],
  draw: ['op', 'player', 'count'],
  shuffle: ['op', 'player'],
  control: ['op', 'object', 'player'],
  damage: ['op', 'target', 'amount'],
  attach: ['op', 'object', 'to'],
  mana: ['op', 'player', 'types', 'snow'],
  token: ['op', 'player', 'name', 'typeLine', 'power', 'toughness', 'colors', 'text', 'tapped'],
  note: ['op', 'text'],
} as const satisfies FieldTable<ManualOp, 'op'>;

type Answer<K extends DecisionAnswer['kind']> = Variant<DecisionAnswer, 'kind', K>;
type Item<T> = T extends readonly (infer E)[] ? E : never;
/** The fields of the objects in an answer's lists (answers whose lists hold strings or numbers have none here). */
const ITEM_FIELDS = {
  chooseTargets: { list: 'targets', fields: ['kind', 'id'] as const satisfies readonly Keys<Item<Answer<'chooseTargets'>['targets']>>[] },
  payCost: { list: 'activations', fields: ['objectId', 'abilityKey', 'color'] as const satisfies readonly Keys<Item<Extract<Answer<'payCost'>, { auto: false }>['activations']>>[] },
  declareAttackers: { list: 'attacks', fields: ['attacker', 'defender'] as const satisfies readonly Keys<Item<Answer<'declareAttackers'>['attacks']>>[] },
  declareBlockers: { list: 'blocks', fields: ['blocker', 'attacker'] as const satisfies readonly Keys<Item<Answer<'declareBlockers'>['blocks']>>[] },
  assignDamage: { list: 'amounts', fields: ['id', 'amount'] as const satisfies readonly Keys<Item<Answer<'assignDamage'>['amounts']>>[] },
} as const;

// Compile-time completeness (see the header): each line fails to compile when the engine has a field the table does not list.
export type ActionFieldsComplete = Assert<Complete<typeof ACTION_FIELDS, PlayerAction, 'type'>>;
export type AnswerFieldsComplete = Assert<Complete<typeof ANSWER_FIELDS, DecisionAnswer, 'kind'>>;
export type OpFieldsComplete = Assert<Complete<typeof OP_FIELDS, ManualOp, 'op'>>;
type ItemComplete<T, L extends readonly string[]> = [Exclude<Keys<T>, L[number]>] extends [never] ? true : false;
export type ItemFieldsComplete = Assert<
  ItemComplete<Item<Answer<'chooseTargets'>['targets']>, typeof ITEM_FIELDS.chooseTargets.fields>
  & ItemComplete<Item<Extract<Answer<'payCost'>, { auto: false }>['activations']>, typeof ITEM_FIELDS.payCost.fields>
  & ItemComplete<Item<Answer<'declareAttackers'>['attacks']>, typeof ITEM_FIELDS.declareAttackers.fields>
  & ItemComplete<Item<Answer<'declareBlockers'>['blocks']>, typeof ITEM_FIELDS.declareBlockers.fields>
  & ItemComplete<Item<Answer<'assignDamage'>['amounts']>, typeof ITEM_FIELDS.assignDamage.fields>
>;

/** An action's estimated JSON size, nesting depth and number of values, at most (audit C4; packages/net `LIMITS.actionBytes` and the others). */
export const ACTION_BOUNDS = Object.freeze({ maxBytes: 64 * 1024, maxDepth: 12, maxValues: 8192 });

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const own = <T extends object>(table: T, key: string): key is Extract<keyof T, string> => Object.prototype.hasOwnProperty.call(table, key);
const isStr = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const isInt = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;

const STEPS: ReadonlySet<string> = new Set(STEP_ORDER);
/** The ways a special action names (engine `Action` 'special' `via`); the engine checks which one is available. */
const SPECIAL_VIA: ReadonlySet<string> = new Set<NonNullable<Extract<Action, { type: 'special' }>['via']>>(['morph', 'megamorph', 'disguise', 'manifest', 'cloak']);

function extraKey(x: Rec, allowed: readonly string[]): string | null {
  for (const k of Object.keys(x)) if (!allowed.includes(k)) return k;
  return null;
}

/**
 * Why this action (shape-checked and measured already, `actionShapeProblem`) has a field the engine does not read, or null when it has none. Lists and
 * their items are walked one level: no recursion on outside data.
 */
export function unknownActionField(action: Rec): string | null {
  const type = action['type'];
  if (typeof type !== 'string' || !own(ACTION_FIELDS, type)) return 'unknown action type';
  const top = extraKey(action, ACTION_FIELDS[type]);
  if (top !== null) return `unknown action field "${top}"`;
  if (type !== 'answer') return null;
  const answer = action['answer'];
  if (!isRec(answer)) return null; // actionShapeProblem refuses it
  const kind = answer['kind'];
  if (typeof kind !== 'string' || !own(ANSWER_FIELDS, kind)) return `unknown answer kind "${String(kind)}"`;
  const inAnswer = extraKey(answer, ANSWER_FIELDS[kind]);
  if (inAnswer !== null) return `unknown answer field "${inAnswer}"`;
  if (kind === 'manualResolve') {
    const ops = answer['ops'];
    if (!Array.isArray(ops)) return null; // the engine refuses it
    for (const op of ops) {
      if (!isRec(op)) continue; // the engine refuses it
      const name = op['op'];
      if (typeof name !== 'string' || !own(OP_FIELDS, name)) return `unknown manual adjustment "${String(name)}"`;
      const extra = extraKey(op, OP_FIELDS[name]);
      if (extra !== null) return `unknown answer field "${extra}"`;
    }
    return null;
  }
  if (!own(ITEM_FIELDS, kind)) return null;
  const { list, fields } = ITEM_FIELDS[kind];
  const items = answer[list];
  if (!Array.isArray(items)) return null; // the engine refuses it
  for (const item of items) {
    if (!isRec(item)) continue; // the engine refuses it
    const extra = extraKey(item, fields);
    if (extra !== null) return `unknown answer field "${extra}"`;
  }
  return null;
}

export interface ActionShapeOptions {
  /** Refuse a field the engine does not read (the network; see the file comment). */
  exactFields?: boolean;
}

/**
 * Why `x` is not an action the engine can be handed (see the file comment), or null when it is one. The engine still decides whether it is legal.
 * The reasons are packages/net's protocol errors ("unknown action type", "action player missing", "action malformed", "stops malformed", ...).
 */
export function actionShapeProblem(x: unknown, opts: ActionShapeOptions = {}): string | null {
  if (!isRec(x) || typeof x['type'] !== 'string' || !own(ACTION_FIELDS, x['type'])) return 'unknown action type';
  if (!isStr(x['player'], 64)) return 'action player missing';
  // Iterative and bounded: JSON.stringify here threw RangeError on a 5,000-deep action and took the host down (audit C4).
  const size = measureJsonValue(x, ACTION_BOUNDS);
  if (size) return size === 'depth' ? 'action too deeply nested' : 'action too large';
  if (opts.exactFields === true) {
    const extra = unknownActionField(x);
    if (extra) return extra;
  }
  switch (x['type']) {
    case 'playLand':
    case 'cast':
      return isStr(x['card'], 64) && (x['face'] === undefined || isInt(x['face'], 0, 8)) && (x['method'] === undefined || isStr(x['method'], 100)) ? null : 'action malformed';
    case 'activate':
    case 'manualTrigger': // MRE (engine C6 gap 7): the by-hand tools name an ability like an activation
    case 'manualStatic':
      return isStr(x['source'], 64) && isStr(x['ability'], 200) ? null : 'action malformed';
    case 'special':
      // M6-11 (engine m6 design 2.3, D8): the turn-face-up procedure (`via`, CR 702.37e, 702.168d, 701.40b, 701.58b) and its X (CR 702.37f, 107.3a)
      return isStr(x['kind'], 100) && (x['object'] === undefined || isStr(x['object'], 64)) && (x['via'] === undefined || (typeof x['via'] === 'string' && SPECIAL_VIA.has(x['via'])))
        && (x['x'] === undefined || isInt(x['x'], 0, 1_000_000)) && (x['door'] === undefined || isInt(x['door'], 0, 8))
        && (x['option'] === undefined || isInt(x['option'], 0, 8)) ? null : 'action malformed'; // door: FAST5X E8 (CR 709.5e); option: std-freecast-5 (CR 702.170a)
    case 'answer':
      return isStr(x['decisionId'], 64) && isRec(x['answer']) && typeof x['answer']['kind'] === 'string' ? null : 'action malformed';
    case 'setStops': {
      const s = x['stops'];
      // Steps of the turn only, each at most twice (audit M4: bounded; packages/net's parseGuestMessage drops the repeats).
      const steps = (v: unknown) => Array.isArray(v) && v.length <= 2 * STEP_ORDER.length && v.every((t) => typeof t === 'string' && STEPS.has(t));
      // AP1: the temporary hold-priority toggle is an optional boolean (engine StopSettings.holdPriority); nothing else may come along.
      const hold = isRec(s) ? s['holdPriority'] : undefined;
      const keys = isRec(s) ? Object.keys(s).filter((k) => s[k] !== undefined).length : 0; // a key holding undefined is absent, as in JSON
      return isRec(s) && steps(s['ownTurn']) && steps(s['opponentTurn']) && typeof s['fullControl'] === 'boolean' &&
        (hold === undefined ? keys === 3 : typeof hold === 'boolean' && keys === 4)
        ? null
        : 'stops malformed';
    }
    default:
      return null;
  }
}
