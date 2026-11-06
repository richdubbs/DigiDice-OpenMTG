/**
 * Turn structure and priority (CR 500-514, 117).
 * `advance` drives the game forward until some player must make a priority decision.
 */
import type { Step } from '../types/state';
import type { TurnPhase } from '../types/ability';
import { STEP_ORDER } from '../types/state';
import type { PlayerId } from '../types/ids';
import { EngineBug, type Game } from './game';
import { drawCards } from './zones';
import { performStateBasedActions } from './sba';
import { collectPendingTriggers, putPendingTriggersOnStack } from './triggers';
import { resolveTopOfStack } from './resolve';
import { restartGame } from './restart';
import { hasPriorityActions } from './legal';
import { endOfStepCleanup, beginStepTurnBasedActions, endCombatPhase } from './steps';
import { endDurations, expireAtLeaversTurn, expireAtStepStart, expireAtTurnStart } from './durations';
import { initiativeEvents, monarchEvents, speedEvents } from './designations';
import { addedPhaseBeforeSteps, addExtraTurns, endsPhase, firstStepOf, phaseKindOf, STEP_WORDS, takeExtraPhase, takeExtraStep } from './turn-effects';
import { TURN_BASED } from './registries';
import { playerControlAtCombatStart, playerControlAtTurnStart, withDecider } from './player-control';

const MAX_LOOP = 200_000;

/** Give priority to a player (CR 117.3). */
export function givePriority(g: Game, player: PlayerId): void {
  g.s.priority.player = player;
}

/**
 * Run the game until a player has to decide something at priority, or the game ends.
 * Other decisions are raised from inside via g.choose (and suspend the run).
 */
export function advance(g: Game): void {
  for (let guard = 0; guard < MAX_LOOP; guard++) {
    if (g.s.result) {
      g.s.pending = null;
      g.s.priority.player = null;
      return;
    }
    const p = g.s.priority.player;
    if (p !== null) {
      // CR 117.5: before a player receives priority, perform SBAs, then put triggers on the stack; repeat.
      // CR 603.2, 603.10, 704.3: what happened so far is turned into triggers BEFORE each state-based action pass, against the state it happened in: a
      // creature that dies to the pass still saw the damage or the entering that came before, and the pass's own events are the next window.
      // Before that, durations that are over end (CR 611.2b, 610.3; core/durations.ts) and the monarch's inherent triggers trigger (CR 725.2, 725.4), and
      // so does the inherent ability of speed (CR 702.179d).
      endDurations(g);
      monarchEvents(g);
      endDurations(g); // edh-players-18 (CR 610.3, 725.4): the monarch changed just now (the monarch left the game): "until an opponent becomes the monarch" sees it in this window
      speedEvents(g);
      initiativeEvents(g); // MX4: CR 726.2, 726.4
      collectPendingTriggers(g);
      if (performStateBasedActions(g)) continue;
      if (g.s.result) continue;
      // Review 2026-10-26 F4/F6 (owner, 2026-10-26: "stop for me even when a trigger lands after I passed"; CR 117.4 read with 603.3): new objects on the stack
      // begin a new round of passes, so a player who passed before the triggered abilities were put on the stack gets priority again before they resolve
      if (putPendingTriggersOnStack(g)) {
        g.s.priority.passes = 0;
        continue;
      }
      // M12-2 (m12 design D12; CR 800.4a, 800.4j): a player who left the game never receives priority: the next player in turn order does instead
      if (g.player(p).hasLost) {
        givePriority(g, g.nextPlayer(p));
        continue;
      }
      // M12-2 (m12 design D12; CR 117.4, 800.4a): players left the game after the others passed: when every player still in the game has passed in
      // succession, the top object resolves or the step ends now, nobody is asked again. Never true in a two-player game (`passPriority` ends the round).
      // When abilities triggered meanwhile (the leaver's permanents leaving, CR 603.6c), the passes were reset as they were put on the stack (above): the
      // player receives priority (CR 800.4a, 117.5) and a new round of passes begins, so every player can answer the new objects.
      if (g.s.priority.passes > 0 && g.s.priority.passes >= playersInTheGame(g)) {
        allPassed(g);
        continue;
      }
      if (shouldAutoPass(g, p)) {
        passPriority(g, p, true);
        continue;
      }
      g.s.pending = withDecider(g.s, { kind: 'priority', id: `d${g.s.counters.decision++}`, player: p, prompt: priorityPrompt(g, p), rules: ['CR 117.1'] }); // std-control-3: CR 723.5
      return;
    }
    // Nobody has priority: the current step is over (or has no priority, e.g. untap).
    goToNextStep(g);
  }
  throw new EngineBug('advance(): loop guard exceeded (the game made no progress)');
}

