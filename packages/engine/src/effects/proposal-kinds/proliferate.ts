/**
 * The `proliferate` proposal kind (p2-replace-events-2; CR 701.34a, 614.1a): "If you would proliferate, proliferate twice instead." (Tekuthal, Inquiry Dominus).
 * The native proliferate (effects/handlers/actions-native-counters.ts) proposes each proliferate of a player (one per repetition) as ONE event before it asks for
 * the permanents and players, so a replacement effect can replace it; when the event is still there the proliferate runs as before. The pattern is
 * `{ev:'action', verb:'proliferate', actor}`, the proliferating player. CR 614.5: a proliferate an `instead` body makes is not replaced again by the same effect
 * (the chain of effects/propose.ts). The same shape as Cloud r4-repl's `explore` kind (effects/proposal-kinds/explore.ts).
 */
import type { Proposed } from '../api';
import { performNothing } from '../perform-events';
import type { ProposalKind } from '../registries';

export const PROLIFERATE_KIND: ProposalKind<Extract<Proposed, { ev: 'proliferate' }>> = {
  ev: 'proliferate',
  capabilities: ['feature:replace.on.action.proliferate'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'action', roles: { player: { players: [e.player] } }, data: { verb: 'proliferate' } }),
  affectedPlayer: (_g, e) => e.player, // CR 616.1: the proliferating player
  forbidden: () => null,
  perform: (g, e) => performNothing(g, e), // the native proliferate does the choosing and the counters itself
};
