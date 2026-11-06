/**
 * The `search` proposal kind (edh-zones-14; CR 701.23a, 614.1a): "If an opponent would search a library, that player searches the top four cards of that library
 * instead." (Aven Mindcensor). The search instruction (effects/handlers/cards-library.ts) proposes each search of a zone of a player as ONE event before the searcher
 * looks at the zone, so a replacement effect can change it: a `modify` body with a `count` `set` limits the cards searched to the top N of the library (`top`, the
 * least of the limits that applied). The pattern is `{ev:'action', verb:'search', actor}`, the searching player. With no such replacement nothing changes (the whole
 * zone is searched). A search that is part of a cost or a rule is not proposed (fail closed: it searches what it says).
 */
import type { Proposed } from '../api';
import { performNothing } from '../perform-events';
import type { ProposalKind } from '../registries';

export const SEARCH_KIND: ProposalKind<Extract<Proposed, { ev: 'search' }>> = {
  ev: 'search',
  capabilities: ['feature:replace.on.action.search'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'action', roles: { player: { players: [e.player] } }, data: { verb: 'search', zone: e.zone, zoneOwner: e.owner } }),
  affectedPlayer: (_g, e) => e.player, // CR 616.1: the searching player
  forbidden: () => null, // "can't search" is checked by the search instruction itself (statics/cant)
  perform: (g, e) => performNothing(g, e), // the search instruction does the looking and the taking itself
};
