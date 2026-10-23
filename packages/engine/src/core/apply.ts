/**
 * applyAction: the engine's single entry point. Pure function of (state, action).
 *
 * Re-execution model (see docs/ARCHITECTURE.md): an action runs on a clone of the input
 * state. If it needs a player decision, the run stops and the returned state carries
 * `pending` (the question) and `suspended` (base state + action + answers so far).
 * Answering re-runs the action from the base state with one more answer. Determinism
 * (seeded RNG in the state) guarantees the replay reaches the same point.
 */
import { clone, cloneState } from '../util/clone';
import type { GameState } from '../types/state';
import type { Action } from '../types/actions';
import type { DecisionAnswer } from '../types/decisions';
import type { PlayerId } from '../types/ids';
import type { GameEvent } from '../types/events';
import { Game, IllegalAction, NeedDecision, EngineBug } from './game';
import { startGame } from './start';
import { advance, passPriority } from './turn';
import { concedeGame } from './sba';
import { collectPendingTriggers } from './triggers';
import { unaliasAction } from './view';
import { earlyDenial, performPriorityAction } from './priority-actions';
import { throwDenial } from '../rules/denial';
// WP11 (review): installs the replacement funnels of moveObject, createToken, dealDamage and destroy (design 8.5). Every game state is made by core/create.ts,
// which imports this module, and every action is applied here, so the funnels are in place whatever else a caller imports.
import '../effects/funnels';

export interface ActionError {
  message: string;
  rules: string[];
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  /** Set when the action was illegal; `state` is then the unchanged input state (CR 733.1). */
  error?: ActionError;
}

export function applyAction(state: GameState, action: Action): ApplyResult {
  try {
    // m4 (audit 2026-10-12, CR 400.2): another player's hidden hand cards appear in a view under aliases; an action chosen from that view (a manual op
    // moving a card of that hand) names them by alias, which is translated back here (core/view.ts). Deterministic, so a replayed log gives the same game.
    const result = applyInner(state, unaliasAction(state, action));
    result.state.actionCount = state.actionCount + 1;
    return result;
  } catch (e) {
    if (e instanceof IllegalAction) return { state, events: [], error: { message: e.message, rules: e.rules } };
    throw e;
  }
}

function playerName(state: GameState, id: string): string {
  return state.players.find((p) => p.id === id)?.name ?? id;
}

function applyInner(state: GameState, action: Action): ApplyResult {
  if (action.type === 'startGame') throw new IllegalAction('The game has already started.');
  if ('player' in action && !state.players.some((p) => p.id === action.player)) {
    throw new IllegalAction(`Unknown player "${action.player}".`);
  }
  if (state.result && action.type !== 'setStops') throw new IllegalAction('The game is over.', ['CR 104.1']);
  const pending = state.pending;

  switch (action.type) {
    case 'concede':
      return concede(state, action.player);
    case 'setStops': {
      const s = cloneState(state);
      const p = s.players.find((x) => x.id === action.player)!;
      p.stops = clone(action.stops);
      // An action in progress is re-run from the state it started from when it is answered or cancelled: the new stops must be
      // there too, or the change would silently revert.
      if (s.suspended) {
        const base = cloneState(s.suspended.base);
        base.players.find((x) => x.id === action.player)!.stops = clone(action.stops);
        s.suspended = { ...s.suspended, base };
      }
      return { state: s, events: [] };
    }
    case 'answer': {
      if (!pending || pending.kind === 'priority' || !state.suspended) throw new IllegalAction('There is no decision to answer right now.');
      if (action.player !== pending.player) throw new IllegalAction(`Waiting for ${playerName(state, pending.player)} to decide.`);
      if (action.decisionId !== pending.id) throw new IllegalAction('That decision is no longer current.');
      const sus = state.suspended;
      // M12-2 (m12 design D11): in a multiplayer game each answer remembers who gave it (`Suspension.answeredBy`); a two-player game records nothing (D16)
      const by = state.options.multiplayer !== undefined && (sus.answeredBy?.length ?? 0) === sus.answers.length ? [...(sus.answeredBy ?? []), action.player] : undefined;
      return run(sus.base, sus.action, [...sus.answers, action.answer], by);
    }
    case 'cancel': {
      if (!pending || !state.suspended || !pending.cancellable) throw new IllegalAction('There is nothing to cancel.');
      if (pending.player !== action.player) throw new IllegalAction('Only the player making this decision can cancel it.');
      // CR 733.1: the entire action is reversed and any payments are canceled.
      const s = cloneState(state.suspended.base);
      s.log.push({ seq: s.counters.log++, turn: s.turn.number, text: `${playerName(s, action.player)} cancels.`, rules: ['CR 733.1'], level: 'info' });
      return { state: s, events: [] };
    }
    default: {
      if (!pending || pending.kind !== 'priority') {
        throw new IllegalAction(pending ? `${playerName(state, pending.player)} must first answer: ${pending.prompt}` : 'Nobody has priority.', ['CR 117.1']);
      }
      if (pending.player !== action.player) {
        throw new IllegalAction(`${playerName(state, pending.player)} has priority, not ${playerName(state, action.player)}.`, ['CR 117.1']);
      }
      const early = earlyDenial(state, action); // WP32: an illegal cast or land play is rejected before the state is cloned (same error)
      if (early) throwDenial(early);
      return run(state, action, []);
    }
  }
}

