/**
 * The `loseGame` proposal kind (edh-replace-7; CR 104.3, 614.1a): "If you would lose the game, instead exile ~ and your life total becomes 1." (The Golden Throne). Every loss of the
 * game but a concession (core/sba.ts: the state-based actions, an effect that makes a player lose, CR 104.3e) is proposed here once the player CAN lose (CR 104.3b), so a replacement
 * effect may replace it (an `instead` body). The pattern is `{ev:'loseGame', player}`, the player who would lose. Replaced, the player has not lost: the state-based actions are
 * checked again (core/sba.ts), and a cause that is still there (ten poison counters) loses the player then, with nothing left to replace it.
 */
import type { Proposed } from '../api';
import { performLoseGameEvent } from '../perform-events';
import type { ProposalKind } from '../registries';

export const LOSE_GAME_KIND: ProposalKind<Extract<Proposed, { ev: 'loseGame' }>> = {
  ev: 'loseGame',
  capabilities: ['feature:replace.on.loseGame'],
  semOf: (_g, e) => ({ seq: 0, batch: 0, before: {}, ev: 'loseGame', roles: { player: { players: [e.player] } }, data: { reason: e.reason } }),
  affectedPlayer: (_g, e) => e.player, // CR 616.1: the player who would lose
  forbidden: () => null, // checked before it is proposed (core/sba.ts: a player who can't lose the game is not proposed, CR 104.3b)
  perform: (g, e) => performLoseGameEvent(g, e),
};
