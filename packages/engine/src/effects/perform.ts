/**
 * The performers: the only code that changes zones, life, damage and counters on behalf of an effect, called with an event that survived
 * `propose` (design 8.5). They call milestone 3 and 4's primitives (`moveObject`, `dealDamage`, `gainLife`/`loseLife`, `drawCard`, `addCounters`, `destroy`,
 * `createToken`), which stay the single implementation of each rule, and emit the engine events, including the ones the ability model added (design 4.1:
 * `tokenCreated`, `attached`). Owner: WP11; M6-0 (m6 design 2.6, E17) made `performEvent` dispatch through effects/registries.ts#PROPOSAL_KINDS (the
 * milestone 5 performers moved unchanged to effects/perform-events.ts, re-exported below) and run `IMMEDIATE_CHECKS` after every performed event; M6-1 owns
 * this file after M6-0.
 *
 * `perform` keeps the contract of the skeleton (`(g, e) => void`); `performEvent` also says what happened (the new object of a zone change, the tokens
 * created, the damage dealt, what became of a destruction), which the funnels (effects/funnels.ts) return to the milestone 3/4 call-sites.
 *
 * The other state writes of the pipeline are performers too (design 8.5, the lint of test/m5/propose/lint.test.ts): the payment of a cost "you may pay" as a
 * permanent enters (`performPayment`, CR 614.12a) and what is left of a shield (`setShieldLeft`, CR 615.7-615.8) (both in effects/perform-events.ts). So are
 * the interpreter's own writes (WP10, routed here at the W2 merge): a cost an effect asks for (`performEffectPayment`, CR 118.12), a linked ability's memory
 * (`performLink`, CR 607.2d), the players' manual operations and reminder chips (`performManualOps`, `performReminder`, design 10.5) and an ability leaving the
 * stack (`performAbilityGone`).
 */
import type { Game } from '../core/game';
import { arrangeInLibrary, moveObject, renewLibrary, shuffleLibrary } from '../core/zones';
import { applyManualOps, resolveManually, type ManualInput } from '../core/manual';
import type { ObjectId, PlayerId } from '../types/ids';
import { type LinkValue, type ManualReminder, type ObjHandle, type StackInfo } from '../types/state';
import type { LinkId } from '../types/ability';
import type { ManualOp } from '../types/decisions';
import type { CostPlan } from '../rules/cost';
import { addRegenerationShield } from '../rules/destroy';
import { payPlan, type Paid } from '../rules/pay';
import { setLink } from '../statics/links';
import type { Proposed } from './api';
import type { GameEvent } from '../types/events';
import { IMMEDIATE_CHECKS, PROPOSAL_KINDS, type ProposalKind } from './registries';
import type { CallerOptions, Performed } from './perform-events';

export { installEntryPipeline, performPayment, setShieldLeft, type CallerOptions, type Performed } from './perform-events';

/** Perform an event that survived `propose` (the skeleton's contract). */
export function perform(g: Game, e: Proposed): void {
  performEvent(g, e);
}

/**
 * Perform an event that survived `propose` and say what happened. A handle whose object has moved meanwhile is a new object: nothing happens (CR 400.7).
 * M6-0: the kind's performer (effects/registries.ts#PROPOSAL_KINDS), then the checks that happen "immediately" (CR 702.145c-d, 702.145f-g; empty until M6-4).
 */
export function performEvent(g: Game, e: Proposed, caller: CallerOptions = {}): Performed {
  const kind = PROPOSAL_KINDS[e.ev] as unknown as ProposalKind;
  const r = kind.perform(g, e, caller) ?? { event: e, newIds: [], amount: 0 };
  for (const check of IMMEDIATE_CHECKS) check(g);
  return r;
}

// ---- the interpreter's own writes (WP10; design 8.5) -------------------------------------------------------------------------------------

/** Pay a cost an effect asks for ("unless", "you may pay", CR 118.12); `g` may be the payer's view of the game that routes the payment decision (effects/handlers/pay.ts). */
export function performEffectPayment(g: Game, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, label: string): Paid {
  return payPlan(g, player, sourceId, plan, label);
}

