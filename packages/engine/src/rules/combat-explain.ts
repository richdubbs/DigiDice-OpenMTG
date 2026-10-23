/**
 * Why a combat declaration was rejected (CR 508.1, 509.1): the declare attackers / blockers decisions offer only legal choices
 * (rules/combat-rules.ts), and an answer outside the offer is rejected with the specific reason (defender, summoning sickness, flying,
 * menace, protection, landwalk...) and its rule citations instead of a bare "cannot".
 */
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import { charsOfObject } from './characteristics';
import { attackDenial, blocksDenial } from './combat-rules';
import { deny, type Denial } from './denial';

/** `generic` is always cited first, then the rules of the specific denial. */
function withGeneric(generic: Denial, specific: Denial | null): Denial {
  if (!specific) return generic;
  return deny(specific.message, generic.rules[0]!, ...specific.rules.filter((r) => r !== generic.rules[0]));
}

/** Why `player` can't declare this creature as an attacker. */
export function attackerRejection(s: GameState, player: PlayerId, attacker: ObjectId): Denial {
  const generic = deny('That creature cannot attack.', 'CR 508.1a');
  const o = s.objects[attacker];
  if (!o || o.controller !== player) return deny('You can attack only with creatures you control.', 'CR 508.1a');
  return withGeneric(generic, attackDenial(s, o, charsOfObject(s, o)));
}

/** Why `defending` can't declare `blocker` as blocking `attacker`. */
export function blockRejection(s: GameState, defending: PlayerId, blocker: ObjectId, attacker: ObjectId): Denial {
  const generic = deny('That creature cannot block.', 'CR 509.1a');
  const b = s.objects[blocker];
  if (!b || b.controller !== defending) return deny('You can block only with creatures you control.', 'CR 509.1a');
  return withGeneric(generic, blocksDenial(s, defending, [{ blocker, attacker }]));
}