/** Run an action on a clone of `base`, with the given decision answers. */
export function run(base: GameState, action: Action, answers: DecisionAnswer[], answeredBy?: PlayerId[]): ApplyResult {
  if (action.type === 'concede') return runConcession(base, action.player, answers, answeredBy); // M12-2: only a multiplayer concession is run (and suspended) as an action
  const s = cloneState(base);
  s.pending = null;
  s.suspended = null;
  const g = new Game(s, answers, answeredBy);
  try {
    perform(g, action);
    if (!g.answersConsumed) throw new EngineBug('Not all decision answers were consumed (engine nondeterminism)');
    return { state: s, events: g.events };
  } catch (e) {
    if (e instanceof NeedDecision) {
      s.pending = e.decision;
      s.suspended = { base, action, answers: [...answers], ...(answeredBy ? { answeredBy: [...answeredBy] } : {}), emitted: g.events.length };
      return { state: s, events: g.events };
    }
    throw e;
  }
}

/**
 * How many of the events `applyAction(prev, action)` returned were returned already, to a viewer shown `prev`: answering a decision re-runs the suspended
 * action from the state it started from, so its events begin with the ones the run reported when it stopped for that decision (`Suspension.emitted`).
 * Zero for any other action, and for a viewer from whom `prev` hid another player's cancellable action in progress (they were given none of it, CR 733.1;
 * the same rule as the view's, core/view.ts). Only the newest stop is known: a viewer hidden from this stop of an action but not from an earlier one is
 * given that earlier part again.
 */
export function replayedEvents(prev: GameState, action: Action, viewer: PlayerId | null): number {
  const sus = prev.suspended;
  if (action.type !== 'answer' || !sus || sus.emitted === undefined) return 0;
  const hidden = prev.pending !== null && prev.pending.cancellable === true && viewer !== prev.pending.player;
  return hidden ? 0 : sus.emitted;
}

function perform(g: Game, action: Action): void {
  switch (action.type) {
    case 'startGame':
      startGame(g, action.concessions ?? []);
      return;
    case 'pass':
      passPriority(g, action.player);
      advance(g);
      return;
    case 'playLand':
    case 'cast':
    case 'activate':
    case 'manualTrigger':
    case 'manualStatic':
    case 'special':
      performPriorityAction(g, action);
      advance(g);
      return;
    default:
      throw new EngineBug(`perform: unexpected action ${action.type}`);
  }
}

function concede(state: GameState, player: string): ApplyResult {
  if (state.options.multiplayer !== undefined) return concedeMultiplayer(state, player);
  // An in-progress action is abandoned; the concession applies to the last settled state.
  const s = cloneState(state.suspended ? state.suspended.base : state);
  s.pending = null;
  s.suspended = null;
  const g = new Game(s);
  g.log(`${playerName(s, player)} concedes.`, { rules: ['CR 104.3a'], level: 'action' });
  concedeGame(g, player); // CR 104.3a: no effect can stop it
  if (!s.result) {
    if (s.priority.player === player) s.priority.player = g.nextPlayer(player);
    advance(g);
  } else {
    s.pending = null;
    s.priority.player = null; // the game is over: nobody has priority
  }
  return { state: s, events: g.events };
}

/**
 * M12-2 (m12 design D11, D12; CR 104.3a, 800.4a): a concession in a multiplayer game. The player concedes at once, whatever is happening (no effect can stop
 * it). When another player's action is suspended mid-way (a cast, a pass that is resolving something, blocks, damage assignment: any action), the
 * concession is applied to the state that action started from (`suspended.base`: the conceder leaves the game there, core/leave.ts), then the action is run
 * again with the answers already given: the engine is deterministic, so in every normal case it reaches the same point and the acting player keeps every
 * choice made. If it can't (an answer no longer fits because the leaver's objects or decisions were involved, or the pass would now resolve another object
 * because the conceder's spell left the stack), the action is rolled back to the state after the concession and its player starts it again, with a log
 * line saying why. The conceder's own suspended action is abandoned. A concession before the game has begun re-runs the start procedure (from scratch when
 * the answers no longer fit).
 */
function concedeMultiplayer(state: GameState, player: string): ApplyResult {
  if (state.players.find((p) => p.id === player)?.hasLost) throw new IllegalAction(`${playerName(state, player)} has already left the game.`, ['CR 104.5', 'CR 800.4a']);
  return runConcession(state, player, []);
}

