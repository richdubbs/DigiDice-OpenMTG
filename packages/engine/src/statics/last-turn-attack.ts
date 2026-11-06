import type { GameState } from '../types/state';
import type { PlayerId } from '../types/ids';

/**
 * CR 506.1, 508.1: did `attacker` attack `victim` (the player, not a planeswalker or battle) during the attacker's own last turn before this one? Read from the game history
 * (`beginTurn` and `attacks` entries). Used by "can attack players who attacked you during their last turn as though it didn't have defender" (edh-combat-6) and
 * "if a player attacked you during their last turn" (edh-d-45, Avenge).
 */
export function playerAttackedPlayerLastTurn(s: GameState, attacker: PlayerId, victim: PlayerId): boolean {
  let last = -1;
  for (const e of s.history) if (e.ev === 'beginTurn' && e.actor === attacker && e.turn < s.turn.number && e.turn > last) last = e.turn;
  if (last < 0) return false;
  return s.history.some((e) => e.ev === 'attacks' && e.turn === last && e.actor === attacker && e.facts['defenderKind'] === 'player' && e.facts['defendingPlayer'] === victim);
}

/** Did any player other than `victim` attack `victim` during their own last turn? */
export function aPlayerAttackedYouLastTurn(s: GameState, victim: PlayerId): boolean {
  return s.players.some((p) => p.id !== victim && !p.hasLost && playerAttackedPlayerLastTurn(s, p.id, victim));
}
