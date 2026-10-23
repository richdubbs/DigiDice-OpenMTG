/**
 * The `mill` proposal kind (Cloud r3-repl; CR 701.17a, 614.1a): "If an opponent would mill one or more cards, they mill that many cards plus four instead." The
 * mill instruction (effects/handlers/cards-draw.ts#millHandler) proposes each player's mill as ONE event with its number of cards before it moves any card, so a
 * replacement effect can change the number (a `modify.count` body) or replace the mill; the handler then moves the top cards of the final event's number (each
 * card's own move is proposed as before, CR 614.1a: "exile it instead" still applies to each). The pattern is `{ev:'action', verb:'mill'}` with `actor`, the
 * milling player. A mill that is a cost (rules/pay-parts.ts) is not proposed: no replacement modifies it (fail closed: it mills what the cost says).
 */
import type { Proposed } from '../api';
import { performNothing } from '../perform-events';
import type { ProposalKind } from '../registries';

export const MILL_KIND: ProposalKind<Extract<Proposed, { ev: 'mill' }>> = {
  ev: 'mill',
  capabilities: ['feature:replace.on.action.mill'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'action', roles: { player: { players: [e.player] } }, data: { verb: 'mill', amount: e.count } }),
  affectedPlayer: (_g, e) => e.player, // CR 616.1: the milling player
  forbidden: () => null,
  perform: (g, e) => performNothing(g, e), // the mill instruction moves the cards itself
};
