/**
 * The `scry` proposal kind (p2-replace-events-3; CR 701.22a, 614.1a): "If you would scry a number of cards, draw that many cards instead." (Eligeth, Crossroads Augur).
 * The scry instruction (effects/handlers/cards-library.ts#scryHandler) proposes each player's scry, with its number of cards, as ONE event before that player looks
 * at any card, so a replacement effect can replace it (`{q:'eventAmount'}` is that number, effects/instead.ts#eventAmount); a scry still there runs as before. The
 * pattern is `{ev:'action', verb:'scry', actor}`, the scrying player. CR 614.5: a scry an `instead` body makes is not replaced again by the same effect.
 */
import type { Proposed } from '../api';
import { performNothing } from '../perform-events';
import type { ProposalKind } from '../registries';

export const SCRY_KIND: ProposalKind<Extract<Proposed, { ev: 'scry' }>> = {
  ev: 'scry',
  capabilities: ['feature:replace.on.action.scry'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'action', roles: { player: { players: [e.player] } }, data: { verb: 'scry', amount: e.count } }),
  affectedPlayer: (_g, e) => e.player, // CR 616.1: the scrying player
  forbidden: () => null,
  perform: (g, e) => performNothing(g, e), // the scry instruction looks and orders the cards itself
};
