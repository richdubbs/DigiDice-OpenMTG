/**
 * The `explore` proposal kind (Cloud r4-repl; CR 701.44a, 614.1a): "If a creature you control would explore, instead you scry 1, then that creature explores."
 * (Twists and Turns). The native explore (effects/handlers/explore.ts) proposes each explore of a permanent (one per repetition, CR 701.44a-b) as ONE event
 * before its process runs, so a replacement effect can replace it; when the event is still there the process runs as before. The pattern is
 * `{ev:'action', verb:'explore', object}`, the permanent that would explore. CR 614.5: the explore an `instead` body makes is not replaced again by the same
 * effect (the chain of effects/propose.ts). The same shape as Cloud r3-repl's `connive` kind (effects/proposal-kinds/connive.ts).
 */
import type { Proposed } from '../api';
import { performNothing } from '../perform-events';
import type { ProposalKind } from '../registries';

export const EXPLORE_KIND: ProposalKind<Extract<Proposed, { ev: 'explore' }>> = {
  ev: 'explore',
  capabilities: ['feature:replace.on.action.explore'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'action', roles: { subject: { objects: [e.object] }, player: { players: [e.player] } }, data: { verb: 'explore' } }),
  affectedPlayer: (_g, e) => e.player, // CR 616.1: the exploring permanent's controller
  forbidden: () => null,
  perform: (g, e) => performNothing(g, e), // the native explore does the process itself
};
