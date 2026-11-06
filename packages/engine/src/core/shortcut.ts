/**
 * Shortcuts (CR 727; docs/design/shortcuts.md): a player who repeats a loop of actions proposes "repeat my last N actions X times"; each other player
 * accepts or names the point where they want priority; the engine then plays the passes one by one (core/shortcut-run.ts).
 *
 * The rules are cited from memory (rules/cr/ is not available in a cloud session), so every citation here is UNVERIFIED: CR 727.1 (a shortcut skips parts
 * of the technical play sequence by agreement), 727.2a (the player with priority proposes a sequence of game choices, repeated a number of times), 727.2b
 * (each other player, in turn order, accepts or shortens it by naming the point where they will deviate), 727.2c (the shortcut is performed up to there).
 *
 * This module is the pure part, read by core/apply.ts, core/view.ts and the runner: the constants, the recording of settled actions (design 1), choosing and
 * checking the body of a proposal (design 2), the steps in words (design 3), the signatures and the view's `repeatable` / `loop` (design 4), and the
 * rebinding of recorded object ids (design 5.2). The runner lives in core/shortcut-run.ts because it reaches core/turn.ts, which reaches core/view.ts: this
 * module must not (no import cycles, test/m5/skeleton/import-rules.test.ts).
 */
import type { Action } from '../types/actions';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState, LastKnown, Suspension, TurnActionRec } from '../types/state';
import { clone } from '../util/clone';
import { abilitiesFromChars, enumerateAbilities } from '../rules/abilities';
import { charsOfObject } from '../rules/characteristics';
import { IllegalAction } from './errors';

/** The most steps (the proposer's own actions in one pass) a proposal may repeat (design 2). */
export const SHORTCUT_MAX_STEPS = 32;
/** The most passes one proposal may run (design 5.6: about 1 ms a pass on a small board; a player who wants more proposes again). */
export const SHORTCUT_MAX_TIMES = 1000;
/** The most settled actions of a turn the state keeps (`GameState.turnActions`, the oldest dropped). */
export const TURN_ACTIONS_KEPT = 64;

/** CR 727.2a (unverified): the proposal. */
export const PROPOSE_RULES: readonly string[] = ['CR 727.2a'];

/** The action types a shortcut can repeat: a priority action or a pass (design 1). */
export type RecordedAction = TurnActionRec['action'];
const RECORDED: ReadonlySet<Action['type']> = new Set<Action['type']>(['pass', 'playLand', 'cast', 'activate', 'manualTrigger', 'manualStatic', 'special']);
export const isRecordedAction = (a: Action): a is RecordedAction => RECORDED.has(a.type);

/**
 * M12-2 (m12 design D11): who gave each answer of a suspended action once `player` answers its pending decision (`Suspension.answeredBy`); only in a multiplayer
 * game, and only while every earlier answer's player is known (a two-player game records nothing, D16).
 */
export function answeredByWith(state: GameState, sus: Suspension, player: PlayerId): PlayerId[] | undefined {
  return state.options.multiplayer !== undefined && (sus.answeredBy?.length ?? 0) === sus.answers.length ? [...(sus.answeredBy ?? []), player] : undefined;
}

/**
 * Design 1: after `applyAction(prev, action)` gave `next` (the engine's own new state), record the action in `next.turnActions` when it settled (some player has
 * priority, nothing suspended, or the game is over): a priority action or a pass, or an answer that settled a suspended action of those types (the entry is the
 * suspended action with all its answers). A cancel, a concession, a stops change and a shortcut are never recorded, nor the actions a shortcut plays (they run
 * through the runner, not through `applyAction`). An action during which a new turn began belongs to the turn before (whose list `beginNextTurn` cleared).
 */
