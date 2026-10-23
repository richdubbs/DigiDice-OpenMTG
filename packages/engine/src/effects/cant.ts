/**
 * "Can't" effects (CR 614.17, 101.2) for the proposal pipeline (effects/propose.ts, design 8.5, 9.4). Owner: WP11 (an addition to the files of design 5.1,
 * split out of propose.ts). Pure: it reads the state and the statics provider, never writes.
 *
 * WP31: every question goes to statics/hooks.ts#ruleDenial, the full evaluator of the rule hooks (a restriction's `other` with "you" = its controller, CR
 * 109.5; `when`; `onlyIf`; what it can't evaluate is applied, fail closed), and only for the rule actions that are wired (`rule:<action>` in
 * RULE_HOOK_ACTIONS), so what the pipeline enforces is exactly what the capabilities promise. `enter` is judged as the permanent would exist on the
 * battlefield (CR 614.17d).
 */
import type { Game } from '../core/game';
import type { RuleAction } from '../types/ability';
import type { PlayerId } from '../types/ids';
import { ruleDenial, type EnterFacts } from '../statics/hooks';
import type { RuleQuery } from '../statics/api';
import type { Proposed } from './api';
import { kindOf } from './registries';

/**
 * The rule actions whose "can't" restrictions the pipeline consults at its call sites (design 9.4, CR 614.17): the events' own actions (`forbidden`),
 * `preventDamage` ("damage can't be prevented", CR 615.12: the damage becomes unpreventable; wired by FAST5 T57, see statics/hooks.ts), `beRegenerated` ("can't be
 * regenerated", CR 701.19c: shields are not applied) and `payLife` ("can't pay life", CR 119.8: a cost "you may pay" as it enters is not offered).
 */
export const FORBIDDEN_ACTIONS: readonly RuleAction[] = [
  'receiveDamage', 'dealDamage', 'gainLife', 'loseLife', 'draw', 'enter', 'leave', 'beExiled', 'beDestroyed', 'haveCountersPut',
  'preventDamage', 'beRegenerated', 'payLife',
  'preventCombatDamage', // r5-repl: "combat damage can't be prevented" (CR 615.12, 510.2), effects/propose.ts#unpreventableIfRuled
];

/** Is the action forbidden by a "can't" effect (CR 614.17)? Only for the wired actions. Pure. */
export function ruleForbids(g: Game, q: RuleQuery, opts: { controller?: PlayerId } & EnterFacts = {}): boolean {
  return ruleDenial(g.s, q, opts) !== null;
}

/** Why the event can't happen (a log line, CR 119.7-119.8 for life, CR 614.17), or null. Pure. M6-0 (m6 design 2.6, E17): each proposal kind asks its own
 * "can't" questions (design 9.4: who or what would do or undergo it, and for an entering permanent who would control it, the face it enters with and whether
 * it enters face down, CR 614.17d, 712.12, 712.14a, 708.3); the milestone 5 questions moved unchanged to effects/proposal-kinds/m5.ts. */
export function forbiddenBy(g: Game, e: Proposed): string | null {
  return kindOf(e).forbidden?.(g, e) ?? null;
}

/**
 * CR 614.17, 101.2: can the event happen at all? Milestone 4's player restrictions ("can't gain life", "can't lose life") are read here as they are by
 * rules/life.ts; static "can't" effects come from the statics provider for the actions it has wired.
 */
export function forbidden(g: Game, e: Proposed): boolean {
  return forbiddenBy(g, e) !== null;
}
