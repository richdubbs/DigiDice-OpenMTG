/**
 * The `turn` proposal kind (CR 614.10: "skip your next turn"; m6 design 2.4). Its patterns are `beginTurn` patterns (`feature:replace.on.turn`). Owner: M6-1.
 * core/turn.ts proposes each turn before it begins (M6-1, core/turn-skip.ts). A pattern that names `extra` does not match (triggers/match.ts: fail closed).
 */
import type { Proposed } from '../api';
import { performNothing } from '../perform-events';
import type { ProposalKind } from '../registries';

export const TURN_KIND: ProposalKind<Extract<Proposed, { ev: 'turn' }>> = {
  ev: 'turn',
  capabilities: ['feature:replace.on.turn'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'beginTurn', roles: { player: { players: [e.whose] } }, data: { extra: e.extra } }),
  affectedPlayer: (_g, e) => e.whose, // CR 616.1: the player whose turn it is
  forbidden: () => null,
  perform: (g, e) => performNothing(g, e), // the turn structure begins the turn itself
};
