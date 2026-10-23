/**
 * Steps and phases of the turn as English (WP2), for "at the beginning of your upkeep", "until your next turn", "it's your end step".
 */
import type { PlayerPred, PlayerRef } from '../types/ability';
import type { Step as TurnStep } from '../types/state';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { alt, NoRenderer } from './text';

/** The name of a step or phase without a possessor ("upkeep", "end step", "precombat main phase"). */
export const STEP_NAME: Readonly<Record<TurnStep, string>> = {
  untap: 'untap step',
  upkeep: 'upkeep',
  draw: 'draw step',
  // FAST1 T4, CR 505.1a: only the first main phase of a turn is a precombat main phase, so the two names say the same (not so for the second one)
  main1: alt('precombat main phase', 'first main phase'),
  beginCombat: 'beginning of combat',
  declareAttackers: 'declare attackers step',
  declareBlockers: 'declare blockers step',
  combatDamage: 'combat damage step',
  endCombat: 'end of combat',
  main2: 'postcombat main phase',
  end: 'end step',
  cleanup: 'cleanup step',
};

/**
 * "your upkeep", "each opponent's end step", "each upkeep", "that player's draw step". `next` adds "next" ("your next upkeep"). FAST5X E17: `nth` 2 of the
 * postcombat main phase is "second main phase" (CR 505.1b: the second main phase of the turn, not every postcombat main phase, CR 505.1a).
 */
export function possessiveStep(step: TurnStep, whose: PlayerPred | PlayerRef | undefined, st: RenderState, next = false, nth?: number): string {
  if (nth !== undefined && !(nth === 2 && step === 'main2')) throw new NoRenderer(`the main phase number ${nth} of ${step}`);
  const name = nth === 2 ? 'second main phase' : STEP_NAME[step];
  const nx = next ? 'next ' : '';
  if (step === 'beginCombat' || step === 'endCombat') {
    const label = step === 'beginCombat' ? 'combat' : 'end of combat';
    if (whose === 'you' || (typeof whose === 'object' && whose.ref === 'you')) return step === 'beginCombat' ? `${next ? 'next ' : ''}${label} on your turn` : `${nx}${label}`;
    if (whose === undefined || whose === 'any') return step === 'beginCombat' ? alt(`each ${label}`, `the ${nx}${label}`) : `${nx}${label}`;
    return step === 'beginCombat' ? `${nx}${label} on ${K.player(whose, st, 'possessive').text} turn` : `${nx}${label}`;
  }
  if (whose === 'you' || (typeof whose === 'object' && whose.ref === 'you')) return `your ${nx}${name}`;
  if (whose === 'opponent') return alt(`each opponent's ${nx}${name}`, `an opponent's ${nx}${name}`);
  if (whose === undefined || whose === 'any') return next ? `the next ${name}` : alt(`each ${name}`, `the ${name}`, `each player's ${name}`);
  if (typeof whose === 'object' && whose.ref === 'controllerOf' && !next) {
    // FAST1 T4: "the upkeep of enchanted creature's controller" is that player's upkeep (an older Oracle order of the same words, CR 503.1); both readings
    // are printed from the state as it is before either names the player
    const of = K.player(whose, cloneState(st), 'object').text;
    return alt(`${K.player(whose, st, 'possessive').text} ${name}`, `the ${name} of ${of}`);
  }
  return `${K.player(whose, st, 'possessive').text} ${nx}${name}`;
}

/** "your turn", "an opponent's turn", "each player's turn". */
export function turnOf(whose: PlayerPred | PlayerRef, st: RenderState, next = false): string {
  const nx = next ? 'next ' : '';
  if (whose === 'you' || (typeof whose === 'object' && whose.ref === 'you')) return `your ${nx}turn`;
  if (whose === 'opponent') return `an opponent's ${nx}turn`;
  if (whose === 'any') return `each player's ${nx}turn`;
  return `${K.player(whose, st, 'possessive').text} ${nx}turn`;
}