/**
 * The concession as an action (`run` calls it for `concede`): what follows it (the leave procedure's moves, the triggers it causes, the next priority) may
 * need decisions, so it is suspended and re-run like any other action, from the state the player conceded in (`base`).
 *
 * Review fix 3: when `base` is itself waiting in an earlier player's concession, its suspension is followed down to the settled state of the innermost
 * action that is not a concession (or the settled state itself); every concession of that chain is applied there, in the order they were made (each its
 * own `left.order`), and only then is the innermost action re-run or rolled back. The decisions an earlier concession was waiting for are asked again
 * (the game around them changed); `answers` are the answers of this concession's own run.
 */
function runConcession(base: GameState, player: string, answers: DecisionAnswer[], answeredBy?: PlayerId[]): ApplyResult {
  const conceders: string[] = [player];
  let cur = base;
  while (cur.suspended?.action.type === 'concede') {
    conceders.unshift(cur.suspended.action.player);
    cur = cur.suspended.base;
  }
  const inner = cur.suspended;
  if (inner?.action.type === 'startGame') {
    // Review fix 2: the game has not begun: the start procedure runs again with every concession applied at the point it was made (core/start.ts), so
    // the shuffles, the opening hands and the answers already given stay exactly as they were.
    const at = inner.answers.length;
    const action: Action = { ...inner.action, concessions: [...(inner.action.concessions ?? []), ...conceders.map((p) => ({ player: p, at }))] };
    return run(inner.base, action, inner.answers, inner.answeredBy);
  }
  const s = cloneState(inner ? inner.base : cur);
  s.pending = null;
  s.suspended = null;
  const g = new Game(s, answers, answeredBy);
  try {
    const r = concedeIn(g, inner, conceders);
    if (!g.answersConsumed) throw new EngineBug('Not all decision answers were consumed (engine nondeterminism)');
    return r;
  } catch (e) {
    if (e instanceof NeedDecision) {
      s.pending = e.decision;
      s.suspended = { base, action: { type: 'concede', player }, answers: [...answers], ...(answeredBy ? { answeredBy: [...answeredBy] } : {}) };
      return { state: s, events: g.events };
    }
    throw e;
  }
}

function concedeIn(g: Game, sus: GameState['suspended'], conceders: readonly string[]): ApplyResult {
  const s = g.s;
  for (const p of conceders) {
    if (s.result || g.player(p).hasLost) continue;
    g.log(`${playerName(s, p)} concedes.`, { rules: ['CR 104.3a'], level: 'action' });
    concedeGame(g, p); // CR 104.3a: no effect can stop it; the leave procedure runs if the game goes on (CR 800.4a)
  }
  if (s.result) {
    s.pending = null;
    s.priority.player = null; // the game is over: nobody has priority
    return { state: s, events: g.events };
  }
  const names = conceders.map((p) => playerName(s, p)).join(' and ');
  if (sus) {
    const actor = 'player' in sus.action ? sus.action.player : null;
    const topBefore = sus.base.zones.stack.at(-1);
    // null: a conceder's own action, abandoned; a text: the re-run would not be the same action; undefined: re-run it
    const why = actor !== null && conceders.includes(actor) ? null
      : sus.action.type === 'pass' && s.zones.stack.at(-1) !== topBefore ? 'the object it was resolving left the game'
      : undefined;
    if (why === undefined) {
      // Review fix 1: the answers of the players who conceded are dropped, and every other answer must answer a decision of the player who gave it
      // (core/game.ts#choose), so no answer passes from one player to another.
      const keep = sus.answers.map((_a, i) => i).filter((i) => sus.answeredBy === undefined || !conceders.includes(sus.answeredBy[i]!));
      const answers = keep.map((i) => sus.answers[i]!);
      const by = sus.answeredBy ? keep.map((i) => sus.answeredBy![i]!) : undefined;
      // The concession's own events are turned into triggers now (CR 603.2, 603.6c: leaves-the-battlefield abilities), so the re-run, a new run of the
      // action, finds them waiting in the state.
      collectPendingTriggers(g);
      try {
        const r = run(cloneState(s), sus.action, answers, by);
        return { state: r.state, events: [...g.events, ...r.events] };
      } catch (e) {
        if (!(e instanceof Error)) throw e;
        g.log(`${playerName(s, actor ?? conceders[0]!)}'s action in progress is taken back: it no longer fits now that ${names} left the game (${e.message}). They may start it again.`, { rules: ['CR 104.3a', 'CR 800.4a', 'CR 733.1'], level: 'warning' });
      }
    } else if (why !== null) {
      g.log(`${playerName(s, actor ?? conceders[0]!)}'s action in progress is taken back: ${why} as ${names} left the game. They may start it again.`, { rules: ['CR 104.3a', 'CR 800.4a', 'CR 733.1'], level: 'warning' });
    }
  }
  advance(g);
  return { state: s, events: g.events };
}
