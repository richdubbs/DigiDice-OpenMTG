/**
 * The `payLife` proposal kind (std-library-4; CR 119.4, 614.1a): "If you would pay life while your library has at least that many cards in it, exile that many cards
 * from the top of your library instead." (Ashiok, Wicked Manipulator). Every payment of life, as a cost (rules/pay-parts.ts), for a Phyrexian mana symbol
 * (rules/pay.ts) or in an effect, goes through rules/life.ts#payLife, which proposes it here once the player CAN pay it (a replacement never lets a player pay more
 * life than their life total, or pay life while they can't lose life: CR 119.4, 119.8; ruling 2023-09-01), so a replacement effect may replace the payment (an
 * `instead` body). Replaced, the payment still counts as made (the cost is paid; no life is lost, so nothing that waits for life loss triggers, CR 614.6). The
 * pattern is `{ev:'action', verb:'payLife', actor}`, the paying player, and `{q:'eventAmount'}` is the amount of life.
 */
import type { Proposed } from '../api';
import { performPayLifeEvent } from '../perform-events';
import type { ProposalKind } from '../registries';

export const PAY_LIFE_KIND: ProposalKind<Extract<Proposed, { ev: 'payLife' }>> = {
  ev: 'payLife',
  capabilities: ['feature:replace.on.action.payLife'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'action', roles: { player: { players: [e.player] } }, data: { verb: 'payLife', amount: e.amount } }),
  affectedPlayer: (_g, e) => e.player, // CR 616.1: the paying player
  forbidden: () => null, // checked before it is proposed (rules/life.ts#canPayLife, CR 119.4, 119.8)
  perform: (g, e) => performPayLifeEvent(g, e),
};
