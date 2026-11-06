/**
 * Shortcuts (CR 727; docs/design/shortcuts.md 3 and 5): performing a proposed shortcut. Citations from memory, UNVERIFIED (rules/cr/ is not available in a
 * cloud session): CR 727.2a (the proposal), 727.2b (each other player accepts or names where they will deviate), 727.2c (it is performed up to there).
 *
 * The `shortcut` action runs through core/apply.ts#run like any priority action, so the consents are ordinary decisions (`g.choose`): the run suspends on
 * each and resumes when it is answered. Once every other player has answered, the same run plays the passes: every recorded action of the body, rebound to
 * the objects of now (core/shortcut.ts#rebindIds), is applied with the answers it took, by the lenient inner runner core/apply.ts passes in (`StepRunner`),
 * on the working state. A step that no longer goes the same way is not applied (CR 733.1) and ends the shortcut; a player's stop point ends it with that
 * player holding priority. Nothing is ever extrapolated: every pass is really played (design 5.7).
 */
import type { Action } from '../types/actions';
import type { DecisionAnswer } from '../types/decisions';
import type { GameEvent } from '../types/events';
import type { PlayerId } from '../types/ids';
import type { GameState, TurnActionRec } from '../types/state';
import { EngineBug, type Game } from './game';
import { advance, stepLabel } from './turn';
import { PROPOSE_RULES, rebindIds, shortcutBody, shortcutStepLabel } from './shortcut';

/** What one recorded step gave when the inner runner applied it: the state after it, or why it no longer goes the same way (the step is not applied). */
export type StepRun = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; why: string };

/**
 * The lenient inner runner (core/apply.ts#runLenient): `action` with `answers` on a clone of `base`, ending settled, or why not (an illegal action or answer, a
 * question the answers did not cover, answers left over). Never leaves an unanswered decision: a step that does not settle is not applied.
 */
export type StepRunner = (base: GameState, action: Action, answers: readonly DecisionAnswer[], answeredBy?: readonly PlayerId[]) => StepRun;

type ShortcutAction = Extract<Action, { type: 'shortcut' }>;
type Stop = { pass: number; step: number };

/** How the passes ended. */
type Outcome = { kind: 'done' } | { kind: 'over' } | { kind: 'stop'; player: PlayerId } | { kind: 'differs'; why: string } | { kind: 'turn' };