export function recordSettled(prev: GameState, action: Action, next: GameState): void {
  if (next.suspended !== null || (next.result === null && next.pending?.kind !== 'priority')) return;
  let rec: TurnActionRec;
  let from: GameState;
  if (action.type === 'answer') {
    const sus = prev.suspended;
    if (sus === null || !isRecordedAction(sus.action)) return;
    const by = answeredByWith(prev, sus, action.player);
    rec = { action: clone(sus.action), answers: clone([...sus.answers, action.answer]), ...(by !== undefined ? { answeredBy: by } : {}) };
    from = sus.base;
  } else if (isRecordedAction(action)) {
    rec = { action: clone(action), answers: [] };
    from = prev;
  } else {
    return;
  }
  if (next.turn.number !== from.turn.number) return;
  next.turnActions = [...(next.turnActions ?? []), rec].slice(-TURN_ACTIONS_KEPT);
}

/**
 * The entries of `turnActions` a player may repeat (design 4, `repeatable`): their own settled actions of this turn since another player last did something but
 * pass, newest last, at most `SHORTCUT_MAX_STEPS`.
 */
function ownWindow(s: GameState, player: PlayerId): TurnActionRec[] {
  const list = s.turnActions ?? [];
  const own: TurnActionRec[] = [];
  for (let i = list.length - 1; i >= 0 && own.length < SHORTCUT_MAX_STEPS; i--) {
    const r = list[i]!;
    if (r.action.player === player) own.push(r);
    else if (r.action.type !== 'pass') break;
  }
  return own.reverse();
}

/**
 * Design 2: the body of a proposal to repeat `player`'s last `steps` actions: the span of `turnActions` from their `steps`-th newest action to the newest entry,
 * every player's entries included. Another player's entry inside the span must be a pass (implied by their agreement). Throws `IllegalAction` otherwise (CR
 * 733: the proposal is rejected, never half-applied).
 */
export function shortcutBody(s: GameState, action: Extract<Action, { type: 'shortcut' }>): TurnActionRec[] {
  const { player, steps, times } = action;
  if (!Number.isInteger(steps) || steps < 1 || steps > SHORTCUT_MAX_STEPS) {
    throw new IllegalAction(`A shortcut repeats from 1 to ${SHORTCUT_MAX_STEPS} of your actions.`, [...PROPOSE_RULES]);
  }
  if (!Number.isInteger(times) || times < 1 || times > SHORTCUT_MAX_TIMES) {
    throw new IllegalAction(`A shortcut repeats its actions from 1 to ${SHORTCUT_MAX_TIMES} times.`, [...PROPOSE_RULES]);
  }
  const list = s.turnActions ?? [];
  let own = 0;
  let start = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.action.player === player && ++own === steps) {
      start = i;
      break;
    }
  }
  if (start < 0) throw new IllegalAction(`You have taken ${own} action${own === 1 ? '' : 's'} this turn, not ${steps}: there is nothing more to repeat.`, [...PROPOSE_RULES]);
  const body = list.slice(start);
  if (body.some((r) => r.action.player !== player && r.action.type !== 'pass')) {
    throw new IllegalAction('Another player acted during those steps: a shortcut repeats only your own actions and the passes in between.', [...PROPOSE_RULES]);
  }
  return body;
}

// ---- object ids -----------------------------------------------------------------------------------------------------------------------------------------

/** An object id (`o<n>`, core/game.ts#newObjectId); player ids and ability keys are not. */
const OBJECT_ID = /^o\d+$/;

/** `x` with every object id in it (deeply) replaced by `f` of it; the same value where nothing changed. */
export function mapObjectIds<T>(x: T, f: (id: ObjectId) => string): T {
  if (typeof x === 'string') return (OBJECT_ID.test(x) ? f(x) : x) as T;
  if (Array.isArray(x)) {
    const out = x.map((v) => mapObjectIds(v, f));
    return (out.some((v, i) => v !== x[i]) ? out : x) as T;
  }
  if (x !== null && typeof x === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      const w = mapObjectIds(v, f);
      if (w !== v) changed = true;
      out[k] = w;
    }
    return (changed ? out : x) as T;
  }
  return x;
}

const objectAt = (s: GameState, id: ObjectId): GameObject | undefined => (Object.hasOwn(s.objects, id) ? s.objects[id] : undefined);
const lkiAt = (s: GameState, id: ObjectId): LastKnown | undefined => (Object.hasOwn(s.lki, id) ? s.lki[id] : undefined);

