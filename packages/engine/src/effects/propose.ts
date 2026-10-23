/**
 * The proposal pipeline (CR 614-616, design 8.5): EVERY state-changing op proposes its event here before it happens, so replacement and prevention
 * effects can modify, replace or stop it. Owner: WP11. Contract: effects/api.ts#Propose.
 *
 *   propose(g, e)
 *     1. "can't" (CR 614.17, 101.2; effects/cant.ts): an event that can't happen is dropped; only a self-replacement effect may still modify it (614.17c);
 *        "damage can't be prevented" makes the damage unpreventable (CR 615.12);
 *     2. the loop (CR 616.1): the applicable effects (effects/replacements.ts#applicable, the milestone 6 extension point of design 14) not yet used on this
 *        event (CR 614.5); the lowest priority class below 4 must go first (616.1a-d), otherwise any (616.1e); with more than one, the affected object's
 *        controller or the affected player chooses (`chooseReplacement`); after each application the effects are looked up again (CR 616.2);
 *     3. the body is applied (effects/replace-bodies.ts); null = the event no longer happens (prevented, CR 615.6; replaced, CR 614.6);
 *     4. the final event is checked again: a modified event that can't happen is not carried out (CR 614.6, 614.17);
 *     5. the event is performed (effects/perform.ts), which emits the engine events: only what happened triggers anything (CR 603.2g, 614.6).
 *
 * The same pipeline is installed as the funnel of the milestone 3/4 primitives (`moveObject`, `createToken`, `dealDamage` and simultaneous damage, `destroy`)
 * by effects/funnels.ts, so a permanent entering by any route, combat damage and a state-based destruction see the same effects.
 */
import type { Game } from '../core/game';
import type { PlayerId } from '../types/ids';
import type { Propose, Proposed } from './api';
import { forbiddenBy, ruleForbids } from './cant';
import { performEvent, type CallerOptions, type Performed } from './perform';
import { BODY_KINDS, DESTINATION_PARTS, ENTERS_PARTS, kindOf } from './registries';
import { applyBody } from './replace-bodies';
import { applicable, type Candidate } from './replacements';
import { CHAIN_OF, collectingAfter, inBranch, OPTIONAL_ANSWERS } from './nested';

export { applicable } from './replacements';
export { forbidden, FORBIDDEN_ACTIONS } from './cant';

/**
 * `ReplacementBody` discriminators (`b`) and value forms the pipeline applies (capabilities `body:<b>`, design 5.2). M6-0 (m6 design 2.6): built from the
 * `capabilities` of the registered body kinds, enters parts and destination parts (effects/registries.ts), never hand-kept. Milestone 5: enters (CR 614.1c-d,
 * 614.12) with attachTo (CR 303.4f) and under (CR 616.1b); modify with a destination (CR 614.1a), random (CR 701.24c) and face down outside the battlefield
 * (CR 406.3; onto the battlefield it also needs layer:1b, CR 708.2a); prevent (CR 615); regeneration (CR 614.8, 701.19, applied by rules/destroy.ts).
 * M6-1: `instead` (CR 614.6), `redirect` with and without a budget (CR 614.9), `skip` (CR 614.10), `modify.amount|count|to` (CR 614.1a, 616.1g) and a
 * prevention effect's additional steps `prevent.then` (CR 615.5). Not yet, so cards that need them stay partial or manual: `during` (M6-3),
 * `enters.copy|faceDown|transformed|prepared` (M6-2, M6-3, M6-4, M6-6) and the destination fields `modify.destination.transformed|attacking|attachedTo|
 * order|owner`.
 */
export const REPLACEMENT_BODIES: Readonly<Record<string, true>> = Object.fromEntries(
  [
    ...Object.values(BODY_KINDS).flatMap((k) => [...(k?.capabilities ?? [])]),
    ...ENTERS_PARTS.flatMap((p) => [p.capability, ...(p.extraCapabilities ?? [])].map((x) => x.replace(/^body:/, ''))), // r4-copy: extraCapabilities
    ...DESTINATION_PARTS.map((p) => p.capability.replace(/^body:/, '')),
  ].sort().map((n) => [n, true as const]),
);

