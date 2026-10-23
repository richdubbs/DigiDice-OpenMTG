/**
 * Plain operations on GameState.combat (CR 506-511): who attacks, who blocks, removal from combat.
 * No rules decisions live here; see rules/combat-rules.ts (legality) and core/combat*.ts (turn-based actions).
 */
import type { ObjectId } from '../types/ids';
import type { AttackerState, CombatState, GameState } from '../types/state';

/** The combat phase that begins now: numbered by the combat phases this turn has had (CR 500.8). */
export function newCombat(s: GameState): CombatState {
  const number = (s.turn.combats ?? 0) + 1;
  s.turn.combats = number;
  return { number, attacked: false, attackers: [], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] };
}

export const attackerState = (s: GameState, id: ObjectId): AttackerState | undefined => s.combat?.attackers.find((a) => a.id === id);
export const isAttacking = (s: GameState, id: ObjectId): boolean => attackerState(s, id) !== undefined;
export const isBlocking = (s: GameState, id: ObjectId): boolean => s.combat?.blockers.some((b) => b.id === id) ?? false;

/** CR 509.1h: a blocked creature stays blocked even if every creature blocking it leaves combat. */
export const isBlocked = (s: GameState, id: ObjectId): boolean => attackerState(s, id)?.blocked ?? false;
export const isUnblocked = (s: GameState, id: ObjectId): boolean => {
  const a = attackerState(s, id);
  return a !== undefined && !a.blocked;
};

/** The player attacked, or whose planeswalker / battle is attacked, by this attacker (CR 508.5). */
export const defendingPlayerOf = (s: GameState, id: ObjectId) => attackerState(s, id)?.defendingPlayer;

/** p2-combat-flow-2 (CR 509.1h, 506.4): an attacking creature that is not blocked becomes blocked, with no creature blocking it; whether it changed. */
export function makeBlocked(s: GameState, id: ObjectId): boolean {
  const a = s.combat?.attackers.find((x) => x.id === id);
  if (a === undefined || a.blocked) return false;
  a.blocked = true;
  return true;
}

/**
 * CR 506.4: a permanent is removed from combat if it leaves the battlefield, changes controller, phases out, stops being a creature, regenerates...
 * A creature that is removed stops being attacking, blocking, blocked and unblocked (an attacker that was blocked keeps its blocked status
 * only while it is still in combat, CR 509.1h). A planeswalker or battle that is removed stops being attacked; creatures attacking it
 * stay in combat but attack nothing (CR 506.4c) and deal no combat damage.
 */
export function removeFromCombat(s: GameState, id: ObjectId): void {
  const c = s.combat;
  if (!c) return;
  c.attackers = c.attackers.filter((a) => a.id !== id);
  c.blockers = c.blockers.filter((b) => b.id !== id);
  for (const a of c.attackers) {
    a.blockedBy = a.blockedBy.filter((x) => x !== id);
    if (a.defender === id) a.defender = null; // CR 506.4c
  }
  for (const b of c.blockers) b.blocking = b.blocking.filter((x) => x !== id);
}