function priorityPrompt(g: Game, p: PlayerId): string {
  const stack = g.s.zones.stack;
  if (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    return `${g.player(p).name}: respond to ${g.nameOf(top)} or pass.`;
  }
  return `${g.player(p).name}: ${stepLabel(g.s.turn.step)}. Take an action or pass.`;
}

export function stepLabel(step: Step): string {
  const labels: Record<Step, string> = {
    untap: 'Untap step', upkeep: 'Upkeep', draw: 'Draw step', main1: 'Precombat main phase',
    beginCombat: 'Beginning of combat', declareAttackers: 'Declare attackers step', declareBlockers: 'Declare blockers step',
    combatDamage: 'Combat damage step', endCombat: 'End of combat step', main2: 'Postcombat main phase',
    end: 'End step', cleanup: 'Cleanup step',
  };
  return labels[step];
}

/**
 * Arena-style smart auto-pass (package AP1; it replaces FAST1 FXH's M2 rule): the engine passes priority for a player who does not
 * want to act or cannot act, using the player's real legal actions (`hasPriorityActions`: the cards in their hand, their permanents, their graveyard, with the
 * costs they can pay; passing, mana abilities (CR 605.3a) and the by-hand tools never count). AP1 review: while the player can activate a mana ability by hand
 * (CR 605.3b: painlands, City of Brass, Ancient Tomb), whose mana the payment check can't count, an action that would be legal with its mana paid counts too.
 *
 * - Full control, or the temporary hold-priority toggle (`StopSettings.holdPriority`, cleared when the turn ends): the player always gets the decision, also
 *   right after their own spell or ability (CR 117.3c).
 * - An object on the stack: right after they cast their own spell or activated their own ability (CR 117.3c) the player passes (Arena); to any other
 *   object they pass automatically when they have nothing to do but pass and mana abilities (two untapped lands and no instant), and decide themselves when
 *   they could cast a spell or activate a non-mana ability in response. TRG-STOP2 (owner, 2026-10-25: "cast an instant spell in between every single
 *   trigger"): "any other object" includes every triggered ability, theirs too, and their own spell or ability once something above it resolved
 *   (`priority.stackBase`), so a stack of triggers gives them a chance before each one resolves.
 * - An empty stack: their stops say in which steps they want to stop (Arena); in a step that is not a stop they pass, and at a stop they pass when they have
 *   nothing to do. TRG-STOP: right after a triggered ability resolved and left the stack empty (`priority.afterTrigger`), any step counts as a stop for every
 *   player, so they can act after a beginning-of-combat trigger before attackers are declared.
 * - RES-ALL "Resolve all" (`pass` with `resolveAll`, `priority.resolveAll`): the player passes until the stack is empty, or until another player casts a
 *   spell or activates an ability (`resetPasses`), whatever their other settings.
 *
 * OpenMTG accepts that whether the game stops for a player tells the other players something about that player's options (the M2 concern, CR 400.2); the
 * automatic pass is logged like a manual one when the stack is not empty (`passPriority`), so the log reads the same either way.
 */
export function shouldAutoPass(g: Game, p: PlayerId): boolean {
  const ps = g.player(p);
  const stack = g.s.zones.stack;
  if (stack.length > 0 && g.s.priority.resolveAll?.includes(p)) return true;
  if (ps.stops.fullControl || ps.stops.holdPriority === true) return false;
  if (stack.length > 0) {
    // Arena passes for you right after you cast/activate (put on the stack since the last resolution); you answer every trigger, yours too.
    const i = stack.length - 1;
    const top = g.obj(stack[i]!);
    if (top.controller === p && top.stack?.kind !== 'triggered' && i >= (g.s.priority.stackBase ?? 0)) return true;
  } else {
    const own = g.s.turn.activePlayer === p;
    const stops = own ? ps.stops.ownTurn : ps.stops.opponentTurn;
    if (!stops.includes(g.s.turn.step) && g.s.priority.afterTrigger === undefined) return true;
  }
  return !hasPriorityActions(g, p);
}

/** AP1: the hold-priority toggle lasts until the end of the turn (StopSettings.holdPriority); a new turn begins with it off for every player. */
function clearHoldPriority(g: Game): void {
  for (const p of g.s.players) if (p.stops.holdPriority !== undefined) delete p.stops.holdPriority;
}