/**
 * Static effect kinds whose effects this module runs (`static:<s>`, design 5.2; the layer system registers `continuous` in statics/live.ts): replacement and
 * prevention effects, within the scope above. (The builder model/capabilities.ts reads this table; WP11 interface change.)
 */
export const STATIC_KINDS: Readonly<Record<string, true>> = { replace: true };

/**
 * Features this module implements: replacement effects of an object's own abilities about itself (`feature:replace.self`, CR 614.12, 614.15).
 *
 * M6-1 (m6 design 3.1, 3.2, 7): the replacement effects of other objects and of resolved spells and abilities that are not shields
 * (`feature:replace.foreign`: Leyline of the Void, Doubling Season, Rest in Peace, Fog; effects/replacements.ts#foreignCandidates and #recordCandidates); "if
 * an EFFECT would put counters / create tokens" (`feature:replace.byEffect`, CR 614.16: the proposal's cause, effects/replacements.ts#matchProposed); and
 * shields with every body the pipeline applies (`feature:shield.<b>`: Magma Spray's `modify`, Gather Specimens' `enters`, an `instead`, a `redirect` with
 * a budget, Fatigue's `skip`; the application count of effects/replace-bodies.ts#applyBody).
 *
 * `feature:replace.cause` (M6-5a, m6 design D12, 3.8): a replacement pattern's `zoneChange.cause` is compared with the cause of the proposed move by
 * effects/replacements.ts#matchProposed; core/resolve.ts moves a resolving spell with `cause: 'resolve'` (CR 608.2n), one that doesn't resolve with `'fizzle'`
 * (CR 608.2b) and a countered one moves with `'counter'` (CR 701.6a). Buyback (CR 702.27a) needs it. Trigger patterns name `feature:ev.cause` instead, which
 * nothing registers: the trigger matcher does not compare the cause (fail closed).
 */
export const FEATURES: readonly string[] = [
  'replace.self', 'replace.cause', 'replace.foreign', 'replace.byEffect', 'replace.byOpponent', // FAST5 T36
  'shield.modify', 'shield.instead', 'shield.enters', 'shield.redirect', 'shield.skip',
  'replace.createToken.token', // Cloud r3-repl: "if one or more creature tokens would be created" (effects/replacements.ts#tokenDefMatches, CR 111.1, 614.1a)
  'replace.draw.exceptFirstInDrawStep', // Cloud r5-repl: "except the first one you draw in each of your draw steps" (effects/replacements.ts#matchProposed, CR 504.1)
  'replace.life.loss.fromDamage', // Cloud r3-repl: damage's life loss is proposed (rules/damage.ts#installLifeLossFunnel, CR 120.3a, 614.1a)
  'replace.beginTurn.extra', // p2-replace-events-3: "would begin an extra turn" (the turn proposal's `extra`, triggers/match.ts#beginTurn, CR 500.7, 614.10)
];

/** Returns whether the (possibly modified) event should now be performed. */
export const propose: Propose = (g, e) => proposeResult(g, e) !== null;

/** `propose`, saying what happened: null when nothing was performed (forbidden, prevented, replaced away). */
export function proposeResult(g: Game, e: Proposed, caller: CallerOptions = {}, shares?: ReadonlyMap<string, number>): Performed | null {
  // M6-1, CR 615.5: what a body defers ("you gain life equal to the damage prevented this way") happens immediately after the event, or after nothing
  const { value: final, after } = collectingAfter(() => runPipeline(g, e, shares));
  const r = final ? performEvent(g, final, caller) : null;
  for (const f of after) f();
  return r;
}

/**
 * Steps 1-4 of the pipeline: the event as it will happen, or null. Exported for tests and for the entry of each token created (CR 616.1g, effects/perform.ts);
 * it performs nothing itself except what the bodies decide (CR 614.12a). `shares`: the division of "prevent the next N" shields among simultaneous damage.
 */
