/**
 * The `connive` proposal kind (Cloud r3-repl; CR 701.50a, 614.1a): "If a creature you control would connive, instead you draw a card, then that creature
 * connives." The keyword action `connive` (effects/handlers/game.ts, the `action` op) proposes each conniving permanent's connive as ONE event before its macro
 * runs (draw, discard, counters: keywords/actions/library.ts#CONNIVE), so a replacement effect can replace it; when the event is still there the macro runs as
 * before. The pattern is `{ev:'action', verb:'connive', object}`, the permanent that would connive. CR 614.5: the connive an `instead` body makes is not
 * replaced again by the same effect (the chain of effects/propose.ts).
 */
import type { Proposed } from '../api';
import { performNothing } from '../perform-events';
import type { ProposalKind } from '../registries';

export const CONNIVE_KIND: ProposalKind<Extract<Proposed, { ev: 'connive' }>> = {
  ev: 'connive',
  capabilities: ['feature:replace.on.action.connive'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'action', roles: { subject: { objects: [e.object] }, player: { players: [e.player] } }, data: { verb: 'connive', amount: e.n } }),
  affectedPlayer: (_g, e) => e.player, // CR 616.1: the conniving permanent's controller
  forbidden: () => null,
  perform: (g, e) => performNothing(g, e), // the keyword action's macro does the connive itself
};
