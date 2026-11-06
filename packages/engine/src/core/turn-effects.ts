/**
 * Effects on the turn structure (CR 500.7 extra turns, 500.8 extra phases, 724.1 ending the turn): the primitives the `extraTurn`, `extraPhase` and `endTurn`
 * handlers call, and the phase arithmetic core/turn.ts uses to run them. Owner: WP15.
 *
 * Kept apart from core/turn.ts on purpose: the handlers are loaded by core/resolve.ts (through effects/handlers/index.ts), and core/turn.ts imports
 * core/resolve.ts, so a handler importing core/turn.ts would close an import cycle (design 5.4). This module imports nothing from the turn loop.
 */
import type { CounterSpec, ObjectFilter } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import { STEP_ORDER, type AttackersOnly, type GameState, type PhaseKind, type Step } from '../types/state';
import { matchesFilter } from '../rules/filter';
import { filterCtxOutside } from '../rules/filter-env';
import type { Game } from './game';
import { collectPendingTriggers } from './triggers';
import { charsOfObject } from '../rules/characteristics';
import { evalCondition, filterMatches } from '../statics/match';
import { charsViewOf } from '../statics/rule-sources';

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
export function addExtraTurns(g: Game, player: PlayerId, n: number, skipUntap = false): number[] {
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
  if (skipUntap && ids.length > 0) t.extraTurnSkipUntap = [...(t.extraTurnSkipUntap ?? []), ...ids]; // edh-next-46 (CR 502.1, 614.10; Savor the Moment): these turns have no untap step (core/turn.ts#beginNextTurn)
  if (n > 0) g.log(`${g.player(player).name} will take ${n === 1 ? 'an extra turn' : `${n} extra turns`} after this one.`, { rules: ['CR 500.7'], level: 'action' });
  return ids;
}

/**
 * CR 500.8: an additional phase directly after a phase. `after` names the phase by one of its steps; absent, it is the current phase. It happens after the next
 * end of a phase of that kind this turn (the current one included); several added after the same phase: the most recently created occurs first.
 */
export function addExtraPhase(g: Game, phase: 'combat' | 'main', after?: Step, attackers?: AttackersOnly, follows?: number): number {
  const t = g.s.turn;
  const kind = phaseKindOf(after ?? t.step);
  // trek-20 (CR 505.1b, 500.8; World at War ruling 2010-06-15): "after the second main phase this turn" counts the main phases that began this turn (added ones too); once the second has
  // ended (or a third began) there is nothing left to follow: no phase is added (returns 0)
  const mains = t.mains ?? 0;
  if (after === 'main2' && (mains > 2 || (mains === 2 && phaseKindOf(t.step) !== 'main'))) return 0;
  const id = (t.extraPhaseSeq = (t.extraPhaseSeq ?? 0) + 1); // edh-combat-5: the id "that combat" of a delayed trigger waits for (CR 500.8, 603.7a)
  (t.extraPhases ??= []).push({ after: kind, phase, id, seq: (t.anchorSeq = (t.anchorSeq ?? 0) + 1), ...(attackers !== undefined ? { attackers } : {}), ...(after === 'main2' ? { secondMain: true as const } : {}), ...(follows !== undefined ? { follows } : {}) }); // trek-20: `after: 'main2'` is the second main phase only // std-rq: an attacker restriction of that phase
  g.log(`After this ${kind === 'main' ? 'main phase' : `${kind} phase`}, there is an additional ${phase} phase.`, { rules: ['CR 500.8'], level: 'action' });
  return id;
}

/**
 * r4-fxb (CR 500.9, unverified number): an additional step of the kind `step`, directly after the current step, or with `afterPhase` after the current phase (the
 * next end of a phase of that kind this turn, the current one included). Several added after the same step or phase: the most recently created occurs first.
 */