export function runPipeline(g: Game, e: Proposed, shares?: ReadonlyMap<string, number>): Proposed | null {
  if (isZero(e)) return null; // CR 614.7a: 0 damage, 0 life, 0 counters, 0 tokens is no event; nothing can replace it
  const cantHappen = forbiddenBy(g, e) !== null;
  // CR 614.5, M6-1 (m6 design D3, E2, 3.1.5): the effects already applied to this event and to the events it replaces, per BRANCH: a proposal made while a
  // body of another proposal runs (the steps of an `instead`, the counters an entering permanent gets) starts from that proposal's set, a copy of it.
  const used = new Set<string>(g.chain?.used ?? []);
  // w8-followups (CR 614.5, 616.1e): optional effects already answered for the event these steps belong to (ReplacementChain.decided)
  const decided = g.chain?.decided;
  const answers = new Map<string, boolean>();
  OPTIONAL_ANSWERS.set(used, answers);
  let cur: Proposed | null = unpreventableIfRuled(g, e);
  for (let i = 0; cur && i < 64; i++) {
    const now: Proposed = cur;
    let pool: Candidate[] = applicable(g, now).filter((c) => !used.has(c.id));
    if (cantHappen) pool = pool.filter((c) => c.klass === 0); // CR 614.17c
    if (pool.length === 0) break;
    const klass = Math.min(...pool.map((c) => c.klass));
    const next = klass < 4 ? pool.filter((c) => c.klass === klass) : pool; // CR 616.1a-e
    const chosen: Candidate = next.length === 1 || orderFree(next) || sameShields(g, next) ? next[0]! : choose(g, now, next);
    used.add(chosen.id);
    // M11-1: a rule replacement that asks and applies itself (CR 903.9b, effects/rule-replacements/commander.ts); declined, the event goes on unchanged
    if (chosen.rule !== undefined) {
      cur = chosen.rule(g, now) ?? now;
      continue;
    }
    // "You may ..." (CR 614.1, 609.3): the effect's controller decides ("you", CR 109.5); for an object's own effect that is the affected player as well
    if (chosen.def.optional === true) {
      const yes = decided?.get(chosen.id) ?? g.choose({ kind: 'yesNo', player: chosen.controller, prompt: `${chosen.sourceName}: apply this effect?`, rules: ['CR 616.1', 'CR 609.3'] }).yes;
      answers.set(chosen.id, yes);
      if (!yes) continue;
    }
    cur = inChain(g, used, (): Proposed | null => applyBody(g, now, chosen, shares));
    if (cur && isZero(cur)) cur = null;
  }
  if (cur) CHAIN_OF.set(cur, used);
  // CR 614.17 (the original event can't happen) and CR 614.6 (a modified event whose instruction can't be carried out is ignored): the final form is checked.
  const why = cur && (cantHappen || cur !== e) ? forbiddenBy(g, cur) : null;
  if (why) {
    g.log(why, { rules: ['CR 614.17', 'CR 101.2', ...(cantHappen ? [] : ['CR 614.6'])], level: 'info' });
    return null;
  }
  return cur;
}

/**
 * CR 614.5, M6-1 (m6 design 3.1.5): run `f` (a body being applied) with the replacement chain set to this proposal's set of used effects, and restore the
 * chain whatever happens (a decision raised inside unwinds through here). Events the body proposes start from a copy of that set.
 */
const inChain = <T>(g: Game, used: ReadonlySet<string>, f: () => T): T => inBranch(g, used, f);

/**
 * CR 615.12, design 9.4 (`preventDamage`): "damage can't be prevented" makes the damage unpreventable before any prevention effect is applied. r5-repl:
 * "combat damage can't be prevented" (`preventCombatDamage`) does the same for combat damage only (CR 510.2).
 */
function unpreventableIfRuled(g: Game, e: Proposed): Proposed {
  if (e.ev !== 'damage' || e.unpreventable) return e;
  const recipient = typeof e.to === 'string' ? e.to : e.to.id;
  const ruled = ruleForbids(g, { action: 'preventDamage', subject: recipient, other: e.source.id })
    || (e.combat && ruleForbids(g, { action: 'preventCombatDamage', subject: recipient, other: e.source.id }));
  return ruled ? { ...e, unpreventable: true } : e;
}

export const isZero = (e: Proposed): boolean =>
  (e.ev === 'damage' || e.ev === 'life') ? e.amount <= 0 : e.ev === 'counters' || e.ev === 'createToken' || e.ev === 'mill' || e.ev === 'drawMany' ? e.count <= 0 : false;

