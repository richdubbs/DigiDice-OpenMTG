/**
 * MRE (C6 gap 7): the priority actions for manual triggered and static abilities (rules/by-hand.ts says which abilities qualify).
 *
 *  - `manualTrigger`: the controller attests that a manual triggered ability of their permanent triggered (CR 603.2) and puts it on the stack (CR 603.3,
 *    triggers/stack.ts#triggerNow). It resolves like every ability once all players pass (CR 608.2): through normal resolution when its effect was understood,
 *    otherwise through the manualResolve decision, which the controller answers in steps (core/manual.ts#chooseManualSteps).
 *  - `manualStatic`: the controller applies what a manual static ability does (CR 604.1: static abilities don't use the stack) with manual operations, at once:
 *    a manualResolve decision about the permanent (`subjectId`), in steps, cancellable on its first prompt only (nothing has happened yet, CR 733.1; core/manual.ts#chooseManualSteps).
 *
 * Both are logged publicly at level `manual` with the card's name and the ability's text (the source is in a public zone, so nothing hidden is named). The
 * player keeps priority afterwards, as after any action (CR 117.3c).
 */
import type { Action } from '../types/actions';
import { byHandAbilities, byHandDenial } from '../rules/by-hand';
import { triggerNow } from '../triggers/stack';
import { IllegalAction, type Game } from './game';
import { resolveManually } from './manual';

type ByHandAction = Extract<Action, { type: 'manualTrigger' | 'manualStatic' }>;

export function performByHand(g: Game, action: ByHandAction): void {
  const { player, source, ability } = action;
  if (action.type === 'manualTrigger') {
    triggerNow(g, player, source, ability);
    return;
  }
  const denial = byHandDenial(g.s, player, source, ability, 'manualStatic');
  if (denial) throw new IllegalAction(denial.message, denial.rules);
  const info = byHandAbilities(g.s, g.obj(source), 'manualStatic').find((a) => a.key === ability)!;
  const name = g.nameOf(source);
  const text = info.def.text.split('\n').join(' ');
  g.log(`${g.player(player).name} applies ${name}'s static ability by hand: ${text}`, { rules: ['CR 604.1'], level: 'manual' });
  resolveManually(g, player, {
    kind: 'manualResolve',
    player,
    prompt: `Apply ${name}'s static ability by hand: ${text}`,
    sourceName: name,
    text,
    subjectId: source,
    reason: info.def.reason,
    cancellable: true,
    rules: ['CR 604.1'],
  });
}