/** CR 117.3d / 117.4: pass priority; if all players passed in succession, resolve or end the step. */
export function passPriority(g: Game, p: PlayerId, auto = false): void {
  if (g.s.priority.player !== p) throw new EngineBug(`passPriority: ${p} does not have priority`);
  g.s.priority.passes++;
  const live = playersInTheGame(g);
  // AP1: an automatic pass while something is on the stack is logged as a normal pass; the steps skipped with an empty stack are not
  // (a line for every step nobody stops in would bury the log).
  if (!auto || g.s.zones.stack.length > 0) g.log(`${g.player(p).name} passes.`, { rules: ['CR 117.3d'], level: 'info' });
  if (g.s.priority.passes >= live) {
    allPassed(g);
    return;
  }
  givePriority(g, g.nextPlayer(p));
}

/** The number of players still in the game (CR 117.4: "all players" are the players still in it, CR 800.4a). */
const playersInTheGame = (g: Game): number => g.s.players.filter((x) => !x.hasLost).length;

/** CR 117.4: all players passed in succession: the top object of the stack resolves, or, if the stack is empty, the step ends. */
function allPassed(g: Game): void {
  g.s.priority.passes = 0;
  if (g.s.zones.stack.length > 0) {
    const top = g.obj(g.s.zones.stack[g.s.zones.stack.length - 1]!);
    const trigger = top.stack?.kind === 'triggered' ? top.controller : undefined;
    resolveTopOfStack(g); // CR 117.4, 608
    // edh-next-137 (CR 727; Karn Liberated): the ability that resolved restarted the game: the new game begins (core/restart.ts); nothing of the old one goes on
    if (g.restartRequest !== null) { const r = g.restartRequest; g.restartRequest = null; restartGame(g, r, beginNextTurn); return; }
    const left = g.s.zones.stack.length;
    // TRG-STOP: a triggered ability that left the stack empty gives every player a stop in this step (shouldAutoPass)
    if (trigger !== undefined && left === 0) g.s.priority.afterTrigger = trigger;
    else delete g.s.priority.afterTrigger;
    // TRG-STOP2: what is left on the stack was there before anything put on it from now on (shouldAutoPass: your own spell again after a resolution)
    if (left > 0) g.s.priority.stackBase = left;
    else delete g.s.priority.stackBase;
    if (left === 0) delete g.s.priority.resolveAll; // RES-ALL: the stack is resolved
    // CR 117.3b: the active player receives priority after a spell or ability resolves (not when it ended the turn: no player gets priority, CR 724.1c).
    if (!g.s.result && !g.s.turn.ending && !g.s.turn.endingCombat) givePriority(g, activeOrNext(g)); // trek-18: nor when it ended the combat phase (CR 724.2c)
  } else {
    g.s.priority.player = null; // CR 500.2: the step ends
  }
}

/**
 * The player who receives the active player's priority (CR 117.3a-b): the active player, or, when they have left the game during their turn, the next player
 * in turn order (M12-2, m12 design D12; CR 800.4j: the turn goes on without an active player).
 */
export function activeOrNext(g: Game): PlayerId {
  const ap = g.s.turn.activePlayer;
  return g.player(ap).hasLost ? g.nextPlayer(ap) : ap;
}

/** Called when a player takes an action at priority (CR 117.3c: they receive priority again). */
export function resetPasses(g: Game): void {
  g.s.priority.passes = 0;
  // RES-ALL: another player cast or activated something: whoever was resolving all decides again (they may want to answer it). Review 2026-10-26 F4: the player
  // who acted is never one of them (a player resolving all is passed for while the stack is not empty, `shouldAutoPass`, and the list ends with the stack,
  // `allPassed`), so the whole list ends
  delete g.s.priority.resolveAll;
}

