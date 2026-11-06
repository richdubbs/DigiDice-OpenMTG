/**
 * Starting the game (CR 103): choose the starting player, shuffle, draw opening hands,
 * London-style mulligans as written in CR 103.5, the actions with cards in the opening hand (CR 103.6, core/pregame.ts; FAST4 MX1), then the first turn
 * begins (CR 103.8).
 */
import type { Game } from './game';
import { randomInt } from '../rng';
import { drawCards, shuffleLibrary } from './zones';
import { mulligans } from './mulligans'; // edh-next-137: its own module (core/restart.ts uses it too, without importing core/turn)
import { beginNextTurn, advance } from './turn';
import { openingHandActions } from './pregame';
import { concedeGame } from './sba';
import type { PlayerId } from '../types/ids';

/** M12-2 (review fix 2): a concession made while the start procedure waited for a decision, with the number of answers given before it. */
export type StartConcession = { player: PlayerId; at: number };

/**
 * M12-2 (m12 design D11, review fix 2; CR 104.3a, 800.4a): the concessions due at this point of the start procedure (once `at` answers have been used:
 * where the procedure was waiting when the player conceded) are applied now: the player leaves the game (core/leave.ts). Everything before that point,
 * the shuffles and the opening hands (one RNG stream for every library) and every answer, is the same as it was, so nobody's library or hand changes.
 * Called before each decision of the procedure. Returns true when the game is over (one player left, CR 104.2a).
 */
function concessionsDue(g: Game, pending: StartConcession[]): boolean {
  while (pending.length > 0 && pending[0]!.at <= g.answersUsed && !g.s.result) {
    const c = pending.shift()!;
    if (g.player(c.player).hasLost) continue;
    g.log(`${g.player(c.player).name} concedes.`, { rules: ['CR 104.3a'], level: 'action' });
    concedeGame(g, c.player);
  }
  return g.s.result !== null;
}

export function startGame(g: Game, concessions: readonly StartConcession[] = []): void {
  const s = g.s;
  const ids = s.players.map((p) => p.id);
  const pending = [...concessions];
  const due = (): boolean => concessionsDue(g, pending);

  // CR 103.1: determine who chooses; that player chooses who takes the first turn.
  let starting = s.options.startingPlayer;
  if (!starting) {
    const chooser = ids[randomInt(s.rng, ids.length)]!;
    g.log(`${g.player(chooser).name} wins the coin flip and chooses who plays first.`, { rules: ['CR 103.1'] });
    s.stage = 'choosePlayOrder';
    if (due()) return;
    const ans = g.choose({
      kind: 'playFirst',
      player: chooser,
      prompt: 'Choose who takes the first turn.',
      options: ids.filter((id) => !g.player(id).hasLost), // M12-2: a player who conceded before the game began takes no turn (CR 104.3a, 800.4k)
      rules: ['CR 103.1'],
    });
    starting = ans.player;
  }
  if (g.player(starting).hasLost) starting = g.nextPlayer(starting); // M12-2: CR 800.4k, the starting player named by the config conceded before the start
  s.turn.startingPlayer = starting;
  s.turn.activePlayer = starting;
  // Turn order begins with the starting player (CR 103.1).
  const si = ids.indexOf(starting);
  s.players = [...s.players.slice(si), ...s.players.slice(0, si)];
  g.log(`${g.player(starting).name} will take the first turn.`, { rules: ['CR 103.1'] });
  // CMP1, CR 103.2b: the companions revealed from outside the game (PlayerConfig.companion); they stay outside the game
  for (const p of s.players) {
    if (p.companion) g.log(`${p.name} reveals ${s.defs[p.companion.defId]?.name ?? 'a card'} from outside the game as their companion.`, { rules: ['CR 103.2b', 'CR 702.139a'] });
  }

  // CR 103.3: shuffle decks.
  for (const p of s.players) if (!p.hasLost) shuffleLibrary(g, p.id); // M12-2: a player who conceded before the start has no library left (CR 800.4a)

  // CR 103.5: draw opening hands and mulligan.
  const handSize = s.options.startingHandSize;
  for (const p of s.players) if (!p.hasLost) drawCards(g, p.id, handSize);
  s.stage = 'mulligan';
  if (!s.options.skipMulligans) mulligans(g, handSize, due);
  if (due()) return;
  for (const p of s.players) p.keptHand = true;
  // CR 103.6: once the mulligan process is complete, the starting player, then each other player in turn order, may take opening-hand actions.
  openingHandActions(g, due);
  if (due()) return;

  s.stage = 'playing';
  g.emit({ type: 'gameStarted', startingPlayer: starting });
  g.log('The game begins.', { rules: ['CR 103.8'], level: 'action' });
  beginNextTurn(g);
  advance(g);
}
