/**
 * Test helpers over WP4's history readers (rules/history.ts): the facts convention is WP4's and triggers/history.ts writes it, so the tests of what WP8 writes read it
 * back through the one reader the interpreter uses (effects/eval.ts, rules/filter.ts).
 */
import type { Condition, EventPattern, HistoryScope, PlayerPred } from '../../../src/types/ability';
import type { PlayerId } from '../../../src/types/ids';
import type { GameState, HistoryEntry } from '../../../src/types/state';
import { attackedThisTurn, blockedThisTurn, countHistory as count, dealtDamageThisTurn, enteredThisTurn, historyMatches } from '../../../src/rules/history';

export const countHistory = (s: GameState, p: EventPattern, scope: HistoryScope, you: PlayerId, by?: PlayerPred): number => count(s, p, scope, by, { you });

export function happened(s: GameState, c: Extract<Condition, { cond: 'happened' }>, you: PlayerId): boolean {
  const n = countHistory(s, c.event, c.scope, you, c.by);
  const times = c.times;
  if (!times) return n >= 1;
  const want = typeof times.value === 'number' ? times.value : NaN;
  return times.op === '>=' ? n >= want : times.op === '==' ? n === want : times.op === '<=' ? n <= want : times.op === '>' ? n > want : times.op === '<' ? n < want : n !== want;
}

export const entryMatches = (p: EventPattern, e: HistoryEntry, you: PlayerId): boolean => historyMatches(e, p, { you });

export function objectHistory(s: GameState, id: string, kind: 'enteredThisTurn' | 'dealtDamageThisTurn' | 'attackedThisTurn' | 'blockedThisTurn'): boolean {
  return { enteredThisTurn, dealtDamageThisTurn, attackedThisTurn, blockedThisTurn }[kind](s, id);
}