function goToNextStep(g: Game): void {
  const t = g.s.turn;
  if (t.ending) {
    endTheTurn(g);
    return;
  }
  if (t.endingCombat) {
    endTheCombatPhase(g);
    return;
  }
  endOfStepCleanup(g, t.step);
  if (t.step === 'combatDamage' && g.s.combat?.extraDamageStep) {
    // CR 510.4: after the first-strike combat damage step the phase gets a second combat damage step.
    beginStep(g, 'combatDamage');
    return;
  }
  if (t.step === 'cleanup' && t.cleanupAgain) {
    // CR 514.3a: another cleanup step begins.
    t.cleanupAgain = false;
    beginStep(g, 'cleanup');
    return;
  }
  // r4-fxb (CR 500.9): when an added step ends, the turn goes on as if the step (or the last step of the phase) it was added after had just ended
  let ended: Step = t.step;
  if (t.stepResume !== undefined && t.stepResume.length > 0) {
    ended = t.stepResume.pop()!;
    if (t.stepResume.length === 0) delete t.stepResume;
  }
  let added = addedPhaseBeforeSteps(g, ended) ? undefined : takeExtraStep(g, ended); // edh-misc-5: a phase created after the steps begins before them
  // edh-misc-5 (CR 614.10, 500.9): an added step is proposed like any step, so "skip your untap step" (Stasis) skips an additional untap step too; the turn goes on with the
  // next step added after the same step or phase, or as if the step it was added after had just ended
  while (added !== undefined && TURN_BASED.propose && !TURN_BASED.propose(g, { ev: 'step', step: added, whose: t.activePlayer })) added = takeExtraStep(g, ended);
  if (added !== undefined) {
    (t.stepResume ??= []).push(ended);
    g.log(`An additional ${STEP_WORDS[added]} begins.`, { rules: ['CR 500.9'], level: 'info' });
    beginStep(g, added);
    return;
  }
  const at = afterAddedPhases(g, ended);
  if (at === null) return;
  beginFirstStepAfter(g, STEP_ORDER.indexOf(at));
}

/** CR 500.1: the phase a step belongs to, by the names of replacement patterns (`TurnPhase`). */
const PHASE_OF_STEP: Readonly<Record<Step, TurnPhase>> = {
  untap: 'beginning', upkeep: 'beginning', draw: 'beginning', main1: 'precombatMain',
  beginCombat: 'combat', declareAttackers: 'combat', declareBlockers: 'combat', combatDamage: 'combat', endCombat: 'combat',
  main2: 'postcombatMain', end: 'ending', cleanup: 'ending',
};

/**
 * Begin the first step after the one at `idx` (-1: the turn's first step) that happens, or the next turn. M6-1 (m6 design E10, CR 614.10): each phase is
 * proposed before its first step, and each step before it begins, so "skip" replacements can replace them (core/turn-skip.ts); a skipped phase skips all
 * its steps. The rules' own skips come first: the starting player's first draw step (CR 103.8a) and the combat steps without attackers (CR 508.8).
 */
function beginFirstStepAfter(g: Game, idx: number): void {
  const t = g.s.turn;
  let skippedPhase: TurnPhase | null = null;
  for (;;) {
    idx++;
    if (idx >= STEP_ORDER.length) {
      beginNextTurn(g);
      return;
    }
    const step = STEP_ORDER[idx]!;
    const phase = PHASE_OF_STEP[step];
    if (phase === skippedPhase) continue;
    const firstOfPhase = idx === 0 || PHASE_OF_STEP[STEP_ORDER[idx - 1]!] !== phase;
    if (firstOfPhase && TURN_BASED.propose && !TURN_BASED.propose(g, { ev: 'phase', phase, whose: t.activePlayer })) {
      skippedPhase = phase; // CR 614.10: the phase does not happen; none of its steps begin
      continue;
    }
    if (t.skipSteps.includes(step)) {
      t.skipSteps = t.skipSteps.filter((x) => x !== step);
      continue;
    }
    // CR 508.8: if no creatures are declared as attackers, skip declare blockers and combat damage steps.
    if ((step === 'declareBlockers' || step === 'combatDamage') && !g.s.combat?.attacked && !(g.s.combat?.attackers.length)) continue; // edh-d-55: a creature put onto the battlefield attacking also keeps these steps (CR 508.8)
    // M6-0 (m6 design 2.6, E10): the step is proposed before it begins, so a "skip" replacement can replace it (CR 614.10).
    if (TURN_BASED.propose && !TURN_BASED.propose(g, { ev: 'step', step, whose: t.activePlayer })) continue;
    beginStep(g, step);
    return;
  }
}

/**
 * CR 500.8: phases an effect added. `ended` is the step that just ended. If it ended a phase and a phase was added after a phase of that kind, the most recently
 * created one begins now (returns null). When an added phase ends, the turn goes on as if the phase it was added after had just ended (and if that one was an
 * added phase too, as if ITS anchor had ended). Returns the step after which the turn continues normally.
 */
