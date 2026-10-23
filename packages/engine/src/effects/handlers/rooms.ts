/**
 * Rooms on the effect side (FAST5X E8, CR 709.5e-g): the payment of the unlock special action (installed into core/rooms.ts, which can't import the payer) and
 * the effects that unlock, or lock or unlock, a door of a Room (`designateObject` 'unlockDoor' / 'lockOrUnlockDoor', effects/handlers/levels.ts).
 *
 *   CR 709.5e, 116.2m  the unlock cost is the mana cost of the locked half; the mana is spent on an unlock (`SpendContext` 'unlock': only mana whose restriction
 *                      says "unlock doors" may pay it, CR 106.6); a special action is neither a spell nor an ability (CR 116.2)
 *   CR 709.5f          "unlock a locked door of <Room>": the player chooses a locked half of that permanent, which gets its unlocked designation
 *   CR 709.5g          "lock or unlock a door of <Room>": the player chooses a half; a locked one is unlocked (CR 709.5f), an unlocked one is locked (CR 709.5g)
 */
import type { Game } from '../../core/game';
import { doorName, installUnlock, isRoomPermanent, lockDoor, lockedHalves, unlockDoor, unlockedHalves } from '../../core/rooms';
import type { CostDef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import { planDenial, planFromCostDef, type CostPlan } from '../../rules/cost';
import { unlockManaCost } from '../../statics/costmods';
import { resolveAnyCounts } from '../../rules/pay';
import { performEffectPayment } from '../perform';

/** The plan of an unlock cost: mana for an unlock (CR 709.5e), from the Room itself. */
const planOf = (cost: CostDef, id: ObjectId): CostPlan => ({ ...planFromCostDef(cost, 0), spend: { kind: 'unlock', id } });

installUnlock({
  payable: (s, player, id, cost) => planDenial(s, player, id, planOf(cost, id)) === null,
  pay: (g, player, id, cost, what) => performEffectPayment(g, player, id, resolveAnyCounts(g, player, id, planOf(cost, id), what), what),
  modified: (s, player, mana) => unlockManaCost(s, player, mana), // std-rh: CR 118.7, 601.2f
});

/** The label of half `face` of Room `id` for a choice. */
function label(g: Game, id: ObjectId, face: number, verb: string): string {
  const def = g.s.defs[g.obj(id).defId]!;
  return `${verb} ${def.faces[face]?.name ?? doorName(face)} (${doorName(face)} door)`;
}

/**
 * CR 709.5f-g: `player` unlocks a locked door of Room `id` (`mode` 'unlock'), or locks or unlocks one of its doors ('lockOrUnlock'). One door to choose from is
 * chosen without asking. False when nothing changed (not a Room permanent, no such door).
 */
export function doorEffect(g: Game, id: ObjectId, player: PlayerId, mode: 'unlock' | 'lockOrUnlock'): boolean {
  const o = g.s.objects[id];
  if (!isRoomPermanent(g.s, o)) return false;
  const def = g.s.defs[o.defId]!;
  const locked = lockedHalves(g.s, o);
  const open = mode === 'lockOrUnlock' ? unlockedHalves(def, o) : [];
  const options = [...locked.map((f) => ({ id: `unlock:${f}`, label: label(g, id, f, 'Unlock') })), ...open.map((f) => ({ id: `lock:${f}`, label: label(g, id, f, 'Lock') }))];
  if (options.length === 0) return false;
  const pick = options.length === 1 ? options[0]!.id : g.choose({
    kind: 'chooseOption', player, prompt: mode === 'unlock' ? `Choose a locked door of ${g.nameOf(id) || 'the Room'} to unlock.` : `Choose a door of ${g.nameOf(id) || 'the Room'} to lock or unlock.`,
    options, min: 1, max: 1, rules: mode === 'unlock' ? ['CR 709.5f'] : ['CR 709.5f', 'CR 709.5g'],
  }).ids[0]!;
  const [verb, f] = pick.split(':');
  const face = Number(f);
  return verb === 'lock' ? lockDoor(g, id, face, player) : unlockDoor(g, id, face, player);
}
