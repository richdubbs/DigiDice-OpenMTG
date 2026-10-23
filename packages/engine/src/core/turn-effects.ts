/**
 * Effects on the turn structure (CR 500.7 extra turns, 500.8 extra phases, 724.1 ending the turn): the primitives the `extraTurn`, `extraPhase` and `endTurn`
 * handlers call, and the phase arithmetic core/turn.ts uses to run them. Owner: WP15.
 *
 * Kept apart from core/turn.ts on purpose: the handlers are loaded by core/resolve.ts (through effects/handlers/index.ts), and core/turn.ts imports
 * core/resolve.ts, so a handler importing core/turn.ts would close an import cycle (design 5.4). This module imports nothing from the turn loop.
 */
import type { ObjectFilter } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import { STEP_ORDER, type AttackersOnly, type GameState, type PhaseKind, type Step } from '../types/state';
import { matchesFilter } from '../rules/filter';
import { filterCtxOutside } from '../rules/filter-env';
import type { Game } from './game';

/** The kind of phase a step belongs to (CR 500.1; both main phases are main phases, CR 505.1). */
export function phaseKindOf(step: Step): PhaseKind {
  switch (step) {
    case 'untap': case 'upkeep': case 'draw': return 'beginning';
    case 'main1': case 'main2': return 'main';
    case 'end': case 'cleanup': return 'ending';
    default: return 'combat';
  }
}

/** Is `step` the last step of its phase (the next step in turn order belongs to another phase, or the turn is over)? */
export function endsPhase(step: Step): boolean {
  const next = STEP_ORDER[STEP_ORDER.indexOf(step) + 1];
  return next === undefined || phaseKindOf(next) !== phaseKindOf(step);
}

/** The first step of an added phase: a combat phase begins with its beginning of combat step (CR 506.1); an added main phase is a postcombat main phase (CR 505.1a). */
export const firstStepOf = (phase: 'combat' | 'main'): Step => (phase === 'combat' ? 'beginCombat' : 'main2');

/**
 * CR 500.7: "[player] takes N extra turns after this one". The turns are added directly after this turn one at a time, and the most recently created turn is
 * taken first, so each one goes to the FRONT of the queue. Several players: the caller adds them in APNAP order (CR 101.4). Returns the new turns' ids.
 */
export function addExtraTurns(g: Game, player: PlayerId, n: number): number[] {
  const t = g.s.turn;
  const ids: number[] = [];
  // audit-fix-2 (CR 500.7, 611.2a): each queued turn gets an id, kept in step with `extraTurns`, so "During that turn" can name it
  const queued = t.extraTurnIds ?? [];
  while (queued.length < t.extraTurns.length) queued.push(-1); // turns queued without an id: no effect names them
  for (let i = 0; i < n; i++) {
    const id = (t.extraTurnSeq ?? 0) + 1;
    t.extraTurnSeq = id;
    t.extraTurns.unshift(player);
    queued.unshift(id);
    ids.push(id);
  }
  if (n > 0) t.extraTurnIds = queued;
  if (n > 0) g.log(`${g.player(player).name} will take ${n === 1 ? 'an extra turn' : `${n} extra turns`} after this one.`, { rules: ['CR 500.7'], level: 'action' });
  return ids;
}

/**
 * CR 500.8: an additional phase directly after a phase. `after` names the phase by one of its steps; absent, it is the current phase. It happens after the next
 * end of a phase of that kind this turn (the current one included); several added after the same phase: the most recently created occurs first.
 */
export function addExtraPhase(g: Game, phase: 'combat' | 'main', after?: Step, attackers?: AttackersOnly): void {
  const t = g.s.turn;
  const kind = phaseKindOf(after ?? t.step);
  (t.extraPhases ??= []).push({ after: kind, phase, ...(attackers !== undefined ? { attackers } : {}) }); // std-rq: an attacker restriction of that phase
  g.log(`After this ${kind === 'main' ? 'main phase' : `${kind} phase`}, there is an additional ${phase} phase.`, { rules: ['CR 500.8'], level: 'action' });
}

/**
 * r4-fxb (CR 500.9, unverified number): an additional step of the kind `step`, directly after the current step, or with `afterPhase` after the current phase (the
 * next end of a phase of that kind this turn, the current one included). Several added after the same step or phase: the most recently created occurs first.
 */