/** What an object is, whatever its id: the card's `cardId` for a card, the definition for a token, an emblem or an ability (design 4). '?' when unknown. */
function identityOf(s: GameState, id: ObjectId): string {
  const o = objectAt(s, id) ?? lkiAt(s, id)?.object;
  if (o === undefined) return '?';
  return o.cardId !== undefined ? `card:${o.cardId}` : `${o.kind}:${o.defId}`;
}

/**
 * Design 4: a step's signature, its action and answers with every object id replaced by what the object is (`identityOf`), so a card that changed zones, or a
 * token made anew, reads the same. Internal only (it names cards): the view publishes only the number `loop` derived from it.
 */
export function stepSignature(s: GameState, r: TurnActionRec): string {
  return JSON.stringify(mapObjectIds([r.action, r.answers], (id) => identityOf(s, id)));
}

/** The ids of a zone, as `leftZone` names it (`ZoneKind`), for the owner of a zone each player has. */
function zoneIds(s: GameState, zone: LastKnown['leftZone'], owner: PlayerId): readonly ObjectId[] {
  switch (zone) {
    case 'library':
    case 'hand':
    case 'graveyard':
      return s.zones[zone][owner] ?? [];
    case 'battlefield':
    case 'stack':
    case 'exile':
    case 'command':
      return s.zones[zone];
    default:
      return [];
  }
}

