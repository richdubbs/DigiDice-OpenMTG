/**
 * "Can't" checks of the milestone 3/4 call-sites outside the proposal pipeline (design 9.4, CR 101.2, 614.17). Added by WP31: costs (CR 614.17b: "if an
 * event can't happen, a player can't choose to pay a cost that includes that event"), the draw step, counters put on objects and players, and the cleanup
 * discard. Every question goes to statics/hooks.ts#ruleDenial, which answers only wired rule actions (`rule:<action>`), so a call-site here never enforces
 * more or less than the capabilities promise. Pure.
 */
import type { RuleAction } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import type { Denial } from './denial';
import { ruleDenial } from '../statics/hooks';

/** Does a "can't" effect forbid this action of this subject now? */
export function cantDo(s: GameState, action: RuleAction, subject: ObjectId | PlayerId, other?: ObjectId | PlayerId): Denial | null {
  return ruleDenial(s, { action, subject, ...(other !== undefined ? { other } : {}) });
}

/** How a cost part uses an object (rules/cost-pick.ts). */
export type CostUse = 'sacrifice' | 'returnToHand' | 'exile' | 'discard' | 'putCounters' | 'beamUp'; // trek-1: 'beamUp', returned for a beam me up cost

/**
 * CR 614.17b: may this object pay a part of a cost of `player`? A sacrifice is the player sacrificing (`sacrifice`), the permanent being sacrificed
 * (`beSacrificed`) and leaving the battlefield (`leave`); returning a permanent to its owner's hand leaves the battlefield; exiling is `beExiled` (and `leave`
 * from the battlefield); discarding is the player's `discard`; putting counters is `haveCountersPut`.
 */
export function costUseDenial(s: GameState, player: PlayerId, id: ObjectId, use: CostUse): Denial | null {
  const o = s.objects[id];
  const onBattlefield = o?.zone === 'battlefield';
  switch (use) {
    case 'sacrifice':
      return cantDo(s, 'sacrifice', player, id) ?? cantDo(s, 'beSacrificed', id) ?? cantDo(s, 'leave', id);
    case 'returnToHand':
      return onBattlefield ? cantDo(s, 'leave', id) : null;
    // trek-1 (Star Trek beam me up, CR 702 rule number unverified; CR 614.17b): returning a creature to pay a beam me up cost beams it up; a permanent that
    // "can't be beamed up" can't be returned for it (Marooned)
    case 'beamUp':
      return (onBattlefield ? cantDo(s, 'leave', id) : null) ?? cantDo(s, 'beBeamedUp', id);
    case 'exile':
      return cantDo(s, 'beExiled', id) ?? (onBattlefield ? cantDo(s, 'leave', id) : null);
    case 'discard':
      return cantDo(s, 'discard', player, id);
    case 'putCounters':
      return cantDo(s, 'haveCountersPut', id);
  }
}