function afterAddedPhases(g: Game, ended: Step): Step | null {
  const t = g.s.turn;
  let at = ended;
  let endedId = t.addedPhaseId; // trek-20: the added phase that just ended (a main phase "followed by" it waits for exactly this one)
  let atMains = t.mains ?? 0; // trek-20: and how many main phases had begun when the phase `at` ended ("the second main phase")
  if (endsPhase(ended)) { delete t.combatAttackers; delete t.addedPhaseId; } // std-rq (CR 500.8): an added combat phase's attacker restriction lasts for that phase only; edh-combat-5: so does its id
  let inAdded = (t.phaseResume?.length ?? 0) > 0; // a phase that ends while a resume point is open is the added phase of that point
  while (endsPhase(at)) {
    const phase = takeExtraPhase(g, phaseKindOf(at), atMains, endedId);
    // edh-next-142 (CR 614.10, 500.11, 500.8; Fatespinner, ruling 2004-12-01): an added phase is proposed before it begins, as every phase is (beginFirstStepAfter), so "skips each instance of
    // the chosen step or phase this turn" skips an added combat or main phase too: it does not happen, and the turn goes on as if it had just ended (a phase added after it still comes)
    if (phase && TURN_BASED.propose && !TURN_BASED.propose(g, { ev: 'phase', phase: phase === 'combat' ? 'combat' : 'postcombatMain', whose: t.activePlayer })) {
      (t.phaseResume ??= []).push({ after: at, added: inAdded, ...(endedId !== undefined ? { id: endedId } : {}), mains: atMains });
      g.log(`An additional ${phase} phase is skipped.`, { rules: ['CR 614.10', 'CR 500.8'], level: 'info' });
      endedId = t.addedPhaseId;
      delete t.addedPhaseId;
      delete t.combatAttackers;
      at = phase === 'combat' ? 'endCombat' : 'main2';
      inAdded = true;
      continue;
    }
    if (phase) {
      (t.phaseResume ??= []).push({ after: at, added: inAdded, ...(endedId !== undefined ? { id: endedId } : {}), mains: atMains });
      g.log(`An additional ${phase} phase begins.`, { rules: ['CR 500.8'], level: 'info' });
      beginStep(g, firstStepOf(phase));
      return null;
    }
    if (!inAdded) break;
    const back = t.phaseResume!.pop()!;
    if (t.phaseResume!.length === 0) delete t.phaseResume;
    at = back.after;
    inAdded = back.added;
    endedId = back.id; // trek-20: the anchor's own phase and main-phase count again, not those of the phase that just ended
    atMains = back.mains ?? atMains;
  }
  return at;
}

/**
 * CR 724.1c-e: the turn was ended by an effect (the handler did 724.1a-b). 724.1c: state-based actions are checked (until none is performed), but no player gets
 * priority and no triggered ability is put on the stack (what triggers waits for the cleanup step, 724.1f); this comes BEFORE the cleanup step, which ends
 * "until end of turn" effects (514.2), so a creature with lethal damage or 0 toughness from earlier in the resolution dies. 724.1d: the current step ends;
 * during combat the creatures are removed from combat and the combat phase is over; every other phase and step, added ones included, is skipped up to the
 * cleanup step (if the turn was ended during the cleanup step, a new cleanup step begins). "At the beginning of the end step" abilities don't trigger (724.1e).
 */
function endTheTurn(g: Game): void {
  const t = g.s.turn;
  delete t.ending;
  delete t.endingCombat; // trek-18: the whole turn ends
  g.log('The turn is ending: state-based actions are checked, and no player gets priority.', { rules: ['CR 724.1c'], level: 'info' });
  for (;;) {
    collectPendingTriggers(g); // what happened so far triggers against the state it happened in (CR 603.10, as in `advance`); it is stacked in the cleanup step
    if (!performStateBasedActions(g) || g.s.result) break;
  }
  if (g.s.result) return;
  endOfStepCleanup(g, t.step);
  if (g.s.combat) endCombatPhase(g); // CR 724.1d, 500.5a
  delete t.extraPhases;
  delete t.phaseResume;
  delete t.extraSteps; // r4-fxb (CR 724.1d: added steps are skipped too)
  delete t.anchorSeq; // edh-misc-5
  delete t.combatAttackers; // std-rq
  delete t.extraPhaseSeq; // edh-combat-5
  delete t.addedPhaseId;
  delete t.stepResume;
  t.cleanupAgain = false;
  g.log('The turn ends: the game skips to the cleanup step.', { rules: ['CR 724.1d', 'CR 724.1e'], level: 'info' });
  beginStep(g, 'cleanup');
}

