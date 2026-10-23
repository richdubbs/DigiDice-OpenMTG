/**
 * The `drawMany` proposal kind (Cloud r4-repl; CR 121.2, 614.1a): "As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that
 * many cards plus one instead." (Quantum Riddler). A draw instruction (effects/handlers/cards-draw.ts#drawHandler) and the draw of the draw step (core/steps.ts)
 * propose each player's draw of N cards as ONE event first, before any card is drawn, so a replacement effect can change the number (a `modify.count` body); the
 * cards are then drawn one at a time as before, each card's draw proposed on its own (CR 121.2: "If you would draw a card, ... instead" still sees each of them).
 * The pattern is `{ev:'action', verb:'draw', actor}`, the drawing player. With no such replacement nothing changes (the same number of cards is drawn).
 */
import type { Proposed } from '../api';
import { performNothing } from '../perform-events';
import type { ProposalKind } from '../registries';

export const DRAW_MANY_KIND: ProposalKind<Extract<Proposed, { ev: 'drawMany' }>> = {
  ev: 'drawMany',
  capabilities: ['feature:replace.on.action.draw'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'action', roles: { player: { players: [e.player] } }, data: { verb: 'draw', amount: e.count } }),
  affectedPlayer: (_g, e) => e.player, // CR 616.1: the drawing player
  forbidden: () => null, // "can't draw" is each card's own draw (CR 614.17, the `draw` kind)
  perform: (g, e) => performNothing(g, e), // the draws are made one by one afterwards
};
