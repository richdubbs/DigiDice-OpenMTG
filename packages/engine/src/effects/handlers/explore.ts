/**
 * std-lci: explore (CR 701.44) run as a native action, so that each explore is reported. Owner: std-lci.
 *
 *   CR 701.44a  The permanent's controller reveals the top card of their library; a land card goes to their hand, otherwise a +1/+1 counter goes on the
 *               exploring permanent and they may put the revealed card into their graveyard. The process is the keyword library's steps of ONE explore
 *               (keywords/actions/library.ts#exploreOnce, primitive ops), run once per repetition ("explores, then it explores again", "explores X times").
 *   CR 701.44b  The permanent explores once the process is complete, even if some or all of it was impossible: after each repetition the event
 *               `actionPerformed` with the verb `explore` names the exploring permanent and, when a card was revealed, whether it was a land card or a
 *               nonland card (`revealed`; an empty library reveals none). Triggers read it: "Whenever a creature you control explores", "... explores a land
 *               card", "... explores a nonland card" (triggers/match.ts).
 *   CR 701.44c  The actor is the permanent's controller as the step names it (`who`, last known information when it left the battlefield).
 *
 * A card whose manual text replaces explore ("If a creature you control would explore, instead ...", CR 614.1a) leaves the action to the players, as the
 * macro path does (effects/handlers/game.ts#action).
 */
import { isPlayerOnlyRefKind, type EffectStep, type ObjRef } from '../../types/ability';
import { exploreOnce } from '../../keywords/actions/library';
import { charsOfObject } from '../../rules/characteristics';
import type { StepHandler } from '../api';
import { evalQty } from '../eval';
import { askManual } from '../manual';
import { performAction } from '../perform';
import { proposeResult } from '../propose';
import { resolveObjs, resolvePlayers } from '../refs';
import { runSteps, spend } from '../run';
import { macroReplacedByManualText } from './manual-text';
import { NOTHING } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const EXPLORE_FEATURES: readonly string[] = ['action.native.explore'];

const explore: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  const replaced = macroReplacedByManualText(g, 'explore');
  // the prompt names the action as the macro path does (handlers/game.ts#action, `step.span ?? step.action`): the players perform "explore" as the manual
  // replacement says (CR 614.1a, 701.44a), and the prompt is the replacing card's own manual part when that card explores itself (Twists and Turns)
  if (replaced) return askManual(cx, st.span ?? 'explore', `explore is replaced by an ability the engine does not run (CR 614.1a), ${replaced}`);
  const n = st.n === undefined ? 1 : evalQty(cx, st.n);
  if (n === undefined) return NOTHING; // the number can't be determined (CR 608.2b): no explore
  const once = exploreOnce({ ...st, n: 1 });
  let count = 0;
  for (let i = 0; i < Math.floor(n); i++) {
    spend(cx, 1);
    const who = resolvePlayers(cx, st.who)[0];
    // CR 701.44a: the card revealed is the top card of that player's library as the explore begins
    const topId = who === undefined ? undefined : g.s.zones.library[who]?.[0];
    const top = topId === undefined ? undefined : g.s.objects[topId];
    const revealed = top === undefined ? undefined : charsOfObject(g.s, top).types.includes('Land') ? 'land' as const : 'nonland' as const;
    const subject = st.subject ?? { ref: 'self' };
    const explorer = isPlayerOnlyRefKind(subject.ref) ? undefined : resolveObjs(cx, subject as ObjRef)[0];
    // Cloud r4-repl (CR 701.44a, 614.1a): each explore is proposed first, so "If a creature you control would explore, instead you scry 1, then that creature
    // explores" replaces it (effects/proposal-kinds/explore.ts); replaced, this explore's process does not run (the replacement's instructions did instead)
    if (who !== undefined && explorer !== undefined && explorer.zone === 'battlefield' && proposeResult(g, { ev: 'explore', object: explorer, player: who }) === null) continue;
    count += runSteps(cx, once).count;
    if (who !== undefined) performAction(g, { verb: 'explore', actor: who, ...(explorer !== undefined ? { objectId: explorer.id } : {}), ...(revealed !== undefined ? { revealed } : {}) });
  }
  return { performed: Math.floor(n) > 0, count };
};

/** The native action of this module by `ActionMacro.native` name (effects/handlers/actions-native.ts#NATIVE_ACTIONS). */
export const EXPLORE_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { explore };