export function addExtraStep(g: Game, step: Step, afterPhase: boolean): void {
  const t = g.s.turn;
  (t.extraSteps ??= []).push(afterPhase ? { afterPhase: phaseKindOf(t.step), step, seq: (t.anchorSeq = (t.anchorSeq ?? 0) + 1) } : { afterStep: t.step, step });
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

/**
 * edh-misc-5 (CR 500.8-500.10): has an added PHASE after the phase `ended` ends been created more recently than every step added after that phase? Then it begins first
 * (the most recently created occurs first, whichever kind). A step added after `ended` itself keeps its priority.
 */
export function addedPhaseBeforeSteps(g: Game, ended: Step): boolean {
  const t = g.s.turn;
  if (!endsPhase(ended) || t.extraSteps?.some((x) => x.afterStep === ended)) return false;
  const kind = phaseKindOf(ended);
  const steps = (t.extraSteps ?? []).filter((x) => x.afterPhase === kind).map((x) => x.seq ?? 0);
  const phases = (t.extraPhases ?? []).filter((x) => x.after === kind).map((x) => x.seq ?? 0);
  if (steps.length === 0 || phases.length === 0) return false;
  return Math.max(...phases) > Math.max(...steps);
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
export function takeExtraPhase(g: Game, kind: PhaseKind, mains: number, endedId?: number): 'combat' | 'main' | undefined {
  const list = g.s.turn.extraPhases;
  if (!list) return undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.after !== kind) continue;
    if (list[i]!.follows !== undefined && list[i]!.follows !== endedId) continue; // trek-20: the main phase "followed by" an added combat phase waits for THAT combat phase to end, never for an ordinary one
    if (list[i]!.secondMain === true && mains !== 2) continue; // trek-20 (CR 505.1b, 500.8): "after the second main phase" waits for the end of the main phase that began second this turn
    const [taken] = list.splice(i, 1);
    if (list.length === 0) delete g.s.turn.extraPhases;
    if (taken!.attackers !== undefined) g.s.turn.combatAttackers = taken!.attackers;
    if (taken!.id !== undefined) g.s.turn.addedPhaseId = taken!.id; // edh-combat-5: the phase under way (cleared as a phase ends, core/turn.ts#afterAddedPhases)
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
  // edh-d-34 (CR 500.8, 508.1): the objects an effect named ("Only the chosen creatures can attack"): those of them still on the battlefield now
  if (only.ids !== undefined) { only.allowed = only.ids.filter((id) => g.s.objects[id]?.zone === 'battlefield'); return; }
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

/**
 * trek-18 (CR 724.2a; the performer effects/handlers/trek-18.ts calls): what triggered before the combat phase was ended and is not on the stack yet ceases to exist. What
 * happened so far is collected first (it triggered against the state it happened in), then dropped. Returns how many triggers ceased to exist.
 */
export function dropWaitingTriggers(g: Game): number {
  collectPendingTriggers(g);
  return dropPendingTriggers(g);
}

/**
 * trek-18 (CR 724.2c-d): from now on no player gets priority; when the current step ends the game goes straight past the rest of the combat phase to the next phase
 * (core/turn.ts#endTheCombatPhase). The handler has already done 724.2a-b.
 */
export function markCombatPhaseEnding(g: Game): void {
  g.s.turn.endingCombat = true;
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
    const applies = r.player === player && (r.filter === undefined || matchesFilter(g.s, spell, r.filter as ObjectFilter, filterCtxOutside(g.s, { controller: r.controller, ...(r.sourceId !== undefined ? { sourceId: r.sourceId } : {}) })));
    if (!applies) {
      keep.push(r);
      continue;
    }
    if (r.rider === 'cantBeCountered' && !(spell.stack.flags ?? []).includes(FLAG_CANT_BE_COUNTERED)) (spell.stack.flags ??= []).push(FLAG_CANT_BE_COUNTERED);
    // edh-d-95 (CR 614.1c, 122.6, 611.2; Savage Summoning): rider `enters`, "that creature enters with an additional +1/+1 counter on it": the permanent this spell becomes enters with the counters
    // (the spell's `permitEnters`, as a mana rider gives them, core/mana-riders.ts; effects/rule-replacements/permit-enters.ts applies them); a copy is never cast, so it takes no rider
    if (r.rider === 'enters' && r.counters !== undefined && r.counters.length > 0 && spell.stack.isCopy !== true) {
      const cur = spell.stack.permitEnters;
      spell.stack.permitEnters = { ...(cur ?? { source: r.sourceId !== undefined ? g.nameOf(r.sourceId) : 'an effect' }), counters: [...(cur?.counters ?? []), ...(structuredClone(r.counters) as CounterSpec[])] };
    }
    // std-freecast-1 (CR 611.2): a `free` rider applied to this spell as its alternative cost was offered (statics/play-permits.ts#grantedAlternatives); paid
    // for that way or not, this is the next matching spell, so it is used up
  }
  if (keep.length === 0) delete g.s.turn.nextSpell;
  else g.s.turn.nextSpell = keep;
}

/** std-rx26: does the waiting `keyword` rider `r` apply to `spellId`, a card `player` is casting (on the stack, or standing there in a castCheck overlay)? Pure. */
export function nextSpellKeywordApplies(s: GameState, r: NonNullable<GameState['turn']['nextSpell']>[number], player: PlayerId, spellId: ObjectId): boolean {
  if (r.rider !== 'keyword' || !r.keyword || r.player !== player) return false;
  return r.filter === undefined || matchesFilter(s, s.objects[spellId]!, r.filter as ObjectFilter, filterCtxOutside(s, { controller: r.controller, ...(r.sourceId !== undefined ? { sourceId: r.sourceId } : {}) }));
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
    if (r.lasting === true) { // edh-d-50 (CR 611.2): "as you cast spells from your hand this turn, they gain cascade" waits for every matching spell, to the end of the turn; a spell gets it once
      keep.push(r);
      const mark = `nsl:${r.lockId ?? ''}`;
      if ((spell.stack.flags ??= []).includes(mark)) continue;
      spell.stack.flags.push(mark);
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

/**
 * edh-next-133 (CR 611.3d, 400.7b, 601.2a-b, 613.1f; Ashling, the Limitless: "Elemental permanent spells you cast from your hand gain evoke {4} as you cast them";
 * Zinnia, Valley's Voice: "Creature spells you cast gain offspring {2} as you cast them"). As `spellId` is put on the stack to be cast by `player` (CR 601.2a), every
 * functioning static ability whose `asCast` grant (`ContinuousEffectDef.asCast`) covers the card as a spell about to be cast becomes a stored effect that gives this
 * spell the granted abilities (layer 6, a fixed set, CR 611.2c) with no duration: CR 611.3d (the grant includes an ability that functions on the battlefield, evoke's
 * and offspring's triggers, with no stated duration: until the end of the game). The record follows the permanent spell onto the battlefield (CR 400.7a-b;
 * core/move-parts/spell-effects.ts), so the permanent still has evoke when it enters even if the source has left meanwhile (Ashling ruling 2025-11-17). The static
 * itself no longer applies to the spell once it is cast (statics/layers.ts#matchSet), so the spell has each grant once. The cast's alternative or additional cost
 * was offered from the same grant while the card was still in hand (statics/rule-sources.ts#overlayAsSpell). An illegal or cancelled cast leaves the game as it was
 * (core/apply.ts, CR 733.1). Judged in a view of the spell without its stack record: the card about to be cast, cast from where it was.
 */
/** edh-next-133: does a definition hold an `asCast` grant (a text test, memoized per definition)? */
const AS_CAST_DEFS = new WeakMap<object, boolean>();

export function lockAsCastGrants(g: Game, spellId: ObjectId): void {
  const spell = g.s.objects[spellId];
  if (!spell?.stack || spell.kind === 'ability') return;
  const sources = g.s.zones.battlefield.filter((id) => {
    const def = g.s.defs[g.s.objects[id]?.defId ?? ''];
    if (def === undefined) return false;
    let v = AS_CAST_DEFS.get(def);
    if (v === undefined) AS_CAST_DEFS.set(def, (v = JSON.stringify(def.faces).includes('"asCast":true')));
    return v;
  });
  if (sources.length === 0) return;
  const { stack: st, ...card } = spell;
  const view: GameState = { ...g.s, objects: { ...g.s.objects, [spellId]: { ...card, cast: { ...(card.cast ?? {}), from: st.castFrom } as NonNullable<typeof card.cast> } } };
  const all = charsViewOf(view);
  const recs: GameState['continuousEffects'] = [];
  for (const id of sources) {
    const o = view.objects[id]!;
    if (o.phasedOut) continue; // CR 702.26b
    const c = charsOfObject(view, o);
    for (const a of c.abilities) {
      const d = a.def;
      if (d.kind !== 'static' || !(d.zone ?? ['battlefield']).includes(o.zone)) continue; // CR 604.1, 113.6
      if (d.condition && !evalCondition({ s: view, all, source: id, controller: c.controller }, d.condition)) continue; // CR 611.3a
      for (const e of d.effects) {
        if (e.s !== 'continuous' || e.asCast !== true || e.affects.ref !== 'each' || !('filter' in e.affects)) continue;
        if (!filterMatches({ s: view, all, source: id, controller: c.controller }, spellId, e.affects.filter)) continue;
        recs.push({
          id: g.newEffectId(), source: { id, zone: o.zone }, sourceName: g.nameOf(id), controller: c.controller, timestamp: g.newTimestamp(), startedTurn: g.s.turn.number,
          duration: { d: 'permanent' },
          effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: spellId, zone: 'stack' }] }, mods: JSON.parse(JSON.stringify(e.mods)) as typeof e.mods },
        });
      }
    }
  }
  if (recs.length > 0) g.s.continuousEffects.push(...recs);
}