export function addExtraStep(g: Game, step: Step, afterPhase: boolean): void {
  const t = g.s.turn;
  (t.extraSteps ??= []).push(afterPhase ? { afterPhase: phaseKindOf(t.step), step } : { afterStep: t.step, step });
  g.log(`After this ${afterPhase ? 'phase' : 'step'}, there is an additional ${STEP_WORDS[step]}.`, { rules: ['CR 500.9'], level: 'action' });
}

/** r4-fxb: the added step (if any) that begins when `ended` ends: one added after that step, else (when it ends its phase) one added after that phase; the most recent. */
export function takeExtraStep(g: Game, ended: Step): Step | undefined {
  const list = g.s.turn.extraSteps;
  if (!list) return undefined;
  const pick = (ok: (x: { afterStep?: Step; afterPhase?: PhaseKind }) => boolean): Step | undefined => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (!ok(list[i]!)) continue;
      const [taken] = list.splice(i, 1);
      if (list.length === 0) delete g.s.turn.extraSteps;
      return taken!.step;
    }
    return undefined;
  };
  return pick((x) => x.afterStep === ended) ?? (endsPhase(ended) ? pick((x) => x.afterPhase === phaseKindOf(ended)) : undefined);
}

/** r4-fxb: the words of a step for the log. */
export const STEP_WORDS: Readonly<Record<Step, string>> = {
  untap: 'untap step', upkeep: 'upkeep step', draw: 'draw step', main1: 'main phase', beginCombat: 'beginning of combat step', declareAttackers: 'declare attackers step',
  declareBlockers: 'declare blockers step', combatDamage: 'combat damage step', endCombat: 'end of combat step', main2: 'main phase', end: 'end step', cleanup: 'cleanup step',
};

/**
 * The added phase (if any) that begins when a phase of this kind ends: the most recently created one (CR 500.8). Removes it from the turn. std-rq: an attacker
 * restriction of an added combat phase applies from now until a phase ends (`turn.combatAttackers`, rules/combat-rules.ts).
 */
export function takeExtraPhase(g: Game, kind: PhaseKind): 'combat' | 'main' | undefined {
  const list = g.s.turn.extraPhases;
  if (!list) return undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.after !== kind) continue;
    const [taken] = list.splice(i, 1);
    if (list.length === 0) delete g.s.turn.extraPhases;
    if (taken!.attackers !== undefined) g.s.turn.combatAttackers = taken!.attackers;
    return taken!.phase;
  }
  return undefined;
}


/**
 * std-rq (CR 500.8, 508.1, 508.1c): as the declare attackers step of an added combat phase with an attacker restriction begins, the creatures that may attack in
 * it: those the filter describes now, for the controller of the effect that added the phase (the declaration is the first thing in the step, CR 508.1).
 */
export function fixAllowedAttackers(g: Game): void {
  const only = g.s.turn.combatAttackers;
  if (only === undefined) return;
  const ctx = filterCtxOutside(g.s, { controller: only.controller, ...(only.sourceId !== undefined ? { sourceId: only.sourceId } : {}) });
  only.allowed = g.s.zones.battlefield.filter((id) => matchesFilter(g.s, g.obj(id), only.filter, ctx));
}

/** CR 724.1a: triggered abilities that triggered before the turn was ended and are not on the stack yet cease to exist. Returns how many. */
export function dropPendingTriggers(g: Game): number {
  const n = g.s.pendingTriggers.length;
  if (n > 0) {
    g.s.pendingTriggers = [];
    g.log(`${n === 1 ? 'A triggered ability that was waiting ceases' : `${n} triggered abilities that were waiting cease`} to exist.`, { rules: ['CR 724.1a'], level: 'info' });
  }
  return n;
}

/**
 * CR 724.1 (the part that is not the resolution of the spell): from now on no player gets priority; when the current step ends the game goes straight to the
 * cleanup step (core/turn.ts). The handler has already done 724.1a-b.
 */
export function markTurnEnding(g: Game): void {
  g.s.turn.ending = true;
  g.s.priority.player = null;
  g.s.priority.passes = 0;
}

/** Standard round 10 (op nextSpell, effects/handlers/next-spell.ts; CR 611.2): a rider waits for the next matching spell its player casts this turn. */
export function addNextSpellRider(g: Game, rider: NonNullable<GameState['turn']['nextSpell']>[number]): void {
  (g.s.turn.nextSpell ??= []).push(rider);
}

/** actions/cast.ts#FLAG_CANT_BE_COUNTERED (statics/hooks.ts#CANT_BE_COUNTERED_FLAG), spelled here so this module does not import the cast action. */
const FLAG_CANT_BE_COUNTERED = 'cantBeCountered';