/**
 * trek-18 (CR 724.2c-f): an effect ended the combat phase (the handler did 724.2a-b). State-based actions are checked, no priority and no triggered ability put on the stack (what
 * triggers waits for the next phase, 724.2f); the combat phase ends: creatures are removed from combat and effects "until end of combat" expire (724.2d, core/steps.ts#endCombatPhase);
 * the rest of the phase is skipped, the end of combat step with it, so "at end of combat" abilities don't trigger (724.2e). The turn goes on as if the end of combat step had just
 * ended, so a phase added after this combat phase, or the resume point of an added combat phase, is honored (CR 500.8, afterAddedPhases).
 */
function endTheCombatPhase(g: Game): void {
  const t = g.s.turn;
  delete t.endingCombat;
  g.log('The combat phase is ending: state-based actions are checked, and no player gets priority.', { rules: ['CR 724.2c'], level: 'info' });
  for (;;) {
    collectPendingTriggers(g); // what happened so far triggers against the state it happened in; it is stacked in the next phase (724.2f)
    if (!performStateBasedActions(g) || g.s.result) break;
  }
  if (g.s.result) return;
  endOfStepCleanup(g, 'endCombat'); // the combat phase is over: mana that lasts "until end of combat" is lost with it, whatever step it ended in (CR 724.2d, 500.5)
  endCombatPhase(g); // CR 724.2d
  delete t.extraSteps; // r4-fxb: steps added to this combat phase are skipped with the rest of it (the order numbers of the phases still queued stay: CR 500.8)
  delete t.stepResume;
  g.log('The combat phase ends: the game skips to the next phase.', { rules: ['CR 724.2d', 'CR 724.2e'], level: 'info' });
  const at = afterAddedPhases(g, 'endCombat');
  if (at === null) return;
  beginFirstStepAfter(g, STEP_ORDER.indexOf(at));
}

export function beginStep(g: Game, step: Step): void {
  g.s.turn.step = step;
  g.s.priority.passes = 0;
  g.s.priority.player = null;
  delete g.s.priority.afterTrigger; // TRG-STOP: the stop after a trigger lasts only for the step it resolved in
  delete g.s.priority.stackBase; // TRG-STOP2
  delete g.s.priority.resolveAll; // RES-ALL
  expireAtStepStart(g, step); // "until your next upkeep" and the like (CR 611.2a)
  if (step === 'beginCombat') playerControlAtCombatStart(g); // std-control-3 (CR 723.1, 506.1): "during their next combat phase"
  // CMD3 (CR 702.30a): the turns of the active player's last two upkeep steps, for "since the beginning of your last upkeep" (echo)
  if (step === 'upkeep' && !g.player(g.s.turn.activePlayer).hasLost) {
    const p = g.player(g.s.turn.activePlayer);
    p.upkeepTurns = [...(p.upkeepTurns ?? []), g.s.turn.number].slice(-2);
  }
  // FAST5X E17, CR 505.1b: the main phases are counted as they occur in the turn ("second main phase"); an additional main phase is one of them (CR 505.1a)
  const mainPhase = step === 'main1' || step === 'main2' ? (g.s.turn.mains = (g.s.turn.mains ?? 0) + 1) : undefined;
  const upkeepStep = step === 'upkeep' ? (g.s.turn.upkeeps = (g.s.turn.upkeeps ?? 0) + 1) : undefined; // edh-d-71 (CR 503.1, 500.9): the upkeep steps are counted as they occur in the turn, an additional one included
  g.emit({ type: 'stepBegan', step, activePlayer: g.s.turn.activePlayer, ...(mainPhase !== undefined ? { mainPhase } : {}), ...(upkeepStep !== undefined ? { upkeepStep } : {}), ...(step === 'endCombat' && g.s.combat != null ? { combatPhase: g.s.combat.number } : {}) /* edh-d-34: "the end of the first combat phase" (CR 500.8) */, ...(g.s.turn.addedPhaseId !== undefined ? { addedPhase: g.s.turn.addedPhaseId } : {}) });
  // Turn-based actions (CR 703) happen before anyone gets priority; returns whether players get priority.
  const priority = beginStepTurnBasedActions(g, step);
  if (priority && !g.s.result) givePriority(g, activeOrNext(g)); // CR 117.3a; M12-2: CR 800.4j, the next player when the active player has left
}

