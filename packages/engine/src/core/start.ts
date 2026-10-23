/**
 * Starting the game (CR 103): choose the starting player, shuffle, draw opening hands,
 * London-style mulligans as written in CR 103.5, the actions with cards in the opening hand (CR 103.6, core/pregame.ts; FAST4 MX1), then the first turn
 * begins (CR 103.8).
 */
import type { Game } from './game';
import { randomInt } from '../rng';
import { drawCards, moveObject, shuffleLibrary, zoneArray } from './zones';
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

/**
 * London-style mulligans (CR 103.5). M11-1: in a Commander variant with `freeMulligan` (Brawl, CR 903.12g; CR 103.5c names multiplayer games, so a two-player
 * Commander game has none), the first mulligan a player takes counts neither toward the cards they put on the bottom nor toward the number of mulligans they
 * may take; `PlayerState.mulligans` still counts every mulligan taken. Outside such a game `counted(n)` is `n`: unchanged.
 */
function mulligans(g: Game, handSize: number, due: () => boolean = () => false): void {
  const s = g.s;
  // M12-2 (m12 design E4): CR 103.5c, 800.6: the first mulligan is free in every multiplayer game too (`options.multiplayer`, D1)
  const multiplayerFree = s.options.multiplayer !== undefined;
  const free = s.options.commander?.freeMulligan === true || multiplayerFree ? 1 : 0;
  const counted = (n: number): number => Math.max(0, n - free);
  for (;;) {
    const deciding = s.players.filter((p) => !p.keptHand && !p.hasLost); // M12-2: a player who conceded before the start takes no mulligan (CR 104.3a)
    if (deciding.length === 0) return;
    const taking: string[] = [];
    // Starting player declares first, then each other player in turn order (CR 103.5).
    for (const p of deciding) {
      if (due()) return; // M12-2 (review fix 2)
      if (p.hasLost) continue;
      const canMulligan = counted(p.mulligans) < handSize;
      if (!canMulligan) { p.keptHand = true; continue; }
      const ans = g.choose({
        kind: 'mulligan',
        player: p.id,
        prompt: `Keep this ${handSize - counted(p.mulligans)}-card hand or take a mulligan?${free && p.mulligans === 0 ? ' (Your first mulligan is free.)' : ''}`,
        handSize: handSize - counted(p.mulligans + 1),
        mulligans: p.mulligans,
        rules: ['CR 103.5'],
      });
      if (ans.keep) {
        p.keptHand = true;
        g.log(`${p.name} keeps.`, { rules: ['CR 103.5'] });
      } else taking.push(p.id);
    }
    // All mulligans happen at the same time.
    for (const pid of taking) {
      const p = g.player(pid);
      p.mulligans++;
      for (const id of [...zoneArray(g, 'hand', pid)]) moveObject(g, id, 'library', { silent: true, cause: 'mulligan' });
      shuffleLibrary(g, pid);
      drawCards(g, pid, handSize);
      g.emit({ type: 'mulligan', player: pid, count: p.mulligans });
      const isFree = free === 1 && p.mulligans === 1;
      g.log(`${p.name} takes mulligan number ${p.mulligans}${isFree ? ' (free)' : ''}.`, { rules: ['CR 103.5', ...(isFree ? (multiplayerFree ? ['CR 103.5c', 'CR 800.6'] : ['CR 903.12g']) : [])] });
      // Put cards equal to the number of mulligans taken on the bottom, in any order (CR 903.12g: the free first one not counted).
      const n = Math.min(counted(p.mulligans), zoneArray(g, 'hand', pid).length);
      if (n > 0) {
        if (due()) return; // M12-2 (review fix 2)
        if (p.hasLost) continue;
        const ans = g.choose({
          kind: 'chooseObjects',
          player: pid,
          prompt: `Put ${n} card${n === 1 ? '' : 's'} from your hand on the bottom of your library (in order: first chosen goes on the bottom first).`,
          options: [...zoneArray(g, 'hand', pid)],
          min: n,
          max: n,
          ordered: true,
          rules: ['CR 103.5'],
        });
        for (const id of ans.ids) moveObject(g, id, 'library', { position: 'bottom', silent: true, cause: 'mulligan' });
        g.log(`${p.name} puts ${n} card${n === 1 ? '' : 's'} on the bottom of their library.`, { rules: ['CR 103.5'] });
      }
    }
  }
}