/**
 * Several effects whose order cannot change the outcome need no choice: "as it enters" bodies without a choice or a payment (tapped, counters, abilities)
 * commute. Anything else (shields with budgets, choices, payments, destinations) is ordered by the player (CR 616.1).
 */
function orderFree(cs: Candidate[]): boolean {
  if (cs.some((c) => c.def.optional === true)) return false;
  if (cs.every((c) => {
    const b = c.def.body;
    return b.b === 'enters' && !b.choose && !b.tappedUnlessPay && !b.under && !b.attachTo && b.untapped !== true; // r5-fxb: tapped then untapped is not untapped then tapped (CR 616.1)
  })) return true;
  // M6-1 (m6 design 3.1.4): changes of the same number that are all multiplications (two doublings: x2 x2 in either order), or all additions of a fixed
  // number, commute; a mix (Doubling Season and Hardened Scales: (n+1)x2 or 2n+1, CR 616.1e) is the player's choice.
  const ops = cs.map((c) => {
    const b = c.def.body;
    if (b.b !== 'modify' || b.destination !== undefined || b.to !== undefined || (b.amount !== undefined) === (b.count !== undefined)) return null;
    const a = (b.amount ?? b.count)!;
    if (a.set !== undefined || a.min !== undefined || a.round !== undefined) return null;
    if (a.mul !== undefined && a.add === undefined && Number.isInteger(a.mul)) return 'mul';
    if (a.add !== undefined && a.mul === undefined && typeof a.add === 'number') return 'add';
    return null;
  });
  return ops.every((o) => o !== null && o === ops[0]);
}

/**
 * std-rx30 (CR 616.1, 614.10): one-use skip shields that are the same effect (one source, controller, wording and duration: "Target opponent skips their next X turns"
 * creates X of them) leave no choice: whichever applies, the event is skipped and one of the same shields is used up.
 */
function sameShields(g: Game, cs: Candidate[]): boolean {
  if (cs.some((c) => c.recId === undefined || c.def.body.b !== 'skip' || c.def.optional === true || c.rule !== undefined)) return false;
  const recs = cs.map((c) => g.s.continuousEffects.find((r) => r.id === c.recId));
  if (recs.some((r) => r === undefined)) return false;
  const key = (i: number): string => JSON.stringify([cs[i]!.sourceName, cs[i]!.controller, cs[i]!.def, recs[i]!.duration, recs[i]!.source?.id ?? null, recs[i]!.usesLeft ?? null]);
  return cs.every((_, i) => key(i) === key(0));
}

function choose(g: Game, e: Proposed, cs: Candidate[]): Candidate {
  const ans = g.choose({
    kind: 'chooseReplacement',
    player: affectedPlayer(g, e), // CR 616.1: the affected object's controller (owner if none) or the affected player
    prompt: 'Choose which replacement or prevention effect to apply first.',
    options: cs.map((c) => ({ id: c.id, label: `${c.sourceName}: ${describe(c)}` })),
    rules: ['CR 616.1'],
  });
  return cs.find((c) => c.id === ans.id) ?? cs[0]!;
}

function describe(c: Candidate): string {
  const b = c.def.body;
  switch (b.b) {
    case 'prevent': return b.amount === 'all' ? 'prevent the damage' : 'prevent some of the damage';
    case 'modify':
      if (b.destination) return `put it into ${b.destination.zone} instead`;
      if (b.count?.mul === 2 || b.amount?.mul === 2) return 'twice that many instead';
      if (b.count?.add !== undefined || b.amount?.add !== undefined) return 'more instead';
      return 'modify the event';
    case 'enters': return 'as it enters';
    case 'instead': return 'do something else instead';
    case 'insteadThen': return 'do something else first, then it happens'; // merge wave 8 (audit D4)
    case 'redirect': return 'the damage is dealt to another instead';
    case 'skip': return 'skip it';
    default: return b.b;
  }
}

/**
 * CR 616.1: who chooses among replacement effects: the affected object's controller (its owner if it has none), or the affected player. M6-0: dispatched
 * through effects/registries.ts#PROPOSAL_KINDS (the milestone 5 cases moved unchanged to effects/proposal-kinds/m5.ts; M6-1 reads `controllerOf`, D4).
 */
export function affectedPlayer(g: Game, e: Proposed): PlayerId {
  return kindOf(e).affectedPlayer(g, e);
}