/**
 * edh-next-119 (CR 723.1, 500.7; Emrakul, the Promised End and its rulings of 2025-01-24): the current turn is ending and the next one is about to be chosen (core/turn.ts#beginNextTurn): each active
 * turn record of the active player that says "After that turn, that player takes an extra turn." adds one extra turn of that player, taken directly after this one (each such record its own turn: two
 * effects that controlled the same turn make two). A player who has left the game takes none (CR 800.4a). A turn that was skipped never began, so its record never became active and adds nothing yet.
 */
function playerControlAtTurnEnd(g: Game): void {
  const recs = g.s.playerControl;
  if (recs === undefined) return;
  const active = g.s.turn.activePlayer;
  for (const r of recs) {
    if (r.thenExtraTurn !== true || r.during !== 'turn' || r.active !== true || r.player !== active || g.player(r.player).hasLost === true) continue;
    delete r.thenExtraTurn; // once
    addExtraTurns(g, r.player, 1);
  }
}

/**
 * CR 500.7: the next turn is the most recently created extra turn whose player is still in the game; otherwise the normal turn order goes on from the last
 * turn that was not an extra turn (an extra turn is added directly after a turn, so it does not change whose turn comes next).
 */
function nextTurnPlayer(g: Game): { player: PlayerId; extra: boolean; id?: number } {
  const t = g.s.turn;
  while (t.extraTurns.length > 0) {
    const p = t.extraTurns.shift()!;
    const id = t.extraTurnIds?.shift(); // audit-fix-2: the turn's id, in step with `extraTurns` (core/turn-effects.ts#addExtraTurns)
    if (g.player(p).hasLost) {
      expireAtLeaversTurn(g, p); // M12-2: CR 800.4k, 800.4m: the turn doesn't begin, but what lasts until it ends as it would have begun
      continue; // CR 800.4a: a player who left the game takes no turn
    }
    if (!t.extra && t.number > 0) t.normalActive = t.activePlayer; // the turn the extra turns come after
    return { player: p, extra: true, ...(id !== undefined && id >= 0 ? { id } : {}) };
  }
  if (t.number === 0) return { player: g.player(t.startingPlayer).hasLost ? g.nextPlayer(t.startingPlayer) : t.startingPlayer, extra: false }; // M12-2: CR 800.4k
  const after = t.normalActive ?? t.activePlayer;
  delete t.normalActive; // only kept while extra turns run, so a game without extra turns has the state it always had
  const next = g.nextPlayer(after);
  // M12-2 (m12 design D14; CR 800.4k, 800.4m): the turns of the players who left, seated between, don't begin; what lasts until them ends as they would have
  if (g.s.options.multiplayer !== undefined) {
    const ids = g.s.players.map((p) => p.id);
    for (let i = (ids.indexOf(after) + 1) % ids.length; ids[i] !== next && ids[i] !== after; i = (i + 1) % ids.length) {
      if (g.player(ids[i]!).hasLost) expireAtLeaversTurn(g, ids[i]!);
    }
  }
  return { player: next, extra: false };
}

