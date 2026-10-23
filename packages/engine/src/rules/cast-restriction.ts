/**
 * Casting restrictions written in Oracle text ("Cast this spell only during combat.", CR 601.3, 101.2).
 *
 * Only pure timing restrictions are recognized (about two thirds of the printed ones: steps of the turn and whose turn).
 * Conditional ones ("only if you control a creature") stay manual text: castSpell logs a warning for them so they are
 * never silently skipped (docs/ARCHITECTURE.md). The compiler turns a recognized line into a static ability with one
 * `restrict` effect (`mode: 'onlyIf'`, `action: 'cast'`, `when: turnOf`); castCheck reads it through the characteristics.
 */
import type { Condition, PlayerPred, StaticAbilityDef } from '../types/ability';
import type { PlayerId } from '../types/ids';
import type { GameState, Step } from '../types/state';
import { deny, type Denial } from './denial';

export interface CastRestriction {
  /** Steps in which the spell may be cast (all steps when absent). */
  steps?: Step[];
  /** Whose turn: the caster's or an opponent's (any when absent). */
  turn?: 'you' | 'opponent';
}

const COMBAT: Step[] = ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'];
const BEFORE_ATTACKERS: Step[] = ['untap', 'upkeep', 'draw', 'main1', 'beginCombat'];
const BEFORE_BLOCKERS: Step[] = [...BEFORE_ATTACKERS, 'declareAttackers'];
const BEFORE_DAMAGE: Step[] = [...BEFORE_BLOCKERS, 'declareBlockers'];
const AFTER_BLOCKERS: Step[] = ['declareBlockers', 'combatDamage', 'endCombat'];
const AFTER_UPKEEP: Step[] = ['draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat', 'main2', 'end'];

/** Phrase after "Cast this spell only " (lower case, no final period) -> restriction. */
const PHRASES: Record<string, CastRestriction> = {
  'during combat': { steps: COMBAT },
  'during combat before blockers are declared': { steps: ['beginCombat', 'declareAttackers'] },
  'during combat after blockers are declared': { steps: AFTER_BLOCKERS },
  'during combat on an opponent\'s turn': { steps: COMBAT, turn: 'opponent' },
  'during combat on your turn': { steps: COMBAT, turn: 'you' },
  'during combat on your turn before blockers are declared': { steps: ['beginCombat', 'declareAttackers'], turn: 'you' },
  'during the declare attackers step': { steps: ['declareAttackers'] },
  'during your declare attackers step': { steps: ['declareAttackers'], turn: 'you' },
  'during the declare blockers step': { steps: ['declareBlockers'] },
  'during the declare blockers step on an opponent\'s turn': { steps: ['declareBlockers'], turn: 'opponent' },
  'before the combat damage step': { steps: BEFORE_DAMAGE },
  'before attackers are declared': { steps: BEFORE_ATTACKERS },
  'before blockers are declared': { steps: BEFORE_BLOCKERS },
  'before combat or during combat before blockers are declared': { steps: BEFORE_BLOCKERS },
  'after combat': { steps: ['main2', 'end'] },
  'during your turn': { turn: 'you' },
  'during an opponent\'s turn': { turn: 'opponent' },
  'during your end step': { steps: ['end'], turn: 'you' },
  'during an opponent\'s upkeep': { steps: ['upkeep'], turn: 'opponent' },
  'during an opponent\'s turn, before attackers are declared': { steps: BEFORE_ATTACKERS, turn: 'opponent' },
  'during an opponent\'s turn after their upkeep step': { steps: AFTER_UPKEEP, turn: 'opponent' },
};

const PREFIX = /^cast this spell only\s+/i;

/** True for a line that is a casting restriction, recognized or not. */
export const isCastRestrictionLine = (line: string): boolean => PREFIX.test(line.trim());

/**
 * Recognize a casting-restriction line as a static ability, or null (conditional or unknown wording).
 * Model form (design 4.4): `{s:'restrict', mode:'onlyIf', action:'cast', when:{cond:'turnOf', whose, step}}` on the spell itself.
 */
export function parseCastRestriction(line: string): StaticAbilityDef | null {
  const t = line.trim().replace(/[‘’]/g, '\'');
  if (!PREFIX.test(t)) return null;
  const phrase = t.replace(PREFIX, '').replace(/\.$/, '').toLowerCase();
  const r = PHRASES[phrase];
  if (!r) return null;
  const when: Condition = { cond: 'turnOf', whose: r.turn ?? 'any', ...(r.steps ? { step: r.steps } : {}) };
  return { kind: 'static', text: line.trim(), zone: ['stack'], effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'onlyIf', action: 'cast', when }] };
}

/** The timing restriction a static ability states ("Cast this spell only ..."), or undefined for any other static ability. */
export function castRestrictionOf(def: StaticAbilityDef): { whose: PlayerPred; steps?: Step[] } | undefined {
  for (const e of def.effects) {
    if (e.s !== 'restrict' || e.mode !== 'onlyIf' || e.action !== 'cast' || e.when?.cond !== 'turnOf') continue;
    const steps = e.when.step === undefined ? undefined : Array.isArray(e.when.step) ? e.when.step : [e.when.step];
    return { whose: e.when.whose, ...(steps ? { steps } : {}) };
  }
  return undefined;
}

/** CR 601.3: the restriction forbids casting the spell now? `text` is the Oracle line, used in the message. */
export function castRestrictionDenial(s: GameState, player: PlayerId, def: StaticAbilityDef): Denial | null {
  const r = castRestrictionOf(def);
  if (!r) return null;
  const own = s.turn.activePlayer === player;
  if ((r.whose === 'you' && !own) || (r.whose === 'opponent' && own) || (r.steps && !r.steps.includes(s.turn.step))) {
    return deny(`Casting restriction: "${def.text}"`, 'CR 601.3', 'CR 101.2');
  }
  return null;
}
