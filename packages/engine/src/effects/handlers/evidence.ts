/**
 * FAST5X E12: the keyword action "collect evidence N" as an effect (CR 701.59), run by the `action` op through actions-native.ts#NATIVE_ACTIONS. Owner: FAST5X E12.
 * Step: `{op:'action', action:'collectEvidence', who, n}`.
 *
 *  - CR 701.59a: the player exiles any number of cards from their graveyard with total mana value N or greater. They choose the cards (first any number of
 *    them; while the total is still short, one more card at a time from the rest, so every answer leads to a legal result). Each card is exiled through the
 *    proposal pipeline (a replacement may change where it goes).
 *  - CR 701.59b: a player who can't exile cards with total mana value N or greater can't collect evidence: nothing is exiled and the step is not performed,
 *    so "if you do" is false. "You may collect evidence N" is not even offered then (effects/handlers/control.ts#cannotStart, CR 608.2d).
 *  - Collecting evidence emits the `collectEvidence` action of the player (as paying it as a cost does, rules/pay-parts.ts), which "whenever you collect
 *    evidence" matches (`{ev:'action', verb:'collectEvidence'}`).
 *
 * `as` binds the exiled cards (in exile). An N that can't be determined (CR 608.2b) does nothing.
 */
import type { EffectStep } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameState, ObjHandle } from '../../types/state';
import { charsOfObject } from '../../rules/characteristics';
import { costUseDenial } from '../../rules/cant';
import type { ExecCtx, StepHandler } from '../api';
import { evalQty } from '../eval';
import { performAction } from '../perform';
import { spend } from '../run';
import { bindAs, did, firstPlayer, NOTHING, proposeMove } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const EVIDENCE_FEATURES: readonly string[] = ['action.native.collectEvidence'];

/** The cards of `player`'s graveyard that may be exiled to collect evidence (CR 701.59a; CR 614.17b: not one a "can't" effect keeps there). */
export function evidenceCandidates(s: GameState, player: PlayerId): ObjectId[] {
  return (s.zones.graveyard[player] ?? []).filter((id) => s.objects[id] !== undefined && costUseDenial(s, player, id, 'exile') === null);
}

const mvOf = (s: GameState, id: ObjectId): number => {
  const o = s.objects[id];
  return o ? charsOfObject(s, o).manaValue : 0;
};

/**
 * CR 701.59b: can `player` collect evidence `n` at all (the cards of their graveyard have total mana value `n` or more)? `without`: cards an earlier part of
 * the same choice takes out of the graveyard first ("exile it and collect evidence 4": the card exiled first is no evidence).
 */
export function canCollectEvidence(s: GameState, player: PlayerId, n: number, without: ReadonlySet<ObjectId> = new Set()): boolean {
  if (n <= 0) return true;
  return evidenceCandidates(s, player).filter((id) => !without.has(id)).reduce((t, id) => t + mvOf(s, id), 0) >= n;
}

/** The whole number N of the step (CR 107.1b: never negative), or undefined when it can't be determined (CR 608.2b). */
export function evidenceAmount(cx: ExecCtx, st: ActionStep): number | undefined {
  if (st.n === undefined) return undefined;
  const raw = evalQty(cx, st.n);
  return raw === undefined || Number.isNaN(raw) ? undefined : Math.max(0, Math.floor(raw));
}

/**
 * std-costs-1 (CR 701.59a, 107.3): "you may collect evidence X. When you do, ... X ..." in an ability that announced no X (a triggered ability): the collector, its
 * controller, chooses X as they collect, from 0 up to the total mana value of the cards in their graveyard, and that X is the X of the rest of this resolution (a
 * reflexive trigger made from it fixes it, CR 603.12), as with "you may pay {X}" (pay.ts#choosesX). Lint lets the X through (model/lint-nodes.ts#definesX).
 */
function choosesEvidenceX(cx: ExecCtx, st: ActionStep, player: PlayerId): boolean {
  const n = st.n as { q?: unknown } | undefined;
  return typeof n === 'object' && n !== null && n.q === 'X' && cx.stack !== null && cx.stack.x === undefined && player === cx.controller;
}

const collectEvidence: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  const player = firstPlayer(cx, st.who);
  if (player !== undefined && choosesEvidenceX(cx, st, player)) {
    const max = evidenceCandidates(g.s, player).reduce((t, id) => t + mvOf(g.s, id), 0);
    const x = max === 0 ? 0 : g.choose({ kind: 'chooseNumber', player, prompt: 'Collect evidence X: choose X.', min: 0, max, cancellable: false, rules: ['CR 701.59a', 'CR 107.3'] }).n;
    cx.stack!.x = x; // the X of the rest of this resolution (effects/eval.ts reads the stack object's X first)
  }
  const n = evidenceAmount(cx, st);
  if (player === undefined || n === undefined) {
    bindAs(cx, st.as, []);
    return NOTHING;
  }
  const name = g.player(player).name;
  if (!canCollectEvidence(g.s, player, n)) {
    g.log(`${name} can't collect evidence ${n}: the cards in their graveyard have total mana value less than ${n}.`, { rules: ['CR 701.59b'], level: 'info' });
    bindAs(cx, st.as, []);
    return NOTHING;
  }
  const options = evidenceCandidates(g.s, player);
  const rules = ['CR 701.59a'];
  let picked = g.choose({
    kind: 'chooseObjects', player, prompt: `Collect evidence ${n}: exile cards from your graveyard with total mana value ${n} or more.`, options,
    min: n > 0 ? 1 : 0, max: options.length, rules,
  }).ids;
  let total = picked.reduce((t, id) => t + mvOf(g.s, id), 0);
  while (total < n) {
    spend(cx, 1);
    const rest = options.filter((id) => !picked.includes(id));
    if (rest.length === 0) break; // cannot happen: the whole graveyard reaches n (checked above)
    const more = g.choose({
      kind: 'chooseObjects', player, prompt: `Collect evidence ${n}: the cards chosen so far have total mana value ${total}. Choose another card to exile.`, options: rest,
      min: 1, max: 1, rules,
    }).ids;
    picked = [...picked, ...more];
    total = picked.reduce((t, id) => t + mvOf(g.s, id), 0);
  }
  const names = picked.map((id) => g.nameOf(id));
  const exiled: ObjHandle[] = [];
  for (const id of picked) {
    const m = proposeMove(cx, { id, zone: 'graveyard' }, 'exile', { cause: 'collectEvidence' });
    if (m.ok && m.to) exiled.push(m.to);
  }
  g.log(`${name} collects evidence ${n}, exiling ${names.join(', ') || 'no cards'} (total mana value ${total}).`, { rules, level: 'action' });
  performAction(g, { verb: 'collectEvidence', actor: player });
  bindAs(cx, st.as, exiled);
  return did(1);
};

/** The native action of this module by `ActionMacro.native` name (keywords/actions/evidence.ts). */
export const EVIDENCE_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { collectEvidence };
