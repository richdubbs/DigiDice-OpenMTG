/**
 * The `phase` proposal kind (CR 614.10: "skip your next combat phase"; m6 design 2.4). Owner: M6-1 (core/turn-skip.ts proposes it through
 * core/registries.ts#TURN_BASED.propose): core/turn.ts proposes each phase before its first step (M6-1), so "skip your next combat phase" replaces it.
 */
import type { Proposed } from '../api';
import { performNothing } from '../perform-events';
import type { ProposalKind } from '../registries';

export const PHASE_KIND: ProposalKind<Extract<Proposed, { ev: 'phase' }>> = {
  ev: 'phase',
  capabilities: ['feature:replace.on.phase'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'phase', roles: { player: { players: [e.whose] } }, data: { phase: e.phase } }),
  affectedPlayer: (_g, e) => e.whose, // CR 616.1: the player whose phase it is
  forbidden: () => null,
  perform: (g, e) => performNothing(g, e), // the turn structure performs the phase itself
};