/**
 * CR 601.2i: as `spellId` becomes cast by `player`, every waiting rider of that player whose filter the spell matches applies to it and is removed; the others
 * keep waiting. "Can't be countered" leaves FLAG_CANT_BE_COUNTERED on the spell, the flag the counter op and hookpoints.canBeCountered read (CR 101.2).
 */
export function takeNextSpellRiders(g: Game, player: PlayerId, spellId: ObjectId): void {
  const list = g.s.turn.nextSpell;
  if (!list || list.length === 0) return;
  const spell = g.s.objects[spellId];
  if (!spell?.stack) return;
  const keep: typeof list = [];
  for (const r of list) {
    if (r.rider === 'keyword') { // std-rx26: taken as the spell was put on the stack (lockNextSpellKeywords)
      keep.push(r);
      continue;
    }
    const applies = r.player === player && (r.filter === undefined || matchesFilter(g.s, spell, r.filter as ObjectFilter, filterCtxOutside(g.s, { controller: r.controller })));
    if (!applies) {
      keep.push(r);
      continue;
    }
    if (r.rider === 'cantBeCountered' && !(spell.stack.flags ?? []).includes(FLAG_CANT_BE_COUNTERED)) (spell.stack.flags ??= []).push(FLAG_CANT_BE_COUNTERED);
    // std-freecast-1 (CR 611.2): a `free` rider applied to this spell as its alternative cost was offered (statics/play-permits.ts#grantedAlternatives); paid
    // for that way or not, this is the next matching spell, so it is used up
  }
  if (keep.length === 0) delete g.s.turn.nextSpell;
  else g.s.turn.nextSpell = keep;
}

/** std-rx26: does the waiting `keyword` rider `r` apply to `spellId`, a card `player` is casting (on the stack, or standing there in a castCheck overlay)? Pure. */
export function nextSpellKeywordApplies(s: GameState, r: NonNullable<GameState['turn']['nextSpell']>[number], player: PlayerId, spellId: ObjectId): boolean {
  if (r.rider !== 'keyword' || !r.keyword || r.player !== player) return false;
  return r.filter === undefined || matchesFilter(s, s.objects[spellId]!, r.filter as ObjectFilter, filterCtxOutside(s, { controller: r.controller }));
}

/**
 * std-rx26 (CR 601.2a, 601.2f, 611.2c, 613.1f; cites unverified): "the next noncreature spell you cast this turn has affinity for artifacts". As `spellId` is put
 * on the stack to be cast by `player` (CR 601.2a), every waiting `keyword` rider of that player whose filter the spell matches becomes a continuous effect that
 * gives the spell its keyword (layer 6, a fixed set: CR 611.2c) and is removed: the spell is "the next spell" from then on, so its cost keywords work while its
 * total cost is determined and paid (CR 601.2f-h). An illegal or cancelled cast leaves the game as it was (core/apply.ts, CR 733.1), the rider included. The
 * effect follows a permanent spell onto the battlefield like any other (CR 400.7a, core/move-parts/spell-effects.ts); it ends with the turn.
 */
export function lockNextSpellKeywords(g: Game, player: PlayerId, spellId: ObjectId): void {
  const list = g.s.turn.nextSpell;
  if (!list || !list.some((r) => r.rider === 'keyword')) return;
  const spell = g.s.objects[spellId];
  if (!spell?.stack) return;
  const keep: typeof list = [];
  for (const r of list) {
    if (!nextSpellKeywordApplies(g.s, r, player, spellId)) {
      keep.push(r);
      continue;
    }
    const src = r.sourceId !== undefined ? g.s.objects[r.sourceId] : undefined;
    g.s.continuousEffects.push({
      id: g.newEffectId(),
      source: src ? { id: src.id, zone: src.zone } : null,
      sourceName: src ? g.nameOf(src.id) : 'an effect',
      controller: r.controller,
      timestamp: g.newTimestamp(),
      startedTurn: g.s.turn.number,
      duration: { d: 'endOfTurn' },
      effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: spellId, zone: 'stack' }] }, mods: [{ layer: 6, add: [JSON.parse(JSON.stringify(r.keyword)) as NonNullable<typeof r.keyword>] }] },
    });
  }
  if (keep.length === 0) delete g.s.turn.nextSpell;
  else g.s.turn.nextSpell = keep;
}