const nameOf = (g: Game, p: PlayerId): string => g.player(p).name;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 'es'}`;

/** The other players still in the game, in turn order starting after `proposer` (CR 727.2b, unverified). */
function othersInTurnOrder(g: Game, proposer: PlayerId): PlayerId[] {
  const ids = g.s.players.map((p) => p.id);
  const at = ids.indexOf(proposer);
  return [...ids.slice(at + 1), ...ids.slice(0, at)].filter((p) => !g.player(p).hasLost);
}

/**
 * Perform `shortcut` (core/apply.ts#perform): check the proposal (design 2), ask each other player (design 3), then play the passes (design 5). `runStep` is
 * core/apply.ts's lenient inner runner, passed in so this module does not import core/apply.ts (no import cycles).
 */
export function performShortcut(g: Game, action: ShortcutAction, runStep: StepRunner): void {
  const proposer = action.player;
  const body = shortcutBody(g.s, action);
  const steps = body.filter((r) => r.action.player === proposer).map((r) => shortcutStepLabel(g.s, r.action));
  const times = action.times;
  g.log(`${nameOf(g, proposer)} proposes a shortcut: ${steps.join(' / ')}, ${times} time${times === 1 ? '' : 's'}.`, { rules: [...PROPOSE_RULES], level: 'action' });
  // CR 727.2b (unverified): each other player, in turn order, accepts or names the point where they want priority
  const stops = new Map<PlayerId, Stop>();
  for (const p of othersInTurnOrder(g, proposer)) {
    const ans = g.choose({
      kind: 'shortcut', player: p, proposer, times, steps, rules: ['CR 727.2b'],
      prompt: `${nameOf(g, proposer)} proposes to repeat ${steps.length === 1 ? 'one step' : `${steps.length} steps`} ${times} time${times === 1 ? '' : 's'}: ${steps.join(' / ')}. Let it run, or name where you want priority.`,
    });
    if (ans.stop !== undefined) {
      stops.set(p, { pass: ans.stop.pass, step: ans.stop.step });
      g.log(`${nameOf(g, p)} will take priority at pass ${ans.stop.pass}, after step ${ans.stop.step}.`, { rules: ['CR 727.2b'], level: 'action' });
    } else {
      g.log(`${nameOf(g, p)} lets it run.`, { rules: ['CR 727.2b'], level: 'action' });
    }
  }
  // The run cleared `pending` (core/apply.ts#run): the proposer receives priority again, as in the state they proposed in (nothing changed since)
  advance(g);
  playPasses(g, action, body, stops, runStep);
}

/** The entry to apply next: a recorded one of the body (and the index after it), or a plain pass for a player the shortcut passes for (consented). */
interface Next {
  rec: Pick<TurnActionRec, 'action' | 'answers' | 'answeredBy'>;
  after: number;
  own: boolean;
}

/**
 * Design 5.1, 5.4, 5.5: play the passes on the working state (`g.s`, replaced by the state after each applied step). Position: (pass number, proposer steps
 * applied in this pass). Between steps, `g.s.pending` says who has priority: the proposer applies their next body entry (another player's entry that comes
 * first was passed for automatically this time); another player is stopped at their stop point, or applies their recorded pass, or a plain pass.
 */
function playPasses(g: Game, action: ShortcutAction, body: readonly TurnActionRec[], stops: ReadonlyMap<PlayerId, Stop>, runStep: StepRunner): void {
  const proposer = action.player;
  const times = action.times;
  // A safety net beyond the design: the steps one pass may take (its entries, and plain passes for the other players), so a pass that never comes back to
  // the proposer (the turn moving on with the others passed for) ends the shortcut instead of running on.
  const cap = body.length + 4 * g.s.players.length + 8;
  // A loop is a thing of one priority sequence (coordinator decision 2026-10-30; design 5.3): a step that moves the game to another turn or another step of
  // the turn ends the shortcut after it (the step stays applied: it was legal and really happened), so automatic passing never carries a shortcut onward
  const startTurn = g.s.turn.number;
  const startStep = g.s.turn.step;
  let pass = 1;
  let idx = 0;
  let applied = 0;
  let runs = 0;
  let passLog = g.s.log.length;
  let passEvents: GameEvent[] = [];
  let outcome: Outcome;
  for (;;) {
    const cur = g.s;
    if (cur.result !== null) {
      outcome = { kind: 'over' };
      break;
    }
    if (idx >= body.length) {
      // Design 5.5: a later pass that went the same way is not worded again (its log lines are cut, its events dropped); the state keeps all of it
      if (pass >= 2) {
        cur.log.length = passLog; // the working state's own array (cloneState copies it), entries shared and never edited
        passEvents = [];
      }
      if (pass >= times) {
        outcome = { kind: 'done' };
        break;
      }
      pass++;
      idx = 0;
      applied = 0;
      runs = 0;
      passLog = cur.log.length;
      continue;
    }
    const pend = cur.pending;
    if (pend === null || pend.kind !== 'priority') throw new EngineBug(`shortcut: a step left a ${pend?.kind ?? 'missing'} decision in the working state`);
    const holder = pend.player;
    let next: Next | null = null;
    if (holder === proposer) {
      let j = idx;
      while (j < body.length && body[j]!.action.player !== proposer) j++;
      if (j >= body.length) {
        idx = j; // the rest are other players' passes: the engine passed for them this time
        continue;
      }
      next = { rec: body[j]!, after: j + 1, own: true };
    } else {
      // CR 727.2b (unverified): a player who named a point gets priority the first time they would receive it at or after it
      const stop = stops.get(holder);
      if (stop !== undefined && (pass > stop.pass || (pass === stop.pass && applied >= stop.step))) {
        outcome = { kind: 'stop', player: holder };
        break;
      }
      let j = idx;
      while (j < body.length && body[j]!.action.player !== proposer && body[j]!.action.player !== holder) j++;
      next = j < body.length && body[j]!.action.player === holder
        ? { rec: body[j]!, after: j + 1, own: false }
        : { rec: { action: { type: 'pass', player: holder }, answers: [] }, after: idx, own: false }; // their agreement: passed for
    }
    if (++runs > cap) {
      outcome = { kind: 'differs', why: 'the other players were passed for again and again without the loop coming back' };
      break;
    }
    // Design 5.2: the recorded ids, rebound to the objects of now; the engine checks the rebound step as usual, so a wrong binding can only stop the shortcut
    const rebound = rebindIds(cur, { action: next.rec.action, answers: next.rec.answers });
    const r = runStep(cur, rebound.action, rebound.answers, next.rec.answeredBy);
    if (!r.ok) {
      outcome = { kind: 'differs', why: r.why };
      break;
    }
    g.s = r.state;
    if (pass === 1) g.events.push(...r.events);
    else passEvents.push(...r.events);
    idx = next.after;
    if (next.own) applied++;
    if (g.s.result === null && (g.s.turn.number !== startTurn || g.s.turn.step !== startStep)) {
      outcome = { kind: 'turn' };
      break;
    }
  }
  // A pass that ended part-way keeps its log lines and events (what of it was applied stays applied)
  g.events.push(...passEvents);
  // a step that moved the turn on may have been the last of its pass, which is then done in full
  const done = outcome.kind === 'done' ? times : outcome.kind === 'turn' && idx >= body.length ? pass : pass - 1;
  const full = `${plural(done, 'pass')} done in full`;
  switch (outcome.kind) {
    case 'done':
      g.log(times === 1 ? 'The shortcut is done (1 pass).' : `Passes 2 to ${times} went the same way (${times} passes in all).`, { rules: ['CR 727.2c'], level: 'info' });
      return;
    case 'over':
      g.log(`The game is over: the shortcut ends during pass ${pass} (${full} before it).`, { rules: ['CR 727.2c'], level: 'info' });
      return;
    case 'stop':
      g.log(`${nameOf(g, outcome.player)} takes priority at pass ${pass}, after step ${applied}, as they asked: the shortcut ends there (${full}).`, { rules: ['CR 727.2b'], level: 'info' });
      return;
    case 'turn': {
      const where = stepLabel(g.s.turn.step);
      g.log(`The shortcut ends during pass ${pass}, step ${applied}: the turn moved on (to turn ${g.s.turn.number}, ${where.charAt(0).toLowerCase()}${where.slice(1)}). ${nameOf(g, proposer)} plays on by hand (${full}).`, { rules: ['CR 727.2c'], level: 'info' });
      return;
    }
    case 'differs':
      g.log(`The shortcut stops before pass ${pass}, step ${applied + 1}: the loop no longer goes the same way: ${outcome.why.replace(/\.$/, '')}. ${nameOf(g, proposer)} plays on by hand (${full}).`, { rules: ['CR 727.2c', 'CR 733.1'], level: 'warning' });
      return;
  }
}