/**
 * FAST5 T78 (CR 608.2h, 701.21a): the permanents a cost an effect asked for sacrificed ("You may sacrifice another creature. If you do, put a number of +1/+1 counters
 * on ~ equal to the sacrificed creature's power") are remembered by the spell or ability that resolves, by the ids they had on the battlefield (keys of `GameState.lki`),
 * as the permanents sacrificed to pay its own cost are (`CostsPaid.sacrificed`, ObjRef `costSacrificed`).
 */
export function performRecordSacrificed(stack: StackInfo, ids: readonly ObjectId[]): void {
  if (ids.length > 0) stack.costsPaid = { ...stack.costsPaid, sacrificed: [...(stack.costsPaid.sacrificed ?? []), ...ids] };
}

/**
 * CLOUD C8 (CR 118.12, 400.7j, 608.2h): the cards a cost an effect asked for discarded ("You may discard a card. If you do, ... equal to the discarded card's mana
 * value") are remembered by the spell or ability that resolves, as the cards they became (`CostsPaid.discarded`, ObjRef `costDiscarded`), as for its own cost.
 */
export function performRecordDiscarded(stack: StackInfo, handles: readonly ObjHandle[]): void {
  if (handles.length > 0) stack.costsPaid = { ...stack.costsPaid, discarded: [...(stack.costsPaid.discarded ?? []), ...handles] };
}

/** CR 607.2d: what a linked ability remembers is kept on the source object, as long as it is still the object the ability belongs to (CR 400.7, 607.2a). */
export function performLink(g: Game, source: ObjHandle, link: LinkId, value: LinkValue): void {
  const o = g.s.objects[source.id];
  if (!o || o.zone !== source.zone) return;
  setLink(o, link, value);
}

/** The operations a player made by hand while resolving an effect manually (design 10.5); the resolving object is their source (CR 120.3). */
export function performManualOps(g: Game, player: PlayerId, ops: ManualOp[], sourceId?: ObjectId): void {
  applyManualOps(g, player, ops, sourceId);
}

/** MRE (C6 gap 6): the manualResolve decision asked in steps, each step's operations applied as it is answered (core/manual.ts#resolveManually). */
export function performManualSteps(g: Game, player: PlayerId, input: ManualInput, sourceId?: ObjectId): ManualOp[] {
  return resolveManually(g, player, input, sourceId);
}

/** The chip of a manual shield (design 10.5), shown until its duration ends. */
export function performReminder(g: Game, chip: ManualReminder): void {
  g.s.reminders = [...g.s.reminders, chip];
}

/** CR 701.24a: a player shuffles their library (no event can replace it in this build; WP13's shuffle op, routed here at the W2 merge). */
export function performShuffle(g: Game, player: PlayerId): void {
  shuffleLibrary(g, player);
}

/**
 * H1, CR 401.4: cards just put into libraries take the order nobody else may learn (first = highest) and new object ids (core/zones.ts#arrangeInLibrary). Not
 * a zone change and no event: nothing can replace it.
 */
export function performArrangeLibrary(g: Game, topToBottom: readonly ObjectId[]): void {
  arrangeInLibrary(g, topToBottom);
}

/** H1, CR 400.2: every card of a library becomes a new object where it is, after cards were put into it at random places (core/zones.ts#renewLibrary). */
export function performRenewLibrary(g: Game, player: PlayerId): void {
  renewLibrary(g, player);
}

/** CR 701.19a: "regenerate" makes a shield that replaces the permanent's next destruction this turn (WP14's regenerate op, routed here at the W2 merge). */
export function performRegenerationShield(g: Game, id: ObjectId, sourceId: ObjectId): void {
  addRegenerationShield(g, id, sourceId);
}

/** CR 608.2n: an ability leaving the stack ceases to exist. */
export function performAbilityGone(g: Game, id: ObjectId): void {
  moveObject(g, id, 'graveyard');
}


/**
 * The performer of a keyword action that nothing in this build can replace and that changes no zone by itself: scry, surveil, search and reveal (CR 701.20,
 * 701.22d, 701.23, 701.25d) happen, and "whenever you scry / search / reveal" triggers and the turn history read the `actionPerformed` event it emits
 * (design 8.6 stage 4: handlers emit nothing directly). Non-proposable, like `tap`.
 * WP13 INTERFACE CHANGE (added beside WP11's stub; kept here at the W2 merge).
 */
export function performAction(g: Game, e: Omit<Extract<GameEvent, { type: 'actionPerformed' }>, 'type'>): void {
  g.emit({ type: 'actionPerformed', ...e });
}
