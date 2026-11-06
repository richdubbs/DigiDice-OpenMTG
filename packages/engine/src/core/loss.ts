/**
 * The loss of the game itself (CR 104.3), once nothing replaced it: the player is marked as having lost and, in a multiplayer game, leaves when the game is checked. Its own file so that
 * effects/perform-events.ts (the `loseGame` proposal kind, edh-replace-7) and core/sba.ts both reach it without an import cycle.
 */
import { noteLoser } from './leave';
import type { Game } from './game';

export function markLost(g: Game, player: string, reason: string, rules: string[]): void {
  const p = g.player(player);
  if (p.hasLost) return;
  p.hasLost = true;
  p.lostReason = reason;
  g.log(`${p.name} loses the game: ${reason}.`, { rules, level: 'warning' });
  g.emit({ type: 'playerLost', player, reason, rules: [...rules] }); // M13-7: the citations of the loss (the hosted results ledger's loss codes)
  noteLoser(g, { player, reason, rules }); // M12-2: in a multiplayer game the player leaves it (CR 104.5, 800.4a) when the game is checked (core/leave.ts)
}