const sameCounters = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean => {
  const ka = Object.keys(a).filter((k) => a[k] !== 0).sort();
  const kb = Object.keys(b).filter((k) => b[k] !== 0).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/**
 * Design 5.2: the object of `s` that a recorded id names now. 1: the id still names an object; 2: the object with the card of its last known information (the
 * same card wherever it went: a blink, a bounce, a reanimation); 3: the end of its `newId` chain; 4: a token or anything without a card: an object with the same
 * definition, owner and controller in the zone it left, preferring the same tapped state and counters, not one already bound in this entry, the first in zone
 * order; 5: the id as it was (the engine then rejects the step, which stops the shortcut).
 */
function rebindId(s: GameState, id: ObjectId, bound: ReadonlySet<ObjectId>): ObjectId {
  if (objectAt(s, id) !== undefined) return id;
  const l = lkiAt(s, id);
  if (l === undefined) return id;
  const card = l.object.cardId;
  if (card !== undefined) {
    for (const o of Object.values(s.objects)) if (o.cardId === card) return o.id;
  }
  let at: LastKnown | undefined = l;
  for (let i = 0; i < 64 && at?.newId !== undefined; i++) {
    const next: ObjectId = at.newId;
    if (objectAt(s, next) !== undefined) return next;
    at = lkiAt(s, next);
  }
  const was = l.object;
  const candidates = zoneIds(s, l.leftZone, was.owner).filter((x) => {
    const o = objectAt(s, x);
    return o !== undefined && !bound.has(x) && o.defId === was.defId && o.owner === was.owner && o.controller === was.controller;
  });
  const alike = candidates.find((x) => { const o = s.objects[x]!; return o.tapped === was.tapped && sameCounters(o.counters, was.counters); });
  return alike ?? candidates[0] ?? id;
}

/** Design 5.2: `x` (an action, its answers) with every object id rebound against `s` (`rebindId`), each recorded id to one object. */
export function rebindIds<T>(s: GameState, x: T): T {
  const memo = new Map<ObjectId, ObjectId>();
  const bound = new Set<ObjectId>();
  return mapObjectIds(x, (id) => {
    let r = memo.get(id);
    if (r === undefined) {
      r = rebindId(s, id, bound);
      memo.set(id, r);
      bound.add(r);
    }
    return r;
  });
}

// ---- steps in words ---------------------------------------------------------------------------------------------------------------------------------------

/** Every method of casting face down (CR 702.37c, 702.168a): the card's name is not public (CR 708.2). */
const FACE_DOWN_METHODS: ReadonlySet<string> = new Set(['morph', 'megamorph', 'disguise']);

const defName = (s: GameState, o: GameObject, face = o.face): string => {
  const def = Object.hasOwn(s.defs, o.defId) ? s.defs[o.defId] : undefined;
  return def?.faces[face]?.name ?? def?.name ?? 'a card';
};

/** The name every player saw of the object a recorded action named: its current object, else its last known information (CR 708.2: never a face-down card's). */
function publicName(s: GameState, id: ObjectId): string {
  const o = objectAt(s, id);
  if (o !== undefined) return o.faceDown ? 'a face-down card' : charsOfObject(s, o).name || defName(s, o);
  const l = lkiAt(s, id);
  if (l === undefined) return 'a card';
  return l.object.faceDown ? 'a face-down card' : l.chars?.name || defName(s, l.object);
}

/** The text of an object's ability by its key (the current object's, else the one its last known information had). */
function abilityText(s: GameState, id: ObjectId, key: string): string | undefined {
  const o = objectAt(s, id);
  if (o !== undefined) return o.faceDown ? undefined : enumerateAbilities(s, o).find((a) => a.key === key)?.def.text;
  const l = lkiAt(s, id);
  return l?.chars && !l.object.faceDown ? abilitiesFromChars(l.chars).find((a) => a.key === key)?.def.text : undefined;
}

/** Whether a recorded cast put its spell on the stack face down (its method, or the object it became), so its name is not public (CR 708.2). */
function castFaceDown(s: GameState, a: Extract<Action, { type: 'cast' }>): boolean {
  if (a.method !== undefined && FACE_DOWN_METHODS.has(a.method)) return true;
  let id: ObjectId | undefined = a.card;
  for (let i = 0; i < 8 && id !== undefined; i++) {
    const o = objectAt(s, id);
    if (o !== undefined) return o.faceDown;
    const l = lkiAt(s, id);
    if (l === undefined) return false;
    if (l.object.faceDown) return true;
    id = l.newId;
  }
  return false;
}

/**
 * Design 3: a recorded action in words, against the current state. Only public facts: every one of these actions happened in the open (a face-down spell or
 * card stays unnamed, CR 708.2).
 */
export function shortcutStepLabel(s: GameState, a: RecordedAction): string {
  switch (a.type) {
    case 'pass':
      return a.resolveAll === true ? 'Resolve all' : 'Pass priority';
    case 'activate':
      return `${publicName(s, a.source)}: ${abilityText(s, a.source, a.ability) ?? 'an ability'}`;
    case 'manualTrigger':
    case 'manualStatic':
      return `${publicName(s, a.source)}: ${abilityText(s, a.source, a.ability) ?? 'an ability'} (by hand)`;
    case 'cast': {
      if (castFaceDown(s, a)) return 'Cast a face-down spell';
      const o = objectAt(s, a.card) ?? lkiAt(s, a.card)?.object;
      return `Cast ${o !== undefined ? defName(s, o, a.face ?? 0) : 'a spell'}`;
    }
    case 'playLand': {
      const o = objectAt(s, a.card) ?? lkiAt(s, a.card)?.object;
      return `Play ${o !== undefined ? defName(s, o, a.face ?? 0) : 'a land'}`;
    }
    case 'special':
      return a.object !== undefined ? `${a.kind}: ${publicName(s, a.object)}` : a.kind;
  }
}

/**
 * Design 4: what a seated viewer's view shows of `turnActions`: `repeatable`, their own settled actions of this turn since another player last did something
 * but pass, in words, oldest first (absent when there is none); `loop`, the smallest `n` such that the signatures of their last `n` steps equal the `n` before
 * them (absent when there is no such `n`). Neither names an object id.
 */
export function shortcutViewOf(s: GameState, viewer: PlayerId): { repeatable?: string[]; loop?: number } {
  const own = ownWindow(s, viewer);
  if (own.length === 0) return {};
  const repeatable = own.map((r) => shortcutStepLabel(s, r.action));
  const sigs = own.map((r) => stepSignature(s, r));
  const len = sigs.length;
  for (let n = 1; 2 * n <= len; n++) {
    let same = true;
    for (let i = 0; i < n && same; i++) same = sigs[len - n + i] === sigs[len - 2 * n + i];
    if (same) return { repeatable, loop: n };
  }
  return { repeatable };
}
