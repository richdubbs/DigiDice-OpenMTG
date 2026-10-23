/**
 * How a player lost (design 7; package M13-7): the ledger's `LossCode` and CR citation, from the engine's `playerLost.rules` (core/sba.ts#markLost
 * cites the rule of every loss) and from the table's own causes (the server applied the concession: time-out, disconnect, Leave; design D11).
 *
 * Order of precedence: the table's cause (its concession is logged with that cause), then the engine's citations, then the engine's reason text
 * (`PlayerState.lostReason`; only for a loss whose event was not seen, such as a hand-built state, and for the table's own tests before M13-7).
 */
import type { GameEvent, PlayerId } from '@openmtg/engine';
import type { LossCode } from '../api';

/** A table's own cause of a seat's concession (the table's `TableCause`; repeated here so the ledger does not depend on the table's types). */
export type LedgerCause = 'timeout' | 'disconnect' | 'left';

export interface LossOf {
  loss: LossCode;
  lossRule: string | null;
}

/**
 * The engine's citations of a loss and the loss code each one means (CR 104.2-104.3, 704.5-704.6). The state-based actions cite 704.5a-c and 704.6c;
 * the 104.3 rules are their general forms (a future engine line may cite either). Anything else that makes a player lose is an effect (CR 104.3e).
 */
export const LOSS_RULES: Readonly<Record<string, LossCode>> = {
  'CR 704.5a': 'life',
  'CR 104.3b': 'life',
  'CR 704.5b': 'emptyLibrary',
  'CR 104.3c': 'emptyLibrary',
  'CR 704.5c': 'poison',
  'CR 104.3d': 'poison',
  'CR 704.6c': 'commanderDamage',
  'CR 104.3j': 'commanderDamage',
  'CR 903.10a': 'commanderDamage',
  'CR 104.3a': 'concession',
  'CR 104.2b': 'opponentWon',
  'CR 104.3h': 'opponentWon',
  'CR 104.3e': 'effect',
};

/** The citation a table cause is logged with: the server applies the seat's concession (CR 104.3a). */
export const CAUSE_RULE = 'CR 104.3a';

/** The loss code of the engine's citations: the first citation the ledger knows, else an effect (CR 104.3e) citing the engine's first rule. Null: no citations. */
export function lossFromRules(rules: readonly string[] | null | undefined): LossOf | null {
  if (!rules || rules.length === 0) return null;
  for (const r of rules) {
    const code = LOSS_RULES[r];
    if (code) return { loss: code, lossRule: r };
  }
  return { loss: 'effect', lossRule: rules[0] ?? 'CR 104.3e' };
}

/** The engine's reason texts (core/sba.ts) mapped as M13-2's first rule did: only when no citations were seen. */
function lossFromReason(reason: string | undefined): LossOf {
  const r = reason ?? '';
  if (r === 'conceded') return { loss: 'concession', lossRule: 'CR 104.3a' };
  if (r === 'has 0 or less life') return { loss: 'life', lossRule: 'CR 704.5a' };
  if (r === 'attempted to draw from an empty library') return { loss: 'emptyLibrary', lossRule: 'CR 704.5b' };
  if (r === 'has ten or more poison counters') return { loss: 'poison', lossRule: 'CR 704.5c' };
  if (/commander/i.test(r)) return { loss: 'commanderDamage', lossRule: 'CR 704.6c' };
  if (/ won the game$/.test(r)) return { loss: 'opponentWon', lossRule: 'CR 104.2b' };
  return { loss: 'effect', lossRule: 'CR 104.3e' };
}

/**
 * The loss code and CR citation of a player who lost: the table's cause first (`timeout`, `disconnect`, `left`, each a concession by the table's rule,
 * CR 104.3a), then the engine's citations (`playerLost.rules`), then the engine's reason text.
 */
export function lossOf(reason: string | undefined, cause: LedgerCause | null, rules?: readonly string[] | null): LossOf {
  if (cause === 'timeout' || cause === 'disconnect' || cause === 'left') return { loss: cause, lossRule: CAUSE_RULE };
  return lossFromRules(rules) ?? lossFromReason(reason);
}

/** The citations of every `playerLost` event of a change, by player (a player loses once: the first event counts). */
export function lossRulesOf(events: readonly GameEvent[]): Map<PlayerId, string[]> {
  const out = new Map<PlayerId, string[]>();
  for (const e of events) {
    if (e.type !== 'playerLost' || out.has(e.player)) continue;
    out.set(e.player, [...(e.rules ?? [])]);
  }
  return out;
}