export function beginNextTurn(g: Game): void {
  const t = g.s.turn;
  playerControlAtTurnEnd(g); // edh-next-119 (CR 723.1, 500.7): "After that turn, that player takes an extra turn."
  let { player: next, extra, id } = nextTurnPlayer(g);
  // M6-1 (m6 design E10, CR 614.10): the turn is proposed before it begins, so "skip your next turn" can replace it. A skipped turn does not happen: the turn
  // order goes on as if it had been taken (the next normal turn is the player after its player, CR 500.7), and the next turn is proposed in turn. A static
  // effect that would skip every turn is bounded (the game would make no progress): after 32 skips in a row the turn begins.
  for (let skips = 0; skips < 32 && TURN_BASED.propose && !TURN_BASED.propose(g, { ev: 'turn', whose: next, extra }); skips++) {
    if (!extra) {
      t.activePlayer = next;
      delete t.extra;
    }
    ({ player: next, extra, id } = nextTurnPlayer(g));
  }
  t.number++;
  t.activePlayer = next;
  t.skipSteps = [];
  t.combats = 0;
  delete t.mains; // FAST5X E17 (CR 505.1b): no main phase has occurred in the new turn yet
  delete t.upkeeps; // edh-d-71 (CR 503.1): no upkeep step has begun in the new turn yet
  delete t.extraPhases;
  delete t.phaseResume;
  delete t.extraSteps; // r4-fxb
  delete t.anchorSeq; // edh-misc-5
  delete t.combatAttackers; // std-rq
  delete t.attacksBy; // edh-d-89 (CR 508.1a, 723.1): "you choose which creatures attack this turn" ends with the turn
  delete t.blocksBy;
  delete t.extraPhaseSeq; // edh-combat-5
  delete t.addedPhaseId;
  delete t.stepResume;
  delete t.ending;
  delete t.endingCombat; // trek-18
  delete t.nextSpell; // Standard round 10: "the next spell you cast this turn" riders end with the turn (CR 611.2)
  if (extra) t.extra = true;
  else delete t.extra;
  if (id !== undefined) t.extraTurnId = id; // audit-fix-2 (CR 500.7, 611.2a): which extra turn this is, for "During that turn"
  else delete t.extraTurnId;
  // edh-next-46 (CR 500.7, 502.1, 614.10; Savor the Moment): "Skip the untap step of that turn" is a skip of this turn's untap step, decided when the turn begins
  const skipUntapAt = id !== undefined ? t.extraTurnSkipUntap?.indexOf(id) ?? -1 : -1;
  if (skipUntapAt >= 0) t.extraTurnSkipUntap!.splice(skipUntapAt, 1);
  if (t.extraTurnSkipUntap?.length === 0) delete t.extraTurnSkipUntap;
  if (t.extraTurnIds?.length === 0) delete t.extraTurnIds;
  g.s.combat = null;
  delete g.s.turnActions; // shortcuts (CR 727, docs/design/shortcuts.md 1): only the actions of the current turn can be repeated
  // edh-cast-10 (CR 601.3, 611.2a): the one-card counters of a lasting permission (`single:<order>`, statics/play-permits.ts#singleKeyOf) outlast the turn: "Until the end of your next turn, you may cast
  // an instant or sorcery spell from among those exiled cards" (Chandra, Hope's Beacon) allows ONE spell in all (the key is the effect's own order: a new effect has a new key)
  g.s.turnActivations = Object.fromEntries(Object.entries(g.s.turnActivations).filter(([k]) => k.startsWith('single:')));
  clearHoldPriority(g);
  if (g.player(next).lastTurnStarted > 0) g.player(next).previousTurnStarted = g.player(next).lastTurnStarted; // edh-next-135 (CR 500.1): "your last turn" during your own turn
  g.player(next).lastTurnStarted = t.number;
  g.player(next).turnsBegun = (g.player(next).turnsBegun ?? 0) + 1; // std-r9: "your first, second, or third turns of the game" (CR 500.7, 500.11)
  if (extra) g.player(next).extraTurnsBegun = (g.player(next).extraTurnsBegun ?? 0) + 1; // trek-18: "if you haven't begun an extra turn this game" (CR 500.7)
  for (const p of g.s.players) {
    p.landsPlayedThisTurn = 0;
    p.turnStats = { lifeGained: 0, lifeLost: 0, spellsCast: 0, cardsDrawn: 0, lifeAtTurnStart: p.life }; // edh-next-19: CR 119.1, 500.1
  }
  // CR 103.8a: in a two-player game the starting player skips the draw step of their first turn; CR 103.8c, 800.7: in a multiplayer game (one that began
  // with more than two players, CR 800.1; M12-1: `options.multiplayer`, m12 design D1) nobody does.
  if (t.number === 1 && g.s.options.multiplayer === undefined) t.skipSteps.push('draw');
  if (skipUntapAt >= 0) t.skipSteps.push('untap'); // edh-next-46
  g.log(`Turn ${t.number}: ${g.player(next).name}${extra ? ' (an extra turn)' : ''}.`, { ...(extra ? { rules: ['CR 500.7'] } : {}), level: 'info' });
  { const d = g.s.designations; if (d.monarch !== undefined) d.monarchAtTurnStart = d.monarch; else delete d.monarchAtTurnStart; } // edh-next-82 (CR 725.1): "if you were the monarch as the turn began"
  expireAtTurnStart(g, next); // "until your next turn" (CR 611.2a)
  playerControlAtTurnStart(g, next); // std-control-3 (CR 723.1): last turn's player control ends, this turn's begins
  g.emit({ type: 'turnBegan', turn: t.number, activePlayer: next });
  beginFirstStepAfter(g, -1); // M6-1: the beginning phase and the untap step are proposed too (CR 614.10)
}

/** Draw the opening hands etc. is in start.ts; this helper is used by the draw step. */
export function drawStepDraw(g: Game): void {
  drawCards(g, g.s.turn.activePlayer, 1); // CR 504.1
}
